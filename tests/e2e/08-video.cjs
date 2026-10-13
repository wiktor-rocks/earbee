// Video: the picture follows playback, loop wraps and drags (the proxy,
// its overview and its builders).
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
};
