use crate::error::{AppError, AppResult};
use futures_util::StreamExt;
use sha1::{Digest, Sha1};
use sha2::{Sha256, Sha512};
use std::path::Path;
use std::time::Duration;
use tokio::fs::{self, File};
use tokio::io::AsyncWriteExt;
use tracing::{debug, info, warn};

/// Hash algorithm to use for verification
#[derive(Clone, Copy)]
pub enum HashAlgorithm {
    Sha1,
    Sha256,
    Sha512,
}

/// Configuration for download retry behavior
#[derive(Clone, Copy)]
pub struct RetryConfig {
    pub max_retries: u32,
    pub initial_delay_ms: u64,
    pub max_delay_ms: u64,
    pub backoff_multiplier: f64,
}

impl Default for RetryConfig {
    fn default() -> Self {
        Self {
            max_retries: 3,
            initial_delay_ms: 500,
            max_delay_ms: 10000,
            backoff_multiplier: 2.0,
        }
    }
}

/// Download a file from URL to the specified path (SHA1 verification)
pub async fn download_file(
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    expected_sha1: Option<&str>,
) -> AppResult<()> {
    download_file_with_hash(client, url, dest, expected_sha1, HashAlgorithm::Sha1).await
}

/// Download a file with SHA256 verification
pub async fn download_file_sha256(
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    expected_sha256: Option<&str>,
) -> AppResult<()> {
    download_file_with_hash(client, url, dest, expected_sha256, HashAlgorithm::Sha256).await
}

/// Download a file with SHA512 verification (preferred for Modrinth downloads)
pub async fn download_file_sha512(
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    expected_sha512: Option<&str>,
) -> AppResult<()> {
    download_file_with_hash(client, url, dest, expected_sha512, HashAlgorithm::Sha512).await
}

/// Download a file from URL to the specified path with configurable hash algorithm
pub async fn download_file_with_hash(
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    expected_hash: Option<&str>,
    algorithm: HashAlgorithm,
) -> AppResult<()> {
    // Create parent directories if needed
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).await.map_err(|e| {
            AppError::Io(format!(
                "Failed to create directory {}: {}",
                parent.display(),
                e
            ))
        })?;
    }

    // Check if file already exists with correct hash
    if dest.exists() {
        if let Some(expected) = expected_hash {
            let matches = match algorithm {
                HashAlgorithm::Sha1 => verify_sha1(dest, expected).await?,
                HashAlgorithm::Sha256 => verify_sha256(dest, expected).await?,
                HashAlgorithm::Sha512 => verify_sha512(dest, expected).await?,
            };
            if matches {
                return Ok(());
            }
        } else {
            // No hash to verify, assume file is good
            return Ok(());
        }
    }

    // Download the file
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("Failed to download {}: {}", url, e)))?;

    if !response.status().is_success() {
        return Err(AppError::Network(format!(
            "Failed to download {}: HTTP {}",
            url,
            response.status()
        )));
    }

    let mut file = File::create(dest)
        .await
        .map_err(|e| AppError::Io(format!("Failed to create file {}: {}", dest.display(), e)))?;

    let mut stream = response.bytes_stream();

    // Use appropriate hasher based on algorithm
    let mut sha1_hasher = Sha1::new();
    let mut sha256_hasher = Sha256::new();
    let mut sha512_hasher = Sha512::new();

    while let Some(chunk) = stream.next().await {
        let chunk =
            chunk.map_err(|e| AppError::Network(format!("Error downloading {}: {}", url, e)))?;

        match algorithm {
            HashAlgorithm::Sha1 => sha1_hasher.update(&chunk),
            HashAlgorithm::Sha256 => sha256_hasher.update(&chunk),
            HashAlgorithm::Sha512 => sha512_hasher.update(&chunk),
        }
        file.write_all(&chunk)
            .await
            .map_err(|e| AppError::Io(format!("Failed to write to {}: {}", dest.display(), e)))?;
    }

    file.flush()
        .await
        .map_err(|e| AppError::Io(format!("Failed to flush {}: {}", dest.display(), e)))?;

    // Verify hash if provided
    if let Some(expected) = expected_hash {
        let hash = match algorithm {
            HashAlgorithm::Sha1 => format!("{:x}", sha1_hasher.finalize()),
            HashAlgorithm::Sha256 => format!("{:x}", sha256_hasher.finalize()),
            HashAlgorithm::Sha512 => format!("{:x}", sha512_hasher.finalize()),
        };
        if hash != expected {
            // Delete the corrupted file
            let _ = fs::remove_file(dest).await;
            return Err(AppError::Download(format!(
                "Hash mismatch for {}: expected {}, got {}",
                dest.display(),
                expected,
                hash
            )));
        }
    }

    Ok(())
}

