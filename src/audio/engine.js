// Pinned to 1.3.2: the transport mirrors its timeline and loop behaviour
// (see transport.js), so an upgrade needs re-checking against its source.
import SignalsmithStretch from "../../node_modules/signalsmith-stretch/SignalsmithStretch.mjs";
import { CONFIG } from "../config.js";
import { AppError } from "../core/errors.js";

/* =====================================================================
 * AUDIO ENGINE
 * Signalsmith → EQ chain → master volume → limiter → speakers.
 *
 * Exposes: init, decode, loadChannels, schedule, setVolume, setEq,
 *          now, outputDelay, resume
 * Values set before init() are remembered and applied when the graph
 * is built, so settings can change before any audio is loaded.
 * ===================================================================== */

/** @param {{ onError: (error: unknown) => void }} options */
export function createAudioEngine({ onError }) {
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

/** @typedef {ReturnType<typeof createAudioEngine>} AudioEngine */
