// Every tunable number lives here. Sliders, presets, EQ bands and step
// sizes are generated from it (see the header of app.js).
export const CONFIG = {
  speed: {
    min: 0.05,
    max: 3,
    step: 0.01,
    initial: 1,
    nudge: 0.01, // Shift+, / Shift+. slow down / speed up by this much
    presets: [0.1, 0.25, 0.35, 0.4, 0.45, 0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1],
  },
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
    // (see core/media.js findJoin and docs/diagnostics/long-file-loading.md).
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
    // Ready points (video/view.js): the loop start, the start point and the
    // nearest marks each get a decoder waiting there, so a jump there is
    // sharp at once. At most `max` of them; one gets ready while the sharp
    // decoding is idle and playback isn't behind by `pauseWhenBehindSeconds`,
    // looking again every `waitMs` meanwhile.
    // Points closer than `sameSeconds` share a decoder (a jump that far past
    // its frame shows it, then decodes on to the exact one).
    // Each waiting decoder holds about `heldFrames` decoded frames (measured
    // 2026-10-27: ~50 at 1080p, ~31 at 4K, H.264), so together they get at
    // most `maxBytes`, and at most `maxMemoryShare` of the memory free when
    // the video opens: 4 at 1080p, 1 at 4K, none at 8K (video/ready-budget.js).
    readyPoints: {
      max: 4,
      heldFrames: 48,
      maxBytes: 640e6,
      maxMemoryShare: 0.15,
      sameSeconds: 0.05,
      pauseWhenBehindSeconds: 0.1,
      waitMs: 20,
    },
    // The video worker's clock (video/video-worker.js): between the page's
    // positions it moves on by itself, at the rate measured over at least
    // rateWindowMs, for at most maxAheadMs past the latest (if the page
    // stops sending them, the picture stops there).
    clock: { rateWindowMs: 100, maxAheadMs: 250 },
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
      // A frame asked for where the proxy isn't built yet moves the building
      // there, starting this many seconds before it, so small steps back
      // are covered too (see video/proxy.js).
      leadSeconds: 5,
      // Builders at once (at most half the CPU threads): each re-encodes
      // its own part of the video, so the whole of it is ready sooner.
      builders: 3,
      // A coarse overview built first, while the file loads: one frame per
      // keyframe of the video (cheap: keyframes decode on their own), so
      // dragging anywhere shows a picture at once, off by up to one
      // keyframe gap, before the proxy reaches there.
      overview: {
        spacingSeconds: 1, // at most one frame per this many seconds
        maxFrames: 1500, // and this many in all (wider spacing on long videos)
        waitMs: 3000, // loading waits this long at most, after the sound
        bitrate: 80_000, // bits per frame; ≈ 10 KB each
      },
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

  beats: {
    // The beat lines over the waveform (B; features/beats.js) are hidden
    // when zoomed out so far that beats are closer than this.
    minSpacingPx: 5,
    // The click on each beat (Settings › General): a short decaying sine,
    // higher on the first beat of each bar.
    click: { frequency: 1500, accentFrequency: 2200, level: 0.5, seconds: 0.04 },
    // Clicks are put on the audio clock this far ahead, topped up this often.
    clickLookaheadSeconds: 0.12,
    clickTickMs: 25,
    // While the beat lines show, loop edges and marks snap to a beat this
    // close: dragged, within this many pixels; set by a key ([ ] M R),
    // within this share of a beat.
    snapPx: 8,
    snapKeyFraction: 0.25,
    // A project's edits to the beats found (core/beat-edits.js, the ♩ menu),
    // as they start for a new track: bars and the steady grid on, nothing else.
    edits: { bars: true, steady: true, tempo: 1, subdivide: 1, barShift: 0 },
    // The steady grid: the local beat is the median gap over `periodBeats`
    // beats; a beat closer than `dropBelow` of it to the one before is a
    // stray; a gap within `fillTolerance` of a whole number of beats (up to
    // `maxFill`) is filled; a bar start closer than `barDropBelow` of the
    // median bar to the one before isn't one.
    steady: { periodBeats: 32, dropBelow: 0.6, fillTolerance: 0.2, maxFill: 16, barDropBelow: 0.6 },
    // Subdivision lines (the ♩ menu) are hidden when closer than this.
    minSubdivisionSpacingPx: 7,
    // How far "Move bar start" can go, in beats, either way.
    maxBarShift: 16,
    // Finding the beats: this many workers prepare the model's input
    // (audio/beat-worker.js), a window each, keeping ahead of the model.
    // More prepare faster, but share the CPU with the model, which uses 4
    // threads itself.
    prepareWorkers: 2,
    // A worker that hasn't opened the file by then counts as failed, so a
    // search never hangs at 0 % (audio/beat-input.js).
    startTimeoutMs: 30_000,
  },

  // The notifications (ui/toast.js): how long one shows, and how many at
  // once (a new one pushes out the oldest).
  notifications: { showMs: 4000, max: 3 },
};
