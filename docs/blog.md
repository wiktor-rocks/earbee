# The website and its blog

How earbee.org works, and how to write, publish and look after blog posts so search engines find them. The commands are for a terminal in the project folder.

**Quick reference** is at the end.

## How it works

earbee.org is built from the `site/` folder by [Eleventy](https://www.11ty.dev), a tool that turns templates and Markdown into plain web pages. It has its own `package.json` in `site/`, separate from the app's.

| File or folder                   | What it is                                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------------------------- |
| `site/blog/<post-name>.md`       | **A post.** You write these.                                                                       |
| `site/img/blog/`                 | Pictures for the posts.                                                                            |
| `site/index.html`                | The home page's content (between the top bar and the footer).                                      |
| `site/_includes/base.njk`        | What every page shares: the `<head>`, the top bar, the footer.                                     |
| `site/_includes/post.njk`        | How a post looks: title, date, reading time, the text, then the EarBee box with a download button. |
| `site/blog.njk`                  | The blog's page, `/blog/`: every post, newest first.                                               |
| `site/blog/blog.11tydata.js`     | What all posts share: their layout and their address, `/blog/<post-name>/`.                        |
| `site/_data/site.json`           | The site's address, name and author, and the blog's title and description.                         |
| `site/style.css`                 | All the styles. The blog's are in its "Blog" section.                                              |
| `site/404.md`                    | The "page not found" page.                                                                         |
| `site/sitemap.njk`, `robots.txt` | The list of pages for search engines, and where to find it.                                        |
| `site/eleventy.config.js`        | Eleventy's settings: what's copied as it is, the RSS feed, drafts, dates.                          |
| `site/_site/`                    | **The built site**, made by Eleventy. Never edit it; it's rebuilt every time, and git ignores it.  |

**From a push to the live site.** When `main` on GitHub gets a change in `site/`, the "Website" workflow (`.github/workflows/pages.yml`) builds the site and publishes `_site/` on GitHub Pages, at earbee.org. It takes about a minute. On every other branch, CI only checks that the site builds (the "site" job), so nothing goes online until `main` moves.

**What search engines get.** Every page has its own title, description and canonical address. Every post also gets:

- structured data (`BlogPosting`): its headline, dates and author, for Google;
- a place in the sitemap (`/sitemap.xml`) and the RSS feed (`/blog/feed.xml`);
- a share image for social sites.

The home page carries `SoftwareApplication` data: a free app for Windows, macOS and Linux.

## Set up your computer (once)

```sh
cd site
npm install            # Eleventy and the RSS plugin, into site/node_modules
```

Then, each time you write:

```sh
cd site
npm start              # the site at http://localhost:8080
```

`npm start` keeps running and rebuilds the page each time you save a file; the browser reloads by itself. Stop it with **Ctrl+C**.

## Write a post

### 1. Start from `testing`

```sh
git checkout testing
git pull
```

`git pull` brings your copy up to date with GitHub.

### 2. Create the file

Make a new file in `site/blog/`. **Its name becomes the post's address**: `site/blog/slow-down-a-song.md` is published at `earbee.org/blog/slow-down-a-song/`. So choose the name carefully:

- lowercase words, joined by hyphens;
- the words people search for (`slow-down-a-song-without-changing-pitch`), not a date or a number;
- short: three to six words.

**Never rename a post once it's published.** The old address would stop working. Search engines would lose what they had learned about it, and links to it from other sites would break. (GitHub Pages can't redirect an old address to a new one.)

### 3. The header

Every post starts with a header between two `---` lines. Copy this:

```markdown
---
title: "How to slow down a song without changing the pitch"
description: "Slow a hard passage to half speed and keep it in tune: what time-stretching is, which speeds work for practice, and how to do it for free."
date: 2026-10-20
draft: true
---

The first paragraph starts here.
```

