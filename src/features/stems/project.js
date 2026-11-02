// Stems (src/features/stems/): what a project file keeps of them, as a
// section (features/project/sections.js says what a section is): the six
// stems as Opus, the mix, the rate and length they line up with, and the
// parts separated if not all of it (`covered`, spans of samples: silence
// elsewhere, where the song plays as it is; none saved means all of it),
// and for the loop alone, the samples its stems hold (`start`, `span`; none
// saved means all of the track).
//
// The Opus bytes are in the section's saved form as Uint8Arrays; the
// project file stores them after its header (src/project/format.js, its
// "blobs") and, when the project opens, hands each back as { url, size }
// to read it from. Bringing them back decodes them in the stems worker, in
// the background: the song plays at once, the stems follow.
import { CONFIG } from "../../config.js";
import { clamp } from "../../core/format.js";
import { loadStems, stemsRevision, stemsToSave, whenPrepared } from "./index.js";
import { defaultMix } from "./mix.js";
import { addSpan, coversAll } from "./spans.js";

/** @typedef {import("./spans.js").Spans} Spans */

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const { min, max } = CONFIG.stems.volume;

// A saved mix, each stem checked (missing or wrong: as untouched).
function mixFrom(saved) {
  const mix = defaultMix(CONFIG.stems.list);
  for (const { id } of CONFIG.stems.list) {
    const stem = isObject(saved) ? saved[id] : null;
    if (!isObject(stem)) continue;
    if (Number.isFinite(stem.volume)) mix[id].volume = clamp(stem.volume, min, max);
    // (Projects from before the pan have none: centred.)
    if (Number.isFinite(stem.pan)) mix[id].pan = clamp(stem.pan, CONFIG.stems.pan.min, CONFIG.stems.pan.max);
    mix[id].solo = stem.solo === true;
    mix[id].mute = stem.mute === true;
    // Folded into Other (not Other itself); projects from before: none.
    mix[id].folded = id !== "other" && stem.folded === true;
  }
  return mix;
}

// The saved parts separated, each checked (none, or none valid: all of it).
function coveredFrom(saved, length) {
  if (!Array.isArray(saved)) return /** @type {Spans} */ ([[0, length]]);
  /** @type {Spans} */
  let spans = [];
  for (const span of saved) {
    if (!Array.isArray(span) || !span.every(Number.isInteger)) continue;
    spans = addSpan(spans, clamp(span[0], 0, length), clamp(span[1], 0, length));
  }
  return spans;
}

/** @type {import("../project/sections.js").Section} */
export const stemsSection = {
  id: "stems",
  label: "the stems",
  version: 1,
  dirties: true,
  capture() {
    const saved = stemsToSave();
    if (!saved) return { stems: null };
    const { sampleRate, length, start, span, ids, audio, mix, covered } = saved;
    return {
      stems: {
        sampleRate,
        length,
        ...(span < length ? { start, span } : {}),
        codec: "opus",
        audio: Object.fromEntries(ids.map((id) => [id, audio[id]])),
        mix,
        ...(coversAll(covered, length) ? {} : { covered }),
      },
    };
  },
  // Not the bytes: whether the stems changed, and the mix.
  dirtyKey: stemsRevision,
  // New stems' copies for saving may still be being made.
  prepare: whenPrepared,
  restore(data) {
    const stems = data.stems;
    if (!stems) return;
    if (stems.codec !== "opus") throw new Error(`the stems are in a format this EarBee can't read (${stems.codec})`);
    const sampleRate = Number(stems.sampleRate);
    const length = Number(stems.length);
    if (!(sampleRate > 0 && Number.isInteger(length) && length > 0))
      throw new Error("the stems' rate or length is wrong");
    const start = stems.start ?? 0;
    const span = stems.span ?? length - start;
    if (!(Number.isInteger(start) && Number.isInteger(span) && start >= 0 && span > 0 && start + span <= length))
      throw new Error("the part the stems hold is wrong");
    const urls = {};
    for (const { id } of CONFIG.stems.list) {
      const url = stems.audio?.[id]?.url;
      if (typeof url !== "string") throw new Error(`the ${id} stem is missing`);
      urls[id] = url;
    }
    loadStems({
      sampleRate,
      length,
      start,
      span,
      urls,
      mix: mixFrom(stems.mix),
      covered: coveredFrom(stems.covered, length),
    });
  },
};
