// The beat model's pipeline (src/core/resample.js, melspec.js,
// beat-this.js), checked against the Python original's output
// (tests/unit/fixtures/beat-this-golden.json, written by
// scripts/export-beat-model.py from the same test clip).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import ort from "onnxruntime-node";
import {
  beatsFromLogits,
  CHUNK,
  createWindowSpectrogram,
  framesFor,
  joinWindows,
  pickPeaks,
  windowInput,
  windowSource,
  windowStarts,
} from "../../src/core/beat-this.js";
import { createLogMelSpectrogram, MEL_RATE, melFilterbank } from "../../src/core/melspec.js";
import { createResampler } from "../../src/core/resample.js";

const golden = JSON.parse(readFileSync(new URL("./fixtures/beat-this-golden.json", import.meta.url), "utf8"));
const floats = (base64) => {
  const bytes = Buffer.from(base64, "base64");
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
};

// The test clip, as export-beat-model.py's clip() makes it (see there).
export function testClip(rate, seconds = 32) {
  const n = Math.round(seconds * rate);
  const out = new Float64Array(n);
  const chords = [
    [220.0, 261.63, 329.63],
    [174.61, 220.0, 261.63],
    [261.63, 329.63, 392.0],
    [196.0, 246.94, 293.66],
  ];
  for (let beat = 0.5, k = 0; beat < seconds; beat += 0.5, k++) {
    const accent = k % 4 === 0;
    const freq = accent ? 2000 : 1000;
    const level = accent ? 0.6 : 0.35;
    // Each click is negligible after 3 s (e^−36).
    for (let i = 0; i < n; i++) {
      const since = i / rate - beat;
      if (since < 0) continue;
      if (since > 3) break;
      out[i] += level * Math.sin(2 * Math.PI * freq * since) * Math.exp(-since * 60);
      if (accent) out[i] += 0.5 * Math.sin(2 * Math.PI * 60 * since) * Math.exp(-since * 12);
    }
  }
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      const bar = Math.floor(Math.max(t - 0.5, 0) / 2) % 4;
      out[i] += 0.04 * Math.sin(2 * Math.PI * chords[bar][c] * t);
    }
  }
  return Float32Array.from(out);
}

function spectrogramOf(samples, chunk = 4096) {
  const mel = createLogMelSpectrogram();
  for (let at = 0; at < samples.length; at += chunk) mel.push(samples.subarray(at, at + chunk));
  return mel.finish();
}

function worstDifference(a, b) {
  let worst = 0;
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
  return worst;
}

describe("the log-mel spectrogram", () => {
  test("the mel filterbank is torchaudio's", () => {
    const expected = floats(golden.melFilterbank);
    const worst = worstDifference(melFilterbank(), expected);
    assert.ok(worst < 1e-4, `worst difference ${worst}`); // torchaudio works in float32
  });

  test("matches the original's at 22,050 Hz", () => {
    const { frames, data } = spectrogramOf(testClip(MEL_RATE));
    const { at22050 } = golden;
    assert.equal(frames, at22050.frames);
    const head = floats(at22050.spectHead);
    const tail = floats(at22050.spectTail);
    const headWorst = worstDifference(data.subarray(0, head.length), head);
    const tailWorst = worstDifference(data.subarray(data.length - tail.length), tail);
    assert.ok(headWorst < 1e-3 && tailWorst < 1e-3, `worst difference ${headWorst} (start), ${tailWorst} (end)`);
  });

  test("doesn't depend on how the samples are chunked", () => {
    const samples = testClip(MEL_RATE, 3);
    const whole = spectrogramOf(samples, samples.length);
    const pieces = spectrogramOf(samples, 333);
    assert.equal(pieces.frames, whole.frames);
    assert.ok(worstDifference(pieces.data, whole.data) === 0);
  });

  test("half a window or less is too short", () => {
    assert.equal(spectrogramOf(new Float32Array(512)).frames, 0);
    assert.equal(spectrogramOf(new Float32Array(513)).frames, 2);
  });
});

