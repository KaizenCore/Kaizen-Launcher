use crate::error::AppResult;
use sqlx::{Row, SqlitePool};

use super::{CloudBackupSync, CloudProvider, CloudStorageConfig, CloudSyncStatus};

/// Get the global cloud storage configuration
pub async fn get_config(db: &SqlitePool) -> AppResult<Option<CloudStorageConfig>> {
    let row = sqlx::query(
        r#"
        SELECT
            id, provider, enabled, auto_upload,
            google_access_token, google_refresh_token, google_expires_at, google_folder_id,
            nextcloud_url, nextcloud_username, nextcloud_password, nextcloud_folder_path,
            s3_endpoint, s3_region, s3_bucket, s3_access_key, s3_secret_key, s3_folder_prefix,
            dropbox_access_token, dropbox_refresh_token, dropbox_expires_at, dropbox_folder_path
        FROM cloud_storage_config
        WHERE id = 'global'
        "#,
    )
    .fetch_optional(db)
    .await?;

    Ok(row.map(|r| CloudStorageConfig {
        id: r.get("id"),
        provider: r
            .get::<String, _>("provider")
            .parse()
            .unwrap_or(CloudProvider::Nextcloud),
        enabled: r.get::<i32, _>("enabled") != 0,
        auto_upload: r.get::<i32, _>("auto_upload") != 0,
        google_access_token: r.get("google_access_token"),
        google_refresh_token: r.get("google_refresh_token"),
        google_expires_at: r.get("google_expires_at"),
        google_folder_id: r.get("google_folder_id"),
        nextcloud_url: r.get("nextcloud_url"),
        nextcloud_username: r.get("nextcloud_username"),
        nextcloud_password: r.get("nextcloud_password"),
        nextcloud_folder_path: r.get("nextcloud_folder_path"),
        s3_endpoint: r.get("s3_endpoint"),
        s3_region: r.get("s3_region"),
        s3_bucket: r.get("s3_bucket"),
        s3_access_key: r.get("s3_access_key"),
        s3_secret_key: r.get("s3_secret_key"),
        s3_folder_prefix: r.get("s3_folder_prefix"),
        dropbox_access_token: r.get("dropbox_access_token"),
        dropbox_refresh_token: r.get("dropbox_refresh_token"),
        dropbox_expires_at: r.get("dropbox_expires_at"),
        dropbox_folder_path: r.get("dropbox_folder_path"),
    }))
}

/// Save (upsert) the cloud storage configuration
pub async fn save_config(db: &SqlitePool, config: &CloudStorageConfig) -> AppResult<()> {
    sqlx::query(
        r#"
        INSERT INTO cloud_storage_config (
            id, provider, enabled, auto_upload,
            google_access_token, google_refresh_token, google_expires_at, google_folder_id,
            nextcloud_url, nextcloud_username, nextcloud_password, nextcloud_folder_path,
            s3_endpoint, s3_region, s3_bucket, s3_access_key, s3_secret_key, s3_folder_prefix,
            dropbox_access_token, dropbox_refresh_token, dropbox_expires_at, dropbox_folder_path,
            updated_at
        ) VALUES (
            ?1, ?2, ?3, ?4,
            ?5, ?6, ?7, ?8,
            ?9, ?10, ?11, ?12,
            ?13, ?14, ?15, ?16, ?17, ?18,
            ?19, ?20, ?21, ?22,
            datetime('now')
        )
        ON CONFLICT(id) DO UPDATE SET
            provider = excluded.provider,
            enabled = excluded.enabled,
            auto_upload = excluded.auto_upload,
            google_access_token = excluded.google_access_token,
            google_refresh_token = excluded.google_refresh_token,
            google_expires_at = excluded.google_expires_at,
            google_folder_id = excluded.google_folder_id,
            nextcloud_url = excluded.nextcloud_url,
            nextcloud_username = excluded.nextcloud_username,
            nextcloud_password = excluded.nextcloud_password,
            nextcloud_folder_path = excluded.nextcloud_folder_path,
            s3_endpoint = excluded.s3_endpoint,
            s3_region = excluded.s3_region,
            s3_bucket = excluded.s3_bucket,
            s3_access_key = excluded.s3_access_key,
            s3_secret_key = excluded.s3_secret_key,
            s3_folder_prefix = excluded.s3_folder_prefix,
            dropbox_access_token = excluded.dropbox_access_token,
            dropbox_refresh_token = excluded.dropbox_refresh_token,
            dropbox_expires_at = excluded.dropbox_expires_at,
            dropbox_folder_path = excluded.dropbox_folder_path,
            updated_at = datetime('now')
        "#,
    )
    .bind(&config.id)
    .bind(config.provider.to_string())
    .bind(config.enabled)
    .bind(config.auto_upload)
    .bind(&config.google_access_token)
    .bind(&config.google_refresh_token)
    .bind(&config.google_expires_at)
    .bind(&config.google_folder_id)
    .bind(&config.nextcloud_url)
    .bind(&config.nextcloud_username)
    .bind(&config.nextcloud_password)
    .bind(&config.nextcloud_folder_path)
    .bind(&config.s3_endpoint)
    .bind(&config.s3_region)
    .bind(&config.s3_bucket)
    .bind(&config.s3_access_key)
    .bind(&config.s3_secret_key)
    .bind(&config.s3_folder_prefix)
    .bind(&config.dropbox_access_token)
    .bind(&config.dropbox_refresh_token)
    .bind(&config.dropbox_expires_at)
    .bind(&config.dropbox_folder_path)
    .execute(db)
    .await?;

    Ok(())
}

