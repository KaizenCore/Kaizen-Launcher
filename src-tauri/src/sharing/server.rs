//! HTTP file server for instance sharing
//! Serves the export ZIP file via a local HTTP server that can be tunneled

use crate::error::{AppError, AppResult};
use crate::tunnel::agent::get_agent_binary_path;
use crate::tunnel::TunnelProvider;
use once_cell::sync::Lazy;
use rand::Rng;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::SeekFrom;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncSeekExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::process::Command;
use tokio::sync::RwLock;
use tracing::{debug, error, info, warn};

// Windows-specific: CREATE_NO_WINDOW flag to hide console window
#[cfg(target_os = "windows")]
#[allow(unused_imports)]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
#[allow(dead_code)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

// Pre-compiled regex for bore URL parsing
static BORE_URL_REGEX: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"listening at ([a-zA-Z0-9.-]+:\d+)").expect("Invalid bore URL regex"));
static BORE_HOST_PORT_REGEX: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"bore\.pub:\d+").expect("Invalid bore host:port regex"));
// Pre-compiled regex for Cloudflare URL parsing
static CLOUDFLARE_URL_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com").expect("Invalid cloudflare URL regex")
});

/// Provider for sharing tunnels
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum SharingProvider {
    #[default]
    Bore,
    Cloudflare,
}

/// Security constants
const AUTH_TOKEN_LENGTH: usize = 32; // 256-bit token
const MAX_CONCURRENT_CONNECTIONS: usize = 10;
const REQUEST_TIMEOUT_SECS: u64 = 300; // 5 minutes per request

/// Information about an active share session
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActiveShare {
    pub share_id: String,
    pub instance_name: String,
    pub package_path: String,
    pub local_port: u16,
    pub public_url: Option<String>,
    pub download_count: u32,
    pub uploaded_bytes: u64,
    pub started_at: String,
    pub file_size: u64,
    pub provider: SharingProvider,
    /// Whether this share requires a password
    pub has_password: bool,
    #[serde(skip_serializing)] // Never expose token to frontend
    #[allow(dead_code)] // Stored for security validation, not directly read
    pub auth_token: String,
    #[serde(skip_serializing)] // Never expose password hash to frontend
    #[allow(dead_code)]
    pub password_hash: Option<String>,
}

/// Event emitted when share status changes
#[derive(Debug, Clone, Serialize)]
pub struct ShareStatusEvent {
    pub share_id: String,
    pub status: String,
    pub public_url: Option<String>,
    pub error: Option<String>,
}

/// Event emitted when download progress updates
#[derive(Debug, Clone, Serialize)]
pub struct ShareDownloadEvent {
    pub share_id: String,
    pub download_count: u32,
    pub uploaded_bytes: u64,
}

/// Tracks running share sessions
pub type RunningShares = Arc<RwLock<HashMap<String, ShareSession>>>;

/// A running share session with server and tunnel
pub struct ShareSession {
    pub info: ActiveShare,
    pub server_handle: tokio::task::JoinHandle<()>,
    pub tunnel_pid: Option<u32>,
    pub shutdown_tx: tokio::sync::broadcast::Sender<()>,
    /// Live download count tracker
    pub download_count: Arc<RwLock<u32>>,
    /// Live uploaded bytes tracker
    pub uploaded_bytes: Arc<RwLock<u64>>,
}

/// Generate a cryptographically secure auth token
fn generate_auth_token() -> String {
    let mut rng = rand::thread_rng();
    let bytes: [u8; AUTH_TOKEN_LENGTH] = rng.gen();
    // Use URL-safe base64 encoding (no padding)
    bytes
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect::<String>()
}

/// Validate auth token using constant-time comparison to prevent timing attacks
fn validate_token(provided: &str, expected: &str) -> bool {
    if provided.len() != expected.len() {
        return false;
    }
    // Constant-time comparison
    provided
        .bytes()
        .zip(expected.bytes())
        .fold(0u8, |acc, (a, b)| acc | (a ^ b))
        == 0
}

/// Hash password using SHA-256 (with salt derived from share_id for uniqueness)
fn hash_password(password: &str, share_id: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(password.as_bytes());
    hasher.update(share_id.as_bytes()); // Salt with share_id
    let result = hasher.finalize();
    result.iter().map(|b| format!("{:02x}", b)).collect()
}

/// Validate password against stored hash
fn validate_password(provided: &str, share_id: &str, expected_hash: &str) -> bool {
    let provided_hash = hash_password(provided, share_id);
    validate_token(&provided_hash, expected_hash)
}

