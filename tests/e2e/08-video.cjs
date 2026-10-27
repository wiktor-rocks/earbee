// Video: the picture follows playback, loop wraps and drags (the proxy,
// its overview and its builders); zooming into the picture.
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

  // A long video, dragged far in right after opening: its proxy isn't
  // built there yet (its builders start at the start, a half and a
  // quarter), so the overview answers, and a builder moves there (and a
  // little before). Dragging back then shows the proxy, while the
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

  // Loading waited for the overview (one frame per keyframe: 12 here), and
  // several builders have started, spread over the video.
  const overviewFrames = Number(await js(`document.getElementById("videoCanvas").dataset.proxyOverview ?? 0`));
  check("loading builds the proxy's overview", overviewFrames >= 10, `${overviewFrames} frames, load ${loadMs} ms`);
  const early = await builtParts();
  check("the proxy is built in several places at once", early.split(" ").length >= 2, `built: ${early}`);

  // Far in, beyond the proxy: the overview answers at once, within one
  // keyframe gap (20 s) of where the drag is.
  s = await scrub(150, 200, 1600, 0);
  const far = s.filter((q) => q.t > 200);
  const near = far.filter((q) => Math.abs(q.frame - q.pos) <= 20).length / far.length;
  check(
    "a far drag shows a picture at once (≥90% within a keyframe gap)",
    s.some((q) => q.proxy) && near >= 0.9,
    `${(near * 100).toFixed(0)}%, built then: ${early}`,
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
    !end.proxy && Math.abs(end.frame - end.pos) < 0.05,
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
    wc.sendInputEvent({ type: "mouseMove", x: centre.x + 20 * i, y: centre.y, button: "left" });
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
  await openFile(path.join(FIXTURES, "long-counter.webm"));
  check("a new file shows all of its picture", (await zoomNow()) === "" && (await zoomBar()).level === "1.0×");

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
