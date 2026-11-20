# SEO audits for Reelscore

Audits follow the [claude-seo](https://github.com/AgriciDaniel/claude-seo) toolkit (v2.6.2): its full-site audit
process, category weights and checklists (technical, content, on-page, schema, performance, images, AI search
readiness). There are two levels.

## 1. Automatic: every deploy

Vercel's build runs `node scripts/build.mjs && node scripts/seo-audit.mjs`. The audit reads every page in `dist/`
and prints a scored summary at the end of the build log (Vercel › Deployments › a deployment › Build Logs, lines
starting `[seo-audit]`). It never fails a deploy.

What it checks, on every pre-rendered page:

| Area | Checks |
|---|---|
| Technical | robots.txt rules and sitemap pointer; sitemap ↔ pages match; self-referencing canonicals; noindex; URL length; hub pages pre-rendered; click depth from the home page through plain links; broken internal links; admin links in public HTML |
| On-page | title present, length, duplicates; meta description present, length, duplicates; one H1 in content; Open Graph title, description, image |
| Content | words of content per page; synopsis coverage; whether any verdicts exist; About / methodology page |
| Schema | JSON-LD parses; required fields; AggregateRating only at or above `SEO_MIN_VERDICTS` and in range; WebSite schema on home |
| Images | alt text; width/height; share of pages with an image; `fetchpriority` on the poster |
| AI search | `/llms.txt`; home page content without JavaScript; share of pages pre-rendered |

Run it locally after a build:

```bash
node scripts/build.mjs                      # or FIXTURE=file.json node scripts/build.mjs
node scripts/seo-audit.mjs --md seo/latest.md
```

## 2. Full audit with claude-seo (live site)

Some checks need the live site and outside data: Core Web Vitals, real response headers and TLS, Search Console
indexing, backlinks. Run the full toolkit from Claude Code:

```
/plugin marketplace add AgriciDaniel/claude-seo
/plugin install claude-seo
/seo audit https://reelscore-xi.vercel.app
```

Useful single checks from the same plugin: `/seo technical <url>` (headers, TLS, rendering), `/seo page <url>`
(one title page), `/seo schema <url>`, `/seo geo <url>` (AI search). Free Google field data needs a
PageSpeed Insights API key; Search Console data needs the site verified in Search Console (see the plugin's
`seo-google` skill). Save results next to this file as `AUDIT-<date>.md` so they can be compared over time.

Suggested rhythm: glance at the build log after big imports; run the full audit monthly, and after any change to
page templates, URLs or `robots.txt`.
