use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};

// Kaizen OAuth configuration from environment variables (set at build time)
// To build: KAIZEN_OAUTH_CLIENT_ID=your_client_id cargo build
// Optional: KAIZEN_OAUTH_BASE_URL=http://localhost:8000 (for testing)
const KAIZEN_CLIENT_ID: &str = env!("KAIZEN_OAUTH_CLIENT_ID");

// Use custom base URL if provided, otherwise default to production
const KAIZEN_API_BASE: &str = match option_env!("KAIZEN_OAUTH_BASE_URL") {
    Some(url) => url,
    None => "https://kaizencore.tech",
};

const KAIZEN_SCOPE: &str = "user:read";

/// Device code response from Kaizen OAuth
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KaizenDeviceCode {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

/// Token response from Kaizen OAuth
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KaizenToken {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: u64,
}

/// User info from Kaizen API (user:read scope)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KaizenUser {
    pub id: String,
    pub name: String,
    pub email: String,
    pub tags: Vec<KaizenTag>,
    pub badges: Vec<KaizenBadge>,
}

/// Tag with permissions
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KaizenTag {
    pub name: String,
    pub permissions: Vec<String>,
}

/// Badge with full styling info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KaizenBadge {
    pub slug: String,
    pub name: String,
    #[serde(rename = "type")]
    pub badge_type: String,
    pub icon: Option<String>,
    pub style: Option<KaizenBadgeStyle>,
    pub permissions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KaizenBadgeStyle {
    #[serde(rename = "backgroundColor")]
    pub background_color: Option<String>,
    #[serde(rename = "textColor")]
    pub text_color: Option<String>,
    #[serde(rename = "borderColor")]
    pub border_color: Option<String>,
    pub palette: Option<String>,
}

// Internal API response structures
#[derive(Debug, Deserialize)]
struct DeviceCodeApiResponse {
    device_code: String,
    user_code: String,
    verification_uri: Option<String>,
    expires_in: u64,
    interval: u64,
}

#[derive(Debug, Deserialize)]
struct TokenApiResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: u64,
    #[allow(dead_code)]
    token_type: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TokenErrorResponse {
    error: String,
    error_description: Option<String>,
}

// API wraps response in "data" object
#[derive(Debug, Deserialize)]
struct UserApiWrapper {
    data: UserApiResponse,
}

#[derive(Debug, Deserialize)]
struct UserApiResponse {
    id: i64,  // API returns number, not string
    name: String,
    email: String,
    tags: Option<Vec<TagApiResponse>>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct TagApiResponse {
    slug: String,
    name: String,
    #[serde(rename = "type")]
    tag_type: Option<String>,
    permissions: Option<Vec<String>>,
}

/// Request a device code for Kaizen OAuth
pub async fn request_device_code(client: &reqwest::Client) -> AppResult<KaizenDeviceCode> {
    // Try JSON body format
    let body = serde_json::json!({
        "client_id": KAIZEN_CLIENT_ID,
        "scope": KAIZEN_SCOPE
    });

    log::info!("Requesting Kaizen device code with scope: {}", KAIZEN_SCOPE);

    let response = client
        .post(format!("{}/oauth/device/code", KAIZEN_API_BASE))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Auth(format!("Failed to request Kaizen device code: {}", e)))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(AppError::Auth(format!(
            "Kaizen device code request failed: {}",
            error_text
        )));
    }

    let device_code: DeviceCodeApiResponse = response
        .json()
        .await
        .map_err(|e| AppError::Auth(format!("Failed to parse Kaizen device code response: {}", e)))?;

    Ok(KaizenDeviceCode {
        device_code: device_code.device_code,
        user_code: device_code.user_code,
        verification_uri: device_code
            .verification_uri
            .unwrap_or_else(|| format!("{}/oauth/device", KAIZEN_API_BASE)),
        expires_in: device_code.expires_in,
        interval: device_code.interval,
    })
}

