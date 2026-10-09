/* =====================================================================
 * LAYOUT
 * The keyboard shortcuts dialog: opened by the ? button and the ? key,
 * closed by its Close button, Esc, or a click on the backdrop.
 * ===================================================================== */

import { dom, onClick } from "../ui/dom.js";

export function openShortcuts() {
  if (!dom.shortcutsDialog.open) dom.shortcutsDialog.showModal();
}

export function bindLayout() {
  onClick(dom.helpButton, openShortcuts);
  onClick(dom.shortcutsClose, () => dom.shortcutsDialog.close());
  // A click on the backdrop (outside the dialog's box) closes it.
  dom.shortcutsDialog.addEventListener("click", (event) => {
    if (event.target === dom.shortcutsDialog) dom.shortcutsDialog.close();
  });
}
