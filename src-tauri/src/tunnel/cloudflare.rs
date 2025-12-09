use crate::error::{AppError, AppResult};
use crate::tunnel::{
    agent::get_agent_binary_path, RunningTunnel, TunnelConfig, TunnelProvider, TunnelStatus,
    TunnelStatusEvent,
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

// Pre-compiled regex pattern for cloudflare URL parsing
static URL_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com").expect("Invalid cloudflare URL regex")
});

/// Start a Cloudflare quick tunnel
pub async fn start_cloudflare_tunnel(
    data_dir: &Path,
    config: &TunnelConfig,
    app: &AppHandle,
) -> AppResult<RunningTunnel> {
    let binary_path = get_agent_binary_path(data_dir, TunnelProvider::Cloudflare);

    if !binary_path.exists() {
        return Err(AppError::Custom(
            "Cloudflare agent not installed".to_string(),
        ));
    }

    println!(
        "[CLOUDFLARE] Starting tunnel for port {}...",
        config.target_port
    );

    // Start cloudflared with quick tunnel
    // cloudflared tunnel --url localhost:PORT
    let mut cmd = Command::new(&binary_path);
    cmd.args([
        "tunnel",
        "--url",
        &format!("tcp://localhost:{}", config.target_port),
    ])
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Io(format!("Failed to start cloudflared: {}", e)))?;

    let pid = child.id().unwrap_or(0);
    println!("[CLOUDFLARE] Started with PID: {}", pid);

    let status = Arc::new(RwLock::new(TunnelStatus::Connecting));

    let running_tunnel = RunningTunnel {
        instance_id: config.instance_id.clone(),
        provider: TunnelProvider::Cloudflare,
        pid,
        status: status.clone(),
    };

    // Emit connecting status
    let _ = app.emit(
        "tunnel-status",
        TunnelStatusEvent {
            instance_id: config.instance_id.clone(),
            provider: "cloudflare".to_string(),
            status: TunnelStatus::Connecting,
        },
    );

    // Spawn task to monitor output and find URL
    let instance_id = config.instance_id.clone();
    let app_handle = app.clone();
    let status_clone = status.clone();

    // Cloudflare outputs URL to stderr
    if let Some(stderr) = child.stderr.take() {
        tokio::spawn(async move {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();

            while let Ok(Some(line)) = lines.next_line().await {
                println!("[CLOUDFLARE] {}", line);

                // Check for URL in the line
                if let Some(captures) = URL_REGEX.find(&line) {
                    let url = captures.as_str().to_string();
                    println!("[CLOUDFLARE] Found tunnel URL: {}", url);

                    // Update status
                    {
                        let mut status = status_clone.write().await;
                        *status = TunnelStatus::Connected { url: url.clone() };
                    }

                    // Emit connected status with URL
                    let _ = app_handle.emit(
                        "tunnel-status",
                        TunnelStatusEvent {
                            instance_id: instance_id.clone(),
                            provider: "cloudflare".to_string(),
                            status: TunnelStatus::Connected { url: url.clone() },
                        },
                    );

                    // Also emit the URL separately for easy access
                    let _ = app_handle.emit(
                        "tunnel-url",
                        crate::tunnel::TunnelUrlEvent {
                            instance_id: instance_id.clone(),
                            url,
                        },
                    );
                }

                // Check for errors
                if line.contains("error") || line.contains("failed") {
                    let mut status = status_clone.write().await;
                    if matches!(*status, TunnelStatus::Connecting) {
                        *status = TunnelStatus::Error {
                            message: line.clone(),
                        };

                        let _ = app_handle.emit(
                            "tunnel-status",
                            TunnelStatusEvent {
                                instance_id: instance_id.clone(),
                                provider: "cloudflare".to_string(),
                                status: TunnelStatus::Error { message: line },
                            },
                        );
                    }
                }
            }
        });
    }

    // Also capture stdout
    if let Some(stdout) = child.stdout.take() {
        tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                println!("[CLOUDFLARE STDOUT] {}", line);
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
                provider: "cloudflare".to_string(),
                status: TunnelStatus::Disconnected,
            },
        );

        println!("[CLOUDFLARE] Tunnel process exited");
    });

    Ok(running_tunnel)
}
