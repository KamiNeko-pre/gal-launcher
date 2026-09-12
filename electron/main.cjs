const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, protocol, session, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { AsyncLocalStorage } = require("node:async_hooks");
const { spawn, execFile } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { createNetworkClient } = require("./network/client.cjs");
const { applyProxyConfiguration, environmentProxyConfiguration } = require("./network/proxy.cjs");
const {
  ratingPatchForFailure,
  ratingPatchForMatch,
  ratingPatchForNoMatch
} = require("./metadata/bangumi.cjs");
const {
  createGalgameWikiClient,
  toMetadataCandidate: toGalgameWikiCandidate,
  toMetadataPatch: toGalgameWikiPatch
} = require("./metadata/galgamewiki.cjs");
const { successfulTranslation, translateLongText } = require("./metadata/translation.cjs");
const { prepareMagpieScaling } = require("./integrations/magpie.cjs");
const { applyMagpiePreset, publicMagpiePresets } = require("./integrations/magpie-presets.cjs");
const { prepareLocaleEmulator, launchLocaleEmulator } = require("./integrations/locale-emulator.cjs");
const { isGameEnhancementEnabled } = require("./integrations/game-enhancement.cjs");
const { createToolManager } = require("./integrations/tool-manager.cjs");
const { createLibraryRepository } = require("./library/repository.cjs");
const { normalizeLibraryDocument } = require("./library/bookshelves.cjs");
const { scanLaunchCandidatesAsync } = require("./library/bulk-import.cjs");
const { toggleWindowFullscreen } = require("./window/fullscreen.cjs");
const { createSessionJournal } = require("./library/journal.cjs");
const { archiveGameImages } = require("./library/asset-archive.cjs");
const { inspectLaunchTarget, stripTransientInstallationState } = require("./library/launch-target.cjs");
const { createSaveBackup, listSaveBackups, restoreSaveBackup } = require("./library/save-manager.cjs");
const { captureProcessBaseline, findRunningSessionPids, monitorRootForGame, getChildPids } = require("./play-session/process-tree.cjs");
const {
  clearSessionIfCurrent,
  freezeSessionCompletion,
  mergeAuthoritativePlayState,
  persistCompletedSession,
  persistStartedSession,
  releaseGameLaunch,
  reserveGameLaunch
} = require("./play-session/session-state.cjs");
const { getAppIconPath } = require("./window/icon-path.cjs");
const { createDomainLimiter } = require("./search/domain-limiter.cjs");
const { summarizeCoverSearch } = require("./search/cover-search-status.cjs");
const { COVER_CANDIDATE_CACHE_VERSION, cachedCoverCandidates, hasCachedCoverCandidates } = require("./search/cover-cache.cjs");
const { isReliableCommunityTitleMatch } = require("./search/community-title-match.cjs");
const { isLandscapeCoverDimensions } = require("./search/cover-eligibility.cjs");
const { classifyBulkMetadataCandidates } = require("./metadata/bulk-match-policy.cjs");

if (process.env.GAL_LAUNCHER_PERF_USER_DATA) {
  app.setPath("userData", path.resolve(process.env.GAL_LAUNCHER_PERF_USER_DATA));
}

// Route external requests through Electron's network stack so the session
// proxy configured below also applies to metadata and translation providers.
let directSession;
let environmentProxySession;
function isTransportFailure(error) {
  return /ERR_(?:PROXY_CONNECTION_FAILED|TUNNEL_CONNECTION_FAILED|NO_SUPPORTED_PROXIES|CONNECTION_(?:TIMED_OUT|REFUSED|RESET)|NAME_NOT_RESOLVED|INTERNET_DISCONNECTED|NETWORK_CHANGED)|operation was aborted/i.test(String(error?.message || ""));
}
function directRetryArguments(args) {
  const [url, options] = args;
  if (!options?.signal?.aborted) return args;
  return [url, { ...options, signal: AbortSignal.timeout(10000) }];
}
const networkClient = createNetworkClient({
  fetchImpl: async (...args) => {
    try { return await net.fetch(...args); }
    catch (error) {
      if (!isTransportFailure(error)) throw error;
      // A failed or timed-out proxy route must not make directly reachable
      // sources unavailable. An already-aborted request needs a fresh signal.
      if (directSession) {
        try { return await directSession.fetch(...directRetryArguments(args)); } catch (directError) { error = directError; }
      }
      // Environment proxy variables are a fallback only: system/PAC rules stay
      // authoritative, and a request switches session only after that route fails.
      if (environmentProxySession) return environmentProxySession.fetch(...args);
      throw error;
    }
  }
});
const directNetworkClient = createNetworkClient({ fetchImpl: (...args) => directSession.fetch(...args) });
const galgameWikiClient = createGalgameWikiClient({
  requestJson: (...args) => directNetworkClient.requestJson(...args),
  userAgent: `Gal Launcher/${app.getVersion()} (+https://github.com/KamiNeko-pre/gal-launcher)`
});
const coverSearchAttempts = new AsyncLocalStorage();
const fetch = async (...args) => {
  try {
    const response = await networkClient.fetch(...args);
    coverSearchAttempts.getStore()?.push({ ok: response.ok, httpStatus: response.status });
    return response;
  } catch (error) {
    coverSearchAttempts.getStore()?.push({ ok: false, error });
    throw error;
  }
};
const libraryRepository = createLibraryRepository({ getUserDataPath: () => app.getPath("userData") });
const { readLibrary, writeLibrary, readDocument, writeDocument, backupPayload } = libraryRepository;
let enhancementToolManager;
function getEnhancementToolManager() {
  if (!enhancementToolManager) {
    enhancementToolManager = createToolManager({
      rootPath: path.join(app.getPath("userData"), "enhancement-tools"),
      fetchImpl: (...args) => fetch(...args),
      prepareLocaleRuntimeScriptPath: app.isPackaged
        ? path.join(process.resourcesPath, "prepare-locale-runtime.ps1")
        : path.join(__dirname, "integrations", "prepare-locale-runtime.ps1")
    });
  }
  return enhancementToolManager;
}
function getMagpieUserConfigPath() {
  const localAppData = process.env.LOCALAPPDATA
    || (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "AppData", "Local") : "");
  return localAppData ? path.join(localAppData, "Magpie", "config", "v4", "config.json") : "";
}
const sessionJournal = createSessionJournal({ getUserDataPath: () => app.getPath("userData") });
const { read: readJournal, write: writeJournal, add: journalAdd, remove: journalRemove, snapshot: journalSnapshot } = sessionJournal;

const perfStartedAt = Date.now();
const perfMarks = {};
function markPerf(name) {
  if (!process.env.GAL_LAUNCHER_PERF_LOG) return;
  perfMarks[name] = { at: new Date().toISOString(), msSinceStart: Date.now() - perfStartedAt };
  try {
    fs.mkdirSync(path.dirname(process.env.GAL_LAUNCHER_PERF_LOG), { recursive: true });
    fs.writeFileSync(process.env.GAL_LAUNCHER_PERF_LOG, JSON.stringify(perfMarks, null, 2), "utf8");
  } catch { /* diagnostics must never affect startup */ }
}

  const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
  let mainWindow;
  const activePlaySessions = new Map();
  const pendingGameLaunches = new Set();
  const activeLaunchScans = new Map();

  const coverDomainLimiter = createDomainLimiter();
  function fetchCover(url, options = {}) {
    return coverDomainLimiter.run(url, 3, () => fetch(url, options));
  }
  function fetchCoverWithRetry(url, options = {}, retries = 2) {
    return coverDomainLimiter.run(url, 3, () => fetchWithRetry(url, options, retries));
  }

async function configureProxy(proxyPort) {
  try {
    const options = {
      env: process.env,
      environmentProxyPolicy: "fallback",
      proxyBypassRules: "lzacg.cc,*.lzacg.cc,ossimg.nyaya.top,*.ossimg.nyaya.top,<local>"
    };
    if (proxyPort !== undefined) options.proxyPort = proxyPort;
    return await applyProxyConfiguration(session.defaultSession, options);
  } catch (err) {
    console.warn("[proxy] 代理配置失败，尝试恢复系统代理:", err.message);
    try {
      return await applyProxyConfiguration(session.defaultSession, { proxyPort: null });
    } catch (resetError) {
      console.warn("[proxy] 无法恢复系统代理:", resetError.message);
      return null;
    }
  }
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "local-file",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true
    }
  }
]);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: "#121316",
    title: "Gal Launcher",
    icon: getAppIconPath({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      projectRoot: path.join(__dirname, "..")
    }),
    titleBarStyle: "hiddenInset",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  markPerf("browser-window-created");
  mainWindow.on("enter-full-screen", () => mainWindow?.webContents.send("window:fullscreenChanged", true));
  mainWindow.on("leave-full-screen", () => mainWindow?.webContents.send("window:fullscreenChanged", false));
  mainWindow.webContents.on("dom-ready", () => markPerf("dom-ready"));
  mainWindow.webContents.on("did-finish-load", () => markPerf("did-finish-load"));

  // Register F12 to toggle DevTools (Ctrl+Shift+I doesn't work with autoHideMenuBar)
  mainWindow.webContents.on("before-input-event", (_event, input) => {
    if (input.key === "F12" && input.type === "keyDown") {
      mainWindow.webContents.toggleDevTools();
    }
  });

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

function assetDir(name) {
  const dir = path.join(app.getPath("userData"), "library", name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function normalizeLibraryForRuntime(games) {
  if (!Array.isArray(games)) return [];
  const nowMs = Date.now();
  const journal = readJournal();
  let changed = false;
  let journalChanged = false;
  const normalized = [];
  const MAX_RECOVERY_SECONDS = 24 * 3600; // 24-hour cap for crash recovery

  for (const game of games) {
    const stored = stripTransientInstallationState(game);
    const next = {
      ...stored.game,
      playCount: Number.isFinite(game.playCount) ? game.playCount : 0,
      totalPlaySeconds: Number.isFinite(game.totalPlaySeconds) ? game.totalPlaySeconds : 0,
      currentSessionId: game.currentSessionId ?? null,
      currentSessionStartedAt: game.currentSessionStartedAt ?? null
    };
    if (stored.changed) changed = true;

    if (next.currentSessionStartedAt) {
      const startedMs = new Date(next.currentSessionStartedAt).getTime();
      if (!Number.isFinite(startedMs)) {
        // Corrupt timestamp — clear session fields
        next.currentSessionId = null;
        next.currentSessionStartedAt = null;
        changed = true;
      } else {
        // Ensure sessionId exists
        if (!next.currentSessionId) {
          next.currentSessionId = crypto.randomUUID();
          changed = true;
        }

        // Only recover if a matching journal entry proves this was a real session
        const journalEntry = journal[next.currentSessionId];
        if (journalEntry) {
          const baselinePids = Array.isArray(journalEntry.baselinePids) ? journalEntry.baselinePids : [];
          const pids = await findRunningSessionPids({
            trackedPids: [],
            baselinePids,
            monitorRoot: monitorRootForGame(next)
          });
          if (pids === null || pids.length > 0) {
            // Game still running — resume monitoring
            startPlaySession(next, next.currentSessionId, next.currentSessionStartedAt, pids, startedMs, baselinePids);
          } else {
            // Crashed: prefer exact snapshot from before-quit, fall back to wall clock with 24h cap
            let recoveryDuration;
            if (typeof journalEntry.snapshotSeconds === "number" && journalEntry.snapshotSeconds >= 0) {
              recoveryDuration = Math.min(journalEntry.snapshotSeconds, MAX_RECOVERY_SECONDS);
            } else {
              const computedSeconds = Math.round((nowMs - startedMs) / 1000);
              recoveryDuration = Math.max(0, Math.min(computedSeconds, MAX_RECOVERY_SECONDS));
            }
            next.totalPlaySeconds += recoveryDuration;
            const sessions = Array.isArray(next.sessions) ? next.sessions : [];
            sessions.push({
              sessionId: next.currentSessionId,
              startedAt: next.currentSessionStartedAt,
              endedAt: new Date(nowMs).toISOString(),
              durationSeconds: recoveryDuration
            });
            next.sessions = sessions.slice(-50);
            next.currentSessionId = null;
            next.currentSessionStartedAt = null;
            changed = true;

            // Clean up journal entry
            delete journal[next.currentSessionId];
            journalChanged = true;
          }
        } else {
          // No journal entry — orphan session fields, just clear them
          next.currentSessionId = null;
          next.currentSessionStartedAt = null;
          changed = true;
        }
      }
    }

    normalized.push(next);
  }

  // Clean up stale journal entries that don't match any game
  for (const sid of Object.keys(journal)) {
    if (!normalized.some((g) => g.currentSessionId === sid)) {
      delete journal[sid];
      journalChanged = true;
    }
  }

  if (changed) writeLibrary(normalized);
  if (journalChanged) writeJournal(journal);
  return normalized;
}

function guessTitleFromPath(filePath) {
  const dir = path.dirname(filePath);
  const folder = path.basename(dir);
  const file = path.basename(filePath, path.extname(filePath));
  return folder && folder !== "." ? folder : file;
}

function readDirSafe(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function walkFiles(root, depth = 2, limit = 3000) {
  const output = [];
  const ignoredDirs = new Set([
    "$recycle.bin",
    "node_modules",
    "save",
    "savedata",
    "patch",
    "htvoice",
    "dic",
    "cursor",
    "ptclpi"
  ]);

  function visit(dir, level) {
    if (level > depth || output.length >= limit) return;
    for (const entry of readDirSafe(dir)) {
      if (output.length >= limit) return;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirs.has(entry.name.toLowerCase())) visit(fullPath, level + 1);
        continue;
      }
      if (entry.isFile()) output.push(fullPath);
    }
  }

  visit(root, 0);
  return output;
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function readTextFile(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    const utf8 = buffer.toString("utf8").replace(/^\uFEFF/, "");
    const badChars = (utf8.match(/\uFFFD/g) || []).length;
    if (badChars <= 2) return utf8;
    try {
      return new TextDecoder("shift_jis").decode(buffer).replace(/^\uFEFF/, "");
    } catch {
      return utf8;
    }
  } catch {
    return "";
  }
}

function normalizeTags(value) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean);
  return cleanText(value)
    .split(/[,，、/|]/)
    .map(cleanText)
    .filter(Boolean);
}

function imageDimensions(filePath) {
  if (/\.webp$/i.test(filePath)) {
    const webp = webpDimensions(filePath);
    if (webp.width && webp.height) return { ...webp, ratio: webp.width / webp.height };
  }
  try {
    const image = nativeImage.createFromPath(filePath);
    if (image.isEmpty()) return { width: 0, height: 0, ratio: 0 };
    const { width, height } = image.getSize();
    return { width, height, ratio: height ? width / height : 0 };
  } catch {
    return { width: 0, height: 0, ratio: 0 };
  }
}

