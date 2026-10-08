// Static UI and offline: generated scales, bundled fonts, the legend.
// Part of the end-to-end run (see run.cjs); `h` is the harness.

module.exports = async function (h) {
  const { js, check } = h;

  check("speed scale generated", (await js(`document.getElementById("speedScale").textContent`)) === "0.25×3×");
  check("volume scale generated", (await js(`document.getElementById("volumeScale").textContent`)) === "0%100%200%");
  await js(`document.fonts.ready`);
  check(
    "Nunito loaded offline",
    (await js(`document.fonts.check('16px "Nunito Variable"')`)) &&
      (await js(`[...document.fonts].some(f => f.family.includes("Nunito") && f.status === "loaded")`)),
  );
  check(
    "Righteous loaded offline",
    await js(`[...document.fonts].some(f => f.family.includes("Righteous") && f.status === "loaded")`),
  );
  check(
    "legend has Shift+L",
    (await js(`document.getElementById("shortcutList").textContent`)).includes("Shift+LClear loop"),
  );
};
