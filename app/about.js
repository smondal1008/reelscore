// Plain-language summaries of a title or a person, written only from facts already in the catalogue.
// Shared by the app (window.RS_ABOUT) and the build (scripts/build.mjs evaluates this file), so the pre-rendered
// page and the app always show the same words. ES5, no dependencies.
(function (root) {
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function fmt(iso) { if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return String(iso || ''); var p = iso.split('-'); return (+p[2]) + ' ' + MONTHS[+p[1] - 1] + ' ' + p[0]; }
  function list(a) { a = a.filter(Boolean); return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
  function art(w) { return /^[aeiou]/i.test(w) ? 'an' : 'a'; }
  function clip(s, n) { s = String(s || '').replace(/\s+/g, ' ').trim(); if (s.length <= n) return s; var c = s.slice(0, n - 1); return c.slice(0, Math.max(c.lastIndexOf(' '), n - 20)).replace(/[,;:.\s]+$/, '') + '…'; }
  function splitNames(v) { return String(v || '').split(/\s*,\s*|\s+and\s+/).map(function (x) { return x.trim(); }).filter(Boolean); }
  function langs(v) { return String(v || '').split(/\s*[,;]\s*/).map(function (x) { return x.trim(); }).filter(Boolean); }
  var CREW_RE = /(director|producer|music|writer|screenplay|composer|cinematograph|editor)/i;
  var SKIP_ROLE = /^(cast|actor|actress|self)$/i;

  // t: { title, tv, date, year, upcoming, released, languages, genre, runtime, certificate, seasons, endYear, platform,
  //      director, cast: [{name, role}], verdicts: {pct, tot} }
  function title(t) {
    var s = [], T = t.title, kind = t.tv ? 'series' : 'film';
    var L = langs(t.languages), g = String(t.genre || '').replace(/\s*[,/]\s*/g, ', ').toLowerCase();
    g = g ? list(g.split(', ')) : '';
    var desc = [L.length ? list(L) : '', g, kind].filter(Boolean).join(' ');
    var when = '';
    if (t.tv) { if (t.year) when = ' that first aired in ' + t.year + (/^\d{4}$/.test(String(t.endYear || '')) && String(t.endYear) !== String(t.year) ? ' and ran until ' + t.endYear : ''); }
    else if (/^\d{4}-\d{2}-\d{2}$/.test(t.date || '')) when = (t.upcoming ? ' scheduled for release on ' : ' released on ') + fmt(t.date);
    else if (t.year) when = ' from ' + t.year;
    s.push(T + ' is ' + art(desc) + ' ' + desc + when + '.');
    var run = String(t.runtime || '').trim(), cert = String(t.certificate || '').trim();
    if (t.tv && +t.seasons > 0) s.push('It has ' + (+t.seasons) + ' season' + (+t.seasons === 1 ? '' : 's') + (run ? ', with episodes of about ' + run : '') + '.');
    else if (run && cert) s.push('It runs ' + run + ' and is certified ' + cert + '.');
    else if (run) s.push('It runs ' + run + '.');
    if (cert && (t.tv || !run)) s.push('It is certified ' + cert + '.');
    var dirs = splitNames(t.director);
    if (dirs.length) s.push((t.tv ? 'It is created by ' : 'It is directed by ') + list(dirs.slice(0, 3)) + '.');
    var cast = (t.cast || []).filter(function (c) { return c && c.name; });
    var actors = cast.filter(function (c) { return !CREW_RE.test(c.role || ''); });
    var crew = cast.filter(function (c) { return CREW_RE.test(c.role || '') && dirs.indexOf(c.name) === -1; });
    if (actors.length) {
      var lead = actors.slice(0, 3).map(function (c) { var r = String(c.role || '').trim(); return c.name + (r && !SKIP_ROLE.test(r) ? ' as ' + r : ''); });
      var more = actors.slice(3, 9).map(function (c) { return c.name; });
      s.push((actors.length === 1 ? 'It stars ' : 'The cast is led by ') + list(lead) + (more.length ? ', with ' + list(more) + ' also in the cast' : '') + '.');
    }
    if (crew.length) s.push('The crew includes ' + list(crew.slice(0, 4).map(function (c) { return c.name + ' (' + String(c.role).toLowerCase() + ')'; })) + '.');
    if (t.platform) s.push(t.released ? 'Reelscore lists it on ' + t.platform + '.' : 'It is set to come to ' + t.platform + '.');
    var v = t.verdicts || {};
    if (v.tot) s.push('On Reelscore, ' + v.pct + '% of ' + v.tot + ' viewer verdict' + (v.tot === 1 ? ' is' : 's are') + ' positive.');
    else s.push(t.released || t.tv ? 'No one has given it a verdict on Reelscore yet.' : 'Verdicts open on Reelscore once it is out.');
    return s.join(' ');
  }

  // People who share the most titles with a person. movies: [{cast: [{name, role}], director}]; slug: name → key.
  function collaborators(self, movies, slug) {
    var co = {}, dir = {};
    movies.forEach(function (m) {
      var seen = {};
      splitNames(m.director).forEach(function (n) { var k = slug(n); if (!k || k === self || seen[k]) return; seen[k] = 1; (dir[k] = dir[k] || { name: n, n: 0 }).n++; });
      (m.cast || []).slice(0, 10).forEach(function (c) { var k = slug(c && c.name); if (!k || k === self || seen[k] || CREW_RE.test(c.role || '')) return; seen[k] = 1; (co[k] = co[k] || { name: c.name, n: 0 }).n++; });
    });
    var top = function (o, n) { return Object.keys(o).map(function (k) { return { slug: k, name: o[k].name, n: o[k].n }; }).sort(function (a, b) { return b.n - a.n || a.name.localeCompare(b.name); }).slice(0, n); };
    return { costars: top(co, 8), directors: top(dir, 4) };
  }

  // p: { name, titles: [{title, year, date, languages, genre, tv, acting, crew, roles, upcoming}] (newest first),
  //      collab: result of collaborators() }
  function person(p) {
    var s = [], N = p.name, ts = p.titles || [], n = ts.length;
    var years = ts.map(function (t) { return String(t.year || ''); }).filter(function (y) { return /^\d{4}$/.test(y); }).sort();
    s.push(N + ' has ' + n + ' title' + (n === 1 ? '' : 's') + ' on Reelscore' + (years.length && years[0] !== years[years.length - 1] ? ', from ' + years[0] + ' to ' + years[years.length - 1] : years.length ? ', from ' + years[0] : '') + '.');
    var out = ts.filter(function (t) { return !t.upcoming && t.year; });
    if (out.length > 1) {
      var first = out[out.length - 1], last = out[0];
      s.push('The earliest listed here is ' + first.title + ' (' + first.year + ') and the most recent is ' + last.title + ' (' + last.year + ').');
    } else if (out.length === 1) s.push('The title listed here is ' + out[0].title + ' (' + out[0].year + ').');
    var soon = ts.filter(function (t) { return t.upcoming; });
    if (soon.length) s.push('Upcoming: ' + list(soon.slice(0, 3).map(function (t) { return t.title + (/^\d{4}-\d{2}-\d{2}$/.test(t.date || '') ? ' (' + fmt(t.date) + ')' : ''); })) + '.');
    var lc = {}; ts.forEach(function (t) { var l = langs(t.languages)[0]; if (l) lc[l] = (lc[l] || 0) + 1; });
    var lk = Object.keys(lc).sort(function (a, b) { return lc[b] - lc[a] || a.localeCompare(b); });
    if (lk.length === 1 && n > 1) s.push('All of them are in ' + lk[0] + '.');
    else if (lk.length > 1) s.push(lc[lk[0]] * 2 > n ? 'Most are in ' + lk[0] + ' (' + lc[lk[0]] + ' of ' + n + '), with others in ' + list(lk.slice(1, 4)) + '.' : 'They span ' + list(lk.slice(0, 4).map(function (l) { return l + ' (' + lc[l] + ')'; })) + '.');
    var gc = {}; ts.forEach(function (t) { String(t.genre || '').toLowerCase().split(/\s*[,/]\s*/).forEach(function (g) { g = g.trim(); if (g) gc[g] = (gc[g] || 0) + 1; }); });
    var gk = Object.keys(gc).filter(function (g) { return gc[g] >= 2; }).sort(function (a, b) { return gc[b] - gc[a] || a.localeCompare(b); }).slice(0, 3);
    if (gk.length) s.push('The most common genre' + (gk.length > 1 ? 's are ' : ' is ') + list(gk) + '.');
    var act = ts.filter(function (t) { return t.acting; }).length, roles = {};
    ts.forEach(function (t) { (t.roles || []).forEach(function (r) { if (CREW_RE.test(r)) roles[r.toLowerCase()] = 1; }); });
    var rk = Object.keys(roles).slice(0, 4);
    if (act && rk.length) s.push(act + ' of these are acting credits; the rest are behind the camera, as ' + list(rk) + '.');
    else if (!act && rk.length) s.push('These credits are behind the camera, as ' + list(rk) + '.');
    var c = p.collab || { costars: [], directors: [] };
    var cs = c.costars.filter(function (x) { return x.n >= 2; }).slice(0, 4), ds = c.directors.filter(function (x) { return x.n >= 2; }).slice(0, 3);
    if (ds.length) s.push('The directors seen most often in this list are ' + list(ds.map(function (x) { return x.name + ' (' + x.n + ' titles)'; })) + '.');
    if (cs.length) s.push('Frequent co-stars include ' + list(cs.map(function (x) { return x.name + ' (' + x.n + ')'; })) + '.');
    else if (c.costars.length) s.push('Co-stars here include ' + list(c.costars.slice(0, 4).map(function (x) { return x.name; })) + '.');
    return s.join(' ');
  }

  // Up to 3 titles to describe a person by: released, with a story, most recent first, acting work preferred.
  function knownFor(titles) {
    var ok = titles.filter(function (t) { return !t.upcoming && t.synopsis; });
    var a = ok.filter(function (t) { return t.acting; });
    return (a.length ? a : ok).slice(0, 3).map(function (t) { return { t: t, line: clip(t.synopsis, 170) }; });
  }

  root.RS_ABOUT = { title: title, person: person, collaborators: collaborators, knownFor: knownFor };
})(typeof window !== 'undefined' ? window : this);
