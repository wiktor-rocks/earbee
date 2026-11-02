// Splitting a whole song into stems with the stem model (models/
// htdemucs-6s.onnx, from scripts/export-stem-model.py), one 7.8 s segment
// at a time, as Demucs's apply_model does it (demucs 4.1.0: api.py,
// apply.py, with split on, shifts off): the song normalised as a whole,
// segments overlapping by a quarter, each segment's ends filled from its
// neighbours (or silence, past the song's ends), and the results blended
// with triangular weights. Pure: the model is a function passed in, so
// this runs in the utility process and in tests alike.
//
//   separate({ left, right, runModel, keep?, onProgress?, cancelled? })
//     the song at 44.1 kHz, two Float32Arrays → { stems: { [name]: [left, right] } },
//     for the stems named in `keep` (all six unless given)
//     runModel(mix) gets a segment ([1, 2, SEGMENT] as one Float32Array)
//     and resolves to the model's { spec, wave } (see the export script).
//     Stops with an error named "Cancelled" when cancelled() turns true.
//   createSeparator({ left, right, runModel, keep? })
//     → { length, starts, runSegment(index), read(from, to), keepFor(indices, margin), held() }:
//     the same, a segment at a time in any order (the stem process does
//     the loop first), the stems so far readable for any span; keepFor
//     lets go of the blend no segment still to come will touch, held()
//     says how many samples' worth is kept
//   segmentsFor(starts, length, from, to), orderOutward(starts, length, want, left)
//     which segments touch a span, and the order to do them in
const { createIspec } = require("./stft");

const RATE = 44100;
const SEGMENT = 343980; // int(39/5 * 44100): the model's segment
const STEMS = ["drums", "bass", "other", "vocals", "guitar", "piano"]; // the model's order
const HOP = 1024;
const FRAMES = Math.ceil(SEGMENT / HOP); // the spectral branch's frames
const BINS = 2 * HOP; // and bins, without the Nyquist one
const OVERLAP = 0.25;
// The blend is kept in blocks of this many samples (about 1.5 s), each
// made when a segment first adds to it, so the stem process can let go of
// the parts it has sent and won't touch again (keepFor): the page keeps
// the stems, and a whole song's blend is 52 bytes a sample (about 8 GB an
// hour).
const BLOCK = 1 << 16;

// Where each segment starts.
function segmentStarts(length) {
  const stride = Math.floor((1 - OVERLAP) * SEGMENT);
  const starts = [];
  for (let offset = 0; offset < length; offset += stride) starts.push(offset);
  return starts;
}

// The blending weight across a segment: rising from 1/half to 1 in the
// middle and falling back (apply_model's, with transition_power 1).
function triangle(length) {
  const half = length >> 1;
  const peak = length - half;
  const weight = new Float32Array(length);
  for (let i = 0; i < half; i++) weight[i] = (i + 1) / peak;
  for (let i = half; i < length; i++) weight[i] = (length - i) / peak;
  return weight;
}

// The mono mix's mean and standard deviation (unbiased, as torch.std), by
// which api.py's separate_tensor normalises the song before splitting it.
function meanAndSpread(left, right) {
  const n = left.length;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += (left[i] + right[i]) / 2;
  const mean = sum / n;
  let squares = 0;
  for (let i = 0; i < n; i++) {
    const d = (left[i] + right[i]) / 2 - mean;
    squares += d * d;
  }
  return { mean, spread: Math.sqrt(squares / Math.max(1, n - 1)) + 1e-8 };
}

/**
 * A song ready to be separated a segment at a time, in any order: the
 * segments lie on one grid (segmentStarts), each is weighted into the
 * stems as it's done, and read() gives the stems so far for any span,
 * blended from the segments done there. Once every segment is done, the
 * stems are what separate() gives (up to the order of the additions).
 * keepFor(indices, margin) keeps only the blend that the segments
 * `indices` (those still to do) add to or read, each its span ± `margin`:
 * reading anywhere else gives silence from then on.
 * @param {{
 *   left: Float32Array, right: Float32Array,
 *   runModel: (mix: Float32Array) => Promise<{ spec: Float32Array, wave: Float32Array }>,
 *   keep?: string[],
 * }} options
 */
