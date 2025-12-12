use crate::db::instances::Instance;
use crate::error::{AppError, AppResult};
use crate::state::SharedState;
use serde::{Deserialize, Serialize};
use tauri::State;
use tracing::debug;

use super::{build_facets, ModrinthClient, SearchHit, SearchQuery, Version, VersionFile};

/// Determine the content folder name based on project type and loader
fn get_content_folder(
    project_type: Option<&str>,
    loader: Option<&str>,
    is_server: bool,
) -> &'static str {
    match project_type {
        // Resource packs go to resourcepacks/ folder
        Some("resourcepack") => "resourcepacks",
        // Shaders go to shaderpacks/ folder
        Some("shader") => "shaderpacks",
        // Datapacks are handled specially - they go to world folder
        // This returns a placeholder; actual path is computed separately
        Some("datapack") => "datapacks",
        // Mods/plugins based on loader type
        Some("mod") | Some("plugin") | None => {
            match loader.map(|l| l.to_lowercase()).as_deref() {
                // Mod loaders - use "mods" folder
                Some("fabric") | Some("forge") | Some("neoforge") | Some("quilt") => "mods",
                // Plugin servers - use "plugins" folder
                Some("paper") | Some("velocity") | Some("bungeecord") | Some("waterfall")
                | Some("purpur") | Some("spigot") | Some("bukkit") => "plugins",
                // Vanilla server - no mods/plugins
                None if is_server => "plugins",
                // Vanilla client or unknown
                _ => "mods",
            }
        }
        // Unknown project type - default to mods
        _ => "mods",
    }
}

/// Simplified mod info returned to frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModSearchResult {
    pub project_id: String,
    pub slug: String,
    pub title: String,
    pub description: String,
    pub author: String,
    pub downloads: u64,
    pub icon_url: Option<String>,
    pub categories: Vec<String>,
    pub game_versions: Vec<String>,
    pub loaders: Vec<String>,
}

impl From<SearchHit> for ModSearchResult {
    fn from(hit: SearchHit) -> Self {
        Self {
            project_id: hit.project_id,
            slug: hit.slug,
            title: hit.title,
            description: hit.description,
            author: hit.author,
            downloads: hit.downloads,
            icon_url: hit.icon_url,
            categories: hit.categories,
            game_versions: hit.versions,
            loaders: vec![],
        }
    }
}

/// Simplified version info returned to frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModVersionInfo {
    pub id: String,
    pub name: String,
    pub version_number: String,
    pub game_versions: Vec<String>,
    pub loaders: Vec<String>,
    pub version_type: String,
    pub downloads: u64,
    pub date_published: String,
    pub files: Vec<ModFileInfo>,
    pub dependencies: Vec<ModDependency>,
}

