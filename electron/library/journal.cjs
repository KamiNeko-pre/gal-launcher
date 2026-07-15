const fs = require("node:fs");
const path = require("node:path");

function createSessionJournal({ getUserDataPath, fsImpl = fs } = {}) {
  function filePath() {
    const dir = path.join(getUserDataPath(), "library");
    fsImpl.mkdirSync(dir, { recursive: true });
    return path.join(dir, "play-session-journal.json");
  }
  function read() {
    try { return JSON.parse(fsImpl.readFileSync(filePath(), "utf8")); } catch { return {}; }
  }
  function write(value) {
    fsImpl.mkdirSync(path.dirname(filePath()), { recursive: true });
    fsImpl.writeFileSync(filePath(), JSON.stringify(value, null, 2), "utf8");
  }
  function add(gameId, sessionId, startedAt, startedMs) {
    const journal = read();
    journal[sessionId] = { gameId, sessionId, startedAt, startedMs };
    write(journal);
  }
  function remove(sessionId) {
    const journal = read();
    delete journal[sessionId];
    write(journal);
  }
  function snapshot(sessionId, seconds) {
    const journal = read();
    if (!journal[sessionId]) return;
    journal[sessionId].snapshotSeconds = seconds;
    write(journal);
  }
  return { filePath, read, write, add, remove, snapshot };
}

module.exports = { createSessionJournal };
