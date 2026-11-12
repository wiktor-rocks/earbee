// Recent files (src/features/recent.js, electron/recent-files.js): the two
// lists on the welcome screen and in the File menu, what goes on them and in
// which order, opening an entry (a song, a project, a download), unsaved
// changes first, a file that has gone, removing and clearing. Starts from an
// empty list on a fresh page, so it also runs alone.
// Part of the end-to-end run (see run.cjs); `h` is the harness.
const fs = require("fs");
const path = require("path");

module.exports = async function (h) {
  const { wc, win, js, key, check, sleep, setFiles, shot, projectDialogs, recentFiles, FIXTURES, OUTPUT, DOWNLOADS } =
    h;

  const folder = path.join(OUTPUT, "recent");
  fs.rmSync(folder, { recursive: true, force: true });
  fs.mkdirSync(folder, { recursive: true });
  // A copy of a short fixture, under a name of its own.
  const song = (name) => {
    const file = path.join(folder, name);
    fs.copyFileSync(path.join(FIXTURES, "tone.wav"), file);
    return file;
  };

  const idle = async () => {
    await sleep(200);
    for (let i = 0; i < 200; i++) {
      if (await js(`loadingOverlay.hidden && loadingScreen.hidden && !document.getElementById("app").inert`)) break;
      await sleep(50);
    }
    await sleep(300);
  };
  const open = async (file) => {
    await setFiles(file);
    await idle();
  };
  // A fresh page: the welcome screen again, with nothing open.
  const welcomeAgain = async () => {
    await wc.reload();
    await sleep(1500);
  };
  const title = () => js(`document.title`);
  // What the welcome screen lists, by heading.
  const onWelcome = () =>
    js(`Object.fromEntries([...welcomeRecentLists.querySelectorAll(".recent-list")].map((list) =>
      [list.querySelector("h2").textContent, [...list.querySelectorAll(".recent-name")].map((name) => name.textContent)]))`);
  const inMenu = () => js(`[...fileMenuRecent.querySelectorAll(".menu-label")].map((label) => label.textContent)`);
  const fileNames = () => recentFiles.list().files.map((entry) => entry.name);
  const projectNames = () => recentFiles.list().projects.map((entry) => entry.name);
  // Picks an entry by name: in the File menu or on the welcome screen.
  const pickInMenu = async (name) => {
    await js(`fileMenuButton.click()`);
    await sleep(100);
    await js(`recentMenuButton.click()`);
    await sleep(100);
    await js(`[...fileMenuRecent.querySelectorAll(".recent-item")]
      .find((row) => row.querySelector(".menu-label").textContent === ${JSON.stringify(name)}).click()`);
    await idle();
  };
  const pickOnWelcome = async (name) => {
    await js(`[...welcomeRecentLists.querySelectorAll(".recent-open")]
      .find((row) => row.querySelector(".recent-name").textContent === ${JSON.stringify(name)}).click()`);
    await idle();
  };
  // Saves what's open as a new project, linked to its song.
  const saveProjectAs = async (file) => {
    projectDialogs.save = file;
    await js(`saveAsButton.click()`);
    await sleep(150);
    await js(`saveModeLink.click(); saveForm.requestSubmit()`);
    await sleep(400);
  };

  const [alpha, beta, gamma] = [song("alpha.wav"), song("beta.wav"), song("gamma.wav")];
  projectDialogs.confirm = "discard";
  projectDialogs.locate = null;

  /* ---------- Nothing yet ---------- */

  recentFiles.clear();
  await welcomeAgain();
  check("nothing yet: no list and no headings on the welcome screen", await js(`!welcomeRecent.checkVisibility()`));
  check("…the welcome screen has no entries behind it", (await js(`welcomeRecentLists.childElementCount`)) === 0);
  check("…and the File menu has no Open recent", await js(`recentMenuButton.hidden`));

  /* ---------- What goes on the lists ---------- */

  await open(alpha);
  await open(beta);
  check("opened files are listed, newest first", fileNames().join() === "beta.wav,alpha.wav", fileNames().join());
  check("…a song isn't a project", projectNames().length === 0);
  await sleep(100);
  check("…the File menu follows by itself", (await inMenu()).join() === "beta.wav,alpha.wav", (await inMenu()).join());

  await open(alpha);
  check("opening one again moves it to the top, once", fileNames().join() === "alpha.wav,beta.wav", fileNames().join());

  await setFiles(path.join(FIXTURES, "bad.mp3"));
  await idle();
  check("a file that couldn't be opened isn't listed", !fileNames().includes("bad.mp3"), fileNames().join());

  /* ---------- A project ---------- */

  const workFile = path.join(folder, "work.ebee");
  await open(gamma);
  await saveProjectAs(workFile);
  check("saving a project lists it", projectNames().join() === "work.ebee", projectNames().join());
  check("…and its song stays under files", fileNames()[0] === "gamma.wav", fileNames().join());

  recentFiles.clear();
  await open(workFile);
  check("opening a project lists the project", projectNames().join() === "work.ebee", projectNames().join());
  check("…not also its song", fileNames().length === 0, fileNames().join());

  /* ---------- A download ---------- */

  await js(`downloadButton.click()`);
  await js(
    `downloadUrl.value = "https://fake.test/song"; document.querySelector('input[name="downloadKind"][value="audio"]').click(); document.querySelector("#downloadForm button[type=submit]").click()`,
  );
  for (let i = 0; i < 300 && !fileNames().length; i++) await sleep(50);
  await idle();
  const [downloaded] = fileNames();
  check(
    "a download is listed, from where it was saved",
    Boolean(downloaded) && recentFiles.list().files[0].folder === DOWNLOADS,
    String(downloaded),
  );

  /* ---------- The welcome screen ---------- */

  await open(alpha);
  await welcomeAgain();
  check(
    "the welcome screen shows both lists after a restart",
    JSON.stringify(await onWelcome()) ===
      JSON.stringify({ "Recent projects": ["work.ebee"], "Recent files": ["alpha.wav", downloaded] }),
    JSON.stringify(await onWelcome()),
  );
  const shownFolder = await js(`(() => {
    const row = welcomeRecentLists.querySelector(".recent-open");
    return { text: row.querySelector(".recent-folder").textContent, tooltip: row.title };
  })()`);
  check(
    "…each with the end of its folder, and its full path in the tooltip",
    shownFolder.text === `…${path.sep}${path.basename(OUTPUT)}${path.sep}recent` && shownFolder.tooltip === workFile,
    JSON.stringify(shownFolder),
  );
  check(
    "…and the screen still opens on Open",
    (await js(`document.activeElement.id`)) === "welcomeOpen",
    await js(`document.activeElement.id`),
  );
  await shot("welcome-recent.png");

  await pickOnWelcome("alpha.wav");
  check("a click opens the file", (await title()) === "EarBee — alpha.wav", await title());
  check("…blank, as a file does", (await js(`document.querySelectorAll("#marksList .mark-row").length`)) === 0);
  await welcomeAgain();
  await pickOnWelcome(downloaded);
  check("a download opens the same way", (await title()) === `EarBee — ${downloaded}`, await title());
  check("…and moves to the top", fileNames()[0] === downloaded, fileNames().join());
  await welcomeAgain();
  await pickOnWelcome("work.ebee");
  check("a project opens as a project", (await title()) === "EarBee — work.ebee", await title());

  /* ---------- The File menu ---------- */

  await js(`fileMenuButton.click()`);
  await sleep(150);
  check("the File menu has Open recent", await js(`recentMenuButton.checkVisibility()`));
  check("…but not the lists themselves", !(await js(`fileMenuRecent.matches(":popover-open")`)));
  key("End");
  await sleep(50);
  check("…the arrow keys reach it", await js(`document.activeElement === recentMenuButton`));
  key("Right");
  await sleep(150);
  check(
    "→ opens the side menu, the File menu stays open",
    await js(`fileMenuRecent.matches(":popover-open") && fileMenu.matches(":popover-open")`),
  );
  check("…with the keyboard on its first entry", await js(`document.activeElement.classList.contains("recent-item")`));
  const sideOfMenu = await js(
    `fileMenuRecent.getBoundingClientRect().left >= fileMenu.getBoundingClientRect().right - 1`,
  );
  check("…beside the File menu", sideOfMenu);
  const headings = await js(`[...fileMenuRecent.querySelectorAll(".menu-heading")].map((row) => row.textContent)`);
  check(
    "the side menu shows both lists",
    headings.join() === "Projects,Files" && (await inMenu()).includes("work.ebee"),
    JSON.stringify({ headings, rows: await inMenu() }),
  );
  const menuTooltip = await js(`fileMenuRecent.querySelector(".recent-item").title`);
  check("…a row's tooltip has its full path", menuTooltip === workFile, menuTooltip);
  await shot("file-menu-recent.png");
  key("End");
  await sleep(50);
  check("…the arrow keys stay in it", await js(`fileMenuRecent.contains(document.activeElement)`));
  key("Left");
  await sleep(150);
  check(
    "← closes it, back to Open recent",
    !(await js(`fileMenuRecent.matches(":popover-open")`)) &&
      (await js(`fileMenu.matches(":popover-open") && document.activeElement === recentMenuButton`)),
  );
  await js(`fileMenu.hidePopover()`);
  await sleep(100);
  await pickInMenu("alpha.wav");
  check("a pick switches the song", (await title()) === "EarBee — alpha.wav", await title());
  check("…and closes the menu", !(await js(`fileMenu.matches(":popover-open")`)));

  // Only so many in the menu, all of them on the welcome screen.
  recentFiles.clear();
  for (const letter of "abcdefghij") recentFiles.add("files", path.join(folder, `${letter}.wav`));
  await sleep(100);
  const { max, inMenu: menuMax } = await js(`import("./src/config.js").then(({ CONFIG }) => CONFIG.recent)`);
  check("the oldest drop off the list", fileNames().length === max, String(fileNames().length));
  check(
    "the File menu shows only the newest",
    (await inMenu()).length === menuMax && (await inMenu())[0] === "j.wav",
    (await inMenu()).join(),
  );
  recentFiles.clear();

  /* ---------- Unsaved changes ---------- */

  await open(alpha);
  await open(beta);
  key("M");
  await sleep(300);
  check("(an unsaved change)", (await title()).endsWith(" •"), await title());
  projectDialogs.asked.length = 0;
  projectDialogs.confirm = "cancel";
  await pickInMenu("alpha.wav");
  check(
    "unsaved changes are asked about first; Cancel keeps the song",
    projectDialogs.asked.some(([kind]) => kind === "confirm") && (await title()) === "EarBee — beta.wav •",
    await title(),
  );
  projectDialogs.confirm = "discard";
  await pickInMenu("alpha.wav");
  check("…Don't save goes ahead", (await title()) === "EarBee — alpha.wav", await title());

  /* ---------- A file that has gone ---------- */

  const doomed = song("doomed.wav");
  await open(doomed);
  await open(alpha);
  fs.rmSync(doomed);
  await pickInMenu("doomed.wav");
  const said = await js(`message.textContent`);
  check(
    "a file that has gone says so, and where it was",
    said === `“doomed.wav” isn't in ${folder} any more, so it's off the list.`,
    said,
  );
  check("…the song that was open stays open", (await title()) === "EarBee — alpha.wav", await title());
  check("…and it's off the list", !fileNames().includes("doomed.wav"), fileNames().join());

  const doomedProject = path.join(folder, "doomed.ebee");
  await saveProjectAs(doomedProject);
  await open(alpha);
  fs.rmSync(doomedProject);
  await pickInMenu("doomed.ebee");
  check("a project that has gone says so too", (await js(`message.textContent`)).startsWith("“doomed.ebee” isn't in "));
  check("…and it's off the list", !projectNames().includes("doomed.ebee"), projectNames().join());

  // A project whose song has gone: the question a project always asks.
  const moved = song("moved.wav");
  const movedProject = path.join(folder, "moved.ebee");
  await open(moved);
  await saveProjectAs(movedProject);
  await open(alpha);
  fs.rmSync(moved);
  projectDialogs.asked.length = 0;
  await pickInMenu("moved.ebee");
  check(
    "a project whose song has gone asks where it is",
    projectDialogs.asked.some(([kind]) => kind === "locate"),
    JSON.stringify(projectDialogs.asked),
  );
  check("…canceling changes nothing", (await title()) === "EarBee — alpha.wav", await title());
  check("…and the project stays on the list", projectNames().includes("moved.ebee"), projectNames().join());

  // On the welcome screen, the message and the keyboard stay in reach.
  const doomedToo = song("doomed-too.wav");
  await open(doomedToo);
  await welcomeAgain();
  fs.rmSync(doomedToo);
  await js(`[...document.querySelectorAll(".recent-open")]
    .find((row) => row.querySelector(".recent-name").textContent === "doomed-too.wav").focus()`);
  await pickOnWelcome("doomed-too.wav");
  check("on the welcome screen too", (await js(`welcomeMessage.textContent`)).startsWith("“doomed-too.wav” isn't in "));
  check(
    "…with the focus back on Open",
    (await js(`document.activeElement.id`)) === "welcomeOpen",
    await js(`document.activeElement.id`),
  );

  /* ---------- Removing and clearing ---------- */

  recentFiles.clear();
  for (const file of [alpha, beta, gamma]) recentFiles.add("files", file);
  await welcomeAgain();
  // A real Enter on a focused button: the key, and the character it types.
  const pressEnter = () => {
    wc.sendInputEvent({ type: "keyDown", keyCode: "Return" });
    wc.sendInputEvent({ type: "char", keyCode: "\r" });
    wc.sendInputEvent({ type: "keyUp", keyCode: "Return" });
  };
  await js(`document.querySelector(".recent-remove").focus()`);
  pressEnter();
  await sleep(200);
  check(
    "the keyboard removes an entry",
    (await onWelcome())["Recent files"].join() === "beta.wav,alpha.wav",
    JSON.stringify(await onWelcome()),
  );
  check(
    "…and moves on to the next one's button",
    await js(`document.activeElement === document.querySelectorAll(".recent-remove")[0]`),
  );
  check("…and the file itself is still there", fs.existsSync(gamma));
  await js(`[...document.querySelectorAll(".recent-remove")].at(-1).focus()`);
  pressEnter();
  await sleep(200);
  check(
    "removing the last row moves up one",
    (await onWelcome())["Recent files"].join() === "beta.wav" &&
      (await js(`document.activeElement === document.querySelector(".recent-remove")`)),
    JSON.stringify(await onWelcome()),
  );
  await js(`welcomeRecentClear.click()`);
  await sleep(200);
  check("clearing empties the lists and hides them", await js(`!welcomeRecent.checkVisibility()`));
  check("…with the focus on Open", (await js(`document.activeElement.id`)) === "welcomeOpen");
  check("…and it's gone for good", recentFiles.list().files.length === 0 && recentFiles.list().projects.length === 0);

  /* ---------- A small window ---------- */

  for (const letter of "abcdefgh") {
    recentFiles.add("files", path.join(folder, `${letter}-a-song-with-quite-a-long-name-to-see-it-cut-short.wav`));
    recentFiles.add("projects", path.join(folder, `${letter}.ebee`));
  }
  await sleep(200);
  const [width, height] = win.getSize();
  win.setSize(900, 640);
  await sleep(300);
  // (Within a pixel: a row's edges fall between pixels.)
  const fits = await js(`(() => {
    const inView = (node) => {
      node.scrollIntoView({ block: "nearest" });
      const box = node.getBoundingClientRect();
      return box.top >= -1 && box.bottom <= innerHeight + 1;
    };
    return {
      seen: inView([...document.querySelectorAll(".recent-open")].at(-1)),
      clear: inView(welcomeRecentClear),
      sideways: document.documentElement.scrollWidth > innerWidth,
      cut: [...document.querySelectorAll(".recent-name")].some((name) => name.scrollWidth > name.clientWidth),
    };
  })()`);
  check("in a small window the last entry and Clear can be scrolled to", fits.seen && fits.clear, JSON.stringify(fits));
  check("…the screen doesn't scroll sideways", !fits.sideways, JSON.stringify(fits));
  check("…and a long name is cut short", fits.cut, JSON.stringify(fits));
  await shot("welcome-recent-small.png");
  win.setSize(width, height);
  await js(`scrollTo(0, 0)`);
  recentFiles.clear();
  await sleep(100);
};
