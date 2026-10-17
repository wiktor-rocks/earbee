# The landing page

EarBee's page for GitHub Pages: plain HTML, CSS and one script, with no
build step. Open `index.html` in a browser to see it.

**Publishing.** `.github/workflows/pages.yml` publishes this folder whenever
it changes on `main`. Once, in the repository on GitHub, set Settings › Pages ›
Source to **GitHub Actions**.

**Downloads.** At the top of `download.js`:

- `REPO`: your repository, as `user/name`.
- `FILES`: how each system's file is recognised among a release's assets
  (the first match is offered).

The page asks GitHub for the latest release and points each button straight
at its file, with its size, and puts the visitor's own system first. With no
release yet, or if GitHub can't be reached, the buttons open the releases page
instead.

**Files**

- `index.html`: the page; `style.css`: its look, in the app's own colours
  (EarBee, or EarBee Light on a light system).
- `fonts/`: Righteous and Nunito, the app's fonts (from `node_modules/@fontsource*`).
- `img/logo.webp`: the bee, from `assets/`; `img/favicon.png`: from
  `assets/icon-512.png`.
- `img/screenshot.webp`: a screenshot of the app, shown at most at its own
  width (1017 px). A new one needs its size in `index.html` (the `<img>`'s
  `width` and `height`) and, if wider, in `style.css` (`.shot`).
