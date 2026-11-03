// Stems (src/features/stems/): how the player mixes the stems, from each
// one's volume, pan, solo and mute. Solo and mute as a mixing desk does
// it: while any stem is soloed only the soloed ones play, and a muted one
// never does. Pure.
//
// Each stem reaches the two sides through a 2×2 mix, [left from left,
// left from right, right from left, right from right], so a pan can move
// it from one side to the other (panMatrix).
//
// A stem can be folded into "other" (removed from the mixer, its sound
// kept): it then plays exactly as Other does, its own settings kept for
// when it comes back.

/** @typedef {{ volume: number, pan: number, solo: boolean, mute: boolean, folded: boolean }} StemSetting */
/** @typedef {[number, number, number, number]} StemMatrix */

const OTHER = "other";

/**
 * Every stem at full volume and centred, none soloed or muted.
 * @param {{ id: string }[]} list
 * @returns {Record<string, StemSetting>}
 */
export const defaultMix = (list) =>
  Object.fromEntries(list.map(({ id }) => [id, { volume: 1, pan: 0, solo: false, mute: false, folded: false }]));

/**
 * The settings a stem plays with: Other's when it's folded into it.
 * @param {Record<string, StemSetting>} mix
 * @param {string} id
 * @returns {Partial<StemSetting>}
 */
const playing = (mix, id) => (mix[id]?.folded && id !== OTHER && mix[OTHER] ? mix[OTHER] : mix[id]) ?? {};

/**
 * @param {{ id: string }[]} list
 * @param {Record<string, StemSetting>} mix
 * @returns {Record<string, number>} each stem's gain, by id
 */
export function stemGains(list, mix) {
  // Only stems in the mixer count: a folded one's solo is hidden with it.
  const anySolo = list.some(({ id }) => mix[id]?.solo && !(mix[id].folded && id !== OTHER));
  return Object.fromEntries(
    list.map(({ id }) => {
      const { volume = 1, solo = false, mute = false } = playing(mix, id);
      return [id, mute || (anySolo && !solo) ? 0 : volume];
    }),
  );
}

/**
 * Where a pan (percent, -100 left … 100 right) sends a stereo stem's two
 * channels, as Web Audio's StereoPannerNode does it (equal power): the
 * side it moves away from fades out and crosses over to the other.
 * Centred, each channel stays where it is.
 * @param {number} pan
 * @returns {StemMatrix}
 */
export function panMatrix(pan) {
  const p = Math.max(-100, Math.min(100, pan)) / 100;
  if (p === 0) return [1, 0, 0, 1];
  if (p < 0) {
    const x = ((p + 1) * Math.PI) / 2;
    return [1, Math.cos(x), 0, Math.sin(x)];
  }
  const x = (p * Math.PI) / 2;
  return [Math.cos(x), 0, Math.sin(x), 1];
}

/**
 * Each stem's 2×2 mix: its pan, at its gain (stemGains).
 * @param {{ id: string }[]} list
 * @param {Record<string, StemSetting>} mix
 * @returns {Record<string, StemMatrix>}
 */
export function stemMixes(list, mix) {
  const gains = stemGains(list, mix);
  return Object.fromEntries(
    list.map(({ id }) => [
      id,
      /** @type {StemMatrix} */ (panMatrix(playing(mix, id).pan ?? 0).map((v) => v * gains[id])),
    ]),
  );
}

/**
 * Whether the mix is the song as it is: every stem at full volume and centred.
 * @param {Record<string, StemMatrix>} mixes
 */
export const isUnchanged = (mixes) =>
  Object.values(mixes).every(([ll, lr, rl, rr]) => ll === 1 && lr === 0 && rl === 0 && rr === 1);

/** A pan's readout: "Centre", "L 40" or "R 40". @param {number} pan */
export const formatPan = (pan) => (pan === 0 ? "Centre" : `${pan < 0 ? "L" : "R"} ${Math.abs(Math.round(pan))}`);
