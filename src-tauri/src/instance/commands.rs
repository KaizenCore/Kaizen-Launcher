use crate::db::instances::{CreateInstance, Instance};
use crate::error::{AppError, AppResult};
use crate::instance::instance_backup::{
    self, GlobalInstanceBackupInfo, InstanceBackupInfo, InstanceBackupManifest, InstanceBackupStats,
};
use crate::instance::worlds::{self, BackupInfo, BackupStats, GlobalBackupInfo, WorldInfo};
use crate::minecraft::versions;
use crate::state::SharedState;
use futures_util::future;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
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

/// Stored dependency info for mods
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredDependency {
    pub project_id: String,
    pub dependency_type: String, // "required" or "optional"
}

/// Metadata saved for mods installed from Modrinth
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModMetadata {
    pub name: String,
    pub version: String,
    pub project_id: String,
    pub version_id: Option<String>,
    pub icon_url: Option<String>,
    /// Server-side compatibility: "required", "optional", or "unsupported"
    #[serde(default)]
    pub server_side: Option<String>,
    /// Client-side compatibility: "required", "optional", or "unsupported"
    #[serde(default)]
    pub client_side: Option<String>,
    /// Dependencies (project_id and type)
    #[serde(default)]
    pub dependencies: Vec<StoredDependency>,
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
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err(AppError::Instance(
            "Instance name cannot be empty".to_string(),
        ));
    }

    // Maximum length validation to prevent excessively long names
    const MAX_INSTANCE_NAME_LENGTH: usize = 64;
    if trimmed_name.len() > MAX_INSTANCE_NAME_LENGTH {
        return Err(AppError::Instance(format!(
            "Instance name is too long (max {} characters)",
            MAX_INSTANCE_NAME_LENGTH
        )));
    }

    // For proxies, mc_version is optional
    let mc_version = if is_proxy {
        mc_version.unwrap_or_else(|| "proxy".to_string())
    } else {
        mc_version.ok_or_else(|| AppError::Instance("Minecraft version is required".to_string()))?
    };

    // Create a safe directory name from the instance name
    let safe_name = trimmed_name
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

