/* =====================================================================
 * POPOVER MENUS
 * A [popover] menu opened by one or more buttons: the File menu
 * (features/file-menu.js) and the beats menu (features/beats.js); and a
 * side menu opened from a row of one (File › Open recent, in
 * features/recent.js).
 * ===================================================================== */

import { onClick } from "./dom.js";

// A menu's own items, not those of a side menu inside it.
const ownItems = (/** @type {HTMLElement} */ menu, /** @type {string} */ itemSelector) =>
  /** @type {HTMLElement[]} */ ([...menu.querySelectorAll(itemSelector)]).filter(
    (item) => !item.hidden && item.closest(".menu") === menu,
  );

// ↑ / ↓ move between a menu's items; Home / End jump to the ends. Keys
// pressed in a side menu inside it are the side menu's.
function moveFocus(
  /** @type {HTMLElement} */ menu,
  /** @type {string} */ itemSelector,
  /** @type {KeyboardEvent} */ event,
) {
  if (/** @type {HTMLElement} */ (event.target).closest(".menu") !== menu) return;
  const shown = ownItems(menu, itemSelector);
  const index = shown.indexOf(/** @type {HTMLElement} */ (document.activeElement));
  const next = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: shown.length - 1 }[event.key];
  if (next === undefined || !shown.length) return;
  event.preventDefault();
  shown[(next + shown.length) % shown.length].focus();
}

/**
 * @param {object} options
 * @param {HTMLElement} options.menu The [popover] element.
 * @param {() => HTMLElement[]} options.buttons The buttons that open it.
 * @param {string} options.anchor The CSS anchor name the menu is placed against.
 * @param {string} options.itemSelector Its items, for the arrow keys.
 * @param {() => void} [options.onOpen] Runs before it's shown.
 * @param {() => HTMLElement | null} [options.initialFocus] The item focused on opening (default: the first).
 * @param {boolean} [options.closeOnPick] Close when an item is clicked.
 * @param {() => boolean} [options.canOpen] False: a click on the button does something else (not opening it).
 */
export function bindMenu({
  menu,
  buttons,
  anchor,
  itemSelector,
  onOpen,
  initialFocus,
  closeOnPick = false,
  canOpen = () => true,
}) {
  const isOpen = () => menu.matches(":popover-open");
  let opener = null; // the button that opened the menu

  // Opens the menu under (or above) the button that asked for it, or closes
  // it if it was open. That button becomes the menu's anchor; CSS places the
  // menu against it and keeps it there (a resized window, a flip near an edge).
  function openFrom(button) {
    if (isOpen()) return menu.hidePopover();
    if (!canOpen()) return;
    for (const other of buttons()) other.style.removeProperty("anchor-name");
    button.style.setProperty("anchor-name", anchor);
    onOpen?.();
    menu.showPopover();
    opener = button;
    button.setAttribute("aria-expanded", "true");
    (initialFocus?.() ?? ownItems(menu, itemSelector)[0])?.focus();
  }

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
  menu.addEventListener("keydown", (event) => moveFocus(menu, itemSelector, event));
  // Closes (in the capture phase) before the item's own click handler runs,
  // so what it opens (a dialog, the file picker) isn't under the menu. This
  // takes in a side menu's items too (closing the menu closes its side
  // menu), but not the row that opens a side menu.
  if (closeOnPick) {
    menu.addEventListener(
      "click",
      (event) => {
        const item = /** @type {HTMLElement} */ (event.target).closest(itemSelector);
        if (item && !item.hasAttribute("aria-haspopup")) menu.hidePopover();
      },
      true,
    );
  }
  menu.addEventListener("toggle", (/** @type {any} */ event) => {
    if (event.newState !== "closed" || !opener) return;
    opener.setAttribute("aria-expanded", "false");
    if (menu.contains(document.activeElement) || document.activeElement === document.body) opener.focus();
    opener = null;
  });
}

/**
 * A side menu: a [popover] menu placed inside another one's element (which
 * makes it that menu's child: opening it leaves that menu open, and closing
 * that menu closes it), opened from one of that menu's rows, beside it.
 * Pointing at the row opens it after a moment, and so do a click, Enter
 * and →; ← and Esc close it again, back to the row. Pointing at another of
 * that menu's rows closes it.
 *
 * @param {object} options
 * @param {HTMLElement} options.parent The menu the row is in.
 * @param {HTMLElement} options.button The row (aria-haspopup="menu"; CSS gives it the anchor name the side menu is placed against).
 * @param {HTMLElement} options.menu The side menu's [popover] element, inside the parent's.
 * @param {string} options.itemSelector Its items, for the arrow keys.
 */
export function bindSubmenu({ parent, button, menu, itemSelector }) {
  const isOpen = () => menu.matches(":popover-open");
  let timer = 0;

  function open(/** @type {boolean} */ focusFirst) {
    clearTimeout(timer);
    if (!isOpen()) menu.showPopover();
    button.setAttribute("aria-expanded", "true");
    if (focusFirst) ownItems(menu, itemSelector)[0]?.focus();
  }
  function close() {
    clearTimeout(timer);
    if (isOpen()) menu.hidePopover();
  }

  onClick(button, () => open(true));
  button.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowRight") return;
    event.preventDefault();
    open(true);
  });
  // The pause lets the pointer cross the row on its way elsewhere.
  button.addEventListener("pointerenter", () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => open(false), 150);
  });
  button.addEventListener("pointerleave", () => clearTimeout(timer));
  parent.addEventListener("pointerover", (event) => {
    const row = /** @type {HTMLElement} */ (event.target).closest(itemSelector);
    if (row && row !== button && row.closest(".menu") === parent) close();
  });

  menu.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      close();
      button.focus();
      return;
    }
    moveFocus(menu, itemSelector, event);
  });
  // Closed (Esc, ←, a press in the parent menu): the browser hands the
  // keyboard back to what had it before; if that was nothing, to the row.
  menu.addEventListener("toggle", (/** @type {any} */ event) => {
    if (event.newState !== "closed") return;
    clearTimeout(timer);
    button.setAttribute("aria-expanded", "false");
    if (
      parent.matches(":popover-open") &&
      (document.activeElement === document.body || menu.contains(document.activeElement))
    )
      button.focus();
  });
}
