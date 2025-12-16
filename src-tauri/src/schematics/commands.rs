use crate::error::{AppError, AppResult};
use crate::sharing::server::{ActiveShare, RunningShares, SharingProvider};
use crate::state::SharedState;
use sqlx::Row;
use std::collections::HashMap;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_opener::OpenerExt;
use tracing::info;
use uuid::Uuid;

use super::{
    db, nbt, scanner, sync as sync_ops, ConflictResolution, DetectedSchematic, Schematic,
    SchematicConflict, SchematicFormat, SchematicInstanceLink, SchematicSource, SchematicStats,
    SchematicWithInstances, SyncStatus,
};

/// Get the schematics library directory
fn get_library_dir(data_dir: &std::path::Path) -> std::path::PathBuf {
    data_dir.join("schematics")
}

/// Helper to get unique filename
async fn get_unique_filename(
    dir: &std::path::Path,
    filename: &str,
) -> AppResult<String> {
    let target = dir.join(filename);
    if !target.exists() {
        return Ok(filename.to_string());
    }

    let (base, ext) = filename
        .rsplit_once('.')
        .map(|(b, e)| (b.to_string(), format!(".{}", e)))
        .unwrap_or_else(|| (filename.to_string(), String::new()));

    for i in 1..100 {
        let new_name = format!("{}_{}{}", base, i, ext);
        let new_path = dir.join(&new_name);
        if !new_path.exists() {
            return Ok(new_name);
        }
    }

    Err(AppError::Schematic(
        "Could not find unique filename".to_string(),
    ))
}

/// Get all schematics from the library
#[tauri::command]
pub async fn get_schematics(state: State<'_, SharedState>) -> AppResult<Vec<Schematic>> {
    let state = state.read().await;
    db::get_all_schematics(&state.db).await
}

/// Get schematics with their instance info
#[tauri::command]
pub async fn get_schematics_with_instances(
    state: State<'_, SharedState>,
) -> AppResult<Vec<SchematicWithInstances>> {
    let state = state.read().await;

    // Batch fetch: schematics, all links, and instance names in parallel
    let (schematics, all_links, instance_rows) = tokio::try_join!(
        db::get_all_schematics(&state.db),
        db::get_all_links(&state.db),
        async {
            sqlx::query("SELECT id, name FROM instances")
                .fetch_all(&state.db)
                .await
                .map_err(|e| crate::error::AppError::from(e))
        }
    )?;

    // Build instance name lookup map
    let instance_map: HashMap<String, String> = instance_rows
        .into_iter()
        .map(|row| {
            let id: String = row.get("id");
            let name: String = row.get("name");
            (id, name)
        })
        .collect();

    // Group links by schematic_id (O(n) instead of O(n*m) N+1 queries)
    let mut links_by_schematic: HashMap<String, Vec<_>> = HashMap::new();
    for link in all_links {
        links_by_schematic
            .entry(link.schematic_id.clone())
            .or_default()
            .push(link);
    }

    // Build result
    let result: Vec<_> = schematics
        .into_iter()
        .map(|schematic| {
            let instances = links_by_schematic
                .remove(&schematic.id)
                .unwrap_or_default()
                .into_iter()
                .filter_map(|link| {
                    let instance_name = instance_map.get(&link.instance_id)?.clone();
                    Some(super::SchematicInstanceInfo {
                        instance_id: link.instance_id,
                        instance_name,
                        instance_path: link.instance_path,
                        sync_status: link.sync_status,
                    })
                })
                .collect();

            SchematicWithInstances { schematic, instances }
        })
        .collect();

    Ok(result)
}

/// Get schematics for a specific instance
#[tauri::command]
pub async fn get_instance_schematics(
    state: State<'_, SharedState>,
    instance_id: String,
) -> AppResult<Vec<Schematic>> {
    let state = state.read().await;
    let links = db::get_instance_links(&state.db, &instance_id).await?;

    let mut schematics = Vec::with_capacity(links.len());
    for link in links {
        if let Some(schematic) = db::get_schematic_by_id(&state.db, &link.schematic_id).await? {
            schematics.push(schematic);
        }
    }

    Ok(schematics)
}

/// Get schematic statistics
#[tauri::command]
pub async fn get_schematic_stats(state: State<'_, SharedState>) -> AppResult<SchematicStats> {
    let state = state.read().await;
    db::get_stats(&state.db).await
}

