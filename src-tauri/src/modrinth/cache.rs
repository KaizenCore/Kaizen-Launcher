// Modrinth API Cache with TTL (Time To Live)
// Reduces repeated API calls for project data that rarely changes

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

use super::{Project, SearchResponse, Version};

/// Cache entry with data and creation timestamp
#[derive(Clone)]
struct CacheEntry<T: Clone> {
    data: T,
    created_at: Instant,
}

impl<T: Clone> CacheEntry<T> {
    fn new(data: T) -> Self {
        Self {
            data,
            created_at: Instant::now(),
        }
    }

    fn is_expired(&self, ttl: Duration) -> bool {
        self.created_at.elapsed() > ttl
    }
}

/// Thread-safe Modrinth API cache with configurable TTL
pub struct ModrinthCache {
    /// Cache for individual projects (by ID or slug)
    projects: RwLock<HashMap<String, CacheEntry<Project>>>,
    /// Cache for project versions (key: "project_id:loader:game_version")
    versions: RwLock<HashMap<String, CacheEntry<Vec<Version>>>>,
    /// Cache for search results (key: serialized search params)
    searches: RwLock<HashMap<String, CacheEntry<SearchResponse>>>,
    /// Time-to-live for cache entries
    ttl: Duration,
}

impl ModrinthCache {
    /// Create a new cache with the specified TTL in seconds
    pub fn new(ttl_seconds: u64) -> Self {
        Self {
            projects: RwLock::new(HashMap::new()),
            versions: RwLock::new(HashMap::new()),
            searches: RwLock::new(HashMap::new()),
            ttl: Duration::from_secs(ttl_seconds),
        }
    }

    /// Create a cache with default 5 minute TTL
    pub fn default() -> Self {
        Self::new(300) // 5 minutes
    }

    // ============= Project Cache =============

    /// Get a project from cache if it exists and is not expired
    pub async fn get_project(&self, id_or_slug: &str) -> Option<Project> {
        let cache = self.projects.read().await;
        if let Some(entry) = cache.get(id_or_slug) {
            if !entry.is_expired(self.ttl) {
                tracing::debug!("Cache hit for project: {}", id_or_slug);
                return Some(entry.data.clone());
            }
            tracing::debug!("Cache expired for project: {}", id_or_slug);
        }
        None
    }

    /// Store a project in the cache
    pub async fn set_project(&self, id_or_slug: &str, project: Project) {
        let mut cache = self.projects.write().await;
        // Store by both ID and slug for faster lookups
        cache.insert(id_or_slug.to_string(), CacheEntry::new(project.clone()));
        // Also cache by the other key if different
        if id_or_slug != project.id {
            cache.insert(project.id.clone(), CacheEntry::new(project.clone()));
        }
        if id_or_slug != project.slug {
            cache.insert(project.slug.clone(), CacheEntry::new(project));
        }
        tracing::debug!("Cached project: {}", id_or_slug);
    }

    // ============= Versions Cache =============

    /// Build a cache key for project versions
    fn versions_key(
        project_id: &str,
        loaders: Option<&[&str]>,
        game_versions: Option<&[&str]>,
    ) -> String {
        let loaders_str = loaders
            .map(|l| l.join(","))
            .unwrap_or_else(|| "*".to_string());
        let versions_str = game_versions
            .map(|v| v.join(","))
            .unwrap_or_else(|| "*".to_string());
        format!("{}:{}:{}", project_id, loaders_str, versions_str)
    }

    /// Get project versions from cache if they exist and are not expired
    pub async fn get_versions(
        &self,
        project_id: &str,
        loaders: Option<&[&str]>,
        game_versions: Option<&[&str]>,
    ) -> Option<Vec<Version>> {
        let key = Self::versions_key(project_id, loaders, game_versions);
        let cache = self.versions.read().await;
        if let Some(entry) = cache.get(&key) {
            if !entry.is_expired(self.ttl) {
                tracing::debug!("Cache hit for versions: {}", key);
                return Some(entry.data.clone());
            }
            tracing::debug!("Cache expired for versions: {}", key);
        }
        None
    }

