// Zooming at the mouse (the wheel on the waveform), scrolling (the wheel on
// the minimap), following the cursor; the lanes above the waveform (ruler,
// marks, guide lines) staying in sync with it.
// Part of the end-to-end run (see run.cjs); `h` is the harness.

module.exports = async function (h) {
  const { win, wc, js, key, duration, click, shot, pos, sample, ensurePaused, check, sleep, opened } = h;

  {
    // The harness zooms out after opening; this is the view a file opens with.
    const v = opened.view;
    const dur = await duration();
    check(
      "a file opens zoomed in (15 s in view) at its start",
      v.scroll === 0 && Math.abs(v.wl - v.cl) < 3 && Math.abs((v.cw / v.ww) * dur - 15) < 0.5,
      JSON.stringify(v),
    );
  }

  {
    const view = () =>
      js(
        `(() => { const host = document.querySelector("#waveform > div").shadowRoot; const w = host.querySelector(".wrapper").getBoundingClientRect(); const c = document.getElementById("waveform").getBoundingClientRect(); return { wl: w.left, ww: w.width, cl: c.left, cw: c.width, y: c.top + c.height / 2 }; })()`,
      );
    const timeAt = (v, x, d) => ((x - v.wl) / v.ww) * d;
    // A plain wheel, no modifiers: on the waveform it zooms.
    const wheel = (x, y, deltaY) => wc.sendInputEvent({ type: "mouseWheel", x, y, deltaX: 0, deltaY: -deltaY });
    // Electron's mouseWheel deltaY sign is inverted relative to DOM; probe it.
    let v0 = await view();
    const dur = await duration();
    const ax = Math.round(v0.cl + v0.cw * 0.75),
      ay = Math.round(v0.y);
    const t0 = timeAt(v0, ax, dur);
    wheel(ax, ay, -300);
    await sleep(150);
    let v1 = await view();
    let zoomSign = -1;
    if (v1.ww <= v0.ww + 1) {
      wheel(ax, ay, 600);
      await sleep(150);
      v1 = await view();
      zoomSign = 1;
    }
    check("wheel zooms in", v1.ww > v0.ww * 1.1, `${v0.ww} → ${v1.ww}`);
    const pxTime = (v) => dur / v.ww;
    check(
      "zoom-in keeps time under mouse",
      Math.abs(timeAt(v1, ax, dur) - t0) <= pxTime(v1) * 1.01,
      `${t0.toFixed(3)} → ${timeAt(v1, ax, dur).toFixed(3)}`,
    );
    let worst = 0;
    for (let i = 0; i < 5; i++) {
      wheel(ax, ay, 300 * zoomSign);
      await sleep(120);
      const v = await view();
      worst = Math.max(worst, Math.abs(timeAt(v, ax, dur) - t0) / pxTime(v));
    }
    check("deep zoom-in anchor ≤ 1 px", worst <= 1.01, `worst ${worst.toFixed(2)} px`);
    worst = 0;
    let vz;
    for (let i = 0; i < 4; i++) {
      wheel(ax, ay, -300 * zoomSign);
      await sleep(120);
      vz = await view();
      worst = Math.max(worst, Math.abs(timeAt(vz, ax, dur) - t0) / pxTime(vz));
    }
    check("zoom-out anchor ≤ 1 px", worst <= 1.01, `worst ${worst.toFixed(2)} px`);
    for (let i = 0; i < 40; i++) wheel(ax, ay, 300 * zoomSign);
    await sleep(300);
    const vmax = await view();
    check("max zoom is 48× fit", Math.abs(vmax.ww / v0.ww - 48) < 0.5, (vmax.ww / v0.ww).toFixed(2));
    for (let i = 0; i < 40; i++) wheel(ax, ay, -300 * zoomSign);
    await sleep(300);
    vz = await view();
    check(
      "full zoom-out returns to fit",
      Math.abs(vz.ww - vz.cw) < 4 && Math.abs(vz.wl - vz.cl) < 3,
      JSON.stringify(vz),
    );
    // edges
    const ex = Math.round(v0.cl + 3);
    const te = timeAt(await view(), ex, dur);
    for (let i = 0; i < 3; i++) wheel(ex, ay, 300 * zoomSign);
    await sleep(150);
    const ve = await view();
    check(
      "zoom at left edge anchors",
      Math.abs(timeAt(ve, ex, dur) - te) <= pxTime(ve) * 1.01 + 0.02,
      `${te.toFixed(3)} → ${timeAt(ve, ex, dur).toFixed(3)}`,
    );
    for (let i = 0; i < 20; i++) wheel(ex, ay, -300 * zoomSign);
    await sleep(200);
    // cursor independence: cursor at 2, zoom at 15
    await click(2);
    v0 = await view();
    const x15 = Math.round(v0.wl + (15 / dur) * v0.ww);
    const t15 = timeAt(v0, x15, dur);
    for (let i = 0; i < 4; i++) wheel(x15, ay, 300 * zoomSign);
    await sleep(150);
    v1 = await view();
    check(
      "zoom at 15 s with cursor at 2 s stays at 15 s",
      Math.abs(timeAt(v1, x15, dur) - t15) <= pxTime(v1) * 1.01,
      timeAt(v1, x15, dur).toFixed(3),
    );
    // follow pause while playing
    const scroll = () => js(`document.querySelector("#waveform > div").shadowRoot.querySelector(".scroll").scrollLeft`);
    key("Space");
    await sleep(100);
    const sc0 = await scroll();
    await sleep(1000);
    const sc1 = await scroll();
    check("playing: view stays where zoomed (no snap to cursor)", sc0 === sc1 && sc0 > 0, `${sc0} → ${sc1}`);
    key("Right");
    await sleep(250);
    v1 = await view();
    const cur = await pos();
    const curX = v1.wl + (cur / dur) * v1.ww;
    check(
      "step brings view back to cursor",
      curX >= v1.cl && curX <= v1.cl + v1.cw,
      `cursor ${cur} at x ${curX.toFixed(0)}`,
    );
    await ensurePaused();
    // look ahead: zoom on a spot ~1 s ahead, then follow resumes when the cursor arrives
    await click(5);
    for (let i = 0; i < 20; i++) wheel(ax, ay, -300 * zoomSign);
    await sleep(150);
    v0 = await view();
    const x6 = Math.round(v0.wl + (6.5 / dur) * v0.ww);
    for (let i = 0; i < 6; i++) wheel(x6, ay, 300 * zoomSign);
    await sleep(150);
    v1 = await view();
    const visStart = timeAt(v1, v1.cl, dur),
      visEnd = timeAt(v1, v1.cl + v1.cw, dur);
    key("Space");
    await sample(Math.round((visEnd - 5 + 0.8) * 1000)); // play until the cursor is due in view
    await ensurePaused();
    v1 = await view();
    const endCur = await pos();
    const endX = v1.wl + (endCur / dur) * v1.ww;
    check(
      "look-ahead view held until the cursor arrived",
      visStart > 5.05,
      `visible ${visStart.toFixed(2)}–${visEnd.toFixed(2)}`,
    );
    check(
      "following resumed and paged on",
      endCur > visEnd && endX >= v1.cl && endX <= v1.cl + v1.cw,
      `cursor ${endCur} x ${endX.toFixed(0)} view ${v1.cl}-${v1.cl + v1.cw}`,
    );
    // the wheel on the minimap scrolls, and pauses following too
    const before = await scroll();
    const widthBefore = (await view()).ww;
    const mini = await js(
      `(() => { const r = document.getElementById("waveform-minimap").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
    );
    key("Space");
    await sleep(100);
    wheel(Math.round(mini.x), Math.round(mini.y), -1500 * zoomSign);
    await sleep(100);
    check(
      "wheel on the minimap scrolls, doesn't zoom",
      (await scroll()) > before && Math.abs((await view()).ww - widthBefore) < 1,
      `${before} → ${await scroll()}`,
    );
    const c0 = await scroll();
    await sleep(900);
    const c1 = await scroll();
    await ensurePaused();
    check("minimap wheel pauses following", c0 === c1, `${c0} → ${c1}`);
    for (let i = 0; i < 20; i++) wheel(ax, ay, -300 * zoomSign);
    await sleep(200);
  }

  // The lanes stay in sync: every ruler tick, marker and guide line in view
  // sits where the waveform has its time (within 1 px), measured in the
  // same frame as the change. `then` runs in the page first (e.g. a scroll).
  {
    const measure = `(() => {
      const wave = document.querySelector("#waveform > div").shadowRoot.querySelector(".wrapper").getBoundingClientRect();
      const lane = document.getElementById("ruler").getBoundingClientRect();
      let worst = 0, count = 0;
      for (const el of document.querySelectorAll("#ruler .ruler-tick.major, #ruler .ruler-start, #timelineGuides > * > *, #marksLane .lane-mark")) {
        if (el.hidden || el.classList.contains("guide-stop") || el.classList.contains("guide-beats")) continue;
        const guide = el.parentElement.parentElement.id === "timelineGuides";
        const x = el.getBoundingClientRect().left + (guide ? 0.5 : 0);
        if (x < lane.left || x > lane.right) continue;
        worst = Math.max(worst, Math.abs(x - (wave.left + (parseFloat(el.style.left) / 100) * wave.width)));
        count++;
      }
      return { worst: Math.round(worst * 100) / 100, count };
    })()`;
    const inSync = (then = "") =>
      js(`new Promise((done) => { ${then}; requestAnimationFrame(() => done(${measure})); })`);
    const scroller = `document.querySelector("#waveform > div").shadowRoot.querySelector(".scroll")`;
    const wheelAt = async (time, deltaY) => {
      const r = await h.rect();
      const x = await h.xAt(time);
      for (let i = 0; i < 4; i++) wc.sendInputEvent({ type: "mouseWheel", x, y: Math.round(r.y), deltaX: 0, deltaY });
      await sleep(200);
    };

    await click(3);
    key("M");
    await click(6);
    key("R");
    await click(9);
    key("R");
    await sleep(100);
    let sync = await inSync();
    check("lanes in sync at fit", sync.worst <= 1 && sync.count > 5, JSON.stringify(sync));
    await wheelAt(6, 600);
    await wheelAt(6, -300);
    sync = await inSync();
    check("lanes in sync after a wheel zoom", sync.worst <= 1 && sync.count > 3, JSON.stringify(sync));
    sync = await inSync(`${scroller}.scrollLeft += 137`);
    check("lanes in sync in the frame of a scroll", sync.worst <= 1 && sync.count > 3, JSON.stringify(sync));
    // Every frame while playing zoomed in, with following paging the view.
    await click(2);
    key("Space");
    const frames = await js(`new Promise((done) => {
      const worst = []; const until = performance.now() + 2500;
      const frame = () => { worst.push(${measure}.worst); if (performance.now() < until) requestAnimationFrame(frame); else done(worst); };
      requestAnimationFrame(frame);
    })`);
    await ensurePaused();
    check(
      "lanes in sync in every frame while playing and following",
      frames.length > 60 && Math.max(...frames) <= 1,
      `${frames.length} frames, worst ${Math.max(...frames)} px`,
    );
    const [width, height] = win.getSize();
    win.setSize(width - 240, height);
    await sleep(400);
    sync = await inSync();
    win.setSize(width, height);
    await sleep(400);
    check("lanes in sync after a resize", sync.worst <= 1 && sync.count > 3, JSON.stringify(sync));
    await shot("timeline-zoomed.png");
    await wheelAt(6, -3000);
    await js(`document.querySelectorAll("#marksList .mark-remove").forEach((button) => button.click())`);
  }

  // Screenshot with loop
  await click(4);
  key("[");
  await click(9);
  key("]");
  await sleep(200);
  await shot("loop.png");
};