// The model, run as electron/beat-model-process.js runs it.
const MODEL = new URL("../../models/beat-this-small.onnx", import.meta.url);
async function runModel(spect, frames, order) {
  const session = await ort.InferenceSession.create(readFileSync(MODEL), { intraOpNumThreads: 4 });
  const starts = windowStarts(frames);
  const windows = [];
  for (const index of order ?? starts.keys()) {
    const { input, length } = windowInput(spect, frames, starts[index]);
    const out = await session.run({ spect: new ort.Tensor("float32", input, [1, CHUNK, 128]) });
    windows[index] = { start: starts[index], length, beat: out.beat.data, downbeat: out.downbeat.data };
  }
  return joinWindows(windows, frames);
}

describe("the model's windows", () => {
  test("as split_piece cuts them", () => {
    assert.deepEqual(windowStarts(100), [-6]);
    assert.deepEqual(windowStarts(1488), [-6]);
    assert.deepEqual(windowStarts(1489), [-6, -5]);
    assert.deepEqual(windowStarts(1601), [-6, 107]);
    assert.deepEqual(windowStarts(4000), [-6, 1482, 2506]);
    assert.deepEqual(windowStarts(0), []);
  });

  test("a window's input: the frames, with zeros around them", () => {
    const frames = 10;
    const spect = Float32Array.from({ length: frames * 128 }, (_, i) => 1 + Math.floor(i / 128));
    const { input, length } = windowInput(spect, frames, -6);
    assert.equal(length, 6 + 10 + 6);
    assert.equal(input[5 * 128], 0);
    assert.equal(input[6 * 128], 1);
    assert.equal(input[15 * 128 + 127], 10);
    assert.equal(input[16 * 128], 0);
  });

  test("joining keeps the earlier window where they overlap, without borders", () => {
    const ones = new Float32Array(CHUNK).fill(1);
    const twos = new Float32Array(CHUNK).fill(2);
    const frames = 1601;
    const { beat } = joinWindows(
      [
        { start: -6, length: CHUNK, beat: ones, downbeat: ones },
        { start: 107, length: CHUNK, beat: twos, downbeat: twos },
      ],
      frames,
    );
    assert.equal(beat[0], 1);
    assert.equal(beat[1487], 1);
    assert.equal(beat[1488], 2);
    assert.equal(beat[1600], 2);
    // Only the first window: the rest is "certainly not".
    const partial = joinWindows([{ start: -6, length: CHUNK, beat: ones, downbeat: ones }], frames).beat;
    assert.equal(partial[1500], -1000);
  });
});

describe("picking the beats", () => {
  test("the highest within 3 frames, above 0", () => {
    const logits = Float32Array.from([-1, 2, 1, 0.5, -1, -1, -1, 3, -1, -1, -1, -1, -2]);
    assert.deepEqual(pickPeaks(logits), [1, 7]);
  });

  test("neighbouring equal peaks become their mean, as the original does it", () => {
    const logits = Float32Array.from([-1, 2, 2, -1, -1, -1, -1, -1, -1, 1, 1, 1, -1]);
    // 9 and 10 merge to 9.5; 11 is then 1.5 from that running mean, so it
    // stays on its own (deduplicate_peaks compares with the mean so far).
    assert.deepEqual(pickPeaks(logits), [1.5, 9.5, 11]);
  });

  test("nothing above 0, no beats", () => {
    assert.deepEqual(pickPeaks(new Float32Array(20).fill(-3)), []);
  });

  test("downbeats move onto the nearest beat, once each", () => {
    const beat = new Float32Array(200).fill(-5);
    const downbeat = new Float32Array(200).fill(-5);
    for (const frame of [10, 35, 60, 85, 110]) beat[frame] = 3;
    downbeat[12] = 2; // → beat 10
    downbeat[108] = 2; // → beat 110
    downbeat[113] = 1; // → beat 110 too, counted once (though not a separate peak: within 3 frames is one)
    const { beats, downbeats } = beatsFromLogits(beat, downbeat);
    assert.deepEqual([...beats], [0.2, 0.7, 1.2, 1.7, 2.2]);
    assert.deepEqual([...downbeats], [0.2, 2.2]);
  });
});

