// The pure helpers in src/core/.
import assert from "node:assert/strict";
import { describe, mock, test } from "node:test";
import { createEmitter } from "../../src/core/emitter.js";
import { fileExtension, isVideoFile } from "../../src/core/files.js";
import {
  clamp,
  formatEta,
  formatFrequency,
  formatGain,
  formatPitchTotal,
  formatSigned,
  formatSpeed,
  formatStepSize,
  formatTrackTime,
} from "../../src/core/format.js";
import { downsamplePeaks, peaksPerSecondFor } from "../../src/core/peaks.js";
import { timelinePositionAt } from "../../src/core/timeline.js";

describe("format", () => {
  test("track time: minutes, hours, never negative", () => {
    assert.equal(formatTrackTime(83.456), "1:23.456");
    assert.equal(formatTrackTime(3723.5), "1:02:03.500");
    assert.equal(formatTrackTime(-2), "0:00.000");
  });

  test("readouts", () => {
    assert.equal(formatGain(0), "0 dB");
    assert.equal(formatGain(1.5), "+1.5 dB");
    assert.equal(formatGain(-3), "-3 dB");
    assert.equal(formatSpeed(0.5), "0.50×");
    assert.equal(formatSigned(2, " st"), "+2 st");
    assert.equal(formatSigned(-2, " st"), "-2 st");
    assert.equal(formatPitchTotal(-0.5), "-0.50 st");
    assert.equal(formatFrequency(400), "400 Hz");
    assert.equal(formatFrequency(3000), "3 kHz");
    assert.equal(formatStepSize(0.25), "0.25");
    assert.equal(formatEta(75), "1:15");
    assert.equal(formatEta(5), "0:05");
  });

  test("clamp", () => {
    assert.equal(clamp(5, 0, 3), 3);
    assert.equal(clamp(-1, 0, 3), 0);
    assert.equal(clamp(2, 0, 3), 2);
  });
});

describe("files", () => {
  test("video by type or by extension", () => {
    const extensions = ["mp4", "webm"];
    assert.equal(fileExtension("Song.Name.MP4"), "mp4");
    assert.ok(isVideoFile({ name: "clip.MP4", type: "" }, extensions));
    assert.ok(isVideoFile({ name: "clip.bin", type: "video/quicktime" }, extensions));
    assert.ok(!isVideoFile({ name: "song.m4a", type: "audio/mp4" }, extensions));
  });
});

describe("peaks", () => {
  test("keeps the largest excursion of each block, either sign", () => {
    const samples = Float32Array.from([0.1, -0.9, 0.2, 0.5, 0.4, -0.1, 0.3]);
    assert.deepEqual(
      [...downsamplePeaks(samples, 3)].map((v) => +v.toFixed(2)),
      [-0.9, 0.5, 0.3],
    );
    assert.equal(downsamplePeaks(samples, 1), samples);
  });

  test("peaks per second stay within the limits", () => {
    const limits = { maxZoomMultiplier: 32, minPeaksPerSecond: 50, maxPeaksPerSecond: 8000 };
    assert.equal(peaksPerSecondFor(3600, 1000, limits), 50); // long track: the minimum
    assert.equal(peaksPerSecondFor(1, 4000, limits), 8000); // short track: the maximum
    assert.equal(peaksPerSecondFor(100, 1000, limits), 640); // 1000 / 100 × 32 × 2
  });
});

describe("timeline", () => {
  const playing = { outputTime: 10, input: 2, rate: 0.5, active: true };

  test("no segments: 0; before the first: its input", () => {
    assert.equal(timelinePositionAt([], 5, 60), 0);
    assert.equal(timelinePositionAt([playing], 5, 60), 2);
  });

  test("follows the latest segment that has started, at its rate", () => {
    const paused = { outputTime: 14, input: 4, rate: 1, active: false };
    assert.equal(timelinePositionAt([playing, paused], 12, 60), 3);
    assert.equal(timelinePositionAt([playing, paused], 20, 60), 4);
  });

  test("clamped to the track", () => {
    assert.equal(timelinePositionAt([playing], 1000, 60), 60);
  });

  test("wraps inside the loop", () => {
    const looping = { outputTime: 0, input: 1, rate: 1, active: true, loopStart: 1, loopEnd: 3 };
    assert.equal(timelinePositionAt([looping], 1.5, 60), 2.5);
    assert.equal(timelinePositionAt([looping], 2.5, 60), 1.5);
    assert.equal(timelinePositionAt([looping], 4.5, 60), 1.5);
  });
});

describe("emitter", () => {
  test("listeners get the arguments; unsubscribing stops them", () => {
    const events = createEmitter();
    const seen = [];
    const off = events.on("x", (...args) => seen.push(args));
    events.emit("x", 1, 2);
    off();
    events.emit("x", 3);
    assert.deepEqual(seen, [[1, 2]]);
  });

  test("a throwing listener is logged and doesn't stop the others", () => {
    const events = createEmitter();
    const error = mock.method(console, "error", () => {});
    let reached = false;
    events.on("x", () => {
      throw new Error("broken view");
    });
    events.on("x", () => (reached = true));
    events.emit("x");
    assert.ok(reached);
    assert.equal(error.mock.callCount(), 1);
    error.mock.restore();
  });
});
