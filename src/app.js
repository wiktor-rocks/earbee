// @ts-check
/* =====================================================================
 * TranscriBee: the page's entry point. Read this first.
 *
 * A music-transcription player: open a song or a video, slow it down,
 * shift its pitch, EQ it, mark points and regions on it, and step through
 * it with the keyboard.
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
 *              Never plays audio. Publishes its view (zoom, scroll) for
 *              the timeline.
 *   timeline   The lanes above the waveform, where the markers live: a time
 *              ruler with the start ▶ and stop ■ points, and the marks lane;
 *              faint guide lines over the waveform, ticks on the minimap.
 *              Follows the waveform's view, so it never drifts from it.
 *   video      Frame-exact picture for video files: decodes frames itself
 *              (Mediabunny + WebCodecs) and draws the frame at the transport
 *              position. No second clock, so it can't drift from the audio.
 *   settings   The player's controls (speed, pitch, volume, EQ, step):
 *              plain values for this session, in context.js.
 *   marks      Points and regions on the open track, with a label and a
 *              colour: the store (src/marks, kept in context.js) is changed
 *              by features/marks.js, which redraws the timeline and the
 *              marks list. Session-only for now; versioned, so a TranscriBee
 *              file can save and restore them (see COMMON CHANGES).
 *   prefs      The user's Settings (theme, downloads), kept between runs by
 *              the main process (electron/prefs-store.js) and changed in the
 *              Settings dialog. Declared per section in src/prefs; the
 *              dialog and every check are generated from the declarations.
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
 *   core/          Pure helpers, no DOM: format, peaks, ruler, timeline (and the
 *                  Segment / Loop / LoopRegion types), emitter, files (and
 *                  the Media type), errors, memory, parts (splitting and
 *                  joining a parallel decode)
 *   themes/        Colour themes: palettes and pure logic; independent of
 *                  everything else (the main process uses it too)
 *   prefs/         Settings sections (sections/: theme, downloads) and the
 *                  field types; pure, shared with the main process
 *   marks/         What a mark is and its saved form (format.js), and the
 *                  store (index.js); pure
 *   config.js      CONFIG: every tunable number
 *   audio/         engine.js, transport.js, decoder.js (+ decode-worker.js)
 *   video/         view.js (the picture), proxy.js (low-res copy for seeking)
 *   waveform.js    The waveform, zoom, minimap, loop; its view for the lanes
 *   timeline.js    The lanes: ruler, start/stop points, marks; guide lines
 *   context.js     `settings`, `marks` (the open track's), and `player`: the
 *                  components above, once created
 *   ui/            dom.js (elements, messages, rendering, loading screens),
 *                  controls.js (sliders, chips, EQ), shortcuts.js (key
 *                  handling), theme.js (applying a theme), prefs.js (the
 *                  settings: values, changes, listeners), pref-fields.js
 *                  (one Settings control per field type)
 *   features/      playback.js, loop.js, marks.js (actions, selection, the
 *                  marks list), open-file.js, download.js, theme-picker.js,
 *                  settings.js (the Settings dialog), layout.js (the
 *                  shortcuts dialog)
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
 *   New keyboard shortcut     Add an entry to SHORTCUTS (below), with its
 *                             group; the shortcuts dialog (?) lists it.
 *   Layout and look           style.css: the tokens at the top (colours,
 *                             radii, shadows, --sidebar-width) and section 5
 *                             (the page's grid, the cards, the dock, and the
 *                             media queries for narrow and short windows);
 *                             icons are <symbol>s in index.html's sprite.
 *   Colours and fonts         Tokens at the top of style.css (the waveform
 *                             reads its colours from there too). Colours
 *                             come from the theme (src/themes); the :root
 *                             values are the default theme's.
 *   New setting               Add a field to its section in src/prefs/sections/
 *                             (type, label, default; see src/prefs/fields.js).
 *                             The dialog shows it and the main process checks
 *                             and saves it; read it with getPrefs(section)
 *                             and follow it with onPrefsChange (ui/prefs.js),
 *                             or in the main process with store.get /
 *                             store.onChange (electron/prefs-store.js).
 *   New settings section      A file in src/prefs/sections/ (defineSection),
 *                             listed in SECTIONS (src/prefs/index.js); the
 *                             dialog gets a tab for it.
 *   New kind of setting       An entry in TYPES (src/prefs/fields.js) and a
 *                             renderer in ui/pref-fields.js.
 *   New colour theme          Add a file in src/themes/palettes/ and list it
 *                             in THEMES (src/themes/index.js); the unit tests
 *                             check it's complete and readable.
 *   Video file types          CONFIG.video.extensions (also anything with a
 *                             video/* type). Codecs are whatever WebCodecs
 *                             decodes: H.264, VP8/VP9, AV1; not HEVC here.
 *   A new view that follows   Subscribe to transport.on("position"/"state"/
 *   playback                  "jump"/"loop") below, like the waveform and video.
 *   Where Space plays from    returnPoint and the start point (the green
 *                             line, its handle, the ▶ readout and S) in
 *                             features/playback.js; the rule that keeps
 *                             it inside the loop is transport.playStartFor.
 *                             The red stop point (where playback last
 *                             stopped) is set there too, in stop() and on
 *                             the "paused"/"ended" states.
 *   A–B loop                  State and actions in features/loop.js; audio
 *                             looping in audio/transport.js, drawing and
 *                             dragging in waveform.js.
 *   Marks                     The data in src/marks (a field: format.js's
 *                             normalizeMark and serializeMarks; bump
 *                             MARKS_VERSION if old saves read differently);
 *                             actions, keys and the list in features/marks.js;
 *                             drawing and dragging in timeline.js (renderMarks,
 *                             the marks lane's drags); sizes in CONFIG.marks.
 *   A new lane / marker       In timeline.js: a track element per lane
 *                             (moved by applyView), markers placed in
 *                             percent of it; a .timeline row in index.html.
 *   Mark colours              MARK_COLORS (src/themes/mark-colors.js), and the
 *                             --mark-* defaults in style.css; the unit tests
 *                             check each is visible on every theme.
 *   TranscriBee files         Where saving marks plugs in: marks.toJSON() to
 *   (saving marks)            save, marks.reset(duration, saved) on opening
 *                             (resetMarks, features/marks.js), and
 *                             marks.on("change") to know when to save.
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
import {
  bindMarks,
  cancelMarking,
  deleteSelectedMark,
  markPoint,
  markRegion,
  moveMark,
  nextMark,
  previousMark,
  renameMark,
  selectMark,
} from "./features/marks.js";
import { bindLayout, openShortcuts } from "./features/layout.js";
import { bindFileDrop, bindFileInput, bindLoadCancel, isLoading } from "./features/open-file.js";
import { bindSettings, isSettingsOpen } from "./features/settings.js";
import { bindThemePicker, isThemeMenuOpen } from "./features/theme-picker.js";
import {
  bindPlayback,
  bindTransportButtons,
  holdToPlay,
  releaseHold,
  replayOrPause,
  setStartPoint,
  startHere,
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
import { followThemePrefs, onThemeChange } from "./ui/theme.js";
import { createVideoView } from "./video/view.js";
import { createTimeline } from "./timeline.js";
import { createWaveform } from "./waveform.js";

/** @typedef {import("./ui/shortcuts.js").Shortcut} Shortcut */

