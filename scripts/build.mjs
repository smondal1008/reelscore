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
//   SEO_PERSON_TITLES   titles a person needs for an indexed page with no bio or photo (default 8)
//   SEO_PERSON_PHOTO    titles a person with a photo (and no bio) needs for an indexed page (default 4)
//   FULL_REFRESH=1      read every title and person from Firestore even if the last catalogue is recent
//
// It also writes /catalogue.json (every title and person), which the app loads instead of reading the whole
// collection from Firestore on every visit. To keep deploys cheap too, a deploy within 24 hours of the last full
// read starts from the live catalogue.json and fetches only records changed since (updatedAt), plus deletions.
// If Firestore refuses (e.g. the daily free quota is used up), the build reuses the live catalogue unchanged.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist');
// The "About" text for titles and people comes from the same file the app runs (app/about.js), so both say the same thing.
const PRIVACY_UPDATED = '26 November 2026'; // change when the privacy policy text changes
const ABOUT = (() => { const w = {}; new Function('window', fs.readFileSync(path.join(ROOT, 'app', 'about.js'), 'utf8'))(w); return w.RS_ABOUT; })();
const TODAY = new Date().toISOString().slice(0, 10);
// Now playing (set in the admin panel): theatres | out | ott | direct. It decides a film's home page section, and
// a film marked theatres or out moves to ott once its OTT Release Date has passed. Same rule in scripts/build.mjs
// and app/admin.js. TV shows keep their section; for them it is a label only.
const NP_LABEL = { theatres: 'Theatres only', out: 'Out of theatres', ott: 'Now on OTT', direct: 'Direct to OTT' };
function npToday() { const t = new Date(); return t.getFullYear() + '-' + ('0' + (t.getMonth() + 1)).slice(-2) + '-' + ('0' + t.getDate()).slice(-2); }
function nowPlayingOf(d, today) {
  let np = d.nowPlaying || ''; today = today || npToday();
  if ((np === 'theatres' || np === 'out') && d.ottReleaseDate && d.ottReleaseDate <= today) np = 'ott';
  return NP_LABEL[np] ? np : '';
}
function npSection(d, today) {
  const np = nowPlayingOf(d, today); today = today || npToday();
  if (!np || d.section === 'TV shows') return d.section;
  if (d.releaseDate && d.releaseDate > today) return 'Coming soon';
  if (np === 'theatres') return 'In theatres';
  if (np === 'out') return 'Older releases';
  // On OTT while recent (streaming for under a year); after that it is an older release that streams.
  const from = d.ottReleaseDate || d.releaseDate || ''; const ago = new Date(); ago.setFullYear(ago.getFullYear() - 1);
  return !from || from >= ago.toISOString().slice(0, 10) ? 'On OTT' : 'Older releases';
}

const SITE = (process.env.SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? 'https://' + process.env.VERCEL_PROJECT_PRODUCTION_URL : 'https://reelscore-xi.vercel.app')).replace(/\/+$/, '');
const MIN_VERDICTS = Math.max(1, parseInt(process.env.SEO_MIN_VERDICTS, 10) || 10);
// Person pages open to search engines (the rest are kept for visitors with noindex,follow and left out of the sitemap):
// a bio, or a photo and PERSON_PHOTO titles, or PERSON_TITLES titles. Titles count only if they have real content (richTitle).
const PERSON_TITLES = Math.max(1, parseInt(process.env.SEO_PERSON_TITLES, 10) || 8);
const PERSON_PHOTO = Math.max(1, parseInt(process.env.SEO_PERSON_PHOTO, 10) || 4);
const SKIP = new Set(['dist', 'scripts', 'node_modules', 'README.md', 'package.json', 'package-lock.json', 'vercel.json', 'firestore.rules', 'content']);

// ---------- helpers shared with the app (keep in step with app/main.js) ----------
const slugify = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
const personSlug = n => String(n || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
const CREW_RE = /(director|producer|music|writer|screenplay|composer|cinematograph|editor)/i;
const HOST_RE = /^(as\s+)?(host|co-host|judge|narrator|guest|presenter|anchor|mentor|contestant|self)\b/i;
const hostOf = c => HOST_RE.test(String((c && c.role) || '').trim()) ? String(c.role).trim().replace(/^as\s+/i, '') : '';
const charOf = c => { if (!c) return ''; const x = String(c.character || '').trim(); if (x) return x; const r = String(c.role || '').trim(); return r && !CREW_RE.test(r) && !/^(cast|actor|actress|lead|self)$/i.test(r) && !HOST_RE.test(r) ? r.replace(/^as\s+/i, '') : ''; };
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
function vidCat(k) { k = String(k || '').toLowerCase(); return /trailer|teaser|promo|glimpse/.test(k) ? 'trailers' : /song|lyric|music|jukebox|audio|soundtrack|score|bgm|\bost\b|theme/.test(k) ? 'songs' : /episode/.test(k) ? 'episodes' : 'more'; }
function ytVideos(d) { return (d.videos || []).map(x => ({ title: x.title || x.kind || 'Video', kind: x.kind || 'Video', yt: ytId(safeUrl(x.url)), cat: vidCat(x.kind), addedAt: x.addedAt || '', publishedAt: /^\d{4}-\d{2}-\d{2}/.test(x.publishedAt || '') ? x.publishedAt.slice(0, 10) : '' })).filter(x => x.yt); }
// Same rule as app/main.js: ask Cloudinary for a sized, compressed copy instead of the uploaded original.
function cld(u, w) {
  const m = typeof u === 'string' && u.match(/^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.*)$/);
  if (!m || /^[a-z]{1,3}_[^/]*\//.test(m[2])) return u;
  return m[1] + 'f_auto,q_auto,c_limit,w_' + (w || 800) + '/' + m[2];
}
const ytThumb = id => 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg';
// Shareable video pages, one per YouTube video: /movie/<slug>/trailer, /trailer/<name>, /song/<name>, /episode…, /video…
// The first trailer (or episode, or other video) is just /trailer; songs always carry their name. Same rule as app/main.js videoPaths.
const VSEG = { trailers: 'trailer', songs: 'song', episodes: 'episode', more: 'video' };
function videoPaths(d) {
  const out = [], used = {};
  (d.videos || []).forEach((x, i) => {
    const id = ytId(safeUrl(x.url)); if (!id) return;
    const seg = VSEG[vidCat(x.kind)], first = !used[seg];
    let p = '/' + seg + (seg === 'song' || !first ? '/' + (slugify(x.title || '').slice(0, 60).replace(/-+$/, '') || seg) : '');
    if (used[p]) { let n = 2; while (used[p + '-' + n]) n++; p += '-' + n; }
    used[seg] = 1; used[p] = 1;
    out.push({ i, yt: id, seg, path: p, title: x.title || x.kind || 'Video', kind: x.kind || 'Video', publishedAt: /^\d{4}-\d{2}-\d{2}/.test(x.publishedAt || '') ? x.publishedAt.slice(0, 10) : '' });
  });
  return out;
}
// Same as app/main.js videoTitleTag.
function videoTitleTag(d, v, tv) {
  const y = /^\d{4}/.test(d.releaseDate || '') ? String(d.releaseDate).slice(0, 4) : '', yy = y && !tv ? ' (' + y + ')' : '';
  const a = v.seg === 'song' ? v.title + ' – ' + d.title + yy + ' Song | Reelscore' : d.title + yy + ' – ' + v.title + ' | Reelscore';
  return a.length <= 60 ? a : a.replace(/ \| Reelscore$/, '');
}
// Words after a title's name in its page title, picked by what the page actually has (seo/README.md and the
// "Reelscore SEO reference" doc). Kept in step with app/main.js titleTail. o: { tv, upcoming, theatres, platform,
// verdicts, songs, popular, boxOffice, ottDate, tickets }.
function titleTail(base, o) {
  const say = ws => base + ' ' + (ws.length === 1 ? ws[0] : ws.slice(0, -1).join(', ') + ' & ' + ws[ws.length - 1]);
  let cands = [];
  const drops = (full, order) => { const out = [full]; let c = full; order.forEach(w => { if (c.indexOf(w) !== -1 && c.length > 1) { c = c.filter(x => x !== w); out.push(c); } }); return out; };
  if (o.tv) cands = o.platform ? drops(['Review', 'Cast', 'Where to Watch'], ['Cast', 'Where to Watch']) : drops(['Review', 'Cast'], ['Cast']);
  else if (o.upcoming) cands = drops(o.songs ? ['Release Date', 'Songs', 'Trailer'] : ['Release Date', 'Cast', 'Trailer'], ['Trailer', 'Songs', 'Cast']);
  else if (o.theatres) {
    // In theatres: add words in this order while the title stays within 60 characters.
    const order = ['Verdict', o.verdicts >= 3, 'Box Office', o.boxOffice, 'OTT Release Date', o.ottDate, 'Songs', o.songs, 'Tickets', o.tickets, 'Cast', true];
    const ws = ['Review'];
    for (let i = 0; i < order.length; i += 2) if (order[i + 1] && say(ws.concat(order[i])).length <= 60) ws.push(order[i]);
    cands = [ws];
  } else {
    const full = !o.platform ? ['Review', 'Cast', o.songs ? 'Songs' : 'Story']
      : o.popular ? ['Review', o.songs ? 'Songs' : 'Cast', 'Where to Watch']
      : o.verdicts >= 3 ? ['Review', 'Verdict'].concat(o.songs ? ['Songs'] : [], ['OTT'])
      : ['Review', 'Cast'].concat(o.songs ? ['Songs'] : [], ['OTT']);
    cands = drops(full, ['Cast', 'Songs', 'Story', 'Verdict', 'Where to Watch', 'OTT']);
  }
  for (const n of [60, 65]) for (const c of cands) { const t = say(c); if (t.length <= n) return t; }
  return (base + ' | Reelscore').length <= 60 ? base + ' | Reelscore' : base.length <= 65 ? base : clip(base, 65);
}
// Box office figures (Admin › Box office), in ₹ crore; null when none are filled in. Same as app/main.js boData.
function boOf(d) {
  const n = v => { const x = parseFloat(String(v == null ? '' : v).replace(/[,₹\s]|cr(ore)?s?\.?$/ig, '')); return isFinite(x) && x > 0 ? x : null; };
  const o = { gross: n(d.boGross), nett: n(d.boNett), world: n(d.boWorld), day: n(d.boDay), updated: /^\d{4}-\d{2}-\d{2}$/.test(d.boUpdated || '') ? d.boUpdated : '', source: String(d.boSource || '').trim(), url: safeUrl(d.boUrl) };
  return o.gross || o.nett || o.world || o.day ? o : null;
}
// Every box office tile filled (app/main.js boFull): India gross, nett, worldwide, and the latest day's nett while in
// theatres (or when entered), else overseas (worldwide above India gross). Partial figures get no section and no
// "Box Office" in the title.
function boFullOf(d) {
  const b = boOf(d); if (!b) return null;
  const fourth = d.section === 'In theatres' || b.day ? b.day : (b.world && b.gross && b.world > b.gross ? b.world - b.gross : null);
  return b.gross && b.nett && b.world && fourth ? b : null;
}
// Ticket partners with at least one working link: [{ platform, url }] (first city's link for each).
function ticketsOf(d) {
  const first = urls => { const u = Object.values(urls || {}).map(x => safeUrl(String(x || '').trim())).find(Boolean); return u || ''; };
  const main = Object.assign({}, d.bookingUrls || {}); if (d.bookingUrl && !main.Bengaluru) main.Bengaluru = d.bookingUrl;
  return [{ platform: String(d.bookingPlatform || '').trim(), url: first(main) }]
    .concat((Array.isArray(d.moreBooking) ? d.moreBooking : []).filter(Boolean).map(x => ({ platform: String(x.platform || '').trim(), url: first(x.urls) })))
    .filter(x => x.url);
}
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
    async get(p) { const j = await call(base + '/' + p); reads++; return j ? toDoc(j) : null; },
    async where(name, field, value) {
      const j = await call(base + ':runQuery', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ structuredQuery: {
        from: [{ collectionId: name }], where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: value } } } } }) });
      const out = (j || []).filter(x => x.document).map(x => toDoc(x.document));
      reads += out.length || 1;
      return out;
    }
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

// Sitemap dates: each page's content hash and the day it last changed, carried from the live site's page-dates.json.
// A page gets a date only once a change is seen after this was introduced (bulk edits had stamped every record with
// the same updatedAt, which told search engines nothing).
let PREV_DATES = {};
const LANG_PAGES = [];
const PAGE_DATES = {};
async function previousPageDates() {
  if (process.env.FIXTURE) return {};
  try {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 20000);
    const r = await fetch(SITE + '/page-dates.json', { signal: ctl.signal }); clearTimeout(t);
    return r.ok ? (await r.json()) || {} : {};
  } catch (e) { return {}; }
}
function pageDate(url, content) {
  const h = createHash('sha1').update(content).digest('hex').slice(0, 12), p = PREV_DATES[url];
  const d = p ? (p.h === h ? p.d || '' : TODAY) : '';
  PAGE_DATES[url] = d ? { h, d } : { h };
  return d;
}

// Titles the admin pins to the front of a homescreen row (settings/rows, set in Admin > Home rows):
// In theatres, Coming soon, New on OTT, New trailers, New songs and New TV promotionals.
const ROW_KEYS = ['theatres', 'coming', 'ott', 'trailers', 'songs', 'tvpromos'];
function cleanRows(d) { const ids = a => Array.isArray(a) ? a.filter(x => typeof x === 'string') : [], o = {}; ROW_KEYS.forEach(k => { o[k] = ids(d && d[k]); }); return o; }
// Book tickets / Watch now switched per page in Admin > Buttons (settings/buttons); anything missing counts as shown.
function cleanBtns(d) { const o = {}; ['home', 'browse', 'lang', 'mylist', 'title'].forEach(k => { const x = (d && d[k]) || {}; o[k] = { book: x.book !== false, watch: x.watch !== false }; }); return o; }
// Pinned films first, in the admin's order; everything else keeps its own order after them.
function pinFirst(list, ids) {
  if (!ids || !ids.length) return list;
  const pos = new Map(); ids.forEach((id, i) => { if (!pos.has(id)) pos.set(id, i); });
  return list.filter(m => pos.has(m.id)).sort((a, b) => pos.get(a.id) - pos.get(b.id)).concat(list.filter(m => !pos.has(m.id)));
}

