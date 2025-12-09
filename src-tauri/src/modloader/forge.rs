//! Forge Loader API client
//! API: https://files.minecraftforge.net/

use crate::error::{AppError, AppResult};
use crate::modloader::LoaderVersion;
use serde::Deserialize;

const FORGE_MAVEN: &str = "https://maven.minecraftforge.net";
const FORGE_PROMOTIONS: &str =
    "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json";

#[derive(Debug, Deserialize)]
pub struct ForgePromotions {
    #[allow(dead_code)]
    pub homepage: String,
    pub promos: std::collections::HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct ForgeVersionList {
    #[serde(flatten)]
    pub versions: std::collections::HashMap<String, Vec<String>>,
}

/// Fetch Forge promotions (recommended/latest versions per MC version)
pub async fn fetch_promotions(client: &reqwest::Client) -> AppResult<ForgePromotions> {
    let response = client
        .get(FORGE_PROMOTIONS)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("Failed to fetch Forge promotions: {}", e)))?;

    response
        .json()
        .await
        .map_err(|e| AppError::Network(format!("Failed to parse Forge promotions: {}", e)))
}

/// Get available Forge versions for a Minecraft version
pub async fn fetch_versions_for_mc(
    client: &reqwest::Client,
    mc_version: &str,
) -> AppResult<Vec<LoaderVersion>> {
    let promotions = fetch_promotions(client).await?;

    let mut versions = Vec::new();

    // Check for recommended version
    let recommended_key = format!("{}-recommended", mc_version);
    if let Some(version) = promotions.promos.get(&recommended_key) {
        versions.push(LoaderVersion {
            version: version.clone(),
            stable: true,
            minecraft_version: Some(mc_version.to_string()),
            download_url: Some(get_installer_url(mc_version, version)),
        });
    }

    // Check for latest version
    let latest_key = format!("{}-latest", mc_version);
    if let Some(version) = promotions.promos.get(&latest_key) {
        // Don't add if same as recommended
        if !versions.iter().any(|v| v.version == *version) {
            versions.push(LoaderVersion {
                version: version.clone(),
                stable: false,
                minecraft_version: Some(mc_version.to_string()),
                download_url: Some(get_installer_url(mc_version, version)),
            });
        }
    }

    Ok(versions)
}

/// Get supported Minecraft versions
pub async fn fetch_supported_versions(client: &reqwest::Client) -> AppResult<Vec<String>> {
    let promotions = fetch_promotions(client).await?;

    let mut versions: Vec<String> = promotions
        .promos
        .keys()
        .filter_map(|key| {
            key.strip_suffix("-recommended")
                .or_else(|| key.strip_suffix("-latest"))
                .map(|s| s.to_string())
        })
        .collect();

    versions.sort();
    versions.dedup();
    versions.reverse(); // Newest first

    Ok(versions)
}

/// Check if a Minecraft version is supported by Forge
pub async fn is_version_supported(client: &reqwest::Client, mc_version: &str) -> AppResult<bool> {
    let versions = fetch_supported_versions(client).await?;
    Ok(versions.iter().any(|v| v == mc_version))
}

/// Get the installer URL for a Forge version
pub fn get_installer_url(mc_version: &str, forge_version: &str) -> String {
    format!(
        "{}/net/minecraftforge/forge/{}-{}/forge-{}-{}-installer.jar",
        FORGE_MAVEN, mc_version, forge_version, mc_version, forge_version
    )
}

/// Get the recommended Forge version for a Minecraft version
pub async fn get_recommended_version(
    client: &reqwest::Client,
    mc_version: &str,
) -> AppResult<Option<String>> {
    let promotions = fetch_promotions(client).await?;
    let key = format!("{}-recommended", mc_version);
    Ok(promotions.promos.get(&key).cloned())
}
