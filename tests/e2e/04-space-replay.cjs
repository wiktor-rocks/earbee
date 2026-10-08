// Space replays from where you started; comma resumes in place.
// Part of the end-to-end run (see run.cjs); `h` is the harness.

module.exports = async function (h) {
  const { js, key, duration, click, pos, sample, firstMoved, playing, ensurePaused, check, sleep } = h;
  let s;

  await click(3);
  key("Space");
  await sleep(1500);
  key("Space");
  await sleep(50);
  const pausedAt = await pos();
  s = await sample(400);
  check(
    "Space pause: cursor holds still",
    s.every((q) => Math.abs(q.pos - pausedAt) < 0.002),
    `${pausedAt} → ${s.at(-1).pos}`,
  );
  check("pause point is after start", pausedAt > 4.2, pausedAt);
  key("Space");
  s = await sample(300);
  check(
    "Space again replays from start (3.0)",
    Math.abs(firstMoved(s, pausedAt) - 3) < 0.06,
    `first ${firstMoved(s, pausedAt)}`,
  );
  await ensurePaused();
  await click(8);
  key("Space");
  s = await sample(300);
  await ensurePaused();
  check(
    "click while paused, Space plays from click",
    Math.abs(s.find((q) => q.pos > 7.9).pos - 8) < 0.06 && s.every((q) => q.pos >= 7.99),
    s.slice(0, 3).map((q) => q.pos),
  );
  key(".");
  await sleep(100);
  key("Space");
  s = await sample(300);
  await ensurePaused();
  check(
    "Stop then Space plays from 0",
    s.every((q) => q.pos < 0.4),
    s.slice(0, 3).map((q) => q.pos),
  );
  await click(3);
  key(",");
  await sleep(1000);
  key(",");
  await sleep(50);
  const commaAt = await pos();
  key(",");
  s = await sample(300);
  await ensurePaused();
  check("comma pauses after playing", commaAt > 3.8, commaAt);
  check(
    "comma resumes here",
    Math.abs(firstMoved(s, -1) - commaAt) < 0.06 && s.every((q) => q.pos >= commaAt - 0.002),
    `${commaAt} → ${s[0].pos}`,
  );
  // Play button acts like Space
  await click(2);
  key("Space");
  await sleep(800);
  key("Space");
  await sleep(50);
  await js(`document.getElementById("play").click()`);
  s = await sample(300);
  await ensurePaused();
  check("Play button replays from start", Math.abs(s[1].pos - 2) < 0.06, s[1].pos);
  // cursor vs clock
  key("Space");
  s = await sample(1500);
  await ensurePaused();
  const d = await duration();
  const off = s
    .slice(5)
    .map((q) => Math.abs((q.cursor / 100) * d - q.pos))
    .filter((v) => !Number.isNaN(v));
  check(
    "waveform cursor matches clock",
    off.length > 0 && Math.max(...off) < 0.03,
    `max ${Math.max(...off).toFixed(4)}s`,
  );
  // ended: Space replays from start
  await click(19);
  key("Space");
  await sleep(1600);
  check("track ended", !(await playing()));
  key("Space");
  s = await sample(300);
  await ensurePaused();
  check("after end, Space replays from where it started", Math.abs(firstMoved(s, d) - 19) < 0.06, firstMoved(s, d));
};
