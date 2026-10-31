// electron/stems/stft.js: the stem model's inverse STFT, checked against
// Demucs's own _ispec on a small spectrogram (tests/unit/fixtures/
// stems-golden.json, written by scripts/export-stem-model.py).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const { createIspec } = createRequire(import.meta.url)("../../electron/stems/stft.js");

const golden = JSON.parse(readFileSync(new URL("./fixtures/stems-golden.json", import.meta.url), "utf8"));
const floats = (base64) => {
  const bytes = Buffer.from(base64, "base64");
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
};

const largestDifference = (a, b) => a.reduce((most, value, i) => Math.max(most, Math.abs(value - b[i])), 0);

test("gives Demucs's _ispec output, for each of two channels", () => {
  const { hop, frames, length } = golden;
  const re = floats(golden.re);
  const im = floats(golden.im);
  const expected = floats(golden.out);
  const ispec = createIspec({ hop, frames, length });

  // The same spectrogram on one channel, silence on the other.
  const silent = new Float32Array(re.length);
  const outA = new Float32Array(length);
  const outB = new Float32Array(length);
  ispec(re, im, silent, silent, outA, outB);
  assert.ok(largestDifference(outA, expected) < 1e-5, `channel A differs by ${largestDifference(outA, expected)}`);
  assert.ok(outB.every((value) => Math.abs(value) < 1e-6));

  // Swapped: the channels don't leak into each other.
  ispec(silent, silent, re, im, outA, outB);
  assert.ok(largestDifference(outB, expected) < 1e-5, `channel B differs by ${largestDifference(outB, expected)}`);
  assert.ok(outA.every((value) => Math.abs(value) < 1e-6));
});

test("refuses a length the spectrogram can't fill", () => {
  assert.throws(() => createIspec({ hop: 64, frames: 4, length: 10_000 }), /too short/);
});
