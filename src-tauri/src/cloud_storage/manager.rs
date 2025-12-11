//! Cloud storage upload/sync orchestration
//!
//! Handles dispatching operations to the appropriate provider based on configuration.

use std::path::Path;
use tauri::{AppHandle, Emitter};

use crate::crypto;
use crate::error::{AppError, AppResult};

use super::{
    dropbox, google_drive, nextcloud, s3, CloudProvider, CloudStorageConfig,
    CloudSyncStatus, CloudUploadProgressEvent, ConnectionTestResult, RemoteBackupInfo,
};

/// Test connection to the configured cloud provider
pub async fn test_connection(
    http_client: &reqwest::Client,
    config: &CloudStorageConfig,
    encryption_key: &[u8; 32],
) -> AppResult<ConnectionTestResult> {
    match config.provider {
        CloudProvider::Nextcloud => {
            let url = config
                .nextcloud_url
                .as_ref()
                .ok_or_else(|| AppError::CloudStorage("Nextcloud URL not configured".to_string()))?;
            let username = config.nextcloud_username.as_ref().ok_or_else(|| {
                AppError::CloudStorage("Nextcloud username not configured".to_string())
            })?;
            let password_encrypted = config.nextcloud_password.as_ref().ok_or_else(|| {
                AppError::CloudStorage("Nextcloud password not configured".to_string())
            })?;

            // Decrypt password
            let password = if crypto::is_encrypted(password_encrypted) {
                crypto::decrypt(encryption_key, password_encrypted)?
            } else {
                password_encrypted.clone()
            };

            nextcloud::test_connection(http_client, url, username, &password).await
        }

        CloudProvider::GoogleDrive => {
            let access_token = config.google_access_token.as_ref().ok_or_else(|| {
                AppError::CloudStorage("Google Drive not authenticated".to_string())
            })?;

            // Decrypt token
            let token = if crypto::is_encrypted(access_token) {
                crypto::decrypt(encryption_key, access_token)?
            } else {
                access_token.clone()
            };

            google_drive::test_connection(http_client, &token).await
        }

        CloudProvider::S3 => {
            let endpoint = config
                .s3_endpoint
                .as_ref()
                .ok_or_else(|| AppError::CloudStorage("S3 endpoint not configured".to_string()))?;
            let region = config
                .s3_region
                .as_ref()
                .ok_or_else(|| AppError::CloudStorage("S3 region not configured".to_string()))?;
            let bucket = config
                .s3_bucket
                .as_ref()
                .ok_or_else(|| AppError::CloudStorage("S3 bucket not configured".to_string()))?;
            let access_key = config.s3_access_key.as_ref().ok_or_else(|| {
                AppError::CloudStorage("S3 access key not configured".to_string())
            })?;
            let secret_key_encrypted = config.s3_secret_key.as_ref().ok_or_else(|| {
                AppError::CloudStorage("S3 secret key not configured".to_string())
            })?;

            // Decrypt secret key
            let secret_key = if crypto::is_encrypted(secret_key_encrypted) {
                crypto::decrypt(encryption_key, secret_key_encrypted)?
            } else {
                secret_key_encrypted.clone()
            };

            let s3_config = s3::S3Config {
                endpoint,
                region,
                bucket,
                access_key,
                secret_key: &secret_key,
            };

            s3::test_connection(http_client, &s3_config).await
        }

        CloudProvider::Dropbox => {
            let access_token = config.dropbox_access_token.as_ref().ok_or_else(|| {
                AppError::CloudStorage("Dropbox not authenticated".to_string())
            })?;

            // Decrypt token
            let token = if crypto::is_encrypted(access_token) {
                crypto::decrypt(encryption_key, access_token)?
            } else {
                access_token.clone()
            };

            dropbox::test_connection(http_client, &token).await
        }
    }
}

