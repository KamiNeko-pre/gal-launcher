import { lazy } from "react";
import type { ThemeId } from "../theme";

export const layouts = {
  cinema: lazy(() => import("./CinemaLayout").then((module) => ({ default: module.CinemaLayout }))),
  editorial: lazy(() => import("./EditorialLayout").then((module) => ({ default: module.EditorialLayout }))),
  arcade: lazy(() => import("./ArcadeLayout").then((module) => ({ default: module.ArcadeLayout }))),
  atelier: lazy(() => import("./AtelierLayout").then((module) => ({ default: module.AtelierLayout }))),
  aurora: lazy(() => import("./AuroraLayout").then((module) => ({ default: module.AuroraLayout }))),
  monolux: lazy(() => import("./MonoLuxLayout").then((module) => ({ default: module.MonoLuxLayout })))
} as const;

export function loadThemeAssets(theme: ThemeId) {
  switch (theme) {
    case "editorial": return import("../themes/editorial.css");
    case "arcade": return import("../themes/arcade.css");
    case "atelier": return import("../themes/atelier.css");
    case "aurora": return import("../themes/aurora.css");
    case "monolux": return import("../themes/monolux.css");
    default: return Promise.resolve();
  }
}