    /// Store project versions in the cache
    pub async fn set_versions(
        &self,
        project_id: &str,
        loaders: Option<&[&str]>,
        game_versions: Option<&[&str]>,
        versions: Vec<Version>,
    ) {
        let key = Self::versions_key(project_id, loaders, game_versions);
        let mut cache = self.versions.write().await;
        cache.insert(key.clone(), CacheEntry::new(versions));
        tracing::debug!("Cached versions: {}", key);
    }

    // ============= Search Cache =============

    /// Build a cache key for search results
    fn search_key(
        query: &str,
        facets: Option<&str>,
        index: Option<&str>,
        offset: Option<u32>,
        limit: Option<u32>,
    ) -> String {
        format!(
            "search:{}:{}:{}:{}:{}",
            query,
            facets.unwrap_or("*"),
            index.unwrap_or("relevance"),
            offset.unwrap_or(0),
            limit.unwrap_or(20)
        )
    }

    /// Get search results from cache if they exist and are not expired
    pub async fn get_search(
        &self,
        query: &str,
        facets: Option<&str>,
        index: Option<&str>,
        offset: Option<u32>,
        limit: Option<u32>,
    ) -> Option<SearchResponse> {
        let key = Self::search_key(query, facets, index, offset, limit);
        let cache = self.searches.read().await;
        if let Some(entry) = cache.get(&key) {
            if !entry.is_expired(self.ttl) {
                tracing::debug!("Cache hit for search: {}", key);
                return Some(entry.data.clone());
            }
            tracing::debug!("Cache expired for search: {}", key);
        }
        None
    }

    /// Store search results in the cache
    pub async fn set_search(
        &self,
        query: &str,
        facets: Option<&str>,
        index: Option<&str>,
        offset: Option<u32>,
        limit: Option<u32>,
        response: SearchResponse,
    ) {
        let key = Self::search_key(query, facets, index, offset, limit);
        let mut cache = self.searches.write().await;
        cache.insert(key.clone(), CacheEntry::new(response));
        tracing::debug!("Cached search: {}", key);
    }

    // ============= Cache Management =============

    /// Clear all expired entries from all caches
    pub async fn cleanup_expired(&self) {
        let ttl = self.ttl;

        // Cleanup projects cache
        {
            let mut cache = self.projects.write().await;
            let before = cache.len();
            cache.retain(|_, entry| !entry.is_expired(ttl));
            let removed = before - cache.len();
            if removed > 0 {
                tracing::debug!("Cleaned up {} expired project entries", removed);
            }
        }

        // Cleanup versions cache
        {
            let mut cache = self.versions.write().await;
            let before = cache.len();
            cache.retain(|_, entry| !entry.is_expired(ttl));
            let removed = before - cache.len();
            if removed > 0 {
                tracing::debug!("Cleaned up {} expired version entries", removed);
            }
        }

        // Cleanup searches cache
        {
            let mut cache = self.searches.write().await;
            let before = cache.len();
            cache.retain(|_, entry| !entry.is_expired(ttl));
            let removed = before - cache.len();
            if removed > 0 {
                tracing::debug!("Cleaned up {} expired search entries", removed);
            }
        }
    }

    /// Clear all caches
    pub async fn clear_all(&self) {
        self.projects.write().await.clear();
        self.versions.write().await.clear();
        self.searches.write().await.clear();
        tracing::debug!("Cleared all Modrinth caches");
    }

    /// Get cache statistics
    pub async fn stats(&self) -> CacheStats {
        CacheStats {
            projects_count: self.projects.read().await.len(),
            versions_count: self.versions.read().await.len(),
            searches_count: self.searches.read().await.len(),
            ttl_seconds: self.ttl.as_secs(),
        }
    }
}

