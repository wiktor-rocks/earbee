import { CONFIG } from "./config.js";
import { clamp } from "./core/format.js";
import { visibleBeats } from "./core/beats.js";
import { formatRulerTime, rulerTicks } from "./core/ruler.js";

/** @typedef {import("./marks/index.js").Mark} Mark */
/** @typedef {import("./waveform.js").Waveform} Waveform */
/** @typedef {import("./waveform.js").View} View */
/** @typedef {{ start: number, end: number | null }} MarkTimes */

/* =====================================================================
 * TIMELINE
 * The lanes above the waveform, where the markers live, so the waveform
 * itself only shows the sound:
 *   - the ruler: time ticks; a click or drag on it seeks. It carries the
 *     start point's ▶ (where Space plays from: dragging moves it, a click
 *     goes there) and the stop point's ■ (where playback last stopped: a
 *     click goes there);
 *   - the marks lane: points (a line and a flag with the label) and
 *     regions (a bar with the label). Dragging one moves it, dragging a
 *     region's end resizes it, a click selects it and goes there, a
 *     double-click asks for a rename; an empty spot seeks.
 * The start and stop points continue as faint guide lines over the
 * waveform (a layer of ours over it, not inside WaveSurfer); marks stay in
 * their lane, so the sound isn't crossed by lines. The beats, once found
 * (features/beats.js), are fainter lines in that layer too. The minimap gets a
 * tick for each marker.
 *
 * Staying in sync: every lane (and the guides) holds one track element
 * as wide as the whole zoomed waveform and moved by its scroll, both
 * taken from the waveform's view (waveform.onView). Markers are placed in
 * percent of the track, so a zoom only changes the track's width and a
 * scroll only its transform. The view is reported from WaveSurfer's own
 * scroll and zoom events, which run before the frame is painted, so the
 * lanes and the waveform always paint together. The lanes and the
 * waveform share one column (.timeline) with no side borders of their
 * own, so x = 0 is the same pixel in all of them.
 *
 * The timeline only draws and reports what the pointer did; the marks and
 * the points belong to the features (features/marks.js, playback.js).
 *
 * Exposes: setMarks, setStartPoint, setStopPoint, setBeats
 * ===================================================================== */

/**
 * @param {object} options
 * @param {HTMLElement} options.ruler
 * @param {HTMLElement} options.marksLane
 * @param {HTMLElement} options.guides The layer over the waveform.
 * @param {HTMLElement} options.minimapContainer
 * @param {Waveform} options.waveform
 * @param {(time: number) => void} options.onSeek
 * @param {(id: string) => void} options.onMarkSelect A mark was pressed.
 * @param {(id: string, times: MarkTimes) => void} options.onMarkChange A drag moved a mark.
 * @param {(id: string) => void} options.onMarkRename A mark was double-clicked.
 * @param {(time: number) => void} options.onStartPointChange The start point's ▶ was dragged.
 */
