/**
 * Types et presets pour le système de thème personnalisable
 */

export interface CustomThemeColors {
  primaryHue: number; // 0-360
  primarySaturation: number; // 0-100
  secondaryHue: number; // 0-360
  secondarySaturation: number; // 0-100
}

export interface ThemePreset {
  id: string;
  name: string;
  nameKey: string; // Clé i18n
  colors: CustomThemeColors;
}

export const DEFAULT_COLORS: CustomThemeColors = {
  primaryHue: 40,
  primarySaturation: 55,
  secondaryHue: 45,
  secondarySaturation: 25,
};

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "default",
    name: "Kaizen",
    nameKey: "theme.presetDefault",
    colors: {
      primaryHue: 40,
      primarySaturation: 55,
      secondaryHue: 45,
      secondarySaturation: 25,
    },
  },
  {
    id: "ocean",
    name: "Ocean",
    nameKey: "theme.presetOcean",
    colors: {
      primaryHue: 200,
      primarySaturation: 80,
      secondaryHue: 190,
      secondarySaturation: 50,
    },
  },
  {
    id: "forest",
    name: "Forest",
    nameKey: "theme.presetForest",
    colors: {
      primaryHue: 142,
      primarySaturation: 70,
      secondaryHue: 150,
      secondarySaturation: 45,
    },
  },
  {
    id: "sunset",
    name: "Sunset",
    nameKey: "theme.presetSunset",
    colors: {
      primaryHue: 25,
      primarySaturation: 85,
      secondaryHue: 350,
      secondarySaturation: 60,
    },
  },
  {
    id: "purple",
    name: "Purple",
    nameKey: "theme.presetPurple",
    colors: {
      primaryHue: 270,
      primarySaturation: 75,
      secondaryHue: 280,
      secondarySaturation: 50,
    },
  },
  {
    id: "monochrome",
    name: "Monochrome",
    nameKey: "theme.presetMonochrome",
    colors: {
      primaryHue: 220,
      primarySaturation: 15,
      secondaryHue: 220,
      secondarySaturation: 10,
    },
  },
];
