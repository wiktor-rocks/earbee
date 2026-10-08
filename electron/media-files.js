// Files on disk that the page may read, without sending it the bytes: a
// downloaded file is served under a private URL, and the page reads it in
// pieces (Mediabunny's UrlSource asks for byte ranges as it needs them),
// as it reads a file the user opened. Before this, a download crossed IPC
// whole and stayed in the page's memory while it was open.
//
//   registerMediaScheme(protocol)  before the app is ready: the scheme may
//                                  be fetched, also from Workers
//   createMediaFiles()             → { share(path) → url, handle(protocol) }
//
// Only files the app itself shares are served, each under a random token
// (transcribee-media://<token>/<name>), never a path the page names.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");

const SCHEME = "transcribee-media";

function registerMediaScheme(protocol) {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
    },
  ]);
}

/**
 * The bytes a Range header asks for, as { start, end } (end inclusive) and
 * whether that is part of the file; null if nothing can be served
 * (answered 416). No header, or one that isn't a single byte range, means
 * the whole file.
 * @param {string | null} header
 * @param {number} size
 * @returns {{ start: number, end: number, partial: boolean } | null}
 */
function parseRange(header, size) {
  const whole = { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header ?? "").trim());
  if (!match || (match[1] === "" && match[2] === "")) return whole;
  const [first, last] = [match[1], match[2]].map((text) => (text === "" ? null : Number(text)));
  if (first === null) {
    // "bytes=-n": the last n bytes.
    if (last === 0 || size === 0) return null;
    return { start: Math.max(0, size - last), end: size - 1, partial: true };
  }
  if (first >= size || (last !== null && last < first)) return null;
  return { start: first, end: last === null ? size - 1 : Math.min(last, size - 1), partial: true };
}

function createMediaFiles() {
  const shared = new Map(); // token → path

  const headers = {
    "Accept-Ranges": "bytes",
    // The page's origin is file://, which fetches as "null".
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Range",
    "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges",
  };

  /** @param {Request} request */
  async function respond(request) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    const file = shared.get(new URL(request.url).hostname);
    if (!file) return new Response(null, { status: 404, headers });
    if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405, headers });

    let size;
    try {
      size = (await fs.promises.stat(file)).size;
    } catch {
      return new Response(null, { status: 404, headers });
    }
    const range = parseRange(request.headers.get("Range"), size);
    if (!range) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });

    const { start, end, partial } = range;
    const length = Math.max(0, end - start + 1);
    const body =
      request.method === "HEAD" || length === 0
        ? null
        : /** @type {ReadableStream} */ (Readable.toWeb(fs.createReadStream(file, { start, end })));
    return new Response(body, {
      status: partial ? 206 : 200,
      headers: {
        ...headers,
        "Content-Length": String(length),
        ...(partial ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
      },
    });
  }

  return {
    /** Serves `file` to the page; returns its URL. @param {string} file */
    share(file) {
      const token = crypto.randomUUID();
      shared.set(token, file);
      return `${SCHEME}://${token}/${encodeURIComponent(path.basename(file))}`;
    },
    /** @param {import("electron").Protocol} protocol */
    handle(protocol) {
      protocol.handle(SCHEME, respond);
    },
    respond, // for the tests
  };
}

module.exports = { SCHEME, registerMediaScheme, createMediaFiles, parseRange };
