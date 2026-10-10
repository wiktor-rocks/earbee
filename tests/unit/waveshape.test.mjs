// Shaping the waveform (src/core/waveshape.js): from the decoded levels
// (peak and RMS per slice) to heights in 0…1 that look alike from song to
// song, and the per-column values the drawing uses.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { downsampleLevels } from "../../src/core/media.js";
import { columnLevels, rangeLevel, referenceLevel, shapeLevels, shapeOverview } from "../../src/core/waveshape.js";

const DEFAULTS = { style: "bars", measure: "loudness", scale: "linear", stereo: "combined", height: 100 };
const FACTOR = 100;

// A sine of `amplitude` over `n` samples (40 samples per period).
const sine = (n, amplitude) => Float32Array.from({ length: n }, (_, i) => amplitude * Math.sin((2 * Math.PI * i) / 40));
const levelsOf = (...channels) => channels.map((samples) => downsampleLevels(samples, FACTOR));
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const allIn01 = (shaped) =>
  [shaped.top.peak, shaped.top.rms, shaped.bottom.peak, shaped.bottom.rms].every((series) =>
    series.every((v) => Number.isFinite(v) && v >= 0 && v <= 1),
  );

describe("the reference level", () => {
  test("one full-scale spike doesn't set the scale", () => {
    const values = new Float32Array(1000).fill(0.05);
    values[500] = 1;
    assert.ok(Math.abs(referenceLevel(values) - 0.05) < 0.002, String(referenceLevel(values)));
  });

  test("values at or below `floor` are left out", () => {
    const values = Float32Array.from([0.001, 0.001, 0.001, 0.5, 0.6]);
    assert.ok(referenceLevel(values, 0.01) < 0.002);
    assert.ok(Math.abs(referenceLevel(values, 0.01, 0.01) - 0.5) < 0.005);
    assert.equal(referenceLevel(values, 0.5, 1), 0);
  });

  test("silence gives 0", () => {
    assert.equal(referenceLevel(new Float32Array(100)), 0);
    assert.equal(referenceLevel(new Float32Array(0)), 0);
  });
});

