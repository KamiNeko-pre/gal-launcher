const test = require("node:test");
const assert = require("node:assert/strict");
const { isReliableCommunityTitleMatch } = require("./community-title-match.cjs");

test("community image articles require a reliable title association", () => {
  assert.equal(isReliableCommunityTitleMatch(1), true);
  assert.equal(isReliableCommunityTitleMatch(0.86), true);
  assert.equal(isReliableCommunityTitleMatch(0.57), false);
  assert.equal(isReliableCommunityTitleMatch(0), false);
});
