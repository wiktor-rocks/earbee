# TranscriBee

A desktop player for transcribing music by ear. Open a song or a video, slow it down without changing the pitch (or shift the pitch without changing the speed), loop a passage, and step through it with the keyboard.

- **Speed** from 0.25× to 3× with presets, and **pitch** shift in semitones and cents. Both use [Signalsmith Stretch](https://signalsmith-audio.co.uk/code/stretch/).
- **A–B loop.** Shift+drag on the waveform, drag the edges to adjust, or use `[` `]` `L`.
- **Marks:** points and regions on the track, each with a name and a colour, shown in the marks lane above the waveform (with a faint guide line over it). `M` marks a point where you hear it (tap along while it plays); `R` starts a region and `R` again ends it. In the lane, drag a mark to move it, or a region's end to resize it; double-click to rename; Shift+← / Shift+→ go from mark to mark, Delete removes the selected one. The **Marks** sidebar on the right lists them (it scrolls on its own, so the page never grows), with **Point** and **Region** buttons; there you rename, recolour, delete and go to them. For now marks last until another file is opened.
- **Waveform** with a minimap, and a **time ruler** above it (click or drag it to seek). The wheel on the waveform or the lanes zooms at the mouse; the wheel on the minimap scrolls. A thin line follows the mouse and shows the time a click goes to; the playback cursor is 1 px wide, for precise placing. Markers never cover the sound: they live on the ruler and the marks lane, which always move with the waveform.
- **Keyboard stepping:**
  - ← / → step back and forward;
  - ↑ / ↓ change the step (0.01–10 s);
  - Space replays from where you started listening. That spot, the **start point**, is shown in green: a ▶ on the ruler (drag it to move it) with a guide line over the waveform, a tick on the minimap, and `▶ 0:05.000` in the transport bar (click it to go there). `S` sets it to what you're hearing now, without stopping. Where playback last stopped (paused, stopped or reached the end) is shown the same way in red, with a ■ on the ruler you can click to go back there.
- **Video:** the picture is decoded frame by frame with WebCodecs (via [Mediabunny](https://mediabunny.dev)) and always shows the frame at the audio position, so it stays in sync at any speed.
- **5-band EQ, volume up to 200 %,** and a limiter.
- **Long files:** songs and videos of an hour or two open reliably and fast (an hour of MP3 in about 7 s on a mid-range laptop: long tracks are decoded in parallel parts), with progress and a Cancel button. A file whose sound wouldn't fit in the available memory is refused with a message (about 1.2 GB per hour of stereo audio).
- **Download from YouTube.** Paste a link, or click **From YouTube…**, to get the audio or the video (up to 1080p). It's saved to `~/Downloads/TranscriBee/` and opened. You can choose another folder and the best video quality in Settings. This uses [yt-dlp](https://github.com/yt-dlp/yt-dlp), which TranscriBee downloads on first use (about 40 MB) and keeps up to date; nothing else needs installing. Only download what you have the rights to.
- **Settings:** the gear button opens them: the colour theme, and where downloads are saved, whether From YouTube starts on audio or video, and the best video quality (480p to 2160p). Changes apply at once and are remembered.
- **Colour themes:** dark (TranscriBee, Monokai, Dracula, Nord, One Dark) and light (TranscriBee Light, Solarized Light, Catppuccin Latte, GitHub Light, Gruvbox Light), or **Automatic**, which follows your system's dark or light mode (TranscriBee or TranscriBee Light unless you pick others). Pick one with the palette button in the top bar, or in Settings; it's remembered.
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
  window-state.js    remembers the window's size and position
  prefs-store.js     keeps the settings (prefs.json): checks, saves, the folder picker
  theme-store.js     the colour theme from the settings; applied before the page shows
  downloader.js      downloading links with yt-dlp
  media-files.js     serves downloaded files to the page by private URL
  system.js          available memory; recovering from a crashed page
  preload.js         the page's bridge to the main process (window.transcribee)
src/               The page (ES modules, no build step), in layers:
  core/              pure helpers, no DOM (unit-tested)
  themes/            colour themes: palettes/ (one file each) and the logic
  prefs/             settings: sections/ (one file each) and the field types
  marks/             marks: what one is, the saved form, the store
  config.js          every tunable number
  audio/             engine.js (Web Audio + Signalsmith), transport.js,
                     decoder.js + decode-worker.js (parallel decoding)
  video/             view.js, proxy.js
  waveform.js        WaveSurfer drawing, zoom, the loop region; its view (zoom,
                     scroll) for the lanes
  timeline.js        the lanes above the waveform: ruler (start/stop points),
                     marks lane, guide lines; follows the waveform's view
  context.js         settings, the track's marks, the shared components (`player`)
  ui/                dom.js, controls.js, shortcuts.js, theme.js, prefs.js,
                     pref-fields.js
  features/          playback.js, loop.js, marks.js, open-file.js, download.js,
                     theme-picker.js, settings.js, layout.js
  app.js             entry point: creates and wires everything
  vendor/            Signalsmith Stretch, patched (see its README.md)
index.html         The page: welcome screen, loading screen, player
style.css          All styles; colour and font tokens at the top
assets/            Logo and icons (generated from transcribee-source.png
                   by scripts/make-images.py)
tests/
  unit/              node:test unit tests (core, transport, decoding parts,
                     downloader, media files, system, themes, prefs, marks)
  run.cjs            end-to-end runner: e2e/harness.cjs plus topic files
  e2e/               01-static-ui.cjs … 15-security.cjs
  smoke.cjs          the real app: security, window state, the bridge
  preload.cjs        page instrumentation for the e2e tests
  fake-yt-dlp.cjs    stands in for yt-dlp, so downloads test offline
  launch.cjs, make-fixtures.sh
CHANGELOG.md       What changed, why, how and where, newest first
```

**Start with the comment at the top of `src/app.js`.** It maps how the parts fit together (engine, transport, waveform, video, UI), lists the files and their layers, and says where to make common changes: speed presets, EQ bands, step sizes, shortcuts, colours, new features.

**Layers.** In `src/`, a file only imports from the layers above it: `core` → `config` → `audio` / `video` / `waveform` / `timeline` → `context` → `ui` → `features` → `app.js`. `npm run lint` fails on an import that goes the other way, or on an import cycle. So `core/`, `audio/transport.js` and the rest of the lower layers stay free of the UI, and can be unit-tested in plain Node.

**Adding a setting.** Settings are declared in `src/prefs/sections/`, one file per section (a tab in the dialog). Add a field there: its `key`, `type` (`choice`, `boolean`, `number` or `folder`), `label`, optional `help` and `default`. The Settings dialog shows it, and the main process checks and saves it in `prefs.json`. The page reads it with `getPrefs("section")` and follows changes with `onPrefsChange` (`src/ui/prefs.js`); the main process uses `store.get` and `store.onChange` (`electron/prefs-store.js`). A new section is a new file listed in `SECTIONS` (`src/prefs/index.js`). The formats are described at the top of `src/prefs/fields.js`.

**Marks and TranscriBee files.** A mark is `{ id, start, end, label, color }` (`end: null` for a point), described in `src/marks/format.js` along with its saved form, `{ version: 1, marks: [...] }`. The store (`createMarks`, `src/marks/index.js`) lives in `context.js` and is changed through the actions in `src/features/marks.js`. Saving marks with a song will plug in at three places: `marks.toJSON()` is what to save, `marks.reset(duration, saved)` brings them back when the song opens (called from `resetMarks` in `features/marks.js`), and `marks.on("change")` fires once per edit. `src/marks/` is pure, so the main process can use `parseMarks` to check a file it reads.

**Adding a colour theme.** Copy a file in `src/themes/palettes/` (for example `nord.js`), give it a new `id`, `name`, `scheme` (`"dark"` or `"light"`) and colours for each role, then add it to `THEMES` in `src/themes/index.js`. The roles are listed, with what each colours, in `ROLES` in that file. `npm run test:unit` checks that the theme defines every role and that its text, accent, loop and error colours have enough contrast. It names any pair that fails.

**Record every change in [CHANGELOG.md](CHANGELOG.md):** what, why, how and where.
