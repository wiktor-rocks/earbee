// Profiles one load of one file in a fresh Electron process and writes the
// measurements as JSON. Started by run.cjs, one process per measurement, so
// memory never carries over. Linux only (memory is read from /proc).
//
// Environment:
//   TB_DIAG_MODE  what to measure:
//     app            open the file in the real app, as a user would
//     decode         file.arrayBuffer() + decodeAudioData, as the app does,
//                    in an AudioContext at the device's default rate
//     decode-native  the same, with the context at the file's own rate
//                    (no resampling)
//     stream         decode in chunks with mediabunny (WebCodecs), keeping
//                    the samples in preallocated Float32Arrays
//     stream-discard the same, dropping each chunk (decode speed alone)
//   TB_DIAG_FILE  the media file
//   TB_DIAG_OUT   where to write the JSON result
//
// Measured: wall time of each step, the renderer's resident memory (RSS)
// and swap, the sum over every Electron process, the system's available
// memory, how long the page's main thread was frozen, and how the load
// ended (loaded, error shown, renderer crashed, timeout).
const { app, BrowserWindow, ipcMain, nativeTheme, session } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PROJECT = path.resolve(__dirname, "..", "..");
const MODE = process.env.TB_DIAG_MODE;
const FILE = process.env.TB_DIAG_FILE;
const OUT = process.env.TB_DIAG_OUT;
const LOAD_TIMEOUT_MS = 15 * 60_000;
const PROXY_TIMEOUT_MS = 30 * 60_000;

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const MB = 1024 * 1024;

/* ---------- Memory sampling (/proc) ---------- */

// kB fields of /proc/<pid>/status, in bytes; null if the process is gone.
function processMemory(pid) {
  try {
    const status = fs.readFileSync(`/proc/${pid}/status`, "utf8");
    const field = (name) => Number(new RegExp(`^${name}:\\s+(\\d+)`, "m").exec(status)?.[1] ?? 0) * 1024;
    return { rss: field("VmRSS"), swap: field("VmSwap") };
  } catch {
    return null;
  }
}

function systemMemory() {
  const info = fs.readFileSync("/proc/meminfo", "utf8");
  const field = (name) => Number(new RegExp(`^${name}:\\s+(\\d+)`, "m").exec(info)?.[1] ?? 0) * 1024;
  return { available: field("MemAvailable"), swapUsed: field("SwapTotal") - field("SwapFree") };
}

function createSampler(rendererPid) {
  const startedAt = performance.now();
  const baseline = systemMemory();
  const peak = { renderer: 0, rendererSwap: 0, total: 0, swapGrowth: 0, minAvailable: baseline.available };
  const timeline = []; // every 250 ms: { t, renderer, total } in MB
  let pids = [rendererPid];
  let lastTimelineAt = -Infinity;
  let latest = { renderer: 0, total: 0 };

  const refreshPids = setInterval(() => {
    pids = app.getAppMetrics().map((metric) => metric.pid);
  }, 500);

  const tick = setInterval(() => {
    const renderer = processMemory(rendererPid);
    let total = 0;
    for (const pid of new Set([...pids, rendererPid])) {
      const memory = processMemory(pid);
      if (memory) total += memory.rss + memory.swap;
    }
    const system = systemMemory();
    if (renderer) {
      peak.renderer = Math.max(peak.renderer, renderer.rss + renderer.swap);
      peak.rendererSwap = Math.max(peak.rendererSwap, renderer.swap);
    }
    peak.total = Math.max(peak.total, total);
    peak.swapGrowth = Math.max(peak.swapGrowth, system.swapUsed - baseline.swapUsed);
    peak.minAvailable = Math.min(peak.minAvailable, system.available);
    latest = { renderer: renderer ? renderer.rss + renderer.swap : 0, total };

    const t = performance.now() - startedAt;
    if (t - lastTimelineAt >= 250) {
      lastTimelineAt = t;
      timeline.push({ t: Math.round(t), renderer: Math.round(latest.renderer / MB), total: Math.round(total / MB) });
    }
  }, 50);

  return {
    now: () => performance.now() - startedAt,
    current: () => ({ rendererMB: Math.round(latest.renderer / MB), totalMB: Math.round(latest.total / MB) }),
    stop() {
      clearInterval(tick);
      clearInterval(refreshPids);
      return {
        baselineAvailableMB: Math.round(baseline.available / MB),
        peakRendererMB: Math.round(peak.renderer / MB),
        peakRendererSwapMB: Math.round(peak.rendererSwap / MB),
        peakTotalMB: Math.round(peak.total / MB),
        systemSwapGrowthMB: Math.round(Math.max(0, peak.swapGrowth) / MB),
        minAvailableMB: Math.round(peak.minAvailable / MB),
        timeline,
      };
    },
  };
}

/* ---------- Page-side code ---------- */

