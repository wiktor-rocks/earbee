# TranscriBee

A desktop player for transcribing music by ear. Open a song or a video, slow it down without changing the pitch (or shift the pitch without changing the speed), loop a passage, and step through it with the keyboard.

- **Speed** from 0.25× to 3× with presets, and **pitch** shift in semitones and cents. Both use [Signalsmith Stretch](https://signalsmith-audio.co.uk/code/stretch/).
- **A–B loop.** Shift+drag on the waveform, drag the edges to adjust, or use `[` `]` `L`.
- **Waveform** with a minimap. Ctrl + wheel zooms at the mouse; the wheel scrolls.
- **Keyboard stepping:**
  - ← / → step back and forward;
  - ↑ / ↓ change the step (0.01–10 s);
  - Space replays from where you started listening.
- **Video:** the picture is decoded frame by frame with WebCodecs (via [Mediabunny](https://mediabunny.dev)) and always shows the frame at the audio position, so it stays in sync at any speed.
- **5-band EQ, volume up to 200 %,** and a limiter.
- **Download from YouTube.** Paste a link, or click **From YouTube…**, to get the audio or the video (up to 1080p). It's saved to `~/Downloads/TranscriBee/` and opened. This uses [yt-dlp](https://github.com/yt-dlp/yt-dlp), which TranscriBee downloads on first use (about 40 MB) and keeps up to date; nothing else needs installing. Only download what you have the rights to.
- **Works offline.** All libraries and fonts are bundled. Only downloading needs the internet.

The shortcut legend at the bottom of the window lists every key.

## Requirements

- **Node.js** 22 or newer, and npm.
- **For the tests:** `ffmpeg` with libvpx and libopus (to generate the test media), and a display server. The test windows are invisible, but Electron still needs X11 or Wayland.
- **For `scripts/make-images.py`:** Python 3 with Pillow.

## Commands

| Command                                   | What it does                                                                              |
| ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| `npm install`                             | Install dependencies                                                                      |
| `npm start`                               | Run the app (reloads on file changes)                                                     |
| `npm run start:gpu-info` / `start:no-gpu` | Run with GPU diagnostics / with software rendering                                        |
| `npm test`                                | End-to-end tests (`tests/run.cjs`), then a smoke test of the real app (`tests/smoke.cjs`) |
| `npm run check`                           | Formatting (Prettier), lint (ESLint) and type check (TypeScript on JSDoc)                 |
| `npm run format`                          | Format all files                                                                          |
| `npm run build:dir`                       | Unpacked Linux build in `dist/linux-unpacked`                                             |
| `npm run build:linux` / `build:win`       | Linux AppImage / Windows portable `.exe`                                                  |

To test a packaged build:

```sh
npm run build:dir
TB_APP_PATH=$PWD/dist/linux-unpacked/resources/app.asar \
TB_APP_BINARY=$PWD/dist/linux-unpacked/transcribee npm test
```

## Files

```
main.js            Electron main process: window, security, window state
downloader.js      Downloading links with yt-dlp (main process)
preload.js         The page's bridge to downloader.js (window.transcribee)
index.html         The page: welcome screen, loading screen, player
style.css          All styles; colour and font tokens at the top
script.js          All app logic, in numbered sections (§1 Config … §14 Startup)
assets/            Logo and icons (generated from transcribee-source.png
                   by scripts/make-images.py)
tests/             run.cjs (end-to-end), smoke.cjs (real app), preload.cjs
                   (instrumentation), fake-yt-dlp.cjs (offline downloads),
                   launch.cjs, make-fixtures.sh
CHANGELOG.md       What changed, why, how and where, newest first
```

**Start with the comment at the top of `script.js`.** It maps how the parts fit together (engine, transport, waveform, video, UI) and lists where to make common changes: speed presets, EQ bands, step sizes, shortcuts, colours.

**Record every change in [CHANGELOG.md](CHANGELOG.md):** what, why, how and where.
