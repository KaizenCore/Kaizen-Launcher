use sqlx::SqlitePool;

use super::{DiscordConfig, InstanceWebhookConfig};

/// Get the global Discord configuration
pub async fn get_discord_config(db: &SqlitePool) -> sqlx::Result<Option<DiscordConfig>> {
    let row = sqlx::query_as::<_, (
        i32, i32, i32, i32, i32, // RPC settings
        i32, Option<String>, i32, i32, i32, i32, i32, // Webhook settings
    )>(
        r#"
        SELECT
            rpc_enabled, rpc_show_instance_name, rpc_show_version, rpc_show_playtime, rpc_show_modloader,
            webhook_enabled, webhook_url, webhook_server_start, webhook_server_stop,
            webhook_backup_created, webhook_player_join, webhook_player_leave
        FROM discord_config
        WHERE id = 'global'
        "#,
    )
    .fetch_optional(db)
    .await?;

    Ok(row.map(|r| DiscordConfig {
        rpc_enabled: r.0 != 0,
        rpc_show_instance_name: r.1 != 0,
        rpc_show_version: r.2 != 0,
        rpc_show_playtime: r.3 != 0,
        rpc_show_modloader: r.4 != 0,
        webhook_enabled: r.5 != 0,
        webhook_url: r.6,
        webhook_server_start: r.7 != 0,
        webhook_server_stop: r.8 != 0,
        webhook_backup_created: r.9 != 0,
        webhook_player_join: r.10 != 0,
        webhook_player_leave: r.11 != 0,
    }))
}

/// Save the global Discord configuration
pub async fn save_discord_config(db: &SqlitePool, config: &DiscordConfig) -> sqlx::Result<()> {
    sqlx::query(
        r#"
        INSERT INTO discord_config (
            id, rpc_enabled, rpc_show_instance_name, rpc_show_version, rpc_show_playtime, rpc_show_modloader,
            webhook_enabled, webhook_url, webhook_server_start, webhook_server_stop,
            webhook_backup_created, webhook_player_join, webhook_player_leave, updated_at
        ) VALUES (
            'global', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now')
        )
        ON CONFLICT(id) DO UPDATE SET
            rpc_enabled = excluded.rpc_enabled,
            rpc_show_instance_name = excluded.rpc_show_instance_name,
            rpc_show_version = excluded.rpc_show_version,
            rpc_show_playtime = excluded.rpc_show_playtime,
            rpc_show_modloader = excluded.rpc_show_modloader,
            webhook_enabled = excluded.webhook_enabled,
            webhook_url = excluded.webhook_url,
            webhook_server_start = excluded.webhook_server_start,
            webhook_server_stop = excluded.webhook_server_stop,
            webhook_backup_created = excluded.webhook_backup_created,
            webhook_player_join = excluded.webhook_player_join,
            webhook_player_leave = excluded.webhook_player_leave,
            updated_at = excluded.updated_at
        "#,
    )
    .bind(config.rpc_enabled as i32)
    .bind(config.rpc_show_instance_name as i32)
    .bind(config.rpc_show_version as i32)
    .bind(config.rpc_show_playtime as i32)
    .bind(config.rpc_show_modloader as i32)
    .bind(config.webhook_enabled as i32)
    .bind(&config.webhook_url)
    .bind(config.webhook_server_start as i32)
    .bind(config.webhook_server_stop as i32)
    .bind(config.webhook_backup_created as i32)
    .bind(config.webhook_player_join as i32)
    .bind(config.webhook_player_leave as i32)
    .execute(db)
    .await?;

    Ok(())
}

/// Get webhook configuration for a specific instance
pub async fn get_instance_webhook_config(
    db: &SqlitePool,
    instance_id: &str,
) -> sqlx::Result<Option<InstanceWebhookConfig>> {
    let row = sqlx::query_as::<_, (String, Option<String>, i32, i32, i32, i32, i32)>(
        r#"
        SELECT instance_id, webhook_url, enabled, server_start, server_stop, player_join, player_leave
        FROM instance_webhook_config
        WHERE instance_id = ?
        "#,
    )
    .bind(instance_id)
    .fetch_optional(db)
    .await?;

    Ok(row.map(|r| InstanceWebhookConfig {
        instance_id: r.0,
        webhook_url: r.1,
        enabled: r.2 != 0,
        server_start: r.3 != 0,
        server_stop: r.4 != 0,
        player_join: r.5 != 0,
        player_leave: r.6 != 0,
    }))
}

/// Save webhook configuration for a specific instance
pub async fn save_instance_webhook_config(
    db: &SqlitePool,
    config: &InstanceWebhookConfig,
) -> sqlx::Result<()> {
    sqlx::query(
        r#"
        INSERT INTO instance_webhook_config (
            instance_id, webhook_url, enabled, server_start, server_stop, player_join, player_leave
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(instance_id) DO UPDATE SET
            webhook_url = excluded.webhook_url,
            enabled = excluded.enabled,
            server_start = excluded.server_start,
            server_stop = excluded.server_stop,
            player_join = excluded.player_join,
            player_leave = excluded.player_leave
        "#,
    )
    .bind(&config.instance_id)
    .bind(&config.webhook_url)
    .bind(config.enabled as i32)
    .bind(config.server_start as i32)
    .bind(config.server_stop as i32)
    .bind(config.player_join as i32)
    .bind(config.player_leave as i32)
    .execute(db)
    .await?;

    Ok(())
}

/// Delete webhook configuration for a specific instance
pub async fn delete_instance_webhook_config(
    db: &SqlitePool,
    instance_id: &str,
) -> sqlx::Result<()> {
    sqlx::query("DELETE FROM instance_webhook_config WHERE instance_id = ?")
        .bind(instance_id)
        .execute(db)
        .await?;

    Ok(())
}
