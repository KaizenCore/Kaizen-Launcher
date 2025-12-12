//! Discord integration hooks for the game launcher.
//!
//! This module provides hooks that can be called from the runner to:
//! - Send webhook notifications for server events
//! - Update Discord Rich Presence for game sessions
//! - Parse server logs for player join/leave events

use once_cell::sync::Lazy;
use reqwest::Client;
use sqlx::SqlitePool;
use tracing::debug;

use super::{db, rpc, webhook, DiscordActivity, WebhookEvent};

// Shared HTTP client for webhook requests
static HTTP_CLIENT: Lazy<Client> = Lazy::new(Client::new);

/// Send a webhook notification for server start
pub async fn on_server_started(
    db: &SqlitePool,
    instance_name: &str,
    mc_version: &str,
    loader: Option<&str>,
) {
    let http_client = &*HTTP_CLIENT;
    // Load config
    let config = match db::get_discord_config(db).await {
        Ok(Some(c)) => c,
        _ => return,
    };

    // Check if webhooks are enabled and we have a URL
    if !config.webhook_enabled || config.webhook_url.is_none() {
        return;
    }

    if !config.webhook_server_start {
        return;
    }

    // Safe: we already checked webhook_url.is_none() above
    let Some(webhook_url) = config.webhook_url.as_ref() else {
        return;
    };
    let event = WebhookEvent::ServerStarted {
        instance_name: instance_name.to_string(),
        mc_version: mc_version.to_string(),
        loader: loader.map(|s| s.to_string()),
    };

    // Send webhook (fire and forget, don't block)
    if let Err(e) = webhook::send_event(http_client, webhook_url, &event).await {
        debug!("Failed to send server start webhook: {}", e);
    }
}

/// Send a webhook notification for server stop
pub async fn on_server_stopped(db: &SqlitePool, instance_name: &str, uptime_seconds: i64) {
    let http_client = &*HTTP_CLIENT;
    let config = match db::get_discord_config(db).await {
        Ok(Some(c)) => c,
        _ => return,
    };

    if !config.webhook_enabled || config.webhook_url.is_none() {
        return;
    }

    if !config.webhook_server_stop {
        return;
    }

    // Safe: we already checked webhook_url.is_none() above
    let Some(webhook_url) = config.webhook_url.as_ref() else {
        return;
    };
    let event = WebhookEvent::ServerStopped {
        instance_name: instance_name.to_string(),
        uptime_seconds,
    };

    if let Err(e) = webhook::send_event(http_client, webhook_url, &event).await {
        debug!("Failed to send server stop webhook: {}", e);
    }
}

/// Send a webhook notification for player join
pub async fn on_player_joined(db: &SqlitePool, instance_name: &str, player_name: &str) {
    debug!(
        "on_player_joined called: {} on {}",
        player_name, instance_name
    );
    let http_client = &*HTTP_CLIENT;
    let config = match db::get_discord_config(db).await {
        Ok(Some(c)) => c,
        _ => {
            debug!("No config found");
            return;
        }
    };

    if !config.webhook_enabled || config.webhook_url.is_none() {
        debug!("Webhooks disabled or no URL");
        return;
    }

    if !config.webhook_player_join {
        debug!("Player join webhook disabled");
        return;
    }

    // Safe: we already checked webhook_url.is_none() above
    let Some(webhook_url) = config.webhook_url.as_ref() else {
        return;
    };
    debug!("Sending player join webhook to: {}", webhook_url);
    let event = WebhookEvent::PlayerJoined {
        instance_name: instance_name.to_string(),
        player_name: player_name.to_string(),
    };

    if let Err(e) = webhook::send_event(http_client, webhook_url, &event).await {
        debug!("Failed to send player join webhook: {}", e);
    } else {
        debug!("Player join webhook sent successfully");
    }
}

