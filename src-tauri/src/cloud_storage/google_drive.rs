//! Google Drive OAuth and API integration for cloud backups
//!
//! Uses Device Code Flow for authentication (no web view needed).
//! Google Drive API v3 for file operations.

use crate::error::{AppError, AppResult};
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tokio::fs::File;
use tokio::io::AsyncReadExt;

use super::{ConnectionTestResult, DeviceCodeResponse, RemoteBackupInfo};

// OAuth endpoints
const GOOGLE_DEVICE_AUTH: &str = "https://oauth2.googleapis.com/device/code";
const GOOGLE_TOKEN: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_DRIVE_SCOPE: &str = "https://www.googleapis.com/auth/drive.file";

// Drive API endpoints
const DRIVE_FILES_API: &str = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_API: &str = "https://www.googleapis.com/upload/drive/v3/files";

/// Google OAuth tokens response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoogleTokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: u64,
    pub token_type: String,
}

/// Device code response from Google
#[derive(Debug, Deserialize)]
struct GoogleDeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_url: String,
    expires_in: u64,
    interval: u64,
}

/// Token error response
#[derive(Debug, Deserialize)]
struct TokenErrorResponse {
    error: String,
    #[serde(default)]
    error_description: Option<String>,
}

/// Drive file metadata
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DriveFile {
    id: String,
    name: String,
    #[serde(default)]
    size: Option<String>,
    #[serde(default)]
    modified_time: Option<String>,
}

/// Drive files list response
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DriveFilesListResponse {
    files: Vec<DriveFile>,
    #[serde(default)]
    next_page_token: Option<String>,
}

/// Drive about response (for quota info)
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DriveAboutResponse {
    storage_quota: StorageQuota,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StorageQuota {
    #[serde(default)]
    usage: Option<String>,
    #[serde(default)]
    limit: Option<String>,
}

/// Request device code for OAuth flow
pub async fn request_device_code(
    client: &reqwest::Client,
    client_id: &str,
) -> AppResult<DeviceCodeResponse> {
    let response = client
        .post(GOOGLE_DEVICE_AUTH)
        .form(&[
            ("client_id", client_id),
            ("scope", GOOGLE_DRIVE_SCOPE),
        ])
        .send()
        .await
        .map_err(|e| AppError::CloudStorage(format!("Failed to request device code: {}", e)))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(AppError::CloudStorage(format!(
            "Device code request failed: {}",
            error_text
        )));
    }

    let google_response: GoogleDeviceCodeResponse = response
        .json()
        .await
        .map_err(|e| AppError::CloudStorage(format!("Failed to parse device code response: {}", e)))?;

    Ok(DeviceCodeResponse {
        device_code: google_response.device_code,
        user_code: google_response.user_code,
        verification_uri: google_response.verification_url,
        expires_in: google_response.expires_in,
        interval: google_response.interval,
    })
}

/// Poll for OAuth token after user authorization
pub async fn poll_for_token(
    client: &reqwest::Client,
    client_id: &str,
    client_secret: &str,
    device_code: &str,
    interval: u64,
    expires_in: u64,
) -> AppResult<GoogleTokens> {
    let start = std::time::Instant::now();
    let timeout = std::time::Duration::from_secs(expires_in);
    let poll_interval = std::time::Duration::from_secs(interval.max(5));

    loop {
        if start.elapsed() > timeout {
            return Err(AppError::CloudStorage(
                "Authorization timed out. Please try again.".to_string(),
            ));
        }

        tokio::time::sleep(poll_interval).await;

        let response = client
            .post(GOOGLE_TOKEN)
            .form(&[
                ("client_id", client_id),
                ("client_secret", client_secret),
                ("device_code", device_code),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ])
            .send()
            .await
            .map_err(|e| AppError::CloudStorage(format!("Token request failed: {}", e)))?;

        let status = response.status();
        let body = response.text().await.unwrap_or_default();

        if status.is_success() {
            let tokens: GoogleTokens = serde_json::from_str(&body)
                .map_err(|e| AppError::CloudStorage(format!("Failed to parse tokens: {}", e)))?;
            return Ok(tokens);
        }

        // Check if we should keep polling
        if let Ok(error) = serde_json::from_str::<TokenErrorResponse>(&body) {
            match error.error.as_str() {
                "authorization_pending" => continue,
                "slow_down" => {
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                    continue;
                }
                "access_denied" => {
                    return Err(AppError::CloudStorage(
                        "Access was denied by the user".to_string(),
                    ));
                }
                "expired_token" => {
                    return Err(AppError::CloudStorage(
                        "The device code has expired. Please try again.".to_string(),
                    ));
                }
                _ => {
                    return Err(AppError::CloudStorage(format!(
                        "Authorization error: {} - {}",
                        error.error,
                        error.error_description.unwrap_or_default()
                    )));
                }
            }
        }
    }
}