impl From<Version> for ModVersionInfo {
    fn from(v: Version) -> Self {
        Self {
            id: v.id,
            name: v.name,
            version_number: v.version_number,
            game_versions: v.game_versions,
            loaders: v.loaders,
            version_type: v.version_type,
            downloads: v.downloads,
            date_published: v.date_published,
            files: v.files.into_iter().map(ModFileInfo::from).collect(),
            dependencies: v
                .dependencies
                .into_iter()
                .map(ModDependency::from)
                .collect(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModFileInfo {
    pub url: String,
    pub filename: String,
    pub primary: bool,
    pub size: u64,
    pub sha1: String,
}

impl From<VersionFile> for ModFileInfo {
    fn from(f: VersionFile) -> Self {
        Self {
            url: f.url,
            filename: f.filename,
            primary: f.primary,
            size: f.size,
            sha1: f.hashes.sha1,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModDependency {
    pub project_id: Option<String>,
    pub version_id: Option<String>,
    pub dependency_type: String,
}

impl From<super::Dependency> for ModDependency {
    fn from(d: super::Dependency) -> Self {
        Self {
            project_id: d.project_id,
            version_id: d.version_id,
            dependency_type: d.dependency_type,
        }
    }
}

/// Search response with pagination info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModSearchResponse {
    pub results: Vec<ModSearchResult>,
    pub total_hits: u32,
    pub offset: u32,
    pub limit: u32,
}

/// Search for mods on Modrinth
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn search_modrinth_mods(
    state: State<'_, SharedState>,
    query: String,
    game_version: Option<String>,
    loader: Option<String>,
    project_type: Option<String>,
    categories: Option<Vec<String>>,
    sort_by: Option<String>,
    offset: Option<u32>,
    limit: Option<u32>,
) -> AppResult<ModSearchResponse> {
    let state = state.read().await;
    let client = ModrinthClient::new(&state.http_client);

    // Build facets for filtering
    let game_versions = game_version.as_ref().map(|v| vec![v.as_str()]);

    // Convert categories to &str slice
    let categories_strs: Option<Vec<&str>> = categories
        .as_ref()
        .map(|cats| cats.iter().map(|s| s.as_str()).collect());

    // Default to "mod" if not specified, but allow "plugin" for servers
    let ptype = project_type.as_deref().unwrap_or("mod");

    // Only include loaders for mods and plugins - shaders, resourcepacks, datapacks don't use loaders
    let loaders = match ptype {
        "mod" | "plugin" => loader.as_ref().map(|l| vec![l.as_str()]),
        _ => None, // resourcepack, shader, datapack don't need loader filter
    };

    let facets = build_facets(
        Some(ptype),
        categories_strs.as_deref(),
        game_versions.as_deref(),
        loaders.as_deref(),
    );

    // Sort index: relevance, downloads, follows, newest, updated
    let sort_index = sort_by.as_deref().unwrap_or("relevance");

    let mut search_query = SearchQuery::new(&query)
        .with_facets(&facets)
        .with_index(sort_index);

    if let Some(off) = offset {
        search_query = search_query.with_offset(off);
    }
    if let Some(lim) = limit {
        search_query = search_query.with_limit(lim);
    }

    let response = client
        .search(&search_query)
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;

    Ok(ModSearchResponse {
        results: response
            .hits
            .into_iter()
            .map(ModSearchResult::from)
            .collect(),
        total_hits: response.total_hits,
        offset: response.offset,
        limit: response.limit,
    })
}

/// Get versions of a mod for a specific game version and loader
#[tauri::command]
pub async fn get_modrinth_mod_versions(
    state: State<'_, SharedState>,
    project_id: String,
    game_version: Option<String>,
    loader: Option<String>,
    project_type: Option<String>,
) -> AppResult<Vec<ModVersionInfo>> {
    let state = state.read().await;
    let client = ModrinthClient::new(&state.http_client);

    let game_versions = game_version.as_ref().map(|v| vec![v.as_str()]);

    // Only include loaders for mods and plugins - shaders, resourcepacks, datapacks don't use loaders
    let ptype = project_type.as_deref().unwrap_or("mod");
    let normalized_loader = loader.map(|l| l.to_lowercase());
    let loaders = match ptype {
        "mod" | "plugin" => normalized_loader.as_ref().map(|l| vec![l.as_str()]),
        _ => None, // resourcepack, shader, datapack don't need loader filter
    };

    let versions = client
        .get_project_versions(&project_id, loaders.as_deref(), game_versions.as_deref())
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;

    Ok(versions.into_iter().map(ModVersionInfo::from).collect())
}

/// Metadata saved for mods installed from Modrinth
#[derive(Debug, Clone, Serialize, Deserialize)]
struct ModMetadata {
    name: String,
    version: String,
    project_id: String,
    version_id: Option<String>,
    icon_url: Option<String>,
}

/// Helper function to find the first world folder in saves/
async fn find_world_folder(instance_dir: &std::path::Path) -> Option<String> {
    let saves_dir = instance_dir.join("saves");
    if !saves_dir.exists() {
        return None;
    }

    let mut entries = match tokio::fs::read_dir(&saves_dir).await {
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

/// Install a mod from Modrinth to an instance
#[tauri::command]
pub async fn install_modrinth_mod(
    state: State<'_, SharedState>,
    instance_id: String,
    project_id: String,
    version_id: String,
    project_type: Option<String>,
) -> AppResult<String> {
    let state_guard = state.read().await;
    let client = ModrinthClient::new(&state_guard.http_client);

    // Get the instance
    let instance = Instance::get_by_id(&state_guard.db, &instance_id)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Instance("Instance not found".to_string()))?;

    // Get the project info (for icon_url and title)
    let project = client
        .get_project(&project_id)
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;

    // Get the version info
    let version = client
        .get_version(&version_id)
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;

    // Find the primary file
    let file = version
        .files
        .iter()
        .find(|f| f.primary)
        .or_else(|| version.files.first())
        .ok_or_else(|| AppError::Instance("No files found for this version".to_string()))?;

    // Determine destination folder based on project type and loader
    let ptype = project_type.as_deref();
    let folder_name = get_content_folder(ptype, instance.loader.as_deref(), instance.is_server);

    let instance_dir = state_guard
        .data_dir
        .join("instances")
        .join(&instance.game_dir);

    // Handle datapacks specially - they go into saves/<world>/datapacks/
    let target_dir = if ptype == Some("datapack") {
        // Find existing world folder or use default "world"
        let world_name = find_world_folder(&instance_dir)
            .await
            .unwrap_or_else(|| "world".to_string());
        instance_dir
            .join("saves")
            .join(&world_name)
            .join("datapacks")
    } else {
        instance_dir.join(folder_name)
    };

    // Create directory if it doesn't exist
    tokio::fs::create_dir_all(&target_dir)
        .await
        .map_err(|e| AppError::Io(format!("Failed to create {} directory: {}", folder_name, e)))?;

    let dest_path = target_dir.join(&file.filename);

    // Check if file already exists
    if dest_path.exists() {
        return Err(AppError::Instance(format!(
            "File {} already exists",
            file.filename
        )));
    }

    // Download the file
    client
        .download_file(file, &dest_path)
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;

    // Save metadata file with icon_url
    // Strip appropriate extension based on file type
    let base_filename = file
        .filename
        .trim_end_matches(".jar")
        .trim_end_matches(".zip");
    let meta_filename = format!("{}.meta.json", base_filename);
    let meta_path = target_dir.join(&meta_filename);
    let metadata = ModMetadata {
        name: project.title,
        version: version.version_number.clone(),
        project_id: project_id.clone(),
        version_id: Some(version_id.clone()),
        icon_url: project.icon_url,
    };

    if let Ok(meta_json) = serde_json::to_string_pretty(&metadata) {
        let _ = tokio::fs::write(&meta_path, meta_json).await;
    }

    let content_type_name = match ptype {
        Some("resourcepack") => "resource pack",
        Some("shader") => "shader",
        Some("datapack") => "datapack",
        Some("plugin") => "plugin",
        _ => {
            if folder_name == "plugins" {
                "plugin"
            } else {
                "mod"
            }
        }
    };

    log::info!(
        "Installed {} {} (version {}) to instance {} (folder: {})",
        content_type_name,
        project_id,
        version_id,
        instance_id,
        target_dir.display()
    );

    Ok(file.filename.clone())
}

/// Get list of installed content project IDs for an instance
#[tauri::command]
pub async fn get_installed_mod_ids(
    state: State<'_, SharedState>,
    instance_id: String,
    project_type: Option<String>,
) -> AppResult<Vec<String>> {
    let state_guard = state.read().await;

    let instance = Instance::get_by_id(&state_guard.db, &instance_id)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Instance("Instance not found".to_string()))?;

    let ptype = project_type.as_deref();
    let folder_name = get_content_folder(ptype, instance.loader.as_deref(), instance.is_server);

    let instance_dir = state_guard
        .data_dir
        .join("instances")
        .join(&instance.game_dir);

    // Handle datapacks specially
    let content_dir = if ptype == Some("datapack") {
        let world_name = find_world_folder(&instance_dir)
            .await
            .unwrap_or_else(|| "world".to_string());
        instance_dir
            .join("saves")
            .join(&world_name)
            .join("datapacks")
    } else {
        instance_dir.join(folder_name)
    };

    if !content_dir.exists() {
        return Ok(vec![]);
    }

    let mut project_ids = Vec::new();
    let mut entries = tokio::fs::read_dir(&content_dir)
        .await
        .map_err(|e| AppError::Io(format!("Failed to read {} directory: {}", folder_name, e)))?;

    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| AppError::Io(format!("Failed to read directory entry: {}", e)))?
    {
        let filename = entry.file_name().to_string_lossy().to_string();

        // Look for .meta.json files
        if filename.ends_with(".meta.json") {
            let meta_path = entry.path();
            if let Ok(content) = tokio::fs::read_to_string(&meta_path).await {
                if let Ok(meta) = serde_json::from_str::<ModMetadata>(&content) {
                    project_ids.push(meta.project_id);
                }
            }
        }
    }

    Ok(project_ids)
}

/// Get mod details from Modrinth
#[tauri::command]
pub async fn get_modrinth_mod_details(
    state: State<'_, SharedState>,
    project_id: String,
) -> AppResult<super::Project> {
    let state = state.read().await;
    let client = ModrinthClient::new(&state.http_client);

    let project = client
        .get_project(&project_id)
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;

    Ok(project)
}

/// Dependency info with project details
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DependencyInfo {
    pub project_id: String,
    pub version_id: Option<String>,
    pub dependency_type: String,
    pub title: String,
    pub description: String,
    pub icon_url: Option<String>,
    pub slug: String,
}

/// Get dependencies for a specific mod version with project details
#[tauri::command]
pub async fn get_mod_dependencies(
    state: State<'_, SharedState>,
    version_id: String,
    _game_version: Option<String>,
    _loader: Option<String>,
) -> AppResult<Vec<DependencyInfo>> {
    let state = state.read().await;
    let client = ModrinthClient::new(&state.http_client);

    // Get the version to see its dependencies
    let version = client
        .get_version(&version_id)
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;

    let mut dependencies = Vec::new();

    for dep in version.dependencies {
        // Only process required and optional dependencies
        if dep.dependency_type != "required" && dep.dependency_type != "optional" {
            continue;
        }

        // Get project_id either directly or from version_id
        let project_id = if let Some(pid) = dep.project_id {
            pid
        } else if let Some(vid) = &dep.version_id {
            // Get version to find project_id
            match client.get_version(vid).await {
                Ok(v) => v.project_id,
                Err(_) => continue,
            }
        } else {
            continue;
        };

        // Get project details
        let project = match client.get_project(&project_id).await {
            Ok(p) => p,
            Err(_) => continue,
        };

        dependencies.push(DependencyInfo {
            project_id: project_id.clone(),
            version_id: dep.version_id,
            dependency_type: dep.dependency_type,
            title: project.title,
            description: project.description,
            icon_url: project.icon_url,
            slug: project.slug,
        });
    }

    Ok(dependencies)
}

/// Install multiple mods at once (for dependencies)
#[tauri::command]
pub async fn install_modrinth_mods_batch(
    state: State<'_, SharedState>,
    instance_id: String,
    mods: Vec<(String, String)>, // Vec of (project_id, version_id)
    project_type: Option<String>,
) -> AppResult<Vec<String>> {
    let state_guard = state.read().await;
    let client = ModrinthClient::new(&state_guard.http_client);

    // Get the instance
    let instance = Instance::get_by_id(&state_guard.db, &instance_id)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Instance("Instance not found".to_string()))?;

    let ptype = project_type.as_deref();
    let folder_name = get_content_folder(ptype, instance.loader.as_deref(), instance.is_server);

    let instance_dir = state_guard
        .data_dir
        .join("instances")
        .join(&instance.game_dir);

    // Handle datapacks specially
    let target_dir = if ptype == Some("datapack") {
        let world_name = find_world_folder(&instance_dir)
            .await
            .unwrap_or_else(|| "world".to_string());
        instance_dir
            .join("saves")
            .join(&world_name)
            .join("datapacks")
    } else {
        instance_dir.join(folder_name)
    };

    // Create directory if it doesn't exist
    tokio::fs::create_dir_all(&target_dir)
        .await
        .map_err(|e| AppError::Io(format!("Failed to create {} directory: {}", folder_name, e)))?;

    let mut installed_files = Vec::new();

    for (project_id, version_id) in mods {
        // Get the project info
        let project = match client.get_project(&project_id).await {
            Ok(p) => p,
            Err(e) => {
                log::warn!("Failed to get project {}: {}", project_id, e);
                continue;
            }
        };

        // Get the version info
        let version = match client.get_version(&version_id).await {
            Ok(v) => v,
            Err(e) => {
                log::warn!("Failed to get version {}: {}", version_id, e);
                continue;
            }
        };

        // Find the primary file
        let file = match version
            .files
            .iter()
            .find(|f| f.primary)
            .or_else(|| version.files.first())
        {
            Some(f) => f,
            None => {
                log::warn!("No files found for version {}", version_id);
                continue;
            }
        };

        let dest_path = target_dir.join(&file.filename);

        // Skip if file already exists
        if dest_path.exists() {
            log::info!("File {} already exists, skipping", file.filename);
            continue;
        }

        // Download the file
        if let Err(e) = client.download_file(file, &dest_path).await {
            log::warn!("Failed to download {}: {}", file.filename, e);
            continue;
        }

        // Save metadata
        let meta_filename = format!("{}.meta.json", file.filename.trim_end_matches(".jar"));
        let meta_path = target_dir.join(&meta_filename);
        let metadata = ModMetadata {
            name: project.title.clone(),
            version: version.version_number.clone(),
            project_id: project_id.clone(),
            version_id: Some(version_id.clone()),
            icon_url: project.icon_url.clone(),
        };

        if let Ok(meta_json) = serde_json::to_string_pretty(&metadata) {
            let _ = tokio::fs::write(&meta_path, meta_json).await;
        }

        log::info!("Installed {} ({})", project.title, file.filename);
        installed_files.push(file.filename.clone());
    }

    Ok(installed_files)
}

// ============= Modpack Installation =============

/// Modrinth modpack index format
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModpackIndex {
    #[serde(rename = "formatVersion")]
    pub format_version: u32,
    pub game: String,
    #[serde(rename = "versionId")]
    pub version_id: String,
    pub name: String,
    pub summary: Option<String>,
    pub files: Vec<ModpackFile>,
    pub dependencies: std::collections::HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModpackFile {
    pub path: String,
    pub hashes: ModpackFileHashes,
    pub downloads: Vec<String>,
    #[serde(rename = "fileSize")]
    pub file_size: u64,
    #[serde(default)]
    pub env: Option<ModpackFileEnv>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModpackFileHashes {
    pub sha1: String,
    pub sha512: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModpackFileEnv {
    pub client: Option<String>,
    pub server: Option<String>,
}

/// Response for modpack installation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModpackInstallResult {
    pub instance_id: String,
    pub name: String,
    pub mc_version: String,
    pub loader: Option<String>,
    pub loader_version: Option<String>,
    pub files_count: usize,
}

/// Install a modpack from Modrinth and create a new instance
#[tauri::command]
pub async fn install_modrinth_modpack(
    state: State<'_, SharedState>,
    app: tauri::AppHandle,
    project_id: String,
    version_id: String,
    instance_name: Option<String>,
) -> AppResult<ModpackInstallResult> {
    use crate::db::instances::Instance;
    use sha1::{Digest, Sha1};
    use tauri::Emitter;

    // Clone the http_client for use throughout the function
    let http_client = {
        let state_guard = state.read().await;
        state_guard.http_client.clone()
    };
    let client = ModrinthClient::new(&http_client);

    // Emit progress (use project_id as identifier until instance is created)
    let _ = app.emit(
        "modpack-progress",
        serde_json::json!({
            "stage": "fetching",
            "message": "Recuperation des informations du modpack...",
            "progress": 5,
            "project_id": &project_id
        }),
    );

    // Get project info (for icon)
    let project = client
        .get_project(&project_id)
        .await
        .map_err(|e| AppError::Network(format!("Failed to get modpack info: {}", e)))?;

    let icon_url = project.icon_url.clone();

    // Get version info
    let version = client
        .get_version(&version_id)
        .await
        .map_err(|e| AppError::Network(format!("Failed to get modpack version: {}", e)))?;

    // Find the .mrpack file
    let mrpack_file = version
        .files
        .iter()
        .find(|f| f.filename.ends_with(".mrpack"))
        .or_else(|| version.files.first())
        .ok_or_else(|| AppError::Instance("No modpack file found".to_string()))?;

    let expected_hash = mrpack_file.hashes.sha1.clone();
    let download_url = mrpack_file.url.clone();

    let _ = app.emit(
        "modpack-progress",
        serde_json::json!({
            "stage": "downloading",
            "message": "Telechargement du modpack...",
            "progress": 10,
            "project_id": &project_id
        }),
    );

    // Download the modpack file
    let response = http_client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("Failed to download modpack: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::Network(format!(
            "Failed to download modpack: HTTP {}",
            response.status()
        )));
    }

    let mrpack_bytes = response
        .bytes()
        .await
        .map_err(|e| AppError::Network(format!("Failed to read modpack: {}", e)))?
        .to_vec();

    // Verify hash
    let mut hasher = Sha1::new();
    hasher.update(&mrpack_bytes);
    let hash = format!("{:x}", hasher.finalize());

    if hash != expected_hash {
        return Err(AppError::Instance(format!(
            "Modpack hash mismatch: expected {}, got {}",
            expected_hash, hash
        )));
    }

    let _ = app.emit(
        "modpack-progress",
        serde_json::json!({
            "stage": "extracting",
            "message": "Extraction du modpack...",
            "progress": 20,
            "project_id": &project_id
        }),
    );

    // Parse the modpack index in a blocking task
    let mrpack_bytes_clone = mrpack_bytes.clone();
    let index: ModpackIndex = tokio::task::spawn_blocking(move || {
        use std::io::{Cursor, Read};
        use zip::ZipArchive;

        let cursor = Cursor::new(mrpack_bytes_clone);
        let mut archive = ZipArchive::new(cursor)?;

        let mut index_file = archive.by_name("modrinth.index.json")?;
        let mut contents = String::new();
        index_file.read_to_string(&mut contents)?;

        serde_json::from_str::<ModpackIndex>(&contents)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))
    })
    .await
    .map_err(|e| AppError::Instance(format!("Failed to parse modpack: {}", e)))?
    .map_err(|e| AppError::Instance(format!("Failed to parse modpack: {}", e)))?;

    // Extract loader info from dependencies
    let mc_version = index
        .dependencies
        .get("minecraft")
        .cloned()
        .ok_or_else(|| AppError::Instance("Modpack missing minecraft version".to_string()))?;

    let (loader, loader_version) = if let Some(v) = index.dependencies.get("fabric-loader") {
        (Some("fabric".to_string()), Some(v.clone()))
    } else if let Some(v) = index.dependencies.get("forge") {
        (Some("forge".to_string()), Some(v.clone()))
    } else if let Some(v) = index.dependencies.get("neoforge") {
        (Some("neoforge".to_string()), Some(v.clone()))
    } else if let Some(v) = index.dependencies.get("quilt-loader") {
        (Some("quilt".to_string()), Some(v.clone()))
    } else {
        (None, None)
    };

    // Create the instance name
    let name =
        instance_name.unwrap_or_else(|| format!("{} ({})", index.name, version.version_number));

    let _ = app.emit(
        "modpack-progress",
        serde_json::json!({
            "stage": "creating",
            "message": "Creation de l'instance...",
            "progress": 25,
            "project_id": &project_id
        }),
    );

    // Create the instance in database
    let state_guard = state.read().await;
    let create_data = crate::db::instances::CreateInstance {
        name: name.clone(),
        mc_version: mc_version.clone(),
        loader: loader.clone(),
        loader_version: loader_version.clone(),
        is_server: false,
        is_proxy: false,
        server_port: 25565,
        modrinth_project_id: Some(project_id.clone()),
    };
    let instance = Instance::create(&state_guard.db, create_data)
        .await
        .map_err(AppError::from)?;

    // Create instance directory
    let instance_dir = state_guard
        .data_dir
        .join("instances")
        .join(&instance.game_dir);

    tokio::fs::create_dir_all(&instance_dir)
        .await
        .map_err(|e| AppError::Io(format!("Failed to create instance directory: {}", e)))?;

    // Create mods directory
    let mods_dir = instance_dir.join("mods");
    tokio::fs::create_dir_all(&mods_dir)
        .await
        .map_err(|e| AppError::Io(format!("Failed to create mods directory: {}", e)))?;

    // Download and save the icon
    let mut saved_icon_path: Option<String> = None;
    if let Some(url) = &icon_url {
        let _ = app.emit(
            "modpack-progress",
            serde_json::json!({
                "stage": "downloading_icon",
                "message": "Telechargement de l'icone...",
                "progress": 28,
                "project_id": &project_id,
                "instance_id": &instance.id
            }),
        );

        debug!("Downloading icon from: {}", url);

        // Determine file extension from URL (handle query parameters)
        let url_without_params = url.split('?').next().unwrap_or(url);
        let extension = url_without_params
            .rsplit('.')
            .next()
            .filter(|ext| {
                let ext_lower = ext.to_lowercase();
                ["png", "jpg", "jpeg", "gif", "webp"].contains(&ext_lower.as_str())
            })
            .unwrap_or("png");

        let icon_filename = format!("icon.{}", extension);
        let icon_full_path = instance_dir.join(&icon_filename);

        debug!("Saving icon to: {:?}", icon_full_path);

        // Download the icon
        match http_client.get(url).send().await {
            Ok(response) => {
                if response.status().is_success() {
                    match response.bytes().await {
                        Ok(bytes) => {
                            debug!("Downloaded {} bytes for icon", bytes.len());
                            match tokio::fs::write(&icon_full_path, &bytes).await {
                                Ok(_) => {
                                    saved_icon_path = Some(icon_filename.clone());
                                    debug!("Saved modpack icon to {:?}", icon_full_path);
                                }
                                Err(e) => debug!("Failed to write icon: {}", e),
                            }
                        }
                        Err(e) => debug!("Failed to read icon bytes: {}", e),
                    }
                } else {
                    debug!("Icon download failed with status: {}", response.status());
                }
            }
            Err(e) => debug!("Failed to download icon: {}", e),
        }
    } else {
        debug!("No icon URL provided for this modpack");
    }

    // Update instance with icon path
    if let Some(ref icon_path) = saved_icon_path {
        debug!(
            "Updating instance {} with icon_path: {}",
            instance.id, icon_path
        );
        match Instance::update_icon(&state_guard.db, &instance.id, Some(icon_path)).await {
            Ok(_) => debug!("Icon path updated in database"),
            Err(e) => debug!("Failed to update icon in database: {}", e),
        }
    }

    let _ = app.emit(
        "modpack-progress",
        serde_json::json!({
            "stage": "downloading_mods",
            "message": "Telechargement des mods...",
            "progress": 30,
            "project_id": &project_id,
            "instance_id": &instance.id
        }),
    );

    // Helper function to extract version hash from Modrinth CDN URL
    // URL format: https://cdn.modrinth.com/data/{project_id}/versions/{version_id}/{filename}
    fn extract_modrinth_ids(url: &str) -> Option<(String, String)> {
        if url.contains("cdn.modrinth.com/data/") {
            let parts: Vec<&str> = url.split('/').collect();
            // Find "data" index and extract project_id and version_id
            if let Some(data_idx) = parts.iter().position(|&p| p == "data") {
                if parts.len() > data_idx + 4 {
                    let project_id = parts[data_idx + 1].to_string();
                    // version_id is after "versions"
                    if let Some(ver_idx) = parts.iter().position(|&p| p == "versions") {
                        if parts.len() > ver_idx + 1 {
                            let version_id = parts[ver_idx + 1].to_string();
                            return Some((project_id, version_id));
                        }
                    }
                }
            }
        }
        None
    }

    // Download all files from the index
    let total_files = index.files.len();
    let mut downloaded = 0;

    // Collect mod files that need metadata (files in mods/ folder)
    let mut mod_files_to_fetch: Vec<(String, String, String)> = Vec::new(); // (project_id, version_id, filename)

    for file in &index.files {
        // Skip server-only files
        if let Some(env) = &file.env {
            if env.client.as_deref() == Some("unsupported") {
                continue;
            }
        }

        let file_path = instance_dir.join(&file.path);

        // Create parent directory
        if let Some(parent) = file_path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| AppError::Io(format!("Failed to create directory: {}", e)))?;
        }

