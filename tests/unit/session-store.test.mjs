// electron/session-store.js: the last session, kept as you go and offered
// back on the next start; and formatWhen (src/core/format.js), how the
// offer says when.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, test } from "node:test";
import { formatWhen } from "../../src/core/format.js";

const require = createRequire(import.meta.url);
const { createSessionStore, parseSession } = require("../../electron/session-store.js");
const { createMediaFiles } = require("../../electron/media-files.js");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "earbee-session-test-"));
const folder = path.join(root, "last-session");
const music = path.join(root, "music");
fs.mkdirSync(music, { recursive: true });
const songFile = path.join(music, "song.wav");
fs.writeFileSync(songFile, "not really a song");
const projectFile = path.join(music, "work.ebee");
after(() => fs.rmSync(root, { recursive: true, force: true }));

const sender = { id: 1 };
const sections = (extra = {}) => ({ marks: { version: 1, marks: [{ time: 3 }] }, ...extra });

// A store with a stand-in for the project files: opening the project
// answers its own sections (with stems, as URLs).
function setup({ now = () => 1_000, alone = () => false } = {}) {
  const mediaFiles = createMediaFiles();
  const opened = [];
  const projectFiles = {
    open: async (from, file) => {
      opened.push(file);
      return {
        ok: true,
        path: file,
        name: path.basename(file),
        media: { name: "song.wav", url: mediaFiles.share(songFile, { project: file }) },
        sections: { marks: { version: 1, marks: [] }, stems: { version: 1, stems: { audio: { bass: { url: "x" } } } } },
      };
    },
  };
  const store = createSessionStore(folder, { mediaFiles, projectFiles, now, alone });
  return { store, mediaFiles, opened };
}

const sessionJson = () => JSON.parse(fs.readFileSync(path.join(folder, "session.json"), "utf8"));

