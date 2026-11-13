// Measures audio dropouts: plays a project with stems in the real app,
// with every stem at full volume and with one muted, while other programs
// keep the computer busy, and counts how often the sound device ran out of
// sound. Linux only. Takes about 10 minutes. The findings so far are in
// docs/diagnostics/audio-dropouts.md.
//
//   node tests/diagnostics/dropouts.cjs <project.ebee>          # everything
//   node tests/diagnostics/dropouts.cjs <project.ebee> mem      # only the loads containing "mem"
//   TB_APP_BINARY=<AppImage> node tests/diagnostics/dropouts.cjs <project.ebee>
//
// The project must hold stems (save one after separating a song), and a
// song of at least 80 seconds. It's opened from a copy, so nothing is
// changed.
//
// IT PLAYS THROUGH THE REAL SOUND DEVICE, at 3 % volume: a silent or
// offscreen run would hide the dropouts. Don't use the computer meanwhile:
// what it does shows in the numbers.
//
// What's measured, over SECONDS of looped playback per row:
//   dropouts      AudioContext.playbackStats.underrunEvents: how many times
//                 the device had nothing to play, and for how long in all
//   audio thread  the share of one core the page's audio thread used (its
//                 "Realtime AudioWorklet" thread, from /proc)
//   worst gap     the longest wait between two blocks on the audio thread
//                 (from a small worklet added by this script)
// The loads are other processes, started for a row and stopped after it:
//   cpu    busy loops (they compete for the cores)
//   mem    copying 256 MB arrays (they compete for the memory's speed, as
//          the stem model does)
//   alloc  making and dropping small arrays (the garbage collector's work)
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PROJECT = path.resolve(__dirname, "..", "..");
const SECONDS = Number(process.env.TB_SECONDS || 40);
const LOOP = { start: 30, end: 75 }; // seconds of the song, played round and round
const VOLUME = 0.03;
const PORT = 9300 + Math.floor(Math.random() * 500);

// [kind, how many processes]
const LOADS = [
  [null, 0],
  ["cpu", 8],
  ["cpu", 16],
  ["mem", 4],
  ["mem", 8],
  ["alloc", 8],
];
const LOAD_CODE = {
  cpu: "for(;;){}",
  mem: "const a=new Float64Array(32e6),b=new Float64Array(32e6);for(;;){b.set(a);a.set(b);}",
  alloc: "for(;;){const a=[];for(let i=0;i<2e5;i++)a.push(new Float64Array(64));}",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const read = (file) => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
};

/* ---------- The app, over the DevTools Protocol (as tests/smoke.cjs) ---------- */

async function startApp(profile) {
  const flags = [`--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`];
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const [command, args] = process.env.TB_APP_BINARY
    ? [process.env.TB_APP_BINARY, flags]
    : [require("electron"), [PROJECT, ...flags]];
  const child = spawn(command, args, { env, stdio: "ignore" });

  let target = null;
  for (let attempt = 0; attempt < 200 && !target; attempt++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = targets.find((entry) => entry.type === "page" && entry.url.endsWith("index.html"));
    } catch {
      // not listening yet
    }
    if (!target) await sleep(100);
  }
  if (!target) throw new Error("The app didn't start (no DevTools page found).");

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve);
    socket.addEventListener("error", reject);
  });
  const pending = new Map();
  let nextId = 1;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  });
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });
  // Evaluates `expression` in the page and returns its value.
  const js = async (expression) => {
    const reply = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    const thrown = reply.result?.exceptionDetails;
    if (thrown) throw new Error(`In the page: ${thrown.exception?.description ?? thrown.text}`);
    return reply.result?.result?.value;
  };
  const waitFor = async (expression, ms) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(200)) if (await js(expression)) return true;
    return false;
  };
  const openFile = async (file) => {
    const { result: document } = await send("DOM.getDocument");
    const { result: input } = await send("DOM.querySelector", { nodeId: document.root.nodeId, selector: "#file" });
    await send("DOM.setFileInputFiles", { nodeId: input.nodeId, files: [file] });
  };
  // The app's processes: all started with this profile.
  const pids = () =>
    fs
      .readdirSync("/proc")
      .filter((name) => /^\d+$/.test(name) && read(`/proc/${name}/cmdline`).includes(profile))
      .map(Number);
  const quit = async () => {
    js("window.close()").catch(() => {});
    await sleep(1500);
    for (const pid of pids()) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // gone already
      }
    }
    if (child.exitCode === null) child.kill("SIGKILL");
  };
  return { js, waitFor, openFile, pids, quit };
}

// Runs in the page, before a file is opened: keeps each AudioContext the
// app makes, and adds a worklet to it that notes the longest wait between
// two blocks on the audio thread (every second or so).
const PROBE = `(() => {
  const code = \`class Probe extends AudioWorkletProcessor {
    constructor() { super(); this.last = 0; this.worst = 0; this.blocks = 0; }
    process() {
      const now = Date.now();
      if (this.last) this.worst = Math.max(this.worst, now - this.last);
      this.last = now;
      if (++this.blocks >= 345) { this.port.postMessage(this.worst); this.blocks = 0; this.worst = 0; }
      return true;
    }
  }
  registerProcessor("dropouts-probe", Probe);\`;
  const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  window.__contexts = [];
  window.__gaps = [];
  const Native = window.AudioContext;
  window.AudioContext = class extends Native {
    constructor(...args) {
      super(...args);
      __contexts.push(this);
      this.audioWorklet.addModule(url).then(() => {
        const probe = new AudioWorkletNode(this, "dropouts-probe", { numberOfInputs: 0, numberOfOutputs: 1 });
        probe.port.onmessage = (event) => __gaps.push(event.data);
        probe.connect(new GainNode(this, { gain: 0 })).connect(this.destination);
      });
    }
  };
})()`;

