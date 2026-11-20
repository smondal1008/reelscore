// SEO audit of the built site (dist/), run after every build. Checks follow the claude-seo toolkit
// (github.com/AgriciDaniel/claude-seo): its on-page page checks, schema validation, sitemap and crawl-depth
// checks and AI-readiness checks, applied to every pre-rendered page. Prints a scored summary to the build log.
//
//   node scripts/seo-audit.mjs            audit dist/, print the summary
//   node scripts/seo-audit.mjs --md FILE  also write the full findings as Markdown
//   node scripts/seo-audit.mjs --strict   exit 1 on any Critical finding (the build never uses this)
//
// What needs the live site (Core Web Vitals, response headers, HTTPS, Search Console) is not covered here:
// see seo/README.md for running the full claude-seo audit against the live URL.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const SITE = (process.env.SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? 'https://' + process.env.VERCEL_PROJECT_PRODUCTION_URL : 'https://reelscore-xi.vercel.app')).replace(/\/+$/, '');
const MIN_VERDICTS = Math.max(1, parseInt(process.env.SEO_MIN_VERDICTS, 10) || 10);
const args = process.argv.slice(2);
const mdOut = args.includes('--md') ? args[args.indexOf('--md') + 1] : null;
const strict = args.includes('--strict');

// Thresholds (display heuristics from claude-seo's page checks, not search-engine rules).
const T = { titleMax: 60, titleMin: 15, descMin: 70, descMax: 160, thinWords: 150, maxDepth: 3, urlMax: 100 };
const WEIGHTS = { 'Technical SEO': 22, 'Content Quality': 23, 'On-Page SEO': 20, 'Schema / Structured Data': 10, 'AI Search Readiness': 10, 'Images': 5 };
const SEV = { Critical: 4, High: 3, Medium: 2, Low: 1, Info: 0 };

// ---------- tiny HTML helpers (pages are our own generated markup) ----------
const decode = s => String(s || '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const attr = (tag, name) => { const m = tag.match(new RegExp('\\s' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\')', 'i')); return m ? decode(m[2] ?? m[3]) : null; };
const metaContent = (html, key, val) => { for (const m of html.matchAll(/<meta\b[^>]*>/gi)) if ((attr(m[0], key) || '').toLowerCase() === val) return attr(m[0], 'content'); return null; };
const text = html => decode(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const words = s => (s.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
function prerendered(html) {
  const i = html.indexOf('data-prerendered'); if (i < 0) return null;
  const start = html.indexOf('>', i) + 1; let depth = 1, re = /<(\/?)div\b[^>]*>/gi; re.lastIndex = start; let m;
  while ((m = re.exec(html))) { depth += m[1] ? -1 : 1; if (!depth) return html.slice(start, m.index); }
  return html.slice(start);
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['app', 'js', 'data', 'scripts'].includes(e.name)) walk(f, out); }
    else if (e.name.endsWith('.html') && !/^(setup|404)\.html$/.test(e.name)) out.push(f);
  }
  return out;
}

