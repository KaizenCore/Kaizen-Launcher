//! Dropbox OAuth and API integration for cloud backups
//!
//! Uses PKCE authorization code flow with device authorization for authentication.
//! Dropbox API v2 for file operations.

use crate::error::{AppError, AppResult};
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tokio::fs::File;
use tokio::io::AsyncReadExt;

use super::{ConnectionTestResult, DeviceCodeResponse, RemoteBackupInfo};

// OAuth endpoints
const DROPBOX_DEVICE_AUTH: &str = "https://api.dropboxapi.com/oauth2/token";
const DROPBOX_AUTH_URL: &str = "https://www.dropbox.com/oauth2/authorize";

// API endpoints
const DROPBOX_API: &str = "https://api.dropboxapi.com/2";
const DROPBOX_CONTENT_API: &str = "https://content.dropboxapi.com/2";

/// Dropbox OAuth tokens
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DropboxTokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: u64,
    pub token_type: String,
}

/// Dropbox file metadata
#[derive(Debug, Deserialize)]
struct DropboxFile {
    name: String,
    path_display: Option<String>,
    #[serde(default)]
    size: u64,
    #[serde(default)]
    server_modified: Option<String>,
    #[serde(rename = ".tag")]
    tag: String,
}

/// Dropbox list folder response
#[derive(Debug, Deserialize)]
struct ListFolderResponse {
    entries: Vec<DropboxFile>,
    cursor: String,
    has_more: bool,
}

/// Dropbox space usage response
#[derive(Debug, Deserialize)]
struct SpaceUsageResponse {
    used: u64,
    allocation: Allocation,
}

#[derive(Debug, Deserialize)]
struct Allocation {
    #[serde(default)]
    allocated: u64,
}

/// Request device authorization code
/// Note: Dropbox uses a slightly different flow - we generate a code and user visits URL
pub async fn request_device_code(
    _client: &reqwest::Client,
    app_key: &str,
) -> AppResult<DeviceCodeResponse> {
    // Generate a random state for PKCE
    use rand::Rng;
    let state: String = rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(32)
        .map(char::from)
        .collect();

    // For device flow, we use the authorization URL with token_access_type
    let verification_uri = format!(
        "{}?client_id={}&response_type=code&token_access_type=offline&state={}",
        DROPBOX_AUTH_URL, app_key, state
    );

    // Dropbox doesn't have a true device code flow like Google
    // We simulate it by having the user visit the URL and enter the code
    Ok(DeviceCodeResponse {
        device_code: state.clone(), // We'll use state as our tracking code
        user_code: state,           // User doesn't need to enter this, it's in the URL
        verification_uri,
        expires_in: 600, // 10 minutes
        interval: 5,
    })
}

/// Exchange authorization code for tokens
pub async fn exchange_code(
    client: &reqwest::Client,
    app_key: &str,
    app_secret: &str,
    code: &str,
) -> AppResult<DropboxTokens> {
    let response = client
        .post(DROPBOX_DEVICE_AUTH)
        .form(&[
            ("code", code),
            ("grant_type", "authorization_code"),
            ("client_id", app_key),
            ("client_secret", app_secret),
        ])
        .send()
        .await
        .map_err(|e| AppError::CloudStorage(format!("Token exchange failed: {}", e)))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(AppError::CloudStorage(format!(
            "Token exchange failed: {}",
            error_text
        )));
    }

    let tokens: DropboxTokens = response
        .json()
        .await
        .map_err(|e| AppError::CloudStorage(format!("Failed to parse tokens: {}", e)))?;

    Ok(tokens)
}

/// Test connection to Dropbox
pub async fn test_connection(
    client: &reqwest::Client,
    access_token: &str,
) -> AppResult<ConnectionTestResult> {
    let response = client
        .post(format!("{}/users/get_space_usage", DROPBOX_API))
        .header(AUTHORIZATION, format!("Bearer {}", access_token))
        .header(CONTENT_TYPE, "application/json")
        .body("null")
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

    let usage: SpaceUsageResponse = response
        .json()
        .await
        .map_err(|e| AppError::CloudStorage(format!("Failed to parse response: {}", e)))?;

    Ok(ConnectionTestResult {
        success: true,
        message: "Connected to Dropbox successfully".to_string(),
        storage_used: Some(usage.used),
        storage_total: if usage.allocation.allocated > 0 {
            Some(usage.allocation.allocated)
        } else {
            None
        },
    })
}

