const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  prepareLocaleEmulator,
  launchLocaleEmulator,
  readPeMachine,
  validateLocaleEmulator,
} = require("./locale-emulator.cjs");

const TOOL_ROOT = path.join(process.cwd(), "test-fixtures", "locale-emulator");
const TOOL_PATH = path.join(TOOL_ROOT, "LEProc.exe");
const TARGET_PATH = path.join(TOOL_ROOT, "game.exe");

function makePe(machine) {
  const buffer = Buffer.alloc(128);
  buffer.writeUInt16LE(0x5a4d, 0);
  buffer.writeUInt32LE(0x40, 0x3c);
  buffer.writeUInt32LE(0x00004550, 0x40);
  buffer.writeUInt16LE(machine, 0x44);
  return buffer;
}

function makeFs({ files = [], contents = new Map() } = {}) {
  const normalizedFiles = new Set(files.map((filePath) => path.normalize(filePath)));
  const normalizedContents = new Map(
    [...contents].map(([filePath, value]) => [path.normalize(filePath), value])
  );
  return {
    existsSync(filePath) {
      return normalizedFiles.has(path.normalize(filePath));
    },
    readFileSync(filePath) {
      const value = normalizedContents.get(path.normalize(filePath));
      if (value === undefined) {
        const error = new Error(`missing fixture: ${filePath}`);
        error.code = "ENOENT";
        throw error;
      }
      return value;
    },
  };
}

function toolFiles({ missing = [] } = {}) {
  const names = [
    "LEProc.exe",
    "LECommonLibrary.dll",
    "LoaderDll.dll",
    "LocaleEmulator.dll",
  ];
  const missingSet = new Set(missing);
  return names
    .filter((name) => !missingSet.has(name))
    .map((name) => path.join(TOOL_ROOT, name));
}

function validFs(machine = 0x014c, options = {}) {
  return makeFs({
    files: [...toolFiles(options), TARGET_PATH],
    contents: new Map([[TARGET_PATH, makePe(machine)]]),
  });
}

test("disabled or absent localeEmulator bypasses all locale checks", () => {
  const fsImpl = {
    existsSync() {
      throw new Error("disabled mode must not inspect the filesystem");
    },
    readFileSync() {
      throw new Error("disabled mode must not read the target");
    },
  };

  assert.equal(
    prepareLocaleEmulator(
      {
        executablePath: TARGET_PATH,
        localeEmulator: { enabled: false, executablePath: TOOL_PATH },
      },
      { fsImpl }
    ),
    null
  );
  assert.equal(
    prepareLocaleEmulator({ executablePath: TARGET_PATH }, { fsImpl }),
    null
  );
});

test("validates the files shipped by the official Locale Emulator archive", () => {
  const incomplete = validateLocaleEmulator(TOOL_PATH, { fsImpl: validFs(0x014c, { missing: ["LECommonLibrary.dll"] }) });
  assert.equal(incomplete.ok, false);
  assert.deepEqual(incomplete.missing, ["LECommonLibrary.dll"]);
  const result = validateLocaleEmulator(TOOL_PATH, { fsImpl: validFs() });

  assert.deepEqual(result, {
    ok: true,
    toolPath: path.resolve(TOOL_PATH),
    missing: [],
  });

  const withoutLoader = validateLocaleEmulator(TOOL_PATH, {
    fsImpl: validFs(0x014c, { missing: ["LoaderDll.dll"] }),
  });
  assert.equal(withoutLoader.ok, false);
  assert.equal(withoutLoader.code, "missing-tool-dependency");
  assert.deepEqual(withoutLoader.missing, ["LoaderDll.dll"]);

  const officialArchiveFileSet = validateLocaleEmulator(TOOL_PATH, {
    fsImpl: validFs(),
  });
  assert.equal(officialArchiveFileSet.ok, true);
});

test("rejects an invalid LE path and a missing tool", () => {
  const fsImpl = validFs();

  assert.equal(
    validateLocaleEmulator(path.join(TOOL_ROOT, "other.exe"), { fsImpl }).code,
    "invalid-tool-path"
  );
  assert.equal(
    validateLocaleEmulator(path.join(TOOL_ROOT, "missing", "LEProc.exe"), { fsImpl }).code,
    "tool-not-found"
  );
  assert.equal(
    validateLocaleEmulator("", { fsImpl }).code,
    "missing-tool-path"
  );
});

test("reads the PE machine without starting the target", () => {
  const fsImpl = validFs();
  assert.deepEqual(readPeMachine(TARGET_PATH, { fsImpl }), {
    ok: true,
    machine: 0x014c,
    bits: 32,
  });
});

test("rejects x64, ARM64, unknown, and malformed PE targets", () => {
  for (const machine of [0x8664, 0xaa64, 0x1234]) {
    const result = readPeMachine(TARGET_PATH, {
      fsImpl: validFs(machine),
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "unsupported-architecture");
    assert.equal(result.machine, machine);
  }

  const malformed = makeFs({
    files: [...toolFiles(), TARGET_PATH],
    contents: new Map([[TARGET_PATH, Buffer.from("not a PE")]]),
  });
  const result = readPeMachine(TARGET_PATH, { fsImpl: malformed });
  assert.equal(result.ok, false);
  assert.equal(result.code, "invalid-pe");
});

test("prepares an x86 target and preserves an explicitly configured cwd", () => {
  const cwd = path.join(TOOL_ROOT, "working directory", "keep-as-given");
  const plan = prepareLocaleEmulator(
    {
      executablePath: TARGET_PATH,
      workingDirectory: cwd,
      localeEmulator: { enabled: true, executablePath: TOOL_PATH },
    },
    { fsImpl: validFs() }
  );

  assert.deepEqual(plan, {
    toolPath: path.resolve(TOOL_PATH),
    targetPath: path.resolve(TARGET_PATH),
    cwd,
    args: [path.resolve(TARGET_PATH)],
    machine: 0x014c,
    bits: 32,
  });
});

test("rejects enabled non-executable targets before launching", () => {
  assert.throws(
    () =>
      prepareLocaleEmulator(
        {
          executablePath: path.join(TOOL_ROOT, "game.cmd"),
          localeEmulator: { enabled: true, executablePath: TOOL_PATH },
        },
        { fsImpl: validFs() }
      ),
    (error) => error.code === "unsupported-target-type"
  );
});

test("launches LE with an argv array, shell:false, and the prepared cwd", () => {
  const cwd = path.join(TOOL_ROOT, "working directory");
  const plan = prepareLocaleEmulator(
    {
      executablePath: TARGET_PATH,
      workingDirectory: cwd,
      localeEmulator: { enabled: true, executablePath: TOOL_PATH },
    },
    { fsImpl: validFs() }
  );
  const child = { pid: 31415 };
  let call;

  const returned = launchLocaleEmulator(plan, {
    spawnImpl(...args) {
      call = args;
      return child;
    },
  });

  assert.equal(returned, child);
  assert.equal(call[0], plan.toolPath);
  assert.deepEqual(call[1], [plan.targetPath]);
  assert.equal(Array.isArray(call[1]), true);
  assert.deepEqual(call[2], {
    cwd,
    shell: false,
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
});