describe("the model", () => {
  test("gives the original's logits and beats (22,050 Hz test clip)", async () => {
    const { frames, data } = spectrogramOf(testClip(MEL_RATE));
    const { beat, downbeat } = await runModel(data, frames);
    const { at22050 } = golden;
    const beatWorst = worstDifference(beat, floats(at22050.beatLogits));
    const downbeatWorst = worstDifference(downbeat, floats(at22050.downbeatLogits));
    assert.ok(beatWorst < 1e-2 && downbeatWorst < 1e-2, `worst logit difference ${beatWorst}, ${downbeatWorst}`);
    const { beats, downbeats } = beatsFromLogits(beat, downbeat);
    assert.deepEqual([...beats], at22050.beats);
    assert.deepEqual([...downbeats], at22050.downbeats);
  });

  test("windows run in any order give the same result", async () => {
    const { frames, data } = spectrogramOf(testClip(MEL_RATE));
    const inOrder = await runModel(data, frames);
    const reversed = await runModel(data, frames, [1, 0]);
    assert.deepEqual(reversed.beat, inOrder.beat);
  });
});

describe("resampling", () => {
  function resample(samples, from, to, chunk = 5000) {
    const resampler = createResampler(from, to);
    const parts = [];
    for (let at = 0; at < samples.length; at += chunk) {
      resampler.push(samples.subarray(at, at + chunk));
      parts.push(resampler.take());
    }
    resampler.finish();
    parts.push(resampler.take());
    const out = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
    parts.reduce((at, part) => (out.set(part, at), at + part.length), 0);
    return out;
  }
  const sine = (rate, hz, seconds) =>
    Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => Math.sin((2 * Math.PI * hz * i) / rate));

  for (const from of [44100, 48000, 32000, 96000, 16000]) {
    test(`${from} Hz → 22,050 Hz keeps a 1 kHz sine and the length`, () => {
      const out = resample(sine(from, 1000, 1), from, MEL_RATE);
      assert.equal(out.length, Math.ceil((from * 1 * MEL_RATE) / from));
      const expected = sine(MEL_RATE, 1000, 1);
      // Away from the edges, where the filter sees the silence around it.
      const worst = worstDifference(out.subarray(200, -200), expected.subarray(200, -200));
      assert.ok(worst < 2e-3, `worst difference ${worst}`);
    });
  }

  test("removes what's above the new Nyquist frequency", () => {
    const out = resample(sine(44100, 15000, 1), 44100, MEL_RATE);
    const peak = Math.max(...out.subarray(200, -200).map(Math.abs));
    assert.ok(peak < 1e-3, `peak ${peak}`);
  });

  test("passes 22,050 Hz through unchanged", () => {
    const samples = sine(MEL_RATE, 440, 0.5);
    assert.deepEqual(resample(samples, MEL_RATE, MEL_RATE), samples);
  });

  test("doesn't depend on how the samples are chunked", () => {
    const samples = testClip(44100, 2);
    assert.deepEqual(resample(samples, 44100, MEL_RATE, 777), resample(samples, 44100, MEL_RATE, 100000));
  });

  test("at 44,100 Hz the beats are the original's (resampled by soxr) within a frame", async () => {
    const { frames, data } = spectrogramOf(resample(testClip(44100), 44100, MEL_RATE));
    const { beats, downbeats } = beatsFromLogits(...Object.values(await runModel(data, frames)));
    const { at44100 } = golden;
    assert.equal(beats.length, at44100.beats.length);
    assert.ok(
      at44100.beats.every((time, i) => Math.abs(beats[i] - time) <= 0.02),
      String([...beats]),
    );
    assert.deepEqual(downbeats.length, at44100.downbeats.length);
  });

  test("at 44,100 Hz the spectrogram is close to the original's (soxr)", () => {
    const { frames, data } = spectrogramOf(resample(testClip(44100), 44100, MEL_RATE));
    const { at44100 } = golden;
    assert.equal(frames, at44100.frames);
    const head = floats(at44100.spectHead);
    let total = 0;
    let worst = 0;
    for (let i = 0; i < head.length; i++) {
      const difference = Math.abs(data[i] - head[i]);
      total += difference;
      worst = Math.max(worst, difference);
    }
    const mean = total / head.length;
    // Only the top bands, by the cut-off, differ at all.
    assert.ok(mean < 1e-3 && worst < 0.15, `mean difference ${mean}, worst ${worst}`);
  });
});

