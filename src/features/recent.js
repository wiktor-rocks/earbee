// Recent files: the projects and the songs or videos opened lately, in two
// lists, on the welcome screen and in the File menu (File › Open recent, a
// side menu). One click opens an entry, through the same steps as opening a
// file (openRecent, in features/project/), so unsaved changes are asked about first.
//
// The lists themselves are the main process's (electron/recent-files.js). It
// tells the page when they change, so whatever is opened or saved shows up
// here by itself. The page only knows each entry's name, folder and id.
//
// Outside Electron there's no bridge: both places stay hidden.
import { CONFIG } from "../config.js";
import { fileExtension } from "../core/media.js";
import { dom, element, guarded, onClick } from "../ui/dom.js";
import { bindSubmenu } from "../ui/menu.js";
import { openRecent } from "./project/index.js";

/**
 * @typedef {{ id: string, name: string, folder: string }} RecentEntry
 * @typedef {{ projects: RecentEntry[], files: RecentEntry[] }} RecentLists
 */

const bridge = /** @type {any} */ (window).earbee?.recent;

const iconOf = (/** @type {RecentEntry} */ entry, /** @type {boolean} */ isProject) => {
  const isVideo = CONFIG.video.extensions.includes(fileExtension(entry.name));
  const name = isProject ? "i-project" : isVideo ? "i-film" : "i-note";
  const holder = element("span", { className: "recent-icon" });
  holder.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#${name}" /></svg>`;
  return holder;
};

const separatorIn = (/** @type {string} */ folder) => (folder.includes("\\") ? "\\" : "/");

// The folder as a row shows it: its last two names, the part you'd
// recognise. The row's tooltip has the full path (fullPath).
function shortFolder(/** @type {string} */ folder) {
  const separator = separatorIn(folder);
  const names = folder.split(separator).filter(Boolean);
  return names.length > 2 ? `…${separator}${names.slice(-2).join(separator)}` : folder;
}

// Where the entry is, to show when the pointer rests on its row. (A folder
// that is the top of a drive already ends in the separator.)
function fullPath(/** @type {RecentEntry} */ { folder, name }) {
  const separator = separatorIn(folder);
  return folder.endsWith(separator) ? `${folder}${name}` : `${folder}${separator}${name}`;
}

// Opening one that has gone takes it off the list, and says so: the focus
// goes back to where the keyboard can go on from, not nowhere.
async function open(/** @type {string} */ id) {
  try {
    await openRecent(id);
  } finally {
    if (!dom.welcome.hidden && !dom.welcome.contains(document.activeElement)) dom.welcomeOpen.focus();
  }
}

/* ---------- The welcome screen ---------- */

const removeButtons = () => [...dom.welcomeRecent.querySelectorAll(".recent-remove")];

// The focus moves to the next entry's remove button, so several can be
// removed in a row from the keyboard.
async function remove(/** @type {string} */ id, /** @type {Element} */ button) {
  const place = removeButtons().indexOf(button);
  render(await bridge.remove(id));
  const buttons = removeButtons();
  /** @type {HTMLElement} */ (buttons[place] ?? buttons.at(-1) ?? dom.welcomeOpen).focus();
}

function welcomeRow(/** @type {RecentEntry} */ entry, /** @type {boolean} */ isProject) {
  const choose = element(
    "button",
    { type: "button", className: "recent-open", title: fullPath(entry) },
    iconOf(entry, isProject),
    element(
      "span",
      { className: "recent-text" },
      element("span", { className: "recent-name" }, entry.name),
      element("span", { className: "recent-folder" }, shortFolder(entry.folder)),
    ),
  );
  onClick(choose, () => open(entry.id));
  const label = `Remove “${entry.name}” from this list`;
  const removeButton = element("button", {
    type: "button",
    className: "recent-remove",
    title: label,
    ariaLabel: label,
  });
  removeButton.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#i-close" /></svg>`;
  onClick(removeButton, () => remove(entry.id, removeButton));
  return element("li", {}, choose, removeButton);
}

function welcomeList(
  /** @type {string} */ title,
  /** @type {RecentEntry[]} */ entries,
  /** @type {boolean} */ isProject,
) {
  return element(
    "div",
    { className: "recent-list" },
    element("h2", {}, title),
    element("ul", {}, ...entries.map((entry) => welcomeRow(entry, isProject))),
  );
}

/* ---------- The File menu ---------- */

function menuRow(/** @type {RecentEntry} */ entry, /** @type {boolean} */ isProject) {
  const row = element(
    "button",
    { type: "button", className: "menu-item recent-item", role: "menuitem", title: fullPath(entry) },
    iconOf(entry, isProject),
    element("span", { className: "menu-label" }, entry.name),
  );
  onClick(row, () => open(entry.id));
  return row;
}

const menuList = (
  /** @type {string} */ title,
  /** @type {RecentEntry[]} */ entries,
  /** @type {boolean} */ isProject,
) =>
  entries.length
    ? [
        element("div", { className: "menu-heading", role: "presentation" }, title),
        ...entries.slice(0, CONFIG.recent.inMenu).map((entry) => menuRow(entry, isProject)),
      ]
    : [];

/* ---------- Both ---------- */

let shown = "";

// Only when they've changed: the main process's word on a change often
// follows the answer that already showed it, and redrawing then would lose
// the keyboard's place.
function render(/** @type {RecentLists} */ lists) {
  const now = JSON.stringify(lists);
  if (now === shown) return;
  shown = now;
  const { projects, files } = lists;
  const any = projects.length + files.length > 0;
  dom.welcomeRecent.hidden = !any;
  dom.recentMenuButton.hidden = !any;
  if (!any && dom.fileMenuRecent.matches(":popover-open")) dom.fileMenuRecent.hidePopover();
  dom.welcomeRecentLists.replaceChildren(
    ...(projects.length ? [welcomeList("Recent projects", projects, true)] : []),
    ...(files.length ? [welcomeList("Recent files", files, false)] : []),
  );
  dom.fileMenuRecent.replaceChildren(...menuList("Projects", projects, true), ...menuList("Files", files, false));
}

/**
 * Fills the lists; resolves once they're in place, so the window can show
 * with them already there (app.js).
 */
export async function bindRecent() {
  if (!bridge) return;
  bindSubmenu({
    parent: dom.fileMenu,
    button: dom.recentMenuButton,
    menu: dom.fileMenuRecent,
    itemSelector: ".menu-item",
  });
  bridge.onChanged(render);
  onClick(dom.welcomeRecentClear, async () => {
    render(await bridge.clear());
    dom.welcomeOpen.focus();
  });
  await guarded(async () => render(await bridge.list()))();
}
