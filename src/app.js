// @ts-check
/* =====================================================================
 * TranscriBee: renderer script
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
 *              → limiter. Knows nothing about the UI or `settings`.
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
 *   the player (#app); showPlayer() swaps them once (§9, §11). The first
 *   load shows a loading screen (#loadingScreen) in their place; later
 *   loads an overlay over the player (setLoading, §9).
 *
 *   Links (YouTube) are downloaded by the main process: downloader.js,
 *   reached through window.transcribee (preload.js). The page shows the
 *   progress, then opens the downloaded file like any other (§11).
 *
 * SECTIONS
 *   1 Config   2 Pure helpers   3 Settings   4 Audio engine   5 Transport
 *   6 Waveform   7 Video   8 Instances   9 UI   10 Setting controls
 *   11 File loading   12 Playback actions   13 Keyboard shortcuts   14 Startup
 *
 * COMMON CHANGES
 *   Speed preset or EQ band   Edit CONFIG.speed.presets / CONFIG.eq.bands.
 *                             The buttons and faders are generated.
 *   Step sizes (← / →)        Edit CONFIG.step.sizes (↑ / ↓ cycle through them).
 *   Slider range or default   Edit CONFIG. Sliders get min/max/step from it,
 *                             and the scale labels under them are generated.
 *   New slider setting        Add a range to CONFIG, a value to `settings`,
 *                             an entry to SLIDERS (§10), and an
 *                             <input type="range"> plus readout to index.html.
 *   New keyboard shortcut     Add an entry to SHORTCUTS (§13); the legend
 *                             at the bottom of the window updates itself.
 *   Colours and fonts         Tokens at the top of style.css (the waveform
 *                             reads its colours from there too).
 *   Video file types          CONFIG.video.extensions (also anything with a
 *                             video/* type). Codecs are whatever WebCodecs
 *                             decodes: H.264, VP8/VP9, AV1; not HEVC here.
 *   A new view that follows   Subscribe to transport.on("position"/"state"/
 *   playback                  "jump") in §8, like the waveform and video.
 *   A–B loop                  State and actions in §12 (setLoopRegion);
 *                             audio looping in the transport (§5), drawing
 *                             and dragging in the waveform (§6).
 *   Any change                Run `npm run check` and `npm test`, and record
 *                             it in CHANGELOG.md (what, why, how, where), so
 *                             the next person or LLM can follow.
 * ===================================================================== */

import { createAudioEngine } from "./audio/engine.js";
import { createTransport } from "./audio/transport.js";
import { player, settings, totalSemitones } from "./context.js";
import { bindDownloads } from "./features/download.js";
import { setLoopEnd, setLoopRegion, setLoopStart, toggleLoop, clearLoop } from "./features/loop.js";
import { bindFileDrop, bindFileInput, isLoading } from "./features/open-file.js";
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
import { createVideoView } from "./video/view.js";
import { createWaveform } from "./waveform.js";

/** @typedef {import("./ui/shortcuts.js").Shortcut} Shortcut */

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
  bindFileInput();
  bindFileDrop();
  bindDownloads();
  bindShortcuts(SHORTCUTS, () => isLoading() || dom.downloadDialog.open);
  dom.welcomeOpen.focus();
}

start();
