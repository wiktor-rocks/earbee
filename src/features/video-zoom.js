/* =====================================================================
 * VIDEO ZOOM
 * Zooming into the picture, to see a hand on the fretboard or the
 * keys: the wheel over the picture zooms in or out where the pointer is,
 * and once zoomed in, dragging the picture moves it. The picture grows
 * to fill its pane, then shows less of the frame, sharp (the worker crops
 * each frame; video/zoom.js, video/view.js).
 *
 *   Keys       Ctrl+= / Ctrl+- zoom in or out around the middle, Ctrl+0
 *              shows all of the picture (app.js's SHORTCUTS).
 *   Controls   In the picture's bottom-left corner, while the pointer is
 *              on it, and always while zoomed in: −, the zoom (a click
 *              shows all of the picture again) and +.
 *   Where      The main window's pane (big video too) and the video
 *              window's (bindVideoZoom is called for each); the zoom is
 *              the picture's, so it goes with it from one to the other.
 *              Each video starts with all of its picture.
 *
 * Removing it means deleting this file, its part in style.css ("Video
 * zoom"), video/zoom.js and its uses in video/view.js and
 * video/video-worker.js, and the lines marked "Video zoom (".
 * ===================================================================== */

import { CONFIG } from "../config.js";
import { player } from "../context.js";
import { element, guarded } from "../ui/dom.js";

// Every pane's controls, to show the zoom in each.
/** @type {Set<{ bar: HTMLElement, level: HTMLButtonElement }>} */
const controls = new Set();

const zoom = () => player.videoView.getZoom().zoom;

/** Ctrl+=: closer, around the middle of the picture. */
export const zoomVideoIn = () => player.videoView.zoomTo(zoom() * CONFIG.video.zoom.keyFactor);
/** Ctrl+-: further. */
export const zoomVideoOut = () => player.videoView.zoomTo(zoom() / CONFIG.video.zoom.keyFactor);
/** Ctrl+0: all of the picture. */
export const resetVideoZoom = () => player.videoView.resetZoom();

/**
 * The video view's zoom changed; called from its onZoomChange.
 * @param {import("../video/zoom.js").ZoomView} view
 */
export function videoZoomChanged(view) {
  const zoomed = view.zoom > 1;
  for (const entry of controls) {
    const { bar, level } = entry;
    // A closed video window's controls go.
    if (!bar.isConnected) {
      controls.delete(entry);
      continue;
    }
    bar.classList.toggle("zoomed", zoomed);
    level.textContent = `${view.zoom < 10 ? view.zoom.toFixed(1) : Math.round(view.zoom)}×`;
    level.disabled = !zoomed;
  }
}

// A small round button with a "−" or "+" drawn in (the sprite is the main
// page's, which the video window doesn't have).
function stepButton(sign, title, onPress) {
  const button = element("button", { type: "button", className: "video-zoom-step", title, ariaLabel: title }, sign);
  button.addEventListener("click", guarded(onPress));
  return button;
}

/**
 * Zooming in `pane` (the main window's, or the video window's): the
 * wheel, dragging, and the controls.
 * @param {HTMLElement} pane
 */
export function bindVideoZoom(pane) {
  const win = pane.ownerDocument.defaultView ?? window;

  /* ---------- The wheel ---------- */

  // Each pixel of scrolling zooms by e^wheelSpeed, so a notch (100 px)
  // and a trackpad's many small steps feel the same.
  pane.addEventListener(
    "wheel",
    (event) => {
      if (event.target instanceof win.Element && event.target.closest("button")) return;
      const pixels = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      if (!pixels) return;
      event.preventDefault();
      player.videoView.zoomTo(zoom() * Math.exp(-pixels * CONFIG.video.zoom.wheelSpeed), event.clientX, event.clientY);
    },
    { passive: false },
  );

  /* ---------- Dragging, once zoomed in ---------- */

  let last = null; // the pointer's place, while dragging
  const onMove = (event) => {
    if (!last) return;
    player.videoView.panZoomBy(event.clientX - last.x, event.clientY - last.y);
    last = { x: event.clientX, y: event.clientY };
  };
  const endDrag = () => {
    last = null;
    pane.classList.remove("panning");
    win.removeEventListener("pointermove", onMove);
    win.removeEventListener("pointerup", endDrag);
    win.removeEventListener("pointercancel", endDrag);
  };
  pane.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || zoom() <= 1) return;
    if (event.target instanceof win.Element && event.target.closest("button")) return;
    event.preventDefault();
    last = { x: event.clientX, y: event.clientY };
    pane.classList.add("panning");
    win.addEventListener("pointermove", onMove);
    win.addEventListener("pointerup", endDrag);
    win.addEventListener("pointercancel", endDrag);
  });

  /* ---------- The controls ---------- */

  const level = element("button", {
    type: "button",
    className: "video-zoom-level",
    title: "Show all of the picture (Ctrl+0)",
  });
  level.addEventListener("click", guarded(resetVideoZoom));
  const bar = element(
    "div",
    { className: "video-zoom-bar" },
    stepButton("−", "Zoom out (Ctrl+−)", zoomVideoOut),
    level,
    stepButton("+", "Zoom in: or scroll over the picture (Ctrl+=)", zoomVideoIn),
  );
  pane.append(bar);
  controls.add({ bar, level });
  videoZoomChanged(player.videoView.getZoom());
}
