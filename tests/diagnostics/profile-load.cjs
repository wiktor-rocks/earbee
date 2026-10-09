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
//     workers        the app's decoder (src/audio/decoder.js) in
//                    TB_DIAG_WORKERS parts at once: decode time alone
//     seams          the app's decoder in one part, then in TB_DIAG_WORKERS
//                    parts, compared sample by sample: is the parallel
//                    result the same track, and is there a step at a join?
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
const WORKERS = Number(process.env.TB_DIAG_WORKERS) || 4;
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

  // The app's decoder, in `workers` parts; with `compare`, first in one
  // part, and the two compared.
  parts: (workers, compare) => `(async () => {
    const file = document.getElementById("__diagFile").files[0];
    const { decodeFile } = await import("./src/audio/decoder.js");
    const { splitFrames } = await import("./src/core/parts.js");
    const peakFactor = 400;
    let info = null;
    const decode = async (count) => {
      const t = performance.now();
      const decoded = await decodeFile(file, { workers: count, prepare: (i) => ((info = i), { peakFactor }) });
      return { decoded, ms: Math.round(performance.now() - t) };
    };
    const result = { steps: {}, workers: ${workers} };
    let one = null;
    if (${compare}) {
      one = await decode(1);
      result.steps.oneWorker = one.ms;
    }
    const many = await decode(${workers});
    result.steps.decode = many.ms;
    const { pieces, sampleRate } = many.decoded;
    Object.assign(result, { sampleRate, channels: pieces[0].length, pieces: pieces.length, frames: pieces.reduce((sum, piece) => sum + piece[0].length, 0) });
    result.duration = result.frames / sampleRate;
    if (!one) {
      window.__keep = many;
      return result;
    }

    // Where each piece starts in the one-part track, and how far that is
    // from where the timestamps put it (the join's lag).
    const reference = one.decoded.pieces[0];
    result.framesOnePart = reference[0].length;
    const planned = splitFrames(Math.ceil(info.duration * sampleRate), ${workers}, peakFactor);
    const starts = [];
    let at = 0;
    for (const piece of pieces) { starts.push(at); at += piece[0].length; }
    result.joins = starts.slice(1).map((start, k) => ({ at: +(start / sampleRate).toFixed(3), lag: start - planned[k + 1].from }));

    // Sample by sample, over every channel.
    let max = 0, maxAt = 0, error = 0, power = 0;
    const span = Math.round(sampleRate / 10);
    const near = result.joins.map(() => 0); // the largest difference in the 0.1 s after each join
    const steps = result.joins.map(() => 0); // the step at the join the track itself doesn't take
    for (let c = 0; c < reference.length; c++) {
      const a = reference[c];
      pieces.forEach((piece, k) => {
        const b = piece[c];
        const start = starts[k];
        for (let i = 0; i < b.length && start + i < a.length; i++) {
          const d = a[start + i] - b[i];
          const size = Math.abs(d);
          if (size > max) { max = size; maxAt = start + i; }
          error += d * d;
          power += a[start + i] * a[start + i];
          if (k > 0 && i < span) near[k - 1] = Math.max(near[k - 1], size);
        }
        if (k > 0) {
          const before = pieces[k - 1][c];
          steps[k - 1] = Math.max(steps[k - 1], Math.abs(b[0] - before[before.length - 1] - (a[start] - a[start - 1])));
        }
      });
    }
    result.joins.forEach((join, k) => Object.assign(join, { maxDiffNext100ms: near[k], extraStep: steps[k] }));
    Object.assign(result, {
      identical: max === 0,
      maxDiff: max,
      maxDiffAt: +(maxAt / sampleRate).toFixed(3),
      snrDb: error ? +(10 * Math.log10(power / error)).toFixed(1) : null,
    });
    one = null;
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
  const prefsStore = require(path.join(PROJECT, "electron", "prefs-store.js")).createPrefsStore(
    path.join(app.getPath("userData"), "prefs.json"),
  );
  const { createThemeView } = require(path.join(PROJECT, "electron", "theme-store.js"));
  require(path.join(PROJECT, "electron", "prefs-store.js")).handlePrefs(ipcMain, prefsStore, {
    initialTheme: createThemeView(prefsStore, nativeTheme).initial,
    defaultPaths: {},
    chooseFolder: async () => null,
    pages: () => [],
  });
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
      else if (MODE === "workers") code = BENCHMARKS.parts(WORKERS, false);
      else if (MODE === "seams") code = BENCHMARKS.parts(WORKERS, true);
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
