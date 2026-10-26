# Glossary

The words the app and its docs use, and what they are in the code. Each entry: what you see, then the identifiers and the files where it lives. For how the parts fit together, see the comment at the top of `src/app.js`.

## Playing

| Word                    | What it is                                                                                    | In the code                                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Player**              | The audio engine and the transport, together.                                                 | `player` in `src/context.js` (`player.engine`, `player.transport`)                                              |
| **Engine**              | The Web Audio graph: time-stretching and pitch (Signalsmith Stretch), then EQ, then volume.   | `src/audio/engine.js`                                                                                           |
| **Transport**           | Play, pause, seek and loop: where the track is, and what plays next.                          | `src/audio/transport.js` (`playStartFor`, `positionAt`, `loop`)                                                 |
| **Speed**               | Playback speed, 0.05× to 3×, without changing the pitch.                                      | `settings.speed`; limits and presets in `CONFIG.speed` (`src/config.js`); the preset buttons are `#speedChips`  |
| **Pitch**               | Shift in semitones and cents, without changing the speed.                                     | `settings.semitones`, `settings.cents`                                                                          |
| **Start point**         | Where Space plays from next: the green line and ▶ readout. S sets it.                         | `startPoint()` and `returnPoint` in `src/features/playback.js`                                                  |
| **Stop point**          | Where playback last stopped: the red ■ and readout. Enter plays from it.                      | `stopPoint`, `setStopPoint` in `src/features/playback.js`                                                       |
| **Step**, **step size** | How far ← / → move: seconds, or "1 beat" / "1 bar" once the beats are found. ↑ / ↓ change it. | `settings.stepSize` (a number, `"beat"` or `"bar"`); sizes in `CONFIG.step`; `stepSizes` in `src/core/beats.js` |

## Looping and marking

