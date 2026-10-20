// How the published pages do in Google Search, from the Search Console
// API: for each page, the searches that showed it, with impressions,
// clicks, click rate and average position, and what's worth acting on.
//
//   node scripts/seo/console.cjs                 the last 90 days
//   node scripts/seo/console.cjs --days 28
//
// Writes local/seo/console.md and .json.
//
// Needs a service account's key at local/seo/service-account.json, with
// read access to the earbee.org property (README.md in this folder says how
// to set it up; without the key, this prints the steps). The key is signed
// into a token here, with Node's crypto, so nothing needs installing.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { OUT, readPost, postNames, terms, writeReport } = require("./lib.cjs");

const KEY = path.join(OUT, "service-account.json");
const PROPERTY = "sc-domain:earbee.org";
const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
// Search Console's numbers lag by about three days.
const LAG_DAYS = 3;
// What counts as worth acting on.
const LOW_CTR = { impressions: 100, rate: 0.02 };
const NEAR_PAGE_ONE = { from: 8, to: 20, impressions: 20 };
const SHARED = { impressions: 10 };
const UNCOVERED = { impressions: 20 };

const daysArg = process.argv.indexOf("--days");
const DAYS = daysArg > 0 ? Number(process.argv[daysArg + 1]) || 90 : 90;

if (!fs.existsSync(KEY)) {
  console.log(`No Search Console key at ${path.relative(process.cwd(), KEY)}.

To set it up (once; details in scripts/seo/README.md):
  1. Search Console must have the earbee.org property (local/GETTING-FOUND.md, Part 2).
  2. https://console.cloud.google.com: create a project, then enable the "Google Search Console API".
  3. IAM & Admin › Service accounts › Create; then its Keys tab › Add key › JSON.
     Save the file as ${path.relative(process.cwd(), KEY)}.
  4. Search Console › Settings › Users and permissions › Add user:
     the service account's email (in the key file, "client_email"), permission "Restricted".`);
  process.exit(2);
}

const base64url = (data) => Buffer.from(data).toString("base64url");

// A service account's access token: a JWT signed with its private key,
// exchanged at Google's token address.
async function accessToken() {
  const key = JSON.parse(fs.readFileSync(KEY, "utf8"));
  const now = Math.floor(Date.now() / 1000);
  const unsigned = [
    base64url(JSON.stringify({ alg: "RS256", typ: "JWT" })),
    base64url(JSON.stringify({ iss: key.client_email, scope: SCOPE, aud: key.token_uri, iat: now, exp: now + 3600 })),
  ].join(".");
  const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), key.private_key).toString("base64url");
  const response = await fetch(key.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(`Google refused the key: ${data.error_description ?? data.error ?? response.status}`);
  return data.access_token;
}

/** @param {Date} date */
const day = (date) => date.toISOString().slice(0, 10);

