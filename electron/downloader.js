// Downloads a song or a video from a link (YouTube, or any site yt-dlp
// supports) for the page. It runs in the main process: the page is
// sandboxed and has no network access. The page reaches it through
// preload.js (window.transcribee).
//
//   yt-dlp    Does the downloading. Fetched from its GitHub releases on first
//             use into <userData>/bin, checked against the release's SHA-256
//             list, and updated (`yt-dlp -U`) at most once a day, because
//             YouTube changes often and old copies stop working. For YouTube
//             it needs a JavaScript runtime: Electron's own binary, run as
//             Node (ELECTRON_RUN_AS_NODE).
//   Formats   Audio: the best audio stream (AAC if there is one). Video: the
//             best picture up to the height set in Settings (1080p unless
//             changed; H.264 where there is one) plus the best audio, as two
//             files; joining them in yt-dlp would need ffmpeg.
//   Joining   Mediabunny copies the streams, without re-encoding, into one
//             ordinary file in the folder set in Settings (by default
//             ~/Downloads/TranscriBee): .mp4 for video, .m4a
//             (or .ogg) for audio. Audio is rewritten too, because YouTube's
//             .m4a is a "DASH" file that not every player opens.
//   One link, one video: a playlist or search page gets its first video
//             only (--playlist-items 1); the page shows its title.
//   Progress  Sent to the page as { stage, part, parts, fraction, eta,
//             title }: "setup" (fetching yt-dlp), "update", "download",
//             "join".
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const RELEASES = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/";
const UPDATE_EVERY_MS = 24 * 60 * 60 * 1000;
const STALL_MS = 30_000; // give up on GitHub after this long without data

// yt-dlp format selectors: "a/b" means a, else b; "x,y" downloads both.
const AUDIO_FORMAT = "ba[ext=m4a]/ba";
// The best picture at most `maxHeight` tall, H.264 if there is one (the
// lightest to decode; YouTube has it up to 1080p), plus the best audio.
const videoFormat = (maxHeight) => `bv[vcodec^=avc1][height<=${maxHeight}]/bv[height<=${maxHeight}]/bv,${AUDIO_FORMAT}`;
const formatFor = (kind, maxHeight) => (kind === "video" ? videoFormat(maxHeight) : AUDIO_FORMAT);
const PARTS = { audio: 1, video: 2 };

// A failure whose message is written for the user.
class DownloadError extends Error {}

// The user canceled; not shown as an error.
class DownloadCanceled extends DownloadError {
  constructor() {
    super("Canceled.");
  }
}

// The yt-dlp executable for this computer, as named in its releases.
function releaseAsset() {
  const { platform, arch } = process;
  if (platform === "win32") return arch === "arm64" ? "yt-dlp_arm64.exe" : "yt-dlp.exe";
  if (platform === "darwin") return "yt-dlp_macos";
  if (platform === "linux" && arch === "x64") return "yt-dlp_linux";
  if (platform === "linux" && arch === "arm64") return "yt-dlp_linux_aarch64";
  return null;
}

