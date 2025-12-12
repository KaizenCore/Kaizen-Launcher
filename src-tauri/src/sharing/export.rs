//! Export functionality for instance sharing

use crate::db::instances::Instance;
use crate::error::{AppError, AppResult};
use crate::instance::worlds::get_directory_size;
use crate::sharing::manifest::*;
use chrono::Local;
use sqlx::SqlitePool;
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};
use tokio::fs;
use uuid::Uuid;
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

/// Get the sharing temp directory
pub fn get_sharing_temp_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("sharing").join("temp")
}

/// Get exportable content for an instance (for UI selection)
pub async fn get_exportable_content(
    db: &SqlitePool,
    instances_dir: &Path,
    instance_id: &str,
) -> AppResult<ExportableContent> {
    // Get instance from DB
    let instance = Instance::get_by_id(db, instance_id)
        .await
        .map_err(|e| AppError::Database(e))?
        .ok_or_else(|| AppError::Instance(format!("Instance not found: {}", instance_id)))?;

    let instance_dir = instances_dir.join(&instance.game_dir);

    // Determine content folder based on loader type
    let content_folder = get_content_folder(&instance.loader);

    // Scan mods/plugins
    let mods = scan_directory_stats(&instance_dir.join(content_folder)).await;

    // Scan config
    let config = scan_directory_stats(&instance_dir.join("config")).await;

    // Scan resourcepacks (client only)
    let resourcepacks = if !instance.is_server {
        scan_directory_stats(&instance_dir.join("resourcepacks")).await
    } else {
        ExportableSection {
            available: false,
            count: 0,
            total_size_bytes: 0,
        }
    };

    // Scan shaderpacks (client only)
    let shaderpacks = if !instance.is_server {
        scan_directory_stats(&instance_dir.join("shaderpacks")).await
    } else {
        ExportableSection {
            available: false,
            count: 0,
            total_size_bytes: 0,
        }
    };

    // Scan worlds
    let worlds = scan_worlds(&instance_dir, instance.is_server).await;

    Ok(ExportableContent {
        instance_id: instance_id.to_string(),
        instance_name: instance.name,
        mods,
        config,
        resourcepacks,
        shaderpacks,
        worlds,
    })
}

/// Get the content folder name based on loader type
fn get_content_folder(loader: &Option<String>) -> &'static str {
    match loader.as_deref() {
        Some("paper") | Some("purpur") | Some("velocity") | Some("bungeecord")
        | Some("waterfall") => "plugins",
        _ => "mods",
    }
}

/// Scan a directory and return stats
async fn scan_directory_stats(dir: &Path) -> ExportableSection {
    if !dir.exists() {
        return ExportableSection {
            available: false,
            count: 0,
            total_size_bytes: 0,
        };
    }

    let mut count = 0u32;
    let mut total_size = 0u64;

    if let Ok(mut entries) = fs::read_dir(dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            if let Ok(metadata) = entry.metadata().await {
                if metadata.is_file() {
                    count += 1;
                    total_size += metadata.len();
                } else if metadata.is_dir() {
                    // For directories (like config subfolders), count recursively
                    count += 1;
                    if let Ok(size) = get_directory_size(&entry.path()).await {
                        total_size += size;
                    }
                }
            }
        }
    }

    ExportableSection {
        available: count > 0,
        count,
        total_size_bytes: total_size,
    }
}

/// Scan worlds in an instance
async fn scan_worlds(instance_dir: &Path, is_server: bool) -> Vec<ExportableWorld> {
    let mut worlds = Vec::new();

    if is_server {
        // Server: check for world, world_nether, world_the_end in root
        let world_dir = instance_dir.join("world");
        if world_dir.exists() {
            let mut total_size = get_directory_size(&world_dir).await.unwrap_or(0);

            // Check for dimension folders
            for dim in &["world_nether", "world_the_end"] {
                let dim_dir = instance_dir.join(dim);
                if dim_dir.exists() {
                    total_size += get_directory_size(&dim_dir).await.unwrap_or(0);
                }
            }

            worlds.push(ExportableWorld {
                name: "Server World".to_string(),
                folder_name: "world".to_string(),
                size_bytes: total_size,
                is_server_world: true,
            });
        }
    } else {
        // Client: scan saves/ directory
        let saves_dir = instance_dir.join("saves");
        if saves_dir.exists() {
            if let Ok(mut entries) = fs::read_dir(&saves_dir).await {
                while let Ok(Some(entry)) = entries.next_entry().await {
                    let path = entry.path();
                    if path.is_dir() {
                        // Check for level.dat to confirm it's a world
                        if path.join("level.dat").exists() {
                            let folder_name = entry.file_name().to_string_lossy().to_string();
                            let size = get_directory_size(&path).await.unwrap_or(0);

                            worlds.push(ExportableWorld {
                                name: folder_name.clone(),
                                folder_name,
                                size_bytes: size,
                                is_server_world: false,
                            });
                        }
                    }
                }
            }
        }
    }

    worlds
}