describe("one window alone (as audio/beat-worker.js prepares them)", () => {
  // Noise with a click every half second: quick to make at any length.
  function noiseWithClicks(rate, seconds) {
    const out = new Float32Array(Math.round(rate * seconds));
    let state = 1;
    const period = Math.round(rate / 2);
    for (let i = 0; i < out.length; i++) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      const since = i % period;
      out[i] = ((state >>> 0) / 2 ** 32 - 0.5) * 0.2 + (since < 400 ? 0.8 * Math.exp(-since / 60) : 0);
    }
    return out;
  }
  function wholeTrack(samples, rate) {
    const resampler = createResampler(rate, MEL_RATE);
    const mel = createLogMelSpectrogram();
    for (let at = 0; at < samples.length; at += 4096) {
      resampler.push(samples.subarray(at, at + 4096));
      mel.push(resampler.take());
    }
    resampler.finish();
    mel.push(resampler.take());
    return mel.finish();
  }
  function window(samples, rate, frames, start, chunk = 1152) {
    const source = windowSource(start, frames, rate);
    const spectrogram = createWindowSpectrogram(source, rate);
    // A little past the end it needs, as a decoder gives whole chunks.
    const end = Math.min(samples.length, source.inTo + 3000);
    for (let at = source.inFrom; at < end; at += chunk)
      spectrogram.push(samples.subarray(at, Math.min(at + chunk, end)));
    return { source, spect: spectrogram.finish() };
  }

  for (const [rate, seconds] of [
    [44100, 75],
    [48000, 75],
    [MEL_RATE, 75],
    [44100, 20],
  ]) {
    test(`every window of ${seconds} s at ${rate} Hz is the whole track's frames`, () => {
      const samples = noiseWithClicks(rate, seconds);
      const whole = wholeTrack(samples, rate);
      const frames = framesFor(samples.length, rate);
      assert.equal(frames, whole.frames);
      for (const start of windowStarts(frames)) {
        const { source, spect } = window(samples, rate, frames, start, start % 2 ? 1152 : 1024);
        const expected = whole.data.subarray(source.from * 128, source.to * 128);
        assert.equal(spect.length, expected.length, `window at ${start}`);
        assert.ok(worstDifference(spect, expected) <= 1e-6, `window at ${start}: ${worstDifference(spect, expected)}`);
        assert.deepEqual(
          windowInput(spect, frames, start, source.from),
          windowInput(whole.data, frames, start),
          `window at ${start}`,
        );
      }
    });
  }

  test("framesFor counts the whole track's frames, before decoding", () => {
    for (const rate of [44100, 48000, MEL_RATE, 32000]) {
      for (const seconds of [0, 0.01, 0.024, 0.03, 1, 3.7, 10.02]) {
        const samples = noiseWithClicks(rate, seconds);
        assert.equal(framesFor(samples.length, rate), wholeTrack(samples, rate).frames, `${seconds} s at ${rate} Hz`);
      }
    }
  });
});
