const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const LE_TOOL_NAME = "LEProc.exe";
const X86_MACHINE = 0x014c;
const REQUIRED_RUNTIME_FILES = [
  "LEProc.exe",
  "LECommonLibrary.dll",
  "LoaderDll.dll",
  "LocaleEmulator.dll",
];

function getFs(options) {
  return options && options.fsImpl ? options.fsImpl : fs;
}

function failure(code, message, extra = {}) {
  return { ok: false, code, message, ...extra };
}

function resultError(result) {
  const error = new Error(result.message || result.code);
  error.code = result.code;
  for (const key of ["missing", "machine", "bits"]) {
    if (result[key] !== undefined) {
      error[key] = result[key];
    }
  }
  return error;
}

function resolvePath(value) {
  return path.resolve(value);
}

function checkExists(fsImpl, filePath) {
  if (!fsImpl || typeof fsImpl.existsSync !== "function") {
    return failure("filesystem-unavailable", "The injected filesystem must provide existsSync");
  }
  try {
    return { ok: true, exists: Boolean(fsImpl.existsSync(filePath)) };
  } catch (error) {
    return failure("filesystem-error", `Unable to inspect ${filePath}: ${error.message}`);
  }
}

function validateLocaleEmulator(executablePath, options = {}) {
  if (typeof executablePath !== "string" || executablePath.trim() === "") {
    return failure("missing-tool-path", "Locale Emulator executablePath is required");
  }

  let toolPath;
  try {
    toolPath = resolvePath(executablePath);
  } catch (error) {
    return failure("invalid-tool-path", `Invalid Locale Emulator path: ${error.message}`);
  }

  if (path.basename(toolPath).toLowerCase() !== LE_TOOL_NAME.toLowerCase()) {
    return failure("invalid-tool-path", `Locale Emulator path must point to ${LE_TOOL_NAME}`);
  }

  const fsImpl = getFs(options);
  const toolStatus = checkExists(fsImpl, toolPath);
  if (!toolStatus.ok) {
    return toolStatus;
  }
  if (!toolStatus.exists) {
    return failure("tool-not-found", `Locale Emulator was not found at ${toolPath}`);
  }

  const toolDirectory = path.dirname(toolPath);
  const missing = [];
  for (const fileName of REQUIRED_RUNTIME_FILES) {
    const dependencyStatus = checkExists(fsImpl, path.join(toolDirectory, fileName));
    if (!dependencyStatus.ok) {
      return dependencyStatus;
    }
    if (!dependencyStatus.exists) {
      missing.push(fileName);
    }
  }

  if (missing.length > 0) {
    return failure(
      "missing-tool-dependency",
      `Locale Emulator is missing required runtime files: ${missing.join(", ")}.`,
      { missing }
    );
  }

  return { ok: true, toolPath, missing: [] };
}

function invalidPe(message) {
  return failure("invalid-pe", message);
}

function readPeMachine(targetPath, options = {}) {
  if (typeof targetPath !== "string" || targetPath.trim() === "") {
    return failure("target-path-missing", "Game executablePath is required");
  }

  let resolvedTargetPath;
  try {
    resolvedTargetPath = resolvePath(targetPath);
  } catch (error) {
    return failure("target-not-readable", `Invalid game executable path: ${error.message}`);
  }

  const fsImpl = getFs(options);
  if (!fsImpl || typeof fsImpl.readFileSync !== "function") {
    return failure("filesystem-unavailable", "The injected filesystem must provide readFileSync");
  }

  let value;
  try {
    value = fsImpl.readFileSync(resolvedTargetPath);
  } catch (error) {
    return failure("target-not-readable", `Unable to read game executable: ${error.message}`);
  }

  const buffer = Buffer.isBuffer(value)
    ? value
    : value instanceof Uint8Array
      ? Buffer.from(value)
      : null;
  if (!buffer) {
    return invalidPe("Game executable was not returned as binary data");
  }

  if (buffer.length < 64 || buffer.readUInt16LE(0) !== 0x5a4d) {
    return invalidPe("Game executable has no valid DOS header");
  }

  const peOffset = buffer.readUInt32LE(0x3c);
  if (peOffset < 0x40 || peOffset > buffer.length - 6) {
    return invalidPe("Game executable has an invalid PE header offset");
  }
  if (buffer.readUInt32LE(peOffset) !== 0x00004550) {
    return invalidPe("Game executable has no valid PE signature");
  }

  const machine = buffer.readUInt16LE(peOffset + 4);
  if (machine === X86_MACHINE) {
    return { ok: true, machine, bits: 32 };
  }

  const result = failure(
    "unsupported-architecture",
    `Locale Emulator supports only x86/32-bit targets; PE machine is 0x${machine.toString(16).padStart(4, "0")}`,
    { machine }
  );
  if (machine === 0x8664 || machine === 0xaa64) {
    result.bits = 64;
  }
  return result;
}

function prepareLocaleEmulator(game, options = {}) {
  const localeEmulator = game && game.localeEmulator;
  if (!localeEmulator || localeEmulator.enabled !== true) {
    return null;
  }

  if (!game || typeof game.executablePath !== "string" || game.executablePath.trim() === "") {
    throw resultError(failure("target-path-missing", "Game executablePath is required"));
  }

  const targetPath = resolvePath(game.executablePath);
  if (path.extname(targetPath).toLowerCase() !== ".exe") {
    throw resultError(
      failure("unsupported-target-type", "Locale Emulator integration requires a .exe target")
    );
  }

  const fsImpl = getFs(options);
  const toolValidation = validateLocaleEmulator(localeEmulator.executablePath, { fsImpl });
  if (!toolValidation.ok) {
    throw resultError(toolValidation);
  }

  const pe = readPeMachine(targetPath, { fsImpl });
  if (!pe.ok) {
    throw resultError(pe);
  }

  const cwd =
    typeof game.workingDirectory === "string" && game.workingDirectory.length > 0
      ? game.workingDirectory
      : path.dirname(targetPath);

  return {
    toolPath: toolValidation.toolPath,
    targetPath,
    cwd,
    args: [targetPath],
    machine: pe.machine,
    bits: pe.bits,
  };
}

function launchLocaleEmulator(prepared, options = {}) {
  if (prepared === null || prepared === undefined) {
    return null;
  }
  if (
    typeof prepared.toolPath !== "string" ||
    typeof prepared.targetPath !== "string" ||
    !Array.isArray(prepared.args) ||
    typeof prepared.cwd !== "string"
  ) {
    throw resultError(failure("invalid-prepared-plan", "Invalid Locale Emulator launch plan"));
  }

  const spawnImpl = options.spawnImpl || spawn;
  if (typeof spawnImpl !== "function") {
    throw resultError(failure("spawn-unavailable", "The injected process launcher must be a function"));
  }

  return spawnImpl(prepared.toolPath, prepared.args, {
    cwd: prepared.cwd,
    shell: false,
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
}

module.exports = {
  prepareLocaleEmulator,
  launchLocaleEmulator,
  readPeMachine,
  validateLocaleEmulator,
};
