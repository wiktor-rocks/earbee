// @ts-check
/* =====================================================================
 * EarBee: the page's entry point. Read this first.
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
 *              plain values in context.js, saved in project files (the
 *              "sound" section).
 *   marks      Points and regions on the open track, with a label and a
 *              colour: the store (src/marks, kept in context.js) is changed
 *              by features/marks.js, which redraws the timeline and the
 *              marks list. Versioned, and saved in project files.
 *   project    A project file (.ebee) saves the session: the marks, the
 *              sound settings, the loop, where you were and the zoom, and
 *              links to the song or video (or has it inside). One section
 *              per part (features/project/sections.js); the file's frame
 *              in src/project; reading and writing in the main process
 *              (electron/project-files.js). Unsaved changes show a • in the
 *              title and are asked about before they'd be lost.
 *   prefs      The user's Settings (general, theme, waveform, downloads),
 *              kept between runs by
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
 *   (electron/downloader.js), reached through window.earbee
 *   (electron/preload.js). The page shows the progress, then opens the
 *   downloaded file like any other (features/download.js), reading it from
 *   disk by a private URL (electron/media-files.js), never whole. Words
 *   instead of a link search YouTube or SoundCloud (features/download.js; the
 *   sites in src/search/sources.js), also through yt-dlp in the main
 *   process, which fetches the results' pictures too: the page never
 *   touches the network.
 *
 * FILES (src/), in layers: a file imports only from layers above it in
 * this list, never below (enforced by `npm run lint`)
 *   core/          Pure helpers, no DOM: format, waveshape (scaling the
 *                  waveform), ruler, beats (the simple beat finder,
 *                  stepping by beats), beat-this (around the beat model:
 *                  its windows, picking beats from its answers),
 *                  beat-edits (a project's edits to the beats), melspec
 *                  and resample (the model's input), fft, timeline (and the
 *                  Segment / Loop / LoopRegion types), emitter, errors,
 *                  media (the Media type, the memory check, waveform
 *                  levels, splitting and joining a parallel decode)
 *   themes/        Colour themes: palettes.js (every theme) and index.js
 *                  (the pure logic, the marks' colours); independent of
 *                  everything else (the main process uses it too)
 *   search/        Where the download dialog searches (sources.js) and what
 *                  a result is; pure, shared with the main process
 *   prefs/         Settings sections (index.js: general, theme, waveform,
 *                  downloads)
 *                  and the field types (fields.js); pure, shared with the
 *                  main process
 *   marks/         What a mark is, its saved form, and the store
 *                  (index.js); pure
 *   project/       What a project file is (format.js): its header, version
 *                  and media; pure, shared with the main process
 *   config.js      CONFIG: every tunable number
 *   audio/         engine.js, transport.js, decoder.js (+ decode-worker.js),
 *                  beat-input.js (+ beat-worker.js: the beat model's input,
 *                  window by window, and the simple beat finder's answer),
 *                  open-track.js (opening a file's audio track, for both
 *                  workers)
 *   video/         view.js (the picture, the page side), video-worker.js (its
 *                  decoding and drawing, off the page's thread), proxy.js
 *                  (low-res copy for seeking), proxy-plan.js (where that
 *                  copy is built next)
 *   waveform.js    The waveform, zoom, minimap, loop; its view for the lanes.
 *                  waveform-draw.js draws it (bars, continuous, two-tone)
 *   timeline.js    The lanes: ruler, start/stop points, marks; guide lines
 *                  (and the beats' lines)
 *   context.js     `settings`, `marks` and `beats` (the open track's), and `player`: the
 *                  components above, once created
 *   ui/            dom.js (elements, messages, rendering, loading screens),
 *                  controls.js (settings' knobs, chips, EQ), knob.js (a
 *                  knob over a slider: drag, wheel), shortcuts.js (key
 *                  handling, giving focus back), theme.js (applying a
 *                  theme), prefs.js (the settings: values, changes,
 *                  listeners), pref-fields.js (one Settings control per
 *                  field type), menu.js (popover menus), storage.js
 *                  (browser storage that never throws), toast.js
 *                  (notifications: small confirmations, notify())
 *   features/      playback.js (and the A–B loop), beats.js (finding the
 *                  beats on demand: the worker, then the beat model window
 *                  by window; the ♩ chip and its menu of edits; the
 *                  beat click), marks.js (actions,
 *                  selection, the marks list), open-file.js, download.js
 *                  (and searching in the download dialog), settings.js
 *                  (the Settings dialog and the theme menu), file-menu.js
 *                  (the File menu), layout.js (the shortcuts dialog, the
 *                  sidebar toggle), project/ (saving and opening project
 *                  files: index.js; what they save: sections.js),
 *                  video-window/ (the video in a window of its own, with
 *                  its own video-window.css; self-contained, its wiring
 *                  marked "Video window ("),
 *                  big-video.js (the picture large, the rest put away;
 *                  its wiring marked "Big video (")
 *   app.js         This file: creates and wires the components, the
 *                  SHORTCUTS table, start()
 *   vendor/        Signalsmith Stretch, patched to read across several
 *                  buffers (see its README.md); imported by audio/engine.js
 *
 * COMMON CHANGES
 *   Speed preset or EQ band   Edit CONFIG.speed.presets / CONFIG.eq.bands.
 *                             The buttons and faders are generated.
 *   Step sizes (← / →)        Edit CONFIG.step.sizes (↑ / ↓ cycle through them).
 *   Slider range or default   Edit CONFIG. Sliders and their knobs get
 *                             min/max/step from it.
 *   New slider setting        Add a range to CONFIG, a value to `settings`
 *                             (context.js), an entry to SLIDERS
 *                             (ui/controls.js), a .knob-cell (an <input
 *                             type="range"> plus readout) to index.html, and its key to
 *                             SOUND_SLIDERS (features/project/sections.js)
 *                             so project files save it.
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
 *   New setting               Add a field to its section in src/prefs/index.js
 *                             (type, label, default; see src/prefs/fields.js).
 *                             The dialog shows it and the main process checks
 *                             and saves it; read it with getPrefs(section)
 *                             and follow it with onPrefsChange (ui/prefs.js),
 *                             or in the main process with store.get /
 *                             store.onChange (electron/prefs-store.js).
 *   New settings section      A defineSection() in src/prefs/index.js,
 *                             listed in SECTIONS there; the dialog gets a
 *                             tab for it.
 *   A new notification        notify(text, detail?) from ui/toast.js, only to
 *                             confirm something worked (it may be turned off
 *                             in Settings › General); problems go to
 *                             showNotice / reportError (ui/dom.js).
 *   New kind of setting       An entry in TYPES (src/prefs/fields.js) and a
 *                             renderer in ui/pref-fields.js.
 *   New colour theme          Add one to src/themes/palettes.js and list it
 *                             in THEMES there; the unit tests
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
 *   A–B loop                  State and actions in features/playback.js; audio
 *                             looping in audio/transport.js, drawing and
 *                             dragging in waveform.js.
 *   Marks                     The data in src/marks (a field: index.js's
 *                             normalizeMark and serializeMarks; bump
 *                             MARKS_VERSION if old saves read differently);
 *                             actions, keys and the list in features/marks.js;
 *                             drawing and dragging in timeline.js (renderMarks,
 *                             the marks lane's drags); sizes in CONFIG.marks.
 *   A new lane / marker       In timeline.js: a track element per lane
 *                             (moved by applyView), markers placed in
 *                             percent of it; a .timeline row in index.html.
 *   Mark colours              MARK_COLORS (src/themes/index.js), and the
 *                             --mark-* defaults in style.css; the unit tests
 *                             check each is visible on every theme.
 *   Saving something new in   Add a section to SECTIONS (features/project/
 *   project files (.ebee)     sections.js): capture() and restore(), its own
 *                             version, and whether changing it is an unsaved
 *                             change. When its saved form changes, bump its
 *                             version and teach restore() the old one. The
 *                             file's frame (src/project/format.js) changes
 *                             rarely: then PROJECT_VERSION.
 *   A site to search          An entry in SEARCH_SOURCES (src/search/
 *                             sources.js): its yt-dlp search prefix and
 *                             hosts; check what its flat results hold first.
 *                             Settings › Downloads and the dialog list it.
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
 *
 * READ ALSO
 *   docs/glossary.md   The app's words (start point, region, Peak +
 *                      loudness, the dock…) and their names in the code.
 *   AGENTS.md          Commands, which checks for which change, the
 *                      conventions and the known pitfalls.
 * ===================================================================== */

