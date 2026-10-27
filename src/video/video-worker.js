// The video's decoding, proxy and drawing, off the page's main thread (a
// module Worker; video/view.js is the page side). Drawing a big frame takes
// milliseconds of CPU; here it can't hold up the waveform, the cursor or
// the time readout, which share the page's thread ("playback is king",
// AGENTS.md).
//
// How the picture follows the transport, the decode cursor and the proxy
// fill-in are explained in view.js's header; the code for them is here.
//
// The clock: the page sends the transport's position on each of its
// animation frames, with the time it was taken. The worker draws on its own
// animation frames, at that position moved on by the time since and the
// rate the positions have been moving (CONFIG.video.clock), so the picture
// keeps going while the page is busy. Jumps (seeks, a loop going round)
// always come as `start`, pauses as `frame`.
//
// Surfaces: each canvas the page draws in is transferred here once
// (transferControlToOffscreen; a canvas can't be transferred twice) and
// kept by id. One not drawn in is shrunk to a pixel, which frees its
// memory; the page sends its size again when it's used again.
//
// Messages:
//   page → { type: "prepare", id, media }  (a File, or { name, url }: core/media.js)
//   ←      { type: "prepared", id, ok, reason }
//   page → { type: "discard", id }
//   page → { type: "watch-overview", id } / { type: "unwatch-overview", id }
//   ←      { type: "overview", id, share, done }  every 100 ms while watched
//   page → { type: "surface", id, canvas }  an OffscreenCanvas
//   page → { type: "use", id }  draw there from now on
//   page → { type: "size", id, width, height }  pixels
//   page → { type: "show", id }  a prepared video on screen, at 0
//   page → { type: "clear" }  no video
//   page → { type: "start", time, at } / { type: "frame", time }
//   page → { type: "position", position, at }  while playing
//   page → { type: "points", times }  the ready points, in seconds
//   page → { type: "memory", available }  bytes free (or null), for their budget
//   page → { type: "level", limits }  { maxBytes, maxMemoryShare }: how big it is
//   ←      { type: "ready" }  once Mediabunny is loaded
//   ←      { type: "shown", time, proxy }  each frame drawn
//   ←      { type: "built", built, overview }  the proxy's progress (text or null)
//   ←      { type: "problem", message }  once per file
//   ←      { type: "ready-points", times, allowed }  the points with a decoder
//          ready, and how many this video may have (video/ready-budget.js)
import {
  ALL_FORMATS,
  BlobSource,
  EncodedPacketSink,
  Input,
  UrlSource,
  VideoSampleSink,
} from "../../node_modules/mediabunny/dist/bundles/mediabunny.mjs";
import { CONFIG } from "../config.js";
import { mediaSource } from "../core/media.js";
import { createVideoProxy } from "./proxy.js";
import { readyPointsFor } from "./ready-budget.js";

const scope = /** @type {any} */ (self);
const post = (message) => scope.postMessage(message);
const { maxLagSeconds } = CONFIG.video;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The worker's own animation frames; a timer where there are none.
const nextFrameTick = scope.requestAnimationFrame
  ? (callback) => scope.requestAnimationFrame(callback)
  : (callback) => setTimeout(callback, 16);

/** @type {Map<number, any>} */
const videos = new Map(); // prepared, by the page's id: { input, track, sink, packets, firstTimestamp, proxy }
/** @type {Map<number, { canvas: OffscreenCanvas, context: OffscreenCanvasRenderingContext2D }>} */
const surfaces = new Map();
let surface = null; // the one drawn in
let current = null; // the video on screen

// What the picture should do: follow playback, or show one frame.
let mode = "idle"; // "idle" | "playing" | "frame"
let target = 0; // playing: latest position; frame: time to show
let targetVersion = 0; // bumped on every new target
let seekTarget = null; // playing: a jump to resolve before continuing
let streamEnded = false; // playing: no frames left after the cursor