function webpDimensions(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    if (buffer.slice(0, 4).toString("ascii") !== "RIFF" || buffer.slice(8, 12).toString("ascii") !== "WEBP") {
      return { width: 0, height: 0 };
    }

    for (let offset = 12; offset < buffer.length - 16; ) {
      const chunk = buffer.slice(offset, offset + 4).toString("ascii");
      const size = buffer.readUInt32LE(offset + 4);
      if (chunk === "VP8X") {
        return {
          width: 1 + buffer.readUIntLE(offset + 12, 3),
          height: 1 + buffer.readUIntLE(offset + 15, 3)
        };
      }
      if (chunk === "VP8 ") {
        const start = offset + 8;
        const keyFrame = buffer.indexOf(Buffer.from([0x9d, 0x01, 0x2a]), start);
        if (keyFrame >= 0 && keyFrame + 7 < buffer.length) {
          return {
            width: buffer.readUInt16LE(keyFrame + 3) & 0x3fff,
            height: buffer.readUInt16LE(keyFrame + 5) & 0x3fff
          };
        }
      }
      if (chunk === "VP8L") {
        const bits = buffer.readUInt32LE(offset + 9);
        return {
          width: (bits & 0x3fff) + 1,
          height: ((bits >> 14) & 0x3fff) + 1
        };
      }
      offset += 8 + size + (size % 2);
    }
  } catch {}
  return { width: 0, height: 0 };
}

function scoreImage(filePath, mode) {
  const name = path.basename(filePath).toLowerCase();
  const parent = path.basename(path.dirname(filePath)).toLowerCase();
  const joined = `${parent}/${name}`;
  const badWords = ["icon", "logo", "button", "cursor", "config", "staff", "credit", "copyright", "uninst", "save", "thumbnail", "thumb", "caution", "warning", "group", "qq", "wechat", "readme", "manual", "交流群"];
  const coverWords = ["cover", "jacket", "package", "pkg", "poster", "パッケージ", "ジャケット"];
  const backgroundWords = ["mainvisual", "keyvisual", "kv", "background", "wallpaper", "hero", "ogp", "top", "メイン", "キービジュアル"];
  const dimensions = imageDimensions(filePath);
  const semanticWords = mode === "cover" ? coverWords : backgroundWords;
  const hasSemanticName = semanticWords.some((word) => joined.includes(word));
  let score = 0;

  for (const word of badWords) {
    if (joined.includes(word)) score -= 40;
  }
  for (const word of semanticWords) {
    if (joined.includes(word)) score += 38;
  }

  try {
    const size = fs.statSync(filePath).size;
    if (size < 80 * 1024) score -= 42;
    if (size > 250 * 1024) score += 10;
    if (size > 900 * 1024) score += 10;
  } catch {
    score -= 50;
  }

  if (dimensions.width < 360 || dimensions.height < 360) score -= 60;
  if (mode === "cover") {
    if (dimensions.ratio >= 0.55 && dimensions.ratio <= 0.9) score += 46;
    if (dimensions.ratio > 1.15) score -= 20;
    if (!hasSemanticName) score -= 34;
  } else {
    if (dimensions.ratio >= 1.35) score += 48;
    if (dimensions.width >= 1200 || dimensions.height >= 720) score += 20;
    if (dimensions.ratio < 1.1) score -= 44;
    if (/screenshot|sample|event|cg|ss[0-9_-]?|ev[0-9_-]?/i.test(joined)) score -= 38;
    if (!hasSemanticName) score -= 70;
  }

  if (/^(staff|banner|icon|logo|btn|cursor)\./i.test(name)) score -= 70;
  return score;
}

function pickBestImage(files, mode) {
  const images = files.filter((file) => /\.(png|jpe?g|webp|bmp)$/i.test(file));
  if (images.length === 0) return "";
  const best = images
    .map((file) => ({ file, score: scoreImage(file, mode) }))
    .sort((a, b) => b.score - a.score)[0];
  return best.score >= (mode === "cover" ? 58 : 70) ? best.file : "";
}

function scanRoots(installPath) {
  const roots = [installPath];
  const base = path.basename(installPath).toLowerCase();
  if (/patch|chs|cn|zh|汉化|補丁|补丁|ai翻译|translation/i.test(base)) {
    roots.push(path.dirname(installPath));
  }
  const parent = path.basename(path.dirname(installPath)).toLowerCase();
  if (/patch|chs|cn|zh|汉化|補丁|补丁|ai翻译|translation/i.test(parent)) {
    roots.push(path.dirname(path.dirname(installPath)));
  }
  return Array.from(new Set(roots)).filter((root) => root && fs.existsSync(root));
}

function readJsonMetadata(files) {
  const preferredNames = ["metadata", "game", "info", "vndb", "product"];
  const jsonFiles = files
    .filter((file) => path.extname(file).toLowerCase() === ".json")
    .sort((a, b) => {
      const an = path.basename(a, ".json").toLowerCase();
      const bn = path.basename(b, ".json").toLowerCase();
      return Number(preferredNames.some((key) => bn.includes(key))) - Number(preferredNames.some((key) => an.includes(key)));
    });

  for (const file of jsonFiles.slice(0, 8)) {
    try {
      const data = JSON.parse(readTextFile(file));
      const title = cleanText(data.title ?? data.name ?? data.productName ?? data.workTitle);
      const originalTitle = cleanText(data.originalTitle ?? data.original_title ?? data.japaneseTitle ?? data.jaTitle);
      const developer = cleanText(data.developer ?? data.brand ?? data.maker ?? data.circle ?? data.publisher);
      const releaseDate = cleanText(data.releaseDate ?? data.release_date ?? data.date ?? data.released);
      const description = cleanText(data.description ?? data.summary ?? data.story ?? data.introduction ?? data.intro);
      const tags = normalizeTags(data.tags ?? data.genres ?? data.genre);
      if (title || originalTitle || developer || releaseDate || description || tags.length) {
        return { title, originalTitle, developer, releaseDate, description, tags };
      }
    } catch {
      continue;
    }
  }

  return {};
}

function readXmlMetadata(files) {
  const startup = files.find((file) => /(^|[\\/])config[\\/]startup\.xml$/i.test(file));
  if (!startup) return {};
  const text = readTextFile(startup);
  const title = cleanText(text.match(/<title>([^<]+)<\/title>/i)?.[1]);
  return title ? { title } : {};
}

function readBootDfnMetadata(files) {
  const boot = files.find((file) => /(^|[\\/])boot\.dfn$/i.test(file));
  if (!boot) return {};
  const text = readTextFile(boot);
  const developer = cleanText(text.match(/^\s*brand\s+"([^"]+)"/m)?.[1]);
  const title = cleanText(text.match(/^\s*title\s+"([^"]+)"/m)?.[1]);
  return {
    developer: developer && !developer.includes("\uFFFD") ? developer : "",
    title: title && !title.includes("\uFFFD") ? title : ""
  };
}

function readTextMetadata(files, installPath) {
  const textFiles = files
    .filter((file) => /\.(txt|md)$/i.test(file))
    .filter((file) => path.dirname(file) === installPath)
    .filter((file) => /story|intro|introduction|summary|about|作品|紹介/i.test(path.basename(file)))
    .slice(0, 6);

  for (const file of textFiles) {
    const text = readTextFile(file)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !/^[-=#*_\s]+$/.test(line))
      .slice(0, 18)
      .join("\n");

    if (/HTS Voice|MMDAgent|Copyright|DirectX|乱码|杀毒软件|补丁|免DVD|攻略/i.test(text)) continue;
    if (text.length > 24) return { description: text.slice(0, 520) };
  }

  return {};
}

function parseFolderMetadata(folderName) {
  const metadata = { title: folderName.replace(/[_-]?(chs|cn|zh|utf8|patch|步兵|无码)$/i, "") };
  const bracket = folderName.match(/^\s*[\[\(【](.+?)[\]\)】]\s*(.+)$/);
  if (bracket) {
    metadata.developer = bracket[1].trim();
    metadata.title = bracket[2].trim();
  }

  const parenSuffix = metadata.title.match(/^(.+?)\s*[\(（](.+?)[\)）]\s*$/);
  if (parenSuffix && !metadata.developer) {
    metadata.title = parenSuffix[1].trim();
    metadata.developer = parenSuffix[2].trim();
  }

  return metadata;
}

function scanGameMetadata(installPath, executablePath) {
  const files = scanRoots(installPath).flatMap((root) => walkFiles(root, 4, 2200));
  const folderMeta = parseFolderMetadata(path.basename(installPath));
  const jsonMeta = readJsonMetadata(files);
  const xmlMeta = readXmlMetadata(files);
  const bootMeta = readBootDfnMetadata(files);
  const textMeta = readTextMetadata(files, installPath);

  return {
    title: jsonMeta.title || xmlMeta.title || bootMeta.title || folderMeta.title || guessTitleFromPath(executablePath),
    originalTitle: jsonMeta.originalTitle || "",
    developer: jsonMeta.developer || bootMeta.developer || folderMeta.developer || "",
    releaseDate: jsonMeta.releaseDate || "",
    description: jsonMeta.description || textMeta.description || "",
    tags: jsonMeta.tags || [],
    coverPath: pickBestImage(files, "cover"),
    backgroundPath: pickBestImage(files, "background")
  };
}

function stripMarkup(text) {
  return cleanText(text)
    .replace(/\[url=[^\]]+\]/gi, "")
    .replace(/\[\/url\]/gi, "")
    .replace(/\[(?:spoiler|quote|i|b|u)\]/gi, "")
    .replace(/\[\/(?:spoiler|quote|i|b|u)\]/gi, "")
    .replace(/\r/g, "")
    .trim();
}

