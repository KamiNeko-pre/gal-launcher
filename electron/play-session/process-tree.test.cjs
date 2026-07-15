const test = require("node:test");
const assert = require("node:assert/strict");
const { isUsableProcessRoot, monitorRootForGame } = require("./process-tree.cjs");

test("process roots reject unsafe filesystem roots", () => {
  assert.equal(isUsableProcessRoot("C:\\"), false);
  assert.equal(isUsableProcessRoot("C:\\Games\\VN"), true);
});

test("monitor root prefers install path and falls back to working directory", () => {
  assert.equal(monitorRootForGame({ installPath: "C:\\Games\\A", workingDirectory: "C:\\Games\\B", executablePath: "C:\\Games\\B\\a.exe" }), "C:\\Games\\A");
  assert.equal(monitorRootForGame({ installPath: "", workingDirectory: "C:\\Games\\B", executablePath: "C:\\Games\\B\\a.exe" }), "C:\\Games\\B");
});
