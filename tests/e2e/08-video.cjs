// Video: the picture follows playback, loop wraps and drags (the proxy
// and its builders); zooming into the picture.
// Part of the end-to-end run (see run.cjs); `h` is the harness.
const path = require("path");

module.exports = async function (h) {
  const {
    js,
    wc,
    openFile,
    key,
    drag,
    rect,
    xAt,
    shot,
    loopInfo,
    loopRange,
    sample,
    ensurePaused,
    check,
    sleep,
    FIXTURES,
  } = h;
  let loop, s;

  await openFile(path.join(FIXTURES, "counter.webm"));
  check("new file clears loop", (await loopInfo()).hidden);
  check("the audio runs at the file's rate (48 kHz Opus)", (await js(`__contexts.at(-1).sampleRate`)) === 48000);
  check("message cleared on load", (await js(`document.getElementById("message").textContent`)) === "");
  await drag(1, 2, ["shift"]);
  loop = await loopRange();
  await sleep(1500); // let the proxy build a bit
  key("Space");
  s = await sample(4000);
  await ensurePaused();
  const wrapIdx = [];
  for (let i = 1; i < s.length; i++) if (s[i].pos < s[i - 1].pos - 0.01) wrapIdx.push(i);
  const after = wrapIdx.map((i) => {
    const later = s.slice(i, i + 12);
    const hit = later.findIndex((q) => q.frame >= loop.start - 0.04 && q.frame <= loop.start + 0.4);
    return hit;
  });
  check(
    "video follows loop wraps",
    wrapIdx.length >= 2 && after.every((h) => h >= 0 && h <= 8),
    `wraps ${wrapIdx.length}, frames to catch up ${JSON.stringify(after)}`,
  );
  const sync = s
    .slice(10)
    .filter((q) => !Number.isNaN(q.frame))
    .map((q) => Math.abs(q.frame - q.pos));
  const syncedShare = sync.filter((v) => v < 0.1).length / sync.length;
  check("video stays synced in loop (≥90% within 100 ms)", syncedShare >= 0.9, `${(syncedShare * 100).toFixed(1)}%`);
  await shot("video-loop.png");

  // The loading label in the picture's bottom-right corner (video/view.js,
  // style.css "Video loading") goes once all of the proxy is built.
  const label = () =>
    js(
      `(() => { const l = document.querySelector("#videoPane > .video-loading"); return l && !l.hidden ? l.textContent : null; })()`,
    );
  let shownLabel = await label();
  for (let i = 0; i < 150 && shownLabel !== null; i++) {
    await sleep(100);
    shownLabel = await label();
  }
  check(
    "the loading label goes once the whole proxy is built",
    shownLabel === null,
    `${shownLabel}, built: ${await js(`document.getElementById("videoCanvas").dataset.proxyBuilt ?? ""`)}`,
  );

  // A long video, dragged far in right after opening: its proxy isn't
  // built there yet (its builders start at the start, a half and a
  // quarter), so the picture waits for the exact frame, and a builder
  // moves there (and a little before). Dragging back then shows the proxy, while the
  // sharp decoder has to start again at the keyframe before (one every 20 s
  // in long-counter.webm, at 180 s here).
  const openedAt = Date.now();
  await openFile(path.join(FIXTURES, "long-counter.webm"));
  const loadMs = Date.now() - openedAt;
  const { y } = await rect();
  // A drag with the mouse from `from` to `to` (seconds) over about `ms`,
  // sampling the picture meanwhile and for `after` ms more.
  async function scrub(from, to, ms, after) {
    const [x1, x2] = [await xAt(from), await xAt(to)];
    const steps = Math.round(ms / 40);
    await js(`window.__scrub = __sampleCanvas(${ms + after}); 0`); // not awaited: it samples during the drag
    wc.sendInputEvent({ type: "mouseDown", x: x1, y: Math.round(y), button: "left", clickCount: 1 });
    for (let i = 1; i <= steps; i++) {
      wc.sendInputEvent({
        type: "mouseMove",
        x: Math.round(x1 + ((x2 - x1) * i) / steps),
        y: Math.round(y),
        button: "left",
      });
      await sleep(40);
    }
    wc.sendInputEvent({ type: "mouseUp", x: x2, y: Math.round(y), button: "left", clickCount: 1 });
    return js(`window.__scrub`);
  }
  const builtParts = () => js(`document.getElementById("videoCanvas").dataset.proxyBuilt ?? ""`);
  const covers = (parts, from, to) =>
    parts.split(" ").some((part) => {
      const [start, end] = part.split("–").map(Number);
      return start <= from && end >= to;
    });

  // Loading doesn't wait for the proxy; soon after, several builders have
  // started, spread over the video.
  let early = await builtParts();
  for (let i = 0; i < 30 && early.split(" ").length < 2; i++) {
    await sleep(100);
    early = await builtParts();
  }
  check(
    "the proxy is built in several places at once",
    early.split(" ").length >= 2,
    `built: ${early}, load ${loadMs} ms`,
  );
  const building = await label();
  check(
    "meanwhile, the picture says how much of the low-res preview is loaded",
    /^Loading low-resolution preview \d+%$/.test(building ?? ""),
    building,
  );

  // Far in, beyond the proxy: no wrong frames. Only frames near where
  // the drag is are drawn (not the decoder's on the way from the keyframe
  // before, seconds off); meanwhile what is
  // on screen stays, marked as loading, and the exact frame follows.
  s = await scrub(150, 200, 1600, 2500);
  const wrong = s.filter((q, i) => {
    if (i === 0 || q.frame === s[i - 1].frame) return false;
    const recent = s.filter((r) => r.t >= q.t - 600 && r.t <= q.t);
    return !recent.some((r) => Math.abs(r.frame - r.pos) < 0.5 || Math.abs(q.frame - r.pos) < 0.5);
  });
  const farEnd = s.at(-1);
  check(
    "a far drag shows no wrong frames, says it's loading, then the exact frame",
    wrong.length === 0 && s.some((q) => q.loading) && !farEnd.loading && Math.abs(farEnd.frame - farEnd.pos) < 0.05,
    JSON.stringify({ wrong: wrong.slice(0, 3), end: farEnd, built: early }),
  );
  let parts = "";
  for (let i = 0; i < 60 && !covers(parts, 196, 205); i++) {
    await sleep(100);
    parts = await builtParts();
  }
  check("the proxy is built where a drag went", covers(parts, 196, 205), `built: ${parts}`);

  s = await scrub(200, 196, 1000, 2500);
  const dragging = s.filter((q) => q.t > 200 && q.t < 1000);
  const following = dragging.filter((q) => Math.abs(q.frame - q.pos) < 0.5).length / dragging.length;
  check(
    "dragging back there shows the proxy",
    s.some((q) => q.proxy),
    `built: ${parts}`,
  );
  check(
    "the picture follows the drag (≥70% within 0.5 s)",
    following >= 0.7,
    `${(following * 100).toFixed(0)}%, e.g. ${JSON.stringify(dragging[Math.floor(dragging.length / 2)])}`,
  );
  const end = s.at(-1);
  check(
    "the sharp frame takes over after the drag",
    !end.proxy && !end.loading && Math.abs(end.frame - end.pos) < 0.05,
    JSON.stringify(end),
  );

  // Ready points: a decoder waits at the loop start, far from a keyframe
  // (15 s; the one before is at 0), so the loop wraps to a sharp frame at
  // once, and a jump there while paused is sharp at once too.
  const app = `Promise.all([import("./src/context.js"), import("./src/features/playback.js")])`;
  const readyPoints = () => js(`document.getElementById("videoCanvas").dataset.readyPoints ?? ""`);
  const isReady = (text, time) => text.split(" ").some((t) => t !== "" && Math.abs(Number(t) - time) < 0.001);
  async function waitReady(time) {
    let ready = "";
    for (let i = 0; i < 100 && !isReady(ready, time); i++) {
      await sleep(100);
      ready = await readyPoints();
    }
    return ready;
  }
  await js(
    `${app}.then(([{ player }, { setLoopRegion }]) => { setLoopRegion({ start: 15, end: 17, enabled: true }); player.transport.seek(16); })`,
  );
  let ready = await waitReady(15);
  check("a decoder gets ready at the loop start", isReady(ready, 15), `ready: ${ready}`);
  const allowed = await js(`document.getElementById("videoCanvas").dataset.readyAllowed`);
  check("a small video may have all four (the memory budget)", allowed === "4", `allowed: ${allowed}`);
  key("Space");
  s = await js(`__sampleCanvas(3500)`);
  await ensurePaused();
  const wraps = [];
  for (let i = 1; i < s.length; i++) if (s[i].pos < s[i - 1].pos - 0.5) wraps.push(i);
  // The frames on screen from the wrap on (the readout may lag it by one).
  const afterWraps = wraps.map((i) => s.slice(i - 1, i + 10).filter((q) => q.frame < 15.5));
  check(
    "…and the loop wraps to a sharp frame there at once",
    wraps.length >= 1 && afterWraps[0].length > 0 && afterWraps[0].every((q) => !q.proxy && q.frame >= 14.96),
    `wraps ${wraps.length}; after them: ${JSON.stringify(afterWraps.map((qs) => qs.slice(0, 3)))}`,
  );
  // Paused elsewhere, its sharp frame on screen, then the jump: from the
  // first frame at 15 s on, none is the proxy.
  await js(`${app}.then(([{ player }]) => player.transport.seek(16.5))`);
  ready = await waitReady(15);
  for (let i = 0; i < 30 && (await js(`document.getElementById("videoCanvas").dataset.proxy !== undefined`)); i++)
    await sleep(100);
  await js(`window.__jump = __sampleCanvas(400); 0`);
  await js(`${app}.then(([{ player }]) => player.transport.seek(15))`);
  s = await js(`window.__jump`);
  const from = s.findIndex((q) => Math.abs(q.frame - 15) < 0.05);
  check(
    "a jump to it while paused shows the sharp frame at once",
    isReady(ready, 15) && from >= 0 && s.slice(from).every((q) => !q.proxy && Math.abs(q.frame - 15) < 0.05),
    `ready: ${ready}; ${JSON.stringify(s.slice(0, 4))}`,
  );
  // Settings › Advanced › Off: no decoder waits; back at Normal, they do.
  const prefs = `import("./src/ui/prefs.js")`;
  const allowedNow = () => js(`document.getElementById("videoCanvas").dataset.readyAllowed`);
  await js(`${prefs}.then(({ setPref }) => setPref("advanced", "sharpJumps", "off"))`);
  await sleep(300);
  const [offAllowed, offReady] = [await allowedNow(), await readyPoints()];
  check(
    "Settings › Advanced › Off: no decoder waits",
    offAllowed === "0" && offReady === "",
    `allowed ${offAllowed}, ready "${offReady}"`,
  );
  await js(`${prefs}.then(({ resetPref }) => resetPref("advanced", "sharpJumps"))`);
  ready = await waitReady(15);
  check(
    "…and back at Normal, the loop start's is ready again",
    (await allowedNow()) === "4" && isReady(ready, 15),
    `allowed ${await allowedNow()}, ready: ${ready}`,
  );
  await js(`${app}.then(([, { setLoopRegion }]) => setLoopRegion(null))`);

  // Zooming in (src/features/video-zoom.js): the wheel over the picture
  // zooms in where the pointer is and the picture fills its pane; a drag
  // moves it; the keys and the controls; paused, it's drawn again from the
  // frame on screen, without decoding; a new file shows all of it.
  const paneBox = () =>
    js(
      `(() => { const r = videoPane.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`,
    );
  const zoomNow = () => js(`videoCanvas.dataset.zoom ?? ""`);
  const zoomBar = () =>
    js(
      `(() => { const b = videoPane.querySelector(".video-zoom-bar"); return { level: b.querySelector(".video-zoom-level").textContent, zoomed: b.classList.contains("zoomed") }; })()`,
    );
  const pixel = async (x, y) => {
    wc.invalidate();
    await sleep(120);
    const [b, g, r] = (await wc.capturePage({ x: Math.round(x), y: Math.round(y), width: 1, height: 1 })).toBitmap();
    return [r, g, b];
  };
  const wheelOver = async (x, y, deltaY, times) => {
    for (let i = 0; i < times; i++) {
      wc.sendInputEvent({ type: "mouseWheel", x: Math.round(x), y: Math.round(y), deltaX: 0, deltaY });
      await sleep(50);
    }
    await sleep(300);
  };
  // A pane wider than the 16:9 picture, so its sides are letterbox at 1×
  // (the default split makes the pane about 16:9 itself).
  await js(`import("./src/features/stage-split.js").then(({ setTimelineShare }) => setTimelineShare(0.4))`);
  await sleep(400);
  const box = await paneBox();
  const edge = { x: box.left + 4, y: box.top + box.height / 2 }; // in the letterbox at 1×
  const at = { x: box.left + box.width * 0.4, y: box.top + box.height * 0.5 };
  check(
    "the zoom controls are on the picture, at 1×",
    (await zoomBar()).level === "1.0×" && (await zoomNow()) === "",
    JSON.stringify(await zoomBar()),
  );
  const edgeBefore = await pixel(edge.x, edge.y);
  const colourBefore = await pixel(at.x, at.y);
  const frameBefore = await js(`videoCanvas.dataset.frameTime`);
  await wheelOver(at.x, at.y, 120, 5); // up (Electron's deltaY is the DOM's, inverted)
  const zoomed = await zoomNow();
  const level = Number.parseFloat(zoomed);
  check(
    "scrolling up over the picture zooms in, and the controls say how far",
    level > 2 && level < 3 && (await zoomBar()).zoomed && (await zoomBar()).level === `${level.toFixed(1)}×`,
    `${zoomed} ${JSON.stringify(await zoomBar())}`,
  );
  const colourAfter = await pixel(at.x, at.y);
  check(
    "…where the pointer is: what was under it still is",
    colourAfter.every((c, i) => Math.abs(c - colourBefore[i]) < 60),
    `${colourBefore} → ${colourAfter}`,
  );
  const edgeAfter = await pixel(edge.x, edge.y);
  check(
    "…and the picture fills its pane (no letterbox)",
    edgeBefore.every((c) => c < 20) && edgeAfter.some((c) => c > 60),
    `${edgeBefore} → ${edgeAfter}`,
  );
  check("…drawn again without decoding (the same frame)", (await js(`videoCanvas.dataset.frameTime`)) === frameBefore);
  const centre = { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) };
  const [, x0] = (await zoomNow()).split(" ").map(Number);
  wc.sendInputEvent({ type: "mouseDown", ...centre, button: "left", clickCount: 1 });
  for (let i = 1; i <= 5; i++) {
    wc.sendInputEvent({
      type: "mouseMove",
      x: centre.x + 20 * i,
      y: centre.y,
      button: "left",
      modifiers: ["leftButtonDown"],
    });
    await sleep(30);
  }
  wc.sendInputEvent({ type: "mouseUp", x: centre.x + 100, y: centre.y, button: "left", clickCount: 1 });
  await sleep(200);
  const [, x1] = (await zoomNow()).split(" ").map(Number);
  check("dragging the picture right shows more of its left", x1 < x0 - 0.01, `x ${x0} → ${x1}`);
  key("=", ["control"]);
  await sleep(200);
  const keyed = Number.parseFloat(await zoomNow());
  check("Ctrl+= zooms in further", Math.abs(keyed - level * 1.25) < 0.01, `${level} → ${keyed}`);
  key("0", ["control"]);
  await sleep(300);
  check(
    "Ctrl+0 shows all of the picture again",
    (await zoomNow()) === "" &&
      (await zoomBar()).level === "1.0×" &&
      (await pixel(edge.x, edge.y)).every((c) => c < 20),
  );
  // Zoomed in while playing: each frame is cropped as it's drawn (a crop
  // in fractions of a pixel once stopped the worker).
  key("Space");
  await sleep(500);
  await wheelOver(at.x, at.y, 120, 5);
  const playingFrom = Number(await js(`videoCanvas.dataset.frameTime`));
  await sleep(800);
  const playingTo = Number(await js(`videoCanvas.dataset.frameTime`));
  const playingMessage = await js(`document.getElementById("message").textContent`);
  const playingCentre = await pixel(box.left + box.width / 2, box.top + box.height / 2);
  await ensurePaused();
  check(
    "zooming in while playing: the picture goes on, zoomed",
    playingTo > playingFrom + 0.3 &&
      !/stopped/.test(playingMessage) &&
      playingCentre.some((c) => c > 60) &&
      Number.parseFloat(await zoomNow()) > 2,
    `frames ${playingFrom} → ${playingTo}, "${playingMessage}", centre ${playingCentre}, zoom ${await zoomNow()}`,
  );
  key("0", ["control"]);
  await sleep(300);
  await wheelOver(at.x, at.y, 120, 30);
  check("it goes no further than 8×", Number.parseFloat(await zoomNow()) === 8, await zoomNow());
  await js(`videoPane.querySelector(".video-zoom-step").click()`); // −
  await sleep(150);
  check("the controls' − zooms out", Math.abs(Number.parseFloat(await zoomNow()) - 8 / 1.25) < 0.01, await zoomNow());
  await js(`videoPane.querySelector(".video-zoom-level").click()`);
  await sleep(150);
  check("…and a click on the level shows all of it", (await zoomNow()) === "");
  await wheelOver(at.x, at.y, 120, 3);
  await shot("video-zoom.png");
  // The video's buttons together, bottom right (style.css, "Video controls"):
  // the zoom, then its own window, then big video.
  const videoButtons = await js(`(() => {
    const bar = videoPane.querySelector(".video-controls"), b = bar.getBoundingClientRect(), p = videoPane.getBoundingClientRect();
    const order = [...bar.children].map((c) => [c.className, Number(getComputedStyle(c).order)])
      .sort((x, y) => x[1] - y[1]).map(([name]) => name.split(" ").find((n) => ["video-zoom-bar", "video-popout-button", "big-video-button"].includes(n)));
    return { order, right: Math.round(p.right - b.right), bottom: Math.round(p.bottom - b.bottom), shown: getComputedStyle(bar).opacity === "1" };
  })()`);
  check(
    "the video's buttons sit together in the bottom-right corner: zoom, own window, big video",
    videoButtons.order.join() === "video-zoom-bar,video-popout-button,big-video-button" &&
      videoButtons.right === 8 &&
      videoButtons.bottom === 8 &&
      videoButtons.shown,
    JSON.stringify(videoButtons),
  );
  await openFile(path.join(FIXTURES, "long-counter.webm"));
  check("a new file shows all of its picture", (await zoomNow()) === "" && (await zoomBar()).level === "1.0×");

  // Whatever goes wrong with the zoom costs the zoom, never the picture.
  // Broken views sent straight to the worker (as a bug could) are taken
  // as safe ones (video/zoom.js safeView), and the picture plays on.
  const stopped = async () => /stopped|failed/.test(await js(`document.getElementById("message").textContent`));
  const playsOn = async (ms) => {
    const from = Number(await js(`videoCanvas.dataset.frameTime`));
    await sleep(ms);
    const to = Number(await js(`videoCanvas.dataset.frameTime`));
    // The pane as it is now (the stage split may have made it smaller).
    const now = await paneBox();
    const middle = await pixel(now.left + now.width / 2, now.top + now.height / 2);
    return { ok: to > from && !(await stopped()) && middle.some((c) => c > 60), from, to, middle };
  };
  await js(
    `[{ zoom: NaN, x: 0.5, y: 0.5 }, { zoom: 1e9, x: -5, y: "a" }, null, { zoom: Infinity, x: Infinity, y: -Infinity }, "zoom"].forEach((view) => __videoWorker.postMessage({ type: "view", view }))`,
  );
  key("Space");
  let going = await playsOn(800);
  await ensurePaused();
  check("broken views sent to the worker: the picture plays on", going.ok, JSON.stringify(going));
  key("0", ["control"]);
  await sleep(200);

  // Zoomed in while playing slowly (each frame is copied then), and
  // dragged while it plays.
  await h.slide("speed", 0.25);
  key("Space");
  await sleep(300);
  await wheelOver(at.x, at.y, 120, 6);
  const [, slowX0] = (await zoomNow()).split(" ").map(Number);
  wc.sendInputEvent({ type: "mouseDown", ...centre, button: "left", clickCount: 1 });
  for (let i = 1; i <= 5; i++) {
    wc.sendInputEvent({
      type: "mouseMove",
      x: centre.x - 20 * i,
      y: centre.y,
      button: "left",
      modifiers: ["leftButtonDown"],
    });
    await sleep(30);
  }
  wc.sendInputEvent({ type: "mouseUp", x: centre.x - 100, y: centre.y, button: "left", clickCount: 1 });
  going = await playsOn(1500);
  const [slowZoom, slowX1] = (await zoomNow()).split(" ").map(Number);
  await ensurePaused();
  check(
    "zoomed in and dragged while playing at 0.25×: the picture goes on, zoomed",
    going.ok && slowZoom > 2 && slowX1 > slowX0,
    `${JSON.stringify(going)} zoom ${await zoomNow()} (x from ${slowX0})`,
  );
  await h.slide("speed", 1);
  key("0", ["control"]);
  await sleep(200);

  // A video marked rotated (as phones record): shown upright, portrait,
  // letterboxed left and right; zoomed in, it fills the pane.
  await openFile(path.join(FIXTURES, "rotated.mp4"));
  await sleep(500);
  const side = { x: box.left + box.width * 0.25, y: box.top + box.height / 2 };
  const sideBefore = await pixel(side.x, side.y);
  await wheelOver(box.left + box.width / 2, box.top + box.height / 2, 120, 10);
  const sideAfter = await pixel(side.x, side.y);
  key("Space");
  going = await playsOn(800);
  await ensurePaused();
  check(
    "a rotated (portrait) video zooms in and fills the pane, and plays on",
    sideBefore.every((c) => c < 20) &&
      sideAfter.some((c) => c > 60) &&
      going.ok &&
      Number.parseFloat(await zoomNow()) > 4,
    `side ${sideBefore} → ${sideAfter}, ${JSON.stringify(going)}, zoom ${await zoomNow()}`,
  );
  await shot("video-zoom-rotated.png");
  check(
    "…and nothing said the zoom failed",
    !(await stopped()),
    await js(`document.getElementById("message").textContent`),
  );

  // The zoom's edge cases: another file chosen while zoomed in, an audio
  // file, a jump where the proxy isn't built yet, resizing while zoomed
  // (big video, the stage split, a tiny pane), and input that isn't a
  // plain notch of the wheel.
  const loaded = async () => {
    for (let i = 0; i < 200; i++) {
      await sleep(50);
      if (await js(`document.getElementById("loadingOverlay").hidden && !document.getElementById("play").disabled`))
        break;
    }
    await sleep(300);
  };
  const zoomParts = async () => (await zoomNow()).split(" ").map(Number); // [zoom, x, y], or [0]
  const panes = () => js(`videoPane.classList.contains("panning")`);
  const dragPicture = async (from, dx, dy, { release = true, steps = 5 } = {}) => {
    wc.sendInputEvent({ type: "mouseDown", ...from, button: "left", clickCount: 1 });
    for (let i = 1; i <= steps; i++) {
      wc.sendInputEvent({
        type: "mouseMove",
        x: Math.round(from.x + (dx * i) / steps),
        y: Math.round(from.y + (dy * i) / steps),
        button: "left",
        modifiers: ["leftButtonDown"],
      });
      await sleep(30);
    }
    if (release) wc.sendInputEvent({ type: "mouseUp", x: from.x + dx, y: from.y + dy, button: "left", clickCount: 1 });
    await sleep(200);
  };

  // Another file chosen while zoomed in, and wheeled over while it loads:
  // it opens with all of its picture.
  await openFile(path.join(FIXTURES, "counter.webm"));
  await wheelOver(at.x, at.y, 120, 5);
  await h.setFiles(path.join(FIXTURES, "rotated.mp4"));
  for (let i = 0; i < 8; i++) {
    wc.sendInputEvent({ type: "mouseWheel", x: Math.round(at.x), y: Math.round(at.y), deltaX: 0, deltaY: 120 });
    await sleep(25);
  }
  await loaded();
  check(
    "a file chosen while zoomed in (and wheeled over while it loads) opens with all of its picture",
    (await zoomNow()) === "" && (await zoomBar()).level === "1.0×" && !(await stopped()),
    `${await zoomNow()} ${JSON.stringify(await zoomBar())}`,
  );
  // Zoomed in on it straight away: it's portrait, so the view is kept
  // within its own shape, not the last file's.
  await wheelOver(centre.x, centre.y, 120, 12);
  const [portraitZoom, portraitX] = await zoomParts();
  check(
    "…and zoomed in straight away, the view keeps to its (portrait) shape",
    portraitZoom > 4 && Math.abs(portraitX - 0.5) < 0.02,
    await zoomNow(),
  );

  // An audio file: the zoom's keys and the wheel do nothing there.
  await openFile(path.join(FIXTURES, "tone.wav"));
  key("=", ["control"]);
  key("-", ["control"]);
  key("0", ["control"]);
  await wheelOver(centre.x, centre.y, 120, 3);
  check(
    "with an audio file, the zoom's keys and the wheel do nothing (and break nothing)",
    (await js(`videoPane.hidden`)) && (await zoomNow()) === "" && !(await stopped()),
    `${await js(`videoPane.hidden`)} "${await zoomNow()}" "${await js(`document.getElementById("message").textContent`)}"`,
  );

  // A jump far into a long video right after opening, zoomed in: its proxy
  // isn't built there, so the picture waits for the sharp frame; the
  // zoom stays.
  await openFile(path.join(FIXTURES, "long-counter.webm"));
  await wheelOver(centre.x, centre.y, 120, 6);
  const zoomBeforeJump = await zoomNow();
  await h.click((await h.duration()) * 0.8);
  let sharp = false;
  for (let i = 0; i < 60 && !sharp; i++) {
    await sleep(100);
    sharp = !(await js(`"proxy" in videoCanvas.dataset`)) && Number(await js(`videoCanvas.dataset.frameTime`)) > 10;
  }
  check(
    "a far jump while zoomed in: the picture gets there, sharp, still zoomed",
    sharp && (await zoomNow()) === zoomBeforeJump && !(await stopped()),
    `sharp ${sharp}, frame ${await js(`videoCanvas.dataset.frameTime`)}, zoom ${zoomBeforeJump} → ${await zoomNow()}`,
  );
  // Scrubbing across it while zoomed in.
  await drag(0, 0, [], await h.xAt((await h.duration()) * 0.8), await h.xAt((await h.duration()) * 0.3));
  await sleep(800);
  check(
    "scrubbing while zoomed in: the picture follows, still zoomed",
    Math.abs(Number(await js(`videoCanvas.dataset.frameTime`)) - (await h.pos())) < 0.5 &&
      (await zoomNow()) === zoomBeforeJump &&
      !(await stopped()),
    `frame ${await js(`videoCanvas.dataset.frameTime`)} at ${await h.pos()}, zoom ${await zoomNow()}`,
  );

  // Big video on and off, zoomed in: the zoom stays, the picture fills the pane.
  key("F");
  await sleep(600);
  const big = await paneBox();
  const bigEdge = await pixel(big.left + 4, big.top + big.height / 2);
  const bigZoom = await zoomNow();
  key("F");
  await sleep(600);
  check(
    "big video on and off while zoomed in: the zoom stays, the picture fills the pane",
    bigZoom !== "" && (await zoomNow()) !== "" && bigEdge.some((c) => c > 60) && !(await stopped()),
    `big ${JSON.stringify(big)} edge ${bigEdge}, zoom ${bigZoom} → ${await zoomNow()}`,
  );

  // A shorter pane while zoomed in (the stage split dragged): the view is
  // kept within what the new shape allows, so the page and the picture
  // agree, and the first drag moves the picture.
  const splitAt = () =>
    js(
      `(() => { const r = document.querySelector(".stage-split").getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`,
    );
  const dragSplit = async (dy) => {
    const { x, y } = await splitAt();
    wc.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
    for (let i = 1; i <= 6; i++) {
      wc.sendInputEvent({ type: "mouseMove", x, y: Math.round(y + (dy * i) / 6), button: "left" });
      await sleep(30);
    }
    wc.sendInputEvent({ type: "mouseUp", x, y: y + dy, button: "left", clickCount: 1 });
    await sleep(400);
  };
  key("0", ["control"]);
  await sleep(200);
  await wheelOver(centre.x, centre.y, 120, 6);
  for (let i = 0; i < 4; i++) await dragPicture(centre, 300, 0); // to the frame's left edge
  const [, leftmost] = await zoomParts();
  await dragSplit(-100); // the picture 100 px shorter
  const [, afterShrink] = await zoomParts();
  const short = await paneBox();
  const shortCentre = { x: Math.round(short.left + short.width / 2), y: Math.round(short.top + short.height / 2) };
  await dragPicture(shortCentre, -6, 0, { steps: 1 });
  const [, afterNudge] = await zoomParts();
  check(
    "a shorter pane while zoomed in: the view is kept within the picture",
    afterShrink > leftmost + 0.005,
    `x at the left edge ${leftmost}, after the split moved ${afterShrink}`,
  );
  check("…and the first small drag moves it", afterNudge > afterShrink, `${afterShrink} → ${afterNudge}`);

  // As small as the split allows, at the 8× limit, playing: no trouble.
  await dragSplit(-2000);
  const tiny = await paneBox();
  await wheelOver(tiny.left + tiny.width / 2, tiny.top + tiny.height / 2, 120, 30);
  key("Space");
  going = await playsOn(800);
  await ensurePaused();
  check(
    "the smallest pane, zoomed in to 8×, playing: the picture goes on",
    Number.parseFloat(await zoomNow()) === 8 && going.ok,
    `pane ${Math.round(tiny.width)}×${Math.round(tiny.height)}, zoom ${await zoomNow()}, ${JSON.stringify(going)}`,
  );
  await dragSplit(2000);
  key("0", ["control"]);
  await sleep(200);

  // Input: the wheel over the controls, a trackpad's many small steps,
  // Ctrl+wheel, sideways scrolling.
  const now = await paneBox();
  const mid = { x: Math.round(now.left + now.width / 2), y: Math.round(now.top + now.height / 2) };
  await wheelOver(mid.x, mid.y, 120, 3);
  const beforeOverBar = await zoomNow();
  const plus = await js(
    `(() => { const r = videoPane.querySelectorAll(".video-zoom-step")[1].getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`,
  );
  await wheelOver(plus.x, plus.y, 120, 3);
  check("the wheel over the zoom controls doesn't zoom", (await zoomNow()) === beforeOverBar, await zoomNow());
  key("0", ["control"]);
  await sleep(200);
  for (let i = 0; i < 40; i++) {
    wc.sendInputEvent({ type: "mouseWheel", ...mid, deltaX: 0, deltaY: 3 });
    await sleep(10);
  }
  await sleep(300);
  const trackpad = Number.parseFloat(await zoomNow());
  check(
    "a trackpad's 40 small steps zoom as far as one notch of the same size",
    Math.abs(trackpad - Math.exp(120 * 0.0015)) < 0.02,
    `${trackpad} (one notch: ${Math.exp(120 * 0.0015).toFixed(3)})`,
  );
  key("0", ["control"]);
  await sleep(200);
  for (let i = 0; i < 3; i++) {
    wc.sendInputEvent({ type: "mouseWheel", ...mid, deltaX: 0, deltaY: 120, modifiers: ["control"] });
    await sleep(50);
  }
  await sleep(300);
  check(
    "Ctrl+wheel zooms the picture, not the whole page",
    Number.parseFloat(await zoomNow()) > 1.3 && wc.getZoomFactor() === 1,
    `${await zoomNow()}, page ${wc.getZoomFactor()}`,
  );
  key("0", ["control"]);
  await sleep(200);
  for (let i = 0; i < 3; i++) {
    wc.sendInputEvent({ type: "mouseWheel", ...mid, deltaX: 120, deltaY: 0 });
    await sleep(50);
  }
  await sleep(300);
  check("sideways scrolling doesn't zoom", (await zoomNow()) === "", await zoomNow());

  // Dragging: released over the waveform, the drag ends there; and a drag
  // whose release never came (the window lost the pointer) doesn't go on
  // moving the picture with the button up.
  await wheelOver(mid.x, mid.y, 120, 6);
  const waveformY = Math.round((await rect()).y);
  await dragPicture(mid, 0, waveformY - mid.y, { release: false });
  wc.sendInputEvent({ type: "mouseUp", x: mid.x, y: waveformY, button: "left", clickCount: 1 });
  await sleep(200);
  check("a drag released outside the picture ends", !(await panes()));
  await dragPicture(mid, 40, 0, { release: false });
  const [, heldX] = await zoomParts();
  for (let i = 1; i <= 5; i++) {
    wc.sendInputEvent({ type: "mouseMove", x: mid.x + 40 + 20 * i, y: mid.y });
    await sleep(30);
  }
  await sleep(200);
  const [, afterLostX] = await zoomParts();
  check(
    "a drag whose release was missed: moving with the button up doesn't move the picture",
    afterLostX === heldX && !(await panes()),
    `x ${heldX} → ${afterLostX}, panning ${await panes()}`,
  );
  wc.sendInputEvent({ type: "mouseUp", x: mid.x + 140, y: mid.y, button: "left", clickCount: 1 });

  // Ctrl+= / Ctrl+- / Ctrl+0 with a text field focused (a knob's typed
  // value): as other Ctrl shortcuts they still work, and the field keeps
  // its text and its focus.
  await js(`document.getElementById("speedValue").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))`);
  await sleep(100);
  const fieldBefore = await js(`document.activeElement.className + " " + document.activeElement.value`);
  key("=", ["control"]);
  key("-", ["control"]);
  await sleep(150);
  const fieldAfter = await js(`document.activeElement.className + " " + document.activeElement.value`);
  key("Escape");
  await sleep(100);
  check(
    "Ctrl+= / Ctrl+- while typing a knob's value leave the field's text and focus alone",
    fieldBefore.startsWith("knob-value-field") && fieldAfter === fieldBefore,
    `${fieldBefore} → ${fieldAfter}`,
  );
  key("0", ["control"]);
  await sleep(200);
  check(
    "…and nothing in all of this said the zoom failed",
    !(await stopped()),
    await js(`document.getElementById("message").textContent`),
  );

  // Opening another video while one plays: the old one's decoding is cut
  // off as it's put away. That's no problem with the new file, which used
  // to be told "Part of the video couldn't be decoded". Ends on
  // long-counter.webm again, as before.
  await js(
    `window.__videoProblems = 0; new MutationObserver(() => { if (/couldn't be decoded/.test(document.getElementById("message").textContent)) __videoProblems++; }).observe(document.getElementById("message"), { childList: true, subtree: true, characterData: true })`,
  );
  for (let i = 0; i < 4; i++) {
    key("Space");
    await sleep(300);
    await openFile(path.join(FIXTURES, i % 2 ? "long-counter.webm" : "counter.webm"));
  }
  await ensurePaused();
  const problems = await js(`__videoProblems`);
  check("opening a video while another plays reports no decoding problem", problems === 0, `${problems} shown`);
};
