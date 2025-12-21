use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};

/// Full account with tokens - used internally only, NEVER sent to frontend
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Account {
    pub id: String,
    pub uuid: String,
    pub username: String,
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: String,
    pub skin_url: Option<String>,
    pub is_active: bool,
    pub created_at: String,
}

/// Safe account info for frontend - NO SENSITIVE TOKENS
/// This is what gets returned to the frontend via IPC
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountInfo {
    pub id: String,
    pub uuid: String,
    pub username: String,
    pub expires_at: String,
    pub skin_url: Option<String>,
    pub is_active: bool,
    pub created_at: String,
    /// Indicates if the account has a valid token (without exposing it)
    pub has_valid_token: bool,
    /// Indicates if the account is an offline account
    pub is_offline: bool,
}

impl Account {
    /// Convert to safe AccountInfo for frontend
    pub fn to_info(&self) -> AccountInfo {
        let is_offline = self.access_token == "offline";
        let has_valid_token = is_offline || !self.access_token.is_empty();

        AccountInfo {
            id: self.id.clone(),
            uuid: self.uuid.clone(),
            username: self.username.clone(),
            expires_at: self.expires_at.clone(),
            skin_url: self.skin_url.clone(),
            is_active: self.is_active,
            created_at: self.created_at.clone(),
            has_valid_token,
            is_offline,
        }
    }
}

impl Account {
    pub async fn get_all(db: &SqlitePool) -> sqlx::Result<Vec<Self>> {
        sqlx::query_as::<_, Account>(
            r#"
            SELECT
                id, uuid, username, access_token, refresh_token,
                expires_at, skin_url, is_active, created_at
            FROM accounts
            ORDER BY created_at DESC
            "#,
        )
        .fetch_all(db)
        .await
    }

    pub async fn get_by_id(db: &SqlitePool, account_id: &str) -> sqlx::Result<Option<Self>> {
        sqlx::query_as::<_, Account>(
            r#"
            SELECT
                id, uuid, username, access_token, refresh_token,
                expires_at, skin_url, is_active, created_at
            FROM accounts
            WHERE id = ?
            LIMIT 1
            "#,
        )
        .bind(account_id)
        .fetch_optional(db)
        .await
    }

    pub async fn get_active(db: &SqlitePool) -> sqlx::Result<Option<Self>> {
        sqlx::query_as::<_, Account>(
            r#"
            SELECT
                id, uuid, username, access_token, refresh_token,
                expires_at, skin_url, is_active, created_at
            FROM accounts
            WHERE is_active = 1
            LIMIT 1
            "#,
        )
        .fetch_optional(db)
        .await
    }

    pub async fn insert(&self, db: &SqlitePool) -> sqlx::Result<()> {
        sqlx::query(
            r#"
            INSERT INTO accounts (id, uuid, username, access_token, refresh_token, expires_at, skin_url, is_active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(uuid) DO UPDATE SET
                id = excluded.id,
                username = excluded.username,
                access_token = excluded.access_token,
                refresh_token = excluded.refresh_token,
                expires_at = excluded.expires_at,
                skin_url = excluded.skin_url
            "#
        )
        .bind(&self.id)
        .bind(&self.uuid)
        .bind(&self.username)
        .bind(&self.access_token)
        .bind(&self.refresh_token)
        .bind(&self.expires_at)
        .bind(&self.skin_url)
        .bind(self.is_active)
        .execute(db)
        .await?;
        Ok(())
    }

    pub async fn set_active(db: &SqlitePool, account_id: &str) -> sqlx::Result<()> {
        sqlx::query("UPDATE accounts SET is_active = 0")
            .execute(db)
            .await?;
        sqlx::query("UPDATE accounts SET is_active = 1 WHERE id = ?")
            .bind(account_id)
            .execute(db)
            .await?;
        Ok(())
    }

    pub async fn delete(db: &SqlitePool, account_id: &str) -> sqlx::Result<()> {
        sqlx::query("DELETE FROM accounts WHERE id = ?")
            .bind(account_id)
            .execute(db)
            .await?;
        Ok(())
    }

    pub async fn update_tokens(
        db: &SqlitePool,
        account_id: &str,
        access_token: &str,
        refresh_token: &str,
    ) -> sqlx::Result<()> {
        sqlx::query(
            "UPDATE accounts SET access_token = ?, refresh_token = ? WHERE id = ?",
        )
        .bind(access_token)
        .bind(refresh_token)
        .bind(account_id)
        .execute(db)
        .await?;
        Ok(())
    }
}
