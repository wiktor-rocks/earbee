// src/features/recording/takes.js: a recording cut into takes, one per
// pass around the loop, and where a take plays when the track does.
import assert from "node:assert/strict";
import { test } from "node:test";
import { cutTakes, passes, planChunk, takeOffset } from "../../src/features/recording/takes.js";

const near = (actual, expected, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not ${expected}`);

// A recording whose every sample is its own index, so a take's samples say
// where they came from.
const ramp = (seconds, sampleRate) => Float32Array.from({ length: seconds * sampleRate }, (_, i) => i);

test("without a loop a recording is one pass, from where it began", () => {
  const found = passes({ time: 10, position: 30, rate: 1 }, 14, null, 200);
  assert.deepEqual(found, [{ from: 10, to: 14, start: 30, end: 34 }]);
});

test("a pass ends at the track's end", () => {
  const found = passes({ time: 10, position: 198, rate: 1 }, 20, null, 200);
  assert.deepEqual(found, [{ from: 10, to: 12, start: 198, end: 200 }]);
});

test("each time around the loop is a pass; the first runs up to the loop's end", () => {
  const found = passes({ time: 0, position: 8, rate: 1 }, 9, { start: 10, end: 14 }, 200);
  assert.deepEqual(found, [
    { from: 0, to: 6, start: 8, end: 14 },
    { from: 6, to: 9, start: 10, end: 13 },
  ]);
});

test("slowed down, a pass takes longer on the clock", () => {
  const found = passes({ time: 0, position: 10, rate: 0.5 }, 20, { start: 10, end: 14 }, 200);
  assert.deepEqual(found, [
    { from: 0, to: 8, start: 10, end: 14 },
    { from: 8, to: 16, start: 10, end: 14 },
    { from: 16, to: 20, start: 10, end: 12 },
  ]);
});

test("a loop behind the position doesn't catch playback", () => {
  const found = passes({ time: 0, position: 20, rate: 1 }, 5, { start: 10, end: 14 }, 200);
  assert.deepEqual(found, [{ from: 0, to: 5, start: 20, end: 25 }]);
});

test("a take holds its pass's samples, with the margin around it", () => {
  const sampleRate = 1000;
  const recording = { samples: ramp(10, sampleRate), sampleRate, time: 100 };
  const found = passes({ time: 102, position: 10, rate: 1 }, 110, { start: 10, end: 14 }, 200);
  const takes = cutTakes(recording, found, { rate: 1, margin: 0.2, minSeconds: 0.5 });
  assert.equal(takes.length, 2);

  const [first, second] = takes;
  near(first.start, 10);
  near(first.end, 14);
  assert.equal(first.lead, 200);
  assert.equal(first.samples[first.lead], 2000); // the sample at clock 102
  assert.equal(first.samples.length, 200 + 4000 + 200);
  near(second.start, 10);
  assert.equal(second.samples[second.lead], 6000);
});

test("a recording that starts after the pass does gives a take that starts later on the track", () => {
  const sampleRate = 1000;
  const recording = { samples: ramp(5, sampleRate), sampleRate, time: 101 };
  const found = passes({ time: 100, position: 30, rate: 0.5 }, 106, null, 200);
  const [take] = cutTakes(recording, found, { rate: 0.5, margin: 0.2, minSeconds: 0.5 });
  near(take.start, 30.5); // one second on the clock, at half speed
  near(take.end, 33);
  assert.equal(take.lead, 0);
  assert.equal(take.samples[0], 0);
});

test("a pass too short to be a take is left out", () => {
  const sampleRate = 1000;
  const recording = { samples: ramp(10, sampleRate), sampleRate, time: 0 };
  const found = passes({ time: 0, position: 13.7, rate: 1 }, 4.5, { start: 10, end: 14 }, 200);
  const takes = cutTakes(recording, found, { rate: 1, margin: 0.2, minSeconds: 0.5 });
  assert.equal(takes.length, 1); // 0.3 s up to the loop's end, one pass, then 0.2 s
  near(takes[0].start, 10);
});

const take = { start: 10, end: 14, rate: 1, sampleRate: 1000, lead: 200, gain: 1, samples: new Float32Array(4400) };

test("a position's place in a take allows for the lead, the speed and the nudge", () => {
  near(takeOffset(take, 10, 0), 0.2);
  near(takeOffset(take, 12, 0), 2.2);
  near(takeOffset(take, 12, 0.03), 2.23);
  near(takeOffset({ ...take, rate: 0.5 }, 12, 0), 4.2);
});

test("from before a take, it starts when the track gets to it", () => {
  const plan = planChunk(take, { time: 50, position: 7, loop: null, duration: 200, nudge: 0 });
  near(plan.source.when, 53);
  near(plan.source.offset, 0.2);
  near(plan.source.length, 4);
  assert.equal(plan.next, null);
  near(plan.until, 243);
});

test("from inside a take, it starts part way in, at once", () => {
  const plan = planChunk(take, { time: 50, position: 11, loop: null, duration: 200, nudge: 0 });
  near(plan.source.when, 50);
  near(plan.source.offset, 1.2);
  near(plan.source.length, 3);
});

test("in a loop, a chunk ends at the loop's end and the next starts at its start", () => {
  const loop = { start: 11, end: 13 };
  const plan = planChunk(take, { time: 50, position: 12, loop, duration: 200, nudge: 0 });
  near(plan.source.length, 1);
  near(plan.until, 51);
  assert.equal(plan.next, 11);
});

test("where the track has nothing of the take, nothing plays", () => {
  const plan = planChunk(take, { time: 50, position: 20, loop: null, duration: 200, nudge: 0 });
  assert.equal(plan.source, null);
  const looped = planChunk(take, { time: 50, position: 30, loop: { start: 30, end: 34 }, duration: 200, nudge: 0 });
  assert.equal(looped.source, null);
  near(looped.until, 54);
  assert.equal(looped.next, 30);
});

test("a nudge beyond the margin plays what there is, later", () => {
  const plan = planChunk(take, { time: 50, position: 10, loop: null, duration: 200, nudge: -0.5 });
  near(plan.source.offset, 0);
  near(plan.source.when, 50.3);
  near(plan.source.length, 3.7);
});

test("a slowed take plays for as long as it took", () => {
  const slow = { ...take, rate: 0.5, samples: new Float32Array(8400) };
  const plan = planChunk(slow, { time: 50, position: 9, loop: null, duration: 200, nudge: 0 });
  near(plan.source.when, 52);
  near(plan.source.length, 8);
});
