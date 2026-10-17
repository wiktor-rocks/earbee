// Changing the sample rate of a stream of samples (for the beat model,
// which hears 22,050 Hz: core/melspec.js). Pure.
//
// A polyphase windowed-sinc resampler: the rates' ratio is reduced to
// L / M (44,100 → 22,050 is 1 / 2; 48,000 → 22,050 is 147 / 320), and
// output sample n is a weighted sum of the input around input position
// n · M / L, with one table of weights per fractional position (L of
// them). The low-pass is a Kaiser-windowed sinc just under the lower
// rate's Nyquist frequency, close to what soxr (the Python original's
// resampler) does.

// The low-pass ends this fraction of the way to the lower Nyquist
// frequency, and reaches this many zero crossings either side: tuned so
// the spectrogram's top bands (10–11 kHz, right by the cut-off) come out
// as with soxr; everything below matches anyway.
const ROLLOFF = 0.955;
const ZERO_CROSSINGS = 64;
const KAISER_BETA = 9;

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

// The zeroth-order modified Bessel function of the first kind (for the Kaiser window).
function bessel0(x) {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 50; k++) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
    if (term < sum * 1e-16) break;
  }
  return sum;
}

/**
 * A streaming resampler from `fromRate` to `toRate` (whole numbers of Hz).
 * @param {number} fromRate
 * @param {number} toRate
 */
export function createResampler(fromRate, toRate) {
  if (fromRate === toRate) {
    const chunks = [];
    return {
      /** @param {Float32Array} samples */
      push: (samples) => chunks.push(Float32Array.from(samples)),
      /** The samples received since the last take(). */
      take: () => concat(chunks.splice(0)),
      finish() {},
    };
  }

  const divisor = gcd(fromRate, toRate);
  const up = toRate / divisor; // L
  const down = fromRate / divisor; // M
  // Cycles per input sample.
  const cutoff = 0.5 * Math.min(1, up / down) * ROLLOFF;
  const reach = 2 * Math.ceil(ZERO_CROSSINGS / (4 * cutoff)); // input samples either side (even)
  const taps = 2 * reach; // a multiple of 4
  const norm = bessel0(KAISER_BETA);
  // weights[phase · taps + k] multiplies input sample base − reach + 1 + k.
  const weights = new Float32Array(up * taps);
  for (let phase = 0; phase < up; phase++) {
    const fraction = phase / up;
    let sum = 0;
    for (let k = 0; k < taps; k++) {
      const t = fraction + reach - 1 - k; // the input sample's distance from the output's position
      const x = 2 * cutoff * t;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const r = t / reach;
      const window = Math.abs(r) >= 1 ? 0 : bessel0(KAISER_BETA * Math.sqrt(1 - r * r)) / norm;
      weights[phase * taps + k] = 2 * cutoff * sinc * window;
      sum += weights[phase * taps + k];
    }
    // Exactly unity gain at 0 Hz, whatever the phase.
    for (let k = 0; k < taps; k++) weights[phase * taps + k] /= sum;
  }

  // The input not yet used up; it starts with silence before the first sample.
  let buffer = new Float32Array(1 << 16);
  let filled = reach - 1;
  let bufferStart = -(reach - 1); // the input index of buffer[0]
  let received = 0; // input samples pushed
  let produced = 0; // output samples made
  let output = [];
  let pending = new Float32Array(1 << 14);
  let pendingCount = 0;

  function emit(value) {
    if (pendingCount === pending.length) {
      output.push(pending);
      pending = new Float32Array(pending.length);
      pendingCount = 0;
    }
    pending[pendingCount++] = value;
  }

  // Makes every output sample whose input is all there (up to `limit` outputs).
  function run(limit = Infinity) {
    for (;;) {
      if (produced >= limit) break;
      const position = produced * down;
      const base = Math.floor(position / up);
      const last = base + reach; // the last input sample it needs
      if (last >= bufferStart + filled) break;
      const offset = (position % up) * taps;
      const from = base - reach + 1 - bufferStart;
      // Four running sums: the additions don't wait on each other (about
      // twice as fast as one sum).
      let a = 0;
      let b = 0;
      let c = 0;
      let d = 0;
      for (let k = 0; k < taps; k += 4) {
        a += weights[offset + k] * buffer[from + k];
        b += weights[offset + k + 1] * buffer[from + k + 1];
        c += weights[offset + k + 2] * buffer[from + k + 2];
        d += weights[offset + k + 3] * buffer[from + k + 3];
      }
      emit(a + b + c + d);
      produced++;
    }
    // Drop the input no later output needs.
    const keepFrom = Math.floor((produced * down) / up) - reach + 1 - bufferStart;
    if (keepFrom > 0) {
      buffer.copyWithin(0, keepFrom, filled);
      filled -= keepFrom;
      bufferStart += keepFrom;
    }
  }

  function append(samples) {
    if (filled + samples.length > buffer.length) {
      const grown = new Float32Array(Math.max(buffer.length * 2, filled + samples.length));
      grown.set(buffer.subarray(0, filled));
      buffer = grown;
    }
    buffer.set(samples, filled);
    filled += samples.length;
  }

  return {
    /** @param {Float32Array} samples The next input samples. */
    push(samples) {
      append(samples);
      received += samples.length;
      run();
    },
    /** The output made since the last take(). */
    take() {
      const chunks = output.splice(0);
      chunks.push(pending.slice(0, pendingCount));
      pendingCount = 0;
      return concat(chunks);
    },
    /** No more input: the last outputs, as if silence followed. */
    finish() {
      append(new Float32Array(reach + 1));
      run(Math.ceil((received * up) / down));
    },
  };
}

function concat(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Float32Array(total);
  let at = 0;
  for (const chunk of chunks) {
    result.set(chunk, at);
    at += chunk.length;
  }
  return result;
}
