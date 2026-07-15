const test = require("node:test");
const assert = require("node:assert/strict");
const { validateMagpiePath, ensureMagpieRunning, launchWithIntegration, prepareMagpieScaling } = require("./magpie.cjs");

const fakeFs = (exists) => ({ existsSync: () => exists });

test("validates an explicit Magpie.exe path", () => {
  assert.equal(validateMagpiePath("E:\\magpie\\Magpie.exe", fakeFs(true)).ok, true);
  assert.equal(validateMagpiePath("", fakeFs(true)).code, "missing");
  assert.equal(validateMagpiePath("E:\\magpie\\other.exe", fakeFs(true)).code, "filename");
  assert.equal(validateMagpiePath("E:\\magpie\\Magpie.exe", fakeFs(false)).code, "missing_file");
});

test("starts Magpie only when it is not already running", async () => {
  const calls = [];
  const spawnImpl = (...args) => { calls.push(args); return { unref() {} }; };
  const first = await ensureMagpieRunning("E:\\magpie\\Magpie.exe", {
    isRunning: async () => false,
    spawnImpl,
    fsImpl: fakeFs(true)
  });
  assert.equal(first.started, true);
  assert.equal(calls.length, 1);
  const second = await ensureMagpieRunning("E:\\magpie\\Magpie.exe", {
    isRunning: async () => true,
    spawnImpl,
    fsImpl: fakeFs(true)
  });
  assert.equal(second.started, false);
  assert.equal(calls.length, 1);
});

test("disabled integration does not touch the process table", async () => {
  let called = false;
  const result = await launchWithIntegration({}, { magpieEnabled: false }, { isRunning: async () => { called = true; } });
  assert.equal(result.integration, "disabled");
  assert.equal(called, false);
});

test("scaling requires a windowed game and a configured shortcut", async () => {
  await assert.rejects(
    prepareMagpieScaling(1, { magpieEnabled: true }, { waitForWindow: async () => ({ hasWindow: true, windowed: true }) }),
    (error) => error.code === "shortcut_missing"
  );
  await assert.rejects(
    prepareMagpieScaling(1, { magpieEnabled: true, magpieShortcut: "Alt+Shift+Q" }, { waitForWindow: async () => ({ hasWindow: true, windowed: false }) }),
    (error) => error.code === "window_mode_required"
  );
});

test("scaling sends the configured shortcut only after window validation", async () => {
  const calls = [];
  const result = await prepareMagpieScaling(42, { magpieEnabled: true, magpieShortcut: "Ctrl+Shift+F9" }, {
    waitForWindow: async (pid) => ({ hasWindow: pid === 42, windowed: true }),
    sendShortcut: async (...args) => calls.push(args)
  });
  assert.equal(result.windowed, true);
  assert.deepEqual(calls, [["Ctrl+Shift+F9", 42]]);
});
