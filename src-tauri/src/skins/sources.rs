//! Multi-source skin fetching module
//!
//! Supports multiple skin APIs with fallback:
//! - MineSkin (gallery browsing)
//! - MCHeads (player skins by username)
//! - Ashcon (player profiles with skins)
//! - Crafatar (player avatars/skins by UUID)

use crate::error::{AppError, AppResult};
use crate::skins::{CommunitySkin, SearchSkinsResponse, SkinSource, SkinVariant};
use serde::{Deserialize, Serialize};

// ==================== Source Configuration ====================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum SkinSourceType {
    MineSkin,
    PlayerSearch, // MCHeads + Ashcon
}

impl Default for SkinSourceType {
    fn default() -> Self {
        Self::MineSkin
    }
}

// ==================== MineSkin v2 API ====================

const MINESKIN_API: &str = "https://api.mineskin.org";
const TEXTURE_BASE_URL: &str = "https://textures.minecraft.net/texture";
const RENDER_BASE_URL: &str = "https://mc-heads.net/body";

#[derive(Debug, Deserialize)]
struct MineSkinV2Response {
    #[allow(dead_code)]
    success: Option<bool>,
    skins: Vec<MineSkinV2Skin>,
    pagination: Option<MineSkinPagination>,
}

#[derive(Debug, Deserialize)]
struct MineSkinV2Skin {
    uuid: String,
    #[serde(rename = "shortId")]
    short_id: Option<String>,
    name: Option<String>,
    texture: String,
    variant: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MineSkinPagination {
    next: Option<MineSkinNext>,
}

#[derive(Debug, Deserialize)]
struct MineSkinNext {
    after: Option<String>,
}

pub async fn fetch_mineskin_gallery(
    client: &reqwest::Client,
    size: u32,
    after: Option<&str>,
) -> AppResult<SearchSkinsResponse> {
    let url = match after {
        Some(cursor) => format!("{}/v2/skins?size={}&after={}", MINESKIN_API, size, cursor),
        None => format!("{}/v2/skins?size={}", MINESKIN_API, size),
    };

    let response = client
        .get(&url)
        .header("User-Agent", "KaizenLauncher/1.0")
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| AppError::Skin(format!("MineSkin request failed: {}", e)))?;

    if !response.status().is_success() {
        log::warn!("MineSkin returned status {}", response.status());
        return Ok(SearchSkinsResponse {
            skins: vec![],
            total: 0,
            page: 0,
            has_more: false,
        });
    }

    let data: MineSkinV2Response = response
        .json()
        .await
        .map_err(|e| AppError::Skin(format!("Failed to parse MineSkin response: {}", e)))?;

    let skins: Vec<CommunitySkin> = data
        .skins
        .into_iter()
        .map(|skin| {
            let texture_url = format!("{}/{}", TEXTURE_BASE_URL, skin.texture);
            // Use mc-heads.net to render a 3D body preview from the texture hash
            let thumbnail_url = format!("{}/{}", RENDER_BASE_URL, skin.texture);
            CommunitySkin {
                id: skin.uuid.clone(),
                name: skin.name.unwrap_or_else(|| {
                    skin.short_id
                        .unwrap_or_else(|| skin.uuid[..8.min(skin.uuid.len())].to_string())
                }),
                url: texture_url,
                thumbnail_url,
                variant: match skin.variant.as_deref() {
                    Some("slim") => SkinVariant::Slim,
                    _ => SkinVariant::Classic,
                },
                source: SkinSource::MineSkin,
                author: None,
                downloads: None,
                likes: None,
            }
        })
        .collect();

    let has_more = data
        .pagination
        .and_then(|p| p.next)
        .and_then(|n| n.after)
        .is_some();

    Ok(SearchSkinsResponse {
        skins,
        total: 0,
        page: 0,
        has_more,
    })
}

// ==================== Player Search (Ashcon API) ====================

const ASHCON_API: &str = "https://api.ashcon.app/mojang/v2/user";

#[derive(Debug, Deserialize)]
struct AshconResponse {
    uuid: String,
    username: String,
    textures: Option<AshconTextures>,
}

#[derive(Debug, Deserialize)]
struct AshconTextures {
    slim: Option<bool>,
    skin: Option<AshconSkin>,
}

#[derive(Debug, Deserialize)]
struct AshconSkin {
    url: String,
}

