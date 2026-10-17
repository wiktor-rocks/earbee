// Opening a file's audio track with Mediabunny, for the Workers that read
// it: decode-worker.js (the sound to play) and beat-worker.js (the beats).
import { ALL_FORMATS, BlobSource, Input, UrlSource } from "../../node_modules/mediabunny/dist/bundles/mediabunny.mjs";
import { mediaSource } from "../core/media.js";

// A failure the page can explain; `kind` is one of decode-worker.js's.
export class DecodeError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

/**
 * The primary audio track of `media` (a File, or { name, url }: core/media.js),
 * with when it starts and how long it is. Throws a DecodeError
 * ("cannot-decode" or "no-audio") if it can't be read.
 * @param {import("../core/media.js").Media} media
 */
export async function openTrack(media) {
  const input = new Input({ formats: ALL_FORMATS, source: mediaSource(media, { BlobSource, UrlSource }) });
  let track;
  try {
    track = await input.getPrimaryAudioTrack();
  } catch (error) {
    throw new DecodeError("cannot-decode", String(error?.message ?? error));
  }
  if (!track) throw new DecodeError("no-audio", "no audio track");
  if (!(await track.canDecode())) throw new DecodeError("cannot-decode", `can't decode ${track.codec ?? "its codec"}`);

  const [end, first] = await Promise.all([track.computeDuration(), track.getFirstTimestamp()]);
  return {
    input,
    track,
    first,
    duration: end - first,
    sampleRate: track.sampleRate,
    channels: track.numberOfChannels,
  };
}