/// Get the mods/plugins folder path for an instance
#[tauri::command]
pub async fn get_mods_folder_path(
    state: State<'_, SharedState>,
    instance_id: String,
) -> AppResult<String> {
    let state_guard = state.read().await;

    let instance = Instance::get_by_id(&state_guard.db, &instance_id)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Instance("Instance not found".to_string()))?;

    // Determine folder based on loader type
    let folder_name = get_content_folder(instance.loader.as_deref(), instance.is_server);
    let instances_dir = state_guard.get_instances_dir().await;
    let mods_dir = instances_dir.join(&instance.game_dir).join(folder_name);

    // Create the directory if it doesn't exist
    if !mods_dir.exists() {
        fs::create_dir_all(&mods_dir).await.map_err(|e| {
            AppError::Io(format!("Failed to create {} directory: {}", folder_name, e))
        })?;
    }

    Ok(mods_dir.to_string_lossy().to_string())
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

    // If subfolder is specified, append it to the path with path traversal protection
    if let Some(ref sub) = subfolder {
        let new_target = target_dir.join(sub);
        // Canonicalize to resolve any ../ sequences and verify it's still within instance dir
        let base_canonical = target_dir
            .canonicalize()
            .map_err(|e| AppError::Instance(format!("Failed to resolve instance path: {}", e)))?;

        // Create the target directory first if needed (canonicalize requires existing path)
        if !new_target.exists() {
            fs::create_dir_all(&new_target)
                .await
                .map_err(|e| AppError::Io(format!("Failed to create directory: {}", e)))?;
        }

        let target_canonical = new_target
            .canonicalize()
            .map_err(|e| AppError::Instance(format!("Failed to resolve subfolder path: {}", e)))?;

        // Security check: ensure the resolved path is still within the instance directory
        if !target_canonical.starts_with(&base_canonical) {
            return Err(AppError::Instance("Invalid subfolder: path traversal detected".to_string()));
        }

        target_dir = target_canonical;
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
        // SSRF Protection: Validate URL before making request
        // Use non-strict mode to allow any public domain, but block private IPs and localhost
        let validated_url = crate::utils::url_validation::validate_url_for_ssrf(&icon_source, false)
            .map_err(|e| AppError::Security(format!("Invalid icon URL: {}", e)))?;

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
            .get(validated_url.as_str())
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

/// Calculate directory size recursively using walkdir for better performance
/// Uses spawn_blocking to avoid blocking the async runtime
async fn get_dir_size(path: &std::path::Path) -> u64 {
    let path = path.to_path_buf();

    // Use spawn_blocking with walkdir for efficient synchronous directory traversal
    tokio::task::spawn_blocking(move || {
        walkdir::WalkDir::new(&path)
            .into_iter()
            .filter_map(|entry| entry.ok())
            .filter_map(|entry| entry.metadata().ok())
            .filter(|metadata| metadata.is_file())
            .map(|metadata| metadata.len())
            .sum()
    })
    .await
    .unwrap_or(0)
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

// ============================================================================
// SERVER FROM CLIENT FEATURE
// ============================================================================

/// Information about a mod's server compatibility
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModServerCompatibility {
    /// Mod filename
    pub filename: String,
    /// Mod name (from metadata or filename)
    pub name: String,
    /// Whether this mod has Modrinth metadata
    pub has_metadata: bool,
    /// Modrinth project ID if available
    pub project_id: Option<String>,
    /// Server-side compatibility: "required", "optional", "unsupported", or "unknown"
    pub server_side: String,
    /// Client-side compatibility: "required", "optional", "unsupported", or "unknown"
    pub client_side: String,
    /// Whether this mod should be included in the server by default
    pub include_by_default: bool,
    /// Icon URL if available
    pub icon_url: Option<String>,
}

/// Result of analyzing mods for server creation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModAnalysisResult {
    /// Mods that can definitely be included (server_side is "required" or "optional")
    pub server_compatible: Vec<ModServerCompatibility>,
    /// Mods that are client-only (server_side is "unsupported")
    pub client_only: Vec<ModServerCompatibility>,
    /// Mods without metadata that need user decision
    pub unknown: Vec<ModServerCompatibility>,
    /// Total mod count
    pub total_mods: usize,
}

/// Analyze mods from a client instance to determine server compatibility
/// Reads compatibility info from local metadata files (no API calls)
#[tauri::command]
pub async fn analyze_mods_for_server(
    state: State<'_, SharedState>,
    instance_id: String,
) -> AppResult<ModAnalysisResult> {
    let state_guard = state.read().await;

    // Get the instance
    let instance = Instance::get_by_id(&state_guard.db, &instance_id)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Instance("Instance not found".to_string()))?;

    // Must be a client instance with mods
    if instance.is_server {
        return Err(AppError::Instance(
            "Cannot analyze server instance - this feature is for client instances".to_string(),
        ));
    }

    // Check if it's a modded instance
    let loader = instance.loader.as_deref();
    if !matches!(
        loader,
        Some("fabric") | Some("forge") | Some("neoforge") | Some("quilt")
    ) {
        return Err(AppError::Instance(
            "This feature only works with modded instances (Fabric, Forge, NeoForge, Quilt)"
                .to_string(),
        ));
    }

    let instance_dir = state_guard
        .data_dir
        .join("instances")
        .join(&instance.game_dir);
    let mods_dir = instance_dir.join("mods");

    if !mods_dir.exists() {
        return Ok(ModAnalysisResult {
            server_compatible: vec![],
            client_only: vec![],
            unknown: vec![],
            total_mods: 0,
        });
    }

    // Process all mods in a single blocking task for better I/O performance
    let start = std::time::Instant::now();
    let result = tokio::task::spawn_blocking(move || {
        let mut server_compatible = vec![];
        let mut client_only = vec![];
        let mut unknown = vec![];

        let entries = match std::fs::read_dir(&mods_dir) {
            Ok(e) => e,
            Err(_) => return (server_compatible, client_only, unknown),
        };

        for entry in entries.flatten() {
            let filename = entry.file_name().to_string_lossy().to_string();

            // Only process enabled mods (.jar files)
            if !filename.ends_with(".jar") {
                continue;
            }

            // Extract name from filename as fallback
            let fallback_name = filename
                .trim_end_matches(".jar")
                .split('-')
                .next()
                .unwrap_or(&filename)
                .replace('_', " ");

            // Try to read metadata file
            let meta_filename = format!("{}.meta.json", filename.trim_end_matches(".jar"));
            let meta_path = mods_dir.join(&meta_filename);

            if let Ok(content) = std::fs::read_to_string(&meta_path) {
                if let Ok(meta) = serde_json::from_str::<ModMetadata>(&content) {
                    // Check if metadata has server_side info
                    if let Some(ref server_side) = meta.server_side {
                        let compatibility = ModServerCompatibility {
                            filename,
                            name: meta.name.clone(),
                            has_metadata: true,
                            project_id: Some(meta.project_id.clone()),
                            server_side: server_side.clone(),
                            client_side: meta.client_side.clone().unwrap_or_else(|| "unknown".to_string()),
                            include_by_default: server_side != "unsupported",
                            icon_url: meta.icon_url.clone(),
                        };

                        if server_side == "unsupported" {
                            client_only.push(compatibility);
                        } else {
                            server_compatible.push(compatibility);
                        }
                        continue;
                    }

                    // Has metadata but no server_side info (old format)
                    unknown.push(ModServerCompatibility {
                        filename,
                        name: meta.name,
                        has_metadata: true,
                        project_id: Some(meta.project_id),
                        server_side: "unknown".to_string(),
                        client_side: "unknown".to_string(),
                        include_by_default: false,
                        icon_url: meta.icon_url,
                    });
                    continue;
                }
            }

            // No metadata file or failed to parse
            unknown.push(ModServerCompatibility {
                filename,
                name: fallback_name,
                has_metadata: false,
                project_id: None,
                server_side: "unknown".to_string(),
                client_side: "unknown".to_string(),
                include_by_default: false,
                icon_url: None,
            });
        }

        (server_compatible, client_only, unknown)
    })
    .await
    .map_err(|e| AppError::Instance(format!("Failed to analyze mods: {}", e)))?;

    let (server_compatible, client_only, unknown) = result;
    let total_mods = server_compatible.len() + client_only.len() + unknown.len();

    log::info!(
        "analyze_mods_for_server completed in {:?} - {} mods ({} compatible, {} client-only, {} unknown)",
        start.elapsed(),
        total_mods,
        server_compatible.len(),
        client_only.len(),
        unknown.len()
    );

    Ok(ModAnalysisResult {
        server_compatible,
        client_only,
        unknown,
        total_mods,
    })
}

