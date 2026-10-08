// @ts-check
/* =====================================================================
 * TranscriBee: renderer script
 *
 * A music-transcription player: open a song or a video, slow it down,
 * shift its pitch, EQ it, and step through it with the keyboard.
 *
 * HOW IT FITS TOGETHER
 *
 *   user input ─► bindings ─► actions ─► transport ─► engine ─► speakers
 *                                │                      ▲
 *                                └─► setSetting() ──────┘
 *   transport.on("position" | "state" | "jump") ─► waveform, video, UI
 *
 *   engine     Web Audio graph: Signalsmith (speed + pitch) → EQ → volume
 *              → limiter. Knows nothing about the UI or `settings`.
 *   transport  Playback state and position. Mirrors Signalsmith's timeline,
 *              so the position of what is being heard is computed exactly.
 *   waveform   WaveSurfer drawing, zoom, minimap and the A–B loop region.
 *              Never plays audio.
 *   video      Frame-exact picture for video files: decodes frames itself
 *              (Mediabunny + WebCodecs) and draws the frame at the transport
 *              position. No second clock, so it can't drift from the audio.
 *   settings   The single copy of every user setting (plain values).
 *
 *   Until the first file loads, a welcome screen (#welcome) stands in for
 *   the player (#app); showPlayer() swaps them once (§9, §11). The first
 *   load shows a loading screen (#loadingScreen) in their place; later
 *   loads an overlay over the player (setLoading, §9).
 *
 * SECTIONS
 *   1 Config   2 Pure helpers   3 Settings   4 Audio engine   5 Transport
 *   6 Waveform   7 Video   8 Instances   9 UI   10 Setting controls
 *   11 File loading   12 Playback actions   13 Keyboard shortcuts   14 Startup
 *
 * COMMON CHANGES
 *   Speed preset or EQ band   Edit CONFIG.speed.presets / CONFIG.eq.bands.
 *                             The buttons and faders are generated.
 *   Step sizes (← / →)        Edit CONFIG.step.sizes (↑ / ↓ cycle through them).
 *   Slider range or default   Edit CONFIG. Sliders get min/max/step from it,
 *                             and the scale labels under them are generated.
 *   New slider setting        Add a range to CONFIG, a value to `settings`,
 *                             an entry to SLIDERS (§10), and an
 *                             <input type="range"> plus readout to index.html.
 *   New keyboard shortcut     Add an entry to SHORTCUTS (§13); the legend
 *                             at the bottom of the window updates itself.
 *   Colours and fonts         Tokens at the top of style.css (the waveform
 *                             reads its colours from there too).
 *   Video file types          CONFIG.video.extensions (also anything with a
 *                             video/* type). Codecs are whatever WebCodecs
 *                             decodes: H.264, VP8/VP9, AV1; not HEVC here.
 *   A new view that follows   Subscribe to transport.on("position"/"state"/
 *   playback                  "jump") in §8, like the waveform and video.
 *   A–B loop                  State and actions in §12 (setLoopRegion);
 *                             audio looping in the transport (§5), drawing
 *                             and dragging in the waveform (§6).
 *   Any change                Record it in CHANGELOG.md (what, why, how,
 *                             where), so the next person or LLM can follow.
 * ===================================================================== */

// Pinned to 1.3.2: the transport mirrors its timeline and loop behaviour
// (see §5), so an upgrade needs re-checking against its source.
import SignalsmithStretch from "./node_modules/signalsmith-stretch/SignalsmithStretch.mjs";

/* =====================================================================
 * 1. CONFIG
 * Every tunable number lives here.
 * ===================================================================== */

const CONFIG = {
  speed: { min: 0.25, max: 3, step: 0.01, initial: 1, presets: [0.25, 0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1] },
  volume: { min: 0, max: 200, step: 1, initial: 100 }, // percent
  semitones: { min: -12, max: 12, step: 1, initial: 0 },
  cents: { min: -50, max: 50, step: 1, initial: 0 },

  eq: {
    gain: { min: -24, max: 24, step: 0.1, initial: 0 }, // dB, per band
    enabledInitially: false,
    // `id` is also the fader's element id; its readout is `${id}Value`.
    bands: [
      { id: "eqLow", label: "Low", type: "lowshelf", frequency: 120 },
      { id: "eqLowMid", label: "Lo-mid", type: "peaking", frequency: 400, Q: 1 },
      { id: "eqMid", label: "Mid", type: "peaking", frequency: 1000, Q: 1 },
      { id: "eqHighMid", label: "Hi-mid", type: "peaking", frequency: 3000, Q: 1 },
      { id: "eqHigh", label: "High", type: "highshelf", frequency: 6000 },
    ],
  },

  // Step sizes (seconds) for ← / → and the step buttons; ↑ / ↓ pick one.
  // Holding ← / → repeats the step, which makes it a rewind / fast-forward.
  step: { sizes: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10], initial: 1 },

  loop: {
    // Shortest A–B loop; a Shift+drag shorter than this is a plain click.
    minSeconds: 0.05,
    // Pointer distance (CSS px) from a loop edge that grabs the edge.
    edgeGrabPx: 6,
  },

  audio: {
    // Smoothing for volume and EQ changes, so they don't click.
    paramRampSeconds: 0.015,
    // Brick-wall limiter that stops volume > 100% and EQ boosts clipping.
    limiter: { threshold: -1, knee: 0, ratio: 20, attack: 0.002, release: 0.1 },
  },

  // Largest file that can be opened: the audio decoder reads the whole
  // file into memory, video included.
  maxFileBytes: 2 * 1024 ** 3,

  video: {
    // Files treated as video (also anything with a video/* type).
    extensions: ["mp4", "m4v", "mov", "webm", "mkv", "ogv"],
    // If decoding falls this far behind playback (heavy file at high
    // speed), restart decoding at the current position instead of lagging.
    maxLagSeconds: 0.5,
    // Low-resolution proxy: a small copy of the video, encoded in the
    // background after it loads. Its frames are cheap to decode anywhere,
    // so it fills in at full frame rate (blurry) wherever the sharp frame
    // still needs decoding: distant seeks, dragging, catching up after a
    // jump during playback.
    proxy: {
      width: 320, // px; height follows the video's aspect ratio
      maxFps: 30, // higher frame rates are thinned to this
      keyframeInterval: 15, // frames; seeking decodes at most this many
      bitrate: 400_000, // bits/s; ≈ 3 MB per minute of video
      // The proxy is only used when the sharp picture is at least this far
      // from where it should be, so normal playback never shows it.
      useWhenOffBySeconds: 0.15,
      // After a seek, sharp decoding waits this long (or until the proxy
      // frame is on screen) so the proxy, not the busy sharp decoder, gets
      // the CPU first and the picture responds at once.
      headStartMs: 60,
    },
  },

  waveform: {
    // How far in Ctrl + mouse wheel can zoom, relative to fit-to-width.
    maxZoomMultiplier: 32,
    // Peaks per second of audio in the drawing: enough for 2 per pixel at
    // maximum zoom on the widest possible window, within these limits.
    minPeaksPerSecond: 50,
    maxPeaksPerSecond: 8000,
  },
};

