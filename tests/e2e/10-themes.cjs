// Colour themes: the menu, switching (CSS variables and the waveform's
// canvases), keyboard use, Automatic, saving the choice.
// Part of the end-to-end run (see run.cjs); `h` is the harness.
const fs = require("fs");
const path = require("path");

module.exports = async function (h) {
  const { wc, js, dbg, key, shot, playing, ensurePaused, check, sleep, prefsFile, PROJECT } = h;
  const variable = (name) => js(`getComputedStyle(document.documentElement).getPropertyValue("${name}").trim()`);
  const themeId = () => js(`document.documentElement.dataset.theme`);
  const menuOpen = () => js(`document.getElementById("themeMenu").matches(":popover-open")`);
  const pick = (id) => js(`document.querySelector('#themeMenu [data-choice="${id}"]').click()`);
  // Whether any pixel of the canvases under `selector` is (nearly) `hex`.
  const canvasHas = (selector, hex) =>
    js(`(() => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(${JSON.stringify(hex)}.slice(i, i + 2), 16));
      const host = document.querySelector(${JSON.stringify(selector)});
      const canvases = [...host.querySelectorAll("*")].flatMap((el) => [el, ...(el.shadowRoot ? el.shadowRoot.querySelectorAll("*") : [])]).filter((el) => el.tagName === "CANVAS" && el.width && el.height);
      return canvases.some((canvas) => {
        const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] > 200 && Math.abs(data[i] - r) < 6 && Math.abs(data[i + 1] - g) < 6 && Math.abs(data[i + 2] - b) < 6) return true;
        }
        return false;
      });
    })()`);

  await ensurePaused();
  check("starts with the default theme", (await themeId()) === "transcribee" && (await variable("--bg")) === "#0e1014");

  // The menu: opens on the current theme, keeps shortcuts away, arrows move.
  await js(`document.getElementById("themeButton").click()`);
  await sleep(150);
  check(
    "palette button opens the theme menu on the current theme",
    (await menuOpen()) && (await js(`document.activeElement.dataset.choice`)) === "transcribee",
  );
  check(
    "menu lists Automatic and every palette file",
    (await js(`document.querySelectorAll("#themeMenu .theme-item").length`)) ===
      1 + fs.readdirSync(path.join(PROJECT, "src", "themes", "palettes")).length,
  );
  key("Space");
  await sleep(300);
  check("shortcuts don't fire while the menu is open", !(await playing()));
  await ensurePaused();
  key("Down");
  await sleep(100);
  check("↓ moves to the next theme", (await js(`document.activeElement.dataset.choice`)) === "monokai");

  // Switching: variables, page, both waveform canvases, saved.
  const nordBg = "#2e3440";
  await pick("nord");
  await sleep(600);
  check("choosing Nord sets its colours", (await themeId()) === "nord" && (await variable("--bg")) === nordBg);
  check(
    "the page follows (body background)",
    (await js(`getComputedStyle(document.body).backgroundColor`)) === "rgb(46, 52, 64)",
  );
  check("waveform redrawn in the theme's colours", await canvasHas("#waveform", await variable("--wave")));
  check(
    "minimap redrawn in the theme's colours",
    await canvasHas("#waveform-minimap", await variable("--minimap-wave")),
  );
  check(
    "minimap still has its visible-range overlay",
    await js(`!!document.querySelector('#waveform-minimap [part~="minimap-overlay"]')`),
  );
  check("menu stays open to compare themes", await menuOpen());
  // Picking never resizes or moves it (long names, Automatic's "follows
  // the system: …", the ✓), and it stays on its button, inside the window.
  const menuBox = () =>
    js(`(() => {
      const m = document.getElementById("themeMenu").getBoundingClientRect();
      const b = document.getElementById("themeButton").getBoundingClientRect();
      return { box: [m.left, m.top, m.width, m.height].map(Math.round).join(), onButton: Math.abs(m.top - b.bottom) < 12 || Math.abs(m.bottom - b.top) < 12, inside: m.bottom <= innerHeight && m.right <= innerWidth };
    })()`);
  const before = await menuBox();
  const after = [];
  for (const id of ["auto", "catppuccin-mocha", "tokyo-night-day", "nord"]) {
    await pick(id);
    await sleep(150);
    after.push((await menuBox()).box);
  }
  check(
    "picking themes keeps the menu's size and place, on its button",
    before.onButton && before.inside && after.every((box) => box === before.box),
    `${before.box} → ${after.join(" | ")}`,
  );
  check(
    "the choice is checked and saved",
    (await js(`document.querySelector('#themeMenu [aria-checked="true"]').dataset.choice`)) === "nord" &&
      JSON.parse(fs.readFileSync(prefsFile, "utf8")).theme.choice === "nord",
  );
  await shot("theme-menu.png");

  // A real click (press and release) on the button again closes the menu:
  // the press mustn't light-dismiss it and the click open it again.
  const button = await js(
    `(() => { const r = document.getElementById("themeButton").getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`,
  );
  const realClick = async () => {
    wc.sendInputEvent({ type: "mouseDown", ...button, button: "left", clickCount: 1 });
    wc.sendInputEvent({ type: "mouseUp", ...button, button: "left", clickCount: 1 });
    await sleep(150);
  };
  await realClick();
  check("clicking the palette button again closes the menu", !(await menuOpen()));
  await realClick();
  check("and clicking it once more opens it", await menuOpen());

  key("Escape");
  await sleep(150);
  // Opened with the mouse: nothing is left focused (no ring on the button).
  check(
    "Escape closes the menu; opened by mouse, no focus is left on its button",
    !(await menuOpen()) && (await js(`document.activeElement === document.body`)),
  );
  // Reached with Tab and opened with Enter: focus goes back to the button.
  await js(`document.getElementById("settingsButton").focus()`);
  key("Tab");
  await sleep(50);
  const tabbedTo = await js(`document.activeElement.id`);
  // Enter activates a button through its "char" event, which key() doesn't send.
  for (const type of ["keyDown", "char", "keyUp"])
    wc.sendInputEvent({ type, keyCode: type === "char" ? "\r" : "Enter" });
  await sleep(150);
  const openedByKey = await menuOpen();
  key("Escape");
  await sleep(150);
  check(
    "with the keyboard (Tab, Enter, Esc), focus goes back to its button",
    tabbedTo === "themeButton" && openedByKey && (await js(`document.activeElement.id`)) === "themeButton",
    `${tabbedTo} ${openedByKey} ${await js(`document.activeElement.id`)}`,
  );
  // A mouse press ends keyboard navigation (back to the mouse rules).
  const corner = await js(
    `(() => { const r = document.querySelector(".file-info").getBoundingClientRect(); return { x: Math.round(r.right - 4), y: Math.round(r.top + r.height / 2) }; })()`,
  );
  wc.sendInputEvent({ type: "mouseDown", ...corner, button: "left", clickCount: 1 });
  wc.sendInputEvent({ type: "mouseUp", ...corner, button: "left", clickCount: 1 });
  await sleep(100);

  // Every theme, for a look (tests/output/theme-*.png).
  const ids = await js(`[...document.querySelectorAll("#themeMenu .theme-item")].map((item) => item.dataset.choice)`);
  for (const id of ids.filter((choice) => choice !== "auto")) {
    await pick(id);
    await sleep(400);
    await shot(`theme-${id}.png`);
  }

  // Automatic: the last dark and last light themes chosen (the loop above
  // went through them all in menu order), by system mode.
  const lastOf = (scheme) =>
    js(
      `[...document.querySelectorAll("#themeMenu .theme-item:not([data-choice=auto])")].filter((item) => (item.querySelector("small")?.textContent === "light") === ${scheme === "light"}).at(-1).dataset.choice`,
    );
  const [lastDark, lastLight] = [await lastOf("dark"), await lastOf("light")];
  await pick("auto");
  const emulate = (scheme) =>
    dbg.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
  await emulate("light");
  await sleep(300);
  const inLight = await themeId();
  await emulate("dark");
  await sleep(300);
  const inDark = await themeId();
  check(
    "Automatic follows the system",
    inLight === lastLight && inDark === lastDark,
    `${inLight} / ${inDark} (expected ${lastLight} / ${lastDark})`,
  );
  check(
    "light themes set color-scheme for native controls",
    (await emulate("light"), await sleep(200), await js(`document.documentElement.style.colorScheme`)) === "light",
  );
  await dbg.sendCommand("Emulation.setEmulatedMedia", { features: [] });

  // Back to the default for the rest of the run.
  await pick("transcribee");
  await sleep(300);
  wc.focus();
  check("back to the default theme", (await variable("--bg")) === "#0e1014");
};
