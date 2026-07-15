const fs = require("node:fs");

function validateMagpiePath(magpiePath, fsImpl = fs) {
  const value = String(magpiePath || "").trim();
  if (!value) return { ok: false, code: "missing", message: "未配置 Magpie.exe 路径" };
  if (!value.toLowerCase().endsWith("magpie.exe")) return { ok: false, code: "filename", message: "路径必须指向 Magpie.exe" };
  if (!fsImpl.existsSync(value)) return { ok: false, code: "missing_file", message: "找不到 Magpie.exe" };
  return { ok: true, path: value };
}

async function ensureMagpieRunning(magpiePath, { isRunning, spawnImpl, fsImpl } = {}) {
  const validation = validateMagpiePath(magpiePath, fsImpl || fs);
  if (!validation.ok) throw Object.assign(new Error(validation.message), { code: validation.code });
  if (await (isRunning ? isRunning() : false)) return { started: false, path: validation.path };
  const spawn = spawnImpl || require("node:child_process").spawn;
  const child = spawn(validation.path, [], { detached: true, stdio: "ignore", windowsHide: true });
  child.unref?.();
  return { started: true, path: validation.path };
}

async function launchWithIntegration(game, settings = {}, deps = {}) {
  if (!settings.magpieEnabled) return { integration: "disabled" };
  const result = await ensureMagpieRunning(settings.magpiePath, deps);
  return { integration: "magpie", magpieStarted: result.started, path: result.path };
}

async function prepareMagpieScaling(processId, settings = {}, { waitForWindow, sendShortcut } = {}) {
  if (!settings.magpieEnabled) return { integration: "disabled" };
  if (!settings.magpieShortcut) throw Object.assign(new Error("未配置 Magpie 窗口化缩放快捷键"), { code: "shortcut_missing" });
  const state = await waitForWindow(processId);
  if (!state?.hasWindow) throw Object.assign(new Error("游戏没有创建可用窗口"), { code: "window_missing" });
  if (!state.windowed) throw Object.assign(new Error("游戏未以窗口模式启动，请先在游戏内设置为窗口模式"), { code: "window_mode_required" });
  await sendShortcut(settings.magpieShortcut, processId);
  return { integration: "magpie", windowed: true, shortcut: settings.magpieShortcut };
}

module.exports = { validateMagpiePath, ensureMagpieRunning, launchWithIntegration, prepareMagpieScaling };
