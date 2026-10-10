// Drawing the bars (src/waveform-draw.js) on canvases laid out as
// WaveSurfer lays out a zoomed-in track: side by side, at whole CSS
// pixels, each sized for the screen (canvas.width = round(css × ratio),
// where WaveSurfer's ratio is devicePixelRatio, but never under 1).
// The bars must form one even grid across the seams, and a bar cut by a
// seam must be as tall on both canvases, so the waveform never looks cut.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { drawWaveform } from "../../src/waveform-draw.js";

const LOOK = { style: "bars", measure: "loudness", scale: "linear", stereo: "combined", height: 100 };
const TRACK_CSS = 2000; // the whole zoomed-in track, CSS px
const CANVAS_CSS = 858; // WaveSurfer's canvas width here
const HEIGHT_CSS = 200;
const VALUES = 5000;

// Varying levels, so neighbouring bars differ in height.
const series = Float32Array.from({ length: VALUES }, (_, i) => 0.2 + 0.7 * Math.abs(Math.sin(i / 37)));
const shaped = { top: { peak: series, rms: series }, bottom: { peak: series, rms: series } };

// Every bar drawn on every canvas, in the track's canvas pixels.
function drawTrack(ratio) {
  const bars = [];
  for (let left = 0; left < TRACK_CSS; left += CANVAS_CSS) {
    const width = Math.min(CANVAS_CSS, TRACK_CSS - left);
    const canvas = {
      width: Math.round(width * ratio),
      height: Math.round(HEIGHT_CSS * ratio),
      style: { left: `${left}px`, width: `${width}px` },
    };
    // The slice of values the canvas is given, as WaveSurfer slices it.
    const start = Math.floor((left / TRACK_CSS) * VALUES);
    const end = Math.floor(((left + width) / TRACK_CSS) * VALUES);
    const scale = (width * ratio) / canvas.width; // this canvas's px → the track's
    const record = (x, y, w, h) => bars.push({ x: left * ratio + x * scale, height: h });
    const ctx = {
      canvas,
      beginPath() {},
      fill() {},
      roundRect: record,
      rect: record,
    };
    drawWaveform(/** @type {any} */ (ctx), shaped, start, end - start, LOOK, {
      trackWidth: TRACK_CSS,
      pixelRatio: ratio,
    });
  }
  return bars;
}

describe("bars across canvases", () => {
  for (const dpr of [1, 1.25, 1.5, 0.9]) {
    const ratio = Math.max(1, dpr);
    const slot = Math.max(2, Math.round(3 * ratio));
    const bars = drawTrack(ratio);
    const bySlot = new Map();
    for (const bar of bars) {
      const k = Math.round(bar.x / slot);
      bySlot.set(k, [...(bySlot.get(k) ?? []), bar]);
    }

    test(`at ${dpr * 100} %: one even grid, no bar missing at a seam`, () => {
      for (const bar of bars) assert.ok(Math.abs(bar.x - Math.round(bar.x / slot) * slot) <= 0.5, `bar at ${bar.x}`);
      const last = Math.floor((TRACK_CSS * ratio - 1) / slot);
      for (let k = 0; k <= last; k++) assert.ok(bySlot.has(k), `slot ${k} (at ${k * slot}) is missing`);
    });

    test(`at ${dpr * 100} %: a bar cut by a seam is as tall on both canvases`, () => {
      for (const [k, drawn] of bySlot) {
        if (drawn.length < 2) continue;
        const heights = drawn.map((bar) => bar.height);
        assert.ok(Math.max(...heights) - Math.min(...heights) <= 1, `slot ${k}: ${heights.join(" vs ")}`);
      }
    });
  }
});
