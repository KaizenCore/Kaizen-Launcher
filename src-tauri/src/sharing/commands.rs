//! Tauri commands for instance sharing

use crate::db::instances::Instance;
use crate::error::AppResult;
use crate::sharing::manifest::{ExportOptions, ExportableContent, PreparedExport, SharingManifest};
use crate::sharing::server::{self, ActiveShare, RunningShares, SharingProvider};
use crate::sharing::{export, import};
use crate::state::SharedState;
use std::path::PathBuf;
use tauri::{AppHandle, State};

/// Get exportable content for an instance (for UI selection)
#[tauri::command]
pub async fn get_exportable_content(
    state: State<'_, SharedState>,
    instance_id: String,
) -> AppResult<ExportableContent> {
    let state = state.read().await;
    let instances_dir = state.get_instances_dir().await;

    export::get_exportable_content(&state.db, &instances_dir, &instance_id).await
}

/// Prepare an export package
#[tauri::command]
pub async fn prepare_export(
    state: State<'_, SharedState>,
    app: AppHandle,
    instance_id: String,
    options: ExportOptions,
) -> AppResult<PreparedExport> {
    let state = state.read().await;
    let instances_dir = state.get_instances_dir().await;

    export::prepare_export(
        &app,
        &state.db,
        &instances_dir,
        &state.data_dir,
        &instance_id,
        options,
    )
    .await
}

/// Cleanup export temp files
#[tauri::command]
pub async fn cleanup_export(state: State<'_, SharedState>, export_id: String) -> AppResult<()> {
    let state = state.read().await;
    export::cleanup_export(&state.data_dir, &export_id).await
}

/// Validate an import package
#[tauri::command]
pub async fn validate_import_package(package_path: String) -> AppResult<SharingManifest> {
    let path = PathBuf::from(&package_path);
    import::validate_import_package(&path).await
}

/// Import an instance from a package
#[tauri::command]
pub async fn import_instance(
    state: State<'_, SharedState>,
    app: AppHandle,
    package_path: String,
    new_name: Option<String>,
) -> AppResult<Instance> {
    let state = state.read().await;
    let instances_dir = state.get_instances_dir().await;
    let path = PathBuf::from(&package_path);

    import::import_instance(&app, &state.db, &instances_dir, &path, new_name).await
}

/// Get the sharing temp directory path
#[tauri::command]
pub async fn get_sharing_temp_dir(state: State<'_, SharedState>) -> AppResult<String> {
    let state = state.read().await;
    let temp_dir = export::get_sharing_temp_dir(&state.data_dir);
    Ok(temp_dir.to_string_lossy().to_string())
}

// ============ NEW: Tunnel-based sharing commands ============

/// Start sharing an instance via HTTP tunnel
#[tauri::command]
pub async fn start_share(
    state: State<'_, SharedState>,
    running_shares: State<'_, RunningShares>,
    app: AppHandle,
    package_path: String,
    instance_name: String,
    provider: Option<SharingProvider>,
    password: Option<String>,
) -> AppResult<ActiveShare> {
    let state_guard = state.read().await;
    let path = PathBuf::from(&package_path);
    let provider = provider.unwrap_or_default();

    let share = server::start_share(
        &state_guard.data_dir,
        &path,
        &instance_name,
        provider,
        password,
        app,
        running_shares.inner().clone(),
    )
    .await?;

    // Save to database for persistence across restarts
    crate::db::shares::save_share(
        &state_guard.db,
        &share.share_id,
        &share.instance_name,
        &share.package_path,
        share.provider,
        share.password_hash.as_deref(),
        share.file_size,
    )
    .await?;

    Ok(share)
}

/// Stop sharing
#[tauri::command]
pub async fn stop_share(
    state: State<'_, SharedState>,
    running_shares: State<'_, RunningShares>,
    share_id: String,
) -> AppResult<()> {
    server::stop_share(&share_id, running_shares.inner().clone()).await?;

    // Remove from database
    let state_guard = state.read().await;
    crate::db::shares::delete_share(&state_guard.db, &share_id).await?;

    Ok(())
}

/// Get all active shares
#[tauri::command]
pub async fn get_active_shares(running_shares: State<'_, RunningShares>) -> AppResult<Vec<ActiveShare>> {
    Ok(server::get_active_shares(running_shares.inner().clone()).await)
}

