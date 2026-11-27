// The main process's warnings and errors, for the page's log
// (electron/main-log.js): what waits for a page, what's sent, and a
// utility process's stderr.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { captureConsole, createMainLog, entryFor, forwardStderr } = require("../../electron/main-log.js");

// A page's webContents, as far as the log uses it.
function fakePage() {
  const page = new EventEmitter();
  page.sent = [];
  page.crashed = false;
  page.destroyed = false;
  page.send = (channel, entry) => page.sent.push({ channel, entry });
  page.isCrashed = () => page.crashed;
  page.isDestroyed = () => page.destroyed;
  return page;
}

test("before a page asks, entries wait (the newest `max`); the page then gets them once", () => {
  let time = 0;
  const log = createMainLog({ max: 2, now: () => ++time });
  log.add("Main: one");
  log.add("Main: two", "detail");
  log.add("Main: three");
  const page = fakePage();
  assert.deepEqual(log.take(page), [
    { time: 2, kind: "warning", text: "Main: two", detail: "detail" },
    { time: 3, kind: "warning", text: "Main: three" },
  ]);
  assert.deepEqual(log.take(page), []);
});

test("once a page has asked, new entries go to it; reloading or crashing, they wait again", () => {
  const log = createMainLog({ now: () => 5 });
  const page = fakePage();
  log.take(page);
  log.add("Main: live");
  assert.deepEqual(page.sent, [{ channel: "log:entry", entry: { time: 5, kind: "warning", text: "Main: live" } }]);

  page.crashed = true; // the page's process died: system.js logs why
  log.add("Main: Page process gone: crashed");
  assert.equal(page.sent.length, 1);
  page.crashed = false;
  page.emit("did-start-loading"); // the reload
  log.add("Main: while loading");
  assert.equal(page.sent.length, 1);
  assert.deepEqual(
    log.take(page).map((entry) => entry.text),
    ["Main: Page process gone: crashed", "Main: while loading"],
  );
});

test("captureConsole: warn and error still print, and become entries with the stack", () => {
  const printed = [];
  const target = { warn: (...args) => printed.push(args), error: (...args) => printed.push(args) };
  const log = createMainLog({ now: () => 1 });
  captureConsole(log, /** @type {any} */ (target));
  target.warn("Couldn't open the link:", "no browser");
  target.error(new Error("boom"));
  assert.equal(printed.length, 2);
  const [first, second] = log.waiting();
  assert.deepEqual(first, { time: 1, kind: "warning", text: "Main: Couldn't open the link:", detail: "no browser" });
  assert.equal(second.text, "Main: boom");
  assert.equal(second.kind, "error"); // console.error stays an error
  assert.match(second.detail, /^Error: boom\n/);
});

test("entryFor: an Error's cause comes along", () => {
  const { detail } = entryFor(["Failed:", new Error("outer", { cause: new Error("inner") })]);
  assert.match(detail, /Error: outer[\s\S]*Caused by:\nError: inner/);
});

test("forwardStderr: a burst of lines is one warning, the first line its text", async () => {
  const stderr = new EventEmitter();
  const warned = [];
  forwardStderr({ stderr }, "Stems", { gapMs: 10, warn: (...args) => warned.push(args) });
  stderr.emit("data", Buffer.from("W onnxruntime: first\n"));
  stderr.emit("data", Buffer.from("second\n\n"));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(warned, [["Stems: W onnxruntime: first", "second"]]);
  stderr.emit("data", "last");
  stderr.emit("end");
  assert.deepEqual(warned[1], ["Stems: last", undefined]);
});

test("forwardStderr's lines go into the log under their own name, not as the main process's", async () => {
  const printed = [];
  const target = { warn: (...args) => printed.push(args), error: () => {} };
  const log = createMainLog({ now: () => 1 });
  captureConsole(log, /** @type {any} */ (target));
  const stderr = new EventEmitter();
  forwardStderr({ stderr }, "Beat model", { gapMs: 5 });
  stderr.emit("data", "W onnxruntime: slow\n");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(log.waiting(), [{ time: 1, kind: "warning", text: "Beat model: W onnxruntime: slow" }]);
  assert.deepEqual(printed, [["Beat model: W onnxruntime: slow"]]);
});
