// What every post in this folder shares: its layout, its place among the
// posts (the blog page, the feed and the sitemap list them), and its
// address, /blog/<file name>/. A post's own header only needs its title,
// description and date (docs/blog.md).
export default {
  layout: "post.njk",
  tags: "posts",
  eleventyComputed: {
    // Computed rather than "/blog/{{ page.fileSlug }}/": posts are plain
    // Markdown (eleventy.config.js), so a template string isn't filled in.
    permalink: (data) => `/blog/${data.page.fileSlug}/`,
  },
};