/// Search for a player's skin by username
pub async fn search_player_skin(
    client: &reqwest::Client,
    username: &str,
) -> AppResult<Option<CommunitySkin>> {
    let response = client
        .get(format!("{}/{}", ASHCON_API, username))
        .header("User-Agent", "KaizenLauncher/1.0")
        .send()
        .await
        .map_err(|e| AppError::Skin(format!("Ashcon request failed: {}", e)))?;

    if !response.status().is_success() {
        return Ok(None);
    }

    let data: AshconResponse = match response.json().await {
        Ok(d) => d,
        Err(_) => return Ok(None),
    };

    let textures = match data.textures {
        Some(t) => t,
        None => return Ok(None),
    };

    let skin_url = match textures.skin {
        Some(s) => s.url,
        None => return Ok(None),
    };

    Ok(Some(CommunitySkin {
        id: data.uuid.clone(),
        name: data.username.clone(),
        url: skin_url.clone(),
        // Use 3D body render for consistency with gallery view
        thumbnail_url: format!("https://mc-heads.net/body/{}", data.username),
        variant: if textures.slim.unwrap_or(false) {
            SkinVariant::Slim
        } else {
            SkinVariant::Classic
        },
        source: SkinSource::Mojang,
        author: Some(data.username),
        downloads: None,
        likes: None,
    }))
}

/// Search for multiple players' skins
pub async fn search_player_skins(
    client: &reqwest::Client,
    query: &str,
) -> AppResult<SearchSkinsResponse> {
    // Try to find the player directly
    if let Some(skin) = search_player_skin(client, query).await? {
        return Ok(SearchSkinsResponse {
            skins: vec![skin],
            total: 1,
            page: 0,
            has_more: false,
        });
    }

    Ok(SearchSkinsResponse {
        skins: vec![],
        total: 0,
        page: 0,
        has_more: false,
    })
}

// ==================== Popular Players (for trending) ====================

/// Get skins from popular Minecraft players/content creators
pub async fn get_popular_player_skins(client: &reqwest::Client) -> AppResult<SearchSkinsResponse> {
    // List of popular Minecraft players/content creators
    let popular_players = [
        "Dream",
        "Technoblade",
        "TommyInnit",
        "GeorgeNotFound",
        "Sapnap",
        "Tubbo",
        "Ranboo",
        "Wilbur",
        "Philza",
        "BadBoyHalo",
        "Skeppy",
        "Quackity",
        "Karl",
        "Punz",
        "CaptainSparklez",
        "DanTDM",
        "Stampy",
        "SSundee",
    ];

    let mut skins = Vec::new();

    // Fetch skins sequentially (to avoid rate limiting)
    for username in popular_players.iter().take(12) {
        if let Ok(Some(skin)) = search_player_skin(client, username).await {
            skins.push(skin);
        }
    }

    let total = skins.len() as u64;
    Ok(SearchSkinsResponse {
        skins,
        total,
        page: 0,
        has_more: false,
    })
}

// ==================== MCHeads (for thumbnails/renders) ====================

/// Get MCHeads avatar URL for a username
pub fn mcheads_avatar_url(username: &str, size: u32) -> String {
    format!("https://mc-heads.net/avatar/{}/{}", username, size)
}

/// Get MCHeads skin URL for a username
pub fn mcheads_skin_url(username: &str) -> String {
    format!("https://mc-heads.net/skin/{}", username)
}

/// Get MCHeads body render URL
pub fn mcheads_body_url(username: &str, size: u32) -> String {
    format!("https://mc-heads.net/body/{}/{}", username, size)
}

// ==================== Capes.dev (multi-source cape API) ====================

const CAPES_DEV_API: &str = "https://api.capes.dev/load";

#[derive(Debug, Deserialize)]
pub struct CapesDevResponse {
    pub minecraft: Option<CapeInfo>,
    pub optifine: Option<CapeInfo>,
    #[serde(rename = "labyMod")]
    pub labymod: Option<CapeInfo>,
    #[serde(rename = "5zig")]
    pub fivezig: Option<CapeInfo>,
    pub minecraftcapes: Option<CapeInfo>,
    pub tlauncher: Option<CapeInfo>,
}

#[derive(Debug, Deserialize)]
pub struct CapeInfo {
    #[allow(dead_code)]
    pub hash: Option<String>,
    pub exists: bool,
    #[serde(rename = "imageUrl")]
    pub image_url: Option<String>,
    #[serde(rename = "capeUrl")]
    pub cape_url: Option<String>,
}

/// Fetch all available capes for a player from multiple sources
pub async fn fetch_all_capes(
    client: &reqwest::Client,
    username: &str,
) -> AppResult<CapesDevResponse> {
    let response = client
        .get(format!("{}/{}", CAPES_DEV_API, username))
        .header("User-Agent", "KaizenLauncher/1.0")
        .send()
        .await
        .map_err(|e| AppError::Skin(format!("Capes.dev request failed: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::Skin("Failed to fetch capes".to_string()));
    }

    response
        .json()
        .await
        .map_err(|e| AppError::Skin(format!("Failed to parse capes response: {}", e)))
}