/// Cache statistics
#[derive(Debug, Clone)]
pub struct CacheStats {
    pub projects_count: usize,
    pub versions_count: usize,
    pub searches_count: usize,
    pub ttl_seconds: u64,
}

/// Global Modrinth cache instance
/// Using lazy_static pattern with once_cell for thread-safe initialization
static MODRINTH_CACHE: once_cell::sync::Lazy<Arc<ModrinthCache>> =
    once_cell::sync::Lazy::new(|| Arc::new(ModrinthCache::default()));

/// Get the global Modrinth cache instance
pub fn get_cache() -> Arc<ModrinthCache> {
    MODRINTH_CACHE.clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_project(id: &str, slug: &str) -> Project {
        Project {
            id: id.to_string(),
            slug: slug.to_string(),
            project_type: "mod".to_string(),
            title: "Test Mod".to_string(),
            description: "A test mod".to_string(),
            body: "Test body".to_string(),
            categories: vec![],
            client_side: "required".to_string(),
            server_side: "optional".to_string(),
            downloads: 1000,
            followers: 100,
            icon_url: None,
            issues_url: None,
            source_url: None,
            wiki_url: None,
            discord_url: None,
            donation_urls: vec![],
            gallery: vec![],
            versions: vec![],
            game_versions: vec!["1.20.4".to_string()],
            loaders: vec!["fabric".to_string()],
            team: "test-team".to_string(),
            published: "2024-01-01T00:00:00Z".to_string(),
            updated: "2024-01-01T00:00:00Z".to_string(),
            license: None,
        }
    }

    #[tokio::test]
    async fn test_project_cache() {
        let cache = ModrinthCache::new(60); // 1 minute TTL
        let project = create_test_project("abc123", "test-mod");

        // Initially empty
        assert!(cache.get_project("abc123").await.is_none());

        // Set and get
        cache.set_project("abc123", project.clone()).await;
        let cached = cache.get_project("abc123").await;
        assert!(cached.is_some());
        assert_eq!(cached.unwrap().id, "abc123");

        // Can also get by slug
        let by_slug = cache.get_project("test-mod").await;
        assert!(by_slug.is_some());
    }

    #[tokio::test]
    async fn test_cache_expiration() {
        let cache = ModrinthCache::new(1); // 1 second TTL
        let project = create_test_project("abc123", "test-mod");

        cache.set_project("abc123", project).await;
        assert!(cache.get_project("abc123").await.is_some());

        // Wait for expiration
        tokio::time::sleep(Duration::from_secs(2)).await;
        assert!(cache.get_project("abc123").await.is_none());
    }

    #[tokio::test]
    async fn test_versions_key() {
        let key1 = ModrinthCache::versions_key("proj1", Some(&["fabric"]), Some(&["1.20.4"]));
        let key2 = ModrinthCache::versions_key("proj1", Some(&["forge"]), Some(&["1.20.4"]));
        let key3 = ModrinthCache::versions_key("proj1", Some(&["fabric"]), Some(&["1.20.4"]));

        assert_ne!(key1, key2);
        assert_eq!(key1, key3);
    }

    #[tokio::test]
    async fn test_cleanup_expired() {
        let cache = ModrinthCache::new(1); // 1 second TTL
        let project = create_test_project("abc123", "test-mod");

        cache.set_project("abc123", project).await;

        let stats_before = cache.stats().await;
        assert!(stats_before.projects_count > 0);

        // Wait for expiration and cleanup
        tokio::time::sleep(Duration::from_secs(2)).await;
        cache.cleanup_expired().await;

        let stats_after = cache.stats().await;
        assert_eq!(stats_after.projects_count, 0);
    }

    #[tokio::test]
    async fn test_clear_all() {
        let cache = ModrinthCache::new(300);
        let project = create_test_project("abc123", "test-mod");

        cache.set_project("abc123", project).await;
        assert!(cache.stats().await.projects_count > 0);

        cache.clear_all().await;
        assert_eq!(cache.stats().await.projects_count, 0);
    }
}
