//! Parser for Modrinth App and .mrpack files
//! Reads profile data from Modrinth App's SQLite database (app.db)
//! Also reads modrinth.index.json from .mrpack archives

use chrono::{DateTime, Utc};
use serde::Deserialize;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::Row;
use std::collections::HashMap;
use std::io::Read;
use std::path::PathBuf;
use std::str::FromStr;
use tracing::{debug, warn};
use uuid::Uuid;
use zip::ZipArchive;

use crate::error::{AppError, AppResult};
use crate::external_import::{
    detection::get_modrinth_app_paths, DetectedInstance, LauncherParser, LauncherType, ModFile,
};

/// Parser for Modrinth App and .mrpack files
pub struct ModrinthParser;

/// Profile data from Modrinth App database
#[derive(Debug, Clone)]
struct ModrinthDbProfile {
    path: String,
    name: String,
    game_version: Option<String>,
    loader: Option<String>,
    loader_version: Option<String>,
    icon_path: Option<String>,
    date_modified: Option<String>,
}

impl ModrinthParser {
    /// Read profiles from Modrinth App's SQLite database
    async fn read_profiles_from_db(profiles_dir: &PathBuf) -> AppResult<Vec<ModrinthDbProfile>> {
        // The app.db is in the parent directory of profiles
        let db_path = profiles_dir
            .parent()
            .map(|p| p.join("app.db"))
            .ok_or_else(|| AppError::ExternalImport("Cannot find Modrinth app.db".to_string()))?;

        if !db_path.exists() {
            debug!("Modrinth app.db not found at {:?}", db_path);
            return Ok(Vec::new());
        }

        let db_url = format!("sqlite:{}?mode=ro", db_path.display());
        debug!("Connecting to Modrinth database: {}", db_url);

        let options = SqliteConnectOptions::from_str(&db_url)
            .map_err(|e| AppError::ExternalImport(format!("Invalid database URL: {}", e)))?
            .read_only(true);

        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .map_err(|e| AppError::ExternalImport(format!("Failed to connect to Modrinth db: {}", e)))?;

        // Query profiles table
        // Column names: path, name, game_version, mod_loader, mod_loader_version, icon_path, modified
        let profiles: Vec<ModrinthDbProfile> = sqlx::query(
            r#"
            SELECT
                path,
                name,
                game_version,
                mod_loader,
                mod_loader_version,
                icon_path,
                modified
            FROM profiles
            WHERE install_stage = 'installed'
            "#
        )
        .fetch_all(&pool)
        .await
        .map_err(|e| {
            debug!("Failed to query profiles table: {}", e);
            AppError::ExternalImport(format!("Failed to query Modrinth profiles: {}", e))
        })?
        .into_iter()
        .map(|row| ModrinthDbProfile {
            path: row.get("path"),
            name: row.get("name"),
            game_version: row.try_get("game_version").ok(),
            loader: row.try_get("mod_loader").ok(),
            loader_version: row.try_get("mod_loader_version").ok(),
            icon_path: row.try_get("icon_path").ok(),
            date_modified: row.try_get::<i64, _>("modified").ok().and_then(|ts| {
                // Convert Unix timestamp to ISO string
                DateTime::<Utc>::from_timestamp(ts, 0).map(|dt| dt.to_rfc3339())
            }),
        })
        .collect();

        pool.close().await;

        debug!("Found {} profiles in Modrinth database", profiles.len());
        Ok(profiles)
    }
}

/// Structure of modrinth.index.json
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModrinthIndex {
    format_version: u32,
    game: String,
    version_id: String,
    name: String,
    #[serde(default)]
    summary: Option<String>,
    files: Vec<MrpackFile>,
    dependencies: HashMap<String, String>,
}

#[derive(Debug, Clone, Deserialize)]
struct MrpackFile {
    path: String,
    hashes: MrpackHashes,
    #[serde(default)]
    env: Option<MrpackEnv>,
    downloads: Vec<String>,
    #[serde(default)]
    file_size: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
struct MrpackHashes {
    sha1: String,
    sha512: String,
}

#[derive(Debug, Clone, Deserialize)]
struct MrpackEnv {
    #[serde(default)]
    client: Option<String>,
    #[serde(default)]
    server: Option<String>,
}

impl ModrinthParser {
    /// Extract loader info from dependencies map
    fn extract_loader_from_dependencies(
        dependencies: &HashMap<String, String>,
    ) -> (Option<String>, Option<String>) {
        // Check for each loader type
        if let Some(version) = dependencies.get("fabric-loader") {
            return (Some("fabric".to_string()), Some(version.clone()));
        }
        if let Some(version) = dependencies.get("quilt-loader") {
            return (Some("quilt".to_string()), Some(version.clone()));
        }
        if let Some(version) = dependencies.get("forge") {
            return (Some("forge".to_string()), Some(version.clone()));
        }
        if let Some(version) = dependencies.get("neoforge") {
            return (Some("neoforge".to_string()), Some(version.clone()));
        }

        (None, None)
    }