/// Prepare an export package
pub async fn prepare_export(
    app: &AppHandle,
    db: &SqlitePool,
    instances_dir: &Path,
    data_dir: &Path,
    instance_id: &str,
    options: ExportOptions,
) -> AppResult<PreparedExport> {
    let export_id = Uuid::new_v4().to_string();

    // Get instance from DB
    let instance = Instance::get_by_id(db, instance_id)
        .await
        .map_err(|e| AppError::Database(e))?
        .ok_or_else(|| AppError::Instance(format!("Instance not found: {}", instance_id)))?;

    let instance_dir = instances_dir.join(&instance.game_dir);

    // Emit progress
    emit_progress(app, &export_id, "preparing", 0, "Preparing export...");

    // Create temp directory
    let temp_dir = get_sharing_temp_dir(data_dir);
    fs::create_dir_all(&temp_dir)
        .await
        .map_err(|e| AppError::Io(format!("Failed to create temp dir: {}", e)))?;

    // Create package filename
    let safe_name = sanitize_filename(&instance.name);
    let timestamp = Local::now().format("%Y%m%d_%H%M%S");
    let package_name = format!("{}-{}.kaizen", safe_name, timestamp);
    let package_path = temp_dir.join(&package_name);

    // Build manifest and create ZIP
    let manifest = create_export_package(
        app,
        &export_id,
        &instance,
        &instance_dir,
        &package_path,
        &options,
    )
    .await?;

    emit_progress(app, &export_id, "ready", 100, "Export ready!");

    Ok(PreparedExport {
        export_id,
        package_path: package_path.to_string_lossy().to_string(),
        manifest,
    })
}