// Only web links, so a "URL" can never be a local file or an option.
function checkUrl(url) {
  let parsed;
  try {
    parsed = new URL(String(url).trim());
  } catch {
    throw new DownloadError("That isn't a link. Paste the address of a YouTube video.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new DownloadError("Only web links (https://…) can be downloaded.");
  }
  return parsed.href;
}

// yt-dlp's last error line, shortened for the user.
function explainFailure(stderrLines) {
  const line = [...stderrLines].reverse().find((text) => text.startsWith("ERROR:"));
  if (!line) return "The download failed.";
  const message = line.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?([\w-]+:\s)?/, "");
  // Linux, Windows and macOS word "no network" differently.
  const offline =
    /name resolution|getaddrinfo|Name or service not known|nodename nor servname|Failed to resolve|Network is unreachable|timed out/i;
  if (offline.test(message)) {
    return "Couldn't reach the site. Check your internet connection.";
  }
  if (/^Unsupported URL/i.test(message)) return "That link isn't a video that can be downloaded.";
  if (/HTTP Error 403/.test(message)) {
    return "YouTube refused the download (HTTP 403). Try again in a minute; if it keeps happening, YouTube may have changed and the downloader needs its next update.";
  }
  return message.replace(/\s*\(caused by .*\)$/, "");
}

// A file name made from the video's title, safe on every system.
function fileNameFor(title, id, extension) {
  const clean = String(title)
    .replace(/[\\/:*?"<>|\p{Cc}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);
  return `${clean || "Download"} [${id}].${extension}`;
}

// Removes work folders older than a day: left behind when the app was
// killed mid-download (a normal exit or a cancel removes its own).
function removeStaleWorkFolders() {
  try {
    for (const name of fs.readdirSync(os.tmpdir())) {
      if (!name.startsWith("transcribee-download-")) continue;
      const folder = path.join(os.tmpdir(), name);
      if (Date.now() - fs.statSync(folder).mtimeMs > UPDATE_EVERY_MS)
        fs.rmSync(folder, { recursive: true, force: true });
    }
  } catch (error) {
    console.warn("Couldn't clean up old download folders:", error);
  }
}

/**
 * @param {object} options
 * @param {string} options.binDir      Where yt-dlp is kept.
 * @param {string} options.saveDir     Where finished files go, unless the settings say otherwise.
 * @param {() => { folder: string | null, maxHeight: number }} [options.prefs]
 *   The Downloads settings (prefs-store.js), read at the start of each download.
 * @param {string} [options.ytDlp]     A yt-dlp to use as is (no setup or updates); the tests pass a fake.
 * @param {string} [options.jsRuntime] The Node-compatible runtime yt-dlp uses (default: this Electron).
 * @param {typeof fetch} [options.fetch]
 */
function createDownloader({ binDir, saveDir, prefs, ytDlp, jsRuntime = process.execPath, fetch = globalThis.fetch }) {
  const managed = !ytDlp;
  const asset = releaseAsset();
  const binary = ytDlp ?? (asset && path.join(binDir, asset.endsWith(".exe") ? "yt-dlp.exe" : "yt-dlp"));
  const updateStamp = path.join(binDir, "yt-dlp-checked");
  let current = null; // the running download: { child, canceled, abort }

  removeStaleWorkFolders();

  /* ---------- yt-dlp itself ---------- */

  async function fetchYtDlp(onProgress) {
    const sums = await (await fetchOk(RELEASES + "SHA2-256SUMS")).text();
    const expected = sums
      .split("\n")
      .map((line) => line.trim().split(/\s+/))
      .find(([, name]) => name === asset)?.[0];
    if (!expected) throw new DownloadError(`The downloader isn't available for this system (${asset}).`);

    // Canceled, or stalled: no data for STALL_MS.
    const stalled = new AbortController();
    let stallTimer = setTimeout(() => stalled.abort(), STALL_MS);
    const response = await fetchOk(RELEASES + asset, stalled.signal);
    const total = Number(response.headers.get("content-length")) || 0;
    const hash = crypto.createHash("sha256");
    const partial = `${binary}.part`;
    fs.mkdirSync(binDir, { recursive: true });
    const out = fs.createWriteStream(partial);
    let received = 0;
    try {
      for await (const chunk of response.body) {
        clearTimeout(stallTimer);
        stallTimer = setTimeout(() => stalled.abort(), STALL_MS);
        hash.update(chunk);
        received += chunk.length;
        if (!out.write(chunk)) await new Promise((resolve) => out.once("drain", resolve));
        onProgress({ stage: "setup", fraction: total ? received / total : null });
      }
      await new Promise((resolve, reject) =>
        out.end((/** @type {any} */ error) => (error ? reject(error) : resolve())),
      );
      if (hash.digest("hex") !== expected) throw new DownloadError("The downloaded yt-dlp was damaged. Try again.");
      fs.chmodSync(partial, 0o755);
      fs.renameSync(partial, binary);
      fs.writeFileSync(updateStamp, "");
    } catch (error) {
      out.destroy();
      fs.rmSync(partial, { force: true });
      throw fetchFailure(error);
    } finally {
      clearTimeout(stallTimer);
    }
  }

  // Fetches from GitHub; canceling the download or `stalled` aborts it.
  async function fetchOk(url, stalled = AbortSignal.timeout(STALL_MS)) {
    let response;
    try {
      response = await fetch(url, { signal: AbortSignal.any([current.abort.signal, stalled]) });
    } catch (error) {
      throw fetchFailure(error);
    }
    if (!response.ok) throw new DownloadError(`Couldn't download yt-dlp (HTTP ${response.status}).`);
    return response;
  }

  function fetchFailure(error) {
    if (current?.canceled) return new DownloadCanceled();
    if (error instanceof DownloadError) return error;
    return new DownloadError("Couldn't download yt-dlp. Check your internet connection.", { cause: error });
  }

  // Makes sure yt-dlp is there and reasonably fresh.
  async function prepare(onProgress) {
    if (!managed) return;
    if (!asset)
      throw new DownloadError(`Downloading isn't supported on this system (${process.platform} ${process.arch}).`);
    if (!fs.existsSync(binary)) {
      onProgress({ stage: "setup", fraction: 0 });
      await fetchYtDlp(onProgress);
      return;
    }
    const checked = fs.statSync(updateStamp, { throwIfNoEntry: false })?.mtimeMs ?? 0;
    if (Date.now() - checked < UPDATE_EVERY_MS) return;
    onProgress({ stage: "update" });
    // A failed update (offline, GitHub down) keeps the copy we have.
    const { code } = await run(["--update"], () => {}, 60_000);
    if (code !== 0) console.warn("yt-dlp update failed; using the installed copy.");
    fs.writeFileSync(updateStamp, "");
  }

  /* ---------- Running yt-dlp ---------- */

  // Runs yt-dlp, calling onLine for each line it prints to stdout.
  function run(args, onLine, timeoutMs = 0) {
    const child = spawn(binary, args, {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      windowsHide: true,
      detached: process.platform !== "win32", // own process group, so cancel stops all of it
    });
    if (current) current.child = child;
    const stderr = [];
    let stdoutRest = "";
    let stderrRest = "";
    const lines = (rest, chunk, each) => {
      const parts = (rest + chunk).split(/\r?\n/);
      const last = parts.pop() ?? "";
      parts.forEach(each);
      return last;
    };
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdoutRest = lines(stdoutRest, chunk, onLine)));
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderrRest = lines(stderrRest, chunk, (line) => stderr.push(line) > 50 && stderr.shift());
    });
    const timer = timeoutMs ? setTimeout(() => kill(child), timeoutMs) : null;
    return new Promise((resolve) => {
      child.on("error", (error) => {
        stderr.push(`ERROR: ${error.message}`);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (stdoutRest) onLine(stdoutRest);
        if (stderrRest) stderr.push(stderrRest);
        resolve({ code, stderr });
      });
    });
  }

  function kill(child) {
    if (child.exitCode !== null || !child.pid) return;
    try {
      if (process.platform === "win32")
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
      else process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill();
    }
  }

  /* ---------- Joining ---------- */

  // Copies every track of `inputs` into one file, without re-encoding.
  async function join(inputs, title, id, isVideo, folder) {
    const mb = require("mediabunny");
    const opened = inputs.map((file) => new mb.Input({ source: new mb.FilePathSource(file), formats: mb.ALL_FORMATS }));
    try {
      const tracks = (await Promise.all(opened.map((input) => input.getTracks()))).flat();
      if (!tracks.length) throw new DownloadError("The download contained no audio or video.");
      const audioCodec = tracks.find((track) => track.isAudioTrack())?.codec;
      const [format, extension] = isVideo
        ? [new mb.Mp4OutputFormat({ fastStart: "in-memory" }), "mp4"]
        : audioCodec === "opus" || audioCodec === "vorbis"
          ? [new mb.OggOutputFormat(), "ogg"]
          : audioCodec === "mp3"
            ? [new mb.Mp3OutputFormat(), "mp3"]
            : [new mb.Mp4OutputFormat({ fastStart: "in-memory" }), "m4a"];

      try {
        fs.mkdirSync(folder, { recursive: true });
      } catch (error) {
        throw new DownloadError(`Couldn't save in ${folder}: ${error.message}. Choose another folder in Settings.`);
      }
      const target = path.join(folder, fileNameFor(title, id, extension));
      const partial = `${target}.part`;
      const output = new mb.Output({ format, target: new mb.FilePathTarget(partial) });
      const copies = [];
      for (const track of tracks) {
        if (!track.codec) continue;
        if (track.isVideoTrack()) {
          const source = new mb.EncodedVideoPacketSource(track.codec);
          output.addVideoTrack(source, { rotation: track.rotation });
          copies.push({ track, source });
        } else if (track.isAudioTrack()) {
          const source = new mb.EncodedAudioPacketSource(track.codec);
          output.addAudioTrack(source);
          copies.push({ track, source });
        }
      }
      try {
        await output.start();
        for (const { track, source } of copies) {
          const decoderConfig = await track.getDecoderConfig();
          let first = true;
          for await (const packet of new mb.EncodedPacketSink(track).packets()) {
            if (current?.canceled) throw new DownloadCanceled();
            await source.add(packet, first ? { decoderConfig } : undefined);
            first = false;
          }
          source.close();
        }
        await output.finalize();
      } catch (error) {
        await output.cancel().catch(() => {});
        fs.rmSync(partial, { force: true });
        throw error;
      }
      fs.renameSync(partial, target);
      return target;
    } finally {
      for (const input of opened) input.dispose();
    }
  }

  /* ---------- A download ---------- */

  // One run of yt-dlp: downloads the link's parts into `work`.
  async function fetchParts(link, kind, format, work, job, onProgress) {
    const parts = PARTS[kind];
    let part = 0;
    let title = "";
    let id = "";
    const files = [];
    let movedOn = false; // stopped at the start of a second video
    onProgress({ stage: "download", part: 1, parts, fraction: 0 });
    const { code, stderr } = await run(
      [
        "--ignore-config",
        "--no-playlist",
        "--playlist-items",
        "1",
        "--newline",
        "--progress",
        "--no-colors",
        "--fixup",
        "never",
        "--no-js-runtimes",
        "--js-runtimes",
        `node:${jsRuntime}`,
        "--print",
        "before_dl:[tb-title] %(id)s %(title)s",
        "--print",
        "after_move:[tb-file] %(filepath)s",
        "--progress-template",
        "download:[tb-progress] %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s %(progress.eta)s",
        "-f",
        format,
        "-o",
        path.join(work, "part-%(format_id)s.%(ext)s"),
        "--",
        link,
      ],
      (line) => {
        const [tag, ...rest] = line.split(" ");
        if (tag === "[tb-title]") {
          // Never more than one video, even if yt-dlp moves on to another.
          if (id && rest[0] !== id) {
            movedOn = true;
            return kill(job.child);
          }
          part = Math.min(part + 1, parts);
          [id] = rest;
          title = rest.slice(1).join(" ");
          onProgress({ stage: "download", part, parts, fraction: 0, title });
        } else if (tag === "[tb-progress]") {
          const [done, total, estimate, eta] = rest.map(Number);
          const size = total || estimate;
          onProgress({
            stage: "download",
            part: Math.max(part, 1),
            parts,
            fraction: size ? Math.min(done / size, 1) : null,
            eta: Number.isFinite(eta) ? eta : null,
          });
        } else if (tag === "[tb-file]") {
          files.push(rest.join(" "));
        }
      },
    );
    const ok = code === 0 || (movedOn && files.length === parts);
    return { ok, stderr, files, title, id };
  }

  /**
   * Downloads `url` as audio or video into the download folder and returns the file's path.
   * @param {string} url
   * @param {"audio" | "video"} kind
   * @param {(progress: object) => void} onProgress
   */
  async function download(url, kind, onProgress) {
    if (current) throw new DownloadError("A download is already running.");
    if (!(kind in PARTS)) throw new DownloadError(`Unknown download kind: ${kind}`);
    const { folder = null, maxHeight = 1080 } = prefs?.() ?? {};
    const format = formatFor(kind, maxHeight);
    const link = checkUrl(url);
    const job = { child: null, canceled: false, abort: new AbortController() };
    current = job;
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "transcribee-download-"));
    try {
      await prepare(onProgress);
      if (job.canceled) throw new DownloadCanceled();

      // YouTube sometimes refuses a stream link (HTTP 403); a fresh run
      // gets new links, so try once more before giving up.
      let result;
      for (let attempt = 1; attempt <= 2; attempt++) {
        result = await fetchParts(link, kind, format, work, job, onProgress);
        if (job.canceled) throw new DownloadCanceled();
        if (result.ok || !result.stderr.some((line) => line.includes("HTTP Error 403"))) break;
        fs.rmSync(work, { recursive: true, force: true });
        fs.mkdirSync(work);
      }
      const { ok, stderr, files, title, id } = result;
      if (!ok) throw new DownloadError(explainFailure(stderr));
      if (!files.length) throw new DownloadError("The download produced no file.");

      onProgress({ stage: "join" });
      return await join(files, title, id, kind === "video", folder ?? saveDir);
    } finally {
      current = null;
      fs.rmSync(work, { recursive: true, force: true });
    }
  }

  function cancel() {
    if (!current) return;
    current.canceled = true;
    current.abort.abort();
    if (current.child) kill(current.child);
  }

  return { download, cancel };
}

