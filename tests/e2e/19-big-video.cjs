// Big video (src/features/big-video.js): the picture large and edge to
// edge with the rest put away, by F, its button and a double-click; the
// waveform held at fit and given its zoom back; with the video window;
// from video to video; and off for an audio file. Also the stage split
// handle (src/features/stage-split.js) between the picture and the
// timeline, which these layouts hide.
// Part of the end-to-end run (see run.cjs); `h` is the harness.
const path = require("path");

module.exports = async function (h) {
  const { js, key, click, pos, check, sleep, shot, openFile, videoWin, FIXTURES } = h;
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
        transportHeight: document.querySelector(".transport").getBoundingClientRect().height,
        pane: box.height / innerHeight,
        edges: box.left === 0 && box.top === 0 && Math.abs(box.right - innerWidth) < 1,
        radius: getComputedStyle(pane).borderTopLeftRadius,
        scrollWidth: host.querySelector(".scroll").scrollWidth,
        fit: host.querySelector(".scroll").scrollWidth <= host.querySelector(".scroll").clientWidth + 2,
        timeline: document.querySelector(".timeline").getBoundingClientRect().height,
        wave: document.getElementById("waveform").clientHeight,
        drawn: host.querySelector(".scroll").clientHeight,
        sidebarKey: localStorage.getItem("earbee.sidebarHidden"),
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

  // The stage split handle: in the gap above the timeline; a drag trades
  // the picture's height for the timeline's, down to 110 px of timeline
  // (CONFIG.stage.minTimeline).
  const split = () =>
    js(`(() => {
      const handle = document.querySelector(".stage-split");
      const r = handle.getBoundingClientRect();
      return {
        shown: getComputedStyle(handle).display !== "none",
        top: r.top, bottom: r.bottom, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
        pane: document.getElementById("videoPane").getBoundingClientRect().bottom,
        timelineTop: document.querySelector(".timeline").getBoundingClientRect().top,
        timeline: document.querySelector(".timeline").getBoundingClientRect().height,
        video: document.getElementById("videoPane").getBoundingClientRect().height,
        share: document.getElementById("stage").style.getPropertyValue("--timeline-share"),
      };
    })()`);
  const dragSplit = async (dy) => {
    const { x, y } = await split();
    h.wc.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
    for (let i = 1; i <= 6; i++) {
      h.wc.sendInputEvent({ type: "mouseMove", x, y: Math.round(y + (dy * i) / 6), button: "left" });
      await sleep(30);
    }
    h.wc.sendInputEvent({ type: "mouseUp", x, y: y + dy, button: "left", clickCount: 1 });
    await sleep(300);
  };
  const s0 = await split();
  check(
    "the split handle shows with a video, in the gap above the timeline",
    s0.shown && Math.abs(s0.top - s0.pane) < 1 && Math.abs(s0.bottom - s0.timelineTop) < 1,
    JSON.stringify(s0),
  );
  await dragSplit(-100);
  let s1 = await split();
  check(
    "dragging it up 100 px: the timeline 100 px taller, the picture 100 px shorter",
    Math.abs(s1.timeline - s0.timeline - 100) < 4 && Math.abs(s0.video - s1.video - 100) < 4,
    `${JSON.stringify(s0)} → ${JSON.stringify(s1)}`,
  );
  await dragSplit(1000);
  s1 = await split();
  check("dragging it far down stops the timeline at 110 px", Math.abs(s1.timeline - 110) < 1.5, JSON.stringify(s1));
  await shot("stage-split.png");
  // Back to a timeline as tall as before plus 80 px, so the usual-layout
  // checks below hold, with the share still set (a new file resets it).
  await dragSplit(-Math.round(s0.timeline + 80 - 110));
  s1 = await split();
  check("…and back up", Math.abs(s1.timeline - s0.timeline - 80) < 4 && s1.share !== "", JSON.stringify(s1));

  // While dragging, the picture stays on screen (drawn back at once,
  // scaled; video-worker.js resizeSurface) and the waveform's drawing is
  // stretched; once the drag stops, it's drawn again at its new height.
  const waveLayers = `document.querySelector("#waveform > div").shadowRoot.querySelector(".canvases")`;
  {
    const { x, y } = await split();
    h.wc.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
    for (let i = 1; i <= 3; i++) {
      h.wc.sendInputEvent({ type: "mouseMove", x, y: y - 20 * i, button: "left" });
      await sleep(30);
    }
    const mid = await js(`(() => {
      const r = document.getElementById("videoPane").getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), stretched: ${waveLayers}.style.transform };
    })()`);
    const [blue, green, red] = (await h.wc.capturePage({ x: mid.x, y: mid.y, width: 1, height: 1 })).toBitmap();
    h.wc.sendInputEvent({ type: "mouseUp", x, y: y - 60, button: "left", clickCount: 1 });
    check("while dragging, the picture stays on screen", red + green + blue > 60, `rgb ${red} ${green} ${blue}`);
    check(
      "…and the waveform's drawing is stretched to the new height",
      mid.stretched.startsWith("scaleY("),
      mid.stretched,
    );
    await sleep(600);
    const settled = await js(`(() => {
      const layers = ${waveLayers};
      return { stretched: layers.style.transform, drawn: parseFloat(layers.style.minHeight), height: document.querySelector("#waveform > div").shadowRoot.querySelector(".scroll").clientHeight };
    })()`);
    check(
      "once the drag stops, the waveform is drawn at its new height, unstretched",
      settled.stretched === "" && Math.abs(settled.drawn - settled.height) < 2,
      JSON.stringify(settled),
    );
  }

  // A slow drag, pausing long enough for a redraw now and then: after each
  // move and each pause, the drawing fills the waveform's height exactly
  // (it once came out stretched twice over after a redraw mid-drag).
  {
    const fills = () =>
      js(`(() => {
        const drawn = ${waveLayers}.getBoundingClientRect().height;
        const height = document.querySelector("#waveform > div").shadowRoot.querySelector(".scroll").clientHeight;
        return { drawn: Math.round(drawn), height };
      })()`);
    const { x, y } = await split();
    const seen = [];
    h.wc.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
    for (let i = 1; i <= 4; i++) {
      h.wc.sendInputEvent({ type: "mouseMove", x, y: y - 15 * i, button: "left" });
      await sleep(30);
      seen.push(await fills());
      await sleep(250);
      seen.push(await fills());
    }
    h.wc.sendInputEvent({ type: "mouseUp", x, y: y - 60, button: "left", clickCount: 1 });
    await sleep(400);
    seen.push(await fills());
    check(
      "a slow drag: the drawing fills the waveform's height all along",
      seen.every(({ drawn, height }) => Math.abs(drawn - height) <= 2),
      JSON.stringify(seen),
    );
  }

  key("F");
  await sleep(500);
  let l = await layout();
  check(
    "F makes the video big: top bar, dock, sidebar and minimap put away",
    l.big && !l.topbar && !l.dock && !l.sidebar && !l.minimap && l.transport,
    JSON.stringify(l),
  );
  check("…and the split handle", !(await split()).shown);
  check("…the picture takes most of the window", l.pane >= 0.85, String(l.pane));
  check("…edge to edge, with square corners", l.edges && l.radius === "0px", JSON.stringify(l));
  check(
    "…a thin waveform stays, drawn at its height",
    l.wave >= 20 && l.timeline <= 40 && Math.abs(l.drawn - l.wave) <= 1,
    JSON.stringify(l),
  );
  check("…showing the whole track", l.fit, JSON.stringify(l));
  check("…and a compact transport", l.transportHeight <= 44, String(l.transportHeight));
  await wheelIn();
  await sleep(300);
  check("…which the wheel doesn't zoom", (await layout()).fit);
  check("…the sidebar's own choice is untouched", l.sidebarKey === before.sidebarKey, String(l.sidebarKey));
  await shot("big-video.png");
  await click(15); // past what the zoomed-in view showed before (the start)
  await sleep(300);
  const at = await pos();

  key("F");
  await sleep(500);
  l = await layout();
  check("F again brings the usual layout back", isNormal(l) && l.sidebar === before.sidebar, JSON.stringify(l));
  check(
    "…and the waveform's zoom",
    Math.abs(l.scrollWidth - before.scrollWidth) <= 2,
    `${before.scrollWidth} → ${l.scrollWidth}`,
  );
  const shown = await js(`(() => {
    const scroll = document.querySelector("#waveform > div").shadowRoot.querySelector(".scroll");
    return { from: scroll.scrollLeft / scroll.scrollWidth, to: (scroll.scrollLeft + scroll.clientWidth) / scroll.scrollWidth };
  })()`);
  const fraction = at / 20.013; // counter.webm's length
  check(
    "…showing where playback is now",
    fraction >= shown.from && fraction <= shown.to,
    `${at.toFixed(2)} s at ${fraction.toFixed(2)}, view ${shown.from.toFixed(2)}–${shown.to.toFixed(2)}`,
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
  key("Escape");
  await sleep(300);
  check("Esc goes back", isNormal(await layout()));
  key("Escape");
  await sleep(100);
  check("…and does nothing more then", isNormal(await layout()));
  await doubleClickPicture();
  check("…and a double-click makes it big again", (await layout()).big);

  key("V");
  await sleep(800);
  l = await layout();
  check(
    "with the video in its own window, the main window has its usual layout and zoom",
    videoWin() !== null && l.topbar && l.dock && l.minimap && !l.fit,
    JSON.stringify(l),
  );
  check("…without the split handle", !(await split()).shown);
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
  check("…and its split back to the default", (await split()).share === "");

  await openFile(path.join(FIXTURES, "tone.wav"));
  await sleep(300);
  l = await layout();
  check("an audio file turns big video off", !l.big && l.topbar && l.dock, JSON.stringify(l));
  check("…and has no split handle", !(await split()).shown);
  key("F");
  await sleep(300);
  check("…and F does nothing then", !(await layout()).big);
};