    /// Read modrinth.index.json from a .mrpack file
    fn read_mrpack_index(path: &PathBuf) -> AppResult<ModrinthIndex> {
        let file = std::fs::File::open(path)
            .map_err(|e| AppError::ExternalImport(format!("Failed to open mrpack: {}", e)))?;

        let mut archive = ZipArchive::new(file)
            .map_err(|e| AppError::ExternalImport(format!("Invalid zip archive: {}", e)))?;

        let mut index_file = archive.by_name("modrinth.index.json").map_err(|_| {
            AppError::ExternalImport("Missing modrinth.index.json in mrpack".to_string())
        })?;

        let mut content = String::new();
        index_file
            .read_to_string(&mut content)
            .map_err(|e| AppError::ExternalImport(format!("Failed to read index: {}", e)))?;

        serde_json::from_str(&content)
            .map_err(|e| AppError::ExternalImport(format!("Invalid modrinth.index.json: {}", e)))
    }

    /// Calculate total size of files in mrpack
    fn calculate_mrpack_size(index: &ModrinthIndex) -> u64 {
        index
            .files
            .iter()
            .map(|f| f.file_size.unwrap_or(0))
            .sum()
    }

    /// Count mods in mrpack (files in mods/ folder)
    fn count_mrpack_mods(index: &ModrinthIndex) -> usize {
        index
            .files
            .iter()
            .filter(|f| f.path.starts_with("mods/") && f.path.ends_with(".jar"))
            .count()
    }
}

#[async_trait::async_trait]
impl LauncherParser for ModrinthParser {
    fn launcher_type(&self) -> LauncherType {
        LauncherType::ModrinthApp
    }

    fn default_paths(&self) -> Vec<PathBuf> {
        get_modrinth_app_paths()
    }

    async fn detect(&self, path: &PathBuf) -> bool {
        // Check if this is a .mrpack file
        if path.is_file() && path.extension().map_or(false, |ext| ext == "mrpack") {
            // Verify it contains modrinth.index.json
            if let Ok(file) = std::fs::File::open(path) {
                if let Ok(mut archive) = ZipArchive::new(file) {
                    return archive.by_name("modrinth.index.json").is_ok();
                }
            }
            return false;
        }

        // Check if this is a Modrinth App profiles directory
        if path.is_dir() {
            // Look for profile.json files OR typical Minecraft instance folders
            if let Ok(mut entries) = std::fs::read_dir(path) {
                return entries.any(|e| {
                    e.ok()
                        .and_then(|entry| {
                            let p = entry.path();
                            if p.is_dir() {
                                // Check for profile.json (older Modrinth versions)
                                if p.join("profile.json").exists() {
                                    return Some(true);
                                }
                                // Check for typical Minecraft instance markers
                                // (mods folder, .fabric folder, config folder)
                                if p.join("mods").exists()
                                    || p.join(".fabric").exists()
                                    || p.join("config").exists()
                                {
                                    return Some(true);
                                }
                            }
                            None
                        })
                        .unwrap_or(false)
                });
            }
        }

        false
    }

