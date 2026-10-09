// An audio file: seeking, the A–B loop (drawing, dragging, looping audio).
// Part of the end-to-end run (see run.cjs); `h` is the harness.
const path = require("path");

module.exports = async function (h) {
  const {
    blocked,
    wc,
    js,
    rect,
    openFile,
    key,
    xAt,
    click,
    drag,
    shot,
    pos,
    loopInfo,
    loopRange,
    sample,
    ensurePaused,
    check,
    sleep,
    FIXTURES,
  } = h;

  await openFile(path.join(FIXTURES, "tone.wav"));
  check("audio engine works offline", await js(`__nodes.length > 0`), `blocked: ${JSON.stringify(blocked)}`);
  check("no network requests", blocked.length === 0, JSON.stringify(blocked));

  // Shift+drag creates a loop
  await drag(1, 2, ["shift"]);
  let loop = await loopRange();
  check(
    "shift+drag draws loop",
    loop && Math.abs(loop.start - 1) < 0.05 && Math.abs(loop.end - 2) < 0.05 && loop.enabled,
    JSON.stringify(loop),
  );
  const region = await js(
    `(() => { const e = document.querySelector("#waveform > div").shadowRoot.querySelector('[part~="loop-region"]'); return e && !e.hidden && getComputedStyle(e).backgroundColor; })()`,
  );
  check("loop region drawn and styled", region && region !== "rgba(0, 0, 0, 0)", region);
  await shot("loop-early.png");

  // Plain click still seeks
  await click(5);
  check("plain click seeks", Math.abs((await pos()) - 5) < 0.05, await pos());
  check("plain click keeps loop", (await loopRange())?.end > 1.9);

  // Play: starts at A (outside loop), wraps, stays inside
  async function loopRun(label, ms, minWraps) {
    key("Space");
    const s = await sample(ms);
    await ensurePaused();
    const inside = s.slice(20);
    const out = inside.filter((p) => p.pos < loop.start - 0.002 || p.pos > loop.end + 0.002);
    let wraps = 0;
    for (let i = 1; i < s.length; i++) if (s[i].pos < s[i - 1].pos - 0.01) wraps++;
    check(
      `${label}: cursor stays inside loop`,
      out.length === 0,
      `${out.length} outside, e.g. ${JSON.stringify(out[0])}`,
    );
    check(`${label}: wraps ≥ ${minWraps}`, wraps >= minWraps, `wraps=${wraps}`);
    const inputs = s
      .map((p) => p.input)
      .filter((v) => v !== undefined)
      .slice(20);
    const badInput = inputs.filter((v) => v < loop.start - 0.1 || v > loop.end + 0.25);
    check(
      `${label}: audio thread loops too`,
      badInput.length === 0,
      `min ${Math.min(...inputs).toFixed(3)} max ${Math.max(...inputs).toFixed(3)}`,
    );
    const jumps = [];
    for (let i = 21; i < s.length; i++) {
      const d = s[i].pos - s[i - 1].pos;
      if (d > 0.1) jumps.push(d);
    }
    check(`${label}: no forward jumps (smooth)`, jumps.length === 0, JSON.stringify(jumps.slice(0, 3)));
    return s;
  }
  let s = await loopRun("1x loop", 3500, 2);
  check("play started at A", Math.abs(s[2].pos - loop.start) < 0.1, s[2].pos);
  await js(`document.querySelector('#speedChips [data-speed="0.5"]').click()`);
  await loopRun("0.5x loop", 3500, 1);
  await js(`document.querySelector('#speedChips [data-speed="1"]').click()`);

  // Edge drag: B from 2 to 4
  await drag(null, 4, [], await xAt(loop.end), undefined);
  loop = await loopRange();
  check(
    "drag edge moves B",
    loop && Math.abs(loop.end - 4) < 0.06 && Math.abs(loop.start - 1) < 0.05,
    JSON.stringify(loop),
  );
  await drag(null, 0.5, [], await xAt(loop.start), undefined);
  loop = await loopRange();
  check(
    "drag edge moves A",
    loop && Math.abs(loop.start - 0.5) < 0.06 && Math.abs(loop.end - 4) < 0.06,
    JSON.stringify(loop),
  );

  // Short shift+drag acts as a click
  const xs = await xAt(10);
  await drag(null, null, ["shift"], xs, xs + 1);
  check(
    "tiny shift+drag is a click (seek, loop kept)",
    Math.abs((await pos()) - 10) < 0.06 && (await loopRange())?.end > 3.9,
    `${await pos()} ${JSON.stringify(await loopRange())}`,
  );

  // Seek after B while looping -> A
  key("Space");
  await sleep(400);
  await click(12);
  await sleep(200);
  let p = await pos();
  check("seek after B while looping goes to A", p >= loop.start - 0.01 && p < loop.end, p);
  // Set loop B before cursor while playing -> jumps to A
  await drag(13, 14, ["shift"]);
  await sleep(400);
  loop = await loopRange();
  p = await pos();
  check(
    "new loop drawn while playing elsewhere: jumps to it",
    p >= loop.start - 0.01 && p <= loop.end + 0.01,
    `${p} ${JSON.stringify(loop)}`,
  );
  await ensurePaused();

  // Keys [ ] L Shift+L
  await click(5);
  key("[");
  await sleep(100);
  loop = await loopRange();
  check(
    "[ sets A at cursor (B kept)",
    loop && Math.abs(loop.start - 5) < 0.05 && Math.abs(loop.end - 14) < 0.06,
    JSON.stringify(loop),
  );
  await click(7);
  key("]");
  await sleep(100);
  loop = await loopRange();
  check(
    "] sets B at cursor",
    loop && Math.abs(loop.start - 5) < 0.05 && Math.abs(loop.end - 7) < 0.05,
    JSON.stringify(loop),
  );
  await click(3);
  key("]");
  await sleep(100);
  loop = await loopRange();
  check("] before A resets A to 0", loop && loop.start === 0 && Math.abs(loop.end - 3) < 0.05, JSON.stringify(loop));
  await click(5);
  key("[");
  await sleep(100);
  await click(7);
  key("]");
  await sleep(100);
  key("L");
  await sleep(100);
  loop = await loopRange();
  check("L disables loop (still shown)", loop && !loop.enabled, JSON.stringify(loop));
  const dashed = await js(
    `(() => { const e = document.querySelector("#waveform > div").shadowRoot.querySelector('[part~="loop-region"]'); return getComputedStyle(e).borderLeftStyle; })()`,
  );
  check("disabled region drawn dashed", dashed === "dashed", dashed);
  await click(6.5);
  key("Space");
  await sleep(1200);
  p = await pos();
  await ensurePaused();
  check("disabled loop doesn't loop", p > 7.3, p);
  key("L");
  await sleep(100);
  check("L enables again", (await loopRange())?.enabled === true);
  key("L", ["shift"]);
  await sleep(100);
  check("Shift+L clears", (await loopInfo()).hidden);
  const regionHidden = await js(
    `(() => { const e = document.querySelector("#waveform > div").shadowRoot.querySelector('[part~="loop-region"]'); return !e || e.hidden; })()`,
  );
  check("region removed from waveform", regionHidden);

  // A slim playback cursor, and a hover line where a click would land.
  const shadow = `document.querySelector("#waveform > div").shadowRoot`;
  check(
    "the playback cursor is 1 px wide",
    (await js(`${shadow}.querySelector('[part~="cursor"]').style.width`)) === "1px",
  );
  const hover = () =>
    js(`(() => { const line = ${shadow}.querySelector('[part~="hover-line"]');
      return line && !line.hidden ? { x: line.getBoundingClientRect().left, time: line.textContent } : null; })()`);
  const y = Math.round((await rect()).y);
  const x = await xAt(5);
  wc.sendInputEvent({ type: "mouseMove", x, y });
  await sleep(150);
  const shown = await hover();
  check(
    "the hover line follows the mouse, with its time",
    shown && Math.abs(shown.x - x) <= 1 && shown.time.startsWith("0:05."),
    JSON.stringify(shown),
  );
  await shot("hover-line.png");
  await click(5);
  check(
    "a click goes to the time the hover line showed",
    Math.abs((await pos()) - parseTime(shown.time)) <= 0.01,
    await pos(),
  );
  wc.sendInputEvent({ type: "mouseMove", x, y: 2 });
  await sleep(150);
  check("the hover line goes when the mouse leaves", (await hover()) === null);
};

// "0:05.012" → 5.012
function parseTime(text) {
  const [minutes, seconds] = text.split(":");
  return Number(minutes) * 60 + Number(seconds);
}
