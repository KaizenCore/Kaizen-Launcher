// Modrinth API client for searching and downloading mods
// API Documentation: https://docs.modrinth.com/api-spec

pub mod commands;

use reqwest::Url;
use serde::{Deserialize, Serialize};

const MODRINTH_API_BASE: &str = "https://api.modrinth.com/v2";

/// Allowed download domains for security (prevent malicious redirects)
const ALLOWED_DOWNLOAD_DOMAINS: &[&str] = &[
    "cdn.modrinth.com",
    "cdn-raw.modrinth.com",
    "github.com",
    "raw.githubusercontent.com",
    "objects.githubusercontent.com",
    "mediafilez.forgecdn.net",
    "edge.forgecdn.net",
    "maven.fabricmc.net",
    "maven.minecraftforge.net",
    "maven.neoforged.net",
    "maven.quiltmc.org",
    "papermc.io",
    "api.papermc.io",
];

/// Search response from Modrinth
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResponse {
    pub hits: Vec<SearchHit>,
    pub offset: u32,
    pub limit: u32,
    pub total_hits: u32,
}

/// A single search result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchHit {
    pub project_id: String,
    pub slug: String,
    pub title: String,
    pub description: String,
    pub categories: Vec<String>,
    pub client_side: String,
    pub server_side: String,
    pub project_type: String,
    pub downloads: u64,
    pub icon_url: Option<String>,
    pub author: String,
    pub versions: Vec<String>,
    pub follows: u32,
    pub date_created: String,
    pub date_modified: String,
    #[serde(default)]
    pub latest_version: Option<String>,
    #[serde(default)]
    pub license: Option<String>,
    #[serde(default)]
    pub gallery: Vec<String>,
}

