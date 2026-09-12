const test = require("node:test");
const assert = require("node:assert/strict");

const { summarizeCoverSearch } = require("./cover-search-status.cjs");

test("reports an external failure instead of a no-match when every attempted request failed", () => {
  const summary = summarizeCoverSearch({
    candidateCount: 0,
    attempts: [
      { ok: false, error: new Error("timeout") },
      { ok: false, httpStatus: 502 }
    ]
  });

  assert.equal(summary.status, "network_error");
});

test("keeps a genuine no-match distinct when at least one source request completed", () => {
  const summary = summarizeCoverSearch({
    candidateCount: 0,
    attempts: [
      { ok: true, httpStatus: 200 },
      { ok: false, error: new Error("timeout") }
    ]
  });

  assert.equal(summary.status, "no_match");
});

test("does not turn usable candidates into an error because an unrelated source failed", () => {
  const summary = summarizeCoverSearch({
    candidateCount: 2,
    attempts: [{ ok: false, error: new Error("timeout") }]
  });

  assert.equal(summary.status, "candidates");
});
