// Zooming into the picture (features/video-zoom.js; drawn by
// video-worker.js): which part of the frame shows, and where on the
// canvas. Pure, so the page and the worker share it and it can be tested
// on its own.
//
// A view is { zoom, x, y }: zoom 1 is the whole frame, letterboxed (as
// without zooming); 2 shows it twice as large. x and y are the middle of
// what shows, as fractions of the frame's width and height. Zooming in,
// the picture grows to fill the box first (the letterbox goes), then
// only a part of the frame shows; the middle is kept so that part stays
// inside the frame.
//
// A box is { aspect, width, height }: the frame's width / height, and
// the box's size in pixels (the canvas's, or the pane's on the page:
// the same shape).
//
// Every function here gives back something drawable whatever it's given
// (NaN, Infinity, an empty box): the video worker draws with it on every
// frame, and an error there stops the picture (tests/unit/video-zoom.test.mjs
// tries 20,000 odd inputs).

import { clamp } from "../core/format.js";

/** @typedef {{ zoom: number, x: number, y: number }} ZoomView */
/** @typedef {{ aspect: number, width: number, height: number }} ZoomBox */

export const WHOLE = Object.freeze({ zoom: 1, x: 0.5, y: 0.5 });

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const positive = (value) => finite(value) && value > 0;
// A box that can be zoomed in: a real frame shape in a box with room.
const usable = (box) => positive(box.aspect) && positive(box.width) && positive(box.height);
const WHOLE_CROP = Object.freeze({ left: 0, top: 0, width: 1, height: 1 });

/**
 * A view from outside (a message): finite, zoom within 1 … `max`, the
 * middle within the frame; anything else is the whole picture.
 * @param {any} view @param {number} max @returns {ZoomView}
 */
export function safeView(view, max) {
  if (!view || !finite(view.zoom) || !finite(view.x) || !finite(view.y)) return WHOLE;
  return { zoom: clamp(view.zoom, 1, max), x: clamp(view.x, 0, 1), y: clamp(view.y, 0, 1) };
}

// Pixels per frame height at `zoom`, and the share of the frame's width
// and height that shows.
function scaleAt({ aspect, width, height }, zoom) {
  const scale = Math.min(width / aspect, height) * zoom;
  return { scale, w: Math.min(1, width / (scale * aspect)), h: Math.min(1, height / scale) };
}

/**
 * The view with its middle moved so what shows stays inside the frame.
 * @param {ZoomBox} box @param {ZoomView} view @returns {ZoomView}
 */
export function clampView(box, view) {
  if (!usable(box) || ![view.zoom, view.x, view.y].every(finite)) return WHOLE;
  const zoom = Math.max(1, view.zoom);
  const { w, h } = scaleAt(box, zoom);
  return { zoom, x: clamp(view.x, w / 2, 1 - w / 2), y: clamp(view.y, h / 2, 1 - h / 2) };
}

/**
 * What shows: `crop`, the part of the frame (fractions of its width and
 * height), and `rect`, where it goes in the box (pixels, centred).
 * @param {ZoomBox} box @param {ZoomView} view
 */
export function zoomedView(box, view) {
  if (!usable(box)) {
    const size = (value) => (positive(value) ? value : 0);
    return { crop: WHOLE_CROP, rect: { x: 0, y: 0, width: size(box.width), height: size(box.height) } };
  }
  const { zoom, x, y } = clampView(box, view);
  const { scale, w, h } = scaleAt(box, zoom);
  const width = w * box.aspect * scale;
  const height = h * scale;
  return {
    crop: { left: x - w / 2, top: y - h / 2, width: w, height: h },
    rect: { x: (box.width - width) / 2, y: (box.height - height) / 2, width, height },
  };
}

// The frame's point (fractions) under the box's point (pixels); outside
// the picture (in the letterbox), the nearest edge.
function pointAt(box, view, px, py) {
  const { crop, rect } = zoomedView(box, view);
  return {
    x: crop.left + clamp((px - rect.x) / rect.width, 0, 1) * crop.width,
    y: crop.top + clamp((py - rect.y) / rect.height, 0, 1) * crop.height,
  };
}

/**
 * Zoomed to `zoom`, keeping the frame's point under the box's point
 * (px, py) where it is: zooming in where the pointer is.
 * @param {ZoomBox} box @param {ZoomView} view @param {number} zoom @param {number} px @param {number} py
 * @returns {ZoomView}
 */
export function zoomAround(box, view, zoom, px, py) {
  if (!usable(box) || !finite(zoom)) return clampView(box, view);
  // Without a point, the middle of the box.
  if (!finite(px) || !finite(py)) [px, py] = [box.width / 2, box.height / 2];
  const point = pointAt(box, view, px, py);
  const { rect } = zoomedView(box, { zoom, x: 0.5, y: 0.5 });
  const { w, h } = scaleAt(box, Math.max(1, zoom));
  const left = point.x - clamp((px - rect.x) / rect.width, 0, 1) * w;
  const top = point.y - clamp((py - rect.y) / rect.height, 0, 1) * h;
  return clampView(box, { zoom, x: left + w / 2, y: top + h / 2 });
}

/**
 * Moved by (dx, dy) box pixels, as if dragging the picture: it follows
 * the pointer.
 * @param {ZoomBox} box @param {ZoomView} view @param {number} dx @param {number} dy
 * @returns {ZoomView}
 */
export function panBy(box, view, dx, dy) {
  if (!usable(box) || !finite(dx) || !finite(dy)) return clampView(box, view);
  const { crop, rect } = zoomedView(box, view);
  return clampView(box, {
    zoom: view.zoom,
    x: view.x - (dx / rect.width) * crop.width,
    y: view.y - (dy / rect.height) * crop.height,
  });
}

/**
 * A crop (fractions of the frame) in a frame `width` × `height` pixels.
 * @param {{ left: number, top: number, width: number, height: number }} crop
 * @param {number} width @param {number} height
 */
export const cropPixels = (crop, width, height) => ({
  left: crop.left * width,
  top: crop.top * height,
  width: crop.width * width,
  height: crop.height * height,
});

/**
 * The same in whole pixels, inside the frame, at least one: Mediabunny's
 * crop takes nothing else (a fraction once stopped the video worker).
 * @param {{ left: number, top: number, width: number, height: number }} crop Fractions.
 * @param {number} width @param {number} height The frame's, in pixels (at least 1).
 */
export function wholeCrop(crop, width, height) {
  const frameWidth = positive(width) ? Math.max(1, Math.round(width)) : 1;
  const frameHeight = positive(height) ? Math.max(1, Math.round(height)) : 1;
  const fractions = [crop?.left, crop?.top, crop?.width, crop?.height].every(finite) ? crop : WHOLE_CROP;
  const pixels = cropPixels(fractions, frameWidth, frameHeight);
  const left = clamp(Math.floor(pixels.left), 0, frameWidth - 1);
  const top = clamp(Math.floor(pixels.top), 0, frameHeight - 1);
  return {
    left,
    top,
    width: clamp(Math.round(pixels.left + pixels.width) - left, 1, frameWidth - left),
    height: clamp(Math.round(pixels.top + pixels.height) - top, 1, frameHeight - top),
  };
}
