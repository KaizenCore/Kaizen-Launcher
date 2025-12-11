//! Nextcloud WebDAV integration for cloud backups
//!
//! Nextcloud uses WebDAV protocol for file operations.
//! Authentication is via Basic Auth (username/password).

use crate::error::{AppError, AppResult};
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use std::path::Path;
use tokio::fs::File;
use tokio::io::AsyncReadExt;

use super::{ConnectionTestResult, RemoteBackupInfo};

/// Build the WebDAV URL for a Nextcloud instance
fn build_webdav_url(base_url: &str, username: &str, path: &str) -> String {
    let base = base_url.trim_end_matches('/');
    let path = path.trim_start_matches('/');
    format!("{}/remote.php/dav/files/{}/{}", base, username, path)
}

/// Build Basic Auth header value
fn build_auth_header(username: &str, password: &str) -> String {
    use base64::Engine;
    let credentials = format!("{}:{}", username, password);
    let encoded = base64::engine::general_purpose::STANDARD.encode(credentials);
    format!("Basic {}", encoded)
}

/// Test connection to Nextcloud server
pub async fn test_connection(
    client: &reqwest::Client,
    url: &str,
    username: &str,
    password: &str,
) -> AppResult<ConnectionTestResult> {
    let webdav_url = build_webdav_url(url, username, "");
    let auth = build_auth_header(username, password);

    // Use PROPFIND to check if we can access the root folder
    let response = client
        .request(reqwest::Method::from_bytes(b"PROPFIND").unwrap(), &webdav_url)
        .header(AUTHORIZATION, &auth)
        .header("Depth", "0")
        .header(CONTENT_TYPE, "application/xml")
        .body(r#"<?xml version="1.0"?>
            <d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
                <d:prop>
                    <d:quota-used-bytes/>
                    <d:quota-available-bytes/>
                </d:prop>
            </d:propfind>"#)
        .send()
        .await
        .map_err(|e| AppError::CloudStorage(format!("Failed to connect to Nextcloud: {}", e)))?;

    if response.status().is_success() {
        // Try to parse quota info from response
        let body = response.text().await.unwrap_or_default();
        let (used, total) = parse_quota_from_propfind(&body);

        Ok(ConnectionTestResult {
            success: true,
            message: "Connected to Nextcloud successfully".to_string(),
            storage_used: used,
            storage_total: total,
        })
    } else if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        Ok(ConnectionTestResult {
            success: false,
            message: "Invalid username or password".to_string(),
            storage_used: None,
            storage_total: None,
        })
    } else {
        Ok(ConnectionTestResult {
            success: false,
            message: format!("Connection failed: HTTP {}", response.status()),
            storage_used: None,
            storage_total: None,
        })
    }
}

/// Parse quota information from PROPFIND response
fn parse_quota_from_propfind(xml: &str) -> (Option<u64>, Option<u64>) {
    // Simple extraction - a proper XML parser would be better but this works for our needs
    let used = extract_xml_value(xml, "quota-used-bytes")
        .and_then(|s| s.parse().ok());
    let available = extract_xml_value(xml, "quota-available-bytes")
        .and_then(|s| s.parse::<u64>().ok());

    let total = match (used, available) {
        (Some(u), Some(a)) if a > 0 => Some(u + a),
        _ => None,
    };

    (used, total)
}

/// Simple XML value extraction
fn extract_xml_value(xml: &str, tag: &str) -> Option<String> {
    let start_patterns = [
        format!("<d:{}>", tag),
        format!("<D:{}>", tag),
        format!("<{}>", tag),
    ];
    let end_patterns = [
        format!("</d:{}>", tag),
        format!("</D:{}>", tag),
        format!("</{}>", tag),
    ];

    for (start, end) in start_patterns.iter().zip(end_patterns.iter()) {
        if let Some(start_idx) = xml.find(start.as_str()) {
            let content_start = start_idx + start.len();
            if let Some(end_idx) = xml[content_start..].find(end.as_str()) {
                return Some(xml[content_start..content_start + end_idx].to_string());
            }
        }
    }
    None
}

/// Create a folder on Nextcloud (recursively creates parent folders if needed)
pub async fn create_folder(
    client: &reqwest::Client,
    url: &str,
    username: &str,
    password: &str,
    folder_path: &str,
) -> AppResult<()> {
    let auth = build_auth_header(username, password);

    // Create each folder in the path
    let parts: Vec<&str> = folder_path.trim_matches('/').split('/').collect();
    let mut current_path = String::new();

    for part in parts {
        if part.is_empty() {
            continue;
        }
        current_path = if current_path.is_empty() {
            part.to_string()
        } else {
            format!("{}/{}", current_path, part)
        };

        let folder_url = build_webdav_url(url, username, &current_path);

        let response = client
            .request(reqwest::Method::from_bytes(b"MKCOL").unwrap(), &folder_url)
            .header(AUTHORIZATION, &auth)
            .send()
            .await
            .map_err(|e| AppError::CloudStorage(format!("Failed to create folder: {}", e)))?;

        // 201 = created, 405 = already exists (which is fine)
        if !response.status().is_success() && response.status() != reqwest::StatusCode::METHOD_NOT_ALLOWED {
            // Check if it's a 409 Conflict (parent doesn't exist) - shouldn't happen with our approach
            if response.status() != reqwest::StatusCode::CONFLICT {
                return Err(AppError::CloudStorage(format!(
                    "Failed to create folder '{}': HTTP {}",
                    current_path,
                    response.status()
                )));
            }
        }
    }

    Ok(())
}

