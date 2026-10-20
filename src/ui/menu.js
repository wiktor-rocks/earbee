/* =====================================================================
 * POPOVER MENUS
 * A [popover] menu opened by one or more buttons: the colour-theme menu
 * (features/settings.js), the File menu (features/file-menu.js) and the
 * beats menu (features/beats.js).
 * ===================================================================== */

import { onClick } from "./dom.js";

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
  const items = () => /** @type {HTMLElement[]} */ ([...menu.querySelectorAll(itemSelector)]);

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
    (initialFocus?.() ?? items().find((item) => !item.hidden))?.focus();
  }

  // ↑ / ↓ move between the items; Home / End jump to the ends.
  function moveFocus(event) {
    const shown = items().filter((item) => !item.hidden);
    const index = shown.indexOf(/** @type {HTMLElement} */ (document.activeElement));
    const next = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: shown.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    shown[(next + shown.length) % shown.length].focus();
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
  menu.addEventListener("keydown", moveFocus);
  // Closes (in the capture phase) before the item's own click handler runs,
  // so what it opens (a dialog, the file picker) isn't under the menu.
  if (closeOnPick) {
    menu.addEventListener(
      "click",
      (event) => {
        if (/** @type {HTMLElement} */ (event.target).closest(itemSelector)) menu.hidePopover();
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
