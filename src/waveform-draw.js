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
 *   continuous  one filled shape, its outline through every pixel column
 *   twoTone     the peaks as a pale shape around the loudness, solid
 *
 * Bars and continuous show the loudness or the peaks (`measure`). The top
 * half grows up from the middle, the bottom half down (for split stereo,
 * left above and right below).
 *
 * WaveSurfer draws a zoomed-in track on several canvases side by side. The
 * shapes reach one column past each edge of a canvas, read from the whole
 * track, so they run on into the next canvas; the bars are laid out on
 * the whole track instead (see fillBars), so their gaps stay even where
 * two canvases meet.
 *
 * The canvases only just meet, and under display scaling (90 %) the screen
 * rounds each one's start and width to its pixels separately, which can
 * leave a pixel of background between two. So every canvas but the last
 * reaches a little past its seam (overlapSeam), drawing the track's next
 * values there: the same as the next canvas draws, whichever is on top.
 * ===================================================================== */

const BAR_WIDTH = 2; // CSS px
const BAR_GAP = 1;
const PEAK_ALPHA = 0.4; // the two-tone outline
// How far a canvas reaches over the next one, in CSS px: at 90 %, one is
// 0.9 screen px, which after rounding doesn't always cover the missing one.
const SEAM_OVERLAP = 2;

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
  if (track.trackWidth) count *= overlapSeam(ctx, ratio, track.trackWidth);

  if (appearance.style === "bars") {
    fillBars(ctx, shaped, kind, ratio, track.trackWidth);
    return;
  }

  // The shapes: a value per pixel column, plus the column just outside
  // each edge (from the neighbouring canvases' values), so the outline
  // runs on to where the next canvas picks it up.
  const perColumn = count / canvas.width;
  const columnsOf = (side, of) =>
    columnLevels(shaped[side][of], start - perColumn, count + 2 * perColumn, canvas.width + 2, combineFor(of));
  if (appearance.style === "twoTone") {
    ctx.globalAlpha = PEAK_ALPHA;
    fillShape(ctx, columnsOf("top", "peak"), columnsOf("bottom", "peak"), ratio);
    ctx.globalAlpha = 1;
    fillShape(ctx, columnsOf("top", "rms"), columnsOf("bottom", "rms"), ratio);
  } else {
    fillShape(ctx, columnsOf("top", kind), columnsOf("bottom", kind), ratio);
  }
}

// Widens a canvas by SEAM_OVERLAP CSS px, over the start of the next one,
// unless it is the track's last (which would stick out of WaveSurfer's
// wrapper and make it scroll further). Returns how many times wider it
// got in CSS px (WaveSurfer slices the values by CSS px), for the count of
// values it now shows. Resizing a canvas resets its context, so the fill
// colour is set again.
function overlapSeam(ctx, ratio, trackWidth) {
  const { canvas } = ctx;
  const left = parseFloat(canvas.style.left) || 0;
  const width = parseFloat(canvas.style.width);
  const extra = Math.min(SEAM_OVERLAP, Math.floor(trackWidth - left - width));
  if (!width || extra <= 0) return 1;
  const { fillStyle } = ctx;
  canvas.style.width = `${width + extra}px`;
  canvas.width = Math.round((width + extra) * ratio);
  ctx.fillStyle = fillStyle;
  return (width + extra) / width;
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

// One closed shape: a line through the middle of every column, along the
// top edge and back along the bottom, at least half a pixel either side
// of the middle. Lines between the middles slope (and are smoothed by the
// canvas), where flat steps a column wide looked blocky. The first and
// last values are the columns just outside the canvas, which it clips.
function fillShape(ctx, top, bottom, ratio) {
  const { width, height } = ctx.canvas;
  const half = height / 2;
  const step = width / (top.length - 2);
  const least = ratio / 2;
  const x = (i) => (i - 0.5) * step; // the middle of column i − 1
  ctx.beginPath();
  ctx.moveTo(x(0), half - Math.max(least, top[0] * half));
  for (let i = 1; i < top.length; i++) ctx.lineTo(x(i), half - Math.max(least, top[i] * half));
  for (let i = bottom.length - 1; i >= 0; i--) ctx.lineTo(x(i), half + Math.max(least, bottom[i] * half));
  ctx.closePath();
  ctx.fill();
}
