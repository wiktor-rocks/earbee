// The colour themes: one object per theme, with its colour for each role
// (ROLES in index.js). A new theme: copy one, give it a new id, name,
// scheme and colours, and list it in THEMES at the bottom. The unit tests
// check that it defines every role and has readable contrast.

/** @typedef {import("./index.js").Theme} Theme */

// EarBee: the app's own dark theme, amber on a warm brown-black (espresso),
// no blue in its greys. style.css :root holds the same values as the
// fallback (a unit test keeps them equal).
/** @type {Theme} */
const earbee = {
  id: "earbee",
  name: "EarBee",
  scheme: "dark",
  colors: {
    bg: "#0f0c0a",
    surface: "#17120e",
    surface2: "#261f19",
    surfaceHover: "#30281f",
    border: "#3b3129",
    text: "#f1e9de",
    muted: "#aa9b8a",
    accent: "#f5b301",
    accentHover: "#ffc52e",
    accentInk: "#1a1400",
    danger: "#ff6b6b",
    loop: "#4cc9f0",
    wave: "#4b3f34",
    minimapWave: "#3a3129",
    minimapProgress: "#8f6d14",
    cursor: "#ffffff",
  },
};

// EarBee Graphite: EarBee's amber on neutral greys, with no hue at all.
/** @type {Theme} */
const earbeeGraphite = {
  id: "earbee-graphite",
  name: "EarBee Graphite",
  scheme: "dark",
  colors: {
    bg: "#0e0e0e",
    surface: "#171717",
    surface2: "#252525",
    surfaceHover: "#2f2f2f",
    border: "#393939",
    text: "#eeeeee",
    muted: "#a2a2a2",
    accent: "#f5b301",
    accentHover: "#ffc52e",
    accentInk: "#1a1400",
    danger: "#ff6b6b",
    loop: "#4cc9f0",
    wave: "#464646",
    minimapWave: "#363636",
    minimapProgress: "#8f6d14",
    cursor: "#ffffff",
  },
};

// EarBee Moss: EarBee's amber on smoky grey-greens, like old studio gear.
/** @type {Theme} */
const earbeeMoss = {
  id: "earbee-moss",
  name: "EarBee Moss",
  scheme: "dark",
  colors: {
    bg: "#0d0f0c",
    surface: "#161914",
    surface2: "#232820",
    surfaceHover: "#2c3228",
    border: "#363d30",
    text: "#e9ecdf",
    muted: "#9ea592",
    accent: "#f5b301",
    accentHover: "#ffc52e",
    accentInk: "#1a1400",
    danger: "#ff6b6b",
    loop: "#4cc9f0",
    wave: "#434b3a",
    minimapWave: "#343a2e",
    minimapProgress: "#8f6d14",
    cursor: "#ffffff",
  },
};

// Monokai (Wimer Hazenberg's classic, as in Sublime Text): green accent,
// cyan loop, pink-red errors (Monokai Pro's, readable as text).
// https://monokai.pro/
/** @type {Theme} */
const monokai = {
  id: "monokai",
  name: "Monokai",
  scheme: "dark",
  colors: {
    bg: "#1e1f1c",
    surface: "#272822",
    surface2: "#31322b",
    border: "#49483e",
    text: "#f8f8f2",
    muted: "#a59f85",
    accent: "#a6e22e",
    accentInk: "#1e1f1c",
    danger: "#ff6188",
    loop: "#66d9ef",
    wave: "#4a4a40",
    cursor: "#f8f8f0",
  },
};

// Dracula: purple accent, cyan loop, red errors. https://draculatheme.com/contribute
/** @type {Theme} */
const dracula = {
  id: "dracula",
  name: "Dracula",
  scheme: "dark",
  colors: {
    bg: "#21222c",
    surface: "#282a36",
    surface2: "#343746",
    border: "#44475a",
    text: "#f8f8f2",
    muted: "#a4abcd",
    accent: "#bd93f9",
    accentInk: "#21222c",
    danger: "#ff5555",
    loop: "#8be9fd",
    wave: "#4d5170",
    cursor: "#f8f8f2",
  },
};

