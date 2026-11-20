// Build step for Vercel: copies the site into dist/ and pre-renders a page for every title and person,
// so search engines and link previews see real titles, descriptions, cast and structured data
// without running the app. The app still loads on top and takes over as before.
//
//   node scripts/build.mjs                 reads the live catalogue from Firestore (public read rules)
//   FIXTURE=file.json node scripts/build.mjs   uses {movies, people, verdicts} from a local file (tests)
//
// Settings (Vercel environment variables, all optional):
//   SITE_URL            canonical origin, e.g. https://reelscore.in (default: the production domain)
//   SEO_MIN_VERDICTS    verdicts a title needs before its score goes into search markup (default 10)
//   SEO_MIN_CREDITS     titles a person needs before they get a pre-rendered page (default 2)
//   FULL_REFRESH=1      read every title and person from Firestore even if the last catalogue is recent
//
// It also writes /catalogue.json (every title and person), which the app loads instead of reading the whole
// collection from Firestore on every visit. To keep deploys cheap too, a deploy within 24 hours of the last full
// read starts from the live catalogue.json and fetches only records changed since (updatedAt), plus deletions.
// If Firestore refuses (e.g. the daily free quota is used up), the build reuses the live catalogue unchanged.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist');
const SITE = (process.env.SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? 'https://' + process.env.VERCEL_PROJECT_PRODUCTION_URL : 'https://reelscore-xi.vercel.app')).replace(/\/+$/, '');
const MIN_VERDICTS = Math.max(1, parseInt(process.env.SEO_MIN_VERDICTS, 10) || 10);
const MIN_CREDITS = Math.max(1, parseInt(process.env.SEO_MIN_CREDITS, 10) || 2);
const SKIP = new Set(['dist', 'scripts', 'node_modules', 'README.md', 'package.json', 'package-lock.json', 'vercel.json', 'firestore.rules']);

// ---------- helpers shared with the app (keep in step with app/main.js) ----------
const slugify = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
const personSlug = n => String(n || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
const CREW_RE = /(director|producer|music|writer|screenplay|composer|cinematograph|editor)/i;
const VERD = {
  theatre: [['a', 'Theatre'], ['b', 'OTT'], ['c', 'Skip']],
  ott: [['a', 'Must watch'], ['b', 'Watch'], ['c', 'Skip']]
};
const isTv = d => d.section === 'TV shows';
const isOtt = d => d.section === 'On OTT';
function movieSlug(m) {
  const own = slugify(m.data.slug); if (own) return own;
  const base = slugify(m.data.title) || m.id, y = (m.data.releaseDate || '').slice(0, 4);
  return /^\d{4}$/.test(y) ? base + '-' + y : base;
}
const movieUrl = m => (isTv(m.data) ? '/tv/' : '/movie/') + movieSlug(m);
const safeUrl = u => (typeof u === 'string' && /^https:\/\//.test(u)) ? u : '';
const year = d => (d.releaseDate || '').slice(0, 4);
function tvYears(d) { const a = year(d), b = String(d.endYear || '').trim(); if (!a) return b; return b ? (b === a ? a : a + '–' + b) : a + '–present'; }
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function fmtDate(iso) { if (!iso) return ''; if (/^\d{4}$/.test(iso)) return iso; const p = iso.split('-'); return p.length === 3 ? (+p[2]) + ' ' + MONTHS[+p[1] - 1] + ' ' + p[0] : iso; }

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ld = o => '<script type="application/ld+json">' + JSON.stringify(o).replace(/</g, '\\u003c') + '</script>';
function clip(s, n) { s = String(s || '').replace(/\s+/g, ' ').trim(); if (s.length <= n) return s; const c = s.slice(0, n - 1); return c.slice(0, Math.max(c.lastIndexOf(' '), n - 20)).replace(/[,;:.\s]+$/, '') + '…'; }
function list(names) { return names.length < 2 ? names.join('') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]; }
function isoDuration(rt) {
  const s = String(rt || '').toLowerCase(); let h = 0, m = 0, x;
  if ((x = s.match(/(\d+)\s*h/))) h = +x[1];
  if ((x = s.match(/(\d+)\s*m/))) m = +x[1];
  if (!h && !m && (x = s.match(/^(\d+)$/))) m = +x[1];
  return h || m ? 'PT' + (h ? h + 'H' : '') + (m ? m + 'M' : '') : undefined;
}

// ---------- data ----------
function decode(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decode);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields || {});
  return null;
}
function decodeFields(f) { const o = {}; for (const k of Object.keys(f)) o[k] = decode(f[k]); return o; }

