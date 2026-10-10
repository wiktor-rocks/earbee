// Number → text for the UI. Pure functions.

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const formatSigned = (value, unit) => `${value >= 0 ? "+" : ""}${value}${unit}`;
export const formatSpeed = (speed) => `${speed.toFixed(2)}×`;
export const formatPercent = (percent) => `${Math.round(percent)}%`;
export const formatFrequency = (hz) => (hz >= 1000 ? `${hz / 1000} kHz` : `${hz} Hz`);
export const formatPitchTotal = (semitones) => `${semitones >= 0 ? "+" : ""}${semitones.toFixed(2)} st`;
// Prints a step size exactly as written in CONFIG.step.sizes: 0.25 → "0.25".
export const formatStepSize = (seconds) => String(seconds);

export function formatGain(gain) {
  const digits = Number.isInteger(gain) ? gain : gain.toFixed(1);
  return `${gain > 0 ? "+" : ""}${digits} dB`;
}

// A track's length, to the second: 83.6 → "1:24"; with hours "1:02:03".
export function formatDuration(time) {
  const total = Math.max(0, Math.round(time));
  const seconds = String(total % 60).padStart(2, "0");
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}:${seconds}`;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${seconds}`;
}

// 83.456 → "1:23.456"; with hours "1:02:03.456".
export function formatTrackTime(time) {
  const totalMilliseconds = Math.max(0, Math.floor(time * 1000));
  const totalSeconds = Math.floor(totalMilliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  const milliseconds = String(totalMilliseconds % 1000).padStart(3, "0");

  if (minutes < 60) return `${minutes}:${seconds}.${milliseconds}`;

  const hours = Math.floor(minutes / 60);
  return `${hours}:${String(minutes % 60).padStart(2, "0")}:${seconds}.${milliseconds}`;
}

// 1.3 GB, 850 MB: sizes of memory, one decimal for gigabytes.
export const formatMemory = (bytes) =>
  bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;

// 1234567 → "1.2M": counts (a video's views), short.
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
export const formatCount = (count) => compact.format(count);

// 75 → "1:15" (time left in a download).
export const formatEta = (seconds) =>
  `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
