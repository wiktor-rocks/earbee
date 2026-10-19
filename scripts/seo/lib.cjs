// What the SEO tools (check.cjs, keywords.cjs, console.cjs) share: where
// things are, reading a post's Markdown, comparing words loosely, and
// writing a report to local/seo/. Everything about the tools, and how to
// remove them: README.md in this folder.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const SITE = path.join(ROOT, "site");
const POSTS = path.join(SITE, "blog");
// Reports, the suggestion cache and the Search Console key: on this
// computer only (git ignores local/).
const OUT = path.join(ROOT, "local", "seo");
const SITE_URL = JSON.parse(fs.readFileSync(path.join(SITE, "_data", "site.json"), "utf8")).url;

/**
 * A post's header (the flat `key: "value"` lines between the `---` lines
 * that docs/blog.md describes) and its Markdown body.
 * @param {string} name  the file name without .md, which is also its address
 */
function readPost(name) {
  const file = path.join(POSTS, `${name}.md`);
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, "utf8");
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  const header = {};
  for (const line of (match?.[1] ?? "").split(/\r?\n/)) {
    const field = /^(\w+):\s*(.*)$/.exec(line);
    if (!field) continue;
    let value = field[2].trim();
    if (/^".*"$/.test(value)) value = value.slice(1, -1).replace(/\\"/g, '"');
    else if (/^'.*'$/.test(value)) value = value.slice(1, -1);
    header[field[1]] = value === "true" ? true : value === "false" ? false : value;
  }
  const body = match?.[2] ?? text;
  return { name, file, header, body, draft: header.draft === true };
}

/** Every post's name (its file name without .md). */
function postNames() {
  return fs
    .readdirSync(POSTS)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.slice(0, -3))
    .sort();
}

/**
 * A post's body in parts: its headings, its paragraphs (lists and quotes
 * included, as plain text) and the first paragraph, for checking which
 * words it uses where.
 * @param {string} body  Markdown
 */
function postParts(body) {
  const blocks = body
    .replace(/<!--[\s\S]*?-->/g, "")
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  const headings = blocks.filter((b) => /^#{2,6}\s/.test(b)).map((b) => plain(b.replace(/^#+\s*/, "")));
  const paragraphs = blocks.filter((b) => !/^#{1,6}\s/.test(b)).map(plain);
  return { headings, paragraphs, first: paragraphs[0] ?? "", words: wordCount(paragraphs.join(" ")) };
}

// Markdown or HTML to plain text: links keep their words, markup goes.
function plain(text) {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[*_`>]|^#+\s|^\d+\.\s|^[-+]\s/gm, "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&nbsp;/g, " ")
    .replace(/&rsquo;|&lsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function wordCount(text) {
  return text.split(/\s+/).filter((w) => /\w/.test(w)).length;
}

// Words that carry no topic: left out when phrases are compared, so "how
// to transcribe a solo" and "transcribing solos" match.
const STOP = new Set(
  "a an and are as at be by can do does for from how i if in into is it its me my of on or should so than that the their them then there these this to vs was what when where which who why will with you your".split(
    " ",
  ),
);

/**
 * A word's rough stem: lowercase, and the common English endings off, so
 * "transcribing", "transcribe" and "transcribes" compare equal. Crude, but
 * it's the same on both sides of every comparison.
 * @param {string} word
 */
function stem(word) {
  let w = word.toLowerCase().replace(/['’]/g, "");
  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  else if (w.length > 4 && w.endsWith("es")) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  if (w.length > 3 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

/**
 * The topic words of a text, as stems, without the stop words.
 * @param {string} text
 * @returns {string[]}
 */
function terms(text) {
  return (text.toLowerCase().match(/[a-z0-9'’]+/g) ?? []).filter((w) => !STOP.has(w.replace(/['’]/g, ""))).map(stem);
}

/**
 * The words of `phrase` that `text` doesn't use (compared as stems).
 * @param {string} phrase
 * @param {string | Set<string>} text  a text, or its terms already
 */
function missingTerms(phrase, text) {
  const have = text instanceof Set ? text : new Set(terms(text));
  const words = (phrase.toLowerCase().match(/[a-z0-9'’]+/g) ?? []).filter((w) => !STOP.has(w.replace(/['’]/g, "")));
  return words.filter((w) => !have.has(stem(w)));
}

/**
 * Writes local/seo/<name>.md (for reading) and <name>.json (the raw data,
 * for the assistant), and says where.
 */
function writeReport(name, markdown, data) {
  fs.mkdirSync(OUT, { recursive: true });
  const md = path.join(OUT, `${name}.md`);
  fs.writeFileSync(md, markdown);
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(data, null, 2) + "\n");
  console.log(`Report: ${path.relative(process.cwd(), md)} (and .json)`);
}

module.exports = {
  ROOT,
  SITE,
  POSTS,
  OUT,
  SITE_URL,
  readPost,
  postNames,
  postParts,
  plain,
  wordCount,
  STOP,
  stem,
  terms,
  missingTerms,
  writeReport,
};
