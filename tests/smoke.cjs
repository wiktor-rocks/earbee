// Smoke test of the real app, main.js included (run.cjs builds its own
// window and so never runs main.js). Started by launch.cjs after run.cjs.
//
// The app is started as a user would start it, with a throwaway profile and
// a DevTools port, and driven over the Chrome DevTools Protocol:
//   - the splash: it closes, and the window shows, once the page says it
//     is ready (well before the fallback timeout);
//   - the window title, Content-Security-Policy and blocked navigation /
//     pop-ups, and the download bridge (preload.js);
//   - the window state: saved on close, restored on the next start, reset
//     when the saved position is off-screen, and kept above the minimum size;
//   - the settings: a theme.json from before them is imported; a theme
//     saved through the bridge is applied again on the next start.
//
// TB_APP_BINARY=<path> tests a packaged build's executable instead of
// running the project with Electron.
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PROJECT = path.resolve(__dirname, "..");
const PORT = 9300 + Math.floor(Math.random() * 500);

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${detail}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Waits up to `ms` for `test()` to resolve to true; resolves to whether it did.
async function waitFor(test, ms) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (await test()) return true;
  return false;
}

/* ---------- Starting the app and talking to it ---------- */

function startApp(profile) {
  const flags = [`--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`];
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const [command, args] = process.env.TB_APP_BINARY
    ? [process.env.TB_APP_BINARY, flags]
    : [require("electron"), [PROJECT, ...flags]];
  const child = spawn(command, args, { env, stdio: "ignore" });
  const exited = new Promise((resolve) => child.on("exit", resolve));
  return { child, exited };
}

// Connects to the app's page over the DevTools Protocol.
async function connect() {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = targets.find((target) => target.type === "page" && target.url.endsWith("index.html"));
      if (page) return openSession(page.webSocketDebuggerUrl);
    } catch {
      // not listening yet
    }
    await sleep(100);
  }
  throw new Error("The app didn't start (no DevTools page found).");
}

function openSession(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 1;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  });
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve);
    socket.addEventListener("error", reject);
  });

  return ready.then(() => ({
    // Evaluates `expression` in the page and returns its value.
    async evaluate(expression) {
      const id = nextId++;
      const reply = new Promise((resolve) => pending.set(id, resolve));
      socket.send(
        JSON.stringify({
          id,
          method: "Runtime.evaluate",
          params: { expression, returnByValue: true, awaitPromise: true },
        }),
      );
      const { result } = await reply;
      return result?.result?.value;
    },
    close: () => socket.close(),
  }));
}

// Starts the app, waits for the page, runs `steps(page)`, then closes the
// window from the page (as a user closing it would) and waits for the exit.
async function session(profile, steps) {
  const app = startApp(profile);
  try {
    const page = await connect();
    await page.evaluate(
      `new Promise((resolve) => document.readyState === "complete" ? resolve() : addEventListener("load", resolve))`,
    );
    // The window stays hidden behind the splash until the page is ready,
    // and the splash closes as it shows. (A hidden window's page still
    // says it's visible, so the splash is what can be watched.) 10 s is
    // under the fallback (READY_TIMEOUT_MS), so this is the page's signal.
    const splashOpen = async () => {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      return targets.some((target) => target.url.includes("/splash.html"));
    };
    const handedOver = await waitFor(async () => !(await splashOpen()), 10000);
    check("splash closes once the page is ready", handedOver);
    await steps(page);
    page.evaluate("window.close()").catch(() => {});
    page.close();
    const code = await Promise.race([app.exited, sleep(5000).then(() => "timeout")]);
    check("app quits when the window is closed", code !== "timeout", `exit: ${code}`);
  } finally {
    if (app.child.exitCode === null) app.child.kill();
  }
}

const windowSize = (page) => page.evaluate(`({ width: outerWidth, height: outerHeight })`);
const near = (a, b) => Math.abs(a - b) <= 40; // window decorations differ between desktops

