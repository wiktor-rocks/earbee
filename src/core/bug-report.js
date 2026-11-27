// Report a bug (features/report-bug.js): where a report goes, and the
// links that start one. Pure, and shared with the main process
// (electron/main-log.js), which opens them: the page only names the way
// ("email" or "github"), never a link, so it can't open anything else.

/** @typedef {"email" | "github"} ReportWay */

export const REPORT_EMAIL = "contact@earbee.org";

// The bug report form of the repository's issues (.github/ISSUE_TEMPLATE/
// bug_report.yml); the log goes under its "Anything else".
export const REPORT_ISSUE_URL = "https://github.com/wiktor-rocks/earbee/issues/new?template=bug_report.yml";

export const REPORT_SUBJECT = "EarBee bug report";

// What the email starts with: what to describe, then room for the log,
// which the page has put on the clipboard.
export const REPORT_BODY = [
  "What I did:",
  "",
  "",
  "What happened:",
  "",
  "",
  "What I expected:",
  "",
  "",
  "EarBee's log (it's on the clipboard: paste it below):",
  "",
  "",
].join("\n");

/**
 * A mailto: link to `address` with a subject and a body, each encoded
 * (RFC 6068: line breaks as %0D%0A, spaces as %20, not +).
 * @param {string} address
 * @param {string} subject
 * @param {string} body
 */
export function mailtoLink(address, subject, body) {
  const encode = (text) => encodeURIComponent(text.replace(/\r?\n/g, "\r\n"));
  return `mailto:${address}?subject=${encode(subject)}&body=${encode(body)}`;
}

/**
 * The link that starts a report the given way; null for anything else.
 * @param {unknown} way
 * @returns {string | null}
 */
export function reportLink(way) {
  if (way === "email") return mailtoLink(REPORT_EMAIL, REPORT_SUBJECT, REPORT_BODY);
  if (way === "github") return REPORT_ISSUE_URL;
  return null;
}

// The issues' page as it's typed, without the form's part.
export const REPORT_ISSUES_SHORT = "github.com/wiktor-rocks/earbee/issues";

/**
 * Where to go by hand if the link couldn't be opened: the address to
 * write to, or the page to type into the browser.
 * @param {ReportWay} way
 */
export const reportAddress = (way) => (way === "email" ? REPORT_EMAIL : REPORT_ISSUES_SHORT);
