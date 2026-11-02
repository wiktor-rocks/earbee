// Stems (src/features/stems/): the memory separating a song, or bringing
// back a project's stems, would take, and how much it may take, so a song
// too long for this computer is refused before anything starts (index.js).
// Pure.
//
// What a separation holds, from the code:
//   - the page: each stem's two channels in 16 bits at the track's rate,
//     twice (the player's, in the audio thread, and the page's copy, or
//     the worker's while it runs: index.js, worker.js);
//   - the stem process (electron/stems/process.js, separate.js): the
//     song's two channels at the model's 44.1 kHz in 32-bit floats, and
//     the blend around the segments still to do (a few segments' worth,
//     whatever the length: it lets go of what it has sent);
//   - and the model's working memory for one segment, whatever the length.
import { CONFIG } from "../../config.js";

const STEMS = CONFIG.stems.list.length;
const PAGE_BYTES = STEMS * 2 * 2 * 2; // per sample at the track's rate
const PROCESS_BYTES = 2 * 4; // per sample at 44.1 kHz: the song

const samples = (seconds, rate) => Math.ceil(seconds * rate);

/**
 * The page's share: the stems, twice.
 * @param {{ seconds: number, sampleRate: number }} track
 */
const pageBytes = ({ seconds, sampleRate }) => samples(seconds, sampleRate) * PAGE_BYTES;

/**
 * Separating a track of `seconds` at `sampleRate`. Carrying on ("Separate
 * the rest"), the page has its stems already: only the process's share.
 * @param {{ seconds: number, sampleRate: number, carryOn?: boolean }} track
 */
export function separationBytes({ seconds, sampleRate, carryOn = false }) {
  const { model, blend } = CONFIG.stems.memory;
  const process = samples(seconds, CONFIG.stems.sampleRate) * PROCESS_BYTES + blend + model;
  return (carryOn ? 0 : pageBytes({ seconds, sampleRate })) + process;
}

/**
 * Bringing back a project's stems: the page's share, and their Opus bytes
 * (read whole before they're decoded).
 * @param {{ seconds: number, sampleRate: number }} track
 */
export const loadingBytes = (track) => pageBytes(track) + Math.ceil((track.seconds * CONFIG.stems.bitrate * STEMS) / 8);

/**
 * The most the stems may take: a share of the memory available, or where
 * that can't be told (macOS), a smaller share of all of it. Null when
 * neither is known: nothing is refused then.
 * @param {{ available: number | null, total: number | null }} memory bytes
 * @returns {{ bytes: number, of: "available" | "total" } | null}
 */
export function memoryLimit({ available, total }) {
  const { share, totalShare } = CONFIG.stems.memory;
  if (typeof available === "number" && available > 0) return { bytes: available * share, of: "available" };
  if (typeof total === "number" && total > 0) return { bytes: total * totalShare, of: "total" };
  return null;
}
