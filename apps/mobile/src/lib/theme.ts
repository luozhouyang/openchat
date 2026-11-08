import { useColorScheme } from "react-native";
import { create } from "zustand";
import * as SecureStore from "expo-secure-store";

export type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "openchat.theme";

export interface Palette {
  bg: string;
  panel: string;
  text: string;
  muted: string;
  border: string;
  inputBg: string;
  primary: string;
}

const LIGHT: Palette = {
  bg: "#ffffff",
  panel: "#f3f4f6",
  text: "#111827",
  muted: "#6b7280",
  border: "#d1d5db",
  inputBg: "#ffffff",
  primary: "#2563eb",
};

const DARK: Palette = {
  bg: "#111827",
  panel: "#1f2937",
  text: "#f9fafb",
  muted: "#9ca3af",
  border: "#374151",
  inputBg: "#1f2937",
  primary: "#60a5fa",
};

/** Pure palette resolution so tests do not need the React Native runtime. */
export function paletteFor(mode: ThemeMode, scheme: string | null | undefined): Palette {
  const dark = mode === "dark" || (mode === "system" && scheme === "dark");
  return dark ? DARK : LIGHT;
}

export const useThemeStore = create<{
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}>((set) => ({
  mode: "system",
  setMode(mode) {
    set({ mode });
    void SecureStore.setItemAsync(STORAGE_KEY, mode).catch(() => {});
  },
}));

/** Restores the persisted theme choice on app start. */
export async function loadTheme(): Promise<void> {
  try {
    const stored = await SecureStore.getItemAsync(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      useThemeStore.setState({ mode: stored });
    }
  } catch {
    // storage unavailable: keep the system default
  }
}

export function usePalette(): Palette {
  const mode = useThemeStore((state) => state.mode);
  const scheme = useColorScheme();
  return paletteFor(mode, scheme);
}