/// Send a webhook notification for player leave
pub async fn on_player_left(db: &SqlitePool, instance_name: &str, player_name: &str) {
    debug!(
        "on_player_left called: {} on {}",
        player_name, instance_name
    );
    let http_client = &*HTTP_CLIENT;
    let config = match db::get_discord_config(db).await {
        Ok(Some(c)) => c,
        _ => {
            debug!("No config found");
            return;
        }
    };

    if !config.webhook_enabled || config.webhook_url.is_none() {
        debug!("Webhooks disabled or no URL");
        return;
    }

    if !config.webhook_player_leave {
        debug!("Player leave webhook disabled");
        return;
    }

    // Safe: we already checked webhook_url.is_none() above
    let Some(webhook_url) = config.webhook_url.as_ref() else {
        return;
    };
    debug!("Sending player leave webhook to: {}", webhook_url);
    let event = WebhookEvent::PlayerLeft {
        instance_name: instance_name.to_string(),
        player_name: player_name.to_string(),
    };

    if let Err(e) = webhook::send_event(http_client, webhook_url, &event).await {
        debug!("Failed to send player leave webhook: {}", e);
    } else {
        debug!("Player leave webhook sent successfully");
    }
}

/// Send a webhook notification for backup created
#[allow(dead_code)]
pub async fn on_backup_created(
    db: &SqlitePool,
    instance_name: &str,
    world_name: &str,
    filename: &str,
) {
    let http_client = &*HTTP_CLIENT;
    let config = match db::get_discord_config(db).await {
        Ok(Some(c)) => c,
        _ => return,
    };

    if !config.webhook_enabled || config.webhook_url.is_none() {
        return;
    }

    if !config.webhook_backup_created {
        return;
    }

    // Safe: we already checked webhook_url.is_none() above
    let Some(webhook_url) = config.webhook_url.as_ref() else {
        return;
    };
    let event = WebhookEvent::BackupCreated {
        instance_name: instance_name.to_string(),
        world_name: world_name.to_string(),
        filename: filename.to_string(),
    };

    if let Err(e) = webhook::send_event(http_client, webhook_url, &event).await {
        debug!("Failed to send backup webhook: {}", e);
    }
}

/// Set Discord Rich Presence to Idle (launcher open, no game running)
/// Uses a persistent global connection that stays open
/// Single attempt only - no retry loop to prevent CPU spikes
pub async fn set_idle_activity(db: &SqlitePool) {
    debug!("set_idle_activity called");

    let config = match db::get_discord_config(db).await {
        Ok(Some(c)) => c,
        Ok(None) => {
            debug!("No config found in database");
            return;
        }
        Err(e) => {
            debug!("Error getting config: {}", e);
            return;
        }
    };

    if !config.rpc_enabled {
        debug!("RPC is disabled in settings");
        return;
    }

    // Run blocking IPC operations in spawn_blocking to prevent blocking the async runtime
    let result = tokio::task::spawn_blocking(|| {
        rpc::connect()?;
        rpc::set_activity(&DiscordActivity::Idle)
    })
    .await;

    match result {
        Ok(Ok(_)) => debug!("Idle activity set successfully"),
        Ok(Err(e)) => debug!("Failed to set idle activity: {}", e),
        Err(e) => debug!("Task join error: {}", e),
    }
}

/// Set Discord Rich Presence for playing Minecraft client
/// Uses persistent global connection
pub async fn set_playing_activity(
    db: &SqlitePool,
    instance_name: &str,
    mc_version: &str,
    loader: Option<&str>,
) {
    debug!("set_playing_activity called for: {}", instance_name);

    let config = match db::get_discord_config(db).await {
        Ok(Some(c)) => c,
        Ok(None) => {
            debug!("No config found in database");
            return;
        }
        Err(e) => {
            debug!("Error getting config: {}", e);
            return;
        }
    };

    if !config.rpc_enabled {
        debug!("RPC is disabled in settings");
        return;
    }

    let activity = DiscordActivity::Playing {
        instance_name: if config.rpc_show_instance_name {
            instance_name.to_string()
        } else {
            "Minecraft".to_string()
        },
        mc_version: if config.rpc_show_version {
            mc_version.to_string()
        } else {
            String::new()
        },
        loader: if config.rpc_show_modloader {
            loader.map(|s| s.to_string())
        } else {
            None
        },
        start_time: chrono::Utc::now().timestamp(),
    };

    // Run blocking IPC operations in spawn_blocking to prevent blocking the async runtime
    let result = tokio::task::spawn_blocking(move || {
        rpc::connect()?;
        rpc::set_activity(&activity)
    })
    .await;

    match result {
        Ok(Ok(_)) => debug!("Activity set successfully"),
        Ok(Err(e)) => debug!("Failed to set activity: {}", e),
        Err(e) => debug!("Task join error: {}", e),
    }
}

