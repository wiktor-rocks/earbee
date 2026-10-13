// The browser's storage (localStorage), for small things this page
// remembers on its own. It can be missing or refuse (a private window,
// blocked site data); then nothing is remembered, reading gives null, and
// everything still works for the session.

/** @param {string} key @returns {string | null} */
export function readStored(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** @param {string} key @param {string} value */
export function store(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembered; it still works for this session.
  }
}
