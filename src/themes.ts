import type { Theme } from "./types";

export type ThemePalette = {
  bg: string;
  panel: string;
  sidebar: string;
  line: string;
  text: string;
  muted: string;
  accent: string;
  accentBg: string;
  glass: string;
  danger: string;
  onAccent: string;
};

export type ThemeOption = {
  id: Exclude<Theme, "system">;
  light: boolean;
  palette: ThemePalette;
};

const palettes: Record<"dark" | "light", ThemeOption> = {
  dark: {
    id: "dark", light: false,
    palette: {
      bg: "#0c1020", panel: "#141a2e", sidebar: "#101526", line: "#333d5a",
      text: "#f1f3ff", muted: "#acb5d2", accent: "#afa4ff", accentBg: "#302d54",
      glass: "#1b223a", danger: "#ffa3a3", onAccent: "#181337",
    },
  },
  light: {
    id: "light", light: true,
    palette: {
      bg: "#f4f5fc", panel: "#ffffff", sidebar: "#eceefa", line: "#ccd0e3",
      text: "#222640", muted: "#5b627d", accent: "#5844a7", accentBg: "#e7e2ff",
      glass: "#f0f1fa", danger: "#a52f45", onAccent: "#ffffff",
    },
  },
};

export function readTheme(saved: string | null): Theme {
  if (saved === "light" || saved === "white" || saved?.endsWith("-light")) return "light";
  if (saved === "dark" || saved?.endsWith("-dark") ||
      saved === "default" || saved === "hu" || saved === "graphite") return "dark";
  return "system";
}

export function resolveTheme(theme: Theme, prefersDark: boolean): ThemeOption {
  return palettes[theme === "system" ? (prefersDark ? "dark" : "light") : theme];
}
