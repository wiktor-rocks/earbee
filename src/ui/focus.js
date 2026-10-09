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

function releaseFocus() {
  const focused = /** @type {HTMLElement | null} */ (document.activeElement);
  if (tabbing || !focused || focused === document.body || isTextField(focused)) return;
  if (focused.closest("dialog[open], :popover-open")) return;
  focused.blur();
}

// After the click (and whatever it opened or focused) has happened.
const releaseSoon = () => setTimeout(releaseFocus);

export function bindFocus() {
  window.addEventListener("pointerdown", () => (tabbing = false), { capture: true });
  window.addEventListener("keydown", (event) => event.key === "Tab" && (tabbing = true), { capture: true });
  window.addEventListener("pointerup", releaseSoon, { capture: true });
  // Dialogs and menus give focus back to their button as they close.
  for (const dialog of document.querySelectorAll("dialog")) dialog.addEventListener("close", releaseSoon);
  for (const popover of document.querySelectorAll("[popover]"))
    popover.addEventListener("toggle", (/** @type {any} */ event) => event.newState === "closed" && releaseSoon());
}
