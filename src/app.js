// @ts-check
/* =====================================================================
 * TranscriBee: the page's entry point. Read this first.
 *
 * A music-transcription player: open a song or a video, slow it down,
 * shift its pitch, EQ it, and step through it with the keyboard.
 *
 * HOW IT FITS TOGETHER
 *
 *   user input ─► bindings ─► actions ─► transport ─► engine ─► speakers
 *                                │                      ▲
 *                                └─► setSetting() ──────┘
 *   transport.on("position" | "state" | "jump") ─► waveform, video, UI
 *
 *   engine     Web Audio graph: Signalsmith (speed + pitch) → EQ → volume
 *              → limiter, in a context at the open track's sample rate; it
 *              plays the track from several pieces, one after the other.
 *              Knows nothing about the UI or `settings`.
 *   decoder    A file's audio, decoded in chunks in Workers (Mediabunny +
 *              WebCodecs) straight into Float32Arrays, with the waveform
 *              peaks; progress and Cancel. A long track is split into parts
 *              decoded at once (one per spare core, up to 4), joined where
 *              their samples match. Never the whole file in memory, so
 *              hour-long files open (see docs/diagnostics/long-file-loading.md).
 *   transport  Playback state and position. Mirrors Signalsmith's timeline,
 *              so the position of what is being heard is computed exactly.
 *   waveform   WaveSurfer drawing, zoom, minimap and the A–B loop region.
 *              Never plays audio.
 *   video      Frame-exact picture for video files: decodes frames itself
 *              (Mediabunny + WebCodecs) and draws the frame at the transport
 *              position. No second clock, so it can't drift from the audio.
 *   settings   The single copy of every user setting (plain values).
 *
 *   Until the first file loads, a welcome screen (#welcome) stands in for
 *   the player (#app); showPlayer() swaps them once. The first load shows a
 *   loading screen (#loadingScreen) in their place; later loads an overlay
 *   over the player (setLoading in ui/dom.js).
 *
 *   Links (YouTube) are downloaded by the main process
 *   (electron/downloader.js), reached through window.transcribee
 *   (electron/preload.js). The page shows the progress, then opens the
 *   downloaded file like any other (features/download.js), reading it from
 *   disk by a private URL (electron/media-files.js), never whole.
 *
 * FILES (src/), in layers: a file imports only from layers above it in
 * this list, never below (enforced by `npm run lint`)
 *   core/          Pure helpers, no DOM: format, peaks, timeline (and the
 *                  Segment / Loop / LoopRegion types), emitter, files (and
 *                  the Media type), errors, memory, parts (splitting and
 *                  joining a parallel decode)
 *   themes/        Colour themes: palettes and pure logic; independent of
 *                  everything else (the main process uses it too)
 *   config.js      CONFIG: every tunable number
 *   audio/         engine.js, transport.js, decoder.js (+ decode-worker.js)
 *   video/         view.js (the picture), proxy.js (low-res copy for seeking)
 *   waveform.js    The waveform, zoom, minimap, loop drawing and dragging
 *   context.js     `settings`, and `player`: the components above, once created
 *   ui/            dom.js (elements, messages, rendering, loading screens),
 *                  controls.js (sliders, chips, EQ), shortcuts.js (key
 *                  handling), theme.js (applying a theme)
 *   features/      playback.js, loop.js, open-file.js, download.js,
 *                  theme-picker.js
 *   app.js         This file: creates and wires the components, the
 *                  SHORTCUTS table, start()
 *   vendor/        Signalsmith Stretch, patched to read across several
 *                  buffers (see its README.md); imported by audio/engine.js
 *
 * COMMON CHANGES
 *   Speed preset or EQ band   Edit CONFIG.speed.presets / CONFIG.eq.bands.
 *                             The buttons and faders are generated.
 *   Step sizes (← / →)        Edit CONFIG.step.sizes (↑ / ↓ cycle through them).
 *   Slider range or default   Edit CONFIG. Sliders get min/max/step from it,
 *                             and the scale labels under them are generated.
 *   New slider setting        Add a range to CONFIG, a value to `settings`
 *                             (context.js), an entry to SLIDERS
 *                             (ui/controls.js), and an <input type="range">
 *                             plus readout to index.html.
 *   New keyboard shortcut     Add an entry to SHORTCUTS (below); the legend
 *                             at the bottom of the window updates itself.
 *   Colours and fonts         Tokens at the top of style.css (the waveform
 *                             reads its colours from there too). Colours
 *                             come from the theme (src/themes); the :root
 *                             values are the default theme's.
 *   New colour theme          Add a file in src/themes/palettes/ and list it
 *                             in THEMES (src/themes/index.js); the unit tests
 *                             check it's complete and readable.
 *   Video file types          CONFIG.video.extensions (also anything with a
 *                             video/* type). Codecs are whatever WebCodecs
 *                             decodes: H.264, VP8/VP9, AV1; not HEVC here.
 *   A new view that follows   Subscribe to transport.on("position"/"state"/
 *   playback                  "jump") below, like the waveform and video.
 *   A–B loop                  State and actions in features/loop.js; audio
 *                             looping in audio/transport.js, drawing and
 *                             dragging in waveform.js.
 *   Opening files             features/open-file.js (loadMediaFile: the order
 *                             of a load, the memory check, error wording);
 *                             decoding in audio/decoder.js; how many parts
 *                             and how they join in CONFIG.audio.parallel.
 *                             Measure long files with `npm run
 *                             diagnose:loading` (its "seams" runs compare a
 *                             parallel decode with a one-part one).
 *   A new feature             A file in features/ with a bind…() function,
 *                             called from start() below.
 *   Any change                Run `npm run check` and `npm test` (unit tests
 *                             alone: `npm run test:unit`), and record it in
 *                             CHANGELOG.md (what, why, how, where), so the
 *                             next person or LLM can follow.
 * ===================================================================== */

