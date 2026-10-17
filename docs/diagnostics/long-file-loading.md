# Diagnostic: why long files load slowly or fail

**Date:** 2026-10-08.
**Question:** opening a file that's about an hour long takes very long, or fails. Why? What should change?
**Status:** diagnosed, then fixed the same day. [After the fix](#after-the-fix) has the new measurements, and [After parallel decoding](#after-parallel-decoding-and-downloads-by-url) (2026-10-09) the follow-ups. The rest of the report describes the app before the fix.
**Re-run:**

```
bash tests/diagnostics/make-long-media.sh
node tests/diagnostics/run.cjs
```

The results land in `tests/output/diagnostics/`. See [How it was measured](#how-it-was-measured).

---

## After parallel decoding (and downloads by URL)

Two follow-ups from the list at the end of "After the fix" were implemented (see `CHANGELOG.md`, "Long files decode in parallel" and "Downloads are read from disk").

- **Parallel decoding.**
  - A track of a minute or more is split into one part per spare core, up to 4. Each part is decoded by its own Worker (`src/audio/decoder.js`, `core/media.js`).
  - The parts aren't copied into one array. The time stretcher plays them one after the other, which needed a fix in Signalsmith Stretch (see below).
- **Downloads by URL.** The page reads a download from disk through a private URL (`electron/media-files.js`) instead of receiving its bytes.

### Load times

Same machine, same files, `npm run diagnose:loading`:

| File                          | Before the fix |   One worker |       4 workers | Peak renderer (one worker → 4) |
| ----------------------------- | -------------: | -----------: | --------------: | -----------------------------: |
| MP3 10 min                    |          4.3 s |        3.9 s |       **1.8 s** |                   399 → 507 MB |
| MP3 30 min                    |         12.7 s |       11.4 s |       **3.9 s** |                 892 → 1,032 MB |
| MP3 60 min                    |         25.7 s |       19.1 s |       **7.4 s** |               1,675 → 1,766 MB |
| MP3 90 min                    |             ❌ |       34.4 s |      **10.8 s** |               2,302 → 2,561 MB |
| MP3 120 min                   |             ❌ |       38.6 s |      **13.0 s** |               2,908 → 3,252 MB |
| AAC 30 / 45 min               |             ❌ | 8.5 / 12.4 s | **2.8 / 3.9 s** |   885 / 1,268 → 994 / 1,352 MB |
| AAC 60 min                    |             ❌ |       15.2 s |       **5.4 s** |               1,552 → 1,712 MB |
| Opus 60 min                   |         15.2 s |       25.1 s |       **7.7 s** |               1,628 → 1,836 MB |
| WAV 60 min                    |         20.7 s |        5.8 s |       **2.2 s** |               1,497 → 1,510 MB |
| Video 60 min, 720p            |             ❌ |       16.3 s |       **5.4 s** |               1,722 → 1,962 MB |
| MP3 60 min, 2 GB memory limit |        💥 died |       19.8 s |       **7.0 s** |               1,665 → 1,780 MB |

- **Faster:** loads are 2.6–3.5× faster, and Opus wins back its loss: 7.7 s, against 15.2 s before any fix.
- **Memory:** the peak is 1–12 % higher. That's four decoders and their working memory alive at once, and it grows with the length (+90 MB for an hour of MP3, +340 MB for two). Every memory-limited run still loads.
- **The UI:** it stays responsive (longest freeze 0.1–0.2 s).

**How many workers** (the app's decoder alone, an hour of MP3, on this 8-thread CPU):

| Workers | Decode | Peak renderer |
| ------: | -----: | ------------: |
|       1 | 20.6 s |      1,662 MB |
|       2 | 10.1 s |      1,692 MB |
|       3 |  7.1 s |      1,777 MB |
|       4 |  6.1 s |      1,785 MB |
|       6 |  5.6 s |      2,055 MB |

Beyond 4 workers the gain is small and the memory grows, so `CONFIG.audio.parallel.maxWorkers` is 4 (with one core left free: `min(cores − 1, 4)`). For Opus, 4 workers take 6.8 s against 28.6 s for one.

### The joins

The risk of decoding in parts is the joins. A decoder started in the middle of a stream needs some earlier audio to warm up: MP3's bit reservoir, the overlap of AAC's and Opus's transforms. Without it, the first samples of a part are wrong, which you hear as a click. And a part has to start at exactly the right sample.

- **Pre-roll.** Each part but the first starts decoding 1 s early (`preRoll`) and drops the warm-up.
  - Without the pre-roll, the comparison below found errors of up to 0.25 at every join for MP3, AAC and Opus.
  - With it, the samples are exact.
- **Placing a part by its samples.**
  - The timestamps aren't always sample-exact: in the WebM files, every Opus part came out 48 frames (1 ms) late. WebM timestamps are rounded to the millisecond, and Opus's codec delay isn't taken off mid-stream.
  - So each part decodes a little past its end. The next part is placed where its first 2,048 samples equal the earlier part's, within ±50 ms of where the timestamps put it (`findJoin`).
  - If no place matches, the track is decoded again in one part. That's slower, but never wrong.
- **The check.** The `seams` runs decode each file with one worker and with 4 (8 for a 10-minute MP3), compare every sample, and report each join's lag:

| File (60 min, 4 parts) | One worker | 4 workers | Result                  | Lag at the joins (frames) |
| ---------------------- | ---------: | --------: | ----------------------- | ------------------------- |
| MP3                    |     22.5 s |     6.1 s | identical, every sample | 0, 0, 0                   |
| AAC                    |     14.7 s |     4.2 s | identical               | 0, 0, 0                   |
| Opus (WebM)            |     27.4 s |     6.6 s | identical               | −48, −48, −48 (corrected) |
| WAV                    |      5.2 s |     1.9 s | identical               | 0, 0, 0                   |
| Video (AAC sound)      |     14.3 s |     4.7 s | identical               | 0, 0, 0                   |
| MP3 10 min, 8 parts    |      3.6 s |     1.3 s | identical               | all 0                     |

- **AAC at low bitrates isn't bit-exact** after a join. The e2e fixture, a 90 s chirp at 32 kb/s, differs by about 1.5·10⁻⁵ (−96 dB, below the 16-bit step) after each join, with an SNR of 79 dB overall.
  - The likely cause is the decoder's noise filling, whose random generator depends on where decoding started, as after any seek.
  - The joins themselves have no step. `tests/e2e/11-parallel.cjs` checks MP3 and Opus for identity and AAC for no step plus SNR > 60 dB.
- **Signalsmith Stretch had a bug when reading across buffers.**
  - Version 1.3.2, the latest, misreads its input when a block spans two of the buffers it was given (`addBuffers` more than once). It gave garbage and a `RangeError` in the worklet.
  - The app now uses a copy with a two-line fix, in `src/vendor/signalsmith-stretch/`.
  - An offline render of a signal from one buffer and from three gives identical output; `11-parallel.cjs` checks this on every run.

### Downloads by URL

A 1-hour 720p video (736 MB) opened as a download:

|                      | Before (bytes over IPC) | Now (by URL) |
| -------------------- | ----------------------: | -----------: |
| Page memory: peak    |                  2.4 GB |       1.6 GB |
| Page memory: settled |                  2.3 GB |       1.6 GB |
| Load                 |                  19.1 s |       15.5 s |

These are one-worker figures, measured before parallel decoding. The file is no longer kept in the page's memory while the video is open.

### What could come next

- **Start playing while decoding:** Signalsmith accepts audio in pieces. With parallel parts, the first part could play as soon as it's decoded.
- **Fewer parts on a low-memory machine:** the parallel peak is up to 12 % higher. The memory check could count it, or fall back to fewer workers when memory is tight.

---

## After the fix

Recommendations 1–5 were implemented (see `CHANGELOG.md`, "Long files open reliably"):

- **Decoding:** streaming decode in a Worker (`src/audio/decoder.js`, `decode-worker.js`), with progress and Cancel.
- **Rate:** the audio context runs at the file's rate (`engine.useSampleRate`).
- **Memory:** a memory check before decoding, with honest error messages.
- **Crashes:** a renderer-crash handler (`electron/system.js`).
- **Video limit:** no file-size limit for video any more.

Same machine, same files, same tool (`npm run diagnose:loading`):

| File                                 | Before: load, peak renderer      | After: load, peak renderer     |
| ------------------------------------ | -------------------------------- | ------------------------------ |
| MP3 10 min                           | 4.3 s, 578 MB                    | 3.9 s, 399 MB                  |
| MP3 30 min                           | 12.7 s, 1,485 MB                 | 11.4 s, 892 MB                 |
| MP3 60 min                           | 25.7 s, 2,779 MB                 | **19.1 s, 1,675 MB**           |
| MP3 90 min                           | (decode alone: 35.4 s, 4,148 MB) | 34.4 s, 2,302 MB               |
| MP3 120 min                          | ❌ "isn't an audio file"         | **38.6 s, 2,908 MB**           |
| AAC 30 / 45 min                      | (decode alone: 12.5 s / 19.0 s)  | 8.5 s / 12.4 s, 885 / 1,268 MB |
| AAC 60 min (like a YouTube download) | ❌ "isn't an audio file"         | **15.2 s, 1,552 MB**           |
| Video 60 min, 720p (AAC sound)       | ❌ "isn't an audio file"         | **16.3 s, 1,722 MB**           |
| WAV 60 min                           | 20.7 s, 3,476 MB                 | **5.8 s, 1,497 MB**            |
| Opus 60 min                          | 15.2 s, 2,935 MB                 | **25.1 s** (slower), 1,628 MB  |
| MP3 60 min, 2 GB memory limit        | 💥 the whole app died            | 19.8 s, 1,665 MB               |
| Video 60 min, 3 GB memory limit      | 💥 the whole app died            | 16.0 s, 1,721 MB               |
| Longest UI freeze, 60 min            | 2.0 s                            | 0.1–0.2 s                      |

**Every file now loads and plays,** at about the decoded size in memory (1.2–1.3 GB per hour of stereo, plus about 250 MB). That includes every memory limit tested.

**Where the time goes now,** measured in the worker for a 1-hour MP3:

| Step                                       |                                                                              Time |
| ------------------------------------------ | --------------------------------------------------------------------------------: |
| Decoding (WebCodecs)                       |                                                                            13.4 s |
| Copying the samples into the arrays        | about 4 s (`AudioSample.copyTo` plus the memory being touched for the first time) |
| The waveform peaks, in one pass at the end |                                                                             0.6 s |

Computing the peaks chunk by chunk as they arrived cost 2–4 s instead, so the peaks are computed at the end.

**Opus got slower** (15.2 → 25.1 s per hour): Chromium's WebCodecs Opus decoder takes 18.7 s per hour, against 14.3 s for the decoder inside `decodeAudioData`, and the copy comes on top. YouTube downloads are AAC, so this affects only Opus files opened from disk (`.opus`, `.webm`, `.ogg`).

**The video proxy for a 1-hour video,** not measurable before: 108,000 frames, 172 MB, built in 7.2 minutes in the background after loading. Memory stayed at about 1.7 GB throughout, and playback works meanwhile. So the proxy's size is now counted in the memory check, and the 2 GB file-size limit for videos is gone.

**What could come next** (the first and the third have since been done; see "After parallel decoding" above):

- **Decode in parallel:** several workers, each decoding a part of the file, appended in order with Signalsmith's `addBuffers`. On this 8-thread CPU that could cut decoding by several times for every format, and would win back the Opus loss. The risk is the seams: each part must start sample-exact and without a click (MP3's bit reservoir, Opus pre-roll), so it needs a test comparing the result with a serial decode.
- **Start playing while decoding:** Signalsmith accepts audio in pieces. The transport and waveform would need to handle a duration that's still growing.
- **Downloads pass the whole file to the page.** The download bridge (`download:start` → `result.bytes`) copies the downloaded file into the page's memory before opening it. For a long video that's its full size on top of the decoded sound. Opening the saved file by path instead would avoid that.

---

## Summary (before the fix)

1. **The cause is how the audio is decoded.** The app decodes the whole file in one `decodeAudioData` call ([open-file.js](../../src/features/open-file.js) `loadMediaFile`). That call takes **96 %** of the load time, holds **2.1×** the decoded audio in memory at its peak, and has a **size limit** of its own.
2. **Loads fail well before the machine runs out of memory.** `decodeAudioData` fails on **AAC from about 45–60 min** and on **MP3 from about 90–120 min**, even with 5 GB still free. AAC is the format of every YouTube download the app makes (`ba[ext=m4a]` in [downloader.js](../../electron/downloader.js)), including the soundtrack of downloaded videos. **So any hour-long YouTube download fails to open.** So did our 1-hour 720p MP4.
3. **The error is misleading.** The browser reports only `EncodingError: Unable to decode audio data`. The app turns that into _"Couldn't open … It isn't an audio file this app can decode"_, for a perfectly good file.
4. **Most of the time is resampling, not decoding.** The audio is converted from the file's rate (44.1 kHz) to the device's rate (48 kHz). For a 1-hour MP3 that takes **14.5 of 24.4 s**; for a 1-hour WAV, about 15.6 of 18.5 s.
5. **With less free memory, the whole app dies with no message.** Under a 2 GB memory limit, a 1-hour MP3 brought the whole app down; under 3 GB, the 1-hour video did too.
6. **The UI freezes for about 2 s per hour of audio**, in one block at the end of loading. Before that, the loading screen gives no progress and offers no Cancel.
7. **Streaming decode fixes the failures and most of the memory problem.** Decoding in chunks with mediabunny (already a dependency) handles every file tested. That includes the 1-hour AAC, the 1-hour video and the 2-hour MP3. For a 1-hour MP3 it peaks at **1.6 GB instead of 2.8 GB**, needs no full-file read, and works under the 2 GB limit that killed the app. It's faster for MP3, AAC and WAV but **slower for Opus**.

**Recommended fix:** stream-decode in a Worker at the file's own sample rate, and run the audio context at that rate. Details in [Recommendations](#recommendations).

---

## Test setup

|                   |                                                                                                                      |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| Machine           | AMD Ryzen 7 3750H (8 threads), 13.9 GB RAM (about 8.5 GB available during the runs), 7 GB swap, Fedora 43, Linux 7.2 |
| App               | Electron 44.4.5 (Chromium 152), project at commit `d09a3de`                                                          |
| Audio device rate | 48 kHz (the default `AudioContext` rate here)                                                                        |
| Window            | 1400×900 offscreen, `sandbox: true`, as in the app                                                                   |

**Test media** (synthetic: pink noise plus a tone per channel, so it's dense like music and the encoders work about as hard as on real songs):

| File                           | Format                                              | Size                        |
| ------------------------------ | --------------------------------------------------- | --------------------------- |
| `mp3-{10,30,60,90,120}min.mp3` | MP3 192 kb/s, stereo, 44.1 kHz                      | 14 / 43 / 86 / 130 / 173 MB |
| `aac-{30,45,60}min.m4a`        | AAC 128 kb/s, stereo, 44.1 kHz (like YouTube audio) | 29 / 44 / 58 MB             |
| `opus-60min.webm`              | Opus 128 kb/s, stereo, 48 kHz                       | 50 MB                       |
| `wav-60min.wav`                | 16-bit PCM, stereo, 44.1 kHz                        | 635 MB                      |
| `video-60min.mp4`              | H.264 1280×720 30 fps 1.5 Mb/s + AAC 128 kb/s       | 736 MB                      |

**Sizes, for reference.** One hour of stereo audio as 32-bit floats takes **1,318 MB at 48 kHz**, or **1,211 MB at 44.1 kHz**. That's the least memory any approach that keeps the whole track decoded can use, and the time-stretcher (Signalsmith) needs exactly that: one `Float32Array` per channel.

---

## Results

### 1. The app as a user uses it

"Load" is from choosing the file to the player being ready. The steps are the app's own timings (`createLoadTimer` in `open-file.js`). The renderer is the page's process: resident memory plus swap, sampled every 50 ms.

| File                     | Outcome                  |   Load | decode |  peaks |   rest | Peak renderer | Renderer after | Longest freeze |
| ------------------------ | ------------------------ | -----: | -----: | -----: | -----: | ------------: | -------------: | -------------: |
| MP3 10 min               | ✅ loaded, plays         |  4.3 s |  3.9 s | 0.15 s |  0.2 s |        578 MB |         382 MB |          0.5 s |
| MP3 30 min               | ✅ loaded, plays         | 12.7 s | 12.0 s | 0.34 s |  0.3 s |      1,485 MB |         824 MB |          1.1 s |
| MP3 60 min               | ✅ loaded, plays         | 25.7 s | 24.6 s | 0.71 s |  0.3 s |      2,779 MB |       1,486 MB |          2.0 s |
| MP3 120 min              | ❌ "isn't an audio file" | 17.1 s |      – |      – |      – |      3,062 MB |              – |              – |
| AAC 60 min               | ❌ "isn't an audio file" | 11.1 s |      – |      – |      – |      3,924 MB |              – |              – |
| Opus 60 min              | ✅ loaded, plays         | 15.2 s | 14.3 s | 0.64 s |  0.3 s |      2,935 MB |       1,489 MB |          1.9 s |
| WAV 60 min               | ✅ loaded, plays         | 20.7 s | 18.8 s | 0.68 s | 1.2 s¹ |      3,476 MB |       1,491 MB |          2.0 s |
| Video 60 min (AAC sound) | ❌ "isn't an audio file" |  9.7 s |      – |      – |      – |      3,394 MB |              – |              – |

¹ including 1.1 s to read the 635 MB file into memory.

**What this shows:**

- **Load time and memory grow linearly with length:** about 25 s and 2.6 GB of peak memory per hour of MP3, i.e. ≈0.4 s and 45 MB per minute.
- **The decode is almost all of it.** Reading the file, the peaks, drawing the waveform and handing the samples to the audio thread add up to under 1 s per hour (except the WAV read).
- **After loading, memory settles at the decoded size** (1.49 GB = 135 MB idle page + 1.32 GB of samples). The samples are _moved_ to the audio thread (`loadChannels`), not copied. The excess is only during decoding.
- **Every file that loaded also played** (Play pressed, the time moved).

### 2. `decodeAudioData` alone

This is the same call as the app's decode step, in isolation. "Native rate" means the `AudioContext` was created at the file's own 44.1 kHz.

| File        | Context rate          | Outcome                                                      |    Decode | Peak renderer | Decoded size |
| ----------- | --------------------- | ------------------------------------------------------------ | --------: | ------------: | -----------: |
| MP3 60 min  | 48 kHz (default)      | ✅                                                           |    24.4 s |      2,796 MB |     1,318 MB |
| MP3 60 min  | **44.1 kHz (native)** | ✅                                                           | **9.9 s** |      2,807 MB |     1,211 MB |
| MP3 90 min  | 48 kHz                | ✅                                                           |    35.4 s |      4,148 MB |     1,977 MB |
| AAC 30 min  | 48 kHz                | ✅                                                           |    12.5 s |      2,023 MB |       659 MB |
| AAC 45 min  | 48 kHz                | ✅                                                           |    19.0 s |      2,987 MB |       989 MB |
| AAC 60 min  | 48 kHz                | ❌ `EncodingError: Unable to decode audio data` after 10.4 s |         – |      3,919 MB |            – |
| WAV 60 min  | 48 kHz                | ✅                                                           |    18.5 s |      3,473 MB |     1,318 MB |
| Opus 60 min | 48 kHz (= native)     | ✅                                                           |    14.3 s |      2,912 MB |     1,318 MB |

**Resampling costs more than decoding.** For the 1-hour MP3, the native-rate context cut the decode from 24.4 s to 9.9 s. The memory timeline shows two phases:

```
renderer MB   0s:116  2s:303  4s:637  6s:983  8s:1284  10s:1776 │ 12s:1520  14s:1712  16s:1928
              18s:2100  20s:2314  22s:2514  24s:2679 │ 26s:2128  28s:1484
              ── decode at 44.1 kHz (~10 s) ──────────┘── resample to 48 kHz (~14 s) ──┘ done
```

During the second phase, both the 44.1 kHz and the 48 kHz copies are alive. That explains the peak of about 2.1× the decoded size. The WAV confirms it: it needs essentially no decoding (streaming it takes 2.9 s, below), yet `decodeAudioData` took 18.5 s.

**Where the size limit is.** Peak memory at failure ranges from 3.0 to 3.9 GB with 4.7–5.3 GB still available, so the system isn't running out. The thresholds:

|                | Works  | Fails   |
| -------------- | ------ | ------- |
| MP3 (44.1 kHz) | 90 min | 120 min |
| AAC (44.1 kHz) | 45 min | 60 min  |

_Hypothesis, consistent with all six points but not verified in Chromium's source._ One buffer inside the decoder has a limit of about **2 GiB**:

- **MP3:** stereo float at 44.1 kHz is 1.90 GB at 90 min (works) and 2.54 GB at 120 min (fails).
- **AAC:** it fails at half the length, as if it needed twice the bytes per minute (45 min ≈ 1.90 GB, 60 min ≈ 2.54 GB).

Whatever the exact mechanism, the practical limits are roughly **an hour or more for AAC** and **about 1.5–2 hours for MP3**. Higher-rate files (48 or 96 kHz) would hit them sooner.

### 3. Low free memory (cgroup limits)

The app ran inside a `systemd-run` scope with `MemoryMax` and no swap. This stands in for a machine with that much free memory.

| Run                                  | Limit    | Outcome                               |
| ------------------------------------ | -------- | ------------------------------------- |
| App, MP3 60 min                      | 4 GB     | ✅ loaded, 24.4 s                     |
| App, MP3 60 min                      | 3 GB     | ✅ loaded, 25.0 s                     |
| App, MP3 60 min                      | **2 GB** | 💥 **the whole app died**, no message |
| App, video 60 min                    | **3 GB** | 💥 **the whole app died**, no message |
| Streaming, MP3 60 min (samples kept) | 2 GB     | ✅ 17.4 s, 1,589 MB                   |

In both crashes, the kernel killed a helper process (the network service, then the GPU process). Electron then quit itself: `FATAL: GPU process isn't usable. Goodbye.`

On a real machine, things differ:

- there's swap, so the load first slows down badly;
- the kernel's OOM killer may kill the renderer instead;
- **`electron/main.js` has no `render-process-gone` handler**, so a killed renderer leaves a blank window.

Either way the user gets no explanation.

### 4. Streaming decode (the alternative)

mediabunny (`Input` + `AudioSampleSink`, decoding through WebCodecs) reads the file in chunks straight from disk (`BlobSource`) and decodes it chunk by chunk. These measurements ran it on the page's main thread:

- **"Discard"** drops each decoded chunk, measuring decode speed alone.
- **"Kept"** copies each chunk into preallocated `Float32Array`s at the file's own rate, as a real implementation would.

| File               | Mode     | Outcome            |       Time |  vs. app decode |           Peak renderer | First chunk after |
| ------------------ | -------- | ------------------ | ---------: | --------------: | ----------------------: | ----------------: |
| MP3 60 min         | discard  | ✅                 |     14.6 s |          24.6 s |                  286 MB |             12 ms |
| MP3 60 min         | **kept** | ✅                 | **17.5 s** |          24.6 s | **1,589 MB** (vs 2,779) |             15 ms |
| MP3 120 min        | kept     | ✅ (the app fails) |     33.9 s |               – |                2,886 MB |             14 ms |
| AAC 60 min         | discard  | ✅ (the app fails) |     11.8 s |               – |                  227 MB |              8 ms |
| Video 60 min (AAC) | discard  | ✅ (the app fails) |     12.0 s |               – |                  329 MB |              6 ms |
| WAV 60 min         | discard  | ✅                 |  **3.0 s** |          18.8 s |                  214 MB |              3 ms |
| Opus 60 min        | discard  | ✅                 | **20.6 s** | 14.3 s (faster) |                  253 MB |             12 ms |

**What this shows:**

- **Every file decodes.** The size limit is gone, because nothing ever needs one giant buffer.
- **Peak memory equals the decoded size plus about 250 MB of working memory.** There's no 2× peak, and no compressed copy of the file in memory: the 736 MB video was never read in whole.
- **Faster for MP3 (−30 %), WAV (−85 %) and AAC; slower for Opus (+45 %).** Chromium's WebCodecs Opus decoder is slower than the one `decodeAudioData` uses. Decoding several parts of the file in parallel workers (audio packets can be decoded independently) could make that up on a multi-core machine, but this wasn't measured.
- **The first audio arrives within about 15 ms.** Since Signalsmith's `addBuffers` appends audio in pieces ("lets you start playback before the entire audio is loaded", its README), the waveform could fill in and playback could start while the rest decodes.
- **On the main thread, streaming still causes freezes:**
  - **MP3:** 0.6 s (mediabunny's `computeDuration` scans the whole file);
  - **WAV:** 2 s (PCM is converted in JavaScript).

  A Worker would move these off the page.

### 5. The UI freeze

The page's main thread was blocked in **one block at the end of each load, about 0.5 s per 10 minutes** (0.5 / 1.1 / 2.0 s for 10 / 30 / 60 min). In the decode-only runs it was about 1.1 s per hour. That's `decodeAudioData` handing its result to the page; computing the peaks over every sample (`computePeaks` → `downsamplePeaks`) adds 0.7 s per hour on top. During the block the loading screen stops animating. Before it (the 10–25 s of decoding), the page stays responsive, but it shows no progress and the loading screen has no Cancel for files.

### 6. Not measured

- **The video proxy for a long video:** the 1-hour video never loaded, so the background re-encode ([proxy.js](../../src/video/proxy.js), about 3 MB per minute of video, so about 180 MB per hour, plus CPU for its whole length) is untested at this length. _Measured after the fix: see [After the fix](#after-the-fix)._
- **Real music.** The synthetic sound is dense, so encoder and decoder costs should be close, but real files with 96 kHz or 5.1 sound would need more memory.
- **Windows and macOS.** The memory measurements use Linux `/proc`, and the limits may differ elsewhere.
- **Longer than 2 hours with streaming.** Memory then is simply the decoded size: about 1.2 GB per hour of stereo at 44.1 kHz.

---

## Recommendations

They're ordered by value. The first two are the fix; 3–5 are independent and small.

### 1. Stream-decode in a Worker (fixes the failures, the memory peak and the progress)

Replace `file.arrayBuffer()` + `engine.decode()` in `loadMediaFile` with a decoder in a dedicated Worker:

- It opens the file with mediabunny (`BlobSource` reads it in pieces; a `File` can be posted to a Worker).
- It decodes with `AudioSampleSink`.
- It writes each chunk into per-channel `Float32Array`s sized from the track's duration (with some slack, trimmed at the end).
- It computes the waveform peaks per chunk as it goes, which removes `computePeaks`'s 0.7 s per hour on the main thread.
- It reports progress and supports cancelling.
- At the end, it transfers the arrays to the page, which moves them on to Signalsmith, as now.

**Expected, from the measurements:**

|                                              | Now          | Expected        |
| -------------------------------------------- | ------------ | --------------- |
| 1-hour MP3 load                              | 25.7 s       | ≈ 17–18 s       |
| 1-hour MP3 peak memory                       | 2.8 GB       | ≈ 1.6 GB        |
| 1-hour AAC / YouTube download / 1-hour video | fails        | ≈ 12 s          |
| 2-hour MP3                                   | fails        | ≈ 34 s, 2.9 GB  |
| 1-hour WAV                                   | 20.7 s       | ≈ 3–4 s         |
| 1-hour Opus                                  | 15.2 s       | ≈ 21 s (slower) |
| UI freeze at the end                         | 2 s per hour | ≈ 0             |
| Progress / Cancel                            | none         | yes             |

**For Opus**, either accept the slower decode, keep `decodeAudioData` for Opus files of moderate length, or try parallel decoding.

**Later:** append the audio to Signalsmith while it decodes, so playback can start within a second. That needs the transport and waveform to cope with a duration that's still growing, so it's best done as a second step.

### 2. Run the audio context at the file's sample rate

Signalsmith reads its buffers at the `AudioContext`'s rate (it has no rate setting). To keep the samples at the file's own rate, which is what streaming produces, the context has to run at that rate. Chromium then converts the output to the device's rate in real time, cheaply.

- **How:** `engine.init()` creates the context once, so it needs to rebuild the context and Signalsmith when a file's rate differs from the current one. mediabunny gives the track's rate before decoding.
- **Benefit:** no resampling pass at all (that's 14.5 s of the 24.4 s for a 1-hour MP3), and 8 % less memory for 44.1 kHz files.
- **Also on its own:** with today's `decodeAudioData`, a context at the file's rate cuts a 1-hour MP3's decode from 24.4 s to 9.9 s. It doesn't change the peak memory or the size limit, though.
- **Check:** EQ, limiter and pitch behave the same at 44.1 kHz. Biquad frequencies are in Hz, so they should.

### 3. Tell the user the truth when a long file fails

Until recommendation 1 lands, or as a safety net after it:

- When the decode fails, check with mediabunny whether the file has an audio track it can read. If it does, the problem is size: say _"“…” is too long to open (about N minutes; this app can open about M)"_ instead of _"isn't an audio file"_.
- Better, check before decoding:
  1. estimate the decoded size from the duration (duration × rate × channels × 4 bytes);
  2. compare it with the free memory (`os.freemem()` from the main process);
  3. warn or refuse up front, rather than letting the system kill the app.

### 4. Handle a crashed renderer

`electron/main.js` has no `render-process-gone` handler. If the renderer is killed (out of memory, or a GPU fault), the window goes blank. Add a handler that reloads the page and shows a message (e.g. "EarBee ran out of memory opening that file").

### 5. Revisit `CONFIG.maxFileBytes` (2 GB)

With streaming, the compressed file is no longer read into memory, so the limit no longer protects anything for audio. What matters then is the decoded size, which recommendation 3 checks. For video, the limit can go too, provided the proxy is measured at that length (see §6).

### Not recommended

- **Storing samples as 16-bit to halve memory:** Signalsmith needs `Float32Array`s, so they'd have to be converted back anyway.
- **A mono option** would halve memory for very long files, but it changes what the user hears. Consider it only if files over 2 hours matter.

---

## How it was measured

- **`tests/diagnostics/make-long-media.sh`** generates the media above into `tests/output/long-media/` (not committed, about 1.9 GB) with ffmpeg. It skips files that already exist.
- **`tests/diagnostics/profile-load.cjs`** makes one measurement in a fresh Electron process. It loads the real `index.html` with the real preload and settings store (`electron/prefs-store.js`), as the e2e harness does. Then it:
  - puts the file in the app's file input (DevTools protocol `DOM.setFileInputFiles`), the same path as a user choosing a file;
  - samples `/proc/<pid>/status` (`VmRSS` + `VmSwap`) of the renderer, and of every Electron process, every 50 ms, plus `/proc/meminfo` for the system;
  - runs a 16 ms heartbeat on the page; a gap over 100 ms counts as a freeze;
  - waits for Play to be enabled (loaded), an error to be logged (error shown), the renderer to die, or 15 min;
  - for loaded files, presses Play and checks that the time moves.

  The other modes (`decode`, `decode-native`, `stream`, `stream-discard`, `workers`, `seams`) run the same decode code in isolation on the page: `workers` decodes in parallel parts, and `seams` also checks where the parts join.

- **`tests/diagnostics/run.cjs`** runs the whole plan (each run in its own process and profile, optionally inside `systemd-run --user --scope -p MemoryMax=… -p MemorySwapMax=0`). It writes one JSON per run, with a 250 ms memory timeline, plus `results.json` and a summary table. A run takes about 40 minutes (the two video runs wait about 7 minutes each for the proxy). `node tests/diagnostics/run.cjs <text>` runs only the ids containing `<text>`.
- **Caveats:**
  - Summing the resident memory of every process counts shared pages more than once, so "all processes" figures are upper bounds; the renderer figure is the reliable one.
  - Timings vary by a few per cent between runs: the 10-minute MP3 took 4.6 and 4.3 s in two runs, the 1-hour MP3 25.7, 24.4 and 25.0 s in three.

**Raw results:** `tests/output/diagnostics/*.json` (regenerated by the run, not committed). The tables above were copied from the run on 2026-10-08.