/// Import a schematic from a file path
#[tauri::command]
pub async fn import_schematic(
    state: State<'_, SharedState>,
    file_path: String,
    name: Option<String>,
) -> AppResult<Schematic> {
    let state = state.read().await;
    let source_path = std::path::Path::new(&file_path);

    if !source_path.exists() {
        return Err(AppError::Schematic("File not found".to_string()));
    }

    let library_dir = get_library_dir(&state.data_dir);
    tokio::fs::create_dir_all(&library_dir).await?;

    // Get filename
    let filename = source_path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| AppError::Schematic("Invalid filename".to_string()))?
        .to_string();

    // Calculate hash
    let file_hash = scanner::calculate_file_hash(source_path).await?;

    // Check if already exists
    if let Some(existing) = db::get_schematic_by_hash(&state.db, &file_hash).await? {
        return Ok(existing);
    }

    // Copy to library
    let library_filename = get_unique_filename(&library_dir, &filename).await?;
    let library_path = library_dir.join(&library_filename);
    tokio::fs::copy(source_path, &library_path).await?;

    // Get metadata
    let file_metadata = tokio::fs::metadata(source_path).await?;
    let nbt_metadata = nbt::extract_metadata(source_path).unwrap_or_default();

    let ext = source_path.extension().and_then(|e| e.to_str()).unwrap_or("");
    let format = SchematicFormat::from_extension(ext).unwrap_or(SchematicFormat::Schem);

    let now = chrono::Utc::now().to_rfc3339();
    let display_name = name.unwrap_or_else(|| {
        filename
            .rsplit_once('.')
            .map(|(n, _)| n.to_string())
            .unwrap_or_else(|| filename.clone())
    });

    // Author is locked if extracted from file (protects original creator)
    let author_locked = nbt_metadata.author.is_some();

    let schematic = Schematic {
        id: Uuid::new_v4().to_string(),
        name: display_name,
        filename: library_filename.clone(),
        format,
        file_hash,
        file_size_bytes: file_metadata.len(),
        library_path: Some(library_filename),
        dimensions: nbt_metadata.dimensions,
        author: nbt_metadata.author,
        author_locked,
        description: None,
        mc_version: nbt_metadata.mc_version,
        is_favorite: false,
        tags: Vec::new(),
        created_at: now.clone(),
        updated_at: now,
    };

    db::insert_schematic(&state.db, &schematic).await?;

    info!("Imported schematic: {}", schematic.name);

    Ok(schematic)
}