/// Find an available port
async fn find_available_port() -> AppResult<u16> {
    // Try to bind to port 0 to get an available port
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| AppError::Io(format!("Failed to find available port: {}", e)))?;

    let port = listener
        .local_addr()
        .map_err(|e| AppError::Io(format!("Failed to get local address: {}", e)))?
        .port();

    // Drop the listener to free the port
    drop(listener);

    Ok(port)
}

/// Start the HTTP file server with authentication and rate limiting
#[allow(clippy::too_many_arguments)]
async fn start_http_server(
    package_path: PathBuf,
    port: u16,
    share_id: String,
    auth_token: String,
    password_hash: Option<String>,
    app: AppHandle,
    mut shutdown_rx: tokio::sync::broadcast::Receiver<()>,
    download_count: Arc<RwLock<u32>>,
    uploaded_bytes: Arc<RwLock<u64>>,
) -> AppResult<()> {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = TcpListener::bind(addr)
        .await
        .map_err(|e| AppError::Io(format!("Failed to bind HTTP server: {}", e)))?;

    // Rate limiting: track active connections
    let active_connections = Arc::new(AtomicUsize::new(0));

    info!(
        "[SHARE] HTTP server listening on port {} (token-protected)",
        port
    );

    loop {
        tokio::select! {
            _ = shutdown_rx.recv() => {
                info!("[SHARE] Shutting down HTTP server");
                break;
            }
            result = listener.accept() => {
                match result {
                    Ok((stream, peer_addr)) => {
                        // Rate limiting: check concurrent connections
                        let current = active_connections.load(Ordering::SeqCst);
                        if current >= MAX_CONCURRENT_CONNECTIONS {
                            warn!("[SECURITY] Rate limit reached ({} connections), rejecting {}", current, peer_addr);
                            // Connection will be dropped
                            continue;
                        }

                        active_connections.fetch_add(1, Ordering::SeqCst);
                        debug!("[SHARE] Connection from {} (active: {})", peer_addr, current + 1);

                        let path = package_path.clone();
                        let share_id_clone = share_id.clone();
                        let auth_token_clone = auth_token.clone();
                        let password_hash_clone = password_hash.clone();
                        let app_clone = app.clone();
                        let download_count_clone = download_count.clone();
                        let uploaded_bytes_clone = uploaded_bytes.clone();
                        let connections_clone = active_connections.clone();

                        tokio::spawn(async move {
                            // Apply request timeout
                            let result = tokio::time::timeout(
                                std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS),
                                handle_connection(
                                    stream,
                                    &path,
                                    &share_id_clone,
                                    &auth_token_clone,
                                    password_hash_clone.as_deref(),
                                    &app_clone,
                                    download_count_clone,
                                    uploaded_bytes_clone,
                                )
                            ).await;

                            // Decrement active connections
                            connections_clone.fetch_sub(1, Ordering::SeqCst);

                            match result {
                                Ok(Ok(())) => {}
                                Ok(Err(e)) => error!("[SHARE] Connection error: {}", e),
                                Err(_) => warn!("[SECURITY] Request timeout from {}", peer_addr),
                            }
                        });
                    }
                    Err(e) => {
                        error!("[SHARE] Accept error: {}", e);
                    }
                }
            }
        }
    }

    Ok(())
}

