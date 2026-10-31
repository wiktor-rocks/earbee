// src/features/stems/mix.js: the stems' gains from their volume, solo and
// mute, as a mixing desk does it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultMix, isUnchanged, stemGains } from "../../src/features/stems/mix.js";

const list = ["vocals", "guitar", "other"].map((id) => ({ id }));
const mixWith = (changes) => {
  const mix = defaultMix(list);
  for (const [id, change] of Object.entries(changes)) mix[id] = { ...mix[id], ...change };
  return mix;
};

test("untouched, every stem plays at full volume: the song as it is", () => {
  const gains = stemGains(list, defaultMix(list));
  assert.deepEqual(gains, { vocals: 1, guitar: 1, other: 1 });
  assert.equal(isUnchanged(gains), true);
});

test("a stem's volume is its gain", () => {
  const gains = stemGains(list, mixWith({ guitar: { volume: 0.4 } }));
  assert.deepEqual(gains, { vocals: 1, guitar: 0.4, other: 1 });
  assert.equal(isUnchanged(gains), false);
});

test("mute silences a stem", () => {
  assert.deepEqual(stemGains(list, mixWith({ guitar: { mute: true } })), { vocals: 1, guitar: 0, other: 1 });
});

test("solo: only the soloed stems play, at their volume", () => {
  assert.deepEqual(stemGains(list, mixWith({ guitar: { solo: true, volume: 0.5 } })), {
    vocals: 0,
    guitar: 0.5,
    other: 0,
  });
  assert.deepEqual(stemGains(list, mixWith({ guitar: { solo: true }, other: { solo: true } })), {
    vocals: 0,
    guitar: 1,
    other: 1,
  });
});

test("mute wins over solo", () => {
  assert.deepEqual(stemGains(list, mixWith({ guitar: { solo: true, mute: true } })), {
    vocals: 0,
    guitar: 0,
    other: 0,
  });
});
