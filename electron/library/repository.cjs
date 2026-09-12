const fs = require("node:fs");
const path = require("node:path");
const { normalizeLibraryDocument } = require("./bookshelves.cjs");

function createLibraryRepository({ getUserDataPath, fsImpl = fs } = {}) {
  if (typeof getUserDataPath !== "function") throw new TypeError("getUserDataPath is required");
  function dataPath() {
    const dir = path.join(getUserDataPath(), "library");
    fsImpl.mkdirSync(dir, { recursive: true });
    return path.join(dir, "games.json");
  }
  function readLibrary() {
    return readDocument().games;
  }
  function readDocument() {
    try { return normalizeLibraryDocument(JSON.parse(fsImpl.readFileSync(dataPath(), "utf8"))); } catch { return normalizeLibraryDocument([]); }
  }
  function writeDocument(document) {
    const value = normalizeLibraryDocument(document);
    fsImpl.writeFileSync(dataPath(), JSON.stringify(value, null, 2), "utf8");
    return value;
  }
  function writeLibrary(games) {
    const value = Array.isArray(games) ? games : [];
    writeDocument({ ...readDocument(), games: value });
    return value;
  }
  function backupPayload(documentOrGames, version = 2) {
    const document = Array.isArray(documentOrGames)
      ? { ...readDocument(), games: documentOrGames }
      : documentOrGames && typeof documentOrGames === "object"
        ? normalizeLibraryDocument(documentOrGames)
        : readDocument();
    return {
      app: "Gal Launcher",
      version,
      exportedAt: new Date().toISOString(),
      games: document.games,
      bookshelves: document.bookshelves
    };
  }
  return { dataPath, readLibrary, writeLibrary, readDocument, writeDocument, backupPayload };
}

module.exports = { createLibraryRepository };
