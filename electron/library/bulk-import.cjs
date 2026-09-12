const fs = require("node:fs");
const path = require("node:path");

const reviewNames = /(?:^|[-_ .])(uninstall|unins|setup|config|settings|patch|update|updater|readme|manual|help)(?:[-_ .]|$)/i;
const launchNames = /(?:^|[-_ .])(start|launch|launcher|game|play|run)(?:[-_ .]|$)/i;
// Conventional maintenance entry points, not game-specific exclusions.
const maintenanceNames = /^(?:uninstall(?:er)?|unins\d*|uninst|UnityCrashHandler(?:32|64)?|OpenSaveFolder|delfile)$/i;

function keyForPath(value) {
  return path.win32.normalize(String(value || "")).replace(/\\+$/, "").toLocaleLowerCase();
}

function classifyLaunchCandidate(executablePath) {
  const base = path.basename(executablePath, path.extname(executablePath));
  const needsReview = reviewNames.test(base) || maintenanceNames.test(base);
  return { recommended: launchNames.test(base) && !needsReview, needsReview };
}

function dedupeLaunchCandidates(candidates) {
  const unique = new Map();
  for (const item of candidates || []) {
    const key = keyForPath(item.executablePath);
    if (key && !unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()];
}

function candidateForExecutable(root, gameFolder, executablePath) {
  return {
    executablePath,
    relativePath: path.relative(root, executablePath),
    installPath: gameFolder,
    workingDirectory: path.dirname(executablePath),
    title: path.basename(gameFolder) || path.basename(executablePath, path.extname(executablePath)),
    ...classifyLaunchCandidate(executablePath)
  };
}

function isChsExecutable(executablePath) {
  return /chs/i.test(path.basename(executablePath, path.extname(executablePath)));
}

function needsExecutableReview(executablePath, fsImpl) {
  if (typeof fsImpl.openSync !== "function") return false;
  let fd;
  try {
    fd = fsImpl.openSync(executablePath, "r");
    const dos = Buffer.alloc(64);
    if (fsImpl.readSync(fd, dos, 0, 64, 0) !== 64 || dos.readUInt16LE(0) !== 0x5a4d) return true;
    const pe = Buffer.alloc(94);
    if (fsImpl.readSync(fd, pe, 0, pe.length, dos.readUInt32LE(60)) !== pe.length || pe.readUInt32LE(0) !== 0x4550) return true;
    // Windows GUI subsystem. Console utilities remain available for manual choice.
    return pe.readUInt16LE(92) !== 2;
  } catch { return true; }
  finally { if (fd !== undefined) fsImpl.closeSync(fd); }
}

function finalizeChoices(root, gameFolder, executablePaths, incomplete, fsImpl) {
  return chooseGameCandidates(root, gameFolder, executablePaths).map(item =>
    incomplete || needsExecutableReview(item.executablePath, fsImpl)
      ? { ...item, recommended: false, needsReview: true } : item);
}

/**
 * Treat one first-level directory as one game. All executable alternatives
 * found below that directory keep the same installPath, so the renderer can
 * require at most one selection for the game folder.
 */
function chooseGameCandidates(root, gameFolder, executablePaths) {
  // An executable beside the game's files is authoritative over copies in
  // nested folders. Only descend for entry points when none exist at this level.
  const minimumDepth = Math.min(...executablePaths.map(value => path.relative(gameFolder, value).split(path.sep).length));
  const candidates = executablePaths
    .filter(value => path.relative(gameFolder, value).split(path.sep).length === minimumDepth)
    .slice()
    .sort((left, right) => keyForPath(left).localeCompare(keyForPath(right)))
    .map((executablePath) => candidateForExecutable(root, gameFolder, executablePath));
  if (!candidates.length) return [];

  const launchable = candidates.filter((candidate) => !candidate.needsReview);
  if (launchable.length === 1) {
    return [{ ...launchable[0], recommended: true, needsReview: false }];
  }

  const chsCandidates = launchable.filter((candidate) => isChsExecutable(candidate.executablePath));
  if (launchable.length > 1 && chsCandidates.length === 1) {
    return [{ ...chsCandidates[0], recommended: true, needsReview: false }];
  }

  // More than one viable executable without a unique chs winner, or a folder
  // containing only setup/config-like executables, must be confirmed by user.
  return (launchable.length ? launchable : candidates)
    .map((candidate) => ({ ...candidate, recommended: false, needsReview: true }));
}

function countGameFolders(candidates) {
  return new Set((candidates || []).map((candidate) => keyForPath(candidate.installPath))).size;
}

function countReviewFolders(candidates) {
  return new Set((candidates || [])
    .filter((candidate) => candidate.needsReview)
    .map((candidate) => keyForPath(candidate.installPath))).size;
}

function validateRoot(rootPath, fsImpl) {
  if (typeof rootPath !== "string" || !rootPath.trim()) throw new Error("导入目录不可用");
  const root = path.resolve(rootPath);
  if (!fsImpl.existsSync(root) || !fsImpl.statSync(root).isDirectory()) throw new Error("导入目录不可用");
  return root;
}

function scanLaunchCandidates(rootPath, {
  maxDepth = 8,
  maxFiles = 6000,
  maxGameFolders = 2000,
  fsImpl = fs
} = {}) {
  const root = validateRoot(rootPath, fsImpl);
  let scannedFiles = 0;
  let skippedLinks = 0;
  let skippedDirectories = 0;
  let limitReached = false;
  let gameFolderCount = 0;
  const candidates = [];
  let rootEntries;
  try {
    rootEntries = fsImpl.readdirSync(root, { withFileTypes: true });
  } catch {
    throw new Error("无法读取导入目录");
  }

  for (const rootEntry of rootEntries) {
    if (rootEntry.isSymbolicLink()) {
      skippedLinks++;
      continue;
    }
    if (!rootEntry.isDirectory()) continue;
    if (gameFolderCount >= maxGameFolders) {
      limitReached = true;
      break;
    }

    const gameFolder = path.join(root, rootEntry.name);
    gameFolderCount++;
    const executablePaths = [];
    let folderLimitReached = false;
    const visit = (directory, depth) => {
      if (folderLimitReached) return;
      let entries;
      try {
        entries = fsImpl.readdirSync(directory, { withFileTypes: true });
      } catch {
        skippedDirectories++;
        return;
      }
      const hasExecutables = entries.some(entry => entry.isFile() && path.extname(entry.name).toLowerCase() === ".exe");
      for (const entry of entries) {
        if (folderLimitReached) break;
        const fullPath = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) {
          skippedLinks++;
          continue;
        }
        if (entry.isDirectory()) {
          if (hasExecutables) continue;
          if (depth >= maxDepth) {
            limitReached = true;
            continue;
          }
          visit(fullPath, depth + 1);
          continue;
        }
        if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".exe") continue;
        if (executablePaths.length >= maxFiles) {
          limitReached = true;
          folderLimitReached = true;
          break;
        }
        scannedFiles++;
        if (path.extname(entry.name).toLocaleLowerCase() === ".exe") executablePaths.push(fullPath);
      }
    };
    visit(gameFolder, 0);
    candidates.push(...finalizeChoices(root, gameFolder, executablePaths, folderLimitReached, fsImpl));
  }

  const normalizedCandidates = dedupeLaunchCandidates(candidates);
  return {
    rootPath: root,
    gameFolderCount,
    scannedFiles,
    skippedLinks,
    skippedDirectories,
    limitReached,
    needsReviewCount: countReviewFolders(normalizedCandidates),
    candidates: normalizedCandidates
  };
}