/// Create the export ZIP package
async fn create_export_package(
    app: &AppHandle,
    export_id: &str,
    instance: &Instance,
    instance_dir: &Path,
    package_path: &Path,
    options: &ExportOptions,
) -> AppResult<SharingManifest> {
    let content_folder = get_content_folder(&instance.loader);

    // Collect files to include
    let mut files_to_add: Vec<(PathBuf, String)> = Vec::new();
    let mut manifest_contents = Contents {
        mods: ContentSection::default(),
        config: ContentSection::default(),
        resourcepacks: ContentSection::default(),
        shaderpacks: ContentSection::default(),
        saves: SavesSection::default(),
    };

    emit_progress(app, export_id, "scanning", 10, "Scanning files...");

    // Mods/Plugins
    if options.include_mods {
        let mods_dir = instance_dir.join(content_folder);
        if mods_dir.exists() {
            let (files, section) = collect_directory_files(&mods_dir, content_folder, true).await?;
            files_to_add.extend(files);
            manifest_contents.mods = section;
        }
    }

    // Config
    if options.include_config {
        let config_dir = instance_dir.join("config");
        if config_dir.exists() {
            let (files, section) = collect_directory_files(&config_dir, "config", false).await?;
            files_to_add.extend(files);
            manifest_contents.config = section;
        }
    }

    // Resourcepacks
    if options.include_resourcepacks && !instance.is_server {
        let rp_dir = instance_dir.join("resourcepacks");
        if rp_dir.exists() {
            let (files, section) = collect_directory_files(&rp_dir, "resourcepacks", false).await?;
            files_to_add.extend(files);
            manifest_contents.resourcepacks = section;
        }
    }

    // Shaderpacks
    if options.include_shaderpacks && !instance.is_server {
        let sp_dir = instance_dir.join("shaderpacks");
        if sp_dir.exists() {
            let (files, section) = collect_directory_files(&sp_dir, "shaderpacks", false).await?;
            files_to_add.extend(files);
            manifest_contents.shaderpacks = section;
        }
    }

    // Worlds
    if !options.include_worlds.is_empty() {
        let mut worlds_info = Vec::new();

        for world_name in &options.include_worlds {
            if instance.is_server && world_name == "world" {
                // Server world: include world/ and dimension folders
                let world_dir = instance_dir.join("world");
                if world_dir.exists() {
                    let (files, _) = collect_directory_files(&world_dir, "world", false).await?;
                    let size: u64 = files.iter().map(|(p, _)| file_size(p)).sum();
                    files_to_add.extend(files);

                    let mut additional_folders = Vec::new();

                    // Include dimension folders
                    for dim in &["world_nether", "world_the_end"] {
                        let dim_dir = instance_dir.join(dim);
                        if dim_dir.exists() {
                            let (dim_files, _) =
                                collect_directory_files(&dim_dir, dim, false).await?;
                            files_to_add.extend(dim_files);
                            additional_folders.push(dim.to_string());
                        }
                    }

                    worlds_info.push(WorldInfo {
                        name: "Server World".to_string(),
                        folder_name: "world".to_string(),
                        size_bytes: size,
                        additional_folders: if additional_folders.is_empty() {
                            None
                        } else {
                            Some(additional_folders)
                        },
                    });
                }
            } else {
                // Client world
                let world_dir = instance_dir.join("saves").join(world_name);
                if world_dir.exists() {
                    let archive_path = format!("saves/{}", world_name);
                    let (files, _) =
                        collect_directory_files(&world_dir, &archive_path, false).await?;
                    let size: u64 = files.iter().map(|(p, _)| file_size(p)).sum();
                    files_to_add.extend(files);

                    worlds_info.push(WorldInfo {
                        name: world_name.clone(),
                        folder_name: world_name.clone(),
                        size_bytes: size,
                        additional_folders: None,
                    });
                }
            }
        }

        manifest_contents.saves = SavesSection {
            included: !worlds_info.is_empty(),
            worlds: worlds_info,
        };
    }

    emit_progress(app, export_id, "compressing", 30, "Creating archive...");

    // Calculate total size
    let total_size: u64 = files_to_add.iter().map(|(p, _)| file_size(p)).sum();

    // Create manifest
    let manifest = SharingManifest {
        version: MANIFEST_VERSION.to_string(),
        kaizen_version: env!("CARGO_PKG_VERSION").to_string(),
        created_at: Local::now().format("%Y-%m-%dT%H:%M:%SZ").to_string(),
        instance: InstanceInfo {
            name: instance.name.clone(),
            mc_version: instance.mc_version.clone(),
            loader: instance.loader.clone(),
            loader_version: instance.loader_version.clone(),
            is_server: instance.is_server,
            is_proxy: instance.is_proxy,
            memory_min_mb: Some(instance.memory_min_mb as i32),
            memory_max_mb: Some(instance.memory_max_mb as i32),
            jvm_args: if instance.jvm_args.is_empty() {
                None
            } else {
                Some(instance.jvm_args.clone())
            },
        },
        contents: manifest_contents,
        total_size_bytes: total_size,
    };

    // Create ZIP file (blocking operation)
    let package_path_clone = package_path.to_path_buf();
    let manifest_clone = manifest.clone();
    let files_clone = files_to_add.clone();
    let export_id_clone = export_id.to_string();
    let app_clone = app.clone();

    tokio::task::spawn_blocking(move || {
        create_zip_file(
            &app_clone,
            &export_id_clone,
            &package_path_clone,
            &manifest_clone,
            &files_clone,
        )
    })
    .await
    .map_err(|e| AppError::Io(format!("ZIP creation task failed: {}", e)))??;

    Ok(manifest)
}

