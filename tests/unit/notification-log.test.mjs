// The notification log's entries (src/core/notification-log.js): what's
// kept, and what's read back from storage.
import assert from "node:assert/strict";
import { test } from "node:test";
import { appendEntry, parseLog } from "../../src/core/notification-log.js";

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
