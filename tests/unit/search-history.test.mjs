// The search history (src/core/search-history.js): its order, what counts
// as the same search, its size, and reading it back from storage.
import assert from "node:assert/strict";
import { test } from "node:test";
import { addSearch, parseHistory, removeSearch } from "../../src/core/search-history.js";

const search = (text, source = "youtube", time = 1) => ({ text, source, time });
const texts = (history) => history.map((each) => `${each.text}@${each.source}`);

test("addSearch puts the newest first", () => {
  let history = [];
  for (const text of ["a", "b", "c"]) history = addSearch(history, search(text), 20);
  assert.deepEqual(texts(history), ["c@youtube", "b@youtube", "a@youtube"]);
});

test("the same words on the same site move to the top, spaces and case aside", () => {
  let history = [search("one"), search("Back in  Black"), search("two")];
  history = addSearch(history, search("  back in black ", "youtube", 5), 20);
  assert.deepEqual(texts(history), ["back in black@youtube", "one@youtube", "two@youtube"]);
  assert.equal(history[0].time, 5);
});

test("…but on another site they're another search", () => {
  const history = addSearch([search("riff", "youtube")], search("riff", "soundcloud"), 20);
  assert.deepEqual(texts(history), ["riff@soundcloud", "riff@youtube"]);
});

test("addSearch keeps the newest `max`", () => {
  let history = [];
  for (let i = 0; i < 25; i++) history = addSearch(history, search(`s${i}`), 20);
  assert.equal(history.length, 20);
  assert.equal(history[0].text, "s24");
  assert.equal(history[19].text, "s5");
});

test("removeSearch takes out one entry", () => {
  const history = [search("a"), search("b"), search("c")];
  assert.deepEqual(texts(removeSearch(history, 1)), ["a@youtube", "c@youtube"]);
  assert.equal(history.length, 3);
});

test("parseHistory reads back what was stored", () => {
  const history = [search("a", "soundcloud"), search("b")];
  assert.deepEqual(parseHistory(JSON.stringify(history), 20, ["youtube", "soundcloud"]), history);
});

test("parseHistory: nothing stored, or broken, is an empty history", () => {
  for (const text of [null, "", "nope", "{}", "3"]) assert.deepEqual(parseHistory(text, 20, ["youtube"]), []);
});

test("parseHistory leaves out bad entries and sites that are gone, and keeps `max`", () => {
  const stored = [
    search("ok1"),
    search("gone", "myspace"),
    { text: "no time", source: "youtube" },
    search("   "),
    null,
    search("ok2"),
    search("ok3"),
  ];
  assert.deepEqual(texts(parseHistory(JSON.stringify(stored), 2, ["youtube"])), ["ok1@youtube", "ok2@youtube"]);
});
