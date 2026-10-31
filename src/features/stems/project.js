// Stems (src/features/stems/): what a project file keeps of them, as a
// section (features/project/sections.js says what a section is): the six
// stems as Opus, the mix, and the rate and length they line up with.
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

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const { min, max } = CONFIG.stems.volume;

// A saved mix, each stem checked (missing or wrong: as untouched).
function mixFrom(saved) {
  const mix = defaultMix(CONFIG.stems.list);
  for (const { id } of CONFIG.stems.list) {
    const stem = isObject(saved) ? saved[id] : null;
    if (!isObject(stem)) continue;
    if (Number.isFinite(stem.volume)) mix[id].volume = clamp(stem.volume, min, max);
    mix[id].solo = stem.solo === true;
    mix[id].mute = stem.mute === true;
  }
  return mix;
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
    const { sampleRate, length, ids, audio, mix } = saved;
    return {
      stems: {
        sampleRate,
        length,
        codec: "opus",
        audio: Object.fromEntries(ids.map((id) => [id, audio[id]])),
        mix,
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
    const urls = {};
    for (const { id } of CONFIG.stems.list) {
      const url = stems.audio?.[id]?.url;
      if (typeof url !== "string") throw new Error(`the ${id} stem is missing`);
      urls[id] = url;
    }
    loadStems({ sampleRate, length, urls, mix: mixFrom(stems.mix) });
  },
};
