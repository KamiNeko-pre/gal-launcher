const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { Data, NtExecutable, NtExecutableResource, Resource } = require("resedit");
const { replaceExeIcon } = require("./embed-icon.cjs");

const projectRoot = path.join(__dirname, "..", "..");
const sourceExe = path.join(projectRoot, "node_modules", "electron", "dist", "electron.exe");
const sourceIcon = path.join(projectRoot, "build", "icon.ico");

test("post-pack embedder replaces every EXE icon group with every ICO size", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gal-launcher-icon-test-"));
  const targetExe = path.join(tempDir, "Gal Launcher.exe");

  try {
    fs.copyFileSync(sourceExe, targetExe);
    replaceExeIcon(targetExe, sourceIcon);

    const executable = NtExecutable.from(fs.readFileSync(targetExe));
    const resources = NtExecutableResource.from(executable);
    const iconGroups = Resource.IconGroupEntry.fromEntries(resources.entries);
    const expectedSizes = Data.IconFile.from(fs.readFileSync(sourceIcon)).icons.map(
      (item) => `${item.width || 256}x${item.height || 256}`,
    );

    assert.ok(iconGroups.length > 0);
    for (const group of iconGroups) {
      assert.deepEqual(
        group.icons.map((icon) => `${icon.width || 256}x${icon.height || 256}`),
        expectedSizes,
      );
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
