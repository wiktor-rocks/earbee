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
