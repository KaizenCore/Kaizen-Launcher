pub mod agent;
pub mod bore;
pub mod cloudflare;
pub mod commands;
pub mod health;
pub mod manager;
pub mod ngrok;
pub mod playit;

use crate::error::AppResult;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Arc;
use tauri::AppHandle;
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
    /// List of bore servers to try (in order of priority)
    /// If None, uses default servers from health module
    #[serde(default)]
    pub bore_servers: Option<Vec<String>>,
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
            bore_servers: None,
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

// ============================================================================
// Tunnel Provider Trait
// ============================================================================

/// Boxed future type for async trait methods (required for dyn compatibility)
pub type BoxFuture<'a, T> = std::pin::Pin<Box<dyn std::future::Future<Output = T> + Send + 'a>>;

/// Trait for tunnel provider implementations
///
/// This trait abstracts the common behavior across different tunnel providers
/// (Playit, Cloudflare, Ngrok, Bore) to reduce code duplication and provide
/// a consistent interface for tunnel management.
///
/// # Example
///
/// ```ignore
/// let provider = get_provider(TunnelProvider::Playit);
/// println!("Using provider: {}", provider.name());
///
/// if provider.requires_auth() && !provider.is_configured(&config) {
///     return Err("Provider requires authentication".into());
/// }
///
/// let tunnel = provider.start(data_dir, &config, &app).await?;
/// ```
pub trait TunnelProviderTrait: Send + Sync {
    /// Get the provider type enum value
    fn provider_type(&self) -> TunnelProvider;

    /// Get the provider name as a static string (e.g., "playit", "cloudflare")
    fn name(&self) -> &'static str;

    /// Start the tunnel and return a RunningTunnel instance
    ///
    /// This method spawns the tunnel process and sets up output monitoring
    /// for status updates and URL discovery.
    ///
    /// # Arguments
    /// * `data_dir` - The data directory where tunnel binaries are stored
    /// * `config` - The tunnel configuration containing port, auth tokens, etc.
    /// * `app` - The Tauri app handle for emitting events to the frontend
    ///
    /// # Returns
    /// A `RunningTunnel` instance containing the process ID and status
    fn start<'a>(
        &'a self,
        data_dir: &'a Path,
        config: &'a TunnelConfig,
        app: &'a AppHandle,
    ) -> BoxFuture<'a, AppResult<RunningTunnel>>;

    /// Check if this provider requires authentication before starting
    ///
    /// Providers like ngrok require an authtoken to be configured,
    /// while providers like Cloudflare quick tunnels work without auth.
    fn requires_auth(&self) -> bool {
        false
    }

    /// Check if the provider is properly configured with required credentials
    ///
    /// # Arguments
    /// * `config` - The tunnel configuration to check
    ///
    /// # Returns
    /// `true` if the provider has all required configuration, `false` otherwise
    fn is_configured(&self, _config: &TunnelConfig) -> bool {
        !self.requires_auth()
    }
}

// ============================================================================
// Provider Implementations (struct definitions)
// ============================================================================

/// Playit.gg tunnel provider
///
/// Playit provides free Minecraft server hosting through their tunneling service.
/// Uses a claim URL flow for first-time setup (no upfront auth required).
pub struct PlayitProvider;

/// Cloudflare Tunnel provider (Quick Tunnels)
///
/// Uses Cloudflare's free quick tunnel feature to expose local ports.
/// No authentication required - generates temporary public URLs.
pub struct CloudflareProvider;

/// ngrok tunnel provider
///
/// Popular tunneling service that requires a free account and authtoken.
/// Provides stable TCP tunnels with a web inspection interface.
pub struct NgrokProvider;

/// Bore tunnel provider
///
/// Open-source, self-hostable tunnel solution.
/// Works without authentication using public bore servers.
pub struct BoreProvider;

// ============================================================================
// Provider Factory
// ============================================================================

/// Get a tunnel provider instance by type
///
/// Returns a boxed trait object that can be used to start tunnels
/// through a unified interface.
///
/// # Arguments
/// * `provider` - The type of tunnel provider to create
///
/// # Example
/// ```ignore
/// let provider = get_provider(TunnelProvider::Ngrok);
/// if provider.requires_auth() {
///     // Handle auth requirement
/// }
/// ```
pub fn get_provider(provider: TunnelProvider) -> Box<dyn TunnelProviderTrait> {
    match provider {
        TunnelProvider::Playit => Box::new(PlayitProvider),
        TunnelProvider::Cloudflare => Box::new(CloudflareProvider),
        TunnelProvider::Ngrok => Box::new(NgrokProvider),
        TunnelProvider::Bore => Box::new(BoreProvider),
    }
}
