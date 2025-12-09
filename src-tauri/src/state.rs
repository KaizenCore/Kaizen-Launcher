use crate::crypto;
use crate::tunnel::RunningTunnel;
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::process::ChildStdin;
use tokio::sync::{Mutex, RwLock};

/// Tracks running Minecraft instances
pub type RunningInstances = Arc<RwLock<HashMap<String, u32>>>; // instance_id -> pid

/// Tracks server stdin handles for sending commands
pub type ServerStdinHandles = Arc<RwLock<HashMap<String, Arc<Mutex<ChildStdin>>>>>;

/// Tracks running tunnels
pub type RunningTunnels = Arc<RwLock<HashMap<String, RunningTunnel>>>; // instance_id -> tunnel

pub struct AppState {
    pub db: SqlitePool,
    pub http_client: reqwest::Client,
    pub data_dir: std::path::PathBuf,
    pub running_instances: RunningInstances,
    pub server_stdin_handles: ServerStdinHandles,
    pub running_tunnels: RunningTunnels,
    pub encryption_key: [u8; 32],
}

impl AppState {
    pub async fn new() -> anyhow::Result<Self> {
        let data_dir = crate::utils::paths::get_data_dir()?;

        // Ensure data directory exists
        std::fs::create_dir_all(&data_dir)?;

        // Initialize encryption key
        let encryption_key = crypto::get_or_create_key(&data_dir)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to initialize encryption: {}", e))?;

        // Initialize database
        let db_path = data_dir.join("kaizen.db");
        let db_url = format!("sqlite:{}?mode=rwc", db_path.display());
        let db = SqlitePool::connect(&db_url).await?;

        // Run migrations manually
        Self::run_migrations(&db).await?;

        // Create HTTP client
        let http_client = reqwest::Client::builder()
            .user_agent("KaizenLauncher/0.1.0")
            .build()?;

        Ok(Self {
            db,
            http_client,
            data_dir,
            running_instances: Arc::new(RwLock::new(HashMap::new())),
            server_stdin_handles: Arc::new(RwLock::new(HashMap::new())),
            running_tunnels: Arc::new(RwLock::new(HashMap::new())),
            encryption_key,
        })
    }

    async fn run_migrations(db: &SqlitePool) -> anyhow::Result<()> {
        sqlx::query(
            r#"
            -- Comptes Microsoft
            CREATE TABLE IF NOT EXISTS accounts (
                id TEXT PRIMARY KEY,
                uuid TEXT NOT NULL UNIQUE,
                username TEXT NOT NULL,
                access_token TEXT NOT NULL,
                refresh_token TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                skin_url TEXT,
                is_active INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now'))
            );

            CREATE INDEX IF NOT EXISTS idx_accounts_active ON accounts(is_active);
        "#,
        )
        .execute(db)
        .await?;

        sqlx::query(
            r#"
            -- Instances
            CREATE TABLE IF NOT EXISTS instances (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                icon_path TEXT,
                mc_version TEXT NOT NULL,
                loader TEXT,
                loader_version TEXT,
                java_path TEXT,
                memory_min_mb INTEGER DEFAULT 1024,
                memory_max_mb INTEGER DEFAULT 4096,
                jvm_args TEXT DEFAULT '[]',
                game_dir TEXT NOT NULL,
                created_at TEXT DEFAULT (datetime('now')),
                last_played TEXT,
                total_playtime_seconds INTEGER DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_instances_last_played ON instances(last_played DESC);
            CREATE INDEX IF NOT EXISTS idx_instances_mc_version ON instances(mc_version);
            CREATE INDEX IF NOT EXISTS idx_instances_loader ON instances(loader);
            CREATE INDEX IF NOT EXISTS idx_instances_name ON instances(name);
        "#,
        )
        .execute(db)
        .await?;

        sqlx::query(r#"
            -- Mods par instance
            CREATE TABLE IF NOT EXISTS instance_mods (
                id TEXT PRIMARY KEY,
                instance_id TEXT NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                source TEXT NOT NULL,
                source_id TEXT,
                version_id TEXT,
                file_name TEXT NOT NULL,
                file_path TEXT NOT NULL,
                enabled INTEGER DEFAULT 1,
                created_at TEXT DEFAULT (datetime('now'))
            );

            CREATE INDEX IF NOT EXISTS idx_instance_mods_instance ON instance_mods(instance_id);
            CREATE INDEX IF NOT EXISTS idx_instance_mods_enabled ON instance_mods(instance_id, enabled);
            CREATE INDEX IF NOT EXISTS idx_instance_mods_source ON instance_mods(source, source_id);
        "#)
        .execute(db)
        .await?;

        sqlx::query(
            r#"
            -- Settings
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT DEFAULT (datetime('now'))
            );
        "#,
        )
        .execute(db)
        .await?;

        // Default settings
        sqlx::query(
            r#"
            INSERT OR IGNORE INTO settings (key, value) VALUES
                ('theme', '"system"'),
                ('language', '"fr"'),
                ('default_memory_min', '1024'),
                ('default_memory_max', '4096'),
                ('max_concurrent_downloads', '5'),
                ('show_snapshots', 'false'),
                ('check_updates', 'true')
        "#,
        )
        .execute(db)
        .await?;

        // Migration: Add server mode columns to instances
        // These are idempotent - will silently fail if columns already exist
        let _ = sqlx::query("ALTER TABLE instances ADD COLUMN is_server INTEGER DEFAULT 0")
            .execute(db)
            .await;
        let _ = sqlx::query("ALTER TABLE instances ADD COLUMN is_proxy INTEGER DEFAULT 0")
            .execute(db)
            .await;
        let _ = sqlx::query("ALTER TABLE instances ADD COLUMN server_port INTEGER DEFAULT 25565")
            .execute(db)
            .await;

        // Migration: Add modrinth_project_id column to instances
        let _ = sqlx::query("ALTER TABLE instances ADD COLUMN modrinth_project_id TEXT")
            .execute(db)
            .await;

        // Migration: Tunnel configurations table
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS tunnel_configs (
                id TEXT PRIMARY KEY,
                instance_id TEXT NOT NULL UNIQUE,
                provider TEXT NOT NULL,
                enabled INTEGER DEFAULT 0,
                auto_start INTEGER DEFAULT 1,
                playit_secret_key TEXT,
                ngrok_authtoken TEXT,
                target_port INTEGER DEFAULT 25565,
                tunnel_url TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            );

            CREATE INDEX IF NOT EXISTS idx_tunnel_configs_instance ON tunnel_configs(instance_id);
        "#,
        )
        .execute(db)
        .await?;

        // Migration: Add ngrok_authtoken column for existing DBs
        let _ = sqlx::query("ALTER TABLE tunnel_configs ADD COLUMN ngrok_authtoken TEXT")
            .execute(db)
            .await;

        Ok(())
    }
}

pub type SharedState = Arc<RwLock<AppState>>;