/* =====================================================================
 * 2. PURE HELPERS
 * No DOM, no state: safe to reuse and easy to test.
 * ===================================================================== */

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const formatSigned = (value, unit) => `${value >= 0 ? "+" : ""}${value}${unit}`;
const formatSpeed = (speed) => `${speed.toFixed(2)}×`;
const formatPercent = (percent) => `${Math.round(percent)}%`;
const formatFrequency = (hz) => (hz >= 1000 ? `${hz / 1000} kHz` : `${hz} Hz`);
const formatPitchTotal = (semitones) => `${semitones >= 0 ? "+" : ""}${semitones.toFixed(2)} st`;
// Prints a step size exactly as written in CONFIG.step.sizes: 0.25 → "0.25".
const formatStepSize = (seconds) => String(seconds);

function formatGain(gain) {
  const digits = Number.isInteger(gain) ? gain : gain.toFixed(1);
  return `${gain > 0 ? "+" : ""}${digits} dB`;
}

// 83.456 → "1:23.456"; with hours "1:02:03.456".
function formatTrackTime(time) {
  const totalMilliseconds = Math.max(0, Math.floor(time * 1000));
  const totalSeconds = Math.floor(totalMilliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  const milliseconds = String(totalMilliseconds % 1000).padStart(3, "0");

  if (minutes < 60) return `${minutes}:${seconds}.${milliseconds}`;

  const hours = Math.floor(minutes / 60);
  return `${hours}:${String(minutes % 60).padStart(2, "0")}:${seconds}.${milliseconds}`;
}

// Reduce samples to one value per `factor` samples, keeping the largest
// excursion (positive or negative) so peaks survive in the drawing.
// Runs over every sample of a song, so the inner loop is kept minimal.
function downsamplePeaks(samples, factor) {
  if (factor <= 1) return samples;

  const length = samples.length;
  const peaks = new Float32Array(Math.ceil(length / factor));

  for (let start = 0, out = 0; start < length; start += factor, out++) {
    const end = Math.min(start + factor, length);
    let min = 0;
    let max = 0;

    for (let i = start; i < end; i++) {
      const sample = samples[i];
      if (sample > max) max = sample;
      else if (sample < min) min = sample;
    }

    peaks[out] = max >= -min ? max : min;
  }

  return peaks;
}

// Peaks per second needed to draw a track of `duration` seconds at 2 peaks
// per device pixel at maximum zoom, in a window at most `widestPx` wide.
function peaksPerSecondFor(duration, widestPx) {
  const { maxZoomMultiplier, minPeaksPerSecond, maxPeaksPerSecond } = CONFIG.waveform;
  const needed = (widestPx / duration) * maxZoomMultiplier * 2;
  return clamp(Math.ceil(needed), minPeaksPerSecond, maxPeaksPerSecond);
}

/**
 * One stretch of the playback timeline (Signalsmith's and the transport's
 * copy of it): from `outputTime` on, the track plays from `input` at
 * `rate`, or rests at `input` if not active.
 * @typedef {object} Segment
 * @property {number} outputTime When it starts, in seconds on the AudioContext clock.
 * @property {number} input Track position (s) at outputTime.
 * @property {number} rate Playback speed (1 = normal).
 * @property {boolean} active Playing (true) or resting (false).
 * @property {number} [loopStart] A–B loop in track seconds; 0, 0 means no loop.
 * @property {number} [loopEnd]
 */

/**
 * Position in the track at `time` (AudioContext clock), given a timeline of
 * segments, oldest first. This is the same mapping Signalsmith uses
 * internally, including its loop: once the position reaches loopEnd it
 * moves back by the loop length (segments never start at or after loopEnd,
 * see §5).
 * @param {Segment[]} segments
 * @param {number} time
 * @param {number} duration Track length; the result is clamped to it.
 * @returns {number}
 */
function timelinePositionAt(segments, time, duration) {
  let segment = segments[0];
  for (const candidate of segments) {
    if (candidate.outputTime > time) break;
    segment = candidate;
  }
  if (!segment) return 0;

  const elapsed = segment.active ? Math.max(0, time - segment.outputTime) : 0;
  let position = segment.input + elapsed * segment.rate;

  const { loopStart = 0, loopEnd = 0 } = segment;
  const loopLength = loopEnd - loopStart;
  if (loopLength > 0 && position >= loopEnd) {
    position = loopStart + ((position - loopStart) % loopLength);
  }
  return clamp(position, 0, duration);
}

// Minimal event emitter: on(event, listener) returns an unsubscribe function.
/** @returns {{ on(event: string, listener: (...args: any[]) => void): () => void, emit(event: string, ...args: any[]): void }} */
// A listener that throws is logged and skipped, so one broken view can't
// stop the others (or the code that emitted the event).
function createEmitter() {
  const listeners = new Map();
  return {
    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(listener);
      return () => listeners.get(event).delete(listener);
    },
    emit(event, ...args) {
      for (const listener of listeners.get(event) ?? []) {
        try {
          listener(...args);
        } catch (error) {
          console.error(`Error in a "${event}" listener:`, error);
        }
      }
    },
  };
}

const fileExtension = (name) => name.slice(name.lastIndexOf(".") + 1).toLowerCase();

const isVideoFile = (file) =>
  file.type.startsWith("video/") || CONFIG.video.extensions.includes(fileExtension(file.name));

const formatGigabytes = (bytes) => `${Math.round(bytes / 1024 ** 3)} GB`;

// An error whose message is written for the user. Anything else is shown
// as an unexpected failure.
class AppError extends Error {
  /**
   * @param {string} message Shown to the user as is.
   * @param {unknown} [cause] The underlying error, for the console.
   */
  constructor(message, cause) {
    super(message, { cause });
  }
}

/* =====================================================================
 * 3. SETTINGS
 * The single copy of every user setting. Change values through
 * setSetting() (§10) so the UI and the audio follow.
 * ===================================================================== */

const settings = {
  speed: CONFIG.speed.initial,
  volume: CONFIG.volume.initial, // percent
  semitones: CONFIG.semitones.initial,
  cents: CONFIG.cents.initial,
  eqEnabled: CONFIG.eq.enabledInitially,
  stepSize: CONFIG.step.initial, // seconds, one of CONFIG.step.sizes
  // One gain (dB) per EQ band, keyed by band id: eqLow, eqLowMid, …
  ...Object.fromEntries(CONFIG.eq.bands.map((band) => [band.id, CONFIG.eq.gain.initial])),
};

const totalSemitones = () => settings.semitones + settings.cents / 100;
const eqGains = () => Object.fromEntries(CONFIG.eq.bands.map((band) => [band.id, settings[band.id]]));

/* =====================================================================
 * 4. AUDIO ENGINE
 * Signalsmith → EQ chain → master volume → limiter → speakers.
 *
 * Exposes: init, decode, loadChannels, schedule, setVolume, setEq,
 *          now, outputDelay, resume
 * Values set before init() are remembered and applied when the graph
 * is built, so settings can change before any audio is loaded.
 * ===================================================================== */

