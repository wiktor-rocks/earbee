// The ready points' memory budget (src/video/ready-budget.js): fewer
// waiting decoders for bigger videos, within the memory free, at each level
// of Settings › Advanced (CONFIG.video.readyPoints.levels).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CONFIG } from "../../src/config.js";
import { readyPointsFor } from "../../src/video/ready-budget.js";

const { levels } = CONFIG.video.readyPoints;
const limitsAt = (level) => ({ ...CONFIG.video.readyPoints, ...levels[level] });
const LIMITS = limitsAt("normal");
const GB = 1e9;
const points = (width, height, available = 8 * GB, limits = LIMITS) =>
  readyPointsFor({ width, height, available }, limits);

describe("ready points' budget (Normal)", () => {
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

describe("ready points' levels", () => {
  const SIZES = [
    [640, 360],
    [1920, 1080],
    [3840, 2160],
  ];

  test("Off: none, whatever the size", () => {
    for (const [width, height] of SIZES) assert.equal(points(width, height, 8 * GB, limitsAt("off")), 0);
  });

  test("Low: HD gets one, 4K none", () => {
    assert.equal(points(1920, 1080, 4.8 * GB, limitsAt("low")), 1);
    assert.equal(points(3840, 2160, 8 * GB, limitsAt("low")), 0);
  });

  test("High: 4K gets two", () => {
    assert.equal(points(3840, 2160, 8 * GB, limitsAt("high")), 2);
    assert.equal(points(1920, 1080, 8 * GB, limitsAt("high")), 4);
  });

  test("each level stays within its maxBytes", () => {
    for (const level of Object.keys(levels)) {
      const limits = limitsAt(level);
      for (const [width, height] of SIZES) {
        const each = limits.heldFrames * width * height * 1.5;
        assert.ok(points(width, height, 1000 * GB, limits) * each <= limits.maxBytes, `${level}, ${width}×${height}`);
      }
    }
  });

  test("the levels are the setting's choices", async () => {
    const { getSection } = await import("../../src/prefs/index.js");
    const field = getSection("advanced").fields.find((candidate) => candidate.key === "sharpJumps");
    assert.deepEqual(
      field.options.map((option) => option.value),
      Object.keys(levels),
    );
    assert.ok(field.default in levels);
  });
});
