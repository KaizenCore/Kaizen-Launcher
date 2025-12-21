import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

// Permission constants for the launcher
export const PERMISSIONS = {
  BETA: "launcher.beta",
  DEV: "launcher.dev",
  EARLY_ACCESS: "launcher.early_access",
  EXCLUSIVE: "launcher.exclusive",
} as const;

export type LauncherPermission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export interface KaizenTag {
  name: string;
  permissions: string[];
}

export interface KaizenBadge {
  slug: string;
  name: string;
  badge_type: string;
  icon: string | null;
  style: {
    backgroundColor: string;
    textColor: string;
    borderColor: string | null;
  };
  permissions: string[];
}

/// Safe account info from backend - NO TOKENS (security)
export interface KaizenAccount {
  id: string;
  user_id: string;
  username: string;
  email: string;
  expires_at: string;
  permissions: string; // JSON string
  tags: string; // JSON string
  badges: string; // JSON string
  is_patron: boolean;
  is_active: boolean;
  created_at: string;
  has_valid_token: boolean; // Indicates if backend has valid token
}

interface KaizenState {
  account: KaizenAccount | null;
  permissions: string[];
  tags: KaizenTag[];
  badges: KaizenBadge[];
  loading: boolean;
  error: string | null;

  // Actions
  loadActiveAccount: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
  hasAnyPermission: (permissions: string[]) => boolean;
  hasAllPermissions: (permissions: string[]) => boolean;
  clear: () => void;
}

export const useKaizenStore = create<KaizenState>((set, get) => ({
  account: null,
  permissions: [],
  tags: [],
  badges: [],
  loading: false,
  error: null,

  loadActiveAccount: async () => {
    set({ loading: true, error: null });
    try {
      const account = await invoke<KaizenAccount | null>("get_active_kaizen_account");

      if (account) {
        // Parse JSON fields
        const permissions = JSON.parse(account.permissions || "[]") as string[];
        const tags = JSON.parse(account.tags || "[]") as KaizenTag[];
        const badges = JSON.parse(account.badges || "[]") as KaizenBadge[];

        console.log("[KaizenStore] Account loaded:", account.username);
        console.log("[KaizenStore] Permissions:", permissions);

        set({
          account,
          permissions,
          tags,
          badges,
          loading: false,
        });
      } else {
        set({
          account: null,
          permissions: [],
          tags: [],
          badges: [],
          loading: false,
        });
      }
    } catch (err) {
      console.error("[KaizenStore] Failed to load account:", err);
      set({
        error: err instanceof Error ? err.message : String(err),
        loading: false,
      });
    }
  },

  hasPermission: (permission: string) => {
    const { permissions } = get();
    return permissions.includes(permission);
  },

  hasAnyPermission: (perms: string[]) => {
    const { permissions } = get();
    return perms.some((p) => permissions.includes(p));
  },

  hasAllPermissions: (perms: string[]) => {
    const { permissions } = get();
    return perms.every((p) => permissions.includes(p));
  },

  clear: () => {
    set({
      account: null,
      permissions: [],
      tags: [],
      badges: [],
      error: null,
    });
  },
}));
