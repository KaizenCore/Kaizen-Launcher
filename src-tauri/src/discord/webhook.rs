use reqwest::Client;
use serde::Serialize;

use crate::error::{AppError, AppResult};

use super::WebhookEvent;

// Embed colors
const COLOR_GREEN: u32 = 0x22c55e;
const COLOR_RED: u32 = 0xef4444;
const COLOR_BLUE: u32 = 0x3b82f6;
const COLOR_ORANGE: u32 = 0xf97316;

// Kaizen Launcher avatar URL (using GitHub raw)
const AVATAR_URL: &str =
    "https://raw.githubusercontent.com/KaizenCore/Kaizen-Launcher/main/src-tauri/icons/icon.png";

#[derive(Serialize)]
struct WebhookPayload {
    username: String,
    avatar_url: String,
    embeds: Vec<WebhookEmbed>,
}

#[derive(Serialize)]
struct WebhookEmbed {
    title: String,
    description: String,
    color: u32,
    timestamp: String,
    footer: WebhookFooter,
    #[serde(skip_serializing_if = "Option::is_none")]
    thumbnail: Option<WebhookThumbnail>,
}

#[derive(Serialize)]
struct WebhookFooter {
    text: String,
}

#[derive(Serialize)]
struct WebhookThumbnail {
    url: String,
}

/// Send a webhook event to Discord
pub async fn send_event(client: &Client, webhook_url: &str, event: &WebhookEvent) -> AppResult<()> {
    let (title, description, color) = match event {
        WebhookEvent::ServerStarted {
            instance_name,
            mc_version,
            loader,
        } => {
            let loader_str = loader
                .as_ref()
                .map(|l| format!(" ({})", l))
                .unwrap_or_default();
            (
                "🟢 Server Started".to_string(),
                format!(
                    "**Instance:** {}\n**Version:** {}{}",
                    instance_name, mc_version, loader_str
                ),
                COLOR_GREEN,
            )
        }
        WebhookEvent::ServerStopped {
            instance_name,
            uptime_seconds,
        } => {
            let uptime = format_duration(*uptime_seconds);
            (
                "🔴 Server Stopped".to_string(),
                format!("**Instance:** {}\n**Uptime:** {}", instance_name, uptime),
                COLOR_RED,
            )
        }
        WebhookEvent::BackupCreated {
            instance_name,
            world_name,
            filename,
        } => (
            "💾 Backup Created".to_string(),
            format!(
                "**Instance:** {}\n**World:** {}\n**File:** {}",
                instance_name, world_name, filename
            ),
            COLOR_BLUE,
        ),
        WebhookEvent::PlayerJoined {
            instance_name,
            player_name,
        } => (
            "👋 Player Joined".to_string(),
            format!("**{}** joined **{}**", player_name, instance_name),
            COLOR_GREEN,
        ),
        WebhookEvent::PlayerLeft {
            instance_name,
            player_name,
        } => (
            "👋 Player Left".to_string(),
            format!("**{}** left **{}**", player_name, instance_name),
            COLOR_ORANGE,
        ),
    };

    let payload = WebhookPayload {
        username: "Kaizen Launcher".to_string(),
        avatar_url: AVATAR_URL.to_string(),
        embeds: vec![WebhookEmbed {
            title,
            description,
            color,
            timestamp: chrono::Utc::now().to_rfc3339(),
            footer: WebhookFooter {
                text: "Kaizen Launcher".to_string(),
            },
            thumbnail: None,
        }],
    };

    let response = client.post(webhook_url).json(&payload).send().await?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::Discord(format!(
            "Webhook failed with status {}: {}",
            status, body
        )));
    }

    Ok(())
}

/// Send a test message to verify webhook configuration
pub async fn send_test_message(client: &Client, webhook_url: &str) -> AppResult<()> {
    let payload = WebhookPayload {
        username: "Kaizen Launcher".to_string(),
        avatar_url: AVATAR_URL.to_string(),
        embeds: vec![WebhookEmbed {
            title: "✅ Webhook Test".to_string(),
            description: "Your Discord webhook is configured correctly!".to_string(),
            color: COLOR_GREEN,
            timestamp: chrono::Utc::now().to_rfc3339(),
            footer: WebhookFooter {
                text: "Kaizen Launcher".to_string(),
            },
            thumbnail: None,
        }],
    };

    let response = client.post(webhook_url).json(&payload).send().await?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::Discord(format!(
            "Webhook test failed with status {}: {}",
            status, body
        )));
    }

    Ok(())
}

/// Format seconds into human-readable duration
fn format_duration(seconds: i64) -> String {
    let hours = seconds / 3600;
    let minutes = (seconds % 3600) / 60;
    let secs = seconds % 60;

    if hours > 0 {
        format!("{}h {}m {}s", hours, minutes, secs)
    } else if minutes > 0 {
        format!("{}m {}s", minutes, secs)
    } else {
        format!("{}s", secs)
    }
}
