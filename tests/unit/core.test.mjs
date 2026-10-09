// The pure helpers in src/core/.
import assert from "node:assert/strict";
import { describe, mock, test } from "node:test";
import { createEmitter } from "../../src/core/emitter.js";
import { fileExtension, isVideoFile, mediaSource } from "../../src/core/files.js";
import { formatRulerTime, rulerTicks } from "../../src/core/ruler.js";
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
  formatDuration,
} from "../../src/core/format.js";
import { downsamplePeaks, peaksPerSecondFor } from "../../src/core/peaks.js";
import { timelinePositionAt } from "../../src/core/timeline.js";

describe("format", () => {
  test("track time: minutes, hours, never negative", () => {
    assert.equal(formatTrackTime(83.456), "1:23.456");
    assert.equal(formatDuration(83.6), "1:24");
    assert.equal(formatDuration(3723.4), "1:02:03");
    assert.equal(formatDuration(0), "0:00");
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
    // A download, served by URL: no type, so by extension.
    assert.ok(isVideoFile({ name: "clip.mp4", url: "transcribee-media://t/clip.mp4" }, extensions));
    assert.ok(!isVideoFile({ name: "song.m4a", url: "transcribee-media://t/song.m4a" }, extensions));
  });

  test("a File is read as a Blob, a download by its URL", () => {
    class BlobSource {
      constructor(blob) {
        this.blob = blob;
      }
    }
    class UrlSource {
      constructor(url) {
        this.url = url;
      }
    }
    const file = new File(["x"], "song.mp3");
    assert.equal(/** @type {any} */ (mediaSource(file, { BlobSource, UrlSource })).blob, file);
    const download = { name: "song.m4a", url: "transcribee-media://t/song.m4a" };
    assert.equal(/** @type {any} */ (mediaSource(download, { BlobSource, UrlSource })).url, download.url);
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

describe("ruler", () => {
  test("labels a step that leaves enough room, at any zoom", () => {
    assert.equal(rulerTicks(0, 20, 50).step, 2); // 1 s is 50 px: too close
    assert.equal(rulerTicks(0, 20, 70).step, 1);
    assert.equal(rulerTicks(0, 1, 2000).step, 0.05);
    assert.equal(rulerTicks(0, 7200, 0.1).step, 1800);
    for (const pxPerSecond of [0.05, 1, 13, 140, 900, 9000]) {
      const { step } = rulerTicks(0, 1, pxPerSecond);
      assert.ok(step * pxPerSecond >= 70 || step === 3600, `${pxPerSecond} px/s: ${step}`);
    }
  });

  test("ticks only in the range, labelled ones on whole steps", () => {
    const { ticks } = rulerTicks(3.3, 7.9, 100); // step 1, minor 0.2
    assert.ok(ticks.every((tick) => tick.time >= 3.3 && tick.time <= 7.9));
    assert.deepEqual(
      ticks.filter((tick) => tick.major).map((tick) => tick.time),
      [4, 5, 6, 7],
    );
    assert.equal(ticks.length, 23); // 3.4 … 7.8
    assert.ok(Math.abs(ticks[0].time - 3.4) < 1e-9);
  });

  test("minor ticks stay at least 6 px apart", () => {
    for (const pxPerSecond of [7, 30, 71, 500]) {
      const { ticks } = rulerTicks(0, 60, pxPerSecond);
      const gap = (ticks[1].time - ticks[0].time) * pxPerSecond;
      assert.ok(gap >= 6, `${pxPerSecond} px/s: ${gap}`);
    }
  });

  test("labels are as precise as the step", () => {
    assert.equal(formatRulerTime(65, 5), "1:05");
    assert.equal(formatRulerTime(65.5, 0.5), "1:05.5");
    assert.equal(formatRulerTime(5.25, 0.05), "0:05.25");
    assert.equal(formatRulerTime(59.99999, 1), "1:00");
    assert.equal(formatRulerTime(3600, 600), "60:00");
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
