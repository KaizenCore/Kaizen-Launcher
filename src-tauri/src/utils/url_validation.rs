//! URL validation utilities for SSRF protection
//!
//! This module provides utilities to validate URLs before making HTTP requests,
//! blocking access to private IP ranges, localhost, and other potentially dangerous targets.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, ToSocketAddrs};
use url::Url;

/// List of allowed domains for icon downloads
/// These are trusted CDN/API domains that we expect icons to come from
const ALLOWED_ICON_DOMAINS: &[&str] = &[
    "cdn.modrinth.com",
    "github.com",
    "raw.githubusercontent.com",
    "avatars.githubusercontent.com",
    "i.imgur.com",
    "imgur.com",
    "media.forgecdn.net",
    "crafatar.com",
    "mc-heads.net",
    "minotar.net",
    "cravatar.eu",
];

/// Check if an IP address is in a private/reserved range
fn is_private_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(ipv4) => is_private_ipv4(ipv4),
        IpAddr::V6(ipv6) => is_private_ipv6(ipv6),
    }
}

/// Check if an IPv4 address is private or reserved
fn is_private_ipv4(ip: &Ipv4Addr) -> bool {
    // Loopback (127.0.0.0/8)
    if ip.is_loopback() {
        return true;
    }

    // Private networks
    // 10.0.0.0/8
    if ip.octets()[0] == 10 {
        return true;
    }

    // 172.16.0.0/12
    if ip.octets()[0] == 172 && (16..=31).contains(&ip.octets()[1]) {
        return true;
    }

    // 192.168.0.0/16
    if ip.octets()[0] == 192 && ip.octets()[1] == 168 {
        return true;
    }

    // Link-local (169.254.0.0/16)
    if ip.is_link_local() {
        return true;
    }

    // Broadcast
    if ip.is_broadcast() {
        return true;
    }

    // Documentation ranges (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24)
    let octets = ip.octets();
    if (octets[0] == 192 && octets[1] == 0 && octets[2] == 2)
        || (octets[0] == 198 && octets[1] == 51 && octets[2] == 100)
        || (octets[0] == 203 && octets[1] == 0 && octets[2] == 113)
    {
        return true;
    }

    // AWS metadata service
    if octets[0] == 169 && octets[1] == 254 && octets[2] == 169 && octets[3] == 254 {
        return true;
    }

    // Current network (0.0.0.0/8)
    if octets[0] == 0 {
        return true;
    }

    // Shared address space (100.64.0.0/10) - used by ISPs for CGN
    if octets[0] == 100 && (64..=127).contains(&octets[1]) {
        return true;
    }

    false
}

/// Check if an IPv6 address is private or reserved
fn is_private_ipv6(ip: &Ipv6Addr) -> bool {
    // Loopback (::1)
    if ip.is_loopback() {
        return true;
    }

    // Unspecified (::)
    if ip.is_unspecified() {
        return true;
    }

    // Link-local (fe80::/10)
    let segments = ip.segments();
    if (segments[0] & 0xffc0) == 0xfe80 {
        return true;
    }

    // Unique local (fc00::/7)
    if (segments[0] & 0xfe00) == 0xfc00 {
        return true;
    }

    // IPv4-mapped IPv6 addresses - check if the mapped IPv4 is private
    if let Some(ipv4) = ip.to_ipv4_mapped() {
        return is_private_ipv4(&ipv4);
    }

    false
}

