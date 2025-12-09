//! Tauri commands for modloader operations

use crate::cache::ApiCache;
use crate::error::AppResult;
use crate::modloader::paper::{PaperProject, SpongeProject};
use crate::modloader::{fabric, forge, neoforge, paper, quilt, LoaderType, LoaderVersion};
use crate::state::SharedState;
use std::time::Duration;
use tauri::State;

/// Cache TTL for loader versions (1 hour)
const LOADER_CACHE_TTL: Duration = Duration::from_secs(3600);

/// Get available loader versions for a loader type
#[tauri::command]
pub async fn get_loader_versions(
    loader_type: LoaderType,
    mc_version: Option<String>,
    state: State<'_, SharedState>,
) -> AppResult<Vec<LoaderVersion>> {
    let state = state.read().await;
    let client = &state.http_client;
    let cache = ApiCache::new(&state.data_dir);

    // Generate cache key
    let cache_key = format!(
        "loader_versions_{:?}_{}",
        loader_type,
        mc_version.as_deref().unwrap_or("all")
    );

    // Try to get from cache
    if let Some(cached) = cache.get::<Vec<LoaderVersion>>(&cache_key).await {
        return Ok(cached);
    }

    // Fetch fresh data
    let versions = fetch_loader_versions_internal(loader_type, mc_version, client).await?;

    // Cache the result
    let _ = cache
        .set_with_ttl(&cache_key, &versions, LOADER_CACHE_TTL)
        .await;

    Ok(versions)
}

/// Check if a Minecraft version is supported by a loader
#[tauri::command]
pub async fn is_loader_supported(
    loader_type: LoaderType,
    mc_version: String,
    state: State<'_, SharedState>,
) -> AppResult<bool> {
    let state = state.read().await;
    let client = &state.http_client;

    match loader_type {
        LoaderType::Vanilla => Ok(true),
        LoaderType::Fabric => fabric::is_version_supported(client, &mc_version).await,
        LoaderType::Forge => forge::is_version_supported(client, &mc_version).await,
        LoaderType::NeoForge => neoforge::is_version_supported(client, &mc_version).await,
        LoaderType::Quilt => quilt::is_version_supported(client, &mc_version).await,
        // Server types don't depend on MC version the same way
        LoaderType::Paper
        | LoaderType::Purpur
        | LoaderType::Folia
        | LoaderType::Pufferfish
        | LoaderType::Spigot
        | LoaderType::SpongeVanilla
        | LoaderType::SpongeForge
        | LoaderType::Velocity
        | LoaderType::Waterfall
        | LoaderType::BungeeCord => Ok(true),
    }
}

/// Get the recommended loader version for a Minecraft version
#[tauri::command]
pub async fn get_recommended_loader_version(
    loader_type: LoaderType,
    mc_version: Option<String>,
    state: State<'_, SharedState>,
) -> AppResult<Option<String>> {
    let state_guard = state.read().await;
    let client = &state_guard.http_client;

    match loader_type {
        LoaderType::Vanilla => Ok(None),

        LoaderType::Fabric => fabric::get_recommended_version(client).await.map(Some),

        LoaderType::Forge => {
            if let Some(mc) = mc_version {
                forge::get_recommended_version(client, &mc).await
            } else {
                Ok(None)
            }
        }

        LoaderType::NeoForge => {
            if let Some(mc) = mc_version {
                neoforge::get_recommended_version(client, &mc).await
            } else {
                Ok(None)
            }
        }

        LoaderType::Quilt => quilt::get_recommended_version(client).await.map(Some),

        // Server types - return latest
        LoaderType::Paper
        | LoaderType::Purpur
        | LoaderType::Folia
        | LoaderType::Pufferfish
        | LoaderType::Spigot
        | LoaderType::SpongeVanilla
        | LoaderType::SpongeForge
        | LoaderType::Velocity
        | LoaderType::Waterfall
        | LoaderType::BungeeCord => {
            // Get versions directly instead of calling the command recursively
            let versions = fetch_loader_versions_internal(loader_type, mc_version, client).await?;
            Ok(versions.into_iter().next().map(|v| v.version))
        }
    }
}

