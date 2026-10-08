// How much memory a decoded track needs, and whether that fits. Pure.

// Bytes of decoded audio: one 32-bit float per sample per channel, which is
// how the time-stretcher needs it.
export const decodedBytes = (duration, sampleRate, channels) => Math.ceil(duration * sampleRate) * channels * 4;

// Leave room for the rest of the app and the system: a track may use at
// most `share` of the free memory. Unknown free memory (null) always fits.
export const fitsInMemory = (bytes, freeBytes, share = 0.8) => freeBytes == null || bytes <= freeBytes * share;
