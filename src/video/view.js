/* =====================================================================
 * VIDEO
 * The picture for video files. Frames are decoded on demand with
 * WebCodecs (via Mediabunny, which also reads MP4/MOV/WebM/MKV) and the
 * frame whose timestamp is at the transport position is drawn on a
 * canvas. The transport stays the only clock: there is no <video>
 * element running its own time, so the picture can't drift from the
 * audio and is frame-exact when paused, after seeks and at any speed.
 *
 * Decoding cost: a frame can only be decoded after every frame since the
 * previous keyframe, which in real videos can be several seconds back.
 * So all decoding goes through one "cursor", a stream of frames in
 * order, and a new cursor (decoding from a keyframe again) is opened
 * only when continuing the current one would be more work:
 *   - seeking forward within the same keyframe run continues the cursor;
 *   - falling behind during playback jumps only if a later keyframe
 *     makes that cheaper;
 *   - a new cursor starts at the keyframe itself and decodes forward
 *     frame by frame, so it can be interrupted: while dragging, the
 *     frames on the way are drawn (the keyframe appears almost at once)
 *     and the newest target always wins without throwing work away.
 * One decode loop runs at a time and re-reads the target after every
 * frame, so rapid seeking never builds a backlog.
 *
 * Proxy: in the background (only while the main decoder is idle) the
 * whole video is re-encoded once at low resolution with a keyframe every
 * few frames (createVideoProxy). When the sharp frame for a position
 * isn't ready, the proxy frame for exactly that time is drawn instead,
 * at full frame rate, and the sharp frames take over once decoded.
 *
 * Frames are decoded as lightweight VideoSamples; only the ones actually
 * drawn are painted, and every sample is closed as soon as it isn't
 * needed (they hold decoder memory).
 *
 * Errors: the picture is never allowed to break playback. Failures are
 * logged with console.warn; the proxy is optional (without it, seeking is
 * just slower), and a decoding failure is reported once per file through
 * onProblem.
 *
 * Exposes: preload, prepare, show, clear, discard,
 *          start, advance, showFrameAt
 *   prepare(media) → { video, reason }: opens a file (a File, or a
 *   download's { name, url }; core/files.js) without touching the
 *   video on screen; `video` is null (with a reason) if it has no
 *   picture this app can decode. Never throws.
 * ===================================================================== */

import { CONFIG } from "../config.js";
import { mediaSource } from "../core/files.js";
import { createVideoProxy } from "./proxy.js";

/**
 * @param {object} options
 * @param {HTMLElement} options.pane The box the picture sits in (hidden for audio files).
 * @param {HTMLCanvasElement} options.canvas
 * @param {(visible: boolean) => void} options.onVisibilityChange Switch the page layout.
 * @param {(message: string) => void} options.onProblem Tell the user the picture is in trouble.
 */
