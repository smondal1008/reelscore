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
const SKIP = new Set(['dist', 'scripts', 'node_modules', 'README.md', 'package.json', 'package-lock.json', 'vercel.json', 'firestore.rules', 'content']);

// ---------- helpers shared with the app (keep in step with app/main.js) ----------
const slugify = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
const personSlug = n => String(n || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
const CREW_RE = /(director|producer|music|writer|screenplay|composer|cinematograph|editor)/i;
const VERD = {
  theatre: [['a', 'Theatre', 'Worth the big screen'], ['b', 'OTT', 'Wait for streaming'], ['c', 'Skip', 'Not worth it']],
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
// YouTube videos of a title, same parsing and categories as app/main.js (ytId, vidCat).
function ytId(u) { const mm = String(u || '').match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/); return mm ? mm[1] : ''; }
function vidCat(k) { k = String(k || '').toLowerCase(); return /trailer|teaser|promo|glimpse/.test(k) ? 'trailers' : /song|lyric|music|jukebox|audio/.test(k) ? 'songs' : /episode/.test(k) ? 'episodes' : 'more'; }
function ytVideos(d) { return (d.videos || []).map(x => ({ title: x.title || x.kind || 'Video', kind: x.kind || 'Video', yt: ytId(safeUrl(x.url)), cat: vidCat(x.kind), addedAt: x.addedAt || '' })).filter(x => x.yt); }
// Same rule as app/main.js: ask Cloudinary for a sized, compressed copy instead of the uploaded original.
function cld(u, w) {
  const m = typeof u === 'string' && u.match(/^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.*)$/);
  if (!m || /^[a-z]{1,3}_[^/]*\//.test(m[2])) return u;
  return m[1] + 'f_auto,q_auto,c_limit,w_' + (w || 800) + '/' + m[2];
}
const ytThumb = id => 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg';
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
  // Public reads need no key, so try without it first; the browser key can carry its own (smaller) quota.
  let useKey = false, reads = 0;
  async function call(url, init) {
    let r;
    // Retry busy/quota responses with backoff (Firestore sometimes answers 429 in bursts); about a minute in total.
    for (let attempt = 0; attempt < 8; attempt++) {
      r = await fetch(url + (useKey ? (url.includes('?') ? '&' : '?') + 'key=' + key : ''), init);
      if (r.status === 403 && !useKey && key) { useKey = true; attempt--; continue; }
      if (r.ok || r.status === 404 || (r.status < 500 && r.status !== 429)) break;
      await new Promise(res => setTimeout(res, Math.min(15000, 1500 * (attempt + 1))));
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

const OG_DEFAULT = '/og-default.png';
function page(shell, { title, description, canonical, ogPath, ogType, image, wide, jsonld, route, body, robots }) {
  // Pages without a poster or photo share the site-wide card (1200x630).
  const fallback = !image; if (fallback) { image = SITE + OG_DEFAULT; wide = true; }
  const head = [
    '<title>' + esc(title) + '</title>',
    '<meta name="description" content="' + esc(description) + '">',
    robots ? '<meta name="robots" content="' + robots + '">' : '',
    canonical ? '<link rel="canonical" href="' + esc(SITE + canonical) + '">' : '',
    '<meta property="og:site_name" content="Reelscore">',
    '<meta property="og:type" content="' + ogType + '">',
    '<meta property="og:title" content="' + esc(title) + '">',
    '<meta property="og:description" content="' + esc(description) + '">',
    '<meta property="og:url" content="' + esc(SITE + (canonical || ogPath || '/')) + '">',
    '<meta property="og:image" content="' + esc(image) + '">',
    fallback ? '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="Reelscore: verdicts on Indian movies and series">' : '',
    '<meta name="twitter:card" content="' + (wide ? 'summary_large_image' : 'summary') + '">',
    '<meta name="twitter:image" content="' + esc(image) + '">',
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

  // Editorial synopses from content/synopses.json fill titles whose database synopsis is empty.
  // _synFile marks file-sourced text, so a later file edit still applies but an admin edit always wins.
  try {
    const syn = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'synopses.json'), 'utf8'));
    let n = 0;
    for (const m of data.movies) {
      const s = syn[m.id];
      if (!s || m.id.startsWith('_') || typeof s !== 'string') continue;
      if (!m.data.synopsis || m.data._synFile) { m.data = { ...m.data, synopsis: s, _synFile: true }; n++; }
    }
    console.log(`[seo] synopses applied from content/synopses.json: ${n}`);
  } catch (e) { if (e.code !== 'ENOENT') throw e; }

  // Short bios from content/bios.json fill people whose database bio is empty (an admin edit always wins).
  try {
    const bios = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'bios.json'), 'utf8'));
    let n = 0;
    for (const p of data.people) { const b = bios[p.id]; if (typeof b === 'string' && !p.id.startsWith('_') && (!p.data.bio || p.data._bioFile)) { p.data = { ...p.data, bio: b, _bioFile: true }; n++; } }
    const have = new Set(data.people.map(p => p.id));
    for (const id of Object.keys(bios)) if (!id.startsWith('_') && !have.has(id) && typeof bios[id] === 'string') { data.people.push({ id, data: { bio: bios[id], _bioFile: true } }); n++; }
    console.log(`[seo] bios applied from content/bios.json: ${n}`);
  } catch (e) { if (e.code !== 'ENOENT') throw e; }

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
  // Only titles with real content (a story, poster or video) count towards a person's indexed page, so a filmography made
  // purely of data-only imports doesn't create thin person pages.
  const richTitle = d => !!(d.synopsis || safeUrl(d.posterUrl) || ytVideos(d).length);
  const richCount = slug => new Set((credits[slug] || []).filter(c => richTitle(c.m.data)).map(c => c.m.id)).size;
  const indexedPerson = slug => {
    const st = people[slug] || {};
    return richCount(slug) >= MIN_CREDITS || (richCount(slug) >= 1 && (safeUrl(st.photoUrl) || st.bio)) || (titleCount(slug) >= 1 && !!st.bio);
  };
  const personName = slug => {
    const st = people[slug]; if (st && st.name) return st.name;
    const tally = {}; (credits[slug] || []).forEach(c => { tally[c.name] = (tally[c.name] || 0) + 1; });
    return Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0] || slug;
  };
  data.people.forEach(p => { if (p.data && p.data._bioFile && !p.data.name) { p.data = { ...p.data, name: personName(p.id) }; people[p.id] = p.data; } });
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

  // Page titles, kept in step with app/main.js (movieTitleTag, personTitleTag) so they don't change once the app
  // loads: language added when a name and year repeat, the "Verdicts & Reviews" part dropped past 60 characters.
  const titleKey = m => String(m.data.title || '').trim().toLowerCase() + '|' + (isTv(m.data) ? 'tv ' + tvYears(m.data) : year(m.data));
  const dupTitle = {}; movies.forEach(m => { const k = titleKey(m); dupTitle[k] = (dupTitle[k] || 0) + 1; });
  function movieTitleTag(m) {
    const d = m.data, parts = [isTv(d) ? (tvYears(d) ? 'TV series ' + tvYears(d) : 'TV series') : year(d)];
    const lang = String(d.languages || '').split(/[,;]/)[0].trim();
    if (dupTitle[titleKey(m)] > 1 && lang) parts.push(lang);
    const p = parts.filter(Boolean), base = d.title + (p.length ? ' (' + p.join(', ') + ')' : ''), full = base + ' – Verdicts & Reviews | Reelscore';
    return full.length <= 60 ? full : (base + ' | Reelscore').length <= 60 ? base + ' | Reelscore' : base.length <= 60 ? base : clip(base, 60);
  }
  function personTitleTag(name) {
    const a = name + ' – Movies, TV Shows & Filmography | Reelscore', b = name + ' – Filmography | Reelscore';
    return a.length <= 60 ? a : b.length <= 60 ? b : name + ' | Reelscore';
  }

  const sitemap = [{ loc: '/', pri: '1.0' }, { loc: '/browse', pri: '0.6' }, { loc: '/people', pri: '0.6' }];
  const seen = new Set(), aliasSeen = new Set(), aliases = []; let nTitles = 0, nRated = 0, nPeople = 0, nThinTitles = 0;

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
    const poster = cld(safeUrl(d.posterUrl), 400), banner = cld(safeUrl(d.bannerUrl), 1200);
    const label = tv ? (tvYears(d) ? 'TV series ' + tvYears(d) : 'TV series') : (y || '');

    const title = movieTitleTag(m);
    const auto = d.title + (y ? ' (' + y + ')' : '') + ' is ' + (lang ? (/^[aeiou]/i.test(lang) ? 'an ' : 'a ') + lang + ' ' : 'a ') +
      (d.genre ? String(d.genre).toLowerCase() + ' ' : '') + (tv ? 'series' : 'film') +
      (directors.length ? ' directed by ' + list(directors.slice(0, 2)) : '') +
      (actors.length ? ', starring ' + list(actors.slice(0, 3).map(c => c.name)) : '') + '.';
    const description = clip((d.synopsis ? d.synopsis + ' ' + (d.synopsis.length < 80 ? auto + ' ' : '') : auto + ' ') + (sc.tot ? sc.pct + '% positive from ' + sc.tot + ' verdict' + (sc.tot === 1 ? '' : 's') + ' on Reelscore.' : 'Verdicts and reviews on Reelscore.'), 158);

    const metaLine = [tv ? tvYears(d) : (d.releaseDate ? fmtDate(d.releaseDate) : ''), d.languages ? '\u0000' : '', d.genre, d.runtime, d.certificate, d.platform ? 'on ' + d.platform : ''].filter(Boolean)
      .map(x => x === '\u0000' ? langLinks(d.languages) : esc(x)).join(' · ');
    const section = tv ? ['TV shows', '/browse/tv-shows'] : ['Movies', '/browse'];
    let body = '<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › <a href="' + section[1] + '">' + section[0] + '</a> › ' + esc(d.title) + '</nav>';
    body += '<div class="pr-top">' + (poster ? '<img class="pr-poster" src="' + esc(poster) + '" alt="' + esc(d.title) + ' poster" width="200" height="300" fetchpriority="high">' : '') + '<div>';
    body += '<h1>' + esc(d.title) + '</h1>' + (d.subtitle ? '<div class="pr-sub">' + esc(d.subtitle) + '</div>' : '');
    body += metaLine ? '<div class="pr-meta">' + metaLine + '</div>' : '';
    if (sc.tot) body += '<div class="pr-score"><b>' + sc.pct + '%</b> positive · ' + sc.tot + ' verdict' + (sc.tot === 1 ? '' : 's') + '<div class="note">' + vs.map(x => esc(x[1]) + ' ' + Math.round(100 * sc.n[x[0]] / sc.tot) + '%').join(' · ') + '</div></div>';
    if (directors.length) body += '<div class="pr-meta">Directed by ' + directors.map(personLink).join(', ') + '</div>';
    body += '</div></div>';
    if (d.synopsis) body += '<h2>Story</h2><p>' + esc(d.synopsis) + '</p>';
    if (actors.length) body += '<h2>Cast</h2><ul>' + actors.map(c => '<li>' + personLink(c.name) + (c.role && c.role !== 'Cast' ? ' <span class="note">' + esc(c.role) + (c.episodes ? ' · ' + esc(c.episodes) + ' ep.' : '') + '</span>' : '') + '</li>').join('') + '</ul>';
    if (crew.length) body += '<h2>Crew</h2><ul>' + crew.map(c => '<li>' + personLink(c.name) + ' <span class="note">' + esc(c.role) + '</span></li>').join('') + '</ul>';
    const vids = ytVideos(d);
    if (vids.length) body += '<h2>Trailers &amp; songs</h2><ul class="pr-vids">' + vids.map(x => '<li><img src="' + ytThumb(x.yt) + '" alt="' + esc(d.title + ' · ' + x.title) + '" width="160" height="90" loading="lazy"> ' + esc(x.title) + ' <span class="note">' + esc(x.kind) + '</span></li>').join('') + '</ul>';
    if (d.srcTvmaze) body += '<p class="note">Show details and image from <a href="' + esc(safeUrl(d.srcTvmaze) || 'https://www.tvmaze.com/') + '" rel="noopener">TVmaze</a> (<a href="https://creativecommons.org/licenses/by-sa/4.0/" rel="noopener license">CC BY-SA 4.0</a>).</p>';
    else if (d.wikidata) body += '<p class="note">Film facts from <a href="https://www.wikidata.org/wiki/' + esc(d.wikidata) + '" rel="noopener">Wikidata</a> (CC0).</p>';
    const more = similar(m);
    if (more.length) body += '<div class="pr-more"><h2>More like this</h2><ul>' + more.map(o => '<li><a href="' + movieUrl(o) + '">' + esc(o.data.title) + '</a> <span class="note">' + esc([isTv(o.data) ? 'TV' : '', year(o.data)].filter(Boolean).join(' · ')) + '</span></li>').join('') + '</ul></div>';

    const node = {
      '@context': 'https://schema.org', '@type': tv ? 'TVSeries' : 'Movie',
      name: d.title, url: SITE + url, description: clip(d.synopsis || auto, 300),
      image: poster || banner || undefined,
      genre: d.genre || undefined,
      inLanguage: lang || undefined,
      contentRating: d.certificate || undefined,
      sameAs: /^tt\d+$/.test(d.imdb || '') ? 'https://www.imdb.com/title/' + d.imdb + '/' : undefined,
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

    // VideoObject per YouTube video so trailers and songs can show in video results. uploadDate is when the video
    // was added to Reelscore (or the title's last update), since YouTube's own upload date isn't stored.
    const vDate = x => /^\d{4}-\d{2}-\d{2}/.test(x.addedAt) ? x.addedAt.slice(0, 10) : /^\d{4}-\d{2}-\d{2}/.test(d.updatedAt || '') ? d.updatedAt.slice(0, 10) : String(data.builtAt || new Date().toISOString()).slice(0, 10);
    const videoLd = vids.slice(0, 20).map(x => ({ '@context': 'https://schema.org', '@type': 'VideoObject',
      name: clip(d.title + ' – ' + x.title, 100), description: clip(x.kind + ' of ' + d.title + (y && !tv ? ' (' + y + ')' : '') + (lang ? ', ' + lang : '') + '.' + (d.synopsis ? ' ' + d.synopsis : ''), 300),
      thumbnailUrl: ytThumb(x.yt), uploadDate: vDate(x), embedUrl: 'https://www.youtube.com/embed/' + x.yt, url: SITE + url,
      inLanguage: lang || undefined }));
    // A title with no story, no videos and no poster is only a list of facts: it stays out of the index until it has more.
    const thinTitle = !d.synopsis && !vids.length && !poster && !sc.tot;
    write(url.slice(1) + '.html', page(shell, { title, description, canonical: url, ogType: tv ? 'video.tv_show' : 'video.movie', image: banner || poster, wide: !!banner, jsonld: [node, crumbs, ...videoLd], route: 'title', body, robots: thinTitle ? 'noindex,follow' : undefined }));
    // The bare id (or an old slug) still opens the title, as a pointer to the canonical page that isn't indexed.
    for (const alias of new Set([m.id, slugify(m.data.title) || ''])) {
      const au = (tv ? '/tv/' : '/movie/') + alias;
      if (!alias || au === url || !/^[a-z0-9-]+$/.test(alias) || seen.has(au) || aliasSeen.has(au)) continue;
      aliasSeen.add(au); aliases.push([au, url]);
    }
    if (!thinTitle) sitemap.push({ loc: url, lastmod: (d.updatedAt || m.updated || '').slice(0, 10), pri: '0.8' });
    else nThinTitles++;
    nTitles++;
  }

  // ----- person pages -----
  const thinPeople = [];
  const when = c => (isTv(c.m.data) && /\d{4}/.test(String(c.year)) ? String(c.year).match(/\d{4}/g).sort().pop() : (c.m.data.releaseDate || ''));
  for (const slug of Object.keys(credits)) {
    if (!/^[a-z0-9-]+$/.test(slug)) continue;
    if (!indexedPerson(slug)) { thinPeople.push(slug); continue; }
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
    const photo = cld(safeUrl(st.photoUrl), 400);

    const title = personTitleTag(name);
    const description = clip(st.bio ? st.bio : name + ' filmography: ' + titles.length + ' title' + (titles.length === 1 ? '' : 's') + (span ? ' (' + span + ')' : '') +
      (famous.length ? ', including ' + list(famous) : '') + '. Roles, verdicts and reviews on Reelscore.', 158);
    const li = t => '<li><a href="' + movieUrl(t.m) + '">' + esc(t.m.data.title) + '</a> <span class="note">' + esc([isTv(t.m.data) ? 'TV' : '', t.when.slice(0, 4), t.roles.join(', ')].filter(Boolean).join(' · ')) + '</span></li>';
    let body = '<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › <a href="/people">People</a> › ' + esc(name) + '</nav>';
    body += '<div class="pr-top">' + (photo ? '<img class="pr-photo" src="' + esc(photo) + '" alt="' + esc(name) + '" width="160" height="160" fetchpriority="high">' : '') + '<div>';
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

  // The app's catalogue: every title and person, empty top-level fields dropped to keep it small.
  const compact = d => { const o = {}; for (const k of Object.keys(d || {})) { const v = d[k]; if (v !== '' && v !== null && v !== undefined) o[k] = v; } return o; };
  // Fields the public app never reads are left out (admin reads the database directly): import notes, image ids,
  // empty lists and the default "Cast" role.
  const slim = d => { const o = compact(d); delete o.source; delete o.imdb; delete o.tvmazeId; delete o.importedAt; delete o.posterSource; delete o.bannerSource; delete o.posterId; delete o.bannerId;
    if (Array.isArray(o.slugHistory) && !o.slugHistory.length) delete o.slugHistory; if (Array.isArray(o.videos) && !o.videos.length) delete o.videos;
    if (Array.isArray(o.cast)) o.cast = o.cast.map(c => { if (!c || c.role !== 'Cast') return c; const x = { ...c }; delete x.role; return x; });
    return o; };
  const cat = { builtAt: data.builtAt, fullAt: data.fullAt,
    movies: data.movies.filter(m => m.data).map(m => ({ id: m.id, data: slim(m.data) })),
    people: Object.fromEntries(data.people.filter(p => p.data).map(p => [p.id, compact(p.data)])) };
  write('catalogue.json', JSON.stringify(cat));
  // The app loads it in two parts: the core (every section but Older releases, plus people) first, Older releases after.
  // catalogue.json stays whole: the next build reads it, and the app falls back to it.
  const isOlder = m => m.data.section === 'Older releases';
  write('catalogue-core.json', JSON.stringify({ builtAt: cat.builtAt, fullAt: cat.fullAt, movies: cat.movies.filter(m => !isOlder(m)), people: cat.people }));
  write('catalogue-older.json', JSON.stringify({ builtAt: cat.builtAt, movies: cat.movies.filter(isOlder) }));
  console.log(`[seo] catalogue split: core ${(fs.statSync(path.join(OUT, 'catalogue-core.json')).size / 1024).toFixed(0)} KB, older ${(fs.statSync(path.join(OUT, 'catalogue-older.json')).size / 1024).toFixed(0)} KB`);
  console.log(`[seo] catalogue.json: ${cat.movies.length} titles, ${Object.keys(cat.people).length} people, ${(Buffer.byteLength(JSON.stringify(cat)) / 1024).toFixed(0)} KB`);
  // Home page (also the app shell other routes fall back to): share image and WebSite / Organization data.
  const homeLd = [
    { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Reelscore', url: SITE + '/', description: 'Verdicts and reviews for Bollywood and regional Indian movies and series.', inLanguage: 'en-IN' },
    { '@context': 'https://schema.org', '@type': 'Organization', name: 'Reelscore', url: SITE + '/', logo: SITE + '/icon-512.png', image: SITE + OG_DEFAULT }
  ];
  // ----- hub pages: home, Browse (all + each section), People -----
  // Pre-rendered so every title and person can be reached from the home page through plain links. index.html is also
  // the shell other routes fall back to; it carries no canonical (the app sets it), and its pre-rendered home block
  // only shows on "/" (the app switches views at once elsewhere). Titles match app/main.js BROWSE_TITLES / PEOPLE_TITLE.
  const HUBS = [
    ['in-theatres', 'In theatres', 'Indian Movies in Theatres Now | Reelscore', 'Hindi, Tamil, Telugu, Malayalam and other Indian films in theatres now, with verdicts: theatre, OTT or skip.'],
    ['coming-soon', 'Coming soon', 'Upcoming Indian Movies | Reelscore', 'Upcoming Bollywood and regional Indian films with release dates, cast and directors.'],
    ['on-ott', 'On OTT', 'Indian Movies on OTT | Reelscore', 'Indian films streaming on OTT platforms, with verdicts on whether they are worth your time.'],
    ['older-releases', 'Older releases', 'Older Indian Movies | Reelscore', 'Older Bollywood and regional Indian films, with cast, crew and verdicts.'],
    ['tv-shows', 'TV shows', 'Indian TV Shows & Series | Reelscore', 'Indian TV shows and web series in Hindi, Tamil, Telugu, Malayalam and more, with cast, trailers and verdicts.']
  ];
  const sectionOf = m => m.data.section === 'Releasing this week' ? 'In theatres' : (m.data.section || 'Older releases');
  const today = new Date().toISOString().slice(0, 10);
  const bySection = {}; HUBS.forEach(h => { bySection[h[1]] = []; });
  movies.forEach(m => { const k = sectionOf(m); (bySection[k] = bySection[k] || []).push(m); });
  const newest = (a, b) => String(b.data.releaseDate || '').localeCompare(String(a.data.releaseDate || '')) || String(a.data.title).localeCompare(String(b.data.title));
  const soonest = (a, b) => String(a.data.releaseDate || '9999').localeCompare(String(b.data.releaseDate || '9999')) || String(a.data.title).localeCompare(String(b.data.title));
  Object.keys(bySection).forEach(k => bySection[k].sort(k === 'Coming soon' ? soonest : newest));
  const titleLi = m => '<li><a href="' + movieUrl(m) + '">' + esc(m.data.title) + '</a> <span class="note">' +
    esc([isTv(m.data) ? tvYears(m.data) : (/^\d{4}-\d{2}-\d{2}$/.test(m.data.releaseDate || '') && m.data.releaseDate > today ? fmtDate(m.data.releaseDate) : year(m.data)), String(m.data.languages || '').split(/[,;]/)[0].trim()].filter(Boolean).join(' · ')) + '</span></li>';
  const hubPeople = Object.keys(credits).filter(indexedPerson).sort((a, b) => titleCount(b) - titleCount(a) || personName(a).localeCompare(personName(b)));
  const personLi = k => '<li><a href="/person/' + k + '">' + esc(personName(k)) + '</a> <span class="note">' + titleCount(k) + ' title' + (titleCount(k) === 1 ? '' : 's') + '</span></li>';
  const langs = {}; movies.forEach(m => { const l = String(m.data.languages || '').split(/[,;]/)[0].trim(); if (l) langs[l] = (langs[l] || 0) + 1; });
  const langList = Object.keys(langs).sort((a, b) => langs[b] - langs[a]).filter(l => langs[l] >= 5);
  const block = (h2, list, more) => list.length ? '<h2>' + h2 + '</h2><ul>' + list.join('') + '</ul>' + (more ? '<p><a href="' + more[0] + '">' + more[1] + '</a></p>' : '') : '';
  const writeHub = (rel, opts) => { write(rel, page(shell, { ogType: 'website', image: null, ...opts })); };
  const crumbLd = (...items) => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map(([name, u], i) => ({ '@type': 'ListItem', position: i + 1, name, item: SITE + u })) });
  const listLd = (name, urls) => ({ '@context': 'https://schema.org', '@type': 'ItemList', name, numberOfItems: urls.length, itemListElement: urls.slice(0, 100).map((u, i) => ({ '@type': 'ListItem', position: i + 1, url: SITE + u })) });

  // Genres (pages written below)
  const GENRE_RULES = [['Action', /action|spy|superhero|heist/], ['Comedy', /comed|rom-com/], ['Drama', /drama/], ['Thriller', /thriller|mystery|crime/], ['Horror', /horror/],
    ['Romance', /roman|rom-com/], ['Family', /family/], ['Animated', /animat/], ['Biopic', /biograph|biopic/], ['Mythological', /myth|epic/], ['War', /war/], ['Sci-fi', /science|sci-fi/]];
  const genreSlug = g => g.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const byGenre = {}; GENRE_RULES.forEach(([g]) => { byGenre[g] = []; });
  movies.forEach(m => { const t = String(m.data.genre || '').toLowerCase(); GENRE_RULES.forEach(([g, re]) => { if (re.test(t)) byGenre[g].push(m); }); });
  const genreList = GENRE_RULES.map(x => x[0]).filter(g => byGenre[g].length);
  const genreLinks = () => genreList.map(g => '<li><a href="/genre/' + genreSlug(g) + '">' + esc(g) + '</a> <span class="note">' + byGenre[g].length + '</span></li>').join('');

  // Home
  const released = m => isTv(m.data) || !(m.data.releaseDate > today);
  let homeBody = '<h1>Verdicts on Indian movies and series</h1><p>Reelscore tracks ' + movies.length + ' Bollywood and regional Indian films and shows. ' +
    'For each one, people say whether it is worth the theatre, worth streaming on OTT, or worth skipping.</p>';
  homeBody += block('In theatres now', bySection['In theatres'].slice(0, 18).map(titleLi), ['/browse/in-theatres', 'All ' + bySection['In theatres'].length + ' in theatres →']);
  homeBody += block('Coming soon', bySection['Coming soon'].slice(0, 18).map(titleLi), ['/browse/coming-soon', 'All ' + bySection['Coming soon'].length + ' coming soon →']);
  homeBody += block('On OTT', bySection['On OTT'].slice(0, 18).map(titleLi), ['/browse/on-ott', 'All ' + bySection['On OTT'].length + ' on OTT →']);
  homeBody += block('Recently released', movies.filter(released).filter(m => sectionOf(m) === 'Older releases').sort(newest).slice(0, 18).map(titleLi), ['/browse/older-releases', 'All older releases →']);
  homeBody += block('Popular people', hubPeople.slice(0, 24).map(personLi), ['/people', 'All ' + hubPeople.length + ' people →']);
  homeBody += '<h2>Browse</h2><ul>' + HUBS.map(h => '<li><a href="/browse/' + h[0] + '">' + h[1] + '</a> <span class="note">' + bySection[h[1]].length + '</span></li>').join('') +
    langList.map(l => '<li><a href="/browse?lang=' + encodeURIComponent(l) + '">' + esc(l) + ' movies</a> <span class="note">' + langs[l] + '</span></li>').join('') + '</ul>';
  homeBody += '<h2>Genres</h2><ul>' + genreLinks() + '</ul>';
  { const ny = new Date().getFullYear(), ys = []; for (let k = ny; k > ny - 10; k--) ys.push(k);
    homeBody += '<h2>Movies by year</h2><ul>' + ys.map(k => '<li><a href="/year/' + k + '">' + k + '</a></li>').join('') + '</ul>'; }
  homeBody += '<p><a href="/about">About Reelscore and how scores work</a></p>';
  const homeHtml = page(shell, { title: 'Reelscore — Reviews for Indian movies and series', description: 'Verdicts, reviews and trailers for Bollywood and regional Indian films and series, with scores from people you follow.',
    canonical: '/', ogPath: '/', ogType: 'website', image: null, jsonld: homeLd, route: 'home', body: homeBody });
  write('index.html', homeHtml);

  // Browse: all sections, then one page per section listing every title in it
  let browseBody = '<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › Browse</nav><h1>Browse Indian movies and series</h1><p>' + movies.length + ' titles in ' + langList.length + '+ languages.</p>';
  HUBS.forEach(h => { browseBody += block(h[1] + ' <span class="note">' + bySection[h[1]].length + '</span>', bySection[h[1]].slice(0, 12).map(titleLi), ['/browse/' + h[0], 'See all ' + bySection[h[1]].length + ' →']); });
  browseBody += '<h2>By genre</h2><ul>' + genreLinks() + '</ul>';
  browseBody += '<h2>By language</h2><ul>' + langList.map(l => '<li><a href="/browse?lang=' + encodeURIComponent(l) + '">' + esc(l) + '</a> <span class="note">' + langs[l] + '</span></li>').join('') + '</ul>';
  writeHub('browse.html', { title: 'Browse Indian Movies & Series | Reelscore', description: 'Browse ' + movies.length + ' Bollywood and regional Indian movies and series: in theatres, coming soon, on OTT, older releases and TV shows.', canonical: '/browse', ogPath: '/browse', route: 'browse', body: browseBody,
    jsonld: [crumbLd(['Home', '/'], ['Browse', '/browse']), listLd('Browse sections', HUBS.map(h => '/browse/' + h[0]))] });
  for (const [slug, name, title, desc] of HUBS) {
    const list = bySection[name];
    const body = '<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › <a href="/browse">Browse</a> › ' + esc(name) + '</nav><h1>' + esc(name) + '</h1><p>' + list.length + ' title' + (list.length === 1 ? '' : 's') + '. ' + esc(desc) + '</p>' +
      (list.length ? '<ul>' + list.map(titleLi).join('') + '</ul>' : '<p>Nothing here right now.</p>') +
      '<h2>Other sections</h2><ul>' + HUBS.filter(x => x[0] !== slug).map(x => '<li><a href="/browse/' + x[0] + '">' + x[1] + '</a></li>').join('') + '</ul>';
    writeHub('browse/' + slug + '.html', { title, description: desc, canonical: '/browse/' + slug, ogPath: '/browse/' + slug, route: 'browse', body,
      jsonld: [crumbLd(['Home', '/'], ['Browse', '/browse'], [name, '/browse/' + slug]), listLd(name, list.map(movieUrl))] });
    sitemap.push({ loc: '/browse/' + slug, pri: '0.7' });
  }

  // Genre landing pages: /genre/<slug>. Genres and matching rules are the same as app/main.js GENRES / genreTags.
  for (const g of genreList) {
    const list = byGenre[g].slice().sort(newest), lc = g.toLowerCase(), slug = genreSlug(g);
    const desc = 'Indian ' + lc + ' movies and series: ' + list.length + ' Bollywood and regional titles in theatres, coming soon and on OTT, with verdicts on whether each is worth watching.';
    let body = '<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › <a href="/browse">Browse</a> › ' + esc(g) + '</nav><h1>Indian ' + esc(lc) + ' movies and series</h1><p>' + esc(desc) + '</p>';
    body += '<ul>' + list.map(titleLi).join('') + '</ul>';
    body += '<h2>Other genres</h2><ul>' + genreList.filter(x => x !== g).map(x => '<li><a href="/genre/' + genreSlug(x) + '">' + esc(x) + '</a> <span class="note">' + byGenre[x].length + '</span></li>').join('') + '</ul>';
    writeHub('genre/' + slug + '.html', { title: 'Indian ' + g + ' Movies & Series | Reelscore', description: clip(desc, 158), canonical: '/genre/' + slug, ogPath: '/genre/' + slug, route: 'genre', body,
      jsonld: [{ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: SITE + '/' }, { '@type': 'ListItem', position: 2, name: 'Browse', item: SITE + '/browse' }, { '@type': 'ListItem', position: 3, name: g, item: SITE + '/genre/' + slug }] }] });
    sitemap.push({ loc: '/genre/' + slug, pri: '0.7' });
  }

  // Year landing pages: /year/<yyyy>, movies only, most popular first (same rule as app/main.js popularityOf).
  const byYear = {};
  movies.forEach(m => { if (isTv(m.data)) return; const y = String(m.data.releaseDate || '').slice(0, 4); if (/^\d{4}$/.test(y)) (byYear[y] = byYear[y] || []).push(m); });
  const popOf = m => score(m.id).tot * 1000 + (m.data.cast || []).filter(c => !CREW_RE.test(c.role || '')).slice(0, 4).reduce((t, c) => t + titleCount(personSlug(c.name)), 0) + (m.data.posterUrl ? 5 : 0);
  const thisYear = new Date().getFullYear();
  for (const y of Object.keys(byYear)) {
    const list = byYear[y].map(m => [m, popOf(m)]).sort((a, b) => b[1] - a[1] || String(b[0].data.releaseDate || '').localeCompare(String(a[0].data.releaseDate || '')) || String(a[0].data.title).localeCompare(String(b[0].data.title))).map(x => x[0]);
    const desc = list.length + ' Bollywood and regional Indian movies ' + (+y > thisYear ? 'due in ' : 'released in ') + y + ', most popular first, with cast, directors and verdicts.';
    const near = []; for (let k = Math.min(thisYear, +y + 3); k >= Math.max(+y - 3, 1950); k--) if (String(k) !== y && byYear[k]) near.push(String(k));
    const body = '<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › <a href="/browse">Browse</a> › ' + y + '</nav><h1>Indian movies of ' + y + '</h1><p>' + esc(desc) + '</p><ul>' + list.map(titleLi).join('') + '</ul>' +
      (near.length ? '<h2>Other years</h2><ul>' + near.map(k => '<li><a href="/year/' + k + '">' + k + '</a> <span class="note">' + byYear[k].length + '</span></li>').join('') + '</ul>' : '');
    writeHub('year/' + y + '.html', { title: 'Indian Movies of ' + y + ' | Reelscore', description: clip(desc, 158), canonical: '/year/' + y, ogPath: '/year/' + y, route: 'year', body,
      jsonld: [{ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: SITE + '/' }, { '@type': 'ListItem', position: 2, name: 'Browse', item: SITE + '/browse' }, { '@type': 'ListItem', position: 3, name: y, item: SITE + '/year/' + y }] }] });
    sitemap.push({ loc: '/year/' + y, pri: +y >= thisYear - 9 ? '0.7' : '0.5' });
  }

  // People
  const peopleBody = '<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › People</nav><h1>Indian actors and filmmakers</h1><p>' + hubPeople.length +
    ' actors, directors and crew, busiest first.</p><ul>' + hubPeople.map(personLi).join('') + '</ul>';
  writeHub('people.html', { title: 'Indian Actors & Filmmakers | Reelscore', description: 'Filmographies of ' + hubPeople.length + ' Indian actors, directors and crew, with every movie and show they worked on.', canonical: '/people', ogPath: '/people', route: 'people', body: peopleBody,
    jsonld: [crumbLd(['Home', '/'], ['People', '/people']), listLd('Indian actors and filmmakers', hubPeople.map(k => '/person/' + k))] });

  // ----- About / how scores work -----
  {
    const t = VERD.theatre, o = VERD.ott;
    const body = '<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › About</nav>' +
      '<h1>About Reelscore and how scores work</h1>' +
      '<p>Reelscore is an independent site, built in India, for people who watch films and series in more than one Indian language. It answers one practical question about every title: is it worth the trip to the theatre, worth streaming at home, or worth skipping? The catalogue covers ' + movies.length + ' Bollywood and regional titles in Hindi, Tamil, Telugu, Malayalam, Kannada, Bengali, Marathi and more, with pages for ' + nPeople + ' actors and filmmakers.</p>' +
      '<h2>Verdicts</h2>' +
      '<p>Anyone signed in with a Google account can give a verdict once a title is out. Each person has one verdict per title and can change or remove it at any time. There are three choices:</p>' +
      '<ul><li>For films in theatres: <b>' + esc(t[0][1]) + '</b> (' + esc(t[0][2].toLowerCase()) + '), <b>' + esc(t[1][1]) + '</b> (' + esc(t[1][2].toLowerCase()) + ') or <b>' + esc(t[2][1]) + '</b> (' + esc(t[2][2].toLowerCase()) + ').</li>' +
      '<li>For films on OTT and TV shows: <b>' + esc(o[0][1]) + '</b>, <b>' + esc(o[1][1]) + '</b> or <b>' + esc(o[2][1]) + '</b>.</li></ul>' +
      '<p>Verdicts for upcoming films open on their release date, so a score only reflects people who could have seen the film.</p>' +
      '<h2>How the score is worked out</h2>' +
      '<p>A title’s score is the share of its verdicts that recommend watching it at all: the first two choices count as positive, Skip counts as negative. If 80 people give a verdict and 60 of them pick ' + esc(t[0][1]) + ' or ' + esc(t[1][1]) + ', the score is 75%. Below the score you can see how the verdicts split across all three choices, so a 75% made mostly of “' + esc(t[1][1]) + '” reads differently from one made mostly of “' + esc(t[0][1]) + '”.</p>' +
      '<p>Every verdict counts the same. There are no critic weightings, no paid placements and no hidden adjustments, and nobody at Reelscore edits or removes verdicts to change a score. A score appears in search results only once a title has at least ' + MIN_VERDICTS + ' verdicts.</p>' +
      '<h2>Peer Score</h2>' +
      '<p>You can follow people whose taste you trust. On every title, the Peer Score shows the same percentage worked out only from the people you follow. It appears once at least three of them have given a verdict.</p>' +
      '<h2>Reviews</h2>' +
      '<p>Alongside a verdict, anyone signed in can write a review of up to 2,000 characters, and mark it as containing spoilers so it stays hidden until a reader chooses to open it. Reviews are public and shown with the writer’s name. You can edit or delete your own review at any time.</p>' +
      '<p>Reviews must be about the title. Reviews that are abusive, hateful, spam, copied from elsewhere or that reveal spoilers without the spoiler mark are removed.</p>' +
      '<h2>Where the information comes from</h2>' +
      '<p>Titles, release dates, cast and crew are compiled by the Reelscore team from public release information, with many older film facts (release dates, languages, cast, crew and IMDb links) drawn from <a href="https://www.wikidata.org/" rel="noopener">Wikidata</a>, which is free to reuse (CC0). Story summaries are written by the team in our own words. TV show details and images marked as coming from TVmaze are from <a href="https://www.tvmaze.com/" rel="noopener">TVmaze</a>, licensed under <a href="https://creativecommons.org/licenses/by-sa/4.0/" rel="noopener license">CC BY-SA 4.0</a>. Posters are shown only with the permission of the film’s producer or distributor, or under a licence that allows it. Trailers, teasers and songs are linked only from the official channels of the studios, music labels and streaming services that published them, and play on Reelscore without leaving the site.</p>' +
      '<p><a href="/browse">Browse all titles</a> · <a href="/people">Actors and filmmakers</a> · <a href="/trailers">Latest trailers</a></p>';
    writeHub('about.html', { title: 'About Reelscore & How Scores Work', description: 'How Reelscore verdicts become a score: one verdict per person, the share that say watch it, Peer Score from people you follow, and the rules for reviews.', canonical: '/about', ogPath: '/about', route: 'about', body,
      jsonld: [{ '@context': 'https://schema.org', '@type': 'AboutPage', name: 'About Reelscore and how scores work', url: SITE + '/about', about: { '@type': 'Organization', name: 'Reelscore', url: SITE + '/' } },
        { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: SITE + '/' }, { '@type': 'ListItem', position: 2, name: 'About', item: SITE + '/about' }] }] });
    sitemap.push({ loc: '/about', pri: '0.5' });
  }

  // ----- aliases, people with too few credits for an indexed page, 404 -----
  // These exist so real links never hit the 404 page; none are in the sitemap and none are indexed.
  for (const [au, to] of aliases) {
    if (seen.has(au)) continue;
    write(au.slice(1) + '.html', '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Moved | Reelscore</title><meta name="robots" content="noindex,follow"><link rel="canonical" href="' + esc(SITE + to) + '"><meta http-equiv="refresh" content="0; url=' + esc(to) + '"><script>location.replace(' + JSON.stringify(to) + ' + location.search + location.hash)</script></head><body><p><a href="' + esc(to) + '">Continue to the page</a></p></body></html>');
  }
  for (const slug of thinPeople) {
    const name = personName(slug), titles = [...new Map(credits[slug].map(c => [c.m.id, c.m])).values()];
    const body = '<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › <a href="/people">People</a> › ' + esc(name) + '</nav><h1>' + esc(name) + '</h1><ul>' + titles.map(t => '<li><a href="' + movieUrl(t) + '">' + esc(t.data.title) + '</a></li>').join('') + '</ul>';
    write('person/' + slug + '.html', page(shell, { title: personTitleTag(name), description: clip(name + ' on Reelscore: ' + list(titles.slice(0, 3).map(t => t.data.title)) + '.', 158), canonical: '/person/' + slug, ogType: 'profile', image: null, wide: false, jsonld: [], route: 'person', body, robots: 'noindex,follow' }));
  }
  write('404.html', page(shell, { title: 'Page not found | Reelscore', description: 'This page doesn’t exist on Reelscore.', canonical: null, ogPath: '/', ogType: 'website', image: null, jsonld: [], route: 'home', robots: 'noindex',
    body: '<h1>Page not found</h1><p>This page doesn’t exist, or the title has moved.</p><p><a href="/">Go to the home page</a> · <a href="/browse">Browse all titles</a></p>' }).replace('<head>', '<head>\n<script>window.RS_404 = true;</script>'));

  // ----- all trailers, songs and TV promotionals: /trailers, /songs, /tv-promos (same lists as app/main.js) -----
  const vidHubs = [
    ['trailers', 'All trailers', 'Latest Movie Trailers | Reelscore', 'Official trailers and teasers of new Bollywood and regional Indian movies, newest first.', m => !isTv(m.data), x => x.cat === 'trailers', true],
    ['songs', 'All video songs', 'Latest Video Songs | Reelscore', 'Official video and lyric songs from new Bollywood and regional Indian movies, newest first.', m => !isTv(m.data), x => x.cat === 'songs', false],
    ['tv-promos', 'All TV promotionals', 'TV Show Trailers, Promos & Episodes | Reelscore', 'Official trailers, promos and full episodes of Indian TV shows and web series.', m => isTv(m.data), () => true, false]
  ];
  for (const [slug, h1, title, desc, pickM, pickV, onePer] of vidHubs) {
    const items = [];
    movies.filter(pickM).sort(newest).forEach(m => { const vs = ytVideos(m.data).filter(pickV); (onePer ? vs.slice(0, 1) : vs).forEach(x => items.push([m, x])); });
    const body = '<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › ' + esc(h1) + '</nav><h1>' + esc(h1) + '</h1><p>' + items.length + ' videos. ' + esc(desc) + '</p>' +
      '<ul class="pr-vids">' + items.map(([m, x]) => '<li><img src="' + ytThumb(x.yt) + '" alt="' + esc(m.data.title + ' · ' + x.title) + '" width="160" height="90" loading="lazy"> <a href="' + movieUrl(m) + '">' + esc(m.data.title) + '</a> · ' + esc(x.title) + ' <span class="note">' + esc([x.kind, String(m.data.languages || '').split(/[,;]/)[0].trim()].filter(Boolean).join(' · ')) + '</span></li>').join('') + '</ul>' +
      '<h2>More videos</h2><ul>' + vidHubs.filter(v => v[0] !== slug).map(v => '<li><a href="/' + v[0] + '">' + esc(v[1]) + '</a></li>').join('') + '</ul>';
    writeHub(slug + '.html', { title, description: desc, canonical: '/' + slug, ogPath: '/' + slug, route: 'vids', body,
      jsonld: [{ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: SITE + '/' }, { '@type': 'ListItem', position: 2, name: h1, item: SITE + '/' + slug }] }] });
    if (items.length) sitemap.push({ loc: '/' + slug, pri: '0.6' });
  }

  // ----- sitemap + robots -----
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    sitemap.map(u => '<url><loc>' + esc(SITE + u.loc) + '</loc>' + (/^\d{4}-\d{2}-\d{2}$/.test(u.lastmod || '') ? '<lastmod>' + u.lastmod + '</lastmod>' : '') + '<priority>' + u.pri + '</priority></url>').join('\n') + '\n</urlset>\n';
  if (sitemap.length > 50000) throw new Error('Sitemap over 50,000 URLs: split it into a sitemap index');
  write('sitemap.xml', xml);

  // /llms.txt: a short Markdown guide to the site for AI tools (llmstxt.org format).
  const sections = [['In theatres', '/browse/in-theatres'], ['Coming soon', '/browse/coming-soon'], ['On OTT', '/browse/on-ott'], ['TV shows', '/browse/tv-shows'], ['Older releases', '/browse/older-releases']];
  const recent = movies.filter(m => isTv(m.data) || (m.data.releaseDate || '') <= new Date().toISOString().slice(0, 10)).sort((a, b) => String(b.data.releaseDate || '').localeCompare(String(a.data.releaseDate || ''))).slice(0, 25);
  const busiest = Object.keys(credits).filter(indexedPerson).sort((a, b) => titleCount(b) - titleCount(a)).slice(0, 25);
  write('llms.txt', [
    '# Reelscore', '',
    '> Reelscore collects verdicts and reviews for Bollywood and regional Indian movies and series. Each title page shows cast, crew and release details; people say whether a film is worth the theatre, worth streaming on OTT, or worth skipping. A title shows a score once it has ' + MIN_VERDICTS + ' or more verdicts.', '',
    `The catalogue has ${movies.length} titles in Hindi, Tamil, Telugu, Malayalam, Kannada, Bengali and other languages, and pages for ${nPeople} actors and filmmakers.`, '',
    '## Browse', '', '- [All titles](' + SITE + '/browse)', ...sections.map(([n, u]) => '- [' + n + '](' + SITE + u + ')'), '- [People](' + SITE + '/people): actors and filmmakers', '- [About and how scores work](' + SITE + '/about)', '- [Latest trailers](' + SITE + '/trailers)', '- [Video songs](' + SITE + '/songs)', '',
    '## Recent titles', '', ...recent.map(m => '- [' + m.data.title + ' (' + (isTv(m.data) ? 'TV' : year(m.data)) + ')](' + SITE + movieUrl(m) + ')'), '',
    '## Prolific people', '', ...busiest.map(k => '- [' + personName(k) + '](' + SITE + '/person/' + k + ')'), '',
    '## Optional', '', '- [Sitemap](' + SITE + '/sitemap.xml): every title and person page', ''
  ].join('\n'));

  write('robots.txt', ['User-agent: *', 'Disallow: /admin', 'Disallow: /my-list', 'Disallow: /setup', 'Disallow: /data/', '', 'Sitemap: ' + SITE + '/sitemap.xml', ''].join('\n'));

  // ----- fingerprinted assets: /assets/<name>.<hash>.<ext>, cached for a year (vercel.json) -----
  // Every HTML page points at the hashed copies, so a deploy changes the URLs and browsers never run stale code.
  // The plain files stay too (catalogue.json is read by the next build; admin.js is loaded by name).
  const crypto = await import('node:crypto');
  const hashed = {};
  for (const rel of ['app/app.css', 'app/main.js', 'js/claude-shim.js', 'js/firebase-adapter.js', 'firebase-config.js', 'catalogue.json', 'catalogue-core.json', 'catalogue-older.json']) {
    const buf = fs.readFileSync(path.join(OUT, rel)), h8 = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);
    const base = path.basename(rel).replace(/\.(\w+)$/, '.' + h8 + '.$1');
    write('assets/' + base, buf); hashed['/' + rel] = '/assets/' + base;
  }
  const htmlFiles = []; (function walk(dir) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) { if (e.name !== 'assets') walk(f); } else if (e.name.endsWith('.html') && e.name !== 'setup.html') htmlFiles.push(f); } })(OUT);
  for (const f of htmlFiles) {
    let html = fs.readFileSync(f, 'utf8'), changed = false;
    for (const [from, to] of Object.entries(hashed)) { if (/^\/catalogue/.test(from)) continue; const a = '"' + from + '"'; if (html.includes(a)) { html = html.split(a).join('"' + to + '"'); changed = true; } }
    if (html.includes('<!--/seo-->')) { html = html.replace('<!--/seo-->', '<!--/seo-->\n<script>window.RS_CAT=' + JSON.stringify(hashed['/catalogue.json']) + ';window.RS_CAT_CORE=' + JSON.stringify(hashed['/catalogue-core.json']) + ';window.RS_CAT_OLD=' + JSON.stringify(hashed['/catalogue-older.json']) + '</script>'); changed = true; }
    if (changed) fs.writeFileSync(f, html);
  }

  console.log(`[seo] wrote ${nTitles} title pages (${nThinTitles} kept out of the index until they have a story; ${nRated} with rating markup, min ${MIN_VERDICTS} verdicts), ${nPeople} person pages (min ${MIN_CREDITS} titles), sitemap ${sitemap.length} URLs, site ${SITE}, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch(e => { console.error('[seo] build failed:', e && e.stack || e); process.exit(1); });
