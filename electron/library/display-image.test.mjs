import test from "node:test";
import assert from "node:assert/strict";
import { selectDisplayImage } from "../../src/images/imageSelection.ts";

test("uses the selected background before falling back to the cover", () => {
  const imageCache = {
    "cover.jpg": "cover-data",
    "background.jpg": "background-data"
  };

  assert.equal(selectDisplayImage(imageCache, "background.jpg", "cover.jpg"), "background-data");
});
