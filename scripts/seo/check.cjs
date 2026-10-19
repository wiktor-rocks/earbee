// The on-page SEO check: every page of earbee.org, drafts included, as
// search engines will see it.
//
//   node scripts/seo/check.cjs
//
// Prints ✗ (an error: something is broken) and ! (a warning: worth a look)
// per page. Exits with 1 only for an error on a published page, so a draft
// never fails CI (.github/workflows/seo.yml).
//
// How: copies site/ (without node_modules and _site) to a temporary folder,
// takes `draft: true` out of the posts there so they're built too, builds
// the copy with the site's own Eleventy, then reads the HTML. The real
// site/ is never written to. Needs `npm --prefix site install` once.
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { SITE, SITE_URL, readPost, postNames, plain, wordCount, terms, missingTerms } = require("./lib.cjs");

const ELEVENTY = path.join(SITE, "node_modules", "@11ty", "eleventy", "cmd.cjs");
const TITLE_MAX = 60;
const DESCRIPTION = [120, 155];
const IMAGE_MAX = 200 * 1024;
const WORDS_MIN = 300;

// --- Build the site, drafts included, in a temporary copy ---

if (!fs.existsSync(ELEVENTY)) {
  console.error("Eleventy isn't installed: run `npm --prefix site install` first.");
  process.exit(2);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "earbee-seo-"));
process.on("exit", () => fs.rmSync(tmp, { recursive: true, force: true }));
fs.cpSync(SITE, tmp, {
  recursive: true,
  filter: (src) => !["node_modules", "_site"].includes(path.relative(SITE, src).split(path.sep)[0]),
});
fs.symlinkSync(path.join(SITE, "node_modules"), path.join(tmp, "node_modules"), "dir");

const drafts = new Set();
for (const name of postNames()) {
  if (!readPost(name).draft) continue;
  drafts.add(name);
  const file = path.join(tmp, "blog", `${name}.md`);
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/^draft:\s*true\s*\r?\n/m, ""));
}

const build = spawnSync(process.execPath, [ELEVENTY, "--quiet"], { cwd: tmp, encoding: "utf8" });
if (build.status !== 0) {
  console.error(`The site doesn't build:\n${build.stdout}${build.stderr}`);
  process.exit(1);
}
const OUT = path.join(tmp, "_site");

// --- Read every page ---

/** @param {string} dir */
function htmlFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return htmlFiles(full);
    return e.name.endsWith(".html") ? [full] : [];
  });
}

// A built file's address: index.html → "/", blog/x/index.html → "/blog/x/".
function urlOf(file) {
  const rel = path.relative(OUT, file).split(path.sep).join("/");
  return "/" + rel.replace(/(^|\/)index\.html$/, "$1");
}