/// Handle an HTTP connection with token validation
async fn handle_connection(
    mut stream: TcpStream,
    package_path: &Path,
    share_id: &str,
    expected_token: &str,
    password_hash: Option<&str>,
    app: &AppHandle,
    download_count: Arc<RwLock<u32>>,
    uploaded_bytes: Arc<RwLock<u64>>,
) -> AppResult<()> {
    let mut buffer = [0u8; 4096];
    let n = stream
        .read(&mut buffer)
        .await
        .map_err(|e| AppError::Io(format!("Read error: {}", e)))?;

    let request = String::from_utf8_lossy(&buffer[..n]);
    let first_line = request.lines().next().unwrap_or("");

    debug!("[SHARE] Request: {}", first_line);

    // Parse request
    let parts: Vec<&str> = first_line.split_whitespace().collect();
    if parts.len() < 2 {
        send_response(&mut stream, 400, "Bad Request", None).await?;
        return Ok(());
    }

    let method = parts[0];
    let request_path = parts[1];

    // Security: Parse and validate auth token from URL
    // Expected formats: /{token}, /{token}/download, /{token}/manifest
    let path_parts: Vec<&str> = request_path
        .trim_start_matches('/')
        .splitn(2, '/')
        .collect();

    if path_parts.is_empty() {
        warn!("[SECURITY] Empty path in request");
        send_response(&mut stream, 403, "Forbidden", Some("Access denied")).await?;
        return Ok(());
    }

    let provided_token = path_parts[0];

    // Validate token using constant-time comparison
    if !validate_token(provided_token, expected_token) {
        warn!("[SECURITY] Invalid auth token attempted");
        // Add delay to slow down brute force attempts
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        send_response(
            &mut stream,
            403,
            "Forbidden",
            Some("Invalid or missing access token"),
        )
        .await?;
        return Ok(());
    }

    // Token is valid, determine the actual path (after the token)
    let path = if path_parts.len() > 1 {
        format!("/{}", path_parts[1])
    } else {
        "/".to_string()
    };

    // Password protection: check X-Share-Password header if password is required
    if let Some(expected_hash) = password_hash {
        let provided_password = request
            .lines()
            .find(|line| line.to_lowercase().starts_with("x-share-password:"))
            .and_then(|line| line.split(':').nth(1))
            .map(|s| s.trim());

        match provided_password {
            None => {
                // Password required but not provided - return 401 with specific message
                info!("[SHARE] Password required but not provided");
                send_response(&mut stream, 401, "Unauthorized", Some("PASSWORD_REQUIRED")).await?;
                return Ok(());
            }
            Some(password) => {
                if !validate_password(password, share_id, expected_hash) {
                    warn!("[SECURITY] Invalid password attempted");
                    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                    send_response(&mut stream, 403, "Forbidden", Some("INVALID_PASSWORD")).await?;
                    return Ok(());
                }
                debug!("[SHARE] Password validated successfully");
            }
        }
    }

    // Check if range request
    let range_header = request
        .lines()
        .find(|line| line.to_lowercase().starts_with("range:"))
        .and_then(|line| line.split(':').nth(1))
        .map(|s| s.trim().to_string());

    match (method, path.as_str()) {
        ("GET", "/") | ("GET", "/download") | ("GET", "/instance.kaizen") => {
            serve_file(
                &mut stream,
                package_path,
                range_header,
                share_id,
                app,
                download_count,
                uploaded_bytes,
            )
            .await?;
        }
        ("GET", "/manifest") => {
            serve_manifest(&mut stream, package_path).await?;
        }
        ("HEAD", "/") | ("HEAD", "/download") | ("HEAD", "/instance.kaizen") => {
            serve_file_head(&mut stream, package_path).await?;
        }
        _ => {
            send_response(&mut stream, 404, "Not Found", None).await?;
        }
    }

    Ok(())
}

