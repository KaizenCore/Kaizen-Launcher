use crate::db::instances::{CreateInstance, Instance};
use crate::error::{AppError, AppResult};
use crate::instance::worlds::{self, BackupInfo, BackupStats, GlobalBackupInfo, WorldInfo};
use crate::minecraft::versions;
use crate::state::SharedState;
use futures_util::future;
use serde::{Deserialize, Serialize};
use std::path::Path;
use sysinfo::System;
use tauri::{AppHandle, State};
use tokio::fs;

/// Open a folder in the system file manager (cross-platform)
fn open_folder_in_file_manager(path: &Path) -> AppResult<()> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| AppError::Io(format!("Failed to open folder: {}", e)))?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|e| AppError::Io(format!("Failed to open folder: {}", e)))?;
    }

    #[cfg(target_os = "linux")]
    {
        // Try xdg-open first, fall back to other common file managers
        let result = std::process::Command::new("xdg-open").arg(path).spawn();

        if result.is_err() {
            // Fallback to common file managers
            let fallbacks = ["nautilus", "dolphin", "thunar", "pcmanfm", "nemo"];
            let mut opened = false;

            for fm in fallbacks {
                if std::process::Command::new(fm).arg(path).spawn().is_ok() {
                    opened = true;
                    break;
                }
            }

            if !opened {
                return Err(AppError::Io(
                    "No file manager found. Please install xdg-open or a graphical file manager."
                        .to_string(),
                ));
            }
        }
    }

    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemMemoryInfo {
    pub total_mb: u64,
    pub available_mb: u64,
    pub recommended_min_mb: u64,
    pub recommended_max_mb: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModInfo {
    pub name: String,
    pub version: String,
    pub filename: String,
    pub enabled: bool,
    pub icon_url: Option<String>,
    pub project_id: Option<String>,
}

/// Metadata saved for mods installed from Modrinth
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModMetadata {
    pub name: String,
    pub version: String,
    pub project_id: String,
    pub version_id: Option<String>,
    pub icon_url: Option<String>,
}

/// Determine the content folder name based on loader type
/// - "mods" for Fabric, Forge, NeoForge, Quilt, Sponge (client and server)
/// - "plugins" for Paper, Purpur, Folia, Pufferfish, Spigot, Velocity, BungeeCord, Waterfall
/// - "mods" as default for clients
fn get_content_folder(loader: Option<&str>, is_server: bool) -> &'static str {
    match loader.map(|l| l.to_lowercase()).as_deref() {
        // Mod loaders - use "mods" folder
        Some("fabric") | Some("forge") | Some("neoforge") | Some("quilt") => "mods",
        // Sponge uses mods
        Some("spongevanilla") | Some("spongeforge") => "mods",
        // Plugin servers - use "plugins" folder
        Some("paper") | Some("purpur") | Some("folia") | Some("pufferfish") | Some("spigot")
        | Some("bukkit") => "plugins",
        // Proxies - use "plugins" folder
        Some("velocity") | Some("bungeecord") | Some("waterfall") => "plugins",
        // Vanilla server - no mods/plugins
        None if is_server => "plugins", // Default to plugins for vanilla servers (though they don't use them)
        // Vanilla client or unknown
        _ => "mods",
    }
}

/// Get the config folder based on loader type
/// For mod loaders (Fabric, Forge, NeoForge, Quilt, Sponge) -> "config"
/// For plugin servers (Paper, Purpur, etc.) -> "plugins" (plugin configs are inside plugin folders)
fn get_config_folder(loader: Option<&str>, is_server: bool) -> &'static str {
    match loader.map(|l| l.to_lowercase()).as_deref() {
        // Mod loaders - use "config" folder
        Some("fabric") | Some("forge") | Some("neoforge") | Some("quilt") => "config",
        // Sponge uses config folder
        Some("spongevanilla") | Some("spongeforge") => "config",
        // Plugin servers - configs are in "plugins" folder
        Some("paper") | Some("purpur") | Some("folia") | Some("pufferfish") | Some("spigot")
        | Some("bukkit") => "plugins",
        // Proxies - configs in plugins folder
        Some("velocity") | Some("bungeecord") | Some("waterfall") => "plugins",
        // Vanilla server - use plugins folder (though it's usually empty)
        None if is_server => "plugins",
        // Vanilla client or unknown - use config
        _ => "config",
    }
}

#[tauri::command]
pub async fn get_instances(state: State<'_, SharedState>) -> AppResult<Vec<Instance>> {
    let state = state.read().await;
    Instance::get_all(&state.db).await.map_err(AppError::from)
}

