// Gruvbox Dark (morhetz): bg0_h / bg0 backgrounds, fg text, bright orange
// accent, blue loop, red errors; the dark counterpart of gruvbox-light.js.
// The errors' red is lightened a touch (from #fb4934) to read as text on the
// panels, and the start and stop points use Gruvbox's own green and red (the
// defaults sit too near the blue loop and the orange accent).
// https://github.com/morhetz/gruvbox
/** @type {import("../index.js").Theme} */
export default {
  id: "gruvbox-dark",
  name: "Gruvbox Dark",
  scheme: "dark",
  colors: {
    bg: "#1d2021",
    surface: "#282828",
    surface2: "#32302f",
    border: "#504945",
    text: "#ebdbb2",
    muted: "#a89984",
    accent: "#fe8019",
    accentInk: "#1d2021",
    danger: "#fb5a44",
    loop: "#83a598",
    start: "#b8bb26",
    stop: "#fb4934",
    wave: "#504945",
    cursor: "#fbf1c7",
  },
};
