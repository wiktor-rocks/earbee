// The welcome screen, the loading screen and the first load.
// Part of the end-to-end run (see run.cjs); `h` is the harness.
const fs = require("fs");
const path = require("path");

module.exports = async function (h) {
  const { js, dbg, shot, check, sleep, FIXTURES } = h;

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
  check(
    "From YouTube buttons shown (download bridge present)",
    await js(
      `!document.getElementById("welcomeDownload").hidden && typeof window.transcribee?.download === "function"`,
    ),
  );
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
    `(() => { const bytes = Uint8Array.from(atob(${JSON.stringify(fs.readFileSync(path.join(FIXTURES, "tone.wav")).toString("base64"))}), (c) => c.charCodeAt(0)); const dt = new DataTransfer(); dt.items.add(new File([bytes], "tone.wav", { type: "audio/wav" })); window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, cancelable: true })); })()`,
  );
  for (let i = 0; i < 100; i++) {
    await sleep(50);
    if (await js(`!document.getElementById("app").hidden && document.getElementById("loadingOverlay").hidden`)) break;
  }
  await sleep(300);
  sc = await screens();
  check("dropped file opens the player", !sc.welcome && sc.app, JSON.stringify(sc));
  check(
    "window title names the file",
    (await js(`document.title`)) === "TranscriBee — tone.wav",
    await js(`document.title`),
  );
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
};