/// Options for creating a server from a client instance
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateServerFromClientOptions {
    /// Source client instance ID
    pub source_instance_id: String,
    /// Name for the new server instance
    pub server_name: String,
    /// List of mod filenames to include (from server_compatible + selected unknown mods)
    pub mods_to_include: Vec<String>,
    /// Whether to copy config files
    pub copy_configs: bool,
    /// Server port (default 25565)
    #[serde(default = "default_server_port")]
    pub server_port: i64,
}

fn default_server_port() -> i64 {
    25565
}

/// Create a server instance from a client instance
/// This copies compatible mods and optionally configs
#[tauri::command]
pub async fn create_server_from_client(
    state: State<'_, SharedState>,
    options: CreateServerFromClientOptions,
) -> AppResult<Instance> {
    let state_guard = state.read().await;

    // Get the source instance
    let source_instance = Instance::get_by_id(&state_guard.db, &options.source_instance_id)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Instance("Source instance not found".to_string()))?;

    // Validate source is a client
    if source_instance.is_server {
        return Err(AppError::Instance(
            "Source must be a client instance".to_string(),
        ));
    }

    // Validate loader is supported for server
    let loader = source_instance
        .loader
        .as_deref()
        .ok_or_else(|| AppError::Instance("Source instance has no mod loader".to_string()))?;

    if !matches!(loader, "fabric" | "forge" | "neoforge" | "quilt") {
        return Err(AppError::Instance(format!(
            "Loader '{}' does not support server mode",
            loader
        )));
    }

    // Check if server name is unique
    let existing = Instance::get_all(&state_guard.db)
        .await
        .map_err(AppError::from)?;
    if existing.iter().any(|i| i.name == options.server_name) {
        return Err(AppError::Instance(
            "An instance with this name already exists".to_string(),
        ));
    }

    // Create database entry FIRST to get the correct game_dir
    let create_data = CreateInstance {
        name: options.server_name.clone(),
        mc_version: source_instance.mc_version.clone(),
        loader: Some(loader.to_string()),
        loader_version: source_instance.loader_version.clone(),
        is_server: true,
        is_proxy: false,
        server_port: options.server_port,
        modrinth_project_id: None,
    };

    let instance = Instance::create(&state_guard.db, create_data)
        .await
        .map_err(AppError::from)?;

    // Now use the instance's game_dir to create the actual directory
    let instances_dir = state_guard.data_dir.join("instances");
    let server_dir = instances_dir.join(&instance.game_dir);
    let source_dir = instances_dir.join(&source_instance.game_dir);

    // Create server directory structure
    fs::create_dir_all(&server_dir)
        .await
        .map_err(|e| AppError::Io(format!("Failed to create server directory: {}", e)))?;

    for folder in ["mods", "config", "logs", "world"] {
        fs::create_dir_all(server_dir.join(folder))
            .await
            .map_err(|e| AppError::Io(format!("Failed to create {} directory: {}", folder, e)))?;
    }

    // Copy selected mods
    let source_mods_dir = source_dir.join("mods");
    let server_mods_dir = server_dir.join("mods");

    let mut copied_mods = 0;
    for mod_filename in &options.mods_to_include {
        let source_mod = source_mods_dir.join(mod_filename);
        let dest_mod = server_mods_dir.join(mod_filename);

        if source_mod.exists() {
            fs::copy(&source_mod, &dest_mod)
                .await
                .map_err(|e| AppError::Io(format!("Failed to copy mod {}: {}", mod_filename, e)))?;
            copied_mods += 1;

            // Also copy metadata file if exists
            let meta_filename = format!("{}.meta.json", mod_filename.trim_end_matches(".jar"));
            let source_meta = source_mods_dir.join(&meta_filename);
            if source_meta.exists() {
                let dest_meta = server_mods_dir.join(&meta_filename);
                if let Err(e) = fs::copy(&source_meta, &dest_meta).await {
                    log::warn!("Failed to copy mod metadata {}: {}", meta_filename, e);
                }
            }
        } else {
            log::warn!("Source mod not found: {}", mod_filename);
        }
    }

    // Copy config files if requested
    if options.copy_configs {
        let source_config_dir = source_dir.join("config");
        let server_config_dir = server_dir.join("config");

        if source_config_dir.exists() {
            copy_dir_recursive(&source_config_dir, &server_config_dir).await?;
        }
    }

    log::info!(
        "Created server instance '{}' (port {}) from client '{}' - copied {}/{} mods to {}",
        instance.name,
        options.server_port,
        source_instance.name,
        copied_mods,
        options.mods_to_include.len(),
        server_dir.display()
    );

    Ok(instance)
}

