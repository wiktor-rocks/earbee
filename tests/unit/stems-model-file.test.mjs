// electron/stems/model-file.js: where the stem model is, and downloading
// it once, checked by size and SHA-256 (with a small stand-in "model" and
// fetch).
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";

const { createModelFile, ModelFileError, NAME } = createRequire(import.meta.url)("../../electron/stems/model-file.js");

const BYTES = Buffer.from("not really a model, but checked like one");
const source = {
  url: "https://example.test/model.onnx",
  bytes: BYTES.length,
  sha256: crypto.createHash("sha256").update(BYTES).digest("hex"),
};

// Answers with `body` in two pieces (or the status), counting its calls.
function fakeFetch(body = BYTES, status = 200) {
  const fetch = async (url, { signal }) => {
    fetch.calls.push(url);
    signal?.throwIfAborted();
    const half = Math.floor(body.length / 2);
    return new Response(new Blob([body.subarray(0, half), body.subarray(half)]).stream(), { status });
  };
  fetch.calls = [];
  return fetch;
}

let userData;
beforeEach(() => (userData = fs.mkdtempSync(path.join(os.tmpdir(), "earbee-stems-"))));
afterEach(() => fs.rmSync(userData, { recursive: true, force: true }));

const modelPath = () => path.join(userData, "models", NAME);
const leftovers = () => fs.readdirSync(path.join(userData, "models")).filter((name) => name !== NAME);

test("downloads the model once, checks it, and reports progress", async () => {
  const fetch = fakeFetch();
  const file = createModelFile({ userData, fetch, source });
  assert.deepEqual(file.status(), { ready: false, bytes: BYTES.length });
  assert.equal(file.path(), null);

  const fractions = [];
  await file.download((fraction) => fractions.push(fraction), new AbortController().signal);
  assert.deepEqual(fs.readFileSync(modelPath()), BYTES);
  assert.equal(file.path(), modelPath());
  assert.equal(file.status().ready, true);
  assert.equal(fractions.at(-1), 1);
  assert.deepEqual(leftovers(), []);

  await file.download(() => {}, new AbortController().signal);
  assert.equal(fetch.calls.length, 1, "not downloaded again");
});

test("refuses a damaged download and leaves nothing behind", async () => {
  const damaged = Buffer.from(BYTES);
  damaged[0] ^= 1;
  const file = createModelFile({ userData, fetch: fakeFetch(damaged), source });
  await assert.rejects(
    file.download(() => {}, new AbortController().signal),
    (error) => {
      assert.ok(error instanceof ModelFileError);
      assert.match(error.message, /damaged/);
      return true;
    },
  );
  assert.equal(file.status().ready, false);
  assert.deepEqual(leftovers(), []);
});

test("explains an HTTP error", async () => {
  const file = createModelFile({ userData, fetch: fakeFetch(BYTES, 404), source });
  await assert.rejects(
    file.download(() => {}, new AbortController().signal),
    /HTTP 404/,
  );
});

test("a cancelled download says so", async () => {
  const file = createModelFile({ userData, fetch: fakeFetch(), source });
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    file.download(() => {}, abort.signal),
    (error) => error.canceled === true,
  );
});

test("running from the source, the exported copy is used as it is", () => {
  const devCopy = path.join(userData, "exported.onnx");
  fs.writeFileSync(devCopy, "anything");
  const file = createModelFile({ userData, devCopy, fetch: fakeFetch(), source });
  assert.equal(file.path(), devCopy);
  assert.equal(file.status().ready, true);
});
