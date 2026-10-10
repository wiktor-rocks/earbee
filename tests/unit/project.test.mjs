// Project files (.tbee): the format (src/project/format.js) and reading and
// writing them in the main process (electron/project-files.js), with the
// media inside or linked, served in slices (electron/media-files.js).
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import {
  PROJECT_VERSION,
  ProjectFormatError,
  findHeaderEnd,
  isProjectName,
  parseProject,
  serializeProject,
} from "../../src/project/format.js";

const require = createRequire(import.meta.url);
const { createMediaFiles } = require("../../electron/media-files.js");
const { createProjectFiles, mediaCandidates, projectNameFor, readHeader } = require("../../electron/project-files.js");

const MEDIA = { name: "song.mp3", path: "/music/song.mp3", relativePath: "../music/song.mp3", size: 10, duration: 2 };

describe("the format", () => {
  test("a header round trip keeps the media and the sections as saved", () => {
    const sections = { marks: { version: 1, marks: [] }, future: { version: 9, anything: true } };
    const text = serializeProject({ media: { ...MEDIA, embedded: false }, sections, appVersion: "1.2.3" });
    const data = JSON.parse(text);
    assert.equal(data.format, "transcribee-project");
    assert.equal(data.version, PROJECT_VERSION);
    assert.equal(data.savedWith, "1.2.3");
    assert.deepEqual(parseProject(text), { media: { ...MEDIA, embedded: false }, sections });
  });

  test("a newer project, something else, or no media: refused", () => {
    const header = (fields) => JSON.stringify({ format: "transcribee-project", version: 1, media: MEDIA, ...fields });
    assert.throws(() => parseProject(header({ version: PROJECT_VERSION + 1 })), /newer TranscriBee/);
    assert.throws(() => parseProject(header({ format: "other" })), ProjectFormatError);
    assert.throws(() => parseProject(header({ media: { path: "/x" } })), ProjectFormatError);
    assert.throws(() => parseProject("{ not json"), ProjectFormatError);
    assert.throws(() => parseProject("[]"), ProjectFormatError);
  });

  test("odd fields are cleaned up, missing sections are none", () => {
    const text = JSON.stringify({
      format: "transcribee-project",
      version: 1,
      media: { name: "a.wav", path: 5, size: -1, duration: "x", embedded: "yes" },
    });
    assert.deepEqual(parseProject(text), {
      media: { name: "a.wav", path: null, relativePath: null, size: 0, duration: 0, embedded: false },
      sections: {},
    });
  });

  test("the header ends at the first NUL", () => {
    assert.equal(findHeaderEnd(new Uint8Array([123, 125, 0, 1, 0])), 2);
    assert.equal(findHeaderEnd(new Uint8Array([123, 125])), -1);
    assert.ok(isProjectName("Song.TBEE") && !isProjectName("song.mp3"));
  });
});