/// Internal helper to fetch loader versions without command wrapper
async fn fetch_loader_versions_internal(
    loader_type: LoaderType,
    mc_version: Option<String>,
    client: &reqwest::Client,
) -> AppResult<Vec<LoaderVersion>> {
    match loader_type {
        LoaderType::Vanilla => Ok(vec![]),
        LoaderType::Fabric => fabric::fetch_loader_versions(client).await,
        LoaderType::Forge => {
            if let Some(mc) = mc_version {
                forge::fetch_versions_for_mc(client, &mc).await
            } else {
                Ok(vec![])
            }
        }
        LoaderType::NeoForge => {
            if let Some(mc) = mc_version {
                neoforge::fetch_versions_for_mc(client, &mc).await
            } else {
                neoforge::fetch_versions(client).await
            }
        }
        LoaderType::Quilt => quilt::fetch_loader_versions(client).await,
        LoaderType::Paper => {
            if let Some(mc) = mc_version {
                paper::fetch_paper_for_mc(client, &mc).await
            } else {
                paper::fetch_loader_versions(client, PaperProject::Paper).await
            }
        }
        LoaderType::Purpur => {
            if let Some(mc) = mc_version {
                paper::fetch_purpur_builds(client, &mc).await
            } else {
                paper::fetch_purpur_loader_versions(client).await
            }
        }
        LoaderType::Folia => paper::fetch_loader_versions(client, PaperProject::Folia).await,
        LoaderType::Pufferfish => paper::fetch_pufferfish_versions(client).await,
        LoaderType::Spigot => paper::fetch_spigot_versions(client).await,
        LoaderType::SpongeVanilla => {
            paper::fetch_sponge_versions(client, SpongeProject::SpongeVanilla).await
        }
        LoaderType::SpongeForge => {
            paper::fetch_sponge_versions(client, SpongeProject::SpongeForge).await
        }
        LoaderType::Velocity => paper::fetch_loader_versions(client, PaperProject::Velocity).await,
        LoaderType::Waterfall => {
            paper::fetch_loader_versions(client, PaperProject::Waterfall).await
        }
        LoaderType::BungeeCord => paper::fetch_bungeecord_versions(client).await,
    }
}

/// Get supported Minecraft versions for a loader
#[tauri::command]
pub async fn get_loader_mc_versions(
    loader_type: LoaderType,
    state: State<'_, SharedState>,
) -> AppResult<Vec<String>> {
    let state = state.read().await;
    let client = &state.http_client;
    let cache = ApiCache::new(&state.data_dir);

    // Generate cache key
    let cache_key = format!("loader_mc_versions_{:?}", loader_type);

    // Try to get from cache
    if let Some(cached) = cache.get::<Vec<String>>(&cache_key).await {
        return Ok(cached);
    }

    // Fetch fresh data
    let versions = match loader_type {
        LoaderType::Vanilla => vec![], // Use minecraft API instead
        LoaderType::Fabric => fabric::fetch_game_versions(client).await?,
        LoaderType::Forge => forge::fetch_supported_versions(client).await?,
        LoaderType::NeoForge => neoforge::fetch_supported_versions(client).await?,
        LoaderType::Quilt => quilt::fetch_game_versions(client).await?,
        LoaderType::Paper => paper::fetch_versions(client, PaperProject::Paper).await?,
        LoaderType::Purpur => paper::fetch_purpur_versions(client).await?,
        LoaderType::Folia => paper::fetch_versions(client, PaperProject::Folia).await?,
        LoaderType::Pufferfish => vec!["1.21".to_string(), "1.20".to_string()], // Pufferfish has limited MC versions
        LoaderType::Spigot => vec![], // Spigot uses BuildTools, no direct MC version list
        LoaderType::SpongeVanilla | LoaderType::SpongeForge => vec![], // Sponge versions include MC version
        LoaderType::Velocity => paper::fetch_versions(client, PaperProject::Velocity).await?,
        LoaderType::Waterfall => paper::fetch_versions(client, PaperProject::Waterfall).await?,
        LoaderType::BungeeCord => vec![], // BungeeCord doesn't have MC versions
    };

    // Cache non-empty results
    if !versions.is_empty() {
        let _ = cache
            .set_with_ttl(&cache_key, &versions, LOADER_CACHE_TTL)
            .await;
    }

    Ok(versions)
}

