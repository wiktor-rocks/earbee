// Media and decoding (src/core/media.js): the memory a decoded track
// needs; decoding in parts: splitting a track, how many workers, finding
// where parts join, and putting them end to end.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { formatMemory } from "../../src/core/format.js";
import {
  decodedBytes,
  downsampleLevels,
  findJoin,
  fitsInMemory,
  joinParts,
  splitFrames,
  workerCount,
} from "../../src/core/media.js";

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
  test("parts cut at their joins give the whole track, levels included", () => {
    const factor = 10;
    const whole = chirp(10_005);
    const bounds = splitFrames(whole.length, 3, factor);
    // Each part decodes a little past its end (as the decoder does).
    const parts = bounds.map(({ from, to }) => {
      const samples = whole.slice(from, Math.min(to + 300, whole.length));
      return { channels: [samples], levels: [downsampleLevels(samples, factor)] };
    });
    const keep = bounds.map(({ from, to }, k) => (k + 1 < bounds.length ? to - from : parts[k].channels[0].length));
    const { pieces, levels, frames } = joinParts(parts, keep, factor);

    assert.equal(frames, whole.length);
    const joined = new Float32Array(frames);
    let offset = 0;
    for (const [samples] of pieces) {
      joined.set(samples, offset);
      offset += samples.length;
    }
    assert.deepEqual(joined, whole);
    const expected = downsampleLevels(whole, factor);
    assert.deepEqual(levels[0].peak, expected.peak);
    // The sums of squares differ in the last float bits between the cut and whole runs.
    assert.equal(levels[0].rms.length, expected.rms.length);
    for (let i = 0; i < expected.rms.length; i++) assert.ok(Math.abs(levels[0].rms[i] - expected.rms[i]) < 1e-6);
  });
});

describe("memory", () => {
  test("decoded size: an hour of stereo at 48 kHz is about 1.3 GB", () => {
    assert.equal(decodedBytes(3600, 48000, 2), 1_382_400_000);
    assert.equal(formatMemory(decodedBytes(3600, 48000, 2)), "1.3 GB");
    assert.equal(formatMemory(850 * 1024 ** 2), "850 MB");
  });

  test("fits in at most 80 % of the free memory; unknown always fits", () => {
    assert.ok(fitsInMemory(800, 1000));
    assert.ok(!fitsInMemory(801, 1000));
    assert.ok(fitsInMemory(10 ** 12, null));
  });
});
