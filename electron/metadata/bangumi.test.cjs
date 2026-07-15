const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getRatingLookupState,
  ratingPatchForFailure,
  ratingPatchForMatch,
  ratingPatchForNoMatch
} = require("./bangumi.cjs");

const now = Date.parse("2026-07-15T00:00:00.000Z");

test("legacy zero-rating cache is stale and can be retried", () => {
  assert.equal(
    getRatingLookupState({ bgmId: 0, bgmScore: 0, bgmRatingCheckedAt: "2026-07-14T00:00:00.000Z" }, now),
    "stale"
  );
});

test("network failure enters backoff without becoming a checked miss", () => {
  const patch = ratingPatchForFailure("network_error", now);
  assert.equal(patch.bgmRatingStatus, "network_error");
  assert.equal(patch.bgmRatingCheckedAt, undefined);
  assert.equal(patch.bgmScore, undefined);
  assert.equal(patch.bgmRatingNextRetryAt, "2026-07-15T00:00:30.000Z");
});

test("no-match result is checked for a bounded TTL", () => {
  const patch = ratingPatchForNoMatch(now);
  assert.equal(patch.bgmRatingStatus, "no_match");
  assert.equal(patch.bgmRatingCheckedAt, "2026-07-15T00:00:00.000Z");
  assert.equal(patch.bgmRatingNextRetryAt, "2026-07-22T00:00:00.000Z");
});

test("successful match records the matched Bangumi identity", () => {
  const patch = ratingPatchForMatch({ id: 123, score: 8.4, scoreCount: 91, rank: 42 }, now);
  assert.deepEqual(patch, {
    bgmScore: 8.4,
    bgmScoreCount: 91,
    bgmRank: 42,
    bgmId: 123,
    bgmRatingStatus: "success",
    bgmRatingCheckedAt: "2026-07-15T00:00:00.000Z",
    bgmRatingLastAttemptAt: "2026-07-15T00:00:00.000Z",
    bgmRatingNextRetryAt: undefined
  });
});
