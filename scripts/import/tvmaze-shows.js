// TVmaze (CC BY-SA 4.0) importer for Indian TV and web shows. Paste into the console on the live site while signed in as admin.
//   await ReelTv.preview({ minWeight: 30 })   -> builds window.__shows
//   await ReelTv.write()                       -> creates new movies/<slug> docs in the "TV shows" section (never overwrites)
// Every imported show carries srcTvmaze (its TVmaze URL); the site shows "Show details and image from TVmaze (CC BY-SA 4.0)".
(function () {
  const IL = new Set(['Hindi', 'Tamil', 'Telugu', 'Malayalam', 'Kannada', 'Bengali', 'Marathi', 'Punjabi', 'Gujarati', 'Odia', 'Assamese']);
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\(.*?\)/g, '').replace(/[^a-z0-9]/g, '');
  const slugify = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function get(url) { // TVmaze allows about 20 calls per 10 seconds
    for (let a = 0; a < 5; a++) {
      const r = await fetch(url);
      if (r.status === 429) { await sleep(4000); continue; }
      if (r.status === 404) return null;
      if (r.ok) return r.json();
      await sleep(2000);
    }
    return null;
  }
  const text = html => String(html || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
  const firstSentences = (s, n) => { const parts = s.match(/[^.!?]+[.!?]+(\s|$)/g) || [s]; return parts.slice(0, n).join('').trim(); };

  async function allIndianShows() {
    const out = [];
    for (let p = 0; p < 1000; p++) {
      const page = await get('https://api.tvmaze.com/shows?page=' + p); if (!page) break;
      page.forEach(s => {
        const c = (s.network && s.network.country && s.network.country.code) || (s.webChannel && s.webChannel.country && s.webChannel.country.code);
        if (c === 'IN' || IL.has(s.language)) out.push(s);
      });
      await sleep(550);
    }
    return out;
  }

  window.ReelTv = {
    async preview(opts) {
      const minWeight = (opts && opts.minWeight) || 30;
      const cat = await (await fetch('/catalogue.json', { cache: 'no-store' })).json();
      const tvHave = new Set(cat.movies.filter(m => m.data.section === 'TV shows' || m.data.section === 'On OTT' || m.data.seasons).map(m => norm(m.data.title)));
      const ids = new Set(cat.movies.map(m => m.id));
      const shows = (await allIndianShows()).filter(s => s.image && s.summary && !['Thai', 'Indonesian'].includes(s.language) && s.premiered && (s.weight || 0) >= minWeight && !tvHave.has(norm(s.name)));
      const out = [];
      for (const s of shows) {
        const y = s.premiered.slice(0, 4), slug = slugify(s.name) + '-' + y;
        if (!slug || ids.has(slug)) continue; ids.add(slug);
        const cast = ((await get('https://api.tvmaze.com/shows/' + s.id + '/cast')) || []).slice(0, 12)
          .filter(c => c.person && c.person.name).map(c => ({ name: c.person.name, role: (c.character && c.character.name) ? 'as ' + c.character.name : 'Cast' }));
        await sleep(550);
        const ch = (s.network && s.network.name) || (s.webChannel && s.webChannel.name) || '';
        out.push({ id: slug, data: {
          title: s.name, slug, section: 'TV shows', platform: ch, releaseDate: s.premiered,
          endYear: s.status === 'Ended' && s.ended ? s.ended.slice(0, 4) : '',
          languages: s.language && s.language !== 'English' ? s.language : (s.language || ''),
          genre: (s.genres || []).slice(0, 2).join(', '),
          runtime: s.averageRuntime || s.runtime ? 'About ' + (s.averageRuntime || s.runtime) + ' min' : '',
          synopsis: firstSentences(text(s.summary), 3),
          posterUrl: (s.image.medium || s.image.original || '').replace(/^http:/, 'https:'),
          cast, videos: [], slugHistory: [],
          tvmazeId: s.id, srcTvmaze: s.url, imdb: (s.externals && s.externals.imdb) || '',
          posterSource: 'TVmaze, CC BY-SA 4.0 (credited on the page)',
          source: 'TVmaze import (CC BY-SA 4.0), ' + new Date().toISOString().slice(0, 10), importedAt: new Date().toISOString()
        } });
      }
      window.__shows = out;
      return { matched: shows.length, toAdd: out.length, sample: out.slice(0, 2) };
    },
    async write() {
      // order keeps imports after hand-curated titles (Firestore orderBy('order') skips docs without one)
      const db = await window.claude.use('db'); const idx = m => list.indexOf(m); let ok = 0, fail = 0; const now = new Date().toISOString();
      const list = window.__shows || [];
      for (const m of list) {
        await db.doc('movies/' + m.id).get().then(s => (s && s.exists) ? null : db.doc('movies/' + m.id).set({ ...m.data, order: 200000 + idx(m), updatedAt: now })).then(() => ok++, () => fail++);
      }
      return { ok, fail };
    }
  };
})();