/* ---------- The checks ---------- */

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "scribee-smoke-"));
  const stateFile = path.join(profile, "window-state.json");

  try {
    // First start: defaults, security, then closing saves the state.
    let sizesObservable = true;
    await session(profile, async (page) => {
      check("window title", (await page.evaluate("document.title")) === "ScriBee");
      check("welcome screen shown", await page.evaluate(`!document.getElementById("welcome").hidden`));
      check(
        "download bridge from preload.js, From YouTube shown",
        await page.evaluate(
          `typeof window.scribee?.download === "function" && !document.getElementById("welcomeDownload").hidden`,
        ),
      );

      // Tiling window managers (i3, sway, …) size every window themselves,
      // so the size the app asks for can't be seen; size checks are skipped.
      const size = await windowSize(page);
      sizesObservable = near(size.width, 1200) && near(size.height, 800);
      if (sizesObservable) check("first start uses the default size", true, JSON.stringify(size));
      else console.log(`SKIP window sizes: the window manager sized the window itself (${size.width}×${size.height})`);

      // DevTools' own evaluation is exempt from the policy, so probe it with
      // an inline <script>, which the policy must block.
      const inlineRan = await page.evaluate(
        `(() => { const s = document.createElement("script"); s.textContent = "window.__inlineRan = true"; document.head.append(s); return window.__inlineRan === true; })()`,
      );
      check("Content-Security-Policy blocks inline scripts", inlineRan === false);
      check(
        "pop-up windows are blocked",
        (await page.evaluate(`window.open("https://example.com") === null`)) === true,
      );
      // Video window (src/features/video-window/): the one window the page
      // may open; it must close with the app (the quit check below).
      check(
        "the video window may open",
        (await page.evaluate(
          `(() => { const win = window.open("", "scribee-video"); return win !== null && !win.closed; })()`,
        )) === true,
      );

      const before = await page.evaluate("location.href");
      await page.evaluate(`location.href = "https://example.com"; 0`);
      await sleep(500);
      check("navigation away is blocked", (await page.evaluate("location.href")) === before);
    });

    const saved = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : null;
    check(
      "window state saved on close",
      saved !== null &&
        [saved.x, saved.y, saved.width, saved.height].every(Number.isFinite) &&
        typeof saved.maximized === "boolean",
      JSON.stringify(saved),
    );

    // Later starts with a prepared state file. Where sizes can be seen,
    // check them; everywhere, the app must start and quit normally.
    const startWith = async (name, state, expect) => {
      fs.writeFileSync(stateFile, typeof state === "string" ? state : JSON.stringify(state));
      await session(profile, async (page) => {
        const size = await windowSize(page);
        if (sizesObservable) check(name, expect(size), JSON.stringify(size));
        else check(`${name}: app starts`, (await page.evaluate("document.title")) === "ScriBee");
      });
    };
    const base = saved ?? { x: 0, y: 0, width: 1200, height: 800, maximized: false };
    await startWith(
      "saved size restored",
      { ...base, width: 1000, height: 700 },
      (size) => near(size.width, 1000) && near(size.height, 700),
    );
    await startWith(
      "off-screen state ignored",
      { x: -20000, y: -20000, width: 1000, height: 700, maximized: false },
      (size) => near(size.width, 1200) && near(size.height, 800),
    );
    await startWith(
      "minimum size enforced",
      { ...base, width: 400, height: 300 },
      (size) => size.width >= 880 && size.height >= 620,
    );
    await startWith(
      "corrupt state file ignored",
      "{ not json",
      (size) => near(size.width, 1200) && near(size.height, 800),
    );

    // The colour theme: saved through the bridge, applied on the next start
    // (by the preload, before the page's own code runs). First, a profile
    // from before Settings: its theme.json is imported into prefs.json.
    fs.rmSync(path.join(profile, "prefs.json"), { force: true });
    fs.writeFileSync(path.join(profile, "theme.json"), JSON.stringify({ choice: "dracula" }));
    await session(profile, async (page) => {
      const imported = await page.evaluate(`document.documentElement.dataset.theme`);
      check("theme.json from before Settings is imported", imported === "dracula", imported);
      await page.evaluate(`scribee.prefs.set("theme", "choice", "nord")`);
    });
    await session(profile, async (page) => {
      const applied = await page.evaluate(
        `({ theme: document.documentElement.dataset.theme, bg: getComputedStyle(document.body).backgroundColor })`,
      );
      check(
        "saved theme applied on the next start",
        applied?.theme === "nord" && applied?.bg === "rgb(46, 52, 64)",
        JSON.stringify(applied),
      );
    });
  } catch (error) {
    check("smoke test ran", false, error.stack);
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }

  console.log(`\n${pass} pass, ${fail} fail (smoke)`);
  process.exit(fail ? 1 : 0);
})();
