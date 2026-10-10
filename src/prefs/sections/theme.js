// Settings › Theme: the colour theme, and for Automatic which theme each
// system mode uses. The values are the themes' ThemePrefs
// ({ choice, dark, light }); ui/theme.js applies them, the palette menu
// (features/theme-picker.js) is a shortcut to `choice`.
import { DEFAULT_PREFS, THEMES } from "../../themes/index.js";
import { defineSection } from "../fields.js";

/** @param {import("../../themes/index.js").Theme} theme */
const option = (theme) => ({
  value: theme.id,
  label: theme.name,
  detail: theme.scheme === "light" ? "light" : "",
  swatch: ["bg", "surface", "accent", "loop"].map((role) => theme.colors[role]),
});
const ofScheme = (scheme) => THEMES.filter((theme) => theme.scheme === scheme).map(option);
const isAuto = (values) => values.choice === "auto";

export default defineSection({
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