/// Validate a URL for safe HTTP requests (SSRF protection)
///
/// This function performs the following checks:
/// 1. URL must use HTTP or HTTPS scheme
/// 2. URL must have a valid host
/// 3. Host must resolve to a non-private IP address
/// 4. Host must be in the allowed domains list (if strict mode is enabled)
///
/// # Arguments
/// * `url_str` - The URL to validate
/// * `strict_domain_check` - If true, only allow URLs from ALLOWED_ICON_DOMAINS
///
/// # Returns
/// * `Ok(Url)` - The parsed URL if valid
/// * `Err(String)` - Error message describing why validation failed
pub fn validate_url_for_ssrf(url_str: &str, strict_domain_check: bool) -> Result<Url, String> {
    // Parse URL
    let url = Url::parse(url_str).map_err(|e| format!("Invalid URL: {}", e))?;

    // Check scheme - HTTPS only for security (prevents MITM attacks)
    match url.scheme() {
        "https" => {}
        "http" => return Err("HTTP is not allowed. Use HTTPS for secure connections".to_string()),
        scheme => return Err(format!("Invalid URL scheme: {}. Only HTTPS allowed", scheme)),
    }

    // Get host
    let host = url.host_str().ok_or("URL has no host")?;

    // Block common localhost variants
    let host_lower = host.to_lowercase();
    if host_lower == "localhost"
        || host_lower == "127.0.0.1"
        || host_lower == "::1"
        || host_lower == "[::1]"
        || host_lower == "0.0.0.0"
        || host_lower.ends_with(".localhost")
        || host_lower.ends_with(".local")
    {
        return Err("Access to localhost is not allowed".to_string());
    }

    // If strict domain check is enabled, verify against allowed list
    if strict_domain_check {
        let is_allowed = ALLOWED_ICON_DOMAINS.iter().any(|&allowed| {
            host_lower == allowed || host_lower.ends_with(&format!(".{}", allowed))
        });

        if !is_allowed {
            return Err(format!(
                "Domain '{}' is not in the allowed list for icon downloads",
                host
            ));
        }
    }

    // Resolve hostname and check for private IPs (HTTPS only, default port 443)
    let port = url.port().unwrap_or(443);
    let socket_addrs: Vec<_> = format!("{}:{}", host, port)
        .to_socket_addrs()
        .map_err(|e| format!("Failed to resolve hostname '{}': {}", host, e))?
        .collect();

    if socket_addrs.is_empty() {
        return Err(format!("Could not resolve hostname '{}'", host));
    }

    // Check all resolved IPs - if ANY is private, block the request
    for addr in &socket_addrs {
        if is_private_ip(&addr.ip()) {
            return Err(format!(
                "URL resolves to private/reserved IP address: {}",
                addr.ip()
            ));
        }
    }

    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_http_blocked() {
        // HTTP should always be rejected (security: MITM protection)
        assert!(validate_url_for_ssrf("http://example.com/icon.png", false).is_err());
        assert!(validate_url_for_ssrf("http://cdn.modrinth.com/icon.png", true).is_err());
    }

    #[test]
    fn test_localhost_blocked() {
        assert!(validate_url_for_ssrf("https://localhost/icon.png", false).is_err());
        assert!(validate_url_for_ssrf("https://127.0.0.1/icon.png", false).is_err());
        assert!(validate_url_for_ssrf("https://[::1]/icon.png", false).is_err());
        assert!(validate_url_for_ssrf("https://0.0.0.0/icon.png", false).is_err());
    }

    #[test]
    fn test_private_ip_blocked() {
        // These would fail at DNS resolution in practice, but the hostname check catches them
        assert!(validate_url_for_ssrf("https://10.0.0.1/icon.png", false).is_err());
        assert!(validate_url_for_ssrf("https://192.168.1.1/icon.png", false).is_err());
        assert!(validate_url_for_ssrf("https://172.16.0.1/icon.png", false).is_err());
    }

    #[test]
    fn test_invalid_scheme_blocked() {
        assert!(validate_url_for_ssrf("file:///etc/passwd", false).is_err());
        assert!(validate_url_for_ssrf("ftp://example.com/file", false).is_err());
        assert!(validate_url_for_ssrf("javascript:alert(1)", false).is_err());
    }

    #[test]
    fn test_allowed_domains() {
        // With strict check, only allowed domains work (HTTPS only)
        assert!(validate_url_for_ssrf("https://cdn.modrinth.com/icon.png", true).is_ok());
        assert!(validate_url_for_ssrf("https://raw.githubusercontent.com/icon.png", true).is_ok());

        // Unknown domains should fail with strict check
        assert!(validate_url_for_ssrf("https://evil.com/icon.png", true).is_err());
    }
}
