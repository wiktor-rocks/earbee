# Maintaining EarBee

How to change EarBee, keep GitHub up to date, and put out new versions.
The commands are for a terminal in the project folder.

## How it's set up

- **The code** is on GitHub at [wiktor-rocks/earbee](https://github.com/wiktor-rocks/earbee). Your copy talks to it as `origin`, over SSH.
- **Branches:**
  - `testing` is where you work. Push to it as often as you like.
  - `main` is the stable version. It's what people see on GitHub, and what the website is published from. It only moves forward to where `testing` is, once that's tested.
  - `exp/<idea>` (say, `exp/tuner`) is for trying an idea that might not work out. Each idea gets its own branch, made from `testing`. If it works, it's merged into `testing`; if not, the branch is deleted. See [Trying an idea](#trying-an-idea-an-experiment-branch).
- **Automatic on GitHub** (the [Actions tab](https://github.com/wiktor-rocks/earbee/actions) shows every run):

  | When                                              | What runs                                                               | How long         |
  | ------------------------------------------------- | ----------------------------------------------------------------------- | ---------------- |
  | Any push to `testing`, `main` or an `exp/` branch | **CI:** formatting, lint, types, unit tests                             | about 1 minute   |
  | A push to `main`                                  | **CI** also runs the end-to-end and smoke tests                         | about 10 minutes |
  | A push to `main` that changes `site/`             | **Landing page:** republishes [the website](https://earbee.org/)        | under a minute   |
  | Pushing a version tag (`v0.2.0`)                  | **Release:** builds Windows, macOS and Linux, and makes a draft release | about 15 minutes |

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

## Trying an idea: an experiment branch

When you want to try something that might not work out, give it its own branch. `testing` stays as it was while you try. If the idea works, the whole branch is merged into `testing`; if it doesn't, the branch is deleted and nothing of it is left. One branch per idea: two ideas, two branches.

The procedures below are exact, so that anyone, a person or an AI assistant, does the same thing every time. Follow them step by step: run each command as written, then do its check.

### The rules

1. **The name.** An experiment branch is `exp/` followed by the idea's name, which uses only lowercase letters, digits and single hyphens, starts and ends with a letter or digit, and is at most 30 characters (`exp/tuner`, `exp/midi-input`). Below, `exp/IDEA` stands for that name; replace `IDEA` everywhere with it.
2. **When something goes wrong, stop.** If a command fails (an error, or a non-zero exit code) or a check doesn't give the expected result: don't try other commands to get around it. Stop, and report the command, its output and the step you were on. The exceptions are written into the steps (a merge conflict in A3, failed tests in D5).
3. **Never** on an experiment: `git rebase`, `git push --force`, `git reset --hard` (except where D5 says so), merging an `exp/` branch into `main`, or committing to `main`.
4. **CHANGELOG.md is only written on `testing`**, when an experiment is merged into it (D7). Not on an `exp/` branch.
5. **Only the owner decides** whether an experiment worked. An AI assistant asks before running D (merge into `testing`) or E (throw away), and names the branch in the question.
6. **Start every procedure with a clean working tree.** `git status --porcelain` prints nothing. If it prints anything, stop: there are uncommitted changes to commit or put aside first.

### A. Start an experiment

| #   | Run                                                  | Check                                                                                |
| --- | ---------------------------------------------------- | ------------------------------------------------------------------------------------ |
| A1  | `git status --porcelain`                             | Prints nothing (rule 6).                                                             |
| A2  | `git fetch origin`                                   | No error.                                                                            |
| A3  | `git rev-parse --verify --quiet refs/heads/exp/IDEA` | Prints nothing: no such branch here. If it prints a commit, the name is taken: stop. |
| A4  | `git ls-remote --exit-code --heads origin exp/IDEA`  | Prints nothing and exits with 2: no such branch on GitHub. Otherwise stop.           |
| A5  | `git checkout testing`                               | No error.                                                                            |
| A6  | `git pull --ff-only`                                 | No error: `testing` is now up to date with GitHub.                                   |
| A7  | `git checkout -b exp/IDEA`                           | Prints `Switched to a new branch 'exp/IDEA'`.                                        |
| A8  | `git push -u origin exp/IDEA`                        | Prints `branch 'exp/IDEA' set up to track 'origin/exp/IDEA'`.                        |
| A9  | `git status -sb`                                     | The first line is `## exp/IDEA...origin/exp/IDEA`, with nothing after it.            |

### B. Work on the experiment

For each change:

| #   | Run                                                                | Check                                                                             |
| --- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| B1  | `git branch --show-current`                                        | Prints `exp/IDEA`. If not, `git checkout exp/IDEA` first.                         |
| B2  | (make the change; try it with `npm start`)                         |                                                                                   |
| B3  | `npm run check`                                                    | Passes. If it fails, fix the change (B2) and run it again.                        |
| B4  | `git add` the changed files, then `git commit -m "<what changed>"` | A short line saying what changed. `CHANGELOG.md` is not among the files (rule 4). |
| B5  | `git push`                                                         | No error. CI checks the push (about a minute).                                    |

### C. Bring in what's new on `testing` (for an experiment that takes a while)

| #   | Run                                         | Check                                                                                                                                                                                       |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | `git status --porcelain`                    | Prints nothing.                                                                                                                                                                             |
| C2  | `git checkout testing`                      | No error.                                                                                                                                                                                   |
| C3  | `git pull --ff-only`                        | No error.                                                                                                                                                                                   |
| C4  | `git checkout exp/IDEA`                     | No error.                                                                                                                                                                                   |
| C5  | `git merge --no-edit testing`               | Ends without `CONFLICT`. If it says `CONFLICT`: run `git merge --abort`, check that `git status --porcelain` prints nothing, and stop (rule 2): a person resolves the conflict (see below). |
| C6  | `npm run check`                             | Passes. If it fails, stop.                                                                                                                                                                  |
| C7  | `git push`                                  | No error.                                                                                                                                                                                   |
| C8  | `git merge-base --is-ancestor testing HEAD` | Exits with 0: the experiment now contains all of `testing`.                                                                                                                                 |

### D. It worked: merge it into `testing` (ask first, rule 5)

| #   | Run                                                                                                                                                                   | Check                                                                                                                                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | Procedure C, all of it                                                                                                                                                | Every check passes.                                                                                                                  |
| D2  | `git checkout testing`                                                                                                                                                | No error.                                                                                                                            |
| D3  | `git pull --ff-only`                                                                                                                                                  | No error.                                                                                                                            |
| D4  | `git merge --no-ff exp/IDEA -m "Merge experiment exp/IDEA"`                                                                                                           | Ends without `CONFLICT` (C made sure it can't conflict).                                                                             |
| D5  | `npm test`                                                                                                                                                            | Passes (about 10 minutes). If it fails: run `git reset --hard ORIG_HEAD`, which undoes the merge (nothing was pushed yet), and stop. |
| D6  | `git log --oneline -1`                                                                                                                                                | Shows `Merge experiment exp/IDEA`.                                                                                                   |
| D7  | Add a CHANGELOG.md entry for the feature (at the top, in the format described there), then `git add CHANGELOG.md` and `git commit -m "<the feature, in a few words>"` | No error.                                                                                                                            |
| D8  | `git push`                                                                                                                                                            | No error.                                                                                                                            |
| D9  | `git branch -d exp/IDEA`                                                                                                                                              | Prints a line starting `Deleted branch exp/IDEA` (then the commit it was on). (`-d` refuses if the branch isn't merged: then stop.)  |
| D10 | `git push origin --delete exp/IDEA`                                                                                                                                   | Prints a line with `[deleted]` and `exp/IDEA`.                                                                                       |
| D11 | `git status -sb`                                                                                                                                                      | The first line is `## testing...origin/testing`, with nothing after it.                                                              |

From here it reaches `main` the usual way, with `testing` (step 4 of "Each time you work on it").

### E. It didn't work: throw it away (ask first, rule 5)

| #   | Run                                                 | Check                                                                                                                         |
| --- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| E1  | `git status --porcelain`                            | Prints nothing.                                                                                                               |
| E2  | `git checkout testing`                              | No error.                                                                                                                     |
| E3  | `git branch -D exp/IDEA`                            | Prints a line starting `Deleted branch exp/IDEA` (then the commit it was on). (`-D` deletes it although it was never merged.) |
| E4  | `git push origin --delete exp/IDEA`                 | Prints a line with `[deleted]` and `exp/IDEA`.                                                                                |
| E5  | `git ls-remote --exit-code --heads origin exp/IDEA` | Prints nothing and exits with 2: gone from GitHub too.                                                                        |

To keep a failed idea for reference instead, skip E: an unused branch costs nothing.

### F. See what's there

| Run                                    | Shows                                                  |
| -------------------------------------- | ------------------------------------------------------ |
| `git branch --show-current`            | The branch you're on.                                  |
| `git branch --list 'exp/*'`            | The experiments on this computer.                      |
| `git ls-remote --heads origin 'exp/*'` | The experiments on GitHub.                             |
| `git log --oneline testing..exp/IDEA`  | The experiment's commits that aren't on `testing` yet. |

### A merge conflict (for a person)

A conflict means both branches changed the same lines, and git asks which to keep. After C5 stopped, do the merge by hand: `git checkout exp/IDEA`, `git merge testing`. `git status` lists the files in conflict. In each, keep the right lines between the `<<<<<<<` and `>>>>>>>` markers and delete the markers. Then `git add` those files, `git commit --no-edit`, and carry on from C6. To give up instead, `git merge --abort` puts everything back as it was.

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
| Throw away an experiment branch                                      | `git branch -D exp/<idea>`, and `git push origin --delete exp/<idea>`  |

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
