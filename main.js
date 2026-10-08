const { app, BrowserWindow } = require("electron");
const path = require("path");

// GPU: Chromium picks the GPU itself and falls back to software rendering
// if the GPU process keeps crashing. `npm run start:no-gpu` forces software
// rendering; `npm run start:gpu-info` logs what the GPU is doing.

app.on("child-process-gone", (_event, details) => {
  if (details.type === "GPU") {
    console.warn(`GPU process gone: ${details.reason} (exit code ${details.exitCode})`);
  }
});

async function logGpuInfo() {
  const info = await app.getGPUInfo("basic");
  const activeGpu = info.gpuDevice?.find((device) => device.active);
  console.log("GPU features:", app.getGPUFeatureStatus());
  console.log("Active GPU:", activeGpu ?? info.gpuDevice);
}

if (!app.isPackaged) {
  require("electron-reload")(__dirname, {
    electron: require(`${__dirname}/node_modules/electron`),
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(() => {
  createWindow();

  if (app.commandLine.hasSwitch("gpu-info")) {
    logGpuInfo().catch((error) => console.error("Couldn't read GPU info:", error));
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
