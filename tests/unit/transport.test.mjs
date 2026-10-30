// The transport (src/audio/transport.js) against a fake audio engine and a
// fake clock: positions, pausing at what was heard, seeking, speed changes,
// the A–B loop and the end of the track.
import assert from "node:assert/strict";
import { beforeEach, describe, mock, test } from "node:test";
import { createTransport } from "../../src/audio/transport.js";

// One clock (seconds) drives both the engine's AudioContext time and
// performance.now(), as in the browser.
let clock = 0;
let outputDelay = 0;
let frames = [];
let rate = 1;
let scheduled = [];

Object.defineProperty(globalThis, "performance", { value: { now: () => clock * 1000 }, configurable: true });
globalThis.requestAnimationFrame = (callback) => frames.push(callback);
globalThis.cancelAnimationFrame = () => {
  frames = [];
};

const engine = {
  now: () => clock,
  outputDelay: () => outputDelay,
  schedule: (segment) => scheduled.push(segment),
};

// Runs the pending animation frame (the transport requests the next one itself).
function frame() {
  const pending = frames;
  frames = [];
  for (const callback of pending) callback();
}

const near = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message ?? ""} expected ${expected}, got ${actual}`);

function setup(duration = 10) {
  const transport = createTransport({ engine, getRate: () => rate, getSemitones: () => 0 });
  const events = [];
  for (const name of ["state", "jump"]) transport.on(name, (value) => events.push([name, value]));
  transport.load(duration);
  events.length = 0;
  scheduled = [];
  return { transport, events };
}

beforeEach(() => {
  clock = 0;
  outputDelay = 0;
  frames = [];
  rate = 1;
  scheduled = [];
});

describe("loading", () => {
  test("a track makes it ready at 0; no track makes it empty", () => {
    const transport = createTransport({ engine, getRate: () => rate, getSemitones: () => 0 });
    assert.equal(transport.state, "empty");
    transport.load(10);
    assert.equal(transport.state, "ready");
    assert.equal(transport.position, 0);
    assert.equal(transport.duration, 10);
    transport.load(0);
    assert.equal(transport.state, "empty");
  });

  test("a new track is announced even when the old one was still ready", () => {
    const { transport, events } = setup();
    transport.seek(4); // no state change: still "ready"
    events.length = 0;
    transport.load(20);
    assert.deepEqual(
      events.filter(([name]) => name === "state"),
      [["state", "ready"]],
    );
  });
});

describe("playing", () => {
  test("the position follows the clock at the current speed", () => {
    const { transport } = setup();
    rate = 0.5;
    transport.play();
    assert.equal(transport.state, "playing");
    clock = 4;
    near(transport.position, 2);
    assert.deepEqual(
      { input: scheduled[0].input, rate: scheduled[0].rate, active: scheduled[0].active },
      { input: 0, rate: 0.5, active: true },
    );
  });

  test("a speed change continues from the same spot, without a jump", () => {
    const { transport, events } = setup();
    transport.play();
    clock = 2;
    rate = 2;
    transport.retune();
    near(transport.position, 2);
    clock = 3;
    near(transport.position, 4);
    assert.ok(!events.some(([name]) => name === "jump"));
  });

  test("pause stops at what was being heard, not where the engine is", () => {
    const { transport } = setup();
    outputDelay = 0.1;
    transport.play();
    clock = 2;
    transport.pause(performance.now());
    assert.equal(transport.state, "paused");
    near(transport.position, 1.9);
    near(scheduled.at(-1).input, 1.9);
    assert.equal(scheduled.at(-1).active, false);
  });

  test("a pause asked for earlier (an older event) stops earlier", () => {
    const { transport } = setup();
    transport.play();
    clock = 3;
    transport.pause(2500); // the key went down 0.5 s ago
    near(transport.position, 2.5);
  });

  test("stop returns to 0", () => {
    const { transport } = setup();
    transport.play();
    clock = 3;
    transport.stop();
    assert.equal(transport.state, "stopped");
    assert.equal(transport.position, 0);
  });
});

describe("seeking", () => {
  test("while paused: moves there and reports a jump", () => {
    const { transport, events } = setup();
    transport.seek(4);
    assert.equal(transport.position, 4);
    assert.deepEqual(events.at(-1), ["jump", 4]);
    assert.equal(transport.state, "ready");
  });

  test("while playing: keeps playing from there; clamped to the track", () => {
    const { transport } = setup();
    transport.play();
    clock = 1;
    transport.seek(7);
    clock = 2;
    near(transport.position, 8);
    transport.seek(99);
    near(scheduled.at(-1).input, 10);
  });
});

describe("end of the track", () => {
  test("playing to the end stops there and ends; Play starts again from 0", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const { transport } = setup(3);
      transport.play();
      clock = 3;
      mock.timers.tick(3000);
      assert.equal(transport.state, "ended");
      assert.equal(transport.position, 3);
      transport.play();
      near(scheduled.at(-1).input, 0);
    } finally {
      mock.timers.reset();
    }
  });

  test("a looping track never ends", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const { transport } = setup(3);
      transport.setLoop({ start: 1, end: 2 });
      transport.play();
      clock = 100;
      mock.timers.tick(100_000);
      assert.equal(transport.state, "playing");
    } finally {
      mock.timers.reset();
    }
  });
});

describe("A–B loop", () => {
  test("segments always carry the loop (0, 0 when there is none)", () => {
    const { transport } = setup();
    transport.play();
    assert.deepEqual([scheduled.at(-1).loopStart, scheduled.at(-1).loopEnd], [0, 0]);
    transport.setLoop({ start: 1, end: 3 });
    assert.deepEqual([scheduled.at(-1).loopStart, scheduled.at(-1).loopEnd], [1, 3]);
  });

  test("the position wraps back to the start, and the wrap is a jump marked as one", () => {
    const { transport, events } = setup();
    const marks = [];
    transport.on("jump", (time, info) => marks.push(info));
    transport.setLoop({ start: 1, end: 3 });
    transport.play(); // starts inside the loop: at its start
    near(transport.position, 1);
    clock = 1.5;
    frame();
    near(transport.position, 2.5);
    clock = 2.5; // 1 + 2.5 = 3.5 → wraps to 1.5
    frame();
    near(transport.position, 1.5);
    assert.equal(events.filter(([name]) => name === "jump").length, 1);
    assert.deepEqual(marks, [{ wrapped: true }]);
    // A seek is a jump of its own, not a wrap.
    transport.seek(2);
    assert.equal(marks.at(-1), undefined);
  });

  test("turning a loop on while playing outside it moves to its start", () => {
    const { transport, events } = setup();
    transport.play();
    clock = 5;
    transport.setLoop({ start: 1, end: 3 });
    near(transport.position, 1);
    assert.equal(events.at(-1)[0], "jump");
  });

  test("a playing segment never starts at or after the loop end", () => {
    const { transport } = setup();
    transport.setLoop({ start: 1, end: 3 });
    transport.play();
    transport.seek(5);
    near(scheduled.at(-1).input, 1);
  });

  test("playStartFor says where play() would start, and setLoop reports the loop", () => {
    const { transport } = setup();
    const loops = [];
    transport.on("loop", (loop) => loops.push(loop));
    near(transport.playStartFor(4), 4);
    near(transport.playStartFor(10), 0); // after the end: from the top
    transport.setLoop({ start: 1, end: 3 });
    assert.deepEqual(loops, [{ start: 1, end: 3 }]);
    near(transport.playStartFor(2), 2); // inside the loop
    near(transport.playStartFor(5), 1); // outside: its start
    transport.seek(5);
    transport.play();
    near(transport.position, transport.playStartFor(5));
  });

  test("an empty or reversed loop is no loop", () => {
    const { transport } = setup();
    transport.setLoop({ start: 3, end: 3 });
    assert.deepEqual([scheduled.at(-1).loopStart, scheduled.at(-1).loopEnd], [0, 0]);
  });
});