function normalizeSearchText(value) {
  return cleanText(value)
    .replace(/\.(exe|bat|cmd|lnk)$/i, "")
    .replace(/(^|[^\p{L}\p{N}])(?:chs|cn|zh|utf8|patch|translation|crack|uncensor|ai|gemini|claude|deepseek|v\d+(?:\.\d+)*)(?=$|[^\p{L}\p{N}])/giu, "$1 ")
    .replace(/\b(?:version|ver)\s*\d+(?:\.\d+)*\b/gi, " ")
    .replace(/[【】\[\]（）()]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();
}

function isGenericSearchText(value) {
  const text = normalizeSearchText(value);
  if (!text) return true;
  if (text.length < 3) return true;
  return new Set([
    "galgame",
    "game",
    "games",
    "visual novel",
    "visual novels",
    "新建文件夹",
    "汉化",
    "汉化补丁",
    "补丁",
    "patch",
    "crack",
    "setup",
    "start",
    "launcher",
    "launch",
    "boot",
    "config",
    "update",
    "siglusengine",
    "siglusengine chs",
    "siglusengine cn",
    "data"
  ]).has(text);
}

function collectTitleVariants(game) {
  const titles = [game.title, game.originalTitle, game.vndbTitle, game.vndbOriginalTitle]
    .filter((value) => typeof value === "string" && cleanText(value))
    .map(cleanText);
  if (titles.length) return Array.from(new Set(titles));

  // A file system name is only a fallback before a game has an identifiable
  // title. Directory names, developer names and tags are contextual metadata,
  // not alternative titles; searching them can produce unrelated games.
  const fallback = [
    path.basename(game.installPath || ""),
    path.basename(game.executablePath || "", path.extname(game.executablePath || ""))
  ].filter((value) => cleanText(value)).map(cleanText);
  return Array.from(new Set(fallback));
}

function expandSearchAlias(query) {
  const output = [query];
  if (/sakuranotoki|sakura\s*no\s*toki|sakura\s*toki/i.test(query)) output.push("Sakura no Toki", "サクラノ刻", "樱之刻", "櫻之刻");
  if (/hokejyo|hokejo|hokenshitsu|joshu/i.test(query)) output.push("Hokenshitsu no Sensei to Shabondama Chuudoku no Joshu", "保健室のセンセーとシャボン玉中毒の助手", "保健室的老师与肥皂泡中毒的助手");
  if (/hungry\s+lamb|the\s+hungry\s+lamb/i.test(query)) output.push("饿殍", "明末千里行", "Hungry Lamb");
  if (/tenshi\s+sz|tenshi|angelic\s+chaos/i.test(query)) output.push("天使骚骚", "天使☆騒々", "Tenshi Souzou", "Angel Chaos");
  if (/nine\s+yukiiro|9\s+nine|yukiiro/i.test(query)) output.push("9-nine", "雪色雪花雪余痕");
  if (/dracu/i.test(query)) output.push("DRACU-RIOT", "德拉库里奥特");
  if (/hamidashi|creative/i.test(query)) output.push("常轨脱离Creative", "ハミダシクリエイティブ");
  if (/otome\s*domain/i.test(query)) output.push("少女领域", "オトメドメイン");
  if (/haison/i.test(query)) output.push("废村少女", "廃村少女");
  if (/limelight/i.test(query)) output.push("聚光灯下的青柠恋曲", "ライムライト");
  if (/nekonin|neko\s*nin/i.test(query)) output.push("猫忍之心", "NEKO-NIN");
  if (/amakano2plus|amakano2\s*plus/i.test(query)) output.push("甜蜜女友2+", "アマカノ2+");
  if (/amakano3/i.test(query)) output.push("甜蜜女友3", "アマカノ3");
  if (/amakano2pe|amakanop[e]?|amakano2/i.test(query)) output.push("甜蜜女友2", "アマカノ2");
  if (/anemoi/i.test(query)) output.push("anemoi");
  if (/\bwa\s*2\b|white\s*album\s*2|white\s*album2|bum2/i.test(query)) output.push("WHITE ALBUM2", "白色相簿2", "白色相簿 2");
  if (/tsukiniyori|tsuki\s*ni\s*yori|otome\s*no\s*sahou|近月|キンゲツ|つきに?より|tukiniyori/i.test(query)) output.push("Tsuki ni Yori Sou Otome no Sahou", "Tsuki ni Yorisou Otome no Sahou", "月に寄りそう乙女の作法", "近月少女的礼仪", "近月少女");
  return output;
}

function titleQueriesFor(game) {
  const variants = collectTitleVariants(game);
  // Apply hardcoded aliases only to the primary 2 variants
  const primary = variants.slice(0, 2).flatMap(expandSearchAlias);
  const rest = variants.slice(2).map(normalizeSearchText).filter((item) => !isGenericSearchText(item));
  return Array.from(new Set([...primary, ...rest].filter((item) => !isGenericSearchText(item)))).slice(0, 10);
}

function rawTitleQueriesFor(game) {
  const variants = collectTitleVariants(game);
  // Primary variants get alias expansion + dual raw/normalized forms
  const primary = variants.slice(0, 2).flatMap((item) => {
    const raw = cleanText(item).replace(/\.(exe|bat|cmd|lnk)$/i, "");
    return expandSearchAlias(raw).flatMap((q) => [q, normalizeSearchText(q)]);
  });
  // Secondary variants: just normalized form
  const secondary = variants.slice(2).map((item) => {
    const raw = cleanText(item).replace(/\.(exe|bat|cmd|lnk)$/i, "");
    return normalizeSearchText(raw);
  });
  return Array.from(new Set([...primary, ...secondary].filter((item) => !isGenericSearchText(item)))).slice(0, 16);
}

function steamFallbackExecutableQuery(game) {
  const executableName = path.basename(game.executablePath || "", path.extname(game.executablePath || ""));
  const query = cleanText(executableName);
  return isGenericSearchText(query) ? "" : query;
}

function isSteamGameDetails(details) {
  return Boolean(details) && details.type === "game";
}

function similarity(a, b) {
  const left = normalizeSearchText(a);
  const right = normalizeSearchText(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftNumbers = left.match(/\d+/g) || [];
  const rightNumbers = right.match(/\d+/g) || [];
  const numberMismatch = leftNumbers.length > 0 && rightNumbers.length > 0 && leftNumbers.join(",") !== rightNumbers.join(",");
  const numberMissing = (leftNumbers.length > 0) !== (rightNumbers.length > 0);
  if (numberMismatch || numberMissing) return 0;
  if (left.includes(right) || right.includes(left)) return 0.86;
  const leftParts = new Set(left.split(/\s+/).filter((part) => part.length >= 2 || /^\d+$/.test(part)));
  const rightParts = new Set(right.split(/\s+/).filter((part) => part.length >= 2 || /^\d+$/.test(part)));
  if (leftParts.size === 0 || rightParts.size === 0) return 0;
  let hit = 0;
  for (const part of leftParts) {
    if (rightParts.has(part)) hit += 1;
  }
  let score = hit / Math.max(leftParts.size, rightParts.size);
  if (numberMismatch) score -= 0.35;
  if (numberMissing) score -= 0.28;
  return Math.max(0, score);
}

function scoreVnCandidate(query, vn) {
  const titles = [vn.title, vn.alttitle, ...(vn.titles || []).flatMap((title) => [title.title, title.latin])].filter(Boolean);
  return Math.max(...titles.map((title) => similarity(query, title)), 0);
}

function stripHtml(text) {
  return stripMarkup(String(text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
}

function isMostlyEnglish(text) {
  const value = cleanText(text);
  if (!value) return false;
  const latin = (value.match(/[A-Za-z]/g) || []).length;
  const cjk = (value.match(/[\u3400-\u9fff]/g) || []).length;
  return latin > 80 && latin > cjk * 4;
}

function hasCjk(text) {
  return /[\u3400-\u9fff]/.test(String(text || ""));
}

const vndbTagTranslations = new Map([
  ["ADV", "文字冒险"],
  ["High School", "高中"],
  ["University", "大学"],
  ["Drama", "剧情"],
  ["Romance", "恋爱"],
  ["Comedy", "喜剧"],
  ["Slice of Life", "日常"],
  ["Nakige", "泣系"],
  ["Utsuge", "郁系"],
  ["Pure Love Story", "纯爱"],
  ["Mystery", "悬疑"],
  ["Suspense", "悬念"],
  ["Supernatural", "超自然"],
  ["Fantasy", "幻想"],
  ["Action", "动作"],
  ["Multiple Endings", "多结局"],
  ["Male Protagonist", "男主角"],
  ["Female Protagonist", "女主角"],
  ["School Festival", "学园祭"],
  ["Musical Environment", "音乐"],
  ["Musician Heroine", "音乐人女主"],
  ["Insert Songs", "插入歌"],
  ["The Holiday Season", "节日季"],
  ["Other Perspectives", "多视角"],
  ["Childhood Friend Heroine", "青梅竹马"],
  ["Student Council", "学生会"],
  ["Club Activities", "社团活动"],
  ["Countryside", "乡村"],
  ["Urban", "都市"],
  ["Winter", "冬季"],
  ["Summer", "夏季"]
]);

async function translateToChinese(text) {
  const value = stripMarkup(text || "").replace(/\n{3,}/g, "\n\n").trim();
  if (!value) return { text: value, status: "empty" };
  const result = await translateLongText(value, {
    chunkSize: 450,
    requireStructuredResults: true,
    translateChunk: async (chunk) => {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=${encodeURIComponent(chunk)}`;
      const response = await networkClient.requestJson(url, {
        headers: { "User-Agent": `Gal Launcher/${app.getVersion()}` },
        timeoutMs: 4000
      });
      if (response.status !== "success") return { status: "error" };
      return successfulTranslation((response.data?.[0] || []).map((part) => part[0]).join(""));
    },
    fallbackChunk: async (chunk) => {
      const fallbackUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=en|zh-CN`;
      const fallback = await directNetworkClient.requestJson(fallbackUrl, {
        headers: { "User-Agent": `Gal Launcher/${app.getVersion()}` },
        timeoutMs: 6000
      });
      if (fallback.status !== "success" || Number(fallback.data?.responseStatus) !== 200) return { status: "error" };
      const translatedText = String(fallback.data?.responseData?.translatedText || "");
      if (/QUERY LENGTH LIMIT EXCEEDED|MAX ALLOWED QUERY/i.test(translatedText)) return { status: "error" };
      return successfulTranslation(translatedText);
    }
  });
  return { ...result, original: value };
}

function pickVndbTags(vn) {
  return (vn.tags || [])
    .filter((tag) => tag.spoiler === 0)
    .filter((tag) => tag.category !== "ero")
    .filter((tag) => Number(tag.rating || 0) >= 1.7)
    .sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0))
    .map((tag) => vndbTagTranslations.get(tag.name) || tag.name)
    .filter(Boolean)
    .filter((tag, index, list) => list.indexOf(tag) === index)
    .slice(0, 8);
}

function pickPreferredTitle(vn) {
  const titles = vn.titles || [];
  return (
    titles.find((title) => title.lang === "zh-Hans")?.title ||
    titles.find((title) => title.lang === "zh-Hant")?.title ||
    titles.find((title) => title.main)?.title ||
    vn.title ||
    ""
  );
}

async function searchVndb(query) {
  const operation = coverSearchAttempts.getStore();
  if (!operation) return requestVndbSearch(query);
  operation.vndbRequests ||= new Map();
  if (!operation.vndbRequests.has(query)) operation.vndbRequests.set(query, requestVndbSearch(query));
  return operation.vndbRequests.get(query);
}

async function requestVndbSearch(query) {
  const response = await fetchWithRetry("https://api.vndb.org/kana/vn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filters: ["search", "=", query],
      fields: "id,title,alttitle,titles.title,titles.latin,titles.lang,titles.main,description,image.url,screenshots.url,screenshots.thumbnail,released,developers.name,tags.name,tags.rating,tags.spoiler,tags.category,extlinks.url,extlinks.label,extlinks.name",
      results: 5
    }),
    signal: AbortSignal.timeout(7000)
  });
  if (!response.ok) throw new Error(`VNDB ${response.status}`);
  return (await response.json()).results || [];
}

async function getVndbById(id) {
  if (!id) return null;
  const response = await fetch("https://api.vndb.org/kana/vn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filters: ["id", "=", id],
      fields: "id,title,alttitle,titles.title,titles.latin,titles.lang,titles.main,description,image.url,screenshots.url,screenshots.thumbnail,released,developers.name,tags.name,tags.rating,tags.spoiler,tags.category,extlinks.url,extlinks.label,extlinks.name",
      results: 1
    }),
    signal: AbortSignal.timeout(7000)
  });
  if (!response.ok) return null;
  return ((await response.json()).results || [])[0] || null;
}

async function downloadOnlineImage(url, id, dirName) {
  if (!url) return "";
  const ext = path.extname(new URL(url).pathname).toLowerCase() || ".jpg";
  const safeExt = [".jpg", ".jpeg", ".png", ".webp"].includes(ext) ? ext : ".jpg";
  const filePath = path.join(assetDir(dirName), `${id}${safeExt}`);
  if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) return filePath;

  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" },
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) return "";
  fs.writeFileSync(filePath, Buffer.from(await response.arrayBuffer()));
  return filePath;
}

async function enrichOnlineMetadata(game) {
  const candidates = await searchMetadataCandidates(game, "");
  const best = candidates[0];
  if (!best || best.confidence < 0.72) {
    return { confidence: best?.confidence || 0, source: "none" };
  }
  return hydrateMetadataCandidate(game, best);
}

async function enrichBulkMetadata(game) {
  const candidates = await searchMetadataCandidates(game, "");
  const decision = classifyBulkMetadataCandidates(candidates);
  if (decision.kind !== "apply") return decision;
  return { kind: "apply", metadata: await hydrateMetadataCandidate(game, decision.candidate) };
}

async function searchMetadataCandidates(game, keyword = "") {
  const queries = keyword ? [keyword, ...titleQueriesFor({ ...game, title: keyword, originalTitle: keyword })] : titleQueriesFor(game);
  const matches = [];
  const galgameWikiMatches = [];
  let completedQueries = 0;
  const uniqueQueries = Array.from(new Set(queries)).slice(0, 10);
  await Promise.all(
    uniqueQueries.map((query) => coverDomainLimiter.run("https://api.vndb.org", 3, async () => {
      try {
        const results = await searchVndb(query);
        completedQueries++;
        for (const vn of results) {
          const confidence = scoreVnCandidate(query, vn);
          if (confidence >= 0.5) matches.push({ vn, confidence, query });
        }
      } catch {
        // Independent fallback sources continue below.
      }
    }))
  );

  // The community source is intentionally a fallback: it is useful on direct
  // Chinese networks, but should not add 1–3 detail requests to every VNDB hit.
  if (!matches.length && uniqueQueries[0]) {
    await coverDomainLimiter.run("https://www.galgamewiki.com", 1, async () => {
      try {
        const results = await galgameWikiClient.search(uniqueQueries[0]);
        completedQueries++;
        for (const item of results) {
          const candidate = toGalgameWikiCandidate(uniqueQueries[0], item, similarity);
          if (candidate.confidence >= 0.5) galgameWikiMatches.push(candidate);
        }
      } catch {
        // VNDB and Bangumi remain usable if the community source is unavailable.
      }
    });
  }

  if (!matches.length && !galgameWikiMatches.length) {
    const fallback = await Promise.allSettled(uniqueQueries.slice(0, 4).map(async (query) => {
      const response = await directNetworkClient.requestJson("https://api.bgm.tv/v0/search/subjects", {
        method: "POST", headers: { "Content-Type": "application/json", "User-Agent": `Gal Launcher/${app.getVersion()}` },
        body: JSON.stringify({ keyword: query, filter: { type: [4] }, sort: "match" }), timeoutMs: 6000
      });
      if (response.status !== "success" || !Array.isArray(response.data?.data)) throw new Error("Bangumi unavailable");
      completedQueries++;
      return response.data.data.map(item => ({
        source: "bangumi", sourceId: String(item.id),
        confidence: Math.max(similarity(query, item.name || ""), similarity(query, item.name_cn || "")),
        matchedQuery: query, title: item.name_cn || item.name || "", originalTitle: item.name || "",
        developer: "", releaseDate: item.date || "", descriptionPreview: stripMarkup(item.summary || "").slice(0, 220),
        coverUrl: item.images?.large || item.images?.common || ""
      })).filter(item => item.confidence >= 0.5);
    }));
    const byId = new Map();
    for (const result of fallback) if (result.status === "fulfilled") for (const item of result.value) {
      if (!byId.has(item.sourceId) || byId.get(item.sourceId).confidence < item.confidence) byId.set(item.sourceId, item);
    }
    if (byId.size) return [...byId.values()].sort((a, b) => b.confidence - a.confidence).slice(0, 8);
    if (!completedQueries) throw new Error("资料搜索失败：VNDB、GalgameWiki 和 Bangumi 均不可用，请检查网络后重试");
  }

  const bestById = new Map();
  for (const match of matches.sort((a, b) => b.confidence - a.confidence)) {
    const existing = bestById.get(match.vn.id);
    if (!existing || match.confidence > existing.confidence) bestById.set(match.vn.id, match);
  }

  const vndbCandidates = Array.from(bestById.values())
    .sort((a, b) => b.confidence - a.confidence)
    .map(({ vn, confidence, query }) => ({
      source: "vndb",
      sourceId: vn.id,
      confidence,
      matchedQuery: query,
      title: pickPreferredTitle(vn),
      originalTitle: vn.alttitle || vn.title || "",
      developer: (vn.developers || []).map((item) => item.name).filter(Boolean).join(", "),
      releaseDate: vn.released || "",
      descriptionPreview: stripMarkup(vn.description || "").slice(0, 220),
      coverUrl: vn.image?.url || ""
    }));

  return [...vndbCandidates, ...galgameWikiMatches]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 8);
}

