import { useState, useEffect, useCallback } from "react";
import { check, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";

export interface UpdateInfo {
  version: string;
  date?: string;
  body?: string;
  isStableVersion: boolean; // true if version ends in .0 (e.g., 0.5.0)
  isMajorUpdate: boolean;   // true if major/minor version changed (0.4.x → 0.5.x)
}

/**
 * Parse version string into [major, minor, patch]
 * e.g., "0.4.1" → [0, 4, 1]
 */
function parseVersion(version: string): [number, number, number] {
  const clean = version.replace(/^v/, "");
  const parts = clean.split(".").map(Number);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

/**
 * Check if version is stable (ends in .0)
 * e.g., "0.5.0" → true, "0.5.1" → false
 */
function isStable(version: string): boolean {
  const [, , patch] = parseVersion(version);
  return patch === 0;
}

/**
 * Check if this is a major update (major or minor version changed)
 * e.g., "0.4.0" → "0.5.0" = true (minor changed)
 * e.g., "0.4.0" → "0.4.1" = false (only patch changed)
 */
function isMajorUpdate(currentVersion: string, newVersion: string): boolean {
  const [curMajor, curMinor] = parseVersion(currentVersion);
  const [newMajor, newMinor] = parseVersion(newVersion);
  return newMajor > curMajor || newMinor > curMinor;
}

export interface UseUpdateCheckerReturn {
  checking: boolean;
  updateAvailable: boolean;
  updateInfo: UpdateInfo | null;
  downloadProgress: number;
  installing: boolean;
  error: string | null;
  checkForUpdates: () => Promise<void>;
  manualCheckForUpdates: () => Promise<void>; // Shows ALL updates (including dev builds)
  downloadAndInstall: () => Promise<void>;
  dismissUpdate: () => void;
}

export function useUpdateChecker(autoCheck = true): UseUpdateCheckerReturn {
  const [checking, setChecking] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [update, setUpdate] = useState<Update | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const checkForUpdates = useCallback(async () => {
    setChecking(true);
    setError(null);
    setDismissed(false);

    try {
      const result = await check();

      if (result) {
        // Get current app version
        const currentVersion = await getVersion();
        const newVersion = result.version;

        // Check if this is a major update (0.4.x → 0.5.x)
        const isMajor = isMajorUpdate(currentVersion, newVersion);
        const isStableVer = isStable(newVersion);

        setUpdate(result);
        setUpdateInfo({
          version: newVersion,
          date: result.date,
          body: result.body,
          isStableVersion: isStableVer,
          isMajorUpdate: isMajor,
        });

        // Auto-prompt only for major/minor version changes (0.4.x → 0.5.x)
        // Dev builds (patch versions) can be installed manually via Settings
        setUpdateAvailable(isMajor);

        console.log(`[Update] Current: ${currentVersion} → New: ${newVersion} | Major: ${isMajor} | Stable: ${isStableVer}`);
      } else {
        setUpdateAvailable(false);
        setUpdateInfo(null);
      }
    } catch (err) {
      console.error("Failed to check for updates:", err);
      setError(err instanceof Error ? err.message : "Failed to check for updates");
    } finally {
      setChecking(false);
    }
  }, []);

  // Manual check - shows ALL updates including dev builds (patch versions)
  const manualCheckForUpdates = useCallback(async () => {
    setChecking(true);
    setError(null);
    setDismissed(false);

    try {
      const result = await check();

      if (result) {
        const currentVersion = await getVersion();
        const newVersion = result.version;
        const isMajor = isMajorUpdate(currentVersion, newVersion);
        const isStableVer = isStable(newVersion);

        setUpdate(result);
        setUpdateInfo({
          version: newVersion,
          date: result.date,
          body: result.body,
          isStableVersion: isStableVer,
          isMajorUpdate: isMajor,
        });

        // Manual check shows ALL available updates (even patch/dev builds)
        setUpdateAvailable(true);

        console.log(`[Update Manual] Current: ${currentVersion} → New: ${newVersion} | Showing: true`);
      } else {
        setUpdateAvailable(false);
        setUpdateInfo(null);
      }
    } catch (err) {
      console.error("Failed to check for updates:", err);
      setError(err instanceof Error ? err.message : "Failed to check for updates");
    } finally {
      setChecking(false);
    }
  }, []);

  const downloadAndInstall = useCallback(async () => {
    if (!update) return;

    setInstalling(true);
    setDownloadProgress(0);
    setError(null);

    try {
      let downloaded = 0;
      let contentLength = 0;

      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            contentLength = event.data.contentLength ?? 0;
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            if (contentLength > 0) {
              setDownloadProgress(Math.round((downloaded / contentLength) * 100));
            }
            break;
          case "Finished":
            setDownloadProgress(100);
            break;
        }
      });

      // Relaunch the app after install
      await relaunch();
    } catch (err) {
      console.error("Failed to install update:", err);
      setError(err instanceof Error ? err.message : "Failed to install update");
      setInstalling(false);
    }
  }, [update]);

  const dismissUpdate = useCallback(() => {
    setDismissed(true);
    setUpdateAvailable(false);
  }, []);

  // Auto-check on mount if enabled
  useEffect(() => {
    if (autoCheck) {
      // Check if auto-updates are enabled in settings
      const checkSetting = async () => {
        try {
          const settings = await invoke<[string, string][]>("get_all_settings");
          const checkUpdates = settings.find(([key]) => key === "check_updates");
          if (checkUpdates && checkUpdates[1] === "true") {
            checkForUpdates();
          }
        } catch {
          // If we can't get settings, check anyway
          checkForUpdates();
        }
      };
      checkSetting();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCheck]);

  return {
    checking,
    updateAvailable: updateAvailable && !dismissed,
    updateInfo,
    downloadProgress,
    installing,
    error,
    checkForUpdates,
    manualCheckForUpdates,
    downloadAndInstall,
    dismissUpdate,
  };
}

// Command to get all settings (if not already defined)
declare module "@tauri-apps/api/core" {
  function invoke(cmd: "get_all_settings"): Promise<[string, string][]>;
}
