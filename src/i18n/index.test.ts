import { describe, it, expect, beforeEach } from "vitest";
import { useTranslation, useI18nStore, localeNames } from "./index";
import { renderHook, act } from "@testing-library/react";

describe("i18n", () => {
  beforeEach(() => {
    // Reset store to default state
    useI18nStore.setState({ locale: "en" });
  });

  describe("useTranslation", () => {
    it("should return English translations by default", () => {
      const { result } = renderHook(() => useTranslation());

      expect(result.current.locale).toBe("en");
      expect(result.current.t("common.loading")).toBe("Loading...");
    });

    it("should return French translations when locale is set to fr", () => {
      const { result } = renderHook(() => useTranslation());

      act(() => {
        result.current.setLocale("fr");
      });

      expect(result.current.locale).toBe("fr");
      expect(result.current.t("common.loading")).toBe("Chargement...");
    });

    it("should handle nested translation keys", () => {
      const { result } = renderHook(() => useTranslation());

      expect(result.current.t("nav.home")).toBe("Home");
      expect(result.current.t("instances.play")).toBe("Play");
    });

    it("should substitute parameters in translations", () => {
      const { result } = renderHook(() => useTranslation());

      const translated = result.current.t("accounts.deviceCodeInstructions", {
        url: "https://example.com",
      });

      expect(translated).toContain("https://example.com");
    });

    it("should list available locales", () => {
      const { result } = renderHook(() => useTranslation());

      expect(result.current.availableLocales).toContain("fr");
      expect(result.current.availableLocales).toContain("en");
    });
  });

  describe("localeNames", () => {
    it("should have names for all locales", () => {
      expect(localeNames.fr).toBe("Francais");
      expect(localeNames.en).toBe("English");
    });
  });

  describe("useI18nStore", () => {
    it("should persist locale changes", () => {
      const { result } = renderHook(() => useI18nStore());

      act(() => {
        result.current.setLocale("en");
      });

      expect(result.current.locale).toBe("en");
    });
  });
});
