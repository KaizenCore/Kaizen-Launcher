use crate::error::{AppError, AppResult};
use crate::tunnel::{
    agent::get_agent_binary_path, RunningTunnel, TunnelConfig, TunnelProvider, TunnelStatus,
    TunnelStatusEvent, TunnelUrlEvent,
};
use once_cell::sync::Lazy;
use regex::Regex;
use serde::Deserialize;
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

// Pre-compiled regex patterns for ngrok output parsing
static LOGFMT_URL_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"url=tcp://([a-zA-Z0-9.-]+:\d+)"#).expect("Invalid ngrok logfmt URL regex")
});
static URL_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"tcp://[a-zA-Z0-9.-]+\.ngrok[a-zA-Z0-9.-]*\.(io|app):\d+")
        .expect("Invalid ngrok URL regex")
});
static FORWARDING_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"Forwarding\s+tcp://([^\s]+)").expect("Invalid ngrok forwarding regex")
});

/// ngrok API response structures
#[derive(Debug, Deserialize)]
struct NgrokApiResponse {
    tunnels: Vec<NgrokTunnel>,
}

#[derive(Debug, Deserialize)]
struct NgrokTunnel {
    public_url: String,
}

/// Poll ngrok local API to get tunnel URL
async fn poll_ngrok_api() -> Option<String> {
    // ngrok exposes a local API on port 4040
    let client = reqwest::Client::new();

    match client.get("http://127.0.0.1:4040/api/tunnels").send().await {
        Ok(response) => {
            if let Ok(api_response) = response.json::<NgrokApiResponse>().await {
                // Find TCP tunnel
                for tunnel in api_response.tunnels {
                    if tunnel.public_url.starts_with("tcp://") {
                        // Return just host:port without tcp:// prefix
                        return Some(tunnel.public_url.trim_start_matches("tcp://").to_string());
                    }
                }
            }
        }
        Err(e) => {
            println!("[NGROK] API poll error: {}", e);
        }
    }
    None
}

/// Configure ngrok authtoken
pub async fn configure_authtoken(data_dir: &Path, authtoken: &str) -> AppResult<()> {
    let binary_path = get_agent_binary_path(data_dir, TunnelProvider::Ngrok);

    if !binary_path.exists() {
        return Err(AppError::Custom("ngrok agent not installed".to_string()));
    }

    println!("[NGROK] Configuring authtoken...");

    let mut cmd = Command::new(&binary_path);
    cmd.args(["config", "add-authtoken", authtoken]);

    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = cmd
        .output()
        .await
        .map_err(|e| AppError::Io(format!("Failed to configure ngrok: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Custom(format!(
            "Failed to configure ngrok authtoken: {}",
            stderr
        )));
    }

    println!("[NGROK] Authtoken configured successfully");
    Ok(())
}

/// Check if ngrok is configured (has authtoken)
#[allow(dead_code)]
pub async fn is_configured(data_dir: &Path) -> bool {
    let binary_path = get_agent_binary_path(data_dir, TunnelProvider::Ngrok);

    if !binary_path.exists() {
        return false;
    }

    // Try to run ngrok config check
    let mut cmd = Command::new(&binary_path);
    cmd.args(["config", "check"]);

    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = cmd.output().await;

    match output {
        Ok(o) => o.status.success(),
        Err(_) => false,
    }
}

