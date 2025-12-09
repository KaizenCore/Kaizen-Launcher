//! Quilt Loader API client
//! API: https://meta.quiltmc.org/

use crate::error::{AppError, AppResult};
use crate::modloader::LoaderVersion;
use serde::Deserialize;

const QUILT_META_API: &str = "https://meta.quiltmc.org/v3";

#[derive(Debug, Deserialize)]
pub struct QuiltLoaderVersion {
    pub version: String,
}

#[derive(Debug, Deserialize)]
pub struct QuiltGameVersion {
    pub version: String,
    #[allow(dead_code)]
    pub stable: bool,
}

#[derive(Debug, Deserialize)]
pub struct QuiltProfile {
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
    pub libraries: Vec<QuiltLibrary>,
}

#[derive(Debug, Deserialize)]
pub struct QuiltLibrary {
    pub name: String,
    pub url: Option<String>,
}

/// Fetch available Quilt loader versions
pub async fn fetch_loader_versions(client: &reqwest::Client) -> AppResult<Vec<LoaderVersion>> {
    let url = format!("{}/versions/loader", QUILT_META_API);

    let response =
        client.get(&url).send().await.map_err(|e| {
            AppError::Network(format!("Failed to fetch Quilt loader versions: {}", e))
        })?;

    let versions: Vec<QuiltLoaderVersion> = response
        .json()
        .await
        .map_err(|e| AppError::Network(format!("Failed to parse Quilt loader versions: {}", e)))?;

    Ok(versions
        .into_iter()
        .enumerate()
        .map(|(i, v)| LoaderVersion {
            version: v.version,
            stable: i == 0, // First version is latest/recommended
            minecraft_version: None,
            download_url: None,
        })
        .collect())
}

/// Fetch Minecraft versions supported by Quilt
pub async fn fetch_game_versions(client: &reqwest::Client) -> AppResult<Vec<String>> {
    let url = format!("{}/versions/game", QUILT_META_API);

    let response =
        client.get(&url).send().await.map_err(|e| {
            AppError::Network(format!("Failed to fetch Quilt game versions: {}", e))
        })?;

    let versions: Vec<QuiltGameVersion> = response
        .json()
        .await
        .map_err(|e| AppError::Network(format!("Failed to parse Quilt game versions: {}", e)))?;

    Ok(versions.into_iter().map(|v| v.version).collect())
}

/// Check if a Minecraft version is supported by Quilt
pub async fn is_version_supported(client: &reqwest::Client, mc_version: &str) -> AppResult<bool> {
    let versions = fetch_game_versions(client).await?;
    Ok(versions.iter().any(|v| v == mc_version))
}

/// Fetch the Quilt profile for installation
pub async fn fetch_profile(
    client: &reqwest::Client,
    mc_version: &str,
    loader_version: &str,
) -> AppResult<QuiltProfile> {
    let url = format!(
        "{}/versions/loader/{}/{}/profile/json",
        QUILT_META_API, mc_version, loader_version
    );

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("Failed to fetch Quilt profile: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::Network(format!(
            "Quilt profile not found for {} with loader {}",
            mc_version, loader_version
        )));
    }

    response
        .json()
        .await
        .map_err(|e| AppError::Network(format!("Failed to parse Quilt profile: {}", e)))
}

/// Get the recommended (latest) loader version
pub async fn get_recommended_version(client: &reqwest::Client) -> AppResult<String> {
    let versions = fetch_loader_versions(client).await?;
    versions
        .into_iter()
        .next()
        .map(|v| v.version)
        .ok_or_else(|| AppError::Network("No Quilt version found".to_string()))
}
