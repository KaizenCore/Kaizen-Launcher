use crate::error::{AppError, AppResult};
use crate::skins::{Cape, CapeSource, Skin, SkinSource, SkinVariant};
use reqwest::multipart::{Form, Part};
use serde::{Deserialize, Serialize};

const MINECRAFT_SERVICES_API: &str = "https://api.minecraftservices.com";

/// Profile response from Minecraft Services API
#[derive(Debug, Deserialize)]
struct ProfileResponse {
    #[allow(dead_code)] // Deserialized but not used directly
    id: String,
    name: String,
    skins: Option<Vec<SkinResponse>>,
    capes: Option<Vec<CapeResponse>>,
}

#[derive(Debug, Deserialize)]
struct SkinResponse {
    id: String,
    state: String,
    url: String,
    variant: String,
}

#[derive(Debug, Deserialize)]
struct CapeResponse {
    id: String,
    state: String,
    url: String,
    alias: String,
}

/// Get current skin and capes for an authenticated user
pub async fn get_profile_skins(
    client: &reqwest::Client,
    access_token: &str,
) -> AppResult<(Option<Skin>, Vec<Cape>, Option<Cape>)> {
    let response = client
        .get(format!("{}/minecraft/profile", MINECRAFT_SERVICES_API))
        .header("Authorization", format!("Bearer {}", access_token))
        .header("User-Agent", "KaizenLauncher/1.0")
        .send()
        .await
        .map_err(|e| AppError::Skin(format!("Failed to fetch profile: {}", e)))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response.text().await.unwrap_or_default();
        // Return specific error for unauthorized (expired/invalid token)
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(AppError::Skin("TOKEN_EXPIRED".to_string()));
        }
        return Err(AppError::Skin(format!(
            "Profile fetch failed ({}): {}",
            status,
            error_text
        )));
    }

    let profile: ProfileResponse = response
        .json()
        .await
        .map_err(|e| AppError::Skin(format!("Failed to parse profile: {}", e)))?;

    // Find active skin
    let current_skin = profile.skins.as_ref().and_then(|skins| {
        skins.iter().find(|s| s.state == "ACTIVE").map(|s| Skin {
            id: s.id.clone(),
            name: profile.name.clone(),
            url: s.url.clone(),
            variant: if s.variant.to_lowercase() == "slim" {
                SkinVariant::Slim
            } else {
                SkinVariant::Classic
            },
            source: SkinSource::Mojang,
            author: None,
            thumbnail_url: None,
        })
    });

    // Get all capes
    let available_capes: Vec<Cape> = profile
        .capes
        .as_ref()
        .map(|capes| {
            capes
                .iter()
                .map(|c| Cape {
                    id: c.id.clone(),
                    name: cape_alias_to_name(&c.alias),
                    url: c.url.clone(),
                    source: CapeSource::Mojang,
                })
                .collect()
        })
        .unwrap_or_default();

    // Find active cape
    let current_cape = profile.capes.as_ref().and_then(|capes| {
        capes.iter().find(|c| c.state == "ACTIVE").map(|c| Cape {
            id: c.id.clone(),
            name: cape_alias_to_name(&c.alias),
            url: c.url.clone(),
            source: CapeSource::Mojang,
        })
    });

    Ok((current_skin, available_capes, current_cape))
}

/// Upload a new skin to the user's account
pub async fn upload_skin(
    client: &reqwest::Client,
    access_token: &str,
    skin_data: Vec<u8>,
    variant: &SkinVariant,
) -> AppResult<()> {
    let form = Form::new()
        .part(
            "file",
            Part::bytes(skin_data)
                .file_name("skin.png")
                .mime_str("image/png")
                .map_err(|e| AppError::Skin(format!("Failed to create form part: {}", e)))?,
        )
        .text("variant", variant.to_string());

    let response = client
        .post(format!(
            "{}/minecraft/profile/skins",
            MINECRAFT_SERVICES_API
        ))
        .header("Authorization", format!("Bearer {}", access_token))
        .header("User-Agent", "KaizenLauncher/1.0")
        .multipart(form)
        .send()
        .await
        .map_err(|e| AppError::Skin(format!("Failed to upload skin: {}", e)))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(AppError::Skin(format!(
            "Skin upload failed: {}",
            error_text
        )));
    }

    Ok(())
}

