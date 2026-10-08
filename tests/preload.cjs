const { webFrame } = require("electron");
webFrame.executeJavaScript(`
  window.__nodes = [];
  window.__contexts = [];
  const NativeNode = AudioWorkletNode;
  window.AudioWorkletNode = class extends NativeNode {
    constructor(...args) { super(...args); window.__nodes.push(this); }
  };
  // Problems the app didn't handle; the run fails if any are recorded.
  window.__problems = [];
  window.addEventListener("unhandledrejection", (event) => __problems.push("unhandled rejection: " + (event.reason?.stack || event.reason)));
  window.addEventListener("error", (event) => __problems.push("uncaught error: " + (event.error?.stack || event.message)));
  document.addEventListener("securitypolicyviolation", (event) => __problems.push("CSP violation: " + event.violatedDirective + " " + event.blockedURI));

  // Live WebCodecs objects, to check that opening another file frees the
  // previous one's decoders and encoders.
  window.__codecs = { created: 0, closed: 0, live: () => __codecs.created - __codecs.closed };
  for (const name of ["VideoDecoder", "VideoEncoder"]) {
    const Native = window[name];
    window[name] = class extends Native {
      constructor(init) {
        let counted = true;
        const error = init.error;
        super({ ...init, error: (e) => { if (counted) { counted = false; __codecs.closed++; } error?.(e); } });
        __codecs.created++;
        this.__uncount = () => { if (counted) { counted = false; __codecs.closed++; } };
      }
      close() { this.__uncount(); return super.close(); }
    };
    window[name].isConfigSupported = Native.isConfigSupported.bind(Native);
  }

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
