import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UpdateState {
  // Track which major version the user has seen the update dialog for
  lastSeenMajorVersion: string;
  setLastSeenMajorVersion: (version: string) => void;

  // Check if we should show the major update dialog
  shouldShowMajorUpdateDialog: (currentVersion: string) => boolean;
}

/**
 * Extract major.minor from a version string (e.g., "0.6.0" -> "0.6")
 */
function getMajorMinor(version: string): string {
  const parts = version.split(".");
  if (parts.length >= 2) {
    return `${parts[0]}.${parts[1]}`;
  }
  return version;
}

export const useUpdateStore = create<UpdateState>()(
  persist(
    (set, get) => ({
      lastSeenMajorVersion: "0.5", // Default to 0.5 so existing users see 0.6 popup

      setLastSeenMajorVersion: (version) => {
        const majorMinor = getMajorMinor(version);
        set({ lastSeenMajorVersion: majorMinor });
      },

      shouldShowMajorUpdateDialog: (currentVersion) => {
        const currentMajorMinor = getMajorMinor(currentVersion);
        const lastSeen = get().lastSeenMajorVersion;

        // Show dialog if the current major.minor is different from last seen
        return currentMajorMinor !== lastSeen;
      },
    }),
    {
      name: "kaizen-update-store",
    }
  )
);