// Ticks every 16 ms on the page's main thread; a long gap means the page
// was frozen (no drawing, no input) for that long.
const HEARTBEAT = `
  window.__heartbeat = { last: performance.now(), maxGapMs: 0, frozenMs: 0, gaps: [] };
  setInterval(() => {
    const now = performance.now();
    const gap = now - __heartbeat.last;
    __heartbeat.last = now;
    if (gap > __heartbeat.maxGapMs) __heartbeat.maxGapMs = Math.round(gap);
    if (gap > 100) { __heartbeat.frozenMs += Math.round(gap); __heartbeat.gaps.push(Math.round(gap)); }
  }, 16);
`;

const BENCHMARKS = {
  decode: (contextRate) => `(async () => {
    const file = document.getElementById("__diagFile").files[0];
    const result = { steps: {} };
    let t = performance.now();
    const bytes = await file.arrayBuffer();
    result.steps.read = Math.round(performance.now() - t);
    const context = new AudioContext(${contextRate ? `{ sampleRate: ${contextRate} }` : ""});
    result.contextRate = context.sampleRate;
    t = performance.now();
    try {
      const buffer = await context.decodeAudioData(bytes);
      result.steps.decode = Math.round(performance.now() - t);
      Object.assign(result, { frames: buffer.length, channels: buffer.numberOfChannels, sampleRate: buffer.sampleRate, duration: buffer.duration });
      result.decodedMB = Math.round((buffer.length * buffer.numberOfChannels * 4) / 1048576);
      window.__keep = buffer; // held, as the app holds it until the transfer
    } catch (error) {
      result.steps.decode = Math.round(performance.now() - t);
      result.error = String(error);
    }
    return result;
  })()`,

  stream: (store) => `(async () => {
    const file = document.getElementById("__diagFile").files[0];
    const mb = await import("./node_modules/mediabunny/dist/bundles/mediabunny.mjs");
    const result = { steps: {} };
    let t = performance.now();
    const input = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BlobSource(file) });
    const track = await input.getPrimaryAudioTrack();
    result.steps.open = Math.round(performance.now() - t);
    if (!track) return { ...result, error: "no audio track" };
    t = performance.now();
    const duration = await track.computeDuration();
    result.steps.duration = Math.round(performance.now() - t);
    const channels = track.numberOfChannels;
    const sampleRate = track.sampleRate;
    Object.assign(result, { codec: track.codec, channels, sampleRate, duration });
    if (!(await track.canDecode())) return { ...result, error: "WebCodecs can't decode " + track.codec };

    const capacity = Math.ceil(duration * sampleRate) + sampleRate;
    const store = ${store} ? Array.from({ length: channels }, () => new Float32Array(capacity)) : null;
    let written = 0;
    t = performance.now();
    try {
      for await (const sample of new mb.AudioSampleSink(track).samples()) {
        result.steps.firstSample ??= Math.round(performance.now() - t);
        const frames = Math.min(sample.numberOfFrames, capacity - written);
        if (store && frames > 0) {
          for (let c = 0; c < channels; c++) {
            sample.copyTo(store[c].subarray(written, written + frames), { planeIndex: c, format: "f32-planar", frameCount: frames });
          }
        }
        written += sample.numberOfFrames;
        sample.close();
      }
    } catch (error) {
      result.error = String(error);
    }
    result.steps.decode = Math.round(performance.now() - t);
    result.frames = written;
    result.decodedMB = store ? Math.round((capacity * channels * 4) / 1048576) : 0;
    window.__keep = store;
    return result;
  })()`,
};

/* ---------- Run ---------- */

function save(result) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
}

