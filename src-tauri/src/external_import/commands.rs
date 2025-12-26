//! Tauri commands for external launcher import

use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, State};
use tracing::{debug, info};

use crate::db::instances::Instance;
use crate::error::{AppError, AppResult};
use crate::external_import::{
    importer, mod_resolver::ModResolver, parsers, ContentInfo, DetectedInstance, DetectedLauncher,
    ImportOptions, ImportableContent, LauncherParser, LauncherType, ModFile, ParsedLauncher,
    WorldInfo,
};
use crate::state::SharedState;

/// Detect all installed external launchers and their instances
#[tauri::command]
pub async fn detect_external_launchers(
    state: State<'_, SharedState>,
) -> AppResult<Vec<ParsedLauncher>> {
    info!("Detecting external launchers...");

    let parsers = parsers::get_all_parsers();
    let mut results = Vec::new();

    for parser in parsers {
        let launcher_type = parser.launcher_type();
        let display_name = parser.display_name();

        debug!("Checking for {}", display_name);

        for path in parser.default_paths() {
            if !path.exists() {
                continue;
            }

            if !parser.detect(&path).await {
                continue;
            }

            debug!("Found {} at {:?}", display_name, path);

            match parser.parse_instances(&path).await {
                Ok(instances) => {
                    let launcher = DetectedLauncher {
                        launcher_type,
                        name: display_name.to_string(),
                        path: path.clone(),
                        instance_count: instances.len(),
                        is_detected: true,
                    };

                    results.push(ParsedLauncher { launcher, instances });
                }
                Err(e) => {
                    debug!("Failed to parse {} at {:?}: {}", display_name, path, e);
                }
            }
        }
    }

    info!("Detected {} launchers", results.len());
    Ok(results)
}

/// Parse a manually selected path (folder or file)
#[tauri::command]
pub async fn parse_external_path(
    state: State<'_, SharedState>,
    path: String,
) -> AppResult<DetectedInstance> {
    let path = PathBuf::from(path);

    if !path.exists() {
        return Err(AppError::ExternalImport(format!(
            "Path does not exist: {}",
            path.display()
        )));
    }

    info!("Parsing external path: {:?}", path);

    let parsers = parsers::get_all_parsers();

    for parser in parsers {
        if parser.detect(&path).await {
            debug!("Detected as {}", parser.display_name());
            return parser.parse_single(&path).await;
        }
    }

    Err(AppError::ExternalImport(
        "Unrecognized launcher format. Please select a valid instance folder or modpack file."
            .to_string(),
    ))
}

/// Get importable content from an instance
#[tauri::command]
pub async fn get_importable_content(
    state: State<'_, SharedState>,
    instance_path: String,
) -> AppResult<ImportableContent> {
    let path = PathBuf::from(instance_path);

    if !path.exists() {
        return Err(AppError::ExternalImport("Path does not exist".to_string()));
    }

    // Calculate mods info
    let mods_dir = path.join("mods");
    let mods = if mods_dir.exists() {
        let (count, size) = count_dir_contents(&mods_dir, Some("jar")).await;
        ContentInfo {
            available: true,
            count,
            size_bytes: size,
        }
    } else {
        ContentInfo {
            available: false,
            count: 0,
            size_bytes: 0,
        }
    };

    // Calculate config info
    let config_dir = path.join("config");
    let config = if config_dir.exists() {
        let (count, size) = count_dir_contents(&config_dir, None).await;
        ContentInfo {
            available: true,
            count,
            size_bytes: size,
        }
    } else {
        ContentInfo {
            available: false,
            count: 0,
            size_bytes: 0,
        }
    };

    // Calculate resourcepacks info
    let rp_dir = path.join("resourcepacks");
    let resourcepacks = if rp_dir.exists() {
        let (count, size) = count_dir_contents(&rp_dir, None).await;
        ContentInfo {
            available: true,
            count,
            size_bytes: size,
        }
    } else {
        ContentInfo {
            available: false,
            count: 0,
            size_bytes: 0,
        }
    };

    // Calculate shaderpacks info
    let sp_dir = path.join("shaderpacks");
    let shaderpacks = if sp_dir.exists() {
        let (count, size) = count_dir_contents(&sp_dir, None).await;
        ContentInfo {
            available: true,
            count,
            size_bytes: size,
        }
    } else {
        ContentInfo {
            available: false,
            count: 0,
            size_bytes: 0,
        }
    };

    // Get worlds info
    let saves_dir = path.join("saves");
    let worlds = if saves_dir.exists() {
        get_worlds(&saves_dir).await
    } else {
        Vec::new()
    };

    Ok(ImportableContent {
        mods,
        config,
        resourcepacks,
        shaderpacks,
        worlds,
    })
}

