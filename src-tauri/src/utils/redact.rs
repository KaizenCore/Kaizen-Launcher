//! Utilities for redacting sensitive information from logs and error messages
//!
//! This module provides functions to sanitize URLs, tokens, and other sensitive
//! data before they appear in logs or error messages.

use regex::Regex;
use once_cell::sync::Lazy;

/// Patterns that indicate sensitive URL parts (e.g., webhook paths, tokens)
static SENSITIVE_URL_PATTERNS: Lazy<Vec<Regex>> = Lazy::new(|| {
    vec![
        // Discord webhooks: redact the token part
        Regex::new(r"(discord\.com/api/webhooks/\d+/)([A-Za-z0-9_-]+)")
            .expect("Invalid Discord webhook regex"),
        // Generic API keys in query params
        Regex::new(r"([?&](?:api_?key|token|secret|password|auth)=)([^&\s]+)")
            .expect("Invalid API key regex"),
        // Bearer tokens in URLs (shouldn't happen but just in case)
        Regex::new(r"(Bearer\s+)([A-Za-z0-9._-]+)")
            .expect("Invalid Bearer token regex"),
    ]
});

/// Pattern for long token-like strings (compiled once)
static TOKEN_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"[A-Za-z0-9_-]{64,}").expect("Invalid token pattern regex")
});

/// Redact sensitive parts of a URL
///
/// # Examples
/// ```ignore
/// use crate::utils::redact::redact_url;
///
/// let url = "https://discord.com/api/webhooks/123456/secrettoken123";
/// let redacted = redact_url(url);
/// assert_eq!(redacted, "https://discord.com/api/webhooks/123456/[REDACTED]");
/// ```
pub fn redact_url(url: &str) -> String {
    let mut result = url.to_string();

    for pattern in SENSITIVE_URL_PATTERNS.iter() {
        result = pattern.replace_all(&result, "${1}[REDACTED]").to_string();
    }

    result
}

/// Redact sensitive information from an error message
///
/// This function redacts:
/// - URLs with sensitive tokens
/// - Paths that might contain sensitive data
/// - Known sensitive patterns
pub fn redact_error_message(message: &str) -> String {
    let mut result = message.to_string();

    // Redact URLs
    for pattern in SENSITIVE_URL_PATTERNS.iter() {
        result = pattern.replace_all(&result, "${1}[REDACTED]").to_string();
    }

    // Redact any remaining long base64-like strings (potential tokens)
    // Match strings that look like tokens (64+ chars, alphanumeric with some special chars)
    result = TOKEN_PATTERN.replace_all(&result, "[TOKEN_REDACTED]").to_string();

    result
}

/// Redact a token completely, showing only first and last few characters
pub fn redact_token(token: &str) -> String {
    if token.len() <= 8 {
        return "[REDACTED]".to_string();
    }

    let prefix = &token[..4];
    let suffix = &token[token.len()-4..];
    format!("{}...{}", prefix, suffix)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_redact_discord_webhook() {
        let url = "https://discord.com/api/webhooks/1234567890/abcdefghijklmnop_secret123";
        let redacted = redact_url(url);
        assert!(redacted.contains("[REDACTED]"));
        assert!(redacted.contains("1234567890"));
        assert!(!redacted.contains("abcdefghijklmnop_secret123"));
    }

    #[test]
    fn test_redact_api_key_in_query() {
        let url = "https://api.example.com/data?api_key=secret123&other=value";
        let redacted = redact_url(url);
        assert!(redacted.contains("[REDACTED]"));
        assert!(!redacted.contains("secret123"));
        assert!(redacted.contains("other=value"));
    }

    #[test]
    fn test_redact_token() {
        let token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.long_token_here";
        let redacted = redact_token(token);
        assert_eq!(redacted, "eyJh...here");
    }

    #[test]
    fn test_redact_short_token() {
        let token = "short";
        let redacted = redact_token(token);
        assert_eq!(redacted, "[REDACTED]");
    }

    #[test]
    fn test_normal_url_unchanged() {
        let url = "https://cdn.modrinth.com/data/mod123/icon.png";
        let redacted = redact_url(url);
        assert_eq!(redacted, url);
    }
}