import { createAudioEngine } from "./audio/engine.js";
import { createTransport } from "./audio/transport.js";
import { player, settings, totalSemitones } from "./context.js";
import { bindDownloads } from "./features/download.js";
import {
  bindMarks,
  cancelMarking,
  deleteSelectedMark,
  isMarkingRegion,
  markPoint,
  markRegion,
  moveMark,
  nextMark,
  previousMark,
  renameMark,
  selectMark,
} from "./features/marks.js";
import { bigVideoPictureChanged, bindBigVideo, leaveBigVideo, toggleBigVideo } from "./features/big-video.js"; // Big video (src/features/big-video.js)
import { bindLayout, openShortcuts } from "./features/layout.js";
import { beatsAction, bindBeats, isBeatMenuOpen, snapForDrag, toggleBeatClick } from "./features/beats.js";
import { bindVideoWindow, toggleVideoWindow, videoPictureChanged } from "./features/video-window/index.js"; // Video window (src/features/video-window/)
import { bindFileDrop, bindFileInput, bindLoadCancel, isLoading } from "./features/open-file.js";
import { bindProject, isSaveDialogOpen, openFile, saveProject, saveProjectAs } from "./features/project/index.js";
import { bindSettings, bindThemePicker, isSettingsOpen, isThemeMenuOpen } from "./features/settings.js";
import { bindFileMenu, isFileMenuOpen } from "./features/file-menu.js";
import {
  bindPlayback,
  bindTransportButtons,
  clearLoop,
  holdToPlay,
  loopThisBar,
  moveLoopBy,
  releaseHold,
  resizeLoopBy,
  replayFromStopOrPause,
  replayOrPause,
  setLoopEnd,
  setLoopRegion,
  setLoopStart,
  setStartPoint,
  startHere,
  stepBack,
  stepForward,
  stop,
  toggleLoop,
  togglePlay,
} from "./features/playback.js";
import {
  bindSettingControls,
  buildEqKnobs,
  buildSpeedChips,
  changeStepSize,
  initSliders,
  nudgeSpeed,
  setEqEnabled,
} from "./ui/controls.js";
import { $, dom, renderStepSize, renderTrackTime, renderTransportState, reportError, showNotice } from "./ui/dom.js";
import { bindFocus, bindShortcuts, renderShortcutLegend } from "./ui/shortcuts.js";
import { getPrefs, onPrefsChange } from "./ui/prefs.js";
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
  snap: snapForDrag,
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
  snap: snapForDrag,
});

