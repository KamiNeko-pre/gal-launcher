const test = require("node:test");
const assert = require("node:assert/strict");
const { createLibraryRepository } = require("./repository.cjs");

function memoryFs() {
  const files = new Map();
  return {
    files,
    mkdirSync() {},
    readFileSync(file) { if (!files.has(file)) throw new Error("missing"); return files.get(file); },
    writeFileSync(file, value) { files.set(file, value); }
  };
}

test("repository round-trips library data and keeps backup envelope", () => {
  const fsImpl = memoryFs();
  const repo = createLibraryRepository({ getUserDataPath: () => "C:\\perf-user", fsImpl });
  const games = [{ id: "1", title: "Test" }];
  assert.deepEqual(repo.writeLibrary(games), games);
  assert.deepEqual(repo.readLibrary(), games);
  const backup = repo.backupPayload();
  assert.equal(backup.app, "Gal Launcher");
  assert.deepEqual(backup.games, games);
});

test("repository returns an empty library for malformed data", () => {
  const fsImpl = memoryFs();
  const repo = createLibraryRepository({ getUserDataPath: () => "C:\\perf-user", fsImpl });
  fsImpl.files.set(repo.dataPath(), "not-json");
  assert.deepEqual(repo.readLibrary(), []);
});
