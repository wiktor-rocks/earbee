# Signalsmith Stretch, patched

`SignalsmithStretch.mjs` is version 1.3.2 of [Signalsmith Stretch](https://signalsmith-audio.co.uk/code/stretch/) by Signalsmith Audio (MIT licence), as published on npm as `signalsmith-stretch`, with a header comment and one fix.

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

## Upgrading

Version 1.3.2 was the latest on npm on 2026-10-09. When a new version comes out:

1. Check whether its input loop (in `process`, after "Fill the buffer with previous input") is fixed.
2. If it's fixed, drop this folder and import from `node_modules` again (`src/audio/engine.js`).
3. If it isn't, copy the new file here, re-apply the two lines and the header, and run `npm test`.
