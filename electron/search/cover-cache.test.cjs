const test = require("node:test");
const assert = require("node:assert/strict");
const {
  COVER_CANDIDATE_CACHE_VERSION,
  COVER_CANDIDATE_CACHE_TTL_MS,
  cachedCoverCandidates,
  hasCachedCoverCandidates
} = require("./cover-cache.cjs");

const now = Date.parse("2026-09-11T12:00:00.000Z");
const candidate = (path) => ({ path, source: "测试" });

test("reuses even one valid cover candidate during the cache window", () => {
  const result = cachedCoverCandidates({
    version: COVER_CANDIDATE_CACHE_VERSION,
    updatedAt: new Date(now - 5 * 60 * 1000).toISOString(),
    candidates: [candidate("C:/cache/only-one.jpg")]
  }, { now, existsSync: (path) => path === "C:/cache/only-one.jpg" });

  assert.deepEqual(result, [candidate("C:/cache/only-one.jpg")]);
  assert.equal(hasCachedCoverCandidates(result), true);
});

test("reuses several cached candidates but drops files no longer present", () => {
  const result = cachedCoverCandidates({
    version: COVER_CANDIDATE_CACHE_VERSION,
    updatedAt: new Date(now - 10 * 60 * 1000).toISOString(),
    candidates: [candidate("C:/cache/a.jpg"), candidate("C:/cache/missing.jpg"), candidate("C:/cache/b.jpg")]
  }, { now, existsSync: (path) => path !== "C:/cache/missing.jpg" });

  assert.deepEqual(result.map((item) => item.path), ["C:/cache/a.jpg", "C:/cache/b.jpg"]);
});

test("does not reuse stale or incompatible cache records", () => {
  const stale = cachedCoverCandidates({
    version: COVER_CANDIDATE_CACHE_VERSION,
    updatedAt: new Date(now - COVER_CANDIDATE_CACHE_TTL_MS - 1).toISOString(),
    candidates: [candidate("C:/cache/stale.jpg")]
  }, { now, existsSync: () => true });
  const incompatible = cachedCoverCandidates({
    version: COVER_CANDIDATE_CACHE_VERSION - 1,
    updatedAt: new Date(now).toISOString(),
    candidates: [candidate("C:/cache/old-format.jpg")]
  }, { now, existsSync: () => true });

  assert.deepEqual(stale, []);
  assert.deepEqual(incompatible, []);
  assert.equal(hasCachedCoverCandidates(stale), false);
});
