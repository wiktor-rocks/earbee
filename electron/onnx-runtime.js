// Whether ONNX Runtime (onnxruntime-node) has a build for this system,
// which the beat model and the stems need. It hasn't for every one: there
// is no Intel Mac build, so the Intel Mac app has none (package.json's
// "files" keep only this platform's and architecture's binaries).
//   onnxRuntimeAvailable({ platform?, arch?, root? })
//     true if root/bin/napi-v*/<platform>/<arch>/ is there; root is
//     onnxruntime-node's folder, outside the app's asar archive when
//     packaged (package.json "asarUnpack"). It only looks for the folder:
//     loading the native module here would put it in the main process.
const fs = require("fs");
const path = require("path");

const unpacked = (file) => file.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

function packageFolder() {
  try {
    return unpacked(path.dirname(require.resolve("onnxruntime-node/package.json")));
  } catch {
    return null; // not installed
  }
}

function onnxRuntimeAvailable({ platform = process.platform, arch = process.arch, root = packageFolder() } = {}) {
  if (!root) return false;
  const bin = path.join(root, "bin");
  try {
    return fs
      .readdirSync(bin)
      .filter((name) => name.startsWith("napi-v"))
      .some((name) => fs.existsSync(path.join(bin, name, platform, arch)));
  } catch {
    return false;
  }
}

module.exports = { onnxRuntimeAvailable };
