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

import { isTextField } from "./shortcuts.js";

let tabbing = false; // a Tab since the last pointer press

/** @param {Document} doc */
function releaseFocus(doc) {
  const focused = /** @type {HTMLElement | null} */ (doc.activeElement);
  if (tabbing || !focused || focused === doc.body || isTextField(focused)) return;
  if (focused.closest("dialog[open], :popover-open")) return;
  focused.blur();
}

/** @param {Window} [target] The window to look after (another same-origin window can be handed in). */
export function bindFocus(target = window) {
  const doc = target.document;
  // After the click (and whatever it opened or focused) has happened.
  const releaseSoon = () => setTimeout(() => releaseFocus(doc));
  target.addEventListener("pointerdown", () => (tabbing = false), { capture: true });
  target.addEventListener("keydown", (event) => event.key === "Tab" && (tabbing = true), { capture: true });
  target.addEventListener("pointerup", releaseSoon, { capture: true });
  // Dialogs and menus give focus back to their button as they close.
  for (const dialog of doc.querySelectorAll("dialog")) dialog.addEventListener("close", releaseSoon);
  for (const popover of doc.querySelectorAll("[popover]"))
    popover.addEventListener("toggle", (/** @type {any} */ event) => event.newState === "closed" && releaseSoon());
}