async function main() {
  const token = await accessToken();
  const end = new Date(Date.now() - LAG_DAYS * 864e5);
  const start = new Date(end.getTime() - (DAYS - 1) * 864e5);
  const response = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(PROPERTY)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        startDate: day(start),
        endDate: day(end),
        dimensions: ["page", "query"],
        rowLimit: 25000,
      }),
    },
  );
  const data = await response.json();
  if (!response.ok) {
    const message = data.error?.message ?? response.status;
    throw new Error(
      response.status === 403
        ? `No access to ${PROPERTY} (${message}). Add the service account's email as a user in Search Console.`
        : `Search Console answered: ${message}`,
    );
  }
  const rows = (data.rows ?? []).map((r) => ({
    page: r.keys[0],
    query: r.keys[1],
    impressions: r.impressions,
    clicks: r.clicks,
    ctr: r.ctr,
    position: r.position,
  }));

  // --- Per page ---

  const pages = new Map();
  for (const r of rows) pages.set(r.page, [...(pages.get(r.page) ?? []), r]);
  const summary = [...pages.entries()]
    .map(([page, list]) => {
      const impressions = list.reduce((n, r) => n + r.impressions, 0);
      const clicks = list.reduce((n, r) => n + r.clicks, 0);
      return {
        page,
        impressions,
        clicks,
        ctr: impressions ? clicks / impressions : 0,
        queries: list.sort((a, b) => b.impressions - a.impressions),
      };
    })
    .sort((a, b) => b.impressions - a.impressions);

  // --- Worth acting on ---

  const lowCtr = summary.filter((p) => p.impressions >= LOW_CTR.impressions && p.ctr < LOW_CTR.rate);
  const nearPageOne = rows.filter(
    (r) =>
      r.position >= NEAR_PAGE_ONE.from && r.position <= NEAR_PAGE_ONE.to && r.impressions >= NEAR_PAGE_ONE.impressions,
  );
  const byQuery = new Map();
  for (const r of rows)
    if (r.impressions >= SHARED.impressions) byQuery.set(r.query, [...(byQuery.get(r.query) ?? []), r]);
  const shared = [...byQuery.entries()].filter(([, list]) => list.length > 1);
  // Searches no post aims at: none of the posts' keywords shares most of
  // their words. Each is a possible post.
  const keywords = postNames()
    .map((n) => readPost(n).header.keyword)
    .filter(Boolean)
    .map((k) => new Set(terms(k)));
  const totals = new Map();
  for (const r of rows) totals.set(r.query, (totals.get(r.query) ?? 0) + r.impressions);
  const uncovered = [...totals.entries()]
    .filter(([q, n]) => {
      if (n < UNCOVERED.impressions) return false;
      const own = terms(q);
      return !keywords.some((k) => own.filter((t) => k.has(t)).length >= Math.max(1, Math.ceil(k.size * 0.6)));
    })
    .sort((a, b) => b[1] - a[1]);

  // --- The report ---

  const pct = (x) => `${(x * 100).toFixed(1)} %`;
  const pos = (x) => x.toFixed(1);
  const lines = [`# Search Console: ${day(start)} to ${day(end)}`, ""];
  if (!rows.length) lines.push("No searches showed the site in this period yet. A new site takes weeks to months.", "");
  lines.push("## Worth acting on", "");
  lines.push(
    `### Shown often, rarely clicked (${lowCtr.length})`,
    "",
    "Rewrite the title or the description: they're the advertisement in the results.",
    "",
  );
  for (const p of lowCtr) lines.push(`- ${p.page}: ${p.impressions} impressions, ${pct(p.ctr)} clicked`);
  lines.push(
    "",
    `### Close to page one (${nearPageOne.length})`,
    "",
    `Average position ${NEAR_PAGE_ONE.from}–${NEAR_PAGE_ONE.to}: improve the post for this search, link to it from other posts, then set \`updated:\`.`,
    "",
  );
  for (const r of nearPageOne)
    lines.push(`- "${r.query}" → ${r.page}: position ${pos(r.position)}, ${r.impressions} impressions`);
  lines.push(
    "",
    `### One search, several pages (${shared.length})`,
    "",
    "The pages compete: sharpen their keywords, or merge them.",
    "",
  );
  for (const [q, list] of shared)
    lines.push(`- "${q}": ${list.map((r) => `${r.page} (position ${pos(r.position)})`).join(", ")}`);
  lines.push("", `### Searches no post aims at (${uncovered.length})`, "", "Possible new posts (or sections).", "");
  for (const [q, n] of uncovered) lines.push(`- "${q}": ${n} impressions`);
  lines.push("", "## Each page", "");
  for (const p of summary) {
    lines.push(`### ${p.page}`, "", `${p.impressions} impressions, ${p.clicks} clicks (${pct(p.ctr)}).`, "");
    lines.push("| Search | Impressions | Clicks | Click rate | Position |", "| --- | --- | --- | --- | --- |");
    for (const r of p.queries.slice(0, 30))
      lines.push(`| ${r.query} | ${r.impressions} | ${r.clicks} | ${pct(r.ctr)} | ${pos(r.position)} |`);
    lines.push("");
  }
  console.log(`${rows.length} rows, ${summary.length} pages.`);
  writeReport("console", lines.join("\n"), {
    property: PROPERTY,
    startDate: day(start),
    endDate: day(end),
    rows,
    lowCtr,
    nearPageOne,
    shared,
    uncovered,
  });
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
