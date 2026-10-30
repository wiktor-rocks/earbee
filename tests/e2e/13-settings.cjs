// Settings: the dialog (generated from src/prefs), the General, Theme,
// Downloads and Advanced sections, Reset, keeping the palette menu in step, what the main process
// refuses, and keeping the values over a reload.
// Part of the end-to-end run (see run.cjs); `h` is the harness.
const fs = require("fs");
const path = require("path");

module.exports = async function (h) {
  const { js, key, shot, playing, ensurePaused, check, sleep, prefsFile, prefsStore, folderChoice, OUTPUT } = h;
  const isOpen = () => js(`document.getElementById("settingsDialog").open`);
  const saved = () => JSON.parse(fs.readFileSync(prefsFile, "utf8"));
  // The field row for `key` in section `section`.
  const row = (section, key) => `document.querySelector('#settings-${section} [data-key="${key}"]')`;
  const radio = (section, key, value) => `${row(section, key)}.querySelector('input[value="${value}"]')`;
  const choose = async (section, key, value) => {
    await js(`${radio(section, key, value)}.click()`);
    await sleep(200);
  };
  const resetShown = (section, key) => js(`!${row(section, key)}.querySelector(".pref-reset").hidden`);
  const tab = (id) => js(`document.getElementById("settings-tab-${id}").click()`);

  // Opening: the gear, one tab per section, shortcuts held off.
  await ensurePaused();
  await js(`document.getElementById("settingsButton").click()`);
  await sleep(200);
  check(
    "the gear opens Settings, focus on the first tab",
    (await isOpen()) && (await js(`document.activeElement.id`)) === "settings-tab-general",
  );
  check(
    "one tab per settings section",
    JSON.stringify(await js(`[...document.querySelectorAll(".settings-tab")].map((tab) => tab.textContent)`)) ===
      JSON.stringify(["General", "Theme", "Waveform", "Layout", "Downloads", "Advanced"]),
  );
  // The dialog has one size: switching tabs, or fields showing and hiding,
  // never moves it or its tabs.
  {
    const layout = () =>
      js(
        `(() => { const d = document.getElementById("settingsDialog").getBoundingClientRect(); const t = document.querySelector(".settings-tab").getBoundingClientRect(); const p = document.getElementById("settingsPanels"); return { dialog: [d.left, d.top, d.width, d.height].map(Math.round).join(), tab: [t.left, t.top].map(Math.round).join(), content: p.scrollHeight, shown: p.clientHeight }; })()`,
      );
    const seen = [];
    for (const id of ["general", "theme", "waveform", "layout", "downloads", "advanced", "theme"]) {
      await js(`document.getElementById("settings-tab-${id}").click()`);
      await sleep(100);
      seen.push({ id, ...(await layout()) });
    }
    await js(`document.querySelector('#settings-theme [data-key="choice"] input[value="auto"]').click()`);
    await sleep(200);
    seen.push({ id: "theme, Automatic", ...(await layout()) });
    await js(`document.querySelector('#settings-theme [data-key="choice"] .pref-reset').click()`);
    await sleep(200);
    const still = seen.every((s) => s.dialog === seen[0].dialog && s.tab === seen[0].tab);
    check("the dialog and its tabs stay put across tabs and changes", still, JSON.stringify(seen));
  }
  key("Space");
  await sleep(300);
  check("shortcuts don't fire while Settings is open", !(await playing()));

  // Theme: applies at once, saved, Reset, the Automatic pairings.
  check("Reset hidden while a setting is at its default", !(await resetShown("theme", "choice")));
  await choose("theme", "choice", "dracula");
  check(
    "choosing a theme in Settings applies and saves it",
    (await js(`document.documentElement.dataset.theme`)) === "dracula" && saved().theme.choice === "dracula",
  );
  check("Reset shows once it isn't the default", await resetShown("theme", "choice"));
  const pairingsShown = () => js(`!${row("theme", "dark")}.hidden && !${row("theme", "light")}.hidden`);
  check("the dark / light pickers are hidden unless Automatic", !(await pairingsShown()));
  await choose("theme", "choice", "auto");
  check(
    "…and shown for Automatic, with the last dark theme chosen",
    (await pairingsShown()) && (await js(`${radio("theme", "dark", "dracula")}.checked`)),
  );
  await shot("settings-theme.png");
  await js(`${row("theme", "choice")}.querySelector(".pref-reset").click()`);
  await sleep(200);
  check(
    "Reset puts the default back",
    (await js(`document.documentElement.dataset.theme`)) === "earbee" &&
      (await js(`${radio("theme", "choice", "earbee")}.checked`)) &&
      !(await resetShown("theme", "choice")),
  );

  // General: notifications are on by default; the switch turns them off.
  await tab("general");
  await sleep(100);
  const notifySwitch = `${row("general", "notifications")}.querySelector("input")`;
  check(
    "notifications are on by default",
    (await js(`${notifySwitch}.checked`)) && saved().general?.notifications !== false,
  );
  await js(`${notifySwitch}.click()`);
  await sleep(200);
  check("the switch turns notifications off, and it's saved", saved().general.notifications === false);
  await js(`${notifySwitch}.click()`);
  await sleep(200);
  check("…and on again", saved().general.notifications === true);
  check(
    "the beat click isn't here: it's in the beats menu",
    (await js(`${row("general", "beatClick")} === null`)) === true,
  );
  await tab("theme");
  await sleep(100);

  // A change made elsewhere (here the main process, as the palette menu or
  // another window would) shows in the open dialog.
  prefsStore.set("theme", "choice", "nord");
  await sleep(300);
  check(
    "a change made elsewhere shows in the dialog",
    (await js(`${radio("theme", "choice", "nord")}.checked`)) &&
      (await js(`document.documentElement.dataset.theme`)) === "nord",
  );

  // Escape closes it (opened with a click, so no focus is left on the
  // gear); the palette menu agrees.
  key("Escape");
  await sleep(200);
  check(
    "Escape closes Settings, no focus left on the gear",
    !(await isOpen()) && (await js(`document.activeElement === document.body`)),
  );
  await js(`document.getElementById("themeButton").click()`);
  await sleep(150);
  check(
    "the palette menu shows the theme chosen in Settings",
    (await js(`document.querySelector('#themeMenu [aria-checked="true"]').dataset.choice`)) === "nord",
  );
  await js(`document.querySelector('#themeMenu [data-choice="one-dark"]').click()`);
  await sleep(200);
  key("Escape");
  await sleep(150);
  await js(`document.getElementById("settingsButton").click()`);
  await sleep(200);
  check(
    "…and Settings shows the theme chosen in the menu",
    await js(`${radio("theme", "choice", "one-dark")}.checked`),
  );

  // Downloads: the folder, the kind, the quality.
  await tab("downloads");
  await sleep(100);
  check(
    "the Downloads tab shows its section",
    await js(
      `!document.getElementById("settings-downloads").hidden && document.getElementById("settings-theme").hidden`,
    ),
  );
  const folderText = () => js(`${row("downloads", "folder")}.querySelector(".pref-path").textContent`);
  check("the folder shows the default", (await folderText()) === h.DOWNLOADS, await folderText());
  folderChoice.path = null; // canceled
  await js(`${row("downloads", "folder")}.querySelector("button:not(.pref-reset)").click()`);
  await sleep(200);
  check("canceling the folder picker changes nothing", folderChoice.asked === 1 && saved().downloads.folder === null);
  const elsewhere = path.join(OUTPUT, "downloads-elsewhere");
  fs.rmSync(elsewhere, { recursive: true, force: true });
  folderChoice.path = elsewhere;
  await js(`${row("downloads", "folder")}.querySelector("button:not(.pref-reset)").click()`);
  await sleep(200);
  check(
    "Choose… sets the folder the picker returned",
    (await folderText()) === elsewhere && saved().downloads.folder === elsewhere,
    await folderText(),
  );
  await choose("downloads", "kind", "video");
  await choose("downloads", "maxHeight", "720");
  await shot("settings-downloads.png");
  check("the kind and quality are saved", saved().downloads.kind === "video" && saved().downloads.maxHeight === 720);
  key("Escape");
  await sleep(200);

  await js(`document.getElementById("downloadButton").click()`);
  await sleep(150);
  check(
    "the From YouTube dialog starts on the kind, quality and folder from Settings",
    (await js(`document.querySelector('input[name="downloadKind"][value="video"]').checked`)) &&
      (await js(`document.getElementById("downloadVideoLabel").textContent`)) === "up to 720p" &&
      (await js(`document.getElementById("downloadFolder").textContent`)) === elsewhere,
  );
  await js(
    `document.getElementById("downloadUrl").value = "https://fake.test/song"; document.querySelector("#downloadForm button[type=submit]").click()`,
  );
  for (let i = 0; i < 300; i++) {
    await sleep(50);
    if (await js(`document.getElementById("loadingOverlay").hidden && !document.getElementById("play").disabled`))
      break;
  }
  await sleep(300);
  const format = (() => {
    const args = JSON.parse(fs.readFileSync(path.join(OUTPUT, "fake-yt-dlp-args.json"), "utf8"));
    return args[args.indexOf("-f") + 1];
  })();
  check("yt-dlp is asked for at most 720p", format.includes("height<=720") && !format.includes("1080"), format);
  const files = fs.existsSync(elsewhere) ? fs.readdirSync(elsewhere) : [];
  check(
    "the download is saved in the chosen folder",
    files.some((name) => name.endsWith(".mp4")),
    JSON.stringify(files),
  );

  // The main process checks everything the page sends.
  const before = fs.readFileSync(prefsFile, "utf8");
  const answers = await js(`Promise.all([
    earbee.prefs.set("downloads", "folder", "/etc"),
    earbee.prefs.set("downloads", "kind", "podcast"),
    earbee.prefs.set("downloads", "nope", 1),
    earbee.prefs.set("nope", "kind", "audio"),
    earbee.prefs.chooseFolder("downloads", "kind"),
  ])`);
  check(
    "the page can't set a folder, an invalid value or an unknown setting",
    answers.every((answer) => answer.ok === false) && fs.readFileSync(prefsFile, "utf8") === before,
    JSON.stringify(answers.map((answer) => answer.error)),
  );
  check("…and the folder picker only opens for folder settings", folderChoice.asked === 2);

  // Kept over a reload (the preload reads them before the page starts).
  await h.wc.reload();
  await sleep(1500);
  check(
    "settings are kept over a reload",
    (await js(`document.documentElement.dataset.theme`)) === "one-dark" &&
      (await js(`document.querySelector('#settings-downloads [data-key="kind"] input[value="video"]').checked`)),
  );

  // Back to the defaults for anything after this.
  prefsStore.reset("theme");
  prefsStore.reset("downloads");
  await sleep(300);
  check("back to the default theme", (await js(`document.documentElement.dataset.theme`)) === "earbee");
};
