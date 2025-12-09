use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XboxLiveToken {
    pub token: String,
    pub user_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XstsToken {
    pub token: String,
    pub user_hash: String,
}

#[derive(Debug, Serialize)]
struct XboxAuthRequest {
    #[serde(rename = "Properties")]
    properties: XboxAuthProperties,
    #[serde(rename = "RelyingParty")]
    relying_party: String,
    #[serde(rename = "TokenType")]
    token_type: String,
}

#[derive(Debug, Serialize)]
struct XboxAuthProperties {
    #[serde(rename = "AuthMethod")]
    auth_method: String,
    #[serde(rename = "SiteName")]
    site_name: String,
    #[serde(rename = "RpsTicket")]
    rps_ticket: String,
}

#[derive(Debug, Serialize)]
struct XstsAuthRequest {
    #[serde(rename = "Properties")]
    properties: XstsAuthProperties,
    #[serde(rename = "RelyingParty")]
    relying_party: String,
    #[serde(rename = "TokenType")]
    token_type: String,
}

#[derive(Debug, Serialize)]
struct XstsAuthProperties {
    #[serde(rename = "SandboxId")]
    sandbox_id: String,
    #[serde(rename = "UserTokens")]
    user_tokens: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct XboxAuthResponse {
    #[serde(rename = "Token")]
    token: String,
    #[serde(rename = "DisplayClaims")]
    display_claims: DisplayClaims,
}

#[derive(Debug, Deserialize)]
struct DisplayClaims {
    xui: Vec<XuiClaim>,
}

#[derive(Debug, Deserialize)]
struct XuiClaim {
    uhs: String,
}

#[derive(Debug, Deserialize)]
struct XstsErrorResponse {
    #[serde(rename = "XErr")]
    xerr: Option<u64>,
    #[serde(rename = "Message")]
    message: Option<String>,
}

pub async fn authenticate_xbox_live(
    client: &reqwest::Client,
    microsoft_token: &str,
) -> AppResult<XboxLiveToken> {
    let request = XboxAuthRequest {
        properties: XboxAuthProperties {
            auth_method: "RPS".to_string(),
            site_name: "user.auth.xboxlive.com".to_string(),
            rps_ticket: format!("d={}", microsoft_token),
        },
        relying_party: "http://auth.xboxlive.com".to_string(),
        token_type: "JWT".to_string(),
    };

    let response = client
        .post("https://user.auth.xboxlive.com/user/authenticate")
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .json(&request)
        .send()
        .await
        .map_err(|e| AppError::Auth(format!("Xbox Live auth failed: {}", e)))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(AppError::Auth(format!(
            "Xbox Live auth failed: {}",
            error_text
        )));
    }

    let auth_response: XboxAuthResponse = response
        .json()
        .await
        .map_err(|e| AppError::Auth(format!("Failed to parse Xbox Live response: {}", e)))?;

    let user_hash = auth_response
        .display_claims
        .xui
        .first()
        .map(|x| x.uhs.clone())
        .ok_or_else(|| AppError::Auth("No user hash in Xbox Live response".to_string()))?;

    Ok(XboxLiveToken {
        token: auth_response.token,
        user_hash,
    })
}

pub async fn get_xsts_token(client: &reqwest::Client, xbox_token: &str) -> AppResult<XstsToken> {
    let request = XstsAuthRequest {
        properties: XstsAuthProperties {
            sandbox_id: "RETAIL".to_string(),
            user_tokens: vec![xbox_token.to_string()],
        },
        relying_party: "rp://api.minecraftservices.com/".to_string(),
        token_type: "JWT".to_string(),
    };

    let response = client
        .post("https://xsts.auth.xboxlive.com/xsts/authorize")
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .json(&request)
        .send()
        .await
        .map_err(|e| AppError::Auth(format!("XSTS auth failed: {}", e)))?;

    let status = response.status();
    let body = response.text().await.unwrap_or_default();

    if !status.is_success() {
        // Check for specific Xbox errors
        if let Ok(error) = serde_json::from_str::<XstsErrorResponse>(&body) {
            let error_msg = match error.xerr {
                Some(2148916233) => "This Microsoft account is not linked to an Xbox account. Please create one first.".to_string(),
                Some(2148916235) => "Xbox Live is not available in your country/region.".to_string(),
                Some(2148916236) | Some(2148916237) => "This account requires adult verification on Xbox page.".to_string(),
                Some(2148916238) => "This is a child account. Add it to a Family first.".to_string(),
                _ => format!("XSTS error: {}", error.message.unwrap_or(body.clone())),
            };
            return Err(AppError::Auth(error_msg));
        }
        return Err(AppError::Auth(format!("XSTS auth failed: {}", body)));
    }

    let auth_response: XboxAuthResponse = serde_json::from_str(&body)
        .map_err(|e| AppError::Auth(format!("Failed to parse XSTS response: {}", e)))?;

    let user_hash = auth_response
        .display_claims
        .xui
        .first()
        .map(|x| x.uhs.clone())
        .ok_or_else(|| AppError::Auth("No user hash in XSTS response".to_string()))?;

    Ok(XstsToken {
        token: auth_response.token,
        user_hash,
    })
}