describe("shaping", () => {
  test("a quiet tone with one loud click is drawn tall, not tiny", () => {
    const samples = sine(100_000, 0.05);
    samples[50_000] = 1;
    for (const measure of ["loudness", "peaks"]) {
      const shaped = shapeLevels(levelsOf(samples), { ...DEFAULTS, measure });
      const series = measure === "peaks" ? shaped.top.peak : shaped.top.rms;
      assert.ok(median(series) >= 0.8, `${measure}: ${median(series)}`);
    }
  });

  test("the same music, quiet or loud, looks the same", () => {
    const envelope = (i) => 0.3 + 0.7 * Math.abs(Math.sin(i / 3000));
    const at = (amplitude) => Float32Array.from(sine(60_000, 1), (v, i) => v * envelope(i) * amplitude);
    for (const measure of ["loudness", "peaks"]) {
      const quiet = shapeLevels(levelsOf(at(0.05)), { ...DEFAULTS, measure });
      const loud = shapeLevels(levelsOf(at(0.8)), { ...DEFAULTS, measure });
      for (const key of ["peak", "rms"])
        quiet.top[key].forEach((v, i) => assert.ok(Math.abs(v - loud.top[key][i]) <= 0.01, `${measure} ${key} @${i}`));
    }
  });

  test("never outside 0…1: overshooting samples, a big height, silence", () => {
    const hot = sine(20_000, 1.6); // decoders can go past full scale
    for (const scale of ["linear", "log"])
      for (const style of ["bars", "continuous", "twoTone"]) {
        assert.ok(allIn01(shapeLevels(levelsOf(hot), { ...DEFAULTS, scale, style, height: 300 })), `${scale} ${style}`);
        const silent = shapeLevels(levelsOf(new Float32Array(20_000)), { ...DEFAULTS, scale, style });
        assert.ok(allIn01(silent) && silent.top.rms.every((v) => v === 0), `silence ${scale} ${style}`);
      }
  });

  test("a loud, compressed song still shows its beats as loudness (not one block)", () => {
    // Every slice peaks near full scale (as a limiter leaves it); the beats
    // are dense, between them only occasional spikes.
    const samples = new Float32Array(200_000);
    for (let i = 0; i < samples.length; i++) {
      const onBeat = Math.floor(i / 10_000) % 2 === 0;
      samples[i] = onBeat ? (i % 2 ? 0.95 : -0.95) : i % 50 === 0 ? 0.95 : 0.05 * Math.sin(i);
    }
    const contrast = (series) => {
      const beat = series.filter((_, k) => Math.floor((k * FACTOR) / 10_000) % 2 === 0);
      const gap = series.filter((_, k) => Math.floor((k * FACTOR) / 10_000) % 2 === 1);
      return median(beat) / Math.max(median(gap), 1e-6);
    };
    const peaks = shapeLevels(levelsOf(samples), { ...DEFAULTS, measure: "peaks" }).top.peak;
    const loudness = shapeLevels(levelsOf(samples), DEFAULTS).top.rms;
    assert.ok(contrast(peaks) < 1.2, `peaks are a block: ${contrast(peaks)}`);
    assert.ok(contrast(loudness) > 2, `loudness shows the beats: ${contrast(loudness)}`);
  });

  test("the dB scale is monotonic, lifts quiet parts and keeps silence at 0", () => {
    const steps = [0, 0.001, 0.01, 0.03, 0.1, 0.3, 1];
    const samples = new Float32Array(steps.length * 10 * FACTOR);
    steps.forEach((amplitude, k) => samples.set(sine(10 * FACTOR, amplitude), k * 10 * FACTOR));
    const linear = shapeLevels(levelsOf(samples), { ...DEFAULTS, measure: "peaks" }).top.peak;
    const log = shapeLevels(levelsOf(samples), { ...DEFAULTS, measure: "peaks", scale: "log" }).top.peak;
    const middle = (series, k) => series[k * 10 + 5];
    assert.equal(middle(log, 0), 0);
    for (let k = 1; k < steps.length; k++) assert.ok(middle(log, k) >= middle(log, k - 1), `step ${k}`);
    const quiet = steps.indexOf(0.03); // −30 dB
    assert.ok(middle(log, quiet) > middle(linear, quiet) + 0.2, `${middle(log, quiet)} vs ${middle(linear, quiet)}`);
  });

  test("stereo: combined mirrors the louder channel, split keeps left above and right below", () => {
    const left = sine(20_000, 0.5);
    const right = new Float32Array(20_000);
    const combined = shapeLevels(levelsOf(left, right), DEFAULTS);
    assert.deepEqual(combined.top.rms, combined.bottom.rms);
    assert.ok(median(combined.bottom.rms) > 0.8);
    const split = shapeLevels(levelsOf(left, right), { ...DEFAULTS, stereo: "split" });
    assert.ok(median(split.top.rms) > 0.8 && split.bottom.rms.every((v) => v === 0));
    const mono = shapeLevels(levelsOf(left), { ...DEFAULTS, stereo: "split" });
    assert.deepEqual(mono.top.rms, mono.bottom.rms);
  });

  test("two-tone: the loudness core never sticks out past the peak outline", () => {
    const samples = Float32Array.from(sine(50_000, 1), (v, i) => v * (0.2 + Math.abs(Math.sin(i / 2000))));
    for (const scale of ["linear", "log"]) {
      for (const window of [1, 20]) {
        const { top } = shapeLevels(levelsOf(samples), { ...DEFAULTS, style: "twoTone", scale }, { window });
        top.rms.forEach((v, i) => assert.ok(v <= top.peak[i] + 1e-6, `${scale} window ${window} @${i}`));
      }
    }
  });

  test("a short track (few samples per slice) is as tall as a long one", () => {
    // Short tracks get many more slices per second; their loudness is
    // measured over windows of about the same time, so a steady tone
    // fills the same height either way.
    const tone = sine(200_000, 0.3);
    const height = (factor) => {
      const levels = [downsampleLevels(tone, factor)];
      const window = Math.max(1, Math.round(1000 / factor)); // ≈ 1000 samples
      const { rms } = shapeLevels(levels, DEFAULTS, { window }).top;
      return median(columnLevels(rms, 0, rms.length, 50, "rms"));
    };
    assert.ok(Math.abs(height(5) - height(1000)) <= 0.03, `${height(5)} vs ${height(1000)}`);
    assert.ok(height(1000) >= 0.85, String(height(1000)));
  });

  test("the height setting scales the drawing", () => {
    const samples = Float32Array.from(sine(50_000, 1), (v, i) => v * (0.1 + 0.4 * Math.abs(Math.sin(i / 2000))));
    const normal = median(shapeLevels(levelsOf(samples), DEFAULTS).top.rms);
    const half = median(shapeLevels(levelsOf(samples), { ...DEFAULTS, height: 50 }).top.rms);
    assert.ok(Math.abs(half - normal / 2) < 0.02, `${half} vs ${normal}`);
  });
});

