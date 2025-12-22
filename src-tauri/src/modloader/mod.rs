// Modloader support for Minecraft launchers
// Supports: Fabric, Forge, NeoForge, Quilt
// Servers: Paper, Purpur, Folia, Pufferfish, Spigot, SpongeVanilla, SpongeForge
// Proxies: Velocity, BungeeCord, Waterfall

pub mod commands;
pub mod fabric;
pub mod forge;
pub mod forge_processor;
pub mod installer;
pub mod neoforge;
pub mod neoforge_processor;
pub mod paper;
pub mod quilt;

use serde::{Deserialize, Serialize};

/// Represents a loader type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LoaderType {
    Vanilla,
    Fabric,
    Forge,
    NeoForge,
    Quilt,
    // Server types
    Paper,
    Purpur,
    Folia,
    Pufferfish,
    Spigot,
    SpongeVanilla,
    SpongeForge,
    // Proxy types
    Velocity,
    BungeeCord,
    Waterfall,
}

impl LoaderType {
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "vanilla" => Some(Self::Vanilla),
            "fabric" => Some(Self::Fabric),
            "forge" => Some(Self::Forge),
            "neoforge" => Some(Self::NeoForge),
            "quilt" => Some(Self::Quilt),
            "paper" => Some(Self::Paper),
            "purpur" => Some(Self::Purpur),
            "folia" => Some(Self::Folia),
            "pufferfish" => Some(Self::Pufferfish),
            "spigot" => Some(Self::Spigot),
            "spongevanilla" => Some(Self::SpongeVanilla),
            "spongeforge" => Some(Self::SpongeForge),
            "velocity" => Some(Self::Velocity),
            "bungeecord" => Some(Self::BungeeCord),
            "waterfall" => Some(Self::Waterfall),
            _ => None,
        }
    }

    pub fn is_client_loader(&self) -> bool {
        matches!(
            self,
            Self::Vanilla | Self::Fabric | Self::Forge | Self::NeoForge | Self::Quilt
        )
    }

    #[allow(dead_code)]
    pub fn is_server(&self) -> bool {
        matches!(
            self,
            Self::Paper
                | Self::Purpur
                | Self::Folia
                | Self::Pufferfish
                | Self::Spigot
                | Self::SpongeVanilla
                | Self::SpongeForge
                | Self::Velocity
                | Self::BungeeCord
                | Self::Waterfall
        )
    }

    #[allow(dead_code)]
    pub fn is_proxy(&self) -> bool {
        matches!(self, Self::Velocity | Self::BungeeCord | Self::Waterfall)
    }

    /// Check if this loader uses mods (vs plugins)
    #[allow(dead_code)]
    pub fn uses_mods(&self) -> bool {
        matches!(
            self,
            Self::Fabric | Self::Forge | Self::NeoForge | Self::Quilt | Self::SpongeForge
        )
    }

    #[allow(dead_code)]
    pub fn display_name(&self) -> &'static str {
        match self {
            Self::Vanilla => "Vanilla",
            Self::Fabric => "Fabric",
            Self::Forge => "Forge",
            Self::NeoForge => "NeoForge",
            Self::Quilt => "Quilt",
            Self::Paper => "Paper",
            Self::Purpur => "Purpur",
            Self::Folia => "Folia",
            Self::Pufferfish => "Pufferfish",
            Self::Spigot => "Spigot",
            Self::SpongeVanilla => "SpongeVanilla",
            Self::SpongeForge => "SpongeForge",
            Self::Velocity => "Velocity",
            Self::BungeeCord => "BungeeCord",
            Self::Waterfall => "Waterfall",
        }
    }
}

/// Common loader version info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoaderVersion {
    pub version: String,
    pub stable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub minecraft_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub download_url: Option<String>,
}

/// Information about available loaders for a Minecraft version
#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct LoaderInfo {
    pub loader_type: String,
    pub name: String,
    pub versions: Vec<LoaderVersion>,
}
