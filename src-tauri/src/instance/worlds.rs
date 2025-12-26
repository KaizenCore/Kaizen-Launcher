//! World management module for Minecraft instances
//! Handles listing, backup, restore, delete, duplicate, and rename operations for worlds

use crate::error::{AppError, AppResult};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use chrono::Local;
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};
use tokio::fs;
use zip::write::SimpleFileOptions;

/// Information about a Minecraft world
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldInfo {
    /// World directory name (e.g., "New World" for clients, "world" for servers)
    pub name: String,
    /// Display name extracted from level.dat if available
    pub display_name: String,
    /// Total size in bytes
    pub size_bytes: u64,
    /// Last modified timestamp (ISO 8601)
    pub last_modified: String,
    /// Base64 encoded icon.png data URL, if present
    pub icon_data_url: Option<String>,
    /// Number of backups available for this world
    pub backup_count: u32,
    /// Whether this is a server world (grouped dimensions)
    pub is_server_world: bool,
    /// List of folders that make up this world (e.g., ["world"] for client, ["world", "world_nether", "world_the_end"] for server)
    pub world_folders: Vec<String>,
}

/// Information about a world backup
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupInfo {
    /// Backup filename (e.g., "world_2024-01-15_14-30-00.zip")
    pub filename: String,
    /// Creation timestamp (ISO 8601)
    pub timestamp: String,
    /// Backup file size in bytes
    pub size_bytes: u64,
    /// Name of the world this backup belongs to
    pub world_name: String,
    /// Base64 encoded icon.png data URL, if available
    pub icon_data_url: Option<String>,
}

/// Progress event for backup/restore operations
#[derive(Debug, Clone, Serialize)]
pub struct BackupProgressEvent {
    pub instance_id: String,
    pub world_name: String,
    pub progress: u32, // 0-100
    pub message: String,
}

/// Global backup info for centralized backup management page
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlobalBackupInfo {
    pub instance_id: String,
    pub instance_name: String,
    pub world_name: String,
    pub filename: String,
    pub timestamp: String,
    pub size_bytes: u64,
    pub is_server: bool,
    /// Base64 encoded icon.png data URL, if available
    pub icon_data_url: Option<String>,
}

/// Backup storage statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupStats {
    pub total_size: u64,
    pub backup_count: u32,
    pub instance_count: u32,
}

/// Get the saves directory for a client instance
fn get_saves_dir(instance_dir: &Path) -> PathBuf {
    instance_dir.join("saves")
}

/// Get the backups directory for an instance
pub fn get_backups_dir(data_dir: &Path, instance_id: &str) -> PathBuf {
    data_dir.join("backups").join(instance_id)
}

/// Get the backups directory for a specific world
pub fn get_world_backups_dir(data_dir: &Path, instance_id: &str, world_name: &str) -> PathBuf {
    get_backups_dir(data_dir, instance_id).join(world_name)
}

/// Calculate the total size of a directory recursively (skips symlinks to avoid loops)
pub async fn get_directory_size(path: &Path) -> AppResult<u64> {
    let mut total_size = 0u64;

    if !path.exists() {
        return Ok(0);
    }

    let mut entries = fs::read_dir(path)
        .await
        .map_err(|e| AppError::Io(format!("Failed to read directory: {}", e)))?;

    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| AppError::Io(format!("Failed to read entry: {}", e)))?
    {
        // Use symlink_metadata to NOT follow symlinks (avoids infinite loops)
        let metadata = match fs::symlink_metadata(entry.path()).await {
            Ok(m) => m,
            Err(_) => continue, // Skip entries we can't read
        };

        // Skip symlinks entirely to avoid circular references
        if metadata.file_type().is_symlink() {
            continue;
        }

        if metadata.is_dir() {
            total_size += Box::pin(get_directory_size(&entry.path())).await?;
        } else {
            total_size += metadata.len();
        }
    }

    Ok(total_size)
}

/// Read and encode icon.png from a world directory
pub async fn read_world_icon(world_path: &Path) -> Option<String> {
    let icon_path = world_path.join("icon.png");
    if !icon_path.exists() {
        return None;
    }

    match fs::read(&icon_path).await {
        Ok(data) => {
            let encoded = BASE64.encode(&data);
            Some(format!("data:image/png;base64,{}", encoded))
        }
        Err(_) => None,
    }
}

/// Get the icon path for a backup file (same name with .png extension)
fn get_backup_icon_path(backup_path: &Path) -> PathBuf {
    backup_path.with_extension("png")
}

/// Read the icon associated with a backup file
pub async fn read_backup_icon(backup_path: &Path) -> Option<String> {
    let icon_path = get_backup_icon_path(backup_path);
    if !icon_path.exists() {
        return None;
    }

    match fs::read(&icon_path).await {
        Ok(data) => {
            let encoded = BASE64.encode(&data);
            Some(format!("data:image/png;base64,{}", encoded))
        }
        Err(_) => None,
    }
}

