//! S3-compatible storage integration for cloud backups
//!
//! Supports AWS S3, MinIO, and other S3-compatible services.
//! Uses direct REST API calls (no AWS SDK dependency).

use crate::error::{AppError, AppResult};
use chrono::Utc;
use hmac::{Hmac, Mac};
use reqwest::header::{CONTENT_LENGTH, CONTENT_TYPE, HOST};
use sha2::{Digest, Sha256};
use std::path::Path;
use tokio::fs::File;
use tokio::io::AsyncReadExt;

use super::{ConnectionTestResult, RemoteBackupInfo};

type HmacSha256 = Hmac<Sha256>;

/// S3 configuration
pub struct S3Config<'a> {
    pub endpoint: &'a str,
    pub region: &'a str,
    pub bucket: &'a str,
    pub access_key: &'a str,
    pub secret_key: &'a str,
}

/// Generate AWS Signature V4 authorization header
fn sign_request(
    method: &str,
    uri: &str,
    query: &str,
    headers: &[(&str, &str)],
    payload_hash: &str,
    config: &S3Config,
) -> String {
    let now = Utc::now();
    let date_stamp = now.format("%Y%m%d").to_string();
    let amz_date = now.format("%Y%m%dT%H%M%SZ").to_string();

    // Canonical headers
    let mut canonical_headers = headers
        .iter()
        .map(|(k, v)| format!("{}:{}", k.to_lowercase(), v.trim()))
        .collect::<Vec<_>>();
    canonical_headers.push(format!("host:{}", get_host(config.endpoint)));
    canonical_headers.push(format!("x-amz-content-sha256:{}", payload_hash));
    canonical_headers.push(format!("x-amz-date:{}", amz_date));
    canonical_headers.sort();
    let canonical_headers_str = canonical_headers.join("\n") + "\n";

    // Signed headers
    let mut signed_headers = headers
        .iter()
        .map(|(k, _)| k.to_lowercase())
        .collect::<Vec<_>>();
    signed_headers.push("host".to_string());
    signed_headers.push("x-amz-content-sha256".to_string());
    signed_headers.push("x-amz-date".to_string());
    signed_headers.sort();
    let signed_headers_str = signed_headers.join(";");

    // Canonical request
    let canonical_request = format!(
        "{}\n{}\n{}\n{}\n{}\n{}",
        method, uri, query, canonical_headers_str, signed_headers_str, payload_hash
    );

    // String to sign
    let credential_scope = format!("{}/{}/s3/aws4_request", date_stamp, config.region);
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{}\n{}\n{}",
        amz_date,
        credential_scope,
        hex::encode(Sha256::digest(canonical_request.as_bytes()))
    );

    // Signing key
    let k_date = hmac_sha256(format!("AWS4{}", config.secret_key).as_bytes(), &date_stamp);
    let k_region = hmac_sha256(&k_date, config.region);
    let k_service = hmac_sha256(&k_region, "s3");
    let k_signing = hmac_sha256(&k_service, "aws4_request");

    // Signature
    let signature = hex::encode(hmac_sha256(&k_signing, &string_to_sign));

    // Authorization header
    format!(
        "AWS4-HMAC-SHA256 Credential={}/{}, SignedHeaders={}, Signature={}",
        config.access_key, credential_scope, signed_headers_str, signature
    )
}

fn hmac_sha256(key: &[u8], data: &str) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC can take key of any size");
    mac.update(data.as_bytes());
    mac.finalize().into_bytes().to_vec()
}

fn get_host(endpoint: &str) -> String {
    endpoint
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .split('/')
        .next()
        .unwrap_or(endpoint)
        .to_string()
}

fn build_url(config: &S3Config, key: &str) -> String {
    let endpoint = config.endpoint.trim_end_matches('/');
    if key.is_empty() {
        format!("{}/{}", endpoint, config.bucket)
    } else {
        format!("{}/{}/{}", endpoint, config.bucket, key.trim_start_matches('/'))
    }
}

