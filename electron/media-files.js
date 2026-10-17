// Files on disk that the page may read, without sending it the bytes: a
// downloaded file is served under a private URL, and the page reads it in
// pieces (Mediabunny's UrlSource asks for byte ranges as it needs them),
// as it reads a file the user opened. Before this, a download crossed IPC
// whole and stayed in the page's memory while it was open.
//
//   registerMediaScheme(protocol)  before the app is ready: the scheme may
//                                  be fetched, also from Workers
//   createMediaFiles()             → { share(path, slice?) → url, lookup(url),
//                                      update(url, slice), handle(protocol) }
//
// Only files the app itself shares are served, each under a random token
// (earbee-media://<token>/<name>), never a path the page names. A
// share can be a slice of a file: the media inside a project file
// (project-files.js) is served straight from it, as if it were its own file.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");

const SCHEME = "earbee-media";

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

// The length of what a share serves: the whole file, or its slice (never
// past the file's end).
async function sliceSize({ path: file, offset, size }) {
  const fileSize = (await fs.promises.stat(file)).size;
  const rest = Math.max(0, fileSize - offset);
  return size === null ? rest : Math.min(size, rest);
}

// The token in a URL from share(), or null.
function tokenOf(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === `${SCHEME}:` ? parsed.hostname : null;
  } catch {
    return null;
  }
}

function createMediaFiles() {
  const shared = new Map(); // token → { path, name, offset, size } (size null: to the end)

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
    const source = shared.get(new URL(request.url).hostname);
    if (!source) return new Response(null, { status: 404, headers });
    if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405, headers });

    let size;
    try {
      size = await sliceSize(source);
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
        : /** @type {ReadableStream} */ (
            Readable.toWeb(fs.createReadStream(source.path, { start: source.offset + start, end: source.offset + end }))
          );
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
    /**
     * Serves `file` to the page, or `slice.size` bytes of it from
     * `slice.offset`, under `slice.name`; returns its URL.
     * @param {string} file
     * @param {{ offset?: number, size?: number | null, name?: string }} [slice]
     */
    share(file, { offset = 0, size = null, name = path.basename(file) } = {}) {
      const token = crypto.randomUUID();
      shared.set(token, { path: file, name, offset, size });
      return `${SCHEME}://${token}/${encodeURIComponent(name)}`;
    },
    /**
     * Serves something else under a URL from share(), from now on (a
     * project saved with the media inside: the media's new place).
     * @param {string} url
     * @param {{ path: string, offset?: number, size?: number | null, name?: string }} slice
     */
    update(url, { path: file, offset = 0, size = null, name = path.basename(file) }) {
      const token = tokenOf(url);
      if (token && shared.has(token)) shared.set(token, { path: file, name, offset, size });
    },
    /**
     * What a URL from share() serves, or null if it isn't one.
     * @param {string} url
     * @returns {{ path: string, name: string, offset: number, size: number | null } | null}
     */
    lookup(url) {
      return shared.get(tokenOf(url)) ?? null;
    },
    /** @param {import("electron").Protocol} protocol */
    handle(protocol) {
      protocol.handle(SCHEME, respond);
    },
    respond, // for the tests
  };
}

module.exports = { SCHEME, registerMediaScheme, createMediaFiles, parseRange, sliceSize };
