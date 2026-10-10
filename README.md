# TranscriBee

A desktop player for transcribing music by ear. Open a song or a video, slow it down without changing the pitch (or shift the pitch without changing the speed), loop a passage, and step through it with the keyboard.

- **Speed** from 0.25× to 3× with presets, and **pitch** shift in semitones and cents. Both use [Signalsmith Stretch](https://signalsmith-audio.co.uk/code/stretch/).
- **A–B loop.** Shift+drag on the waveform, drag the edges to adjust, or use `[` `]` `L`.
- **Marks:** points and regions on the track, each with a name and a colour, shown in the marks lane above the waveform (with a faint guide line over it). `M` marks a point where you hear it (tap along while it plays); `R` starts a region and `R` again ends it. In the lane, drag a mark to move it, or a region's end to resize it; double-click to rename; Shift+← / Shift+→ go from mark to mark, Delete removes the selected one. The **Marks** sidebar on the right lists them (it scrolls on its own, so the page never grows), with **Point** and **Region** buttons; there you rename, recolour, delete and go to them. Marks are saved in project files (below).
- **Project files (`.tbee`).** **Save** (Ctrl+S) keeps the session: the marks, speed, pitch, volume and EQ, the A–B loop, the step size, where you were and the zoom. The first save asks whether to **link** to the song or video (a small file; keep the media where it is) or put it **inside** (one file that works anywhere, as large as the media); Ctrl+Shift+S saves as a new file. Open a project like any file (**File › Open…**, Ctrl+O or drop it). Open, Save, Save as and From YouTube are all in the **File** menu in the top bar. A linked song that moved is looked for next to the project (where it was relative to it) and then where it was; if it's in neither place, you're asked where it is. Unsaved changes show a • in the title, and TranscriBee asks before closing or opening something else.
- **Waveform** with a minimap, and a **time ruler** above it (click or drag it to seek). The wheel on the waveform or the lanes zooms at the mouse; the wheel on the minimap scrolls. A thin line follows the mouse and shows the time a click goes to; the playback cursor is 1 px wide, for precise placing. Every song is scaled alike (by its typical loudness, not its single loudest click), and Settings › Waveform picks the shape (bars, continuous, or peaks around loudness), loudness or peaks, a linear or dB scale, combined or left/right stereo, and the height. Markers never cover the sound: they live on the ruler and the marks lane, which always move with the waveform.
- **Keyboard stepping:**
  - ← / → step back and forward;
  - ↑ / ↓ change the step (0.01–10 s);
  - Space replays from where you started listening. That spot, the **start point**, is shown in green: a ▶ on the ruler (drag it to move it) with a guide line over the waveform, a tick on the minimap, and `▶ 0:05.000` in the transport bar (click it to go there). `S` sets it to what you're hearing now, without stopping. Where playback last stopped (paused, stopped or reached the end) is shown the same way in red, with a ■ on the ruler you can click to go back there.
- **Video:** the picture is decoded frame by frame with WebCodecs (via [Mediabunny](https://mediabunny.dev)) and always shows the frame at the audio position, so it stays in sync at any speed.
- **Video in its own window:** the button over the picture, or V, moves it to a window of its own (for a second screen, or a small window beside your editor). The main window then looks as it does for a song, with a strip to bring the video back. Moving the pointer over the video window shows the time, a pin to keep it on top, and Bring back. It's remembered: the next video, even after a restart, opens there too, until you bring it back or close that window. A song closes it.
- **Big video:** F, the other button over the picture, or a double-click on it makes the video the largest thing in the window, edge to edge (not fullscreen). The top bar, the marks, the sound controls and the minimap are put away. Under the picture is a thin strip with the whole track's waveform, like a video player's timeline (click or drag to seek; it doesn't zoom), then a compact transport. All the keys still work. Do the same again to go back: the waveform has its zoom as you left it, showing where you are now. It lasts from one video to the next; a song or a restart ends it.
- **5-band EQ, volume up to 200 %,** and a limiter.
- **Long files:** songs and videos of an hour or two open reliably and fast (an hour of MP3 in about 7 s on a mid-range laptop: long tracks are decoded in parallel parts), with progress and a Cancel button. A file whose sound wouldn't fit in the available memory is refused with a message (about 1.2 GB per hour of stereo audio).
- **Download from YouTube.** Paste a link, or pick **From YouTube…** (on the welcome screen or in the File menu), to get the audio or the video (up to 1080p). Or type words instead of a link to **search** YouTube or SoundCloud. You get 8 results at a time (**Show more** for the next 8), each with its picture, title, channel, length and views. Click one to download it, or use the arrow to open its page in your browser first. The site searched last is remembered (also in Settings › Downloads). If the uploader split the video into **chapters** (common on full albums, lessons and live sets), each one becomes a region named after it. Untick **Add the video's chapters as marks** in the dialog to skip them; that choice is remembered too. It's saved to `~/Downloads/TranscriBee/` and opened. You can choose another folder and the best video quality in Settings. This uses [yt-dlp](https://github.com/yt-dlp/yt-dlp), which TranscriBee downloads on first use (about 40 MB) and keeps up to date; nothing else needs installing. Only download what you have the rights to.
- **Notifications:** small messages at the bottom confirm that something worked: a project saved or a download saved (with where), a file opened, chapters added as marks. They fade on their own (a click dismisses one) and can be turned off in Settings › General. Problems always show in the transport bar.
- **Settings:** the gear button opens them: notifications, the colour theme, the waveform's look, and where downloads are saved, whether From YouTube starts on audio or video, and the best video quality (480p to 2160p). Changes apply at once and are remembered.
- **Colour themes:** dark (TranscriBee, Monokai, Dracula, Nord, One Dark, Gruvbox Dark, Solarized Dark, Catppuccin Mocha, Tokyo Night) and light (TranscriBee Light, Solarized Light, Catppuccin Latte, GitHub Light, Gruvbox Light, One Light, Tokyo Night Day, Everforest Light), or **Automatic**, which follows your system's dark or light mode (TranscriBee or TranscriBee Light unless you pick others). Pick one with the palette button in the top bar, or in Settings; it's remembered.
- **Works offline.** All libraries and fonts are bundled. Only downloading needs the internet.

**The layout.** The waveform takes all the spare height; the marks sidebar is on the right, and speed, pitch, volume and EQ sit in one dock along the bottom (the EQ's bands open in a popover from **Bands**). The page itself never scrolls. The sidebar always stays in view, so the window can take half a screen (about 960 px wide) and still show everything: under 1100 px it gets narrower. In a short window (under 720 px) the dock gets more compact. The smallest window is 900 × 640.

**Keyboard shortcuts:** the **?** button in the top bar (or the `?` key) lists every key, by group.

## Requirements

- **Node.js** 22 or newer, and npm.
- **For the tests:** `ffmpeg` with libvpx and libopus (to generate the test media), and a display server. The test windows are invisible, but Electron still needs X11 or Wayland.
- **For `scripts/make-images.py`:** Python 3 with Pillow.

## Commands

| Command                                      | What it does                                                                                                                                          |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm install`                                | Install dependencies                                                                                                                                  |
| `npm start`                                  | Run the app (reloads on file changes)                                                                                                                 |
| `npm run start:gpu-info` / `start:no-gpu`    | Run with GPU diagnostics / with software rendering                                                                                                    |
| `npm test`                                   | Unit tests, then end-to-end tests (`tests/run.cjs`), then a smoke test of the real app (`tests/smoke.cjs`)                                            |
| `npm run test:unit`                          | Unit tests only: plain Node, about a second                                                                                                           |
| `TB_TOPICS=02,10 npx electron tests/run.cjs` | Only some end-to-end topics (by number); later topics may need what earlier ones loaded                                                               |
| `npm run check`                              | Formatting (Prettier), lint (ESLint, including the import layering in `src/`) and type check (TypeScript on JSDoc)                                    |
| `npm run diagnose:loading`                   | Linux: measure loading of long files (10 min – 2 h) and write raw results to `tests/output/diagnostics/`; see `docs/diagnostics/long-file-loading.md` |
| `npm run format`                             | Format all files                                                                                                                                      |
| `npm run build:dir`                          | Unpacked Linux build in `dist/linux-unpacked`                                                                                                         |
| `npm run build:linux` / `build:win`          | Linux AppImage / Windows portable `.exe`                                                                                                              |

To test a packaged build:

```sh
npm run build:dir
TB_APP_PATH=$PWD/dist/linux-unpacked/resources/app.asar \
TB_APP_BINARY=$PWD/dist/linux-unpacked/transcribee npm test
```

## Files

```
electron/          The main process (CommonJS, Node)
  main.js            window, security, wiring
  windows.js         remembers a window's size and position; allows the video
                     window (the one other window)
  prefs-store.js     keeps the settings (prefs.json): checks, saves, the folder
                     picker; the colour theme, applied before the page shows
  downloader.js      downloading links, and searching by keywords, with yt-dlp
  media-files.js     serves downloaded files (or a slice of one) to the page by private URL
  project-files.js   reads and writes project files (.tbee); the close guard
  system.js          available memory; recovering from a crashed page
  preload.js         the page's bridge to the main process (window.transcribee)
src/               The page (ES modules, no build step), in layers:
  core/              pure helpers, no DOM (unit-tested); media.js: media files,
                     the memory check, waveform levels, decoding in parts
  themes/            colour themes: palettes.js (every theme) and the logic
  search/            searching: the sites (sources.js) and what a result is
  prefs/             settings: the sections (index.js) and the field types
  marks/             marks: what one is, the saved form, the store
  project/           project files: the header, its version, the media
  config.js          every tunable number
  audio/             engine.js (Web Audio + Signalsmith), transport.js,
                     decoder.js + decode-worker.js (parallel decoding)
  video/             view.js, proxy.js
  waveform.js        WaveSurfer: zoom, the loop region; its view (zoom,
                     scroll) for the lanes. waveform-draw.js draws it
                     (shaped by core/waveshape.js)
  timeline.js        the lanes above the waveform: ruler (start/stop points),
                     marks lane, guide lines; follows the waveform's view
  context.js         settings, the track's marks, the shared components (`player`)
  ui/                dom.js, controls.js, shortcuts.js, theme.js, prefs.js,
                     pref-fields.js, toast.js (notifications)
  features/          playback.js (and the A–B loop), marks.js, open-file.js,
                     download.js (and search), settings.js (and the theme
                     menu), layout.js,
                     project/ (index.js: save and open; sections.js: what is saved),
                     video-window/ (the video in its own window; self-contained)
  app.js             entry point: creates and wires everything
  vendor/            Signalsmith Stretch, patched (see its README.md)
index.html         The page: welcome screen, loading screen, player
style.css          All styles; colour and font tokens at the top
assets/            Logo and icons (generated from transcribee-source.png
                   by scripts/make-images.py)
tests/
  unit/              node:test unit tests (core, transport, decoding parts,
                     downloader, media files, system, themes, prefs, marks,
                     project files, search)
  run.cjs            end-to-end runner: e2e/harness.cjs plus topic files
  e2e/               01-static-ui.cjs … 16-projects.cjs
  smoke.cjs          the real app: security, window state, the bridge
  preload.cjs        page instrumentation for the e2e tests
  fake-yt-dlp.cjs    stands in for yt-dlp, so downloads test offline
  launch.cjs, make-fixtures.sh
CHANGELOG.md       What changed, why, how and where, newest first
```

**Start with the comment at the top of `src/app.js`.** It maps how the parts fit together (engine, transport, waveform, video, UI), lists the files and their layers, and says where to make common changes: speed presets, EQ bands, step sizes, shortcuts, colours, new features.

**Layers.** In `src/`, a file only imports from the layers above it: `core` → `config` → `audio` / `video` / `waveform` / `timeline` → `context` → `ui` → `features` → `app.js`. `npm run lint` fails on an import that goes the other way, or on an import cycle. So `core/`, `audio/transport.js` and the rest of the lower layers stay free of the UI, and can be unit-tested in plain Node.

**Adding a setting.** Settings are declared in `src/prefs/index.js`, one `defineSection()` per section (a tab in the dialog). Add a field to its section: its `key`, `type` (`choice`, `boolean`, `number` or `folder`), `label`, optional `help` and `default`. The Settings dialog shows it, and the main process checks and saves it in `prefs.json`. The page reads it with `getPrefs("section")` and follows changes with `onPrefsChange` (`src/ui/prefs.js`); the main process uses `store.get` and `store.onChange` (`electron/prefs-store.js`). A new section is another `defineSection()` there, listed in `SECTIONS`. The formats are described at the top of `src/prefs/fields.js`.

**Marks.** A mark is `{ id, start, end, label, color }` (`end: null` for a point), described in `src/marks/index.js` along with its saved form, `{ version: 1, marks: [...] }`. The store (`createMarks`, same file) lives in `context.js` and is changed through the actions in `src/features/marks.js`.

**Project files (.tbee).** A project is a JSON header, optionally followed by a NUL byte and the media's bytes (when the media is inside). The header is `{ format, version, savedWith, media, sections }`, described in `src/project/format.js`. **To save something new, add a section** to `SECTIONS` in `src/features/project/sections.js`. A section has an `id`, its own `version`, `capture()` (its saved form), `restore(data, { duration })` (check and clamp: the data comes from a file), and `dirties` (whether changing it counts as an unsaved change). Nothing else needs to change: saving, opening and spotting unsaved changes all go through the list. When a section's form changes, bump its `version` and teach `restore()` to read the old one. Older apps skip a section they don't know, and a section saved by a newer app is skipped with a notice. The main process (`electron/project-files.js`) writes the file to a temporary file and renames it into place, and serves media that's inside a project as a slice of it (`media-files.js`). The page names its media only by the private URL it was given, never by a path.

**Adding a colour theme.** In `src/themes/palettes.js`, copy a theme (for example `nord`), give it a new `id`, `name`, `scheme` (`"dark"` or `"light"`) and colours for each role, then add it to `THEMES` at the bottom of that file. The roles are listed, with what each colours, in `ROLES` in `src/themes/index.js`. `npm run test:unit` checks that the theme defines every role and that its text, accent, loop and error colours have enough contrast. It names any pair that fails.

**Record every change in [CHANGELOG.md](CHANGELOG.md):** what, why, how and where.
