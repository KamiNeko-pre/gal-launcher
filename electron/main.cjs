const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, protocol, session, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn, execFile } = require("node:child_process");
const { pathToFileURL } = require("node:url");

  const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
  let mainWindow;
  const activePlaySessions = new Map();

  const domainQueues = new Map();
  function limitDomain(url, concurrency = 3) {
    const origin = new URL(url).origin;
    if (!domainQueues.has(origin)) {
      domainQueues.set(origin, { running: 0, queue: [] });
    }
    const queue = domainQueues.get(origin);
    return new Promise((resolve) => {
      const run = () => {
        queue.running++;
        resolve();
      };
      if (queue.running < concurrency) {
        run();
      } else {
        queue.queue.push(run);
      }
    }).finally(() => {
      queue.running--;
      const next = queue.queue.shift();
      if (next) next();
    });
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
    titleBarStyle: "hiddenInset",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

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

function dataPath() {
  const dir = path.join(app.getPath("userData"), "library");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "games.json");
}

function readLibrary() {
  try {
    return JSON.parse(fs.readFileSync(dataPath(), "utf8"));
  } catch {
    return [];
  }
}

function writeLibrary(games) {
  fs.writeFileSync(dataPath(), JSON.stringify(games, null, 2), "utf8");
  return games;
}

function backupPayload(games) {
  return {
    app: "Gal Launcher",
    version: 1,
    exportedAt: new Date().toISOString(),
    games: Array.isArray(games) ? games : readLibrary()
  };
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

function escapePowerShellString(value) {
  return String(value || "").replace(/'/g, "''");
}

function isUsableProcessRoot(root) {
  if (!root) return false;
  const resolved = path.resolve(root);
  const parsed = path.parse(resolved);
  return resolved.length > parsed.root.length + 4;
}

function monitorRootForGame(game) {
  return game.installPath || game.workingDirectory || path.dirname(game.executablePath || "");
}

function runningProcessIdsUnder(root) {
  return new Promise((resolve) => {
    if (process.platform !== "win32" || !isUsableProcessRoot(root)) {
      resolve([]);
      return;
    }
    const normalized = path.resolve(root);
    const script = [
      `$root = '${escapePowerShellString(normalized)}'`,
      "if (-not $root.EndsWith('\\\\')) { $root = $root + '\\\\' }",
      "Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) } | Select-Object -ExpandProperty ProcessId"
    ].join("; ");
    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true, timeout: 4500, maxBuffer: 1024 * 64 },
      (error, stdout) => {
        if (error) {
          resolve([]);
          return;
        }
        resolve(String(stdout || "").split(/\r?\n/).map((line) => Number(line.trim())).filter(Number.isFinite));
      }
    );
  });
}

async function normalizeLibraryForRuntime(games) {
  if (!Array.isArray(games)) return [];
  const nowMs = Date.now();
  let changed = false;
  const normalized = [];

  for (const game of games) {
    const next = {
      ...game,
      playCount: Number.isFinite(game.playCount) ? game.playCount : 0,
      totalPlaySeconds: Number.isFinite(game.totalPlaySeconds) ? game.totalPlaySeconds : 0,
      currentSessionId: game.currentSessionId ?? null,
      currentSessionStartedAt: game.currentSessionStartedAt ?? null
    };

    if (next.currentSessionStartedAt) {
      const startedMs = new Date(next.currentSessionStartedAt).getTime();
      if (!Number.isFinite(startedMs)) {
        next.currentSessionId = null;
        next.currentSessionStartedAt = null;
        changed = true;
      } else {
        if (!next.currentSessionId) {
          next.currentSessionId = crypto.randomUUID();
          changed = true;
        }
        const pids = await runningProcessIdsUnder(monitorRootForGame(next));
        if (pids.length > 0) {
          startPlaySession(next, next.currentSessionId, next.currentSessionStartedAt, startedMs);
          monitorPlaySessionUntilQuiet(next.currentSessionId, 5000);
        } else {
          next.totalPlaySeconds += Math.max(0, Math.round((nowMs - startedMs) / 1000));
          next.currentSessionId = null;
          next.currentSessionStartedAt = null;
          changed = true;
        }
      }
    }

    normalized.push(next);
  }

  if (changed) writeLibrary(normalized);
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
    .replace(/[_-]?(chs|cn|zh|utf8|patch|translation|crack|uncensor|ai|gemini|claude|deepseek|v\d+(?:\.\d+)*)/gi, " ")
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
  const parent = path.basename(path.dirname(game.installPath || ""));
  const raw = [
    game.originalTitle,
    game.title,
    path.basename(game.installPath || ""),
    parent,
    path.basename(game.executablePath || "", path.extname(game.executablePath || ""))
  ];

  return Array.from(
    new Set(
      raw
        .map(normalizeSearchText)
        .filter((item) => !isGenericSearchText(item))
        .flatMap(expandSearchAlias)
    )
  ).slice(0, 7);
}