async function hydrateMetadataCandidate(game, candidate, { forceTranslation = false } = {}) {
  if (candidate.source === "galgamewiki") {
    const item = await galgameWikiClient.getById(candidate.sourceId);
    return toGalgameWikiPatch(item, candidate.confidence);
  }
  if (candidate.source === "bangumi") {
    if (!/^\d+$/.test(String(candidate.sourceId))) throw new Error("无效的 Bangumi 条目");
    const result = await directNetworkClient.requestJson(`https://api.bgm.tv/v0/subjects/${candidate.sourceId}`, {
      headers: { "User-Agent": `Gal Launcher/${app.getVersion()}` }, timeoutMs: 6000
    });
    if (result.status !== "success" || !result.data?.id) throw new Error("备用资料加载失败，请稍后重试");
    const item = result.data;
    const original = stripMarkup(item.summary || "");
    const translated = await translateToChinese(original);
    const chinese = ["success", "already_zh"].includes(translated.status) ? translated.text : "";
    return {
      source: "bangumi", sourceId: String(item.id), confidence: candidate.confidence,
      metadataSource: "bangumi", metadataSourceId: String(item.id), metadataConfidence: candidate.confidence,
      title: item.name_cn || item.name, originalTitle: item.name, releaseDate: item.date || "",
      description: translated.text, descriptionOriginal: original, descriptionZh: chinese,
      descriptionSourceHash: crypto.createHash("sha256").update(original, "utf8").digest("hex"),
      translationStatus: translated.status, translationUpdatedAt: new Date().toISOString(),
      coverPath: item.images?.large || item.images?.common || ""
    };
  }
  const vn = (await getVndbById(candidate.sourceId)) || (await searchVndb(candidate.title || "")).find((item) => item.id === candidate.sourceId);
  if (!vn) return { confidence: 0, source: "none" };
  const coverPath = vn.image?.url || "";
  const descriptionOriginal = stripMarkup(vn.description || "");
  const descriptionSourceHash = crypto.createHash("sha256").update(descriptionOriginal, "utf8").digest("hex");
  let translation = { text: descriptionOriginal, status: "failed" };
  if (!forceTranslation && game.descriptionSourceHash === descriptionSourceHash && game.descriptionZh) {
    translation = { text: game.descriptionZh, status: "success" };
  } else {
    try { translation = await translateToChinese(descriptionOriginal); } catch { /* preserve the original description */ }
  }
  const title = pickPreferredTitle(vn);
  const developer = (vn.developers || []).map((item) => item.name).filter(Boolean).join(", ");

  return {
    source: "vndb",
    sourceId: vn.id,
    confidence: candidate.confidence || 0,
    title,
    originalTitle: vn.alttitle || vn.title || "",
    developer,
    releaseDate: vn.released || "",
    description: translation.text,
    descriptionOriginal,
    descriptionZh: translation.status === "success" || translation.status === "already_zh" ? translation.text : "",
    descriptionSourceHash,
    translationStatus: translation.status,
    translationUpdatedAt: new Date().toISOString(),
    metadataSource: "vndb",
    metadataSourceId: vn.id,
    metadataConfidence: candidate.confidence,
    coverPath,
    backgroundPath: coverPath,
    tags: []
  };
}

function coverCandidateScore(filePath, sourceWeight = 0) {
  const dimensions = imageDimensions(filePath);
  if (!dimensions.width || !dimensions.height) return null;
  const { width, height, ratio } = dimensions;

  if (!isLandscapeCoverDimensions({ width, height, ratio })) return null;

  const megapixels = (width * height) / 1_000_000;
  const name = path.basename(filePath).toLowerCase();
  let score = sourceWeight + Math.min(80, megapixels * 28);
  if (ratio >= 1.45 && ratio <= 1.95) score += 50;
  if (width >= 1280) score += 28;
  if (width >= 1920) score += 24;
  if (height >= 720) score += 18;
  if (/mainvisual|keyvisual|visual|kv|hero|background|wallpaper|ogp|top|main|official/i.test(name)) score += 28;
  if (/cover|jacket|package|poster|icon|logo|button|thumb|thumbnail|caution|warning|readme|manual|sprite/i.test(name)) score -= 60;
  if (/cg|ss|sample|event/i.test(name)) score -= 24;

  return { width, height, score };
}

function urlHintScore(url) {
  const value = decodeURIComponent(String(url || "")).toLowerCase();
  let score = 0;
  if (/keyvisual|mainvisual|main-visual|kv|mv|hero|mainimg|main_img|mainimage|topvisual|top_visual/i.test(value)) score += 80;
  if (/background|wallpaper|visual|ogp|twitter|top|bg/i.test(value)) score += 38;
  if (/1920|1600|1440|1366|1280|1080|720/i.test(value)) score += 26;
  if (/bnr|banner|logo|icon|button|btn|thumb|thumbnail|package|jacket|cover|poster/i.test(value)) score -= 70;
  if (/cg|sample|ss|screenshot|event|gallery|character|chara|face|stand|sprite/i.test(value)) score -= 48;
  return score;
}

function localCoverCandidates(game) {
  const roots = scanRoots(game.installPath || path.dirname(game.executablePath || ""));
  const files = roots.flatMap((root) => walkFiles(root, 4, 3500)).filter((file) => /\.(png|jpe?g|webp|bmp)$/i.test(file));
  return files
    .map((file) => {
      const scored = coverCandidateScore(file, 20);
      if (!scored) return null;
      return {
        id: crypto.createHash("sha1").update(file).digest("hex"),
        title: path.basename(file),
        source: "本地文件夹",
        path: file,
        width: scored.width,
        height: scored.height,
        score: scored.score,
        reason: "来自游戏目录"
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
}

function existingCoverCandidate(game) {
  if (!game.backgroundPath || !fs.existsSync(game.backgroundPath)) return null;
  const scored = coverCandidateScore(game.backgroundPath, 120);
  if (!scored) return null;
  return {
    id: crypto.createHash("sha1").update(`current-background:${game.backgroundPath}`).digest("hex"),
    title: path.basename(game.backgroundPath),
    source: "当前横版图",
    path: game.backgroundPath,
    width: scored.width,
    height: scored.height,
    score: scored.score,
    reason: "已在主页中使用"
  };
}

function candidateFilePath(game, url, prefix) {
  const ext = path.extname(new URL(url).pathname).toLowerCase();
  const safeExt = [".jpg", ".jpeg", ".png", ".webp"].includes(ext) ? ext : ".jpg";
  const hash = crypto.createHash("sha1").update(url).digest("hex").slice(0, 14);
  return path.join(assetDir("cover-candidates"), `${game.id || "candidate"}-${prefix}-${hash}${safeExt}`);
}

function coverCodeVersion() {
  try {
    return fs.statSync(__filename).mtimeMs.toString(36);
  } catch {
    return "0";
  }
}

function coverCacheKey(game) {
  const value = [
    game.id,
    game.title,
    game.originalTitle,
    game.developer,
    game.installPath,
    game.executablePath,
    coverCodeVersion()
  ].filter(Boolean).join("|");
  return crypto.createHash("sha1").update(value || "unknown").digest("hex");
}

function coverCachePath(game) {
  return path.join(assetDir("cover-candidate-cache"), `${coverCacheKey(game)}.json`);
}

function readCoverCandidateCache(game) {
  const payload = readJsonFile(coverCachePath(game), null);
  return cachedCoverCandidates(payload, { existsSync: fs.existsSync });
}

function writeCoverCandidateCache(game, candidates) {
  writeJsonFile(coverCachePath(game), {
    version: COVER_CANDIDATE_CACHE_VERSION,
    updatedAt: new Date().toISOString(),
    candidates
  });
}

async function downloadCandidate(game, url, source, sourceWeight, reason) {
  if (!url) return null;
  const filePath = candidateFilePath(game, url, source.toLowerCase().replace(/[^a-z0-9]+/g, ""));
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
    const response = await fetchCover(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" },
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) { console.log(`[cover] ${source} download failed: HTTP ${response.status} — ${url.slice(0, 80)}`); return null; }
    fs.writeFileSync(filePath, Buffer.from(await response.arrayBuffer()));
  }

  const scored = coverCandidateScore(filePath, sourceWeight + urlHintScore(url));
  if (!scored) {
    if (!process.env.COVER_QUIET) {
      const dim = imageDimensions(filePath);
      console.log(`[cover] ${source} rejected: ${dim.width}x${dim.height} ratio=${dim.ratio?.toFixed(2)} (min 1080x600, ratio 1.18-2.8) — ${path.basename(filePath)}`);
    }
    return null;
  }
  return {
    id: crypto.createHash("sha1").update(`${source}:${url}`).digest("hex"),
    title: path.basename(filePath),
    source,
    path: filePath,
    width: scored.width,
    height: scored.height,
    score: scored.score,
    reason
  };
}

function coverSourcePriority(source) {
  const value = String(source || "");
  if (/Steam/i.test(value)) return 90;
  if (/官网|official/i.test(value)) return 72;
  if (/DLsite/i.test(value)) return 68;
  if (/2DFan/i.test(value)) return 52;
  if (/量子|Lzacg/i.test(value)) return 46;
  if (/本地|当前横版图/i.test(value)) return 38;
  if (/VNDB/i.test(value)) return 28;
  if (/Bangumi/i.test(value)) return 26;
  return 0;
}

function mergeCoverCandidates(candidateGroups) {
  const byPath = new Map();
  for (const candidate of candidateGroups.flat().filter(Boolean)) {
    const existing = byPath.get(candidate.path);
    if (!existing || candidate.score > existing.score) byPath.set(candidate.path, candidate);
  }
  return Array.from(byPath.values())
    .sort((a, b) => (b.score + coverSourcePriority(b.source)) - (a.score + coverSourcePriority(a.source)) || b.height * b.width - a.height * a.width)
    .slice(0, 24);
}

async function fetchWithRetry(url, options = {}, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;
      if (response.status >= 500 && attempt < retries) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1) + Math.random() * 400));
        continue;
      }
      return response;
    } catch (err) {
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1) + Math.random() * 400));
        continue;
      }
      throw err;
    }
  }
}

async function searchBangumi(query) {
  const response = await fetch("https://api.bgm.tv/v0/search/subjects", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": `Gal Launcher/${app.getVersion()} (https://github.com/KamiNeko-pre/gal-launcher)`
    },
    body: JSON.stringify({
      keyword: query,
      filter: { type: [4], nsfw: true },
      sort: "match"
    }),
    signal: AbortSignal.timeout(6000)
  });
  if (!response.ok) {
    const error = new Error(`Bangumi API returned ${response.status}`);
    error.code = response.status === 429 ? "rate_limited" : "network_error";
    error.httpStatus = response.status;
    throw error;
  }
  return (await response.json()).data || [];
}

