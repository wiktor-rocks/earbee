// The stem model's file (htdemucs-6s.onnx, from scripts/export-stem-model.py):
// where it is, and fetching it the first time it's needed. At 116 MB it
// isn't in the app or in git; it's an asset of a release in the EarBee
// organisation's models repository (github.com/EarBee/models, which also
// says its licence), downloaded into <userData>/models and checked against
// the size and SHA-256 below, as yt-dlp is (downloader.js).
//
//   createModelFile({ userData, devCopy?, fetch?, source? })
//     status()                → { ready, bytes }  ready: the file is there
//     path()                  → where it is, or null
//     download(onProgress, signal) → resolves when it's there and checked;
//                               onProgress(fraction); rejects with a
//                               ModelFileError whose message is for the user
//
// Running from the source (not packaged), a copy in models/ (exported
// there by the script) is used as it is, without the check: re-exporting
// can change its bytes. `source` ({ url, bytes, sha256 }) is for the tests.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const NAME = "htdemucs-6s.onnx";
// When the model changes, upload it to a new release of EarBee/models and
// change all three.
const SOURCE = {
  url: "https://github.com/EarBee/models/releases/download/stem-model-1/htdemucs-6s.onnx",
  bytes: 115_952_475,
  sha256: "d884b1c84c89a2eecd8c26ec7e606a8419fecb1cb97bf4b6b8639a696dc11e30",
};
const STALL_MS = 30_000; // give up after this long without data

// A failure whose message is written for the user.
class ModelFileError extends Error {}

/**
 * @param {{
 *   userData: string, devCopy?: string | null, fetch?: typeof globalThis.fetch,
 *   source?: { url: string, bytes: number, sha256: string },
 * }} options
 */
function createModelFile({ userData, devCopy = null, fetch = globalThis.fetch, source = SOURCE }) {
  const folder = path.join(userData, "models");
  const downloaded = path.join(folder, NAME);
  let downloading = null; // the download in progress: { promise, listeners }

  const exists = (file) => {
    try {
      return fs.statSync(file).isFile();
    } catch {
      return false;
    }
  };

  function where() {
    if (devCopy && exists(devCopy)) return devCopy;
    return exists(downloaded) ? downloaded : null;
  }

  async function fetchModel(onProgress, signal) {
    const stalled = new AbortController();
    let stallTimer = setTimeout(() => stalled.abort(), STALL_MS);
    const abort = AbortSignal.any([signal, stalled.signal]);
    const partial = `${downloaded}.part`;
    let out = null;
    try {
      const response = await fetch(source.url, { signal: abort });
      if (!response.ok) throw new ModelFileError(`Couldn't download the stem model (HTTP ${response.status}).`);
      fs.mkdirSync(folder, { recursive: true });
      out = fs.createWriteStream(partial);
      const hash = crypto.createHash("sha256");
      let received = 0;
      for await (const chunk of response.body) {
        clearTimeout(stallTimer);
        stallTimer = setTimeout(() => stalled.abort(), STALL_MS);
        hash.update(chunk);
        received += chunk.length;
        if (!out.write(chunk)) await new Promise((resolve) => out.once("drain", () => resolve(undefined)));
        onProgress(Math.min(1, received / source.bytes));
      }
      await new Promise((resolve, reject) =>
        out.end((/** @type {any} */ error) => (error ? reject(error) : resolve(undefined))),
      );
      if (received !== source.bytes || hash.digest("hex") !== source.sha256) {
        throw new ModelFileError("The downloaded stem model was damaged. Try again.");
      }
      fs.renameSync(partial, downloaded);
    } catch (error) {
      out?.destroy();
      fs.rmSync(partial, { force: true });
      if (signal.aborted) throw Object.assign(new ModelFileError("Canceled."), { canceled: true });
      if (error instanceof ModelFileError) throw error;
      throw new ModelFileError("Couldn't download the stem model. Check your internet connection.", { cause: error });
    } finally {
      clearTimeout(stallTimer);
    }
  }

  return {
    status: () => ({ ready: where() !== null, bytes: source.bytes }),
    path: where,
    /**
     * @param {(fraction: number) => void} onProgress
     * @param {AbortSignal} signal
     */
    download(onProgress, signal) {
      if (where()) return Promise.resolve();
      // One download at a time; a second caller waits for the first.
      if (!downloading) {
        const listeners = new Set();
        const promise = fetchModel((fraction) => listeners.forEach((listener) => listener(fraction)), signal).finally(
          () => (downloading = null),
        );
        downloading = { promise, listeners };
      }
      downloading.listeners.add(onProgress);
      return downloading.promise.finally(() => downloading?.listeners.delete(onProgress));
    },
  };
}

module.exports = { createModelFile, ModelFileError, NAME };
