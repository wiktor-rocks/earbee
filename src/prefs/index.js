// Every settings section, in the order the Settings dialog lists them.
// A new section: a file in sections/ (see fields.js for the format),
// listed here. The unit tests check every section's declaration.
import { normalizeAll } from "./fields.js";
import downloads from "./sections/downloads.js";
import theme from "./sections/theme.js";
import waveform from "./sections/waveform.js";

/** @type {import("./fields.js").Section[]} */
export const SECTIONS = [theme, waveform, downloads];

/** @param {string} id */
export const getSection = (id) => SECTIONS.find((section) => section.id === id);

/** Every section's values from what was stored (anything; invalid parts become defaults). */
export const normalizePrefsFile = (stored) => normalizeAll(SECTIONS, stored);

export { PrefsError, defaultsOf, isVisible, resetValue, setValue } from "./fields.js";
