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
- `img/screenshot-*.webp` (1280×800, shown at most 1017 px wide), and the two
  clips beside "Find the beats and bars" and "Loop a bar, then the next":
  `img/clip-beats-*.mp4` and `img/clip-loop-*.mp4`, silent and looping, each
  with a poster (`.webp`, its last frame) for reduced motion. Each comes in
  `-dark` (the EarBee theme) and `-light` (EarBee Light), with the Peak +
  loudness waveform; the page shows the one for its mode (`download.js`,
  `showModeMedia`). All are recorded from the app by
  `scripts/record-site-media.cjs`.

**The demos.** The demo file is a stock concert video with music under it:

- the video: Pexels clip 16803490 (Pexels licence: free to use, no credit
  needed), whose own soundtrack is silent;
- the music: "Rock City Ransom (revised version)" from Ragnar Random's
  [Rock Music Pack](https://opengameart.org/content/rock-music), CC0, 0:20
  to 0:39.

To make it again and record:

```sh
ffmpeg -i 16803490-uhd_3840_2160_24fps.mp4 -ss 20 -t 19.07 \
  -i 01_-_rock_city_ransom_revised_version.ogg -map 0:v -map 1:a \
  -vf scale=1920:1080 -c:v libx264 -crf 20 -pix_fmt yuv420p \
  -af "afade=t=in:d=0.3,afade=t=out:st=18.6:d=0.45" -c:a aac -shortest \
  "Rock City Ransom.mp4"
npx electron scripts/record-site-media.cjs --media="Rock City Ransom.mp4"
```

The script clicks at times chosen for this file; another one needs new
times (see the comments in the script). Keep the source files out of
`site/`: everything in it is published.