/// Verify SHA1 hash of a file
pub async fn verify_sha1(path: &Path, expected: &str) -> AppResult<bool> {
    let content = fs::read(path)
        .await
        .map_err(|e| AppError::Io(format!("Failed to read {}: {}", path.display(), e)))?;

    let mut hasher = Sha1::new();
    hasher.update(&content);
    let hash = format!("{:x}", hasher.finalize());

    Ok(hash == expected)
}

/// Verify SHA256 hash of a file
pub async fn verify_sha256(path: &Path, expected: &str) -> AppResult<bool> {
    let content = fs::read(path)
        .await
        .map_err(|e| AppError::Io(format!("Failed to read {}: {}", path.display(), e)))?;

    let mut hasher = Sha256::new();
    hasher.update(&content);
    let hash = format!("{:x}", hasher.finalize());

    Ok(hash == expected)
}

/// Verify SHA512 hash of a file
pub async fn verify_sha512(path: &Path, expected: &str) -> AppResult<bool> {
    let content = fs::read(path)
        .await
        .map_err(|e| AppError::Io(format!("Failed to read {}: {}", path.display(), e)))?;

    let mut hasher = Sha512::new();
    hasher.update(&content);
    let hash = format!("{:x}", hasher.finalize());

    Ok(hash == expected)
}

/// Download a file with automatic retry on failure
pub async fn download_file_with_retry(
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    expected_hash: Option<&str>,
    algorithm: HashAlgorithm,
    config: RetryConfig,
) -> AppResult<()> {
    let mut last_error = None;
    let mut delay = config.initial_delay_ms;

    for attempt in 0..=config.max_retries {
        if attempt > 0 {
            warn!(
                "Retry attempt {}/{} for {}, waiting {}ms",
                attempt, config.max_retries, url, delay
            );
            tokio::time::sleep(Duration::from_millis(delay)).await;
            delay = ((delay as f64) * config.backoff_multiplier) as u64;
            delay = delay.min(config.max_delay_ms);
        }

        match download_file_with_hash(client, url, dest, expected_hash, algorithm).await {
            Ok(()) => {
                if attempt > 0 {
                    info!("Successfully downloaded {} after {} retries", url, attempt);
                }
                return Ok(());
            }
            Err(e) => {
                warn!("Download attempt {} failed for {}: {}", attempt + 1, url, e);
                last_error = Some(e);
            }
        }
    }

    Err(last_error.unwrap_or_else(|| {
        AppError::Download(format!(
            "Failed to download {} after {} retries",
            url, config.max_retries
        ))
    }))
}

/// Download a file with SHA256 verification and retry
#[allow(dead_code)]
pub async fn download_file_sha256_with_retry(
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    expected_sha256: Option<&str>,
) -> AppResult<()> {
    download_file_with_retry(
        client,
        url,
        dest,
        expected_sha256,
        HashAlgorithm::Sha256,
        RetryConfig::default(),
    )
    .await
}

/// Download multiple files in parallel
#[allow(dead_code)]
pub async fn download_files_parallel(
    client: &reqwest::Client,
    downloads: Vec<(String, std::path::PathBuf, Option<String>)>,
    max_concurrent: usize,
) -> AppResult<()> {
    download_files_parallel_with_progress(client, downloads, max_concurrent, |_, _| {}).await
}

/// Progress callback type
#[allow(dead_code)]
pub type ProgressCallback = Box<dyn Fn(usize, usize) + Send + Sync>;

