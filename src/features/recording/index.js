/* =====================================================================
 * RECORDING
 * Yourself recorded into the mix: a sound input (a guitar through an
 * interface, a microphone) recorded while the track plays, then played
 * back with it, as one more line in the Mixer. For practice: to hear
 * whether what you played was right, and in time. So a take has to sit
 * exactly where it was played, and nothing is monitored (you hear your
 * instrument as you play it, not through EarBee).
 *
 *   0. The input is chosen in its part of the Mixer (kept between runs;
 *      the system's default until then). Choosing one listens to it for a
 *      few seconds, the meter showing its level, to see it's the right
 *      one; the meter also moves while recording.
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
 *      newest plays; the others are in the take's list. A recording of
 *      silence (the wrong input, nothing plugged in) is said, not kept.
 *   4. The take plays with the track (player.js), through the Mixer's
 *      volume and balance but not the track's speed, pitch or EQ: as it
 *      was played. So it plays only at the speed it was recorded at; at
 *      another, it's silent and its line says so. Soloed (S), it plays
 *      without the track.
 *
 * Lining up: the delay between the track being rendered and what's played
 * along to it coming back in is the output's delay plus the input's, as
 * the system reports them. What it doesn't report is the nudge (ms, kept
 * between runs): measured by Calibrate (calibrate.js: a few clicks played
 * and found again in the input, which has to hear the output: a cable
 * from an output to the input, or a microphone at the speaker), or set by
 * ear, on a take of something sharp played on the beat.
 *
 * Loudness: an instrument straight into an interface comes in far quieter
 * than a finished song, so a take plays louder than it was recorded: its
 * recording's loudest sample brought up to CONFIG.recording.loudness.
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
import { clamp, formatDuration, formatSigned, formatSpeed, formatTrackTime } from "../../core/format.js";
import { $, reportError } from "../../ui/dom.js";
import { readStored, store } from "../../ui/storage.js";
import { notify } from "../../ui/toast.js";
import { clickDelay } from "./calibrate.js";
import { listInputs, openInput, startCapture } from "./capture.js";
import { buildRecorder } from "./dock.js";
import { createTakePlayer, sameSpeed } from "./player.js";
import { cutTakes, passes } from "./takes.js";

/** @typedef {import("./takes.js").Take & { id: number }} KeptTake */

const NUDGE_KEY = "earbee.recording.nudge";
const INPUT_KEY = "earbee.recording.input"; // the input chosen: { id, label }
const WATCH_MS = 250;

/** @type {KeptTake[]} */
let takes = []; // the open track's, oldest first
/** @type {number | null} */
let selected = null; // the one that plays
let lastId = 0;
let mix = { volume: CONFIG.recording.volume.initial, solo: false, mute: false };
let nudge = CONFIG.recording.nudge.initial; // ms
/** @type {{ id: string, label: string }[]} */
let inputs = []; // the sound inputs there are
// The one chosen ("" and no label: the system's default).
let input = { id: "", label: "" };
// Listening to the input for the meter alone, after it's chosen.
/** @type {{ stream: MediaStream, capture: Awaited<ReturnType<typeof startCapture>>, timer: ReturnType<typeof setTimeout> } | null} */
let probe = null;

/** @type {"idle" | "opening" | "recording" | "finishing" | "calibrating"} */
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
    // One that was chosen and is gone stays listed, so it's seen to be missing.
    inputs:
      input.id && !inputs.some(({ id }) => id === input.id)
        ? [...inputs, { id: input.id, label: `${input.label || "The input chosen"} (not connected)` }]
        : inputs,
    input: input.id,
  });
}

// What plays, from what's kept: no take while recording (it would be
// recorded again through a microphone, and gets in the way of playing).
function apply() {
  takePlayer.setTake(stage === "idle" ? current() : null);
  takePlayer.setNudge(nudge / 1000);
  takePlayer.setGain(mix.mute ? 0 : mix.volume);
  // Soloed, the take plays without the track: only while it is heard, so
  // a solo never leaves silence (no take, another speed, muted, recording).
  const take = current();
  const heard = stage === "idle" && take !== null && sameSpeed(take.rate, settings.speed) && !mix.mute;
  player.engine.setTrackLevel(mix.solo && heard ? 0 : 1);
  render();
}

/* ---------- The input ---------- */

// The meter, from a chunk's loudest sample: in dB, so quiet playing shows.
function showLevel(peak) {
  const { meterDb } = CONFIG.recording;
  ui?.level(clamp((20 * Math.log10(Math.max(peak, 1e-9)) + meterDb) / meterDb, 0, 1));
}

async function refreshInputs() {
  inputs = await listInputs();
  render();
}

function stopListening() {
  if (!probe) return;
  const { stream, capture, timer } = probe;
  probe = null;
  clearTimeout(timer);
  capture.stop().catch(() => {});
  for (const track of stream.getTracks()) track.stop();
  ui?.level(null);
}

