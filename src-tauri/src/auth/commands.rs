use crate::auth::{microsoft, minecraft, xbox};
use crate::crypto;
use crate::db::accounts::Account;
use crate::error::{AppError, AppResult};
use crate::state::SharedState;
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use tauri::State;
use tracing::{debug, info};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceCodeInfo {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[tauri::command]
pub async fn get_accounts(state: State<'_, SharedState>) -> AppResult<Vec<Account>> {
    let state = state.read().await;
    let accounts = Account::get_all(&state.db).await.map_err(AppError::from)?;

    // Decrypt tokens for each account before returning
    let decrypted_accounts: Vec<Account> = accounts
        .into_iter()
        .map(|mut account| {
            // Decrypt access_token if it's encrypted
            if crypto::is_encrypted(&account.access_token) {
                if let Ok(decrypted) = crypto::decrypt(&state.encryption_key, &account.access_token)
                {
                    account.access_token = decrypted;
                }
            }
            // Decrypt refresh_token if it's encrypted
            if crypto::is_encrypted(&account.refresh_token) {
                if let Ok(decrypted) =
                    crypto::decrypt(&state.encryption_key, &account.refresh_token)
                {
                    account.refresh_token = decrypted;
                }
            }
            account
        })
        .collect();

    Ok(decrypted_accounts)
}

#[tauri::command]
pub async fn get_active_account(state: State<'_, SharedState>) -> AppResult<Option<Account>> {
    let state = state.read().await;
    let account = Account::get_active(&state.db)
        .await
        .map_err(AppError::from)?;

    // Decrypt tokens if present
    Ok(account.map(|mut acc| {
        if crypto::is_encrypted(&acc.access_token) {
            if let Ok(decrypted) = crypto::decrypt(&state.encryption_key, &acc.access_token) {
                acc.access_token = decrypted;
            }
        }
        if crypto::is_encrypted(&acc.refresh_token) {
            if let Ok(decrypted) = crypto::decrypt(&state.encryption_key, &acc.refresh_token) {
                acc.refresh_token = decrypted;
            }
        }
        acc
    }))
}

#[tauri::command]
pub async fn set_active_account(
    state: State<'_, SharedState>,
    account_id: String,
) -> AppResult<()> {
    let state = state.read().await;
    Account::set_active(&state.db, &account_id)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn delete_account(state: State<'_, SharedState>, account_id: String) -> AppResult<()> {
    let state = state.read().await;
    Account::delete(&state.db, &account_id)
        .await
        .map_err(AppError::from)
}

/// Start Microsoft login - returns device code for user authentication
#[tauri::command]
pub async fn login_microsoft_start(state: State<'_, SharedState>) -> AppResult<DeviceCodeInfo> {
    let state = state.read().await;
    let device_code = microsoft::request_device_code(&state.http_client).await?;

    Ok(DeviceCodeInfo {
        device_code: device_code.device_code,
        user_code: device_code.user_code,
        verification_uri: device_code.verification_uri,
        expires_in: device_code.expires_in,
        interval: device_code.interval,
    })
}

/// Complete Microsoft login - poll for token and authenticate
#[tauri::command]
pub async fn login_microsoft_complete(
    state: State<'_, SharedState>,
    device_code: String,
    interval: u64,
    expires_in: u64,
) -> AppResult<Account> {
    let state_guard = state.read().await;
    let client = &state_guard.http_client;

    info!("Starting Microsoft authentication flow");

    // Step 1: Poll for Microsoft token
    debug!("Polling for Microsoft token");
    let ms_token = microsoft::poll_for_token(client, &device_code, interval, expires_in).await?;

    // Step 2: Authenticate with Xbox Live
    debug!("Authenticating with Xbox Live");
    let xbox_token = xbox::authenticate_xbox_live(client, &ms_token.access_token).await?;

    // Step 3: Get XSTS token
    debug!("Getting XSTS token");
    let xsts_token = xbox::get_xsts_token(client, &xbox_token.token).await?;

    // Step 4: Authenticate with Minecraft
    debug!("Authenticating with Minecraft");
    let mc_token =
        minecraft::authenticate_minecraft(client, &xsts_token.user_hash, &xsts_token.token).await?;

    // Step 5: Get Minecraft profile
    debug!("Getting Minecraft profile");
    let profile = minecraft::get_minecraft_profile(client, &mc_token.access_token).await?;

    info!("Successfully authenticated user: {}", profile.name);

    // Calculate expiration time
    let expires_at = Utc::now() + Duration::seconds(mc_token.expires_in as i64);

    // Get skin URL
    let skin_url = profile.skins.first().map(|s| s.url.clone());

    // Encrypt tokens before storing
    let encrypted_access_token =
        crypto::encrypt(&state_guard.encryption_key, &mc_token.access_token)
            .map_err(|e| AppError::Encryption(format!("Failed to encrypt access token: {}", e)))?;
    let encrypted_refresh_token =
        crypto::encrypt(&state_guard.encryption_key, &ms_token.refresh_token)
            .map_err(|e| AppError::Encryption(format!("Failed to encrypt refresh token: {}", e)))?;

    // Create account with encrypted tokens for storage
    let account_for_db = Account {
        id: uuid::Uuid::new_v4().to_string(),
        uuid: profile.id.clone(),
        username: profile.name.clone(),
        access_token: encrypted_access_token,
        refresh_token: encrypted_refresh_token,
        expires_at: expires_at.to_rfc3339(),
        skin_url: skin_url.clone(),
        is_active: true,
        created_at: Utc::now().to_rfc3339(),
    };

    // Save to database
    let db = &state_guard.db;

    // First, deactivate all other accounts
    Account::set_active(db, "").await.ok(); // This will set all to inactive

    // Insert the new account
    account_for_db.insert(db).await.map_err(AppError::from)?;

    // Return account with decrypted tokens for immediate use
    let account = Account {
        id: account_for_db.id,
        uuid: profile.id,
        username: profile.name,
        access_token: mc_token.access_token,
        refresh_token: ms_token.refresh_token,
        expires_at: expires_at.to_rfc3339(),
        skin_url,
        is_active: true,
        created_at: account_for_db.created_at,
    };

    Ok(account)
}

/// Create an offline account for development/testing
#[tauri::command]
pub async fn create_offline_account(
    state: State<'_, SharedState>,
    username: String,
) -> AppResult<Account> {
    let state_guard = state.read().await;
    let db = &state_guard.db;

    // Generate offline UUID (based on username, prefixed with "OfflinePlayer:")
    let offline_uuid = uuid::Uuid::new_v3(
        &uuid::Uuid::NAMESPACE_DNS,
        format!("OfflinePlayer:{}", username).as_bytes(),
    );

    let account = Account {
        id: uuid::Uuid::new_v4().to_string(),
        uuid: offline_uuid.to_string().replace("-", ""),
        username: username.clone(),
        access_token: "offline".to_string(),
        refresh_token: "offline".to_string(),
        expires_at: "2099-12-31T23:59:59Z".to_string(),
        skin_url: None,
        is_active: true,
        created_at: Utc::now().to_rfc3339(),
    };

    // Deactivate all other accounts
    Account::set_active(db, "").await.ok();

    // Insert the offline account
    account.insert(db).await.map_err(AppError::from)?;

    Ok(account)
}

/// Refresh an account's token
#[tauri::command]
pub async fn refresh_account_token(
    state: State<'_, SharedState>,
    account_id: String,
) -> AppResult<Account> {
    let state_guard = state.read().await;
    let client = &state_guard.http_client;
    let db = &state_guard.db;

    info!("Refreshing token for account: {}", account_id);

    // Get the account
    let accounts = Account::get_all(db).await.map_err(AppError::from)?;
    let account = accounts
        .into_iter()
        .find(|a| a.id == account_id)
        .ok_or_else(|| AppError::Auth("Account not found".to_string()))?;

    // Decrypt refresh token if encrypted
    let refresh_token = if crypto::is_encrypted(&account.refresh_token) {
        crypto::decrypt(&state_guard.encryption_key, &account.refresh_token)
            .map_err(|e| AppError::Encryption(format!("Failed to decrypt refresh token: {}", e)))?
    } else {
        account.refresh_token.clone()
    };

    // Refresh Microsoft token
    let ms_token = microsoft::refresh_token(client, &refresh_token).await?;

    // Re-authenticate through the chain
    let xbox_token = xbox::authenticate_xbox_live(client, &ms_token.access_token).await?;
    let xsts_token = xbox::get_xsts_token(client, &xbox_token.token).await?;
    let mc_token =
        minecraft::authenticate_minecraft(client, &xsts_token.user_hash, &xsts_token.token).await?;

    // Get updated profile
    let profile = minecraft::get_minecraft_profile(client, &mc_token.access_token).await?;

    info!("Token refreshed successfully for user: {}", profile.name);

    let expires_at = Utc::now() + Duration::seconds(mc_token.expires_in as i64);
    let skin_url = profile.skins.first().map(|s| s.url.clone());

    // Encrypt new tokens before storing
    let encrypted_access_token =
        crypto::encrypt(&state_guard.encryption_key, &mc_token.access_token)
            .map_err(|e| AppError::Encryption(format!("Failed to encrypt access token: {}", e)))?;
    let encrypted_refresh_token =
        crypto::encrypt(&state_guard.encryption_key, &ms_token.refresh_token)
            .map_err(|e| AppError::Encryption(format!("Failed to encrypt refresh token: {}", e)))?;

    // Update account in database with encrypted tokens
    let account_for_db = Account {
        id: account.id.clone(),
        uuid: profile.id.clone(),
        username: profile.name.clone(),
        access_token: encrypted_access_token,
        refresh_token: encrypted_refresh_token,
        expires_at: expires_at.to_rfc3339(),
        skin_url: skin_url.clone(),
        is_active: account.is_active,
        created_at: account.created_at.clone(),
    };

    account_for_db.insert(db).await.map_err(AppError::from)?;

    // Return account with decrypted tokens for immediate use
    let updated_account = Account {
        id: account.id,
        uuid: profile.id,
        username: profile.name,
        access_token: mc_token.access_token,
        refresh_token: ms_token.refresh_token,
        expires_at: expires_at.to_rfc3339(),
        skin_url,
        is_active: account.is_active,
        created_at: account.created_at,
    };

    Ok(updated_account)
}
