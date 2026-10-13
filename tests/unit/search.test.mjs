// Searching by keywords: the sources and what a result is
// (src/search/sources.js), and the downloader's search and pictures
// (electron/downloader.js) against the fake yt-dlp.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import {
  MAX_QUERY_LENGTH,
  PAGE_SIZE,
  SEARCH_SOURCES,
  cleanQuery,
  isLinkOn,
  isResultLink,
  normalizeResult,
  sourceById,
} from "../../src/search/sources.js";

const require = createRequire(import.meta.url);
const { createDownloader, DownloadCanceled, DownloadError } = require("../../electron/downloader.js");
const TESTS = path.join(import.meta.dirname, "..");
const youtube = sourceById("youtube");
const soundcloud = sourceById("soundcloud");

describe("sources", () => {
  test("each has an id, a name, a query and hosts; the ids are unique", () => {
    assert.equal(new Set(SEARCH_SOURCES.map((source) => source.id)).size, SEARCH_SOURCES.length);
    for (const source of SEARCH_SOURCES) {
      assert.ok(source.name && source.hosts.length && typeof source.query === "function", source.id);
    }
    assert.equal(youtube.query("a b", 8), "ytsearch8:a b");
    assert.equal(soundcloud.query("a b", 16), "scsearch16:a b");
    assert.equal(sourceById("nowhere"), null);
  });

  test("cleanQuery: one line, no control characters, not too long", () => {
    assert.equal(cleanQuery("  queen\n\tbohemian \u0000 rhapsody "), "queen bohemian rhapsody");
    assert.equal(cleanQuery("x".repeat(500)).length, MAX_QUERY_LENGTH);
    assert.equal(cleanQuery("   "), "");
    assert.equal(cleanQuery(undefined), "");
  });

  test("links: https on a source's site (or a subdomain) only", () => {
    assert.ok(isLinkOn("https://www.youtube.com/watch?v=x", youtube.hosts));
    assert.ok(isLinkOn("https://m.youtube.com/watch?v=x", youtube.hosts));
    assert.ok(!isLinkOn("http://www.youtube.com/watch?v=x", youtube.hosts), "not plain http");
    assert.ok(!isLinkOn("https://notyoutube.com/x", youtube.hosts));
    assert.ok(!isLinkOn("https://youtube.com.evil.test/x", youtube.hosts));
    assert.ok(!isLinkOn("file:///etc/passwd", youtube.hosts));
    assert.ok(isResultLink("https://soundcloud.com/a/b") && !isResultLink("https://example.com/"));
  });
});

describe("normalizeResult", () => {
  const entry = {
    id: "fJ9rUzIMcZQ",
    title: " Queen – Bohemian Rhapsody ",
    channel: "Queen Official",
    duration: 360,
    view_count: 2106275768,
    url: "https://www.youtube.com/watch?v=fJ9rUzIMcZQ",
    thumbnails: [
      { url: "https://i.ytimg.com/a.jpg", width: 120 },
      { url: "https://i.ytimg.com/b.jpg", width: 720 },
      { url: "https://i.ytimg.com/c.jpg", width: 360 },
    ],
  };

  test("a YouTube entry", () => {
    assert.deepEqual(normalizeResult(entry, youtube), {
      id: "fJ9rUzIMcZQ",
      title: "Queen – Bohemian Rhapsody",
      channel: "Queen Official",
      duration: 360,
      views: 2106275768,
      url: "https://www.youtube.com/watch?v=fJ9rUzIMcZQ",
      thumbnail: "https://i.ytimg.com/c.jpg", // the smallest at least 160 wide
    });
  });

  test("no picture: YouTube's own, from the id; tiny ones: the widest", () => {
    assert.equal(
      normalizeResult({ ...entry, thumbnails: [] }, youtube).thumbnail,
      "https://i.ytimg.com/vi/fJ9rUzIMcZQ/mqdefault.jpg",
    );
    const tiny = [
      { url: "https://x.test/16.jpg", width: 16 },
      { url: "https://x.test/47.jpg", width: 47 },
      { url: "http://x.test/plain.jpg", width: 500 },
    ];
    assert.equal(normalizeResult({ ...entry, thumbnails: tiny }, youtube).thumbnail, "https://x.test/47.jpg");
  });

  test("SoundCloud: the page, not the API link; the uploader; fractional length", () => {
    const result = normalizeResult(
      {
        id: 115417954,
        title: "Queen - Bohemian Rhapsody",
        uploader: "rizky.rilos",
        duration: 352.856,
        view_count: 0,
        url: "https://api.soundcloud.com/tracks/soundcloud%3Atracks%3A115417954",
        webpage_url: "https://soundcloud.com/rizky-rilos/queen-bohemian-rhapsody",
      },
      soundcloud,
    );
    assert.equal(result.url, "https://soundcloud.com/rizky-rilos/queen-bohemian-rhapsody");
    assert.equal(result.channel, "rizky.rilos");
    assert.equal(result.id, "115417954");
    assert.equal(result.views, 0);
    assert.equal(result.thumbnail, null);
  });

  test("not a result: no title, or a link off the site; unknowns are null", () => {
    assert.equal(normalizeResult({ ...entry, title: "" }, youtube), null);
    assert.equal(normalizeResult({ ...entry, url: "https://example.com/x" }, youtube), null);
    assert.equal(normalizeResult(null, youtube), null);
    const bare = normalizeResult({ id: "x", title: "T", url: entry.url, duration: "?", view_count: -1 }, youtube);
    assert.deepEqual([bare.channel, bare.duration, bare.views], ["", null, null]);
  });
});

