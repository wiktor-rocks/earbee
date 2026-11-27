/* =====================================================================
 * REPORT A BUG
 * "Report a bug…" on the welcome screen (in its corner, beside the gear)
 * and in Settings › Notifications (beside Copy and Clear, where the log
 * is). A click puts the whole notification log on the clipboard (copyLog,
 * features/notification-log.js), then opens a small dialog that says so
 * and offers two ways to send it, as the owner chose: an email to
 * contact@earbee.org from the mail app, or a new issue on GitHub in the
 * browser. The main process opens them (report:open in
 * electron/main-log.js) from the fixed links in core/bug-report.js; if it
 * can't, the dialog gives the address to type instead.
 * Outside Electron (a plain browser) nothing could open them, so the
 * buttons stay hidden.
 * ===================================================================== */

import { reportAddress } from "../core/bug-report.js";
import { $, element, onClick } from "../ui/dom.js";
import { copyLog } from "./notification-log.js";

/** @typedef {import("../core/bug-report.js").ReportWay} ReportWay */

const dialog = /** @type {HTMLDialogElement} */ ($("reportDialog"));
const copied = $("reportCopied");
const message = $("reportMessage");
/** @type {{ openReport?: (way: ReportWay) => Promise<boolean> } | undefined} */
const bridge = /** @type {any} */ (window).earbee;
export const canReportBug = Boolean(bridge?.openReport);
let opener = null; // the button that opened the dialog, to give focus back to

export const isReportOpen = () => dialog.open;

const COPIED = "EarBee's log is on your clipboard.";
const NOT_COPIED =
  "Couldn't put EarBee's log on the clipboard. Open Settings › Notifications and press Copy, then paste it into your report.";

// Opened at once, while the click still counts as the user's (a dialog
// opened without that closes with the one under it on Esc: Settings),
// then the log is copied and the first line says how that went.
/** @param {HTMLElement} button */
async function openReport(button) {
  if (dialog.open) return;
  opener = button;
  message.textContent = "";
  copied.textContent = "Copying EarBee's log…";
  copied.classList.remove("report-done", "report-failed");
  dialog.showModal();
  let ok = true;
  try {
    await copyLog("Report a bug");
  } catch (error) {
    console.warn("Couldn't copy the log for a bug report:", error);
    ok = false;
  }
  copied.textContent = ok ? COPIED : NOT_COPIED;
  copied.classList.add(ok ? "report-done" : "report-failed");
}

// The mail app or the browser; once it's open the dialog has done its
// job. If it didn't open, the address to go to by hand.
/** @param {ReportWay} way */
async function send(way) {
  message.textContent = "";
  if (await bridge.openReport(way)) return dialog.close();
  message.textContent =
    way === "email"
      ? `Couldn't open your mail app. Write to ${reportAddress(way)}, and paste the log into the email.`
      : `Couldn't open your browser. Go to ${reportAddress(way)}, choose "New issue", and paste the log into it.`;
}

/**
 * A "Report a bug…" button for Settings › Notifications; null outside
 * Electron.
 * @returns {HTMLButtonElement | null}
 */
export function reportBugButton() {
  if (!canReportBug) return null;
  const button = element("button", { type: "button", className: "small report-bug", textContent: "Report a bug…" });
  button.title = "Copy the log and send it to EarBee, by email or on GitHub";
  button.setAttribute("aria-haspopup", "dialog");
  onClick(button, () => openReport(button));
  return button;
}

export function bindReportBug() {
  if (!canReportBug) return; // a plain browser: the welcome button stays hidden
  const welcomeButton = $("welcomeReportBug");
  welcomeButton.hidden = false;
  onClick(welcomeButton, () => openReport(welcomeButton));
  onClick($("reportEmail"), () => send("email"));
  onClick($("reportGithub"), () => send("github"));
  onClick($("reportClose"), () => dialog.close());
  // A click on the backdrop (outside the dialog's box) closes it too.
  dialog.addEventListener("click", (event) => event.target === dialog && dialog.close());
  dialog.addEventListener("close", () => {
    opener?.focus();
    opener = null;
  });
}
