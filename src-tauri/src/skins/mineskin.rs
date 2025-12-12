use crate::error::{AppError, AppResult};
use crate::skins::{CommunitySkin, SearchSkinsResponse, SkinSource, SkinVariant};
use reqwest::multipart::{Form, Part};
use serde::{Deserialize, Serialize};

const MINESKIN_API: &str = "https://api.mineskin.org";

/// Result from MineSkin API
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MineSkinResult {
    pub uuid: String,
    pub texture_url: String,
    pub skin_url: String,
    pub variant: SkinVariant,
}

/// MineSkin API response
#[derive(Debug, Deserialize)]
struct MineSkinResponse {
    uuid: String,
    texture: TextureInfo,
}

#[derive(Debug, Deserialize)]
struct TextureInfo {
    url: String,
    data: TextureData,
}

#[derive(Debug, Deserialize)]
struct TextureData {
    value: String,
}

#[derive(Debug, Deserialize)]
struct MineSkinErrorResponse {
    error: Option<String>,
    #[serde(rename = "errorCode")]
    error_code: Option<String>,
}

/// Generate skin from URL using MineSkin API
pub async fn generate_from_url(
    client: &reqwest::Client,
    url: &str,
    variant: &SkinVariant,
    name: Option<&str>,
) -> AppResult<MineSkinResult> {
    #[derive(Serialize)]
    struct GenerateRequest<'a> {
        url: &'a str,
        variant: &'a str,
        #[serde(skip_serializing_if = "Option::is_none")]
        name: Option<&'a str>,
        visibility: u8,
    }

    let request = GenerateRequest {
        url,
        variant: match variant {
            SkinVariant::Classic => "classic",
            SkinVariant::Slim => "slim",
        },
        name,
        visibility: 0, // Public
    };

    let response = client
        .post(format!("{}/generate/url", MINESKIN_API))
        .header("User-Agent", "KaizenLauncher/1.0")
        .header("Content-Type", "application/json")
        .json(&request)
        .send()
        .await
        .map_err(|e| AppError::Skin(format!("MineSkin request failed: {}", e)))?;

    parse_mineskin_response(response, variant).await
}

/// Generate skin from file data using MineSkin API
pub async fn generate_from_file(
    client: &reqwest::Client,
    file_data: Vec<u8>,
    variant: &SkinVariant,
    name: Option<&str>,
) -> AppResult<MineSkinResult> {
    let variant_str = match variant {
        SkinVariant::Classic => "classic",
        SkinVariant::Slim => "slim",
    };

    let mut form = Form::new()
        .part(
            "file",
            Part::bytes(file_data)
                .file_name("skin.png")
                .mime_str("image/png")
                .map_err(|e| AppError::Skin(format!("Failed to create form part: {}", e)))?,
        )
        .text("variant", variant_str.to_string())
        .text("visibility", "0");

    if let Some(n) = name {
        form = form.text("name", n.to_string());
    }

    let response = client
        .post(format!("{}/generate/upload", MINESKIN_API))
        .header("User-Agent", "KaizenLauncher/1.0")
        .multipart(form)
        .send()
        .await
        .map_err(|e| AppError::Skin(format!("MineSkin upload failed: {}", e)))?;

    parse_mineskin_response(response, variant).await
}