/// Stop all shares
#[tauri::command]
pub async fn stop_all_shares(
    state: State<'_, SharedState>,
    running_shares: State<'_, RunningShares>,
) -> AppResult<()> {
    server::stop_all_shares(running_shares.inner().clone()).await;

    // Remove all from database
    let state_guard = state.read().await;
    crate::db::shares::delete_all_shares(&state_guard.db).await?;

    Ok(())
}

/// Download instance from a share URL and import it
#[tauri::command]
pub async fn download_and_import_share(
    state: State<'_, SharedState>,
    app: AppHandle,
    share_url: String,
    new_name: Option<String>,
    password: Option<String>,
) -> AppResult<Instance> {
    use crate::error::AppError;

    let state_guard = state.read().await;
    let instances_dir = state_guard.get_instances_dir().await;
    let temp_dir = export::get_sharing_temp_dir(&state_guard.data_dir);

    // Ensure temp dir exists
    tokio::fs::create_dir_all(&temp_dir)
        .await
        .map_err(|e| AppError::Io(format!("Failed to create temp dir: {}", e)))?;

    // Generate temp file path
    let temp_file = temp_dir.join(format!("download_{}.kaizen", uuid::Uuid::new_v4()));

    // Download the file
    tracing::info!("[SHARE] Downloading from {}...", share_url);

    // Build request with optional password header
    let mut request = state_guard.http_client.get(&share_url);
    if let Some(pwd) = &password {
        request = request.header("X-Share-Password", pwd);
    }

    let response = request
        .send()
        .await
        .map_err(|e| AppError::Network(format!("Failed to download: {}", e)))?;

    // Check for password-required response
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err(AppError::Auth("PASSWORD_REQUIRED".to_string()));
    }

    // Check for invalid password (403 Forbidden with INVALID_PASSWORD body)
    if response.status() == reqwest::StatusCode::FORBIDDEN {
        let body = response.text().await.unwrap_or_default();
        if body.contains("INVALID_PASSWORD") {
            return Err(AppError::Auth("INVALID_PASSWORD".to_string()));
        }
        return Err(AppError::Network(format!("Download failed: access denied")));
    }

    if !response.status().is_success() {
        return Err(AppError::Network(format!(
            "Download failed with status: {}",
            response.status()
        )));
    }

    // Get content length for progress
    let total_size = response.content_length().unwrap_or(0);
    tracing::info!("[SHARE] Download size: {} bytes", total_size);

    // Stream to file
    let bytes = response
        .bytes()
        .await
        .map_err(|e| AppError::Network(format!("Failed to read response: {}", e)))?;

    tokio::fs::write(&temp_file, &bytes)
        .await
        .map_err(|e| AppError::Io(format!("Failed to write temp file: {}", e)))?;

    tracing::info!("[SHARE] Download complete, importing...");

    // Import the instance
    let instance = import::import_instance(&app, &state_guard.db, &instances_dir, &temp_file, new_name).await?;

    // Cleanup temp file
    let _ = tokio::fs::remove_file(&temp_file).await;

    Ok(instance)
}

/// Fetch manifest from a share URL (for preview before download)
#[tauri::command]
pub async fn fetch_share_manifest(
    state: State<'_, SharedState>,
    share_url: String,
    password: Option<String>,
) -> AppResult<SharingManifest> {
    use crate::error::AppError;

    let state_guard = state.read().await;

    // Construct manifest URL
    let manifest_url = if share_url.ends_with('/') {
        format!("{}manifest", share_url)
    } else {
        format!("{}/manifest", share_url)
    };

    tracing::info!("[SHARE] Fetching manifest from {}...", manifest_url);

    // Build request with optional password header
    let mut request = state_guard.http_client.get(&manifest_url);
    if let Some(pwd) = &password {
        request = request.header("X-Share-Password", pwd);
    }

    let response = request
        .send()
        .await
        .map_err(|e| AppError::Network(format!("Failed to fetch manifest: {}", e)))?;

    // Check for password-required response
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err(AppError::Auth("PASSWORD_REQUIRED".to_string()));
    }

    // Check for invalid password (403 Forbidden with INVALID_PASSWORD body)
    if response.status() == reqwest::StatusCode::FORBIDDEN {
        let body = response.text().await.unwrap_or_default();
        if body.contains("INVALID_PASSWORD") {
            return Err(AppError::Auth("INVALID_PASSWORD".to_string()));
        }
        return Err(AppError::Network("Manifest fetch failed: access denied".to_string()));
    }

    if !response.status().is_success() {
        return Err(AppError::Network(format!(
            "Manifest fetch failed with status: {}",
            response.status()
        )));
    }

    let manifest: SharingManifest = response
        .json()
        .await
        .map_err(|e| AppError::Custom(format!("Failed to parse manifest: {}", e)))?;

    Ok(manifest)
}