/// Helper function to recursively copy a directory
async fn copy_dir_recursive(src: &Path, dst: &Path) -> AppResult<()> {
    if !dst.exists() {
        fs::create_dir_all(dst)
            .await
            .map_err(|e| AppError::Io(format!("Failed to create directory {:?}: {}", dst, e)))?;
    }

    let mut entries = fs::read_dir(src)
        .await
        .map_err(|e| AppError::Io(format!("Failed to read directory {:?}: {}", src, e)))?;

    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| AppError::Io(format!("Failed to read entry: {}", e)))?
    {
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        let file_type = entry
            .file_type()
            .await
            .map_err(|e| AppError::Io(format!("Failed to get file type: {}", e)))?;

        if file_type.is_dir() {
            Box::pin(copy_dir_recursive(&src_path, &dst_path)).await?;
        } else {
            fs::copy(&src_path, &dst_path)
                .await
                .map_err(|e| AppError::Io(format!("Failed to copy {:?}: {}", src_path, e)))?;
        }
    }

    Ok(())
}

// ============================================================================
// DEPENDENCY CHECKING FOR SERVER CREATION
// ============================================================================

/// Information about a missing dependency
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MissingDependency {
    /// The mod that requires this dependency
    pub required_by_filename: String,
    /// Name of the mod requiring this dependency
    pub required_by_name: String,
    /// Project ID of the missing dependency
    pub dependency_project_id: String,
    /// Whether this is a required or optional dependency
    pub dependency_type: String,
    /// Name of the excluded mod (if found)
    pub excluded_mod_name: Option<String>,
    /// Filename of the excluded mod (if found)
    pub excluded_mod_filename: Option<String>,
    /// Why this dependency is missing
    pub reason: String, // "client_only", "excluded", "not_installed"
}

/// Result of checking dependencies for server creation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DependencyCheckResult {
    /// Missing dependencies that will cause issues
    pub missing_required: Vec<MissingDependency>,
    /// Optional dependencies that are missing (warning only)
    pub missing_optional: Vec<MissingDependency>,
    /// Whether it's safe to proceed
    pub can_proceed: bool,
}

