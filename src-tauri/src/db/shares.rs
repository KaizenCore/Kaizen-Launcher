//! Database operations for persistent shares

use crate::error::AppResult;
use crate::sharing::server::SharingProvider;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

/// A persistent share record stored in the database
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct PersistentShare {
    pub share_id: String,
    pub instance_name: String,
    pub package_path: String,
    pub provider: String,
    pub password_hash: Option<String>,
    pub file_size: i64,
    pub created_at: String,
}

impl PersistentShare {
    /// Convert provider string to SharingProvider enum
    pub fn get_provider(&self) -> SharingProvider {
        match self.provider.as_str() {
            "cloudflare" => SharingProvider::Cloudflare,
            _ => SharingProvider::Bore,
        }
    }
}

/// Save a share to the database for persistence
pub async fn save_share(
    db: &SqlitePool,
    share_id: &str,
    instance_name: &str,
    package_path: &str,
    provider: SharingProvider,
    password_hash: Option<&str>,
    file_size: u64,
) -> AppResult<()> {
    let provider_str = match provider {
        SharingProvider::Bore => "bore",
        SharingProvider::Cloudflare => "cloudflare",
    };

    sqlx::query(
        r#"
        INSERT OR REPLACE INTO persistent_shares
        (share_id, instance_name, package_path, provider, password_hash, file_size, created_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        "#,
    )
    .bind(share_id)
    .bind(instance_name)
    .bind(package_path)
    .bind(provider_str)
    .bind(password_hash)
    .bind(file_size as i64)
    .execute(db)
    .await?;

    tracing::info!("[SHARE DB] Saved persistent share: {}", share_id);
    Ok(())
}

/// Delete a share from the database
pub async fn delete_share(db: &SqlitePool, share_id: &str) -> AppResult<()> {
    sqlx::query("DELETE FROM persistent_shares WHERE share_id = ?")
        .bind(share_id)
        .execute(db)
        .await?;

    tracing::info!("[SHARE DB] Deleted persistent share: {}", share_id);
    Ok(())
}

/// Delete all shares from the database
pub async fn delete_all_shares(db: &SqlitePool) -> AppResult<()> {
    sqlx::query("DELETE FROM persistent_shares")
        .execute(db)
        .await?;

    tracing::info!("[SHARE DB] Deleted all persistent shares");
    Ok(())
}

/// Get all persistent shares from the database
pub async fn get_all_shares(db: &SqlitePool) -> AppResult<Vec<PersistentShare>> {
    let shares = sqlx::query_as::<_, PersistentShare>(
        "SELECT share_id, instance_name, package_path, provider, password_hash, file_size, created_at FROM persistent_shares",
    )
    .fetch_all(db)
    .await?;

    Ok(shares)
}

/// Check if a package path is already being shared
pub async fn is_package_shared(db: &SqlitePool, package_path: &str) -> AppResult<bool> {
    let count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM persistent_shares WHERE package_path = ?")
            .bind(package_path)
            .fetch_one(db)
            .await?;

    Ok(count.0 > 0)
}