// The built file an address points to, or null.
function fileOf(url) {
  let rel = decodeURIComponent(url.replace(/^\//, ""));
  if (rel === "" || rel.endsWith("/")) rel += "index.html";
  const file = path.join(OUT, rel);
  return fs.existsSync(file) && fs.statSync(file).isFile() ? file : null;
}

const attr = (tag, name) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
const meta = (html, key, value) =>
  [...html.matchAll(/<meta\b[^>]*>/g)].map((m) => m[0]).find((t) => attr(t, key) === value);
const idsOf = (html) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

const pages = htmlFiles(OUT)
  .map((file) => {
    const html = fs.readFileSync(file, "utf8");
    return { file, url: urlOf(file), html, ids: idsOf(html), errors: [], warnings: [] };
  })
  .sort((a, b) => a.url.localeCompare(b.url));
const byUrl = new Map(pages.map((p) => [p.url, p]));
const draftUrls = new Set([...drafts].map((name) => `/blog/${name}/`));
for (const page of pages) page.draft = draftUrls.has(page.url);

// --- Every page ---

// Pages left out of the sitemap (the 404 page) aren't shown in search
// results, so their title and description lengths don't matter.
const sitemap = fs.readFileSync(path.join(OUT, "sitemap.xml"), "utf8");
for (const page of pages) page.listed = sitemap.includes(`<loc>${new URL(page.url, SITE_URL).href}</loc>`);

const titles = new Map();
const descriptions = new Map();
for (const page of pages) {
  const { html, errors, warnings } = page;

  // The title, without " · EarBee", which base.njk adds (search results cut
  // titles at about 60 characters).
  const title = plain(/<title>([\s\S]*?)<\/title>/.exec(html)?.[1] ?? "");
  page.title = title.replace(/ · EarBee$/, "");
  if (!title) errors.push("no <title>");
  else if (page.listed && page.title.length > TITLE_MAX)
    warnings.push(`title is ${page.title.length} characters (search results show about ${TITLE_MAX})`);
  if (title) titles.set(title, [...(titles.get(title) ?? []), page.url]);

  // The description: the lines under the title in search results.
  const description = plain(attr(meta(html, "name", "description") ?? "", "content") ?? "");
  if (!description) errors.push("no description");
  else if (page.listed && (description.length < DESCRIPTION[0] || description.length > DESCRIPTION[1]))
    warnings.push(`description is ${description.length} characters (${DESCRIPTION.join(" to ")} fits search results)`);
  if (description) descriptions.set(description, [...(descriptions.get(description) ?? []), page.url]);

  // The canonical address: the page's own, in full.
  const canonical = [...html.matchAll(/<link\b[^>]*>/g)].map((m) => m[0]).find((t) => attr(t, "rel") === "canonical");
  const expected = new URL(page.url, SITE_URL).href;
  if (!canonical) errors.push("no canonical link");
  else if (attr(canonical, "href") !== expected)
    errors.push(`canonical link is ${attr(canonical, "href")}, not ${expected}`);

  // One main heading.
  const h1s = (html.match(/<h1\b/g) ?? []).length;
  if (h1s !== 1) errors.push(`${h1s} <h1> headings (should be one)`);

  // Links within the site lead somewhere: the page, and the #part of it.
  for (const m of html.matchAll(/<a\b[^>]*\shref="([^"]+)"/g)) {
    const href = m[1].replace(/&amp;/g, "&");
    if (href.startsWith("//") || /^[a-z]+:/i.test(href)) continue;
    const [where, fragment] = href.split("#");
    if (where && !where.startsWith("/")) continue;
    const target = where ? fileOf(where.split("?")[0]) : page.file;
    if (!target) errors.push(`broken link: ${href}`);
    // A published page linking to a draft: fine here, broken online. (Not
    // the blog's list, which only lists drafts in this build.)
    else if (!page.draft && page.url !== "/blog/" && draftUrls.has(urlOf(target)))
      errors.push(`links to a draft, which isn't online: ${href}`);
    else if (fragment && target.endsWith(".html")) {
      const ids = byUrl.get(urlOf(target))?.ids ?? idsOf(fs.readFileSync(target, "utf8"));
      if (!ids.has(fragment)) errors.push(`link to a missing part of a page: ${href}`);
    }
  }

  // The picture social sites show.
  const image = attr(meta(html, "property", "og:image") ?? "", "content");
  if (!image) warnings.push("no share picture (og:image)");
  else if (image.startsWith(SITE_URL) && !fileOf(image.slice(SITE_URL.length)))
    errors.push(`share picture missing: ${image}`);

  // Structured data reads as JSON, and a post's has what Google needs.
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const data = JSON.parse(m[1]);
      if (data["@type"] === "BlogPosting")
        for (const key of ["headline", "datePublished"]) if (!data[key]) errors.push(`structured data has no ${key}`);
    } catch (e) {
      errors.push(`structured data isn't valid JSON: ${e.message}`);
    }
  }
}

for (const [label, seen] of [
  ["title", titles],
  ["description", descriptions],
]) {
  for (const [text, urls] of seen)
    if (urls.length > 1)
      for (const url of urls)
        byUrl.get(url).warnings.push(`same ${label} as ${urls.filter((u) => u !== url).join(", ")}: "${text}"`);
}

// --- Posts ---

const feed = fs.existsSync(path.join(OUT, "blog", "feed.xml"))
  ? fs.readFileSync(path.join(OUT, "blog", "feed.xml"), "utf8")
  : "";