export function createVideoView({ pane, canvas, onVisibilityChange, onProblem }) {
  const { maxLagSeconds } = CONFIG.video;
  const context2d = canvas.getContext("2d");

  let modulePromise = null;
  // On screen: { input, track, sink, proxySourceSink, packets,
  //              firstTimestamp, proxy }
  let current = null;

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

  // Loads Mediabunny without creating anything; safe at startup.
  function preload() {
    modulePromise ??= import("../../node_modules/mediabunny/dist/bundles/mediabunny.mjs").catch((error) => {
      modulePromise = null; // let the next call retry
      throw error;
    });
    return modulePromise;
  }

  /* ---------- Opening files ---------- */

  /** @param {import("../core/files.js").Media} media */
  async function prepare(media) {
    let input = null;
    try {
      const { Input, BlobSource, UrlSource, ALL_FORMATS, VideoSampleSink, EncodedPacketSink } = await preload();
      input = new Input({ formats: ALL_FORMATS, source: mediaSource(media, { BlobSource, UrlSource }) });

      const track = await input.getPrimaryVideoTrack();
      if (!track) return failed(input, "it has no video track");
      if (!(await track.canDecode()))
        return failed(input, `${track.codec?.toUpperCase() ?? "its"} video isn't supported`);

      const sink = new VideoSampleSink(track);
      const proxySourceSink = new VideoSampleSink(track); // its own decoder
      const packets = new EncodedPacketSink(track); // for keyframe lookups
      const firstTimestamp = await track.getFirstTimestamp();

      // Decoding the first frame proves the picture really works.
      const first = await sink.getSample(firstTimestamp);
      if (!first) return failed(input, "its video couldn't be decoded");
      first.close();

      return {
        video: { input, track, sink, proxySourceSink, packets, firstTimestamp, proxy: null },
        reason: null,
      };
    } catch (error) {
      console.warn("Video prepare failed:", error);
      return failed(input, "its video couldn't be read");
    }
  }

  function failed(input, reason) {
    input?.dispose?.();
    return { video: null, reason };
  }

  function discard(video) {
    if (!video) return;
    video.discarded = true;
    video.proxy?.dispose(); // also stops its builder
    video.input.dispose?.();
  }

  function show(video) {
    reset();
    if (current && current !== video) discard(current);
    current = video;
    pane.hidden = false;
    onVisibilityChange(true);
    resizeCanvas();
    showFrameAt(0);

    video.proxy = createVideoProxy({ track: video.track, sourceSink: video.proxySourceSink });
    video.proxy
      .build(() => looping)
      .catch((error) => {
        if (!video.discarded) console.warn("Video proxy failed:", error);
      });
  }

  function clear() {
    reset();
    discard(current);
    current = null;
    pane.hidden = true;
    onVisibilityChange(false);
    context2d.clearRect(0, 0, canvas.width, canvas.height);
    delete canvas.dataset.frameTime;
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

  /* ---------- Drawing ---------- */

  // Letterboxes the frame into the canvas (honouring rotation metadata).
  function draw(frame) {
    context2d.fillStyle = "#000";
    context2d.fillRect(0, 0, canvas.width, canvas.height);
    frame.drawWithFit(context2d, { fit: "contain" });
    markShown(frame.timestamp, false);
  }

  // Letterboxes a (low-resolution) proxy frame into the canvas.
  function drawProxy(frame) {
    const { width, height } = canvas;
    const scale = Math.min(width / frame.displayWidth, height / frame.displayHeight);
    const drawWidth = frame.displayWidth * scale;
    const drawHeight = frame.displayHeight * scale;

    context2d.fillStyle = "#000";
    context2d.fillRect(0, 0, width, height);
    context2d.drawImage(frame, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
    markShown(frame.timestamp / 1e6, true);
  }

  // The canvas carries what's on screen (used by tests and handy in
  // DevTools): data-frame-time, plus data-proxy while a proxy frame shows.
  function markShown(time, isProxy) {
    shownTime = time;
    shownIsProxy = isProxy;
    canvas.dataset.frameTime = time.toFixed(3);
    if (isProxy) canvas.dataset.proxy = "";
    else delete canvas.dataset.proxy;
  }

  function resizeCanvas() {
    const ratio = window.devicePixelRatio;
    canvas.width = Math.max(1, Math.round(pane.clientWidth * ratio));
    canvas.height = Math.max(1, Math.round(pane.clientHeight * ratio));
  }

  // Resizing clears the canvas; redraw the frame on screen when paused
  // (while playing, the next frame redraws within a few milliseconds).
  new ResizeObserver(() => {
    if (pane.hidden) return;
    resizeCanvas();
    if (current && mode !== "playing") showFrameAt(shownTime ?? target);
  }).observe(pane);

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
          // Draw only if still useful: the sharp picture may have caught up.
          const wanted = mode === "playing" ? target : time;
          if (video === current && wantsProxy(wanted)) drawProxy(frame);
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
      }
    } catch (error) {
      console.warn("Video decoding failed:", error);
      closeCursor();
      // The next request retries; the user hears about it once per file.
      if (current && !current.problemReported) {
        current.problemReported = true;
        onProblem("Part of the video couldn't be decoded, so the picture may stop updating. The audio is unaffected.");
      }
    } finally {
      looping = false;
    }
  }

  /* ---------- Following the transport ---------- */

  // Not playing: show exactly the frame at `time`.
  function showFrameAt(time) {
    if (!current) return;
    mode = "frame";
    target = time;
    targetVersion++;
    dropNextFrame();
    if (!(cursor?.last && cursor.last.timestamp <= time && time < cursor.end)) requestProxyWithHeadStart(time);
    run();
  }

  // Playing (or jumped while playing) from `time`.
  function start(time) {
    if (!current) return;
    mode = "playing";
    target = time;
    targetVersion++;
    seekTarget = time;
    streamEnded = false;
    dropNextFrame();
    requestProxyWithHeadStart(time);
    run();
  }

  // Called every animation frame while playing.
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

  return {
    preload,
    prepare,
    show,
    clear,
    discard,
    start,
    advance,
    showFrameAt,
  };
}

/** @typedef {ReturnType<typeof createVideoView>} VideoView */
