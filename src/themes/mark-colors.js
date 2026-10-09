// The colours a mark on the waveform can have (see src/marks). Unlike a
// theme's roles they're the same in every theme, with one shade for dark
// themes and one for light ones; cssVariables() sets them as --mark-<id>.
// The unit tests check each is visible on every theme.

/** @typedef {{ id: string, name: string, dark: string, light: string }} MarkColor */

/** @type {MarkColor[]} */
export const MARK_COLORS = [
  { id: "rose", name: "Rose", dark: "#ff7aa2", light: "#c2185b" },
  { id: "orange", name: "Orange", dark: "#ff9f43", light: "#b35400" },
  { id: "green", name: "Green", dark: "#5fd38d", light: "#2e7d32" },
  { id: "blue", name: "Blue", dark: "#6ea8ff", light: "#1f5fbf" },
  { id: "violet", name: "Violet", dark: "#b88cff", light: "#7b3fbf" },
  { id: "grey", name: "Grey", dark: "#aab2c0", light: "#5f6673" },
];

export const DEFAULT_MARK_COLOR = MARK_COLORS[0].id;

/** @param {string} id */
export const markColorVariable = (id) => `--mark-${id}`;
