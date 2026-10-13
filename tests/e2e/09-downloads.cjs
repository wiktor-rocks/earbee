// Downloads through the real preload and downloader, with the fake yt-dlp.
// Part of the end-to-end run (see run.cjs); `h` is the harness.
const fs = require("fs");
const path = require("path");
const os = require("os");
const { clipboard } = require("electron");

module.exports = async function (h) {
  const {
    wc,
    js,
    key,
    duration,
    shot,
    pos,
    playing,
    ensurePaused,
    check,
    sleep,
    prefsStore,
    externalOpens,
    toasts,
    DOWNLOADS,
  } = h;

  {
    const dialogOpen = () => js(`document.getElementById("downloadDialog").open`);
    const ui = () =>
      js(
        `({ overlay: !document.getElementById("loadingOverlay").hidden, status: document.getElementById("overlayStatus").textContent, cancel: !document.getElementById("overlayCancel").hidden, file: document.getElementById("fileName").textContent, message: document.getElementById("message").textContent, error: !document.getElementById("message").classList.contains("notice"), video: !document.getElementById("videoPane").hidden })`,
      );
    const waitIdle = async () => {
      for (let i = 0; i < 300; i++) {
        await sleep(50);
        if (await js(`document.getElementById("loadingOverlay").hidden && !document.getElementById("play").disabled`))
          break;
      }
      await sleep(300);
    };
    const download = async (url, kind) => {
      await js(`document.getElementById("downloadButton").click()`);
      await js(
        `document.getElementById("downloadUrl").value = ${JSON.stringify(url)}; document.querySelector('input[name="downloadKind"][value="${kind}"]').click(); document.querySelector("#downloadForm button[type=submit]").click()`,
      );
    };
    const savedFiles = () => (fs.existsSync(DOWNLOADS) ? fs.readdirSync(DOWNLOADS).sort() : []);
    const workDirs = () => fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith("scribee-download-"));
    const workDirsBefore = workDirs();

    // The dialog: opens focused, refuses a non-link, blocks shortcuts, closes on Escape.
    await ensurePaused();
    await js(`document.getElementById("downloadButton").click()`);
    check(
      "From YouTube opens the dialog, link field focused",
      (await dialogOpen()) && (await js(`document.activeElement.id === "downloadUrl"`)),
    );
    await js(
      `document.getElementById("downloadUrl").value = "not a link"; document.querySelector("#downloadForm button[type=submit]").click()`,
    );
    await sleep(200);
    check("words aren't downloaded: they search, and the dialog stays open", await dialogOpen());
    await shot("download-dialog.png");
    await js(`document.querySelector("#downloadForm button[type=submit]").focus()`);
    key("Space");
    await sleep(300);
    check("shortcuts don't fire while the dialog is open", !(await playing()));
    key("Escape");
    await sleep(200);
    check("Escape closes the dialog", !(await dialogOpen()));
    // Like Settings, a click on the backdrop closes it too.
    await js(`document.getElementById("downloadButton").click()`);
    await js(`downloadDialog.dispatchEvent(new MouseEvent("click", { bubbles: true }))`);
    check("a click on the backdrop closes the dialog", !(await dialogOpen()));

    // Pasting a link anywhere opens the dialog with it.
    clipboard.writeText("https://fake.test/pasted");
    await js(`document.activeElement?.blur()`);
    wc.paste();
    await sleep(300);
    check(
      "pasting a link opens the dialog with it",
      (await dialogOpen()) && (await js(`document.getElementById("downloadUrl").value`)) === "https://fake.test/pasted",
    );
    key("Escape");
    await sleep(200);

    // Audio: progress, then the file plays and is saved.
    await download("https://fake.test/song", "audio");
    await sleep(40);
    const during = await ui();
    check(
      "download shows progress and Cancel on the overlay",
      during.overlay && /^Downloading…|^Saving…|^Loading/.test(during.status),
      JSON.stringify(during),
    );
    await waitIdle();
    let u = await ui();
    const audioName = "Test Song “Quotes” Slashes [fakeId123].m4a";
    check("downloaded audio opens in the player", u.file === audioName, JSON.stringify(u));
    check("window title names the download", (await js(`document.title`)) === `ScriBee — ${audioName}`);
    check("downloaded audio has its full length", Math.abs((await duration()) - 6) < 0.1, `${await duration()}`);
    check(
      "a notification says where it was saved, the transport bar stays clear",
      (await toasts()).some(
        (t) => t.text === `Downloaded “${audioName}”` && t.detail === path.join(DOWNLOADS, audioName),
      ) &&
        !u.error &&
        u.message === "",
      JSON.stringify({ toasts: await toasts(), message: u.message }),
    );
    key("Space");
    await sleep(600);
    const heard = await pos();
    await ensurePaused();
    check("downloaded audio plays", heard > 0.2, `${heard}`);

    // Searching by words: results with pictures, Show more, another site,
    // open in the browser, no results, failures, and picking one.
    const rows = () =>
      js(`[...document.querySelectorAll("#searchResults li")].map((row) => ({
        title: row.querySelector(".search-title").textContent, meta: row.querySelector(".search-meta").textContent,
        picture: row.querySelector("img").src.slice(0, 22) }))`);
    const status = () => js(`searchStatus.hidden ? "" : searchStatus.textContent`);
    const until = async (condition, ms = 5000) => {
      for (let waited = 0; waited < ms && !(await condition()); waited += 50) await sleep(50);
    };
    const type = (text) =>
      js(
        `downloadUrl.value = ${JSON.stringify(text)}; downloadUrl.dispatchEvent(new Event("input", { bubbles: true }))`,
      );
    const submit = () => js(`document.querySelector("#downloadForm button[type=submit]").click()`);
    await js(`document.getElementById("downloadButton").click()`);
    await type("test words");
    check(
      "words turn Download into Search, with where to search",
      (await js(`downloadSubmit.textContent`)) === "Search" &&
        (await js(`!searchSource.hidden && searchSource.value`)) === "youtube",
    );
    await submit();
    await until(async () => (await rows()).length === 8);
    let found = await rows();
    check(
      "a search lists 8 results: title, channel · length · views",
      found.length === 8 && found[0].title === "test words 1" && found[0].meta === "Channel 1 · 1:01 · 1.5K views",
      JSON.stringify(found[0]),
    );
    await until(async () => (await rows()).every((row) => row.picture.startsWith("data:image/png")));
    check(
      "…with their pictures, handed over as data (the page fetches nothing)",
      (await rows()).every((row) => row.picture.startsWith("data:image/png")),
    );
    check("…and Show more", await js(`!searchMore.hidden`));
    await shot("search-results.png");
    await js(`searchMore.click()`);
    await until(async () => (await rows()).length === 12);
    found = await rows();
    check(
      "Show more adds the next ones, then hides (no more)",
      found.length === 12 && found[11].title === "test words 12" && (await js(`searchMore.hidden`)),
      `${found.length}`,
    );
    await js(`document.querySelector("#searchResults .search-open").click()`);
    await sleep(200);
    check(
      "the arrow opens the result in the browser, and the dialog stays",
      externalOpens.at(-1) === "https://www.youtube.com/watch?v=fakeVideo01" && (await dialogOpen()),
      JSON.stringify(externalOpens),
    );
    await js(`searchSource.value = "soundcloud"; searchSource.dispatchEvent(new Event("change"))`);
    await until(async () => (await rows())[0]?.meta.startsWith("Uploader 1"));
    check(
      "another site searches the same words there, and is remembered",
      (await rows())[0]?.meta === "Uploader 1 · 1:01 · 1.5K views" &&
        prefsStore.get("downloads").searchSource === "soundcloud",
      JSON.stringify((await rows())[0]),
    );
    await js(`searchSource.value = "youtube"; searchSource.dispatchEvent(new Event("change"))`);
    await sleep(300);
    await type("nothing");
    await submit();
    await until(async () => (await status()).startsWith("No results"));
    check(
      "no results says so",
      (await status()) === "No results for “nothing” on YouTube." && (await rows()).length === 0,
      await status(),
    );
    await type("offline");
    await submit();
    await until(async () => (await status()).startsWith("Couldn't"));
    check(
      "a failed search explains why",
      (await status()) === "Couldn't reach the site. Check your internet connection." &&
        (await js(`searchStatus.classList.contains("error")`)),
      await status(),
    );
    await type("slow");
    await submit();
    await sleep(300);
    const searching = await status();
    key("Escape");
    await sleep(300);
    await js(`document.getElementById("downloadButton").click()`);
    check(
      "closing the dialog stops a search; it opens empty again",
      searching === "Searching YouTube…" && (await status()) === "" && (await rows()).length === 0,
      searching,
    );
    await type("https://fake.test/song");
    check(
      "a link is a Download again",
      (await js(`downloadSubmit.textContent`)) === "Download" && (await js(`searchSource.hidden`)),
    );
    await type("test words");
    await submit();
    await until(async () => (await rows()).length === 8);
    await js(`document.querySelector('input[name="downloadKind"][value="audio"]').click()`);
    await js(`document.querySelector("#searchResults .search-result").click()`);
    await sleep(100);
    check("picking a result closes the dialog and downloads it", !(await dialogOpen()));
    await waitIdle();
    u = await ui();
    check("…and it opens in the player", u.file === audioName, JSON.stringify(u));
    check(
      "…from the result's link",
      JSON.parse(fs.readFileSync(path.join(h.OUTPUT, "fake-yt-dlp-args.json"), "utf8")).at(-1) ===
        "https://www.youtube.com/watch?v=fakeVideo01",
    );

    // Chapters the uploader gave the video become regions, named and in turn
    // through the mark colours; not an unsaved change. The checkbox turns it off.
    const marksListed = () =>
      js(`[...document.querySelectorAll("#marksList .mark-row")].map((row) => ({
        name: row.querySelector(".mark-name").value, time: row.querySelector(".mark-time").textContent,
        color: row.querySelector(".mark-color").style.getPropertyValue("--mark-color") }))`);
    check("a video without chapters adds no marks", (await marksListed()).length === 0);
    await download("https://fake.test/chapters", "audio");
    await waitIdle();
    let chapters = await marksListed();
    check(
      "a video's chapters become regions named after them, at their times",
      JSON.stringify(chapters.map((mark) => `${mark.name} ${mark.time}`)) ===
        JSON.stringify(["Intro 0:00.000 – 0:02.000", "Verse 0:02.000 – 0:04.500", "Outro 0:04.500 – 0:06.000"]),
      JSON.stringify(chapters),
    );
    check("…each in the next colour", new Set(chapters.map((mark) => mark.color)).size === 3, JSON.stringify(chapters));
    check(
      "…a notification says so, and they aren't an unsaved change",
      (await toasts()).some((t) => t.text === "Added 3 chapters as marks") &&
        !(await js(`document.title`)).endsWith("•"),
      JSON.stringify(await toasts()),
    );
    await download("https://fake.test/chapters", "video");
    await waitIdle();
    check("a video's two parts still give each chapter once", (await marksListed()).length === 3);
    await js(`document.getElementById("downloadButton").click()`);
    check("the chapters box starts ticked", await js(`downloadChapters.checked`));
    await js(`downloadChapters.click()`);
    await sleep(200);
    await js(
      `downloadUrl.value = "https://fake.test/chapters"; document.querySelector("#downloadForm button[type=submit]").click()`,
    );
    await waitIdle();
    check(
      "unticked: no chapters, and that's remembered",
      (await marksListed()).length === 0 && prefsStore.get("downloads").chapters === false,
    );
    await js(`document.getElementById("downloadButton").click()`);
    check("…the box starts unticked next time", !(await js(`downloadChapters.checked`)));
    await js(`downloadChapters.click()`);
    await sleep(200);
    key("Escape");
    await sleep(200);

    // Video: picture and sound joined into one .mp4 with a picture.
    await download("https://fake.test/song", "video");
    await waitIdle();
    u = await ui();
    check(
      "downloaded video opens with its picture",
      u.file === "Test Song “Quotes” Slashes [fakeId123].mp4" && u.video,
      JSON.stringify(u),
    );
    // The picture is read from disk by URL in pieces, not sent over whole.
    check("the download is read by URL, not sent as bytes", h.mediaReads.count > 0, `${h.mediaReads.count} reads`);
    check(
      "only the finished files are saved (no parts)",
      JSON.stringify(savedFiles()) ===
        JSON.stringify(["Test Song “Quotes” Slashes [fakeId123].m4a", "Test Song “Quotes” Slashes [fakeId123].mp4"]),
      JSON.stringify(savedFiles()),
    );
    await js(`document.getElementById("downloadButton").click()`);
    // It starts on Settings › Downloads › Download (Audio), not on the last
    // choice (see 13-settings for changing it).
    check(
      "the dialog starts on the kind set in Settings",
      await js(`document.querySelector('input[name="downloadKind"][value="audio"]').checked`),
    );
    key("Escape");
    await sleep(200);

    // Failures: shown as errors; the current file stays.
    await download("https://fake.test/private", "audio");
    await waitIdle();
    u = await ui();
    check(
      "a failed download shows yt-dlp's reason, keeps the file",
      u.error && u.message === "Private video. Sign in if you've been granted access" && u.file.endsWith(".mp4"),
      JSON.stringify(u),
    );
    await download("https://fake.test/offline", "audio");
    await waitIdle();
    u = await ui();
    check("no network is explained", u.error && u.message.startsWith("Couldn't reach the site"), u.message);

    await download("https://fake.test/forbidden", "audio");
    await waitIdle();
    u = await ui();
    check("a refused (403) download is explained", u.error && u.message.startsWith("YouTube refused"), u.message);
    await download("https://fake.test/flaky", "audio");
    await waitIdle();
    u = await ui();
    check("a one-off 403 is retried and succeeds", !u.error && u.file.endsWith(".m4a"), JSON.stringify(u));
    await download("https://fake.test/song", "video"); // back to the video, as the checks below expect
    await waitIdle();

    // Cancel: back to the player, nothing saved or left behind.
    await download("https://fake.test/slow", "audio");
    await sleep(1200);
    u = await ui();
    check(
      "the overlay shows the video's title while downloading",
      (await js(`document.getElementById("overlayTitle").textContent`)) === "Test Song: “Quotes” / Slashes",
    );
    check(
      "slow download shows a percentage and time left",
      u.cancel && /^Downloading… \d+ % · 0:\d\d left$/.test(u.status),
      u.status,
    );
    await shot("download-progress.png");
    await js(`document.getElementById("overlayCancel").click()`);
    await waitIdle();
    u = await ui();
    check(
      "Cancel returns to the player without an error",
      !u.overlay && u.message === "" && u.file.endsWith(".mp4"),
      JSON.stringify(u),
    );
    check("Cancel leaves no files behind", savedFiles().length === 2, JSON.stringify(savedFiles()));
    check(
      "temporary download folders are removed",
      JSON.stringify(workDirs()) === JSON.stringify(workDirsBefore),
      JSON.stringify(workDirs()),
    );
  }
};
