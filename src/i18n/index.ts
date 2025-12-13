import { create } from "zustand";
import { persist } from "zustand/middleware";

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
  setLocale: (locale: Locale) => void;
}

export const useI18nStore = create<I18nState>()(
  persist(
    (set) => ({
      locale: "en",
      setLocale: (locale) => set({ locale }),
    }),
    {
      name: "kaizen-i18n",
    }
  )
);

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

  const t = (key: TranslationKey, params?: Record<string, string | number>): string => {
    let value = getNestedValue(currentTranslations, key);

    if (params) {
      Object.entries(params).forEach(([paramKey, paramValue]) => {
        // Support both {param} and {{param}} syntax
        value = value.replace(new RegExp(`\\{\\{${paramKey}\\}\\}`, 'g'), String(paramValue));
        value = value.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), String(paramValue));
      });
    }

    return value;
  };

  return {
    t,
    locale,
    setLocale,
    availableLocales: Object.keys(translations) as Locale[],
  };
}

export const localeNames: Record<Locale, string> = {
  fr: "Francais",
  en: "English",
  de: "Deutsch",
  nl: "Nederlands",
};
