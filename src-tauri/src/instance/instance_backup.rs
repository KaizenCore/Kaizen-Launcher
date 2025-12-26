//! Instance backup module for Kaizen Launcher
//! Handles creating, restoring, and managing complete instance backups

use crate::db::instances::Instance;
use crate::error::{AppError, AppResult};
use crate::instance::worlds::{add_directory_to_zip, get_directory_size};
use chrono::Local;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, Emitter};
use tokio::fs;
use uuid::Uuid;
use zip::write::SimpleFileOptions;

/// Manifest included in each instance backup
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceBackupManifest {
    /// Manifest format version
    pub version: String,
    /// Kaizen Launcher version that created this backup
    pub kaizen_version: String,
    /// Backup creation timestamp (ISO 8601)
    pub created_at: String,
    /// Instance metadata at backup time
    pub instance: InstanceBackupMetadata,
    /// Content statistics
    pub contents: InstanceBackupContents,
    /// Total backup size in bytes
    pub total_size_bytes: u64,
}

/// Instance metadata stored in backup manifest
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceBackupMetadata {
    pub id: String,
    pub name: String,
    pub mc_version: String,
    pub loader: Option<String>,
    pub loader_version: Option<String>,
    pub is_server: bool,
    pub is_proxy: bool,
    pub memory_min_mb: i64,
    pub memory_max_mb: i64,
    pub jvm_args: String,
    pub server_port: i64,
}

/// Content statistics for the backup
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceBackupContents {
    pub mods_count: u32,
    pub mods_size: u64,
    pub config_count: u32,
    pub config_size: u64,
    pub worlds_count: u32,
    pub worlds_size: u64,
    pub libraries_size: u64,
    pub assets_size: u64,
    pub other_size: u64,
}

/// Information about an instance backup
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceBackupInfo {
    pub filename: String,
    pub timestamp: String,
    pub size_bytes: u64,
    pub instance_id: String,
    pub instance_name: String,
    pub mc_version: String,
    pub loader: Option<String>,
    pub is_server: bool,
}

/// Global instance backup info for the Backups page
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlobalInstanceBackupInfo {
    pub instance_id: String,
    pub instance_name: String,
    pub filename: String,
    pub timestamp: String,
    pub size_bytes: u64,
    pub mc_version: String,
    pub loader: Option<String>,
    pub is_server: bool,
}

/// Statistics for instance backups
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceBackupStats {
    pub total_size: u64,
    pub backup_count: u32,
    pub instance_count: u32,
}

/// Progress event for instance backup operations
#[derive(Debug, Clone, Serialize)]
pub struct InstanceBackupProgressEvent {
    pub instance_id: String,
    pub progress: u32,
    pub stage: String,
    pub message: String,
}

/// Restore mode for instance backups
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RestoreMode {
    Replace,
    CreateNew,
}

/// Get the base directory for instance backups
pub fn get_instance_backups_base_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("backups").join("instances")
}

/// Get the backup directory for a specific instance
pub fn get_instance_backup_dir(data_dir: &Path, instance_id: &str) -> PathBuf {
    get_instance_backups_base_dir(data_dir).join(instance_id)
}

/// Emit a progress event
fn emit_progress(app: Option<&AppHandle>, instance_id: &str, progress: u32, stage: &str, message: &str) {
    if let Some(app) = app {
        let _ = app.emit(
            "instance-backup-progress",
            InstanceBackupProgressEvent {
                instance_id: instance_id.to_string(),
                progress,
                stage: stage.to_string(),
                message: message.to_string(),
            },
        );
    }
}

