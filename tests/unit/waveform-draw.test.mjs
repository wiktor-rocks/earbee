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
    // This canvas's px → the track's, read once drawn (it may have widened).
    const scale = () => (parseFloat(canvas.style.width) * ratio) / canvas.width;
    const record = (x, y, w, h) => bars.push({ x: left * ratio + x * scale(), height: h });
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

// The continuous shape's top edge on each canvas, as [x, y] in its own
// pixels, for a track of `values` levels.
function drawShapes(ratio, values) {
  const levels = Float32Array.from({ length: values }, (_, i) => 0.2 + 0.7 * Math.abs(Math.sin(i / 37)));
  const look = { ...LOOK, style: "continuous" };
  const both = { top: { peak: levels, rms: levels }, bottom: { peak: levels, rms: levels } };
  const canvases = [];
  for (let left = 0; left < TRACK_CSS; left += CANVAS_CSS) {
    const width = Math.min(CANVAS_CSS, TRACK_CSS - left);
    const canvas = { width: Math.round(width * ratio), height: Math.round(HEIGHT_CSS * ratio), style: {} };
    const points = [];
    const ctx = {
      canvas,
      beginPath() {},
      moveTo: (x, y) => points.push([x, y]),
      lineTo: (x, y) => points.push([x, y]),
      closePath() {},
      fill() {},
    };
    const start = Math.floor((left / TRACK_CSS) * values);
    const end = Math.floor(((left + width) / TRACK_CSS) * values);
    drawWaveform(/** @type {any} */ (ctx), both, start, end - start, look, { pixelRatio: ratio });
    // The top edge runs left to right; the bottom comes back.
    const turn = points.findIndex((point, i) => i > 0 && point[0] <= points[i - 1][0]);
    canvases.push({ width: canvas.width, top: points.slice(0, turn) });
  }
  return canvases;
}

// The top edge's height at `x`, between the points either side.
function heightAt(top, x) {
  const after = top.findIndex(([px]) => px >= x);
  const [x0, y0] = top[after - 1];
  const [x1, y1] = top[after];
  return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
}

describe("the continuous shape across canvases", () => {
  // Several levels per pixel (5000), and zoomed in past one per pixel (600).
  for (const values of [5000, 600]) {
    for (const ratio of [1, 1.25, 2]) {
      test(`${values} levels at ${ratio * 100} %: it runs on across each seam`, () => {
        const canvases = drawShapes(ratio, values);
        for (let k = 1; k < canvases.length; k++) {
          const before = heightAt(canvases[k - 1].top, canvases[k - 1].width);
          const after = heightAt(canvases[k].top, 0);
          assert.ok(Math.abs(before - after) <= 1, `seam ${k}: ${before} vs ${after}`);
        }
      });
    }
  }

  test("its edge slopes from column to column: no flat steps", () => {
    const [first] = drawShapes(2, 600);
    const xs = first.top.map(([x]) => x);
    assert.ok(
      xs.every((x, i) => i === 0 || x > xs[i - 1]),
      "one point per column, left to right",
    );
  });
});

// Every canvas but the last reaches past its seam, over the next one, so
// the screen's rounding under display scaling never leaves a pixel of
// background between them; the shape there matches the next canvas's.
describe("canvases overlap at the seams", () => {
  const values = 5000;
  const levels = Float32Array.from({ length: values }, (_, i) => 0.2 + 0.7 * Math.abs(Math.sin(i / 37)));
  const both = { top: { peak: levels, rms: levels }, bottom: { peak: levels, rms: levels } };
  for (const dpr of [0.9, 1.25]) {
    const ratio = Math.max(1, dpr);
    const canvases = [];
    for (let left = 0; left < TRACK_CSS; left += CANVAS_CSS) {
      const width = Math.min(CANVAS_CSS, TRACK_CSS - left);
      const canvas = {
        width: Math.round(width * ratio),
        height: Math.round(HEIGHT_CSS * ratio),
        style: { left: `${left}px`, width: `${width}px` },
      };
      const points = [];
      const ctx = {
        canvas,
        fillStyle: "#abc",
        beginPath() {},
        moveTo: (x, y) => points.push([x, y]),
        lineTo: (x, y) => points.push([x, y]),
        closePath() {},
        fill() {},
      };
      const start = Math.floor((left / TRACK_CSS) * values);
      const end = Math.floor(((left + width) / TRACK_CSS) * values);
      drawWaveform(
        /** @type {any} */ (ctx),
        both,
        start,
        end - start,
        { ...LOOK, style: "continuous" },
        {
          trackWidth: TRACK_CSS,
          pixelRatio: ratio,
        },
      );
      const turn = points.findIndex((point, i) => i > 0 && point[0] <= points[i - 1][0]);
      canvases.push({ left, width, canvas, fillStyle: ctx.fillStyle, top: points.slice(0, turn) });
    }

    test(`at ${dpr * 100} %: each canvas but the last reaches 2 px past its seam`, () => {
      const last = canvases.length - 1;
      canvases.forEach(({ width, canvas, fillStyle }, k) => {
        const wide = k < last ? width + 2 : width;
        assert.equal(canvas.style.width, `${wide}px`, `canvas ${k}`);
        assert.equal(canvas.width, Math.round(wide * ratio), `canvas ${k}`);
        assert.equal(fillStyle, "#abc", `canvas ${k} keeps its fill colour`);
      });
    });

    test(`at ${dpr * 100} %: over the seam, the shape matches the next canvas's`, () => {
      for (let k = 1; k < canvases.length; k++) {
        const before = canvases[k - 1];
        const after = canvases[k];
        // The overlap, in the earlier canvas's px and in the next one's.
        for (const css of [0, 1, 2]) {
          const mine = heightAt(before.top, (after.left - before.left + css) * ratio);
          const next = heightAt(after.top, css * ratio);
          assert.ok(Math.abs(mine - next) <= 1, `seam ${k}, +${css} px: ${mine} vs ${next}`);
        }
      }
    });
  }
});
