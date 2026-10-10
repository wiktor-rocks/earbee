// TranscriBee Light: the app's own theme for light mode, amber on honey
// paper, the light counterpart of transcribee.js. The amber is the dark
// theme's own yellow, so the brand colour is the same in both (it's soft on
// the pale panels; tests/unit/themes.test.mjs exempts it from the 3:1 check).
/** @type {import("../index.js").Theme} */
export default {
  id: "transcribee-light",
  name: "TranscriBee Light",
  scheme: "light",
  colors: {
    bg: "#f5f1e8",
    surface: "#fffcf5",
    surface2: "#efe9dc",
    surfaceHover: "#e7e0d1",
    border: "#ddd3bf",
    text: "#1f1b14",
    muted: "#6b6252",
    accent: "#f5b301",
    accentHover: "#ffc52e",
    accentInk: "#1a1400",
    danger: "#c0392b",
    loop: "#0b7fa8",
    wave: "#d3c8b2",
    cursor: "#1f1b14",
  },
};
