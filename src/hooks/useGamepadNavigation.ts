import { useEffect, useRef, useState } from "react";

type Direction = "left" | "right" | "up" | "down";

type Options = {
  selectedId: string;
  selectGame: (id: string) => void;
  launchSelected: () => void;
  openInfo: () => void;
  closeOverlay: () => void;
  openMenu: () => void;
};

function pressed(gamepad: Gamepad, index: number) {
  return Boolean(gamepad.buttons[index]?.pressed || gamepad.buttons[index]?.value > 0.55);
}

function clearGamepadFocus() {
  document.querySelectorAll<HTMLElement>("[data-gamepad-focus]").forEach(element => element.removeAttribute("data-gamepad-focus"));
}

function focusElement(element: HTMLElement, fromGamepad: boolean) {
  clearGamepadFocus();
  if (fromGamepad) element.setAttribute("data-gamepad-focus", "true");
  element.focus({ preventScroll: true });
}

function navigationDirection(gamepad: Gamepad, detailOpen: boolean): Direction | "" {
  if (pressed(gamepad, 14)) return "left";
  if (pressed(gamepad, 15)) return "right";
  if (pressed(gamepad, 12)) return "up";
  if (pressed(gamepad, 13)) return "down";

  const x = gamepad.axes[0] || 0;
  const y = detailOpen ? 0 : gamepad.axes[1] || 0;
  if (Math.max(Math.abs(x), Math.abs(y)) <= 0.55) return "";
  if (Math.abs(x) > Math.abs(y)) return x < 0 ? "left" : "right";
  return y < 0 ? "up" : "down";
}

function focusScope() {
  for (const selector of [".enhancement-setup-backdrop", ".immersive-menu-backdrop", ".modal-backdrop", ".ctx-menu", ".side-sheet.open", ".bookshelf-collection-overlay"]) {
    const matches = Array.from(document.querySelectorAll<HTMLElement>(selector));
    const visible = matches.reverse().find(element => element.getBoundingClientRect().width > 0);
    if (visible) return visible;
  }
  return document;
}