/// Serve the ZIP file
async fn serve_file(
    stream: &mut TcpStream,
    package_path: &Path,
    range_header: Option<String>,
    share_id: &str,
    app: &AppHandle,
    download_count: Arc<RwLock<u32>>,
    uploaded_bytes: Arc<RwLock<u64>>,
) -> AppResult<()> {
    let mut file = tokio::fs::File::open(package_path)
        .await
        .map_err(|e| AppError::Io(format!("Failed to open file: {}", e)))?;

    let metadata = file
        .metadata()
        .await
        .map_err(|e| AppError::Io(format!("Failed to get metadata: {}", e)))?;

    let file_size = metadata.len();
    let filename = package_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("instance.kaizen");

    // Parse range if present
    let (start, end, status, content_length) = if let Some(range) = range_header {
        if let Some(range_str) = range.strip_prefix("bytes=") {
            let parts: Vec<&str> = range_str.split('-').collect();
            let start: u64 = parts.first().and_then(|s| s.parse().ok()).unwrap_or(0);
            let end: u64 = parts
                .get(1)
                .and_then(|s| if s.is_empty() { None } else { s.parse().ok() })
                .unwrap_or(file_size - 1)
                .min(file_size - 1);

            (start, end, 206, end - start + 1)
        } else {
            (0, file_size - 1, 200, file_size)
        }
    } else {
        (0, file_size - 1, 200, file_size)
    };

    // Build response headers
    let headers = if status == 206 {
        format!(
            "HTTP/1.1 206 Partial Content\r\n\
             Content-Type: application/zip\r\n\
             Content-Length: {}\r\n\
             Content-Range: bytes {}-{}/{}\r\n\
             Content-Disposition: attachment; filename=\"{}\"\r\n\
             Accept-Ranges: bytes\r\n\
             Connection: close\r\n\r\n",
            content_length, start, end, file_size, filename
        )
    } else {
        format!(
            "HTTP/1.1 200 OK\r\n\
             Content-Type: application/zip\r\n\
             Content-Length: {}\r\n\
             Content-Disposition: attachment; filename=\"{}\"\r\n\
             Accept-Ranges: bytes\r\n\
             Connection: close\r\n\r\n",
            file_size, filename
        )
    };

    stream
        .write_all(headers.as_bytes())
        .await
        .map_err(|e| AppError::Io(format!("Write headers error: {}", e)))?;

    // Seek to start position
    if start > 0 {
        file.seek(SeekFrom::Start(start))
            .await
            .map_err(|e| AppError::Io(format!("Seek error: {}", e)))?;
    }

    // Stream the file
    let mut remaining = content_length;
    let mut buffer = vec![0u8; 64 * 1024]; // 64KB chunks
    let mut total_sent: u64 = 0;
    let mut bytes_since_last_emit: u64 = 0;
    const EMIT_INTERVAL_BYTES: u64 = 256 * 1024; // Emit event every 256KB

    while remaining > 0 {
        let to_read = (remaining as usize).min(buffer.len());
        let n = file
            .read(&mut buffer[..to_read])
            .await
            .map_err(|e| AppError::Io(format!("Read file error: {}", e)))?;

        if n == 0 {
            break;
        }

        stream
            .write_all(&buffer[..n])
            .await
            .map_err(|e| AppError::Io(format!("Write data error: {}", e)))?;

        remaining -= n as u64;
        total_sent += n as u64;
        bytes_since_last_emit += n as u64;

        // Update uploaded bytes and emit progress periodically
        if bytes_since_last_emit >= EMIT_INTERVAL_BYTES {
            let current_bytes = {
                let mut bytes = uploaded_bytes.write().await;
                *bytes += bytes_since_last_emit;
                *bytes
            };

            // Emit progress event
            let _ = app.emit(
                "share-download",
                ShareDownloadEvent {
                    share_id: share_id.to_string(),
                    download_count: *download_count.read().await,
                    uploaded_bytes: current_bytes,
                },
            );

            bytes_since_last_emit = 0;
        }
    }

    // Update remaining bytes that weren't emitted yet
    if bytes_since_last_emit > 0 {
        let mut bytes = uploaded_bytes.write().await;
        *bytes += bytes_since_last_emit;
    }

    // Count as download if we sent the whole file
    if start == 0 && total_sent >= file_size {
        let mut count = download_count.write().await;
        *count += 1;

        // Emit final download event
        let _ = app.emit(
            "share-download",
            ShareDownloadEvent {
                share_id: share_id.to_string(),
                download_count: *count,
                uploaded_bytes: *uploaded_bytes.read().await,
            },
        );

        info!(
            "[SHARE] Download #{} completed ({} bytes)",
            *count, total_sent
        );
    } else {
        // For partial downloads, still emit final stats
        let _ = app.emit(
            "share-download",
            ShareDownloadEvent {
                share_id: share_id.to_string(),
                download_count: *download_count.read().await,
                uploaded_bytes: *uploaded_bytes.read().await,
            },
        );
    }

    Ok(())
}

/// Serve file HEAD request
async fn serve_file_head(stream: &mut TcpStream, package_path: &Path) -> AppResult<()> {
    let metadata = tokio::fs::metadata(package_path)
        .await
        .map_err(|e| AppError::Io(format!("Failed to get metadata: {}", e)))?;

    let filename = package_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("instance.kaizen");

    let headers = format!(
        "HTTP/1.1 200 OK\r\n\
         Content-Type: application/zip\r\n\
         Content-Length: {}\r\n\
         Content-Disposition: attachment; filename=\"{}\"\r\n\
         Accept-Ranges: bytes\r\n\
         Connection: close\r\n\r\n",
        metadata.len(),
        filename
    );

    stream
        .write_all(headers.as_bytes())
        .await
        .map_err(|e| AppError::Io(format!("Write headers error: {}", e)))?;

    Ok(())
}

/// Serve the manifest JSON (for preview before download)
async fn serve_manifest(stream: &mut TcpStream, package_path: &Path) -> AppResult<()> {
    // Read manifest from ZIP
    let manifest = crate::sharing::import::validate_import_package(package_path).await?;
    let json = serde_json::to_string_pretty(&manifest)
        .map_err(|e| AppError::Custom(format!("JSON error: {}", e)))?;

    let headers = format!(
        "HTTP/1.1 200 OK\r\n\
         Content-Type: application/json\r\n\
         Content-Length: {}\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Connection: close\r\n\r\n",
        json.len()
    );

    stream
        .write_all(headers.as_bytes())
        .await
        .map_err(|e| AppError::Io(format!("Write headers error: {}", e)))?;

    stream
        .write_all(json.as_bytes())
        .await
        .map_err(|e| AppError::Io(format!("Write body error: {}", e)))?;

    Ok(())
}