/// Project details from Modrinth
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub slug: String,
    pub project_type: String,
    pub title: String,
    pub description: String,
    pub body: String,
    pub categories: Vec<String>,
    pub client_side: String,
    pub server_side: String,
    pub downloads: u64,
    pub followers: u32,
    pub icon_url: Option<String>,
    pub issues_url: Option<String>,
    pub source_url: Option<String>,
    pub wiki_url: Option<String>,
    pub discord_url: Option<String>,
    pub donation_urls: Vec<DonationUrl>,
    pub gallery: Vec<GalleryImage>,
    pub versions: Vec<String>,
    pub game_versions: Vec<String>,
    pub loaders: Vec<String>,
    pub team: String,
    pub published: String,
    pub updated: String,
    pub license: Option<License>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DonationUrl {
    pub id: String,
    pub platform: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GalleryImage {
    pub url: String,
    pub featured: bool,
    pub title: Option<String>,
    pub description: Option<String>,
    pub created: String,
    pub ordering: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct License {
    pub id: String,
    pub name: String,
    pub url: Option<String>,
}

/// Version information for a project
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Version {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub version_number: String,
    pub changelog: Option<String>,
    pub game_versions: Vec<String>,
    pub version_type: String, // release, beta, alpha
    pub loaders: Vec<String>,
    pub featured: bool,
    pub files: Vec<VersionFile>,
    pub dependencies: Vec<Dependency>,
    pub downloads: u64,
    pub date_published: String,
}

/// File information within a version
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionFile {
    pub hashes: FileHashes,
    pub url: String,
    pub filename: String,
    pub primary: bool,
    pub size: u64,
    #[serde(default)]
    pub file_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileHashes {
    pub sha1: String,
    pub sha512: String,
}

/// Dependency information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Dependency {
    pub version_id: Option<String>,
    pub project_id: Option<String>,
    pub file_name: Option<String>,
    pub dependency_type: String, // required, optional, incompatible, embedded
}

/// Search query parameters
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchQuery {
    pub query: String,
    pub facets: Option<String>,
    pub index: Option<String>, // relevance, downloads, follows, newest, updated
    pub offset: Option<u32>,
    pub limit: Option<u32>,
}

impl SearchQuery {
    pub fn new(query: &str) -> Self {
        Self {
            query: query.to_string(),
            facets: None,
            index: None,
            offset: None,
            limit: None,
        }
    }

    pub fn with_facets(mut self, facets: &str) -> Self {
        self.facets = Some(facets.to_string());
        self
    }

    pub fn with_index(mut self, index: &str) -> Self {
        self.index = Some(index.to_string());
        self
    }

    pub fn with_offset(mut self, offset: u32) -> Self {
        self.offset = Some(offset);
        self
    }

    pub fn with_limit(mut self, limit: u32) -> Self {
        self.limit = Some(limit);
        self
    }
}

/// Client for interacting with the Modrinth API
pub struct ModrinthClient<'a> {
    http_client: &'a reqwest::Client,
}

impl<'a> ModrinthClient<'a> {
    pub fn new(http_client: &'a reqwest::Client) -> Self {
        Self { http_client }
    }

    /// Search for projects on Modrinth
    pub async fn search(&self, query: &SearchQuery) -> Result<SearchResponse, ModrinthError> {
        let mut url = format!(
            "{}/search?query={}",
            MODRINTH_API_BASE,
            urlencoding::encode(&query.query)
        );

        if let Some(facets) = &query.facets {
            url.push_str(&format!("&facets={}", urlencoding::encode(facets)));
        }
        if let Some(index) = &query.index {
            url.push_str(&format!("&index={}", index));
        }
        if let Some(offset) = query.offset {
            url.push_str(&format!("&offset={}", offset));
        }
        if let Some(limit) = query.limit {
            url.push_str(&format!("&limit={}", limit));
        }

        let response = self
            .http_client
            .get(&url)
            .send()
            .await
            .map_err(|e| ModrinthError::Network(e.to_string()))?;

        if !response.status().is_success() {
            return Err(ModrinthError::Api(format!(
                "API returned status {}",
                response.status()
            )));
        }

        response
            .json::<SearchResponse>()
            .await
            .map_err(|e| ModrinthError::Parse(e.to_string()))
    }

    /// Get project details by ID or slug
    pub async fn get_project(&self, id_or_slug: &str) -> Result<Project, ModrinthError> {
        let url = format!("{}/project/{}", MODRINTH_API_BASE, id_or_slug);

        let response = self
            .http_client
            .get(&url)
            .send()
            .await
            .map_err(|e| ModrinthError::Network(e.to_string()))?;

        if !response.status().is_success() {
            return Err(ModrinthError::Api(format!(
                "API returned status {}",
                response.status()
            )));
        }

        response
            .json::<Project>()
            .await
            .map_err(|e| ModrinthError::Parse(e.to_string()))
    }

    /// Get multiple projects by IDs (batch request)
    /// This is more efficient than calling get_project multiple times
    /// Includes retry logic with exponential backoff for rate limiting (429)
    #[allow(dead_code)]
    pub async fn get_projects(&self, ids: &[&str]) -> Result<Vec<Project>, ModrinthError> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }

        let ids_json = serde_json::to_string(&ids)
            .map_err(|e| ModrinthError::Parse(format!("Failed to serialize IDs: {}", e)))?;
        let url = format!(
            "{}/projects?ids={}",
            MODRINTH_API_BASE,
            urlencoding::encode(&ids_json)
        );

        // Retry with exponential backoff for rate limiting
        let max_retries = 3;
        let mut retry_delay = std::time::Duration::from_millis(500);

        for attempt in 0..=max_retries {
            let response = self
                .http_client
                .get(&url)
                .send()
                .await
                .map_err(|e| ModrinthError::Network(e.to_string()))?;

            let status = response.status();

            if status.is_success() {
                return response
                    .json::<Vec<Project>>()
                    .await
                    .map_err(|e| ModrinthError::Parse(e.to_string()));
            }

            // Handle rate limiting with retry
            if status.as_u16() == 429 && attempt < max_retries {
                log::warn!(
                    "Modrinth API rate limited (429), retrying in {:?} (attempt {}/{})",
                    retry_delay,
                    attempt + 1,
                    max_retries
                );
                tokio::time::sleep(retry_delay).await;
                retry_delay *= 2; // Exponential backoff
                continue;
            }

            return Err(ModrinthError::Api(format!(
                "API returned status {}",
                status
            )));
        }

        Err(ModrinthError::Api(
            "Max retries exceeded for rate limiting".to_string(),
        ))
    }

    /// Get all versions of a project
    pub async fn get_project_versions(
        &self,
        project_id: &str,
        loaders: Option<&[&str]>,
        game_versions: Option<&[&str]>,
    ) -> Result<Vec<Version>, ModrinthError> {
        let mut url = format!("{}/project/{}/version", MODRINTH_API_BASE, project_id);

        let mut params = Vec::new();
        if let Some(loaders) = loaders {
            let loaders_json = serde_json::to_string(loaders)
                .map_err(|e| ModrinthError::Parse(format!("Failed to serialize loaders: {}", e)))?;
            params.push(format!("loaders={}", urlencoding::encode(&loaders_json)));
        }
        if let Some(versions) = game_versions {
            let versions_json = serde_json::to_string(versions).map_err(|e| {
                ModrinthError::Parse(format!("Failed to serialize versions: {}", e))
            })?;
            params.push(format!(
                "game_versions={}",
                urlencoding::encode(&versions_json)
            ));
        }

        if !params.is_empty() {
            url.push('?');
            url.push_str(&params.join("&"));
        }

        let response = self
            .http_client
            .get(&url)
            .send()
            .await
            .map_err(|e| ModrinthError::Network(e.to_string()))?;

        if !response.status().is_success() {
            return Err(ModrinthError::Api(format!(
                "API returned status {}",
                response.status()
            )));
        }

        response
            .json::<Vec<Version>>()
            .await
            .map_err(|e| ModrinthError::Parse(e.to_string()))
    }

    /// Get a specific version by ID
    pub async fn get_version(&self, version_id: &str) -> Result<Version, ModrinthError> {
        let url = format!("{}/version/{}", MODRINTH_API_BASE, version_id);

        let response = self
            .http_client
            .get(&url)
            .send()
            .await
            .map_err(|e| ModrinthError::Network(e.to_string()))?;

        if !response.status().is_success() {
            return Err(ModrinthError::Api(format!(
                "API returned status {}",
                response.status()
            )));
        }

        response
            .json::<Version>()
            .await
            .map_err(|e| ModrinthError::Parse(e.to_string()))
    }

    /// Look up a version by file hash (SHA-512)
    /// Returns the version info if found on Modrinth
    pub async fn get_version_by_hash(&self, sha512: &str) -> Result<Version, ModrinthError> {
        let url = format!(
            "{}/version_file/{}?algorithm=sha512",
            MODRINTH_API_BASE, sha512
        );

        let response = self
            .http_client
            .get(&url)
            .send()
            .await
            .map_err(|e| ModrinthError::Network(e.to_string()))?;

        if !response.status().is_success() {
            return Err(ModrinthError::Api(format!(
                "API returned status {}",
                response.status()
            )));
        }

        response
            .json::<Version>()
            .await
            .map_err(|e| ModrinthError::Parse(e.to_string()))
    }

    /// Download a mod file to the specified path
    pub async fn download_file(
        &self,
        file: &VersionFile,
        dest_path: &std::path::Path,
    ) -> Result<(), ModrinthError> {
        // Security: Validate download URL domain
        let url = Url::parse(&file.url)
            .map_err(|e| ModrinthError::Network(format!("Invalid URL: {}", e)))?;

        let host = url.host_str().ok_or_else(|| {
            ModrinthError::Network("Download URL has no host".to_string())
        })?;

        let is_allowed = ALLOWED_DOWNLOAD_DOMAINS
            .iter()
            .any(|domain| host == *domain || host.ends_with(&format!(".{}", domain)));

        if !is_allowed {
            return Err(ModrinthError::Network(format!(
                "Download blocked: untrusted domain '{}'",
                host
            )));
        }

        let response = self
            .http_client
            .get(&file.url)
            .send()
            .await
            .map_err(|e| ModrinthError::Network(e.to_string()))?;

        if !response.status().is_success() {
            return Err(ModrinthError::Api(format!(
                "Download returned status {}",
                response.status()
            )));
        }

        let bytes = response
            .bytes()
            .await
            .map_err(|e| ModrinthError::Network(e.to_string()))?;

        // Verify SHA1 hash
        use sha1::{Digest, Sha1};
        let mut hasher = Sha1::new();
        hasher.update(&bytes);
        let hash = format!("{:x}", hasher.finalize());

        if hash != file.hashes.sha1 {
            return Err(ModrinthError::HashMismatch {
                expected: file.hashes.sha1.clone(),
                actual: hash,
            });
        }

        // Write to file
        tokio::fs::write(dest_path, &bytes)
            .await
            .map_err(|e| ModrinthError::Io(e.to_string()))?;

        Ok(())
    }
}

