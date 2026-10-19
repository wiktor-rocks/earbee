// What people search around a post's keyword, from Google's search
// suggestions, and which of those searches the post already answers.
//
//   node scripts/seo/keywords.cjs <post-name>                 the post's `keyword:`
//   node scripts/seo/keywords.cjs <post-name> --also "<phrase>"   more phrases to expand (repeatable)
//   node scripts/seo/keywords.cjs --phrase "<phrase>"         before a post exists
//   add --fresh to ask Google again instead of using the cache
//
// Writes local/seo/<post-name>.md (or keywords-<phrase>.md) and .json.
//
// How: Google's suggestion endpoint (what the search box suggests while you
// type) for each phrase, the phrase plus each letter, and question forms of
// its topic words. That's free and needs no account, but it's unofficial:
// the requests are spaced out and cached for a week (local/seo/cache/), and
// a refusal stops the run instead of retrying.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { OUT, readPost, postParts, STOP, terms, missingTerms, writeReport } = require("./lib.cjs");

const ENDPOINT = "https://suggestqueries.google.com/complete/search?client=firefox&hl=en&ie=utf-8&oe=utf-8&q=";
const CACHE = path.join(OUT, "cache");
const CACHE_DAYS = 7;
const GAP_MS = 300;
const QUESTIONS = ["why", "how", "what", "is", "can", "should", "does"];
const QUESTION_START = /^(why|how|what|is|are|can|should|does|do|when|where|which|who|will)\b/;

// --- The arguments ---

const args = process.argv.slice(2);
const option = (name) => {
  const values = [];
  for (let i = 0; i < args.length; i++) if (args[i] === name && args[i + 1]) (values.push(args.splice(i, 2)[1]), i--);
  return values;
};
const fresh = args.includes("--fresh") && Boolean(args.splice(args.indexOf("--fresh"), 1));
const phraseArg = option("--phrase")[0];
const also = option("--also");
const postName = args.find((a) => !a.startsWith("--"));

const post = postName ? readPost(postName) : null;
if (postName && !post) fail(`No post site/blog/${postName}.md.`);
const phrase = (phraseArg ?? post?.header.keyword ?? "").toLowerCase().trim();
if (!phrase)
  fail(
    post
      ? `site/blog/${postName}.md has no keyword: add \`keyword: "<search phrase>"\` to its header, or use --phrase.`
      : 'Usage: node scripts/seo/keywords.cjs <post-name> | --phrase "<search phrase>"',
  );

function fail(message) {
  console.error(message);
  process.exit(2);
}

// --- The searches to ask about ---

// The phrase without a leading question word: "why transcribe songs by
// ear" → "transcribe songs by ear", for asking it as other questions.
const core = phrase.replace(QUESTION_START, "").trim() || phrase;
const seeds = [...new Set([phrase, core, ...also.map((a) => a.toLowerCase().trim())])];
const queries = new Set();
for (const seed of seeds) {
  queries.add(seed);
  for (const letter of "abcdefghijklmnopqrstuvwxyz") queries.add(`${seed} ${letter}`);
}
for (const q of QUESTIONS) queries.add(`${q} ${core}`);

// --- Asking Google, politely, with a cache ---

async function suggest(query) {
  const file = path.join(CACHE, crypto.createHash("sha1").update(query).digest("hex") + ".json");
  if (!fresh && fs.existsSync(file)) {
    const cached = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Date.now() - cached.time < CACHE_DAYS * 864e5) return { suggestions: cached.suggestions, asked: false };
  }
  let response;
  try {
    response = await fetch(ENDPOINT + encodeURIComponent(query), {
      headers: { "User-Agent": "EarBee-site-SEO-check/1 (+https://earbee.org)" },
    });
  } catch (e) {
    fail(
      `Couldn't reach Google's suggestions (${e.cause?.code ?? e.message}). Check the connection; the cache keeps what came before.`,
    );
  }
  if (!response.ok)
    fail(
      `Google's suggestions answered ${response.status} ${response.statusText}. Probably too many requests: try again later.`,
    );
  const data = JSON.parse(await response.text());
  const suggestions = Array.isArray(data?.[1]) ? data[1].map(String) : [];
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ time: Date.now(), query, suggestions }));
  return { suggestions, asked: true };
}

