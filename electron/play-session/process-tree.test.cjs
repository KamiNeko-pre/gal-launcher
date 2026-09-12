const test = require("node:test");
const assert = require("node:assert/strict");
const {
  captureProcessBaseline,
  findRunningSessionPids,
  isUsableProcessRoot,
  monitorRootForGame,
  parseProcessIds,
  parseWmicChildPids,
  getChildPids
} = require("./process-tree.cjs");

test("process roots reject unsafe filesystem roots", () => {
  assert.equal(isUsableProcessRoot("C:\\"), false);
  assert.equal(isUsableProcessRoot("C:\\Games\\VN"), true);
});

test("monitor root prefers install path and falls back to working directory", () => {
  assert.equal(monitorRootForGame({ installPath: "C:\\Games\\A", workingDirectory: "C:\\Games\\B", executablePath: "C:\\Games\\B\\a.exe" }), "C:\\Games\\A");
  assert.equal(monitorRootForGame({ installPath: "", workingDirectory: "C:\\Games\\B", executablePath: "C:\\Games\\B\\a.exe" }), "C:\\Games\\B");
});

test("falls back to the install directory when a tracked launcher process exits", async () => {
  const runningPids = await findRunningSessionPids({
    trackedPids: [101],
    monitorRoot: "C:\\Games\\LibraryShepherd",
    isPidAliveImpl: async () => false,
    runningProcessIdsUnderImpl: async () => [202]
  });

  assert.deepEqual(runningPids, [202]);
});

test("keeps live tracked processes without broad directory scanning", async () => {
  let directoryScans = 0;
  const runningPids = await findRunningSessionPids({
    trackedPids: [101, 202],
    monitorRoot: "C:\\Games\\LibraryShepherd",
    isPidAliveImpl: async (pid) => pid === 202,
    runningProcessIdsUnderImpl: async () => {
      directoryScans += 1;
      return [303];
    }
  });

  assert.deepEqual(runningPids, [202]);
  assert.equal(directoryScans, 0);
});

test("empty process scan output does not create PID zero", () => {
  assert.deepEqual(parseProcessIds(""), []);
  assert.deepEqual(parseProcessIds("\r\n"), []);
  assert.deepEqual(parseProcessIds("0\r\n202\r\n"), [202]);
});

test("parses WMIC child output and falls back to PowerShell when WMIC is unavailable", async () => {
  assert.deepEqual(parseWmicChildPids("Node,ProcessId\r\nHOST,202\r\n"), [202]);
  const calls = [];
  const pids = await getChildPids(101, (command, args, _options, callback) => {
    calls.push(command);
    if (command === "wmic") callback(new Error("wmic missing"), "");
    else callback(null, "303\r\n");
  });
  assert.deepEqual(pids, [303]);
  assert.deepEqual(calls, ["wmic", "powershell.exe"]);
});

test("process scan failures remain unknown instead of looking stopped", async () => {
  const runningPids = await findRunningSessionPids({
    trackedPids: [101],
    monitorRoot: "C:\\Games\\LibraryShepherd",
    isPidAliveImpl: async () => false,
    runningProcessIdsUnderImpl: async () => null
  });

  assert.equal(runningPids, null);
});

test("directory fallback ignores processes that existed before launch", async () => {
  const runningPids = await findRunningSessionPids({
    trackedPids: [101],
    baselinePids: [202],
    monitorRoot: "C:\\Games\\LibraryShepherd",
    isPidAliveImpl: async () => false,
    runningProcessIdsUnderImpl: async () => [202, 303]
  });

  assert.deepEqual(runningPids, [303]);
});

test("baseline capture retries a transient process scan failure", async () => {
  const scans = [null, [202]];
  const pids = await captureProcessBaseline("C:\\Games\\LibraryShepherd", async () => scans.shift());
  assert.deepEqual(pids, [202]);
});

test("baseline capture rejects when the process table remains unavailable", async () => {
  await assert.rejects(
    captureProcessBaseline("C:\\Games\\LibraryShepherd", async () => null),
    /无法读取进程列表/
  );
});
