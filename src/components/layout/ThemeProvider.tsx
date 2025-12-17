import { useEffect, useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ThemeContext, Theme } from "@/lib/themes";
import { useCustomThemeStore } from "@/stores/customThemeStore";
import { applyCustomColors } from "@/lib/colorUtils";

function getSystemTheme(): "light" | "dark" {
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "dark";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("system");
  const loadedRef = useRef(false);

  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() => {
    return getSystemTheme();
  });

  // Load theme from backend on mount
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    invoke<{ locale: string; theme: string; custom_theme: unknown }>(
      "get_appearance_settings"
    )
      .then((settings) => {
        const validThemes: Theme[] = ["light", "dark", "system"];
        const savedTheme = validThemes.includes(settings.theme as Theme)
          ? (settings.theme as Theme)
          : "system";
        setThemeState(savedTheme);
      })
      .catch((err) => {
        console.error("Failed to load theme from backend:", err);
      });
  }, []);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    // Save to backend
    invoke("save_appearance_setting", { key: "theme", value: newTheme }).catch(
      (err) => console.error("Failed to save theme:", err)
    );
  }, []);

  // Update resolved theme when theme changes or system preference changes
  useEffect(() => {
    const updateResolvedTheme = () => {
      if (theme === "system") {
        setResolvedTheme(getSystemTheme());
      } else {
        setResolvedTheme(theme);
      }
    };

    updateResolvedTheme();

    // Listen for system theme changes
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      if (theme === "system") {
        updateResolvedTheme();
      }
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [theme]);

  // Apply theme to document
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(resolvedTheme);
  }, [resolvedTheme]);

  // Apply custom colors when theme or colors change
  const colors = useCustomThemeStore((state) => state.colors);
  const hasHydrated = useCustomThemeStore((state) => state._hasHydrated);

  // Apply colors when hydrated or when colors/theme change
  useEffect(() => {
    // Only apply colors after hydration to avoid flash of default colors
    if (hasHydrated) {
      applyCustomColors(colors, resolvedTheme);
    }
  }, [colors, resolvedTheme, hasHydrated]);

  // Subscribe to store changes for real-time updates
  useEffect(() => {
    const unsubscribe = useCustomThemeStore.subscribe((state) => {
      if (state._hasHydrated) {
        applyCustomColors(state.colors, resolvedTheme);
      }
    });
    return unsubscribe;
  }, [resolvedTheme]);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
