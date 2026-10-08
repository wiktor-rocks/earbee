# Diagnostic: why long files load slowly or fail

**Date:** 2026-10-08.
**Question:** opening a file that's about an hour long takes very long, or fails. Why? What should change?
**Status:** diagnosis only. No app code was changed.
**Re-run:**

```
bash tests/diagnostics/make-long-media.sh
node tests/diagnostics/run.cjs
```

The results land in `tests/output/diagnostics/`. See [How it was measured](#how-it-was-measured).

---

## Summary

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

- **The video proxy for a long video:** the 1-hour video never loaded, so the background re-encode ([proxy.js](../../src/video/proxy.js), about 3 MB per minute of video, so about 180 MB per hour, plus CPU for its whole length) is untested at this length. Measure it once long videos load.
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

`electron/main.js` has no `render-process-gone` handler. If the renderer is killed (out of memory, or a GPU fault), the window goes blank. Add a handler that reloads the page and shows a message (e.g. "TranscriBee ran out of memory opening that file").

### 5. Revisit `CONFIG.maxFileBytes` (2 GB)

With streaming, the compressed file is no longer read into memory, so the limit no longer protects anything for audio. What matters then is the decoded size, which recommendation 3 checks. For video, the limit can go too, provided the proxy is measured at that length (see §6).

### Not recommended

- **Storing samples as 16-bit to halve memory:** Signalsmith needs `Float32Array`s, so they'd have to be converted back anyway.
- **A mono option** would halve memory for very long files, but it changes what the user hears. Consider it only if files over 2 hours matter.

---

## How it was measured

- **`tests/diagnostics/make-long-media.sh`** generates the media above into `tests/output/long-media/` (not committed, about 2 GB) with ffmpeg. It skips files that already exist.
- **`tests/diagnostics/profile-load.cjs`** makes one measurement in a fresh Electron process. It loads the real `index.html` with the real preload and theme store, as the e2e harness does. Then it:
  - puts the file in the app's file input (DevTools protocol `DOM.setFileInputFiles`), the same path as a user choosing a file;
  - samples `/proc/<pid>/status` (`VmRSS` + `VmSwap`) of the renderer, and of every Electron process, every 50 ms, plus `/proc/meminfo` for the system;
  - runs a 16 ms heartbeat on the page; a gap over 100 ms counts as a freeze;
  - waits for Play to be enabled (loaded), an error to be logged (error shown), the renderer to die, or 15 min;
  - for loaded files, presses Play and checks that the time moves.

  The other modes (`decode`, `decode-native`, `stream`, `stream-discard`) run the same decode code in isolation on the page.

- **`tests/diagnostics/run.cjs`** runs the whole plan (each run in its own process and profile, optionally inside `systemd-run --user --scope -p MemoryMax=… -p MemorySwapMax=0`). It writes one JSON per run, with a 250 ms memory timeline, plus `results.json` and a summary table. A run takes about 15 minutes. `node tests/diagnostics/run.cjs <text>` runs only the ids containing `<text>`.
- **Caveats:**
  - Summing the resident memory of every process counts shared pages more than once, so "all processes" figures are upper bounds; the renderer figure is the reliable one.
  - Timings vary by a few per cent between runs: the 10-minute MP3 took 4.6 and 4.3 s in two runs, the 1-hour MP3 25.7, 24.4 and 25.0 s in three.

**Raw results:** `tests/output/diagnostics/*.json` (regenerated by the run, not committed). The tables above were copied from the run on 2026-10-08.
