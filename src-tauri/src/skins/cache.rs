use crate::error::{AppError, AppResult};
use crate::skins::{Skin, SkinSource, SkinVariant};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tokio::fs;
use tokio::io::AsyncWriteExt;

const CACHE_DIR: &str = "skins_cache";
const CACHE_INDEX_FILE: &str = "cache_index.json";

/// Cache entry metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
struct CacheEntry {
    pub skin_id: String,
    pub name: String,
    pub url: String,
    pub variant: SkinVariant,
    pub source: SkinSource,
    pub file_name: String,
    pub cached_at: i64,
    pub last_accessed: i64,
}

/// Cache index containing all cached skin metadata
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct CacheIndex {
    pub entries: Vec<CacheEntry>,
}

/// Get the cache directory path
pub fn get_cache_dir(data_dir: &Path) -> PathBuf {
    data_dir.join(CACHE_DIR)
}

/// Initialize the cache directory
pub async fn init_cache(data_dir: &Path) -> AppResult<()> {
    let cache_dir = get_cache_dir(data_dir);
    fs::create_dir_all(&cache_dir)
        .await
        .map_err(|e| AppError::Skin(format!("Failed to create cache directory: {}", e)))?;

    // Create thumbnails and full subdirectories
    fs::create_dir_all(cache_dir.join("thumbnails")).await.ok();
    fs::create_dir_all(cache_dir.join("full")).await.ok();

    Ok(())
}

/// Cache a skin's image data
pub async fn cache_skin(
    data_dir: &Path,
    skin: &Skin,
    image_data: &[u8],
) -> AppResult<PathBuf> {
    init_cache(data_dir).await?;

    let cache_dir = get_cache_dir(data_dir);
    let file_name = format!("{}.png", skin.id);
    let file_path = cache_dir.join("full").join(&file_name);

    // Write the image data
    let mut file = fs::File::create(&file_path)
        .await
        .map_err(|e| AppError::Skin(format!("Failed to create cache file: {}", e)))?;

    file.write_all(image_data)
        .await
        .map_err(|e| AppError::Skin(format!("Failed to write cache file: {}", e)))?;

    // Update the cache index
    let mut index = load_cache_index(data_dir).await;

    // Remove existing entry if present
    index.entries.retain(|e| e.skin_id != skin.id);

    // Add new entry
    let now = chrono::Utc::now().timestamp();
    index.entries.push(CacheEntry {
        skin_id: skin.id.clone(),
        name: skin.name.clone(),
        url: skin.url.clone(),
        variant: skin.variant.clone(),
        source: skin.source.clone(),
        file_name,
        cached_at: now,
        last_accessed: now,
    });

    save_cache_index(data_dir, &index).await?;

    Ok(file_path)
}

/// Get cached skins
pub async fn get_cached_skins(data_dir: &Path) -> AppResult<Vec<Skin>> {
    let index = load_cache_index(data_dir).await;

    Ok(index
        .entries
        .into_iter()
        .map(|e| Skin {
            id: e.skin_id,
            name: e.name,
            url: e.url,
            variant: e.variant,
            source: e.source,
            author: None,
            thumbnail_url: None,
        })
        .collect())
}

/// Get a cached skin's file path
pub async fn get_cached_skin_path(data_dir: &Path, skin_id: &str) -> AppResult<Option<PathBuf>> {
    let index = load_cache_index(data_dir).await;

    if let Some(entry) = index.entries.iter().find(|e| e.skin_id == skin_id) {
        let file_path = get_cache_dir(data_dir).join("full").join(&entry.file_name);
        if file_path.exists() {
            return Ok(Some(file_path));
        }
    }

    Ok(None)
}

/// Delete a cached skin
pub async fn delete_cached_skin(data_dir: &Path, skin_id: &str) -> AppResult<()> {
    let cache_dir = get_cache_dir(data_dir);

    // Load index
    let mut index = load_cache_index(data_dir).await;

    // Find and remove entry
    if let Some(entry) = index.entries.iter().find(|e| e.skin_id == skin_id).cloned() {
        // Delete file
        let file_path = cache_dir.join("full").join(&entry.file_name);
        if file_path.exists() {
            fs::remove_file(&file_path).await.ok();
        }

        // Remove from index
        index.entries.retain(|e| e.skin_id != skin_id);
        save_cache_index(data_dir, &index).await?;
    }

    Ok(())
}

/// Clean up old cache entries
pub async fn cleanup_cache(data_dir: &Path, max_age_days: u32) -> AppResult<u64> {
    let cache_dir = get_cache_dir(data_dir);
    let mut index = load_cache_index(data_dir).await;

    let now = chrono::Utc::now().timestamp();
    let max_age_seconds = (max_age_days as i64) * 24 * 60 * 60;
    let mut cleaned = 0u64;

    let entries_to_remove: Vec<_> = index
        .entries
        .iter()
        .filter(|e| now - e.last_accessed > max_age_seconds)
        .cloned()
        .collect();

    for entry in entries_to_remove {
        let file_path = cache_dir.join("full").join(&entry.file_name);
        if fs::remove_file(&file_path).await.is_ok() {
            cleaned += 1;
        }
        index.entries.retain(|e| e.skin_id != entry.skin_id);
    }

    save_cache_index(data_dir, &index).await?;

    Ok(cleaned)
}

/// Get cache size in bytes
pub async fn get_cache_size(data_dir: &Path) -> AppResult<u64> {
    let cache_dir = get_cache_dir(data_dir).join("full");

    if !cache_dir.exists() {
        return Ok(0);
    }

    let mut size = 0u64;

    let mut entries = fs::read_dir(&cache_dir)
        .await
        .map_err(|e| AppError::Skin(format!("Failed to read cache directory: {}", e)))?;

    while let Some(entry) = entries.next_entry().await.ok().flatten() {
        if let Ok(metadata) = entry.metadata().await {
            size += metadata.len();
        }
    }

    Ok(size)
}

/// Load cache index from disk
async fn load_cache_index(data_dir: &Path) -> CacheIndex {
    let index_path = get_cache_dir(data_dir).join(CACHE_INDEX_FILE);

    if !index_path.exists() {
        return CacheIndex::default();
    }

    match fs::read_to_string(&index_path).await {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => CacheIndex::default(),
    }
}

/// Save cache index to disk
async fn save_cache_index(data_dir: &Path, index: &CacheIndex) -> AppResult<()> {
    let index_path = get_cache_dir(data_dir).join(CACHE_INDEX_FILE);

    let content = serde_json::to_string_pretty(index)
        .map_err(|e| AppError::Skin(format!("Failed to serialize cache index: {}", e)))?;

    fs::write(&index_path, content)
        .await
        .map_err(|e| AppError::Skin(format!("Failed to write cache index: {}", e)))?;

    Ok(())
}
