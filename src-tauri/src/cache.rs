//! Simple file-based cache for API responses
//!
//! Caches API responses to disk with a configurable TTL to reduce
//! unnecessary network requests for rarely-changing data.

use serde::{de::DeserializeOwned, Serialize};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::fs;

use crate::error::{AppError, AppResult};

/// Default cache TTL: 1 hour
const DEFAULT_TTL_SECS: u64 = 3600;

/// Cache entry with metadata
#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct CacheEntry<T> {
    data: T,
    cached_at: u64, // Unix timestamp
    ttl_secs: u64,
}

impl<T> CacheEntry<T> {
    fn new(data: T, ttl_secs: u64) -> Self {
        let cached_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        Self {
            data,
            cached_at,
            ttl_secs,
        }
    }

    fn is_expired(&self) -> bool {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        now >= self.cached_at + self.ttl_secs
    }
}

/// API response cache
pub struct ApiCache {
    cache_dir: PathBuf,
}

impl ApiCache {
    /// Create a new cache with the given cache directory
    pub fn new(data_dir: &Path) -> Self {
        Self {
            cache_dir: data_dir.join("cache").join("api"),
        }
    }

    /// Ensure the cache directory exists
    async fn ensure_dir(&self) -> AppResult<()> {
        fs::create_dir_all(&self.cache_dir)
            .await
            .map_err(|e| AppError::Io(format!("Failed to create cache directory: {}", e)))
    }

    /// Get the cache file path for a given key
    fn cache_path(&self, key: &str) -> PathBuf {
        // Sanitize key for filesystem
        let safe_key = key.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_");
        self.cache_dir.join(format!("{}.json", safe_key))
    }

    /// Get a cached value if it exists and is not expired
    pub async fn get<T: DeserializeOwned>(&self, key: &str) -> Option<T> {
        let path = self.cache_path(key);

        let content = match fs::read_to_string(&path).await {
            Ok(c) => c,
            Err(_) => return None,
        };

        let entry: CacheEntry<T> = match serde_json::from_str(&content) {
            Ok(e) => e,
            Err(_) => return None,
        };

        if entry.is_expired() {
            // Clean up expired entry
            let _ = fs::remove_file(&path).await;
            return None;
        }

        Some(entry.data)
    }

    /// Store a value in the cache with default TTL (1 hour)
    pub async fn set<T: Serialize>(&self, key: &str, data: &T) -> AppResult<()> {
        self.set_with_ttl(key, data, Duration::from_secs(DEFAULT_TTL_SECS))
            .await
    }

    /// Store a value in the cache with custom TTL
    pub async fn set_with_ttl<T: Serialize>(
        &self,
        key: &str,
        data: &T,
        ttl: Duration,
    ) -> AppResult<()> {
        self.ensure_dir().await?;

        let entry = CacheEntry::new(data, ttl.as_secs());
        let content = serde_json::to_string_pretty(&entry)
            .map_err(|e| AppError::Io(format!("Failed to serialize cache entry: {}", e)))?;

        let path = self.cache_path(key);
        fs::write(&path, content)
            .await
            .map_err(|e| AppError::Io(format!("Failed to write cache file: {}", e)))
    }

    /// Get a cached value or fetch it using the provided async function
    pub async fn get_or_fetch<T, F, Fut>(&self, key: &str, fetch_fn: F) -> AppResult<T>
    where
        T: Serialize + DeserializeOwned,
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = AppResult<T>>,
    {
        self.get_or_fetch_with_ttl(key, Duration::from_secs(DEFAULT_TTL_SECS), fetch_fn)
            .await
    }

    /// Get a cached value or fetch it with custom TTL
    pub async fn get_or_fetch_with_ttl<T, F, Fut>(
        &self,
        key: &str,
        ttl: Duration,
        fetch_fn: F,
    ) -> AppResult<T>
    where
        T: Serialize + DeserializeOwned,
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = AppResult<T>>,
    {
        // Try cache first
        if let Some(cached) = self.get(key).await {
            return Ok(cached);
        }

        // Fetch fresh data
        let data = fetch_fn().await?;

        // Cache the result (don't fail if caching fails)
        if let Err(e) = self.set_with_ttl(key, &data, ttl).await {
            tracing::warn!("Failed to cache API response: {}", e);
        }

        Ok(data)
    }

    /// Clear all cached data
    pub async fn clear(&self) -> AppResult<()> {
        if self.cache_dir.exists() {
            fs::remove_dir_all(&self.cache_dir)
                .await
                .map_err(|e| AppError::Io(format!("Failed to clear cache: {}", e)))?;
        }
        Ok(())
    }

    /// Clear cached data for a specific key
    pub async fn invalidate(&self, key: &str) -> AppResult<()> {
        let path = self.cache_path(key);
        if path.exists() {
            fs::remove_file(&path)
                .await
                .map_err(|e| AppError::Io(format!("Failed to invalidate cache: {}", e)))?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_cache_set_and_get() {
        let temp = tempdir().unwrap();
        let cache = ApiCache::new(temp.path());

        let data = vec!["1.20.4", "1.20.3", "1.20.2"];
        cache.set("test_versions", &data).await.unwrap();

        let cached: Vec<String> = cache.get("test_versions").await.unwrap();
        assert_eq!(cached, data);
    }

    #[tokio::test]
    async fn test_cache_expiration() {
        let temp = tempdir().unwrap();
        let cache = ApiCache::new(temp.path());

        let data = "test_data";
        // Set with 0 TTL (immediately expired)
        cache
            .set_with_ttl("expired", &data, Duration::ZERO)
            .await
            .unwrap();

        // Should return None because it's expired (TTL of 0 means expires immediately)
        let cached: Option<String> = cache.get("expired").await;
        assert!(cached.is_none());
    }

    #[tokio::test]
    async fn test_cache_miss() {
        let temp = tempdir().unwrap();
        let cache = ApiCache::new(temp.path());

        let cached: Option<String> = cache.get("nonexistent").await;
        assert!(cached.is_none());
    }

    #[tokio::test]
    async fn test_get_or_fetch() {
        let temp = tempdir().unwrap();
        let cache = ApiCache::new(temp.path());

        let mut fetch_count = 0;

        // First call should fetch
        let result: String = cache
            .get_or_fetch("test_key", || async {
                fetch_count += 1;
                Ok("fetched_value".to_string())
            })
            .await
            .unwrap();
        assert_eq!(result, "fetched_value");

        // Second call should use cache (we can't track fetch_count across async closures easily,
        // but we can verify the value is correct)
        let result2: String = cache
            .get_or_fetch("test_key", || async {
                Ok("should_not_be_this".to_string())
            })
            .await
            .unwrap();
        assert_eq!(result2, "fetched_value");
    }

    #[tokio::test]
    async fn test_cache_invalidate() {
        let temp = tempdir().unwrap();
        let cache = ApiCache::new(temp.path());

        cache.set("to_invalidate", &"some_data").await.unwrap();
        assert!(cache.get::<String>("to_invalidate").await.is_some());

        cache.invalidate("to_invalidate").await.unwrap();
        assert!(cache.get::<String>("to_invalidate").await.is_none());
    }
}