const videoView = createVideoView({
  pane: $("videoPane"),
  canvas: /** @type {HTMLCanvasElement} */ ($("videoCanvas")),
  onVisibilityChange: (visible) => {
    $("stage").classList.toggle("has-video", visible);
    videoPictureChanged(visible); // Video window (src/features/video-window/)
    bigVideoPictureChanged(visible); // Big video (src/features/big-video.js)
  },
  onProblem: (message) => showNotice(message),
});

Object.assign(player, { engine, transport, waveform, timeline, videoView });

// The waveform draws on canvases, which don't follow the CSS colours.
onThemeChange(() => waveform.refreshColors());
// Its look follows Settings › Waveform.
waveform.setAppearance(getPrefs("waveform"));
onPrefsChange("waveform", (values) => waveform.setAppearance(values));
// How much memory sharp video jumps may use: Settings › Advanced.
videoView.setReadyLevel(getPrefs("advanced").sharpJumps);
onPrefsChange("advanced", (values) => videoView.setReadyLevel(values.sharpJumps));

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
  waveform.follow(time, { backward: !transport.playing });
  if (transport.playing) videoView.start(time);
  else videoView.showFrameAt(time);
});

/* =====================================================================
 * KEYBOARD SHORTCUTS
 * Modelled on the defaults of Seventh String's Transcribe!. The shortcuts
 * dialog (the ? button or key) is rendered from this table; how keys reach
 * it is in ui/shortcuts.js.
 * ===================================================================== */

// Esc undoes one thing at a time: a region being marked, then big video,
// then the selected mark.
function escape() {
  if (!isMarkingRegion() && leaveBigVideo()) return; // Big video (src/features/big-video.js)
  cancelMarking();
}

