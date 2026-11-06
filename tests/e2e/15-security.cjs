// Security (last: its eval probe itself counts as a CSP violation).
// Part of the end-to-end run (see run.cjs); `h` is the harness.

module.exports = async function (h) {
  const { securityWarnings, js, check, recentFiles } = h;

  {
    const evalBlocked = await js(`(() => { try { eval("1"); return false; } catch { return true; } })()`);
    check("Content-Security-Policy is in force (eval blocked)", evalBlocked);
    check("no Electron security warnings", securityWarnings.length === 0, securityWarnings.join(" | "));
  }

  {
    // Downloads are served by a private URL (electron/media-files.js); a
    // URL the app didn't hand out serves nothing.
    const statuses = await js(
      `Promise.all(["earbee-media://00000000-0000-0000-0000-000000000000/x.mp3", "earbee-media://etc/passwd", "earbee-media://localhost/etc/passwd"].map((url) => fetch(url).then((r) => r.status, () => "refused")))`,
    );
    check(
      "only downloads are served by the media URL (404 otherwise)",
      statuses.every((s) => s === 404),
      JSON.stringify(statuses),
    );
  }

  {
    // Recent files (electron/recent-files.js): the page names an entry by
    // its id, never by a path, and can't put a path of its own on the list.
    const functions = await js(`Object.keys(earbee.recent).sort()`);
    check(
      "the recent files' bridge has only its six functions",
      functions.join() === "clear,list,note,onChanged,open,remove",
      functions.join(),
    );
    const before = JSON.stringify(recentFiles.list());
    const opened = await js(`earbee.recent.open("/etc/passwd")`);
    check("a path doesn't open as a recent file", opened.ok === false && !opened.media, JSON.stringify(opened));
    await js(
      `Promise.all(["/etc/passwd", "file:///etc/passwd", "earbee-media://etc/passwd"].map((url) => earbee.recent.note(url)))`,
    );
    check(
      "a path doesn't go on the recent list",
      JSON.stringify(recentFiles.list()) === before,
      JSON.stringify(recentFiles.list()),
    );
  }
};