/// Send a simple HTTP response
async fn send_response(
    stream: &mut TcpStream,
    status: u16,
    message: &str,
    body: Option<&str>,
) -> AppResult<()> {
    let body_content = body.unwrap_or(message);
    let response = format!(
        "HTTP/1.1 {} {}\r\n\
         Content-Type: text/plain\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n\r\n{}",
        status,
        message,
        body_content.len(),
        body_content
    );

    stream
        .write_all(response.as_bytes())
        .await
        .map_err(|e| AppError::Io(format!("Write response error: {}", e)))?;

    Ok(())
}

/// Start bore tunnel for the HTTP server
async fn start_bore_tunnel(
    data_dir: &Path,
    local_port: u16,
    share_id: String,
    app: AppHandle,
) -> AppResult<(u32, tokio::sync::broadcast::Receiver<String>)> {
    let binary_path = get_agent_binary_path(data_dir, TunnelProvider::Bore);

    if !binary_path.exists() {
        return Err(AppError::Custom(
            "Bore agent not installed. Please install it from the Tunnel settings.".to_string(),
        ));
    }

    info!("[SHARE] Starting bore tunnel for port {}...", local_port);

    let mut cmd = Command::new(&binary_path);
    cmd.args(["local", &local_port.to_string(), "--to", "bore.pub"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Io(format!("Failed to start bore: {}", e)))?;

    let pid = child.id().unwrap_or(0);
    info!("[SHARE] Bore started with PID: {}", pid);

    // Channel to send the public URL when found
    let (url_tx, url_rx) = tokio::sync::broadcast::channel::<String>(1);

    // Monitor stdout for URL
    if let Some(stdout) = child.stdout.take() {
        let share_id_clone = share_id.clone();
        let app_clone = app.clone();
        let url_tx_clone = url_tx.clone();

        tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();

            while let Ok(Some(line)) = lines.next_line().await {
                tokio::task::yield_now().await;
                debug!("[SHARE BORE] {}", line);

                // Check for URL in the line
                let found_url = if let Some(captures) = BORE_URL_REGEX.captures(&line) {
                    captures.get(1).map(|m| m.as_str().to_string())
                } else {
                    BORE_HOST_PORT_REGEX
                        .find(&line)
                        .map(|m| m.as_str().to_string())
                };

                if let Some(host_port) = found_url {
                    let public_url = format!("http://{}", host_port);
                    info!("[SHARE] Public URL: {}", public_url);

                    let _ = url_tx_clone.send(public_url.clone());

                    let _ = app_clone.emit(
                        "share-status",
                        ShareStatusEvent {
                            share_id: share_id_clone.clone(),
                            status: "connected".to_string(),
                            public_url: Some(public_url),
                            error: None,
                        },
                    );
                }

                // Check for errors
                if line.to_lowercase().contains("error") || line.to_lowercase().contains("failed") {
                    warn!("[SHARE BORE] Error: {}", line);
                    let _ = app_clone.emit(
                        "share-status",
                        ShareStatusEvent {
                            share_id: share_id_clone.clone(),
                            status: "error".to_string(),
                            public_url: None,
                            error: Some(line),
                        },
                    );
                }
            }
        });
    }

    // Monitor stderr
    if let Some(stderr) = child.stderr.take() {
        let share_id_clone = share_id.clone();
        let app_clone = app.clone();
        let url_tx_clone = url_tx;

        tokio::spawn(async move {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();

            while let Ok(Some(line)) = lines.next_line().await {
                tokio::task::yield_now().await;
                debug!("[SHARE BORE STDERR] {}", line);

                // Check for URL in stderr too
                let found_url = if let Some(captures) = BORE_URL_REGEX.captures(&line) {
                    captures.get(1).map(|m| m.as_str().to_string())
                } else {
                    BORE_HOST_PORT_REGEX
                        .find(&line)
                        .map(|m| m.as_str().to_string())
                };

                if let Some(host_port) = found_url {
                    let public_url = format!("http://{}", host_port);
                    let _ = url_tx_clone.send(public_url.clone());

                    let _ = app_clone.emit(
                        "share-status",
                        ShareStatusEvent {
                            share_id: share_id_clone.clone(),
                            status: "connected".to_string(),
                            public_url: Some(public_url),
                            error: None,
                        },
                    );
                }
            }
        });
    }

    // Wait for process exit in background
    let share_id_exit = share_id;
    let app_exit = app;
    tokio::spawn(async move {
        let _ = child.wait().await;
        info!("[SHARE] Bore tunnel exited");

        let _ = app_exit.emit(
            "share-status",
            ShareStatusEvent {
                share_id: share_id_exit,
                status: "disconnected".to_string(),
                public_url: None,
                error: None,
            },
        );
    });

    Ok((pid, url_rx))
}

