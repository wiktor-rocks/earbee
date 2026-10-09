/* =====================================================================
 * LAYOUT
 * The parts of the player's layout that open and close: the keyboard
 * shortcuts dialog (the ? button and key) and, in a narrow window, the
 * marks sidebar, which then slides over the timeline as a drawer (the
 * toggle in the top bar; style.css decides when the window is narrow).
 * ===================================================================== */

import { dom, onClick } from "../ui/dom.js";

export function openShortcuts() {
  if (!dom.shortcutsDialog.open) dom.shortcutsDialog.showModal();
}

/** @param {boolean} open */
function setSidebarOpen(open) {
  dom.app.classList.toggle("sidebar-open", open);
  dom.sidebarToggle.setAttribute("aria-expanded", String(open));
}

export function bindLayout() {
  onClick(dom.helpButton, openShortcuts);
  onClick(dom.shortcutsClose, () => dom.shortcutsDialog.close());
  // A click on the backdrop (outside the dialog's box) closes it.
  dom.shortcutsDialog.addEventListener("click", (event) => {
    if (event.target === dom.shortcutsDialog) dom.shortcutsDialog.close();
  });

  onClick(dom.sidebarToggle, () => setSidebarOpen(!dom.app.classList.contains("sidebar-open")));
  // The drawer closes on Escape or a press outside it (not on the toggle,
  // which closes it itself).
  window.addEventListener("keydown", (event) => event.key === "Escape" && setSidebarOpen(false));
  document.addEventListener("pointerdown", (event) => {
    const target = /** @type {Node} */ (event.target);
    if (
      dom.app.classList.contains("sidebar-open") &&
      !dom.sidebar.contains(target) &&
      !dom.sidebarToggle.contains(target)
    )
      setSidebarOpen(false);
  });
}
