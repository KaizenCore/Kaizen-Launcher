use std::io::{Read, Write};
use std::sync::Mutex;

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tracing::debug;

use crate::error::{AppError, AppResult};

use super::DiscordActivity;

// Discord Application ID for Kaizen Launcher
const DISCORD_APP_ID: &str = "1448675122536911013";

/// Global persistent Discord RPC connection
/// The connection MUST stay open for the activity to persist
static DISCORD_CONNECTION: Lazy<Mutex<Option<DiscordConnection>>> =
    Lazy::new(|| Mutex::new(None));

#[cfg(unix)]
struct DiscordConnection {
    stream: std::os::unix::net::UnixStream,
}

#[cfg(windows)]
struct DiscordConnection {
    // Windows named pipe handle would go here
    _handle: (),
}

#[derive(Serialize)]
struct RpcPayload {
    cmd: String,
    args: serde_json::Value,
    nonce: String,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct RpcResponse {
    cmd: String,
    data: Option<serde_json::Value>,
    evt: Option<String>,
}

/// Connect to Discord IPC and keep connection alive
pub fn connect() -> AppResult<()> {
    let mut conn_guard = DISCORD_CONNECTION
        .lock()
        .map_err(|e| AppError::Discord(format!("Lock error: {}", e)))?;

    // Already connected
    if conn_guard.is_some() {
        return Ok(());
    }

    #[cfg(unix)]
    {
        use std::os::unix::net::UnixStream;

        // Find Discord IPC socket
        let tmpdir = std::env::var("TMPDIR")
            .or_else(|_| std::env::var("XDG_RUNTIME_DIR"))
            .unwrap_or_else(|_| "/tmp".to_string());

        let mut socket_path = None;
        for i in 0..10 {
            let path = format!("{}/discord-ipc-{}", tmpdir, i);
            if std::path::Path::new(&path).exists() {
                socket_path = Some(path);
                break;
            }
        }

        let socket_path = socket_path.ok_or_else(|| {
            AppError::Discord("Discord IPC socket not found. Is Discord running?".to_string())
        })?;

        debug!("Connecting to socket: {}", socket_path);

        let mut stream = UnixStream::connect(&socket_path)
            .map_err(|e| AppError::Discord(format!("Failed to connect to Discord: {}", e)))?;

        // Send handshake (opcode 0)
        let handshake = json!({
            "v": 1,
            "client_id": DISCORD_APP_ID
        });
        let payload = serde_json::to_vec(&handshake)?;

        let mut header = Vec::new();
        header.extend_from_slice(&0u32.to_le_bytes()); // opcode 0 = handshake
        header.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        stream.write_all(&header)?;
        stream.write_all(&payload)?;

        // Read handshake response
        let mut response_header = [0u8; 8];
        stream.read_exact(&mut response_header)?;
        let length = u32::from_le_bytes([
            response_header[4],
            response_header[5],
            response_header[6],
            response_header[7],
        ]);

        let mut response_data = vec![0u8; length as usize];
        stream.read_exact(&mut response_data)?;

        if let Ok(response_str) = String::from_utf8(response_data) {
            debug!("Handshake response: {}", response_str);
        }

        *conn_guard = Some(DiscordConnection { stream });
        debug!("Connected and handshake complete!");
    }

    #[cfg(windows)]
    {
        // Windows implementation would use named pipes
        // For now, mark as not supported
        return Err(AppError::Discord(
            "Windows Discord RPC not yet implemented".to_string(),
        ));
    }

    Ok(())
}

/// Check if connected to Discord
pub fn is_connected() -> bool {
    DISCORD_CONNECTION
        .lock()
        .map(|guard| guard.is_some())
        .unwrap_or(false)
}

/// Disconnect from Discord (clears activity)
#[allow(dead_code)]
pub fn disconnect() {
    if let Ok(mut guard) = DISCORD_CONNECTION.lock() {
        *guard = None;
        debug!("Disconnected");
    }
}

/// Set Discord Rich Presence activity
pub fn set_activity(activity: &DiscordActivity) -> AppResult<()> {
    let mut conn_guard = DISCORD_CONNECTION
        .lock()
        .map_err(|e| AppError::Discord(format!("Lock error: {}", e)))?;

    let conn = conn_guard.as_mut().ok_or_else(|| {
        AppError::Discord("Not connected to Discord. Call connect() first.".to_string())
    })?;

    let presence = match activity {
        DiscordActivity::Idle => json!({
            "state": "Browsing instances...",
            "details": "In Kaizen Launcher",
            "timestamps": {
                "start": chrono::Utc::now().timestamp() * 1000
            },
            "assets": {
                "large_image": "kaizen_logo",
                "large_text": "Kaizen Launcher"
            }
        }),
        DiscordActivity::Playing {
            instance_name,
            mc_version,
            loader,
            start_time,
        } => {
            let details = if let Some(l) = loader {
                format!("{} with {}", mc_version, l)
            } else {
                mc_version.clone()
            };
            json!({
                "state": format!("Instance: {}", instance_name),
                "details": format!("Playing Minecraft {}", details),
                "timestamps": {
                    "start": start_time * 1000
                },
                "assets": {
                    "large_image": "kaizen_logo",
                    "large_text": "Kaizen Launcher",
                    "small_image": "minecraft",
                    "small_text": "Minecraft"
                }
            })
        }
        DiscordActivity::Hosting {
            instance_name,
            mc_version,
            player_count,
            tunnel_url,
            start_time,
        } => {
            let state = if let Some(count) = player_count {
                format!("{} players online", count)
            } else {
                format!("Instance: {}", instance_name)
            };

            let mut presence = json!({
                "state": state,
                "details": format!("Hosting Minecraft Server {}", mc_version),
                "timestamps": {
                    "start": start_time * 1000
                },
                "assets": {
                    "large_image": "kaizen_logo",
                    "large_text": "Kaizen Launcher",
                    "small_image": "minecraft",
                    "small_text": "Minecraft Server"
                }
            });

            // Add join button if tunnel URL is available
            if let Some(url) = tunnel_url {
                presence["buttons"] = json!([{
                    "label": "Join Server",
                    "url": url
                }]);
            }

            presence
        }
    };

    send_activity_internal(conn, presence)?;
    Ok(())
}

/// Clear Discord Rich Presence (set to null activity)
#[allow(dead_code)]
pub fn clear_activity() -> AppResult<()> {
    let mut conn_guard = DISCORD_CONNECTION
        .lock()
        .map_err(|e| AppError::Discord(format!("Lock error: {}", e)))?;

    if let Some(conn) = conn_guard.as_mut() {
        send_activity_internal(conn, json!(null))?;
    }
    Ok(())
}

/// Internal function to send activity on existing connection
#[cfg(unix)]
fn send_activity_internal(
    conn: &mut DiscordConnection,
    activity: serde_json::Value,
) -> AppResult<()> {
    let payload = RpcPayload {
        cmd: "SET_ACTIVITY".to_string(),
        args: json!({
            "pid": std::process::id(),
            "activity": activity
        }),
        nonce: uuid::Uuid::new_v4().to_string(),
    };

    let payload_bytes = serde_json::to_vec(&payload)?;

    let mut header = Vec::new();
    header.extend_from_slice(&1u32.to_le_bytes()); // opcode 1 = frame
    header.extend_from_slice(&(payload_bytes.len() as u32).to_le_bytes());

    conn.stream.write_all(&header)?;
    conn.stream.write_all(&payload_bytes)?;

    // Read response
    let mut response_header = [0u8; 8];
    conn.stream.read_exact(&mut response_header)?;
    let opcode = u32::from_le_bytes([
        response_header[0],
        response_header[1],
        response_header[2],
        response_header[3],
    ]);
    let length = u32::from_le_bytes([
        response_header[4],
        response_header[5],
        response_header[6],
        response_header[7],
    ]);

    let mut response_data = vec![0u8; length as usize];
    conn.stream.read_exact(&mut response_data)?;

    if let Ok(response_str) = String::from_utf8(response_data) {
        debug!("Response (opcode {}): {}", opcode, response_str);
    }

    Ok(())
}

#[cfg(windows)]
fn send_activity_internal(
    _conn: &mut DiscordConnection,
    _activity: serde_json::Value,
) -> AppResult<()> {
    Ok(())
}

/// Test Discord RPC connection
pub fn test_connection() -> AppResult<()> {
    // Try to connect
    connect()?;

    // Set idle activity to test
    set_activity(&DiscordActivity::Idle)?;

    Ok(())
}
