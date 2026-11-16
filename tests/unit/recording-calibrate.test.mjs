// src/features/recording/calibrate.js: the delay the system doesn't
// report, from where clicks played at known times turn up in a recording.
import assert from "node:assert/strict";
import { test } from "node:test";
import { clickDelay } from "../../src/features/recording/calibrate.js";

const options = { before: 0.1, after: 0.3, onset: 0.3, floor: 0.001, overNoise: 8, agree: 0.005 };
const sampleRate = 48000;
const times = [1, 1.4, 1.8, 2.2, 2.6, 3, 3.4, 3.8];

// Five seconds from clock time 0.5: a little noise, and a short decaying tone at each of `at`.
function recorded(at, level = 0.5) {
  const samples = new Float32Array(5 * sampleRate);
  let seed = 1;
  for (let i = 0; i < samples.length; i++) {
    seed = (seed * 16807) % 2147483647;
    samples[i] = (seed / 2147483647 - 0.5) * 0.002;
  }
  for (const when of at) {
    const start = Math.round((when - 0.5) * sampleRate);
    for (let i = 0; i < 2000; i++)
      samples[start + i] += level * Math.cos((i * 2 * Math.PI * 1500) / sampleRate) * 0.997 ** i;
  }
  return { samples, sampleRate, time: 0.5 };
}

test("clicks that come in late give that delay", () => {
  const result = clickDelay(recorded(times.map((at) => at + 0.037)), times, options);
  assert.equal(result.found, 8);
  assert.ok(Math.abs(result.delay - 0.037) < 0.0005, String(result.delay));
  assert.ok(result.spread < 0.0005);
});

test("clicks that come in early (the system reported too much) give a delay below 0", () => {
  const result = clickDelay(recorded(times.map((at) => at - 0.02)), times, options);
  assert.ok(Math.abs(result.delay + 0.02) < 0.0005, String(result.delay));
});

test("quiet clicks are still found", () => {
  const result = clickDelay(
    recorded(
      times.map((at) => at + 0.05),
      0.03,
    ),
    times,
    options,
  );
  assert.ok(Math.abs(result.delay - 0.05) < 0.0005, String(result.delay));
});

test("a few clicks lost or out of place don't change the answer", () => {
  const heard = times.map((at) => at + 0.037);
  heard[2] += 0.08; // something else made a noise
  heard.splice(5, 1);
  const result = clickDelay(recorded(heard), times, options);
  assert.equal(result.found, 6);
  assert.ok(Math.abs(result.delay - 0.037) < 0.0005);
});

test("no clicks in the recording: no answer", () => {
  assert.equal(clickDelay(recorded([]), times, options), null);
});

test("clicks that don't agree with each other: no answer", () => {
  const heard = times.map((at, i) => at + 0.02 * i);
  assert.equal(clickDelay(recorded(heard), times, options), null);
});