/// Preview mods with Modrinth resolution
#[tauri::command]
pub async fn preview_external_mods(
    state: State<'_, SharedState>,
    instance_path: String,
) -> AppResult<Vec<ModFile>> {
    let state = state.read().await;
    let path = PathBuf::from(instance_path);

    // Try to find the mods directory
    let mods_dir = path.join("mods");
    if !mods_dir.exists() {
        return Ok(Vec::new());
    }

    // Scan mods
    let mut mod_files = scan_mods(&mods_dir).await?;

    // Resolve via Modrinth
    let resolver = ModResolver::new(&state.http_client);
    resolver.enrich_mod_files(&mut mod_files).await;

    Ok(mod_files)
}

/// Import an external instance
#[tauri::command]
pub async fn import_external_instance(
    state: State<'_, SharedState>,
    app: AppHandle,
    detected: DetectedInstance,
    options: ImportOptions,
) -> AppResult<Instance> {
    let state_guard = state.read().await;

    // Get instances directory
    let instances_dir = crate::utils::paths::get_instances_dir()
        .map_err(|e| AppError::ExternalImport(format!("Failed to get instances dir: {}", e)))?;

    importer::import_external_instance(
        &app,
        &state_guard.db,
        &state_guard.http_client,
        &instances_dir,
        &detected,
        &options,
    )
    .await
}

/// Helper: Count files and total size in a directory
async fn count_dir_contents(dir: &PathBuf, extension: Option<&str>) -> (usize, u64) {
    let mut count = 0;
    let mut size = 0u64;

    if let Ok(mut entries) = tokio::fs::read_dir(dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();

            if let Some(ext) = extension {
                if !path.extension().map_or(false, |e| e == ext) {
                    continue;
                }
            }

            if let Ok(metadata) = entry.metadata().await {
                if metadata.is_file() {
                    count += 1;
                    size += metadata.len();
                }
            }
        }
    }

    (count, size)
}

/// Helper: Get world info from saves directory
async fn get_worlds(saves_dir: &PathBuf) -> Vec<WorldInfo> {
    let mut worlds = Vec::new();

    if let Ok(mut entries) = tokio::fs::read_dir(saves_dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();

            if !path.is_dir() {
                continue;
            }

            // Check for level.dat to confirm it's a world
            if !path.join("level.dat").exists() {
                continue;
            }

            let folder_name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("Unknown")
                .to_string();

            // Calculate world size
            let size_bytes = calculate_dir_size(&path).await;

            worlds.push(WorldInfo {
                name: folder_name.clone(),
                folder_name,
                size_bytes,
            });
        }
    }

    worlds
}

/// Helper: Calculate directory size
async fn calculate_dir_size(path: &PathBuf) -> u64 {
    let mut size = 0u64;

    if let Ok(mut entries) = tokio::fs::read_dir(path).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            if let Ok(metadata) = entry.metadata().await {
                if metadata.is_file() {
                    size += metadata.len();
                } else if metadata.is_dir() {
                    size += Box::pin(calculate_dir_size(&entry.path())).await;
                }
            }
        }
    }

    size
}

/// Helper: Scan mods directory
async fn scan_mods(mods_dir: &PathBuf) -> AppResult<Vec<ModFile>> {
    let mut mods = Vec::new();

    let mut entries = tokio::fs::read_dir(mods_dir)
        .await
        .map_err(|e| AppError::ExternalImport(format!("Failed to read mods: {}", e)))?;

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
