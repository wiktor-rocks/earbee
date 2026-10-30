// Preferences (src/prefs): declaring sections, checking values, setting one.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  PrefsError,
  defaultsOf,
  defineSection,
  isVisible,
  normalizeSection,
  resetValue,
  setValue,
} from "../../src/prefs/fields.js";
import { SECTIONS, getSection, normalizePrefsFile } from "../../src/prefs/index.js";
import { THEMES } from "../../src/themes/index.js";

const sample = defineSection({
  id: "sample",
  title: "Sample",
  fields: [
    {
      key: "mode",
      type: "choice",
      label: "Mode",
      default: "a",
      options: [
        { value: "a", label: "A" },
        { value: "b", label: "B" },
      ],
    },
    { key: "on", type: "boolean", label: "On", default: false },
    { key: "size", type: "number", label: "Size", default: 10, min: 0, max: 100, step: 5 },
    { key: "dir", type: "folder", label: "Dir", default: null, visibleWhen: (values) => values.on },
  ],
});

describe("declaring a section", () => {
  test("every real section is valid, and its defaults normalize to themselves", () => {
    assert.equal(new Set(SECTIONS.map((section) => section.id)).size, SECTIONS.length);
    for (const section of SECTIONS)
      assert.deepEqual(normalizeSection(section, defaultsOf(section)), defaultsOf(section));
  });

  test("mistakes fail at once", () => {
    const field = { key: "x", type: "boolean", label: "X", default: false };
    assert.throws(() => defineSection({ id: "bad id", title: "", fields: [] }), PrefsError);
    assert.throws(() => defineSection({ id: "s", title: "", fields: [field, field] }), /Duplicate/);
    assert.throws(
      () => defineSection({ id: "s", title: "", fields: [{ ...field, type: "colour" }] }),
      /Unknown field type/,
    );
    assert.throws(() => defineSection({ id: "s", title: "", fields: [{ ...field, default: "no" }] }), /Bad default/);
  });
});

describe("normalizing stored values", () => {
  test("keeps what's valid, defaults the rest, drops unknown keys", () => {
    assert.deepEqual(normalizeSection(sample, { mode: "b", on: "yes", size: 23, dir: "/music", extra: 1 }), {
      mode: "b",
      on: false,
      size: 25, // rounded to the step
      dir: "/music",
    });
    assert.deepEqual(normalizeSection(sample, { size: 1000 }).size, 100);
    assert.deepEqual(normalizeSection(sample, { size: NaN }).size, 10);
  });

  test("anything that isn't an object gives the defaults", () => {
    for (const junk of [null, undefined, "x", 3, []])
      assert.deepEqual(normalizeSection(sample, junk), defaultsOf(sample));
    assert.deepEqual(Object.keys(normalizePrefsFile("junk")).sort(), SECTIONS.map((section) => section.id).sort());
  });

  test("folders must be absolute paths", () => {
    for (const ok of ["/home/me/Music", "C:\\Users\\me", "D:/x", "\\\\server\\share"])
      assert.equal(normalizeSection(sample, { dir: ok }).dir, ok);
    for (const bad of ["relative/path", "", "~/Music", 5, "/a\0b"])
      assert.equal(normalizeSection(sample, { dir: bad }).dir, null);
  });
});

