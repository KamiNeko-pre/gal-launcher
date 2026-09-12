const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function backupRoot(userDataPath, gameId) {
  if (!userDataPath || !gameId) throw new Error("缺少游戏存档备份位置");
  return path.join(userDataPath, "library", "save-backups", String(gameId));
}

function normalizeSavePaths(savePaths) {
  const unique = new Map();
  for (const value of Array.isArray(savePaths) ? savePaths : []) {
    const resolved = typeof value === "string" ? path.resolve(value) : "";
    if (resolved) unique.set(resolved.toLowerCase(), resolved);
  }
  return [...unique.values()];
}

function requireExistingDirectories(savePaths) {
  const paths = normalizeSavePaths(savePaths);
  if (!paths.length) throw new Error("请先添加至少一个存档位置");
  for (const source of paths) {
    if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
      throw new Error(`存档位置不可用：${source}`);
    }
  }
  return paths;
}

function makeBackupId(now = new Date()) {
  return `${now.toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
}

function writeManifest(directory, manifest) {
  fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
}

function readManifest(directory) {
  try { return JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8")); } catch { return null; }
}

function createSaveBackup({ userDataPath, gameId, savePaths, now = new Date(), reason = "manual" }) {
  const sources = requireExistingDirectories(savePaths);
  const id = makeBackupId(now);
  const directory = path.join(backupRoot(userDataPath, gameId), id);
  fs.mkdirSync(directory, { recursive: true });
  sources.forEach((source, index) => fs.cpSync(source, path.join(directory, String(index)), { recursive: true, force: true }));
  const manifest = {
    id,
    createdAt: now.toISOString(),
    reason,
    sources: sources.map((source, index) => ({ path: source, snapshot: String(index) }))
  };
  writeManifest(directory, manifest);
  return { ...manifest, directory };
}

function listSaveBackups({ userDataPath, gameId }) {
  const root = backupRoot(userDataPath, gameId);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ directory: path.join(root, entry.name), manifest: readManifest(path.join(root, entry.name)) }))
    .filter((item) => item.manifest?.id && Array.isArray(item.manifest.sources))
    .map((item) => ({ ...item.manifest, directory: item.directory }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function clearDirectory(directory) {
  for (const entry of fs.readdirSync(directory)) {
    fs.rmSync(path.join(directory, entry), { recursive: true, force: true });
  }
}

function restoreSaveBackup({ userDataPath, gameId, savePaths, backupId, now = new Date() }) {
  const sources = requireExistingDirectories(savePaths);
  const backup = listSaveBackups({ userDataPath, gameId }).find((item) => item.id === backupId);
  if (!backup) throw new Error("未找到所选存档备份");
  const recorded = backup.sources.map((item) => path.resolve(item.path).toLowerCase());
  if (recorded.length !== sources.length || sources.some((source) => !recorded.includes(path.resolve(source).toLowerCase()))) {
    throw new Error("当前存档位置与该备份不一致，请确认后再恢复");
  }
  const preRestoreBackup = createSaveBackup({ userDataPath, gameId, savePaths: sources, now, reason: "before-restore" });
  try {
    backup.sources.forEach((source) => {
      const target = sources.find((item) => path.resolve(item).toLowerCase() === path.resolve(source.path).toLowerCase());
      const snapshot = path.join(backup.directory, source.snapshot);
      if (!target || !fs.existsSync(snapshot)) throw new Error("备份文件不完整，已停止恢复");
      clearDirectory(target);
      fs.cpSync(snapshot, target, { recursive: true, force: true });
    });
  } catch (error) {
    throw new Error(`恢复失败，当前存档已保留在恢复前备份中：${error.message}`);
  }
  return { backup, preRestoreBackup };
}

module.exports = { backupRoot, normalizeSavePaths, createSaveBackup, listSaveBackups, restoreSaveBackup };
