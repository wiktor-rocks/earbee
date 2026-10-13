// Security (last: its eval probe itself counts as a CSP violation).
// Part of the end-to-end run (see run.cjs); `h` is the harness.

module.exports = async function (h) {
  const { securityWarnings, js, check } = h;

  {
    const evalBlocked = await js(`(() => { try { eval("1"); return false; } catch { return true; } })()`);
    check("Content-Security-Policy is in force (eval blocked)", evalBlocked);
    check("no Electron security warnings", securityWarnings.length === 0, securityWarnings.join(" | "));
  }

  {
    // Downloads are served by a private URL (electron/media-files.js); a
    // URL the app didn't hand out serves nothing.
    const statuses = await js(
      `Promise.all(["scribee-media://00000000-0000-0000-0000-000000000000/x.mp3", "scribee-media://etc/passwd", "scribee-media://localhost/etc/passwd"].map((url) => fetch(url).then((r) => r.status, () => "refused")))`,
    );
    check(
      "only downloads are served by the media URL (404 otherwise)",
      statuses.every((s) => s === 404),
      JSON.stringify(statuses),
    );
  }
};
