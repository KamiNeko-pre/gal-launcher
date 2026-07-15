const test = require("node:test");
const assert = require("node:assert/strict");
const { createSessionJournal } = require("./journal.cjs");

function memoryFs() {
  const files = new Map();
  return { files, mkdirSync() {}, readFileSync(file) { if (!files.has(file)) throw new Error("missing"); return files.get(file); }, writeFileSync(file, value) { files.set(file, value); } };
}

test("session journal records, snapshots, and removes sessions", () => {
  const fsImpl = memoryFs();
  const journal = createSessionJournal({ getUserDataPath: () => "C:\\user", fsImpl });
  journal.add("g1", "s1", "2026-01-01T00:00:00.000Z", 1);
  journal.snapshot("s1", 42);
  assert.equal(journal.read().s1.snapshotSeconds, 42);
  journal.remove("s1");
  assert.deepEqual(journal.read(), {});
});
