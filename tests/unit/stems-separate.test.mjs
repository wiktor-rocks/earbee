// electron/stems/separate.js: splitting a song into segments and blending
// the model's answers back, with a fake model that hands every stem the
// segment it was given. Each stem must then come out as the song itself:
// a segment put back in the wrong place, or weights that don't add up,
// would show.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, test } from "node:test";

const { separate, segmentStarts, triangle, SEGMENT, STEMS, BINS, FRAMES } = createRequire(import.meta.url)(
  "../../electron/stems/separate.js",
);

// Every stem's time branch is the segment; the spectral branch is silent.
const silentSpec = new Float32Array(STEMS.length * 4 * BINS * FRAMES);
const echo = async (mix) => {
  const wave = new Float32Array(STEMS.length * 2 * SEGMENT);
  for (let s = 0; s < STEMS.length; s++) wave.set(mix, s * 2 * SEGMENT);
  return { spec: silentSpec, wave };
};

// Noise around an offset, so the normalising has something to undo.
function song(length, seed) {
  let x = seed;
  const next = () => ((x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * 2 - 1;
  return Float32Array.from({ length }, () => 0.1 + 0.5 * next());
}

const largestDifference = (a, b) => a.reduce((most, value, i) => Math.max(most, Math.abs(value - b[i])), 0);

describe("separate", () => {
  test("gives back each segment where it came from", async () => {
    const length = Math.round(2.4 * SEGMENT);
    const left = song(length, 1);
    const right = song(length, 2);
    const progress = [];
    const { stems } = await separate({
      left,
      right,
      runModel: echo,
      onProgress: (done, total) => progress.push([done, total]),
    });

    assert.deepEqual(Object.keys(stems), STEMS);
    for (const name of STEMS) {
      assert.ok(largestDifference(stems[name][0], left) < 1e-4, `${name}, left`);
      assert.ok(largestDifference(stems[name][1], right) < 1e-4, `${name}, right`);
    }
    const total = segmentStarts(length).length;
    assert.deepEqual(progress.at(-1), [total, total]);
    assert.equal(progress.length, total + 1);
  });

  test("makes only the stems asked for", async () => {
    const left = song(10_000, 6);
    const { stems } = await separate({ left, right: left, runModel: echo, keep: ["guitar", "bass"] });
    assert.deepEqual(Object.keys(stems).sort(), ["bass", "guitar"]);
    assert.ok(largestDifference(stems.guitar[0], left) < 1e-4);
  });

  test("handles a song shorter than one segment", async () => {
    const left = song(10_000, 3);
    const right = song(10_000, 4);
    const { stems } = await separate({ left, right, runModel: echo });
    assert.ok(largestDifference(stems.guitar[0], left) < 1e-4);
  });

  test("stops when cancelled", async () => {
    let calls = 0;
    const runModel = async (mix) => (calls++, echo(mix));
    const left = song(2 * SEGMENT, 5);
    await assert.rejects(
      separate({ left, right: left, runModel, cancelled: () => calls >= 1 }),
      (error) => error.name === "Cancelled",
    );
    assert.equal(calls, 1);
  });
});

test("the segments overlap by a quarter", () => {
  assert.deepEqual(segmentStarts(1), [0]);
  assert.deepEqual(segmentStarts(SEGMENT + 1), [0, 257985]);
});

test("the blending weight rises to 1 in the middle and falls back", () => {
  const weight = triangle(8);
  assert.deepEqual([...weight], [0.25, 0.5, 0.75, 1, 1, 0.75, 0.5, 0.25]);
  assert.equal(Math.max(...triangle(7)), 1);
});
