/* =====================================================================
 * KEYBOARD SHORTCUTS
 * How keys reach shortcuts. The table itself (SHORTCUTS) is in app.js,
 * which knows the actions; the legend at the bottom of the window is
 * rendered from it.
 *
 *   codes   KeyboardEvent.code values (physical keys, any layout)
 *   shift   true if the shortcut is Shift + the key (optional)
 *   keys    labels for the legend, one per code
 *   down    called on key press, with the KeyboardEvent
 *   up      called on key release (optional), with the KeyboardEvent
 *   repeat  whether holding the key keeps firing `down`
 * Shortcuts only fire when a track is loaded and nothing (a load, a
 * dialog) blocks them.
 * ===================================================================== */

import { hasAudio } from "../context.js";
import { dom, element, guarded } from "./dom.js";

/**
 * @typedef {object} Shortcut
 * @property {string[]} codes
 * @property {boolean} [shift]
 * @property {string[]} keys
 * @property {string} description
 * @property {(event: KeyboardEvent) => void} down
 * @property {(event: KeyboardEvent) => void} [up]
 * @property {boolean} [repeat]
 */

// Shortcuts are plain keys or Shift + key; presses with Ctrl, Alt or Meta
// are left to the system. A release matches by key alone, so pressing
// Shift while holding a play-while-held key can't leave it playing.
function findShortcut(shortcuts, event) {
  if (event.ctrlKey || event.metaKey || event.altKey) return undefined;
  const isRelease = event.type === "keyup";
  return shortcuts.find(
    (shortcut) => shortcut.codes.includes(event.code) && (isRelease || Boolean(shortcut.shift) === event.shiftKey),
  );
}

export const isTextField = (target) =>
  target.isContentEditable ||
  target.tagName === "TEXTAREA" ||
  (target.tagName === "INPUT" && !["range", "button", "checkbox", "file"].includes(target.type));

// A slider reached with Tab keeps its arrow keys, for keyboard-only use.
// A slider that was clicked doesn't: after dragging the speed, ← / → still
// step the cursor. (:focus-visible can't tell these apart: Chromium turns
// it on for the focused element as soon as any key is pressed.)
let clickedElement = null; // last element pressed with the pointer; Tab clears it

const isKeyboardFocusedSlider = (target) =>
  target.tagName === "INPUT" && target.type === "range" && target !== clickedElement;

function handleShortcutKey(shortcuts, isBlocked, event) {
  if (isBlocked() || isTextField(event.target)) return;
  if (event.code.startsWith("Arrow") && isKeyboardFocusedSlider(event.target)) return;

  const shortcut = findShortcut(shortcuts, event);
  if (!shortcut) return;

  // Also stops e.g. Space from clicking a focused button.
  event.preventDefault();

  const handler = event.type === "keydown" ? shortcut.down : shortcut.up;
  if (!handler || !hasAudio()) return;
  if (event.type === "keydown" && event.repeat && !shortcut.repeat) return;

  guarded(handler)(event);
}

export function renderShortcutLegend(shortcuts) {
  for (const shortcut of shortcuts) {
    const item = element("li");
    if (shortcut.shift) item.append(element("kbd", {}, "Shift"), "+");
    shortcut.keys.forEach((key, i) => {
      if (i > 0) item.append("/");
      item.append(element("kbd", {}, key));
    });
    item.append(shortcut.description);
    dom.shortcutList.append(item);
  }
}

/**
 * Starts listening for `shortcuts`; while isBlocked() is true, keys are left alone.
 * @param {Shortcut[]} shortcuts
 * @param {() => boolean} isBlocked
 */
export function bindShortcuts(shortcuts, isBlocked) {
  const handle = (event) => handleShortcutKey(shortcuts, isBlocked, event);
  window.addEventListener("pointerdown", (event) => (clickedElement = event.target), { capture: true });
  window.addEventListener("keydown", (event) => event.key === "Tab" && (clickedElement = null), { capture: true });
  window.addEventListener("keydown", handle);
  window.addEventListener("keyup", handle);
}