function firestoreClient() {
  const cfgSrc = fs.readFileSync(path.join(ROOT, 'firebase-config.js'), 'utf8');
  const project = (cfgSrc.match(/projectId:\s*"([^"]+)"/) || [])[1];
  const key = (cfgSrc.match(/apiKey:\s*"([^"]+)"/) || [])[1];
  if (!project) throw new Error('No projectId in firebase-config.js');
  const root = 'projects/' + project + '/databases/(default)/documents';
  const base = 'https://firestore.googleapis.com/v1/' + root;
  let useKey = !!key, reads = 0;
  async function call(url, init) {
    let r;
    for (let attempt = 0; attempt < 3; attempt++) {
      r = await fetch(url + (useKey ? (url.includes('?') ? '&' : '?') + 'key=' + key : ''), init);
      // A browser key restricted to the site's domain is refused from the build server; public reads work without it.
      if (r.status === 403 && useKey) { useKey = false; attempt--; continue; }
      if (r.ok || r.status === 404 || (r.status < 500 && r.status !== 429)) break;
      if (r.status === 429 && attempt === 1) break;
      await new Promise(res => setTimeout(res, 1500 * (attempt + 1)));
    }
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('Firestore HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
    return r.json();
  }
  const toDoc = d => ({ id: decodeURIComponent(d.name.split('/').pop()), data: decodeFields(d.fields || {}), updated: d.updateTime || '' });
  return {
    get reads() { return reads; },
    async list(name) {
      const out = []; let tok = '';
      do {
        const j = await call(base + '/' + name + '?pageSize=300' + (tok ? '&pageToken=' + encodeURIComponent(tok) : ''));
        ((j && j.documents) || []).forEach(d => out.push(toDoc(d)));
        tok = (j && j.nextPageToken) || '';
      } while (tok);
      reads += out.length || 1;
      return out;
    },
    async changedSince(name, iso) {
      const j = await call(base + ':runQuery', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ structuredQuery: {
        from: [{ collectionId: name }], where: { fieldFilter: { field: { fieldPath: 'updatedAt' }, op: 'GREATER_THAN', value: { stringValue: iso } } } } }) });
      const out = (j || []).filter(x => x.document).map(x => toDoc(x.document));
      reads += out.length || 1;
      return out;
    },
    async get(p) { const j = await call(base + '/' + p); reads++; return j ? toDoc(j) : null; }
  };
}

async function previousCatalogue() {
  try {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 20000);
    const r = await fetch(SITE + '/catalogue.json', { signal: ctl.signal }); clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    return j && Array.isArray(j.movies) && j.builtAt ? j : null;
  } catch (e) { return null; }
}