const keywords = new Map();

for (const page of pages) {
  const name = /^\/blog\/([^/]+)\/$/.exec(page.url)?.[1];
  if (!name || !page.html.includes('<article class="post"')) continue;
  const { html, errors, warnings } = page;
  const post = readPost(name);
  const start = html.indexOf('<div class="post-body">');
  const end = html.indexOf('<aside class="post-cta"', start);
  const body = start < 0 ? "" : html.slice(start, end < 0 ? undefined : end);
  const h1 = plain(/<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? "");
  const first = plain(/<p\b[^>]*>([\s\S]*?)<\/p>/.exec(body)?.[1] ?? "");

  // The search phrase the post aims at (`keyword:` in its header), used in
  // the title, the address and the first paragraph.
  const keyword = post?.header.keyword;
  page.keyword = keyword;
  if (!keyword) (page.draft ? warnings : errors).push('no keyword: add `keyword: "<search phrase>"` to the header');
  else {
    for (const [where, text] of [
      ["title", h1],
      ["address", name.replace(/-/g, " ")],
      ["first paragraph", first],
    ]) {
      const missing = missingTerms(keyword, text);
      if (missing.length) warnings.push(`the ${where} doesn't use "${missing.join('", "')}" from the keyword`);
    }
    const key = [...new Set(terms(keyword))].sort().join(" ");
    keywords.set(key, [...(keywords.get(key) ?? []), page]);
  }

  // Headings step down one level at a time (## then ###, not ## then ####).
  let level = 1;
  for (const m of body.matchAll(/<h([1-6])\b/g)) {
    const next = Number(m[1]);
    if (next > level + 1) warnings.push(`a heading skips a level (h${level} to h${next})`);
    level = next;
  }

  // Pictures: alt text (screen readers, and search engines), and light.
  for (const m of body.matchAll(/<img\b[^>]*>/g)) {
    const src = attr(m[0], "src") ?? "";
    if (!attr(m[0], "alt")?.trim()) errors.push(`picture without alt text: ${src}`);
    const file = src.startsWith("/") ? fileOf(src) : null;
    if (file && fs.statSync(file).size > IMAGE_MAX)
      warnings.push(
        `picture is ${Math.round(fs.statSync(file).size / 1024)} KB (keep it under ${IMAGE_MAX / 1024}): ${src}`,
      );
  }

  // Length, and links on to the rest of the site.
  page.words = wordCount(plain(body));
  if (page.words < WORDS_MIN) warnings.push(`only ${page.words} words`);
  const internal = [...body.matchAll(/<a\b[^>]*\shref="(\/[^"]*)"/g)].filter((m) => !m[1].startsWith("//"));
  if (!internal.length) warnings.push("no links to other pages on the site");

  // Listed for search engines and feed readers.
  const full = new URL(page.url, SITE_URL).href;
  if (!page.listed) errors.push("not in sitemap.xml");
  if (!feed.includes(full)) errors.push("not in blog/feed.xml");
}

// Two posts aiming at the same search compete with each other.
for (const same of keywords.values())
  if (same.length > 1)
    for (const page of same)
      page.errors.push(
        `same keyword as ${same
          .filter((p) => p !== page)
          .map((p) => p.url)
          .join(", ")}: "${page.keyword}"`,
      );

// --- Report ---

let failed = false;
for (const page of pages) {
  const label = page.draft ? " (draft)" : "";
  const extra = page.words ? ` · ${page.words} words` : "";
  const status = page.errors.length ? "✗" : page.warnings.length ? "!" : "✓";
  console.log(`${status} ${page.url}${label}${extra}`);
  for (const e of page.errors) console.log(`    ✗ ${e}`);
  for (const w of page.warnings) console.log(`    ! ${w}`);
  if (page.errors.length && !page.draft) failed = true;
}
const count = (key) => pages.reduce((n, p) => n + p[key].length, 0);
console.log(`\n${pages.length} pages: ${count("errors")} errors, ${count("warnings")} warnings.`);
if (failed) console.log("A published page has an error (✗): fix it before publishing.");
process.exit(failed ? 1 : 0);
