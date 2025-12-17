import { create } from "zustand";
import { useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";

import frTranslations from "./locales/fr.json";
import enTranslations from "./locales/en.json";
import deTranslations from "./locales/de.json";
import nlTranslations from "./locales/nl.json";

export type Locale = "fr" | "en" | "de" | "nl";

export type TranslationKeys = typeof frTranslations;

const translations: Record<Locale, TranslationKeys> = {
  fr: frTranslations,
  en: enTranslations,
  de: deTranslations as unknown as TranslationKeys,
  nl: nlTranslations as unknown as TranslationKeys,
};

interface I18nState {
  locale: Locale;
  _isLoaded: boolean;
  setLocale: (locale: Locale) => void;
  loadFromBackend: () => Promise<void>;
}

export const useI18nStore = create<I18nState>()((set, get) => ({
  locale: "en",
  _isLoaded: false,

  setLocale: (locale) => {
    set({ locale });
    // Save to backend
    invoke("save_appearance_setting", { key: "locale", value: locale }).catch(
      (err) => console.error("Failed to save locale:", err)
    );
  },

  loadFromBackend: async () => {
    if (get()._isLoaded) return;
    try {
      const settings = await invoke<{
        locale: string;
        theme: string;
        custom_theme: unknown;
      }>("get_appearance_settings");
      const validLocales: Locale[] = ["fr", "en", "de", "nl"];
      const locale = validLocales.includes(settings.locale as Locale)
        ? (settings.locale as Locale)
        : "en";
      set({ locale, _isLoaded: true });
    } catch (err) {
      console.error("Failed to load locale from backend:", err);
      set({ _isLoaded: true });
    }
  },
}));

// Initialize the store from backend on module load
useI18nStore.getState().loadFromBackend();

type NestedKeyOf<T> = T extends object
  ? {
      [K in keyof T]: K extends string
        ? T[K] extends object
          ? `${K}.${NestedKeyOf<T[K]>}`
          : K
        : never;
    }[keyof T]
  : never;

export type TranslationKey = NestedKeyOf<TranslationKeys>;

function getNestedValue(obj: unknown, path: string): string {
  const keys = path.split(".");
  let current: unknown = obj;

  for (const key of keys) {
    if (current === null || current === undefined) {
      return path;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return typeof current === "string" ? current : path;
}

export function useTranslation() {
  const { locale, setLocale } = useI18nStore();
  const currentTranslations = translations[locale];

  // Memoize the t function to prevent unnecessary re-renders
  // Only changes when locale changes
  const t = useCallback(
    (key: TranslationKey, params?: Record<string, string | number>): string => {
      let value = getNestedValue(currentTranslations, key);

      if (params) {
        Object.entries(params).forEach(([paramKey, paramValue]) => {
          // Support both {param} and {{param}} syntax
          value = value.replace(new RegExp(`\\{\\{${paramKey}\\}\\}`, 'g'), String(paramValue));
          value = value.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), String(paramValue));
        });
      }

      return value;
    },
    [currentTranslations]
  );

  const availableLocales = useMemo(() => Object.keys(translations) as Locale[], []);

  return {
    t,
    locale,
    setLocale,
    availableLocales,
  };
}

export const localeNames: Record<Locale, string> = {
  fr: "Francais",
  en: "English",
  de: "Deutsch",
  nl: "Nederlands",
};
