import { CONFIG } from "./config.js";
import { clamp, formatTrackTime } from "./core/format.js";

/** @typedef {import("./core/timeline.js").Loop} Loop */
/** @typedef {import("./core/timeline.js").LoopRegion} LoopRegion */
/** @typedef {import("./marks/index.js").Mark} Mark */
/** @typedef {{ start: number, end: number | null }} MarkTimes */

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
 * Marks (points and regions; src/marks) are drawn the same way, with a
 * flag at the top showing the label, and as ticks and bands on the
 * minimap. The waveform only draws them and reports what the pointer did:
 * a mark's flag selects it (onMarkSelect), seeks to it on a click, moves
 * the whole mark when dragged, and asks for a rename on a double-click
 * (onMarkRename); dragging a point or a region's edge moves just that
 * (onMarkChange, at the end of the drag). Elsewhere, even inside a region,
 * a click still seeks.
 *
 * The start point (where Space plays from; features/playback.js) is a
 * green line (<div part="start-point">) with a ▶ handle at its bottom,
 * and a tick on the minimap. Dragging the handle reports the new spot
 * (onStartPointChange, at the end of the drag) without moving the
 * cursor; a click on it seeks there. The stop point (where playback last
 * stopped) is drawn the same way in red (<div part="stop-point">), with a
 * ■ handle that goes there on a click; it can't be dragged.
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
 *          setMarks, setStartPoint, setStopPoint, refreshColors (after the colour variables changed,
 *          e.g. a theme)
 * ===================================================================== */

/**
 * @param {object} options
 * @param {HTMLElement} options.container
 * @param {HTMLElement} options.minimapContainer
 * @param {(time: number) => void} options.onSeek A click or drag asks to move the cursor.
 * @param {(loop: Loop) => void} options.onLoopChange A drag drew or adjusted the loop.
 * @param {(id: string) => void} options.onMarkSelect A mark was pressed.
 * @param {(id: string, times: MarkTimes) => void} options.onMarkChange A drag moved a mark.
 * @param {(id: string) => void} options.onMarkRename A mark's flag was double-clicked.
 * @param {(time: number) => void} options.onStartPointChange The start point's handle was dragged.
 */
