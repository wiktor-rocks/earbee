// The colour-theme menu (the palette button in the top bar and on the
// welcome screen): a shortcut to Settings › Theme. Choosing here sets the
// same setting (ui/prefs.js), so the menu, the dialog and the theme on
// screen (ui/theme.js) always agree. The menu keeps one size and stays on
// the button that opened it (CSS anchor positioning, see .theme-menu), so
// nothing moves while you pick.
import { THEMES } from "../themes/index.js";
import { $, element, onClick } from "../ui/dom.js";
import { swatch } from "../ui/pref-fields.js";
import { getPrefs, onPrefsChange, setPref } from "../ui/prefs.js";

/** @param {string} choice A theme id, or "auto". */
const choose = (choice) => setPref("theme", "choice", choice);

/* ---------- The menu ---------- */

const menu = $("themeMenu");
const isOpen = () => menu.matches(":popover-open");
let opener = null; // the button that opened the menu
export const isThemeMenuOpen = isOpen;

function item(choice, label, detail, preview) {
  const button = element("button", { type: "button", className: "theme-item", role: "menuitemradio" });
  button.dataset.choice = choice;
  button.append(preview ?? element("span", { className: "theme-swatch auto", ariaHidden: "true" }));
  button.append(
    element(
      "span",
      { className: "theme-name" },
      element("span", {}, label),
      detail ? element("small", {}, detail) : "",
    ),
  );
  onClick(button, () => choose(choice));
  return button;
}

function buildMenu() {
  menu.append(
    item("auto", "Automatic", "follows the system's dark or light mode"),
    element("hr"),
    ...THEMES.map((theme) =>
      item(
        theme.id,
        theme.name,
        theme.scheme === "light" ? "light" : "",
        swatch(["bg", "surface", "accent", "loop"].map((role) => theme.colors[role])),
      ),
    ),
  );
}

// Check marks: the current choice, and for Automatic which themes it uses.
function renderMenu() {
  const prefs = getPrefs("theme");
  for (const button of menu.querySelectorAll(".theme-item")) {
    const choice = /** @type {HTMLElement} */ (button).dataset.choice;
    button.setAttribute("aria-checked", String(choice === prefs.choice));
  }
  const pair = [prefs.dark, prefs.light].map((id) => THEMES.find((theme) => theme.id === id));
  // Cut short if it doesn't fit (the menu never widens); the full text on hover.
  const auto = /** @type {HTMLElement} */ (menu.querySelector('[data-choice="auto"]'));
  auto.querySelector("small").textContent = `follows the system: ${pair[0].name} or ${pair[1].name}`;
  auto.title = `Automatic: ${pair[0].name} in dark mode, ${pair[1].name} in light mode`;
  menu
    .querySelector(".theme-swatch.auto")
    .replaceChildren(...pair.map((theme) => element("span", { style: `background: ${theme.colors.bg}` })));
}

const buttons = () => [$("themeButton"), $("welcomeThemeButton")];

// Opens the menu under (or above) the button that asked for it, or closes
// it if it was open. That button becomes the menu's anchor; CSS places the
// menu against it and keeps it there (a resized window, a flip near an edge).
function openFrom(button) {
  if (isOpen()) return menu.hidePopover();
  for (const other of buttons()) other.style.removeProperty("anchor-name");
  button.style.setProperty("anchor-name", "--theme-open");
  renderMenu();
  menu.showPopover();
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
  for (const button of buttons()) {
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
  onPrefsChange("theme", () => isOpen() && renderMenu());
}
