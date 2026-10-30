// Pinned to 1.3.2: the transport mirrors its timeline and loop behaviour
// (see transport.js), so an upgrade needs re-checking against its source.
// Patched to read across several buffers (see src/vendor/signalsmith-stretch).
import SignalsmithStretch from "../vendor/signalsmith-stretch/SignalsmithStretch.mjs";
import { CONFIG } from "../config.js";
import { AppError } from "../core/errors.js";
import { butterworthQs } from "../core/focus.js";
import { clamp } from "../core/format.js";

/* =====================================================================
 * AUDIO ENGINE
 * Signalsmith → Focus (high-pass, low-pass) → EQ bands → master volume
 * → limiter → speakers.
 *
 * Exposes: init, useSampleRate, loadPieces, schedule, setVolume, setEq,
 *          setFocus, now, outputDelay, resume, click
 * Values set before init() are remembered and applied when the graph
 * is built, so settings can change before any audio is loaded.
 *
 * Signalsmith reads its buffers at the context's sample rate, so a track
 * is played by a context at the track's own rate (useSampleRate); the
 * browser converts the output to the device's rate as it plays. That
 * spares decoding a resampled copy of the whole track, which took most of
 * the load time (docs/diagnostics/long-file-loading.md).
 * ===================================================================== */

/** @param {{ onError: (error: unknown) => void }} options */
export function createAudioEngine({ onError }) {
  const { paramRampSeconds, limiter: limiterConfig } = CONFIG.audio;

  let context = null;
  let stretch = null;
  let masterGain = null;
  let initPromise = null;
  let sampleRate; // wanted context rate; undefined = the device's default
  const eqFilters = {};
  // The Focus's cuts: a chain of two-pole stages each (CONFIG.eq.focus).
  const focusFilters = { highpass: [], lowpass: [] };
  const desired = {
    volume: 1,
    eqGains: {},
    eqEnabled: false,
    focus: /** @type {{ highpass: number | null, lowpass: number | null }} */ ({ highpass: null, lowpass: null }),
  };
  // Where a Focus that cuts nothing puts its filters: the high-pass below
  // hearing, the low-pass at the Nyquist frequency, where it passes
  // everything.
  const FOCUS_FLOOR = 10;

  function rampParam(param, value) {
    param.setTargetAtTime(value, context.currentTime, paramRampSeconds);
  }

  // A disabled EQ is flat: no gains, and a Focus that cuts nothing.
  function applyEq() {
    for (const [id, filter] of Object.entries(eqFilters)) {
      rampParam(filter.gain, desired.eqEnabled ? (desired.eqGains[id] ?? 0) : 0);
    }
    const nyquist = context.sampleRate / 2;
    const cuts = desired.eqEnabled ? desired.focus : { highpass: null, lowpass: null };
    const frequencies = {
      highpass: clamp(cuts.highpass ?? FOCUS_FLOOR, FOCUS_FLOOR, nyquist),
      lowpass: clamp(cuts.lowpass ?? nyquist, FOCUS_FLOOR, nyquist),
    };
    for (const [type, filters] of Object.entries(focusFilters)) {
      for (const filter of filters) rampParam(filter.frequency, frequencies[type]);
    }
  }

  function buildGraph() {
    let node = stretch;

    const qs = butterworthQs(CONFIG.eq.focus.stages);
    for (const type of /** @type {const} */ (["highpass", "lowpass"])) {
      for (const q of qs) {
        const filter = context.createBiquadFilter();
        filter.type = type;
        filter.Q.value = q;
        filter.frequency.value = type === "highpass" ? FOCUS_FLOOR : context.sampleRate / 2;
        node.connect(filter);
        node = filter;
        focusFilters[type].push(filter);
      }
    }

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
    context = new AudioContext(sampleRate ? { sampleRate } : undefined);
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

  // Rebuilds the graph in a context at `rate` (Hz) unless it runs at that
  // rate already. Anything scheduled is gone, so the transport must load()
  // afterwards; volume and EQ carry over.
  async function useSampleRate(rate) {
    await init();
    if (context.sampleRate === rate) return;

    const old = context;
    context = stretch = masterGain = initPromise = null;
    for (const id of Object.keys(eqFilters)) delete eqFilters[id];
    for (const filters of Object.values(focusFilters)) filters.length = 0;
    await old.close();
    sampleRate = rate;
    await init();
  }

  // Signalsmith keeps a timeline of these segments; each one takes effect
  // at its `outputTime` on the AudioContext clock. The worklet's message
  // port is ordered, so calls don't need to wait for each other.
  function schedule(segment) {
    stretch?.schedule(segment).catch(onError);
  }

  // The track as pieces played one after the other ([piece][channel], see
  // audio/decoder.js); the buffers are transferred, not copied.
  async function loadPieces(pieces) {
    await stretch.dropBuffers();
    for (const channels of pieces) {
      await stretch.addBuffers(
        channels,
        channels.map((channel) => channel.buffer),
      );
    }
  }

  return {
    init,
    useSampleRate,
    schedule,
    loadPieces,
    now: () => context?.currentTime ?? 0,
    // Time from audio leaving the graph to it reaching the speakers.
    outputDelay: () => (context ? (context.baseLatency || 0) + (context.outputLatency || 0) : 0),
    resume: () => context?.resume(),

    // A short click at `at` (AudioContext clock), into the master volume,
    // so it reaches the speakers exactly as the track's sound at that
    // time does (the beat click, features/beats.js); higher if `accent`
    // (the first beat of a bar). Returns a function that cancels it.
    click(at, accent = false) {
      if (!context) return () => {};
      const { frequency, accentFrequency, level, seconds } = CONFIG.beats.click;
      const tone = context.createOscillator();
      tone.frequency.value = accent ? accentFrequency : frequency;
      const envelope = context.createGain();
      envelope.gain.setValueAtTime(level, at);
      envelope.gain.exponentialRampToValueAtTime(0.001, at + seconds);
      tone.connect(envelope).connect(masterGain);
      tone.start(at);
      tone.stop(at + seconds);
      tone.onended = () => envelope.disconnect();
      return () => {
        try {
          tone.stop(); // before `at`: it never sounds
        } catch {
          // already over
        }
      };
    },

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

    // The Focus's cutoffs in Hz (core/focus.js focusCutoffs), each null
    // for no cut on that side. Off while the EQ is.
    setFocus(cuts) {
      desired.focus = cuts;
      if (context) applyEq();
    },
  };
}

/** @typedef {ReturnType<typeof createAudioEngine>} AudioEngine */