/// Import a schematic from an instance to the library
#[tauri::command]
pub async fn import_schematic_from_instance(
    state: State<'_, SharedState>,
    instance_id: String,
    instance_path: String,
) -> AppResult<Schematic> {
    let state = state.read().await;

    // Get instance game_dir
    let row = sqlx::query("SELECT game_dir FROM instances WHERE id = ?")
        .bind(&instance_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::Schematic("Instance not found".to_string()))?;

    let game_dir: String = row.get("game_dir");

    let instances_dir = state.get_instances_dir().await;
    let instance_dir = instances_dir.join(&game_dir);
    let library_dir = get_library_dir(&state.data_dir);

    let schematic =
        sync_ops::import_to_library(&instance_dir, &library_dir, &instance_path, &state.db).await?;

    // Create link
    let link = SchematicInstanceLink {
        id: Uuid::new_v4().to_string(),
        schematic_id: schematic.id.clone(),
        instance_id: instance_id.clone(),
        instance_path,
        source: SchematicSource::Both,
        sync_status: SyncStatus::Synced,
        last_synced_at: Some(chrono::Utc::now().to_rfc3339()),
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    db::insert_link(&state.db, &link).await?;

    Ok(schematic)
}

/// Delete a schematic
#[tauri::command]
pub async fn delete_schematic(
    state: State<'_, SharedState>,
    schematic_id: String,
    delete_from_instances: bool,
) -> AppResult<()> {
    let state = state.read().await;

    let schematic = db::get_schematic_by_id(&state.db, &schematic_id)
        .await?
        .ok_or_else(|| AppError::Schematic("Schematic not found".to_string()))?;

    // Delete from instances if requested
    if delete_from_instances {
        let rows = sqlx::query("SELECT id, game_dir FROM instances")
            .fetch_all(&state.db)
            .await?;

        let instances: Vec<(String, String)> = rows
            .into_iter()
            .map(|row| {
                let id: String = row.get("id");
                let game_dir: String = row.get("game_dir");
                (id, game_dir)
            })
            .collect();

        let instances_dir = state.get_instances_dir().await;
        sync_ops::delete_from_instances(&state.db, &instances_dir, &schematic_id, &instances)
            .await?;
    } else {
        // Just delete links
        db::delete_all_links_for_schematic(&state.db, &schematic_id).await?;
    }

    // Delete from library
    if let Some(lib_path) = &schematic.library_path {
        let library_dir = get_library_dir(&state.data_dir);
        let file_path = library_dir.join(lib_path);
        if file_path.exists() {
            tokio::fs::remove_file(&file_path).await?;
        }
    }

    // Delete cloud sync record
    db::delete_cloud_sync(&state.db, &schematic_id).await?;

    // Delete from database
    db::delete_schematic(&state.db, &schematic_id).await?;

    info!("Deleted schematic: {}", schematic.name);

    Ok(())
}

/// Copy schematic to instances
#[tauri::command]
pub async fn copy_schematic_to_instances(
    state: State<'_, SharedState>,
    schematic_id: String,
    instance_ids: Vec<String>,
    target_folder: String,
) -> AppResult<u32> {
    let state = state.read().await;

    let schematic = db::get_schematic_by_id(&state.db, &schematic_id)
        .await?
        .ok_or_else(|| AppError::Schematic("Schematic not found".to_string()))?;

    let library_dir = get_library_dir(&state.data_dir);
    let instances_dir = state.get_instances_dir().await;

    let mut copied = 0;

    for instance_id in instance_ids {
        let row = sqlx::query("SELECT game_dir, is_server FROM instances WHERE id = ?")
            .bind(&instance_id)
            .fetch_optional(&state.db)
            .await?;

        if let Some(row) = row {
            let game_dir: String = row.get("game_dir");
            let is_server: i32 = row.try_get("is_server").unwrap_or(0);
            let is_server = is_server != 0;

            let instance_dir = instances_dir.join(&game_dir);

            match sync_ops::copy_to_instance(
                &library_dir,
                &instance_dir,
                &schematic,
                &target_folder,
                is_server,
            )
            .await
            {
                Ok(instance_path) => {
                    // Create link
                    let link = SchematicInstanceLink {
                        id: Uuid::new_v4().to_string(),
                        schematic_id: schematic_id.clone(),
                        instance_id: instance_id.clone(),
                        instance_path,
                        source: SchematicSource::Library,
                        sync_status: SyncStatus::Synced,
                        last_synced_at: Some(chrono::Utc::now().to_rfc3339()),
                        created_at: chrono::Utc::now().to_rfc3339(),
                    };
                    let _ = db::insert_link(&state.db, &link).await;
                    copied += 1;
                }
                Err(e) => {
                    tracing::warn!("Failed to copy to instance {}: {}", instance_id, e);
                }
            }
        }
    }

    info!(
        "Copied schematic {} to {} instances",
        schematic.name, copied
    );

    Ok(copied)
}

/// Toggle favorite status
#[tauri::command]
pub async fn toggle_schematic_favorite(
    state: State<'_, SharedState>,
    schematic_id: String,
) -> AppResult<bool> {
    let state = state.read().await;
    db::toggle_favorite(&state.db, &schematic_id).await
}

/// Update schematic tags
#[tauri::command]
pub async fn update_schematic_tags(
    state: State<'_, SharedState>,
    schematic_id: String,
    tags: Vec<String>,
) -> AppResult<()> {
    let state = state.read().await;
    db::update_tags(&state.db, &schematic_id, &tags).await
}

/// Update schematic name/description/author
#[tauri::command]
pub async fn update_schematic_metadata(
    state: State<'_, SharedState>,
    schematic_id: String,
    name: Option<String>,
    description: Option<String>,
    author: Option<String>,
) -> AppResult<()> {
    let state = state.read().await;

    let mut schematic = db::get_schematic_by_id(&state.db, &schematic_id)
        .await?
        .ok_or_else(|| AppError::Schematic("Schematic not found".to_string()))?;

    if let Some(name) = name {
        schematic.name = name;
    }
    if let Some(desc) = description {
        schematic.description = Some(desc);
    }
    if let Some(author) = author {
        // Only allow author modification if not locked (author wasn't from original file)
        if schematic.author_locked {
            return Err(AppError::Schematic(
                "Cannot modify author: original author is protected".to_string(),
            ));
        }
        schematic.author = if author.is_empty() { None } else { Some(author) };
    }
    schematic.updated_at = chrono::Utc::now().to_rfc3339();

    db::update_schematic(&state.db, &schematic).await
}

/// Scan all instances for schematics
#[tauri::command]
pub async fn scan_instance_schematics(
    state: State<'_, SharedState>,
) -> AppResult<HashMap<String, Vec<DetectedSchematic>>> {
    let state = state.read().await;

    let rows = sqlx::query("SELECT id, game_dir, is_server FROM instances")
        .fetch_all(&state.db)
        .await?;

    let instances: Vec<(String, String, bool)> = rows
        .into_iter()
        .map(|row| {
            let id: String = row.get("id");
            let game_dir: String = row.get("game_dir");
            let is_server: i32 = row.try_get("is_server").unwrap_or(0);
            (id, game_dir, is_server != 0)
        })
        .collect();

    let instances_dir = state.get_instances_dir().await;
    let library_dir = get_library_dir(&state.data_dir);

    // Get library hashes for marking
    let library_schematics = scanner::scan_library(&library_dir).await.unwrap_or_default();
    let library_hashes: std::collections::HashSet<_> = library_schematics
        .iter()
        .map(|s| s.file_hash.clone())
        .collect();

    let mut results = scanner::scan_all_instances(&instances_dir, &instances).await?;

    // Mark which ones are in library
    for schematics in results.values_mut() {
        for schematic in schematics.iter_mut() {
            schematic.in_library = library_hashes.contains(&schematic.file_hash);
        }
    }

    info!("Scanned {} instances for schematics", instances.len());

    Ok(results)
}

/// Get schematic conflicts
#[tauri::command]
pub async fn get_schematic_conflicts(
    state: State<'_, SharedState>,
) -> AppResult<Vec<SchematicConflict>> {
    let state = state.read().await;

    let rows = sqlx::query("SELECT id, name, game_dir, is_server FROM instances")
        .fetch_all(&state.db)
        .await?;

    let instances: Vec<(String, String, String, bool)> = rows
        .into_iter()
        .map(|row| {
            let id: String = row.get("id");
            let name: String = row.get("name");
            let game_dir: String = row.get("game_dir");
            let is_server: i32 = row.try_get("is_server").unwrap_or(0);
            (id, name, game_dir, is_server != 0)
        })
        .collect();

    let instances_dir = state.get_instances_dir().await;
    let library_dir = get_library_dir(&state.data_dir);

    sync_ops::check_conflicts(&state.db, &library_dir, &instances_dir, &instances).await
}

/// Resolve a conflict
#[tauri::command]
pub async fn resolve_schematic_conflict(
    state: State<'_, SharedState>,
    schematic_id: String,
    instance_id: String,
    resolution: String, // "keep_library", "keep_instance", "keep_both"
) -> AppResult<()> {
    let state = state.read().await;

    let resolution = match resolution.as_str() {
        "keep_library" => ConflictResolution::KeepLibrary,
        "keep_instance" => ConflictResolution::KeepInstance,
        "keep_both" => ConflictResolution::KeepBoth,
        _ => return Err(AppError::Schematic("Invalid resolution".to_string())),
    };

    let row = sqlx::query("SELECT game_dir FROM instances WHERE id = ?")
        .bind(&instance_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::Schematic("Instance not found".to_string()))?;

    let game_dir: String = row.get("game_dir");

    let instances_dir = state.get_instances_dir().await;
    let library_dir = get_library_dir(&state.data_dir);

    sync_ops::resolve_conflict(
        &state.db,
        &library_dir,
        &instances_dir,
        &schematic_id,
        &instance_id,
        &game_dir,
        resolution,
    )
    .await
}

/// Open the schematics library folder
#[tauri::command]
pub async fn open_schematics_folder(
    state: State<'_, SharedState>,
    app: AppHandle,
) -> AppResult<()> {
    let state = state.read().await;
    let library_dir = get_library_dir(&state.data_dir);

    tokio::fs::create_dir_all(&library_dir).await?;

    app.opener()
        .open_path(library_dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| AppError::Schematic(format!("Failed to open folder: {}", e)))?;

    Ok(())
}

/// Get all unique tags used across schematics
#[tauri::command]
pub async fn get_all_schematic_tags(state: State<'_, SharedState>) -> AppResult<Vec<String>> {
    let state = state.read().await;

    let schematics = db::get_all_schematics(&state.db).await?;

    let mut tags: std::collections::HashSet<String> = std::collections::HashSet::new();
    for schematic in schematics {
        for tag in schematic.tags {
            tags.insert(tag);
        }
    }

    let mut tags: Vec<_> = tags.into_iter().collect();
    tags.sort();

    Ok(tags)
}

// ============================================================================
// Schematic Sharing Commands
// ============================================================================

/// Start sharing a schematic via tunnel
#[tauri::command]
pub async fn start_schematic_share(
    state: State<'_, SharedState>,
    running_shares: State<'_, RunningShares>,
    app: AppHandle,
    schematic_id: String,
    provider: Option<String>,
    password: Option<String>,
) -> AppResult<ActiveShare> {
    let state_guard = state.read().await;

    // Get schematic
    let schematic = db::get_schematic_by_id(&state_guard.db, &schematic_id)
        .await?
        .ok_or_else(|| AppError::Schematic("Schematic not found".to_string()))?;

    // Get file path
    let library_path = schematic
        .library_path
        .ok_or_else(|| AppError::Schematic("Schematic not in library".to_string()))?;

    let library_dir = get_library_dir(&state_guard.data_dir);
    let file_path = library_dir.join(&library_path);

    if !file_path.exists() {
        return Err(AppError::Schematic("Schematic file not found".to_string()));
    }

    // Parse provider
    let provider = match provider.as_deref() {
        Some("cloudflare") => SharingProvider::Cloudflare,
        _ => SharingProvider::Bore,
    };

    let data_dir = state_guard.data_dir.clone();
    let db = state_guard.db.clone();
    drop(state_guard); // Release lock before async operation

    // Start share using existing sharing infrastructure
    let share = crate::sharing::server::start_share(
        &data_dir,
        &file_path,
        &schematic.name,
        provider,
        password,
        app.clone(),
        running_shares.inner().clone(),
    )
    .await?;

    // Save to database for persistence across restarts
    crate::db::shares::save_share(
        &db,
        &share.share_id,
        &share.instance_name,
        &share.package_path,
        share.provider,
        share.password_hash.as_deref(),
        share.file_size,
    )
    .await?;

    info!(
        "[SCHEMATIC SHARE] Started sharing schematic: {} with ID {}",
        schematic.name, share.share_id
    );

    Ok(share)
}

/// Stop sharing a schematic
#[tauri::command]
pub async fn stop_schematic_share(
    state: State<'_, SharedState>,
    running_shares: State<'_, RunningShares>,
    share_id: String,
) -> AppResult<()> {
    // Stop the tunnel/server
    crate::sharing::server::stop_share(&share_id, running_shares.inner().clone()).await?;

    // Remove from database
    let state_guard = state.read().await;
    crate::db::shares::delete_share(&state_guard.db, &share_id).await?;

    info!("[SCHEMATIC SHARE] Stopped sharing schematic: {}", share_id);

    Ok(())
}

/// Get active schematic shares
#[tauri::command]
pub async fn get_schematic_shares(
    running_shares: State<'_, RunningShares>,
) -> AppResult<Vec<ActiveShare>> {
    let shares = running_shares.read().await;

    // Filter to only schematic shares (files ending with schematic extensions)
    let schematic_extensions = ["schem", "schematic", "litematic", "nbt"];

    let active: Vec<ActiveShare> = shares
        .values()
        .filter(|session| {
            let path = &session.info.package_path;
            schematic_extensions
                .iter()
                .any(|ext| path.to_lowercase().ends_with(ext))
        })
        .map(|session| {
            let mut info = session.info.clone();
            // Update live stats
            if let Ok(count) = session.download_count.try_read() {
                info.download_count = *count;
            }
            if let Ok(bytes) = session.uploaded_bytes.try_read() {
                info.uploaded_bytes = *bytes;
            }
            info
        })
        .collect();

    Ok(active)
}

/// Download and import a shared schematic
#[tauri::command]
pub async fn download_shared_schematic(
    state: State<'_, SharedState>,
    app: AppHandle,
    url: String,
    password: Option<String>,
) -> AppResult<Schematic> {
    let state_guard = state.read().await;
    let library_dir = get_library_dir(&state_guard.data_dir);
    tokio::fs::create_dir_all(&library_dir).await?;

    // Parse URL to extract auth token
    // Format: https://xxx.trycloudflare.com/TOKEN or bore.pub:PORT/TOKEN
    let parts: Vec<&str> = url.trim_end_matches('/').rsplitn(2, '/').collect();
    if parts.len() != 2 {
        return Err(AppError::Schematic("Invalid share URL".to_string()));
    }

    let auth_token = parts[0];
    let base_url = parts[1];

    // Build download URL
    let download_url = format!("{}/{}/download", base_url, auth_token);

    info!("[SCHEMATIC SHARE] Downloading from: {}", download_url);

    // Create HTTP client
    let mut headers = reqwest::header::HeaderMap::new();
    if let Some(pwd) = &password {
        headers.insert(
            "X-Share-Password",
            reqwest::header::HeaderValue::from_str(pwd)
                .map_err(|_| AppError::Schematic("Invalid password".to_string()))?,
        );
    }

    let client = reqwest::Client::builder()
        .default_headers(headers)
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| AppError::Schematic(format!("Failed to create client: {}", e)))?;

    // Get file info first
    let head_response = client
        .head(&download_url)
        .send()
        .await
        .map_err(|e| AppError::Schematic(format!("Failed to connect: {}", e)))?;

    if !head_response.status().is_success() {
        if head_response.status() == reqwest::StatusCode::UNAUTHORIZED {
            return Err(AppError::Schematic("Invalid password".to_string()));
        }
        return Err(AppError::Schematic(format!(
            "Download failed: {}",
            head_response.status()
        )));
    }

    // Get filename from Content-Disposition header
    let filename = head_response
        .headers()
        .get("content-disposition")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| {
            s.split("filename=")
                .nth(1)
                .map(|f| f.trim_matches('"').to_string())
        })
        .unwrap_or_else(|| format!("shared_{}.schem", Uuid::new_v4()));

    let _total_size = head_response
        .headers()
        .get("content-length")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0);

    // Emit progress
    let _ = app.emit(
        "schematic-download-progress",
        serde_json::json!({
            "stage": "downloading",
            "progress": 0,
            "filename": filename
        }),
    );

    // Download file
    let response = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| AppError::Schematic(format!("Download failed: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::Schematic(format!(
            "Download failed: {}",
            response.status()
        )));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| AppError::Schematic(format!("Failed to read response: {}", e)))?;

    // Emit progress
    let _ = app.emit(
        "schematic-download-progress",
        serde_json::json!({
            "stage": "downloading",
            "progress": 100,
            "filename": filename
        }),
    );

    // Save to temp file first
    let temp_path = library_dir.join(format!(".download_{}", Uuid::new_v4()));
    tokio::fs::write(&temp_path, &bytes).await?;

    // Import using existing function
    let file_path_str = temp_path.to_string_lossy().to_string();
    drop(state_guard); // Release lock

    let result = import_schematic(state, file_path_str, Some(filename.clone())).await;

    // Clean up temp file
    let _ = tokio::fs::remove_file(&temp_path).await;

    // Emit completion
    let _ = app.emit(
        "schematic-download-progress",
        serde_json::json!({
            "stage": "complete",
            "progress": 100,
            "filename": filename
        }),
    );

    result
}