/// Test connection to Google Drive
pub async fn test_connection(
    client: &reqwest::Client,
    access_token: &str,
) -> AppResult<ConnectionTestResult> {
    let response = client
        .get("https://www.googleapis.com/drive/v3/about")
        .query(&[("fields", "storageQuota")])
        .header(AUTHORIZATION, format!("Bearer {}", access_token))
        .send()
        .await
        .map_err(|e| AppError::CloudStorage(format!("Connection test failed: {}", e)))?;

    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Ok(ConnectionTestResult {
            success: false,
            message: "Token expired or invalid. Please re-authenticate.".to_string(),
            storage_used: None,
            storage_total: None,
        });
    }

    if !response.status().is_success() {
        return Ok(ConnectionTestResult {
            success: false,
            message: format!("Connection failed: HTTP {}", response.status()),
            storage_used: None,
            storage_total: None,
        });
    }

    let about: DriveAboutResponse = response
        .json()
        .await
        .map_err(|e| AppError::CloudStorage(format!("Failed to parse response: {}", e)))?;

    Ok(ConnectionTestResult {
        success: true,
        message: "Connected to Google Drive successfully".to_string(),
        storage_used: about.storage_quota.usage.and_then(|s| s.parse().ok()),
        storage_total: about.storage_quota.limit.and_then(|s| s.parse().ok()),
    })
}

/// Create or get the Kaizen Backups folder
pub async fn get_or_create_folder(
    client: &reqwest::Client,
    access_token: &str,
    folder_name: &str,
) -> AppResult<String> {
    // First, try to find existing folder
    let search_query = format!(
        "name='{}' and mimeType='application/vnd.google-apps.folder' and trashed=false",
        folder_name
    );

    let response = client
        .get(DRIVE_FILES_API)
        .query(&[("q", search_query.as_str()), ("fields", "files(id,name)")])
        .header(AUTHORIZATION, format!("Bearer {}", access_token))
        .send()
        .await
        .map_err(|e| AppError::CloudStorage(format!("Failed to search for folder: {}", e)))?;

    if response.status().is_success() {
        let list: DriveFilesListResponse = response.json().await.unwrap_or(DriveFilesListResponse {
            files: vec![],
            next_page_token: None,
        });

        if let Some(folder) = list.files.first() {
            return Ok(folder.id.clone());
        }
    }

    // Create new folder
    let metadata = serde_json::json!({
        "name": folder_name,
        "mimeType": "application/vnd.google-apps.folder"
    });

    let response = client
        .post(DRIVE_FILES_API)
        .header(AUTHORIZATION, format!("Bearer {}", access_token))
        .header(CONTENT_TYPE, "application/json")
        .json(&metadata)
        .send()
        .await
        .map_err(|e| AppError::CloudStorage(format!("Failed to create folder: {}", e)))?;

    if !response.status().is_success() {
        let error = response.text().await.unwrap_or_default();
        return Err(AppError::CloudStorage(format!(
            "Failed to create folder: {}",
            error
        )));
    }

    let folder: DriveFile = response
        .json()
        .await
        .map_err(|e| AppError::CloudStorage(format!("Failed to parse folder response: {}", e)))?;

    Ok(folder.id)
}

