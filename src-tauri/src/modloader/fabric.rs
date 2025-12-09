//! Fabric Loader API client
//! API: https://meta.fabricmc.net/

use crate::error::{AppError, AppResult};
use crate::modloader::LoaderVersion;
use serde::Deserialize;

const FABRIC_META_API: &str = "https://meta.fabricmc.net/v2";

#[derive(Debug, Deserialize)]
pub struct FabricLoaderVersion {
    pub version: String,
    pub stable: bool,
}

#[derive(Debug, Deserialize)]
pub struct FabricGameVersion {
    pub version: String,
    #[allow(dead_code)]
    pub stable: bool,
}

#[derive(Debug, Deserialize)]
pub struct FabricProfile {
    pub id: String,
    #[serde(rename = "inheritsFrom")]
    pub inherits_from: String,
    #[serde(rename = "releaseTime")]
    #[allow(dead_code)]
    pub release_time: String,
    #[allow(dead_code)]
    pub time: String,
    #[serde(rename = "type")]
    #[allow(dead_code)]
    pub version_type: String,
    #[serde(rename = "mainClass")]
    pub main_class: String,
    pub libraries: Vec<FabricLibrary>,
}

#[derive(Debug, Deserialize)]
pub struct FabricLibrary {
    pub name: String,
    pub url: String,
}

/// Fetch available Fabric loader versions
pub async fn fetch_loader_versions(client: &reqwest::Client) -> AppResult<Vec<LoaderVersion>> {
    let url = format!("{}/versions/loader", FABRIC_META_API);

    let response =
        client.get(&url).send().await.map_err(|e| {
            AppError::Network(format!("Failed to fetch Fabric loader versions: {}", e))
        })?;

    let versions: Vec<FabricLoaderVersion> = response
        .json()
        .await
        .map_err(|e| AppError::Network(format!("Failed to parse Fabric loader versions: {}", e)))?;

    Ok(versions
        .into_iter()
        .map(|v| LoaderVersion {
            version: v.version,
            stable: v.stable,
            minecraft_version: None,
            download_url: None,
        })
        .collect())
}

/// Fetch Minecraft versions supported by Fabric
pub async fn fetch_game_versions(client: &reqwest::Client) -> AppResult<Vec<String>> {
    let url = format!("{}/versions/game", FABRIC_META_API);

    let response =
        client.get(&url).send().await.map_err(|e| {
            AppError::Network(format!("Failed to fetch Fabric game versions: {}", e))
        })?;

    let versions: Vec<FabricGameVersion> = response
        .json()
        .await
        .map_err(|e| AppError::Network(format!("Failed to parse Fabric game versions: {}", e)))?;

    Ok(versions.into_iter().map(|v| v.version).collect())
}

/// Check if a Minecraft version is supported by Fabric
pub async fn is_version_supported(client: &reqwest::Client, mc_version: &str) -> AppResult<bool> {
    let versions = fetch_game_versions(client).await?;
    Ok(versions.iter().any(|v| v == mc_version))
}

/// Fetch the Fabric profile for installation
pub async fn fetch_profile(
    client: &reqwest::Client,
    mc_version: &str,
    loader_version: &str,
) -> AppResult<FabricProfile> {
    let url = format!(
        "{}/versions/loader/{}/{}/profile/json",
        FABRIC_META_API, mc_version, loader_version
    );

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("Failed to fetch Fabric profile: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::Network(format!(
            "Fabric profile not found for {} with loader {}",
            mc_version, loader_version
        )));
    }

    response
        .json()
        .await
        .map_err(|e| AppError::Network(format!("Failed to parse Fabric profile: {}", e)))
}

/// Get the recommended (latest stable) loader version
pub async fn get_recommended_version(client: &reqwest::Client) -> AppResult<String> {
    let versions = fetch_loader_versions(client).await?;
    versions
        .into_iter()
        .find(|v| v.stable)
        .map(|v| v.version)
        .ok_or_else(|| AppError::Network("No stable Fabric version found".to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fabric_loader_version_deserialize() {
        let json = r#"[
            {"version": "0.15.0", "stable": true},
            {"version": "0.15.1-beta.1", "stable": false}
        ]"#;

        let versions: Vec<FabricLoaderVersion> = serde_json::from_str(json).unwrap();

        assert_eq!(versions.len(), 2);
        assert_eq!(versions[0].version, "0.15.0");
        assert!(versions[0].stable);
        assert_eq!(versions[1].version, "0.15.1-beta.1");
        assert!(!versions[1].stable);
    }

    #[test]
    fn test_fabric_game_version_deserialize() {
        let json = r#"[
            {"version": "1.20.4", "stable": true},
            {"version": "24w01a", "stable": false}
        ]"#;

        let versions: Vec<FabricGameVersion> = serde_json::from_str(json).unwrap();

        assert_eq!(versions.len(), 2);
        assert_eq!(versions[0].version, "1.20.4");
        assert_eq!(versions[1].version, "24w01a");
    }

    #[test]
    fn test_fabric_profile_deserialize() {
        let json = r#"{
            "id": "fabric-loader-0.15.0-1.20.4",
            "inheritsFrom": "1.20.4",
            "releaseTime": "2024-01-01T00:00:00+00:00",
            "time": "2024-01-01T00:00:00+00:00",
            "type": "release",
            "mainClass": "net.fabricmc.loader.impl.launch.knot.KnotClient",
            "libraries": [
                {
                    "name": "net.fabricmc:fabric-loader:0.15.0",
                    "url": "https://maven.fabricmc.net/"
                }
            ]
        }"#;

        let profile: FabricProfile = serde_json::from_str(json).unwrap();

        assert_eq!(profile.id, "fabric-loader-0.15.0-1.20.4");
        assert_eq!(profile.inherits_from, "1.20.4");
        assert_eq!(
            profile.main_class,
            "net.fabricmc.loader.impl.launch.knot.KnotClient"
        );
        assert_eq!(profile.libraries.len(), 1);
        assert_eq!(
            profile.libraries[0].name,
            "net.fabricmc:fabric-loader:0.15.0"
        );
        assert_eq!(profile.libraries[0].url, "https://maven.fabricmc.net/");
    }

    #[test]
    fn test_loader_version_conversion() {
        let fabric_version = FabricLoaderVersion {
            version: "0.15.0".to_string(),
            stable: true,
        };

        let loader_version = LoaderVersion {
            version: fabric_version.version.clone(),
            stable: fabric_version.stable,
            minecraft_version: None,
            download_url: None,
        };

        assert_eq!(loader_version.version, "0.15.0");
        assert!(loader_version.stable);
        assert!(loader_version.minecraft_version.is_none());
    }
}