function cancelledScanError() {
  const error = new Error("游戏目录扫描已取消");
  error.code = "cancelled";
  return error;
}

function assertScanNotCancelled(signal) {
  if (signal?.aborted) throw cancelledScanError();
}

async function readDirectory(fsImpl, directory) {
  if (fsImpl.promises && typeof fsImpl.promises.readdir === "function") {
    return fsImpl.promises.readdir(directory, { withFileTypes: true });
  }
  if (typeof fsImpl.readdir === "function") {
    if (fsImpl.readdir.length >= 3) {
      return new Promise((resolve, reject) => {
        fsImpl.readdir(directory, { withFileTypes: true }, (error, entries) => error ? reject(error) : resolve(entries));
      });
    }
    return fsImpl.readdir(directory, { withFileTypes: true });
  }
  return fsImpl.readdirSync(directory, { withFileTypes: true });
}

async function scanLaunchCandidatesAsync(rootPath, {
  maxDepth = 8,
  maxFiles = 6000,
  maxGameFolders = 2000,
  fsImpl = fs,
  signal,
  onProgress
} = {}) {
  const root = validateRoot(rootPath, fsImpl);
  let scannedFiles = 0;
  let skippedLinks = 0;
  let skippedDirectories = 0;
  let limitReached = false;
  let gameFolderCount = 0;
  const candidates = [];
  const report = () => onProgress?.({
    gameFolderCount,
    scannedFiles,
    candidateCount: countGameFolders(candidates),
    needsReviewCount: countReviewFolders(candidates),
    skippedDirectories,
    skippedLinks,
    limitReached
  });

  let rootEntries;
  try {
    rootEntries = await readDirectory(fsImpl, root);
  } catch {
    throw new Error("无法读取导入目录");
  }

  report();
  for (const rootEntry of rootEntries) {
    assertScanNotCancelled(signal);
    if (rootEntry.isSymbolicLink()) {
      skippedLinks++;
      report();
      continue;
    }
    if (!rootEntry.isDirectory()) continue;
    if (gameFolderCount >= maxGameFolders) {
      limitReached = true;
      break;
    }

    const gameFolder = path.join(root, rootEntry.name);
    gameFolderCount++;
    const executablePaths = [];
    let folderLimitReached = false;
    const visit = async (directory, depth) => {
      assertScanNotCancelled(signal);
      let entries;
      try {
        entries = await readDirectory(fsImpl, directory);
      } catch {
        skippedDirectories++;
        report();
        return;
      }
      const hasExecutables = entries.some(entry => entry.isFile() && path.extname(entry.name).toLowerCase() === ".exe");
      for (const entry of entries) {
        assertScanNotCancelled(signal);
        const fullPath = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) {
          skippedLinks++;
          report();
          continue;
        }
        if (entry.isDirectory()) {
          if (hasExecutables) continue;
          if (depth >= maxDepth) {
            limitReached = true;
            report();
            continue;
          }
          await visit(fullPath, depth + 1);
          if (folderLimitReached) return;
          continue;
        }
        if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".exe") continue;
        if (executablePaths.length >= maxFiles) {
          limitReached = true;
          folderLimitReached = true;
          report();
          return;
        }
        scannedFiles++;
        if (path.extname(entry.name).toLocaleLowerCase() === ".exe") executablePaths.push(fullPath);
        report();
        await new Promise((resolve) => setImmediate(resolve));
      }
    };
    await visit(gameFolder, 0);
    assertScanNotCancelled(signal);
    candidates.push(...finalizeChoices(root, gameFolder, executablePaths, folderLimitReached, fsImpl));
    report();
  }

  assertScanNotCancelled(signal);
  const normalizedCandidates = dedupeLaunchCandidates(candidates);
  report();
  return {
    rootPath: root,
    gameFolderCount,
    scannedFiles,
    skippedLinks,
    skippedDirectories,
    limitReached,
    needsReviewCount: countReviewFolders(normalizedCandidates),
    candidates: normalizedCandidates
  };
}

module.exports = {
  classifyLaunchCandidate,
  dedupeLaunchCandidates,
  scanLaunchCandidates,
  scanLaunchCandidatesAsync,
  chooseGameCandidates,
  countGameFolders,
  countReviewFolders
};