/// Save world icon for a backup
async fn save_backup_icon(
    instance_dir: &Path,
    world_name: &str,
    world_folders: &[String],
    backup_path: &Path,
) -> Option<()> {
    // Determine the world path to get the icon from
    let world_path = if world_folders.first().map(|s| s.as_str()) == Some("world")
        || world_folders
            .first()
            .map(|s| s == "world_nether" || s == "world_the_end")
            .unwrap_or(false)
    {
        // Server world - icon is in world/ folder
        instance_dir.join("world")
    } else {
        // Client world - icon is in saves/world_name folder
        instance_dir.join("saves").join(world_name)
    };

    let icon_path = world_path.join("icon.png");
    if !icon_path.exists() {
        return None;
    }

    // Read the icon and save it alongside the backup
    let icon_data = fs::read(&icon_path).await.ok()?;
    let backup_icon_path = get_backup_icon_path(backup_path);
    fs::write(&backup_icon_path, &icon_data).await.ok()?;

    Some(())
}

/// Get the last modified time of a directory (latest file modification)
pub async fn get_last_modified(path: &Path) -> AppResult<String> {
    let metadata = fs::metadata(path)
        .await
        .map_err(|e| AppError::Io(format!("Failed to get metadata: {}", e)))?;

    let modified = metadata
        .modified()
        .map_err(|e| AppError::Io(format!("Failed to get modified time: {}", e)))?;

    let datetime: chrono::DateTime<Local> = modified.into();
    Ok(datetime.format("%Y-%m-%dT%H:%M:%S").to_string())
}

/// Count backups for a specific world
pub async fn count_world_backups(data_dir: &Path, instance_id: &str, world_name: &str) -> u32 {
    let backups_dir = get_world_backups_dir(data_dir, instance_id, world_name);
    if !backups_dir.exists() {
        return 0;
    }

    let mut count = 0;
    if let Ok(mut entries) = fs::read_dir(&backups_dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let filename = entry.file_name().to_string_lossy().to_string();
            if filename.ends_with(".zip") {
                count += 1;
            }
        }
    }
    count
}

/// List worlds for a client instance (from saves/ directory)
pub async fn get_worlds_for_client(
    instance_dir: &Path,
    data_dir: &Path,
    instance_id: &str,
) -> AppResult<Vec<WorldInfo>> {
    let saves_dir = get_saves_dir(instance_dir);

    // Create saves directory if it doesn't exist
    if !saves_dir.exists() {
        fs::create_dir_all(&saves_dir)
            .await
            .map_err(|e| AppError::Io(format!("Failed to create saves directory: {}", e)))?;
        return Ok(vec![]);
    }

    let mut worlds = Vec::new();
    let mut entries = fs::read_dir(&saves_dir)
        .await
        .map_err(|e| AppError::Io(format!("Failed to read saves directory: {}", e)))?;

    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| AppError::Io(format!("Failed to read entry: {}", e)))?
    {
        // Use symlink_metadata to avoid following symlinks
        let metadata = match fs::symlink_metadata(entry.path()).await {
            Ok(m) => m,
            Err(_) => continue,
        };

        // Skip symlinks
        if metadata.file_type().is_symlink() {
            continue;
        }

        if metadata.is_dir() {
            let world_path = entry.path();
            let world_name = entry.file_name().to_string_lossy().to_string();

            // Check if this is a valid world (has level.dat)
            if !world_path.join("level.dat").exists() {
                continue;
            }

            // Calculate size with timeout protection
            let size_bytes = tokio::time::timeout(
                std::time::Duration::from_secs(5),
                get_directory_size(&world_path),
            )
            .await
            .unwrap_or(Ok(0))
            .unwrap_or(0);

            let last_modified = get_last_modified(&world_path)
                .await
                .unwrap_or_else(|_| "Unknown".to_string());

            let icon_data_url = read_world_icon(&world_path).await;
            let backup_count = count_world_backups(data_dir, instance_id, &world_name).await;

            worlds.push(WorldInfo {
                name: world_name.clone(),
                display_name: world_name,
                size_bytes,
                last_modified,
                icon_data_url,
                backup_count,
                is_server_world: false,
                world_folders: vec![entry.file_name().to_string_lossy().to_string()],
            });
        }
    }

    // Sort by last modified (most recent first)
    worlds.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));

    Ok(worlds)
}