/// Start cloudflare tunnel for the HTTP server (HTTPS)
async fn start_cloudflare_sharing_tunnel(
    data_dir: &Path,
    local_port: u16,
    share_id: String,
    app: AppHandle,
) -> AppResult<(u32, tokio::sync::broadcast::Receiver<String>)> {
    let binary_path = get_agent_binary_path(data_dir, TunnelProvider::Cloudflare);

    if !binary_path.exists() {
        return Err(AppError::Custom(
            "Cloudflare agent not installed. Please install it from the Tunnel settings."
                .to_string(),
        ));
    }

    info!(
        "[SHARE] Starting Cloudflare tunnel for port {}...",
        local_port
    );

    // Use HTTP URL for sharing (not TCP like for game servers)
    let mut cmd = Command::new(&binary_path);
    cmd.args([
        "tunnel",
        "--url",
        &format!("http://localhost:{}", local_port),
    ])
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Io(format!("Failed to start cloudflared: {}", e)))?;

    let pid = child.id().unwrap_or(0);
    info!("[SHARE] Cloudflare started with PID: {}", pid);

    // Channel to send the public URL when found
    let (url_tx, url_rx) = tokio::sync::broadcast::channel::<String>(1);

    // Cloudflare outputs URL to stderr
    if let Some(stderr) = child.stderr.take() {
        let share_id_clone = share_id.clone();
        let app_clone = app.clone();
        let url_tx_clone = url_tx.clone();

        tokio::spawn(async move {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();

            while let Ok(Some(line)) = lines.next_line().await {
                tokio::task::yield_now().await;
                debug!("[SHARE CLOUDFLARE] {}", line);

                // Check for URL in the line
                if let Some(captures) = CLOUDFLARE_URL_REGEX.find(&line) {
                    let url = captures.as_str().to_string();
                    info!("[SHARE] Cloudflare URL: {}", url);

                    let _ = url_tx_clone.send(url.clone());

                    let _ = app_clone.emit(
                        "share-status",
                        ShareStatusEvent {
                            share_id: share_id_clone.clone(),
                            status: "connected".to_string(),
                            public_url: Some(url),
                            error: None,
                        },
                    );
                }

                // Check for errors
                if line.to_lowercase().contains("error") || line.to_lowercase().contains("failed") {
                    warn!("[SHARE CLOUDFLARE] Error: {}", line);
                    let _ = app_clone.emit(
                        "share-status",
                        ShareStatusEvent {
                            share_id: share_id_clone.clone(),
                            status: "error".to_string(),
                            public_url: None,
                            error: Some(line),
                        },
                    );
                }
            }
        });
    }

    // Also capture stdout
    if let Some(stdout) = child.stdout.take() {
        let url_tx_clone = url_tx;
        let share_id_clone = share_id.clone();
        let app_clone = app.clone();

        tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();

            while let Ok(Some(line)) = lines.next_line().await {
                tokio::task::yield_now().await;
                debug!("[SHARE CLOUDFLARE STDOUT] {}", line);

                // Check for URL in stdout too (just in case)
                if let Some(captures) = CLOUDFLARE_URL_REGEX.find(&line) {
                    let url = captures.as_str().to_string();
                    let _ = url_tx_clone.send(url.clone());

                    let _ = app_clone.emit(
                        "share-status",
                        ShareStatusEvent {
                            share_id: share_id_clone.clone(),
                            status: "connected".to_string(),
                            public_url: Some(url),
                            error: None,
                        },
                    );
                }
            }
        });
    }

    // Wait for process exit in background
    let share_id_exit = share_id;
    let app_exit = app;
    tokio::spawn(async move {
        let _ = child.wait().await;
        info!("[SHARE] Cloudflare tunnel exited");

        let _ = app_exit.emit(
            "share-status",
            ShareStatusEvent {
                share_id: share_id_exit,
                status: "disconnected".to_string(),
                public_url: None,
                error: None,
            },
        );
    });

    Ok((pid, url_rx))
}