/// Check if the selected mods have dependencies on excluded mods
/// Returns information about missing dependencies
#[tauri::command]
pub async fn check_server_dependencies(
    state: State<'_, SharedState>,
    instance_id: String,
    mods_to_include: Vec<String>,
    mods_to_exclude: Vec<String>,
) -> AppResult<DependencyCheckResult> {
    let state_guard = state.read().await;

    // Get the instance
    let instance = Instance::get_by_id(&state_guard.db, &instance_id)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Instance("Instance not found".to_string()))?;

    let instance_dir = state_guard
        .data_dir
        .join("instances")
        .join(&instance.game_dir);
    let mods_dir = instance_dir.join("mods");

    if !mods_dir.exists() {
        return Ok(DependencyCheckResult {
            missing_required: vec![],
            missing_optional: vec![],
            can_proceed: true,
        });
    }

    // Build maps of project_id -> filename and project_id -> metadata for all mods
    let result = tokio::task::spawn_blocking(move || {
        let mut project_to_filename: HashMap<String, String> = HashMap::new();
        let mut project_to_metadata: HashMap<String, (String, ModMetadata)> = HashMap::new();
        let mut included_project_ids: std::collections::HashSet<String> =
            std::collections::HashSet::new();
        let mut excluded_project_ids: std::collections::HashSet<String> =
            std::collections::HashSet::new();

        // Read all mod metadata files
        let entries = match std::fs::read_dir(&mods_dir) {
            Ok(e) => e,
            Err(_) => {
                return (
                    project_to_filename,
                    project_to_metadata,
                    included_project_ids,
                    excluded_project_ids,
                )
            }
        };

        for entry in entries.flatten() {
            let filename = entry.file_name().to_string_lossy().to_string();

            if !filename.ends_with(".jar") {
                continue;
            }

            // Try to read metadata
            let base_filename = filename.trim_end_matches(".jar");
            let meta_path = mods_dir.join(format!("{}.meta.json", base_filename));

            if let Ok(content) = std::fs::read_to_string(&meta_path) {
                if let Ok(meta) = serde_json::from_str::<ModMetadata>(&content) {
                    project_to_filename.insert(meta.project_id.clone(), filename.clone());
                    project_to_metadata
                        .insert(meta.project_id.clone(), (filename.clone(), meta.clone()));

                    // Track which project IDs are included vs excluded
                    if mods_to_include.contains(&filename) {
                        included_project_ids.insert(meta.project_id.clone());
                    }
                    if mods_to_exclude.contains(&filename) {
                        excluded_project_ids.insert(meta.project_id);
                    }
                }
            }
        }

        (
            project_to_filename,
            project_to_metadata,
            included_project_ids,
            excluded_project_ids,
        )
    })
    .await
    .map_err(|e| AppError::Instance(format!("Failed to read mods: {}", e)))?;

    let (project_to_filename, project_to_metadata, included_project_ids, excluded_project_ids) =
        result;

    let mut missing_required = Vec::new();
    let mut missing_optional = Vec::new();

    // Check each included mod's dependencies
    for (project_id, (filename, metadata)) in &project_to_metadata {
        if !included_project_ids.contains(project_id) {
            continue;
        }

        for dep in &metadata.dependencies {
            // Check if this dependency is in the included set
            if included_project_ids.contains(&dep.project_id) {
                continue; // Dependency is included, all good
            }

            // Dependency is missing from included set - figure out why
            let reason = if excluded_project_ids.contains(&dep.project_id) {
                "excluded"
            } else if project_to_filename.contains_key(&dep.project_id) {
                // It exists but wasn't included (probably client_only)
                "client_only"
            } else {
                "not_installed"
            };

            let excluded_info = project_to_metadata.get(&dep.project_id);

            let missing_dep = MissingDependency {
                required_by_filename: filename.clone(),
                required_by_name: metadata.name.clone(),
                dependency_project_id: dep.project_id.clone(),
                dependency_type: dep.dependency_type.clone(),
                excluded_mod_name: excluded_info.map(|(_, m)| m.name.clone()),
                excluded_mod_filename: excluded_info.map(|(f, _)| f.clone()),
                reason: reason.to_string(),
            };

            if dep.dependency_type == "required" {
                missing_required.push(missing_dep);
            } else {
                missing_optional.push(missing_dep);
            }
        }
    }

    let can_proceed = missing_required.is_empty();

    log::info!(
        "check_server_dependencies: {} required missing, {} optional missing, can_proceed={}",
        missing_required.len(),
        missing_optional.len(),
        can_proceed
    );

    Ok(DependencyCheckResult {
        missing_required,
        missing_optional,
        can_proceed,
    })
}

/// Analyze instance logs and detect issues (missing dependencies, version mismatches, etc.)
#[tauri::command]
pub async fn analyze_instance_logs(
    state: State<'_, SharedState>,
    instance_id: String,
) -> AppResult<Vec<crate::instance::log_parser::DetectedIssue>> {
    use crate::instance::log_parser::{parse_log_for_issues, DetectedIssue};

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

    // Read latest.log first, then try crash reports
    let latest_log_path = logs_dir.join("latest.log");
    let mut all_issues: Vec<DetectedIssue> = Vec::new();

    // Get loader type for better parsing
    let loader_type = instance.loader.as_deref().unwrap_or("unknown");

    // Parse latest.log if it exists
    if latest_log_path.exists() {
        let content = fs::read_to_string(&latest_log_path)
            .await
            .unwrap_or_default();
        if !content.is_empty() {
            let issues = parse_log_for_issues(&content, loader_type);
            all_issues.extend(issues);
        }
    }

    // Also check crash reports directory
    let crash_reports_dir = state_guard
        .data_dir
        .join("instances")
        .join(&instance.game_dir)
        .join("crash-reports");

    if crash_reports_dir.exists() {
        // Get the most recent crash report
        let mut entries = fs::read_dir(&crash_reports_dir)
            .await
            .map_err(|e| AppError::Io(format!("Failed to read crash-reports directory: {}", e)))?;

        let mut crash_files: Vec<(std::path::PathBuf, std::time::SystemTime)> = Vec::new();

        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|e| AppError::Io(format!("Failed to read directory entry: {}", e)))?
        {
            let path = entry.path();
            if path.extension().map_or(false, |ext| ext == "txt") {
                if let Ok(metadata) = entry.metadata().await {
                    if let Ok(modified) = metadata.modified() {
                        crash_files.push((path, modified));
                    }
                }
            }
        }

        // Sort by modification time (most recent first) and take the latest
        crash_files.sort_by(|a, b| b.1.cmp(&a.1));

        if let Some((latest_crash, _)) = crash_files.first() {
            let content = fs::read_to_string(latest_crash)
                .await
                .unwrap_or_default();
            if !content.is_empty() {
                let issues = parse_log_for_issues(&content, loader_type);
                all_issues.extend(issues);
            }
        }
    }

    // Deduplicate issues
    all_issues.sort_by(|a, b| a.description.cmp(&b.description));
    all_issues.dedup_by(|a, b| {
        a.issue_type == b.issue_type
            && a.mod_id == b.mod_id
            && a.required_mod_id == b.required_mod_id
    });

    log::info!(
        "analyze_instance_logs: Found {} issues for instance {}",
        all_issues.len(),
        instance_id
    );

    Ok(all_issues)
}

