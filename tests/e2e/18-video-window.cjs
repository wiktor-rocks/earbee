// Video window (src/features/video-window/): the video out in a window of
// its own and back, what the main window shows meanwhile, keys there,
// "always on top", and what is remembered.
// Part of the end-to-end run (see run.cjs); `h` is the harness.
const { app } = require("electron");
const fs = require("fs");
const path = require("path");

module.exports = async function (h) {
  const { js, key, click, pos, playing, openFile, ensurePaused, videoWin, check, sleep, shot, FIXTURES, OUTPUT } = h;
  const VIDEO = path.join(FIXTURES, "counter.webm");

  // What the main window shows.
  const stage = () =>
    js(`(() => {
      const stage = document.getElementById("stage");
      const strip = document.querySelector(".video-away");
      return {
        video: stage.classList.contains("has-video"),
        popped: stage.classList.contains("video-popped"),
        strip: Boolean(strip && !strip.hidden),
        pane: !document.getElementById("videoPane").hidden,
      };
    })()`);
  const frameIn = (contents) =>
    contents.executeJavaScript(
      `(() => { const t = document.querySelector("canvas")?.dataset.frameTime; return t === undefined ? null : Number(t); })()`,
    );
  const inWindow = (code) => videoWin().webContents.executeJavaScript(code);

  await openFile(VIDEO);
  let s = await stage();
  check(
    "a video starts in the main window",
    s.video && !s.popped && !s.strip && s.pane && !videoWin(),
    JSON.stringify(s),
  );

  key("V");
  await sleep(800);
  check("V opens the video window", videoWin() !== null);
  s = await stage();
  check(
    "meanwhile the main window looks as for an audio file, with the strip",
    !s.video && s.popped && s.strip && !s.pane,
    JSON.stringify(s),
  );
  await sleep(400);
  const wave = await js(
    `(() => { const host = document.querySelector("#waveform > div").shadowRoot; return { container: document.getElementById("waveform").clientHeight, drawn: host.querySelector(".scroll").clientHeight }; })()`,
  );
  check(
    "…and the waveform fills the taller timeline",
    Math.abs(wave.drawn - wave.container) <= 1,
    JSON.stringify(wave),
  );
  check(
    "the video window is named after the file",
    (await inWindow("document.title")) === "counter.webm — Video",
    await inWindow("document.title"),
  );

  await click(3);
  await sleep(1000);
  let frame = await frameIn(videoWin().webContents);
  const at = await pos();
  check(
    "the video window's picture follows a seek",
    frame !== null && Math.abs(frame - at) < 0.1,
    `frame ${frame}, position ${at}`,
  );
  await shot("video-window-main.png");
  {
    // The video window, its controls woken by the pointer.
    const child = videoWin();
    for (const x of [200, 210, 220]) child.webContents.sendInputEvent({ type: "mouseMove", x, y: 150 });
    // Within a few seconds (input reaches an offscreen window late on a
    // slow machine, like CI's).
    const awake = () => inWindow(`document.body.classList.contains("awake")`);
    let woken = false;
    for (let waited = 0; waited < 3000 && !woken; waited += 100) {
      await sleep(100);
      woken = await awake();
    }
    check("moving the pointer shows the video window's controls", woken);
    child.webContents.invalidate();
    await sleep(200);
    fs.writeFileSync(path.join(OUTPUT, "video-window.png"), (await child.capturePage()).toPNG());
  }

  {
    const contents = videoWin().webContents;
    contents.focus();
    contents.sendInputEvent({ type: "keyDown", keyCode: "Space" });
    contents.sendInputEvent({ type: "keyUp", keyCode: "Space" });
    await sleep(700);
    check("Space in the video window plays", await playing());
    const before = await frameIn(contents);
    await sleep(500);
    const after = await frameIn(contents);
    check(
      "the picture there moves with playback",
      before !== null && after !== null && after > before,
      `${before} → ${after}`,
    );
    await ensurePaused();
  }

  {
    // Video zoom (src/features/video-zoom.js) in the video window: the
    // wheel over its picture, its own controls, Ctrl+0 there; and the
    // zoom goes back to the main window with the picture.
    const contents = videoWin().webContents;
    const zoomThere = () => inWindow(`document.querySelector("canvas").dataset.zoom ?? ""`);
    const until = async (test) => {
      for (let waited = 0; waited < 3000; waited += 100) {
        if (await test()) return true;
        await sleep(100);
      }
      return false;
    };
    const { width, height } = await inWindow(`({ width: innerWidth, height: innerHeight })`);
    const wheel = async () => {
      for (let i = 0; i < 5; i++) {
        contents.sendInputEvent({
          type: "mouseWheel",
          x: Math.round(width / 2),
          y: Math.round(height / 2),
          deltaX: 0,
          deltaY: 120,
        });
        await sleep(60);
      }
    };
    await wheel();
    await until(async () => Number.parseFloat(await zoomThere()) > 1.1);
    const zoom = Number.parseFloat(await zoomThere());
    // (Not every notch may arrive: input reaches an offscreen window late.)
    check("scrolling over the video window's picture zooms it in", zoom > 1.1, await zoomThere());
    check(
      "…and its controls say how far",
      (await inWindow(`document.querySelector(".video-zoom-level").textContent`)) === `${zoom.toFixed(1)}×`,
    );
    const corner = await inWindow(`(() => {
      const bar = document.querySelector(".video-controls"), b = bar.getBoundingClientRect(), p = document.querySelector(".video-pane").getBoundingClientRect();
      return { holdsZoom: bar.contains(document.querySelector(".video-zoom-bar")), right: Math.round(p.right - b.right), bottom: Math.round(p.bottom - b.bottom) };
    })()`);
    check(
      "…in the bottom-right corner, as in the main window",
      corner.holdsZoom && corner.right === 8 && corner.bottom === 8,
      JSON.stringify(corner),
    );
    // Settings › Layout › The video's buttons reaches the window too: it
    // copies the main page's data-video-buttons (and its theme) as they change.
    const buttonsThere = () =>
      inWindow(
        `[document.documentElement.dataset.videoButtons, getComputedStyle(document.querySelector(".video-controls")).opacity, document.documentElement.dataset.theme === ${JSON.stringify("")} ? "" : "themed"].join()`,
      );
    const buttonsBefore = await buttonsThere();
    await js(`earbee.prefs.set("layout", "videoButtons", "hover")`);
    const buttonsHover =
      (await until(async () => (await buttonsThere()).startsWith("hover,"))) && (await buttonsThere());
    await js(`earbee.prefs.set("layout", "videoButtons", "always")`);
    const buttonsBack =
      (await until(async () => (await buttonsThere()).startsWith("always,"))) && (await buttonsThere());
    check(
      "the window follows Settings › Layout › The video's buttons, and keeps the theme",
      buttonsBefore === "always,1,themed" &&
        typeof buttonsHover === "string" &&
        buttonsHover.startsWith("hover,") &&
        buttonsBack === "always,1,themed",
      `${buttonsBefore} → ${buttonsHover} → ${buttonsBack}`,
    );
    contents.focus();
    contents.sendInputEvent({ type: "keyDown", keyCode: "0", modifiers: ["control"] });
    contents.sendInputEvent({ type: "keyUp", keyCode: "0", modifiers: ["control"] });
    check("Ctrl+0 there shows all of the picture", await until(async () => (await zoomThere()) === ""));
    await wheel();
    await until(async () => Number.parseFloat(await zoomThere()) > 1.1);
    const out = await zoomThere();
    key("V");
    await sleep(800);
    const back = await js(`document.getElementById("videoCanvas").dataset.zoom ?? ""`);
    check("bringing the picture back keeps its zoom", out !== "" && back === out, `${out} → ${back}`);
    key("0", ["control"]);
    key("V");
    await sleep(800);
    check("(and out again, for what follows)", videoWin() !== null);

    // The picture brought back during a drag in the video window: no drag
    // is left over, and the zoom comes back with it.
    const there = videoWin().webContents;
    const { width: w, height: hh } = await inWindow(`({ width: innerWidth, height: innerHeight })`);
    const middle = { x: Math.round(w / 2), y: Math.round(hh / 2) };
    for (let i = 0; i < 5; i++) {
      there.sendInputEvent({ type: "mouseWheel", ...middle, deltaX: 0, deltaY: 120 });
      await sleep(60);
    }
    await until(async () => Number.parseFloat(await zoomThere()) > 1.1);
    // Its controls, kept from the main window, to see whether they're
    // still updated once the window is closed.
    await inWindow(`window.opener.__closedZoomBar = document.querySelector(".video-zoom-bar")`);
    there.sendInputEvent({ type: "mouseDown", ...middle, button: "left", clickCount: 1 });
    for (let i = 1; i <= 4; i++) {
      there.sendInputEvent({
        type: "mouseMove",
        x: middle.x + 15 * i,
        y: middle.y,
        button: "left",
        modifiers: ["leftButtonDown"],
      });
      await sleep(40);
    }
    await sleep(500);
    const midDrag = await zoomThere();
    key("V");
    await sleep(800);
    const main = () =>
      js(`(() => {
        const pane = document.getElementById("videoPane");
        return {
          zoom: document.getElementById("videoCanvas").dataset.zoom ?? "",
          panning: pane.classList.contains("panning"),
          level: pane.querySelector(".video-zoom-level").textContent,
          bars: pane.querySelectorAll(".video-zoom-bar").length,
        };
      })()`);
    let m = await main();
    check(
      "brought back during a drag: no drag left over, and the zoom comes back with the picture",
      midDrag !== "" && m.zoom === midDrag && !m.panning,
      `${midDrag} → ${JSON.stringify(m)}`,
    );

    // Out and back a few times while zoomed in: the main window's controls
    // still follow the zoom, and the closed windows' controls don't.
    for (let i = 0; i < 6; i++) {
      key("V");
      await sleep(700);
    }
    key("=", ["control"]);
    await sleep(300);
    m = await main();
    const closedLevel = await js(`__closedZoomBar.querySelector(".video-zoom-level").textContent`);
    check(
      "out and back six times: the controls still say the zoom",
      videoWin() === null && m.bars === 1 && m.level === `${Number.parseFloat(m.zoom).toFixed(1)}×`,
      JSON.stringify(m),
    );
    check(
      "…and a closed video window's controls are let go (not updated any more)",
      closedLevel !== m.level,
      `closed window's controls say ${closedLevel}, the main window's ${m.level}`,
    );
    await js(`delete window.__closedZoomBar`);
    key("0", ["control"]);
    key("V");
    await sleep(800);
    check("(and out again, for what follows, at 1×)", videoWin() !== null && (await zoomThere()) === "");
  }

  await inWindow(`document.querySelector('[aria-label="Keep on top"]').click()`);
  await sleep(300);
  check(
    "the pin keeps the video window on top",
    videoWin().isAlwaysOnTop() &&
      (await inWindow(`document.querySelector('[aria-label="Keep on top"]').getAttribute("aria-pressed")`)) === "true",
  );

  await openFile(path.join(FIXTURES, "tone.wav"));
  await sleep(500);
  s = await stage();
  check("an audio file closes the video window", videoWin() === null);
  check("…and shows no strip", !s.video && !s.popped && !s.strip, JSON.stringify(s));
  const state = JSON.parse(fs.readFileSync(path.join(app.getPath("userData"), "video-window-state.json"), "utf8"));
  check(
    "the video window's place and pin are saved",
    state.alwaysOnTop === true && Number.isFinite(state.width),
    JSON.stringify(state),
  );

  await openFile(VIDEO);
  await sleep(800);
  check("the next video opens in the video window again (remembered)", videoWin() !== null);
  check("…still on top", videoWin()?.isAlwaysOnTop() === true);

  videoWin().close();
  await sleep(800);
  s = await stage();
  check(
    "closing the video window brings the video back",
    videoWin() === null && s.video && !s.popped && !s.strip && s.pane,
    JSON.stringify(s),
  );
  frame = await frameIn(h.wc);
  check("…drawn in the main window again", frame !== null, String(frame));

  await openFile(VIDEO);
  await sleep(800);
  check("after that, the next video stays in the main window", videoWin() === null);
  check(
    "other windows are still refused",
    (await js(`window.open("https://example.com") === null && window.open("", "other") === null`)) === true,
  );
};
