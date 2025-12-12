use crate::crypto;
use crate::error::AppResult;
use crate::state::SharedState;
use crate::tunnel::{agent, manager, AgentInfo, TunnelConfig, TunnelProvider, TunnelStatus};
use tauri::AppHandle;

/// Check if a tunnel agent is installed
#[tauri::command]
pub async fn check_tunnel_agent(
    state: tauri::State<'_, SharedState>,
    provider: String,
) -> AppResult<Option<AgentInfo>> {
    let state = state.read().await;
    let provider: TunnelProvider = provider
        .parse()
        .map_err(|e: String| crate::error::AppError::Custom(e))?;

    Ok(agent::check_agent_installed(&state.data_dir, provider))
}

/// Install a tunnel agent
#[tauri::command]
pub async fn install_tunnel_agent(
    state: tauri::State<'_, SharedState>,
    provider: String,
) -> AppResult<AgentInfo> {
    let state = state.read().await;
    let provider: TunnelProvider = provider
        .parse()
        .map_err(|e: String| crate::error::AppError::Custom(e))?;

    agent::install_agent(&state.http_client, &state.data_dir, provider).await
}

/// Get tunnel configuration for an instance
#[tauri::command]
pub async fn get_tunnel_config(
    state: tauri::State<'_, SharedState>,
    instance_id: String,
) -> AppResult<Option<TunnelConfig>> {
    let state = state.read().await;

    let row = sqlx::query_as::<_, (String, String, String, i64, i64, Option<String>, Option<String>, i64, Option<String>)>(
        r#"
        SELECT id, instance_id, provider, enabled, auto_start, playit_secret_key, ngrok_authtoken, target_port, tunnel_url
        FROM tunnel_configs
        WHERE instance_id = ?
        "#,
    )
    .bind(&instance_id)
    .fetch_optional(&state.db)
    .await?;

    Ok(row.map(
        |(
            id,
            instance_id,
            provider,
            enabled,
            auto_start,
            playit_secret_key,
            ngrok_authtoken,
            target_port,
            tunnel_url,
        )| {
            // Decrypt secrets if they are encrypted
            let decrypted_playit = playit_secret_key.and_then(|s| {
                if crypto::is_encrypted(&s) {
                    crypto::decrypt(&state.encryption_key, &s).ok()
                } else {
                    Some(s)
                }
            });

            let decrypted_ngrok = ngrok_authtoken.and_then(|s| {
                if crypto::is_encrypted(&s) {
                    crypto::decrypt(&state.encryption_key, &s).ok()
                } else {
                    Some(s)
                }
            });

            TunnelConfig {
                id,
                instance_id,
                provider: provider.parse().unwrap_or(TunnelProvider::Cloudflare),
                enabled: enabled != 0,
                auto_start: auto_start != 0,
                playit_secret_key: decrypted_playit,
                ngrok_authtoken: decrypted_ngrok,
                target_port: target_port as i32,
                tunnel_url,
            }
        },
    ))
}

