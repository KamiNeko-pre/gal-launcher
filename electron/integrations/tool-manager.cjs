const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { Readable } = require("node:stream");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const { validateLocaleEmulator } = require("./locale-emulator.cjs");
const { validateMagpiePath } = require("./magpie.cjs");

const execFileAsync = promisify(execFile);

// These are intentionally pinned. The launcher does not mirror or bundle either
// third-party project; it only downloads the published archive after showing the
// source and verifies the bytes before deploying them.
const TOOL_DEFINITIONS = Object.freeze({
  localeEmulator: Object.freeze({
    id: "localeEmulator",
    name: "Locale Emulator",
    version: "2.5.0.1",
    archiveName: "Locale.Emulator.2.5.0.1.zip",
    downloadUrl: "https://github.com/xupefei/Locale-Emulator/releases/download/v2.5.0.1/Locale.Emulator.2.5.0.1.zip",
    sourceUrl: "https://github.com/xupefei/Locale-Emulator",
    license: "MIT",
    executable: "LEProc.exe",
    requiredFiles: ["LEProc.exe", "LEInstaller.exe", "LoaderDll.dll", "LocaleEmulator.dll"],
    directoryName: "locale-emulator",
    sha256: "808ff584426d52cc775ad6406da00622f454be95bd4c8fbca42eef4b7235ad5c",
  }),
  magpie: Object.freeze({
    id: "magpie",
    name: "Magpie",
    version: "0.12.1",
    archiveName: "Magpie-v0.12.1-x64.zip",
    downloadUrl: "https://github.com/Blinue/Magpie/releases/download/v0.12.1/Magpie-v0.12.1-x64.zip",
    sourceUrl: "https://github.com/Blinue/Magpie",
    license: "MIT",
    executable: "Magpie.exe",
    requiredFiles: ["Magpie.exe"],
    directoryName: "magpie",
    sha256: "8bc8bc233438f546b7996b00b21d7376f4f7d3d8a4940e6a8800babd2225b2de",
  }),
});

function getDefinition(toolId) {
  const definition = TOOL_DEFINITIONS[toolId];
  if (!definition) {
    const error = new Error(`Unknown enhancement tool: ${toolId}`);
    error.code = "unknown-tool";
    throw error;
  }
  return definition;
}

function normalizeForComparison(value) {
  return String(value).replaceAll("\\", "/");
}