        // Try each download URL
        let mut success = false;
        let mut used_url: Option<String> = None;
        for url in &file.downloads {
            match http_client.get(url).send().await {
                Ok(response) if response.status().is_success() => {
                    if let Ok(bytes) = response.bytes().await {
                        // Verify hash
                        let mut hasher = Sha1::new();
                        hasher.update(&bytes);
                        let file_hash = format!("{:x}", hasher.finalize());

                        if file_hash == file.hashes.sha1
                            && tokio::fs::write(&file_path, &bytes).await.is_ok()
                        {
                            success = true;
                            used_url = Some(url.clone());
                            break;
                        }
                    }
                }
                _ => continue,
            }
        }

        if !success {
            log::warn!("Failed to download: {}", file.path);
        } else {
            // If this is a mod file, extract project info for metadata
            if file.path.starts_with("mods/") && file.path.ends_with(".jar") {
                if let Some(url) = used_url {
                    if let Some((project_id, version_id)) = extract_modrinth_ids(&url) {
                        let filename = file
                            .path
                            .rsplit('/')
                            .next()
                            .unwrap_or(&file.path)
                            .to_string();
                        mod_files_to_fetch.push((project_id, version_id, filename));
                    }
                }
            }
        }

        downloaded += 1;
        let progress = 30 + ((downloaded as f32 / total_files as f32) * 45.0) as u32;
        let _ = app.emit(
            "modpack-progress",
            serde_json::json!({
                "stage": "downloading_mods",
                "message": format!("Telechargement des mods ({}/{})", downloaded, total_files),
                "progress": progress,
                "project_id": &project_id,
                "instance_id": &instance.id
            }),
        );
    }

    // Save modpack project_id before it gets shadowed in the loop
    let modpack_project_id = project_id.clone();

    // Fetch metadata for mods (icons, names, etc.)
    if !mod_files_to_fetch.is_empty() {
        let _ = app.emit(
            "modpack-progress",
            serde_json::json!({
                "stage": "fetching_metadata",
                "message": "Recuperation des informations des mods...",
                "progress": 78,
                "project_id": &modpack_project_id,
                "instance_id": &instance.id
            }),
        );

        let total_mods = mod_files_to_fetch.len();
        let mut fetched = 0;

        for (project_id, version_id, filename) in mod_files_to_fetch {
            // Fetch project info for icon and name
            match client.get_project(&project_id).await {
                Ok(project_info) => {
                    let meta_filename = format!("{}.meta.json", filename.trim_end_matches(".jar"));
                    let meta_path = mods_dir.join(&meta_filename);

                    let metadata = ModMetadata {
                        name: project_info.title,
                        version: "".to_string(), // Version already in filename
                        project_id: project_id.clone(),
                        version_id: Some(version_id.clone()),
                        icon_url: project_info.icon_url,
                    };

                    if let Ok(meta_json) = serde_json::to_string_pretty(&metadata) {
                        let _ = tokio::fs::write(&meta_path, meta_json).await;
                    }
                }
                Err(e) => {
                    log::debug!("Failed to fetch metadata for {}: {}", project_id, e);
                }
            }

            fetched += 1;
            if fetched % 5 == 0 || fetched == total_mods {
                let progress = 78 + ((fetched as f32 / total_mods as f32) * 7.0) as u32;
                let _ = app.emit("modpack-progress", serde_json::json!({
                    "stage": "fetching_metadata",
                    "message": format!("Recuperation des metadonnees ({}/{})", fetched, total_mods),
                    "progress": progress,
                    "project_id": &modpack_project_id,
                    "instance_id": &instance.id
                }));
            }
        }
    }

    let _ = app.emit(
        "modpack-progress",
        serde_json::json!({
            "stage": "extracting_overrides",
            "message": "Extraction des fichiers de configuration...",
            "progress": 85,
            "project_id": &modpack_project_id,
            "instance_id": &instance.id
        }),
    );

    // Extract overrides in a blocking task
    let instance_dir_clone = instance_dir.clone();
    tokio::task::spawn_blocking(move || {
        use std::io::{Cursor, Read};
        use zip::ZipArchive;

        let cursor = Cursor::new(mrpack_bytes);
        let mut archive = match ZipArchive::new(cursor) {
            Ok(a) => a,
            Err(_) => return,
        };

        for i in 0..archive.len() {
            let mut file = match archive.by_index(i) {
                Ok(f) => f,
                Err(_) => continue,
            };

            let name = file.name().to_string();

            // Check for overrides or client-overrides
            let override_prefix = if name.starts_with("overrides/") {
                Some("overrides/")
            } else if name.starts_with("client-overrides/") {
                Some("client-overrides/")
            } else {
                None
            };

            if let Some(prefix) = override_prefix {
                let relative_path = &name[prefix.len()..];
                if relative_path.is_empty() {
                    continue;
                }

                let dest_path = instance_dir_clone.join(relative_path);

                if file.is_dir() {
                    if let Err(e) = std::fs::create_dir_all(&dest_path) {
                        tracing::warn!("Failed to create directory {:?}: {}", dest_path, e);
                    }
                } else {
                    // Create parent directory
                    if let Some(parent) = dest_path.parent() {
                        if let Err(e) = std::fs::create_dir_all(parent) {
                            tracing::warn!("Failed to create parent directory {:?}: {}", parent, e);
                        }
                    }

                    // Extract file
                    let mut contents = Vec::new();
                    if file.read_to_end(&mut contents).is_ok() {
                        if let Err(e) = std::fs::write(&dest_path, &contents) {
                            tracing::warn!("Failed to write file {:?}: {}", dest_path, e);
                        }
                    }
                }
            }
        }
    })
    .await
    .map_err(|e| AppError::Instance(format!("Failed to extract overrides: {}", e)))?;

    let _ = app.emit(
        "modpack-progress",
        serde_json::json!({
            "stage": "complete",
            "message": "Modpack installe avec succes!",
            "progress": 100,
            "project_id": &modpack_project_id,
            "instance_id": &instance.id
        }),
    );

    // Drop the state guard to release the lock
    drop(state_guard);

    Ok(ModpackInstallResult {
        instance_id: instance.id,
        name: instance.name,
        mc_version,
        loader,
        loader_version,
        files_count: total_files,
    })
}

