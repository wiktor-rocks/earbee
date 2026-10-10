// Big video (src/features/big-video.js): the picture large and edge to
// edge with the rest put away, by F, its button and a double-click; the
// waveform held at fit and given its zoom back; with the video window;
// from video to video; and off for an audio file.
// Part of the end-to-end run (see run.cjs); `h` is the harness.
const path = require("path");

module.exports = async function (h) {
  const { js, key, check, sleep, shot, openFile, videoWin, FIXTURES } = h;
  const VIDEO = path.join(FIXTURES, "counter.webm");

  const layout = () =>
    js(`(() => {
      const shown = (selector) => getComputedStyle(document.querySelector(selector)).display !== "none";
      const host = document.querySelector("#waveform > div").shadowRoot;
      const pane = document.getElementById("videoPane");
      const box = pane.getBoundingClientRect();
      return {
        big: document.getElementById("app").classList.contains("big-video"),
        topbar: shown(".topbar"),
        dock: shown(".dock"),
        sidebar: shown(".sidebar"),
        minimap: shown(".waveform-minimap"),
        transport: shown(".transport"),
        pane: box.height / innerHeight,
        edges: box.left === 0 && box.top === 0 && Math.abs(box.right - innerWidth) < 1,
        radius: getComputedStyle(pane).borderTopLeftRadius,
        scrollWidth: host.querySelector(".scroll").scrollWidth,
        fit: host.querySelector(".scroll").scrollWidth <= host.querySelector(".scroll").clientWidth + 2,
        timeline: document.querySelector(".timeline").getBoundingClientRect().height,
        wave: document.getElementById("waveform").clientHeight,
        drawn: host.querySelector(".scroll").clientHeight,
        sidebarKey: localStorage.getItem("transcribee.sidebarHidden"),
      };
    })()`);
  const isNormal = (l) => !l.big && l.topbar && l.dock && l.minimap && l.timeline >= 170;
  // The wheel over the waveform (zooms in, unless held at fit).
  const wheelIn = () =>
    js(`(() => {
      const wave = document.getElementById("waveform");
      const r = wave.getBoundingClientRect();
      wave.dispatchEvent(new WheelEvent("wheel", { deltaY: -800, clientX: r.left + 40, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }));
    })()`);
  const doubleClickPicture = async () => {
    const at = await js(
      `(() => { const r = document.getElementById("videoPane").getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`,
    );
    for (const clickCount of [1, 2]) {
      h.wc.sendInputEvent({ type: "mouseDown", ...at, button: "left", clickCount });
      h.wc.sendInputEvent({ type: "mouseUp", ...at, button: "left", clickCount });
    }
    await sleep(400);
  };

  await openFile(VIDEO);
  await sleep(300);
  await wheelIn();
  await sleep(300);
  const before = await layout();
  check("a video opens at the usual size", isNormal(before), JSON.stringify(before));
  check("…and its waveform can be zoomed in", !before.fit, JSON.stringify(before));

  key("F");
  await sleep(500);
  let l = await layout();
  check(
    "F makes the video big: top bar, dock, sidebar and minimap put away",
    l.big && !l.topbar && !l.dock && !l.sidebar && !l.minimap && l.transport,
    JSON.stringify(l),
  );
  check("…the picture takes most of the window", l.pane >= 0.85, String(l.pane));
  check("…edge to edge, with square corners", l.edges && l.radius === "0px", JSON.stringify(l));
  check(
    "…a thin waveform stays, drawn at its height",
    l.wave >= 20 && l.timeline <= 40 && Math.abs(l.drawn - l.wave) <= 1,
    JSON.stringify(l),
  );
  check("…showing the whole track", l.fit, JSON.stringify(l));
  await wheelIn();
  await sleep(300);
  check("…which the wheel doesn't zoom", (await layout()).fit);
  check("…the sidebar's own choice is untouched", l.sidebarKey === before.sidebarKey, String(l.sidebarKey));
  await shot("big-video.png");

  key("F");
  await sleep(500);
  l = await layout();
  check("F again brings the usual layout back", isNormal(l) && l.sidebar === before.sidebar, JSON.stringify(l));
  check(
    "…and the waveform's zoom",
    Math.abs(l.scrollWidth - before.scrollWidth) <= 2,
    `${before.scrollWidth} → ${l.scrollWidth}`,
  );

  await js(`document.querySelector(".big-video-button").click()`);
  await sleep(300);
  check("the button over the picture makes it big", (await layout()).big);
  check(
    "…and says how to go back",
    (await js(`document.querySelector(".big-video-button").getAttribute("aria-pressed")`)) === "true",
  );

  await doubleClickPicture();
  check("a double-click on the picture goes back", isNormal(await layout()));
  await doubleClickPicture();
  check("…and another makes it big again", (await layout()).big);

  key("V");
  await sleep(800);
  l = await layout();
  check(
    "with the video in its own window, the main window has its usual layout and zoom",
    videoWin() !== null && l.topbar && l.dock && l.minimap && !l.fit,
    JSON.stringify(l),
  );
  key("V");
  await sleep(800);
  l = await layout();
  check(
    "bringing the video back makes it big again",
    videoWin() === null && l.big && !l.topbar && l.fit,
    JSON.stringify(l),
  );

  await openFile(VIDEO);
  await sleep(300);
  l = await layout();
  check("the next video stays big, its whole track in view", l.big && !l.topbar && l.fit, JSON.stringify(l));

  await openFile(path.join(FIXTURES, "tone.wav"));
  await sleep(300);
  l = await layout();
  check("an audio file turns big video off", !l.big && l.topbar && l.dock, JSON.stringify(l));
  key("F");
  await sleep(300);
  check("…and F does nothing then", !(await layout()).big);
};
