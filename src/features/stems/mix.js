// Stems (src/features/stems/): the gains the player mixes the stems with,
// from each one's volume, solo and mute, as a mixing desk does it: while
// any stem is soloed only the soloed ones play, and a muted one never
// does. Pure.

/** @typedef {{ volume: number, solo: boolean, mute: boolean }} StemSetting */

/**
 * Every stem at full volume, none soloed or muted.
 * @param {{ id: string }[]} list
 * @returns {Record<string, StemSetting>}
 */
export const defaultMix = (list) =>
  Object.fromEntries(list.map(({ id }) => [id, { volume: 1, solo: false, mute: false }]));

/**
 * @param {{ id: string }[]} list
 * @param {Record<string, StemSetting>} mix
 * @returns {Record<string, number>} each stem's gain, by id
 */
export function stemGains(list, mix) {
  const anySolo = list.some(({ id }) => mix[id]?.solo);
  return Object.fromEntries(
    list.map(({ id }) => {
      const { volume = 1, solo = false, mute = false } = mix[id] ?? {};
      return [id, mute || (anySolo && !solo) ? 0 : volume];
    }),
  );
}

/**
 * Whether the mix is the song as it is: every gain 1.
 * @param {Record<string, number>} gains
 */
export const isUnchanged = (gains) => Object.values(gains).every((gain) => gain === 1);
