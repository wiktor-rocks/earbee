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

  marks: {
    // Shortest region; R pressed twice closer together than this cancels it.
    minSeconds: 0.05,
    // Shift+← skips a mark the cursor is less than this past, so pressing
    // it again while playing keeps going back instead of returning to the
    // mark just jumped to.
    jumpBackSeconds: 0.5,
  },

  audio: {
    // Smoothing for volume and EQ changes, so they don't click.
    paramRampSeconds: 0.015,
    // Brick-wall limiter that stops volume > 100% and EQ boosts clipping.
    limiter: { threshold: -1, knee: 0, ratio: 20, attack: 0.002, release: 0.1 },
    // Rate for files the chunked decoder can't read, which decodeAudioData
    // resamples to (see audio/decoder.js).
    fallbackSampleRate: 48000,
    // A track may use at most this share of the memory the system has
    // available; a longer one is refused instead of crashing the app.
    maxMemoryShare: 0.8,
    // Decoding in parallel: a track of at least `minDuration` seconds is
    // split into one part per spare core, at most `maxWorkers` (4 decode an
    // hour of MP3 3× faster than 1; 7 are no faster than 4). Each part but
    // the first starts decoding `preRoll` seconds early, so its decoder has
    // warmed up (MP3, AAC and Opus are then sample-exact), and the parts
    // are joined where their samples match: within `maxLag` seconds of
    // where the timestamps say, over `joinWindow` frames, to `joinTolerance`
    // (see core/parts.js findJoin and docs/diagnostics/long-file-loading.md).
    parallel: {
      minDuration: 60,
      maxWorkers: 4,
      preRoll: 1,
      maxLag: 0.05,
      joinWindow: 2048,
      joinTolerance: 1e-4,
    },
  },

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
    // How far the mouse wheel can zoom in, relative to fit-to-width.
    maxZoomMultiplier: 48,
    // A newly opened file starts zoomed in to show this many seconds from
    // its start (or the whole track, if shorter), within the zoom limits.
    initialViewSeconds: 15,
    // Peaks per second of audio in the drawing: enough for 2 per pixel at
    // maximum zoom on the widest possible window, within these limits.
    minPeaksPerSecond: 50,
    maxPeaksPerSecond: 8000,
  },
};
