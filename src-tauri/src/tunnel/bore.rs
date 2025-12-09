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

// Pre-compiled regex patterns for bore output parsing
static URL_REGEX: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"listening at ([a-zA-Z0-9.-]+:\d+)").expect("Invalid bore URL regex"));
static HOST_PORT_REGEX: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"bore\.pub:\d+").expect("Invalid bore host:port regex"));

/// Start a bore tunnel
pub async fn start_bore_tunnel(
    data_dir: &Path,
    config: &TunnelConfig,
    app: &AppHandle,
) -> AppResult<RunningTunnel> {
    let binary_path = get_agent_binary_path(data_dir, TunnelProvider::Bore);

    if !binary_path.exists() {
        return Err(AppError::Custom("bore agent not installed".to_string()));
    }

    println!(
        "[BORE] Starting TCP tunnel for port {}...",
        config.target_port
    );

    // Start bore tunnel
    // bore local <PORT> --to bore.pub
    let mut cmd = Command::new(&binary_path);
    cmd.args(["local", &config.target_port.to_string(), "--to", "bore.pub"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Io(format!("Failed to start bore: {}", e)))?;

    let pid = child.id().unwrap_or(0);
    println!("[BORE] Started with PID: {}", pid);

    let status = Arc::new(RwLock::new(TunnelStatus::Connecting));

    let running_tunnel = RunningTunnel {
        instance_id: config.instance_id.clone(),
        provider: TunnelProvider::Bore,
        pid,
        status: status.clone(),
    };

    // Emit connecting status
    let _ = app.emit(
        "tunnel-status",
        TunnelStatusEvent {
            instance_id: config.instance_id.clone(),
            provider: "bore".to_string(),
            status: TunnelStatus::Connecting,
        },
    );

    // Spawn task to monitor stdout for URL
    let instance_id = config.instance_id.clone();
    let app_handle = app.clone();
    let status_clone = status.clone();

    if let Some(stdout) = child.stdout.take() {
        tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();

            while let Ok(Some(line)) = lines.next_line().await {
                println!("[BORE] {}", line);

                // Check for URL in the line
                let found_url = if let Some(captures) = URL_REGEX.captures(&line) {
                    captures.get(1).map(|m| m.as_str().to_string())
                } else {
                    HOST_PORT_REGEX.find(&line).map(|m| m.as_str().to_string())
                };

                if let Some(minecraft_addr) = found_url {
                    println!("[BORE] Found tunnel URL: {}", minecraft_addr);

                    // Update status
                    {
                        let mut status = status_clone.write().await;
                        *status = TunnelStatus::Connected {
                            url: minecraft_addr.clone(),
                        };
                    }

                    // Emit connected status with URL
                    let _ = app_handle.emit(
                        "tunnel-status",
                        TunnelStatusEvent {
                            instance_id: instance_id.clone(),
                            provider: "bore".to_string(),
                            status: TunnelStatus::Connected {
                                url: minecraft_addr.clone(),
                            },
                        },
                    );

                    // Also emit the URL separately
                    let _ = app_handle.emit(
                        "tunnel-url",
                        TunnelUrlEvent {
                            instance_id: instance_id.clone(),
                            url: minecraft_addr,
                        },
                    );
                }

                // Check for errors
                if line.to_lowercase().contains("error") || line.to_lowercase().contains("failed") {
                    let mut status = status_clone.write().await;
                    if matches!(*status, TunnelStatus::Connecting) {
                        *status = TunnelStatus::Error {
                            message: line.clone(),
                        };

                        let _ = app_handle.emit(
                            "tunnel-status",
                            TunnelStatusEvent {
                                instance_id: instance_id.clone(),
                                provider: "bore".to_string(),
                                status: TunnelStatus::Error { message: line },
                            },
                        );
                    }
                }
            }
        });
    }

    // Capture stderr for errors and URL (bore might output there too)
    if let Some(stderr) = child.stderr.take() {
        let instance_id_err = config.instance_id.clone();
        let app_err = app.clone();
        let status_err = status.clone();

        tokio::spawn(async move {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();

            while let Ok(Some(line)) = lines.next_line().await {
                println!("[BORE STDERR] {}", line);

                // Check for URL in stderr too
                let found_url = if let Some(captures) = URL_REGEX.captures(&line) {
                    captures.get(1).map(|m| m.as_str().to_string())
                } else {
                    HOST_PORT_REGEX.find(&line).map(|m| m.as_str().to_string())
                };

                if let Some(minecraft_addr) = found_url {
                    let mut status = status_err.write().await;
                    if !matches!(*status, TunnelStatus::Connected { .. }) {
                        *status = TunnelStatus::Connected {
                            url: minecraft_addr.clone(),
                        };

                        let _ = app_err.emit(
                            "tunnel-status",
                            TunnelStatusEvent {
                                instance_id: instance_id_err.clone(),
                                provider: "bore".to_string(),
                                status: TunnelStatus::Connected {
                                    url: minecraft_addr.clone(),
                                },
                            },
                        );

                        let _ = app_err.emit(
                            "tunnel-url",
                            TunnelUrlEvent {
                                instance_id: instance_id_err.clone(),
                                url: minecraft_addr,
                            },
                        );
                    }
                }

                // Check for connection errors
                if line.contains("error") || line.contains("failed") || line.contains("Error") {
                    let mut status = status_err.write().await;
                    if matches!(*status, TunnelStatus::Connecting) {
                        *status = TunnelStatus::Error {
                            message: line.clone(),
                        };

                        let _ = app_err.emit(
                            "tunnel-status",
                            TunnelStatusEvent {
                                instance_id: instance_id_err.clone(),
                                provider: "bore".to_string(),
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
                provider: "bore".to_string(),
                status: TunnelStatus::Disconnected,
            },
        );

        println!("[BORE] Tunnel process exited");
    });

    Ok(running_tunnel)
}