// Samples held at any time: the cursor's last frame and nextFrame (often
// the same one). Everything else is closed right away.
let cursor = null; // { iterator, last, end }: frames in order
let nextFrame = null; // playing: decoded, waiting for its time
let looping = false; // only one decode loop at a time
let lastSkipCheckAt = 0;
let shownTime = null; // timestamp of the frame on screen
let shownIsProxy = false;
let proxyRequest = null; // time wanted from the proxy (latest wins)
let proxyBusy = false;
let sharpHeldUntil = 0; // performance.now() until which run() waits (head start)
/** @type {ReturnType<typeof setTimeout> | undefined} */
let heldRun; // timer for a run() waiting out the head start

/* ---------- The clock ---------- */

const now = () => performance.timeOrigin + performance.now();
let clock = null; // the latest { position, at } from the page
let rateFrom = null; // an earlier one, for the rate
let rate = 1; // seconds of track per second, as measured
let ticking = false; // the animation-frame loop runs while playing

function setClock(position, at) {
  if (!rateFrom) rateFrom = { position, at };
  else if (at - rateFrom.at >= CONFIG.video.clock.rateWindowMs) {
    const measured = (position - rateFrom.position) / ((at - rateFrom.at) / 1000);
    if (measured > 0 && measured < 10) rate = measured;
    rateFrom = { position, at };
  }
  clock = { position, at };
}

// Where playback is now: the latest position, moved on since.
function clockPosition() {
  if (!clock) return target;
  const ahead = Math.min(Math.max(0, now() - clock.at), CONFIG.video.clock.maxAheadMs);
  return clock.position + (ahead / 1000) * rate;
}

function tick() {
  if (mode !== "playing" || !current) {
    ticking = false;
    return;
  }
  advance(clockPosition());
  nextFrameTick(tick);
}

/* ---------- Opening files ---------- */

async function prepare(id, media) {
  let input = null;
  try {
    input = new Input({ formats: ALL_FORMATS, source: mediaSource(media, { BlobSource, UrlSource }) });

    const track = await input.getPrimaryVideoTrack();
    if (!track) return failed(id, input, "it has no video track");
    if (!(await track.canDecode()))
      return failed(id, input, `${track.codec?.toUpperCase() ?? "its"} video isn't supported`);

    const sink = new VideoSampleSink(track);
    const packets = new EncodedPacketSink(track); // for keyframe lookups
    const firstTimestamp = await track.getFirstTimestamp();

    // Decoding the first frame proves the picture really works.
    const first = await sink.getSample(firstTimestamp);
    if (!first) return failed(id, input, "its video couldn't be decoded");
    first.close();

    const video = { input, track, sink, packets, firstTimestamp, proxy: null, discarded: false };
    // Its frames' size, for the ready points' memory budget.
    Object.assign(video, { width: track.codedWidth, height: track.codedHeight });
    videos.set(id, video);
    startProxy(video, await track.computeDuration());
    post({ type: "prepared", id, ok: true, reason: null });
  } catch (error) {
    console.warn("Video prepare failed:", error);
    failed(id, input, "its video couldn't be read");
  }
}

function failed(id, input, reason) {
  input?.dispose?.();
  post({ type: "prepared", id, ok: false, reason });
}

// The proxy starts building at once, while the file still loads (its
// overview is what loading waits for: see view.js overviewReady).
function startProxy(video, duration) {
  const proxy = createVideoProxy({
    track: video.track,
    makeSourceSink: () => new VideoSampleSink(video.track), // each with its own decoder
    packets: video.packets,
    duration,
    onProgress: () => video === current && markBuilt(proxy),
  });
  video.proxy = proxy;
  // Gives way to this video's own sharp decoding (and ready points), not another's.
  proxy
    .build(() => (looping || prerolling) && video === current)
    .catch((error) => {
      if (!video.discarded) console.warn("Video proxy failed:", error);
    });
}

