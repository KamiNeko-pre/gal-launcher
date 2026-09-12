const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { getAppIconPath } = require("./icon-path.cjs");

test("uses the project icon during development", () => {
  assert.equal(
    getAppIconPath({
      isPackaged: false,
      resourcesPath: "C:\\runtime\\resources",
      projectRoot: "D:\\script"
    }),
    path.join("D:\\script", "build", "icon.ico")
  );
});

test("uses the copied runtime icon in the packaged app", () => {
  assert.equal(
    getAppIconPath({
      isPackaged: true,
      resourcesPath: "D:\\script\\release\\win-unpacked\\resources",
      projectRoot: "D:\\script"
    }),
    path.join("D:\\script\\release\\win-unpacked\\resources", "icon.ico")
  );
});