/// Set Discord Rich Presence for hosting a server
/// Uses persistent global connection
#[allow(dead_code)]
pub async fn set_hosting_activity(
    db: &SqlitePool,
    instance_name: &str,
    mc_version: &str,
    tunnel_url: Option<&str>,
) {
    let config = match db::get_discord_config(db).await {
        Ok(Some(c)) => c,
        _ => return,
    };

    if !config.rpc_enabled {
        return;
    }

    let activity = DiscordActivity::Hosting {
        instance_name: if config.rpc_show_instance_name {
            instance_name.to_string()
        } else {
            "Minecraft Server".to_string()
        },
        mc_version: if config.rpc_show_version {
            mc_version.to_string()
        } else {
            String::new()
        },
        player_count: None,
        tunnel_url: tunnel_url.map(|s| s.to_string()),
        start_time: chrono::Utc::now().timestamp(),
    };

    // Run blocking IPC operations in spawn_blocking to prevent blocking the async runtime
    let _ = tokio::task::spawn_blocking(move || {
        rpc::connect()?;
        rpc::set_activity(&activity)
    })
    .await;
}

/// Clear Discord Rich Presence and return to Idle state
/// Uses persistent global connection
pub async fn clear_activity(db: &SqlitePool) {
    let config = match db::get_discord_config(db).await {
        Ok(Some(c)) => c,
        _ => return,
    };

    if !config.rpc_enabled {
        return;
    }

    // Instead of clearing, return to Idle state
    if rpc::is_connected() {
        // Run blocking IPC operations in spawn_blocking to prevent blocking the async runtime
        let _ = tokio::task::spawn_blocking(|| rpc::set_activity(&DiscordActivity::Idle)).await;
        debug!("Returned to Idle state");
    }
}

/// Strip ANSI escape codes from a string
fn strip_ansi_codes(s: &str) -> String {
    // Match ANSI escape sequences: ESC[ followed by params and a letter
    let mut result = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();

    while let Some(c) = chars.next() {
        if c == '\x1b' {
            // Start of escape sequence
            if chars.peek() == Some(&'[') {
                chars.next(); // consume '['
                              // Skip until we find a letter (the command)
                while let Some(&next) = chars.peek() {
                    chars.next();
                    if next.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
        } else {
            result.push(c);
        }
    }
    result
}

/// Parse a server log line and detect player join/leave events
/// Returns Some((event_type, player_name)) if detected
pub fn parse_player_event(log_line: &str) -> Option<(&'static str, String)> {
    // Strip ANSI color codes first (Paper/Spigot often include colors)
    let clean_line = strip_ansi_codes(log_line);

    // Common log formats:
    // Paper/Spigot: [14:30:45 INFO]: PlayerName joined the game
    // Vanilla: [Server thread/INFO]: PlayerName joined the game
    // Fabric: [14:30:45] [Server thread/INFO]: PlayerName joined the game

    let (event_type, keyword) = if clean_line.contains("joined the game") {
        ("join", "joined the game")
    } else if clean_line.contains("left the game") {
        ("leave", "left the game")
    } else {
        return None;
    };

    // Find the keyword position in the clean line
    let idx = clean_line.find(keyword)?;
    let before = &clean_line[..idx];

    // Extract player name - find the part after "]: " and before the keyword
    // Pattern: "...]: PlayerName joined/left the game"
    if let Some(bracket_idx) = before.rfind("]: ") {
        let player = before[bracket_idx + 3..].trim();
        if !player.is_empty() && is_valid_player_name(player) {
            debug!("Detected player {}: {}", event_type, player);
            return Some((event_type, player.to_string()));
        }
    }

    // Fallback: just get the last word before the keyword
    let trimmed = before.trim();
    if let Some(space_idx) = trimmed.rfind(' ') {
        let player = trimmed[space_idx + 1..].trim();
        if !player.is_empty() && is_valid_player_name(player) {
            debug!("Detected player {}: {}", event_type, player);
            return Some((event_type, player.to_string()));
        }
    }

    None
}

/// Check if a string looks like a valid Minecraft player name
fn is_valid_player_name(name: &str) -> bool {
    // Valid MC names: 3-16 chars, alphanumeric + underscore
    !name.is_empty()
        && name.len() <= 16
        && !name.contains(':')
        && !name.contains('[')
        && !name.contains(']')
        && !name.contains('<')
        && !name.contains('>')
        && !name.contains('/')
}
