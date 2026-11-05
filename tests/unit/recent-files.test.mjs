// electron/recent-files.js: the list of projects and files opened lately.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, test } from "node:test";

const require = createRequire(import.meta.url);
const { createRecentFiles, handleRecentFiles } = require("../../electron/recent-files.js");
const { createMediaFiles } = require("../../electron/media-files.js");

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

describe("what the page can ask", () => {
  const sender = { name: "the page" };
  const real = path.join(folder, "real");
  const songFile = path.join(real, "song.mp3");
  const projectFile = path.join(real, "work.ebee");
  fs.mkdirSync(real, { recursive: true });
  fs.writeFileSync(songFile, "song");
  fs.writeFileSync(projectFile, "project");

  // The handlers, with a stand-in for ipcMain, projects and the pages.
  function setup() {
    fs.rmSync(listFile, { force: true });
    const handlers = new Map();
    const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler) };
    const ask = (channel, ...args) => handlers.get(channel)({ sender }, ...args);
    const recentFiles = createRecentFiles(listFile);
    const mediaFiles = createMediaFiles();
    const opened = [];
    const projectFiles = {
      open: async (from, file) => (opened.push([from, file]), { ok: true, path: file, sections: {} }),
    };
    const sent = [];
    const page = { isDestroyed: () => false, send: (channel, lists) => sent.push([channel, lists]) };
    const gone = { isDestroyed: () => true, send: () => assert.fail("a closed window was told") };
    handleRecentFiles(ipcMain, recentFiles, { mediaFiles, projectFiles, pages: () => [page, gone] });
    return { ask, recentFiles, mediaFiles, opened, sent };
  }

  test("a file opens by its id, as a URL of its own", async () => {
    const { ask, recentFiles, mediaFiles } = setup();
    recentFiles.add("files", songFile);
    const [{ id }] = (await ask("recent:list")).files;
    const answer = await ask("recent:open", id);
    assert.equal(answer.ok, true);
    assert.equal(answer.media.name, "song.mp3");
    assert.equal(mediaFiles.lookup(answer.media.url).path, songFile);
  });

  test("a project opens through the project files", async () => {
    const { ask, recentFiles, opened } = setup();
    recentFiles.add("projects", projectFile);
    const [{ id }] = (await ask("recent:list")).projects;
    assert.equal((await ask("recent:open", id)).path, projectFile);
    assert.deepEqual(opened, [[sender, projectFile]]);
  });

  test("anything not on the list opens nothing, a path least of all", async () => {
    const { ask, opened } = setup();
    for (const id of ["nothing", songFile, "/etc/passwd", undefined]) {
      const answer = await ask("recent:open", id);
      assert.equal(answer.ok, false);
      assert.match(answer.error, /isn't on the list/);
    }
    assert.deepEqual(opened, []);
  });

  test("a file that has gone says so and comes off the list", async () => {
    const { ask, recentFiles } = setup();
    const missing = path.join(real, "gone.mp3");
    recentFiles.add("files", missing);
    const [{ id }] = (await ask("recent:list")).files;
    const answer = await ask("recent:open", id);
    assert.equal(answer.ok, false);
    assert.equal(answer.error, `“gone.mp3” isn't in ${real} any more, so it's off the list.`);
    assert.deepEqual((await ask("recent:list")).files, []);
  });

  test("a project that has gone says so too, without being opened", async () => {
    const { ask, recentFiles, opened } = setup();
    recentFiles.add("projects", path.join(real, "gone.ebee"));
    const [{ id }] = (await ask("recent:list")).projects;
    assert.match((await ask("recent:open", id)).error, /“gone\.ebee” isn't in .* any more/);
    assert.deepEqual((await ask("recent:list")).projects, []);
    assert.deepEqual(opened, []);
  });

  test("noting a whole file lists the file", async () => {
    const { ask, mediaFiles, recentFiles } = setup();
    await ask("recent:note", mediaFiles.share(songFile));
    assert.deepEqual(names(recentFiles.list().files), ["song.mp3"]);
    assert.deepEqual(recentFiles.list().projects, []);
  });

  test("noting a project's song lists the project, not the song", async () => {
    const { ask, mediaFiles, recentFiles } = setup();
    await ask("recent:note", mediaFiles.share(songFile, { project: projectFile }));
    assert.deepEqual(names(recentFiles.list().projects), ["work.ebee"]);
    assert.deepEqual(recentFiles.list().files, []);
  });

  test("the song inside a project lists the project too", async () => {
    const { ask, mediaFiles, recentFiles } = setup();
    await ask(
      "recent:note",
      mediaFiles.share(projectFile, { offset: 10, size: 5, name: "s.mp3", project: projectFile }),
    );
    assert.deepEqual(names(recentFiles.list().projects), ["work.ebee"]);
    assert.deepEqual(recentFiles.list().files, []);
  });

  test("a slice, an unknown URL or a path lists nothing", async () => {
    const { ask, mediaFiles, recentFiles } = setup();
    await ask("recent:note", mediaFiles.share(projectFile, { offset: 10, size: 5, name: "vocals" }));
    for (const url of ["earbee-media://not-a-token/x.mp3", songFile, "/etc/passwd", "file:///etc/passwd", undefined]) {
      await ask("recent:note", url);
    }
    assert.deepEqual(recentFiles.list(), { projects: [], files: [] });
  });

  test("removing and clearing answer the lists after it", async () => {
    const { ask, recentFiles } = setup();
    recentFiles.add("files", songFile);
    recentFiles.add("projects", projectFile);
    const [{ id }] = (await ask("recent:list")).files;
    assert.deepEqual((await ask("recent:remove", id)).files, []);
    assert.deepEqual(await ask("recent:clear"), { projects: [], files: [] });
  });

  test("every open page hears of a change, a closed one doesn't", () => {
    const { recentFiles, sent } = setup();
    recentFiles.add("files", songFile);
    assert.equal(sent.length, 1);
    assert.equal(sent[0][0], "recent:changed");
    assert.deepEqual(names(sent[0][1].files), ["song.mp3"]);
  });
});
