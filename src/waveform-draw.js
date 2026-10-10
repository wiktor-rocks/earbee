import { columnLevels, combineFor, rangeLevel } from "./core/waveshape.js";

/** @typedef {import("./core/waveshape.js").Appearance} Appearance */
/** @typedef {import("./core/waveshape.js").Shaped} Shaped */

/* =====================================================================
 * WAVEFORM DRAWING
 * Draws `count` values from `start` of the shaped levels (core/waveshape.js)
 * onto one of WaveSurfer's canvases, in its fill colour (already set on
 * `ctx`). WaveSurfer's progress canvas is a copy of this one recoloured
 * where it is drawn ("source-in"), so the played part keeps the shape and
 * the two tones.
 *
 *   bars        rounded bars with small gaps (light, the default)
 *   continuous  one filled shape, a column per pixel
 *   twoTone     the peaks as a pale shape around the loudness, solid
 *
 * Bars and continuous show the loudness or the peaks (`measure`). The top
 * half grows up from the middle, the bottom half down (for split stereo,
 * left above and right below).
 *
 * WaveSurfer draws a zoomed-in track on several canvases side by side. The
 * shapes fill each canvas column by column, so they meet at its edges;
 * the bars are laid out on the whole track instead (see fillBars), so
 * their gaps stay even where two canvases meet.
 * ===================================================================== */

const BAR_WIDTH = 2; // CSS px
const BAR_GAP = 1;
const PEAK_ALPHA = 0.4; // the two-tone outline

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Shaped} shaped
 * @param {number} start
 * @param {number} count
 * @param {Appearance} appearance
 * @param {{ trackWidth?: number, pixelRatio?: number }} [track] The whole
 *   (zoomed) track's width in CSS px (needed for bars), and WaveSurfer's
 *   pixel ratio (without one, it is read from the canvas).
 */
export function drawWaveform(ctx, shaped, start, count, appearance, track = {}) {
  const { canvas } = ctx;
  if (!canvas.width || !canvas.height || count <= 0) return;
  const ratio = track.pixelRatio ?? (canvas.width / (parseFloat(canvas.style.width) || canvas.width) || 1);
  const kind = appearance.measure === "peaks" ? "peak" : "rms";

  if (appearance.style === "bars") {
    fillBars(ctx, shaped, kind, ratio, track.trackWidth);
    return;
  }

  // The shapes: a value per pixel column.
  const columnsOf = (side, of) => columnLevels(shaped[side][of], start, count, canvas.width, combineFor(of));
  if (appearance.style === "twoTone") {
    ctx.globalAlpha = PEAK_ALPHA;
    fillShape(ctx, columnsOf("top", "peak"), columnsOf("bottom", "peak"), ratio);
    ctx.globalAlpha = 1;
    fillShape(ctx, columnsOf("top", "rms"), columnsOf("bottom", "rms"), ratio);
  } else {
    fillShape(ctx, columnsOf("top", kind), columnsOf("bottom", kind), ratio);
  }
}

// Rounded bars, at least a pixel tall so silence still shows a line.
//
// WaveSurfer places its canvases at whole CSS pixels; under display
// scaling one may start on a fraction of a pixel and be a pixel wider or
// narrower than its share. So the bars are laid out on the whole track,
// in whole pixels of WaveSurfer's ratio, and mapped onto each canvas
// exactly: a canvas draws the bars that fall on it, the one cut by its
// edge included, and every bar takes its values from the whole track.
// Every gap is then the same, and a bar cut by a seam is as tall on both
// sides.
function fillBars(ctx, shaped, kind, ratio, trackWidth) {
  const { canvas } = ctx;
  const half = canvas.height / 2;
  const slot = Math.max(2, Math.round((BAR_WIDTH + BAR_GAP) * ratio));
  const barWidth = Math.max(1, Math.round(BAR_WIDTH * ratio));
  const top = shaped.top[kind];
  const bottom = shaped.bottom[kind];
  const combine = combineFor(kind);

  // The canvas in the track, in ratio pixels; its own pixels per one; the
  // values per one.
  const left = (parseFloat(canvas.style.left) || 0) * ratio;
  const width = (parseFloat(canvas.style.width) || canvas.width / ratio) * ratio;
  const scale = canvas.width / width;
  const perPixel = top.length / (trackWidth * ratio);

  ctx.beginPath();
  const last = Math.ceil((left + width) / slot);
  for (let bar = Math.max(0, Math.floor(left / slot)); bar < last; bar++) {
    const at = bar * slot;
    const from = Math.min(top.length - 1, Math.floor(at * perPixel));
    const to = Math.max(from + 1, Math.min(top.length, Math.floor((at + slot) * perPixel)));
    const up = rangeLevel(top, from, to, combine) * half;
    const down = rangeLevel(bottom, from, to, combine) * half;
    const barHeight = Math.max(ratio, up + down);
    const y = up + down >= ratio ? half - up : half - barHeight / 2;
    const x = (at - left) * scale;
    const w = barWidth * scale;
    if ("roundRect" in ctx) ctx.roundRect(x, y, w, barHeight, Math.min(w, barHeight / 2));
    else ctx.rect(x, y, w, barHeight);
  }
  ctx.fill();
}

// One closed shape: along the top edge, back along the bottom, at least
// half a pixel either side of the middle.
function fillShape(ctx, top, bottom, ratio) {
  const { width, height } = ctx.canvas;
  const half = height / 2;
  const step = width / top.length;
  const least = ratio / 2;
  ctx.beginPath();
  ctx.moveTo(0, half - Math.max(least, top[0] * half));
  for (let c = 0; c < top.length; c++) {
    const y = half - Math.max(least, top[c] * half);
    ctx.lineTo(c * step, y);
    ctx.lineTo((c + 1) * step, y);
  }
  for (let c = bottom.length - 1; c >= 0; c--) {
    const y = half + Math.max(least, bottom[c] * half);
    ctx.lineTo((c + 1) * step, y);
    ctx.lineTo(c * step, y);
  }
  ctx.closePath();
  ctx.fill();
}
