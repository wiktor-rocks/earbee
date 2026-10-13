import { clamp } from "../core/format.js";
import { createEmitter } from "../core/emitter.js";
import { timelinePositionAt } from "../core/timeline.js";

/** @typedef {import("../core/timeline.js").Segment} Segment */
/** @typedef {import("../core/timeline.js").Loop} Loop */
/** @typedef {import("./engine.js").AudioEngine} AudioEngine */

/* =====================================================================
 * TRANSPORT
 * Playback state and position. Every change becomes a segment that
 * starts "now" on the AudioContext clock; the same segment is sent to
 * Signalsmith, so this copy of the timeline matches what the audio
 * thread plays.
 *
 * Signalsmith limitation: its schedule() treats each new segment as
 * the present and discards every segment that starts before it. So
 * never send a segment in the future (e.g. a stop at the track end);
 * future events are timers here instead.
 *
 * A–B loop: Signalsmith loops by itself (gapless). Each segment carries
 * loopStart/loopEnd; once the position reaches loopEnd it moves back by
 * the loop length. Two rules follow from its code:
 *   - a segment copies the previous one's loop fields, so they are always
 *     sent explicitly (0, 0 = no loop);
 *   - a segment starting at or after loopEnd would be dragged back one
 *     loop length per audio block, so a playing segment never starts
 *     there: it starts at the loop start instead.
 *
 * Exposes: play, pause, stop, seek, retune, load, setLoop, on,
 *          playStartFor, positionAt, state, playing, position, duration
 *   playStartFor(from) is where play() would start with the cursor at
 *   `from` (the start of the track after its end; the loop start outside
 *   an active loop), so a view can show where playback will start.
 *   pause(eventTime) pauses at what was being heard at `eventTime` (a
 *   performance.now()-style timestamp, e.g. event.timeStamp), not where
 *   the audio engine already is: that runs ahead of the speakers by the
 *   output delay, so pausing there made the cursor jump forward.
 * States:  "empty" (no track) | "ready" | "playing" | "paused"
 *          | "stopped" | "ended"
 * Events:  on("position", t)  every frame while playing, and after changes
 *          on("state", s)     whenever the state changes
 *          on("jump", t)      after a seek or a loop wrap-around (position
 *                             moved discontinuously)
 *          on("loop", loop)   after setLoop (the active loop, or null)
 * ===================================================================== */

/** @typedef {"empty" | "ready" | "playing" | "paused" | "stopped" | "ended"} TransportState */

/**
 * @param {object} deps
 * @param {AudioEngine} deps.engine
 * @param {() => number} deps.getRate Current speed setting.
 * @param {() => number} deps.getSemitones Current total pitch shift.
 */