/// Scan instance contents for manifest
async fn scan_instance_contents(instance_dir: &Path, is_server: bool) -> AppResult<InstanceBackupContents> {
    let mut contents = InstanceBackupContents {
        mods_count: 0,
        mods_size: 0,
        config_count: 0,
        config_size: 0,
        worlds_count: 0,
        worlds_size: 0,
        libraries_size: 0,
        assets_size: 0,
        other_size: 0,
    };

    // Count mods/plugins
    let mods_dir = if is_server {
        instance_dir.join("plugins")
    } else {
        instance_dir.join("mods")
    };
    if mods_dir.exists() {
        contents.mods_size = get_directory_size(&mods_dir).await.unwrap_or(0);
        if let Ok(mut entries) = fs::read_dir(&mods_dir).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                if entry.path().extension().map(|e| e == "jar").unwrap_or(false) {
                    contents.mods_count += 1;
                }
            }
        }
    }

    // Count config files
    let config_dir = instance_dir.join("config");
    if config_dir.exists() {
        contents.config_size = get_directory_size(&config_dir).await.unwrap_or(0);
        contents.config_count = count_files_recursive(&config_dir).await;
    }

    // Count worlds
    if is_server {
        let world_dir = instance_dir.join("world");
        if world_dir.exists() {
            contents.worlds_count = 1;
            contents.worlds_size = get_directory_size(&world_dir).await.unwrap_or(0);
            // Add nether and end
            let nether = instance_dir.join("world_nether");
            let end = instance_dir.join("world_the_end");
            if nether.exists() {
                contents.worlds_size += get_directory_size(&nether).await.unwrap_or(0);
            }
            if end.exists() {
                contents.worlds_size += get_directory_size(&end).await.unwrap_or(0);
            }
        }
    } else {
        let saves_dir = instance_dir.join("saves");
        if saves_dir.exists() {
            if let Ok(mut entries) = fs::read_dir(&saves_dir).await {
                while let Ok(Some(entry)) = entries.next_entry().await {
                    if entry.path().is_dir() && entry.path().join("level.dat").exists() {
                        contents.worlds_count += 1;
                        contents.worlds_size += get_directory_size(&entry.path()).await.unwrap_or(0);
                    }
                }
            }
        }
    }

    // Libraries size
    let libraries_dir = instance_dir.join("libraries");
    if libraries_dir.exists() {
        contents.libraries_size = get_directory_size(&libraries_dir).await.unwrap_or(0);
    }

    // Assets size
    let assets_dir = instance_dir.join("assets");
    if assets_dir.exists() {
        contents.assets_size = get_directory_size(&assets_dir).await.unwrap_or(0);
    }

    Ok(contents)
}

/// Count files recursively in a directory
async fn count_files_recursive(dir: &Path) -> u32 {
    let mut count = 0;
    if let Ok(mut entries) = fs::read_dir(dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path.is_dir() {
                count += Box::pin(count_files_recursive(&path)).await;
            } else {
                count += 1;
            }
        }
    }
    count
}

/// Directories to include in backup
fn get_backup_directories(is_server: bool) -> Vec<&'static str> {
    if is_server {
        vec![
            "plugins",
            "config",
            "world",
            "world_nether",
            "world_the_end",
            "libraries",
            "logs",
        ]
    } else {
        vec![
            "mods",
            "config",
            "saves",
            "resourcepacks",
            "shaderpacks",
            "libraries",
            "assets",
            "natives",
            "client",
        ]
    }
}

/// Files to include from root directory
fn get_backup_root_files(is_server: bool) -> Vec<&'static str> {
    if is_server {
        vec![
            "server.properties",
            "eula.txt",
            "bukkit.yml",
            "spigot.yml",
            "paper.yml",
            "paper-global.yml",
            "paper-world-defaults.yml",
            "purpur.yml",
            "velocity.toml",
            "forwarding.secret",
            "server.jar",
            ".installed",
        ]
    } else {
        vec![
            "options.txt",
            "servers.dat",
            ".installed",
            ".forge_modern",
            ".neoforge_modern",
            "neoforge_meta.json",
        ]
    }
}