#[tauri::command]
pub async fn get_instance(
    state: State<'_, SharedState>,
    instance_id: String,
) -> AppResult<Option<Instance>> {
    let state = state.read().await;
    Instance::get_by_id(&state.db, &instance_id)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn create_instance(
    state: State<'_, SharedState>,
    name: String,
    mc_version: Option<String>,
    loader: Option<String>,
    loader_version: Option<String>,
    is_server: Option<bool>,
    is_proxy: Option<bool>,
    server_port: Option<i64>,
) -> AppResult<Instance> {
    let state_guard = state.read().await;

    let is_server = is_server.unwrap_or(false);
    let is_proxy = is_proxy.unwrap_or(false);

    // Validate the instance name
    if name.trim().is_empty() {
        return Err(AppError::Instance(
            "Instance name cannot be empty".to_string(),
        ));
    }

    // For proxies, mc_version is optional
    let mc_version = if is_proxy {
        mc_version.unwrap_or_else(|| "proxy".to_string())
    } else {
        mc_version.ok_or_else(|| AppError::Instance("Minecraft version is required".to_string()))?
    };

    // Create a safe directory name from the instance name
    let safe_name = name
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect::<String>();

    // Create instance directory structure (use custom or default instances dir)
    let base_instances_dir = state_guard.get_instances_dir().await;
    let instances_dir = base_instances_dir.join(&safe_name);

    // Check if instance directory already exists
    if instances_dir.exists() {
        return Err(AppError::Instance(format!(
            "An instance with the name '{}' already exists",
            name
        )));
    }

    // Create the instance directory and subdirectories
    fs::create_dir_all(&instances_dir)
        .await
        .map_err(|e| AppError::Io(format!("Failed to create instance directory: {}", e)))?;

    // Create directories based on type
    if is_server || is_proxy {
        // Server/proxy directories - use correct content folder based on loader
        let content_folder = get_content_folder(loader.as_deref(), true);
        for subdir in &[content_folder, "config", "logs", "world"] {
            fs::create_dir_all(instances_dir.join(subdir))
                .await
                .map_err(|e| {
                    AppError::Io(format!("Failed to create {} directory: {}", subdir, e))
                })?;
        }
    } else {
        // Client directories
        for subdir in &[
            "mods",
            "config",
            "resourcepacks",
            "shaderpacks",
            "saves",
            "screenshots",
        ] {
            fs::create_dir_all(instances_dir.join(subdir))
                .await
                .map_err(|e| {
                    AppError::Io(format!("Failed to create {} directory: {}", subdir, e))
                })?;
        }
    }

    // Only fetch version details for non-proxy instances
    let java_version = if !is_proxy {
        let version_details =
            match versions::load_version_details(&state_guard.data_dir, &mc_version).await? {
                Some(details) => details,
                None => {
                    // Fetch the manifest to get the version URL
                    let manifest =
                        versions::fetch_version_manifest(&state_guard.http_client).await?;

                    let version_info = manifest
                        .versions
                        .iter()
                        .find(|v| v.id == mc_version)
                        .ok_or_else(|| {
                            AppError::Instance(format!(
                                "Minecraft version {} not found",
                                mc_version
                            ))
                        })?;

                    // Fetch and save version details
                    let details = versions::fetch_version_details(
                        &state_guard.http_client,
                        &version_info.url,
                    )
                    .await?;
                    versions::save_version_details(&state_guard.data_dir, &mc_version, &details)
                        .await?;
                    details
                }
            };
        version_details
            .java_version
            .as_ref()
            .map(|j| j.major_version)
    } else {
        Some(21) // Default Java 21 for proxies
    };

    // Save instance info as JSON in the instance directory
    let instance_info = serde_json::json!({
        "name": name,
        "mc_version": mc_version,
        "loader": loader,
        "loader_version": loader_version,
        "java_version": java_version,
        "is_server": is_server,
        "is_proxy": is_proxy,
    });

    let instance_json = serde_json::to_string_pretty(&instance_info)
        .map_err(|e| AppError::Io(format!("Failed to serialize instance info: {}", e)))?;
    fs::write(instances_dir.join("instance.json"), instance_json)
        .await
        .map_err(|e| AppError::Io(format!("Failed to write instance.json: {}", e)))?;

    // Create the instance in the database
    let data = CreateInstance {
        name: name.clone(),
        mc_version: mc_version.clone(),
        loader: loader.clone(),
        loader_version: loader_version.clone(),
        is_server,
        is_proxy,
        server_port: server_port.unwrap_or(25565),
        modrinth_project_id: None,
    };

    let instance = Instance::create(&state_guard.db, data)
        .await
        .map_err(AppError::from)?;

    Ok(instance)
}

#[tauri::command]
pub async fn delete_instance(state: State<'_, SharedState>, instance_id: String) -> AppResult<()> {
    let state_guard = state.read().await;

    // Get the instance to find its game_dir
    if let Some(instance) = Instance::get_by_id(&state_guard.db, &instance_id)
        .await
        .map_err(AppError::from)?
    {
        // Delete the instance directory if it exists
        let instance_dir = state_guard
            .data_dir
            .join("instances")
            .join(&instance.game_dir);
        if instance_dir.exists() {
            fs::remove_dir_all(&instance_dir)
                .await
                .map_err(|e| AppError::Io(format!("Failed to delete instance directory: {}", e)))?;
        }
    }

    // Delete from database
    Instance::delete(&state_guard.db, &instance_id)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn update_instance_settings(
    state: State<'_, SharedState>,
    instance_id: String,
    name: String,
    memory_min_mb: i64,
    memory_max_mb: i64,
    java_path: Option<String>,
    jvm_args: Option<String>,
) -> AppResult<()> {
    let state_guard = state.read().await;

    Instance::update_settings(
        &state_guard.db,
        &instance_id,
        &name,
        memory_min_mb,
        memory_max_mb,
        java_path.as_deref(),
        jvm_args.as_deref(),
    )
    .await
    .map_err(AppError::from)
}

#[tauri::command]
pub async fn get_instance_mods(
    state: State<'_, SharedState>,
    instance_id: String,
) -> AppResult<Vec<ModInfo>> {
    let state_guard = state.read().await;

    let instance = Instance::get_by_id(&state_guard.db, &instance_id)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Instance("Instance not found".to_string()))?;

    // Determine folder based on loader type
    let folder_name = get_content_folder(instance.loader.as_deref(), instance.is_server);
    let mods_dir = state_guard
        .data_dir
        .join("instances")
        .join(&instance.game_dir)
        .join(folder_name);

    println!(
        "[GET_MODS] Instance: {}, loader: {:?}, is_server: {}, folder: {}, path: {:?}",
        instance.name, instance.loader, instance.is_server, folder_name, mods_dir
    );

    if !mods_dir.exists() {
        println!("[GET_MODS] Directory does not exist, creating it");
        // Create the directory if it doesn't exist
        fs::create_dir_all(&mods_dir).await.map_err(|e| {
            AppError::Io(format!("Failed to create {} directory: {}", folder_name, e))
        })?;
        return Ok(vec![]);
    }

    let mut mods = Vec::new();
    let mut entries = fs::read_dir(&mods_dir)
        .await
        .map_err(|e| AppError::Io(format!("Failed to read {} directory: {}", folder_name, e)))?;

    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| AppError::Io(format!("Failed to read directory entry: {}", e)))?
    {
        let filename = entry.file_name().to_string_lossy().to_string();

        // Check if it's a jar file (enabled) or disabled mod
        let (is_enabled, base_filename) = if filename.ends_with(".jar") {
            (true, filename.clone())
        } else if filename.ends_with(".jar.disabled") {
            (false, filename.replace(".disabled", ""))
        } else {
            continue;
        };

        // Try to extract mod info from filename
        let name = base_filename
            .trim_end_matches(".jar")
            .split('-')
            .next()
            .unwrap_or(&base_filename)
            .replace('_', " ");

        let version = base_filename
            .trim_end_matches(".jar")
            .split('-')
            .skip(1)
            .collect::<Vec<_>>()
            .join("-");

        // Try to read metadata file for this mod
        let meta_filename = format!("{}.meta.json", base_filename.trim_end_matches(".jar"));
        let meta_path = mods_dir.join(&meta_filename);
        let (icon_url, project_id, meta_name, meta_version) = if meta_path.exists() {
            match fs::read_to_string(&meta_path).await {
                Ok(content) => match serde_json::from_str::<ModMetadata>(&content) {
                    Ok(meta) => (
                        meta.icon_url,
                        Some(meta.project_id),
                        Some(meta.name),
                        Some(meta.version),
                    ),
                    Err(_) => (None, None, None, None),
                },
                Err(_) => (None, None, None, None),
            }
        } else {
            (None, None, None, None)
        };

        mods.push(ModInfo {
            name: meta_name.unwrap_or(name),
            version: meta_version.unwrap_or(if version.is_empty() {
                "Unknown".to_string()
            } else {
                version
            }),
            filename,
            enabled: is_enabled,
            icon_url,
            project_id,
        });
    }

    mods.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(mods)
}

/// Content info for resource packs, shaders, datapacks
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentInfo {
    pub name: String,
    pub version: String,
    pub filename: String,
    pub enabled: bool,
    pub icon_url: Option<String>,
    pub project_id: Option<String>,
}

/// Helper function to find the first world folder in saves/
async fn find_world_folder(instance_dir: &std::path::Path) -> Option<String> {
    let saves_dir = instance_dir.join("saves");
    if !saves_dir.exists() {
        return None;
    }

    let mut entries = match fs::read_dir(&saves_dir).await {
        Ok(e) => e,
        Err(_) => return None,
    };

    while let Ok(Some(entry)) = entries.next_entry().await {
        if let Ok(file_type) = entry.file_type().await {
            if file_type.is_dir() {
                return Some(entry.file_name().to_string_lossy().to_string());
            }
        }
    }

    None
}

/// Get installed resource packs for an instance
#[tauri::command]
pub async fn get_instance_resourcepacks(
    state: State<'_, SharedState>,
    instance_id: String,
) -> AppResult<Vec<ContentInfo>> {
    get_instance_content(state, instance_id, "resourcepacks", &[".zip"]).await
}

/// Get installed shaders for an instance
#[tauri::command]
pub async fn get_instance_shaders(
    state: State<'_, SharedState>,
    instance_id: String,
) -> AppResult<Vec<ContentInfo>> {
    get_instance_content(state, instance_id, "shaderpacks", &[".zip"]).await
}