// ============= Mod Update Feature =============

/// Information about a mod that has an update available
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModUpdateInfo {
    pub project_id: String,
    pub filename: String,
    pub current_version: String,
    pub current_version_id: Option<String>,
    pub latest_version: String,
    pub latest_version_id: String,
    pub name: String,
    pub icon_url: Option<String>,
}

/// Check for updates for all mods in an instance
#[tauri::command]
pub async fn check_mod_updates(
    state: State<'_, SharedState>,
    instance_id: String,
    project_type: Option<String>,
) -> AppResult<Vec<ModUpdateInfo>> {
    let state_guard = state.read().await;
    let client = ModrinthClient::new(&state_guard.http_client);

    let instance = Instance::get_by_id(&state_guard.db, &instance_id)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Instance("Instance not found".to_string()))?;

    let ptype = project_type.as_deref();
    let folder_name = get_content_folder(ptype, instance.loader.as_deref(), instance.is_server);

    let instance_dir = state_guard
        .data_dir
        .join("instances")
        .join(&instance.game_dir);

    // Handle datapacks specially
    let content_dir = if ptype == Some("datapack") {
        let world_name = find_world_folder(&instance_dir)
            .await
            .unwrap_or_else(|| "world".to_string());
        instance_dir
            .join("saves")
            .join(&world_name)
            .join("datapacks")
    } else {
        instance_dir.join(folder_name)
    };

    if !content_dir.exists() {
        return Ok(vec![]);
    }

    let mut updates = Vec::new();
    let mut entries = tokio::fs::read_dir(&content_dir)
        .await
        .map_err(|e| AppError::Io(format!("Failed to read {} directory: {}", folder_name, e)))?;

    // Collect all mods with their metadata
    let mut mods_to_check: Vec<(String, ModMetadata)> = Vec::new();

    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| AppError::Io(format!("Failed to read directory entry: {}", e)))?
    {
        let filename = entry.file_name().to_string_lossy().to_string();

        // Look for .meta.json files
        if filename.ends_with(".meta.json") {
            let meta_path = entry.path();
            if let Ok(content) = tokio::fs::read_to_string(&meta_path).await {
                if let Ok(meta) = serde_json::from_str::<ModMetadata>(&content) {
                    // Find the corresponding mod file
                    let base_name = filename.trim_end_matches(".meta.json");
                    let jar_filename = format!("{}.jar", base_name);
                    let zip_filename = format!("{}.zip", base_name);

                    let mod_filename = if content_dir.join(&jar_filename).exists() {
                        jar_filename
                    } else if content_dir.join(&zip_filename).exists() {
                        zip_filename
                    } else if content_dir
                        .join(format!("{}.jar.disabled", base_name))
                        .exists()
                    {
                        format!("{}.jar.disabled", base_name)
                    } else if content_dir
                        .join(format!("{}.zip.disabled", base_name))
                        .exists()
                    {
                        format!("{}.zip.disabled", base_name)
                    } else {
                        continue;
                    };

                    mods_to_check.push((mod_filename, meta));
                }
            }
        }
    }

    // Check each mod for updates
    for (filename, meta) in mods_to_check {
        // Get the latest versions for this project
        let game_versions = Some(vec![instance.mc_version.as_str()]);

        // Only include loaders for mods and plugins
        let loaders = match ptype {
            Some("mod") | Some("plugin") | None => {
                instance.loader.as_ref().map(|l| vec![l.to_lowercase()])
            }
            _ => None,
        };
        let loaders_refs: Option<Vec<&str>> = loaders
            .as_ref()
            .map(|v| v.iter().map(|s| s.as_str()).collect());

        match client
            .get_project_versions(
                &meta.project_id,
                loaders_refs.as_deref(),
                game_versions.as_deref(),
            )
            .await
        {
            Ok(versions) => {
                if let Some(latest) = versions.first() {
                    // Check if there's a newer version
                    let needs_update = match &meta.version_id {
                        Some(current_vid) => *current_vid != latest.id,
                        None => true, // If we don't have version_id, assume it might need update
                    };

                    if needs_update {
                        updates.push(ModUpdateInfo {
                            project_id: meta.project_id.clone(),
                            filename: filename.clone(),
                            current_version: meta.version.clone(),
                            current_version_id: meta.version_id.clone(),
                            latest_version: latest.version_number.clone(),
                            latest_version_id: latest.id.clone(),
                            name: meta.name.clone(),
                            icon_url: meta.icon_url.clone(),
                        });
                    }
                }
            }
            Err(e) => {
                log::warn!("Failed to check updates for {}: {}", meta.project_id, e);
            }
        }
    }

    Ok(updates)
}