// What the page's modules give: the same instances the app uses.
const APP = `const { player } = await import("./src/context.js"); const playback = await import("./src/features/playback.js");`;

/* ---------- The measurement ---------- */

// The processor time the audio thread has used, in clock ticks (100 a second).
function audioThreadTicks(pids) {
  let ticks = 0;
  for (const pid of pids) {
    let threads = [];
    try {
      threads = fs.readdirSync(`/proc/${pid}/task`);
    } catch {
      // the process ended
    }
    for (const thread of threads) {
      const stat = /\((.*)\) (.*)/s.exec(read(`/proc/${pid}/task/${thread}/stat`));
      if (!stat?.[1].startsWith("Realtime AudioW")) continue;
      const fields = stat[2].split(" ");
      ticks += Number(fields[11]) + Number(fields[12]); // user + system
    }
  }
  return ticks;
}

async function main() {
  const [file, only = ""] = process.argv.slice(2);
  if (!file || !file.endsWith(".ebee") || !fs.existsSync(file)) {
    console.error("Give a project with stems: node tests/diagnostics/dropouts.cjs <project.ebee> [load]");
    process.exit(1);
  }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "earbee-dropouts-"));
  // A copy: the app notes what it opens, and could save over it.
  const copy = path.join(profile, "project.ebee");
  fs.copyFileSync(file, copy);

  let loads = [];
  const stopLoads = () => {
    for (const load of loads) load.kill("SIGKILL");
    loads = [];
  };
  const app = await startApp(profile);
  try {
    // Once the page is built: before that, nothing listens for a file.
    await app.js(
      `new Promise((resolve) => document.readyState === "complete" ? resolve() : addEventListener("load", resolve))`,
    );
    await app.js(PROBE);
    await app.openFile(copy);
    if (!(await app.waitFor(`!document.getElementById("app").hidden`, 60_000)))
      throw new Error("The project didn't open.");
    const stems = `document.querySelectorAll("#stemsSection .stems-row")`;
    // The mixer shows, nothing is loading, and the copies for saving are made
    // (by what's hidden, not the text: that holds every state's words).
    const part = (selector) => `document.querySelector("#stemsSection ${selector}")`;
    const ready = await app.waitFor(
      `${part(".stems-mixer")} && !${part(".stems-mixer")}.hidden && ${part(".stems-busy")}.hidden && ${part(".stems-preparing")}.hidden`,
      180_000,
    );
    if (!ready) {
      const held = await app.js(`Boolean(${part(".stems-held")}) && !${part(".stems-held")}.hidden`);
      throw new Error(
        held
          ? "The project's stems weren't loaded: not enough memory."
          : "The project's stems didn't load (does it hold any?).",
      );
    }
    await sleep(2000);

    // Every stem back to full volume, whatever the project saved; then the loop, playing.
    const muted = () =>
      app.js(`[...${stems}].some((row) => row.querySelectorAll("button.toggle")[1].ariaPressed === "true")`);
    const setMuted = async (on) => {
      if ((await muted()) === on) return;
      await app.js(`${stems}[0].querySelectorAll("button.toggle")[1].click()`);
      await sleep(300);
    };
    await app.js(`(async () => { ${APP}
      for (const pressed of document.querySelectorAll("#stemsSection .stems-row button.toggle[aria-pressed=true]")) pressed.click();
      player.engine.setVolume(${VOLUME});
      playback.setLoopRegion({ start: ${LOOP.start}, end: ${LOOP.end}, enabled: true });
      player.transport.seek(${LOOP.start});
      player.transport.play();
    })()`);
    const latency = await app.js(
      `(() => { const context = __contexts.at(-1); return { rate: context.sampleRate, base: context.baseLatency, output: context.outputLatency }; })()`,
    );
    console.log(
      `Context at ${latency.rate} Hz, buffer ${(latency.base * 1000).toFixed(1)} ms, output delay ${(latency.output * 1000).toFixed(0)} ms; ${SECONDS} s a row.\n`,
    );
    console.log("mix           load        dropouts          audio thread    worst gap");

    const stats = () =>
      app.js(`(() => { const stats = __contexts.at(-1).playbackStats; const gaps = __gaps.splice(0);
        return { events: stats.underrunEvents, seconds: stats.underrunDuration, gap: Math.max(0, ...gaps) }; })()`);
    for (const [kind, count] of LOADS.filter(([kind]) => String(kind).includes(only))) {
      for (const mute of [false, true]) {
        await setMuted(mute);
        loads = kind
          ? Array.from({ length: count }, () => spawn("node", ["-e", LOAD_CODE[kind]], { stdio: "ignore" }))
          : [];
        await sleep(3000); // the loads get going
        const before = await stats();
        const ticks = audioThreadTicks(app.pids());
        await sleep(SECONDS * 1000);
        const after = await stats();
        const share = (audioThreadTicks(app.pids()) - ticks) / SECONDS;
        stopLoads();
        const dropouts = `${after.events - before.events} (${Math.round((after.seconds - before.seconds) * 1000)} ms)`;
        console.log(
          [
            (mute ? "a stem muted" : "full mix").padEnd(13),
            (kind ? `${count}× ${kind}` : "idle").padEnd(11),
            dropouts.padEnd(17),
            `${share.toFixed(1)} % of a core`.padEnd(15),
            `${after.gap} ms`,
          ].join(" "),
        );
        await sleep(1500);
      }
    }
  } finally {
    stopLoads();
    await app.quit();
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