async function main() {
  const found = new Map(); // suggestion → the queries that gave it
  let asked = 0;
  for (const query of queries) {
    const result = await suggest(query);
    if (result.asked) (asked++, await new Promise((r) => setTimeout(r, GAP_MS)));
    for (const s of result.suggestions) {
      const text = s.toLowerCase().trim();
      if (text) found.set(text, [...(found.get(text) ?? []), query]);
    }
  }
  console.log(
    `${queries.size} searches (${asked} asked, ${queries.size - asked} from the cache), ${found.size} suggestions.`,
  );

  // --- Which suggestions the post answers ---

  const parts = post ? postParts(post.body) : null;
  const headingTerms = parts?.headings.map((h) => new Set(terms(h)));
  const bodyTerms = parts
    ? new Set(terms([post.header.title, ...parts.headings, ...parts.paragraphs].join(" ")))
    : null;
  const phraseTerms = new Set(terms(phrase));

  const rows = [...found.entries()].map(([text, from]) => {
    const row = { text, from: from.length, group: "other" };
    const own = terms(text);
    if (QUESTION_START.test(text)) row.group = "questions";
    else if ([...phraseTerms].every((t) => own.includes(t))) row.group = "phrasings";
    if (parts) {
      const words = text.split(/\s+/).filter((w) => !STOP.has(w));
      if (headingTerms.some((h) => own.length && own.every((t) => h.has(t)))) row.covered = "heading";
      else {
        row.missing = missingTerms(text, bodyTerms);
        row.covered = row.missing.length === 0 ? "mentioned" : row.missing.length < words.length ? "partly" : "no";
      }
    }
    return row;
  });
  // The suggestions Google gave for more of the searches first: a rough
  // sign of what's searched more.
  rows.sort((a, b) => b.from - a.from || a.text.localeCompare(b.text));

  // --- The report ---

  const name = post ? post.name : `keywords-${phrase.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
  const label = { heading: "✓ heading", mentioned: "✓ mentioned", partly: "~ partly", no: "✗ not covered" };
  const lines = [`# Search suggestions: "${phrase}"`, ""];
  lines.push(
    `Collected ${new Date().toISOString().slice(0, 10)} from Google's search suggestions: ${queries.size} searches, ${rows.length} suggestions.`,
  );
  if (also.length) lines.push(`Also expanded: ${also.map((a) => `"${a}"`).join(", ")}.`);
  lines.push(
    "",
    "**How to read it.** Suggestions are real searches, but without numbers: one that came up for more of the searches (the *seen* column) is probably searched more. *Covered* says whether the post answers it: in a heading, by using all its words, partly (the missing words are listed), or not at all.",
    "",
  );
  if (post) {
    lines.push(
      `## The post: ${post.name}${post.draft ? " (draft)" : ""}`,
      "",
      `- **Title:** ${post.header.title}`,
      `- **Description:** ${post.header.description}`,
      `- **Keyword:** ${post.header.keyword ?? "(none)"}`,
      `- **Words:** ${parts.words}`,
      `- **Headings:** ${parts.headings.join(" · ")}`,
      `- **First paragraph:** ${parts.first}`,
      "",
    );
  }
  for (const [group, title] of [
    ["questions", "Questions people ask"],
    ["phrasings", "Phrasings of the keyword"],
    ["other", "Related searches"],
  ]) {
    const list = rows.filter((r) => r.group === group);
    lines.push(`## ${title} (${list.length})`, "");
    if (!list.length) {
      lines.push("None.", "");
      continue;
    }
    lines.push(
      post ? "| Search | Seen | Covered | Missing words |" : "| Search | Seen |",
      post ? "| --- | --- | --- | --- |" : "| --- | --- |",
    );
    for (const r of list)
      lines.push(
        post
          ? `| ${r.text} | ${r.from} | ${label[r.covered]} | ${(r.missing ?? []).join(", ")} |`
          : `| ${r.text} | ${r.from} |`,
      );
    lines.push("");
  }
  if (post) {
    const counts = Object.fromEntries(Object.keys(label).map((k) => [k, rows.filter((r) => r.covered === k).length]));
    console.log(
      `Covered: ${counts.heading} in a heading, ${counts.mentioned} mentioned, ${counts.partly} partly, ${counts.no} not at all.`,
    );
  }
  writeReport(name, lines.join("\n"), {
    phrase,
    also,
    collected: new Date().toISOString(),
    queries: [...queries],
    post: post && { name: post.name, header: post.header, ...parts },
    suggestions: rows,
  });
}

main();