// The home page's featured titles (settings/home, set in the admin panel), so the hero is right before Firestore loads.
const cleanIds = a => Array.isArray(a) ? a.filter(x => typeof x === 'string' && x).slice(0, 50) : [];
// Returns { movies, people, verdicts, rows, buttons, featured, builtAt, fullAt, source }.
async function loadData() {
  if (process.env.FIXTURE) { const f = loadFixture(process.env.FIXTURE); return { ...f, rows: cleanRows(f.rows), buttons: cleanBtns(f.buttons), featured: cleanIds(f.featured), builtAt: new Date().toISOString(), fullAt: new Date().toISOString(), source: 'fixture' }; }
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
      const [dm, dp, del, verdicts, rows, btns, home] = await Promise.all([db.changedSince('movies', since), db.changedSince('people', since), db.get('settings/deleted'), db.list('verdicts'), db.get('settings/rows').catch(() => null), db.get('settings/buttons').catch(() => null), db.get('settings/home').catch(() => null)]);
      const tomb = { movies: {}, people: {} }; ((del && del.data) || {}).movies?.forEach(x => x && x.id && (tomb.movies[x.id] = x.at || ''));
      ((del && del.data) || {}).people?.forEach(x => x && x.id && (tomb.people[x.id] = x.at || ''));
      const merge = (baseList, delta, t) => {
        const m = new Map(baseList.map(x => [x.id, x])); delta.forEach(x => m.set(x.id, x));
        return [...m.values()].filter(x => !(t[x.id] && (!x.data.updatedAt || t[x.id] > x.data.updatedAt)));
      };
      const p = fromPrev();
      console.log(`[seo] incremental: ${dm.length} titles and ${dp.length} people changed since ${since}; ${db.reads} reads`);
      return { movies: merge(p.movies, dm, tomb.movies), people: merge(p.people, dp, tomb.people), verdicts, rows: cleanRows(rows && rows.data), buttons: cleanBtns(btns && btns.data), featured: cleanIds(home && home.data && home.data.featured), builtAt: started, fullAt: prev.fullAt, source: 'incremental' };
    }
    const [movies, people, verdicts, rows, btns, home] = await Promise.all([db.list('movies'), db.list('people'), db.list('verdicts'), db.get('settings/rows').catch(() => null), db.get('settings/buttons').catch(() => null), db.get('settings/home').catch(() => null)]);
    console.log(`[seo] full read: ${db.reads} reads`);
    return { movies, people, verdicts, rows: cleanRows(rows && rows.data), buttons: cleanBtns(btns && btns.data), featured: cleanIds(home && home.data && home.data.featured), builtAt: started, fullAt: started, source: 'full' };
  } catch (e) {
    if (!prev) throw e;
    // Keep builtAt from the previous file so the app still asks for every change made since then.
    console.warn('[seo] Firestore unavailable (' + e.message + '); reusing the live catalogue.json from ' + prev.builtAt);
    return { ...fromPrev(), verdicts: [], rows: cleanRows(prev.rows), buttons: cleanBtns(prev.buttons), featured: cleanIds(prev.featured), builtAt: prev.builtAt, fullAt: prev.fullAt, source: 'previous' };
  }
}

function loadFixture(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const wrap = (arr) => (arr || []).map(x => x.data ? x : { id: x.id, data: Object.fromEntries(Object.entries(x).filter(([k]) => k !== 'id')), updated: x.updated || '' });
  return { movies: wrap(j.movies), people: wrap(j.people), verdicts: wrap(j.verdicts), rows: j.rows, buttons: j.buttons, featured: j.featured };
}

// ---------- output helpers ----------
// Minify the app's scripts and styles in dist/ (esbuild, from package.json). Without it the build still works, unminified.
// Only whitespace, syntax and local names change: each file keeps its global names, so the files still work together.
// The hero as app/main.js draws it (drawHero for the home banner, titleHero for a title page), written into the page so it
// shows before any script runs. Same classes and structure, so it takes the same space; its pictures are set by HERO_JS
// at the sizes the app asks for, and the app swaps in its own copy (same size, same picture) when it starts.
// Kept in step with app/main.js heroLine, drawHero and the title hero; buttons that need the app link to the page instead.
function heroLineOf(d) {
  const hk = String(d.hook || '').trim(); if (hk) return hk;
  const syn = String(d.synopsis || '').trim(); if (!syn) return '';
  const m = syn.match(/^.{20,}?[.!?](?=\s|$)/), first = m ? m[0] : syn;
  return first.length > 160 ? first.slice(0, 157).replace(/\s+\S*$/, '') + '…' : first;
}
function homeHeroMarkup(m, url, n) {
  const d = m.data, tv = d.section === 'TV shows', ott = d.section === 'On OTT';
  const bits = [tv ? 'TV show' + (d.platform ? ' · ' + d.platform : '') : ott ? 'Film · ' + (d.platform || 'OTT') : 'Film',
    String(d.genre || '').split(/,| /)[0] ? String(d.genre).split(',')[0] : null, d.releaseDate ? String(d.releaseDate).slice(0, 4) : null, d.runtime || null].filter(Boolean);
  const meta = bits.map((t, i) => (i ? '<i aria-hidden="true"></i>' : '') + '<span>' + esc(t) + '</span>').join('') + (d.certificate ? '<i aria-hidden="true"></i><span class="cert">' + esc(d.certificate) + '</span>' : '');
  const len = String(d.title || '').length, line = heroLineOf(d);
  const banner = safeUrl(d.bannerUrl);
  return '<div id="heroBox" data-kind="home"' + (banner ? ' data-banner="' + esc(banner) + '"' : '') + '><section class="fh rs-static" aria-label="Featured: ' + esc(d.title) + '"><div class="scrim"></div><div class="fb">' +
    '<div class="logo' + (len > 28 ? ' long' : len > 16 ? ' mid' : '') + '">' + esc(d.title) + '</div><div class="meta">' + meta + '</div>' +
    (line ? '<p class="syn">' + esc(line) + '</p>' : '') +
    '<div class="btns"><a class="pill play" href="' + esc(url) + '"><span aria-hidden="true">▶</span>Trailer</a><a class="pill info" href="' + esc(url) + '">View details</a>' +
    '<span class="roundadd" aria-hidden="true">+</span></div></div>' +
    (n > 1 ? '<div class="fdots" aria-hidden="true">' + Array.from({ length: n }, (_, i) => '<button type="button" tabindex="-1" aria-current="' + (i === 0) + '"><span></span></button>').join('') + '</div>' : '') +
    '</section></div>' + inlineHeroTag();
}
function titleHeroMarkup(m, url, yearText, trailerPath) {
  const d = m.data, line = heroLineOf(d);
  const bits = [yearText, d.languages, d.genre, d.runtime].filter(Boolean);
  const banner = safeUrl(d.bannerUrl), poster = safeUrl(d.posterUrl);
  return '<div class="tpage rs-statwrap" data-kind="title"' + (banner ? ' data-banner="' + esc(banner) + '"' : '') + (poster ? ' data-poster="' + esc(poster) + '"' : '') + '><section class="tp art rs-static"><div class="shade"></div><div class="in">' +
    '<div class="poster art" role="img" aria-label="' + esc(d.title) + ' poster"></div><div class="txt">' +
    '<a href="/" style="color:var(--muted);font-weight:600;font-size:14px;text-decoration:none">← Back to home</a>' +
    '<div class="display ttl" style="font-size:clamp(44px,6vw,84px)">' + esc(d.title) + '</div>' +
    (d.subtitle ? '<div class="display sbt" style="font-size:clamp(24px,3vw,36px);color:#D9D5DF">' + esc(d.subtitle) + '</div>' : '') +
    (bits.length || d.certificate ? '<p class="tmeta">' + esc(bits.join(' · ')) + (d.certificate ? '<span class="cert">' + esc(d.certificate) + '</span>' : '') + '</p>' : '') +
    (line ? '<p class="lede hook">' + esc(line) + '</p>' : '') +
    // Watchlist and Share need the app: shown as they will look, not yet usable (the app replaces them in a moment).
    '<div class="acts2">' + (trailerPath ? '<a class="btn lg primary" style="text-decoration:none" href="' + esc(url + trailerPath) + '">▶  Watch trailer</a>' : '') +
    '<span class="btn lg glass" aria-hidden="true">+  Watchlist</span><span class="btn lg glass" aria-hidden="true">Share</span></div>' +
    '</div></div></section></div>' + inlineHeroTag();
}

// Runs inside the page, right after the hero written into it (homeHeroMarkup / titleHeroMarkup): asks for the hero's
// pictures while the page is still being read, at the sizes app/main.js will ask for, and puts them on the hero. Its text
// never changes, so vercel.json's Content-Security-Policy allows exactly it by its hash (INLINE_HERO_HASH; the build
// checks the two agree and leaves the snippet out, with a warning, if they don't). HERO_JS below does the same later as
// a fallback; the browser fetches each picture once.
const INLINE_HERO_JS = "(function(){try{var w=document.currentScript.previousElementSibling,k=w.getAttribute('data-kind');" +
  "if(k==='home'&&location.pathname!=='/')return;" +
  "var D=Math.min(window.devicePixelRatio||1,2),V=Math.max(320,Math.min(window.innerWidth||1280,2560));" +
  "var c=function(u,x){var m=u.match(/^(https:\\/\\/res\\.cloudinary\\.com\\/[^/]+\\/image\\/upload\\/)(.*)$/);if(!m||/^[a-z]{1,3}_[^/]*\\//.test(m[2]))return u;return m[1]+'f_auto,q_auto,c_limit,w_'+x+'/'+m[2];};" +
  "var p=function(u,hi){var l=document.createElement('link');l.rel='preload';l.as='image';l.href=u;if(hi)l.setAttribute('fetchpriority','high');document.head.appendChild(l);};" +
  "var s=function(el,u){if(el)el.style.backgroundImage='url(\"'+u.replace(/\"/g,'%22')+'\")';};" +
  "var b=w.getAttribute('data-banner'),q=w.getAttribute('data-poster');" +
  "if(/^https:\\/\\//.test(b||'')){var bu=c(b,Math.min(1920,Math.ceil(V*D/320)*320));p(bu,1);s(w.querySelector('.rs-static'),bu);}" +
  "if(/^https:\\/\\//.test(q||'')){var qu=c(q,480);p(qu,!b);s(w.querySelector('.poster'),qu);}}catch(e){}})();";
const INLINE_HERO_HASH = "'sha256-" + createHash('sha256').update(INLINE_HERO_JS).digest('base64') + "'";
let INLINE_HERO_OK = null;
function inlineHeroTag() {
  if (INLINE_HERO_OK === null) {
    INLINE_HERO_OK = fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8').includes(INLINE_HERO_HASH);
    if (!INLINE_HERO_OK) console.warn('[seo] vercel.json script-src lacks ' + INLINE_HERO_HASH + ': the inline hero snippet is left out (pictures load a little later)');
  }
  return INLINE_HERO_OK ? '<script>' + INLINE_HERO_JS + '</script>' : '';
}

// Runs from the small catalogue script, before app/main.js: asks for the page's hero pictures at once, at exactly the
// sizes app/main.js will ask for (same rules as its cld, bannerW and poster width), so the app finds them already loading.
// The home seed is in index.html, which also stands in for /browse and other app pages: only "/" preloads its banner;
// the others preload the core catalogue instead (the home page fetches it once its hero is in; see app/main.js).
const HERO_JS = "(function(){try{var e=document.getElementById('rs-seed');if(!e)return;var k=e.getAttribute('data-kind');" +
  "if(k==='home'&&location.pathname!=='/'){if(window.RS_CAT_CORE){var f=document.createElement('link');f.rel='preload';f.as='fetch';f.crossOrigin='anonymous';f.href=window.RS_CAT_CORE;document.head.appendChild(f);}return;}" +
  "var D=Math.min(window.devicePixelRatio||1,2),V=Math.max(320,Math.min(window.innerWidth||1280,2560));" +
  "var c=function(u,w){var m=u.match(/^(https:\\/\\/res\\.cloudinary\\.com\\/[^/]+\\/image\\/upload\\/)(.*)$/);if(!m||/^[a-z]{1,3}_[^/]*\\//.test(m[2]))return u;return m[1]+'f_auto,q_auto,c_limit,w_'+w+'/'+m[2];};" +
  "var p=function(u,hi){if(!/^https:\\/\\//.test(u||''))return;var l=document.createElement('link');l.rel='preload';l.as='image';l.href=u;if(hi)l.setAttribute('fetchpriority','high');document.head.appendChild(l);};" +
  "var b=e.getAttribute('data-banner'),q=e.getAttribute('data-poster');" +
  "var bg=function(sel,u){var el=document.querySelector(sel);if(el&&/^https:\\/\\//.test(u||''))el.style.backgroundImage='url(\"'+u.replace(/\"/g,'%22')+'\")';};" +
  "if(b){var bu=c(b,Math.min(1920,Math.ceil(V*D/320)*320));p(bu,true);bg(k==='home'?'.fh.rs-static':'.tp.rs-static',bu);}" +
  "if(q&&k==='title'){var qu=c(q,480);p(qu,!b);bg('.tp.rs-static .poster',qu);}}catch(x){}})();";
const MINIFY = ['app/main.js', 'app/admin.js', 'app/about.js', 'js/claude-shim.js', 'js/firebase-adapter.js', 'firebase-config.js', 'app/app.css', 'app/admin.css'];
async function minifyAssets() {
  let esbuild; try { esbuild = await import('esbuild'); } catch (e) { console.warn('[seo] esbuild not installed: scripts and styles left unminified'); return; }
  let before = 0, after = 0;
  for (const rel of MINIFY) {
    const f = path.join(OUT, rel); if (!fs.existsSync(f)) continue;
    const src = fs.readFileSync(f, 'utf8'), css = rel.endsWith('.css');
    try {
      const r = await esbuild.transform(src, { loader: css ? 'css' : 'js', minify: true, legalComments: 'none', charset: 'utf8',
        target: css ? ['chrome100', 'safari15', 'firefox100'] : 'es2020' });
      fs.writeFileSync(f, r.code); before += src.length; after += r.code.length;
    } catch (e) { console.warn('[seo] could not minify ' + rel + ' (left as is): ' + e.message); }
  }
  console.log(`[seo] minified scripts and styles: ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB`);
}
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
// Ads rule: ads may only ever run on pages with real substance. Pages kept out of Google (thin or borderline titles,
// person pages without enough content, empty video hubs), every video page and hub, and the site's own pages
// (about, privacy, contact) carry <meta name="rs-ads" content="off">; app/main.js applies the same rule after in-app
// navigation. There is no ad code yet: whatever ad script is added later must check this first (see seo/README.md).
const ADS_OFF_ROUTES = new Set(['video', 'vids', 'about', 'privacy', 'contact', 'list', 'tonight', 'admin', 'notfound']);
function page(shell, { title, description, canonical, ogPath, ogType, image, wide, jsonld, route, body, robots, seed, hero, heroHtml }) {
  const adsOff = ADS_OFF_ROUTES.has(route) || /noindex/.test(robots || '');
  // Pages without a poster or photo share the site-wide card (1200x630).
  const fallback = !image; if (fallback) { image = SITE + OG_DEFAULT; wide = true; }
  const head = [
    '<title>' + esc(title) + '</title>',
    '<meta name="description" content="' + esc(description) + '">',
    robots ? '<meta name="robots" content="' + robots + '">' : '',
    adsOff ? '<meta name="rs-ads" content="off">' : '',
    canonical ? '<link rel="canonical" href="' + esc(SITE + canonical) + '">' : '',
    '<meta property="og:site_name" content="Reelscore">',
    '<meta property="og:type" content="' + ogType + '">',
    '<meta property="og:title" content="' + esc(title) + '">',
    '<meta property="og:description" content="' + esc(description) + '">',
    '<meta property="og:url" content="' + esc(SITE + (canonical || ogPath || '/')) + '">',
    '<meta property="og:image" content="' + esc(image) + '">',
    fallback ? '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="Reelscore: verdicts on Indian movies and series">' : '',
    '<meta name="twitter:card" content="' + (wide ? 'summary_large_image' : 'summary') + '">',
    '<meta name="twitter:title" content="' + esc(title) + '">',
    '<meta name="twitter:description" content="' + esc(description) + '">',
    '<meta name="twitter:image" content="' + esc(image) + '">',
    ...(jsonld || []).map(ld)
  ].filter(Boolean).join('\n');
  let html = shell.replace(/<!--seo-->[\s\S]*?<!--\/seo-->/, '<!--seo-->\n' + head + '\n<!--/seo-->');
  html = html.replace('<body class="r-home">', '<body class="r-' + route + '">');
  const slot = '<div class="view" id="view-' + route + '"></div>';
  if (!html.includes(slot)) throw new Error('index.html is missing ' + slot);
  // A seed is data for the app, not markup: a JSON block the browser never runs ("<" escaped so it can't close the tag).
  // data-banner / data-poster name the page's first big pictures, which the small catalogue script preloads (see HERO_JS).
  const heroAttrs = hero ? (hero.banner ? ' data-banner="' + esc(hero.banner) + '"' : '') + (hero.poster ? ' data-poster="' + esc(hero.poster) + '"' : '') : '';
  const seedTag = seed ? '<script type="application/json" id="rs-seed" data-kind="' + route + '"' + heroAttrs + '>' + JSON.stringify(seed).replace(/</g, '\\u003c') + '</script>' : '';
  // heroHtml: the page's first screen as the app draws it (see homeHeroMarkup / titleHeroMarkup), shown before any script
  // runs. With it on top, the search-engine block's poster is below the first screen, so it loads lazily.
  if (heroHtml) body = body.replace(' fetchpriority="high"', ' loading="lazy" fetchpriority="low"');
  return html.replace(slot, '<div class="view" id="view-' + route + '">' + (heroHtml || '') + '<div class="pr" data-prerendered>' + body + '</div></div>' + seedTag);
}

