//! Tauri commands for cloud storage operations

use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, State};

use crate::crypto;
use crate::error::{AppError, AppResult};
use crate::state::SharedState;

use super::{
    credentials, db, google_drive, manager, CloudBackupSync, CloudProvider, CloudStorageConfig,
    CloudSyncStatus, ConnectionTestResult, DeviceCodeResponse, RemoteBackupInfo,
};

/// OAuth providers availability status
#[derive(Debug, Clone, Serialize)]
pub struct OAuthAvailability {
    pub google_drive: bool,
    pub dropbox: bool,
}

/// Check which OAuth providers are available (have embedded credentials)
#[tauri::command]
pub fn get_oauth_availability() -> OAuthAvailability {
    OAuthAvailability {
        google_drive: credentials::is_google_available(),
        dropbox: credentials::is_dropbox_available(),
    }
}

/// Get the cloud storage configuration
#[tauri::command]
pub async fn get_cloud_storage_config(
    state: State<'_, SharedState>,
) -> AppResult<Option<CloudStorageConfig>> {
    let state = state.read().await;
    db::get_config(&state.db).await
}

/// Save the cloud storage configuration
/// OPTIMIZED: Batch processes encryption checks to reduce overhead
#[tauri::command]
pub async fn save_cloud_storage_config(
    state: State<'_, SharedState>,
    mut config: CloudStorageConfig,
) -> AppResult<()> {
    let state = state.read().await;

    // Helper function to encrypt if needed
    let encrypt_if_needed = |value: &Option<String>| -> AppResult<Option<String>> {
        match value {
            Some(text) if !text.is_empty() && !crypto::is_encrypted(text) => {
                Ok(Some(crypto::encrypt(&state.encryption_key, text)?))
            }
            other => Ok(other.clone()),
        }
    };

    // Encrypt sensitive fields before saving - batch process for efficiency
    config.nextcloud_password = encrypt_if_needed(&config.nextcloud_password)?;
    config.s3_secret_key = encrypt_if_needed(&config.s3_secret_key)?;
    config.google_access_token = encrypt_if_needed(&config.google_access_token)?;
    config.google_refresh_token = encrypt_if_needed(&config.google_refresh_token)?;
    config.dropbox_access_token = encrypt_if_needed(&config.dropbox_access_token)?;
    config.dropbox_refresh_token = encrypt_if_needed(&config.dropbox_refresh_token)?;

    db::save_config(&state.db, &config).await
}

/// Delete the cloud storage configuration
#[tauri::command]
pub async fn delete_cloud_storage_config(state: State<'_, SharedState>) -> AppResult<()> {
    let state = state.read().await;
    db::delete_config(&state.db).await
}

/// Test connection to cloud storage
#[tauri::command]
pub async fn test_cloud_connection(
    state: State<'_, SharedState>,
) -> AppResult<ConnectionTestResult> {
    let state = state.read().await;

    let config = db::get_config(&state.db)
        .await?
        .ok_or_else(|| AppError::CloudStorage("No cloud storage configured".to_string()))?;

    manager::test_connection(&state.http_client, &config, &state.encryption_key).await
}

/// Start OAuth flow for Google Drive (uses embedded credentials)
#[tauri::command]
pub async fn cloud_oauth_start_google(
    state: State<'_, SharedState>,
) -> AppResult<DeviceCodeResponse> {
    let (client_id, _) = credentials::get_google_credentials().ok_or_else(|| {
        AppError::CloudStorage(
            "Google Drive OAuth credentials not configured in this build".to_string(),
        )
    })?;

    let state = state.read().await;
    google_drive::request_device_code(&state.http_client, client_id).await
}

/// Complete OAuth flow for Google Drive (uses embedded credentials)
#[tauri::command]
pub async fn cloud_oauth_complete_google(
    state: State<'_, SharedState>,
    device_code: String,
    interval: u64,
    expires_in: u64,
) -> AppResult<()> {
    let (client_id, client_secret) = credentials::get_google_credentials().ok_or_else(|| {
        AppError::CloudStorage(
            "Google Drive OAuth credentials not configured in this build".to_string(),
        )
    })?;

    let state = state.read().await;

    // Poll for tokens
    let tokens = google_drive::poll_for_token(
        &state.http_client,
        client_id,
        client_secret,
        &device_code,
        interval,
        expires_in,
    )
    .await?;

    // Create or get Kaizen Backups folder
    let folder_id = google_drive::get_or_create_folder(
        &state.http_client,
        &tokens.access_token,
        "Kaizen Backups",
    )
    .await?;

    // Encrypt tokens
    let encrypted_access = crypto::encrypt(&state.encryption_key, &tokens.access_token)?;
    let encrypted_refresh = tokens
        .refresh_token
        .as_ref()
        .map(|t| crypto::encrypt(&state.encryption_key, t))
        .transpose()?;

    // Calculate expiry time
    let expires_at = chrono::Utc::now() + chrono::Duration::seconds(tokens.expires_in as i64);

    // Update or create config
    let mut config = db::get_config(&state.db)
        .await?
        .unwrap_or_else(CloudStorageConfig::default);

    config.provider = CloudProvider::GoogleDrive;
    config.google_access_token = Some(encrypted_access);
    config.google_refresh_token = encrypted_refresh;
    config.google_expires_at = Some(expires_at.to_rfc3339());
    config.google_folder_id = Some(folder_id);

    db::save_config(&state.db, &config).await
}

