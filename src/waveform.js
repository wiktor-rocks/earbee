import { CONFIG } from "./config.js";
import { clamp, formatTrackTime } from "./core/format.js";
import { shapeLevels, shapeOverview, slicesPerWindow } from "./core/waveshape.js";
import { defaultsOf } from "./prefs/fields.js";
import waveformPrefs from "./prefs/sections/waveform.js";
import { drawWaveform } from "./waveform-draw.js";

/** @typedef {import("./core/timeline.js").Loop} Loop */
/** @typedef {import("./core/timeline.js").LoopRegion} LoopRegion */
/** @typedef {{ duration: number, width: number, offset: number }} View */
/** @typedef {import("./core/parts.js").Levels} Levels */
/** @typedef {import("./core/waveshape.js").Appearance} Appearance */

/* =====================================================================
 * WAVEFORM
 * WaveSurfer is used for drawing only: it never plays audio and never
 * seeks. Its built-in click/drag seeking is off because it moves its own
 * cursor (including a delayed seek after drags) without the transport
 * knowing, so the cursor drifted from playback. Clicks and drags here go
 * to onSeek, and the cursor only moves when the transport reports the
 * new position. Created lazily on the first file load.
 *
 * The drawing itself is ours (waveform-draw.js), from levels shaped by
 * core/waveshape.js so every song is scaled alike: WaveSurfer is given an
 * "index channel" ((i + 0.5) / N for each of the N levels) instead of
 * peaks, and calls our renderFunction with the slice of it each canvas
 * shows, which says which levels to draw. The minimap draws the same way,
 * from an overview with its loud and quiet parts exaggerated
 * (shapeOverview), so the song's sections are easy to find.
 * setAppearance() changes the look (Settings › Waveform).
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
 * a click would seek to, and stays under the mouse when the view moves
 * beneath it (paging, zoom, scrolling), its time changing instead.
 *
 * The wheel on the waveform zooms, keeping the spot under the mouse in
 * place; the wheel on the minimap scrolls the view. After the view is
 * moved by hand (zoom, wheel, minimap),
 * following the playback cursor pauses until the cursor comes back into
 * view or resumeFollow() is called (on every seek), so you can look ahead
 * while it plays. Seeks (clicks, arrow steps, marks) page the view to the
 * cursor too, playing or not.
 *
 * Exposes: preload, init, load, setTime, follow, resumeFollow, setLoop,
 *          setAppearance (the look, from Settings › Waveform),
 *          getView / setView (the zoom and scroll, for project files),
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
  const { maxZoomMultiplier, initialViewSeconds } = CONFIG.waveform;

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
  let hoverLine = null; // { line, label, text, flip }
  let hoverX = null; // pointer x of the mouse hovering the waveform (no drag), or null
  /** @type {Set<(view: View) => void>} */
  const viewListeners = new Set();
  /** @type {Appearance} */
  let appearance = /** @type {Appearance} */ (defaultsOf(waveformPrefs));
  /** @type {Levels[] | null} */
  let levels = null; // as loaded, one per channel
  let shaped = null; // levels shaped for `appearance` (core/waveshape.js)
  let loudnessWindow = 1; // slices per loudness window, for the levels loaded
  let overview = null; // the minimap's (core/waveshape.js shapeOverview)

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
        // Drawn and scaled here (see the top of the file).
        renderFunction: renderWaveform,
        normalize: false,
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
    // Fills the minimap's card (its height is set in style.css).
    height: "auto",
    waveColor: cssColor("--minimap-wave"),
    progressColor: cssColor("--minimap-progress"),
    cursorColor: cssColor("--cursor"),
    overlayColor: cssColor("--minimap-overlay"),
    renderFunction: renderMinimap,
    normalize: false,
    interact: false,
    dragToSeek: false,
  });

  /* ---------- Drawing ---------- */

  // A renderFunction for WaveSurfer, called for each canvas: `channelData[0]`
  // is the slice of the index channel the canvas shows, so it says which of
  // the levels (from `levelsOf()`) to draw.
  function renderFrom(levelsOf, lookOf, trackOf = () => undefined) {
    return (channelData, ctx) => {
      const index = channelData[0];
      const drawn = levelsOf();
      if (!drawn || !index?.length) return;
      const start = Math.floor(index[0] * drawn.top.peak.length);
      drawWaveform(ctx, drawn, start, index.length, lookOf(), trackOf());
    };
  }

  // The waveform, in the chosen look. Its bars are laid out on the whole
  // track, at WaveSurfer's pixel ratio (it never goes under 1).
  const renderWaveform = renderFrom(
    () => shaped,
    () => appearance,
    () => ({
      trackWidth: waveSurfer.getWrapper().scrollWidth,
      pixelRatio: Math.max(1, window.devicePixelRatio || 1),
    }),
  );

  // The minimap: the overview, exaggerated to find your way, always as one
  // filled shape.
  /** @type {Appearance} */
  const MINIMAP_LOOK = { style: "continuous", measure: "loudness", scale: "linear", stereo: "combined", height: 100 };
  const renderMinimap = renderFrom(
    () => overview,
    () => MINIMAP_LOOK,
  );

  // (i + 0.5) / N for each level: within 0…1, so WaveSurfer leaves it as is.
  function indexChannel(length) {
    const index = new Float32Array(length);
    for (let i = 0; i < length; i++) index[i] = (i + 0.5) / length;
    return index;
  }

  // Redraws the waveform (with `options`, if any) and the minimap, keeping
  // the scroll. The minimap plugin can't change once made, so it is
  // replaced; its scrubbing looks up the minimap's elements on each drag,
  // so it keeps working.
  function redraw(options = {}) {
    if (!waveSurfer) return;
    const scroll = waveSurfer.getScroll();
    waveSurfer.setOptions(options);
    waveSurfer.unregisterPlugin(minimap);
    minimap = waveSurfer.registerPlugin(createMinimap());
    // The new minimap places its visible-range overlay on the next scroll.
    setScroll(scroll);
  }

  // Redraws in the current colours, after they changed.
  const refreshColors = () => redraw(waveColors());

  // The look (Settings › Waveform): reshapes the levels and redraws.
  /** @param {Record<string, any>} next The Settings › Waveform values (an Appearance). */
  function setAppearance(next) {
    appearance = /** @type {Appearance} */ ({ ...next });
    if (!levels) return;
    shaped = shapeLevels(levels, appearance, { window: loudnessWindow });
    if (duration) redraw();
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
      hoverX = null;
      renderHoverLine(null); // the drag shows the spot itself
      scrubbing = true;
      pendingX = event.clientX;
      applyPointer(); // a click seeks at once
    });

    // Without a drag, the hover line follows the mouse. pointerrawupdate
    // comes as soon as the mouse moves, without waiting for the next frame
    // as pointermove does, so the line keeps up better where there is one.
    const hoverEvent = "onpointerrawupdate" in window ? "pointerrawupdate" : "pointermove";
    container.addEventListener(hoverEvent, (/** @type {PointerEvent} */ event) => {
      if (pointerId !== null) return;
      hoverX = event.clientX;
      refreshHover();
    });

    // Drag moves are applied once per frame.
    container.addEventListener("pointermove", (event) => {
      if (event.pointerId !== pointerId) return;
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
      // The hover line comes back at once if the mouse is still here.
      const view = container.getBoundingClientRect();
      if (event.type === "pointerup" && event.clientX >= view.left && event.clientX <= view.right) {
        hoverX = event.clientX;
        refreshHover();
      }

      if (finished.mode === "seek") return;
      if (finished.draft) onLoopChange({ start: finished.draft.start, end: finished.draft.end });
      // A Shift+click (too short to be a loop) is a plain click.
      else if (finished.mode === "draw") onSeek(finished.anchor);
      renderLoop(); // back to the loop as last set
    };
    container.addEventListener("pointerup", endDrag);
    container.addEventListener("pointercancel", endDrag);
    container.addEventListener("pointerleave", () => {
      hoverX = null;
      renderHoverLine(null);
    });
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
    // Where A is, and how far B is from the end; style.css centres the edge
    // lines on them.
    loopElement.style.setProperty("--loop-start", `${(shown.start / duration) * 100}%`);
    loopElement.style.setProperty("--loop-after", `${(1 - shown.end / duration) * 100}%`);
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
    // The view moved under the mouse: the hover line stays under it.
    if (hoverX !== null) refreshHover();
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
  // hides the line (null). It is moved with a transform, which doesn't
  // lay the page out again, and all the measuring comes before any
  // change, so following the mouse never waits on a layout. Being placed
  // in px, it is placed again whenever the view changes (emitView).
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
      hoverLine = { line, label, text: "", flip: false };
    }

    const { line, label } = hoverLine;
    if (x === null || !duration) {
      line.hidden = true;
      return;
    }
    const track = wrapper.getBoundingClientRect();
    const right = container.getBoundingClientRect().right;
    const offset = clamp(x - track.left, 0, track.width);
    const text = formatTrackTime(track.width ? (offset / track.width) * duration : 0);
    // Near the right edge the time goes on the line's left, so it isn't cut off.
    const flip = x > right - 90;

    if (line.hidden) line.hidden = false;
    line.style.transform = `translateX(${offset}px)`;
    if (text !== hoverLine.text) label.textContent = hoverLine.text = text;
    if (flip !== hoverLine.flip) {
      hoverLine.flip = flip;
      label.setAttribute("part", flip ? "hover-time hover-time-flip" : "hover-time");
    }
  }

  // Places the hover line at the mouse again, and shows the resize cursor
  // when it is near a loop edge.
  function refreshHover() {
    renderHoverLine(hoverX);
    container.classList.toggle("near-loop-edge", hoverX !== null && loopEdgeAt(hoverX) !== null);
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
  // A taller or shorter one (or the stage giving the timeline more room)
  // redraws: WaveSurfer only notices width changes, and would keep the
  // old height.
  function bindResizeClamp() {
    let height = container.clientHeight;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let heightTimer;
    new ResizeObserver(() => {
      if (container.clientHeight !== height) {
        height = container.clientHeight;
        clearTimeout(heightTimer);
        heightTimer = setTimeout(() => duration && waveSurfer.setOptions({ height: "auto" }), 100);
      }
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

  // Draws the levels from decoding (one { peak, rms } per channel), so
  // WaveSurfer doesn't fetch and decode the file a second time.
  /** @param {Levels[]} trackLevels @param {number} trackDuration */
  async function load(trackLevels, trackDuration) {
    duration = 0;
    zoomLevel = null;
    zoomAnchor = null;
    loop = null;
    renderLoop();
    renderHoverLine(null);
    emitView();
    if (!waveSurfer) return;

    levels = trackLevels;
    loudnessWindow = slicesPerWindow(levels[0].peak.length, trackDuration);
    shaped = shapeLevels(levels, appearance, { window: loudnessWindow });
    overview = shapeOverview(levels, { window: loudnessWindow });
    await waveSurfer.load("", [indexChannel(levels[0].peak.length)], trackDuration);
    waveSurfer.setTime(0);
    duration = trackDuration;
    followPaused = false;
    // Start zoomed in on the beginning (see CONFIG.waveform.initialViewSeconds).
    const fit = fitZoom();
    const initial = clamp(waveSurfer.getWidth() / initialViewSeconds, fit, fit * maxZoomMultiplier);
    zoomLevel = initial > fit ? initial : null;
    waveSurfer.zoom(zoomLevel ?? 0);
    setScroll(0);
  }

  // The zoom and scroll, in the track's terms (so they mean the same in a
  // window of another size): how many seconds are in view (null: the
  // whole track, fit to width) and the time at the left edge.
  /** @returns {{ seconds: number | null, start: number } | null} */
  function getView() {
    if (!waveSurfer || !duration) return null;
    const pxPerSecond = waveSurfer.getWrapper().scrollWidth / duration;
    return {
      seconds: zoomLevel === null ? null : waveSurfer.getWidth() / zoomLevel,
      start: pxPerSecond > 0 ? waveSurfer.getScroll() / pxPerSecond : 0,
    };
  }

  // Brings back a view from getView(), within the zoom limits.
  /** @param {{ seconds?: number | null, start?: number }} saved */
  function setView({ seconds = null, start = 0 }) {
    if (!waveSurfer || !duration) return;
    const fit = fitZoom();
    const wanted = Number.isFinite(seconds) && seconds > 0 ? waveSurfer.getWidth() / seconds : fit;
    const next = clamp(wanted, fit, fit * maxZoomMultiplier);
    zoomLevel = next > fit ? next : null;
    zoomAnchor = null;
    waveSurfer.zoom(zoomLevel ?? 0);
    const pxPerSecond = waveSurfer.getWrapper().scrollWidth / duration;
    setScroll(clamp(Number.isFinite(start) ? start : 0, 0, duration) * pxPerSecond);
    // The view stays where it was saved until the cursor comes into it.
    followPaused = true;
  }

  // Keeps the cursor in view when zoomed in: once it leaves the visible
  // range, jump a page so it is at the left edge (no smooth scrolling).
  // With `backward` (stepping back while paused), a cursor that left on
  // the left lands at the right edge instead, so the next steps back stay
  // in view. While following is paused, the view stays put until the
  // cursor is back inside it.
  function follow(time, { backward = false } = {}) {
    if (!duration || scrubbing) return;

    const cursorX = (time / duration) * waveSurfer.getWrapper().scrollWidth;
    const viewStart = waveSurfer.getScroll();
    const width = waveSurfer.getWidth();
    const inView = cursorX >= viewStart && cursorX <= viewStart + width;
    if (followPaused) {
      if (inView) followPaused = false;
      return;
    }
    if (inView) return;
    if (backward && cursorX < viewStart) setScroll(Math.max(0, cursorX - width));
    else scrollTo(() => waveSurfer.setScrollTime(time));
  }

  return {
    preload,
    init,
    load,
    follow,
    refreshColors,
    setAppearance,
    resumeFollow: () => (followPaused = false),
    setTime: (time) => waveSurfer?.setTime(time),
    /** @param {LoopRegion | null} next */
    setLoop(next) {
      loop = next && { ...next };
      renderLoop();
      if (hoverX !== null) refreshHover();
    },
    view,
    getView,
    setView,
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
