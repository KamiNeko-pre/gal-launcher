const test = require("node:test");
const assert = require("node:assert/strict");

const { classifyBulkMetadataCandidates } = require("./bulk-match-policy.cjs");

const candidate = (confidence, sourceId) => ({
  source: "vndb",
  sourceId,
  confidence,
  title: `候选 ${sourceId}`
});

test("automatically applies a strong, clearly leading match", () => {
  const result = classifyBulkMetadataCandidates([
    candidate(0.91, "vn-1"),
    candidate(0.73, "vn-2")
  ]);

  assert.equal(result.kind, "apply");
  assert.equal(result.candidate.sourceId, "vn-1");
});

test("queues close high-confidence sequel-like candidates for review instead of auto-applying", () => {
  const result = classifyBulkMetadataCandidates([
    candidate(0.94, "vn-main"),
    candidate(0.89, "vn-sequel")
  ]);

  assert.equal(result.kind, "review");
  assert.deepEqual(result.candidates.map((item) => item.sourceId), ["vn-main", "vn-sequel"]);
});

test("leaves weak matches untouched", () => {
  const result = classifyBulkMetadataCandidates([
    candidate(0.64, "vn-weak")
  ]);

  assert.deepEqual(result, { kind: "unmatched", confidence: 0.64 });
});

test("keeps a single exact high-confidence candidate automatic", () => {
  const result = classifyBulkMetadataCandidates([candidate(1, "vn-exact")]);

  assert.equal(result.kind, "apply");
  assert.equal(result.candidate.sourceId, "vn-exact");
});

test("ranks candidates itself instead of trusting source ordering", () => {
  const result = classifyBulkMetadataCandidates([
    candidate(0.73, "vn-later"),
    candidate(0.91, "vn-best")
  ]);

  assert.equal(result.kind, "apply");
  assert.equal(result.candidate.sourceId, "vn-best");
});