/// Start OAuth flow for Dropbox (uses embedded credentials)
#[tauri::command]
pub async fn cloud_oauth_start_dropbox(
    state: State<'_, SharedState>,
) -> AppResult<DeviceCodeResponse> {
    let (app_key, _) = credentials::get_dropbox_credentials().ok_or_else(|| {
        AppError::CloudStorage("Dropbox OAuth credentials not configured in this build".to_string())
    })?;

    let state = state.read().await;
    super::dropbox::request_device_code(&state.http_client, app_key).await
}

/// Complete OAuth flow for Dropbox (uses embedded credentials)
#[tauri::command]
pub async fn cloud_oauth_complete_dropbox(
    state: State<'_, SharedState>,
    authorization_code: String,
) -> AppResult<()> {
    let (app_key, app_secret) = credentials::get_dropbox_credentials().ok_or_else(|| {
        AppError::CloudStorage("Dropbox OAuth credentials not configured in this build".to_string())
    })?;

    let state = state.read().await;

    // Exchange code for tokens
    let tokens =
        super::dropbox::exchange_code(&state.http_client, app_key, app_secret, &authorization_code)
            .await?;

    // Encrypt tokens
    let encrypted_access = crypto::encrypt(&state.encryption_key, &tokens.access_token)?;
    let encrypted_refresh = tokens
        .refresh_token
        .as_ref()
        .map(|t| crypto::encrypt(&state.encryption_key, t))
        .transpose()?;

    // Calculate expiry time
    let expires_at = chrono::Utc::now() + chrono::Duration::seconds(tokens.expires_in as i64);

    // Update or create config
    let mut config = db::get_config(&state.db)
        .await?
        .unwrap_or_else(CloudStorageConfig::default);

    config.provider = CloudProvider::Dropbox;
    config.dropbox_access_token = Some(encrypted_access);
    config.dropbox_refresh_token = encrypted_refresh;
    config.dropbox_expires_at = Some(expires_at.to_rfc3339());

    db::save_config(&state.db, &config).await
}

/// Upload a specific backup to cloud storage
#[tauri::command]
pub async fn upload_backup_to_cloud(
    state: State<'_, SharedState>,
    app: AppHandle,
    instance_id: String,
    world_name: String,
    backup_filename: String,
) -> AppResult<CloudBackupSync> {
    let state_guard = state.read().await;

    // Get cloud config
    let config = db::get_config(&state_guard.db)
        .await?
        .ok_or_else(|| AppError::CloudStorage("No cloud storage configured".to_string()))?;

    if !config.enabled {
        return Err(AppError::CloudStorage(
            "Cloud storage is not enabled".to_string(),
        ));
    }

    // Build local backup path
    let backups_dir = state_guard.data_dir.join("backups");
    let local_path = backups_dir
        .join(&instance_id)
        .join(&world_name)
        .join(&backup_filename);

    if !local_path.exists() {
        return Err(AppError::CloudStorage(format!(
            "Backup file not found: {}",
            local_path.display()
        )));
    }

    // Get file size
    let file_size = tokio::fs::metadata(&local_path)
        .await
        .map(|m| m.len() as i64)
        .ok();

    // Create sync record
    let mut sync = CloudBackupSync::new(
        &local_path.to_string_lossy(),
        &instance_id,
        &world_name,
        &backup_filename,
    );
    sync.file_size_bytes = file_size;
    sync.sync_status = CloudSyncStatus::Uploading;

    // Save initial sync record
    db::upsert_backup_sync(&state_guard.db, &sync).await?;

    // Perform upload
    let result = manager::upload_backup(
        &state_guard.http_client,
        &config,
        &state_guard.encryption_key,
        &local_path,
        &instance_id,
        &world_name,
        &backup_filename,
        Some(&app),
    )
    .await;

    // Update sync record based on result
    match &result {
        Ok(remote_path) => {
            sync.remote_path = Some(remote_path.clone());
            sync.sync_status = CloudSyncStatus::Synced;
            sync.last_synced_at = Some(chrono::Utc::now().to_rfc3339());
            sync.error_message = None;
        }
        Err(e) => {
            sync.sync_status = CloudSyncStatus::Failed;
            sync.error_message = Some(e.to_string());
        }
    }

    db::upsert_backup_sync(&state_guard.db, &sync).await?;

    result.map(|_| sync)
}

