use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};

// Microsoft Azure AD application for Minecraft authentication
// Kaizen Launcher Azure AD app (Personal accounts only)
const CLIENT_ID: &str = "0fb7e88e-feba-42e3-aaa7-79c18e2d1420";
const SCOPE: &str = "XboxLive.signin XboxLive.offline_access";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceCodeResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MicrosoftToken {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: u64,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: u64,
    #[allow(dead_code)]
    token_type: String,
}

#[derive(Debug, Deserialize)]
struct DeviceCodeApiResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_in: u64,
    interval: u64,
}

#[derive(Debug, Deserialize)]
struct TokenErrorResponse {
    error: String,
    error_description: Option<String>,
}

pub async fn request_device_code(client: &reqwest::Client) -> AppResult<DeviceCodeResponse> {
    let response = client
        .post("https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode")
        .form(&[("client_id", CLIENT_ID), ("scope", SCOPE)])
        .send()
        .await
        .map_err(|e| AppError::Auth(format!("Failed to request device code: {}", e)))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(AppError::Auth(format!(
            "Device code request failed: {}",
            error_text
        )));
    }

    let device_code: DeviceCodeApiResponse = response
        .json()
        .await
        .map_err(|e| AppError::Auth(format!("Failed to parse device code response: {}", e)))?;

    Ok(DeviceCodeResponse {
        device_code: device_code.device_code,
        user_code: device_code.user_code,
        verification_uri: device_code.verification_uri,
        expires_in: device_code.expires_in,
        interval: device_code.interval,
    })
}

pub async fn poll_for_token(
    client: &reqwest::Client,
    device_code: &str,
    interval: u64,
    expires_in: u64,
) -> AppResult<MicrosoftToken> {
    let start = std::time::Instant::now();
    let timeout = std::time::Duration::from_secs(expires_in);
    let poll_interval = std::time::Duration::from_secs(interval.max(5));

    loop {
        if start.elapsed() > timeout {
            return Err(AppError::Auth("Authentication timeout".to_string()));
        }

        tokio::time::sleep(poll_interval).await;

        let response = client
            .post("https://login.microsoftonline.com/consumers/oauth2/v2.0/token")
            .form(&[
                ("client_id", CLIENT_ID),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
                ("device_code", device_code),
            ])
            .send()
            .await
            .map_err(|e| AppError::Auth(format!("Token poll failed: {}", e)))?;

        let status = response.status();
        let body = response.text().await.unwrap_or_default();

        if status.is_success() {
            let token: TokenResponse = serde_json::from_str(&body)
                .map_err(|e| AppError::Auth(format!("Failed to parse token: {}", e)))?;

            return Ok(MicrosoftToken {
                access_token: token.access_token,
                refresh_token: token.refresh_token.unwrap_or_default(),
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
                "authorization_declined" => {
                    return Err(AppError::Auth("User declined authorization".to_string()));
                }
                "expired_token" => {
                    return Err(AppError::Auth("Device code expired".to_string()));
                }
                _ => {
                    return Err(AppError::Auth(format!(
                        "Authentication error: {}",
                        error.error_description.unwrap_or(error.error)
                    )));
                }
            }
        }
    }
}

pub async fn refresh_token(
    client: &reqwest::Client,
    refresh_token: &str,
) -> AppResult<MicrosoftToken> {
    let response = client
        .post("https://login.microsoftonline.com/consumers/oauth2/v2.0/token")
        .form(&[
            ("client_id", CLIENT_ID),
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("scope", SCOPE),
        ])
        .send()
        .await
        .map_err(|e| AppError::Auth(format!("Token refresh failed: {}", e)))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(AppError::Auth(format!(
            "Token refresh failed: {}",
            error_text
        )));
    }

    let token: TokenResponse = response
        .json()
        .await
        .map_err(|e| AppError::Auth(format!("Failed to parse refresh response: {}", e)))?;

    Ok(MicrosoftToken {
        access_token: token.access_token,
        refresh_token: token
            .refresh_token
            .unwrap_or_else(|| refresh_token.to_string()),
        expires_in: token.expires_in,
    })
}