export function createTimeline({
  ruler,
  marksLane,
  guides,
  minimapContainer,
  waveform,
  onSeek,
  onMarkSelect,
  onMarkChange,
  onMarkRename,
  onStartPointChange,
}) {
  const clickSlopPx = 3; // a press that moves less is a click

  /** @type {View} */
  let view = { duration: 0, width: 0, offset: 0 };
  /** @type {Mark[]} */
  let marks = []; // as last set by setMarks()
  let selectedMark = null; // its id
  let pendingRegion = null; // { start, end }: a region being marked
  let markDraft = null; // { id, start, end } while a mark is dragged
  let startPoint = null; // as last set by setStartPoint()
  let startDraft = null; // while its ▶ is dragged
  let stopPoint = null; // as last set by setStopPoint()

  const element = (className, parent) => {
    const created = document.createElement("div");
    created.className = className;
    parent?.append(created);
    return created;
  };
  const percent = (time) => `${(time / view.duration) * 100}%`;

  // One track per lane, moved together.
  const rulerTrack = element("timeline-track", ruler);
  const rulerTicksLayer = element("ruler-ticks", rulerTrack);
  const marksTrack = element("timeline-track", marksLane);
  const guidesTrack = element("timeline-track", guides);
  // First in the guides, so the start and stop points' lines are above it.
  const beatsLayer = element("guide-beats", guidesTrack);
  const tracks = [rulerTrack, marksTrack, guidesTrack];

  const minimapLayer = element("minimap-marks", minimapContainer);
  minimapLayer.ariaHidden = "true";

  /* ---------- Following the waveform's view ---------- */

  // The ruler's ticks cover the visible range and a screen either side,
  // so most scrolling only moves the track.
  let rendered = null; // { start, end, width }

  /** @param {View} next */
  function applyView(next) {
    view = next;
    for (const track of tracks) {
      track.hidden = !view.duration;
      track.style.width = `${view.width}px`;
      track.style.transform = `translateX(${view.offset}px)`;
    }
    renderRuler();
    renderBeats();
  }

  function renderRuler() {
    if (!view.duration || !view.width) {
      rendered = null;
      rulerTicksLayer.replaceChildren();
      return;
    }
    const pxPerSecond = view.width / view.duration;
    const start = -view.offset / pxPerSecond;
    const end = start + ruler.clientWidth / pxPerSecond;
    if (rendered && rendered.width === view.width && start >= rendered.start && end <= rendered.end) return;

    const span = end - start;
    rendered = { start: Math.max(0, start - span), end: Math.min(view.duration, end + span), width: view.width };
    const { step, ticks } = rulerTicks(rendered.start, rendered.end, pxPerSecond);
    const fragment = document.createDocumentFragment();
    for (const tick of ticks) {
      const line = element(tick.major ? "ruler-tick major" : "ruler-tick", fragment);
      line.style.left = percent(tick.time);
      if (tick.major) line.textContent = formatRulerTime(tick.time, step);
    }
    rulerTicksLayer.replaceChildren(fragment);
  }

  /* ---------- The beats ---------- */

  // Drawn like the ruler's ticks: for the visible range and a screen
  // either side. Hidden when zoomed out so far that they'd be a grey wash.
  let beats = null; // as last set by setBeats()
  let beatsRendered = null; // { start, end, width }

  function renderBeats() {
    const pxPerSecond = view.duration && view.width ? view.width / view.duration : 0;
    const spacing = beats?.length > 1 ? ((beats.at(-1) - beats[0]) / (beats.length - 1)) * pxPerSecond : 0;
    if (spacing < CONFIG.beats.minSpacingPx) {
      beatsRendered = null;
      beatsLayer.replaceChildren();
      return;
    }
    const start = -view.offset / pxPerSecond;
    const end = start + guides.clientWidth / pxPerSecond;
    const cached = beatsRendered;
    if (cached && cached.width === view.width && start >= cached.start && end <= cached.end) return;

    const span = end - start;
    beatsRendered = { start: Math.max(0, start - span), end: Math.min(view.duration, end + span), width: view.width };
    const { from, to } = visibleBeats(beats, beatsRendered.start, beatsRendered.end);
    const fragment = document.createDocumentFragment();
    for (let i = from; i < to; i++) element("guide-beat", fragment).style.left = percent(beats[i]);
    beatsLayer.replaceChildren(fragment);
  }

  /* ---------- The start and stop points ---------- */

  /** @param {"start" | "stop"} kind */
  function pointElements(kind, title) {
    const handle = element(`ruler-${kind}`, rulerTrack);
    handle.dataset.handle = kind;
    handle.title = title;
    return { handle, guide: element(`guide-${kind}`, guidesTrack), tick: element(`minimap-${kind}`, minimapLayer) };
  }
  const startElements = pointElements("start", "Space plays from here (drag to move it)");
  const stopElements = pointElements("stop", "Playback last stopped here (click to go there)");

  function placePoint(elements, time) {
    const shown = time !== null && view.duration > 0;
    for (const each of Object.values(elements)) {
      each.hidden = !shown;
      if (shown) each.style.left = percent(time);
    }
  }

  const renderStartPoint = () => placePoint(startElements, startDraft ?? startPoint);
  const renderStopPoint = () => placePoint(stopElements, stopPoint);

  /* ---------- Marks ---------- */

  // The elements drawing each mark, by id, kept between renders (so a
  // double-click isn't split across two elements).
  /** @type {Map<string, { item: HTMLElement, label: HTMLElement, tick: HTMLElement }>} */
  const markElements = new Map();

  // Draws the marks (as last set, with the one being dragged where it's
  // dragged to) and the region being marked, in the lane and on the
  // minimap.
  function renderMarks() {
    const shown = view.duration
      ? marks.map((mark) => (mark.id === markDraft?.id ? { ...mark, ...markDraft } : mark))
      : [];
    if (pendingRegion && view.duration) {
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
    const starts = shown.filter((mark) => !("pending" in mark)).map((mark) => mark.start);

    const kept = new Set();
    for (const mark of shown) {
      kept.add(mark.id);
      let elements = markElements.get(mark.id);
      if (!elements) {
        const item = element("lane-mark", marksTrack);
        elements = {
          item,
          label: element("lane-label", item),
          tick: element("minimap-mark", minimapLayer),
        };
        markElements.set(mark.id, elements);
      }
      const { item, label, tick } = elements;
      const region = mark.end !== null;
      const pending = "pending" in mark;
      const selected = mark.id === selectedMark;
      // A point's box reaches the next mark, so its label never covers it.
      const next = Math.min(view.duration, ...starts.filter((start) => start > mark.start + 1e-6));
      const end = region ? mark.end : next;

      item.className = [
        "lane-mark",
        region ? "lane-region" : "lane-point",
        selected && "selected",
        pending && "pending",
      ]
        .filter(Boolean)
        .join(" ");
      tick.className = region ? "minimap-mark minimap-region" : "minimap-mark";
      const color = pending ? "var(--text)" : `var(--mark-${mark.color})`;
      for (const each of [item, tick]) {
        each.style.left = percent(mark.start);
        each.style.setProperty("--mark-color", color);
      }
      item.style.width = percent(end - mark.start);
      tick.style.width = region ? percent(mark.end - mark.start) : "";
      label.textContent = mark.label;
      label.title = mark.label;
      if (pending) delete item.dataset.markId;
      else item.dataset.markId = mark.id;
    }
    for (const [id, { item, tick }] of markElements) {
      if (kept.has(id)) continue;
      item.remove();
      tick.remove();
      markElements.delete(id);
    }
  }

  // The mark edge nearest to `x` within grabbing distance, or null:
  // { id, edge }, where `edge` is "point", or a region's "start" or "end".
  function markEdgeAt(x) {
    if (!view.duration) return null;
    let nearest = null;
    for (const mark of marks) {
      const edges = mark.end === null ? { point: mark.start } : { start: mark.start, end: mark.end };
      for (const [edge, time] of Object.entries(edges)) {
        const distance = Math.abs(x - waveform.clientXAt(time));
        if (distance <= CONFIG.loop.edgeGrabPx && !(nearest?.distance <= distance))
          nearest = { id: mark.id, edge, distance };
      }
    }
    return nearest;
  }

  /* ---------- Pointer ---------- */

  // Presses and drags on a lane: `press(event)` starts a drag (an object
  // with move(x, time) and end(event)); moves are applied once per frame.
  // Dragging near an edge of a zoomed view scrolls it, as on the waveform.
  function bindDrags(lane, press) {
    let drag = null;
    let pointerId = null;
    let pendingX = null;
    let frame = 0;

    function apply() {
      frame = 0;
      if (pendingX === null || !drag) return;
      const x = pendingX;
      pendingX = null;
      waveform.scrollNearEdge(x);
      drag.move(x, waveform.timeAtClientX(x));
    }

    lane.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !view.duration) return;
      event.preventDefault();
      drag = press(event);
      pointerId = event.pointerId;
      lane.setPointerCapture(pointerId);
      waveform.holdFollow(true);
      pendingX = event.clientX;
      apply();
    });
    lane.addEventListener("pointermove", (event) => {
      if (event.pointerId !== pointerId) return;
      pendingX = event.clientX;
      frame ||= requestAnimationFrame(apply);
    });
    const end = (event) => {
      if (event.pointerId !== pointerId) return;
      cancelAnimationFrame(frame);
      pendingX = event.clientX;
      apply(); // the last position
      const finished = drag;
      drag = pointerId = null;
      waveform.holdFollow(false);
      finished.end(event);
    };
    lane.addEventListener("pointerup", end);
    lane.addEventListener("pointercancel", end);
    // The wheel zooms and scrolls, as on the waveform.
    lane.addEventListener("wheel", waveform.wheel, { passive: false });
  }

  /** @returns {HTMLElement | null} */
  const closest = (event, selector) => /** @type {HTMLElement} */ (event.target).closest(selector);

  // A press that seeks, and keeps seeking while dragged (scrubbing).
  const seekDrag = () => ({ move: (x, time) => onSeek(time), end: () => {} });

  // A press on a handle or a mark: a click unless it moves a few pixels.
  function clickOrDrag(startX, { move, click, drop }) {
    let moved = false;
    return {
      move(x, time) {
        moved ||= Math.abs(x - startX) >= clickSlopPx;
        if (moved) move(time);
      },
      end: (event) => (moved ? drop() : click(event)),
    };
  }

  // The ruler: ▶ drags the start point (a click goes there), ■ goes to
  // the stop point; anywhere else seeks.
  bindDrags(ruler, (event) => {
    const handle = closest(event, "[data-handle]")?.dataset.handle;
    if (handle === "stop") return { move: () => {}, end: () => stopPoint !== null && onSeek(stopPoint) };
    if (handle !== "start") return seekDrag();
    return clickOrDrag(event.clientX, {
      move(time) {
        startDraft = time;
        renderStartPoint();
      },
      click: () => startPoint !== null && onSeek(startPoint),
      drop() {
        const dropped = startDraft;
        startDraft = null;
        onStartPointChange(dropped);
        renderStartPoint(); // back to the start point as last set
      },
    });
  });

  // The marks lane. A mark's edge (a point's line, a region's ends) comes
  // first, then its body or flag; an empty spot seeks.
  let pressedMark = null; // the mark the last press was on, for dblclick
  bindDrags(marksLane, (event) => {
    const edge = markEdgeAt(event.clientX);
    const body = closest(event, "[data-mark-id]");
    const id = edge?.id ?? body?.dataset.markId ?? null;
    pressedMark = id;
    if (!id) return seekDrag();

    const origin = marks.find((mark) => mark.id === id);
    const part = edge?.edge ?? "whole";
    const grabTime = waveform.timeAtClientX(event.clientX);
    let draft = null;
    onMarkSelect(id);

    // Where the mark would be with the pointer at `time`. A region can't
    // get shorter than CONFIG.marks.minSeconds; it stays as it was.
    function draftAt(time) {
      if (part === "point") return { start: time, end: null };
      if (part === "whole") {
        const length = (origin.end ?? origin.start) - origin.start;
        const start = clamp(origin.start + time - grabTime, 0, view.duration - length);
        return { start, end: origin.end === null ? null : start + length };
      }
      const other = part === "start" ? origin.end : origin.start;
      const [start, end] = [Math.min(time, other), Math.max(time, other)];
      if (end - start >= CONFIG.marks.minSeconds) return { start, end };
      return draft ?? { start: origin.start, end: origin.end };
    }

    return clickOrDrag(event.clientX, {
      move(time) {
        draft = draftAt(time);
        markDraft = { id, ...draft };
        renderMarks();
      },
      // A click: the mark's body goes to its start, its edge to the click.
      click: (up) => onSeek(part === "whole" ? origin.start : waveform.timeAtClientX(up.clientX)),
      drop() {
        markDraft = null;
        onMarkChange(id, draft);
        renderMarks(); // back to the marks as last set
      },
    });
  });
  // With the pointer captured, the double-click lands on the lane: the
  // mark is the one the last press was on.
  marksLane.addEventListener("dblclick", () => {
    if (pressedMark) onMarkRename(pressedMark);
  });
  // Near a mark's edge, the resize cursor.
  marksLane.addEventListener("pointermove", (event) => {
    if (event.buttons) return;
    marksLane.classList.toggle("near-edge", markEdgeAt(event.clientX) !== null);
  });

  waveform.onView((next) => {
    const zoomedOrLoaded = next.duration !== view.duration || next.width !== view.width;
    applyView(next);
    if (zoomedOrLoaded) {
      renderMarks(); // a point's box depends on the duration
      renderStartPoint();
      renderStopPoint();
    }
  });

  return {
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
    /** The beats (seconds, in order), or null to hide them. @param {Float64Array | null} times */
    setBeats(times) {
      beats = times;
      beatsRendered = null;
      renderBeats();
    },
  };
}

/** @typedef {ReturnType<typeof createTimeline>} Timeline */