/// Fetch manifest/info of a shared schematic before downloading
#[tauri::command]
pub async fn fetch_schematic_share_info(
    url: String,
    password: Option<String>,
) -> AppResult<serde_json::Value> {
    // Parse URL
    let parts: Vec<&str> = url.trim_end_matches('/').rsplitn(2, '/').collect();
    if parts.len() != 2 {
        return Err(AppError::Schematic("Invalid share URL".to_string()));
    }

    let auth_token = parts[0];
    let base_url = parts[1];

    // Build info URL
    let info_url = format!("{}/{}", base_url, auth_token);

    let mut headers = reqwest::header::HeaderMap::new();
    if let Some(pwd) = &password {
        headers.insert(
            "X-Share-Password",
            reqwest::header::HeaderValue::from_str(pwd)
                .map_err(|_| AppError::Schematic("Invalid password".to_string()))?,
        );
    }

    let client = reqwest::Client::builder()
        .default_headers(headers)
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| AppError::Schematic(format!("Failed to create client: {}", e)))?;

    // HEAD request to get file info
    let response = client
        .head(&info_url)
        .send()
        .await
        .map_err(|e| AppError::Schematic(format!("Failed to connect: {}", e)))?;

    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err(AppError::Schematic("Password required".to_string()));
    }

    if !response.status().is_success() {
        return Err(AppError::Schematic(format!(
            "Failed to get info: {}",
            response.status()
        )));
    }

    let filename = response
        .headers()
        .get("content-disposition")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| {
            s.split("filename=")
                .nth(1)
                .map(|f| f.trim_matches('"').to_string())
        })
        .unwrap_or_else(|| "unknown.schem".to_string());

    let file_size = response
        .headers()
        .get("content-length")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0);

    Ok(serde_json::json!({
        "filename": filename,
        "file_size": file_size,
        "needs_password": false
    }))
}