function focusableElements() {
  const scope = focusScope();
  const selector = "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])";
  return Array.from(scope.querySelectorAll<HTMLElement>(selector)).filter((element) => {
    if (element.closest(".gamepad-hints, .side-sheet:not(.open)")) return false;
    if (element.closest("[aria-hidden='true'], [inert]")) return false;
    const style = getComputedStyle(element);
    if (style.visibility === "hidden" || style.display === "none") return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
}

function isTextEntry(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function centerOf(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function moveSpatialFocus(direction: Direction, selectedId: string, selectGame: (id: string) => void, fromGamepad = false) {
  let controls = focusableElements();
  const collection = document.querySelector("[data-game-grid]");
  if (focusScope() === document && collection && (!document.activeElement?.closest("button, input, select, textarea") || document.activeElement?.hasAttribute("data-game-id"))) {
    controls = controls.filter(element => collection.contains(element));
  }
  const cards = controls.filter(element => element.dataset.gameId);
  if (cards.length && (!controls.includes(document.activeElement as HTMLElement) || (document.activeElement as HTMLElement)?.dataset.gameId)) controls = cards;
  if (!controls.length) return;
  const active = document.activeElement instanceof HTMLElement && controls.includes(document.activeElement)
    ? document.activeElement
    : controls.find((element) => element.dataset.gameId === selectedId) || controls[0];
  const origin = centerOf(active);
  const candidates = controls
    .filter((element) => element !== active)
    .map((element) => {
      const point = centerOf(element);
      const primary = direction === "left" ? origin.x - point.x
        : direction === "right" ? point.x - origin.x
          : direction === "up" ? origin.y - point.y
            : point.y - origin.y;
      const cross = direction === "left" || direction === "right"
        ? Math.abs(point.y - origin.y)
        : Math.abs(point.x - origin.x);
      return { element, primary, score: primary + cross * 1.65 };
    })
    .filter((candidate) => candidate.primary > 1)
    .sort((left, right) => left.score - right.score);
  const next = candidates[0]?.element;
  if (!next) return;
  focusElement(next, fromGamepad);
  next.scrollIntoView({ block: "nearest", inline: "nearest" });
  if (next.dataset.gameId) selectGame(next.dataset.gameId);
}

export function useGamepadNavigation(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const [isActive, setIsActive] = useState(false);
  const hintTimer = useRef<number | null>(null);
  const repeat = useRef<{ direction: Direction | ""; nextAt: number }>({ direction: "", nextAt: 0 });
  const previous = useRef<Record<string, boolean>>({});
  const lastFocusScope = useRef<Document | HTMLElement | null>(null);

  useEffect(() => {
    const markGamepadActivity = () => {
      setIsActive(true);
      if (hintTimer.current !== null) window.clearTimeout(hintTimer.current);
      hintTimer.current = window.setTimeout(() => setIsActive(false), 3500);
    };
    const hideGamepadHints = () => {
      clearGamepadFocus();
      setIsActive(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const scope = focusScope();
      const controls = focusableElements();
      if (event.key === "Tab" && scope !== document && controls.length) {
        const activeIndex = controls.indexOf(document.activeElement as HTMLElement);
        const nextIndex = event.shiftKey
          ? (activeIndex <= 0 ? controls.length - 1 : activeIndex - 1)
          : (activeIndex < 0 || activeIndex === controls.length - 1 ? 0 : activeIndex + 1);
        event.preventDefault();
        controls[nextIndex].focus({ preventScroll: true });
        return;
      }
      if ((event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "ArrowDown") && !isTextEntry(event.target)) {
        moveSpatialFocus(event.key.replace("Arrow", "").toLowerCase() as Direction, latest.current.selectedId, latest.current.selectGame);
        event.preventDefault();
      }
    };
    const onConnected = () => markGamepadActivity();
    const onDisconnected = () => {
      previous.current = {};
      repeat.current = { direction: "", nextAt: 0 };
      lastFocusScope.current = null;
      setIsActive(false);
    };
    window.addEventListener("gamepadconnected", onConnected);
    window.addEventListener("gamepaddisconnected", onDisconnected);
    window.addEventListener("pointerdown", hideGamepadHints, true);
    window.addEventListener("keydown", hideGamepadHints, true);
    window.addEventListener("keydown", onKeyDown);

    let frame = 0;
    let lastFrame = performance.now();
    const loop = () => {
      const frameTime = performance.now();
      const elapsed = Math.min(50, frameTime - lastFrame);
      lastFrame = frameTime;
      const gamepad = navigator.getGamepads?.().find(Boolean);
      if (gamepad) {
        const scope = focusScope();
        if (scope !== lastFocusScope.current) {
          lastFocusScope.current = scope;
          const controls = focusableElements();
          const initial = controls.find(element => element.dataset.gameId === latest.current.selectedId) || controls[0];
          if (initial) focusElement(initial, true);
        }
        const detail = scope instanceof HTMLElement && scope.matches(".side-sheet.open") ? scope : null;
        const scrollAxis = Math.abs(gamepad.axes[3] || 0) > 0.2 ? gamepad.axes[3] : detail ? gamepad.axes[1] || 0 : 0;
        if (Math.abs(scrollAxis) > 0.2) {
          const scrollTarget = detail || (scope instanceof HTMLElement ? [scope, ...Array.from(scope.querySelectorAll<HTMLElement>("*"))].find(element => element.scrollHeight > element.clientHeight && /auto|scroll/.test(getComputedStyle(element).overflowY)) : null);
          if (scrollTarget) { scrollTarget.scrollTop += scrollAxis * elapsed * 0.85; markGamepadActivity(); }
        }
        const direction = navigationDirection(gamepad, Boolean(detail));
        const states: Record<string, boolean> = {
          left: direction === "left", right: direction === "right", up: direction === "up", down: direction === "down",
          confirm: pressed(gamepad, 0), back: pressed(gamepad, 1), info: pressed(gamepad, 2), menu: pressed(gamepad, 9)
        };
        const now = Date.now();
        if (Object.values(states).some(Boolean)) markGamepadActivity();

        if (!direction) {
          repeat.current = { direction: "", nextAt: 0 };
        } else if (repeat.current.direction !== direction) {
          repeat.current = { direction, nextAt: now + 340 };
          moveSpatialFocus(direction, latest.current.selectedId, latest.current.selectGame, true);
        } else if (now >= repeat.current.nextAt) {
          repeat.current.nextAt = now + 125;
          moveSpatialFocus(direction, latest.current.selectedId, latest.current.selectGame, true);
        }

        const fresh = (name: string) => states[name] && !previous.current[name];
        if (fresh("confirm")) {
          const active = document.activeElement as HTMLElement | null;
          if (scope === document || (active && scope.contains(active))) {
            if (scope === document && active?.dataset.gameId && !active.closest("[data-game-grid]")) latest.current.launchSelected();
            else if (active && active.matches("button, a[href], input, select, textarea")) active.click();
            else if (scope === document) latest.current.launchSelected();
          }
        }
        if (fresh("back")) latest.current.closeOverlay();
        if (fresh("info") && (scope === document || scope instanceof HTMLElement && scope.matches(".bookshelf-collection-overlay"))) latest.current.openInfo();
        if (fresh("menu")) latest.current.openMenu();
        previous.current = states;
      } else {
        previous.current = {};
        repeat.current = { direction: "", nextAt: 0 };
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      clearGamepadFocus();
      if (hintTimer.current !== null) window.clearTimeout(hintTimer.current);
      window.removeEventListener("gamepadconnected", onConnected);
      window.removeEventListener("gamepaddisconnected", onDisconnected);
      window.removeEventListener("pointerdown", hideGamepadHints, true);
      window.removeEventListener("keydown", hideGamepadHints, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return { isGamepadActive: isActive };
}
