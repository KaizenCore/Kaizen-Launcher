//! In-memory ring buffer for capturing logs
//! Used for bug reports and real-time log viewing

use serde::Serialize;
use std::collections::VecDeque;
use std::sync::Mutex;

/// Maximum number of log entries to keep in memory
const MAX_LOG_ENTRIES: usize = 1000;

/// A single log entry
#[derive(Debug, Clone, Serialize)]
pub struct LogEntry {
    pub timestamp: String,
    pub level: String,
    pub target: String,
    pub message: String,
}

/// Global log buffer - thread-safe ring buffer
static LOG_BUFFER: std::sync::LazyLock<Mutex<VecDeque<LogEntry>>> =
    std::sync::LazyLock::new(|| Mutex::new(VecDeque::with_capacity(MAX_LOG_ENTRIES)));

/// Push a new log entry into the buffer
/// Old entries are automatically removed when buffer is full
pub fn push_log(entry: LogEntry) {
    if let Ok(mut buffer) = LOG_BUFFER.lock() {
        if buffer.len() >= MAX_LOG_ENTRIES {
            buffer.pop_front();
        }
        buffer.push_back(entry);
    }
}

/// Get the most recent log entries
/// Returns entries in chronological order (oldest first)
pub fn get_recent_logs(count: usize) -> Vec<LogEntry> {
    if let Ok(buffer) = LOG_BUFFER.lock() {
        let start = buffer.len().saturating_sub(count);
        buffer.iter().skip(start).cloned().collect()
    } else {
        Vec::new()
    }
}

/// Clear all logs from the buffer
pub fn clear_logs() {
    if let Ok(mut buffer) = LOG_BUFFER.lock() {
        buffer.clear();
    }
}

/// Get the current number of logs in the buffer
#[allow(dead_code)]
pub fn log_count() -> usize {
    if let Ok(buffer) = LOG_BUFFER.lock() {
        buffer.len()
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_entry(msg: &str) -> LogEntry {
        LogEntry {
            timestamp: "2024-01-01T00:00:00Z".to_string(),
            level: "INFO".to_string(),
            target: "test".to_string(),
            message: msg.to_string(),
        }
    }

    #[test]
    fn test_push_and_get() {
        clear_logs();

        push_log(create_test_entry("test1"));
        push_log(create_test_entry("test2"));
        push_log(create_test_entry("test3"));

        let logs = get_recent_logs(10);
        assert_eq!(logs.len(), 3);
        assert_eq!(logs[0].message, "test1");
        assert_eq!(logs[2].message, "test3");

        clear_logs();
    }

    #[test]
    fn test_get_limited() {
        clear_logs();

        for i in 0..10 {
            push_log(create_test_entry(&format!("msg{}", i)));
        }

        let logs = get_recent_logs(3);
        assert_eq!(logs.len(), 3);
        assert_eq!(logs[0].message, "msg7");
        assert_eq!(logs[2].message, "msg9");

        clear_logs();
    }

    #[test]
    fn test_clear() {
        clear_logs();

        push_log(create_test_entry("test"));
        assert_eq!(log_count(), 1);

        clear_logs();
        assert_eq!(log_count(), 0);
    }
}
