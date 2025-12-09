use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tokio::fs;

const VERSION_MANIFEST_URL: &str =
    "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionManifest {
    pub latest: LatestVersions,
    pub versions: Vec<VersionInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LatestVersions {
    pub release: String,
    pub snapshot: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionInfo {
    pub id: String,
    #[serde(rename = "type")]
    pub version_type: VersionType,
    pub url: String,
    pub time: String,
    pub release_time: String,
    #[serde(default)]
    pub sha1: String,
    #[serde(default)]
    pub compliance_level: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum VersionType {
    Release,
    Snapshot,
    OldBeta,
    OldAlpha,
}

impl std::fmt::Display for VersionType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            VersionType::Release => write!(f, "release"),
            VersionType::Snapshot => write!(f, "snapshot"),
            VersionType::OldBeta => write!(f, "old_beta"),
            VersionType::OldAlpha => write!(f, "old_alpha"),
        }
    }
}

/// Full version details (from individual version JSON)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionDetails {
    pub id: String,
    #[serde(rename = "type")]
    pub version_type: VersionType,
    pub main_class: String,
    pub minecraft_arguments: Option<String>,
    pub arguments: Option<Arguments>,
    pub asset_index: AssetIndex,
    pub assets: String,
    pub downloads: Downloads,
    pub libraries: Vec<Library>,
    pub java_version: Option<JavaVersion>,
    pub release_time: String,
    pub time: String,
    #[serde(default)]
    pub compliance_level: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Arguments {
    pub game: Vec<ArgumentValue>,
    pub jvm: Vec<ArgumentValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ArgumentValue {
    Simple(String),
    Conditional {
        rules: Vec<Rule>,
        value: StringOrArray,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum StringOrArray {
    String(String),
    Array(Vec<String>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rule {
    pub action: String,
    pub os: Option<OsRule>,
    pub features: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OsRule {
    pub name: Option<String>,
    pub arch: Option<String>,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetIndex {
    pub id: String,
    pub sha1: String,
    pub size: u64,
    pub total_size: u64,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Downloads {
    pub client: DownloadInfo,
    pub client_mappings: Option<DownloadInfo>,
    pub server: Option<DownloadInfo>,
    pub server_mappings: Option<DownloadInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadInfo {
    pub sha1: String,
    pub size: u64,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Library {
    pub name: String,
    pub downloads: Option<LibraryDownloads>,
    pub rules: Option<Vec<Rule>>,
    pub natives: Option<serde_json::Value>,
    pub extract: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryDownloads {
    pub artifact: Option<LibraryArtifact>,
    pub classifiers: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryArtifact {
    pub path: String,
    pub sha1: String,
    pub size: u64,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaVersion {
    pub component: String,
    pub major_version: i32,
}

/// Fetch the version manifest from Mojang
pub async fn fetch_version_manifest(client: &reqwest::Client) -> AppResult<VersionManifest> {
    let response = client
        .get(VERSION_MANIFEST_URL)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("Failed to fetch version manifest: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::Network(format!(
            "Failed to fetch version manifest: HTTP {}",
            response.status()
        )));
    }

    let manifest: VersionManifest = response
        .json()
        .await
        .map_err(|e| AppError::Network(format!("Failed to parse version manifest: {}", e)))?;

    Ok(manifest)
}

/// Fetch full version details from the version URL
pub async fn fetch_version_details(
    client: &reqwest::Client,
    version_url: &str,
) -> AppResult<VersionDetails> {
    let response = client
        .get(version_url)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("Failed to fetch version details: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::Network(format!(
            "Failed to fetch version details: HTTP {}",
            response.status()
        )));
    }

    let details: VersionDetails = response
        .json()
        .await
        .map_err(|e| AppError::Network(format!("Failed to parse version details: {}", e)))?;

    Ok(details)
}

/// Cache the version manifest locally
pub async fn cache_version_manifest(data_dir: &Path, manifest: &VersionManifest) -> AppResult<()> {
    let cache_dir = data_dir.join("cache");
    fs::create_dir_all(&cache_dir)
        .await
        .map_err(|e| AppError::Io(format!("Failed to create cache directory: {}", e)))?;

    let cache_file = cache_dir.join("version_manifest.json");
    let json = serde_json::to_string_pretty(manifest)
        .map_err(|e| AppError::Io(format!("Failed to serialize manifest: {}", e)))?;

    fs::write(&cache_file, json)
        .await
        .map_err(|e| AppError::Io(format!("Failed to write manifest cache: {}", e)))?;

    Ok(())
}

/// Load cached version manifest
pub async fn load_cached_manifest(data_dir: &Path) -> AppResult<Option<VersionManifest>> {
    let cache_file = data_dir.join("cache").join("version_manifest.json");

    if !cache_file.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&cache_file)
        .await
        .map_err(|e| AppError::Io(format!("Failed to read manifest cache: {}", e)))?;

    let manifest: VersionManifest = serde_json::from_str(&content)
        .map_err(|e| AppError::Io(format!("Failed to parse manifest cache: {}", e)))?;

    Ok(Some(manifest))
}

/// Save version details to the versions directory
pub async fn save_version_details(
    data_dir: &Path,
    version_id: &str,
    details: &VersionDetails,
) -> AppResult<()> {
    let versions_dir = data_dir.join("versions").join(version_id);
    fs::create_dir_all(&versions_dir)
        .await
        .map_err(|e| AppError::Io(format!("Failed to create version directory: {}", e)))?;

    let version_file = versions_dir.join(format!("{}.json", version_id));
    let json = serde_json::to_string_pretty(details)
        .map_err(|e| AppError::Io(format!("Failed to serialize version details: {}", e)))?;

    fs::write(&version_file, json)
        .await
        .map_err(|e| AppError::Io(format!("Failed to write version details: {}", e)))?;

    Ok(())
}

/// Load saved version details
pub async fn load_version_details(
    data_dir: &Path,
    version_id: &str,
) -> AppResult<Option<VersionDetails>> {
    let version_file = data_dir
        .join("versions")
        .join(version_id)
        .join(format!("{}.json", version_id));

    if !version_file.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&version_file)
        .await
        .map_err(|e| AppError::Io(format!("Failed to read version details: {}", e)))?;

    let details: VersionDetails = serde_json::from_str(&content)
        .map_err(|e| AppError::Io(format!("Failed to parse version details: {}", e)))?;

    Ok(Some(details))
}

/// Filter versions based on settings
pub fn filter_versions(versions: &[VersionInfo], include_snapshots: bool) -> Vec<VersionInfo> {
    versions
        .iter()
        .filter(|v| {
            if include_snapshots {
                matches!(v.version_type, VersionType::Release | VersionType::Snapshot)
            } else {
                matches!(v.version_type, VersionType::Release)
            }
        })
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_version(id: &str, version_type: VersionType) -> VersionInfo {
        VersionInfo {
            id: id.to_string(),
            version_type,
            url: format!("https://example.com/{}.json", id),
            time: "2024-01-01T00:00:00+00:00".to_string(),
            release_time: "2024-01-01T00:00:00+00:00".to_string(),
            sha1: "abc123".to_string(),
            compliance_level: 1,
        }
    }

    #[test]
    fn test_filter_versions_releases_only() {
        let versions = vec![
            create_test_version("1.20.4", VersionType::Release),
            create_test_version("24w01a", VersionType::Snapshot),
            create_test_version("1.20.3", VersionType::Release),
            create_test_version("b1.8.1", VersionType::OldBeta),
        ];

        let filtered = filter_versions(&versions, false);

        assert_eq!(filtered.len(), 2);
        assert!(filtered
            .iter()
            .all(|v| v.version_type == VersionType::Release));
        assert_eq!(filtered[0].id, "1.20.4");
        assert_eq!(filtered[1].id, "1.20.3");
    }

    #[test]
    fn test_filter_versions_with_snapshots() {
        let versions = vec![
            create_test_version("1.20.4", VersionType::Release),
            create_test_version("24w01a", VersionType::Snapshot),
            create_test_version("1.20.3", VersionType::Release),
            create_test_version("b1.8.1", VersionType::OldBeta),
            create_test_version("a1.0.0", VersionType::OldAlpha),
        ];

        let filtered = filter_versions(&versions, true);

        assert_eq!(filtered.len(), 3);
        assert!(filtered
            .iter()
            .all(|v| { matches!(v.version_type, VersionType::Release | VersionType::Snapshot) }));
    }

    #[test]
    fn test_filter_versions_empty() {
        let versions: Vec<VersionInfo> = vec![];
        let filtered = filter_versions(&versions, false);
        assert!(filtered.is_empty());
    }

    #[test]
    fn test_version_type_display() {
        assert_eq!(VersionType::Release.to_string(), "release");
        assert_eq!(VersionType::Snapshot.to_string(), "snapshot");
        assert_eq!(VersionType::OldBeta.to_string(), "old_beta");
        assert_eq!(VersionType::OldAlpha.to_string(), "old_alpha");
    }

    #[test]
    fn test_version_manifest_deserialize() {
        let json = r#"{
            "latest": {
                "release": "1.20.4",
                "snapshot": "24w01a"
            },
            "versions": [
                {
                    "id": "1.20.4",
                    "type": "release",
                    "url": "https://example.com/1.20.4.json",
                    "time": "2024-01-01T00:00:00+00:00",
                    "releaseTime": "2024-01-01T00:00:00+00:00",
                    "sha1": "abc123",
                    "complianceLevel": 1
                }
            ]
        }"#;

        let manifest: VersionManifest = serde_json::from_str(json).unwrap();

        assert_eq!(manifest.latest.release, "1.20.4");
        assert_eq!(manifest.latest.snapshot, "24w01a");
        assert_eq!(manifest.versions.len(), 1);
        assert_eq!(manifest.versions[0].id, "1.20.4");
        assert_eq!(manifest.versions[0].version_type, VersionType::Release);
    }

    #[test]
    fn test_version_details_deserialize_with_arguments() {
        let json = r#"{
            "id": "1.20.4",
            "type": "release",
            "mainClass": "net.minecraft.client.main.Main",
            "arguments": {
                "game": ["--username", "${auth_player_name}"],
                "jvm": ["-Xmx${max_memory}M"]
            },
            "assetIndex": {
                "id": "1.20",
                "sha1": "abc123",
                "size": 1000,
                "totalSize": 500000,
                "url": "https://example.com/assets.json"
            },
            "assets": "1.20",
            "downloads": {
                "client": {
                    "sha1": "def456",
                    "size": 20000000,
                    "url": "https://example.com/client.jar"
                }
            },
            "libraries": [],
            "releaseTime": "2024-01-01T00:00:00+00:00",
            "time": "2024-01-01T00:00:00+00:00"
        }"#;

        let details: VersionDetails = serde_json::from_str(json).unwrap();

        assert_eq!(details.id, "1.20.4");
        assert_eq!(details.main_class, "net.minecraft.client.main.Main");
        assert!(details.arguments.is_some());
        assert!(details.minecraft_arguments.is_none());
    }

    #[test]
    fn test_version_details_deserialize_with_minecraft_arguments() {
        // Old format (pre-1.13)
        let json = r#"{
            "id": "1.12.2",
            "type": "release",
            "mainClass": "net.minecraft.client.main.Main",
            "minecraftArguments": "--username ${auth_player_name} --version ${version_name}",
            "assetIndex": {
                "id": "1.12",
                "sha1": "abc123",
                "size": 1000,
                "totalSize": 500000,
                "url": "https://example.com/assets.json"
            },
            "assets": "1.12",
            "downloads": {
                "client": {
                    "sha1": "def456",
                    "size": 20000000,
                    "url": "https://example.com/client.jar"
                }
            },
            "libraries": [],
            "releaseTime": "2017-09-18T00:00:00+00:00",
            "time": "2017-09-18T00:00:00+00:00"
        }"#;

        let details: VersionDetails = serde_json::from_str(json).unwrap();

        assert_eq!(details.id, "1.12.2");
        assert!(details.minecraft_arguments.is_some());
        assert!(details.arguments.is_none());
    }

    #[test]
    fn test_library_with_rules() {
        let json = r#"{
            "name": "org.lwjgl:lwjgl:3.3.1",
            "downloads": {
                "artifact": {
                    "path": "org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1.jar",
                    "sha1": "abc123",
                    "size": 100000,
                    "url": "https://example.com/lwjgl.jar"
                }
            },
            "rules": [
                {
                    "action": "allow",
                    "os": {
                        "name": "osx"
                    }
                }
            ]
        }"#;

        let library: Library = serde_json::from_str(json).unwrap();

        assert_eq!(library.name, "org.lwjgl:lwjgl:3.3.1");
        assert!(library.rules.is_some());
        assert_eq!(library.rules.as_ref().unwrap().len(), 1);
        assert_eq!(library.rules.as_ref().unwrap()[0].action, "allow");
    }
}
