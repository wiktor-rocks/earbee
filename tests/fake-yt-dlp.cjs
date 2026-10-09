#!/usr/bin/env node
// Stands in for yt-dlp in the tests (run.cjs hands it to downloader.js), so
// downloads are tested offline. It reads what downloader.js passes (-f, -o,
// and the link after "--"), records it in output/fake-yt-dlp-args.json,
// prints the same tagged lines the real yt-dlp prints with those options,
// and acts on the link:
//   https://fake.test/song      downloads the fixtures: dl-audio.m4a, plus
//                               dl-video.webm when -f asks for video too
//   https://fake.test/slow      the same, slowly (to test Cancel)
//   https://fake.test/private   fails like a private video
//   https://fake.test/offline   fails like yt-dlp without a network
//   https://fake.test/forbidden YouTube refuses the stream (HTTP 403)
//   https://fake.test/flaky     refuses once (403), then works like /song
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
const fail = (message, code = 1) => {
  console.error(`ERROR: ${message}`);
  process.exit(code);
};

// The link must come after "--", so it can never be read as an option.
const dashes = args.indexOf("--");
if (dashes === -1 || dashes !== args.length - 2) fail("fake-yt-dlp: the link must be the last argument, after --", 2);
const url = new URL(args.at(-1));
// What it was asked for, for the tests to check (e.g. the -f format).
fs.writeFileSync(path.join(__dirname, "output", "fake-yt-dlp-args.json"), JSON.stringify(args));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  if (url.pathname === "/private") fail("[youtube] priv4te: Private video. Sign in if you've been granted access");
  if (url.pathname === "/offline") {
    fail(
      "[youtube] 0ffline: Unable to download webpage: <urlopen error [Errno -3] Temporary failure in name resolution> (caused by TransportError('<urlopen error [Errno -3] Temporary failure in name resolution>'))",
    );
  }

  const forbidden = "unable to download video data: HTTP Error 403: Forbidden";
  if (url.pathname === "/forbidden") fail(forbidden);
  const flakyMarker = path.join(__dirname, "output", "fake-yt-dlp-flaky");
  if (url.pathname === "/flaky" && !fs.existsSync(flakyMarker)) {
    fs.writeFileSync(flakyMarker, "");
    fail(forbidden);
  }
  fs.rmSync(flakyMarker, { force: true });

  const fixtures = path.join(__dirname, "fixtures");
  const wantsVideo = option("-f").includes("bv");
  const parts = [
    ...(wantsVideo ? [{ id: "247", file: "dl-video.webm", ext: "webm" }] : []),
    { id: "140", file: "dl-audio.m4a", ext: "m4a" },
  ];
  const steps = url.pathname === "/slow" ? 100 : 5;
  const delay = url.pathname === "/slow" ? 200 : 20;

  for (const part of parts) {
    console.log("[tb-title] fakeId123 Test Song: “Quotes” / Slashes");
    const source = path.join(fixtures, part.file);
    const total = fs.statSync(source).size;
    const target = option("-o").replace("%(format_id)s", part.id).replace("%(ext)s", part.ext);
    fs.writeFileSync(`${target}.part`, ""); // as yt-dlp does while downloading
    for (let step = 1; step <= steps; step++) {
      await sleep(delay);
      console.log(`[tb-progress] ${Math.round((total * step) / steps)} ${total} NA ${((steps - step) * delay) / 1000}`);
    }
    fs.copyFileSync(source, target);
    fs.rmSync(`${target}.part`);
    console.log(`[tb-file] ${target}`);
  }
})();
