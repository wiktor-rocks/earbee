// The EQ's Focus (src/core/focus.js) and note names (src/core/format.js).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CONFIG } from "../../src/config.js";
import { butterworthQs, focusCutoffs, focusPresetFor, noteFrequency, noteNumber } from "../../src/core/focus.js";
import { noteName } from "../../src/core/format.js";

const range = CONFIG.eq.focus.range;
const close = (actual, expected, digits = 2) => assert.equal(actual.toFixed(digits), expected.toFixed(digits));

describe("notes", () => {
  test("names, as musicians write them", () => {
    assert.equal(noteName(21), "A0");
    assert.equal(noteName(60), "C4");
    assert.equal(noteName(58), "B♭3");
    assert.equal(noteName(66), "F♯4");
    assert.equal(noteName(108), "C8");
  });

  test("numbers from names, with either kind of sharp and flat", () => {
    assert.equal(noteNumber("A0"), 21);
    assert.equal(noteNumber("C4"), 60);
    assert.equal(noteNumber("Bb3"), 58);
    assert.equal(noteNumber("B♭3"), 58);
    assert.equal(noteNumber("F#4"), 66);
    assert.equal(noteNumber("C8"), 108);
    assert.throws(() => noteNumber("H2"));
    for (let note = range.min; note <= range.max; note++) assert.equal(noteNumber(noteName(note)), note);
  });

  test("frequencies: A4 is 440 Hz, an octave doubles it", () => {
    assert.equal(noteFrequency(69), 440);
    assert.equal(noteFrequency(81), 880);
    close(noteFrequency(60), 261.63);
  });
});

describe("the Focus's cutoffs", () => {
  test("the whole range cuts nothing", () => {
    assert.deepEqual(focusCutoffs({ low: range.min, high: range.max, range }), { highpass: null, lowpass: null });
  });

  test("each end inside the range cuts at its note", () => {
    const { highpass, lowpass } = focusCutoffs({ low: noteNumber("E1"), high: noteNumber("C4"), range });
    close(highpass, 41.2);
    close(lowpass, 261.63);
  });

  test("an end at its limit cuts nothing on that side only", () => {
    const { highpass, lowpass } = focusCutoffs({ low: range.min, high: noteNumber("F4"), range });
    assert.equal(highpass, null);
    close(lowpass, 349.23);
  });

  test("they follow the pitch shift: +12 semitones doubles both, cents move them a little", () => {
    const low = noteNumber("E1");
    const high = noteNumber("C4");
    const plain = focusCutoffs({ low, high, range });
    const octave = focusCutoffs({ low, high, range, semitones: 12 });
    close(octave.highpass, plain.highpass * 2);
    close(octave.lowpass, plain.lowpass * 2);
    const cents = focusCutoffs({ low, high, range, semitones: -0.5 });
    close(cents.lowpass, plain.lowpass * 2 ** (-0.5 / 12));
  });
});

test("Butterworth stages: the known Qs, flat together", () => {
  assert.deepEqual(
    butterworthQs(1).map((q) => q.toFixed(4)),
    ["0.7071"],
  );
  assert.deepEqual(
    butterworthQs(2).map((q) => q.toFixed(4)),
    ["0.5412", "1.3066"],
  );
  assert.deepEqual(
    butterworthQs(4).map((q) => q.toFixed(4)),
    ["0.5098", "0.6013", "0.9000", "2.5629"],
  );
});

describe("presets", () => {
  const { presets } = CONFIG.eq.focus;

  test("every preset is a range of real notes, low to high, inside the Focus's range", () => {
    for (const preset of presets) {
      const low = noteNumber(preset.low);
      const high = noteNumber(preset.high);
      assert.ok(range.min <= low && low < high && high <= range.max, preset.id);
    }
    assert.equal(new Set(presets.map((preset) => preset.id)).size, presets.length);
  });

  test("a range is matched to its preset; any other range to none", () => {
    assert.equal(focusPresetFor(noteNumber("B0"), noteNumber("C5"), presets)?.id, "bass");
    assert.equal(focusPresetFor(noteNumber("B0"), noteNumber("C6"), presets), null);
    assert.equal(focusPresetFor(range.min, range.max, presets), null);
  });
});
