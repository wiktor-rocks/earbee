// The download links, filled in from the latest GitHub release, and the
// decorative waveform.
//
// ---- To point the page at your releases, edit these two: ----
//
// REPO: the GitHub repository ("user/name") whose releases are offered.
const REPO = "wiktor-rocks/earbee";
// FILES: how to tell each download apart among a release's assets (the
// first asset whose name matches is offered). They match the names in
// package.json's build.artifactName: EarBee-0.1.0-win-x64.exe,
// EarBee-0.1.0-mac-arm64.dmg, EarBee-0.1.0-mac-x64.dmg,
// EarBee-0.1.0-linux-x86_64.AppImage. `mac` is Apple Silicon, the one
// offered to every Mac visitor; `macIntel` is the second link on the
// macOS card.
const FILES = {
  windows: /-win-x64\.exe$/i,
  mac: /-mac-arm64\.dmg$/i,
  macIntel: /-mac-x64\.dmg$/i,
  linux: /-linux-x86_64\.AppImage$/i,
};
// ---------------------------------------------------------------

const NAMES = { windows: "Windows", mac: "macOS", linux: "Linux" };
const repoUrl = `https://github.com/${REPO}`;
const releasesUrl = `${repoUrl}/releases/latest`;

// The visitor's system, if it's one of ours.
function detectSystem() {
  const platform = navigator.userAgentData?.platform || navigator.platform || navigator.userAgent;
  if (/win/i.test(platform)) return "windows";
  if (/mac/i.test(platform) && !/iphone|ipad/i.test(navigator.userAgent)) return "mac";
  if (/linux|x11/i.test(platform) && !/android/i.test(navigator.userAgent)) return "linux";
  return null;
}

const megabytes = (bytes) => `${Math.round(bytes / 1024 / 1024)} MB`;

function setLinks(name, href) {
  for (const link of document.querySelectorAll(`[data-link="${name}"]`)) link.href = href;
}
function setText(selector, text) {
  for (const element of document.querySelectorAll(selector)) element.textContent = text;
}

async function fillDownloads() {
  const mine = detectSystem();
  setLinks("repo", repoUrl);
  setLinks("releases", `${repoUrl}/releases`);
  setLinks("issues", `${repoUrl}/issues`);
  setLinks("licence", `${repoUrl}/blob/main/LICENSE`);
  // Until the release is known, every button goes to the releases page.
  for (const download of Object.keys(FILES)) setLinks(download, releasesUrl);
  if (mine) {
    document.querySelector(`[data-platform="${mine}"]`)?.classList.add("mine");
    setText('[data-label="mine"]', `Download for ${NAMES[mine]}`);
    setLinks("mine", releasesUrl);
  }

  let release;
  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (response.status === 404) {
      setText("[data-release]", "No release yet: build it from source below.");
      setText("[data-release-long]", "No release yet. Build it from source (below).");
      return;
    }
    if (!response.ok) return; // rate-limited or offline: the links still go to the releases page
    release = await response.json();
  } catch {
    return;
  }

  const date = new Date(release.published_at).toLocaleDateString(undefined, { dateStyle: "medium" });
  const version = release.tag_name.replace(/^v/, "");
  setText("[data-release]", `Version ${version} · ${date} · Windows, macOS and Linux`);
  setText("[data-release-long]", `Version ${version}, released ${date}.`);
  for (const [download, pattern] of Object.entries(FILES)) {
    const asset = release.assets.find((candidate) => pattern.test(candidate.name));
    if (!asset) continue; // no build for it in this release: its button stays on the release page
    setLinks(download, asset.browser_download_url);
    setText(`[data-size="${download}"]`, megabytes(asset.size));
    if (download === mine) {
      setLinks("mine", asset.browser_download_url);
      setText('[data-size="mine"]', megabytes(asset.size));
    }
  }
}

// Bars like the app's waveform: grey, amber up to the green start point.
function drawWave() {
  const wave = document.querySelector(".wave");
  if (!wave) return;
  const count = Math.round(wave.clientWidth / 5);
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const bars = [];
  for (let i = 0; i < count; i++) {
    const x = i / count;
    const swell = 0.45 + 0.35 * Math.sin(x * 9.4) * Math.sin(x * 2.3 + 1);
    const height = Math.max(0.08, Math.min(1, swell + (random() - 0.5) * 0.5));
    const bar = document.createElement("i");
    bar.style.height = `${Math.round(height * 100)}%`;
    if (x < 0.38) bar.className = "played";
    if (i === Math.round(count * 0.38)) bar.className = "start";
    bars.push(bar);
  }
  wave.replaceChildren(...bars);
}

const root = document.documentElement;
const systemLight = matchMedia("(prefers-color-scheme: light)");
// The page's mode: the one chosen with the button in the top bar, else the
// system's.
const currentMode = () => root.dataset.theme ?? (systemLight.matches ? "light" : "dark");

// The screenshot and the clips are recorded in both of EarBee's themes
// (scripts/record-site-media.cjs) and show the page's mode. The
// screenshot's <picture> follows the system by itself; a mode chosen with
// the button overrides its media query. A clip gets its file here, and
// its poster, the .webp beside it.
function showModeMedia() {
  const mode = currentMode();
  for (const source of document.querySelectorAll(".shot picture source")) {
    source.media = mode === "light" ? "all" : "not all";
  }
  for (const video of document.querySelectorAll("video[data-dark]")) {
    const file = video.dataset[mode];
    if (video.getAttribute("src") === file) continue;
    video.poster = file.replace(/\.mp4$/, ".webp");
    video.src = file;
  }
}

// The button in the top bar: switches between EarBee's dark and light
// themes, and remembers the choice (until then, the system's is used).
function setUpThemeSwitch() {
  const showMode = () => {
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", currentMode() === "light" ? "#f5f1e8" : "#0e1014");
    showModeMedia();
  };
  showMode();
  systemLight.addEventListener("change", showMode);
  document.querySelector(".theme-switch")?.addEventListener("click", () => {
    root.dataset.theme = currentMode() === "light" ? "dark" : "light";
    try {
      localStorage.setItem("theme", root.dataset.theme);
    } catch {
      // not remembered (private window, blocked storage): fine for this visit
    }
    showMode();
  });
}

// The clips play by themselves, silent and looping. With reduced motion
// they stay still (their poster) and get controls instead.
function calmClips() {
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  for (const video of document.querySelectorAll(".clip video")) {
    video.autoplay = false;
    video.pause();
    video.controls = true;
  }
}

calmClips(); // before the clips get their files, so they don't start
setUpThemeSwitch();
fillDownloads();
drawWave();