/// Create a complete backup of an instance
pub async fn create_instance_backup(
    instances_dir: &Path,
    data_dir: &Path,
    instance: &Instance,
    app: Option<&AppHandle>,
) -> AppResult<InstanceBackupInfo> {
    let instance_dir = instances_dir.join(&instance.game_dir);
    let backups_dir = get_instance_backup_dir(data_dir, &instance.id);

    // Create backups directory
    fs::create_dir_all(&backups_dir)
        .await
        .map_err(|e| AppError::Io(format!("Failed to create backups directory: {}", e)))?;

    // Generate backup filename with timestamp
    let timestamp = Local::now();
    let filename = format!("instance_{}.zip", timestamp.format("%Y-%m-%d_%H-%M-%S"));
    let backup_path = backups_dir.join(&filename);

    emit_progress(app, &instance.id, 0, "scanning", "Scanning instance...");

    // Scan instance contents for manifest
    let contents = scan_instance_contents(&instance_dir, instance.is_server).await?;

    // Create manifest
    let manifest = InstanceBackupManifest {
        version: "1.0".to_string(),
        kaizen_version: env!("CARGO_PKG_VERSION").to_string(),
        created_at: timestamp.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
        instance: InstanceBackupMetadata {
            id: instance.id.clone(),
            name: instance.name.clone(),
            mc_version: instance.mc_version.clone(),
            loader: instance.loader.clone(),
            loader_version: instance.loader_version.clone(),
            is_server: instance.is_server,
            is_proxy: instance.is_proxy,
            memory_min_mb: instance.memory_min_mb,
            memory_max_mb: instance.memory_max_mb,
            jvm_args: instance.jvm_args.clone(),
            server_port: instance.server_port,
        },
        contents,
        total_size_bytes: 0,
    };

    emit_progress(app, &instance.id, 10, "compressing", "Creating backup archive...");

    // Create ZIP file (blocking operation)
    let instance_dir_clone = instance_dir.clone();
    let backup_path_clone = backup_path.clone();
    let manifest_clone = manifest.clone();
    let is_server = instance.is_server;
    let instance_id_clone = instance.id.clone();
    let app_clone = app.map(|a| a.clone());

    let total_size = tokio::task::spawn_blocking(move || {
        create_instance_zip(
            &instance_dir_clone,
            &backup_path_clone,
            &manifest_clone,
            is_server,
            &instance_id_clone,
            app_clone.as_ref(),
        )
    })
    .await
    .map_err(|e| AppError::Io(format!("Backup task failed: {}", e)))??;

    emit_progress(app, &instance.id, 100, "complete", "Backup complete!");

    Ok(InstanceBackupInfo {
        filename,
        timestamp: timestamp.format("%Y-%m-%dT%H:%M:%S").to_string(),
        size_bytes: total_size,
        instance_id: instance.id.clone(),
        instance_name: instance.name.clone(),
        mc_version: instance.mc_version.clone(),
        loader: instance.loader.clone(),
        is_server: instance.is_server,
    })
}

/// Create the instance ZIP file (blocking, runs in spawn_blocking)
fn create_instance_zip(
    instance_dir: &Path,
    backup_path: &Path,
    manifest: &InstanceBackupManifest,
    is_server: bool,
    instance_id: &str,
    app: Option<&AppHandle>,
) -> AppResult<u64> {
    let file = std::fs::File::create(backup_path)
        .map_err(|e| AppError::Io(format!("Failed to create backup file: {}", e)))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .compression_level(Some(6));

    // Write manifest first
    let manifest_json = serde_json::to_string_pretty(manifest)
        .map_err(|e| AppError::Io(format!("Failed to serialize manifest: {}", e)))?;
    zip.start_file("backup-manifest.json", options)
        .map_err(|e| AppError::Io(format!("Failed to add manifest to ZIP: {}", e)))?;
    zip.write_all(manifest_json.as_bytes())
        .map_err(|e| AppError::Io(format!("Failed to write manifest: {}", e)))?;

    // Add directories
    let dirs = get_backup_directories(is_server);
    let total_dirs = dirs.len();
    for (i, dir_name) in dirs.iter().enumerate() {
        let dir_path = instance_dir.join(dir_name);
        if dir_path.exists() && dir_path.is_dir() {
            if let Some(app) = app {
                let progress = 10 + ((i as u32 * 80) / total_dirs as u32);
                let _ = app.emit(
                    "instance-backup-progress",
                    InstanceBackupProgressEvent {
                        instance_id: instance_id.to_string(),
                        progress,
                        stage: "compressing".to_string(),
                        message: format!("Compressing {}...", dir_name),
                    },
                );
            }
            add_directory_to_zip(&mut zip, &dir_path, dir_name, &options)?;
        }
    }

    // Add root files
    let root_files = get_backup_root_files(is_server);
    for file_name in root_files {
        let file_path = instance_dir.join(file_name);
        if file_path.exists() && file_path.is_file() {
            zip.start_file(file_name, options)
                .map_err(|e| AppError::Io(format!("Failed to add {} to ZIP: {}", file_name, e)))?;
            let mut file = std::fs::File::open(&file_path)
                .map_err(|e| AppError::Io(format!("Failed to open {}: {}", file_name, e)))?;
            let mut buffer = Vec::new();
            file.read_to_end(&mut buffer)
                .map_err(|e| AppError::Io(format!("Failed to read {}: {}", file_name, e)))?;
            zip.write_all(&buffer)
                .map_err(|e| AppError::Io(format!("Failed to write {}: {}", file_name, e)))?;
        }
    }

    zip.finish()
        .map_err(|e| AppError::Io(format!("Failed to finalize ZIP: {}", e)))?;

    // Get final file size
    let metadata = std::fs::metadata(backup_path)
        .map_err(|e| AppError::Io(format!("Failed to get backup metadata: {}", e)))?;

    Ok(metadata.len())
}

