import { create } from "zustand";
import { persist } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";
import type {
  Instance,
  ModInfoWithDependencies,
  ModValidationResult,
  PlaygroundSettings,
} from "@/types/playground";

// Details panel tab types
export type DetailsTab = "details" | "dependencies" | "config" | "instance";

interface PlaygroundState {
  // Data
  instanceId: string | null;
  instance: Instance | null;
  mods: ModInfoWithDependencies[];
  validation: ModValidationResult | null;
  isLoading: boolean;
  isRunning: boolean;
  isInstalled: boolean;

  // Selection
  selectedModFilename: string | null;
  selectedMods: Set<string>; // for multi-select batch operations

  // Panel state
  leftPanelCollapsed: boolean;
  rightPanelCollapsed: boolean;
  activeDetailsTab: DetailsTab;

  // UI
  searchQuery: string;
  isSearchOpen: boolean;

  // Actions
  loadInstance: (id: string) => Promise<void>;
  clearInstance: () => void;
  refreshMods: () => Promise<void>;

  // Selection actions
  selectMod: (filename: string | null) => void;
  toggleModSelection: (filename: string) => void;
  selectAllMods: () => void;
  clearModSelection: () => void;

  // Panel actions
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  setActiveDetailsTab: (tab: DetailsTab) => void;

  // Mod actions
  toggleMod: (filename: string, enabled: boolean) => Promise<void>;
  deleteMod: (filename: string) => Promise<void>;
  validateConfiguration: () => Promise<void>;

  // Status actions
  setRunningStatus: (isRunning: boolean) => void;
  setInstalledStatus: (isInstalled: boolean) => void;

  // Search
  setSearchQuery: (query: string) => void;
  setSearchOpen: (open: boolean) => void;
}

// Separate persisted settings store
interface PlaygroundSettingsState extends PlaygroundSettings {
  setLastInstanceId: (id: string | null) => void;
  setShowOptionalDependencies: (show: boolean) => void;
  setAutoLayoutMods: (auto: boolean) => void;
}

export const usePlaygroundSettingsStore = create<PlaygroundSettingsState>()(
  persist(
    (set) => ({
      lastInstanceId: null,
      showOptionalDependencies: true,
      autoLayoutMods: true,

      setLastInstanceId: (id) => set({ lastInstanceId: id }),
      setShowOptionalDependencies: (show) =>
        set({ showOptionalDependencies: show }),
      setAutoLayoutMods: (auto) => set({ autoLayoutMods: auto }),
    }),
    { name: "kaizen-playground-settings" }
  )
);

