// The page's only ways out of its sandbox, exposed as window.transcribee:
//   - downloading a link (see downloader.js); the page hides its download
//     buttons when this is missing (e.g. opened in a plain browser);
//   - the memory available for a track (see system.js);
//   - the colour theme (see theme-store.js): the saved one is applied here,
//     before the page renders, so it never flashes the default colours.
const { contextBridge, ipcRenderer } = require("electron");

/* ---------- Theme ---------- */

let initialTheme = null;
try {
  initialTheme = ipcRenderer.sendSync("theme:initial");
} catch (error) {
  console.warn("No saved theme:", error);
}

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
  // Resolves to { ok: true, name, path, bytes } or { ok: false, canceled, error }.
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

  theme: {
    saved: initialTheme?.prefs ?? null, // { choice, dark, light }
    save: (prefs) => ipcRenderer.invoke("theme:save", prefs),
  },
});
