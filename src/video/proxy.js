import { CONFIG } from "../config.js";

// Low-resolution proxy of one video (see CONFIG.video.proxy). Built from
// `sourceSink` (a decoder of its own) with WebCodecs, kept in memory as
// encoded chunks, and read back with its own small decoder.
//   build(isBusy)  re-encodes the whole video; pauses while isBusy() is true
//   frameAt(time)  → VideoFrame for `time` (caller closes it), or null if
//                  that part isn't built yet or it is the frame last returned
//   dispose()      stops building and frees everything
export function createVideoProxy({ track, sourceSink }) {
  const { width, maxFps, keyframeInterval, bitrate } = CONFIG.video.proxy;
  // Even dimensions keep every encoder happy.
  const height = 2 * Math.max(1, Math.round((width * track.displayHeight) / track.displayWidth / 2));
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const chunks = []; // { time, end, key, chunk: EncodedVideoChunk }, in order
  let decoderConfig = null;
  let disposed = false;

  async function pickCodec() {
    for (const codec of ["vp8", "vp09.00.10.08", "avc1.42001f"]) {
      const config = { codec, width, height, bitrate, framerate: maxFps };
      const [encode, decode] = await Promise.all([
        VideoEncoder.isConfigSupported(config).catch(() => ({ supported: false })),
        VideoDecoder.isConfigSupported({ codec, codedWidth: width, codedHeight: height }).catch(() => ({
          supported: false,
        })),
      ]);
      if (encode.supported && decode.supported) return codec;
    }
    return null;
  }

  /* ---------- Building ---------- */

  async function build(isBusy) {
    const codec = await pickCodec();
    if (!codec) throw new Error("No video encoder available for the proxy.");

    const startedAt = performance.now();
    const encoder = new VideoEncoder({
      output: (chunk, metadata) => {
        if (metadata?.decoderConfig) decoderConfig = metadata.decoderConfig;
        const time = chunk.timestamp / 1e6;
        chunks.push({ time, end: time + (chunk.duration ?? 0) / 1e6, key: chunk.type === "key", chunk });
      },
      error: (error) => console.warn("Proxy encoder failed:", error),
    });
    encoder.configure({ codec, width, height, bitrate, framerate: maxFps, latencyMode: "realtime" });

    const scaled = new OffscreenCanvas(width, height);
    const scaledContext = scaled.getContext("2d");
    let nextTime = -Infinity;
    let count = 0;

    try {
      for await (const sample of sourceSink.samples()) {
        try {
          if (disposed) return;
          if (sample.timestamp >= nextTime - 1e-6) {
            sample.drawWithFit(scaledContext, { fit: "fill" }); // also applies rotation
            const frame = new VideoFrame(scaled, {
              timestamp: Math.round(sample.timestamp * 1e6),
              duration: Math.round(Math.max(sample.duration, 1 / maxFps) * 1e6),
            });
            encoder.encode(frame, { keyFrame: count % keyframeInterval === 0 });
            frame.close();
            count++;
            nextTime = sample.timestamp + 1 / maxFps;
          }
        } finally {
          sample.close();
        }
        // Don't run ahead of the encoder, give way to the main decoder, and
        // keep the page responsive.
        while (encoder.encodeQueueSize > 4 && !disposed) await sleep(1);
        while (isBusy() && !disposed) await sleep(5);
        if (count % 8 === 0) await sleep(0);
      }
      if (!disposed) await encoder.flush();
    } finally {
      if (encoder.state !== "closed") encoder.close();
    }

    const megabytes = chunks.reduce((sum, { chunk }) => sum + chunk.byteLength, 0) / 1024 ** 2;
    console.debug(
      `Video proxy: ${chunks.length} frames (${codec}, ${width}×${height}, ${megabytes.toFixed(1)} MB), ` +
        `built in ${Math.round(performance.now() - startedAt)} ms`,
    );
  }

  /* ---------- Reading ---------- */

  let decoder = null;
  let nextIndex = -1; // next chunk the decoder expects, when decoding in order
  const waiting = new Map(); // chunk timestamp (µs) → resolve(frame)

  function onOutput(frame) {
    const resolve = waiting.get(frame.timestamp);
    if (resolve) {
      waiting.delete(frame.timestamp);
      resolve(frame);
    } else {
      frame.close(); // a frame decoded only on the way to the wanted one
    }
  }

  function restartDecoder() {
    if (!decoder || decoder.state === "closed") {
      decoder = new VideoDecoder({
        output: onOutput,
        error: (error) => {
          console.warn("Proxy decoder failed:", error);
          decoder = null;
        },
      });
    } else {
      decoder.reset();
    }
    decoder.configure(decoderConfig);
    for (const resolve of waiting.values()) resolve(null);
    waiting.clear();
    nextIndex = -1;
  }

  // Index of the chunk shown at `time` (the last one starting at or before it).
  function indexAt(time) {
    let low = 0;
    let high = chunks.length - 1;
    if (high < 0 || time < chunks[0].time) return -1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (chunks[middle].time <= time) low = middle;
      else high = middle - 1;
    }
    return low;
  }

  function keyIndexBefore(index) {
    let i = index;
    while (i > 0 && !chunks[i].key) i--;
    return i;
  }

  async function frameAt(time) {
    if (disposed || !decoderConfig || !chunks.length || time > chunks.at(-1).end) return null;
    const index = indexAt(time);
    if (index < 0) return null;
    if (decoder && index === nextIndex - 1) return null; // already the latest frame

    // Continue in order when possible; otherwise start at the keyframe.
    const continuing = decoder && nextIndex >= 0 && nextIndex <= index && keyIndexBefore(index) < nextIndex;
    if (!continuing) restartDecoder();
    const first = continuing ? nextIndex : keyIndexBefore(index);

    for (let i = first; i < index; i++) decoder.decode(chunks[i].chunk);
    const wanted = chunks[index].chunk;
    const frame = new Promise((resolve) => waiting.set(wanted.timestamp, resolve));
    decoder.decode(wanted);
    nextIndex = index + 1;

    // A decoder that holds frames back would never answer; give up quickly.
    const timeout = sleep(250).then(() => {
      waiting.delete(wanted.timestamp);
      return null;
    });
    return Promise.race([frame, timeout]);
  }

  function dispose() {
    disposed = true;
    for (const resolve of waiting.values()) resolve(null);
    waiting.clear();
    if (decoder && decoder.state !== "closed") decoder.close();
    decoder = null;
    chunks.length = 0;
  }

  return {
    build,
    frameAt,
    dispose,
  };
}