/// Upload a skin from URL to the user's account
pub async fn upload_skin_from_url(
    client: &reqwest::Client,
    access_token: &str,
    skin_url: &str,
    variant: &SkinVariant,
) -> AppResult<()> {
    #[derive(Serialize)]
    struct UploadRequest {
        url: String,
        variant: String,
    }

    let request = UploadRequest {
        url: skin_url.to_string(),
        variant: variant.to_string(),
    };

    let response = client
        .post(format!(
            "{}/minecraft/profile/skins",
            MINECRAFT_SERVICES_API
        ))
        .header("Authorization", format!("Bearer {}", access_token))
        .header("User-Agent", "KaizenLauncher/1.0")
        .header("Content-Type", "application/json")
        .json(&request)
        .send()
        .await
        .map_err(|e| AppError::Skin(format!("Failed to upload skin from URL: {}", e)))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(AppError::Skin(format!(
            "Skin upload failed: {}",
            error_text
        )));
    }

    Ok(())
}

/// Reset skin to default (Steve)
pub async fn reset_skin(client: &reqwest::Client, access_token: &str) -> AppResult<()> {
    let response = client
        .delete(format!(
            "{}/minecraft/profile/skins/active",
            MINECRAFT_SERVICES_API
        ))
        .header("Authorization", format!("Bearer {}", access_token))
        .header("User-Agent", "KaizenLauncher/1.0")
        .send()
        .await
        .map_err(|e| AppError::Skin(format!("Failed to reset skin: {}", e)))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(AppError::Skin(format!("Skin reset failed: {}", error_text)));
    }

    Ok(())
}

/// Set active cape (or hide cape if cape_id is None)
pub async fn set_active_cape(
    client: &reqwest::Client,
    access_token: &str,
    cape_id: Option<&str>,
) -> AppResult<()> {
    match cape_id {
        Some(id) => {
            #[derive(Serialize)]
            struct SetCapeRequest {
                #[serde(rename = "capeId")]
                cape_id: String,
            }

            let request = SetCapeRequest {
                cape_id: id.to_string(),
            };

            let response = client
                .put(format!(
                    "{}/minecraft/profile/capes/active",
                    MINECRAFT_SERVICES_API
                ))
                .header("Authorization", format!("Bearer {}", access_token))
                .header("User-Agent", "KaizenLauncher/1.0")
                .header("Content-Type", "application/json")
                .json(&request)
                .send()
                .await
                .map_err(|e| AppError::Skin(format!("Failed to set cape: {}", e)))?;

            if !response.status().is_success() {
                let error_text = response.text().await.unwrap_or_default();
                return Err(AppError::Skin(format!("Set cape failed: {}", error_text)));
            }
        }
        None => {
            // Hide cape
            let response = client
                .delete(format!(
                    "{}/minecraft/profile/capes/active",
                    MINECRAFT_SERVICES_API
                ))
                .header("Authorization", format!("Bearer {}", access_token))
                .header("User-Agent", "KaizenLauncher/1.0")
                .send()
                .await
                .map_err(|e| AppError::Skin(format!("Failed to hide cape: {}", e)))?;

            if !response.status().is_success() {
                let error_text = response.text().await.unwrap_or_default();
                return Err(AppError::Skin(format!("Hide cape failed: {}", error_text)));
            }
        }
    }

    Ok(())
}

/// Convert cape alias to human-readable name
fn cape_alias_to_name(alias: &str) -> String {
    match alias {
        "Migrator" => "Migrator Cape".to_string(),
        "Minecon2011" => "MINECON 2011 Cape".to_string(),
        "Minecon2012" => "MINECON 2012 Cape".to_string(),
        "Minecon2013" => "MINECON 2013 Cape".to_string(),
        "Minecon2015" => "MINECON 2015 Cape".to_string(),
        "Minecon2016" => "MINECON 2016 Cape".to_string(),
        "MinecraftRealms" => "Realms Mapmaker Cape".to_string(),
        "Mojang" => "Mojang Studios Cape".to_string(),
        "MojangClassic" => "Mojang Cape (Classic)".to_string(),
        "Translator" => "Translator Cape".to_string(),
        "Vanilla" => "Vanilla Cape".to_string(),
        "Cherry_blossom" => "Cherry Blossom Cape".to_string(),
        "Follower_anniversary_2024" => "Followers Cape".to_string(),
        _ => alias.replace('_', " "),
    }
}