export function createTransport({ engine, getRate, getSemitones }) {
  const events = createEmitter();
  const onPosition = (time) => events.emit("position", time);

  /** @type {TransportState} */
  let state = "empty";
  let duration = 0;
  /** @type {Segment[]} */
  let segments = []; // oldest first
  // A jump (seek, restart) that isn't audible yet; shown immediately so the
  // cursor doesn't flick back while the audio catches up.
  /** @type {{ outputTime: number, input: number } | null} */
  let pendingJump = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let endTimer = null;
  /** @type {number | null} */
  let rafId = null;
  /** @type {Loop | null} */
  let loop = null; // while looping
  // Last position drawn while playing; a smaller one means the loop wrapped.
  let lastDrawn = null;

  const isPlaying = () => state === "playing";
  const inLoop = (position) => loop !== null && position >= loop.start && position < loop.end;

  function setState(next) {
    if (state === next) return;
    state = next;
    events.emit("state", next);
  }

  function currentPosition() {
    if (!segments.length) return 0;
    // When not playing, the latest segment is inactive: playback rests there.
    if (!isPlaying()) return segments.at(-1).input;
    return positionHeardAt(performance.now());
  }

  // Position that was reaching the speakers at `eventTime` (performance
  // clock), while playing.
  function positionHeardAt(eventTime) {
    const sinceEvent = Math.max(0, (performance.now() - eventTime) / 1000);
    const heardAt = engine.now() - engine.outputDelay() - sinceEvent;
    if (pendingJump) {
      if (heardAt < pendingJump.outputTime) return pendingJump.input;
      if (sinceEvent === 0) pendingJump = null; // audible now, no longer needed
    }
    return timelinePositionAt(segments, heardAt, duration);
  }

  /**
   * Starts a new segment now. Without `input` it continues seamlessly from
   * the current position.
   * @param {{ input?: number, active: boolean }} change
   * @returns {boolean} Whether the position jumped.
   */
  function apply({ input, active }) {
    const at = engine.now();
    const continuation = timelinePositionAt(segments, at, duration);
    let start = clamp(input ?? continuation, 0, duration);
    if (active && loop && start >= loop.end) start = loop.start;
    const rate = getRate();
    const loopStart = loop?.start ?? 0;
    const loopEnd = loop?.end ?? 0;

    // Drop the local end-of-track marker (and anything else not yet reached).
    while (segments.length && segments.at(-1).outputTime >= at) segments.pop();
    // Keep a little history for positions still on their way to the speakers.
    const horizon = at - engine.outputDelay() - 1;
    while (segments.length > 1 && segments[1].outputTime <= horizon) segments.shift();

    segments.push({ outputTime: at, input: start, rate, active, loopStart, loopEnd });
    // Send `input` explicitly so the audio thread and this copy agree exactly.
    engine.schedule({ outputTime: at, input: start, rate, active, loopStart, loopEnd, semitones: getSemitones() });

    // A seamless segment keeps an earlier jump that isn't audible yet (e.g.
    // Play right after Stop must still report the stop position).
    const jumped = Math.abs(start - continuation) > 0.001;
    if (jumped) pendingJump = { outputTime: at, input: start };
    lastDrawn = null;

    clearTimeout(endTimer);
    endTimer = null;
    // A looping track never reaches its end.
    if (active && !loop) planEnd(at, start, rate);
    return jumped;
  }

  // Marks the end of the track locally (so the position stops at the end)
  // and sets a timer for it, which keeps working while the window is
  // hidden, unlike requestAnimationFrame. Past the last sample Signalsmith
  // plays silence, so the stop sent by finish() may arrive a little late.
  function planEnd(at, start, rate) {
    const endAt = at + (duration - start) / rate;
    segments.push({ outputTime: endAt, input: duration, rate, active: false, loopStart: 0, loopEnd: 0 });

    const delaySeconds = endAt + engine.outputDelay() - engine.now();
    endTimer = setTimeout(finish, Math.max(0, delaySeconds * 1000));
  }

  function finish() {
    apply({ input: duration, active: false });
    stopDrawing();
    setState("ended");
    onPosition(duration);
  }

  // The animation frame loop only draws; it never decides anything. The
  // next frame is requested first, so the loop survives any listener error.
  // A position smaller than the last one drawn means the loop wrapped
  // around (seeks reset lastDrawn), which views see as a jump.
  function draw() {
    rafId = requestAnimationFrame(draw);
    const position = currentPosition();
    const wrapped = lastDrawn !== null && position < lastDrawn - 0.001;
    lastDrawn = position;
    onPosition(position);
    if (wrapped) events.emit("jump", position);
  }

  function stopDrawing() {
    if (rafId === null) return;
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  // Where playback starts with the cursor at `from`: past the end, from
  // the top; with a loop on, inside it.
  function playStartFor(from) {
    if (from >= duration) return 0;
    if (loop && !inLoop(from)) return loop.start;
    return from;
  }

  function play() {
    if (!duration || isPlaying()) return;

    apply({ input: playStartFor(currentPosition()), active: true });
    setState("playing");
    stopDrawing();
    draw();
  }

  function pause(eventTime = performance.now()) {
    if (!isPlaying()) return;

    // The audio already on its way to the speakers still plays out; resuming
    // replays it from this point, so nothing is skipped.
    apply({ input: positionHeardAt(eventTime), active: false });
    stopDrawing();
    setState("paused");
    onPosition(currentPosition());
  }

  function stop() {
    if (!duration) return;

    apply({ input: 0, active: false });
    stopDrawing();
    setState("stopped");
    onPosition(0);
  }

  function seek(time) {
    if (!duration) return;

    apply({ input: clamp(Number(time), 0, duration), active: isPlaying() });
    if (state === "ended") setState("paused");
    const position = currentPosition();
    onPosition(position);
    events.emit("jump", position);
  }

  // Speed or pitch changed: continue from the same spot with new settings.
  function retune() {
    if (duration) apply({ active: isPlaying() });
  }

  // Sets the A–B loop ({ start, end } in seconds) or removes it (null).
  /** @param {Loop | null} next */
  // While playing outside the new loop, playback moves to its start, so
  // a loop you just drew or turned on is what you hear.
  function setLoop(next) {
    loop = next && duration ? { start: clamp(next.start, 0, duration), end: clamp(next.end, 0, duration) } : null;
    if (loop && loop.end <= loop.start) loop = null;

    const input = isPlaying() && loop && !inLoop(currentPosition()) ? loop.start : undefined;
    if (duration && apply({ input, active: isPlaying() })) {
      const position = currentPosition();
      onPosition(position);
      events.emit("jump", position);
    }
    events.emit("loop", loop);
  }

  // Resets for a new track (or none, with a duration of 0).
  function load(newDuration) {
    stopDrawing();
    clearTimeout(endTimer);
    endTimer = null;
    pendingJump = null;
    segments = [];
    duration = newDuration;
    loop = null;

    if (duration) apply({ input: 0, active: false });
    setState(duration ? "ready" : "empty");
    onPosition(0);
  }

  return {
    play,
    pause,
    stop,
    seek,
    retune,
    load,
    setLoop,
    playStartFor,
    on: events.on,
    get state() {
      return state;
    },
    get playing() {
      return isPlaying();
    },
    get position() {
      return currentPosition();
    },
    /**
     * The position that was being heard at `eventTime` (the performance
     * clock, e.g. a key press's timeStamp) while playing, so something
     * marked "now" lands where it was heard; the resting position otherwise.
     * @param {number} eventTime
     */
    positionAt: (eventTime) => (isPlaying() ? positionHeardAt(eventTime) : currentPosition()),
    get duration() {
      return duration;
    },
  };
}

/** @typedef {ReturnType<typeof createTransport>} Transport */
