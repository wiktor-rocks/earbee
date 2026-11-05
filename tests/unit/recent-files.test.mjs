// electron/recent-files.js: the list of projects and files opened lately.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, test } from "node:test";

const { createRecentFiles } = createRequire(import.meta.url)("../../electron/recent-files.js");

const folder = fs.mkdtempSync(path.join(os.tmpdir(), "earbee-recent-test-"));
const listFile = path.join(folder, "settings", "recent-files.json");
const song = (name) => path.join(folder, "music", name);
const names = (entries) => entries.map((entry) => entry.name);
after(() => fs.rmSync(folder, { recursive: true, force: true }));

describe("the recent files", () => {
  beforeEach(() => fs.rmSync(listFile, { force: true }));

  test("nothing yet: both lists are empty", () => {
    assert.deepEqual(createRecentFiles(listFile).list(), { projects: [], files: [] });
  });

  test("newest first, each list on its own", () => {
    const recent = createRecentFiles(listFile);
    recent.add("files", song("a.mp3"));
    recent.add("files", song("b.mp3"));
    recent.add("projects", song("c.ebee"));
    const { projects, files } = recent.list();
    assert.deepEqual(names(files), ["b.mp3", "a.mp3"]);
    assert.deepEqual(names(projects), ["c.ebee"]);
  });

  test("the page sees a name, a folder and an id, not the path", () => {
    const recent = createRecentFiles(listFile);
    recent.add("files", song("a.mp3"));
    const [entry] = recent.list().files;
    assert.deepEqual(Object.keys(entry).sort(), ["folder", "id", "name"]);
    assert.equal(entry.name, "a.mp3");
    assert.equal(entry.folder, path.join(folder, "music"));
    assert.ok(!entry.id.includes("a.mp3"));
  });

  test("opening one again moves it to the top, without a second entry", () => {
    const recent = createRecentFiles(listFile);
    recent.add("files", song("a.mp3"));
    recent.add("files", song("b.mp3"));
    recent.add("files", song("a.mp3"));
    assert.deepEqual(names(recent.list().files), ["a.mp3", "b.mp3"]);
  });

  test("the oldest drop off, per list", () => {
    const recent = createRecentFiles(listFile, { max: 2 });
    for (const name of ["a.mp3", "b.mp3", "c.mp3"]) recent.add("files", song(name));
    recent.add("projects", song("d.ebee"));
    assert.deepEqual(names(recent.list().files), ["c.mp3", "b.mp3"]);
    assert.deepEqual(names(recent.list().projects), ["d.ebee"]);
  });

  test("an id finds its entry, and the same id comes back next time", () => {
    const recent = createRecentFiles(listFile);
    recent.add("projects", song("c.ebee"));
    recent.add("files", song("a.mp3"));
    const { id } = recent.list().projects[0];
    assert.deepEqual(recent.find(id), { kind: "projects", path: song("c.ebee") });
    assert.equal(createRecentFiles(listFile).list().projects[0].id, id);
    assert.equal(recent.find("nothing"), null);
  });

  test("an id stops working once its entry is gone", () => {
    const recent = createRecentFiles(listFile);
    recent.add("files", song("a.mp3"));
    recent.add("files", song("b.mp3"));
    const [newest] = recent.list().files;
    recent.remove(newest.id);
    assert.deepEqual(names(recent.list().files), ["a.mp3"]);
    assert.equal(recent.find(newest.id), null);
  });

  test("clearing empties both lists", () => {
    const recent = createRecentFiles(listFile);
    recent.add("files", song("a.mp3"));
    recent.add("projects", song("c.ebee"));
    recent.clear();
    assert.deepEqual(recent.list(), { projects: [], files: [] });
    recent.add("files", song("b.mp3"));
    assert.deepEqual(names(recent.list().files), ["b.mp3"], "and the list still works afterwards");
  });

  test("two EarBees on one list don't erase each other's entries", () => {
    const first = createRecentFiles(listFile);
    const second = createRecentFiles(listFile);
    first.add("files", song("a.mp3"));
    second.add("files", song("b.mp3"));
    first.add("projects", song("c.ebee"));
    assert.deepEqual(names(second.list().files), ["b.mp3", "a.mp3"]);
    assert.deepEqual(names(second.list().projects), ["c.ebee"]);
  });

  test("a damaged file is an empty list, and is replaced by the next change", () => {
    fs.mkdirSync(path.dirname(listFile), { recursive: true });
    fs.writeFileSync(listFile, "{ not json");
    const recent = createRecentFiles(listFile);
    assert.deepEqual(recent.list(), { projects: [], files: [] });
    recent.add("files", song("a.mp3"));
    assert.deepEqual(names(createRecentFiles(listFile).list().files), ["a.mp3"]);
  });

  test("what isn't an absolute path in the file is left out", () => {
    fs.mkdirSync(path.dirname(listFile), { recursive: true });
    const saved = { projects: "nope", files: [song("a.mp3"), "relative.mp3", 7, null, song("a.mp3")] };
    fs.writeFileSync(listFile, JSON.stringify(saved));
    const { projects, files } = createRecentFiles(listFile).list();
    assert.deepEqual(projects, []);
    assert.deepEqual(names(files), ["a.mp3"]);
  });

  test("a change is heard, and leaves no temporary file behind", () => {
    const recent = createRecentFiles(listFile);
    let heard = 0;
    recent.onChange(() => heard++);
    recent.add("files", song("a.mp3"));
    recent.clear();
    assert.equal(heard, 2);
    assert.deepEqual(fs.readdirSync(path.dirname(listFile)), ["recent-files.json"]);
  });
});