function parseBangumiSearchItems(html, query) {
  const items = [];
  const blocks = html.match(/<li id=["']item_\d+["'][\s\S]*?<\/li>/gi) || [];
  for (const block of blocks) {
    // `item_123` is a search-result container id, not the Bangumi subject id.
    // The authoritative id is embedded in the result link itself.
    const id = Number(block.match(/<a href=["']\/subject\/(\d+)["']/i)?.[1] || 0);
    if (!id) continue;
    const coverRaw = block.match(/<img[^>]+src=["']([^"']+)["'][^>]*class=["']cover["']/i)?.[1] || "";
    // Strip resize path segment /r/400/ to get original resolution
    const coverFull = coverRaw.replace(/\/r\/\d+\//, "/").replace(/^\/\//, "https://");
    const coverUrl = coverRaw ? new URL(coverFull, "https://bgm.tv").toString() : "";
    const title = stripHtml(block.match(/<a href=["']\/subject\/\d+["'][^>]*class=["']l["'][^>]*>([\s\S]*?)<\/a>/i)?.[1] || "");
    const subtitle = stripHtml(block.match(/<small class=["']grey["']>([\s\S]*?)<\/small>/i)?.[1] || "");
    const info = stripHtml(block.match(/<p class=["']info tip["']>([\s\S]*?)<\/p>/i)?.[1] || "");
    const score = Number(block.match(/<small class=["']fade["']>([\d.]+)<\/small>/i)?.[1] || 0);
    const scoreCount = Number((block.match(/(\d+)人评分/)?.[1] || "0").replace(/[^\d]/g, ""));
    const rank = Number(block.match(/Rank\s*<\/small>(\d+)/i)?.[1] || 0);
    const titleScore = Math.max(similarity(query, title), similarity(query, subtitle));
    const exact = [title, subtitle].some((value) => normalizeSearchText(value) === normalizeSearchText(query));
    const confidence = titleScore + (exact ? 0.45 : 0) + (scoreCount >= 20 ? 0.12 : 0);
    items.push({ id, title, subtitle, info, score, scoreCount, rank, coverUrl, confidence });
  }
  return items.sort((a, b) => b.confidence - a.confidence || b.scoreCount - a.scoreCount);
}

async function searchBangumiWeb(query) {
  const response = await fetch(`https://bgm.tv/subject_search/${encodeURIComponent(query)}?cat=4`, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" },
    signal: AbortSignal.timeout(9000)
  });
  if (!response.ok) {
    const error = new Error(`Bangumi web returned ${response.status}`);
    error.code = response.status === 429 ? "rate_limited" : "network_error";
    error.httpStatus = response.status;
    throw error;
  }
  const html = await response.text();
  const items = parseBangumiSearchItems(html, query);
  console.log(`[bangumi] web scrape "${query}": ${items.length} items found`);
  return items;
}

async function searchBangumiApiItems(query) {
  const results = await searchBangumi(query);
  console.log(`[bangumi] API "${query}": ${results.length} items found`);
  return results
    .map((item) => {
      const titleScore = Math.max(similarity(query, item.name || ""), similarity(query, item.name_cn || ""));
      const exact = [item.name, item.name_cn].some((value) => normalizeSearchText(value) === normalizeSearchText(query));
      const scoreCount = Number(item.rating?.total || 0);
      return {
        id: item.id,
        title: item.name_cn || item.name || "",
        subtitle: item.name || "",
        info: item.date || "",
        score: Number(item.rating?.score || 0),
        scoreCount,
        rank: Number(item.rating?.rank || item.rank || 0),
        coverUrl: item.images?.large || item.images?.common || "",
        confidence: titleScore + (exact ? 0.45 : 0) + (scoreCount >= 20 ? 0.12 : 0)
      };
    })
    .sort((a, b) => b.confidence - a.confidence || b.scoreCount - a.scoreCount);
}

async function lookupBangumiRating(game) {
  if (Number(game?.bgmId) > 0) {
    try {
      const response = await fetch(`https://api.bgm.tv/v0/subjects/${Number(game.bgmId)}`, {
        headers: { "User-Agent": `Gal Launcher/${app.getVersion()} (https://github.com/KamiNeko-pre/gal-launcher)` },
        signal: AbortSignal.timeout(5000)
      });
      if (!response.ok) {
        // A stale subject id is recoverable: fall through to title search so
        // the user gets a fresh match instead of a permanent broken link.
        if (response.status === 404) {
          console.log(`[bangumi] stale subject id ${Number(game.bgmId)}, falling back to title search`);
        } else {
        const error = new Error(`Bangumi subject returned ${response.status}`);
        error.code = response.status === 429 ? "rate_limited" : "network_error";
        throw error;
        }
      } else {
        const subject = await response.json();
        const score = Number(subject.rating?.score || 0);
        const scoreCount = Number(subject.rating?.total || 0);
        if (score > 0 && scoreCount > 0) return ratingPatchForMatch({ id: Number(game.bgmId), score, scoreCount, rank: Number(subject.rating?.rank || 0) });
      }
    } catch (error) {
      return ratingPatchForFailure(error.code === "rate_limited" ? "rate_limited" : "network_error");
    }
  }
  const queries = rawTitleQueriesFor(game).slice(0, 8);
  console.log(`[bangumi] lookup "${game.title}" queries:`, queries);
  const settled = await Promise.allSettled(
    queries.flatMap((query) => [
      searchBangumiWeb(query).then((items) => ({ query, items, source: "web" })),
      searchBangumiApiItems(query).then((items) => ({ query, items, source: "api" }))
    ])
  );
  let best = null;
  let fulfilledCount = 0;
  let rejectedCount = 0;
  let sawRateLimit = false;
  for (const item of settled) {
    if (item.status !== "fulfilled") {
      rejectedCount++;
      sawRateLimit = sawRateLimit || item.reason?.code === "rate_limited";
      continue;
    }
    fulfilledCount++;
    for (const result of item.value.items.slice(0, 4)) {
      console.log(`[bangumi] candidate q="${item.value.query}" src=${item.value.source} title="${result.title}" score=${result.score} count=${result.scoreCount} confidence=${result.confidence.toFixed(3)}`);
      if (!best || result.confidence > best.confidence || (result.confidence === best.confidence && result.scoreCount > best.scoreCount)) {
        best = result;
      }
    }
  }

  if (fulfilledCount === 0 || (rejectedCount > 0 && !best)) {
    const status = sawRateLimit ? "rate_limited" : "network_error";
    console.log(`[bangumi] RETRYABLE ${status} for "${game.title}" (${rejectedCount} failed requests)`);
    return ratingPatchForFailure(status);
  }

  if (!best || best.confidence < 0.72 || !best.score || best.scoreCount < 1) {
    const reason = !best ? "no results" : best.confidence < 0.72 ? `confidence ${best.confidence.toFixed(3)} < 0.72` : `score=${best.score} count=${best.scoreCount}`;
    console.log(`[bangumi] MISS for "${game.title}": ${reason}`);
    return ratingPatchForNoMatch();
  }

  console.log(`[bangumi] HIT for "${game.title}": score=${best.score} count=${best.scoreCount} confidence=${best.confidence.toFixed(3)}`);
  return ratingPatchForMatch(best);
}

function imageUrlsFromHtml(html, pageUrl) {
  const urls = [];
  const add = (value) => {
    if (!value) return;
    for (const part of String(value).split(",")) {
      const candidate = part.trim().split(/\s+/)[0]?.replace(/^["']|["']$/g, "");
      if (!candidate || candidate.startsWith("data:")) continue;
      if (!/\.(?:png|jpe?g|webp)(?:[?#].*)?$/i.test(candidate)) continue;
      try {
        urls.push(new URL(candidate.replace(/&amp;/g, "&"), pageUrl).toString());
      } catch {}
    }
  };

  const patterns = [
    /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image|twitter:image:src)["'][^>]+content=["']([^"']+)["'][^>]*>/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image|twitter:image:src)["'][^>]*>/gi,
    /<(?:img|source)[^>]+(?:src|data-src|data-original|data-lazy|srcset)=["']([^"']+)["'][^>]*>/gi,
    /url\((["']?)([^"')]+)\1\)/gi
  ];

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      add(match[2] || match[1]);
    }
  }

  return Array.from(new Set(urls))
    .map((url) => ({ url, score: urlHintScore(url) }))
    .filter((item) => item.score > -40)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.url);
}

function contentHtmlFromLzacg(html) {
  const match = html.match(/<div class=["']article-content["'][\s\S]*?<div class=["']article-tags/);
  return match ? match[0] : html;
}

function lzacgImageUrlsFromArticle(html, pageUrl) {
  let content = contentHtmlFromLzacg(html);
  const screenshotIndex = content.search(/游戏截图|\u6e38\u620f\u622a\u56fe|wp-block-heading["'][^>]*>\s*游戏截图/i);
  if (screenshotIndex >= 0) content = content.slice(screenshotIndex);
  const urls = [];
  for (const match of content.matchAll(/<img[^>]+(?:src|data-src|data-original|data-lazy)=["']([^"']+)["'][^>]*>/gi)) {
    const raw = match[1];
    if (!raw || raw.startsWith("data:")) continue;
    if (/logo|log444o|avatar|emoji|150x150|icon|qrcode|wechat|qq|ads?|6735e10f1faf5|6687bf2ecf940/i.test(raw)) continue;
    try {
      urls.push(new URL(raw.replace(/&amp;/g, "&"), pageUrl).toString());
    } catch {}
  }
  return Array.from(new Set(urls)).slice(0, 8);
}

function lzacgArticlesFromSearch(html, query) {
  const articles = [];
  const seen = new Set();
  const titlePattern = /<a[^>]+href=["'](https:\/\/lzacg\.cc\/\d+)["'][^>]*>([\s\S]{0,240}?)<\/a>/gi;
  for (const match of html.matchAll(titlePattern)) {
    const url = match[1];
    if (seen.has(url)) continue;
    const title = stripMarkup(match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
    if (!title || title.length < 4 || /新人必读|广告|合作|友情链接|TG|群/i.test(title)) continue;
    const score = Math.max(similarity(query, title), similarity(normalizeSearchText(query), normalizeSearchText(title)));
    if (!isReliableCommunityTitleMatch(score)) continue;
    seen.add(url);
    articles.push({ url, title, score });
  }

  for (const match of html.matchAll(/href=["'](https:\/\/lzacg\.cc\/\d+)["'][^>]*title=["']([^"']+)["']/gi)) {
    const url = match[1];
    if (seen.has(url)) continue;
    const title = stripMarkup(match[2]);
    if (!title || /新人必读|广告|合作|友情链接|TG|群/i.test(title)) continue;
    const score = Math.max(similarity(query, title), similarity(normalizeSearchText(query), normalizeSearchText(title)));
    if (!isReliableCommunityTitleMatch(score)) continue;
    seen.add(url);
    articles.push({ url, title, score });
  }

  return articles.sort((a, b) => b.score - a.score).slice(0, 4);
}

function lzacgArticlesFromCategory(html, query) {
  const articles = [];
  const seen = new Set();
  const cards = html.match(/<h2[\s\S]*?<\/h2>/gi) || [];
  for (const card of cards) {
    const link = card.match(/href=["'](https:\/\/lzacg\.cc\/\d+)["']/i)?.[1];
    if (!link || seen.has(link)) continue;
    const title = stripMarkup(card.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
    if (!title || title.length < 4 || /新人必读|广告|合作|友情链接|TG|群/i.test(title)) continue;
    const score = Math.max(similarity(query, title), similarity(normalizeSearchText(query), normalizeSearchText(title)));
    if (!isReliableCommunityTitleMatch(score)) continue;
    seen.add(link);
    articles.push({ url: link, title, score });
  }
  return articles;
}

async function searchLzacgArticles(query, categoryPageLimit = 1) {
  const all = [];
  try {
    const response = await fetchCoverWithRetry(`https://lzacg.cc/?s=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" },
      signal: AbortSignal.timeout(9000)
    });
    if (response.ok) all.push(...lzacgArticlesFromSearch(await response.text(), query));
  } catch (error) {
    console.warn("[cover] Lzacg search failed:", error.message?.slice(0, 80));
  }

  // The site's own query is title-specific. Category pages are a broad
  // fallback only: scanning them after an exact hit creates a large backlog of
  // image downloads without improving the title match.
  if (all.length > 0) {
    return all.sort((a, b) => b.score - a.score).slice(0, 4);
  }

  const categoryPages = [
    "https://lzacg.cc/category/galgame",
    ...Array.from({ length: Math.max(0, categoryPageLimit - 1) }, (_, index) => `https://lzacg.cc/category/galgame/page/${index + 2}`)
  ];
  const settled = await Promise.allSettled(
    categoryPages.map(async (url) => {
      const response = await fetchCoverWithRetry(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" },
        signal: AbortSignal.timeout(9000)
      });
      if (!response.ok) return [];
      return lzacgArticlesFromCategory(await response.text(), query);
    })
  );
  for (const item of settled) {
    if (item.status === "fulfilled") all.push(...item.value);
  }

  const byUrl = new Map();
  for (const article of all) {
    const existing = byUrl.get(article.url);
    if (!existing || article.score > existing.score) byUrl.set(article.url, article);
  }
  return Array.from(byUrl.values()).sort((a, b) => b.score - a.score).slice(0, 4);
}

async function lzacgCandidatesForArticle(game, article) {
  try {
    const response = await fetchCover(article.url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" },
      signal: AbortSignal.timeout(9000)
    });
    if (!response.ok) return [];
    const urls = lzacgImageUrlsFromArticle(await response.text(), article.url);
    const settled = await Promise.allSettled(
      urls.slice(0, 8).map((url, index) =>
        downloadCandidate(game, url, "量子ACG", 132 + article.score * 26 - index * 6, `${article.title} 第 ${index + 1} 张图`)
      )
    );
    return settled.flatMap((item) => (item.status === "fulfilled" && item.value ? [item.value] : []));
  } catch (error) {
    console.warn("[cover] Lzacg article failed:", error.message?.slice(0, 80));
    return [];
  }
}

async function findLzacgCandidates(game, options = {}) {
  const baseQueries = rawTitleQueriesFor(game).slice(0, options.fast ? 6 : 10);
  const onlineQueries = [];
  if (!options.fast) {
    const vnSettled = await Promise.allSettled(baseQueries.slice(0, 4).map((query) => searchVndb(query)));
    for (const item of vnSettled) {
      if (item.status !== "fulfilled") continue;
      for (const vn of item.value.slice(0, 3)) {
        onlineQueries.push(vn.title, vn.alttitle, ...(vn.titles || []).flatMap((title) => [title.title, title.latin]));
      }
    }
  }
  const queries = Array.from(
    new Set([...baseQueries, ...onlineQueries].map(cleanText).filter((item) => !isGenericSearchText(item)).flatMap(expandSearchAlias))
  ).slice(0, options.fast ? 8 : 16);
  const searchSettled = await Promise.allSettled(queries.map((query) => searchLzacgArticles(query, options.fast ? 1 : 10)));
  const articles = [];
  const seen = new Set();
  for (const item of searchSettled) {
    if (item.status !== "fulfilled") continue;
    for (const article of item.value) {
      if (seen.has(article.url)) continue;
      seen.add(article.url);
      articles.push(article);
    }
  }
  const articleSettled = await Promise.allSettled(
    articles.sort((a, b) => b.score - a.score).slice(0, 3).map((article) => lzacgCandidatesForArticle(game, article))
  );
  return articleSettled.flatMap((item) => (item.status === "fulfilled" ? item.value : []));
}

// --- DLsite ---

function dlsiteImageUrlsFromProduct(html, pageUrl) {
  const urls = [];
  // og:image
  const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/i);
  if (ogMatch) urls.push(ogMatch[1]);
  // Product sample slides are currently rendered as `div data-src` rather
  // than img tags, so read either attribute from any element.
  for (const match of html.matchAll(/(?:src|data-src)=["']((?:https?:)?\/\/img\.dlsite\.jp[^"']+)["']/gi)) {
    urls.push(match[1]);
  }
  // normalize: strip resize suffixes to get original resolution
  return Array.from(new Set(urls)).map((raw) => {
    let u = raw.replace(/&amp;/g, "&");
    // `resize/images2` only serves named thumbnails. Its full-sized sibling
    // lives under `modpub/images2` with the same file stem.
    u = u.replace(/(https?:)?\/\/img\.dlsite\.jp\/resize\/images2\//i, "https://img.dlsite.jp/modpub/images2/");
    // Strip dimension suffixes: _240x240, _800x600 etc. before extension
    u = u.replace(/_(\d{2,4})x(\d{2,4})(?=\.(?:png|jpe?g|webp))/gi, "");
    // Strip common thumbnail type markers
    u = u.replace(/_(?:sam|thumb|small|mini|sq)(?=\.)/gi, "");
    try {
      return { url: new URL(u, pageUrl).toString(), score: urlHintScore(u) };
    } catch {
      return null;
    }
  }).filter(Boolean).filter((item) => item.score > -50).sort((a, b) => b.score - a.score).map((item) => item.url);
}

function searchDlsiteArticlesFromHtml(html, query) {
  const articles = [];
  const seen = new Set();
  // Search cards currently use either ordinary anchors or custom thumbnail
  // components with a `link` attribute and an absolute /pro/work URL.
  const tagPattern = /<(?:a|thumb-with-ng-filter-block)\b[^>]*>/gi;
  for (const match of html.matchAll(tagPattern)) {
    const tag = match[0];
    const linkMatch = tag.match(/(?:href|link)=["']((?:https?:\/\/[^"']+)?\/[^"']*\/work\/=\/product_id\/[^"'\s]+?)(?:\.html)?["']/i);
    if (!linkMatch) continue;
    const rawLink = linkMatch[1];
    if (seen.has(rawLink) || /reviewlist/i.test(rawLink)) continue;
    // New thumbnail components label the work with `alt`; old anchors use title.
    const titleAttr = tag.match(/(?:title|alt)=["']([^"']+)["']/i);
    const title = titleAttr ? titleAttr[1].trim() : "";
    if (!title || title.length < 2) continue;
    const score = Math.max(similarity(query, title), similarity(normalizeSearchText(query), normalizeSearchText(title)));
    if (!isReliableCommunityTitleMatch(score)) continue;
    seen.add(rawLink);
    articles.push({ url: new URL(rawLink, "https://www.dlsite.com").toString(), title, score });
  }
  return articles.sort((a, b) => b.score - a.score).slice(0, 4);
}

async function searchDlsiteArticles(query) {
  const urls = [
    `https://www.dlsite.com/soft/search/?keyword=${encodeURIComponent(query)}`,
    `https://www.dlsite.com/maniax/fsr/=/keyword/${encodeURIComponent(query)}/`
  ];
  const settled = await Promise.allSettled(urls.map(async (url) => {
    try {
      const response = await fetchCover(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" },
        signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) return [];
      return searchDlsiteArticlesFromHtml(await response.text(), query);
    } catch (error) {
      console.warn("[cover] DLsite search failed:", error.message?.slice(0, 80));
      return [];
    }
  }));
  const seen = new Set();
  const all = [];
  for (const item of settled) {
    if (item.status !== "fulfilled") continue;
    for (const article of item.value) {
      if (seen.has(article.url)) continue;
      seen.add(article.url);
      all.push(article);
    }
  }
  return all.sort((a, b) => b.score - a.score).slice(0, 4);
}

async function dlsiteCandidatesForProduct(game, article) {
  try {
    const response = await fetchCover(article.url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return [];
    const urls = dlsiteImageUrlsFromProduct(await response.text(), article.url);
    const settled = await Promise.allSettled(
      urls.slice(0, 6).map((url, index) =>
        downloadCandidate(game, url, "DLsite", 126 + article.score * 24 - index * 6, `${article.title} / DLsite`)
      )
    );
    return settled.flatMap((item) => (item.status === "fulfilled" && item.value ? [item.value] : []));
  } catch (error) {
    console.warn("[cover] DLsite product failed:", error.message?.slice(0, 80));
    return [];
  }
}

async function findDlsiteCandidates(game) {
  const queries = rawTitleQueriesFor(game).slice(0, 6);
  const searchSettled = await Promise.allSettled(queries.map((query) => searchDlsiteArticles(query)));
  const articles = [];
  const seen = new Set();
  for (const item of searchSettled) {
    if (item.status !== "fulfilled") continue;
    for (const article of item.value) {
      if (seen.has(article.url)) continue;
      seen.add(article.url);
      articles.push(article);
    }
  }
  const articleSettled = await Promise.allSettled(
    articles.sort((a, b) => b.score - a.score).slice(0, 3).map((article) => dlsiteCandidatesForProduct(game, article))
  );
  return articleSettled.flatMap((item) => (item.status === "fulfilled" ? item.value : []));
}

// --- 2DFan ---

function search2DFanSubjectsFromHtml(html, query) {
  const subjects = [];
  const seen = new Set();
  // Match subject links with their own visible label. A card can contain an
  // earlier image-only link, so title extraction must stay on this anchor.
  const itemPattern = /<a[^>]+href=["'](\/subjects\/\d+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(itemPattern)) {
    const link = match[1];
    const title = stripMarkup(match[2].replace(/<[^>]*>/g, " ")).trim();
    if (!title || seen.has(link)) continue;
    seen.add(link);
    const score = Math.max(similarity(query, title), similarity(normalizeSearchText(query), normalizeSearchText(title)));
    if (score < 0.15) continue;
    subjects.push({ url: new URL(link, "https://2dfan.com").toString(), title, score });
  }
  return subjects.sort((a, b) => b.score - a.score).slice(0, 4);
}

function twoDFanImageUrlsFromSubject(html, pageUrl) {
  const urls = [];
  // og:image
  const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/i);
  if (ogMatch) urls.push(ogMatch[1]);
  // subject cover / gallery images — narrow to likely cover containers
  const coverSection = html.match(/<div[^>]+class=["'][^"']*cover[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || html;
  for (const match of coverSection.matchAll(/<img[^>]+(?:src|data-src|data-original)=["']([^"']+)["'][^>]*>/gi)) {
    urls.push(match[1]);
  }
  // fallback: page-wide img tags if cover section didn't yield
  if (urls.length < 2) {
    for (const match of html.matchAll(/<img[^>]+(?:src|data-src|data-original)=["']([^"']+)["'][^>]*>/gi)) {
      urls.push(match[1]);
    }
  }
  return Array.from(new Set(urls)).map((raw) => {
    let u = raw.replace(/&amp;/g, "&");
    // Strip 2DFan resize suffixes to get original
    u = u.replace(/[!?]large/, "").replace(/[!?]medium/, "").replace(/[!?]small/, "").replace(/_\d+x\d+\./, ".");
    try {
      return { url: new URL(u, pageUrl).toString(), score: urlHintScore(u) };
    } catch {
      return null;
    }
  }).filter(Boolean).filter((item) => item.score > -50).sort((a, b) => b.score - a.score).map((item) => item.url);
}

function search2DFanSubjectsFromJson(data, query) {
  // Rails JSON search responses can be: array, {subjects: [...]}, {data: [...]}, {results: [...]}
  if (typeof data?.subjects === "string") return search2DFanSubjectsFromHtml(data.subjects, query);
  const items = Array.isArray(data) ? data
    : data.subjects || data.data || data.results || data.items || [];
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    const id = item.id || item.slug;
    const name = item.name || item.title || item.name_cn || "";
    if (!id || !name) return null;
    const url = `https://2dfan.com/subjects/${id}`;
    const score = Math.max(similarity(query, name), similarity(normalizeSearchText(query), normalizeSearchText(name)));
    if (score < 0.15) return null;
    return { url, title: name, score };
  }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 4);
}

async function search2DFanSubjects(query) {
  // 2DFan uses Rails UJS AJAX for search, so the HTML page may be an empty shell.
  // Try multiple URL formats: .json variant first, then HTML.
  const encoded = encodeURIComponent(query);
  const urls = [
    { url: `https://2dfan.com/subjects/search.json?keyword=${encoded}`, type: "json" },
    { url: `https://2dfan.com/subjects/search?keyword=${encoded}`, type: "html" }
  ];

  const settled = await Promise.allSettled(urls.map(async ({ url, type }) => {
    try {
      const response = await fetchCover(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          "Accept": type === "json" ? "application/json" : "text/html"
        },
        signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) return [];
      if (type === "json") {
        const data = await response.json().catch(() => null);
        if (!data) return [];
        // Rails JSON responses typically have subjects array or results
        return search2DFanSubjectsFromJson(data, query);
      }
      return search2DFanSubjectsFromHtml(await response.text(), query);
    } catch (error) {
      console.warn("[cover] 2DFan search failed:", error.message?.slice(0, 80));
      return [];
    }
  }));

  const seen = new Set();
  const all = [];
  for (const item of settled) {
    if (item.status !== "fulfilled") continue;
    for (const subject of item.value) {
      if (seen.has(subject.url)) continue;
      seen.add(subject.url);
      all.push(subject);
    }
  }
  return all.sort((a, b) => b.score - a.score).slice(0, 4);
}

async function twoDFanCandidatesForSubject(game, subject) {
  try {
    const response = await fetchCover(subject.url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return [];
    const urls = twoDFanImageUrlsFromSubject(await response.text(), subject.url);
    const settled = await Promise.allSettled(
      urls.slice(0, 6).map((url, index) =>
        downloadCandidate(game, url, "2DFan", 118 + subject.score * 22 - index * 4, `${subject.title} / 2DFan`)
      )
    );
    return settled.flatMap((item) => (item.status === "fulfilled" && item.value ? [item.value] : []));
  } catch (error) {
    console.warn("[cover] 2DFan subject failed:", error.message?.slice(0, 80));
    return [];
  }
}

async function find2DFanCandidates(game) {
  const queries = rawTitleQueriesFor(game).slice(0, 6);
  const searchSettled = await Promise.allSettled(queries.map((query) => search2DFanSubjects(query)));
  const subjects = [];
  const seen = new Set();
  for (const item of searchSettled) {
    if (item.status !== "fulfilled") continue;
    for (const subject of item.value) {
      if (seen.has(subject.url)) continue;
      seen.add(subject.url);
      subjects.push(subject);
    }
  }
  const subjectSettled = await Promise.allSettled(
    subjects.sort((a, b) => b.score - a.score).slice(0, 3).map((subject) => twoDFanCandidatesForSubject(game, subject))
  );
  return subjectSettled.flatMap((item) => (item.status === "fulfilled" ? item.value : []));
}

async function findVndbScreenshotCandidates(game) {
  const queries = titleQueriesFor(game).slice(0, 6);
  const settled = await Promise.allSettled(queries.map((query) => searchVndb(query).then((results) => ({ query, results }))));
  const matches = [];
  for (const item of settled) {
    if (item.status !== "fulfilled") continue;
    for (const vn of item.value.results.slice(0, 5)) {
      const confidence = scoreVnCandidate(item.value.query, vn);
      if (confidence >= 0.58 && (game.metadataSource !== "vndb" || !game.metadataSourceId || vn.id === game.metadataSourceId)) matches.push({ vn, confidence, query: item.value.query });
    }
  }

  const bestById = new Map();
  for (const match of matches.sort((a, b) => b.confidence - a.confidence)) {
    const existing = bestById.get(match.vn.id);
    if (!existing || match.confidence > existing.confidence) bestById.set(match.vn.id, match);
  }

  const downloads = [];
  for (const { vn, confidence } of Array.from(bestById.values()).slice(0, 2)) {
    const urls = Array.from(new Set((vn.screenshots || []).flatMap((shot) => shot.url ? [shot.url] : []).filter(Boolean)));
    for (const [index, url] of urls.slice(0, 10).entries()) {
      downloads.push(downloadCandidate(game, url, "VNDB截图", 116 + confidence * 22 - index * 2, `${vn.title || vn.id} / ${vn.id}`));
    }
  }

  const results = await Promise.allSettled(downloads);
  return results.flatMap((item) => (item.status === "fulfilled" && item.value ? [item.value] : []));
}

  async function findVndbImageCandidates(game) {
    const queries = titleQueriesFor(game).slice(0, 6);
    const settled = await Promise.allSettled(queries.map((query) => searchVndb(query).then((results) => ({ query, results }))));
    const downloads = [];
    const seen = new Set();
    for (const item of settled) {
      if (item.status !== "fulfilled") continue;
      for (const vn of item.value.results.slice(0, 3)) {
        const confidence = scoreVnCandidate(item.value.query, vn);
        if (confidence < 0.60 || !vn.image?.url || seen.has(vn.image.url)) continue;
        if (game.metadataSource === "vndb" && game.metadataSourceId && vn.id !== game.metadataSourceId) continue;
        seen.add(vn.image.url);
        downloads.push(downloadCandidate(game, vn.image.url, "VNDB封面", 62 + confidence * 12, `${vn.title || vn.id} / ${vn.id}`));
      }
    }
    const results = await Promise.allSettled(downloads.slice(0, 6));
    return results.flatMap((item) => (item.status === "fulfilled" && item.value ? [item.value] : []));
  }

  async function findVndbOfficialCandidates(game) {
    const queries = titleQueriesFor(game).slice(0, 4);
    const settled = await Promise.allSettled(queries.map((query) => searchVndb(query).then((results) => ({ query, results }))));
    const links = [];
    const seenVn = new Set();
    for (const item of settled) {
      if (item.status !== "fulfilled") continue;
      for (const vn of item.value.results.slice(0, 3)) {
        if (seenVn.has(vn.id)) continue;
        const confidence = scoreVnCandidate(item.value.query, vn);
        if (confidence < 0.72) continue;
        if (game.metadataSource === "vndb" && game.metadataSourceId && vn.id !== game.metadataSourceId) continue;
        seenVn.add(vn.id);
        for (const link of vn.extlinks || []) {
          const url = String(link.url || "");
          const label = `${link.label || ""} ${link.name || ""}`;
          if (!/^https?:\/\//i.test(url)) continue;
          if (/official|website|homepage|公式|官网|product|steam/i.test(label) || /steam|dlsite|fanza|dmm|yuzu|key|august|sprite|citrus/i.test(url)) {
            links.push(url);
          }
        }
      }
    }

    const settledPages = await Promise.allSettled(
      Array.from(new Set(links)).slice(0, 4).map((url) => officialImageCandidatesFromPage(game, url, 0))
    );
    return settledPages.flatMap((item) => (item.status === "fulfilled" ? item.value : []));
  }

  async function findBangumiCoverCandidates(game) {
    const queries = rawTitleQueriesFor(game).slice(0, 8);
    const settled = await Promise.allSettled(
      queries.map((query) => searchBangumiWeb(query).then((items) => ({ query, items })))
    );
    const downloads = [];
    const seen = new Set();
    let totalFound = 0;
    let confFiltered = 0;
    for (const item of settled) {
      if (item.status !== "fulfilled") continue;
      for (const result of item.value.items.slice(0, 3)) {
        totalFound++;
        if (result.confidence < 0.55 || !result.coverUrl || seen.has(result.coverUrl)) {
          if (result.confidence < 0.55) confFiltered++;
          continue;
        }
        seen.add(result.coverUrl);
        downloads.push(downloadCandidate(game, result.coverUrl, "Bangumi", 86 + result.confidence * 28, `${result.title || result.subtitle} / bgm ${result.id}`));
      }
    }

    const results = await Promise.allSettled(downloads.slice(0, 8));
    const passed = results.filter((item) => item.status === "fulfilled" && item.value).length;
    if (!process.env.COVER_QUIET) {
      console.log(`[cover:${game.title.slice(0, 20)}] Bangumi: ${settled.filter((s) => s.status === "fulfilled").length}/${queries.length} queries ok, ${totalFound} items (${confFiltered} low-conf), ${downloads.length} downloaded, ${passed} passed quality`);
    }
    return results.flatMap((item) => (item.status === "fulfilled" && item.value ? [item.value] : []));
  }

  async function findSteamCandidates(game) {
    const queries = Array.from(new Set([
      ...rawTitleQueriesFor(game),
      steamFallbackExecutableQuery(game)
    ]))
      .filter((q) => q.length >= 3)
      .slice(0, 8);
    const appMatches = [];
    await Promise.all(queries.map(async (query) => {
      try {
        const response = await fetchCoverWithRetry(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&l=english&cc=us`, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" },
          signal: AbortSignal.timeout(7000)
        });
        if (!response.ok) return;
        const data = await response.json();
        for (const item of (data.items || []).slice(0, 8)) {
          const confidence = similarity(query, item.name || "");
          if (confidence >= 0.45) appMatches.push({ appid: item.id, name: item.name, confidence, query });
        }
      } catch (error) {
        console.warn("[cover] Steam search failed:", error.message?.slice(0, 80));
      }
    }));

    if (!process.env.COVER_QUIET) {
      console.log(`[cover:${game.title.slice(0, 20)}] Steam: ${queries.length} queries, ${appMatches.length} app matches`);
    }

    const bestByApp = new Map();
    for (const match of appMatches.sort((a, b) => b.confidence - a.confidence)) {
      if (!bestByApp.has(match.appid)) bestByApp.set(match.appid, match);
    }

    const downloadPlans = [];
    await Promise.all(Array.from(bestByApp.values()).slice(0, 4).map(async (match) => {
      try {
        const response = await fetchCover(`https://store.steampowered.com/api/appdetails?appids=${match.appid}&filters=basic,screenshots`, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" },
          signal: AbortSignal.timeout(7000)
        });
        if (!response.ok) return;
        const details = (await response.json())?.[match.appid]?.data;
        if (!isSteamGameDetails(details)) return;
        const urls = [
          `https://cdn.cloudflare.steamstatic.com/steam/apps/${match.appid}/library_hero.jpg`,
          `https://cdn.cloudflare.steamstatic.com/steam/apps/${match.appid}/capsule_616x353.jpg`,
          `https://cdn.cloudflare.steamstatic.com/steam/apps/${match.appid}/header.jpg`,
          details.header_image,
          ...(details.screenshots || []).map((shot) => shot.path_full || shot.path_thumbnail)
        ].filter(Boolean);
        for (const [index, url] of Array.from(new Set(urls)).slice(0, 14).entries()) {
          const isLibraryAsset = /library_hero|capsule_616x353|header\.jpg/i.test(url);
          const weight = (isLibraryAsset ? 148 : 122) + match.confidence * 38 - index * 2;
          downloadPlans.push({
            url,
            run: () => downloadCandidate(game, url, "Steam", weight, `${details.name || match.name} / Steam ${match.appid}`)
          });
        }
      } catch (error) {
        console.warn("[cover] Steam details failed:", error.message?.slice(0, 80));
      }
    }));

    const uniqueDownloads = Array.from(new Map(downloadPlans.map((plan) => [plan.url, plan])).values());
    const results = await Promise.allSettled(uniqueDownloads.map((plan) => plan.run()));
    const passed = results.filter((item) => item.status === "fulfilled" && item.value).length;
    if (!process.env.COVER_QUIET) {
      console.log(`[cover:${game.title.slice(0, 20)}] Steam: ${uniqueDownloads.length} downloaded, ${passed} passed quality`);
    }
    return results.flatMap((item) => (item.status === "fulfilled" && item.value ? [item.value] : []));
  }

  function officialLinksFromHtml(html, pageUrl) {
  let base;
  try {
    base = new URL(pageUrl);
  } catch {
    return [];
  }
  const links = [];
  for (const match of html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>/gi)) {
    try {
      const url = new URL(match[1].replace(/&amp;/g, "&"), pageUrl);
      if (url.origin !== base.origin) continue;
      const value = url.toString().toLowerCase();
      if (/product|index|top|special|visual|download|wallpaper|main|gallery|illust|character|wp_/.test(value)) links.push(url.toString());
    } catch {}
  }
  return Array.from(new Set(links)).slice(0, 6);
}

async function officialImageCandidatesFromPage(game, pageUrl, depth = 1, visited = new Set()) {
  if (visited.has(pageUrl) || visited.size >= 8) return [];
  visited.add(pageUrl);
  try {
    const response = await fetchCover(pageUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" },
      signal: AbortSignal.timeout(6000)
    });
    if (!response.ok) return [];
    const html = await response.text();
    const urls = imageUrlsFromHtml(html, pageUrl);
    const settled = await Promise.allSettled(
      urls.slice(0, 10).map((url) => downloadCandidate(game, url, "官网", 105, pageUrl))
    );
    const candidates = settled.flatMap((item) => (item.status === "fulfilled" && item.value ? [item.value] : []));
    if (depth <= 0 || candidates.some((item) => item.width >= 1280 && item.height >= 650 && item.score >= 170)) return candidates;

    const linkSettled = await Promise.allSettled(
      officialLinksFromHtml(html, pageUrl).map((url) => officialImageCandidatesFromPage(game, url, depth - 1, visited))
    );
    for (const item of linkSettled) {
      if (item.status === "fulfilled") candidates.push(...item.value);
    }
    return candidates;
  } catch (error) {
    console.warn("[cover] official site failed:", error.message?.slice(0, 80));
    return [];
  }
}

async function bangumiOfficialLinks(query) {
  const output = [];
  const results = await searchBangumi(query).catch(() => []);
  for (const item of results.slice(0, 3)) {
    const titleScore = Math.max(similarity(query, item.name || ""), similarity(query, item.name_cn || ""));
    if (titleScore < 0.55) continue;
    try {
        const response = await fetchCover(`https://api.bgm.tv/v0/subjects/${item.id}`, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 (local personal use)" },
        signal: AbortSignal.timeout(6000)
      });
      if (!response.ok) continue;
      const subject = await response.json();
      for (const info of subject.infobox || []) {
        const name = String(info.key || info.name || "");
        if (!/官网|官方网站|official|website|homepage|hp/i.test(name)) continue;
        const values = Array.isArray(info.value) ? info.value : [info.value];
        for (const value of values) {
          const text = typeof value === "object" ? value?.v || value?.url || value?.value : value;
          if (/^https?:\/\//i.test(String(text || ""))) output.push(String(text));
        }
      }
    } catch {}
  }
  return Array.from(new Set(output));
}

async function findCoverCandidates(game) {
  return coverSearchAttempts.run([], async () => {
  const cached = readCoverCandidateCache(game);
  if (hasCachedCoverCandidates(cached)) return cached;

  const localCandidates = [
    existingCoverCandidate(game)
  ].filter(Boolean);

  const sourceLabels = ["Steam", "Lzacg", "VNDB(screenshot)", "VNDB(image)"];
  const fastResults = await Promise.allSettled([
    findSteamCandidates(game),
    findLzacgCandidates(game, { fast: true }),
    findVndbScreenshotCandidates(game),
    findVndbImageCandidates(game)
  ]);
  const fastGroups = fastResults.map((result) =>
    result.status === "fulfilled" && Array.isArray(result.value) ? result.value : []
  );
  if (!process.env.COVER_QUIET) {
    for (let i = 0; i < fastResults.length; i++) {
      const status = fastResults[i].status;
      const count = fastGroups[i].length;
      console.log(`[cover:${game.title.slice(0, 20)}] ${sourceLabels[i]}: ${status} → ${count} candidates`);
    }
  }
  let candidates = mergeCoverCandidates([localCandidates, ...fastGroups]);

  const strongCount = candidates.filter((item) => item.score >= 168 && item.width >= 1280).length;
  if (!process.env.COVER_QUIET) {
    console.log(`[cover:${game.title.slice(0, 20)}] Phase 1 total: ${candidates.length} (strong: ${strongCount}) → Phase 2: ${strongCount < 3 ? "triggered" : "skipped"}`);
  }
  if (strongCount < 3) {
    const slowLabels = ["VNDB(official)", "Lzacg(slow)"];
    const slowResults = await Promise.allSettled([
      findVndbOfficialCandidates(game),
      findLzacgCandidates(game, { fast: false })
    ]);
    const slowGroups = slowResults.map((result) =>
      result.status === "fulfilled" && Array.isArray(result.value) ? result.value : []
    );
    if (!process.env.COVER_QUIET) {
      for (let i = 0; i < slowResults.length; i++) {
        console.log(`[cover:${game.title.slice(0, 20)}] ${slowLabels[i]}: ${slowResults[i].status} → ${slowGroups[i].length} candidates`);
      }
    }
    candidates = mergeCoverCandidates([candidates, ...slowGroups]);
  }

  const summary = summarizeCoverSearch({
    candidateCount: candidates.length,
    attempts: coverSearchAttempts.getStore()
  });
  if (summary.status === "network_error") {
    throw new Error("横版图搜索失败：外部来源均不可用，请检查网络或代理后重试");
  }
  if (candidates.length) writeCoverCandidateCache(game, candidates);
  return candidates;
  });
}

ipcMain.handle("library:load", async () => normalizeLibraryForRuntime(readLibrary()));

ipcMain.handle("library:loadDocument", async () => {
  const document = readDocument();
  return { ...document, games: await normalizeLibraryForRuntime(document.games) };
});

ipcMain.handle("library:save", (_event, games) => {
  const merged = mergeAuthoritativePlayState(games, readLibrary());
  writeLibrary(archiveGameImages(merged, app.getPath("userData")));
});

ipcMain.handle("library:saveDocument", (_event, payload) => {
  const incoming = normalizeLibraryDocument(payload);
  const stored = readDocument();
  const mergedGames = mergeAuthoritativePlayState(incoming.games, stored.games);
  const archivedGames = archiveGameImages(mergedGames, app.getPath("userData"));
  return writeDocument({ ...incoming, games: archivedGames });
});

ipcMain.handle("library:scanLaunchCandidates", async (event, rootPath) => {
  const key = event.sender.id;
  const previous = activeLaunchScans.get(key);
  previous?.abort();
  const controller = new AbortController();
  activeLaunchScans.set(key, controller);
  try {
    return await scanLaunchCandidatesAsync(rootPath, {
      signal: controller.signal,
      onProgress: (progress) => {
        if (!event.sender.isDestroyed()) event.sender.send("library:scanProgress", progress);
      }
    });
  } finally {
    if (activeLaunchScans.get(key) === controller) activeLaunchScans.delete(key);
  }
});

ipcMain.handle("library:cancelLaunchScan", (event) => {
  activeLaunchScans.get(event.sender.id)?.abort();
  return true;
});

ipcMain.handle("dialog:pickLaunchFile", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select game launch file",
    properties: ["openFile"],
    filters: [
      { name: "Launch files", extensions: ["exe", "bat", "cmd", "lnk"] },
      { name: "All files", extensions: ["*"] }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  const installPath = path.dirname(filePath);
  const metadata = parseFolderMetadata(path.basename(installPath));
  return {
    ...metadata,
    executablePath: filePath,
    installPath,
    workingDirectory: installPath,
    title: metadata.title || guessTitleFromPath(filePath)
  };
});

ipcMain.handle("dialog:pickImage", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select image",
    properties: ["openFile"],
    filters: [
      { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] },
      { name: "All files", extensions: ["*"] }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("dialog:pickFolder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select game folder",
    properties: ["openDirectory"]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("tools:status", () => {
  const manager = getEnhancementToolManager();
  return Object.values(manager.definitions).map((definition) => ({
    id: definition.id,
    name: definition.name,
    version: definition.version,
    sourceUrl: definition.sourceUrl,
    license: definition.license,
    executable: definition.executable,
    ...manager.status(definition.id)
  }));
});

ipcMain.handle("tools:magpiePresets", () => publicMagpiePresets());

ipcMain.handle("tools:install", async (event, toolId, options = {}) => {
  const manager = getEnhancementToolManager();
  return manager.install(toolId, {
    localArchivePath: options?.localArchivePath,
    magpieConfigPath: getMagpieUserConfigPath(),
    signal: undefined,
    onProgress: (progress) => {
      if (!event.sender.isDestroyed()) event.sender.send("tools:progress", progress);
    }
  });
});

ipcMain.handle("tools:selectExisting", (_event, toolId, executablePath) => {
  return getEnhancementToolManager().selectExisting(toolId, executablePath);
});

ipcMain.handle("tools:validateExisting", (_event, toolId, executablePath) => {
  try {
    return getEnhancementToolManager().selectExisting(toolId, executablePath);
  } catch {
    return null;
  }
});

ipcMain.handle("dialog:pickToolArchive", async (_event, toolId) => {
  const definition = getEnhancementToolManager().definitions[toolId];
  if (!definition) throw new Error("未知的增强工具");
  const result = await dialog.showOpenDialog(mainWindow, {
    title: `选择官方 ${definition.name} 压缩包`,
    properties: ["openFile"],
    filters: [{ name: "ZIP", extensions: ["zip"] }, { name: "All files", extensions: ["*"] }]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("window:toggleFullscreen", () => {
  return toggleWindowFullscreen(mainWindow);
});

ipcMain.handle("window:isFullscreen", () => Boolean(mainWindow?.isFullScreen()));

ipcMain.handle("game:saveBackups", (_event, game) => listSaveBackups({
  userDataPath: app.getPath("userData"),
  gameId: game?.id
}));

ipcMain.handle("game:createSaveBackup", (_event, game) => createSaveBackup({
  userDataPath: app.getPath("userData"),
  gameId: game?.id,
  savePaths: game?.savePaths,
  reason: "manual"
}));

ipcMain.handle("game:restoreSaveBackup", (_event, game, backupId) => {
  if (game?.currentSessionStartedAt) throw new Error("游戏正在运行，请退出游戏后再恢复存档");
  return restoreSaveBackup({
    userDataPath: app.getPath("userData"),
    gameId: game?.id,
    savePaths: game?.savePaths,
    backupId
  });
});

ipcMain.handle("shell:openPath", async (_event, targetPath) => {
  if (!targetPath || !fs.existsSync(targetPath)) throw new Error("路径不可用");
  const error = await shell.openPath(targetPath);
  if (error) throw new Error(error);
});

ipcMain.handle("game:rescanMetadata", async (_event, game) => {
  const installPath = game.installPath || path.dirname(game.executablePath);
  return scanGameMetadata(installPath, game.executablePath);
});

ipcMain.handle("game:enrichOnlineMetadata", async (_event, game, options = {}) => {
  if (options.forceTranslation) {
    const candidates = await searchMetadataCandidates(game, "");
    const best = candidates[0];
    return best ? hydrateMetadataCandidate(game, best, { forceTranslation: true }) : { confidence: 0, source: "none" };
  }
  return enrichOnlineMetadata(game);
});

ipcMain.handle("game:enrichBulkMetadata", async (_event, game) => enrichBulkMetadata(game));

ipcMain.handle("game:searchMetadataCandidates", async (_event, game, keyword) => searchMetadataCandidates(game, keyword));

ipcMain.handle("game:applyMetadataCandidate", async (_event, game, candidate) => hydrateMetadataCandidate(game, candidate));

ipcMain.handle("game:findCoverCandidates", async (_event, game) => findCoverCandidates(game));

ipcMain.handle("game:lookupBangumiRating", async (_event, game) => lookupBangumiRating(game));

ipcMain.handle("game:openBangumi", async (_event, game) => {
  // `bangumi.tv` currently returns an error page for a number of otherwise
  // valid game subjects. `chii.in` is the same Bangumi service's active
  // canonical site and accepts the persisted subject ids directly.
  const subjectId = Number(game?.bgmId || 0);
  const query = String(game?.originalTitle || game?.title || "").trim();
  const url = subjectId > 0
    ? `https://chii.in/subject/${subjectId}`
    : `https://chii.in/subject_search/${encodeURIComponent(query)}?cat=4`;
  await shell.openExternal(url);
  return { rating: {}, url };
});

ipcMain.handle("library:export", async (_event, games) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Export library backup",
    defaultPath: `gal-launcher-backup-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: "JSON", extensions: ["json"] }]
  });
  if (result.canceled || !result.filePath) return "";
  const stored = readDocument();
  const document = Array.isArray(games)
    ? { ...stored, games }
    : normalizeLibraryDocument(games || stored);
  fs.writeFileSync(result.filePath, JSON.stringify(backupPayload(document), null, 2), "utf8");
  return result.filePath;
});

ipcMain.handle("library:import", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Import library backup",
    properties: ["openFile"],
    filters: [{ name: "JSON", extensions: ["json"] }]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const data = JSON.parse(fs.readFileSync(result.filePaths[0], "utf8"));
  const document = normalizeLibraryDocument(data);
  if (!document.games.length && !Array.isArray(data) && !Array.isArray(data?.games)) throw new Error("Invalid backup file");
  return writeDocument(document);
});

ipcMain.handle("image:readDataUrl", async (_event, imagePath) => {
  if (!imagePath || !fs.existsSync(imagePath)) return "";
  const ext = path.extname(imagePath).toLowerCase();
  const mime =
    ext === ".png" ? "image/png" :
    ext === ".webp" ? "image/webp" :
    ext === ".bmp" ? "image/bmp" :
    "image/jpeg";
  const data = fs.readFileSync(imagePath).toString("base64");
  return `data:${mime};base64,${data}`;
});

function startPlaySession(game, sessionId, startedAt, trackedPids, startedMs = Date.now(), baselinePids = []) {
  const monitorRoot = monitorRootForGame(game);
  const pids = Array.isArray(trackedPids) ? trackedPids : (trackedPids ? [trackedPids] : []);
  const session = {
    gameId: game.id,
    sessionId,
    startedAt,
    startedMs,
    monitorRoot,
    trackedPids: pids,
    baselinePids: (Array.isArray(baselinePids) ? baselinePids : [])
      .map(Number)
      .filter((pid) => Number.isFinite(pid) && pid > 0),
    childPid: pids[0] ?? null,
    emptyChecks: 0,
    monitorTimer: null,
    watchdogTimer: null
  };
  const games = readLibrary();
  const hadJournal = Boolean(readJournal()[sessionId]);
  persistStartedSession({
    games,
    gameId: game.id,
    sessionId,
    startedAt,
    startedMs,
    baselinePids: session.baselinePids,
    hadJournal,
    addJournal: journalAdd,
    writeLibrary,
    removeJournal: journalRemove
  });

  activePlaySessions.set(sessionId, session);

  // Start monitoring immediately; give the game time to start its process tree
  scheduleMonitorCheck(session, pids.length > 0 ? 6000 : 10000);

  // Watchdog: every 60s, verify the polling loop hasn't stalled
  session.watchdogTimer = setInterval(() => {
    const s = activePlaySessions.get(sessionId);
    if (!s) return;
    if (!s.monitorTimer) {
      scheduleMonitorCheck(s, 0);
    }
  }, 60000);

  return session;
}

async function scheduleMonitorCheck(session, delay) {
  if (session.monitorTimer) clearTimeout(session.monitorTimer);
  session.monitorTimer = setTimeout(async () => {
    const current = activePlaySessions.get(session.sessionId);
    if (!current) return;

    // Localized launch wrappers can exit after spawning the real game engine.
    // If every tracked PID is gone, rediscover live processes under the game
    // directory instead of ending the session prematurely.
    const runningPids = await findRunningSessionPids({
      trackedPids: current.trackedPids,
      baselinePids: current.baselinePids,
      monitorRoot: current.monitorRoot
    });
    if (runningPids === null) {
      scheduleMonitorCheck(current, 4000);
      return;
    }
    const anyAlive = runningPids.length > 0;

    if (anyAlive) {
      current.trackedPids = runningPids;
      current.childPid = runningPids[0] ?? null;
      current.emptyChecks = 0;
      scheduleMonitorCheck(current, 4000);
      return;
    }

    current.emptyChecks = (current.emptyChecks || 0) + 1;
    if (current.emptyChecks >= 2) {
      finishPlaySession(current.sessionId);
    } else {
      scheduleMonitorCheck(current, 2000);
    }
  }, delay);
}

function finishPlaySession(sessionId) {
  const current = activePlaySessions.get(sessionId);
  if (!current) return;
  const { endedAt, durationSeconds } = freezeSessionCompletion(current);

  const games = readLibrary();
  const game = games.find((g) => g.id === current.gameId);
  if (game) {
    const sessions = Array.isArray(game.sessions) ? game.sessions : [];
    sessions.push({
      sessionId: current.sessionId,
      startedAt: current.startedAt,
      endedAt,
      durationSeconds
    });
    game.sessions = sessions.slice(-50);
    game.totalPlaySeconds = (game.totalPlaySeconds ?? 0) + durationSeconds;
    clearSessionIfCurrent(game, current.sessionId);
    game.lastPlayedAt = endedAt;
  }
  try {
    persistCompletedSession({
      games,
      sessionId,
      writeLibrary,
      removeJournal: journalRemove
    });
  } catch (error) {
    console.error("[play-session] failed to persist completed session", error);
    scheduleMonitorCheck(current, 4000);
    return;
  }

  activePlaySessions.delete(sessionId);
  if (current.monitorTimer) clearTimeout(current.monitorTimer);
  if (current.watchdogTimer) clearInterval(current.watchdogTimer);

  const payload = {
    gameId: current.gameId,
    sessionId: current.sessionId,
    startedAt: current.startedAt,
    endedAt,
    durationSeconds,
    totalPlaySeconds: game ? (game.totalPlaySeconds ?? 0) : 0,
    sessions: game ? (Array.isArray(game.sessions) ? game.sessions : []).slice(-50) : []
  };

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("game:sessionEnded", payload);
  }
}


function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true }, (error, stdout = "") => {
      if (error) reject(error); else resolve(stdout.trim());
    });
  });
}

function launchGameWithWarmMagpie(game, settings, presetResult) {
  return new Promise((resolve, reject) => {
    const invokeArgs = ["-NoProfile", "-NonInteractive", "-File",
      app.isPackaged ? path.join(process.resourcesPath, "invoke-magpie.ps1") : path.join(__dirname, "integrations", "invoke-magpie.ps1"),
      "-MagpiePath", String(settings.magpiePath || ""),
      "-GamePath", game.executablePath,
      "-GameWorkingDirectory", game.workingDirectory || path.dirname(game.executablePath)];
    if (presetResult.changed) invokeArgs.push("-RestartForPreset");
    execFile("powershell.exe", invokeArgs, { windowsHide: true, timeout: 70000, encoding: "utf8" }, (error, stdout = "") => {
      try {
        const result = JSON.parse(stdout.trim());
        if (error || !result.scaled || !Number.isInteger(result.processId)) {
          const failure = new Error(result.error || "Magpie 未能确认游戏缩放画面");
          failure.processId = Number.isInteger(result.processId) && result.processId > 0 ? result.processId : null;
          reject(failure);
        } else resolve(result);
      } catch (parseError) {
        reject(error || parseError);
      }
    });
  });
}

async function readGameWindowState(pid) {
  const script = "$p=Get-Process -Id " + Number(pid) + " -ErrorAction SilentlyContinue; if(-not $p){exit 2}; $h=$p.MainWindowHandle; if($h -eq 0){@{hasWindow=$false}|ConvertTo-Json -Compress; exit}; Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class W { [DllImport(\"user32.dll\")] public static extern bool GetWindowRect(IntPtr h, out R r); [DllImport(\"user32.dll\")] public static extern IntPtr GetWindowLongPtr(IntPtr h, int i); [StructLayout(LayoutKind.Sequential)] public struct R { public int L; public int T; public int R; public int B; } }'; $r=New-Object W+R; [W]::GetWindowRect($h,[ref]$r)|Out-Null; $s=[W]::GetWindowLongPtr($h,-16).ToInt64(); Add-Type -AssemblyName System.Windows.Forms; $screen=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; @{hasWindow=$true; windowed=(!(($r.R-$r.L) -ge $screen.Width -and ($r.B-$r.T) -ge $screen.Height -and (($s -band 0x80000000) -ne 0)))}|ConvertTo-Json -Compress";
  try { return JSON.parse(await runPowerShell(script)); } catch { return { hasWindow: false }; }
}

async function waitForGameWindow(pid, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await readGameWindowState(pid);
    if (state.hasWindow) return state;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { hasWindow: false };
}

async function collectDescendantPids(rootPid) {
  const seen = new Set([Number(rootPid)]);
  const queue = [Number(rootPid)];
  while (queue.length > 0) {
    const parentPid = queue.shift();
    const children = await getChildPids(parentPid);
    for (const childPid of children) {
      const normalized = Number(childPid);
      if (!Number.isFinite(normalized) || normalized <= 0 || seen.has(normalized)) continue;
      seen.add(normalized);
      queue.push(normalized);
    }
  }
  return [...seen].filter((pid) => pid > 0);
}

async function waitForGameWindowInTree(rootPid, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const processIds = await collectDescendantPids(rootPid);
    for (const processId of processIds) {
      const state = await readGameWindowState(processId);
      if (state.hasWindow) return { ...state, pid: processId };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { hasWindow: false };
}

ipcMain.handle("game:launch", async (_event, game, integrationSettings = {}) => {
  const target = inspectLaunchTarget(game);
  if (!target.available) return { launched: false, reason: target.reason };
  const magpieEnabled = isGameEnhancementEnabled(game, "magpie");
  const magpieSettings = { ...integrationSettings, magpieEnabled, magpiePresetId: game?.magpiePresetId || "balanced" };

  if (!reserveGameLaunch(activePlaySessions.values(), pendingGameLaunches, game.id)) {
    throw new Error("该游戏已在记录游玩时长，请勿重复启动");
  }

  try {
    const configuredLocalePath = game?.localeEmulator?.executablePath || integrationSettings.localeEmulatorPath;
    const localeGame = game?.localeEmulator?.enabled && configuredLocalePath
      ? { ...game, localeEmulator: { ...game.localeEmulator, executablePath: configuredLocalePath } }
      : game;
    const localePlan = prepareLocaleEmulator(localeGame);
    const baselinePids = await captureProcessBaseline(monitorRootForGame(game));
    const startedAt = new Date().toISOString();
    const sessionId = crypto.randomUUID();
    const ext = path.extname(game.executablePath).toLowerCase();
    if (ext === ".lnk") {
      if (magpieEnabled) throw new Error("Magpie 联动无法验证快捷方式目标窗口，请直接选择游戏 exe");
      await shell.openPath(game.executablePath);
      startPlaySession(game, sessionId, startedAt, null, Date.now(), baselinePids);
      return { launched: true, sessionId, startedAt };
    }

    let integrationWarning = "";
    let child = null;
    let childPid = null;
    let warmMagpieLaunch = false;
    if (magpieEnabled && !localePlan && ext !== ".bat" && ext !== ".cmd") {
      try {
        const presetResult = applyMagpiePreset(magpieSettings.magpiePath, magpieSettings.magpiePresetId);
        const result = await launchGameWithWarmMagpie(game, magpieSettings, presetResult);
        childPid = result.processId;
        warmMagpieLaunch = true;
      } catch (error) {
        if (Number.isInteger(error?.processId) && error.processId > 0) {
          childPid = error.processId;
          warmMagpieLaunch = true;
          integrationWarning = `游戏已启动，但超分联动失败：${error.message}`;
        } else {
          throw new Error(`游戏未启动：超分预热失败：${error instanceof Error ? error.message : "窗口未能识别"}`);
        }
      }
    } else {
      child = localePlan ? launchLocaleEmulator(localePlan) : spawn(game.executablePath, [], {
        cwd: game.workingDirectory || path.dirname(game.executablePath),
        detached: true,
        shell: ext === ".bat" || ext === ".cmd",
        stdio: "ignore",
        windowsHide: false
      });
      await new Promise((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      childPid = child.pid;
    }

    startPlaySession(game, sessionId, startedAt, [childPid], Date.now(), baselinePids);

    if (magpieEnabled && !warmMagpieLaunch) {
      try {
        const presetResult = applyMagpiePreset(magpieSettings.magpiePath, magpieSettings.magpiePresetId);
        await prepareMagpieScaling(childPid, magpieSettings, {
          waitForWindow: (pid) => waitForGameWindowInTree(pid),
          invokeScaling: (magpiePath, pid) => new Promise((resolve, reject) => {
            const invokeArgs = ["-NoProfile", "-NonInteractive", "-File",
              app.isPackaged ? path.join(process.resourcesPath, "invoke-magpie.ps1") : path.join(__dirname, "integrations", "invoke-magpie.ps1"),
              "-MagpiePath", String(magpiePath || ""), "-GameProcessId", String(pid)];
            if (presetResult.changed) invokeArgs.push("-RestartForPreset");
            execFile("powershell.exe", invokeArgs,
            { windowsHide: true, timeout: 70000, encoding: "utf8" }, (error, stdout) => {
              try {
                const result = JSON.parse(stdout.trim());
                if (error || !result.scaled) reject(new Error(result.error || "Magpie 缩放失败"));
                else resolve(result);
              } catch (parseError) { reject(error || parseError); }
            });
          })
        });
      } catch (error) {
        integrationWarning = `游戏已启动，但超分联动失败：${error instanceof Error ? error.message : "窗口未能识别"}`;
        console.warn("[magpie] game remains running after integration failure", error);
      }
    }

    // Capture child process tree PIDs after a short delay to let the tree form
    setTimeout(async () => {
      const s = activePlaySessions.get(sessionId);
      if (!s) return;
      try {
        const childPids = await getChildPids(childPid);
        if (childPids.length > 0) {
          s.trackedPids = [childPid, ...childPids];
          s.childPid = childPid;
        }
      } catch {
        // Silent — keep the original single PID tracking
      }
    }, 2000);

    if (child) {
      child.once("exit", () => {
        const s = activePlaySessions.get(sessionId);
        if (s) scheduleMonitorCheck(s, 500);
      });
      child.once("error", () => {
        const s = activePlaySessions.get(sessionId);
        if (s) scheduleMonitorCheck(s, 500);
      });
      child.unref();
    }
    return { launched: true, sessionId, startedAt, integrationWarning: integrationWarning || undefined };
  } finally {
    releaseGameLaunch(pendingGameLaunches, game.id);
  }
});

ipcMain.on("perf:first-paint-ack", () => markPerf("first-paint-ack"));

app.whenReady().then(async () => {
  markPerf("app-ready");
  Menu.setApplicationMenu(null);

  directSession = session.fromPartition("gal-launcher-direct");
  await directSession.setProxy({ mode: "direct" });
  const environmentProxy = environmentProxyConfiguration(process.env);
  if (environmentProxy) {
    environmentProxySession = session.fromPartition("gal-launcher-environment-proxy");
    await environmentProxySession.setProxy(environmentProxy);
  }
  await configureProxy(process.env.PROXY_PORT);

  protocol.handle("local-file", (request) => {
    const url = new URL(request.url);
    let filePath = decodeURIComponent(url.pathname);
    if (/^\/[A-Za-z]:/.test(filePath)) filePath = filePath.slice(1);
    filePath = filePath.replace(/\//g, path.sep);
    return net.fetch(pathToFileURL(filePath).toString());
  });
  createWindow();
});

app.on("before-quit", () => {
  // Snapshot all active sessions so crash recovery uses exact elapsed time,
  // not wall-clock difference (critical for system shutdown without closing app)
  for (const [sid, s] of activePlaySessions) {
    const elapsed = Math.round((Date.now() - s.startedMs) / 1000);
    journalSnapshot(sid, Math.max(0, elapsed));
  }
});

app.on("window-all-closed", () => {
  // Clear cover candidate search cache on exit (not downloaded images — those may be in use)
  try {
    fs.rmSync(path.join(app.getPath("userData"), "library", "cover-candidate-cache"), { recursive: true, force: true });
  } catch {}
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