/// Save tunnel configuration for an instance
#[tauri::command]
pub async fn save_tunnel_config(
    state: tauri::State<'_, SharedState>,
    config: TunnelConfig,
) -> AppResult<()> {
    let state = state.read().await;

    // Encrypt secrets before storing
    let encrypted_playit = match &config.playit_secret_key {
        Some(s) => Some(crypto::encrypt(&state.encryption_key, s)?),
        None => None,
    };

    let encrypted_ngrok = match &config.ngrok_authtoken {
        Some(s) => Some(crypto::encrypt(&state.encryption_key, s)?),
        None => None,
    };

    sqlx::query(
        r#"
        INSERT INTO tunnel_configs (id, instance_id, provider, enabled, auto_start, playit_secret_key, ngrok_authtoken, target_port, tunnel_url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(instance_id) DO UPDATE SET
            provider = excluded.provider,
            enabled = excluded.enabled,
            auto_start = excluded.auto_start,
            playit_secret_key = excluded.playit_secret_key,
            ngrok_authtoken = excluded.ngrok_authtoken,
            target_port = excluded.target_port,
            tunnel_url = excluded.tunnel_url
        "#,
    )
    .bind(&config.id)
    .bind(&config.instance_id)
    .bind(config.provider.to_string())
    .bind(config.enabled as i64)
    .bind(config.auto_start as i64)
    .bind(&encrypted_playit)
    .bind(&encrypted_ngrok)
    .bind(config.target_port as i64)
    .bind(&config.tunnel_url)
    .execute(&state.db)
    .await?;

    Ok(())
}

/// Update playit secret key after claim
#[tauri::command]
pub async fn update_playit_secret(
    state: tauri::State<'_, SharedState>,
    instance_id: String,
    secret_key: String,
) -> AppResult<()> {
    let state = state.read().await;

    // Encrypt the secret before storing
    let encrypted_secret = crypto::encrypt(&state.encryption_key, &secret_key)?;

    sqlx::query(
        r#"
        UPDATE tunnel_configs
        SET playit_secret_key = ?
        WHERE instance_id = ?
        "#,
    )
    .bind(&encrypted_secret)
    .bind(&instance_id)
    .execute(&state.db)
    .await?;

    Ok(())
}

/// Save tunnel URL for persistence
#[tauri::command]
pub async fn save_tunnel_url(
    state: tauri::State<'_, SharedState>,
    instance_id: String,
    url: String,
) -> AppResult<()> {
    let state = state.read().await;

    let result = sqlx::query(
        r#"
        UPDATE tunnel_configs
        SET tunnel_url = ?
        WHERE instance_id = ?
        "#,
    )
    .bind(&url)
    .bind(&instance_id)
    .execute(&state.db)
    .await?;

    tracing::info!(
        "save_tunnel_url: instance_id={}, url={}, rows_affected={}",
        instance_id,
        url,
        result.rows_affected()
    );

    Ok(())
}

/// Start a tunnel for an instance
#[tauri::command]
pub async fn start_tunnel(
    state: tauri::State<'_, SharedState>,
    app: AppHandle,
    instance_id: String,
) -> AppResult<()> {
    let (data_dir, running_tunnels, config) = {
        let state = state.read().await;

        // Get config from database
        let row = sqlx::query_as::<_, (String, String, String, i64, i64, Option<String>, Option<String>, i64, Option<String>)>(
            r#"
            SELECT id, instance_id, provider, enabled, auto_start, playit_secret_key, ngrok_authtoken, target_port, tunnel_url
            FROM tunnel_configs
            WHERE instance_id = ?
            "#,
        )
        .bind(&instance_id)
        .fetch_optional(&state.db)
        .await?;

        let config = row
            .map(
                |(
                    id,
                    instance_id,
                    provider,
                    enabled,
                    auto_start,
                    playit_secret_key,
                    ngrok_authtoken,
                    target_port,
                    tunnel_url,
                )| {
                    TunnelConfig {
                        id,
                        instance_id,
                        provider: provider.parse().unwrap_or(TunnelProvider::Cloudflare),
                        enabled: enabled != 0,
                        auto_start: auto_start != 0,
                        playit_secret_key,
                        ngrok_authtoken,
                        target_port: target_port as i32,
                        tunnel_url,
                    }
                },
            )
            .ok_or_else(|| crate::error::AppError::Custom("No tunnel config found".to_string()))?;

        (
            state.data_dir.clone(),
            state.running_tunnels.clone(),
            config,
        )
    };

    manager::start_tunnel(&data_dir, &config, &app, running_tunnels).await
}

/// Stop a tunnel for an instance
#[tauri::command]
pub async fn stop_tunnel(
    state: tauri::State<'_, SharedState>,
    app: AppHandle,
    instance_id: String,
) -> AppResult<()> {
    let running_tunnels = {
        let state = state.read().await;
        state.running_tunnels.clone()
    };

    manager::stop_tunnel(&instance_id, running_tunnels, &app).await
}

/// Get tunnel status for an instance
#[tauri::command]
pub async fn get_tunnel_status(
    state: tauri::State<'_, SharedState>,
    instance_id: String,
) -> AppResult<TunnelStatus> {
    let running_tunnels = {
        let state = state.read().await;
        state.running_tunnels.clone()
    };

    Ok(manager::get_tunnel_status(&instance_id, running_tunnels).await)
}

/// Check if tunnel is running for an instance
#[tauri::command]
pub async fn is_tunnel_running(
    state: tauri::State<'_, SharedState>,
    instance_id: String,
) -> AppResult<bool> {
    let running_tunnels = {
        let state = state.read().await;
        state.running_tunnels.clone()
    };

    Ok(manager::is_tunnel_running(&instance_id, running_tunnels).await)
}

/// Delete tunnel configuration for an instance
#[tauri::command]
pub async fn delete_tunnel_config(
    state: tauri::State<'_, SharedState>,
    instance_id: String,
) -> AppResult<()> {
    let state = state.read().await;

    sqlx::query("DELETE FROM tunnel_configs WHERE instance_id = ?")
        .bind(&instance_id)
        .execute(&state.db)
        .await?;

    Ok(())
}