/// Update a mod to a specific version
#[tauri::command]
pub async fn update_mod(
    state: State<'_, SharedState>,
    instance_id: String,
    project_id: String,
    current_filename: String,
    new_version_id: String,
    project_type: Option<String>,
) -> AppResult<String> {
    let state_guard = state.read().await;
    let client = ModrinthClient::new(&state_guard.http_client);

    let instance = Instance::get_by_id(&state_guard.db, &instance_id)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Instance("Instance not found".to_string()))?;

    let ptype = project_type.as_deref();
    let folder_name = get_content_folder(ptype, instance.loader.as_deref(), instance.is_server);

    let instance_dir = state_guard
        .data_dir
        .join("instances")
        .join(&instance.game_dir);

    // Handle datapacks specially
    let content_dir = if ptype == Some("datapack") {
        let world_name = find_world_folder(&instance_dir)
            .await
            .unwrap_or_else(|| "world".to_string());
        instance_dir
            .join("saves")
            .join(&world_name)
            .join("datapacks")
    } else {
        instance_dir.join(folder_name)
    };

    // Get project info
    let project = client
        .get_project(&project_id)
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;

    // Get the new version info
    let version = client
        .get_version(&new_version_id)
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;

    // Find the primary file
    let file = version
        .files
        .iter()
        .find(|f| f.primary)
        .or_else(|| version.files.first())
        .ok_or_else(|| AppError::Instance("No files found for this version".to_string()))?;

    let new_path = content_dir.join(&file.filename);

    // Download the new file
    client
        .download_file(file, &new_path)
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;

    // Delete the old file
    let old_path = content_dir.join(&current_filename);
    if old_path.exists() {
        tokio::fs::remove_file(&old_path)
            .await
            .map_err(|e| AppError::Io(format!("Failed to delete old mod: {}", e)))?;
    }

    // Delete old metadata file
    let old_base = current_filename
        .trim_end_matches(".disabled")
        .trim_end_matches(".jar")
        .trim_end_matches(".zip");
    let old_meta_path = content_dir.join(format!("{}.meta.json", old_base));
    if old_meta_path.exists() {
        let _ = tokio::fs::remove_file(&old_meta_path).await;
    }

    // Save new metadata
    let new_base = file
        .filename
        .trim_end_matches(".jar")
        .trim_end_matches(".zip");
    let new_meta_path = content_dir.join(format!("{}.meta.json", new_base));
    let metadata = ModMetadata {
        name: project.title.clone(),
        version: version.version_number.clone(),
        project_id: project_id.clone(),
        version_id: Some(new_version_id.clone()),
        icon_url: project.icon_url,
    };

    if let Ok(meta_json) = serde_json::to_string_pretty(&metadata) {
        let _ = tokio::fs::write(&new_meta_path, meta_json).await;
    }

    log::info!(
        "Updated mod {} from {} to {} ({})",
        project.title,
        current_filename,
        file.filename,
        version.version_number
    );

    Ok(file.filename.clone())
}