    async fn parse_instances(&self, path: &PathBuf) -> AppResult<Vec<DetectedInstance>> {
        // If this is a .mrpack file, parse it directly
        if path.is_file() && path.extension().map_or(false, |ext| ext == "mrpack") {
            let instance = self.parse_single(path).await?;
            return Ok(vec![instance]);
        }

        // Otherwise, scan Modrinth App profiles directory
        let mut instances = Vec::new();

        if !path.is_dir() {
            return Ok(instances);
        }

        // First, try to read profile metadata from the SQLite database
        let db_profiles = match Self::read_profiles_from_db(path).await {
            Ok(profiles) => profiles,
            Err(e) => {
                debug!("Failed to read Modrinth database, falling back to folder scan: {}", e);
                Vec::new()
            }
        };

        // Create a map of profile paths to their metadata
        let mut profile_map: HashMap<String, ModrinthDbProfile> = HashMap::new();
        for profile in db_profiles {
            // The path in the database might be just the folder name or a full path
            let folder_name = PathBuf::from(&profile.path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(&profile.path)
                .to_string();
            profile_map.insert(folder_name, profile);
        }

        debug!("Loaded {} profiles from database", profile_map.len());

        // Scan the profiles directory
        let mut entries = tokio::fs::read_dir(path)
            .await
            .map_err(|e| AppError::ExternalImport(format!("Failed to read profiles: {}", e)))?;

        while let Some(entry) = entries.next_entry().await.map_err(|e| {
            AppError::ExternalImport(format!("Failed to read entry: {}", e))
        })? {
            let profile_path = entry.path();

            if !profile_path.is_dir() {
                continue;
            }

            // Check if this looks like a Minecraft instance
            let has_mods = profile_path.join("mods").exists();
            let has_config = profile_path.join("config").exists();
            let has_saves = profile_path.join("saves").exists();

            if !has_mods && !has_config && !has_saves {
                continue;
            }

            // Get folder name to match with database
            let folder_name = profile_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();

            // Try to get metadata from database
            let db_profile = profile_map.get(&folder_name).cloned();

            // Parse the profile with database metadata if available
            match self.parse_modrinth_profile_with_db(&profile_path, db_profile).await {
                Ok(instance) => instances.push(instance),
                Err(e) => {
                    warn!("Failed to parse Modrinth profile at {:?}: {}", profile_path, e);
                }
            }
        }

        debug!("Found {} Modrinth App profiles", instances.len());
        Ok(instances)
    }

    async fn parse_single(&self, path: &PathBuf) -> AppResult<DetectedInstance> {
        // Handle .mrpack files
        if path.is_file() && path.extension().map_or(false, |ext| ext == "mrpack") {
            let index = Self::read_mrpack_index(path)?;

            let mc_version = index
                .dependencies
                .get("minecraft")
                .cloned()
                .unwrap_or_else(|| "unknown".to_string());

            let (loader, loader_version) =
                Self::extract_loader_from_dependencies(&index.dependencies);

            let mod_count = Some(Self::count_mrpack_mods(&index));
            let estimated_size = Some(Self::calculate_mrpack_size(&index));

            return Ok(DetectedInstance {
                id: Uuid::new_v4().to_string(),
                launcher: LauncherType::ModrinthApp,
                name: index.name,
                path: path.clone(),
                mc_version,
                loader,
                loader_version,
                is_server: false,
                icon_path: None,
                last_played: None,
                mod_count,
                estimated_size,
                raw_metadata: serde_json::json!({
                    "format_version": index.format_version,
                    "version_id": index.version_id,
                    "summary": index.summary,
                }),
            });
        }

        // Handle Modrinth App profile directory
        self.parse_modrinth_profile(path).await
    }

    async fn scan_mods(&self, instance_path: &PathBuf) -> AppResult<Vec<ModFile>> {
        // For .mrpack files, extract mod info from index
        if instance_path.is_file()
            && instance_path
                .extension()
                .map_or(false, |ext| ext == "mrpack")
        {
            let index = Self::read_mrpack_index(instance_path)?;

            let mods: Vec<ModFile> = index
                .files
                .iter()
                .filter(|f| f.path.starts_with("mods/") && f.path.ends_with(".jar"))
                .map(|f| {
                    let filename = f
                        .path
                        .rsplit('/')
                        .next()
                        .unwrap_or(&f.path)
                        .to_string();

                    ModFile {
                        filename,
                        path: PathBuf::from(&f.path),
                        sha1: Some(f.hashes.sha1.clone()),
                        sha512: Some(f.hashes.sha512.clone()),
                        size: f.file_size.unwrap_or(0),
                        modrinth_project_id: None,
                        modrinth_version_id: None,
                        modrinth_project_name: None,
                    }
                })
                .collect();

            return Ok(mods);
        }

        // For directories, scan the mods folder
        let mods_dir = instance_path.join("mods");
        if !mods_dir.exists() {
            return Ok(Vec::new());
        }

        let mut mods = Vec::new();
        let mut entries = tokio::fs::read_dir(&mods_dir)
            .await
            .map_err(|e| AppError::ExternalImport(format!("Failed to read mods: {}", e)))?;

        while let Some(entry) = entries.next_entry().await.map_err(|e| {
            AppError::ExternalImport(format!("Failed to read entry: {}", e))
        })? {
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
                path: path.clone(),
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
}

impl ModrinthParser {
    /// Parse a Modrinth App profile directory with optional database metadata
    async fn parse_modrinth_profile_with_db(
        &self,
        path: &PathBuf,
        db_profile: Option<ModrinthDbProfile>,
    ) -> AppResult<DetectedInstance> {
        // Use database metadata if available, otherwise infer from folder
        let (name, mc_version, loader, loader_version, icon_path, last_played) = if let Some(profile) = db_profile {
            debug!("Using database metadata for profile: {}", profile.name);
            (
                profile.name,
                profile.game_version.unwrap_or_else(|| "unknown".to_string()),
                profile.loader,
                profile.loader_version,
                profile.icon_path.map(PathBuf::from),
                profile.date_modified,
            )
        } else {
            // No database info, try profile.json or infer
            let profile_json = path.join("profile.json");
            if profile_json.exists() {
                #[derive(Deserialize)]
                struct ModrinthProfile {
                    #[serde(default)]
                    name: Option<String>,
                    #[serde(default)]
                    game_version: Option<String>,
                    #[serde(default)]
                    loader: Option<String>,
                    #[serde(default)]
                    loader_version: Option<String>,
                }

                match tokio::fs::read_to_string(&profile_json).await {
                    Ok(content) => {
                        match serde_json::from_str::<ModrinthProfile>(&content) {
                            Ok(profile) => {
                                let name = profile.name.unwrap_or_else(|| {
                                    path.file_name()
                                        .and_then(|n| n.to_str())
                                        .unwrap_or("Unknown")
                                        .to_string()
                                });
                                (
                                    name,
                                    profile.game_version.unwrap_or_else(|| "unknown".to_string()),
                                    profile.loader,
                                    profile.loader_version,
                                    None,
                                    None,
                                )
                            }
                            Err(_) => {
                                let (n, v, l, lv) = Self::infer_profile_info(path);
                                (n, v, l, lv, None, None)
                            }
                        }
                    }
                    Err(_) => {
                        let (n, v, l, lv) = Self::infer_profile_info(path);
                        (n, v, l, lv, None, None)
                    }
                }
            } else {
                let (n, v, l, lv) = Self::infer_profile_info(path);
                (n, v, l, lv, None, None)
            }
        };

        // Count mods
        let mods_dir = path.join("mods");
        let mod_count = if mods_dir.exists() {
            let mut count = 0;
            if let Ok(mut entries) = tokio::fs::read_dir(&mods_dir).await {
                while let Ok(Some(entry)) = entries.next_entry().await {
                    if entry
                        .path()
                        .extension()
                        .map_or(false, |ext| ext == "jar")
                    {
                        count += 1;
                    }
                }
            }
            Some(count)
        } else {
            None
        };

        // Check for icon.png in profile folder if not set from database
        let final_icon_path = icon_path.or_else(|| {
            let icon = path.join("icon.png");
            if icon.exists() {
                Some(icon)
            } else {
                None
            }
        });

        Ok(DetectedInstance {
            id: Uuid::new_v4().to_string(),
            launcher: LauncherType::ModrinthApp,
            name,
            path: path.clone(),
            mc_version,
            loader,
            loader_version,
            is_server: false,
            icon_path: final_icon_path,
            last_played,
            mod_count,
            estimated_size: None,
            raw_metadata: serde_json::Value::Null,
        })
    }

    /// Parse a Modrinth App profile directory (without database metadata)
    async fn parse_modrinth_profile(&self, path: &PathBuf) -> AppResult<DetectedInstance> {
        self.parse_modrinth_profile_with_db(path, None).await
    }

    /// Infer profile information from folder structure when profile.json is missing
    fn infer_profile_info(path: &PathBuf) -> (String, String, Option<String>, Option<String>) {
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Unknown")
            .to_string();

        // Try to detect loader from folder markers
        let loader = if path.join(".fabric").exists() {
            Some("fabric".to_string())
        } else if path.join(".forge").exists() {
            Some("forge".to_string())
        } else if path.join(".neoforge").exists() {
            Some("neoforge".to_string())
        } else if path.join(".quilt").exists() {
            Some("quilt".to_string())
        } else {
            None
        };

        // Try to extract version from folder name (e.g., "1.21.10 - Neoforge")
        let mc_version = Self::extract_version_from_name(&name).unwrap_or_else(|| "unknown".to_string());

        (name, mc_version, loader, None)
    }

    /// Try to extract Minecraft version from profile name
    fn extract_version_from_name(name: &str) -> Option<String> {
        // Match patterns like "1.20.4", "1.21.10", etc.
        let version_pattern = regex::Regex::new(r"(\d+\.\d+(?:\.\d+)?)").ok()?;
        version_pattern
            .captures(name)
            .and_then(|caps| caps.get(1))
            .map(|m| m.as_str().to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_loader_fabric() {
        let mut deps = HashMap::new();
        deps.insert("minecraft".to_string(), "1.20.4".to_string());
        deps.insert("fabric-loader".to_string(), "0.15.0".to_string());

        let (loader, version) = ModrinthParser::extract_loader_from_dependencies(&deps);
        assert_eq!(loader.as_deref(), Some("fabric"));
        assert_eq!(version.as_deref(), Some("0.15.0"));
    }

    #[test]
    fn test_extract_loader_forge() {
        let mut deps = HashMap::new();
        deps.insert("minecraft".to_string(), "1.20.4".to_string());
        deps.insert("forge".to_string(), "49.0.26".to_string());

        let (loader, version) = ModrinthParser::extract_loader_from_dependencies(&deps);
        assert_eq!(loader.as_deref(), Some("forge"));
        assert_eq!(version.as_deref(), Some("49.0.26"));
    }
}
