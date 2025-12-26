//! Import logic for external launcher instances
//! Handles copying files and creating Kaizen instances

use std::io::Read;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};
use tracing::{debug, info, warn};
use uuid::Uuid;
use zip::ZipArchive;

use crate::db::instances::{CreateInstance, Instance};
use crate::error::{AppError, AppResult};
use crate::external_import::{
    mod_resolver::ModResolver, DetectedInstance, ImportOptions, ImportProgress, ImportStage,
    LauncherType, ModFile,
};

/// Emit import progress event
fn emit_progress(
    app: &AppHandle,
    operation_id: &str,
    stage: ImportStage,
    progress: u32,
    total: u32,
    message: &str,
    current_file: Option<&str>,
) {
    let event = ImportProgress {
        operation_id: operation_id.to_string(),
        stage,
        progress,
        total,
        message: message.to_string(),
        current_file: current_file.map(|s| s.to_string()),
    };

    if let Err(e) = app.emit("external-import-progress", &event) {
        warn!("Failed to emit import progress: {}", e);
    }
}

/// Generate a unique instance name, handling conflicts
pub async fn generate_unique_name(
    db: &sqlx::SqlitePool,
    base_name: &str,
) -> AppResult<String> {
    let mut name = base_name.to_string();
    let mut counter = 1;

    loop {
        // Check if name exists
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM instances WHERE name = ?)",
        )
        .bind(&name)
        .fetch_one(db)
        .await
        .map_err(|e| AppError::ExternalImport(format!("Failed to check name: {}", e)))?;

        if !exists {
            return Ok(name);
        }

        // Try with counter
        name = format!("{} ({})", base_name, counter);
        counter += 1;

        // Prevent infinite loop
        if counter > 100 {
            name = format!("{}-{}", base_name, &Uuid::new_v4().to_string()[..8]);
            return Ok(name);
        }
    }
}

/// Sanitize a name for use as a directory name
pub fn sanitize_game_dir(name: &str) -> String {
    name.to_lowercase()
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else if c == ' ' {
                '-'
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches(|c| c == '-' || c == '_')
        .to_string()
}

/// Copy a single file with retry logic for locked files
async fn copy_file_with_retry(src: &PathBuf, dest: &PathBuf, max_retries: u32) -> AppResult<u64> {
    let mut last_error = None;

    for attempt in 0..max_retries {
        match tokio::fs::copy(src, dest).await {
            Ok(size) => return Ok(size),
            Err(e) => {
                // Check if it's a file locking error (Windows error 32 or 33)
                let is_locked = e.raw_os_error().map_or(false, |code| code == 32 || code == 33);

                if is_locked && attempt < max_retries - 1 {
                    warn!(
                        "File locked, retrying in {}ms: {:?} (attempt {}/{})",
                        (attempt + 1) * 100,
                        src.file_name(),
                        attempt + 1,
                        max_retries
                    );
                    tokio::time::sleep(tokio::time::Duration::from_millis((attempt as u64 + 1) * 100)).await;
                    last_error = Some(e);
                    continue;
                }

                // For locked files, try reading and writing manually as fallback
                if is_locked {
                    debug!("Attempting manual copy for locked file: {:?}", src);
                    match std::fs::read(src) {
                        Ok(content) => {
                            tokio::fs::write(dest, &content)
                                .await
                                .map_err(|e| AppError::ExternalImport(format!(
                                    "Failed to write file '{}': {}",
                                    src.file_name().and_then(|n| n.to_str()).unwrap_or("unknown"),
                                    e
                                )))?;
                            return Ok(content.len() as u64);
                        }
                        Err(read_err) => {
                            return Err(AppError::ExternalImport(format!(
                                "Failed to copy file '{}': file is locked by another process. Close Modrinth App and try again. ({})",
                                src.file_name().and_then(|n| n.to_str()).unwrap_or("unknown"),
                                read_err
                            )));
                        }
                    }
                }

                return Err(AppError::ExternalImport(format!(
                    "Failed to copy file '{}': {}",
                    src.file_name().and_then(|n| n.to_str()).unwrap_or("unknown"),
                    e
                )));
            }
        }
    }

    Err(AppError::ExternalImport(format!(
        "Failed to copy file '{}' after {} retries: {}",
        src.file_name().and_then(|n| n.to_str()).unwrap_or("unknown"),
        max_retries,
        last_error.map_or("unknown error".to_string(), |e| e.to_string())
    )))
}

/// Copy a directory recursively
pub async fn copy_directory(src: &PathBuf, dest: &PathBuf) -> AppResult<u64> {
    if !src.exists() {
        return Ok(0);
    }

    tokio::fs::create_dir_all(dest)
        .await
        .map_err(|e| AppError::ExternalImport(format!("Failed to create directory: {}", e)))?;

    let mut total_size = 0u64;
    let mut entries = tokio::fs::read_dir(src)
        .await
        .map_err(|e| AppError::ExternalImport(format!("Failed to read directory: {}", e)))?;

    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| AppError::ExternalImport(format!("Failed to read entry: {}", e)))?
    {
        let src_path = entry.path();
        let dest_path = dest.join(entry.file_name());

        let metadata = entry
            .metadata()
            .await
            .map_err(|e| AppError::ExternalImport(format!("Failed to get metadata: {}", e)))?;

        if metadata.is_dir() {
            total_size += Box::pin(copy_directory(&src_path, &dest_path)).await?;
        } else {
            total_size += copy_file_with_retry(&src_path, &dest_path, 3).await?;
        }
    }

    Ok(total_size)
}