/// List worlds for a server instance (world/, world_nether/, world_the_end/)
pub async fn get_worlds_for_server(
    instance_dir: &Path,
    data_dir: &Path,
    instance_id: &str,
) -> AppResult<Vec<WorldInfo>> {
    let world_dir = instance_dir.join("world");

    // Check if main world exists
    if !world_dir.exists() || !world_dir.join("level.dat").exists() {
        return Ok(vec![]);
    }

    // Collect all world folders
    let mut world_folders = vec!["world".to_string()];
    let mut total_size = get_directory_size(&world_dir).await.unwrap_or(0);

    // Check for nether
    let nether_dir = instance_dir.join("world_nether");
    if nether_dir.exists() {
        world_folders.push("world_nether".to_string());
        total_size += get_directory_size(&nether_dir).await.unwrap_or(0);
    }

    // Check for end
    let end_dir = instance_dir.join("world_the_end");
    if end_dir.exists() {
        world_folders.push("world_the_end".to_string());
        total_size += get_directory_size(&end_dir).await.unwrap_or(0);
    }

    let last_modified = get_last_modified(&world_dir)
        .await
        .unwrap_or_else(|_| "Unknown".to_string());
    let icon_data_url = read_world_icon(&world_dir).await;
    let backup_count = count_world_backups(data_dir, instance_id, "world").await;

    Ok(vec![WorldInfo {
        name: "world".to_string(),
        display_name: "Server World".to_string(),
        size_bytes: total_size,
        last_modified,
        icon_data_url,
        backup_count,
        is_server_world: true,
        world_folders,
    }])
}

/// Create a ZIP backup of a world
pub async fn create_backup(
    instance_dir: &Path,
    data_dir: &Path,
    instance_id: &str,
    world_name: &str,
    world_folders: &[String],
    app: Option<&AppHandle>,
) -> AppResult<BackupInfo> {
    let backups_dir = get_world_backups_dir(data_dir, instance_id, world_name);

    // Create backups directory
    fs::create_dir_all(&backups_dir)
        .await
        .map_err(|e| AppError::Io(format!("Failed to create backups directory: {}", e)))?;

    // Generate backup filename with timestamp
    let timestamp = Local::now();
    let filename = format!(
        "{}_{}.zip",
        world_name,
        timestamp.format("%Y-%m-%d_%H-%M-%S")
    );
    let backup_path = backups_dir.join(&filename);

    // Emit progress
    if let Some(app) = app {
        let _ = app.emit(
            "backup-progress",
            BackupProgressEvent {
                instance_id: instance_id.to_string(),
                world_name: world_name.to_string(),
                progress: 0,
                message: "Starting backup...".to_string(),
            },
        );
    }

    // Create ZIP file synchronously (zip crate is not async)
    let instance_dir_clone = instance_dir.to_path_buf();
    let backup_path_clone = backup_path.clone();
    let world_folders_clone: Vec<String> = world_folders.to_vec();

    tokio::task::spawn_blocking(move || {
        let file = std::fs::File::create(&backup_path_clone)
            .map_err(|e| AppError::Io(format!("Failed to create backup file: {}", e)))?;
        let mut zip = zip::ZipWriter::new(file);
        let options = SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .compression_level(Some(6));

        for folder_name in &world_folders_clone {
            let folder_path = if folder_name == "world"
                || folder_name == "world_nether"
                || folder_name == "world_the_end"
            {
                // Server world - folder is at instance root
                instance_dir_clone.join(folder_name)
            } else {
                // Client world - folder is in saves/
                instance_dir_clone.join("saves").join(folder_name)
            };

            if folder_path.exists() {
                add_directory_to_zip(&mut zip, &folder_path, folder_name, &options)?;
            }
        }

        zip.finish()
            .map_err(|e| AppError::Io(format!("Failed to finalize ZIP: {}", e)))?;

        Ok::<(), AppError>(())
    })
    .await
    .map_err(|e| AppError::Io(format!("Backup task failed: {}", e)))??;

    // Save the world icon alongside the backup
    let _ = save_backup_icon(instance_dir, world_name, world_folders, &backup_path).await;

    // Read the icon for the response
    let icon_data_url = read_backup_icon(&backup_path).await;

    // Emit completion
    if let Some(app) = app {
        let _ = app.emit(
            "backup-progress",
            BackupProgressEvent {
                instance_id: instance_id.to_string(),
                world_name: world_name.to_string(),
                progress: 100,
                message: "Backup complete!".to_string(),
            },
        );
    }

    // Get backup file size
    let metadata = fs::metadata(&backup_path)
        .await
        .map_err(|e| AppError::Io(format!("Failed to get backup metadata: {}", e)))?;

    Ok(BackupInfo {
        filename,
        timestamp: timestamp.format("%Y-%m-%dT%H:%M:%S").to_string(),
        size_bytes: metadata.len(),
        world_name: world_name.to_string(),
        icon_data_url,
    })
}