/**
 * Answers the page's download requests (see preload.js). The page gets the
 * saved file's URL from `share` (media-files.js), never its bytes: it reads
 * the file from disk in pieces, as it does a file the user opens.
 * @param {import("electron").IpcMain} ipcMain
 * @param {Parameters<typeof createDownloader>[0] & { share: (file: string) => string }} options
 */
function handleDownloads(ipcMain, { share, ...options }) {
  const downloader = createDownloader(options);

  ipcMain.handle("download:start", async (event, url, kind) => {
    const send = (progress) => {
      if (!event.sender.isDestroyed()) event.sender.send("download:progress", progress);
    };
    try {
      const file = await downloader.download(url, kind, send);
      return { ok: true, name: path.basename(file), path: file, url: share(file) };
    } catch (error) {
      if (!(error instanceof DownloadError)) console.error("Download failed:", error);
      return {
        ok: false,
        canceled: error instanceof DownloadCanceled,
        error: error instanceof DownloadError ? error.message : `The download failed: ${error?.message ?? error}`,
      };
    }
  });

  ipcMain.handle("download:cancel", () => downloader.cancel());
}

module.exports = {
  createDownloader,
  handleDownloads,
  DownloadError,
  DownloadCanceled,
  checkUrl,
  explainFailure,
  fileNameFor,
  videoFormat,
};
