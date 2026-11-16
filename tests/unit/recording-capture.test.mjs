// src/features/recording/capture.js, firstSampleTime: when a recording's
// first sample was played, from each chunk's capture time and the ties
// between the page's clock and the player's.
import assert from "node:assert/strict";
import { test } from "node:test";
import { firstSampleTime } from "../../src/features/recording/capture.js";

const sampleRate = 48000;
// Chunks of 1024 samples from capture time `from` (ms); ties every 20 ms, each off by `noise(i)` ms.
const chunksFrom = (from, count) =>
  Array.from({ length: count }, (_, i) => ({ at: from + (i * 1024000) / sampleRate, before: i * 1024 }));
const tiesAround = (from, to, tie, noise = () => 0) =>
  Array.from({ length: Math.floor((to - from) / 20) }, (_, i) => ({ at: from + i * 20, tie: tie + noise(i) }));

test("the first sample's time is its capture time less the tie", () => {
  const time = firstSampleTime(chunksFrom(5000, 100), tiesAround(4000, 8000, 3000), sampleRate);
  assert.ok(Math.abs(time - 2) < 1e-9, String(time));
});

test("ties that are off now and then don't move it", () => {
  const noise = (i) => (i % 5 === 0 ? 15 : i % 7 === 0 ? -9 : 0);
  const time = firstSampleTime(chunksFrom(5000, 100), tiesAround(4000, 8000, 3000, noise), sampleRate);
  assert.ok(Math.abs(time - 2) < 1e-9, String(time));
});

test("a chunk stamped out of place doesn't move it", () => {
  const chunks = chunksFrom(5000, 100);
  chunks[3].at += 40;
  chunks[50].at -= 25;
  const time = firstSampleTime(chunks, tiesAround(4000, 8000, 3000), sampleRate);
  assert.ok(Math.abs(time - 2) < 1e-9, String(time));
});

test("clocks that drift apart: right in the middle of the recording", () => {
  // The tie grows by 0.2 ms a second: the recording's ends are each off by half of what it drifted.
  const ties = Array.from({ length: 300 }, (_, i) => ({ at: 4000 + i * 20, tie: 3000 + i * 0.004 }));
  const time = firstSampleTime(chunksFrom(5000, 100), ties, sampleRate);
  assert.ok(Math.abs(time - 2) < 0.001, String(time));
});

test("nothing recorded, or no ties: 0", () => {
  assert.equal(firstSampleTime([], tiesAround(0, 100, 5), sampleRate), 0);
  assert.equal(firstSampleTime(chunksFrom(0, 3), [], sampleRate), 0);
});