/// Recursively add a directory to a ZIP archive (skips symlinks)
pub fn add_directory_to_zip<W: Write + std::io::Seek>(
    zip: &mut zip::ZipWriter<W>,
    dir_path: &Path,
    _base_name: &str,
    options: &SimpleFileOptions,
) -> AppResult<()> {
    // Don't follow symlinks to avoid infinite loops
    let walker = walkdir::WalkDir::new(dir_path).follow_links(false);

    for entry in walker {
        let entry = entry.map_err(|e| AppError::Io(format!("Failed to walk directory: {}", e)))?;
        let path = entry.path();

        // Skip symlinks entirely
        if entry.path_is_symlink() {
            continue;
        }

        let relative_path = path
            .strip_prefix(dir_path.parent().unwrap_or(dir_path))
            .map_err(|e| AppError::Io(format!("Failed to get relative path: {}", e)))?;

        let zip_path = relative_path.to_string_lossy().replace('\\', "/");

        if path.is_dir() {
            zip.add_directory(format!("{}/", zip_path), *options)
                .map_err(|e| AppError::Io(format!("Failed to add directory to ZIP: {}", e)))?;
        } else {
            zip.start_file(&zip_path, *options)
                .map_err(|e| AppError::Io(format!("Failed to start file in ZIP: {}", e)))?;

            let mut file = std::fs::File::open(path)
                .map_err(|e| AppError::Io(format!("Failed to open file: {}", e)))?;
            let mut buffer = Vec::new();
            file.read_to_end(&mut buffer)
                .map_err(|e| AppError::Io(format!("Failed to read file: {}", e)))?;
            zip.write_all(&buffer)
                .map_err(|e| AppError::Io(format!("Failed to write to ZIP: {}", e)))?;
        }
    }

    Ok(())
}

/// List available backups for a world
pub async fn list_backups(
    data_dir: &Path,
    instance_id: &str,
    world_name: &str,
) -> AppResult<Vec<BackupInfo>> {
    let backups_dir = get_world_backups_dir(data_dir, instance_id, world_name);

    if !backups_dir.exists() {
        return Ok(vec![]);
    }

    let mut backups = Vec::new();
    let mut entries = fs::read_dir(&backups_dir)
        .await
        .map_err(|e| AppError::Io(format!("Failed to read backups directory: {}", e)))?;

    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| AppError::Io(format!("Failed to read entry: {}", e)))?
    {
        let filename = entry.file_name().to_string_lossy().to_string();
        if filename.ends_with(".zip") {
            let backup_path = entry.path();
            let metadata = entry.metadata().await.ok();
            let size_bytes = metadata.map(|m| m.len()).unwrap_or(0);

            // Extract timestamp from filename (format: world_YYYY-MM-DD_HH-MM-SS.zip)
            let timestamp = filename
                .strip_prefix(&format!("{}_", world_name))
                .and_then(|s| s.strip_suffix(".zip"))
                .map(|s| s.replace('_', "T").replace('-', ":"))
                .unwrap_or_else(|| "Unknown".to_string());

            // Convert back to proper ISO format
            let timestamp = if timestamp.len() >= 19 {
                format!(
                    "{}-{}-{}T{}:{}:{}",
                    &timestamp[0..4],
                    &timestamp[5..7],
                    &timestamp[8..10],
                    &timestamp[11..13],
                    &timestamp[14..16],
                    &timestamp[17..19]
                )
            } else {
                timestamp
            };

            // Read the backup icon if available
            let icon_data_url = read_backup_icon(&backup_path).await;

            backups.push(BackupInfo {
                filename,
                timestamp,
                size_bytes,
                world_name: world_name.to_string(),
                icon_data_url,
            });
        }
    }

    // Sort by timestamp (most recent first)
    backups.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

    Ok(backups)
}

