// Decoding long tracks in parallel parts (src/audio/decoder.js): the parts
// join without a seam, and play as one track.
// Part of the end-to-end run (see run.cjs); `h` is the harness.
const path = require("path");

module.exports = async function (h) {
  const { js, openFile, check, sleep, key, pos, ensurePaused, share, FIXTURES } = h;

  {
    // Signalsmith reads the track from several buffers (one per part); the
    // vendored copy is patched for that (src/vendor/signalsmith-stretch).
    const diff = await js(`(async () => {
      const { default: SignalsmithStretch } = await import("./src/vendor/signalsmith-stretch/SignalsmithStretch.mjs");
      const rate = 48000, n = rate * 2;
      const signal = Float32Array.from({ length: n }, (_, i) => Math.sin((i * i) / 4e6) * 0.5);
      async function render(pieces) {
        const context = new OfflineAudioContext(1, n, rate);
        const stretch = await SignalsmithStretch(context);
        stretch.connect(context.destination);
        for (const piece of pieces) await stretch.addBuffers([piece.slice()]);
        await stretch.schedule({ active: true, input: 0, rate: 1, semitones: 0, output: 0 });
        return (await context.startRendering()).getChannelData(0);
      }
      const whole = await render([signal]);
      const pieces = await render([signal.subarray(0, 33333), signal.subarray(33333, 70001), signal.subarray(70001)]);
      let max = 0, loud = 0;
      for (let i = 0; i < n; i++) { max = Math.max(max, Math.abs(whole[i] - pieces[i])); loud = Math.max(loud, Math.abs(whole[i])); }
      return { max, loud };
    })()`);
    check(
      "the stretcher plays a track in pieces exactly as in one",
      diff.max === 0 && diff.loud > 0.1,
      JSON.stringify(diff),
    );
  }

  {
    // Decoded in 3 parts vs in one, sample by sample. Opus in WebM is the
    // hard case for placing the parts: its timestamps are off by a
    // millisecond mid-stream. MP3 and Opus come out identical. AAC at low
    // bitrates differs by about -96 dB after a join (its decoder fills
    // noisy bands from a random generator whose state depends on where
    // decoding started, as after any seek), so for it: no step at the
    // joins, and the whole within 60 dB.
    for (const [name, identical] of [
      ["long-chirp.mp3", true],
      ["long-chirp.m4a", false],
      ["long-chirp.webm", true],
    ]) {
      const url = share(path.join(FIXTURES, name));
      const result = await js(`(async () => {
        const { decodeFile } = await import("./src/audio/decoder.js");
        const media = { name: ${JSON.stringify(name)}, url: ${JSON.stringify(url)} };
        const decode = (workers) => decodeFile(media, { prepare: () => ({ peakFactor: 100 }), workers });
        const one = await decode(1);
        const three = await decode(3);
        const a = one.pieces[0][0];
        const b = new Float32Array(three.pieces.reduce((sum, piece) => sum + piece[0].length, 0));
        const joins = [];
        let at = 0;
        for (const piece of three.pieces) { if (at) joins.push(at); b.set(piece[0], at); at += piece[0].length; }
        let max = 0, error = 0, power = 0;
        for (let i = 0; i < Math.min(a.length, b.length); i++) {
          const d = a[i] - b[i];
          max = Math.max(max, Math.abs(d)); error += d * d; power += a[i] * a[i];
        }
        // A click is a step at the join that the track itself doesn't take.
        const step = Math.max(...joins.map((j) => Math.abs((b[j] - b[j - 1]) - (a[j] - a[j - 1]))));
        return {
          pieces: three.pieces.length, frames: [a.length, b.length], max, step,
          snr: error ? 10 * Math.log10(power / error) : Infinity,
          levels: one.levels[0].peak.length === three.levels[0].peak.length && one.levels[0].rms.length === three.levels[0].rms.length,
        };
      })()`);
      const joined = result.pieces === 3 && result.frames[0] === result.frames[1] && result.levels;
      check(
        identical
          ? `${name}: 3 parts give exactly the samples of one`
          : `${name}: 3 parts join without a step, within 60 dB of one`,
        joined && (identical ? result.max === 0 : result.step < 1e-4 && result.snr > 60),
        JSON.stringify(result),
      );
    }
  }

  {
    // The app splits a long file over several workers, and plays it as one
    // track: across a join, and looping over one.
    const before = await js(`__workers.created`);
    await openFile(path.join(FIXTURES, "long-chirp.webm"));
    const used = (await js(`__workers.created`)) - before;
    const expected = await js(`Math.max(1, Math.min(navigator.hardwareConcurrency - 1, 4))`);
    check("a long file is decoded by several workers", used === expected && used > 1, `${used} (expected ${expected})`);
    check("none of them is left running", (await js(`__workers.live()`)) === 0);

    // The first join is at about 90 s / parts.
    const join = 90 / expected;
    await ensurePaused();
    await js(`import("./src/context.js").then(({ player }) => player.transport.seek(${join - 1}))`);
    await sleep(200);
    key(",");
    await sleep(2000);
    const after = await pos();
    await ensurePaused();
    check(
      "plays across a join at normal speed",
      after > join + 0.7 && after < join + 1.3,
      `from ${(join - 1).toFixed(2)} to ${after}`,
    );

    await js(
      `import("./src/features/playback.js").then(({ setLoopRegion }) => setLoopRegion({ start: ${join - 0.5}, end: ${join + 0.5}, enabled: true }))`,
    );
    await js(`import("./src/context.js").then(({ player }) => player.transport.seek(${join - 0.5}))`);
    key(",");
    const seen = [];
    for (let i = 0; i < 12; i++) {
      await sleep(250);
      seen.push(await pos());
    }
    await ensurePaused();
    await js(`import("./src/features/playback.js").then(({ setLoopRegion }) => setLoopRegion(null))`);
    const inside = seen.every((time) => time >= join - 0.55 && time <= join + 0.55);
    const wrapped = seen.some((time, i) => i > 0 && time < seen[i - 1]);
    check("a loop over a join stays in it and wraps", inside && wrapped, JSON.stringify(seen));
  }
};
