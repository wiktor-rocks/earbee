# TranscriBee: change log

TranscriBee is an Electron app for transcribing music. You open a song or a video, slow it down, shift its pitch, EQ it, loop a passage, and step through it with the keyboard.

**Files**
- `main.js`: the Electron main process.
- `index.html` and `style.css`: the page and its look.
- `script.js`: all app logic, in one file split into numbered sections (§1 Config … §14 Startup).

The architecture overview, and a list of where to make common changes, is in the comment at the top of `script.js`. Read that first.

**How to read an entry.** Newest first, one entry per round of work. Each change records:
- **What:** the behaviour, as the user sees it.
- **Why:** the request or problem behind it.
- **How:** the mechanism, and any constraint that isn't obvious from the code.
- **Where:** `script.js` sections and function names, rather than line numbers, which drift.
- **Verified by:** how it was tested.

---

## 2026-10-08: Tidy-up

A general clean-up after the feature rounds, done in phases. Each phase leaves the tests green and is its own git commit. Apart from the items marked as deliberate changes, nothing should behave differently.

### Phase 1: Git and tests in the repository
- **What:**
  - **Git.** The project is under git, with a baseline commit of the state before any cleanup.
  - **Tests.** The end-to-end test suite (99 checks) now lives in `tests/` and runs with `npm test`. It used to live in a temporary folder outside the project.
- **Why:** a safety net before cleaning up: every change can be diffed and reverted, and every phase can be re-tested.
- **How:**
  - `.gitignore` excludes `node_modules/`, `dist/`, the generated test media and screenshots, and local assistant settings.
  - `tests/launch.cjs`:
    - generates the test media if it's missing (`tests/make-fixtures.sh`, using ffmpeg; about 6 MB, so not committed);
    - removes `ELECTRON_RUN_AS_NODE`, which VS Code's terminal sets and which would make Electron run as plain Node;
    - runs `tests/run.cjs` in Electron with a throwaway profile.
  - The header of `run.cjs` explains how the suite works: an offscreen window at 60 fps, real input events, focus emulation, the instrumentation in `preload.cjs`, all network requests blocked. It also says that a display server is required and how to add a check.
  - `TB_APP_PATH` lets the suite test another copy of the app, such as a packaged build.
- **Where:** `.gitignore`; `tests/` (`launch.cjs`, `run.cjs`, `preload.cjs`, `make-fixtures.sh`); the `test` and `test:fixtures` scripts in `package.json`.
- **Verified by:** `npm test` from a clean checkout generates the media and passes 99/99.

---

## 2026-10-08: Loading screen and stronger aura

### Stronger aura behind the logo
- **What:** the amber glow behind the bee on the welcome screen is clearly stronger.
- **Why:** the user asked for a more intense "aura".
- **How:**
  - A `.logo-aura` wrapper draws a radial glow in its `::before`: 35% alpha at the centre, out to about 2.2× the logo size.
  - The logo also gets an amber `drop-shadow`, so the glow hugs the bee's outline.
  - The page-wide background glow went from 10% to 14% alpha.
  - The same wrapper is used on the loading screen.
- **Where:** `index.html` (`.logo-aura` around both logos), `style.css` (`.logo-aura`, `.welcome-logo`, `.welcome`).

