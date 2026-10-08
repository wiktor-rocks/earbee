// The end-to-end harness: an offscreen window with the app, and the helpers
// the topic files use (see run.cjs for how the run works). createHarness()
// returns them all in one object, `h`.
const { app, BrowserWindow, ipcMain, nativeTheme, protocol, session } = require("electron");
const path = require("path");
const fs = require("fs");

// The app under test: the project root, or a packaged app's resources dir
// (TB_APP_PATH, see launch.cjs). Fixtures and screenshots live in tests/.
const TESTS = path.join(__dirname, "..");
const PROJECT = process.env.TB_APP_PATH || path.resolve(TESTS, "..");
const FIXTURES = path.join(TESTS, "fixtures");
const OUTPUT = path.join(TESTS, "output");
const DOWNLOADS = path.join(OUTPUT, "downloads");

const results = { pass: 0, fail: 0 };
const check = (name, ok, detail = "") => {
  ok ? results.pass++ : results.fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${detail}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Call before app is ready.
function prepare() {
  fs.mkdirSync(OUTPUT, { recursive: true });
  fs.rmSync(DOWNLOADS, { recursive: true, force: true });
  app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
  require(path.join(PROJECT, "electron", "media-files.js")).registerMediaScheme(protocol); // as main.js does
}

async function createHarness() {
  const blocked = [];
  session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
    const ok =
      details.url.startsWith("file:") ||
      details.url.startsWith("devtools:") ||
      details.url.startsWith("data:") ||
      details.url.startsWith("blob:") ||
      details.url.startsWith("transcribee-media:");
    if (!ok) blocked.push(details.url);
    cb({ cancel: !ok });
  });
  // As main.js does, but with the fake yt-dlp. The app's preload runs
  // alongside the instrumentation preload.
  // Its reads are counted (mediaReads), to see downloads read by URL.
  const { SCHEME, createMediaFiles } = require(path.join(PROJECT, "electron", "media-files.js"));
  const mediaFiles = createMediaFiles();
  const mediaReads = { count: 0 };
  protocol.handle(SCHEME, (request) => {
    mediaReads.count++;
    return mediaFiles.respond(request);
  });
  require(path.join(PROJECT, "electron", "downloader.js")).handleDownloads(ipcMain, {
    binDir: path.join(OUTPUT, "unused-bin"),
    saveDir: DOWNLOADS,
    ytDlp: path.join(TESTS, "fake-yt-dlp.cjs"),
    share: mediaFiles.share,
  });
  // As main.js does, with a fresh theme file each run; the system is
  // treated as dark, so "Automatic" is predictable.
  nativeTheme.themeSource = "dark";
  const themeFile = path.join(OUTPUT, "theme.json");
  fs.rmSync(themeFile, { force: true });
  const { createThemeStore, handleThemes } = require(path.join(PROJECT, "electron", "theme-store.js"));
  handleThemes(ipcMain, createThemeStore(themeFile, nativeTheme), () => {});
  // As main.js does, except that a test can pretend the system has only
  // `memory.available` bytes left (null: the real figure).
  const memory = { available: null };
  const { availableMemory } = require(path.join(PROJECT, "electron", "system.js"));
  ipcMain.handle("system:available-memory", () => memory.available ?? availableMemory());
  session.defaultSession.registerPreloadScript({
    type: "frame",
    filePath: path.join(PROJECT, "electron", "preload.js"),
  });
  const win = new BrowserWindow({
    show: false,
    width: 1200,
    height: 800,
    webPreferences: {
      offscreen: true,
      preload: path.join(TESTS, "preload.cjs"),
      sandbox: true, // as in main.js
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  win.webContents.setFrameRate(60);
  win.webContents.focus();
  const securityWarnings = [];
  win.webContents.on("console-message", (e) => {
    if (e.message.includes("Electron Security Warning")) securityWarnings.push(e.message.split("\n")[0]);
    else if (e.level === "error" || e.level === "warning") console.log("  [page]", e.message);
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

  return {
    blocked,
    mediaReads,
    share: mediaFiles.share, // serves a file to the page by URL, as downloads are
    win,
    securityWarnings,
    wc,
    js,
    dbg,
    openFile,
    key,
    rect,
    duration,
    xAt,
    click,
    drag,
    shot,
    pos,
    loopInfo,
    loopRange,
    sample,
    firstMoved,
    playing,
    ensurePaused,
    themeFile,
    memory,
    check,
    sleep,
    PROJECT,
    FIXTURES,
    OUTPUT,
    DOWNLOADS,
  };
}

module.exports = { prepare, createHarness, results };
