import { create } from "zustand";

export type DependencyStatus =
  | "pending"
  | "checking"
  | "installed"
  | "missing"
  | "installing"
  | "error";

export interface DependencyState {
  status: DependencyStatus;
  version?: string;
  path?: string;
  error?: string;
}

interface SystemCheckState {
  // Session state (resets each app launch)
  hasCheckedThisSession: boolean;
  isChecking: boolean;

  // Dependency states
  java: DependencyState;
  cloudflare: DependencyState;

  // Persisted preferences
  cloudflareSkipped: boolean;

  // Installation progress
  installProgress: number;
  installMessage: string;
  currentlyInstalling: "java" | "cloudflare" | null;

  // Actions
  setHasCheckedThisSession: (value: boolean) => void;
  setIsChecking: (value: boolean) => void;
  setJava: (state: Partial<DependencyState>) => void;
  setCloudflare: (state: Partial<DependencyState>) => void;
  setCloudflareSkipped: (skipped: boolean) => void;
  setInstallProgress: (
    progress: number,
    message: string,
    installing?: "java" | "cloudflare" | null
  ) => void;
  resetSession: () => void;
}

const initialDependencyState: DependencyState = {
  status: "pending",
};

// Load cloudflareSkipped from localStorage on init
const getInitialCloudflareSkipped = (): boolean => {
  try {
    const stored = localStorage.getItem("kaizen-cloudflare-skipped");
    return stored === "true";
  } catch {
    return false;
  }
};

// Save cloudflareSkipped to localStorage
const saveCloudflareSkipped = (skipped: boolean) => {
  try {
    localStorage.setItem("kaizen-cloudflare-skipped", String(skipped));
  } catch {
    // Ignore localStorage errors
  }
};

export const useSystemCheckStore = create<SystemCheckState>()((set) => ({
  // Initial state - session based (resets each launch)
  hasCheckedThisSession: false,
  isChecking: false,
  java: { ...initialDependencyState },
  cloudflare: { ...initialDependencyState },
  cloudflareSkipped: getInitialCloudflareSkipped(),
  installProgress: 0,
  installMessage: "",
  currentlyInstalling: null,

  // Actions
  setHasCheckedThisSession: (value) => set({ hasCheckedThisSession: value }),

  setIsChecking: (value) => set({ isChecking: value }),

  setJava: (state) =>
    set((prev) => ({
      java: { ...prev.java, ...state },
    })),

  setCloudflare: (state) =>
    set((prev) => ({
      cloudflare: { ...prev.cloudflare, ...state },
    })),

  setCloudflareSkipped: (skipped) => {
    saveCloudflareSkipped(skipped);
    set({ cloudflareSkipped: skipped });
  },

  setInstallProgress: (progress, message, installing = null) =>
    set({
      installProgress: progress,
      installMessage: message,
      currentlyInstalling: installing,
    }),

  resetSession: () =>
    set({
      hasCheckedThisSession: false,
      isChecking: false,
      java: { ...initialDependencyState },
      cloudflare: { ...initialDependencyState },
      installProgress: 0,
      installMessage: "",
      currentlyInstalling: null,
    }),
}));
