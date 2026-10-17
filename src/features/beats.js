/* =====================================================================
 * BEATS
 * Finding the open track's beats, on demand (the ♩ chip or B): the work is
 * done by audio/beat-worker.js (the algorithm is core/beats.js). Once
 * found, they're drawn as faint lines over the waveform (timeline.js),
 * the chip shows the tempo, and the step size becomes "1 beat", so ← / →
 * go from beat to beat (features/playback.js). The chip or B then shows
 * or hides the lines. A new file forgets them (resetBeats); they aren't
 * saved in projects yet.
 * ===================================================================== */

import { CONFIG } from "../config.js";
import { beats, player, settings } from "../context.js";
import { setStepSize } from "../ui/controls.js";
import { dom, onClick, renderBeatInfo, showNotice } from "../ui/dom.js";

/** @type {import("../core/media.js").Media | null} */
let media = null; // the open track's, to read again
let worker = null; // while finding

// Why finding them failed, by the worker's error kind (decode-worker.js).
const FAILURES = {
  "cannot-decode": "its format can't be read for that",
  "no-audio": "it has no sound",
  "out-of-memory": "there isn't enough memory",
};

function stopWorker() {
  worker?.terminate();
  worker = null;
}

function show() {
  player.timeline.setBeats(beats.shown ? beats.times : null);
  renderBeatInfo();
}

function find() {
  if (!media) return;
  stopWorker();
  Object.assign(beats, { status: "finding", progress: 0 });
  renderBeatInfo();
  const name = media.name;
  const mine = new Worker(new URL("../audio/beat-worker.js", import.meta.url), { type: "module" });
  worker = mine;

  const fail = (reason) => {
    stopWorker();
    beats.status = "idle";
    renderBeatInfo();
    showNotice(`Couldn't find the beats in “${name}”: ${reason}.`);
  };
  mine.onmessage = ({ data }) => {
    if (worker !== mine) return; // stopped meanwhile
    if (data.type === "progress") {
      beats.progress = data.fraction;
      renderBeatInfo();
    } else if (data.type === "done") {
      stopWorker();
      if (data.bpm === null) {
        beats.status = "none";
        renderBeatInfo();
        showNotice(`No steady beat was found in “${name}”.`);
        return;
      }
      Object.assign(beats, { status: "found", times: data.beats, bpm: data.bpm, shown: true });
      setStepSize("beat");
      show();
    } else if (data.type === "error") {
      fail(FAILURES[data.kind] ?? data.message);
    }
  };
  mine.onerror = (event) => {
    if (worker === mine) fail(event.message || "something went wrong");
  };
  mine.postMessage({ type: "detect", media });
}

// The chip or B: find the beats; while finding, stop; once found, show or
// hide their lines.
export function beatsAction() {
  if (beats.status === "idle") find();
  else if (beats.status === "finding") resetBeats(media);
  else if (beats.status === "found") {
    beats.shown = !beats.shown;
    show();
  }
}

/**
 * A new track (or none): forgets the beats, and remembers `media` to find
 * its beats in. A step size of "1 beat" goes back to the default.
 * @param {import("../core/media.js").Media | null} next
 */
export function resetBeats(next) {
  stopWorker();
  media = next;
  Object.assign(beats, { status: "idle", progress: 0, times: null, bpm: null, shown: true });
  if (settings.stepSize === "beat") setStepSize(CONFIG.step.initial);
  show();
}

export function bindBeats() {
  onClick(dom.beatInfo, beatsAction);
}
