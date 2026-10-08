// What the page needs to know about the system, and what to do when the
// page itself dies.
//   availableMemory()   bytes the system can still give programs, or null
//                       where that can't be told reliably; the page refuses
//                       tracks that wouldn't fit (src/features/open-file.js)
//   handleSystem(ipc)   answers the page's "system:available-memory"
//   handleRendererCrash(win, dialog)
//                       if the page's process dies (e.g. killed for lack of
//                       memory), says so and reloads it, instead of leaving
//                       a blank window
const fs = require("fs");
const os = require("os");

function availableMemory() {
  if (process.platform === "linux") {
    // MemAvailable counts the disk cache the kernel can drop; os.freemem()
    // (MemFree) doesn't, and would be far too low.
    try {
      const kB = /^MemAvailable:\s+(\d+)/m.exec(fs.readFileSync("/proc/meminfo", "utf8"))?.[1];
      if (kB) return Number(kB) * 1024;
    } catch {
      // fall through
    }
    return os.freemem();
  }
  // Windows: available physical memory. macOS: free pages only, far below
  // what can be had (compression, cache), so unknown.
  return process.platform === "win32" ? os.freemem() : null;
}

function handleSystem(ipcMain) {
  ipcMain.handle("system:available-memory", () => availableMemory());
}

function handleRendererCrash(win, dialog) {
  win.webContents.on("render-process-gone", async (_event, details) => {
    if (details.reason === "clean-exit" || win.isDestroyed()) return;
    console.error(`Page process gone: ${details.reason} (exit code ${details.exitCode})`);
    await dialog.showMessageBox(win, {
      type: "error",
      title: "TranscriBee",
      message: "TranscriBee stopped unexpectedly and will start again.",
      detail:
        details.reason === "oom"
          ? "It ran out of memory. A very long file may need more memory than is available."
          : `Reason: ${details.reason}. The file that was open needs to be opened again.`,
    });
    if (!win.isDestroyed()) win.reload();
  });
}

module.exports = { availableMemory, handleSystem, handleRendererCrash };
