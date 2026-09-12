const LINE_SCROLL_PIXELS = 24;
const PAGE_SCROLL_VIEWPORT_RATIO = 0.9;

type WheelInput = Pick<WheelEvent, "deltaMode" | "deltaX" | "deltaY">;

/**
 * Converts a wheel gesture into a predictable horizontal distance.
 * Trackpads may already emit a horizontal delta; conventional wheels use Y.
 */
export function horizontalScrollAmount(event: WheelInput, viewportWidth: number) {
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  if (!Number.isFinite(delta) || delta === 0) return 0;

  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return delta * LINE_SCROLL_PIXELS;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return delta * Math.max(viewportWidth, 1) * PAGE_SCROLL_VIEWPORT_RATIO;
  return delta;
}

export function horizontalScrollbarMetrics(scrollWidth: number, clientWidth: number, scrollLeft: number) {
  const safeScrollWidth = Number.isFinite(scrollWidth) ? Math.max(0, scrollWidth) : 0;
  const safeClientWidth = Number.isFinite(clientWidth) ? Math.max(0, clientWidth) : 0;
  const maxScroll = Math.max(0, safeScrollWidth - safeClientWidth);
  const viewportRatio = safeScrollWidth > 0
    ? Math.min(1, safeClientWidth / safeScrollWidth)
    : 1;
  const clampedScrollLeft = Number.isFinite(scrollLeft)
    ? Math.min(maxScroll, Math.max(0, scrollLeft))
    : 0;

  return {
    maxScroll,
    viewportRatio,
    scrollRatio: maxScroll > 0 ? clampedScrollLeft / maxScroll : 0,
    hasOverflow: maxScroll > 0
  };
}

export function scrollLeftFromThumbPosition(
  thumbPosition: number,
  maxScroll: number,
  trackWidth: number,
  thumbWidth: number
) {
  const travel = Math.max(0, trackWidth - thumbWidth);
  if (travel === 0 || maxScroll <= 0) return 0;
  const clampedPosition = Math.min(travel, Math.max(0, thumbPosition));
  return (clampedPosition / travel) * maxScroll;
}