describe("column levels", () => {
  const series = Float32Array.from([0.1, 0.5, 0.2, 0.9, 0.3, 0.4, 0.8, 0.0]);

  test("one value per column, the largest of the values it covers", () => {
    assert.deepEqual(
      [...columnLevels(series, 0, 8, 4)].map((v) => +v.toFixed(2)),
      [0.5, 0.9, 0.4, 0.8],
    );
    assert.deepEqual(
      [...columnLevels(series, 0, 8, 1)].map((v) => +v.toFixed(2)),
      [0.9],
    );
  });

  test("a range as one value: the largest, or the RMS", () => {
    assert.equal(rangeLevel(series, 2, 5), series[3]); // 0.9, as a float32
    assert.ok(Math.abs(rangeLevel(series, 0, 2, "rms") - Math.sqrt((0.01 + 0.25) / 2)) < 1e-6);
  });

  test("starts at `start` (a canvas shows a slice of the track)", () => {
    assert.deepEqual(
      [...columnLevels(series, 4, 4, 2)].map((v) => +v.toFixed(2)),
      [0.4, 0.8],
    );
  });

  test("loudness columns combine as RMS, so one loud slice doesn't fill a column", () => {
    const one = Float32Array.from([0, 0, 0, 1]);
    assert.equal(columnLevels(one, 0, 4, 1, "rms")[0], 0.5);
    assert.equal(columnLevels(one, 0, 4, 1)[0], 1); // "max" by default
  });

  test("zoomed in past one value per column: no gaps", () => {
    const columns = columnLevels(series, 2, 2, 8); // 0.2 and 0.9 over 8 columns
    assert.equal(columns.length, 8);
    assert.ok(
      columns.every((v) => v === series[2] || v === series[3]),
      [...columns].join(),
    );
    assert.equal(columns[0], series[2]);
    assert.equal(columns[7], series[3]);
  });
});

describe("the minimap's overview", () => {
  // A verse at 0.5 and a chorus at 0.8: only a little louder.
  const song = (scale = 1) =>
    Float32Array.from(sine(200_000, 1), (v, i) => v * scale * (Math.floor(i / 50_000) % 2 ? 0.8 : 0.5));
  const parts = (series) => {
    const verse = median(series.filter((_, k) => Math.floor((k * FACTOR) / 50_000) % 2 === 0));
    const chorus = median(series.filter((_, k) => Math.floor((k * FACTOR) / 50_000) % 2 === 1));
    return { verse, chorus };
  };

  test("exaggerates loud and quiet parts, far more than the main waveform", () => {
    const main = parts(shapeLevels(levelsOf(song()), DEFAULTS, { window: 10 }).top.rms);
    const overview = parts(shapeOverview(levelsOf(song()), { window: 10 }).top.rms);
    assert.ok(main.chorus / main.verse < 1.7, JSON.stringify(main));
    assert.ok(overview.chorus / overview.verse > 2.2, JSON.stringify(overview));
    assert.ok(overview.chorus >= 0.9, JSON.stringify(overview));
  });

  test("within 0…1, the same at any volume, silence at 0 and quiet parts still visible", () => {
    const quiet = shapeOverview(levelsOf(song(0.05)), { window: 10 });
    const loud = shapeOverview(levelsOf(song(1.5)), { window: 10 });
    quiet.top.rms.forEach((v, i) => assert.ok(Math.abs(v - loud.top.rms[i]) <= 0.01, `@${i}`));
    assert.ok(loud.top.rms.every((v) => v >= 0 && v <= 1));
    assert.ok(parts(quiet.top.rms).verse >= 0.1, "the quietest part keeps a little height");

    const withSilence = song();
    withSilence.fill(0, 0, 20_000);
    const shaped = shapeOverview(levelsOf(withSilence), { window: 10 }).top.rms;
    assert.equal(shaped[50], 0);
    assert.ok(shapeOverview(levelsOf(new Float32Array(20_000))).top.rms.every((v) => v === 0));
  });

  test("a steady sound isn't blown up from its own tiny wobbles", () => {
    const steady = shapeOverview(levelsOf(sine(100_000, 0.3)), { window: 10 }).top.rms;
    assert.ok(median(steady) >= 0.9, String(median(steady)));
  });
});
