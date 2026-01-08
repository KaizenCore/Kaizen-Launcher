import { create } from "zustand"
import { invoke } from "@tauri-apps/api/core"

interface EasyModeState {
  enabled: boolean
  loading: boolean
  load: () => Promise<void>
  setEnabled: (enabled: boolean) => Promise<void>
}

export const useEasyModeStore = create<EasyModeState>((set) => ({
  enabled: true, // Default to easy mode for novice users
  loading: true,

  load: async () => {
    try {
      const enabled = await invoke<boolean>("get_easy_mode_enabled")
      set({ enabled, loading: false })
    } catch (error) {
      console.error("Failed to load easy mode setting:", error)
      set({ loading: false })
    }
  },

  setEnabled: async (enabled: boolean) => {
    try {
      await invoke("set_easy_mode_enabled", { enabled })
      set({ enabled })
    } catch (error) {
      console.error("Failed to set easy mode:", error)
      throw error
    }
  },
}))
