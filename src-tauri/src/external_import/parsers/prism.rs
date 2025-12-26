//! Parser for Prism Launcher and MultiMC
//! Reads instance.cfg and mmc-pack.json to detect instances

use serde::Deserialize;
use std::collections::HashMap;
use std::path::PathBuf;
use tracing::{debug, warn};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::external_import::{
    detection::{get_multimc_paths, get_prism_launcher_paths},
    DetectedInstance, LauncherParser, LauncherType, ModFile,
};

/// Parser for Prism Launcher and MultiMC (they share the same format)
pub struct PrismParser {
    launcher_type: LauncherType,
}

impl PrismParser {
    pub fn new_prism() -> Self {
        Self {
            launcher_type: LauncherType::PrismLauncher,
        }
    }

    pub fn new_multimc() -> Self {
        Self {
            launcher_type: LauncherType::MultiMC,
        }
    }
}

/// Structure of mmc-pack.json
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MmcPack {
    #[serde(default)]
    components: Vec<MmcComponent>,
    #[serde(default)]
    format_version: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct MmcComponent {
    uid: String,
    version: String,
    #[serde(default)]
    important: Option<bool>,
    #[serde(default)]
    dependency_only: Option<bool>,
    #[serde(default)]
    cached_name: Option<String>,
}

impl PrismParser {
    /// Parse an INI-style config file (instance.cfg)
    async fn parse_ini(path: &PathBuf) -> AppResult<HashMap<String, String>> {
        let content = tokio::fs::read_to_string(path)
            .await
            .map_err(|e| AppError::ExternalImport(format!("Failed to read config: {}", e)))?;

        let mut config = HashMap::new();

        for line in content.lines() {
            let line = line.trim();

            // Skip comments and empty lines
            if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
                continue;
            }

            // Parse key=value
            if let Some(eq_idx) = line.find('=') {
                let key = line[..eq_idx].trim().to_string();
                let value = line[eq_idx + 1..].trim().to_string();
                config.insert(key, value);
            }
        }

        Ok(config)
    }

    /// Parse mmc-pack.json to extract Minecraft version and loader info
    async fn parse_mmc_pack(
        path: &PathBuf,
    ) -> AppResult<(String, Option<String>, Option<String>)> {
        let content = tokio::fs::read_to_string(path)
            .await
            .map_err(|e| AppError::ExternalImport(format!("Failed to read mmc-pack.json: {}", e)))?;

        let pack: MmcPack = serde_json::from_str(&content)
            .map_err(|e| AppError::ExternalImport(format!("Invalid mmc-pack.json: {}", e)))?;

        let mut mc_version = "unknown".to_string();
        let mut loader: Option<String> = None;
        let mut loader_version: Option<String> = None;

        for component in pack.components {
            match component.uid.as_str() {
                "net.minecraft" => {
                    mc_version = component.version;
                }
                "net.fabricmc.fabric-loader" => {
                    loader = Some("fabric".to_string());
                    loader_version = Some(component.version);
                }
                "net.minecraftforge" => {
                    loader = Some("forge".to_string());
                    loader_version = Some(component.version);
                }
                "net.neoforged" | "net.neoforged.neoforge" => {
                    loader = Some("neoforge".to_string());
                    loader_version = Some(component.version);
                }
                "org.quiltmc.quilt-loader" => {
                    loader = Some("quilt".to_string());
                    loader_version = Some(component.version);
                }
                _ => {}
            }
        }

        Ok((mc_version, loader, loader_version))
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
impl LauncherParser for PrismParser {
    fn launcher_type(&self) -> LauncherType {
        self.launcher_type
    }

    fn default_paths(&self) -> Vec<PathBuf> {
        match self.launcher_type {
            LauncherType::PrismLauncher => get_prism_launcher_paths(),
            LauncherType::MultiMC => get_multimc_paths(),
            _ => Vec::new(),
        }
    }

    async fn detect(&self, path: &PathBuf) -> bool {
        // Check for instances folder
        let instances_dir = path.join("instances");
        instances_dir.exists() && instances_dir.is_dir()
    }

    async fn parse_instances(&self, path: &PathBuf) -> AppResult<Vec<DetectedInstance>> {
        let instances_dir = path.join("instances");
        if !instances_dir.exists() {
            return Err(AppError::ExternalImport(
                "No instances folder found".to_string(),
            ));
        }

        debug!("Scanning Prism/MultiMC instances in {:?}", instances_dir);

        let mut instances = Vec::new();
        let mut entries = tokio::fs::read_dir(&instances_dir)
            .await
            .map_err(|e| AppError::ExternalImport(format!("Failed to read instances: {}", e)))?;

        while let Some(entry) = entries.next_entry().await.map_err(|e| {
            AppError::ExternalImport(format!("Failed to read instance entry: {}", e))
        })? {
            let instance_path = entry.path();

            // Skip non-directories
            if !instance_path.is_dir() {
                continue;
            }

            // Check for instance.cfg
            let cfg_path = instance_path.join("instance.cfg");
            if !cfg_path.exists() {
                debug!("Skipping {:?}: no instance.cfg", instance_path);
                continue;
            }

            // Parse instance.cfg
            let cfg = match Self::parse_ini(&cfg_path).await {
                Ok(c) => c,
                Err(e) => {
                    warn!("Failed to parse instance.cfg at {:?}: {}", cfg_path, e);
                    continue;
                }
            };

            let name = cfg
                .get("name")
                .cloned()
                .unwrap_or_else(|| {
                    instance_path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("Unknown")
                        .to_string()
                });

            // Parse mmc-pack.json for components
            let pack_path = instance_path.join("mmc-pack.json");
            let (mc_version, loader, loader_version) = if pack_path.exists() {
                match Self::parse_mmc_pack(&pack_path).await {
                    Ok(info) => info,
                    Err(e) => {
                        warn!("Failed to parse mmc-pack.json: {}", e);
                        ("unknown".to_string(), None, None)
                    }
                }
            } else {
                ("unknown".to_string(), None, None)
            };

            // The game directory is .minecraft inside the instance folder
            let game_dir = instance_path.join(".minecraft");
            let actual_game_dir = if game_dir.exists() {
                game_dir
            } else {
                // Some instances might use minecraft folder directly
                instance_path.join("minecraft")
            };

            // Count mods
            let mods_dir = actual_game_dir.join("mods");
            let mod_count = if mods_dir.exists() {
                Some(Self::count_mods(&mods_dir).await)
            } else {
                None
            };

            // Estimate size
            let estimated_size = Some(Self::calculate_dir_size(&instance_path).await);

            // Get last launch time from config
            let last_played = cfg.get("lastLaunchTime").cloned();

            // Check for icon
            let icon_path = cfg.get("iconKey").and_then(|icon_key| {
                let icons_dir = path.join("icons");
                let png_path = icons_dir.join(format!("{}.png", icon_key));
                if png_path.exists() {
                    Some(png_path)
                } else {
                    None
                }
            });

            instances.push(DetectedInstance {
                id: Uuid::new_v4().to_string(),
                launcher: self.launcher_type,
                name,
                path: actual_game_dir.clone(),
                mc_version,
                loader,
                loader_version,
                is_server: false,
                icon_path,
                last_played,
                mod_count,
                estimated_size,
                raw_metadata: serde_json::to_value(&cfg).unwrap_or_default(),
            });
        }

        debug!(
            "Found {} instances in {:?}",
            instances.len(),
            self.launcher_type
        );
        Ok(instances)
    }

    async fn parse_single(&self, path: &PathBuf) -> AppResult<DetectedInstance> {
        // For manual import, expect an instance folder with instance.cfg
        let cfg_path = path.join("instance.cfg");

        if cfg_path.exists() {
            // This is a Prism/MultiMC instance folder
            let cfg = Self::parse_ini(&cfg_path).await?;

            let name = cfg
                .get("name")
                .cloned()
                .unwrap_or_else(|| {
                    path.file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("Unknown")
                        .to_string()
                });

            let pack_path = path.join("mmc-pack.json");
            let (mc_version, loader, loader_version) = if pack_path.exists() {
                Self::parse_mmc_pack(&pack_path).await?
            } else {
                ("unknown".to_string(), None, None)
            };

            let game_dir = path.join(".minecraft");
            let actual_game_dir = if game_dir.exists() {
                game_dir
            } else {
                path.clone()
            };

            let mods_dir = actual_game_dir.join("mods");
            let mod_count = if mods_dir.exists() {
                Some(Self::count_mods(&mods_dir).await)
            } else {
                None
            };

            let estimated_size = Some(Self::calculate_dir_size(path).await);

            Ok(DetectedInstance {
                id: Uuid::new_v4().to_string(),
                launcher: self.launcher_type,
                name,
                path: actual_game_dir,
                mc_version,
                loader,
                loader_version,
                is_server: false,
                icon_path: None,
                last_played: cfg.get("lastLaunchTime").cloned(),
                mod_count,
                estimated_size,
                raw_metadata: serde_json::to_value(&cfg).unwrap_or_default(),
            })
        } else {
            // Just a game directory
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("Unknown")
                .to_string();

            let mods_dir = path.join("mods");
            let mod_count = if mods_dir.exists() {
                Some(Self::count_mods(&mods_dir).await)
            } else {
                None
            };

            let estimated_size = Some(Self::calculate_dir_size(path).await);

            Ok(DetectedInstance {
                id: Uuid::new_v4().to_string(),
                launcher: self.launcher_type,
                name,
                path: path.clone(),
                mc_version: "unknown".to_string(),
                loader: None,
                loader_version: None,
                is_server: false,
                icon_path: None,
                last_played: None,
                mod_count,
                estimated_size,
                raw_metadata: serde_json::Value::Null,
            })
        }
    }

    async fn scan_mods(&self, instance_path: &PathBuf) -> AppResult<Vec<ModFile>> {
        let mods_dir = instance_path.join("mods");
        if !mods_dir.exists() {
            return Ok(Vec::new());
        }

        let mut mods = Vec::new();
        let mut entries = tokio::fs::read_dir(&mods_dir)
            .await
            .map_err(|e| AppError::ExternalImport(format!("Failed to read mods dir: {}", e)))?;

        while let Some(entry) = entries.next_entry().await.map_err(|e| {
            AppError::ExternalImport(format!("Failed to read entry: {}", e))
        })? {
            let path = entry.path();

            // Only include .jar files
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

        debug!("Found {} mods in {:?}", mods.len(), mods_dir);
        Ok(mods)
    }

    fn get_game_dir(&self, instance_path: &PathBuf) -> PathBuf {
        let minecraft_dir = instance_path.join(".minecraft");
        if minecraft_dir.exists() {
            minecraft_dir
        } else {
            instance_path.clone()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_parse_ini_simple() {
        // This test would need a temp file - skipping for now
    }
}