| Field         | What it's for                                                                                                                                                                                                     |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`       | The post's heading, and the title in search results (" · EarBee" is added). Up to about 60 characters, or Google cuts it.                                                                                         |
| `description` | The two lines under the title in search results, and on the blog's page. 120 to 155 characters. Keep the quotes around it, as around the title: a colon inside would break the header otherwise.                  |
| `date`        | The day it's published, as `YYYY-MM-DD`. Posts are sorted by it.                                                                                                                                                  |
| `draft`       | `true` while you work on it: it shows in the preview, with a "Draft" label, but isn't published. Delete the line when it's ready.                                                                                 |
| `updated`     | Optional, as `YYYY-MM-DD`: when you changed a published post in a way that matters. Shown beside the date, and given to search engines.                                                                           |
| `image`       | Optional: the picture social sites show when the post is shared, such as `/img/blog/slow-down-cover.jpg`. 1200×630, as a JPEG or PNG (some sites don't show WebP here). Without it, the app's screenshot is used. |

### 4. The text: Markdown

```markdown
A paragraph is lines of text; a blank line starts the next one.

## A section heading

### A smaller heading

**Bold**, _italic_, and a [link to another post](/blog/loop-a-bar/).

- A list item
- Another one

1. A numbered step
2. The next step

> A quote.

A key: press <kbd>Space</kbd>. The backslash key needs two: <kbd>\\</kbd>.
```

- **Headings:** the title is the page's only top heading, so sections start at `##`. Use `###` inside a section.
- **Links to the site** start with `/`: `/blog/other-post/`, or `/#download` for the downloads. Links elsewhere are the full address: `https://…`.
- **HTML works too,** for anything Markdown can't do (a `<figure>` with a caption, below).
- **Braces are just text.** `{{ }}` in a post is shown as it is.

### 5. Pictures

1. **Make the picture.** For screenshots of EarBee, use the EarBee theme, at a normal window size.
2. **Convert it to WebP, at most 1360 pixels wide** (twice the column's width, so it's sharp on high-resolution screens):

   ```sh
   ffmpeg -i ~/Pictures/my-screenshot.png -vf "scale='min(1360,iw)':-2" -quality 80 site/img/blog/loop-a-bar.webp
   ```

   Name it after the post and what it shows. Keep it under about 200 KB: a smaller picture loads faster, and speed counts for search.

3. **Put it in the post:**

   ```markdown
   ![EarBee looping bar 12 of a guitar solo at 0.5× speed](/img/blog/loop-a-bar.webp)
   ```

   The text in square brackets is the **alt text**. Screen readers read it, and search engines use it to understand the picture. Describe what it shows, in a sentence.

   With a caption under it:

   ```html
   <figure>
     <img src="/img/blog/loop-a-bar.webp" alt="EarBee looping bar 12 of a guitar solo at 0.5× speed" />
     <figcaption>Bar 12, looped at half speed.</figcaption>
   </figure>
   ```

### 6. Look at it

With `npm start` running, open http://localhost:8080/blog/. Your post is in the list, marked **draft**. Check:

- it reads well, and the links work;
- both themes look right (the sun/moon button in the top bar);
- at phone width, too: make the browser window narrow, or open the browser's device view (F12, then Ctrl+Shift+M).

## Publish a post

1. **Remove `draft: true`** from the header, and check that the `date` is today.
2. **Check that it builds** the way GitHub will build it:

   ```sh
   cd site
   npm run build
   cd ..
   ```

   Its last line says how many files it wrote (`… Wrote 6 files in 0.32 seconds`). If it prints an error, see "When something goes wrong".

3. **Commit and push it** to `testing`. A commit is a saved snapshot of your changes; a push sends it to GitHub.

   ```sh
   git add site/blog/slow-down-a-song.md site/img/blog/
   git commit -m "Blog: How to slow down a song without changing the pitch"
   git push
   ```

4. **Publish: move `main` up to `testing`.** The site is published from `main`, so the post goes online when `main` reaches it. First, see what `main` would get:

   ```sh
   git log --oneline main..testing
   ```

   This lists the commits on `testing` that aren't on `main` yet.
   - **Only your post (and other site changes):** go ahead.
   - **App changes too:** they go to `main` with your post. Follow step 4 of [maintaining.md](maintaining.md#4-when-testing-is-good-move-main-up-to-it) (it runs all the tests first), or ask an assistant to check.

   ```sh
   git checkout main
   git pull
   git merge --ff-only testing
   git push
   git checkout testing
   ```

   `--ff-only` ("fast-forward only") means `main` simply moves forward to where `testing` is, without a merge commit.

5. **Check it's live.**
   - On the [Actions tab](https://github.com/wiktor-rocks/earbee/actions), the "Website" run turns green after about a minute.
   - Open `https://earbee.org/blog/<post-name>/`.
   - Optionally, ask Google to index it now instead of in a few days: see [Getting found](#getting-found).

## Change or remove a post

- **A fix** (a typo, a better sentence): edit the file, then commit, push and publish as above.
- **A change that matters** (new steps, a new section, outdated advice fixed): also add `updated: YYYY-MM-DD` to the header. Search engines favour pages that are kept up to date. Leave `date` as it was.
- **Keep the file name.** It's the address (see "Create the file").
- **Removing a post:** delete its file and its pictures, then commit, push and publish. Its address then shows the "page not found" page, and search engines drop it after a while. If other posts link to it, fix those links first: `grep -rn "/blog/<post-name>/" site/` finds them.

## Write posts that get found

Search engines send visitors to the page that best answers what they typed. So:

- **One question per post.** Choose the phrase someone would type ("how to transcribe a guitar solo"), and answer exactly that.
- **Use the phrase** in the title, in the file name, and in the first paragraph. Use it naturally; repeating it doesn't help.
- **Answer early.** Give the short answer in the first few lines, then the detail. Readers who stay are a good signal.
- **Steps for how-to posts:** numbered steps, with a heading for each part.
- **Real pictures:** your own screenshots of EarBee doing the thing, with alt text.
- **Link between posts.** Each post links to two or three related ones, and to the home page or `/#download` where EarBee does what the post describes. These links help readers and search engines find the rest of the site.
- **Be honest about EarBee.** Explain the method so it's useful with any tool, then show how EarBee does it. A post that only advertises doesn't rank.
- **Length:** as long as the answer needs. That's often 800 to 1,500 words for a how-to. Padding hurts.
- **A good description** (the header): it's the advertisement in the search results, so say what the reader gets.
- **Regularly beats often.** One good post every two weeks or every month, kept up, does better than many at once and then nothing. Results take months, not days.

## Post ideas

Each idea gives the phrase it aims at, then the angle and how EarBee fits.

1. **"how to slow down a song without changing the pitch":** what time-stretching is, which speeds work for practice (start at 50–70 %), and the artefacts to expect at very low speeds. EarBee: 0.25× to 3×, same pitch.
2. **"how to transcribe a guitar solo by ear":** a step-by-step method: map the structure, loop one phrase, slow it down, find the first note, sing it, then write it down. EarBee: marks, loop the bar, step through it.
3. **"free alternative to Transcribe!":** an honest comparison of what you need for transcribing (speed, loops, EQ, markers, video) and the free options, with EarBee among them. Fair to the others.
4. **"how to learn bass lines by ear":** EQ to bring the bass forward and cut the rest, pitch up an octave to hear it better, and loop a bar at a time. EarBee: the EQ and pitch shift.
5. **"song tuned half step down: how to play along":** shift the recording up a semitone (or down) so it matches standard tuning, plus cents for old recordings that are slightly off. EarBee: pitch in semitones and cents.
6. **"how to loop a section of a song to practise":** the right loop length, adding a bar either side, and moving the loop on phrase by phrase. EarBee: <kbd>\\</kbd>, double and halve, Shift + [ and ].
7. **"how slow should I practise a song":** practice tempos: start slow enough to play it clean, then step up 5–10 % at a time. EarBee: the speed steps.
8. **"how to find the tempo / BPM of a song":** tap tempo versus beat detection, and why the bars matter more than the number. EarBee: <kbd>B</kbd> finds the beats and the tempo.
9. **"how to transcribe a jazz solo":** listen first, sing it, then note down rhythm before pitches; work through it phrase by phrase. EarBee: marks for each chorus.
10. **"how to learn a song from a YouTube video lesson":** open the lesson, slow the video, loop the teacher's hands; a note on respecting the creator's rights. EarBee: paste a link, the video stays in sync.
11. **"how to transcribe drums by ear":** separate the kick, snare and hi-hat with EQ, and use the beat grid to count. EarBee: EQ and the beat lines.
12. **"ear training by transcribing songs":** why transcribing is the best ear training, and how to start (bass lines, simple melodies, then solos).
13. **"how to map the structure of a song":** intro, verse, chorus, bridge: mark them first, then work section by section. EarBee: <kbd>R</kbd> marks a section, named and coloured.
14. **"how to hear chords in a song":** start from the bass note, listen for major or minor, and slow down the changes. EarBee: loop and slow down.
15. **"keyboard shortcuts for transcribing music":** a workflow without the mouse: play, replay, step, loop. EarBee: one key per step (a good page to link from other posts).

## Getting found

These need your Google and Microsoft accounts, so they're steps for you. Do them once.

**Google Search Console** shows how Google sees the site: which pages it has indexed, and the searches that find it.

1. Go to https://search.google.com/search-console and sign in.
2. **Add property** → **Domain** → type `earbee.org` → Continue.
3. Google shows a TXT record (`google-site-verification=…`). At your domain registrar's DNS settings, add a **TXT** record for `earbee.org` (the host is `@` or empty) with that value. Leave the other records as they are.
4. Back in Search Console, click **Verify**. If it fails, wait an hour (DNS changes take a while to spread) and try again.
5. **Sitemaps** (left menu) → enter `sitemap.xml` → **Submit**.

Afterwards:

- **Pages** (under Indexing): which pages Google has indexed, and why any aren't.
- **Performance**: the searches that showed your pages, how often, and how many people clicked. Use it to choose and improve posts.
- **A new post, indexed now:** paste its address into the search box at the top (URL inspection), then **Request indexing**.

**Bing Webmaster Tools** (also used by DuckDuckGo and others): go to https://www.bing.com/webmasters, sign in, and choose **Import from Google Search Console**. It takes over the site and the sitemap.

**Checking the structured data:** paste a page's address into https://search.google.com/test/rich-results. It should find the `BlogPosting` (a post) or `SoftwareApplication` (the home page) without errors. Google decides by itself whether to show anything special in the results.

## Change the rest of the site

- **The home page:** `site/index.html`. Its header (between the `---` lines) holds its title and description; the rest is plain HTML.
- **The top bar and the footer:** `site/_includes/base.njk`, for every page at once.
- **How a post looks,** and the EarBee box under it: `site/_includes/post.njk`, and the "Blog" section of `site/style.css`.
- **The blog's title and description,** the site's address and the author: `site/_data/site.json`.
- **The screenshot and the demo clips:** recorded from the app; see [site/README.md](../site/README.md).

Check every change with `npm start` (both themes, phone width), then `npm run check` at the top of the project (formatting and lint).

## When something goes wrong

- **`npm start` says `eleventy: command not found`:** run `npm install` in `site/` first.
- **`npm start` says the port is in use:** another preview is still running (Ctrl+C in its terminal), or run it on another port: `npx eleventy --serve --port 8081`.
- **The build stops with an error:** it names the file and the line. Usually it's the header:
  - a missing `---` line;
  - a `title` or `description` containing a colon (`:`), without quotes around it (the error then says `bad indentation of a mapping entry`);
  - a date that isn't `YYYY-MM-DD`.
- **A post doesn't appear on the site:** it still has `draft: true`; or `main` hasn't moved yet (`git log --oneline main..testing` lists it); or the "Website" run failed.
- **The "Website" run failed:** on the [Actions tab](https://github.com/wiktor-rocks/earbee/actions), open the red run and the step with the ✗; the error is at the bottom. Fix it, then commit, push and move `main` again. To publish again without a change: `gh workflow run pages.yml --ref main`.
- **The site doesn't load, or the address is wrong:** check the repository's Settings › Pages: the source is **GitHub Actions**, the custom domain is `earbee.org`, and **Enforce HTTPS** is ticked. The domain's DNS records at the registrar must be:

  | Type  | Host  | Value                                                                                     |
  | ----- | ----- | ----------------------------------------------------------------------------------------- |
  | A     | `@`   | `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` (four records) |
  | CNAME | `www` | `wiktor-rocks.github.io`                                                                  |

  `www.earbee.org` and the old address, `wiktor-rocks.github.io/earbee/`, both redirect to earbee.org.

## Later: your own server

Nothing ties the site to GitHub Pages. `site/_site/` is plain files, which any web server can host, and the domain keeps every address, so the search rankings come along. To move:

1. On the server, serve a folder with a web server. [Caddy](https://caddyserver.com) is the least work: it gets the HTTPS certificate by itself.
2. Copy the built site to it: `npm run build` in `site/`, then `rsync -av --delete site/_site/ user@server:/var/www/earbee/`. (Or change the last steps of `pages.yml` to do this over SSH.)
3. At the registrar, point the domain's records at the server instead of GitHub.
4. Turn off Pages in the repository's settings.

The download buttons keep working anywhere: they ask GitHub for the latest release from the visitor's browser, and the files stay on GitHub.

## Quick reference

```sh
# each from the project folder
cd site && npm install                 # once
cd site && npm start                   # preview at http://localhost:8080 (Ctrl+C stops it)
cd site && npm run build               # build the site, as GitHub does

# publish (after committing and pushing the post to testing)
git log --oneline main..testing        # what main would get
git checkout main && git pull && git merge --ff-only testing && git push && git checkout testing
```

A new post, `site/blog/<words-people-search-for>.md`:

```markdown
---
title: "Up to about 60 characters"
description: "120 to 155 characters: what the reader gets."
date: YYYY-MM-DD
draft: true
---

The short answer first.

## The first section
```

Pictures: `site/img/blog/<name>.webp`, at most 1360 px wide, each with alt text.