/** @type {Shortcut[]} */
const SHORTCUTS = [
  {
    group: "File",
    codes: ["KeyO"],
    ctrl: true,
    anytime: true,
    keys: ["O"],
    description: "Open a song, video or project",
    down: () => dom.fileInput.click(),
  },
  { group: "File", codes: ["KeyS"], ctrl: true, keys: ["S"], description: "Save the project", down: saveProject },
  {
    group: "File",
    codes: ["KeyS"],
    ctrl: true,
    shift: true,
    keys: ["S"],
    description: "Save the project as…",
    down: saveProjectAs,
  },
  {
    group: "Playback",
    codes: ["Space"],
    keys: ["Space"],
    description: "Play / pause (replays from where you started)",
    down: replayOrPause,
  },
  {
    group: "Playback",
    codes: ["Enter", "NumpadEnter"],
    keys: ["Enter", "Keypad Enter"],
    description: "Play / pause (replays from where it last stopped)",
    down: replayFromStopOrPause,
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
    group: "Playback",
    codes: ["Comma"],
    shift: true,
    keys: [","],
    description: "Slower (1 %)",
    repeat: true,
    down: () => nudgeSpeed(-1),
  },
  {
    group: "Playback",
    codes: ["Period"],
    shift: true,
    keys: ["."],
    description: "Faster (1 %)",
    repeat: true,
    down: () => nudgeSpeed(1),
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
  {
    group: "Moving around",
    codes: ["KeyB"],
    keys: ["B"],
    description: "Find the beats (← / → then step by beats); again: show / hide them",
    down: beatsAction,
  },
  {
    group: "Moving around",
    codes: ["KeyB"],
    shift: true,
    keys: ["B"],
    description: "A click on each beat, on / off",
    down: toggleBeatClick,
  },
  { group: "A–B loop", codes: ["BracketLeft"], keys: ["["], description: "Loop start", down: setLoopStart },
  { group: "A–B loop", codes: ["BracketRight"], keys: ["]"], description: "Loop end", down: setLoopEnd },
  {
    group: "A–B loop",
    codes: ["Backslash", "IntlBackslash"],
    keys: ["\\", "\\"],
    description: "Loop the bar you're in (with the beats found: B)",
    down: loopThisBar,
  },
  {
    group: "A–B loop",
    codes: ["BracketRight"],
    shift: true,
    keys: ["]"],
    description: "Next phrase: the loop moved on by its length",
    down: () => moveLoopBy(1),
  },
  {
    group: "A–B loop",
    codes: ["BracketLeft"],
    shift: true,
    keys: ["["],
    description: "Previous phrase",
    down: () => moveLoopBy(-1),
  },
  {
    group: "A–B loop",
    codes: ["Equal", "NumpadAdd"],
    keys: ["=", "+"],
    description: "Double the loop",
    down: () => resizeLoopBy(2),
  },
  {
    group: "A–B loop",
    codes: ["Minus", "NumpadSubtract"],
    keys: ["-", "−"],
    description: "Halve the loop",
    down: () => resizeLoopBy(0.5),
  },
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
    description: "Stop marking a region / leave big video / deselect the mark",
    down: escape,
  },
  // Video window (src/features/video-window/)
  {
    group: "Video",
    codes: ["KeyV"],
    keys: ["V"],
    description: "Video in its own window / back",
    down: toggleVideoWindow,
  },
  // Big video (src/features/big-video.js)
  { group: "Video", codes: ["KeyF"], keys: ["F"], description: "Big video on / off", down: toggleBigVideo },
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
  buildEqKnobs();
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
  bindFileInput(openFile);
  bindFileDrop(openFile);
  bindProject();
  bindDownloads();
  bindThemePicker();
  bindFileMenu();
  bindSettings();
  bindMarks();
  bindBeats();
  bindLayout();
  bindBigVideo(); // Big video (src/features/big-video.js)
  bindFocus();
  const keysBlocked = () =>
    isLoading() ||
    dom.downloadDialog.open ||
    isSaveDialogOpen() ||
    isThemeMenuOpen() ||
    isFileMenuOpen() ||
    isBeatMenuOpen() ||
    isSettingsOpen() ||
    dom.shortcutsDialog.open;
  bindShortcuts(SHORTCUTS, keysBlocked);
  // Video window (src/features/video-window/): the same keys there.
  bindVideoWindow({ bindKeys: (win) => (bindShortcuts(SHORTCUTS, keysBlocked, win), bindFocus(win)) });
  dom.welcomeOpen.focus();
  // The welcome screen's entrance plays once (style.css), not again when a
  // failed first file brings the screen back.
  setTimeout(() => dom.welcome.classList.add("settled"), 1000);
  // The window stays hidden behind a splash until now (electron/windows.js).
  /** @type {any} */ (window).earbee?.ready?.();
}

start();