/// List backups for a specific instance
pub async fn list_instance_backups(
    data_dir: &Path,
    instance_id: &str,
    instance_name: &str,
    mc_version: &str,
    loader: Option<&str>,
    is_server: bool,
) -> AppResult<Vec<InstanceBackupInfo>> {
    let backups_dir = get_instance_backup_dir(data_dir, instance_id);

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
        if filename.starts_with("instance_") && filename.ends_with(".zip") {
            let metadata = entry.metadata().await.ok();
            let size_bytes = metadata.map(|m| m.len()).unwrap_or(0);

            // Extract timestamp from filename (format: instance_YYYY-MM-DD_HH-MM-SS.zip)
            let timestamp = filename
                .strip_prefix("instance_")
                .and_then(|s| s.strip_suffix(".zip"))
                .map(|s| {
                    if s.len() >= 19 {
                        format!(
                            "{}-{}-{}T{}:{}:{}",
                            &s[0..4], &s[5..7], &s[8..10], &s[11..13], &s[14..16], &s[17..19]
                        )
                    } else {
                        s.to_string()
                    }
                })
                .unwrap_or_else(|| "Unknown".to_string());

            backups.push(InstanceBackupInfo {
                filename,
                timestamp,
                size_bytes,
                instance_id: instance_id.to_string(),
                instance_name: instance_name.to_string(),
                mc_version: mc_version.to_string(),
                loader: loader.map(|s| s.to_string()),
                is_server,
            });
        }
    }

    // Sort by timestamp (newest first)
    backups.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

    Ok(backups)
}

/// List all instance backups across all instances
pub async fn list_all_instance_backups(
    data_dir: &Path,
    instances: &[(String, String, String, Option<String>, bool)], // (id, name, mc_version, loader, is_server)
) -> AppResult<Vec<GlobalInstanceBackupInfo>> {
    let backups_base_dir = get_instance_backups_base_dir(data_dir);

    if !backups_base_dir.exists() {
        return Ok(vec![]);
    }

    let mut all_backups = Vec::new();

    let mut instance_dirs = fs::read_dir(&backups_base_dir)
        .await
        .map_err(|e| AppError::Io(format!("Failed to read backups directory: {}", e)))?;

    while let Some(instance_entry) = instance_dirs
        .next_entry()
        .await
        .map_err(|e| AppError::Io(format!("Failed to read entry: {}", e)))?
    {
        let instance_id = instance_entry.file_name().to_string_lossy().to_string();
        let instance_path = instance_entry.path();

        // Skip if not a directory
        let metadata = match fs::symlink_metadata(&instance_path).await {
            Ok(m) => m,
            Err(_) => continue,
        };
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            continue;
        }

        // Find instance info
        let (instance_name, mc_version, loader, is_server) = instances
            .iter()
            .find(|(id, _, _, _, _)| id == &instance_id)
            .map(|(_, name, mc, loader, is_server)| {
                (name.clone(), mc.clone(), loader.clone(), *is_server)
            })
            .unwrap_or_else(|| {
                (
                    format!("Unknown ({})", &instance_id[..8.min(instance_id.len())]),
                    "Unknown".to_string(),
                    None,
                    false,
                )
            });

        // Read backup files
        let mut backup_files = match fs::read_dir(&instance_path).await {
            Ok(d) => d,
            Err(_) => continue,
        };

        while let Some(backup_entry) = backup_files.next_entry().await.unwrap_or(None) {
            let filename = backup_entry.file_name().to_string_lossy().to_string();

            if !filename.starts_with("instance_") || !filename.ends_with(".zip") {
                continue;
            }

            let backup_metadata = match backup_entry.metadata().await {
                Ok(m) => m,
                Err(_) => continue,
            };

            // Extract timestamp
            let timestamp = filename
                .strip_prefix("instance_")
                .and_then(|s| s.strip_suffix(".zip"))
                .map(|s| {
                    if s.len() >= 19 {
                        format!(
                            "{}-{}-{}T{}:{}:{}",
                            &s[0..4], &s[5..7], &s[8..10], &s[11..13], &s[14..16], &s[17..19]
                        )
                    } else {
                        s.to_string()
                    }
                })
                .unwrap_or_else(|| "Unknown".to_string());

            all_backups.push(GlobalInstanceBackupInfo {
                instance_id: instance_id.clone(),
                instance_name: instance_name.clone(),
                filename,
                timestamp,
                size_bytes: backup_metadata.len(),
                mc_version: mc_version.clone(),
                loader: loader.clone(),
                is_server,
            });
        }
    }

    // Sort by timestamp (newest first)
    all_backups.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

    Ok(all_backups)
}

