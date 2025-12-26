//! Platform-specific launcher detection
//! Finds installed Minecraft launchers on the system

use std::path::PathBuf;

/// Get the default path for the Official Minecraft Launcher
pub fn get_minecraft_launcher_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var("APPDATA")
            .ok()
            .map(|p| PathBuf::from(p).join(".minecraft"))
    }

    #[cfg(target_os = "macos")]
    {
        dirs::home_dir().map(|h| h.join("Library/Application Support/minecraft"))
    }

    #[cfg(target_os = "linux")]
    {
        dirs::home_dir().map(|h| h.join(".minecraft"))
    }
}

/// Get possible paths for Prism Launcher
pub fn get_prism_launcher_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();

    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            paths.push(PathBuf::from(&appdata).join("PrismLauncher"));
        }
        if let Ok(localappdata) = std::env::var("LOCALAPPDATA") {
            paths.push(PathBuf::from(&localappdata).join("PrismLauncher"));
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Some(home) = dirs::home_dir() {
            paths.push(home.join("Library/Application Support/PrismLauncher"));
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(home) = dirs::home_dir() {
            paths.push(home.join(".local/share/PrismLauncher"));
            // Flatpak installation
            paths.push(
                home.join(".var/app/org.prismlauncher.PrismLauncher/data/PrismLauncher"),
            );
        }
        // XDG data home
        if let Ok(xdg_data) = std::env::var("XDG_DATA_HOME") {
            paths.push(PathBuf::from(xdg_data).join("PrismLauncher"));
        }
    }

    paths
}

/// Get possible paths for MultiMC
pub fn get_multimc_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();

    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            paths.push(PathBuf::from(&appdata).join("MultiMC"));
        }
        if let Ok(localappdata) = std::env::var("LOCALAPPDATA") {
            paths.push(PathBuf::from(&localappdata).join("MultiMC"));
        }
        // Portable installation (check common locations)
        if let Ok(userprofile) = std::env::var("USERPROFILE") {
            paths.push(PathBuf::from(&userprofile).join("MultiMC"));
            paths.push(PathBuf::from(&userprofile).join("Downloads/MultiMC"));
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Some(home) = dirs::home_dir() {
            paths.push(home.join("Library/Application Support/MultiMC"));
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(home) = dirs::home_dir() {
            paths.push(home.join(".local/share/MultiMC"));
            paths.push(home.join("MultiMC"));
        }
        if let Ok(xdg_data) = std::env::var("XDG_DATA_HOME") {
            paths.push(PathBuf::from(xdg_data).join("MultiMC"));
        }
    }

    paths
}

/// Get possible paths for CurseForge App
pub fn get_curseforge_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();

    #[cfg(target_os = "windows")]
    {
        if let Ok(userprofile) = std::env::var("USERPROFILE") {
            paths.push(
                PathBuf::from(&userprofile)
                    .join("curseforge")
                    .join("minecraft")
                    .join("Instances"),
            );
        }
        // Alternative location
        if let Ok(appdata) = std::env::var("APPDATA") {
            paths.push(
                PathBuf::from(&appdata)
                    .join("CurseForge")
                    .join("Minecraft")
                    .join("Instances"),
            );
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Some(home) = dirs::home_dir() {
            paths.push(
                home.join("Documents")
                    .join("curseforge")
                    .join("minecraft")
                    .join("Instances"),
            );
        }
    }

    #[cfg(target_os = "linux")]
    {
        // CurseForge is primarily Windows, but check anyway
        if let Some(home) = dirs::home_dir() {
            paths.push(
                home.join("curseforge")
                    .join("minecraft")
                    .join("Instances"),
            );
        }
    }

    paths
}

/// Get possible paths for Modrinth App
pub fn get_modrinth_app_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();

    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            paths.push(PathBuf::from(&appdata).join("ModrinthApp").join("profiles"));
            paths.push(
                PathBuf::from(&appdata)
                    .join("com.modrinth.theseus")
                    .join("profiles"),
            );
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Some(home) = dirs::home_dir() {
            paths.push(
                home.join("Library/Application Support/ModrinthApp/profiles"),
            );
            paths.push(
                home.join("Library/Application Support/com.modrinth.theseus/profiles"),
            );
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(home) = dirs::home_dir() {
            paths.push(home.join(".local/share/ModrinthApp/profiles"));
            paths.push(home.join(".local/share/com.modrinth.theseus/profiles"));
        }
        if let Ok(xdg_data) = std::env::var("XDG_DATA_HOME") {
            paths.push(PathBuf::from(&xdg_data).join("ModrinthApp/profiles"));
        }
    }

    paths
}

/// Check if a path exists and is a directory
pub fn path_exists(path: &PathBuf) -> bool {
    path.exists() && path.is_dir()
}

/// Check if a path exists and is a file
pub fn file_exists(path: &PathBuf) -> bool {
    path.exists() && path.is_file()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_minecraft_launcher_path_exists() {
        // This just tests that the function doesn't panic
        let _ = get_minecraft_launcher_path();
    }

    #[test]
    fn test_prism_paths_not_empty() {
        let paths = get_prism_launcher_paths();
        assert!(!paths.is_empty(), "Should return at least one possible path");
    }
}
