//! Parser for the Official Minecraft Launcher
//! Reads launcher_profiles.json to detect profiles/instances

use serde::Deserialize;
use std::collections::HashMap;
use std::path::PathBuf;
use tracing::{debug, warn};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::external_import::{
    detection::get_minecraft_launcher_path, DetectedInstance, LauncherParser, LauncherType,
    ModFile,
};

/// Parser for the Official Minecraft Launcher
pub struct MinecraftLauncherParser;

/// Structure of launcher_profiles.json
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LauncherProfiles {
    profiles: HashMap<String, MinecraftProfile>,
    #[serde(default)]
    settings: Option<LauncherSettings>,
}

#[derive(Debug, Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct MinecraftProfile {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    game_dir: Option<String>,
    #[serde(default)]
    last_version_id: Option<String>,
    #[serde(default)]
    java_dir: Option<String>,
    #[serde(default)]
    java_args: Option<String>,
    #[serde(default)]
    last_used: Option<String>,
    #[serde(default)]
    icon: Option<String>,
    #[serde(rename = "type", default)]
    profile_type: Option<String>,
    #[serde(default)]
    resolution: Option<Resolution>,
}

#[derive(Debug, Deserialize, serde::Serialize)]
struct Resolution {
    #[serde(default)]
    width: Option<u32>,
    #[serde(default)]
    height: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LauncherSettings {
    #[serde(default)]
    enable_snapshots: Option<bool>,
    #[serde(default)]
    enable_historical: Option<bool>,
}

impl MinecraftLauncherParser {
    /// Parse version ID to extract Minecraft version and modloader info
    /// Examples:
    /// - "1.20.4" -> ("1.20.4", None, None)
    /// - "1.20.4-forge-49.0.26" -> ("1.20.4", Some("forge"), Some("49.0.26"))
    /// - "fabric-loader-0.15.0-1.20.4" -> ("1.20.4", Some("fabric"), Some("0.15.0"))
    fn parse_version_id(version_id: Option<&str>) -> (String, Option<String>, Option<String>) {
        let version_id = match version_id {
            Some(v) => v,
            None => return ("unknown".to_string(), None, None),
        };

        // Check for Forge format: "1.20.4-forge-49.0.26"
        if let Some(forge_idx) = version_id.find("-forge-") {
            let mc_version = version_id[..forge_idx].to_string();
            let loader_version = version_id[forge_idx + 7..].to_string();
            return (mc_version, Some("forge".to_string()), Some(loader_version));
        }

        // Check for NeoForge format: "1.20.4-neoforge-20.4.0"
        if let Some(neoforge_idx) = version_id.find("-neoforge-") {
            let mc_version = version_id[..neoforge_idx].to_string();
            let loader_version = version_id[neoforge_idx + 10..].to_string();
            return (
                mc_version,
                Some("neoforge".to_string()),
                Some(loader_version),
            );
        }

        // Check for Fabric format: "fabric-loader-0.15.0-1.20.4"
        if version_id.starts_with("fabric-loader-") {
            let rest = &version_id[14..]; // After "fabric-loader-"
            if let Some(dash_idx) = rest.rfind('-') {
                let loader_version = rest[..dash_idx].to_string();
                let mc_version = rest[dash_idx + 1..].to_string();
                return (mc_version, Some("fabric".to_string()), Some(loader_version));
            }
        }

        // Check for Quilt format: "quilt-loader-0.23.0-1.20.4"
        if version_id.starts_with("quilt-loader-") {
            let rest = &version_id[13..];
            if let Some(dash_idx) = rest.rfind('-') {
                let loader_version = rest[..dash_idx].to_string();
                let mc_version = rest[dash_idx + 1..].to_string();
                return (mc_version, Some("quilt".to_string()), Some(loader_version));
            }
        }

        // Plain version (vanilla)
        (version_id.to_string(), None, None)
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
impl LauncherParser for MinecraftLauncherParser {
    fn launcher_type(&self) -> LauncherType {
        LauncherType::MinecraftOfficial
    }

    fn default_paths(&self) -> Vec<PathBuf> {
        get_minecraft_launcher_path().into_iter().collect()
    }

    async fn detect(&self, path: &PathBuf) -> bool {
        // Check for launcher_profiles.json or launcher_profiles_microsoft_store.json
        path.join("launcher_profiles.json").exists()
            || path.join("launcher_profiles_microsoft_store.json").exists()
    }

    async fn parse_instances(&self, path: &PathBuf) -> AppResult<Vec<DetectedInstance>> {
        // Try both possible profile file names
        let profiles_path = if path.join("launcher_profiles.json").exists() {
            path.join("launcher_profiles.json")
        } else if path.join("launcher_profiles_microsoft_store.json").exists() {
            path.join("launcher_profiles_microsoft_store.json")
        } else {
            return Err(AppError::ExternalImport(
                "No launcher_profiles.json found".to_string(),
            ));
        };

        debug!("Reading Minecraft profiles from {:?}", profiles_path);

        let content = tokio::fs::read_to_string(&profiles_path)
            .await
            .map_err(|e| AppError::ExternalImport(format!("Failed to read profiles: {}", e)))?;

        let profiles: LauncherProfiles = serde_json::from_str(&content)
            .map_err(|e| AppError::ExternalImport(format!("Invalid profiles JSON: {}", e)))?;

        let mut instances = Vec::new();

        for (id, profile) in profiles.profiles {
            // Skip virtual profiles (latest-release, latest-snapshot)
            match profile.profile_type.as_deref() {
                Some("latest-release") | Some("latest-snapshot") => {
                    debug!("Skipping virtual profile: {}", id);
                    continue;
                }
                _ => {}
            }

            let name = profile.name.clone().unwrap_or_else(|| id.clone());

            // Determine game directory
            let game_dir = match &profile.game_dir {
                Some(dir) => PathBuf::from(dir),
                None => path.clone(), // Default to .minecraft root
            };

            // Parse version to get MC version and loader
            let (mc_version, loader, loader_version) =
                Self::parse_version_id(profile.last_version_id.as_deref());

            // Count mods if mods folder exists
            let mods_dir = game_dir.join("mods");
            let mod_count = if mods_dir.exists() {
                Some(Self::count_mods(&mods_dir).await)
            } else {
                None
            };

            // Estimate size
            let estimated_size = if game_dir.exists() {
                Some(Self::calculate_dir_size(&game_dir).await)
            } else {
                None
            };

            instances.push(DetectedInstance {
                id: Uuid::new_v4().to_string(),
                launcher: LauncherType::MinecraftOfficial,
                name,
                path: game_dir,
                mc_version,
                loader,
                loader_version,
                is_server: false,
                icon_path: None, // Minecraft uses base64 encoded icons, not files
                last_played: profile.last_used.clone(),
                mod_count,
                estimated_size,
                raw_metadata: serde_json::to_value(&profile).unwrap_or_default(),
            });
        }

        debug!(
            "Found {} profiles in Minecraft Launcher",
            instances.len()
        );
        Ok(instances)
    }

    async fn parse_single(&self, path: &PathBuf) -> AppResult<DetectedInstance> {
        // For manual import, we expect a game directory with mods
        if !path.is_dir() {
            return Err(AppError::ExternalImport(
                "Path must be a directory".to_string(),
            ));
        }

        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Unknown")
            .to_string();

        // Try to detect version from version folder or mods
        let mc_version = "unknown".to_string();
        let loader = None;
        let loader_version = None;

        let mods_dir = path.join("mods");
        let mod_count = if mods_dir.exists() {
            Some(Self::count_mods(&mods_dir).await)
        } else {
            None
        };

        let estimated_size = Some(Self::calculate_dir_size(path).await);

        Ok(DetectedInstance {
            id: Uuid::new_v4().to_string(),
            launcher: LauncherType::MinecraftOfficial,
            name,
            path: path.clone(),
            mc_version,
            loader,
            loader_version,
            is_server: false,
            icon_path: None,
            last_played: None,
            mod_count,
            estimated_size,
            raw_metadata: serde_json::Value::Null,
        })
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

        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|e| AppError::ExternalImport(format!("Failed to read entry: {}", e)))?
        {
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
                sha1: None,   // Will be computed by mod_resolver
                sha512: None, // Will be computed by mod_resolver
                size,
                modrinth_project_id: None,
                modrinth_version_id: None,
                modrinth_project_name: None,
            });
        }

