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

async function prepareMagpieScaling(processId, settings = {}, { waitForWindow, invokeScaling } = {}) {
  if (!settings.magpieEnabled) return { integration: "disabled" };
  const state = await waitForWindow(processId);
  if (!state?.hasWindow) throw Object.assign(new Error("游戏没有创建可用窗口"), { code: "window_missing" });
  if (!state.windowed) throw Object.assign(new Error("游戏未以窗口模式启动，请先在游戏内设置为窗口模式"), { code: "window_mode_required" });
  const targetProcessId = Number(state.pid) > 0 ? Number(state.pid) : processId;
  const result = await invokeScaling(settings.magpiePath, targetProcessId);
  if (!result?.scaled || result.processId !== targetProcessId) throw Object.assign(new Error(result?.error || "Magpie 未能确认游戏缩放画面"), { code: "scaling_unverified" });
  return { ...result, integration: "magpie", sourceWindowed: true, mode: "fullscreen" };
}

module.exports = { validateMagpiePath, ensureMagpieRunning, launchWithIntegration, prepareMagpieScaling };