/// Delete an instance backup
pub async fn delete_instance_backup(
    data_dir: &Path,
    instance_id: &str,
    backup_filename: &str,
) -> AppResult<()> {
    let backup_path = get_instance_backup_dir(data_dir, instance_id).join(backup_filename);

    if !backup_path.exists() {
        return Err(AppError::Instance("Backup not found".to_string()));
    }

    fs::remove_file(&backup_path)
        .await
        .map_err(|e| AppError::Io(format!("Failed to delete backup: {}", e)))?;

    Ok(())
}

/// Get instance backup statistics
pub async fn get_instance_backup_stats(data_dir: &Path) -> AppResult<InstanceBackupStats> {
    let backups_base_dir = get_instance_backups_base_dir(data_dir);

    if !backups_base_dir.exists() {
        return Ok(InstanceBackupStats {
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

        let metadata = match fs::symlink_metadata(&instance_path).await {
            Ok(m) => m,
            Err(_) => continue,
        };
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            continue;
        }

        let instance_id = instance_entry.file_name().to_string_lossy().to_string();
        let mut has_backups = false;

        let mut backup_files = match fs::read_dir(&instance_path).await {
            Ok(d) => d,
            Err(_) => continue,
        };

        while let Some(backup_entry) = backup_files.next_entry().await.unwrap_or(None) {
            let filename = backup_entry.file_name().to_string_lossy().to_string();
            if filename.starts_with("instance_") && filename.ends_with(".zip") {
                if let Ok(m) = backup_entry.metadata().await {
                    total_size += m.len();
                    backup_count += 1;
                    has_backups = true;
                }
            }
        }

        if has_backups {
            instance_ids.insert(instance_id);
        }
    }

    Ok(InstanceBackupStats {
        total_size,
        backup_count,
        instance_count: instance_ids.len() as u32,
    })
}

/// Read the manifest from a backup file
pub fn read_backup_manifest(backup_path: &Path) -> AppResult<InstanceBackupManifest> {
    let file = std::fs::File::open(backup_path)
        .map_err(|e| AppError::Io(format!("Failed to open backup: {}", e)))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| AppError::Io(format!("Failed to read ZIP: {}", e)))?;

    let mut manifest_file = archive
        .by_name("backup-manifest.json")
        .map_err(|_| AppError::Instance("Backup manifest not found".to_string()))?;

    let mut manifest_json = String::new();
    manifest_file
        .read_to_string(&mut manifest_json)
        .map_err(|e| AppError::Io(format!("Failed to read manifest: {}", e)))?;

    serde_json::from_str(&manifest_json)
        .map_err(|e| AppError::Io(format!("Failed to parse manifest: {}", e)))
}

