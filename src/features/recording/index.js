/* =====================================================================
 * RECORDING
 * Yourself recorded into the mix: a sound input (a guitar through an
 * interface, a microphone) recorded while the track plays, then played
 * back with it, as one more line in the Mixer. For practice: to hear
 * whether what you played was right, and in time. So a take has to sit
 * exactly where it was played, and nothing is monitored (you hear your
 * instrument as you play it, not through EarBee).
 *
 *   1. Record opens the input (capture.js) and starts playback if it isn't
 *      playing. The input is recorded in the player's own AudioContext, so
 *      every sample has a time on the clock the track plays by.
 *   2. Recording ends with the button again, or when playback does, or
 *      when the track stops going straight on: a seek, a change of the
 *      loop or of the speed. (A loop going around is not that.) The input
 *      is kept a moment longer, for the last notes still on their way in.
 *   3. The recording is cut into takes (takes.js): one for each time
 *      around the loop, or a single one without a loop. Each knows where
 *      on the track it starts and the speed it was recorded at. The
 *      newest plays; the others are in the take's list.
 *   4. The take plays with the track (player.js), through the Mixer's
 *      volume and balance but not the track's speed, pitch or EQ: as it
 *      was played. So it plays only at the speed it was recorded at; at
 *      another, it's silent and its line says so.
 *
 * Lining up: the delay between the track being rendered and what's played
 * along to it coming back in is the output's delay plus the input's, as
 * the system reports them. What it doesn't report is the nudge (ms, kept
 * between runs): set by ear once for an input, on a take of something
 * sharp played on the beat.
 *
 * Self-contained: this folder, its recording.css, and the lines marked
 * "Recording (" (app.js, open-file.js, index.html, config.js,
 * audio/engine.js). With CONFIG.recording.enabled off, its part of the
 * Mixer is removed and nothing else happens.
 *
 *   bindRecording()    builds the part (once, at startup)
 *   resetRecording()   a new file is open: its takes are forgotten
 * ===================================================================== */

import { CONFIG } from "../../config.js";
import { hasAudio, player, settings } from "../../context.js";
import { clamp, formatDuration, formatSpeed, formatTrackTime } from "../../core/format.js";
import { $, reportError } from "../../ui/dom.js";
import { readStored, store } from "../../ui/storage.js";
import { notify } from "../../ui/toast.js";
import { openInput, startCapture } from "./capture.js";
import { buildRecorder } from "./dock.js";
import { createTakePlayer, sameSpeed } from "./player.js";
import { cutTakes, passes } from "./takes.js";

/** @typedef {import("./takes.js").Take & { id: number }} KeptTake */

const NUDGE_KEY = "earbee.recording.nudge";
const WATCH_MS = 250;

/** @type {KeptTake[]} */
let takes = []; // the open track's, oldest first
/** @type {number | null} */
let selected = null; // the one that plays
let lastId = 0;
let mix = { volume: CONFIG.recording.volume.initial, mute: false };
let nudge = CONFIG.recording.nudge.initial; // ms

/** @type {"idle" | "opening" | "recording" | "finishing"} */
let stage = "idle";
// The recording going on: its input, what collects it, where the track
// was when it began (`anchor`, on the render clock), the loop it runs
// around, and when it began (for the time shown and the limit).
/** @type {{
 *   stream: MediaStream,
 *   capture: Awaited<ReturnType<typeof startCapture>>,
 *   anchor: { time: number, position: number, rate: number },
 *   loop: import("../../core/timeline.js").Loop | null,
 *   began: number,
 * } | null} */
let session = null;
let generation = 0; // counts the files opened, so a recording of the one before is dropped
let speed = 0; // the speed last seen (watch)

/** @type {ReturnType<typeof buildRecorder> | null} */
let ui = null;
/** @type {ReturnType<typeof createTakePlayer> | null} */
let takePlayer = null;

const current = () => takes.find(({ id }) => id === selected) ?? null;

function render() {
  const take = current();
  ui?.render({
    canRecord: hasAudio(),
    stage,
    elapsed: session ? formatDuration((performance.now() - session.began) / 1000) : "",
    takes: takes.map((each) => ({
      id: each.id,
      label: `Take ${each.id}`,
      detail: `${formatTrackTime(each.start)} · ${formatSpeed(each.rate)}`,
    })),
    selected,
    mix,
    nudge,
    note:
      take && !sameSpeed(take.rate, settings.speed)
        ? `Recorded at ${formatSpeed(take.rate)}: it plays at that speed.`
        : "",
  });
}

// What plays, from what's kept: no take while recording (it would be
// recorded again through a microphone, and gets in the way of playing).
function apply() {
  takePlayer.setTake(stage === "idle" ? current() : null);
  takePlayer.setNudge(nudge / 1000);
  takePlayer.setGain(mix.mute ? 0 : mix.volume);
  render();
}

/* ---------- Recording ---------- */