/// Create the actual ZIP file (runs in blocking thread)
fn create_zip_file(
    app: &AppHandle,
    export_id: &str,
    package_path: &Path,
    manifest: &SharingManifest,
    files: &[(PathBuf, String)],
) -> AppResult<()> {
    let file = File::create(package_path)
        .map_err(|e| AppError::Io(format!("Failed to create ZIP file: {}", e)))?;

    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .compression_level(Some(6));

    // Write manifest
    let manifest_json = serde_json::to_string_pretty(manifest).map_err(|e| AppError::Json(e))?;

    zip.start_file("kaizen-manifest.json", options)
        .map_err(|e| AppError::Io(format!("Failed to start manifest file: {}", e)))?;
    zip.write_all(manifest_json.as_bytes())
        .map_err(|e| AppError::Io(format!("Failed to write manifest: {}", e)))?;

    // Write files with progress
    let total_files = files.len();
    for (i, (src_path, archive_path)) in files.iter().enumerate() {
        // Update progress
        let progress = 30 + ((i as u32 * 60) / total_files.max(1) as u32);
        if i % 10 == 0 {
            let _ = app.emit(
                "sharing-progress",
                SharingProgressEvent {
                    operation_id: export_id.to_string(),
                    stage: "compressing".to_string(),
                    progress,
                    message: format!("Adding {} files...", total_files - i),
                },
            );
        }

        if src_path.is_file() {
            let mut src_file = File::open(src_path).map_err(|e| {
                AppError::Io(format!("Failed to open {}: {}", src_path.display(), e))
            })?;

            zip.start_file(archive_path, options)
                .map_err(|e| AppError::Io(format!("Failed to start {}: {}", archive_path, e)))?;

            let mut buffer = Vec::new();
            src_file.read_to_end(&mut buffer).map_err(|e| {
                AppError::Io(format!("Failed to read {}: {}", src_path.display(), e))
            })?;

            zip.write_all(&buffer)
                .map_err(|e| AppError::Io(format!("Failed to write {}: {}", archive_path, e)))?;
        }
    }

    zip.finish()
        .map_err(|e| AppError::Io(format!("Failed to finish ZIP: {}", e)))?;

    Ok(())
}

/// Collect files from a directory for archiving
async fn collect_directory_files(
    dir: &Path,
    archive_prefix: &str,
    include_meta: bool,
) -> AppResult<(Vec<(PathBuf, String)>, ContentSection)> {
    let mut files = Vec::new();
    let mut count = 0u32;
    let mut total_size = 0u64;
    let mut file_infos = Vec::new();

    for entry in WalkDir::new(dir).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_file() {
            let relative = path
                .strip_prefix(dir)
                .map_err(|e| AppError::Io(format!("Path error: {}", e)))?;

            let archive_path = format!("{}/{}", archive_prefix, relative.display());

            // Skip .meta.json files unless we want them
            let filename = path.file_name().unwrap_or_default().to_string_lossy();
            if !include_meta && filename.ends_with(".meta.json") {
                continue;
            }

            let size = path.metadata().map(|m| m.len()).unwrap_or(0);
            total_size += size;
            count += 1;

            files.push((path.to_path_buf(), archive_path.clone()));
            file_infos.push(FileInfo {
                path: archive_path,
                size_bytes: size,
                sha256: None, // Skip hash for performance
            });
        }
    }

    Ok((
        files,
        ContentSection {
            included: true,
            count,
            total_size_bytes: total_size,
            files: Some(file_infos),
        },
    ))
}

/// Get file size
fn file_size(path: &Path) -> u64 {
    path.metadata().map(|m| m.len()).unwrap_or(0)
}

/// Sanitize filename for safe use
fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c => c,
        })
        .collect()
}

/// Emit progress event
fn emit_progress(app: &AppHandle, export_id: &str, stage: &str, progress: u32, message: &str) {
    let _ = app.emit(
        "sharing-progress",
        SharingProgressEvent {
            operation_id: export_id.to_string(),
            stage: stage.to_string(),
            progress,
            message: message.to_string(),
        },
    );
}

/// Cleanup an export (delete temp files)
pub async fn cleanup_export(data_dir: &Path, _export_id: &str) -> AppResult<()> {
    let temp_dir = get_sharing_temp_dir(data_dir);

    // Find and delete files matching this export
    if let Ok(mut entries) = fs::read_dir(&temp_dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            // For now, just clean old exports (older than 1 hour)
            if let Ok(metadata) = entry.metadata().await {
                if let Ok(modified) = metadata.modified() {
                    let age = std::time::SystemTime::now()
                        .duration_since(modified)
                        .unwrap_or_default();
                    if age.as_secs() > 3600 {
                        let _ = fs::remove_file(&path).await;
                    }
                }
            }
        }
    }

    Ok(())
}