export function createWaveform({
  container,
  minimapContainer,
  onSeek,
  onLoopChange,
  onMarkSelect,
  onMarkChange,
  onMarkRename,
  onStartPointChange,
}) {
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
  /** @type {Mark[]} */
  let marks = []; // as last set by setMarks()
  let selectedMark = null; // its id
  let pendingRegion = null; // { start, end }: a region being marked
  let markDraft = null; // { id, start, end } while a mark is dragged
  let marksLayer = null;
  let minimapMarksLayer = null;
  let hoverLine = null; // { line, label }
  let startPoint = null; // as last set by setStartPoint()
  let startDraft = null; // while its handle is dragged
  let startElements = null; // { line, tick }
  let stopPoint = null; // as last set by setStopPoint()
  let stopElements = null; // { line, tick }
  // The elements drawing each mark, by id, reused between renders (so a
  // double-click on a flag isn't split across two elements).
  /** @type {Map<string, { body: HTMLElement, flag: HTMLElement, tick: HTMLElement }>} */
  const markElements = new Map();

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
    waveSurfer.setScroll(waveSurfer.getScroll());
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

  // The mark edge nearest to `x` within grabbing distance, or null:
  // { id, edge }, where `edge` is "point", or a region's "start" or "end".
  function markEdgeAt(x) {
    if (!duration) return null;
    let nearest = null;
    for (const mark of marks) {
      const edges = mark.end === null ? { point: mark.start } : { start: mark.start, end: mark.end };
      for (const [edge, time] of Object.entries(edges)) {
        const distance = Math.abs(x - clientXAt(time));
        if (distance <= CONFIG.loop.edgeGrabPx && !(nearest?.distance <= distance))
          nearest = { id: mark.id, edge, distance };
      }
    }
    return nearest;
  }

  // The id of the mark whose flag the event happened on, or null. The
  // flags are the only part of a mark that takes the pointer.
  const flagOf = (event) =>
    event
      .composedPath()
      .map((node) => /** @type {HTMLElement} */ (node).dataset?.markFlag)
      .find(Boolean) ?? null;

  // Which point's handle the event happened on: "start", "stop" or null.
  const handleOf = (event) =>
    event
      .composedPath()
      .map((node) => /** @type {HTMLElement} */ (node).dataset?.handle)
      .find(Boolean) ?? null;

  // One drag at a time: { mode: "seek" } | { mode: "draw", anchor }
  // | { mode: "edge", fixed } (`fixed` is the loop end that stays put),
  // plus `draft`, the loop described so far, while drawing or adjusting;
  // or { mode: "mark", id, edge, origin, grabTime, startX, moved, draft }
  // for a mark (`edge`: "point", "start", "end", or "whole" from its flag);
  // or { mode: "start", startX, moved, draft } for the start point's
  // handle; or { mode: "stop" } for a click on the stop point's.
  function bindPointerSeek() {
    const edgePx = 30; // dragging this close to an edge scrolls a zoomed view
    const clickSlopPx = 3; // a press on a mark that moves less is a click
    const { minSeconds } = CONFIG.loop;
    let pointerId = null;
    let drag = null;
    let pendingX = null;
    let frame = 0;
    let pressedFlag = null; // the mark whose flag the last press was on

    // The loop described by the current drag, or null if it is too short.
    function draftLoop(time) {
      const other = drag.mode === "draw" ? drag.anchor : drag.fixed;
      const start = Math.min(time, other);
      const end = Math.max(time, other);
      return end - start >= minSeconds ? { start, end, enabled: true } : null;
    }

    // Where the dragged mark would be with the pointer at `time`. A region
    // can't get shorter than CONFIG.marks.minSeconds; it stays as it was.
    function draftMark(time) {
      const { origin, edge } = drag;
      if (edge === "point") return { start: time, end: null };
      if (edge === "whole") {
        const length = (origin.end ?? origin.start) - origin.start;
        const start = clamp(origin.start + time - drag.grabTime, 0, duration - length);
        return { start, end: origin.end === null ? null : start + length };
      }
      const other = edge === "start" ? origin.end : origin.start;
      const [start, end] = [Math.min(time, other), Math.max(time, other)];
      if (end - start >= CONFIG.marks.minSeconds) return { start, end };
      return drag.draft ?? { start: origin.start, end: origin.end };
    }

    function applyPointer() {
      frame = 0;
      if (pendingX === null || !duration) return;
      const x = pendingX;
      pendingX = null;

      if (pointerId !== null) {
        const view = container.getBoundingClientRect();
        if (x > view.right - edgePx) waveSurfer.setScroll(waveSurfer.getScroll() + edgePx);
        else if (x < view.left + edgePx) waveSurfer.setScroll(waveSurfer.getScroll() - edgePx);
      }

      const time = timeAtClientX(x);
      if (drag.mode === "stop") return; // only a click
      if (drag.mode === "seek") onSeek(time);
      else if (drag.mode === "start") {
        drag.moved ||= Math.abs(x - drag.startX) >= clickSlopPx;
        if (!drag.moved) return;
        drag.draft = startDraft = time;
        renderStartPoint();
      } else if (drag.mode === "mark") {
        drag.moved ||= Math.abs(x - drag.startX) >= clickSlopPx;
        if (!drag.moved) return;
        drag.draft = draftMark(time);
        markDraft = { id: drag.id, ...drag.draft };
        renderMarks();
      } else {
        drag.draft = draftLoop(time);
        renderLoop(drag.draft ?? (drag.mode === "edge" ? loop : null));
      }
    }

    container.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !duration) return;
      event.preventDefault();

      // Shift draws a loop anywhere; otherwise the start and stop points'
      // handles come first, then a mark's flag, then a loop edge, then a
      // mark's edge, and anywhere else seeks.
      const handle = event.shiftKey ? null : handleOf(event);
      const flag = event.shiftKey || handle ? null : flagOf(event);
      pressedFlag = flag;
      const edge = event.shiftKey || handle || flag ? null : loopEdgeAt(event.clientX);
      const markEdge = event.shiftKey || handle || flag || edge ? null : markEdgeAt(event.clientX);
      if (handle === "start") drag = { mode: "start", startX: event.clientX, moved: false, draft: null };
      else if (handle === "stop") drag = { mode: "stop" };
      else if (flag || markEdge) {
        const id = flag ?? markEdge.id;
        drag = {
          mode: "mark",
          id,
          edge: flag ? "whole" : markEdge.edge,
          origin: marks.find((mark) => mark.id === id),
          grabTime: timeAtClientX(event.clientX),
          startX: event.clientX,
          moved: false,
          draft: null,
        };
        onMarkSelect(id);
      } else if (edge) drag = { mode: "edge", fixed: edge === "start" ? loop.end : loop.start };
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
    // follows the mouse, and hovering near a loop edge or a mark's edge
    // shows the resize cursor (a flag has its own).
    container.addEventListener("pointermove", (event) => {
      if (event.pointerId !== pointerId) {
        const overHandle = handleOf(event) !== null;
        if (pointerId === null) renderHoverLine(overHandle ? null : event.clientX);
        const idle = pointerId === null && !overHandle && !flagOf(event);
        const nearLoop = idle && loopEdgeAt(event.clientX) !== null;
        container.classList.toggle("near-loop-edge", nearLoop);
        container.classList.toggle("near-mark-edge", idle && !nearLoop && markEdgeAt(event.clientX) !== null);
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
      if (finished.mode === "stop") {
        if (stopPoint !== null) onSeek(stopPoint);
        return;
      }
      if (finished.mode === "start") {
        startDraft = null;
        // A click goes there; a drag moves it.
        if (finished.moved) onStartPointChange(finished.draft);
        else if (startPoint !== null) onSeek(startPoint);
        renderStartPoint(); // back to the start point as last set
        return;
      }
      if (finished.mode === "mark") {
        markDraft = null;
        if (finished.moved) onMarkChange(finished.id, finished.draft);
        // A click: a flag seeks to its mark, a mark's edge to the click.
        else onSeek(finished.edge === "whole" ? finished.origin.start : timeAtClientX(event.clientX));
        renderMarks(); // back to the marks as last set
        return;
      }
      if (finished.draft) onLoopChange({ start: finished.draft.start, end: finished.draft.end });
      // A Shift+click (too short to be a loop) is a plain click.
      else if (finished.mode === "draw") onSeek(finished.anchor);
      renderLoop(); // back to the loop as last set
    };
    container.addEventListener("pointerup", endDrag);
    container.addEventListener("pointercancel", endDrag);
    container.addEventListener("pointerleave", () => renderHoverLine(null));

    // The pointer is captured by the container while pressed, so the
    // double-click lands on it rather than on the flag: the flag is the
    // one the last press was on.
    container.addEventListener("dblclick", () => {
      if (pressedFlag) onMarkRename(pressedFlag);
    });
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

  /* ---------- Start and stop points ---------- */

  // The elements of a point: a line with a handle on the waveform
  // (<div part="<kind>-point"> holding <span part="<kind>-handle">) and a
  // tick on the minimap (.minimap-<kind>).
  function pointElements(kind, title) {
    const line = document.createElement("div");
    line.setAttribute("part", `${kind}-point`);
    const handle = document.createElement("span");
    handle.setAttribute("part", `${kind}-handle`);
    handle.dataset.handle = kind;
    handle.title = title;
    line.append(handle);
    const tick = document.createElement("div");
    tick.className = `minimap-${kind}`;
    tick.ariaHidden = "true";
    minimapContainer.append(tick);
    return { line, tick };
  }

  // Puts a point's line and tick at `time`, or hides them (null).
  function placePoint({ line, tick }, time) {
    const wrapper = waveSurfer.getWrapper();
    if (line.parentNode !== wrapper) wrapper.append(line);
    line.hidden = tick.hidden = time === null || !duration;
    if (!line.hidden) line.style.left = tick.style.left = `${(time / duration) * 100}%`;
  }

  // The start point, as last set or where its handle is dragged to.
  function renderStartPoint() {
    if (!waveSurfer) return;
    startElements ??= pointElements("start", "Space plays from here (drag to move it)");
    placePoint(startElements, startDraft ?? startPoint);
  }

  function renderStopPoint() {
    if (!waveSurfer) return;
    stopElements ??= pointElements("stop", "Playback last stopped here (click to go there)");
    placePoint(stopElements, stopPoint);
  }

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

  /* ---------- Marks ---------- */

  const percent = (time) => `${(time / duration) * 100}%`;

  // Draws the marks (as last set, with the one being dragged where it's
  // dragged to) and the region being marked, on the waveform and the
  // minimap. Each mark keeps its elements (markElements).
  function renderMarks() {
    if (!waveSurfer) return;
    const wrapper = waveSurfer.getWrapper();
    if (!marksLayer || marksLayer.parentNode !== wrapper) {
      marksLayer = document.createElement("div");
      marksLayer.setAttribute("part", "marks");
      marksLayer.ariaHidden = "true"; // the marks list is the accessible way to them
      wrapper.append(marksLayer);
      for (const { body } of markElements.values()) marksLayer.append(body);
    }
    if (!minimapMarksLayer) {
      minimapMarksLayer = document.createElement("div");
      minimapMarksLayer.className = "minimap-marks";
      minimapMarksLayer.ariaHidden = "true";
      minimapContainer.append(minimapMarksLayer);
    }

    const shown = duration ? marks.map((mark) => (mark.id === markDraft?.id ? { ...mark, ...markDraft } : mark)) : [];
    if (pendingRegion && duration) {
      const { start, end } = pendingRegion;
      shown.push({
        id: "",
        start: Math.min(start, end),
        end: Math.max(start, end),
        label: "",
        color: "",
        pending: true,
      });
    }

    const kept = new Set();
    for (const mark of shown) {
      kept.add(mark.id);
      let elements = markElements.get(mark.id);
      if (!elements) {
        const flag = document.createElement("span");
        flag.setAttribute("part", "mark-flag");
        const body = document.createElement("div");
        body.append(flag);
        elements = { body, flag, tick: document.createElement("div") };
        markElements.set(mark.id, elements);
        marksLayer.append(body);
        minimapMarksLayer.append(elements.tick);
      }
      const { body, flag, tick } = elements;
      const region = mark.end !== null;
      const pending = "pending" in mark;
      body.setAttribute(
        "part",
        [
          "mark",
          region ? "mark-region" : "mark-point",
          mark.id === selectedMark && "mark-selected",
          pending && "mark-pending",
        ]
          .filter(Boolean)
          .join(" "),
      );
      const color = pending ? "var(--text)" : `var(--mark-${mark.color})`;
      for (const element of [body, tick]) {
        element.style.left = percent(mark.start);
        element.style.width = region ? percent(mark.end - mark.start) : "";
        element.style.setProperty("--mark-color", color);
      }
      flag.setAttribute("part", mark.id === selectedMark ? "mark-flag mark-flag-selected" : "mark-flag");
      flag.hidden = pending;
      flag.textContent = mark.label;
      flag.title = mark.label;
      if (pending) delete flag.dataset.markFlag;
      else flag.dataset.markFlag = mark.id;
      tick.className = region ? "minimap-mark minimap-region" : "minimap-mark";
    }
    for (const [id, { body, tick }] of markElements) {
      if (kept.has(id)) continue;
      body.remove();
      tick.remove();
      markElements.delete(id);
    }
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
    waveSurfer.setScroll(waveSurfer.getScroll() + (clientXAt(anchorTime) - clientX));
  }

  // The wheel zooms at the pointer (a touchpad pinch arrives as a wheel
  // with ctrlKey, and zooms the same way); a touchpad's sideways swipe
  // scrolls.
  function bindWheelZoom() {
    container.addEventListener(
      "wheel",
      (event) => {
        if (!duration || (event.deltaY === 0 && event.deltaX === 0)) return;
        event.preventDefault();

        followPaused = true;
        if (Math.abs(event.deltaY) >= Math.abs(event.deltaX)) zoomBy(Math.exp(-event.deltaY * 0.001), event.clientX);
        else waveSurfer.setScroll(waveSurfer.getScroll() + event.deltaX);
      },
      { passive: false },
    );
  }

  // A wider window raises the fit-to-width zoom; never stay zoomed out past it.
  function bindResizeClamp() {
    new ResizeObserver(() => {
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
      waveSurfer.setScroll((maxScroll * trackOffset) / maxTrackOffset);
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
        waveSurfer.setScroll(waveSurfer.getScroll() + delta);
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
    marks = [];
    selectedMark = pendingRegion = markDraft = null;
    renderMarks();
    renderHoverLine(null);
    startPoint = startDraft = stopPoint = null;
    renderStartPoint();
    renderStopPoint();
    if (!waveSurfer) return;

    await waveSurfer.load("", peaks, trackDuration);
    waveSurfer.zoom(0);
    waveSurfer.setTime(0);
    duration = trackDuration;
    renderMarks();
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
    if (!inView) waveSurfer.setScrollTime(time);
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
    /**
     * Draws `list`, with `selected` (an id) picked out and `pending` (a
     * region being marked: { start, end }, either order) drawn dashed.
     * @param {Mark[]} list
     * @param {{ selected?: string | null, pending?: { start: number, end: number } | null }} [options]
     */
    setMarks(list, { selected = null, pending = null } = {}) {
      marks = list;
      selectedMark = selected;
      pendingRegion = pending;
      renderMarks();
    },
    /** Where Space plays from (seconds), or null to hide it. @param {number | null} time */
    setStartPoint(time) {
      startPoint = time;
      renderStartPoint();
    },
    /** Where playback last stopped (seconds), or null to hide it. @param {number | null} time */
    setStopPoint(time) {
      stopPoint = time;
      renderStopPoint();
    },
  };
}

/** @typedef {ReturnType<typeof createWaveform>} Waveform */
