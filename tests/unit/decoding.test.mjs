// The memory a decoded track needs (src/core/memory.js).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { formatMemory } from "../../src/core/format.js";
import { decodedBytes, fitsInMemory } from "../../src/core/memory.js";

describe("memory", () => {
  test("decoded size: an hour of stereo at 48 kHz is about 1.3 GB", () => {
    assert.equal(decodedBytes(3600, 48000, 2), 1_382_400_000);
    assert.equal(formatMemory(decodedBytes(3600, 48000, 2)), "1.3 GB");
    assert.equal(formatMemory(850 * 1024 ** 2), "850 MB");
  });

  test("fits in at most 80 % of the free memory; unknown always fits", () => {
    assert.ok(fitsInMemory(800, 1000));
    assert.ok(!fitsInMemory(801, 1000));
    assert.ok(fitsInMemory(10 ** 12, null));
  });
});
