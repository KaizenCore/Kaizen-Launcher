//! Parser for CurseForge App and exported modpacks
//! Reads manifest.json from CurseForge exports

use serde::Deserialize;
use std::io::Read;
use std::path::PathBuf;
use tracing::{debug, warn};
use uuid::Uuid;
use zip::ZipArchive;

use crate::error::{AppError, AppResult};
use crate::external_import::{
    detection::get_curseforge_paths, DetectedInstance, LauncherParser, LauncherType, ModFile,
};

/// Parser for CurseForge App and exported modpacks
pub struct CurseForgeParser;

/// Structure of manifest.json in CurseForge exports
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CurseForgeManifest {
    minecraft: CurseForgeMinecraft,
    #[serde(default)]
    manifest_type: Option<String>,
    #[serde(default)]
    manifest_version: Option<u32>,
    name: String,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    author: Option<String>,
    files: Vec<CurseForgeFile>,
    #[serde(default)]
    overrides: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CurseForgeMinecraft {
    version: String,
    mod_loaders: Vec<CurseForgeModLoader>,
}

#[derive(Debug, Deserialize)]
struct CurseForgeModLoader {
    id: String,
    #[serde(default)]
    primary: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CurseForgeFile {
    #[serde(rename = "projectID")]
    project_id: u64,
    #[serde(rename = "fileID")]
    file_id: u64,
    #[serde(default)]
    required: Option<bool>,
}

/// Structure for CurseForge App's minecraftinstance.json
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CurseForgeInstance {
    name: String,
    #[serde(default)]
    game_version: Option<String>,
    #[serde(default)]
    install_path: Option<String>,
    #[serde(default)]
    last_played: Option<String>,
    #[serde(default)]
    base_mod_loader: Option<CurseForgeBaseModLoader>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CurseForgeBaseModLoader {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    minecraft_version: Option<String>,
    #[serde(default)]
    forge_version: Option<String>,
}

impl CurseForgeParser {
    /// Parse modloader from CurseForge format
    /// Examples: "forge-49.0.26", "fabric-0.15.0", "neoforge-20.4.0"
    fn parse_modloader(id: &str) -> (Option<String>, Option<String>) {
        if let Some(idx) = id.find('-') {
            let loader = id[..idx].to_lowercase();
            let version = id[idx + 1..].to_string();
            (Some(loader), Some(version))
        } else {
            (None, None)
        }
    }

    /// Read manifest.json from a CurseForge .zip export
    fn read_manifest_from_zip(path: &PathBuf) -> AppResult<CurseForgeManifest> {
        let file = std::fs::File::open(path)
            .map_err(|e| AppError::ExternalImport(format!("Failed to open zip: {}", e)))?;

        let mut archive = ZipArchive::new(file)
            .map_err(|e| AppError::ExternalImport(format!("Invalid zip archive: {}", e)))?;

        let mut manifest_file = archive.by_name("manifest.json").map_err(|_| {
            AppError::ExternalImport("Missing manifest.json in CurseForge zip".to_string())
        })?;

        let mut content = String::new();
        manifest_file
            .read_to_string(&mut content)
            .map_err(|e| AppError::ExternalImport(format!("Failed to read manifest: {}", e)))?;

        serde_json::from_str(&content)
            .map_err(|e| AppError::ExternalImport(format!("Invalid manifest.json: {}", e)))
    }

    /// Calculate directory size recursively
    async fn calculate_dir_size(path: &PathBuf) -> u64 {
        let mut size = 0u64;
        if let Ok(mut entries) = tokio::fs::read_dir(path).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                if let Ok(metadata) = entry.metadata().await {
                    if metadata.is_file() {
                        size += metadata.len();
                    } else if metadata.is_dir() {
                        size += Box::pin(Self::calculate_dir_size(&entry.path())).await;
                    }
                }
            }
        }
        size
    }

    /// Count mods in a directory
    async fn count_mods(mods_dir: &PathBuf) -> usize {
        let mut count = 0;
        if let Ok(mut entries) = tokio::fs::read_dir(mods_dir).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                let path = entry.path();
                if path.extension().map_or(false, |ext| ext == "jar") {
                    count += 1;
                }
            }
        }
        count
    }
}

#[async_trait::async_trait]
impl LauncherParser for CurseForgeParser {
    fn launcher_type(&self) -> LauncherType {
        LauncherType::CurseForge
    }

    fn default_paths(&self) -> Vec<PathBuf> {
        get_curseforge_paths()
    }

    async fn detect(&self, path: &PathBuf) -> bool {
        // Check if this is a CurseForge .zip export
        if path.is_file() && path.extension().map_or(false, |ext| ext == "zip") {
            if let Ok(file) = std::fs::File::open(path) {
                if let Ok(mut archive) = ZipArchive::new(file) {
                    return archive.by_name("manifest.json").is_ok();
                }
            }
            return false;
        }

        // Check if this is a CurseForge instances directory
        if path.is_dir() {
            // Look for minecraftinstance.json files in subdirectories
            if let Ok(mut entries) = std::fs::read_dir(path) {
                return entries.any(|e| {
                    e.ok()
                        .and_then(|entry| {
                            let p = entry.path();
                            if p.is_dir() {
                                Some(p.join("minecraftinstance.json").exists())
                            } else {
                                None
                            }
                        })
                        .unwrap_or(false)
                });
            }
        }

        false
    }