/** @param {{ onError: (error: unknown) => void }} options */
function createAudioEngine({ onError }) {
  const { paramRampSeconds, limiter: limiterConfig } = CONFIG.audio;

  let context = null;
  let stretch = null;
  let masterGain = null;
  let initPromise = null;
  const eqFilters = {};
  const desired = { volume: 1, eqGains: {}, eqEnabled: false };

  function rampParam(param, value) {
    param.setTargetAtTime(value, context.currentTime, paramRampSeconds);
  }

  function applyEq() {
    for (const [id, filter] of Object.entries(eqFilters)) {
      rampParam(filter.gain, desired.eqEnabled ? (desired.eqGains[id] ?? 0) : 0);
    }
  }

  function buildGraph() {
    let node = stretch;

    for (const band of CONFIG.eq.bands) {
      const filter = context.createBiquadFilter();
      filter.type = band.type;
      filter.frequency.value = band.frequency;
      if (band.Q !== undefined) filter.Q.value = band.Q;

      node.connect(filter);
      node = filter;
      eqFilters[band.id] = filter;
    }
    applyEq();

    masterGain = context.createGain();
    masterGain.gain.value = desired.volume;

    const limiter = context.createDynamicsCompressor();
    for (const [param, value] of Object.entries(limiterConfig)) limiter[param].value = value;

    node.connect(masterGain).connect(limiter).connect(context.destination);
  }

  async function create() {
    context = new AudioContext();
    await context.resume();

    stretch = await SignalsmithStretch(context);
    buildGraph();
  }

  function init() {
    initPromise ??= create().catch((error) => {
      initPromise = null;
      throw new AppError("The audio engine couldn't start.", error);
    });
    return initPromise;
  }

  // Signalsmith keeps a timeline of these segments; each one takes effect
  // at its `outputTime` on the AudioContext clock. The worklet's message
  // port is ordered, so calls don't need to wait for each other.
  function schedule(segment) {
    stretch?.schedule(segment).catch(onError);
  }

  async function loadChannels(channels) {
    // Signalsmith expects one buffer per channel; the buffers are transferred.
    await stretch.dropBuffers();
    await stretch.addBuffers(
      channels,
      channels.map((channel) => channel.buffer),
    );
  }

  return {
    init,
    schedule,
    loadChannels,
    decode: (bytes) => context.decodeAudioData(bytes),
    now: () => context?.currentTime ?? 0,
    // Time from audio leaving the graph to it reaching the speakers.
    outputDelay: () => (context ? (context.baseLatency || 0) + (context.outputLatency || 0) : 0),
    resume: () => context?.resume(),

    // Linear gain: 1 = 100%.
    setVolume(volume) {
      desired.volume = volume;
      if (masterGain) rampParam(masterGain.gain, volume);
    },

    // `gains` maps band id → dB. A disabled EQ is flat.
    setEq(gains, enabled) {
      desired.eqGains = gains;
      desired.eqEnabled = enabled;
      if (context) applyEq();
    },
  };
}

/* =====================================================================
 * 5. TRANSPORT
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
 *          state, playing, position, duration
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
 * ===================================================================== */

/** @typedef {"empty" | "ready" | "playing" | "paused" | "stopped" | "ended"} TransportState */
/** @typedef {{ start: number, end: number }} Loop An active A–B loop, in track seconds. */

/**
 * @param {object} deps
 * @param {AudioEngine} deps.engine
 * @param {() => number} deps.getRate Current speed setting.
 * @param {() => number} deps.getSemitones Current total pitch shift.
 */
function createTransport({ engine, getRate, getSemitones }) {
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

  function play() {
    if (!duration || isPlaying()) return;

    let from = currentPosition();
    if (from >= duration) from = 0;
    // With a loop on, playback starts inside it.
    if (loop && !inLoop(from)) from = loop.start;
    apply({ input: from, active: true });
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
    get duration() {
      return duration;
    },
  };
}

/* =====================================================================
 * 6. WAVEFORM
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
 * The wheel scrolls; Ctrl + wheel zooms, keeping the spot under the mouse
 * in place. After the view is moved by hand (zoom, wheel, minimap),
 * following the playback cursor pauses until the cursor comes back into
 * view or resumeFollow() is called (on every seek), so you can look ahead
 * while it plays.
 *
 * Exposes: preload, init, load, setTime, follow, resumeFollow, setLoop
 * ===================================================================== */

/**
 * @param {object} options
 * @param {HTMLElement} options.container
 * @param {HTMLElement} options.minimapContainer
 * @param {(time: number) => void} options.onSeek A click or drag asks to move the cursor.
 * @param {(loop: Loop) => void} options.onLoopChange A drag drew or adjusted the loop.
 */