// The colour theme first, before anything is drawn (the preload has
// normally applied it already; see ui/theme.js).
followThemePrefs();

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

// The markers' lanes above the waveform, following its zoom and scroll.
const timeline = createTimeline({
  ruler: $("ruler"),
  marksLane: $("marksLane"),
  guides: $("timelineGuides"),
  minimapContainer: $("waveform-minimap"),
  waveform,
  onSeek: (time) => transport.seek(time),
  onMarkSelect: selectMark,
  onMarkChange: moveMark,
  onMarkRename: renameMark,
  onStartPointChange: setStartPoint,
});

const videoView = createVideoView({
  pane: $("videoPane"),
  canvas: /** @type {HTMLCanvasElement} */ ($("videoCanvas")),
  onVisibilityChange: (visible) => $("stage").classList.toggle("has-video", visible),
  onProblem: (message) => showNotice(message),
});

Object.assign(player, { engine, transport, waveform, timeline, videoView });

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
 * Modelled on the defaults of Seventh String's Transcribe!. The shortcuts
 * dialog (the ? button or key) is rendered from this table; how keys reach
 * it is in ui/shortcuts.js.
 * ===================================================================== */

/** @type {Shortcut[]} */
const SHORTCUTS = [
  {
    group: "Playback",
    codes: ["Space"],
    keys: ["Space"],
    description: "Play / pause (replays from where you started)",
    down: replayOrPause,
  },
  { group: "Playback", codes: ["Comma"], keys: [","], description: "Pause / resume here", down: togglePlay },
  { group: "Playback", codes: ["KeyS"], keys: ["S"], description: "Space plays from here next time", down: startHere },
  { group: "Playback", codes: ["Period"], keys: ["."], description: "Stop", down: stop },
  {
    group: "Playback",
    codes: ["KeyZ", "Semicolon"],
    keys: ["Z", ";"],
    description: "Play while held",
    down: holdToPlay,
    up: releaseHold,
  },
  {
    group: "Moving around",
    codes: ["ArrowLeft"],
    keys: ["←"],
    description: "Step back (hold to rewind)",
    repeat: true,
    down: stepBack,
  },
  {
    group: "Moving around",
    codes: ["ArrowRight"],
    keys: ["→"],
    description: "Step forward (hold to fast-forward)",
    repeat: true,
    down: stepForward,
  },
  {
    group: "Moving around",
    codes: ["ArrowUp"],
    keys: ["↑"],
    description: "Larger step",
    down: () => changeStepSize(1),
  },
  {
    group: "Moving around",
    codes: ["ArrowDown"],
    keys: ["↓"],
    description: "Smaller step",
    down: () => changeStepSize(-1),
  },
  { group: "A–B loop", codes: ["BracketLeft"], keys: ["["], description: "Loop start", down: setLoopStart },
  { group: "A–B loop", codes: ["BracketRight"], keys: ["]"], description: "Loop end", down: setLoopEnd },
  { group: "A–B loop", codes: ["KeyL"], keys: ["L"], description: "Loop on / off", down: toggleLoop },
  { group: "A–B loop", codes: ["KeyL"], shift: true, keys: ["L"], description: "Clear loop", down: clearLoop },
  { group: "Marks", codes: ["KeyM"], keys: ["M"], description: "Mark a point", down: markPoint },
  {
    group: "Marks",
    codes: ["KeyR"],
    keys: ["R"],
    description: "Mark a region (press at its start, then its end)",
    down: markRegion,
  },
  {
    group: "Marks",
    codes: ["ArrowLeft"],
    shift: true,
    keys: ["←"],
    description: "Previous mark",
    repeat: true,
    down: previousMark,
  },
  {
    group: "Marks",
    codes: ["ArrowRight"],
    shift: true,
    keys: ["→"],
    description: "Next mark",
    repeat: true,
    down: nextMark,
  },
  {
    group: "Marks",
    codes: ["Delete", "Backspace"],
    keys: ["Delete", "Backspace"],
    description: "Delete the selected mark",
    down: deleteSelectedMark,
  },
  {
    group: "Marks",
    codes: ["Escape"],
    keys: ["Esc"],
    description: "Stop marking a region / deselect the mark",
    down: cancelMarking,
  },
  {
    group: "Help",
    codes: ["Slash"],
    shift: true,
    keys: ["?"],
    description: "Show these shortcuts",
    down: openShortcuts,
  },
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
  bindSettings();
  bindMarks();
  bindLayout();
  bindShortcuts(
    SHORTCUTS,
    () => isLoading() || dom.downloadDialog.open || isThemeMenuOpen() || isSettingsOpen() || dom.shortcutsDialog.open,
  );
  dom.welcomeOpen.focus();
}

start();