/// Get installed datapacks for an instance
#[tauri::command]
pub async fn get_instance_datapacks(
    state: State<'_, SharedState>,
    instance_id: String,
) -> AppResult<Vec<ContentInfo>> {
    let state_guard = state.read().await;

    let instance = Instance::get_by_id(&state_guard.db, &instance_id)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Instance("Instance not found".to_string()))?;

    let instance_dir = state_guard
        .data_dir
        .join("instances")
        .join(&instance.game_dir);

    // Find world folder for datapacks
    let world_name = find_world_folder(&instance_dir)
        .await
        .unwrap_or_else(|| "world".to_string());
    let datapacks_dir = instance_dir
        .join("saves")
        .join(&world_name)
        .join("datapacks");

    if !datapacks_dir.exists() {
        return Ok(vec![]);
    }

    let mut content = Vec::new();
    let mut entries = fs::read_dir(&datapacks_dir)
        .await
        .map_err(|e| AppError::Io(format!("Failed to read datapacks directory: {}", e)))?;

    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| AppError::Io(format!("Failed to read directory entry: {}", e)))?
    {
        let filename = entry.file_name().to_string_lossy().to_string();

        // Check if it's a zip file (enabled) or disabled
        let (is_enabled, base_filename) = if filename.ends_with(".zip") {
            (true, filename.clone())
        } else if filename.ends_with(".zip.disabled") {
            (false, filename.replace(".disabled", ""))
        } else {
            continue;
        };

        // Extract name from filename
        let name = base_filename
            .trim_end_matches(".zip")
            .replace(['-', '_'], " ");

        // Try to read metadata file
        let meta_filename = format!("{}.meta.json", base_filename.trim_end_matches(".zip"));
        let meta_path = datapacks_dir.join(&meta_filename);
        let (icon_url, project_id, meta_name, meta_version) = if meta_path.exists() {
            match fs::read_to_string(&meta_path).await {
                Ok(content) => match serde_json::from_str::<ModMetadata>(&content) {
                    Ok(meta) => (
                        meta.icon_url,
                        Some(meta.project_id),
                        Some(meta.name),
                        Some(meta.version),
                    ),
                    Err(_) => (None, None, None, None),
                },
                Err(_) => (None, None, None, None),
            }
        } else {
            (None, None, None, None)
        };

        content.push(ContentInfo {
            name: meta_name.unwrap_or(name),
            version: meta_version.unwrap_or_else(|| "Unknown".to_string()),
            filename,
            enabled: is_enabled,
            icon_url,
            project_id,
        });
    }

    content.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(content)
}

/// Generic function to get content from a folder
async fn get_instance_content(
    state: State<'_, SharedState>,
    instance_id: String,
    folder: &str,
    extensions: &[&str],
) -> AppResult<Vec<ContentInfo>> {
    let state_guard = state.read().await;

    let instance = Instance::get_by_id(&state_guard.db, &instance_id)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Instance("Instance not found".to_string()))?;

    let content_dir = state_guard
        .data_dir
        .join("instances")
        .join(&instance.game_dir)
        .join(folder);

    if !content_dir.exists() {
        // Create the directory if it doesn't exist
        fs::create_dir_all(&content_dir)
            .await
            .map_err(|e| AppError::Io(format!("Failed to create {} directory: {}", folder, e)))?;
        return Ok(vec![]);
    }

    let mut content = Vec::new();
    let mut entries = fs::read_dir(&content_dir)
        .await
        .map_err(|e| AppError::Io(format!("Failed to read {} directory: {}", folder, e)))?;

    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| AppError::Io(format!("Failed to read directory entry: {}", e)))?
    {
        let filename = entry.file_name().to_string_lossy().to_string();

        // Check if file matches expected extensions
        let mut is_enabled = false;
        let mut base_filename = filename.clone();
        let mut matched = false;

        for ext in extensions {
            if filename.ends_with(ext) {
                is_enabled = true;
                base_filename = filename.clone();
                matched = true;
                break;
            } else if filename.ends_with(&format!("{}.disabled", ext)) {
                is_enabled = false;
                base_filename = filename.replace(".disabled", "");
                matched = true;
                break;
            }
        }

        if !matched {
            continue;
        }

        // Extract name from filename
        let ext_to_strip = extensions.first().unwrap_or(&".zip");
        let name = base_filename
            .trim_end_matches(ext_to_strip)
            .replace(['-', '_'], " ");

        // Try to read metadata file
        let meta_filename = format!("{}.meta.json", base_filename.trim_end_matches(ext_to_strip));
        let meta_path = content_dir.join(&meta_filename);
        let (icon_url, project_id, meta_name, meta_version) = if meta_path.exists() {
            match fs::read_to_string(&meta_path).await {
                Ok(content) => match serde_json::from_str::<ModMetadata>(&content) {
                    Ok(meta) => (
                        meta.icon_url,
                        Some(meta.project_id),
                        Some(meta.name),
                        Some(meta.version),
                    ),
                    Err(_) => (None, None, None, None),
                },
                Err(_) => (None, None, None, None),
            }
        } else {
            (None, None, None, None)
        };

        content.push(ContentInfo {
            name: meta_name.unwrap_or(name),
            version: meta_version.unwrap_or_else(|| "Unknown".to_string()),
            filename,
            enabled: is_enabled,
            icon_url,
            project_id,
        });
    }

    content.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(content)
}

#[tauri::command]
pub async fn toggle_mod(
    state: State<'_, SharedState>,
    instance_id: String,
    filename: String,
    enabled: bool,
) -> AppResult<()> {
    let state_guard = state.read().await;

    let instance = Instance::get_by_id(&state_guard.db, &instance_id)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Instance("Instance not found".to_string()))?;

    // Determine folder based on loader type
    let folder_name = get_content_folder(instance.loader.as_deref(), instance.is_server);
    let mods_dir = state_guard
        .data_dir
        .join("instances")
        .join(&instance.game_dir)
        .join(folder_name);
    let current_path = mods_dir.join(&filename);

    let new_filename = if enabled {
        // Enable: remove .disabled extension
        filename.trim_end_matches(".disabled").to_string()
    } else {
        // Disable: add .disabled extension
        format!("{}.disabled", filename)
    };

    let new_path = mods_dir.join(&new_filename);

    fs::rename(&current_path, &new_path)
        .await
        .map_err(|e| AppError::Io(format!("Failed to rename mod file: {}", e)))?;

    Ok(())
}

#[tauri::command]
pub async fn delete_mod(
    state: State<'_, SharedState>,
    instance_id: String,
    filename: String,
) -> AppResult<()> {
    let state_guard = state.read().await;

    let instance = Instance::get_by_id(&state_guard.db, &instance_id)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Instance("Instance not found".to_string()))?;

    // Determine folder based on loader type
    let folder_name = get_content_folder(instance.loader.as_deref(), instance.is_server);
    let mods_dir = state_guard
        .data_dir
        .join("instances")
        .join(&instance.game_dir)
        .join(folder_name);
    let mod_path = mods_dir.join(&filename);

    // Delete the mod file
    fs::remove_file(&mod_path)
        .await
        .map_err(|e| AppError::Io(format!("Failed to delete mod: {}", e)))?;

    // Also delete the associated .meta.json file if it exists
    let base_filename = filename
        .trim_end_matches(".disabled")
        .trim_end_matches(".jar");
    let meta_filename = format!("{}.meta.json", base_filename);
    let meta_path = mods_dir.join(&meta_filename);

    if meta_path.exists() {
        fs::remove_file(&meta_path).await.ok(); // Ignore errors for meta file
    }

    Ok(())
}

#[tauri::command]
pub async fn open_mods_folder(state: State<'_, SharedState>, instance_id: String) -> AppResult<()> {
    let state_guard = state.read().await;

    let instance = Instance::get_by_id(&state_guard.db, &instance_id)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Instance("Instance not found".to_string()))?;

    // Determine folder based on loader type
    let folder_name = get_content_folder(instance.loader.as_deref(), instance.is_server);
    let mods_dir = state_guard
        .data_dir
        .join("instances")
        .join(&instance.game_dir)
        .join(folder_name);

    // Create the directory if it doesn't exist
    if !mods_dir.exists() {
        fs::create_dir_all(&mods_dir).await.map_err(|e| {
            AppError::Io(format!("Failed to create {} directory: {}", folder_name, e))
        })?;
    }

    // Open the folder in the system file manager
    open_folder_in_file_manager(&mods_dir)?;

    Ok(())
}

