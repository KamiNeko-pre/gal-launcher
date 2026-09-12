import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const main = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
const categories = readFileSync(new URL("../src/components/BookshelfCollectionOverlay.tsx", import.meta.url), "utf8");

assert.match(main, /> 打开书架<\/button>/, "沉浸菜单应提供独立的书架入口");
assert.match(main, /> 管理分类<\/button>/, "沉浸菜单应提供独立的分类入口");
assert.match(main, /setViewMode\("collection"\)/, "书架入口必须切换到主题自己的书架视图");
assert.match(categories, /按游戏题材/, "分类页应提供与自定义分类分离的题材入口");
assert.match(categories, /setTagFilter/, "题材入口必须连接现有标签筛选状态");
assert.match(categories, /addTagsToGames/, "没有题材数据时必须允许批量设置题材");
assert.match(main, /magpie-preset-grid/, "一键超分弹窗应提供清晰的预设选择区");
assert.doesNotMatch(main, /<button[^>]*data-gamepad-focus/, "可聚焦按钮不能静态冒充当前手柄焦点");
assert.match(main, /role="radio"/, "超分预设应使用可被现有手柄导航发现的原生按钮");
assert.match(main, /3840 × 2160/, "输出说明应明确给出屏幕对应的像素分辨率");
assert.match(main, /preset\.recommendation/, "悬停或聚焦说明应包含显卡建议");

console.log("library navigation contract ok");
