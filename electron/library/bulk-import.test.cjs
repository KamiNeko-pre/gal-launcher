const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  dedupeLaunchCandidates,
  classifyLaunchCandidate,
  scanLaunchCandidates,
  scanLaunchCandidatesAsync
} = require("./bulk-import.cjs");

function directory(name) {
  return { name, isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false };
}

function file(name) {
  return { name, isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false };
}

function link(name) {
  return { name, isDirectory: () => false, isFile: () => false, isSymbolicLink: () => true };
}

test("candidate list deduplicates Windows paths case-insensitively", () => {
  const result = dedupeLaunchCandidates([
    { executablePath: "D:\\A\\game.exe" },
    { executablePath: "d:\\a\\GAME.exe" }
  ]);
  assert.equal(result.length, 1);
});

test("classifies generic setup tools for review without relying on game titles", () => {
  assert.equal(classifyLaunchCandidate("D:\\Game\\config.exe").needsReview, true);
  assert.equal(classifyLaunchCandidate("D:\\Game\\UnityCrashHandler64.exe").needsReview, true);
  assert.equal(classifyLaunchCandidate("D:\\Game\\OpenSaveFolder.exe").needsReview, true);
  assert.equal(classifyLaunchCandidate("D:\\Game\\Uninstaller.exe").needsReview, true);
  assert.equal(classifyLaunchCandidate("D:\\Game\\delfile.exe").needsReview, true);
  assert.equal(classifyLaunchCandidate("D:\\Game\\start.exe").recommended, true);
});

test("scans only first-level game folders and chooses a case-insensitive chs executable", () => {
  const root = path.resolve("D:\\games");
  const gameA = path.join(root, "游戏 A");
  const gameB = path.join(root, "游戏 B");
  const nested = path.join(gameA, "data");
  const directories = new Map([
    [root, [directory("游戏 A"), directory("游戏 B"), file("should-not-import.exe"), link("跳转目录")]],
    [gameA, [file("game.exe"), file("GAME_CHS.exe"), file("config.exe"), directory("data")]],
    [nested, [file("nested-helper.exe")]],
    [gameB, [file("start.exe")]]
  ]);
  const fsImpl = {
    existsSync: value => value === root,
    statSync: () => ({ isDirectory: () => true }),
    readdirSync: value => directories.get(value) || []
  };

  const result = scanLaunchCandidates(root, { fsImpl });

  assert.equal(result.skippedLinks, 1);
  assert.equal(result.candidates.length, 2);
  assert.deepEqual(result.candidates.map(item => item.title), ["游戏 A", "游戏 B"]);
  assert.equal(result.candidates[0].executablePath, path.join(gameA, "GAME_CHS.exe"));
  assert.equal(result.candidates[0].recommended, true);
  assert.equal(result.candidates[0].needsReview, false);
  assert.equal(result.candidates[0].installPath, gameA);
  assert.equal(result.candidates[1].executablePath, path.join(gameB, "start.exe"));
  assert.equal(result.candidates[1].recommended, true);
});

test("returns every launch choice for a folder when multiple executables have no chs match", () => {
  const root = path.resolve("D:\\games");
  const game = path.join(root, "作品");
  const directories = new Map([
    [root, [directory("作品")]],
    [game, [file("game.exe"), file("start.exe"), file("readme.exe")]]
  ]);
  const fsImpl = {
    existsSync: value => value === root,
    statSync: () => ({ isDirectory: () => true }),
    readdirSync: value => directories.get(value) || []
  };

  const result = scanLaunchCandidates(root, { fsImpl });

  assert.equal(result.candidates.length, 2);
  assert.deepEqual(result.candidates.map(item => item.executablePath), [path.join(game, "game.exe"), path.join(game, "start.exe")]);
  assert.ok(result.candidates.every(item => item.needsReview === true));
  assert.ok(result.candidates.every(item => item.recommended === false));
  assert.ok(result.candidates.every(item => item.installPath === game));
});

test("prefers a root chs executable over copies stored in backup folders", () => {
  const root = path.resolve("D:\\games");
  const game = path.join(root, "作品");
  const backup = path.join(game, "汉化补丁备份");
  const directories = new Map([
    [root, [directory("作品")]],
    [game, [file("game.exe"), file("GAME_CHS.exe"), directory("汉化补丁备份")]],
    [backup, [file("OLD_CHS.exe")]]
  ]);
  const fsImpl = {
    existsSync: value => value === root,
    statSync: () => ({ isDirectory: () => true }),
    readdirSync: value => directories.get(value) || []
  };

  const result = scanLaunchCandidates(root, { fsImpl });

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].executablePath, path.join(game, "GAME_CHS.exe"));
  assert.equal(result.candidates[0].workingDirectory, game);
  assert.equal(result.candidates[0].needsReview, false);
});