/// Open the instance folder (or a subfolder) in the system file manager
#[tauri::command]
pub async fn open_instance_folder(
    state: State<'_, SharedState>,
    instance_id: String,
    subfolder: Option<String>,
) -> AppResult<()> {
    let state_guard = state.read().await;

    let instance = Instance::get_by_id(&state_guard.db, &instance_id)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Instance("Instance not found".to_string()))?;

    let mut target_dir = state_guard
        .get_instances_dir()
        .await
        .join(&instance.game_dir);

    // If subfolder is specified, append it to the path
    if let Some(ref sub) = subfolder {
        target_dir = target_dir.join(sub);
    }

    // Create the directory if it doesn't exist
    if !target_dir.exists() {
        fs::create_dir_all(&target_dir)
            .await
            .map_err(|e| AppError::Io(format!("Failed to create directory: {}", e)))?;
    }

    open_folder_in_file_manager(&target_dir)?;

    Ok(())
}

#[tauri::command]
pub fn get_system_memory() -> SystemMemoryInfo {
    let mut sys = System::new_all();
    sys.refresh_memory();

    let total_mb = sys.total_memory() / 1024 / 1024;
    let available_mb = sys.available_memory() / 1024 / 1024;

    // Calculate recommended values based on total RAM
    // Leave at least 4GB for the OS and other apps
    let usable_for_mc = total_mb.saturating_sub(4096);

    // Recommended min: 2GB for vanilla, but scale up if lots of RAM
    let recommended_min = if total_mb >= 16384 {
        4096 // 4GB min if you have 16GB+ total
    } else if total_mb >= 8192 {
        2048 // 2GB min if you have 8-16GB
    } else {
        1024 // 1GB min for low RAM systems
    };

    // Recommended max: sweet spot is 4-8GB for most modded MC
    // Too much RAM causes GC issues
    let recommended_max = if usable_for_mc >= 12288 {
        8192 // Cap at 8GB even if more available (GC performance)
    } else if usable_for_mc >= 6144 {
        6144 // 6GB is good for heavy modpacks
    } else if usable_for_mc >= 4096 {
        4096 // 4GB for medium modpacks
    } else {
        usable_for_mc.max(2048) // At least 2GB
    };

    SystemMemoryInfo {
        total_mb,
        available_mb,
        recommended_min_mb: recommended_min,
        recommended_max_mb: recommended_max,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogFileInfo {
    pub name: String,
    pub size_bytes: u64,
    pub modified: Option<String>,
}

#[tauri::command]
pub async fn get_instance_logs(
    state: State<'_, SharedState>,
    instance_id: String,
) -> AppResult<Vec<LogFileInfo>> {
    let state_guard = state.read().await;

    let instance = Instance::get_by_id(&state_guard.db, &instance_id)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Instance("Instance not found".to_string()))?;

    let logs_dir = state_guard
        .data_dir
        .join("instances")
        .join(&instance.game_dir)
        .join("logs");

    if !logs_dir.exists() {
        return Ok(vec![]);
    }

    let mut logs = Vec::new();
    let mut entries = fs::read_dir(&logs_dir)
        .await
        .map_err(|e| AppError::Io(format!("Failed to read logs directory: {}", e)))?;

    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| AppError::Io(format!("Failed to read directory entry: {}", e)))?
    {
        let filename = entry.file_name().to_string_lossy().to_string();

        // Only show .log files (not directories)
        if !filename.ends_with(".log") && !filename.ends_with(".log.gz") {
            continue;
        }

        let metadata = entry.metadata().await.ok();
        let size_bytes = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
        let modified = metadata.and_then(|m| m.modified().ok()).map(|t| {
            let datetime: chrono::DateTime<chrono::Local> = t.into();
            datetime.format("%Y-%m-%d %H:%M:%S").to_string()
        });

        logs.push(LogFileInfo {
            name: filename,
            size_bytes,
            modified,
        });
    }

    // Sort by modified date (most recent first), then by name
    logs.sort_by(|a, b| {
        b.modified
            .cmp(&a.modified)
            .then_with(|| a.name.cmp(&b.name))
    });

    Ok(logs)
}

#[tauri::command]
pub async fn read_instance_log(
    state: State<'_, SharedState>,
    instance_id: String,
    log_name: String,
    tail_lines: Option<usize>,
) -> AppResult<String> {
    let state_guard = state.read().await;

    let instance = Instance::get_by_id(&state_guard.db, &instance_id)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Instance("Instance not found".to_string()))?;

    let log_path = state_guard
        .data_dir
        .join("instances")
        .join(&instance.game_dir)
        .join("logs")
        .join(&log_name);

    if !log_path.exists() {
        return Err(AppError::Instance("Log file not found".to_string()));
    }

    let content = if log_name.ends_with(".gz") {
        // Read gzipped file
        use std::io::Read;
        let file = std::fs::File::open(&log_path)
            .map_err(|e| AppError::Io(format!("Failed to open log file: {}", e)))?;
        let mut decoder = flate2::read::GzDecoder::new(file);
        let mut content = String::new();
        decoder
            .read_to_string(&mut content)
            .map_err(|e| AppError::Io(format!("Failed to decompress log file: {}", e)))?;
        content
    } else {
        fs::read_to_string(&log_path)
            .await
            .map_err(|e| AppError::Io(format!("Failed to read log file: {}", e)))?
    };

    // If tail_lines is specified, only return the last N lines
    if let Some(n) = tail_lines {
        let lines: Vec<&str> = content.lines().collect();
        let start = lines.len().saturating_sub(n);
        Ok(lines[start..].join("\n"))
    } else {
        Ok(content)
    }
}

#[tauri::command]
pub async fn open_logs_folder(state: State<'_, SharedState>, instance_id: String) -> AppResult<()> {
    let state_guard = state.read().await;

    let instance = Instance::get_by_id(&state_guard.db, &instance_id)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Instance("Instance not found".to_string()))?;

    let logs_dir = state_guard
        .data_dir
        .join("instances")
        .join(&instance.game_dir)
        .join("logs");

    // Create logs dir if it doesn't exist
    if !logs_dir.exists() {
        fs::create_dir_all(&logs_dir)
            .await
            .map_err(|e| AppError::Io(format!("Failed to create logs directory: {}", e)))?;
    }

    // Open the folder in the system file manager
    open_folder_in_file_manager(&logs_dir)?;

    Ok(())
}

// Config file management

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigFileInfo {
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    pub file_type: String,
    pub modified: Option<String>,
}

/// Get all config files from the instance config folder
#[tauri::command]
pub async fn get_instance_config_files(
    state: State<'_, SharedState>,
    instance_id: String,
) -> AppResult<Vec<ConfigFileInfo>> {
    let state_guard = state.read().await;

    let instance = Instance::get_by_id(&state_guard.db, &instance_id)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Instance("Instance not found".to_string()))?;

    // Determine config folder based on loader type
    let config_folder = get_config_folder(instance.loader.as_deref(), instance.is_server);
    let config_dir = state_guard
        .data_dir
        .join("instances")
        .join(&instance.game_dir)
        .join(config_folder);

    if !config_dir.exists() {
        return Ok(vec![]);
    }

    let mut configs = Vec::new();
    collect_config_files(&config_dir, &config_dir, &mut configs).await?;

    // Sort by path
    configs.sort_by(|a, b| a.path.cmp(&b.path));

    Ok(configs)
}

