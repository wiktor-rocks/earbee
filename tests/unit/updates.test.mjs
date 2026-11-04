// electron/updates.js: how a copy of EarBee is updated, and which versions are newer.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, test } from "node:test";

const { updateMode, isNewer } = createRequire(import.meta.url)("../../electron/updates.js");

describe("updateMode", () => {
  test("installs on Windows and from the AppImage; a notice on a Mac and other Linux; off unpackaged", () => {
    const mode = (platform, isAppImage = false, packaged = true) => updateMode({ platform, isAppImage, packaged });
    assert.equal(mode("win32"), "install");
    assert.equal(mode("linux", true), "install");
    assert.equal(mode("linux", false), "notice");
    assert.equal(mode("darwin"), "notice");
    for (const platform of ["win32", "linux", "darwin"]) assert.equal(mode(platform, true, false), "off");
  });
});

describe("isNewer", () => {
  test("compares each number, with or without a v", () => {
    assert.equal(isNewer("v0.3.1", "0.3.0"), true);
    assert.equal(isNewer("0.10.0", "0.9.9"), true);
    assert.equal(isNewer("1.0.0", "0.99.99"), true);
    assert.equal(isNewer("v0.3.0", "0.3.0"), false);
    assert.equal(isNewer("0.2.9", "0.3.0"), false);
  });

  test("anything else is never newer: prereleases, nonsense, nothing", () => {
    assert.equal(isNewer("v0.4.0-beta.1", "0.3.0"), false);
    assert.equal(isNewer("latest", "0.3.0"), false);
    assert.equal(isNewer(undefined, "0.3.0"), false);
    assert.equal(isNewer("0.4.0", "0.3.0-test.1"), false);
  });
});
