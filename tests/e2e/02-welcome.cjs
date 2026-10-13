// The welcome screen, the loading screen and the first load.
// Part of the end-to-end run (see run.cjs); `h` is the harness.
const fs = require("fs");
const path = require("path");

module.exports = async function (h) {
  const { js, dbg, setFiles, shot, check, sleep, FIXTURES } = h;

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
    await js(`!document.getElementById("welcomeDownload").hidden && typeof window.scribee?.download === "function"`),
  );
  // The two buttons side by side, From YouTube… on the right.
  const buttons = await js(
    `(() => { const a = document.getElementById("welcomeOpen").getBoundingClientRect(); const b = document.getElementById("welcomeDownload").getBoundingClientRect(); return { sameRow: Math.abs(a.top - b.top) < 2, rightOf: b.left > a.right }; })()`,
  );
  check("From YouTube… sits to the right of Open", buttons.sameRow && buttons.rightOf, JSON.stringify(buttons));

  // The welcome screen's gentle motion: the animations run, and move.
  const running = () =>
    js(`document.getAnimations().filter((a) => a.playState === "running").map((a) => a.animationName)`);
  // How far the two animations are, by their own clocks. (Not their
  // computed transform: on a virtual display without a compositor, such as
  // CI's, that stays at the first keyframe while the animations run.)
  const welcomeMotion = () =>
    js(
      `document.getAnimations().filter((a) => ["bee-float", "aura-breathe"].includes(a.animationName)).map((a) => Math.round(a.currentTime)).join(" | ")`,
    );
  const names = await running();
  check(
    "the bee floats and its aura breathes",
    names.includes("bee-float") && names.includes("aura-breathe"),
    JSON.stringify(names),
  );
  const motionBefore = await welcomeMotion();
  await sleep(700);
  const motionAfter = await welcomeMotion();
  check("…and they move", motionBefore !== motionAfter, `${motionBefore} → ${motionAfter}`);
  await sleep(500);
  check(
    "the entrance played once, and is done",
    (await js(`document.getElementById("welcome").classList.contains("settled")`)) &&
      !(await running()).includes("rise-in"),
  );
  await dbg.sendCommand("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  await sleep(100);
  const reduced = await running();
  check(
    "with reduced motion, the bee and aura stay still",
    !reduced.includes("bee-float") && !reduced.includes("aura-breathe"),
    JSON.stringify(reduced),
  );
  await dbg.sendCommand("Emulation.setEmulatedMedia", { features: [] });
  await sleep(100);
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
  await js(`window.__slowDecode = 800`);
  await setFiles(path.join(FIXTURES, "bad.mp3"));
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
  await js(
    `(() => { const dt = new DataTransfer(); dt.items.add(new File([""], "song.wav", { type: "audio/wav" })); window.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, cancelable: true })); })()`,
  );
  const dragPrompt = await js(
    `document.body.classList.contains("dragging") && getComputedStyle(document.querySelector(".welcome-drop-prompt")).display !== "none" && document.getElementById("welcomeDropText").textContent`,
  );
  check("dragging a song over the window says what a drop opens", dragPrompt === "Drop to open this song", dragPrompt);
  await sleep(300);
  const dragLook = await js(
    `(() => { const card = getComputedStyle(document.querySelector(".welcome-drop")); const ring = document.querySelector(".welcome-drop .drop-ring"); const rect = ring.querySelector("rect"); const offset = () => parseFloat(getComputedStyle(rect).strokeDashoffset); return { still: card.transform === "none", ring: getComputedStyle(ring).opacity, marching: document.getAnimations().some((a) => a.animationName === "drop-march" && a.playState === "running"), offset: offset() }; })()`,
  );
  await sleep(200);
  const offsetLater = await js(
    `parseFloat(getComputedStyle(document.querySelector(".welcome-drop .drop-ring rect")).strokeDashoffset)`,
  );
  check(
    "…the card stays put and its border marches",
    dragLook.still && dragLook.ring === "1" && dragLook.marching && offsetLater !== dragLook.offset,
    JSON.stringify({ ...dragLook, offsetLater }),
  );
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
    (await js(`document.title`)) === "ScriBee — tone.wav",
    await js(`document.title`),
  );
  const widths = await js(
    `(() => { const w = document.querySelector("#waveform > div").shadowRoot.querySelector(".wrapper").getBoundingClientRect().width; return { wrapper: w, container: document.getElementById("waveform").clientWidth }; })()`,
  );
  // tone.wav is 20 s; a file opens zoomed in to 15 s.
  check(
    "waveform drawn zoomed in (15 of 20 s in view)",
    Math.abs(widths.wrapper - (widths.container * 20) / 15) < 4,
    JSON.stringify(widths),
  );
  check("welcome error cleared from player", (await js(`document.getElementById("message").textContent`)) === "");

  await js(`window.__slowDecode = 800`);
  await setFiles(path.join(FIXTURES, "tone.wav"));
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
