/* =====================================================================
 * VIDEO WINDOW
 * The video's picture in a window of its own (on a second screen, or
 * small beside an editor), while the main window shows the full-height
 * timeline as for an audio file, with a strip that brings it back.
 *
 *   Out        The button over the video (on hover) or V. The choice is
 *              remembered on this computer: the next video, also after a
 *              restart, opens in the window too. An audio file closes the
 *              window; the next video reopens it.
 *   Back       The strip's button, the window's own Bring back, V, or
 *              closing the window; the next video stays in the main window.
 *   How        The window is an empty same-origin page (window.open), so
 *              it shares this page's process: the video view simply draws
 *              into a canvas there (videoView.attach). Nothing is decoded
 *              twice and the picture stays frame-exact. Electron allows
 *              this one window only and remembers its size, position and
 *              "always on top" (electron/video-window.js); its page is
 *              built in popup.js.
 *   Hidden     The transport's frames come from the main window's
 *              animation frames, which stop while it is minimised (or
 *              covered, on some systems). Meanwhile the video window's own
 *              frames keep the picture moving.
 *
 * Self-contained: removing it means deleting this folder and
 * electron/video-window.js, then the lines marked "Video window (" (see
 * CHANGELOG.md).
 * ===================================================================== */

import { player } from "../../context.js";
import { $, dom, element, onClick, showNotice } from "../../ui/dom.js";
import { ICONS, buildVideoWindow, icon } from "./popup.js";

const POPPED_KEY = "transcribee.videoPopped";
const WINDOW_NAME = "transcribee-video"; // the one electron/video-window.js allows

const stage = $("stage");
const docked = {
  pane: $("videoPane"),
  canvas: /** @type {HTMLCanvasElement} */ ($("videoCanvas")),
};

/** @type {import("./popup.js").VideoWindow | null} */
let popup = null;
let showing = false; // a picture is on screen (here or in the window)
let wantOut = readWantOut();
let leaving = false; // this page is closing; the window goes with it, the choice stays
/** @type {(win: Window) => void} */
let bindKeys = () => {};
/** @type {HTMLElement} */
let strip;

// Browser storage can be missing or refuse; then the video starts here.
function readWantOut() {
  try {
    return localStorage.getItem(POPPED_KEY) === "true";
  } catch {
    return false;
  }
}

function setWantOut(out) {
  wantOut = out;
  try {
    localStorage.setItem(POPPED_KEY, String(out));
  } catch {
    // Not remembered; it still works for this session.
  }
}

/* ---------- Out and back ---------- */

function popOut() {
  if (popup || !showing) return;
  const win = window.open("", WINDOW_NAME);
  if (!win) {
    setWantOut(false);
    showNotice("The video window couldn't be opened, so the video stays here.");
    return;
  }
  popup = buildVideoWindow(win, { onBringBack: bringBack });
  popup.setTitle(windowTitle());
  popup.setTime(player.transport.position);
  // Closed by the user (or reloaded): the video comes back.
  win.addEventListener("pagehide", () => !leaving && popup?.window === win && bringBack());
  player.videoView.attach(popup.surface);
  bindKeys(win);
  followWhileHidden(popup);
  render();
}

function closeWindow() {
  if (!popup) return;
  const { window: win } = popup;
  popup.dispose();
  popup = null;
  player.videoView.attach(docked);
  if (!win.closed) win.close();
  render();
}

function bringBack() {
  setWantOut(false);
  closeWindow();
}

/** V: the video out to its window, or back. */
export function toggleVideoWindow() {
  if (!showing) return;
  if (popup) {
    bringBack();
  } else {
    setWantOut(true);
    popOut();
  }
}

/**
 * The video view's picture appeared or went (a video or an audio file
 * opened); called from its onVisibilityChange.
 * @param {boolean} visible
 */
export function videoPictureChanged(visible) {
  showing = visible;
  if (visible && wantOut) popOut();
  else if (!visible) closeWindow(); // the choice stays for the next video
  render();
}

/* ---------- The main window ---------- */

// While the video is out, the stage is laid out as for an audio file
// (app.js sets has-video; it is taken off here), with the strip on top.
function render() {
  const out = showing && popup !== null;
  stage.classList.toggle("video-popped", out);
  if (showing) stage.classList.toggle("has-video", !out);
  strip.hidden = !out;
}

const windowTitle = () => `${dom.fileName.textContent} — Video`;

function buildMarkup() {
  const popButton = element(
    "button",
    {
      type: "button",
      className: "icon-button small video-popout-button",
      title: "Video in its own window (V)",
      ariaLabel: "Video in its own window",
    },
    icon(ICONS.popOut),
  );
  onClick(popButton, toggleVideoWindow);
  docked.pane.append(popButton);

  const back = element("button", { type: "button", className: "small" }, icon(ICONS.bringBack), "Bring back");
  onClick(back, bringBack);
  strip = element(
    "div",
    { className: "video-away", hidden: true },
    icon(ICONS.popOut),
    element("span", {}, "The video is in its own window"),
    back,
  );
  stage.prepend(strip);
}

/* ---------- Keeping up ---------- */

// While this window is hidden its animation frames stop, and with them the
// transport's position events; the video window's frames take over.
/** @param {import("./popup.js").VideoWindow} own */
function followWhileHidden(own) {
  let last = null;
  const tick = () => {
    if (popup !== own) return;
    own.window.requestAnimationFrame(tick);
    const { transport, videoView } = player;
    if (!document.hidden || !transport.playing) {
      last = null;
      return;
    }
    const position = transport.position;
    // A loop going round is a jump for the picture (as the transport's own
    // frames would report it).
    if (last !== null && position < last - 0.001) videoView.start(position);
    else videoView.advance(position);
    last = position;
    own.setTime(position);
  };
  own.window.requestAnimationFrame(tick);
}

/**
 * @param {object} options
 * @param {(win: Window) => void} options.bindKeys Gives a window this page's keyboard shortcuts.
 */
export function bindVideoWindow(options) {
  bindKeys = options.bindKeys;
  buildMarkup();
  render();

  const { transport } = player;
  const showTime = () => popup?.setTime(transport.position);
  transport.on("position", (time) => popup?.setTime(time));
  transport.on("jump", showTime);
  transport.on("state", showTime);
  // The window's title names the open file.
  new MutationObserver(() => popup?.setTitle(windowTitle())).observe(dom.fileName, {
    childList: true,
    characterData: true,
    subtree: true,
  });
  window.addEventListener("pagehide", () => {
    leaving = true;
    closeWindow();
  });
}
