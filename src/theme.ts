export type ThemeSettings = {
  id: string;
  name: string;
  description: string;
  glassAlpha: number;
  blur: number;
  cardScale: number;
  accent: string;
  overlayLeft: number;
  overlayRight: number;
  overlayBottom: number;
  glowA: string;
  glowB: string;
};

export const themePresets: ThemeSettings[] = [
  {
    id: "glacier",
    name: "冰蓝画廊",
    description: "全屏横版图沉浸展示，UI 以最轻玻璃态悬浮。",
    glassAlpha: 0.2,
    blur: 20,
    cardScale: 1,
    accent: "#7eb8da",
    overlayLeft: 0.02,
    overlayRight: 0.01,
    overlayBottom: 0.04,
    glowA: "rgba(120, 180, 220, 0.12)",
    glowB: "rgba(140, 195, 235, 0.08)"
  },
  {
    id: "mist",
    name: "静雾灰蓝",
    description: "低饱和灰蓝，克制耐看，适合长期使用。",
    glassAlpha: 0.32,
    blur: 18,
    cardScale: 1,
    accent: "#9fb7ca",
    overlayLeft: 0.08,
    overlayRight: 0.04,
    overlayBottom: 0.12,
    glowA: "rgba(148, 163, 184, 0.14)",
    glowB: "rgba(203, 213, 225, 0.1)"
  },
  {
    id: "night",
    name: "墨蓝夜色",
    description: "更深邃的冷蓝暗色，强调文字可读性。",
    glassAlpha: 0.36,
    blur: 20,
    cardScale: 1,
    accent: "#8aa6bd",
    overlayLeft: 0.1,
    overlayRight: 0.06,
    overlayBottom: 0.16,
    glowA: "rgba(100, 160, 210, 0.12)",
    glowB: "rgba(148, 163, 184, 0.08)"
  },
  {
    id: "sakura",
    name: "月白藤灰",
    description: "淡紫底调，素净沉静。",
    glassAlpha: 0.3,
    blur: 18,
    cardScale: 1,
    accent: "#b0b8d8",
    overlayLeft: 0.06,
    overlayRight: 0.04,
    overlayBottom: 0.1,
    glowA: "rgba(170, 175, 210, 0.14)",
    glowB: "rgba(220, 225, 240, 0.1)"
  },
  {
    id: "clear",
    name: "清透纸感",
    description: "遮挡最少，像一层安静的半透明宣纸。",
    glassAlpha: 0.22,
    blur: 14,
    cardScale: 0.98,
    accent: "#a0c0d8",
    overlayLeft: 0.03,
    overlayRight: 0.02,
    overlayBottom: 0.06,
    glowA: "rgba(180, 210, 230, 0.1)",
    glowB: "rgba(220, 235, 245, 0.08)"
  },
  {
    id: "frost",
    name: "霜月白",
    description: "明亮雾面浅色系，适合白天偏爱浅色。",
    glassAlpha: 0.22,
    blur: 18,
    cardScale: 1,
    accent: "#7aadcc",
    overlayLeft: 0.04,
    overlayRight: 0.02,
    overlayBottom: 0.06,
    glowA: "rgba(160, 200, 220, 0.12)",
    glowB: "rgba(210, 225, 235, 0.1)"
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
