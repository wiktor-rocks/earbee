// electron/beat-model.js: the beat model's utility process, started on the
// first window and stopped after a minute idle (with a fake process).
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, mock, test } from "node:test";

const { handleBeatModel, WINDOW } = createRequire(import.meta.url)("../../electron/beat-model.js");

const IDLE_MS = 60_000;

// A beat model with fake utility processes: `forks` holds each one started,
// with the messages sent to it (`sent`) and whether it was killed. A fake
// only exits when the test says (like a real one, a moment after kill()).
function fakeModel() {
  const forks = [];
  const utilityProcess = {
    fork() {
      const child = Object.assign(new EventEmitter(), {
        sent: [],
        killed: false,
        postMessage: (message) => child.sent.push(message),
        kill: () => (child.killed = true),
        answer: (index = child.sent.length - 1) =>
          child.emit("message", { id: child.sent[index].id, ok: true, beat: [1], downbeat: [0] }),
      });
      forks.push(child);
      return child;
    },
  };
  const handlers = {};
  handleBeatModel({ handle: (channel, handler) => (handlers[channel] = handler) }, { utilityProcess });
  const run = (input = new Float32Array(WINDOW)) => handlers["beats:window"](null, input);
  return { forks, run };
}

describe("the beat model's process", () => {
  beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
  afterEach(() => mock.timers.reset());

  test("starts on the first window and answers it", async () => {
    const { forks, run } = fakeModel();
    const answer = run();
    assert.equal(forks.length, 1);
    forks[0].answer();
    assert.deepEqual(await answer, { ok: true, beat: [1], downbeat: [0] });
  });

  test("stops after a minute idle, not while a window is running", async () => {
    const { forks, run } = fakeModel();
    const first = run();
    mock.timers.tick(IDLE_MS * 2);
    assert.equal(forks[0].killed, false, "a window is still running");
    forks[0].answer();
    await first;
    mock.timers.tick(IDLE_MS - 1);
    assert.equal(forks[0].killed, false);
    mock.timers.tick(1);
    assert.equal(forks[0].killed, true);
  });

  test("a window just as an idle process stops goes to a new one", async () => {
    const { forks, run } = fakeModel();
    const first = run();
    forks[0].answer();
    await first;
    mock.timers.tick(IDLE_MS); // killed, but not exited yet
    const second = run();
    assert.equal(forks.length, 2, "a new process");
    assert.equal(forks[0].sent.length, 1, "nothing more to the stopping one");
    forks[0].emit("exit", 0); // the old one exits now
    forks[1].answer();
    assert.deepEqual(await second, { ok: true, beat: [1], downbeat: [0] });
  });

  test("a process that dies fails only its own windows; the next window starts a new one", async () => {
    const { forks, run } = fakeModel();
    const lost = run();
    forks[0].emit("exit", 9);
    assert.deepEqual(await lost, { ok: false, error: "the beat model stopped (9)" });
    const next = run();
    assert.equal(forks.length, 2);
    forks[1].answer();
    assert.equal((await next).ok, true);
  });

  test("refuses a window of the wrong size", async () => {
    const { forks, run } = fakeModel();
    const answer = await run(new Float32Array(10));
    assert.equal(answer.ok, false);
    assert.equal(forks.length, 0, "no process started");
  });
});
