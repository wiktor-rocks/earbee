// Zooming into the picture (src/video/zoom.js): what part of the frame
// shows and where, zooming in at a point, moving the view, and that
// nothing it's given makes it give back something that can't be drawn.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { WHOLE, clampView, panBy, safeView, wholeCrop, zoomAround, zoomedView } from "../../src/video/zoom.js";

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

// Every odd input, many times over: sizes from a pixel to 8K and beyond,
// thin and wide frames, zooms past the ends, middles outside the frame,
// and numbers that aren't (NaN, Infinity). Seeded, so a failure repeats.
describe("whatever it's given", () => {
  let seed = 20261027;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = (list) => list[Math.floor(random() * list.length)];
  const ODD = [NaN, Infinity, -Infinity, 0, -1, 1e-9, 1e9];
  const size = () => (random() < 0.05 ? pick(ODD) : random() < 0.1 ? 1 : 1 + Math.floor(random() * 8000));
  const anyNumber = (low, high) => (random() < 0.05 ? pick(ODD) : low + random() * (high - low));
  const finite = (value) => typeof value === "number" && Number.isFinite(value);
  const CASES = 20000;

  const cases = Array.from({ length: CASES }, () => ({
    box: { aspect: random() < 0.05 ? pick(ODD) : 0.1 + random() * 9.9, width: size(), height: size() },
    view: { zoom: anyNumber(0.5, 9), x: anyNumber(-0.5, 1.5), y: anyNumber(-0.5, 1.5) },
    frame: { width: size(), height: size() },
    point: {
      x: anyNumber(-100, 9000),
      y: anyNumber(-100, 9000),
      dx: anyNumber(-5000, 5000),
      dy: anyNumber(-5000, 5000),
    },
  }));
  const valid = ({ box }) => [box.aspect, box.width, box.height].every((n) => finite(n) && n > 0);

  test("a safe view is always finite, within its limits", () => {
    for (const { view } of cases) {
      const safe = safeView(view, 8);
      assert.ok(finite(safe.zoom) && safe.zoom >= 1 && safe.zoom <= 8, JSON.stringify({ view, safe }));
      assert.ok(finite(safe.x) && safe.x >= 0 && safe.x <= 1 && finite(safe.y) && safe.y >= 0 && safe.y <= 1);
    }
    for (const broken of [null, undefined, {}, "zoom", { zoom: "2", x: 0.5, y: 0.5 }, { zoom: 2, x: null, y: 0.5 }])
      assert.deepEqual(safeView(broken, 8), WHOLE);
  });

  test("a box that can't be zoomed (no room, no shape) shows the whole frame, in finite numbers", () => {
    for (const c of cases.filter((c) => !valid(c))) {
      const { crop, rect } = zoomedView(c.box, c.view);
      assert.deepEqual(crop, { left: 0, top: 0, width: 1, height: 1 }, JSON.stringify(c));
      assert.ok([rect.x, rect.y, rect.width, rect.height].every(finite), JSON.stringify(c));
      for (const next of [zoomAround(c.box, c.view, 3, 10, 10), panBy(c.box, c.view, 10, 10), clampView(c.box, c.view)])
        assert.deepEqual(next, WHOLE, JSON.stringify({ c, next }));
    }
  });

  test("what shows is inside the frame, and where it goes inside the box", () => {
    for (const c of cases.filter(valid)) {
      const { crop, rect } = zoomedView(c.box, safeView(c.view, 8));
      const numbers = [crop.left, crop.top, crop.width, crop.height, rect.x, rect.y, rect.width, rect.height];
      assert.ok(numbers.every(finite), JSON.stringify(c));
      const e = 1e-9;
      assert.ok(crop.left >= -e && crop.top >= -e && crop.width > 0 && crop.height > 0, JSON.stringify(c));
      assert.ok(crop.left + crop.width <= 1 + e && crop.top + crop.height <= 1 + e, JSON.stringify(c));
      assert.ok(rect.x >= -e * c.box.width && rect.y >= -e * c.box.height, JSON.stringify(c));
      assert.ok(rect.x + rect.width <= c.box.width * (1 + e) && rect.y + rect.height <= c.box.height * (1 + e));
    }
  });

  test("the crop in whole pixels is always whole, at least one, inside the frame", () => {
    for (const c of cases) {
      const crop = valid(c)
        ? zoomedView(c.box, safeView(c.view, 8)).crop
        : { left: c.view.x, top: c.view.y, width: c.view.zoom, height: c.point.x };
      const whole = wholeCrop(crop, c.frame.width, c.frame.height);
      const frameWidth = finite(c.frame.width) ? Math.max(1, Math.round(c.frame.width)) : 1;
      const frameHeight = finite(c.frame.height) ? Math.max(1, Math.round(c.frame.height)) : 1;
      const label = JSON.stringify({ c, crop, whole });
      assert.ok([whole.left, whole.top, whole.width, whole.height].every(Number.isInteger), label);
      assert.ok(whole.left >= 0 && whole.top >= 0 && whole.width >= 1 && whole.height >= 1, label);
      assert.ok(whole.left + whole.width <= frameWidth && whole.top + whole.height <= frameHeight, label);
    }
  });

  test("zooming in at a point and moving always give a view that's safe as it is", () => {
    for (const c of cases.filter(valid)) {
      const view = safeView(c.view, 8);
      for (const next of [
        zoomAround(c.box, view, safeView({ ...view, zoom: c.view.zoom * 2 }, 8).zoom, c.point.x, c.point.y),
        panBy(c.box, view, c.point.dx, c.point.dy),
      ]) {
        assert.ok([next.zoom, next.x, next.y].every(finite), JSON.stringify({ c, next }));
        assert.deepEqual(safeView(next, 8), next, JSON.stringify({ c, next }));
      }
    }
  });
});