async function start() {
  const { engine, transport } = player;
  if (stage !== "idle" || !hasAudio()) return;
  const opened = generation;
  stage = "opening";
  apply();
  /** @type {MediaStream | null} */
  let stream = null;
  /** @type {Awaited<ReturnType<typeof startCapture>> | null} */
  let capture = null;
  try {
    stream = await openInput();
    capture = await startCapture(engine.audioContext(), stream, { channel: "mix", delay: engine.outputDelay() });
    if (opened !== generation) throw new Error("another file was opened meanwhile");

    if (!transport.playing) {
      engine.resume()?.catch(reportError);
      transport.play();
    }
    // Where the track is, as rendered now: what's played from here on is the recording.
    const time = engine.now();
    session = {
      stream,
      capture,
      anchor: { time, position: transport.positionAtOutput(time), rate: settings.speed },
      loop: transport.loop && { ...transport.loop },
      began: performance.now(),
    };
    stage = "recording";
    render();
  } catch (error) {
    capture?.stop().catch(() => {});
    for (const track of stream?.getTracks() ?? []) track.stop();
    stage = "idle";
    apply();
    if (opened === generation) throw error;
  }
}

// Ends the recording at this moment and keeps its takes, unless another
// file is opened meanwhile: they'd be the last one's.
async function finish() {
  if (stage !== "recording" || !session) return;
  const { engine, transport } = player;
  const { stream, capture, anchor, loop } = session;
  const endTime = engine.now();
  const duration = transport.duration;
  const opened = generation;
  stage = "finishing";
  render();

  try {
    // What was played up to now is still on its way in.
    const wait = engine.outputDelay() + capture.inputDelay + CONFIG.recording.tail;
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
    const recording = await capture.stop();
    if (opened !== generation) return;

    const { margin, minSeconds, maxTakes } = CONFIG.recording;
    const cut = cutTakes(recording, passes(anchor, endTime, loop, duration), {
      rate: anchor.rate,
      margin,
      minSeconds,
    });
    for (const take of cut) takes.push({ ...take, id: ++lastId });
    takes = takes.slice(-maxTakes);
    if (cut.length) {
      // The newest plays; around a loop, the newest whole time around (the
      // last one is usually cut short by stopping).
      const whole = loop ? (loop.end - loop.start) * 0.99 : 0;
      const kept = takes.slice(-cut.length);
      selected = (kept.findLast((take) => take.end - take.start >= whole) ?? kept.at(-1)).id;
      if (cut.length === 1) notify(`Take ${selected} recorded`);
      else notify(`${cut.length} takes recorded`, `Take ${selected} plays`);
    } else {
      notify("Nothing recorded", "It was too short to keep.");
    }
  } finally {
    for (const track of stream.getTracks()) track.stop();
    session = null;
    stage = "idle";
    apply();
  }
}

const toggle = () => (stage === "recording" ? finish() : start());

// While recording, or with a take: follows what has no event of its own.
// The speed (a take plays at its own only; a change ends a recording),
// the time shown, and the limit.
function watch() {
  if (settings.speed !== speed) {
    speed = settings.speed;
    if (stage === "recording") finish().catch(reportError);
    takePlayer?.refresh();
    render();
  }
  if (stage !== "recording") return;
  if (performance.now() - session.began > CONFIG.recording.maxSeconds * 1000) finish().catch(reportError);
  else render();
}

/* ---------- The takes ---------- */

function changeMix(change) {
  mix = { ...mix, ...change };
  apply();
}

function changeNudge(ms) {
  const { min, max } = CONFIG.recording.nudge;
  nudge = clamp(ms, min, max);
  store(NUDGE_KEY, String(nudge));
  apply();
}

function select(id) {
  selected = id;
  apply();
}

function remove(id) {
  takes = takes.filter((take) => take.id !== id);
  if (selected === id) selected = takes.at(-1)?.id ?? null;
  apply();
}

/* ---------- Wiring ---------- */

export function bindRecording() {
  const section = $("recordingSection");
  if (!CONFIG.recording.enabled || !navigator.mediaDevices?.getUserMedia) {
    section?.remove();
    return;
  }
  const stored = Number(readStored(NUDGE_KEY));
  if (Number.isFinite(stored)) nudge = clamp(stored, CONFIG.recording.nudge.min, CONFIG.recording.nudge.max);

  const { engine, transport } = player;
  takePlayer = createTakePlayer({ engine, transport, getRate: () => settings.speed });
  ui = buildRecorder(section, {
    volume: CONFIG.recording.volume,
    nudge: CONFIG.recording.nudge,
    onRecord: toggle,
    onMix: changeMix,
    onNudge: changeNudge,
    onSelect: select,
    onDelete: remove,
  });
  section.hidden = false;

  // Whatever stops the track going straight on ends the recording there.
  const end = () => void finish().catch(reportError);
  transport.on("state", (state) => {
    if (state !== "playing") end();
    render(); // "ready": a file is open
  });
  transport.on("loop", end);
  transport.on("jump", (_position, how) => {
    if (!how?.wrapped) end();
  });
  speed = settings.speed;
  setInterval(watch, WATCH_MS);
  apply();
}

/** A new file is open: the takes were the last one's. */
export function resetRecording() {
  if (!ui) return;
  generation++; // a recording going on is dropped (the track's stopping ended it)
  takes = [];
  selected = null;
  lastId = 0;
  mix = { volume: CONFIG.recording.volume.initial, mute: false };
  apply();
}
