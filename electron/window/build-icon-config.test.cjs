const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const packageJson = require(path.join(__dirname, "..", "..", "package.json"));

test("Windows builds use the deterministic post-pack icon embedder", () => {
  assert.equal(packageJson.build.win.icon, "build/icon.ico");
  assert.equal(packageJson.build.win.signAndEditExecutable, false);
  assert.equal(packageJson.build.afterPack, "electron/packaging/embed-icon.cjs");
});
