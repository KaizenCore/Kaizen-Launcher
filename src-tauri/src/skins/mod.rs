pub mod commands;
pub mod mojang;
pub mod optifine;
pub mod mineskin;
pub mod namemc;
pub mod cache;
pub mod sources;

use serde::{Deserialize, Serialize};

pub use sources::SkinSourceType;

/// Skin variant (Steve vs Alex arm width)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SkinVariant {
    Classic, // Steve (4px arms)
    Slim,    // Alex (3px arms)
}

impl Default for SkinVariant {
    fn default() -> Self {
        Self::Classic
    }
}

impl std::fmt::Display for SkinVariant {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SkinVariant::Classic => write!(f, "classic"),
            SkinVariant::Slim => write!(f, "slim"),
        }
    }
}

/// Source of a skin
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SkinSource {
    Mojang,
    NameMC,
    MineSkin,
    Local,
}

/// Skin data structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skin {
    pub id: String,
    pub name: String,
    pub url: String,
    pub variant: SkinVariant,
    pub source: SkinSource,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail_url: Option<String>,
}

/// Community skin with additional metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommunitySkin {
    pub id: String,
    pub name: String,
    pub url: String,
    pub thumbnail_url: String,
    pub variant: SkinVariant,
    pub source: SkinSource,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub downloads: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub likes: Option<u64>,
}

/// Cape source
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum CapeSource {
    Mojang,
    OptiFine,
    LabyMod,
    MinecraftCapes,
    FiveZig,
}

/// Cape data structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cape {
    pub id: String,
    pub name: String,
    pub url: String,
    pub source: CapeSource,
}

/// Search result for community skins
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchSkinsResponse {
    pub skins: Vec<CommunitySkin>,
    pub total: u64,
    pub page: u32,
    pub has_more: bool,
}

/// Player profile with skins and capes
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerSkinProfile {
    pub uuid: String,
    pub username: String,
    pub current_skin: Option<Skin>,
    pub available_capes: Vec<Cape>,
    pub current_cape: Option<Cape>,
}