/// Restore a world from a backup
pub async fn restore_backup(
    instance_dir: &Path,
    data_dir: &Path,
    instance_id: &str,
    world_name: &str,
    backup_filename: &str,
    is_server: bool,
    app: Option<&AppHandle>,
) -> AppResult<()> {
    let backup_path =
        get_world_backups_dir(data_dir, instance_id, world_name).join(backup_filename);

    if !backup_path.exists() {
        return Err(AppError::Instance("Backup file not found".to_string()));
    }

    // Emit progress
    if let Some(app) = app {
        let _ = app.emit(
            "restore-progress",
            BackupProgressEvent {
                instance_id: instance_id.to_string(),
                world_name: world_name.to_string(),
                progress: 0,
                message: "Starting restore...".to_string(),
            },
        );
    }

    // Determine target directory
    let target_base = if is_server {
        instance_dir.to_path_buf()
    } else {
        instance_dir.join("saves")
    };

    // Delete existing world folders
    if is_server {
        // Delete server world folders
        for folder in &["world", "world_nether", "world_the_end"] {
            let folder_path = instance_dir.join(folder);
            if folder_path.exists() {
                fs::remove_dir_all(&folder_path)
                    .await
                    .map_err(|e| AppError::Io(format!("Failed to remove {}: {}", folder, e)))?;
            }
        }
    } else {
        // Delete client world folder
        let world_path = instance_dir.join("saves").join(world_name);
        if world_path.exists() {
            fs::remove_dir_all(&world_path)
                .await
                .map_err(|e| AppError::Io(format!("Failed to remove world: {}", e)))?;
        }
    }

    // Extract backup
    let backup_path_clone = backup_path.clone();
    let target_base_clone = target_base.clone();

    tokio::task::spawn_blocking(move || {
        let file = std::fs::File::open(&backup_path_clone)
            .map_err(|e| AppError::Io(format!("Failed to open backup: {}", e)))?;
        let mut archive = zip::ZipArchive::new(file)
            .map_err(|e| AppError::Io(format!("Failed to read ZIP: {}", e)))?;

        for i in 0..archive.len() {
            let mut file = archive
                .by_index(i)
                .map_err(|e| AppError::Io(format!("Failed to read ZIP entry: {}", e)))?;

            let outpath = target_base_clone.join(file.name());

            if file.name().ends_with('/') {
                std::fs::create_dir_all(&outpath)
                    .map_err(|e| AppError::Io(format!("Failed to create directory: {}", e)))?;
            } else {
                if let Some(parent) = outpath.parent() {
                    std::fs::create_dir_all(parent)
                        .map_err(|e| AppError::Io(format!("Failed to create parent dir: {}", e)))?;
                }
                let mut outfile = std::fs::File::create(&outpath)
                    .map_err(|e| AppError::Io(format!("Failed to create file: {}", e)))?;
                std::io::copy(&mut file, &mut outfile)
                    .map_err(|e| AppError::Io(format!("Failed to extract file: {}", e)))?;
            }
        }

        Ok::<(), AppError>(())
    })
    .await
    .map_err(|e| AppError::Io(format!("Restore task failed: {}", e)))??;

    // Emit completion
    if let Some(app) = app {
        let _ = app.emit(
            "restore-progress",
            BackupProgressEvent {
                instance_id: instance_id.to_string(),
                world_name: world_name.to_string(),
                progress: 100,
                message: "Restore complete!".to_string(),
            },
        );
    }

    Ok(())
}

/// Delete a world
pub async fn delete_world(instance_dir: &Path, world_name: &str, is_server: bool) -> AppResult<()> {
    if is_server {
        // Delete all server world folders
        for folder in &["world", "world_nether", "world_the_end"] {
            let folder_path = instance_dir.join(folder);
            if folder_path.exists() {
                fs::remove_dir_all(&folder_path)
                    .await
                    .map_err(|e| AppError::Io(format!("Failed to delete {}: {}", folder, e)))?;
            }
        }
    } else {
        // Delete client world folder
        let world_path = instance_dir.join("saves").join(world_name);
        if !world_path.exists() {
            return Err(AppError::Instance("World not found".to_string()));
        }
        fs::remove_dir_all(&world_path)
            .await
            .map_err(|e| AppError::Io(format!("Failed to delete world: {}", e)))?;
    }

    Ok(())
}

/// Duplicate a world with a new name
pub async fn duplicate_world(
    instance_dir: &Path,
    data_dir: &Path,
    instance_id: &str,
    world_name: &str,
    new_name: &str,
    is_server: bool,
) -> AppResult<WorldInfo> {
    if is_server {
        return Err(AppError::Instance(
            "Cannot duplicate server worlds".to_string(),
        ));
    }

    let saves_dir = instance_dir.join("saves");
    let source_path = saves_dir.join(world_name);
    let dest_path = saves_dir.join(new_name);

    if !source_path.exists() {
        return Err(AppError::Instance("Source world not found".to_string()));
    }

    if dest_path.exists() {
        return Err(AppError::Instance(
            "A world with this name already exists".to_string(),
        ));
    }

    // Copy directory recursively
    copy_directory(&source_path, &dest_path).await?;

    // Return info about the new world
    let size_bytes = get_directory_size(&dest_path).await.unwrap_or(0);
    let last_modified = get_last_modified(&dest_path)
        .await
        .unwrap_or_else(|_| "Unknown".to_string());
    let icon_data_url = read_world_icon(&dest_path).await;
    let backup_count = count_world_backups(data_dir, instance_id, new_name).await;

    Ok(WorldInfo {
        name: new_name.to_string(),
        display_name: new_name.to_string(),
        size_bytes,
        last_modified,
        icon_data_url,
        backup_count,
        is_server_world: false,
        world_folders: vec![new_name.to_string()],
    })
}