    async fn parse_instances(&self, path: &PathBuf) -> AppResult<Vec<DetectedInstance>> {
        // If this is a .zip file, parse it directly
        if path.is_file() && path.extension().map_or(false, |ext| ext == "zip") {
            let instance = self.parse_single(path).await?;
            return Ok(vec![instance]);
        }

        // Otherwise, scan CurseForge instances directory
        let mut instances = Vec::new();

        if !path.is_dir() {
            return Ok(instances);
        }

        let mut entries = tokio::fs::read_dir(path)
            .await
            .map_err(|e| AppError::ExternalImport(format!("Failed to read instances: {}", e)))?;

        while let Some(entry) = entries.next_entry().await.map_err(|e| {
            AppError::ExternalImport(format!("Failed to read entry: {}", e))
        })? {
            let instance_path = entry.path();

            if !instance_path.is_dir() {
                continue;
            }

            // Check for minecraftinstance.json
            let instance_json = instance_path.join("minecraftinstance.json");
            if !instance_json.exists() {
                continue;
            }

            match self.parse_curseforge_instance(&instance_path).await {
                Ok(instance) => instances.push(instance),
                Err(e) => {
                    warn!(
                        "Failed to parse CurseForge instance at {:?}: {}",
                        instance_path, e
                    );
                }
            }
        }

        debug!("Found {} CurseForge instances", instances.len());
        Ok(instances)
    }

    async fn parse_single(&self, path: &PathBuf) -> AppResult<DetectedInstance> {
        // Handle .zip exports
        if path.is_file() && path.extension().map_or(false, |ext| ext == "zip") {
            let manifest = Self::read_manifest_from_zip(path)?;

            let mc_version = manifest.minecraft.version;

            // Get modloader from first (primary) loader
            let (loader, loader_version) = manifest
                .minecraft
                .mod_loaders
                .first()
                .map(|ml| Self::parse_modloader(&ml.id))
                .unwrap_or((None, None));

            let mod_count = Some(manifest.files.len());

            return Ok(DetectedInstance {
                id: Uuid::new_v4().to_string(),
                launcher: LauncherType::CurseForge,
                name: manifest.name,
                path: path.clone(),
                mc_version,
                loader,
                loader_version,
                is_server: false,
                icon_path: None,
                last_played: None,
                mod_count,
                estimated_size: None,
                raw_metadata: serde_json::json!({
                    "manifest_type": manifest.manifest_type,
                    "manifest_version": manifest.manifest_version,
                    "author": manifest.author,
                    "version": manifest.version,
                }),
            });
        }

        // Handle CurseForge App instance directory
        self.parse_curseforge_instance(path).await
    }

    async fn scan_mods(&self, instance_path: &PathBuf) -> AppResult<Vec<ModFile>> {
        // For .zip exports, we can only get project/file IDs, not actual files
        if instance_path.is_file()
            && instance_path
                .extension()
                .map_or(false, |ext| ext == "zip")
        {
            let manifest = Self::read_manifest_from_zip(instance_path)?;

            // CurseForge exports only contain project/file IDs, not actual files
            // We return empty ModFile entries with IDs for reference
            let mods: Vec<ModFile> = manifest
                .files
                .iter()
                .map(|f| ModFile {
                    filename: format!("curseforge_{}_{}.jar", f.project_id, f.file_id),
                    path: PathBuf::new(),
                    sha1: None,
                    sha512: None,
                    size: 0,
                    modrinth_project_id: None,
                    modrinth_version_id: None,
                    modrinth_project_name: None,
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

impl CurseForgeParser {
    /// Parse a CurseForge App instance directory
    async fn parse_curseforge_instance(&self, path: &PathBuf) -> AppResult<DetectedInstance> {
        let instance_json = path.join("minecraftinstance.json");
        let content = tokio::fs::read_to_string(&instance_json)
            .await
            .map_err(|e| {
                AppError::ExternalImport(format!("Failed to read minecraftinstance.json: {}", e))
            })?;

        let instance: CurseForgeInstance = serde_json::from_str(&content).map_err(|e| {
            AppError::ExternalImport(format!("Invalid minecraftinstance.json: {}", e))
        })?;

        let mc_version = instance
            .game_version
            .or_else(|| {
                instance
                    .base_mod_loader
                    .as_ref()
                    .and_then(|ml| ml.minecraft_version.clone())
            })
            .unwrap_or_else(|| "unknown".to_string());

        let (loader, loader_version) = if let Some(base_loader) = &instance.base_mod_loader {
            let loader_name = base_loader.name.as_deref().map(|n| n.to_lowercase());
            let loader_ver = base_loader.forge_version.clone();
            (loader_name, loader_ver)
        } else {
            (None, None)
        };

        let mods_dir = path.join("mods");
        let mod_count = if mods_dir.exists() {
            Some(Self::count_mods(&mods_dir).await)
        } else {
            None
        };

        let estimated_size = Some(Self::calculate_dir_size(path).await);

        Ok(DetectedInstance {
            id: Uuid::new_v4().to_string(),
            launcher: LauncherType::CurseForge,
            name: instance.name,
            path: path.clone(),
            mc_version,
            loader,
            loader_version,
            is_server: false,
            icon_path: None,
            last_played: instance.last_played,
            mod_count,
            estimated_size,
            raw_metadata: serde_json::Value::Null,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_modloader_forge() {
        let (loader, version) = CurseForgeParser::parse_modloader("forge-49.0.26");
        assert_eq!(loader.as_deref(), Some("forge"));
        assert_eq!(version.as_deref(), Some("49.0.26"));
    }

    #[test]
    fn test_parse_modloader_fabric() {
        let (loader, version) = CurseForgeParser::parse_modloader("fabric-0.15.0");
        assert_eq!(loader.as_deref(), Some("fabric"));
        assert_eq!(version.as_deref(), Some("0.15.0"));
    }
}
