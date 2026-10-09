// src/marks: what a mark is, the store, and the saved form.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MARKS_VERSION, MarksFormatError, createMarks, parseMarks } from "../../src/marks/index.js";
import { DEFAULT_MARK_COLOR } from "../../src/themes/index.js";

const track = (duration = 60) => {
  const marks = createMarks({ minSeconds: 0.05 });
  marks.reset(duration);
  return marks;
};

describe("the marks store", () => {
  test("points and regions, with default labels and colour, kept in order", () => {
    const marks = track();
    const a = marks.addPoint(10);
    const b = marks.addRegion(8, 4); // either order
    const c = marks.addPoint(2);
    assert.deepEqual(a, { id: "m1", start: 10, end: null, label: "Mark 1", color: DEFAULT_MARK_COLOR });
    assert.deepEqual([b.start, b.end, b.label], [4, 8, "Region 1"]);
    assert.equal(c.label, "Mark 2");
    assert.deepEqual(
      marks.list().map((mark) => mark.id),
      ["m3", "m2", "m1"],
    );
  });

  test("a point sorts before a region starting at the same time", () => {
    const marks = track();
    marks.addRegion(5, 9);
    marks.addPoint(5);
    assert.deepEqual(
      marks.list().map((mark) => mark.end),
      [null, 9],
    );
  });

  test("times stay inside the track; a region too short isn't made", () => {
    const marks = track(60);
    assert.equal(marks.addPoint(-3).start, 0);
    assert.equal(marks.addPoint(99).start, 60);
    assert.equal(marks.addRegion(10, 10.01), null);
    assert.equal(marks.list().length, 2);
  });

  test("the next default label follows the highest number", () => {
    const marks = track();
    marks.addPoint(1);
    const second = marks.addPoint(2);
    marks.addPoint(3);
    marks.remove(second.id);
    assert.equal(marks.addPoint(4).label, "Mark 4");
    assert.equal(marks.addPoint(5, { label: "Chorus" }).label, "Chorus");
  });

  test("update: times, label, colour; refused when there's no mark or a region gets too short", () => {
    const marks = track();
    const region = marks.addRegion(4, 8);
    assert.deepEqual(marks.update(region.id, { start: 9 }), { ...region, start: 8, end: 9 }); // swapped
    assert.equal(marks.update(region.id, { end: 8.01 }), null);
    assert.equal(marks.update("nope", { label: "x" }), null);
    const renamed = marks.update(region.id, { label: "  Verse  ", color: "blue" });
    assert.deepEqual([renamed.label, renamed.color], ["Verse", "blue"]);
    assert.equal(marks.update(region.id, { color: "plaid" }).color, DEFAULT_MARK_COLOR);
  });

  test("tells listeners once per change, not for no change", () => {
    const marks = track();
    const heard = [];
    marks.on("change", (list) => heard.push(list.length));
    const point = marks.addPoint(1);
    marks.update(point.id, { start: 1 }); // the same
    marks.update(point.id, { start: 2 });
    marks.remove(point.id);
    marks.remove(point.id); // gone already
    assert.deepEqual(heard, [1, 1, 0]);
  });

  test("marks can't be changed from outside", () => {
    const marks = track();
    const point = marks.addPoint(1);
    assert.throws(() => {
      point.start = 5;
    });
    marks.list().pop();
    assert.equal(marks.list().length, 1);
  });

  test("previous and next, by start, skipping the one at the cursor", () => {
    const marks = track();
    marks.addPoint(2);
    marks.addRegion(5, 9);
    marks.addPoint(12);
    assert.equal(marks.next(0).start, 2);
    assert.equal(marks.next(5).start, 12);
    assert.equal(marks.next(12), null);
    assert.equal(marks.previous(5).start, 2);
    assert.equal(marks.previous(5.2).start, 5);
    assert.equal(marks.previous(5.2, 0.5).start, 2); // just past it: the one before
    assert.equal(marks.previous(2), null);
  });

  test("a new track starts empty, numbering again from 1", () => {
    const marks = track();
    marks.addPoint(1);
    marks.reset(30);
    assert.deepEqual(marks.list(), []);
    assert.equal(marks.addPoint(1).id, "m1");
  });
});

describe("the saved form", () => {
  test("round-trips through reset(), keeping ids and numbering after them", () => {
    const marks = track();
    marks.addPoint(3, { label: "Intro", color: "green" });
    marks.addRegion(10, 20);
    const saved = JSON.parse(JSON.stringify(marks.toJSON()));
    assert.equal(saved.version, MARKS_VERSION);

    const reopened = createMarks();
    reopened.reset(60, saved);
    assert.deepEqual(reopened.list(), marks.list());
    assert.equal(reopened.addPoint(30).id, "m3");
  });

  test("bad entries are left out, the rest checked against the track", () => {
    const limits = { duration: 30, minSeconds: 0.05 };
    const parsed = parseMarks(
      {
        version: 1,
        marks: [
          { id: "a", start: 5, end: null, label: "ok", color: "blue" },
          { id: "a", start: 6, end: null }, // same id again
          { id: "b", start: "5" }, // not a number
          { id: "bad id!", start: 1 },
          null,
          { id: "c", start: 25, end: 99, label: 7 }, // past the end; label not text
          { id: "d", start: 10, end: 10.01 }, // too short: a point
          { id: "e", start: 1, label: "x".repeat(500), color: "plaid" },
        ],
      },
      limits,
    );
    assert.deepEqual(
      parsed.map((mark) => [mark.id, mark.start, mark.end]),
      [
        ["e", 1, null],
        ["a", 5, null],
        ["d", 10, null],
        ["c", 25, 30],
      ],
    );
    const e = parsed[0];
    assert.equal(e.label.length, 200);
    assert.equal(e.color, DEFAULT_MARK_COLOR);
    assert.equal(parsed[3].label, "");
  });

  test("refuses what isn't marks, or comes from a newer version", () => {
    const limits = { duration: 30, minSeconds: 0.05 };
    assert.throws(() => parseMarks({ marks: [] }, limits), MarksFormatError);
    assert.throws(() => parseMarks("[]", limits), MarksFormatError);
    assert.throws(() => parseMarks({ version: MARKS_VERSION + 1, marks: [] }, limits), /newer TranscriBee/);
  });
});