/// Get skin by UUID from MineSkin
pub async fn get_skin(client: &reqwest::Client, uuid: &str) -> AppResult<MineSkinResult> {
    let response = client
        .get(format!("{}/get/uuid/{}", MINESKIN_API, uuid))
        .header("User-Agent", "KaizenLauncher/1.0")
        .send()
        .await
        .map_err(|e| AppError::Skin(format!("MineSkin get failed: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::Skin("Skin not found".to_string()));
    }

    let mineskin: MineSkinResponse = response
        .json()
        .await
        .map_err(|e| AppError::Skin(format!("Failed to parse MineSkin response: {}", e)))?;

    // Determine variant from texture URL (contains "slim" in path for Alex model)
    let variant = if mineskin.texture.url.contains("slim") {
        SkinVariant::Slim
    } else {
        SkinVariant::Classic
    };

    Ok(MineSkinResult {
        uuid: mineskin.uuid,
        texture_url: mineskin.texture.url,
        skin_url: format!(
            "https://textures.minecraft.net/texture/{}",
            mineskin.texture.data.value
        ),
        variant,
    })
}

/// Parse MineSkin API response
async fn parse_mineskin_response(
    response: reqwest::Response,
    variant: &SkinVariant,
) -> AppResult<MineSkinResult> {
    let status = response.status();

    if status.as_u16() == 429 {
        return Err(AppError::Skin(
            "Rate limited. Please wait before trying again.".to_string(),
        ));
    }

    if !status.is_success() {
        let error: MineSkinErrorResponse = response.json().await.unwrap_or(MineSkinErrorResponse {
            error: Some("Unknown error".to_string()),
            error_code: None,
        });
        return Err(AppError::Skin(format!(
            "MineSkin error: {}",
            error.error.unwrap_or_else(|| "Unknown error".to_string())
        )));
    }

    let mineskin: MineSkinResponse = response
        .json()
        .await
        .map_err(|e| AppError::Skin(format!("Failed to parse MineSkin response: {}", e)))?;

    Ok(MineSkinResult {
        uuid: mineskin.uuid,
        texture_url: mineskin.texture.url.clone(),
        skin_url: mineskin.texture.url,
        variant: variant.clone(),
    })
}

// ==================== Gallery API (v2) ====================

const TEXTURE_BASE_URL: &str = "https://textures.minecraft.net/texture";
const RENDER_BASE_URL: &str = "https://mc-heads.net/body";

/// Response from MineSkin v2 list API
#[derive(Debug, Deserialize)]
struct MineSkinV2ListResponse {
    success: Option<bool>,
    skins: Vec<MineSkinV2Item>,
    pagination: Option<MineSkinV2Pagination>,
}

#[derive(Debug, Deserialize)]
struct MineSkinV2Item {
    uuid: String,
    #[serde(rename = "shortId")]
    short_id: Option<String>,
    name: Option<String>,
    texture: String,
    variant: Option<String>,
    timestamp: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct MineSkinV2Pagination {
    next: Option<MineSkinV2Next>,
}

#[derive(Debug, Deserialize)]
struct MineSkinV2Next {
    after: Option<String>,
}

/// Get list of public skins from MineSkin v2 gallery
pub async fn list_skins(
    client: &reqwest::Client,
    page: u32,
    size: u32,
) -> AppResult<SearchSkinsResponse> {
    let response = client
        .get(format!("{}/v2/skins?size={}", MINESKIN_API, size))
        .header("User-Agent", "KaizenLauncher/1.0")
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| AppError::Skin(format!("MineSkin list failed: {}", e)))?;

    if !response.status().is_success() {
        log::warn!("MineSkin list returned status {}", response.status());
        return Ok(SearchSkinsResponse {
            skins: vec![],
            total: 0,
            page,
            has_more: false,
        });
    }

    let list: MineSkinV2ListResponse = response
        .json()
        .await
        .map_err(|e| AppError::Skin(format!("Failed to parse MineSkin list: {}", e)))?;

    let skins: Vec<CommunitySkin> = list
        .skins
        .into_iter()
        .map(|item| {
            let texture_url = format!("{}/{}", TEXTURE_BASE_URL, item.texture);
            // Use mc-heads.net to render a 3D body preview from the texture hash
            let thumbnail_url = format!("{}/{}", RENDER_BASE_URL, item.texture);
            CommunitySkin {
                id: item.uuid.clone(),
                name: item.name.unwrap_or_else(|| {
                    item.short_id
                        .clone()
                        .unwrap_or_else(|| format!("Skin {}", &item.uuid[..8.min(item.uuid.len())]))
                }),
                url: texture_url,
                thumbnail_url,
                variant: match item.variant.as_deref() {
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

    let has_more = list
        .pagination
        .and_then(|p| p.next)
        .and_then(|n| n.after)
        .is_some();

    Ok(SearchSkinsResponse {
        skins,
        total: 0, // v2 API doesn't give total count directly
        page,
        has_more,
    })
}

/// Search skins on MineSkin - v2 API doesn't have search, so we use the list
/// Note: MineSkin v2 doesn't support text search, just listing
pub async fn search_skins(
    client: &reqwest::Client,
    _query: &str,
    page: u32,
) -> AppResult<SearchSkinsResponse> {
    // MineSkin v2 doesn't support search queries, just return the list
    // Users can still see skins from the gallery
    list_skins(client, page, 24).await
}
