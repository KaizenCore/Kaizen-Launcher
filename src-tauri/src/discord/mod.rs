pub mod commands;
pub mod db;
pub mod hooks;
pub mod rpc;
pub mod webhook;

use serde::{Deserialize, Serialize};

/// Discord integration configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscordConfig {
    // Rich Presence settings
    pub rpc_enabled: bool,
    pub rpc_show_instance_name: bool,
    pub rpc_show_version: bool,
    pub rpc_show_playtime: bool,
    pub rpc_show_modloader: bool,

    // Webhook settings
    pub webhook_enabled: bool,
    pub webhook_url: Option<String>,
    pub webhook_server_start: bool,
    pub webhook_server_stop: bool,
    pub webhook_backup_created: bool,
    pub webhook_player_join: bool,
    pub webhook_player_leave: bool,
}

impl Default for DiscordConfig {
    fn default() -> Self {
        Self {
            rpc_enabled: false,
            rpc_show_instance_name: true,
            rpc_show_version: true,
            rpc_show_playtime: true,
            rpc_show_modloader: true,
            webhook_enabled: false,
            webhook_url: None,
            webhook_server_start: true,
            webhook_server_stop: true,
            webhook_backup_created: false,
            webhook_player_join: true,
            webhook_player_leave: true,
        }
    }
}

/// Per-instance webhook configuration override
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceWebhookConfig {
    pub instance_id: String,
    pub webhook_url: Option<String>,
    pub enabled: bool,
    pub server_start: bool,
    pub server_stop: bool,
    pub player_join: bool,
    pub player_leave: bool,
}

/// Discord Rich Presence activity state
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum DiscordActivity {
    Idle,
    Playing {
        instance_name: String,
        mc_version: String,
        loader: Option<String>,
        start_time: i64,
    },
    Hosting {
        instance_name: String,
        mc_version: String,
        player_count: Option<u32>,
        tunnel_url: Option<String>,
        start_time: i64,
    },
}

/// Webhook events that can be sent to Discord
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WebhookEvent {
    ServerStarted {
        instance_name: String,
        mc_version: String,
        loader: Option<String>,
    },
    ServerStopped {
        instance_name: String,
        uptime_seconds: i64,
    },
    BackupCreated {
        instance_name: String,
        world_name: String,
        filename: String,
    },
    PlayerJoined {
        instance_name: String,
        player_name: String,
    },
    PlayerLeft {
        instance_name: String,
        player_name: String,
    },
}