/// Start sharing an instance package
pub async fn start_share(
    data_dir: &Path,
    package_path: &Path,
    instance_name: &str,
    provider: SharingProvider,
    password: Option<String>,
    app: AppHandle,
    running_shares: RunningShares,
) -> AppResult<ActiveShare> {
    let share_id = uuid::Uuid::new_v4().to_string();

    // Generate cryptographically secure auth token
    let auth_token = generate_auth_token();
    info!("[SHARE] Generated auth token for share {}", share_id);

    // Hash password if provided
    let password_hash = password.as_ref().map(|p| {
        info!("[SHARE] Password protection enabled for share {}", share_id);
        hash_password(p, &share_id)
    });

    // Get file size
    let metadata = tokio::fs::metadata(package_path)
        .await
        .map_err(|e| AppError::Io(format!("Failed to get file metadata: {}", e)))?;

    // Find available port
    let port = find_available_port().await?;
    info!("[SHARE] Using port {} for share {}", port, share_id);

    // Create shutdown channel
    let (shutdown_tx, shutdown_rx) = tokio::sync::broadcast::channel(1);

    // Tracking stats
    let download_count = Arc::new(RwLock::new(0u32));
    let uploaded_bytes = Arc::new(RwLock::new(0u64));

    // Start HTTP server with auth token
    let server_path = package_path.to_path_buf();
    let server_share_id = share_id.clone();
    let server_auth_token = auth_token.clone();
    let server_password_hash = password_hash.clone();
    let server_app = app.clone();
    let server_download_count = download_count.clone();
    let server_uploaded_bytes = uploaded_bytes.clone();

    let server_handle = tokio::spawn(async move {
        if let Err(e) = start_http_server(
            server_path,
            port,
            server_share_id,
            server_auth_token,
            server_password_hash,
            server_app,
            shutdown_rx,
            server_download_count,
            server_uploaded_bytes,
        )
        .await
        {
            error!("[SHARE] HTTP server error: {}", e);
        }
    });

    // Start tunnel based on provider
    info!("[SHARE] Starting {:?} tunnel...", provider);
    let (tunnel_pid, mut url_rx) = match provider {
        SharingProvider::Bore => {
            start_bore_tunnel(data_dir, port, share_id.clone(), app.clone()).await?
        }
        SharingProvider::Cloudflare => {
            start_cloudflare_sharing_tunnel(data_dir, port, share_id.clone(), app.clone()).await?
        }
    };

    // Wait for public URL (with timeout)
    let base_url = tokio::time::timeout(std::time::Duration::from_secs(30), url_rx.recv())
        .await
        .ok()
        .and_then(|r| r.ok());

    if base_url.is_none() {
        warn!("[SHARE] Timeout waiting for public URL, tunnel may still be connecting");
    }

    // Append auth token to URL for security
    // Format: {base_url}/{token} (e.g., https://xxx.trycloudflare.com/abc123...)
    let public_url = base_url.map(|url| format!("{}/{}", url.trim_end_matches('/'), auth_token));

    info!("[SHARE] Share URL generated with auth token");

    let info = ActiveShare {
        share_id: share_id.clone(),
        instance_name: instance_name.to_string(),
        package_path: package_path.to_string_lossy().to_string(),
        local_port: port,
        public_url,
        download_count: 0,
        uploaded_bytes: 0,
        started_at: chrono::Utc::now().to_rfc3339(),
        file_size: metadata.len(),
        provider,
        has_password: password_hash.is_some(),
        auth_token,
        password_hash,
    };

    // Store session with live stat trackers
    {
        let mut shares = running_shares.write().await;
        shares.insert(
            share_id,
            ShareSession {
                info: info.clone(),
                server_handle,
                tunnel_pid: Some(tunnel_pid),
                shutdown_tx,
                download_count,
                uploaded_bytes,
            },
        );
    }

    // Emit status
    let _ = app.emit(
        "share-status",
        ShareStatusEvent {
            share_id: info.share_id.clone(),
            status: if info.public_url.is_some() {
                "connected"
            } else {
                "connecting"
            }
            .to_string(),
            public_url: info.public_url.clone(),
            error: None,
        },
    );

    Ok(info)
}

