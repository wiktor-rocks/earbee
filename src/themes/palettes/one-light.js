// One Light (Atom): blue accent (darkened a little, so the light text on it
// reads), purple loop, red errors; the light counterpart of one-dark.js. The
// loop is purple rather than One Dark's green, which sat too near the start
// point's green. https://github.com/atom/atom/tree/master/packages/one-light-syntax
/** @type {import("../index.js").Theme} */
export default {
  id: "one-light",
  name: "One Light",
  scheme: "light",
  colors: {
    bg: "#eaeaeb",
    surface: "#fafafa",
    surface2: "#f0f0f1",
    border: "#dbdbdc",
    text: "#383a42",
    muted: "#656872",
    accent: "#3a6cda",
    accentInk: "#fafafa",
    danger: "#ca1243",
    loop: "#a626a4",
    wave: "#c8c8cc",
    cursor: "#383a42",
  },
};
