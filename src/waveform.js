import { CONFIG } from "./config.js";
import { clamp, formatTrackTime } from "./core/format.js";

/** @typedef {import("./core/timeline.js").Loop} Loop */
/** @typedef {import("./core/timeline.js").LoopRegion} LoopRegion */
/** @typedef {{ duration: number, width: number, offset: number }} View */

/* =====================================================================
 * WAVEFORM
 * WaveSurfer is used for drawing only: it never plays audio and never
 * seeks. Its built-in click/drag seeking is off because it moves its own
 * cursor (including a delayed seek after drags) without the transport
 * knowing, so the cursor drifted from playback. Clicks and drags here go
 * to onSeek, and the cursor only moves when the transport reports the
 * new position. Created lazily on the first file load.
 *
 * The A–B loop is drawn as a <div part="loop-region"> inside WaveSurfer's
 * wrapper (styled from style.css with ::part), positioned in percent so it
 * follows zoom and scrolling. Shift+drag draws a loop and dragging near
 * an edge moves that edge; the result goes to onLoopChange, and the
 * region only changes for good when setLoop() is called with it.
 *
 * Markers (marks, the start and stop points) are not drawn here: they
 * live on their own lanes above the waveform (timeline.js), which follow
 * the view this publishes: onView(fn) is called with { duration, width,
 * offset } (the whole zoomed waveform's width in px, and its left edge
 * relative to the container: the scroll) whenever it changes.
 *
 * A thin hover line (<div part="hover-line">, with the time) follows the
 * mouse over the waveform while nothing is dragged: it sits exactly where
 * a click would seek to.
 *
 * The wheel on the waveform zooms, keeping the spot under the mouse in
 * place; the wheel on the minimap scrolls the view. After the view is
 * moved by hand (zoom, wheel, minimap),
 * following the playback cursor pauses until the cursor comes back into
 * view or resumeFollow() is called (on every seek), so you can look ahead
 * while it plays.
 *
 * Exposes: preload, init, load, setTime, follow, resumeFollow, setLoop,
 *          refreshColors (after the colour variables changed, e.g. a
 *          theme), and for the lanes: view, onView, timeAtClientX,
 *          clientXAt, wheel (an event handler), scrollNearEdge, holdFollow
 * ===================================================================== */

/**
 * @param {object} options
 * @param {HTMLElement} options.container
 * @param {HTMLElement} options.minimapContainer
 * @param {(time: number) => void} options.onSeek A click or drag asks to move the cursor.
 * @param {(loop: Loop) => void} options.onLoopChange A drag drew or adjusted the loop.
 */
