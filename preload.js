// The page's only way out of its sandbox: downloading a link (see
// downloader.js). Exposed as window.transcribee; the page hides its download
// buttons when this is missing (e.g. opened in a plain browser).
const { contextBridge, ipcRenderer } = require("electron");

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
});
