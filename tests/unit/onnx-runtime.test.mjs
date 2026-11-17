// electron/onnx-runtime.js: whether ONNX Runtime has a build for a
// platform and architecture (none for an Intel Mac), from its folders.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const { onnxRuntimeAvailable } = createRequire(import.meta.url)("../../electron/onnx-runtime.js");

test("finds the build for a platform and architecture, and only that one", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "earbee-ort-"));
  try {
    fs.mkdirSync(path.join(root, "bin", "napi-v6", "darwin", "arm64"), { recursive: true });
    assert.equal(onnxRuntimeAvailable({ platform: "darwin", arch: "arm64", root }), true);
    assert.equal(onnxRuntimeAvailable({ platform: "darwin", arch: "x64", root }), false, "no Intel Mac build");
    assert.equal(onnxRuntimeAvailable({ platform: "linux", arch: "x64", root }), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("without the package, or its bin folder, there's none", () => {
  assert.equal(onnxRuntimeAvailable({ platform: "linux", arch: "x64", root: null }), false);
  assert.equal(onnxRuntimeAvailable({ root: path.join(os.tmpdir(), "earbee-no-such-folder") }), false);
});

test("the installed package has a build for this system", () => {
  assert.equal(onnxRuntimeAvailable(), true);
});