export function createWaveform({ container, minimapContainer, onSeek, onLoopChange }) {
  const { maxZoomMultiplier } = CONFIG.waveform;

  let waveSurfer = null;
  let modulesPromise = null;
  let initPromise = null;
  let minimap = null;
  let createMinimap = null; // makes a minimap plugin in the current colours
  let duration = 0;
  let zoomLevel = null; // px per second; null = fit to width
  // True while the user drags the waveform or minimap, so following the
  // playback position doesn't scroll the view out from under them.
  let scrubbing = false;
  // True after the user moved the view by hand; see follow().
  let followPaused = false;
  // { clientX, time } of the last wheel zoom, so repeated zooms at the same
  // pointer position reuse the exact time instead of re-reading it from
  // the (whole-pixel) scroll, which would drift a little every step.
  let zoomAnchor = null;
  /** @type {LoopRegion | null} */
  let loop = null; // as last set by setLoop()
  let loopElement = null;
  let hoverLine = null; // { line, label }
  /** @type {Set<(view: View) => void>} */
  const viewListeners = new Set();

  // Loads the WaveSurfer code without creating anything on screen, so it
  // is safe to call at startup.
  function preload() {
    modulesPromise ??= Promise.all([
      import("../node_modules/wavesurfer.js/dist/wavesurfer.esm.js"),
      import("../node_modules/wavesurfer.js/dist/plugins/minimap.esm.js"),
    ]).catch((error) => {
      modulesPromise = null; // let the next call retry
      throw error;
    });
    return modulesPromise;
  }

  async function create() {
    try {
      const [waveSurferModule, minimapModule] = await preload();

      const WaveSurfer = waveSurferModule.default;
      const MinimapPlugin = minimapModule.default;
      if (!WaveSurfer || !MinimapPlugin) {
        throw new Error("WaveSurfer or Minimap plugin failed to load.");
      }

      createMinimap = () => MinimapPlugin.create(minimapOptions());
      minimap = createMinimap();

      waveSurfer = WaveSurfer.create({
        container,
        height: "auto",
        ...waveColors(),
        cursorWidth: 1, // thin, for precision (WaveSurfer shifts it by up to this)
        // Rounded bars with small gaps: lighter than a solid fill.
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        normalize: true,
        interact: false, // seeking is handled by bindPointerSeek()
        dragToSeek: false,
        // Following the cursor is done by follow(); WaveSurfer's own
        // auto-scroll would undo any zoom or scroll made away from it.
        autoScroll: false,
        autoCenter: false,
        hideScrollbar: true,
        plugins: [minimap],
      });

      // The lanes follow every change of zoom, scroll or size.
      for (const event of ["scroll", "zoom", "redraw", "resize"]) waveSurfer.on(event, emitView);
      bindPointerSeek();
      bindWheelZoom();
      bindMinimapScrubbing();
      bindResizeClamp();
      return true;
    } catch (error) {
      console.error("WaveSurfer init failed:", error);
      return false;
    }
  }

  /* ---------- Colours ---------- */

  // Colours live in style.css as custom properties (a theme may change
  // them). WaveSurfer draws on canvases, so they are read as values here.
  function cssColor(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  const waveColors = () => ({
    waveColor: cssColor("--wave"),
    progressColor: cssColor("--wave-progress"),
    cursorColor: cssColor("--cursor"),
  });

  const minimapOptions = () => ({
    container: minimapContainer,
    height: 46,
    waveColor: cssColor("--minimap-wave"),
    progressColor: cssColor("--minimap-progress"),
    cursorColor: cssColor("--cursor"),
    overlayColor: cssColor("--minimap-overlay"),
    normalize: true,
    interact: false,
    dragToSeek: false,
  });

  // Redraws in the current colours, after they changed. The minimap plugin
  // can't change colours once made, so it is replaced; its scrubbing looks
  // up the minimap's elements on each drag, so it keeps working.
  function refreshColors() {
    if (!waveSurfer) return;
    waveSurfer.setOptions(waveColors());
    waveSurfer.unregisterPlugin(minimap);
    minimap = waveSurfer.registerPlugin(createMinimap());
    // The new minimap places its visible-range overlay on the next scroll.
    setScroll(waveSurfer.getScroll());
  }

  // Resolves to whether the waveform is available.
  function init() {
    initPromise ??= create();
    return initPromise;
  }

  /* ---------- Clicking and dragging: seek, draw or adjust the loop ---------- */

  // Track time under a pointer x, and the pointer x of a track time. The
  // wrapper spans the whole (zoomed) waveform and moves with scrolling.
  function timeAtClientX(x) {
    const track = waveSurfer.getWrapper().getBoundingClientRect();
    return clamp((x - track.left) / track.width, 0, 1) * duration;
  }

  function clientXAt(time) {
    const track = waveSurfer.getWrapper().getBoundingClientRect();
    return track.left + (time / duration) * track.width;
  }

  // "start" or "end" if `x` is close enough to that loop edge to grab it.
  function loopEdgeAt(x) {
    if (!loop || !duration) return null;
    const toStart = Math.abs(x - clientXAt(loop.start));
    const toEnd = Math.abs(x - clientXAt(loop.end));
    if (Math.min(toStart, toEnd) > CONFIG.loop.edgeGrabPx) return null;
    return toStart <= toEnd ? "start" : "end";
  }

  // One drag at a time: { mode: "seek" } | { mode: "draw", anchor }
  // | { mode: "edge", fixed } (`fixed` is the loop end that stays put),
  // plus `draft`, the loop described so far, while drawing or adjusting.
  function bindPointerSeek() {
    const { minSeconds } = CONFIG.loop;
    let pointerId = null;
    let drag = null;
    let pendingX = null;
    let frame = 0;

    // The loop described by the current drag, or null if it is too short.
    function draftLoop(time) {
      const other = drag.mode === "draw" ? drag.anchor : drag.fixed;
      const start = Math.min(time, other);
      const end = Math.max(time, other);
      return end - start >= minSeconds ? { start, end, enabled: true } : null;
    }

    function applyPointer() {
      frame = 0;
      if (pendingX === null || !duration) return;
      const x = pendingX;
      pendingX = null;

      if (pointerId !== null) scrollNearEdge(x);

      const time = timeAtClientX(x);
      if (drag.mode === "seek") onSeek(time);
      else {
        drag.draft = draftLoop(time);
        renderLoop(drag.draft ?? (drag.mode === "edge" ? loop : null));
      }
    }

    container.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !duration) return;
      event.preventDefault();

      // Shift draws a loop anywhere; otherwise a loop edge is moved, and
      // anywhere else seeks.
      const edge = event.shiftKey ? null : loopEdgeAt(event.clientX);
      if (edge) drag = { mode: "edge", fixed: edge === "start" ? loop.end : loop.start };
      else if (event.shiftKey) drag = { mode: "draw", anchor: timeAtClientX(event.clientX) };
      else drag = { mode: "seek" };

      pointerId = event.pointerId;
      container.setPointerCapture(pointerId);
      renderHoverLine(null); // the drag shows the spot itself
      scrubbing = true;
      pendingX = event.clientX;
      applyPointer(); // a click seeks at once
    });

    // Moves are applied once per frame. Without a drag, the hover line
    // follows the mouse, and hovering near a loop edge shows the resize
    // cursor.
    container.addEventListener("pointermove", (event) => {
      if (event.pointerId !== pointerId) {
        if (pointerId !== null) return;
        renderHoverLine(event.clientX);
        container.classList.toggle("near-loop-edge", loopEdgeAt(event.clientX) !== null);
        return;
      }
      pendingX = event.clientX;
      frame ||= requestAnimationFrame(applyPointer);
    });

    const endDrag = (event) => {
      if (event.pointerId !== pointerId) return;
      cancelAnimationFrame(frame);
      applyPointer(); // apply the last position
      const finished = drag;
      pointerId = null;
      drag = null;
      scrubbing = false;

      if (finished.mode === "seek") return;
      if (finished.draft) onLoopChange({ start: finished.draft.start, end: finished.draft.end });
      // A Shift+click (too short to be a loop) is a plain click.
      else if (finished.mode === "draw") onSeek(finished.anchor);
      renderLoop(); // back to the loop as last set
    };
    container.addEventListener("pointerup", endDrag);
    container.addEventListener("pointercancel", endDrag);
    container.addEventListener("pointerleave", () => renderHoverLine(null));
  }

  // While dragging, this close to an edge of a zoomed view scrolls it (on
  // the lanes too).
  function scrollNearEdge(x) {
    const edgePx = 30;
    const view = container.getBoundingClientRect();
    if (x > view.right - edgePx) setScroll(waveSurfer.getScroll() + edgePx);
    else if (x < view.left + edgePx) setScroll(waveSurfer.getScroll() - edgePx);
  }

  /* ---------- Loop region ---------- */

  // Draws `shown` ({ start, end, enabled }) or hides the region (null).
  function renderLoop(shown = loop) {
    if (!waveSurfer) return;
    const wrapper = waveSurfer.getWrapper();
    if (!loopElement || loopElement.parentNode !== wrapper) {
      loopElement = document.createElement("div");
      wrapper.append(loopElement);
    }

    loopElement.hidden = !shown || !duration;
    if (loopElement.hidden) return;
    loopElement.setAttribute("part", shown.enabled ? "loop-region" : "loop-region loop-disabled");
    loopElement.style.left = `${(shown.start / duration) * 100}%`;
    loopElement.style.width = `${((shown.end - shown.start) / duration) * 100}%`;
  }

  /* ---------- The view, for the lanes ---------- */

  // The whole (zoomed) waveform's width and left edge, relative to the
  // container; null before the waveform exists.
  /** @returns {View | null} */
  function view() {
    if (!waveSurfer) return null;
    const track = waveSurfer.getWrapper().getBoundingClientRect();
    return { duration, width: track.width, offset: track.left - container.getBoundingClientRect().left };
  }

  function emitView() {
    const current = view();
    if (current) for (const listener of viewListeners) listener(current);
  }

  // Every scroll made here goes through these, which tell the lanes at
  // once: a scroll from an animation frame (following playback) would
  // otherwise reach them through WaveSurfer's scroll event a frame late.
  function scrollTo(scroll) {
    scroll();
    emitView();
  }
  const setScroll = (px) => scrollTo(() => waveSurfer.setScroll(px));

  /* ---------- Hover line ---------- */

  // Shows where a click at pointer `x` would seek to, with its time, or
  // hides the line (null). Positioned in percent, like the loop.
  function renderHoverLine(x) {
    if (!waveSurfer) return;
    const wrapper = waveSurfer.getWrapper();
    if (!hoverLine || hoverLine.line.parentNode !== wrapper) {
      const label = document.createElement("span");
      label.setAttribute("part", "hover-time");
      const line = document.createElement("div");
      line.setAttribute("part", "hover-line");
      line.ariaHidden = "true";
      line.append(label);
      wrapper.append(line);
      hoverLine = { line, label };
    }

    const { line, label } = hoverLine;
    line.hidden = x === null || !duration;
    if (line.hidden) return;
    const time = timeAtClientX(x);
    line.style.left = `${(time / duration) * 100}%`;
    label.textContent = formatTrackTime(time);
    // Near the right edge the time goes on the line's left, so it isn't cut off.
    const nearRight = x > container.getBoundingClientRect().right - 90;
    label.setAttribute("part", nearRight ? "hover-time hover-time-flip" : "hover-time");
  }

  /* ---------- Zoom / scroll ---------- */

  function fitZoom() {
    if (!waveSurfer || !duration) return 1;
    return Math.max(1, waveSurfer.getWidth() / duration);
  }

  // Zooms keeping the time under `clientX` (the pointer) where it is.
  function zoomBy(factor, clientX) {
    if (!duration) return;

    const fit = fitZoom();
    const current = zoomLevel ?? fit;
    const next = clamp(current * factor, fit, fit * maxZoomMultiplier);
    if (next === current) return;

    const here = timeAtClientX(clientX);
    const pixelTime = duration / waveSurfer.getWrapper().getBoundingClientRect().width;
    const sameSpot = zoomAnchor?.clientX === clientX && Math.abs(zoomAnchor.time - here) <= 2 * pixelTime;
    if (!sameSpot) zoomAnchor = { clientX, time: here };
    const anchorTime = zoomAnchor.time;
    zoomLevel = next;
    // WaveSurfer re-renders at once, scrolling to keep the playback cursor
    // in place; correct the scroll so the anchor is back under the pointer.
    waveSurfer.zoom(next);
    setScroll(waveSurfer.getScroll() + (clientXAt(anchorTime) - clientX));
  }

  // The wheel zooms at the pointer (a touchpad pinch arrives as a wheel
  // with ctrlKey, and zooms the same way); a touchpad's sideways swipe
  // scrolls.
  // The lanes above the waveform use the same handler.
  /** @param {WheelEvent} event */
  function wheel(event) {
    if (!duration || (event.deltaY === 0 && event.deltaX === 0)) return;
    event.preventDefault();

    followPaused = true;
    if (Math.abs(event.deltaY) >= Math.abs(event.deltaX)) zoomBy(Math.exp(-event.deltaY * 0.001), event.clientX);
    else setScroll(waveSurfer.getScroll() + event.deltaX);
  }

  function bindWheelZoom() {
    container.addEventListener("wheel", wheel, { passive: false });
  }

  // A wider window raises the fit-to-width zoom; never stay zoomed out past it.
  function bindResizeClamp() {
    new ResizeObserver(() => {
      emitView();
      if (!duration || zoomLevel === null || zoomLevel >= fitZoom()) return;
      zoomLevel = null;
      waveSurfer.zoom(0);
    }).observe(container);
  }

  /* ---------- Minimap scrubbing ---------- */

  // Dragging the minimap scrolls the main waveform. Grabbing the visible-
  // range overlay keeps the grab point under the pointer; clicking
  // elsewhere centres the overlay on the pointer. The wheel scrolls too.
  function bindMinimapScrubbing() {
    let drag = null;

    function scrollFromPointer(clientX) {
      const maxTrackOffset = drag.track.clientWidth - drag.overlayWidth;
      const contentWidth = waveSurfer.getWrapper().scrollWidth;
      const maxScroll = Math.max(0, contentWidth - waveSurfer.getWidth());
      if (maxTrackOffset <= 0 || maxScroll <= 0) return;

      const trackRect = drag.track.getBoundingClientRect();
      const trackOffset = clamp(clientX - trackRect.left - drag.grabOffset, 0, maxTrackOffset);
      setScroll((maxScroll * trackOffset) / maxTrackOffset);
    }

    minimapContainer.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;

      const track = minimapContainer.querySelector('[part~="minimap"]');
      const overlay = minimapContainer.querySelector('[part~="minimap-overlay"]');
      if (!track || !overlay) return;

      const trackRect = track.getBoundingClientRect();
      const overlayRect = overlay.getBoundingClientRect();
      const pointerX = event.clientX - trackRect.left;
      const overlayLeft = overlayRect.left - trackRect.left;
      const overlayWidth = overlayRect.width;
      const isOnOverlay = pointerX >= overlayLeft && pointerX <= overlayLeft + overlayWidth;

      drag = {
        track,
        overlayWidth,
        grabOffset: isOnOverlay ? pointerX - overlayLeft : overlayWidth / 2,
        pointerId: event.pointerId,
      };

      event.preventDefault();
      minimapContainer.setPointerCapture(event.pointerId);
      scrubbing = true;
      scrollFromPointer(event.clientX);
    });

    minimapContainer.addEventListener("pointermove", (event) => {
      if (drag?.pointerId !== event.pointerId) return;
      event.preventDefault();
      scrollFromPointer(event.clientX);
    });

    const endDrag = (event) => {
      if (drag?.pointerId !== event.pointerId) return;
      drag = null;
      scrubbing = false;
      followPaused = true;
    };

    minimapContainer.addEventListener("pointerup", endDrag);
    minimapContainer.addEventListener("pointercancel", endDrag);

    // The wheel on the minimap scrolls the view (either direction, so a
    // touchpad's swipes work too).
    minimapContainer.addEventListener(
      "wheel",
      (event) => {
        const delta = event.deltaY || event.deltaX;
        if (!duration || delta === 0) return;
        event.preventDefault();
        followPaused = true;
        setScroll(waveSurfer.getScroll() + delta);
      },
      { passive: false },
    );
  }

  /* ---------- Public ---------- */

  // Draws precomputed peaks (one Float32Array per channel), so WaveSurfer
  // doesn't fetch and decode the file a second time.
  async function load(peaks, trackDuration) {
    duration = 0;
    zoomLevel = null;
    zoomAnchor = null;
    loop = null;
    renderLoop();
    renderHoverLine(null);
    emitView();
    if (!waveSurfer) return;

    await waveSurfer.load("", peaks, trackDuration);
    waveSurfer.zoom(0);
    waveSurfer.setTime(0);
    duration = trackDuration;
    emitView();
  }

  // Keeps the cursor in view when zoomed in: once it leaves the visible
  // range, jump a page so it is at the left edge (no smooth scrolling).
  // While following is paused, the view stays put until the cursor is
  // back inside it.
  function follow(time) {
    if (!duration || scrubbing) return;

    const cursorX = (time / duration) * waveSurfer.getWrapper().scrollWidth;
    const viewStart = waveSurfer.getScroll();
    const inView = cursorX >= viewStart && cursorX <= viewStart + waveSurfer.getWidth();
    if (followPaused) {
      if (inView) followPaused = false;
      return;
    }
    if (!inView) scrollTo(() => waveSurfer.setScrollTime(time));
  }

  return {
    preload,
    init,
    load,
    follow,
    refreshColors,
    resumeFollow: () => (followPaused = false),
    setTime: (time) => waveSurfer?.setTime(time),
    /** @param {LoopRegion | null} next */
    setLoop(next) {
      loop = next && { ...next };
      renderLoop();
    },
    view,
    /** Calls `listener` with the view whenever it changes. @param {(view: View) => void} listener */
    onView(listener) {
      viewListeners.add(listener);
    },
    timeAtClientX: (x) => (duration ? timeAtClientX(x) : 0),
    clientXAt,
    wheel,
    scrollNearEdge: (x) => waveSurfer && scrollNearEdge(x),
    /** While a lane is dragged, following playback waits. @param {boolean} on */
    holdFollow(on) {
      scrubbing = on;
    },
  };
}

/** @typedef {ReturnType<typeof createWaveform>} Waveform */