/// Create mod metadata file (.meta.json) for a mod
async fn create_mod_metadata(
    mod_path: &PathBuf,
    project_id: &str,
    version_id: &str,
    project_name: Option<&str>,
) -> AppResult<()> {
    let meta_path = mod_path.with_extension("jar.meta.json");

    let metadata = serde_json::json!({
        "project_id": project_id,
        "version_id": version_id,
        "name": project_name.unwrap_or("Unknown"),
        "source": "modrinth"
    });

    tokio::fs::write(&meta_path, serde_json::to_string_pretty(&metadata)?)
        .await
        .map_err(|e| AppError::ExternalImport(format!("Failed to write metadata: {}", e)))?;

    Ok(())
}

/// Import an external instance
pub async fn import_external_instance(
    app: &AppHandle,
    db: &sqlx::SqlitePool,
    http_client: &reqwest::Client,
    instances_dir: &PathBuf,
    detected: &DetectedInstance,
    options: &ImportOptions,
) -> AppResult<Instance> {
    let import_id = Uuid::new_v4().to_string();

    info!(
        "Starting import of '{}' from {:?}",
        detected.name, detected.launcher
    );

    // Step 1: Generate unique name and create instance
    emit_progress(
        app,
        &import_id,
        ImportStage::Creating,
        5,
        100,
        "Creating instance...",
        None,
    );

    let instance_name = options
        .new_name
        .clone()
        .unwrap_or_else(|| detected.name.clone());
    let unique_name = generate_unique_name(db, &instance_name).await?;
    let game_dir = sanitize_game_dir(&unique_name);

    debug!("Creating instance: {} (dir: {})", unique_name, game_dir);

    let create_data = CreateInstance {
        name: unique_name.clone(),
        mc_version: detected.mc_version.clone(),
        loader: detected.loader.clone(),
        loader_version: detected.loader_version.clone(),
        is_server: detected.is_server,
        is_proxy: false,
        server_port: 25565,
        modrinth_project_id: None,
    };

    let instance = Instance::create(db, create_data).await?;
    let dest_dir = instances_dir.join(&instance.game_dir);
    tokio::fs::create_dir_all(&dest_dir)
        .await
        .map_err(|e| AppError::ExternalImport(format!("Failed to create instance dir: {}", e)))?;

    // Determine source game directory
    let source_dir = match detected.launcher {
        LauncherType::ModrinthApp => {
            // For .mrpack files, we need to extract
            if detected.path.extension().map_or(false, |ext| ext == "mrpack") {
                extract_mrpack(&detected.path, &dest_dir, app, &import_id).await?;
                // After extraction, mods are already in place
                // Return early if no additional options
                if !options.copy_mods && !options.copy_config {
                    emit_progress(
                        app,
                        &import_id,
                        ImportStage::Complete,
                        100,
                        100,
                        "Import complete!",
                        None,
                    );
                    return Ok(instance);
                }
                dest_dir.clone() // Already extracted to dest
            } else {
                detected.path.clone()
            }
        }
        LauncherType::CurseForge => {
            // For .zip files, extract overrides
            if detected.path.extension().map_or(false, |ext| ext == "zip") {
                extract_curseforge_zip(&detected.path, &dest_dir, app, &import_id).await?;
                emit_progress(
                    app,
                    &import_id,
                    ImportStage::Complete,
                    100,
                    100,
                    "Import complete!",
                    None,
                );
                return Ok(instance);
            }
            detected.path.clone()
        }
        _ => detected.path.clone(),
    };

    // Step 2: Copy mods
    if options.copy_mods {
        emit_progress(
            app,
            &import_id,
            ImportStage::Scanning,
            20,
            100,
            "Scanning mods...",
            None,
        );

        let mods_src = source_dir.join("mods");
        let mods_dest = dest_dir.join("mods");

        if mods_src.exists() {
            tokio::fs::create_dir_all(&mods_dest)
                .await
                .map_err(|e| AppError::ExternalImport(format!("Failed to create mods dir: {}", e)))?;

            // Scan and optionally resolve mods
            let mut mod_files = scan_mods_dir(&mods_src).await?;

            if options.redownload_from_modrinth {
                emit_progress(
                    app,
                    &import_id,
                    ImportStage::Resolving,
                    30,
                    100,
                    "Resolving mods via Modrinth...",
                    None,
                );

                let resolver = ModResolver::new(http_client);
                resolver.enrich_mod_files(&mut mod_files).await;
            }

            // Copy or download mods
            let total_mods = mod_files.len();
            for (idx, mod_file) in mod_files.iter().enumerate() {
                let progress = 40 + ((idx as u32 * 30) / total_mods as u32);

                emit_progress(
                    app,
                    &import_id,
                    ImportStage::Copying,
                    progress,
                    100,
                    &format!("Copying mod {}/{}...", idx + 1, total_mods),
                    Some(&mod_file.filename),
                );

                let dest_path = mods_dest.join(&mod_file.filename);

                if options.redownload_from_modrinth {
                    // Try to download from Modrinth if resolved
                    if let Some(version_id) = &mod_file.modrinth_version_id {
                        let resolver = ModResolver::new(http_client);
                        match resolver.download_mod(version_id, &mods_dest).await {
                            Ok(downloaded_path) => {
                                // Create metadata file
                                if let Some(project_id) = &mod_file.modrinth_project_id {
                                    let _ = create_mod_metadata(
                                        &downloaded_path,
                                        project_id,
                                        version_id,
                                        mod_file.modrinth_project_name.as_deref(),
                                    )
                                    .await;
                                }
                                continue;
                            }
                            Err(e) => {
                                warn!(
                                    "Failed to download {} from Modrinth, copying instead: {}",
                                    mod_file.filename, e
                                );
                            }
                        }
                    }
                }

                // Fall back to copying
                if mod_file.path.exists() {
                    copy_file_with_retry(&mod_file.path, &dest_path, 3).await?;

                    // Create metadata if we have project info
                    if let (Some(project_id), Some(version_id)) =
                        (&mod_file.modrinth_project_id, &mod_file.modrinth_version_id)
                    {
                        let _ = create_mod_metadata(
                            &dest_path,
                            project_id,
                            version_id,
                            mod_file.modrinth_project_name.as_deref(),
                        )
                        .await;
                    }
                }
            }
        }
    }

    // Step 3: Copy config
    if options.copy_config {
        emit_progress(
            app,
            &import_id,
            ImportStage::Copying,
            75,
            100,
            "Copying config files...",
            None,
        );

        let config_src = source_dir.join("config");
        let config_dest = dest_dir.join("config");
        if config_src.exists() {
            copy_directory(&config_src, &config_dest).await?;
        }
    }

    // Step 4: Copy resourcepacks
    if options.copy_resourcepacks {
        emit_progress(
            app,
            &import_id,
            ImportStage::Copying,
            80,
            100,
            "Copying resource packs...",
            None,
        );

        let rp_src = source_dir.join("resourcepacks");
        let rp_dest = dest_dir.join("resourcepacks");
        if rp_src.exists() {
            copy_directory(&rp_src, &rp_dest).await?;
        }
    }

    // Step 5: Copy shaderpacks
    if options.copy_shaderpacks {
        emit_progress(
            app,
            &import_id,
            ImportStage::Copying,
            85,
            100,
            "Copying shader packs...",
            None,
        );

        let sp_src = source_dir.join("shaderpacks");
        let sp_dest = dest_dir.join("shaderpacks");
        if sp_src.exists() {
            copy_directory(&sp_src, &sp_dest).await?;
        }
    }

    // Step 6: Copy worlds
    if !options.copy_worlds.is_empty() {
        emit_progress(
            app,
            &import_id,
            ImportStage::Copying,
            90,
            100,
            "Copying worlds...",
            None,
        );

        let saves_src = source_dir.join("saves");
        let saves_dest = dest_dir.join("saves");

        if saves_src.exists() {
            tokio::fs::create_dir_all(&saves_dest)
                .await
                .map_err(|e| AppError::ExternalImport(format!("Failed to create saves dir: {}", e)))?;

            for world_name in &options.copy_worlds {
                let world_src = saves_src.join(world_name);
                let world_dest = saves_dest.join(world_name);

                if world_src.exists() {
                    copy_directory(&world_src, &world_dest).await?;
                }
            }
        }
    }

    emit_progress(
        app,
        &import_id,
        ImportStage::Complete,
        100,
        100,
        "Import complete!",
        None,
    );

    info!("Successfully imported instance '{}'", unique_name);
    Ok(instance)
}

