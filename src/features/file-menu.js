// The File menu, opened by File in the top bar: Open…, Save, Save as… and
// From YouTube…. Save and Save as… are wired in features/project, From
// YouTube… in features/download.js (both only in Electron); each item
// closes the menu before it runs.
import { dom, onClick } from "../ui/dom.js";
import { bindMenu } from "../ui/menu.js";

export const isFileMenuOpen = () => dom.fileMenu.matches(":popover-open");

export function bindFileMenu() {
  bindMenu({
    menu: dom.fileMenu,
    buttons: () => [dom.fileMenuButton],
    anchor: "--file-open",
    itemSelector: ".menu-item",
    closeOnPick: true,
  });
  onClick(dom.openButton, () => dom.fileInput.click());
}
