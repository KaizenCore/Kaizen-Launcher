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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_loader_type_from_str_valid() {
        assert_eq!(LoaderType::from_str("vanilla"), Some(LoaderType::Vanilla));
        assert_eq!(LoaderType::from_str("fabric"), Some(LoaderType::Fabric));
        assert_eq!(LoaderType::from_str("forge"), Some(LoaderType::Forge));
        assert_eq!(LoaderType::from_str("neoforge"), Some(LoaderType::NeoForge));
        assert_eq!(LoaderType::from_str("quilt"), Some(LoaderType::Quilt));
        assert_eq!(LoaderType::from_str("paper"), Some(LoaderType::Paper));
        assert_eq!(LoaderType::from_str("purpur"), Some(LoaderType::Purpur));
        assert_eq!(LoaderType::from_str("velocity"), Some(LoaderType::Velocity));
    }

    #[test]
    fn test_loader_type_from_str_case_insensitive() {
        assert_eq!(LoaderType::from_str("FABRIC"), Some(LoaderType::Fabric));
        assert_eq!(LoaderType::from_str("Forge"), Some(LoaderType::Forge));
        assert_eq!(LoaderType::from_str("NeoForge"), Some(LoaderType::NeoForge));
        assert_eq!(LoaderType::from_str("PAPER"), Some(LoaderType::Paper));
    }

    #[test]
    fn test_loader_type_from_str_invalid() {
        assert_eq!(LoaderType::from_str("unknown"), None);
        assert_eq!(LoaderType::from_str(""), None);
        assert_eq!(LoaderType::from_str("not_a_loader"), None);
    }

    #[test]
    fn test_is_client_loader() {
        assert!(LoaderType::Vanilla.is_client_loader());
        assert!(LoaderType::Fabric.is_client_loader());
        assert!(LoaderType::Forge.is_client_loader());
        assert!(LoaderType::NeoForge.is_client_loader());
        assert!(LoaderType::Quilt.is_client_loader());

        assert!(!LoaderType::Paper.is_client_loader());
        assert!(!LoaderType::Velocity.is_client_loader());
        assert!(!LoaderType::BungeeCord.is_client_loader());
    }

    #[test]
    fn test_is_server() {
        assert!(LoaderType::Paper.is_server());
        assert!(LoaderType::Purpur.is_server());
        assert!(LoaderType::Folia.is_server());
        assert!(LoaderType::Pufferfish.is_server());
        assert!(LoaderType::Velocity.is_server());

        assert!(!LoaderType::Vanilla.is_server());
        assert!(!LoaderType::Fabric.is_server());
    }

    #[test]
    fn test_is_proxy() {
        assert!(LoaderType::Velocity.is_proxy());
        assert!(LoaderType::BungeeCord.is_proxy());
        assert!(LoaderType::Waterfall.is_proxy());

        assert!(!LoaderType::Paper.is_proxy());
        assert!(!LoaderType::Fabric.is_proxy());
    }

    #[test]
    fn test_uses_mods() {
        assert!(LoaderType::Fabric.uses_mods());
        assert!(LoaderType::Forge.uses_mods());
        assert!(LoaderType::NeoForge.uses_mods());
        assert!(LoaderType::Quilt.uses_mods());
        assert!(LoaderType::SpongeForge.uses_mods());

        assert!(!LoaderType::Vanilla.uses_mods());
        assert!(!LoaderType::Paper.uses_mods());
        assert!(!LoaderType::Velocity.uses_mods());
    }

    #[test]
    fn test_display_name() {
        assert_eq!(LoaderType::Vanilla.display_name(), "Vanilla");
        assert_eq!(LoaderType::Fabric.display_name(), "Fabric");
        assert_eq!(LoaderType::Forge.display_name(), "Forge");
        assert_eq!(LoaderType::NeoForge.display_name(), "NeoForge");
        assert_eq!(LoaderType::Velocity.display_name(), "Velocity");
        assert_eq!(LoaderType::BungeeCord.display_name(), "BungeeCord");
    }

    #[test]
    fn test_loader_type_serde_roundtrip() {
        let loader = LoaderType::Fabric;
        let json = serde_json::to_string(&loader).unwrap();
        assert_eq!(json, "\"fabric\"");

        let deserialized: LoaderType = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized, LoaderType::Fabric);
    }

    #[test]
    fn test_loader_version_serde() {
        let version = LoaderVersion {
            version: "0.15.0".to_string(),
            stable: true,
            minecraft_version: Some("1.20.4".to_string()),
            download_url: None,
        };

        let json = serde_json::to_string(&version).unwrap();
        assert!(json.contains("\"version\":\"0.15.0\""));
        assert!(json.contains("\"stable\":true"));
        assert!(json.contains("\"minecraft_version\":\"1.20.4\""));
        // download_url should be skipped due to skip_serializing_if
        assert!(!json.contains("download_url"));
    }
}
