// The ready points' memory budget (src/video/ready-budget.js): fewer
// waiting decoders for bigger videos, within the memory free.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CONFIG } from "../../src/config.js";
import { readyPointsFor } from "../../src/video/ready-budget.js";

const LIMITS = CONFIG.video.readyPoints;
const GB = 1e9;
const points = (width, height, available = 8 * GB) => readyPointsFor({ width, height, available }, LIMITS);

describe("ready points' budget", () => {
  test("small and HD videos get all of them", () => {
    assert.equal(points(640, 360), LIMITS.max);
    assert.equal(points(1920, 1080), 4);
  });

  test("bigger videos get fewer, 8K none", () => {
    assert.equal(points(2560, 1440), 2);
    assert.equal(points(3840, 2160), 1);
    assert.equal(points(7680, 4320), 0);
  });

  test("never more than maxBytes, however much is free", () => {
    for (const [width, height] of [
      [1920, 1080],
      [2560, 1440],
      [3840, 2160],
    ]) {
      const each = LIMITS.heldFrames * width * height * 1.5;
      assert.ok(points(width, height, 1000 * GB) * each <= LIMITS.maxBytes, `${width}×${height}`);
    }
  });

  test("little memory free: fewer, or none", () => {
    assert.equal(points(1920, 1080, 2 * GB), 2); // 15 % of 2 GB: 300 MB
    assert.equal(points(3840, 2160, 2 * GB), 0);
  });

  test("memory unknown: maxBytes alone", () => {
    assert.equal(points(1920, 1080, null), 4);
    assert.equal(points(3840, 2160, null), 1);
  });

  test("no size: none", () => {
    assert.equal(points(0, 0), 0);
    assert.equal(points(undefined, undefined), 0);
    assert.equal(points(NaN, 1080), 0);
  });
});