function rawTitleQueriesFor(game) {
  const raw = [
    game.title,
    game.originalTitle,
    path.basename(game.installPath || ""),
    path.basename(path.dirname(game.installPath || "")),
    path.basename(game.executablePath || "", path.extname(game.executablePath || ""))
  ];
  return Array.from(
    new Set(
      raw
        .map((item) => cleanText(item).replace(/\.(exe|bat|cmd|lnk)$/i, ""))
        .filter((item) => !isGenericSearchText(item))
        .flatMap((item) => [item, normalizeSearchText(item)])
        .flatMap(expandSearchAlias)
        .filter((item) => !isGenericSearchText(item))
    )
  ).slice(0, 12);
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
  if (left.includes(right) || right.includes(left)) return numberMismatch || numberMissing ? 0.58 : 0.86;
  const leftParts = new Set(left.split(/\s+/).filter((part) => part.length >= 2));
  const rightParts = new Set(right.split(/\s+/).filter((part) => part.length >= 2));
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
  if (!value) return value;
  if (hasCjk(value) && !/QUERY LENGTH LIMIT EXCEEDED|MAX ALLOWED QUERY/i.test(value)) return value;
  const chunks = [];
  for (let index = 0; index < value.length; index += 450) chunks.push(value.slice(index, index + 450));
  const translated = [];
  for (const chunk of chunks.slice(0, 4)) {
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=${encodeURIComponent(chunk)}`;
      const response = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" },
        signal: AbortSignal.timeout(12000)
      });
      if (!response.ok) throw new Error(`translate ${response.status}`);
      const data = await response.json();
      translated.push((data[0] || []).map((part) => part[0]).join(""));
    } catch {
      try {
        const fallbackUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=en|zh-CN`;
        const fallback = await fetch(fallbackUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" },
          signal: AbortSignal.timeout(15000)
        });
        if (!fallback.ok) throw new Error(`fallback translate ${fallback.status}`);
        const data = await fallback.json();
        const text = String(data.responseData?.translatedText || "");
        translated.push(/QUERY LENGTH LIMIT EXCEEDED|MAX ALLOWED QUERY/i.test(text) ? chunk : text || chunk);
      } catch {
        translated.push(chunk);
      }
    }
  }
  return translated.join("\n").trim();
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
  const response = await fetch("https://api.vndb.org/kana/vn", {
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
    signal: AbortSignal.timeout(30000)
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

async function searchMetadataCandidates(game, keyword = "") {
  const queries = keyword ? [keyword, ...titleQueriesFor({ ...game, title: keyword, originalTitle: keyword })] : titleQueriesFor(game);
  const matches = [];

  for (const query of Array.from(new Set(queries)).slice(0, 10)) {
    try {
      const results = await searchVndb(query);
      for (const vn of results) {
        const confidence = scoreVnCandidate(query, vn);
        if (confidence >= 0.5) matches.push({ vn, confidence, query });
      }
    } catch {
      continue;
    }
  }

  const bestById = new Map();
  for (const match of matches.sort((a, b) => b.confidence - a.confidence)) {
    const existing = bestById.get(match.vn.id);
    if (!existing || match.confidence > existing.confidence) bestById.set(match.vn.id, match);
  }

  return Array.from(bestById.values())
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 8)
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
}

async function hydrateMetadataCandidate(game, candidate) {
  const vn = (await getVndbById(candidate.sourceId)) || (await searchVndb(candidate.title || "")).find((item) => item.id === candidate.sourceId);
  if (!vn) return { confidence: 0, source: "none" };
  const coverPath = await downloadOnlineImage(vn.image?.url, `${game.id || vn.id}-${vn.id}`, "covers");
  const title = pickPreferredTitle(vn);
  const developer = (vn.developers || []).map((item) => item.name).filter(Boolean).join(", ");
  const description = await translateToChinese(vn.description || "");

  return {
    source: "vndb",
    sourceId: vn.id,
    confidence: candidate.confidence || 0,
    title,
    originalTitle: vn.alttitle || vn.title || "",
    developer,
    releaseDate: vn.released || "",
    description,
    coverPath,
    backgroundPath: coverPath,
    tags: []
  };
}

function coverCandidateScore(filePath, sourceWeight = 0) {
  const dimensions = imageDimensions(filePath);
  if (!dimensions.width || !dimensions.height) return null;
  if (dimensions.width < 1080 || dimensions.height < 600) return null;
  const ratio = dimensions.ratio;
  if (ratio < 1.18 || ratio > 2.8) return null;

  const megapixels = (dimensions.width * dimensions.height) / 1_000_000;
  const name = path.basename(filePath).toLowerCase();
  let score = sourceWeight + Math.min(80, megapixels * 28);
  if (ratio >= 1.45 && ratio <= 1.95) score += 50;
  if (dimensions.width >= 1280) score += 28;
  if (dimensions.width >= 1920) score += 24;
  if (dimensions.height >= 720) score += 18;
  if (/mainvisual|keyvisual|visual|kv|hero|background|wallpaper|ogp|top|main|official/i.test(name)) score += 28;
  if (/cover|jacket|package|poster|icon|logo|button|thumb|thumbnail|caution|warning|readme|manual|sprite/i.test(name)) score -= 60;
  if (/cg|ss|sample|event/i.test(name)) score -= 24;

  return { width: dimensions.width, height: dimensions.height, score };
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

function coverCacheKey(game) {
  const value = [
    game.id,
    game.title,
    game.originalTitle,
    game.developer,
    game.installPath,
    game.executablePath
  ].filter(Boolean).join("|");
  return crypto.createHash("sha1").update(value || "unknown").digest("hex");
}

function coverCachePath(game) {
  return path.join(assetDir("cover-candidate-cache"), `${coverCacheKey(game)}.json`);
}

function readCoverCandidateCache(game) {
  const payload = readJsonFile(coverCachePath(game), null);
  if (!payload || !Array.isArray(payload.candidates)) return [];
  if (payload.version !== 4) return [];
  const ageMs = Date.now() - new Date(payload.updatedAt || 0).getTime();
  if (!Number.isFinite(ageMs) || ageMs > 10 * 60 * 1000) return [];
  return payload.candidates
    .filter((candidate) => candidate?.path && fs.existsSync(candidate.path))
    .slice(0, 24);
}

function writeCoverCandidateCache(game, candidates) {
  writeJsonFile(coverCachePath(game), {
    version: 4,
    updatedAt: new Date().toISOString(),
    candidates
  });
}

async function downloadCandidate(game, url, source, sourceWeight, reason) {
  if (!url) return null;
  const filePath = candidateFilePath(game, url, source.toLowerCase().replace(/[^a-z0-9]+/g, ""));
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return null;
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

async function searchBangumi(query) {
  const response = await fetch("https://api.bgm.tv/v0/search/subjects", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 (local personal use)"
    },
    body: JSON.stringify({
      keyword: query,
      filter: { type: [4], nsfw: true },
      sort: "match"
    }),
    signal: AbortSignal.timeout(6000)
  });
  if (!response.ok) {
    console.log(`[bangumi] API error ${response.status} for "${query}": ${response.statusText}`);
    return [];
  }
  return (await response.json()).data || [];
}

function parseBangumiSearchItems(html, query) {
  const items = [];
  const blocks = html.match(/<li id=["']item_\d+["'][\s\S]*?<\/li>/gi) || [];
  for (const block of blocks) {
    const id = Number(block.match(/id=["']item_(\d+)["']/i)?.[1] || 0);
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
    console.log(`[bangumi] web error ${response.status} for "${query}": ${response.statusText}`);
    return [];
  }
  const html = await response.text();
  const items = parseBangumiSearchItems(html, query);
  console.log(`[bangumi] web scrape "${query}": ${items.length} items found`);
  return items;
}

async function searchBangumiApiItems(query) {
  const results = await searchBangumi(query).catch((err) => {
    console.log(`[bangumi] API fetch error for "${query}": ${err.message}`);
    return [];
  });
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
  const queries = rawTitleQueriesFor(game).slice(0, 8);
  console.log(`[bangumi] lookup "${game.title}" queries:`, queries);
  const settled = await Promise.allSettled(
    queries.flatMap((query) => [
      searchBangumiWeb(query).then((items) => ({ query, items, source: "web" })),
      searchBangumiApiItems(query).then((items) => ({ query, items, source: "api" }))
    ])
  );
  let best = null;
  for (const item of settled) {
    if (item.status !== "fulfilled") continue;
    for (const result of item.value.items.slice(0, 4)) {
      console.log(`[bangumi] candidate q="${item.value.query}" src=${item.value.source} title="${result.title}" score=${result.score} count=${result.scoreCount} confidence=${result.confidence.toFixed(3)}`);
      if (!best || result.confidence > best.confidence || (result.confidence === best.confidence && result.scoreCount > best.scoreCount)) {
        best = result;
      }
    }
  }

  if (!best || best.confidence < 0.72 || !best.score || best.scoreCount < 1) {
    const reason = !best ? "no results" : best.confidence < 0.72 ? `confidence ${best.confidence.toFixed(3)} < 0.72` : `score=${best.score} count=${best.scoreCount}`;
    console.log(`[bangumi] MISS for "${game.title}": ${reason}`);
    return { bgmScore: 0, bgmScoreCount: 0, bgmRank: 0, bgmId: 0, bgmRatingCheckedAt: new Date().toISOString() };
  }

  console.log(`[bangumi] HIT for "${game.title}": score=${best.score} count=${best.scoreCount} confidence=${best.confidence.toFixed(3)}`);
  return {
    bgmScore: best.score,
    bgmScoreCount: best.scoreCount,
    bgmRank: best.rank || 0,
    bgmId: best.id,
    bgmRatingCheckedAt: new Date().toISOString()
  };
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
    if (!title || /新人必读|广告|合作|友情链接|TG|群/i.test(title)) continue;
    const score = Math.max(similarity(query, title), similarity(normalizeSearchText(query), normalizeSearchText(title)));
    if (score < 0.22 && !normalizeSearchText(title).includes(normalizeSearchText(query))) continue;
    seen.add(url);
    articles.push({ url, title, score });
  }

  for (const match of html.matchAll(/href=["'](https:\/\/lzacg\.cc\/\d+)["'][^>]*title=["']([^"']+)["']/gi)) {
    const url = match[1];
    if (seen.has(url)) continue;
    const title = stripMarkup(match[2]);
    if (!title || /新人必读|广告|合作|友情链接|TG|群/i.test(title)) continue;
    const score = Math.max(similarity(query, title), similarity(normalizeSearchText(query), normalizeSearchText(title)));
    if (score < 0.22 && !normalizeSearchText(title).includes(normalizeSearchText(query))) continue;
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
    if (!title || /新人必读|广告|合作|友情链接|TG|群/i.test(title)) continue;
    const score = Math.max(similarity(query, title), similarity(normalizeSearchText(query), normalizeSearchText(title)));
    if (score < 0.2 && !normalizeSearchText(title).includes(normalizeSearchText(query))) continue;
    seen.add(link);
    articles.push({ url: link, title, score });
  }
  return articles;
}

async function searchLzacgArticles(query, categoryPageLimit = 8) {
  const all = [];
  try {
    await limitDomain("https://lzacg.cc/", 3);
    const response = await fetch(`https://lzacg.cc/?s=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" },
      signal: AbortSignal.timeout(9000)
    });
    if (response.ok) all.push(...lzacgArticlesFromSearch(await response.text(), query));
  } catch (error) {
    console.warn("[cover] Lzacg search failed:", error.message?.slice(0, 80));
  }

  const categoryPages = [
    "https://lzacg.cc/category/galgame",
    ...Array.from({ length: Math.max(0, categoryPageLimit - 1) }, (_, index) => `https://lzacg.cc/category/galgame/page/${index + 2}`)
  ];
  const settled = await Promise.allSettled(
    categoryPages.map(async (url) => {
      await limitDomain(url, 3);
      const response = await fetch(url, {
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
    await limitDomain(article.url, 3);
    const response = await fetch(article.url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" },
      signal: AbortSignal.timeout(9000)
    });
    if (!response.ok) return [];
    const urls = lzacgImageUrlsFromArticle(await response.text(), article.url);
    const settled = await Promise.allSettled(
      urls.slice(0, 5).map((url, index) =>
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
  const searchSettled = await Promise.allSettled(queries.map((query) => searchLzacgArticles(query, options.fast ? 4 : 10)));
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
  // product images — look for img tags with modpub/img.dlsite.jp in src
  for (const match of html.matchAll(/<img[^>]+src=["']([^"']*img\.dlsite\.jp[^"']+)["'][^>]*>/gi)) {
    urls.push(match[1]);
  }
  for (const match of html.matchAll(/<img[^>]+data-src=["']([^"']*img\.dlsite\.jp[^"']+)["'][^>]*>/gi)) {
    urls.push(match[1]);
  }
  // normalize: strip resize suffixes to get original resolution
  return Array.from(new Set(urls)).map((raw) => {
    let u = raw.replace(/&amp;/g, "&");
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
  // Match product links: /maniax/work/=/product_id/XXX.html or /work/=/product_id/XXX.html
  // Links have title attribute with the product name
  const linkPattern = /<a[^>]+href=["'](\/[^"']*\/work\/=\/product_id\/[^"'\s]+?)(?:\.html)?["'][^>]*>/gi;
  for (const match of html.matchAll(linkPattern)) {
    const rawLink = match[1];
    if (seen.has(rawLink) || /reviewlist/i.test(rawLink)) continue;
    seen.add(rawLink);
    // Prefer title attribute, fallback to link text
    const titleAttr = match[0].match(/title=["']([^"']+)["']/i);
    const title = titleAttr ? titleAttr[1].trim() : stripMarkup(match[0].replace(/<[^>]+>/g, " ")).trim();
    if (!title || title.length < 2) continue;
    const score = Math.max(similarity(query, title), similarity(normalizeSearchText(query), normalizeSearchText(title)));
    if (score < 0.12) continue;
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
      await limitDomain("https://www.dlsite.com", 3);
      const response = await fetch(url, {
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
    await limitDomain("https://www.dlsite.com", 3);
    const response = await fetch(article.url, {
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
  // Match subject item cards: /subjects/<id>
  const itemPattern = /<a[^>]+href=["'](\/subjects\/\d+[^"']*)["'][^>]*>/gi;
  for (const match of html.matchAll(itemPattern)) {
    const link = match[1];
    if (seen.has(link)) continue;
    seen.add(link);
    const ctx = html.slice(Math.max(0, match.index - 600), match.index + 1200);
    const titleMatch = ctx.match(/<a[^>]+href=["'][^"']*\/subjects\/[^"']+["'][^>]*>([\s\S]*?)<\/a>/i);
    const title = titleMatch ? stripMarkup(titleMatch[1]).trim() : "";
    if (!title) continue;
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
    { url: `https://2dfan.com/subjects/search.json?q=${encoded}`, type: "json" },
    { url: `https://2dfan.com/subjects/search?q=${encoded}`, type: "html" }
  ];

  const settled = await Promise.allSettled(urls.map(async ({ url, type }) => {
    try {
      await limitDomain("https://2dfan.com", 3);
      const response = await fetch(url, {
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
    await limitDomain("https://2dfan.com", 3);
    const response = await fetch(subject.url, {
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
      if (confidence >= 0.72) matches.push({ vn, confidence, query: item.value.query });
    }
  }

  const bestById = new Map();
  for (const match of matches.sort((a, b) => b.confidence - a.confidence)) {
    const existing = bestById.get(match.vn.id);
    if (!existing || match.confidence > existing.confidence) bestById.set(match.vn.id, match);
  }

  const downloads = [];
  for (const { vn, confidence } of Array.from(bestById.values()).slice(0, 2)) {
    const urls = Array.from(new Set((vn.screenshots || []).flatMap((shot) => [shot.url, shot.thumbnail]).filter(Boolean)));
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
        if (confidence < 0.76 || !vn.image?.url || seen.has(vn.image.url)) continue;
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
    const hasAscii = (s) => /[A-Za-z0-9]/.test(s);
    const queries = rawTitleQueriesFor(game)
      .filter((q) => q.length >= 3 && hasAscii(q))
      .slice(0, 6);
    const appMatches = [];
    for (const query of queries) {
      try {
        const response = await fetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&l=english&cc=us`, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" },
          signal: AbortSignal.timeout(7000)
        });
        if (!response.ok) continue;
        const data = await response.json();
        for (const item of (data.items || []).slice(0, 8)) {
          const confidence = similarity(query, item.name || "");
          if (confidence >= 0.45) appMatches.push({ appid: item.id, name: item.name, confidence, query });
        }
      } catch (error) {
        console.warn("[cover] Steam search failed:", error.message?.slice(0, 80));
      }
    }

    if (!process.env.COVER_QUIET) {
      console.log(`[cover:${game.title.slice(0, 20)}] Steam: ${queries.length} queries, ${appMatches.length} app matches`);
    }

    const bestByApp = new Map();
    for (const match of appMatches.sort((a, b) => b.confidence - a.confidence)) {
      if (!bestByApp.has(match.appid)) bestByApp.set(match.appid, match);
    }

    const downloads = [];
    for (const match of Array.from(bestByApp.values()).slice(0, 4)) {
      try {
        const response = await fetch(`https://store.steampowered.com/api/appdetails?appids=${match.appid}&filters=basic,screenshots`, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" },
          signal: AbortSignal.timeout(7000)
        });
        if (!response.ok) continue;
        const details = (await response.json())?.[match.appid]?.data;
        if (!details) continue;
        const urls = [
          `https://cdn.cloudflare.steamstatic.com/steam/apps/${match.appid}/library_hero.jpg`,
          `https://cdn.cloudflare.steamstatic.com/steam/apps/${match.appid}/capsule_616x353.jpg`,
          `https://cdn.cloudflare.steamstatic.com/steam/apps/${match.appid}/header.jpg`,
          details.header_image,
          ...(details.screenshots || []).flatMap((shot) => [shot.path_full, shot.path_thumbnail])
        ].filter(Boolean);
        for (const [index, url] of Array.from(new Set(urls)).slice(0, 14).entries()) {
          const isLibraryAsset = /library_hero|capsule_616x353|header\.jpg/i.test(url);
          const weight = (isLibraryAsset ? 148 : 122) + match.confidence * 38 - index * 2;
          downloads.push(downloadCandidate(game, url, "Steam", weight, `${details.name || match.name} / Steam ${match.appid}`));
        }
      } catch (error) {
        console.warn("[cover] Steam details failed:", error.message?.slice(0, 80));
      }
    }

    const results = await Promise.allSettled(downloads);
    const passed = results.filter((item) => item.status === "fulfilled" && item.value).length;
    if (!process.env.COVER_QUIET) {
      console.log(`[cover:${game.title.slice(0, 20)}] Steam: ${downloads.length} downloaded, ${passed} passed quality`);
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
    await limitDomain(pageUrl, 3);
    const response = await fetch(pageUrl, {
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
      const response = await fetch(`https://api.bgm.tv/v0/subjects/${item.id}`, {
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
  const cached = readCoverCandidateCache(game);
  if (cached.length >= 6) return cached;

  const localCandidates = [
    existingCoverCandidate(game)
  ].filter(Boolean);

  const sourceLabels = ["Steam", "Lzacg", "VNDB(screenshot)", "VNDB(image)", "Bangumi"];
  const fastResults = await Promise.allSettled([
    findSteamCandidates(game),
    findLzacgCandidates(game, { fast: true }),
    findVndbScreenshotCandidates(game),
    findVndbImageCandidates(game),
    findBangumiCoverCandidates(game)
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

  if (candidates.length) writeCoverCandidateCache(game, candidates);
  return candidates;
}

ipcMain.handle("library:load", async () => normalizeLibraryForRuntime(readLibrary()));

ipcMain.handle("library:save", (_event, games) => writeLibrary(games));

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

ipcMain.handle("game:rescanMetadata", async (_event, game) => {
  const installPath = game.installPath || path.dirname(game.executablePath);
  return scanGameMetadata(installPath, game.executablePath);
});

ipcMain.handle("game:enrichOnlineMetadata", async (_event, game) => enrichOnlineMetadata(game));

ipcMain.handle("game:searchMetadataCandidates", async (_event, game, keyword) => searchMetadataCandidates(game, keyword));

ipcMain.handle("game:applyMetadataCandidate", async (_event, game, candidate) => hydrateMetadataCandidate(game, candidate));

ipcMain.handle("game:findCoverCandidates", async (_event, game) => {
  try {
    return await findCoverCandidates(game);
  } catch (error) {
    console.error("findCoverCandidates failed:", error);
    return [];
  }
});

ipcMain.handle("game:lookupBangumiRating", async (_event, game) => lookupBangumiRating(game));

ipcMain.handle("library:export", async (_event, games) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Export library backup",
    defaultPath: `gal-launcher-backup-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: "JSON", extensions: ["json"] }]
  });
  if (result.canceled || !result.filePath) return "";
  fs.writeFileSync(result.filePath, JSON.stringify(backupPayload(games), null, 2), "utf8");
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
  const games = Array.isArray(data) ? data : data.games;
  if (!Array.isArray(games)) throw new Error("Invalid backup file");
  writeLibrary(games);
  return games;
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

function startPlaySession(game, sessionId, startedAt, startedMs = Date.now()) {
  const monitorRoot = monitorRootForGame(game);
  const session = {
    gameId: game.id,
    sessionId,
    startedAt,
    startedMs,
    monitorRoot,
    emptyChecks: 0,
    monitorTimer: null
  };
  activePlaySessions.set(sessionId, session);
  return session;
}

function finishPlaySession(sessionId) {
  const current = activePlaySessions.get(sessionId);
  if (!current) return;
  activePlaySessions.delete(sessionId);
  if (current.monitorTimer) clearTimeout(current.monitorTimer);
  const endedMs = Date.now();
  const payload = {
    gameId: current.gameId,
    sessionId: current.sessionId,
    startedAt: current.startedAt,
    endedAt: new Date(endedMs).toISOString(),
    durationSeconds: Math.max(0, Math.round((endedMs - current.startedMs) / 1000))
  };

  const games = readLibrary();
  const game = games.find((g) => g.id === current.gameId);
  if (game) {
    const sessions = Array.isArray(game.sessions) ? game.sessions : [];
    sessions.push({
      sessionId: current.sessionId,
      startedAt: current.startedAt,
      endedAt: payload.endedAt,
      durationSeconds: payload.durationSeconds
    });
    game.sessions = sessions.slice(-50);
  }
  writeLibrary(games);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("game:sessionEnded", payload);
  }
}

function monitorPlaySessionUntilQuiet(sessionId, initialDelayMs = 6000) {
  const schedule = (delay) => {
    const current = activePlaySessions.get(sessionId);
    if (!current) return;
    current.monitorTimer = setTimeout(async () => {
      const latest = activePlaySessions.get(sessionId);
      if (!latest) return;
      const pids = await runningProcessIdsUnder(latest.monitorRoot);
      if (pids.length > 0) {
        latest.emptyChecks = 0;
        schedule(5000);
        return;
      }
      latest.emptyChecks = (latest.emptyChecks || 0) + 1;
      if (latest.emptyChecks >= 2) {
        finishPlaySession(sessionId);
      } else {
        schedule(3500);
      }
    }, delay);
  };
  schedule(initialDelayMs);
}

ipcMain.handle("game:launch", async (_event, game) => {
  if (!game?.executablePath || !fs.existsSync(game.executablePath)) {
    throw new Error("Launch file does not exist");
  }

  const startedAt = new Date().toISOString();
  const sessionId = crypto.randomUUID();
  const ext = path.extname(game.executablePath).toLowerCase();
  if (ext === ".lnk") {
    await shell.openPath(game.executablePath);
    startPlaySession(game, sessionId, startedAt);
    monitorPlaySessionUntilQuiet(sessionId, 10000);
    return { launched: true, sessionId, startedAt };
  }

  const child = spawn(game.executablePath, [], {
    cwd: game.workingDirectory || path.dirname(game.executablePath),
    detached: true,
    shell: ext === ".bat" || ext === ".cmd",
    stdio: "ignore",
    windowsHide: false
  });

  startPlaySession(game, sessionId, startedAt);
  child.once("exit", () => monitorPlaySessionUntilQuiet(sessionId, 4500));
  child.once("error", () => finishPlaySession(sessionId));
  child.unref();
  return { launched: true, sessionId, startedAt };
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);

  // Proxy: route everything through local proxy except Lzacg (blocked by VPN)
  const proxyPort = process.env.PROXY_PORT || "7897";
  session.defaultSession.setProxy({
    proxyRules: `http://127.0.0.1:${proxyPort}`,
    proxyBypassRules: "lzacg.cc,*.lzacg.cc,ossimg.nyaya.top,*.ossimg.nyaya.top,<local>"
  }).catch(() => {});

  protocol.handle("local-file", (request) => {
    const url = new URL(request.url);
    let filePath = decodeURIComponent(url.pathname);
    if (/^\/[A-Za-z]:/.test(filePath)) filePath = filePath.slice(1);
    filePath = filePath.replace(/\//g, path.sep);
    return net.fetch(pathToFileURL(filePath).toString());
  });
  createWindow();
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