/// Download multiple files in parallel with progress reporting
pub async fn download_files_parallel_with_progress<F>(
    client: &reqwest::Client,
    downloads: Vec<(String, std::path::PathBuf, Option<String>)>,
    max_concurrent: usize,
    on_progress: F,
) -> AppResult<()>
where
    F: Fn(usize, usize) + Send + Sync,
{
    download_files_parallel_with_retry(
        client,
        downloads,
        max_concurrent,
        on_progress,
        RetryConfig::default(),
    )
    .await
}

/// Download multiple files in parallel with progress reporting and retry support
pub async fn download_files_parallel_with_retry<F>(
    client: &reqwest::Client,
    downloads: Vec<(String, std::path::PathBuf, Option<String>)>,
    max_concurrent: usize,
    on_progress: F,
    retry_config: RetryConfig,
) -> AppResult<()>
where
    F: Fn(usize, usize) + Send + Sync,
{
    download_files_parallel_with_algorithm(
        client,
        downloads,
        max_concurrent,
        on_progress,
        retry_config,
        HashAlgorithm::Sha1,
    )
    .await
}

/// Download multiple files in parallel with SHA512 verification (for Modrinth modpacks)
pub async fn download_files_parallel_sha512<F>(
    client: &reqwest::Client,
    downloads: Vec<(String, std::path::PathBuf, Option<String>)>,
    max_concurrent: usize,
    on_progress: F,
) -> AppResult<()>
where
    F: Fn(usize, usize) + Send + Sync,
{
    download_files_parallel_with_algorithm(
        client,
        downloads,
        max_concurrent,
        on_progress,
        RetryConfig::default(),
        HashAlgorithm::Sha512,
    )
    .await
}

/// Download multiple files in parallel with configurable hash algorithm
pub async fn download_files_parallel_with_algorithm<F>(
    client: &reqwest::Client,
    downloads: Vec<(String, std::path::PathBuf, Option<String>)>,
    max_concurrent: usize,
    on_progress: F,
    retry_config: RetryConfig,
    algorithm: HashAlgorithm,
) -> AppResult<()>
where
    F: Fn(usize, usize) + Send + Sync,
{
    use futures_util::stream::FuturesUnordered;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    let total = downloads.len();
    let completed = Arc::new(AtomicUsize::new(0));
    let failed = Arc::new(AtomicUsize::new(0));

    let mut futures = FuturesUnordered::new();
    let mut pending = downloads.into_iter().peekable();

    // Report initial progress
    on_progress(0, total);

    debug!(
        "Starting parallel download of {} files with {} concurrent",
        total, max_concurrent
    );

    while pending.peek().is_some() || !futures.is_empty() {
        // Add more tasks if we have capacity
        while futures.len() < max_concurrent {
            if let Some((url, dest, hash)) = pending.next() {
                let client = client.clone();
                let completed = Arc::clone(&completed);
                let failed = Arc::clone(&failed);
                futures.push(async move {
                    let result = download_file_with_retry(
                        &client,
                        &url,
                        &dest,
                        hash.as_deref(),
                        algorithm,
                        retry_config,
                    )
                    .await;

                    match &result {
                        Ok(()) => {
                            completed.fetch_add(1, Ordering::SeqCst);
                        }
                        Err(e) => {
                            failed.fetch_add(1, Ordering::SeqCst);
                            warn!("Failed to download {}: {}", url, e);
                        }
                    }
                    result
                });
            } else {
                break;
            }
        }

        // Wait for one to complete
        if let Some(result) = futures.next().await {
            result?;
            // Report progress after each completion
            let current = completed.load(Ordering::SeqCst);
            on_progress(current, total);
        }
    }

    let final_completed = completed.load(Ordering::SeqCst);
    let final_failed = failed.load(Ordering::SeqCst);

    if final_failed > 0 {
        warn!(
            "Parallel download completed with {} failures out of {}",
            final_failed, total
        );
    } else {
        info!(
            "Parallel download completed successfully: {}/{} files",
            final_completed, total
        );
    }

    Ok(())
}
