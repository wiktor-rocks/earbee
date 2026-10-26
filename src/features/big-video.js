/* =====================================================================
 * BIG VIDEO
 * The picture as the largest thing in the window, short of fullscreen,
 * edge to edge: the top bar, the marks sidebar, the sound dock, the
 * minimap and the timeline's lanes go, leaving a thin waveform strip with
 * the whole track (like a video player's timeline: click or drag to seek,
 * no zooming) and the transport.
 *
 *   On / off   F, the button over the picture (on hover), or a
 *              double-click on the picture; Esc leaves it. It lasts while videos follow
 *              one another; an audio file or a restart ends it. Leaving
 *              it gives the waveform its zoom back, on what is playing.
 *   How        One class on #app, while big video is on and a video is on
 *              the stage (.stage.has-video): with the video in its own
 *              window the layout is the usual one, and bringing it back
 *              makes it big again. style.css ("Big video") lays out the
 *              rest. The picture and the waveform follow their new sizes
 *              by themselves (their ResizeObservers); the waveform is held
 *              at fit to width (waveform.lockFit).
 *
 * Removing it means deleting this file, its section in style.css and the
 * lines marked "Big video (".
 * ===================================================================== */

import { player } from "../context.js";
import { $, dom, element, onClick } from "../ui/dom.js";

const stage = $("stage");
const pane = $("videoPane");

let on = false;
/** @type {HTMLButtonElement} */
let button;

// The waveform keeps the user's view as seconds in view, measured on its
// width: so it is locked before the big layout widens it, and unlocked
// after the usual layout is back.
function render() {
  const shown = on && stage.classList.contains("has-video");
  if (shown) player.waveform.lockFit(true);
  dom.app.classList.toggle("big-video", shown);
  if (!shown) player.waveform.lockFit(false);
  button.setAttribute("aria-pressed", String(on));
  button.title = on ? "Back to normal (F or Esc)" : "Big video (F)";
  button.ariaLabel = on ? "Back to normal" : "Big video";
  button.querySelector("use")?.setAttribute("href", on ? "#i-shrink" : "#i-enlarge");
}

/** F: the picture big, or back. Only while a video is on the stage. */
export function toggleBigVideo() {
  if (!on && !stage.classList.contains("has-video")) return;
  on = !on;
  render();
}

/**
 * Esc: back to the usual layout, if the picture is big now. Returns
 * whether it was (so Esc does nothing else).
 */
export function leaveBigVideo() {
  if (!dom.app.classList.contains("big-video")) return false;
  on = false;
  render();
  return true;
}

/**
 * The video view's picture appeared or went; called from its
 * onVisibilityChange. When it goes (an audio file), so does big video.
 * @param {boolean} visible
 */
export function bigVideoPictureChanged(visible) {
  if (visible || !on) return;
  on = false;
  render();
}

export function bindBigVideo() {
  button = element("button", { type: "button", className: "icon-button small big-video-button" });
  button.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#i-enlarge" /></svg>`;
  onClick(button, toggleBigVideo);
  pane.append(button);
  // has-video comes and goes with the video window (and with a video).
  new MutationObserver(render).observe(stage, { attributes: true, attributeFilter: ["class"] });
  // A double-click on the picture, not on its buttons.
  pane.addEventListener("dblclick", (event) => {
    if (!(event.target instanceof Element && event.target.closest("button"))) toggleBigVideo();
  });
  render();
}