/// Upload a backup file to cloud storage
pub async fn upload_backup(
    http_client: &reqwest::Client,
    config: &CloudStorageConfig,
    encryption_key: &[u8; 32],
    local_path: &Path,
    instance_id: &str,
    world_name: &str,
    backup_filename: &str,
    app: Option<&AppHandle>,
) -> AppResult<String> {
    // Emit progress event helper
    let emit_progress = |progress: u32, status: CloudSyncStatus, message: &str| {
        if let Some(app) = app {
            let _ = app.emit(
                "cloud-upload-progress",
                CloudUploadProgressEvent {
                    backup_filename: backup_filename.to_string(),
                    progress,
                    bytes_uploaded: 0,
                    total_bytes: 0,
                    status,
                    message: message.to_string(),
                },
            );
        }
    };

    emit_progress(0, CloudSyncStatus::Uploading, "Starting upload...");

    let result = match config.provider {
        CloudProvider::Nextcloud => {
            let url = config
                .nextcloud_url
                .as_ref()
                .ok_or_else(|| AppError::CloudStorage("Nextcloud URL not configured".to_string()))?;
            let username = config.nextcloud_username.as_ref().ok_or_else(|| {
                AppError::CloudStorage("Nextcloud username not configured".to_string())
            })?;
            let password_encrypted = config.nextcloud_password.as_ref().ok_or_else(|| {
                AppError::CloudStorage("Nextcloud password not configured".to_string())
            })?;
            let folder_path = config
                .nextcloud_folder_path
                .as_ref()
                .map(|s| s.as_str())
                .unwrap_or("/Kaizen Backups");

            let password = if crypto::is_encrypted(password_encrypted) {
                crypto::decrypt(encryption_key, password_encrypted)?
            } else {
                password_encrypted.clone()
            };

            // Build remote path: /Kaizen Backups/instance_id/world_name/backup.zip
            let remote_path = format!(
                "{}/{}/{}/{}",
                folder_path.trim_matches('/'),
                instance_id,
                world_name,
                backup_filename
            );

            nextcloud::upload_file(
                http_client,
                url,
                username,
                &password,
                &remote_path,
                local_path,
                Some(|uploaded, total| {
                    if let Some(app) = app {
                        let progress = if total > 0 {
                            ((uploaded as f64 / total as f64) * 100.0) as u32
                        } else {
                            0
                        };
                        let _ = app.emit(
                            "cloud-upload-progress",
                            CloudUploadProgressEvent {
                                backup_filename: backup_filename.to_string(),
                                progress,
                                bytes_uploaded: uploaded,
                                total_bytes: total,
                                status: CloudSyncStatus::Uploading,
                                message: format!("Uploading... {}%", progress),
                            },
                        );
                    }
                }),
            )
            .await
        }

        CloudProvider::GoogleDrive => {
            let access_token = config.google_access_token.as_ref().ok_or_else(|| {
                AppError::CloudStorage("Google Drive not authenticated".to_string())
            })?;
            let folder_id = config.google_folder_id.as_ref().ok_or_else(|| {
                AppError::CloudStorage("Google Drive folder not set up".to_string())
            })?;

            let token = if crypto::is_encrypted(access_token) {
                crypto::decrypt(encryption_key, access_token)?
            } else {
                access_token.clone()
            };

            // Create subfolder structure in Google Drive is more complex
            // For now, we'll use the main folder and include path info in filename
            let upload_filename = format!("{}_{}_{}", instance_id, world_name, backup_filename);

            google_drive::upload_file(
                http_client,
                &token,
                folder_id,
                local_path,
                &upload_filename,
                Some(|uploaded, total| {
                    if let Some(app) = app {
                        let progress = if total > 0 {
                            ((uploaded as f64 / total as f64) * 100.0) as u32
                        } else {
                            0
                        };
                        let _ = app.emit(
                            "cloud-upload-progress",
                            CloudUploadProgressEvent {
                                backup_filename: backup_filename.to_string(),
                                progress,
                                bytes_uploaded: uploaded,
                                total_bytes: total,
                                status: CloudSyncStatus::Uploading,
                                message: format!("Uploading... {}%", progress),
                            },
                        );
                    }
                }),
            )
            .await
        }

        CloudProvider::S3 => {
            let endpoint = config
                .s3_endpoint
                .as_ref()
                .ok_or_else(|| AppError::CloudStorage("S3 endpoint not configured".to_string()))?;
            let region = config
                .s3_region
                .as_ref()
                .ok_or_else(|| AppError::CloudStorage("S3 region not configured".to_string()))?;
            let bucket = config
                .s3_bucket
                .as_ref()
                .ok_or_else(|| AppError::CloudStorage("S3 bucket not configured".to_string()))?;
            let access_key = config.s3_access_key.as_ref().ok_or_else(|| {
                AppError::CloudStorage("S3 access key not configured".to_string())
            })?;
            let secret_key_encrypted = config.s3_secret_key.as_ref().ok_or_else(|| {
                AppError::CloudStorage("S3 secret key not configured".to_string())
            })?;
            let prefix = config
                .s3_folder_prefix
                .as_ref()
                .map(|s| s.as_str())
                .unwrap_or("kaizen-backups/");

            let secret_key = if crypto::is_encrypted(secret_key_encrypted) {
                crypto::decrypt(encryption_key, secret_key_encrypted)?
            } else {
                secret_key_encrypted.clone()
            };

            let s3_config = s3::S3Config {
                endpoint,
                region,
                bucket,
                access_key,
                secret_key: &secret_key,
            };

            // Build S3 key: prefix/instance_id/world_name/backup.zip
            let key = format!(
                "{}{}/{}/{}",
                prefix.trim_end_matches('/'),
                instance_id,
                world_name,
                backup_filename
            );

            s3::upload_file(
                http_client,
                &s3_config,
                &key,
                local_path,
                Some(|uploaded, total| {
                    if let Some(app) = app {
                        let progress = if total > 0 {
                            ((uploaded as f64 / total as f64) * 100.0) as u32
                        } else {
                            0
                        };
                        let _ = app.emit(
                            "cloud-upload-progress",
                            CloudUploadProgressEvent {
                                backup_filename: backup_filename.to_string(),
                                progress,
                                bytes_uploaded: uploaded,
                                total_bytes: total,
                                status: CloudSyncStatus::Uploading,
                                message: format!("Uploading... {}%", progress),
                            },
                        );
                    }
                }),
            )
            .await
        }

        CloudProvider::Dropbox => {
            let access_token = config.dropbox_access_token.as_ref().ok_or_else(|| {
                AppError::CloudStorage("Dropbox not authenticated".to_string())
            })?;
            let folder_path = config
                .dropbox_folder_path
                .as_ref()
                .map(|s| s.as_str())
                .unwrap_or("/Kaizen Backups");

            let token = if crypto::is_encrypted(access_token) {
                crypto::decrypt(encryption_key, access_token)?
            } else {
                access_token.clone()
            };

            // Build remote path
            let remote_path = format!(
                "{}/{}/{}/{}",
                folder_path.trim_matches('/'),
                instance_id,
                world_name,
                backup_filename
            );
            let remote_path = if remote_path.starts_with('/') {
                remote_path
            } else {
                format!("/{}", remote_path)
            };

            dropbox::upload_file(
                http_client,
                &token,
                &remote_path,
                local_path,
                Some(|uploaded, total| {
                    if let Some(app) = app {
                        let progress = if total > 0 {
                            ((uploaded as f64 / total as f64) * 100.0) as u32
                        } else {
                            0
                        };
                        let _ = app.emit(
                            "cloud-upload-progress",
                            CloudUploadProgressEvent {
                                backup_filename: backup_filename.to_string(),
                                progress,
                                bytes_uploaded: uploaded,
                                total_bytes: total,
                                status: CloudSyncStatus::Uploading,
                                message: format!("Uploading... {}%", progress),
                            },
                        );
                    }
                }),
            )
            .await
        }
    };

    match &result {
        Ok(_) => {
            emit_progress(100, CloudSyncStatus::Synced, "Upload complete!");
        }
        Err(e) => {
            emit_progress(0, CloudSyncStatus::Failed, &e.to_string());
        }
    }

    result
}

