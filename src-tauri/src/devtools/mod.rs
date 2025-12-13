pub mod bug_report;
pub mod commands;
pub mod log_buffer;

use once_cell::sync::Lazy;
use serde::Serialize;
use std::sync::Mutex;
use sysinfo::{Pid, System};

use crate::error::AppResult;

// Re-export types used by lib.rs for log integration
pub use log_buffer::{push_log, LogEntry};

/// Cached System instance for performance monitoring
static SYSTEM: Lazy<Mutex<System>> = Lazy::new(|| {
    let mut sys = System::new_all();
    sys.refresh_all();
    Mutex::new(sys)
});

#[derive(Debug, Serialize)]
pub struct AppMetrics {
    /// CPU usage percentage (0-100)
    pub cpu_usage: f32,
    /// Memory usage in bytes
    pub memory_bytes: u64,
    /// Memory usage in MB (formatted)
    pub memory_mb: f64,
    /// Number of threads
    pub thread_count: usize,
    /// Process uptime in seconds
    pub uptime_secs: u64,
    /// Total system memory in bytes
    pub total_memory: u64,
    /// Available system memory in bytes
    pub available_memory: u64,
    /// System CPU usage percentage
    pub system_cpu_usage: f32,
}

#[tauri::command]
pub async fn get_app_metrics() -> AppResult<AppMetrics> {
    let mut sys = SYSTEM
        .lock()
        .map_err(|e| crate::error::AppError::Custom(format!("Failed to acquire system lock: {}", e)))?;

    // Refresh only what we need
    sys.refresh_cpu_all();
    sys.refresh_memory();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

    let pid = Pid::from_u32(std::process::id());

    let (cpu_usage, memory_bytes, thread_count, uptime_secs) =
        if let Some(process) = sys.process(pid) {
            (
                process.cpu_usage(),
                process.memory(),
                // sysinfo doesn't provide thread count directly on all platforms
                // We'll use a workaround
                get_thread_count(),
                process.run_time(),
            )
        } else {
            (0.0, 0, 0, 0)
        };

    // Calculate system CPU usage (average of all CPUs)
    let system_cpu_usage =
        sys.cpus().iter().map(|cpu| cpu.cpu_usage()).sum::<f32>() / sys.cpus().len() as f32;

    Ok(AppMetrics {
        cpu_usage,
        memory_bytes,
        memory_mb: memory_bytes as f64 / 1024.0 / 1024.0,
        thread_count,
        uptime_secs,
        total_memory: sys.total_memory(),
        available_memory: sys.available_memory(),
        system_cpu_usage,
    })
}

/// Get thread count for current process
#[allow(deprecated)] // mach_task_self is deprecated in libc but still works
fn get_thread_count() -> usize {
    #[cfg(target_os = "macos")]
    {
        // On macOS, use mach APIs
        unsafe {
            let task = libc::mach_task_self();
            let mut thread_list: libc::thread_act_array_t = std::ptr::null_mut();
            let mut thread_count: libc::mach_msg_type_number_t = 0;

            if libc::task_threads(task, &mut thread_list, &mut thread_count) == 0 {
                // Deallocate the thread list
                if !thread_list.is_null() {
                    libc::vm_deallocate(
                        task,
                        thread_list as libc::vm_address_t,
                        (thread_count as usize * std::mem::size_of::<libc::thread_act_t>())
                            as libc::vm_size_t,
                    );
                }
                return thread_count as usize;
            }
        }
        0
    }

    #[cfg(target_os = "linux")]
    {
        // On Linux, count entries in /proc/self/task
        std::fs::read_dir("/proc/self/task")
            .map(|entries| entries.count())
            .unwrap_or(0)
    }

    #[cfg(target_os = "windows")]
    {
        // On Windows, we'd need to use Windows APIs
        // For simplicity, return 0 (can be improved later)
        0
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        0
    }
}

#[tauri::command]
pub fn is_dev_mode() -> bool {
    cfg!(debug_assertions)
}