/// Start sharing with an existing password hash (for restoring shares)
/// This is used when restoring shares from the database where we already have the password hash
pub async fn start_share_with_password_hash(
    data_dir: &Path,
    package_path: &Path,
    instance_name: &str,
    provider: SharingProvider,
    password_hash: Option<String>,
    app: AppHandle,
    running_shares: RunningShares,
) -> AppResult<ActiveShare> {
    let share_id = uuid::Uuid::new_v4().to_string();

    // Generate new auth token (URL will be different)
    let auth_token = generate_auth_token();
    info!(
        "[SHARE] Generated auth token for restored share {}",
        share_id
    );

    if password_hash.is_some() {
        info!("[SHARE] Restoring password-protected share {}", share_id);
    }

    // Get file size
    let metadata = tokio::fs::metadata(package_path)
        .await
        .map_err(|e| AppError::Io(format!("Failed to get file metadata: {}", e)))?;

    // Find available port
    let port = find_available_port().await?;
    info!(
        "[SHARE] Using port {} for restored share {}",
        port, share_id
    );

    // Create shutdown channel
    let (shutdown_tx, shutdown_rx) = tokio::sync::broadcast::channel(1);

    // Tracking stats
    let download_count = Arc::new(RwLock::new(0u32));
    let uploaded_bytes = Arc::new(RwLock::new(0u64));

    // Start HTTP server with auth token
    let server_path = package_path.to_path_buf();
    let server_share_id = share_id.clone();
    let server_auth_token = auth_token.clone();
    let server_password_hash = password_hash.clone();
    let server_app = app.clone();
    let server_download_count = download_count.clone();
    let server_uploaded_bytes = uploaded_bytes.clone();

    let server_handle = tokio::spawn(async move {
        if let Err(e) = start_http_server(
            server_path,
            port,
            server_share_id,
            server_auth_token,
            server_password_hash,
            server_app,
            shutdown_rx,
            server_download_count,
            server_uploaded_bytes,
        )
        .await
        {
            error!("[SHARE] HTTP server error: {}", e);
        }
    });

    // Start tunnel based on provider
    info!(
        "[SHARE] Starting {:?} tunnel for restored share...",
        provider
    );
    let (tunnel_pid, mut url_rx) = match provider {
        SharingProvider::Bore => {
            start_bore_tunnel(data_dir, port, share_id.clone(), app.clone()).await?
        }
        SharingProvider::Cloudflare => {
            start_cloudflare_sharing_tunnel(data_dir, port, share_id.clone(), app.clone()).await?
        }
    };

    // Wait for public URL (with timeout)
    let base_url = tokio::time::timeout(std::time::Duration::from_secs(30), url_rx.recv())
        .await
        .ok()
        .and_then(|r| r.ok());

    if base_url.is_none() {
        warn!("[SHARE] Timeout waiting for public URL, tunnel may still be connecting");
    }

    // Append auth token to URL for security
    let public_url = base_url.map(|url| format!("{}/{}", url.trim_end_matches('/'), auth_token));

    info!("[SHARE] Restored share URL generated with auth token");

    let info = ActiveShare {
        share_id: share_id.clone(),
        instance_name: instance_name.to_string(),
        package_path: package_path.to_string_lossy().to_string(),
        local_port: port,
        public_url,
        download_count: 0,
        uploaded_bytes: 0,
        started_at: chrono::Utc::now().to_rfc3339(),
        file_size: metadata.len(),
        provider,
        has_password: password_hash.is_some(),
        auth_token,
        password_hash,
    };

    // Store session with live stat trackers
    {
        let mut shares = running_shares.write().await;
        shares.insert(
            share_id,
            ShareSession {
                info: info.clone(),
                server_handle,
                tunnel_pid: Some(tunnel_pid),
                shutdown_tx,
                download_count,
                uploaded_bytes,
            },
        );
    }

    // Emit status
    let _ = app.emit(
        "share-status",
        ShareStatusEvent {
            share_id: info.share_id.clone(),
            status: if info.public_url.is_some() {
                "connected"
            } else {
                "connecting"
            }
            .to_string(),
            public_url: info.public_url.clone(),
            error: None,
        },
    );

    Ok(info)
}

/// Stop a share session
pub async fn stop_share(share_id: &str, running_shares: RunningShares) -> AppResult<()> {
    let session = {
        let mut shares = running_shares.write().await;
        shares.remove(share_id)
    };

    if let Some(session) = session {
        info!("[SHARE] Stopping share {}", share_id);

        // Send shutdown signal
        let _ = session.shutdown_tx.send(());

        // Kill tunnel process
        if let Some(pid) = session.tunnel_pid {
            #[cfg(unix)]
            {
                use std::process::Command;
                let _ = Command::new("kill")
                    .args(["-TERM", &pid.to_string()])
                    .status();
            }

            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                use std::process::Command;

                let mut cmd = Command::new("taskkill");
                cmd.args(["/PID", &pid.to_string(), "/F"]);
                cmd.creation_flags(CREATE_NO_WINDOW);
                let _ = cmd.status();
            }
        }

        // Abort server task
        session.server_handle.abort();

        Ok(())
    } else {
        Err(AppError::Custom(format!("Share {} not found", share_id)))
    }
}

/// Get all active shares with live stats
pub async fn get_active_shares(running_shares: RunningShares) -> Vec<ActiveShare> {
    let shares = running_shares.read().await;
    let mut result = Vec::with_capacity(shares.len());

    for session in shares.values() {
        let mut info = session.info.clone();
        // Read live stats from trackers
        info.download_count = *session.download_count.read().await;
        info.uploaded_bytes = *session.uploaded_bytes.read().await;
        result.push(info);
    }

    result
}

/// Stop all shares
pub async fn stop_all_shares(running_shares: RunningShares) {
    let share_ids: Vec<String> = {
        let shares = running_shares.read().await;
        shares.keys().cloned().collect()
    };

    for share_id in share_ids {
        let _ = stop_share(&share_id, running_shares.clone()).await;
    }
}
