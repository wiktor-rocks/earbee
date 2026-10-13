// electron/prefs-store.js: keeping prefs.json, importing theme.json,
// refusing what the page may not set, telling listeners.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

const require = createRequire(import.meta.url);
const { createPrefsStore } = require("../../electron/prefs-store.js");
const { videoFormat } = require("../../electron/downloader.js");

const folder = () => fs.mkdtempSync(path.join(os.tmpdir(), "scribee-prefs-"));
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

describe("prefs store", () => {
  test("first run: the defaults, and no file until something changes", () => {
    const file = path.join(folder(), "prefs.json");
    const store = createPrefsStore(file);
    assert.equal(store.get("theme").choice, "scribee");
    assert.equal(store.get("downloads").folder, null);
    assert.equal(fs.existsSync(file), false);
  });

  test("a change is saved whole, with the version, and read back", () => {
    const file = path.join(folder(), "prefs.json");
    createPrefsStore(file).set("downloads", "maxHeight", 720);
    const saved = read(file);
    assert.equal(saved.version, 1);
    assert.equal(saved.downloads.maxHeight, 720);
    assert.equal(saved.theme.choice, "scribee");
    assert.equal(createPrefsStore(file).get("downloads").maxHeight, 720);
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ["prefs.json"]); // no temporary file left
  });

  test("an unreadable file gives the defaults, and isn't replaced by theme.json", () => {
    const dir = folder();
    fs.writeFileSync(path.join(dir, "prefs.json"), "{ not json");
    fs.writeFileSync(path.join(dir, "theme.json"), JSON.stringify({ choice: "nord" }));
    const store = createPrefsStore(path.join(dir, "prefs.json"), { legacyThemeFile: path.join(dir, "theme.json") });
    assert.equal(store.get("theme").choice, "scribee");
  });

  test("invalid stored values become defaults; valid ones are kept", () => {
    const file = path.join(folder(), "prefs.json");
    fs.writeFileSync(file, JSON.stringify({ version: 1, theme: { choice: "gone" }, downloads: { kind: "video" } }));
    const store = createPrefsStore(file);
    assert.equal(store.get("theme").choice, "scribee");
    assert.equal(store.get("downloads").kind, "video");
  });

  test("the first run imports theme.json from before Settings", () => {
    const dir = folder();
    fs.writeFileSync(
      path.join(dir, "theme.json"),
      JSON.stringify({ choice: "auto", dark: "nord", light: "github-light" }),
    );
    const store = createPrefsStore(path.join(dir, "prefs.json"), { legacyThemeFile: path.join(dir, "theme.json") });
    assert.deepEqual(store.get("theme"), { choice: "auto", dark: "nord", light: "github-light" });
  });

  test("refuses unknown sections and keys, invalid values, and folders from the page", () => {
    const file = path.join(folder(), "prefs.json");
    const store = createPrefsStore(file);
    assert.throws(() => store.set("nope", "x", 1), /Unknown settings section/);
    assert.throws(() => store.set("downloads", "nope", 1), /Unknown setting/);
    assert.throws(() => store.set("downloads", "kind", "podcast"), /Invalid value/);
    assert.throws(() => store.set("downloads", "folder", "/etc", { fromPage: true }), /can't be set from the page/);
    assert.equal(fs.existsSync(file), false); // nothing was saved
    store.set("downloads", "folder", "/music"); // the main process (its folder picker) can
    assert.equal(store.get("downloads").folder, "/music");
  });

  test("listeners hear real changes only, and reset works", () => {
    const store = createPrefsStore(path.join(folder(), "prefs.json"));
    const heard = [];
    store.onChange((id, values) => heard.push([id, values.kind]));
    store.set("downloads", "kind", "video");
    store.set("downloads", "kind", "video"); // no change
    store.reset("downloads");
    assert.deepEqual(heard, [
      ["downloads", "video"],
      ["downloads", "audio"],
    ]);
  });
});

describe("videoFormat", () => {
  test("H.264 first, then any picture, at most the height, plus the best audio", () => {
    assert.equal(videoFormat(720), "bv[vcodec^=avc1][height<=720]/bv[height<=720]/bv,ba[ext=m4a]/ba");
  });
});