/// Errors that can occur when using the Modrinth API
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ModrinthError {
    Network(String),
    Api(String),
    Parse(String),
    Io(String),
    HashMismatch { expected: String, actual: String },
}

impl std::fmt::Display for ModrinthError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Network(msg) => write!(f, "Network error: {}", msg),
            Self::Api(msg) => write!(f, "API error: {}", msg),
            Self::Parse(msg) => write!(f, "Parse error: {}", msg),
            Self::Io(msg) => write!(f, "IO error: {}", msg),
            Self::HashMismatch { expected, actual } => {
                write!(f, "Hash mismatch: expected {}, got {}", expected, actual)
            }
        }
    }
}

impl std::error::Error for ModrinthError {}

/// Normalize loader name to Modrinth's expected format
fn normalize_loader_for_modrinth(loader: &str) -> String {
    // Modrinth uses lowercase loader names
    loader.to_lowercase()
}

/// Helper to build facets for searching
pub fn build_facets(
    project_type: Option<&str>,
    categories: Option<&[&str]>,
    game_versions: Option<&[&str]>,
    loaders: Option<&[&str]>,
) -> String {
    let mut facets = Vec::new();

    if let Some(pt) = project_type {
        facets.push(format!("[\"project_type:{}\"]", pt));
    }

    if let Some(cats) = categories {
        for cat in cats {
            facets.push(format!("[\"categories:{}\"]", cat));
        }
    }

    if let Some(versions) = game_versions {
        let version_facets: Vec<String> = versions
            .iter()
            .map(|v| format!("\"versions:{}\"", v))
            .collect();
        facets.push(format!("[{}]", version_facets.join(",")));
    }

    if let Some(loaders) = loaders {
        let loader_facets: Vec<String> = loaders
            .iter()
            .map(|l| {
                let normalized = normalize_loader_for_modrinth(l);
                format!("\"categories:{}\"", normalized)
            })
            .collect();
        facets.push(format!("[{}]", loader_facets.join(",")));
    }

    format!("[{}]", facets.join(","))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_search_response_deserialize() {
        let json = r#"{
            "hits": [
                {
                    "project_id": "AANobbMI",
                    "slug": "sodium",
                    "title": "Sodium",
                    "description": "A modern rendering engine",
                    "categories": ["optimization", "fabric"],
                    "client_side": "required",
                    "server_side": "unsupported",
                    "project_type": "mod",
                    "downloads": 50000000,
                    "icon_url": "https://cdn.modrinth.com/icon.png",
                    "author": "jellysquid3",
                    "versions": ["1.20.4", "1.20.3"],
                    "follows": 100000,
                    "date_created": "2020-01-01T00:00:00Z",
                    "date_modified": "2024-01-01T00:00:00Z"
                }
            ],
            "offset": 0,
            "limit": 20,
            "total_hits": 1
        }"#;

        let response: SearchResponse = serde_json::from_str(json).unwrap();

        assert_eq!(response.total_hits, 1);
        assert_eq!(response.hits.len(), 1);
        assert_eq!(response.hits[0].slug, "sodium");
        assert_eq!(response.hits[0].project_type, "mod");
        assert_eq!(response.hits[0].downloads, 50000000);
    }

    #[test]
    fn test_version_file_deserialize() {
        let json = r#"{
            "hashes": {
                "sha1": "abc123",
                "sha512": "def456"
            },
            "url": "https://cdn.modrinth.com/file.jar",
            "filename": "sodium-1.0.0.jar",
            "primary": true,
            "size": 1000000
        }"#;

        let file: VersionFile = serde_json::from_str(json).unwrap();

        assert_eq!(file.filename, "sodium-1.0.0.jar");
        assert!(file.primary);
        assert_eq!(file.hashes.sha1, "abc123");
    }

    #[test]
    fn test_dependency_deserialize() {
        let json = r#"{
            "version_id": "v123",
            "project_id": "p456",
            "dependency_type": "required"
        }"#;

        let dep: Dependency = serde_json::from_str(json).unwrap();

        assert_eq!(dep.version_id, Some("v123".to_string()));
        assert_eq!(dep.project_id, Some("p456".to_string()));
        assert_eq!(dep.dependency_type, "required");
    }

    #[test]
    fn test_search_query_builder() {
        let query = SearchQuery::new("sodium")
            .with_facets("[[\"project_type:mod\"]]")
            .with_index("downloads")
            .with_offset(20)
            .with_limit(10);

        assert_eq!(query.query, "sodium");
        assert_eq!(query.facets, Some("[[\"project_type:mod\"]]".to_string()));
        assert_eq!(query.index, Some("downloads".to_string()));
        assert_eq!(query.offset, Some(20));
        assert_eq!(query.limit, Some(10));
    }

    #[test]
    fn test_build_facets_with_project_type() {
        let facets = build_facets(Some("mod"), None, None, None);
        assert_eq!(facets, "[[\"project_type:mod\"]]");
    }

    #[test]
    fn test_build_facets_with_versions() {
        let facets = build_facets(None, None, Some(&["1.20.4", "1.20.3"]), None);
        assert_eq!(facets, "[[\"versions:1.20.4\",\"versions:1.20.3\"]]");
    }

    #[test]
    fn test_build_facets_with_loaders() {
        let facets = build_facets(None, None, None, Some(&["Fabric", "Quilt"]));
        assert_eq!(facets, "[[\"categories:fabric\",\"categories:quilt\"]]");
    }

    #[test]
    fn test_build_facets_combined() {
        let facets = build_facets(
            Some("mod"),
            Some(&["optimization"]),
            Some(&["1.20.4"]),
            Some(&["fabric"]),
        );

        assert!(facets.contains("\"project_type:mod\""));
        assert!(facets.contains("\"categories:optimization\""));
        assert!(facets.contains("\"versions:1.20.4\""));
        assert!(facets.contains("\"categories:fabric\""));
    }

    #[test]
    fn test_normalize_loader() {
        assert_eq!(normalize_loader_for_modrinth("Fabric"), "fabric");
        assert_eq!(normalize_loader_for_modrinth("FORGE"), "forge");
        assert_eq!(normalize_loader_for_modrinth("NeoForge"), "neoforge");
    }

    #[test]
    fn test_modrinth_error_display() {
        let error = ModrinthError::Network("Connection failed".to_string());
        assert_eq!(error.to_string(), "Network error: Connection failed");

        let error = ModrinthError::HashMismatch {
            expected: "abc".to_string(),
            actual: "xyz".to_string(),
        };
        assert_eq!(error.to_string(), "Hash mismatch: expected abc, got xyz");
    }
}
