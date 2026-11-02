// src/features/stems/memory.js: the memory separating a song, or bringing
// back a project's stems, would take, and the most they may take.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CONFIG } from "../../src/config.js";
import { loadingBytes, memoryLimit, partBytes, separationBytes } from "../../src/features/stems/memory.js";

const GB = 1e9;
const { model, blend, share, totalShare } = CONFIG.stems.memory;

test("a separation: the page's stems three times, the process's song and blend, and the model", () => {
  const seconds = 240;
  // Page: 6 stems × 2 channels × 2 bytes × 3 copies (the player's, the
  // page's or worker's, and a save's snapshot), at the track's rate.
  const page = seconds * 48000 * 72;
  // Process: the song's 2 floats of 4 bytes, at 44.1 kHz.
  const process = seconds * 44100 * 8;
  assert.equal(separationBytes({ seconds, sampleRate: 48000 }), page + process + blend + model);
  // A 4-minute song at 44.1 kHz: about 3 GB; an hour, about 15 GB.
  const song = separationBytes({ seconds, sampleRate: 44100 });
  assert.ok(song > 2.9 * GB && song < 3.1 * GB, String(song));
  const hour = separationBytes({ seconds: 3600, sampleRate: 44100 });
  assert.ok(hour > 14.5 * GB && hour < 15.5 * GB, String(hour));
});

test("carrying on: the process's share and the snapshot's copy, the page has its stems already", () => {
  const track = { seconds: 600, sampleRate: 48000 };
  assert.equal(separationBytes({ ...track, carryOn: true }), 600 * 48000 * 24 + 600 * 44100 * 8 + blend + model);
  assert.ok(separationBytes({ ...track, carryOn: true }) < separationBytes(track));
});

test("the loop alone: its window's stems, the song around it, the blend and the model, however long the song", () => {
  const part = partBytes({ seconds: 20, sampleRate: 44100 });
  assert.equal(part, 20 * 44100 * 72 + Math.ceil((20 + 31.2) * 44100) * 8 + blend + model);
  // About 2.2 GB, where an hour's whole song needs about 15.
  assert.ok(part < 2.2 * GB && part < separationBytes({ seconds: 3600, sampleRate: 44100 }) / 5);
});

test("bringing back a project's stems: the page's two copies and their Opus bytes, no model", () => {
  const seconds = 3600;
  const opus = (seconds * CONFIG.stems.bitrate * 6) / 8;
  assert.equal(loadingBytes({ seconds, sampleRate: 44100 }), seconds * 44100 * 48 + opus);
  // An hour: about 8 GB.
  assert.ok(loadingBytes({ seconds, sampleRate: 44100 }) > 7.5 * GB);
});

test("the limit: a share of what's available, else of all of it, else none", () => {
  assert.deepEqual(memoryLimit({ available: 10 * GB, total: 32 * GB }), { bytes: 10 * GB * share, of: "available" });
  // macOS: what's available is unknown.
  assert.deepEqual(memoryLimit({ available: null, total: 16 * GB }), { bytes: 16 * GB * totalShare, of: "total" });
  assert.equal(memoryLimit({ available: null, total: null }), null, "unknown: nothing is refused");
  assert.equal(memoryLimit({ available: 0, total: null }), null);
});
