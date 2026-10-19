# SEO tools for earbee.org

Tools for checking and improving how the website's pages, especially the blog posts, do in search engines. They're kept apart from everything else on purpose: to remove them, see [the end](#removing-them).

How to write and publish a post is in [docs/blog.md](../../docs/blog.md); this is only the analysis.

## The tools

All three run from the project folder with plain Node: nothing to install beyond the site's own `npm --prefix site install`. Reports go to `local/seo/`, which stays on this computer.

| Command                                             | What it does                                                                                                                                                                                                                                                               |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node scripts/seo/check.cjs`                        | **On-page check** of every page, drafts included: titles, descriptions, canonical links, headings, links, pictures, structured data, and each post's keyword. `✗` is an error, `!` a warning. CI runs it (`.github/workflows/seo.yml`); only a published page's `✗` fails. |
| `node scripts/seo/keywords.cjs <post-name>`         | **What people search** around the post's `keyword:`, from Google's search suggestions, and which of those searches the post already answers. Writes `local/seo/<post-name>.md`.                                                                                            |
| `node scripts/seo/keywords.cjs --phrase "<phrase>"` | The same before a post exists, to choose its topic and keyword.                                                                                                                                                                                                            |
| `node scripts/seo/console.cjs`                      | **How published pages do**, from Google Search Console: the searches that show each page, impressions, clicks, position, and what's worth acting on. Writes `local/seo/console.md`. Needs a key: see [Search Console](#search-console-once).                               |

Options for `keywords.cjs`:

- `--also "<phrase>"` expands more phrases (repeatable), such as other wordings of the topic.
- `--fresh` asks Google again instead of using the week-old cache.

It's polite with Google: about 60 requests, spaced out, and it stops at the first refusal.

## The keyword

Each post names the search it aims at in its header:

```yaml
keyword: "why transcribe songs by ear"
```

One phrase per post, never shared by two posts (they'd compete for the same search; `check.cjs` says so). The check looks for its words in the title, the address and the first paragraph, compared loosely ("transcribing" counts for "transcribe").

## Analysing a post (for the assistant)

When the owner asks to analyse a post for SEO:

1. **Collect.** Run `check.cjs`, `keywords.cjs <post>` (with `--also` for a wording or two that searchers might use instead), and `console.cjs` if `local/seo/service-account.json` exists. Read the reports in `local/seo/`.
2. **Look at the competition.** Web-search the keyword and the two or three strongest suggestions (most _seen_). For the top results, note:
   - what kind of page ranks (a list of reasons, a how-to, a comparison, a forum thread);
   - how long they are, and what they cover that the post doesn't;
   - whether big sites fill the first page. If they do, a new site won't get in; suggest a narrower phrase.
3. **Recommend,** briefly, in this order:
   - **The keyword:** keep it, or a better phrase from the suggestions. The address can change only while the post is a draft.
   - **The title and the description.**
   - **Questions to answer, or sections to add,** from the suggestions marked "not covered" or "partly", where they fit the post.
   - **Searchers' wording** the post could use where it reads naturally.
   - **Links** to and from other posts.
4. **The owner decides,** and edits happen only on request.

**Rules for the recommendations:**

- No keyword stuffing.
- Nothing that makes the post sound generic.
- The blog's rules apply: EarBee's features in general terms (no exact ranges), and "a free, open-source player" where EarBee is introduced.

## Reading how posts do (monthly)

`node scripts/seo/console.cjs`, then the report's "Worth acting on":

- **Shown often, rarely clicked:** the title or description doesn't make people click. Rewrite them.
- **Close to page one** (average position 8–20): improve the post for that search, link to it from other posts, and set `updated:` in its header.
- **One search, several pages:** they compete. Sharpen their keywords, or merge the posts.
- **Searches no post aims at:** ideas for new posts or sections.

A new site takes three to six months to get real search traffic, so expect empty reports at first. The site has no analytics (the home page promises no tracking), and Search Console needs none.

## Search Console (once)

`console.cjs` reads Search Console through Google's API, with a **service account**: a robot Google account that only you control, with read-only access.

1. **Search Console must have the site first:** `local/GETTING-FOUND.md`, Part 2 (the `earbee.org` domain property).
2. **Make a Google Cloud project:**
   - Open https://console.cloud.google.com and sign in with the same Google account.
   - Make a new project (top bar → project picker → **New project**), for example "earbee-seo". It's free, and the API needs no billing.
3. **Turn on the API.** **APIs & Services › Library**, search for **Google Search Console API**, then **Enable**.
4. **Make the service account and its key:**
   - **IAM & Admin › Service accounts › Create service account.** Give it a name ("seo-reader"), then **Done**; it needs no roles.
   - Open it, then go to **Keys › Add key › Create new key › JSON**. A file downloads.
   - Move the file to `local/seo/service-account.json` in the project folder.
   - **Keep the file private.** It's the account's password. `local/` is never committed.
5. **Let it read Search Console.** In Search Console, go to **Settings › Users and permissions › Add user**:
   - the email: the service account's, which is `client_email` in the key file (`…@….iam.gserviceaccount.com`);
   - the permission: **Restricted**.
6. **Check it works:** `node scripts/seo/console.cjs` writes `local/seo/console.md`.

To revoke access: remove the user in Search Console, or delete the key in Google Cloud.

## Removing them

Delete:

- this folder, `scripts/seo/`;
- `.github/workflows/seo.yml`;
- the line about it in `AGENTS.md` ("Which checks for which change", the website row);
- optionally `local/seo/` (the reports, the cache and the key).

The `keyword:` lines in the posts' headers can stay: the site ignores them.
