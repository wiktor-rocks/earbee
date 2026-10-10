// Static UI and offline: generated scales, bundled fonts, the shortcuts list.
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

  // The shortcuts are listed by group, in a dialog that starts closed
  // (opening it is checked in 14-marks, once the player is on screen).
  check(
    "the shortcuts are grouped",
    (await js(`[...document.querySelectorAll("#shortcutList h3")].map((h) => h.textContent).join("|")`)) ===
      "File|Playback|Moving around|A–B loop|Marks|Video|Help", // Video window (src/features/video-window/): "Video"
  );
  check("the shortcuts dialog starts closed", !(await js(`shortcutsDialog.open`)));
  // Nothing can be highlighted, except text in fields being edited.
  check(
    "no text selection, except in text fields",
    await js(`(() => {
      const select = (el) => getComputedStyle(el).userSelect;
      return [document.body, document.querySelector(".welcome-title"), document.getElementById("trackTime")].every((el) => select(el) === "none") &&
        select(document.getElementById("downloadUrl")) === "text";
    })()`),
  );
};
