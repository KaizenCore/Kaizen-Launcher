import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import {
  CustomThemeColors,
  DEFAULT_COLORS,
  THEME_PRESETS,
} from "@/lib/customTheme";

interface CustomThemeSettings {
  primary_hue: number;
  primary_saturation: number;
  secondary_hue: number;
  secondary_saturation: number;
  active_preset_id: string | null;
}

interface CustomThemeState {
  colors: CustomThemeColors;
  activePresetId: string | null;
  _hasHydrated: boolean;
  setColors: (colors: Partial<CustomThemeColors>) => void;
  setPreset: (presetId: string) => void;
  resetToDefault: () => void;
  loadFromBackend: () => Promise<void>;
}

// Helper to save current state to backend
const saveToBackend = (colors: CustomThemeColors, activePresetId: string | null) => {
  invoke("save_custom_theme_settings", {
    settings: {
      primary_hue: colors.primaryHue,
      primary_saturation: colors.primarySaturation,
      secondary_hue: colors.secondaryHue,
      secondary_saturation: colors.secondarySaturation,
      active_preset_id: activePresetId,
    },
  }).catch((err) => console.error("Failed to save custom theme:", err));
};

export const useCustomThemeStore = create<CustomThemeState>()((set, get) => ({
  colors: DEFAULT_COLORS,
  activePresetId: "default",
  _hasHydrated: false,

  setColors: (newColors) => {
    const colors = { ...get().colors, ...newColors };
    set({ colors, activePresetId: null });
    saveToBackend(colors, null);
  },

  setPreset: (presetId) => {
    const preset = THEME_PRESETS.find((p) => p.id === presetId);
    if (preset) {
      const colors = { ...preset.colors };
      set({ colors, activePresetId: presetId });
      saveToBackend(colors, presetId);
    }
  },

  resetToDefault: () => {
    const colors = { ...DEFAULT_COLORS };
    set({ colors, activePresetId: "default" });
    saveToBackend(colors, "default");
  },

  loadFromBackend: async () => {
    if (get()._hasHydrated) return;
    try {
      const settings = await invoke<{
        locale: string;
        theme: string;
        custom_theme: CustomThemeSettings | null;
      }>("get_appearance_settings");

      if (settings.custom_theme) {
        const ct = settings.custom_theme;
        set({
          colors: {
            primaryHue: ct.primary_hue,
            primarySaturation: ct.primary_saturation,
            secondaryHue: ct.secondary_hue,
            secondarySaturation: ct.secondary_saturation,
          },
          activePresetId: ct.active_preset_id,
          _hasHydrated: true,
        });
      } else {
        set({ _hasHydrated: true });
      }
    } catch (err) {
      console.error("Failed to load custom theme from backend:", err);
      set({ _hasHydrated: true });
    }
  },
}));

// Initialize the store from backend on module load
useCustomThemeStore.getState().loadFromBackend();
