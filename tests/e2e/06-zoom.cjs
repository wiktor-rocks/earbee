// Zooming at the mouse, the wheel, following the cursor.
// Part of the end-to-end run (see run.cjs); `h` is the harness.

module.exports = async function (h) {
  const { wc, js, key, duration, click, shot, pos, sample, ensurePaused, check, sleep } = h;

  {
    const view = () =>
      js(
        `(() => { const host = document.querySelector("#waveform > div").shadowRoot; const w = host.querySelector(".wrapper").getBoundingClientRect(); const c = document.getElementById("waveform").getBoundingClientRect(); return { wl: w.left, ww: w.width, cl: c.left, cw: c.width, y: c.top + c.height / 2 }; })()`,
      );
    const timeAt = (v, x, d) => ((x - v.wl) / v.ww) * d;
    // Ctrl + wheel zooms; pass modifiers = [] explicitly to scroll instead.
    const wheel = (x, y, deltaY, modifiers = ["control"]) =>
      wc.sendInputEvent({ type: "mouseWheel", x, y, deltaX: 0, deltaY: -deltaY, modifiers });
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
    check("max zoom is 32× fit", Math.abs(vmax.ww / v0.ww - 32) < 0.5, (vmax.ww / v0.ww).toFixed(2));
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
    // ctrl+wheel during playback pauses following too
    const before = await scroll();
    const widthBefore = (await view()).ww;
    key("Space");
    await sleep(100);
    wheel(ax, ay, 1500 * zoomSign, []);
    await sleep(100);
    check(
      "plain wheel scrolls, doesn't zoom",
      (await scroll()) !== before && Math.abs((await view()).ww - widthBefore) < 1,
      `${before} → ${await scroll()}`,
    );
    const c0 = await scroll();
    await sleep(900);
    const c1 = await scroll();
    await ensurePaused();
    check("plain wheel scrolls and pauses following", c0 === c1, `${c0} → ${c1}`);
    for (let i = 0; i < 20; i++) wheel(ax, ay, -300 * zoomSign);
    await sleep(200);
  }

  // Screenshot with loop
  await click(4);
  key("[");
  await click(9);
  key("]");
  await sleep(200);
  await shot("loop.png");
};
