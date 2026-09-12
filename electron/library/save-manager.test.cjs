const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  createSaveBackup,
  restoreSaveBackup,
  listSaveBackups
} = require("./save-manager.cjs");

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gal-launcher-save-test-"));
}

test("save backup preserves all configured directories and records a manifest", () => {
  const root = tempRoot();
  try {
    const saves = path.join(root, "game-saves");
    fs.mkdirSync(saves);
    fs.writeFileSync(path.join(saves, "slot1.dat"), "progress-a");
    const backup = createSaveBackup({
      userDataPath: path.join(root, "app-data"),
      gameId: "game-1",
      savePaths: [saves],
      now: new Date("2026-09-08T01:02:03.000Z")
    });

    assert.equal(backup.sources.length, 1);
    assert.equal(fs.readFileSync(path.join(backup.directory, "0", "slot1.dat"), "utf8"), "progress-a");
    assert.equal(listSaveBackups({ userDataPath: path.join(root, "app-data"), gameId: "game-1" }).length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("restore snapshots current saves before replacing them", () => {
  const root = tempRoot();
  try {
    const saves = path.join(root, "game-saves");
    fs.mkdirSync(saves);
    fs.writeFileSync(path.join(saves, "slot.dat"), "old");
    const options = { userDataPath: path.join(root, "app-data"), gameId: "game-1", savePaths: [saves] };
    const original = createSaveBackup({ ...options, now: new Date("2026-09-08T01:02:03.000Z") });
    fs.writeFileSync(path.join(saves, "slot.dat"), "new");
    fs.writeFileSync(path.join(saves, "extra.dat"), "remove-me");

    const result = restoreSaveBackup({ ...options, backupId: original.id, now: new Date("2026-09-08T02:02:03.000Z") });
    assert.equal(fs.readFileSync(path.join(saves, "slot.dat"), "utf8"), "old");
    assert.equal(fs.existsSync(path.join(saves, "extra.dat")), false);
    assert.equal(fs.readFileSync(path.join(result.preRestoreBackup.directory, "0", "slot.dat"), "utf8"), "new");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("restore rejects a backup whose configured source locations do not match", () => {
  const root = tempRoot();
  try {
    const saves = path.join(root, "game-saves");
    const other = path.join(root, "other-saves");
    fs.mkdirSync(saves);
    fs.mkdirSync(other);
    const backup = createSaveBackup({ userDataPath: path.join(root, "app-data"), gameId: "game-1", savePaths: [saves] });
    assert.throws(() => restoreSaveBackup({ userDataPath: path.join(root, "app-data"), gameId: "game-1", savePaths: [other], backupId: backup.id }), /存档位置/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
