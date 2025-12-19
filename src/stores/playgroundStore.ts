import { create } from "zustand";
import { persist } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";
import type { Node } from "@xyflow/react";
import type {
  Instance,
  ModInfoWithDependencies,
  ModValidationResult,
  RightPanelMode,
  PlaygroundSettings,
  ConfigNodeData,
} from "@/types/playground";

interface PlaygroundState {
  // Data
  instanceId: string | null;
  instance: Instance | null;
  mods: ModInfoWithDependencies[];
  validation: ModValidationResult | null;
  isLoading: boolean;
  isRunning: boolean;
  isInstalled: boolean;

  // Canvas
  selectedNodeId: string | null;
  hoveredNodeId: string | null;
  configNodes: Node<ConfigNodeData>[];
  focusNodeId: string | null; // Node to focus/center on

  // UI
  rightPanelMode: RightPanelMode;
  searchQuery: string;
  showOptionalDeps: boolean;
  isSearchOpen: boolean;

  // Actions
  loadInstance: (id: string) => Promise<void>;
  clearInstance: () => void;
  refreshMods: () => Promise<void>;
  selectNode: (id: string | null) => void;
  setHoveredNode: (id: string | null) => void;
  setRightPanelMode: (mode: RightPanelMode) => void;
  setSearchQuery: (query: string) => void;
  toggleMod: (filename: string, enabled: boolean) => Promise<void>;
  deleteMod: (filename: string) => Promise<void>;
  validateConfiguration: () => Promise<void>;
  setRunningStatus: (isRunning: boolean) => void;
  setInstalledStatus: (isInstalled: boolean) => void;
  toggleOptionalDeps: () => void;
  addConfigNode: (node: Node<ConfigNodeData>) => void;
  removeConfigNode: (nodeId: string) => void;
  updateConfigNodePosition: (nodeId: string, position: { x: number; y: number }) => void;
  updateConfigNodeSize: (nodeId: string, width: number, height: number) => void;
  setSearchOpen: (open: boolean) => void;
  focusNode: (nodeId: string) => void;
  clearFocusNode: () => void;
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
  selectedNodeId: null,
  hoveredNodeId: null,
  configNodes: [],
  focusNodeId: null,
  rightPanelMode: "console",
  searchQuery: "",
  showOptionalDeps: true,
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

      // Fetch mods (using existing command for now, will be replaced with dependencies version)
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
      selectedNodeId: null,
      configNodes: [],
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

  selectNode: (id) => {
    set({ selectedNodeId: id });
    // If a mod is selected, show details panel
    if (id && id !== "instance") {
      set({ rightPanelMode: "details" });
    }
  },

  setHoveredNode: (id) => set({ hoveredNodeId: id }),

  setRightPanelMode: (mode) => set({ rightPanelMode: mode }),

  setSearchQuery: (query) => set({ searchQuery: query }),

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
    const { instanceId, mods } = get();
    if (!instanceId) return;

    try {
      await invoke("delete_mod", { instanceId, filename });

      // Optimistic update
      set({
        mods: mods.filter((mod) => mod.filename !== filename),
        selectedNodeId: null,
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
      // This will use the new backend command when implemented
      // For now, we'll do client-side validation
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

  toggleOptionalDeps: () =>
    set((state) => ({ showOptionalDeps: !state.showOptionalDeps })),

  addConfigNode: (node: Node<ConfigNodeData>) => {
    set((state) => ({
      configNodes: [...state.configNodes, node],
    }));
  },

  removeConfigNode: (nodeId: string) => {
    set((state) => ({
      configNodes: state.configNodes.filter((n) => n.id !== nodeId),
    }));
  },

  updateConfigNodePosition: (nodeId: string, position: { x: number; y: number }) => {
    set((state) => ({
      configNodes: state.configNodes.map((n) =>
        n.id === nodeId ? { ...n, position } : n
      ),
    }));
  },

  updateConfigNodeSize: (nodeId: string, width: number, height: number) => {
    set((state) => ({
      configNodes: state.configNodes.map((n) =>
        n.id === nodeId
          ? { ...n, style: { ...n.style, width, height } }
          : n
      ),
    }));
  },

  setSearchOpen: (open: boolean) => set({ isSearchOpen: open }),

  focusNode: (nodeId: string) => {
    set({ focusNodeId: nodeId, selectedNodeId: nodeId });
    // If a mod is selected, show details panel
    if (nodeId && nodeId !== "instance") {
      set({ rightPanelMode: "details" });
    }
  },

  clearFocusNode: () => set({ focusNodeId: null }),
}));
