import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import process from "node:process";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "../..");
const profile = process.argv.includes("--profile") ? process.argv[process.argv.indexOf("--profile") + 1] : "empty";
const runs = Number(process.env.GAL_LAUNCHER_PERF_RUNS || 5);
const fixture = path.join(root, "scripts", "perf", "fixtures", profile, "games.json");
if (profile !== "current" && !existsSync(fixture)) throw new Error(`Unknown profile: ${profile}`);

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function processTreeMemory(pid) {
  const script = "$root=" + Number(pid) + "; $ids=@($root); for($i=0;$i -lt 8;$i++){ $children=Get-CimInstance Win32_Process | Where-Object { $ids -contains $_.ParentProcessId } | Select-Object -ExpandProperty ProcessId; if(-not $children){break}; $ids += $children }; $sum=0; foreach($id in ($ids|Sort-Object -Unique)){ $p=Get-Process -Id $id -ErrorAction SilentlyContinue; if($p){$sum += $p.WorkingSet64} }; @{bytes=$sum; pids=@($ids|Sort-Object -Unique)}|ConvertTo-Json -Compress";
  try { return JSON.parse((await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true })).stdout); } catch { return { bytes: 0, pids: [] }; }
}

async function runOnce(index) {
  const isolated = profile !== "current";
  const userData = isolated ? await mkdtemp(path.join(process.env.TEMP || process.cwd(), "gal-launcher-perf-")) : process.env.GAL_LAUNCHER_PERF_USER_DATA;
  if (!userData) throw new Error("--profile current requires GAL_LAUNCHER_PERF_USER_DATA");
  if (isolated) {
    await mkdir(path.join(userData, "library"), { recursive: true });
    await writeFile(path.join(userData, "library", "games.json"), await readFile(fixture));
  }
  const perfLog = path.join(userData, "startup.json");
  const electron = process.platform === "win32" ? path.join(root, "node_modules", ".bin", "electron.cmd") : path.join(root, "node_modules", ".bin", "electron");
  const child = spawn(electron, [root], { cwd: root, env: { ...process.env, GAL_LAUNCHER_PERF_USER_DATA: userData, GAL_LAUNCHER_PERF_LOG: perfLog }, windowsHide: true, shell: process.platform === "win32", stdio: "ignore" });
  const samples = [];
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    samples.push({ at: Date.now(), ...(await processTreeMemory(child.pid)) });
    if (existsSync(perfLog)) {
      try { const marks = JSON.parse(await readFile(perfLog, "utf8")); if (marks["first-paint-ack"]) break; } catch {}
    }
    await sleep(250);
  }
  let marks = {};
  try { marks = JSON.parse(await readFile(perfLog, "utf8")); } catch {}
  if (process.platform === "win32") {
    try { await execFileAsync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }); } catch {}
  } else child.kill();
  await sleep(500);
  if (isolated) await rm(userData, { recursive: true, force: true });
  const peakBytes = Math.max(0, ...samples.map((sample) => sample.bytes || 0));
  return { run: index + 1, profile, peakWorkingSetBytes: peakBytes, marks };
}

const results = [];
for (let index = 0; index < runs; index++) results.push(await runOnce(index));
const sortedPeaks = results.map((r) => r.peakWorkingSetBytes).sort((a, b) => a - b);
const medianPeakWorkingSetBytes = sortedPeaks[Math.floor(sortedPeaks.length / 2)] || 0;
const outputDir = path.join(root, "artifacts", "perf");
await mkdir(outputDir, { recursive: true });
const output = path.join(outputDir, `startup-${Date.now()}.json`);
await writeFile(output, JSON.stringify({ profile, runs: results }, null, 2));
console.log(JSON.stringify({ output, profile, runs: results.length, peakWorkingSetBytes: results.map((r) => r.peakWorkingSetBytes), medianPeakWorkingSetBytes }, null, 2));
