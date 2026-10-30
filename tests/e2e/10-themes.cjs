// Colour themes, chosen in Settings › Theme only (there's no other picker):
// switching (CSS variables and the waveform's canvases), saving the
// choice, every theme, Automatic.
// Part of the end-to-end run (see run.cjs); `h` is the harness.
const fs = require("fs");

module.exports = async function (h) {
  const { wc, js, dbg, shot, ensurePaused, check, sleep, prefsFile } = h;
  const variable = (name) => js(`getComputedStyle(document.documentElement).getPropertyValue("${name}").trim()`);
  const themeId = () => js(`document.documentElement.dataset.theme`);
  // As Settings › Theme does: the setting, which the page then follows.
  const pick = (id) => js(`earbee.prefs.set("theme", "choice", ${JSON.stringify(id)})`);
  const themes = await js(
    `import("./src/themes/index.js").then(({ THEMES }) => THEMES.map(({ id, scheme }) => ({ id, scheme })))`,
  );
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
  check("starts with the default theme", (await themeId()) === "earbee" && (await variable("--bg")) === "#0f0c0a");
  check(
    "no theme button on the top bar or the welcome screen: themes are in Settings",
    await js(
      `!document.getElementById("themeButton") && !document.getElementById("welcomeThemeButton") && !document.getElementById("themeMenu")`,
    ),
  );

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
  check("the choice is saved", JSON.parse(fs.readFileSync(prefsFile, "utf8")).theme.choice === "nord");

  // Every theme, for a look (tests/output/theme-*.png).
  for (const { id } of themes) {
    await pick(id);
    await sleep(400);
    await shot(`theme-${id}.png`);
  }

  // Automatic: the last dark and last light themes chosen (the loop above
  // went through them all in order), by system mode.
  const lastOf = (scheme) => themes.filter((theme) => theme.scheme === scheme).at(-1).id;
  const [lastDark, lastLight] = [lastOf("dark"), lastOf("light")];
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
  await pick("earbee");
  await sleep(300);
  wc.focus();
  check("back to the default theme", (await variable("--bg")) === "#0f0c0a");
};
