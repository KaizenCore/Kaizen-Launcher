use crate::crypto;
use crate::tunnel::RunningTunnel;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::str::FromStr;
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
    /// Get the instances directory - either custom or default
    /// NOTE: This method is already optimized - settings table uses PRIMARY KEY index
    /// and the query is simple. No caching needed as the DB query is fast.
    pub async fn get_instances_dir(&self) -> std::path::PathBuf {
        // Check for custom instances directory in settings
        if let Ok(Some(custom_dir)) =
            crate::db::settings::get_setting(&self.db, "instances_dir").await
        {
            let path = std::path::PathBuf::from(&custom_dir);
            if path.exists() || std::fs::create_dir_all(&path).is_ok() {
                return path;
            }
        }
        // Default to data_dir/instances
        self.data_dir.join("instances")
    }

    /// Get the default instances directory path
    pub fn get_default_instances_dir(&self) -> std::path::PathBuf {
        self.data_dir.join("instances")
    }

    pub async fn new() -> anyhow::Result<Self> {
        let data_dir = crate::utils::paths::get_data_dir()?;

        // Ensure data directory exists
        std::fs::create_dir_all(&data_dir)?;

        // Initialize encryption key
        let encryption_key = crypto::get_or_create_key(&data_dir)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to initialize encryption: {}", e))?;

        // Initialize database with optimized settings
        let db_path = data_dir.join("kaizen.db");

        // Configure SQLite with WAL mode for better concurrency
        let connect_options =
            SqliteConnectOptions::from_str(&format!("sqlite:{}", db_path.display()))?
                .create_if_missing(true)
                .journal_mode(SqliteJournalMode::Wal) // WAL mode for concurrent reads
                .synchronous(SqliteSynchronous::Normal) // Faster than FULL, still safe with WAL
                .busy_timeout(std::time::Duration::from_secs(30)); // Wait up to 30s if locked

        // Create pool with more connections for better concurrency
        // Set slow_statement_threshold to reduce warning spam in logs
        let db = SqlitePoolOptions::new()
            .max_connections(50) // Increased from 20 to handle parallel UI calls
            .min_connections(5) // Keep more connections ready
            .acquire_timeout(std::time::Duration::from_secs(60)) // Longer timeout
            .connect_with(connect_options)
            .await?;

        // Run migrations manually
        Self::run_migrations(&db).await?;

        // Create HTTP client with timeouts to prevent hanging requests
        let http_client = reqwest::Client::builder()
            .user_agent("KaizenLauncher/0.5.4")
            .timeout(std::time::Duration::from_secs(30))
            .connect_timeout(std::time::Duration::from_secs(10))
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

            -- Index for settings is not needed as key is already PRIMARY KEY
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

        // Migration: Add auto_backup_worlds column to instances
        let _ =
            sqlx::query("ALTER TABLE instances ADD COLUMN auto_backup_worlds INTEGER DEFAULT 0")
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

        // Migration: Add bore_servers column for fallback support
        let _ = sqlx::query("ALTER TABLE tunnel_configs ADD COLUMN bore_servers TEXT")
            .execute(db)
            .await;

        // Migration: Cloud storage configuration (global - one per app)
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS cloud_storage_config (
                id TEXT PRIMARY KEY DEFAULT 'global',
                provider TEXT NOT NULL,
                enabled INTEGER DEFAULT 0,
                auto_upload INTEGER DEFAULT 0,

                -- Google Drive (OAuth)
                google_access_token TEXT,
                google_refresh_token TEXT,
                google_expires_at TEXT,
                google_folder_id TEXT,

                -- Nextcloud (WebDAV)
                nextcloud_url TEXT,
                nextcloud_username TEXT,
                nextcloud_password TEXT,
                nextcloud_folder_path TEXT,

                -- S3-compatible (AWS/MinIO)
                s3_endpoint TEXT,
                s3_region TEXT,
                s3_bucket TEXT,
                s3_access_key TEXT,
                s3_secret_key TEXT,
                s3_folder_prefix TEXT,

                -- Dropbox (OAuth)
                dropbox_access_token TEXT,
                dropbox_refresh_token TEXT,
                dropbox_expires_at TEXT,
                dropbox_folder_path TEXT,

                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            );

            -- Index for cloud_storage_config.id already covered by PRIMARY KEY
        "#,
        )
        .execute(db)
        .await?;

        // Migration: Cloud backup sync tracking
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS cloud_backup_sync (
                id TEXT PRIMARY KEY,
                local_backup_path TEXT NOT NULL,
                instance_id TEXT NOT NULL,
                world_name TEXT NOT NULL,
                backup_filename TEXT NOT NULL,
                remote_path TEXT,
                sync_status TEXT DEFAULT 'pending',
                last_synced_at TEXT,
                file_size_bytes INTEGER,
                error_message TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            );

            CREATE INDEX IF NOT EXISTS idx_cloud_sync_status ON cloud_backup_sync(sync_status);
            CREATE INDEX IF NOT EXISTS idx_cloud_sync_instance ON cloud_backup_sync(instance_id);
        "#,
        )
        .execute(db)
        .await?;

        // Migration: Discord configuration
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS discord_config (
                id TEXT PRIMARY KEY DEFAULT 'global',
                rpc_enabled INTEGER DEFAULT 1,
                rpc_show_instance_name INTEGER DEFAULT 1,
                rpc_show_version INTEGER DEFAULT 1,
                rpc_show_playtime INTEGER DEFAULT 1,
                rpc_show_modloader INTEGER DEFAULT 1,
                webhook_enabled INTEGER DEFAULT 0,
                webhook_url TEXT,
                webhook_server_start INTEGER DEFAULT 1,
                webhook_server_stop INTEGER DEFAULT 1,
                webhook_backup_created INTEGER DEFAULT 0,
                webhook_player_join INTEGER DEFAULT 1,
                webhook_player_leave INTEGER DEFAULT 1,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS instance_webhook_config (
                instance_id TEXT PRIMARY KEY,
                webhook_url TEXT,
                enabled INTEGER DEFAULT 1,
                server_start INTEGER DEFAULT 1,
                server_stop INTEGER DEFAULT 1,
                player_join INTEGER DEFAULT 1,
                player_leave INTEGER DEFAULT 1,
                FOREIGN KEY (instance_id) REFERENCES instances(id) ON DELETE CASCADE
            );

            -- Skin favorites
            CREATE TABLE IF NOT EXISTS skin_favorites (
                id TEXT PRIMARY KEY,
                skin_id TEXT NOT NULL,
                name TEXT NOT NULL,
                url TEXT NOT NULL,
                thumbnail_url TEXT NOT NULL,
                variant TEXT NOT NULL DEFAULT 'classic',
                source TEXT NOT NULL DEFAULT 'mineskin',
                author TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            );

            CREATE INDEX IF NOT EXISTS idx_skin_favorites_created ON skin_favorites(created_at DESC);

            -- Persistent shares for automatic renewal on app restart
            CREATE TABLE IF NOT EXISTS persistent_shares (
                share_id TEXT PRIMARY KEY,
                instance_name TEXT NOT NULL,
                package_path TEXT NOT NULL,
                provider TEXT NOT NULL DEFAULT 'bore',
                password_hash TEXT,
                file_size INTEGER NOT NULL,
                created_at TEXT DEFAULT (datetime('now'))
            );

            -- Index for instance_webhook_config.instance_id already covered by PRIMARY KEY
        "#,
        )
        .execute(db)
        .await?;

        // Migration: Schematics tables
        sqlx::query(
            r#"
            -- Central schematics library
            CREATE TABLE IF NOT EXISTS schematics (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                filename TEXT NOT NULL,
                format TEXT NOT NULL,
                file_hash TEXT NOT NULL,
                file_size_bytes INTEGER NOT NULL,
                library_path TEXT,
                width INTEGER,
                height INTEGER,
                length INTEGER,
                author TEXT,
                description TEXT,
                mc_version TEXT,
                is_favorite INTEGER DEFAULT 0,
                tags TEXT DEFAULT '[]',
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            );

            CREATE INDEX IF NOT EXISTS idx_schematics_hash ON schematics(file_hash);
            CREATE INDEX IF NOT EXISTS idx_schematics_favorite ON schematics(is_favorite);
            CREATE INDEX IF NOT EXISTS idx_schematics_format ON schematics(format);
            CREATE INDEX IF NOT EXISTS idx_schematics_name ON schematics(name);

            -- Schematic-instance links for sync tracking
            CREATE TABLE IF NOT EXISTS schematic_instance_links (
                id TEXT PRIMARY KEY,
                schematic_id TEXT NOT NULL,
                instance_id TEXT NOT NULL,
                instance_path TEXT NOT NULL,
                source TEXT NOT NULL,
                sync_status TEXT DEFAULT 'synced',
                last_synced_at TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (schematic_id) REFERENCES schematics(id) ON DELETE CASCADE,
                FOREIGN KEY (instance_id) REFERENCES instances(id) ON DELETE CASCADE,
                UNIQUE(schematic_id, instance_id)
            );

            CREATE INDEX IF NOT EXISTS idx_schematic_links_instance ON schematic_instance_links(instance_id);
            CREATE INDEX IF NOT EXISTS idx_schematic_links_schematic ON schematic_instance_links(schematic_id);
            CREATE INDEX IF NOT EXISTS idx_schematic_links_status ON schematic_instance_links(sync_status);

            -- Cloud sync tracking for schematics
            CREATE TABLE IF NOT EXISTS schematic_cloud_sync (
                id TEXT PRIMARY KEY,
                schematic_id TEXT NOT NULL UNIQUE,
                remote_path TEXT,
                sync_status TEXT DEFAULT 'pending',
                last_synced_at TEXT,
                error_message TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (schematic_id) REFERENCES schematics(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_schematic_cloud_status ON schematic_cloud_sync(sync_status);
        "#,
        )
        .execute(db)
        .await?;

        // Migration: Add author_locked column to schematics
        let _ =
            sqlx::query("ALTER TABLE schematics ADD COLUMN author_locked INTEGER DEFAULT 0")
                .execute(db)
                .await;

        // Migration: Kaizen accounts table
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS kaizen_accounts (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL UNIQUE,
                username TEXT NOT NULL,
                email TEXT NOT NULL,
                access_token TEXT NOT NULL,
                refresh_token TEXT,
                expires_at TEXT NOT NULL,
                permissions TEXT NOT NULL DEFAULT '[]',
                tags TEXT NOT NULL DEFAULT '[]',
                badges TEXT NOT NULL DEFAULT '[]',
                is_patron INTEGER DEFAULT 0,
                is_active INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now'))
            );

            CREATE INDEX IF NOT EXISTS idx_kaizen_accounts_active ON kaizen_accounts(is_active);
            CREATE INDEX IF NOT EXISTS idx_kaizen_accounts_user ON kaizen_accounts(user_id);
        "#,
        )
        .execute(db)
        .await?;

        // Migration: Add badges column for existing kaizen_accounts tables
        let _ = sqlx::query("ALTER TABLE kaizen_accounts ADD COLUMN badges TEXT NOT NULL DEFAULT '[]'")
            .execute(db)
            .await;

        Ok(())
    }
}

pub type SharedState = Arc<RwLock<AppState>>;