/// Upload a file to Google Drive
pub async fn upload_file(
    client: &reqwest::Client,
    access_token: &str,
    folder_id: &str,
    local_path: &Path,
    filename: &str,
    on_progress: Option<impl Fn(u64, u64) + Send + Sync>,
) -> AppResult<String> {
    // Read the file
    let mut file = File::open(local_path)
        .await
        .map_err(|e| AppError::CloudStorage(format!("Failed to open file: {}", e)))?;

    let file_size = file
        .metadata()
        .await
        .map_err(|e| AppError::CloudStorage(format!("Failed to get file metadata: {}", e)))?
        .len();

    let mut buffer = Vec::with_capacity(file_size as usize);
    file.read_to_end(&mut buffer)
        .await
        .map_err(|e| AppError::CloudStorage(format!("Failed to read file: {}", e)))?;

    if let Some(ref progress) = on_progress {
        progress(0, file_size);
    }

    // Create file metadata
    let metadata = serde_json::json!({
        "name": filename,
        "parents": [folder_id]
    });

    // Use multipart upload
    let boundary = "kaizen_upload_boundary";
    let mut body = Vec::new();

    // Metadata part
    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(b"Content-Type: application/json; charset=UTF-8\r\n\r\n");
    body.extend_from_slice(metadata.to_string().as_bytes());
    body.extend_from_slice(b"\r\n");

    // File part
    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(b"Content-Type: application/octet-stream\r\n\r\n");
    body.extend_from_slice(&buffer);
    body.extend_from_slice(format!("\r\n--{}--", boundary).as_bytes());

    let response = client
        .post(format!("{}?uploadType=multipart", DRIVE_UPLOAD_API))
        .header(AUTHORIZATION, format!("Bearer {}", access_token))
        .header(
            CONTENT_TYPE,
            format!("multipart/related; boundary={}", boundary),
        )
        .body(body)
        .send()
        .await
        .map_err(|e| AppError::CloudStorage(format!("Upload failed: {}", e)))?;

    if let Some(ref progress) = on_progress {
        progress(file_size, file_size);
    }

    if !response.status().is_success() {
        let error = response.text().await.unwrap_or_default();
        return Err(AppError::CloudStorage(format!("Upload failed: {}", error)));
    }

    let uploaded: DriveFile = response
        .json()
        .await
        .map_err(|e| AppError::CloudStorage(format!("Failed to parse upload response: {}", e)))?;

    Ok(uploaded.id)
}

/// List backup files in the Kaizen folder
pub async fn list_backups(
    client: &reqwest::Client,
    access_token: &str,
    folder_id: &str,
) -> AppResult<Vec<RemoteBackupInfo>> {
    let mut backups = Vec::new();
    let mut page_token: Option<String> = None;

    loop {
        let query = format!(
            "'{}' in parents and mimeType='application/zip' and trashed=false",
            folder_id
        );

        let mut request = client
            .get(DRIVE_FILES_API)
            .query(&[
                ("q", query.as_str()),
                ("fields", "files(id,name,size,modifiedTime),nextPageToken"),
                ("orderBy", "modifiedTime desc"),
                ("pageSize", "100"),
            ])
            .header(AUTHORIZATION, format!("Bearer {}", access_token));

        if let Some(ref token) = page_token {
            request = request.query(&[("pageToken", token.as_str())]);
        }

        let response = request
            .send()
            .await
            .map_err(|e| AppError::CloudStorage(format!("Failed to list files: {}", e)))?;

        if !response.status().is_success() {
            let error = response.text().await.unwrap_or_default();
            return Err(AppError::CloudStorage(format!(
                "Failed to list files: {}",
                error
            )));
        }

        let list: DriveFilesListResponse = response
            .json()
            .await
            .map_err(|e| AppError::CloudStorage(format!("Failed to parse file list: {}", e)))?;

        for file in list.files {
            if file.name.ends_with(".zip") {
                backups.push(RemoteBackupInfo {
                    filename: file.name,
                    remote_path: file.id,
                    size_bytes: file.size.and_then(|s| s.parse().ok()).unwrap_or(0),
                    modified_at: file.modified_time.unwrap_or_default(),
                });
            }
        }

        page_token = list.next_page_token;
        if page_token.is_none() {
            break;
        }
    }

    Ok(backups)
}