/// Recursively copy a directory (skips symlinks to avoid loops)
async fn copy_directory(src: &Path, dst: &Path) -> AppResult<()> {
    fs::create_dir_all(dst)
        .await
        .map_err(|e| AppError::Io(format!("Failed to create directory: {}", e)))?;

    let mut entries = fs::read_dir(src)
        .await
        .map_err(|e| AppError::Io(format!("Failed to read directory: {}", e)))?;

    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| AppError::Io(format!("Failed to read entry: {}", e)))?
    {
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        // Use symlink_metadata to NOT follow symlinks
        let metadata = match fs::symlink_metadata(&src_path).await {
            Ok(m) => m,
            Err(_) => continue, // Skip entries we can't read
        };

        // Skip symlinks to avoid infinite loops
        if metadata.file_type().is_symlink() {
            continue;
        }

        if metadata.is_dir() {
            Box::pin(copy_directory(&src_path, &dst_path)).await?;
        } else {
            fs::copy(&src_path, &dst_path)
                .await
                .map_err(|e| AppError::Io(format!("Failed to copy file: {}", e)))?;
        }
    }

    Ok(())
}

/// Rename a world
pub async fn rename_world(
    instance_dir: &Path,
    data_dir: &Path,
    instance_id: &str,
    old_name: &str,
    new_name: &str,
    is_server: bool,
) -> AppResult<WorldInfo> {
    if is_server {
        return Err(AppError::Instance(
            "Cannot rename server worlds".to_string(),
        ));
    }

    let saves_dir = instance_dir.join("saves");
    let old_path = saves_dir.join(old_name);
    let new_path = saves_dir.join(new_name);

    if !old_path.exists() {
        return Err(AppError::Instance("World not found".to_string()));
    }

    if new_path.exists() {
        return Err(AppError::Instance(
            "A world with this name already exists".to_string(),
        ));
    }

    // Rename directory
    fs::rename(&old_path, &new_path)
        .await
        .map_err(|e| AppError::Io(format!("Failed to rename world: {}", e)))?;

    // Also rename backups directory if it exists
    let old_backups_dir = get_world_backups_dir(data_dir, instance_id, old_name);
    let new_backups_dir = get_world_backups_dir(data_dir, instance_id, new_name);
    if old_backups_dir.exists() {
        let _ = fs::rename(&old_backups_dir, &new_backups_dir).await;
    }

    // Return info about the renamed world
    let size_bytes = get_directory_size(&new_path).await.unwrap_or(0);
    let last_modified = get_last_modified(&new_path)
        .await
        .unwrap_or_else(|_| "Unknown".to_string());
    let icon_data_url = read_world_icon(&new_path).await;
    let backup_count = count_world_backups(data_dir, instance_id, new_name).await;

    Ok(WorldInfo {
        name: new_name.to_string(),
        display_name: new_name.to_string(),
        size_bytes,
        last_modified,
        icon_data_url,
        backup_count,
        is_server_world: false,
        world_folders: vec![new_name.to_string()],
    })
}

/// Delete a specific backup file
pub async fn delete_backup(
    data_dir: &Path,
    instance_id: &str,
    world_name: &str,
    backup_filename: &str,
) -> AppResult<()> {
    let backup_path =
        get_world_backups_dir(data_dir, instance_id, world_name).join(backup_filename);

    if !backup_path.exists() {
        return Err(AppError::Instance("Backup not found".to_string()));
    }

    fs::remove_file(&backup_path)
        .await
        .map_err(|e| AppError::Io(format!("Failed to delete backup: {}", e)))?;

    Ok(())
}

/// Backup all worlds in an instance (for auto-backup before launch)
pub async fn auto_backup_all_worlds(
    instance_dir: &Path,
    data_dir: &Path,
    instance_id: &str,
    is_server: bool,
    app: Option<&AppHandle>,
) -> AppResult<Vec<BackupInfo>> {
    let mut backups = Vec::new();

    let worlds = if is_server {
        get_worlds_for_server(instance_dir, data_dir, instance_id).await?
    } else {
        get_worlds_for_client(instance_dir, data_dir, instance_id).await?
    };

    for world in worlds {
        let backup = create_backup(
            instance_dir,
            data_dir,
            instance_id,
            &world.name,
            &world.world_folders,
            app,
        )
        .await?;
        backups.push(backup);
    }

    Ok(backups)
}

