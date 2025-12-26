//! Mod resolver using Modrinth hash lookup
//! Resolves local mod files to their Modrinth project/version IDs

use sha2::{Digest, Sha512};
use std::collections::HashMap;
use std::path::PathBuf;
use tracing::{debug, warn};

use crate::error::{AppError, AppResult};
use crate::external_import::ModFile;
use crate::modrinth::{ModrinthClient, Version as ModrinthVersion};

/// Resolved mod information from Modrinth
#[derive(Debug, Clone)]
pub struct ResolvedMod {
    pub project_id: String,
    pub version_id: String,
    pub version_number: String,
    pub project_name: Option<String>,
}

/// Mod resolver that uses Modrinth's hash lookup API
pub struct ModResolver<'a> {
    client: ModrinthClient<'a>,
}

impl<'a> ModResolver<'a> {
    pub fn new(http_client: &'a reqwest::Client) -> Self {
        Self {
            client: ModrinthClient::new(http_client),
        }
    }

    /// Compute SHA-512 hash for a file
    pub async fn hash_file(path: &PathBuf) -> AppResult<String> {
        let content = tokio::fs::read(path)
            .await
            .map_err(|e| AppError::ExternalImport(format!("Failed to read file: {}", e)))?;

        let mut hasher = Sha512::new();
        hasher.update(&content);
        Ok(format!("{:x}", hasher.finalize()))
    }

    /// Compute SHA-512 hashes for multiple mod files
    pub async fn hash_mod_files(mod_files: &mut [ModFile]) -> AppResult<()> {
        for mod_file in mod_files.iter_mut() {
            // Skip if already has hash or path doesn't exist
            if mod_file.sha512.is_some() || !mod_file.path.exists() {
                continue;
            }

            match Self::hash_file(&mod_file.path).await {
                Ok(hash) => {
                    mod_file.sha512 = Some(hash);
                }
                Err(e) => {
                    warn!("Failed to hash {}: {}", mod_file.filename, e);
                }
            }
        }

        Ok(())
    }

    /// Resolve a single mod by its SHA-512 hash
    pub async fn resolve_mod(&self, sha512: &str) -> Option<ResolvedMod> {
        match self.client.get_version_by_hash(sha512).await {
            Ok(version) => Some(ResolvedMod {
                project_id: version.project_id.clone(),
                version_id: version.id.clone(),
                version_number: version.version_number.clone(),
                project_name: Some(version.name.clone()),
            }),
            Err(e) => {
                debug!("Mod not found on Modrinth (hash: {}...): {}", &sha512[..16], e);
                None
            }
        }
    }

    /// Resolve multiple mods by their SHA-512 hashes (batch API)
    /// Returns a map of hash -> ResolvedMod for found files
    pub async fn resolve_mods_batch(
        &self,
        mod_files: &[ModFile],
    ) -> HashMap<String, ResolvedMod> {
        let hashes: Vec<String> = mod_files
            .iter()
            .filter_map(|m| m.sha512.clone())
            .collect();

        if hashes.is_empty() {
            return HashMap::new();
        }

        debug!("Resolving {} mods via Modrinth batch API", hashes.len());

        match self.client.get_versions_by_hashes(&hashes, "sha512").await {
            Ok(versions) => {
                versions
                    .into_iter()
                    .map(|(hash, version)| {
                        (
                            hash,
                            ResolvedMod {
                                project_id: version.project_id.clone(),
                                version_id: version.id.clone(),
                                version_number: version.version_number.clone(),
                                project_name: Some(version.name.clone()),
                            },
                        )
                    })
                    .collect()
            }
            Err(e) => {
                warn!("Failed to resolve mods via Modrinth: {}", e);
                HashMap::new()
            }
        }
    }

    /// Enrich mod files with Modrinth resolution info
    /// Updates mod_files in place with project IDs and names
    pub async fn enrich_mod_files(&self, mod_files: &mut [ModFile]) -> usize {
        // First, compute hashes for all files
        if let Err(e) = Self::hash_mod_files(mod_files).await {
            warn!("Failed to hash mod files: {}", e);
            return 0;
        }

        // Then resolve via batch API
        let resolved = self.resolve_mods_batch(mod_files).await;
        let mut enriched_count = 0;

        // Update mod files with resolved info
        for mod_file in mod_files.iter_mut() {
            if let Some(hash) = &mod_file.sha512 {
                if let Some(resolved_mod) = resolved.get(hash) {
                    mod_file.modrinth_project_id = Some(resolved_mod.project_id.clone());
                    mod_file.modrinth_version_id = Some(resolved_mod.version_id.clone());
                    mod_file.modrinth_project_name = resolved_mod.project_name.clone();
                    enriched_count += 1;
                }
            }
        }

        debug!(
            "Enriched {}/{} mods with Modrinth info",
            enriched_count,
            mod_files.len()
        );
        enriched_count
    }

    /// Download a mod from Modrinth by version ID
    pub async fn download_mod(
        &self,
        version_id: &str,
        dest_dir: &PathBuf,
    ) -> AppResult<PathBuf> {
        let version = self
            .client
            .get_version(version_id)
            .await
            .map_err(|e| AppError::ExternalImport(format!("Failed to get version: {}", e)))?;

        let file = version
            .files
            .iter()
            .find(|f| f.primary)
            .or_else(|| version.files.first())
            .ok_or_else(|| AppError::ExternalImport("No files in version".to_string()))?;

        let dest_path = dest_dir.join(&file.filename);

        self.client
            .download_file(file, &dest_path)
            .await
            .map_err(|e| AppError::ExternalImport(format!("Failed to download mod: {}", e)))?;

        Ok(dest_path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_hash_file_not_found() {
        let result = ModResolver::hash_file(&PathBuf::from("/nonexistent/file.jar")).await;
        assert!(result.is_err());
    }
}
