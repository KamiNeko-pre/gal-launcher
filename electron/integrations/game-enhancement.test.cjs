const test = require("node:test");
const assert = require("node:assert/strict");
const { isGameEnhancementEnabled, setGameEnhancement } = require("./game-enhancement.cjs");

const game = {
  id: "game-1",
  localeEmulator: { enabled: false, executablePath: "C:\\Tools\\old-LEProc.exe" },
  magpieEnabled: false,
};

test("enabling Magpie is independent from the game's locale setting", () => {
  const next = setGameEnhancement(game, "magpie", true);
  assert.equal(isGameEnhancementEnabled(next, "magpie"), true);
  assert.equal(isGameEnhancementEnabled(next, "localeEmulator"), false);
  assert.equal(next.localeEmulator.executablePath, game.localeEmulator.executablePath);
  assert.equal(game.magpieEnabled, false);
});

test("enabling Locale Emulator records the validated executable without changing Magpie", () => {
  const next = setGameEnhancement(game, "localeEmulator", true, "D:\\Tools\\LEProc.exe");
  assert.equal(isGameEnhancementEnabled(next, "localeEmulator"), true);
  assert.equal(next.localeEmulator.executablePath, "D:\\Tools\\LEProc.exe");
  assert.equal(isGameEnhancementEnabled(next, "magpie"), false);
});

test("disabling an enhancement preserves its reusable tool path", () => {
  const enabled = setGameEnhancement(game, "localeEmulator", true, "D:\\Tools\\LEProc.exe");
  const next = setGameEnhancement(enabled, "localeEmulator", false);
  assert.equal(isGameEnhancementEnabled(next, "localeEmulator"), false);
  assert.equal(next.localeEmulator.executablePath, "D:\\Tools\\LEProc.exe");
});
