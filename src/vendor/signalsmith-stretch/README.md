# Signalsmith Stretch, patched

`SignalsmithStretch.mjs` is version 1.3.2 of [Signalsmith Stretch](https://signalsmith-audio.co.uk/code/stretch/) by Signalsmith Audio (MIT licence), as published on npm as `signalsmith-stretch`, with a header comment, one fix, and one addition: mixing stems into its input.

## The fix

When the stretcher reads its input from several buffers (`addBuffers` called more than once), the loop that fills its input block mixes up two positions when a block starts inside one buffer and runs into the next:

- after copying from a buffer, it advanced the buffer's start (`audioSamples`) by the number of samples copied, instead of moving it to the buffer's end (`bufferEnd`, computed but never used);
- it never advanced the read position (`inputSamples`).

So it read the wrong part of the next buffer, or threw `RangeError: offset is out of bounds` in the worklet. With one buffer, which is how the app used it until parallel decoding, nothing is wrong.

The two marked lines (search for `patched`) fix it:

```js
inputSamples += count; // was: audioSamples += count
// …
audioSamples = bufferEnd; // replaces the else branch that skipped a buffer
```

**Verified by:**

- **an offline render:** rendering a signal from one buffer and from three buffers split at odd places gives identical output with the fix, and garbage plus a `RangeError` without it;
- **`tests/e2e/13-parallel.cjs`**, which checks this on every run.

## The addition: mixing stems

Stems (`src/features/stems/`) play through the same stretcher as the track, so they stay in step at any speed and pitch, at the cost of one stretcher. The worklet keeps the track's stems beside its buffers and mixes them in where it copies its input:

- three remote methods: `addStems({ tracks, scales })` (each stem's channels as `Int16Array`s from the track's first sample, at its rate, and the factor that turns them back into samples), `setStemGains(gains, other)` and `dropStems()`; `dropBuffers()` with no time (a new track) drops them too;
- one line in the input loop, after a piece of the track is copied: `if (this.stems?.active) this.mixStems(…)`;
- `mixStems`, which turns those samples into `other × track + Σ (gain − other) × stem`: "other" is the track minus the stems, so it needs no array of its own, and with every gain at 1 the result is the track.

**Opt-in:** without stems, or with every gain at 1 (`active` false), the line does nothing and the input is the track exactly as before. Search for `patched` to find each part.

**Verified by `tests/e2e/21-stems.cjs`:** an offline render with stems loaded at full volume is identical, sample for sample, to one without; a muted stem and a soloed one come out as expected.

## Upgrading

Version 1.3.2 was the latest on npm on 2026-10-09. When a new version comes out:

1. Copy the new file here, with the header.
2. Check whether its input loop (in `process`, after "Fill the buffer with previous input") is fixed. If it isn't, re-apply the fix's two lines.
3. Re-apply the stems addition, which isn't upstream: each part marked `patched` above.
4. Run `npm test` (the pieces: topic 11; the stems: topic 21).
