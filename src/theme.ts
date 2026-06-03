export type ThemeSettings = {
  id: string;
  name: string;
  description: string;
  /** Glass surface base RGB (e.g. "14, 20, 28") — drives all glass panel tints */
  glassBase: string;
  /** Glass blur strength in px */
  blur: number;
  /** Accent / highlight color */
  accent: string;
  /** Accent glow for shadows */
  accentGlow: string;
  /** Accent soft background */
  accentSoft: string;
};

export const themePresets: ThemeSettings[] = [
  {
    id: "glacier",
    name: "冰蓝画廊",
    description: "冷调冰蓝，玻璃如薄冰悬浮于深色背景之上。",
    glassBase: "14, 20, 28",
    blur: 20,
    accent: "#7eb8da",
    accentGlow: "rgba(126, 184, 218, 0.28)",
    accentSoft: "rgba(126, 184, 218, 0.10)"
  },
  {
    id: "ember",
    name: "琥珀余晖",
    description: "暖金琥珀色，玻璃面板如夕阳透过旧窗棂。",
    glassBase: "24, 20, 16",
    blur: 18,
    accent: "#d4a574",
    accentGlow: "rgba(212, 165, 116, 0.26)",
    accentSoft: "rgba(212, 165, 116, 0.10)"
  },
  {
    id: "void",
    name: "墨色画框",
    description: "中性银灰高对比，让封面成为唯一焦点。",
    glassBase: "12, 12, 14",
    blur: 22,
    accent: "#a0aab4",
    accentGlow: "rgba(160, 170, 180, 0.22)",
    accentSoft: "rgba(160, 170, 180, 0.08)"
  },
  {
    id: "twilight",
    name: "薄紫暮光",
    description: "淡紫微粉，柔和的薄暮氛围包裹画面。",
    glassBase: "18, 16, 24",
    blur: 18,
    accent: "#b8a8d4",
    accentGlow: "rgba(184, 168, 212, 0.28)",
    accentSoft: "rgba(184, 168, 212, 0.10)"
  }
];

export const defaultTheme = themePresets[0];

export function loadThemeSettings(): ThemeSettings {
  try {
    const saved = JSON.parse(localStorage.getItem("gal-launcher-theme") || "{}");
    const preset = themePresets.find((item) => item.id === saved.id) || defaultTheme;
    return preset;
  } catch {
    return defaultTheme;
  }
}