/// Create a folder on Dropbox
pub async fn create_folder(
    client: &reqwest::Client,
    access_token: &str,
    path: &str,
) -> AppResult<()> {
    let response = client
        .post(format!("{}/files/create_folder_v2", DROPBOX_API))
        .header(AUTHORIZATION, format!("Bearer {}", access_token))
        .header(CONTENT_TYPE, "application/json")
        .json(&serde_json::json!({
            "path": path,
            "autorename": false
        }))
        .send()
        .await
        .map_err(|e| AppError::CloudStorage(format!("Failed to create folder: {}", e)))?;

    // 200 = created, 409 = already exists (which is fine)
    if response.status().is_success() {
        Ok(())
    } else {
        let error = response.text().await.unwrap_or_default();
        // Check if it's a conflict (folder exists)
        if error.contains("path/conflict") {
            Ok(())
        } else {
            Err(AppError::CloudStorage(format!(
                "Failed to create folder: {}",
                error
            )))
        }
    }
}

/// Upload a file to Dropbox
pub async fn upload_file(
    client: &reqwest::Client,
    access_token: &str,
    remote_path: &str,
    local_path: &Path,
    on_progress: Option<impl Fn(u64, u64) + Send + Sync>,
) -> AppResult<String> {
    // Ensure parent folder exists
    if let Some(parent) = Path::new(remote_path).parent() {
        let parent_str = parent.to_string_lossy();
        if !parent_str.is_empty() && parent_str != "/" {
            create_folder(client, access_token, &parent_str).await?;
        }
    }

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

    // Dropbox API args header
    let api_args = serde_json::json!({
        "path": remote_path,
        "mode": "overwrite",
        "autorename": false,
        "mute": true
    });

    let response = client
        .post(format!("{}/files/upload", DROPBOX_CONTENT_API))
        .header(AUTHORIZATION, format!("Bearer {}", access_token))
        .header(CONTENT_TYPE, "application/octet-stream")
        .header("Dropbox-API-Arg", api_args.to_string())
        .body(buffer)
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

    Ok(remote_path.to_string())
}

/// List backup files in Dropbox folder
pub async fn list_backups(
    client: &reqwest::Client,
    access_token: &str,
    folder_path: &str,
) -> AppResult<Vec<RemoteBackupInfo>> {
    let mut backups = Vec::new();

    // Ensure path starts with /
    let path = if folder_path.starts_with('/') {
        folder_path.to_string()
    } else {
        format!("/{}", folder_path)
    };

    // Empty string means root in Dropbox API
    let api_path = if path == "/" { "" } else { &path };

    let response = client
        .post(format!("{}/files/list_folder", DROPBOX_API))
        .header(AUTHORIZATION, format!("Bearer {}", access_token))
        .header(CONTENT_TYPE, "application/json")
        .json(&serde_json::json!({
            "path": api_path,
            "recursive": true,
            "include_deleted": false,
            "include_has_explicit_shared_members": false,
            "include_mounted_folders": true,
            "include_non_downloadable_files": false
        }))
        .send()
        .await
        .map_err(|e| AppError::CloudStorage(format!("Failed to list files: {}", e)))?;

    if response.status() == reqwest::StatusCode::CONFLICT {
        // Folder doesn't exist
        return Ok(vec![]);
    }

    if !response.status().is_success() {
        let error = response.text().await.unwrap_or_default();
        // Check for path not found
        if error.contains("path/not_found") {
            return Ok(vec![]);
        }
        return Err(AppError::CloudStorage(format!(
            "Failed to list files: {}",
            error
        )));
    }

    let mut list_response: ListFolderResponse = response
        .json()
        .await
        .map_err(|e| AppError::CloudStorage(format!("Failed to parse response: {}", e)))?;

    // Process entries
    for entry in &list_response.entries {
        if entry.tag == "file" && entry.name.ends_with(".zip") {
            backups.push(RemoteBackupInfo {
                filename: entry.name.clone(),
                remote_path: entry.path_display.clone().unwrap_or_default(),
                size_bytes: entry.size,
                modified_at: entry.server_modified.clone().unwrap_or_default(),
            });
        }
    }

    // Continue if there are more entries
    while list_response.has_more {
        let response = client
            .post(format!("{}/files/list_folder/continue", DROPBOX_API))
            .header(AUTHORIZATION, format!("Bearer {}", access_token))
            .header(CONTENT_TYPE, "application/json")
            .json(&serde_json::json!({
                "cursor": list_response.cursor
            }))
            .send()
            .await
            .map_err(|e| AppError::CloudStorage(format!("Failed to list files: {}", e)))?;

        if !response.status().is_success() {
            break;
        }

        list_response = response.json().await.unwrap_or(ListFolderResponse {
            entries: vec![],
            cursor: String::new(),
            has_more: false,
        });

        for entry in &list_response.entries {
            if entry.tag == "file" && entry.name.ends_with(".zip") {
                backups.push(RemoteBackupInfo {
                    filename: entry.name.clone(),
                    remote_path: entry.path_display.clone().unwrap_or_default(),
                    size_bytes: entry.size,
                    modified_at: entry.server_modified.clone().unwrap_or_default(),
                });
            }
        }
    }

    Ok(backups)
}