| Word                    | What it is                                                                                  | In the code                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Loop**, **A–B loop**  | A stretch of the track that repeats. Shift+drag, `[` `]`, or `\` for a bar.                 | `loopRegion`, `setLoopRegion` in `src/features/playback.js`; drawn by `src/waveform.js`                  |
| **Loop by bar**         | `\` loops the bar you're in; `=` / `-` double or halve the loop.                            | `loopThisBar`, `resizeLoopBy` (`src/features/playback.js`); `spanAt`, `resizeLoop` (`src/core/beats.js`) |
| **Phrase**              | The loop moved on or back by its own length: Shift+`]` / Shift+`[`.                         | `moveLoopBy` (`src/features/playback.js`), `moveLoop` (`src/core/beats.js`)                              |
| **Snapping**            | Loop edges and marks jump to a beat close by, while the beat lines show; Alt places freely. | `snapToBeat`, `snapForDrag` in `src/features/beats.js`                                                   |
| **Mark**                | A point or a region on the track, named and coloured, listed in the sidebar.                | `Mark` in `src/marks/index.js`; `src/features/marks.js`                                                  |
| **Point**               | A mark at one time (M).                                                                     | a `Mark` whose `end` is `null`; `markPoint`                                                              |
| **Region**, **section** | A mark with a start and an end (R, then R). The site says "section".                        | a `Mark` with `end` > `start`; `markRegion`                                                              |

## Beats

| Word                           | What it is                                                                                           | In the code                                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Beats**, **beat lines**      | A line on each beat over the waveform, found on demand (B or the ♩ chip).                            | `beats` in `src/context.js` (`beats.times`); `src/features/beats.js`; drawn by `src/timeline.js` (`setBeats`)   |
| **Bars**, **downbeats**        | The first beat of each bar, a stronger line. Only the model finds them.                              | `beats.bars`, `beats.downbeat`                                                                                  |
| **Beat model**                 | Beat This!, run on ONNX Runtime in a utility process.                                                | `beats.method === "model"`; `electron/beat-model.js`, `electron/beat-model-process.js`; `src/core/beat-this.js` |
| **Simple beat finder**         | The fallback without bars (Intel Macs, outside Electron).                                            | `beats.method === "simple"`; `detectBeats` in `src/core/beats.js`                                               |
| **The ♩ chip**                 | Shows the tempo and the progress while finding; once found, opens the beats menu.                    | `#beatInfo`; `renderBeatInfo` in `src/ui/dom.js`                                                                |
| **Beat click**                 | A click on each beat while playing (Shift+B, or the beats menu). App-wide.                           | `general.beatClick`; "The beat click" in `src/features/beats.js`                                                |
| **Beats menu**                 | A click on the ♩ chip, once found: the lines, the beat click, and this project's edits to the beats. | `#beatMenu`; "The beats menu" in `src/features/beats.js`; `beats.edits`                                         |
| **Beats as found**             | What the finder gave, kept apart so every edit can be undone; projects save it.                      | `beats.raw`; the `beats` section in `src/features/project/sections.js`                                          |
| **Steady grid**                | Drops stray beats and fills gaps, so the beats don't waver between two tempos. On by default.        | `edits.steady`; `steady` in `src/core/beat-edits.js`; `CONFIG.beats.steady`                                     |
| **Half time**, **double time** | Every other beat (and bar), or a beat between each two.                                              | `edits.tempo` (0.5, 1, 2)                                                                                       |
| **Subdivisions**               | Fainter lines between the beats (halves, triplets, quarters); snapped to, never stepped or clicked.  | `edits.subdivide`, `beats.subdivisions`                                                                         |
| **Bar shift**                  | Bars starting a beat earlier or later than the model put them.                                       | `edits.barShift`                                                                                                |

## The window

| Word                        | What it is                                                                                    | In the code                                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Top bar**                 | The logo, File menu, file name and the buttons at the top.                                    | `.topbar` in `index.html`                                                                          |
| **Stage**                   | The video, the timeline and the minimap.                                                      | `#stage`                                                                                           |
| **Timeline**, **lanes**     | The ruler, the marks lane and the beat lines above and over the waveform, following its zoom. | `src/timeline.js`                                                                                  |
| **Waveform**                | The track's shape; click to seek, wheel to zoom.                                              | `src/waveform.js` (wavesurfer.js); drawing in `src/waveform-draw.js`                               |
| **Waveform shape**          | Bars, Continuous, or Peak + loudness (Settings › Waveform).                                   | `waveform.style`: `"bars"`, `"continuous"`, `"twoTone"` (Peak + loudness); `src/core/waveshape.js` |
| **Minimap**                 | The whole track under the waveform, with the visible part framed.                             | in `src/waveform.js`                                                                               |
| **Transport bar**           | Play, Stop, the step buttons, the time, and the chips (♩, start, stop, loop).                 | `.transport` in `index.html`                                                                       |
| **Dock**, **sound dock**    | Speed, pitch, volume and EQ, at the bottom.                                                   | `.dock` in `index.html`; "Sound dock" in `style.css`                                               |
| **Marks sidebar**           | The list of marks on the right; it can be hidden.                                             | `#sidebar`, `#marksList`                                                                           |
| **Notification**, **toast** | A short message that floats and fades ("Opened …").                                           | `notify` in `src/ui/toast.js`                                                                      |
| **Message line**            | A notice or an error under the timeline.                                                      | `showNotice`, `reportError` in `src/ui/dom.js`; `#message`                                         |
| **Splash**                  | The small window with the bee while the app starts.                                           | "The splash" in `electron/windows.js`; `electron/splash.*`                                         |

## Video

| Word             | What it is                                                                                | In the code                                                              |
| ---------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Proxy**        | A low-resolution copy of a video, built in memory, so seeking and odd speeds stay smooth. | `src/video/proxy.js`; `CONFIG.video.proxy`                               |
| **Big video**    | The picture as large as the window allows (F; Esc leaves it).                             | `src/features/big-video.js`                                              |
| **Video window** | The picture in its own window, e.g. on a second screen (V).                               | `src/features/video-window/`; `electron/windows.js` (`allowVideoWindow`) |

## Files, settings, downloads

| Word             | What it is                                                                            | In the code                                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Project**      | A `.ebee` file: the marks, loop, speed and EQ, linked to the media or with it inside. | format in `src/project/format.js`; what's saved: `SECTIONS` in `src/features/project/sections.js` (`sound`, `marks`, `loop`, `playback`, `view`); `electron/project-files.js` |
| **Settings**     | The Settings dialog's tabs and values, kept in `prefs.json`.                          | sections in `src/prefs/index.js` (`general`, `theme`, `waveform`, `downloads`); `electron/prefs-store.js`                                                                     |
| **Theme**        | A colour theme; "Automatic" follows the system.                                       | palettes in `src/themes/palettes.js` (ids such as `earbee`, `earbee-light`); `theme.choice`                                                                                   |
| **From YouTube** | Download by link, or search by words.                                                 | `src/features/download.js`, `src/search/`, `electron/downloader.js` (yt-dlp)                                                                                                  |
| **The bridge**   | What the page may ask of the main process.                                            | `window.earbee`, set up in `electron/preload.js`                                                                                                                              |
| **Media URL**    | How the page reads a local file: never by its path.                                   | `earbee-media://` in `electron/media-files.js`                                                                                                                                |
