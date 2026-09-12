const TOOL_IDS = new Set(["localeEmulator", "magpie"]);

function assertToolId(toolId) {
  if (!TOOL_IDS.has(toolId)) throw new Error(`未知的增强工具：${toolId}`);
}

function isGameEnhancementEnabled(game, toolId) {
  assertToolId(toolId);
  if (!game || typeof game !== "object") return false;
  return toolId === "magpie"
    ? game.magpieEnabled === true
    : game.localeEmulator?.enabled === true;
}

/**
 * Update one game's enhancement preference without touching the other tool or
 * any game metadata/history. The executable path is only replaced when a
 * caller has just validated a new path (for example after installation).
 */
function setGameEnhancement(game, toolId, enabled, executablePath) {
  assertToolId(toolId);
  if (!game || typeof game !== "object") throw new TypeError("游戏条目不可用");
  if (toolId === "magpie") return { ...game, magpieEnabled: Boolean(enabled) };

  const current = game.localeEmulator && typeof game.localeEmulator === "object"
    ? game.localeEmulator
    : {};
  return {
    ...game,
    localeEmulator: {
      enabled: Boolean(enabled),
      executablePath: typeof executablePath === "string"
        ? executablePath
        : String(current.executablePath || "")
    }
  };
}

module.exports = { isGameEnhancementEnabled, setGameEnhancement };
