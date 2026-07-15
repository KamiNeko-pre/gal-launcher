const fs = require("node:fs");
const path = require("node:path");

function createLibraryRepository({ getUserDataPath, fsImpl = fs } = {}) {
  if (typeof getUserDataPath !== "function") throw new TypeError("getUserDataPath is required");
  function dataPath() {
    const dir = path.join(getUserDataPath(), "library");
    fsImpl.mkdirSync(dir, { recursive: true });
    return path.join(dir, "games.json");
  }
  function readLibrary() {
    try { return JSON.parse(fsImpl.readFileSync(dataPath(), "utf8")); } catch { return []; }
  }
  function writeLibrary(games) {
    const value = Array.isArray(games) ? games : [];
    fsImpl.writeFileSync(dataPath(), JSON.stringify(value, null, 2), "utf8");
    return value;
  }
  function backupPayload(games, version = 1) {
    return { app: "Gal Launcher", version, exportedAt: new Date().toISOString(), games: Array.isArray(games) ? games : readLibrary() };
  }
  return { dataPath, readLibrary, writeLibrary, backupPayload };
}

module.exports = { createLibraryRepository };
