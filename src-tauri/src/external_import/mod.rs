//! External Launcher Import module
//! Handles importing instances from other Minecraft launchers
//! Supported launchers:
//! - Official Minecraft Launcher
//! - Modrinth App (.mrpack files)
//! - Prism Launcher / MultiMC
//! - CurseForge

pub mod commands;
pub mod detection;
pub mod importer;
pub mod mod_resolver;
pub mod parsers;

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::error::AppResult;

/// Identifies the source launcher type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LauncherType {
    MinecraftOfficial,
    ModrinthApp,
    PrismLauncher,
    MultiMC,
    CurseForge,
}

impl LauncherType {
    pub fn display_name(&self) -> &'static str {
        match self {
            Self::MinecraftOfficial => "Minecraft Launcher",
            Self::ModrinthApp => "Modrinth App",
            Self::PrismLauncher => "Prism Launcher",
            Self::MultiMC => "MultiMC",
            Self::CurseForge => "CurseForge",
        }
    }
}

/// A detected launcher installation on the system
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectedLauncher {
    pub launcher_type: LauncherType,
    pub name: String,
    pub path: PathBuf,
    pub instance_count: usize,
    pub is_detected: bool,
}

/// An importable instance detected from an external launcher
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectedInstance {
    pub id: String,
    pub launcher: LauncherType,
    pub name: String,
    pub path: PathBuf,
    pub mc_version: String,
    pub loader: Option<String>,
    pub loader_version: Option<String>,
    pub is_server: bool,
    pub icon_path: Option<PathBuf>,
    pub last_played: Option<String>,
    /// Mod count if available
    pub mod_count: Option<usize>,
    /// Total estimated size in bytes
    pub estimated_size: Option<u64>,
    /// Raw metadata for debugging
    #[serde(default)]
    pub raw_metadata: serde_json::Value,
}

/// A mod file with optional hash information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModFile {
    pub filename: String,
    pub path: PathBuf,
    pub sha1: Option<String>,
    pub sha512: Option<String>,
    pub size: u64,
    /// Resolved from Modrinth if available
    pub modrinth_project_id: Option<String>,
    pub modrinth_version_id: Option<String>,
    pub modrinth_project_name: Option<String>,
}

/// Options for importing an instance
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportOptions {
    /// New name for the instance (optional, uses detected name if not set)
    pub new_name: Option<String>,
    /// Whether to copy mods
    pub copy_mods: bool,
    /// Whether to copy config files
    pub copy_config: bool,
    /// Whether to copy resource packs
    pub copy_resourcepacks: bool,
    /// Whether to copy shader packs
    pub copy_shaderpacks: bool,
    /// List of world folder names to copy (empty = no worlds)
    pub copy_worlds: Vec<String>,
    /// Whether to re-download mods from Modrinth when possible
    pub redownload_from_modrinth: bool,
}

impl Default for ImportOptions {
    fn default() -> Self {
        Self {
            new_name: None,
            copy_mods: true,
            copy_config: true,
            copy_resourcepacks: true,
            copy_shaderpacks: true,
            copy_worlds: Vec::new(),
            redownload_from_modrinth: true,
        }
    }
}

/// Progress event emitted during import
#[derive(Debug, Clone, Serialize)]
pub struct ImportProgress {
    pub operation_id: String,
    pub stage: ImportStage,
    pub progress: u32,
    pub total: u32,
    pub message: String,
    pub current_file: Option<String>,
}

/// Import stages for progress reporting
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportStage {
    Scanning,
    Resolving,
    Downloading,
    Copying,
    Creating,
    Complete,
    Error,
}

/// Result of parsing a launcher's instances
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedLauncher {
    pub launcher: DetectedLauncher,
    pub instances: Vec<DetectedInstance>,
}

/// Trait for launcher-specific parsers
#[async_trait::async_trait]
pub trait LauncherParser: Send + Sync {
    /// Get the launcher type this parser handles
    fn launcher_type(&self) -> LauncherType;

    /// Get the display name of this launcher
    fn display_name(&self) -> &'static str {
        self.launcher_type().display_name()
    }

    /// Get default installation paths for this launcher (platform-specific)
    fn default_paths(&self) -> Vec<PathBuf>;

    /// Check if a path contains this launcher's data
    async fn detect(&self, path: &PathBuf) -> bool;

    /// Parse all instances from a launcher installation path
    async fn parse_instances(&self, path: &PathBuf) -> AppResult<Vec<DetectedInstance>>;

    /// Parse a single instance or file (for manual import)
    async fn parse_single(&self, path: &PathBuf) -> AppResult<DetectedInstance>;

    /// Scan mods directory and return mod files with basic info
    async fn scan_mods(&self, instance_path: &PathBuf) -> AppResult<Vec<ModFile>>;

    /// Get the game directory within an instance (e.g., .minecraft for Prism)
    fn get_game_dir(&self, instance_path: &PathBuf) -> PathBuf {
        instance_path.clone()
    }
}

/// Content types that can be exported/imported
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportableContent {
    pub mods: ContentInfo,
    pub config: ContentInfo,
    pub resourcepacks: ContentInfo,
    pub shaderpacks: ContentInfo,
    pub worlds: Vec<WorldInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentInfo {
    pub available: bool,
    pub count: usize,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldInfo {
    pub name: String,
    pub folder_name: String,
    pub size_bytes: u64,
}
