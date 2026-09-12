function toggleWindowFullscreen(window, { timeoutMs = 400, setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout } = {}) {
  if (!window) return Promise.resolve(false);

  const target = !window.isFullScreen();
  const eventName = target ? "enter-full-screen" : "leave-full-screen";

  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = (state) => {
      if (settled) return;
      settled = true;
      window.removeListener(eventName, onEvent);
      if (timer !== null) clearTimeoutImpl(timer);
      resolve(Boolean(state));
    };
    const onEvent = () => finish(target);

    window.once(eventName, onEvent);
    try {
      window.setFullScreen(target);
    } catch {
      finish(Boolean(window.isFullScreen()));
      return;
    }
    timer = setTimeoutImpl(() => finish(Boolean(window.isFullScreen())), timeoutMs);
  });
}

module.exports = { toggleWindowFullscreen };
