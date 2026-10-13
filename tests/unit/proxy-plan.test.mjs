// Where the video proxy builds next (src/video/proxy-plan.js): jumping to
// a time asked for, splitting a busy builder's part, filling gaps.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { covers, nextRange, reachedSoon } from "../../src/video/proxy-plan.js";

const options = { duration: 600, leadSeconds: 5, minSplitSeconds: 20 };
const run = (start, end, extra = {}) => ({ start, end, first: false, last: false, ...extra });
const job = (from, to, at = from) => ({ from, to, at });

describe("covers and reachedSoon", () => {
  test("a run covers its own times, and the ends it reaches", () => {
    assert.ok(covers(run(10, 20), 15));
    assert.ok(!covers(run(10, 20), 25));
    assert.ok(covers(run(10, 20, { first: true }), 2));
    assert.ok(covers(run(10, 20, { last: true }), 900));
  });

  test("a job reaches times just ahead of it, not far ones", () => {
    assert.ok(reachedSoon([job(0, 100, 30)], 33, 5));
    assert.ok(reachedSoon([job(0, 100, 30)], 10, 5)); // just built
    assert.ok(!reachedSoon([job(0, 100, 30)], 50, 5));
    assert.ok(!reachedSoon([job(0, 40, 38)], 41, 5)); // past where it stops
  });
});

describe("nextRange", () => {
  test("nothing built: from the start to the end", () => {
    assert.deepEqual(nextRange([], [], null, options), { from: 0, to: Infinity, lower: 0, after: -1, split: -1 });
  });

  test("everything built: nothing to do", () => {
    assert.equal(nextRange([run(0, 600, { first: true, last: true })], [], null, options), null);
  });

  test("a second builder takes the second half of the first one's part", () => {
    assert.deepEqual(nextRange([], [job(0, Infinity, 0)], null, options), {
      from: 300,
      to: Infinity,
      lower: 300,
      after: -1,
      split: 0,
    });
  });

  test("a third takes half of the bigger remaining part", () => {
    const range = nextRange([], [job(0, 300, 100), job(300, Infinity, 310)], null, options);
    assert.equal(range.split, 1);
    assert.equal(range.from, 455);
  });

  test("small parts aren't split", () => {
    assert.equal(nextRange([run(0, 560, { first: true })], [job(560, Infinity, 570)], null, options), null);
  });

  test("a free gap is filled from its start, continuing the run before it", () => {
    const runs = [run(0, 100, { first: true }), run(200, 600, { last: true })];
    assert.deepEqual(nextRange(runs, [], null, options), { from: 100, to: 200, lower: 100, after: 0, split: -1 });
  });

  test("a free gap is preferred over an equally big split", () => {
    const runs = [run(0, 100, { first: true }), run(140, 200)];
    const range = nextRange(runs, [job(200, Infinity, 520)], null, options);
    assert.equal(range.from, 100);
  });

  test("a focus in a free gap starts the lead before it", () => {
    const runs = [run(0, 100, { first: true })];
    assert.deepEqual(nextRange(runs, [], 400, options), { from: 395, to: Infinity, lower: 100, after: -1, split: -1 });
  });

  test("a focus right after a run continues that run", () => {
    const runs = [run(0, 100, { first: true }), run(300, 600, { last: true })];
    assert.deepEqual(nextRange(runs, [], 103, options), { from: 100, to: 300, lower: 100, after: 0, split: -1 });
  });

  test("a focus far ahead of a busy job splits it there", () => {
    assert.deepEqual(nextRange([], [job(0, Infinity, 20)], 400, options), {
      from: 395,
      to: Infinity,
      lower: 395,
      after: -1,
      split: 0,
    });
  });

  test("a focus a job reaches soon, or one already built, is left alone", () => {
    const jobs = [job(0, Infinity, 20)];
    assert.equal(nextRange([], jobs, 22, options).from, 310); // the usual split instead
    const runs = [run(0, 100, { first: true })];
    assert.equal(nextRange(runs, [], 50, options).from, 100);
  });

  test("a focus behind a busy job, in a gap, starts there", () => {
    const runs = [run(0, 100, { first: true })];
    const range = nextRange(runs, [job(300, Infinity, 350)], 200, options);
    assert.deepEqual(range, { from: 195, to: 300, lower: 100, after: -1, split: -1 });
  });
});
