// Nord: Polar Night backgrounds, Frost accent, Aurora yellow loop (green
// is too close to Frost) and a lightened Aurora red for errors. The stop
// point gets a stronger red than the errors' (too close to the yellow loop). https://www.nordtheme.com/docs/colors-and-palettes
/** @type {import("../index.js").Theme} */
export default {
  id: "nord",
  name: "Nord",
  scheme: "dark",
  colors: {
    bg: "#2e3440",
    surface: "#3b4252",
    surface2: "#434c5e",
    border: "#4c566a",
    text: "#eceff4",
    muted: "#c0c8d8",
    accent: "#88c0d0",
    accentInk: "#2e3440",
    danger: "#e99aa1",
    loop: "#ebcb8b",
    wave: "#5b6680",
    cursor: "#eceff4",
    stop: "#ff7b85",
  },
};