function main() {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) { console.error('[seo-audit] dist/ not built; run scripts/build.mjs first'); process.exit(strict ? 1 : 0); }
  const findings = [];
  const add = (cat, sev, id, title, detail, pages) => findings.push({ cat, sev, id, title, detail, pages: pages || [] });

  // ---------- load pages ----------
  const pages = new Map();
  for (const f of walk(DIST)) {
    const rel = path.relative(DIST, f).replace(/\\/g, '/');
    const url = rel === 'index.html' ? '/' : '/' + rel.replace(/\.html$/, '').replace(/\/index$/, '');
    // <template> content is inert: browsers and crawlers do not render it or follow its links.
    const html = fs.readFileSync(f, 'utf8').replace(/<template\b[\s\S]*?<\/template>/gi, '');
    const pr = prerendered(html);
    const body = pr ?? html.slice(html.indexOf('<body'));
    const links = [...body.matchAll(/<a\b[^>]*>/gi)].map(m => attr(m[0], 'href')).filter(h => h && h.startsWith('/') && !h.startsWith('//')).map(h => h.split('#')[0]);
    const ld = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)].map(m => { try { return JSON.parse(m[1]); } catch (e) { return { __error: e.message }; } });
    pages.set(url, {
      url, html, pr,
      title: decode((html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '').trim(),
      desc: metaContent(html, 'name', 'description'),
      canonical: (html.match(/<link\b[^>]*rel="canonical"[^>]*>/i) || [null])[0],
      robots: metaContent(html, 'name', 'robots') || '',
      og: { title: metaContent(html, 'property', 'og:title'), desc: metaContent(html, 'property', 'og:description'), image: metaContent(html, 'property', 'og:image') },
      h1: (html.match(/<h1\b/gi) || []).length,
      h1pr: pr ? (pr.match(/<h1\b/gi) || []).length : 0,
      words: words(text(body)),
      links, ld,
      imgs: [...(pr || '').matchAll(/<img\b[^>]*>/gi)].map(m => m[0])
    });
  }
  const kind = u => u === '/' ? 'home' : u.split('/')[1];
  const content = [...pages.values()].filter(p => /^(movie|tv|person)$/.test(kind(p.url)));
  const sample = (list, n = 5) => list.slice(0, n).map(p => p.url || p);

  // ---------- Technical: robots, sitemap, canonicals, crawl paths ----------
  const robotsTxt = fs.existsSync(path.join(DIST, 'robots.txt')) ? fs.readFileSync(path.join(DIST, 'robots.txt'), 'utf8') : null;
  if (!robotsTxt) add('Technical SEO', 'High', 'robots-missing', 'No robots.txt', 'Crawlers get no sitemap pointer or rules.');
  else {
    if (!/^sitemap:\s*https?:\/\//im.test(robotsTxt)) add('Technical SEO', 'Medium', 'robots-no-sitemap', 'robots.txt does not name the sitemap', '');
    if (/^disallow:\s*\/\s*$/im.test(robotsTxt)) add('Technical SEO', 'Critical', 'robots-blocks-all', 'robots.txt blocks the whole site', '');
    for (const p of ['/movie/', '/tv/', '/person/', '/app/', '/catalogue.json']) if (new RegExp('^disallow:\\s*' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'im').test(robotsTxt)) add('Technical SEO', 'High', 'robots-blocks-' + p, 'robots.txt blocks ' + p, 'Pages or resources they need would be hidden from crawlers.');
  }
  const smFile = path.join(DIST, 'sitemap.xml');
  const smUrls = fs.existsSync(smFile) ? [...fs.readFileSync(smFile, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => decode(m[1])) : [];
  if (!smUrls.length) add('Technical SEO', 'High', 'sitemap-missing', 'No sitemap.xml or it is empty', '');
  else {
    const smPaths = new Set(smUrls.map(u => u.replace(SITE, '') || '/'));
    const offSite = smUrls.filter(u => !u.startsWith(SITE));
    if (offSite.length) add('Technical SEO', 'High', 'sitemap-other-host', offSite.length + ' sitemap URLs are on another host', '', offSite.slice(0, 5));
    const notBuilt = [...smPaths].filter(p => !pages.has(p) && !/^\/(browse|people)$/.test(p));
    if (notBuilt.length) add('Technical SEO', 'Medium', 'sitemap-not-prerendered', notBuilt.length + ' sitemap URLs have no pre-rendered page', 'They fall back to the empty app shell for crawlers that do not run JavaScript.', notBuilt.slice(0, 5));
    const missing = content.filter(p => !smPaths.has(p.url));
    if (missing.length) add('Technical SEO', 'Medium', 'sitemap-missing-pages', missing.length + ' pre-rendered pages are not in the sitemap', '', sample(missing));
    if (smUrls.length > 50000) add('Technical SEO', 'High', 'sitemap-too-big', 'Sitemap over 50,000 URLs', 'Split it with a sitemap index.');
  }
  const noCanon = content.filter(p => !p.canonical);
  if (noCanon.length) add('Technical SEO', 'High', 'missing-canonical', noCanon.length + ' pages have no canonical link', '', sample(noCanon));
  const badCanon = content.filter(p => p.canonical && attr(p.canonical, 'href') !== SITE + p.url);
  if (badCanon.length) add('Technical SEO', 'High', 'canonical-not-self', badCanon.length + ' pages have a canonical pointing elsewhere', '', sample(badCanon));
  const noindex = content.filter(p => /noindex/i.test(p.robots));
  if (noindex.length) add('Technical SEO', 'Medium', 'noindex', noindex.length + ' pre-rendered pages are noindex', 'Confirm this is intended.', sample(noindex));
  const longUrl = content.filter(p => (SITE + p.url).length > T.urlMax);
  if (longUrl.length) add('Technical SEO', 'Low', 'long-url', longUrl.length + ' URLs are longer than ' + T.urlMax + ' characters', '', sample(longUrl));
  const hubs = ['/', '/browse', '/people'].filter(u => !pages.get(u) || !pages.get(u).pr);
  if (hubs.length) add('Technical SEO', 'High', 'hubs-not-prerendered', 'Hub pages have no pre-rendered content: ' + hubs.join(', '), 'Without JavaScript they link to no titles or people, so crawlers that do not run scripts cannot reach the catalogue from the home page; only the sitemap leads there.');
  // click depth from home through static links
  const depth = new Map([['/', 0]]); const queue = ['/'];
  while (queue.length) { const u = queue.shift(); for (const l of (pages.get(u) || { links: [] }).links) { const k = l.split('?')[0]; if (pages.has(k) && !depth.has(k)) { depth.set(k, depth.get(u) + 1); queue.push(k); } } }
  const unreachable = content.filter(p => !depth.has(p.url)), deep = content.filter(p => depth.get(p.url) > T.maxDepth);
  if (unreachable.length) add('Technical SEO', unreachable.length > content.length / 2 ? 'High' : 'Medium', 'unreachable-without-js', unreachable.length + ' of ' + content.length + ' pages cannot be reached from the home page through plain links', 'Click-depth check over the static HTML (no JavaScript).', sample(unreachable));
  else if (deep.length) add('Technical SEO', 'Medium', 'deep-pages', deep.length + ' pages are more than ' + T.maxDepth + ' clicks from the home page', '', sample(deep));
  // broken internal links (static)
  const routes = /^\/(browse(\/[a-z-]+)?|people|my-list|admin(\/.*)?)$/;
  const broken = new Map();
  for (const p of pages.values()) for (const l of p.links) { const k = l.split('?')[0]; if (!pages.has(k) && !routes.test(k) && !fs.existsSync(path.join(DIST, k))) broken.set(k, (broken.get(k) || 0) + 1); }
  if (broken.size) add('Technical SEO', 'Medium', 'broken-links', broken.size + ' internal link targets have no page', 'They may still work through the app, but crawlers without JavaScript get the empty shell.', [...broken.keys()].slice(0, 5));
  const shell = pages.get('/');
  if (shell && /href="\/admin/.test(shell.html)) add('Technical SEO', 'Low', 'admin-links-public', 'Admin links are in every page’s HTML', 'They are blocked in robots.txt, so this is tidiness rather than a ranking issue: render admin navigation only for admins.');

  // ---------- On-page: titles, descriptions, headings, social tags ----------
  const noTitle = content.filter(p => !p.title);
  if (noTitle.length) add('On-Page SEO', 'High', 'missing-title', noTitle.length + ' pages have no <title>', '', sample(noTitle));
  const longT = content.filter(p => p.title.length > T.titleMax);
  if (longT.length) add('On-Page SEO', longT.length > content.length * 0.2 ? 'Medium' : 'Low', 'title-too-long', longT.length + ' titles are longer than ' + T.titleMax + ' characters (may be cut off in results)', '', sample(longT));
  const tCount = new Map(); content.forEach(p => tCount.set(p.title, (tCount.get(p.title) || 0) + 1));
  const dupT = content.filter(p => tCount.get(p.title) > 1);
  if (dupT.length) add('On-Page SEO', 'Medium', 'duplicate-title', dupT.length + ' pages share their title with another page', 'Usually same title and year in different languages; add the language to tell them apart.', sample(dupT, 6));
  const noDesc = content.filter(p => !p.desc);
  if (noDesc.length) add('On-Page SEO', 'High', 'missing-description', noDesc.length + ' pages have no meta description', '', sample(noDesc));
  const shortD = content.filter(p => p.desc && p.desc.length < T.descMin), longD = content.filter(p => p.desc && p.desc.length > T.descMax);
  if (shortD.length) add('On-Page SEO', 'Low', 'description-short', shortD.length + ' descriptions are under ' + T.descMin + ' characters', '', sample(shortD));
  if (longD.length) add('On-Page SEO', 'Low', 'description-long', longD.length + ' descriptions are over ' + T.descMax + ' characters', '', sample(longD));
  const dCount = new Map(); content.forEach(p => p.desc && dCount.set(p.desc, (dCount.get(p.desc) || 0) + 1));
  const dupD = content.filter(p => p.desc && dCount.get(p.desc) > 1);
  if (dupD.length) add('On-Page SEO', 'Medium', 'duplicate-description', dupD.length + ' pages share a meta description', '', sample(dupD));
  const h1Bad = content.filter(p => p.h1pr !== 1);
  if (h1Bad.length) add('On-Page SEO', 'Medium', 'h1-in-content', h1Bad.length + ' pages do not have exactly one H1 in their content', '', sample(h1Bad));
  const multiH1 = content.filter(p => p.h1 > 1);
  if (multiH1.length) add('On-Page SEO', 'Low', 'multiple-h1', multiH1.length + ' pages have more than one H1 in the full HTML', 'The page shell carries its own H1 (the admin heading) next to the content’s.', sample(multiH1, 3));
  const noOg = content.filter(p => !p.og.title || !p.og.desc);
  if (noOg.length) add('On-Page SEO', 'Medium', 'missing-og', noOg.length + ' pages lack og:title or og:description', '', sample(noOg));
  const noOgImg = content.filter(p => !p.og.image);
  if (noOgImg.length) add('On-Page SEO', noOgImg.length > content.length / 2 ? 'Medium' : 'Low', 'missing-og-image', noOgImg.length + ' of ' + content.length + ' pages have no og:image', 'Shared links show no preview image. A site-wide default image fixes the gap; generated poster cards are the stronger fix.', sample(noOgImg));

  // ---------- Content ----------
  const thin = content.filter(p => p.words < T.thinWords);
  const byKind = k => content.filter(p => kind(p.url) === k);
  const med = arr => { const s = arr.map(p => p.words).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  if (thin.length) add('Content Quality', thin.length > content.length / 2 ? 'High' : 'Medium', 'thin-content', thin.length + ' of ' + content.length + ' pages have under ' + T.thinWords + ' words of content',
    'Median words: titles ' + med(byKind('movie')) + ', people ' + med(byKind('person')) + '. Google has no minimum word count; the gap is in what a visitor gets: most title pages have no synopsis, most people have no bio.', sample(thin));
  const titles = [...byKind('movie'), ...byKind('tv')];
  const noStory = titles.filter(p => !/<h2>Story<\/h2>/.test(p.pr || ''));
  if (noStory.length) add('Content Quality', noStory.length > titles.length / 2 ? 'High' : 'Medium', 'no-synopsis', noStory.length + ' of ' + titles.length + ' title pages have no synopsis', 'A short original synopsis is the single biggest content gain per page.', sample(noStory));
  const unrated = titles.filter(p => !/class="pr-score"/.test(p.pr || ''));
  if (unrated.length === titles.length) add('Content Quality', 'Medium', 'no-verdicts', 'No title has any verdicts yet', 'User verdicts and reviews are Reelscore’s unique content; until they exist, pages repeat facts found on many other sites.');
  if (!pages.has('/about') && !fs.existsSync(path.join(DIST, 'about.html'))) add('Content Quality', 'Medium', 'no-about', 'No About or “How scores work” page', 'Trust signals (E-E-A-T): who runs the site, how verdicts become a score, and how reviews are moderated.');

  // ---------- Schema ----------
  let ldErr = 0, ldMissing = [], ratingBad = [], ldTypes = new Map();
  for (const p of content) {
    if (!p.ld.length) { ldMissing.push(p); continue; }
    for (const o of p.ld) {
      if (o.__error) { ldErr++; continue; }
      ldTypes.set(o['@type'], (ldTypes.get(o['@type']) || 0) + 1);
      if (o['@context'] !== 'https://schema.org') ldErr++;
      if (/^(Movie|TVSeries|Person)$/.test(o['@type']) && (!o.name || !o.url)) ldErr++;
      const r = o.aggregateRating;
      if (r && (!(r.ratingCount >= MIN_VERDICTS) || !(r.ratingValue >= (r.worstRating ?? 0) && r.ratingValue <= (r.bestRating ?? 5)))) ratingBad.push(p);
    }
  }
  if (ldMissing.length) add('Schema / Structured Data', 'Medium', 'schema-missing', ldMissing.length + ' pages have no JSON-LD', '', sample(ldMissing));
  if (ldErr) add('Schema / Structured Data', 'High', 'schema-invalid', ldErr + ' JSON-LD blocks fail to parse or miss required fields', '');
  if (ratingBad.length) add('Schema / Structured Data', 'High', 'rating-invalid', ratingBad.length + ' pages carry an AggregateRating below the ' + MIN_VERDICTS + '-verdict threshold or out of range', '', sample(ratingBad));
  if (shell && !/application\/ld\+json/.test(shell.html)) add('Schema / Structured Data', 'Low', 'no-website-schema', 'Home page has no WebSite / Organization schema', 'Adds the site name and a search box hint in results.');

  // ---------- Images ----------
  const imgs = content.flatMap(p => p.imgs.map(t => ({ p, t })));
  const noAlt = imgs.filter(i => !attr(i.t, 'alt')), noDim = imgs.filter(i => !attr(i.t, 'width') || !attr(i.t, 'height'));
  if (noAlt.length) add('Images', 'Medium', 'img-no-alt', noAlt.length + ' images have no alt text', '', sample(noAlt.map(i => i.p)));
  if (noDim.length) add('Images', 'Low', 'img-no-size', noDim.length + ' images have no width/height (layout shift)', '', sample(noDim.map(i => i.p)));
  const withImg = content.filter(p => p.imgs.length).length;
  if (withImg < content.length / 2) add('Images', 'Medium', 'few-images', 'Only ' + withImg + ' of ' + content.length + ' pages have an image', 'Most titles have no poster and most people no photo; image search and rich results need them.');
  const lcpHint = titles.filter(p => p.imgs.length && !/fetchpriority="high"/.test(p.imgs[0]));
  if (lcpHint.length) add('Images', 'Low', 'lcp-priority', lcpHint.length + ' poster images lack fetchpriority="high"', 'The poster is usually the largest element on the first screen.', sample(lcpHint));

  // ---------- AI search readiness ----------
  if (!fs.existsSync(path.join(DIST, 'llms.txt'))) add('AI Search Readiness', 'Low', 'no-llms-txt', 'No /llms.txt', 'Optional community file (Lighthouse counts it; Google ignores it): a short Markdown summary of the site with key links.');
  if (hubs.includes('/')) add('AI Search Readiness', 'Medium', 'home-js-only', 'The home page has no content without JavaScript', 'AI fetchers that do not run scripts see a near-empty page.');
  const prShare = content.filter(p => p.pr).length / Math.max(1, content.length);
  if (prShare < 1) add('AI Search Readiness', 'Medium', 'not-prerendered', Math.round((1 - prShare) * 100) + '% of content pages are not pre-rendered', '');

  // ---------- score ----------
  const cats = Object.keys(WEIGHTS);
  const score = {};
  for (const c of cats) {
    const fs_ = findings.filter(f => f.cat === c);
    const pen = fs_.reduce((s, f) => s + ({ Critical: 40, High: 18, Medium: 8, Low: 3, Info: 0 })[f.sev], 0);
    score[c] = Math.max(0, 100 - pen);
  }
  const total = Math.round(cats.reduce((s, c) => s + score[c] * WEIGHTS[c], 0) / cats.reduce((s, c) => s + WEIGHTS[c], 0));
  findings.sort((a, b) => SEV[b.sev] - SEV[a.sev] || a.cat.localeCompare(b.cat));

  // ---------- output ----------
  const counts = Object.fromEntries(Object.keys(SEV).map(s => [s, findings.filter(f => f.sev === s).length]));
  console.log(`[seo-audit] ${content.length} pages (${byKind('movie').length} movies, ${byKind('tv').length} TV, ${byKind('person').length} people), sitemap ${smUrls.length} URLs, site ${SITE}`);
  console.log(`[seo-audit] score ${total}/100 (build-time checks; performance needs the live site) · ` + cats.map(c => c.replace(/ \/ .*| SEO| Quality| Search Readiness/, '') + ' ' + score[c]).join(' · '));
  console.log(`[seo-audit] findings: ${counts.Critical} critical, ${counts.High} high, ${counts.Medium} medium, ${counts.Low} low`);
  for (const f of findings) console.log(`[seo-audit]   ${f.sev.padEnd(8)} ${f.title}${f.pages.length ? '  e.g. ' + f.pages.slice(0, 2).join(', ') : ''}`);

  if (mdOut) {
    const lines = ['# Reelscore SEO audit (build-time checks)', '', `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC from \`dist/\` by \`scripts/seo-audit.mjs\` (checks follow the claude-seo toolkit).`, '',
      `**Score: ${total}/100.** Content pages: ${content.length}. Sitemap URLs: ${smUrls.length}.`, '', '| Category | Weight | Score |', '|---|---|---|',
      ...cats.map(c => `| ${c} | ${WEIGHTS[c]}% | ${score[c]} |`), '', 'Performance (Core Web Vitals) needs the live site and is not scored here.', ''];
    for (const s of Object.keys(SEV)) {
      const fs_ = findings.filter(f => f.sev === s); if (!fs_.length) continue;
      lines.push('## ' + s, '');
      for (const f of fs_) lines.push(`- **${f.title}** (${f.cat}, \`${f.id}\`)${f.detail ? ': ' + f.detail : ''}${f.pages.length ? ' Examples: ' + f.pages.slice(0, 5).map(u => '`' + u + '`').join(', ') + '.' : ''}`);
      lines.push('');
    }
    fs.mkdirSync(path.dirname(path.resolve(mdOut)), { recursive: true });
    fs.writeFileSync(mdOut, lines.join('\n'));
    console.log('[seo-audit] wrote ' + mdOut);
  }
  if (strict && counts.Critical) process.exit(1);
}

try { main(); } catch (e) { console.error('[seo-audit] failed (build continues):', e && e.stack || e); process.exit(strict ? 1 : 0); }
