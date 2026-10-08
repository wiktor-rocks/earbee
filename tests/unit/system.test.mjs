// electron/system.js: the available memory, and what happens when the
// page's process dies (with a fake window and dialog).
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { describe, test } from "node:test";

const { availableMemory, handleRendererCrash } = createRequire(import.meta.url)("../../electron/system.js");

function fakeWindow() {
  const shown = [];
  const win = {
    webContents: new EventEmitter(),
    reloads: 0,
    isDestroyed: () => false,
    reload() {
      win.reloads++;
    },
  };
  const dialog = { showMessageBox: async (_win, options) => shown.push(options) };
  handleRendererCrash(win, dialog);
  return { win, shown };
}

const crash = async (win, reason) => {
  win.webContents.emit("render-process-gone", {}, { reason, exitCode: 1 });
  await new Promise((resolve) => setImmediate(resolve));
};

describe("handleRendererCrash", () => {
  test("out of memory: says so and reloads", async () => {
    const { win, shown } = fakeWindow();
    await crash(win, "oom");
    assert.equal(win.reloads, 1);
    assert.match(shown[0].detail, /ran out of memory/);
  });

  test("other crashes: gives the reason and reloads", async () => {
    const { win, shown } = fakeWindow();
    await crash(win, "crashed");
    assert.equal(win.reloads, 1);
    assert.match(shown[0].detail, /crashed/);
  });

  test("a clean exit (closing) is not a crash", async () => {
    const { win, shown } = fakeWindow();
    await crash(win, "clean-exit");
    assert.equal(win.reloads, 0);
    assert.equal(shown.length, 0);
  });
});

describe("availableMemory", () => {
  test("a positive number of bytes, or null where it can't be told", () => {
    const bytes = availableMemory();
    if (process.platform === "darwin") assert.equal(bytes, null);
    else assert.ok(bytes > 0 && Number.isInteger(bytes), String(bytes));
  });
});
