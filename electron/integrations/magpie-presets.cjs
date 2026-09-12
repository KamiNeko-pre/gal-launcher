const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PREFIX = "Gal Launcher · ";

// Curated verbatim from the owner's Galgame Magpie ScalingModes collection.
const MAGPIE_PRESETS = Object.freeze([
  Object.freeze({
    id: "light", label: "轻量", target: "超分至 1080p",
    description: "中下负载，适合原生 720p/较低分辨率 Galgame",
    recommendation: "建议核显、老显卡或入门独显",
    effects: Object.freeze([
      Object.freeze({ name: "Bicubic", scalingType: 1, scale: Object.freeze({ x: 1, y: 1 }) }),
      Object.freeze({ name: "Anime4K\\Anime4K_Restore_S" }),
    ]),
  }),
  Object.freeze({
    id: "balanced", label: "均衡", target: "超分至 1080p / 2K",
    description: "中等负载，兼顾文字锐度、人物线条与稳定帧率",
    recommendation: "建议 RTX 4060 笔记本或同级显卡",
    effects: Object.freeze([
      Object.freeze({ name: "Anime4K\\Anime4K_Upscale_S" }),
      Object.freeze({ name: "Bicubic", scalingType: 1, scale: Object.freeze({ x: 1, y: 1 }) }),
      Object.freeze({ name: "Anime4K\\Anime4K_Restore_Soft_M" }),
    ]),
  }),
  Object.freeze({
    id: "quality", label: "高清", target: "超分至 2K / 2.5K",
    description: "高负载，强化线条与 CG 细节，适合高分辨率显示器",
    recommendation: "建议 RTX 4060 或同级显卡",
    effects: Object.freeze([
      Object.freeze({ name: "Anime4K\\Anime4K_Upscale_VL" }),
      Object.freeze({ name: "Lanczos", scalingType: 1, scale: Object.freeze({ x: 1, y: 1 }) }),
      Object.freeze({ name: "Anime4K\\Anime4K_Restore_VL" }),
    ]),
  }),
  Object.freeze({
    id: "fourK", label: "4K", target: "超分至 4K",
    description: "很高负载，以 4K 输出质量优先，长时间运行前请观察显存与帧率",
    recommendation: "建议 RTX 4060 或同级显卡，4K 输出也可尝试",
    effects: Object.freeze([
      Object.freeze({ name: "Anime4K\\Anime4K_Upscale_VL" }),
      Object.freeze({ name: "Anime4K\\Anime4K_Restore_VL" }),
      Object.freeze({ name: "Lanczos", scalingType: 1, scale: Object.freeze({ x: 1, y: 1 }) }),
      Object.freeze({ name: "Anime4K\\Anime4K_Upscale_VL" }),
    ]),
  }),
]);

function publicMagpiePresets() {
  return MAGPIE_PRESETS.map(({ id, label, target, description, recommendation }) => ({
    id, label, target, description, recommendation,
  }));
}

function resolveMagpieConfigPath(magpiePath, options = {}) {
  const fsImpl = options.fsImpl || fs;
  const portablePath = path.join(path.dirname(path.resolve(magpiePath)), "config", "config.json");
  if (fsImpl.existsSync(portablePath)) return portablePath;
  const localAppData = options.localAppData || process.env.LOCALAPPDATA
    || (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "AppData", "Local") : "");
  if (!localAppData) {
    const error = new Error("无法确定 Magpie 配置目录");
    error.code = "magpie-config-location-missing";
    throw error;
  }
  return path.join(localAppData, "Magpie", "config", "v4", "config.json");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function applyMagpiePreset(magpiePath, presetId, options = {}) {
  const fsImpl = options.fsImpl || fs;
  const preset = MAGPIE_PRESETS.find((item) => item.id === presetId);
  if (!preset) {
    const error = new Error(`未知的超分方案：${presetId}`);
    error.code = "unknown-magpie-preset";
    throw error;
  }

  const configPath = resolveMagpieConfigPath(magpiePath, { ...options, fsImpl });
  fsImpl.mkdirSync(path.dirname(configPath), { recursive: true });
  let config = {};
  if (fsImpl.existsSync(configPath)) {
    try {
      const raw = fsImpl.readFileSync(configPath, "utf8").replace(/^\uFEFF/, "");
      const parsed = JSON.parse(raw || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) config = parsed;
    } catch {
      const error = new Error("Magpie 配置文件损坏，无法安全切换方案");
      error.code = "magpie-config-invalid";
      throw error;
    }
  }

  const before = JSON.stringify(config);
  const userModes = Array.isArray(config.scalingModes)
    ? config.scalingModes.filter((item) => !String(item?.name || "").startsWith(PREFIX))
    : [];
  const launcherModes = MAGPIE_PRESETS.map((item) => ({
    name: `${PREFIX}${item.label}`,
    effects: clone(item.effects),
  }));
  config.scalingModes = [...userModes, ...launcherModes];
  const selectedIndex = userModes.length + MAGPIE_PRESETS.findIndex((item) => item.id === presetId);
  if (!Array.isArray(config.profiles) || config.profiles.length === 0) config.profiles = [{}];
  config.profiles[0] = { ...(config.profiles[0] || {}), scalingMode: selectedIndex };

  const changed = before !== JSON.stringify(config);
  if (changed) {
    const temporaryPath = `${configPath}.gal-launcher-${crypto.randomUUID()}.tmp`;
    fsImpl.writeFileSync(temporaryPath, JSON.stringify(config, null, 2), "utf8");
    fsImpl.renameSync(temporaryPath, configPath);
  }
  return { changed, configPath, presetId, scalingMode: selectedIndex };
}

module.exports = { MAGPIE_PRESETS, applyMagpiePreset, publicMagpiePresets, resolveMagpieConfigPath };
