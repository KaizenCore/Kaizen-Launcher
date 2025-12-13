import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

interface SystemInfo {
  app_version: string;
  os: string;
  os_version: string;
  arch: string;
  total_memory_mb: number;
  available_memory_mb: number;
  active_instances: Array<{
    name: string;
    mc_version: string;
    loader: string | null;
    is_running: boolean;
  }>;
}

interface LogEntry {
  timestamp: string;
  level: string;
  target: string;
  message: string;
}

interface DevModeState {
  // State
  enabled: boolean;
  webhookUrl: string | null;
  loading: boolean;
  error: string | null;

  // Actions
  load: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  setWebhookUrl: (url: string | null) => Promise<void>;
  testWebhook: () => Promise<boolean>;
  getSystemInfo: () => Promise<SystemInfo>;
  getRecentLogs: (count?: number) => Promise<LogEntry[]>;
  clearLogs: () => Promise<void>;
  submitBugReport: (
    message: string | null,
    screenshot: string | null,
    includeLogs?: boolean
  ) => Promise<void>;
  openLogViewer: () => Promise<void>;
}

export const useDevModeStore = create<DevModeState>((set) => ({
  enabled: false,
  webhookUrl: null,
  loading: true,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const [enabled, webhookUrl] = await Promise.all([
        invoke<boolean>("get_dev_mode_enabled"),
        invoke<string | null>("get_bug_report_webhook"),
      ]);
      set({ enabled, webhookUrl, loading: false });
    } catch (error) {
      console.error("Failed to load dev mode settings:", error);
      set({
        loading: false,
        error: error instanceof Error ? error.message : "Failed to load settings",
      });
    }
  },

  setEnabled: async (enabled: boolean) => {
    try {
      await invoke("set_dev_mode_enabled", { enabled });
      set({ enabled });
    } catch (error) {
      console.error("Failed to set dev mode:", error);
      throw error;
    }
  },

  setWebhookUrl: async (url: string | null) => {
    try {
      await invoke("set_bug_report_webhook", { url });
      set({ webhookUrl: url });
    } catch (error) {
      console.error("Failed to set webhook URL:", error);
      throw error;
    }
  },

  testWebhook: async () => {
    try {
      await invoke("test_bug_report_webhook");
      return true;
    } catch (error) {
      console.error("Webhook test failed:", error);
      return false;
    }
  },

  getSystemInfo: async () => {
    return await invoke<SystemInfo>("get_system_info_for_report");
  },

  getRecentLogs: async (count = 100) => {
    return await invoke<LogEntry[]>("get_recent_logs", { count });
  },

  clearLogs: async () => {
    await invoke("clear_log_buffer");
  },

  submitBugReport: async (
    userMessage: string | null,
    screenshotBase64: string | null,
    includeLogs = true
  ) => {
    await invoke("submit_bug_report", {
      userMessage,
      screenshotBase64,
      includeLogs,
    });
  },

  openLogViewer: async () => {
    await invoke("open_log_viewer_window");
  },
}));

// Type exports for use in components
export type { SystemInfo, LogEntry };