        debug!("Found {} mods in {:?}", mods.len(), mods_dir);
        Ok(mods)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_version_vanilla() {
        let (mc, loader, version) = MinecraftLauncherParser::parse_version_id(Some("1.20.4"));
        assert_eq!(mc, "1.20.4");
        assert!(loader.is_none());
        assert!(version.is_none());
    }

    #[test]
    fn test_parse_version_forge() {
        let (mc, loader, version) =
            MinecraftLauncherParser::parse_version_id(Some("1.20.4-forge-49.0.26"));
        assert_eq!(mc, "1.20.4");
        assert_eq!(loader.as_deref(), Some("forge"));
        assert_eq!(version.as_deref(), Some("49.0.26"));
    }

    #[test]
    fn test_parse_version_fabric() {
        let (mc, loader, version) =
            MinecraftLauncherParser::parse_version_id(Some("fabric-loader-0.15.0-1.20.4"));
        assert_eq!(mc, "1.20.4");
        assert_eq!(loader.as_deref(), Some("fabric"));
        assert_eq!(version.as_deref(), Some("0.15.0"));
    }

    #[test]
    fn test_parse_version_neoforge() {
        let (mc, loader, version) =
            MinecraftLauncherParser::parse_version_id(Some("1.20.4-neoforge-20.4.0"));
        assert_eq!(mc, "1.20.4");
        assert_eq!(loader.as_deref(), Some("neoforge"));
        assert_eq!(version.as_deref(), Some("20.4.0"));
    }
}
