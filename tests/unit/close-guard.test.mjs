// electron/project-files.js guardClose: closing the window asks first when
// there are unsaved changes, and, before that, while something closing
// would stop is still running (Stems: a separation, or the model's
// download). With a fake window whose close() goes through unless a
// listener prevents it.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { test } from "node:test";

const { guardClose } = createRequire(import.meta.url)("../../electron/project-files.js");

function setUp({ dirty = false, running = null, closeAnyway = true, choice = "discard" } = {}) {
  const contents = Object.assign(new EventEmitter(), {
    id: 7,
    sent: [],
    send: (channel) => contents.sent.push(channel),
  });
  const win = Object.assign(new EventEmitter(), {
    webContents: contents,
    closed: false,
    close() {
      let prevented = false;
      win.emit("close", { preventDefault: () => (prevented = true) });
      if (!prevented) {
        win.closed = true;
        win.emit("closed");
      }
    },
  });
  const asked = [];
  const dialogs = {
    confirm: async (_sender, name) => (asked.push(["confirm", name]), choice),
    confirmBusy: async (_sender, what) => (asked.push(["busy", what]), closeAnyway),
  };
  const state = new Map(dirty ? [[7, { dirty: true, name: "Song.ebee" }]] : []);
  const ipcMain = Object.assign(new EventEmitter(), { removeListener: EventEmitter.prototype.removeListener });
  const status = { running };
  guardClose(win, { ipcMain, dialogs, state, busy: () => status.running });
  // close(), then the dialogs' answers.
  const close = async () => {
    win.close();
    await new Promise((resolve) => setImmediate(resolve));
  };
  return { win, contents, asked, close, status, ipcMain };
}

test("nothing unsaved and nothing running: it just closes", async () => {
  const { win, asked, close } = setUp();
  await close();
  assert.equal(win.closed, true);
  assert.deepEqual(asked, []);
});

test("unsaved changes: asked as before", async () => {
  const { win, asked, close } = setUp({ dirty: true, choice: "cancel" });
  await close();
  assert.equal(win.closed, false);
  assert.deepEqual(asked, [["confirm", "Song.ebee"]]);
});

test("a separation running: asked first; keeping it keeps the window", async () => {
  const { win, asked, close } = setUp({ running: "separate", closeAnyway: false });
  await close();
  assert.equal(win.closed, false);
  assert.deepEqual(asked, [["busy", "separate"]]);
});

test("closing anyway, with nothing unsaved: it closes, and isn't asked again", async () => {
  const { win, asked, close } = setUp({ running: "download" });
  await close();
  assert.equal(win.closed, true);
  assert.deepEqual(asked, [["busy", "download"]]);
});

test("closing anyway with unsaved changes: then the usual question", async () => {
  const kept = setUp({ dirty: true, running: "separate", choice: "cancel" });
  await kept.close();
  assert.equal(kept.win.closed, false, "Cancel there keeps it open, still separating");
  assert.deepEqual(kept.asked, [
    ["busy", "separate"],
    ["confirm", "Song.ebee"],
  ]);

  const dropped = setUp({ dirty: true, running: "separate", choice: "discard" });
  await dropped.close();
  assert.equal(dropped.win.closed, true);

  const saved = setUp({ dirty: true, running: "separate", choice: "save" });
  await saved.close();
  assert.deepEqual(saved.contents.sent, ["project:save-then-close"]);
  saved.ipcMain.emit("project:close", { sender: saved.contents });
  assert.equal(saved.win.closed, true, "once saved, it closes without asking again");
  assert.equal(saved.asked.length, 2);
});
