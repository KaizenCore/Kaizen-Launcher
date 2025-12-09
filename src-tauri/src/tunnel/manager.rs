use crate::error::{AppError, AppResult};
use crate::state::RunningTunnels;
use crate::tunnel::{
    bore, cloudflare, ngrok, playit, TunnelConfig, TunnelProvider, TunnelStatus, TunnelStatusEvent,
};
use std::path::Path;
use tauri::{AppHandle, Emitter};

/// Start a tunnel for an instance
pub async fn start_tunnel(
    data_dir: &Path,
    config: &TunnelConfig,
    app: &AppHandle,
    running_tunnels: RunningTunnels,
) -> AppResult<()> {
    // Check if tunnel is already running
    {
        let tunnels = running_tunnels.read().await;
        if tunnels.contains_key(&config.instance_id) {
            return Err(AppError::Custom("Tunnel already running".to_string()));
        }
    }

    // Start the appropriate tunnel
    let running_tunnel = match config.provider {
        TunnelProvider::Cloudflare => {
            cloudflare::start_cloudflare_tunnel(data_dir, config, app).await?
        }
        TunnelProvider::Playit => playit::start_playit_tunnel(data_dir, config, app).await?,
        TunnelProvider::Ngrok => ngrok::start_ngrok_tunnel(data_dir, config, app).await?,
        TunnelProvider::Bore => bore::start_bore_tunnel(data_dir, config, app).await?,
    };

    // Store in running tunnels
    {
        let mut tunnels = running_tunnels.write().await;
        tunnels.insert(config.instance_id.clone(), running_tunnel);
    }

    Ok(())
}

/// Stop a tunnel for an instance
pub async fn stop_tunnel(
    instance_id: &str,
    running_tunnels: RunningTunnels,
    app: &AppHandle,
) -> AppResult<()> {
    let tunnel = {
        let mut tunnels = running_tunnels.write().await;
        tunnels.remove(instance_id)
    };

    if let Some(tunnel) = tunnel {
        println!(
            "[TUNNEL] Stopping {} tunnel for instance {}",
            tunnel.provider, instance_id
        );

        // Kill the process
        #[cfg(unix)]
        {
            use std::process::Command;
            let _ = Command::new("kill")
                .args(["-TERM", &tunnel.pid.to_string()])
                .status();
        }

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            use std::process::Command;

            const CREATE_NO_WINDOW: u32 = 0x08000000;
            let mut cmd = Command::new("taskkill");
            cmd.args(["/PID", &tunnel.pid.to_string(), "/F"]);
            cmd.creation_flags(CREATE_NO_WINDOW);
            let _ = cmd.status();
        }

        // Emit disconnected status
        let _ = app.emit(
            "tunnel-status",
            TunnelStatusEvent {
                instance_id: instance_id.to_string(),
                provider: tunnel.provider.to_string(),
                status: TunnelStatus::Disconnected,
            },
        );

        Ok(())
    } else {
        Err(AppError::Custom(
            "No tunnel running for this instance".to_string(),
        ))
    }
}

/// Get tunnel status for an instance
pub async fn get_tunnel_status(instance_id: &str, running_tunnels: RunningTunnels) -> TunnelStatus {
    let tunnels = running_tunnels.read().await;

    if let Some(tunnel) = tunnels.get(instance_id) {
        tunnel.status.read().await.clone()
    } else {
        TunnelStatus::Disconnected
    }
}

/// Check if tunnel is running for an instance
pub async fn is_tunnel_running(instance_id: &str, running_tunnels: RunningTunnels) -> bool {
    let tunnels = running_tunnels.read().await;
    tunnels.contains_key(instance_id)
}

/// Stop all tunnels (for cleanup on app exit)
#[allow(dead_code)]
pub async fn stop_all_tunnels(running_tunnels: RunningTunnels, app: &AppHandle) {
    let instance_ids: Vec<String> = {
        let tunnels = running_tunnels.read().await;
        tunnels.keys().cloned().collect()
    };

    for instance_id in instance_ids {
        let _ = stop_tunnel(&instance_id, running_tunnels.clone(), app).await;
    }
}