/// Scan a mods directory and return ModFile entries
async fn scan_mods_dir(mods_dir: &PathBuf) -> AppResult<Vec<ModFile>> {
    let mut mods = Vec::new();

    if !mods_dir.exists() {
        return Ok(mods);
    }

    let mut entries = tokio::fs::read_dir(mods_dir)
        .await
        .map_err(|e| AppError::ExternalImport(format!("Failed to read mods dir: {}", e)))?;

    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| AppError::ExternalImport(format!("Failed to read entry: {}", e)))?
    {
        let path = entry.path();

        if !path.extension().map_or(false, |ext| ext == "jar") {
            continue;
        }

        let filename = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string();

        let metadata = entry.metadata().await.ok();
        let size = metadata.as_ref().map(|m| m.len()).unwrap_or(0);

        mods.push(ModFile {
            filename,
            path,
            sha1: None,
            sha512: None,
            size,
            modrinth_project_id: None,
            modrinth_version_id: None,
            modrinth_project_name: None,
        });
    }

    Ok(mods)
}

/// Entry to extract from a zip
struct ExtractEntry {
    name: String,
    dest_path: PathBuf,
    is_dir: bool,
    content: Vec<u8>,
}

/// Extract a .mrpack file to an instance directory
async fn extract_mrpack(
    mrpack_path: &PathBuf,
    dest_dir: &PathBuf,
    app: &AppHandle,
    import_id: &str,
) -> AppResult<()> {
    emit_progress(
        app,
        import_id,
        ImportStage::Copying,
        40,
        100,
        "Extracting modpack...",
        None,
    );

    // Read all entries synchronously first (to avoid Send issues with ZipFile)
    let entries: Vec<ExtractEntry> = {
        let file = std::fs::File::open(mrpack_path)
            .map_err(|e| AppError::ExternalImport(format!("Failed to open mrpack: {}", e)))?;

        let mut archive = ZipArchive::new(file)
            .map_err(|e| AppError::ExternalImport(format!("Invalid mrpack: {}", e)))?;

        let mut entries = Vec::new();

        for i in 0..archive.len() {
            let mut file = archive
                .by_index(i)
                .map_err(|e| AppError::ExternalImport(format!("Failed to read zip entry: {}", e)))?;

            let name = file.name().to_string();

            // Skip the manifest
            if name == "modrinth.index.json" {
                continue;
            }

            // Handle overrides folder
            let dest_path = if name.starts_with("overrides/") {
                dest_dir.join(&name[10..]) // Remove "overrides/" prefix
            } else if name.starts_with("client-overrides/") {
                dest_dir.join(&name[17..])
            } else {
                continue; // Skip other files
            };

            // Security: Check for path traversal
            if dest_path.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
                warn!("Skipping suspicious path: {}", name);
                continue;
            }

            let is_dir = file.is_dir();
            let content = if is_dir {
                Vec::new()
            } else {
                let mut content = Vec::new();
                file.read_to_end(&mut content)
                    .map_err(|e| AppError::ExternalImport(format!("Failed to read file: {}", e)))?;
                content
            };

            entries.push(ExtractEntry {
                name,
                dest_path,
                is_dir,
                content,
            });
        }

        entries
    };

    // Now write files asynchronously
    let total_files = entries.len();
    for (i, entry) in entries.into_iter().enumerate() {
        if entry.is_dir {
            tokio::fs::create_dir_all(&entry.dest_path)
                .await
                .map_err(|e| AppError::ExternalImport(format!("Failed to create dir: {}", e)))?;
        } else {
            if let Some(parent) = entry.dest_path.parent() {
                tokio::fs::create_dir_all(parent)
                    .await
                    .map_err(|e| AppError::ExternalImport(format!("Failed to create parent: {}", e)))?;
            }

            tokio::fs::write(&entry.dest_path, entry.content)
                .await
                .map_err(|e| AppError::ExternalImport(format!("Failed to write file: {}", e)))?;
        }

        let progress = 40 + ((i as u32 * 40) / total_files as u32);
        emit_progress(
            app,
            import_id,
            ImportStage::Copying,
            progress,
            100,
            &format!("Extracting {}/{}...", i + 1, total_files),
            Some(&entry.name),
        );
    }

    Ok(())
}