// Listens to the input for a while, for the meter: is it the right one?
async function listen() {
  stopListening();
  const context = player.engine.audioContext();
  if (stage !== "idle" || !context) return;
  const stream = await openInput(input.id);
  const capture = await startCapture(context, stream, { channel: "mix", delay: 0, onLevel: showLevel, keep: false });
  const timer = setTimeout(stopListening, CONFIG.recording.listenMs);
  probe = { stream, capture, timer };
  if (stage !== "idle") stopListening(); // a recording began meanwhile
  refreshInputs().catch(reportError); // named, now that one was opened
}

async function chooseInput(id) {
  input = { id, label: inputs.find((each) => each.id === id)?.label ?? "" };
  store(INPUT_KEY, JSON.stringify(input));
  render();
  await listen();
}

/* ---------- Recording ---------- */

async function start() {
  const { engine, transport } = player;
  if (stage !== "idle" || !hasAudio()) return;
  const opened = generation;
  stopListening();
  stage = "opening";
  apply();
  /** @type {MediaStream | null} */
  let stream = null;
  /** @type {Awaited<ReturnType<typeof startCapture>> | null} */
  let capture = null;
  try {
    stream = await openInput(input.id);
    capture = await startCapture(engine.audioContext(), stream, {
      channel: "mix",
      delay: engine.outputDelay(),
      onLevel: showLevel,
    });
    refreshInputs().catch(reportError); // named, now that one was opened
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
    ui?.level(null);
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

    const { margin, minSeconds, maxTakes, silence, loudness } = CONFIG.recording;
    let peak = 0;
    for (const sample of recording.samples) peak = Math.max(peak, Math.abs(sample));
    // Silence: the wrong input, or nothing plugged into it.
    if (peak < silence) {
      const name = inputs.find(({ id }) => id === input.id)?.label ?? "the system's default input";
      notify("Nothing came in, so no take was kept", `${name} was silent. Is it the right input?`);
      return;
    }
    const cut = cutTakes(recording, passes(anchor, endTime, loop, duration), {
      rate: anchor.rate,
      margin,
      minSeconds,
      gain: Math.min(loudness.maxGain, loudness.level / peak),
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
    ui?.level(null);
    session = null;
    stage = "idle";
    apply();
  }
}

const toggle = () => (stage === "recording" ? finish() : start());

/* ---------- Calibrating ---------- */

// Plays a few clicks while the input is recorded, and sets the nudge to
// where they turn up in it, against where they would with no delay
// unreported.
async function calibrate() {
  const { engine, transport } = player;
  if (stage !== "idle" || !hasAudio()) return;
  const { clicks, gap, lead, ...find } = CONFIG.recording.calibration;
  stopListening();
  transport.pause(); // the clicks alone
  stage = "calibrating";
  apply();
  /** @type {MediaStream | null} */
  let stream = null;
  try {
    stream = await openInput(input.id);
    const capture = await startCapture(engine.audioContext(), stream, {
      channel: "mix",
      delay: engine.outputDelay(),
      onLevel: showLevel,
    });
    engine.resume()?.catch(reportError);
    const first = engine.now() + lead;
    const times = Array.from({ length: clicks }, (_, i) => first + i * gap);
    for (const at of times) engine.click(at, true);
    const wait = lead + clicks * gap + engine.outputDelay() + capture.inputDelay + CONFIG.recording.tail;
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
    const found = clickDelay(await capture.stop(), times, find);

    const { min, max } = CONFIG.recording.nudge;
    const ms = found ? Math.round(found.delay * 1000) : 0;
    if (!found) {
      notify(
        "The clicks didn't come in",
        "The input has to hear the output: a cable from an output to this input, or a microphone at the speaker.",
      );
    } else if (ms < min || ms > max) {
      notify("The delay is more than the nudge can take", `${formatSigned(ms, " ms")} was measured.`);
    } else {
      changeNudge(ms);
      const spread = Math.max(1, Math.round(found.spread * 1000));
      notify(`Nudge set to ${formatSigned(ms, " ms")}`, `${found.found} of ${clicks} clicks, within ${spread} ms.`);
    }
  } finally {
    for (const track of stream?.getTracks() ?? []) track.stop();
    ui?.level(null);
    stage = "idle";
    apply();
  }
}

// While recording, or with a take: follows what has no event of its own.
// The speed (a take plays at its own only; a change ends a recording),
// the time shown, and the limit.
function watch() {
  if (settings.speed !== speed) {
    speed = settings.speed;
    if (stage === "recording") finish().catch(reportError);
    takePlayer?.refresh();
    apply();
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
  try {
    const chosen = JSON.parse(readStored(INPUT_KEY) ?? "null");
    if (typeof chosen?.id === "string") input = { id: chosen.id, label: String(chosen.label ?? "") };
  } catch {
    // Not what was stored: the system's default.
  }

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
    onInput: chooseInput,
    onCalibrate: calibrate,
  });
  refreshInputs().catch(reportError);
  navigator.mediaDevices.addEventListener("devicechange", () => void refreshInputs().catch(reportError));
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
  mix = { volume: CONFIG.recording.volume.initial, solo: false, mute: false };
  apply();
}