// ---------- News stories (Firestore "news", status "published"; written in Admin > News) ----------
// Read in full at every build (a small collection). If the database can't be reached, the live site's news-data.json
// (written below) stands in, so published stories never drop off the site.
async function loadNewsPosts() {
  if (process.env.NEWS_FIXTURE) return JSON.parse(fs.readFileSync(process.env.NEWS_FIXTURE, 'utf8'));
  if (process.env.FIXTURE) return [];
  try {
    const rows = await firestoreClient().where('news', 'status', 'published');
    return rows.map(x => ({ ...x.data, id: x.id })).filter(p => p.slug && p.title && /^[a-z0-9-]+$/.test(p.slug));
  } catch (e) {
    console.warn('[seo] news unavailable (' + e.message + '); reusing the live news-data.json');
    const get = async f => { try { const r = await fetch(SITE + f); return r.ok ? await r.json() : []; } catch (e2) { return []; } };
    return (await get('/news-data.json')).concat(await get('/lists-data.json'));
  }
}
// Story text to HTML. Same rules as app/main.js newsBody: blank line = new paragraph; "## " / "### " headings; "- " list;
// "> " quote; **bold**; [words](https://… or /…) links.
function newsInlineHtml(s) {
  let out = '', last = 0, m; const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(((?:https:\/\/|\/)[^\s)]+)\)/g;
  while ((m = re.exec(s))) {
    out += esc(s.slice(last, m.index));
    out += m[1] ? '<strong>' + esc(m[1]) + '</strong>' : '<a href="' + esc(m[3]) + '"' + (/^https:/.test(m[3]) ? ' rel="noopener"' : '') + '>' + esc(m[2]) + '</a>';
    last = re.lastIndex;
  }
  return out + esc(s.slice(last));
}
function newsHtml(text) {
  return String(text || '').replace(/\r/g, '').split(/\n\s*\n/).map(b => b.trim()).filter(Boolean).map(b => {
    const lines = b.split('\n'), hm = lines.length === 1 && b.match(/^(#{2,3})\s+(.+)$/);
    if (hm) { const t = hm[1].length === 2 ? 'h2' : 'h3'; return '<' + t + '>' + newsInlineHtml(hm[2]) + '</' + t + '>'; }
    if (lines.every(l => /^\s*[-*]\s+/.test(l))) return '<ul>' + lines.map(l => '<li>' + newsInlineHtml(l.replace(/^\s*[-*]\s+/, '')) + '</li>').join('') + '</ul>';
    if (lines.every(l => /^>/.test(l))) return '<blockquote>' + newsInlineHtml(lines.map(l => l.replace(/^>\s?/, '')).join(' ')) + '</blockquote>';
    return '<p>' + lines.map(newsInlineHtml).join('<br>') + '</p>';
  }).join('');
}

// ---------- main ----------
async function main() {
  const t0 = Date.now();
  const data = await loadData();
  PREV_DATES = await previousPageDates();
  // Lists (Admin > Lists) share the "news" collection with kind "list"; they get their own pages below.
  const allPosts = await loadNewsPosts();
  const newsPosts = allPosts.filter(p => p.kind !== 'list'), listPosts = allPosts.filter(p => p.kind === 'list');
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

  // Real YouTube publish dates (YouTube Data API, videos.list) from content/video-dates.txt, one "<id> <YYYY-MM-DD>" per line.
  // A date stored on the video in the database wins. Videos whose owners turned embedding off are dropped,
  // because they can't play on the site.
  try {
    const dates = new Map(fs.readFileSync(path.join(ROOT, 'content', 'video-dates.txt'), 'utf8').split('\n').map(l => l.trim().split(/\s+/)).filter(p => /^[\w-]{11}$/.test(p[0]) && /^\d{4}-\d{2}-\d{2}$/.test(p[1] || '')));
    const NO_EMBED = new Set(['jr8zEw9Uinw', 'cs4rnylG7Fc', 'tpTBrLtVPHs', 'q9lDVACRgjc']);
    let n = 0, dropped = 0;
    for (const m of data.movies) {
      if (!Array.isArray(m.data.videos) || !m.data.videos.length) continue;
      const vs = m.data.videos.filter(x => { const id = ytId(safeUrl(x.url)); if (NO_EMBED.has(id)) { dropped++; return false; } return true; })
        .map(x => { const id = ytId(safeUrl(x.url)); if (!x.publishedAt && dates.has(id)) { n++; return { ...x, publishedAt: dates.get(id) }; } return x; });
      m.data = { ...m.data, videos: vs };
    }
    console.log(`[seo] video publish dates applied: ${n}; non-embeddable videos dropped: ${dropped}`);
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
  // Unpublished titles (published === false, set in the admin panel) get no page and stay out of the catalogue.
  const nUnpub = data.movies.filter(m => m.data && m.data.published === false).length;
  // Now playing decides a film's section (see npSection).
  const movies = data.movies.filter(m => m.data && m.data.title && m.data.published !== false)
    .map(m => m.data.nowPlaying && m.data.section !== 'TV shows' && npSection(m.data, TODAY) !== m.data.section ? { ...m, data: { ...m.data, section: npSection(m.data, TODAY) } } : m);
  if (nUnpub) console.log('[seo] unpublished titles left out: ' + nUnpub);

  // credits per person (cast entries, plus the director field when that person isn't already in the cast)
  const credits = {};
  const addCredit = (slug, c) => { if (slug) (credits[slug] = credits[slug] || []).push(c); };
  movies.forEach(m => {
    const cast = m.data.cast || [];
    cast.forEach(c => addCredit(personSlug(c.name), { m, name: c.name, role: CREW_RE.test(c.role || '') ? c.role : charOf(c), crew: CREW_RE.test(c.role || ''), year: c.year || '' }));
    String(m.data.director || '').split(/,| and /).map(s => s.trim()).filter(Boolean).forEach(d => {
      const k = personSlug(d); if (!cast.some(c => personSlug(c.name) === k)) addCredit(k, { m, name: d, role: 'Director', crew: true });
    });
  });
  const titleCount = slug => new Set((credits[slug] || []).map(c => c.m.id)).size;
  // Only titles with real content (a story, poster or video) count towards a person's indexed page, so a filmography made
  // purely of data-only imports doesn't create thin person pages.
  const richTitle = d => !!(d.synopsis || safeUrl(d.posterUrl) || ytVideos(d).length);
  // A title page with no story, poster, video or verdict is kept out of the index; indexable pages don't link to it either
  // (its name is shown as plain text), so crawlers aren't sent to pages we've asked them not to index.
  // SEO tiers (kept in step with app/admin.js seoTier): only "good" title pages are indexed.
  //   kept   – no story, poster, video or verdict
  //   thin   – a one-line story (under 80 characters) and nothing else
  //   border – a short story (under 200 characters) and nothing else
  //   good   – a poster, a video, where to watch (platform or booking link), a story of 200+ characters, or 3+ verdicts
  const hasWhere = d => !!(String(d.platform || '').trim() || (d.watch || []).some(w => w && String(w.platform || '').trim()) || safeUrl(d.platformUrl) || safeUrl(d.bookingUrl) || Object.values(d.bookingUrls || {}).some(u => safeUrl(u)) || (d.moreBooking || []).some(p => p && Object.values(p.urls || {}).some(u => safeUrl(u))));
  const seoTier = (d, tot) => {
    const syn = String(d.synopsis || '').trim().length;
    if (!syn && !safeUrl(d.posterUrl) && !ytVideos(d).length && !tot) return 'kept';
    if (safeUrl(d.posterUrl) || ytVideos(d).length || hasWhere(d) || syn >= 200 || tot >= 3) return 'good';
    return syn < 80 ? 'thin' : 'border';
  };
  const thinT = d => seoTier(d, score(d.__id || '').tot) !== 'good';
  const tLink = m => thinT(Object.assign({ __id: m.id }, m.data)) ? esc(m.data.title) : '<a href="' + movieUrl(m) + '">' + esc(m.data.title) + '</a>';
  const richCount = slug => new Set((credits[slug] || []).filter(c => richTitle(c.m.data)).map(c => c.m.id)).size;
  const indexedPerson = slug => {
    const st = people[slug] || {};
    const r = richCount(slug);
    return !!st.bio || (!!safeUrl(st.photoUrl) && r >= PERSON_PHOTO) || r >= PERSON_TITLES;
  };
  const personWhy = slug => { const st = people[slug] || {}, r = richCount(slug), ph = !!safeUrl(st.photoUrl);
    if (st.bio) return 'Has a bio'; if (ph && r >= PERSON_PHOTO) return 'Photo and ' + r + ' titles with content'; if (r >= PERSON_TITLES) return r + ' titles with content';
    return r + ' title' + (r === 1 ? '' : 's') + ' with content, ' + (ph ? 'has a photo' : 'no photo') + ', no bio; needs a bio, or a photo + ' + PERSON_PHOTO + ' titles, or ' + PERSON_TITLES + ' titles'; };
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
      if (o.id === m.id || thinT(Object.assign({ __id: o.id }, o.data))) continue;
      const g = facts.get(o.id); let sc = 0;
      g.g.forEach(w => { if (f.g.has(w)) sc += 3; });
      g.ppl.forEach(p => { if (f.ppl.has(p)) sc += 4; });
      if (g.tv === f.tv) sc += 2;
      if (f.y && g.y) sc -= Math.min(6, Math.abs(f.y - g.y) / 3);
      out.push([sc, o]);
    }
    return out.sort((a, b) => b[0] - a[0] || String(a[1].data.title).localeCompare(String(b[1].data.title))).slice(0, 12).map(x => x[1]);
  }
  // Languages with a /<language>-movies page (5+ films whose first language it is); others link to the Browse filter.
  // (and at least 3 of them with substance, so the page is in Google)
  const filmLang = {}, filmLangGood = {};
  movies.forEach(m => { if (isTv(m.data)) return; const l = String(m.data.languages || '').split(/[,;]/)[0].trim(); if (!/^[A-Za-z]+$/.test(l)) return; filmLang[l] = (filmLang[l] || 0) + 1; if (!thinT(Object.assign({ __id: m.id }, m.data))) filmLangGood[l] = (filmLangGood[l] || 0) + 1; });
  const langHref = l => filmLang[l] >= 5 && filmLangGood[l] >= 3 ? '/' + l.toLowerCase() + '-movies' : '/browse?lang=' + encodeURIComponent(l);
  const langLinks = v => String(v || '').split(/\s*[,;]\s*/).filter(Boolean).map(l => '<a href="' + langHref(l) + '">' + esc(l) + '</a>').join(', ');

  // Page titles, kept in step with app/main.js (movieTitleTag, personTitleTag) so they don't change once the app
  // loads: language added when a name and year repeat, the "Verdicts & Reviews" part dropped past 60 characters.
  const titleKey = m => String(m.data.title || '').trim().toLowerCase() + '|' + (isTv(m.data) ? 'tv ' + tvYears(m.data) : year(m.data));
  const dupTitle = {}; movies.forEach(m => { const k = titleKey(m); dupTitle[k] = (dupTitle[k] || 0) + 1; });
  function movieTitleTag(m) {
    const d = m.data, parts = [isTv(d) ? (tvYears(d) ? 'TV series ' + tvYears(d) : 'TV series') : year(d)];
    const lang = String(d.languages || '').split(/[,;]/)[0].trim();
    if (dupTitle[titleKey(m)] > 1 && lang) parts.push(lang);
    const p = parts.filter(Boolean), base = d.title + (p.length ? ' (' + p.join(', ') + ')' : '');
    const tot = score(m.id).tot;
    // TV shows: when "(TV series 2020–present)" pushes the title past 60 characters, use the first year only.
    const short = isTv(d) && tvYears(d) ? d.title + ' (' + ['TV series ' + String(tvYears(d)).slice(0, 4)].concat(p.slice(1)).join(', ') + ')' : null;
    const tail = b => titleTail(b, { tv: isTv(d), upcoming: d.releaseDate ? d.releaseDate > TODAY : d.section === 'Coming soon', theatres: d.section === 'In theatres',
      platform: !!String(d.platform || '').trim(), verdicts: tot, popular: d.popular === true || tot >= 20,
      songs: ytVideos(d).some(v => v.cat === 'songs' && v.yt), boxOffice: !isTv(d) && !!boFullOf(d), ottDate: !!d.ottReleaseDate && d.ottReleaseDate >= TODAY,
      tickets: !(data.buttons && data.buttons.title && data.buttons.title.book === false) && ticketsOf(d).length > 0 });
    const full = tail(base);
    if (full.length <= 60 || !short) return full;
    const alt = tail(short);
    return alt.length <= 60 || alt.length < full.length ? alt : full;
  }
  function personTitleTag(name) {
    const a = name + ' – Movies, TV Shows & Filmography | Reelscore', b = name + ' – Filmography | Reelscore';
    return a.length <= 60 ? a : b.length <= 60 ? b : name + ' | Reelscore';
  }

  const sitemap = [{ loc: '/', pri: '1.0' }, { loc: '/browse', pri: '0.6' }, { loc: '/people', pri: '0.6' }];
  // Why each page is open to Google or kept out, for the page report (seo-pages.csv, written at the end).
  const pageWhy = new Map();
  const seen = new Set(), aliasSeen = new Set(), aliases = []; let nTitles = 0, nRated = 0, nPeople = 0, nThinTitles = 0, nVideoPages = 0; const tierCount = {};

  // The app's catalogue: every title and person, empty top-level fields dropped to keep it small.
  const compact = d => { const o = {}; for (const k of Object.keys(d || {})) { const v = d[k]; if (v !== '' && v !== null && v !== undefined) o[k] = v; } return o; };
  // Fields the public app never reads are left out (admin reads the database directly): import notes, image ids,
  // empty lists and the default "Cast" role.
  const slim = d => { const o = compact(d); delete o.source; delete o.imdb; delete o.tvmazeId; delete o.importedAt; delete o.posterSource; delete o.bannerSource; delete o.posterId; delete o.bannerId;
    if (Array.isArray(o.slugHistory) && !o.slugHistory.length) delete o.slugHistory; if (Array.isArray(o.videos) && !o.videos.length) delete o.videos;
    if (Array.isArray(o.cast)) o.cast = o.cast.map(c => { if (!c || c.role !== 'Cast') return c; const x = { ...c }; delete x.role; return x; });
    return o; };
  // Each title page carries a small seed (the title, the titles in its "More" rows, its people and their verdicts on them),
  // so the app draws the page at once; the catalogue and Firebase load once the page has settled (app/main.js).
  const verdictsFor = ids => { const out = {}; data.verdicts.forEach(u => { const v = (u.data && u.data.v) || {}, w = {}; let n = 0;
    ids.forEach(id => { if (/^[abc]$/.test(v[id] || '')) { w[id] = v[id]; n++; } }); if (n) out[u.id] = { v: w }; }); return out; };
  const seedFor = (m, related) => {
    const list = [m].concat(related.filter((o, i, a) => o.id !== m.id && a.indexOf(o) === i)), ppl = {};
    (m.data.cast || []).forEach(c => { const k = c && personSlug(c.name); if (k && people[k] && !(k in ppl)) ppl[k] = compact(people[k]); });
    String(m.data.director || '').split(/,| and /).forEach(n => { const k = personSlug(n.trim()); if (k && people[k] && !(k in ppl)) ppl[k] = compact(people[k]); });
    return { builtAt: data.builtAt, movies: list.map(o => ({ id: o.id, data: slim(o.data) })), people: ppl, verdicts: verdictsFor(list.map(o => o.id)) };
  };

  // ----- title pages -----
  for (const m of movies) {
    const d = m.data, url = movieUrl(m), tv = isTv(d);
    if (!/^\/(movie|tv)\/[a-z0-9-]+$/.test(url)) continue;
    if (seen.has(url)) { console.warn('[seo] duplicate URL, skipped:', url, m.id); continue; }
    seen.add(url);
    const y = year(d), sc = score(m.id), vs = (d.section === 'In theatres' || d.section === 'Coming soon') ? VERD.theatre : VERD.ott;
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
    // Lead with the verdict and where to watch, then the story.
    const upc = d.releaseDate ? d.releaseDate > TODAY : d.section === 'Coming soon';
    const where = upc ? 'Releases ' + (d.releaseDate ? fmtDate(d.releaseDate) : 'soon') + (d.platform && (isOtt(d) || tv) ? ' on ' + d.platform : '') + '. '
      : d.section === 'In theatres' ? 'In theatres now. ' : d.platform ? (tv ? 'Watch on ' : 'Streaming on ') + d.platform + '. ' : '';
    const verdict = sc.tot >= 3 ? 'Verdict: ' + sc.pct + '% positive from ' + sc.tot + ' viewers. ' : '';
    const description = clip(verdict + where + (d.synopsis ? d.synopsis + ' ' + (d.synopsis.length < 80 ? auto : '') : auto), 158);

    const metaLine = [tv ? tvYears(d) : (d.releaseDate ? fmtDate(d.releaseDate) : ''), d.languages ? '\u0000' : '', d.genre, d.runtime, d.certificate, d.platform ? 'on ' + d.platform : ''].filter(Boolean)
      .map(x => x === '\u0000' ? langLinks(d.languages) : esc(x)).join(' · ');
    const section = tv ? ['TV shows', '/browse/tv-shows'] : ['Movies', '/browse'];
    let body = '<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › <a href="' + section[1] + '">' + section[0] + '</a> › ' + esc(d.title) + '</nav>';
    body += '<div class="pr-top">' + (poster ? '<img class="pr-poster" src="' + esc(poster) + '" alt="' + esc(d.title) + ' poster" width="200" height="300" fetchpriority="high">' : '') + '<div>';
    body += '<h1>' + esc(d.title) + '</h1>' + (d.subtitle ? '<div class="pr-sub">' + esc(d.subtitle) + '</div>' : '');
    body += metaLine ? '<div class="pr-meta">' + metaLine + '</div>' : '';
    if (sc.tot >= 3) body += '<div class="pr-score"><b>' + sc.pct + '%</b> positive · ' + sc.tot + ' verdict' + (sc.tot === 1 ? '' : 's') + '<div class="note">' + vs.map(x => esc(x[1]) + ' ' + Math.round(100 * sc.n[x[0]] / sc.tot) + '%').join(' · ') + '</div></div>';
    // OTT release date and ticket links, in the page's HTML so search engines see what the title promises.
    if (!tv && d.ottReleaseDate && d.ottReleaseDate >= TODAY) body += '<div class="pr-meta">OTT release: ' + esc(fmtDate(d.ottReleaseDate)) + (String(d.platform || '').trim() ? ' on ' + esc(d.platform) : '') + '</div>';
    const tix = !tv && d.section === 'In theatres' && !(data.buttons && data.buttons.title && data.buttons.title.book === false) ? ticketsOf(d) : [];
    if (tix.length) body += '<div class="pr-meta">Tickets: ' + tix.map(x => '<a href="' + esc(x.url) + '" rel="nofollow noopener" target="_blank">' + esc(x.platform || 'Book tickets') + '</a>').join(', ') + '</div>';
    if (directors.length) body += '<div class="pr-meta">Directed by ' + directors.map(personLink).join(', ') + '</div>';
    body += '</div></div>';
    if (d.synopsis) body += '<h2>Story</h2><p>' + esc(d.synopsis) + '</p>';
    const bo = tv ? null : boFullOf(d);
    if (bo) {
      const cr = x => '₹' + (Math.round(x * 100) / 100).toLocaleString('en-IN') + ' crore';
      const fig = [['India nett', bo.nett], ['India gross', bo.gross], ['Worldwide gross', bo.world], ['Latest day, India nett', bo.day]].filter(x => x[1]).map(x => x[0] + ': ' + cr(x[1]));
      const src = bo.source ? ' Source: ' + (bo.url ? '<a href="' + esc(bo.url) + '" rel="nofollow noopener" target="_blank">' + esc(bo.source) + '</a>' : esc(bo.source)) + '.' : '';
      body += '<h2>Box office</h2><p>' + esc(fig.join(' · ')) + (bo.updated ? ' (as of ' + esc(fmtDate(bo.updated)) + ')' : '') + '.' + src + '</p>';
    }
    body += '<h2>About ' + esc(d.title) + '</h2><p>' + esc(ABOUT.title({ title: d.title, tv, date: d.releaseDate || '', year: y,
      upcoming: d.releaseDate ? d.releaseDate > TODAY : d.section === 'Coming soon', released: !!d.releaseDate && d.releaseDate <= TODAY,
      languages: d.languages, genre: d.genre, runtime: d.runtime, certificate: d.certificate, seasons: d.seasons, episodes: d.episodes, endYear: d.endYear,
      platform: d.platform, director: d.director, cast, verdicts: { pct: sc.pct, tot: sc.tot } })) + '</p>';
    if (actors.length) body += '<h2>Cast</h2><ul>' + actors.map(c => '<li>' + personLink(c.name) + (charOf(c) || hostOf(c) ? ' <span class="note">' + (charOf(c) ? 'as ' + esc(charOf(c)) : esc(hostOf(c))) + (c.episodes ? ' · ' + esc(c.episodes) + ' ep.' : '') + '</span>' : '') + '</li>').join('') + '</ul>';
    if (crew.length) body += '<h2>Crew</h2><ul>' + crew.map(c => '<li>' + personLink(c.name) + ' <span class="note">' + esc(c.role) + '</span></li>').join('') + '</ul>';
    const vids = ytVideos(d), vpaths = videoPaths(d);
    // No YouTube player here: it cost a megabyte on every visit. The list links to each video's own page, which plays it.
    if (vids.length) body += '<h2>Trailers &amp; songs</h2><ul class="pr-vids">' + vpaths.map(x => '<li><a href="' + url + x.path + '"><img src="' + ytThumb(x.yt) + '" alt="' + esc(d.title + ' · ' + x.title) + '" width="160" height="90" loading="lazy"> ' + esc(x.title) + '</a> <span class="note">' + esc(x.kind) + '</span></li>').join('') + '</ul>';
    if (d.srcTvmaze) body += '<p class="note">Show details and image from <a href="' + esc(safeUrl(d.srcTvmaze) || 'https://www.tvmaze.com/') + '" rel="noopener">TVmaze</a> (<a href="https://creativecommons.org/licenses/by-sa/4.0/" rel="noopener license">CC BY-SA 4.0</a>).</p>';
    else if (d.wikidata) body += '<p class="note">Film facts from <a href="https://www.wikidata.org/wiki/' + esc(d.wikidata) + '" rel="noopener">Wikidata</a> (CC0).</p>';
    // Same rule as the app's "More from Cast & Crew" row: titles sharing people with this one, top-billed cast weighing more.
    const ppl = {}; cast.forEach((c, i) => { const k = personSlug(c.name); if (k && !(k in ppl)) ppl[k] = i < 4 ? 3 : CREW_RE.test(c.role || '') ? 2 : 1; });
    const shared = new Map();
    for (const k of Object.keys(ppl)) for (const c of credits[k] || []) {
      const x = c.m; if (x.id === m.id || !(x.data.cast || []).some(cc => cc && personSlug(cc.name) === k)) continue;
      const e = shared.get(x.id) || { m: x, w: 0, seen: new Set() }; if (!e.seen.has(k)) { e.seen.add(k); e.w += ppl[k]; } shared.set(x.id, e);
    }
    const byCrew = [...shared.values()].sort((a, b) => b.w - a.w || (b.m.data.releaseDate || '').localeCompare(a.m.data.releaseDate || '')).slice(0, 12).map(e => e.m);
    if (byCrew.length) body += '<h2>More from the cast &amp; crew</h2><ul>' + byCrew.map(o => '<li>' + tLink(o) + ' <span class="note">' + esc([isTv(o.data) ? 'TV' : '', year(o.data)].filter(Boolean).join(' · ')) + '</span></li>').join('') + '</ul>';
    const more = similar(m).filter(o => !shared.has(o.id));
    if (more.length) body += '<div class="pr-more"><h2>More like this</h2><ul>' + more.map(o => '<li>' + tLink(o) + ' <span class="note">' + esc([isTv(o.data) ? 'TV' : '', year(o.data)].filter(Boolean).join(' · ')) + '</span></li>').join('') + '</ul></div>';

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
    if (tv) { if (y) node.startDate = d.releaseDate; if (/^\d{4}$/.test(String(d.endYear || ''))) node.endDate = String(d.endYear); if (+d.seasons > 0) node.numberOfSeasons = +d.seasons; if (+d.episodes > 0) node.numberOfEpisodes = +d.episodes; }
    else if (d.releaseDate) node.datePublished = d.releaseDate;
    // Only put the score in search markup once enough people have voted (see SEO_MIN_VERDICTS).
    if (sc.tot >= MIN_VERDICTS) { node.aggregateRating = { '@type': 'AggregateRating', ratingValue: sc.pct, bestRating: 100, worstRating: 0, ratingCount: sc.tot }; nRated++; }
    const crumbs = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE + '/' },
      { '@type': 'ListItem', position: 2, name: section[0], item: SITE + section[1] },
      { '@type': 'ListItem', position: 3, name: d.title, item: SITE + url }] };

    // Only pages with real substance are indexed (see seoTier); the rest come back once they have more.
    const tier = seoTier(d, sc.tot), thinTitle = tier !== 'good'; tierCount[tier] = (tierCount[tier] || 0) + 1;
    pageWhy.set(url, thinTitle ? ({ kept: 'No story, poster, video or verdict yet', thin: 'Story under 80 characters and nothing else', border: 'Story under 200 characters and nothing else' })[tier] + '; add a poster, a YouTube video, where to watch or a 200+ character story'
      : 'Good substance: ' + (safeUrl(d.posterUrl) ? 'poster' : ytVideos(d).length ? 'YouTube video' : hasWhere(d) ? 'where to watch' : String(d.synopsis || '').trim().length >= 200 ? 'story of 200+ characters' : '3+ verdicts'));
    write(url.slice(1) + '.html', page(shell, { title, description, canonical: url, ogType: tv ? 'video.tv_show' : 'video.movie', image: banner || poster, wide: !!banner, jsonld: [node, crumbs], route: 'title', body, seed: seedFor(m, byCrew.concat(more)), hero: { banner: safeUrl(d.bannerUrl), poster: safeUrl(d.posterUrl) },
      heroHtml: titleHeroMarkup(m, url, tv ? tvYears(d) : String(d.releaseDate || '').slice(0, 4), (vpaths.find(x => /trailer|teaser|promo|glimpse/i.test(x.kind || '')) || vpaths[0] || {}).path || ''), robots: thinTitle ? 'noindex,follow' : undefined }));
    // The bare id (or an old slug) still opens the title, as a pointer to the canonical page that isn't indexed.
    for (const alias of new Set([m.id, slugify(m.data.title) || ''])) {
      const au = (tv ? '/tv/' : '/movie/') + alias;
      if (!alias || au === url || !/^[a-z0-9-]+$/.test(alias) || seen.has(au) || aliasSeen.has(au)) continue;
      aliasSeen.add(au); aliases.push([au, url]);
    }
    if (!thinTitle) sitemap.push({ loc: url, lastmod: pageDate(url, title + '\n' + description + '\n' + body), pri: '0.8' });
    else nThinTitles++;
    nTitles++;

    // ----- one page per video, for sharing and video search: /movie/<slug>/trailer, /song/<name>… -----
    // The VideoObject's uploadDate must be YouTube's own publish date (stored as publishedAt); without one, no VideoObject.
    for (const v of vpaths) {
      const vurl = url + v.path, song = v.seg === 'song', kindName = song ? 'Song' : v.kind;
      pageWhy.set(vurl, thinTitle ? 'Its title page is kept out of Google' : 'Its title page is in Google');
      const vname = song ? v.title : d.title + ' – ' + v.title, vtitle = videoTitleTag(d, v, tv);
      const vdesc = clip((song ? v.title + ', a song from ' : (v.title.toLowerCase().indexOf(v.kind.toLowerCase()) !== -1 ? v.title : v.title + ', ' + v.kind.toLowerCase()) + ' of ') + d.title + (y && !tv ? ' (' + y + ')' : '') + (lang ? ', ' + (/^[aeiou]/i.test(lang) ? 'an ' : 'a ') + lang + (tv ? ' series' : ' film') : '') + '. Watch it on Reelscore' + (sc.tot >= 3 ? ', where ' + sc.pct + '% of ' + sc.tot + ' viewers rate it positively' : '') + '.' + (d.synopsis ? ' ' + d.synopsis : ''), 158);
      const others = vpaths.filter(o => o !== v);
      let vb = '<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › <a href="' + section[1] + '">' + section[0] + '</a> › <a href="' + url + '">' + esc(d.title) + '</a> › ' + esc(kindName) + '</nav>';
      vb += '<iframe class="pr-embed" src="https://www.youtube-nocookie.com/embed/' + v.yt + '?rel=0" title="' + esc(vname) + '" width="640" height="360" loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>';
      vb += '<h1>' + esc(vname) + '</h1><p>' + esc(vdesc) + '</p><p><a href="' + url + '">About ' + esc(d.title) + '</a></p>';
      if (others.length) vb += '<h2>More from ' + esc(d.title) + '</h2><ul class="pr-vids">' + others.map(o => '<li><a href="' + url + o.path + '"><img src="' + ytThumb(o.yt) + '" alt="' + esc(d.title + ' · ' + o.title) + '" width="160" height="90" loading="lazy"> ' + esc(o.title) + '</a> <span class="note">' + esc(o.seg === 'song' ? 'Song' : o.kind) + '</span></li>').join('') + '</ul>';
      const vld = [{ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: SITE + '/' },
        { '@type': 'ListItem', position: 2, name: section[0], item: SITE + section[1] },
        { '@type': 'ListItem', position: 3, name: d.title, item: SITE + url },
        { '@type': 'ListItem', position: 4, name: clip(vname, 100), item: SITE + vurl }] }];
      if (v.publishedAt) vld.push({ '@context': 'https://schema.org', '@type': 'VideoObject', name: clip(vname, 100), description: vdesc,
        thumbnailUrl: ytThumb(v.yt), uploadDate: v.publishedAt, embedUrl: 'https://www.youtube.com/embed/' + v.yt, url: SITE + vurl, inLanguage: lang || undefined });
      write(vurl.slice(1) + '.html', page(shell, { title: vtitle, description: vdesc, canonical: vurl, ogType: 'video.other', image: 'https://i.ytimg.com/vi/' + v.yt + '/hqdefault.jpg', wide: true, jsonld: vld, route: 'video', body: vb, robots: thinTitle ? 'noindex,follow' : undefined }));
      if (!thinTitle) sitemap.push({ loc: vurl, lastmod: pageDate(vurl, vtitle + '\n' + vdesc + '\n' + vb), pri: '0.5' });
      nVideoPages++;
    }
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

    // Where each title can be watched: in theatres, or the services named in "Now streaming on" (released titles only).
    const upc = t => !isTv(t.m.data) && (t.m.data.releaseDate ? t.m.data.releaseDate > TODAY : t.m.data.section === 'Coming soon');
    const inTh = t => !upc(t) && t.m.data.section === 'In theatres';
    const svcs = t => upc(t) || inTh(t) ? [] : String(t.m.data.platform || '').split('/').map(x => x.trim()).filter(Boolean);
    const comingUp = titles.filter(upc).sort((a, b) => (a.m.data.releaseDate || '9999').localeCompare(b.m.data.releaseDate || '9999'));
    const theatres = titles.filter(inTh), streams = titles.filter(t => svcs(t).length);
    const bySvc = {}; streams.forEach(t => svcs(t).forEach(x => { (bySvc[x] = bySvc[x] || []).push(t); }));
    const svcNames = Object.keys(bySvc).sort((a, b) => bySvc[b].length - bySvc[a].length || a.localeCompare(b));
    const latest = titles.find(t => !upc(t) && t.when);
    const seo = ABOUT.personSeo({ name, gender: st.gender, bio: st.bio, total: titles.length, tvOnly: titles.every(t => isTv(t.m.data)),
      upcoming: comingUp.map(t => ({ title: t.m.data.title, date: t.m.data.releaseDate || '' })),
      latest: latest && { title: latest.m.data.title, year: latest.when.slice(0, 4), theatres: inTh(latest), platform: svcs(latest).join(' / ') },
      streaming: streams.length, services: svcNames, picks: streams.filter(t => t.acting || !acting.length).slice(0, 4).map(t => t.m.data.title), famous });
    const title = seo.title, description = seo.description;
    const li = t => '<li>' + tLink(t.m) + ' <span class="note">' + esc([isTv(t.m.data) ? 'TV' : '', t.when.slice(0, 4), t.roles.join(', '), inTh(t) ? 'In theatres' : svcs(t).length ? 'On ' + svcs(t).join(', ') : ''].filter(Boolean).join(' · ')) + '</span></li>';
    let body = '<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › <a href="/people">People</a> › ' + esc(name) + '</nav>';
    body += '<div class="pr-top">' + (photo ? '<img class="pr-photo" src="' + esc(photo) + '" alt="' + esc(name) + '" width="160" height="160" fetchpriority="high">' : '') + '<div>';
    body += '<h1>' + esc(name) + '</h1><div class="pr-meta">' + esc([known, titles.length + ' title' + (titles.length === 1 ? '' : 's'), span].filter(Boolean).join(' · ')) + '</div>';
    if (/^\d{4}-\d{2}-\d{2}$/.test(st.birthday || '') || st.birthplace) body += '<div class="pr-meta">Born ' + esc([fmtDate(st.birthday), st.birthplace ? 'in ' + st.birthplace : ''].filter(Boolean).join(' ')) + '</div>';
    if ((st.aka || []).filter(Boolean).length) body += '<div class="pr-meta">Also known as ' + esc(st.aka.filter(Boolean).join(', ')) + '</div>';
    body += '</div></div>';
    if (st.bio) body += '<p>' + esc(st.bio) + '</p>';
    // About, Known for and Frequent collaborators: the same text and picks as the app (app/about.js).
    const pfacts = titles.map(t => ({ m: t.m, title: t.m.data.title, year: t.when.slice(0, 4), date: t.m.data.releaseDate || '', languages: t.m.data.languages, genre: t.m.data.genre,
      tv: isTv(t.m.data), acting: t.acting, crew: t.crew, roles: t.roles, synopsis: t.m.data.synopsis || '',
      upcoming: !isTv(t.m.data) && (t.m.data.releaseDate ? t.m.data.releaseDate > TODAY : t.m.data.section === 'Coming soon') }));
    const collab = ABOUT.collaborators(slug, titles.map(t => t.m.data), personSlug);
    body += '<h2>About ' + esc(name) + '</h2><p>' + esc(ABOUT.person({ name, titles: pfacts, collab })) + '</p>';
    const kf = ABOUT.knownFor(pfacts);
    if (kf.length) body += '<h2>Known for</h2><ul>' + kf.map(k => '<li>' + tLink(k.t.m) + ' <span class="note">' + esc(k.t.year) + '</span> – ' + esc(k.line) + '</li>').join('') + '</ul>';
    const cw = [...collab.directors.map(x => [x, 'director']), ...collab.costars.slice(0, 6).map(x => [x, 'co-star'])];
    if (cw.length) body += '<h2>Frequent collaborators</h2><ul>' + cw.map(([x, r]) => '<li>' + personLink(x.name) + ' <span class="note">' + r + ' · ' + x.n + ' shared title' + (x.n === 1 ? '' : 's') + '</span></li>').join('') + '</ul>';
    if (comingUp.length) body += '<h2>Coming up</h2><ul>' + comingUp.map(t => '<li>' + tLink(t.m) + ' <span class="note">' + esc(/^\d{4}-\d{2}-\d{2}$/.test(t.m.data.releaseDate || '') ? 'Releasing ' + fmtDate(t.m.data.releaseDate) : 'Release date not announced') + '</span></li>').join('') + '</ul>';
    if (theatres.length || svcNames.length) {
      body += '<h2>Where to watch</h2>';
      if (latest && (inTh(latest) || svcs(latest).length)) body += '<p>Latest: ' + tLink(latest.m) + ' (' + esc(latest.when.slice(0, 4)) + '), ' + esc(inTh(latest) ? 'in theatres now' : 'on ' + svcs(latest).join(', ')) + '.</p>';
      if (theatres.length) body += '<h3>In theatres</h3><ul>' + theatres.map(t => '<li>' + tLink(t.m) + '</li>').join('') + '</ul>';
      svcNames.forEach(x => { body += '<h3>On ' + esc(x) + ' <span class="note">' + bySvc[x].length + ' title' + (bySvc[x].length === 1 ? '' : 's') + '</span></h3><ul>' + bySvc[x].map(t => '<li>' + tLink(t.m) + ' <span class="note">' + esc(t.when.slice(0, 4)) + '</span></li>').join('') + '</ul>'; });
    }
    if (acting.length || crewT.length) body += '<h2>Filmography</h2>';
    if (acting.length) body += '<h3>Acting</h3><ul>' + acting.map(li).join('') + '</ul>';
    if (crewT.length) body += '<h3>Behind the camera</h3><ul>' + crewT.map(li).join('') + '</ul>';

    const node = { '@context': 'https://schema.org', '@type': 'Person', name, url: SITE + url, image: photo || undefined,
      description: st.bio ? clip(st.bio, 300) : undefined, jobTitle: known,
      alternateName: (st.aka || []).filter(Boolean).length ? st.aka.filter(Boolean) : undefined,
      birthDate: /^\d{4}-\d{2}-\d{2}$/.test(st.birthday || '') ? st.birthday : undefined,
      gender: /^(Male|Female)$/.test(st.gender || '') ? st.gender : undefined };
    write(url.slice(1) + '.html', page(shell, { title, description, canonical: url, ogType: 'profile', image: photo, wide: false, jsonld: [node, { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [['Home', '/'], ['People', '/people'], [name, url]].map(([n, u], i) => ({ '@type': 'ListItem', position: i + 1, name: n, item: SITE + u })) }], route: 'person', body }));
    sitemap.push({ loc: url, lastmod: pageDate(url, title + '\n' + description + '\n' + body), pri: '0.6' });
    nPeople++;
  }

  // compact and slim are defined above the title pages, which use them for each page's seed.
  const cat = { builtAt: data.builtAt, fullAt: data.fullAt, rows: data.rows, buttons: data.buttons, featured: data.featured || [],
    movies: data.movies.filter(m => m.data).map(m => ({ id: m.id, data: slim(m.data) })),
    people: Object.fromEntries(data.people.filter(p => p.data).map(p => [p.id, compact(p.data)])) };
  write('catalogue.json', JSON.stringify(cat));
  // For the admin panel's Missing synopsis filter: titles whose story comes from content/synopses.json.
  write('synopsis-file-ids.json', JSON.stringify(movies.filter(m => m.data._synFile).map(m => m.id)));
  // ...and how long each of those stories is, so the admin panel's "in Google" status matches the build's (seoTier).
  write('synopsis-file-lengths.json', JSON.stringify(Object.fromEntries(movies.filter(m => m.data._synFile).map(m => [m.id, String(m.data.synopsis || '').trim().length]))));
  // People whose bio comes from content/bios.json: the admin panel counts them as having a bio (person pages in Google).
  write('bio-file-ids.json', JSON.stringify(data.people.filter(p => p.data && p.data._bioFile && p.data.bio).map(p => p.id)));
  // The app loads it in two parts: the core (every section but Older releases, plus people) first, Older releases after.
  // catalogue.json stays whole: the next build reads it, and the app falls back to it.
  const isOlder = m => m.data.section === 'Older releases' && String(m.data.releaseDate || '') < '2025';
  // Visitors' parts leave out unpublished titles (catalogue.json keeps them for the next build).
  const pub = m => m.data.published !== false;
  // Visitors' parts carry what lists, rows, search and people pages need. Fields only a title's own page shows (trivia,
  // interviews, filming locations, source notes) are left out and the synopsis is cut to its start; such titles are marked
  // _part, and the app fetches the rest from the title page's own seed when that page opens (app/main.js loadFull).
  // A YouTube thumbnail that is the video's standard HD still is left out too (the app rebuilds it from the video id).
  const DETAIL_ONLY = ['trivia', 'interviews', 'locations', 'srcTvmaze', 'wikidata', 'castFrom', 'synopsisFrom', 'platformUrlFrom', '_synFile'];
  const listData = d => {
    const o = { ...d }; let part = false;
    for (const k of DETAIL_ONLY) if (k in o) { delete o[k]; part = true; }
    if (typeof o.synopsis === 'string' && o.synopsis.length > 320) { const cut = o.synopsis.slice(0, 300); o.synopsis = cut.slice(0, Math.max(cut.lastIndexOf(' '), 200)) + '…'; part = true; }
    if (Array.isArray(o.videos)) o.videos = o.videos.map(v => { if (!v || typeof v !== 'object') return v; const x = { ...v }; delete x.artistsChecked;
      const id = ytId(safeUrl(x.url)); if (id && x.thumbHd && x.thumbUrl === 'https://i.ytimg.com/vi/' + id + '/maxresdefault.jpg') delete x.thumbUrl; return x; });
    if (part) o._part = 1;
    return o;
  };
  const listed = m => ({ id: m.id, data: listData(m.data) });
  write('catalogue-core.json', JSON.stringify({ builtAt: cat.builtAt, fullAt: cat.fullAt, movies: cat.movies.filter(m => pub(m) && !isOlder(m)).map(listed), people: cat.people }));
  write('catalogue-older.json', JSON.stringify({ builtAt: cat.builtAt, movies: cat.movies.filter(m => pub(m) && isOlder(m)).map(listed) }));
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
  bySection['In theatres'] = pinFirst(bySection['In theatres'] || [], data.rows.theatres);
  bySection['Coming soon'] = pinFirst(bySection['Coming soon'] || [], data.rows.coming);
  bySection['On OTT'] = pinFirst(bySection['On OTT'] || [], data.rows.ott);
  const titleLi = m => '<li>' + tLink(m) + ' <span class="note">' +
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
    langList.map(l => '<li><a href="' + langHref(l) + '">' + esc(l) + ' movies</a> <span class="note">' + langs[l] + '</span></li>').join('') + '</ul>';
  homeBody += '<h2>Genres</h2><ul>' + genreLinks() + '</ul>';
  { const ny = new Date().getFullYear(), ys = []; for (let k = ny; k > ny - 10; k--) ys.push(k);
    homeBody += '<h2>Movies by year</h2><ul>' + ys.map(k => '<li><a href="/year/' + k + '">' + k + '</a></li>').join('') + '</ul>'; }
  homeBody += '<p><a href="/about">About Reelscore and how scores work</a> · <a href="/privacy">Privacy</a> · <a href="/contact">Contact</a></p>';
  // The home page's seed: its featured titles (the hero carousel), so the hero draws before the catalogue arrives.
  const byIdPub = new Map(movies.map(m => [m.id, m]));
  const featured = (data.featured || []).map(id => byIdPub.get(id)).filter(Boolean);
  const homeSeed = featured.length ? { builtAt: data.builtAt, movies: featured.map(o => ({ id: o.id, data: slim(o.data) })), people: {}, verdicts: verdictsFor(featured.map(o => o.id)) } : null;
  const homeHtml = page(shell, { title: 'Reelscore — Reviews for Indian movies and series', description: 'Verdicts, reviews and trailers for Bollywood and regional Indian films and series, with scores from people you follow.',
    canonical: '/', ogPath: '/', ogType: 'website', image: null, jsonld: homeLd, route: 'home', body: homeBody,
    seed: homeSeed, hero: homeSeed ? { banner: safeUrl(featured[0].data.bannerUrl) } : null,
    heroHtml: homeSeed ? homeHeroMarkup(featured[0], movieUrl(featured[0]), featured.length) : '' });
  write('index.html', homeHtml);

  // Browse: all sections, then one page per section listing every title in it
  let browseBody = '<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › Browse</nav><h1>Browse Indian movies and series</h1><p>' + movies.length + ' titles in ' + langList.length + '+ languages.</p>';
  HUBS.forEach(h => { browseBody += block(h[1] + ' <span class="note">' + bySection[h[1]].length + '</span>', bySection[h[1]].slice(0, 12).map(titleLi), ['/browse/' + h[0], 'See all ' + bySection[h[1]].length + ' →']); });
  browseBody += '<h2>By genre</h2><ul>' + genreLinks() + '</ul>';
  browseBody += '<h2>By language</h2><ul>' + langList.map(l => '<li><a href="' + langHref(l) + '">' + esc(l) + '</a> <span class="note">' + langs[l] + '</span></li>').join('') + '</ul>';
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

  // Movies (/movies) and TV Shows (/tv-shows): Browse split by kind. Titles match app/main.js MOVIES_TITLE / TV_TITLE.
  // /movies/<section> is app-only (vercel.json rewrite) and points its canonical at /browse/<section>.
  {
    const MOVIE_HUBS = HUBS.filter(h => h[1] !== 'TV shows');
    const films = movies.filter(m => !isTv(m.data)), shows = movies.filter(m => isTv(m.data)).sort(newest);
    let mBody = '<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › Movies</nav><h1>Indian movies</h1><p>' + films.length + ' Bollywood and regional Indian films, with verdicts on whether each is worth the theatre, OTT or a skip.</p>';
    MOVIE_HUBS.forEach(h => { mBody += block(h[1] + ' <span class="note">' + bySection[h[1]].length + '</span>', bySection[h[1]].slice(0, 12).map(titleLi), ['/browse/' + h[0], 'See all ' + bySection[h[1]].length + ' →']); });
    mBody += '<h2>By language</h2><ul>' + langList.map(l => '<li><a href="' + langHref(l) + '">' + esc(l) + ' movies</a></li>').join('') + '</ul>';
    writeHub('movies.html', { title: 'Indian Movies – Reviews, Verdicts & OTT | Reelscore', description: clip('Browse ' + films.length + ' Bollywood and regional Indian movies: in theatres, coming soon, on OTT and older releases, with verdicts on each.', 158),
      canonical: '/movies', ogPath: '/movies', route: 'movies', body: mBody,
      jsonld: [crumbLd(['Home', '/'], ['Movies', '/movies']), listLd('Movie sections', MOVIE_HUBS.map(h => '/browse/' + h[0]))] });
    sitemap.push({ loc: '/movies', pri: '0.7' });
    // Same rows as the app's TV Shows page (app/main.js drawTvRows, OTTS); every show is listed on /browse/tv-shows.
    const OTT_RE = { netflix: /netflix/i, 'prime-video': /prime video|amazon prime/i, jiohotstar: /hotstar|jiocinema|voot|star ?plus|star bharat|star vijay|colors|\bmtv\b|disney|asianet|nickelodeon/i, zee5: /zee|&\s*tv/i, sonyliv: /sony|\bsab\b/i };
    const ottIs = (m, k) => { const p = String(m.data.platform || ''); if (!p) return false; for (const [kk, re] of Object.entries(OTT_RE)) if (re.test(p)) return kk === k; return false; };
    const gIs = (m, g) => { const r = GENRE_RULES.find(x => x[0] === g); return !!r && r[1].test(String(m.data.genre || '').toLowerCase()); };
    const yNow = String(new Date().getFullYear()), fresh = shows.filter(m => String(m.data.releaseDate || '').slice(0, 4) === yNow);
    const tvRows = [fresh.length >= 6 ? ['New this year', fresh, '/browse/tv-shows?year=' + yNow] : ['New shows', shows, '/browse/tv-shows'],
      ['New on Netflix', shows.filter(m => ottIs(m, 'netflix')), '/browse/tv-shows?ott=netflix'], ['New on Prime Video', shows.filter(m => ottIs(m, 'prime-video')), '/browse/tv-shows?ott=prime-video'],
      ['New on JioHotstar', shows.filter(m => ottIs(m, 'jiohotstar')), '/browse/tv-shows?ott=jiohotstar'],
      ...[['Thriller', 'Thriller & crime'], ['Comedy', 'Comedy'], ['Romance', 'Romance'], ['Action', 'Action'], ['Horror', 'Horror']].map(([g, t]) => [t, shows.filter(m => gIs(m, g)), '/browse/tv-shows?genre=' + encodeURIComponent(g)]),
      ['On ZEE5', shows.filter(m => ottIs(m, 'zee5')), '/browse/tv-shows?ott=zee5'], ['On SonyLIV', shows.filter(m => ottIs(m, 'sonyliv')), '/browse/tv-shows?ott=sonyliv'],
      ['Reality & game shows', shows.filter(m => /reality|talk|game|quiz|talent/i.test(String(m.data.genre || ''))), null]];
    let tBody = '<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › TV Shows</nav><h1>Indian TV shows and web series</h1><p>' + shows.length + ' TV shows and web series by streaming service and genre, newest first.</p>';
    tvRows.forEach(([t, list, href]) => { if (list.length >= 4) tBody += block(esc(t), list.slice(0, 20).map(titleLi), href ? [href, 'See all →'] : null); });
    tBody += '<p><a href="/browse/tv-shows">Browse all ' + shows.length + ' TV shows →</a></p>';
    writeHub('tv-shows.html', { title: 'Indian TV Shows & Web Series | Reelscore', description: clip(shows.length + ' Indian TV shows and web series with cast, trailers, where to watch and verdicts on whether each is worth your time.', 158),
      canonical: '/tv-shows', ogPath: '/tv-shows', route: 'tvshows', body: tBody,
      jsonld: [crumbLd(['Home', '/'], ['TV Shows', '/tv-shows']), listLd('Indian TV shows and web series', shows.map(movieUrl))] });
    sitemap.push({ loc: '/tv-shows', pri: '0.7' });
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

  // Language landing pages (same paths as app/main.js parseLanding):
  //   /hindi-movies, /hindi-movies-2026, /hindi-movies-in-theatres, /new-hindi-movies-on-ott, /upcoming-hindi-movies, /hindi-web-series
  // A language gets film pages once it has 5 films, a series page once it has 5 series, and a year page for each year with
  // 5+ films. "In theatres", "on OTT" and "upcoming" pages exist for languages with 50+ titles so their addresses stay put;
  // while one lists fewer than 3 titles it is kept out of Google.
  let nLangNoindex = 0;
  {
    const MONTHS_L = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const now = new Date(), monYr = MONTHS_L[now.getMonth()] + ' ' + now.getFullYear();
    const langOfM = m => String(m.data.languages || '').split(/[,;]/)[0].trim();
    const lslug = l => l.toLowerCase().replace(/[^a-z]+/g, '');
    const byLang = {};
    movies.forEach(m => { const l = langOfM(m); if (!l || !/^[A-Za-z]+$/.test(l)) return; (byLang[l] = byLang[l] || []).push(m); });
    const pagesFor = {}, allPages = [];
    const add = (l, o) => { (pagesFor[l] = pagesFor[l] || []).push(o); allPages.push(o); };
    Object.keys(byLang).sort((a, b) => byLang[b].length - byLang[a].length).forEach(l => {
      const all = byLang[l], films = all.filter(m => !isTv(m.data)), series = all.filter(m => isTv(m.data)), s = lslug(l);
      if (films.length >= 5) {
        add(l, { path: '/' + s + '-movies', list: films.slice().sort(newest), h1: l + ' movies', title: l + ' Movies – Reviews, Verdicts & Where to Watch',
          intro: films.length + ' ' + l + ' films on Reelscore, newest first: what is in theatres, what is streaming and what is coming, with a verdict on whether each is worth watching.' });
        const ys = {}; films.forEach(m => { const y = String(m.data.releaseDate || '').slice(0, 4); if (/^\d{4}$/.test(y)) (ys[y] = ys[y] || []).push(m); });
        Object.keys(ys).filter(y => ys[y].length >= 5).sort().reverse().forEach(y => {
          const fut = +y > now.getFullYear();
          add(l, { path: '/' + s + '-movies-' + y, list: ys[y].slice().sort(fut ? soonest : newest), h1: l + ' movies of ' + y, year: y,
            title: l + ' Movies ' + y + (fut ? ' – Release Dates & Cast' : ' – Reviews, Verdicts & OTT'),
            intro: ys[y].length + ' ' + l + ' films ' + (fut ? 'due in ' : 'released in ') + y + ', with cast, release dates, where to watch them and audience verdicts.' });
        });
      }
      if (all.length >= 50) {
        const th = pinFirst(films.filter(m => sectionOf(m) === 'In theatres').sort(newest), data.rows.theatres), ott = pinFirst(films.filter(m => sectionOf(m) === 'On OTT').sort(newest), data.rows.ott), up = pinFirst(films.filter(m => sectionOf(m) === 'Coming soon').sort(soonest), data.rows.coming);
        add(l, { path: '/' + s + '-movies-in-theatres', list: th, h1: l + ' movies in theatres', title: l + ' Movies in Theatres Now (' + monYr + ')', status: true,
          intro: th.length ? th.length + ' ' + l + ' film' + (th.length === 1 ? ' is' : 's are') + ' showing in theatres this week. Check the verdict before you book.' : 'No ' + l + ' films are in theatres on Reelscore right now.' });
        add(l, { path: '/new-' + s + '-movies-on-ott', list: ott, h1: 'New ' + l + ' movies on OTT', title: 'New ' + l + ' Movies on OTT (' + monYr + ')', status: true,
          intro: ott.length ? ott.length + ' recent ' + l + ' film' + (ott.length === 1 ? '' : 's') + ' now streaming, with the platform each one is on and whether it is worth a watch.' : 'No new ' + l + ' films on OTT on Reelscore right now.' });
        add(l, { path: '/upcoming-' + s + '-movies', list: up, h1: 'Upcoming ' + l + ' movies', title: 'Upcoming ' + l + ' Movies (' + now.getFullYear() + ') – Release Dates', status: true,
          intro: up.length ? up.length + ' upcoming ' + l + ' film' + (up.length === 1 ? '' : 's') + (data.rows.coming.length ? '' : ', soonest first') + ', with release dates, cast and trailers.' : 'No upcoming ' + l + ' films on Reelscore right now.' });
      }
      if (series.length >= 5) add(l, { path: '/' + s + '-web-series', list: series.slice().sort(newest), h1: l + ' web series and TV shows', title: l + ' Web Series & TV Shows – Reviews & Where to Watch',
        intro: series.length + ' ' + l + ' web series and TV shows, newest first, with where to watch them and audience verdicts.' });
    });
    // A page is kept out of Google while it links to fewer than 3 titles with substance (the rest are listed as plain
    // text); pages only link to language pages that are in Google.
    allPages.forEach(o => { o.lang = Object.keys(pagesFor).find(k => pagesFor[k].includes(o)); o.indexed = o.list.filter(m => !thinT(Object.assign({ __id: m.id }, m.data))).length >= 3; });
    for (const o of allPages) {
      const lang = o.lang, mine = pagesFor[lang].filter(x => x !== o && x.indexed);
      const sibs = mine.filter(x => !x.year), years = mine.filter(x => x.year).slice(0, 12);
      const same = allPages.filter(x => x !== o && x.indexed && x.path.replace(lslug(x.lang), '') === o.path.replace(lslug(lang), ''));
      const desc = clip(o.intro, 158), robots = o.indexed ? '' : 'noindex,follow';
      pageWhy.set(o.path, o.indexed ? 'Links to 3+ titles with substance' : 'Links to fewer than 3 titles with substance');
      if (robots) nLangNoindex++;
      let body = '<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › <a href="/browse">Browse</a> › ' + esc(o.h1.charAt(0).toUpperCase() + o.h1.slice(1)) + '</nav><h1>' + esc(o.h1.charAt(0).toUpperCase() + o.h1.slice(1)) + '</h1><p>' + esc(o.intro) + '</p>';
      body += o.list.length ? '<ul>' + o.list.map(titleLi).join('') + '</ul>' : '';
      if (sibs.length) body += '<h2>More ' + esc(lang) + '</h2><ul>' + sibs.map(x => '<li><a href="' + x.path + '">' + esc(x.h1.charAt(0).toUpperCase() + x.h1.slice(1)) + '</a></li>').join('') + '</ul>';
      if (years.length) body += '<h2>' + esc(lang) + ' movies by year</h2><ul>' + years.map(x => '<li><a href="' + x.path + '">' + x.year + '</a> <span class="note">' + x.list.length + '</span></li>').join('') + '</ul>';
      if (same.length) body += '<h2>Other languages</h2><ul>' + same.map(x => '<li><a href="' + x.path + '">' + esc(x.h1.charAt(0).toUpperCase() + x.h1.slice(1)) + '</a></li>').join('') + '</ul>';
      const title = o.title.length <= 60 && (o.title + ' | Reelscore').length > 60 ? o.title : o.title.length <= 48 ? o.title + ' | Reelscore' : o.title;
      writeHub(o.path.slice(1) + '.html', { title, description: desc, canonical: o.path, ogPath: o.path, route: 'browse', body, robots,
        jsonld: [crumbLd(['Home', '/'], ['Browse', '/browse'], [o.h1, o.path]), listLd(o.h1, o.list.filter(m => !thinT(Object.assign({ __id: m.id }, m.data))).map(movieUrl))] });
      if (!robots) sitemap.push({ loc: o.path, lastmod: pageDate(o.path, title + '\n' + desc + '\n' + body), pri: '0.8' });
    }
    LANG_PAGES.push(...allPages.map(o => o.path));
    console.log('[seo] language pages: ' + allPages.length + ', in Google ' + (allPages.length - nLangNoindex) + ' (' + Object.keys(pagesFor).map(k => k + ' ' + pagesFor[k].length).join(', ') + ')');
  }

  // People
  const peopleBody = '<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › People</nav><h1>Indian actors and filmmakers</h1><p>' + hubPeople.length +
    ' actors, directors and crew, busiest first.</p><ul>' + hubPeople.map(personLi).join('') + '</ul>';
  writeHub('people.html', { title: 'Indian Actors & Filmmakers | Reelscore', description: 'Filmographies of ' + hubPeople.length + ' Indian actors, directors and crew, with every movie and show they worked on.', canonical: '/people', ogPath: '/people', route: 'people', body: peopleBody,
    jsonld: [crumbLd(['Home', '/'], ['People', '/people']), listLd('Indian actors and filmmakers', hubPeople.map(k => '/person/' + k))] });

  // ----- News (/news) and the product blog (/blog): one page per published story or post, and a hub for each -----
  // Both live in Firestore "news"; blog posts have kind "blog".
  const newsSorted = newsPosts.slice().sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')));
  const postKind = p => p.kind === 'blog' ? 'blog' : 'news';
  {
    const KINDS = {
      news: { base: '/news', label: 'News', what: 'story', more: 'More news', ld: 'NewsArticle', by: 'By Reelscore', hubTitle: 'Indian Movie & OTT News | Reelscore',
        hubDesc: 'Release dates, OTT premieres and news on Bollywood and regional Indian films and series, written by the Reelscore team.',
        lead: 'Release dates, streaming premieres and what’s new in Indian cinema and series, written by the Reelscore team.', none: 'No stories yet. Check back soon.' },
      blog: { base: '/blog', label: 'Blog', what: 'post', more: 'More from the blog', ld: 'BlogPosting', by: 'By the Reelscore team', hubTitle: 'Reelscore Blog: Product News & Updates',
        hubDesc: 'What’s new on Reelscore, how verdicts and scores work, and what the team is building next.',
        lead: 'What’s new on Reelscore, how it works and what we’re building next, from the Reelscore team.', none: 'No posts yet. Check back soon.' }
    };
    const byId = new Map(movies.map(m => [m.id, m]));
    const titlesOf = p => (Array.isArray(p.titles) ? p.titles : []).map(id => byId.get(id)).filter(Boolean);
    const coverOf = (p, w) => { const u = safeUrl(p.coverUrl); if (u) return cld(u, w); const m = titlesOf(p)[0]; const b = m && (safeUrl(m.data.bannerUrl) || safeUrl(m.data.posterUrl)); return b ? cld(b, w) : ''; };
    const day = iso => /^\d{4}-\d{2}-\d{2}/.test(iso || '') ? iso.slice(0, 10) : '';
    for (const [kind, K] of Object.entries(KINDS)) {
      const posts = newsSorted.filter(p => postKind(p) === kind);
      const li = p => '<li><a href="' + K.base + '/' + esc(p.slug) + '">' + esc(p.title) + '</a>' + (day(p.publishedAt) ? '<span class="note"> · ' + fmtDate(day(p.publishedAt)) + '</span>' : '') + (p.summary ? '<br><span class="note">' + esc(p.summary) + '</span>' : '') + '</li>';
      for (const p of posts) {
        const url = K.base + '/' + p.slug, cover = coverOf(p, 1280), ts = titlesOf(p), more = posts.filter(x => x !== p).slice(0, 4);
        const body = '<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › <a href="' + K.base + '">' + K.label + '</a></nav>' +
          '<h1>' + esc(p.title) + '</h1>' + (p.summary ? '<p class="nwdek">' + esc(p.summary) + '</p>' : '') +
          '<p class="note">' + K.by + (day(p.publishedAt) ? ' · <time datetime="' + day(p.publishedAt) + '">' + fmtDate(day(p.publishedAt)) + '</time>' : '') + '</p>' +
          (cover ? '<img class="nwcover" src="' + esc(cover) + '" alt="' + esc(p.coverAlt || '') + '" width="1280" height="720" fetchpriority="high">' : '') +
          '<div class="nwbody">' + newsHtml(p.body) + '</div>' +
          (ts.length ? '<h2>' + (ts.length === 1 ? 'In this ' : 'Titles in this ') + K.what + '</h2><ul>' + ts.map(m => '<li><a href="' + movieUrl(m) + '">' + esc(m.data.title) + '</a>' + (year(m.data) ? ' (' + year(m.data) + ')' : '') + '</li>').join('') + '</ul>' : '') +
          (more.length ? '<h2>' + K.more + '</h2><ul class="nwlist">' + more.map(li).join('') + '</ul>' : '');
        const description = clip(p.summary || String(p.body || '').replace(/[#*>\[\]()-]/g, ' '), 158);
        const node = { '@context': 'https://schema.org', '@type': K.ld, headline: clip(p.title, 110), description, url: SITE + url, mainEntityOfPage: SITE + url,
          datePublished: p.publishedAt || undefined, dateModified: p.updatedAt || p.publishedAt || undefined, image: cover ? [cover] : undefined,
          author: { '@type': 'Organization', name: 'Reelscore', url: SITE + '/' }, publisher: { '@type': 'Organization', name: 'Reelscore', url: SITE + '/', logo: { '@type': 'ImageObject', url: SITE + '/icon-512.png' } },
          about: ts.length ? ts.map(m => ({ '@type': isTv(m.data) ? 'TVSeries' : 'Movie', name: m.data.title, url: SITE + movieUrl(m) })) : undefined };
        write(url.slice(1) + '.html', page(shell, { title: (p.title + ' | Reelscore').length <= 60 ? p.title + ' | Reelscore' : clip(p.title, 65), description, canonical: url, ogType: 'article', image: cover || null, wide: true, route: 'news', body,
          jsonld: [node, crumbLd(['Home', '/'], [K.label, K.base], [clip(p.title, 60), url])] }));
        sitemap.push({ loc: url, lastmod: day(p.updatedAt) || day(p.publishedAt), pri: kind === 'news' ? '0.7' : '0.5' });
      }
      const body = '<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › ' + K.label + '</nav><h1>' + K.label + '</h1>' +
        '<p>' + K.lead + '</p>' + (posts.length ? '<ul class="nwlist">' + posts.map(li).join('') + '</ul>' : '<p class="note">' + K.none + '</p>');
      writeHub(K.base.slice(1) + '.html', { title: K.hubTitle, description: K.hubDesc, canonical: K.base, ogPath: K.base, route: 'news', body,
        robots: posts.length ? undefined : 'noindex,follow',
        jsonld: [crumbLd(['Home', '/'], [K.label, K.base])].concat(posts.length ? [listLd('Reelscore ' + K.label.toLowerCase(), posts.map(p => K.base + '/' + p.slug))] : []) });
      if (posts.length) sitemap.push({ loc: K.base, pri: kind === 'news' ? '0.6' : '0.4' });
      console.log(`[seo] ${kind}: ${posts.length} published`);
    }
    write('news-data.json', JSON.stringify(newsSorted));
  }

  // ----- Lists (/lists, /lists/<slug>): curated lists written in Admin > Lists (Firestore "news", kind "list") -----
  // Each item is a title id and a short note in our own words. A list page is in Google once it links to 5+ titles with
  // substance; unpublished or deleted titles drop out. Verdicts show only past MIN_VERDICTS, as on title pages.
  {
    const byId = new Map(movies.map(m => [m.id, m]));
    const day = iso => /^\d{4}-\d{2}-\d{2}/.test(iso || '') ? iso.slice(0, 10) : '';
    const lists = listPosts.filter(p => p.slug && p.title && /^[a-z0-9-]+$/.test(p.slug)).sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')));
    const itemsOf = p => (Array.isArray(p.items) ? p.items : []).map(x => ({ m: byId.get(x && x.id), note: String((x && x.note) || '').trim() })).filter(x => x.m);
    const whereOf = d => {
      if (!isTv(d) && (d.releaseDate ? d.releaseDate > TODAY : d.section === 'Coming soon')) return /^\d{4}-\d{2}-\d{2}$/.test(d.releaseDate || '') ? 'In theatres ' + fmtDate(d.releaseDate) : 'Coming soon';
      if (d.section === 'In theatres') return 'In theatres now';
      return String(d.platform || '').trim() ? 'On ' + String(d.platform).split('/').map(x => x.trim()).filter(Boolean).join(', ') : '';
    };
    const liOf = (x, i) => { const d = x.m.data, sc = score(x.m.id);
      return '<li><h2>' + (i + 1) + '. ' + tLink(x.m) + '</h2><p class="note">' + esc([isTv(d) ? 'TV · ' + tvYears(d) : year(d), String(d.languages || '').split(/[,;]/)[0].trim(), d.genre, whereOf(d)].filter(Boolean).join(' · ')) + '</p>' +
        (x.note ? '<p>' + newsInlineHtml(x.note) + '</p>' : '') + (sc.tot >= MIN_VERDICTS ? '<p class="note">Reelscore: ' + sc.pct + '% say watch it (' + sc.tot + ' verdicts)</p>' : '') + '</li>'; };
    for (const p of lists) {
      const url = '/lists/' + p.slug, items = itemsOf(p);
      const rich = items.filter(x => !thinT(Object.assign({ __id: x.m.id }, x.m.data))).length, indexed = rich >= 5;
      const others = lists.filter(x => x !== p).slice(0, 6);
      const body = '<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › <a href="/lists">Lists</a></nav><h1>' + esc(p.title) + '</h1>' +
        (p.summary ? '<p class="nwdek">' + esc(p.summary) + '</p>' : '') +
        '<p class="note">By Reelscore' + (day(p.updatedAt || p.publishedAt) ? ' · Updated <time datetime="' + day(p.updatedAt || p.publishedAt) + '">' + fmtDate(day(p.updatedAt || p.publishedAt)) + '</time>' : '') + ' · ' + items.length + ' title' + (items.length === 1 ? '' : 's') + '</p>' +
        (p.body ? '<div class="nwbody">' + newsHtml(p.body) + '</div>' : '') +
        '<ol class="lsl">' + items.map(liOf).join('') + '</ol>' +
        (others.length ? '<h2>More lists</h2><ul class="nwlist">' + others.map(x => '<li><a href="/lists/' + esc(x.slug) + '">' + esc(x.title) + '</a></li>').join('') + '</ul>' : '');
      const description = clip(p.summary || items.slice(0, 4).map(x => x.m.data.title).join(', '), 158);
      const node = { '@context': 'https://schema.org', '@type': 'ItemList', name: p.title, description, url: SITE + url, numberOfItems: items.length,
        itemListOrder: 'https://schema.org/ItemListOrderAscending',
        itemListElement: items.map((x, i) => ({ '@type': 'ListItem', position: i + 1, url: SITE + movieUrl(x.m), name: x.m.data.title })) };
      write(url.slice(1) + '.html', page(shell, { title: (p.title + ' | Reelscore').length <= 60 ? p.title + ' | Reelscore' : clip(p.title, 65), description, canonical: url, ogType: 'article', image: null, wide: true, route: 'lists', body,
        robots: indexed ? undefined : 'noindex,follow', jsonld: [node, crumbLd(['Home', '/'], ['Lists', '/lists'], [clip(p.title, 60), url])] }));
      if (indexed) sitemap.push({ loc: url, lastmod: day(p.updatedAt) || day(p.publishedAt), pri: '0.7' });
    }
    const hubBody = '<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › Lists</nav><h1>Lists</h1>' +
      '<p>Hand-picked lists of Indian films and series: what to stream by language, genre and platform, written by the Reelscore team.</p>' +
      (lists.length ? '<ul class="nwlist">' + lists.map(p => '<li><a href="/lists/' + esc(p.slug) + '">' + esc(p.title) + '</a> <span class="note">· ' + itemsOf(p).length + ' titles</span>' + (p.summary ? '<br><span class="note">' + esc(p.summary) + '</span>' : '') + '</li>').join('') + '</ul>' : '<p class="note">No lists yet. Check back soon.</p>');
    writeHub('lists.html', { title: 'Movie Lists: What to Watch by Language & OTT | Reelscore', description: 'Hand-picked lists of Indian films and series to stream, by language, genre and platform, from the Reelscore team.',
      canonical: '/lists', ogPath: '/lists', route: 'lists', body: hubBody, robots: lists.length ? undefined : 'noindex,follow',
      jsonld: [crumbLd(['Home', '/'], ['Lists', '/lists'])].concat(lists.length ? [listLd('Reelscore lists', lists.map(p => '/lists/' + p.slug))] : []) });
    if (lists.length) sitemap.push({ loc: '/lists', pri: '0.6' });
    write('lists-data.json', JSON.stringify(lists));
    console.log(`[seo] lists: ${lists.length} published`);
  }

  // ----- About / how scores work -----
  {
    const t = VERD.theatre, o = VERD.ott;
    const body = '<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › About</nav>' +
      '<h1>About Reelscore and how scores work</h1>' +
      '<p>Reelscore is an independent site, built in India, for people who watch films and series in more than one Indian language. It answers one practical question about every title: is it worth the trip to the theatre, worth streaming at home, or worth skipping? The catalogue covers ' + movies.length + ' Bollywood and regional titles in Hindi, Tamil, Telugu, Malayalam, Kannada, Bengali, Marathi and more, with pages for ' + nPeople + ' actors and filmmakers.</p>' +
      '<h2>Verdicts</h2>' +
      '<p>Anyone signed in with a Google account can give a verdict once a title is out. Each person has one verdict per title and can change or remove it at any time. There are three choices:</p>' +
      '<ul><li>For films in theatres: <b>' + esc(t[0][1]) + '</b> (' + esc(t[0][2].toLowerCase()) + '), <b>' + esc(t[1][1]) + '</b> (' + esc(t[1][2].toLowerCase()) + ') or <b>' + esc(t[2][1]) + '</b> (' + esc(t[2][2].toLowerCase()) + ').</li>' +
      '<li>For films on OTT, older releases and TV shows: <b>' + esc(o[0][1]) + '</b>, <b>' + esc(o[1][1]) + '</b> or <b>' + esc(o[2][1]) + '</b>.</li></ul>' +
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

  // ----- Privacy policy (kept in step with what the site actually does: see firestore.rules, js/firebase-adapter.js) -----
  {
    const body = '<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › Privacy</nav>' +
      '<h1>Privacy policy</h1>' +
      '<p class="note">Last updated ' + PRIVACY_UPDATED + '.</p>' +
      '<p>This page explains what Reelscore collects, why, who else is involved and what you can ask us to do. Reelscore is a small independent site. If anything here is unclear, <a href="/contact">contact us</a>.</p>' +
      '<h2>Browsing without signing in</h2>' +
      '<p>You can read every page without an account. We don’t use analytics or tracking tools, and we don’t set advertising cookies. Your browser keeps a few of your choices on your own device (local storage) so the site remembers them next time: your language and city, your streaming apps, your Tonight answers, and the titles you marked “Not for me”. These never leave your device unless you sign in, and you can clear them by clearing your browser’s site data.</p>' +
      '<h2>Signing in</h2>' +
      '<p>Signing in is optional and uses your Google account through Google Firebase. We receive your name, your profile photo and an account ID from Google. We never see your Google password.</p>' +
      '<p>When you’re signed in, we store:</p>' +
      '<ul><li><b>Public:</b> your name and profile photo, your verdicts and your reviews. Anyone can see these, which is how scores and Peer Scores work.</li>' +
      '<li><b>Private, only you can see them:</b> your watchlist, the people you follow, your release reminders, your streaming apps and your “Not for me” list.</li></ul>' +
      '<h2>Messages you send us</h2>' +
      '<p>If you use the <a href="/contact">contact form</a>, we keep what you write, the email address you give and, if you’re signed in, your account ID, so we can reply and find your data if you ask about it. Only the Reelscore team can read messages.</p>' +
      '<h2>Who else is involved</h2>' +
      '<ul><li><b>Google Firebase</b> stores accounts, verdicts, reviews, lists and messages, and handles sign-in.</li>' +
      '<li><b>Vercel</b> hosts the site. Like any web host, its servers see your IP address and the pages you request.</li>' +
      '<li><b>Cloudinary</b> serves posters and photos.</li>' +
      '<li><b>YouTube</b> plays trailers and songs. The YouTube player loads only when you press play or open a video’s own page, using YouTube’s privacy-enhanced mode; from then on, YouTube’s own privacy policy applies.</li></ul>' +
      '<p>We don’t sell your information, and we don’t share it with anyone other than the services above, which handle it to run the site.</p>' +
      '<h2>Advertising</h2>' +
      '<p>Reelscore shows no ads today. If we add them, we will update this page before they appear, explaining which ad provider is used and the choices you have. Ads would only appear on pages with full title information, not on video pages.</p>' +
      '<h2>Your choices</h2>' +
      '<ul><li>Change or remove any verdict or review at any time on the title’s page.</li>' +
      '<li>Remove titles from your watchlist, reminders and follows at any time.</li>' +
      '<li>Ask us to delete your account and everything stored with it, or to send you a copy, through the <a href="/contact">contact form</a>. Choose “Privacy or my data” as the topic. We aim to do it within 30 days.</li></ul>' +
      '<h2>How long we keep things</h2>' +
      '<p>Your account data stays until you delete it or ask us to. Messages are kept until the matter is dealt with, and no longer than a year.</p>' +
      '<h2>Changes</h2>' +
      '<p>When this policy changes, the date at the top changes too. For significant changes, we’ll say so on the home page.</p>';
    writeHub('privacy.html', { title: 'Privacy Policy | Reelscore', description: 'What Reelscore collects, why, who else is involved, and how to see, change or delete your information.', canonical: '/privacy', ogPath: '/privacy', route: 'privacy', body,
      jsonld: [crumbLd(['Home', '/'], ['Privacy', '/privacy'])] });
    sitemap.push({ loc: '/privacy', pri: '0.2' });
  }

  // ----- Contact: the text is static; app/main.js adds the form (messages go to Firestore "contact", read in the admin panel) -----
  {
    const body = '<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › Contact</nav>' +
      '<h1>Contact Reelscore</h1>' +
      '<p>Spotted a wrong release date, cast name or streaming link? Want a title added, or something taken down? Have a question about your data, or want to work with us? Send us a message and we’ll reply by email.</p>' +
      '<div id="contactForm"><p class="note">The form needs JavaScript. If it doesn’t appear, reload the page.</p></div>' +
      '<p class="note">We read every message. What you send is handled as our <a href="/privacy">privacy policy</a> describes.</p>';
    writeHub('contact.html', { title: 'Contact | Reelscore', description: 'Send Reelscore a correction, a takedown request, a question about your data or a partnership idea.', canonical: '/contact', ogPath: '/contact', route: 'contact', body,
      jsonld: [crumbLd(['Home', '/'], ['Contact', '/contact'])] });
    sitemap.push({ loc: '/contact', pri: '0.2' });
  }

  // ----- aliases, people with too few credits for an indexed page, 404 -----
  // These exist so real links never hit the 404 page; none are in the sitemap and none are indexed.
  for (const [au, to] of aliases) {
    if (seen.has(au)) continue;
    write(au.slice(1) + '.html', '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Moved | Reelscore</title><meta name="robots" content="noindex,follow"><link rel="canonical" href="' + esc(SITE + to) + '"><meta http-equiv="refresh" content="0; url=' + esc(to) + '"></head><body><p><a href="' + esc(to) + '">Continue to the page</a></p></body></html>');
  }
  for (const slug of thinPeople) {
    const name = personName(slug), titles = [...new Map(credits[slug].map(c => [c.m.id, c.m])).values()];
    const body = '<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › <a href="/people">People</a> › ' + esc(name) + '</nav><h1>' + esc(name) + '</h1><ul>' + titles.map(t => '<li>' + tLink(t) + '</li>').join('') + '</ul>';
    write('person/' + slug + '.html', page(shell, { title: personTitleTag(name), description: clip(name + ' on Reelscore: ' + list(titles.slice(0, 3).map(t => t.data.title)) + '.', 158), canonical: '/person/' + slug, ogType: 'profile', image: null, wide: false, jsonld: [], route: 'person', body, robots: 'noindex,follow' }));
  }
  write('404.html', page(shell, { title: 'Page not found | Reelscore', description: 'This page doesn’t exist on Reelscore.', canonical: null, ogPath: '/', ogType: 'website', image: null, jsonld: [], route: 'home', robots: 'noindex',
    body: '<h1>Page not found</h1><p>This page doesn’t exist, or the title has moved.</p><p><a href="/">Go to the home page</a> · <a href="/browse">Browse all titles</a></p>' }).replace('<head>', '<head>\n<meta name="rs-404" content="1">'));

  // ----- all trailers, songs and TV promotionals: /trailers, /songs, /tv-promos (same lists as app/main.js) -----
  const vidHubs = [
    ['trailers', 'All trailers', 'Latest Movie Trailers | Reelscore', 'Official trailers and teasers of new Bollywood and regional Indian movies, newest first.', m => !isTv(m.data), x => x.cat === 'trailers', true],
    ['songs', 'All video songs', 'Latest Video Songs | Reelscore', 'Official video and lyric songs from new Bollywood and regional Indian movies, newest first.', m => !isTv(m.data), x => x.cat === 'songs', false],
    ['tv-promos', 'All TV promotionals', 'TV Show Trailers, Promos & Episodes | Reelscore', 'Official trailers, promos and full episodes of Indian TV shows and web series.', m => isTv(m.data), () => true, false]
  ];
  const VID_PINS = { trailers: data.rows.trailers, songs: data.rows.songs, 'tv-promos': data.rows.tvpromos };
  for (const [slug, h1, title, desc, pickM, pickV, onePer] of vidHubs) {
    const items = [];
    pinFirst(movies.filter(pickM).sort(newest), VID_PINS[slug]).forEach(m => { const vs = ytVideos(m.data).filter(pickV); (onePer ? vs.slice(0, 1) : vs).forEach(x => items.push([m, x])); });
    const body = '<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › ' + esc(h1) + '</nav><h1>' + esc(h1) + '</h1><p>' + items.length + ' videos. ' + esc(desc) + '</p>' +
      '<ul class="pr-vids">' + items.map(([m, x]) => '<li><img src="' + ytThumb(x.yt) + '" alt="' + esc(m.data.title + ' · ' + x.title) + '" width="160" height="90" loading="lazy"> <a href="' + movieUrl(m) + ((videoPaths(m.data).find(p => p.yt === x.yt) || {}).path || '') + '">' + esc(m.data.title) + '</a> · ' + esc(x.title) + ' <span class="note">' + esc([x.kind, String(m.data.languages || '').split(/[,;]/)[0].trim()].filter(Boolean).join(' · ')) + '</span></li>').join('') + '</ul>' +
      '<h2>More videos</h2><ul>' + vidHubs.filter(v => v[0] !== slug).map(v => '<li><a href="/' + v[0] + '">' + esc(v[1]) + '</a></li>').join('') + '</ul>';
    // An empty list (no videos of that kind yet) stays out of Google, as it's out of the sitemap.
    writeHub(slug + '.html', { title, description: desc, canonical: '/' + slug, ogPath: '/' + slug, route: 'vids', body, robots: items.length ? undefined : 'noindex,follow',
      jsonld: [{ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: SITE + '/' }, { '@type': 'ListItem', position: 2, name: h1, item: SITE + '/' + slug }] }] });
    if (items.length) sitemap.push({ loc: '/' + slug, pri: '0.6' });
  }

  // ----- sitemap + robots -----
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    sitemap.map(u => '<url><loc>' + esc(SITE + u.loc) + '</loc>' + (/^\d{4}-\d{2}-\d{2}$/.test(u.lastmod || '') ? '<lastmod>' + u.lastmod + '</lastmod>' : '') + '<priority>' + u.pri + '</priority></url>').join('\n') + '\n</urlset>\n';
  if (sitemap.length > 50000) throw new Error('Sitemap over 50,000 URLs: split it into a sitemap index');
  write('sitemap.xml', xml);
  write('page-dates.json', JSON.stringify(PAGE_DATES));

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

  write('robots.txt', ['User-agent: *', 'Disallow: /admin', 'Disallow: /my-list', 'Disallow: /tonight', 'Disallow: /setup', 'Disallow: /data/', '', 'Sitemap: ' + SITE + '/sitemap.xml', ''].join('\n'));

  // ----- page report: every page, open to Google or kept out, and why (/seo-pages.csv, linked from the admin panel) -----
  {
    const inMap = new Set(sitemap.map(x => x.loc)), rows = [];
    const walk = dir => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name);
      if (e.isDirectory()) { if (!['assets', 'app', 'js', 'fonts', 'data', 'admin', 'node_modules'].includes(e.name) || dir !== OUT) walk(f); continue; }
      if (!e.name.endsWith('.html')) continue;
      const rel = '/' + path.relative(OUT, f).replace(/\\/g, '/').replace(/\.html$/, '').replace(/(^|\/)index$/, '');
      if (rel === '/404' || /^\/(setup|admin|my-list|tonight)(\/|$)/.test(rel)) continue;
      const html = fs.readFileSync(f, 'utf8');
      if (/<title>Moved \| Reelscore<\/title>/.test(html)) continue; // old addresses that point to a page
      const url = rel || '/', open = !/<meta name="robots" content="[^"]*noindex/.test(html);
      const type = /^\/movie\/[^/]+\/./.test(url) || /^\/tv\/[^/]+\/./.test(url) ? 'Video' : /^\/movie\//.test(url) ? 'Film' : /^\/tv\//.test(url) ? 'TV show'
        : /^\/person\//.test(url) ? 'Person' : pageWhy.has(url) ? 'Language page' : 'Hub page';
      const why = type === 'Person' ? personWhy(url.slice(8)) : pageWhy.get(url) || (open ? 'Site page' : 'Kept out of Google');
      rows.push([SITE + url, type, open ? 'Open to Google' : 'Kept out', inMap.has(url) ? 'yes' : 'no', why]);
    } };
    walk(OUT);
    const order = { Film: 1, 'TV show': 2, Person: 3, 'Language page': 4, 'Hub page': 5, Video: 6 };
    rows.sort((a, b) => (a[2] === b[2] ? 0 : a[2] === 'Open to Google' ? -1 : 1) || order[a[1]] - order[b[1]] || a[0].localeCompare(b[0]));
    const cell = v => /[",\n]/.test(v) ? '"' + String(v).replace(/"/g, '""') + '"' : v;
    write('seo-pages.csv', [['URL', 'Type', 'Google', 'In sitemap', 'Why']].concat(rows).map(r => r.map(cell).join(',')).join('\n') + '\n');
    const odd = rows.filter(r => (r[2] === 'Open to Google') !== (r[3] === 'yes'));
    console.log(`[seo] page report: ${rows.filter(r => r[2] === 'Open to Google').length} open to Google, ${rows.filter(r => r[2] !== 'Open to Google').length} kept out` + (odd.length ? `; ${odd.length} differ from the sitemap, e.g. ${odd.slice(0, 3).map(r => r[0].replace(SITE, '')).join(', ')}` : ''));
  }

  // ----- fingerprinted assets: /assets/<name>.<hash>.<ext>, cached for a year (vercel.json) -----
  // Every HTML page points at the hashed copies, so a deploy changes the URLs and browsers never run stale code.
  // The plain files stay too (catalogue.json is read by the next build; admin.js is loaded by name).
  const crypto = await import('node:crypto');
  await minifyAssets();
  const hashed = {};
  for (const rel of ['app/app.css', 'app/about.js', 'app/main.js', 'js/claude-shim.js', 'js/firebase-adapter.js', 'firebase-config.js', 'catalogue.json', 'catalogue-core.json', 'catalogue-older.json']) {
    const buf = fs.readFileSync(path.join(OUT, rel)), h8 = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);
    const base = path.basename(rel).replace(/\.(\w+)$/, '.' + h8 + '.$1');
    write('assets/' + base, buf); hashed['/' + rel] = '/assets/' + base;
  }
  // Catalogue file names for the app, as a small external script: the Content-Security-Policy in vercel.json allows no inline scripts.
  // Film counts by first language and by year, so the home page tiles are right before the older catalogue loads.
  const stats = { lang: {}, year: {} };
  movies.forEach(m => { if (isTv(m.data)) return; const l = String(m.data.languages || '').split(/[,;]/)[0].trim(), y = String(m.data.releaseDate || '').slice(0, 4);
    if (/^[A-Za-z]+$/.test(l)) stats.lang[l] = (stats.lang[l] || 0) + 1; if (/^\d{4}$/.test(y)) stats.year[y] = (stats.year[y] || 0) + 1; });
  const catJs = 'window.RS_CAT=' + JSON.stringify(hashed['/catalogue.json']) + ';window.RS_CAT_CORE=' + JSON.stringify(hashed['/catalogue-core.json']) + ';window.RS_CAT_OLD=' + JSON.stringify(hashed['/catalogue-older.json']) + ';window.RS_STATS=' + JSON.stringify(stats) + ';window.RS_ROWS=' + JSON.stringify(data.rows) + ';window.RS_FEATURED=' + JSON.stringify(data.featured || []) + ';' + HERO_JS + 'window.RS_BTNS=' + JSON.stringify(data.buttons) + ';window.RS_NEWS=' + JSON.stringify(newsSorted.slice(0, 300).map(p => ({ kind: postKind(p), slug: p.slug, title: p.title, publishedAt: p.publishedAt || '', coverUrl: p.coverUrl || '', coverAlt: p.coverAlt || '', titles: Array.isArray(p.titles) ? p.titles : [] }))).replace(/</g, '\\u003c') + ';\n';
  const catPtr = '/assets/cat-' + crypto.createHash('sha256').update(catJs).digest('hex').slice(0, 10) + '.js';
  fs.mkdirSync(path.join(OUT, 'assets'), { recursive: true }); fs.writeFileSync(path.join(OUT, catPtr), catJs);
  const htmlFiles = []; (function walk(dir) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) { if (e.name !== 'assets') walk(f); } else if (e.name.endsWith('.html') && e.name !== 'setup.html') htmlFiles.push(f); } })(OUT);
  for (const f of htmlFiles) {
    let html = fs.readFileSync(f, 'utf8'), changed = false;
    for (const [from, to] of Object.entries(hashed)) { if (/^\/catalogue/.test(from)) continue; const a = '"' + from + '"'; if (html.includes(a)) { html = html.split(a).join('"' + to + '"'); changed = true; } }
    // Pages without a seed need the core catalogue first, so the browser starts fetching it while it reads the page.
    const pre = html.includes('id="rs-seed"') ? '' : '\n<link rel="preload" href="' + hashed['/catalogue-core.json'] + '" as="fetch" crossorigin="anonymous">';
    if (html.includes('<!--/seo-->')) { html = html.replace('<!--/seo-->', '<!--/seo-->\n<script defer src="' + catPtr + '"></script>' + pre); changed = true; }
    if (changed) fs.writeFileSync(f, html);
  }

  console.log(`[seo] SEO tiers: ${JSON.stringify(tierCount)}`);
  console.log(`[seo] wrote ${nTitles} title pages and ${nVideoPages} video pages (${nThinTitles} kept out of the index until they have more substance; ${nRated} with rating markup, min ${MIN_VERDICTS} verdicts), ${nPeople} person pages (bio, or photo + ${PERSON_PHOTO} titles, or ${PERSON_TITLES} titles), sitemap ${sitemap.length} URLs, site ${SITE}, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch(e => { console.error('[seo] build failed:', e && e.stack || e); process.exit(1); });
