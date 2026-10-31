// electron/stems/index.js: the stem process started for one song, its
// port handed to it and to the page, stopped by Cancel or by another
// song, and a process that dies telling the page (with fakes for the
// utility process, the channel and the page).
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";

const { handleStems } = createRequire(import.meta.url)("../../electron/stems/index.js");

let userData;
let devCopy;
beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), "earbee-stems-"));
  devCopy = path.join(userData, "exported.onnx");
});
afterEach(() => fs.rmSync(userData, { recursive: true, force: true }));

function setUp({ model = true } = {}) {
  if (model) fs.writeFileSync(devCopy, "model");
  const handlers = new Map();
  const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler) };
  const forks = [];
  const utilityProcess = {
    fork(script, args) {
      const child = Object.assign(new EventEmitter(), {
        script,
        args,
        posted: [],
        killed: false,
        postMessage: (message, ports) => child.posted.push({ message, ports }),
        kill: () => (child.killed = true),
      });
      forks.push(child);
      return child;
    },
  };
  class MessageChannelMain {
    port1 = { name: "port1" };
    port2 = { name: "port2" };
  }
  const sender = Object.assign(new EventEmitter(), {
    sent: [],
    posted: [],
    isDestroyed: () => false,
    send: (channel, message) => sender.sent.push({ channel, message }),
    postMessage: (channel, message, ports) => sender.posted.push({ channel, ports }),
  });
  handleStems(ipcMain, { utilityProcess, MessageChannelMain, userData, devCopy, fetch: async () => new Response() });
  const call = (channel) => handlers.get(channel)({ sender });
  return { call, forks, sender };
}

test("starts a process on the model, and hands one end of a channel to it and the other to the page", async () => {
  const { call, forks, sender } = setUp();
  const model = await call("stems:model");
  assert.equal(model.ready, true);
  assert.ok(model.bytes > 0, "its download size, for the button");
  assert.deepEqual(await call("stems:start"), { ok: true });
  assert.equal(forks.length, 1);
  assert.match(forks[0].script, /process\.js$/);
  assert.deepEqual(forks[0].args, [devCopy]);
  assert.deepEqual(forks[0].posted, [{ message: { type: "port" }, ports: [{ name: "port1" }] }]);
  assert.deepEqual(sender.posted, [{ channel: "stems:port", ports: [{ name: "port2" }] }]);
});

test("without the model, it doesn't start", async () => {
  const { call, forks } = setUp({ model: false });
  assert.equal((await call("stems:model")).ready, false);
  const started = await call("stems:start");
  assert.equal(started.ok, false);
  assert.equal(forks.length, 0);
});

test("Cancel stops the process, quietly", async () => {
  const { call, forks, sender } = setUp();
  await call("stems:start");
  await call("stems:cancel");
  assert.equal(forks[0].killed, true);
  forks[0].emit("exit", 9);
  assert.deepEqual(sender.sent, [], "the page cancelled: nothing to tell it");
});

test("another song stops the one before", async () => {
  const { call, forks, sender } = setUp();
  await call("stems:start");
  await call("stems:start");
  assert.equal(forks[0].killed, true);
  assert.equal(forks[1].killed, false);
  forks[0].emit("exit", 9);
  assert.deepEqual(sender.sent, []);
});

test("a process that dies tells the page; one that finishes doesn't", async () => {
  const { call, forks, sender } = setUp();
  await call("stems:start");
  forks[0].emit("exit", 0);
  assert.deepEqual(sender.sent, []);
  await call("stems:start");
  forks[1].emit("exit", 134);
  assert.equal(sender.sent.length, 1);
  assert.equal(sender.sent[0].channel, "stems:stopped");
  assert.match(sender.sent[0].message.error, /stopped \(134\)/);
});

test("the page reloading, closing or crashing stops the process at once", async () => {
  for (const [event, details] of [
    ["did-start-navigation", { isMainFrame: true, isSameDocument: false }],
    ["destroyed", undefined],
    ["render-process-gone", {}],
  ]) {
    const { call, forks, sender } = setUp();
    await call("stems:start");
    sender.emit(event, details);
    assert.equal(forks[0].killed, true, event);
    forks[0].emit("exit", 9);
    assert.deepEqual(sender.sent, [], `${event}: nobody to tell`);
    assert.equal(sender.listenerCount(event), 0, `${event}: its listeners go with the process`);
    fs.rmSync(devCopy, { force: true });
  }
});

test("navigating within the page doesn't stop it", async () => {
  const { call, forks, sender } = setUp();
  await call("stems:start");
  sender.emit("did-start-navigation", { isMainFrame: true, isSameDocument: true });
  sender.emit("did-start-navigation", { isMainFrame: false, isSameDocument: false });
  assert.equal(forks[0].killed, false);
  forks[0].emit("exit", 0);
  assert.equal(sender.listenerCount("did-start-navigation"), 0, "and once it's done, its listeners are gone");
});