/// Test connection to S3-compatible storage
pub async fn test_connection(
    client: &reqwest::Client,
    config: &S3Config<'_>,
) -> AppResult<ConnectionTestResult> {
    let now = Utc::now();
    let amz_date = now.format("%Y%m%dT%H%M%SZ").to_string();
    let payload_hash = hex::encode(Sha256::digest(b""));

    let url = build_url(config, "");
    let uri = format!("/{}", config.bucket);

    let auth = sign_request("HEAD", &uri, "", &[], &payload_hash, config);

    let response = client
        .head(&url)
        .header(HOST, get_host(config.endpoint))
        .header("x-amz-date", &amz_date)
        .header("x-amz-content-sha256", &payload_hash)
        .header("Authorization", auth)
        .send()
        .await
        .map_err(|e| AppError::CloudStorage(format!("Connection test failed: {}", e)))?;

    if response.status().is_success() {
        Ok(ConnectionTestResult {
            success: true,
            message: format!("Connected to bucket '{}' successfully", config.bucket),
            storage_used: None,
            storage_total: None,
        })
    } else if response.status() == reqwest::StatusCode::FORBIDDEN {
        Ok(ConnectionTestResult {
            success: false,
            message: "Access denied. Check your credentials.".to_string(),
            storage_used: None,
            storage_total: None,
        })
    } else if response.status() == reqwest::StatusCode::NOT_FOUND {
        Ok(ConnectionTestResult {
            success: false,
            message: format!("Bucket '{}' not found", config.bucket),
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

/// Upload a file to S3
pub async fn upload_file(
    client: &reqwest::Client,
    config: &S3Config<'_>,
    key: &str,
    local_path: &Path,
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

    let now = Utc::now();
    let amz_date = now.format("%Y%m%dT%H%M%SZ").to_string();
    let payload_hash = hex::encode(Sha256::digest(&buffer));

    let url = build_url(config, key);
    let uri = format!("/{}/{}", config.bucket, key.trim_start_matches('/'));

    let content_length = buffer.len().to_string();
    let headers = [
        ("content-length", content_length.as_str()),
        ("content-type", "application/octet-stream"),
    ];

    let auth = sign_request("PUT", &uri, "", &headers, &payload_hash, config);

    let response = client
        .put(&url)
        .header(HOST, get_host(config.endpoint))
        .header("x-amz-date", &amz_date)
        .header("x-amz-content-sha256", &payload_hash)
        .header("Authorization", auth)
        .header(CONTENT_TYPE, "application/octet-stream")
        .header(CONTENT_LENGTH, buffer.len())
        .body(buffer)
        .send()
        .await
        .map_err(|e| AppError::CloudStorage(format!("Upload failed: {}", e)))?;

    if let Some(ref progress) = on_progress {
        progress(file_size, file_size);
    }

    if response.status().is_success() {
        Ok(key.to_string())
    } else {
        let error = response.text().await.unwrap_or_default();
        Err(AppError::CloudStorage(format!("Upload failed: {}", error)))
    }
}

/// List backup files in S3 bucket
pub async fn list_backups(
    client: &reqwest::Client,
    config: &S3Config<'_>,
    prefix: &str,
) -> AppResult<Vec<RemoteBackupInfo>> {
    let now = Utc::now();
    let amz_date = now.format("%Y%m%dT%H%M%SZ").to_string();
    let payload_hash = hex::encode(Sha256::digest(b""));

    let url = format!(
        "{}?list-type=2&prefix={}",
        build_url(config, ""),
        prefix.trim_start_matches('/')
    );
    let uri = format!("/{}", config.bucket);
    let query = format!("list-type=2&prefix={}", prefix.trim_start_matches('/'));

    let auth = sign_request("GET", &uri, &query, &[], &payload_hash, config);

    let response = client
        .get(&url)
        .header(HOST, get_host(config.endpoint))
        .header("x-amz-date", &amz_date)
        .header("x-amz-content-sha256", &payload_hash)
        .header("Authorization", auth)
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

    let body = response.text().await.unwrap_or_default();
    Ok(parse_list_response(&body))
}

/// Parse S3 ListBucketV2 XML response
fn parse_list_response(xml: &str) -> Vec<RemoteBackupInfo> {
    let mut backups = Vec::new();

    // Split by Contents elements
    let contents: Vec<&str> = xml.split("<Contents>").collect();

    for content in contents.iter().skip(1) {
        let key = extract_xml_tag(content, "Key").unwrap_or_default();
        if !key.ends_with(".zip") {
            continue;
        }

        let size = extract_xml_tag(content, "Size")
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);

        let modified = extract_xml_tag(content, "LastModified").unwrap_or_default();

        let filename = key.split('/').last().unwrap_or(&key).to_string();

        backups.push(RemoteBackupInfo {
            filename,
            remote_path: key,
            size_bytes: size,
            modified_at: modified,
        });
    }

    backups
}

fn extract_xml_tag(xml: &str, tag: &str) -> Option<String> {
    let start = format!("<{}>", tag);
    let end = format!("</{}>", tag);

    let start_idx = xml.find(&start)?;
    let content_start = start_idx + start.len();
    let end_idx = xml[content_start..].find(&end)?;

    Some(xml[content_start..content_start + end_idx].to_string())
}