/// Get all available loader types
#[tauri::command]
pub fn get_available_loaders() -> Vec<LoaderInfo> {
    vec![
        // Client loaders
        LoaderInfo {
            loader_type: LoaderType::Vanilla,
            name: "Vanilla".to_string(),
            description: "Official Minecraft without modifications".to_string(),
            is_server: false,
            is_proxy: false,
        },
        LoaderInfo {
            loader_type: LoaderType::Fabric,
            name: "Fabric".to_string(),
            description: "Lightweight modding toolchain for Minecraft".to_string(),
            is_server: false,
            is_proxy: false,
        },
        LoaderInfo {
            loader_type: LoaderType::Forge,
            name: "Forge".to_string(),
            description: "The most popular modding platform for Minecraft".to_string(),
            is_server: false,
            is_proxy: false,
        },
        LoaderInfo {
            loader_type: LoaderType::NeoForge,
            name: "NeoForge".to_string(),
            description: "Modern fork of Forge with improved APIs".to_string(),
            is_server: false,
            is_proxy: false,
        },
        LoaderInfo {
            loader_type: LoaderType::Quilt,
            name: "Quilt".to_string(),
            description: "Fork of Fabric with additional features".to_string(),
            is_server: false,
            is_proxy: false,
        },
        // Server types
        LoaderInfo {
            loader_type: LoaderType::Paper,
            name: "Paper".to_string(),
            description: "High performance Minecraft server".to_string(),
            is_server: true,
            is_proxy: false,
        },
        LoaderInfo {
            loader_type: LoaderType::Purpur,
            name: "Purpur".to_string(),
            description: "Fork of Paper with extra features and configuration".to_string(),
            is_server: true,
            is_proxy: false,
        },
        LoaderInfo {
            loader_type: LoaderType::Folia,
            name: "Folia".to_string(),
            description: "Multi-threaded Paper fork for large servers".to_string(),
            is_server: true,
            is_proxy: false,
        },
        LoaderInfo {
            loader_type: LoaderType::Pufferfish,
            name: "Pufferfish".to_string(),
            description: "Highly optimized Paper fork".to_string(),
            is_server: true,
            is_proxy: false,
        },
        LoaderInfo {
            loader_type: LoaderType::Spigot,
            name: "Spigot".to_string(),
            description: "Modified Minecraft server (requires BuildTools)".to_string(),
            is_server: true,
            is_proxy: false,
        },
        LoaderInfo {
            loader_type: LoaderType::SpongeVanilla,
            name: "SpongeVanilla".to_string(),
            description: "Sponge API on vanilla Minecraft".to_string(),
            is_server: true,
            is_proxy: false,
        },
        LoaderInfo {
            loader_type: LoaderType::SpongeForge,
            name: "SpongeForge".to_string(),
            description: "Sponge API with Forge mod support".to_string(),
            is_server: true,
            is_proxy: false,
        },
        // Proxy types
        LoaderInfo {
            loader_type: LoaderType::Velocity,
            name: "Velocity".to_string(),
            description: "Modern, high-performance Minecraft proxy".to_string(),
            is_server: true,
            is_proxy: true,
        },
        LoaderInfo {
            loader_type: LoaderType::BungeeCord,
            name: "BungeeCord".to_string(),
            description: "Proxy server for connecting multiple servers".to_string(),
            is_server: true,
            is_proxy: true,
        },
        LoaderInfo {
            loader_type: LoaderType::Waterfall,
            name: "Waterfall".to_string(),
            description: "Fork of BungeeCord with improvements".to_string(),
            is_server: true,
            is_proxy: true,
        },
    ]
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct LoaderInfo {
    pub loader_type: LoaderType,
    pub name: String,
    pub description: String,
    pub is_server: bool,
    pub is_proxy: bool,
}
