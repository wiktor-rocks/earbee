// The notification log's entries (src/core/notification-log.js): what's
// kept, and what's read back from storage.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  appendEntry,
  consoleEntry,
  describe,
  formatLog,
  parseLog,
  stamp,
  storedLog,
} from "../../src/core/notification-log.js";

const entry = (text, kind = "done") => ({ time: 1_700_000_000_000, kind, text });

test("appendEntry adds at the end and keeps the newest `max`", () => {
  let log = [];
  for (let i = 0; i < 5; i++) log = appendEntry(log, entry(`n${i}`), 3);
  assert.deepEqual(
    log.map((e) => e.text),
    ["n2", "n3", "n4"],
  );
});

test("appendEntry doesn't change the log it's given", () => {
  const log = [entry("a")];
  appendEntry(log, entry("b"), 10);
  assert.equal(log.length, 1);
});

test("parseLog reads back what was stored", () => {
  const log = [entry("a"), { ...entry("b", "error"), detail: "/a/path" }];
  assert.deepEqual(parseLog(JSON.stringify(log), 200), log);
});

test("parseLog: nothing stored, or broken, is an empty log", () => {
  for (const text of [null, "", "not json", "{}", "42", "null"]) assert.deepEqual(parseLog(text, 200), []);
});

test("parseLog drops only the bad entries, and keeps the newest `max`", () => {
  const stored = [
    entry("ok1"),
    { kind: "done", text: "no time" },
    { ...entry("x"), kind: "shout" },
    { ...entry("x"), text: 5 },
    { ...entry("x"), detail: 5 },
    null,
    entry("ok2"),
    entry("ok3"),
  ];
  assert.deepEqual(
    parseLog(JSON.stringify(stored), 2).map((e) => e.text),
    ["ok2", "ok3"],
  );
});

/* ---------- The master log (2026-11-27) ---------- */

test("parseLog keeps a warning, and a repeat count", () => {
  const log = [{ ...entry("behind", "warning"), repeat: 3 }];
  assert.deepEqual(parseLog(JSON.stringify(log), 200), log);
});

test("appendEntry counts the same entry again instead of adding it", () => {
  let log = [entry("a"), entry("b", "warning")];
  log = appendEntry(log, { ...entry("b", "warning"), time: 1_700_000_000_500 }, 10);
  log = appendEntry(log, { ...entry("b", "warning"), time: 1_700_000_001_000 }, 10);
  assert.equal(log.length, 2);
  assert.equal(log[1].repeat, 3);
  assert.equal(log[1].time, 1_700_000_001_000);
  // Something else in between: a new entry.
  const later = (e) => ({ ...e, time: 1_700_000_002_000 });
  log = appendEntry(appendEntry(log, later(entry("c")), 10), later(entry("b", "warning")), 10);
  assert.equal(log.length, 4);
  assert.equal(log[3].repeat, undefined);
});

test("describe: an Error's stack, then its causes", () => {
  const cause = new Error("the disk is full");
  const error = new Error("Couldn't save", { cause });
  const text = describe(error);
  assert.match(text, /^Error: Couldn't save\n\s+at /);
  assert.match(text, /\nCaused by:\nError: the disk is full\n/);
  assert.equal(describe("plain"), "plain");
  assert.equal(describe({ a: 1 }), '{"a":1}');
  const cyclic = {};
  cyclic.self = cyclic;
  assert.equal(describe(cyclic), "[object Object]");
  // Error-like (from a worker or another window): a message and a stack.
  assert.equal(describe({ name: "TypeError", message: "x is null", stack: "" }), "TypeError: x is null");
});

test("consoleEntry: the first argument is the text, the rest the detail", () => {
  assert.deepEqual(consoleEntry(["Video worker failed:", "no codec"]), {
    text: "Video worker failed:",
    detail: "no codec",
  });
  assert.deepEqual(consoleEntry(["just this"]), { text: "just this" });
  const { text, detail } = consoleEntry([new Error("boom")]);
  assert.equal(text, "boom");
  assert.match(detail, /^Error: boom\n/);
});

test("formatLog: the header, then oldest first, details indented", () => {
  const text = formatLog(
    [
      { ...entry("Opened song.mp3"), detail: "/music/song.mp3" },
      { ...entry("Main: no GPU", "warning"), repeat: 2, detail: "line one\nline two" },
    ],
    ["EarBee 0.3.2 · Linux", "Copied …"],
  );
  const lines = text.split("\n");
  assert.deepEqual(lines.slice(0, 3), ["EarBee 0.3.2 · Linux", "Copied …", ""]);
  assert.match(lines[3], /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d {2}done {5}Opened song\.mp3$/);
  assert.equal(lines[4], "    /music/song.mp3");
  assert.match(lines[5], /warning {2}Main: no GPU \(×2\)$/);
  assert.deepEqual(lines.slice(6, 8), ["    line one", "    line two"]);
  assert.match(stamp(Date.UTC(2026, 10, 27, 12, 0, 0)), /^2026-11-2\d \d\d:00:00$/);
});

test("appendEntry keeps time order: an entry from earlier (the main process's) goes in its place", () => {
  const at = (text, time) => ({ time, kind: "warning", text });
  let log = [at("a", 10), at("c", 30)];
  log = appendEntry(log, at("b", 20), 10);
  assert.deepEqual(
    log.map((e) => e.text),
    ["a", "b", "c"],
  );
  // A repeat keeps the later time.
  log = appendEntry(log, at("c", 25), 10);
  assert.equal(log[2].time, 30);
  assert.equal(log[2].repeat, 2);
});

test("storedLog fits the size: the oldest details go first, then the oldest entries", () => {
  const big = (text) => ({ ...entry(text), detail: "x".repeat(1000) });
  const log = [big("old"), big("mid"), big("new")];
  assert.deepEqual(JSON.parse(storedLog(log, 10_000)), log);
  const fitted = JSON.parse(storedLog(log, 1300));
  assert.deepEqual(
    fitted.map((e) => [e.text, Boolean(e.detail)]),
    [
      ["old", false],
      ["mid", false],
      ["new", true],
    ],
  );
  const tiny = JSON.parse(storedLog(log, 60));
  assert.deepEqual(
    tiny.map((e) => e.text),
    ["new"],
  );
  assert.ok(storedLog(log, 60).length <= 60);
});

test("describe gives samples and big arrays by their size", () => {
  assert.equal(describe({ samples: new Float32Array(48_000) }), '{"samples":"Float32Array(48000)"}');
  assert.equal(describe([...Array(100).keys()]), '"Array(100)"');
});
