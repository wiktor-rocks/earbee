// The last step of the stem model, done here because ONNX can't export it
// (complex numbers): turning the spectral branch's output back into sound,
// as Demucs's HTDemucs._ispec does (demucs 4.1.0: htdemucs.py, spec.py).
// Pure; checked against Demucs's own output (tests/unit/stems-stft.test.mjs,
// tests/unit/fixtures/stems-golden.json, from scripts/export-stem-model.py).
//
//   createIspec({ hop, frames, length }) → ispec(reA, imA, reB, imB, outA, outB)
//     Two channels' spectrograms in, each `2 × hop` bins (the Nyquist bin is
//     left out, as the model leaves it out) by `frames`, bin-major; `length`
//     samples of each channel's sound out. Both channels share one FFT a
//     frame: two real signals fit in one complex one.
//
// What _ispec does: two empty frames on each side, an inverse STFT (n_fft
// 4 × hop, Hann window, `normalized`, `center`), then the middle `length`
// samples, after 1.5 hops of padding.

/**
 * An in-place radix-2 FFT for `n` (a power of two) points, as
 * src/core/fft.js does it; the main process has its own copy, so the
 * feature stays in its folder.
 * @param {number} n
 */
function createFft(n) {
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
      const stride = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const wRe = cos[k * stride];
          const wIm = sin[k * stride];
          const a = start + k;
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
 * @param {{ hop: number, frames: number, length: number }} shape
 */
function createIspec({ hop, frames, length }) {
  const n = 4 * hop; // n_fft
  const bins = 2 * hop; // without the Nyquist bin, which is zero
  const padded = frames + 4; // _ispec's two empty frames on each side
  const pad = (hop >> 1) * 3;
  // torch.istft keeps `le` samples from n/2 on (center); _ispec then
  // keeps `length` of them from `pad` on.
  const first = n / 2 + pad;
  const scale = 1 / Math.sqrt(n); // `normalized`: the inverse is scaled by 1/√n, not 1/n
  const fft = createFft(n);
  const window = Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));

  // The window's overlap-added square, which the sum is divided by: the
  // same for every call, empty frames included (torch counts them too).
  const total = n + hop * (padded - 1);
  const envelope = new Float64Array(total);
  for (let j = 0; j < padded; j++) {
    for (let i = 0; i < n; i++) envelope[j * hop + i] += window[i] * window[i];
  }
  if (first + length > total) throw new Error("the spectrogram is too short for that length");

  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const sumA = new Float64Array(total);
  const sumB = new Float64Array(total);

  /**
   * @param {Float32Array} reA
   * @param {Float32Array} imA
   * @param {Float32Array} reB
   * @param {Float32Array} imB
   * @param {Float32Array} outA
   * @param {Float32Array} outB
   */
  return function ispec(reA, imA, reB, imB, outA, outB) {
    sumA.fill(0);
    sumB.fill(0);
    // Frames 0, 1, frames + 2 and frames + 3 are empty: nothing to add.
    for (let t = 0; t < frames; t++) {
      // C = A + iB over the whole circle, A and B extended as the spectra
      // of real signals (X[n - k] = conj X[k]); the DC bin's imaginary part
      // is dropped, as an inverse real FFT drops it. Conjugated, so the
      // forward FFT computes the inverse one.
      re[0] = reA[t];
      im[0] = -reB[t];
      re[bins] = 0;
      im[bins] = 0;
      for (let k = 1; k < bins; k++) {
        const at = k * frames + t;
        const aRe = reA[at];
        const aIm = imA[at];
        const bRe = reB[at];
        const bIm = imB[at];
        re[k] = aRe - bIm;
        im[k] = -(aIm + bRe);
        re[n - k] = aRe + bIm;
        im[n - k] = -(bRe - aIm);
      }
      fft(re, im);
      const offset = (t + 2) * hop;
      for (let i = 0; i < n; i++) {
        sumA[offset + i] += re[i] * window[i];
        sumB[offset + i] -= im[i] * window[i];
      }
    }
    for (let i = 0; i < length; i++) {
      const at = first + i;
      const divisor = envelope[at] / scale;
      outA[i] = sumA[at] / divisor;
      outB[i] = sumB[at] / divisor;
    }
  };
}

module.exports = { createIspec };
