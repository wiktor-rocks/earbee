// End-to-end tests for TranscriBee. Run with `npm test` (see launch.cjs).
//
// How it works
//   - The app's real index.html is loaded in an offscreen Electron window
//     rendering at 60 fps (a hidden window is throttled to ~1 fps, which
//     breaks anything driven by requestAnimationFrame).
//   - Input is real: keys, clicks, drags and wheel events go through
//     webContents.sendInputEvent, so the app's own handlers run.
//   - DevTools focus emulation makes the page behave as focused (needed for
//     :focus / keyboard-focus behaviour in an offscreen window).
//   - preload.cjs instruments the page: it records the Signalsmith worklet
//     node and AudioContext, offers __sample(ms) (per-frame position, worklet
//     input time, video frame time, waveform cursor) and an opt-in slow
//     decode (window.__slowDecode = ms) to observe loading states.
//   - Every network request is blocked, which also proves the app works
//     offline.
//   - Media comes from tests/fixtures (make-fixtures.sh); screenshots go to
//     tests/output.
//
// Needs a display server (X11 or Wayland), even though nothing is shown.
//
// Adding a check: call check("what it proves", condition, detail) at the
// right point of the sequence below; the run fails if any check fails.

const { app, BrowserWindow, session } = require("electron");
const path = require("path");
const fs = require("fs");
// The app under test: the project root, or a packaged app's resources dir
// (TB_APP_PATH, see launch.cjs). Fixtures and screenshots live next to this.
const PROJECT = process.env.TB_APP_PATH || path.resolve(__dirname, "..");
const FIXTURES = path.join(__dirname, "fixtures");
const OUTPUT = path.join(__dirname, "output");
fs.mkdirSync(OUTPUT, { recursive: true });
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
let pass = 0,
  fail = 0;
