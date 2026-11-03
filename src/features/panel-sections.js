/* =====================================================================
 * THE SIDE PANEL'S SECTIONS, SHOWN OR HIDDEN
 * Settings › Layout › Hide in the side panel: the sections ticked there
 * (Speed, Pitch, Mixer, EQ, Beats, Points, Loop, Marks) are put away,
 * with the `hidden` attribute, on the elements panel-order.js moves
 * about: each .<key>-group, and #sidebar for the marks. Their shortcuts
 * still work. panel-order.js skips hidden sections, and a dock whose
 * sections are all hidden takes no room (style.css, "Panel order").
 * ===================================================================== */

import { getSection } from "../prefs/index.js";
import { $ } from "../ui/dom.js";
import { getPrefs, onPrefsChange } from "../ui/prefs.js";

// The sections' keys: the setting's options (src/prefs/index.js).
const KEYS = getSection("layout")
  .fields.find((field) => field.key === "hiddenSections")
  .options.map((option) => String(option.value));

/** @param {string} key */
const sectionOf = (key) => (key === "marks" ? $("sidebar") : $("panel").querySelector(`.${key}-group`));

/** @param {Record<string, any>} layout Settings › Layout's values. */
function apply(layout) {
  for (const key of KEYS) {
    const section = /** @type {HTMLElement | null} */ (sectionOf(key));
    if (section) section.hidden = layout.hiddenSections.includes(key);
  }
}

export function bindPanelSections() {
  apply(getPrefs("layout"));
  onPrefsChange("layout", apply);
}
