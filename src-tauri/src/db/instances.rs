use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Instance {
    pub id: String,
    pub name: String,
    pub icon_path: Option<String>,
    pub mc_version: String,
    pub loader: Option<String>,
    pub loader_version: Option<String>,
    pub java_path: Option<String>,
    pub memory_min_mb: i64,
    pub memory_max_mb: i64,
    pub jvm_args: String,
    pub game_dir: String,
    pub created_at: String,
    pub last_played: Option<String>,
    pub total_playtime_seconds: i64,
    #[serde(default)]
    pub is_server: bool,
    #[serde(default)]
    pub is_proxy: bool,
    #[serde(default = "default_server_port")]
    pub server_port: i64,
    pub modrinth_project_id: Option<String>,
}

fn default_server_port() -> i64 {
    25565
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateInstance {
    pub name: String,
    pub mc_version: String,
    pub loader: Option<String>,
    pub loader_version: Option<String>,
    #[serde(default)]
    pub is_server: bool,
    #[serde(default)]
    pub is_proxy: bool,
    #[serde(default = "default_server_port")]
    pub server_port: i64,
    pub modrinth_project_id: Option<String>,
}

impl Instance {
    pub async fn get_all(db: &SqlitePool) -> sqlx::Result<Vec<Self>> {
        sqlx::query_as::<_, Instance>(
            r#"
            SELECT
                id, name, icon_path, mc_version, loader, loader_version,
                java_path, memory_min_mb, memory_max_mb, jvm_args, game_dir,
                created_at, last_played, total_playtime_seconds,
                COALESCE(is_server, 0) as is_server,
                COALESCE(is_proxy, 0) as is_proxy,
                COALESCE(server_port, 25565) as server_port,
                modrinth_project_id
            FROM instances
            ORDER BY last_played DESC NULLS LAST, created_at DESC
            "#,
        )
        .fetch_all(db)
        .await
    }

    pub async fn get_by_id(db: &SqlitePool, id: &str) -> sqlx::Result<Option<Self>> {
        sqlx::query_as::<_, Instance>(
            r#"
            SELECT
                id, name, icon_path, mc_version, loader, loader_version,
                java_path, memory_min_mb, memory_max_mb, jvm_args, game_dir,
                created_at, last_played, total_playtime_seconds,
                COALESCE(is_server, 0) as is_server,
                COALESCE(is_proxy, 0) as is_proxy,
                COALESCE(server_port, 25565) as server_port,
                modrinth_project_id
            FROM instances
            WHERE id = ?
            "#,
        )
        .bind(id)
        .fetch_optional(db)
        .await
    }

    pub async fn create(db: &SqlitePool, data: CreateInstance) -> sqlx::Result<Self> {
        let id = uuid::Uuid::new_v4().to_string();
        let game_dir = data.name.to_lowercase().replace(' ', "-");

        sqlx::query(
            r#"
            INSERT INTO instances (id, name, mc_version, loader, loader_version, game_dir, is_server, is_proxy, server_port, modrinth_project_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#
        )
        .bind(&id)
        .bind(&data.name)
        .bind(&data.mc_version)
        .bind(&data.loader)
        .bind(&data.loader_version)
        .bind(&game_dir)
        .bind(data.is_server)
        .bind(data.is_proxy)
        .bind(data.server_port)
        .bind(&data.modrinth_project_id)
        .execute(db)
        .await?;

        Self::get_by_id(db, &id)
            .await?
            .ok_or(sqlx::Error::RowNotFound)
    }

    pub async fn get_by_modrinth_project_id(
        db: &SqlitePool,
        project_id: &str,
    ) -> sqlx::Result<Vec<Self>> {
        sqlx::query_as::<_, Instance>(
            r#"
            SELECT
                id, name, icon_path, mc_version, loader, loader_version,
                java_path, memory_min_mb, memory_max_mb, jvm_args, game_dir,
                created_at, last_played, total_playtime_seconds,
                COALESCE(is_server, 0) as is_server,
                COALESCE(is_proxy, 0) as is_proxy,
                COALESCE(server_port, 25565) as server_port,
                modrinth_project_id
            FROM instances
            WHERE modrinth_project_id = ?
            ORDER BY created_at DESC
            "#,
        )
        .bind(project_id)
        .fetch_all(db)
        .await
    }

    pub async fn get_installed_modpack_ids(db: &SqlitePool) -> sqlx::Result<Vec<String>> {
        let rows = sqlx::query_scalar::<_, String>(
            r#"
            SELECT DISTINCT modrinth_project_id
            FROM instances
            WHERE modrinth_project_id IS NOT NULL
            "#,
        )
        .fetch_all(db)
        .await?;

        Ok(rows)
    }

    pub async fn delete(db: &SqlitePool, id: &str) -> sqlx::Result<()> {
        sqlx::query("DELETE FROM instances WHERE id = ?")
            .bind(id)
            .execute(db)
            .await?;
        Ok(())
    }

    pub async fn update_last_played(db: &SqlitePool, id: &str) -> sqlx::Result<()> {
        sqlx::query("UPDATE instances SET last_played = datetime('now') WHERE id = ?")
            .bind(id)
            .execute(db)
            .await?;
        Ok(())
    }

    pub async fn add_playtime(db: &SqlitePool, id: &str, seconds: i64) -> sqlx::Result<()> {
        sqlx::query(
            "UPDATE instances SET total_playtime_seconds = total_playtime_seconds + ? WHERE id = ?",
        )
        .bind(seconds)
        .bind(id)
        .execute(db)
        .await?;
        Ok(())
    }

    pub async fn update_settings(
        db: &SqlitePool,
        id: &str,
        name: &str,
        memory_min_mb: i64,
        memory_max_mb: i64,
        java_path: Option<&str>,
        jvm_args: Option<&str>,
    ) -> sqlx::Result<()> {
        sqlx::query(
            r#"
            UPDATE instances
            SET name = ?, memory_min_mb = ?, memory_max_mb = ?, java_path = ?, jvm_args = ?
            WHERE id = ?
            "#,
        )
        .bind(name)
        .bind(memory_min_mb)
        .bind(memory_max_mb)
        .bind(java_path)
        .bind(jvm_args.unwrap_or(""))
        .bind(id)
        .execute(db)
        .await?;
        Ok(())
    }

    pub async fn update_icon(
        db: &SqlitePool,
        id: &str,
        icon_path: Option<&str>,
    ) -> sqlx::Result<()> {
        sqlx::query("UPDATE instances SET icon_path = ? WHERE id = ?")
            .bind(icon_path)
            .bind(id)
            .execute(db)
            .await?;
        Ok(())
    }

    pub async fn update_version(
        db: &SqlitePool,
        id: &str,
        mc_version: &str,
        loader: Option<&str>,
        loader_version: Option<&str>,
    ) -> sqlx::Result<()> {
        sqlx::query(
            r#"
            UPDATE instances
            SET mc_version = ?, loader = ?, loader_version = ?
            WHERE id = ?
            "#,
        )
        .bind(mc_version)
        .bind(loader)
        .bind(loader_version)
        .bind(id)
        .execute(db)
        .await?;
        Ok(())
    }
}