/// Extract a CurseForge .zip file to an instance directory
async fn extract_curseforge_zip(
    zip_path: &PathBuf,
    dest_dir: &PathBuf,
    app: &AppHandle,
    import_id: &str,
) -> AppResult<()> {
    emit_progress(
        app,
        import_id,
        ImportStage::Copying,
        40,
        100,
        "Extracting modpack...",
        None,
    );

    // Read all entries synchronously first (to avoid Send issues with ZipFile)
    let entries: Vec<ExtractEntry> = {
        let file = std::fs::File::open(zip_path)
            .map_err(|e| AppError::ExternalImport(format!("Failed to open zip: {}", e)))?;

        let mut archive = ZipArchive::new(file)
            .map_err(|e| AppError::ExternalImport(format!("Invalid zip: {}", e)))?;

        let mut entries = Vec::new();

        for i in 0..archive.len() {
            let mut file = archive
                .by_index(i)
                .map_err(|e| AppError::ExternalImport(format!("Failed to read zip entry: {}", e)))?;

            let name = file.name().to_string();

            // Skip manifest.json
            if name == "manifest.json" || name == "modlist.html" {
                continue;
            }

            // Handle overrides folder
            let dest_path = if name.starts_with("overrides/") {
                dest_dir.join(&name[10..])
            } else {
                continue;
            };

            // Security check
            if dest_path.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
                warn!("Skipping suspicious path: {}", name);
                continue;
            }

            let is_dir = file.is_dir();
            let content = if is_dir {
                Vec::new()
            } else {
                let mut content = Vec::new();
                file.read_to_end(&mut content)
                    .map_err(|e| AppError::ExternalImport(format!("Failed to read file: {}", e)))?;
                content
            };

            entries.push(ExtractEntry {
                name,
                dest_path,
                is_dir,
                content,
            });
        }

        entries
    };

    // Now write files asynchronously
    let total_files = entries.len();
    for (i, entry) in entries.into_iter().enumerate() {
        if entry.is_dir {
            tokio::fs::create_dir_all(&entry.dest_path)
                .await
                .map_err(|e| AppError::ExternalImport(format!("Failed to create dir: {}", e)))?;
        } else {
            if let Some(parent) = entry.dest_path.parent() {
                tokio::fs::create_dir_all(parent)
                    .await
                    .map_err(|e| AppError::ExternalImport(format!("Failed to create parent: {}", e)))?;
            }

            tokio::fs::write(&entry.dest_path, entry.content)
                .await
                .map_err(|e| AppError::ExternalImport(format!("Failed to write file: {}", e)))?;
        }

        let progress = 40 + ((i as u32 * 50) / total_files as u32);
        emit_progress(
            app,
            import_id,
            ImportStage::Copying,
            progress,
            100,
            &format!("Extracting {}/{}...", i + 1, total_files),
            Some(&entry.name),
        );
    }

    Ok(())
}