/// Start an ngrok TCP tunnel
pub async fn start_ngrok_tunnel(
    data_dir: &Path,
    config: &TunnelConfig,
    app: &AppHandle,
) -> AppResult<RunningTunnel> {
    let binary_path = get_agent_binary_path(data_dir, TunnelProvider::Ngrok);

    if !binary_path.exists() {
        return Err(AppError::Custom("ngrok agent not installed".to_string()));
    }

    // Check if authtoken is configured
    if config.ngrok_authtoken.is_none() {
        return Err(AppError::Custom(
            "ngrok authtoken not configured. Please add your authtoken first.".to_string(),
        ));
    }

    // Configure authtoken before starting
    if let Some(ref token) = config.ngrok_authtoken {
        configure_authtoken(data_dir, token).await?;
    }

    println!(
        "[NGROK] Starting TCP tunnel for port {}...",
        config.target_port
    );

    // Start ngrok tcp tunnel with logging to stdout
    // ngrok tcp PORT --log=stdout --log-format=logfmt
    let mut cmd = Command::new(&binary_path);
    cmd.args([
        "tcp",
        &config.target_port.to_string(),
        "--log=stdout",
        "--log-format=logfmt",
    ])
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());

    // On Windows, hide the console window
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Io(format!("Failed to start ngrok: {}", e)))?;

    let pid = child.id().unwrap_or(0);
    println!("[NGROK] Started with PID: {}", pid);

    let status = Arc::new(RwLock::new(TunnelStatus::Connecting));

    let running_tunnel = RunningTunnel {
        instance_id: config.instance_id.clone(),
        provider: TunnelProvider::Ngrok,
        pid,
        status: status.clone(),
    };

    // Emit connecting status
    let _ = app.emit(
        "tunnel-status",
        TunnelStatusEvent {
            instance_id: config.instance_id.clone(),
            provider: "ngrok".to_string(),
            status: TunnelStatus::Connecting,
        },
    );

    // Spawn task to poll ngrok API for URL (most reliable method)
    let instance_id_api = config.instance_id.clone();
    let app_api = app.clone();
    let status_api = status.clone();

    tokio::spawn(async move {
        // Wait a bit for ngrok to start its API server
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;

        // Poll up to 30 times (30 seconds total)
        for i in 0..30 {
            // Check if already connected
            {
                let status_read = status_api.read().await;
                if matches!(*status_read, TunnelStatus::Connected { .. }) {
                    println!("[NGROK] Already connected, stopping API poll");
                    return;
                }
            }

            if let Some(minecraft_addr) = poll_ngrok_api().await {
                println!("[NGROK] Got URL from API: {}", minecraft_addr);

                // Update status
                {
                    let mut status = status_api.write().await;
                    *status = TunnelStatus::Connected {
                        url: minecraft_addr.clone(),
                    };
                }

                // Emit connected status with URL
                let _ = app_api.emit(
                    "tunnel-status",
                    TunnelStatusEvent {
                        instance_id: instance_id_api.clone(),
                        provider: "ngrok".to_string(),
                        status: TunnelStatus::Connected {
                            url: minecraft_addr.clone(),
                        },
                    },
                );

                // Also emit the URL separately
                let _ = app_api.emit(
                    "tunnel-url",
                    TunnelUrlEvent {
                        instance_id: instance_id_api.clone(),
                        url: minecraft_addr,
                    },
                );

                return;
            }

            println!("[NGROK] API poll attempt {} - no tunnel yet", i + 1);
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        }

        println!("[NGROK] API polling timed out after 30 seconds");
    });

    // Spawn task to monitor output and find URL (backup method)
    let instance_id = config.instance_id.clone();
    let app_handle = app.clone();
    let status_clone = status.clone();

    // ngrok outputs to stdout in logfmt format
    if let Some(stdout) = child.stdout.take() {
        tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();

            while let Ok(Some(line)) = lines.next_line().await {
                println!("[NGROK] {}", line);

                // Check for URL in the line (try multiple formats)
                let found_url = if let Some(captures) = LOGFMT_URL_REGEX.captures(&line) {
                    // logfmt format: url=tcp://host:port
                    captures.get(1).map(|m| m.as_str().to_string())
                } else if let Some(captures) = FORWARDING_REGEX.captures(&line) {
                    // Interactive format: Forwarding tcp://host:port
                    captures.get(1).map(|m| m.as_str().to_string())
                } else {
                    // Plain URL format
                    URL_REGEX
                        .find(&line)
                        .map(|m| m.as_str().trim_start_matches("tcp://").to_string())
                };

                if let Some(minecraft_addr) = found_url {
                    // URL is already in host:port format for Minecraft
                    println!("[NGROK] Found tunnel URL: {}", minecraft_addr);

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
                            provider: "ngrok".to_string(),
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
                                provider: "ngrok".to_string(),
                                status: TunnelStatus::Error { message: line },
                            },
                        );
                    }
                }
            }
        });
    }

    // Capture stderr for errors
    if let Some(stderr) = child.stderr.take() {
        let instance_id_err = config.instance_id.clone();
        let app_err = app.clone();
        let status_err = status.clone();

        tokio::spawn(async move {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();

            while let Ok(Some(line)) = lines.next_line().await {
                println!("[NGROK STDERR] {}", line);

                // Check for URL in stderr too
                let minecraft_addr = if let Some(captures) = LOGFMT_URL_REGEX.captures(&line) {
                    captures.get(1).map(|m| m.as_str().to_string())
                } else {
                    URL_REGEX
                        .find(&line)
                        .map(|m| m.as_str().trim_start_matches("tcp://").to_string())
                };

                if let Some(minecraft_addr) = minecraft_addr {
                    let mut status = status_err.write().await;
                    if !matches!(*status, TunnelStatus::Connected { .. }) {
                        *status = TunnelStatus::Connected {
                            url: minecraft_addr.clone(),
                        };

                        let _ = app_err.emit(
                            "tunnel-status",
                            TunnelStatusEvent {
                                instance_id: instance_id_err.clone(),
                                provider: "ngrok".to_string(),
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

                // Check for auth errors
                if line.contains("authtoken") || line.contains("ERR_NGROK") {
                    let mut status = status_err.write().await;
                    *status = TunnelStatus::Error {
                        message: line.clone(),
                    };

                    let _ = app_err.emit(
                        "tunnel-status",
                        TunnelStatusEvent {
                            instance_id: instance_id_err.clone(),
                            provider: "ngrok".to_string(),
                            status: TunnelStatus::Error { message: line },
                        },
                    );
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
                provider: "ngrok".to_string(),
                status: TunnelStatus::Disconnected,
            },
        );

        println!("[NGROK] Tunnel process exited");
    });

    Ok(running_tunnel)
}
