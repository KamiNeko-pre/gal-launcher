const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { archiveGameImages } = require("./asset-archive.cjs");

test("archives external cover and background images into launcher storage", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gal-launcher-asset-test-"));
  try {
    const original = path.join(root, "installed-game", "cover.png");
    fs.mkdirSync(path.dirname(original), { recursive: true });
    fs.writeFileSync(original, "image-data");
    const [game] = archiveGameImages([{ id: "g-1", coverPath: original, backgroundPath: original }], path.join(root, "app-data"));
    assert.match(game.coverPath, /library[\\/]assets[\\/]g-1-cover\.png$/);
    assert.equal(game.backgroundPath, game.coverPath);
    assert.equal(fs.readFileSync(game.coverPath, "utf8"), "image-data");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("keeps missing external paths so the user can see that an asset is unavailable", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gal-launcher-asset-test-"));
  try {
    const missing = path.join(root, "gone.png");
    const [game] = archiveGameImages([{ id: "g-1", coverPath: missing, backgroundPath: "" }], path.join(root, "app-data"));
    assert.equal(game.coverPath, missing);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