import { createAudioEngine } from "./audio/engine.js";
import { createTransport } from "./audio/transport.js";
import { player, settings, totalSemitones } from "./context.js";
import { bindDownloads } from "./features/download.js";
import { setLoopEnd, setLoopRegion, setLoopStart, toggleLoop, clearLoop } from "./features/loop.js";
import { bindFileDrop, bindFileInput, bindLoadCancel, isLoading } from "./features/open-file.js";
import { bindThemePicker, isThemeMenuOpen, loadThemePrefs } from "./features/theme-picker.js";
import {
  bindPlayback,
  bindTransportButtons,
  holdToPlay,
  releaseHold,
  replayOrPause,
  stepBack,
  stepForward,
  stop,
  togglePlay,
} from "./features/playback.js";
import {
  bindSettingControls,
  buildEqFaders,
  buildScales,
  buildSpeedChips,
  changeStepSize,
  initSliders,
  setEqEnabled,
} from "./ui/controls.js";
import { $, dom, renderStepSize, renderTrackTime, renderTransportState, reportError, showNotice } from "./ui/dom.js";
import { bindShortcuts, renderShortcutLegend } from "./ui/shortcuts.js";
import { onThemeChange, setThemePrefs } from "./ui/theme.js";
import { createVideoView } from "./video/view.js";
import { createWaveform } from "./waveform.js";

/** @typedef {import("./ui/shortcuts.js").Shortcut} Shortcut */

// The colour theme first, before anything is drawn (the preload has
// normally applied it already; see ui/theme.js).
setThemePrefs(loadThemePrefs());

/* =====================================================================
 * COMPONENTS
 * Created here, wired to each other and to the UI. Their callbacks only
 * run after startup, when everything is ready.
 * ===================================================================== */

const engine = createAudioEngine({ onError: reportError });

const transport = createTransport({
  engine,
  getRate: () => settings.speed,
  getSemitones: totalSemitones,
});

const waveform = createWaveform({
  container: $("waveform"),
  minimapContainer: $("waveform-minimap"),
  onSeek: (time) => transport.seek(time),
  onLoopChange: (loop) => setLoopRegion({ ...loop, enabled: true }),
});

