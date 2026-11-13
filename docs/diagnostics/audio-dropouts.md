# Diagnostic: short dropouts in the sound

**Date:** 2026-11-13.
**Question:** since stem separation arrived (0.3.0), playback sometimes has short clicks or dropouts, with plenty of memory free and no video. Why?
**Status:** diagnosed and fixed the same day (see `CHANGELOG.md`, "No more dropouts with a stem muted on a busy computer"). The numbers below are from one Linux computer (8 cores, 14 GB, a USB sound interface, PipeWire at 48 kHz); how it sounds to the ear wasn't judged, only counted.
**Re-run:**

```
npm run diagnose:dropouts -- <a project with stems.ebee>
```

It plays quietly through the real sound device for about 10 minutes. See [How it was measured](#how-it-was-measured).

---

## The answer

Two things, both about the audio thread running out of time while the computer is busy with something else:

1. **Mixing the stems cost the audio thread more than twice its usual work.** With any stem muted, soloed, panned or turned down, the audio thread used 29 % of a core, against 13 % for the song as it is. The stretcher's worklet refills its whole input (about 0.1 s of sound) on every block of 128 samples, and the stems were mixed over all of it each time: 40 times the work needed, since all but the newest samples were mixed already in the block before.
2. **The sound went out through the smallest buffer the browser offers** (11 ms), which leaves the audio thread no slack. And on Linux that thread runs at ordinary priority, not real-time (`ps` shows it as `TS`), so busy programs can hold it up.

On a quiet computer neither shows: 10 minutes of a loop with a stem muted had no dropout at all. They show when something else works hard, most of all something that moves a lot of memory, as the stem model does while it separates the rest of a song.

## The numbers

Dropouts in 40 seconds of looped playback of a project with six stems (_Back in Black_, 4:14, 44.1 kHz), counted by the browser (`AudioContext.playbackStats.underrunEvents`), while other processes keep the computer busy. Each dropout is one buffer of silence (11 ms before, 23 ms after).

| Other processes  | Before: full mix | Before: a stem muted | After: full mix | After: a stem muted |
| ---------------- | ---------------: | -------------------: | --------------: | ------------------: |
| none             |                0 |                    0 |               0 |                   0 |
| 8 busy loops     |                0 |                    0 |               0 |                   0 |
| 16 busy loops    |                0 |                   38 |               0 |                   0 |
| 4 copying memory |                3 |                  201 |               0 |                   1 |
| 8 copying memory |              343 |                 2342 |              17 |                  46 |
| 8 allocating     |                8 |                  781 |               0 |                   0 |

The audio thread's share of one core, with no other processes:

|                                     | Full mix | A stem muted |
| ----------------------------------- | -------: | -----------: |
| Before                              |   12.8 % |       28.7 % |
| After (the mix kept between blocks) |   12.2 % |       13.0 % |

Each fix on its own, in the same test:

- **The mix kept between blocks** (the buffer still 11 ms): a stem muted fell to the full mix's level (38 → 1, 201 → 5, 2342 → 423, 781 → 6 dropouts); the full mix stayed as it was.
- **The larger buffer on top** ("playback": 23 ms, the output delay 82–89 ms against 48): the rest of the way, for both mixes (the "After" columns).

## What was ruled out

- **Clicks in the sound itself.** The app's output was recorded (a worklet on the way to the speakers) for the full mix and a muted stem, played straight and looped (loops of 2 s, 2.7 s and 0.55 s): nothing but the song's own drum hits stood out, at the loop's wrap or elsewhere, and no silent gaps.
- **Playing with stems loaded and nothing changed.** That's the same audio path as without stems (the worklet's stem line does nothing then), and it measured the same.
- **Plain lack of CPU.** Eight busy loops on eight cores caused no dropout, before or after. Memory traffic is what hurts: the audio thread's own share rises from 13 % to about 30 % of a core while other processes copy memory.
- **Lack of memory, swapping.** 8–9 GB stayed available throughout, with no swapping.

## While separating

A whole song separated with the real model while a loop of it played, a stem muted from the first part on (before the fixes):

- one run: bursts of dropouts while "Separating the rest" was at 77–93 % (up to 72 in 5 seconds), and a few after it ended;
- the same run again: none at all.

So separating alone doesn't cause them; it adds to whatever else the computer is doing. This wasn't measured again after the fixes: the test above stands in for it, repeatably.

## What's left

- Under the heaviest memory load the full mix still drops out now and then (17 in 40 s, with 8 processes copying memory non-stop). That's the stretcher's own work plus the thread's ordinary priority; a still larger buffer would trade more delay for it.
- The audio thread isn't real-time on Linux. That's the browser's doing (it needs the system's permission for real-time threads); not looked into further.
- Windows and macOS weren't measured.

## How it was measured

`tests/diagnostics/dropouts.cjs` starts the real app with a temporary profile, opens a copy of the project, and plays a 45-second loop at 3 % volume: every stem at full volume, then one muted, for each kind of load. It reads:

- **dropouts:** `AudioContext.playbackStats` (how many times the device had nothing to play, and for how long);
- **the audio thread's share of a core:** from `/proc`, the thread named "Realtime AudioWorklet";
- **the worst gap** between two blocks on the audio thread, from a small worklet the script adds.

The loads are plain Node processes: busy loops; pairs of 256 MB arrays copied back and forth; small arrays made and dropped.

It has to play through the real device: a silent or offscreen run hides dropouts. And the computer has to be left alone meanwhile, since anything else it does shows in the numbers. `TB_APP_BINARY=<AppImage>` measures a packaged build.
