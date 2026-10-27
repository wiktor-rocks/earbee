// Every settings section, in the order the Settings dialog lists them.
// A new section: a defineSection() below (see fields.js for the format),
// listed in SECTIONS. The unit tests check every section's declaration.
import { DEFAULT_SOURCE, SEARCH_SOURCES } from "../search/sources.js";
import { DEFAULT_PREFS, THEMES } from "../themes/index.js";
import { defineSection, normalizeAll } from "./fields.js";

// Settings › General: app-wide choices. `notifications` turns the small
// confirmations (ui/toast.js) on and off; problems always show in the
// transport bar. `beatClick` plays a click on each found beat
// (features/beats.js), to hear whether the beat lines sit on the beat;
// it's set in the beats menu (the ♩ chip) or with Shift+B, not here.
const generalSection = defineSection({
  id: "general",
  title: "General",
  icon: "sliders",
  fields: [
    {
      key: "notifications",
      type: "boolean",
      label: "Show notifications",
      help: "Short messages that confirm something worked, such as where a file was saved.",
      default: true,
    },
    {
      key: "beatClick",
      type: "boolean",
      label: "Click on each beat",
      help: "Once the beats are found (B), a click plays on each one, to hear whether they're right. Shift+B turns it on and off.",
      default: false,
      inDialog: false,
    },
  ],
});

// Settings › Theme: the colour theme, and for Automatic which theme each
// system mode uses. The values are the themes' ThemePrefs
// ({ choice, dark, light }); ui/theme.js applies them, the palette menu
// (features/settings.js) is a shortcut to `choice`.
/** @param {import("../themes/index.js").Theme} theme */
const option = (theme) => ({
  value: theme.id,
  label: theme.name,
  detail: theme.scheme === "light" ? "light" : "",
  swatch: ["bg", "surface", "accent", "loop"].map((role) => theme.colors[role]),
});
const ofScheme = (scheme) => THEMES.filter((theme) => theme.scheme === scheme).map(option);
const isAuto = (values) => values.choice === "auto";

const themeSection = defineSection({
  id: "theme",
  title: "Theme",
  icon: "palette",
  fields: [
    {
      key: "choice",
      type: "choice",
      label: "Colour theme",
      default: DEFAULT_PREFS.choice,
      options: [{ value: "auto", label: "Automatic", detail: "follows the system's dark or light mode" }].concat(
        THEMES.map(option),
      ),
    },
    {
      key: "dark",
      type: "choice",
      label: "In dark mode",
      help: "The theme Automatic uses while the system is in dark mode.",
      default: DEFAULT_PREFS.dark,
      options: ofScheme("dark"),
      visibleWhen: isAuto,
    },
    {
      key: "light",
      type: "choice",
      label: "In light mode",
      help: "The theme Automatic uses while the system is in light mode.",
      default: DEFAULT_PREFS.light,
      options: ofScheme("light"),
      visibleWhen: isAuto,
    },
  ],
  // Choosing a theme also makes it Automatic's pick for its scheme.
  onSet(values, key) {
    if (key !== "choice") return;
    const theme = THEMES.find((candidate) => candidate.id === values.choice);
    if (theme) values[theme.scheme] = theme.id;
  },
});

// Settings › Waveform: how the waveform is drawn (its shape, what it
// measures, the scale, stereo, the height). The values are an Appearance
// (core/waveshape.js); app.js hands them to the waveform's setAppearance().
export const waveformSection = defineSection({
  id: "waveform",
  title: "Waveform",
  icon: "wave",
  fields: [
    {
      key: "style",
      type: "choice",
      label: "Shape",
      default: "bars",
      options: [
        { value: "bars", label: "Bars" },
        { value: "continuous", label: "Continuous", detail: "one filled shape" },
        { value: "twoTone", label: "Peak + loudness", detail: "pale peaks around solid loudness" },
      ],
    },
    {
      key: "measure",
      type: "choice",
      label: "Show",
      help: "Loudness tells beats and notes apart even in a loud, mastered song; peaks show every transient.",
      default: "loudness",
      options: [
        { value: "loudness", label: "Loudness", detail: "RMS" },
        { value: "peaks", label: "Peaks" },
      ],
      visibleWhen: (values) => values.style !== "twoTone",
    },
    {
      key: "scale",
      type: "choice",
      label: "Scale",
      help: "Logarithmic brings out quiet parts: intros, fades, soft notes.",
      default: "linear",
      options: [
        { value: "linear", label: "Linear" },
        { value: "log", label: "Logarithmic", detail: "dB" },
      ],
    },
    {
      key: "stereo",
      type: "choice",
      label: "Stereo",
      default: "combined",
      options: [
        { value: "combined", label: "Combined", detail: "the louder channel, mirrored" },
        { value: "split", label: "Left above, right below" },
      ],
    },
    {
      key: "height",
      type: "number",
      label: "Height",
      help: "Above 100 %, the loudest parts are clipped to the full height.",
      default: 100,
      min: 50,
      max: 300,
      step: 10,
      unit: "%",
    },
  ],
});

