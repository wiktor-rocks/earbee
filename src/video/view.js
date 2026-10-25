/* =====================================================================
 * VIDEO
 * The picture for video files. Frames are decoded on demand with
 * WebCodecs (via Mediabunny, which also reads MP4/MOV/WebM/MKV) and the
 * frame whose timestamp is at the transport position is drawn on a
 * canvas. The transport stays the only clock: there is no <video>
 * element running its own time, so the picture can't drift from the
 * audio and is frame-exact when paused, after seeks and at any speed.
 *
 * Off the page's thread: the decoding, the proxy and the drawing run in a
 * Worker (video/video-worker.js), which draws on the canvas through an
 * OffscreenCanvas. Drawing a big frame costs milliseconds of CPU; there it
 * can't hold up the waveform, the cursor or the time readout ("playback
 * is king", AGENTS.md). This file is the page side: it hands the worker
 * the files, the canvases, their sizes and the transport's position (on
 * each animation frame, with the time it was taken), and shows on the
 * canvas what the worker drew. Between positions the worker's clock moves
 * on by itself, so the picture keeps going while the page is busy.
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
 * Proxy: from the moment a file is prepared (while it still loads), and
 * then only while the main decoder is idle, the video is re-encoded at
 * low resolution with a keyframe every few frames (createVideoProxy).
 * First a coarse overview, one frame per keyframe, which loading waits
 * for (overviewReady, at most a few seconds), then the whole video, by
 * several builders at once; a position asked for that isn't built yet
 * moves a builder there. When the sharp frame for a position isn't
 * ready, the proxy frame for exactly that time is drawn instead (or the
 * overview's nearest one, if that is nearer than what is on screen), at
 * full frame rate, and the sharp frames take over once decoded. The
 * canvas's data-proxy-built shows what is built, data-proxy-overview the
 * overview's frames.
 *
 * Frames are decoded as lightweight VideoSamples; only the ones actually
 * drawn are painted, and every sample is closed as soon as it isn't
 * needed (they hold decoder memory).
 *
 * Errors: the picture is never allowed to break playback. Failures are
 * logged with console.warn; the proxy is optional (without it, seeking is
 * just slower), and a decoding failure is reported once per file through
 * onProblem. If the worker itself stops, the picture stops for the rest
 * of the session (a canvas can be handed to a worker only once), with
 * one onProblem message.
 *
 * Exposes: preload, prepare, overviewReady, show, clear, discard,
 *          start, advance, showFrameAt, attach
 *   prepare(media) → { video, reason }: opens a file (a File, or a
 *   download's { name, url }; core/media.js) without touching the
 *   video on screen; `video` is null (with a reason) if it has no
 *   picture this app can decode. Never throws.
 *   overviewReady(video, ms, signal, onProgress) waits (at most `ms`)
 *   for a prepared video's proxy overview, reporting the share done.
 *   attach({ pane, canvas }) moves the picture to another pane and
 *   canvas, which may be in another same-origin window; the frame on
 *   screen is redrawn there and the old pane is hidden.
 * ===================================================================== */

/**
 * @param {object} options
 * @param {HTMLElement} options.pane The box the picture sits in (hidden for audio files).
 * @param {HTMLCanvasElement} options.canvas
 * @param {(visible: boolean) => void} options.onVisibilityChange Switch the page layout.
 * @param {(message: string) => void} options.onProblem Tell the user the picture is in trouble.
 */