/// Recursively collect config files
async fn collect_config_files(
    base_dir: &std::path::Path,
    current_dir: &std::path::Path,
    configs: &mut Vec<ConfigFileInfo>,
) -> AppResult<()> {
    let mut entries = fs::read_dir(current_dir)
        .await
        .map_err(|e| AppError::Io(format!("Failed to read config directory: {}", e)))?;

    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| AppError::Io(format!("Failed to read directory entry: {}", e)))?
    {
        let path = entry.path();
        let metadata = entry.metadata().await.ok();

        if path.is_dir() {
            // Recursively collect from subdirectories
            Box::pin(collect_config_files(base_dir, &path, configs)).await?;
        } else {
            let filename = entry.file_name().to_string_lossy().to_string();

            // Determine file type based on extension
            let file_type = if filename.ends_with(".json") || filename.ends_with(".json5") {
                "json"
            } else if filename.ends_with(".toml") {
                "toml"
            } else if filename.ends_with(".yml") || filename.ends_with(".yaml") {
                "yaml"
            } else if filename.ends_with(".properties") || filename.ends_with(".cfg") {
                "properties"
            } else if filename.ends_with(".txt") {
                "text"
            } else {
                continue; // Skip unsupported file types
            };

            let relative_path = path
                .strip_prefix(base_dir)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| filename.clone());

            let size_bytes = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
            let modified = metadata.and_then(|m| m.modified().ok()).map(|t| {
                let datetime: chrono::DateTime<chrono::Local> = t.into();
                datetime.format("%Y-%m-%d %H:%M:%S").to_string()
            });

            configs.push(ConfigFileInfo {
                name: filename,
                path: relative_path,
                size_bytes,
                file_type: file_type.to_string(),
                modified,
            });
        }
    }

    Ok(())
}

/// Read a config file content
#[tauri::command]
pub async fn read_config_file(
    state: State<'_, SharedState>,
    instance_id: String,
    config_path: String,
) -> AppResult<String> {
    let state_guard = state.read().await;

    let instance = Instance::get_by_id(&state_guard.db, &instance_id)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Instance("Instance not found".to_string()))?;

    // Determine config folder based on loader type
    let config_folder = get_config_folder(instance.loader.as_deref(), instance.is_server);
    let config_dir = state_guard
        .data_dir
        .join("instances")
        .join(&instance.game_dir)
        .join(config_folder);
    let file_path = config_dir.join(&config_path);

    // Security: ensure the path is within config directory
    let canonical_config = config_dir
        .canonicalize()
        .map_err(|e| AppError::Io(format!("Failed to resolve config directory: {}", e)))?;
    let canonical_file = file_path
        .canonicalize()
        .map_err(|e| AppError::Io(format!("Config file not found: {}", e)))?;

    if !canonical_file.starts_with(&canonical_config) {
        return Err(AppError::Instance("Invalid config path".to_string()));
    }

    fs::read_to_string(&file_path)
        .await
        .map_err(|e| AppError::Io(format!("Failed to read config file: {}", e)))
}

/// Save a config file
#[tauri::command]
pub async fn save_config_file(
    state: State<'_, SharedState>,
    instance_id: String,
    config_path: String,
    content: String,
) -> AppResult<()> {
    let state_guard = state.read().await;

    let instance = Instance::get_by_id(&state_guard.db, &instance_id)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Instance("Instance not found".to_string()))?;

    // Determine config folder based on loader type
    let config_folder = get_config_folder(instance.loader.as_deref(), instance.is_server);
    let config_dir = state_guard
        .data_dir
        .join("instances")
        .join(&instance.game_dir)
        .join(config_folder);
    let file_path = config_dir.join(&config_path);

    // Security: ensure the path is within config directory
    let canonical_config = config_dir
        .canonicalize()
        .map_err(|e| AppError::Io(format!("Failed to resolve config directory: {}", e)))?;

    // For saving, we check the parent directory since the file might be new
    let parent = file_path
        .parent()
        .ok_or_else(|| AppError::Instance("Invalid config path".to_string()))?;

    let canonical_parent = parent
        .canonicalize()
        .map_err(|e| AppError::Io(format!("Config directory not found: {}", e)))?;

    if !canonical_parent.starts_with(&canonical_config) {
        return Err(AppError::Instance("Invalid config path".to_string()));
    }

    fs::write(&file_path, content)
        .await
        .map_err(|e| AppError::Io(format!("Failed to save config file: {}", e)))
}

/// Open config folder in file manager
#[tauri::command]
pub async fn open_config_folder(
    state: State<'_, SharedState>,
    instance_id: String,
) -> AppResult<()> {
    let state_guard = state.read().await;

    let instance = Instance::get_by_id(&state_guard.db, &instance_id)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Instance("Instance not found".to_string()))?;

    // Determine config folder based on loader type
    let config_folder = get_config_folder(instance.loader.as_deref(), instance.is_server);
    let config_dir = state_guard
        .data_dir
        .join("instances")
        .join(&instance.game_dir)
        .join(config_folder);

    // Create config dir if it doesn't exist
    if !config_dir.exists() {
        fs::create_dir_all(&config_dir)
            .await
            .map_err(|e| AppError::Io(format!("Failed to create config directory: {}", e)))?;
    }

    open_folder_in_file_manager(&config_dir)?;

    Ok(())
}

#[tauri::command]
pub async fn update_instance_icon(
    state: State<'_, SharedState>,
    instance_id: String,
    icon_source: String,
) -> AppResult<String> {
    let state_guard = state.read().await;

    // Get the instance to find its game_dir
    let instance = Instance::get_by_id(&state_guard.db, &instance_id)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Instance("Instance not found".to_string()))?;

    let instance_dir = state_guard
        .data_dir
        .join("instances")
        .join(&instance.game_dir);

    // Determine if icon_source is a URL or a file path
    let is_url = icon_source.starts_with("http://") || icon_source.starts_with("https://");

    let saved_icon_path: String;

    if is_url {
        // Download icon from URL
        let http_client = reqwest::Client::builder()
            .user_agent("KaizenLauncher/1.0")
            .build()
            .map_err(|e| AppError::Io(format!("Failed to create HTTP client: {}", e)))?;

        // Determine file extension from URL
        let url_without_params = icon_source.split('?').next().unwrap_or(&icon_source);
        let extension = url_without_params
            .rsplit('.')
            .next()
            .filter(|ext| {
                let ext_lower = ext.to_lowercase();
                ["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"].contains(&ext_lower.as_str())
            })
            .unwrap_or("png");

        let icon_filename = format!("icon.{}", extension);
        let icon_full_path = instance_dir.join(&icon_filename);

        let response = http_client
            .get(&icon_source)
            .send()
            .await
            .map_err(|e| AppError::Io(format!("Failed to download icon: {}", e)))?;

        if !response.status().is_success() {
            return Err(AppError::Io(format!(
                "Failed to download icon: HTTP {}",
                response.status()
            )));
        }

        let bytes = response
            .bytes()
            .await
            .map_err(|e| AppError::Io(format!("Failed to read icon bytes: {}", e)))?;

        fs::write(&icon_full_path, &bytes)
            .await
            .map_err(|e| AppError::Io(format!("Failed to save icon: {}", e)))?;

        saved_icon_path = icon_filename;
    } else {
        // Copy icon from local file path
        let source_path = std::path::Path::new(&icon_source);

        if !source_path.exists() {
            return Err(AppError::Io(format!(
                "Icon file not found: {}",
                icon_source
            )));
        }

        // Get the extension from the source file
        let extension = source_path
            .extension()
            .and_then(|e| e.to_str())
            .filter(|ext| {
                let ext_lower = ext.to_lowercase();
                ["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"].contains(&ext_lower.as_str())
            })
            .unwrap_or("png");

        let icon_filename = format!("icon.{}", extension);
        let icon_full_path = instance_dir.join(&icon_filename);

        fs::copy(&source_path, &icon_full_path)
            .await
            .map_err(|e| AppError::Io(format!("Failed to copy icon: {}", e)))?;

        saved_icon_path = icon_filename;
    }

    // Update the database with the new icon path
    Instance::update_icon(&state_guard.db, &instance_id, Some(&saved_icon_path))
        .await
        .map_err(AppError::from)?;

    Ok(saved_icon_path)
}

