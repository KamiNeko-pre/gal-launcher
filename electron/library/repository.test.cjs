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
  assert.deepEqual(repo.readLibrary(), games.map(game => ({ ...game, bookshelfIds: [] })));
  const backup = repo.backupPayload();
  assert.equal(backup.app, "Gal Launcher");
  assert.deepEqual(backup.games, games.map(game => ({ ...game, bookshelfIds: [] })));
});

test("repository returns an empty library for malformed data", () => {
  const fsImpl = memoryFs();
  const repo = createLibraryRepository({ getUserDataPath: () => "C:\\perf-user", fsImpl });
  fsImpl.files.set(repo.dataPath(), "not-json");
  assert.deepEqual(repo.readLibrary(), []);
});

test("repository migrates old arrays and persists bookshelf documents", () => {
  const fsImpl = memoryFs();
  const repo = createLibraryRepository({ getUserDataPath: () => "C:\\perf-user", fsImpl });
  fsImpl.files.set(repo.dataPath(), JSON.stringify([{ id: "a", title: "旧游戏" }]));
  const migrated = repo.readDocument();
  assert.equal(migrated.version, 2);
  assert.deepEqual(migrated.games[0].bookshelfIds, []);
  repo.writeDocument({ ...migrated, bookshelves: [{ id: "rain", name: "雨天" }], games: [{ ...migrated.games[0], bookshelfIds: ["rain"] }] });
  assert.deepEqual(repo.readDocument().games[0].bookshelfIds, ["rain"]);
});

test("backup payload preserves user-created bookshelves", () => {
  const fsImpl = memoryFs();
  const repo = createLibraryRepository({ getUserDataPath: () => "C:\\perf-user", fsImpl });
  const document = {
    version: 2,
    bookshelves: [{ id: "mood-rain", name: "雨天", createdAt: "2026-09-09T00:00:00.000Z" }],
    games: [{ id: "1", title: "Test", bookshelfIds: ["mood-rain"] }]
  };
  const backup = repo.backupPayload(document);
  assert.equal(backup.version, 2);
  assert.deepEqual(backup.bookshelves, document.bookshelves);
  assert.deepEqual(backup.games, document.games);
});