const videoView = createVideoView({
  pane: $("videoPane"),
  canvas: /** @type {HTMLCanvasElement} */ ($("videoCanvas")),
  onVisibilityChange: (visible) => $("stage").classList.toggle("has-video", visible),
  onProblem: (message) => showNotice(message),
});

Object.assign(player, { engine, transport, waveform, videoView });

// The waveform draws on canvases, which don't follow the CSS colours.
onThemeChange(() => waveform.refreshColors());

// Everything that follows playback subscribes here.
transport.on("position", (time) => {
  waveform.setTime(time);
  if (transport.playing) {
    waveform.follow(time);
    videoView.advance(time);
  }
  renderTrackTime(time);
});

transport.on("state", (state) => {
  renderTransportState(state);
  if (state === "playing") videoView.start(transport.position);
  else videoView.showFrameAt(transport.position);
});

transport.on("jump", (time) => {
  waveform.resumeFollow(); // a deliberate move brings the view back to the cursor
  if (transport.playing) videoView.start(time);
  else videoView.showFrameAt(time);
});

/* =====================================================================
 * KEYBOARD SHORTCUTS
 * Modelled on the defaults of Seventh String's Transcribe!. The legend at
 * the bottom of the window is rendered from this table; how keys reach
 * it is in ui/shortcuts.js.
 * ===================================================================== */

/** @type {Shortcut[]} */
const SHORTCUTS = [
  {
    codes: ["Space"],
    keys: ["Space"],
    description: "Play / pause (replays from where you started)",
    down: replayOrPause,
  },
  { codes: ["Comma"], keys: [","], description: "Pause / resume here", down: togglePlay },
  { codes: ["Period"], keys: ["."], description: "Stop", down: stop },
  { codes: ["KeyZ", "Semicolon"], keys: ["Z", ";"], description: "Play while held", down: holdToPlay, up: releaseHold },
  { codes: ["ArrowLeft"], keys: ["←"], description: "Step back (hold to rewind)", repeat: true, down: stepBack },
  {
    codes: ["ArrowRight"],
    keys: ["→"],
    description: "Step forward (hold to fast-forward)",
    repeat: true,
    down: stepForward,
  },
  { codes: ["ArrowUp"], keys: ["↑"], description: "Larger step", down: () => changeStepSize(1) },
  { codes: ["ArrowDown"], keys: ["↓"], description: "Smaller step", down: () => changeStepSize(-1) },
  { codes: ["BracketLeft"], keys: ["["], description: "Loop start", down: setLoopStart },
  { codes: ["BracketRight"], keys: ["]"], description: "Loop end", down: setLoopEnd },
  { codes: ["KeyL"], keys: ["L"], description: "Loop on / off", down: toggleLoop },
  { codes: ["KeyL"], shift: true, keys: ["L"], description: "Clear loop", down: clearLoop },
];

/* =====================================================================
 * STARTUP
 * ===================================================================== */

function start() {
  // Warm up so the first file opens faster: start the audio engine (which
  // compiles the Signalsmith worklet) and fetch the waveform and video code
  // now. Failures are reported when a file is opened, which retries them.
  engine.init().catch((error) => console.warn("Audio engine warm-up failed:", error));
  waveform.preload().catch((error) => console.warn("Waveform warm-up failed:", error));
  videoView.preload().catch((error) => console.warn("Video warm-up failed:", error));

  buildSpeedChips();
  buildScales();
  buildEqFaders();
  renderShortcutLegend(SHORTCUTS);

  initSliders();
  setEqEnabled(settings.eqEnabled);
  renderTransportState(transport.state);
  renderTrackTime(0);
  renderStepSize();

  bindTransportButtons();
  bindSettingControls();
  bindPlayback();
  bindLoadCancel();
  bindFileInput();
  bindFileDrop();
  bindDownloads();
  bindThemePicker();
  bindShortcuts(SHORTCUTS, () => isLoading() || dom.downloadDialog.open || isThemeMenuOpen());
  dom.welcomeOpen.focus();
}

start();
