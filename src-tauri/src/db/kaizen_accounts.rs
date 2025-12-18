use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};

/// Kaizen account with permissions, tags, and badges
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct KaizenAccount {
    pub id: String,
    pub user_id: String,
    pub username: String,
    pub email: String,
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: String,
    pub permissions: String, // JSON array of permission strings
    pub tags: String,        // JSON array of tag objects
    pub badges: String,      // JSON array of badge objects
    pub is_patron: bool,
    pub is_active: bool,
    pub created_at: String,
}

/// Tag with name and permissions
#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct KaizenTag {
    pub name: String,
    pub permissions: Vec<String>,
}

impl KaizenAccount {
    /// Get all Kaizen accounts
    pub async fn get_all(db: &SqlitePool) -> sqlx::Result<Vec<Self>> {
        sqlx::query_as::<_, KaizenAccount>(
            r#"
            SELECT
                id, user_id, username, email, access_token, refresh_token,
                expires_at, permissions, tags, badges, is_patron, is_active, created_at
            FROM kaizen_accounts
            ORDER BY created_at DESC
            "#,
        )
        .fetch_all(db)
        .await
    }

    /// Get a Kaizen account by ID
    pub async fn get_by_id(db: &SqlitePool, account_id: &str) -> sqlx::Result<Option<Self>> {
        sqlx::query_as::<_, KaizenAccount>(
            r#"
            SELECT
                id, user_id, username, email, access_token, refresh_token,
                expires_at, permissions, tags, badges, is_patron, is_active, created_at
            FROM kaizen_accounts
            WHERE id = ?
            LIMIT 1
            "#,
        )
        .bind(account_id)
        .fetch_optional(db)
        .await
    }

    /// Get the active Kaizen account
    pub async fn get_active(db: &SqlitePool) -> sqlx::Result<Option<Self>> {
        sqlx::query_as::<_, KaizenAccount>(
            r#"
            SELECT
                id, user_id, username, email, access_token, refresh_token,
                expires_at, permissions, tags, badges, is_patron, is_active, created_at
            FROM kaizen_accounts
            WHERE is_active = 1
            LIMIT 1
            "#,
        )
        .fetch_optional(db)
        .await
    }

    /// Insert or update a Kaizen account
    pub async fn insert(&self, db: &SqlitePool) -> sqlx::Result<()> {
        sqlx::query(
            r#"
            INSERT INTO kaizen_accounts (
                id, user_id, username, email, access_token, refresh_token,
                expires_at, permissions, tags, badges, is_patron, is_active
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                id = excluded.id,
                username = excluded.username,
                email = excluded.email,
                access_token = excluded.access_token,
                refresh_token = excluded.refresh_token,
                expires_at = excluded.expires_at,
                permissions = excluded.permissions,
                tags = excluded.tags,
                badges = excluded.badges,
                is_patron = excluded.is_patron
            "#,
        )
        .bind(&self.id)
        .bind(&self.user_id)
        .bind(&self.username)
        .bind(&self.email)
        .bind(&self.access_token)
        .bind(&self.refresh_token)
        .bind(&self.expires_at)
        .bind(&self.permissions)
        .bind(&self.tags)
        .bind(&self.badges)
        .bind(self.is_patron)
        .bind(self.is_active)
        .execute(db)
        .await?;
        Ok(())
    }

    /// Set a Kaizen account as active (deactivates all others)
    pub async fn set_active(db: &SqlitePool, account_id: &str) -> sqlx::Result<()> {
        sqlx::query("UPDATE kaizen_accounts SET is_active = 0")
            .execute(db)
            .await?;
        if !account_id.is_empty() {
            sqlx::query("UPDATE kaizen_accounts SET is_active = 1 WHERE id = ?")
                .bind(account_id)
                .execute(db)
                .await?;
        }
        Ok(())
    }

    /// Delete a Kaizen account
    pub async fn delete(db: &SqlitePool, account_id: &str) -> sqlx::Result<()> {
        sqlx::query("DELETE FROM kaizen_accounts WHERE id = ?")
            .bind(account_id)
            .execute(db)
            .await?;
        Ok(())
    }

    /// Update tokens after refresh
    pub async fn update_tokens(
        db: &SqlitePool,
        account_id: &str,
        access_token: &str,
        refresh_token: Option<&str>,
        expires_at: &str,
    ) -> sqlx::Result<()> {
        sqlx::query(
            r#"
            UPDATE kaizen_accounts
            SET access_token = ?, refresh_token = ?, expires_at = ?
            WHERE id = ?
            "#,
        )
        .bind(access_token)
        .bind(refresh_token)
        .bind(expires_at)
        .bind(account_id)
        .execute(db)
        .await?;
        Ok(())
    }

    /// Check if token is expired (with 5 minute buffer)
    pub fn is_token_expired(&self) -> bool {
        if let Ok(expires_at) = chrono::DateTime::parse_from_rfc3339(&self.expires_at) {
            let now = chrono::Utc::now();
            let buffer = chrono::Duration::minutes(5);
            expires_at.with_timezone(&chrono::Utc) <= now + buffer
        } else {
            // If we can't parse the date, assume it's expired
            true
        }
    }

    /// Update user info (username, email, tags, badges, permissions, patron status)
    pub async fn update_user_info(
        db: &SqlitePool,
        account_id: &str,
        username: &str,
        email: &str,
        permissions: &str,
        tags: &str,
        badges: &str,
        is_patron: bool,
    ) -> sqlx::Result<()> {
        sqlx::query(
            r#"
            UPDATE kaizen_accounts
            SET username = ?, email = ?, permissions = ?, tags = ?, badges = ?, is_patron = ?
            WHERE id = ?
            "#,
        )
        .bind(username)
        .bind(email)
        .bind(permissions)
        .bind(tags)
        .bind(badges)
        .bind(is_patron)
        .bind(account_id)
        .execute(db)
        .await?;
        Ok(())
    }

    /// Parse permissions from JSON string
    #[allow(dead_code)]
    pub fn get_permissions(&self) -> Vec<String> {
        serde_json::from_str(&self.permissions).unwrap_or_default()
    }

    /// Parse tags from JSON string
    #[allow(dead_code)]
    pub fn get_tags(&self) -> Vec<KaizenTag> {
        serde_json::from_str(&self.tags).unwrap_or_default()
    }

    /// Check if account has a specific permission
    #[allow(dead_code)]
    pub fn has_permission(&self, permission: &str) -> bool {
        self.get_permissions().contains(&permission.to_string())
    }
}
