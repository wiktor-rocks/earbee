# Maintaining EarBee

How to change EarBee, keep GitHub up to date, and put out new versions.
The commands are for a terminal in the project folder.

## How it's set up

- **The code** is on GitHub at [wiktor-rocks/earbee](https://github.com/wiktor-rocks/earbee). Your copy talks to it as `origin`, over SSH.
- **Two branches:**
  - `testing` is where you work. Push to it as often as you like.
  - `main` is the stable version. It's what people see on GitHub, and what the website is published from. It only moves forward to where `testing` is, once that's tested.
- **Automatic on GitHub** (the [Actions tab](https://github.com/wiktor-rocks/earbee/actions) shows every run):

  | When                                  | What runs                                                                           | How long         |
  | ------------------------------------- | ----------------------------------------------------------------------------------- | ---------------- |
  | Any push to `testing` or `main`       | **CI:** formatting, lint, types, unit tests                                         | about 1 minute   |
  | A push to `main`                      | **CI** also runs the end-to-end and smoke tests                                     | about 10 minutes |
  | A push to `main` that changes `site/` | **Landing page:** republishes [the website](https://wiktor-rocks.github.io/earbee/) | under a minute   |
  | Pushing a version tag (`v0.2.0`)      | **Release:** builds Windows, macOS and Linux, and makes a draft release             | about 15 minutes |

- **Every change gets a CHANGELOG.md entry** (what, why, how, where, verified by), newest first.

## Each time you work on it

### 1. Start from the latest version

```sh
git checkout testing
git pull
npm install            # only needed when package.json changed
```

`git pull` fetches what's on GitHub and brings your copy up to date. That covers anything you pushed from another computer, and merged pull requests.

### 2. Change things, and try them

```sh
npm start              # run the app; it reloads when you save a file
npm run check          # formatting, lint and types (npm run format fixes formatting)
npm run test:unit      # about a second
npm test               # everything (about 10 minutes): before merging into main
```

### 3. Save the change (commit) and send it to GitHub (push)

```sh
git status             # what changed
git add -A             # take all of it (or name the files)
git commit -m "Loop: Shift+click clears it"
git push               # to testing on GitHub; CI checks it
```

A commit message is a short line saying what changed. If you want, add a blank line and then more detail.

### 4. When `testing` is good: move `main` up to it

```sh
npm test               # everything passes?
git checkout main
git pull
git merge --ff-only testing
git push
git checkout testing   # back to work
```

`--ff-only` means `main` just moves forward to `testing`. If it refuses, `main` has commits that `testing` doesn't have (say, you changed something directly on GitHub). Then bring them into `testing` first, run the tests, and try again:

```sh
git checkout testing
git merge main
```

## Putting out a new version

1. **Choose the number.**
   - `0.1.1` for fixes.
   - `0.2.0` for new features.
   - `1.0.0` when you consider it finished.
2. **Set it, log it, and commit it on `testing`:**

   ```sh
   npm version 0.2.0 --no-git-tag-version   # updates package.json and package-lock.json
   # add a CHANGELOG.md entry for the release
   git add -A
   git commit -m "Version 0.2.0"
   git push
   ```

3. **Move `main` up** (step 4 above), with `npm test` passing.
4. **Tag it and push the tag:**

   ```sh
   git tag -a v0.2.0 main -m "EarBee 0.2.0"
   git push origin v0.2.0
   ```

5. **Wait for the build** (about 15 minutes; Mac machines can be queued a while). It makes a **draft** release, which only you can see, under [Releases](https://github.com/wiktor-rocks/earbee/releases).
6. **Check the draft.** It should have four files: `win-x64.exe`, `mac-arm64.dmg`, `mac-x64.dmg` and `linux-x86_64.AppImage`. Download the one for your system and try it.
7. **Publish it,** with **Edit › Publish release** on GitHub, or:

   ```sh
   gh release edit v0.2.0 --draft=false --latest
   ```

   The website offers the new files at once; nothing else needs updating.

If a pushed tag doesn't start the build, start it by hand: `gh workflow run release.yml --ref v0.2.0`.

## The website

It's `site/`, plain HTML, CSS and one script; see [site/README.md](../site/README.md). Open `site/index.html` in a browser to see your changes. Pushing them to `main` publishes them. To republish without a change, run `gh workflow run pages.yml --ref main`.

## When CI fails

- **See what failed:** the run on the Actions tab (a red ✗), or:

  ```sh
  gh run list
  gh run view <run number> --log-failed
  ```

  An e2e failure prints `FAIL <check name>`.

- **Try the same locally:** `npm test`, or only that topic, with `TB_TOPICS=18 npm test` (topic numbers are the file names in `tests/e2e/`).
- **Timing failures:** GitHub's machines are slower than yours. A check that passes locally but fails there because of timing should wait for its condition (look up to a few seconds), not sleep a fixed time. See `tests/e2e/02-welcome.cjs`, "…and they move", for an example.
- **Run it again:** **Re-run jobs** on the run's page, or `gh workflow run ci.yml --ref main`.

## Undoing things

| You want to…                                                         | Do                                                                     |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Throw away changes you haven't committed                             | `git restore <file>` (or `git restore .` for all of them)              |
| Undo the last commit, if you haven't pushed it (keeping the changes) | `git reset --soft HEAD~1`                                              |
| Undo a commit you already pushed                                     | `git revert <commit>`, which adds a commit that reverses it; then push |
| See what changed, and when                                           | `git log --oneline`, `git show <commit>`                               |

**Never `git push --force` to `main`.** It rewrites the public history for everyone who has a copy.

## Other things that come up

- **Git asks for your SSH key's passphrase:** type it. To be asked only once per session, run `ssh-add ~/.ssh/id_ed25519`.
- **On another computer:**

  ```sh
  git clone git@github.com:wiktor-rocks/earbee.git
  cd earbee
  npm install
  git checkout testing
  ```

  `npm test` creates the test media the first time, which needs ffmpeg and takes a few minutes. Add that computer's SSH key on GitHub first (Settings › SSH and GPG keys).

- **Issues and pull requests from others:**
  - People report problems under [Issues](https://github.com/wiktor-rocks/earbee/issues).
  - A pull request is someone's proposed change; CI checks it automatically.
  - To merge one, use **Merge** on GitHub. Then, locally, `git checkout main && git pull`, and bring it into `testing` with `git checkout testing && git merge main`.
- **Updating libraries:** `npm outdated` lists what's newer. `npm update` takes the compatible updates. Then run `npm test` and commit `package.json` and `package-lock.json`. Update Electron (`npm install electron@latest --save-dev`) on its own, and test the app by hand too.
- **The `gh` command** is GitHub from the terminal; `gh auth status` shows you're logged in. Everything it does can also be done on github.com.
