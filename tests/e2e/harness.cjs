// The end-to-end harness: an offscreen window with the app, and the helpers
// the topic files use (see run.cjs for how the run works). createHarness()
// returns them all in one object, `h`.
const { app, BrowserWindow, ipcMain, nativeTheme, protocol, session, utilityProcess } = require("electron");
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
const near = (a, b, within = 0.06) => Math.abs(a - b) <= within;

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
      details.url.startsWith("earbee-media:");
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
  // The settings as main.js keeps them, in a fresh file each run; the
  // system is treated as dark, so "Automatic" is predictable. The folder
  // picker is a stand-in: it answers `folderChoice.path` (null = canceled)
  // and counts how often it was asked.
  nativeTheme.themeSource = "dark";
  const prefsFile = path.join(OUTPUT, "prefs.json");
  fs.rmSync(prefsFile, { force: true });
  const { createPrefsStore, createThemeView, handlePrefs } = require(path.join(PROJECT, "electron", "prefs-store.js"));
  const prefsStore = createPrefsStore(prefsFile);
  const folderChoice = { path: null, asked: 0 };
  handlePrefs(ipcMain, prefsStore, {
    initialTheme: createThemeView(prefsStore, nativeTheme).initial,
    defaultPaths: { "downloads.folder": DOWNLOADS },
    chooseFolder: async () => (folderChoice.asked++, folderChoice.path),
    pages: () => BrowserWindow.getAllWindows().map((win) => win.webContents),
  });
  // Downloads as main.js does them, but with the fake yt-dlp. Search
  // results' pictures come from a stand-in fetch (a 1×1 PNG for
  // https://fake.test/…), and the browser is a list of what it was asked
  // to open (externalOpens).
  const PIXEL = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const fakeFetch = async (url) =>
    String(url).startsWith("https://fake.test/")
      ? new Response(PIXEL, { headers: { "content-type": "image/png" } })
      : new Response(null, { status: 404 });
  const externalOpens = [];
  require(path.join(PROJECT, "electron", "downloader.js")).handleDownloads(ipcMain, {
    fetch: fakeFetch,
    openExternal: (url) => externalOpens.push(url),
    binDir: path.join(OUTPUT, "unused-bin"),
    saveDir: DOWNLOADS,
    prefs: () => prefsStore.get("downloads"),
    ytDlp: path.join(TESTS, "fake-yt-dlp.cjs"),
    share: mediaFiles.share,
  });
  // Project files as main.js handles them, with stand-in dialogs: each
  // answers what `projectDialogs` holds (save/locate: a path or null;
  // confirm: "save" | "discard" | "cancel") and is recorded in `asked`.
  const projectDialogs = { save: null, locate: null, confirm: "discard", asked: [] };
  const { createProjectFiles, handleProjects } = require(path.join(PROJECT, "electron", "project-files.js"));
  const answer = (kind) => async (_sender, detail) => (projectDialogs.asked.push([kind, detail]), projectDialogs[kind]);
  const stubDialogs = {
    save: answer("save"),
    locate: answer("locate"),
    confirm: answer("confirm"),
  };
  const projectState = new Map();
  handleProjects(ipcMain, createProjectFiles({ mediaFiles, dialogs: stubDialogs, appVersion: "test" }), {
    mediaFiles,
    dialogs: stubDialogs,
    state: projectState,
  });
  // As main.js does, except that a test can pretend the system has only
  // `memory.available` bytes left (null: the real figure).
  const memory = { available: null };
  const { availableMemory } = require(path.join(PROJECT, "electron", "system.js"));
  ipcMain.handle("system:available-memory", () => memory.available ?? availableMemory());
  // The beat model as main.js runs it.
  require(path.join(PROJECT, "electron", "beat-model.js")).handleBeatModel(ipcMain, { utilityProcess });
  // Video window (src/features/video-window/): as main.js allows it, but
  // hidden (an offscreen window.open window gets no size); videoWin() is
  // the open one (or null).
  const videoWindow = require(path.join(PROJECT, "electron", "windows.js"));
  videoWindow.handleVideoWindows(ipcMain);
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
  videoWindow.allowVideoWindow(win, {
    extraOptions: { show: false, webPreferences: { backgroundThrottling: false } },
  });
  const videoWin = () => BrowserWindow.getAllWindows().find((other) => other !== win && !other.isDestroyed()) ?? null;
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

  // Chooses `file` in the page's (hidden) file input, as the Open dialog
  // would; openFile also waits for it to load.
  async function setFiles(file) {
    const { root } = await dbg.sendCommand("DOM.getDocument");
    const { nodeId } = await dbg.sendCommand("DOM.querySelector", { nodeId: root.nodeId, selector: "#file" });
    await dbg.sendCommand("DOM.setFileInputFiles", { nodeId, files: [file] });
  }

  // Moves the slider with this id to `value`, as dragging it would.
  const slide = (id, value) =>
    js(
      `(() => { const s = document.getElementById("${id}"); s.value = "${value}"; s.dispatchEvent(new Event("input")); })()`,
    );

  async function openFile(file) {
    await setFiles(file);
    for (let i = 0; i < 200; i++) {
      await sleep(50);
      if (await js(`document.getElementById("loadingOverlay").hidden && !document.getElementById("play").disabled`))
        break;
    }
    await sleep(300);
    // A file opens zoomed in on its start; the topics assume the whole
    // track in view, so note the opening view (06-zoom checks it) and zoom
    // all the way out.
    opened.view = await js(VIEW);
    const { x, y } = await js(
      `(() => { const r = document.getElementById("waveform").getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`,
    );
    for (let i = 0; i < 20; i++) wc.sendInputEvent({ type: "mouseWheel", x, y, deltaX: 0, deltaY: -3000 });
    await sleep(300);
  }
  // The whole waveform's left edge and width, the visible part's, and the scroll.
  const VIEW = `(() => { const host = document.querySelector("#waveform > div").shadowRoot; const w = host.querySelector(".wrapper").getBoundingClientRect(); const c = document.getElementById("waveform").getBoundingClientRect(); return { wl: w.left, ww: w.width, cl: c.left, cw: c.width, scroll: host.querySelector(".scroll").scrollLeft }; })()`;
  const opened = { view: null };
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
  // The notifications showing (ui/toast.js): [{ text, detail }], oldest first.
  const toasts = () =>
    js(
      `[...document.querySelectorAll(".toast:not(.leaving)")].map((t) => ({ text: t.querySelector("span").textContent, detail: t.querySelector("small")?.textContent ?? "" }))`,
    );
  const clearToasts = () => js(`document.querySelectorAll(".toast").forEach((t) => t.remove())`);
  const loopInfo = () =>
    js(
      `(() => { const e = document.getElementById("loopInfo"); return { hidden: e.hidden, text: e.textContent, disabled: e.classList.contains("disabled") }; })()`,
    );
  const loopRange = async () => {
    const l = await loopInfo();
    if (l.hidden) return null;
    const [a, b] = l.text
      .replace("↻", "")
      .split("–")
      .map((t) => js(`__parseTime(${JSON.stringify(t.trim())})`));
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
    setFiles,
    openFile,
    opened, // { view }: the waveform's view right after the last openFile
    key,
    rect,
    duration,
    xAt,
    click,
    drag,
    slide,
    shot,
    pos,
    loopInfo,
    loopRange,
    toasts,
    clearToasts,
    sample,
    firstMoved,
    playing,
    ensurePaused,
    prefsFile,
    prefsStore,
    folderChoice,
    projectDialogs,
    externalOpens, // the links Open on YouTube passed to the system browser
    projectState, // the page's unsaved state, as the main process hears it
    videoWin, // the video window (src/features/video-window/), or null
    memory,
    check,
    sleep,
    near, // a and b within `within` seconds of each other
    FIXTURES,
    OUTPUT,
    DOWNLOADS,
  };
}

module.exports = { prepare, createHarness, results };