/// Restore a backup by replacing the existing instance
pub async fn restore_instance_backup_replace(
    instances_dir: &Path,
    data_dir: &Path,
    instance: &Instance,
    backup_filename: &str,
    app: Option<&AppHandle>,
) -> AppResult<()> {
    let backup_path = get_instance_backup_dir(data_dir, &instance.id).join(backup_filename);

    if !backup_path.exists() {
        return Err(AppError::Instance("Backup file not found".to_string()));
    }

    let instance_dir = instances_dir.join(&instance.game_dir);

    emit_progress(app, &instance.id, 0, "preparing", "Preparing to restore...");

    // Delete existing content (but keep the directory)
    let dirs_to_clear = get_backup_directories(instance.is_server);
    for dir_name in dirs_to_clear {
        let dir_path = instance_dir.join(dir_name);
        if dir_path.exists() {
            let _ = fs::remove_dir_all(&dir_path).await;
        }
    }

    // Delete root files
    let files_to_clear = get_backup_root_files(instance.is_server);
    for file_name in files_to_clear {
        let file_path = instance_dir.join(file_name);
        if file_path.exists() {
            let _ = fs::remove_file(&file_path).await;
        }
    }

    emit_progress(app, &instance.id, 20, "extracting", "Extracting backup...");

    // Extract backup
    let backup_path_clone = backup_path.clone();
    let instance_dir_clone = instance_dir.clone();
    let instance_id_clone = instance.id.clone();
    let app_clone = app.map(|a| a.clone());

    tokio::task::spawn_blocking(move || {
        extract_instance_backup(&backup_path_clone, &instance_dir_clone, &instance_id_clone, app_clone.as_ref())
    })
    .await
    .map_err(|e| AppError::Io(format!("Restore task failed: {}", e)))??;

    emit_progress(app, &instance.id, 100, "complete", "Restore complete!");

    Ok(())
}

/// Restore a backup by creating a new instance
pub async fn restore_instance_backup_new(
    db: &SqlitePool,
    instances_dir: &Path,
    data_dir: &Path,
    source_instance_id: &str,
    backup_filename: &str,
    new_name: Option<String>,
    app: Option<&AppHandle>,
) -> AppResult<Instance> {
    let backup_path = get_instance_backup_dir(data_dir, source_instance_id).join(backup_filename);

    if !backup_path.exists() {
        return Err(AppError::Instance("Backup file not found".to_string()));
    }

    emit_progress(app, source_instance_id, 0, "preparing", "Reading backup manifest...");

    // Read manifest to get instance info
    let manifest = read_backup_manifest(&backup_path)?;

    // Generate new name if not provided
    let base_name = new_name.unwrap_or_else(|| {
        format!("{} (Backup)", manifest.instance.name)
    });

    // Resolve unique name
    let final_name = resolve_unique_name(db, &base_name).await?;
    let game_dir = sanitize_game_dir(&final_name);

    // Check if game_dir already exists
    let mut unique_game_dir = game_dir.clone();
    let mut counter = 1;
    while instances_dir.join(&unique_game_dir).exists() {
        unique_game_dir = format!("{}-{}", game_dir, counter);
        counter += 1;
    }

    let new_instance_dir = instances_dir.join(&unique_game_dir);

    // Create directory
    fs::create_dir_all(&new_instance_dir)
        .await
        .map_err(|e| AppError::Io(format!("Failed to create instance directory: {}", e)))?;

    emit_progress(app, source_instance_id, 20, "extracting", "Extracting backup...");

    // Extract backup
    let backup_path_clone = backup_path.clone();
    let new_instance_dir_clone = new_instance_dir.clone();
    let source_instance_id_clone = source_instance_id.to_string();
    let app_clone = app.map(|a| a.clone());

    tokio::task::spawn_blocking(move || {
        extract_instance_backup(&backup_path_clone, &new_instance_dir_clone, &source_instance_id_clone, app_clone.as_ref())
    })
    .await
    .map_err(|e| AppError::Io(format!("Restore task failed: {}", e)))??;

    emit_progress(app, source_instance_id, 80, "creating", "Creating instance entry...");

    // Create instance in database
    let new_id = Uuid::new_v4().to_string();
    sqlx::query(
        r#"
        INSERT INTO instances (
            id, name, mc_version, loader, loader_version, game_dir,
            is_server, is_proxy, server_port, memory_min_mb, memory_max_mb, jvm_args
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&new_id)
    .bind(&final_name)
    .bind(&manifest.instance.mc_version)
    .bind(&manifest.instance.loader)
    .bind(&manifest.instance.loader_version)
    .bind(&unique_game_dir)
    .bind(manifest.instance.is_server)
    .bind(manifest.instance.is_proxy)
    .bind(manifest.instance.server_port)
    .bind(manifest.instance.memory_min_mb)
    .bind(manifest.instance.memory_max_mb)
    .bind(&manifest.instance.jvm_args)
    .execute(db)
    .await
    .map_err(AppError::from)?;

    // Fetch the created instance
    let instance = Instance::get_by_id(db, &new_id)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Instance("Failed to create instance".to_string()))?;

    emit_progress(app, source_instance_id, 100, "complete", "Restore complete!");

    Ok(instance)
}

