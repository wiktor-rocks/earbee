// Builds earbee.org from this folder with Eleventy: the landing page
// (index.html) and the blog (blog/*.md) share one layout (_includes/), and
// the result goes to _site/, which pages.yml publishes. `npm start` shows
// it at http://localhost:8080 and reloads on every save. How to write and
// publish a post: docs/blog.md at the top of the repository.
import { feedPlugin } from "@11ty/eleventy-plugin-rss";
import site from "./_data/site.json" with { type: "json" };

// `npm start` (serve) shows drafts; `npm run build`, what's published,
// leaves them out.
const preview = process.env.ELEVENTY_RUN_MODE !== "build";

/** @param {import("@11ty/eleventy").UserConfig} config */
export default function (config) {
  // Copied as they are: the assets, the page's script, and robots.txt.
  for (const path of ["fonts", "img", "style.css", "download.js", "robots.txt"]) {
    config.addPassthroughCopy(path);
  }
  // Not pages: this folder's README, and a build's output (also when it
  // was sent elsewhere with --output, leaving an older _site/ here).
  config.ignores.add("README.md");
  config.ignores.add("_site/**");

  // A post with `draft: true` in its header: in the preview only.
  config.addPreprocessor("drafts", "*", (data) => {
    if (data.draft && !preview) return false;
  });

  // The blog's RSS feed, /blog/feed.xml, from the posts (newest first).
  config.addPlugin(feedPlugin, {
    type: "rss",
    outputPath: "/blog/feed.xml",
    collection: { name: "posts", limit: 20 },
    metadata: {
      language: "en",
      title: site.blogTitle,
      subtitle: site.blogDescription,
      base: `${site.url}/`,
      author: { name: site.author },
    },
  });

  // Dates. Posts give a day (`date: 2026-10-19`), which Eleventy reads as
  // midnight UTC, so they're shown in UTC: the same day everywhere.
  config.addFilter("readableDate", (date) =>
    new Date(date).toLocaleDateString("en-GB", { dateStyle: "long", timeZone: "UTC" }),
  );
  config.addFilter("isoDate", (date) => new Date(date).toISOString().slice(0, 10));

  // Minutes to read a post, at about 220 words a minute. A post's own
  // script and styles (a calculator, say) aren't read, so they don't count.
  config.addFilter("readingTime", (html) => {
    const words = String(html)
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/g, " ")
      .replace(/<[^>]+>/g, " ")
      .split(/\s+/)
      .filter(Boolean).length;
    return `${Math.max(1, Math.round(words / 220))} min read`;
  });

  // An address on the site, made absolute (canonical links, Open Graph,
  // the sitemap): "/blog/x/" → "https://earbee.org/blog/x/".
  config.addFilter("absolute", (path) => new URL(path, site.url).href);
}

export const config = {
  dir: { input: ".", output: "_site" },
  // index.html may use Nunjucks ({{ }}, {% %}), like the layouts. Posts are
  // plain Markdown: braces in them are just text.
  htmlTemplateEngine: "njk",
  markdownTemplateEngine: false,
};