function createSeparator({ left, right, runModel, keep = STEMS }) {
  const length = left.length;
  const { mean, spread } = meanAndSpread(left, right);
  const starts = segmentStarts(length);
  const weight = triangle(SEGMENT);
  const ispec = createIspec({ hop: HOP, frames: FRAMES, length: SEGMENT });

  // Only the stems asked for are made (their sound and their memory).
  const kept = STEMS.map((name) => keep.includes(name));
  // The blend so far, by block (BLOCK): each kept stem's left and right,
  // weighted, and the weights' sum. A block that isn't there is silence.
  /** @type {Map<number, { out: ([Float32Array, Float32Array] | null)[], weights: Float32Array }>} */
  const blocks = new Map();
  const blockAt = (b) => {
    let found = blocks.get(b);
    if (!found) {
      const out = kept.map((yes) =>
        yes ? /** @type {[Float32Array, Float32Array]} */ ([new Float32Array(BLOCK), new Float32Array(BLOCK)]) : null,
      );
      found = { out, weights: new Float32Array(BLOCK) };
      blocks.set(b, found);
    }
    return found;
  };
  // Calls visit(block, first, end, at) for each block [from, to) touches:
  // its samples first … end-1 are the song's at … (needed: made if missing).
  const eachBlock = (from, to, needed, visit) => {
    for (let b = Math.floor(from / BLOCK); b * BLOCK < to; b++) {
      const found = needed ? blockAt(b) : blocks.get(b);
      if (!found) continue;
      const at = Math.max(from, b * BLOCK);
      visit(found, at - b * BLOCK, Math.min(to, (b + 1) * BLOCK) - b * BLOCK, at);
    }
  };
  const mix = new Float32Array(2 * SEGMENT);
  const soundA = new Float32Array(SEGMENT);
  const soundB = new Float32Array(SEGMENT);
  const plane = BINS * FRAMES; // one channel's real or imaginary part

  // Segment `index`, weighted into the stems; resolves to the span it
  // changed, [from, to).
  async function runSegment(index) {
    const offset = starts[index];
    // The segment, centred on its part of the song (TensorChunk.padded):
    // a last, shorter part takes the song around it, or silence.
    const part = Math.min(SEGMENT, length - offset);
    const lead = (SEGMENT - part) >> 1;
    const from = offset - lead;
    for (let i = 0; i < SEGMENT; i++) {
      const at = from + i;
      const inside = at >= 0 && at < length;
      mix[i] = inside ? (left[at] - mean) / spread : 0;
      mix[SEGMENT + i] = inside ? (right[at] - mean) / spread : 0;
    }

    const { spec, wave } = await runModel(mix);

    // Each stem: its spectral branch as sound, plus its time branch, its
    // middle `part` samples weighted into the song (center_trim).
    for (let s = 0; s < STEMS.length; s++) {
      if (!kept[s]) continue;
      // spec is [stem][channel][real, imaginary][bin][frame]
      const base = s * 4 * plane;
      ispec(
        spec.subarray(base, base + plane),
        spec.subarray(base + plane, base + 2 * plane),
        spec.subarray(base + 2 * plane, base + 3 * plane),
        spec.subarray(base + 3 * plane, base + 4 * plane),
        soundA,
        soundB,
      );
      const waveA = (s * 2 + 0) * SEGMENT + lead;
      const waveB = (s * 2 + 1) * SEGMENT + lead;
      eachBlock(offset, offset + part, true, (found, first, end, at) => {
        const [outA, outB] = /** @type {[Float32Array, Float32Array]} */ (found.out[s]);
        for (let j = first, i = at - offset; j < end; j++, i++) {
          const w = weight[i];
          outA[j] += w * (soundA[lead + i] + wave[waveA + i]);
          outB[j] += w * (soundB[lead + i] + wave[waveB + i]);
        }
      });
    }
    eachBlock(offset, offset + part, true, (found, first, end, at) => {
      for (let j = first, i = at - offset; j < end; j++, i++) found.weights[j] += weight[i];
    });
    return { from: offset, to: offset + part };
  }

  // The stems so far over [from, to): { [name]: [left, right] }, silence
  // where no segment is done yet.
  function read(from, to) {
    const stems = {};
    for (const [s, name] of STEMS.entries()) {
      if (!kept[s]) continue;
      stems[name] = [0, 1].map((c) => {
        const samples = new Float32Array(to - from);
        eachBlock(from, to, false, (found, first, end, at) => {
          const channel = /** @type {[Float32Array, Float32Array]} */ (found.out[s])[c];
          const { weights } = found;
          for (let j = first, i = at - from; j < end; j++, i++) {
            if (weights[j] > 0) samples[i] = (channel[j] / weights[j]) * spread + mean;
          }
        });
        return samples;
      });
    }
    return stems;
  }

  // Lets go of every block that none of the segments `indices` adds to or
  // reads (its span ± `margin`).
  function keepFor(indices, margin) {
    const needed = new Set();
    for (const index of indices) {
      const { from, to } = segmentSpan(starts, length, index);
      const last = Math.floor((Math.min(length, to + margin) - 1) / BLOCK);
      for (let b = Math.floor(Math.max(0, from - margin) / BLOCK); b <= last; b++) needed.add(b);
    }
    for (const b of blocks.keys()) if (!needed.has(b)) blocks.delete(b);
  }

  return { length, starts, runSegment, read, keepFor, held: () => blocks.size * BLOCK };
}

