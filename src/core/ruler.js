// The time ruler's ticks (timeline.js): which step to label at a zoom, the
// ticks in a time range, and their labels. Pure, so it's unit-tested.

// Steps between labelled ticks, in seconds: the first one that leaves
// enough room between labels is used.
const STEPS = [0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
// Minor ticks per labelled step, the most that stay this far apart.
const DIVISIONS = [5, 2, 1];
const MIN_MINOR_PX = 6;

/**
 * The ticks between `start` and `end` (seconds) at `pxPerSecond`, with
 * labelled ("major") ticks at least `minLabelPx` apart.
 * @param {number} start
 * @param {number} end
 * @param {number} pxPerSecond
 * @param {number} [minLabelPx]
 * @returns {{ step: number, ticks: { time: number, major: boolean }[] }}
 */
export function rulerTicks(start, end, pxPerSecond, minLabelPx = 70) {
  const step = STEPS.find((each) => each * pxPerSecond >= minLabelPx) ?? STEPS.at(-1);
  const divisions = DIVISIONS.find((count) => (step / count) * pxPerSecond >= MIN_MINOR_PX) ?? 1;
  const minor = step / divisions;
  const ticks = [];
  // Counting whole minor steps keeps the times exact multiples (no drift).
  for (let i = Math.ceil(start / minor - 1e-9); i * minor <= end + 1e-9; i++) {
    ticks.push({ time: i * minor, major: i % divisions === 0 });
  }
  return { step, ticks };
}

/**
 * A ruler label: "1:05", "1:05.5" or "1:05.25", as precise as the step.
 * @param {number} time
 * @param {number} step
 */
export function formatRulerTime(time, step) {
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  const rounded = Math.round(time * 10 ** decimals) / 10 ** decimals;
  const minutes = Math.floor(rounded / 60);
  const seconds = (rounded - minutes * 60).toFixed(decimals).padStart(decimals ? decimals + 3 : 2, "0");
  return `${minutes}:${seconds}`;
}
