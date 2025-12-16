use serde::Serialize;
use std::time::Duration;
use tokio::net::TcpStream;
use tokio::time::timeout;
use tracing::{debug, info, warn};

/// Default bore servers to try (in order of priority)
pub const DEFAULT_BORE_SERVERS: &[&str] = &[
    "bore.pub",
    "bore.digital",
];

/// Result of a health check
#[derive(Debug, Clone, Serialize)]
pub struct HealthCheckResult {
    pub server: String,
    pub reachable: bool,
    pub latency_ms: Option<u64>,
    pub error: Option<String>,
}

/// Check if a bore server is reachable via TCP
///
/// # Arguments
/// * `server` - The bore server hostname (e.g., "bore.pub")
/// * `timeout_secs` - Connection timeout in seconds
///
/// # Returns
/// HealthCheckResult with reachability status and latency
pub async fn check_bore_server_health(server: &str, timeout_secs: u64) -> HealthCheckResult {
    let port = 2200; // Bore's default control port
    let addr = format!("{}:{}", server, port);

    debug!("[HEALTH] Checking bore server: {}", addr);

    let start = std::time::Instant::now();

    match timeout(
        Duration::from_secs(timeout_secs),
        TcpStream::connect(&addr),
    ).await {
        Ok(Ok(_stream)) => {
            let latency = start.elapsed().as_millis() as u64;
            info!("[HEALTH] {} is reachable ({}ms)", server, latency);
            HealthCheckResult {
                server: server.to_string(),
                reachable: true,
                latency_ms: Some(latency),
                error: None,
            }
        }
        Ok(Err(e)) => {
            warn!("[HEALTH] {} connection failed: {}", server, e);
            HealthCheckResult {
                server: server.to_string(),
                reachable: false,
                latency_ms: None,
                error: Some(e.to_string()),
            }
        }
        Err(_) => {
            warn!("[HEALTH] {} connection timed out after {}s", server, timeout_secs);
            HealthCheckResult {
                server: server.to_string(),
                reachable: false,
                latency_ms: None,
                error: Some(format!("Connection timed out after {}s", timeout_secs)),
            }
        }
    }
}

/// Find the first available bore server from a list
///
/// # Arguments
/// * `servers` - List of bore servers to check (in order of priority)
/// * `timeout_secs` - Connection timeout per server in seconds
/// * `max_retries` - Maximum retries per server
///
/// # Returns
/// The first reachable server hostname, or None if all failed
pub async fn find_available_bore_server(
    servers: &[String],
    timeout_secs: u64,
    max_retries: u32,
) -> Option<String> {
    for server in servers {
        info!("[HEALTH] Trying bore server: {}", server);

        for attempt in 1..=max_retries {
            let result = check_bore_server_health(server, timeout_secs).await;

            if result.reachable {
                info!("[HEALTH] Found available server: {} (attempt {})", server, attempt);
                return Some(server.clone());
            }

            if attempt < max_retries {
                debug!("[HEALTH] Retry {}/{} for {}", attempt, max_retries, server);
                // Small delay between retries
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
        }

        warn!("[HEALTH] Server {} failed after {} attempts", server, max_retries);
    }

    warn!("[HEALTH] No available bore servers found");
    None
}

/// Check health of all provided bore servers
///
/// # Arguments
/// * `servers` - List of bore servers to check
/// * `timeout_secs` - Connection timeout per server
///
/// # Returns
/// Vector of health check results for all servers
pub async fn check_all_bore_servers(
    servers: &[String],
    timeout_secs: u64,
) -> Vec<HealthCheckResult> {
    let mut results = Vec::with_capacity(servers.len());

    for server in servers {
        let result = check_bore_server_health(server, timeout_secs).await;
        results.push(result);
    }

    results
}

/// Get the default bore servers as a Vec<String>
pub fn get_default_bore_servers() -> Vec<String> {
    DEFAULT_BORE_SERVERS.iter().map(|s| s.to_string()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_servers() {
        let servers = get_default_bore_servers();
        assert!(!servers.is_empty());
        assert!(servers.contains(&"bore.pub".to_string()));
    }
}
