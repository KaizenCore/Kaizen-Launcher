pub mod commands;
pub mod db;
pub mod nbt;
pub mod scanner;
pub mod sync;

use serde::{Deserialize, Serialize};

/// Schematic file format
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "lowercase")]
#[sqlx(type_name = "TEXT", rename_all = "lowercase")]
pub enum SchematicFormat {
    Schem,
    Schematic,
    Litematic,
    Nbt,
}

impl SchematicFormat {
    pub fn from_extension(ext: &str) -> Option<Self> {
        match ext.to_lowercase().as_str() {
            "schem" => Some(Self::Schem),
            "schematic" => Some(Self::Schematic),
            "litematic" => Some(Self::Litematic),
            "nbt" => Some(Self::Nbt),
            _ => None,
        }
    }

    #[allow(dead_code)]
    pub fn extension(&self) -> &'static str {
        match self {
            Self::Schem => "schem",
            Self::Schematic => "schematic",
            Self::Litematic => "litematic",
            Self::Nbt => "nbt",
        }
    }

    #[allow(dead_code)]
    pub fn display_name(&self) -> &'static str {
        match self {
            Self::Schem => "WorldEdit (Modern)",
            Self::Schematic => "WorldEdit (Legacy)",
            Self::Litematic => "Litematica",
            Self::Nbt => "Structure Block",
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Schem => "schem",
            Self::Schematic => "schematic",
            Self::Litematic => "litematic",
            Self::Nbt => "nbt",
        }
    }
}

impl std::fmt::Display for SchematicFormat {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Schematic dimensions
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchematicDimensions {
    pub width: i32,
    pub height: i32,
    pub length: i32,
}

impl SchematicDimensions {
    #[allow(dead_code)]
    pub fn volume(&self) -> i64 {
        self.width as i64 * self.height as i64 * self.length as i64
    }
}

/// Core schematic info stored in database
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Schematic {
    pub id: String,
    pub name: String,
    pub filename: String,
    pub format: SchematicFormat,
    pub file_hash: String,
    pub file_size_bytes: u64,
    pub library_path: Option<String>,
    pub dimensions: Option<SchematicDimensions>,
    pub author: Option<String>,
    pub author_locked: bool, // True if author was extracted from file (cannot be modified)
    pub description: Option<String>,
    pub mc_version: Option<String>,
    pub is_favorite: bool,
    pub tags: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Sync status for schematic-instance links
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SyncStatus {
    Synced,
    PendingToLibrary,
    PendingToInstance,
    Conflict,
}

impl SyncStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Synced => "synced",
            Self::PendingToLibrary => "pending_to_library",
            Self::PendingToInstance => "pending_to_instance",
            Self::Conflict => "conflict",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "synced" => Self::Synced,
            "pending_to_library" => Self::PendingToLibrary,
            "pending_to_instance" => Self::PendingToInstance,
            "conflict" => Self::Conflict,
            _ => Self::Synced,
        }
    }
}

/// Source of a schematic
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SchematicSource {
    Library,
    Instance,
    Both,
}

impl SchematicSource {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Library => "library",
            Self::Instance => "instance",
            Self::Both => "both",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "library" => Self::Library,
            "instance" => Self::Instance,
            "both" => Self::Both,
            _ => Self::Library,
        }
    }
}

/// Instance link for schematics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchematicInstanceLink {
    pub id: String,
    pub schematic_id: String,
    pub instance_id: String,
    pub instance_path: String,
    pub source: SchematicSource,
    pub sync_status: SyncStatus,
    pub last_synced_at: Option<String>,
    pub created_at: String,
}

/// Conflict information for UI
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchematicConflict {
    pub schematic_id: String,
    pub schematic_name: String,
    pub instance_id: String,
    pub instance_name: String,
    pub library_hash: String,
    pub instance_hash: String,
    pub library_modified: String,
    pub instance_modified: String,
    pub library_size: u64,
    pub instance_size: u64,
}

/// Resolution choice for conflicts
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConflictResolution {
    KeepLibrary,
    KeepInstance,
    KeepBoth,
}

/// Stats for the schematics page
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchematicStats {
    pub total_schematics: u32,
    pub total_size_bytes: u64,
    pub favorites_count: u32,
    pub formats: std::collections::HashMap<String, u32>,
    pub instances_with_schematics: u32,
}

/// Detected schematic from instance scan
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectedSchematic {
    pub path: String,
    pub filename: String,
    pub format: SchematicFormat,
    pub file_hash: String,
    pub file_size_bytes: u64,
    pub modified_at: String,
    pub in_library: bool,
}

/// Schematic with instance info for UI display
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchematicWithInstances {
    pub schematic: Schematic,
    pub instances: Vec<SchematicInstanceInfo>,
}

/// Brief instance info for schematic display
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchematicInstanceInfo {
    pub instance_id: String,
    pub instance_name: String,
    pub instance_path: String,
    pub sync_status: SyncStatus,
}

/// Cloud sync status for schematics
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchematicCloudSync {
    pub id: String,
    pub schematic_id: String,
    pub remote_path: Option<String>,
    pub sync_status: String,
    pub last_synced_at: Option<String>,
    pub error_message: Option<String>,
    pub created_at: String,
}
