// Report a bug's links (src/core/bug-report.js): the email and the GitHub
// issue, the only ones the main process opens for it.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  REPORT_BODY,
  REPORT_EMAIL,
  REPORT_ISSUE_URL,
  REPORT_SUBJECT,
  mailtoLink,
  reportAddress,
  reportLink,
} from "../../src/core/bug-report.js";

test("mailtoLink encodes the subject and body, line breaks as CRLF", () => {
  assert.equal(
    mailtoLink("a@example.org", "A bug & more", "Line one\nLine two?"),
    "mailto:a@example.org?subject=A%20bug%20%26%20more&body=Line%20one%0D%0ALine%20two%3F",
  );
});

test("the email goes to contact@earbee.org, and reads back as its subject and body", () => {
  const link = new URL(reportLink("email"));
  assert.equal(link.protocol, "mailto:");
  assert.equal(link.pathname, REPORT_EMAIL);
  assert.equal(REPORT_EMAIL, "contact@earbee.org");
  assert.equal(link.searchParams.get("subject"), REPORT_SUBJECT);
  assert.equal(link.searchParams.get("body"), REPORT_BODY.replace(/\n/g, "\r\n"));
  assert.match(REPORT_BODY, /What I did:[\s\S]*What happened:[\s\S]*What I expected:[\s\S]*clipboard/);
});

test("the GitHub way opens the repository's bug report form", () => {
  assert.equal(reportLink("github"), REPORT_ISSUE_URL);
  const url = new URL(REPORT_ISSUE_URL);
  assert.equal(url.origin + url.pathname, "https://github.com/wiktor-rocks/earbee/issues/new");
  assert.equal(url.searchParams.get("template"), "bug_report.yml");
});

test("anything else opens nothing", () => {
  for (const way of ["", "https://example.org", "file:///etc/passwd", null, undefined, 1, {}]) {
    assert.equal(reportLink(way), null, String(way));
  }
});

test("the addresses to go to by hand", () => {
  assert.equal(reportAddress("email"), "contact@earbee.org");
  assert.equal(reportAddress("github"), "github.com/wiktor-rocks/earbee/issues");
});
