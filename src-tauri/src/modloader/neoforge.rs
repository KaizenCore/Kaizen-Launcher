//! NeoForge Loader API client
//! API: https://maven.neoforged.net/

use crate::error::{AppError, AppResult};
use crate::modloader::LoaderVersion;
use serde::Deserialize;

const NEOFORGE_MAVEN: &str = "https://maven.neoforged.net";
const NEOFORGE_API: &str =
    "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge";

#[derive(Debug, Deserialize)]
pub struct NeoForgeVersionsResponse {
    pub versions: Vec<String>,
}

/// Fetch available NeoForge versions
pub async fn fetch_versions(client: &reqwest::Client) -> AppResult<Vec<LoaderVersion>> {
    let response = client
        .get(NEOFORGE_API)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("Failed to fetch NeoForge versions: {}", e)))?;

    let data: NeoForgeVersionsResponse = response
        .json()
        .await
        .map_err(|e| AppError::Network(format!("Failed to parse NeoForge versions: {}", e)))?;

    // NeoForge versions are like "20.4.123-beta" or "21.0.1"
    // The first two numbers correspond to MC version (20.4 = 1.20.4)
    Ok(data
        .versions
        .into_iter()
        .map(|version| {
            let stable = !version.contains("beta") && !version.contains("alpha");
            let mc_version = parse_mc_version(&version);
            LoaderVersion {
                version: version.clone(),
                stable,
                minecraft_version: mc_version,
                download_url: Some(get_installer_url(&version)),
            }
        })
        .collect())
}

/// Get versions for a specific Minecraft version
pub async fn fetch_versions_for_mc(
    client: &reqwest::Client,
    mc_version: &str,
) -> AppResult<Vec<LoaderVersion>> {
    let all_versions = fetch_versions(client).await?;

    let mut filtered: Vec<LoaderVersion> = all_versions
        .into_iter()
        .filter(|v| {
            v.minecraft_version
                .as_ref()
                .map(|mc| mc == mc_version)
                .unwrap_or(false)
        })
        .collect();

    // Sort by version number descending (most recent first)
    // NeoForge versions are like "21.1.216", "21.1.1", etc.
    filtered.sort_by(|a, b| {
        let parse_version = |v: &str| -> Vec<u32> {
            v.split(|c| c == '.' || c == '-')
                .filter_map(|p| p.parse::<u32>().ok())
                .collect()
        };
        let a_parts = parse_version(&a.version);
        let b_parts = parse_version(&b.version);
        b_parts.cmp(&a_parts) // Descending order
    });

    Ok(filtered)
}

/// Parse Minecraft version from NeoForge version
/// e.g., "20.4.123" -> "1.20.4", "21.0.1" -> "1.21"
fn parse_mc_version(nf_version: &str) -> Option<String> {
    let parts: Vec<&str> = nf_version.split('.').collect();
    if parts.len() >= 2 {
        let major: u32 = parts[0].parse().ok()?;
        let minor: u32 = parts[1].parse().ok()?;

        if minor == 0 {
            Some(format!("1.{}", major))
        } else {
            Some(format!("1.{}.{}", major, minor))
        }
    } else {
        None
    }
}

/// Get supported Minecraft versions
pub async fn fetch_supported_versions(client: &reqwest::Client) -> AppResult<Vec<String>> {
    let versions = fetch_versions(client).await?;

    let mut mc_versions: Vec<String> = versions
        .into_iter()
        .filter_map(|v| v.minecraft_version)
        .collect();

    mc_versions.sort();
    mc_versions.dedup();
    mc_versions.reverse();

    Ok(mc_versions)
}

/// Check if a Minecraft version is supported by NeoForge
pub async fn is_version_supported(client: &reqwest::Client, mc_version: &str) -> AppResult<bool> {
    let versions = fetch_supported_versions(client).await?;
    Ok(versions.iter().any(|v| v == mc_version))
}

/// Get the installer URL for a NeoForge version
pub fn get_installer_url(nf_version: &str) -> String {
    format!(
        "{}/releases/net/neoforged/neoforge/{}/neoforge-{}-installer.jar",
        NEOFORGE_MAVEN, nf_version, nf_version
    )
}

/// Get the latest stable version for a Minecraft version
pub async fn get_recommended_version(
    client: &reqwest::Client,
    mc_version: &str,
) -> AppResult<Option<String>> {
    let versions = fetch_versions_for_mc(client, mc_version).await?;
    Ok(versions.into_iter().find(|v| v.stable).map(|v| v.version))
}