/// List all backups across all instances
/// Returns a list of GlobalBackupInfo with instance metadata
pub async fn list_all_backups(
    data_dir: &Path,
    instances: &[(String, String, bool)], // Vec of (instance_id, instance_name, is_server)
) -> AppResult<Vec<GlobalBackupInfo>> {
    let backups_base_dir = data_dir.join("backups");

    if !backups_base_dir.exists() {
        return Ok(vec![]);
    }

    let mut all_backups = Vec::new();

    // Iterate through instance backup directories
    let mut instance_dirs = fs::read_dir(&backups_base_dir)
        .await
        .map_err(|e| AppError::Io(format!("Failed to read backups directory: {}", e)))?;

    while let Some(instance_entry) = instance_dirs
        .next_entry()
        .await
        .map_err(|e| AppError::Io(format!("Failed to read instance entry: {}", e)))?
    {
        let instance_id = instance_entry.file_name().to_string_lossy().to_string();
        let instance_path = instance_entry.path();

        // Skip the "instances" folder - it's used for instance backups, not world backups
        if instance_id == "instances" {
            continue;
        }

        // Skip if not a directory
        let metadata = match fs::symlink_metadata(&instance_path).await {
            Ok(m) => m,
            Err(_) => continue,
        };
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            continue;
        }

        // Find instance info
        let (instance_name, is_server) = instances
            .iter()
            .find(|(id, _, _)| id == &instance_id)
            .map(|(_, name, is_server)| (name.clone(), *is_server))
            .unwrap_or_else(|| {
                (
                    format!("Unknown ({})", &instance_id[..8.min(instance_id.len())]),
                    false,
                )
            });

        // Iterate through world directories within this instance
        let mut world_dirs = match fs::read_dir(&instance_path).await {
            Ok(d) => d,
            Err(_) => continue,
        };

        while let Some(world_entry) = world_dirs.next_entry().await.unwrap_or(None) {
            let world_name = world_entry.file_name().to_string_lossy().to_string();
            let world_path = world_entry.path();

            // Skip if not a directory
            let world_metadata = match fs::symlink_metadata(&world_path).await {
                Ok(m) => m,
                Err(_) => continue,
            };
            if !world_metadata.is_dir() || world_metadata.file_type().is_symlink() {
                continue;
            }

            // Iterate through backup files
            let mut backup_files = match fs::read_dir(&world_path).await {
                Ok(d) => d,
                Err(_) => continue,
            };

            while let Some(backup_entry) = backup_files.next_entry().await.unwrap_or(None) {
                let filename = backup_entry.file_name().to_string_lossy().to_string();

                // Only process ZIP files
                if !filename.ends_with(".zip") {
                    continue;
                }

                let backup_path = backup_entry.path();
                let backup_metadata = match backup_entry.metadata().await {
                    Ok(m) => m,
                    Err(_) => continue,
                };

                // Extract timestamp from filename
                let timestamp = filename
                    .strip_prefix(&format!("{}_", world_name))
                    .and_then(|s| s.strip_suffix(".zip"))
                    .map(|s| {
                        // Convert YYYY-MM-DD_HH-MM-SS to ISO format
                        if s.len() >= 19 {
                            format!(
                                "{}-{}-{}T{}:{}:{}",
                                &s[0..4],
                                &s[5..7],
                                &s[8..10],
                                &s[11..13],
                                &s[14..16],
                                &s[17..19]
                            )
                        } else {
                            s.to_string()
                        }
                    })
                    .unwrap_or_else(|| "Unknown".to_string());

                // Read the backup icon if available
                let icon_data_url = read_backup_icon(&backup_path).await;

                all_backups.push(GlobalBackupInfo {
                    instance_id: instance_id.clone(),
                    instance_name: instance_name.clone(),
                    world_name: world_name.clone(),
                    filename,
                    timestamp,
                    size_bytes: backup_metadata.len(),
                    is_server,
                    icon_data_url,
                });
            }
        }
    }

    // Sort by timestamp (newest first)
    all_backups.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

    Ok(all_backups)
}

/// Get backup storage statistics
pub async fn get_backup_storage_stats(data_dir: &Path) -> AppResult<BackupStats> {
    let backups_base_dir = data_dir.join("backups");

    if !backups_base_dir.exists() {
        return Ok(BackupStats {
            total_size: 0,
            backup_count: 0,
            instance_count: 0,
        });
    }

    let mut total_size = 0u64;
    let mut backup_count = 0u32;
    let mut instance_ids = std::collections::HashSet::new();

    let mut instance_dirs = fs::read_dir(&backups_base_dir)
        .await
        .map_err(|e| AppError::Io(format!("Failed to read backups directory: {}", e)))?;

    while let Some(instance_entry) = instance_dirs.next_entry().await.unwrap_or(None) {
        let instance_path = instance_entry.path();
        let instance_id = instance_entry.file_name().to_string_lossy().to_string();

        // Skip the "instances" folder - it's used for instance backups, not world backups
        if instance_id == "instances" {
            continue;
        }

        let metadata = match fs::symlink_metadata(&instance_path).await {
            Ok(m) => m,
            Err(_) => continue,
        };
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            continue;
        }

        let mut has_backups = false;

        let mut world_dirs = match fs::read_dir(&instance_path).await {
            Ok(d) => d,
            Err(_) => continue,
        };

        while let Some(world_entry) = world_dirs.next_entry().await.unwrap_or(None) {
            let world_path = world_entry.path();

            let world_metadata = match fs::symlink_metadata(&world_path).await {
                Ok(m) => m,
                Err(_) => continue,
            };
            if !world_metadata.is_dir() || world_metadata.file_type().is_symlink() {
                continue;
            }

            let mut backup_files = match fs::read_dir(&world_path).await {
                Ok(d) => d,
                Err(_) => continue,
            };

            while let Some(backup_entry) = backup_files.next_entry().await.unwrap_or(None) {
                let filename = backup_entry.file_name().to_string_lossy().to_string();
                if filename.ends_with(".zip") {
                    if let Ok(m) = backup_entry.metadata().await {
                        total_size += m.len();
                        backup_count += 1;
                        has_backups = true;
                    }
                }
            }
        }

        if has_backups {
            instance_ids.insert(instance_id);
        }
    }

    Ok(BackupStats {
        total_size,
        backup_count,
        instance_count: instance_ids.len() as u32,
    })
}