app.whenReady().then(async () => {
  const result = {
    mode: MODE,
    file: path.basename(FILE),
    fileMB: Math.round(fs.statSync(FILE).size / MB),
    memoryLimit: process.env.TB_DIAG_LIMIT || null,
    machine: { totalMemoryMB: Math.round(os.totalmem() / MB), cpus: os.cpus().length, cpu: os.cpus()[0]?.model },
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  };

  // As main.js does, so the app's preload finds its handlers.
  nativeTheme.themeSource = "dark";
  const themeFile = path.join(app.getPath("userData"), "theme.json");
  const { createThemeStore, handleThemes } = require(path.join(PROJECT, "electron", "theme-store.js"));
  handleThemes(ipcMain, createThemeStore(themeFile, nativeTheme), () => {});
  session.defaultSession.registerPreloadScript({
    type: "frame",
    filePath: path.join(PROJECT, "electron", "preload.js"),
  });

  const win = new BrowserWindow({
    show: false,
    width: 1400,
    height: 900,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false },
  });
  const wc = win.webContents;
  const pageLog = [];
  let crashed = null;
  let unresponsive = 0;
  wc.on("console-message", (event) => pageLog.push({ level: event.level, text: String(event.message).slice(0, 500) }));
  wc.on("render-process-gone", (_event, details) => (crashed = details));
  wc.on("unresponsive", () => unresponsive++);

  await win.loadFile(path.join(PROJECT, "index.html"));
  const js = (code) => wc.executeJavaScript(code);
  const sampler = createSampler(wc.getOSProcessId());
  const idleMB = await (async () => {
    await sleep(1500);
    return sampler.current();
  })();
  result.idle = idleMB;
  await js(HEARTBEAT);

  // Puts FILE into a file input on the page.
  const debug = wc.debugger;
  debug.attach("1.3");
  async function setFile(selector) {
    const { root } = await debug.sendCommand("DOM.getDocument");
    const { nodeId } = await debug.sendCommand("DOM.querySelector", { nodeId: root.nodeId, selector });
    await debug.sendCommand("DOM.setFileInputFiles", { nodeId, files: [FILE] });
  }

  const loadStartedAt = sampler.now();
  try {
    if (MODE === "app") {
      await setFile("#file");
      // Done when the player is ready (Play enabled), an error was shown,
      // or the renderer died.
      let outcome = "timeout";
      while (sampler.now() - loadStartedAt < LOAD_TIMEOUT_MS) {
        await sleep(100);
        if (crashed) {
          outcome = "renderer crashed";
          break;
        }
        const state = await Promise.race([
          js(`({ ready: !document.getElementById("play").disabled,
                 loading: !document.getElementById("loadingScreen").hidden || !document.getElementById("loadingOverlay").hidden })`),
          sleep(2000).then(() => null),
        ]).catch(() => null);
        const shownError = pageLog.find((entry) => entry.level === "error");
        if (state?.ready && !state.loading) {
          outcome = "loaded";
          break;
        }
        if (shownError && state && !state.loading) {
          outcome = "error shown";
          break;
        }
      }
      result.outcome = outcome;
      result.loadMs = Math.round(sampler.now() - loadStartedAt);
      result.afterLoad = sampler.current();
      const timings = pageLog.map((entry) => /Load timings for .*?: (\{.*\})/.exec(entry.text)?.[1]).find(Boolean);
      if (timings) result.steps = JSON.parse(timings);
      result.messageShown = crashed
        ? null
        : await js(`document.getElementById("message").textContent`).catch(() => null);

      if (outcome === "loaded") {
        // Does it play? Press Play and check the time moves.
        const position = () => js(`document.getElementById("trackTime").textContent.split(" / ")[0]`);
        const before = await position();
        await js(`document.getElementById("play").click()`);
        await sleep(2000);
        result.plays = (await position()) !== before;
        await js(`document.getElementById("play").click()`);
        await sleep(1000);
        result.settled = sampler.current();

        // A video builds its proxy in the background after loading.
        if (/\.(mp4|webm|mkv|mov)$/i.test(FILE) && MODE === "app" && !/opus/.test(FILE)) {
          const proxyStartedAt = sampler.now();
          let line = null;
          while (!line && !crashed && sampler.now() - proxyStartedAt < PROXY_TIMEOUT_MS) {
            await sleep(500);
            line = pageLog.find((entry) => entry.text.startsWith("Video proxy:"))?.text ?? null;
          }
          result.proxy = {
            log: line,
            waitedMs: Math.round(sampler.now() - proxyStartedAt),
            outcome: line ? "built" : crashed ? "renderer crashed" : "timeout",
            after: sampler.current(),
          };
        }
      }
    } else {
      await js(
        `document.body.append(Object.assign(document.createElement("input"), { type: "file", id: "__diagFile", hidden: true }))`,
      );
      await setFile("#__diagFile");
      let code;
      if (MODE === "decode") code = BENCHMARKS.decode(null);
      else if (MODE === "decode-native") {
        const rate = /opus/.test(FILE) ? 48000 : 44100;
        code = BENCHMARKS.decode(rate);
      } else if (MODE === "stream") code = BENCHMARKS.stream(true);
      else if (MODE === "stream-discard") code = BENCHMARKS.stream(false);
      else throw new Error(`Unknown mode ${MODE}`);

      const benchmark = await Promise.race([
        js(code),
        new Promise((resolve) => {
          const poll = setInterval(() => {
            if (crashed) {
              clearInterval(poll);
              resolve({ error: "renderer crashed" });
            }
          }, 200);
        }),
        sleep(LOAD_TIMEOUT_MS).then(() => ({ error: "timeout" })),
      ]);
      Object.assign(result, benchmark);
      result.outcome = crashed ? "renderer crashed" : benchmark.error ? "error" : "done";
      result.loadMs = Math.round(sampler.now() - loadStartedAt);
      await sleep(1500);
      result.settled = sampler.current();
    }
  } catch (error) {
    result.outcome = result.outcome ?? "harness error";
    result.harnessError = String(error?.stack ?? error);
  }

  result.crash = crashed;
  result.unresponsiveEvents = unresponsive;
  result.heartbeat = crashed ? null : await js(`__heartbeat`).catch(() => null);
  result.memory = sampler.stop();
  result.pageErrors = pageLog
    .filter((entry) => entry.level === "error" || entry.level === "warning")
    .map((entry) => entry.text)
    .slice(0, 20);
  save(result);
  app.exit(0);
});
