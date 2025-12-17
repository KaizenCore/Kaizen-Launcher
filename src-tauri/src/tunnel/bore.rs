use crate::error::{AppError, AppResult};
use crate::state::SharedState;
use crate::tunnel::{
    agent::get_agent_binary_path,
    health::{find_available_bore_server, get_default_bore_servers},
    RunningTunnel, TunnelConfig, TunnelProvider, TunnelStatus, TunnelStatusEvent, TunnelUrlEvent,
};
use once_cell::sync::Lazy;
use regex::Regex;
use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::RwLock;
use tracing::{debug, info, warn};

// Windows-specific: CREATE_NO_WINDOW flag to hide console window
#[cfg(target_os = "windows")]
#[allow(unused_imports)]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
#[allow(dead_code)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

// Pre-compiled regex patterns for bore output parsing
static URL_REGEX: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"listening at ([a-zA-Z0-9.-]+:\d+)").expect("Invalid bore URL regex"));
// Match any bore server hostname with port (e.g., bore.pub:12345, bore.digital:54321)
static HOST_PORT_REGEX: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"([a-zA-Z0-9.-]+:\d+)").expect("Invalid bore host:port regex"));

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

    info!(
        "[BORE] Starting TCP tunnel for port {}...",
        config.target_port
    );

    // Get list of bore servers to try (from config or defaults)
    let servers = config
        .bore_servers
        .clone()
        .unwrap_or_else(get_default_bore_servers);

    if servers.is_empty() {
        return Err(AppError::Custom(
            "No bore servers configured".to_string(),
        ));
    }

    info!("[BORE] Checking {} bore servers for availability...", servers.len());

    // Find an available server (10s timeout, 3 retries per server)
    let available_server = find_available_bore_server(&servers, 10, 3).await;

    let bore_server = match available_server {
        Some(server) => {
            info!("[BORE] Using available server: {}", server);
            server
        }
        None => {
            warn!("[BORE] No available servers found, trying first server anyway: {}", servers[0]);
            servers[0].clone()
        }
    };

    // Start bore tunnel
    // bore local <PORT> --to <SERVER> --local-host 127.0.0.1
    // We explicitly use 127.0.0.1 instead of localhost to avoid IPv6 resolution issues on Windows
    let mut cmd = Command::new(&binary_path);
    cmd.args([
        "local",
        &config.target_port.to_string(),
        "--to",
        &bore_server,
        "--local-host",
        "127.0.0.1",
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
        .map_err(|e| AppError::Io(format!("Failed to start bore: {}", e)))?;

    let pid = child.id().unwrap_or(0);
    info!("[BORE] Started with PID: {}", pid);

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
                // Yield to prevent busy spinning
                tokio::task::yield_now().await;
                debug!("[BORE] {}", line);

                // Check for URL in the line
                let found_url = if let Some(captures) = URL_REGEX.captures(&line) {
                    captures.get(1).map(|m| m.as_str().to_string())
                } else {
                    HOST_PORT_REGEX.find(&line).map(|m| m.as_str().to_string())
                };

                if let Some(minecraft_addr) = found_url {
                    info!("[BORE] Found tunnel URL: {}", minecraft_addr);

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
                            url: minecraft_addr.clone(),
                        },
                    );

                    // Save URL to database for persistence
                    let state: tauri::State<SharedState> = app_handle.state();
                    let db = {
                        let s = state.read().await;
                        s.db.clone()
                    };
                    let instance_id_for_save = instance_id.clone();
                    let url_for_save = minecraft_addr;
                    let _ = sqlx::query(
                        "UPDATE tunnel_configs SET tunnel_url = ? WHERE instance_id = ?",
                    )
                    .bind(&url_for_save)
                    .bind(&instance_id_for_save)
                    .execute(&db)
                    .await;
                    tracing::info!(
                        "Saved tunnel URL {} for instance {}",
                        url_for_save,
                        instance_id_for_save
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
                // Yield to prevent busy spinning
                tokio::task::yield_now().await;
                debug!("[BORE STDERR] {}", line);

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

        info!("[BORE] Tunnel process exited");
    });

    Ok(running_tunnel)
}