describe("the downloader's search (fake yt-dlp)", () => {
  fs.mkdirSync(path.join(TESTS, "output"), { recursive: true });
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "transcribee-search-test-"));
  after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const pixel = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const fetch = async (url) => {
    if (url.endsWith("/big.png"))
      return new Response(Buffer.alloc(400 * 1024), { headers: { "content-type": "image/png" } });
    if (url.endsWith("/page.html")) return new Response("<html>", { headers: { "content-type": "text/html" } });
    return new Response(pixel, { headers: { "content-type": "image/png" } });
  };
  const downloader = createDownloader({
    binDir: folder,
    saveDir: folder,
    ytDlp: path.join(TESTS, "fake-yt-dlp.cjs"),
    fetch,
  });
  const lastArgs = () => JSON.parse(fs.readFileSync(path.join(TESTS, "output", "fake-yt-dlp-args.json"), "utf8"));

  test("page 1, then page 2: the query after --, one page of items each", async () => {
    const first = await downloader.search("  some  words ", "youtube", 1, () => {});
    assert.equal(first.results.length, PAGE_SIZE);
    assert.equal(first.more, true);
    assert.equal(first.results[0].title, "some words 1");
    let args = lastArgs();
    assert.deepEqual(args.slice(-2), ["--", `ytsearch${PAGE_SIZE}:some words`]);
    assert.equal(args[args.indexOf("--playlist-items") + 1], `1:${PAGE_SIZE}`);
    assert.ok(args.includes("--flat-playlist"));

    const second = await downloader.search("some words", "youtube", 2, () => {});
    assert.deepEqual(
      second.results.map((result) => result.title),
      ["some words 9", "some words 10", "some words 11", "some words 12"],
    );
    assert.equal(second.more, false);
    args = lastArgs();
    assert.equal(args.at(-1), `ytsearch${2 * PAGE_SIZE}:some words`);
    assert.equal(args[args.indexOf("--playlist-items") + 1], `${PAGE_SIZE + 1}:${2 * PAGE_SIZE}`);
  });

  test("words that look like an option stay words", async () => {
    await downloader.search("--exec rm", "soundcloud", 1, () => {});
    assert.deepEqual(lastArgs().slice(-2), ["--", `scsearch${PAGE_SIZE}:--exec rm`]);
  });

  test("nothing found, a failure explained, unknown site or no words refused", async () => {
    assert.deepEqual(await downloader.search("nothing", "youtube", 1, () => {}), { results: [], more: false });
    await assert.rejects(
      downloader.search("offline", "youtube", 1, () => {}),
      /Couldn't reach the site/,
    );
    await assert.rejects(
      downloader.search("x", "nowhere", 1, () => {}),
      DownloadError,
    );
    await assert.rejects(
      downloader.search(" \n ", "youtube", 1, () => {}),
      /what to search for/,
    );
  });

  test("a new search, or cancelSearch, cancels one still running", async () => {
    const slow = downloader.search("slow", "youtube", 1, () => {});
    await new Promise((resolve) => setTimeout(resolve, 300));
    const quick = downloader.search("quick", "youtube", 1, () => {});
    await assert.rejects(slow, DownloadCanceled);
    assert.equal((await quick).results[0].title, "quick 1");

    const again = downloader.search("slow", "youtube", 1, () => {});
    await new Promise((resolve) => setTimeout(resolve, 300));
    downloader.cancelSearch();
    await assert.rejects(again, DownloadCanceled);
  });

  test("pictures: small https images only, as data: URLs", async () => {
    assert.equal(
      await downloader.fetchThumbnail("https://x.test/a.png"),
      `data:image/png;base64,${pixel.toString("base64")}`,
    );
    assert.equal(await downloader.fetchThumbnail("https://x.test/big.png"), null, "too big");
    assert.equal(await downloader.fetchThumbnail("https://x.test/page.html"), null, "not an image");
    assert.equal(await downloader.fetchThumbnail("http://x.test/a.png"), null, "not https");
    assert.equal(await downloader.fetchThumbnail(null), null);
  });
});

// The real setup (no `ytDlp` given): yt-dlp is fetched once, shared by
// whoever needs it. Here a stand-in "yt-dlp" (a shell script printing
// nothing, so a search finds nothing) is served by a fake fetch, which
// holds the file back until told.
describe("the downloader's yt-dlp setup", { skip: process.platform === "win32" }, () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "transcribee-setup-test-"));
  after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const script = Buffer.from("#!/bin/sh\nexit 0\n");
  const sha = crypto.createHash("sha256").update(script).digest("hex");
  const sums = ["yt-dlp_linux", "yt-dlp_linux_aarch64", "yt-dlp_macos"].map((name) => `${sha}  ${name}`).join("\n");
  let release;
  const held = new Promise((resolve) => (release = resolve));
  let asked = 0; // times the file itself was fetched
  const fetch = async (url, { signal } = {}) => {
    if (url.endsWith("SHA2-256SUMS")) return new Response(sums);
    asked++;
    await Promise.race([
      held,
      new Promise((_, reject) => signal?.addEventListener("abort", () => reject(signal.reason))),
    ]);
    return new Response(script);
  };
  const downloader = createDownloader({ binDir: folder, saveDir: folder, fetch });

  test("a new search doesn't cancel the setup the one it replaces started", async () => {
    const progress = [];
    const first = downloader.search("first", "youtube", 1, () => {});
    await new Promise((resolve) => setTimeout(resolve, 50)); // the setup is fetching yt-dlp
    const second = downloader.search("second", "youtube", 1, (step) => progress.push(step.stage));
    await assert.rejects(first, DownloadCanceled);
    release();
    assert.deepEqual(await second, { results: [], more: false });
    assert.equal(asked, 1, "fetched once");
    assert.ok(progress.includes("setup"), "the second search hears the setup's progress");
  });
});
