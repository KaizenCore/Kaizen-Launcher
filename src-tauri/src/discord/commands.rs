use tauri::State;

use crate::error::AppResult;
use crate::state::SharedState;

use super::{db, rpc, webhook, DiscordConfig, InstanceWebhookConfig};

/// Get the global Discord configuration
#[tauri::command]
pub async fn get_discord_config(state: State<'_, SharedState>) -> AppResult<DiscordConfig> {
    let state = state.read().await;
    let config = db::get_discord_config(&state.db).await?;
    Ok(config.unwrap_or_default())
}

/// Save the global Discord configuration
#[tauri::command]
pub async fn save_discord_config(
    state: State<'_, SharedState>,
    config: DiscordConfig,
) -> AppResult<()> {
    let state = state.read().await;
    db::save_discord_config(&state.db, &config).await?;
    Ok(())
}

/// Test Discord Rich Presence connection
#[tauri::command]
pub async fn test_discord_rpc() -> AppResult<String> {
    // Run blocking IPC operations in a separate thread
    tokio::task::spawn_blocking(|| rpc::test_connection())
        .await
        .map_err(|e| crate::error::AppError::Discord(format!("Task join error: {}", e)))??;
    Ok("Discord Rich Presence is working!".to_string())
}

/// Test Discord Webhook
#[tauri::command]
pub async fn test_discord_webhook(
    state: State<'_, SharedState>,
    webhook_url: String,
) -> AppResult<String> {
    let state = state.read().await;
    webhook::send_test_message(&state.http_client, &webhook_url).await?;
    Ok("Webhook test message sent!".to_string())
}

/// Get webhook configuration for a specific instance
#[tauri::command]
pub async fn get_instance_webhook_config(
    state: State<'_, SharedState>,
    instance_id: String,
) -> AppResult<Option<InstanceWebhookConfig>> {
    let state = state.read().await;
    let config = db::get_instance_webhook_config(&state.db, &instance_id).await?;
    Ok(config)
}

/// Save webhook configuration for a specific instance
#[tauri::command]
pub async fn save_instance_webhook_config(
    state: State<'_, SharedState>,
    config: InstanceWebhookConfig,
) -> AppResult<()> {
    let state = state.read().await;
    db::save_instance_webhook_config(&state.db, &config).await?;
    Ok(())
}

/// Delete webhook configuration for a specific instance
#[tauri::command]
pub async fn delete_instance_webhook_config(
    state: State<'_, SharedState>,
    instance_id: String,
) -> AppResult<()> {
    let state = state.read().await;
    db::delete_instance_webhook_config(&state.db, &instance_id).await?;
    Ok(())
}