#[tauri::command]
pub async fn clear_instance_icon(
    state: State<'_, SharedState>,
    instance_id: String,
) -> AppResult<()> {
    let state_guard = state.read().await;

    // Get the instance to find its game_dir and current icon
    let instance = Instance::get_by_id(&state_guard.db, &instance_id)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Instance("Instance not found".to_string()))?;

    // Delete the icon file if it exists
    if let Some(icon_path) = &instance.icon_path {
        let icon_full_path = state_guard
            .data_dir
            .join("instances")
            .join(&instance.game_dir)
            .join(icon_path);

        if icon_full_path.exists() {
            let _ = fs::remove_file(&icon_full_path).await;
        }
    }

    // Clear the icon path in the database
    Instance::update_icon(&state_guard.db, &instance_id, None)
        .await
        .map_err(AppError::from)?;

    Ok(())
}

#[tauri::command]
pub async fn get_instance_icon(
    state: State<'_, SharedState>,
    instance_id: String,
) -> AppResult<Option<String>> {
    use base64::{engine::general_purpose::STANDARD, Engine};

    let state_guard = state.read().await;

    let instance = Instance::get_by_id(&state_guard.db, &instance_id)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Instance("Instance not found".to_string()))?;

    let Some(icon_path) = &instance.icon_path else {
        return Ok(None);
    };

    let icon_full_path = state_guard
        .data_dir
        .join("instances")
        .join(&instance.game_dir)
        .join(icon_path);

    if !icon_full_path.exists() {
        return Ok(None);
    }

    let bytes = fs::read(&icon_full_path)
        .await
        .map_err(|e| AppError::Io(format!("Failed to read icon: {}", e)))?;

    // Determine MIME type from extension
    let extension = icon_path.rsplit('.').next().unwrap_or("png").to_lowercase();
    let mime_type = match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        _ => "image/png",
    };

    let base64_data = STANDARD.encode(&bytes);
    Ok(Some(format!("data:{};base64,{}", mime_type, base64_data)))
}

/// Batch get instance icons - takes (instance_id, game_dir, icon_path) tuples
/// Returns a map of instance_id -> Option<base64_data_url>
/// This avoids N database queries since we already have icon_path from get_instances
#[tauri::command]
pub async fn get_instance_icons(
    state: State<'_, SharedState>,
    instances: Vec<(String, String, Option<String>)>, // (instance_id, game_dir, icon_path)
) -> AppResult<std::collections::HashMap<String, Option<String>>> {
    use base64::{engine::general_purpose::STANDARD, Engine};

    let state_guard = state.read().await;
    let instances_dir = state_guard.get_instances_dir().await;

    let mut result = std::collections::HashMap::new();

    for (instance_id, game_dir, icon_path) in instances {
        let icon_data = if let Some(ref path) = icon_path {
            let icon_full_path = instances_dir.join(&game_dir).join(path);

            if icon_full_path.exists() {
                match fs::read(&icon_full_path).await {
                    Ok(bytes) => {
                        // Determine MIME type from extension
                        let extension = path.rsplit('.').next().unwrap_or("png").to_lowercase();
                        let mime_type = match extension.as_str() {
                            "png" => "image/png",
                            "jpg" | "jpeg" => "image/jpeg",
                            "gif" => "image/gif",
                            "webp" => "image/webp",
                            "svg" => "image/svg+xml",
                            "ico" => "image/x-icon",
                            _ => "image/png",
                        };
                        let base64_data = STANDARD.encode(&bytes);
                        Some(format!("data:{};base64,{}", mime_type, base64_data))
                    }
                    Err(_) => None,
                }
            } else {
                None
            }
        } else {
            None
        };

        result.insert(instance_id, icon_data);
    }

    Ok(result)
}

/// Get total mod count across all instances
#[tauri::command]
pub async fn get_total_mod_count(state: State<'_, SharedState>) -> AppResult<u32> {
    let state_guard = state.read().await;
    let instances = Instance::get_all(&state_guard.db)
        .await
        .map_err(AppError::from)?;

    let mut total_count: u32 = 0;

    for instance in instances {
        let folder_name = get_content_folder(instance.loader.as_deref(), instance.is_server);
        let mods_dir = state_guard
            .data_dir
            .join("instances")
            .join(&instance.game_dir)
            .join(folder_name);

        if mods_dir.exists() {
            if let Ok(mut entries) = fs::read_dir(&mods_dir).await {
                while let Ok(Some(entry)) = entries.next_entry().await {
                    let filename = entry.file_name().to_string_lossy().to_string();
                    if filename.ends_with(".jar") || filename.ends_with(".jar.disabled") {
                        total_count += 1;
                    }
                }
            }
        }
    }

    Ok(total_count)
}

/// Get all installed modpack project IDs from Modrinth
#[tauri::command]
pub async fn get_installed_modpack_ids(state: State<'_, SharedState>) -> AppResult<Vec<String>> {
    let state_guard = state.read().await;
    Instance::get_installed_modpack_ids(&state_guard.db)
        .await
        .map_err(AppError::from)
}

/// Get instances that were installed from a specific Modrinth modpack
#[tauri::command]
pub async fn get_instances_by_modpack(
    state: State<'_, SharedState>,
    project_id: String,
) -> AppResult<Vec<Instance>> {
    let state_guard = state.read().await;
    Instance::get_by_modrinth_project_id(&state_guard.db, &project_id)
        .await
        .map_err(AppError::from)
}

// Storage management

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageInfo {
    pub data_dir: String,
    pub total_size_bytes: u64,
    pub instances_size_bytes: u64,
    pub java_size_bytes: u64,
    pub cache_size_bytes: u64,
    pub other_size_bytes: u64,
    pub instance_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceStorageInfo {
    pub id: String,
    pub name: String,
    pub size_bytes: u64,
    pub mc_version: String,
    pub loader: Option<String>,
    pub last_played: Option<String>,
}

/// Calculate directory size recursively
async fn get_dir_size(path: &std::path::Path) -> u64 {
    let mut size: u64 = 0;

    if let Ok(mut entries) = fs::read_dir(path).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let entry_path = entry.path();
            if let Ok(metadata) = entry.metadata().await {
                if metadata.is_dir() {
                    size += Box::pin(get_dir_size(&entry_path)).await;
                } else {
                    size += metadata.len();
                }
            }
        }
    }

    size
}

/// Get storage information for the launcher
#[tauri::command]
pub async fn get_storage_info(state: State<'_, SharedState>) -> AppResult<StorageInfo> {
    let state_guard = state.read().await;
    let data_dir = &state_guard.data_dir;

    // Use custom instances directory if set
    let instances_dir = state_guard.get_instances_dir().await;
    let java_dir = data_dir.join("java");
    let cache_dir = data_dir.join("cache");

    let instances_size = if instances_dir.exists() {
        get_dir_size(&instances_dir).await
    } else {
        0
    };

    let java_size = if java_dir.exists() {
        get_dir_size(&java_dir).await
    } else {
        0
    };

    let cache_size = if cache_dir.exists() {
        get_dir_size(&cache_dir).await
    } else {
        0
    };

    let total_size = get_dir_size(data_dir).await;
    let other_size = total_size.saturating_sub(instances_size + java_size + cache_size);

    let instances = Instance::get_all(&state_guard.db)
        .await
        .map_err(AppError::from)?;

    Ok(StorageInfo {
        data_dir: data_dir.to_string_lossy().to_string(),
        total_size_bytes: total_size,
        instances_size_bytes: instances_size,
        java_size_bytes: java_size,
        cache_size_bytes: cache_size,
        other_size_bytes: other_size,
        instance_count: instances.len() as u32,
    })
}

