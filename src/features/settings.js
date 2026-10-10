// The Settings dialog, opened by the gear buttons (the top bar and the
// welcome screen). It's generated from the sections in src/prefs: one tab
// per section, one control per field (ui/pref-fields.js). A change applies
// and is saved at once (ui/prefs.js); there's no OK or Cancel. Below it,
// the colour-theme menu, a shortcut to Settings › Theme.
import { SECTIONS } from "../prefs/index.js";
import { THEMES } from "../themes/index.js";
import { $, element, onClick } from "../ui/dom.js";
import { bindMenu } from "../ui/menu.js";
import { renderField, swatch } from "../ui/pref-fields.js";
import {
  chooseFolder,
  defaultPaths,
  getPrefs,
  hasMainProcess,
  onPrefsChange,
  resetPref,
  setPref,
} from "../ui/prefs.js";

const dialog = /** @type {HTMLDialogElement} */ ($("settingsDialog"));
const tabs = $("settingsTabs");
const panels = $("settingsPanels");
const message = $("settingsMessage");
let opener = null; // the gear that opened the dialog

export const isSettingsOpen = () => dialog.open;

// Sections that need the main process (downloads) are left out of a plain browser.
const sections = () => SECTIONS.filter((section) => hasMainProcess || !section.electronOnly);

// Runs a change, clearing an earlier failure first. A change that fails (a
// refused value, a folder that can't be chosen) is explained in the dialog,
// which covers the app's own message line, and `refresh` shows the values
// that were kept again.
async function attempt(change, refresh) {
  message.textContent = "";
  try {
    await change();
  } catch (error) {
    console.error(error);
    message.textContent = `Couldn't change that setting: ${error?.message ?? error}`;
    refresh();
  }
}

/** @param {import("../prefs/fields.js").Section} section */
function buildPanel(section) {
  const panel = element("section", { className: "settings-panel", id: `settings-${section.id}` });
  panel.setAttribute("role", "tabpanel");
  panel.setAttribute("aria-labelledby", `settings-tab-${section.id}`);
  const show = (values) => fields.forEach((field) => field.update(values));
  const refresh = () => show(getPrefs(section.id));
  const fields = section.fields.map((field) =>
    renderField(field, {
      set: (value) => attempt(() => setPref(section.id, field.key, value), refresh),
      reset: () => attempt(() => resetPref(section.id, field.key), refresh),
      chooseFolder: () => attempt(() => chooseFolder(section.id, field.key), refresh),
      defaultPath: defaultPaths[`${section.id}.${field.key}`],
    }),
  );
  panel.append(...fields.map((field) => field.element));
  refresh();
  onPrefsChange(section.id, show);
  return panel;
}

function selectTab(id) {
  for (const tab of tabs.children) tab.setAttribute("aria-selected", String(tab.id === `settings-tab-${id}`));
  for (const panel of panels.children) /** @type {HTMLElement} */ (panel).hidden = panel.id !== `settings-${id}`;
}

// An icon from index.html's sprite (an SVG element, so not element()).
function spriteIcon(id) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${id}`);
  svg.append(use);
  return svg;
}

function build() {
  for (const section of sections()) {
    const tab = element("button", { type: "button", className: "settings-tab", id: `settings-tab-${section.id}` });
    if (section.icon) tab.append(spriteIcon(section.icon));
    tab.append(section.title);
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", `settings-${section.id}`);
    onClick(tab, () => selectTab(section.id));
    tabs.append(tab);
    panels.append(buildPanel(section));
  }
  selectTab(sections()[0].id);
}

// ↑ / ↓ move between the tabs (and select them).
function moveBetweenTabs(event) {
  const all = /** @type {HTMLElement[]} */ ([...tabs.children]);
  const index = all.indexOf(/** @type {HTMLElement} */ (document.activeElement));
  if (index === -1) return;
  const next = { ArrowDown: index + 1, ArrowUp: index - 1 }[event.key];
  if (next === undefined) return;
  event.preventDefault();
  const tab = all[(next + all.length) % all.length];
  tab.focus();
  tab.click();
}

export function openSettings(button) {
  if (dialog.open) return;
  opener = button;
  message.textContent = "";
  dialog.showModal();
  /** @type {HTMLElement} */ (tabs.querySelector('[aria-selected="true"]'))?.focus();
}

export function bindSettings() {
  build();
  for (const button of [$("settingsButton"), $("welcomeSettingsButton")]) onClick(button, () => openSettings(button));
  onClick($("settingsClose"), () => dialog.close());
  tabs.addEventListener("keydown", moveBetweenTabs);
  // A click on the backdrop (outside the dialog's box) closes it too.
  dialog.addEventListener("click", (event) => event.target === dialog && dialog.close());
  dialog.addEventListener("close", () => {
    opener?.focus();
    opener = null;
  });
}

/* ---------- The colour-theme menu ---------- */

// The colour-theme menu (the palette button in the top bar and on the
// welcome screen): a shortcut to Settings › Theme. Choosing here sets the
// same setting (ui/prefs.js), so the menu, the dialog and the theme on
// screen (ui/theme.js) always agree. The menu keeps one size and stays on
// the button that opened it (CSS anchor positioning, see .theme-menu), so
// nothing moves while you pick.

/** @param {string} choice A theme id, or "auto". */
const choose = (choice) => setPref("theme", "choice", choice);

const menu = $("themeMenu");
const isOpen = () => menu.matches(":popover-open");
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

export function bindThemePicker() {
  buildMenu();
  bindMenu({
    menu,
    buttons: () => [$("themeButton"), $("welcomeThemeButton")],
    anchor: "--theme-open",
    itemSelector: ".theme-item",
    onOpen: renderMenu,
    initialFocus: () => menu.querySelector('[aria-checked="true"]'),
  });
  onPrefsChange("theme", () => isOpen() && renderMenu());
}