// ============= Version Change Feature =============

use tauri::Emitter;

/// Request to change an instance's Minecraft version
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChangeVersionRequest {
    pub instance_id: String,
    pub new_mc_version: String,
    pub new_loader: Option<String>,
    pub new_loader_version: Option<String>,
    /// List of (project_id, new_version_id) tuples for mods to update
    pub mods_to_update: Vec<(String, String)>,
}

/// Progress event for version change
#[derive(Debug, Clone, Serialize)]
pub struct VersionChangeProgress {
    pub stage: String,
    pub current: u32,
    pub total: u32,
    pub message: String,
    pub instance_id: String,
}

/// Change the Minecraft version of an instance
#[tauri::command]
pub async fn change_instance_version(
    state: State<'_, SharedState>,
    app: AppHandle,
    request: ChangeVersionRequest,
) -> AppResult<()> {
    let state_guard = state.read().await;

    // Get the instance
    let instance = Instance::get_by_id(&state_guard.db, &request.instance_id)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Instance("Instance not found".to_string()))?;

    // Check if instance is running
    {
        let running = state_guard.running_instances.read().await;
        if running.contains_key(&request.instance_id) {
            return Err(AppError::Instance(
                "Cannot change version while instance is running".to_string(),
            ));
        }
    }

    let instance_dir = state_guard
        .data_dir
        .join("instances")
        .join(&instance.game_dir);

    let total_steps = 3 + request.mods_to_update.len() as u32;
    let mut current_step = 0u32;

    // Helper to emit progress
    let emit_progress = |stage: &str, current: u32, total: u32, message: &str| {
        let _ = app.emit(
            "version-change-progress",
            VersionChangeProgress {
                stage: stage.to_string(),
                current,
                total,
                message: message.to_string(),
                instance_id: request.instance_id.clone(),
            },
        );
    };

    // Step 1: Clean old installation files
    emit_progress(
        "cleaning_files",
        current_step,
        total_steps,
        "Removing old installation files...",
    );

    // Directories to remove (installation files, not user data)
    let dirs_to_remove = if instance.is_server || instance.is_proxy {
        // For servers, remove server.jar and run scripts
        vec!["libraries", "versions"]
    } else {
        // For clients, remove client files
        vec!["client", "libraries", "assets", "natives", "versions"]
    };

    for dir_name in dirs_to_remove {
        let dir_path = instance_dir.join(dir_name);
        if dir_path.exists() {
            if let Err(e) = fs::remove_dir_all(&dir_path).await {
                log::warn!("Failed to remove {}: {}", dir_name, e);
            }
        }
    }

    // Remove .installed marker
    let installed_marker = instance_dir.join(".installed");
    if installed_marker.exists() {
        let _ = fs::remove_file(&installed_marker).await;
    }

    // For servers, remove server.jar
    if instance.is_server || instance.is_proxy {
        let server_jar = instance_dir.join("server.jar");
        if server_jar.exists() {
            let _ = fs::remove_file(&server_jar).await;
        }
        // Also remove run scripts
        for script in ["run.bat", "run.sh", "start.bat", "start.sh"] {
            let script_path = instance_dir.join(script);
            if script_path.exists() {
                let _ = fs::remove_file(&script_path).await;
            }
        }
    }

    // Remove NeoForge/Forge metadata if present
    let neoforge_meta = instance_dir.join("neoforge_meta.json");
    if neoforge_meta.exists() {
        let _ = fs::remove_file(&neoforge_meta).await;
    }

    current_step += 1;

    // Step 2: Update mods
    if !request.mods_to_update.is_empty() {
        emit_progress(
            "updating_mods",
            current_step,
            total_steps,
            "Updating mods...",
        );

        let folder_name = get_content_folder(instance.loader.as_deref(), instance.is_server);
        let content_dir = instance_dir.join(folder_name);

        // Create Modrinth client
        let client = crate::modrinth::ModrinthClient::new(&state_guard.http_client);

        for (i, (project_id, new_version_id)) in request.mods_to_update.iter().enumerate() {
            emit_progress(
                "updating_mods",
                current_step + i as u32,
                total_steps,
                &format!("Updating mod {} of {}...", i + 1, request.mods_to_update.len()),
            );

            // Get the project info
            let project = match client.get_project(project_id).await {
                Ok(p) => p,
                Err(e) => {
                    log::warn!("Failed to get project {}: {}", project_id, e);
                    continue;
                }
            };

            // Get the version info
            let version = match client.get_version(new_version_id).await {
                Ok(v) => v,
                Err(e) => {
                    log::warn!("Failed to get version {}: {}", new_version_id, e);
                    continue;
                }
            };

            // Find the primary file
            let file = match version.files.iter().find(|f| f.primary).or(version.files.first()) {
                Some(f) => f,
                None => {
                    log::warn!("No files found for version {}", new_version_id);
                    continue;
                }
            };

            // Find and remove old mod file
            let mut entries = match fs::read_dir(&content_dir).await {
                Ok(e) => e,
                Err(_) => continue,
            };

            while let Ok(Some(entry)) = entries.next_entry().await {
                let filename = entry.file_name().to_string_lossy().to_string();
                if filename.ends_with(".meta.json") {
                    let meta_path = entry.path();
                    if let Ok(content) = fs::read_to_string(&meta_path).await {
                        if let Ok(meta) = serde_json::from_str::<ModMetadata>(&content) {
                            if meta.project_id == *project_id {
                                // Found the old mod, remove it
                                let base_name = filename.trim_end_matches(".meta.json");
                                let jar_path = content_dir.join(format!("{}.jar", base_name));
                                let disabled_path =
                                    content_dir.join(format!("{}.jar.disabled", base_name));

                                if jar_path.exists() {
                                    let _ = fs::remove_file(&jar_path).await;
                                }
                                if disabled_path.exists() {
                                    let _ = fs::remove_file(&disabled_path).await;
                                }
                                let _ = fs::remove_file(&meta_path).await;
                                break;
                            }
                        }
                    }
                }
            }

            // Download new mod file
            let new_path = content_dir.join(&file.filename);
            if let Err(e) = client.download_file(file, &new_path).await {
                log::warn!("Failed to download mod {}: {}", project_id, e);
                continue;
            }

            // Save new metadata
            let new_base = file.filename.trim_end_matches(".jar").trim_end_matches(".zip");
            let new_meta_path = content_dir.join(format!("{}.meta.json", new_base));

            let dependencies: Vec<StoredDependency> = version
                .dependencies
                .iter()
                .filter(|d| d.dependency_type == "required" || d.dependency_type == "optional")
                .filter_map(|d| {
                    d.project_id.as_ref().map(|pid| StoredDependency {
                        project_id: pid.clone(),
                        dependency_type: d.dependency_type.clone(),
                    })
                })
                .collect();

            let metadata = ModMetadata {
                name: project.title.clone(),
                version: version.version_number.clone(),
                project_id: project_id.clone(),
                version_id: Some(new_version_id.clone()),
                icon_url: project.icon_url.clone(),
                server_side: Some(project.server_side.clone()),
                client_side: Some(project.client_side.clone()),
                dependencies,
            };

            if let Ok(meta_json) = serde_json::to_string_pretty(&metadata) {
                let _ = fs::write(&new_meta_path, meta_json).await;
            }

            log::info!(
                "Updated mod {} to version {}",
                project.title,
                version.version_number
            );
        }

        current_step += request.mods_to_update.len() as u32;
    }

    // Step 3: Update database
    emit_progress(
        "updating_db",
        current_step,
        total_steps,
        "Updating instance configuration...",
    );

    Instance::update_version(
        &state_guard.db,
        &request.instance_id,
        &request.new_mc_version,
        request.new_loader.as_deref(),
        request.new_loader_version.as_deref(),
    )
    .await
    .map_err(AppError::from)?;

    current_step += 1;

    // Step 4: Complete
    emit_progress("complete", current_step, total_steps, "Version change complete!");

    log::info!(
        "Changed instance {} version from {} to {} (loader: {:?} -> {:?})",
        instance.name,
        instance.mc_version,
        request.new_mc_version,
        instance.loader,
        request.new_loader
    );

    Ok(())
}

