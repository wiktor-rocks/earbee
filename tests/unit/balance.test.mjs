// src/core/balance.js: the Balance knob's gains for each side, and its readout.
import assert from "node:assert/strict";
import { test } from "node:test";
import { balanceGains, formatBalance } from "../../src/core/balance.js";

test("in the middle both sides play as they are", () => {
  assert.deepEqual(balanceGains(0), { left: 1, right: 1 });
  assert.equal(formatBalance(0), "Centre");
});

test("turning it one way lowers the other side, down to silence at the end", () => {
  assert.deepEqual(balanceGains(-40), { left: 1, right: 0.6 });
  assert.deepEqual(balanceGains(-100), { left: 1, right: 0 });
  assert.deepEqual(balanceGains(25), { left: 0.75, right: 1 });
  assert.deepEqual(balanceGains(100), { left: 0, right: 1 });
  assert.deepEqual(balanceGains(250), { left: 0, right: 1 }, "past the end: the end");
});

test("the readout gives each side's level", () => {
  assert.equal(formatBalance(-40), "L 100 · R 60");
  assert.equal(formatBalance(100), "L 0 · R 100");
});