export const usePlaygroundStore = create<PlaygroundState>()((set, get) => ({
  // Initial state
  instanceId: null,
  instance: null,
  mods: [],
  validation: null,
  isLoading: false,
  isRunning: false,
  isInstalled: false,

  // Selection
  selectedModFilename: null,
  selectedMods: new Set(),

  // Panels
  leftPanelCollapsed: false,
  rightPanelCollapsed: false,
  activeDetailsTab: "details",

  // UI
  searchQuery: "",
  isSearchOpen: false,

  loadInstance: async (id: string) => {
    set({ isLoading: true, instanceId: id });

    try {
      // Fetch instance details
      const instance = await invoke<Instance | null>("get_instance", {
        instanceId: id,
      });

      if (!instance) {
        set({ isLoading: false, instanceId: null, instance: null, mods: [] });
        return;
      }

      // Check if installed and running
      const [isInstalled, isRunning] = await Promise.all([
        invoke<boolean>("is_instance_installed", { instanceId: id }),
        invoke<boolean>("is_instance_running", { instanceId: id }),
      ]);

      set({ instance, isInstalled, isRunning });

      // Fetch mods
      const mods = await invoke<ModInfoWithDependencies[]>("get_instance_mods", {
        instanceId: id,
      });

      // Transform basic mod info to include empty dependency data for now
      const modsWithDeps: ModInfoWithDependencies[] = mods.map((mod) => ({
        ...mod,
        dependencies: (mod as ModInfoWithDependencies).dependencies || [],
        dependents: (mod as ModInfoWithDependencies).dependents || [],
        server_side: (mod as ModInfoWithDependencies).server_side || null,
        client_side: (mod as ModInfoWithDependencies).client_side || null,
      }));

      set({ mods: modsWithDeps, isLoading: false });

      // Save as last used instance
      usePlaygroundSettingsStore.getState().setLastInstanceId(id);
    } catch (err) {
      console.error("[Playground] Failed to load instance:", err);
      set({ isLoading: false });
    }
  },

  clearInstance: () => {
    set({
      instanceId: null,
      instance: null,
      mods: [],
      validation: null,
      isRunning: false,
      isInstalled: false,
      selectedModFilename: null,
      selectedMods: new Set(),
    });
  },

  refreshMods: async () => {
    const { instanceId } = get();
    if (!instanceId) return;

    try {
      const mods = await invoke<ModInfoWithDependencies[]>("get_instance_mods", {
        instanceId,
      });

      const modsWithDeps: ModInfoWithDependencies[] = mods.map((mod) => ({
        ...mod,
        dependencies: (mod as ModInfoWithDependencies).dependencies || [],
        dependents: (mod as ModInfoWithDependencies).dependents || [],
        server_side: (mod as ModInfoWithDependencies).server_side || null,
        client_side: (mod as ModInfoWithDependencies).client_side || null,
      }));

      set({ mods: modsWithDeps });
    } catch (err) {
      console.error("[Playground] Failed to refresh mods:", err);
    }
  },

  // Selection actions
  selectMod: (filename) => {
    set({ selectedModFilename: filename });
    // If a mod is selected, show details tab
    if (filename) {
      set({ activeDetailsTab: "details", rightPanelCollapsed: false });
    }
  },

  toggleModSelection: (filename) => {
    set((state) => {
      const newSet = new Set(state.selectedMods);
      if (newSet.has(filename)) {
        newSet.delete(filename);
      } else {
        newSet.add(filename);
      }
      return { selectedMods: newSet };
    });
  },

  selectAllMods: () => {
    const { mods } = get();
    set({ selectedMods: new Set(mods.map((m) => m.filename)) });
  },

  clearModSelection: () => {
    set({ selectedMods: new Set() });
  },

  // Panel actions
  toggleLeftPanel: () => {
    set((state) => ({ leftPanelCollapsed: !state.leftPanelCollapsed }));
  },

  toggleRightPanel: () => {
    set((state) => ({ rightPanelCollapsed: !state.rightPanelCollapsed }));
  },

  setActiveDetailsTab: (tab) => {
    set({ activeDetailsTab: tab, rightPanelCollapsed: false });
  },

  // Mod actions
  toggleMod: async (filename: string, enabled: boolean) => {
    const { instanceId, mods } = get();
    if (!instanceId) return;

    try {
      await invoke("toggle_mod", { instanceId, filename, enabled });

      // Optimistic update
      set({
        mods: mods.map((mod) =>
          mod.filename === filename ? { ...mod, enabled } : mod
        ),
      });
    } catch (err) {
      console.error("[Playground] Failed to toggle mod:", err);
      // Revert on error
      get().refreshMods();
    }
  },

  deleteMod: async (filename: string) => {
    const { instanceId, mods, selectedModFilename, selectedMods } = get();
    if (!instanceId) return;

    try {
      await invoke("delete_mod", { instanceId, filename });

      // Remove from selections
      const newSelectedMods = new Set(selectedMods);
      newSelectedMods.delete(filename);

      // Optimistic update
      set({
        mods: mods.filter((mod) => mod.filename !== filename),
        selectedModFilename: selectedModFilename === filename ? null : selectedModFilename,
        selectedMods: newSelectedMods,
      });
    } catch (err) {
      console.error("[Playground] Failed to delete mod:", err);
      get().refreshMods();
    }
  },

  validateConfiguration: async () => {
    const { instanceId } = get();
    if (!instanceId) return;

    try {
      const { mods } = get();

      const missingRequired: ModValidationResult["missing_required"] = [];

      // Check for missing required dependencies
      for (const mod of mods) {
        if (!mod.enabled) continue;

        for (const dep of mod.dependencies) {
          if (dep.dependency_type !== "required") continue;

          const hasDep = mods.some(
            (m) => m.project_id === dep.project_id && m.enabled
          );

          if (!hasDep) {
            missingRequired.push({
              mod_name: mod.name,
              mod_project_id: mod.project_id || "",
              dependency_project_id: dep.project_id,
              dependency_type: "required",
            });
          }
        }
      }

      set({
        validation: {
          missing_required: missingRequired,
          conflicts: [],
          warnings: [],
        },
      });
    } catch (err) {
      console.error("[Playground] Failed to validate configuration:", err);
    }
  },

  setRunningStatus: (isRunning) => set({ isRunning }),

  setInstalledStatus: (isInstalled) => set({ isInstalled }),

  setSearchQuery: (query) => set({ searchQuery: query }),

  setSearchOpen: (open: boolean) => set({ isSearchOpen: open }),
}));