// ============================================================================
// Instance Backup Commands (complete instance backups)
// ============================================================================

/// Create a complete backup of an instance
#[tauri::command]
pub async fn create_instance_backup(
    state: State<'_, SharedState>,
    app: AppHandle,
    instance_id: String,
) -> AppResult<InstanceBackupInfo> {
    let state_guard = state.read().await;

    let instance = Instance::get_by_id(&state_guard.db, &instance_id)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Instance("Instance not found".to_string()))?;

    let instances_dir = state_guard.get_instances_dir().await;

    instance_backup::create_instance_backup(&instances_dir, &state_guard.data_dir, &instance, Some(&app))
        .await
}

/// Get backups for a specific instance
#[tauri::command]
pub async fn get_instance_backups(
    state: State<'_, SharedState>,
    instance_id: String,
) -> AppResult<Vec<InstanceBackupInfo>> {
    let state_guard = state.read().await;

    let instance = Instance::get_by_id(&state_guard.db, &instance_id)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Instance("Instance not found".to_string()))?;

    instance_backup::list_instance_backups(
        &state_guard.data_dir,
        &instance_id,
        &instance.name,
        &instance.mc_version,
        instance.loader.as_deref(),
        instance.is_server || instance.is_proxy,
    )
    .await
}

/// Get all instance backups across all instances
#[tauri::command]
pub async fn get_all_instance_backups(
    state: State<'_, SharedState>,
) -> AppResult<Vec<GlobalInstanceBackupInfo>> {
    let state_guard = state.read().await;

    let instances = Instance::get_all(&state_guard.db)
        .await
        .map_err(AppError::from)?;

    let instance_info: Vec<(String, String, String, Option<String>, bool)> = instances
        .iter()
        .map(|i| {
            (
                i.id.clone(),
                i.name.clone(),
                i.mc_version.clone(),
                i.loader.clone(),
                i.is_server || i.is_proxy,
            )
        })
        .collect();

    instance_backup::list_all_instance_backups(&state_guard.data_dir, &instance_info).await
}