// The overview's progress while the page waits for it (view.js overviewReady).
/** @type {Map<number, ReturnType<typeof setInterval>>} */
const watching = new Map();
function watchOverview(id) {
  const video = videos.get(id);
  if (!video?.proxy) return post({ type: "overview", id, share: 1, done: true });
  let done = false;
  video.proxy.overviewReady.then(
    () => (done = true),
    () => (done = true),
  );
  const report = () => post({ type: "overview", id, share: video.proxy.overviewProgress(), done });
  watching.set(
    id,
    setInterval(() => {
      report();
      if (done) unwatchOverview(id);
    }, 100),
  );
}
function unwatchOverview(id) {
  clearInterval(watching.get(id));
  watching.delete(id);
}

function discard(video) {
  if (!video || video.discarded) return;
  video.discarded = true;
  for (const standby of [...standbys.values()]) if (standby.video === video) closeStandby(standby);
  video.proxy?.dispose(); // also stops its builder
  video.input.dispose?.();
  for (const [id, other] of videos) if (other === video) videos.delete(id);
}

function show(video) {
  reset();
  markBuilt(null);
  if (current && current !== video) discard(current);
  closeStandbys();
  current = video;
  showFrameAt(0);
  markBuilt(video.proxy); // what was built while it loaded
  postReadyPoints(); // and how many it may have
  prerollNext();
}

function clear() {
  reset();
  closeStandbys();
  discard(current);
  current = null;
  surface?.context.clearRect(0, 0, surface.canvas.width, surface.canvas.height);
  markBuilt(null);
}

function reset() {
  dropNextFrame();
  closeCursor();
  mode = "idle";
  targetVersion++;
  seekTarget = null;
  shownTime = null;
  shownIsProxy = false;
  proxyRequest = null;
  clearTimeout(heldRun);
  sharpHeldUntil = 0;
}

/* ---------- Surfaces ---------- */

function addSurface(id, canvas) {
  surfaces.set(id, { canvas, context: canvas.getContext("2d") });
}

// Draws from now on in surface `id`; the old one is emptied (a pixel).
// The frame on screen is redrawn in the new one.
function useSurface(id) {
  const next = surfaces.get(id);
  if (!next || next === surface) return;
  if (surface) surface.canvas.width = surface.canvas.height = 1;
  surface = next;
  if (!current) return;
  // The new canvas is empty: redraw what was on screen. While playing,
  // the next frame (or a proxy one, at once) draws it.
  const time = shownTime ?? target;
  shownTime = null;
  shownIsProxy = false;
  if (mode !== "playing") showFrameAt(time);
}

// Resizing clears the canvas; redraw the frame on screen when paused
// (while playing, the next frame redraws within a few milliseconds).
function resizeSurface(id, width, height) {
  const resized = surfaces.get(id);
  if (!resized) return;
  resized.canvas.width = width;
  resized.canvas.height = height;
  if (resized === surface && current && mode !== "playing") showFrameAt(shownTime ?? target);
}

/* ---------- Drawing ---------- */

// Letterboxes the frame into the canvas (honouring rotation metadata).
function draw(frame) {
  if (!surface) return;
  const { canvas, context } = surface;
  context.fillStyle = "#000";
  context.fillRect(0, 0, canvas.width, canvas.height);
  frame.drawWithFit(context, { fit: "contain" });
  markShown(frame.timestamp, false);
}

