# TranscriBee: change log

TranscriBee is an Electron app for transcribing music. You open a song or a video, slow it down, shift its pitch, EQ it, loop a passage, and step through it with the keyboard.

**Files**

- `electron/`: the Electron main process: `main.js` (window, security), `window-state.js`, `theme-store.js`, `downloader.js` (yt-dlp) and `preload.js` (the page's bridge to them).
- `src/`: the page, as ES modules in layers. `core/`, `themes/` → `config.js` → `audio/`, `video/`, `waveform.js` → `context.js` → `ui/` → `features/` → `app.js`.
- `index.html` and `style.css`: the page and its look.
- `assets/`: the logo and icons; `scripts/make-images.py` makes them from the source image.
- `tests/`: unit tests (`unit/`), end-to-end tests (`run.cjs` + `e2e/`) and the smoke test; all run with `npm test`.

The architecture overview, the file map and a list of where to make common changes are in the comment at the top of `src/app.js`. Read that first. `README.md` covers running, testing and building.

**How to read an entry.** Newest first, one entry per round of work. Each change records:

- **What:** the behaviour, as the user sees it.
- **Why:** the request or problem behind it.
- **How:** the mechanism, and any constraint that isn't obvious from the code.
- **Where:** files and function names, rather than line numbers, which drift.
- **Verified by:** how it was tested.

**Older entries** (before "Modules") refer to `script.js` and its numbered sections, and to `main.js`, `downloader.js` and `preload.js` at the top level. Here is where each now lives:

| Then                                     | Now                                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| §1 Config                                | `src/config.js`                                                                             |
| §2 Pure helpers                          | `src/core/` (`format.js`, `peaks.js`, `timeline.js`, `emitter.js`, `files.js`, `errors.js`) |
| §3 Settings                              | `src/context.js`                                                                            |
| §4 Audio engine                          | `src/audio/engine.js`                                                                       |
| §5 Transport                             | `src/audio/transport.js`                                                                    |
| §6 Waveform                              | `src/waveform.js`                                                                           |
| §7 Video                                 | `src/video/view.js`, `src/video/proxy.js`                                                   |
| §8 Instances                             | `src/app.js`; the `returnPoint` listeners are in `features/playback.js` (`bindPlayback`)    |
| §9 UI                                    | `src/ui/dom.js`; the generated controls are in `src/ui/controls.js`                         |
| §10 Setting controls                     | `src/ui/controls.js`                                                                        |
| §11 File loading                         | `src/features/open-file.js`, `src/features/download.js`                                     |
| §12 Playback actions                     | `src/features/playback.js`, `src/features/loop.js`                                          |
| §13 Keyboard shortcuts                   | `src/ui/shortcuts.js`; the `SHORTCUTS` table is in `src/app.js`                             |
| §14 Startup                              | `src/app.js` (`start`)                                                                      |
| `main.js`, `downloader.js`, `preload.js` | `electron/`                                                                                 |
| `tests/run.cjs` (one sequence)           | `tests/run.cjs` + `tests/e2e/`                                                              |

---

## 2026-10-08: A new file starts with default sound settings

- **What:** when a file opens, speed, pitch (semitones and cents), volume and the EQ (band gains and On/Off) go back to their defaults, as the A–B loop already did. The step size stays, since it's how you move around rather than how it sounds, and so does the theme. A file that fails to open changes nothing, so the current song keeps its settings.
- **Why:** the user asked for it: settings made for one song (e.g. slowed down to 0.5×) shouldn't carry over to the next.
- **How:**
  - `resetSoundSettings()` in `ui/controls.js` sets every slider in `SLIDERS` to its `range.initial` (from `CONFIG`) through `setSetting`, so the readouts, speed chips and audio all follow, and sets the EQ back to `CONFIG.eq.enabledInitially`.
  - `loadMediaFile` calls it right after the loop is cleared, once the new file has loaded.
- **Where:** `src/ui/controls.js` (`resetSoundSettings`; `SliderSpec.range` now includes `initial`), `src/features/open-file.js` (`loadMediaFile` and its header), `tests/e2e/07-errors.cjs`.
- **Verified by:** `tests/e2e/07-errors.cjs`, 4 new checks:
  - all sound settings and the step size are changed as a user would;
  - a bad file keeps them all;
  - a good file resets speed, pitch, volume and EQ, the step size stays, and the speed slider and 1× chip show the reset.

  All tests pass: 52 unit, 149 end-to-end, 19 smoke.

## 2026-10-08: Three light themes

- **What:** **Catppuccin Latte**, **GitHub Light** and **Gruvbox Light** join Solarized Light in the theme menu, listed after the dark themes. Any of them can be Automatic's light theme: Automatic uses the last light theme chosen.
- **Why:** the user asked for a couple more light themes.
- **How:**
  - **Catppuccin Latte:** Mantle/Base/Crust backgrounds, Mauve accent, Teal loop.
  - **GitHub Light (Primer):** white panels, blue accent, purple loop.
  - **Gruvbox Light:** bg0/bg1, orange accent, blue loop.

  Each is one palette file, mapped onto the roles from the official colours. The contrast tests passed all three except Catppuccin's red, which was a shade too light as error text on its background (4.46:1). It is now `#c80e36` (4.83:1).

- **Where:** `src/themes/palettes/catppuccin-latte.js`, `github-light.js`, `gruvbox-light.js`; `THEMES` in `src/themes/index.js` (now ordered dark, then light); `tests/e2e/10-themes.cjs`; `README.md`.
- **Verified by:**
  - **Unit tests:** 52, all passing; the contrast checks cover every theme.
  - **End-to-end:** 145, with two checks made independent of the theme list:
    - the menu must list every file in `palettes/`, so a theme file missing from `THEMES` fails;
    - Automatic's expected themes are taken from the menu order.
  - **Smoke:** 19.
  - **Screenshots:** `tests/output/theme-*.png`.

## 2026-10-08: Colour themes

- **What:**
  - **Six themes:** TranscriBee (the original look, still the default), Monokai, Dracula, Nord, One Dark and Solarized Light.
  - **Automatic:** follows the system's dark or light mode, using the last dark and the last light theme chosen.
  - **The picker:** a palette button at the right of the top bar (and in the top-right corner of the welcome screen). It opens a menu listing Automatic and each theme with a four-colour swatch (background, panel, accent, loop).
  - **Choosing:** applies the theme at once. The menu stays open so themes can be compared, and ↑/↓, Enter and Escape work.
  - **Remembered:** the choice is restored on the next start without a flash of the old colours.
- **Why:** the user asked for a robust, modular colour-theme system with the classic editor themes.
- **How:**
  - **Themes are data.** One ES module per theme in `src/themes/palettes/`, giving colours for a fixed set of **roles** (`ROLES` in `src/themes/index.js`).
    - **Required roles:** bg, surface, surface2, border, text, muted, accent, accentInk, danger, loop, wave, cursor.
    - **Optional roles** are derived when absent: surfaceHover, accentHover, minimapWave, minimapProgress.
    - **Mapping editor palettes onto roles:** e.g. Dracula: purple accent, cyan loop; Nord: Frost accent, Aurora yellow loop. Each file notes its source.
  - **Independent.** `src/themes/` imports nothing from the app (a lint zone enforces it), and no other code imports a palette. The page's styles keep reading the same CSS variables. The theme only changes their values (`ui/theme.js` sets them on `<html>`, with `color-scheme` and `data-theme`).
  - **Literal colours.** `cssVariables(theme)` turns roles into variables, deriving the optional ones in JavaScript, because the waveform draws on canvases, which can't resolve `var()` or `color-mix()`. The glows, overlays and loop fills in `style.css` are `color-mix()`es of the base tokens, so they follow automatically.
  - **The waveform** gets a generic `refreshColors()`, called by `app.js` on `onThemeChange`. It recolours WaveSurfer with `setOptions()` and replaces the minimap plugin, which copies its options when made and can't be recoloured. Its scrubbing looks the minimap up on each drag, so it keeps working.
  - **Saving and no flash:**
    - `electron/theme-store.js` keeps `theme.json` in the user-data folder and sets the window's background colour from the theme;
    - the main process loads the palettes with `require()` of ES modules (Electron 44 / Node 24; a spike confirmed this, and the packaged build too);
    - the preload asks for the theme synchronously (`sendSync("theme:initial")`) and sets the variables the moment `<html>` exists (a `MutationObserver`; `<html>` doesn't exist yet when a preload runs). That's before any page CSS or script runs.
    - Outside Electron, `localStorage` is used instead.
  - **Robustness:**
    - unknown, removed or mismatched theme ids fall back to the defaults (`normalizePrefs`);
    - an unreadable `theme.json` means the defaults;
    - the `theme:initial` handler always answers, even if something inside it fails. Found while testing: a missing answer makes `sendSync` wait forever, so the handler must be registered before any window exists.
  - **Contrast was checked, and fixed where needed.** The unit tests require, for every theme:
    - text ≥ 4.5:1 on every background;
    - muted labels, error text and the cursor ≥ 4.5:1;
    - accent and loop ≥ 3:1;
    - the unplayed waveform ≥ 1.5:1;
    - the loop clearly different from the accent.

    They caught dim error text in Monokai, Nord and One Dark, Nord's green loop being too close to its blue accent, and Solarized Light's muted text and cyan accent; those shades were adjusted, keeping each palette's hues.

  - A unit test also keeps the `:root` fallback in `style.css` equal to the TranscriBee theme.
- **Where:**
  - `src/themes/` (`index.js`, `palettes/*.js`), `src/ui/theme.js`, `src/features/theme-picker.js`, `src/app.js` (first statement, the waveform wiring, `bindThemePicker`, the shortcut blocker);
  - `src/waveform.js` (`refreshColors`, `minimapOptions`, `waveColors`);
  - `electron/theme-store.js`, `electron/main.js`, `electron/preload.js`;
  - `index.html` (the palette buttons, `#themeMenu`); `style.css` §4 "Colour-theme menu";
  - `eslint.config.js` (the themes zone; browser globals for the preload).
- **Verified by:**
  - **Unit tests:** `tests/unit/themes.test.mjs`, 15 checks (49 unit tests in all).
  - **E2E:** `tests/e2e/10-themes.cjs`, 16 checks:
    - the menu, keyboard and Escape;
    - shortcuts blocked while it's open;
    - Nord's variables on the page;
    - both waveform canvases checked pixel by pixel for the theme's colours;
    - the minimap overlay intact;
    - the choice saved;
    - Automatic under an emulated system mode;
    - a screenshot per theme in `tests/output/theme-*.png`.
  - **Smoke test:** a saved theme is applied on the next start of the real app.
  - **Totals:** 145 end-to-end and 19 smoke checks pass, on the project and on a packaged Linux build.

## 2026-10-08: Modules (ready for large changes)

A structural refactor with no behaviour change: the code is split into files with enforced layers, and gains fast unit tests.

- **What:** nothing the user can see changes. For whoever works on the code:
  - `script.js` (2,739 lines) is now 21 modules in `src/`;
  - the main process lives in `electron/`;
  - `npm test` starts with 34 unit tests that run in plain Node in about a second;
  - the end-to-end tests are split into a harness plus 11 topic files.
- **Why:** to make large changes safer and easier. A single file of numbered sections had no boundaries, so any part could reach any other. And every test had to start Electron.
- **How:**
  - **No build step.** The page was already an ES module, so the split uses plain `import`s from `file://`, as before.
    - `src/package.json` (`"type": "module"`) lets Node's test runner import the same files.
    - The library imports keep their `node_modules` paths, adjusted for depth.
  - **Layers.** A file in `src/` only imports from the layers above it: `core` → `config` → `audio` / `video` / `waveform` → `context` → `ui` → `features` → `app.js`. `eslint-plugin-import-x` enforces this (`no-restricted-paths`) and forbids import cycles (`no-cycle`). It was checked with deliberately wrong imports.
  - **Shared state** lives in `context.js`: `settings`, and `player`, the components that `app.js` creates and puts there before anything binds.
  - **Callbacks across layers** are wired in `app.js`: engine errors, waveform loop drags, video notices. So the components never import the UI.
  - **Small moves so the layering holds:**
    - `peaksPerSecondFor` and `isVideoFile` take their `CONFIG` values as arguments, so `core/` imports nothing outside itself;
    - the `Loop` and `LoopRegion` types join `Segment` in `core/timeline.js`;
    - `bindControls` became `bindTransportButtons` (`features/playback.js`) and `bindSettingControls` (`ui/controls.js`);
    - the `SHORTCUTS` table moved to `app.js`, while the key handling stays in `ui/shortcuts.js` (`bindShortcuts(shortcuts, isBlocked)`);
    - the `returnPoint` listeners moved into `bindPlayback()`;
    - `window-state.js` came out of `main.js`.
  - **Unit tests** (`tests/unit/*.test.mjs`, `node:test`):
    - `core/`: formatting, peaks, timeline and loop maths, emitter, file types;
    - the transport against a fake engine and clock: speed, pausing at what was heard, seeking, the end of the track, the loop rules;
    - the downloader's link checks, failure messages and file names.

    A mutation check showed they catch real breakage: breaking the loop-end rule, then the heard-position pause, each failed exactly the matching test.

  - **End-to-end tests:** `tests/e2e/harness.cjs` holds the setup and helpers; `01-static-ui.cjs` … `11-security.cjs` run in the same order and window as before, and `tests/run.cjs` is a short runner. The check names and order are identical (compared by script).
  - The architecture comment moved to the top of `src/app.js`, with a file map in place of the section list. The table at the top of this file maps the old `§` sections to files.
- **Where:**
  - `src/**`, `electron/**`, `index.html` (loads `src/app.js`);
  - `package.json` (`main`, `build.files`, `test:unit`), `jsconfig.json`, `eslint.config.js`;
  - `tests/unit/`, `tests/e2e/`, `tests/run.cjs`, `tests/launch.cjs`;
  - `README.md`, `style.css` (two comments).
- **Verified by:**
  - after every step (8 commits), `npm run check` and `npm test`: 34 unit + 129 end-to-end + 16 smoke checks;
  - the full suite against a packaged Linux build.

## 2026-10-08: Download from YouTube

- **What:**
  - **Where to start a download:** a **From YouTube…** button on the welcome screen and in the top bar, or pasting a link anywhere outside a text field.
  - **The dialog:** a field for the link, an **Audio / Video (up to 1080p)** choice, which is remembered for the session, and **Download**.
  - **While it downloads:** the loading screen (first file) or the overlay (later files) shows the stage and the video's title.
    - **Stages:** "Setting up the downloader (first time only)… 42 %", "Updating the downloader…", "Downloading… 42 % · 0:12 left" (for video: "the picture", then "the sound"), "Joining picture and sound…".
    - **Cancel** stops the download and returns to what was open, with no error and no files left behind.
  - **The result:** saved to `~/Downloads/TranscriBee/` as "Title [video id].m4a" (or `.mp4`, `.ogg`) and opened like any other file. A notice says where it was saved.
  - **A playlist or search page** downloads only its first video.
  - **Errors:** no internet connection, a private or unavailable video, YouTube refusing the stream (HTTP 403) and links that aren't videos are explained in the usual red error line. Whatever was open stays open.
- **Why:** to get a song into TranscriBee straight from its YouTube link.
- **How:**
  - **Choosing yt-dlp.** Pure-JS libraries (ytdl-core and its forks) break whenever YouTube changes, and web APIs (Cobalt, RapidAPI) add a third party that can vanish or log downloads. yt-dlp is the standard tool and gets fixes within days.
  - **The page never touches the network.** It stays sandboxed under its CSP. `preload.js` exposes only `window.transcribee` (`download`, `cancelDownload`, `onDownloadProgress`). `downloader.js`, in the main process, does the work, and the file returns to the page as bytes over IPC.
  - **yt-dlp itself:**
    - downloaded on first use from its GitHub releases into `<userData>/bin` (about 40 MB) and checked against the release's `SHA2-256SUMS`;
    - updated with `yt-dlp -U` at most once a day; a failed update keeps the old copy;
    - fetches abort on Cancel and after 30 s without data.
  - **JavaScript runtime.** YouTube now needs yt-dlp to have one. TranscriBee hands it **Electron's own binary** (`--js-runtimes node:<execPath>`, with `ELECTRON_RUN_AS_NODE=1`), so nothing else needs installing. This was confirmed in a spike and in the packaged build.
  - **No ffmpeg.**
    - Video is downloaded as two files (`-f "bv[vcodec^=avc1][height<=1080]/…,ba[ext=m4a]/ba"`) and joined by **Mediabunny** in Node, copying packets without re-encoding.
    - Audio is rewritten the same way, because YouTube's `.m4a` is a fragmented "DASH" file that not every player opens.
    - `--fixup never` makes the result the same whether or not ffmpeg is installed.
  - **Safety:**
    - only `http(s)` links are accepted, and the link goes after `--`, so it can never be read as an option;
    - `--playlist-items 1`, plus stopping yt-dlp if a second video's title appears;
    - one download at a time;
    - yt-dlp runs in its own process group, so Cancel stops all of it (`taskkill /T` on Windows);
    - work folders in the temp directory are removed afterwards, and ones a killed app left behind are removed after a day.
  - **HTTP 403.** YouTube sometimes refuses a stream link. The download is retried once with a fresh yt-dlp run, which gets new links.
  - **Progress.** yt-dlp prints tagged lines (`--print before_dl:[tb-title] …`, `after_move:[tb-file] …`, `--progress-template download:[tb-progress] …`). `downloader.js` parses them into `{ stage, part, parts, fraction, eta, title }`.
- **Where:**
  - `downloader.js` (`createDownloader`, `handleDownloads`) and `preload.js`; `main.js` registers the handlers and sets the preload;
  - `script.js`:
    - §9: `setLoading(name)`, `setLoadingStatus`, and the new elements in `dom`;
    - §11: `withLoading` (shared with `openFile`), `downloadLink`, `describeDownload`, `openDownloadDialog`, `bindDownloads`; `loadMediaFile` now returns its notices instead of showing them;
    - §13: no shortcuts while the dialog is open;
  - `index.html`: the buttons, `#downloadDialog`, and a status, Cancel and title line on the loading screen and overlay; `style.css` §4: "Download dialog";
  - `package.json` `build.files`; `eslint.config.js`.
- **Found by real use (fixed):**
  - a YouTube search link downloaded every result (fixed with `--playlist-items 1`);
  - a GitHub fetch that never answered left setup stuck at 0 % with Cancel unable to stop it;
  - a "no network" message on Linux ("Temporary failure in name resolution") wasn't recognised.
- **Verified by:**
  - **Offline tests:** `npm test`, 129 + 16 checks. `tests/fake-yt-dlp.cjs` stands in for yt-dlp and serves two new fixtures shaped like YouTube's (a fragmented AAC `.m4a`, a video-only VP9 `.webm`). `run.cjs` drives the real `preload.js` and `downloader.js` through:
    - the dialog, refusing a non-link, Escape, and pasting;
    - audio and video downloads that open, play and show a picture;
    - the saved files and the "saved as" notice;
    - private, offline and 403 errors, and a one-off 403 being retried;
    - Cancel with no files or temp folders left;
    - the title on the overlay.

    The smoke test checks that the real app exposes the bridge.

  - **Real network:**
    - first-use setup, the daily update, audio and video downloads, a search link, Cancel during setup and during download, and no stray processes afterwards;
    - downloaded H.264/AAC files open in the app with picture, waveform and full length;
    - the packaged Linux build does the same.

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

### Phase 2: Leftovers removed, package metadata filled in

- **What:**
  - **Deleted:** `dist/`, a 100 MB Windows build from Sep 26 that predates almost every feature, and the empty `transcribee_prototype.code-workspace`.
  - **`package.json` now describes the real app:**
    - name `transcribee`, product name `TranscriBee`, app ID `com.transcribee.app`;
    - a description, keywords, the author, and `private: true`;
    - the placeholder `test` script is gone, and the scripts are grouped (start, test, build).
- **Why:** leftovers mislead (an old `.exe` looks like a current build), and the metadata ends up in the packaged app.
- **Note:** because the product name changed, Electron keeps its profile folder (cache and the like) under a new name. The app stores no user data there, so nothing is lost.
- **Where:** `package.json`, `package-lock.json`.
- **Verified by:** `npm test`, 99/99.

### Phase 3: Formatter, linter, type checking

- **What:** code-quality tooling, with no build step:
  - `npm run format` (Prettier) and `npm run lint` (ESLint);
  - `npm run typecheck` (TypeScript checking `script.js` from its JSDoc);
  - `npm run check`, which runs all three.

  Prettier has been run once over every file.

- **Why:** style stays uniform without effort, and mistakes such as unused variables, typos in property names and wrong argument types are caught before running the app.
- **How:**
  - **Prettier** (`.prettierrc.json`) matches the existing style: 2 spaces, double quotes, 120 columns, trailing commas. So the one-off reformat changed little in `script.js`, mostly indentation in `index.html`, and moved `main.js` from 4 to 2 spaces.
  - **ESLint** (`eslint.config.js`) uses the recommended rules with browser globals for `script.js` and Node globals for `main.js` and `tests/`. It checks for mistakes only; style is left to Prettier.
  - **TypeScript** (`jsconfig.json`, plus `// @ts-check` at the top of `script.js`) checks only the app's own code. `maxNodeModuleJsDepth: 0` keeps it from type-checking the libraries' JavaScript: without it, over 300 errors came from Mediabunny and Signalsmith internals.
  - **Test fix:** the step-button test now trims text, because the reformatted markup puts the arrow icons on their own lines. The whitespace doesn't render.
- **Where:** `.prettierrc.json`, `.prettierignore`, `eslint.config.js`, `jsconfig.json`, and the new scripts in `package.json`. The dev dependencies are `prettier`, `eslint`, `@eslint/js`, `globals` and `typescript`.
- **Verified by:** `format:check` and `lint` are clean; `npm test` passes 99/99. Ten type errors in the app's code remain, and Phase 4 fixes them.

### Phase 4: Code audit, consistent naming, JSDoc types

- **What:** `script.js` was read end to end and cleaned up, with no behaviour change. It now type-checks cleanly.
- **Why:** after many feature rounds some comments had drifted, a few pieces were unused, and names didn't match the UI. Types document the shapes that get passed around and catch mistakes.
- **How:**
  - **Naming: "skip" is now "step" everywhere,** matching the UI ("Step 1 s", "Step back"):
    - `CONFIG.step.sizes`, `settings.stepSize`, `step()` / `stepBack()` / `stepForward()`, `changeStepSize()`, `renderStepSize()`, `formatStepSize()`;
    - element ids `#stepBack`, `#stepForward`, `#stepSize`, and the class `.step-size`.
  - **Removed unused API:** `videoView.hasVideo`, `videoView.proxyFrameCount` (with the proxy's `frameCount`), and the `transport.loop` getter.
  - **Comments fixed:**
    - a sentence broken across lines in the §7 header;
    - an oddly wrapped §6 header;
    - a stale mention of the removed empty-waveform hint;
    - a drag-state comment that listed a field that doesn't exist.
  - **Duplication:** converting a track time to a pointer x is now one helper, `clientXAt`, next to `timeAtClientX`. Loop-edge grabbing and zoom anchoring both use it.
  - **Consistency:**
    - `$` is defined at the start of §8 and used for the instances too (they had used `document.getElementById`);
    - `changeStepSize` moved out from between the two reset functions;
    - the play-while-held code moved ahead of the A–B loop block;
    - the button bindings use a small `onClick(element, handler)` helper.
  - **JSDoc types:**
    - typedefs for `Segment`, `TransportState`, `Loop`, `LoopRegion`, `SliderSpec` and `Shortcut`;
    - `AudioEngine`, `Transport`, `Waveform` and `VideoView`, defined as the return types of their factories;
    - parameter types on the factories and the main functions;
    - element casts where specific element properties are used (inputs, buttons, the canvas).
  - **Real fix found by the type checker:** the proxy's codec probe fell back to `{}` on error and then read `.supported` from it. It now falls back to `{ supported: false }`. The behaviour was the same, since `undefined` is falsy, but the intent is now explicit.
- **Where:** `script.js` (every section), `index.html` (step ids), `style.css` (`.step-size`), `tests/run.cjs` (step ids).
- **Verified by:** `npm run check` is clean (format, lint, 0 type errors); `npm test` passes 99/99.

### Phase 5: Error paths and resource cleanup

- **What:**
  - **Deliberate change:** if part of a video can't be decoded during use, a notice now says so ("…the picture may stop updating. The audio is unaffected."), once per file. Before, the picture just froze, with only a console warning.
  - **Small fix:** the video view's pending "head start" timer is now cancelled when a file is closed or replaced. It was harmless before, but it was left running.
  - **New tests** for leaks and unhandled errors.
- **Why:** to make sure every failure either reaches the user or is clearly harmless, and that opening file after file doesn't leak decoders.
- **Review findings** (no change needed):
  - **Opening a new file releases the old one:** the decode cursor and its frames, the proxy's encoder and decoder and its encoded chunks, the Mediabunny input, the Signalsmith buffers (`dropBuffers`), and the transport's timer and animation frame.
  - **Every other `console.warn` is either reported another way or harmless:**
    - an unreadable video becomes the "picture can't be shown" notice;
    - a waveform failure becomes the "waveform couldn't be drawn" notice;
    - a warm-up failure is retried, and reported if the file load then fails;
    - a proxy failure only makes seeking slower.
  - The policy is written in the §7 header.
- **How:**
  - `createVideoView` takes an `onProblem(message)` callback, wired to `showNotice` in §8.
  - `reset()` clears `heldRun` and `sharpHeldUntil`. `heldRun` moved up to the view's other state variables.
- **Test instrumentation** (`tests/preload.cjs`):
  - counts live `VideoDecoder` / `VideoEncoder` objects (created minus closed, or failed);
  - records unhandled promise rejections, uncaught errors and Content-Security-Policy violations.
- **Where:** `script.js` §7 (header, `createVideoView`, `reset`, `run`) and §8; `tests/preload.cjs`; `tests/run.cjs`.
- **Verified by:** 3 new checks, 102 in total, all passing:
  - opening the video three times in a row keeps exactly 1 live codec each time;
  - switching to an audio file leaves 0;
  - the whole run produces no unhandled error, rejection or CSP violation.

### Phase 6: Stylesheet tidy, smaller logo, app icon

- **What:**
  - **The page looks the same.** `style.css` was reorganised: its sections now follow the page, and colours that were written out by hand are tokens.
  - **Smaller logo:** 33 KB instead of 560 KB.
  - **App icon:** the bee is now the window and taskbar icon, and the packaged app's icon, instead of Electron's default.
- **Why:** the stylesheet had grown feature by feature: the screens came last, colour values were repeated, and six separate `[hidden]` overrides existed. The logo file was 865 px wide and shown at 150 px at most.
- **How:**
  - **Section order:** tokens → base → controls → screens (welcome, loading screen, overlay, loader bars) → player (top bar, stage, transport, panels, EQ, shortcuts). A table of contents sits at the top of the file.
  - **Derived colours:** amber glows, loop fills and the overlay background are computed from the base tokens with `color-mix()` (`--screen-glow`, `--aura-core`, `--aura-mid`, `--aura-shadow`, `--overlay-bg`, …). `--wave-progress` and `--loop-edge-off` reference `--accent` and `--muted` instead of repeating their values. Changing `--accent` now recolours every glow.
  - **One `[hidden] { display: none !important }` rule** in Base replaces the six per-element overrides. They were needed because elements set their own `display`.
  - **Comments:** the stale "the one animation in the app" comment is fixed; the two animations are labelled "1 of 2" and "2 of 2".
  - **Images:**
    - the original moved to `assets/transcribee-source.png` and is kept as the master;
    - `scripts/make-images.py` (Pillow) generates `assets/logo.webp` (300 px, 33 KB: WebP keeps the soft glow far smaller than PNG), `assets/icon-512.png` and `assets/icon.ico`;
    - the page uses `logo.webp` for all three logos;
    - `main.js` sets the window icon; `package.json` sets `build.icon` and `build.win.icon`.
- **Where:** `style.css`, `index.html` (image paths), `main.js` (`icon`), `package.json` (`build.icon`), `assets/`, `scripts/make-images.py`.
- **Verified by:**
  - `npm run check` is clean; `npm test` passes 102/102.
  - Screenshots compared pixel by pixel before and after (welcome, error, drag, loading, player, loop): the only differences are inside the logo, from the resampled image. The video screenshot differs only by which frame was captured.

### Phase 7: Electron hardening, window niceties, packaged build

- **What:**
  - **Security:**
    - the page has a Content-Security-Policy and runs sandboxed;
    - it can't navigate away or open other windows;
    - Electron's "Insecure Content-Security-Policy" console warning is gone.
  - **Window:**
    - the title names the open file ("TranscriBee — song.mp3");
    - the window can't be made smaller than 900 × 640;
    - it remembers its size, position and maximised state between runs;
    - it opens with the app's dark background instead of a white flash.
  - **Packaging:**
    - `npm run build:dir` (unpacked Linux build) and `npm run build:linux` (AppImage) join `build:win`;
    - the package ships only what the app needs.
- **Why:**
  - Electron's defaults allow far more than this app uses.
  - The window niceties were requested.
  - No packaged build had been checked since the app started loading its libraries from `./node_modules` paths, which must work from inside the app archive.
- **How:**
  - **CSP** (a `<meta>` in `index.html`): only the app's own files may load. The exceptions are commented in place, each needed by a library:
    - `blob:` scripts and workers: Signalsmith's audio worklet and Mediabunny's workers are created from Blob URLs;
    - `'wasm-unsafe-eval'`: Signalsmith is WebAssembly;
    - inline styles: WaveSurfer writes `<style>` into its shadow DOM.
  - **`main.js`:** `sandbox: true`; `will-navigate` is always prevented; `setWindowOpenHandler` denies.
  - **Window state:** stored in `window-state.json` in the user-data folder.
    - On load, it's ignored if malformed or if the saved position doesn't overlap a connected display by at least 100 px (a monitor unplugged since), and it's raised to the minimum size.
    - It's written in the window's `closed` event, from bounds remembered on every resize, move or maximise. The `close` event alone turned out not to fire when the page itself closes the window, which the smoke test caught.
  - **Title:** `loadMediaFile` sets `document.title`, which Electron uses as the window title.
  - **Build:**
    - `build.files` lists the app files and the two images. The runtime libraries are added by electron-builder, so the archive is 12.7 MB, with no tests, change log or dev tools.
    - Linux targets AppImage with the executable `transcribee`; Windows stays portable, with `icon.ico`.
- **New test, `tests/smoke.cjs`:** it starts the real app (main.js included, which `run.cjs` never exercises) and drives it over the Chrome DevTools Protocol, using Node's built-in WebSocket. It checks:
  - the title;
  - that the CSP blocks an injected inline script (DevTools' own evaluation is exempt, so it can't be probed with `eval`);
  - that pop-ups and navigation are blocked;
  - that the state is saved on close;
  - restore, an off-screen position, the minimum size and a corrupt state file.

  Under tiling window managers (i3, sway), which size every window themselves, the size assertions are reported as SKIP and only a clean start is checked.

- **`run.cjs`** now uses a sandboxed window like the app. It checks that the CSP is in force (eval is blocked), that no Electron security warnings appear, and the window title. It passes dropped-file bytes from Node instead of fetching a `file://` URL, which the CSP rightly blocks.
- **Packaged-build testing:** `TB_APP_PATH=<…>/resources/app.asar TB_APP_BINARY=<…>/transcribee npm test` runs both suites against a build.
- **Where:** `main.js`, `index.html` (CSP), `script.js` §11 (title), `package.json` (`build`, the build scripts), `tests/smoke.cjs`, `tests/run.cjs`, `tests/launch.cjs`.
- **Verified by:**
  - In the project: `npm test` gives 105/105 plus 15/15 in the smoke test.
  - Against the unpacked Linux build (`npm run build:dir`): also 105/105 and 15/15, with fonts, WaveSurfer, Mediabunny, Signalsmith, video and the window state all working from inside `app.asar`.
  - On this machine (i3) the window-size assertions are skipped.
  - The Windows build wasn't built or run here.

### Phase 8: README

- **What:** a `README.md`. It covers:
  - what the app does;
  - requirements (Node 22+; ffmpeg and a display server for the tests; Pillow for the image script);
  - every npm command, and how to test a packaged build;
  - the file layout;
  - pointers to the `script.js` header and this change log.

  This log's file list is updated for `assets/`, `scripts/` and `tests/`.

- **Why:** there was no entry point for someone opening the project for the first time.
- **Where:** `README.md`, the header of `CHANGELOG.md`.

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
  - **Order matters:** `showPlayer()` is called in `loadMediaFile` right after the new file has decoded, _before_ the waveform draws. WaveSurfer measures its container when it draws, and a hidden container measures 0 px wide. This is the same reason the video layout switch happens before drawing.
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
  - **Anchoring.** WaveSurfer's `zoom()` re-renders synchronously and shifts the scroll to keep its _progress cursor_ in place. So `zoomBy` reads the time under the pointer first, zooms, then corrects the scroll so that time is back under the pointer. It measures the wrapper after the re-render, so WaveSurfer's own shift is already accounted for.
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
    1. A new segment copies the previous segment's loop fields. So the transport _always_ sends `loopStart` / `loopEnd`, with `0, 0` meaning no loop.
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
- **How:** key _releases_ match by key alone, ignoring Shift. Otherwise, pressing Shift while holding the play-while-held key (Z) would miss the release and leave it playing. Releases of every shortcut are still matched and `preventDefault`ed, because a focused button "clicks" on Space _release_.
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
  - Playback state and position mirror Signalsmith's timeline, so the position of what is _heard_ (allowing for the output delay) is computed exactly.
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
