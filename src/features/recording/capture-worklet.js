// Recording (src/features/recording/): collects the input's samples on the
// audio thread (capture.js loads it into the player's AudioContext). It
// only copies: the input's channels into one (`channel`: its number, or
// "mix" for their average), a block at a time into a chunk, posted when
// full with the frame its first sample was rendered at (the context's
// clock, in samples), so the page knows exactly when each was.
//
//   to it:    { on: true } starts; { on: false } stops (the chunk part filled is posted, then { done: true })
//   from it:  { frame, samples } (the Float32Array transferred)

// The audio thread's own globals (AudioWorkletProcessor, currentFrame,
// registerProcessor), which the page's type check doesn't know.
const scope = /** @type {any} */ (globalThis);

const CHUNK = 4096; // samples a message (about 90 ms)

class CaptureProcessor extends scope.AudioWorkletProcessor {
  constructor(options) {
    super();
    this.channel = options.processorOptions?.channel ?? "mix";
    this.on = false;
    this.chunk = new Float32Array(CHUNK);
    this.filled = 0;
    this.frame = 0; // the chunk's first sample
    this.port.onmessage = ({ data }) => {
      this.on = data.on === true;
      if (this.on) return;
      this.post();
      this.port.postMessage({ done: true });
    };
  }

  post() {
    if (this.filled) {
      const samples = this.chunk.slice(0, this.filled);
      this.port.postMessage({ frame: this.frame, samples }, [samples.buffer]);
    }
    this.filled = 0;
  }

  process(inputs) {
    const input = inputs[0];
    // No channels: the input isn't running (yet); the next chunk says when it was.
    if (!this.on || !input.length) {
      if (this.filled) this.post();
      return true;
    }
    const length = input[0].length;
    if (this.filled + length > CHUNK) this.post();
    if (!this.filled) this.frame = scope.currentFrame;

    const one = typeof this.channel === "number" ? input[Math.min(this.channel, input.length - 1)] : null;
    if (one) {
      this.chunk.set(one, this.filled);
    } else {
      for (let i = 0; i < length; i++) {
        let sum = 0;
        for (const channel of input) sum += channel[i];
        this.chunk[this.filled + i] = sum / input.length;
      }
    }
    this.filled += length;
    return true;
  }
}

scope.registerProcessor("earbee-capture", CaptureProcessor);