export function createVideoView({ pane, canvas, onVisibilityChange, onProblem }) {
  /** @type {Worker | null} */
  let worker = null;
  /** @type {Promise<void> | null} */
  let ready = null; // settles once the worker has loaded Mediabunny
  let stopped = false; // the worker failed: no picture this session
  let nextId = 1;
  /** @type {Map<number, (prepared: { video: { id: number } | null, reason: string | null }) => void>} */
  const preparing = new Map();
  /** @type {Map<number, { onProgress: (share: number) => void, done: () => void }>} */
  const overviews = new Map();
  // Each canvas's surface in the worker (a canvas is transferred once).
  /** @type {WeakMap<HTMLCanvasElement, number>} */
  const surfaces = new WeakMap();
  let surfaceId = 0; // the one drawn in
  let showing = false; // a video is on screen
  /** @type {ResizeObserver | undefined} */
  let resizeObserver;

  const now = () => performance.timeOrigin + performance.now();
  const send = (message, transfer = []) => worker && !stopped && worker.postMessage(message, transfer);

  /* ---------- The worker ---------- */

  function startWorker() {
    if (worker) return;
    worker = new Worker(new URL("./video-worker.js", import.meta.url), { type: "module" });
    ready = new Promise((resolve, reject) => {
      worker.addEventListener("message", ({ data }) => {
        if (data.type === "ready") resolve();
      });
      worker.addEventListener("error", () => reject(new Error("the video worker couldn't start")), { once: true });
    });
    ready.catch(() => {}); // seen by preload's caller
    worker.addEventListener("message", ({ data }) => onMessage(data));
    worker.addEventListener("error", (event) => {
      event.preventDefault();
      stop(event.message || "the video worker stopped");
    });
    surfaceId = surfaceFor(canvas);
    send({ type: "use", id: surfaceId });
  }

  // The worker failed: whatever waits for it gives up, and the user
  // hears about it once if a video is on screen.
  function stop(reason) {
    if (stopped) return;
    stopped = true;
    console.warn("Video worker failed:", reason);
    for (const resolve of preparing.values()) resolve({ video: null, reason: "its video couldn't be read" });
    preparing.clear();
    for (const { done } of overviews.values()) done();
    if (showing) onProblem("The video's picture stopped. The audio is unaffected.");
  }

  function onMessage(data) {
    switch (data.type) {
      case "prepared": {
        const resolve = preparing.get(data.id);
        preparing.delete(data.id);
        return resolve?.({ video: data.ok ? { id: data.id } : null, reason: data.reason });
      }
      case "overview": {
        const watch = overviews.get(data.id);
        watch?.onProgress(data.share);
        if (data.done) watch?.done();
        return;
      }
      case "shown":
        return showing && markShown(data.time, data.proxy);
      case "built":
        builtText = data.built;
        overviewText = data.overview;
        return showBuilt();
      case "problem":
        return onProblem(data.message);
    }
  }

  // Loads the worker (and Mediabunny in it) without opening anything;
  // safe at startup.
  function preload() {
    startWorker();
    return /** @type {Promise<void>} */ (ready);
  }

  /* ---------- Opening files ---------- */

  /** @param {import("../core/media.js").Media} media */
  function prepare(media) {
    startWorker();
    if (stopped) return Promise.resolve({ video: null, reason: "its video couldn't be read" });
    const id = nextId++;
    return new Promise((resolve) => {
      preparing.set(id, resolve);
      send({ type: "prepare", id, media });
    });
  }

  // Waits (at most `ms`, or until `signal` aborts) until the proxy's
  // overview of a prepared video is done, so dragging anywhere shows a
  // picture at once; reports the share done meanwhile.
  /**
   * @param {{ id: number } | null | undefined} video
   * @param {number} ms
   * @param {AbortSignal | undefined} signal
   * @param {(share: number) => void} onProgress
   */
  async function overviewReady(video, ms, signal, onProgress) {
    if (!video || stopped || signal?.aborted) return;
    let timeout;
    let onAbort;
    try {
      await new Promise((resolve) => {
        overviews.set(video.id, { onProgress, done: () => resolve(undefined) });
        send({ type: "watch-overview", id: video.id });
        timeout = setTimeout(resolve, ms);
        onAbort = resolve;
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      overviews.delete(video.id);
      send({ type: "unwatch-overview", id: video.id });
    }
  }

  /** @param {{ id: number } | null | undefined} video */
  function discard(video) {
    if (video) send({ type: "discard", id: video.id });
  }

  /** @param {{ id: number }} video */
  function show(video) {
    startWorker();
    showing = true;
    pane.hidden = false;
    onVisibilityChange(true);
    resizeCanvas();
    send({ type: "show", id: video.id }); // at 0, with what was built while it loaded
  }

  function clear() {
    showing = false;
    send({ type: "clear" });
    pane.hidden = true;
    onVisibilityChange(false);
    delete canvas.dataset.frameTime;
    delete canvas.dataset.proxy;
    builtText = null;
    overviewText = null;
    showBuilt();
  }

  /* ---------- What's on screen ---------- */

  // The canvas carries what's on screen (used by tests and handy in
  // DevTools): data-frame-time, plus data-proxy while a proxy frame shows.
  function markShown(time, isProxy) {
    canvas.dataset.frameTime = time.toFixed(3);
    if (isProxy) canvas.dataset.proxy = "";
    else delete canvas.dataset.proxy;
  }

  // And data-proxy-built: the parts of the proxy built so far, as
  // "start–end" in seconds; data-proxy-overview: its overview's frames.
  let builtText = null;
  let overviewText = null;
  function showBuilt() {
    if (builtText === null) delete canvas.dataset.proxyBuilt;
    else canvas.dataset.proxyBuilt = builtText;
    if (overviewText === null) delete canvas.dataset.proxyOverview;
    else canvas.dataset.proxyOverview = overviewText;
  }

  /* ---------- Canvases ---------- */

  // The worker's surface for `target`, handing it over the first time.
  /** @param {HTMLCanvasElement} target */
  function surfaceFor(target) {
    let id = surfaces.get(target);
    if (id === undefined) {
      id = nextId++;
      surfaces.set(target, id);
      const offscreen = target.transferControlToOffscreen();
      send({ type: "surface", id, canvas: offscreen }, [offscreen]);
    }
    return id;
  }

  // The pane's own window: another screen may have another pixel ratio.
  const paneWindow = () => pane.ownerDocument.defaultView ?? window;

  // The canvas's size in pixels; the worker redraws the frame on screen
  // when paused (while playing, the next frame redraws it).
  function resizeCanvas() {
    const ratio = paneWindow().devicePixelRatio;
    send({
      type: "size",
      id: surfaceId,
      width: Math.max(1, Math.round(pane.clientWidth * ratio)),
      height: Math.max(1, Math.round(pane.clientHeight * ratio)),
    });
  }

  // The observer comes from the pane's window, so it sees that window's
  // layout.
  function observePane() {
    resizeObserver?.disconnect();
    resizeObserver = new (paneWindow().ResizeObserver)(() => {
      if (!pane.hidden) resizeCanvas();
    });
    resizeObserver.observe(pane);
  }
  observePane();

  // Draws from now on in `surface` (see the header); the old canvas is
  // emptied and its pane hidden.
  /** @param {{ pane: HTMLElement, canvas: HTMLCanvasElement }} surface */
  function attach(surface) {
    if (surface.pane === pane && surface.canvas === canvas) return;
    startWorker();
    pane.hidden = true;
    delete canvas.dataset.frameTime;
    delete canvas.dataset.proxy;
    delete canvas.dataset.proxyBuilt;
    delete canvas.dataset.proxyOverview;

    ({ pane, canvas } = surface);
    surfaceId = surfaceFor(canvas);
    observePane();
    if (showing) {
      showBuilt();
      pane.hidden = false;
      resizeCanvas();
    }
    // The new canvas is empty: the worker redraws what was on screen.
    send({ type: "use", id: surfaceId });
  }

  /* ---------- Following the transport ---------- */

  // Not playing: show exactly the frame at `time`.
  /** @param {number} time */
  function showFrameAt(time) {
    if (showing) send({ type: "frame", time });
  }

  // Playing (or jumped while playing) from `time`.
  /** @param {number} time */
  function start(time) {
    if (showing) send({ type: "start", time, at: now() });
  }

  // Called every animation frame while playing: the worker's clock.
  /** @param {number} position */
  function advance(position) {
    if (showing) send({ type: "position", position, at: now() });
  }

  return {
    preload,
    prepare,
    overviewReady,
    show,
    clear,
    discard,
    start,
    advance,
    showFrameAt,
    attach,
  };
}

/** @typedef {ReturnType<typeof createVideoView>} VideoView */
