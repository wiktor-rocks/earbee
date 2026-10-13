// The download links, filled in from the latest GitHub release, and the
// decorative waveform.
//
// ---- To point the page at your releases, edit these two: ----
//
// REPO: the GitHub repository ("user/name") whose releases are offered.
const REPO = "OWNER/scribee";
// FILES: how to tell each system's file apart among a release's assets
// (the first asset whose name matches is offered). These match
// electron-builder's usual names: ScriBee 1.0.0.exe (portable),
// ScriBee-1.0.0-arm64.dmg, ScriBee-1.0.0.AppImage.
const FILES = {
  windows: /\.exe$/i,
  mac: /\.dmg$/i,
  linux: /\.AppImage$/i,
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
  // Until the release is known, every button goes to the releases page.
  for (const system of Object.keys(NAMES)) setLinks(system, releasesUrl);
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
      setText("[data-release-long]", "There's no release yet. Until there is, build it from source (below).");
      return;
    }
    if (!response.ok) return; // rate-limited or offline: the links still go to the releases page
    release = await response.json();
  } catch {
    return;
  }

  const date = new Date(release.published_at).toLocaleDateString(undefined, { dateStyle: "medium" });
  setText("[data-release]", `Version ${release.tag_name.replace(/^v/, "")} · ${date} · free`);
  setText("[data-release-long]", `Version ${release.tag_name.replace(/^v/, "")}, released ${date}. Free.`);
  for (const [system, pattern] of Object.entries(FILES)) {
    const asset = release.assets.find((candidate) => pattern.test(candidate.name));
    if (!asset) continue; // no build for it in this release: its button stays on the release page
    setLinks(system, asset.browser_download_url);
    setText(`[data-size="${system}"]`, megabytes(asset.size));
    if (system === mine) {
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

// The button in the top bar: switches between ScriBee's dark and light
// themes, and remembers the choice (until then, the system's is used).
function setUpThemeSwitch() {
  const root = document.documentElement;
  const systemLight = matchMedia("(prefers-color-scheme: light)");
  const current = () => root.dataset.theme ?? (systemLight.matches ? "light" : "dark");
  const showColour = () =>
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", current() === "light" ? "#f5f1e8" : "#0e1014");
  showColour();
  systemLight.addEventListener("change", showColour);
  document.querySelector(".theme-switch")?.addEventListener("click", () => {
    root.dataset.theme = current() === "light" ? "dark" : "light";
    try {
      localStorage.setItem("theme", root.dataset.theme);
    } catch {
      // not remembered (private window, blocked storage): fine for this visit
    }
    showColour();
  });
}

setUpThemeSwitch();
fillDownloads();
drawWave();
