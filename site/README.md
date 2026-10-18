# The website

earbee.org: the landing page and the blog, built with
[Eleventy](https://www.11ty.dev). This folder is its own small project, with
its own `package.json`, apart from the app's.

```sh
npm install      # once
npm start        # a preview at http://localhost:8080, rebuilt on every save
npm run build    # the site, into _site/ (as GitHub builds it)
```

**The blog,** and everything about writing, publishing and looking after
posts: [docs/blog.md](../docs/blog.md). It also explains the layout files
(`_includes/`), the site's data (`_data/site.json`) and what to do when
something goes wrong.

**Publishing.** `.github/workflows/pages.yml` builds this folder and
publishes `_site/` whenever `site/` changes on `main`. Once, in the repository
on GitHub, set Settings › Pages › Source to **GitHub Actions**, and the custom
domain to earbee.org.

**Downloads.** At the top of `download.js`:

- `REPO`: your repository, as `user/name`.
- `FILES`: how each system's file is recognised among a release's assets
  (the first match is offered).

The page asks GitHub for the latest release and points each button straight
at its file, with its size, and puts the visitor's own system first. With no
release yet, or if GitHub can't be reached, the buttons open the releases page
instead.

**Files**

- `index.html`: the home page's content; the head, the top bar and the
  footer are in `_includes/base.njk`, shared with the blog. `style.css`: the
  look of every page, in the app's own colours (EarBee, or EarBee Light on a
  light system).
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
`site/`: every `.html`, `.md` and `.njk` file in it becomes a page (but this
README), and everything in `fonts/` and `img/` goes online.
