/* =====================================================================
 * LAYOUT
 * The keyboard shortcuts dialog: opened by the ? button and the ? key,
 * closed by its Close button, Esc, or a click on the backdrop. The marks
 * sidebar: hidden and shown again by its button in the top bar (the
 * choice is remembered on this computer).
 * ===================================================================== */

import { dom, onClick } from "../ui/dom.js";

export function openShortcuts() {
  if (!dom.shortcutsDialog.open) dom.shortcutsDialog.showModal();
}

const SIDEBAR_KEY = "transcribee.sidebarHidden";

// Hides or shows the marks sidebar; the timeline takes its width.
function showSidebar(shown) {
  dom.sidebar.hidden = !shown;
  dom.workspace.classList.toggle("sidebar-hidden", !shown);
  dom.sidebarToggle.setAttribute("aria-pressed", String(shown));
  dom.sidebarToggle.title = shown ? "Hide the marks" : "Show the marks";
}

function bindSidebarToggle() {
  // Browser storage can be missing or refuse; then the sidebar just shows.
  try {
    showSidebar(localStorage.getItem(SIDEBAR_KEY) !== "true");
  } catch {
    showSidebar(true);
  }
  onClick(dom.sidebarToggle, () => {
    const shown = dom.sidebar.hidden;
    showSidebar(shown);
    try {
      localStorage.setItem(SIDEBAR_KEY, String(!shown));
    } catch {
      // Not remembered; it still works for this session.
    }
  });
}

export function bindLayout() {
  bindSidebarToggle();
  onClick(dom.helpButton, openShortcuts);
  onClick(dom.shortcutsClose, () => dom.shortcutsDialog.close());
  // A click on the backdrop (outside the dialog's box) closes it.
  dom.shortcutsDialog.addEventListener("click", (event) => {
    if (event.target === dom.shortcutsDialog) dom.shortcutsDialog.close();
  });
}
