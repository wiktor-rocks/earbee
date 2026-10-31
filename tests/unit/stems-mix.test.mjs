// src/features/stems/mix.js: the stems' gains from their volume, solo and
// mute, as a mixing desk does it, and their pan as a 2×2 mix.
import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultMix, formatPan, isUnchanged, panMatrix, stemGains, stemMixes } from "../../src/features/stems/mix.js";

const list = ["vocals", "guitar", "other"].map((id) => ({ id }));
const mixWith = (changes) => {
  const mix = defaultMix(list);
  for (const [id, change] of Object.entries(changes)) mix[id] = { ...mix[id], ...change };
  return mix;
};

test("untouched, every stem plays at full volume, centred: the song as it is", () => {
  const gains = stemGains(list, defaultMix(list));
  assert.deepEqual(gains, { vocals: 1, guitar: 1, other: 1 });
  assert.equal(isUnchanged(stemMixes(list, defaultMix(list))), true);
});

test("a stem's volume is its gain", () => {
  const mix = mixWith({ guitar: { volume: 0.4 } });
  assert.deepEqual(stemGains(list, mix), { vocals: 1, guitar: 0.4, other: 1 });
  assert.deepEqual(stemMixes(list, mix).guitar, [0.4, 0, 0, 0.4]);
  assert.equal(isUnchanged(stemMixes(list, mix)), false);
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

const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-12);

test("a pan moves a stem from one side to the other, keeping its power", () => {
  assert.deepEqual(panMatrix(0), [1, 0, 0, 1], "centred: each channel where it is");
  assert.ok(near(panMatrix(-100), [1, 1, 0, 0]), "far left: both channels on the left");
  assert.ok(near(panMatrix(100), [0, 0, 1, 1]), "far right: both on the right");
  const [ll, lr, rl, rr] = panMatrix(-50);
  assert.equal(ll, 1);
  assert.equal(rl, 0);
  assert.ok(Math.abs(lr ** 2 + rr ** 2 - 1) < 1e-12, "the right channel's power, shared between the sides");
});

test("a stem's mix is its pan at its gain; mute and solo as for the gain", () => {
  const mix = mixWith({ guitar: { pan: -100, volume: 0.5 }, vocals: { mute: true } });
  const mixes = stemMixes(list, mix);
  assert.ok(near(mixes.guitar, [0.5, 0.5, 0, 0]));
  assert.deepEqual(mixes.vocals, [0, 0, 0, 0]);
  assert.equal(isUnchanged(stemMixes(list, mixWith({ other: { pan: 10 } }))), false, "a pan alone changes the mix");
});

test("the pan's readout", () => {
  assert.equal(formatPan(0), "Centre");
  assert.equal(formatPan(-40), "L 40");
  assert.equal(formatPan(100), "R 100");
});
