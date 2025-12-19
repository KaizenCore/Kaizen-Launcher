//! NeoForge Loader API client
//! API: https://maven.neoforged.net/

use crate::error::{AppError, AppResult};
use crate::modloader::LoaderVersion;
use serde::Deserialize;

const NEOFORGE_MAVEN: &str = "https://maven.neoforged.net";
// New NeoForge versions (1.20.2+)
const NEOFORGE_API: &str =
    "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge";
// Legacy NeoForge versions (1.20.1 - fork of Forge)
const NEOFORGE_LEGACY_API: &str =
    "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/forge";

#[derive(Debug, Deserialize)]
pub struct NeoForgeVersionsResponse {
    pub versions: Vec<String>,
}

/// Fetch available NeoForge versions (including legacy 1.20.1 versions)
pub async fn fetch_versions(client: &reqwest::Client) -> AppResult<Vec<LoaderVersion>> {
    // Fetch new NeoForge versions (1.20.2+)
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
    let mut versions: Vec<LoaderVersion> = data
        .versions
        .into_iter()
        .map(|version| {
            let stable = !version.contains("beta") && !version.contains("alpha");
            let mc_version = parse_mc_version(&version);
            LoaderVersion {
                version: version.clone(),
                stable,
                minecraft_version: mc_version,
                download_url: Some(get_installer_url(&version, false)),
            }
        })
        .collect();

    // Fetch legacy NeoForge versions (1.20.1)
    tracing::info!("[NeoForge] Fetching legacy versions from: {}", NEOFORGE_LEGACY_API);
    match client.get(NEOFORGE_LEGACY_API).send().await {
        Ok(legacy_response) => {
            match legacy_response.json::<NeoForgeVersionsResponse>().await {
                Ok(legacy_data) => {
                    tracing::info!("[NeoForge] Legacy API returned {} versions", legacy_data.versions.len());
                    let legacy_versions: Vec<LoaderVersion> = legacy_data
                        .versions
                        .into_iter()
                        .filter_map(|version| {
                            // Legacy versions are like "1.20.1-47.1.106" or just "47.1.82"
                            let mc_version = if version.starts_with("1.20.1-") {
                                Some("1.20.1".to_string())
                            } else if version.starts_with("47.1.") {
                                Some("1.20.1".to_string())
                            } else {
                                None
                            };

                            mc_version.map(|mc| {
                                let stable = !version.contains("beta") && !version.contains("alpha");
                                LoaderVersion {
                                    version: version.clone(),
                                    stable,
                                    minecraft_version: Some(mc),
                                    download_url: Some(get_installer_url(&version, true)),
                                }
                            })
                        })
                        .collect();

                    tracing::info!("[NeoForge] Found {} legacy versions for 1.20.1", legacy_versions.len());
                    versions.extend(legacy_versions);
                }
                Err(e) => {
                    tracing::warn!("[NeoForge] Failed to parse legacy versions: {}", e);
                }
            }
        }
        Err(e) => {
            tracing::warn!("[NeoForge] Failed to fetch legacy versions: {}", e);
        }
    }

    tracing::info!("[NeoForge] Total versions loaded: {}", versions.len());
    Ok(versions)
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
            v.split(['.', '-'])
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
/// `legacy` = true for 1.20.1 versions (net/neoforged/forge)
/// `legacy` = false for 1.20.2+ versions (net/neoforged/neoforge)
pub fn get_installer_url(nf_version: &str, legacy: bool) -> String {
    if legacy {
        // Legacy 1.20.1 versions use net/neoforged/forge
        format!(
            "{}/releases/net/neoforged/forge/{}/forge-{}-installer.jar",
            NEOFORGE_MAVEN, nf_version, nf_version
        )
    } else {
        // New versions (1.20.2+) use net/neoforged/neoforge
        format!(
            "{}/releases/net/neoforged/neoforge/{}/neoforge-{}-installer.jar",
            NEOFORGE_MAVEN, nf_version, nf_version
        )
    }
}

/// Check if a NeoForge version is legacy (1.20.1)
pub fn is_legacy_version(nf_version: &str) -> bool {
    nf_version.starts_with("1.20.1-") || nf_version.starts_with("47.1.")
}

/// Get the latest stable version for a Minecraft version
pub async fn get_recommended_version(
    client: &reqwest::Client,
    mc_version: &str,
) -> AppResult<Option<String>> {
    let versions = fetch_versions_for_mc(client, mc_version).await?;
    Ok(versions.into_iter().find(|v| v.stable).map(|v| v.version))
}
