const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  TOOL_DEFINITIONS,
  createToolManager,
  normalizeArchiveEntries,
  prepareMagpiePortableConfig,
} = require("./tool-manager.cjs");

test("pins the official versions, URLs, hashes, and runtime entry points", () => {
  assert.equal(TOOL_DEFINITIONS.localeEmulator.version, "2.5.0.1");
  assert.match(TOOL_DEFINITIONS.localeEmulator.downloadUrl, /github\.com\/xupefei\/Locale-Emulator\/releases/);
  assert.equal(TOOL_DEFINITIONS.localeEmulator.executable, "LEProc.exe");
  assert.deepEqual(TOOL_DEFINITIONS.localeEmulator.requiredFiles, [
    "LEProc.exe",
    "LEInstaller.exe",
    "LoaderDll.dll",
    "LocaleEmulator.dll",
  ]);
  assert.equal(TOOL_DEFINITIONS.magpie.version, "0.12.1");
  assert.match(TOOL_DEFINITIONS.magpie.downloadUrl, /github\.com\/Blinue\/Magpie\/releases/);
  assert.equal(TOOL_DEFINITIONS.magpie.executable, "Magpie.exe");
  for (const definition of Object.values(TOOL_DEFINITIONS)) {
    assert.match(definition.sha256, /^[a-f0-9]{64}$/);
  }
});

test("returns an existing verified installation without downloading again", async () => {
  const calls = [];
  const manager = createToolManager({
    rootPath: "C:/user-data/Gal Launcher/tools",
    fsImpl: {
      existsSync(filePath) {
        return filePath.replaceAll("\\", "/").endsWith("/2.5.0.1/LEProc.exe");
      },
    },
    downloadImpl: async () => calls.push("download"),
    validateImpl: (toolId, executablePath) => ({ ok: true, toolId, executablePath }),
  });

  const result = await manager.install("localeEmulator");

  assert.equal(result.status, "available");
  assert.equal(result.reused, true);
  assert.equal(calls.length, 0);
  assert.match(result.executablePath, /locale-emulator[\\/]2\.5\.0\.1[\\/]LEProc\.exe$/);
});

test("rejects a zip entry that escapes the isolated deployment directory", async () => {
  const manager = createToolManager({
    rootPath: "C:/user-data/Gal Launcher/tools",
    fsImpl: {
      existsSync: () => false,
    },
    downloadImpl: async () => {},
    listArchiveImpl: async () => ["../outside.exe", "Magpie.exe"],
    extractImpl: async () => {
      throw new Error("must not extract an unsafe archive");
    },
  });

  await assert.rejects(
    manager.install("magpie"),
    (error) => error.code === "archive-path-traversal"
  );
});

test("rejects traversal hidden in a directory entry before extraction", async () => {
  const manager = createToolManager({
    rootPath: "C:/user-data/Gal Launcher/tools",
    fsImpl: { existsSync: () => false },
    downloadImpl: async () => {},
    listArchiveImpl: async () => ["../outside/", "Magpie.exe"],
    extractImpl: async () => { throw new Error("must not extract an unsafe archive"); },
  });

  await assert.rejects(manager.install("magpie"), (error) => error.code === "archive-path-traversal");
});

test("accepts ordinary directory entries from the official archive", () => {
  assert.deepEqual(
    normalizeArchiveEntries(["effects/", "effects/shaders/", "Magpie.exe"]),
    ["Magpie.exe"]
  );
});

test("copies the existing Magpie preset without changing user shortcuts", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gal-launcher-magpie-test-"));
  const source = path.join(root, "global-config.json");
  const staging = path.join(root, "payload");
  fs.writeFileSync(source, JSON.stringify({ shortcuts: { scale: 0x0679 }, scalingModes: [{ name: "A4K 轻量化" }], profiles: [{ scalingMode: 0 }] }), "utf8");
  try {
    const configPath = await prepareMagpiePortableConfig(staging, { magpieConfigPath: source }, fs);
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.equal(config.scalingModes[0].name, "A4K 轻量化");
    assert.equal(config.shortcuts.scale, 0x0679);
    assert.equal(path.basename(path.dirname(configPath)), "config");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
