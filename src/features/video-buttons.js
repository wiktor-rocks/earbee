/* =====================================================================
 * THE VIDEO'S BUTTONS
 * Settings › Layout › The video's buttons: the zoom, the video in its own
 * window and big video (style.css, "Video controls") always shown, or
 * only while the pointer is on the picture. Marked on <html> as
 * data-video-buttons, which the CSS reads; the video's own window copies
 * it (features/video-window).
 * ===================================================================== */

import { getPrefs, onPrefsChange } from "../ui/prefs.js";

/** @param {Record<string, any>} layout Settings › Layout's values. */
const apply = (layout) => (document.documentElement.dataset.videoButtons = layout.videoButtons);

export function bindVideoButtons() {
  apply(getPrefs("layout"));
  onPrefsChange("layout", apply);
}
