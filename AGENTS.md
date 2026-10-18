# Notes for AI assistants

How to find your way in EarBee, check your work and avoid the known pitfalls. People: the same is in README.md ("Development") and [docs/maintaining.md](docs/maintaining.md), with more explanation.

## First, in every session: the owner's reminders

**Before you answer the owner's first message, whatever it says** (a question, a task, even "hi"), read the "Reminders" section of `local/SCRATCHPAD.md` and show the owner every item in it, word for word, under a heading "Reminders". Then answer the message.

- Do it once per session, at the start, every time, even if the reminders were shown in an earlier session.
- If the file or the section is missing, or the section is empty, say nothing about it and go on.
- Never remove or change a reminder yourself; only when the owner asks. To add one, put it in that section when the owner asks for a reminder.

## What this is

A desktop player for transcribing music (Electron). There's no build step: the page is plain ES modules loaded by `index.html`, with types from JSDoc comments.

- **The page** (`src/`, `index.html`, `style.css`) runs in the browser window: audio, video, waveform and UI.
- **The main process** (`electron/`, CommonJS) handles the window, files, settings, downloads and the beat model, and talks to the page through `window.earbee` (`electron/preload.js`).
- **The website** (`site/`) is apart from the app: earbee.org, the landing page and the blog, built with Eleventy, with its own `package.json`. Everything about it: [docs/blog.md](docs/blog.md).

## Read first

