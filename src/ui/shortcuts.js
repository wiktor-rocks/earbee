/* =====================================================================
 * KEYBOARD SHORTCUTS
 * How keys reach shortcuts. The table itself (SHORTCUTS) is in app.js,
 * which knows the actions; the shortcuts dialog (the ? button or key)
 * lists it, by group.
 *
 *   group   the heading it's listed under ("Playback", "Marks", …)
 *   codes   KeyboardEvent.code values (physical keys, any layout)
 *   ctrl    true if the shortcut is Ctrl (Cmd on a Mac) + the key (optional);
 *           these also work in text fields
 *   shift   true if the shortcut is Shift + the key (optional)
 *   keys    labels for the shortcuts dialog, one per code
 *   description  what it does, for the shortcuts dialog
 *   down    called on key press, with the KeyboardEvent
 *   up      called on key release (optional), with the KeyboardEvent
 *   repeat  whether holding the key keeps firing `down`
 *   anytime true if it works before a track is loaded (optional)
 * Shortcuts only fire when a track is loaded (unless `anytime`) and
 * nothing (a load, a dialog) blocks them.
 * ===================================================================== */

import { hasAudio } from "../context.js";
import { dom, element, guarded } from "./dom.js";

/**
 * @typedef {object} Shortcut
 * @property {string} group
 * @property {string[]} codes
 * @property {boolean} [ctrl]
 * @property {boolean} [shift]
 * @property {boolean} [anytime]
 * @property {string[]} keys
 * @property {string} description
 * @property {(event: KeyboardEvent) => void} down
 * @property {(event: KeyboardEvent) => void} [up]
 * @property {boolean} [repeat]
 */

// Shortcuts are plain keys, Shift + key, Ctrl + key or Ctrl + Shift + key
// (Cmd for Ctrl on a Mac); other presses with Ctrl, and any with Alt, are
// left to the system. A release matches by key alone, so pressing Shift
// while holding a play-while-held key can't leave it playing.
function findShortcut(shortcuts, event) {
  if (event.altKey) return undefined;
  const ctrl = event.ctrlKey || event.metaKey;
  const isRelease = event.type === "keyup";
  return shortcuts.find(
    (shortcut) =>
      shortcut.codes.includes(event.code) &&
      (isRelease || (Boolean(shortcut.ctrl) === ctrl && Boolean(shortcut.shift) === event.shiftKey)),
  );
}

export const isTextField = (target) =>
  target.isContentEditable ||
  target.tagName === "TEXTAREA" ||
  (target.tagName === "INPUT" && !["range", "button", "checkbox", "file"].includes(target.type));

// A slider reached with Tab keeps its arrow keys, for keyboard-only use.
// A slider that was clicked doesn't: after dragging the speed, ← / → still
// step the cursor. (:focus-visible can't tell these apart: Chromium turns
// it on for the focused element as soon as any key is pressed.) Each
// window bound keeps its own clickedElement (see bindShortcuts).
const isKeyboardFocusedSlider = (target, clickedElement) =>
  target.tagName === "INPUT" && target.type === "range" && target !== clickedElement;

function handleShortcutKey(shortcuts, isBlocked, event, clickedElement) {
  if (isBlocked()) return;
  if (event.code.startsWith("Arrow") && isKeyboardFocusedSlider(event.target, clickedElement)) return;

  const shortcut = findShortcut(shortcuts, event);
  if (!shortcut || (isTextField(event.target) && !shortcut.ctrl)) return;

  // Also stops e.g. Space from clicking a focused button.
  event.preventDefault();

  const handler = event.type === "keydown" ? shortcut.down : shortcut.up;
  if (!handler || !(hasAudio() || shortcut.anytime)) return;
  if (event.type === "keydown" && event.repeat && !shortcut.repeat) return;

  guarded(handler)(event);
}

// The list in the shortcuts dialog: one section per group, in the order
// the groups first appear in the table.
export function renderShortcutLegend(shortcuts) {
  const lists = new Map();
  for (const shortcut of shortcuts) {
    if (!lists.has(shortcut.group)) {
      const list = element("ul", { className: "shortcut-list" });
      lists.set(shortcut.group, list);
      dom.shortcutList.append(
        element("section", { className: "shortcut-group" }, element("h3", {}, shortcut.group), list),
      );
    }
    const keys = element("span", { className: "shortcut-keys" });
    if (shortcut.ctrl) keys.append(element("kbd", {}, "Ctrl"), "+");
    if (shortcut.shift) keys.append(element("kbd", {}, "Shift"), "+");
    shortcut.keys.forEach((key, i) => {
      if (i > 0) keys.append("/");
      keys.append(element("kbd", {}, key));
    });
    lists.get(shortcut.group).append(element("li", {}, keys, shortcut.description));
  }
}

/**
 * Starts listening for `shortcuts`; while isBlocked() is true, keys are left alone.
 * @param {Shortcut[]} shortcuts
 * @param {() => boolean} isBlocked
 * @param {Window} [target] The window whose keys these are (another same-origin window can share them).
 */
export function bindShortcuts(shortcuts, isBlocked, target = window) {
  let clickedElement = null; // last element pressed with the pointer here; Tab clears it
  const handle = (event) => handleShortcutKey(shortcuts, isBlocked, event, clickedElement);
  target.addEventListener("pointerdown", (event) => (clickedElement = event.target), { capture: true });
  target.addEventListener("keydown", (event) => event.key === "Tab" && (clickedElement = null), { capture: true });
  target.addEventListener("keydown", handle);
  target.addEventListener("keyup", handle);
}

/* =====================================================================
 * FOCUS
 * Keys shouldn't light up buttons. A button, slider or chip clicked with
 * the pointer gives its focus back at once, so later keys (Space, the
 * arrows) go to the shortcuts and no focus ring appears on it; so does
 * the button a dialog or menu hands focus back to when it closes. Text
 * fields keep their focus (typing goes there), and so do controls inside
 * an open dialog or menu.
 *
 * Someone moving around with Tab keeps everything as it is: after a Tab,
 * focus is left alone until the next pointer press.
 * ===================================================================== */

/** @param {Document} doc @param {boolean} tabbing */
function releaseFocus(doc, tabbing) {
  const focused = /** @type {HTMLElement | null} */ (doc.activeElement);
  if (tabbing || !focused || focused === doc.body || isTextField(focused)) return;
  if (focused.closest("dialog[open], :popover-open")) return;
  focused.blur();
}

/** @param {Window} [target] The window to look after (another same-origin window can be handed in). */
export function bindFocus(target = window) {
  const doc = target.document;
  let tabbing = false; // a Tab in this window since its last pointer press
  // After the click (and whatever it opened or focused) has happened.
  const releaseSoon = () => setTimeout(() => releaseFocus(doc, tabbing));
  target.addEventListener("pointerdown", () => (tabbing = false), { capture: true });
  target.addEventListener("keydown", (event) => event.key === "Tab" && (tabbing = true), { capture: true });
  target.addEventListener("pointerup", releaseSoon, { capture: true });
  // Dialogs and menus give focus back to their button as they close.
  for (const dialog of doc.querySelectorAll("dialog")) dialog.addEventListener("close", releaseSoon);
  for (const popover of doc.querySelectorAll("[popover]"))
    popover.addEventListener("toggle", (/** @type {any} */ event) => event.newState === "closed" && releaseSoon());
}