/// Upload all pending backups to cloud storage
#[tauri::command]
pub async fn upload_all_pending_backups(
    state: State<'_, SharedState>,
    app: AppHandle,
) -> AppResult<Vec<CloudBackupSync>> {
    let state_guard = state.read().await;

    let config = db::get_config(&state_guard.db)
        .await?
        .ok_or_else(|| AppError::CloudStorage("No cloud storage configured".to_string()))?;

    if !config.enabled {
        return Err(AppError::CloudStorage(
            "Cloud storage is not enabled".to_string(),
        ));
    }

    let pending = db::get_pending_backups(&state_guard.db).await?;
    let mut results = Vec::new();

    for mut sync in pending {
        let local_path = PathBuf::from(&sync.local_backup_path);

        if !local_path.exists() {
            // Mark as failed if file no longer exists
            sync.sync_status = CloudSyncStatus::Failed;
            sync.error_message = Some("Backup file no longer exists".to_string());
            db::upsert_backup_sync(&state_guard.db, &sync).await?;
            results.push(sync);
            continue;
        }

        sync.sync_status = CloudSyncStatus::Uploading;
        db::upsert_backup_sync(&state_guard.db, &sync).await?;

        let result = manager::upload_backup(
            &state_guard.http_client,
            &config,
            &state_guard.encryption_key,
            &local_path,
            &sync.instance_id,
            &sync.world_name,
            &sync.backup_filename,
            Some(&app),
        )
        .await;

        match result {
            Ok(remote_path) => {
                sync.remote_path = Some(remote_path);
                sync.sync_status = CloudSyncStatus::Synced;
                sync.last_synced_at = Some(chrono::Utc::now().to_rfc3339());
                sync.error_message = None;
            }
            Err(e) => {
                sync.sync_status = CloudSyncStatus::Failed;
                sync.error_message = Some(e.to_string());
            }
        }

        db::upsert_backup_sync(&state_guard.db, &sync).await?;
        results.push(sync);
    }

    Ok(results)
}

/// Get sync status for a specific backup
#[tauri::command]
pub async fn get_backup_sync_status(
    state: State<'_, SharedState>,
    backup_filename: String,
) -> AppResult<Option<CloudBackupSync>> {
    let state = state.read().await;
    db::get_backup_sync(&state.db, &backup_filename).await
}

/// Get all cloud backup sync records
#[tauri::command]
pub async fn get_all_cloud_backups(
    state: State<'_, SharedState>,
) -> AppResult<Vec<CloudBackupSync>> {
    let state = state.read().await;
    db::get_all_backup_syncs(&state.db).await
}

/// List remote backups from cloud storage
#[tauri::command]
pub async fn list_remote_backups(
    state: State<'_, SharedState>,
) -> AppResult<Vec<RemoteBackupInfo>> {
    let state = state.read().await;

    let config = db::get_config(&state.db)
        .await?
        .ok_or_else(|| AppError::CloudStorage("No cloud storage configured".to_string()))?;

    manager::list_remote_backups(&state.http_client, &config, &state.encryption_key).await
}

/// Delete a backup sync record (does not delete remote file)
#[tauri::command]
pub async fn delete_backup_sync_record(state: State<'_, SharedState>, id: String) -> AppResult<()> {
    let state = state.read().await;
    db::delete_backup_sync(&state.db, &id).await
}

/// Mark a local backup for cloud upload (creates pending sync record)
#[tauri::command]
pub async fn mark_backup_for_upload(
    state: State<'_, SharedState>,
    instance_id: String,
    world_name: String,
    backup_filename: String,
    local_path: String,
) -> AppResult<CloudBackupSync> {
    let state = state.read().await;

    // Get file size if available
    let file_size = tokio::fs::metadata(&local_path)
        .await
        .map(|m| m.len() as i64)
        .ok();

    let mut sync = CloudBackupSync::new(&local_path, &instance_id, &world_name, &backup_filename);
    sync.file_size_bytes = file_size;

    db::upsert_backup_sync(&state.db, &sync).await?;

    Ok(sync)
}
