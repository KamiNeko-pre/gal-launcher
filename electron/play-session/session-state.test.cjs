const test = require("node:test");
const assert = require("node:assert/strict");
const {
  clearSessionIfCurrent,
  findActiveSessionForGame,
  freezeSessionCompletion,
  markSessionStarted,
  mergeAuthoritativePlayState,
  persistCompletedSession,
  persistStartedSession,
  releaseGameLaunch,
  reserveGameLaunch
} = require("./session-state.cjs");

test("marks a play session immediately and increments the launch count", () => {
  const games = [{
    id: "library-shepherd",
    playCount: 6,
    currentSessionId: null,
    currentSessionStartedAt: null,
    lastPlayedAt: null
  }];

  const changed = markSessionStarted(games, {
    gameId: "library-shepherd",
    sessionId: "session-7",
    startedAt: "2026-07-26T01:00:00.000Z"
  });

  assert.equal(changed, true);
  assert.equal(games[0].playCount, 7);
  assert.equal(games[0].currentSessionId, "session-7");
  assert.equal(games[0].currentSessionStartedAt, "2026-07-26T01:00:00.000Z");
  assert.equal(games[0].lastPlayedAt, "2026-07-26T01:00:00.000Z");
});

test("marking the same session again is idempotent", () => {
  const games = [{
    id: "library-shepherd",
    playCount: 7,
    currentSessionId: "session-7",
    currentSessionStartedAt: "2026-07-26T01:00:00.000Z",
    lastPlayedAt: "2026-07-26T01:00:00.000Z"
  }];

  const changed = markSessionStarted(games, {
    gameId: "library-shepherd",
    sessionId: "session-7",
    startedAt: "2026-07-26T01:00:00.000Z"
  });

  assert.equal(changed, false);
  assert.equal(games[0].playCount, 7);
});

test("an older session cannot clear a newer active session", () => {
  const game = {
    currentSessionId: "new-session",
    currentSessionStartedAt: "2026-07-26T02:00:00.000Z"
  };

  assert.equal(clearSessionIfCurrent(game, "old-session"), false);
  assert.equal(game.currentSessionId, "new-session");
  assert.equal(clearSessionIfCurrent(game, "new-session"), true);
  assert.equal(game.currentSessionId, null);
  assert.equal(game.currentSessionStartedAt, null);
});

test("finds an existing active session for the same game", () => {
  const active = [
    { gameId: "other-game", sessionId: "session-1" },
    { gameId: "library-shepherd", sessionId: "session-2" }
  ];

  assert.equal(findActiveSessionForGame(active, "library-shepherd")?.sessionId, "session-2");
  assert.equal(findActiveSessionForGame(active, "missing-game"), null);
});

test("renderer autosave cannot overwrite authoritative play tracking", () => {
  const incoming = [{
    id: "library-shepherd",
    title: "updated title",
    playCount: 6,
    totalPlaySeconds: 100,
    currentSessionId: null,
    currentSessionStartedAt: null,
    sessions: []
  }];
  const persisted = [{
    id: "library-shepherd",
    title: "old title",
    playCount: 7,
    totalPlaySeconds: 200,
    currentSessionId: "session-7",
    currentSessionStartedAt: "2026-07-26T01:00:00.000Z",
    sessions: [{ sessionId: "session-6", durationSeconds: 100 }],
    lastPlayedAt: "2026-07-26T01:00:00.000Z"
  }];

  const merged = mergeAuthoritativePlayState(incoming, persisted);

  assert.equal(merged[0].title, "updated title");
  assert.equal(merged[0].playCount, 7);
  assert.equal(merged[0].totalPlaySeconds, 200);
  assert.equal(merged[0].currentSessionId, "session-7");
  assert.equal(merged[0].currentSessionStartedAt, "2026-07-26T01:00:00.000Z");
  assert.deepEqual(merged[0].sessions, persisted[0].sessions);
  assert.equal(merged[0].lastPlayedAt, "2026-07-26T01:00:00.000Z");
});

test("a pending launch reserves the game before asynchronous launch work", () => {
  const active = [];
  const pending = new Set();
  assert.equal(reserveGameLaunch(active, pending, "library-shepherd"), true);
  assert.equal(reserveGameLaunch(active, pending, "library-shepherd"), false);
  releaseGameLaunch(pending, "library-shepherd");
  assert.equal(reserveGameLaunch(active, pending, "library-shepherd"), true);
});

test("an active session cannot be reserved for another launch", () => {
  const active = [{ gameId: "library-shepherd", sessionId: "session-1" }];
  assert.equal(reserveGameLaunch(active, new Set(), "library-shepherd"), false);
});

test("completed session data is written before its recovery journal is removed", () => {
  const calls = [];
  persistCompletedSession({
    games: [{ id: "library-shepherd" }],
    sessionId: "session-1",
    writeLibrary: () => calls.push("library"),
    removeJournal: () => calls.push("journal")
  });
  assert.deepEqual(calls, ["library", "journal"]);
});

test("a failed library write keeps the recovery journal intact", () => {
  let journalRemoved = false;
  assert.throws(() => persistCompletedSession({
    games: [],
    sessionId: "session-1",
    writeLibrary: () => { throw new Error("disk full"); },
    removeJournal: () => { journalRemoved = true; }
  }), /disk full/);
  assert.equal(journalRemoved, false);
});

test("a journal cleanup failure does not repeat an already persisted session", () => {
  assert.doesNotThrow(() => persistCompletedSession({
    games: [],
    sessionId: "session-1",
    writeLibrary: () => {},
    removeJournal: () => { throw new Error("journal locked"); }
  }));
});

test("completion time is frozen across persistence retries", () => {
  const session = { startedMs: 1_000 };
  const first = freezeSessionCompletion(session, 11_000);
  const retry = freezeSessionCompletion(session, 71_000);
  assert.deepEqual(first, retry);
  assert.equal(retry.durationSeconds, 10);
  assert.equal(retry.endedMs, 11_000);
});

test("failed initial session persistence removes the newly created journal", () => {
  const calls = [];
  assert.throws(() => persistStartedSession({
    games: [{ id: "g1" }],
    gameId: "g1",
    sessionId: "s1",
    startedAt: "2026-01-01T00:00:00.000Z",
    startedMs: 1,
    baselinePids: [],
    hadJournal: false,
    addJournal: () => calls.push("add"),
    writeLibrary: () => { calls.push("write"); throw new Error("disk full"); },
    removeJournal: () => calls.push("remove")
  }), /disk full/);
  assert.deepEqual(calls, ["add", "write", "remove"]);
});

test("failed resumed-session persistence preserves its existing recovery journal", () => {
  let removed = false;
  assert.throws(() => persistStartedSession({
    games: [{ id: "g1" }],
    gameId: "g1",
    sessionId: "s1",
    startedAt: "2026-01-01T00:00:00.000Z",
    startedMs: 1,
    baselinePids: [20],
    hadJournal: true,
    addJournal: () => {},
    writeLibrary: () => { throw new Error("disk full"); },
    removeJournal: () => { removed = true; }
  }), /disk full/);
  assert.equal(removed, false);
});