function isSafeArchiveEntry(entry) {
  const normalized = normalizeForComparison(entry).replace(/^\.\//, "");
  if (!normalized || normalized.includes("\0") || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
    return false;
  }
  const parts = normalized.split("/");
  return parts.every((part, index) => part !== ".." && (part !== "" || index === parts.length - 1));
}

function normalizeArchiveEntries(entries) {
  if (!Array.isArray(entries)) {
    const error = new Error("Archive listing did not return a file list");
    error.code = "archive-list-invalid";
    throw error;
  }
  const listed = entries
    .map((entry) => normalizeForComparison(entry).replace(/^\.\//, ""))
    .filter(Boolean);
  const unsafe = listed.find((entry) => !isSafeArchiveEntry(entry));
  if (unsafe) {
    const error = new Error(`Archive entry escapes the deployment directory: ${unsafe}`);
    error.code = "archive-path-traversal";
    error.entry = unsafe;
    throw error;
  }
  return [...new Set(listed.filter((entry) => !entry.endsWith("/")))];
}

function findArchiveFile(entries, fileName) {
  const normalizedName = normalizeForComparison(fileName).toLowerCase();
  return entries.find((entry) => entry.toLowerCase() === normalizedName)
    || entries.find((entry) => path.posix.basename(entry).toLowerCase() === normalizedName);
}

function resolveInside(rootPath, ...parts) {
  const root = path.resolve(rootPath);
  const resolved = path.resolve(root, ...parts);
  const relative = path.relative(root, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    const error = new Error(`Path escapes the tool directory: ${resolved}`);
    error.code = "unsafe-path";
    throw error;
  }
  return resolved;
}

function defaultMagpieConfigPath() {
  const localAppData = process.env.LOCALAPPDATA
    || (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "AppData", "Local") : "");
  return localAppData ? path.join(localAppData, "Magpie", "config", "v4", "config.json") : "";
}

async function prepareMagpiePortableConfig(stagingRoot, installOptions, fsImpl) {
  const configDirectory = resolveInside(stagingRoot, "config");
  await ensureDirectory(fsImpl, configDirectory);
  let config = {};
  const sourcePath = installOptions.magpieConfigPath || defaultMagpieConfigPath();
  if (sourcePath && fsImpl.existsSync?.(sourcePath) && typeof fsImpl.readFileSync === "function") {
    try {
      const parsed = JSON.parse(fsImpl.readFileSync(sourcePath, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) config = parsed;
    } catch {
      // An invalid global config must not be copied into the isolated install.
    }
  }
  // The launcher invokes the managed Magpie instance directly. Preserve all
  // user shortcuts and profiles; no global hotkey needs to be reserved.
  const configPath = resolveInside(configDirectory, "config.json");
  const contents = JSON.stringify(config, null, 2);
  if (typeof fsImpl.writeFileSync === "function") fsImpl.writeFileSync(configPath, contents, "utf8");
  else await fsp.writeFile(configPath, contents, "utf8");
  return configPath;
}

function makeOperationId() {
  return `${Date.now().toString(36)}-${crypto.randomBytes(5).toString("hex")}`;
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    const error = new Error("Tool installation was cancelled");
    error.code = "cancelled";
    throw error;
  }
}

async function defaultDownload(definition, archivePath, { fetchImpl, onProgress, signal } = {}) {
  const request = fetchImpl || globalThis.fetch;
  if (typeof request !== "function") {
    const error = new Error("No network fetch implementation is available");
    error.code = "fetch-unavailable";
    throw error;
  }
  const response = await request(definition.downloadUrl, { signal });
  if (!response?.ok) {
    const error = new Error(`官方下载失败（HTTP ${response?.status || "网络错误"}）`);
    error.code = "download-http-error";
    error.status = response?.status;
    throw error;
  }

  const total = Number(response.headers?.get?.("content-length")) || 0;
  let received = 0;
  const writeStream = fs.createWriteStream(archivePath, { flags: "wx" });
  try {
    if (response.body && typeof Readable.fromWeb === "function") {
      const readable = Readable.fromWeb(response.body);
      for await (const chunk of readable) {
        throwIfAborted(signal);
        writeStream.write(chunk);
        received += chunk.length;
        onProgress?.({ phase: "downloading", receivedBytes: received, totalBytes: total, percent: total ? Math.floor(received * 100 / total) : null });
      }
    } else {
      const bytes = Buffer.from(await response.arrayBuffer());
      throwIfAborted(signal);
      writeStream.write(bytes);
      received = bytes.length;
      onProgress?.({ phase: "downloading", receivedBytes: received, totalBytes: total || received, percent: 100 });
    }
  } finally {
    await new Promise((resolve) => writeStream.end(resolve));
  }
}

async function defaultListArchive(archivePath) {
  const { stdout } = await execFileAsync("tar", ["-tf", archivePath], { windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
  return stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

async function defaultExtract(archivePath, destinationPath) {
  await execFileAsync("tar", ["-xf", archivePath, "-C", destinationPath], { windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
}

async function ensureDirectory(fsImpl, directoryPath) {
  if (typeof fsImpl.mkdirSync === "function") {
    fsImpl.mkdirSync(directoryPath, { recursive: true });
    return;
  }
  await fsp.mkdir(directoryPath, { recursive: true });
}

async function removeDirectory(fsImpl, directoryPath) {
  if (typeof fsImpl.rmSync === "function") {
    fsImpl.rmSync(directoryPath, { recursive: true, force: true });
    return;
  }
  await fsp.rm(directoryPath, { recursive: true, force: true });
}

function createToolManager(options = {}) {
  const rootPath = path.resolve(options.rootPath || path.join(os.tmpdir(), "gal-launcher-tools"));
  const prepareLocaleRuntimeScriptPath = options.prepareLocaleRuntimeScriptPath
    || path.join(__dirname, "prepare-locale-runtime.ps1");
  const fsImpl = options.fsImpl || fs;
  const fetchImpl = options.fetchImpl;
  const downloadImpl = options.downloadImpl || defaultDownload;
  const listArchiveImpl = options.listArchiveImpl || defaultListArchive;
  const extractImpl = options.extractImpl || defaultExtract;
  const validateImpl = options.validateImpl || ((toolId, executablePath) => {
    if (toolId === "localeEmulator") return validateLocaleEmulator(executablePath, { fsImpl });
    return validateMagpiePath(executablePath, fsImpl);
  });
  const idFactory = options.idFactory || makeOperationId;

  function pathsFor(definition) {
    const toolRoot = resolveInside(rootPath, definition.directoryName);
    const versionRoot = resolveInside(toolRoot, definition.version);
    const currentFile = resolveInside(toolRoot, "current.json");
    return { toolRoot, versionRoot, currentFile };
  }

  function existingStatus(definition) {
    const { toolRoot, versionRoot, currentFile } = pathsFor(definition);
    let executablePath = resolveInside(versionRoot, definition.executable);
    if (fsImpl.existsSync?.(currentFile) && typeof fsImpl.readFileSync === "function") {
      try {
        const pointer = JSON.parse(fsImpl.readFileSync(currentFile, "utf8"));
        if (pointer?.version === definition.version && typeof pointer.executablePath === "string") {
          const pointedPath = path.resolve(pointer.executablePath);
          const relative = path.relative(toolRoot, pointedPath);
          if (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
            executablePath = pointedPath;
          }
        }
      } catch {
        // A corrupt pointer is treated as unavailable; the next install can
        // produce a fresh one without touching any other user installation.
      }
    }
    if (!fsImpl.existsSync?.(executablePath)) return null;
    const portableConfigPath = resolveInside(versionRoot, "config", "config.json");
    if (definition.id === "magpie" && !fsImpl.existsSync?.(portableConfigPath)) return null;
    const validation = validateImpl(definition.id, executablePath);
    if (!validation?.ok) return null;
    return { status: "available", toolId: definition.id, version: definition.version, executablePath, reused: true };
  }

  function selectExisting(toolId, executablePath) {
    const definition = getDefinition(toolId);
    if (typeof executablePath !== "string" || !executablePath.trim()) {
      const error = new Error(`请选择 ${definition.executable}`);
      error.code = "missing-tool-path";
      throw error;
    }
    const resolvedPath = path.resolve(executablePath);
    if (path.basename(resolvedPath).toLowerCase() !== definition.executable.toLowerCase()) {
      const error = new Error(`路径必须指向 ${definition.executable}`);
      error.code = "invalid-tool-path";
      throw error;
    }
    const validation = validateImpl(definition.id, resolvedPath);
    if (!validation?.ok) {
      const error = new Error(validation.message || "已有工具校验失败");
      error.code = validation.code || "invalid-tool-installation";
      error.details = validation;
      throw error;
    }
    return { status: "available", toolId, version: definition.version, executablePath: resolvedPath, reused: false };
  }

  async function install(toolId, installOptions = {}) {
    const definition = getDefinition(toolId);
    const onProgress = installOptions.onProgress;
    const signal = installOptions.signal;
    throwIfAborted(signal);
    onProgress?.({ phase: "checking", toolId, version: definition.version, percent: 0 });

    const reused = existingStatus(definition);
    if (reused) {
      onProgress?.({ phase: "available", toolId, version: definition.version, percent: 100, reused: true });
      return reused;
    }

    const { toolRoot, versionRoot, currentFile } = pathsFor(definition);
    const operationId = idFactory();
    const tempRoot = resolveInside(rootPath, ".tmp", `${definition.directoryName}-${operationId}`);
    const archivePath = resolveInside(tempRoot, definition.archiveName);
    const stagingRoot = resolveInside(tempRoot, "payload");
    try {
      await ensureDirectory(fsImpl, tempRoot);
      await ensureDirectory(fsImpl, stagingRoot);
      throwIfAborted(signal);
      if (installOptions.localArchivePath) {
        const localArchivePath = path.resolve(installOptions.localArchivePath);
        if (!fsImpl.existsSync?.(localArchivePath)) {
          const error = new Error("选择的官方压缩包不存在");
          error.code = "local-archive-not-found";
          throw error;
        }
        onProgress?.({ phase: "using-local-archive", toolId, version: definition.version, percent: null });
        if (typeof fsImpl.copyFileSync === "function") fsImpl.copyFileSync(localArchivePath, archivePath);
        else await fsp.copyFile(localArchivePath, archivePath);
      } else {
        onProgress?.({ phase: "downloading", toolId, version: definition.version, percent: null });
        await downloadImpl(definition, archivePath, { fetchImpl, onProgress, signal });
      }
      throwIfAborted(signal);

      onProgress?.({ phase: "verifying", toolId, version: definition.version, percent: null });
      const archiveEntries = normalizeArchiveEntries(await listArchiveImpl(archivePath, definition));
      const executableEntry = findArchiveFile(archiveEntries, definition.executable);
      const missing = definition.requiredFiles.filter((fileName) => !findArchiveFile(archiveEntries, fileName));
      if (!executableEntry || missing.length > 0) {
        const error = new Error(`官方压缩包缺少运行文件：${missing.join(", ") || definition.executable}`);
        error.code = "archive-missing-runtime";
        error.missing = missing.length > 0 ? missing : [definition.executable];
        throw error;
      }

      const hash = await hashFile(archivePath, fsImpl);
      if (hash !== definition.sha256) {
        const error = new Error(`官方下载包校验失败：SHA-256 ${hash}`);
        error.code = "checksum-mismatch";
        error.actual = hash;
        error.expected = definition.sha256;
        throw error;
      }

      onProgress?.({ phase: "deploying", toolId, version: definition.version, percent: null });
      await extractImpl(archivePath, stagingRoot, definition);
      if (definition.id === "magpie") await prepareMagpiePortableConfig(stagingRoot, installOptions, fsImpl);
      const deployedExecutable = resolveInside(stagingRoot, ...normalizeForComparison(executableEntry).split("/"));
      if (definition.id === "localeEmulator") {
        await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-File",
          prepareLocaleRuntimeScriptPath, "-Directory", path.dirname(deployedExecutable)],
        { windowsHide: true, timeout: 30000 });
      }
      const deployedValidation = validateImpl(definition.id, deployedExecutable);
      if (!deployedValidation?.ok) {
        const error = new Error(deployedValidation?.message || "部署后的工具校验失败");
        error.code = "deployment-invalid";
        error.details = deployedValidation;
        throw error;
      }

      await ensureDirectory(fsImpl, toolRoot);
      if (fsImpl.existsSync?.(versionRoot)) {
        const preservedPath = resolveInside(toolRoot, `${definition.version}.previous-${operationId}`);
        if (typeof fsImpl.renameSync === "function") fsImpl.renameSync(versionRoot, preservedPath);
        else await fsp.rename(versionRoot, preservedPath);
      }
      if (typeof fsImpl.renameSync === "function") fsImpl.renameSync(stagingRoot, versionRoot);
      else await fsp.rename(stagingRoot, versionRoot);
      const executablePath = resolveInside(versionRoot, ...normalizeForComparison(executableEntry).split("/"));

      if (typeof fsImpl.writeFileSync === "function") {
        fsImpl.writeFileSync(currentFile, JSON.stringify({ toolId, version: definition.version, executablePath }, null, 2), "utf8");
      } else {
        await fsp.writeFile(currentFile, JSON.stringify({ toolId, version: definition.version, executablePath }, null, 2), "utf8");
      }
      onProgress?.({ phase: "available", toolId, version: definition.version, percent: 100 });
      return { status: "available", toolId, version: definition.version, executablePath, reused: false };
    } catch (error) {
      onProgress?.({ phase: error.code === "cancelled" ? "cancelled" : "failed", toolId, version: definition.version, percent: null, error: error.message });
      throw error;
    } finally {
      await removeDirectory(fsImpl, tempRoot).catch(() => {});
    }
  }

  function status(toolId) {
    const definition = getDefinition(toolId);
    const available = existingStatus(definition);
    return available || { status: "not-installed", toolId, version: definition.version, executablePath: null, reused: false };
  }

  return { install, selectExisting, status, definitions: TOOL_DEFINITIONS };
}

async function hashFile(filePath, fsImpl = fs) {
  if (typeof fsImpl.createReadStream === "function") {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash("sha256");
      const stream = fsImpl.createReadStream(filePath);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.once("error", reject);
      stream.once("end", () => resolve(hash.digest("hex")));
    });
  }
  if (typeof fsImpl.readFileSync === "function") {
    return crypto.createHash("sha256").update(fsImpl.readFileSync(filePath)).digest("hex");
  }
  return crypto.createHash("sha256").update(await fsp.readFile(filePath)).digest("hex");
}

module.exports = {
  TOOL_DEFINITIONS,
  createToolManager,
  hashFile,
  isSafeArchiveEntry,
  normalizeArchiveEntries,
  defaultMagpieConfigPath,
  prepareMagpiePortableConfig,
  resolveInside,
};
