// TranscriBee: the app's own dark theme, amber on graphite.
// style.css :root holds the same values as the fallback (a unit test keeps
// them equal).
/** @type {import("../index.js").Theme} */
export default {
  id: "transcribee",
  name: "TranscriBee",
  scheme: "dark",
  colors: {
    bg: "#0e1014",
    surface: "#161920",
    surface2: "#1d212a",
    surfaceHover: "#262b36",
    border: "#2a2f3a",
    text: "#e6e8ee",
    muted: "#8b93a7",
    accent: "#f5b301",
    accentHover: "#ffc52e",
    accentInk: "#1a1400",
    danger: "#ff6b6b",
    loop: "#4cc9f0",
    wave: "#3b4252",
    minimapWave: "#343a48",
    minimapProgress: "#8a6a12",
    cursor: "#ffffff",
  },
};
