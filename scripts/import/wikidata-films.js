// Wikidata (CC0) importer for Indian films. Paste into the console on the live site while signed in as admin.
//   await ReelImport.preview({ max: 3000 })   -> builds window.__films and returns counts
//   await ReelImport.write()                  -> creates the new movies/<slug> docs (never overwrites)
(function () {
  const SPARQL = 'https://query.wikidata.org/sparql?format=json&query=';
  const IL = ['Hindi', 'Tamil', 'Telugu', 'Malayalam', 'Kannada', 'Bengali', 'Marathi', 'Punjabi', 'Gujarati', 'Odia', 'Assamese',
    'Konkani', 'Bhojpuri', 'Tulu', 'Urdu', 'Hindustani', 'Rajasthani', 'Manipuri', 'Sanskrit', 'Kashmiri', 'Sindhi', 'Haryanvi',
    'Chhattisgarhi', 'Khasi', 'Maithili', 'Garhwali', 'Mizo', 'Bodo', 'Kokborok', 'Santali'];
  const GENRES = /(drama|action|comedy|romance|romantic|thriller|crime|horror|musical|biographical|historical|period|war|family|fantasy|science fiction|mystery|adventure|sport|social|masala|political|coming-of-age|documentary|animated|children|psychological|satire|mythological|devotional|western|spy|heist|disaster|superhero|martial arts|teen|anthology|gangster|legal|survival|black comedy|parody)/i;
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\(.*?\)/g, '').replace(/[^a-z0-9]/g, '');
  const slugify = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function q(query) {
    for (let a = 0; a < 3; a++) {
      try { const r = await fetch(SPARQL + encodeURIComponent(query), { headers: { Accept: 'application/sparql-results+json' } }); if (!r.ok) throw r.status; return (await r.json()).results.bindings; }
      catch (e) { await sleep(3000); }
    }
    return [];
  }
  const qid = u => u.split('/').pop();

  async function list() { // every Indian film with an English Wikipedia article, two years per query to stay under the 60s limit
    const by = {};
    for (let y = 1970; y <= 2025; y += 2) {
      (await q(`SELECT ?f ?fl ?d ?sl ?imdb ?wp WHERE { ?f wdt:P31 wd:Q11424; wdt:P495 wd:Q668; wdt:P577 ?d; wikibase:sitelinks ?sl.
        FILTER(?d >= "${y}-01-01"^^xsd:dateTime && ?d < "${y + 2}-01-01"^^xsd:dateTime)
        ?wp schema:about ?f; schema:isPartOf <https://en.wikipedia.org/>. OPTIONAL{?f wdt:P345 ?imdb} OPTIONAL{?f rdfs:label ?fl FILTER(LANG(?fl)='en')} }`))
        .forEach(b => {
          const id = qid(b.f.value), d = b.d.value.slice(0, 10), o = by[id];
          if (!o) by[id] = { q: id, t: b.fl && b.fl.value, d, sl: +b.sl.value, imdb: b.imdb && b.imdb.value, wp: decodeURIComponent(b.wp.value.split('/wiki/')[1]) };
          else { if (d < o.d) o.d = d; if (!o.imdb && b.imdb) o.imdb = b.imdb.value; }
        });
    }
    return Object.values(by).sort((a, b) => b.sl - a.sl);
  }

  async function details(ids) {
    const map = {}, P = { lang: 'wdt:P364', genre: 'wdt:P136', dir: 'wdt:P57', music: 'wdt:P86' };
    const get = f => map[f] || (map[f] = { lang: [], genre: [], dir: [], music: [], cast: {}, dur: '' });
    for (let i = 0; i < ids.length; i += 150) {
      const vals = ids.slice(i, i + 150).map(x => 'wd:' + x).join(' ');
      await Promise.all([
        ...Object.entries(P).map(([k, p]) => q(`SELECT ?f ?vl WHERE { VALUES ?f {${vals}} ?f ${p} ?v. ?v rdfs:label ?vl FILTER(LANG(?vl)='en') }`)
          .then(rows => rows.forEach(b => { const o = get(qid(b.f.value)); if (!o[k].includes(b.vl.value)) o[k].push(b.vl.value); }))),
        // cast with each actor's sitelink count, used to put the best-known names first (Wikidata cast order is arbitrary)
        q(`SELECT ?f ?vl ?sl WHERE { VALUES ?f {${vals}} ?f wdt:P161 ?v. ?v wikibase:sitelinks ?sl; rdfs:label ?vl FILTER(LANG(?vl)='en') }`)
          .then(rows => rows.forEach(b => { get(qid(b.f.value)).cast[b.vl.value] = +b.sl.value; })),
        q(`SELECT ?f ?d WHERE { VALUES ?f {${vals}} ?f wdt:P2047 ?d }`).then(rows => rows.forEach(b => { get(qid(b.f.value)).dur = b.d.value; }))
      ]);
    }
    return map;
  }

  function build(films, det, cat, max) {
    const have = new Set(), ids = new Set(cat.movies.map(m => m.id)), out = [];
    cat.movies.forEach(m => { const y = +String(m.data.releaseDate || '').slice(0, 4), t = norm(m.data.title); [y - 1, y, y + 1].forEach(k => have.add(t + '|' + k)); });
    for (const f of films) {
      if (out.length >= max) break;
      const D = det[f.q]; if (!D) continue;
      const langs = D.lang.map(l => l.replace(/ language$/, '')), ind = langs.filter(l => IL.includes(l)).map(l => (l === 'Hindustani' ? 'Hindi' : l));
      if (!ind.length || langs.includes('English')) continue;          // Indian-language films only (drops foreign co-productions)
      const cast = Object.entries(D.cast).sort((a, b) => b[1] - a[1]).map(x => x[0]);
      if (!D.dir.length || cast.length < 2) continue;
      const y = f.d.slice(0, 4); if (+y >= 2026) continue;               // current and upcoming films are curated by hand
      const title = f.wp.replace(/_/g, ' ').replace(/\s*\([^)]*\)\s*$/, '').trim();
      if (have.has(norm(title) + '|' + y) || have.has(norm(f.t) + '|' + y)) continue;
      const slug = slugify(title) + '-' + y; if (!slug || ids.has(slug)) continue; ids.add(slug);
      const gen = D.genre.map(g => g.replace(/ films?$/i, '')).filter(g => GENRES.test(g)).slice(0, 2);
      const mins = +String(D.dur).replace(/[^0-9.]/g, '');
      const c = cast.slice(0, 8).map(n => ({ name: n, role: 'Cast' })); if (D.music[0]) c.push({ name: D.music[0], role: 'Music director' });
      out.push({ id: slug, data: {
        title, slug, section: 'Older releases', releaseDate: /-01-01$/.test(f.d) ? y : f.d,
        languages: [...new Set(ind)].slice(0, 3).join(', '), genre: gen.length ? (gen.join(', ').charAt(0).toUpperCase() + gen.join(', ').slice(1)) : '',
        runtime: mins > 30 && mins < 300 ? Math.floor(mins / 60) + 'h ' + String(Math.round(mins % 60)).padStart(2, '0') + 'm' : '',
        director: D.dir.slice(0, 2).join(', '), cast: c, videos: [], slugHistory: [],
        wikidata: f.q, imdb: f.imdb || '', source: 'Wikidata import (CC0), ' + new Date().toISOString().slice(0, 10), importedAt: new Date().toISOString()
      } });
    }
    return out;
  }

  window.ReelImport = {
    _build: build, _details: details, _list: list,
    async preview(opts) {
      const max = (opts && opts.max) || 3000;
      const cat = await (await fetch('/catalogue.json', { cache: 'no-store' })).json();
      const films = (await list()).slice(0, Math.round(max * 1.8));
      const det = await details(films.map(f => f.q));
      window.__films = build(films, det, cat, max);
      return { candidates: films.length, toAdd: window.__films.length, sample: window.__films.slice(0, 3) };
    },
    async write() {
      // order keeps imports after hand-curated titles (Firestore orderBy('order') skips docs without one)
      const db = await window.claude.use('db'); const idx = m => list.indexOf(m); let ok = 0, fail = 0; const now = new Date().toISOString();
      const items = window.__films || [], list = items;
      for (let i = 0; i < items.length; i += 10) {
        await Promise.all(items.slice(i, i + 10).map(m => db.doc('movies/' + m.id).get()
          .then(s => (s && s.exists) ? null : db.doc('movies/' + m.id).set({ ...m.data, order: 100000 + idx(m), updatedAt: now }))
          .then(() => ok++, () => fail++)));
      }
      return { ok, fail };
    }
  };
})();
