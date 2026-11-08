export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "openchat.theme";

export function getTheme(): Theme {
  if (typeof localStorage === "undefined") {
    return "system";
  }
  const value = localStorage.getItem(STORAGE_KEY);
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

/** Persists the choice and applies it to <html> immediately. */
export function applyTheme(theme: Theme): void {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, theme);
  }
  const dark =
    theme === "dark" ||
    (theme === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}