/// Get storage info for each instance
/// OPTIMIZED: Uses parallel directory size calculations for better performance
#[tauri::command]
pub async fn get_instances_storage(
    state: State<'_, SharedState>,
) -> AppResult<Vec<InstanceStorageInfo>> {
    let state_guard = state.read().await;
    let instances = Instance::get_all(&state_guard.db)
        .await
        .map_err(AppError::from)?;

    let instances_base_dir = state_guard.get_instances_dir().await;

    // Drop the lock before parallel operations
    drop(state_guard);

    // Calculate all directory sizes in parallel for better performance
    let mut tasks = Vec::new();

    for instance in instances {
        let instance_dir = instances_base_dir.join(&instance.game_dir);

        tasks.push(async move {
            let size = if instance_dir.exists() {
                get_dir_size(&instance_dir).await
            } else {
                0
            };

            InstanceStorageInfo {
                id: instance.id,
                name: instance.name,
                size_bytes: size,
                mc_version: instance.mc_version,
                loader: instance.loader,
                last_played: instance.last_played,
            }
        });
    }

    // Execute all size calculations in parallel
    let mut result = future::join_all(tasks).await;

    // Sort by size descending
    result.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));

    Ok(result)
}

/// Open the data directory in file manager
#[tauri::command]
pub async fn open_data_folder(state: State<'_, SharedState>) -> AppResult<()> {
    let state_guard = state.read().await;
    let data_dir = &state_guard.data_dir;

    open_folder_in_file_manager(data_dir)?;

    Ok(())
}

/// Clear the cache directory
#[tauri::command]
pub async fn clear_cache(state: State<'_, SharedState>) -> AppResult<u64> {
    let state_guard = state.read().await;
    let cache_dir = state_guard.data_dir.join("cache");

    if !cache_dir.exists() {
        return Ok(0);
    }

    let size = get_dir_size(&cache_dir).await;

    fs::remove_dir_all(&cache_dir)
        .await
        .map_err(|e| AppError::Io(format!("Failed to clear cache: {}", e)))?;

    // Recreate empty cache directory
    fs::create_dir_all(&cache_dir)
        .await
        .map_err(|e| AppError::Io(format!("Failed to recreate cache directory: {}", e)))?;

    Ok(size)
}

/// Get the current instances directory configuration
#[derive(serde::Serialize)]
pub struct InstancesDirectoryInfo {
    pub current_path: String,
    pub default_path: String,
    pub is_custom: bool,
}

#[tauri::command]
pub async fn get_instances_directory(
    state: State<'_, SharedState>,
) -> AppResult<InstancesDirectoryInfo> {
    let state_guard = state.read().await;
    let default_path = state_guard.get_default_instances_dir();
    let current_path = state_guard.get_instances_dir().await;
    let is_custom = current_path != default_path;

    Ok(InstancesDirectoryInfo {
        current_path: current_path.to_string_lossy().to_string(),
        default_path: default_path.to_string_lossy().to_string(),
        is_custom,
    })
}

/// Set a custom instances directory
#[tauri::command]
pub async fn set_instances_directory(
    state: State<'_, SharedState>,
    path: Option<String>,
) -> AppResult<()> {
    let state_guard = state.read().await;

    match path {
        Some(custom_path) => {
            // Validate the path exists or can be created
            let path = std::path::PathBuf::from(&custom_path);
            if !path.exists() {
                fs::create_dir_all(&path)
                    .await
                    .map_err(|e| AppError::Io(format!("Failed to create directory: {}", e)))?;
            }

            // Save to settings
            crate::db::settings::set_setting(&state_guard.db, "instances_dir", &custom_path)
                .await
                .map_err(AppError::from)?;
        }
        None => {
            // Reset to default - remove the setting
            sqlx::query("DELETE FROM settings WHERE key = 'instances_dir'")
                .execute(&state_guard.db)
                .await
                .map_err(AppError::from)?;
        }
    }

    Ok(())
}

/// Open the instances directory in file manager
#[tauri::command]
pub async fn open_instances_folder(state: State<'_, SharedState>) -> AppResult<()> {
    let state_guard = state.read().await;
    let instances_dir = state_guard.get_instances_dir().await;

    // Ensure directory exists
    if !instances_dir.exists() {
        fs::create_dir_all(&instances_dir)
            .await
            .map_err(|e| AppError::Io(format!("Failed to create instances directory: {}", e)))?;
    }

    open_folder_in_file_manager(&instances_dir)?;

    Ok(())
}

/// Get used server ports by all server/proxy instances
#[derive(Debug, Clone, Serialize)]
pub struct UsedPort {
    pub port: i64,
    pub instance_name: String,
    pub instance_id: String,
}

#[tauri::command]
pub async fn get_used_server_ports(state: State<'_, SharedState>) -> AppResult<Vec<UsedPort>> {
    let state_guard = state.read().await;

    let instances = Instance::get_all(&state_guard.db)
        .await
        .map_err(AppError::from)?;

    let used_ports: Vec<UsedPort> = instances
        .into_iter()
        .filter(|i| i.is_server || i.is_proxy)
        .map(|i| UsedPort {
            port: i.server_port,
            instance_name: i.name,
            instance_id: i.id,
        })
        .collect();

    Ok(used_ports)
}

// ============================================================================
// World Management Commands
// ============================================================================

/// Get all worlds for an instance
#[tauri::command]
pub async fn get_instance_worlds(
    state: State<'_, SharedState>,
    instance_id: String,
) -> AppResult<Vec<WorldInfo>> {
    let state_guard = state.read().await;

    let instance = Instance::get_by_id(&state_guard.db, &instance_id)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Instance("Instance not found".to_string()))?;

    let instances_dir = state_guard.get_instances_dir().await;
    let instance_dir = instances_dir.join(&instance.game_dir);

    if instance.is_server || instance.is_proxy {
        worlds::get_worlds_for_server(&instance_dir, &state_guard.data_dir, &instance_id).await
    } else {
        worlds::get_worlds_for_client(&instance_dir, &state_guard.data_dir, &instance_id).await
    }
}

/// Get all backups for a specific world
#[tauri::command]
pub async fn get_world_backups(
    state: State<'_, SharedState>,
    instance_id: String,
    world_name: String,
) -> AppResult<Vec<BackupInfo>> {
    let state_guard = state.read().await;
    worlds::list_backups(&state_guard.data_dir, &instance_id, &world_name).await
}

/// Create a backup of a world
#[tauri::command]
pub async fn backup_world(
    state: State<'_, SharedState>,
    app: AppHandle,
    instance_id: String,
    world_name: String,
) -> AppResult<BackupInfo> {
    let state_guard = state.read().await;

    let instance = Instance::get_by_id(&state_guard.db, &instance_id)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Instance("Instance not found".to_string()))?;

    let instances_dir = state_guard.get_instances_dir().await;
    let instance_dir = instances_dir.join(&instance.game_dir);

    // Get world info to determine folders
    let worlds = if instance.is_server || instance.is_proxy {
        worlds::get_worlds_for_server(&instance_dir, &state_guard.data_dir, &instance_id).await?
    } else {
        worlds::get_worlds_for_client(&instance_dir, &state_guard.data_dir, &instance_id).await?
    };

    let world = worlds
        .iter()
        .find(|w| w.name == world_name)
        .ok_or_else(|| AppError::Instance("World not found".to_string()))?;

    worlds::create_backup(
        &instance_dir,
        &state_guard.data_dir,
        &instance_id,
        &world_name,
        &world.world_folders,
        Some(&app),
    )
    .await
}

