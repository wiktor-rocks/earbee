// Zooming into the picture (src/video/zoom.js): what part of the frame
// shows and where, zooming in at a point, and moving the view.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { WHOLE, clampView, panBy, zoomAround, zoomedView } from "../../src/video/zoom.js";

// A 16:9 frame in a box wider than it (letterboxed left and right).
const BOX = { aspect: 16 / 9, width: 1000, height: 400 };
const near = (a, b, digits = 6) => assert.equal(a.toFixed(digits), b.toFixed(digits));

describe("what shows", () => {
  test("at 1×, the whole frame, letterboxed in the middle", () => {
    const { crop, rect } = zoomedView(BOX, WHOLE);
    assert.deepEqual(crop, { left: 0, top: 0, width: 1, height: 1 });
    near(rect.height, 400);
    near(rect.width, 400 * (16 / 9));
    near(rect.x, (1000 - rect.width) / 2);
    near(rect.y, 0);
  });

  test("zooming in, the picture first fills the box's width, then shows a part of the frame", () => {
    // 1000 / 711.1 ≈ 1.41: at 1.2× still letterboxed, the whole frame;
    let { crop, rect } = zoomedView(BOX, { zoom: 1.2, x: 0.5, y: 0.5 });
    near(crop.width, 1);
    assert.ok(rect.width < 1000 && rect.x > 0);
    assert.ok(crop.height < 1); // (taller than the box: the top and bottom go)
    // at 2×, the box is filled, and half of the frame's height shows.
    ({ crop, rect } = zoomedView(BOX, { zoom: 2, x: 0.5, y: 0.5 }));
    near(rect.width, 1000);
    near(rect.height, 400);
    near(crop.height, 0.5);
    near(crop.width, 1000 / (800 * (16 / 9)));
  });

  test("the middle is kept so what shows stays inside the frame", () => {
    const view = clampView(BOX, { zoom: 2, x: 0, y: 1 });
    const { crop } = zoomedView(BOX, view);
    near(crop.left, 0);
    near(crop.top + crop.height, 1);
  });

  test("below 1×, it stays at 1×", () => {
    assert.equal(clampView(BOX, { zoom: 0.5, x: 0.2, y: 0.9 }).zoom, 1);
    assert.deepEqual(zoomedView(BOX, { zoom: 0.5, x: 0.2, y: 0.9 }).crop, { left: 0, top: 0, width: 1, height: 1 });
  });
});

describe("zooming in at a point", () => {
  // The frame's point (fractions) under the box's point.
  const under = (view, px, py) => {
    const { crop, rect } = zoomedView(BOX, view);
    return [
      crop.left + ((px - rect.x) / rect.width) * crop.width,
      crop.top + ((py - rect.y) / rect.height) * crop.height,
    ];
  };

  test("the point under the pointer stays under it", () => {
    let view = zoomAround(BOX, WHOLE, 3, 600, 120);
    const before = under(WHOLE, 600, 120);
    const after = under(view, 600, 120);
    near(after[0], before[0]);
    near(after[1], before[1]);
    // and again, further in
    const next = zoomAround(BOX, view, 6, 600, 120);
    near(under(next, 600, 120)[0], before[0]);
    view = next;
    assert.equal(view.zoom, 6);
  });

  test("at a corner, the view goes to that corner of the frame", () => {
    const view = zoomAround(BOX, WHOLE, 4, 1000, 400); // the bottom right corner
    const { crop } = zoomedView(BOX, view);
    near(crop.left + crop.width, 1);
    near(crop.top + crop.height, 1);
  });

  test("zooming back out to 1× shows the whole frame again", () => {
    const view = zoomAround(BOX, zoomAround(BOX, WHOLE, 4, 300, 100), 1, 300, 100);
    assert.deepEqual(zoomedView(BOX, view).crop, { left: 0, top: 0, width: 1, height: 1 });
  });
});

describe("moving the view", () => {
  test("dragging moves the picture with the pointer", () => {
    const view = { zoom: 4, x: 0.5, y: 0.5 };
    const moved = panBy(BOX, view, -100, 50); // dragged left and down
    const { crop, rect } = zoomedView(BOX, view);
    near(moved.x, 0.5 + (100 / rect.width) * crop.width);
    near(moved.y, 0.5 - (50 / rect.height) * crop.height);
  });

  test("it stops at the frame's edges", () => {
    const moved = panBy(BOX, { zoom: 2, x: 0.5, y: 0.5 }, 1e6, 1e6);
    const { crop } = zoomedView(BOX, moved);
    near(crop.left, 0);
    near(crop.top, 0);
  });

  test("at 1×, there's nothing to move", () => {
    assert.deepEqual(panBy(BOX, WHOLE, 200, 200), WHOLE);
  });
});
