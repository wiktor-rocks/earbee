/* =====================================================================
 * UPDATES
 * A pill in the top bar (and in the welcome screen's corner) once there's
 * a newer EarBee, from the main process (electron/updates.js, which
 * checks while Settings › General › Check for updates is on):
 *   ready      On Windows and Linux, it's downloaded and installs when
 *              EarBee quits: "Update ready". A click opens a menu with
 *              "Restart and update now" (each window asks about unsaved
 *              work first, as when quitting).
 *   available  On a Mac, which can't update itself: "EarBee 0.3.1 is out".
 *              A click opens the release's page, to download it.
 * Nothing shows outside a packaged EarBee: the main process doesn't check.
 *
 * Removing it means deleting this file, its part in style.css ("Update
 * pill"), electron/updates.js and the lines marked "Updates (".
 * ===================================================================== */

import { $, onClick } from "../ui/dom.js";
import { bindMenu } from "../ui/menu.js";

/** @typedef {null | { kind: "ready", version: string } | { kind: "available", version: string, url: string }} UpdateState */

export function bindUpdates() {
  const bridge = /** @type {any} */ (window).earbee?.updates;
  if (!bridge) return; // a plain browser
  const pills = [$("updatePill"), $("welcomeUpdatePill")];
  /** @type {UpdateState} */
  let state = null;

  /** @param {UpdateState} next */
  function render(next) {
    state = next;
    for (const pill of pills) {
      pill.hidden = !state;
      if (!state) continue;
      const ready = state.kind === "ready";
      pill.textContent = ready ? "Update ready" : `EarBee ${state.version} is out`;
      pill.title = ready
        ? `EarBee ${state.version} will be installed when you quit`
        : `Open the page to download EarBee ${state.version}`;
      if (ready) pill.setAttribute("aria-haspopup", "menu");
      else pill.removeAttribute("aria-haspopup");
    }
    if (state?.kind === "ready")
      $("updateMenuNote").textContent = `EarBee ${state.version} is downloaded. It's installed when you quit.`;
  }

  // Ready: the menu. Available: the page, straight away.
  bindMenu({
    menu: $("updateMenu"),
    buttons: () => pills,
    anchor: "--update-pill",
    itemSelector: ".menu-item",
    closeOnPick: true,
    canOpen: () => state?.kind === "ready",
  });
  for (const pill of pills) onClick(pill, () => state?.kind === "available" && bridge.openRelease());
  onClick($("updateRestart"), () => bridge.restart());

  bridge.onState(render);
  bridge.state().then((current) => current && render(current));
}