/// Restore a world from a backup
#[tauri::command]
pub async fn restore_world_backup(
    state: State<'_, SharedState>,
    app: AppHandle,
    instance_id: String,
    world_name: String,
    backup_filename: String,
) -> AppResult<()> {
    let state_guard = state.read().await;

    let instance = Instance::get_by_id(&state_guard.db, &instance_id)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Instance("Instance not found".to_string()))?;

    let instances_dir = state_guard.get_instances_dir().await;
    let instance_dir = instances_dir.join(&instance.game_dir);

    worlds::restore_backup(
        &instance_dir,
        &state_guard.data_dir,
        &instance_id,
        &world_name,
        &backup_filename,
        instance.is_server || instance.is_proxy,
        Some(&app),
    )
    .await
}

/// Delete a world
#[tauri::command]
pub async fn delete_world(
    state: State<'_, SharedState>,
    instance_id: String,
    world_name: String,
) -> AppResult<()> {
    let state_guard = state.read().await;

    let instance = Instance::get_by_id(&state_guard.db, &instance_id)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Instance("Instance not found".to_string()))?;

    let instances_dir = state_guard.get_instances_dir().await;
    let instance_dir = instances_dir.join(&instance.game_dir);

    worlds::delete_world(
        &instance_dir,
        &world_name,
        instance.is_server || instance.is_proxy,
    )
    .await
}

/// Duplicate a world with a new name
#[tauri::command]
pub async fn duplicate_world(
    state: State<'_, SharedState>,
    instance_id: String,
    world_name: String,
    new_name: String,
) -> AppResult<WorldInfo> {
    let state_guard = state.read().await;

    let instance = Instance::get_by_id(&state_guard.db, &instance_id)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Instance("Instance not found".to_string()))?;

    if instance.is_server || instance.is_proxy {
        return Err(AppError::Instance(
            "Cannot duplicate server worlds".to_string(),
        ));
    }

    let instances_dir = state_guard.get_instances_dir().await;
    let instance_dir = instances_dir.join(&instance.game_dir);

    worlds::duplicate_world(
        &instance_dir,
        &state_guard.data_dir,
        &instance_id,
        &world_name,
        &new_name,
        false,
    )
    .await
}

/// Rename a world
#[tauri::command]
pub async fn rename_world(
    state: State<'_, SharedState>,
    instance_id: String,
    old_name: String,
    new_name: String,
) -> AppResult<WorldInfo> {
    let state_guard = state.read().await;

    let instance = Instance::get_by_id(&state_guard.db, &instance_id)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Instance("Instance not found".to_string()))?;

    if instance.is_server || instance.is_proxy {
        return Err(AppError::Instance(
            "Cannot rename server worlds".to_string(),
        ));
    }

    let instances_dir = state_guard.get_instances_dir().await;
    let instance_dir = instances_dir.join(&instance.game_dir);

    worlds::rename_world(
        &instance_dir,
        &state_guard.data_dir,
        &instance_id,
        &old_name,
        &new_name,
        false,
    )
    .await
}

/// Open a world folder in file manager
#[tauri::command]
pub async fn open_world_folder(
    state: State<'_, SharedState>,
    instance_id: String,
    world_name: String,
) -> AppResult<()> {
    let state_guard = state.read().await;

    let instance = Instance::get_by_id(&state_guard.db, &instance_id)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Instance("Instance not found".to_string()))?;

    let instances_dir = state_guard.get_instances_dir().await;
    let instance_dir = instances_dir.join(&instance.game_dir);

    let world_path = if instance.is_server || instance.is_proxy {
        instance_dir.join("world")
    } else {
        instance_dir.join("saves").join(&world_name)
    };

    if !world_path.exists() {
        return Err(AppError::Instance("World folder not found".to_string()));
    }

    open_folder_in_file_manager(&world_path)
}

/// Delete a specific backup
#[tauri::command]
pub async fn delete_world_backup(
    state: State<'_, SharedState>,
    instance_id: String,
    world_name: String,
    backup_filename: String,
) -> AppResult<()> {
    let state_guard = state.read().await;
    worlds::delete_backup(
        &state_guard.data_dir,
        &instance_id,
        &world_name,
        &backup_filename,
    )
    .await
}

/// Get auto-backup setting for an instance
#[tauri::command]
pub async fn get_instance_auto_backup(
    state: State<'_, SharedState>,
    instance_id: String,
) -> AppResult<bool> {
    let state_guard = state.read().await;

    let result =
        sqlx::query_scalar::<_, i64>("SELECT auto_backup_worlds FROM instances WHERE id = ?")
            .bind(&instance_id)
            .fetch_optional(&state_guard.db)
            .await
            .map_err(AppError::from)?;

    Ok(result.unwrap_or(0) == 1)
}

/// Set auto-backup setting for an instance
#[tauri::command]
pub async fn set_instance_auto_backup(
    state: State<'_, SharedState>,
    instance_id: String,
    enabled: bool,
) -> AppResult<()> {
    let state_guard = state.read().await;

    sqlx::query("UPDATE instances SET auto_backup_worlds = ? WHERE id = ?")
        .bind(if enabled { 1 } else { 0 })
        .bind(&instance_id)
        .execute(&state_guard.db)
        .await
        .map_err(AppError::from)?;

    Ok(())
}

/// Perform auto-backup of all worlds (called before launch)
#[tauri::command]
pub async fn auto_backup_worlds(
    state: State<'_, SharedState>,
    app: AppHandle,
    instance_id: String,
) -> AppResult<Vec<BackupInfo>> {
    let state_guard = state.read().await;

    let instance = Instance::get_by_id(&state_guard.db, &instance_id)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Instance("Instance not found".to_string()))?;

    let instances_dir = state_guard.get_instances_dir().await;
    let instance_dir = instances_dir.join(&instance.game_dir);

    worlds::auto_backup_all_worlds(
        &instance_dir,
        &state_guard.data_dir,
        &instance_id,
        instance.is_server || instance.is_proxy,
        Some(&app),
    )
    .await
}

// ============================================================================
// Global Backup Management Commands (for centralized Backups page)
// ============================================================================

/// Get all backups across all instances
#[tauri::command]
pub async fn get_all_backups(state: State<'_, SharedState>) -> AppResult<Vec<GlobalBackupInfo>> {
    let state_guard = state.read().await;

    // Get all instances to map IDs to names
    let instances = Instance::get_all(&state_guard.db)
        .await
        .map_err(AppError::from)?;

    let instance_info: Vec<(String, String, bool)> = instances
        .iter()
        .map(|i| (i.id.clone(), i.name.clone(), i.is_server || i.is_proxy))
        .collect();

    worlds::list_all_backups(&state_guard.data_dir, &instance_info).await
}

/// Get backup storage statistics
#[tauri::command]
pub async fn get_backup_stats(state: State<'_, SharedState>) -> AppResult<BackupStats> {
    let state_guard = state.read().await;
    worlds::get_backup_storage_stats(&state_guard.data_dir).await
}

/// Restore a backup to a different instance
#[tauri::command]
pub async fn restore_backup_to_other_instance(
    state: State<'_, SharedState>,
    app: AppHandle,
    source_instance_id: String,
    world_name: String,
    backup_filename: String,
    target_instance_id: String,
) -> AppResult<()> {
    let state_guard = state.read().await;

    // Get target instance
    let target_instance = Instance::get_by_id(&state_guard.db, &target_instance_id)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Instance("Target instance not found".to_string()))?;

    let instances_dir = state_guard.get_instances_dir().await;

    worlds::restore_backup_to_instance(
        &state_guard.data_dir,
        &instances_dir,
        &source_instance_id,
        &world_name,
        &backup_filename,
        &target_instance.game_dir,
        target_instance.is_server || target_instance.is_proxy,
        Some(&app),
    )
    .await
}