/// Extract instance backup to a directory (blocking)
fn extract_instance_backup(
    backup_path: &Path,
    instance_dir: &Path,
    instance_id: &str,
    app: Option<&AppHandle>,
) -> AppResult<()> {
    let file = std::fs::File::open(backup_path)
        .map_err(|e| AppError::Io(format!("Failed to open backup: {}", e)))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| AppError::Io(format!("Failed to read ZIP: {}", e)))?;

    let total_files = archive.len();

    for i in 0..total_files {
        let mut file = archive
            .by_index(i)
            .map_err(|e| AppError::Io(format!("Failed to read ZIP entry: {}", e)))?;

        let name = file.name().to_string();

        // Skip manifest
        if name == "backup-manifest.json" {
            continue;
        }

        // Security checks
        if name.contains("..") || name.starts_with('/') || name.starts_with('\\') {
            continue;
        }
        if name.len() >= 2 && name.chars().nth(1) == Some(':') {
            continue;
        }

        let outpath = instance_dir.join(&name);

        // Normalize path and verify it stays within instance_dir
        let normalized: PathBuf = outpath
            .components()
            .filter(|c| !matches!(c, Component::ParentDir))
            .collect();

        if !normalized.starts_with(instance_dir) {
            continue;
        }

        // Emit progress periodically
        if i % 100 == 0 {
            if let Some(app) = app {
                let progress = 20 + ((i as u32 * 60) / total_files as u32);
                let _ = app.emit(
                    "instance-backup-progress",
                    InstanceBackupProgressEvent {
                        instance_id: instance_id.to_string(),
                        progress,
                        stage: "extracting".to_string(),
                        message: format!("Extracting files ({}/{})...", i, total_files),
                    },
                );
            }
        }

        if name.ends_with('/') {
            std::fs::create_dir_all(&normalized)
                .map_err(|e| AppError::Io(format!("Failed to create directory: {}", e)))?;
        } else {
            if let Some(parent) = normalized.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| AppError::Io(format!("Failed to create parent dir: {}", e)))?;
            }
            let mut outfile = std::fs::File::create(&normalized)
                .map_err(|e| AppError::Io(format!("Failed to create file: {}", e)))?;
            std::io::copy(&mut file, &mut outfile)
                .map_err(|e| AppError::Io(format!("Failed to extract file: {}", e)))?;
        }
    }

    Ok(())
}

/// Resolve a unique instance name
async fn resolve_unique_name(db: &SqlitePool, base_name: &str) -> AppResult<String> {
    let existing = Instance::get_all(db)
        .await
        .map_err(AppError::from)?;

    let existing_names: std::collections::HashSet<_> = existing.iter().map(|i| i.name.clone()).collect();

    if !existing_names.contains(base_name) {
        return Ok(base_name.to_string());
    }

    for i in 1..=100 {
        let name = format!("{} ({})", base_name, i);
        if !existing_names.contains(&name) {
            return Ok(name);
        }
    }

    // Fallback with UUID
    Ok(format!("{} ({})", base_name, &Uuid::new_v4().to_string()[..8]))
}

/// Sanitize instance name to game_dir
fn sanitize_game_dir(name: &str) -> String {
    name.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}