describe("main process", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "transcribee-project-test-"));
  after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const bytes = Buffer.from(Array.from({ length: 300 }, (_, i) => i % 251));
  const mediaFile = path.join(folder, "media", "Song [x].m4a");
  fs.mkdirSync(path.dirname(mediaFile));
  fs.writeFileSync(mediaFile, bytes);

  // The dialogs answer what a test sets in `answers`.
  const answers = { save: null, locate: null, asked: [] };
  const dialogs = {
    save: async (_sender, defaultPath) => (answers.asked.push(["save", defaultPath]), answers.save),
    open: async () => null,
    locate: async (_sender, name) => (answers.asked.push(["locate", name]), answers.locate),
    confirm: async () => "cancel",
  };
  const mediaFiles = createMediaFiles();
  const projects = createProjectFiles({ mediaFiles, dialogs, appVersion: "9.9.9" });
  const sections = { marks: { version: 1, marks: [{ id: "m1", start: 1, end: null, label: "A", color: "amber" }] } };
  const body = async (url, range) =>
    Buffer.from(
      await (await mediaFiles.respond(new Request(url, range ? { headers: { Range: range } } : {}))).arrayBuffer(),
    );

  test("a new project is offered under the media's name", () => {
    assert.equal(projectNameFor("Song [x].m4a"), "Song [x].tbee");
  });

  test("saved linked: plain JSON naming the media, absolute and relative", async () => {
    const mediaUrl = mediaFiles.share(mediaFile);
    answers.save = path.join(folder, "projects", "linked"); // the extension is added
    fs.mkdirSync(path.join(folder, "projects"));
    const saved = await projects.save(null, { file: null, mediaUrl, embed: false, duration: 2, sections });
    const target = path.join(folder, "projects", "linked.tbee");
    assert.deepEqual(saved, { ok: true, path: target, name: "linked.tbee", embedded: false, linkable: true });
    assert.deepEqual(answers.asked.at(-1), ["save", path.join(path.dirname(mediaFile), "Song [x].tbee")]);
    const { media, sections: back } = parseProject(fs.readFileSync(target, "utf8"));
    assert.deepEqual(media, {
      name: "Song [x].m4a",
      path: mediaFile,
      relativePath: path.join("..", "media", "Song [x].m4a"),
      size: 300,
      duration: 2,
      embedded: false,
    });
    assert.deepEqual(back, sections);
    assert.deepEqual(fs.readdirSync(path.join(folder, "projects")), ["linked.tbee"], "no temporary file left behind");

    const opened = await projects.open(null, target);
    assert.equal(opened.ok, true);
    assert.deepEqual(opened.sections, sections);
    assert.equal(opened.relinked, false);
    assert.deepEqual(await body(opened.media.url), bytes);
  });

  test("saved with the media inside: served as a slice of the project, even after saving over it", async () => {
    const mediaUrl = mediaFiles.share(mediaFile);
    const target = path.join(folder, "inside.tbee");
    const saved = await projects.save(null, { file: target, mediaUrl, embed: true, duration: 2, sections });
    assert.equal(saved.embedded, true);
    assert.equal(saved.linkable, true, "the media was still its own file");
    const header = await readHeader(target);
    assert.equal(header.fileSize - header.mediaOffset, 300);
    assert.equal(parseProject(header.text).media.path, null, "no path when it's inside");
    assert.deepEqual(await body(mediaUrl), bytes, "the page's URL now reads from the project");

    const opened = await projects.open(null, target);
    assert.equal(opened.embedded, true);
    assert.equal(opened.linkable, false);
    assert.equal(opened.media.name, "Song [x].m4a");
    assert.deepEqual(await body(opened.media.url), bytes);
    assert.deepEqual(await body(opened.media.url, "bytes=10-19"), bytes.subarray(10, 20), "ranges within the slice");

    // Ctrl+S again: written over itself from its own slice, with new sections.
    const more = { marks: { version: 1, marks: [] }, extra: { version: 1, text: "x".repeat(500) } };
    await projects.save(null, { file: target, mediaUrl: opened.media.url, embed: true, duration: 2, sections: more });
    assert.deepEqual(await body(opened.media.url), bytes, "still the media, at its new offset");
    assert.deepEqual((await projects.open(null, target)).sections, more);

    // Only inside a project: it can't become a link.
    await assert.rejects(
      projects.save(null, { file: target, mediaUrl: opened.media.url, embed: false, duration: 2, sections }),
      /inside its project/,
    );
  });

  test("moved together with its media: found by the relative path", async () => {
    const moved = path.join(folder, "moved");
    fs.mkdirSync(path.join(moved, "projects"), { recursive: true });
    fs.mkdirSync(path.join(moved, "media"));
    const copy = path.join(moved, "media", "Song [x].m4a");
    fs.copyFileSync(mediaFile, copy);
    fs.copyFileSync(path.join(folder, "projects", "linked.tbee"), path.join(moved, "projects", "linked.tbee"));
    const candidates = mediaCandidates(path.join(moved, "projects", "linked.tbee"), {
      name: "Song [x].m4a",
      path: mediaFile,
      relativePath: path.join("..", "media", "Song [x].m4a"),
    });
    assert.equal(candidates[0], copy);
    assert.equal(candidates[1], mediaFile);
  });

  test("media gone: the user is asked where it is", async () => {
    const gone = path.join(folder, "gone.m4a");
    fs.writeFileSync(gone, bytes);
    const target = path.join(folder, "gone.tbee");
    await projects.save(null, { file: target, mediaUrl: mediaFiles.share(gone), embed: false, duration: 2, sections });
    fs.rmSync(gone);

    answers.locate = null;
    assert.deepEqual(await projects.open(null, target), { ok: false, canceled: true });
    assert.deepEqual(answers.asked.at(-1), ["locate", "gone.m4a"]);

    answers.locate = mediaFile;
    const opened = await projects.open(null, target);
    assert.equal(opened.relinked, true);
    assert.equal(opened.media.name, "Song [x].m4a");
  });

  test("not a project: refused", async () => {
    const fake = path.join(folder, "fake.tbee");
    fs.writeFileSync(fake, "hello");
    await assert.rejects(projects.open(null, fake), ProjectFormatError);
    await assert.rejects(projects.open(null, mediaFile), ProjectFormatError);
    await assert.rejects(
      projects.save(null, { file: null, mediaUrl: "https://example.com/x", embed: false, duration: 1, sections }),
      /can name/,
    );
  });
});
