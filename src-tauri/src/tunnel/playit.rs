use crate::error::{AppError, AppResult};
use crate::tunnel::{
    agent::get_agent_binary_path, RunningTunnel, TunnelConfig, TunnelProvider, TunnelStatus,
    TunnelStatusEvent, TunnelUrlEvent,
};
use once_cell::sync::Lazy;
use regex::Regex;
use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::RwLock;

// Windows-specific: CREATE_NO_WINDOW flag to hide console window
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

// Pre-compiled regex patterns for playit output parsing
static CLAIM_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"https://playit\.gg/claim/[a-zA-Z0-9]+").expect("Invalid claim regex")
});
static TUNNEL_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"([a-zA-Z0-9-]+\.(joinmc\.link|playit\.gg|playit-cloud\.me))")
        .expect("Invalid tunnel regex")
});
static IP_PORT_REGEX: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(\d+\.\d+\.\d+\.\d+:\d+)").expect("Invalid IP:port regex"));

/// Start a playit.gg tunnel
pub async fn start_playit_tunnel(
    data_dir: &Path,
    config: &TunnelConfig,
    app: &AppHandle,
) -> AppResult<RunningTunnel> {
    let binary_path = get_agent_binary_path(data_dir, TunnelProvider::Playit);

    if !binary_path.exists() {
        return Err(AppError::Custom("playit agent not installed".to_string()));
    }

    println!(
        "[PLAYIT] Starting tunnel for port {}...",
        config.target_port
    );

    // Build command args
    let mut args = Vec::new();

    // If we have a secret key, use it
    if let Some(ref secret_key) = config.playit_secret_key {
        args.push("--secret".to_string());
        args.push(secret_key.clone());
    }

    // Start playit
    let mut cmd = Command::new(&binary_path);
    cmd.args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // On Windows, hide the console window
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Io(format!("Failed to start playit: {}", e)))?;

    let pid = child.id().unwrap_or(0);
    println!("[PLAYIT] Started with PID: {}", pid);

    let initial_status = if config.playit_secret_key.is_some() {
        TunnelStatus::Connecting
    } else {
        // First launch - will need to claim
        TunnelStatus::Connecting
    };

    let status = Arc::new(RwLock::new(initial_status.clone()));

    let running_tunnel = RunningTunnel {
        instance_id: config.instance_id.clone(),
        provider: TunnelProvider::Playit,
        pid,
        status: status.clone(),
    };

    // Emit initial status
    let _ = app.emit(
        "tunnel-status",
        TunnelStatusEvent {
            instance_id: config.instance_id.clone(),
            provider: "playit".to_string(),
            status: initial_status,
        },
    );

    // Spawn task to monitor output
    let instance_id = config.instance_id.clone();
    let app_handle = app.clone();
    let status_clone = status.clone();

    // playit outputs to stdout
    if let Some(stdout) = child.stdout.take() {
        tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();

            while let Ok(Some(line)) = lines.next_line().await {
                println!("[PLAYIT] {}", line);

                // Check for claim URL (first time setup)
                if let Some(captures) = CLAIM_REGEX.find(&line) {
                    let claim_url = captures.as_str().to_string();
                    println!("[PLAYIT] Found claim URL: {}", claim_url);

                    // Update status to waiting for claim
                    {
                        let mut status = status_clone.write().await;
                        *status = TunnelStatus::WaitingForClaim {
                            claim_url: claim_url.clone(),
                        };
                    }

                    let _ = app_handle.emit(
                        "tunnel-status",
                        TunnelStatusEvent {
                            instance_id: instance_id.clone(),
                            provider: "playit".to_string(),
                            status: TunnelStatus::WaitingForClaim { claim_url },
                        },
                    );
                }

                // Check for tunnel URL
                if let Some(captures) = TUNNEL_REGEX.captures(&line) {
                    let url = captures.get(0).map(|m| m.as_str().to_string());
                    if let Some(url) = url {
                        println!("[PLAYIT] Found tunnel URL: {}", url);

                        {
                            let mut status = status_clone.write().await;
                            *status = TunnelStatus::Connected { url: url.clone() };
                        }

                        let _ = app_handle.emit(
                            "tunnel-status",
                            TunnelStatusEvent {
                                instance_id: instance_id.clone(),
                                provider: "playit".to_string(),
                                status: TunnelStatus::Connected { url: url.clone() },
                            },
                        );

                        let _ = app_handle.emit(
                            "tunnel-url",
                            TunnelUrlEvent {
                                instance_id: instance_id.clone(),
                                url,
                            },
                        );
                    }
                }

                // Also check for IP:port format
                if line.contains("tunnel address") || line.contains("connect to") {
                    if let Some(captures) = IP_PORT_REGEX.find(&line) {
                        let addr = captures.as_str().to_string();
                        println!("[PLAYIT] Found address: {}", addr);

                        {
                            let mut status = status_clone.write().await;
                            if !matches!(*status, TunnelStatus::Connected { .. }) {
                                *status = TunnelStatus::Connected { url: addr.clone() };

                                let _ = app_handle.emit(
                                    "tunnel-status",
                                    TunnelStatusEvent {
                                        instance_id: instance_id.clone(),
                                        provider: "playit".to_string(),
                                        status: TunnelStatus::Connected { url: addr.clone() },
                                    },
                                );

                                let _ = app_handle.emit(
                                    "tunnel-url",
                                    TunnelUrlEvent {
                                        instance_id: instance_id.clone(),
                                        url: addr,
                                    },
                                );
                            }
                        }
                    }
                }
            }
        });
    }

    // Also capture stderr for errors
    if let Some(stderr) = child.stderr.take() {
        let instance_id_err = config.instance_id.clone();
        let app_err = app.clone();
        let status_err = status.clone();

        tokio::spawn(async move {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();

            while let Ok(Some(line)) = lines.next_line().await {
                println!("[PLAYIT STDERR] {}", line);

                if line.contains("error") || line.contains("failed") {
                    let mut status = status_err.write().await;
                    if matches!(*status, TunnelStatus::Connecting) {
                        *status = TunnelStatus::Error {
                            message: line.clone(),
                        };

                        let _ = app_err.emit(
                            "tunnel-status",
                            TunnelStatusEvent {
                                instance_id: instance_id_err.clone(),
                                provider: "playit".to_string(),
                                status: TunnelStatus::Error { message: line },
                            },
                        );
                    }
                }
            }
        });
    }

    // Spawn task to wait for process exit
    let instance_id_exit = config.instance_id.clone();
    let app_exit = app.clone();
    let status_exit = status;

    tokio::spawn(async move {
        let _ = child.wait().await;

        // Update status to disconnected
        {
            let mut status = status_exit.write().await;
            *status = TunnelStatus::Disconnected;
        }

        // Emit stopped status
        let _ = app_exit.emit(
            "tunnel-status",
            TunnelStatusEvent {
                instance_id: instance_id_exit,
                provider: "playit".to_string(),
                status: TunnelStatus::Disconnected,
            },
        );

        println!("[PLAYIT] Tunnel process exited");
    });

    Ok(running_tunnel)
}
