const { webFrame } = require("electron");
webFrame.executeJavaScript(`
  window.__nodes = [];
  window.__contexts = [];
  const NativeNode = AudioWorkletNode;
  window.AudioWorkletNode = class extends NativeNode {
    constructor(...args) { super(...args); window.__nodes.push(this); }
  };
  const nativeDecode = BaseAudioContext.prototype.decodeAudioData;
  BaseAudioContext.prototype.decodeAudioData = async function (...args) {
    if (window.__slowDecode) await new Promise((r) => setTimeout(r, window.__slowDecode));
    return nativeDecode.apply(this, args);
  };
  const NativeContext = AudioContext;
  window.AudioContext = class extends NativeContext {
    constructor(...args) { super(...args); window.__contexts.push(this); }
  };
  window.__parseTime = (text) => {
    const [m, s] = text.split(" / ")[0].split(":").slice(-2);
    const parts = text.split(" / ")[0].split(":").map(Number);
    return parts.reduce((acc, v) => acc * 60 + v, 0);
  };
  window.__sample = (ms) => new Promise((resolve) => {
    const out = [];
    const t0 = performance.now();
    (function tick() {
      const host = document.querySelector("#waveform > div");
      const cursor = host?.shadowRoot?.querySelector(".cursor");
      out.push({
        t: performance.now() - t0,
        pos: __parseTime(document.getElementById("trackTime").textContent),
        input: __nodes[0]?.inputTime,
        frame: Number(document.getElementById("videoCanvas").dataset.frameTime),
        cursor: cursor ? parseFloat(cursor.style.left) : NaN,
      });
      if (performance.now() - t0 < ms) requestAnimationFrame(tick); else resolve(out);
    })();
  });
`);
