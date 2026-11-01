// src/features/stems/spans.js: the parts of a song separated so far, as
// spans that are joined as pieces come, in any order.
import assert from "node:assert/strict";
import { test } from "node:test";
import { addSpan, coveredLength, coveredParts, coversAll, scaleSpans } from "../../src/features/stems/spans.js";

test("pieces added in any order end up as sorted spans, touching ones joined", () => {
  let spans = [];
  spans = addSpan(spans, 100, 200);
  spans = addSpan(spans, 400, 500);
  spans = addSpan(spans, 0, 50);
  assert.deepEqual(spans, [
    [0, 50],
    [100, 200],
    [400, 500],
  ]);
  spans = addSpan(spans, 200, 260); // touching: joined
  spans = addSpan(spans, 450, 600); // overlapping: joined
  assert.deepEqual(spans, [
    [0, 50],
    [100, 260],
    [400, 600],
  ]);
  spans = addSpan(spans, 40, 420); // across several: one
  assert.deepEqual(spans, [[0, 600]]);
  assert.deepEqual(addSpan(spans, 10, 10), spans, "an empty piece changes nothing");
});

test("the parts of a block they cover", () => {
  const spans = [
    [0, 50],
    [100, 200],
  ];
  assert.deepEqual(coveredParts(spans, 40, 80), [
    [40, 50],
    [100, 120],
  ]);
  assert.deepEqual(coveredParts(spans, 60, 30), []);
  assert.deepEqual(coveredParts(spans, 120, 10), [[120, 130]]);
});

test("how much they cover, and whether it's all of it", () => {
  const spans = [
    [0, 50],
    [100, 200],
  ];
  assert.equal(coveredLength(spans), 150);
  assert.equal(coversAll(spans, 200), false);
  assert.equal(coversAll([[0, 200]], 200), true);
  assert.equal(coversAll([], 200), false);
});

test("moved to another sample rate", () => {
  assert.deepEqual(scaleSpans([[44100, 88200]], 48000 / 44100), [[48000, 96000]]);
});
