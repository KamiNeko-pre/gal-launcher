const fs = require("node:fs");

function stripTransientInstallationState(game) {
  if (!game || typeof game !== "object") return { game, changed: false };
  if (!Object.prototype.hasOwnProperty.call(game, "installationStatus")) {
    return { game, changed: false };
  }
  const { installationStatus: _discarded, ...persistedGame } = game;
  return { game: persistedGame, changed: true };
}

function inspectLaunchTarget(game, fsImpl = fs) {
  const executablePath = typeof game?.executablePath === "string"
    ? game.executablePath.trim()
    : "";
  if (!executablePath || !fsImpl.existsSync(executablePath)) {
    return { available: false, reason: "missing-executable" };
  }
  return { available: true, executablePath };
}

module.exports = { inspectLaunchTarget, stripTransientInstallationState };
