const path = require("node:path");
const { execFile } = require("node:child_process");

function isUsableProcessRoot(root) {
  if (!root) return false;
  const resolved = path.resolve(root);
  const parsed = path.parse(resolved);
  return resolved.length > parsed.root.length + 4;
}

function monitorRootForGame(game) {
  return game.installPath || game.workingDirectory || path.dirname(game.executablePath || "");
}

function parseProcessIds(stdout) {
  return [...new Set(
    String(stdout || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map(Number)
      .filter((pid) => Number.isFinite(pid) && pid > 0)
  )];
}

function runningProcessIdsUnder(root) {
  return new Promise((resolve) => {
    if (process.platform !== "win32" || !isUsableProcessRoot(root)) return resolve([]);
    const normalized = path.resolve(root).replace(/'/g, "''");
    const script = `$root = '${normalized}'; if (-not $root.EndsWith('\\')) { $root = $root + '\\' }; Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) } | Select-Object -ExpandProperty ProcessId`;
    execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], { windowsHide: true, timeout: 4500, maxBuffer: 1024 * 64 }, (error, stdout) => {
      if (error) return resolve(null);
      resolve(parseProcessIds(stdout));
    });
  });
}

async function captureProcessBaseline(root, runningProcessIdsUnderImpl = runningProcessIdsUnder) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await runningProcessIdsUnderImpl(root);
    if (result !== null) {
      return [...new Set((Array.isArray(result) ? result : [])
        .map(Number)
        .filter((pid) => Number.isFinite(pid) && pid > 0))];
    }
  }
  throw new Error("无法读取进程列表，暂时无法可靠统计游玩时长");
}

function isPidAlive(pid) {
  return new Promise((resolve) => {
    execFile("tasklist", ["/FI", `PID eq ${pid}`, "/NH"], { windowsHide: true, timeout: 3000 }, (error, stdout) => resolve(!error && String(stdout).includes(`${pid}`)));
  });
}

function parseWmicChildPids(stdout) {
  return [...new Set(String(stdout || "")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(1)
    .map((line) => Number(line.split(",").at(-1)?.trim()))
    .filter((pid) => Number.isFinite(pid) && pid > 0))];
}

function getChildPids(parentPid, execFileImpl = execFile) {
  return new Promise((resolve) => {
    const normalizedParentPid = Number(parentPid);
    if (!Number.isFinite(normalizedParentPid) || normalizedParentPid <= 0) return resolve([]);
    const finishWithPowerShell = () => {
      const script = `Get-CimInstance Win32_Process -Filter \"ParentProcessId = ${normalizedParentPid}\" | Select-Object -ExpandProperty ProcessId`;
      execFileImpl("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 4000 }, (error, stdout) => {
        resolve(error ? [] : parseProcessIds(stdout));
      });
    };
    execFileImpl("wmic", ["process", "where", `ParentProcessId=${normalizedParentPid}`, "get", "ProcessId", "/format:csv"], { windowsHide: true, timeout: 4000 }, (error, stdout) => {
      const pids = parseWmicChildPids(stdout);
      if (!error && pids.length) return resolve(pids);
      finishWithPowerShell();
    });
  });
}

async function findRunningSessionPids({
  trackedPids,
  baselinePids = [],
  monitorRoot,
  isPidAliveImpl = isPidAlive,
  runningProcessIdsUnderImpl = runningProcessIdsUnder
}) {
  const tracked = [...new Set((Array.isArray(trackedPids) ? trackedPids : [])
    .map(Number)
    .filter((pid) => Number.isFinite(pid) && pid > 0))];
  const trackedStates = await Promise.all(tracked.map(async (pid) => {
    try {
      return (await isPidAliveImpl(pid)) ? pid : null;
    } catch {
      return null;
    }
  }));
  const liveTracked = trackedStates.filter((pid) => pid !== null);
  if (liveTracked.length > 0) return liveTracked;

  try {
    const discovered = await runningProcessIdsUnderImpl(monitorRoot);
    if (discovered === null) return null;
    const baseline = new Set(
      (Array.isArray(baselinePids) ? baselinePids : [])
        .map(Number)
        .filter((pid) => Number.isFinite(pid) && pid > 0)
    );
    return [...new Set((Array.isArray(discovered) ? discovered : [])
      .map(Number)
      .filter((pid) => Number.isFinite(pid) && pid > 0 && !baseline.has(pid)))];
  } catch {
    return null;
  }
}

module.exports = {
  captureProcessBaseline,
  findRunningSessionPids,
  isUsableProcessRoot,
  monitorRootForGame,
  parseProcessIds,
  parseWmicChildPids,
  runningProcessIdsUnder,
  isPidAlive,
  getChildPids
};