// Settings › Downloads: where downloaded files go, and what the From
// YouTube dialog downloads, and where it searches. electron/downloader.js reads them for each
// download; features/download.js starts the dialog on `kind`.
const VIDEO_HEIGHTS = [480, 720, 1080, 1440, 2160];

const downloadsSection = defineSection({
  id: "downloads",
  title: "Downloads",
  icon: "download",
  electronOnly: true,
  fields: [
    {
      key: "folder",
      type: "folder",
      label: "Save downloads in",
      help: "Downloaded songs and videos are saved here, then opened.",
      default: null, // ~/Downloads/EarBee (the main process knows where that is)
    },
    {
      key: "kind",
      type: "choice",
      label: "Download",
      help: "What the From YouTube dialog starts on; you can still pick the other there.",
      default: "audio",
      options: [
        { value: "audio", label: "Audio" },
        { value: "video", label: "Video" },
      ],
    },
    {
      key: "chapters",
      type: "boolean",
      label: "Add a video's chapters as marks",
      help: "When the uploader split the video into chapters, each becomes a region named after it.",
      default: true,
    },
    {
      key: "searchSource",
      type: "choice",
      label: "Search on",
      help: "Where the From YouTube dialog searches when you type words instead of a link; it remembers the last one you used.",
      default: DEFAULT_SOURCE,
      options: SEARCH_SOURCES.map((source) => ({ value: source.id, label: source.name })),
    },
    {
      key: "maxHeight",
      type: "choice",
      label: "Best video quality",
      help: "Above 1080p, YouTube's videos are VP9 or AV1, which take more of the computer to play.",
      default: 1080,
      options: VIDEO_HEIGHTS.map((height) => ({ value: height, label: `${height}p` })),
    },
  ],
});

// Settings › Advanced: choices most people never need. `sharpJumps` is how
// much memory the video's ready points may use (decoders waiting at the
// loop start, the start point and the nearest marks, so a jump there is
// sharp at once); app.js hands the choice to the video view's
// setReadyLevel(). The numbers in its options are those of
// CONFIG.video.readyPoints.levels (which this layer can't import): change
// them together; tests/unit/ready-budget.test.mjs checks they agree.
const advancedSection = defineSection({
  id: "advanced",
  title: "Advanced",
  icon: "gear",
  fields: [
    {
      key: "sharpJumps",
      type: "choice",
      label: "Memory for sharp video jumps",
      help: "Right after a jump in a video (a loop going round, Space, a jump to a mark), the picture can be blurry for a moment while the full-quality one is decoded. This keeps memory set aside to have it ready at the loop start, the start point and the nearest marks, so those jumps are sharp at once. More memory covers more of them; 4K videos need the most.",
      default: "normal",
      options: [
        { value: "off", label: "Off", detail: "no decoders wait" },
        { value: "low", label: "Low", detail: "up to 320 MB, 5 % of free" },
        { value: "normal", label: "Normal", detail: "up to 640 MB, 15 % of free" },
        { value: "high", label: "High", detail: "up to 1.28 GB, 30 % of free" },
      ],
    },
  ],
});

/** @type {import("./fields.js").Section[]} */
export const SECTIONS = [generalSection, themeSection, waveformSection, downloadsSection, advancedSection];

/** @param {string} id */
export const getSection = (id) => SECTIONS.find((section) => section.id === id);

/** Every section's values from what was stored (anything; invalid parts become defaults). */
export const normalizePrefsFile = (stored) => normalizeAll(SECTIONS, stored);

export { PrefsError, defaultsOf, isVisible, resetValue, setValue } from "./fields.js";
