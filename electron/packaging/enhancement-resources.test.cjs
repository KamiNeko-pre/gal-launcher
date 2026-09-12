const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "../..");

test("packaged Locale Emulator deployment uses a real PowerShell resource outside app.asar", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
  const resource = packageJson.build.extraResources.find(item => item.to === "prepare-locale-runtime.ps1");
  assert.deepEqual(resource, {
    from: "electron/integrations/prepare-locale-runtime.ps1",
    to: "prepare-locale-runtime.ps1",
  });

  const mainSource = fs.readFileSync(path.join(projectRoot, "electron/main.cjs"), "utf8");
  assert.match(mainSource, /prepareLocaleRuntimeScriptPath:\s*app\.isPackaged\s*\?\s*path\.join\(process\.resourcesPath,\s*["']prepare-locale-runtime\.ps1["']\)/);

  const managerSource = fs.readFileSync(path.join(projectRoot, "electron/integrations/tool-manager.cjs"), "utf8");
  assert.match(managerSource, /options\.prepareLocaleRuntimeScriptPath\s*\|\|/);
});
