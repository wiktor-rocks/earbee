// The colour-theme menu (the palette button in the top bar and on the
// welcome screen), and remembering the choice: through the main process
// (window.transcribee.theme, saved in theme.json) or, outside Electron, in
// localStorage. Applying a theme is ui/theme.js's job.
import { THEMES } from "../themes/index.js";
import { $, element, onClick, reportError } from "../ui/dom.js";
import { getThemePrefs, onThemeChange, setThemePrefs } from "../ui/theme.js";

/** @typedef {import("../themes/index.js").ThemePrefs} ThemePrefs */

const bridge = /** @type {any} */ (window).transcribee?.theme;
const STORAGE_KEY = "transcribee.theme";

/** The saved choice (null if none). */
export function loadThemePrefs() {
  if (bridge) return bridge.saved;
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
  } catch {
    return null;
  }
}

/** @param {ThemePrefs} prefs */
function saveThemePrefs(prefs) {
  if (bridge) return bridge.save(prefs).catch(reportError);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // storage unavailable: the choice lasts for this session
  }
}

/** @param {string} choice A theme id, or "auto". */
function choose(choice) {
  const prefs = { ...getThemePrefs(), choice };
  const theme = THEMES.find((candidate) => candidate.id === choice);
  // Choosing a theme also makes it Automatic's pick for its scheme.
  if (theme) prefs[theme.scheme] = theme.id;
  setThemePrefs(prefs);
  saveThemePrefs(getThemePrefs());
}

/* ---------- The menu ---------- */

const menu = $("themeMenu");
const isOpen = () => menu.matches(":popover-open");
let opener = null; // the button that opened the menu
export const isThemeMenuOpen = isOpen;

/** @param {import("../themes/index.js").Theme} theme */
const swatch = (theme) =>
  element(
    "span",
    { className: "theme-swatch", ariaHidden: "true" },
    ...["bg", "surface", "accent", "loop"].map((role) =>
      element("span", { style: `background: ${theme.colors[role]}` }),
    ),
  );

function item(choice, label, detail, preview) {
  const button = element("button", { type: "button", className: "theme-item", role: "menuitemradio" });
  button.dataset.choice = choice;
  button.append(preview ?? element("span", { className: "theme-swatch auto", ariaHidden: "true" }));
  button.append(element("span", { className: "theme-name" }, label, detail ? element("small", {}, detail) : ""));
  onClick(button, () => choose(choice));
  return button;
}

function buildMenu() {
  menu.append(
    item("auto", "Automatic", "follows the system's dark or light mode"),
    element("hr"),
    ...THEMES.map((theme) => item(theme.id, theme.name, theme.scheme === "light" ? "light" : "", swatch(theme))),
  );
}

// Check marks: the current choice, and for Automatic which themes it uses.
function renderMenu() {
  const prefs = getThemePrefs();
  for (const button of menu.querySelectorAll(".theme-item")) {
    const choice = /** @type {HTMLElement} */ (button).dataset.choice;
    button.setAttribute("aria-checked", String(choice === prefs.choice));
  }
  const pair = [prefs.dark, prefs.light].map((id) => THEMES.find((theme) => theme.id === id));
  menu.querySelector('[data-choice="auto"] small').textContent =
    `follows the system: ${pair[0].name} or ${pair[1].name}`;
  menu
    .querySelector(".theme-swatch.auto")
    .replaceChildren(...pair.map((theme) => element("span", { style: `background: ${theme.colors.bg}` })));
}

// Opens the menu under (or above) the button that asked for it, or closes
// it if it was open.
function openFrom(button) {
  if (isOpen()) return menu.hidePopover();
  renderMenu();
  menu.showPopover();
  const anchor = button.getBoundingClientRect();
  const room = window.innerHeight - anchor.bottom;
  menu.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${room > menu.offsetHeight + 8 ? anchor.bottom + 6 : Math.max(8, anchor.top - menu.offsetHeight - 6)}px`;
  opener = button;
  button.setAttribute("aria-expanded", "true");
  /** @type {HTMLElement | null} */ (
    menu.querySelector('[aria-checked="true"]') ?? menu.querySelector(".theme-item")
  )?.focus();
}

// ↑ / ↓ move between the items; Home / End jump to the ends.
function moveFocus(event) {
  const items = /** @type {HTMLElement[]} */ ([...menu.querySelectorAll(".theme-item")]);
  const index = items.indexOf(/** @type {HTMLElement} */ (document.activeElement));
  const next = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: items.length - 1 }[event.key];
  if (next === undefined) return;
  event.preventDefault();
  items[(next + items.length) % items.length].focus();
}

export function bindThemePicker() {
  buildMenu();
  for (const button of [$("themeButton"), $("welcomeThemeButton")]) {
    // Pressing the button while the menu is open closes it (light dismiss:
    // a press outside the menu), before the click arrives; that click must
    // not open it again. So remember whether it was open at the press.
    // (A click from the keyboard, detail 0, has no press: it just toggles.)
    let closedByPress = false;
    button.addEventListener("pointerdown", () => (closedByPress = isOpen()));
    onClick(button, (/** @type {MouseEvent} */ event) => {
      if (!(event.detail > 0 && closedByPress)) openFrom(button);
      closedByPress = false;
    });
  }
  menu.addEventListener("keydown", moveFocus);
  menu.addEventListener("toggle", (/** @type {any} */ event) => {
    if (event.newState !== "closed" || !opener) return;
    opener.setAttribute("aria-expanded", "false");
    if (menu.contains(document.activeElement) || document.activeElement === document.body) opener.focus();
    opener = null;
  });
  onThemeChange(() => isOpen() && renderMenu());
}