const check = (name, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${detail}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app
  .whenReady()
  .then(async () => {
    const blocked = [];
    session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
      const ok =
        details.url.startsWith("file:") ||
        details.url.startsWith("devtools:") ||
        details.url.startsWith("data:") ||
        details.url.startsWith("blob:");
      if (!ok) blocked.push(details.url);
      cb({ cancel: !ok });
    });
    const win = new BrowserWindow({
      show: false,
      width: 1200,
      height: 800,
      webPreferences: {
        offscreen: true,
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        backgroundThrottling: false,
      },
    });
    win.webContents.setFrameRate(60);
    win.webContents.focus();
    win.webContents.on("console-message", (e) => {
      if (e.level === "error" || e.level === "warning") console.log("  [page]", e.message);
    });
    await win.loadFile(path.join(PROJECT, "index.html"));
    const wc = win.webContents;
    const js = (code) => wc.executeJavaScript(code);
    const dbg = wc.debugger;
    dbg.attach("1.3");
    await dbg.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });

    async function openFile(file) {
      const { root } = await dbg.sendCommand("DOM.getDocument");
      const { nodeId } = await dbg.sendCommand("DOM.querySelector", { nodeId: root.nodeId, selector: "#file" });
      await dbg.sendCommand("DOM.setFileInputFiles", { nodeId, files: [file] });
      for (let i = 0; i < 200; i++) {
        await sleep(50);
        if (await js(`document.getElementById("loadingOverlay").hidden && !document.getElementById("play").disabled`))
          break;
      }
      await sleep(300);
    }
    function key(keyCode, modifiers = []) {
      wc.sendInputEvent({ type: "keyDown", keyCode, modifiers });
      wc.sendInputEvent({ type: "keyUp", keyCode, modifiers });
    }
    const rect = () =>
      js(
        `(() => { const w = document.querySelector("#waveform > div").shadowRoot.querySelector(".wrapper").getBoundingClientRect(); const c = document.getElementById("waveform").getBoundingClientRect(); return { left: w.left, width: w.width, y: c.top + c.height / 2 }; })()`,
      );
    const duration = () => js(`__parseTime(document.getElementById("trackTime").textContent.split(" / ")[1])`);
    async function xAt(time) {
      const r = await rect();
      const d = await duration();
      return Math.round(r.left + (time / d) * r.width);
    }
    async function click(time, modifiers = []) {
      const r = await rect();
      const x = await xAt(time);
      const y = Math.round(r.y);
      wc.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1, modifiers });
      wc.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1, modifiers });
      await sleep(120);
    }
    async function drag(from, to, modifiers = [], fromX, toX) {
      const r = await rect();
      const y = Math.round(r.y);
      const x1 = fromX ?? (await xAt(from));
      const x2 = toX ?? (await xAt(to));
      wc.sendInputEvent({ type: "mouseDown", x: x1, y, button: "left", clickCount: 1, modifiers });
      for (let i = 1; i <= 6; i++) {
        wc.sendInputEvent({ type: "mouseMove", x: Math.round(x1 + ((x2 - x1) * i) / 6), y, button: "left", modifiers });
        await sleep(20);
      }
      wc.sendInputEvent({ type: "mouseUp", x: x2, y, button: "left", clickCount: 1, modifiers });
      await sleep(150);
    }
    async function shot(name) {
      for (let attempt = 0; attempt < 5; attempt++) {
        wc.invalidate();
        await sleep(100);
        try {
          fs.writeFileSync(path.join(OUTPUT, name), (await win.capturePage()).toPNG());
          return;
        } catch (e) {
          if (attempt === 4) console.log("  screenshot failed:", name, e.message);
        }
      }
    }
    const pos = () => js(`__parseTime(document.getElementById("trackTime").textContent)`);
    const loopInfo = () =>
      js(
        `(() => { const e = document.getElementById("loopInfo"); return { hidden: e.hidden, text: e.textContent, disabled: e.classList.contains("disabled") }; })()`,
      );
    const loopRange = async () => {
      const l = await loopInfo();
      if (l.hidden) return null;
      const [a, b] = l.text
        .replace("Loop ", "")
        .split(" – ")
        .map((t) => js(`__parseTime(${JSON.stringify(t)})`));
      return { start: await a, end: await b, enabled: !l.disabled };
    };
    const sample = (ms) => js(`__sample(${ms})`);
    // First position after the key press took effect (the cursor moved).
    const firstMoved = (s, before) => (s.find((q) => Math.abs(q.pos - before) > 0.0005) ?? s.at(-1)).pos;
    const playing = () => js(`document.getElementById("play").textContent.includes("Pause")`);
    const ensurePaused = async () => {
      if (await playing()) {
        key(",");
        await sleep(150);
      }
    };

    // ---------- Static UI / offline ----------
    check("speed scale generated", (await js(`document.getElementById("speedScale").textContent`)) === "0.25×3×");
    check("volume scale generated", (await js(`document.getElementById("volumeScale").textContent`)) === "0%100%200%");
    await js(`document.fonts.ready`);
    check(
      "Nunito loaded offline",
      (await js(`document.fonts.check('16px "Nunito Variable"')`)) &&
        (await js(`[...document.fonts].some(f => f.family.includes("Nunito") && f.status === "loaded")`)),
    );
    check(
      "Righteous loaded offline",
      await js(`[...document.fonts].some(f => f.family.includes("Righteous") && f.status === "loaded")`),
    );
    check(
      "legend has Shift+L",
      (await js(`document.getElementById("shortcutList").textContent`)).includes("Shift+LClear loop"),
    );

    // ---------- Welcome screen ----------
    const screens = () =>
      js(
        `({ welcome: !document.getElementById("welcome").hidden && getComputedStyle(document.getElementById("welcome")).display !== "none", app: getComputedStyle(document.getElementById("app")).display !== "none" })`,
      );
    let sc = await screens();
    check("startup shows welcome, hides player", sc.welcome && !sc.app, JSON.stringify(sc));
    check(
      "welcome logo loaded",
      await js(
        `document.querySelector(".welcome-logo").complete && document.querySelector(".welcome-logo").naturalWidth > 0`,
      ),
    );
    check("Open button has focus", await js(`document.activeElement.id === "welcomeOpen"`));
    await shot("welcome.png");
    const opened = await js(
      `(() => { const input = document.getElementById("file"); let n = 0; const orig = input.click; input.click = () => n++; document.getElementById("welcomeOpen").click(); input.click = orig; return n; })()`,
    );
    check("Open button opens the file chooser", opened === 1, opened);
    fs.writeFileSync(path.join(FIXTURES, "bad.mp3"), "not audio");
    const loadState = () =>
      js(
        `({ screen: !document.getElementById("loadingScreen").hidden, overlay: !document.getElementById("loadingOverlay").hidden, welcome: !document.getElementById("welcome").hidden, name: document.getElementById("loadingFileName").textContent, pulse: getComputedStyle(document.querySelector("#loadingScreen .logo-aura"), "::before").animationName })`,
      );
    async function setFile(file) {
      const { root } = await dbg.sendCommand("DOM.getDocument");
      const { nodeId } = await dbg.sendCommand("DOM.querySelector", { nodeId: root.nodeId, selector: "#file" });
      await dbg.sendCommand("DOM.setFileInputFiles", { nodeId, files: [file] });
    }
    await js(`window.__slowDecode = 800`);
    await setFile(path.join(FIXTURES, "bad.mp3"));
    await sleep(300);
    let ls = await loadState();
    check("first load: loading screen replaces welcome", ls.screen && !ls.welcome && !ls.overlay, JSON.stringify(ls));
    check("loading screen shows file name", ls.name === "bad.mp3", ls.name);
    check("aura pulses", ls.pulse === "aura-pulse", ls.pulse);
    await shot("loading-screen.png");
    for (let i = 0; i < 60; i++) {
      await sleep(50);
      if ((await loadState()).welcome) break;
    }
    ls = await loadState();
    check(
      "failed first load: back to welcome, loading screen gone",
      ls.welcome && !ls.screen && !ls.overlay,
      JSON.stringify(ls),
    );
    check("failed first load: Open button focused", await js(`document.activeElement.id === "welcomeOpen"`));
    await js(`window.__slowDecode = 0`);
    sc = await screens();
    const wm = await js(
      `(() => { const e = document.getElementById("welcomeMessage"); return { text: e.textContent, notice: e.classList.contains("notice"), color: getComputedStyle(e).color }; })()`,
    );
    check("bad first file: stays on welcome", sc.welcome && !sc.app, JSON.stringify(sc));
    check(
      "bad first file: red error on welcome",
      wm.text.includes("Couldn't open") && !wm.notice && wm.color === "rgb(255, 107, 107)",
      JSON.stringify(wm),
    );
    await shot("welcome-error.png");
    await js(`window.dispatchEvent(new DragEvent("dragover", { cancelable: true }))`);
    const dragBorder = await js(
      `document.body.classList.contains("dragging") && getComputedStyle(document.querySelector(".welcome-drop")).borderTopColor`,
    );
    check("drag over highlights drop zone", dragBorder === "rgb(245, 179, 1)", dragBorder);
    await shot("welcome-drag.png");
    await js(`window.dispatchEvent(new DragEvent("dragleave", { relatedTarget: null }))`);
    check("drag leave clears highlight", !(await js(`document.body.classList.contains("dragging")`)));
    // Drop a file to open it
    await js(
      `(async () => { const blob = await (await fetch(${JSON.stringify("file://" + path.join(FIXTURES, "tone.wav"))})).blob(); const dt = new DataTransfer(); dt.items.add(new File([blob], "tone.wav", { type: "audio/wav" })); window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, cancelable: true })); })()`,
    );
    for (let i = 0; i < 100; i++) {
      await sleep(50);
      if (await js(`!document.getElementById("app").hidden && document.getElementById("loadingOverlay").hidden`)) break;
    }
    await sleep(300);
    sc = await screens();
    check("dropped file opens the player", !sc.welcome && sc.app, JSON.stringify(sc));
    const widths = await js(
      `(() => { const w = document.querySelector("#waveform > div").shadowRoot.querySelector(".wrapper").getBoundingClientRect().width; return { wrapper: w, container: document.getElementById("waveform").clientWidth }; })()`,
    );
    check("waveform drawn at full width", Math.abs(widths.wrapper - widths.container) < 4, JSON.stringify(widths));
    check("welcome error cleared from player", (await js(`document.getElementById("message").textContent`)) === "");

    await js(`window.__slowDecode = 800`);
    await setFile(path.join(FIXTURES, "tone.wav"));
    await sleep(300);
    ls = await loadState();
    check(
      "later load: overlay over player, no loading screen",
      ls.overlay && !ls.screen && !ls.welcome,
      JSON.stringify(ls),
    );
    await js(`window.__slowDecode = 0`);
    for (let i = 0; i < 60; i++) {
      await sleep(50);
      if (!(await loadState()).overlay) break;
    }

    // ---------- Audio file ----------
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

    // ---------- Space replay ----------
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

    // ---------- Arrow-key stepping ----------
    const stepText = () =>
      js(
        `["stepSize", "stepBack", "stepForward"].map((id) => document.getElementById(id).textContent.trim()).join("|")`,
      );
    check(
      "default step 1 s, arrow buttons",
      (await stepText()) === "Step 1 s||" &&
        (await js(`!!document.querySelector("#stepBack svg") && !!document.querySelector("#stepForward svg")`)),
      await stepText(),
    );
    await click(5);
    let p0 = await pos();
    key("Right");
    await sleep(100);
    check("→ steps forward 1 s", Math.abs((await pos()) - p0 - 1) < 0.002, await pos());
    key("Left");
    await sleep(100);
    check("← steps back 1 s", Math.abs((await pos()) - p0) < 0.002, await pos());
    key("Down");
    key("Down");
    await sleep(100);
    check("↓↓ gives 0.25 s step, buttons unlabelled", (await stepText()) === "Step 0.25 s||", await stepText());
    key("Right");
    await sleep(100);
    check("→ steps 0.25 s", Math.abs((await pos()) - p0 - 0.25) < 0.002, await pos());
    for (let i = 0; i < 10; i++) key("Down");
    await sleep(100);
    check("step stops at 0.01", (await stepText()).startsWith("Step 0.01 s"), await stepText());
    for (let i = 0; i < 10; i++) key("Up");
    await sleep(100);
    check("step stops at 10", (await stepText()).startsWith("Step 10 s"), await stepText());
    for (let i = 0; i < 4; i++) key("Down");
    await sleep(100); // back to 0.5
    check("back to 0.5", (await stepText()).startsWith("Step 0.5 s"), await stepText());
    await click(2);
    p0 = await pos();
    wc.sendInputEvent({ type: "keyDown", keyCode: "Right" });
    for (let i = 0; i < 4; i++) wc.sendInputEvent({ type: "keyDown", keyCode: "Right", modifiers: ["isAutoRepeat"] });
    wc.sendInputEvent({ type: "keyUp", keyCode: "Right" });
    await sleep(150);
    check("holding → repeats", Math.abs((await pos()) - p0 - 2.5) < 0.002, `${p0} → ${await pos()}`);
    wc.sendInputEvent({ type: "keyDown", keyCode: "Up" });
    for (let i = 0; i < 4; i++) wc.sendInputEvent({ type: "keyDown", keyCode: "Up", modifiers: ["isAutoRepeat"] });
    wc.sendInputEvent({ type: "keyUp", keyCode: "Up" });
    await sleep(100);
    check("holding ↑ changes step once", (await stepText()).startsWith("Step 1 s"), await stepText());
    p0 = await pos();
    key("R");
    key("C");
    await sleep(100);
    check("R / C do nothing", (await pos()) === p0);
    const legend = await js(`document.getElementById("shortcutList").textContent`);
    check(
      "legend shows arrows, no R/C",
      legend.includes("←Step back") && legend.includes("↓Smaller step") && !legend.includes("Skip"),
      legend,
    );
    // Clicked slider: arrows still step the cursor
    const sl = await js(
      `(() => { const r = document.getElementById("speed").getBoundingClientRect(); return { x: Math.round(r.left + r.width * 0.27), y: Math.round(r.top + r.height / 2) }; })()`,
    );
    wc.sendInputEvent({ type: "mouseDown", x: sl.x, y: sl.y, button: "left", clickCount: 1 });
    wc.sendInputEvent({ type: "mouseUp", x: sl.x, y: sl.y, button: "left", clickCount: 1 });
    await sleep(100);
    const speedBefore = await js(`document.getElementById("speed").value`);
    p0 = await pos();
    check("slider has focus after click", await js(`document.activeElement.id === "speed"`));
    key("Right");
    await sleep(100);
    check(
      "clicked slider: → steps cursor, speed unchanged",
      (await js(`document.getElementById("speed").value`)) === speedBefore && Math.abs((await pos()) - p0 - 1) < 0.002,
      `${speedBefore} ${p0}→${await pos()}`,
    );
    // Tab-focused slider keeps arrows
    await js(`document.getElementById("speed").blur(); document.getElementById("stepForward").focus()`);
    for (let i = 0; i < 15 && !(await js(`document.activeElement.id === "speed"`)); i++) {
      key("Tab");
      await sleep(30);
    }
    const fv = await js(`document.getElementById("speed").matches(":focus-visible")`);
    p0 = await pos();
    const v0 = await js(`document.getElementById("speed").value`);
    key("Right");
    await sleep(100);
    const v1 = await js(`document.getElementById("speed").value`);
    check("Tab-focused slider keeps arrows", v1 !== v0 && (await pos()) === p0, `focus-visible=${fv} ${v0}→${v1}`);
    await js(`document.querySelector('#speedChips [data-speed="1"]').click(); document.activeElement.blur()`);
    // Loop interplay and Space after stepping
    await click(5);
    key("[");
    await click(6);
    key("]");
    await sleep(100);
    await click(5.8);
    key("Space");
    await sleep(100);
    key("Right");
    await sleep(200);
    p = await pos();
    await ensurePaused();
    check("stepping past B while looping lands in loop", p >= 4.99 && p < 6.01, p);
    key("L", ["shift"]);
    await click(10);
    key("Right");
    await sleep(100);
    key("Space");
    s = await sample(300);
    await ensurePaused();
    check(
      "step while paused, Space plays from stepped spot",
      Math.abs(firstMoved(s, 11) - 11) < 0.06 || Math.abs(s[0].pos - 11) < 0.06,
      s.slice(0, 3).map((q) => q.pos),
    );

    // ---------- Zoom at the mouse ----------
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
      const scroll = () =>
        js(`document.querySelector("#waveform > div").shadowRoot.querySelector(".scroll").scrollLeft`);
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
      s = await sample(Math.round((visEnd - 5 + 0.8) * 1000));
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

    // ---------- Error vs notice ----------
    fs.writeFileSync(path.join(FIXTURES, "bad.mp3"), "not audio");
    await openFile(path.join(FIXTURES, "bad.mp3"));
    const msg = await js(
      `(() => { const e = document.getElementById("message"); return { text: e.textContent, notice: e.classList.contains("notice"), color: getComputedStyle(e).color }; })()`,
    );
    check(
      "bad file after first load: red error in player",
      msg.text.includes("Couldn't open") && !msg.notice,
      JSON.stringify(msg),
    );
    check("bad file keeps loop of previous song", !(await loopInfo()).hidden);
    await shot("error.png");

    // ---------- Video ----------
    await openFile(path.join(FIXTURES, "counter.webm"));
    check("new file clears loop", (await loopInfo()).hidden);
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

    console.log(`\n${pass} pass, ${fail} fail`);
    app.exit(fail ? 1 : 0);
  })
  .catch((e) => {
    console.error(e);
    app.exit(2);
  });
