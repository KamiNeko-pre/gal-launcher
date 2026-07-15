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

function runningProcessIdsUnder(root) {
  return new Promise((resolve) => {
    if (process.platform !== "win32" || !isUsableProcessRoot(root)) return resolve([]);
    const normalized = path.resolve(root).replace(/'/g, "''");
    const script = `$root = '${normalized}'; if (-not $root.EndsWith('\\')) { $root = $root + '\\' }; Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) } | Select-Object -ExpandProperty ProcessId`;
    execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], { windowsHide: true, timeout: 4500, maxBuffer: 1024 * 64 }, (error, stdout) => {
      if (error) return resolve([]);
      resolve(String(stdout || "").split(/\r?\n/).map((line) => Number(line.trim())).filter(Number.isFinite));
    });
  });
}

function isPidAlive(pid) {
  return new Promise((resolve) => {
    execFile("tasklist", ["/FI", `PID eq ${pid}`, "/NH"], { windowsHide: true, timeout: 3000 }, (error, stdout) => resolve(!error && String(stdout).includes(`${pid}`)));
  });
}

function getChildPids(parentPid) {
  return new Promise((resolve) => {
    execFile("wmic", ["process", "where", `ParentProcessId=${parentPid}`, "get", "ProcessId", "/format:csv"], { windowsHide: true, timeout: 4000 }, (error, stdout) => {
      if (error) return resolve([]);
      const pids = String(stdout).split(/\r?\n/).filter(Boolean).slice(1).map((line) => Number(line.split(",").at(-1)?.trim())).filter((pid) => Number.isFinite(pid) && pid > 0);
      resolve(pids);
    });
  });
}

module.exports = { isUsableProcessRoot, monitorRootForGame, runningProcessIdsUnder, isPidAlive, getChildPids };
