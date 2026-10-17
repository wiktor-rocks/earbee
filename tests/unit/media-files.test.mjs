// electron/media-files.js: serving downloaded files to the page in pieces.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

const { createMediaFiles, parseRange } = createRequire(import.meta.url)("../../electron/media-files.js");

describe("parseRange", () => {
  test("no header, or one it doesn't understand: the whole file", () => {
    const whole = { start: 0, end: 99, partial: false };
    assert.deepEqual(parseRange(null, 100), whole);
    assert.deepEqual(parseRange("bytes=-", 100), whole);
    assert.deepEqual(parseRange("bytes=0-1,5-6", 100), whole);
    assert.deepEqual(parseRange("items=0-1", 100), whole);
  });

  test("a range, an open end, the last n bytes", () => {
    assert.deepEqual(parseRange("bytes=10-19", 100), { start: 10, end: 19, partial: true });
    assert.deepEqual(parseRange("bytes=90-", 100), { start: 90, end: 99, partial: true });
    assert.deepEqual(parseRange("bytes=-10", 100), { start: 90, end: 99, partial: true });
    assert.deepEqual(parseRange("bytes=-500", 100), { start: 0, end: 99, partial: true });
    assert.deepEqual(parseRange("bytes=50-500", 100), { start: 50, end: 99, partial: true }, "clipped to the end");
  });

  test("nothing to serve", () => {
    assert.equal(parseRange("bytes=100-", 100), null);
    assert.equal(parseRange("bytes=20-10", 100), null);
    assert.equal(parseRange("bytes=-0", 100), null);
    assert.equal(parseRange("bytes=0-", 0), null);
  });
});

describe("createMediaFiles", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "earbee-media-test-"));
  const file = path.join(folder, "Song [id].m4a");
  fs.writeFileSync(file, Buffer.from(Array.from({ length: 100 }, (_, i) => i)));
  const media = createMediaFiles();
  const url = media.share(file);
  const get = (target, init) => media.respond(new Request(target, init));
  after(() => fs.rmSync(folder, { recursive: true, force: true }));

  test("a shared file has a private URL ending in its name", () => {
    assert.match(url, /^earbee-media:\/\/[0-9a-f-]{36}\/Song%20%5Bid%5D\.m4a$/);
    assert.notEqual(media.share(file), url, "a new token each time");
  });

  test("the whole file, or a range of it", async () => {
    const whole = await get(url);
    assert.equal(whole.status, 200);
    assert.equal(whole.headers.get("Accept-Ranges"), "bytes");
    assert.equal(whole.headers.get("Content-Length"), "100");
    assert.equal((await whole.arrayBuffer()).byteLength, 100);

    const part = await get(url, { headers: { Range: "bytes=10-19" } });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get("Content-Range"), "bytes 10-19/100");
    assert.deepEqual([...new Uint8Array(await part.arrayBuffer())], [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  });

  test("the page (origin file://, i.e. null) may read the range headers", async () => {
    const response = await get(url, { headers: { Range: "bytes=0-0" } });
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
    assert.match(response.headers.get("Access-Control-Expose-Headers"), /Content-Range/);
    await response.arrayBuffer();
  });

  test("HEAD: the size, no body", async () => {
    const response = await get(url, { method: "HEAD" });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Length"), "100");
  });

  test("a range past the end: 416 with the size", async () => {
    const response = await get(url, { headers: { Range: "bytes=200-" } });
    assert.equal(response.status, 416);
    assert.equal(response.headers.get("Content-Range"), "bytes */100");
  });

  test("only shared files: an unknown token or a path is 404", async () => {
    assert.equal((await get("earbee-media://00000000-0000-0000-0000-000000000000/x")).status, 404);
    assert.equal((await get(`earbee-media://etc/passwd`)).status, 404);
    assert.equal((await get(`earbee-media://localhost${file}`)).status, 404);
  });

  test("a shared file that is gone since: 404", async () => {
    const gone = path.join(folder, "gone.mp3");
    fs.writeFileSync(gone, "x");
    const goneUrl = media.share(gone);
    fs.rmSync(gone);
    assert.equal((await get(goneUrl)).status, 404);
  });

  test("only reading", async () => {
    assert.equal((await get(url, { method: "POST", body: "x" })).status, 405);
  });
});
