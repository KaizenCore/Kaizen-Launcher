//! Manifest types for instance sharing

use serde::{Deserialize, Serialize};

/// Manifest version for compatibility checking
pub const MANIFEST_VERSION: &str = "1.0";

/// Main sharing manifest included in export packages
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharingManifest {
    /// Manifest format version
    pub version: String,
    /// Kaizen Launcher version that created this export
    pub kaizen_version: String,
    /// Creation timestamp (ISO 8601)
    pub created_at: String,
    /// Instance metadata
    pub instance: InstanceInfo,
    /// What's included in the package
    pub contents: Contents,
    /// Total package size in bytes
    pub total_size_bytes: u64,
}

/// Instance metadata in the manifest
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceInfo {
    pub name: String,
    pub mc_version: String,
    pub loader: Option<String>,
    pub loader_version: Option<String>,
    pub is_server: bool,
    pub is_proxy: bool,
    pub memory_min_mb: Option<i32>,
    pub memory_max_mb: Option<i32>,
    pub jvm_args: Option<String>,
}

/// Contents breakdown in the manifest
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Contents {
    pub mods: ContentSection,
    pub config: ContentSection,
    pub resourcepacks: ContentSection,
    pub shaderpacks: ContentSection,
    pub saves: SavesSection,
}

/// A section of content (mods, configs, etc.)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentSection {
    pub included: bool,
    pub count: u32,
    pub total_size_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files: Option<Vec<FileInfo>>,
}

impl Default for ContentSection {
    fn default() -> Self {
        Self {
            included: false,
            count: 0,
            total_size_bytes: 0,
            files: None,
        }
    }
}

/// Information about a file in the package
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileInfo {
    pub path: String,
    pub size_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
}

/// Mod file with additional metadata
#[allow(dead_code)] // Defined for future enhanced mod metadata in manifests
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModFileInfo {
    pub path: String,
    pub size_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<ModMetadata>,
}

/// Mod metadata from .meta.json files
#[allow(dead_code)] // Defined for future enhanced mod metadata in manifests
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModMetadata {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

/// Saves section with individual worlds
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavesSection {
    pub included: bool,
    pub worlds: Vec<WorldInfo>,
}

impl Default for SavesSection {
    fn default() -> Self {
        Self {
            included: false,
            worlds: vec![],
        }
    }
}

/// World information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldInfo {
    pub name: String,
    pub folder_name: String,
    pub size_bytes: u64,
    /// For servers, includes world_nether, world_the_end folders
    #[serde(skip_serializing_if = "Option::is_none")]
    pub additional_folders: Option<Vec<String>>,
}

/// Options for what to export
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportOptions {
    pub include_mods: bool,
    pub include_config: bool,
    pub include_resourcepacks: bool,
    pub include_shaderpacks: bool,
    /// List of world folder names to include (empty = none)
    pub include_worlds: Vec<String>,
}

impl Default for ExportOptions {
    fn default() -> Self {
        Self {
            include_mods: true,
            include_config: true,
            include_resourcepacks: false,
            include_shaderpacks: false,
            include_worlds: vec![],
        }
    }
}

/// What can be exported from an instance (for UI selection)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportableContent {
    pub instance_id: String,
    pub instance_name: String,
    pub mods: ExportableSection,
    pub config: ExportableSection,
    pub resourcepacks: ExportableSection,
    pub shaderpacks: ExportableSection,
    pub worlds: Vec<ExportableWorld>,
}

/// A section that can be exported
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportableSection {
    pub available: bool,
    pub count: u32,
    pub total_size_bytes: u64,
}

/// A world that can be exported
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportableWorld {
    pub name: String,
    pub folder_name: String,
    pub size_bytes: u64,
    pub is_server_world: bool,
}

/// Result of preparing an export
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreparedExport {
    pub export_id: String,
    pub package_path: String,
    pub manifest: SharingManifest,
}

/// Progress event for export/import operations
#[derive(Debug, Clone, Serialize)]
pub struct SharingProgressEvent {
    pub operation_id: String,
    pub stage: String,
    pub progress: u32,
    pub message: String,
}
