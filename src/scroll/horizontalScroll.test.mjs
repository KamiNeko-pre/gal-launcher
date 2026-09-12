import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function loadHorizontalScrollHelper() {
  const source = readFileSync(new URL("./horizontalScroll.ts", import.meta.url), "utf8")
    .replace('type WheelInput = Pick<WheelEvent, "deltaMode" | "deltaX" | "deltaY">;', "type WheelInput = { deltaMode: number; deltaX: number; deltaY: number };")
    .replaceAll("WheelEvent.DOM_DELTA_LINE", "1")
    .replaceAll("WheelEvent.DOM_DELTA_PAGE", "2");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  new Function("exports", "module", js)(module.exports, module);
  return module.exports;
}

test("normalizes conventional line-mode wheel input", () => {
  const { horizontalScrollAmount } = loadHorizontalScrollHelper();
  assert.equal(horizontalScrollAmount({ deltaMode: 1, deltaX: 0, deltaY: 3 }, 800), 72);
});

test("keeps a trackpad's stronger horizontal gesture horizontal", () => {
  const { horizontalScrollAmount } = loadHorizontalScrollHelper();
  assert.equal(horizontalScrollAmount({ deltaMode: 0, deltaX: 56, deltaY: 14 }, 800), 56);
});

test("turns page-mode input into a viewport-relative distance", () => {
  const { horizontalScrollAmount } = loadHorizontalScrollHelper();
  assert.equal(horizontalScrollAmount({ deltaMode: 2, deltaX: 0, deltaY: -1 }, 600), -540);
});

test("derives a persistent scrollbar thumb from shelf geometry", () => {
  const { horizontalScrollbarMetrics } = loadHorizontalScrollHelper();
  assert.deepEqual(horizontalScrollbarMetrics(1200, 480, 360), {
    maxScroll: 720,
    viewportRatio: 0.4,
    scrollRatio: 0.5,
    hasOverflow: true
  });
});

test("treats a shelf without overflow as a full-width disabled thumb", () => {
  const { horizontalScrollbarMetrics } = loadHorizontalScrollHelper();
  assert.deepEqual(horizontalScrollbarMetrics(420, 480, 90), {
    maxScroll: 0,
    viewportRatio: 1,
    scrollRatio: 0,
    hasOverflow: false
  });
});

test("clamps corrupt or stale shelf offsets to scrollbar bounds", () => {
  const { horizontalScrollbarMetrics } = loadHorizontalScrollHelper();
  assert.equal(horizontalScrollbarMetrics(1000, 400, -20).scrollRatio, 0);
  assert.equal(horizontalScrollbarMetrics(1000, 400, 900).scrollRatio, 1);
});

test("maps thumb dragging to shelf scrolling while respecting minimum thumb width", () => {
  const { scrollLeftFromThumbPosition } = loadHorizontalScrollHelper();
  assert.equal(scrollLeftFromThumbPosition(90, 600, 300, 120), 300);
  assert.equal(scrollLeftFromThumbPosition(-50, 600, 300, 120), 0);
  assert.equal(scrollLeftFromThumbPosition(999, 600, 300, 120), 600);
});
