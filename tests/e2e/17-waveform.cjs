// The waveform's look: scaled alike from song to song (a quiet song with
// one click isn't tiny, a loud mastered one isn't a solid block, nothing
// spills out of its card), and Settings › Waveform (the shape, stereo,
// the height), which keeps the zoom and scroll and redraws the minimap.
// Part of the end-to-end run (see run.cjs); `h` is the harness.
const fs = require("fs");
const path = require("path");

module.exports = async function (h) {
  const { js, wc, win, key, openFile, ensurePaused, check, shot, sleep, prefsFile, prefsStore, FIXTURES } = h;

  // The drawn waveform, measured on its (not yet played) canvases, column
  // by column: how tall it is (as a fraction of the canvas), how far its
  // middle is from the canvas's, how much is above or below the middle,
  // how many columns inside the drawing are empty (the gaps between bars),
  // and how its pixels' opacity is spread (two-tone has two levels).
  // `of`: the waveform (default) or the minimap.
  const measure = (of = "#waveform") =>
    js(`(() => {
      const host = [...document.querySelector("${of}").querySelectorAll("*")].find((el) => el.shadowRoot);
      const root = host.shadowRoot;
      const canvases = [...root.querySelectorAll(".canvases canvas")].filter((c) => c.width && c.height);
      const heights = [], offsets = [], above = [], below = [];
      const alphas = new Uint32Array(256);
      let emptyInside = 0, columns = 0;
      for (const canvas of canvases) {
        const { width: w, height: hgt } = canvas;
        const data = canvas.getContext("2d").getImageData(0, 0, w, hgt).data;
        let firstDrawn = -1, lastDrawn = -1;
        const colHeights = [];
        for (let x = 0; x < w; x++) {
          let first = -1, last = -1;
          for (let y = 0; y < hgt; y++) {
            const a = data[(y * w + x) * 4 + 3];
            if (a > 8) { if (first < 0) first = y; last = y; alphas[a]++; }
          }
          colHeights.push(first < 0 ? 0 : (last - first + 1) / hgt);
          if (first >= 0) {
            if (firstDrawn < 0) firstDrawn = x;
            lastDrawn = x;
            if (last - first + 1 > hgt * 0.05) offsets.push(((first + last) / 2 - hgt / 2) / hgt);
            above.push(Math.max(0, hgt / 2 - first) / (hgt / 2));
            below.push(Math.max(0, last - hgt / 2) / (hgt / 2));
          }
        }
        for (let x = firstDrawn; x >= 0 && x <= lastDrawn; x++) { columns++; if (colHeights[x] === 0) emptyInside++; }
        // The gaps between bars don't count towards the heights.
        heights.push(...colHeights.filter((v) => v > 0));
      }
      const sorted = [...heights].sort((a, b) => a - b);
      const mean = heights.reduce((s, v) => s + v, 0) / (heights.length || 1);
      const sd = Math.sqrt(heights.reduce((s, v) => s + (v - mean) ** 2, 0) / (heights.length || 1));
      const avg = (list) => list.reduce((s, v) => s + v, 0) / (list.length || 1);
      let maxAlpha = 0, total = 0;
      for (let a = 0; a < 256; a++) if (alphas[a]) { maxAlpha = a; total += alphas[a]; }
      let mid = 0, full = 0;
      for (let a = 0; a < 256; a++) {
        if (a >= 0.15 * maxAlpha && a <= 0.65 * maxAlpha) mid += alphas[a];
        if (a >= 0.9 * maxAlpha) full += alphas[a];
      }
      const card = document.querySelector("${of}").getBoundingClientRect();
      const box = host.getBoundingClientRect();
      return {
        canvases: canvases.length,
        median: sorted[Math.floor(sorted.length / 2)] ?? 0,
        max: sorted.at(-1) ?? 0,
        cv: mean ? sd / mean : 0,
        centre: Math.max(0, ...offsets.map(Math.abs)),
        above: avg(above), below: avg(below),
        empty: columns ? emptyInside / columns : 0,
        mid: total ? mid / total : 0, full: total ? full / total : 0,
        overflow: Math.max(0, box.bottom - card.bottom, card.top - box.top, host.scrollHeight - host.clientHeight),
      };
    })()`);
  const minimapDrawn = () =>
    js(`(() => {
      const host = document.getElementById("waveform-minimap");
      const canvases = [...host.querySelectorAll("*")].flatMap((el) => [el, ...(el.shadowRoot ? el.shadowRoot.querySelectorAll("*") : [])]).filter((el) => el.tagName === "CANVAS" && el.width && el.height);
      return canvases.some((canvas) => { const d = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data; for (let i = 3; i < d.length; i += 4) if (d[i] > 8) return true; return false; });
    })()`);
  const round = (m) => JSON.stringify(m, (_, v) => (typeof v === "number" ? +v.toFixed(3) : v));
  const saved = () => {
    try {
      return JSON.parse(fs.readFileSync(prefsFile, "utf8"));
    } catch {
      return {}; // nothing saved yet
    }
  };
  // The zoom and scroll, in px: the whole waveform's width and the scroll.
  const view = () =>
    js(
      `(() => { const root = document.querySelector("#waveform > div").shadowRoot; return { width: root.querySelector(".wrapper").getBoundingClientRect().width, scroll: root.querySelector(".scroll").scrollLeft }; })()`,
    );

  // Settings › Waveform. Each step answers whether it found what it needed,
  // so a missing tab or field fails its checks instead of stopping the run.
  const row = (field) => `document.querySelector('#settings-waveform [data-key="${field}"]')`;
  const openSettings = async () => {
    await js(`document.getElementById("settingsButton").click()`);
    await sleep(200);
    return js(
      `(() => { const tab = document.getElementById("settings-tab-waveform"); if (!tab) return false; tab.click(); return true; })()`,
    );
  };
  const closeSettings = async () => {
    if (await js(`document.getElementById("settingsDialog").open`)) {
      key("Escape");
      await sleep(200);
    }
  };
  const choose = async (field, value) => {
    const done = await js(
      `(() => { const input = ${row(field)}?.querySelector('input[value="${value}"]'); if (!input) return false; input.click(); return true; })()`,
    );
    await sleep(400);
    return done;
  };
  const setHeight = async (value) => {
    const done = await js(
      `(() => { const input = ${row("height")}?.querySelector('input[type="range"]'); if (!input) return false; input.value = "${value}"; input.dispatchEvent(new Event("change")); return true; })()`,
    );
    await sleep(400);
    return done;
  };

  // `code`'s numbers (the page's CSS px) in the window's px: times the page zoom.
  const inWindow = async (code) => {
    const zoom = wc.getZoomFactor();
    return Object.fromEntries(Object.entries(await js(code)).map(([k, v]) => [k, Math.round(v * zoom)]));
  };
  // The longest strip of the card's background along a row through the
  // middle of the waveform, read off the screen. `settle`: how long the canvases get to draw first (0: the very next
  // frame, as when following playback pages the view).
  async function longestGap({ settle = 250 } = {}) {
    const card = await inWindow(
      `(() => { const r = document.getElementById("waveform").getBoundingClientRect(); return { x: r.left + 3, y: r.top + r.height / 2, width: r.width - 6, top: r.top + r.height * 0.03 }; })()`,
    );
    // Wait for lazily drawn canvases, then read the screen.
    if (settle) {
      await sleep(settle);
      wc.invalidate();
      await sleep(100);
    }
    const row = async (y) => {
      const image = await win.capturePage({ x: card.x, y, width: card.width, height: 1 });
      const scale = image.getSize().width / card.width;
      const bitmap = image.toBitmap(); // BGRA
      return Array.from({ length: card.width }, (_, x) => {
        const i = Math.floor(x * scale) * 4;
        return [bitmap[i + 2], bitmap[i + 1], bitmap[i]];
      });
    };
    const [background] = await row(card.top); // above the wave: the card's background
    const middle = await row(card.y);
    let longest = 0;
    let run = 0;
    let where = -1;
    middle.forEach((pixel, x) => {
      const isBackground = pixel.every((v, k) => Math.abs(v - background[k]) <= 6);
      run = isBackground ? run + 1 : 0;
      if (run > longest) [longest, where] = [run, x];
    });
    return { longest, where };
  }

  await ensurePaused();

  // Scaling: three kinds of track, at the default settings, zoomed out.
  await openFile(path.join(FIXTURES, "quiet-spike.wav"));
  await sleep(300);
  const quiet = await measure();
  check(
    "a quiet song with one loud click is drawn tall, not tiny",
    quiet.canvases > 0 && quiet.median >= 0.4,
    round(quiet),
  );
  await shot("waveform-quiet-spike.png");

  await openFile(path.join(FIXTURES, "loud-beats.wav"));
  await sleep(300);
  const loud = await measure();
  check("a loud, compressed song shows its beats (not a solid block)", loud.cv >= 0.3, round(loud));
  await shot("waveform-loud-beats.png");

  for (const [name, m] of [
    ["quiet-spike", quiet],
    ["loud-beats", loud],
  ]) {
    check(
      `${name}: nothing spills out of the waveform's card, and it is centred`,
      m.overflow <= 1 && m.centre <= 0.03 && m.max <= 1,
      round(m),
    );
  }

  // The minimap exaggerates loud and quiet parts, to find your way around.
  await openFile(path.join(FIXTURES, "verse-chorus.wav"));
  await sleep(300);
  const mainWave = await measure();
  const overview = await measure("#waveform-minimap");
  check(
    "the minimap exaggerates loud and quiet parts (much more contrast than the waveform)",
    overview.canvases > 0 && overview.cv >= 2 * mainWave.cv && overview.max >= 0.85,
    `waveform ${round(mainWave)}, minimap ${round(overview)}`,
  );
  check("…and stays inside its card", overview.overflow <= 1 && overview.centre <= 0.05, round(overview));
  await shot("waveform-minimap.png");

  // Stereo: a tone on the left only.
  await openFile(path.join(FIXTURES, "stereo-left.wav"));
  await sleep(300);
  const combined = await measure();
  check(
    "stereo, combined: both halves show the louder channel",
    combined.above >= 0.4 && Math.abs(combined.above - combined.below) <= 0.05,
    round(combined),
  );
  const stereoOpened = await openSettings();
  const split = (await choose("stereo", "split")) && (await measure());
  await closeSettings();
  check(
    "stereo, split: left above, the silent right below stays (almost) empty",
    stereoOpened && split && split.above >= 0.4 && split.below <= 0.1,
    round(split),
  );
  await openSettings();
  await choose("stereo", "combined");
  await closeSettings();

  // The shapes, on a steady tone, zoomed in a little and scrolled, so
  // keeping the view is tested too.
  await openFile(path.join(FIXTURES, "tone.wav"));
  await sleep(300);
  {
    const { x, y } = await js(
      `(() => { const r = document.getElementById("waveform").getBoundingClientRect(); return { x: Math.round(r.left + r.width / 3), y: Math.round(r.top + r.height / 2) }; })()`,
    );
    for (let i = 0; i < 4; i++) wc.sendInputEvent({ type: "mouseWheel", x, y, deltaX: 0, deltaY: 400 });
    await sleep(400);
  }
  const zoomed = await view();
  const cardWidth = await js(`document.getElementById("waveform").getBoundingClientRect().width`);
  check(
    "(set-up) the tone is zoomed in and scrolled",
    zoomed.width > cardWidth * 1.5 && zoomed.scroll > 0,
    JSON.stringify(zoomed),
  );

  const bars = await measure();
  check("Bars (the default): bars with gaps between them", bars.empty >= 0.2, round(bars));
  await shot("waveform-bars.png");

  const opened = await openSettings();
  check("Settings has a Waveform tab", opened && (await js(`!document.getElementById("settings-waveform")?.hidden`)));

  const toContinuous = await choose("style", "continuous");
  const continuous = await measure();
  check(
    "Continuous: one shape, no gaps",
    toContinuous && continuous.empty <= 0.02 && continuous.median >= 0.4,
    round(continuous),
  );
  check("…saved to prefs.json", saved().waveform?.style === "continuous", JSON.stringify(saved().waveform));
  const afterContinuous = await view();
  check(
    "…keeps the zoom and scroll",
    Math.abs(afterContinuous.width - zoomed.width) <= 1 && Math.abs(afterContinuous.scroll - zoomed.scroll) <= 2,
    `${JSON.stringify(zoomed)} → ${JSON.stringify(afterContinuous)}`,
  );
  check("…and the minimap is still drawn", await minimapDrawn());
  await closeSettings();
  await shot("waveform-continuous.png");
  await openSettings();

  const toTwoTone = await choose("style", "twoTone");
  const twoTone = await measure();
  check(
    "Peak + loudness: a pale peak outline around a solid loudness core",
    toTwoTone && twoTone.mid >= 0.1 && twoTone.full >= 0.1 && twoTone.mid > bars.mid,
    round(twoTone),
  );
  check("…the measure choice is hidden (it shows both)", await js(`!!${row("measure")} && ${row("measure")}.hidden`));
  await closeSettings();
  await shot("waveform-two-tone.png");
  await openSettings();

  await choose("style", "bars");
  const before = await measure();
  const lower = await setHeight(50);
  const half = await measure();
  check(
    "the height setting scales the drawing",
    lower && Math.abs(half.median - before.median / 2) <= 0.08,
    `${round(before)} → ${round(half)}`,
  );
  check("…saved", saved().waveform?.height === 50);
  await setHeight(100);
  await closeSettings();

  // No seams: a zoomed-in waveform is drawn on several canvases side by
  // side (drawn as they scroll into view); none may leave a strip of
  // background between them. Checked on the real screen, along a row
  // through the middle of a steady sound, at several zooms and scrolls:
  // the continuous shape has no background there at all, bars only their
  // own gaps.
  const scroller = `document.querySelector("#waveform > div").shadowRoot.querySelector(".scroll")`;
  await openFile(path.join(FIXTURES, "long-chirp.mp3")); // 90 s at a steady level
  await sleep(300);
  // Move the mouse off the waveform, so the hover line isn't in the row.
  wc.sendInputEvent({ type: "mouseMove", x: 2, y: 2 });
  // Also with display scaling (a page zoom changes devicePixelRatio the
  // same way): canvases then sit at fractions of a device pixel.
  for (const scaling of [1, 1.25, 1.5, 0.9])
    for (const style of ["continuous", "bars"]) {
      wc.setZoomFactor(scaling);
      await sleep(400);
      const { x: wheelX, y: wheelY } = await inWindow(
        `(() => { const r = document.getElementById("waveform").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
      );
      await openSettings();
      await choose("style", style);
      await closeSettings();
      for (let i = 0; i < 20; i++)
        wc.sendInputEvent({ type: "mouseWheel", x: wheelX, y: wheelY, deltaX: 0, deltaY: -3000 });
      await sleep(300);
      const seen = [];
      for (let zoom = 0; zoom < 3; zoom++) {
        const widest = await js(`${scroller}.scrollWidth - ${scroller}.clientWidth`);
        for (const at of [0, 0.137, 0.5, 0.731, 1]) {
          await js(`${scroller}.scrollLeft = ${Math.round(widest * at)}`);
          const gap = await longestGap();
          seen.push({ zoom, at, ...gap });
        }
        // Paging a view-width at a time, read at once.
        for (let page = 1; page <= 4; page++) {
          await js(`${scroller}.scrollLeft += ${scroller}.clientWidth`);
          const gap = await longestGap({ settle: 0 });
          seen.push({ zoom, page, ...gap });
        }
        for (let i = 0; i < 6; i++)
          wc.sendInputEvent({ type: "mouseWheel", x: wheelX, y: wheelY, deltaX: 0, deltaY: 400 });
        wc.sendInputEvent({ type: "mouseMove", x: 2, y: 2 });
        await sleep(300);
      }
      const worst = seen.reduce((a, b) => (b.longest > a.longest ? b : a));
      check(
        `${style} at ${scaling * 100} % scaling: no strip of background cuts the waveform, at any zoom or scroll`,
        // Bars sit on one grid of whole device pixels (2 + 1 CSS px, rounded),
        // so every gap is the bars' own gap, also where two canvases meet.
        worst.longest <= (style === "bars" ? Math.round(3 * scaling) - Math.round(2 * scaling) : 0),
        JSON.stringify(worst),
      );
      await shot(`waveform-seams-${style}-${scaling * 100}.png`);
    }
  wc.setZoomFactor(1);
  await sleep(400);

  // Back to the defaults for whatever runs next.
  for (const [field, value] of Object.entries({
    style: "bars",
    measure: "loudness",
    scale: "linear",
    stereo: "combined",
    height: 100,
  }))
    prefsStore.set("waveform", field, value);
  await sleep(200);

  // A window made only taller or shorter redraws the waveform at its new
  // height (WaveSurfer itself only notices width changes).
  {
    await openFile(path.join(FIXTURES, "tone.wav"));
    const heights = () =>
      js(
        `(() => { const host = document.querySelector("#waveform > div").shadowRoot; return { container: document.getElementById("waveform").clientHeight, drawn: host.querySelector(".scroll").clientHeight }; })()`,
      );
    const [width, height] = win.getSize();
    win.setSize(width, height + 200);
    await sleep(600);
    const taller = await heights();
    win.setSize(width, height);
    await sleep(600);
    const back = await heights();
    check(
      "a taller or shorter window redraws the waveform at its height",
      Math.abs(taller.drawn - taller.container) <= 1 && Math.abs(back.drawn - back.container) <= 1,
      JSON.stringify({ taller, back }),
    );
  }
};