// Nord: Polar Night backgrounds, Frost accent, Aurora yellow loop (green
// is too close to Frost) and a lightened Aurora red for errors. The stop
// point gets a stronger red than the errors' (too close to the yellow loop). https://www.nordtheme.com/docs/colors-and-palettes
/** @type {Theme} */
const nord = {
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

// One Dark (Atom): blue accent, green loop, red errors (lightened for
// contrast as text). The start point gets a brighter green than the loop's.
// https://github.com/atom/atom/tree/master/packages/one-dark-syntax
/** @type {Theme} */
const oneDark = {
  id: "one-dark",
  name: "One Dark",
  scheme: "dark",
  colors: {
    bg: "#21252b",
    surface: "#282c34",
    surface2: "#2c313a",
    border: "#3e4451",
    text: "#d7dae0",
    muted: "#9da5b4",
    accent: "#61afef",
    accentInk: "#21252b",
    danger: "#ef7d86",
    loop: "#98c379",
    wave: "#4b5263",
    cursor: "#d7dae0",
    start: "#3ddc84",
  },
};

// Gruvbox Dark (morhetz): bg0_h / bg0 backgrounds, fg text, bright orange
// accent, blue loop, red errors; the dark counterpart of Gruvbox Light.
// The errors' red is lightened a touch (from #fb4934) to read as text on the
// panels, and the start and stop points use Gruvbox's own green and red (the
// defaults sit too near the blue loop and the orange accent).
// https://github.com/morhetz/gruvbox
/** @type {Theme} */
const gruvboxDark = {
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

// Solarized Dark (Ethan Schoonover): base03 / base02 panels, base1 text,
// cyan accent, violet loop, red errors; the dark counterpart of
// Solarized Light. The text is base1 a touch lighter, and the red is
// lightened, both to read on the panels. https://ethanschoonover.com/solarized/
/** @type {Theme} */
const solarizedDark = {
  id: "solarized-dark",
  name: "Solarized Dark",
  scheme: "dark",
  colors: {
    bg: "#00212b",
    surface: "#002b36",
    surface2: "#073642",
    border: "#0f4654",
    text: "#9aa8a8",
    muted: "#839496",
    accent: "#2aa198",
    accentInk: "#002b36",
    danger: "#e56765",
    loop: "#6c71c4",
    wave: "#1f4a55",
    cursor: "#eee8d5",
  },
};

// Catppuccin Mocha: Mantle / Base / Surface0 backgrounds, Text, Mauve accent,
// Sapphire loop, Red errors; the dark counterpart of Catppuccin Latte.
// The loop is Sapphire rather than Latte's Teal, which sat too near Mauve.
// https://catppuccin.com/palette
/** @type {Theme} */
const catppuccinMocha = {
  id: "catppuccin-mocha",
  name: "Catppuccin Mocha",
  scheme: "dark",
  colors: {
    bg: "#181825",
    surface: "#1e1e2e",
    surface2: "#313244",
    border: "#45475a",
    text: "#cdd6f4",
    muted: "#a6adc8",
    accent: "#cba6f7",
    accentInk: "#11111b",
    danger: "#f38ba8",
    loop: "#74c7ec",
    wave: "#45475a",
    cursor: "#cdd6f4",
  },
};

// Tokyo Night (enkia): night background, blue accent, green loop, red
// errors, and teal for the start point (the default green sits too near the
// loop). https://github.com/enkia/tokyo-night-vscode-theme
/** @type {Theme} */
const tokyoNight = {
  id: "tokyo-night",
  name: "Tokyo Night",
  scheme: "dark",
  colors: {
    bg: "#16161e",
    surface: "#1a1b26",
    surface2: "#24283b",
    border: "#292e42",
    text: "#c0caf5",
    muted: "#9aa5ce",
    accent: "#7aa2f7",
    accentInk: "#16161e",
    danger: "#f7768e",
    loop: "#9ece6a",
    start: "#73daca",
    wave: "#3b4261",
    cursor: "#c0caf5",
  },
};

// EarBee Light: the app's own theme for light mode, amber on honey
// paper, the light counterpart of EarBee. The amber is the dark
// theme's own yellow, so the brand colour is the same in both (it's soft on
// the pale panels; tests/unit/themes.test.mjs exempts it from the 3:1 check).
/** @type {Theme} */
const earbeeLight = {
  id: "earbee-light",
  name: "EarBee Light",
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

// Solarized Light (Ethan Schoonover): base2 / base3 backgrounds, base01
// text, cyan accent (darkened, so it reads on the light panels), violet
// loop, red errors. https://ethanschoonover.com/solarized/
/** @type {Theme} */
const solarizedLight = {
  id: "solarized-light",
  name: "Solarized Light",
  scheme: "light",
  colors: {
    bg: "#eee8d5",
    surface: "#fdf6e3",
    surface2: "#f4eedb",
    border: "#d6cfb8",
    text: "#073642",
    muted: "#4e646b",
    accent: "#1b7d76",
    accentInk: "#fdf6e3",
    danger: "#c42b28",
    loop: "#6c71c4",
    wave: "#cfc8b0",
    cursor: "#073642",
  },
};

// Catppuccin Latte: Mantle / Base / Crust backgrounds, Text, Mauve accent,
// Teal loop, Red errors (a shade darker, to read as text on Mantle).
// https://catppuccin.com/palette
/** @type {Theme} */
const catppuccinLatte = {
  id: "catppuccin-latte",
  name: "Catppuccin Latte",
  scheme: "light",
  colors: {
    bg: "#e6e9ef",
    surface: "#eff1f5",
    surface2: "#dce0e8",
    border: "#ccd0da",
    text: "#4c4f69",
    muted: "#5c5f77",
    accent: "#8839ef",
    accentInk: "#eff1f5",
    danger: "#c80e36",
    loop: "#179299",
    wave: "#bcc0cc",
    cursor: "#4c4f69",
  },
};

// GitHub Light (Primer): white panels on canvas-subtle, blue accent,
// purple loop, red errors. https://primer.style/foundations/color
/** @type {Theme} */
const githubLight = {
  id: "github-light",
  name: "GitHub Light",
  scheme: "light",
  colors: {
    bg: "#f6f8fa",
    surface: "#ffffff",
    surface2: "#eff2f5",
    border: "#d0d7de",
    text: "#1f2328",
    muted: "#59636e",
    accent: "#0969da",
    accentInk: "#ffffff",
    danger: "#cf222e",
    loop: "#8250df",
    wave: "#b7c0ca",
    cursor: "#1f2328",
  },
};

// Gruvbox Light (morhetz): bg0 / bg1 backgrounds, fg text, orange accent,
// blue loop, red errors. https://github.com/morhetz/gruvbox
/** @type {Theme} */
const gruvboxLight = {
  id: "gruvbox-light",
  name: "Gruvbox Light",
  scheme: "light",
  colors: {
    bg: "#f2e5bc",
    surface: "#fbf1c7",
    surface2: "#ebdbb2",
    border: "#d5c4a1",
    text: "#3c3836",
    muted: "#665c54",
    accent: "#af3a03",
    accentInk: "#fbf1c7",
    danger: "#9d0006",
    loop: "#076678",
    wave: "#bdae93",
    cursor: "#3c3836",
  },
};

// One Light (Atom): blue accent (darkened a little, so the light text on it
// reads), purple loop, red errors; the light counterpart of One Dark. The
// loop is purple rather than One Dark's green, which sat too near the start
// point's green. https://github.com/atom/atom/tree/master/packages/one-light-syntax
/** @type {Theme} */
const oneLight = {
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

// Tokyo Night Day (enkia): the light counterpart of Tokyo Night. Blue
// accent, green loop, teal start point, red errors. The palette is pale, so
// the text, comment grey (the muted text), blue and red are darkened to read
// on it. https://github.com/enkia/tokyo-night-vscode-theme
/** @type {Theme} */
const tokyoNightDay = {
  id: "tokyo-night-day",
  name: "Tokyo Night Day",
  scheme: "light",
  colors: {
    bg: "#d6d8e1",
    surface: "#e1e2e7",
    surface2: "#e9e9ed",
    border: "#c4c8da",
    text: "#3358b0",
    muted: "#575c77",
    accent: "#2565bd",
    accentInk: "#e9e9ed",
    danger: "#b01e49",
    loop: "#587539",
    start: "#118c74",
    wave: "#a8b1d6",
    cursor: "#3358b0",
  },
};

// Everforest Light (sainnhe, medium): bg0 / bg1 backgrounds, fg text, green
// accent, blue loop, red errors. The palette is soft, so the text, grey
// (the muted text), green and red are darkened to read on it.
// https://github.com/sainnhe/everforest
/** @type {Theme} */
const everforestLight = {
  id: "everforest-light",
  name: "Everforest Light",
  scheme: "light",
  colors: {
    bg: "#f4f0d9",
    surface: "#fdf6e3",
    surface2: "#efebd4",
    border: "#e0dcc7",
    text: "#56646b",
    muted: "#636e62",
    accent: "#687701",
    accentInk: "#fdf6e3",
    danger: "#bc413e",
    loop: "#3a94c5",
    wave: "#cfc9ab",
    cursor: "#56646b",
  },
};

// Dark themes first, then light ones; the menu lists them in this order.
/** @type {Theme[]} */
export const THEMES = [
  earbee,
  earbeeGraphite,
  earbeeMoss,
  monokai,
  dracula,
  nord,
  oneDark,
  gruvboxDark,
  solarizedDark,
  catppuccinMocha,
  tokyoNight,
  earbeeLight,
  solarizedLight,
  catppuccinLatte,
  githubLight,
  gruvboxLight,
  oneLight,
  tokyoNightDay,
  everforestLight,
];
