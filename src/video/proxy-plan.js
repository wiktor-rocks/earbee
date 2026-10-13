// Where the video proxy builds next (see proxy.js). Kept apart, and pure,
// so it can be tested on its own (tests/unit/proxy-plan.test.mjs).
//
//   runs   what is built, in time order: { start, end, first, last }
//          (`first`: it reaches back to the start of the video; `last`:
//          on to its end)
//   jobs   what is being built, one per busy builder: { from, to, at }
//          (`at`: how far it got; `to`: where it stops, Infinity = the end)
//   focus  a time asked for where nothing is built, or null
//
// nextRange(runs, jobs, focus, options) → { from, to, lower, after, split }
// or null when nothing is worth starting: build from `from` up to `to`,
// keeping no frames before `lower`. `after` (an index into runs, or -1) is
// the run the new frames continue; `split` (an index into jobs, or -1) the
// job that must now stop at `from`, since the new range takes over the
// rest of its part.
//   - A focus goes first, unless a job reaches it within leadSeconds. The
//     range starts leadSeconds before it, so small steps back are covered.
//   - Otherwise the biggest stretch nothing builds yet: a free gap, built
//     from its start, or the second half of a busy job's remaining part
//     (if that half is at least minSplitSeconds long).

export const EPSILON = 1e-4; // s; times closer than this are the same

export const covers = (run, time) =>
  (run.first || run.start <= time + EPSILON) && (run.last || time <= run.end + EPSILON);

// Whether a busy job will soon build `time` (or just did).
export const reachedSoon = (jobs, time, leadSeconds) =>
  jobs.some((job) => job.from - EPSILON <= time && time < job.to && time <= job.at + leadSeconds);

// The stretches neither built nor being built: { from, to, after }, `after`
// being the run that ends where the gap starts (or -1). The last one goes
// on to the end (to: Infinity).
function gaps(runs, jobs, duration) {
  const taken = [
    ...runs.map((run, index) => ({
      start: run.first ? -Infinity : run.start,
      end: run.last ? Infinity : run.end,
      run: index,
    })),
    ...jobs.map((job) => ({ start: job.from, end: job.to, run: -1 })),
  ].sort((a, b) => a.start - b.start);

  const result = [];
  let end = 0;
  let after = -1;
  for (const part of taken) {
    if (part.start > end + EPSILON) result.push({ from: end, to: part.start, after });
    if (part.end > end) {
      end = part.end;
      after = part.run;
    }
  }
  if (end < duration - EPSILON) result.push({ from: end, to: Infinity, after });
  return result;
}

/**
 * @param {{ start: number, end: number, first: boolean, last: boolean }[]} runs
 * @param {{ from: number, to: number, at: number }[]} jobs
 * @param {number | null} focus
 * @param {{ duration: number, leadSeconds: number, minSplitSeconds?: number }} options
 */
export function nextRange(runs, jobs, focus, { duration, leadSeconds, minSplitSeconds = 20 }) {
  const free = gaps(runs, jobs, duration);

  if (focus !== null && !runs.some((run) => covers(run, focus)) && !reachedSoon(jobs, focus, leadSeconds)) {
    const split = jobs.findIndex((job) => job.from - EPSILON <= focus && focus < job.to);
    if (split >= 0) {
      const from = focus - leadSeconds; // past the job's `at` (it doesn't reach the focus soon)
      return { from, to: jobs[split].to, lower: from, after: -1, split };
    }
    const gap = free.find((gap) => gap.from - EPSILON <= focus && focus < gap.to);
    if (gap) {
      const from = Math.max(focus - leadSeconds, gap.from);
      return { from, to: gap.to, lower: gap.from, after: from <= gap.from + EPSILON ? gap.after : -1, split: -1 };
    }
  }

  let best = null;
  for (const gap of free) {
    const size = Math.min(gap.to, duration) - gap.from;
    if (size > EPSILON && (!best || size > best.size))
      best = { size, range: { from: gap.from, to: gap.to, lower: gap.from, after: gap.after, split: -1 } };
  }
  jobs.forEach((job, split) => {
    const rest = Math.min(job.to, duration) - job.at;
    if (rest >= 2 * minSplitSeconds && (!best || rest / 2 > best.size)) {
      const from = job.at + rest / 2;
      best = { size: rest / 2, range: { from, to: job.to, lower: from, after: -1, split } };
    }
  });
  return best?.range ?? null;
}
