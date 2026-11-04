// The page's only ways out of its sandbox, exposed as window.earbee:
//   - downloading a link, or searching by keywords (see downloader.js); the page hides its download
//     buttons when this is missing (e.g. opened in a plain browser);
//   - the memory available for a track, and all of it (see system.js);
//   - running the beat model on one window of a spectrogram (see beat-model.js);
//   - separating the open song's stems (see stems/index.js): the model's
//     file, and a process the page's worker talks to over a port;
//   - saying the page is ready, so its window shows (see windows.js, "The splash");
//   - project files (.ebee; see project-files.js): opening, saving, and
//     whether there are unsaved changes; a File's path is found here, so
//     the page never names a path itself;
//   - the settings (see prefs-store.js): read at startup, changed one at a
//     time, and every change heard; the saved colour theme is applied here,
//     before the page renders, so it never flashes the default colours.
const { contextBridge, ipcRenderer, webUtils } = require("electron");

// The path of a File the user chose or dropped; "" if it has none.
const pathOf = (file) => {
  try {
    return webUtils.getPathForFile(file);
  } catch {
    return "";
  }
};

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

// Stems (src/features/stems/): the stem process's port, to the page.
ipcRenderer.on("stems:port", (event) => window.postMessage("earbee:stems-port", "*", event.ports));

contextBridge.exposeInMainWorld("earbee", {
  // Resolves to { ok: true, name, path, url } or { ok: false, canceled, error };
  // `url` serves the saved file in pieces (media-files.js).
  download: (url, kind) => ipcRenderer.invoke("download:start", String(url), String(kind)),
  cancelDownload: () => ipcRenderer.invoke("download:cancel"),
  // Resolves to { ok: true, searchId, results, more } or { ok: false, canceled, error }
  // (src/search/sources.js says what a result is); setup progress comes
  // through onDownloadProgress.
  search: (text, source, page) => ipcRenderer.invoke("download:search", String(text), String(source), Number(page)),
  cancelSearch: () => ipcRenderer.invoke("download:cancel-search"),
  // Calls `callback` with { searchId, index, src } as each result's picture arrives; returns a function that stops it.
  onThumbnail(callback) {
    const listener = (_event, thumbnail) => callback(thumbnail);
    ipcRenderer.on("download:thumbnail", listener);
    return () => ipcRenderer.removeListener("download:thumbnail", listener);
  },
  // A search result's page in the system browser (only the sources' sites).
  openExternal: (url) => ipcRenderer.invoke("download:open-external", String(url)),
  // Calls `callback` with each progress report; returns a function that stops it.
  onDownloadProgress(callback) {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("download:progress", listener);
    return () => ipcRenderer.removeListener("download:progress", listener);
  },

  // Bytes the system can still give programs, or null if unknown.
  availableMemory: () => ipcRenderer.invoke("system:available-memory"),
  // All of the system's memory, in bytes.
  totalMemory: () => ipcRenderer.invoke("system:total-memory"),

  // The beat model on one spectrogram window (a Float32Array of 1500 × 128):
  // resolves to { ok: true, beat, downbeat } (logits) or { ok: false, error }.
  beatWindow: (input) =>
    input instanceof Float32Array
      ? ipcRenderer.invoke("beats:window", input)
      : Promise.resolve({ ok: false, error: "not a Float32Array" }),

  // Stems (src/features/stems/): see electron/stems/index.js. After
  // start(), the process's port arrives as a window "message" event whose
  // data is "earbee:stems-port" (a port can't cross the bridge itself).
  stems: {
    model: () => ipcRenderer.invoke("stems:model"),
    download: () => ipcRenderer.invoke("stems:download"),
    start: () => ipcRenderer.invoke("stems:start"),
    cancel: () => ipcRenderer.invoke("stems:cancel"),
    // Each calls `callback` with what was sent; returns a function that stops it.
    onProgress(callback) {
      const listener = (_event, progress) => callback(progress);
      ipcRenderer.on("stems:progress", listener);
      return () => ipcRenderer.removeListener("stems:progress", listener);
    },
    onStopped(callback) {
      const listener = (_event, stopped) => callback(stopped);
      ipcRenderer.on("stems:stopped", listener);
      return () => ipcRenderer.removeListener("stems:stopped", listener);
    },
  },

  // The page is built: the window shows and the splash closes.
  ready: () => ipcRenderer.send("app:ready"),

  // See src/features/project/. Each resolves to { ok: true, … } or
  // { ok: false, canceled?, error? }.
  project: {
    // A media file the user opened: its URL, so a project can name it.
    registerMedia: (file) => ipcRenderer.invoke("project:register-media", pathOf(file)),
    // { path, name, sections, media: { name, url }, embedded, linkable, relinked }
    open: (file) => ipcRenderer.invoke("project:open", pathOf(file)),
    // { file (null: ask), mediaUrl, embed, duration, sections } → { path, name, embedded, linkable }
    save: (request) => ipcRenderer.invoke("project:save", request),
    // "save" | "discard" | "cancel"
    confirm: (name) => ipcRenderer.invoke("project:confirm", String(name ?? "")),
    setDirty: (dirty, name) => ipcRenderer.send("project:dirty", Boolean(dirty), String(name ?? "")),
    // The window is closing and the user chose Save: `callback` saves, then calls close().
    onSaveThenClose(callback) {
      const listener = () => callback();
      ipcRenderer.on("project:save-then-close", listener);
      return () => ipcRenderer.removeListener("project:save-then-close", listener);
    },
    close: () => ipcRenderer.send("project:close"),
  },

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

  // Updates (src/features/updates.js, electron/updates.js): the state is
  // null, { kind: "ready", version } (installs on quit) or
  // { kind: "available", version, url } (a newer release to download).
  updates: {
    state: () => ipcRenderer.invoke("updates:state"),
    // Calls `callback` with each new state; returns a function that stops it.
    onState(callback) {
      const listener = (_event, state) => callback(state);
      ipcRenderer.on("updates:state", listener);
      return () => ipcRenderer.removeListener("updates:state", listener);
    },
    restart: () => ipcRenderer.send("updates:restart"),
    openRelease: () => ipcRenderer.send("updates:open"),
  },

  // Video window (src/features/video-window/): its "always on top"; each
  // resolves to the state now (electron/windows.js).
  videoWindow: {
    alwaysOnTop: () => ipcRenderer.invoke("video-window:always-on-top"),
    setAlwaysOnTop: (on) => ipcRenderer.invoke("video-window:always-on-top", Boolean(on)),
  },
});
