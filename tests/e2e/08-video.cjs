// Video: the picture follows playback and loop wraps.
// Part of the end-to-end run (see run.cjs); `h` is the harness.
const path = require("path");

module.exports = async function (h) {
  const { js, openFile, key, drag, shot, loopInfo, loopRange, sample, ensurePaused, check, sleep, FIXTURES } = h;
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
};
