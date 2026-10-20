/* =====================================================================
 * LAYOUT
 * The keyboard shortcuts dialog: opened by the ? button and the ? key,
 * closed by its Close button, Esc, or a click on the backdrop. The marks
 * sidebar: hidden and shown again by its button in the top bar (the
 * choice is remembered on this computer). Where the player's controls are
 * (Settings › General: the transport, and speed, pitch, volume and EQ):
 * each floating on the waveform, solid around it, or in a bar.
 * ===================================================================== */

import { dom, onClick } from "../ui/dom.js";
import { getPrefs, onPrefsChange } from "../ui/prefs.js";
import { readStored, store } from "../ui/storage.js";

export function openShortcuts() {
  if (!dom.shortcutsDialog.open) dom.shortcutsDialog.showModal();
}

const SIDEBAR_KEY = "earbee.sidebarHidden";
const OLD_SIDEBAR_KEY = "scribee.sidebarHidden"; // the app's old name (ScriBee, until 0.1.1)

// Hides or shows the marks sidebar; the timeline takes its width.
function showSidebar(shown) {
  dom.sidebar.hidden = !shown;
  dom.workspace.classList.toggle("sidebar-hidden", !shown);
  dom.sidebarToggle.setAttribute("aria-pressed", String(shown));
  dom.sidebarToggle.title = shown ? "Hide the marks" : "Show the marks";
}

function bindSidebarToggle() {
  // Without browser storage the sidebar just shows.
  showSidebar((readStored(SIDEBAR_KEY) ?? readStored(OLD_SIDEBAR_KEY)) !== "true");
  onClick(dom.sidebarToggle, () => {
    const shown = dom.sidebar.hidden;
    showSidebar(shown);
    store(SIDEBAR_KEY, String(!shown));
  });
}

// The controls are the same elements wherever they are, moved:
//   waveform  floating over the waveform (in .timeline-wave);
//   solid     the transport, message and chips in a strip at the top of
//             the timeline's card (under the minimap, above the ruler),
//             the dock in a strip at its bottom; the waveform between
//             them gets smaller;
//   bar       the transport strip in a bar under the stage, the dock
//             along the bottom of the window.
// style.css lays out each place (.transport-solid, .transport-in-bar,
// .dock-solid, .dock-in-bar on #app).
function placeControls() {
  const prefs = getPrefs("general");
  const transport = prefs?.transport ?? "waveform";
  const dock = prefs?.dock ?? "waveform";
  for (const where of ["solid", "bar"]) {
    dom.app.classList.toggle(`transport-${where === "bar" ? "in-bar" : where}`, transport === where);
    dom.app.classList.toggle(`dock-${where === "bar" ? "in-bar" : where}`, dock === where);
  }

  const parts = [dom.transportGroup, dom.messageBox, dom.pointChips];
  dom.transportBar.hidden = transport === "waveform";
  if (transport === "waveform") dom.waveOverlays.append(...parts);
  else {
    dom.transportBar.append(...parts);
    if (transport === "solid") dom.timeline.prepend(dom.transportBar);
    else dom.workspace.insertBefore(dom.transportBar, dom.sidebar);
  }

  if (dock === "solid") dom.timeline.append(dom.soundDock);
  else if (dock === "bar") dom.app.append(dom.soundDock);
  else dom.waveOverlays.append(dom.soundDock);
}

export function bindLayout() {
  placeControls();
  onPrefsChange("general", placeControls);
  bindSidebarToggle();
  onClick(dom.helpButton, openShortcuts);
  onClick(dom.shortcutsClose, () => dom.shortcutsDialog.close());
  // A click on the backdrop (outside the dialog's box) closes it.
  dom.shortcutsDialog.addEventListener("click", (event) => {
    if (event.target === dom.shortcutsDialog) dom.shortcutsDialog.close();
  });
}
