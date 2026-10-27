/* =====================================================================
 * KNOBS
 * A round knob drawn over a setting's <input type="range">. The input
 * stays, out of sight: it holds the value, keeps Tab and the arrow keys
 * and tells screen readers it's a slider; the knob only draws the value
 * and turns it with the pointer.
 *
 * Dragging up turns it up, down turns it down (CONFIG.knob.travel pixels
 * for the whole range at the Knob sensitivity setting's 100 %, Shift for
 * fine). The pointer is locked while
 * dragging, so the cursor hides and can't run into the screen's edge; it
 * comes back where it was. The wheel turns it too.
 * ===================================================================== */

import { CONFIG } from "../config.js";
import { clamp } from "../core/format.js";
import { element } from "./dom.js";
import { getPrefs } from "./prefs.js";

const SVG = "http://www.w3.org/2000/svg";

// The arc covers 270°, from bottom left (135°, clockwise from 3 o'clock)
// round the top to bottom right. Both circles have pathLength 100.
const SWEEP = 0.75;
const START_ANGLE = 135;

/**
 * A value on its range's step grid, from `min` (as a range input does).
 * @param {number} value
 * @param {{ min: number, max: number, step: number }} range
 */
export function snapToStep(value, { min, max, step }) {
  const steps = Math.round((clamp(value, min, max) - min) / step);
  return Number(clamp(min + steps * step, min, max).toFixed(10));
}

const svgElement = (tag, attributes) => {
  const node = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
};

/**
 * Wraps `input` in a knob.
 * @param {HTMLInputElement} input
 * @param {object} options
 * @param {{ min: number, max: number, step: number, initial: number }} options.range
 * @param {boolean} [options.centred] The arc starts from the default (pitch, EQ), not the minimum.
 * @param {(value: number) => void} options.onInput Called with a new, snapped value.
 * @returns {{ render: (value: number) => void }}
 */
export function buildKnob(input, { range, centred = false, onInput }) {
  const { min, max } = range;
  const fraction = (value) => (clamp(value, min, max) - min) / (max - min);

  const track = svgElement("circle", { class: "knob-track", cx: 20, cy: 20, r: 16, pathLength: 100 });
  const arc = svgElement("circle", { class: "knob-arc", cx: 20, cy: 20, r: 16, pathLength: 100 });
  const face = svgElement("circle", { class: "knob-face", cx: 20, cy: 20, r: 11 });
  const pointer = svgElement("line", { class: "knob-pointer", x1: 20, y1: 20, x2: 20, y2: 20 });
  for (const ring of [track, arc]) ring.setAttribute("transform", `rotate(${START_ANGLE} 20 20)`);
  track.setAttribute("stroke-dasharray", `${SWEEP * 100} 100`);

  const svg = svgElement("svg", { class: "knob-dial", viewBox: "0 0 40 40", "aria-hidden": "true" });
  svg.append(track, arc, face, pointer);

  const knob = element("div", { className: "knob" });
  input.replaceWith(knob);
  knob.append(svg, input);

  // The value from `value` itself: the arc from the start (min or the
  // default) to it, and the pointer at it.
  function render(value) {
    const at = fraction(value);
    const from = centred ? fraction(range.initial) : 0;
    const [low, high] = at < from ? [at, from] : [from, at];
    arc.setAttribute("stroke-dasharray", `${(high - low) * SWEEP * 100} 100`);
    arc.setAttribute("stroke-dashoffset", String(-low * SWEEP * 100));

    const angle = ((START_ANGLE + at * SWEEP * 360) * Math.PI) / 180;
    pointer.setAttribute("x1", String(20 + 3 * Math.cos(angle)));
    pointer.setAttribute("y1", String(20 + 3 * Math.sin(angle)));
    pointer.setAttribute("x2", String(20 + 9 * Math.cos(angle)));
    pointer.setAttribute("y2", String(20 + 9 * Math.sin(angle)));
  }

  // Each change goes out once, snapped, and only when it's a new value.
  const send = (value) => {
    const snapped = snapToStep(value, range);
    if (snapped !== Number(input.value)) onInput(snapped);
  };

  // How much a pixel of drag turns it, at the Knob sensitivity setting
  // (Settings › General, a percentage).
  const perPixel = (fine) => {
    const sensitivity = (getPrefs("general")?.knobSensitivity ?? 100) / 100;
    return ((max - min) * sensitivity) / CONFIG.knob.travel / (fine ? CONFIG.knob.fine : 1);
  };

  /* ---------- Dragging ---------- */

  // The unrounded value while dragging, so a slow fine drag still gets
  // from one step to the next. Kept inside the range, so turning back
  // from an end moves at once.
  let raw = 0;
  let lastY = 0;

  function onMove(event) {
    // Locked, the pointer doesn't move and only movementY says how far
    // it went; otherwise its position does.
    const dy = document.pointerLockElement === knob ? event.movementY : event.clientY - lastY;
    lastY = event.clientY;
    raw = clamp(raw - dy * perPixel(event.shiftKey), min, max);
    send(raw);
  }

  function endDrag() {
    knob.classList.remove("dragging");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", endDrag);
    window.removeEventListener("pointercancel", endDrag);
    if (document.pointerLockElement === knob) document.exitPointerLock();
  }

  knob.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    raw = Number(input.value);
    lastY = event.clientY;
    knob.classList.add("dragging");
    // Captured until the lock takes over (or for the whole drag, if
    // there's no lock: the test window, a refused request).
    knob.setPointerCapture(event.pointerId);
    Promise.resolve(knob.requestPointerLock?.()).catch(() => {});
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
  });

  /* ---------- The wheel ---------- */

  // A notch turns it as far as CONFIG.knob.wheelPixels of drag at 100 %
  // (the setting doesn't change the wheel); with Shift (which makes the
  // wheel scroll sideways, hence deltaX), by one step.
  knob.addEventListener(
    "wheel",
    (event) => {
      const delta = event.deltaY || event.deltaX;
      if (!delta) return;
      event.preventDefault();
      const direction = delta < 0 ? 1 : -1;
      const amount = event.shiftKey ? range.step : ((max - min) * CONFIG.knob.wheelPixels) / CONFIG.knob.travel;
      send(Number(input.value) + direction * amount);
    },
    { passive: false },
  );

  return { render };
}
