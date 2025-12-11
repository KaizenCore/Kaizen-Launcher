use crate::error::{AppError, AppResult};
use crate::minecraft::versions::{self, filter_versions, VersionDetails, VersionInfo};
use crate::state::SharedState;
use serde::{Deserialize, Serialize};
use tauri::State;
use tracing::warn;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MinecraftVersionList {
    pub latest_release: String,
    pub latest_snapshot: String,
    pub versions: Vec<VersionInfo>,
}

/// Get the list of available Minecraft versions
#[tauri::command]
pub async fn get_minecraft_versions(
    state: State<'_, SharedState>,
    include_snapshots: Option<bool>,
) -> AppResult<MinecraftVersionList> {
    let state = state.read().await;

    // Try to fetch fresh manifest from Mojang
    let manifest = match versions::fetch_version_manifest(&state.http_client).await {
        Ok(manifest) => {
            // Cache it for offline use
            if let Err(e) = versions::cache_version_manifest(&state.data_dir, &manifest).await {
                warn!("Failed to cache version manifest: {}", e);
            }
            manifest
        }
        Err(e) => {
            // Try to use cached version
            warn!(
                "Failed to fetch version manifest: {}. Trying cache...",
                e
            );
            versions::load_cached_manifest(&state.data_dir)
                .await?
                .ok_or_else(|| {
                    AppError::Network(
                        "Failed to fetch versions and no cached data available".to_string(),
                    )
                })?
        }
    };

    let include_snapshots = include_snapshots.unwrap_or(false);
    let filtered_versions = filter_versions(&manifest.versions, include_snapshots);

    Ok(MinecraftVersionList {
        latest_release: manifest.latest.release,
        latest_snapshot: manifest.latest.snapshot,
        versions: filtered_versions,
    })
}

/// Get full details for a specific Minecraft version
#[tauri::command]
pub async fn get_minecraft_version_details(
    state: State<'_, SharedState>,
    version_id: String,
) -> AppResult<VersionDetails> {
    let state = state.read().await;

    // Check if we have it cached locally
    if let Some(details) = versions::load_version_details(&state.data_dir, &version_id).await? {
        return Ok(details);
    }

    // Need to fetch it - first get the manifest to find the URL
    let manifest = versions::fetch_version_manifest(&state.http_client).await?;

    let version_info = manifest
        .versions
        .iter()
        .find(|v| v.id == version_id)
        .ok_or_else(|| AppError::Instance(format!("Version {} not found", version_id)))?;

    // Fetch the full version details
    let details = versions::fetch_version_details(&state.http_client, &version_info.url).await?;

    // Cache it for future use
    versions::save_version_details(&state.data_dir, &version_id, &details).await?;

    Ok(details)
}

/// Refresh the version cache
#[tauri::command]
pub async fn refresh_minecraft_versions(state: State<'_, SharedState>) -> AppResult<()> {
    let state = state.read().await;

    let manifest = versions::fetch_version_manifest(&state.http_client).await?;
    versions::cache_version_manifest(&state.data_dir, &manifest).await?;

    Ok(())
}
