// The FFT, and the magnitude spectrum of real samples. Pure; used by the
// beat finders (core/beats.js, core/melspec.js).

/**
 * An in-place radix-2 FFT for `n` (a power of two) points: returns
 * transform(re, im), with the tables worked out once.
 * @param {number} n
 */
export function createFft(n) {
  const reversed = new Uint32Array(n);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    reversed[i] = j;
  }
  const cos = Float64Array.from({ length: n / 2 }, (_, k) => Math.cos((-2 * Math.PI * k) / n));
  const sin = Float64Array.from({ length: n / 2 }, (_, k) => Math.sin((-2 * Math.PI * k) / n));

  /**
   * @param {Float64Array} re
   * @param {Float64Array} im
   */
  return function transform(re, im) {
    for (let i = 1; i < n; i++) {
      const j = reversed[i];
      if (i < j) {
        let swap = re[i];
        re[i] = re[j];
        re[j] = swap;
        swap = im[i];
        im[i] = im[j];
        im[j] = swap;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const stride = n / size; // the twiddle table's step at this size
      for (let k = 0; k < half; k++) {
        const wRe = cos[k * stride];
        const wIm = sin[k * stride];
        for (let a = k; a < n; a += size) {
          const b = a + half;
          const tRe = re[b] * wRe - im[b] * wIm;
          const tIm = re[b] * wIm + im[b] * wRe;
          re[b] = re[a] - tRe;
          im[b] = im[a] - tIm;
          re[a] += tRe;
          im[a] += tIm;
        }
      }
    }
  };
}

/**
 * The magnitudes of the first `bins` frequencies of `n` (a power of two)
 * real samples: returns magnitudes(samples, out). A real signal's
 * spectrum comes from a complex FFT of half the length (the even samples
 * as the real parts, the odd ones as the imaginary), which halves the work.
 * @param {number} n
 * @param {number} bins At most n / 2 + 1 (up to and including the Nyquist frequency).
 */
export function createSpectrum(n, bins) {
  const half = n / 2;
  const fft = createFft(half);
  const re = new Float64Array(half);
  const im = new Float64Array(half);
  const cos = Float64Array.from({ length: half }, (_, k) => Math.cos((-2 * Math.PI * k) / n));
  const sin = Float64Array.from({ length: half }, (_, k) => Math.sin((-2 * Math.PI * k) / n));

  /**
   * @param {ArrayLike<number>} samples
   * @param {Float64Array} out
   */
  return function magnitudes(samples, out) {
    for (let m = 0; m < half; m++) {
      re[m] = samples[2 * m];
      im[m] = samples[2 * m + 1];
    }
    fft(re, im);
    // The Nyquist frequency: the even samples' sum minus the odd ones'.
    if (bins > half) out[half] = Math.abs(re[0] - im[0]);
    for (let k = 0; k < Math.min(bins, half); k++) {
      // Z[k] and the conjugate of Z[half − k] give the even samples'
      // spectrum (their mean) and the odd ones' (their difference / 2i).
      const j = k === 0 ? 0 : half - k;
      const evenRe = (re[k] + re[j]) / 2;
      const evenIm = (im[k] - im[j]) / 2;
      const oddRe = (im[k] + im[j]) / 2;
      const oddIm = -(re[k] - re[j]) / 2;
      const xRe = evenRe + cos[k] * oddRe - sin[k] * oddIm;
      const xIm = evenIm + cos[k] * oddIm + sin[k] * oddRe;
      out[k] = Math.sqrt(xRe * xRe + xIm * xIm);
    }
  };
}
