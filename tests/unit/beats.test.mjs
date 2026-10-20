// Finding the beats (src/core/beats.js): the onset envelope, the tempo,
// the beat tracker, and stepping by beats.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  barBeatAt,
  beatClockTimes,
  beatStep,
  gridTime,
  moveLoop,
  onGrid,
  resizeLoop,
  snapTo,
  spanAt,
  createOnsetDetector,
  detectBeats,
  stepSizes,
  visibleBeats,
} from "../../src/core/beats.js";
import { createFft, createSpectrum } from "../../src/core/fft.js";

const RATE = 44100;

// A pseudo-random number generator, so the noise is the same every run.
function random(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

// `seconds` of quiet noise with a click (a 10 ms burst of decaying
// noise) at each of `clicks` (seconds).
function clickTrack(seconds, clicks, seed = 1) {
  const next = random(seed);
  const samples = Float32Array.from({ length: Math.round(seconds * RATE) }, () => (next() - 0.5) * 0.002);
  const length = Math.round(0.01 * RATE);
  for (const time of clicks) {
    const at = Math.round(time * RATE);
    for (let i = 0; i < length && at + i < samples.length; i++) {
      samples[at + i] += (next() - 0.5) * 1.6 * Math.exp(-i / (length / 4));
    }
  }
  return samples;
}

// Click times from `start` with the gap between them going from 60 / fromBpm to 60 / toBpm.
function clicksAt(seconds, fromBpm, toBpm = fromBpm, start = 0.25) {
  const times = [];
  for (let time = start; time < seconds - 0.1;) {
    times.push(time);
    const bpm = fromBpm + ((toBpm - fromBpm) * time) / seconds;
    time += 60 / bpm;
  }
  return times;
}

function envelopeOf(samples, chunk = 4096) {
  const detector = createOnsetDetector(RATE);
  for (let at = 0; at < samples.length; at += chunk) detector.push(samples.subarray(at, at + chunk));
  return detector.finish();
}

// How far each click is from the nearest beat, for the clicks inside the beats' span.
function misses(beats, clicks) {
  return clicks
    .filter((time) => time >= beats[0] - 0.05 && time <= beats.at(-1) + 0.05)
    .map((time) => Math.min(...Array.from(beats, (beat) => Math.abs(beat - time))));
}

describe("the FFT", () => {
  test("a cosine lands in its bin", () => {
    const n = 64;
    const re = Float64Array.from({ length: n }, (_, i) => Math.cos((2 * Math.PI * 5 * i) / n));
    const im = new Float64Array(n);
    createFft(n)(re, im);
    const magnitudes = Array.from(re, (value, k) => Math.hypot(value, im[k]));
    assert.ok(Math.abs(magnitudes[5] - n / 2) < 1e-9);
    assert.ok(Math.abs(magnitudes[n - 5] - n / 2) < 1e-9);
    assert.ok(magnitudes.every((value, k) => k === 5 || k === n - 5 || value < 1e-9));
  });
});

describe("the real spectrum", () => {
  test("matches the complex FFT", () => {
    const n = 256;
    const next = random(5);
    const samples = Float64Array.from({ length: n }, () => next() - 0.5);
    const re = Float64Array.from(samples);
    const im = new Float64Array(n);
    createFft(n)(re, im);
    const out = new Float64Array(n / 2 + 1);
    createSpectrum(n, n / 2 + 1)(samples, out);
    out.forEach((value, k) => assert.ok(Math.abs(value - Math.hypot(re[k], im[k])) < 1e-9, `bin ${k}`));
  });
});

describe("the onset envelope", () => {
  test("peaks at the clicks", () => {
    const clicks = [1, 2, 3];
    const { envelope, frameRate } = envelopeOf(clickTrack(4, clicks));
    for (const time of clicks) {
      const around = envelope.subarray(Math.round((time - 0.2) * frameRate), Math.round((time + 0.2) * frameRate));
      const peak = around.indexOf(Math.max(...around)) + Math.round((time - 0.2) * frameRate);
      assert.ok(Math.abs(peak / frameRate - time) < 0.015, `peak at ${peak / frameRate}, click at ${time}`);
    }
  });

  test("doesn't depend on how the samples are chunked", () => {
    const samples = clickTrack(3, [0.5, 1.5, 2.5]);
    const whole = envelopeOf(samples, samples.length).envelope;
    const pieces = envelopeOf(samples, 777).envelope;
    assert.equal(pieces.length, whole.length);
    assert.ok(pieces.every((value, i) => Math.abs(value - whole[i]) < 1e-6));
  });

  test("one frame per hop", () => {
    const { envelope, frameRate } = envelopeOf(new Float32Array(RATE * 2));
    assert.ok(Math.abs(envelope.length - 2 * frameRate) <= 2, String(envelope.length));
  });
});

describe("detecting the beats", () => {
  test("a steady 120 BPM click track", () => {
    const clicks = clicksAt(30, 120);
    const { envelope, frameRate } = envelopeOf(clickTrack(30, clicks));
    const { beats, bpm } = detectBeats(envelope, frameRate);
    assert.ok(Math.abs(bpm - 120) < 1, `bpm ${bpm}`);
    assert.ok(beats.length >= clicks.length - 4, `${beats.length} beats for ${clicks.length} clicks`);
    const worst = Math.max(...misses(beats, clicks));
    assert.ok(worst < 0.015, `a click ${worst} s from its beat`);
  });

  test("90 BPM isn't read as 180 or 45", () => {
    const clicks = clicksAt(30, 90);
    const { envelope, frameRate } = envelopeOf(clickTrack(30, clicks, 7));
    const { bpm } = detectBeats(envelope, frameRate);
    assert.ok(Math.abs(bpm - 90) < 1, `bpm ${bpm}`);
  });

  test("follows a tempo that speeds up from 100 to 110 BPM", () => {
    const clicks = clicksAt(40, 100, 110);
    const { envelope, frameRate } = envelopeOf(clickTrack(40, clicks, 3));
    const { beats } = detectBeats(envelope, frameRate);
    assert.ok(beats.length >= clicks.length - 4, `${beats.length} beats for ${clicks.length} clicks`);
    const worst = Math.max(...misses(beats, clicks));
    assert.ok(worst < 0.02, `a click ${worst} s from its beat`);
  });

  test("white noise or a steady tone has no beats", () => {
    const next = random(11);
    const noise = Float32Array.from({ length: RATE * 20 }, () => (next() - 0.5) * 0.6);
    const tone = Float32Array.from({ length: RATE * 10 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / RATE));
    for (const samples of [noise, tone]) {
      const { envelope, frameRate } = envelopeOf(samples);
      assert.equal(detectBeats(envelope, frameRate).bpm, null);
    }
  });

  test("silence has no beats", () => {
    const { envelope, frameRate } = envelopeOf(new Float32Array(RATE * 5));
    assert.deepEqual(detectBeats(envelope, frameRate), { beats: new Float64Array(0), bpm: null });
  });

  test("a track too short for a beat has none", () => {
    const { envelope, frameRate } = envelopeOf(clickTrack(0.3, [0.1]));
    assert.equal(detectBeats(envelope, frameRate).bpm, null);
  });
});

describe("using the beats", () => {
  const beats = Float64Array.from([1, 1.5, 2, 2.5]);

  test("the visible ones", () => {
    assert.deepEqual(visibleBeats(beats, 1.5, 2.2), { from: 1, to: 3 });
    assert.deepEqual(visibleBeats(beats, 0, 0.5), { from: 0, to: 0 });
    assert.deepEqual(visibleBeats(beats, 3, 4), { from: 4, to: 4 });
    assert.deepEqual(visibleBeats(beats, 0, 10), { from: 0, to: 4 });
    assert.deepEqual(visibleBeats(new Float64Array(0), 0, 10), { from: 0, to: 0 });
  });

  test("the bar and beat at a time", () => {
    // A beat before the first bar (a pickup), then bars of two beats.
    const times = Float64Array.from([0.5, 1, 1.5, 2, 2.5]);
    const bars = Float64Array.from([1, 2]);
    assert.equal(barBeatAt(bars, times, 0.7), null, "before the first bar");
    assert.deepEqual(barBeatAt(bars, times, 1), { bar: 1, beat: 1 });
    assert.deepEqual(barBeatAt(bars, times, 1.7), { bar: 1, beat: 2 });
    assert.deepEqual(barBeatAt(bars, times, 1.9999), { bar: 2, beat: 1 }, "just before a bar counts as on it");
    assert.deepEqual(barBeatAt(bars, times, 3), { bar: 2, beat: 2 });
    assert.equal(barBeatAt(null, times, 1.5), null, "no bars (the simple finder)");
  });

  test("a step goes to the next or previous beat", () => {
    assert.equal(beatStep(beats, 1.2, 1, 0.5), 1.5);
    assert.equal(beatStep(beats, 1.2, -1, 0.5), 1);
  });

  test("from on a beat, or just after one, a step goes on to the next", () => {
    assert.equal(beatStep(beats, 1.5, 1, 0.5), 2);
    assert.equal(beatStep(beats, 1.5, -1, 0.5), 1);
    assert.equal(beatStep(beats, 1.52, -1, 0.5), 1);
    assert.equal(beatStep(beats, 1.48, 1, 0.5), 2);
  });

  test("before the first beat or after the last, a step is one average beat", () => {
    assert.equal(beatStep(beats, 0.2, 1, 0.5), 1);
    assert.ok(Math.abs(beatStep(beats, 0.8, -1, 0.5) - 0.3) < 1e-12);
    assert.equal(beatStep(beats, 2.5, 1, 0.5), 3);
    assert.equal(beatStep(beats, 3, -1, 0.5), 2.5);
  });

  test("when the beats play on the clock, at any speed", () => {
    const times = (span) => beatClockTimes(beats, span).map(({ time }) => time);
    assert.deepEqual(times({ t0: 10, t1: 11, from: 1.2, to: 2.2, rate: 1 }), [10.3, 10.8]);
    assert.deepEqual(times({ t0: 10, t1: 12, from: 1.2, to: 2.2, rate: 0.5 }), [10.6, 11.6]);
    assert.deepEqual(
      beatClockTimes(beats, { t0: 10, t1: 11, from: 1.2, to: 2.2, rate: 1 }).map(({ index }) => index),
      [1, 2],
    );
  });

  test("back-to-back spans give each beat once", () => {
    const first = beatClockTimes(beats, { t0: 0, t1: 0.5, from: 1, to: 1.5, rate: 1 });
    const second = beatClockTimes(beats, { t0: 0.5, t1: 1, from: 1.5, to: 2, rate: 1 });
    assert.deepEqual(
      [...first, ...second].map(({ time }) => time),
      [0, 0.5],
    );
  });

  test("a span where the loop wraps gives the beats on both sides", () => {
    const loop = { start: 1, end: 2.25 };
    // From 2.0 to the loop end (2.25), then from 1.0 to 1.25: half a second.
    const times = beatClockTimes(beats, { t0: 5, t1: 5.5, from: 2, to: 1.25, rate: 1, loop });
    assert.deepEqual(
      times.map(({ time, index }) => [time, index]),
      [
        [5, 2],
        [5.25, 0],
      ],
    );
  });

  test("the step sizes have 'beat' by its length", () => {
    const sizes = [0.1, 0.25, 0.5, 1];
    assert.deepEqual(stepSizes(sizes, { beat: 0.4 }), [0.1, 0.25, "beat", 0.5, 1]);
    assert.deepEqual(stepSizes(sizes, { beat: 0.05 }), ["beat", 0.1, 0.25, 0.5, 1]);
    assert.deepEqual(stepSizes(sizes, { beat: 2 }), [0.1, 0.25, 0.5, 1, "beat"]);
    assert.deepEqual(stepSizes(sizes, { beat: null }), sizes);
    assert.deepEqual(stepSizes(sizes, {}), sizes);
  });

  test("…and 'bar' by its length", () => {
    const sizes = [0.1, 0.25, 0.5, 1, 2, 5];
    assert.deepEqual(stepSizes(sizes, { beat: 0.5, bar: 2 }), [0.1, 0.25, 0.5, "beat", 1, 2, "bar", 5]);
    assert.deepEqual(stepSizes(sizes, { beat: 0.4, bar: null }), [0.1, 0.25, "beat", 0.5, 1, 2, 5]);
  });
});

describe("snapping, and loops on the beat grid", () => {
  // 120 BPM from 1 s, 4 beats to the bar.
  const beats = Float64Array.from({ length: 16 }, (_, i) => 1 + i * 0.5);
  const bars = Float64Array.from({ length: 4 }, (_, i) => 1 + i * 2);
  const grids = { beats, beatLength: 0.5, bars, barLength: 2 };
  const limits = { duration: 20, minSeconds: 0.05 };
  const close = (span, start, end) =>
    span !== null && Math.abs(span.start - start) < 1e-9 && Math.abs(span.end - end) < 1e-9;

  test("snapping: only when close", () => {
    assert.equal(snapTo(beats, 2.08, 0.1), 2);
    assert.equal(snapTo(beats, 2.3, 0.1), 2.3);
    assert.equal(snapTo(beats, 2.45, 0.1), 2.5);
    assert.equal(snapTo(beats, 0.95, 0.1), 1);
    assert.equal(snapTo(null, 2.08, 0.1), 2.08);
    assert.equal(snapTo(beats, 2.08, 0), 2.08);
  });

  test("the grid goes on past its ends", () => {
    assert.equal(gridTime(bars, 0, 2), 1);
    assert.equal(gridTime(bars, 3, 2), 7);
    assert.equal(gridTime(bars, 5, 2), 11);
    assert.equal(gridTime(bars, -1, 2), -1);
  });

  test("the bar a time is in: inside, the pickup, past the last", () => {
    assert.deepEqual(spanAt(bars, 4.1, 2, 20), { start: 3, end: 5 });
    assert.deepEqual(spanAt(bars, 3, 2, 20), { start: 3, end: 5 });
    assert.deepEqual(spanAt(bars, 0.4, 2, 20), { start: 0, end: 1 });
    assert.deepEqual(spanAt(bars, 8, 2, 20), { start: 7, end: 9 });
    assert.deepEqual(spanAt(bars, 19.5, 2, 20), { start: 19, end: 20 });
  });

  test("whether a loop lies on the grid", () => {
    assert.deepEqual(onGrid(bars, 3.01, 6.98, 2, 0.03), { from: 1, to: 3 });
    assert.equal(onGrid(bars, 3.2, 7, 2, 0.03), null);
    assert.deepEqual(onGrid(bars, 7, 11, 2, 0.03), { from: 3, to: 5 });
  });

  test("doubling and halving by bars, then beats, then time", () => {
    const bar = { start: 3, end: 5 };
    assert.ok(close(resizeLoop(grids, bar, 2, limits), 3, 7));
    assert.ok(close(resizeLoop(grids, { start: 3, end: 7 }, 0.5, limits), 3, 5));
    // One bar halves to two of its four beats; one beat halves by time.
    assert.ok(close(resizeLoop(grids, bar, 0.5, limits), 3, 4));
    assert.ok(close(resizeLoop(grids, { start: 3, end: 3.5 }, 0.5, limits), 3, 3.25));
    // Three bars halve to one.
    assert.ok(close(resizeLoop(grids, { start: 1, end: 7 }, 0.5, limits), 1, 3));
    // Off the grid: by time.
    assert.ok(close(resizeLoop(grids, { start: 3.2, end: 4.2 }, 2, limits), 3.2, 5.2));
  });

  test("doubling follows the grid as it drifts", () => {
    // Bars getting longer: 2 s, 2.2 s, 2.4 s.
    const drifting = { beats: null, beatLength: null, bars: Float64Array.from([1, 3, 5.2, 7.6]), barLength: 2.2 };
    assert.ok(close(resizeLoop(drifting, { start: 1, end: 3 }, 2, limits), 1, 5.2));
  });

  test("doubling stops at the track's end; too short is nothing", () => {
    assert.ok(close(resizeLoop(grids, { start: 15, end: 19 }, 2, limits), 15, 20));
    assert.equal(resizeLoop(grids, { start: 3.2, end: 3.26 }, 0.5, limits), null);
  });

  test("moving by the loop's own length", () => {
    assert.ok(close(moveLoop(grids, { start: 3, end: 5 }, 1, limits), 5, 7));
    assert.ok(close(moveLoop(grids, { start: 3, end: 7 }, 1, limits), 7, 11)); // past the last bar
    assert.ok(close(moveLoop(grids, { start: 3, end: 5 }, -1, limits), 1, 3));
    assert.ok(close(moveLoop(grids, { start: 3, end: 3.5 }, 1, limits), 3.5, 4)); // a beat
    assert.ok(close(moveLoop(grids, { start: 3.2, end: 4.2 }, 1, limits), 4.2, 5.2)); // off the grid
  });

  test("moving stops at the track's ends", () => {
    assert.ok(close(moveLoop(grids, { start: 1, end: 3 }, -1, limits), 0, 1));
    assert.equal(moveLoop(grids, { start: 0, end: 1 }, -1, limits), null);
    assert.ok(close(moveLoop(grids, { start: 17, end: 19 }, 1, limits), 19, 20));
    assert.equal(moveLoop(grids, { start: 19, end: 20 }, 1, limits), null);
  });
});