/// Restore a backup to a different instance
pub async fn restore_backup_to_instance(
    data_dir: &Path,
    instances_dir: &Path,
    source_instance_id: &str,
    world_name: &str,
    backup_filename: &str,
    target_instance_game_dir: &str,
    target_is_server: bool,
    app: Option<&AppHandle>,
) -> AppResult<()> {
    let backup_path =
        get_world_backups_dir(data_dir, source_instance_id, world_name).join(backup_filename);

    if !backup_path.exists() {
        return Err(AppError::Instance("Backup file not found".to_string()));
    }

    let target_instance_dir = instances_dir.join(target_instance_game_dir);

    // Emit progress
    if let Some(app) = app {
        let _ = app.emit(
            "restore-progress",
            BackupProgressEvent {
                instance_id: target_instance_game_dir.to_string(),
                world_name: world_name.to_string(),
                progress: 0,
                message: "Starting restore...".to_string(),
            },
        );
    }

    // Determine target directory
    let target_base = if target_is_server {
        target_instance_dir.clone()
    } else {
        target_instance_dir.join("saves")
    };

    // Create target directory if needed
    fs::create_dir_all(&target_base)
        .await
        .map_err(|e| AppError::Io(format!("Failed to create target directory: {}", e)))?;

    // Delete existing world folders if present
    if target_is_server {
        for folder in &["world", "world_nether", "world_the_end"] {
            let folder_path = target_instance_dir.join(folder);
            if folder_path.exists() {
                let _ = fs::remove_dir_all(&folder_path).await;
            }
        }
    } else {
        let world_path = target_instance_dir.join("saves").join(world_name);
        if world_path.exists() {
            let _ = fs::remove_dir_all(&world_path).await;
        }
    }

    // Extract backup
    let backup_path_clone = backup_path.clone();
    let target_base_clone = target_base.clone();

    tokio::task::spawn_blocking(move || {
        let file = std::fs::File::open(&backup_path_clone)
            .map_err(|e| AppError::Io(format!("Failed to open backup: {}", e)))?;
        let mut archive = zip::ZipArchive::new(file)
            .map_err(|e| AppError::Io(format!("Failed to read ZIP: {}", e)))?;

        for i in 0..archive.len() {
            let mut file = archive
                .by_index(i)
                .map_err(|e| AppError::Io(format!("Failed to read ZIP entry: {}", e)))?;

            let outpath = target_base_clone.join(file.name());

            if file.name().ends_with('/') {
                std::fs::create_dir_all(&outpath)
                    .map_err(|e| AppError::Io(format!("Failed to create directory: {}", e)))?;
            } else {
                if let Some(parent) = outpath.parent() {
                    std::fs::create_dir_all(parent)
                        .map_err(|e| AppError::Io(format!("Failed to create parent dir: {}", e)))?;
                }
                let mut outfile = std::fs::File::create(&outpath)
                    .map_err(|e| AppError::Io(format!("Failed to create file: {}", e)))?;
                std::io::copy(&mut file, &mut outfile)
                    .map_err(|e| AppError::Io(format!("Failed to extract file: {}", e)))?;
            }
        }

        Ok::<(), AppError>(())
    })
    .await
    .map_err(|e| AppError::Io(format!("Restore task failed: {}", e)))??;

    // Emit completion
    if let Some(app) = app {
        let _ = app.emit(
            "restore-progress",
            BackupProgressEvent {
                instance_id: target_instance_game_dir.to_string(),
                world_name: world_name.to_string(),
                progress: 100,
                message: "Restore complete!".to_string(),
            },
        );
    }

    Ok(())
}
