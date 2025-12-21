use crate::auth::{kaizen, microsoft, minecraft, xbox};
use crate::crypto;
use crate::db::accounts::{Account, AccountInfo};
use crate::db::kaizen_accounts::{KaizenAccount, KaizenAccountInfo};
use crate::error::{AppError, AppResult};
use crate::state::SharedState;
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tracing::{debug, info};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceCodeInfo {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

/// Get all accounts - returns safe AccountInfo WITHOUT tokens
/// Tokens are never exposed to the frontend for security
#[tauri::command]
pub async fn get_accounts(state: State<'_, SharedState>) -> AppResult<Vec<AccountInfo>> {
    let state = state.read().await;
    let accounts = Account::get_all(&state.db).await.map_err(AppError::from)?;

    // Convert to safe AccountInfo (no tokens exposed)
    let account_infos: Vec<AccountInfo> = accounts
        .into_iter()
        .map(|account| account.to_info())
        .collect();

    Ok(account_infos)
}

/// Get active account - returns safe AccountInfo WITHOUT tokens
/// Tokens are never exposed to the frontend for security
#[tauri::command]
pub async fn get_active_account(state: State<'_, SharedState>) -> AppResult<Option<AccountInfo>> {
    let state = state.read().await;
    let account = Account::get_active(&state.db)
        .await
        .map_err(AppError::from)?;

    // Convert to safe AccountInfo (no tokens exposed)
    Ok(account.map(|acc| acc.to_info()))
}

#[tauri::command]
pub async fn set_active_account(
    state: State<'_, SharedState>,
    app: AppHandle,
    account_id: String,
) -> AppResult<()> {
    let state = state.read().await;
    Account::set_active(&state.db, &account_id)
        .await
        .map_err(AppError::from)?;

    // Emit event to notify all listeners that the active account changed
    let _ = app.emit("active-account-changed", ());

    Ok(())
}

#[tauri::command]
pub async fn delete_account(
    state: State<'_, SharedState>,
    app: AppHandle,
    account_id: String,
) -> AppResult<()> {
    let state = state.read().await;
    Account::delete(&state.db, &account_id)
        .await
        .map_err(AppError::from)?;

    // Emit event to notify listeners (in case the deleted account was active)
    let _ = app.emit("active-account-changed", ());

    Ok(())
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
/// Returns safe AccountInfo (no tokens exposed to frontend)
#[tauri::command]
pub async fn login_microsoft_complete(
    state: State<'_, SharedState>,
    device_code: String,
    interval: u64,
    expires_in: u64,
) -> AppResult<AccountInfo> {
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

    // Return safe AccountInfo (no tokens exposed to frontend)
    Ok(account_for_db.to_info())
}

/// Create an offline account for development/testing
/// Returns safe AccountInfo (no tokens exposed to frontend)
#[tauri::command]
pub async fn create_offline_account(
    state: State<'_, SharedState>,
    username: String,
) -> AppResult<AccountInfo> {
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

    // Return safe AccountInfo (no tokens exposed)
    Ok(account.to_info())
}

/// Refresh an account's token
/// Returns safe AccountInfo (no tokens exposed to frontend)
#[tauri::command]
pub async fn refresh_account_token(
    state: State<'_, SharedState>,
    account_id: String,
) -> AppResult<AccountInfo> {
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

    // Return safe AccountInfo (no tokens exposed to frontend)
    Ok(account_for_db.to_info())
}

// ============================================================================
// Kaizen Account Commands
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KaizenDeviceCodeInfo {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

/// Start Kaizen login - returns device code for user authentication
#[tauri::command]
pub async fn login_kaizen_start(state: State<'_, SharedState>) -> AppResult<KaizenDeviceCodeInfo> {
    let state = state.read().await;
    let device_code = kaizen::request_device_code(&state.http_client).await?;

    Ok(KaizenDeviceCodeInfo {
        device_code: device_code.device_code,
        user_code: device_code.user_code,
        verification_uri: device_code.verification_uri,
        expires_in: device_code.expires_in,
        interval: device_code.interval,
    })
}

/// Complete Kaizen login - poll for token and fetch user info
/// Returns safe KaizenAccountInfo (no tokens exposed to frontend)
#[tauri::command]
pub async fn login_kaizen_complete(
    state: State<'_, SharedState>,
    device_code: String,
    interval: u64,
    expires_in: u64,
) -> AppResult<KaizenAccountInfo> {
    let state_guard = state.read().await;
    let client = &state_guard.http_client;

    info!("Starting Kaizen authentication flow");

    // Step 1: Poll for token
    debug!("Polling for Kaizen token");
    let token = kaizen::poll_for_token(client, &device_code, interval, expires_in).await?;

    // Step 2: Get user info
    debug!("Getting Kaizen user info");
    let user = kaizen::get_user_info(client, &token.access_token).await?;

    info!("Successfully authenticated Kaizen user: {}", user.name);

    // Calculate expiration time
    let expires_at = Utc::now() + Duration::seconds(token.expires_in as i64);

    // Extract permissions and patron status
    let permissions = kaizen::extract_permissions(&user);
    let is_patron = kaizen::is_patron(&user);

    // Encrypt tokens before storing
    let encrypted_access_token =
        crypto::encrypt(&state_guard.encryption_key, &token.access_token)
            .map_err(|e| AppError::Encryption(format!("Failed to encrypt Kaizen access token: {}", e)))?;

    let encrypted_refresh_token = match &token.refresh_token {
        Some(rt) => Some(
            crypto::encrypt(&state_guard.encryption_key, rt)
                .map_err(|e| AppError::Encryption(format!("Failed to encrypt Kaizen refresh token: {}", e)))?
        ),
        None => None,
    };

    // Serialize tags, permissions, and badges to JSON
    let tags_json = serde_json::to_string(&user.tags)
        .map_err(|e| AppError::Auth(format!("Failed to serialize tags: {}", e)))?;
    let permissions_json = serde_json::to_string(&permissions)
        .map_err(|e| AppError::Auth(format!("Failed to serialize permissions: {}", e)))?;
    let badges_json = serde_json::to_string(&user.badges)
        .map_err(|e| AppError::Auth(format!("Failed to serialize badges: {}", e)))?;

    // Create account for database storage
    let account_for_db = KaizenAccount {
        id: uuid::Uuid::new_v4().to_string(),
        user_id: user.id.clone(),
        username: user.name.clone(),
        email: user.email.clone(),
        access_token: encrypted_access_token,
        refresh_token: encrypted_refresh_token,
        expires_at: expires_at.to_rfc3339(),
        permissions: permissions_json.clone(),
        tags: tags_json.clone(),
        badges: badges_json.clone(),
        is_patron,
        is_active: true,
        created_at: Utc::now().to_rfc3339(),
    };

    // Save to database
    let db = &state_guard.db;

    // Deactivate all other Kaizen accounts
    KaizenAccount::set_active(db, "").await.ok();

    // Insert the new account
    account_for_db.insert(db).await.map_err(AppError::from)?;

    // Return safe KaizenAccountInfo (no tokens exposed to frontend)
    Ok(account_for_db.to_info())
}

/// Get all Kaizen accounts - returns safe KaizenAccountInfo WITHOUT tokens
/// Tokens are never exposed to the frontend for security
#[tauri::command]
pub async fn get_kaizen_accounts(state: State<'_, SharedState>) -> AppResult<Vec<KaizenAccountInfo>> {
    let state = state.read().await;
    let accounts = KaizenAccount::get_all(&state.db).await.map_err(AppError::from)?;

    // Convert to safe KaizenAccountInfo (no tokens exposed)
    let account_infos: Vec<KaizenAccountInfo> = accounts
        .into_iter()
        .map(|account| account.to_info())
        .collect();

    Ok(account_infos)
}

/// Sync all Kaizen accounts - refresh user info (tags, badges, permissions) from API
/// Call this at app startup to ensure user data is up to date
#[tauri::command]
pub async fn sync_kaizen_accounts(state: State<'_, SharedState>) -> AppResult<()> {
    let state_guard = state.read().await;
    let accounts = KaizenAccount::get_all(&state_guard.db).await.map_err(AppError::from)?;

    for account in accounts {
        // Decrypt access token
        let access_token = if crypto::is_encrypted(&account.access_token) {
            match crypto::decrypt(&state_guard.encryption_key, &account.access_token) {
                Ok(decrypted) => decrypted,
                Err(_) => continue, // Skip if we can't decrypt
            }
        } else {
            account.access_token.clone()
        };

        // Check if token is expired - try to refresh first
        let final_token = if account.is_token_expired() {
            if let Some(ref rt) = account.refresh_token {
                let decrypted_refresh = if crypto::is_encrypted(rt) {
                    crypto::decrypt(&state_guard.encryption_key, rt).ok()
                } else {
                    Some(rt.clone())
                };

                if let Some(refresh_token) = decrypted_refresh {
                    match kaizen::refresh_token(&state_guard.http_client, &refresh_token).await {
                        Ok(new_token) => {
                            debug!("Refreshed token for account {} during sync", account.username);
                            let expires_at = Utc::now() + Duration::seconds(new_token.expires_in as i64);

                            // Encrypt and save new tokens
                            if let Ok(encrypted_access) = crypto::encrypt(&state_guard.encryption_key, &new_token.access_token) {
                                let encrypted_refresh = match &new_token.refresh_token {
                                    Some(rt) => crypto::encrypt(&state_guard.encryption_key, rt).ok(),
                                    None => account.refresh_token.clone(),
                                };

                                let _ = KaizenAccount::update_tokens(
                                    &state_guard.db,
                                    &account.id,
                                    &encrypted_access,
                                    encrypted_refresh.as_deref(),
                                    &expires_at.to_rfc3339(),
                                ).await;
                            }

                            new_token.access_token
                        }
                        Err(e) => {
                            debug!("Failed to refresh token for {}: {}", account.username, e);
                            continue; // Skip this account if refresh fails
                        }
                    }
                } else {
                    continue; // No refresh token available
                }
            } else {
                continue; // Token expired and no refresh token
            }
        } else {
            access_token
        };

        // Fetch fresh user info from API
        match kaizen::get_user_info(&state_guard.http_client, &final_token).await {
            Ok(user) => {
                let permissions = kaizen::extract_permissions(&user);
                let is_patron = kaizen::is_patron(&user);

                let tags_json = serde_json::to_string(&user.tags).unwrap_or_else(|_| "[]".to_string());
                let permissions_json = serde_json::to_string(&permissions).unwrap_or_else(|_| "[]".to_string());
                let badges_json = serde_json::to_string(&user.badges).unwrap_or_else(|_| "[]".to_string());

                // Update user info in database
                if let Err(e) = KaizenAccount::update_user_info(
                    &state_guard.db,
                    &account.id,
                    &user.name,
                    &user.email,
                    &permissions_json,
                    &tags_json,
                    &badges_json,
                    is_patron,
                ).await {
                    debug!("Failed to update user info for {}: {}", account.username, e);
                } else {
                    info!("Synced Kaizen account: {}", user.name);
                }
            }
            Err(e) => {
                debug!("Failed to fetch user info for {}: {}", account.username, e);
            }
        }
    }

    Ok(())
}

/// Get the active Kaizen account (auto-refreshes if token expired)
/// Returns safe KaizenAccountInfo (no tokens exposed to frontend)
#[tauri::command]
pub async fn get_active_kaizen_account(state: State<'_, SharedState>) -> AppResult<Option<KaizenAccountInfo>> {
    let state_guard = state.read().await;
    let account = KaizenAccount::get_active(&state_guard.db)
        .await
        .map_err(AppError::from)?;

    match account {
        None => Ok(None),
        Some(mut acc) => {
            // Check if token is expired and we have a refresh token - auto-refresh in background
            if acc.is_token_expired() {
                if let Some(ref rt) = acc.refresh_token {
                    let decrypted_refresh = if crypto::is_encrypted(rt) {
                        crypto::decrypt(&state_guard.encryption_key, rt).ok()
                    } else {
                        Some(rt.clone())
                    };

                    if let Some(refresh_token) = decrypted_refresh {
                        // Try to refresh the token
                        match kaizen::refresh_token(&state_guard.http_client, &refresh_token).await {
                            Ok(new_token) => {
                                debug!("Auto-refreshing expired Kaizen token");
                                let expires_at = Utc::now() + Duration::seconds(new_token.expires_in as i64);

                                // Encrypt new tokens
                                if let Ok(encrypted_access) = crypto::encrypt(&state_guard.encryption_key, &new_token.access_token) {
                                    let encrypted_refresh = match &new_token.refresh_token {
                                        Some(rt) => crypto::encrypt(&state_guard.encryption_key, rt).ok(),
                                        None => acc.refresh_token.clone(),
                                    };

                                    // Update in database
                                    let _ = KaizenAccount::update_tokens(
                                        &state_guard.db,
                                        &acc.id,
                                        &encrypted_access,
                                        encrypted_refresh.as_deref(),
                                        &expires_at.to_rfc3339(),
                                    ).await;

                                    // Update local copy for accurate to_info()
                                    acc.access_token = encrypted_access;
                                    acc.expires_at = expires_at.to_rfc3339();
                                }
                            }
                            Err(e) => {
                                debug!("Failed to auto-refresh Kaizen token: {}", e);
                                // Continue with existing token
                            }
                        }
                    }
                }
            }

            // Return safe KaizenAccountInfo (no tokens exposed to frontend)
            Ok(Some(acc.to_info()))
        }
    }
}

/// Set a Kaizen account as active
#[tauri::command]
pub async fn set_active_kaizen_account(
    state: State<'_, SharedState>,
    app: AppHandle,
    account_id: String,
) -> AppResult<()> {
    let state = state.read().await;
    KaizenAccount::set_active(&state.db, &account_id)
        .await
        .map_err(AppError::from)?;

    // Emit event to notify listeners
    let _ = app.emit("kaizen-account-changed", ());

    Ok(())
}

/// Delete a Kaizen account
#[tauri::command]
pub async fn delete_kaizen_account(
    state: State<'_, SharedState>,
    app: AppHandle,
    account_id: String,
) -> AppResult<()> {
    let state = state.read().await;

    // Try to revoke the token first (optional - don't fail if this doesn't work)
    if let Ok(Some(account)) = KaizenAccount::get_by_id(&state.db, &account_id).await {
        let access_token = if crypto::is_encrypted(&account.access_token) {
            crypto::decrypt(&state.encryption_key, &account.access_token).ok()
        } else {
            Some(account.access_token.clone())
        };

        if let Some(token) = access_token {
            let _ = kaizen::revoke_token(&state.http_client, &token).await;
        }
    }

    // Delete from database
    KaizenAccount::delete(&state.db, &account_id)
        .await
        .map_err(AppError::from)?;

    // Emit event
    let _ = app.emit("kaizen-account-changed", ());

    Ok(())
}

/// Refresh a Kaizen account's token
/// Returns safe KaizenAccountInfo (no tokens exposed to frontend)
#[tauri::command]
pub async fn refresh_kaizen_account(
    state: State<'_, SharedState>,
    app: AppHandle,
    account_id: String,
) -> AppResult<KaizenAccountInfo> {
    let state_guard = state.read().await;

    // Get the account
    let account = KaizenAccount::get_by_id(&state_guard.db, &account_id)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Auth("Kaizen account not found".to_string()))?;

    // Decrypt refresh token
    let refresh_token = account.refresh_token
        .as_ref()
        .ok_or_else(|| AppError::Auth("No refresh token available".to_string()))?;

    let decrypted_refresh = if crypto::is_encrypted(refresh_token) {
        crypto::decrypt(&state_guard.encryption_key, refresh_token)
            .map_err(|e| AppError::Encryption(format!("Failed to decrypt refresh token: {}", e)))?
    } else {
        refresh_token.clone()
    };

    info!("Refreshing Kaizen token for account: {}", account.username);

    // Refresh the token
    let new_token = kaizen::refresh_token(&state_guard.http_client, &decrypted_refresh).await?;

    // Calculate new expiration time
    let expires_at = Utc::now() + Duration::seconds(new_token.expires_in as i64);

    // Encrypt new tokens
    let encrypted_access_token = crypto::encrypt(&state_guard.encryption_key, &new_token.access_token)
        .map_err(|e| AppError::Encryption(format!("Failed to encrypt access token: {}", e)))?;

    let encrypted_refresh_token = match &new_token.refresh_token {
        Some(rt) => Some(
            crypto::encrypt(&state_guard.encryption_key, rt)
                .map_err(|e| AppError::Encryption(format!("Failed to encrypt refresh token: {}", e)))?
        ),
        None => account.refresh_token.clone(), // Keep existing if no new one provided
    };

    // Update in database
    KaizenAccount::update_tokens(
        &state_guard.db,
        &account_id,
        &encrypted_access_token,
        encrypted_refresh_token.as_deref(),
        &expires_at.to_rfc3339(),
    )
    .await
    .map_err(AppError::from)?;

    info!("Successfully refreshed Kaizen token");

    // Emit event
    let _ = app.emit("kaizen-account-changed", ());

    // Return safe KaizenAccountInfo (no tokens exposed to frontend)
    let updated_account = KaizenAccount::get_by_id(&state_guard.db, &account_id)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Auth("Account not found after refresh".to_string()))?;

    Ok(updated_account.to_info())
}
