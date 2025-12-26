//! Launcher-specific parsers
//! Each parser implements the LauncherParser trait

pub mod curseforge;
pub mod minecraft;
pub mod modrinth;
pub mod prism;

pub use curseforge::CurseForgeParser;
pub use minecraft::MinecraftLauncherParser;
pub use modrinth::ModrinthParser;
pub use prism::PrismParser;

use super::LauncherParser;
use std::sync::Arc;

/// Get all available parsers
pub fn get_all_parsers() -> Vec<Arc<dyn LauncherParser>> {
    vec![
        Arc::new(MinecraftLauncherParser),
        Arc::new(PrismParser::new_prism()),
        Arc::new(PrismParser::new_multimc()),
        Arc::new(ModrinthParser),
        Arc::new(CurseForgeParser),
    ]
}