/// Poll for token until user approves or timeout
pub async fn poll_for_token(
    client: &reqwest::Client,
    device_code: &str,
    interval: u64,
    expires_in: u64,
) -> AppResult<KaizenToken> {
    let start = std::time::Instant::now();
    let timeout = std::time::Duration::from_secs(expires_in);
    let poll_interval = std::time::Duration::from_secs(interval.max(5));

    loop {
        if start.elapsed() > timeout {
            return Err(AppError::Auth("Kaizen authentication timeout".to_string()));
        }

        tokio::time::sleep(poll_interval).await;

        // OAuth token endpoint typically expects form-encoded data
        let response = client
            .post(format!("{}/oauth/token", KAIZEN_API_BASE))
            .form(&[
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
                ("client_id", KAIZEN_CLIENT_ID),
                ("device_code", device_code),
            ])
            .send()
            .await
            .map_err(|e| AppError::Auth(format!("Kaizen token poll failed: {}", e)))?;

        let status = response.status();
        let body = response.text().await.unwrap_or_default();

        if status.is_success() {
            let token: TokenApiResponse = serde_json::from_str(&body)
                .map_err(|e| AppError::Auth(format!("Failed to parse Kaizen token: {}", e)))?;

            return Ok(KaizenToken {
                access_token: token.access_token,
                refresh_token: token.refresh_token,
                expires_in: token.expires_in,
            });
        }

        // Check if still pending
        if let Ok(error) = serde_json::from_str::<TokenErrorResponse>(&body) {
            match error.error.as_str() {
                "authorization_pending" => continue,
                "slow_down" => {
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                    continue;
                }
                "authorization_declined" | "access_denied" => {
                    return Err(AppError::Auth("User declined Kaizen authorization".to_string()));
                }
                "expired_token" => {
                    return Err(AppError::Auth("Kaizen device code expired".to_string()));
                }
                _ => {
                    return Err(AppError::Auth(format!(
                        "Kaizen authentication error: {}",
                        error.error_description.unwrap_or(error.error)
                    )));
                }
            }
        }
    }
}

/// Get user info from Kaizen API
pub async fn get_user_info(client: &reqwest::Client, access_token: &str) -> AppResult<KaizenUser> {
    let response = client
        .get(format!("{}/api/v1/user", KAIZEN_API_BASE))
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
        .map_err(|e| AppError::Auth(format!("Failed to connect to Kaizen API: {}", e)))?;

    let status = response.status();

    if !status.is_success() {
        let error_text = response.text().await.unwrap_or_default();

        log::error!("Kaizen API error {}: {}", status.as_u16(), &error_text[..error_text.len().min(500)]);

        // Detect specific error types for clearer messages
        if status.as_u16() == 401 {
            return Err(AppError::Auth(
                "Kaizen session expired. Please reconnect your account.".to_string()
            ));
        } else if status.as_u16() == 403 {
            // Log the full error for debugging
            log::error!("Kaizen API 403 error - Full response: {}", error_text);

            // Check if it's a scope error
            if error_text.contains("scope") || error_text.contains("Invalid scope") {
                return Err(AppError::Auth(format!(
                    "Kaizen API scope error. The requested scope '{}' may not be configured correctly on the server. Error: {}",
                    KAIZEN_SCOPE,
                    if error_text.len() > 200 { &error_text[..200] } else { &error_text }
                )));
            }
            return Err(AppError::Auth(
                "Access denied. Please check your Kaizen account permissions.".to_string()
            ));
        } else if status.as_u16() == 404 {
            return Err(AppError::Auth(
                "Kaizen API endpoint not found. The service may be temporarily unavailable.".to_string()
            ));
        } else if status.is_server_error() {
            return Err(AppError::Auth(
                "Kaizen server error. Please try again later.".to_string()
            ));
        }

        return Err(AppError::Auth(format!(
            "Failed to get Kaizen user info ({}): {}",
            status.as_u16(),
            if error_text.len() > 200 { "Server returned an error" } else { &error_text }
        )));
    }

    // Get response body as text first for debugging
    let body_text = response.text().await
        .map_err(|e| AppError::Auth(format!("Failed to read Kaizen user info response: {}", e)))?;

    log::debug!("Kaizen user info response: {}", body_text);

    let wrapper: UserApiWrapper = serde_json::from_str(&body_text)
        .map_err(|e| AppError::Auth(format!("Failed to parse Kaizen user info: {}. Response was: {}", e, body_text)))?;

    let user = wrapper.data;

    let tags: Vec<KaizenTag> = user
        .tags
        .unwrap_or_default()
        .into_iter()
        .map(|t| KaizenTag {
            name: t.name,
            permissions: t.permissions.unwrap_or_default(),
        })
        .collect();

    // Fetch badges
    let badges = get_user_badges(client, access_token).await.unwrap_or_default();

    Ok(KaizenUser {
        id: user.id.to_string(),  // Convert i64 to String
        name: user.name,
        email: user.email,
        tags,
        badges,
    })
}

// Badge API response wrapper
#[derive(Debug, Deserialize)]
struct BadgesApiWrapper {
    data: Vec<BadgeApiResponse>,
}

