// The Balance knob (the Mixer): how loud each side plays. Pure.
//
// A balance is a percent from -100 (only the left) through 0 (both as
// they are) to 100 (only the right): turning it one way lowers the other
// side and leaves this one as it is, so the middle is the song untouched.

/**
 * Each side's gain for a balance.
 * @param {number} balance -100 … 100
 * @returns {{ left: number, right: number }}
 */
export function balanceGains(balance) {
  const b = Math.max(-100, Math.min(100, balance)) / 100;
  return { left: b > 0 ? 1 - b : 1, right: b < 0 ? 1 + b : 1 };
}

/**
 * The knob's readout: "Centre", or each side's level ("L 100 · R 60").
 * @param {number} balance
 */
export function formatBalance(balance) {
  if (balance === 0) return "Centre";
  const { left, right } = balanceGains(balance);
  return `L ${Math.round(left * 100)} · R ${Math.round(right * 100)}`;
}
