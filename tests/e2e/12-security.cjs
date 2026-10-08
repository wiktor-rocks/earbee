// Security (last: its eval probe itself counts as a CSP violation).
// Part of the end-to-end run (see run.cjs); `h` is the harness.

module.exports = async function (h) {
  const { securityWarnings, js, check } = h;

  {
    const evalBlocked = await js(`(() => { try { eval("1"); return false; } catch { return true; } })()`);
    check("Content-Security-Policy is in force (eval blocked)", evalBlocked);
    check("no Electron security warnings", securityWarnings.length === 0, securityWarnings.join(" | "));
  }
};