/// List remote backups from cloud storage
pub async fn list_remote_backups(
    http_client: &reqwest::Client,
    config: &CloudStorageConfig,
    encryption_key: &[u8; 32],
) -> AppResult<Vec<RemoteBackupInfo>> {
    match config.provider {
        CloudProvider::Nextcloud => {
            let url = config
                .nextcloud_url
                .as_ref()
                .ok_or_else(|| AppError::CloudStorage("Nextcloud URL not configured".to_string()))?;
            let username = config.nextcloud_username.as_ref().ok_or_else(|| {
                AppError::CloudStorage("Nextcloud username not configured".to_string())
            })?;
            let password_encrypted = config.nextcloud_password.as_ref().ok_or_else(|| {
                AppError::CloudStorage("Nextcloud password not configured".to_string())
            })?;
            let folder_path = config
                .nextcloud_folder_path
                .as_ref()
                .map(|s| s.as_str())
                .unwrap_or("/Kaizen Backups");

            let password = if crypto::is_encrypted(password_encrypted) {
                crypto::decrypt(encryption_key, password_encrypted)?
            } else {
                password_encrypted.clone()
            };

            nextcloud::list_backups(http_client, url, username, &password, folder_path).await
        }

        CloudProvider::GoogleDrive => {
            let access_token = config.google_access_token.as_ref().ok_or_else(|| {
                AppError::CloudStorage("Google Drive not authenticated".to_string())
            })?;
            let folder_id = config.google_folder_id.as_ref().ok_or_else(|| {
                AppError::CloudStorage("Google Drive folder not set up".to_string())
            })?;

            let token = if crypto::is_encrypted(access_token) {
                crypto::decrypt(encryption_key, access_token)?
            } else {
                access_token.clone()
            };

            google_drive::list_backups(http_client, &token, folder_id).await
        }

        CloudProvider::S3 => {
            let endpoint = config
                .s3_endpoint
                .as_ref()
                .ok_or_else(|| AppError::CloudStorage("S3 endpoint not configured".to_string()))?;
            let region = config
                .s3_region
                .as_ref()
                .ok_or_else(|| AppError::CloudStorage("S3 region not configured".to_string()))?;
            let bucket = config
                .s3_bucket
                .as_ref()
                .ok_or_else(|| AppError::CloudStorage("S3 bucket not configured".to_string()))?;
            let access_key = config.s3_access_key.as_ref().ok_or_else(|| {
                AppError::CloudStorage("S3 access key not configured".to_string())
            })?;
            let secret_key_encrypted = config.s3_secret_key.as_ref().ok_or_else(|| {
                AppError::CloudStorage("S3 secret key not configured".to_string())
            })?;
            let prefix = config
                .s3_folder_prefix
                .as_ref()
                .map(|s| s.as_str())
                .unwrap_or("kaizen-backups/");

            let secret_key = if crypto::is_encrypted(secret_key_encrypted) {
                crypto::decrypt(encryption_key, secret_key_encrypted)?
            } else {
                secret_key_encrypted.clone()
            };

            let s3_config = s3::S3Config {
                endpoint,
                region,
                bucket,
                access_key,
                secret_key: &secret_key,
            };

            s3::list_backups(http_client, &s3_config, prefix).await
        }

        CloudProvider::Dropbox => {
            let access_token = config.dropbox_access_token.as_ref().ok_or_else(|| {
                AppError::CloudStorage("Dropbox not authenticated".to_string())
            })?;
            let folder_path = config
                .dropbox_folder_path
                .as_ref()
                .map(|s| s.as_str())
                .unwrap_or("/Kaizen Backups");

            let token = if crypto::is_encrypted(access_token) {
                crypto::decrypt(encryption_key, access_token)?
            } else {
                access_token.clone()
            };

            dropbox::list_backups(http_client, &token, folder_path).await
        }
    }
}
