/* =====================================================================
 * THE RIGHT-CLICK MENU
 * One menu (#contextMenu), filled on each right-click with the items of
 * whatever was clicked. Each feature says what its things offer, with
 * addContextMenu(provider): given the right-click, a provider returns its
 * items if the click is on something of its own, or null; the first one
 * to answer wins. A right-click no provider answers is left alone.
 *
 * The menu opens at the pointer, or, from the keyboard (Shift+F10, the
 * Menu key), at the focused element. ↑ / ↓ move between its items, Esc or
 * a click elsewhere closes it, and a chosen item closes it, then runs.
 * While it's open, the app's keys wait (app.js, keysBlocked).
 * ===================================================================== */

import { element } from "./dom.js";
import { moveFocus } from "./menu.js";

/**
 * @typedef {object} ContextItem
 * @property {string} label
 * @property {string} [keys] A key that does the same, shown at the right.
 * @property {() => void} run
 *
 * @typedef {(event: MouseEvent) => ContextItem[] | null} ContextProvider
 */

/** @type {ContextProvider[]} */
const providers = [];
const menu = /** @type {HTMLElement} */ (document.getElementById("contextMenu"));
// Where the menu opens: a point the menu's CSS is anchored to (style.css,
// .context-menu), so it flips at the window's edges like the other menus.
const anchor = /** @type {HTMLElement} */ (document.getElementById("contextMenuAnchor"));
/** @type {Element | null} */
let returnTo = null; // what had the focus before it opened

/**
 * Adds what a feature's things offer on a right-click.
 * @param {ContextProvider} provider
 */
export function addContextMenu(provider) {
  providers.push(provider);
}

export const isContextMenuOpen = () => menu.matches(":popover-open");

/** @param {ContextItem[]} items @param {number} x @param {number} y */
function open(items, x, y) {
  menu.replaceChildren(
    ...items.map((item) => {
      const button = element(
        "button",
        { className: "menu-item", type: "button", role: "menuitem" },
        element("span", { className: "menu-label" }, item.label),
        ...(item.keys ? [element("span", { className: "menu-keys" }, item.keys)] : []),
      );
      button.addEventListener("click", () => {
        menu.hidePopover();
        item.run();
      });
      return button;
    }),
  );
  anchor.style.left = `${x}px`;
  anchor.style.top = `${y}px`;
  returnTo = document.activeElement;
  if (isContextMenuOpen()) menu.hidePopover();
  menu.showPopover();
  /** @type {HTMLElement | null} */ (menu.querySelector(".menu-item"))?.focus();
}

export function bindContextMenu() {
  // On Linux (and a Mac) "contextmenu" comes with the press of the right
  // button; the release that follows would count as a click outside the
  // menu and close it at once. So while the button is held, the menu opens
  // once it's let go. (On Windows it comes after the release: at once.)
  let rightHeld = false;
  document.addEventListener("pointerdown", (event) => event.button === 2 && (rightHeld = true), true);
  document.addEventListener("pointerup", (event) => event.button === 2 && (rightHeld = false), true);
  document.addEventListener("pointercancel", () => (rightHeld = false), true); // (no button said)
  const openWhenLetGo = (/** @type {() => void} */ show) => {
    if (!rightHeld) return show();
    window.addEventListener("pointerup", () => setTimeout(show), { once: true, capture: true });
  };

  document.addEventListener(
    "contextmenu",
    (event) => {
      for (const provider of providers) {
        const items = provider(event);
        if (!items?.length) continue;
        event.preventDefault();
        // From the keyboard (no right button): at the element.
        const fromKeys = event.button !== 2;
        const box = /** @type {Element} */ (event.target).getBoundingClientRect?.();
        const [x, y] = fromKeys && box ? [box.left + 8, box.bottom] : [event.clientX, event.clientY];
        openWhenLetGo(() => open(items, x, y));
        return;
      }
    },
    true,
  );
  menu.addEventListener("keydown", (event) => moveFocus(menu, ".menu-item", event));
  menu.addEventListener("toggle", (/** @type {any} */ event) => {
    if (event.newState !== "closed") return;
    // Back where it was, if that's still there and nothing else took it.
    const back = returnTo;
    returnTo = null;
    if (
      back instanceof HTMLElement &&
      back.isConnected &&
      (menu.contains(document.activeElement) || document.activeElement === document.body)
    )
      back.focus();
  });
}
