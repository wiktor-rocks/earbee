/* =====================================================================
 * THE SIDE PANEL'S SIDE
 * Settings › Layout › The side panel: on the right of the stage and the
 * transport, or on the left. Marked on <html> as data-panel-side, which
 * the CSS reads (style.css, the workspace's grid in section 5).
 * ===================================================================== */

import { getPrefs, onPrefsChange } from "../ui/prefs.js";

/** @param {Record<string, any>} layout Settings › Layout's values. */
const apply = (layout) => (document.documentElement.dataset.panelSide = layout.panelSide);

export function bindPanelSide() {
  apply(getPrefs("layout"));
  onPrefsChange("layout", apply);
}
