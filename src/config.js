// Every tunable number lives here. Sliders, presets, EQ bands and step
// sizes are generated from it (see the header of app.js).
export const CONFIG = {
  speed: { min: 0.25, max: 3, step: 0.01, initial: 1, presets: [0.25, 0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1] },
  volume: { min: 0, max: 200, step: 1, initial: 100 }, // percent
  semitones: { min: -12, max: 12, step: 1, initial: 0 },
  cents: { min: -50, max: 50, step: 1, initial: 0 },

  eq: {
    gain: { min: -24, max: 24, step: 0.1, initial: 0 }, // dB, per band
    enabledInitially: false,
    // `id` is also the fader's element id; its readout is `${id}Value`.
    bands: [
      { id: "eqLow", label: "Low", type: "lowshelf", frequency: 120 },
      { id: "eqLowMid", label: "Lo-mid", type: "peaking", frequency: 400, Q: 1 },
      { id: "eqMid", label: "Mid", type: "peaking", frequency: 1000, Q: 1 },
      { id: "eqHighMid", label: "Hi-mid", type: "peaking", frequency: 3000, Q: 1 },
      { id: "eqHigh", label: "High", type: "highshelf", frequency: 6000 },
    ],
  },

  // Step sizes (seconds) for ← / → and the step buttons; ↑ / ↓ pick one.
  // Holding ← / → repeats the step, which makes it a rewind / fast-forward.
  step: { sizes: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10], initial: 1 },

  loop: {
    // Shortest A–B loop; a Shift+drag shorter than this is a plain click.
    minSeconds: 0.05,
    // Pointer distance (CSS px) from a loop edge that grabs the edge.
    edgeGrabPx: 6,
  },

  audio: {
    // Smoothing for volume and EQ changes, so they don't click.
    paramRampSeconds: 0.015,
    // Brick-wall limiter that stops volume > 100% and EQ boosts clipping.
    limiter: { threshold: -1, knee: 0, ratio: 20, attack: 0.002, release: 0.1 },
  },

  // Largest file that can be opened: the audio decoder reads the whole
  // file into memory, video included.
  maxFileBytes: 2 * 1024 ** 3,

  video: {
    // Files treated as video (also anything with a video/* type).
    extensions: ["mp4", "m4v", "mov", "webm", "mkv", "ogv"],
    // If decoding falls this far behind playback (heavy file at high
    // speed), restart decoding at the current position instead of lagging.
    maxLagSeconds: 0.5,
    // Low-resolution proxy: a small copy of the video, encoded in the
    // background after it loads. Its frames are cheap to decode anywhere,
    // so it fills in at full frame rate (blurry) wherever the sharp frame
    // still needs decoding: distant seeks, dragging, catching up after a
    // jump during playback.
    proxy: {
      width: 320, // px; height follows the video's aspect ratio
      maxFps: 30, // higher frame rates are thinned to this
      keyframeInterval: 15, // frames; seeking decodes at most this many
      bitrate: 400_000, // bits/s; ≈ 3 MB per minute of video
      // The proxy is only used when the sharp picture is at least this far
      // from where it should be, so normal playback never shows it.
      useWhenOffBySeconds: 0.15,
      // After a seek, sharp decoding waits this long (or until the proxy
      // frame is on screen) so the proxy, not the busy sharp decoder, gets
      // the CPU first and the picture responds at once.
      headStartMs: 60,
    },
  },

  waveform: {
    // How far in Ctrl + mouse wheel can zoom, relative to fit-to-width.
    maxZoomMultiplier: 32,
    // Peaks per second of audio in the drawing: enough for 2 per pixel at
    // maximum zoom on the widest possible window, within these limits.
    minPeaksPerSecond: 50,
    maxPeaksPerSecond: 8000,
  },
};