// Segment i's part of a song `length` long: [from, to).
const segmentSpan = (starts, length, i) => ({ from: starts[i], to: Math.min(starts[i] + SEGMENT, length) });

/**
 * The segments whose parts touch [from, to), in order.
 * @param {number[]} starts
 * @param {number} length
 * @param {number} from
 * @param {number} to
 */
function segmentsFor(starts, length, from, to) {
  return starts.flatMap((_, i) => {
    const span = segmentSpan(starts, length, i);
    return span.from < to && span.to > from ? [i] : [];
  });
}

/**
 * The segments in `left` (indices), in the order to do them: those that
 * touch [from, to) first, then the rest, nearest the span's middle first.
 * @param {number[]} starts
 * @param {number} length
 * @param {{ from: number, to: number }} want
 * @param {Iterable<number>} left
 */
function orderOutward(starts, length, { from, to }, left) {
  const first = new Set(segmentsFor(starts, length, from, to));
  const middle = (from + to) / 2;
  const distance = (i) => {
    const span = segmentSpan(starts, length, i);
    return Math.abs((span.from + span.to) / 2 - middle);
  };
  return [...left].sort((a, b) => Number(first.has(b)) - Number(first.has(a)) || distance(a) - distance(b) || a - b);
}

/**
 * The whole song, every segment in order (see createSeparator).
 * @param {{
 *   left: Float32Array, right: Float32Array,
 *   runModel: (mix: Float32Array) => Promise<{ spec: Float32Array, wave: Float32Array }>,
 *   keep?: string[],
 *   onProgress?: (done: number, total: number) => void,
 *   cancelled?: () => boolean,
 * }} options
 */
async function separate({ left, right, runModel, keep = STEMS, onProgress = () => {}, cancelled = () => false }) {
  const separator = createSeparator({ left, right, runModel, keep });
  const total = separator.starts.length;
  onProgress(0, total);
  for (let index = 0; index < total; index++) {
    if (cancelled()) throw Object.assign(new Error("cancelled"), { name: "Cancelled" });
    await separator.runSegment(index);
    onProgress(index + 1, total);
  }
  return { stems: separator.read(0, separator.length) };
}

module.exports = {
  separate,
  createSeparator,
  segmentStarts,
  segmentSpan,
  segmentsFor,
  orderOutward,
  triangle,
  RATE,
  SEGMENT,
  STEMS,
  BINS,
  FRAMES,
  BLOCK,
};