function createWaveform({ container, minimapContainer, onSeek, onLoopChange }) {
  const { maxZoomMultiplier } = CONFIG.waveform;

  let waveSurfer = null;
  let modulesPromise = null;
  let initPromise = null;
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

  // Loads the WaveSurfer code without creating anything on screen, so it
  // is safe to call at startup.
  function preload() {
    modulesPromise ??= Promise.all([
      import("./node_modules/wavesurfer.js/dist/wavesurfer.esm.js"),
      import("./node_modules/wavesurfer.js/dist/plugins/minimap.esm.js"),
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

      // Colours live in style.css as custom properties.
      const styles = getComputedStyle(document.documentElement);
      const color = (name) => styles.getPropertyValue(name).trim();

      waveSurfer = WaveSurfer.create({
        container,
        height: "auto",
        waveColor: color("--wave"),
        progressColor: color("--wave-progress"),
        cursorColor: color("--cursor"),
        cursorWidth: 2,
        normalize: true,
        interact: false, // seeking is handled by bindPointerSeek()
        dragToSeek: false,
        // Following the cursor is done by follow(); WaveSurfer's own
        // auto-scroll would undo any zoom or scroll made away from it.
        autoScroll: false,
        autoCenter: false,
        hideScrollbar: true,
        plugins: [
          MinimapPlugin.create({
            container: minimapContainer,
            height: 46,
            waveColor: color("--minimap-wave"),
            progressColor: color("--minimap-progress"),
            cursorColor: color("--cursor"),
            overlayColor: color("--minimap-overlay"),
            normalize: true,
            interact: false,
            dragToSeek: false,
          }),
        ],
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
    const edgePx = 30; // dragging this close to an edge scrolls a zoomed view
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

      if (pointerId !== null) {
        const view = container.getBoundingClientRect();
        if (x > view.right - edgePx) waveSurfer.setScroll(waveSurfer.getScroll() + edgePx);
        else if (x < view.left + edgePx) waveSurfer.setScroll(waveSurfer.getScroll() - edgePx);
      }

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

      const edge = event.shiftKey ? null : loopEdgeAt(event.clientX);
      if (edge) drag = { mode: "edge", fixed: edge === "start" ? loop.end : loop.start };
      else if (event.shiftKey) drag = { mode: "draw", anchor: timeAtClientX(event.clientX) };
      else drag = { mode: "seek" };

      pointerId = event.pointerId;
      container.setPointerCapture(pointerId);
      scrubbing = true;
      pendingX = event.clientX;
      applyPointer(); // a click seeks at once
    });

    // Moves are applied once per frame. Without a drag, hovering near a
    // loop edge shows the resize cursor.
    container.addEventListener("pointermove", (event) => {
      if (event.pointerId !== pointerId) {
        container.classList.toggle("near-loop-edge", pointerId === null && loopEdgeAt(event.clientX) !== null);
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

  // Wheel scrolls horizontally (a touchpad's sideways swipe too); Ctrl +
  // wheel zooms at the pointer (a touchpad pinch arrives as Ctrl + wheel).
  function bindWheelZoom() {
    container.addEventListener(
      "wheel",
      (event) => {
        if (!duration || (event.deltaY === 0 && event.deltaX === 0)) return;
        event.preventDefault();

        followPaused = true;
        if (event.ctrlKey) {
          if (event.deltaY !== 0) zoomBy(Math.exp(-event.deltaY * 0.001), event.clientX);
          return;
        }
        waveSurfer.setScroll(waveSurfer.getScroll() + (event.deltaY || event.deltaX));
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
  // elsewhere centres the overlay on the pointer.
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
    if (!waveSurfer) return;

    await waveSurfer.load("", peaks, trackDuration);
    waveSurfer.zoom(0);
    waveSurfer.setTime(0);
    duration = trackDuration;
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
    resumeFollow: () => (followPaused = false),
    setTime: (time) => waveSurfer?.setTime(time),
    /** @param {LoopRegion | null} next */
    setLoop(next) {
      loop = next && { ...next };
      renderLoop();
    },
  };
}

/* =====================================================================
 * 7. VIDEO
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
 *   prepare(file) → { video, reason }: opens a file without touching the
 *   video on screen; `video` is null (with a reason) if it has no
 *   picture this app can decode. Never throws.
 * ===================================================================== */

// Low-resolution proxy of one video (see CONFIG.video.proxy). Built from
// `sourceSink` (a decoder of its own) with WebCodecs, kept in memory as
// encoded chunks, and read back with its own small decoder.
//   build(isBusy)  re-encodes the whole video; pauses while isBusy() is true
//   frameAt(time)  → VideoFrame for `time` (caller closes it), or null if
//                  that part isn't built yet or it is the frame last returned
//   dispose()      stops building and frees everything
function createVideoProxy({ track, sourceSink }) {
  const { width, maxFps, keyframeInterval, bitrate } = CONFIG.video.proxy;
  // Even dimensions keep every encoder happy.
  const height = 2 * Math.max(1, Math.round((width * track.displayHeight) / track.displayWidth / 2));
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const chunks = []; // { time, end, key, chunk: EncodedVideoChunk }, in order
  let decoderConfig = null;
  let disposed = false;

  async function pickCodec() {
    for (const codec of ["vp8", "vp09.00.10.08", "avc1.42001f"]) {
      const config = { codec, width, height, bitrate, framerate: maxFps };
      const [encode, decode] = await Promise.all([
        VideoEncoder.isConfigSupported(config).catch(() => ({ supported: false })),
        VideoDecoder.isConfigSupported({ codec, codedWidth: width, codedHeight: height }).catch(() => ({
          supported: false,
        })),
      ]);
      if (encode.supported && decode.supported) return codec;
    }
    return null;
  }

  /* ---------- Building ---------- */

  async function build(isBusy) {
    const codec = await pickCodec();
    if (!codec) throw new Error("No video encoder available for the proxy.");

    const startedAt = performance.now();
    const encoder = new VideoEncoder({
      output: (chunk, metadata) => {
        if (metadata?.decoderConfig) decoderConfig = metadata.decoderConfig;
        const time = chunk.timestamp / 1e6;
        chunks.push({ time, end: time + (chunk.duration ?? 0) / 1e6, key: chunk.type === "key", chunk });
      },
      error: (error) => console.warn("Proxy encoder failed:", error),
    });
    encoder.configure({ codec, width, height, bitrate, framerate: maxFps, latencyMode: "realtime" });

    const scaled = new OffscreenCanvas(width, height);
    const scaledContext = scaled.getContext("2d");
    let nextTime = -Infinity;
    let count = 0;

    try {
      for await (const sample of sourceSink.samples()) {
        try {
          if (disposed) return;
          if (sample.timestamp >= nextTime - 1e-6) {
            sample.drawWithFit(scaledContext, { fit: "fill" }); // also applies rotation
            const frame = new VideoFrame(scaled, {
              timestamp: Math.round(sample.timestamp * 1e6),
              duration: Math.round(Math.max(sample.duration, 1 / maxFps) * 1e6),
            });
            encoder.encode(frame, { keyFrame: count % keyframeInterval === 0 });
            frame.close();
            count++;
            nextTime = sample.timestamp + 1 / maxFps;
          }
        } finally {
          sample.close();
        }
        // Don't run ahead of the encoder, give way to the main decoder, and
        // keep the page responsive.
        while (encoder.encodeQueueSize > 4 && !disposed) await sleep(1);
        while (isBusy() && !disposed) await sleep(5);
        if (count % 8 === 0) await sleep(0);
      }
      if (!disposed) await encoder.flush();
    } finally {
      if (encoder.state !== "closed") encoder.close();
    }

    const megabytes = chunks.reduce((sum, { chunk }) => sum + chunk.byteLength, 0) / 1024 ** 2;
    console.debug(
      `Video proxy: ${chunks.length} frames (${codec}, ${width}×${height}, ${megabytes.toFixed(1)} MB), ` +
        `built in ${Math.round(performance.now() - startedAt)} ms`,
    );
  }

  /* ---------- Reading ---------- */

  let decoder = null;
  let nextIndex = -1; // next chunk the decoder expects, when decoding in order
  const waiting = new Map(); // chunk timestamp (µs) → resolve(frame)

  function onOutput(frame) {
    const resolve = waiting.get(frame.timestamp);
    if (resolve) {
      waiting.delete(frame.timestamp);
      resolve(frame);
    } else {
      frame.close(); // a frame decoded only on the way to the wanted one
    }
  }

  function restartDecoder() {
    if (!decoder || decoder.state === "closed") {
      decoder = new VideoDecoder({
        output: onOutput,
        error: (error) => {
          console.warn("Proxy decoder failed:", error);
          decoder = null;
        },
      });
    } else {
      decoder.reset();
    }
    decoder.configure(decoderConfig);
    for (const resolve of waiting.values()) resolve(null);
    waiting.clear();
    nextIndex = -1;
  }

  // Index of the chunk shown at `time` (the last one starting at or before it).
  function indexAt(time) {
    let low = 0;
    let high = chunks.length - 1;
    if (high < 0 || time < chunks[0].time) return -1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (chunks[middle].time <= time) low = middle;
      else high = middle - 1;
    }
    return low;
  }

  function keyIndexBefore(index) {
    let i = index;
    while (i > 0 && !chunks[i].key) i--;
    return i;
  }

  async function frameAt(time) {
    if (disposed || !decoderConfig || !chunks.length || time > chunks.at(-1).end) return null;
    const index = indexAt(time);
    if (index < 0) return null;
    if (decoder && index === nextIndex - 1) return null; // already the latest frame

    // Continue in order when possible; otherwise start at the keyframe.
    const continuing = decoder && nextIndex >= 0 && nextIndex <= index && keyIndexBefore(index) < nextIndex;
    if (!continuing) restartDecoder();
    const first = continuing ? nextIndex : keyIndexBefore(index);

    for (let i = first; i < index; i++) decoder.decode(chunks[i].chunk);
    const wanted = chunks[index].chunk;
    const frame = new Promise((resolve) => waiting.set(wanted.timestamp, resolve));
    decoder.decode(wanted);
    nextIndex = index + 1;

    // A decoder that holds frames back would never answer; give up quickly.
    const timeout = sleep(250).then(() => {
      waiting.delete(wanted.timestamp);
      return null;
    });
    return Promise.race([frame, timeout]);
  }

  function dispose() {
    disposed = true;
    for (const resolve of waiting.values()) resolve(null);
    waiting.clear();
    if (decoder && decoder.state !== "closed") decoder.close();
    decoder = null;
    chunks.length = 0;
  }

  return {
    build,
    frameAt,
    dispose,
  };
}

/**
 * @param {object} options
 * @param {HTMLElement} options.pane The box the picture sits in (hidden for audio files).
 * @param {HTMLCanvasElement} options.canvas
 * @param {(visible: boolean) => void} options.onVisibilityChange Switch the page layout.
 * @param {(message: string) => void} options.onProblem Tell the user the picture is in trouble.
 */
function createVideoView({ pane, canvas, onVisibilityChange, onProblem }) {
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
    modulePromise ??= import("./node_modules/mediabunny/dist/bundles/mediabunny.mjs").catch((error) => {
      modulePromise = null; // let the next call retry
      throw error;
    });
    return modulePromise;
  }

  /* ---------- Opening files ---------- */

  async function prepare(file) {
    let input = null;
    try {
      const { Input, BlobSource, ALL_FORMATS, VideoSampleSink, EncodedPacketSink } = await preload();
      input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });

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

/* =====================================================================
 * 8. INSTANCES
 * The components, wired to each other and to the UI. Their callbacks
 * only run after startup, so the UI functions they use (declared below)
 * are ready by then.
 * ===================================================================== */

/** @typedef {ReturnType<typeof createAudioEngine>} AudioEngine */
/** @typedef {ReturnType<typeof createTransport>} Transport */
/** @typedef {ReturnType<typeof createWaveform>} Waveform */
/** @typedef {ReturnType<typeof createVideoView>} VideoView */

/** @param {string} id */
const $ = (id) => document.getElementById(id);

const engine = createAudioEngine({ onError: reportError });

const transport = createTransport({
  engine,
  getRate: () => settings.speed,
  getSemitones: totalSemitones,
});

const waveform = createWaveform({
  container: $("waveform"),
  minimapContainer: $("waveform-minimap"),
  onSeek: (time) => transport.seek(time),
  onLoopChange: (loop) => setLoopRegion({ ...loop, enabled: true }),
});

const videoView = createVideoView({
  pane: $("videoPane"),
  canvas: /** @type {HTMLCanvasElement} */ ($("videoCanvas")),
  onVisibilityChange: (visible) => $("stage").classList.toggle("has-video", visible),
  onProblem: (message) => showNotice(message),
});

// Everything that follows playback subscribes here.
transport.on("position", (time) => {
  waveform.setTime(time);
  if (transport.playing) {
    waveform.follow(time);
    videoView.advance(time);
  }
  renderTrackTime(time);
});

transport.on("state", (state) => {
  renderTransportState(state);
  if (state === "playing") videoView.start(transport.position);
  else videoView.showFrameAt(transport.position);
});

transport.on("jump", (time) => {
  waveform.resumeFollow(); // a deliberate move brings the view back to the cursor
  if (transport.playing) videoView.start(time);
  else videoView.showFrameAt(time);
});

// Where Space plays from next (see replayOrPause in §12): where playback
// last started, or where it was last moved to.
transport.on("state", (state) => {
  if (state === "playing") returnPoint = transport.position;
  else if (state === "stopped" || state === "ready") returnPoint = 0;
});
transport.on("jump", (time) => {
  returnPoint = time;
});

const hasAudio = () => transport.duration > 0;

/* =====================================================================
 * 9. UI
 * Element lookups, generated markup, and render functions. Rendering
 * only reads state; it never changes it.
 * ===================================================================== */

const dom = {
  welcome: $("welcome"),
  welcomeOpen: $("welcomeOpen"),
  welcomeMessage: $("welcomeMessage"),
  loadingScreen: $("loadingScreen"),
  loadingFileName: $("loadingFileName"),
  app: $("app"),
  loadingOverlay: $("loadingOverlay"),
  fileInput: /** @type {HTMLInputElement} */ ($("file")),
  fileName: $("fileName"),
  message: $("message"),
  trackTime: $("trackTime"),
  loopInfo: $("loopInfo"),
  speedScale: $("speedScale"),
  volumeScale: $("volumeScale"),
  playButton: /** @type {HTMLButtonElement} */ ($("play")),
  stopButton: /** @type {HTMLButtonElement} */ ($("stop")),
  stepBackButton: /** @type {HTMLButtonElement} */ ($("stepBack")),
  stepForwardButton: /** @type {HTMLButtonElement} */ ($("stepForward")),
  stepSize: $("stepSize"),
  speedChips: $("speedChips"),
  pitchValue: $("pitchValue"),
  resetPitchButton: $("resetPitch"),
  eqSection: $("eqSection"),
  eqFaders: $("eqFaders"),
  eqToggle: $("eqToggle"),
  resetEqButton: $("resetEq"),
  shortcutList: $("shortcutList"),
};

const speedChips = () => /** @type {HTMLButtonElement[]} */ ([...dom.speedChips.children]);
const transportButtons = () => [dom.playButton, dom.stopButton, dom.stepBackButton, dom.stepForwardButton];

/* ---------- Errors and notices ---------- */

// One message line: in the transport bar, or under the drop zone while
// the welcome screen is up. An error means something failed (red); a
// notice means something works only partly (neutral).
function showMessage(text, kind) {
  const line = dom.app.hidden ? dom.welcomeMessage : dom.message;
  line.textContent = text;
  line.classList.toggle("notice", kind === "notice");
}

const showError = (text) => showMessage(text, "error");
const showNotice = (text) => showMessage(text, "notice");
const clearMessage = () => showMessage("", "notice");

function reportError(error) {
  console.error(error);
  showError(error instanceof AppError ? error.message : `Something went wrong: ${error?.message ?? error}`);
}

// Wraps an event handler so its failures are shown instead of dropped.
const guarded =
  (handler) =>
  (...args) =>
    Promise.resolve()
      .then(() => handler(...args))
      .catch(reportError);

/* ---------- Renderers ---------- */

// The one place that turns the transport state into UI.
function renderTransportState(state) {
  dom.playButton.textContent = state === "playing" ? "❚❚ Pause" : "▶ Play";
  for (const button of transportButtons()) button.disabled = state === "empty";
}

function renderTrackTime(position) {
  const display = `${formatTrackTime(position)} / ${formatTrackTime(transport.duration)}`;
  if (dom.trackTime.textContent !== display) dom.trackTime.textContent = display;
}

// The step readout in the transport bar (the step buttons show arrows).
function renderStepSize() {
  dom.stepSize.textContent = `Step ${formatStepSize(settings.stepSize)} s`;
}

// The loop readout next to the track time; dimmed while the loop is off.
function renderLoopInfo(region) {
  dom.loopInfo.hidden = !region;
  if (!region) return;
  dom.loopInfo.textContent = `Loop ${formatTrackTime(region.start)} – ${formatTrackTime(region.end)}`;
  dom.loopInfo.classList.toggle("disabled", !region.enabled);
}

function renderSpeedChips() {
  for (const chip of speedChips()) {
    chip.classList.toggle("active", Number(chip.dataset.speed) === settings.speed);
  }
}

function renderPitchTotal() {
  dom.pitchValue.textContent = formatPitchTotal(totalSemitones());
}

function renderEqEnabled() {
  dom.eqToggle.textContent = settings.eqEnabled ? "On" : "Off";
  dom.eqToggle.setAttribute("aria-pressed", String(settings.eqEnabled));
  dom.eqSection.classList.toggle("bypassed", !settings.eqEnabled);
}

// Shows that `file` is loading, or (null) that loading is over.
//   First file: the loading screen replaces the welcome screen. The player
//     may be shown underneath during the load (showPlayer() runs before the
//     waveform draws, so it can measure itself); the opaque screen hides it.
//   Later files: a translucent overlay over the player.
// Whatever is underneath is inert, so it can't be clicked, focused or typed into.
function setLoading(file) {
  const busy = file !== null;
  dom.app.inert = busy;

  if (busy && dom.app.hidden) {
    dom.loadingFileName.textContent = file.name;
    dom.welcome.hidden = true;
    dom.loadingScreen.hidden = false;
    return;
  }
  dom.loadingOverlay.hidden = !busy;
  if (busy) return;

  dom.loadingScreen.hidden = true;
  // The first file failed: back to the welcome screen, which shows the error.
  if (dom.app.hidden && dom.welcome.hidden) {
    dom.welcome.hidden = false;
    dom.welcomeOpen.focus();
  }
}

// Swaps the welcome screen for the player, once, when the first file loads
// (under the loading screen, which setLoading(null) then removes).
function showPlayer() {
  dom.welcome.hidden = true;
  dom.app.hidden = false;
}

/* ---------- Generated markup ---------- */

function element(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function buildSpeedChips() {
  for (const speed of CONFIG.speed.presets) {
    const chip = element("button", { type: "button", className: "chip" }, `${speed}×`);
    chip.dataset.speed = speed;
    dom.speedChips.append(chip);
  }
}

// The labels under the speed and volume sliders, from CONFIG.
function buildScales() {
  const { speed, volume } = CONFIG;
  dom.speedScale.append(element("span", {}, `${speed.min}×`), element("span", {}, `${speed.max}×`));
  for (const percent of [volume.min, CONFIG.volume.initial, volume.max]) {
    dom.volumeScale.append(element("span", {}, formatPercent(percent)));
  }
}

function buildEqFaders() {
  for (const band of CONFIG.eq.bands) {
    dom.eqFaders.append(
      element(
        "div",
        { className: "fader" },
        element("output", { id: `${band.id}Value` }),
        element("input", { id: band.id, type: "range" }),
        element("label", { htmlFor: band.id }, band.label, element("small", {}, formatFrequency(band.frequency))),
      ),
    );
  }
}

/* =====================================================================
 * 10. SETTING CONTROLS
 * Every slider-backed setting is one entry in SLIDERS. setSetting()
 * clamps the value, stores it, updates the slider and readout, then
 * runs the entry's onChange to apply it.
 * ===================================================================== */

function applyEq() {
  engine.setEq(eqGains(), settings.eqEnabled);
}

function applyPitch() {
  renderPitchTotal();
  transport.retune();
}

/**
 * A setting controlled by a range input (see SLIDERS).
 * @typedef {object} SliderSpec
 * @property {string} inputId The <input type="range">.
 * @property {string} readoutId The element showing the formatted value.
 * @property {{ min: number, max: number, step: number }} range From CONFIG.
 * @property {(value: number) => string} format
 * @property {() => void} onChange Applies the new value (audio, other UI).
 */

/** @type {Record<string, SliderSpec>} */
const SLIDERS = {
  speed: {
    inputId: "speed",
    readoutId: "speedValue",
    range: CONFIG.speed,
    format: formatSpeed,
    onChange: () => {
      renderSpeedChips();
      transport.retune();
    },
  },
  volume: {
    inputId: "volume",
    readoutId: "volumeValue",
    range: CONFIG.volume,
    format: formatPercent,
    onChange: () => engine.setVolume(settings.volume / 100),
  },
  semitones: {
    inputId: "semitoneShift",
    readoutId: "semitoneValue",
    range: CONFIG.semitones,
    format: (value) => formatSigned(value, " st"),
    onChange: applyPitch,
  },
  cents: {
    inputId: "centShift",
    readoutId: "centValue",
    range: CONFIG.cents,
    format: (value) => formatSigned(value, " ct"),
    onChange: applyPitch,
  },
  // One per EQ band; the faders themselves are generated by buildEqFaders().
  ...Object.fromEntries(
    CONFIG.eq.bands.map((band) => [
      band.id,
      { inputId: band.id, readoutId: `${band.id}Value`, range: CONFIG.eq.gain, format: formatGain, onChange: applyEq },
    ]),
  ),
};

const sliderInput = (slider) => /** @type {HTMLInputElement} */ ($(slider.inputId));

/**
 * @param {string} key A key of SLIDERS (and of `settings`).
 * @param {number | string} value Clamped to the slider's range.
 */
function setSetting(key, value) {
  const slider = SLIDERS[key];
  const { min, max } = slider.range;

  settings[key] = clamp(Number(value), min, max);
  sliderInput(slider).value = String(settings[key]);
  $(slider.readoutId).textContent = slider.format(settings[key]);
  slider.onChange();
}

function setEqEnabled(enabled) {
  settings.eqEnabled = enabled;
  renderEqEnabled();
  applyEq();
}

function resetPitch() {
  setSetting("semitones", CONFIG.semitones.initial);
  setSetting("cents", CONFIG.cents.initial);
}

function resetEq() {
  for (const band of CONFIG.eq.bands) setSetting(band.id, CONFIG.eq.gain.initial);
}

// ↑ / ↓: the next larger (+1) or smaller (−1) step size; stops at either end.
function changeStepSize(direction) {
  const { sizes } = CONFIG.step;
  const index = sizes.indexOf(settings.stepSize);
  settings.stepSize = sizes[clamp(index + direction, 0, sizes.length - 1)];
  renderStepSize();
}

// Gives each slider its range from CONFIG, shows the current value and
// listens for input.
function initSliders() {
  for (const [key, slider] of Object.entries(SLIDERS)) {
    const input = sliderInput(slider);
    const { min, max, step } = slider.range;
    Object.assign(input, { min: String(min), max: String(max), step: String(step) });

    setSetting(key, settings[key]);
    input.addEventListener(
      "input",
      guarded(() => setSetting(key, input.value)),
    );
  }
}

/* =====================================================================
 * 11. FILE LOADING
 * Nothing about the current media changes until the new file has
 * decoded, so a bad file leaves the previous song or video playable.
 * For video files the audio is decoded as usual while the picture is
 * prepared in parallel; a picture that can't be shown is a notice,
 * not an error.
 * ===================================================================== */

// True while a file loads; the UI is locked, so loads never overlap.
let loading = false;

// Times each phase of a load and logs them in one line with console.debug
// (shown at DevTools' "Verbose" level). Milliseconds.
function createLoadTimer(fileName) {
  const startedAt = performance.now();
  const phases = {};

  return {
    async time(label, work) {
      const phaseStart = performance.now();
      const result = await work();
      phases[label] = Math.round(performance.now() - phaseStart);
      return result;
    },
    done() {
      phases.total = Math.round(performance.now() - startedAt);
      console.debug(`Load timings for “${fileName}”: ${JSON.stringify(phases)}`);
    },
  };
}

// One peak array per channel, for the waveform drawing. Long tracks get
// far fewer peaks per second than short ones (see peaksPerSecondFor).
function computePeaks(audioBuffer) {
  const widestPx = window.screen.width * window.devicePixelRatio;
  const peaksPerSecond = peaksPerSecondFor(audioBuffer.duration, widestPx);
  const factor = Math.max(1, Math.round(audioBuffer.sampleRate / peaksPerSecond));
  return Array.from({ length: audioBuffer.numberOfChannels }, (_, i) =>
    downsamplePeaks(audioBuffer.getChannelData(i), factor),
  );
}

async function loadMediaFile(file) {
  if (file.size > CONFIG.maxFileBytes) {
    throw new AppError(`“${file.name}” is too large to open (the limit is ${formatGigabytes(CONFIG.maxFileBytes)}).`);
  }

  const timer = createLoadTimer(file.name);
  const isVideo = isVideoFile(file);

  const [, waveformAvailable] = await timer.time("init", () => Promise.all([engine.init(), waveform.init()]));
  const picture = isVideo ? timer.time("video", () => videoView.prepare(file)) : Promise.resolve(null);
  const bytes = await timer.time("read", () => file.arrayBuffer());

  let decoded;
  try {
    decoded = await timer.time("decode", () => engine.decode(bytes));
  } catch (error) {
    picture.then((prepared) => videoView.discard(prepared?.video));
    throw new AppError(
      isVideo
        ? `Couldn't read the audio in “${file.name}”. Videos need a soundtrack this app can decode.`
        : `Couldn't open “${file.name}”. It isn't an audio file this app can decode.`,
      error,
    );
  }

  const duration = decoded.duration;
  const peaks = await timer.time("peaks", () => computePeaks(decoded));

  // The decoded samples go to Signalsmith without a copy: transferring
  // moves them to the audio thread and empties `decoded`, which is why
  // the peaks are computed first.
  const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));

  const prepared = await picture;

  transport.pause();
  // Show the player and switch its layout (video pane shown or hidden)
  // before drawing the waveform: WaveSurfer measures its container when it
  // draws, so it must be visible and at its final size.
  showPlayer();
  if (prepared?.video) videoView.show(prepared.video);
  else videoView.clear();
  // The transfer finishes on the audio thread while the waveform draws.
  await Promise.all([
    timer.time("transfer", () => engine.loadChannels(channels)),
    timer.time("waveform", () => waveform.load(peaks, duration)),
  ]);
  transport.load(duration);
  setLoopRegion(null);
  dom.fileName.textContent = file.name;
  document.title = `TranscriBee — ${file.name}`; // also the window title
  timer.done();

  const notices = [];
  if (isVideo && !prepared?.video) {
    notices.push(`The picture in “${file.name}” can't be shown (${prepared?.reason}), but its audio plays.`);
  }
  if (!waveformAvailable) notices.push("The waveform couldn't be drawn, but playback works.");
  showNotice(notices.join(" "));
}

async function openFile(file) {
  if (!file || loading) return;

  loading = true;
  clearMessage();
  setLoading(file);

  try {
    await loadMediaFile(file);
  } catch (error) {
    reportError(error);
  } finally {
    loading = false;
    setLoading(null);
    renderTransportState(transport.state);
  }
}

function bindFileInput() {
  // The welcome screen's button opens the same (hidden) file input.
  dom.welcomeOpen.addEventListener("click", () => dom.fileInput.click());

  dom.fileInput.addEventListener("change", () => {
    const file = dom.fileInput.files?.[0];
    // Clear it so choosing the same file again still fires "change".
    dom.fileInput.value = "";
    openFile(file);
  });
}

function bindFileDrop() {
  // Without preventDefault, Electron navigates to a dropped file.
  window.addEventListener("dragover", (event) => {
    event.preventDefault();
    if (!loading) document.body.classList.add("dragging");
  });

  window.addEventListener("dragleave", (event) => {
    if (event.relatedTarget === null) document.body.classList.remove("dragging");
  });

  window.addEventListener("drop", (event) => {
    event.preventDefault();
    document.body.classList.remove("dragging");
    openFile(event.dataTransfer?.files?.[0]);
  });
}

/* =====================================================================
 * 12. PLAYBACK ACTIONS
 * What buttons and shortcuts call. Each is synchronous: playback is
 * scheduled on the audio clock, so nothing needs to be awaited.
 * ===================================================================== */

function play() {
  // Only needed if the system suspended the audio; scheduled playback
  // simply waits on the audio clock until it runs.
  engine.resume()?.catch(reportError);
  transport.play();
}

// `event` (optional) is the key or click that asked for it: pausing uses its
// timestamp to stop exactly at what was being heard at that moment.
const pause = (event) => transport.pause(event?.timeStamp);
const stop = () => transport.stop();
// Pause, or resume from where playback is now (comma).
const togglePlay = (event) => (transport.playing ? pause(event) : play());
// Moves the cursor one step (settings.stepSize) back or forward.
const step = (direction) => transport.seek(transport.position + direction * settings.stepSize);
const stepBack = () => step(-1);
const stepForward = () => step(1);

// Where you last started listening: where playback last started, or where
// it was last moved to (click, step, loop wrap); 0 after Stop. Kept up to
// date by the transport listeners in §8.
let returnPoint = null;

// Pause, or play again from where you started listening (Space and the
// Play button, like Transcribe!). The cursor stays where it paused, so
// the spot stays visible; a click or step while paused moves the start.
function replayOrPause(event) {
  if (transport.playing) return pause(event);
  // Read first: the seek below moves returnPoint itself.
  const from = returnPoint;
  if (from !== null && from !== transport.position) transport.seek(from);
  play();
}

// Play-while-held: keys currently held, and whether playback was already
// running when the first one went down (then releasing keeps it running).
const heldKeys = new Set();
let playingBeforeHold = false;

function holdToPlay(event) {
  if (heldKeys.size === 0) playingBeforeHold = transport.playing;
  heldKeys.add(event.code);
  play();
}

function releaseHold(event) {
  if (!heldKeys.delete(event.code)) return;
  if (heldKeys.size === 0 && !playingBeforeHold) pause(event);
}

/* ---------- A–B loop ---------- */

/**
 * The A–B loop as shown: drawn on the waveform even while turned off. The
 * transport only knows about it while it is enabled.
 * @typedef {{ start: number, end: number, enabled: boolean }} LoopRegion
 */
/** @type {LoopRegion | null} */
let loopRegion = null;

/** @param {LoopRegion | null} region Too short (or null) removes the loop. */
function setLoopRegion(region) {
  const valid = region && region.end - region.start >= CONFIG.loop.minSeconds;
  loopRegion = valid ? { start: region.start, end: region.end, enabled: region.enabled } : null;
  transport.setLoop(loopRegion?.enabled ? loopRegion : null);
  waveform.setLoop(loopRegion);
  renderLoopInfo(loopRegion);
}

// [ and ]: move one end of the loop to the cursor, keeping the other end
// if it still makes a loop, and turn the loop on.
function setLoopStart() {
  const start = transport.position;
  const end = loopRegion && loopRegion.end > start ? loopRegion.end : transport.duration;
  setLoopRegion({ start, end, enabled: true });
}

function setLoopEnd() {
  const end = transport.position;
  const start = loopRegion && loopRegion.start < end ? loopRegion.start : 0;
  setLoopRegion({ start, end, enabled: true });
}

const toggleLoop = () => loopRegion && setLoopRegion({ ...loopRegion, enabled: !loopRegion.enabled });
const clearLoop = () => setLoopRegion(null);

// A click handler whose failures are shown to the user (see guarded).
const onClick = (element, handler) => element.addEventListener("click", guarded(handler));

function bindControls() {
  onClick(dom.playButton, replayOrPause);
  onClick(dom.stopButton, stop);
  onClick(dom.stepBackButton, stepBack);
  onClick(dom.stepForwardButton, stepForward);

  for (const chip of speedChips()) {
    onClick(chip, () => setSetting("speed", chip.dataset.speed));
  }

  onClick(dom.resetPitchButton, resetPitch);
  onClick(dom.resetEqButton, resetEq);
  onClick(dom.eqToggle, () => setEqEnabled(!settings.eqEnabled));
}

/* =====================================================================
 * 13. KEYBOARD SHORTCUTS
 * Modelled on the defaults of Seventh String's Transcribe!. The legend
 * at the bottom of the window is rendered from SHORTCUTS.
 *
 *   codes   KeyboardEvent.code values (physical keys, any layout)
 *   shift   true if the shortcut is Shift + the key (optional)
 *   keys    labels for the legend, one per code
 *   down    called on key press, with the KeyboardEvent
 *   up      called on key release (optional), with the KeyboardEvent
 *   repeat  whether holding the key keeps firing `down`
 * Shortcuts only fire when a track is loaded and nothing is loading.
 * ===================================================================== */

/**
 * @typedef {object} Shortcut
 * @property {string[]} codes
 * @property {boolean} [shift]
 * @property {string[]} keys
 * @property {string} description
 * @property {(event: KeyboardEvent) => void} down
 * @property {(event: KeyboardEvent) => void} [up]
 * @property {boolean} [repeat]
 */

/** @type {Shortcut[]} */
const SHORTCUTS = [
  {
    codes: ["Space"],
    keys: ["Space"],
    description: "Play / pause (replays from where you started)",
    down: replayOrPause,
  },
  { codes: ["Comma"], keys: [","], description: "Pause / resume here", down: togglePlay },
  { codes: ["Period"], keys: ["."], description: "Stop", down: stop },
  { codes: ["KeyZ", "Semicolon"], keys: ["Z", ";"], description: "Play while held", down: holdToPlay, up: releaseHold },
  { codes: ["ArrowLeft"], keys: ["←"], description: "Step back (hold to rewind)", repeat: true, down: stepBack },
  {
    codes: ["ArrowRight"],
    keys: ["→"],
    description: "Step forward (hold to fast-forward)",
    repeat: true,
    down: stepForward,
  },
  { codes: ["ArrowUp"], keys: ["↑"], description: "Larger step", down: () => changeStepSize(1) },
  { codes: ["ArrowDown"], keys: ["↓"], description: "Smaller step", down: () => changeStepSize(-1) },
  { codes: ["BracketLeft"], keys: ["["], description: "Loop start", down: setLoopStart },
  { codes: ["BracketRight"], keys: ["]"], description: "Loop end", down: setLoopEnd },
  { codes: ["KeyL"], keys: ["L"], description: "Loop on / off", down: toggleLoop },
  { codes: ["KeyL"], shift: true, keys: ["L"], description: "Clear loop", down: clearLoop },
];

// Shortcuts are plain keys or Shift + key; presses with Ctrl, Alt or Meta
// are left to the system. A release matches by key alone, so pressing
// Shift while holding a play-while-held key can't leave it playing.
function findShortcut(event) {
  if (event.ctrlKey || event.metaKey || event.altKey) return undefined;
  const isRelease = event.type === "keyup";
  return SHORTCUTS.find(
    (shortcut) => shortcut.codes.includes(event.code) && (isRelease || Boolean(shortcut.shift) === event.shiftKey),
  );
}

const isTextField = (target) =>
  target.isContentEditable ||
  target.tagName === "TEXTAREA" ||
  (target.tagName === "INPUT" && !["range", "button", "checkbox", "file"].includes(target.type));

// A slider reached with Tab keeps its arrow keys, for keyboard-only use.
// A slider that was clicked doesn't: after dragging the speed, ← / → still
// step the cursor. (:focus-visible can't tell these apart: Chromium turns
// it on for the focused element as soon as any key is pressed.)
let clickedElement = null; // last element pressed with the pointer; Tab clears it

const isKeyboardFocusedSlider = (target) =>
  target.tagName === "INPUT" && target.type === "range" && target !== clickedElement;

function handleShortcutKey(event) {
  if (loading || isTextField(event.target)) return;
  if (event.code.startsWith("Arrow") && isKeyboardFocusedSlider(event.target)) return;

  const shortcut = findShortcut(event);
  if (!shortcut) return;

  // Also stops e.g. Space from clicking a focused button.
  event.preventDefault();

  const handler = event.type === "keydown" ? shortcut.down : shortcut.up;
  if (!handler || !hasAudio()) return;
  if (event.type === "keydown" && event.repeat && !shortcut.repeat) return;

  guarded(handler)(event);
}

function renderShortcutLegend() {
  for (const shortcut of SHORTCUTS) {
    const item = element("li");
    if (shortcut.shift) item.append(element("kbd", {}, "Shift"), "+");
    shortcut.keys.forEach((key, i) => {
      if (i > 0) item.append("/");
      item.append(element("kbd", {}, key));
    });
    item.append(shortcut.description);
    dom.shortcutList.append(item);
  }
}

function bindShortcuts() {
  window.addEventListener("pointerdown", (event) => (clickedElement = event.target), { capture: true });
  window.addEventListener("keydown", (event) => event.key === "Tab" && (clickedElement = null), { capture: true });
  window.addEventListener("keydown", handleShortcutKey);
  window.addEventListener("keyup", handleShortcutKey);

  // Key releases are missed while the window is unfocused.
  window.addEventListener("blur", () => {
    for (const code of [...heldKeys]) guarded(releaseHold)({ code, timeStamp: performance.now() });
  });
}

/* =====================================================================
 * 14. STARTUP
 * ===================================================================== */

function start() {
  // Warm up so the first file opens faster: start the audio engine (which
  // compiles the Signalsmith worklet) and fetch the waveform and video code
  // now. Failures are reported when a file is opened, which retries them.
  engine.init().catch((error) => console.warn("Audio engine warm-up failed:", error));
  waveform.preload().catch((error) => console.warn("Waveform warm-up failed:", error));
  videoView.preload().catch((error) => console.warn("Video warm-up failed:", error));

  buildSpeedChips();
  buildScales();
  buildEqFaders();
  renderShortcutLegend();

  initSliders();
  setEqEnabled(settings.eqEnabled);
  renderTransportState(transport.state);
  renderTrackTime(0);
  renderStepSize();

  bindControls();
  bindFileInput();
  bindFileDrop();
  bindShortcuts();
  dom.welcomeOpen.focus();
}

start();
