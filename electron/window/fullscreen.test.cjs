const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { toggleWindowFullscreen } = require("./fullscreen.cjs");

function fakeWindow(initialState, emitEvent) {
  const window = new EventEmitter();
  let fullScreen = initialState;
  window.isFullScreen = () => fullScreen;
  window.setFullScreen = (next) => {
    if (emitEvent) {
      window.emit(next ? "enter-full-screen" : "leave-full-screen");
    }
    fullScreen = next;
  };
  return window;
}

test("returns the requested state when the native fullscreen event arrives before Electron updates its query", async () => {
  const window = fakeWindow(false, true);

  assert.equal(await toggleWindowFullscreen(window, { timeoutMs: 10 }), true);
  assert.equal(window.isFullScreen(), true);
});

test("returns the requested exit state when the native leave event arrives before Electron updates its query", async () => {
  const window = fakeWindow(true, true);

  assert.equal(await toggleWindowFullscreen(window, { timeoutMs: 10 }), false);
  assert.equal(window.isFullScreen(), false);
});

test("uses the actual window state if the native event is not delivered", async () => {
  const window = fakeWindow(false, false);

  assert.equal(await toggleWindowFullscreen(window, { timeoutMs: 0 }), true);
});