### A loading screen for the first file
- **What:**
  - **First file:** opening a file from the welcome screen swaps it for a full loading screen. It shows the bee with a **pulsing aura**, the animated equalizer bars with "Loading", and the file name.
    - If the file fails, the welcome screen comes back with the error and the Open button focused.
    - If it loads, the player appears.
  - **Later files,** opened from inside the player, keep the translucent overlay over the player (the user's choice).
- **Why:** the user didn't want an overlay over the welcome screen; loading should feel like its own screen.
- **How:**
  - **One function.** `setLoading(file)` / `setLoading(null)` replaces `setLoadingVisible`. It picks the screen form while the player has never been shown (`dom.app.hidden`), and the overlay otherwise.
  - **The player loads underneath.** During the first load, `showPlayer()` still runs before the waveform draws, because WaveSurfer measures its container when drawing. The player is therefore laid out under the opaque, fixed-position loading screen, which keeps it out of sight until `setLoading(null)` removes the screen.
  - **Errors** go to the welcome screen through `showMessage`'s existing routing (the player is still hidden), and `setLoading(null)` restores the welcome screen.
  - **Animation.** The pulse animates only `opacity` and `transform`, over 1.8 s. It is the second exception to the app's no-animations rule, after the loader bars. Like them, it needs `!important` to beat the global `animation: none !important`, and it is turned off under `prefers-reduced-motion`.
- **Where:**
  - `index.html`: `#loadingScreen`.
  - `style.css`: the "Loading screen (first file)" block, `@keyframes aura-pulse`, the reduced-motion rule.
  - `script.js`: §9 `setLoading`, `dom.loadingScreen`, `dom.loadingFileName`; §11 `openFile`; the header comment.
- **Verified by:** 6 new end-to-end checks, using an opt-in slowed decode in the test harness so the mid-load state can be observed. 99 checks in total, all passing:
  - the loading screen replaces the welcome screen, with no overlay;
  - it shows the file name and the aura pulses;
  - a failed first load returns to the welcome screen with the Open button focused;
  - a later load from the player uses the overlay, not the screen.
  - Screenshots compare the aura before and after, and show the loading screen.

---

## 2026-10-08: Welcome screen

- **What:**
  - Until a file is loaded, the window shows a welcome screen instead of an empty player. It has:
    - the bee logo over a soft amber glow;
    - the large "TranscriBee" wordmark and a tagline;
    - a dashed drop zone with an **Open audio or video…** button, "or drop a file anywhere in this window", and the main supported formats.
  - **Opening a file:**
    - The Open button has focus at startup, so Enter or Space opens the file chooser.
    - Dragging a file over the window turns the drop zone amber.
  - **Errors:** if the first file fails to load, the error appears under the drop zone and the welcome screen stays.
  - **After the first successful load,** the player replaces the welcome screen for the rest of the session. Later files are opened from the top bar, as before.
- **Why:** the user asked for a decent-looking start screen instead of a player full of disabled controls with nothing loaded.
- **How:**
  - `#welcome` and `#app` are sibling screens, and `#app` starts `hidden`. `showPlayer()` swaps them, once.
  - **Order matters:** `showPlayer()` is called in `loadMediaFile` right after the new file has decoded, *before* the waveform draws. WaveSurfer measures its container when it draws, and a hidden container measures 0 px wide. This is the same reason the video layout switch happens before drawing.
  - **Messages:** `showMessage()` writes to whichever screen's message line is visible, so `reportError`, `showNotice` and `clearMessage` work unchanged on both screens.
  - **While loading,** both screens are made `inert` under the loading overlay.
  - **Shared file input:** the welcome button calls `click()` on the existing hidden file input, so there is only one.
  - **Drag state:** the `dragging` class moved from `#app` to `body`, so both screens can react to it.
  - **CSS:** both screens set `display: grid`, which overrides the `hidden` attribute, so `.app[hidden]` and `.welcome[hidden]` restore `display: none`.
  - **Markup:** the player's `#stage` changed from `<main>` to `<div>`, so the page has one `<main>` landmark (the welcome screen).
- **Removed:** the old empty-waveform hint (`.waveform:empty::before`), which the welcome screen replaces.
- **Where:**
  - `index.html`: `#welcome`, and `#app` starting `hidden`.
  - `style.css`: the "Welcome screen" block, the `[hidden]` override and `body.dragging`.
  - `script.js`: §9 `dom.welcome*`, `showMessage`, `setLoadingVisible`, `showPlayer`; §11 `loadMediaFile`, `bindFileInput`, `bindFileDrop`; §14 `start` (focus); the header comment.
- **Verified by:** 11 new end-to-end checks, 93 in total, all passing:
  - the welcome screen shows at startup, with the logo loaded and the Open button focused;
  - the button opens the file chooser;
  - a bad first file stays on the welcome screen with a red error;
  - dragging highlights the drop zone, and leaving clears it;
  - a dropped file opens the player;
  - the waveform is drawn at full width (1166 px wrapper in a 1166 px container);
  - the welcome error doesn't carry over into the player.

---

## 2026-10-08: Bee logo after the title

- **What:** the bee logo (`transcribee.png`) sits to the right of the "TranscriBee" wordmark in the top bar. It was first placed on the left, then moved at the user's request.
- **Why:** the user asked for it.
- **How:**
  - The `.brand` element is now a flex row holding the image and the wordmark.
  - The logo is drawn at 40 × 40 px with `object-fit: contain`.
  - A negative vertical margin lets its soft glow overhang a little without making the top bar taller.
  - `alt=""`, because the wordmark next to it already names the app.
- **Where:** `index.html` (`.brand`, `.brand-logo`) and `style.css` (`.brand`, `.brand-logo`).
- **Verified by:** a screenshot of the top bar; the 82 existing checks still pass.

---

## 2026-10-08: Deeper zoom (16× → 32×)

- **What:** Ctrl + wheel can zoom in twice as far as before: 32× the fit-to-width view instead of 16×.
- **Why:** the user wanted more detail for finding exact note onsets.
- **How:**
  - One number changed: `CONFIG.waveform.maxZoomMultiplier`.
  - The waveform's peak resolution is derived from it (`peaksPerSecondFor`: 2 peaks per device pixel at maximum zoom), so the drawing stays sharp at the new depth. It is still capped at `maxPeaksPerSecond` (8000/s), which only limits very short clips.
  - Long tracks need far fewer peaks per second, so memory stays small. For example, a 10-minute song on a 4K-wide screen needs about 410 peaks per second.
- **Where:** §1 `CONFIG.waveform.maxZoomMultiplier`.
- **Verified by:** a new check that zooming all the way in reaches exactly 32× fit and zooming all the way out returns to fit. 82 checks in total, all passing.

---

## 2026-10-08: Arrow icons on the step buttons

- **What:** the step-back and step-forward buttons show ← / → arrow icons instead of the interval (e.g. "−0.25s"). The interval is shown only in the "Step … s" readout next to them. The hover titles name the arrow keys.
- **Why:** the user asked for it. The interval was shown twice, and the button width jumped as the label changed.
- **How:**
  - The icons are inline SVG in `index.html`. They use `stroke="currentColor"`, so they follow the button's text colour, including the disabled state.
  - The buttons have an `aria-label` ("Step back" / "Step forward"), since they have no text.
  - `renderSkipStep()` now updates only the readout.
- **Where:** `index.html` (`#skipBack`, `#skipForward`), `style.css` (`button .icon`), §9 `renderSkipStep`.
- **Verified by:** the step checks now expect icon buttons with no text. 81 checks in total, all passing.

---

## 2026-10-08: Wheel scrolls, Ctrl + wheel zooms

- **What:** the mouse wheel now scrolls the waveform sideways, and Ctrl + wheel zooms at the mouse. This swaps the earlier mapping. A touchpad's sideways swipe also scrolls, and a pinch zooms, because Chromium reports a pinch as Ctrl + wheel.
- **Why:** the user asked for it. Moving through the song is the more frequent action, so it gets the plain wheel.
- **How:** both the scroll and the zoom pause following during playback, as described in the next entry. Plain-wheel scrolling uses `deltaY`, or `deltaX` when that is zero.
- **Where:** §6 `bindWheelZoom`, the §6 header comment, and the comment on `CONFIG.waveform.maxZoomMultiplier`.
- **Verified by:** the zoom checks now use Ctrl + wheel. A new check confirms a plain wheel scrolls without changing the zoom. 81 checks in total, all passing.

---

## 2026-10-08: Zoom where the mouse is

### Wheel zoom keeps the spot under the mouse in place
- **What:**
  - **Zoom:** zooming in or out with the mouse wheel keeps the moment under the pointer where it is, so you can zoom straight into the bar you're pointing at. Before, the zoom stayed centred on the playback cursor.
  - **While playing:** after you zoom or scroll by hand (wheel zoom, Ctrl+wheel, dragging the minimap), the view stays where you put it. So you can look ahead at the bar that's coming up.
  - **When following resumes:**
    - when the playing cursor comes back into view (from then on, the view pages along with it as usual);
    - after a deliberate move of the playhead: click, arrow step, step button, Space replay or loop wrap.
- **Why:** the user asked for zoom at the mouse position. The rule for following during playback was their choice: stay until the cursor arrives.
- **How:**
  - **Anchoring.** WaveSurfer's `zoom()` re-renders synchronously and shifts the scroll to keep its *progress cursor* in place. So `zoomBy` reads the time under the pointer first, zooms, then corrects the scroll so that time is back under the pointer. It measures the wrapper after the re-render, so WaveSurfer's own shift is already accounted for.
  - **Repeated wheel steps.** Scroll positions are whole pixels, so re-reading the anchor after every step would drift about half a pixel each time. While the pointer stays put, `zoomAnchor` keeps the original time across steps. A new pointer x, or a view that has moved by more than 2 px, takes a new anchor.
  - **WaveSurfer auto-scroll is now off** (`autoScroll: false`, `autoCenter: false`). WaveSurfer scrolled to its cursor on every `setTime()` whenever the cursor was off-screen. That silently overrode the app's own `follow()`, so a view moved away from the cursor snapped straight back. Following is now done only by `follow()`.
  - **Pausing.** `followPaused` is set on a hand zoom or scroll, cleared in `follow()` once the cursor is visible, and cleared by `resumeFollow()`, which §8 calls on every transport `"jump"`.
- **Where:**
  - §6 `createWaveform`: the WaveSurfer options, `zoomBy`, `zoomAnchor`, `bindWheelZoom`, `bindMinimapScrubbing` (end of a drag), `follow`, `resumeFollow`.
  - §8: the `"jump"` listener.
- **Verified by:** 12 new end-to-end checks with real wheel events, 80 in total, all passing:
  - the anchor stays within 1 px over 5 zoom-in steps (worst 0.48 px) and 4 zoom-out steps (worst 0.34 px);
  - zooming all the way out returns to fit-to-width;
  - zooming at the left edge works;
  - zooming at 15 s with the cursor at 2 s stays at 15 s;
  - during playback the view holds after zooming away, a step brings it back, and a look-ahead view holds until the cursor arrives, then pages on;
  - Ctrl+wheel also pauses following.

---

## 2026-10-08: Arrow-key stepping

### ← / → move the cursor by a step; ↑ / ↓ change the step
- **What:**
  - **← / →** move the cursor back or forward by the current step. Holding a key repeats it, which works as rewind or fast-forward.
  - **↑ / ↓** pick a larger or smaller step from 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5 and 10 s. The default is 1 s, and the step stops at either end of the list. Holding ↑ / ↓ changes the step only once.
  - **Display:** the transport bar shows "Step 0.25 s", and the step buttons relabel to match (−0.25s / +0.25s).
  - **R / C are removed;** the arrows replace them.
  - A step is a seek, so everything that follows seeks applies: the video, the loop (stepping past B while looping lands at A) and Space replay (stepping while paused moves the replay start).
- **Why:** the user asked for arrow-key stepping, with an adjustable interval for fine nudging (finding a note's onset) as well as moving around the song.
- **How the focus rule works:**
  - A slider you **clicked** doesn't keep the arrow keys. After dragging the speed, ← / → still step the cursor.
  - A slider reached with **Tab** keeps its arrows, so it can still be used with the keyboard alone.
  - `:focus-visible` can't tell these apart, because Chromium turns it on for the focused element as soon as any key is pressed. So the app remembers the element last pressed with the pointer (`clickedElement`) and clears it when Tab is pressed.
- **Where:**
  - §1 `CONFIG.skip` (replaces `skipSeconds`).
  - §2 `formatStep`.
  - §3 `settings.skipStep`.
  - §9 `renderSkipStep`.
  - §10 `changeSkipStep`.
  - §12 `skip(direction)`.
  - §13: the `SHORTCUTS` arrow entries, `isKeyboardFocusedSlider`, and the `clickedElement` tracking in `bindShortcuts`.
  - `index.html`: `#skipStep` and the button titles.
  - `style.css`: `.skip-step`.
- **Verified by:** 17 new end-to-end checks in the harness, 68 in total, all passing:
  - step sizes and their limits;
  - key repeat;
  - R / C removed and the legend updated;
  - a clicked slider vs a Tab-focused slider, with real window focus emulated through DevTools (`Emulation.setFocusEmulationEnabled`);
  - stepping past B while looping, and Space after stepping.

---

## 2026-10-08: Polish round (A–B loop, Space replay, offline, messages)

### A–B loop
- **What:**
  - **Drawing and adjusting:**
    - Shift+drag on the waveform draws a loop. A plain click still seeks.
    - Dragging within 6 px of a loop edge moves that edge; the pointer shows a resize cursor there.
    - A Shift+drag shorter than 50 ms counts as a plain click.
  - **Keys:**
    - `[` sets the loop start at the cursor.
    - `]` sets the loop end at the cursor.
    - `L` turns the loop on and off.
    - `Shift+L` clears it.
  - **Display:**
    - The loop is a cyan region on the waveform: solid when on, dashed and grey when off.
    - A cyan readout next to the track time shows "Loop 0:12.300 – 0:18.900".
  - **Playback with the loop on:**
    - Playback starts inside the loop.
    - Seeking past its end goes to its start.
    - Drawing or enabling a loop while playing somewhere else jumps into it.
    - A new file clears the loop. A file that fails to load keeps the old one.
- **Why:** looping a passage is the core of transcribing (Transcribe!'s main feature).
- **How:**
  - **Audio.** It uses Signalsmith Stretch's own looping, which is gapless: each timeline segment carries `loopStart` / `loopEnd`, and the audio worklet moves the input time back by the loop length once it reaches `loopEnd`. This was checked against the 1.3.2 source. Two constraints follow from that source:
    1. A new segment copies the previous segment's loop fields. So the transport *always* sends `loopStart` / `loopEnd`, with `0, 0` meaning no loop.
    2. A playing segment that starts at or after `loopEnd` would be pulled back one loop length per audio block. So the transport never starts a playing segment there; it starts at the loop start instead.
  - **Cursor.** The transport's mirror of the timeline (`timelinePositionAt`) applies the same wrap, so the cursor, the clock and the video follow the loop exactly.
  - **Video.** When the position goes backwards during playback (a wrap), the transport emits `"jump"`, so the video restarts decoding at the loop start.
  - **End of track.** While looping, no end-of-track timer is planned, because a looping track never ends.
  - **Where the state lives.** The loop's state `{ start, end, enabled }` lives in the playback actions (`loopRegion`), not the transport, because a disabled loop is still drawn. The transport only knows about the loop while it is enabled.
  - **Drawing.** The region is a `<div part="loop-region">` inside WaveSurfer's wrapper, styled from `style.css` with `::part()`, since WaveSurfer uses a shadow DOM. It is positioned in percent, so zoom and scroll need no code. WaveSurfer's Regions plugin was avoided: its pointer handling would fight the app's own seeking, the same class of bug as the earlier cursor desync.
- **Where:**
  - §1 `CONFIG.loop` (`minSeconds`, `edgeGrabPx`).
  - §2 `timelinePositionAt`.
  - §5 `createTransport`: `apply`, `play`, `setLoop`, `draw` (wrap detection), the `loop` getter.
  - §6 `createWaveform`: `timeAtClientX`, `loopEdgeAt`, `bindPointerSeek` (seek / draw / edge modes), `renderLoop`, `setLoop`.
  - §8: the `onLoopChange` wiring.
  - §9 `renderLoopInfo`.
  - §11 `loadMediaFile` (clears the loop).
  - §12: `loopRegion`, `setLoopRegion`, `setLoopStart`, `setLoopEnd`, `toggleLoop`, `clearLoop`.
  - §13 `SHORTCUTS`.
  - `style.css`: the `--loop*` tokens, `::part(loop-region)`, `.loop-info`.

### Space plays again from where you started listening
- **What:**
  - Space pauses, and the cursor stays where it paused.
  - Space again plays from where that playback started.
  - If you clicked, skipped or pressed Stop while paused, Space plays from there instead.
  - After the track ends, Space replays from where you started.
  - The Play button behaves like Space. `,` still pauses and resumes from the current spot.
- **Why:** the user asked for it; it matches Transcribe!'s Play/Stop. Listening to a phrase again is the most common action when transcribing.
- **How:**
  - `returnPoint` is updated by transport listeners in §8:
    - the position when playback starts;
    - the target of every `"jump"` (seek, skip, loop wrap);
    - 0 on Stop or a new file.
  - `replayOrPause` reads `returnPoint` before seeking, because its own seek also emits `"jump"`.
- **Where:**
  - §8: the `returnPoint` listeners.
  - §12: `returnPoint`, `replayOrPause`; the Play button binding.
  - §13: the Space and `,` entries.

### Keyboard: Shift shortcuts
- **What:** shortcuts can now be Shift + key (`shift: true` in `SHORTCUTS`). The legend shows them as `Shift + L`.
- **How:** key *releases* match by key alone, ignoring Shift. Otherwise, pressing Shift while holding the play-while-held key (Z) would miss the release and leave it playing. Releases of every shortcut are still matched and `preventDefault`ed, because a focused button "clicks" on Space *release*.
- **Where:** §13 `findShortcut`, `renderShortcutLegend`.

### Works offline
- **What:** the app no longer needs the internet. Before, the audio engine came from the jsDelivr CDN (no internet meant no sound) and the fonts from Google Fonts.
- **How:**
  - `signalsmith-stretch` comes from npm, pinned to exactly `1.3.2`. The transport mirrors its internal behaviour, so an upgrade needs re-checking against its source. The npm file is byte-identical to the CDN file the app used before.
  - The fonts come from Fontsource: `@fontsource/righteous` and `@fontsource-variable/nunito` (family name "Nunito Variable").
- **Where:** `package.json` dependencies, the `import` at the top of `script.js`, the `<link>`s in `index.html`, `--sans` in `style.css`.

### Errors vs notices; tidy UI
- **What:**
  - **Messages.** The message line in the transport bar distinguishes two kinds:
    - **errors** (something failed): red monospace;
    - **notices** (something works only partly, e.g. "the picture can't be shown, but its audio plays"): neutral grey.
  - **Status text.** The "Playing." / "Paused." status text in the top bar is removed, because the Play/Pause button already shows the state.
  - **Scale labels.** The labels under the speed and volume sliders are generated from `CONFIG`, so they can't go out of date.
- **Where:**
  - §9: `showMessage`, `showError`, `showNotice`, `clearMessage`, `reportError`, `buildScales`.
  - §11: the notices in `loadMediaFile`.
  - `index.html`: `#message` replaces `#error`; `#status` is removed.
  - `style.css`: `.message`, `.message.notice`.

### Verified by
**Logic checks**
- 8 unit checks of `timelinePositionAt`: no loop, before B, a wrap at B, multiple wraps, a start before A, half speed, inactive, zero loop fields.

**End-to-end harness**
51 checks in an offscreen Electron window, using real key and mouse input, with every network request blocked:
- **Loop at 1× and 0.5×:**
  - the cursor stays inside the loop and wraps;
  - the audio thread's own input time also stays inside it;
  - there are no forward jumps.
- **Loop editing:** the drag, edge, key, short-drag and new-file rules.
- **Space, Stop and comma:**
  - Space and comma behave as described above;
  - the cursor holds still on pause;
  - the waveform cursor stays within 1 ms of the clock.
- **Video loop:**
  - the picture follows each wrap within 3 frames;
  - it stays within 100 ms of the audio 96% of the time.
- **Fonts:** load with no network access.
- **Messages:** a bad file shows a red error and keeps the previous song.

---

## Before 2026-10-08: Groundwork

A summary of the earlier rounds, so this log has a starting point.

- **Structure.**
  - `script.js` was refactored into one modular file with numbered sections, a CONFIG block that holds every tunable number, a single `settings` object, and a table of slider settings (`SLIDERS`).
  - A small event emitter isolates listener errors.
- **Transport (§5).**
  - Playback state and position mirror Signalsmith's timeline, so the position of what is *heard* (allowing for the output delay) is computed exactly.
  - Signalsmith's `schedule()` discards every segment that starts before a new one. So segments are never scheduled in the future; the end of the track is a timer instead. Breaking this rule once caused "no sound at all".
  - `pendingJump` keeps a seek target on screen until it becomes audible.
- **Audio graph.** Signalsmith (speed and pitch) → 5-band EQ (off by default) → volume → a brick-wall limiter.
- **Shortcuts.** Modelled on Transcribe!: Space, `,`, `.`, Z/`;` hold-to-play, R/C skip with key repeat (later replaced by the arrow keys). A legend is generated from `SHORTCUTS`.
- **UI.**
  - A dark, waveform-first layout with no animations, except the loading indicator (a full-window overlay that blocks input while a file loads).
  - Fonts: Righteous (display) and Nunito (text).
  - More slowdown presets.
- **Electron.** GPU acceleration is enabled (`npm run start:gpu-info` shows its status, `start:no-gpu` turns it off).
- **Faster loading.** The engine and libraries warm up at startup, the waveform gets adaptive peak counts, and decoded audio is handed to the audio thread without copying.
- **Video (§7).**
  - Frames are decoded with WebCodecs through Mediabunny and drawn on a canvas at the transport position. There is no `<video>` element and no second clock, so it can't drift.
  - Decoding reuses its position where it can and skips ahead when it falls behind.
  - A low-resolution proxy is built in the background (VP8, 320 px) and fills in instantly after distant seeks, until the sharp frame arrives.
- **Waveform seeking (§6).** WaveSurfer is used for drawing only; clicking and dragging are handled by the app. WaveSurfer's own delayed `seekTo` had made the cursor drift from playback.
- **Pausing.** Playback pauses at what was being heard when the key was pressed (the event's timestamp), not where the audio engine already was. That had made the cursor jump about 45 ms forward on every pause.