// Returns { movies, people, verdicts, builtAt, fullAt, source }.
async function loadData() {
  if (process.env.FIXTURE) { const f = loadFixture(process.env.FIXTURE); return { ...f, builtAt: new Date().toISOString(), fullAt: new Date().toISOString(), source: 'fixture' }; }
  // scripts/catalogue-seed.json (if present) stands in for the live file on the very first deploy.
  let prev = await previousCatalogue();
  const seedFile = path.join(ROOT, 'scripts', 'catalogue-seed.json');
  if (!prev && fs.existsSync(seedFile)) { prev = JSON.parse(fs.readFileSync(seedFile, 'utf8')); console.log('[seo] no live catalogue.json; starting from scripts/catalogue-seed.json (' + prev.builtAt + ')'); }
  const fromPrev = () => ({ movies: prev.movies.map(m => ({ id: m.id, data: m.data, updated: '' })), people: Object.entries(prev.people || {}).map(([id, data]) => ({ id, data, updated: '' })) });
  const db = firestoreClient(), started = new Date().toISOString();
  const fresh = prev && prev.fullAt && (Date.now() - Date.parse(prev.fullAt)) < 24 * 3600 * 1000 && !process.env.FULL_REFRESH;
  try {
    if (fresh) {
      const since = new Date(Date.parse(prev.builtAt) - 3600 * 1000).toISOString();
      const [dm, dp, del, verdicts] = await Promise.all([db.changedSince('movies', since), db.changedSince('people', since), db.get('settings/deleted'), db.list('verdicts')]);
      const tomb = { movies: {}, people: {} }; ((del && del.data) || {}).movies?.forEach(x => x && x.id && (tomb.movies[x.id] = x.at || ''));
      ((del && del.data) || {}).people?.forEach(x => x && x.id && (tomb.people[x.id] = x.at || ''));
      const merge = (baseList, delta, t) => {
        const m = new Map(baseList.map(x => [x.id, x])); delta.forEach(x => m.set(x.id, x));
        return [...m.values()].filter(x => !(t[x.id] && (!x.data.updatedAt || t[x.id] > x.data.updatedAt)));
      };
      const p = fromPrev();
      console.log(`[seo] incremental: ${dm.length} titles and ${dp.length} people changed since ${since}; ${db.reads} reads`);
      return { movies: merge(p.movies, dm, tomb.movies), people: merge(p.people, dp, tomb.people), verdicts, builtAt: started, fullAt: prev.fullAt, source: 'incremental' };
    }
    const [movies, people, verdicts] = await Promise.all([db.list('movies'), db.list('people'), db.list('verdicts')]);
    console.log(`[seo] full read: ${db.reads} reads`);
    return { movies, people, verdicts, builtAt: started, fullAt: started, source: 'full' };
  } catch (e) {
    if (!prev) throw e;
    // Keep builtAt from the previous file so the app still asks for every change made since then.
    console.warn('[seo] Firestore unavailable (' + e.message + '); reusing the live catalogue.json from ' + prev.builtAt);
    return { ...fromPrev(), verdicts: [], builtAt: prev.builtAt, fullAt: prev.fullAt, source: 'previous' };
  }
}

function loadFixture(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const wrap = (arr) => (arr || []).map(x => x.data ? x : { id: x.id, data: Object.fromEntries(Object.entries(x).filter(([k]) => k !== 'id')), updated: x.updated || '' });
  return { movies: wrap(j.movies), people: wrap(j.people), verdicts: wrap(j.verdicts) };
}

// ---------- output helpers ----------
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (e.name.startsWith('.') || (from === ROOT && SKIP.has(e.name))) continue;
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
}
function write(rel, content) { const f = path.join(OUT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); }

function page(shell, { title, description, canonical, ogType, image, wide, jsonld, route, body, robots }) {
  const head = [
    '<title>' + esc(title) + '</title>',
    '<meta name="description" content="' + esc(description) + '">',
    robots ? '<meta name="robots" content="' + robots + '">' : '',
    '<link rel="canonical" href="' + esc(SITE + canonical) + '">',
    '<meta property="og:site_name" content="Reelscore">',
    '<meta property="og:type" content="' + ogType + '">',
    '<meta property="og:title" content="' + esc(title) + '">',
    '<meta property="og:description" content="' + esc(description) + '">',
    '<meta property="og:url" content="' + esc(SITE + canonical) + '">',
    image ? '<meta property="og:image" content="' + esc(image) + '">' : '',
    '<meta name="twitter:card" content="' + (image && wide ? 'summary_large_image' : 'summary') + '">',
    image ? '<meta name="twitter:image" content="' + esc(image) + '">' : '',
    ...(jsonld || []).map(ld)
  ].filter(Boolean).join('\n');
  let html = shell.replace(/<!--seo-->[\s\S]*?<!--\/seo-->/, '<!--seo-->\n' + head + '\n<!--/seo-->');
  html = html.replace('<body class="r-home">', '<body class="r-' + route + '">');
  const slot = '<div class="view" id="view-' + route + '"></div>';
  if (!html.includes(slot)) throw new Error('index.html is missing ' + slot);
  return html.replace(slot, '<div class="view" id="view-' + route + '"><div class="pr" data-prerendered>' + body + '</div></div>');
}