test("a busy game folder reaching its file budget does not hide later sibling games", () => {
  const root = path.resolve("D:\\games");
  const busy = path.join(root, "大型作品");
  const later = path.join(root, "后续作品");
  const directories = new Map([
    [root, [directory("大型作品"), directory("后续作品")]],
    [busy, [file("one.exe"), file("two.exe"), file("busy.exe")]],
    [later, [file("start.exe")]]
  ]);
  const fsImpl = {
    existsSync: value => value === root,
    statSync: () => ({ isDirectory: () => true }),
    readdirSync: value => directories.get(value) || []
  };

  const result = scanLaunchCandidates(root, { fsImpl, maxFiles: 2 });

  assert.equal(result.gameFolderCount, 2);
  assert.equal(result.limitReached, true);
  assert.equal(result.candidates.length, 3);
  assert.ok(result.candidates.filter(item => item.installPath === busy).every(item => item.needsReview));
  assert.ok(result.candidates.some(item => item.executablePath === path.join(later, "start.exe")));
});

test("a nested launcher uses its own directory as the working directory", () => {
  const root = path.resolve("D:\\games");
  const game = path.join(root, "作品");
  const runtime = path.join(game, "runtime");
  const directories = new Map([
    [root, [directory("作品")]],
    [game, [directory("runtime")]],
    [runtime, [file("game.exe"), file("UnityCrashHandler64.exe")]]
  ]);
  const fsImpl = {
    existsSync: value => value === root,
    statSync: () => ({ isDirectory: () => true }),
    readdirSync: value => directories.get(value) || []
  };

  const result = scanLaunchCandidates(root, { fsImpl });

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].executablePath, path.join(runtime, "game.exe"));
  assert.equal(result.candidates[0].workingDirectory, runtime);
  assert.equal(result.candidates[0].needsReview, false);
});

test("resource files do not consume EXE quota and async overflow preserves later folders", async () => {
  const root = path.resolve("D:\\games");
  const directories = new Map([
    [root, [directory("resources"), directory("overflow"), directory("later")]],
    [path.join(root, "resources"), [...Array.from({ length: 7000 }, (_, i) => file(`${i}.dat`)), file("game_ChS.exe"), file("game.exe")]],
    [path.join(root, "overflow"), [file("a.exe"), file("b.exe"), file("c.exe")]],
    [path.join(root, "later"), [file("game.exe")]]
  ]);
  const fsImpl = { existsSync: () => true, statSync: () => ({ isDirectory: () => true }),
    readdirSync: value => directories.get(value) || [], readdir: async value => directories.get(value) || [] };
  for (const scan of [scanLaunchCandidates, scanLaunchCandidatesAsync]) {
    const result = await scan(root, { fsImpl, maxFiles: 2 });
    assert.equal(result.gameFolderCount, 3);
    assert.equal(result.scannedFiles, 5);
    assert.equal(result.candidates.find(c => c.title === "resources").needsReview, false);
    assert.match(result.candidates.find(c => c.title === "resources").executablePath, /game_ChS.exe$/);
    assert.equal(result.candidates.find(c => c.title === "later").needsReview, false);
    assert.ok(result.candidates.filter(c => c.title === "overflow").every(c => c.needsReview));
  }
});

test("skips a folder with only setup executables into manual review", () => {
  const root = path.resolve("D:\\games");
  const game = path.join(root, "待确认");
  const directories = new Map([
    [root, [directory("待确认")]],
    [game, [file("setup.exe")]]
  ]);
  const fsImpl = {
    existsSync: value => value === root,
    statSync: () => ({ isDirectory: () => true }),
    readdirSync: value => directories.get(value) || []
  };

  const result = scanLaunchCandidates(root, { fsImpl });

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].needsReview, true);
  assert.equal(result.candidates[0].recommended, false);
});

test("async scan reports progress, skips unreadable game folders, and never executes candidates", async () => {
  const root = path.resolve("D:\\games");
  const game = path.join(root, "作品");
  const blocked = path.join(root, "无权限");
  const directories = new Map([
    [root, [directory("作品"), directory("无权限")]],
    [game, [file("start.exe")]]
  ]);
  const progress = [];
  const fsImpl = {
    existsSync: value => value === root,
    statSync: () => ({ isDirectory: () => true }),
    readdir: async value => {
      if (value === blocked) throw new Error("access denied");
      return directories.get(value) || [];
    }
  };

  const result = await scanLaunchCandidatesAsync(root, { fsImpl, onProgress: value => progress.push(value) });

  assert.equal(result.candidates.length, 1);
  assert.equal(result.skippedDirectories, 1);
  assert.equal(result.scannedFiles, 1);
  assert.ok(progress.some(value => value.scannedFiles === 1 && value.candidateCount === 1));
});

test("async scan can be cancelled without returning partial candidates as complete", async () => {
  const root = path.resolve("D:\\games");
  const controller = new AbortController();
  const fsImpl = {
    existsSync: () => true,
    statSync: () => ({ isDirectory: () => true }),
    readdir: async () => {
      controller.abort();
      return [directory("作品")];
    }
  };

  await assert.rejects(
    scanLaunchCandidatesAsync(root, { fsImpl, signal: controller.signal }),
    error => error.code === "cancelled"
  );
});

test("async scan works with the callback-based Node file system used by the main process", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gal-launcher-bulk-"));
  const game = path.join(root, "游戏 A");
  fs.mkdirSync(game);
  fs.writeFileSync(path.join(game, "game.exe"), "");

  try {
    const result = await scanLaunchCandidatesAsync(root);
    assert.equal(result.gameFolderCount, 1);
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].executablePath, path.join(game, "game.exe"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