// Letterboxes a (low-resolution) proxy frame into the canvas.
function drawProxy(frame) {
  if (!surface) return;
  const { canvas, context } = surface;
  const { width, height } = canvas;
  const scale = Math.min(width / frame.displayWidth, height / frame.displayHeight);
  const drawWidth = frame.displayWidth * scale;
  const drawHeight = frame.displayHeight * scale;

  context.fillStyle = "#000";
  context.fillRect(0, 0, width, height);
  context.drawImage(frame, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
  markShown(frame.timestamp / 1e6, true);
}

// The page puts what's on screen on the canvas (data-frame-time, and
// data-proxy while a proxy frame shows; view.js).
function markShown(time, isProxy) {
  shownTime = time;
  shownIsProxy = isProxy;
  post({ type: "shown", time, proxy: isProxy });
}

// And the parts of `proxy` built so far, as "start–end" in seconds, and
// its overview's frames (data-proxy-built, data-proxy-overview).
function markBuilt(proxy) {
  const built =
    proxy &&
    proxy
      .built()
      .map(([from, to]) => `${from.toFixed(1)}–${to.toFixed(1)}`)
      .join(" ");
  post({ type: "built", built, overview: proxy && String(proxy.overviewCount()) });
}

/* ---------- Proxy fill-in ---------- */

// Whether a proxy frame for `time` should be shown: once the proxy is on
// screen it keeps going (every frame) until a sharp frame takes over; a
// sharp frame is only replaced when it is clearly off.
function wantsProxy(time) {
  if (shownIsProxy) return true;
  const off = shownTime === null ? Infinity : Math.abs(time - shownTime);
  return off >= CONFIG.video.proxy.useWhenOffBySeconds;
}

// Asks for the proxy frame at `time`. One decode at a time; while it
// runs, newer requests replace older ones. Returns whether it asked.
function requestProxy(time) {
  if (!current?.proxy || !wantsProxy(time)) return false;
  proxyRequest = time;
  if (!proxyBusy) serveProxy();
  return true;
}

// After a seek: show the proxy first, then decode sharp frames.
function requestProxyWithHeadStart(time) {
  if (requestProxy(time)) sharpHeldUntil = performance.now() + CONFIG.video.proxy.headStartMs;
}

async function serveProxy() {
  proxyBusy = true;
  try {
    while (proxyRequest !== null && current?.proxy) {
      const video = current;
      const time = proxyRequest;
      proxyRequest = null;

      const frame = await video.proxy.frameAt(time);
      if (!frame) continue;
      try {
        // Draw only if still useful: the sharp picture may have caught up,
        // or be nearer than this frame (one from the overview can be off
        // by a keyframe gap).
        const wanted = mode === "playing" ? target : time;
        const nearer = shownTime === null || Math.abs(frame.timestamp / 1e6 - wanted) < Math.abs(shownTime - wanted);
        if (video === current && wantsProxy(wanted) && nearer) drawProxy(frame);
      } finally {
        frame.close();
      }
    }
  } catch (error) {
    console.warn("Proxy frame failed:", error);
  } finally {
    proxyBusy = false;
    // The proxy frame is on screen: end the head start early.
    if (sharpHeldUntil > performance.now()) {
      sharpHeldUntil = 0;
      run();
    }
  }
}

/* ---------- Decode cursor ---------- */

// Closes a sample unless it is still in use (as the cursor's last frame
// or as nextFrame).
function release(sample) {
  if (sample && sample !== cursor?.last && sample !== nextFrame) sample.close();
}

function dropNextFrame() {
  const sample = nextFrame;
  nextFrame = null;
  release(sample);
}

// Starts decoding at the keyframe before `time` (frames before `time`
// are pulled and skipped by the caller, which can stop at any frame).
async function openCursor(video, time) {
  closeCursor();
  const keyframe = await keyframeBefore(video, Math.max(time, video.firstTimestamp));
  if (video !== current) return;
  cursor = { iterator: video.sink.samples(keyframe), last: null, end: -Infinity };
}

function closeCursor() {
  if (!cursor) return;
  const { iterator, last } = cursor;
  cursor = null;
  iterator.return?.().catch(() => {});
  release(last);
}

// Next frame from the cursor, or null at the end of the video (or if the
// cursor was replaced while decoding).
async function pullFrame() {
  const own = cursor;
  const result = await own.iterator.next();
  if (own !== cursor) {
    result.value?.close();
    return null;
  }
  if (result.done) {
    closeCursor();
    return null;
  }
  const previous = own.last;
  own.last = result.value;
  own.end = result.value.timestamp + result.value.duration;
  release(previous);
  return result.value;
}

async function keyframeBefore(video, time) {
  const packet = await video.packets.getKeyPacket(time, { metadataOnly: true });
  return packet ? packet.timestamp : video.firstTimestamp;
}

// Whether continuing the cursor reaches `time` with less work than
// opening a new one (which decodes from the keyframe before `time`).
async function cursorCanReach(video, time) {
  if (!cursor?.last || time < cursor.last.timestamp) return false;
  if (time < cursor.end) return true;
  return (await keyframeBefore(video, time)) <= cursor.last.timestamp;
}

/* ---------- Decode loop ---------- */

// Frame shown at `time`. If `interrupted()` turns true on the way (a newer
// target while dragging), returns the latest frame so progress is visible.
async function frameAt(video, time, interrupted) {
  const t = Math.max(time, video.firstTimestamp);
  if (!(await cursorCanReach(video, t))) await openCursor(video, t);
  if (!cursor) return null;
  if (cursor.last && t < cursor.end) return cursor.last;

  for (;;) {
    const frame = await pullFrame();
    if (!frame) return null;
    if (frame.timestamp + frame.duration > t || interrupted()) return frame;
  }
}

// Next frame still worth showing during playback; frames whose time has
// already passed are skipped without drawing.
async function nextPlaybackFrame(video) {
  if (seekTarget !== null) {
    const jumpTo = seekTarget;
    seekTarget = null;
    if (!(await cursorCanReach(video, jumpTo))) await openCursor(video, jumpTo);
  }

  for (;;) {
    if (!cursor) await openCursor(video, target);
    if (!cursor || video !== current) return null;

    // Falling behind (heavy file at high speed): jump ahead, but only if a
    // later keyframe makes that cheaper than decoding on.
    if (target - cursor.end > maxLagSeconds && performance.now() - lastSkipCheckAt > 250) {
      lastSkipCheckAt = performance.now();
      if ((await keyframeBefore(video, target)) > cursor.end) await openCursor(video, target);
      if (!cursor) return null;
    }

    const frame = await pullFrame();
    if (mode !== "playing" || video !== current || seekTarget !== null) return null;
    if (!frame) {
      if (!cursor) streamEnded = true;
      return null;
    }
    if (frame.timestamp + frame.duration > target) return frame;
  }
}

async function run() {
  if (looping) return;
  const wait = sharpHeldUntil - performance.now();
  if (wait > 0) {
    clearTimeout(heldRun);
    heldRun = setTimeout(run, wait);
    return;
  }
  looping = true;

  try {
    while (current) {
      const video = current;
      try {
        if (mode === "frame") {
          const version = targetVersion;
          const frame = await frameAt(video, target, () => targetVersion !== version);
          if (video !== current) continue;
          const reached = targetVersion === version;
          // The exact frame always replaces what's shown; a frame on the way
          // (while dragging) only if it is closer than what's shown.
          if (frame && mode === "frame") {
            const closer = Math.abs(target - frame.timestamp) < Math.abs(target - (shownTime ?? Infinity));
            if (reached || closer) draw(frame);
          }
          if (reached) break;
        } else if (mode === "playing") {
          if (nextFrame || streamEnded) break;
          const frame = await nextPlaybackFrame(video);
          if (video !== current || mode !== "playing") continue;
          if (frame) {
            nextFrame = frame;
            break;
          }
          if (streamEnded) break;
        } else {
          break;
        }
      } catch (error) {
        closeCursor();
        // The video was put away while it was being decoded (another file
        // opened): its input is gone, which says nothing about the file.
        // Carry on with whatever is shown now; only a failure of the
        // current video is reported.
        if (video !== current || video.discarded) continue;
        throw error;
      }
    }
  } catch (error) {
    console.warn("Video decoding failed:", error);
    closeCursor();
    // The next request retries; the user hears about it once per file.
    if (current && !current.problemReported) {
      current.problemReported = true;
      post({
        type: "problem",
        message: "Part of the video couldn't be decoded, so the picture may stop updating. The audio is unaffected.",
      });
    }
  } finally {
    looping = false;
  }
}

/* ---------- Ready points ---------- */

// A decoder waiting at each ready point (see view.js): it has decoded from
// the keyframe before its point up to the frame there, and holds that
// frame. A jump to the point takes it as the cursor, so the sharp frame is
// on screen at once and the frames after it follow without a keyframe's
// worth of decoding; then the point gets a new one. Each has a decoder of
// its own (its own VideoSampleSink), and they get ready one at a time,
// only while the sharp decoding is idle ("playback is king").
/** @type {Map<number, { time: number, video: any, iterator: any, last: any, end: number, ready: boolean, closed: boolean }>} */
const standbys = new Map(); // by point, for the video on screen
let points = []; // the page's ready points, in seconds, most wanted first
const failedPoints = new Set(); // points whose decoder failed, for this video
let prerolling = false;
let availableMemory = null; // bytes free, from the page (null: unknown)
let levelLimits = CONFIG.video.readyPoints.levels.normal; // Settings › Advanced

// How many decoders may wait for the video on screen: fewer for bigger
// frames, as each holds dozens of them (video/ready-budget.js).
function allowedPoints() {
  if (!current) return 0;
  const { width, height } = current;
  return readyPointsFor({ width, height, available: availableMemory }, { ...CONFIG.video.readyPoints, ...levelLimits });
}

// The points that get a decoder: the first ones, as many as allowed.
const wantedPoints = () => points.slice(0, allowedPoints());

/** @param {number[]} times */
function setPoints(times) {
  points = times;
  const wanted = wantedPoints();
  for (const standby of [...standbys.values()]) if (!wanted.includes(standby.time)) closeStandby(standby);
  postReadyPoints();
  prerollNext();
}

function closeStandby(standby) {
  if (standbys.get(standby.time) === standby) standbys.delete(standby.time);
  if (standby.closed) return;
  standby.closed = true;
  standby.iterator?.return?.().catch(() => {});
  standby.last?.close();
}

function closeStandbys() {
  for (const standby of [...standbys.values()]) closeStandby(standby);
  failedPoints.clear();
  postReadyPoints();
}

function postReadyPoints() {
  const times = [...standbys.values()].filter((standby) => standby.ready).map((standby) => standby.time);
  post({ type: "ready-points", times: times.sort((a, b) => a - b), allowed: allowedPoints() });
}

// Busy: the sharp decoding is working, or playback is behind (a proxy
// frame on screen, or the cursor not far enough ahead).
const { pauseWhenBehindSeconds, waitMs } = CONFIG.video.readyPoints;
const busyForPoints = () =>
  looping ||
  (mode === "playing" && (shownIsProxy || (cursor !== null && target - cursor.end > pauseWhenBehindSeconds)));

// Gets the points without a decoder ready, one after another.
async function prerollNext() {
  if (prerolling) return;
  prerolling = true;
  try {
    for (;;) {
      const video = current;
      const time = wantedPoints().find((point) => !standbys.has(point) && !failedPoints.has(point));
      if (!video || time === undefined) break;
      await preroll(video, time);
    }
  } finally {
    prerolling = false;
  }
}

async function preroll(video, time) {
  const point = Math.max(time, video.firstTimestamp);
  const standby = { time, video, iterator: null, last: null, end: -Infinity, ready: false, closed: false };
  standbys.set(time, standby);
  const gone = () => standby.closed || video !== current;
  try {
    // Not even a decoder while busy: the start point moves with every
    // click and drag, and the sharp decoding comes first then.
    while (busyForPoints() && !gone()) await sleep(waitMs);
    if (gone()) return closeStandby(standby);
    const keyframe = await keyframeBefore(video, point);
    if (gone()) return closeStandby(standby);
    standby.iterator = new VideoSampleSink(video.track).samples(keyframe);
    for (;;) {
      while (busyForPoints() && !gone()) await sleep(waitMs);
      if (gone()) return closeStandby(standby);
      const result = await standby.iterator.next();
      if (gone()) {
        result.value?.close();
        return closeStandby(standby);
      }
      if (result.done) break; // the point is past the last frame: that one
      standby.last?.close();
      standby.last = result.value;
      standby.end = result.value.timestamp + result.value.duration;
      if (standby.end > point) break;
    }
    if (!standby.last) throw new Error("no frame there");
    standby.ready = true;
    postReadyPoints();
  } catch (error) {
    if (gone()) return closeStandby(standby);
    console.warn("Video ready point failed:", error);
    failedPoints.add(time);
    closeStandby(standby);
  }
}

// A jump to `time`: if a decoder is ready there, it becomes the cursor
// and its frame is returned (to draw at once); the point gets a new one.
// Up to sameSeconds past its frame (a start point a few ms after the loop
// start) takes it too: its frame shows, and the cursor decodes on from it.
function takeStandby(time) {
  if (!current) return null;
  const t = Math.max(time, current.firstTimestamp);
  for (const standby of standbys.values()) {
    if (!standby.ready || standby.video !== current) continue;
    if (t < standby.last.timestamp - 0.001 || t >= standby.end + CONFIG.video.readyPoints.sameSeconds) continue;
    standbys.delete(standby.time);
    closeCursor();
    cursor = { iterator: standby.iterator, last: standby.last, end: standby.end };
    postReadyPoints();
    prerollNext();
    return cursor.last;
  }
  return null;
}

/* ---------- Following the transport ---------- */

// Not playing: show exactly the frame at `time`.
function showFrameAt(time) {
  if (!current) return;
  mode = "frame";
  target = time;
  targetVersion++;
  dropNextFrame();
  // A ready point: its sharp frame now; then the exact one, if `time` is a
  // frame or two past it.
  const ready = takeStandby(time);
  if (ready) {
    draw(ready);
    if (time >= cursor.end) run();
    return;
  }
  if (!(cursor?.last && cursor.last.timestamp <= time && time < cursor.end)) requestProxyWithHeadStart(time);
  run();
}

// Playing (or jumped while playing) from `time`, as of `at`.
function start(time, at) {
  if (!current) return;
  mode = "playing";
  target = time;
  targetVersion++;
  seekTarget = time;
  streamEnded = false;
  clock = { position: time, at };
  rateFrom = null;
  dropNextFrame();
  // A ready point: its sharp frame now, and the cursor is already there.
  const ready = takeStandby(time);
  if (ready) {
    seekTarget = null;
    draw(ready);
  } else requestProxyWithHeadStart(time);
  run();
  if (!ticking) {
    ticking = true;
    nextFrameTick(tick);
  }
}

// Each animation frame while playing, at the clock's position.
function advance(position) {
  if (!current || mode !== "playing") return;
  target = position;

  if (nextFrame && nextFrame.timestamp <= position) {
    draw(nextFrame);
    dropNextFrame(); // stays open while it is still the cursor's last frame
  } else {
    // Sharp frames are behind (just jumped, or a heavy file at high
    // speed): keep the picture moving with the proxy meanwhile.
    requestProxy(position);
  }
  if (!nextFrame && !streamEnded) run();
}

/* ---------- Messages ---------- */

scope.onmessage = ({ data }) => {
  switch (data.type) {
    case "prepare":
      return prepare(data.id, data.media);
    case "discard":
      return discard(videos.get(data.id));
    case "watch-overview":
      return watchOverview(data.id);
    case "unwatch-overview":
      return unwatchOverview(data.id);
    case "surface":
      return addSurface(data.id, data.canvas);
    case "use":
      return useSurface(data.id);
    case "size":
      return resizeSurface(data.id, data.width, data.height);
    case "show": {
      const video = videos.get(data.id);
      return video && show(video);
    }
    case "clear":
      return clear();
    case "start":
      return start(data.time, data.at);
    case "frame":
      return showFrameAt(data.time);
    case "position":
      return mode === "playing" && setClock(data.position, data.at);
    case "points":
      return setPoints(Array.isArray(data.times) ? data.times.filter(Number.isFinite) : []);
    case "memory":
      availableMemory = Number.isFinite(data.available) ? data.available : null;
      return setPoints(points);
    case "level":
      levelLimits = data.limits;
      return setPoints(points);
  }
};

post({ type: "ready" });
