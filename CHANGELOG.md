# EarBee: change log

EarBee is an Electron app for transcribing music. You open a song or a video, slow it down, shift its pitch, EQ it, loop a passage, and step through it with the keyboard.

**Files**

- `electron/`: the Electron main process: `main.js` (window, security), `windows.js` (window state, the splash, the video window), `prefs-store.js` (settings and the colour theme), `downloader.js` (yt-dlp), `media-files.js` (serving downloads to the page), `project-files.js` (.ebee files), `system.js` and `preload.js` (the page's bridge to them).
- `src/`: the page, as ES modules in layers. `core/`, `themes/`, `search/` → `prefs/`, `marks/`, `project/` → `config.js` → `audio/`, `video/`, `waveform.js`, `timeline.js` → `context.js` → `ui/` → `features/` → `app.js`.
- `index.html` and `style.css`: the page and its look.
- `assets/`: the logo and icons; `scripts/make-images.py` makes them from the source image.
- `tests/`: unit tests (`unit/`), end-to-end tests (`run.cjs` + `e2e/`) and the smoke test; all run with `npm test`.

The architecture overview, the file map and a list of where to make common changes are in the comment at the top of `src/app.js`. Read that first. `README.md` covers running, testing and building.

**How to read an entry.** Newest first, one entry per round of work. Each change records:

- **What:** the behaviour, as the user sees it.
- **Why:** the request or problem behind it.
- **How:** the mechanism, and any constraint that isn't obvious from the code.
- **Where:** files and function names, rather than line numbers, which drift.
- **Verified by:** how it was tested.

**Older entries** (before "Modules") refer to `script.js` and its numbered sections, and to `main.js`, `downloader.js` and `preload.js` at the top level. Here is where each now lives:

| Then                                     | Now                                                                                      |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| §1 Config                                | `src/config.js`                                                                          |
| §2 Pure helpers                          | `src/core/` (`format.js`, `media.js`, `timeline.js`, `emitter.js`, `errors.js`)          |
| §3 Settings                              | `src/context.js`                                                                         |
| §4 Audio engine                          | `src/audio/engine.js`                                                                    |
| §5 Transport                             | `src/audio/transport.js`                                                                 |
| §6 Waveform                              | `src/waveform.js`                                                                        |
| §7 Video                                 | `src/video/view.js`, `src/video/proxy.js`                                                |
| §8 Instances                             | `src/app.js`; the `returnPoint` listeners are in `features/playback.js` (`bindPlayback`) |
| §9 UI                                    | `src/ui/dom.js`; the generated controls are in `src/ui/controls.js`                      |
| §10 Setting controls                     | `src/ui/controls.js`                                                                     |
| §11 File loading                         | `src/features/open-file.js`, `src/features/download.js`                                  |
| §12 Playback actions                     | `src/features/playback.js` (the A–B loop too)                                            |
| §13 Keyboard shortcuts                   | `src/ui/shortcuts.js`; the `SHORTCUTS` table is in `src/app.js`                          |
| §14 Startup                              | `src/app.js` (`start`)                                                                   |
| `main.js`, `downloader.js`, `preload.js` | `electron/`                                                                              |
| `tests/run.cjs` (one sequence)           | `tests/run.cjs` + `tests/e2e/`                                                           |

---

## 2026-10-19: Reminders at the start of every session (AGENTS.md)

- **What:** at the start of every session, before answering the owner's first message (whatever it is), an assistant shows the items in the "Reminders" section of `local/SCRATCHPAD.md`, word for word.
- **Why:** the owner wants to be reminded of certain things in the next session, whatever they write to the assistant first.
- **How:** a section at the top of AGENTS.md, which every session loads (CLAUDE.md includes it). Missing file or empty section: nothing is said. The scratchpad is the owner's alone: assistants read it but never change it, even when asked; they suggest, and the owner writes. So "Ending a session" now puts loose ideas in the summary instead of the scratchpad.
- **Where:** `AGENTS.md` ("First, in every session", and "Read first", item 0); the section itself is in `local/SCRATCHPAD.md` (on this computer only).
- **Verified by:** `npm run format:check`.

## 2026-10-19: A blog on earbee.org (the website, built with Eleventy)

- **What:** the website has a blog at earbee.org/blog/.
  - Posts are Markdown files; one with `draft: true` shows in the preview only.
  - New pages: the blog's own page, an RSS feed (`/blog/feed.xml`), a sitemap, `robots.txt` and a "page not found" page.
  - Every page gets its own title, description, canonical address and social-sharing tags. The home page also carries `SoftwareApplication` data, and each post `BlogPosting` data, for search engines.
  - The top bar is now Blog, Download, GitHub and the theme switch. The footer links to the blog and its feed.
  - Links to the website point at earbee.org instead of the github.io address.
  - A guide for the owner, `docs/blog.md`: writing, publishing and changing posts, writing posts that rank, post ideas, Google Search Console and Bing, troubleshooting, and moving to another server.
  - No posts yet: the placeholder post was removed before the merge.
- **Why:** the owner wants search traffic. The blog waited for a custom domain (now earbee.org), so published addresses never change.
- **How:**
  - `site/` is a small Eleventy project with its own `package.json`, apart from the app's. The build doesn't install Electron or ONNX Runtime.
  - The home page's content stays in `index.html`. Its head, top bar and footer moved to `_includes/base.njk`, shared by every page; addresses there start with `/`, so they work from `/blog/<post>/`.
  - Posts are plain Markdown (no Nunjucks), so braces in them stay text. Their address, `/blog/<file name>/`, is computed in `blog/blog.11tydata.js`; a template string isn't filled in there.
  - Drafts are left out of `npm run build` by a preprocessor. `_site/` is ignored as input, in case a build was sent elsewhere with `--output`.
  - `pages.yml` now builds the site and publishes `site/_site`. CI has a `site` job that builds it on every push, so a broken post shows up before `main`.
  - Small-phone top bar: tighter under 400 px; Blog hides under 350 px and GitHub under 600 px.
- **Where:**
  - the site: `site/package.json`, `site/eleventy.config.js`, `site/_data/site.json`, `site/_includes/base.njk` and `post.njk`, `site/blog.njk`, `site/blog/blog.11tydata.js`, `site/sitemap.njk`, `site/robots.txt`, `site/404.md`, `site/index.html`, and `site/style.css` ("Blog", "Narrower screens");
  - the workflows: `.github/workflows/pages.yml`, `ci.yml`;
  - housekeeping: `.gitignore`, `.prettierignore`, `eslint.config.js`;
  - the docs: `docs/blog.md`, `site/README.md`, `docs/maintaining.md`, `README.md`, `AGENTS.md`;
  - earbee.org links: `package.json`, `.github/ISSUE_TEMPLATE/config.yml`.
- **Verified by:**
  - screenshots at 1280 and 390 px, dark and light: the home page is unchanged apart from the top bar and the footer, and the blog page, a post and the 404 page look right;
  - the top bar measured from 430 down to 320 px: no overflow;
  - a production build with a test post: valid feed and sitemap XML, the JSON-LD parses, drafts are left out, and braces and `\\` come out right;
  - the guide's post template and picture command, followed as written;
  - `npm run check`, CI (check and site) on `exp/blog`, and `npm test` after the merge.

## 2026-10-18: An end-of-session routine (AGENTS.md)

- **What:** AGENTS.md has an "Ending a session" section: what an assistant does when the owner says they're done. Stop what's running, put back temporary changes, commit finished work (and decide with the owner about unfinished work), push, tidy up, update `local/FOR-TOMORROW.md`, leave the working copy on `testing`, and sum up.
- **Why:** the owner wants each session to end in a clean, known state for the next one. "Read first" already covered the start of a session. During this one, temporary timing code had to be found and reverted, a commit stayed unpushed overnight, FOR-TOMORROW.md fell behind, and a build left by-products in `dist/`.
- **How:** eight short steps, each with its check where there is one (`git status`, `git status -sb`). No `git stash`, which is easy to forget. Unfinished work on `testing` is the owner's call: a new experiment branch, or left uncommitted and noted in FOR-TOMORROW.md.
- **Where:** `AGENTS.md` ("Ending a session", at the end).
- **Verified by:** `npm run format:check`; followed for the first time at the end of this session.

## 2026-10-18: How to make a test build (AGENTS.md)

- **What:** AGENTS.md has a "Test builds" section: when the owner asks for a test build of a branch, make an AppImage, named after the branch, with the build's by-products removed and the smoke test run on it.
- **Why:** asked for a test build of `exp/beat-windows`, an assistant made an unpacked build (`npm run build:dir`, the only build AGENTS.md listed) when an AppImage was wanted.
- **How:** six steps: a clean checkout, `npm run build:linux`, renaming the file (`EarBee-<version>-<branch>-x86_64.AppImage`, so it isn't taken for a release), deleting `dist/linux-unpacked` and `dist/builder-debug.yml`, the smoke test against the AppImage (`TB_APP_BINARY`), and giving the owner its path. It also says `build:dir` is for testing a packaged build, not for trying one, and that Windows and Mac test builds aren't set up yet.
- **Where:** `AGENTS.md` ("Test builds").
- **Verified by:** the steps were followed for `exp/beat-windows` (the smoke test passed, 28 checks); `npm run format:check`.

## 2026-10-18: Commit messages without trailer lines

- **What:** AGENTS.md now says a commit message is one short line and nothing else: no `Co-Authored-By` or other trailer lines, even where an assistant's tool adds them by default.
- **Why:** the user doesn't want the attribution line on every commit.
- **How:** one sentence added to the commit-message convention. Commits already pushed with the line keep it; history isn't rewritten.
- **Where:** `AGENTS.md` ("Conventions").
- **Verified by:** `npm run format:check`.

## 2026-10-18: No false "couldn't be decoded" when opening another video

- **What:** opening a video while another was playing could show "Part of the video couldn't be decoded, so the picture may stop updating" under the timeline, about the new file, which was fine. That message no longer appears unless the video on screen really fails to decode.
- **Why:** found while measuring performance (`local/performance-report.md`): switching between the demo clips logged `InputDisposedError: Input has been disposed`. Switching 10 times between a 1080p and a 4K clip showed the false message 4 times.
- **How:**
  - The old video's input is disposed as the new one is shown (`discard`), and its decoding loop then fails with Mediabunny's `InputDisposedError`.
  - The loop's one `try` around everything caught that failure. It checked `current`, which by then was the new video, and reported a problem for it.
  - Each pass of the loop now has its own `try`. A failure of a video that is no longer current, or has been discarded, closes its cursor and carries on with the current one. Any other failure goes to the existing handler, unchanged: logged once, and reported once per file.
- **Where:** `src/video/view.js` (`run`); a new check at the end of `tests/e2e/08-video.cjs`.
- **Verified by:**
  - The new e2e check: open another video while one plays, 4 times, and count the messages. It fails without the fix ("1 shown") and passes with it.
  - A local script switching the demo clips 10 times: before the fix 4–7 warnings and 4 false messages; after it, none.
  - `npm run check`, `npm run test:unit`, `TB_TOPICS=03,08,09,18,19 npm test` (142 pass).

## 2026-10-18: The local to-do list becomes a scratchpad

- **What:** `local/TODO.md` is now `local/SCRATCHPAD.md`: loose notes, ideas and things to do or try, with no checkboxes or format to keep. AGENTS.md names it, and says to check it with FOR-TOMORROW.md at the start of a session.
- **Why:** the user wanted a free-form scratchpad rather than a to-do list.
- **How:** the file was renamed and its items kept as plain notes; `local/README.md` and `local/FOR-TOMORROW.md` (both local) point to it.
- **Where:** `AGENTS.md` ("Read first"). The files themselves are local.
- **Verified by:** `npm run format:check`; nothing from `local/` shows in `git status`.

## 2026-10-18: A local/ folder for notes, with a to-do list

- **What:** a `local/` folder at the top of the repo that git ignores, for files that stay on the user's computer. It holds `FOR-TOMORROW.md` (moved in from the top), a new `TODO.md` checklist and a short `README.md` saying what the folder is. AGENTS.md now points to both notes files there.
- **Why:** the user wanted a to-do file as well, and one place for their local files.
- **How:**
  - The two notes files each have one job. FOR-TOMORROW.md is the handoff between sessions: what's in flight, with its next step, and context worth knowing. TODO.md is the checklist of things to do, decide, try, and parked ideas; those sections moved there from FOR-TOMORROW.md.
  - `.gitignore` ignores `local/` instead of the single file. Prettier already skips what git ignores; ESLint's ignore list gets `local/`, so a script kept there can't break `npm run check`.
- **Where:** `.gitignore`, `eslint.config.js`, `AGENTS.md` ("Read first"). The folder itself is local.
- **Verified by:** `npm run check`; `git check-ignore` confirms git ignores the folder, and `git status` shows nothing from it.

## 2026-10-18: FOR-TOMORROW.md, the open threads between sessions (local only)

- **What:** a file kept on the user's computer only, `FOR-TOMORROW.md` at the top of the folder (git ignores it), for what's still important but not done: in flight, to decide, not tried yet, parked ideas, good to know. Each entry says what it is, why it matters and the next step. AGENTS.md lists it first under "Read first", so an assistant starting fresh (after the context was cleared) checks it, and keeps it current.
- **Why:** the user clears the assistant's context between working sessions and wants the open threads to survive that, on their own computer, not on GitHub.
- **How:** it's a plain file the user can read and edit, not an assistant's private notes. `.gitignore` lists it, so it's never committed; AGENTS.md says to read it if it exists, and never to commit it. Finished threads are deleted from it; the CHANGELOG keeps the record. It starts with: CI on the ETXTBSY fix (and moving `main` after), the local-only `backup/testing-2026-10-12` branch, the beat model on Intel Macs, `npm audit`'s findings, the untried Mac builds, the blog and right-click ideas, e2e topics leaning on earlier ones, and where the demo sources are kept.
- **Where:** `.gitignore`; `AGENTS.md` ("Read first"). The file itself is local.
- **Verified by:** `npm run format:check`; `git check-ignore` confirms git ignores the file, and no commit contains it.

## 2026-10-18: yt-dlp starts even when its file is briefly busy (ETXTBSY)

- **What:** starting yt-dlp no longer fails with "spawn ETXTBSY" just after it was set up. That was rare in the app, but frequent in CI: one unit test ("a new search doesn't cancel the setup…") failed on four pushes in a day, sometimes several times running, and each time the job had to be re-run.
- **Why:** the user asked for the flaky test to be fixed. The cause was in the downloader, not the test: the test runs the real setup, which downloads yt-dlp, writes it, and starts it.
- **How:**
  - On Linux, a program can't start while any process has its file open for writing. Right after the setup writes yt-dlp, a process started elsewhere at that moment (in the tests, other tests start processes in parallel) briefly inherits the open file, and the start fails with ETXTBSY. It passes within milliseconds.
  - `run` now tries the start again on ETXTBSY: up to 5 times, waiting 50, 100, 150 and 200 ms, and not after a cancel. Any other error is thrown as before. `spawn()` throws this error rather than reporting it on the child's "error" event (as it does for a missing file), so the retry catches the throw; the first try at the fix handled the event, and the new test showed it didn't work.
  - A new unit test makes the case happen every time: it holds the stand-in yt-dlp open for writing, starts a search, and frees the file 80 ms later. It fails without the fix with exactly CI's error (`spawn ETXTBSY`), and passes with it.
  - AGENTS.md no longer lists the flaky test as a pitfall, and now says e2e topic 09 needs a file open (`TB_TOPICS=03,09`); run alone, one of its checks fails whether or not this change is in.
- **Where:** `electron/downloader.js` (`run`, `runOnce`, `START_ATTEMPTS`), `tests/unit/search.test.mjs` ("starting yt-dlp while its file is busy"), `AGENTS.md`.
- **Verified by:** the new test, 5 runs in a row, and failing without the fix. `npm run check`; `TB_TOPICS=03,09 npm test` (270 unit, 88 e2e, 28 smoke). Then CI on `testing`.

## 2026-10-17: A codebase comfortable for AI assistants: AGENTS.md, a glossary, the main process type-checked

- **What:**
  - **`AGENTS.md`**, the one place an AI assistant starts: what EarBee is (the page and the main process), what to read first, how to find your way in the big files (style.css's outline, CHANGELOG's top), the commands, which checks to run for which change, the conventions, the known pitfalls, and the branches. `CLAUDE.md` includes it, for Claude Code.
  - **`docs/glossary.md`**: the app's words (start and stop point, region, phrase, snapping, beat model, Peak + loudness, the dock, the proxy, project sections…) mapped to the identifiers and files in the code.
  - **The main process is type-checked too.** `npm run check` now runs `tsc` on `electron/` (new `electron/jsconfig.json`) as well as on the page.
  - The header of `src/app.js` ends with "READ ALSO": the glossary and AGENTS.md.
- **Why:** the user wants any LLM to be able to work in the repo without being told the basics each time: where things are, what the app's words mean in code, what to run, and what's known to go wrong. Type-checking the main process catches an assistant's mistakes there the way they're already caught in the page.
- **How:**
  - The pitfalls were scattered through code comments and notes: `ELECTRON_RUN_AS_NODE` from VS Code's terminal, e2e needing a display (`xvfb-run -a`), the harness emptying `tests/output/downloads`, the flaky `spawn ETXTBSY` unit test in CI, `.npmrc` and ONNX Runtime's CUDA, and `site/` being published as is.
  - **Types:** `electron/jsconfig.json` uses the page's lenient settings, with Node's module system (`NodeNext`), Node's types, and the DOM's for `preload.js` and `splash.js`, which run in a page. It found 9 errors, all JSDoc out of step with the code; the fixes change no behaviour. The `fetch` option's type now names `globalThis.fetch` (it referred to itself). Two `resolve` callbacks became `() => resolve(undefined)`. The GPU info gets its shape (Electron types it `unknown`). electron-reload is cast to what it is (its types declare a default export the module doesn't have). The Downloads settings get their type at the call. `allowVideoWindow` gets JSDoc, including `icon`.
  - `@types/node@^22` is now a devDependency, matching the Node the app needs. It came only through electron-builder before (at 24), and could have vanished.
  - Every identifier in the glossary was checked with `grep` against the files it names, and every command in AGENTS.md was run.
- **Where:** new `AGENTS.md`, `CLAUDE.md`, `docs/glossary.md`, `electron/jsconfig.json`; `package.json` (`typecheck`, `@types/node`), `package-lock.json`; `electron/main.js`, `downloader.js`, `windows.js` (JSDoc); `src/app.js` (header).
- **Verified by:** `npm run check` with the new type-check. A type error planted in `electron/beat-model.js` was caught, then removed. The unit tests (269), one unit file on its own, `TB_TOPICS=20 npm test` (41 e2e, 28 smoke) and the style.css outline grep. `npm audit`'s 12 findings are all in electron-builder's and electron-reload's dependencies, as before; `@types/node` added none.

## 2026-10-17: The experiment procedure, step by step; notes for AI assistants

- **What:** the "Trying an idea: an experiment branch" section of `docs/maintaining.md` is now an exact procedure that a person or an AI assistant can follow the same way every time. It starts with six rules: the branch name, stop when something goes wrong, what never to do, where the CHANGELOG is written, who decides, and a clean working tree. Then come procedures A (start), B (work), C (bring in `testing`), D (merge into `testing`), E (throw away) and F (see what's there), each a table of numbered steps with the command and the check of its result. New `AGENTS.md` sums up the branches and the per-change routine for AI assistants and points to the procedure. New `CLAUDE.md` includes it, for Claude Code.
- **Why:** the user wants an LLM to be able to repeat the procedure exactly, every time.
- **How:**
  - Each step's check is something a reader can test: an exact line of output, an exit code (`git ls-remote --exit-code` exits with 2 when a branch isn't there; `git merge-base --is-ancestor` with 0), or "no error". On anything else, rule 2 says stop and report.
  - The two places where failing is expected say what to do. A conflict in C5: `git merge --abort`, then a person resolves it. Failed tests in D5: `git reset --hard ORIG_HEAD` undoes the unpushed merge.
  - D merges with `--no-ff` and a fixed message ("Merge experiment exp/IDEA"), so a finished experiment is visible in the history. C runs first, so D can't conflict.
  - Before D and E an assistant asks the owner (rule 5).
- **Where:** `docs/maintaining.md`, new `AGENTS.md` and `CLAUDE.md`, `README.md` (pointer).
- **Verified by:** `npm run format:check`. Procedures A to E were run in a scratch clone with a local stand-in for GitHub, and every expected output was checked against the real one. A merge conflict in C5 was provoked, and so was `-d` refusing an unmerged branch. Two checks were reworded to match git's real wording: "Deleted branch … (was …)", and "- [deleted]" followed by several spaces.

## 2026-10-17: Experiments on their own branches

- **What:** a third kind of branch, for trying ideas that might not work out: `exp/<idea>` (say, `exp/tuner`), one per idea, made from `testing`. If the idea works, the whole branch is merged into `testing` and deleted; if not, it's just deleted. `docs/maintaining.md` has a new section, "Trying an idea: an experiment branch", with the commands for starting one, keeping it up to date, bringing it into `testing`, throwing it away, finding your way and handling a merge conflict. CI checks every `exp/` branch too.
- **Why:** the user wanted a place to experiment without cluttering `testing`. They compared one permanent `experiments` branch (good commits cherry-picked into `testing`) with a branch per idea, and chose the branch per idea: an idea that works comes back with one merge, and a failed one leaves nothing behind.
- **How:**
  - The rules: one idea per branch; `git merge testing` to keep a long one up to date (no rebasing pushed work); the CHANGELOG entry is written when the idea is merged into `testing`, not on the experiment; an experiment reaches `main` only through `testing`.
  - CI's push trigger is `[main, testing, "exp/**"]`, so experiments get the 1-minute checks (formatting, lint, types, unit tests). The e2e tests, the website and releases stay with `main` and tags. GitHub reads the workflow from the pushed commit, so new experiments made from `testing` get it without `main` moving.
- **Where:** `docs/maintaining.md` ("How it's set up", the new section, "Undoing things"), `README.md` (the pointer to it), `.github/workflows/ci.yml`.
- **Verified by:** `npm run format:check`. A throwaway `exp/ci-check` branch, made, pushed and deleted with the documented commands, got its CI run.

## 2026-10-17: The landing page: beats and loops, demos from the app, phones

- **What:**
  - **A section on the beats** ("It hears the beat. You loop the bar."): finding the beats and bars, and looping a bar then the next, each beside a looping clip of the app. "What it does" gains "Beats and bars", the keys list gains `B`, `\`, `=` `-` and Shift+`[` `]`, and the credits add Beat This! and ONNX Runtime. The top bar's "Beats" link goes to the new section.
  - **A new screenshot and two clips, recorded from the app**, each in a dark (EarBee) and a light (EarBee Light) version, with the Peak + loudness waveform. The page shows the version for its mode, and swaps them when the mode changes. The old screenshot, which still said "TranscriBee", is gone.
  - **Shorter, concrete text** throughout: one idea per sentence, the key and what it does.
  - **Phones and small screens:** a phone or tablet is told that EarBee is a desktop app instead of being offered a download; the top bar keeps the logo, a thumb-sized Download button and the theme switch; the hero's big bee is hidden under 860 px; key combinations and the build command don't break across lines; headings and paragraphs avoid a lone last word; under 1100 px every download is a full-width button, so the Mac card's two sit one under the other.
  - **A little amber in the second half:** a short bar above each section title from "What it does" on, and an amber start to each divider line in "What it does".
  - The hero's "Free and open source" line is gone; the Free section right below says it in full.
- **Why:** the user asked for the page to talk about the 0.2.0 features with screenshots and clips, in plainer words, and to work on phones; then for the details above as they reviewed it on a local server.
- **How:**
  - **The demos:** a stock concert video (Pexels 16803490, whose own soundtrack is silent) with 19 s of "Rock City Ransom" by Ragnar Random (OpenGameArt, CC0) under it. `scripts/record-site-media.cjs` drives the real app offscreen through the e2e harness: each scene opens the file, zooms the waveform in and presses real keys; the clips' frames come from the offscreen window's paint events and go to ffmpeg at 30 fps. It records every scene in both themes and writes `site/img/clip-*-{dark,light}.{mp4,webp}` and `screenshot-{dark,light}.webp`, 1.4 MB together.
  - **Which version shows:** the screenshot is a `<picture>` whose `<source>` follows the system; the clips name their files in `data-dark` / `data-light`. `showModeMedia` in `download.js` gives each the page's mode (a mode chosen with the button overrides the system's), at load, on the button, and when the system changes. Without JavaScript the screenshot still shows.
  - **Phones:** the head script adds `phone` to `<html>` on a phone or tablet (including an iPad that reports itself as a Mac), which swaps the hero's buttons for the note, before the page shows.
  - The section's order is back to the original: the Free section sits right after the hero, as its own spacing assumes.
- **Where:** `site/index.html`, `site/style.css`, `site/download.js` (`showModeMedia`, `currentMode`, `calmClips`), `site/README.md` (the demos, and how to make them again), `site/img/`; new `scripts/record-site-media.cjs`; `eslint.config.js` (`scripts/**/*.cjs` as Node).
- **Verified by:** `npm run check`. The page rendered offscreen at 390, 600, 768, 1024, 1280 and 1600 px, dark and light, with nothing wider than the window. In a browser: a dark system gets the dark set, playing; the theme button swaps everything to light; a light system gets the light set; with reduced motion the clips stay paused on their posters, with controls. Every recorded frame was looked at for leftover hover labels and notifications.

## 2026-10-17: Version 0.2.0

- **What:** EarBee 0.2.0, the first release under the new name. Details are in the entries below, back to "A splash window while the app starts".
  - **New:**
    - **Finding the beats** (B), by the Beat This! model: a line on each beat and a stronger one on the first of each bar, the tempo, and ← / → by beat or by bar. **A click on each beat** (Shift+B) checks them by ear.
    - **Looping by the music:** `\` loops the bar you're in, `=` / `-` double or halve the loop, and Shift+`]` / Shift+`[` move it on or back by a phrase. Loop edges and marks snap to the beats; hold Alt to place them freely.
    - Dragging a loop edge while playing takes effect at once.
    - A **splash window** while the app starts.
  - **Better:** 12 speed presets, finer at the slow end (0.25× to 0.5× in 0.05 steps), beside the Speed title. More room in the From YouTube dialog.
  - **Renamed: ScriBee is now EarBee.**
    - On its first start, EarBee takes over ScriBee's settings: the theme, the window, the download folder and the rest.
    - Project files are now `.ebee`. Rename a `.sbee` file to `.ebee` to open it; the content is the same.
    - New downloads go to `Downloads/EarBee`, unless you chose another folder.
  - **Good to know:** the beat model makes the downloads about 25–30 MB larger (about 45 MB once unpacked; the Intel Mac build 8 MB, without ONNX Runtime). Intel Macs can't run it, so they find beats with the simple finder, without bars.
- **Why:** the user asked for a new release of what was on `testing`, and chose 0.2.0 (new features, while 1.0.0 waits until the Mac builds have been tried).
- **How:** `npm version 0.2.0 --no-git-tag-version`, then `main` moved up to `testing` and tagged `v0.2.0`, which builds the release (docs/maintaining.md, "Putting out a new version").
- **Where:** `package.json`, `package-lock.json`.
- **Verified by:** the full `npm test` before `main` moved; main's CI; and the draft release's files: the smoke test against the Linux AppImage, and the Windows and Apple Silicon builds checked for the beat model and ONNX Runtime's native files.

## 2026-10-17: More room in the From YouTube dialog

- **What:** the From YouTube dialog is less cramped. Opened from the welcome screen (no results yet), the option cards no longer sit right on the footer's line. Search results start further below the cards and stop short of the footer, with more space around and between them. The search bar and its button are a little taller, the option cards have more padding, and every part of the dialog keeps the same 22 px side margin as its header.
- **Why:** the user asked for more padding in several places in this dialog, before the 0.2.0 release.
- **How:** spacing only, all in `style.css`:

  | Rule                                    | Was                          | Now                                                                       |
  | --------------------------------------- | ---------------------------- | ------------------------------------------------------------------------- |
  | `.youtube-top` padding                  | `18px 20px 4px`              | `20px 22px` (empty dialog: 20 px between the cards and the footer, was 4) |
  | `.youtube-results` padding, gap         | `10px 14px 10px 20px`, `8px` | `4px 16px 18px 22px`, `10px`                                              |
  | `.search-results` gap                   | `2px`                        | `6px`                                                                     |
  | `.search-result` padding                | `6px`                        | `8px 10px`                                                                |
  | `.youtube-search` height, padding       | `46px`, `0 5px 0 14px`       | `50px`, `0 7px 0 16px`                                                    |
  | `.youtube-search button.primary` height | `36px`                       | `38px`                                                                    |
  | `.youtube-options` gap                  | `10px`                       | `12px`                                                                    |
  | `.youtube-options .pref-field` (new)    | `.pref-field`'s `14px 16px`  | `16px 18px`, in this dialog only; Settings is unchanged                   |
  | `.youtube-footer` padding               | `12px 22px 14px`             | `14px 22px 16px`                                                          |

- **Where:** `style.css`, "From YouTube dialog" and the `.search-result*` rules above it.
- **Verified by:** `npm run check`; `tests/e2e/02-welcome.cjs` and `09-downloads.cjs` (72) with the unit (269) and smoke (28) tests. Screenshots of the dialog opened from the welcome screen, with search results, at 1200×800 and 960×680, and in EarBee Light were checked by eye: nothing wraps, and only the results scroll.

## 2026-10-17: Two beat-finding edge cases

- **What:**
  - Pressing B just as the beat model's process stops for being idle now uses the model as usual. Before, that search fell back to the simple beat finder (no bars).
  - If a beat search fails partway, the beats found so far are forgotten with it: their lines, the beat or bar step, and the clicks. Before, the lines stayed on the waveform while the chip said "Find the beats" again.
- **Why:** both turned up in a review of `testing` before merging it into `main`. Neither had been seen in use; the user asked for them fixed first.
- **How:**
  - **The model's process:** `kill()` returns before the process exits, and `child` stayed set until its `exit` event, so a window sent in between went to the dying process and failed. Now the idle stop (`stop`) forgets the process as it kills it, so the next window starts a new one. Each process keeps its own `pending` requests, so a late `exit` from the old one fails only its own (none), not the new one's.
  - **A failed search:** `fail` now calls `resetBeats(media)`, which also stops the search and puts a beat or bar step back to the default. It does nothing for a search that's no longer the latest (`mine !== search`), so a late failure can't wipe a newer file's beats.
- **Where:** `electron/beat-model.js` (`createBeatModel`: `start`, `stop`, `run`); `src/features/beats.js` (`find`'s `fail`).
- **Verified by:** new `tests/unit/beat-model.test.mjs` with a fake utility process: it starts on the first window; it stops after a minute idle, never while a window runs; a window sent while an idle process is still exiting goes to a new process and is answered (this test fails on the old code); a process that dies fails only its own windows. `npm run check`, the unit tests (269), `tests/e2e/20-beats.cjs` (41) and the smoke test (28). Making a search fail partway would need a fault in the model's answers, which the tests can't inject, so the second fix was checked by reading the code.

## 2026-10-17: Twelve speed presets, finer at the slow end

- **What:** the Speed group has 12 preset buttons instead of 8: 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.6, 0.7, 0.75, 0.8, 0.9 and 1×. The group is now two columns: the title and the slider on the left, the presets on the right, their first row level with the "Speed" title. The presets sit in two rows of six; under 1100 px wide, three rows of four.
- **Why:** the user wanted finer control from the buttons, with the new ones at the low speeds (the old set jumped straight from 0.25× to 0.5×), and the buttons to start at the height of the title.
- **How:**
  - The four new presets fill the 0.25–0.5 gap in 0.05 steps; every old preset stays.
  - The grid was 8 columns (4 under 1280 px). It is now 6, and 4 only under 1100 px: six still fit beside the slider down to 1100 px.
  - The title row and the slider are wrapped in `.speed-main`, a column; `.speed-group` lays it out in a row with the presets. `align-items: flex-start` keeps the presets from stretching to the column's height (they grew to 32 px tall). The rule is `.dock .speed-group` so the short window's `.dock-group { gap: 3px }` doesn't close up the 14 px between the columns; `.speed-main` gets the short window's 3 px gap itself.
  - With the presets beside the title, the dock is 18 px shorter on a wide window (102 px instead of 120) and about the same under 1100 px (118 instead of 120).
- **Where:** `src/config.js` (`CONFIG.speed.presets`); `index.html` (the Speed group: `.speed-main` replaces `.speed-controls`); `style.css` (`.dock .speed-group`, `.speed-main`, `.chips`, the `max-width: 1099px` query, which took over the old 1279 px rule, and the `max-height: 719px` query).
- **Verified by:** `npm run check`. In an offscreen Electron window at 1600, 1440, 1279, 1100 and 960 px wide, and at 1440 and 960 px with a short window (680 px): 12 buttons; a click on 0.35× sets the readout and highlights the button; the first row's top and centre match the title row's; the speed slider is level with the volume slider; the buttons stay inside the Speed group. Screenshots of the dock were checked by eye.

## 2026-10-17: ScriBee is now EarBee

- **What:** the app is called **EarBee** everywhere: window titles, the wordmark (Ear**Bee**, "Bee" in the accent colour), the splash, the theme names (EarBee, EarBee Light), messages, the landing page, the GitHub templates and the docs. Project files are now `.ebee`; existing `.sbee` files don't open any more (rename them: the content is the same). Downloads go to `~/Downloads/EarBee` unless another folder was chosen. On its first start under the new name, the app copies ScriBee's settings folder, and this time nothing resets: the colour theme, the sidebar and the video-window choice all carry over.
- **Why:** the user renamed the app. ScriBee 0.1.0 and 0.1.1 are published, so people's settings had to come along. The user chose `.ebee` only (no reading `.sbee`), and links to `wiktor-rocks/earbee`; the user renames the GitHub repo themselves.
- **How:**
  - Every name was changed by rule (the history entries below keep the old ones): `ScriBee` → `EarBee`, `scribee` → `earbee`, `.sbee` → `.ebee`, `Scri<b>Bee</b>` → `Ear<b>Bee</b>`. So also the bridge (`window.earbee`), the media URL scheme (`earbee-media://`), the video window's frame name, the localStorage keys, the temp-folder prefixes, the theme ids (`earbee`, `earbee-light`), the project format id (`earbee-project`), the package (`name`, `appId: com.earbee.app`, `executableName`, the repo URLs), `site/download.js`'s `REPO`, and `assets/earbee-source.png`.
  - **Settings folder:** `adoptOldSettings()` now copies `…/ScriBee` (marker `adopted-scribee-settings`), with the same rules as before. The TranscriBee step is gone: that name was never published.
  - **Theme:** prefs.json goes to version 2. `upgrade()` maps `scribee` → `earbee` and `scribee-light` → `earbee-light` in `choice`, `dark` and `light`, before the values are normalized (an unknown id would fall back to the default).
  - **Sidebar and video window:** the page reads its new localStorage key and falls back to the old one (`scribee.sidebarHidden`, `scribee.videoPopped`), which the copied folder brings along.
  - Not done: `site/img/screenshot.webp` still shows an older wordmark ("TranscriBee") and needs a new screenshot.
- **Where:** 73 files, the main ones being `package.json`, `electron/main.js` (`adoptOldSettings`), `electron/prefs-store.js` (`upgrade`, `RENAMED_THEMES`), `src/features/layout.js`, `src/features/video-window/index.js`, `src/project/format.js`, `src/themes/palettes.js`, `index.html`, `electron/splash.html`, `site/`, `.github/`, `README.md` and the tests.
- **Verified by:** `npm run check` and the full `npm test` (264 unit, 455 e2e, 28 smoke), with a new unit test for the version 1 → 2 theme step. `adoptOldSettings` was run on its own against temporary folders: it does nothing with `--user-data-dir`, copies once, and leaves later changes alone. `git grep -i -e scribee -e sbee` finds the old names only in this CHANGELOG's history and in the migration code above.

## 2026-10-17: Loop by bar, phrase by phrase; snapping to beats

- **What:**
  - **`\`** loops the bar the cursor is in, or what's being heard while playing. Without bars (the simple beat finder) it loops the beat. Without beats it asks for them (B).
  - **`=` / `-`** double or halve the loop from its start.
  - **Shift+`]` / Shift+`[`** move the loop on or back by its own length: the next or previous phrase. Playing, playback jumps straight into it; paused, the cursor goes to its start.
  - **Snapping:** while the beat lines show, loop edges and marks snap to a beat close by:
    - a Shift+drag drawing the loop, dragging a loop edge, and dragging a mark (a point, a region's edge, or a whole mark by its start), within 8 px;
    - `[` `]` M and R, within a quarter of a beat.
    - Off-beat spots stay where you put them. Hold Alt while dragging to place freely, and hide the lines (B) to stop snapping altogether.
  - **Loop drags take effect live:** while you drag a loop edge or draw a loop, playback already uses the loop where the pointer is. Pull the end in while it plays and it wraps there at once, not only once the mouse is released.
- **Why:** to make the section-by-section routine of transcribing quick: loop a bar, grow it to a phrase, then step phrase by phrase without placing loop edges by hand. The user chose the keys (next to `[` `]`), magnetic snapping, and snapping tied to the beat lines.
- **How:**
  - **On the grid:** a loop whose ends lie on bar lines (within 30 ms), or else on beats, is counted in bars or beats. Doubling, halving and moving use the music's real beat and bar times, so a drifting tempo is followed.
    - Halving a one-bar loop goes on to its beats.
    - A one-beat loop, and a loop off the grid, change by time.
    - Past the last beat, or before the first, the grid goes on by its average spacing.
    - The track's ends cut a loop.
  - **Drags:** `waveform.js` and `timeline.js` can't read the beats (layering), so they take a `snap(time, pxPerSecond)` option, wired in `app.js` to `features/beats.js`. Each tracks the pointer's `altKey`.
  - **Live loop drags:** `onLoopChange` fires from the per-frame pointer update whenever the drafted loop changes, not only at the drag's end. The transport sends a seamless segment and jumps into the loop if the playhead is now outside it, as dragging the speed slider already does on every input. A Shift+click that never made a loop still only seeks.
- **Where:**
  - `core/beats.js` (`snapTo`, `gridTime`, `spanAt`, `onGrid`, `resizeLoop`, `moveLoop`).
  - `features/beats.js` (`snapToBeat`, `snapForDrag`, `beatGrids`).
  - `features/playback.js` (`loopThisBar`, `resizeLoopBy`, `moveLoopBy`; `setLoopStart` / `setLoopEnd` snap), `features/marks.js` (`markPoint`, `markRegion`).
  - `waveform.js` (`bindPointerSeek`), `timeline.js` (`bindDrags`, the marks lane's `draftAt`).
  - `app.js` (the shortcuts, the `snap` options), `config.js` (`beats.snapPx`, `beats.snapKeyFraction`), `README.md`.
- **Verified by:**
  - Unit tests in `tests/unit/beats.test.mjs`: snapping; the grid past its ends; the bar a time is in (including the pickup and past the last); whether a loop lies on the grid; doubling and halving by bars, beats and time, with a drifting grid and the track's end; moving, including past the last bar and at both ends.
  - `tests/e2e/20-beats.cjs`:
    - `\` → 4.26–6.26; `=` → 4.26–8.26; `-` → 4.26–6.26; `-` → 4.26–5.26.
    - Shift+`]` → 5.26–6.26 with the cursor there; Shift+`[` back.
    - A Shift+drag snaps, but not with Alt.
    - `[` near a beat snaps, `[` off the beat doesn't; M snaps.
    - Nothing snaps with the lines hidden; `\` without beats asks for them.
  - `tests/e2e/03-audio-and-loop.cjs`: while playing, the loop end is pulled from 4 s to 2 s with the mouse still held. The loop is already 0.49–2.00 and playback wraps at 2 s before the release, which keeps it.
  - `npm run check` and `npm test`.

## 2026-10-17: Beats by a beat-tracking model, with bars

- **What:**
  - **B** now finds the beats with **Beat This!**, a beat-tracking model trained on many kinds of music. It's much more reliable than the simple finder on soft attacks, swing, rubato, classical and sparse arrangements.
  - It also finds the **first beat of each bar**, drawn as a stronger line.
  - A new step size, **"1 bar"**, sits among the others by its length (↑ / ↓), so ← / → can jump bar to bar. The beat click is **higher on the 1**.
  - **Progressive results:** the model works through the track 30 s at a time, starting around the cursor, so the part you're on has its beats within a few seconds. The chip shows the tempo with the progress ("♩ 120 BPM · 43 %") until the whole track is done.
  - When the model can't run (an Intel Mac, which ONNX Runtime has no build for, or outside Electron), the **simple beat finder** is used as before, without bars. The chip's tooltip says which one found the beats.
- **Why:** the user wanted beat detection that holds up across many kinds of music, with downbeats ("where is the 1").
- **How:**
  - **The model:** Beat This! (CPJKU, ISMIR 2024); its code and weights are MIT, unlike madmom's (non-commercial) or Essentia (AGPL). Its small checkpoint is exported to ONNX once by `scripts/export-beat-model.py`, which also writes reference values from the Python original for the tests.
  - **Its input must match the original's exactly:** mono at 22,050 Hz (our own polyphase resampler, its cut-off tuned to match soxr's top bands), a 1024-point STFT every 441 samples with reflect padding, a slaney mel filterbank (128 bands, 30 Hz to 11 kHz), and log(1 + 1000·x).
  - **Its windows and post-processing** are ported line for line: 1500-frame windows overlapping by 6 frames, joined keeping the earlier one; peaks are maxima within ±3 frames above 0, neighbours merged, and downbeats snapped to beats.
  - **Where it runs:** WebAssembly in the page took about 4 s per window, and WebGPU (about 0.15 s) works on Linux only with Chromium's Vulkan switched on, which is risky for the whole app. So the model runs on the **native ONNX Runtime in an Electron utility process**, on 4 threads: about 1 s per 30 s of sound. The process starts on the first window and stops after a minute idle.
  - **A crash to know about:** ONNX Runtime's memory-pattern planning crashed the utility process (SIGTRAP) on its second run, though not in plain Node. It's turned off, at the same speed.
  - **Speed:** the model's time is in attention over 1500 frames (profiled), so quantizing the weights wouldn't help.
  - **Data flow:** the worker decodes the file once and makes both the spectrogram and the simple finder's answer. The page sends the windows nearest the cursor first through the preload's `beatWindow` and re-picks the beats after each one.
  - **Packaging:** the model and ONNX Runtime's native files are unpacked from the asar. Only the target platform and architecture's binary ships, and no CUDA (about 46 MB on Linux). A project `.npmrc` stops ONNX Runtime's install from downloading its CUDA libraries (about 270 MB).
- **Where:**
  - New `src/core/beat-this.js` (`windowStarts`, `windowInput`, `joinWindows`, `pickPeaks`, `beatsFromLogits`), `src/core/melspec.js`, `src/core/resample.js`, and `src/core/fft.js` (moved out of `core/beats.js`).
  - New `electron/beat-model.js` and `beat-model-process.js`; `electron/preload.js` (`beatWindow`), `electron/main.js`.
  - `src/audio/beat-worker.js` (prepares the spectrogram and the fallback), `src/features/beats.js` (`runModel`, `take`).
  - `context.js` (`downbeat`, `bars`, `barLength`, `method`, `complete`), `core/beats.js` (`stepSizes` with "bar", `beatClockTimes` with indices, `medianGap`).
  - `ui/controls.js`, `ui/dom.js`, `features/playback.js` (the "bar" step), `timeline.js` (`.guide-beat.downbeat`), `audio/engine.js` (the accented click).
  - New `models/beat-this-small.onnx` and `scripts/export-beat-model.py`; `package.json` (`onnxruntime-node` 1.30.0, `asarUnpack`, file patterns), `.npmrc`, `THIRD_PARTY_NOTICES.md`, `README.md`.
- **Verified by:**
  - New `tests/unit/beat-this.test.mjs`, against the Python original's output for the same test clip:
    - the mel filterbank and the spectrogram (within 0.001);
    - **the model's logits, beats and downbeats on our spectrogram, exactly the original's**;
    - at 44.1 kHz through our resampler, the beats within one frame of the original's (with soxr);
    - windows run in any order give the same result;
    - window cutting and joining, peak picking and downbeat snapping, and the resampler (five rates, the length, the low-pass, chunking).
  - `tests/e2e/20-beats.cjs` with a new music-like `bars.wav`: 120 BPM by the model, a line per beat, bars every 2 s, ← / → by beat and by bar, and the simple finder when the model is unavailable (no bars). The same topic passes against a packaged Linux build (`TB_APP_PATH`).
  - A 90 s file fills in progressively: the tempo after about 5 s, and all of it after about 8 s.
  - `npm run check` and `npm test`.

## 2026-10-17: A click on each beat

- **What:** a new switch, Settings › General › **Click on each beat** (off by default), or **Shift+B** while listening. Once the beats are found, a short click plays on each one during playback, so you can hear whether the beat lines sit on the beat. It follows the speed, loops and seeks. A notification confirms Shift+B, and says to find the beats first if they aren't found yet.
- **Why:** the user asked for a way to check the beat detection by ear.
- **How:**
  - Every 25 ms while playing, the clicks for the next 0.12 s are put on the AudioContext clock. The transport's timeline gives the track position at both ends of that span (`positionAtOutput`, the graph's time, before the output delay), and `beatClockTimes` turns the beats between them into clock times, including a span where the A–B loop wraps.
  - The clicks go into the master volume, so they reach the speakers with the same delay as the track. What you hear is the detection's own accuracy, not a scheduling offset.
  - A seek, a loop change (the transport's "jump" and "loop" events) or a new speed cancels the clicks not yet played and works them out again. Pausing, a new file or turning the switch off stops them.
- **Where:**
  - `features/beats.js` ("The beat click": `scheduleClicks`, `cancelClicks`, `updateClicks`, `toggleBeatClick`).
  - `core/beats.js` (`beatClockTimes`), `audio/engine.js` (`click`), `audio/transport.js` (`positionAtOutput`, `loop`).
  - `prefs/index.js` (`general.beatClick`), `config.js` (`beats.click`, `clickLookaheadSeconds`, `clickTickMs`), `app.js` (Shift+B).
- **Verified by:**
  - Unit tests for `beatClockTimes` (any speed, back-to-back spans giving each beat once, a loop wrap), and the General section's new default.
  - `tests/e2e/20-beats.cjs`: Shift+B turns the pref on and off, and playing with it on raises no errors.
  - `npm run check` and `npm test`. The sound itself is checked by ear.

## 2026-10-17: Finding the beats

- **What:**
  - A new **♩ Find the beats** chip in the transport bar, or **B**, finds the open track's beats. While it works the chip shows the progress; a click or B stops it.
  - Once found, faint lines mark each beat over the waveform, and the chip shows the tempo: "♩ 120 BPM", plus the tempo heard at another speed ("· 60 at 0.50×").
  - The step size becomes **"1 beat"**, so ← / → jump to the next or previous beat. ↑ / ↓ still pick seconds sizes; "beat" sits among them by its length.
  - The chip or B then hides or shows the lines (the chip dims while they're hidden). A track with no steady beat says "♩ No steady beat".
  - A new file forgets the beats, and a "1 beat" step goes back to 1 s. Beats aren't saved in projects yet.
- **Why:** knowing where the beats fall makes it easier to find your place while transcribing, and to step through a passage beat by beat.
- **How:**
  - Our own algorithm, with no library: essentia.js and aubio are AGPL/GPL, and `web-audio-beat-detector` only gives one constant tempo.
  - **Onset envelope:** spectral flux of the log magnitude up to 8 kHz, every ~11.6 ms with a 23 ms Hann window, minus its 0.5 s moving mean. The spectrum of the real samples comes from a half-length complex FFT with precomputed tables, which takes about 0.4 s per 4 minutes of audio.
  - **Tempo:** autocorrelation over 40–240 BPM, weighted by a log-Gaussian around 120 BPM (σ = 1 octave) to avoid double or half tempo. A pulse below 0.1 "clarity" (the weighted peak as a share of the envelope's energy) counts as no steady beat: click tracks score ~0.9, white noise ~0.05, a steady tone ~0.
  - **Beats:** Ellis 2007's dynamic programming (as in librosa's `beat_track`, tightness 100), which follows tempo drift. Weak beats at either end are trimmed.
  - The player's samples are handed to the audio thread when a file opens, so the page can't read them anymore. The beat worker decodes the file again and streams it in mono through the detector, so only the small envelope is kept.
  - The beat lines are drawn only for the visible range plus a screen either side, like the ruler's ticks, and are hidden when beats would be under 5 px apart.
  - Stepping by beats lands on the next beat beyond 30 ms, so a step taken just after a beat doesn't land on it again. Before the first beat or after the last, a step is one average beat.
- **Where:**
  - New `src/core/beats.js` (`createOnsetDetector`, `createSpectrum`, `createFft`, `estimateTempo`, `trackBeats`, `detectBeats`, `visibleBeats`, `beatStep`, `stepSizes`).
  - New `src/audio/beat-worker.js`, and `src/audio/open-track.js` (`openTrack`, `DecodeError`), which was moved out of `decode-worker.js` so both workers share it.
  - New `src/features/beats.js` (`beatsAction`, `resetBeats`, `bindBeats`).
  - `context.js` (`beats`, `beatLength`; `settings.stepSize` can be "beat").
  - `ui/controls.js` (step sizes through `stepSizes`, the tempo redrawn when the speed changes), `ui/dom.js` (`renderBeatInfo`, `renderStepSize`).
  - `features/playback.js` (`step`), `features/open-file.js` (`resetBeats` on load), `timeline.js` (`setBeats`, `renderBeats`).
  - `app.js` (the B shortcut, the file map), `config.js` (`beats.minSpacingPx`), `index.html` (`#beatInfo`), `style.css` (`.guide-beat`), `eslint.config.js` (worker globals for the new files).
- **Verified by:**
  - New `tests/unit/beats.test.mjs`: synthetic click tracks at a steady 120 BPM, at 90 BPM (not read as double or half), and speeding up from 100 to 110 BPM; noise, a steady tone and silence (no beats); chunking; the real spectrum against the full FFT; stepping and step sizes.
  - New `tests/e2e/20-beats.cjs` with a `clicks.wav` fixture: B finds 120 BPM, about 40 lines are drawn, → / ← land within 3 ms of the clicks, the tempo heard at 0.5× is shown, the lines hide and show, and a new file resets everything; a steady tone has no steady beat.
  - `tests/e2e/06-zoom.cjs` now skips the beats' layer in its lanes-in-sync check.
  - `npm run check` and `npm test`.

## 2026-10-17: A splash window while the app starts

- **What:** starting ScriBee first shows a small frameless window with the bee and its pulsing aura, "ScriBee" and the 4-bar loader, in the current theme's colours. The main window appears, already built, once the page is ready, and the splash closes. On a fast start the splash stays up for at least 600 ms, so it doesn't blink.
- **Why:** the main window used to open straight away as an empty, theme-coloured rectangle and stay that way until the page had loaded. On a slow start that looked broken.
- **How:**
  - The main window is made with `show: false`. `showAfterSplash` opens the splash, centred on where the main window will be. When the page calls `scribee.ready()` at the end of `start()` (IPC `app:ready`), the main window is shown and the splash is destroyed.
  - Fallbacks: the main window shows at once if its page fails to load or its process dies (registered before `handleRendererCrash`, whose dialog needs a visible parent). It also shows after 15 s if the page never says it is ready.
  - Closing the splash (Alt+F4) before the hand-over closes the main window too.
  - `maximize()` moved into the hand-over, because it shows a hidden window.
  - The splash gets its colours as URL query parameters, which `splash.js` sets as CSS variables. It has no preload, its own strict CSP, and its own copy of the few rules it needs from `style.css`.
  - A hidden window's page still reports `document.visibilityState` as "visible", so the smoke test watches for the splash's DevTools target to disappear instead.
- **Where:**
  - `electron/windows.js`: "The splash" (`showAfterSplash`, `handleSplash`).
  - New files `electron/splash.html`, `splash.css` and `splash.js`.
  - `electron/main.js` (`createWindow`, `whenReady`).
  - `electron/preload.js` (`ready`).
  - `src/app.js` (`start`).
  - `eslint.config.js` (`splash.js` is a browser script).
  - `tests/smoke.cjs` (every session checks that the splash closes within 10 s, under the fallback).
- **Verified by:**
  - `npm run check` and the full `npm test` (211 unit, 411 e2e, 28 smoke).
  - The smoke test run against a `build:dir` build, whose asar contains the splash files and the Righteous font.
  - The splash rendered offscreen in a dark and a light theme.

## 2026-10-17: Version 0.1.1

- **What:** ScriBee 0.1.1, a small release on top of 0.1.0. Details are in the three entries below.
  - **New:** Enter plays from where playback last stopped (Space plays from where it last started). The windows no longer have a menu bar.
  - **Better:** the continuous waveforms (Continuous, Peak + loudness, the minimap) have a smooth outline instead of a blocky one.
  - **Fixed:** a newly opened file starts at 0, not where the previous one was left. After saving a project with the media inside, Save As no longer offers to link the media, which failed. Ctrl+S while renaming a mark saves the new name. A download's time left never reads "0:60".
- **Why:** the user asked for a very minor release of what was on `testing`. It is 0.1.1 rather than 0.2.0 because the new keys and the missing menu bar are small.
- **How:** `npm version 0.1.1 --no-git-tag-version`, then `main` moved up to `testing` and tagged `v0.1.1`, which builds the release (docs/maintaining.md, "Putting out a new version").
- **Where:** `package.json`, `package-lock.json`.
- **Verified by:** the full `npm test` before `main` moved; the release builds; the smoke test run against the built Linux AppImage.

## 2026-10-17: Enter plays from the stop point; no menu bar

- **Enter plays from where playback last stopped.**
  - **What:** Enter (or the keypad's Enter) pauses while playing, as Space does. Otherwise it plays from the red stop point, wherever the cursor is. Space plays from where you last started. Before the first stop, Enter plays from the cursor. It is listed in the shortcuts dialog, and the ■ readout's tooltip mentions it. In text fields Enter stays Enter. On a button, link or menu item reached with Tab, Enter still activates it; a clicked one gives its focus back, so after a click Enter is the shortcut.
  - **Why:** the user asked for a key to replay from the end point, as Space does from the start point.
  - **How:** `replayFromStopOrPause` seeks to `stopPoint` (already kept for the ■ marker and readout), then plays. The transport still has the last word, so with a loop on, playback starts inside it. Shortcuts skip Enter on a control (`isEnterForControl`): the full test run caught Enter no longer opening the theme menu from the keyboard.
  - **Where:** `src/features/playback.js` (`replayFromStopOrPause`); the `SHORTCUTS` table in `src/app.js`; `src/ui/shortcuts.js` (`isEnterForControl`); `#stopPoint`'s title in `index.html`; README.
- **No menu bar.**
  - **What:** the main window and the video window no longer show Electron's File/Edit/View/Window/Help bar, which the app never used. (The video window used to show it on Alt.) A Mac's menu, at the top of the screen, is unchanged.
  - **Why:** the user asked; everything is in the page.
  - **How:** `win.removeMenu()` (Linux and Windows). This also drops that menu's keys: Ctrl+Shift+I (DevTools), Ctrl+R (reload), Ctrl+W, and Ctrl +/−/0 (zoom). Copy and paste in text fields still work, since Chromium handles them itself.
  - **Where:** `electron/main.js` (`createWindow`); `electron/windows.js` (`allowVideoWindow`, `did-create-window`).
- **Verified by:** e2e `04-space-replay`: Enter plays from the stop point with the cursor elsewhere, and Enter again pauses. Topics 01–04 and 18 (120 pass) and the smoke test (21 pass, the real `main.js`) pass, as do `npm run check` and `npm run test:unit` (211 pass). The missing menu bar was not checked by a test; the smoke test only drives the page.

## 2026-10-17: A smoother continuous waveform

- **What:** the Continuous and Peak + loudness shapes, and the minimap, have smooth sloping outlines instead of a blocky, pixelated edge. Zoomed in past the drawn detail, they slope between levels instead of stepping. Bars are unchanged.
- **Why:** the user found the continuous waveform blocky and low-resolution.
- **How:** the canvases were already at the screen's full resolution. The edge itself was the problem: every pixel column was drawn as a flat step, with a sharp vertical jump to the next column on a pixel boundary. Nothing was anti-aliased, so the edge looked like a staircase. Zoomed in, a level was repeated across several columns, making wider steps. Now:
  - the outline is a line through the middle of each column, which the canvas smooths;
  - when a column holds less than one level, `columnLevels` interpolates between the two nearest levels instead of repeating one;
  - each canvas also draws one column past either edge, read from the whole track, so the line runs on into the next canvas without a jump. `columnLevels` therefore takes fractional `start`/`count` and reads past the slice, repeating the first or last value beyond the track's ends.
- **Where:** `src/waveform-draw.js` (`drawWaveform`, `fillShape`); `src/core/waveshape.js` (`columnLevels`, `levelAt`).
- **Verified by:** `waveshape.test.mjs`: interpolated columns with no flat runs, and a fractional start with columns past the ends. `waveform-draw.test.mjs`: the shape's edge meets within 1 px at every seam, at 100, 125 and 200 %, with several levels per pixel and with fewer than one, and slopes from column to column. All of these fail on the old code. `npm run test:unit` (211 pass) and `npm run check` pass, as do the waveform e2e tests (topic 17).

## 2026-10-17: Bug hunt: four fixes

A read-through of the risky code (transport, marks, timeline, projects, opening files, decoder, main process, downloader) for real bugs.

- **The start point no longer carries over to the next file.**
  - **What:** if you clicked or stepped somewhere in a song without playing it and then opened another, Space played the new one from the old spot, and the ▶ readout showed it. Now a new file always starts at 0.
  - **How:** `returnPoint` (and the stop point) is reset by the transport's `"state"` event, but `setState` stays quiet when the state doesn't change. A song that was never played stays `"ready"` (a seek doesn't change that), so loading the next one sent no event. `transport.load()` now always sends `"state"`. Every listener is safe to run twice.
  - **Where:** `src/audio/transport.js` (`load`); the listener in `features/playback.js` (`bindPlayback`).
- **After Save As with the media inside, linking is no longer offered when it can't work.**
  - **What:** after Save As → "put it inside", the next Save As still offered "link to the media", and choosing it failed with "This song or video is inside its project…". Now that choice is disabled, with its usual note, as it is when you reopen that project.
  - **How:** `save()` worked out `linkable` before pointing the page's media URL at the copy inside the new project, so it answered `true` for a URL that now names an embedded slice. It now answers `linkable && !embed`.
  - **Where:** `electron/project-files.js` (`save`).
- **Ctrl+S while renaming a mark saves the new name.**
  - **What:** typing a mark's name and pressing Ctrl+S without leaving the field saved the old name, and the • came back once you clicked away.
  - **How:** the name field commits on `"change"`, which only fires on blur or Enter, while Ctrl shortcuts work inside text fields. `writeProject` now dispatches `"change"` on a focused text field before it captures, so the field keeps its focus.
  - **Where:** `src/features/project/index.js` (`writeProject`).
- **A download's time left never reads "0:60".**
  - **What / How:** `formatEta` rounded the seconds after splitting off the minutes, so 59.6 s showed as "0:60". It now rounds first.
  - **Where:** `src/core/format.js` (`formatEta`).
- **Why:** the user asked for a bug hunt.
- **Verified by:** new unit tests: a reload while `"ready"` still announces the state (`transport.test.mjs`); the embedded save answers `linkable: false`, and a link save from that URL is refused (`project.test.mjs`); `formatEta(59.6)` (`core.test.mjs`). `npm run test:unit` (203 pass) and `npm run check` pass. The e2e topics 02, 03, 04, 14 and 16 (156 pass) and the smoke test (21 pass) also pass.

## 2026-10-13: Issue forms: feature request and bug report

- **What:** **New issue** on GitHub now offers two forms. The website is offered as a link next to them, and blank issues are still allowed.
  - **Feature request:** what ScriBee should do, when you'd use it, how it might work, and your system. It gets the `enhancement` label.
  - **Bug report:** what happened, how to make it happen, the ScriBee version, and your system. It gets the `bug` label.
- **Why:** the user asked for a feature-request form; a bug report form goes with it.
- **How:** GitHub issue forms (`.github/ISSUE_TEMPLATE/*.yml`). They take effect from `main`.
- **Where:** `.github/ISSUE_TEMPLATE/feature_request.yml`, `bug_report.yml`, `config.yml`.
- **Verified by:** the YAML parses, and `npm run check` (Prettier).

## 2026-10-13: A maintainer's guide

- **What:** `docs/maintaining.md` explains how to keep working on ScriBee now that it's on GitHub:
  - the two branches (`testing` to work on, `main` stable and public) and what runs on GitHub when;
  - the everyday loop: pull, change and try, commit and push, then move `main` up to `testing`;
  - putting out a version: `npm version`, the tag, the draft release, checking and publishing it;
  - the website, what to do when CI fails, undoing things, working from another computer, other people's issues and pull requests, and updating libraries.
- **Why:** the user asked for a guide to updating the code base, pulling and pushing, so they can keep maintaining it.
- **Where:** `docs/maintaining.md`, linked from README.md's Development section and its file list.
- **Verified by:** the commands are the ones used to publish 0.1.0. `npm run check`.

## 2026-10-13: A shorter README

- **What:** README.md's "What it does" is now nine one-line points instead of a detailed manual of every feature, its keys and the layout.
- **Why:** the user found it too extensive for a README.
- **How:** the details were dropped, not moved. The app's **?** dialog lists every key, and this CHANGELOG has the full behaviour. Download, Build from source, Licence and the Development docs are unchanged.
- **Where:** `README.md`.
- **Verified by:** `npm run check`.

## 2026-10-13: The landing page says plainly that ScriBee is free and open source

- **What:** the landing page makes clear that ScriBee is fully free and open source:
  - **Under the download button:** "Free, for good, and open source. No trial, no subscription, no account, no ads."
  - **A new section, "Free. The whole thing.", before Download:**
    - every feature is in the download;
    - no trial, nothing expires;
    - no subscription and no paid "Pro" version;
    - no account, no ads, no tracking;
    - open source under the MIT licence, with links to the code and the licence.
  - **The download section and the footer** say "free and open source" too.
- **Why:** the user asked for the page to stress that the program is fully free to use, with no trials or subscriptions, and open source.
- **How:**
  - `site/index.html`: the `.free-line` in the hero, and `section#free` with a `.free-list` of four items in two columns (one on phones), each marked by a short amber bar like the waveform's.
  - `site/download.js` links `data-link="licence"` to the repository's `LICENSE`, and its release text says "Free and open source, for good."
- **Where:** `site/index.html`, `site/style.css`, `site/download.js`.
- **Later the same day:** the user asked for the "Free. The whole thing." section near the top. It now comes right after the hero, before the screenshot (`main > section.free` sits 32 px under the hero; `.shot` gets 72 px above it).
- **Verified by:** renders at 1280 px (dark) and 390 px (light); `npm run check`.

## 2026-10-13: Release builds for Windows, macOS and Linux, and CI

- **What:**
  - **Release builds:** pushing a version tag (`v0.1.0`) builds ScriBee on GitHub for Windows (portable `.exe`), macOS (`.dmg` for Apple Silicon and for Intel) and Linux (`.AppImage`), and puts them in a draft GitHub Release to check and publish.
  - **CI:** every push and pull request runs `npm run check` and the unit tests. On `main` (and on demand) the e2e and smoke tests run too, in a virtual display.
  - **The landing page:** it offers the new file names, and on the macOS card an Apple Silicon button and an Intel link, with how to open an app Apple hasn't signed. The Mac builds say they haven't been tried on a Mac yet.
- **Why:** to publish the project. The user chose all three systems and has no Mac to test on.
- **How:**
  - **`package.json`:**
    - `build.artifactName` is `${productName}-${version}-${os}-${arch}.${ext}`, which gives `ScriBee-0.1.0-linux-x86_64.AppImage`, `…-win-x64.exe`, `…-mac-arm64.dmg` and `…-mac-x64.dmg`. The landing page's `FILES` match these.
    - A `mac` target: dmg for arm64 and x64, `identity: "-"` (ad-hoc signing, which Apple Silicon needs to run it at all) and `hardenedRuntime: false` (which ad-hoc signing needs, per electron-builder).
    - `publish: null`, since the workflow uploads the files.
    - `desktopName` with `linux.syncDesktopName`, so Linux desktops tie the window to its icon.
    - A `build:mac` script.
  - **`release.yml`:**
    - a matrix over ubuntu, windows and macos;
    - the checks and unit tests run on Linux only (some tests assume POSIX);
    - `codesign --verify` checks the Mac apps;
    - a final job writes the notes and makes the draft release (`softprops/action-gh-release`).
  - **`ci.yml`:**
    - the e2e job installs ffmpeg and xvfb, and caches `tests/fixtures` by the hash of `make-fixtures.sh`;
    - it lifts Ubuntu's block on the user namespaces Chromium's sandbox needs;
    - it keeps the screenshots of a failed run.
- **Pushes didn't start workflows at first:** only manual runs worked, from the Actions tab or `gh workflow run`, until the user turned on an Actions setting in the repository on GitHub. Until then, `release.yml` was given `workflow_dispatch`, so a release can also be built by hand on its tag (`gh workflow run release.yml --ref v0.1.0`); v0.1.0 was built that way.
- **The first CI run on GitHub:** the quick checks passed. In the e2e job, 408 of 409 e2e checks passed. The one failure was `02-welcome`'s "…and they move", which compared the bee's and aura's computed `transform` 700 ms apart. On the runner's virtual display (no compositor) that stays at the first keyframe while the animations run. It now compares the animations' own clocks (`currentTime`), which is what "they move" means. A second run showed those clocks at 0 too: on the runner, the page draws its first frames late, and the clocks wait for them. So the check waits up to 5 s for them to advance, and "the entrance played once, and is done" waits up to 5 s for the entrance to end, instead of fixed delays. Both pass twice in a row locally. The third run passed those, but "moving the pointer shows the video window's controls" (`18-video-window`), which had passed twice before, failed once. Its fixed 0.3 s wait after the mouse moves now polls up to 3 s, since input reaches an offscreen window late on the runner.
- **Where:** `package.json`, `.github/workflows/release.yml`, `.github/workflows/ci.yml`, `site/download.js` (`FILES`, `issues`), `site/index.html` (the macOS card), `site/style.css` (`.alt`), `README.md`.
- **Verified by:**
  - `npm run build:linux` made `ScriBee-0.1.0-linux-x86_64.AppImage`.
  - `tests/smoke.cjs` passed against the packaged app (`TB_APP_BINARY=dist/linux-unpacked/scribee`, 21 checks).
  - The landing page was tried against a fake release with the four file names: each button got its file and size, and the Linux visitor got the AppImage.
  - `npm run check` and `npm run test:unit`.
  - The workflows themselves run once the repository is on GitHub.

## 2026-10-13: A licence, third-party notices and a README for the public

- **What:** ScriBee is MIT-licensed (`LICENSE`). `THIRD_PARTY_NOTICES.md` lists what it's built on, with each licence. README.md now starts with what a visitor needs: the logo, what the app is, a screenshot, Download (with the first-run steps for the unsigned Windows and macOS builds), the feature list, Build from source and Licence. The developer docs follow under "Development".
- **Why:** to publish the project on GitHub. The user chose MIT.
- **How:**
  - **Licences:** all are compatible with MIT. Signalsmith Stretch (MIT) is vendored with one fix. Mediabunny (MPL-2.0) is used unmodified from npm, so its file-level copyleft asks nothing more. wavesurfer.js is BSD-3-Clause, and Righteous and Nunito are OFL-1.1. yt-dlp (the Unlicense) isn't shipped: it's downloaded on first use.
  - **README links:** they point at `github.com/wiktor-rocks/scribee` and `wiktor-rocks.github.io/scribee`, as do the landing page's `REPO` and `package.json`'s `homepage`, `repository` and `bugs`.
- **Where:** `LICENSE`, `THIRD_PARTY_NOTICES.md`, `README.md`.
- **Verified by:** `npm run check`; the README read through as it renders.

## 2026-10-13: TranscriBee is now ScriBee (0.1.0)

- **What:** the app is called **ScriBee** everywhere: window titles, the wordmark (Scri**Bee**, with "Bee" in the accent colour), the theme names (ScriBee, ScriBee Light), messages, the landing page and the docs. Project files are now `.sbee`; existing `.tbee` files don't open any more (rename them: the content is the same). The version is 0.1.0, the first one meant for publishing, under the MIT licence. On its first start under the new name, the app copies its old settings folder (prefs.json, window positions, the page's storage). So the window opens where it was and the settings stay, except the colour theme and the sidebar and video-window choices, whose ids changed.
- **Why:** before publishing on GitHub. "TranscriBee" sat close to bugbakery's transcribee (a speech-to-text editor) and Seventh String's Transcribe!. The user chose ScriBee: scribe + bee, the bee logo unchanged. A search found no app, music software or GitHub project with that name. The user chose `.sbee` only, without keeping `.tbee`.
- **How:**
  - Every name was changed by rule (the history entries below keep the old ones): `TranscriBee` → `ScriBee`, `transcribee` → `scribee`, `.tbee` → `.sbee`.
  - So also:
    - the bridge (`window.scribee`) and the media URL scheme (`scribee-media://`);
    - the video window's frame name;
    - the localStorage keys and the temp-folder prefixes;
    - the theme ids (`scribee`, `scribee-light`) and the project format id (`scribee-project`);
    - the package (`name`, `appId: com.scribee.app`, `executableName`);
    - the default download folder (`~/Downloads/ScriBee`);
    - `assets/scribee-source.png`.
  - `electron/main.js` `adoptOldSettings()` copies `…/TranscriBee` over the new settings folder once, before the app is ready (nothing has opened those files yet), and leaves a marker file, `adopted-transcribee-settings`. It does this even when a first start already made the new folder: on this machine, `npm start`'s auto-reload restarted the app under the new name during the rename. It's skipped for a folder given with `--user-data-dir`, so the smoke test's throwaway profile never gets the real settings. A copy, so an older version still finds its own.
- **Where:** 51 files, the main ones being `package.json`, `src/project/format.js` (`PROJECT_EXTENSION`), `src/themes/palettes.js`, `electron/preload.js`, `electron/media-files.js`, `index.html`, `site/`, `README.md` and the tests.
- **Verified by:** the full `npm test` (202 unit, 409 e2e, 21 smoke) and `npm run check`. `adoptOldSettings` was run on its own against temporary folders: it does nothing with `--user-data-dir`, copies once over a fresh folder, and leaves later changes alone. `git grep -i -e transcribee -e tbee` finds the old names only in this CHANGELOG's history and in the vendored Signalsmith code (where "tbee" is part of minified code).

## 2026-10-13: Clean-up before main: small bugs, dead code, docs

- **What:** a general clean-up of the whole codebase before `testing` went to `main`. Small bugs fixed, unused code removed, a few duplicated helpers merged, and out-of-date docs and comments brought up to date. Visible changes:
  - toasts and search pictures fade again;
  - the × on a mark row has its intended size;
  - the welcome screen's corner buttons react to hover;
  - long theme names and the start and stop chips end in "…" when cut off;
  - in the shortcuts dialog only the list scrolls;
  - a short window's minimap is smaller for videos too.
- **Why:** the user asked for a general clean-up and check before committing to `main`. It came from a read-only audit in three parts: `src/`; `electron/`, tests and tooling; and the markup and CSS. The user chose to fix the bugs, remove the dead code, fix the docs, and merge only the mechanical duplicates.
- **How (bugs):**
  - **The test launcher** (`tests/launch.cjs`) didn't list `long-counter.webm`, so a checkout with the older fixtures never made it and topic 08 failed. It also ran the smoke test after a failed e2e run, and took a crashed run (`null` status) for a pass.
  - **The yt-dlp setup** (`electron/downloader.js` `prepare`) ran as the job of whoever started it. So a new search, which cancels the old one, also canceled the setup the new search was waiting for. It now runs as a job of its own: canceling only stops waiting, and its progress reaches everyone waiting. The update stamp is still written after a failed update, so that offline every search doesn't retry it, with a 60 s timeout.
  - **Main process** (`electron/main.js`):
    - a failed `shell.openExternal` is caught;
    - theme changes no longer repaint the video window's black background (only `mainWindows`);
    - the video window's `alwaysOnTop` no longer leaks into the main window's options;
    - `electron-reload` ignores `dist/`, `site/`, `tests/output/` and `tests/fixtures/`.
  - **Opening files** (`features/open-file.js`): a file chosen or dropped while another loads is ignored before it asks about unsaved changes or opens a project. The memory message says "its sound and picture need" for videos, whose figure includes the proxy.
  - **The page:**
    - a search whose bridge call itself fails shows an error instead of staying on "Searching…" (`features/download.js`);
    - a failed settings save puts the old values back, and one failing settings listener no longer stops the rest (`ui/prefs.js`, now on `createEmitter`);
    - the shortcut and focus state (`clickedElement`, `tabbing`) is kept per window, not shared between the main window and the video window (`ui/shortcuts.js`);
    - a parallel decode whose parts don't join ends its workers before decoding again in one part (`audio/decoder.js`).
  - **CSS** (`style.css`):
    - The toast and thumbnail transitions now get past the base rule that cancels all animations (`!important`, as the other exceptions have).
    - `button.mark-remove` now beats `button.small`.
    - `.welcome-corner .theme-button:hover`.
    - `.welcome-message.notice` keeps 14 px.
    - A short-window rule for `.stage.has-video`, placed so big video and the popped-out layout still win.
    - The shortcuts dialog is a flex column.
    - `.chip-button` is a block, and `.theme-name > span` has its own ellipsis.
  - **Diagnostics:** `profile-load.cjs` registers `handleSystem`, so measurements include the memory check.
- **How (dead code and duplicates):**
  - **The project "Open" dialog** was unused end to end. Removed: the preload's `openDialog`, the `project:open-dialog` handler, `openDialog`, `dialogs.open` and the harness stub.
  - **Unused exports:** `export` was dropped from 26 functions only used in their own file. `ui/theme.js` `currentTheme`, `engine.sampleRate()` and `waveform.view` were removed.
  - **Shared helpers:**
    - `src/ui/storage.js` (`readStored`, `store`) replaces three localStorage try/catch copies.
    - `core/format.js` `clamp` replaces three hand-written clamps.
    - `createEmitter` replaces the listener lists in `ui/prefs.js`, `ui/theme.js` and `waveform.js`.
    - `hasAudio` and `eqGains` from `context.js` are used where they were copied.
    - One `describeDownload` gives the downloader status for searches too.
    - The proxy's `EPSILON` and `covers` come from `proxy-plan.js`.
  - **Test helpers:** `setFiles`, `slide` and `near` live in the harness.
  - **`features/download.js`:** one bridge constant and typedef, no unreachable `!bridge` checks.
  - **Small items:** a few shadowed names were renamed.
- **How (docs):**
  - README.md: the file list, the layers, the unit tests and the e2e topics.
  - The CHANGELOG header's file list.
  - The `src/app.js` file map and notes (settings saved in projects; `SOUND_SLIDERS` for a new slider).
  - The `style.css` section index and comments.
  - Stale comments in `marks/index.js`, `context.js`, `features/marks.js` (`drawWaveform` is now `drawMarks`), `transport.js`, `shortcuts.js`, `palettes.js`, `windows.js`, `proxy.js` and `open-file.js`.
  - `tests/run.cjs`, the fixture sizes, and `docs/diagnostics/long-file-loading.md`.
- **Left as is, on purpose:**
  - the four time formatters and the icon builders;
  - merging CSS rules and renaming the Save dialog's `download-*` classes;
  - the `$()` lookups outside `dom.js`;
  - a shared decode error class (errors cross the worker boundary as plain data);
  - the two `require("./windows")` lines in `main.js`: the second carries the "Video window (" removal marker.
- **Where:** see the lists above. The new files are `src/ui/storage.js` and the setup test in `tests/unit/search.test.mjs`.
- **Verified by:**
  - **The new unit test** "a new search doesn't cancel the setup the one it replaces started": it fails with the old `downloader.js` and passes now.
  - **The full `npm test`:** 202 unit and 409 e2e checks passed. The smoke test's known-flaky theme check failed once and passed twice on its own.
  - **`npm run check`.**
  - **Screenshots:** the mark row's ×, a toast, the transport chips and the theme menu.

## 2026-10-13: A landing page for GitHub Pages

- **What:** a one-page site for TranscriBee in `site/`. It covers what the app does, its keys and its colour themes, and has download buttons for Windows, macOS and Linux. The visitor's own system comes first ("Download for Linux"), marked "your system" among the three.
- **Why:** the user wanted a landing page that can offer the built program from GitHub, in the app's look, that doesn't read as generated.
- **How:**
  - Plain HTML, CSS and one script, with no build step.
  - **Look:** the app's own colours (TranscriBee, or TranscriBee Light on a light system), its fonts (Righteous for the wordmark and headings, Nunito for text; self-hosted copies in `site/fonts/`), its bee logo (large next to the wordmark in the top bar, smaller in the hero, where it hovers: a 5 s drift up and down with a slight tilt, while its round glow breathes; both stop with `prefers-reduced-motion`), a screenshot, and keycaps and waveform bars in the app's style. The theme swatches use each theme's real `bg` and `accent` from `src/themes/palettes.js`.
  - **Dark or light:** the page follows the system (TranscriBee or TranscriBee Light). A sun/moon button in the top bar switches between the two and remembers the choice in `localStorage`; a small script in the head applies it before the page shows, so it doesn't flash. The light colours are in `style.css` twice, under the system's light mode and under `[data-theme="light"]`, so the page still follows the system without JavaScript.
  - **Downloads:** `download.js` asks the GitHub API for the latest release of `REPO` and points each button at the first asset matching that system's pattern in `FILES` (`.exe`, `.dmg`, `.AppImage`), with its size.
    - With no release (a 404), it says so and points to building from source.
    - When GitHub can't be reached, or a release lacks a system's file, the buttons open the releases page.
  - **Publishing:** `.github/workflows/pages.yml` publishes `site/` on GitHub Pages when it changes on `main`. This needs Settings › Pages › Source set to "GitHub Actions".
- **Where:** `site/index.html`, `site/style.css`, `site/download.js` (`REPO` and `FILES` at the top: the only things to edit), `site/README.md`, `site/fonts/`, `site/img/` (the logo, the favicon from `assets/icon-512.png`, and `screenshot.webp`: the user's screenshot of a live concert video at 0.6× with a looped region, 1017 × 912, never shown wider than that), `.github/workflows/pages.yml`, `eslint.config.js` (browser globals for `site/`).
- **Still to do:**
  - Set `REPO` to the real repository.
  - Add a macOS build target: `package.json` has none yet, so there is no `.dmg` to offer.
- **Verified by:**
  - Rendered in Electron at 1280 px (dark and light) and 390 px, with no sideways scrolling.
  - The theme switch, in Electron: a click switches dark to light (colours, icon, `theme-color`), the choice survives a reload, and with no choice a light system gets the light theme.
  - A copy pointed at a real Electron app's releases (`laurent22/joplin`): all three buttons got the right file and size, and Linux was detected.
  - `npm run check`.

## 2026-10-13: A picture anywhere right after loading (proxy overview, parallel builders)

- **What:** right after a video loads, dragging anywhere in it shows a blurry picture at once. That picture can be off by up to one keyframe gap (about 2 s in a typical YouTube H.264 download), until the full proxy reaches there. Loading takes a little longer for this: at most `overview.waitMs` (3 s) more. The full proxy now starts building while the file still loads, by up to three builders spread over the video.
- **Why:** after the fix below, the first jump to a new spot still waited for the sharp frame. The user was willing to trade a little loading time for a better experience, and chose this option: the overview plus parallel building.
- **How:**
  - **The overview:**
    - The proxy's first job is to encode one low-res frame per keyframe of the video, each as a keyframe of its own. That's at most one per `spacingSeconds` and `maxFrames` in all, about 10 KB each.
    - Keyframes decode without the frames before them, so this is cheap: the timestamps come from `EncodedPacketSink.getKeyPacket(…, { metadataOnly: true })` and the frames from `VideoSampleSink.samplesAtTimestamps`.
    - It's built coarse to fine (every 32nd spot first, then the ones halfway between, …), so whatever is done when loading stops waiting is spread over the whole video.
    - `frameAt` answers with the overview's frame at or before the time when no run covers it, and still sets the focus, so a builder moves there.
    - `serveProxy` only draws a proxy frame that is nearer to the wanted time than the frame on screen, so a coarse frame never replaces a closer sharp one.
  - **Starting during loading:** the proxy is created in `prepare`, not `show`, so it builds while the sound decodes. Loading then waits for the overview, up to `waitMs`, with "Preparing the picture N %". Its builder only gives way to its own video's sharp decoding. A canceled or failed load disposes it as before.
  - **Parallel builders:**
    - `nextRange` moved to the pure `proxy-plan.js`. A focus goes first, unless a builder reaches it within `leadSeconds`. Otherwise the biggest stretch nothing builds yet is taken: a free gap from its start, or the second half of a busy builder's part (shortening that builder's `to`, which it reads live).
    - Runs that meet are joined even while one is still being built: a builder writes through its job's `run`, which `join` repoints.
    - A range that finds no frames is kept as a blank, so it isn't planned again.
- **Measured** (30 min of 720p H.264 with a keyframe every 2 s, 8 threads):
  - Loading took 8.1 s instead of about 5 s: the sound decoded in 4.9 s, then the 3 s wait for the overview. By then 692 of its 900 frames were done; the rest followed within about 10 s.
  - The full proxy took 210 s with 3 builders, against 234 s with 1. Parallel building gains little here: CPU was about 60% idle and the page's main thread too, so the shared limit is probably Chromium's per-page media pipeline. What the builders do add is coverage spread over the video early on. Moving them into Workers might scale better; that hasn't been tried.
- **Where:** `src/video/proxy.js` (`buildOverview`, `overviewReady`, `overviewProgress`, `overviewCount`, `claim`, `builder`, `reachedEnd`, `join`, `frameAt`), the new `src/video/proxy-plan.js` (`nextRange`, `covers`, `reachedSoon`), `src/video/view.js` (`startProxy`, `overviewReady`, `serveProxy`, `markBuilt`/`showBuilt` with `data-proxy-overview`), `src/features/open-file.js` (`loadMediaFile`'s "overview" phase, `checkMemory`), `src/config.js` (`video.proxy.builders`, `video.proxy.overview`).
- **Verified by:**
  - The new `tests/unit/proxy-plan.test.mjs` (14 tests).
  - New checks in `tests/e2e/08-video.cjs`: loading builds the overview (12 frames for `long-counter.webm`); the proxy is built in several places at once; a far drag right after loading shows a proxy picture within a keyframe gap 100% of the time. The earlier drag checks still pass.
  - `tests/e2e/12-resources.cjs`: no codec leak with several builders.
  - `npm test` in full (201 unit, 409 e2e, 21 smoke) and `npm run check`.
  - The measurements above, from a temporary e2e topic (since removed).

## 2026-10-13: The low-res picture while dragging, far into long videos

- **What:** dragging on the waveform of a long video, far from its start, shows the blurry low-res picture (the proxy) again, so the picture follows the drag instead of lagging behind in sharp frames. The first jump to a new spot still waits for the sharp frame. After that, the proxy there is built within seconds, so scrubbing around that spot (including a few seconds back) is smooth. The rest of the video fills in afterwards.
- **Why:** the user saw only laggy sharp frames when dragging, "sometimes". This wasn't a regression in the recent commits (the video code there only had renames), which is why going back to `main` didn't help. Measured in a test: every proxy request during a drag at 150–200 s of a 4-minute video failed with "not built yet", because the proxy was only built up to 30–50 s. It was built strictly from the start, and only while the sharp decoder was idle, so that never happens during a drag or playback. On a long video that takes minutes. So it worked near the start, or after waiting, and not elsewhere.
- **How:**
  - The proxy's chunks are now kept in runs: stretches built in one go, each starting with a keyframe, so decoding never crosses runs. Runs that come to touch are joined.
  - A frame asked for where nothing is built becomes the builder's next focus. Once the asking settles (150 ms without a new miss, so a drag in progress doesn't restart decoding at a keyframe on every move), the builder stops the current stretch and builds from `CONFIG.video.proxy.leadSeconds` (5 s) before that spot. With no focus, it fills the first gap, front to back.
  - Each stretch has its own encoder, and reads its frames with `sourceSink.samples(from, to)`.
  - Two small fixes in reading: after a 250 ms timeout, the next request starts again at the keyframe (before, it could answer "already the latest frame" with nothing shown). A failed proxy decoder no longer clears a newer one.
  - `dispose()` now ends the builder's sample reader and closes its encoder. A read of a disposed file throws, which ends `for await` without ending Mediabunny's reader, whose decoder then stayed open; the new test sequence exposed this.
- **Where:** `src/video/proxy.js` (`nextRange`, `buildRange`, `join`, `runAt`, `built`, `frameAt`, `restartDecoder`, `dispose`), `src/video/view.js` (`show`: `onProgress` → `markBuilt`, the `data-proxy-built` attribute, kept across `attach`), `src/config.js` (`video.proxy.leadSeconds`), `tests/make-fixtures.sh` (`long-counter.webm`: 4 min, a keyframe every 20 s), `tests/preload.cjs` (`__sampleCanvas`), `tests/e2e/08-video.cjs` (the four new checks).
- **Not changed, but noted:** the proxy is built on the main window's page, paced by `setTimeout`, and Electron's `backgroundThrottling` is on. While that window is minimized or hidden, the build slows to a crawl.
- **Verified by:** the new checks in `TB_TOPICS=08` (the proxy is built where a drag went; dragging back there shows the proxy; the picture follows within 0.5 s 100% of the time; the sharp frame takes over after). With the old `src/`, the first failed ("not built", built only to ~30–50 s). `TB_TOPICS=08,12` four times without a codec leak, `npm test` in full, and `npm run check`.

## 2026-10-10: The welcome card no longer lifts on drag

- **What:** dragging a file over the window no longer lifts the welcome card by 2 px. It stays in place. The soft shadow and the marching amber border still appear.
- **Why:** the user found the small "pop" distracting and wanted the card to keep still.
- **How:** removed `transform: translateY(-2px)` from `body.dragging .welcome-drop`, and dropped `transform` from the card's transition. Without the lift, the reduced-motion override for the card isn't needed; `.drop-card` keeps its own.
- **Where:** `style.css` (`.welcome-drop`, `body.dragging .welcome-drop`, the reduced-motion block), `tests/e2e/02-welcome.cjs` (now checks the card has no transform).
- **Verified by:** `npm run check`, and `TB_TOPICS=02 npm test` (25 e2e and 21 smoke, all passing).

## 2026-10-10: More room above the welcome hint

- **What:** on the welcome screen, "or drop a file anywhere in this window, or paste a YouTube link" sits further below the Open buttons: 18 px instead of 10 px. The "Drop to open…" prompt that replaces it while a file is dragged over gets the same gap, so nothing jumps.
- **Why:** the user asked for more top margin on the hint.
- **How:** an 8 px `margin-top` on top of the card's 10 px flex gap.
- **Where:** `style.css` (`.welcome-hint`, `.welcome-drop-prompt`).
- **Verified by:** `npm run check`.

## 2026-10-10: Open, Save and From YouTube in one File menu

- **What:** the top bar no longer has the **Open…**, **Save** and **YouTube…** buttons. In their place is one quiet **File ▾** button with no fill or border and muted text, like the tool icons on the right. It opens a menu with **Open…**, **Save**, **Save as…** and **From YouTube…**, each showing its keys (Ctrl+O, Ctrl+S, Ctrl+Shift+S). Save and Save as… appear only in Electron, as Save did before. The menu has a divider before From YouTube…, which is hidden when that item isn't there. The accent dot for unsaved changes is now on File as well as on Save. Picking an item closes the menu first. The keyboard works the same as in the theme menu: ↑/↓/Home/End move between items and Escape closes it.
- **Why:** the user found the three file buttons too prominent in the editor's top bar.
- **How:** the theme menu's popover logic moved from `features/settings.js` into a shared helper, `bindMenu` in `src/ui/menu.js`. It covers anchoring to the button, the press-then-click guard, the arrow keys and `aria-expanded`; `closeOnPick` closes the menu in the capture phase, before the item's handler runs. Both menus use it now. Save and From YouTube kept their ids (`saveButton`, `downloadButton`), so `bindProject`, `bindDownloads` and the tests didn't change. The file input `#file` stays in the top bar, hidden, for Ctrl+O, Open… and the e2e harness. `isFileMenuOpen` blocks shortcuts while the menu is open, as `isThemeMenuOpen` does. In CSS, the menu rules are shared as `.menu` / `.menu-item`, with `.theme-menu` and `.file-menu` adding their own anchor and width. `.menu-button` is the File button. The `.open-button` rules are gone.
- **Where:** `index.html` (top bar, `#fileMenu`, the `i-chevron` icon), `src/ui/menu.js` (new), `src/features/file-menu.js` (new: `bindFileMenu`, `isFileMenuOpen`), `src/features/settings.js` (`bindThemePicker`), `src/features/project/index.js` (`bindProject`, `renderTitle`), `src/ui/dom.js`, `src/app.js`, `style.css` (controls, the unsaved dot, menus, top bar), `tests/e2e/16-projects.cjs` (new File menu checks), `README.md`.
- **Verified by:** `npm run check`, and `TB_TOPICS=01,02,09,10,13,16 npm test` (159 e2e and 21 smoke, all passing; 10-themes covers the theme menu after the refactor). The screenshot `tests/output/file-menu.png` shows the result.

## 2026-10-10: A compact timeline and transport in big video

- **What:** in big video, the waveform strip is 26 px (was 32 px) and the transport is compact: 41 px tall instead of about 49 px. It keeps the same controls, just smaller:
  - a 28 px Play button (was 40 px)
  - a 26 px Stop button
  - 22 px step arrows and step size
  - a 16 px time (was 22 px)
  - 11 px chips
  - 14 px icons

  There is still room around them: 6 px above and below, 16 px from the window's sides, and 14 px between groups. A first try with 3 px / 8 px looked squashed. At 1200×800 the picture takes 92 % of the height (was 90 %). The usual layout is unchanged.

- **Why:** the user asked for a slightly compacted timeline and playback controls for big video specifically.
- **How:** CSS only. The "Big video" section of `style.css` overrides the transport's existing selectors, each prefixed with `.app.big-video`, so they outweigh the base rules without `!important`. `--big-video-wave` goes to 26 px. Leaving the mode drops the class, and the usual sizes come back by themselves.
- **Where:** `style.css` ("Big video"), `tests/e2e/19-big-video.cjs` (new check "…and a compact transport": ≤ 44 px), `README.md`.
- **Verified by:** `npm run check`, and `TB_TOPICS=19 npm test` (22 e2e and 21 smoke, all passing). The screenshot `tests/output/big-video.png` shows the result.

## 2026-10-10: Leaving big video shows where playback is

- **What:** coming back from big video, the waveform has the zoom it had before, scrolled to the current position: the cursor sits at the left edge, as when the view pages along during playback. Following playback continues from there. It used to return to the scroll it had before big video, which could be far from where playback was by then.
- **Why:** the user asked for the waveform view to be on the current time when coming back from big video.
- **How:** `lockFit(false)` used to call `setView(saved)`. It now calls `setView({ seconds: saved.seconds, start: waveSurfer.getCurrentTime() })` and clears `followPaused`, which `setView` sets, so following carries on. Near the end of the track WaveSurfer's scroll limit keeps the view full, so the cursor sits further right. Opening a project in big video still restores its zoom on leaving, at the current time.
- **Where:** `src/waveform.js` (`lockFit`, its comment), `src/features/big-video.js` (header), `README.md`, `tests/e2e/19-big-video.cjs` (new check "…showing where playback is now": seek to 15 s in big video, leave, the cursor is in view).
- **Verified by:** `npm run check`, and `TB_TOPICS=19 npm test` (21 e2e and 21 smoke, all passing).

## 2026-10-10: Big video: edge to edge, a YouTube-style timeline

- **What:** in big video the picture now runs to the window's edges, with square corners and no gaps. At 1200×800 it takes 90 % of the height, up from 80 %. Under it is a 32 px waveform strip that always shows the whole track, like a video player's timeline: click or drag to seek, and the wheel doesn't zoom it. Under that is the transport, square too, with a hairline above it. Leaving big video gives the waveform back the zoom and scroll it had. The mode now carries over from one video to the next. An audio file or a restart still ends it.
- **Why:** the user wanted the waveform fully zoomed out and lower still, working like a YouTube timeline. They also wanted the containers to reach the viewport's edges without rounded corners, so the video fills as much space as possible.
- **How:**
  - **`waveform.lockFit(on)`.** On, it saves the user's view (`getView`) and zooms to fit (`zoom(0)`, scroll 0). While locked:
    - The wheel is swallowed.
    - `load()` stays at fit and saves the usual starting view (`initialViewSeconds`) for later.
    - `getView` / `setView` read and write the saved view, so a project saved or opened in big video keeps the real zoom.

    Off, it calls `setView(saved)`.

  - **Lock before the layout changes, unlock after.** A view is saved as "seconds in view", measured on the waveform's width. Saving it after the big layout had widened the waveform brought the zoom back wrong (1910 → 1366 px in the test).
    - `big-video.js` `render()` therefore locks _before_ adding the class and unlocks _after_ removing it.
    - The `big-video` class on `#app` now means "big layout on screen": on, and a video on the stage. A `MutationObserver` on `#stage`'s class re-runs `render()` when the video goes to its own window and comes back. While the video is out, the waveform is unlocked with its own zoom.
    - The CSS no longer needs `:has(.stage.has-video)`.
  - **Edge to edge.** In big video, `.app` loses its padding and gaps, and so do the workspace and the stage. The picture, timeline and transport lose their borders, corners and shadows; the timeline and transport keep a top hairline. The strip's height is one variable, `--big-video-wave` (32 px).
- **Where:**
  - `src/waveform.js` (`fitLocked`, `lockedView`, `lockFit`; `wheel`, `load`, `getView`, `setView`; header)
  - `src/features/big-video.js` (`render`, the observer, header)
  - `style.css` ("Big video")
  - `tests/e2e/19-big-video.cjs`:
    - edges at 0 / `innerWidth` and a 0 px radius
    - the picture ≥ 85 %
    - a strip ≤ 40 px at fit, which the wheel doesn't zoom
    - the zoom restored on leaving
    - the usual zoom while the video is in its own window
    - video → video stays big
  - `README.md`
- **Verified by:** `npm run check`, and `TB_TOPICS=19 npm test` (20 e2e and 21 smoke, all passing). The full suite wasn't run, at the user's request. The screenshot `tests/output/big-video.png` shows the result.

## 2026-10-10: Big video

- **What:** with a video open, **F**, a new button over the picture (on hover, left of the pop-out button) or a double-click on the picture switches to "big video". This is not fullscreen. The picture takes almost all the window: 80 % of its height at 1200×800, against 32 % before.
  - **Put away:** the top bar, the marks sidebar, the Sound dock, the minimap, and the timeline's ruler and marks lane.
  - **Left:** a 64 px waveform strip (click to seek, as ever) and the transport.

  The same toggles go back. Every key still works. The mode isn't remembered across restarts, and an audio file turns it off (a next video keeps it; see the next entry). With the video in its own window (V), the main window keeps its usual layout. Bringing the video back makes it big again.

- **Why:** the user wanted a mode where the video is clearly the largest part of the UI when they want the image bigger, with the other parts small or minimised, without breaking the app. They chose the slim waveform strip over a short full timeline or the minimap alone. They also chose to hide both the dock and the top bar, the F / button / double-click toggles, and not remembering the mode.
- **How:**
  - **One class, `big-video` on `#app`.** `style.css` does the layout. Every rule is scoped to `.app.big-video:has(.stage.has-video)`, so the mode applies only while a video is on the stage. With an audio file, or the video in its own window (`video-window` takes `has-video` off), the usual layout returns with no wiring between the two features.
  - **No sizing code changed.** The picture's canvas and the waveform already follow their containers (their ResizeObservers in `video/view.js` and `waveform.js` `bindResizeClamp`). A paused frame is redrawn, the waveform is redrawn at its new height, and the fit-to-width zoom is re-clamped for the wider stage.
  - **Ruler and marks lane collapse to 0 height, not `display: none`.** Their rows go to 0 with `visibility: hidden`, so they keep their width. `timeline.js` `renderRuler` reads `ruler.clientWidth`, and leaving the mode needs no re-render.
  - **Sidebar hidden by CSS only.** The remembered choice (`transcribee.sidebarHidden`, `features/layout.js`) is never touched.
  - **F only works while a video is docked.** `toggleBigVideo` does nothing unless `#stage.has-video` is set. `bigVideoPictureChanged(false)` (from the video view's `onVisibilityChange`) turns the mode off when the picture goes.
  - **Self-contained.** Removing it means deleting `src/features/big-video.js`, the "Big video" section of `style.css`, and the lines marked `Big video (` (`src/app.js`, the `i-enlarge` / `i-shrink` sprite symbols in `index.html`, `tests/run.cjs`).
- **Where:**
  - New: `src/features/big-video.js` (`bindBigVideo`, `toggleBigVideo`, `bigVideoPictureChanged`) and `tests/e2e/19-big-video.cjs`.
  - Changed:
    - `src/app.js` (import, `onVisibilityChange`, the F entry in `SHORTCUTS` under "Video", `start()`, the header's `features/` list)
    - `style.css` ("Big video", before "Smaller windows")
    - `index.html` (sprite: `i-enlarge`, `i-shrink`)
    - `tests/run.cjs` (`TOPICS`)
    - `README.md`
- **Verified by:** `npm run check`, and the full `npm test`: 187 unit, 391 e2e and 21 smoke, all passing. Topic 19 checks:
  - F hides the top bar, dock, sidebar and minimap. The picture is ≥ 75 % of the height, and the waveform strip is drawn at its height. The sidebar's stored choice is unchanged.
  - F again restores the usual layout.
  - The button and a double-click both toggle.
  - V gives the usual layout, and bringing the video back is big again.
  - An audio file turns it off, and F then does nothing.
  - The next video opens normally.

  The screenshot `tests/output/big-video.png` shows the result.

## 2026-10-10: Notifications

- **What:** small messages ("toasts") at the bottom centre of the window confirm that something worked:
  - "Project saved", with the path
  - "Downloaded “…”", with the path
  - "Opened “…”" for a file or a project
  - "Added N chapters as marks"

  Each fades after 4 s, and a click dismisses it sooner. A new tab, **Settings › General**, has **Show notifications** (on by default) to turn them off.

- **Why:** the user asked for a simple, modular, non-critical notification system, for things like where a file was saved, with a setting to turn it off. They chose "file / project opened" as the only extra event. They also asked to take notifications out of places they didn't belong: the "Saved as …" messages and the chapters notice sat in the transport bar's message line until something replaced them.
- **How:**
  - **`src/ui/toast.js`** has one export, `notify(text, detail?)`. On first use it adds a `.toasts` host (`role="status"`, `aria-live="polite"`) to `<body>`, so no markup is in `index.html`. It shows at most `CONFIG.notifications.max` (3) toasts, the oldest leaving first, for `CONFIG.notifications.showMs` (4000 ms). It reads `getPrefs("general").notifications`. The whole body is in `try/catch` (a `console.warn` at most), so a notification can never break the save, download or open that asked for it.
  - **Split of duties:** notifications only confirm. The message line (`showNotice` / `reportError`) keeps errors and "works only partly" notices. With notifications off, nothing that matters is lost. I checked every other message: the Settings dialog's error line, the download dialog's search status, the loading screens and Electron's message boxes (unsaved changes, crashed page). All are errors, progress or real decisions in the right place, so they stay.
  - **Settings:** `generalSection` comes first in `SECTIONS`, so the dialog opens on General. It has one boolean field, `notifications`. The main process normalises it like any section, so an old `prefs.json` gets the default.
  - **Styles:** `.toasts` / `.toast` use theme tokens only, sit at `z-index: 30` (above the loading overlay), and take clicks only on the toasts. They fade and slide in and out, with no motion under `prefers-reduced-motion`.
- **Where:**
  - New: `src/ui/toast.js`.
  - Changed:
    - `src/config.js` (`notifications`)
    - `src/prefs/index.js` (`generalSection`)
    - `src/features/project/index.js` (`writeProject`, `loadMedia`, `openFile`, `openProjectFile`)
    - `src/features/download.js` (the download's end)
    - `src/ui/dom.js` (`showMessage`'s comment)
    - `style.css` ("Notifications" before the shortcuts dialog; the reduced-motion block)
    - `src/app.js` (header: `ui/` list, "A new notification")
    - `README.md`
  - Tests:
    - `tests/e2e/harness.cjs` (`toasts()`, `clearToasts()`)
    - `tests/e2e/13-settings.cjs` (the General tab first; the switch saves off and on)
    - `tests/e2e/16-projects.cjs` (save → "Project saved" with the path and no "Saved" in the transport bar, plus a screenshot; opening a project → "Opened “Tone session.tbee”"; with the setting off, saving shows none)
    - `tests/e2e/09-downloads.cjs` (the download's toast and path, an empty message line, the chapters toast)
    - `tests/unit/prefs.test.mjs` (General's default; a non-boolean falls back to on)
- **Verified by:** `npm run check`, and the full `npm test`: 187 unit, 376 e2e and 21 smoke, all passing. A new screenshot, `tests/output/project-saved-toast.png` (from `16-projects.cjs`), shows the "Opened" and "Project saved" toasts stacked at the bottom centre.

## 2026-10-10: Fewer, larger files

- **What:** the app's JavaScript went from 81 files to 50 (`src/` 71 → 42, `electron/` 10 → 8), and the tests from 41 to 40. No behaviour changed. Code was moved, not rewritten.
- **Why:** the user felt the program had more files than its features justify. An audit found the amount of code fits the features, but the file count was inflated: 17 theme files of about 24 lines each, and many small modules with a single importer.
- **How (old → new):**
  - `src/themes/palettes/*.js` (17 themes) → `src/themes/palettes.js`, which also holds the `THEMES` list (menu order unchanged). `src/themes/mark-colors.js` → `src/themes/index.js`. `DEFAULT_THEME` is now looked up by id.
  - `src/prefs/sections/{theme,waveform,downloads}.js` → `src/prefs/index.js` (`themeSection`, `waveformSection` (exported, for `waveform.js`), `downloadsSection`).
  - `src/marks/format.js` → `src/marks/index.js` (same exports).
  - `src/core/{files,memory,peaks,parts}.js` → `src/core/media.js`. It is still pure, so the decode workers import it.
  - `src/features/loop.js` → `src/features/playback.js`; `src/features/search.js` → `src/features/download.js`; `src/features/theme-picker.js` → `src/features/settings.js` (its `opener` renamed `menuOpener`); `src/features/video-window/popup.js` → `src/features/video-window/index.js` (`ICONS`, `icon` and `buildVideoWindow` no longer exported).
  - `src/ui/focus.js` → `src/ui/shortcuts.js`.
  - `electron/theme-store.js` → `electron/prefs-store.js` (exports `createThemeView`). `electron/window-state.js` + `electron/video-window.js` → `electron/windows.js`. The state files (`window-state.json`, `video-window-state.json`) are unchanged.
  - Tests: `tests/unit/parts.test.mjs` + `decoding.test.mjs` → `tests/unit/media.test.mjs`. `tests/e2e/10-themes.cjs` compares the theme menu with `THEMES.length` instead of counting files in `palettes/`. `tests/e2e/11-parallel.cjs` imports `setLoopRegion` from `playback.js`.
  - Kept apart on purpose: `features/project/sections.js` (the one place that says what a project saves), `waveform-draw.js` and `video/proxy.js` (split off very large files), `decode-worker.js` and `preload.js` (must be their own files), `electron/system.js` (its unit test `require`s it; `main.js` would start the app), and the e2e topic files (`TB_TOPICS` picks them).
- **Where:** the files above, plus every importer and every comment that named an old path: `src/app.js` (header map and "common changes"), `README.md` (Files, "Adding a setting", "Marks", "Adding a colour theme"), `index.html`, `style.css`, `docs/diagnostics/long-file-loading.md`, `tests/e2e/harness.cjs`, `tests/diagnostics/profile-load.cjs`, and the then/now table above.
- **Verified by:** `npm run check`, and the full `npm test`: 185 unit, 370 e2e and 21 smoke, all passing. A `git grep` for every old path finds only this changelog's history.

## 2026-10-10: The loop's end line sits where B is

- **What:** both edge lines of the A–B loop on the waveform are now centred on A and B, like the cursor and the hover line. The end line used to sit about 2 px left of where B was set.
- **Why:** the user reported that the loop end looked off from where they placed it. The loop itself (the transport) was right; only the drawing was off.
- **How:** the region (`::part(loop-region)`) is `box-sizing: border-box` (since "Setting a loop no longer resizes the waveform"), so its 2 px borders were drawn inside `start`..`end`: A's line to the right of A, B's line to the left of B. `renderLoop` now sets `--loop-start` (A in percent) and `--loop-after` (B's distance from the end, in percent) instead of `left`/`width`. The CSS places the box with `left: max(0px, calc(var(--loop-start) - 1px))` and `right: max(0px, calc(var(--loop-after) - 1px))`, half a border past each time. The `max(0px, …)` keeps a loop at 0 or at the end inside the wrapper, so it still doesn't widen `scrollWidth`. Grabbing an edge needed no change: its zone was already centred on the exact time.
- **Where:** `src/waveform.js` (`renderLoop`); `style.css` (`.waveform ::part(loop-region)` and its comment); `tests/e2e/03-audio-and-loop.cjs` (new check "loop edges centred on A and B": the box reaches about 1 px past A and past B).
- **Verified by:** `npm run check`, and `TB_TOPICS=03 npm test` (all e2e pass, edges measured at −0.99 px and +1.03 px; the loop-at-the-end track-width checks still pass). The smoke check "saved theme applied on the next start" failed once and passed on the rerun; it's unrelated. The `loop-early.png` screenshot shows B's line on the hover line.

## 2026-10-10: Click the step size to change it

- **What:** clicking "Step 1 s" between the step arrows picks the next larger step size, going round from 10 s back to 0.01 s. Shift+click picks the one before. ↑ / ↓ still work as before, stopping at either end. On hover the step size shows a soft pill and its tooltip says so.
- **Why:** the user asked for a click on the step chip's text to cycle through the step sizes.
- **How:** `#stepSize` is now a `<button>` (it was an `<output>`), styled to read as plain text (`button.step-size`: transparent, no border, round hover tint). A new `cycleStepSize(direction)` wraps around `CONFIG.step.sizes`, where `changeStepSize` (↑ / ↓) clamps.
- **Where:** `index.html` (`#stepSize`); `src/ui/controls.js` (`cycleStepSize`); `src/features/playback.js` (`bindTransportButtons`); `style.css` (`button.step-size`); `tests/e2e/05-stepping.cjs` (new checks: click wraps 10 → 0.01 → 0.05; Shift+click goes back round to 10).
- **Verified by:** `npm run check`, and `TB_TOPICS=01,02,03,04,05,14,16 npm test` (e2e 176 pass, smoke 21 pass).

## 2026-10-10: Dialogs close with an ✕

- **What:** the "Close" buttons in Settings, From YouTube and Keyboard shortcuts are now an ✕ icon, with a "Close (Esc)" tooltip.
- **Why:** the user asked for an x icon wherever there was a Close button.
- **How:** a new `i-close` symbol in the SVG sprite (two crossed strokes, like the other 16×16 line icons). The buttons became `icon-button`s (transparent, round, the top bar's style) and kept their `aria-label`s. Being 34 px, they're pulled into the header's padding (`margin-block: -6px; margin-inline-end: -8px`) so the headers don't grow, and they line up with the right edge. Esc already closed these dialogs (native `<dialog>`).
- **Where:** `index.html` (`i-close`; `#shortcutsClose`, `#downloadClose`, `#settingsClose`); `style.css` (`.settings-head > .icon-button`).
- **Verified by:** `npm run check`, and `TB_TOPICS=01,02,09,13 npm test` (e2e 106 pass, smoke 21 pass). The Settings and From YouTube screenshots show the ✕ in place.

## 2026-10-10: The transport bar spans the whole width

- **What:** the transport bar (Play, Stop, the step control, the time and the chips) now runs the full width of the window, under the marks sidebar too. The sidebar is shorter and ends level with the minimap. Hiding the sidebar works as before.
- **Why:** the user asked for the bar to extend under the sidebar so the chips have room.
- **How:** the `.main` wrapper (stage + transport) is gone. The stage, the transport and the sidebar are now direct children of `.workspace`, placed by `grid-template` areas: `"stage sidebar"` above `"transport transport"`, or one column when the sidebar is hidden. The DOM order (stage, transport, sidebar) is unchanged, so Tab order is the same.
- **Where:** `index.html` (the `#workspace` children); `style.css` (`.workspace`, `.workspace.sidebar-hidden`, the new `.stage`/`.transport`/`.sidebar` grid areas, the section 5 comment).
- **Verified by:** `npm run check`, and `TB_TOPICS=01,02,03,04,05,06,08,14 npm test` (e2e 175 pass, smoke 21 pass), including the sidebar-at-half-a-screen and loop-size checks. A screenshot confirms the layout.

## 2026-10-10: A snugger step control

- **What:** the step arrows in the transport sit closer to the step size between them, and are slightly smaller, so the start, stop and loop chips have more room before they get cut off.
- **Why:** the user asked for less space between the arrows, so the chips aren't squished.
- **How:** `.step-size` loses its fixed `min-width: 58px` (wider than "Step 1 s" needs) for `padding-inline: 2px`. `.step-group`'s gap goes from 2 px to 0, and its arrow buttons from 30 px to 28 px. The control is about 20 px narrower at "Step 1 s". Its width now follows the text, so it changes a little as ↑ / ↓ pick another size.
- **Where:** `style.css` (`.step-group`, `.step-group .icon-button`, `.step-size`).
- **Verified by:** `npm run check`.

## 2026-10-10: Setting a loop no longer resizes the waveform

- **What:** setting an A–B loop leaves the waveform's size alone. The transport bar stays on one row, and the loop chip is shorter (`↻ 0:12.345–0:20.000`, like the ▶ and ■ chips), with the full text in its tooltip. If the chips still don't fit, the message area gives way first, then the chips cut off with "…".
- **Why:** the user reported that applying a loop changed the size of the waveform container.
- **How:** two causes, both fixed:
  - The loop region (`::part(loop-region)`, inside WaveSurfer's shadow DOM) was `content-box`, so a loop reaching the end (e.g. `[`, which sets B to the end) stuck out of the wrapper by its 4 px of borders. That widened the wrapper's `scrollWidth`, which `waveform.js` uses as the track width (`view().trackWidth`, the ruler, the lanes, zooming and the cursor). It's now `box-sizing: border-box`. (The page's global `box-sizing` rule doesn't reach into the shadow DOM.)
  - In narrower windows, the extra loop chip wrapped the transport's chips onto a second row. `.main`'s `auto` row then took that height from the stage, and the waveform redrew shorter. `.transport` is now `flex-wrap: nowrap`, and `.transport-chips` and `.chip-button` can shrink (`min-width: 0`, `overflow: hidden`, `text-overflow: ellipsis`).
- **Where:** `style.css` (`.waveform ::part(loop-region)`, `.transport`, `.transport-chips`, `.chip-button`, the "Smaller windows" comment); `src/ui/dom.js` (`renderLoopInfo`: the shorter text and a `title`); `tests/e2e/harness.cjs` (`loopRange` parses the new text); `tests/e2e/03-audio-and-loop.cjs` (new checks: a loop, including one reaching the end, keeps the waveform's height, the track width and the transport's height).
- **Verified by:** `npm run check`, and `TB_TOPICS=01,02,03,04,05,06,07,08,16,17 npm test` (e2e 204 pass, smoke 21 pass). With `box-sizing` removed, the new "reaching the end" check fails (track 862 px instead of 858).

## 2026-10-10: The theme menu keeps its size and place

- **What:** the palette button's theme menu no longer changes size or moves while you pick themes. It always stays attached to the button that opened it, including after a window resize, and a short window scrolls it inside. The checked theme shows the accent colour and a ✓ but is no longer bold. A long Automatic line ("follows the system: X or Y") is cut short with "…", and the full pairing shows on hover.
- **Why:** the user asked for a sturdier theme menu that doesn't resize itself and keeps its position when the theme changes.
- **How:** the menu had only a `min-width`, so its width followed the longest line. That line changed with every pick (Automatic's text, the bold checked item, the ✓ only on the checked item). It was also placed once with pixel `left`/`top` from `getBoundingClientRect`. Now it has a fixed `width: 300px`, a `max-height` with `overflow-y: auto`, every item keeps room for the ✓ (`visibility: hidden` unless checked), and labels have ellipsis. It's placed by CSS anchor positioning (`position-anchor: --theme-open`, flipping near edges), the same way the EQ popover is. Because the menu opens from either the top bar or the welcome screen, `openFrom` gives `anchor-name` to whichever button opened it.
- **Where:** `style.css` (`.theme-menu`, `.theme-item`, `.theme-name`); `src/features/theme-picker.js` (`openFrom`, `buttons`, `renderMenu`'s `title`, and the label wrapped in a span in `item`); `tests/e2e/10-themes.cjs` (a new check that the menu keeps its size and place).
- **Verified by:** `npm run check`, and `TB_TOPICS=01,02,03,10,13 npm test` (e2e 114 pass, smoke 21 pass). The new check confirms the menu's box stays at 300×640 in the same place across Automatic, Catppuccin Mocha, Tokyo Night Day and Nord.

## 2026-10-10: Six more colour themes

- **What:** three new dark themes (**Solarized Dark**, **Catppuccin Mocha**, **Tokyo Night**) and three new light ones (**One Light**, **Tokyo Night Day**, **Everforest Light**). The menu now has 9 dark and 8 light themes. Four of them complete pairs that already existed: Solarized, Catppuccin, One Dark/Light, Tokyo Night/Day.
- **Why:** the user brainstormed popular editor themes and picked these six.
- **How:** one palette file each, built from the theme's official palette. Where a colour failed the readability or "too alike" checks in `tests/unit/themes.test.mjs`, only its lightness changed (or it was swapped for another colour from the same palette):
  - Solarized Dark: the text is base1 a touch lighter (`#9aa8a8`) to read on the hover shade, and the red is lightened to `#e56765`.
  - Catppuccin Mocha: the loop is Sapphire `#74c7ec`, because Latte's Teal sat too near Mauve.
  - Tokyo Night: the start point is teal `#73daca`, because the default green sat too near the green loop. No other colour changed.
  - One Light: the blue accent is darkened to `#3a6cda` so the light text on it reads, and the muted grey is a little darker. The loop is purple `#a626a4`, because green sat too near the start point.
  - Tokyo Night Day: the palette is pale, so the text (`#3358b0`), muted grey (`#575c77`, darkened from the comment colour), blue (`#2565bd`) and red (`#b01e49`) are darkened, and the background is a lighter `#d6d8e1`. The start point is teal `#118c74`, apart from the green loop.
  - Everforest Light: the palette is soft, so the text (`#56646b`), grey (`#636e62`), green accent (`#687701`) and red (`#bc413e`) are darkened.
- **Where:** `src/themes/palettes/` (`solarized-dark.js`, `catppuccin-mocha.js`, `tokyo-night.js`, `one-light.js`, `tokyo-night-day.js`, `everforest-light.js`); `src/themes/index.js` (imports, `THEMES`: the dark ones after Gruvbox Dark, the light ones after Gruvbox Light); `README.md` (the list of themes).
- **Verified by:** unit tests (185 pass), `npm run check`, and `TB_TOPICS=01,02,03,10 npm test` (e2e 87 pass, smoke 21 pass). The e2e theme test counts the palette files, so it covers the new themes.

## 2026-10-10: A Gruvbox Dark theme

- **What:** a new dark theme, **Gruvbox Dark**, listed after One Dark in the theme menu and in Settings. It's the dark counterpart of Gruvbox Light: warm grey-brown panels, cream text, the bright orange accent, a blue A–B loop.
- **Why:** the user asked for a dark Gruvbox theme.
- **How:** colours from morhetz's Gruvbox palette: `bg0_h` `#1d2021` for the background, `bg0` `#282828` for the panels, `fg` `#ebdbb2` for text, `#a89984` for muted text, `#fe8019` for the accent, and `#83a598` for the loop. Three colours differ from what the theme test would otherwise get:
  - The error red is `#fb5a44`, a touch lighter than Gruvbox's `#fb4934`, which is 4.29:1 on the panels (text needs 4.5).
  - The start point is Gruvbox's green `#b8bb26`, because the shared default green sat too near the blue-green loop.
  - The stop point is Gruvbox's red `#fb4934`, set explicitly. Otherwise it would take the lightened error red, which sat too near the orange accent.
- **Where:** `src/themes/palettes/gruvbox-dark.js` (new); `src/themes/index.js` (import, `THEMES`); `README.md` (the list of themes).
- **Verified by:** `node --test tests/unit/*.mjs` (179 pass) and `npm run check`. The e2e theme test counts the files in `palettes/`, so it covers the new theme without changes, but it was not run here.

## 2026-10-10: TranscriBee Light uses the dark theme's yellow

- **What:** the TranscriBee Light theme's amber (played waveform, primary buttons, focus rings, and their hover) is now the same yellow as TranscriBee's: `#f5b301`, hovering to `#ffc52e`. Before, it was a darker `#b97e00` / `#cf9000`.
- **Why:** the user wanted the yellow to be the same in both TranscriBee themes.
- **How:** only the two colours changed; the minimap's played part is derived from the accent, so it follows. On the pale panels the yellow is about 1.8:1 against the surface, below the 3:1 the theme test asks of the accent, so that one check now skips `transcribee-light` (on purpose: one brand colour). The dark text on the accent (`accentInk`) still passes 4.5:1.
- **Where:** `src/themes/palettes/transcribee-light.js`; `tests/unit/themes.test.mjs` ("readable").
- **Verified by:** `node --test tests/unit/themes.test.mjs` and `npm run check`.

## 2026-10-10: The From YouTube dialog looks like Settings

- **What:** the From YouTube dialog (download a link, or search by words) has a new look, built the way Settings is:
  - A header bar: the download icon on an amber tile, the title **From YouTube** with "Paste a link, or search by words" under it, and **Close** on the right. The Cancel button at the bottom is gone.
  - One large search bar: a magnifier, the box, the site picker as a pill (only shown for words, as before) and **Download** / **Search** inside the bar. It gets an amber ring when focused.
  - The options are cards, side by side (one under the other in narrow windows). **Get** has Audio / Video tiles, with "Sound only" and "up to 1080p" (the best quality from Settings) in small type. **Chapters as marks** is an on/off switch with a line of help.
  - The search results are the only part that scrolls. A result under the mouse is shown as a card, and the pictures are a little larger.
  - The footer says where downloads are saved, with the folder in a chip, and the rights note.
  - A click outside the dialog closes it, as in Settings.
- **Why:** the user asked for a more appealing From YouTube dialog, modelled on how Settings is structured, with changes that suit this dialog.
- **How:**
  - What it takes from Settings: the `.settings-head` header bar, the `.pref-field` cards with `.pref-head`, `.pref-label` and `.pref-help`, the `.pref-options-row` tiles (the radio is still there, hidden from view but focusable), the `.pref-switch`, the `.pref-path` chip, a scrolling middle with `scrollbar-gutter: stable`, and closing on a backdrop click. These are the same classes, not copies of the rules.
  - What is its own: the search bar (`.youtube-search`), the icon tile (`.youtube-badge`), the cards' grid (`.youtube-options`), the footer, and the height. The dialog fits its content until results show. From then on (`.youtube-dialog:has(#searchResults:not([hidden]))`) it takes Settings' fixed height, so more pages of results never move the frame. With nothing to show, the results area is hidden, so there is no empty strip.
  - Every id stays the same (`downloadUrl`, `searchSource`, `downloadSubmit`, `downloadChapters`, the `downloadKind` radios…), so `features/download.js` and `features/search.js` needed no logic changes. `#downloadVideoLabel` is now the Video tile's detail ("up to 720p"), not the whole label.
  - The Save project dialog still uses the plain `.download-dialog` / `.download-form` look, and those shared rules are unchanged. Rules that only the old From YouTube layout used were removed: `.download-field`, `.download-check`, `.search-row`. A new `i-search` icon was added to the sprite. The misplaced comment above the Save dialog in index.html now describes that dialog.
- **Where:** `index.html` (`#downloadDialog`, `i-search`); `style.css` ("From YouTube dialog" section, `.search-results` / `.search-result` / `.search-thumb` in "Searching"); `src/features/download.js` (`openDownloadDialog`, `bindDownloads`); `tests/e2e/09-downloads.cjs` (backdrop check), `tests/e2e/13-settings.cjs` (the Video detail text).
- **Verified by:** `npm run check`; e2e topics 01, 02, 03, 09, 13 (141 pass), including a new check that a click on the backdrop closes the dialog. I looked at the `download-dialog.png` and `search-results.png` screenshots (dark theme).

## 2026-10-10: The hover line stays under the mouse, and keeps up with it

- **What:**
  - The hover line on the waveform (and its time) now stays under a still mouse when the view moves beneath it: the view paging to follow playback, zooming, scrolling, the minimap, a resize. Its time changes instead. Before, it moved along with the waveform and only came back under the mouse once the mouse moved.
  - It also comes back right after a click or drag, without moving the mouse, and the resize cursor at a loop edge updates when the view or the loop changes.
  - The line trails the mouse less on quick moves.
- **Why:** the user had to nudge the mouse after the view shifted, and asked for the line to follow the mouse more closely.
- **How:**
  - The waveform remembers the hovering mouse's x (`hoverX`; null while dragging or outside). `emitView`, which already runs on every scroll, zoom, redraw and resize, places the line there again (`refreshHover`). So does `setLoop`, and so does the end of a drag if the mouse is still over the waveform.
  - Faster: the hover path listens to `pointerrawupdate` where there is one (Chromium; it comes as soon as the mouse moves, without waiting for the next frame as `pointermove` does), falling back to `pointermove`. Drags still use `pointermove` and one update per frame. `renderHoverLine` measures everything before changing anything, so it never forces a layout. It moves the line with `transform: translateX(px)` (`will-change: transform` in style.css) instead of `left: %`. It only rewrites the label's text and `part` when they change.
- **Where:** `src/waveform.js` (`renderHoverLine`, `refreshHover`, `emitView`, `bindPointerSeek`, `setLoop`), `style.css` (`::part(hover-line)`), `tests/e2e/03-audio-and-loop.cjs`.
- **Verified by:** `npm run check`; e2e topics 03 and 06 (55 pass). Two new checks in topic 03: the line is back after a click without the mouse moving, and after zooming in and scrolling sideways under a still mouse, it is still within 1 px of the mouse, with a new time. Topic 03 now zooms back to fit when it finishes, because topic 06 measures its zoom from the view it starts with. The smoke check "saved theme applied on the next start" failed on some runs and passed on others; it doesn't involve the waveform.

## 2026-10-10: The video in a window of its own

- **What:**
  - A video can be popped out into its own window: the button that appears over the picture on hover (top right), or **V** (V again brings it back). Useful on a second screen, or as a small window beside an editor.
  - Meanwhile the main window looks as it does for a song (the full-height timeline), with a slim strip on top: "The video is in its own window · **Bring back**".
  - Moving the pointer over the video window shows the time, a **pin** (keep the window on top) and **Bring back**; they and the pointer hide after 2 s still. All keyboard shortcuts work there too.
  - Remembered: once out, the next video (also after a restart) opens in the window too. A song closes the window; the next video reopens it. Bringing it back, or closing the window, ends that. The window's size, place and pin are kept between runs.
  - Fixed on the way: a window made only taller or shorter (or the timeline given more room) now redraws the waveform at its new height; it used to keep the old height until the width changed.
- **Why:** the user asked for a video pop-out, with the main window like an audio file's plus a way back. They chose the strip as the indicator, hover controls and "always on top" as extras, remembering the choice, and closing the window for a song. They asked for it to be modular and easy to remove later.
- **How:**
  - There is no `<video>`: `video/view.js` draws decoded frames on a canvas. The page opens an empty same-origin window (`window.open("", "transcribee-video")`), which shares its process, so the page builds that window's DOM and the video view draws into a canvas there through a new `attach({ pane, canvas })`. Nothing is decoded twice; the picture stays frame-exact. `attach` takes the ResizeObserver and `devicePixelRatio` from the pane's own window.
  - The main window's animation frames (the transport's position events) stop while it is minimised, or covered on some systems. While the page is hidden and playing, the feature drives the picture from the video window's own frames (`followWhileHidden`), treating a backward step as a loop jump.
  - Electron: `electron/video-window.js` replaces the deny-all `setWindowOpenHandler` with one that allows only that empty window (every other `window.open` is still refused, and the video window itself can't navigate or open windows). It closes the window when the main window closes or its renderer dies, so quitting still works, and a canceled close leaves it. Bounds and pin are saved through `window-state.js` (now named state files, with `alwaysOnTop`) in `video-window-state.json`. The pin goes through `window.transcribee.videoWindow` (preload).
  - The waveform fix: WaveSurfer with `height: "auto"` only re-renders when its scroll container resizes, and that container's height follows its content. `bindResizeClamp` now re-renders (`setOptions({ height: "auto" })`, debounced 100 ms) when the container's height changes.
- **Modularity (removing the feature):**
  1. Delete `src/features/video-window/`, `electron/video-window.js` and `tests/e2e/18-video-window.cjs`.
  2. `grep -rn "Video window ("` lists every wiring line (app.js, index.html's stylesheet link, main.js, preload.js, the e2e harness, run.cjs, smoke.cjs, and the expected shortcut groups in topic 01); delete them, or take "Video" out of topic 01's list. In `electron/main.js`, put back `win.webContents.setWindowOpenHandler(() => ({ action: "deny" }))` (it's quoted in the marked line), and in app.js drop the `videoPictureChanged` call from `onVisibilityChange`.
  3. The generic hooks can stay; they do nothing unused: `videoView.attach`, the `target` window of `bindShortcuts` / `bindFocus`, and `window-state.js`'s `name` and `alwaysOnTop`. So can the waveform height fix (it's tested in topic 17).
  4. The leftover `localStorage["transcribee.videoPopped"]` and `video-window-state.json` are harmless.
- **Where:** `src/features/video-window/` (`index.js`: out and back, remembering, the strip and hover button, `followWhileHidden`; `popup.js`: the window's page and controls; `video-window.css`), `src/video/view.js` (`attach`, `observePane`), `src/ui/shortcuts.js` (`bindShortcuts`), `src/ui/focus.js` (`bindFocus`), `src/waveform.js` (`bindResizeClamp`), `src/app.js` (wiring, the V shortcut in a new "Video" group, `keysBlocked`), `index.html`, `electron/video-window.js`, `electron/window-state.js`, `electron/main.js`, `electron/preload.js`, `tests/e2e/18-video-window.cjs`, `tests/e2e/17-waveform.cjs`, `tests/e2e/harness.cjs`, `tests/run.cjs`, `tests/smoke.cjs`, `README.md`.
- **Verified by:**
  - A spike in Electron 44 (sandbox, context isolation) first: the empty child window is scriptable, a `VideoFrame` draws on its canvas, its ResizeObserver and animation frames run, a relative stylesheet loads, `pagehide` fires on close, and `window.open("https://example.com")` is still refused.
  - New e2e topic 18 (19 checks): V opens the window; the main stage loses `has-video`, shows the strip and hides the pane; the waveform fills the taller timeline; the title; the picture follows a seek and playback; Space in the video window plays; the pointer wakes the controls; the pin sets always-on-top and is saved; a song closes the window and the next video reopens it, still pinned; closing the window brings the video back and the next video stays; other windows are refused. In the harness the video window is hidden rather than offscreen (an offscreen `window.open` window gets no size).
  - A new check in topic 17: a taller and then shorter window redraws the waveform at its height. It failed before the fix (the waveform stayed 430 px in a 630 px timeline).
  - `tests/smoke.cjs` (the real main.js) opens the video window, and the app still quits when the main window closes (21 pass).
  - Screenshots: the main window with the strip; the video window with its controls.
  - `npm run check`; `npm test`: 178 unit, 360 e2e (after updating topic 01's expected shortcut groups for the new "Video" group), 21 smoke, all pass.

## 2026-10-10: The Settings dialog stays put, and looks better

- **What:**
  - The Settings dialog has one size. Switching tabs, or a field appearing (Automatic theme adds two pickers), no longer moves the dialog or its tabs. Fields that don't fit scroll inside it.
  - The side tabs have icons (palette, waveform, download), and the open tab has an amber bar on its left.
  - Choices without colour swatches are tiles: Shape, Show, Scale, Stereo, Download, Search on, Best video quality. The chosen tile is outlined in amber, with its detail in small type. Themes stay a list, with the chosen row tinted.
  - Each setting is a card.
  - On/off settings ("Add a video's chapters as marks") are a switch on the right of their label.
  - The Height slider shows its value in an amber chip ("100 %").
- **Why:** the user asked for a more appealing Settings dialog, above all one that doesn't shift as it changes. They chose the fixed size and all four visual ideas.
- **How:**
  - Before: the `<dialog>` was as tall as its content and centred, so every height change re-centred it (the test saw its top at 204, 38, 63 and 24 px across tabs).
  - `.settings-dialog` now has a fixed width and height (`min(720px, 100vw − 32px)` × `min(760px, 100vh − 48px)`), and `.settings-panels` scrolls with `scrollbar-gutter: stable`.
  - Sections can name an `icon` (a sprite id); `build()` in settings.js adds it to the tab, with a new `#i-wave` symbol.
  - The `choice` renderer uses the list only for options with swatches; the rest are `.pref-options-row` tiles, whose radio stays in the DOM, visually hidden, so keyboards, screen readers and `input.click()` work as before. `:has(input:checked)` and `:has(input:focus-visible)` style the chosen and focused tile.
  - `renderField` puts boolean controls in the field's head. `.pref-switch` is drawn with `appearance: none`, and its knob's slide is another `!important` exception to the base rule, off for reduced motion.
  - Number fields have an optional `unit` (Height: "%", so its label lost the "(%)").
- **Where:** `style.css` (the Settings dialog block, section 2's comment, the reduced-motion block), `index.html` (`#i-wave`), `src/features/settings.js` (`spriteIcon`, `build`), `src/ui/pref-fields.js` (`choice`, `number`, `renderField`), `src/prefs/fields.js` (`icon`, `unit` documented), `src/prefs/sections/*.js` (icons, Height's unit), `tests/e2e/13-settings.cjs`.
- **Verified by:**
  - A new check in `tests/e2e/13-settings.cjs` that the dialog's rect and the first tab stay identical through Theme → Waveform → Downloads → Theme → Automatic → Reset. It failed before the change and passes now (the dialog stays at 720 × 752 in the test window).
  - `npm run check`, `npm run test:unit` (178 pass), e2e topics 13 and 17 (53 pass), and screenshots of each tab.

## 2026-10-10: No slogan on the welcome screen

- **What:** the line under the title ("Slow down, loop and transcribe the music you're learning") is gone.
- **Why:** the user asked to remove it.
- **How:** the `.welcome-tagline` paragraph and its style were removed. The title now carries the 32 px gap to the drop card the tagline used to give.
- **Where:** `index.html` (the welcome screen), `style.css` (`.welcome-title`).
- **Verified by:** `npm run check`. No tests were run (as the user asked).

## 2026-10-10: The welcome screen's animations actually run; From YouTube… back beside Open

- **What:** the bee now floats and its aura breathes, the entrance plays, and the drop card's lift, the marching border and the player's drop overlay fade all move, as the previous entry intended. From YouTube… is back to the right of the Open button.
- **Why:** the user saw no animation at all, and preferred the buttons side by side. The longer Open label had pushed From YouTube… onto its own row.
- **How:**
  - The base rule in style.css (section 2) sets `animation: none !important; transition: none !important` on every element. The loader bars and the loading screen's pulse get past it with `!important`, but the new welcome animations and transitions didn't. They now carry `!important` too, and the base comment lists every exception.
  - The reduced-motion block's selectors are prefixed with `html`, so they still win over those `!important` rules wherever they sit in the file.
  - `.welcome-content` is 640 px wide instead of 560, so both buttons fit on one row.
- **Where:** `style.css` (section 2's comment; section 4's welcome animations, `.drop-ring`, `.welcome-drop`; section 5's `.drop-overlay`, `.drop-card`; the reduced-motion block), `tests/e2e/02-welcome.cjs`.
- **Verified by:** new checks in `tests/e2e/02-welcome.cjs`:
  - From YouTube… is on the same row, right of Open.
  - `bee-float` and `aura-breathe` are running, and their transforms change over 0.7 s.
  - The entrance is done once `.settled` is set.
  - With reduced motion emulated, the bee and aura stand still.
  - While a song is dragged over, the card is lifted, the ring shows, `drop-march` runs, and its dash offset moves.
  - E2E topics 01 and 02: 33 pass. `npm run check`.

## 2026-10-10: A livelier welcome screen, and a drop indicator

- **What:**
  - **Dragging a file over the window** says what a drop will open: "Drop to open this song / video / file", with the matching icon (and "(the first of N)" for several files). On the welcome screen, the drop card lifts a little with an amber glow, its dashed border becomes amber dashes that slowly move round it, and the prompt takes the hint's place. Over the player, the page dims and a card with the same prompt and moving border fades in, replacing the old dashed outline. Dragged text or links no longer light anything up.
  - **Gentle motion on the welcome screen:** the content rises in once on launch, and the bee floats by a few pixels while its glow breathes (6 s per cycle). All of it is off when the system asks for reduced motion.
  - **Projects:** the Open button reads "Open a song, video or project…" with a Ctrl+O chip. The plain formats line became chips (Audio, Video, and, in the app, Project .tbee).
  - The welcome screen's corner gear is the new gear from the top bar, at the same size.
- **Why:** the user asked for a more appealing welcome screen, with tiny, non-irritating animations and an indicator for a file dragged over the window. The welcome screen didn't mention .tbee projects and still had the old gear. They picked all four ideas (drag indicator, breathing bee, entrance, format chips) and the player overlay.
- **How:**
  - `bindFileDrop` reacts only when `dataTransfer.types` has `"Files"`. It reads the first file item's MIME type (`audio/*` → song, `video/*` → video, else file; the name can't be read before the drop, so a .tbee is "file") into `body.dataset.dropKind`, and writes the prompt into both prompts.
  - CSS shows the prompt, its icon (`#i-note`, `#i-film`, new `#i-project`) and the ring from `body.dragging` and `[data-drop-kind]`. The ring is an SVG `rect` with `rx` whose `stroke-dashoffset` animates only while it shows, so it follows the rounded corners.
  - The entrance runs until app.js adds `#welcome.settled` (1 s after start), so a failed first file doesn't replay it.
  - `bindProject` shows the Project chip in Electron, as it does the Save button.
  - The style.css comments no longer count the animations ("1 of 2"); they describe each one, and the reduced-motion block covers the new ones.
- **Where:** `index.html` (the welcome screen, `.drop-overlay`, `#i-project`, the corner icons), `style.css` (section 4: the welcome animations, `.drop-ring`, `.drop-prompt`, `.welcome-formats`, `.welcome-open kbd`; section 5: `.drop-overlay`, `.drop-card`; the reduced-motion block), `src/features/open-file.js` (`dragged`, `bindFileDrop`), `src/ui/dom.js`, `src/features/project/index.js` (`bindProject`), `src/app.js` (`start`), `tests/e2e/02-welcome.cjs`.
- **Verified by:**
  - `npm run check`.
  - Screenshots from a scratch script: the welcome screen at rest; dragging a song; dragging two .tbee files ("Drop to open this file (the first of 2)"); dragging a video over the player. With reduced motion emulated, the bee and glow animations are `none`.
  - No tests were run, as the user asked. The one welcome check that relied on the old look (an amber border on a file-less `dragover`) was updated to the new behaviour: a song's `dragover` shows "Drop to open this song". It hasn't been run.

## 2026-10-10: Lines between the top bar's sections, no bee there, a clearer gear

- **What:**
  - Thin lines now separate every section of the top bar: the name | Open… / Save / YouTube… | the open file | the tools.
  - The bee picture is gone from the top bar and is only on the welcome screen. The name stays first.
  - The Settings gear has 8 even, centred teeth and is drawn a little bigger (18 px), so it reads like the icons beside it.
- **Why:** the user asked for no bee in the main UI and separators between the sections. The gear looked small and not properly aligned: the old one was an uneven 6-tooth outline. (For a moment the name sat between the file buttons and the open file; the user preferred it back in front.)
- **How:**
  - `.topbar > * + *` gives every section after the first `padding-left` and a `border-left` hairline. This replaces the open file's own border.
  - The `.brand` span lost its `<img>`, and `.brand-logo` was removed.
  - The `#i-gear` symbol is a new path (outer radius 7, inner radius 5.3, centre circle 2.2), and `.settings-button .icon` is 18 px.
- **Where:** `index.html` (the top bar, `#i-gear`), `style.css` (`.topbar > * + *`, `.brand`, `.file-info`, `.settings-button .icon`).
- **Verified by:** `npm run check`, and a screenshot of the top bar. No tests were run (as the user asked).

## 2026-10-10: Waveform code tidied up (no change in behaviour)

- **What:** nothing changes for the user. The waveform code written this session is simpler, and the waveform test runs faster (topic 17: 122 s → 86 s).
- **Why:** the user asked to clean up the code from the waveform redesign and the bar seam fix, which had grown in steps.
- **How:**
  - `core/waveshape.js`: `rangeLevel` (one range of values as their max or RMS) is used by `columnLevels` and by the bars, which no longer allocate an array per bar. `combineFor(kind)` decides RMS for loudness and max for peaks in one place. One `louderOf` replaces two ways of taking the louder channel. `referenceLevel` takes a `floor`, so the overview no longer makes a masked copy to find its quiet level. Constants sit at the top, helpers at the end, and the `Shaped` type is named.
  - `waveform-draw.js`: bars always get the track (`trackWidth`, `pixelRatio`), so the guess from the canvas's values is gone. There's one pixel ratio, and the header describes the track-wide bar grid.
  - `waveform.js`: `renderFrom(levels, look, track)` makes both renderFunctions (`renderWaveform`, `renderMinimap`). `MINIMAP_LOOK` is a plain constant, and `shapeOptions` became `loudnessWindow`.
  - Tests: topic 17's helpers sit at the top, it uses `wc`/`win`/`key` directly, and it restores the defaults without a `try/catch`. The seam scan uses 3 zoom levels (fit, middle, deep) instead of 5, reaching the same depth. Topic 11 lost its guard from the red run. New unit tests cover `rangeLevel` and `referenceLevel`'s `floor`.
- **Where:** `src/core/waveshape.js`, `src/waveform-draw.js`, `src/waveform.js`, `tests/e2e/17-waveform.cjs`, `tests/e2e/11-parallel.cjs`, `tests/unit/waveshape.test.mjs`.
- **Verified by:**
  - `npm run check` and `npm run test:unit` after each step (178 pass).
  - E2E topics 03, 06, 10, 11, 13 and 17: 132 pass, the same checks as before the cleanup, in 142 s instead of 179 s.
  - The screenshots (`tests/output/waveform-*.png`) look the same.

## 2026-10-10: No gaps in the bar waveform where its canvases meet

- **What:** the bars no longer have a strip of background cutting the waveform in two, or a bar drawn at two heights. Every gap between bars is the same, at any zoom, scroll and display scaling.
- **Why:** the user reported a gap where the background showed through. It first showed in both shapes (in the old drawing, and in other apps using WaveSurfer), and in the bars only after the redesign.
- **How:**
  - WaveSurfer draws a zoomed-in track on several canvases side by side (858 CSS px each here), at whole CSS pixels.
  - The old drawing let WaveSurfer draw bars, and it rounds each canvas's width down to the bar spacing (`clampWidthToBarGrid` in its `renderer-utils.js`). That can leave a strip at the seams. Since the redesign WaveSurfer doesn't know about bars, which fixed the continuous shape.
  - Our own first bar code then spread each canvas's bars over that canvas alone, with fractional widths. Gaps doubled at seams (2 px where the gap is 1 px).
  - Under display scaling (125 %), a canvas also starts on a fraction of a pixel, and each canvas's own idea of its values drew a bar cut by a seam at two heights (105 px vs 94 px).
  - Now `fillBars` lays the bars out on the **whole track**, in whole pixels of WaveSurfer's ratio (`max(1, devicePixelRatio)`, as it sizes its canvases): slot `round(3·ratio)`, bar `round(2·ratio)`. They are mapped onto each canvas exactly, with no rounding of where it starts. A canvas draws the bar cut by its edge too, and every bar takes its values from the whole track (`trackWidth`, passed by `render`), so both halves of a cut bar match.
- **Where:** `src/waveform-draw.js` (`fillBars`, `drawWaveform`'s new `track` argument), `src/waveform.js` (`render` passes `trackWidth` and `pixelRatio`).
- **Verified by:** tests run red first.
  - New `tests/unit/waveform-draw.test.mjs`: canvases laid out as WaveSurfer does, at 100, 125, 150 and 90 %. Checks one even grid with no bar missing at a seam, and a cut bar as tall on both sides. It failed at 125 % before the fix.
  - The seam check in `tests/e2e/17-waveform.cjs` (`longestGap`): real screenshots of a steady 90 s sound along the middle, 5 zooms × 5 scrolls, paging a view-width at a time read at once, at 100, 125, 150 and 90 % (a page zoom changes `devicePixelRatio` as display scaling does). The continuous shape may show no background; bars only their own gap, `round(3s) − round(2s)`. It failed at 100 % and 90 % with the first bar code, and at 125 %/150 % with a whole-pixel grid that rounded where each canvas starts.
  - After: `npm run test:unit` (176 pass), `npm run check`, e2e topics 03, 06, 10 and 17 (99 pass).

## 2026-10-10: The minimap exaggerates loud and quiet parts

- **What:** the minimap stretches each song's quiet and loud parts apart. The quietest sound is a thin band (12 % of the height), the loudest fills it, and silence is empty. Choruses, drops and breaks stand out, which makes the song easier to find your way around. It is always drawn as one filled shape, whatever Settings › Waveform says. The main waveform is unchanged.
- **Why:** the user asked for exaggerated peaks and valleys in the minimap, to make navigating easier.
- **How:** `shapeOverview` smooths the loudness of both channels (louder of the two) over about 60 ms, three loudness windows. It then maps the 1st to the 99.5th percentile, in dB, onto 12–100 % of the height. A range under 3 dB is widened (`OVERVIEW_MIN_DB`), so a steady sound isn't blown up from its own wobbles. Anything 80 dB below the loudest counts as silence. The minimap's `renderFunction` is `renderOverview`, which draws the overview with the continuous shape.
- **Where:** `src/core/waveshape.js` (`shapeOverview` and the `OVERVIEW_*` constants), `src/waveform.js` (`renderOverview`, `overview`, `minimapOptions`, `load`).
- **Verified by:** tests written first and run red. In e2e, the minimap's column-height variation matched the waveform's (0.22 vs 0.24). After: three new unit tests in `waveshape.test.mjs` (exaggeration vs the waveform, the same at any volume, silence and floor, a steady sound); 168 pass. A new check in `tests/e2e/17-waveform.cjs` on the new fixture `verse-chorus.wav` (minimap variation 0.69 vs the waveform's 0.24), and it stays inside its card. `npm run check`, and e2e topics 03, 06, 10 and 17 (91 pass). Screenshot: `tests/output/waveform-minimap.png`.

## 2026-10-10: The waveform is scaled alike for every song; Settings › Waveform

- **What:**
  - The waveform fills its card about the same way from song to song. A quiet song with one loud click is no longer a thin line, and a loud, mastered song is no longer a solid block: its beats and gaps show. Nothing is ever drawn outside the card.
  - It shows **loudness** (RMS) by default instead of peaks, and stereo is drawn **combined** (the louder channel, mirrored) instead of left on top and right below.
  - A new **Settings › Waveform** tab (also in a plain browser): **Shape** (Bars, the default; Continuous, one filled shape; Peak + loudness, pale peaks around a solid loudness core), **Show** (Loudness or Peaks; hidden for Peak + loudness, which shows both), **Scale** (Linear, or Logarithmic in dB, which brings out quiet parts), **Stereo** (Combined, or Left above and right below) and **Height** (50–300 %). A change redraws at once, keeping the zoom and scroll, and the minimap follows.
- **Why:** the user reported that on some tracks the waveform looked compressed with few peaks, on others it was very small, and on some it went out of bounds. They wanted it consistent and suited to transcribing, plus a choice of shape (bars or continuous). Shapes, the default and the stereo setting were chosen with them.
- **How:**
  - Decoding now keeps two values per slice: the peak magnitude and the RMS (`downsampleLevels`, in the same single pass as before).
  - Shaping is pure (`core/waveshape.js`). The scale comes from the 99.5th percentile of the drawn measure (`referenceLevel`, a log-spaced histogram in one pass), not the loudest sample, so one spike can't shrink the rest. The reference fills 90 % of each half, and every value is clamped to 0…1, which is why nothing can spill out. Loudness is a sliding ~20 ms RMS (`slicesPerWindow`). Without it, a short track, which has only a few samples per slice, measured its "RMS" on the wave itself and drew lower than a long one. Two-tone scales both layers by the peak reference and keeps the core under the outline.
  - WaveSurfer no longer scales or draws. It gets an "index channel" (`(i + 0.5) / N`, always ≤ 1, so its own normalising leaves it alone) and our `renderFunction`. The slice of that channel each lazily drawn canvas receives says which levels to draw (`waveform-draw.js`). The minimap draws the same way. Columns combine as max for peaks and as RMS for loudness, so a single loud slice doesn't fill a zoomed-out column. The progress canvas is WaveSurfer's `source-in` copy, so the played part keeps the shape and both tones.
  - `waveform.setAppearance` re-shapes and redraws through the shared `redraw()`, which `refreshColors` now uses too.
- **Where:** `src/core/peaks.js` (`downsampleLevels`, replacing `downsamplePeaks`), `src/core/parts.js` (`joinParts` joins `levels`), `src/audio/decode-worker.js`, `src/audio/decoder.js` (`Decoded.levels`), `src/features/open-file.js`, new `src/core/waveshape.js`, new `src/waveform-draw.js`, `src/waveform.js` (`render`, `indexChannel`, `redraw`, `setAppearance`, `load`), new `src/prefs/sections/waveform.js` (listed in `src/prefs/index.js`), `src/app.js` (follows the `waveform` prefs).
- **Verified by:** the tests were written first and run before the change. Before: quiet-spike drew at 3 % of the height, loud-beats as a block (column variation 0), and stereo as left-only on top. After: new `tests/unit/waveshape.test.mjs`, levels tests in `core.test.mjs` and `parts.test.mjs`, the waveform section in `prefs.test.mjs` (`npm run test:unit`: 165 pass). New e2e topic `tests/e2e/17-waveform.cjs`, which measures the drawn canvases column by column on three new fixtures (`quiet-spike.wav`, `loud-beats.wav`, `stereo-left.wav`, made by `make-fixtures.sh`), plus the shapes, saving, the kept view and the minimap. `13-settings.cjs` and `11-parallel.cjs` were updated. `npm run check`, and e2e topics 03, 06, 10, 11, 13 and 17 (122 pass). The full `npm test` was not run. Screenshots: `tests/output/waveform-*.png`.

## 2026-10-10: The view follows the cursor when stepping with the arrows

- **What:** when zoomed in, stepping with ← / → (or jumping to a mark with Shift+← / →) past the edge of the view now pages the view to the cursor, paused or playing. Stepping back off the left edge while paused puts the cursor at the right edge, so the next steps back stay in view.
- **Why:** the user reported that the view stayed put while the arrows moved the cursor out of it.
- **How:** the view was only paged from the transport's `position` event while playing. The `jump` listener (every seek) now also calls `waveform.follow(time, { backward: !transport.playing })` after `resumeFollow()`. `follow`'s new `backward` option scrolls so a cursor that left on the left is at the right edge; otherwise it pages to the left edge as before. While playing, the left edge is kept, since playback moves right.
- **Where:** `src/waveform.js` (`follow`), `src/app.js` (the `jump` listener).
- **Verified by:** `npm run check`. Not yet tried by hand in `npm start`.

## 2026-10-10: A downloaded video's chapters become regions

- **What:**
  - When a downloaded video has chapters from its uploader ("0:00 Intro, 1:23 Verse…"; common on full albums, lessons and live sets), the file opens with one **region** per chapter. Each is named after its chapter, and the colours alternate through the mark colours so neighbouring chapters are told apart.
  - The notice adds "Added 6 chapters as marks." The regions are part of what was opened, so they aren't an unsaved change; editing or deleting them is.
  - A checkbox in the download dialog, "Add the video's chapters as marks", turns it off. It is remembered as a new setting, Settings › Downloads (on by default).
- **Why:** the user asked to import the uploader's timestamps as regions.
- **How:**
  - The download's existing yt-dlp run also prints `before_dl:[tb-chapters] %(chapters)j`, so there's no extra request. For a video download it prints once per part, so the first is kept.
  - `parseChapters` reads it. `NA` (no chapters) or anything unreadable gives `[]`. Entries without finite times, with a negative start, or with an end not after the start are dropped. Empty titles become "Chapter n". There are at most 500, sorted by start.
  - The result reaches the page with the download's answer (`chapters`). `loadMedia(media, signal, { chapters })` adds them through the new `importChapters` after the file loads and before the session's saved state is taken.
  - The marks store clamps their times to the track and drops regions that are too short.
- **Where:**
  - `electron/downloader.js` (`parseChapters`, `fetchParts`, `download` now returns `{ file, chapters }`, `handleDownloads`).
  - `src/features/marks.js` (`importChapters`), `src/features/project/index.js` (`loadMedia`).
  - `src/features/download.js` (the checkbox, `downloadLink`), `src/prefs/sections/downloads.js` (`chapters`).
  - `index.html` (`#downloadChapters`), `src/ui/dom.js`, `style.css` (`.download-check`), `README.md`.
- **Verified by:**
  - `npm run check`.
  - `tests/unit/downloader.test.mjs` (`parseChapters`: the real shape, `NA` and garbage, bad entries, the cap).
  - `tests/e2e/09-downloads.cjs`: no chapters adds no marks; `/chapters` gives Intro, Verse and Outro at their times in 3 colours, with the notice and no •; a video's two parts give 3, not 6; unticked gives none and is remembered. The fake yt-dlp prints `[tb-chapters]` for `https://fake.test/chapters`, else `NA`.
  - `tests/unit/prefs.test.mjs` updated for the new default.
  - Full `npm test`: unit 146/146, e2e 306/306, smoke 20/20.
  - A live download with the real yt-dlp of a chaptered full album (its 5 tracks came back with the file). Not yet tried by hand in `npm start`.

## 2026-10-09: Search by keywords in the download dialog

- **What:** the download dialog ("Download or search", from YouTube… / From YouTube…) takes a link **or** words.
  - With words, the button reads **Search** and a site picker (YouTube, SoundCloud) appears. 8 results are listed, each with its picture, title, "channel · length · views", and an arrow that opens its page in the system browser. **Show more** adds the next 8.
  - Clicking a result closes the dialog and downloads it (Audio/Video as chosen), exactly like a pasted link.
  - The status line says "Searching YouTube…", shows the downloader's first-time setup progress, says "No results for “…” on YouTube.", or explains a failure. Changing site searches the same words there.
  - A new search, or closing the dialog, stops one still running.
  - The last site is remembered as a new setting, Settings › Downloads › "Search on".
- **Why:** the user asked for downloading by keywords, with a few results to choose from. They picked thumbnails, Show more, opening a result in the browser, and other sites to search.
- **How:**
  - **Searching:** yt-dlp's flat search (`ytsearchN:` / `scsearchN:`, `--flat-playlist --dump-json --playlist-items a:b`): one JSON line per result, without opening each video, about 2 s a page against the real sites. Page 2 asks for 16 items and keeps 9–16. The words go through `cleanQuery` (one line, no control characters, at most 200 characters) and come after `--`, so they can never be read as an option.
  - **Results:** `normalizeResult` keeps a result only if its link is https on the source's hosts. For SoundCloud that is `webpage_url`, since its `url` is the API. It picks the smallest picture at least 160 px wide, else the widest; a YouTube result without one gets `i.ytimg.com/vi/<id>/mqdefault.jpg`.
  - **Pictures:** fetched in the main process with `net.fetch`, 4 at a time. Only https and jpeg/png/webp/gif up to 300 KB are accepted, within 10 s. Each is sent to the page as a `data:` URL (`download:thumbnail { searchId, index, src }`). The page's CSP is unchanged and the page still never touches the network. Pictures for a list no longer shown are ignored, and ones that arrive before their list are held until it's drawn.
  - **Opening in the browser:** `download:open-external` calls `shell.openExternal` only for an https link on a source's hosts (`isResultLink`).
  - **Downloader:** `run()`, the yt-dlp setup and the GitHub fetches now take their job explicitly, so a search has its own job and cancel and never touches a download's. Setup is shared through one in-flight promise.
  - **YouTube Music is not offered:** checked against the real site, its search results through yt-dlp have only a title (no artist, length or picture), so the rows can't be told apart. If yt-dlp starts returning more, adding it is one entry in `SEARCH_SOURCES`.
- **Where:**
  - New: `src/search/sources.js` (`SEARCH_SOURCES`, `PAGE_SIZE`, `cleanQuery`, `normalizeResult`, `isLinkOn`, `isResultLink`; a new lint layer above `prefs/`) and `src/features/search.js` (`searchFor`, `bindSearch`, `resetSearch`, `updateSearchMode`, `cancelSearch`).
  - `electron/downloader.js`: `search`, `cancelSearch`, `fetchThumbnail`, the `download:search` / `download:cancel-search` / `download:open-external` handlers, `sendThumbnails`; `run(job, …)`, `prepare(job, …)`.
  - `electron/preload.js` (`search`, `cancelSearch`, `onThumbnail`, `openExternal`), `electron/main.js` (`shell.openExternal`).
  - `src/features/download.js` (words search, a result downloads), `src/prefs/sections/downloads.js` (`searchSource`), `src/core/format.js` (`formatCount`), `src/ui/dom.js`.
  - `index.html` (the box is a text field with the site picker, `#searchStatus`, `#searchResults`, `#searchMore`, the `i-external` icon; the title "Download or search").
  - `style.css` (the dialog is 640 px wide and only the results scroll), `eslint.config.js`, `src/app.js` header, `README.md`.
- **Verified by:**
  - `npm run check`.
  - `tests/unit/search.test.mjs` (12): sources, `cleanQuery`, host checks, `normalizeResult` for YouTube and SoundCloud, and against the fake yt-dlp: pages 1 and 2 and their arguments, words that look like options, no results, a failure explained, cancel by a new search and by `cancelSearch`, and picture size, type and https limits.
  - `tests/e2e/09-downloads.cjs`: Search mode, 8 rows with titles, meta and data: pictures, Show more to 12, opening in the browser, switching to SoundCloud (remembered in prefs), no results, a failure, closing during a slow search, a link back to Download, and picking a result downloads and opens it. The harness has a stand-in `fetch` and browser; the fake yt-dlp learned `ytsearchN:` / `scsearchN:`.
  - `tests/unit/prefs.test.mjs` updated for the new default.
  - Full `npm test`: unit 142/142, e2e 298/298. Smoke: the same theme checks as before failed in some runs; that flakiness is already there on a clean checkout, see the previous entry.
  - A live search with the real yt-dlp (YouTube pages 1 and 2, SoundCloud, pictures fetched). Not yet tried by hand in `npm start`.

## 2026-10-09: Project files (.tbee): save a session and open it back

- **What:** **Save** (button in the top bar, Ctrl+S) writes a `.tbee` project with the marks (points and regions), speed, semitones, cents, volume, the EQ gains and on/off, the A–B loop (and whether it's on), the step size, the cursor position and start point, and the zoom and scroll. The first save (and Ctrl+Shift+S, Save As) asks whether to **link** to the song or video or put it **inside** the project, then shows the native Save dialog. A project opens like any file: Open… (which now accepts `.tbee`), Ctrl+O, or drag and drop. Everything comes back as saved. A linked file that moved is looked for relative to the project, then where it was; if both fail, the user is asked where it is (saving again remembers the new place). Unsaved changes show a • in the title and a dot on Save. Opening another file, downloading, or closing the window with unsaved changes asks Save / Don't save / Cancel. Moving the cursor or zooming doesn't count as an unsaved change.
- **Why:** the user asked to save and load everything about a session, with a file format that is modular and easy to extend.
- **How:**
  - **File:** a UTF-8 JSON header `{ format: "transcribee-project", version: 1, savedWith, media, sections }`, optionally followed by one NUL byte and the media's raw bytes. A linked project is plain, readable JSON. JSON never contains a raw NUL, so the reader scans to the first one (capped at 16 MB) and never reads the media to get the header.
  - **Extension point:** `SECTIONS` (sections.js), one entry per part of the session, each with its own `version`, `capture()`, `restore(data, { duration })` and `dirties`. Restoring runs after the media has loaded, from the defaults a new file gets. Every value is clamped (`setSetting`, `parseMarks`, times clamped to the track). A section that fails, or was saved by a newer version, is skipped with a notice; unknown sections are ignored. The frame's `version` is refused if it's newer.
  - **Unsaved changes:** the sections with `dirties` are captured as JSON and compared with the last save, on the next animation frame after any input, click, pointer-up or key-up and after every marks change. A new section needs no event wiring.
  - **Media:** the page names its media only by the `transcribee-media://` URL the main process gave it. For a file the user opened, the preload finds its path from the `File` (`webUtils.getPathForFile`) and registers it. `media-files.js` can now serve a slice of a file, so media inside a project streams straight from the `.tbee` with the usual range requests. After saving with the media inside, the page's URL is pointed at the new file and offset (`update`), so a project saved over itself keeps playing. Media that is only inside a project can't be saved as a link: the dialog disables that choice and the main process refuses it.
  - **Writing:** to `<target>.<pid>-<time>.tmp`, then renamed over the target (retried briefly on Windows, where a file still being read can't be replaced), so a crash never leaves half a file.
  - **Closing:** `guardClose` keeps each page's unsaved state (sent with `project:dirty`). On close with unsaved changes it shows the native box. Save sends `project:save-then-close` to the page, which saves and then asks to close.
  - **Keys:** `Shortcut` gains `ctrl` (Ctrl or Cmd; these also work in text fields) and `anytime` (allowed before a track is loaded). The legend shows "Ctrl+" and a new "File" group.
- **Where:** new `src/project/format.js` (pure, a new lint layer next to `marks/`), `src/features/project/index.js` (save, open, sessions, unsaved changes, the Save dialog), `src/features/project/sections.js`, and `electron/project-files.js` (`createProjectFiles`, `handleProjects`, `guardClose`, `readHeader`, `mediaCandidates`). Changed: `electron/media-files.js` (slices, `lookup`, `update`, `sliceSize`), `electron/main.js` (native dialogs, wiring), `electron/preload.js` (`transcribee.project`), `src/features/open-file.js` (`openFile` moved to features/project; `bindFileInput` and `bindFileDrop` take the opener), `src/features/download.js` (asks first; `loadMedia`), `src/features/marks.js` (`resetMarks(duration, saved)`), `src/features/loop.js` (`getLoopRegion`), `src/features/playback.js` (`getStartPoint`), `src/ui/controls.js` (`setStepSize`), `src/waveform.js` (`getView` and `setView`, in seconds in view and the start time, so a view means the same in any window size), `src/ui/shortcuts.js`, `src/ui/dom.js`, `src/app.js` (File shortcuts, header docs), `index.html` (Save button, `i-save` icon, `#saveDialog`), `style.css`, `eslint.config.js`, `README.md`.
- **Verified by:** `npm run check`; `tests/unit/project.test.mjs` (the format's round trip and refusals; saving linked and with the media inside; serving and range requests from the slice; saving over itself; finding moved media; asking for missing media); new e2e topic `tests/e2e/16-projects.cjs` (23 checks: a full session saved linked and with the media inside and reopened identically, including the exact zoom and scroll; Ctrl+S in place; •; Cancel and Don't save; moved and missing media; the legend), with stand-in dialogs in `tests/e2e/harness.cjs`. Full `npm test`: unit 130/130, e2e all pass (01-static-ui updated for the new "File" group). Smoke: the theme checks ("saved theme applied on the next start" / "theme.json … imported") fail about half the time, and do the same on a clean checkout of HEAD, so this is existing flakiness and not from this change. Not yet tried by hand in `npm start`.

## 2026-10-09: Hide the marks sidebar

- **What:** a sidebar button in the top bar (left of ?) hides the marks sidebar, and the timeline, minimap and transport take its width. Pressing it again brings the sidebar back. The choice is remembered on this computer.
- **Why:** the user asked to bring back a way to put the marks away, with a visible button. The old drawer (narrow windows only, removed in "Layout tweaks") isn't restored; this works at any width.
- **How:** `showSidebar()` sets `#sidebar`'s `hidden`, a `sidebar-hidden` class on `#workspace` (one grid column instead of two), and the button's `aria-pressed` and title. The waveform re-fits through its existing ResizeObserver. The choice is in `localStorage` (`transcribee.sidebarHidden`), read and written inside try/catch; without storage the sidebar shows.
- **Where:** `index.html` (`#sidebarToggle`, `id="workspace"`), `src/features/layout.js` (`bindSidebarToggle`, `showSidebar`), `src/ui/dom.js`, `style.css` (`.workspace.sidebar-hidden`).
- **Verified by:** `npm run check` (no tests run, at the user's request).

## 2026-10-09: The sound dock's groups line up

- **What:** the titles of the dock's groups (Speed, Pitch, Volume, EQ) sit on one line, and each group's first row of controls starts at the same height below it.
- **Why:** the user saw "Pitch" sitting lower than the others and asked for the dock's widgets to line up.
- **How:** each `.dock-group` was centred vertically on its own content (`justify-content: center`), so shorter groups started lower. Now they start at the top, and `.dock-head` has a fixed `height: 26px` (was `min-height: 24px`, which Pitch's 26 px reset button stretched). In Speed, the slider aligns with the presets' first row (`align-items: flex-start`, plus a 4 px nudge) rather than the middle of both rows.
- **Where:** `style.css` (`.dock-group`, `.dock-head`, `.speed-controls`).
- **Verified by:** `npm run check` (no tests run, at the user's request).

## 2026-10-09: The timeline flush with its border, with small corners

- **What:** the ruler, the marks lane and the waveform reach the timeline card's border with no gap, and the card's corners are small (4 px instead of 12 px), so little at their edges hides behind them.
- **Why:** a first try padded the card by 6 px (with the ruler's top corners rounded). The user found it didn't help much and asked for no visible gap between the border and the waveform, so the padding was removed.
- **How:** `.timeline` has `border-radius: 4px`, overriding the cards' `--radius`. It still clips its contents (`overflow: hidden`).
- **Where:** `style.css` (`.timeline`).
- **Verified by:** `npm run check` (no tests run, at the user's request).

## 2026-10-09: The minimap fits its card

- **What:** the minimap's waveform and its view box now fit inside the minimap's card, with 4 px of padding, in normal and short windows. Before, their bottom was cut off.
- **Why:** the user saw that the waveform and the view box on the minimap didn't fit.
- **How:** the minimap was drawn at a fixed 46 px, but the stage's grid row gives its card 44 px (34 px in short windows), border included, and the card hides overflow. Now the card has padding (`--minimap-pad`), the plugin's `[part~="minimap"]` element (in the light DOM) is `height: 100%`, and the minimap is drawn at `height: "auto"`, which WaveSurfer reads from that element and re-reads on resize. The marks' layer (`.minimap-marks`) is inset by the same padding, so it lines up with the drawing.
- **Where:** `style.css` (`.waveform-minimap`, `.minimap-marks`), `src/waveform.js` (`minimapOptions`).
- **Verified by:** `npm test` (261 e2e pass), and the `timeline-zoomed.png` screenshot.

## 2026-10-09: Files open zoomed in on their start; more zoom

- **What:** a newly opened file shows its first 15 seconds on the waveform (the whole track if it is shorter), scrolled to the start, instead of the whole track. The wheel can now zoom in to 48× fit-to-width (was 32×).
- **Why:** the user asked for the waveform to start zoomed in at the beginning, and for a little more zoom.
- **How:** `load()` sets `zoomLevel` to the waveform's width / `initialViewSeconds` px per second, clamped between fit-to-width and the maximum zoom (null, i.e. fit, if that isn't more than fit), then scrolls to 0 and clears `followPaused`. The peaks' density (`peaksPerSecondFor`) follows `maxZoomMultiplier`, so the deeper zoom stays sharp up to `maxPeaksPerSecond`.
- **Where:** `src/config.js` (`CONFIG.waveform.maxZoomMultiplier`, new `initialViewSeconds`), `src/waveform.js` (`load`).
- **Verified by:** `npm test` (261 e2e pass). The harness's `openFile` now records the view a file opens with (`h.opened.view`) and then zooms all the way out, since the topics assume the whole track in view. **`06-zoom.cjs`:** a file opens with 15 s in view at its start; max zoom is 48× fit. **`02-welcome.cjs`:** the dropped 20 s file is drawn at 20/15 of the container's width (was: at full width).

## 2026-10-09: A visible view box on the minimap

- **What:** the box on the minimap that shows which part of the song is in view now has a clear frame (2 px, in the text colour) and a light fill, on every theme.
- **Why:** the user could barely see it. It was the accent at 12% opacity, drawn over the minimap's played part, which is also accent-coloured.
- **How:** `--minimap-overlay` is now the text colour at 16% (the plugin sets it inline as the box's fill), and a new `--minimap-overlay-edge` (text colour at 85%) frames it. The text colour contrasts with the background on every theme, so this works without per-theme values. The overlay element (`[part~="minimap-overlay"]`) is in the light DOM, so plain CSS can style it.
  It is also raised to `z-index: 6 !important` (over the plugin's inline 2): the minimap's waveform layers (z-index 2, cursor 5) were covering it.
- **Where:** `style.css` (`:root` colours; the rule after `.waveform-minimap:active`).
- **Verified by:** `npm run check`.

## 2026-10-09: Green Play, red Stop

- **What:** the round Play button is green (dark icon) and the Stop button's icon is red, on every colour theme.
- **Why:** the user asked for Play and Stop to be green and red regardless of theme.
- **How:** fixed colours (not theme variables, so no palette can override them): `button.play-button` gets a `#2fbf71` fill (hover `#45d486`), outweighing `button.primary`'s accent; `.transport-buttons #stop` gets `#e5484d` (hover `#ff6369`), outweighing `.transport-buttons .icon-button`.
- **Where:** `style.css` (section 5, next to `button.play-button`).
- **Verified by:** `npm run check`.

## 2026-10-09: Keys never focus or ring buttons

- **What:** a button, slider, chip or menu item clicked with the mouse gives its focus back at once. So later keys (Space, the arrows, any shortcut) go to the shortcuts and never draw a focus ring on what was clicked. When a dialog or menu (Settings, the shortcuts, From YouTube, the theme menu, the EQ bands) closes, focus isn't left on the button that opened it. Text fields keep their focus, and so do controls inside an open dialog or menu. **Keyboard navigation is unchanged:** after a Tab, focus is left alone until the next mouse press, so Tab, Enter and Esc still bring you back to the button. The welcome screen's Open button is still focused on purpose, so Enter opens a file.
- **Why:** the user found buttons and sections lighting up after key presses confusing. Chromium shows `:focus-visible` on the focused element as soon as a key is pressed, so a clicked Play button got a ring when Space was pressed.
- **How:**
  - **`src/ui/focus.js` (new):** `bindFocus()`, called from `app.js`, works like this:
    - on `pointerup`, and on every dialog's `close` and every popover's closing `toggle`, it blurs the focused element after a `setTimeout`, unless that element is a text field (`isTextField`), sits inside an open dialog or popover, or the user is navigating with Tab;
    - a Tab key sets the "navigating with Tab" state, and a pointer press clears it.
  - The theme menu's and Settings' own "focus back to the opener" stays for keyboard use, and runs first.
- **Where:** `src/ui/focus.js`, `src/app.js`.
- **Verified by:**
  - **`14-marks.cjs`:** after a real mouse click on Play and then Space, nothing is focused and nothing matches `:focus-visible`. After clicking ? and then Esc, the same holds.
  - **`05-stepping.cjs`:** a clicked slider gives its focus back (was: it kept it).
  - **`10-themes.cjs`:**
    - the menu opened by mouse and closed with Esc leaves nothing focused;
    - new: Tab to the palette button, Enter (sent with its `char` event, which activates buttons), then Esc puts focus back on the button.
  - **`13-settings.cjs`:** Esc leaves no focus on the gear when Settings was opened by a click.
  - **Runs:** the full `npm test` gave unit 120 and e2e 260, all passing.
  - **Smoke:** a theme-at-startup check failed once in ten runs (`saved theme applied on the next start`, once also `theme.json … is imported`); the other nine passed. It concerns the main process saving and applying the theme, which this change doesn't touch, so it looks like an existing timing flake to look into.

## 2026-10-09: No text highlighting anywhere in the app

- **What:** text can't be selected anywhere: labels, times, buttons, dialogs, the marks list, and the welcome and loading screens. Dragging on the page no longer highlights it in blue. Text fields (mark names, the YouTube link) still select normally, since editing needs that. Images (the bee) can't be dragged out either.
- **Why:** the user found highlighting confusing. It showed up while dragging around the player.
- **How:**
  - `body { user-select: none }`, with `input, textarea { user-select: text }` back on;
  - `img { -webkit-user-drag: none }`;
  - the rules are in `style.css`, section 2 (Base).
- **Where:** `style.css`.
- **Verified by:**
  - `tests/e2e/01-static-ui.cjs`: the body, the welcome title and the track time have `user-select: none`, and the link field has `text`;
  - topic 14's renaming checks still select a mark's name in its field;
  - `TB_TOPICS=01,02,03,04,14` passes 122/122.

## 2026-10-09: Layout tweaks: no mark lines, a stop-point readout, icon-only Play, sidebar always in view

- **What** (six small changes the user asked for):
  1. **Marks no longer draw lines over the waveform.** They stay in their lane and on the minimap. The start and stop points keep their faint guide lines.
  2. **A red `■ 0:20.784` readout** for where playback last stopped sits beside the green start point's in the transport. A click goes there.
  3. **The Play button shows only its icon:** a 40 px round button. "Play"/"Pause" stays as a visually hidden label for screen readers, and the e2e `playing()` helper still reads it.
  4. **The step size sits between the step arrows** (`← Step 1 s →`, one rounded control), after Play and Stop.
  5. **The marks sidebar stays in view at half a screen.** The drawer for narrow windows is gone. Under 1100 px the sidebar is 240 px wide (from 300) and its Point/Region buttons show only their icons (with `aria-label`s). The transport wraps its chips to a second row when they don't fit.
  6. **The dock has more bottom padding:** 18 px, from 10 (12 px in short windows).
- **Why:** the user's requests. They want to put the app on one half of the screen and still see the marks.
- **How:**
  - **Mark lines:** `timeline.js` no longer creates `.guide-mark` elements, and the CSS for them is gone.
  - **The stop readout:** `features/playback.js` keeps `stopPoint` and renders `#stopPoint` in `setStopPoint`.
  - **The transport:** `index.html` rearranges it into Play and Stop, then `.step-group`, then the time and the chips.
  - **The Play button:** `button.play-button` (it needs the element selector to outweigh `button.primary`'s minimum width) and a `.visually-hidden` utility.
  - **The drawer:** its toggle, badge, CSS and `layout.js` code are removed. `layout.js` now only handles the shortcuts dialog.
- **Where:** `src/timeline.js`, `src/features/playback.js`, `src/features/layout.js`, `src/features/marks.js`, `src/ui/dom.js`, `index.html`, `style.css`, `src/app.js` (header), `README.md`.
- **Verified by:**
  - **E2E, `04-space-replay.cjs`:** the ■ readout shows the stop point, and a click on it goes there.
  - **E2E, `14-marks.cjs`:**
    - a mark draws no line over the waveform;
    - Play is 40 px with a 1 px hidden label, and the step size lies between the arrows. This check caught `button.primary` keeping Play 112 px wide;
    - at 960 px wide the sidebar is visible beside the timeline, inside the window, with nothing spilling sideways. This replaces the drawer check.
  - **Runs:** `TB_TOPICS=01,02,03,04,14` passes 121/121, the full e2e run passed with one failure (the Play-width check above), which is now fixed, and `npm run check` is clean.
  - **Screenshots:** 1200×800 and 960×1000, looked at.

## 2026-10-09: A new look and layout: marks sidebar, sound dock, no page scrolling

- **What:**
  - **Layout:**
    - **The page never scrolls.** It's the top bar, then the workspace, then the dock.
    - **The workspace** has the stage (video, timeline, minimap) and the transport on the left, and the **marks sidebar** on the right.
    - **The sound dock** along the bottom holds speed, pitch, volume and EQ in one row. The EQ's on/off switch is in the dock, and its bands open in a popover from **Bands**.
    - **The waveform takes all the spare height:** about 450 px at 1200×800, where it was about 115.
  - **Marks sidebar:**
    - the list scrolls inside it, so marks no longer push the page down;
    - each row shows the colour and the name on one line and the time under it, with × on hover or selection;
    - **Point** and **Region** buttons do what M and R do;
    - an empty state explains how to start.
  - **Look ("refined and calm"):**
    - the cards (timeline, transport, sidebar, dock) are set apart by surface and a soft shadow, with a hairline instead of strong borders;
    - one radius and spacing scale throughout;
    - soft buttons with the accent kept for the primary actions (Play, Open, Download);
    - the waveform is drawn as rounded bars with gaps (`barWidth 2, barGap 1, barRadius 2`) instead of a solid slab;
    - guide lines are fainter (38 %).
  - **One icon set:** an SVG sprite in `index.html` (`<symbol id="i-…">`) with play, pause, stop, step, gear, palette, help, sidebar, reset, open, download, point, region, sliders, note and film. The Play button swaps play and pause icons, and tooltips name each button's key.
  - **Top bar:** Open… and YouTube… with icons; the open file shown with an audio or video icon, its name, and its length and kind (`1:30 · M4A`); then the tools (?, Settings, theme).
  - **Transport:** the position is large and the duration small (`0:15.003 / 1:30.023`), and the start point, loop and step size are rounded chips on the right.
  - **The shortcut legend became a "?" dialog,** grouped by Playback, Moving around, A–B loop, Marks and Help, in two columns. It opens from the ? button or the `?` key.
  - **Small windows:**
    - under 1280 px wide, the speed presets take two rows;
    - under 1100 px wide, the sidebar becomes a drawer over the timeline, opened from a top-bar button that shows the marks count. Esc or a click outside closes it;
    - under 720 px tall, the dock and minimap get more compact;
    - at the 900×640 minimum, the waveform still gets about 300 px.
- **Why:** the user asked for a modern, inviting, clear look, and for the space problems to be fixed: the marks section grew with every mark and pushed the page into scrolling. An audit with screenshots at 1000×700, 1200×800, 1440×900 and 1920×1080, with 13 marks and with a video, also found:
  - the waveform squeezed to about 115 px;
  - mostly empty control panels;
  - very long sparse rows on wide screens;
  - borders around everything;
  - a dominant solid amber waveform;
  - scattered readouts, and mixed text symbols and icons.

  The user chose the layout (sidebar plus dock), the style, all four extras (bars, icons, the ? overlay, the top bar and readouts) and adaptive small windows.

- **How:**
  - **Markup:** `index.html` is restructured. Every element id the code and tests use is kept: `#speed`, `#speedChips`, `#eqFaders`, `#marksList`, `#trackTime` and the rest.
  - **Styles:** `style.css` gains tokens (`--radius`, `--radius-sm`, `--hairline`, `--shadow`, `--shadow-lifted`, `--sidebar-width`) and a rewritten section 5 (layout, cards, top bar, transport, sidebar, dock, EQ popover, shortcuts dialog, media queries). The EQ popover is placed with CSS anchor positioning (`anchor-name` and `position-area`), with no script.
  - **Behaviour:**
    - `src/features/layout.js` (new) handles the shortcuts dialog and the sidebar drawer;
    - each `SHORTCUTS` entry (`app.js`) has a `group`, and `renderShortcutLegend` (`ui/shortcuts.js`) renders sections;
    - `ui/dom.js` renders the play label and icon state (`.playing`) and the time as two spans. Its text is unchanged, so `textContent` still reads `pos / dur`;
    - `features/open-file.js` fills `#fileMeta` with `formatDuration` (new in `core/format.js`) and the extension;
    - `features/marks.js` wires the Point and Region buttons and the drawer button's count.
  - **The ▶ now sits above the ■ on the ruler.** With the narrower waveform, a start and stop point a few pixels apart overlapped, and the ■ took the press meant for dragging the ▶. The e2e test caught it.
- **Where:**
  - `index.html`, `style.css`;
  - `src/features/layout.js` (new), `src/app.js`, `src/ui/dom.js`, `src/ui/shortcuts.js`;
  - `src/features/marks.js`, `src/features/open-file.js`, `src/core/format.js`, `src/waveform.js`;
  - `README.md`.
- **Verified by:**
  - **Unit:** `formatDuration` in `tests/unit/core.test.mjs`.
  - **E2E, topic 01:** the shortcuts are grouped, and the dialog starts closed.
  - **E2E, topic 14:**
    - ? (button and key) opens the shortcuts and Esc closes them;
    - with 25 marks the list scrolls inside the sidebar and the page height stays the window's;
    - the Point button adds a mark;
    - in a 1000 px window the sidebar is hidden, opens as a fixed drawer from the top bar, closes on Esc, and the button shows the count.
  - **E2E, topic 04:** the click tolerance is now 0.03 s, since a pixel is 0.023 s on the narrower waveform.
  - **Runs:** the full `npm test` passes: unit 120, e2e 256, smoke 20. `npm run check` is clean.
  - **Screenshots,** looked at:
    - 1000×700, 1200×800, 1920×1080 and 900×640 (with the drawer open);
    - a video;
    - TranscriBee Light;
    - the EQ popover, the shortcuts dialog, the theme menu and Settings.

## 2026-10-09: Markers on their own lanes above the waveform (the timeline)

- **What:**
  - **The markers moved off the waveform.** They now sit on lanes above it, in one column with it:
    - **a new time ruler,** whose ticks and labels adapt to the zoom (`0:05`, `0:05.5`, `0:05.25`). A click or drag on it seeks. It carries the green start point's ▶ (drag to move, click to go there) and the red stop point's ■ (click to go there);
    - **a marks lane:**
      - a point is a line with a flag holding its name, and a region is a coloured bar with its name;
      - dragging moves a mark, and dragging a region's end resizes it;
      - a click selects it and goes there, and a double-click renames it;
      - an empty spot seeks.
  - **Guide lines:** each marker continues as a faint line over the waveform: marks in their colour (stronger when selected, dashed while a region is being marked), start in green, stop in red.
  - **What the waveform keeps:** the sound, the playback cursor, the hover line and the A–B loop.
  - **The wheel over the lanes** zooms and scrolls as it does over the waveform.
- **Why:**
  - **For the user:** the user wanted markers on a separate substrate, not painted on the waveform, but always in sync with it. Flags covered the top of the sound, handles its bottom, and region tints coloured it.
  - **In the code:** waveform.js mixed drawing the sound with drawing and dragging every kind of marker. Its pointer code had five priorities, styling went through `::part()`, and tests reached into WaveSurfer's shadow DOM.
- **How:**
  - **The view:** `waveform.js` publishes its view with `onView(fn)`: `{ duration, width, offset }`, the whole zoomed waveform's width and its left edge, which is the scroll.
    - It's sent on WaveSurfer's `scroll`, `zoom`, `redraw` and `resize` events, from a `ResizeObserver`, on `load()`, and **synchronously by every scroll the waveform makes** (`setScroll` / `scrollTo`).
    - That last part matters. Following playback scrolls from inside an animation frame, after that frame's scroll events, so WaveSurfer's event arrives a frame late. For that one painted frame, the waveform had paged and the lanes hadn't. The new every-frame check caught it, at up to 1167 px.
  - **`src/timeline.js` (new, at the waveform's layer):**
    - Each lane, and the guides layer, holds one `.timeline-track` as wide as the zoomed waveform and moved by `translateX(offset)`. Markers are placed in percent of it, so a zoom changes only the track widths and a scroll only their transforms, whatever the number of marks.
    - The ruler's ticks (`rulerTicks` and `formatRulerTime` in the new `src/core/ruler.js`, pure) are rendered for the visible range plus one screen either side, and redrawn only when the view leaves that range or the zoom changes.
    - The marks' drag logic (`draftAt`, the minimum region length, `markEdgeAt`), the start point's drag and the minimap ticks moved here from `waveform.js`.
  - **Alignment:** `index.html` wraps `#waveform` in `.timeline` (ruler, marks lane, then `.timeline-wave` holding the waveform and the `#timelineGuides` layer). The column has the border and the children have no side borders, so x = 0 is the same pixel in all of them.
  - **`waveform.js` slimmed down:** it lost the marks, start/stop and minimap-tick drawing, the mark, flag and handle pointer modes, and four options. Its pointer code is back to seek, draw-loop and loop-edge. It gained `view`, `onView`, `timeAtClientX`, `clientXAt`, `wheel`, `scrollNearEdge` and `holdFollow`, for the lanes.
  - **Wiring:**
    - `player.timeline` (`context.js`, created in `app.js`) takes the mark and start-point callbacks;
    - `features/marks.js` and `features/playback.js` draw through it;
    - `eslint.config.js` puts `timeline.js` at the waveform's layer.
  - **Video layout:** with a video, the timeline row is now at least 160 px (from 110), so the waveform keeps about 110 px under the 48 px of lanes.
- **Where:**
  - `src/timeline.js` and `src/core/ruler.js` (new);
  - `src/waveform.js`, `src/app.js` (the wiring and header), `src/context.js`, `src/features/marks.js`, `src/features/playback.js`;
  - `index.html`, `style.css` (the "Timeline" section replaces the `::part(mark…)`, `::part(start-…)` and `::part(stop-…)` rules);
  - `eslint.config.js`, `README.md`.
- **Verified by:**
  - **Unit:** `tests/unit/core.test.mjs` has 4 new ruler tests: the step leaves room for labels at any zoom, ticks stay in range with labels on whole steps, minor ticks are at least 6 px apart, and labels are as precise as the step.
  - **E2E, `tests/e2e/06-zoom.cjs`:** 5 new sync checks. Every ruler tick, marker and guide line in view is within 1 px of where the waveform has its time, measured in the same frame:
    - at fit;
    - after a wheel zoom;
    - in the frame of a scroll;
    - in **every frame for 2.5 s while playing and following**;
    - after a window resize.

    All were 0.02 px or less.

  - **E2E, `14-marks.cjs` and `04-space-replay.cjs`:** these now use the lanes instead of the shadow DOM. Topic 14 also checks that the waveform's shadow DOM holds no markers, and that guide lines are drawn.
  - **Stale test fixed:** `05-stepping.cjs` still pressed R in a check from before marks ("R / C do nothing"), which left a half-marked region for later topics. It now presses only C.
  - **Runs:** the full `npm test` passes: unit 120, e2e 254, smoke 20. `npm run check` is clean.
  - **Screenshots:** `marks.png`, `timeline-zoomed.png`, the light themes and the video layout, looked at.

## 2026-10-09: The stop point: a red marker for where playback last stopped

- **What:**
  - **Where it shows:** where playback last stopped is now drawn in red. On the waveform it's a 2 px line with a ■ handle at its bottom; on the minimap it's a tick.
  - **What counts as stopping:** a pause (Space, comma, releasing Z), Stop, and reaching the end. For Stop it's where you stopped, not 0, where the cursor goes.
  - **Clicking the ■** goes there. It can't be dragged.
  - **When it moves:** it stays put while playing again until the next stop, and a new file clears it.
- **Why:** the user wanted to see where they last stopped, next to the green start point. It's the same kind of line, in red.
- **How:**
  - **Drawing:** in `src/waveform.js`, the start point's drawing became two shared helpers. `pointElements(kind, title)` makes `<div part="<kind>-point">` with `<span part="<kind>-handle" data-handle="<kind>">` and a `.minimap-<kind>` tick; `placePoint` positions them in percent. `setStopPoint(time)` draws the red one.
  - **Handles:** `handleOf(event)` (which was `onStartHandle`) returns `"start"`, `"stop"` or null. A press on the ■ is the drag mode `"stop"`, which seeks on release.
  - **Recording:** in `src/features/playback.js`, the `"paused"` and `"ended"` states set the stop point to the position, and `"ready"` (a new file) clears it. `stop(event)` records `transport.positionAt(event.timeStamp)` itself before the cursor goes back to 0.
  - **The handles don't overlap:** the ■ sits left of its line and the ▶ right of its own, so both show when the two points meet.
  - **The colour:** a new optional theme role, `stop` → `--stop`. By default it's the theme's error red. Nord's error red, a pale pink, was too close to its yellow loop, so Nord gets `#ff7b85`.
- **Where:**
  - `src/waveform.js`, `src/features/playback.js`;
  - `src/themes/index.js`, `src/themes/palettes/nord.js`;
  - `style.css` (`::part(stop-point)`, `::part(stop-handle)`, `.minimap-stop`, `--stop`);
  - `src/app.js` (COMMON CHANGES), `README.md`.
- **Verified by:**
  - **Unit,** `tests/unit/themes.test.mjs`, in every theme:
    - `--stop` has at least 3:1 contrast on `--surface`;
    - `--stop` is at least 70 from `--loop` and 60 from `--accent` (Gruvbox Light's accent is an orange-red);
    - `--start` is at least 70 from `--stop`;
    - 116 unit tests pass.
  - **E2E,** in `tests/e2e/04-space-replay.cjs`, 7 new checks:
    - a pause marks the spot, and it's on the minimap too;
    - it stays while playing again;
    - Stop marks where it was stopped, not 0;
    - clicking the ■ goes there;
    - reaching the end marks the end.
  - **Test fix:** two of the start-point checks were racy, because they read the first sample after Space, which can come before the key is handled. They now compare with the position before the key.
  - **Runs:** `TB_TOPICS=01,02,03,04` passed twice, `TB_TOPICS=01,02,03,04,05,06,10,13,14` passes 191/191, and `npm run check` is clean.
  - **Screenshot:** `tests/output/stop-point.png`.

## 2026-10-09: The start point: a green marker for where Space plays from

- **What:**
  - Space replays from where you last started listening. That spot (the **start point**) is now shown in green:
    - **on the waveform:** a 2 px line with a ▶ handle at its bottom;
    - **on the minimap:** a tick;
    - **in the transport bar:** a readout, `▶ 0:05.000`.
  - **Dragging the handle** moves the start point without moving the cursor; a click on the handle goes there.
  - **Clicking the readout** goes there.
  - **New key, S:** "Space plays from here next time". While playing it takes what is being heard, without stopping; while paused, the cursor.
- **Why:** after a pause the cursor stays where it paused, so where Space would go was invisible and had to be remembered. The user asked for a green indicator, plus dragging it, the minimap tick, the readout and the key.
- **How:**
  - **One rule:** `transport.playStartFor(from)` holds the rule `play()` uses: from the top after the end, the loop start outside an active loop. `play()` and the marker both use it, so the marker always shows where playback really starts. `setLoop` now emits a `"loop"` event, so the marker follows loop changes.
  - **The owner:** `returnPoint` stays in `features/playback.js`.
    - `startPoint()` is `playStartFor(returnPoint ?? position)`;
    - `showStartPoint()` redraws the three views on `state`, `jump` and `loop`;
    - `setStartPoint(time)` is called by the drag;
    - `startHere(event)` is S, and uses `transport.positionAt(event.timeStamp)`.
  - **The waveform:** `waveform.setStartPoint(time)` draws `<div part="start-point">` with `<span part="start-handle" data-start-handle>` inside WaveSurfer's wrapper, positioned in percent like the loop and marks, plus `.minimap-start`.
    - **Pointer priority:** the handle now comes first. A drag draws a draft, and its end calls the new option `onStartPointChange`; a click without moving seeks.
    - **Hovering:** over the handle the hover line hides, and the pointer is `grab`.
    - **The handle sits at the bottom**, because mark flags are at the top and Space often starts at a mark.
    - **The line has a faint `--surface` outline**, so it reads over the played waveform (green in Monokai).
  - **The colour:** a new optional theme role, `start` → `--start`. By default it's derived from the marks' green for the scheme. One Dark, whose loop is green, gets `#3ddc84`.
- **Where:**
  - `src/audio/transport.js`, `src/features/playback.js`, `src/waveform.js`;
  - `src/app.js` (the S shortcut, the option, COMMON CHANGES);
  - `src/themes/index.js`, `src/themes/palettes/one-dark.js`;
  - `src/ui/dom.js`, `index.html` (`#startPoint`), `style.css`, `README.md`.
- **Verified by:**
  - **Unit:**
    - `tests/unit/transport.test.mjs`: `playStartFor` and the `"loop"` event;
    - `tests/unit/themes.test.mjs`: `--start` has at least 3:1 contrast on `--surface` in every theme, and is at least 70 away from `--loop` and `--accent`;
    - 116 unit tests pass.
  - **E2E,** in `tests/e2e/04-space-replay.cjs`, 10 new checks:
    - a click puts the line, the tick and the readout there;
    - it stays after playing and pausing;
    - S takes what's heard without stopping, and Space plays from there;
    - dragging the handle moves it but not the cursor;
    - the readout seeks;
    - with a loop on, it shows the loop start, which is where Space starts;
    - Stop moves it to 0.
  - **Runs:** `TB_TOPICS=01,02,03,04,05,06,10,13,14` passes 185/185, and `npm run check` is clean.
  - **Screenshots:** `tests/output/start-point.png`, plus Monokai and GitHub Light, looked at.

## 2026-10-09: A 1 px playback cursor and a hover line, for precise placing

- **What:**
  - the playback cursor on the waveform is now 1 px wide instead of 2;
  - a faint 1 px line follows the mouse over the waveform, with the time at its bottom (for example "0:05.008"). It's exactly where a click would seek to;
  - the mouse pointer over the waveform is a crosshair (the resize and grab pointers over loop edges, mark edges and flags are unchanged).
- **Why:** the user wanted more precise placing. A 2 px cursor covers two pixels, and WaveSurfer shifts it left by `progress × cursorWidth` (`translateX` in its `renderProgress`), so it was off its time by up to 2 px. Before clicking, there was no sign of where a click would land.
- **How:**
  - `cursorWidth: 1` in `WaveSurfer.create` (the minimap already used 1);
  - `renderHoverLine(x)` in `src/waveform.js` draws a `<div part="hover-line">` with a `<span part="hover-time">` inside WaveSurfer's wrapper, positioned in percent like the loop and the marks. It's styled from `style.css` with `::part()`;
  - its time is `timeAtClientX(x)`, the same function a click uses, and the text is `formatTrackTime`;
  - it's updated on `pointermove` while nothing is pressed, and hidden during a drag (the cursor or draft shows the spot), on `pointerleave` and on `load()`;
  - near the right edge the time moves to the line's left (`hover-time-flip`), so it isn't cut off.
- **Where:** `src/waveform.js` (the option, `renderHoverLine` and the pointer handlers), `style.css` (`.waveform` crosshair, `::part(hover-line)`, `::part(hover-time)`, `::part(hover-time-flip)`), `README.md`.
- **Verified by:**
  - `tests/e2e/03-audio-and-loop.cjs`, four new checks:
    - the cursor is 1 px;
    - the hover line is within 1 px of the mouse and shows its time;
    - a click there seeks to that time (±0.01 s);
    - the line goes when the mouse leaves;
  - `TB_TOPICS=01,02,03,04,05,06,14` passes 132/132, and `npm run check` is clean;
  - the screenshot `tests/output/hover-line.png`.

## 2026-10-09: The shortcut legend is collapsible, closed by default

- **What:** the legend at the bottom of the player is now a "▸ Keyboard shortcuts" heading. Clicking it (or Enter on it when focused) opens the list of keys, and clicking again closes it. It starts closed on every launch.
- **Why:** the marks keys made the legend long, and the page scrolled at small window heights. Most of the time the keys don't need to be on screen.
- **How:**
  - a native `<details>`/`<summary>`, so no script is needed and keyboard and screen-reader support come with it;
  - the summary is styled like the panel headings, with a ▸ marker that turns when open (the browser's own marker is hidden);
  - `renderShortcutLegend` still fills `#shortcutList`, which stays in the DOM while closed;
  - Space on the focused summary stays the play shortcut and doesn't toggle it, because the shortcut handler already calls `preventDefault`.
- **Where:** `index.html` (the footer), `style.css` ("Shortcut legend"), `README.md`.
- **Verified by:**
  - `tests/e2e/01-static-ui.cjs`: starts closed, a click opens it, a second click closes it, and Space on the summary doesn't toggle it;
  - `14-marks.cjs`: the keys show only while it's open. This uses `checkVisibility()`, because Chromium keeps `offsetParent` set inside a closed `<details>`;
  - `TB_TOPICS=01,14` passes 38/38, and `npm run check` is clean;
  - the screenshot `tests/output/marks.png`: the player fits at 800 px again.

## 2026-10-09: Marks: points and regions on the waveform

- **What:**
  - **Making marks:** `M` marks a **point** where you hear it (tap along while it plays); `R` starts a **region** (drawn dashed, growing with the cursor) and `R` again ends it. Esc stops marking a region, or deselects.
  - **On the waveform:** a point is a line, a region a tinted band, each with a **flag** at the top showing its name; the minimap shows them as ticks and bands. Dragging a flag moves the whole mark; dragging a point or a region's edge moves just that; clicking a flag selects the mark and goes to it; double-clicking it edits its name. A plain click anywhere else (even inside a region) still seeks, and Shift+drag still draws the loop.
  - **Keys:** Shift+← / Shift+→ go to the previous / next mark (while playing, "previous" skips the mark just passed, so pressing it twice goes back two). Delete or Backspace deletes the selected mark. The legend lists them.
  - **The Marks list,** under the controls: each mark's colour (click for the next of six), its name (edit in place; Enter keeps it, Esc puts the old one back), its time (click to go there) and × to delete it. Empty, it says how to make marks.
  - Marks last until another file is opened.
- **Why:** the user wants to mark points and regions on the waveform. They chose labelled points and regions with colours, made with keys at the cursor, edited on the waveform and in a list; session-only for now, but **easy to connect to future TranscriBee files** that save them.
- **How:**
  - **`src/marks/`**, a new pure layer beside `prefs/` (it may use `core` and `themes`; added to the ESLint layer zones).
    - `format.js`: the `Mark` type `{ id, start, end, label, color }` (`end: null` for a point); `normalizeMark` (times clamped to the track, region ends ordered, a too-short region becomes a point, labels trimmed and capped at 200, unknown colours become the default); the versioned saved form, `serializeMarks` → `{ version: 1, marks }` and `parseMarks` (drops bad entries and duplicate ids, refuses newer versions with `MarksFormatError`).
    - `index.js`: `createMarks({ minSeconds })`, the store: `reset(duration, saved?)`, `list`, `get`, `addPoint`, `addRegion` (null if too short), `update` (null if it would make a region too short), `remove`, `previous(time, tolerance)`, `next(time)`, `toJSON`, and one `"change"` event per edit. Default labels count up ("Mark 3", "Region 2"). Marks are frozen objects.
    - **Where TranscriBee files plug in:** `marks.toJSON()` is what to save; `marks.reset(duration, saved)` brings marks back with their track (called from `resetMarks` in `features/marks.js`, which `loadMediaFile` calls); `marks.on("change")` says when to save. `src/marks` is pure, so the main process can `parseMarks` a file it reads.
  - **Colours:** `src/themes/mark-colors.js` (`MARK_COLORS`: rose, orange, green, blue, violet, grey, each with a dark and a light shade). `cssVariables()` sets them as `--mark-<id>` in the theme's scheme, so the preload and theme switching apply them with everything else; the `style.css` `:root` defaults have the dark shades. Flags show the name in `--text` on `--surface-2` with a coloured edge, so names stay readable on every theme.
  - **The store's home:** `marks` in `context.js`, next to `settings`.
  - **Heard position:** `transport.positionAt(eventTime)` exposes `positionHeardAt` (the resting position when paused); M, R and the jumps pass the key's `timeStamp`.
  - **Waveform (`waveform.js`):** `setMarks(list, { selected, pending })` and `renderMarks()`, drawing into a `part="marks"` layer in WaveSurfer's wrapper (z-index 4: above the loop, below the playback cursor) and a `.minimap-marks` layer in `#waveform-minimap` (ours, so replacing the minimap plugin for a theme keeps it). Each mark's elements are kept by id between renders. In `bindPointerSeek`, a press goes to (in order) a mark's flag (found with `composedPath()`; the shadow root is open), a loop edge, a mark's edge (`markEdgeAt`, within `CONFIG.loop.edgeGrabPx`), or seeks; the new drag mode `"mark"` draws a draft and reports `onMarkChange` at the end, `onMarkSelect` on press, `onMarkRename` on a double-click. **Gotcha:** while pressed, the pointer is captured by the container, so `dblclick` lands on the container, not the flag; the flag is remembered from the last press (`pressedFlag`).
  - **Feature (`features/marks.js`):** the selection, the region being marked, the actions (`markPoint`, `markRegion`, `previousMark`, `nextMark`, `deleteSelectedMark`, `cancelMarking`, `moveMark`, `renameMark`, `selectMark`, `resetMarks`) and the list (`renderList`, rows kept by id and only reordered when the order changes, so typing in a name isn't interrupted). It redraws on every store change, and the waveform on each position while a region is pending. Keys in `SHORTCUTS` (`app.js`). Name fields are text inputs, so shortcuts are off while typing (`isTextField`).
  - **Page:** a full-width "Marks" panel in `.panels` (`index.html`; `dom.marksList`, `marksEmpty`, `marksCount`); styles under "Marks list" and the `::part(mark…)` rules in `style.css`.
  - **`CONFIG.marks`:** `minSeconds` (shortest region) and `jumpBackSeconds` (0.5 s).
- **Where:** `src/marks/format.js`, `src/marks/index.js`, `src/themes/mark-colors.js`, `src/themes/index.js` (`cssVariables`), `src/config.js`, `src/context.js`, `src/audio/transport.js` (`positionAt`), `src/waveform.js`, `src/features/marks.js`, `src/features/open-file.js` (`loadMediaFile`), `src/app.js`, `src/ui/dom.js`, `index.html`, `style.css`, `eslint.config.js`; docs in `src/app.js` (header) and `README.md`.
- **Verified by:**
  - `tests/unit/marks.test.mjs` (12 tests: the store, ordering, clamping, labels, updates, events, previous/next, the saved form round trip, bad and newer data); `tests/unit/themes.test.mjs` checks every mark colour at 3:1 against every theme's background and surface, and that the shade follows the scheme.
  - New e2e topic `tests/e2e/14-marks.cjs` (28 checks): M at the cursor and while playing; R…R with the pending region; Esc; too short; dragging a flag, an edge and a whole region; a click inside a region still seeks; clicking and double-clicking a flag; Shift+← / →; renaming (and keys typed there aren't shortcuts), colour and time in the list; Delete and ×; marks follow the zoom; a new file clears them. Screenshot `tests/output/marks.png` checked by eye. `14-security` became `15-security` (it must stay last).
  - `npm run check` clean; full `npm test`: unit 115, e2e 223, smoke 20, all passing.

## 2026-10-09: Settings: a modular preferences system, with a Settings dialog

- **What:**
  - **A gear button** next to the palette (in the top bar and on the welcome screen) opens **Settings**: a dialog with one tab per section. Changes apply at once and are saved; each setting has a **Reset** that shows when it isn't at its default. Esc, Close or a click outside closes it.
  - **Theme:** the colour theme (the palette menu stays as a shortcut to it; the two always agree), and for Automatic which theme dark and light mode use (shown only when Automatic is chosen).
  - **Downloads:**
    - **Save downloads in:** a folder, chosen with the system's folder picker (by default `~/Downloads/TranscriBee`);
    - **Download:** whether From YouTube starts on audio or video. Before, the dialog remembered its last choice for the session; now it starts on this setting.
    - **Best video quality:** 480p to 2160p (default 1080p).
      The From YouTube dialog shows the folder and the quality it will use.
- **Why:** the user asked for a basic, extendable and modular settings system. They chose a preferences screen (the player's controls still reset each run), a modal dialog, changes that apply instantly, and Theme and Downloads as the first sections.
- **How:**
  - **Declared, not hand-built.**
    - **Sections:** each section is one file in `src/prefs/sections/`, declared with `defineSection({ id, title, fields, onSet? })`, and listed in `SECTIONS` (`src/prefs/index.js`).
    - **Fields:** a field has a `type` (`choice`, `boolean`, `number`, `folder`), a label, help, a default and optional `visibleWhen`.
    - **What's generated from them:** the dialog's tabs and controls, the checks and the defaults. Nothing about a particular setting is written anywhere else.
    - **New field types:** one entry in `TYPES` (`src/prefs/fields.js`) and a renderer in `ui/pref-fields.js`.
    - **Shared:** `src/prefs/` is pure, with no DOM, so the main process uses the same declarations. It's a new layer in the ESLint layering, between `themes` and `config`.
  - **The main process keeps the copy that counts** (`electron/prefs-store.js`):
    - **The file:** `prefs.json` in the user-data folder, `{ version: 1, theme, downloads }`, checked on load and on every change, and written atomically (a temporary file, then a rename).
    - **Unreadable files:** an unreadable file gives the defaults.
    - **The old theme file:** on the first run, the old `theme.json` is imported, and left in place.
    - **IPC:** `prefs:initial` (synchronous, for the preload, which still applies the theme before the first paint), `prefs:set`, `prefs:reset` and `prefs:choose-folder`; every change is broadcast as `prefs:changed`.
    - **Reading per download:** `downloader.js` reads the folder and the quality at the start of each download (`videoFormat(maxHeight)`). A folder it can't create gives a message that says so and points to Settings.
  - **Security:**
    - **Checks:** the main process checks every value the page sends against the declarations: unknown sections and keys and invalid values are refused.
    - **Folders:** a folder can't be sent by the page at all (`fromPage: false`), only reset; it's set only through the native folder picker. So the page can't point downloads at an arbitrary path.
  - **The page side** (`src/ui/prefs.js`):
    - **The API:** `getPrefs`, `onPrefsChange`, `setPref`, `resetPref` and `chooseFolder`.
    - **Updates:** a change shows at once and is put back if the main process refuses it.
    - **Who listens:** `ui/theme.js` applies the theme from it, the palette menu sets it, and the dialog listens, so a change from anywhere (including another window) shows everywhere.
    - **Outside Electron:** the values go to localStorage, and the Downloads section is hidden.
  - **Naming:** in the code these are "prefs", so they aren't confused with `settings` in `context.js`, the player's controls.
  - **Removed:**
    - `theme:initial` and `theme:save`; `transcribee.theme` in the preload is now `transcribee.prefs`.
    - `normalizePrefs` in `src/themes/index.js`: the theme section does that job now.
    - The download dialog's session memory (`downloadKind`).
- **Where:**
  - **New:** `src/prefs/` (`fields.js`, `index.js`, `sections/theme.js`, `sections/downloads.js`); `electron/prefs-store.js`; `src/ui/prefs.js`; `src/ui/pref-fields.js`; `src/features/settings.js`.
  - **Changed:**
    - the main process: `electron/theme-store.js` (now `createThemeView`, a view on the store), `electron/main.js`, `electron/preload.js`, `electron/downloader.js`;
    - the page: `src/ui/theme.js` (`followThemePrefs`), `src/features/theme-picker.js`, `src/features/download.js`, `src/ui/dom.js`, `src/app.js`, `index.html` (the gear buttons, `#settingsDialog`, the download dialog's folder and quality), `style.css` (`.settings-*`, `.pref-*`, `.welcome-corner`);
    - the tooling: `eslint.config.js`.
  - **Tests:**
    - `tests/e2e/13-settings.cjs` (new);
    - `13-security` renamed `14-security`, so it stays last;
    - `tests/e2e/harness.cjs` (the prefs store, a stand-in folder picker: `folderChoice`);
    - `tests/fake-yt-dlp.cjs` (records its arguments);
    - `09-downloads.cjs` and `10-themes.cjs`;
    - `tests/smoke.cjs` (the `theme.json` import);
    - `tests/diagnostics/profile-load.cjs`;
    - `tests/unit/prefs.test.mjs` and `prefs-store.test.mjs` (new), and `themes.test.mjs`.
  - **Docs:** README ("Adding a setting", the file map), the `src/app.js` header (prefs, COMMON CHANGES: new setting, section or kind of setting) and the `electron/main.js` header.
- **Verified by:**
  - `npm run check`; the full `npm test` (unit 102, e2e 195, smoke 20); the same on the packaged build (`npm run build:dir`, `TB_APP_PATH`/`TB_APP_BINARY`).
  - **The new e2e topic** checks:
    - the gear and the tabs, with shortcuts held off while the dialog is open;
    - choosing, saving and Reset; the Automatic pairings showing and hiding;
    - the palette menu and the dialog agreeing both ways, and a change made in the main process showing in the open dialog;
    - Escape returning focus to the gear;
    - the folder picker, both canceled and chosen;
    - the From YouTube dialog starting on the kind, quality and folder from Settings, yt-dlp being asked for `height<=720`, and the file landing in the chosen folder;
    - the main process refusing a folder path, an invalid value, an unknown key or section, and a folder picker for a non-folder setting, with `prefs.json` unchanged;
    - the values being kept over a reload.
  - **Screenshots:** `tests/output/settings-theme.png` and `settings-downloads.png`.

## 2026-10-09: TranscriBee Light theme

- **What:** a new light theme, **TranscriBee Light**: the app's own amber on warm honey paper, with the cyan loop of the dark theme in a darker shade. It's listed first among the light themes, and it's now what **Automatic** uses in light mode, unless a light theme was picked before. That makes Automatic TranscriBee in dark mode and TranscriBee Light in light mode out of the box; before, it used Solarized Light.
- **Why:** the user asked for a TranscriBee light theme.
- **How:**
  - **The accent:** the dark theme's amber (`#f5b301`) is too pale on light panels, so the accent is a darker amber (`#b97e00`, 3.4:1 on the panels).
  - **The hover:** it goes lighter (`#cf9000`) rather than darker, as other light themes do, so the dark text on the accent stays readable (6.7:1).
  - **Every pair** meets the contrast the unit tests require.
  - **Saved choices are kept.** A saved Automatic pairing keeps its light theme; only new users and stored prefs without one get the new default.
- **Where:** `src/themes/palettes/transcribee-light.js` (new); `src/themes/index.js` (`THEMES`, `DEFAULT_PREFS.light`); `README.md`.
- **Verified by:** `npm run check`; the unit tests (80 pass, including the contrast checks for the new theme); `TB_TOPICS=02,10` (37 pass). A look at its screenshot, `tests/output/theme-transcribee-light.png`.

## 2026-10-09: Clicking the palette button again closes the theme menu

- **What:** with the theme menu open, clicking the palette button closes it. Before, the menu closed and opened again at once.
- **Why:** the user asked for it: the button should toggle the menu.
- **How:**
  - **The cause:** the menu is a popover with light dismiss. Pressing the button counts as a press outside the menu, so the menu closes when the mouse button comes up, before the `click` event. The click then found the menu closed and opened it again.
  - **What didn't work:** the first attempt passed the button as the popover's `source` (`showPopover({ source })`), expecting presses on it not to light-dismiss. Chromium 152 still dismissed the menu (seen in an event log: `pointerdown` open, `pointerup` closed, then `click`, then the menu opened again).
  - **The fix:** each palette button notes on `pointerdown` whether the menu is open (`closedByPress`). If it was, the click that follows does nothing more, because the press already closed the menu. A click from the keyboard (`detail` 0) has no press and just toggles. Clicks anywhere else still close the menu.
  - **Running one topic:** the e2e runner now takes `TB_TOPICS` (for example `TB_TOPICS=02,10`) to run only some topics. That's how this was tested without the whole suite.
- **Where:** `src/features/theme-picker.js` (`bindThemePicker`, `openFrom`); `tests/e2e/10-themes.cjs`; `tests/run.cjs` (`TB_TOPICS`); `README.md`.
- **Verified by:**
  - `npm run check`;
  - `TB_TOPICS=02,10` (37 checks, all pass), including a new check that clicks the button with real mouse input (press and release, which light dismiss reacts to; the existing checks used `element.click()`, which it ignores). A second click must close the menu and a third must open it.
  - The new check failed before the fix, with the `source` approach as well.

## 2026-10-09: The wheel zooms on the waveform and scrolls on the minimap

- **What:** the mouse wheel over the waveform zooms in and out at the mouse, with no Ctrl needed. The wheel over the minimap scrolls the view. Ctrl + wheel is no longer a separate shortcut (a touchpad pinch, which arrives as Ctrl + wheel, still zooms). A touchpad's sideways swipe on the waveform still scrolls.
- **Why:** the user asked for it: each area gets one simple wheel action, and no modifier shortcuts.
- **How:** on the waveform, a mostly vertical wheel goes to `zoomBy`, and a mostly sideways one scrolls. On the minimap, a new `wheel` listener scrolls the main waveform by the wheel's delta and pauses following the cursor, like dragging the minimap.
- **Where:** `src/waveform.js` (`bindWheelZoom`, `bindMinimapScrubbing`, the header comment); the comment in `src/config.js` (`waveform.maxZoomMultiplier`); `README.md`.
- **Verified by:** `npm run check`, and `tests/e2e/06-zoom.cjs`, which now zooms with a plain wheel and checks that the wheel on the minimap scrolls without zooming and pauses following. All of its checks pass. The rest of the suite wasn't run again, because the change is small.

## 2026-10-09: Long files decode in parallel

- **What:**
  - **About 3× faster.** Long files load about 3× faster:
    - an hour of MP3 in 7.4 s instead of 19.1 s (2 h: 13.0 s instead of 38.6 s);
    - an hour of AAC (like a YouTube download) in 5.4 s instead of 15.2 s;
    - a 1-hour video in 5.4 s instead of 16.3 s;
    - an hour of WAV in 2.2 s instead of 5.8 s.
  - **Opus wins back its loss:** an hour takes 7.7 s, against 25.1 s since the last change and 15.2 s before it.
  - **Playback is unchanged:** no clicks where the parts meet.
  - **Memory:** the peak is 1–12 % higher (an hour of MP3: 1.77 GB instead of 1.68 GB). Every memory-limited run of the diagnostic still loads.
- **Why:**
  - **The user asked for it**, as the follow-up in the long-file report: decoding in parallel could cut decoding time severalfold for every format and win back the Opus loss.
  - **The risk:** a click where the parts join, so it needed careful testing.
- **How:**
  - **Splitting.**
    - A track of at least `CONFIG.audio.parallel.minDuration` (60 s) is split into `min(cores − 1, 4)` parts. Each part is decoded by its own Worker, reading the file in its own pieces, so nothing is read whole.
    - Inner boundaries are multiples of the peak factor, so the parts' waveform peaks put end to end are the whole track's.
  - **Warming up.**
    - A decoder started mid-stream needs earlier audio to warm up, and Mediabunny starts exactly where asked. So each part but the first starts 1 s early (`preRoll`) and drops the warm-up.
    - Without it, the spike measured errors of up to 0.25 at every join for MP3, AAC and Opus.
  - **Joining by the samples.**
    - Timestamps aren't always sample-exact: in WebM, every Opus part was 48 frames (1 ms) late, because WebM rounds to the millisecond and Opus's codec delay isn't applied mid-stream.
    - So each part decodes a little past its end. The next part is placed where its first 2,048 samples equal the earlier part's, within ±50 ms of where its timestamps say (`findJoin`, tolerance 1e-4). A silent start trusts the timestamps.
    - If nothing matches, or a part came back nearly empty, the whole track is decoded again in one part: slower, never wrong.
  - **No copying.**
    - The parts aren't copied into one array, which would need twice the memory for a moment. The engine hands them to the time stretcher one after the other (`loadPieces`).
    - That exposed a bug in Signalsmith Stretch 1.3.2 (the latest on npm): reading a block that spans two buffers advanced the wrong position, giving garbage and a `RangeError` in the worklet.
    - The app now uses a copy with a two-line fix in `src/vendor/signalsmith-stretch/`. Its README describes the fix and how to upgrade. The npm dependency is removed, and the folder is excluded from Prettier, ESLint and type checking (`@ts-nocheck`).
  - **How many workers:** measured with 1, 2, 3, 4 and 6 workers on an hour of MP3: 20.6, 10.1, 7.1, 6.1 and 5.6 s. Six cost 270 MB more for half a second, so the maximum is 4.
  - **AAC at low bitrates isn't bit-exact** after a join. It differs by about −96 dB (SNR 79 dB on the 32 kb/s test chirp), most likely because its noise filling depends on where decoding started, as after any seek. The joins themselves have no step. At YouTube-like bitrates it was identical.
- **Where:**
  - `src/core/parts.js` (new: `splitFrames`, `workerCount`, `findJoin`, `joinParts`);
  - `src/audio/decode-worker.js` (decodes `{ from, to, preRoll }` of the track; progress in frames);
  - `src/audio/decoder.js` (`decodeInWorkers`: one worker opens the file and `prepare` runs, then the others open it; `findJoins`; the one-part fallback; the result is `pieces`);
  - `src/audio/engine.js` (`loadPieces` replaces `loadChannels`; imports the vendored Signalsmith);
  - `src/features/open-file.js` (`prepare` returns `{ peakFactor, workers }`);
  - `src/config.js` (`audio.parallel`);
  - `src/vendor/signalsmith-stretch/` (new);
  - `src/app.js` header, `README.md`, `docs/diagnostics/long-file-loading.md` (new section "After parallel decoding").
- **Verified by:**
  - `npm run check`;
  - **unit:** 79 pass. `tests/unit/parts.test.mjs` (new) covers splitting, worker counts, finding joins (off by ±48 and ±100 frames, silence, no match, a repeating tone), and that parts cut at their joins give back the whole track and its peaks;
  - **e2e:** 168 pass. New topic `tests/e2e/11-parallel.cjs`:
    - the patched stretcher renders three pieces exactly like one;
    - 90 s chirps (new fixtures `long-chirp.mp3/.m4a/.webm`, from `make-fixtures.sh`) decoded in 3 parts and in 1 are identical for MP3 and Opus, and have no step at the joins and an SNR above 60 dB for AAC;
    - the app uses several workers and none are left;
    - playing across a join runs at normal speed;
    - a loop over a join stays in it and wraps;
    - `11-resources.cjs` / `12-security.cjs` were renumbered to `12-` / `13-` to stay last;
  - **smoke:** 19 pass;
  - **diagnostics:**
    - new modes `workers` and `seams` in `tests/diagnostics/profile-load.cjs`, with runs in `run.cjs`'s PLAN;
    - every format's hour (MP3, AAC, Opus, WAV, video) decoded in 4 parts is **identical, sample for sample**, to the one-part decode, with the Opus lag of −48 frames corrected at every join; so is the 10-minute MP3 in 8 parts;
    - the full diagnostic was re-run for the load times above;
  - **the spike before it** (scratch code): parts with and without pre-roll compared against one worker; Signalsmith rendered offline from one and from three buffers;
  - **packaged build:** `npm run build:dir` plus the packaged test run.

## 2026-10-09: Downloads are read from disk, not sent to the page whole

- **What:**
  - **Less memory for downloads.** A downloaded song or video is now read from disk in pieces, like a file opened from disk.
  - **The numbers (1-hour 720p video, 736 MB, opened as a download):** the page's memory settles at 1.6 GB instead of 2.3 GB, with a peak of 1.6 GB instead of 2.4 GB. The load takes 15.5 s instead of 19.1 s.
  - **Nothing else changes for the user.**
- **Why:**
  - **The user asked for it**, as a follow-up of the long-file report ("What could come next").
  - **The cause:**
    - the main process read the whole saved file and sent it over IPC (`bytes`);
    - the page wrapped it in a `File` that lived in memory;
    - the video view keeps reading that `File` while the video is open, so for a video the whole file stayed in the page's memory for the whole session.
  - **Files opened from disk never had this problem:** their `File` is backed by the disk.
- **How:**
  - **The private URL.**
    - The sandboxed page can't turn a path into a disk-backed `File`. So the main process serves each download under a private URL: `transcribee-media://<random token>/<name>`.
    - The scheme is registered as privileged: fetchable, also from Workers, and streamed.
    - Mediabunny's `UrlSource` reads it with HTTP byte ranges (206 Partial Content) as it needs them, with a cache of at most 64 MiB per source.
  - **Only what the app shares is served.**
    - Only files the app itself shares are served, each under a fresh random token. An unknown token, or anything looking like a path, gets 404.
    - It answers GET and HEAD only.
    - It sends `Access-Control-Allow-Origin: *` and exposes `Content-Range`, because the page's `file://` origin fetches as `null`.
  - **The CSP** allows `connect-src transcribee-media:`.
  - **On the page**, something to open is now a `Media`: a `File`, or `{ name, url }` for a download. The decoder worker and the video view build their Mediabunny source from it (`mediaSource`), so both read the download by URL. The decoding fallback for formats Mediabunny can't read fetches the bytes whole, as it reads a `File` whole.
  - **The spike before it:** a `fetch` with a `Range` header, and `UrlSource` decoding the whole sound of the 1-hour video, both worked from the page and from a module Worker. The audio decoded in 12.2 s.
- **Where:**
  - `electron/media-files.js` (new: `registerMediaScheme`, `createMediaFiles` → `share`, `handle`, `respond`; `parseRange`);
  - `electron/main.js` (registers the scheme before ready, passes `share` to the downloader);
  - `electron/downloader.js` (`handleDownloads` returns `url` instead of `bytes`);
  - `electron/preload.js` (comment);
  - `index.html` (CSP);
  - `src/core/files.js` (the `Media` type, `mediaSource`, `readWhole`; `isVideoFile` works without a `type`);
  - `src/audio/decode-worker.js`, `src/audio/decoder.js`, `src/video/view.js` (`prepare(media)`);
  - `src/features/open-file.js` (`loadMediaFile(media)`), `src/features/download.js`.
- **Verified by:**
  - `npm run check`;
  - **unit:** 70 pass. New tests: `tests/unit/media-files.test.mjs` (range parsing, 200/206/416/404/405, HEAD, the CORS headers, a file gone since sharing), and `Media` in `core.test.mjs`;
  - **e2e:** 160 pass. New checks:
    - a downloaded video is read through the scheme (the harness counts reads);
    - unknown or path-like media URLs get 404 (`12-security.cjs`);
  - **the e2e harness** registers the scheme as `main.js` does and allows it in its request filter;
  - **smoke:** 19 pass;
  - **memory:** measured with a scratch script that opens the 1-hour video in the real page, both ways, each in a fresh process (the numbers above).

## 2026-10-08: Long files open reliably

- **What:**
  - **Long files open.** Files of an hour or two load, including hour-long YouTube downloads and videos, which failed before with "isn't an audio file".
  - **Faster, less memory.** A 1-hour MP3 loads in 19 s instead of 26 s, with a peak of 1.7 GB instead of 2.8 GB. A 1-hour WAV takes 6 s instead of 21 s.
  - **Progress and Cancel.** Loading shows a percentage and a Cancel button; Cancel leaves the current file as it was.
  - **Honest refusals.** A file whose sound wouldn't fit in the available memory is refused with a message that says so. A file without sound says so too.
  - **No more blank window.** If the page's process dies anyway, a dialog explains and the page reloads.
  - **No video size limit.** The 2 GB limit for videos is gone.
  - **The UI no longer freezes** for 2 s per hour of audio at the end of a load.
  - **One regression:** Opus files load slower (an hour: 25 s instead of 15 s).
- **Why:**
  - the user reported that hour-long files load very slowly or fail;
  - `docs/diagnostics/long-file-loading.md` measured the cause: one `decodeAudioData` call with a size limit, 2× peak memory and a full resampling pass;
  - the user approved fixing it along the report's recommendations 1–5.
- **How:**
  - **Decoding** (`audio/decoder.js` + `audio/decode-worker.js`):
    - a module Worker opens the file with Mediabunny (`BlobSource`: read in pieces, never whole) and decodes it with WebCodecs (`AudioSampleSink`);
    - the samples go into one preallocated `Float32Array` per channel at the file's own rate;
    - the peaks are computed in one pass at the end (`downsamplePeaks`; per chunk it cost 2–4 s per hour instead of 0.6);
    - the result is transferred to the page without a copy.
  - **The protocol** is open → info → (page checks memory, picks the peak factor) → decode → progress → done/error. Errors come in kinds (`no-audio`, `cannot-decode`, `out-of-memory`, `failed`).
  - **Fallback:** files the worker can't read fall back to `decodeAudioData` on the whole file, at 48 kHz (`CONFIG.audio.fallbackSampleRate`).
  - **Sample rate:** Signalsmith reads buffers at the context's rate, so `engine.useSampleRate(rate)` rebuilds the `AudioContext` at the file's rate when it differs. The browser converts to the device's rate as it plays, and `transport.load` restarts the timeline on the new clock.
  - **Memory check:**
    - the estimate is decoded bytes plus, for video, the proxy at its bitrate (`core/memory.js`);
    - it's compared with 80 % of what the system has available (`CONFIG.audio.maxMemoryShare`);
    - the main process answers `system:available-memory` (`electron/system.js`): MemAvailable on Linux, `os.freemem()` on Windows, unknown on macOS (where free memory is unreliable), in which case the check is skipped.
  - **Cancel:**
    - `withLoading` gives its task an AbortSignal, which the loading screen's and overlay's Cancel buttons abort (`bindLoadCancel`);
    - downloads cancel through the same signal;
    - an AbortError is not an error.
  - **Crash handler:** `handleRendererCrash` listens to `render-process-gone`, shows a dialog and reloads.
- **Where:**
  - **Page:** `src/audio/decoder.js`, `src/audio/decode-worker.js` (new); `src/audio/engine.js` (`useSampleRate`, `sampleRate`; `decode` removed); `src/core/memory.js` (new); `src/core/format.js` (`formatMemory`; `formatGigabytes` removed); `src/config.js` (`audio.fallbackSampleRate`, `audio.maxMemoryShare`; `maxFileBytes` removed); `src/features/open-file.js` (`loadMediaFile`, `withLoading`, `cancelLoading`, `bindLoadCancel`; `computePeaks` removed); `src/features/download.js` (cancels through the signal); `src/app.js` (header, `bindLoadCancel`).
  - **Main process:** `electron/system.js` (new), `electron/main.js`, `electron/preload.js` (`availableMemory`).
  - **Config:** `eslint.config.js` (worker globals).
  - **Tests:** `tests/preload.cjs` (`__workers`; `__slowDecode` also holds back the worker's result; `__nodes.at(-1)`), `tests/e2e/harness.cjs` (the memory handler, `h.memory.available` to fake low memory), `tests/e2e/07-errors.cjs`, `08-video.cjs`, `11-resources.cjs`, `tests/unit/decoding.test.mjs`, `tests/unit/system.test.mjs`.
  - **Diagnostics and docs:** `tests/diagnostics/run.cjs` (more app runs), `docs/diagnostics/long-file-loading.md` ("After the fix"), `README.md`.
- **Verified by:**
  - **Spike:** a module Worker from the `file://` page under the CSP decodes WAV, Opus and AAC; a 44.1 kHz context starts.
  - **Unit tests:** 58 (new: the memory estimate and formatting; the crash handler: OOM, other crash, clean exit; available memory).
  - **End-to-end:** 158 (9 new):
    - the context runs at 44.1 kHz for `tone.wav` and at 48 kHz for the Opus video, and plays at 1×;
    - loading shows "Loading N %" and Cancel;
    - Cancel keeps the file and its settings, with no error and no worker left;
    - a faked low-memory system refuses with the memory message;
    - a video without sound says so;
    - no decode worker is left after the run.
  - **Smoke:** 19.
  - **Packaged:** the full suite passes against the packaged build (the worker loads from `app.asar`).
  - **Diagnostics:** `npm run diagnose:loading` before and after, in the report's "After the fix". One smoke run failed once on "saved theme applied on the next start", then passed three times, also on the previous commit: a timing flake, not this change.

## 2026-10-08: Diagnostic of slow and failing long-file loads

- **What:** a measured report on why opening an hour-long file is slow or fails, with recommendations: `docs/diagnostics/long-file-loading.md`. Also the tools that produced it, so it can be re-run after a fix: `npm run diagnose:loading`. No app behaviour changed.
- **Why:** the user asked why loading a one-hour file takes very long or fails, and wanted a proper diagnostic to base the fix on.
- **Findings** (details and numbers in the report):
  - `decodeAudioData` (in `loadMediaFile`) is 96 % of the load time and peaks at 2.1× the decoded size.
  - Most of that time is resampling from 44.1 to 48 kHz: 14.5 of 24.4 s for a 1-hour MP3.
  - It fails with a generic `EncodingError` on AAC from about 45–60 min and MP3 from about 90–120 min, with gigabytes still free. AAC is what YouTube downloads use, so hour-long downloads and videos don't open.
  - The app then wrongly says the file "isn't an audio file".
  - With 2–3 GB free, the whole app dies with no message.
  - Streaming decode with mediabunny opened every file tested, at about half the peak memory.
- **How:**
  - each measurement runs in a fresh Electron process with the real page and preload;
  - the file goes into the app's file input over the DevTools protocol;
  - memory is sampled from `/proc` every 50 ms;
  - a page heartbeat measures freezes;
  - low-memory machines are simulated with `systemd-run --user --scope -p MemoryMax=…`.
- **Where:**
  - `docs/diagnostics/long-file-loading.md` (the report);
  - `tests/diagnostics/make-long-media.sh` (synthetic long media, into `tests/output/long-media/`), `profile-load.cjs` (one measurement), `run.cjs` (the plan and summary);
  - `package.json` (`diagnose:loading`), `README.md`.
- **Verified by:**
  - the full run: 25 measurements plus 3 threshold runs;
  - `npm run check`.

## 2026-10-08: A new file starts with default sound settings

- **What:** when a file opens, speed, pitch (semitones and cents), volume and the EQ (band gains and On/Off) go back to their defaults, as the A–B loop already did. The step size stays, since it's how you move around rather than how it sounds, and so does the theme. A file that fails to open changes nothing, so the current song keeps its settings.
- **Why:** the user asked for it: settings made for one song (e.g. slowed down to 0.5×) shouldn't carry over to the next.
- **How:**
  - `resetSoundSettings()` in `ui/controls.js` sets every slider in `SLIDERS` to its `range.initial` (from `CONFIG`) through `setSetting`, so the readouts, speed chips and audio all follow, and sets the EQ back to `CONFIG.eq.enabledInitially`.
  - `loadMediaFile` calls it right after the loop is cleared, once the new file has loaded.
- **Where:** `src/ui/controls.js` (`resetSoundSettings`; `SliderSpec.range` now includes `initial`), `src/features/open-file.js` (`loadMediaFile` and its header), `tests/e2e/07-errors.cjs`.
- **Verified by:** `tests/e2e/07-errors.cjs`, 4 new checks:
  - all sound settings and the step size are changed as a user would;
  - a bad file keeps them all;
  - a good file resets speed, pitch, volume and EQ, the step size stays, and the speed slider and 1× chip show the reset.

  All tests pass: 52 unit, 149 end-to-end, 19 smoke.

## 2026-10-08: Three light themes

- **What:** **Catppuccin Latte**, **GitHub Light** and **Gruvbox Light** join Solarized Light in the theme menu, listed after the dark themes. Any of them can be Automatic's light theme: Automatic uses the last light theme chosen.
- **Why:** the user asked for a couple more light themes.
- **How:**
  - **Catppuccin Latte:** Mantle/Base/Crust backgrounds, Mauve accent, Teal loop.
  - **GitHub Light (Primer):** white panels, blue accent, purple loop.
  - **Gruvbox Light:** bg0/bg1, orange accent, blue loop.

  Each is one palette file, mapped onto the roles from the official colours. The contrast tests passed all three except Catppuccin's red, which was a shade too light as error text on its background (4.46:1). It is now `#c80e36` (4.83:1).

- **Where:** `src/themes/palettes/catppuccin-latte.js`, `github-light.js`, `gruvbox-light.js`; `THEMES` in `src/themes/index.js` (now ordered dark, then light); `tests/e2e/10-themes.cjs`; `README.md`.
- **Verified by:**
  - **Unit tests:** 52, all passing; the contrast checks cover every theme.
  - **End-to-end:** 145, with two checks made independent of the theme list:
    - the menu must list every file in `palettes/`, so a theme file missing from `THEMES` fails;
    - Automatic's expected themes are taken from the menu order.
  - **Smoke:** 19.
  - **Screenshots:** `tests/output/theme-*.png`.

## 2026-10-08: Colour themes

- **What:**
  - **Six themes:** TranscriBee (the original look, still the default), Monokai, Dracula, Nord, One Dark and Solarized Light.
  - **Automatic:** follows the system's dark or light mode, using the last dark and the last light theme chosen.
  - **The picker:** a palette button at the right of the top bar (and in the top-right corner of the welcome screen). It opens a menu listing Automatic and each theme with a four-colour swatch (background, panel, accent, loop).
  - **Choosing:** applies the theme at once. The menu stays open so themes can be compared, and ↑/↓, Enter and Escape work.
  - **Remembered:** the choice is restored on the next start without a flash of the old colours.
- **Why:** the user asked for a robust, modular colour-theme system with the classic editor themes.
- **How:**
  - **Themes are data.** One ES module per theme in `src/themes/palettes/`, giving colours for a fixed set of **roles** (`ROLES` in `src/themes/index.js`).
    - **Required roles:** bg, surface, surface2, border, text, muted, accent, accentInk, danger, loop, wave, cursor.
    - **Optional roles** are derived when absent: surfaceHover, accentHover, minimapWave, minimapProgress.
    - **Mapping editor palettes onto roles:** e.g. Dracula: purple accent, cyan loop; Nord: Frost accent, Aurora yellow loop. Each file notes its source.
  - **Independent.** `src/themes/` imports nothing from the app (a lint zone enforces it), and no other code imports a palette. The page's styles keep reading the same CSS variables. The theme only changes their values (`ui/theme.js` sets them on `<html>`, with `color-scheme` and `data-theme`).
  - **Literal colours.** `cssVariables(theme)` turns roles into variables, deriving the optional ones in JavaScript, because the waveform draws on canvases, which can't resolve `var()` or `color-mix()`. The glows, overlays and loop fills in `style.css` are `color-mix()`es of the base tokens, so they follow automatically.
  - **The waveform** gets a generic `refreshColors()`, called by `app.js` on `onThemeChange`. It recolours WaveSurfer with `setOptions()` and replaces the minimap plugin, which copies its options when made and can't be recoloured. Its scrubbing looks the minimap up on each drag, so it keeps working.
  - **Saving and no flash:**
    - `electron/theme-store.js` keeps `theme.json` in the user-data folder and sets the window's background colour from the theme;
    - the main process loads the palettes with `require()` of ES modules (Electron 44 / Node 24; a spike confirmed this, and the packaged build too);
    - the preload asks for the theme synchronously (`sendSync("theme:initial")`) and sets the variables the moment `<html>` exists (a `MutationObserver`; `<html>` doesn't exist yet when a preload runs). That's before any page CSS or script runs.
    - Outside Electron, `localStorage` is used instead.
  - **Robustness:**
    - unknown, removed or mismatched theme ids fall back to the defaults (`normalizePrefs`);
    - an unreadable `theme.json` means the defaults;
    - the `theme:initial` handler always answers, even if something inside it fails. Found while testing: a missing answer makes `sendSync` wait forever, so the handler must be registered before any window exists.
  - **Contrast was checked, and fixed where needed.** The unit tests require, for every theme:
    - text ≥ 4.5:1 on every background;
    - muted labels, error text and the cursor ≥ 4.5:1;
    - accent and loop ≥ 3:1;
    - the unplayed waveform ≥ 1.5:1;
    - the loop clearly different from the accent.

    They caught dim error text in Monokai, Nord and One Dark, Nord's green loop being too close to its blue accent, and Solarized Light's muted text and cyan accent; those shades were adjusted, keeping each palette's hues.

  - A unit test also keeps the `:root` fallback in `style.css` equal to the TranscriBee theme.
- **Where:**
  - `src/themes/` (`index.js`, `palettes/*.js`), `src/ui/theme.js`, `src/features/theme-picker.js`, `src/app.js` (first statement, the waveform wiring, `bindThemePicker`, the shortcut blocker);
  - `src/waveform.js` (`refreshColors`, `minimapOptions`, `waveColors`);
  - `electron/theme-store.js`, `electron/main.js`, `electron/preload.js`;
  - `index.html` (the palette buttons, `#themeMenu`); `style.css` §4 "Colour-theme menu";
  - `eslint.config.js` (the themes zone; browser globals for the preload).
- **Verified by:**
  - **Unit tests:** `tests/unit/themes.test.mjs`, 15 checks (49 unit tests in all).
  - **E2E:** `tests/e2e/10-themes.cjs`, 16 checks:
    - the menu, keyboard and Escape;
    - shortcuts blocked while it's open;
    - Nord's variables on the page;
    - both waveform canvases checked pixel by pixel for the theme's colours;
    - the minimap overlay intact;
    - the choice saved;
    - Automatic under an emulated system mode;
    - a screenshot per theme in `tests/output/theme-*.png`.
  - **Smoke test:** a saved theme is applied on the next start of the real app.
  - **Totals:** 145 end-to-end and 19 smoke checks pass, on the project and on a packaged Linux build.

## 2026-10-08: Modules (ready for large changes)

A structural refactor with no behaviour change: the code is split into files with enforced layers, and gains fast unit tests.

- **What:** nothing the user can see changes. For whoever works on the code:
  - `script.js` (2,739 lines) is now 21 modules in `src/`;
  - the main process lives in `electron/`;
  - `npm test` starts with 34 unit tests that run in plain Node in about a second;
  - the end-to-end tests are split into a harness plus 11 topic files.
- **Why:** to make large changes safer and easier. A single file of numbered sections had no boundaries, so any part could reach any other. And every test had to start Electron.
- **How:**
  - **No build step.** The page was already an ES module, so the split uses plain `import`s from `file://`, as before.
    - `src/package.json` (`"type": "module"`) lets Node's test runner import the same files.
    - The library imports keep their `node_modules` paths, adjusted for depth.
  - **Layers.** A file in `src/` only imports from the layers above it: `core` → `config` → `audio` / `video` / `waveform` → `context` → `ui` → `features` → `app.js`. `eslint-plugin-import-x` enforces this (`no-restricted-paths`) and forbids import cycles (`no-cycle`). It was checked with deliberately wrong imports.
  - **Shared state** lives in `context.js`: `settings`, and `player`, the components that `app.js` creates and puts there before anything binds.
  - **Callbacks across layers** are wired in `app.js`: engine errors, waveform loop drags, video notices. So the components never import the UI.
  - **Small moves so the layering holds:**
    - `peaksPerSecondFor` and `isVideoFile` take their `CONFIG` values as arguments, so `core/` imports nothing outside itself;
    - the `Loop` and `LoopRegion` types join `Segment` in `core/timeline.js`;
    - `bindControls` became `bindTransportButtons` (`features/playback.js`) and `bindSettingControls` (`ui/controls.js`);
    - the `SHORTCUTS` table moved to `app.js`, while the key handling stays in `ui/shortcuts.js` (`bindShortcuts(shortcuts, isBlocked)`);
    - the `returnPoint` listeners moved into `bindPlayback()`;
    - `window-state.js` came out of `main.js`.
  - **Unit tests** (`tests/unit/*.test.mjs`, `node:test`):
    - `core/`: formatting, peaks, timeline and loop maths, emitter, file types;
    - the transport against a fake engine and clock: speed, pausing at what was heard, seeking, the end of the track, the loop rules;
    - the downloader's link checks, failure messages and file names.

    A mutation check showed they catch real breakage: breaking the loop-end rule, then the heard-position pause, each failed exactly the matching test.

  - **End-to-end tests:** `tests/e2e/harness.cjs` holds the setup and helpers; `01-static-ui.cjs` … `11-security.cjs` run in the same order and window as before, and `tests/run.cjs` is a short runner. The check names and order are identical (compared by script).
  - The architecture comment moved to the top of `src/app.js`, with a file map in place of the section list. The table at the top of this file maps the old `§` sections to files.
- **Where:**
  - `src/**`, `electron/**`, `index.html` (loads `src/app.js`);
  - `package.json` (`main`, `build.files`, `test:unit`), `jsconfig.json`, `eslint.config.js`;
  - `tests/unit/`, `tests/e2e/`, `tests/run.cjs`, `tests/launch.cjs`;
  - `README.md`, `style.css` (two comments).
- **Verified by:**
  - after every step (8 commits), `npm run check` and `npm test`: 34 unit + 129 end-to-end + 16 smoke checks;
  - the full suite against a packaged Linux build.

## 2026-10-08: Download from YouTube

- **What:**
  - **Where to start a download:** a **From YouTube…** button on the welcome screen and in the top bar, or pasting a link anywhere outside a text field.
  - **The dialog:** a field for the link, an **Audio / Video (up to 1080p)** choice, which is remembered for the session, and **Download**.
  - **While it downloads:** the loading screen (first file) or the overlay (later files) shows the stage and the video's title.
    - **Stages:** "Setting up the downloader (first time only)… 42 %", "Updating the downloader…", "Downloading… 42 % · 0:12 left" (for video: "the picture", then "the sound"), "Joining picture and sound…".
    - **Cancel** stops the download and returns to what was open, with no error and no files left behind.
  - **The result:** saved to `~/Downloads/TranscriBee/` as "Title [video id].m4a" (or `.mp4`, `.ogg`) and opened like any other file. A notice says where it was saved.
  - **A playlist or search page** downloads only its first video.
  - **Errors:** no internet connection, a private or unavailable video, YouTube refusing the stream (HTTP 403) and links that aren't videos are explained in the usual red error line. Whatever was open stays open.
- **Why:** to get a song into TranscriBee straight from its YouTube link.
- **How:**
  - **Choosing yt-dlp.** Pure-JS libraries (ytdl-core and its forks) break whenever YouTube changes, and web APIs (Cobalt, RapidAPI) add a third party that can vanish or log downloads. yt-dlp is the standard tool and gets fixes within days.
  - **The page never touches the network.** It stays sandboxed under its CSP. `preload.js` exposes only `window.transcribee` (`download`, `cancelDownload`, `onDownloadProgress`). `downloader.js`, in the main process, does the work, and the file returns to the page as bytes over IPC.
  - **yt-dlp itself:**
    - downloaded on first use from its GitHub releases into `<userData>/bin` (about 40 MB) and checked against the release's `SHA2-256SUMS`;
    - updated with `yt-dlp -U` at most once a day; a failed update keeps the old copy;
    - fetches abort on Cancel and after 30 s without data.
  - **JavaScript runtime.** YouTube now needs yt-dlp to have one. TranscriBee hands it **Electron's own binary** (`--js-runtimes node:<execPath>`, with `ELECTRON_RUN_AS_NODE=1`), so nothing else needs installing. This was confirmed in a spike and in the packaged build.
  - **No ffmpeg.**
    - Video is downloaded as two files (`-f "bv[vcodec^=avc1][height<=1080]/…,ba[ext=m4a]/ba"`) and joined by **Mediabunny** in Node, copying packets without re-encoding.
    - Audio is rewritten the same way, because YouTube's `.m4a` is a fragmented "DASH" file that not every player opens.
    - `--fixup never` makes the result the same whether or not ffmpeg is installed.
  - **Safety:**
    - only `http(s)` links are accepted, and the link goes after `--`, so it can never be read as an option;
    - `--playlist-items 1`, plus stopping yt-dlp if a second video's title appears;
    - one download at a time;
    - yt-dlp runs in its own process group, so Cancel stops all of it (`taskkill /T` on Windows);
    - work folders in the temp directory are removed afterwards, and ones a killed app left behind are removed after a day.
  - **HTTP 403.** YouTube sometimes refuses a stream link. The download is retried once with a fresh yt-dlp run, which gets new links.
  - **Progress.** yt-dlp prints tagged lines (`--print before_dl:[tb-title] …`, `after_move:[tb-file] …`, `--progress-template download:[tb-progress] …`). `downloader.js` parses them into `{ stage, part, parts, fraction, eta, title }`.
- **Where:**
  - `downloader.js` (`createDownloader`, `handleDownloads`) and `preload.js`; `main.js` registers the handlers and sets the preload;
  - `script.js`:
    - §9: `setLoading(name)`, `setLoadingStatus`, and the new elements in `dom`;
    - §11: `withLoading` (shared with `openFile`), `downloadLink`, `describeDownload`, `openDownloadDialog`, `bindDownloads`; `loadMediaFile` now returns its notices instead of showing them;
    - §13: no shortcuts while the dialog is open;
  - `index.html`: the buttons, `#downloadDialog`, and a status, Cancel and title line on the loading screen and overlay; `style.css` §4: "Download dialog";
  - `package.json` `build.files`; `eslint.config.js`.
- **Found by real use (fixed):**
  - a YouTube search link downloaded every result (fixed with `--playlist-items 1`);
  - a GitHub fetch that never answered left setup stuck at 0 % with Cancel unable to stop it;
  - a "no network" message on Linux ("Temporary failure in name resolution") wasn't recognised.
- **Verified by:**
  - **Offline tests:** `npm test`, 129 + 16 checks. `tests/fake-yt-dlp.cjs` stands in for yt-dlp and serves two new fixtures shaped like YouTube's (a fragmented AAC `.m4a`, a video-only VP9 `.webm`). `run.cjs` drives the real `preload.js` and `downloader.js` through:
    - the dialog, refusing a non-link, Escape, and pasting;
    - audio and video downloads that open, play and show a picture;
    - the saved files and the "saved as" notice;
    - private, offline and 403 errors, and a one-off 403 being retried;
    - Cancel with no files or temp folders left;
    - the title on the overlay.

    The smoke test checks that the real app exposes the bridge.

  - **Real network:**
    - first-use setup, the daily update, audio and video downloads, a search link, Cancel during setup and during download, and no stray processes afterwards;
    - downloaded H.264/AAC files open in the app with picture, waveform and full length;
    - the packaged Linux build does the same.

## 2026-10-08: Tidy-up

A general clean-up after the feature rounds, done in phases. Each phase leaves the tests green and is its own git commit. Apart from the items marked as deliberate changes, nothing should behave differently.

### Phase 1: Git and tests in the repository

- **What:**
  - **Git.** The project is under git, with a baseline commit of the state before any cleanup.
  - **Tests.** The end-to-end test suite (99 checks) now lives in `tests/` and runs with `npm test`. It used to live in a temporary folder outside the project.
- **Why:** a safety net before cleaning up: every change can be diffed and reverted, and every phase can be re-tested.
- **How:**
  - `.gitignore` excludes `node_modules/`, `dist/`, the generated test media and screenshots, and local assistant settings.
  - `tests/launch.cjs`:
    - generates the test media if it's missing (`tests/make-fixtures.sh`, using ffmpeg; about 6 MB, so not committed);
    - removes `ELECTRON_RUN_AS_NODE`, which VS Code's terminal sets and which would make Electron run as plain Node;
    - runs `tests/run.cjs` in Electron with a throwaway profile.
  - The header of `run.cjs` explains how the suite works: an offscreen window at 60 fps, real input events, focus emulation, the instrumentation in `preload.cjs`, all network requests blocked. It also says that a display server is required and how to add a check.
  - `TB_APP_PATH` lets the suite test another copy of the app, such as a packaged build.
- **Where:** `.gitignore`; `tests/` (`launch.cjs`, `run.cjs`, `preload.cjs`, `make-fixtures.sh`); the `test` and `test:fixtures` scripts in `package.json`.
- **Verified by:** `npm test` from a clean checkout generates the media and passes 99/99.

### Phase 2: Leftovers removed, package metadata filled in

- **What:**
  - **Deleted:** `dist/`, a 100 MB Windows build from Sep 26 that predates almost every feature, and the empty `transcribee_prototype.code-workspace`.
  - **`package.json` now describes the real app:**
    - name `transcribee`, product name `TranscriBee`, app ID `com.transcribee.app`;
    - a description, keywords, the author, and `private: true`;
    - the placeholder `test` script is gone, and the scripts are grouped (start, test, build).
- **Why:** leftovers mislead (an old `.exe` looks like a current build), and the metadata ends up in the packaged app.
- **Note:** because the product name changed, Electron keeps its profile folder (cache and the like) under a new name. The app stores no user data there, so nothing is lost.
- **Where:** `package.json`, `package-lock.json`.
- **Verified by:** `npm test`, 99/99.

### Phase 3: Formatter, linter, type checking

- **What:** code-quality tooling, with no build step:
  - `npm run format` (Prettier) and `npm run lint` (ESLint);
  - `npm run typecheck` (TypeScript checking `script.js` from its JSDoc);
  - `npm run check`, which runs all three.

  Prettier has been run once over every file.

- **Why:** style stays uniform without effort, and mistakes such as unused variables, typos in property names and wrong argument types are caught before running the app.
- **How:**
  - **Prettier** (`.prettierrc.json`) matches the existing style: 2 spaces, double quotes, 120 columns, trailing commas. So the one-off reformat changed little in `script.js`, mostly indentation in `index.html`, and moved `main.js` from 4 to 2 spaces.
  - **ESLint** (`eslint.config.js`) uses the recommended rules with browser globals for `script.js` and Node globals for `main.js` and `tests/`. It checks for mistakes only; style is left to Prettier.
  - **TypeScript** (`jsconfig.json`, plus `// @ts-check` at the top of `script.js`) checks only the app's own code. `maxNodeModuleJsDepth: 0` keeps it from type-checking the libraries' JavaScript: without it, over 300 errors came from Mediabunny and Signalsmith internals.
  - **Test fix:** the step-button test now trims text, because the reformatted markup puts the arrow icons on their own lines. The whitespace doesn't render.
- **Where:** `.prettierrc.json`, `.prettierignore`, `eslint.config.js`, `jsconfig.json`, and the new scripts in `package.json`. The dev dependencies are `prettier`, `eslint`, `@eslint/js`, `globals` and `typescript`.
- **Verified by:** `format:check` and `lint` are clean; `npm test` passes 99/99. Ten type errors in the app's code remain, and Phase 4 fixes them.

### Phase 4: Code audit, consistent naming, JSDoc types

- **What:** `script.js` was read end to end and cleaned up, with no behaviour change. It now type-checks cleanly.
- **Why:** after many feature rounds some comments had drifted, a few pieces were unused, and names didn't match the UI. Types document the shapes that get passed around and catch mistakes.
- **How:**
  - **Naming: "skip" is now "step" everywhere,** matching the UI ("Step 1 s", "Step back"):
    - `CONFIG.step.sizes`, `settings.stepSize`, `step()` / `stepBack()` / `stepForward()`, `changeStepSize()`, `renderStepSize()`, `formatStepSize()`;
    - element ids `#stepBack`, `#stepForward`, `#stepSize`, and the class `.step-size`.
  - **Removed unused API:** `videoView.hasVideo`, `videoView.proxyFrameCount` (with the proxy's `frameCount`), and the `transport.loop` getter.
  - **Comments fixed:**
    - a sentence broken across lines in the §7 header;
    - an oddly wrapped §6 header;
    - a stale mention of the removed empty-waveform hint;
    - a drag-state comment that listed a field that doesn't exist.
  - **Duplication:** converting a track time to a pointer x is now one helper, `clientXAt`, next to `timeAtClientX`. Loop-edge grabbing and zoom anchoring both use it.
  - **Consistency:**
    - `$` is defined at the start of §8 and used for the instances too (they had used `document.getElementById`);
    - `changeStepSize` moved out from between the two reset functions;
    - the play-while-held code moved ahead of the A–B loop block;
    - the button bindings use a small `onClick(element, handler)` helper.
  - **JSDoc types:**
    - typedefs for `Segment`, `TransportState`, `Loop`, `LoopRegion`, `SliderSpec` and `Shortcut`;
    - `AudioEngine`, `Transport`, `Waveform` and `VideoView`, defined as the return types of their factories;
    - parameter types on the factories and the main functions;
    - element casts where specific element properties are used (inputs, buttons, the canvas).
  - **Real fix found by the type checker:** the proxy's codec probe fell back to `{}` on error and then read `.supported` from it. It now falls back to `{ supported: false }`. The behaviour was the same, since `undefined` is falsy, but the intent is now explicit.
- **Where:** `script.js` (every section), `index.html` (step ids), `style.css` (`.step-size`), `tests/run.cjs` (step ids).
- **Verified by:** `npm run check` is clean (format, lint, 0 type errors); `npm test` passes 99/99.

### Phase 5: Error paths and resource cleanup

- **What:**
  - **Deliberate change:** if part of a video can't be decoded during use, a notice now says so ("…the picture may stop updating. The audio is unaffected."), once per file. Before, the picture just froze, with only a console warning.
  - **Small fix:** the video view's pending "head start" timer is now cancelled when a file is closed or replaced. It was harmless before, but it was left running.
  - **New tests** for leaks and unhandled errors.
- **Why:** to make sure every failure either reaches the user or is clearly harmless, and that opening file after file doesn't leak decoders.
- **Review findings** (no change needed):
  - **Opening a new file releases the old one:** the decode cursor and its frames, the proxy's encoder and decoder and its encoded chunks, the Mediabunny input, the Signalsmith buffers (`dropBuffers`), and the transport's timer and animation frame.
  - **Every other `console.warn` is either reported another way or harmless:**
    - an unreadable video becomes the "picture can't be shown" notice;
    - a waveform failure becomes the "waveform couldn't be drawn" notice;
    - a warm-up failure is retried, and reported if the file load then fails;
    - a proxy failure only makes seeking slower.
  - The policy is written in the §7 header.
- **How:**
  - `createVideoView` takes an `onProblem(message)` callback, wired to `showNotice` in §8.
  - `reset()` clears `heldRun` and `sharpHeldUntil`. `heldRun` moved up to the view's other state variables.
- **Test instrumentation** (`tests/preload.cjs`):
  - counts live `VideoDecoder` / `VideoEncoder` objects (created minus closed, or failed);
  - records unhandled promise rejections, uncaught errors and Content-Security-Policy violations.
- **Where:** `script.js` §7 (header, `createVideoView`, `reset`, `run`) and §8; `tests/preload.cjs`; `tests/run.cjs`.
- **Verified by:** 3 new checks, 102 in total, all passing:
  - opening the video three times in a row keeps exactly 1 live codec each time;
  - switching to an audio file leaves 0;
  - the whole run produces no unhandled error, rejection or CSP violation.

### Phase 6: Stylesheet tidy, smaller logo, app icon

- **What:**
  - **The page looks the same.** `style.css` was reorganised: its sections now follow the page, and colours that were written out by hand are tokens.
  - **Smaller logo:** 33 KB instead of 560 KB.
  - **App icon:** the bee is now the window and taskbar icon, and the packaged app's icon, instead of Electron's default.
- **Why:** the stylesheet had grown feature by feature: the screens came last, colour values were repeated, and six separate `[hidden]` overrides existed. The logo file was 865 px wide and shown at 150 px at most.
- **How:**
  - **Section order:** tokens → base → controls → screens (welcome, loading screen, overlay, loader bars) → player (top bar, stage, transport, panels, EQ, shortcuts). A table of contents sits at the top of the file.
  - **Derived colours:** amber glows, loop fills and the overlay background are computed from the base tokens with `color-mix()` (`--screen-glow`, `--aura-core`, `--aura-mid`, `--aura-shadow`, `--overlay-bg`, …). `--wave-progress` and `--loop-edge-off` reference `--accent` and `--muted` instead of repeating their values. Changing `--accent` now recolours every glow.
  - **One `[hidden] { display: none !important }` rule** in Base replaces the six per-element overrides. They were needed because elements set their own `display`.
  - **Comments:** the stale "the one animation in the app" comment is fixed; the two animations are labelled "1 of 2" and "2 of 2".
  - **Images:**
    - the original moved to `assets/transcribee-source.png` and is kept as the master;
    - `scripts/make-images.py` (Pillow) generates `assets/logo.webp` (300 px, 33 KB: WebP keeps the soft glow far smaller than PNG), `assets/icon-512.png` and `assets/icon.ico`;
    - the page uses `logo.webp` for all three logos;
    - `main.js` sets the window icon; `package.json` sets `build.icon` and `build.win.icon`.
- **Where:** `style.css`, `index.html` (image paths), `main.js` (`icon`), `package.json` (`build.icon`), `assets/`, `scripts/make-images.py`.
- **Verified by:**
  - `npm run check` is clean; `npm test` passes 102/102.
  - Screenshots compared pixel by pixel before and after (welcome, error, drag, loading, player, loop): the only differences are inside the logo, from the resampled image. The video screenshot differs only by which frame was captured.

### Phase 7: Electron hardening, window niceties, packaged build

- **What:**
  - **Security:**
    - the page has a Content-Security-Policy and runs sandboxed;
    - it can't navigate away or open other windows;
    - Electron's "Insecure Content-Security-Policy" console warning is gone.
  - **Window:**
    - the title names the open file ("TranscriBee — song.mp3");
    - the window can't be made smaller than 900 × 640;
    - it remembers its size, position and maximised state between runs;
    - it opens with the app's dark background instead of a white flash.
  - **Packaging:**
    - `npm run build:dir` (unpacked Linux build) and `npm run build:linux` (AppImage) join `build:win`;
    - the package ships only what the app needs.
- **Why:**
  - Electron's defaults allow far more than this app uses.
  - The window niceties were requested.
  - No packaged build had been checked since the app started loading its libraries from `./node_modules` paths, which must work from inside the app archive.
- **How:**
  - **CSP** (a `<meta>` in `index.html`): only the app's own files may load. The exceptions are commented in place, each needed by a library:
    - `blob:` scripts and workers: Signalsmith's audio worklet and Mediabunny's workers are created from Blob URLs;
    - `'wasm-unsafe-eval'`: Signalsmith is WebAssembly;
    - inline styles: WaveSurfer writes `<style>` into its shadow DOM.
  - **`main.js`:** `sandbox: true`; `will-navigate` is always prevented; `setWindowOpenHandler` denies.
  - **Window state:** stored in `window-state.json` in the user-data folder.
    - On load, it's ignored if malformed or if the saved position doesn't overlap a connected display by at least 100 px (a monitor unplugged since), and it's raised to the minimum size.
    - It's written in the window's `closed` event, from bounds remembered on every resize, move or maximise. The `close` event alone turned out not to fire when the page itself closes the window, which the smoke test caught.
  - **Title:** `loadMediaFile` sets `document.title`, which Electron uses as the window title.
  - **Build:**
    - `build.files` lists the app files and the two images. The runtime libraries are added by electron-builder, so the archive is 12.7 MB, with no tests, change log or dev tools.
    - Linux targets AppImage with the executable `transcribee`; Windows stays portable, with `icon.ico`.
- **New test, `tests/smoke.cjs`:** it starts the real app (main.js included, which `run.cjs` never exercises) and drives it over the Chrome DevTools Protocol, using Node's built-in WebSocket. It checks:
  - the title;
  - that the CSP blocks an injected inline script (DevTools' own evaluation is exempt, so it can't be probed with `eval`);
  - that pop-ups and navigation are blocked;
  - that the state is saved on close;
  - restore, an off-screen position, the minimum size and a corrupt state file.

  Under tiling window managers (i3, sway), which size every window themselves, the size assertions are reported as SKIP and only a clean start is checked.

- **`run.cjs`** now uses a sandboxed window like the app. It checks that the CSP is in force (eval is blocked), that no Electron security warnings appear, and the window title. It passes dropped-file bytes from Node instead of fetching a `file://` URL, which the CSP rightly blocks.
- **Packaged-build testing:** `TB_APP_PATH=<…>/resources/app.asar TB_APP_BINARY=<…>/transcribee npm test` runs both suites against a build.
- **Where:** `main.js`, `index.html` (CSP), `script.js` §11 (title), `package.json` (`build`, the build scripts), `tests/smoke.cjs`, `tests/run.cjs`, `tests/launch.cjs`.
- **Verified by:**
  - In the project: `npm test` gives 105/105 plus 15/15 in the smoke test.
  - Against the unpacked Linux build (`npm run build:dir`): also 105/105 and 15/15, with fonts, WaveSurfer, Mediabunny, Signalsmith, video and the window state all working from inside `app.asar`.
  - On this machine (i3) the window-size assertions are skipped.
  - The Windows build wasn't built or run here.

### Phase 8: README

- **What:** a `README.md`. It covers:
  - what the app does;
  - requirements (Node 22+; ffmpeg and a display server for the tests; Pillow for the image script);
  - every npm command, and how to test a packaged build;
  - the file layout;
  - pointers to the `script.js` header and this change log.

  This log's file list is updated for `assets/`, `scripts/` and `tests/`.

- **Why:** there was no entry point for someone opening the project for the first time.
- **Where:** `README.md`, the header of `CHANGELOG.md`.

---

## 2026-10-08: Loading screen and stronger aura

### Stronger aura behind the logo

- **What:** the amber glow behind the bee on the welcome screen is clearly stronger.
- **Why:** the user asked for a more intense "aura".
- **How:**
  - A `.logo-aura` wrapper draws a radial glow in its `::before`: 35% alpha at the centre, out to about 2.2× the logo size.
  - The logo also gets an amber `drop-shadow`, so the glow hugs the bee's outline.
  - The page-wide background glow went from 10% to 14% alpha.
  - The same wrapper is used on the loading screen.
- **Where:** `index.html` (`.logo-aura` around both logos), `style.css` (`.logo-aura`, `.welcome-logo`, `.welcome`).

### A loading screen for the first file

- **What:**
  - **First file:** opening a file from the welcome screen swaps it for a full loading screen. It shows the bee with a **pulsing aura**, the animated equalizer bars with "Loading", and the file name.
    - If the file fails, the welcome screen comes back with the error and the Open button focused.
    - If it loads, the player appears.
  - **Later files,** opened from inside the player, keep the translucent overlay over the player (the user's choice).
- **Why:** the user didn't want an overlay over the welcome screen; loading should feel like its own screen.
- **How:**
  - **One function.** `setLoading(file)` / `setLoading(null)` replaces `setLoadingVisible`. It picks the screen form while the player has never been shown (`dom.app.hidden`), and the overlay otherwise.
  - **The player loads underneath.** During the first load, `showPlayer()` still runs before the waveform draws, because WaveSurfer measures its container when drawing. The player is therefore laid out under the opaque, fixed-position loading screen, which keeps it out of sight until `setLoading(null)` removes the screen.
  - **Errors** go to the welcome screen through `showMessage`'s existing routing (the player is still hidden), and `setLoading(null)` restores the welcome screen.
  - **Animation.** The pulse animates only `opacity` and `transform`, over 1.8 s. It is the second exception to the app's no-animations rule, after the loader bars. Like them, it needs `!important` to beat the global `animation: none !important`, and it is turned off under `prefers-reduced-motion`.
- **Where:**
  - `index.html`: `#loadingScreen`.
  - `style.css`: the "Loading screen (first file)" block, `@keyframes aura-pulse`, the reduced-motion rule.
  - `script.js`: §9 `setLoading`, `dom.loadingScreen`, `dom.loadingFileName`; §11 `openFile`; the header comment.
- **Verified by:** 6 new end-to-end checks, using an opt-in slowed decode in the test harness so the mid-load state can be observed. 99 checks in total, all passing:
  - the loading screen replaces the welcome screen, with no overlay;
  - it shows the file name and the aura pulses;
  - a failed first load returns to the welcome screen with the Open button focused;
  - a later load from the player uses the overlay, not the screen.
  - Screenshots compare the aura before and after, and show the loading screen.

---

## 2026-10-08: Welcome screen

- **What:**
  - Until a file is loaded, the window shows a welcome screen instead of an empty player. It has:
    - the bee logo over a soft amber glow;
    - the large "TranscriBee" wordmark and a tagline;
    - a dashed drop zone with an **Open audio or video…** button, "or drop a file anywhere in this window", and the main supported formats.
  - **Opening a file:**
    - The Open button has focus at startup, so Enter or Space opens the file chooser.
    - Dragging a file over the window turns the drop zone amber.
  - **Errors:** if the first file fails to load, the error appears under the drop zone and the welcome screen stays.
  - **After the first successful load,** the player replaces the welcome screen for the rest of the session. Later files are opened from the top bar, as before.
- **Why:** the user asked for a decent-looking start screen instead of a player full of disabled controls with nothing loaded.
- **How:**
  - `#welcome` and `#app` are sibling screens, and `#app` starts `hidden`. `showPlayer()` swaps them, once.
  - **Order matters:** `showPlayer()` is called in `loadMediaFile` right after the new file has decoded, _before_ the waveform draws. WaveSurfer measures its container when it draws, and a hidden container measures 0 px wide. This is the same reason the video layout switch happens before drawing.
  - **Messages:** `showMessage()` writes to whichever screen's message line is visible, so `reportError`, `showNotice` and `clearMessage` work unchanged on both screens.
  - **While loading,** both screens are made `inert` under the loading overlay.
  - **Shared file input:** the welcome button calls `click()` on the existing hidden file input, so there is only one.
  - **Drag state:** the `dragging` class moved from `#app` to `body`, so both screens can react to it.
  - **CSS:** both screens set `display: grid`, which overrides the `hidden` attribute, so `.app[hidden]` and `.welcome[hidden]` restore `display: none`.
  - **Markup:** the player's `#stage` changed from `<main>` to `<div>`, so the page has one `<main>` landmark (the welcome screen).
- **Removed:** the old empty-waveform hint (`.waveform:empty::before`), which the welcome screen replaces.
- **Where:**
  - `index.html`: `#welcome`, and `#app` starting `hidden`.
  - `style.css`: the "Welcome screen" block, the `[hidden]` override and `body.dragging`.
  - `script.js`: §9 `dom.welcome*`, `showMessage`, `setLoadingVisible`, `showPlayer`; §11 `loadMediaFile`, `bindFileInput`, `bindFileDrop`; §14 `start` (focus); the header comment.
- **Verified by:** 11 new end-to-end checks, 93 in total, all passing:
  - the welcome screen shows at startup, with the logo loaded and the Open button focused;
  - the button opens the file chooser;
  - a bad first file stays on the welcome screen with a red error;
  - dragging highlights the drop zone, and leaving clears it;
  - a dropped file opens the player;
  - the waveform is drawn at full width (1166 px wrapper in a 1166 px container);
  - the welcome error doesn't carry over into the player.

---

## 2026-10-08: Bee logo after the title

- **What:** the bee logo (`transcribee.png`) sits to the right of the "TranscriBee" wordmark in the top bar. It was first placed on the left, then moved at the user's request.
- **Why:** the user asked for it.
- **How:**
  - The `.brand` element is now a flex row holding the image and the wordmark.
  - The logo is drawn at 40 × 40 px with `object-fit: contain`.
  - A negative vertical margin lets its soft glow overhang a little without making the top bar taller.
  - `alt=""`, because the wordmark next to it already names the app.
- **Where:** `index.html` (`.brand`, `.brand-logo`) and `style.css` (`.brand`, `.brand-logo`).
- **Verified by:** a screenshot of the top bar; the 82 existing checks still pass.

---

## 2026-10-08: Deeper zoom (16× → 32×)

- **What:** Ctrl + wheel can zoom in twice as far as before: 32× the fit-to-width view instead of 16×.
- **Why:** the user wanted more detail for finding exact note onsets.
- **How:**
  - One number changed: `CONFIG.waveform.maxZoomMultiplier`.
  - The waveform's peak resolution is derived from it (`peaksPerSecondFor`: 2 peaks per device pixel at maximum zoom), so the drawing stays sharp at the new depth. It is still capped at `maxPeaksPerSecond` (8000/s), which only limits very short clips.
  - Long tracks need far fewer peaks per second, so memory stays small. For example, a 10-minute song on a 4K-wide screen needs about 410 peaks per second.
- **Where:** §1 `CONFIG.waveform.maxZoomMultiplier`.
- **Verified by:** a new check that zooming all the way in reaches exactly 32× fit and zooming all the way out returns to fit. 82 checks in total, all passing.

---

## 2026-10-08: Arrow icons on the step buttons

- **What:** the step-back and step-forward buttons show ← / → arrow icons instead of the interval (e.g. "−0.25s"). The interval is shown only in the "Step … s" readout next to them. The hover titles name the arrow keys.
- **Why:** the user asked for it. The interval was shown twice, and the button width jumped as the label changed.
- **How:**
  - The icons are inline SVG in `index.html`. They use `stroke="currentColor"`, so they follow the button's text colour, including the disabled state.
  - The buttons have an `aria-label` ("Step back" / "Step forward"), since they have no text.
  - `renderSkipStep()` now updates only the readout.
- **Where:** `index.html` (`#skipBack`, `#skipForward`), `style.css` (`button .icon`), §9 `renderSkipStep`.
- **Verified by:** the step checks now expect icon buttons with no text. 81 checks in total, all passing.

---

## 2026-10-08: Wheel scrolls, Ctrl + wheel zooms

- **What:** the mouse wheel now scrolls the waveform sideways, and Ctrl + wheel zooms at the mouse. This swaps the earlier mapping. A touchpad's sideways swipe also scrolls, and a pinch zooms, because Chromium reports a pinch as Ctrl + wheel.
- **Why:** the user asked for it. Moving through the song is the more frequent action, so it gets the plain wheel.
- **How:** both the scroll and the zoom pause following during playback, as described in the next entry. Plain-wheel scrolling uses `deltaY`, or `deltaX` when that is zero.
- **Where:** §6 `bindWheelZoom`, the §6 header comment, and the comment on `CONFIG.waveform.maxZoomMultiplier`.
- **Verified by:** the zoom checks now use Ctrl + wheel. A new check confirms a plain wheel scrolls without changing the zoom. 81 checks in total, all passing.

---

## 2026-10-08: Zoom where the mouse is

### Wheel zoom keeps the spot under the mouse in place

- **What:**
  - **Zoom:** zooming in or out with the mouse wheel keeps the moment under the pointer where it is, so you can zoom straight into the bar you're pointing at. Before, the zoom stayed centred on the playback cursor.
  - **While playing:** after you zoom or scroll by hand (wheel zoom, Ctrl+wheel, dragging the minimap), the view stays where you put it. So you can look ahead at the bar that's coming up.
  - **When following resumes:**
    - when the playing cursor comes back into view (from then on, the view pages along with it as usual);
    - after a deliberate move of the playhead: click, arrow step, step button, Space replay or loop wrap.
- **Why:** the user asked for zoom at the mouse position. The rule for following during playback was their choice: stay until the cursor arrives.
- **How:**
  - **Anchoring.** WaveSurfer's `zoom()` re-renders synchronously and shifts the scroll to keep its _progress cursor_ in place. So `zoomBy` reads the time under the pointer first, zooms, then corrects the scroll so that time is back under the pointer. It measures the wrapper after the re-render, so WaveSurfer's own shift is already accounted for.
  - **Repeated wheel steps.** Scroll positions are whole pixels, so re-reading the anchor after every step would drift about half a pixel each time. While the pointer stays put, `zoomAnchor` keeps the original time across steps. A new pointer x, or a view that has moved by more than 2 px, takes a new anchor.
  - **WaveSurfer auto-scroll is now off** (`autoScroll: false`, `autoCenter: false`). WaveSurfer scrolled to its cursor on every `setTime()` whenever the cursor was off-screen. That silently overrode the app's own `follow()`, so a view moved away from the cursor snapped straight back. Following is now done only by `follow()`.
  - **Pausing.** `followPaused` is set on a hand zoom or scroll, cleared in `follow()` once the cursor is visible, and cleared by `resumeFollow()`, which §8 calls on every transport `"jump"`.
- **Where:**
  - §6 `createWaveform`: the WaveSurfer options, `zoomBy`, `zoomAnchor`, `bindWheelZoom`, `bindMinimapScrubbing` (end of a drag), `follow`, `resumeFollow`.
  - §8: the `"jump"` listener.
- **Verified by:** 12 new end-to-end checks with real wheel events, 80 in total, all passing:
  - the anchor stays within 1 px over 5 zoom-in steps (worst 0.48 px) and 4 zoom-out steps (worst 0.34 px);
  - zooming all the way out returns to fit-to-width;
  - zooming at the left edge works;
  - zooming at 15 s with the cursor at 2 s stays at 15 s;
  - during playback the view holds after zooming away, a step brings it back, and a look-ahead view holds until the cursor arrives, then pages on;
  - Ctrl+wheel also pauses following.

---

## 2026-10-08: Arrow-key stepping

### ← / → move the cursor by a step; ↑ / ↓ change the step

- **What:**
  - **← / →** move the cursor back or forward by the current step. Holding a key repeats it, which works as rewind or fast-forward.
  - **↑ / ↓** pick a larger or smaller step from 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5 and 10 s. The default is 1 s, and the step stops at either end of the list. Holding ↑ / ↓ changes the step only once.
  - **Display:** the transport bar shows "Step 0.25 s", and the step buttons relabel to match (−0.25s / +0.25s).
  - **R / C are removed;** the arrows replace them.
  - A step is a seek, so everything that follows seeks applies: the video, the loop (stepping past B while looping lands at A) and Space replay (stepping while paused moves the replay start).
- **Why:** the user asked for arrow-key stepping, with an adjustable interval for fine nudging (finding a note's onset) as well as moving around the song.
- **How the focus rule works:**
  - A slider you **clicked** doesn't keep the arrow keys. After dragging the speed, ← / → still step the cursor.
  - A slider reached with **Tab** keeps its arrows, so it can still be used with the keyboard alone.
  - `:focus-visible` can't tell these apart, because Chromium turns it on for the focused element as soon as any key is pressed. So the app remembers the element last pressed with the pointer (`clickedElement`) and clears it when Tab is pressed.
- **Where:**
  - §1 `CONFIG.skip` (replaces `skipSeconds`).
  - §2 `formatStep`.
  - §3 `settings.skipStep`.
  - §9 `renderSkipStep`.
  - §10 `changeSkipStep`.
  - §12 `skip(direction)`.
  - §13: the `SHORTCUTS` arrow entries, `isKeyboardFocusedSlider`, and the `clickedElement` tracking in `bindShortcuts`.
  - `index.html`: `#skipStep` and the button titles.
  - `style.css`: `.skip-step`.
- **Verified by:** 17 new end-to-end checks in the harness, 68 in total, all passing:
  - step sizes and their limits;
  - key repeat;
  - R / C removed and the legend updated;
  - a clicked slider vs a Tab-focused slider, with real window focus emulated through DevTools (`Emulation.setFocusEmulationEnabled`);
  - stepping past B while looping, and Space after stepping.

---

## 2026-10-08: Polish round (A–B loop, Space replay, offline, messages)

### A–B loop

- **What:**
  - **Drawing and adjusting:**
    - Shift+drag on the waveform draws a loop. A plain click still seeks.
    - Dragging within 6 px of a loop edge moves that edge; the pointer shows a resize cursor there.
    - A Shift+drag shorter than 50 ms counts as a plain click.
  - **Keys:**
    - `[` sets the loop start at the cursor.
    - `]` sets the loop end at the cursor.
    - `L` turns the loop on and off.
    - `Shift+L` clears it.
  - **Display:**
    - The loop is a cyan region on the waveform: solid when on, dashed and grey when off.
    - A cyan readout next to the track time shows "Loop 0:12.300 – 0:18.900".
  - **Playback with the loop on:**
    - Playback starts inside the loop.
    - Seeking past its end goes to its start.
    - Drawing or enabling a loop while playing somewhere else jumps into it.
    - A new file clears the loop. A file that fails to load keeps the old one.
- **Why:** looping a passage is the core of transcribing (Transcribe!'s main feature).
- **How:**
  - **Audio.** It uses Signalsmith Stretch's own looping, which is gapless: each timeline segment carries `loopStart` / `loopEnd`, and the audio worklet moves the input time back by the loop length once it reaches `loopEnd`. This was checked against the 1.3.2 source. Two constraints follow from that source:
    1. A new segment copies the previous segment's loop fields. So the transport _always_ sends `loopStart` / `loopEnd`, with `0, 0` meaning no loop.
    2. A playing segment that starts at or after `loopEnd` would be pulled back one loop length per audio block. So the transport never starts a playing segment there; it starts at the loop start instead.
  - **Cursor.** The transport's mirror of the timeline (`timelinePositionAt`) applies the same wrap, so the cursor, the clock and the video follow the loop exactly.
  - **Video.** When the position goes backwards during playback (a wrap), the transport emits `"jump"`, so the video restarts decoding at the loop start.
  - **End of track.** While looping, no end-of-track timer is planned, because a looping track never ends.
  - **Where the state lives.** The loop's state `{ start, end, enabled }` lives in the playback actions (`loopRegion`), not the transport, because a disabled loop is still drawn. The transport only knows about the loop while it is enabled.
  - **Drawing.** The region is a `<div part="loop-region">` inside WaveSurfer's wrapper, styled from `style.css` with `::part()`, since WaveSurfer uses a shadow DOM. It is positioned in percent, so zoom and scroll need no code. WaveSurfer's Regions plugin was avoided: its pointer handling would fight the app's own seeking, the same class of bug as the earlier cursor desync.
- **Where:**
  - §1 `CONFIG.loop` (`minSeconds`, `edgeGrabPx`).
  - §2 `timelinePositionAt`.
  - §5 `createTransport`: `apply`, `play`, `setLoop`, `draw` (wrap detection), the `loop` getter.
  - §6 `createWaveform`: `timeAtClientX`, `loopEdgeAt`, `bindPointerSeek` (seek / draw / edge modes), `renderLoop`, `setLoop`.
  - §8: the `onLoopChange` wiring.
  - §9 `renderLoopInfo`.
  - §11 `loadMediaFile` (clears the loop).
  - §12: `loopRegion`, `setLoopRegion`, `setLoopStart`, `setLoopEnd`, `toggleLoop`, `clearLoop`.
  - §13 `SHORTCUTS`.
  - `style.css`: the `--loop*` tokens, `::part(loop-region)`, `.loop-info`.

### Space plays again from where you started listening

- **What:**
  - Space pauses, and the cursor stays where it paused.
  - Space again plays from where that playback started.
  - If you clicked, skipped or pressed Stop while paused, Space plays from there instead.
  - After the track ends, Space replays from where you started.
  - The Play button behaves like Space. `,` still pauses and resumes from the current spot.
- **Why:** the user asked for it; it matches Transcribe!'s Play/Stop. Listening to a phrase again is the most common action when transcribing.
- **How:**
  - `returnPoint` is updated by transport listeners in §8:
    - the position when playback starts;
    - the target of every `"jump"` (seek, skip, loop wrap);
    - 0 on Stop or a new file.
  - `replayOrPause` reads `returnPoint` before seeking, because its own seek also emits `"jump"`.
- **Where:**
  - §8: the `returnPoint` listeners.
  - §12: `returnPoint`, `replayOrPause`; the Play button binding.
  - §13: the Space and `,` entries.

### Keyboard: Shift shortcuts

- **What:** shortcuts can now be Shift + key (`shift: true` in `SHORTCUTS`). The legend shows them as `Shift + L`.
- **How:** key _releases_ match by key alone, ignoring Shift. Otherwise, pressing Shift while holding the play-while-held key (Z) would miss the release and leave it playing. Releases of every shortcut are still matched and `preventDefault`ed, because a focused button "clicks" on Space _release_.
- **Where:** §13 `findShortcut`, `renderShortcutLegend`.

### Works offline

- **What:** the app no longer needs the internet. Before, the audio engine came from the jsDelivr CDN (no internet meant no sound) and the fonts from Google Fonts.
- **How:**
  - `signalsmith-stretch` comes from npm, pinned to exactly `1.3.2`. The transport mirrors its internal behaviour, so an upgrade needs re-checking against its source. The npm file is byte-identical to the CDN file the app used before.
  - The fonts come from Fontsource: `@fontsource/righteous` and `@fontsource-variable/nunito` (family name "Nunito Variable").
- **Where:** `package.json` dependencies, the `import` at the top of `script.js`, the `<link>`s in `index.html`, `--sans` in `style.css`.

### Errors vs notices; tidy UI

- **What:**
  - **Messages.** The message line in the transport bar distinguishes two kinds:
    - **errors** (something failed): red monospace;
    - **notices** (something works only partly, e.g. "the picture can't be shown, but its audio plays"): neutral grey.
  - **Status text.** The "Playing." / "Paused." status text in the top bar is removed, because the Play/Pause button already shows the state.
  - **Scale labels.** The labels under the speed and volume sliders are generated from `CONFIG`, so they can't go out of date.
- **Where:**
  - §9: `showMessage`, `showError`, `showNotice`, `clearMessage`, `reportError`, `buildScales`.
  - §11: the notices in `loadMediaFile`.
  - `index.html`: `#message` replaces `#error`; `#status` is removed.
  - `style.css`: `.message`, `.message.notice`.

### Verified by

**Logic checks**

- 8 unit checks of `timelinePositionAt`: no loop, before B, a wrap at B, multiple wraps, a start before A, half speed, inactive, zero loop fields.

**End-to-end harness**
51 checks in an offscreen Electron window, using real key and mouse input, with every network request blocked:

- **Loop at 1× and 0.5×:**
  - the cursor stays inside the loop and wraps;
  - the audio thread's own input time also stays inside it;
  - there are no forward jumps.
- **Loop editing:** the drag, edge, key, short-drag and new-file rules.
- **Space, Stop and comma:**
  - Space and comma behave as described above;
  - the cursor holds still on pause;
  - the waveform cursor stays within 1 ms of the clock.
- **Video loop:**
  - the picture follows each wrap within 3 frames;
  - it stays within 100 ms of the audio 96% of the time.
- **Fonts:** load with no network access.
- **Messages:** a bad file shows a red error and keeps the previous song.

---

## Before 2026-10-08: Groundwork

A summary of the earlier rounds, so this log has a starting point.

- **Structure.**
  - `script.js` was refactored into one modular file with numbered sections, a CONFIG block that holds every tunable number, a single `settings` object, and a table of slider settings (`SLIDERS`).
  - A small event emitter isolates listener errors.
- **Transport (§5).**
  - Playback state and position mirror Signalsmith's timeline, so the position of what is _heard_ (allowing for the output delay) is computed exactly.
  - Signalsmith's `schedule()` discards every segment that starts before a new one. So segments are never scheduled in the future; the end of the track is a timer instead. Breaking this rule once caused "no sound at all".
  - `pendingJump` keeps a seek target on screen until it becomes audible.
- **Audio graph.** Signalsmith (speed and pitch) → 5-band EQ (off by default) → volume → a brick-wall limiter.
- **Shortcuts.** Modelled on Transcribe!: Space, `,`, `.`, Z/`;` hold-to-play, R/C skip with key repeat (later replaced by the arrow keys). A legend is generated from `SHORTCUTS`.
- **UI.**
  - A dark, waveform-first layout with no animations, except the loading indicator (a full-window overlay that blocks input while a file loads).
  - Fonts: Righteous (display) and Nunito (text).
  - More slowdown presets.
- **Electron.** GPU acceleration is enabled (`npm run start:gpu-info` shows its status, `start:no-gpu` turns it off).
- **Faster loading.** The engine and libraries warm up at startup, the waveform gets adaptive peak counts, and decoded audio is handed to the audio thread without copying.
- **Video (§7).**
  - Frames are decoded with WebCodecs through Mediabunny and drawn on a canvas at the transport position. There is no `<video>` element and no second clock, so it can't drift.
  - Decoding reuses its position where it can and skips ahead when it falls behind.
  - A low-resolution proxy is built in the background (VP8, 320 px) and fills in instantly after distant seeks, until the sharp frame arrives.
- **Waveform seeking (§6).** WaveSurfer is used for drawing only; clicking and dragging are handled by the app. WaveSurfer's own delayed `seekTo` had made the cursor drift from playback.
- **Pausing.** Playback pauses at what was being heard when the key was pressed (the event's timestamp), not where the audio engine already was. That had made the cursor jump about 45 ms forward on every pause.
