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
//   https://fake.test/chapters  like /song, with chapters (any other: none)
// A search (ytsearchN:words or scsearchN:words, with --flat-playlist)
// prints one JSON line per result, honouring --playlist-items a:b:
//   nothing   no results
//   offline   fails like yt-dlp without a network
//   slow      results, after 3 s (to test canceling)
//   anything else: 12 results, "<words> 1" … "<words> 12"
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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const search = /^(yt|sc)search(\d+):(.*)$/.exec(args.at(-1));
if (search) {
  fs.writeFileSync(path.join(__dirname, "output", "fake-yt-dlp-args.json"), JSON.stringify(args));
  const [, site, count, words] = search;
  const [first, last] = option("--playlist-items").split(":").map(Number);
  (async () => {
    if (words === "offline") fail("[youtube:search] Unable to download API page: Temporary failure in name resolution");
    if (words === "slow") await sleep(3000);
    const total = words === "nothing" ? 0 : Math.min(12, Number(count));
    for (let n = first; n <= Math.min(last, total); n++) {
      const id = `fakeVideo${String(n).padStart(2, "0")}`;
      console.log(
        JSON.stringify({
          id,
          title: `${words} ${n}`,
          channel: site === "yt" ? `Channel ${n}` : undefined,
          uploader: `Uploader ${n}`,
          duration: 60 + n,
          view_count: 1500 * n,
          url: site === "yt" ? `https://www.youtube.com/watch?v=${id}` : `https://api.soundcloud.com/tracks/${n}`,
          webpage_url:
            site === "yt" ? `https://www.youtube.com/watch?v=${id}` : `https://soundcloud.com/someone/track-${n}`,
          thumbnails: [{ url: `https://fake.test/thumb-${n}.png`, width: 320 }],
        }),
      );
    }
  })();
  return;
}

const url = new URL(args.at(-1));
// Within the 6 s fixtures, as yt-dlp's %(chapters)j prints them.
const CHAPTERS = [
  { start_time: 0, title: "Intro", end_time: 2 },
  { start_time: 2, title: "Verse", end_time: 4.5 },
  { start_time: 4.5, title: "Outro", end_time: 6 },
];
// What it was asked for, for the tests to check (e.g. the -f format).
fs.writeFileSync(path.join(__dirname, "output", "fake-yt-dlp-args.json"), JSON.stringify(args));
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
    console.log(`[tb-chapters] ${url.pathname === "/chapters" ? JSON.stringify(CHAPTERS) : "NA"}`);
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