/// Restore shares from database on app startup
/// This recreates tunnels with new public URLs for previously active shares
#[tauri::command]
pub async fn restore_shares(
    state: State<'_, SharedState>,
    running_shares: State<'_, RunningShares>,
    app: AppHandle,
) -> AppResult<Vec<ActiveShare>> {
    let state_guard = state.read().await;

    // Get all persistent shares from database
    let persistent_shares = crate::db::shares::get_all_shares(&state_guard.db).await?;

    if persistent_shares.is_empty() {
        tracing::info!("[SHARE] No shares to restore");
        return Ok(vec![]);
    }

    tracing::info!(
        "[SHARE] Restoring {} shares from database...",
        persistent_shares.len()
    );

    let mut restored_shares = Vec::new();
    let mut failed_share_ids = Vec::new();

    for persistent in persistent_shares {
        let package_path = std::path::PathBuf::from(&persistent.package_path);

        // Check if package file still exists
        if !package_path.exists() {
            tracing::warn!(
                "[SHARE] Package file no longer exists, removing share: {}",
                persistent.package_path
            );
            failed_share_ids.push(persistent.share_id.clone());
            continue;
        }

        // Start the share with a new tunnel (will get new public URL)
        match server::start_share_with_password_hash(
            &state_guard.data_dir,
            &package_path,
            &persistent.instance_name,
            persistent.get_provider(),
            persistent.password_hash.clone(),
            app.clone(),
            running_shares.inner().clone(),
        )
        .await
        {
            Ok(share) => {
                tracing::info!(
                    "[SHARE] Restored share for '{}' with new URL: {:?}",
                    persistent.instance_name,
                    share.public_url
                );

                // Update the database with the new share_id
                // First delete the old entry, then save the new one
                let _ = crate::db::shares::delete_share(&state_guard.db, &persistent.share_id).await;
                let _ = crate::db::shares::save_share(
                    &state_guard.db,
                    &share.share_id,
                    &share.instance_name,
                    &share.package_path,
                    share.provider,
                    share.password_hash.as_deref(),
                    share.file_size,
                )
                .await;

                restored_shares.push(share);
            }
            Err(e) => {
                tracing::error!(
                    "[SHARE] Failed to restore share for '{}': {}",
                    persistent.instance_name,
                    e
                );
                failed_share_ids.push(persistent.share_id.clone());
            }
        }
    }

    // Clean up failed shares from database
    for share_id in failed_share_ids {
        let _ = crate::db::shares::delete_share(&state_guard.db, &share_id).await;
    }

    tracing::info!(
        "[SHARE] Restored {}/{} shares",
        restored_shares.len(),
        restored_shares.len()
    );

    Ok(restored_shares)
}

/// Get shares for a specific package path (used when deleting instances)
#[tauri::command]
pub async fn get_shares_for_package(
    state: State<'_, SharedState>,
    running_shares: State<'_, RunningShares>,
    package_path: String,
) -> AppResult<Vec<ActiveShare>> {
    let shares = server::get_active_shares(running_shares.inner().clone()).await;
    let matching: Vec<ActiveShare> = shares
        .into_iter()
        .filter(|s| s.package_path == package_path)
        .collect();

    // Also check database for persistent shares not currently running
    let state_guard = state.read().await;
    let db_shares = crate::db::shares::get_all_shares(&state_guard.db).await?;

    // Return active shares that match the package path
    // (DB shares might not be running yet if app just started)
    Ok(matching)
}
