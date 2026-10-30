// Space replays from where you started; comma resumes in place. The start
// point shows where Space plays from: a green line (dragged by its handle),
// a minimap tick and a readout; S sets it. The stop point, in red, shows
// where playback last stopped.
// Part of the end-to-end run (see run.cjs); `h` is the harness.

module.exports = async function (h) {
  const {
    wc,
    js,
    key,
    duration,
    click,
    drag,
    xAt,
    pos,
    sample,
    firstMoved,
    playing,
    ensurePaused,
    shot,
    check,
    sleep,
    near,
  } = h;
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

  // The start point: where Space plays from.
  const startAt = () => js(`__parseTime(document.getElementById("startPoint").textContent.replace("▶", "").trim())`);
  const lineX = () => js(`document.querySelector("#timelineGuides .guide-start").getBoundingClientRect().left + 0.5`);

  await click(5);
  check(
    "a click sets the start point: guide line, minimap tick and readout",
    near(await startAt(), 5, 0.03) &&
      Math.abs((await lineX()) - (await xAt(5))) <= 1.5 &&
      near(await js(`parseFloat(document.querySelector("#waveform-minimap .minimap-start").style.left)`), 25, 0.2),
    `${await startAt()} at ${await lineX()} vs ${await xAt(5)}`,
  );
  key("Space");
  await sleep(700);
  key("Space");
  await sleep(50);
  check(
    "after playing and pausing, it stays where playing started",
    (await pos()) > 5.4 && near(await startAt(), 5, 0.03),
  );

  // S while playing: what was heard, without stopping.
  key("Space");
  await sleep(600);
  const heard = await pos();
  key("S");
  await sleep(300);
  check("S doesn't stop playback", await playing());
  key("Space");
  await sleep(50);
  const fromS = await startAt();
  check("S sets the start point to what was heard", near(fromS, heard, 0.1), `${heard} → ${fromS}`);
  let before = await pos(); // the first sample can come before the key is handled
  key("Space");
  s = await sample(300);
  await ensurePaused();
  check("…and Space plays from there", near(firstMoved(s, before), fromS), firstMoved(s, before));
  await shot("start-point.png");

  // Dragging the handle moves the start point, not the cursor.
  const handle = await js(
    `(() => { const r = document.querySelector("#ruler .ruler-start").getBoundingClientRect(); return { x: Math.round(r.left + 3), y: Math.round(r.top + r.height / 2) }; })()`,
  );
  const cursorBefore = await pos();
  const target = await xAt(12);
  wc.sendInputEvent({ type: "mouseDown", x: handle.x, y: handle.y, button: "left", clickCount: 1 });
  for (let i = 1; i <= 6; i++) {
    const x = Math.round(handle.x + ((target - handle.x) * i) / 6);
    wc.sendInputEvent({ type: "mouseMove", x, y: handle.y, button: "left" });
    await sleep(20);
  }
  wc.sendInputEvent({ type: "mouseUp", x: target, y: handle.y, button: "left", clickCount: 1 });
  await sleep(150);
  check(
    "dragging the handle moves the start point, not the cursor",
    near(await startAt(), 12, 0.1) && near(await pos(), cursorBefore, 0.002),
    `${await startAt()}, cursor ${cursorBefore} → ${await pos()}`,
  );
  await js(`document.getElementById("startPoint").click()`);
  await sleep(100);
  check("clicking the readout goes there", near(await pos(), await startAt(), 0.002), await pos());

  // Outside an active loop, the start point and Space are where you
  // clicked: playback runs normally until the loop catches it.
  await drag(14, 16, ["shift"]);
  await click(5);
  check("outside an active loop, it shows where you clicked", near(await startAt(), 5, 0.03), await startAt());
  before = await pos();
  key("Space");
  s = await sample(300);
  await ensurePaused();
  check("…where Space starts", near(firstMoved(s, before), 5, 0.08), firstMoved(s, before));
  // Started inside the loop, the start point holds still while it wraps:
  // each wrap lands a few ms past the loop start, which used to move it.
  await click(14.5);
  const startShown = () =>
    js(
      `[document.getElementById("startPoint").textContent, document.querySelector("#timelineGuides .guide-start").style.left].join(" @ ")`,
    );
  const shownBefore = await startShown();
  key("Space");
  const shown = new Set();
  let wraps = 0;
  let last = await pos();
  for (const until = Date.now() + 4500; Date.now() < until;) {
    await sleep(60);
    shown.add(await startShown());
    const now = await pos();
    if (now < last - 0.01) wraps++;
    last = now;
  }
  key("Space");
  await sleep(50);
  check(
    "while a loop wraps, the start point holds still (readout and line)",
    wraps >= 2 && shown.size === 1 && shown.has(shownBefore),
    `${wraps} wraps; ${shownBefore} → ${[...shown].join(", ")}`,
  );
  before = await pos();
  key("Space");
  s = await sample(300);
  await ensurePaused();
  check("…and Space replays from it", near(firstMoved(s, before), 14.5, 0.08), firstMoved(s, before));
  key("L", ["shift"]);
  await sleep(100);

  key(".");
  await sleep(100);
  check("Stop moves it to 0", (await startAt()) === 0);

  // The stop point: where playback last stopped, in red.
  const stopAt = async () => {
    const left = await js(`(() => { const line = document.querySelector("#timelineGuides .guide-stop");
      return line && !line.hidden ? parseFloat(line.style.left) : null; })()`);
    return left === null ? null : (left / 100) * d;
  };
  await click(3);
  key("Space");
  await sleep(700);
  key("Space");
  await sleep(50);
  const pausedHere = await pos();
  check("pausing marks where it stopped", near(await stopAt(), pausedHere, 0.01), `${pausedHere} vs ${await stopAt()}`);
  check(
    "…on the minimap too",
    near(
      await js(`parseFloat(document.querySelector("#waveform-minimap .minimap-stop").style.left)`),
      (pausedHere / d) * 100,
      0.2,
    ),
  );
  key("Space"); // replays from 3: the stop point stays until the next stop
  await sleep(300);
  check("it stays while playing again", near(await stopAt(), pausedHere, 0.01));
  await sleep(300);
  const beforeStop = await pos();
  key(".");
  await sleep(100);
  const stoppedAt = await stopAt();
  check(
    "Stop marks where it was stopped, not 0",
    (await pos()) === 0 && near(stoppedAt, beforeStop, 0.1),
    `${beforeStop} vs ${stoppedAt}`,
  );
  const square = await js(
    `(() => { const r = document.querySelector("#ruler .ruler-stop").getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`,
  );
  wc.sendInputEvent({ type: "mouseDown", x: square.x, y: square.y, button: "left", clickCount: 1 });
  wc.sendInputEvent({ type: "mouseUp", x: square.x, y: square.y, button: "left", clickCount: 1 });
  await sleep(150);
  check("clicking its ■ goes there", near(await pos(), stoppedAt, 0.002), await pos());
  // The red readout beside the start point's: the same spot, and a click goes there.
  const readout = await js(`stopPoint.hidden ? null : __parseTime(stopPoint.textContent.replace("■", "").trim())`);
  await click(2);
  await js(`stopPoint.click()`);
  await sleep(100);
  check(
    "the ■ readout shows where it stopped, and a click goes there",
    near(readout, stoppedAt, 0.002) && near(await pos(), stoppedAt, 0.002),
    `${readout} vs ${stoppedAt}, cursor ${await pos()}`,
  );
  // Enter plays from the stop point (Space, from where playback started),
  // wherever the cursor is; Enter again pauses.
  await click(2);
  key("Enter");
  s = await sample(300);
  check(
    "Enter plays from the stop point",
    near(firstMoved(s, 2), stoppedAt, 0.06) && s.every((q) => q.pos >= stoppedAt - 0.002),
    `${stoppedAt} vs first ${firstMoved(s, 2)}`,
  );
  key("Enter");
  await sleep(150);
  check("Enter again pauses", !(await playing()));
  await shot("stop-point.png");
  await click(19);
  key("Space");
  await sleep(1600);
  check("reaching the end marks the end", near(await stopAt(), d, 0.01), await stopAt());
};
