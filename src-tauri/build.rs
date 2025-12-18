use std::fs;
use std::path::PathBuf;

fn main() {
    // Load .env file for local development (OAuth credentials)
    // Use CARGO_MANIFEST_DIR to find .env relative to Cargo.toml
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".to_string());
    let env_path = PathBuf::from(&manifest_dir).join(".env");

    println!("cargo:rerun-if-changed={}", env_path.display());

    if env_path.exists() {
        if let Ok(contents) = fs::read_to_string(&env_path) {
            for line in contents.lines() {
                let line = line.trim();
                // Skip comments and empty lines
                if line.is_empty() || line.starts_with('#') {
                    continue;
                }
                // Parse KEY=VALUE
                if let Some((key, value)) = line.split_once('=') {
                    let key = key.trim();
                    let value = value.trim();
                    // Only set OAuth-related env vars
                    if key.starts_with("GOOGLE_") || key.starts_with("DROPBOX_") || key.starts_with("KAIZEN_") {
                        println!("cargo:rustc-env={}={}", key, value);
                    }
                }
            }
        }
    }

    tauri_build::build()
}
