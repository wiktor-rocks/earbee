// An audio file: seeking, the A–B loop (drawing, dragging, looping audio).
// Part of the end-to-end run (see run.cjs); `h` is the harness.
const path = require("path");

module.exports = async function (h) {
  const {
    blocked,
    wc,
    js,
    rect,
    duration,
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
  // Each 2px edge line is centred on its time: the box reaches 1px past A
  // and past B (B's line used to sit left of B).
  const edges = await js(
    `(() => { const root = document.querySelector("#waveform > div").shadowRoot; const track = root.querySelector(".wrapper").getBoundingClientRect(); const box = root.querySelector('[part~="loop-region"]').getBoundingClientRect(); const x = (t) => track.left + (t / ${await duration()}) * track.width; return { start: box.left - x(${loop.start}), end: box.right - x(${loop.end}) }; })()`,
  );
  check(
    "loop edges centred on A and B",
    edges && Math.abs(edges.start + 1) < 1.5 && Math.abs(edges.end - 1) < 1.5,
    JSON.stringify(edges),
  );
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

  // Shift+, / Shift+.: the speed by 1 %, landing exactly on the presets.
  const speedNow = () =>
    js(`({ text: speedValue.textContent, chip: document.querySelector(".chip.active")?.dataset.speed ?? null })`);
  key(".", ["shift"]);
  await sleep(100);
  check("Shift+. speeds up by 1 %", (await speedNow()).text === "1.01×", JSON.stringify(await speedNow()));
  key(",", ["shift"]);
  key(",", ["shift"]);
  await sleep(100);
  check("Shift+, twice slows down by 2 %", (await speedNow()).text === "0.99×", JSON.stringify(await speedNow()));
  await js(`document.querySelector('#speedChips [data-speed="0.5"]').click()`);
  key(",", ["shift"]);
  await sleep(100);
  const below = await speedNow();
  key(".", ["shift"]);
  await sleep(100);
  check(
    "from 0.5×: 0.49× with no preset lit, then back on the 0.5× preset",
    below.text === "0.49×" && below.chip === null && (await speedNow()).chip === "0.5",
    `${JSON.stringify(below)} ${JSON.stringify(await speedNow())}`,
  );
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

  // A drag takes effect as it goes: while playing, pull B in from 4 to 2
  // with the mouse still held, and playback already wraps at 2.
  key("Space");
  await sleep(300);
  {
    const y = Math.round((await rect()).y);
    const [from, to] = [await xAt(4), await xAt(2)];
    wc.sendInputEvent({ type: "mouseDown", x: from, y, button: "left", clickCount: 1 });
    for (let i = 1; i <= 6; i++) {
      wc.sendInputEvent({ type: "mouseMove", x: Math.round(from + ((to - from) * i) / 6), y, button: "left" });
      await sleep(20);
    }
    await sleep(150);
    const held = await loopRange();
    check(
      "while dragging, the loop is already the dragged one",
      held && Math.abs(held.end - 2) < 0.06,
      JSON.stringify(held),
    );
    const during = (await sample(1500)).slice(10);
    let wraps = 0;
    for (let i = 1; i < during.length; i++) if (during[i].pos < during[i - 1].pos - 0.01) wraps++;
    check(
      "…and playback wraps at the pointer before the mouse is released",
      wraps >= 1 && during.every((p) => p.pos <= held.end + 0.01),
      `wraps=${wraps}, max ${Math.max(...during.map((p) => p.pos)).toFixed(3)}`,
    );
    wc.sendInputEvent({ type: "mouseUp", x: to, y, button: "left", clickCount: 1 });
    await sleep(150);
    check("releasing keeps it", Math.abs((await loopRange()).end - 2) < 0.06, JSON.stringify(await loopRange()));
  }
  await ensurePaused();
  await drag(null, 4, [], await xAt(2), undefined); // back to 0.5–4 for what follows
  loop = await loopRange();

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

  // A loop doesn't change the waveform's size: its chip shows in the side
  // panel (so the waveform keeps its height), and a loop
  // reaching the end stays inside the track (whose scrollWidth the ruler,
  // the lanes and zooming go by).
  const sizes = () =>
    js(
      `(() => { const wrapper = document.querySelector("#waveform > div").shadowRoot.querySelector(".wrapper"); return { wave: waveform.clientHeight, track: wrapper.scrollWidth, transport: document.querySelector(".transport").offsetHeight, chips: [...document.querySelectorAll(".dock :is(#startPoint, #stopPoint, #loopInfo):not([hidden])")].map((e) => e.id) }; })()`,
    );
  const sameSize = (a, b) => a.wave === b.wave && a.track === b.track && a.transport === b.transport;
  const noLoop = await sizes();
  await drag(13, 14, ["shift"]);
  const withLoop = await sizes();
  check(
    "a loop doesn't change the waveform's size",
    withLoop.chips.includes("loopInfo") && sameSize(noLoop, withLoop),
    JSON.stringify({ noLoop, withLoop }),
  );
  await click(15);
  key("["); // A here, B at the end
  await sleep(100);
  const toEnd = await sizes();
  check("…nor does one reaching the end", sameSize(noLoop, toEnd), JSON.stringify({ noLoop, toEnd }));
  key("L", ["shift"]);
  await sleep(100);

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
  await sleep(150);
  check("the hover line is back after the click, without moving the mouse", (await hover())?.time === shown.time);

  // The view moving under a still mouse (a sideways scroll, once zoomed
  // in) changes the line's time, not its place.
  const wheel = (deltaX, deltaY) => wc.sendInputEvent({ type: "mouseWheel", x, y, deltaX, deltaY });
  const trackWidth = () => js(`${shadow}.querySelector(".wrapper").getBoundingClientRect().width`);
  const fitWidth = await trackWidth();
  for (const deltaY of [-600, 600]) {
    wheel(0, deltaY);
    await sleep(150);
    if ((await trackWidth()) > fitWidth * 1.5) break;
  }
  let moved = await hover();
  for (const deltaX of [-200, 200]) {
    wheel(deltaX, 0);
    await sleep(150);
    moved = await hover();
    if (moved && moved.time !== shown.time) break;
  }
  check(
    "the hover line stays under the mouse when the view moves",
    moved && Math.abs(moved.x - x) <= 1 && moved.time !== shown.time,
    JSON.stringify({ shown, moved }),
  );
  // Back to fit to width, as the next topics expect.
  for (const deltaY of [-600, 600]) {
    for (let i = 0; i < 20; i++) wheel(0, deltaY);
    await sleep(150);
    if ((await trackWidth()) <= fitWidth + 1) break;
  }
  wc.sendInputEvent({ type: "mouseMove", x, y: 2 });
  await sleep(150);
  check("the hover line goes when the mouse leaves", (await hover()) === null);
};

// "0:05.012" → 5.012
function parseTime(text) {
  const [minutes, seconds] = text.split(":");
  return Number(minutes) * 60 + Number(seconds);
}