describe("the last session", () => {
  beforeEach(() => {
    fs.rmSync(folder, { recursive: true, force: true });
    fs.rmSync(projectFile, { force: true });
  });

  test("nothing kept yet: nothing to offer", async () => {
    assert.equal(setup().store.summary(), null);
  });

  test("a song's session is kept by its path, and offered by its name", async () => {
    const { store, mediaFiles } = setup({ now: () => 42 });
    const url = mediaFiles.share(songFile);
    assert.equal(await store.write(sender, { mediaUrl: url, sections: sections(), unsaved: true }), true);
    const saved = sessionJson();
    assert.equal(saved.media.path, songFile);
    assert.equal(saved.project, null);
    assert.deepEqual(saved.sections, sections());
    assert.deepEqual(store.summary(), { name: "song.wav", savedAt: 42, project: null, unsaved: true });
    assert.deepEqual(fs.readdirSync(folder), ["session.json"], "no temporary file left");
  });

  test("media the app didn't share isn't kept", async () => {
    const { store } = setup();
    assert.equal(
      await store.write(sender, { mediaUrl: "earbee-media://nothing/x", sections: sections(), unsaved: false }),
      false,
    );
    assert.equal(store.summary(), null);
  });

  test("a damaged or foreign file is nothing to offer", async () => {
    const { store } = setup();
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, "session.json"), "{ not json");
    assert.equal(store.summary(), null);
    assert.equal(parseSession({ format: "something-else", version: 1, media: { path: songFile } }), null);
    assert.equal(parseSession({ format: "earbee-session", version: 99, media: { path: songFile } }), null);
    assert.equal(parseSession({ format: "earbee-session", version: 1, media: { path: "relative.wav" } }), null);
  });

  test("reopening a song: its URL again, and the sections", async () => {
    const { store, mediaFiles } = setup();
    await store.write(sender, { mediaUrl: mediaFiles.share(songFile), sections: sections(), unsaved: true });
    const opened = await store.open(sender);
    assert.equal(opened.ok, true);
    assert.equal(opened.kind, "media");
    assert.equal(mediaFiles.lookup(opened.media.url).path, songFile);
    assert.deepEqual(opened.sections, sections());
  });

  test("a song that has gone says so", async () => {
    const { store, mediaFiles } = setup();
    const gone = path.join(music, "gone.wav");
    fs.writeFileSync(gone, "x");
    await store.write(sender, { mediaUrl: mediaFiles.share(gone), sections: sections(), unsaved: false });
    fs.rmSync(gone);
    const opened = await store.open(sender);
    assert.equal(opened.ok, false);
    assert.match(opened.error, /gone\.wav.*any more/);
  });

  test("a project's session names the project, and reopens it with the changes over it", async () => {
    const { store, mediaFiles, opened } = setup();
    fs.writeFileSync(projectFile, "{}");
    const url = mediaFiles.share(songFile);
    mediaFiles.belongsTo(url, projectFile); // saved as this project
    await store.write(sender, {
      mediaUrl: url,
      sections: sections({ stems: { version: 1, stems: { audio: "project" } } }),
      unsaved: true,
    });
    assert.equal(sessionJson().project.path, projectFile);
    assert.deepEqual(store.summary(), { name: "work.ebee", savedAt: 1_000, project: "work.ebee", unsaved: true });
    const answer = await store.open(sender);
    assert.deepEqual(opened, [projectFile]);
    assert.equal(answer.changedSince, false);
    assert.deepEqual(answer.session.marks, sections().marks);
    assert.deepEqual(answer.session.stems.stems.audio, { bass: { url: "x" } }, "the project's own stems");
    assert.equal(answer.stemsFrom, "project");
  });

  test("a project saved since opens as saved: its changes are left out", async () => {
    const { store, mediaFiles } = setup();
    fs.writeFileSync(projectFile, "{}");
    const url = mediaFiles.share(songFile, { project: projectFile });
    await store.write(sender, { mediaUrl: url, sections: sections(), unsaved: true });
    const later = new Date(Date.now() + 10_000);
    fs.utimesSync(projectFile, later, later);
    const answer = await store.open(sender);
    assert.equal(answer.changedSince, true);
    assert.deepEqual(answer.session, {});
  });

  test("stems: written a stem at a time, then named by the session, and served back", async () => {
    const { store, mediaFiles } = setup();
    const url = mediaFiles.share(songFile);
    const token = store.beginStems(sender);
    await store.addStem(sender, token, "bass", new Uint8Array([1, 2, 3]));
    await store.addStem(sender, token, "drums", new Uint8Array([4, 5]));
    await store.endStems(sender, token);
    const stemsSection = { version: 1, stems: { codec: "opus", audio: "file" } };
    await store.write(sender, { mediaUrl: url, sections: sections({ stems: stemsSection }), unsaved: true });
    const saved = sessionJson();
    assert.deepEqual(saved.stems.blobs, { bass: { offset: 0, size: 3 }, drums: { offset: 3, size: 2 } });
    assert.deepEqual(fs.readdirSync(folder).sort(), [saved.stems.file, "session.json"].sort());
    const opened = await store.open({ id: 2 }); // after a restart: another window
    const drums = mediaFiles.lookup(opened.sections.stems.stems.audio.drums.url);
    assert.deepEqual({ offset: drums.offset, size: drums.size }, { offset: 3, size: 2 });
    assert.deepEqual([...fs.readFileSync(drums.path)].slice(3, 5), [4, 5]);
    assert.equal(opened.stemsFrom, "file");
  });

  test("stems said to be copied, with no copy: none", async () => {
    const { store, mediaFiles } = setup();
    const stemsSection = { version: 1, stems: { codec: "opus", audio: "file" } };
    await store.write(sender, {
      mediaUrl: mediaFiles.share(songFile),
      sections: sections({ stems: stemsSection }),
      unsaved: true,
    });
    assert.equal(sessionJson().sections.stems.stems, null);
    assert.equal(sessionJson().stems, null);
  });

  test("newer stems replace the older copy, which goes", async () => {
    const { store, mediaFiles } = setup();
    const url = mediaFiles.share(songFile);
    const copy = async (bytes) => {
      const token = store.beginStems(sender);
      await store.addStem(sender, token, "bass", new Uint8Array(bytes));
      await store.endStems(sender, token);
      await store.write(sender, {
        mediaUrl: url,
        sections: sections({ stems: { version: 1, stems: { audio: "file" } } }),
        unsaved: true,
      });
    };
    await copy([1]);
    await copy([2, 2]);
    const files = fs.readdirSync(folder).filter((name) => name.startsWith("stems-"));
    assert.deepEqual(files, [sessionJson().stems.file]);
  });

  test("another window can't add to a stems file being written", async () => {
    const { store } = setup();
    const token = store.beginStems(sender);
    await assert.rejects(store.addStem({ id: 9 }, token, "bass", new Uint8Array([1])));
  });

  test("the final write, as a window closes, is done at once, and an earlier one still going doesn't land over it", async () => {
    const { store, mediaFiles } = setup();
    const url = mediaFiles.share(songFile);
    const earlier = store.write(sender, {
      mediaUrl: url,
      sections: sections({ step: { version: 1, n: 1 } }),
      unsaved: true,
    });
    store.write(
      sender,
      { mediaUrl: url, sections: sections({ step: { version: 1, n: 2 } }), unsaved: true },
      { final: true },
    );
    assert.equal(sessionJson().sections.step.n, 2, "written before write() returned");
    await earlier;
    assert.equal(sessionJson().sections.step.n, 2);
    assert.deepEqual(fs.readdirSync(folder), ["session.json"], "no temporary file left");
  });

  test("one write that fails doesn't stop the ones after it", async () => {
    const { store, mediaFiles } = setup();
    const url = mediaFiles.share(songFile);
    const realWrite = fs.promises.writeFile;
    let failures = 1;
    fs.promises.writeFile = async (...args) => {
      if (failures-- > 0) throw Object.assign(new Error("EBUSY: held by a virus scanner"), { code: "EBUSY" });
      return realWrite(...args);
    };
    try {
      const write = (n) =>
        store.write(sender, { mediaUrl: url, sections: sections({ step: { version: 1, n } }), unsaved: true });
      await assert.rejects(write(1), /EBUSY/);
      assert.equal(await write(2), true);
      assert.equal(sessionJson().sections.step.n, 2, "kept again after the failure");
    } finally {
      fs.promises.writeFile = realWrite;
    }
  });

  test("a final write that comes while a background one is landing isn't put back by it", async () => {
    const { store, mediaFiles } = setup();
    const url = mediaFiles.share(songFile);
    const write = (n, options) =>
      store.write(sender, { mediaUrl: url, sections: sections({ step: { version: 1, n } }), unsaved: true }, options);
    // The window closes just as the background write's temporary file is
    // written: if that write then renamed it asynchronously, its rename
    // would land after the final write.
    const realWrite = fs.promises.writeFile;
    const realRename = fs.promises.rename;
    let closing = null;
    fs.promises.writeFile = async (...args) => {
      await realWrite(...args);
      fs.promises.writeFile = realWrite;
      closing = () => write(2, { final: true });
    };
    const close = () => {
      const now = closing;
      closing = null;
      now?.();
    };
    fs.promises.rename = async (...args) => {
      close();
      return realRename(...args);
    };
    try {
      const background = write(1);
      await background;
      close(); // when the background write didn't rename asynchronously
      assert.equal(sessionJson().sections.step.n, 2);
    } finally {
      fs.promises.writeFile = realWrite;
      fs.promises.rename = realRename;
    }
  });

  test("a copy that's abandoned leaves nothing behind; nor does a window closing in the middle of one", async () => {
    const { store } = setup();
    const token = store.beginStems(sender);
    await store.addStem(sender, token, "bass", new Uint8Array([1, 2]));
    await store.abortStems({ id: 9 }, token); // not another window's to abort
    assert.equal(fs.readdirSync(folder).length, 1);
    await store.abortStems(sender, token);
    assert.deepEqual(fs.readdirSync(folder), []);
    await assert.rejects(store.addStem(sender, token, "drums", new Uint8Array([3])), "it's over");

    const second = store.beginStems(sender);
    await store.addStem(sender, second, "bass", new Uint8Array([1]));
    store.closed(sender.id);
    await new Promise((resolve) => setTimeout(resolve, 50)); // removed once nothing is being appended
    assert.deepEqual(fs.readdirSync(folder), []);
  });

  test("another EarBee's stems file, finished but not named here, is left alone for a day", async () => {
    let clock = Date.now();
    const { store, mediaFiles } = setup({ now: () => clock });
    fs.mkdirSync(folder, { recursive: true });
    const theirs = `stems-${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}.bin`;
    fs.writeFileSync(path.join(folder, theirs), "their stems");
    // This EarBee's own copy, replaced by a newer one: its old one goes at once.
    const url = mediaFiles.share(songFile);
    for (const bytes of [[1], [2]]) {
      const token = store.beginStems(sender);
      await store.addStem(sender, token, "bass", new Uint8Array(bytes));
      await store.endStems(sender, token);
      await store.write(sender, {
        mediaUrl: url,
        sections: sections({ stems: { version: 1, stems: { audio: "file" } } }),
        unsaved: true,
      });
    }
    const stemsFiles = () => fs.readdirSync(folder).filter((name) => name.startsWith("stems-"));
    assert.deepEqual(stemsFiles().sort(), [sessionJson().stems.file, theirs].sort());
    clock += 25 * 60 * 60 * 1000;
    store.tidy();
    assert.deepEqual(stemsFiles(), [sessionJson().stems.file], "a day later, it goes");
  });

  test("Don't save: a song never saved isn't offered; nothing more of that window's is kept", async () => {
    const { store, mediaFiles } = setup();
    const url = mediaFiles.share(songFile);
    await store.write(sender, { mediaUrl: url, sections: sections(), unsaved: true });
    store.discard(sender.id);
    assert.equal(store.summary(), null);
    assert.equal(
      await store.write(sender, { mediaUrl: url, sections: sections(), unsaved: true }, { final: true }),
      false,
    );
    assert.equal(store.summary(), null, "the final write as it closes doesn't bring it back");
  });

  test("Don't save: a project is offered as last saved, without the changes thrown away", async () => {
    const { store, mediaFiles } = setup();
    fs.writeFileSync(projectFile, "{}");
    const url = mediaFiles.share(songFile, { project: projectFile });
    await store.write(sender, { mediaUrl: url, sections: sections(), unsaved: true });
    store.discard(sender.id);
    assert.deepEqual(store.summary(), { name: "work.ebee", savedAt: 1_000, project: "work.ebee", unsaved: false });
    const answer = await store.open({ id: 2 });
    assert.equal(answer.changedSince, false);
    assert.deepEqual(answer.session, {}, "nothing over the project");
  });

  test("Don't save in a window that isn't the last session's leaves the last session alone", async () => {
    const { store, mediaFiles } = setup();
    await store.write(sender, { mediaUrl: mediaFiles.share(songFile), sections: sections(), unsaved: true });
    store.discard(7);
    assert.equal(store.summary()?.unsaved, true);
  });

  test("the only EarBee: an earlier run's stems file nothing names goes at once", async () => {
    const { store } = setup({ alone: () => true });
    fs.mkdirSync(folder, { recursive: true });
    const earlier = `stems-${"1".repeat(8)}-0000-0000-0000-${"1".repeat(12)}.bin`;
    fs.writeFileSync(path.join(folder, earlier), "an earlier run's stems");
    store.tidy();
    assert.deepEqual(fs.readdirSync(folder), []);
  });

  test("Don't save while that window's write is still on its way: another window's session stays", async () => {
    const { store, mediaFiles } = setup();
    const url = mediaFiles.share(songFile);
    const theirs = { id: 5 };
    await store.write(theirs, { mediaUrl: url, sections: sections({ step: { version: 1, n: 5 } }), unsaved: true });
    const mine = store.write(sender, {
      mediaUrl: url,
      sections: sections({ step: { version: 1, n: 1 } }),
      unsaved: true,
    });
    store.discard(sender.id); // before its write has landed
    await mine;
    assert.equal(sessionJson().sections.step.n, 5, "the other window's session, as it was");
    assert.equal(store.summary()?.unsaved, true);
  });

  test("a window closing while a stem is being appended: nothing left, and the copy can't end", async () => {
    const { store } = setup();
    const token = store.beginStems(sender);
    const adding = store.addStem(sender, token, "bass", new Uint8Array(1_000_000));
    const ending = store.endStems(sender, token);
    store.closed(sender.id);
    await adding;
    await assert.rejects(ending, /isn't wanted/);
    await new Promise((resolve) => setTimeout(resolve, 50)); // the removal, after the append
    assert.deepEqual(fs.readdirSync(folder), []);
  });

  test("forgetting it: nothing to offer", async () => {
    const { store, mediaFiles } = setup();
    await store.write(sender, { mediaUrl: mediaFiles.share(songFile), sections: sections(), unsaved: false });
    store.forget();
    assert.equal(store.summary(), null);
  });
});

describe("formatWhen", () => {
  const at = (y, m, d, h, min) => new Date(y, m - 1, d, h, min).getTime();
  const now = at(2026, 11, 20, 15, 0);

  test("today and yesterday, by the clock", async () => {
    assert.equal(formatWhen(at(2026, 11, 20, 9, 5), now), "today 09:05");
    assert.equal(formatWhen(at(2026, 11, 19, 23, 59), now), "yesterday 23:59");
  });

  test("earlier: the day and month; another year: the year too", async () => {
    assert.equal(formatWhen(at(2026, 11, 3, 14, 32), now), "3 Nov, 14:32");
    assert.equal(formatWhen(at(2025, 12, 31, 8, 0), now), "31 Dec 2025, 08:00");
  });
});
