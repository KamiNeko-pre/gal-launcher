export type ThemeId = "cinema" | "editorial" | "arcade" | "atelier" | "monolux" | "aurora";

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  description: string;
  /** Google Fonts stylesheet URL injected when this theme is active */
  fontHref: string;
}

export const themePresets: ThemeDefinition[] = [
  {
    id: "cinema",
    name: "Cinema",
    description: "电影感全屏剧照，雾蓝粉白光晕，衬线大字。当前保留原设计。",
    fontHref:
      "https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600&family=Inter:wght@300;400;500;600&family=Noto+Serif+JP:wght@400;600&display=swap"
  },
  {
    id: "editorial",
    name: "Editorial",
    description: "杂志对开内页，刊头工具栏与翻页目录条，红色阅读按钮。",
    fontHref:
      "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;1,9..144,400&family=Inter+Tight:wght@400;500;600&family=JetBrains+Mono&display=swap"
  },
  {
    id: "arcade",
    name: "Arcade",
    description: "游戏机整机外壳，控制柜、CRT 舞台与卡带槽。",
    fontHref:
      "https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Space+Grotesk:wght@400;500;700&family=VT323&display=swap"
  },
  {
    id: "atelier",
    name: "Atelier",
    description: "视觉小说手账桌面，横向照片主卡、便签资料与相册条。",
    fontHref:
      "https://fonts.googleapis.com/css2?family=Caveat:wght@400;600;700&family=DM+Mono:wght@400;500&family=Shippori+Mincho:wght@500;600&display=swap"
  },
  {
    id: "monolux",
    name: "Lumen Shelf",
    description: "明亮索引书架，目录墙、桌面主视觉与多列收藏书架。",
    fontHref:
      "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Noto+Serif+SC:wght@500;700;800&family=JetBrains+Mono&display=swap"
  },
  {
    id: "aurora",
    name: "Aurora",
    description: "柔光宽幅剧照舞台，左右统计卡与续读列表，发光胶囊启动键。",
    fontHref:
      "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Manrope:wght@400;500;600;700&family=JetBrains+Mono&display=swap"
  }
];

export const defaultTheme = themePresets[0];

export function loadThemeSettings(): ThemeDefinition {
  try {
    const saved = JSON.parse(localStorage.getItem("gal-launcher-theme") || "{}");
    return themePresets.find((item) => item.id === saved.id) || defaultTheme;
  } catch {
    return defaultTheme;
  }
}
