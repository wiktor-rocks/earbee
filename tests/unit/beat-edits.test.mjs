// A project's edits to the beats (src/core/beat-edits.js): the steady
// grid, half and double time, moving the bar starts, subdivisions.
import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, test } from "node:test";
import { CONFIG } from "../../src/config.js";
import { applyBeatEdits, NO_EDITS } from "../../src/core/beat-edits.js";

const LIMITS = CONFIG.beats.steady;
const edit = (raw, edits) => applyBeatEdits(raw, { ...NO_EDITS, ...edits }, LIMITS);
const gaps = (times) =>
  Array.from(times)
    .slice(1)
    .map((time, i) => time - times[i]);
const close = (actual, expected, within = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= within, `${actual} is not within ${within} of ${expected}`);

// `count` beats every `period` s from `start`, a bar start every `perBar`.
function grid({ count, period = 0.5, start = 1, perBar = 4 }) {
  const times = Array.from({ length: count }, (_, i) => start + i * period);
  return { times, bars: times.filter((_, i) => i % perBar === 0) };
}

describe("no edits", () => {
  test("gives the beats and bars as found", () => {
    const raw = grid({ count: 16 });
    const result = edit(raw, {});
    assert.deepEqual(Array.from(result.times), raw.times);
    assert.deepEqual(Array.from(result.bars), raw.bars);
    assert.deepEqual(Array.from(result.downbeat), [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
    assert.equal(result.subdivisions, null);
  });

  test("without bars (the simple finder), no downbeat flags", () => {
    const result = edit({ times: [1, 1.5, 2, 2.5], bars: null }, { tempo: 0.5, barShift: 1 });
    assert.equal(result.downbeat, null);
    assert.equal(result.bars, null);
    assert.deepEqual(Array.from(result.times), [1, 2]);
  });

  test("an empty or one-beat list stays as it is", () => {
    for (const times of [[], [3]]) {
      const result = edit({ times, bars: null }, { steady: true, tempo: 2, subdivide: 4 });
      assert.deepEqual(Array.from(result.times), times);
    }
  });
});

describe("steady grid", () => {
  test("fills a missing beat, and two in a row", () => {
    const raw = grid({ count: 40 });
    const holed = { times: raw.times.filter((_, i) => i !== 10 && i !== 21 && i !== 22), bars: raw.bars };
    const result = edit(holed, { steady: true });
    assert.equal(result.times.length, 40);
    for (const gap of gaps(result.times)) close(gap, 0.5, 1e-9);
  });

  test("drops a stray beat close to another, keeping the one on the grid", () => {
    const raw = grid({ count: 40 });
    const stray = { times: [...raw.times.slice(0, 11), raw.times[10] + 0.08, ...raw.times.slice(11)], bars: raw.bars };
    const result = edit(stray, { steady: true });
    assert.deepEqual(Array.from(result.times), raw.times);
  });

  test("of two close together, keeps the bar start", () => {
    const raw = grid({ count: 40 });
    // A stray just before bar 3's start (beat 8).
    const stray = { times: [...raw.times.slice(0, 8), raw.times[8] - 0.1, ...raw.times.slice(8)], bars: raw.bars };
    const result = edit(stray, { steady: true });
    assert.deepEqual(Array.from(result.times), raw.times);
    assert.deepEqual(Array.from(result.bars), raw.bars);
  });

  test("leaves a long break empty", () => {
    const first = grid({ count: 20 });
    const second = grid({ count: 20, start: first.times.at(-1) + 0.5 * 30 });
    const raw = { times: [...first.times, ...second.times], bars: [...first.bars, ...second.bars] };
    assert.equal(edit(raw, { steady: true }).times.length, 40);
  });

  test("follows a slow change of tempo", () => {
    const times = [0];
    for (let i = 1; i < 80; i++) times.push(times.at(-1) + 0.5 + i * 0.002); // 120 → about 92 BPM
    const result = edit({ times, bars: null }, { steady: true });
    assert.deepEqual(Array.from(result.times), times);
  });

  test("fills a stretch the finder counted in half time", () => {
    const raw = grid({ count: 120 });
    // Beats 40…79 only every other one: the model's half time.
    const halved = { times: raw.times.filter((_, i) => i < 40 || i >= 80 || i % 2 === 0), bars: raw.bars };
    const result = edit(halved, { steady: true });
    assert.equal(result.times.length, 120);
    for (const gap of gaps(result.times)) close(gap, 0.5, 1e-9);
  });

  test("drops a stray bar start", () => {
    const raw = grid({ count: 40 });
    const result = edit(
      { times: raw.times, bars: [...raw.bars.slice(0, 3), raw.times[9], ...raw.bars.slice(3)] },
      {
        steady: true,
      },
    );
    assert.deepEqual(Array.from(result.bars), raw.bars);
  });
});

describe("half and double time", () => {
  test("half time keeps the bar starts' beats, and every other bar", () => {
    const raw = grid({ count: 32 });
    const result = edit(raw, { tempo: 0.5 });
    assert.equal(result.times.length, 16);
    for (const gap of gaps(result.times)) close(gap, 1);
    assert.deepEqual(Array.from(result.bars), [1, 5, 9, 13]);
  });

  test("half time keeps the bar starts' side when they're on odd beats", () => {
    const raw = grid({ count: 33 });
    const shifted = { times: raw.times, bars: raw.times.filter((_, i) => i % 4 === 1) };
    const result = edit(shifted, { tempo: 0.5 });
    assert.ok(Array.from(result.bars).every((bar) => Array.from(result.times).includes(bar)));
    assert.equal(result.times[0], raw.times[1]);
  });

  test("half time: one bar of an odd length doesn't break the grid", () => {
    const raw = grid({ count: 64 });
    // A bar start one beat late in the middle (a 5-beat bar, then a 3-beat one).
    const bars = raw.bars.map((bar, k) => (k === 8 ? bar + 0.5 : bar));
    const result = edit({ times: raw.times, bars }, { tempo: 0.5 });
    for (const gap of gaps(result.times)) close(gap, 1);
  });

  test("double time puts a beat between each two; bars stay", () => {
    const raw = grid({ count: 8 });
    const result = edit(raw, { tempo: 2 });
    assert.equal(result.times.length, 15);
    for (const gap of gaps(result.times)) close(gap, 0.25);
    assert.deepEqual(Array.from(result.bars), raw.bars);
  });
});

describe("bar starts and subdivisions", () => {
  test("bar starts move by beats, either way; one moved off the end is gone", () => {
    const raw = grid({ count: 12 });
    assert.deepEqual(Array.from(edit(raw, { barShift: 1 }).bars), [1.5, 3.5, 5.5]);
    assert.deepEqual(Array.from(edit(raw, { barShift: -1 }).bars), [2.5, 4.5]);
  });

  test("subdivisions are evenly between the beats, apart from them", () => {
    const raw = grid({ count: 3 });
    const result = edit(raw, { subdivide: 4 });
    assert.deepEqual(Array.from(result.times), raw.times);
    assert.deepEqual(Array.from(result.subdivisions), [1.125, 1.25, 1.375, 1.625, 1.75, 1.875]);
  });

  test("triplets after double time divide the new beats", () => {
    const result = edit(grid({ count: 2 }), { tempo: 2, subdivide: 3 });
    assert.equal(result.subdivisions.length, 4);
    close(result.subdivisions[0], 1 + 0.25 / 3);
  });
});

test("a real song counted in double time: steady grid and half time give its beat", () => {
  const { beats, bars } = JSON.parse(
    fs.readFileSync(new URL("./fixtures/beats-double-time.json", import.meta.url), "utf8"),
  );
  // As found, the beats waver between about 0.23 s and 0.46 s apart.
  assert.ok(gaps(beats).some((gap) => gap > 0.4));
  const result = edit({ times: beats, bars }, { steady: true, tempo: 0.5 });
  // The song's beat, every 0.46 s (130 BPM), and a bar of 4 of them.
  for (const gap of gaps(result.times)) close(gap, 0.46, 0.03);
  for (const gap of gaps(result.bars)) close(gap, 1.85, 0.06);
});
