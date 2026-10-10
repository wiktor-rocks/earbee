/* =====================================================================
 * VIDEO WINDOW: ITS PAGE
 * Fills the empty window that index.js opened: this page's stylesheets
 * and colour theme, a pane and canvas for the video view to draw in, and
 * controls that show while the pointer moves over the picture (the time,
 * "always on top" when the app can, Bring back). The window runs no code
 * of its own; everything here runs in the main page.
 * ===================================================================== */

import { formatTrackTime } from "../../core/format.js";
import { element, onClick } from "../../ui/dom.js";
import { onThemeChange } from "../../ui/theme.js";

const IDLE_MS = 2000; // the controls and the pointer hide after this long still

const SVG = "http://www.w3.org/2000/svg";

// The feature's icons (16 × 16, stroked like the sprite's in index.html).
export const ICONS = {
  popOut: "M9 2.8h4.2V7M13 3 7.5 8.5M11.5 9.5v3.2c0 .3-.2.5-.5.5H3.3a.5.5 0 0 1-.5-.5V5c0-.3.2-.5.5-.5h3.2",
  bringBack: "M7.2 3.2H3.3a.5.5 0 0 0-.5.5v9c0 .3.2.5.5.5h9.4c.3 0 .5-.2.5-.5V8.8M13 3 7.8 8.2M7.6 4.6v3.8h3.8",
  pin: "M5.8 2.6h4.4M7 2.6v3.6L4.6 8.8h6.8L9 6.2V2.6M8 8.8v4.6",
};

/** @param {string} path */
export function icon(path) {
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
export function buildVideoWindow(win, { onBringBack }) {
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
  const api = /** @type {any} */ (window).transcribee?.videoWindow;
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