/// Delete an instance backup
#[tauri::command]
pub async fn delete_instance_backup(
    state: State<'_, SharedState>,
    instance_id: String,
    backup_filename: String,
) -> AppResult<()> {
    let state_guard = state.read().await;
    instance_backup::delete_instance_backup(&state_guard.data_dir, &instance_id, &backup_filename).await
}

/// Get instance backup statistics
#[tauri::command]
pub async fn get_instance_backup_stats(
    state: State<'_, SharedState>,
) -> AppResult<InstanceBackupStats> {
    let state_guard = state.read().await;
    instance_backup::get_instance_backup_stats(&state_guard.data_dir).await
}

/// Get the manifest from an instance backup
#[tauri::command]
pub async fn get_instance_backup_manifest(
    state: State<'_, SharedState>,
    instance_id: String,
    backup_filename: String,
) -> AppResult<InstanceBackupManifest> {
    let state_guard = state.read().await;
    let backup_path =
        instance_backup::get_instance_backup_dir(&state_guard.data_dir, &instance_id).join(&backup_filename);

    tokio::task::spawn_blocking(move || instance_backup::read_backup_manifest(&backup_path))
        .await
        .map_err(|e| AppError::Io(format!("Failed to read manifest: {}", e)))?
}

/// Restore an instance backup
#[tauri::command]
pub async fn restore_instance_backup(
    state: State<'_, SharedState>,
    app: AppHandle,
    instance_id: String,
    backup_filename: String,
    restore_mode: String,
    new_name: Option<String>,
) -> AppResult<Option<Instance>> {
    let state_guard = state.read().await;
    let instances_dir = state_guard.get_instances_dir().await;

    match restore_mode.as_str() {
        "replace" => {
            let instance = Instance::get_by_id(&state_guard.db, &instance_id)
                .await
                .map_err(AppError::from)?
                .ok_or_else(|| AppError::Instance("Instance not found".to_string()))?;

            instance_backup::restore_instance_backup_replace(
                &instances_dir,
                &state_guard.data_dir,
                &instance,
                &backup_filename,
                Some(&app),
            )
            .await?;

            Ok(None)
        }
        "create_new" => {
            let new_instance = instance_backup::restore_instance_backup_new(
                &state_guard.db,
                &instances_dir,
                &state_guard.data_dir,
                &instance_id,
                &backup_filename,
                new_name,
                Some(&app),
            )
            .await?;

            Ok(Some(new_instance))
        }
        _ => Err(AppError::Instance(format!(
            "Invalid restore mode: {}. Use 'replace' or 'create_new'",
            restore_mode
        ))),
    }
}
