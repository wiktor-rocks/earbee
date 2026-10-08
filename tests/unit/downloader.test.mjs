// The parts of electron/downloader.js that need no network or yt-dlp:
// which links are accepted, how failures are explained, file names.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, test } from "node:test";

const { checkUrl, explainFailure, fileNameFor, DownloadError } = createRequire(import.meta.url)(
  "../../electron/downloader.js",
);

describe("checkUrl", () => {
  test("accepts web links", () => {
    assert.equal(checkUrl(" https://www.youtube.com/watch?v=abc "), "https://www.youtube.com/watch?v=abc");
    assert.equal(checkUrl("http://youtu.be/abc"), "http://youtu.be/abc");
  });

  test("refuses anything else", () => {
    assert.throws(() => checkUrl("not a link"), DownloadError);
    assert.throws(() => checkUrl("file:///etc/passwd"), /Only web links/);
    assert.throws(() => checkUrl("--exec=rm"), DownloadError);
  });
});

describe("explainFailure", () => {
  const explain = (line) => explainFailure(["[youtube] abc: Downloading webpage", line]);

  test("yt-dlp's reason, without its prefix or cause", () => {
    assert.equal(
      explain("ERROR: [youtube] abc123: Private video. Sign in if you've been granted access"),
      "Private video. Sign in if you've been granted access",
    );
    assert.equal(explain("ERROR: Something odd (caused by <Thing>)"), "Something odd");
  });

  test("no network, however the system words it", () => {
    for (const reason of [
      "[Errno -3] Temporary failure in name resolution",
      "[Errno 11001] getaddrinfo failed",
      "nodename nor servname provided, or not known",
      "[Errno 101] Network is unreachable",
      "Read timed out.",
    ]) {
      assert.match(
        explain(`ERROR: [youtube] abc: Unable to download webpage: <urlopen error ${reason}>`),
        /^Couldn't reach/,
      );
    }
  });

  test("refused streams and unsupported links", () => {
    assert.match(explain("ERROR: unable to download video data: HTTP Error 403: Forbidden"), /^YouTube refused/);
    assert.match(explain("ERROR: Unsupported URL: https://example.com/"), /isn't a video/);
  });

  test("no ERROR line", () => {
    assert.equal(explainFailure(["WARNING: something"]), "The download failed.");
  });
});

describe("fileNameFor", () => {
  test("safe on every system, with the video id", () => {
    assert.equal(fileNameFor('AC/DC: "Back" <in> Black?', "x1", "m4a"), "AC DC Back in Black [x1].m4a");
    assert.equal(fileNameFor("tab\there\u0007", "x1", "mp4"), "tab here [x1].mp4");
    assert.equal(fileNameFor("   ", "x1", "m4a"), "Download [x1].m4a");
    assert.equal(fileNameFor("a".repeat(300), "x1", "m4a").length, 150 + " [x1].m4a".length);
  });
});
