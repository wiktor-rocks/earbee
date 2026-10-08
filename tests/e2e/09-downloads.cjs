// Downloads through the real preload and downloader, with the fake yt-dlp.
// Part of the end-to-end run (see run.cjs); `h` is the harness.
const fs = require("fs");
const path = require("path");
const os = require("os");
const { clipboard } = require("electron");

module.exports = async function (h) {
  const { wc, js, key, duration, shot, pos, playing, ensurePaused, check, sleep, DOWNLOADS } = h;

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
    const workDirs = () => fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith("transcribee-download-"));
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
    check("a non-link is refused (dialog stays open)", await dialogOpen());
    await shot("download-dialog.png");
    await js(`document.querySelector("#downloadForm button[type=submit]").focus()`);
    key("Space");
    await sleep(300);
    check("shortcuts don't fire while the dialog is open", !(await playing()));
    key("Escape");
    await sleep(200);
    check("Escape closes the dialog", !(await dialogOpen()));

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
    check("window title names the download", (await js(`document.title`)) === `TranscriBee — ${audioName}`);
    check("downloaded audio has its full length", Math.abs((await duration()) - 6) < 0.1, `${await duration()}`);
    check("notice says where it was saved", !u.error && u.message.includes(path.join(DOWNLOADS, audioName)), u.message);
    key("Space");
    await sleep(600);
    const heard = await pos();
    await ensurePaused();
    check("downloaded audio plays", heard > 0.2, `${heard}`);

    // Video: picture and sound joined into one .mp4 with a picture.
    await download("https://fake.test/song", "video");
    await waitIdle();
    u = await ui();
    check(
      "downloaded video opens with its picture",
      u.file === "Test Song “Quotes” Slashes [fakeId123].mp4" && u.video,
      JSON.stringify(u),
    );
    check(
      "only the finished files are saved (no parts)",
      JSON.stringify(savedFiles()) ===
        JSON.stringify(["Test Song “Quotes” Slashes [fakeId123].m4a", "Test Song “Quotes” Slashes [fakeId123].mp4"]),
      JSON.stringify(savedFiles()),
    );
    await js(`document.getElementById("downloadButton").click()`);
    check(
      "the dialog remembers Audio / Video",
      await js(`document.querySelector('input[name="downloadKind"][value="video"]').checked`),
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
