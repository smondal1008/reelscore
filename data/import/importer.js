// Admin-only helper for bulk filmography imports. Writes need an admin sign-in (Firestore rules).
window.__importFilms2 = async function (url, dry, source) {
  const db = await window.claude.use('db');
  const slug = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  const loose = t => slug(t).replace(/-(the|a|an|part|chapter)-/g, '-').replace(/^(the|a)-/, '').replace(/[^a-z0-9]/g, '');
  const pk = n => slug(n), L = s => String(s || '').split(/[,;]/)[0].trim().toLowerCase();
  const items = await fetch(url, { cache: 'no-store' }).then(r => r.json());
  const movies = (await db.collection('movies').get()).docs.map(d => ({ id: d.id, data: d.data() }));
  const ids = new Set(movies.map(m => m.id)), byLoose = {};
  const slugs = new Set(movies.map(m => slug(m.data.slug) || m.id));
  movies.forEach(m => { const y = (m.data.releaseDate || '').slice(0, 4); (byLoose[loose(m.data.title)] = byLoose[loose(m.data.title)] || []).push({ m, y }); });
  const known = {}; movies.forEach(m => (m.data.cast || []).forEach(c => { if (c.name) known[pk(c.name)] = known[pk(c.name)] || c.name; }));
  (await db.collection('people').get()).docs.forEach(d => { const p = d.data(); if (p.name) known[d.id] = p.name; (p.aka || []).forEach(a => { known[pk(a)] = known[pk(a)] || p.name; }); });
  const fixName = n => known[pk(n)] || n;
  let maxOrder = Math.max(0, ...movies.map(m => m.data.order || 0));
  const now = new Date().toISOString(), res = { created: 0, merged: 0, rolesSet: 0, unchanged: 0, mergedTitles: [], createdTitles: [] }, writes = [];
  for (const it of items) {
    const y = +it.releaseDate.slice(0, 4);
    const cands = (byLoose[loose(it.title)] || []).filter(c => (!c.y || Math.abs(+c.y - y) <= 1) && (!c.m.data.languages || L(c.m.data.languages) === L(it.languages)));
    const cast = it.cast.map(c => ({ name: fixName(c.name), role: c.role || 'Cast' }));
    if (cands.length) {
      const m = cands[0].m, cur = (m.data.cast || []).map(c => Object.assign({}, c)); let changed = false, roleN = 0; const add = [];
      cast.forEach(c => { const ex = cur.find(x => pk(x.name) === pk(c.name)); if (!ex) { add.push(c); changed = true; } else if ((!ex.role || ex.role === 'Cast') && c.role && c.role !== 'Cast') { ex.role = c.role; changed = true; roleN++; } });
      if (!changed) { res.unchanged++; continue; }
      if (add.length) res.merged++; res.rolesSet += roleN;
      res.mergedTitles.push(m.data.title + ' (' + (m.data.releaseDate || '').slice(0, 4) + ')' + (add.length ? ' +' + add.map(c => c.name).join(', ') : '') + (roleN ? ' [role]' : ''));
      const body = { cast: cur.concat(add), updatedAt: now };
      if (!m.data.director && it.director) body.director = it.director;
      if (!dry) writes.push(db.doc('movies/' + m.id).set(body, { merge: true }));
      m.data.cast = body.cast; continue;
    }
    if (it.mergeOnly) { (res.skipped = res.skipped || []).push(it.title + ' ' + it.releaseDate); continue; }
    if (slugs.has(it.slug)) it.slug = it.slug + '-' + slug(L(it.languages));
    slugs.add(it.slug);
    let id = it.slug.slice(0, 30).replace(/-+$/, ''), n = 2;
    while (ids.has(id)) id = it.slug.slice(0, 27).replace(/-+$/, '') + '-' + (n++);
    ids.add(id);
    const doc = { title: it.title, subtitle: '', slug: it.slug, slugHistory: [], section: 'Older releases', platform: '', releaseDate: it.releaseDate, releaseNote: '', languages: it.languages, genre: it.genre || '', runtime: '', certificate: '', director: it.director || '', formats: '', synopsis: '', cast, videos: [], posterUrl: '', posterId: '', bannerUrl: '', bannerId: '', trailerFileUrl: '', trailerFileId: '', order: ++maxOrder, source: source || 'Filmography import, Nov 2026', updatedAt: now };
    res.created++; res.createdTitles.push(it.title + ' ' + it.releaseDate);
    (byLoose[loose(it.title)] = byLoose[loose(it.title)] || []).push({ m: { id, data: doc }, y: String(y) });
    if (!dry) writes.push(db.doc('movies/' + id).set(doc));
  }
  window.__impRes = res; Promise.all(writes).then(() => { window.__impRes.done = true; });
  return dry ? res : { started: writes.length };
};
