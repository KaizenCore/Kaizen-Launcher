// OptiFine cape integration
#![allow(dead_code)]

use crate::error::{AppError, AppResult};
use crate::skins::{Cape, CapeSource};

const OPTIFINE_CAPES_URL: &str = "http://s.optifine.net/capes";

/// Get OptiFine cape for a player by username
/// Returns None if the player has no OptiFine cape
pub async fn get_cape(client: &reqwest::Client, username: &str) -> AppResult<Option<Cape>> {
    let url = format!("{}/{}.png", OPTIFINE_CAPES_URL, username);

    let response = client
        .head(&url)
        .header("User-Agent", "KaizenLauncher/1.0")
        .send()
        .await
        .map_err(|e| AppError::Skin(format!("Failed to check OptiFine cape: {}", e)))?;

    // OptiFine returns 404 if user has no cape
    if response.status().as_u16() == 404 {
        return Ok(None);
    }

    if !response.status().is_success() {
        return Ok(None);
    }

    Ok(Some(Cape {
        id: format!("optifine_{}", username.to_lowercase()),
        name: "OptiFine Cape".to_string(),
        url,
        source: CapeSource::OptiFine,
    }))
}

/// Get OptiFine cape URL for a player (doesn't check if it exists)
pub fn get_cape_url(username: &str) -> String {
    format!("{}/{}.png", OPTIFINE_CAPES_URL, username)
}
