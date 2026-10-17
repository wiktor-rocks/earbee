# Notes for AI assistants

How to find your way in EarBee, check your work and avoid the known pitfalls. People: the same is in README.md ("Development") and [docs/maintaining.md](docs/maintaining.md), with more explanation.

## What this is

A desktop player for transcribing music (Electron). There's no build step: the page is plain ES modules loaded by `index.html`, with types from JSDoc comments.

- **The page** (`src/`, `index.html`, `style.css`) runs in the browser window: audio, video, waveform and UI.
- **The main process** (`electron/`, CommonJS) handles the window, files, settings, downloads and the beat model, and talks to the page through `window.earbee` (`electron/preload.js`).

## Read first

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
| A packaged build, and testing it | `npm run build:dir`, then `TB_APP_PATH=$PWD/dist/linux-unpacked/resources/app.asar TB_APP_BINARY=$PWD/dist/linux-unpacked/earbee npm test` |

The end-to-end topics are the files in `tests/e2e/`: 01 static UI, 02 welcome screen, 03 audio and the loop, 04 Space replay, 05 stepping, 06 zoom, 07 errors, 08 video, 09 downloads and search, 10 themes, 11 parallel decoding, 12 resources, 13 settings, 14 marks, 15 security, 16 projects, 17 waveform, 18 video window, 19 big video, 20 beats. A topic may rely on what an earlier one left open; if one fails only when run alone, run it with the topics before it. Known: 09 needs a file open (`TB_TOPICS=03,09`).

## Which checks for which change

| You changed                                  | Run                                                                                                                                      |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Only docs (`*.md`)                           | `npm run format:check`                                                                                                                   |
| The landing page (`site/`)                   | `npm run check`                                                                                                                          |
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
- **Commit messages** are one short line saying what changed.

## Pitfalls

- **`ELECTRON_RUN_AS_NODE`.** VS Code's terminal sets it, which makes Electron start as plain Node. `npm test` clears it; to run Electron yourself, use `env -u ELECTRON_RUN_AS_NODE npx electron …`.
- **The e2e and smoke tests need a display** (X11 or Wayland), although their windows are invisible. On a machine without one: `xvfb-run -a npm test`.
- **The e2e harness empties `tests/output/downloads`** when it starts, and writes screenshots to `tests/output/`. Settings and downloads in progress go to temporary folders, never to your real ones.
- **ONNX Runtime:** `.npmrc` stops its install from downloading CUDA libraries (about 270 MB). Keep it.
- **`site/` is published as it is** from `main`. Don't put working files there (a source video, for instance); everything in it goes online.

## Branches

- **`testing`** is where work happens. Commit there, unless the owner says otherwise.
- **`main`** is the stable version: the website is published from it, and releases are tagged on it. It only moves forward to `testing` (`git merge --ff-only testing`), and only when the owner asks. Never commit to it directly.
- **An idea that might not work out** goes on its own experiment branch, `exp/<idea>`. Follow docs/maintaining.md, "Trying an idea: an experiment branch", exactly: procedures A to F, each step's command as written, then its check. When a command fails or a check doesn't give the expected result, stop and report; don't work around it. Ask the owner before merging an experiment into `testing` (D) or throwing it away (E).
- Never rebase or force-push pushed work.