// ---------- main ----------
async function main() {
  const t0 = Date.now();
  const data = await loadData();
  console.log(`[seo] ${data.movies.length} titles, ${data.people.length} people docs, ${data.verdicts.length} verdict docs (${data.source})`);

  fs.rmSync(OUT, { recursive: true, force: true });
  copyDir(ROOT, OUT);
  const shell = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  if (!/<!--seo-->[\s\S]*?<!--\/seo-->/.test(shell)) throw new Error('index.html has no <!--seo--> block');

  // scores, same rule as the app: % of verdicts that are a or b
  const counts = {};
  data.verdicts.forEach(u => { const v = (u.data && u.data.v) || {}; for (const id of Object.keys(v)) { if (!/^[abc]$/.test(v[id])) continue; (counts[id] = counts[id] || { a: 0, b: 0, c: 0 })[v[id]]++; } });
  const score = id => { const n = counts[id] || { a: 0, b: 0, c: 0 }, tot = n.a + n.b + n.c; return { n, tot, pct: tot ? Math.round(100 * (n.a + n.b) / tot) : null }; };

  const people = {}; data.people.forEach(p => { people[p.id] = p.data || {}; });
  const movies = data.movies.filter(m => m.data && m.data.title);

  // credits per person (cast entries, plus the director field when that person isn't already in the cast)
  const credits = {};
  const addCredit = (slug, c) => { if (slug) (credits[slug] = credits[slug] || []).push(c); };
  movies.forEach(m => {
    const cast = m.data.cast || [];
    cast.forEach(c => addCredit(personSlug(c.name), { m, name: c.name, role: c.role || '', crew: CREW_RE.test(c.role || ''), year: c.year || '' }));
    String(m.data.director || '').split(/,| and /).map(s => s.trim()).filter(Boolean).forEach(d => {
      const k = personSlug(d); if (!cast.some(c => personSlug(c.name) === k)) addCredit(k, { m, name: d, role: 'Director', crew: true });
    });
  });
  const titleCount = slug => new Set((credits[slug] || []).map(c => c.m.id)).size;
  const indexedPerson = slug => {
    const st = people[slug] || {};
    return titleCount(slug) >= MIN_CREDITS || (titleCount(slug) >= 1 && (safeUrl(st.photoUrl) || st.bio));
  };
  const personName = slug => {
    const st = people[slug]; if (st && st.name) return st.name;
    const tally = {}; (credits[slug] || []).forEach(c => { tally[c.name] = (tally[c.name] || 0) + 1; });
    return Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0] || slug;
  };
  const personLink = name => {
    const k = personSlug(name);
    return k && indexedPerson(k) ? '<a href="/person/' + k + '">' + esc(name) + '</a>' : esc(name);
  };

  // "More like this": same main language, then shared genre words, people and nearby years.
  const langKey = d => String(d.languages || '').split(/[,;]/)[0].trim().toLowerCase();
  const words = d => new Set(String(d.genre || '').toLowerCase().split(/[^a-z]+/).filter(w => w.length > 3 && !['film', 'drama'].includes(w)));
  const facts = new Map(movies.map(m => [m.id, { lang: langKey(m.data), g: words(m.data), y: +year(m.data) || 0, tv: isTv(m.data),
    ppl: new Set([...(m.data.cast || []).slice(0, 8).map(c => personSlug(c.name)), ...String(m.data.director || '').split(/,| and /).map(personSlug)].filter(Boolean)) }]));
  const byLang = {}; movies.forEach(m => { const k = facts.get(m.id).lang; (byLang[k] = byLang[k] || []).push(m); });
  function similar(m) {
    const f = facts.get(m.id), out = [];
    for (const o of byLang[f.lang] || []) {
      if (o.id === m.id) continue;
      const g = facts.get(o.id); let sc = 0;
      g.g.forEach(w => { if (f.g.has(w)) sc += 3; });
      g.ppl.forEach(p => { if (f.ppl.has(p)) sc += 4; });
      if (g.tv === f.tv) sc += 2;
      if (f.y && g.y) sc -= Math.min(6, Math.abs(f.y - g.y) / 3);
      out.push([sc, o]);
    }
    return out.sort((a, b) => b[0] - a[0] || String(a[1].data.title).localeCompare(String(b[1].data.title))).slice(0, 12).map(x => x[1]);
  }
  const langLinks = v => String(v || '').split(/\s*[,;]\s*/).filter(Boolean).map(l => '<a href="/browse?lang=' + encodeURIComponent(l) + '">' + esc(l) + '</a>').join(', ');

  const sitemap = [{ loc: '/', pri: '1.0' }, { loc: '/browse', pri: '0.6' }, { loc: '/people', pri: '0.6' }];
  const seen = new Set(); let nTitles = 0, nRated = 0, nPeople = 0;

  // ----- title pages -----
  for (const m of movies) {
    const d = m.data, url = movieUrl(m), tv = isTv(d);
    if (!/^\/(movie|tv)\/[a-z0-9-]+$/.test(url)) continue;
    if (seen.has(url)) { console.warn('[seo] duplicate URL, skipped:', url, m.id); continue; }
    seen.add(url);
    const y = year(d), sc = score(m.id), vs = (isOtt(d) || tv) ? VERD.ott : VERD.theatre;
    const cast = (d.cast || []).filter(c => c && c.name);
    const actors = cast.filter(c => !CREW_RE.test(c.role || '')), crew = cast.filter(c => CREW_RE.test(c.role || ''));
    const directors = String(d.director || '').split(/,| and /).map(s => s.trim()).filter(Boolean);
    const lang = String(d.languages || '').split(/[,;]/)[0].trim();
    const poster = safeUrl(d.posterUrl), banner = safeUrl(d.bannerUrl);
    const label = tv ? (tvYears(d) ? 'TV series ' + tvYears(d) : 'TV series') : (y || '');

    const title = d.title + (label ? ' (' + label + ')' : '') + ' – Verdicts & Reviews | Reelscore';
    const auto = d.title + (y ? ' (' + y + ')' : '') + ' is ' + (lang ? (/^[aeiou]/i.test(lang) ? 'an ' : 'a ') + lang + ' ' : 'a ') +
      (d.genre ? String(d.genre).toLowerCase() + ' ' : '') + (tv ? 'series' : 'film') +
      (directors.length ? ' directed by ' + list(directors.slice(0, 2)) : '') +
      (actors.length ? ', starring ' + list(actors.slice(0, 3).map(c => c.name)) : '') + '.';
    const description = clip((d.synopsis ? d.synopsis + ' ' : auto + ' ') + (sc.tot ? sc.pct + '% positive from ' + sc.tot + ' verdict' + (sc.tot === 1 ? '' : 's') + ' on Reelscore.' : 'Verdicts and reviews on Reelscore.'), 158);

    const metaLine = [tv ? tvYears(d) : (d.releaseDate ? fmtDate(d.releaseDate) : ''), d.languages ? '\u0000' : '', d.genre, d.runtime, d.certificate, d.platform ? 'on ' + d.platform : ''].filter(Boolean)
      .map(x => x === '\u0000' ? langLinks(d.languages) : esc(x)).join(' · ');
    const section = tv ? ['TV shows', '/browse/tv-shows'] : ['Movies', '/browse'];
    let body = '<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › <a href="' + section[1] + '">' + section[0] + '</a> › ' + esc(d.title) + '</nav>';
    body += '<div class="pr-top">' + (poster ? '<img class="pr-poster" src="' + esc(poster) + '" alt="' + esc(d.title) + ' poster" width="200" height="300">' : '') + '<div>';
    body += '<h1>' + esc(d.title) + '</h1>' + (d.subtitle ? '<div class="pr-sub">' + esc(d.subtitle) + '</div>' : '');
    body += metaLine ? '<div class="pr-meta">' + metaLine + '</div>' : '';
    if (sc.tot) body += '<div class="pr-score"><b>' + sc.pct + '%</b> positive · ' + sc.tot + ' verdict' + (sc.tot === 1 ? '' : 's') + '<div class="note">' + vs.map(x => esc(x[1]) + ' ' + Math.round(100 * sc.n[x[0]] / sc.tot) + '%').join(' · ') + '</div></div>';
    if (directors.length) body += '<div class="pr-meta">Directed by ' + directors.map(personLink).join(', ') + '</div>';
    body += '</div></div>';
    if (d.synopsis) body += '<h2>Story</h2><p>' + esc(d.synopsis) + '</p>';
    if (actors.length) body += '<h2>Cast</h2><ul>' + actors.map(c => '<li>' + personLink(c.name) + (c.role && c.role !== 'Cast' ? ' <span class="note">' + esc(c.role) + (c.episodes ? ' · ' + esc(c.episodes) + ' ep.' : '') + '</span>' : '') + '</li>').join('') + '</ul>';
    if (crew.length) body += '<h2>Crew</h2><ul>' + crew.map(c => '<li>' + personLink(c.name) + ' <span class="note">' + esc(c.role) + '</span></li>').join('') + '</ul>';
    const more = similar(m);
    if (more.length) body += '<div class="pr-more"><h2>More like this</h2><ul>' + more.map(o => '<li><a href="' + movieUrl(o) + '">' + esc(o.data.title) + '</a> <span class="note">' + esc([isTv(o.data) ? 'TV' : '', year(o.data)].filter(Boolean).join(' · ')) + '</span></li>').join('') + '</ul></div>';

    const node = {
      '@context': 'https://schema.org', '@type': tv ? 'TVSeries' : 'Movie',
      name: d.title, url: SITE + url, description: clip(d.synopsis || auto, 300),
      image: poster || banner || undefined,
      genre: d.genre || undefined,
      inLanguage: lang || undefined,
      contentRating: d.certificate || undefined,
      duration: tv ? undefined : isoDuration(d.runtime),
      director: directors.length ? directors.map(n => ({ '@type': 'Person', name: n, url: indexedPerson(personSlug(n)) ? SITE + '/person/' + personSlug(n) : undefined })) : undefined,
      actor: actors.length ? actors.slice(0, 15).map(c => ({ '@type': 'Person', name: c.name, url: indexedPerson(personSlug(c.name)) ? SITE + '/person/' + personSlug(c.name) : undefined })) : undefined
    };
    if (tv) { if (y) node.startDate = d.releaseDate; if (/^\d{4}$/.test(String(d.endYear || ''))) node.endDate = String(d.endYear); if (+d.seasons > 0) node.numberOfSeasons = +d.seasons; }
    else if (d.releaseDate) node.datePublished = d.releaseDate;
    // Only put the score in search markup once enough people have voted (see SEO_MIN_VERDICTS).
    if (sc.tot >= MIN_VERDICTS) { node.aggregateRating = { '@type': 'AggregateRating', ratingValue: sc.pct, bestRating: 100, worstRating: 0, ratingCount: sc.tot }; nRated++; }
    const crumbs = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE + '/' },
      { '@type': 'ListItem', position: 2, name: section[0], item: SITE + section[1] },
      { '@type': 'ListItem', position: 3, name: d.title, item: SITE + url }] };

    write(url.slice(1) + '.html', page(shell, { title, description, canonical: url, ogType: tv ? 'video.tv_show' : 'video.movie', image: banner || poster, wide: !!banner, jsonld: [node, crumbs], route: 'title', body }));
    sitemap.push({ loc: url, lastmod: (d.updatedAt || m.updated || '').slice(0, 10), pri: '0.8' });
    nTitles++;
  }

  // ----- person pages -----
  const when = c => (isTv(c.m.data) && /\d{4}/.test(String(c.year)) ? String(c.year).match(/\d{4}/g).sort().pop() : (c.m.data.releaseDate || ''));
  for (const slug of Object.keys(credits)) {
    if (!/^[a-z0-9-]+$/.test(slug) || !indexedPerson(slug)) continue;
    const st = people[slug] || {}, name = personName(slug), url = '/person/' + slug;
    const byTitle = new Map();
    credits[slug].forEach(c => {
      const t = byTitle.get(c.m.id) || { m: c.m, roles: [], acting: false, crew: false, when: '' };
      if (c.role && c.role !== 'Cast' && !t.roles.includes(c.role)) t.roles.push(c.role);
      if (c.crew) t.crew = true; else t.acting = true;
      const w = when(c); if (w > t.when) t.when = w;
      byTitle.set(c.m.id, t);
    });
    const titles = [...byTitle.values()].sort((a, b) => b.when.localeCompare(a.when));
    const acting = titles.filter(t => t.acting), crewT = titles.filter(t => t.crew);
    const years = titles.map(t => t.when.slice(0, 4)).filter(Boolean).sort();
    const span = years.length ? (years[0] === years[years.length - 1] ? years[0] : years[0] + '–' + years[years.length - 1]) : '';
    const known = acting.length >= crewT.length ? 'Actor' : (crewT.some(t => /direct/i.test(t.roles.join(' '))) ? 'Director' : 'Film crew');
    const famous = (acting.length ? acting : crewT).filter(t => t.when && t.when <= new Date().toISOString().slice(0, 10)).slice(0, 4).map(t => t.m.data.title);
    const photo = safeUrl(st.photoUrl);

    const title = name + ' – Movies, TV Shows & Filmography | Reelscore';
    const description = clip(st.bio ? st.bio : name + ' filmography: ' + titles.length + ' title' + (titles.length === 1 ? '' : 's') + (span ? ' (' + span + ')' : '') +
      (famous.length ? ', including ' + list(famous) : '') + '. Roles, verdicts and reviews on Reelscore.', 158);
    const li = t => '<li><a href="' + movieUrl(t.m) + '">' + esc(t.m.data.title) + '</a> <span class="note">' + esc([isTv(t.m.data) ? 'TV' : '', t.when.slice(0, 4), t.roles.join(', ')].filter(Boolean).join(' · ')) + '</span></li>';
    let body = '<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › <a href="/people">People</a> › ' + esc(name) + '</nav>';
    body += '<div class="pr-top">' + (photo ? '<img class="pr-photo" src="' + esc(photo) + '" alt="' + esc(name) + '" width="160" height="160">' : '') + '<div>';
    body += '<h1>' + esc(name) + '</h1><div class="pr-meta">' + esc([known, titles.length + ' title' + (titles.length === 1 ? '' : 's'), span].filter(Boolean).join(' · ')) + '</div>';
    if (/^\d{4}-\d{2}-\d{2}$/.test(st.birthday || '') || st.birthplace) body += '<div class="pr-meta">Born ' + esc([fmtDate(st.birthday), st.birthplace ? 'in ' + st.birthplace : ''].filter(Boolean).join(' ')) + '</div>';
    if ((st.aka || []).filter(Boolean).length) body += '<div class="pr-meta">Also known as ' + esc(st.aka.filter(Boolean).join(', ')) + '</div>';
    body += '</div></div>';
    if (st.bio) body += '<p>' + esc(st.bio) + '</p>';
    if (acting.length) body += '<h2>Acting</h2><ul>' + acting.map(li).join('') + '</ul>';
    if (crewT.length) body += '<h2>Behind the camera</h2><ul>' + crewT.map(li).join('') + '</ul>';

    const node = { '@context': 'https://schema.org', '@type': 'Person', name, url: SITE + url, image: photo || undefined,
      description: st.bio ? clip(st.bio, 300) : undefined, jobTitle: known,
      alternateName: (st.aka || []).filter(Boolean).length ? st.aka.filter(Boolean) : undefined,
      birthDate: /^\d{4}-\d{2}-\d{2}$/.test(st.birthday || '') ? st.birthday : undefined,
      gender: /^(Male|Female)$/.test(st.gender || '') ? st.gender : undefined };
    write(url.slice(1) + '.html', page(shell, { title, description, canonical: url, ogType: 'profile', image: photo, wide: false, jsonld: [node], route: 'person', body }));
    const lm = titles.map(t => (t.m.data.updatedAt || t.m.updated || '').slice(0, 10)).sort().pop() || '';
    sitemap.push({ loc: url, lastmod: lm, pri: '0.6' });
    nPeople++;
  }

  // ----- sitemap + robots -----
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    sitemap.map(u => '<url><loc>' + esc(SITE + u.loc) + '</loc>' + (/^\d{4}-\d{2}-\d{2}$/.test(u.lastmod || '') ? '<lastmod>' + u.lastmod + '</lastmod>' : '') + '<priority>' + u.pri + '</priority></url>').join('\n') + '\n</urlset>\n';
  if (sitemap.length > 50000) throw new Error('Sitemap over 50,000 URLs: split it into a sitemap index');
  write('sitemap.xml', xml);
  // The app's catalogue: every title and person, empty top-level fields dropped to keep it small.
  const compact = d => { const o = {}; for (const k of Object.keys(d || {})) { const v = d[k]; if (v !== '' && v !== null && v !== undefined) o[k] = v; } return o; };
  const cat = { builtAt: data.builtAt, fullAt: data.fullAt,
    movies: data.movies.filter(m => m.data).map(m => ({ id: m.id, data: compact(m.data) })),
    people: Object.fromEntries(data.people.filter(p => p.data).map(p => [p.id, compact(p.data)])) };
  write('catalogue.json', JSON.stringify(cat));
  console.log(`[seo] catalogue.json: ${cat.movies.length} titles, ${Object.keys(cat.people).length} people, ${(Buffer.byteLength(JSON.stringify(cat)) / 1024).toFixed(0)} KB`);
  write('robots.txt', ['User-agent: *', 'Disallow: /admin', 'Disallow: /my-list', 'Disallow: /setup', 'Disallow: /data/', '', 'Sitemap: ' + SITE + '/sitemap.xml', ''].join('\n'));

  console.log(`[seo] wrote ${nTitles} title pages (${nRated} with rating markup, min ${MIN_VERDICTS} verdicts), ${nPeople} person pages (min ${MIN_CREDITS} titles), sitemap ${sitemap.length} URLs, site ${SITE}, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch(e => { console.error('[seo] build failed:', e && e.stack || e); process.exit(1); });
