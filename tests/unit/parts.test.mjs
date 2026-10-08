// Decoding in parts (src/core/parts.js): splitting a track, how many
// workers, finding where parts join, and putting them end to end.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { findJoin, joinParts, splitFrames, workerCount } from "../../src/core/parts.js";
import { downsamplePeaks } from "../../src/core/peaks.js";

// A test signal that never repeats: a chirp.
const chirp = (length, offset = 0) =>
  Float32Array.from({ length }, (_, i) => Math.sin(((i + offset) * (i + offset)) / 2e5) * 0.5);

describe("splitFrames", () => {
  test("equal parts, inner bounds aligned, the last to the end", () => {
    assert.deepEqual(splitFrames(1000, 4, 10), [
      { from: 0, to: 250 },
      { from: 250, to: 500 },
      { from: 500, to: 750 },
      { from: 750, to: Infinity },
    ]);
    for (const { from } of splitFrames(1_000_003, 3, 441)) assert.equal(from % 441, 0);
  });

  test("one part, or fewer parts than asked when the track is short", () => {
    assert.deepEqual(splitFrames(1000, 1, 10), [{ from: 0, to: Infinity }]);
    assert.deepEqual(splitFrames(30, 4, 10), [
      { from: 0, to: 10 },
      { from: 10, to: 20 },
      { from: 20, to: Infinity },
    ]);
    assert.deepEqual(splitFrames(5, 4, 10), [{ from: 0, to: Infinity }]);
  });
});

describe("workerCount", () => {
  const config = { minDuration: 60, maxWorkers: 4 };
  test("one for short tracks or unknown durations", () => {
    assert.equal(workerCount(59, 8, config), 1);
    assert.equal(workerCount(NaN, 8, config), 1);
  });
  test("one per spare core, at most maxWorkers", () => {
    assert.equal(workerCount(3600, 8, config), 4);
    assert.equal(workerCount(3600, 3, config), 2);
    assert.equal(workerCount(3600, 1, config), 1);
    assert.equal(workerCount(3600, undefined, config), 1);
  });
});

describe("findJoin", () => {
  const options = { maxLag: 100, window: 256, tolerance: 1e-4 };
  const track = [chirp(20000), chirp(20000, 7)]; // stereo

  test("finds where the later part starts, also off the expected spot", () => {
    for (const lag of [0, 48, -48, 100, -100]) {
      const start = 12000;
      const after = track.map((samples) => samples.slice(start));
      assert.equal(findJoin(track, after, start + lag, options), start, `lag ${lag}`);
    }
  });

  test("nothing matches: null (decode in one piece)", () => {
    const after = track.map((samples) => samples.slice(12000).map((x) => x * 0.9));
    assert.equal(findJoin(track, after, 12000, options), null);
    // Out of range: further than maxLag.
    assert.equal(
      findJoin(
        track,
        track.map((s) => s.slice(12000)),
        12000 + 101,
        options,
      ),
      null,
    );
  });

  test("silence: the timestamps are trusted", () => {
    const silence = [new Float32Array(5000), new Float32Array(5000)];
    assert.equal(findJoin(track, silence, 12345, options), 12345);
  });

  test("a repeating signal: the nearest match", () => {
    const period = 50;
    const tone = [Float32Array.from({ length: 20000 }, (_, i) => Math.sin((2 * Math.PI * i) / period))];
    assert.equal(findJoin(tone, [tone[0].slice(10000)], 10000 + 20, options), 10000);
    assert.equal(findJoin(tone, [tone[0].slice(10000)], 10000 + 30, options), 10000 + 50);
  });
});

describe("joinParts", () => {
  test("parts cut at their joins give the whole track, peaks included", () => {
    const factor = 10;
    const whole = chirp(10_005);
    const bounds = splitFrames(whole.length, 3, factor);
    // Each part decodes a little past its end (as the decoder does).
    const parts = bounds.map(({ from, to }) => {
      const samples = whole.slice(from, Math.min(to + 300, whole.length));
      return { channels: [samples], peaks: [downsamplePeaks(samples, factor)] };
    });
    const keep = bounds.map(({ from, to }, k) => (k + 1 < bounds.length ? to - from : parts[k].channels[0].length));
    const { pieces, peaks, frames } = joinParts(parts, keep, factor);

    assert.equal(frames, whole.length);
    const joined = new Float32Array(frames);
    let offset = 0;
    for (const [samples] of pieces) {
      joined.set(samples, offset);
      offset += samples.length;
    }
    assert.deepEqual(joined, whole);
    assert.deepEqual(peaks[0], downsamplePeaks(whole, factor));
  });
});
