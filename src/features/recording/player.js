// Recording (src/features/recording/): plays a take with the track, each
// of its samples at the moment the track renders the position it was
// played over (takes.js), so both go out through the same delay and are
// heard as they were played.
//
// A take plays as it is, at the speed it was recorded at: only while the
// track plays at that speed. Its sound is handed to the audio thread a
// little ahead (CONFIG.recording.play), a stretch at a time: up to the end
// of the loop, then from its start again, each planned before it's due, so
// a loop's next time around starts on the sample, not when the page hears
// of it. Whatever changes where the track goes (a seek, pause, the loop,
// the speed) drops what was handed over and plans again from there.
//
//   createTakePlayer({ engine, transport, getRate })
//     → { setTake(take | null), setNudge(seconds), setGain(gain), refresh() }
import { CONFIG } from "../../config.js";
import { planChunk } from "./takes.js";

/** @typedef {import("./takes.js").Take} Take */

// Whether a take recorded at `rate` lines up with the track at `speed`.
export const sameSpeed = (rate, speed) => Math.abs(rate - speed) < 1e-6;

/**
 * @param {object} deps
 * @param {import("../../audio/engine.js").AudioEngine} deps.engine
 * @param {import("../../audio/transport.js").Transport} deps.transport
 * @param {() => number} deps.getRate The speed setting.
 */
export function createTakePlayer({ engine, transport, getRate }) {
  const { ahead, tickMs, lookahead, fade } = CONFIG.recording.play;

  /** @type {Take | null} */
  let take = null;
  let nudge = 0; // seconds
  let gain = 1;
  /** @type {{ context: BaseAudioContext, buffer: AudioBuffer } | null} */
  let loaded = null; // the take's samples, in the context they play in
  /** @type {Set<{ source: AudioBufferSourceNode, envelope: GainNode }>} */
  const playing = new Set();
  // Where planning has got to: the track's `position`, rendered at `time`.
  // Null: nothing planned yet (ask the transport), or nothing more to plan.
  /** @type {{ time: number, position: number } | null} */
  let cursor = null;
  let planned = false; // planned up to the track's end: nothing more until something changes
  let rate = 0; // the speed the plan is for
  /** @type {ReturnType<typeof setInterval> | null} */
  let timer = null;

  function drop() {
    for (const { source, envelope } of playing) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // never started
      }
      source.disconnect();
      envelope.disconnect();
    }
    playing.clear();
    cursor = null;
    planned = false;
  }

  /** @param {AudioContext} context */
  function bufferIn(context) {
    if (loaded?.context !== context) {
      const buffer = context.createBuffer(1, take.samples.length, take.sampleRate);
      buffer.copyToChannel(/** @type {Float32Array<ArrayBuffer>} */ (take.samples), 0);
      loaded = { context, buffer };
      engine.takeInput().gain.value = gain; // a new context's starts at 1
    }
    return loaded.buffer;
  }

  /**
   * @param {AudioContext} context
   * @param {{ when: number, offset: number, length: number }} piece
   */
  function start(context, { when, offset, length }) {
    // Late (the page was held up): what's left of it, from now.
    const late = Math.max(0, context.currentTime - when);
    if (length - late <= 2 * fade) return;
    const at = when + late;
    const end = when + length;

    const source = context.createBufferSource();
    source.buffer = bufferIn(context);
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(1, at + fade);
    envelope.gain.setValueAtTime(1, end - fade);
    envelope.gain.linearRampToValueAtTime(0, end);
    source.connect(envelope).connect(engine.takeInput());
    source.start(at, offset + late, length - late);

    const entry = { source, envelope };
    playing.add(entry);
    source.onended = () => {
      envelope.disconnect();
      playing.delete(entry);
    };
  }

  // Plans what's due within the lookahead.
  function tick() {
    const context = engine.audioContext();
    const speed = getRate();
    const plays = take !== null && context !== null && transport.playing && sameSpeed(take.rate, speed);
    if (!plays || speed !== rate) drop();
    rate = speed;
    if (!plays || planned) return;

    const now = context.currentTime;
    cursor ??= { time: now + ahead, position: transport.positionAtOutput(now + ahead) };
    while (cursor.time < now + lookahead) {
      const { until, next, source } = planChunk(take, {
        ...cursor,
        loop: transport.loop,
        duration: transport.duration,
        nudge,
      });
      if (source) start(context, source);
      if (next === null) {
        planned = true;
        break;
      }
      cursor = { time: until, position: next };
    }
  }

  // From scratch: after anything that changes where the track goes.
  function refresh() {
    drop();
    tick();
    const run = take !== null && transport.playing;
    if (run && timer === null) timer = setInterval(tick, tickMs);
    if (!run && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  transport.on("state", refresh);
  transport.on("loop", refresh);
  // A loop's wrap-around was planned for; anything else is a seek.
  transport.on("jump", (_position, how) => {
    if (!how?.wrapped) refresh();
  });

  return {
    /** @param {Take | null} next */
    setTake(next) {
      if (next === take) return;
      take = next;
      loaded = null;
      refresh();
    },
    /** @param {number} seconds */
    setNudge(seconds) {
      if (seconds === nudge) return;
      nudge = seconds;
      refresh();
    },
    /** The take's volume (0 while muted). @param {number} value */
    setGain(value) {
      gain = value;
      const input = engine.takeInput();
      const context = engine.audioContext();
      if (input) input.gain.setTargetAtTime(gain, context.currentTime, CONFIG.audio.paramRampSeconds);
    },
    // The speed changed: at once, not at the next look.
    refresh,
  };
}
