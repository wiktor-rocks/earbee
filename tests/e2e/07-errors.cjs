// Errors versus notices; a bad file keeps the previous one.
// Part of the end-to-end run (see run.cjs); `h` is the harness.
const fs = require("fs");
const path = require("path");

module.exports = async function (h) {
  const { js, openFile, shot, loopInfo, check, FIXTURES } = h;

  fs.writeFileSync(path.join(FIXTURES, "bad.mp3"), "not audio");
  await openFile(path.join(FIXTURES, "bad.mp3"));
  const msg = await js(
    `(() => { const e = document.getElementById("message"); return { text: e.textContent, notice: e.classList.contains("notice"), color: getComputedStyle(e).color }; })()`,
  );
  check(
    "bad file after first load: red error in player",
    msg.text.includes("Couldn't open") && !msg.notice,
    JSON.stringify(msg),
  );
  check("bad file keeps loop of previous song", !(await loopInfo()).hidden);
  await shot("error.png");
};
