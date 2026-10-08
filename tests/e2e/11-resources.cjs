// Resources: no codec leaks, no unhandled errors or CSP violations.
// Part of the end-to-end run (see run.cjs); `h` is the harness.
const path = require("path");

module.exports = async function (h) {
  const { js, openFile, check, sleep, FIXTURES } = h;

  {
    // Open the video several times, then an audio file: every decoder and
    // encoder of the earlier files must have been closed.
    const counts = [];
    for (let i = 0; i < 3; i++) {
      await openFile(path.join(FIXTURES, "counter.webm"));
      await sleep(1500); // let the proxy build start
      counts.push(await js(`__codecs.live()`));
    }
    await openFile(path.join(FIXTURES, "tone.wav"));
    await sleep(1000);
    const afterAudio = await js(`__codecs.live()`);
    check(
      "video codecs don't pile up across loads",
      Math.max(...counts) - Math.min(...counts) <= 1,
      JSON.stringify(counts),
    );
    check("switching to audio frees all video codecs", afterAudio === 0, `live after audio: ${afterAudio}`);
    const problems = await js(`__problems`);
    check("no unhandled errors, rejections or CSP violations", problems.length === 0, problems.join("\n"));
  }
};