#[derive(Debug, Deserialize)]
struct BadgeApiResponse {
    slug: String,
    name: String,
    #[serde(rename = "type")]
    badge_type: String,
    icon: Option<String>,
    style: Option<BadgeStyleApiResponse>,
    permissions: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct BadgeStyleApiResponse {
    #[serde(rename = "backgroundColor")]
    background_color: Option<String>,
    #[serde(rename = "textColor")]
    text_color: Option<String>,
    #[serde(rename = "borderColor")]
    border_color: Option<String>,
    palette: Option<String>,
}

/// Get user badges from Kaizen API
async fn get_user_badges(client: &reqwest::Client, access_token: &str) -> AppResult<Vec<KaizenBadge>> {
    let response = client
        .get(format!("{}/api/v1/user/badges", KAIZEN_API_BASE))
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
        .map_err(|e| {
            log::warn!("Failed to connect to badges API: {}", e);
            AppError::Auth(format!("Failed to get Kaizen badges: {}", e))
        })?;

    let status = response.status();

    if !status.is_success() {
        let error_text = response.text().await.unwrap_or_default();
        // Log but don't fail - badges are optional
        if status.as_u16() == 403 && (error_text.contains("scope") || error_text.contains("Invalid scope")) {
            log::warn!("Badges API requires different scope - skipping");
        } else {
            log::warn!("Failed to get Kaizen badges ({}): {}", status.as_u16(),
                if error_text.len() > 200 { "Server error" } else { &error_text });
        }
        return Ok(vec![]);
    }

    let body_text = response.text().await
        .map_err(|e| AppError::Auth(format!("Failed to read badges response: {}", e)))?;

    log::debug!("Kaizen badges response: {}", body_text);

    let wrapper: BadgesApiWrapper = serde_json::from_str(&body_text)
        .map_err(|e| {
            log::warn!("Failed to parse badges: {}. Response: {}", e, body_text);
            AppError::Auth(format!("Failed to parse badges: {}", e))
        })?;

    let badges: Vec<KaizenBadge> = wrapper.data
        .into_iter()
        .map(|b| KaizenBadge {
            slug: b.slug,
            name: b.name,
            badge_type: b.badge_type,
            icon: b.icon,
            style: b.style.map(|s| KaizenBadgeStyle {
                background_color: s.background_color,
                text_color: s.text_color,
                border_color: s.border_color,
                palette: s.palette,
            }),
            permissions: b.permissions.unwrap_or_default(),
        })
        .collect();

    Ok(badges)
}

/// Refresh an expired token using refresh_token
pub async fn refresh_token(client: &reqwest::Client, refresh_token: &str) -> AppResult<KaizenToken> {
    let response = client
        .post(format!("{}/oauth/token", KAIZEN_API_BASE))
        .form(&[
            ("grant_type", "refresh_token"),
            ("client_id", KAIZEN_CLIENT_ID),
            ("refresh_token", refresh_token),
        ])
        .send()
        .await
        .map_err(|e| AppError::Auth(format!("Failed to connect to Kaizen: {}", e)))?;

    let status = response.status();
    let body = response.text().await.unwrap_or_default();

    if status.is_success() {
        let token: TokenApiResponse = serde_json::from_str(&body)
            .map_err(|e| AppError::Auth(format!("Failed to parse refreshed token: {}", e)))?;

        Ok(KaizenToken {
            access_token: token.access_token,
            refresh_token: token.refresh_token,
            expires_in: token.expires_in,
        })
    } else {
        // Try to parse error response
        if let Ok(error) = serde_json::from_str::<TokenErrorResponse>(&body) {
            let error_msg = error.error_description.unwrap_or(error.error);

            // Provide clearer messages for common errors
            if error_msg.contains("invalid_grant") || error_msg.contains("expired") {
                return Err(AppError::Auth(
                    "Kaizen session expired. Please reconnect your account.".to_string()
                ));
            }

            Err(AppError::Auth(format!("Token refresh failed: {}", error_msg)))
        } else if status.is_server_error() {
            Err(AppError::Auth("Kaizen server error. Please try again later.".to_string()))
        } else {
            Err(AppError::Auth(format!(
                "Token refresh failed ({})",
                status.as_u16()
            )))
        }
    }
}

/// Revoke a Kaizen token
pub async fn revoke_token(client: &reqwest::Client, access_token: &str) -> AppResult<()> {
    let response = client
        .delete(format!("{}/api/v1/token", KAIZEN_API_BASE))
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
        .map_err(|e| AppError::Auth(format!("Failed to revoke Kaizen token: {}", e)))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(AppError::Auth(format!(
            "Failed to revoke Kaizen token: {}",
            error_text
        )));
    }

    Ok(())
}

/// Extract all permissions from user tags
pub fn extract_permissions(user: &KaizenUser) -> Vec<String> {
    let mut permissions = Vec::new();
    for tag in &user.tags {
        permissions.extend(tag.permissions.clone());
    }
    // Deduplicate
    permissions.sort();
    permissions.dedup();
    permissions
}

/// Check if user has patron status based on tags
pub fn is_patron(user: &KaizenUser) -> bool {
    user.tags
        .iter()
        .any(|t| t.name.to_lowercase().contains("patron") || t.name.to_lowercase().contains("supporter"))
}