/// Upload a file to Nextcloud
pub async fn upload_file(
    client: &reqwest::Client,
    url: &str,
    username: &str,
    password: &str,
    remote_path: &str,
    local_path: &Path,
    on_progress: Option<impl Fn(u64, u64) + Send + Sync>,
) -> AppResult<String> {
    let auth = build_auth_header(username, password);

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

    // Ensure the parent folder exists
    if let Some(parent) = Path::new(remote_path).parent() {
        let parent_str = parent.to_string_lossy();
        if !parent_str.is_empty() {
            create_folder(client, url, username, password, &parent_str).await?;
        }
    }

    // Report initial progress
    if let Some(ref progress) = on_progress {
        progress(0, file_size);
    }

    let file_url = build_webdav_url(url, username, remote_path);

    let response = client
        .put(&file_url)
        .header(AUTHORIZATION, &auth)
        .header(CONTENT_TYPE, "application/octet-stream")
        .body(buffer)
        .send()
        .await
        .map_err(|e| AppError::CloudStorage(format!("Failed to upload file: {}", e)))?;

    // Report completion
    if let Some(ref progress) = on_progress {
        progress(file_size, file_size);
    }

    if response.status().is_success() || response.status() == reqwest::StatusCode::CREATED {
        Ok(file_url)
    } else {
        Err(AppError::CloudStorage(format!(
            "Upload failed: HTTP {}",
            response.status()
        )))
    }
}

/// List backups in a Nextcloud folder
pub async fn list_backups(
    client: &reqwest::Client,
    url: &str,
    username: &str,
    password: &str,
    folder_path: &str,
) -> AppResult<Vec<RemoteBackupInfo>> {
    let auth = build_auth_header(username, password);
    let folder_url = build_webdav_url(url, username, folder_path);

    let response = client
        .request(reqwest::Method::from_bytes(b"PROPFIND").unwrap(), &folder_url)
        .header(AUTHORIZATION, &auth)
        .header("Depth", "infinity") // Get all files recursively
        .header(CONTENT_TYPE, "application/xml")
        .body(r#"<?xml version="1.0"?>
            <d:propfind xmlns:d="DAV:">
                <d:prop>
                    <d:getcontentlength/>
                    <d:getlastmodified/>
                    <d:resourcetype/>
                </d:prop>
            </d:propfind>"#)
        .send()
        .await
        .map_err(|e| AppError::CloudStorage(format!("Failed to list files: {}", e)))?;

    if !response.status().is_success() {
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(vec![]);
        }
        return Err(AppError::CloudStorage(format!(
            "Failed to list files: HTTP {}",
            response.status()
        )));
    }

    let body = response.text().await.unwrap_or_default();
    Ok(parse_propfind_response(&body, folder_path))
}

/// Parse PROPFIND response to extract file information
fn parse_propfind_response(xml: &str, _base_path: &str) -> Vec<RemoteBackupInfo> {
    let mut backups = Vec::new();

    // Split by response elements
    let responses: Vec<&str> = xml.split("<d:response>").collect();

    for response in responses.iter().skip(1) {
        // Skip directories (look for resourcetype with collection)
        if response.contains("<d:collection") || response.contains("<d:collection/>") {
            continue;
        }

        // Extract href (path)
        let href = extract_xml_value(response, "href")
            .or_else(|| extract_xml_value(response, "d:href"));

        // Only include .zip files
        if let Some(ref path) = href {
            if !path.ends_with(".zip") {
                continue;
            }
        }

        // Extract size
        let size = extract_xml_value(response, "getcontentlength")
            .or_else(|| extract_xml_value(response, "d:getcontentlength"))
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);

        // Extract last modified
        let modified = extract_xml_value(response, "getlastmodified")
            .or_else(|| extract_xml_value(response, "d:getlastmodified"))
            .unwrap_or_default();

        if let Some(path) = href {
            // Extract filename from path
            let filename = path.split('/').last().unwrap_or(&path).to_string();
            if !filename.is_empty() && filename.ends_with(".zip") {
                backups.push(RemoteBackupInfo {
                    filename,
                    remote_path: path,
                    size_bytes: size,
                    modified_at: modified,
                });
            }
        }
    }

    backups
}
