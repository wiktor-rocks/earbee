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
 *              "always on top" (electron/windows.js); its page is
 *              built below (buildVideoWindow).
 *   Hidden     The transport's frames come from the main window's
 *              animation frames, which stop while it is minimised (or
 *              covered, on some systems). Meanwhile the video window's own
 *              frames keep the picture moving.
 *
 * Self-contained: removing it means deleting this folder and the video
 * window's part of electron/windows.js, then the lines marked "Video
 * window (" (see CHANGELOG.md).
 * ===================================================================== */

import { player } from "../../context.js";
import { formatTrackTime } from "../../core/format.js";
import { $, dom, element, onClick, showNotice } from "../../ui/dom.js";
import { readStored, store } from "../../ui/storage.js";
import { onThemeChange } from "../../ui/theme.js";

/* ---------- The video window's page ----------
 * Fills the empty window that this feature opens: this page's stylesheets
 * and colour theme, a pane and canvas for the video view to draw in, and
 * controls that show while the pointer moves over the picture (the time,
 * "always on top" when the app can, Bring back). The window runs no code
 * of its own; everything here runs in the main page.
 */

const IDLE_MS = 2000; // the controls and the pointer hide after this long still

const SVG = "http://www.w3.org/2000/svg";

// The feature's icons (16 × 16, stroked like the sprite's in index.html).
const ICONS = {
  popOut: "M9 2.8h4.2V7M13 3 7.5 8.5M11.5 9.5v3.2c0 .3-.2.5-.5.5H3.3a.5.5 0 0 1-.5-.5V5c0-.3.2-.5.5-.5h3.2",
  bringBack: "M7.2 3.2H3.3a.5.5 0 0 0-.5.5v9c0 .3.2.5.5.5h9.4c.3 0 .5-.2.5-.5V8.8M13 3 7.8 8.2M7.6 4.6v3.8h3.8",
  pin: "M5.8 2.6h4.4M7 2.6v3.6L4.6 8.8h6.8L9 6.2V2.6M8 8.8v4.6",
};

/** @param {string} path */
function icon(path) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  const shape = document.createElementNS(SVG, "path");
  for (const [name, value] of Object.entries({
    d: path,
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.4",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  }))
    shape.setAttribute(name, value);
  svg.append(shape);
  return svg;
}

/**
 * Builds the video window's page in `win` (empty, same-origin).
 * @param {Window} win
 * @param {{ onBringBack: () => void }} options
 */
function buildVideoWindow(win, { onBringBack }) {
  const doc = win.document;

  // The same stylesheets (absolute URLs) and theme colours as this page.
  for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
    doc.head.append(element("link", { rel: "stylesheet", href: /** @type {HTMLLinkElement} */ (link).href }));
  }
  const followTheme = () => {
    doc.documentElement.style.cssText = document.documentElement.style.cssText;
    doc.documentElement.dataset.theme = document.documentElement.dataset.theme ?? "";
  };
  followTheme();
  const stopFollowingTheme = onThemeChange(followTheme);
  doc.documentElement.lang = document.documentElement.lang;

  const canvas = element("canvas", { ariaLabel: "Video" });
  const pane = element("div", { className: "video-pane" }, canvas);

  const time = element("span", { className: "video-window-time" });
  const back = element(
    "button",
    { type: "button", className: "small", title: "Bring the video back to the main window (V)" },
    icon(ICONS.bringBack),
    "Bring back",
  );
  onClick(back, onBringBack);
  const controls = element("div", { className: "video-window-controls" }, time);

  // "Always on top" needs the app (a browser can't do it).
  const api = /** @type {any} */ (window).earbee?.videoWindow;
  if (api) {
    const pin = element(
      "button",
      { type: "button", className: "small icon-only", title: "Keep this window on top", ariaLabel: "Keep on top" },
      icon(ICONS.pin),
    );
    const showPinned = (on) => pin.setAttribute("aria-pressed", String(on === true));
    showPinned(false);
    api.alwaysOnTop().then(showPinned);
    onClick(pin, async () => showPinned(await api.setAlwaysOnTop(pin.getAttribute("aria-pressed") !== "true")));
    controls.append(pin);
  }
  controls.append(back);

  doc.body.className = "video-window";
  doc.body.append(pane, controls);

  // The controls (and the pointer) show while it moves, and stay while it
  // is over them.
  let idleTimer;
  const wake = () => {
    doc.body.classList.add("awake");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function sleep() {
      if (controls.matches(":hover")) idleTimer = setTimeout(sleep, IDLE_MS);
      else doc.body.classList.remove("awake");
    }, IDLE_MS);
  };
  doc.addEventListener("pointermove", wake);
  doc.documentElement.addEventListener("pointerleave", () => doc.body.classList.remove("awake"));

  return {
    window: win,
    surface: { pane, canvas },
    /** @param {number} position */
    setTime(position) {
      const shown = formatTrackTime(position);
      if (time.textContent !== shown) time.textContent = shown;
    },
    /** @param {string} title */
    setTitle(title) {
      doc.title = title;
    },
    dispose() {
      stopFollowingTheme();
      clearTimeout(idleTimer);
    },
  };
}

/** @typedef {ReturnType<typeof buildVideoWindow>} VideoWindow */

/* ---------- Popping out and back ---------- */

const POPPED_KEY = "earbee.videoPopped";
const OLD_POPPED_KEY = "scribee.videoPopped"; // the app's old name (ScriBee, until 0.1.1)
const WINDOW_NAME = "earbee-video"; // the one electron/windows.js allows

const stage = $("stage");
const docked = {
  pane: $("videoPane"),
  canvas: /** @type {HTMLCanvasElement} */ ($("videoCanvas")),
};

/** @type {VideoWindow | null} */
let popup = null;
let showing = false; // a picture is on screen (here or in the window)
let wantOut = readWantOut();
let leaving = false; // this page is closing; the window goes with it, the choice stays
/** @type {(win: Window) => void} */
let bindKeys = () => {};
/** @type {HTMLElement} */
let strip;

// Without browser storage the video starts here.
function readWantOut() {
  return (readStored(POPPED_KEY) ?? readStored(OLD_POPPED_KEY)) === "true";
}

function setWantOut(out) {
  wantOut = out;
  store(POPPED_KEY, String(out));
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
/** @param {VideoWindow} own */
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
