pub mod agent;
pub mod bore;
pub mod cloudflare;
pub mod commands;
pub mod manager;
pub mod ngrok;
pub mod playit;

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;

/// Tunnel provider types
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TunnelProvider {
    Playit,
    Cloudflare,
    Ngrok,
    Bore,
}

impl std::fmt::Display for TunnelProvider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TunnelProvider::Playit => write!(f, "playit"),
            TunnelProvider::Cloudflare => write!(f, "cloudflare"),
            TunnelProvider::Ngrok => write!(f, "ngrok"),
            TunnelProvider::Bore => write!(f, "bore"),
        }
    }
}

impl std::str::FromStr for TunnelProvider {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "playit" => Ok(TunnelProvider::Playit),
            "cloudflare" => Ok(TunnelProvider::Cloudflare),
            "ngrok" => Ok(TunnelProvider::Ngrok),
            "bore" => Ok(TunnelProvider::Bore),
            _ => Err(format!("Unknown tunnel provider: {}", s)),
        }
    }
}

/// Tunnel status
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TunnelStatus {
    #[default]
    Disconnected,
    Connecting,
    Connected {
        url: String,
    },
    WaitingForClaim {
        claim_url: String,
    },
    Error {
        message: String,
    },
}

/// Tunnel configuration stored in database
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TunnelConfig {
    pub id: String,
    pub instance_id: String,
    pub provider: TunnelProvider,
    pub enabled: bool,
    pub auto_start: bool,
    pub playit_secret_key: Option<String>,
    pub ngrok_authtoken: Option<String>,
    pub target_port: i32,
    pub tunnel_url: Option<String>,
}

impl TunnelConfig {
    #[allow(dead_code)]
    pub fn new(instance_id: &str, provider: TunnelProvider) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            instance_id: instance_id.to_string(),
            provider,
            enabled: false,
            auto_start: true,
            playit_secret_key: None,
            ngrok_authtoken: None,
            target_port: 25565,
            tunnel_url: None,
        }
    }
}

/// Information about a running tunnel
#[derive(Debug, Clone)]
pub struct RunningTunnel {
    #[allow(dead_code)]
    pub instance_id: String,
    pub provider: TunnelProvider,
    pub pid: u32,
    pub status: Arc<RwLock<TunnelStatus>>,
}

/// Agent installation info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentInfo {
    pub provider: TunnelProvider,
    pub version: Option<String>,
    pub path: String,
    pub installed: bool,
}

/// Event emitted when tunnel status changes
#[derive(Debug, Clone, Serialize)]
pub struct TunnelStatusEvent {
    pub instance_id: String,
    pub provider: String,
    pub status: TunnelStatus,
}

/// Event emitted when tunnel URL is available
#[derive(Debug, Clone, Serialize)]
pub struct TunnelUrlEvent {
    pub instance_id: String,
    pub url: String,
}
