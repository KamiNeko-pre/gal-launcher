const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  MAGPIE_PRESETS,
  applyMagpiePreset,
  resolveMagpieConfigPath,
} = require("./magpie-presets.cjs");

test("exposes four Galgame presets copied from the owner's preset collection", () => {
  assert.deepEqual(MAGPIE_PRESETS.map(({ id, label }) => ({ id, label })), [
    { id: "light", label: "轻量" },
    { id: "balanced", label: "均衡" },
    { id: "quality", label: "高清" },
    { id: "fourK", label: "4K" },
  ]);
  assert.equal(MAGPIE_PRESETS.find((item) => item.id === "balanced").effects[0].name, "Anime4K\\Anime4K_Upscale_S");
  assert.equal(MAGPIE_PRESETS.find((item) => item.id === "fourK").effects.length, 4);
});

test("uses portable config beside Magpie when it exists, otherwise LocalAppData", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gal-magpie-path-"));
  const exe = path.join(root, "Magpie.exe");
  const localAppData = path.join(root, "local");
  fs.writeFileSync(exe, "");
  assert.equal(resolveMagpieConfigPath(exe, { localAppData }), path.join(localAppData, "Magpie", "config", "v4", "config.json"));
  fs.mkdirSync(path.join(root, "config"));
  fs.writeFileSync(path.join(root, "config", "config.json"), "{}");
  assert.equal(resolveMagpieConfigPath(exe, { localAppData }), path.join(root, "config", "config.json"));
  fs.rmSync(root, { recursive: true, force: true });
});

test("upserts launcher presets, selects the requested default profile, and is idempotent", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gal-magpie-config-"));
  const exe = path.join(root, "Magpie.exe");
  const configDir = path.join(root, "config");
  const configPath = path.join(configDir, "config.json");
  fs.mkdirSync(configDir);
  fs.writeFileSync(exe, "");
  fs.writeFileSync(configPath, JSON.stringify({
    shortcuts: { scale: 2370 },
    scalingModes: [{ name: "User FSR", effects: [{ name: "FSR\\FSR_EASU" }] }],
    profiles: [{ scalingMode: 0, captureMethod: 2 }],
  }));

  const first = applyMagpiePreset(exe, "quality");
  const configured = JSON.parse(fs.readFileSync(configPath, "utf8"));
  assert.equal(first.changed, true);
  assert.equal(configured.shortcuts.scale, 2370);
  assert.equal(configured.scalingModes[0].name, "User FSR");
  assert.equal(configured.scalingModes.filter((item) => item.name.startsWith("Gal Launcher · ")).length, 4);
  assert.equal(configured.scalingModes[configured.profiles[0].scalingMode].name, "Gal Launcher · 高清");
  assert.equal(configured.profiles[0].captureMethod, 2);

  const second = applyMagpiePreset(exe, "quality");
  assert.equal(second.changed, false);
  assert.equal(JSON.parse(fs.readFileSync(configPath, "utf8")).scalingModes.filter((item) => item.name === "Gal Launcher · 高清").length, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test("rejects unknown presets without touching the config", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gal-magpie-invalid-"));
  const exe = path.join(root, "Magpie.exe");
  const configDir = path.join(root, "config");
  const configPath = path.join(configDir, "config.json");
  fs.mkdirSync(configDir);
  fs.writeFileSync(exe, "");
  fs.writeFileSync(configPath, "{}");
  assert.throws(() => applyMagpiePreset(exe, "ultra-secret"), (error) => error.code === "unknown-magpie-preset");
  assert.equal(fs.readFileSync(configPath, "utf8"), "{}");
  fs.rmSync(root, { recursive: true, force: true });
});