describe("setting a value", () => {
  const values = defaultsOf(sample);

  test("returns new values, leaving the old ones alone", () => {
    const next = setValue(sample, values, "mode", "b");
    assert.equal(next.mode, "b");
    assert.equal(values.mode, "a");
  });

  test("refuses unknown keys and invalid values", () => {
    assert.throws(() => setValue(sample, values, "nope", 1), /Unknown setting/);
    assert.throws(() => setValue(sample, values, "mode", "c"), /Invalid value/);
    assert.throws(() => setValue(sample, values, "on", "true"), /Invalid value/);
  });

  test("the page can't set a folder, only reset it", () => {
    assert.throws(() => setValue(sample, values, "dir", "/etc", { fromPage: true }), /can't be set from the page/);
    assert.equal(setValue(sample, values, "dir", "/etc").dir, "/etc"); // the main process can
    assert.equal(setValue(sample, { ...values, dir: "/etc" }, "dir", null, { fromPage: true }).dir, null);
  });

  test("reset puts one field, or all, back", () => {
    const changed = { mode: "b", on: true, size: 50, dir: "/x" };
    assert.deepEqual(resetValue(sample, changed, "size"), { ...changed, size: 10 });
    assert.deepEqual(resetValue(sample, changed), defaultsOf(sample));
  });

  test("visibleWhen follows the values", () => {
    const dir = sample.fields.find((field) => field.key === "dir");
    assert.equal(isVisible(dir, { on: false }), false);
    assert.equal(isVisible(dir, { on: true }), true);
  });
});

describe("the theme section", () => {
  const theme = getSection("theme");
  const values = defaultsOf(theme);

  test("offers Automatic and every theme; the pairings only their scheme's", () => {
    const options = (key) => theme.fields.find((field) => field.key === key).options.map((option) => option.value);
    assert.deepEqual(options("choice"), ["auto", ...THEMES.map((t) => t.id)]);
    for (const scheme of ["dark", "light"])
      assert.deepEqual(
        options(scheme),
        THEMES.filter((t) => t.scheme === scheme).map((t) => t.id),
      );
  });

  test("choosing a theme makes it Automatic's pick for its scheme", () => {
    const next = setValue(theme, values, "choice", "nord");
    assert.deepEqual(next, { ...values, choice: "nord", dark: "nord" });
    assert.equal(setValue(theme, next, "choice", "gruvbox-light").light, "gruvbox-light");
    assert.equal(setValue(theme, next, "choice", "auto").dark, "nord");
  });

  test("a pairing of the wrong scheme falls back", () => {
    assert.equal(normalizeSection(theme, { light: "nord" }).light, values.light);
  });

  test("the dark and light pickers show only for Automatic", () => {
    const dark = theme.fields.find((field) => field.key === "dark");
    assert.equal(isVisible(dark, values), false);
    assert.equal(isVisible(dark, { ...values, choice: "auto" }), true);
  });
});

describe("the general section", () => {
  const general = getSection("general");

  test("defaults: notifications on, no beat click, knobs at 100 %", () => {
    assert.deepEqual(defaultsOf(general), { notifications: true, beatClick: false, knobSensitivity: 100 });
  });

  test("anything but true or false falls back to on", () => {
    assert.equal(normalizePrefsFile({ general: { notifications: "no" } }).general.notifications, true);
    assert.equal(normalizePrefsFile({ general: { notifications: false } }).general.notifications, false);
  });
});

describe("the layout section", () => {
  const layout = getSection("layout");

  test("defaults: the top bar stays, the video's buttons always show", () => {
    assert.deepEqual(defaultsOf(layout), { autohideTopBar: false, videoButtons: "always" });
  });

  test("anything but its choices falls back to always; anything but true or false to a bar that stays", () => {
    assert.equal(normalizePrefsFile({ layout: { videoButtons: "sideways" } }).layout.videoButtons, "always");
    assert.equal(normalizePrefsFile({ layout: { videoButtons: "hover" } }).layout.videoButtons, "hover");
    assert.equal(normalizePrefsFile({ layout: { autohideTopBar: "yes" } }).layout.autohideTopBar, false);
    assert.equal(normalizePrefsFile({ layout: { autohideTopBar: true } }).layout.autohideTopBar, true);
  });
});

describe("the downloads section", () => {
  test("defaults: the usual folder, audio, chapters as marks, searching YouTube, 1080p", () => {
    assert.deepEqual(defaultsOf(getSection("downloads")), {
      folder: null,
      kind: "audio",
      chapters: true,
      searchSource: "youtube",
      maxHeight: 1080,
    });
  });
});

describe("the waveform section", () => {
  const waveform = getSection("waveform");
  const values = defaultsOf(waveform);

  test("defaults: a continuous shape of loudness, linear, stereo combined, normal height", () => {
    assert.deepEqual(values, {
      style: "continuous",
      measure: "loudness",
      scale: "linear",
      stereo: "combined",
      height: 100,
    });
    assert.ok(!waveform.electronOnly, "the waveform settings work in a plain browser too");
  });

  test("invalid stored values fall back; the height is clamped and stepped", () => {
    assert.deepEqual(normalizeSection(waveform, { style: "dots", measure: 3, scale: "", stereo: null }), values);
    assert.equal(normalizeSection(waveform, { height: 1000 }).height, 300);
    assert.equal(normalizeSection(waveform, { height: 10 }).height, 50);
    assert.equal(normalizeSection(waveform, { height: 123 }).height, 120);
  });

  test("what is measured is hidden for the two-tone style, which shows both", () => {
    const measure = waveform.fields.find((field) => field.key === "measure");
    assert.equal(isVisible(measure, values), true);
    assert.equal(isVisible(measure, { ...values, style: "twoTone" }), false);
    assert.deepEqual(
      waveform.fields.find((field) => field.key === "style").options.map((option) => option.value),
      ["bars", "continuous", "twoTone"],
    );
  });
});
