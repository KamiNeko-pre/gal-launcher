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
    description: "电影感全屏剧照，雾蓝粉白光晕，衬线大字。当前线上版本。",
    fontHref:
      "https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600&family=Inter:wght@300;400;500;600&family=Noto+Serif+JP:wght@400;600&display=swap"
  },
  {
    id: "editorial",
    name: "Editorial",
    description: "杂志对开内页，刊头工具栏 + 翻页目录条，朱红大按钮。",
    fontHref:
      "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;1,9..144,400&family=Inter+Tight:wght@400;500;600&family=JetBrains+Mono&display=swap"
  },
  {
    id: "arcade",
    name: "Arcade",
    description: "游戏机整机外壳，控制柱 + CRT 屏 + 卡带槽，START 大圆钮。",
    fontHref:
      "https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Space+Grotesk:wght@400;500;700&family=VT323&display=swap"
  },
  {
    id: "atelier",
    name: "Atelier",
    description: "俯视拼贴台面，夹片便利贴 + 相册条，红色图章启动键。",
    fontHref:
      "https://fonts.googleapis.com/css2?family=Caveat:wght@400;600;700&family=DM+Mono:wght@400;500&family=Shippori+Mincho:wght@500;600&display=swap"
  },
  {
    id: "monolux",
    name: "Mono Lux",
    description: "美术馆长廊，聚光主画 + 横向漫游，银箔铭板启动键。",
    fontHref:
      "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,500;0,700;1,300;1,500&family=Inter:wght@300;400;500;600&family=JetBrains+Mono&display=swap"
  },
  {
    id: "aurora",
    name: "Aurora",
    description: "沉浸式封面轮播，环绕玻璃卡 + 缩略胶卷，发光大胶囊启动键。",
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
