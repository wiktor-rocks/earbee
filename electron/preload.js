// The page's only ways out of its sandbox, exposed as window.transcribee:
//   - downloading a link (see downloader.js); the page hides its download
//     buttons when this is missing (e.g. opened in a plain browser);
//   - the memory available for a track (see system.js);
//   - the settings (see prefs-store.js): read at startup, changed one at a
//     time, and every change heard; the saved colour theme is applied here,
//     before the page renders, so it never flashes the default colours.
const { contextBridge, ipcRenderer } = require("electron");

/* ---------- Settings, and the theme ---------- */

let initial = null; // { values, defaultPaths, theme: { scheme, variables } }
try {
  initial = ipcRenderer.sendSync("prefs:initial");
} catch (error) {
  console.warn("No saved settings:", error);
}
const initialTheme = initial?.theme;

// <html> doesn't exist yet when the preload runs; set the variables the
// moment it appears, before anything inside it is parsed.
function applyInitialTheme() {
  const root = document.documentElement;
  for (const [variable, value] of Object.entries(initialTheme.variables)) root.style.setProperty(variable, value);
  root.style.colorScheme = initialTheme.scheme;
}

if (initialTheme?.variables) {
  if (document.documentElement) applyInitialTheme();
  else {
    const watcher = new MutationObserver(() => {
      if (!document.documentElement) return;
      watcher.disconnect();
      applyInitialTheme();
    });
    watcher.observe(document, { childList: true });
  }
}

contextBridge.exposeInMainWorld("transcribee", {
  // Resolves to { ok: true, name, path, url } or { ok: false, canceled, error };
  // `url` serves the saved file in pieces (media-files.js).
  download: (url, kind) => ipcRenderer.invoke("download:start", String(url), String(kind)),
  cancelDownload: () => ipcRenderer.invoke("download:cancel"),
  // Calls `callback` with each progress report; returns a function that stops it.
  onDownloadProgress(callback) {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("download:progress", listener);
    return () => ipcRenderer.removeListener("download:progress", listener);
  },

  // Bytes the system can still give programs, or null if unknown.
  availableMemory: () => ipcRenderer.invoke("system:available-memory"),

  // See src/ui/prefs.js. set, reset and chooseFolder resolve to
  // { ok: true, values } (the section's values after it) or { ok: false, error }.
  prefs: {
    values: initial?.values ?? null, // { [section]: { [key]: value } }
    defaultPaths: initial?.defaultPaths ?? {}, // what a folder's null means, by "section.key"
    set: (section, key, value) => ipcRenderer.invoke("prefs:set", String(section), String(key), value),
    reset: (section, key) => ipcRenderer.invoke("prefs:reset", String(section), key == null ? undefined : String(key)),
    chooseFolder: (section, key) => ipcRenderer.invoke("prefs:choose-folder", String(section), String(key)),
    // Calls `callback` with { section, values } after every change; returns a function that stops it.
    onChanged(callback) {
      const listener = (_event, change) => callback(change);
      ipcRenderer.on("prefs:changed", listener);
      return () => ipcRenderer.removeListener("prefs:changed", listener);
    },
  },
});
