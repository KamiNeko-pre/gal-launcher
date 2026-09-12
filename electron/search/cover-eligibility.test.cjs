const test = require("node:test");
const assert = require("node:assert/strict");
const { isLandscapeCoverDimensions } = require("./cover-eligibility.cjs");

test("horizontal-cover candidates exclude portrait and square assets", () => {
  assert.equal(isLandscapeCoverDimensions({ width: 1920, height: 1080, ratio: 1920 / 1080 }), true);
  assert.equal(isLandscapeCoverDimensions({ width: 1918, height: 1153, ratio: 1918 / 1153 }), true);
  assert.equal(isLandscapeCoverDimensions({ width: 708, height: 1000, ratio: 0.708 }), false);
  assert.equal(isLandscapeCoverDimensions({ width: 720, height: 720, ratio: 1 }), false);
});
