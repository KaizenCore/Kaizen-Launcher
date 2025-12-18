// OptiFine cape integration
#![allow(dead_code)]

use crate::error::AppResult;
use crate::skins::{Cape, CapeSource};

// Use HTTPS and the main domain for better compatibility
const OPTIFINE_CAPES_URL: &str = "https://optifine.net/capes";

/// Get OptiFine cape for a player by username
/// Returns None if the player has no OptiFine cape
pub async fn get_cape(client: &reqwest::Client, username: &str) -> AppResult<Option<Cape>> {
    let url = format!("{}/{}.png", OPTIFINE_CAPES_URL, username);

    // Try HEAD request first to check if cape exists
    let response = client
        .head(&url)
        .header("User-Agent", "KaizenLauncher/1.0")
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await;

    match response {
        Ok(resp) => {
            // OptiFine returns 404 if user has no cape
            if resp.status().as_u16() == 404 {
                return Ok(None);
            }

            if !resp.status().is_success() {
                log::debug!(
                    "OptiFine cape check failed for {}: HTTP {}",
                    username,
                    resp.status()
                );
                return Ok(None);
            }

            Ok(Some(Cape {
                id: format!("optifine_{}", username.to_lowercase()),
                name: "OptiFine Cape".to_string(),
                url,
                source: CapeSource::OptiFine,
            }))
        }
        Err(e) => {
            // Network error - log but don't fail
            log::debug!("OptiFine cape check failed for {}: {}", username, e);
            Ok(None)
        }
    }
}

/// Get OptiFine cape URL for a player (doesn't check if it exists)
pub fn get_cape_url(username: &str) -> String {
    format!("{}/{}.png", OPTIFINE_CAPES_URL, username)
}