/// Delete the cloud storage configuration
pub async fn delete_config(db: &SqlitePool) -> AppResult<()> {
    sqlx::query("DELETE FROM cloud_storage_config WHERE id = 'global'")
        .execute(db)
        .await?;
    Ok(())
}


// ============ Cloud Backup Sync Operations ============

/// Get sync status for a specific backup
pub async fn get_backup_sync(
    db: &SqlitePool,
    backup_filename: &str,
) -> AppResult<Option<CloudBackupSync>> {
    let row = sqlx::query(
        r#"
        SELECT id, local_backup_path, instance_id, world_name, backup_filename,
               remote_path, sync_status, last_synced_at, file_size_bytes, error_message
        FROM cloud_backup_sync
        WHERE backup_filename = ?1
        "#,
    )
    .bind(backup_filename)
    .fetch_optional(db)
    .await?;

    Ok(row.map(|r| CloudBackupSync {
        id: r.get("id"),
        local_backup_path: r.get("local_backup_path"),
        instance_id: r.get("instance_id"),
        world_name: r.get("world_name"),
        backup_filename: r.get("backup_filename"),
        remote_path: r.get("remote_path"),
        sync_status: r
            .get::<String, _>("sync_status")
            .parse()
            .unwrap_or(CloudSyncStatus::Pending),
        last_synced_at: r.get("last_synced_at"),
        file_size_bytes: r.get("file_size_bytes"),
        error_message: r.get("error_message"),
    }))
}

/// Get all backup sync records
pub async fn get_all_backup_syncs(db: &SqlitePool) -> AppResult<Vec<CloudBackupSync>> {
    let rows = sqlx::query(
        r#"
        SELECT id, local_backup_path, instance_id, world_name, backup_filename,
               remote_path, sync_status, last_synced_at, file_size_bytes, error_message
        FROM cloud_backup_sync
        ORDER BY last_synced_at DESC NULLS LAST
        "#,
    )
    .fetch_all(db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| CloudBackupSync {
            id: r.get("id"),
            local_backup_path: r.get("local_backup_path"),
            instance_id: r.get("instance_id"),
            world_name: r.get("world_name"),
            backup_filename: r.get("backup_filename"),
            remote_path: r.get("remote_path"),
            sync_status: r
                .get::<String, _>("sync_status")
                .parse()
                .unwrap_or(CloudSyncStatus::Pending),
            last_synced_at: r.get("last_synced_at"),
            file_size_bytes: r.get("file_size_bytes"),
            error_message: r.get("error_message"),
        })
        .collect())
}

/// Get pending backups that haven't been synced yet
pub async fn get_pending_backups(db: &SqlitePool) -> AppResult<Vec<CloudBackupSync>> {
    let rows = sqlx::query(
        r#"
        SELECT id, local_backup_path, instance_id, world_name, backup_filename,
               remote_path, sync_status, last_synced_at, file_size_bytes, error_message
        FROM cloud_backup_sync
        WHERE sync_status = 'pending'
        ORDER BY created_at ASC
        "#,
    )
    .fetch_all(db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| CloudBackupSync {
            id: r.get("id"),
            local_backup_path: r.get("local_backup_path"),
            instance_id: r.get("instance_id"),
            world_name: r.get("world_name"),
            backup_filename: r.get("backup_filename"),
            remote_path: r.get("remote_path"),
            sync_status: r
                .get::<String, _>("sync_status")
                .parse()
                .unwrap_or(CloudSyncStatus::Pending),
            last_synced_at: r.get("last_synced_at"),
            file_size_bytes: r.get("file_size_bytes"),
            error_message: r.get("error_message"),
        })
        .collect())
}

/// Create or update a backup sync record
pub async fn upsert_backup_sync(db: &SqlitePool, sync: &CloudBackupSync) -> AppResult<()> {
    sqlx::query(
        r#"
        INSERT INTO cloud_backup_sync (
            id, local_backup_path, instance_id, world_name, backup_filename,
            remote_path, sync_status, last_synced_at, file_size_bytes, error_message
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
        ON CONFLICT(id) DO UPDATE SET
            remote_path = excluded.remote_path,
            sync_status = excluded.sync_status,
            last_synced_at = excluded.last_synced_at,
            file_size_bytes = excluded.file_size_bytes,
            error_message = excluded.error_message
        "#,
    )
    .bind(&sync.id)
    .bind(&sync.local_backup_path)
    .bind(&sync.instance_id)
    .bind(&sync.world_name)
    .bind(&sync.backup_filename)
    .bind(&sync.remote_path)
    .bind(sync.sync_status.to_string())
    .bind(&sync.last_synced_at)
    .bind(sync.file_size_bytes)
    .bind(&sync.error_message)
    .execute(db)
    .await?;
    Ok(())
}


/// Delete a backup sync record
pub async fn delete_backup_sync(db: &SqlitePool, id: &str) -> AppResult<()> {
    sqlx::query("DELETE FROM cloud_backup_sync WHERE id = ?1")
        .bind(id)
        .execute(db)
        .await?;
    Ok(())
}

/// Delete sync records for a specific backup file
#[allow(dead_code)]
pub async fn delete_sync_by_filename(db: &SqlitePool, backup_filename: &str) -> AppResult<()> {
    sqlx::query("DELETE FROM cloud_backup_sync WHERE backup_filename = ?1")
        .bind(backup_filename)
        .execute(db)
        .await?;
    Ok(())
}