0. **`local/FOR-TOMORROW.md` and `local/SCRATCHPAD.md`, if they exist** (the scratchpad's "Reminders" are shown first; see above): the owner's notes from earlier sessions: what's in flight with its next step, and a scratchpad of loose notes and ideas. The `local/` folder is kept on the owner's computer only (git ignores it), so it may be missing. Check both before starting. Keep FOR-TOMORROW.md current: add what you leave half-done, with the next step, and remove what you finish. Never commit anything in `local/`.
1. **The comment at the top of `src/app.js`:** the architecture, every file and its role, and "COMMON CHANGES", which says where to make the usual changes.
2. **[docs/glossary.md](docs/glossary.md):** the app's words ("start point", "region", "Peak + loudness", "the dock") and their names in the code.
3. **Imports only go downward** through the page's layers: `core`, `themes`, `search` → `prefs`, `marks`, `project` → `config` → `audio`, `video`, `waveform`, `timeline` → `context` → `ui` → `features` → `app.js`. ESLint enforces it (`eslint.config.js`); a forbidden import fails `npm run check`.

## Finding your way in the big files

- **`style.css`** (about 3,100 lines) has a section marker per part. The outline: `grep -n '^/\* ---------- ' style.css`.
- **`CHANGELOG.md`** (thousands of lines): read only the top few entries; `grep` for older ones. Its header explains the entry format.
- **`index.html`**: find elements by their `id`, which is what the code uses (`$("speedScale")` in `src/ui/dom.js`).

## Commands

| What                             | Command                                                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Run the app                      | `npm start`                                                                                                                                |
| Formatting, lint and types       | `npm run check` (`npm run format` fixes formatting)                                                                                        |
| All unit tests (about 20 s)      | `npm run test:unit`                                                                                                                        |
| One unit-test file               | `node --test tests/unit/beats.test.mjs`                                                                                                    |
| One end-to-end topic             | `TB_TOPICS=20 npm test`: the unit tests, that topic, then the smoke test. Several: `TB_TOPICS=03,14 npm test`                              |
| Everything (about 10 min)        | `npm test`                                                                                                                                 |
| Make the test media              | `npm run test:fixtures` (needs ffmpeg; `npm test` does it when missing)                                                                    |
| The website: preview, build      | `npm --prefix site start` (http://localhost:8080), `npm --prefix site run build`; once: `npm --prefix site install`                        |
| A packaged build, and testing it | `npm run build:dir`, then `TB_APP_PATH=$PWD/dist/linux-unpacked/resources/app.asar TB_APP_BINARY=$PWD/dist/linux-unpacked/earbee npm test` |

The end-to-end topics are the files in `tests/e2e/`: 01 static UI, 02 welcome screen, 03 audio and the loop, 04 Space replay, 05 stepping, 06 zoom, 07 errors, 08 video, 09 downloads and search, 10 themes, 11 parallel decoding, 12 resources, 13 settings, 14 marks, 15 security, 16 projects, 17 waveform, 18 video window, 19 big video, 20 beats. A topic may rely on what an earlier one left open; if one fails only when run alone, run it with the topics before it. Known: 09 needs a file open (`TB_TOPICS=03,09`).

## Test builds

When the owner asks for a test build of a branch (to try it before deciding, e.g. an experiment), make an **AppImage**: one file that runs on Linux. Windows and Mac test builds aren't set up yet. `npm run build:dir` (above) is for running the tests against a packaged build, not for trying it.

1. Check out the branch; `git status --porcelain` prints nothing.
2. `npm run build:linux` (a few minutes). It writes `dist/EarBee-<version>-linux-x86_64.AppImage`.
3. Rename it after the branch, so it isn't taken for a release: `/` becomes `-`, e.g. `mv dist/EarBee-0.2.0-linux-x86_64.AppImage dist/EarBee-0.2.0-exp-beat-windows-x86_64.AppImage`.
4. Delete what the build leaves next to it: `rm -rf dist/linux-unpacked dist/builder-debug.yml`. Leave other files in `dist/` alone.
5. Check it starts: `env -u ELECTRON_RUN_AS_NODE TB_APP_BINARY=$PWD/dist/<the AppImage> node tests/smoke.cjs` passes.
6. Give the owner its path. It uses the same settings folder as the installed EarBee (`~/.config/EarBee`).

## Which checks for which change

| You changed                                  | Run                                                                                                                                      |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Only docs (`*.md`)                           | `npm run format:check`                                                                                                                   |
| The website (`site/`)                        | `npm run check`, `npm --prefix site run build`                                                                                           |
| The page (`src/`, `index.html`, `style.css`) | `npm run check`, `npm run test:unit`, and the e2e topic for that area (e.g. waveform → `TB_TOPICS=17`, beats → `20`, marks → `14`)       |
| The main process (`electron/`)               | `npm run check`, `npm run test:unit`, and one e2e topic for that area, which also runs the smoke test (the real app, `main.js` included) |
| Before `main` moves up to `testing`          | `npm test`: everything must pass                                                                                                         |

A small change (a comment, a CSS value, a typo) needs `npm run check` only.

## Conventions

- **Comments** are plain sentences that say what something is for and why. Match the amount of comment around your change: most files explain each part.
- **Types** are JSDoc (`/** @param {number} time */`). `npm run check` type-checks both the page (`jsconfig.json`) and the main process (`electron/jsconfig.json`), in the lenient mode.
- **Numbers and lists come from data, not code:** speeds, step sizes, EQ bands and limits in `CONFIG` (`src/config.js`); settings in `src/prefs/index.js`; themes in `src/themes/palettes.js`. The UI for them is generated.
- **Formatting** is Prettier's, and lint is ESLint's. Don't hand-format; run `npm run format`.
- **`style.css`:** new rules go in the section they belong to (see its outline); a new part gets its own `/* ---------- Name ---------- */` marker.
- **Every change gets a CHANGELOG.md entry**, at the top, newest first: what, why, how, where, verified by (the format is in its header). Not on an `exp/` branch: the entry is written when the experiment is merged into `testing`.
- **Commit messages** are one short line saying what changed, and nothing else: no `Co-Authored-By` or other trailer lines, even if your tool adds them by default.

## Pitfalls

- **`ELECTRON_RUN_AS_NODE`.** VS Code's terminal sets it, which makes Electron start as plain Node. `npm test` clears it; to run Electron yourself, use `env -u ELECTRON_RUN_AS_NODE npx electron …`.
- **The e2e and smoke tests need a display** (X11 or Wayland), although their windows are invisible. On a machine without one: `xvfb-run -a npm test`.
- **The e2e harness empties `tests/output/downloads`** when it starts, and writes screenshots to `tests/output/`. Settings and downloads in progress go to temporary folders, never to your real ones.
- **ONNX Runtime:** `.npmrc` stops its install from downloading CUDA libraries (about 270 MB). Keep it.
- **`site/` goes online** from `main`: every `.html`, `.md` and `.njk` file becomes a page (except `README.md` and posts with `draft: true`), and everything in `fonts/` and `img/` is copied (`site/eleventy.config.js`). Don't put working files there (a source video, for instance).

## Branches

- **`testing`** is where work happens. Commit there, unless the owner says otherwise.
- **`main`** is the stable version: the website is published from it, and releases are tagged on it. It only moves forward to `testing` (`git merge --ff-only testing`), and only when the owner asks. Never commit to it directly.
- **An idea that might not work out** goes on its own experiment branch, `exp/<idea>`. Follow docs/maintaining.md, "Trying an idea: an experiment branch", exactly: procedures A to F, each step's command as written, then its check. When a command fails or a check doesn't give the expected result, stop and report; don't work around it. Ask the owner before merging an experiment into `testing` (D) or throwing it away (E).
- Never rebase or force-push pushed work.

## Ending a session

When the owner says they're done ("done for today", "let's stop", "wrap up"), leave everything so the next session, maybe with a cleared context or another assistant, starts from a clean, known state. In order:

1. **Stop what's running:** background test runs, measurements, `npm start`.
2. **Put back anything temporary:** debug or timing lines in tracked files, a setting changed for a measurement. `git status` shows only changes that are meant to stay.
3. **Commit finished work** on its branch, after the checks its change needs (see "Which checks for which change"), with its CHANGELOG entry where the conventions ask for one. Unfinished work:
   - on an `exp/` branch, commit it there if `npm run check` passes;
   - on `testing`, ask the owner: move it to a new experiment branch (procedure A, then commit), or leave it uncommitted and say so in FOR-TOMORROW.md.
   - Don't `git stash` it: a stash is easy to forget.
4. **Push** every branch with new commits (`testing`, `exp/*`), so GitHub has them; never `main`. Check: `git status -sb` on each shows nothing after `origin/…`.
5. **Tidy what the session left behind:** a build's by-products in `dist/` (see "Test builds"), stray files in the repo outside `local/`. Ask before deleting anything the session didn't make.
6. **Bring `local/FOR-TOMORROW.md` up to date:**
   - each thread still in flight: its branch and last commit, where it stands, and the next step;
   - what waits for the owner's decision;
   - what's finished comes out (the CHANGELOG keeps the record);
   - check that what it says still holds: branches, what's pushed, test results.
   - Loose ideas from the session go to `local/SCRATCHPAD.md`.
7. **Leave the working copy on `testing`**, clean, unless the owner wants another branch open; FOR-TOMORROW.md says which.
8. **End with a short summary for the owner:**
   - what was done and pushed;
   - what's waiting for them;
   - what's next;
   - anything that wasn't verified.
