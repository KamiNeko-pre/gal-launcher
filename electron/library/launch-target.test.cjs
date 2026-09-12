const test = require("node:test");
const assert = require("node:assert/strict");

const {
  inspectLaunchTarget,
  stripTransientInstallationState,
} = require("./launch-target.cjs");

test("stored missing status is removed without checking the disk", () => {
  const original = {
    id: "deleted-game",
    title: "已通关后删除的游戏",
    executablePath: "D:\\removed\\game.exe",
    installationStatus: "missing",
    totalPlaySeconds: 7200,
    playCount: 3,
  };

  const result = stripTransientInstallationState(original);

  assert.equal("installationStatus" in result.game, false);
  assert.equal(result.changed, true);
  assert.equal(result.game.totalPlaySeconds, 7200);
  assert.equal(result.game.playCount, 3);
  assert.equal(original.installationStatus, "missing");
});

test("stored available status is also removed so startup state never drives the UI", () => {
  const result = stripTransientInstallationState({
    id: "moved-game",
    executablePath: "E:\\old-location\\start.exe",
    installationStatus: "available",
  });

  assert.equal("installationStatus" in result.game, false);
  assert.equal(result.changed, true);
});

test("ordinary records remain unchanged when they have no transient installation state", () => {
  const original = { id: "collection-only", title: "收藏", executablePath: "" };
  const result = stripTransientInstallationState(original);

  assert.deepEqual(result.game, original);
  assert.equal(result.changed, false);
});

test("launch-time inspection distinguishes deleted, disconnected, and available targets", () => {
  const existing = new Set(["E:\\games\\ready.exe"]);
  const existsSync = (targetPath) => existing.has(targetPath);

  assert.deepEqual(
    inspectLaunchTarget({ executablePath: "D:\\deleted\\game.exe" }, { existsSync }),
    { available: false, reason: "missing-executable" }
  );
  assert.deepEqual(
    inspectLaunchTarget({ executablePath: "Z:\\disconnected\\game.exe" }, { existsSync }),
    { available: false, reason: "missing-executable" }
  );
  assert.deepEqual(
    inspectLaunchTarget({ executablePath: "E:\\games\\ready.exe" }, { existsSync }),
    { available: true, executablePath: "E:\\games\\ready.exe" }
  );
});
