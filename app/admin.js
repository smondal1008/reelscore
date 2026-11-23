
window.ReelAdmin = function (env) {
  var SECTIONS = ['In theatres', 'Coming soon', 'On OTT', 'Older releases', 'TV shows'];
  var FILTERS = ['All', 'In theatres', 'Coming soon', 'On OTT', 'Older releases', 'TV shows', 'Missing info', 'Missing photos', 'Missing posters', 'Missing trailers', 'Missing synopsis'];
  var VIDEO_KINDS = ['Trailer', 'Teaser', 'Promo', 'Song', 'Episode', 'Clip', 'Interview'];
  var REQUIRED = [
    ['synopsis', 'Synopsis'], ['releaseDate', 'Release date'], ['languages', 'Languages'], ['genre', 'Genre'],
    ['runtime', 'Runtime'], ['certificate', 'Certificate'], ['posterUrl', 'Poster'], ['bannerUrl', 'Banner']
  ];

  var db = null, assets = null, canWrite = true, canUpload = false;
  var movies = [];          // [{id, data}]
  var bkRefresh = null; // relabels the partner switcher as names and links are edited
  var bkTab = { id: null, i: 0 }; // which booking partner the Buy tickets switcher shows
  var linksOpenFor = null;  // the title whose folded Buy tickets card was opened
  var currentId = null;
  var draft = null;         // working copy of current movie
  var dirty = false;
  var saving = false;
  var filter = 'All', missF = [], fieldF = [], query = '', langF = '', yearF = '', seoF = '', statusF = 'published', seoVotes = null, sortKey = 'release', sortDir = 'desc', pageNo = 1, PAGE = 50;
  var pendingSwitch = null; // unused since titles open on their own page
  var page = 'titles', wantSlug = null, go = function (u) { location.href = u; };
  var featuredMode = false, featured = [], featLoaded = false, featWriting = false;
  var popularMode = false, popOrder = [], popLoaded = false, popWriting = false, popDragging = false, popVerdicts = null, popShowAll = false;
  var peopleMode = false, people = {}, peopleQ = '', peopleMissingOnly = false, peopleFilter = 'all', peoplePage = 1, PEOPLE_PAGE = 50, dupCache = { sig: null, map: {} };
  function personKey(name) { return (name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80); }
  function personPhoto(name) { var p = people[personKey(name)]; return p && safeUrl(p.photoUrl) ? p.photoUrl : ''; }
  function pickPhoto(name, btn) {
    if (!canUpload) { setStatus('Uploads need editor access.'); return; }
    if (!personKey(name)) { setStatus('Type the person’s name first.'); return; }
    var fi = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', class: 'sr' });
    document.body.appendChild(fi);
    fi.addEventListener('change', function () {
      var f = fi.files[0]; fi.remove();
      if (!f) return;
      if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { setStatus('Use a PNG, JPEG or WebP image.'); return; }
      if (f.size > 10 * 1024 * 1024) { setStatus('That image is over 10 MB.'); return; }
      if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }
      setStatus('Uploading photo of ' + name + '…');
      assets.upload(f).then(function (res) {
        return db.doc('people/' + personKey(name)).set({ name: (people[personKey(name)] && people[personKey(name)].name) || name.trim(), photoUrl: res.url, photoId: res.id, updatedAt: new Date().toISOString() }, { merge: true });
      }).then(function () { setStatus('Photo saved for ' + name + '. It now shows on every title they’re in.'); })
        .catch(function (e) { setStatus('Couldn’t save the photo' + (e && e.message ? ': ' + e.message : '') + '.'); })
        .then(function () { if (btn) { btn.disabled = false; btn.removeAttribute('aria-busy'); } });
    });
    fi.click();
  }
  var POP_OPTS = [['', 'Popular: automatic'], ['pin', 'Popular: always'], ['hide', 'Popular: never']];
  function setPopular(key, name, v) {
    var body = { popular: v === 'hide' ? 'hide' : '', updatedAt: new Date().toISOString() }; if (!people[key]) body.name = name;
    var order = pinnedKeys().filter(function (k) { return k !== key; }); if (v === 'pin') order.push(key);
    var p1 = writePopOrder(order), p2 = (v === 'hide' || (people[key] && people[key].popular)) ? db.doc('people/' + key).set(body, { merge: true }) : Promise.resolve();
    return Promise.all([p1, p2]).then(function () { setStatus(name + (v === 'pin' ? ' will always show in Popular.' : v === 'hide' ? ' won’t show in Popular.' : ' is back to automatic for Popular.')); })
      .catch(function (e) { setStatus('Couldn’t save' + (e && e.message ? ': ' + e.message : '') + '.'); });
  }
  // ---------- popular cast (settings/popular.order = pinned people, in order; people/<key>.popular = 'hide' keeps someone out) ----------
  function pinnedKeys() {
    var out = popOrder.slice();
    Object.keys(people).forEach(function (k) { if (people[k].popular === 'pin' && out.indexOf(k) === -1) out.push(k); }); // older per-person pins
    return out.filter(function (k) { return !(people[k] && people[k].popular === 'hide'); });
  }
  function popState(k) { return pinnedKeys().indexOf(k) !== -1 ? 'pin' : (people[k] && people[k].popular === 'hide') ? 'hide' : ''; }
  // Visitors load the catalogue from a file built at deploy time; this list tells them about deletions since then.
  function tombstone(kind, id) {
    var ref = db.doc('settings/deleted');
    return ref.get().then(function (s) {
      var d = s.exists ? s.data() : {}, now = new Date().toISOString();
      var body = { movies: d.movies || [], people: d.people || [], updatedAt: now };
      body[kind] = body[kind].filter(function (x) { return x && x.id !== id; }).concat([{ id: id, at: now }]).slice(-500);
      return ref.set(body);
    }).catch(function () {});
  }
  function writePopOrder(next) {
    popWriting = true; popOrder = next.slice(); renderPopCount(); if (popularMode) renderPopular();
    return db.doc('settings/popular').set({ order: next, updatedAt: new Date().toISOString() }).then(function () {
      popWriting = false;
      // older per-person pins now live in the list; clear them so there is one source of truth
      Object.keys(people).forEach(function (k) { if (people[k].popular === 'pin') db.doc('people/' + k).set({ popular: '' }, { merge: true }); });
    }).catch(function (e) { popWriting = false; setStatus('Couldn’t save the Popular list' + (e && e.message ? ': ' + e.message : '') + '.'); });
  }
  function renderPopCount() { var el = $('popCount'); if (el) el.textContent = popLoaded ? String(pinnedKeys().length) : ''; }
  // Same ranking as the People page: billing, recent work, verdicts, photo.
  function autoPopular() {
    var CREW = /(director|producer|music|writer|screenplay|composer|cinematograph|editor)/i;
    var td = new Date(), today = td.getFullYear() + '-' + String(td.getMonth() + 1).padStart(2, '0') + '-' + String(td.getDate()).padStart(2, '0');
    var cutoff = String(td.getFullYear() - 2), idx = {};
    movies.forEach(function (m) {
      var d = m.data, cast = d.cast || [], seen = {};
      var up = d.releaseDate ? d.releaseDate > today : d.section === 'Coming soon';
      var fresh = (d.releaseDate || '') >= cutoff || up ? 1.5 : 1, buzz = 1 + Math.min((popVerdicts && popVerdicts[m.id]) || 0, 50) / 25, ai = 0;
      function add(name, w, crew) {
        var k = personKey(name); if (!k) return;
        var p = idx[k] || (idx[k] = { key: k, name: name.trim(), pop: 0, n: 0, acting: false });
        if (!crew) p.acting = true;
        if (seen[k]) return; seen[k] = 1; p.n++; p.pop += w;
      }
      cast.forEach(function (c) {
        if (!(c.name || '').trim()) return;
        var crew = CREW.test(c.role || ''), bill = crew ? (/direct|music|composer/i.test(c.role) ? 2 : 1) : (ai < 3 ? 4 : ai < 6 ? 2 : 1);
        if (!crew) ai++; add(c.name, bill * fresh * buzz, crew);
      });
      String(d.director || '').split(/,| and /).forEach(function (x) { x = x.trim(); if (x) add(x, 2 * fresh * buzz, true); });
    });
    return Object.keys(idx).map(function (k) { var p = idx[k]; if (people[k] && people[k].name) p.name = people[k].name; if (personPhoto(p.name)) p.pop *= 1.2; return p; })
      .sort(function (a, b) { return b.pop - a.pop || a.name.localeCompare(b.name); });
  }
  function renderPopular() {
    var main = $('main'); main.innerHTML = '';
    if (!popVerdicts) {
      popVerdicts = {};
      db.collection('verdicts').get().then(function (snap) { var c = {}; snap.docs.forEach(function (d) { var v = (d.data() || {}).v || {}; Object.keys(v).forEach(function (id) { c[id] = (c[id] || 0) + 1; }); }); popVerdicts = c; if (popularMode && !popDragging) renderPopular(); }).catch(function () {});
    }
    var TOTAL = 120, ranked = autoPopular(), byKey = {}; ranked.forEach(function (p) { byKey[p.key] = p; });
    var pins = pinnedKeys(), hidden = Object.keys(people).filter(function (k) { return people[k].popular === 'hide'; });
    function nameOf(k) { return (people[k] && people[k].name) || (byKey[k] && byKey[k].name) || k; }
    function meta(k) { var p = byKey[k]; return p ? p.n + (p.n === 1 ? ' title' : ' titles') : 'Not on any title yet'; }
    var autoList = ranked.filter(function (p) { return pins.indexOf(p.key) === -1 && hidden.indexOf(p.key) === -1; }).slice(0, Math.max(0, TOTAL - pins.length));
    var rowStyle = 'display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:8px 10px;border:1px solid var(--line);border-radius:12px;background:var(--bg)';
    var head = h('section', { class: 'card' }, [
      h('div', { class: 'head' }, [h('div', {}, [h('div', { class: 'sub', text: 'People page · Popular' }), h('h1', { text: 'Popular cast' })]),
        h('div', { class: 'sub', text: pins.length + ' added by hand · ' + Math.min(TOTAL, pins.length + autoList.length) + ' shown in total' })]),
      h('div', { class: 'note', text: 'Popular on the People page shows the people you add here first, in this order, then fills the rest of the ' + TOTAL + ' places automatically by billing, recent work and audience verdicts. Drag rows (or use ↑ ↓) to reorder. Hidden people never appear in Popular.' })
    ]);
    // add someone
    var addIn = h('input', { class: 'in', id: 'popAdd', list: 'peopleNames', placeholder: 'Type a name…', autocomplete: 'off', disabled: !canWrite });
    namesDatalist();
    var addMsg = h('div', { class: 'err', hidden: true });
    function doAdd() {
      var k = personKey(addIn.value); addMsg.hidden = true;
      if (!k) { addMsg.hidden = false; addMsg.textContent = 'Type a name first.'; return; }
      var known = people[k] || byKey[k] || allPeople().some(function (p) { return p.key === k; });
      if (!known) { addMsg.hidden = false; addMsg.textContent = 'No one called “' + addIn.value.trim() + '” on Reelscore yet. Pick a name from the list.'; return; }
      if (pins.indexOf(k) !== -1) { addMsg.hidden = false; addMsg.textContent = nameOf(k) + ' is already in the list.'; return; }
      setPopular(k, nameOf(k), 'pin'); addIn.value = '';
    }
    addIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } });
    head.appendChild(h('div', { class: 'field' }, [h('label', { class: 'l', for: 'popAdd', text: 'Add someone to Popular' }),
      h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' }, [h('span', { style: 'flex:1;min-width:220px' }, [addIn]), h('button', { type: 'button', class: 'btn primary', text: 'Add to Popular', disabled: !canWrite, on: { click: doAdd } })]), addMsg]));
    main.appendChild(head);

    // pinned, draggable
    var pinCard = h('section', { class: 'card' }, [h('div', { class: 'head' }, [h('h2', { text: 'Added by hand · shown first' }), h('span', { class: 'sub', text: pins.length ? 'Drag to reorder' : '' })])]);
    var list = h('div', { class: 'rows', id: 'popPins' });
    if (!pins.length) list.appendChild(h('div', { class: 'empty', style: 'padding:20px', text: 'No one added yet. Add someone above, or use Pin on an automatic pick below.' }));
    function move(from, to) { if (to < 0 || to >= pins.length || from === to) return; var n = pins.slice(), x = n.splice(from, 1)[0]; n.splice(to, 0, x); writePopOrder(n).then(function () { setStatus('Order saved'); }); }
    var dragFrom = null;
    pins.forEach(function (k, i) {
      var nm = nameOf(k);
      var row = h('div', { class: 'poprow', draggable: canWrite ? 'true' : 'false', 'data-i': String(i), style: rowStyle + ';cursor:' + (canWrite ? 'grab' : 'default') }, [
        h('span', { 'aria-hidden': 'true', style: 'color:var(--dim);font-size:18px;letter-spacing:-2px;user-select:none', text: '⋮⋮' }),
        h('span', { style: 'font-family:Anton,Impact,sans-serif;font-size:20px;width:28px;text-align:center;color:var(--accent)', text: String(i + 1) }),
        avatarBtn(nm, 44),
        h('span', { style: 'flex:1;min-width:160px' }, [h('div', { style: 'font-weight:600', text: nm }), h('div', { class: 'note', text: meta(k) })]),
        h('span', { style: 'display:flex;gap:6px' }, [
          h('button', { type: 'button', class: 'btn small', 'aria-label': 'Move ' + nm + ' up', text: '↑', disabled: i === 0 || !canWrite, on: { click: function () { move(i, i - 1); } } }),
          h('button', { type: 'button', class: 'btn small', 'aria-label': 'Move ' + nm + ' down', text: '↓', disabled: i === pins.length - 1 || !canWrite, on: { click: function () { move(i, i + 1); } } }),
          h('button', { type: 'button', class: 'btn small danger', text: 'Remove', disabled: !canWrite, on: { click: function () { setPopular(k, nm, ''); } } })
        ])
      ]);
      row.addEventListener('dragstart', function (e) { dragFrom = i; popDragging = true; row.style.opacity = '.4'; try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); } catch (x) {} });
      row.addEventListener('dragend', function () { row.style.opacity = ''; popDragging = false; list.querySelectorAll('.poprow').forEach(function (r) { r.style.boxShadow = ''; }); });
      row.addEventListener('dragover', function (e) { if (dragFrom === null) return; e.preventDefault(); var r = row.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2; list.querySelectorAll('.poprow').forEach(function (x) { x.style.boxShadow = ''; }); row.style.boxShadow = after ? '0 3px 0 var(--accent)' : '0 -3px 0 var(--accent)'; });
      row.addEventListener('drop', function (e) {
        e.preventDefault(); if (dragFrom === null) return;
        var r = row.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2, to = i + (after ? 1 : 0);
        if (dragFrom < to) to--;
        var f = dragFrom; dragFrom = null; popDragging = false; move(f, to);
      });
      list.appendChild(row);
    });
    pinCard.appendChild(list); main.appendChild(pinCard);

    // automatic picks
    var autoCard = h('section', { class: 'card' }, [h('div', { class: 'head' }, [h('h2', { text: 'Filled automatically · next ' + autoList.length }), h('span', { class: 'sub', text: 'Pin to move someone into your list' })])]);
    var al = h('div', { class: 'rows' });
    (popShowAll ? autoList : autoList.slice(0, 30)).forEach(function (p, i) {
      al.appendChild(h('div', { style: rowStyle }, [
        h('span', { style: 'width:28px;text-align:center;color:var(--muted);font-weight:700', text: String(pins.length + i + 1) }),
        avatarBtn(p.name, 36),
        h('span', { style: 'flex:1;min-width:160px' }, [h('div', { style: 'font-weight:600', text: p.name }), h('div', { class: 'note', text: p.n + (p.n === 1 ? ' title' : ' titles') + (p.acting ? '' : ' · crew') })]),
        h('span', { style: 'display:flex;gap:6px' }, [
          h('button', { type: 'button', class: 'btn small', text: 'Pin', disabled: !canWrite, on: { click: function () { setPopular(p.key, p.name, 'pin'); } } }),
          h('button', { type: 'button', class: 'btn small', text: 'Hide', disabled: !canWrite, on: { click: function () { setPopular(p.key, p.name, 'hide'); } } })
        ])
      ]));
    });
    autoCard.appendChild(al);
    if (autoList.length > 30) autoCard.appendChild(h('button', { type: 'button', class: 'btn small', style: 'margin-top:10px', text: popShowAll ? 'Show fewer' : 'Show all ' + autoList.length, on: { click: function () { popShowAll = !popShowAll; renderPopular(); } } }));
    main.appendChild(autoCard);

    // hidden
    var hidCard = h('section', { class: 'card' }, [h('div', { class: 'head' }, [h('h2', { text: 'Hidden from Popular' + (hidden.length ? ' · ' + hidden.length : '') })])]);
    var hl = h('div', { class: 'rows' });
    if (!hidden.length) hl.appendChild(h('div', { class: 'note', text: 'No one hidden. Use Hide on an automatic pick to keep someone out of Popular.' }));
    hidden.forEach(function (k) {
      var nm = nameOf(k);
      hl.appendChild(h('div', { style: rowStyle }, [avatarBtn(nm, 36), h('span', { style: 'flex:1;min-width:160px' }, [h('div', { style: 'font-weight:600', text: nm }), h('div', { class: 'note', text: meta(k) })]),
        h('button', { type: 'button', class: 'btn small', text: 'Unhide', disabled: !canWrite, on: { click: function () { setPopular(k, nm, ''); } } })]));
    });
    hidCard.appendChild(hl); main.appendChild(hidCard);
  }
  function removePhoto(name) {
    db.doc('people/' + personKey(name)).set({ photoUrl: '', photoId: '', updatedAt: new Date().toISOString() }, { merge: true }).then(function () { setStatus('Photo removed for ' + name + '.'); }).catch(function () { setStatus('Couldn’t remove the photo.'); });
  }
  function avatarBtn(name, size) {
    var url = personPhoto(name);
    var b = h('button', { type: 'button', class: 'pav' + (url ? ' has' : ''), 'data-pkey': personKey(name), style: (size ? 'width:' + size + 'px;height:' + size + 'px;' : '') + bgUrl(url),
      'aria-label': (url ? 'Change photo of ' : 'Add photo of ') + (name || 'this person'), title: url ? 'Change photo' : 'Add photo', text: url ? '' : '📷', disabled: !canUpload });
    b.addEventListener('click', function () { pickPhoto(b._name || name, b); });
    b._name = name;
    return b;
  }
  function refreshAvatars() {
    document.querySelectorAll('#view-admin [data-pkey]').forEach(function (b) {
      var url = personPhoto(b._name || ''); b.setAttribute('style', (b.style.width ? 'width:' + b.style.width + ';height:' + b.style.height + ';' : '') + bgUrl(url));
      b.classList.toggle('has', !!url); b.textContent = url ? '' : '📷';
    });
  }
  function allPeople() {
    var map = {};
    movies.forEach(function (m) { (m.data.cast || []).forEach(function (c) {
      var k = personKey(c.name); if (!k) return;
      if (!map[k]) map[k] = { name: c.name.trim(), titles: [] };
      if (map[k].titles.indexOf(m.data.title) === -1) map[k].titles.push(m.data.title);
    }); });
    Object.keys(people).forEach(function (k) { if (!map[k] && people[k].name) map[k] = { name: people[k].name, titles: [] }; });
    return Object.keys(map).map(function (k) { return { key: k, name: map[k].name, titles: map[k].titles }; })
      .sort(function (a, b) { return b.titles.length - a.titles.length || a.name.localeCompare(b.name); });
  }
  function renderPeopleCount() {
    var el = $('peopleCount'); if (!el) return;
    var list = allPeople(), withPhoto = list.filter(function (p) { return personPhoto(p.name); }).length;
    el.textContent = String(list.length); el.title = withPhoto + ' with photos';
  }
  // ---------- cast & crew directory ----------
  function compactKey(name) { return personKey(name).replace(/-/g, ''); }
  function editDistance(a, b) {
    if (Math.abs(a.length - b.length) > 3) return 99;
    var prev = [], cur, i, j; for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) { cur = [i]; for (j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
    return prev[b.length];
  }
  function similarPeople(name, list, exceptKey) {
    var a = compactKey(name); if (a.length < 4) return [];
    return (list || allPeople()).filter(function (p) {
      if (p.key === exceptKey || p.key === personKey(name)) return false;
      var b = compactKey(p.name); if (!b) return false;
      if (a === b) return true;
      var lim = Math.min(a.length, b.length) >= 10 ? 2 : 1;
      if (Math.abs(a.length - b.length) <= lim && editDistance(a, b) <= lim) return true;
      var lo = a.length < b.length ? a : b, hi = a.length < b.length ? b : a;
      return lo.length >= 6 && hi.indexOf(lo) !== -1 && hi.length - lo.length <= 4;
    });
  }
  // Same matching rules as similarPeople, but for everyone at once: each compact key is worked out once,
  // and names are only compared with others of a similar length.
  function findDupes(list) {
    // Index-based, so it stays fast with thousands of people. Matches similarPeople's rules:
    // same compact key, an edit distance of 1 (2 for names of 10+ letters), or one name inside the other.
    var items = list.map(function (p) { return { p: p, c: compactKey(p.name) }; }).filter(function (x) { return x.c.length >= 3; });
    var dels = {}, subs = {}, out = {}, seen = {};
    function dropOne(set, w) { for (var i = 0; i < w.length; i++) set[w.slice(0, i) + w.slice(i + 1)] = 1; }
    function variants(w) {
      var v = {}; v[w] = 1; dropOne(v, w);
      if (w.length >= 10) Object.keys(v).forEach(function (x) { if (x.length === w.length - 1) dropOne(v, x); });
      return Object.keys(v);
    }
    items.forEach(function (x, i) {
      variants(x.c).forEach(function (v) { (dels[v] = dels[v] || []).push(i); });
      for (var L = Math.max(6, x.c.length - 4); L < x.c.length; L++) for (var st = 0; st + L <= x.c.length; st++) {
        var sub = x.c.substr(st, L); (subs[sub] = subs[sub] || {})[i] = 1;
      }
    });
    function link(i, j) {
      if (i === j) return; var k = i < j ? i + ',' + j : j + ',' + i; if (seen[k]) return; seen[k] = 1;
      var A = items[i], B = items[j]; if (A.p.key === B.p.key) return;
      var a = A.c, b = B.c, hit = a === b;
      if (!hit) { var lim = Math.min(a.length, b.length) >= 10 ? 2 : 1; hit = Math.abs(a.length - b.length) <= lim && editDistance(a, b) <= lim; }
      if (!hit) { var lo = a.length < b.length ? a : b, hi = a.length < b.length ? b : a; hit = lo.length >= 6 && hi.indexOf(lo) !== -1 && hi.length - lo.length <= 4; }
      if (hit) { if (a.length >= 4) (out[A.p.key] = out[A.p.key] || []).push(B.p); if (b.length >= 4) (out[B.p.key] = out[B.p.key] || []).push(A.p); }
    }
    Object.keys(dels).forEach(function (v) { var g = dels[v]; if (g.length > 1) for (var x = 0; x < g.length; x++) for (var y = x + 1; y < g.length; y++) link(g[x], g[y]); });
    items.forEach(function (x, i) { var hs = subs[x.c]; if (hs) Object.keys(hs).forEach(function (j) { link(i, +j); }); });
    return out;
  }
  function personPageUrl(key) { return location.origin + '/person/' + key; }
  function namesDatalist() {
    var dl = $('peopleNames');
    if (!dl) { dl = h('datalist', { id: 'peopleNames' }); document.body.appendChild(dl); }
    dl.innerHTML = '';
    allPeople().forEach(function (p) { dl.appendChild(h('option', { value: p.name })); });
    return dl;
  }
  // Rename everywhere: every title's cast entry for oldKey becomes newName; the people record moves too.
  function renamePerson(oldKey, newName, opts) {
    opts = opts || {};
    newName = (newName || '').trim(); var newKey = personKey(newName);
    if (!newKey) return Promise.reject(new Error('Enter a name.'));
    var jobs = [];
    movies.forEach(function (m) {
      var cast = (m.data.cast || []), hit = false;
      var next = cast.map(function (c) { if (personKey(c.name) === oldKey) { hit = true; return { name: newName, role: c.role || '' }; } return c; });
      if (!hit) return;
      // drop a duplicate row if the title already had the target person with the same role
      var seen = {}; next = next.filter(function (c) { var k = personKey(c.name) + '|' + (c.role || ''); if (seen[k]) return false; seen[k] = 1; return true; });
      jobs.push(db.doc('movies/' + m.id).update({ cast: next, updatedAt: new Date().toISOString() }));
    });
    var from = people[oldKey], to = people[newKey];
    if (oldKey !== newKey) {
      var merged = { name: (to && to.name) || newName, updatedAt: new Date().toISOString() };
      ['photoUrl', 'photoId', 'bio', 'birthday', 'birthplace', 'gender', 'popular'].forEach(function (f) { var v = (to && to[f]) || (from && from[f]) || ''; if (v) merged[f] = v; });
      ['aka'].forEach(function (f) { var v = (to && to[f] && to[f].length ? to[f] : (from && from[f]) || []); if (v.length) merged[f] = v; });
      if (from && from.name && personKey(from.name) !== newKey) { var ak = (merged.aka || []).slice(); if (ak.indexOf(from.name) === -1) ak.push(from.name); merged.aka = ak.slice(0, 10); }
      if (from || to) jobs.push(db.doc('people/' + newKey).set(merged, { merge: true }));
      if (from) jobs.push(db.doc('people/' + oldKey).delete().then(function () { return tombstone('people', oldKey); }));
      var oi = popOrder.indexOf(oldKey);
      if (oi !== -1) { var no = popOrder.slice(); if (no.indexOf(newKey) === -1) no[oi] = newKey; else no.splice(oi, 1); jobs.push(writePopOrder(no)); }
    } else if (from) jobs.push(db.doc('people/' + newKey).set({ name: newName, updatedAt: new Date().toISOString() }, { merge: true }));
    return Promise.all(jobs).then(function () { return jobs.length; });
  }
  // Add / edit a person: name, short bio, photo. opts: { name, key (existing), onSaved(name) }
  function openPersonForm(opts) {
    opts = opts || {};
    var existing = opts.key ? people[opts.key] || {} : {};
    var startName = opts.key ? (existing.name || opts.name || '') : (opts.name || '');
    var back = h('div', { style: 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:50;display:flex;align-items:center;justify-content:center;padding:16px' });
    var nameIn = h('input', { class: 'in', id: 'pf_name', placeholder: 'Full name as credited', autocomplete: 'off' }); nameIn.value = startName;
    var bioIn = h('textarea', { class: 'in', id: 'pf_bio', rows: 4, placeholder: 'Optional. One or two lines, e.g. “Hindi film actor known for…”' }); bioIn.value = existing.bio || '';
    var bdayIn = h('input', { class: 'in', id: 'pf_bday', type: 'date', min: '1880-01-01', max: new Date().toISOString().slice(0, 10) }); bdayIn.value = existing.birthday || '';
    var bplaceIn = h('input', { class: 'in', id: 'pf_bplace', maxlength: 120, placeholder: 'e.g. Kotagiri, Tamil Nadu, India' }); bplaceIn.value = existing.birthplace || '';
    var genderIn = h('select', { class: 'in', id: 'pf_gender' }, [['', 'Not set'], ['Female', 'Female'], ['Male', 'Male'], ['Non-binary', 'Non-binary']].map(function (o) { return h('option', { value: o[0], text: o[1], selected: (existing.gender || '') === o[0] }); }));
    var popIn = h('select', { class: 'in', id: 'pf_pop' }, POP_OPTS.map(function (o) { return h('option', { value: o[0], text: o[1].replace('Popular: ', '').replace(/^./, function (c) { return c.toUpperCase(); }), selected: (opts.key ? popState(opts.key) : '') === o[0] }); }));
    var akaIn = h('input', { class: 'in', id: 'pf_aka', placeholder: 'Other spellings or names, separated by commas' }); akaIn.value = (existing.aka || []).join(', ');
    var photo = { url: safeUrl(existing.photoUrl) || '', id: existing.photoId || '' };
    var pv = h('div', { style: 'width:96px;height:96px;border-radius:50%;background:#2E2A38 center top/cover no-repeat;flex:0 0 auto;' + bgUrl(photo.url) });
    var msg = h('div', { class: 'err', hidden: true }), warn = h('div', { class: 'warn', hidden: true });
    var url = h('div', { class: 'note' });
    function check() {
      var k = personKey(nameIn.value); url.textContent = k ? 'Page: ' + personPageUrl(k) : '';
      warn.hidden = true; warn.innerHTML = '';
      if (!k) return;
      if (!opts.key && (people[k] || allPeople().some(function (p) { return p.key === k; }))) { warn.hidden = false; warn.textContent = 'This person already exists. Saving will update their details.'; return; }
      var sim = similarPeople(nameIn.value, null, opts.key);
      if (sim.length) {
        warn.hidden = false; warn.appendChild(document.createTextNode('Similar name already listed: '));
        sim.slice(0, 3).forEach(function (p, i) {
          if (i) warn.appendChild(document.createTextNode(', '));
          warn.appendChild(h('button', { type: 'button', class: 'btn small', style: 'height:28px;margin:2px 0', text: 'Use “' + p.name + '”', on: { click: function () { close(); if (opts.onSaved) opts.onSaved(p.name); } } }));
        });
      }
    }
    nameIn.addEventListener('input', check);
    var upBtn = h('button', { type: 'button', class: 'btn small', text: photo.url ? 'Change photo' : 'Upload photo', disabled: !canUpload, on: { click: function () {
      var fi = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', class: 'sr' }); document.body.appendChild(fi);
      fi.addEventListener('change', function () {
        var f = fi.files[0]; fi.remove(); if (!f) return;
        if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { msg.hidden = false; msg.textContent = 'Use a PNG, JPEG or WebP image.'; return; }
        if (f.size > 10 * 1024 * 1024) { msg.hidden = false; msg.textContent = 'That image is over 10 MB.'; return; }
        upBtn.disabled = true; upBtn.textContent = 'Uploading…';
        assets.upload(f).then(function (r) { photo = { url: r.url, id: r.id }; pv.setAttribute('style', pv.getAttribute('style').replace(/background-image:[^;]*;?/, '') + bgUrl(r.url)); upBtn.textContent = 'Change photo'; })
          .catch(function (e) { msg.hidden = false; msg.textContent = 'Upload failed' + (e && e.message ? ': ' + e.message : '') + '.'; upBtn.textContent = 'Upload photo'; })
          .then(function () { upBtn.disabled = false; });
      }); fi.click();
    } } });
    var saveB = h('button', { type: 'button', class: 'btn primary', text: opts.key ? 'Save' : 'Add person', on: { click: save } });
    function close() { back.remove(); document.removeEventListener('keydown', esc); }
    function esc(e) { if (e.key === 'Escape') close(); }
    function save() {
      var name = nameIn.value.trim(), k = personKey(name);
      if (!k) { msg.hidden = false; msg.textContent = 'Enter a name.'; nameIn.focus(); return; }
      saveB.disabled = true; saveB.textContent = 'Saving…'; msg.hidden = true;
      var p = Promise.resolve();
      if (opts.key && opts.key !== k) p = renamePerson(opts.key, name);
      p.then(function () {
        var body = { name: name, bio: bioIn.value.trim().slice(0, 600), updatedAt: new Date().toISOString(),
          birthday: /^\d{4}-\d{2}-\d{2}$/.test(bdayIn.value) ? bdayIn.value : '',
          birthplace: bplaceIn.value.trim().slice(0, 120), gender: genderIn.value,
          aka: akaIn.value.split(',').map(function (x) { return x.trim().slice(0, 80); }).filter(function (x, i, a) { return x && personKey(x) !== k && a.indexOf(x) === i; }).slice(0, 10) };
        if (photo.url) { body.photoUrl = photo.url; body.photoId = photo.id; }
        return db.doc('people/' + k).set(body, { merge: true }).then(function () { if (popIn.value !== popState(k)) return setPopular(k, name, popIn.value); });
      }).then(function () {
        setStatus((opts.key ? 'Saved ' : 'Added ') + name + '. Page: /person/' + k);
        close(); if (opts.onSaved) opts.onSaved(name);
      }).catch(function (e) { saveB.disabled = false; saveB.textContent = opts.key ? 'Save' : 'Add person'; msg.hidden = false; msg.textContent = 'Couldn’t save' + (e && e.message ? ': ' + e.message : '') + '.'; });
    }
    var box = h('div', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pf_t', class: 'card', style: 'width:min(520px,100%);max-height:90vh;overflow:auto' }, [
      h('div', { class: 'head' }, [h('h2', { id: 'pf_t', text: opts.key ? 'Edit ' + startName : 'Add a cast or crew member' }), h('button', { type: 'button', class: 'x', 'aria-label': 'Close', text: '×', on: { click: close } })]),
      h('div', { style: 'display:flex;gap:16px;align-items:center;flex-wrap:wrap' }, [pv, h('div', {}, [upBtn, h('div', { class: 'note', style: 'margin-top:6px', text: 'Square headshot you have the rights to use.' })])]),
      h('div', { class: 'field' }, [h('label', { class: 'l', for: 'pf_name', text: 'Name' }), nameIn, url, warn,
        opts.key ? h('div', { class: 'note', text: 'Changing the name updates it on every title they appear in.' }) : null]),
      h('div', { class: 'field' }, [h('label', { class: 'l', for: 'pf_bio', text: 'Short bio' }), bioIn]),
      h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' }, [
        h('div', { class: 'field', style: 'flex:0 0 170px' }, [h('label', { class: 'l', for: 'pf_bday', text: 'Birthday' }), bdayIn]),
        h('div', { class: 'field', style: 'flex:1 1 200px' }, [h('label', { class: 'l', for: 'pf_bplace', text: 'Birthplace' }), bplaceIn])]),
      h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' }, [
        h('div', { class: 'field', style: 'flex:1 1 180px' }, [h('label', { class: 'l', for: 'pf_gender', text: 'Gender' }), genderIn, h('div', { class: 'note', text: 'Used for the Male and Female actor filters on People.' })]),
        h('div', { class: 'field', style: 'flex:1 1 180px' }, [h('label', { class: 'l', for: 'pf_pop', text: 'Popular list' }), popIn, h('div', { class: 'note', text: 'Automatic ranks by billing, recent work and verdicts.' })])]),
      h('div', { class: 'field' }, [h('label', { class: 'l', for: 'pf_aka', text: 'Also known as' }), akaIn, h('div', { class: 'note', text: 'Search finds them by these names too.' })]),
      msg,
      h('div', { style: 'display:flex;gap:10px;justify-content:flex-end' }, [h('button', { type: 'button', class: 'btn ghost', text: 'Cancel', on: { click: close } }), saveB])
    ]);
    back.appendChild(box);
    back.addEventListener('click', function (e) { if (e.target === back) close(); });
    document.addEventListener('keydown', esc);
    document.body.appendChild(back);
    check(); nameIn.focus();
  }
  // In-page confirm. Native confirm() dialogs are silently blocked in some browsers and app webviews
  // (they return false without showing anything), which made these actions look broken.
  function askConfirm(title, body, okLabel, danger) {
    return new Promise(function (resolve) {
      var back = h('div', { style: 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:60;display:flex;align-items:center;justify-content:center;padding:16px' });
      var done = function (v) { document.removeEventListener('keydown', esc, true); back.remove(); resolve(v); };
      var esc = function (e) { if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
      var ok = h('button', { type: 'button', class: 'btn ' + (danger ? 'danger' : 'primary'), text: okLabel || 'OK', on: { click: function () { done(true); } } });
      var box = h('div', { role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'ac_t', 'aria-describedby': 'ac_b', class: 'card', style: 'width:min(480px,100%)' }, [
        h('h2', { id: 'ac_t', style: 'margin:0', text: title }),
        h('div', { id: 'ac_b', class: 'note', style: 'white-space:pre-line;font-size:14px', text: body || '' }),
        h('div', { style: 'display:flex;gap:10px;justify-content:flex-end' }, [h('button', { type: 'button', class: 'btn ghost', text: 'Cancel', on: { click: function () { done(false); } } }), ok])
      ]);
      back.appendChild(box);
      back.addEventListener('click', function (e) { if (e.target === back) done(false); });
      document.addEventListener('keydown', esc, true);
      document.body.appendChild(back); ok.focus();
    });
  }
  function copyToClipboard(t, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { setStatus(done || 'Copied'); }, function () { setStatus(t); });
    else setStatus(t);
  }
  function renderPeople() {
    var main = $('main'); main.innerHTML = '';
    var list = allPeople();
    var q = peopleQ.trim().toLowerCase();
    // Duplicate check compares everyone with everyone, so only redo it when the set of names changes.
    var sig = list.map(function (p) { return p.key + '=' + p.name; }).join('|');
    if (dupCache.sig !== sig) {
      var dm = findDupes(list);
      dupCache = { sig: sig, map: dm };
    }
    var dupMap = dupCache.map;
    function popOf(k) { return popState(k); }
    var pinN = list.filter(function (p) { return popOf(p.key) === 'pin'; }).length, hideN = list.filter(function (p) { return popOf(p.key) === 'hide'; }).length;
    var shown = list.filter(function (p) {
      return (!q || p.name.toLowerCase().indexOf(q) !== -1 || p.key.indexOf(q) !== -1 || ((people[p.key] && people[p.key].aka) || []).join(' ').toLowerCase().indexOf(q) !== -1) &&
        (peopleFilter !== 'nophoto' || !personPhoto(p.name)) && (peopleFilter !== 'dupes' || dupMap[p.key]) &&
        (peopleFilter !== 'pin' || popOf(p.key) === 'pin') && (peopleFilter !== 'hide' || popOf(p.key) === 'hide');
    });
    var search = h('input', { class: 'in', id: 'pplQ', type: 'search', placeholder: 'Search by name or URL' }); search.value = peopleQ;
    search.addEventListener('input', function () { peopleQ = search.value; peoplePage = 1; var pos = search.selectionStart; renderPeople(); var n = $('pplQ'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } });
    var withPhoto = list.filter(function (p) { return personPhoto(p.name); }).length, dupCount = Object.keys(dupMap).length;
    function chip(id, label) { return h('button', { type: 'button', class: 'chip', 'aria-pressed': String(peopleFilter === id), text: label, on: { click: function () { peopleFilter = peopleFilter === id ? 'all' : id; peoplePage = 1; renderPeople(); } } }); }
    var card = h('section', { class: 'card' }, [
      h('div', { class: 'head' }, [h('div', {}, [h('div', { class: 'sub', text: list.length + ' people · ' + withPhoto + ' with photos' }), h('h1', { text: 'Cast & crew' })]),
        h('button', { type: 'button', class: 'btn primary', text: '+ New person', disabled: !canWrite, on: { click: function () { openPersonForm({ onSaved: function () { renderPeople(); } }); } } })]),
      h('div', { class: 'note', text: 'Everyone credited on any title, with their public page. Each person has one page and one photo, matched by name, so fix spelling mistakes with Rename or Merge rather than adding a second person.' }),
      h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;align-items:center' }, [
        h('label', { class: 'sr', for: 'pplQ', text: 'Search people' }), h('span', { style: 'flex:1;min-width:200px' }, [search]),
        chip('nophoto', 'Missing photo'), chip('dupes', 'Possible duplicates' + (dupCount ? ' (' + dupCount + ')' : '')), chip('pin', 'Always popular' + (pinN ? ' (' + pinN + ')' : '')), chip('hide', 'Never popular' + (hideN ? ' (' + hideN + ')' : ''))
      ])
    ]);
    var pages = Math.max(1, Math.ceil(shown.length / PEOPLE_PAGE));
    if (peoplePage > pages) peoplePage = pages;
    var from = (peoplePage - 1) * PEOPLE_PAGE, slice = shown.slice(from, from + PEOPLE_PAGE);
    if (shown.length) card.appendChild(h('div', { class: 'note', id: 'pplSum', text: 'Showing ' + (from + 1) + '–' + (from + slice.length) + ' of ' + shown.length + (shown.length !== list.length ? ' (filtered from ' + list.length + ')' : '') }));
    var rows = h('div', { class: 'rows' });
    if (!shown.length) rows.appendChild(h('div', { class: 'empty', style: 'padding:20px', text: list.length ? 'No one matches.' : 'Add cast to titles first.' }));
    slice.forEach(function (p) {
      var url = personPhoto(p.name), page = personPageUrl(p.key), bio = people[p.key] && people[p.key].bio;
      var dup = dupMap[p.key];
      rows.appendChild(h('div', { style: 'display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:10px;border:1px solid ' + (dup ? '#5a4520' : 'var(--line)') + ';border-radius:12px;background:var(--bg)' }, [
        avatarBtn(p.name, 52),
        h('span', { style: 'flex:1;min-width:220px' }, [
          h('div', { style: 'font-weight:600;font-size:14px' }, [p.name, popOf(p.key) === 'pin' ? h('span', { class: 'star', title: 'Always shown in Popular', text: ' ★ Popular' }) : popOf(p.key) === 'hide' ? h('span', { class: 'note', text: ' · hidden from Popular' }) : null]),
          h('div', { style: 'font-size:13px;margin-top:2px;word-break:break-all' }, [h('a', { href: page, target: '_blank', rel: 'noopener', text: '/person/' + p.key })]),
          h('div', { class: 'note', style: 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis', title: p.titles.join(', '), text: (p.titles.length ? p.titles.length + (p.titles.length === 1 ? ' title · ' : ' titles · ') + p.titles.join(', ') : 'Not on any title yet') + (bio ? ' · has bio' : '') }),
          dup ? h('div', { class: 'warn', style: 'margin-top:4px' }, ['Possible duplicate of '].concat(dup.slice(0, 2).map(function (d2, i) {
            return h('span', {}, [i ? ', ' : '', h('b', { text: d2.name }), ' ', h('button', { type: 'button', class: 'btn small', style: 'height:26px;padding:0 10px', disabled: !canWrite, text: 'Merge into this', on: { click: function () { mergeInto(p, d2); } } })]);
          }))) : null
        ]),
        h('span', { style: 'display:flex;gap:6px;flex-wrap:wrap' }, [
          (function () {
            var sel = h('select', { class: 'in', style: 'height:36px;width:auto;font-size:13px', 'aria-label': 'Popular list setting for ' + p.name, disabled: !canWrite }, POP_OPTS.map(function (o) { return h('option', { value: o[0], text: o[1], selected: popOf(p.key) === o[0] }); }));
            sel.addEventListener('change', function () { setPopular(p.key, p.name, sel.value).then(function () { renderPeople(); }); });
            return sel;
          })(),
          h('button', { type: 'button', class: 'btn small', text: 'Copy URL', on: { click: function () { copyToClipboard(page, 'Copied ' + page); } } }),
          h('button', { type: 'button', class: 'btn small', text: 'Edit', disabled: !canWrite, on: { click: function () { openPersonForm({ key: p.key, name: p.name, onSaved: function () { renderPeople(); } }); } } }),
          url ? h('button', { type: 'button', class: 'btn small', text: 'Remove photo', disabled: !canWrite, on: { click: function () { removePhoto(p.name); } } }) : null
        ])
      ]));
    });
    card.appendChild(rows);
    if (pages > 1) {
      var pager = h('nav', { class: 'pager', 'aria-label': 'Pages' });
      var pbtn = function (n, label, dis) {
        return h('button', { type: 'button', class: 'chip', text: label || String(n), disabled: dis, 'aria-current': n === peoplePage && !label ? 'page' : null, 'aria-label': label ? null : 'Page ' + n,
          on: { click: function () { peoplePage = n; renderPeople(); window.scrollTo({ top: 0 }); } } });
      };
      pager.appendChild(pbtn(peoplePage - 1, '← Prev', peoplePage === 1));
      var want = {}; [1, 2, peoplePage - 1, peoplePage, peoplePage + 1, pages - 1, pages].forEach(function (n) { if (n >= 1 && n <= pages) want[n] = 1; });
      var last = 0; Object.keys(want).map(Number).sort(function (a, b) { return a - b; }).forEach(function (n) {
        if (n - last > 1) pager.appendChild(h('span', { class: 'gap', text: '…' }));
        pager.appendChild(pbtn(n)); last = n;
      });
      pager.appendChild(pbtn(peoplePage + 1, 'Next →', peoplePage === pages));
      card.appendChild(pager);
    }
    main.appendChild(card);
  }
  function mergeInto(from, to) {
    if (dirty) { setStatus('Save or discard your changes first.'); return; }
    askConfirm('Merge “' + from.name + '” into “' + to.name + '”?', 'Every title that credits “' + from.name + '” will credit “' + to.name + '” instead, and /person/' + from.key + ' will stop existing. This can’t be undone.', 'Merge', true).then(function (yes) {
      if (!yes) return;
      setStatus('Merging…');
      renamePerson(from.key, to.name).then(function (n) { var m = 'Merged ' + from.name + ' into ' + to.name + ' (' + n + ' updates).'; setStatus(m); setTimeout(function () { setStatus(m); }, 1200); })
        .catch(function (e) { setStatus('Couldn’t merge' + (e && e.message ? ': ' + e.message : '') + '.'); });
    });
  }
  // ---------- Home rows: titles pinned to the front of a homescreen row ----------
  // settings/rows { theatres, coming, ott, trailers, songs, tvpromos: [ids] }. The site shows pinned titles first, in this
  // order, wherever that row appears (homescreen, Browse, language pages, /trailers, /songs, /tv-promos); the rest follow
  // in their usual order. A pin only counts while the title belongs in the row (still in that section, or still has that
  // kind of video); otherwise it is dropped (cleared from the list on the next save here).
  var ROW_KEYS = ['theatres', 'coming', 'ott', 'trailers', 'songs', 'tvpromos'];
  function noPins() { var o = {}; ROW_KEYS.forEach(function (k) { o[k] = []; }); return o; }
  var rowsMode = false, rowPins = noPins(), rowsLoaded = false, rowsWriting = false, rowsDragging = false, rowsShowAll = {};
  // [key, row name on the site, what the automatic order is, what counts as a candidate (for messages), noun]
  var ROWS = [
    ['theatres', 'In theatres', 'Newest release first, then this week’s releases', 'in theatres', 'film'],
    ['coming', 'Coming soon', 'In the usual Coming soon order', 'in Coming soon', 'film'],
    ['ott', 'New on OTT', 'In the usual On OTT order', 'on OTT', 'film'],
    ['trailers', 'New trailers', 'Newest release first, films from the last 6 months and upcoming ones', 'with a trailer', 'film'],
    ['songs', 'New songs', 'Newest release first, films from the last 6 months and upcoming ones (up to 3 songs each)', 'with a video song', 'film'],
    ['tvpromos', 'New TV promotionals', 'Shows still running first, then newest (up to 2 videos each)', 'with a video', 'show']
  ];
  function rowInfo(key) { return ROWS.filter(function (r) { return r[0] === key; })[0]; }
  function ytOk(u) { return /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)[A-Za-z0-9_-]{11}/.test(String(u || '')); }
  // Same video categories as the site (app/main.js vidCat).
  function vidKind(k) { k = String(k || '').toLowerCase(); return /trailer|teaser|promo|glimpse/.test(k) ? 'trailers' : /song|lyric|music|jukebox|audio/.test(k) ? 'songs' : 'other'; }
  function hasVid(d, cat) {
    if ((cat === 'trailers' || cat === 'any') && safeUrl(d.trailerFileUrl)) return true;
    return (d.videos || []).some(function (x) { return ytOk(safeUrl(x.url)) && (cat === 'any' || vidKind(x.kind) === cat); });
  }
  var ROW_SEC = { theatres: 'In theatres', coming: 'Coming soon', ott: 'On OTT' };
  function rowFilms(key) {
    return movies.filter(function (m) {
      var d = m.data; if (d.published === false) return false;
      if (ROW_SEC[key]) return d.section === ROW_SEC[key];
      if (key === 'tvpromos') return d.section === 'TV shows' && hasVid(d, 'any');
      return d.section !== 'TV shows' && hasVid(d, key);
    });
  }
  function livePins(key) { var ok = {}; rowFilms(key).forEach(function (m) { ok[m.id] = 1; }); return (rowPins[key] || []).filter(function (id, i, a) { return ok[id] && a.indexOf(id) === i; }); }
  function todayStr() { var td = new Date(); return td.getFullYear() + '-' + String(td.getMonth() + 1).padStart(2, '0') + '-' + String(td.getDate()).padStart(2, '0'); }
  function rowAuto(key) {
    var list = rowFilms(key), today = todayStr(), newest = function (a, b) { return (b.data.releaseDate || '').localeCompare(a.data.releaseDate || ''); };
    if (key === 'theatres') {
      var rel = function (m) { return !!m.data.releaseDate && m.data.releaseDate <= today; };
      return list.slice().sort(function (a, b) {
        var ra = rel(a), rb = rel(b); if (ra !== rb) return ra ? -1 : 1;
        return ra ? newest(a, b) : (a.data.releaseDate || '').localeCompare(b.data.releaseDate || '');
      });
    }
    if (key === 'trailers' || key === 'songs') { // the homescreen row only reaches back 6 months (pinned films are shown regardless)
      var cut = new Date(Date.now() - 180 * 864e5).toISOString().slice(0, 10);
      return list.filter(function (m) { return (m.data.releaseDate || '') >= cut; }).sort(newest);
    }
    if (key === 'tvpromos') {
      var y = String(new Date().getFullYear()), on = function (m) { return !m.data.endYear || String(m.data.endYear) >= y ? 1 : 0; };
      return list.slice().sort(function (a, b) { return on(b) - on(a) || newest(a, b); });
    }
    return list; // coming, ott: movies arrive in the site's own order (by the order field)
  }
  function renderRowsCount() { var el = $('rowsCount'); if (el) el.textContent = rowsLoaded ? String(ROW_KEYS.reduce(function (n, k) { return n + livePins(k).length; }, 0)) : ''; }
  function writeRows(key, ids, msg) {
    if (rowsWriting) { setStatus('Still saving, try again in a moment.'); return; }
    var next = {}; ROW_KEYS.forEach(function (k) { next[k] = livePins(k); });
    next[key] = ids;
    rowsWriting = true; rowPins = next; renderRowsCount(); if (rowsMode) renderRows();
    var body = JSON.parse(JSON.stringify(next)); body.updatedAt = new Date().toISOString();
    db.doc('settings/rows').set(body).then(function () {
      rowsWriting = false; setStatus(msg || 'Order saved');
    }).catch(function (e) { rowsWriting = false; setStatus('Couldn’t save the order' + (e && e.message ? ': ' + e.message : '') + '.'); });
  }
  function filmMeta(d) { return [fmtDate(d.releaseDate), langsOf(d).slice(0, 2).join(', ')].filter(Boolean).join(' · '); }
  function renderRows() {
    var main = $('main'); main.innerHTML = '';
    main.appendChild(h('section', { class: 'card' }, [
      h('div', { class: 'head' }, [h('div', {}, [h('div', { class: 'sub', text: 'Homescreen rows' }), h('h1', { text: 'Home rows' })])]),
      h('div', { class: 'note', text: 'Pin titles to the front of a homescreen row. They show first, in this order, everywhere that row appears: the homescreen, Browse, the language pages, and the Show all pages for trailers, songs and TV promotionals. Everything else follows in the usual order, so new titles still appear without you doing anything. A pin is dropped when the title no longer belongs in the row (a Coming soon film releases, a film leaves theatres or OTT, or its trailer or songs are removed). Visitors who pick a language see your pins for that language first.' }),
      h('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;margin-top:12px' }, ROWS.map(function (r) {
        var n = livePins(r[0]).length;
        return h('a', { class: 'chip', href: '#rows-' + r[0], text: r[1] + (n ? ' · ' + n : ''), on: { click: function (e) { e.preventDefault(); var t = $('rows-' + r[0]); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); } } });
      }))
    ]));
    ROWS.forEach(function (r) {
      var key = r[0], sec = r[1], what = r[3], noun = r[4], pins = livePins(key), byId = {}, every = rowFilms(key);
      every.forEach(function (m) { byId[m.id] = m; });
      var auto = rowAuto(key).filter(function (m) { return pins.indexOf(m.id) === -1; });
      var pickable = every.filter(function (m) { return pins.indexOf(m.id) === -1; }); // any title that qualifies, not just the recent ones
      var card = h('section', { class: 'card', id: 'rows-' + key }, [h('div', { class: 'head' }, [
        h('h2', { text: sec }), h('span', { class: 'sub', text: pins.length + ' pinned · ' + every.length + ' ' + noun + 's ' + what })])]);
      // add by title
      var dlId = 'rowsDl-' + key, labels = {};
      var dl = h('datalist', { id: dlId }, pickable.map(function (m) { var y = (m.data.releaseDate || '').slice(0, 4), t = (m.data.title || 'Untitled') + (y ? ' (' + y + ')' : ''); labels[t.toLowerCase()] = m.id; return h('option', { value: t }); }));
      var addIn = h('input', { class: 'in', id: 'rowsAdd-' + key, list: dlId, placeholder: 'Type a ' + noun + ' ' + what + '…', autocomplete: 'off', disabled: !canWrite });
      var msg = h('div', { class: 'err', hidden: true });
      function doAdd() {
        var v = addIn.value.trim().toLowerCase(), id = labels[v];
        if (!id) { var hit = pickable.filter(function (m) { return (m.data.title || '').toLowerCase() === v; }); if (hit.length === 1) id = hit[0].id; }
        msg.hidden = true;
        if (!v) { msg.hidden = false; msg.textContent = 'Type a title first.'; return; }
        if (!id) { msg.hidden = false; msg.textContent = 'No published ' + noun + ' ' + what + ' called “' + addIn.value.trim() + '”. Pick one from the list.'; return; }
        addIn.value = ''; writeRows(key, pins.concat([id]), 'Pinned to ' + sec);
      }
      addIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } });
      card.appendChild(h('div', { class: 'field' }, [h('label', { class: 'l', for: 'rowsAdd-' + key, text: 'Pin a ' + noun + ' to the front' }),
        h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' }, [h('span', { style: 'flex:1;min-width:220px' }, [addIn, dl]), h('button', { type: 'button', class: 'btn primary', text: 'Pin', disabled: !canWrite, on: { click: doAdd } })]), msg]));
      // pinned, draggable
      var rowStyle = 'display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:8px 10px;border:1px solid var(--line);border-radius:12px;background:var(--bg)';
      var list = h('div', { class: 'rows' });
      if (!pins.length) list.appendChild(h('div', { class: 'empty', style: 'padding:16px', text: 'Nothing pinned. The row uses the automatic order below.' }));
      function move(from, to) { if (to < 0 || to >= pins.length || from === to) return; var n = pins.slice(), x = n.splice(from, 1)[0]; n.splice(to, 0, x); writeRows(key, n); }
      var dragFrom = null;
      pins.forEach(function (id, i) {
        var m = byId[id], d = m.data, poster = safeUrl(d.posterUrl);
        var row = h('div', { class: 'rowpin', draggable: canWrite ? 'true' : 'false', style: rowStyle + ';cursor:' + (canWrite ? 'grab' : 'default') }, [
          h('span', { 'aria-hidden': 'true', style: 'color:var(--dim);font-size:18px;letter-spacing:-2px;user-select:none', text: '⋮⋮' }),
          h('span', { style: 'font-family:Anton,Impact,sans-serif;font-size:20px;width:28px;text-align:center;color:var(--accent)', text: String(i + 1) }),
          poster ? h('img', { src: poster, alt: '', loading: 'lazy', style: 'width:34px;height:50px;object-fit:cover;border-radius:6px' }) : h('span', { style: 'width:34px;height:50px;border-radius:6px;background:var(--panel2)' }),
          h('span', { style: 'flex:1;min-width:160px' }, [h('a', { href: titleHref(m), style: 'font-weight:600', text: d.title || 'Untitled' }), h('div', { class: 'note', text: filmMeta(d) })]),
          h('span', { style: 'display:flex;gap:6px' }, [
            h('button', { type: 'button', class: 'btn small', 'aria-label': 'Move ' + d.title + ' up', text: '↑', disabled: i === 0 || !canWrite, on: { click: function () { move(i, i - 1); } } }),
            h('button', { type: 'button', class: 'btn small', 'aria-label': 'Move ' + d.title + ' down', text: '↓', disabled: i === pins.length - 1 || !canWrite, on: { click: function () { move(i, i + 1); } } }),
            h('button', { type: 'button', class: 'btn small danger', text: 'Unpin', disabled: !canWrite, on: { click: function () { writeRows(key, pins.filter(function (x) { return x !== id; }), 'Unpinned'); } } })
          ])
        ]);
        row.addEventListener('dragstart', function (e) { dragFrom = i; rowsDragging = true; row.style.opacity = '.4'; try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); } catch (x) {} });
        row.addEventListener('dragend', function () { row.style.opacity = ''; rowsDragging = false; list.querySelectorAll('.rowpin').forEach(function (x) { x.style.boxShadow = ''; }); });
        row.addEventListener('dragover', function (e) { if (dragFrom === null) return; e.preventDefault(); var b = row.getBoundingClientRect(), after = e.clientY > b.top + b.height / 2; list.querySelectorAll('.rowpin').forEach(function (x) { x.style.boxShadow = ''; }); row.style.boxShadow = after ? '0 3px 0 var(--accent)' : '0 -3px 0 var(--accent)'; });
        row.addEventListener('drop', function (e) {
          e.preventDefault(); if (dragFrom === null) return;
          var b = row.getBoundingClientRect(), to = i + (e.clientY > b.top + b.height / 2 ? 1 : 0);
          if (dragFrom < to) to--;
          var f = dragFrom; dragFrom = null; rowsDragging = false; move(f, to);
        });
        list.appendChild(row);
      });
      card.appendChild(h('h3', { class: 'sub', style: 'margin:14px 0 8px', text: 'Pinned · shown first' }));
      card.appendChild(list);
      // the automatic order after the pins
      var shown = rowsShowAll[key] ? auto : auto.slice(0, 12);
      var al = h('div', { class: 'rows' });
      shown.forEach(function (m, i) {
        al.appendChild(h('div', { style: rowStyle }, [
          h('span', { style: 'width:28px;text-align:center;color:var(--muted);font-weight:700', text: String(pins.length + i + 1) }),
          h('span', { style: 'flex:1;min-width:160px' }, [h('a', { href: titleHref(m), style: 'font-weight:600', text: m.data.title || 'Untitled' }), h('div', { class: 'note', text: filmMeta(m.data) })]),
          h('button', { type: 'button', class: 'btn small', text: 'Pin', disabled: !canWrite, on: { click: function () { writeRows(key, pins.concat([m.id]), 'Pinned to ' + sec); } } })
        ]));
      });
      if (!auto.length) al.appendChild(h('div', { class: 'empty', style: 'padding:16px', text: pins.length ? 'Every ' + noun + ' ' + what + ' is pinned.' : (every.length ? 'Nothing recent in this row. You can still pin any ' + noun + ' ' + what + ' above.' : 'No published ' + noun + 's ' + what + '.') }));
      card.appendChild(h('h3', { class: 'sub', style: 'margin:18px 0 8px', text: 'Then automatically · ' + r[2] }));
      card.appendChild(al);
      if (auto.length > 12) card.appendChild(h('button', { type: 'button', class: 'btn small', style: 'margin-top:10px', text: rowsShowAll[key] ? 'Show fewer' : 'Show all ' + auto.length,
        on: { click: function () { rowsShowAll[key] = !rowsShowAll[key]; renderRows(); } } }));
      main.appendChild(card);
    });
  }
  // ---------- Buttons: Book tickets / Watch now on or off, page by page (settings/buttons) ----------
  var btnMode = false, btnCfg = {}, btnLoaded = false, btnWriting = false;
  var BTN_PLACES = [
    ['home', 'Homescreen', 'The In theatres and Coming soon rows', { watch: 'The homescreen rows don’t show Watch now' }],
    ['browse', 'Browse', 'Browse › All, In theatres, Coming soon, On OTT, TV shows…', {}],
    ['lang', 'Language pages', '/hindi-movies, /tamil-movies-in-theatres, /upcoming-telugu-movies…', {}],
    ['mylist', 'My List', 'Watchlist and What to watch this weekend', {}],
    ['title', 'Title pages', 'The Book tickets and Watch on … buttons on each film or show', {}]
  ];
  function btnIsOn(place, kind) { var p = btnCfg[place]; return !(p && p[kind] === false); }
  function renderBtnCount() { var el = $('btnCount'); if (!el) return; var off = 0; BTN_PLACES.forEach(function (p) { ['book', 'watch'].forEach(function (k) { if (!p[3][k] && !btnIsOn(p[0], k)) off++; }); }); el.textContent = btnLoaded && off ? off + ' off' : ''; }
  function writeBtn(place, kind, on) {
    if (btnWriting) { setStatus('Still saving, try again in a moment.'); return; }
    var next = {}; BTN_PLACES.forEach(function (p) { next[p[0]] = { book: btnIsOn(p[0], 'book'), watch: btnIsOn(p[0], 'watch') }; });
    next[place][kind] = on;
    btnWriting = true; btnCfg = next; renderBtnCount(); if (btnMode) renderButtons();
    var body = JSON.parse(JSON.stringify(next)); body.updatedAt = new Date().toISOString();
    db.doc('settings/buttons').set(body).then(function () {
      btnWriting = false;
      var nm = BTN_PLACES.filter(function (p) { return p[0] === place; })[0][1];
      setStatus((kind === 'book' ? 'Book tickets' : 'Watch now') + (on ? ' shown on ' : ' hidden on ') + nm);
    }).catch(function (e) { btnWriting = false; setStatus('Couldn’t save' + (e && e.message ? ': ' + e.message : '') + '.'); });
  }
  function renderButtons() {
    var main = $('main'); main.innerHTML = '';
    main.appendChild(h('section', { class: 'card' }, [
      h('div', { class: 'head' }, [h('div', {}, [h('div', { class: 'sub', text: 'Site buttons' }), h('h1', { text: 'Buttons' })])]),
      h('div', { class: 'note', text: 'Show or hide the Book tickets and Watch now buttons page by page. Changes reach visitors straight away. With Book tickets hidden, Coming soon films show Remind me instead. A button only ever appears when the film has a booking or streaming link.' })
    ]));
    var tb = h('tbody');
    BTN_PLACES.forEach(function (p) {
      function cell(kind, label) {
        if (p[3][kind]) return h('td', { class: 'note', text: '—', title: p[3][kind] });
        var id = 'btn-' + p[0] + '-' + kind, on = btnIsOn(p[0], kind);
        var cb = h('input', { type: 'checkbox', id: id, checked: on, disabled: !canWrite || !btnLoaded, style: 'width:20px;height:20px;accent-color:var(--accent);cursor:pointer' });
        cb.addEventListener('change', function () { writeBtn(p[0], kind, cb.checked); });
        return h('td', {}, [h('label', { for: id, style: 'display:inline-flex;align-items:center;gap:8px;cursor:pointer' }, [cb, h('span', { text: on ? 'Shown' : 'Hidden', style: on ? '' : 'color:var(--muted)' })]), h('span', { class: 'sr', text: ' ' + label + ' on ' + p[1] })]);
      }
      tb.appendChild(h('tr', {}, [
        h('th', { scope: 'row', style: 'text-align:left;padding:12px 10px' }, [h('div', { style: 'font-weight:600', text: p[1] }), h('div', { class: 'note', text: p[2] })]),
        cell('book', 'Book tickets'), cell('watch', 'Watch now')
      ]));
    });
    main.appendChild(h('section', { class: 'card' }, [h('table', { class: 'btntable', style: 'width:100%;border-collapse:collapse' }, [
      h('thead', {}, [h('tr', {}, [h('th', { scope: 'col', style: 'text-align:left;padding:8px 10px', text: 'Page' }), h('th', { scope: 'col', style: 'text-align:left;padding:8px 10px', text: '🎟 Book tickets' }), h('th', { scope: 'col', style: 'text-align:left;padding:8px 10px', text: '▶ Watch now' })])]),
      tb])]));
  }
  var MAX_FEAT = 8;
  function isFeatured(id) { return featured.indexOf(id) !== -1; }
  function writeFeatured(next, msg) {
    if (featWriting) { setStatus('Still saving the banner, try again in a moment.'); return; }
    featWriting = true; featured = next; renderFeatCount(); if (featuredMode) renderFeatured(); else renderEditor();
    db.doc('settings/home').set({ featured: next, updatedAt: new Date().toISOString() }).then(function () {
      featWriting = false; setStatus(msg || 'Home banner saved');
    }).catch(function () { featWriting = false; setStatus('Couldn’t save the home banner. Try again.'); });
  }
  function toggleFeatured(id) {
    if (isFeatured(id)) writeFeatured(featured.filter(function (x) { return x !== id; }), 'Removed from the home banner');
    else if (featured.length >= MAX_FEAT) setStatus('The banner holds up to ' + MAX_FEAT + ' titles. Remove one first.');
    else writeFeatured(featured.concat([id]), 'Added to the home banner');
  }
  function renderFeatCount() {
    var el = $('featCount'); if (!el) return;
    el.textContent = featured.length + '/' + MAX_FEAT;
  }
  function renderFeatured() {
    var main = $('main'); main.innerHTML = '';
    var items = featured.map(function (id) { return movies.find(function (m) { return m.id === id; }); }).filter(Boolean);
    var card = h('section', { class: 'card' }, [
      h('div', { class: 'head' }, [
        h('div', {}, [h('div', { class: 'sub', text: 'First scroll of the home page' }), h('h1', { text: 'Home banner' })]),
        h('div', { class: 'sub', text: items.length + ' of ' + MAX_FEAT + ' slots' })
      ]),
      h('div', { class: 'note', text: 'These titles rotate in the banner carousel, in this order. Use a 16:9 banner image on each for the best look; titles without one show placeholder art. With nothing chosen, the home page falls back to titles in theatres.' })
    ]);
    var list = h('div', { class: 'rows' });
    if (!items.length) list.appendChild(h('div', { class: 'empty', style: 'padding:24px', text: 'No titles chosen yet. Add one below.' }));
    items.forEach(function (m, i) {
      var d = m.data, hasBanner = !!safeUrl(d.bannerUrl);
      list.appendChild(h('div', { style: 'display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:10px;border:1px solid var(--line);border-radius:12px;background:var(--bg)' }, [
        h('span', { style: 'font-family:Anton,Impact,sans-serif;font-size:22px;width:24px;text-align:center;color:var(--accent)', text: String(i + 1) }),
        h('span', { class: 'thumb', style: 'width:112px;height:63px;' + bgUrl(d.bannerUrl), 'aria-hidden': 'true' }, [hasBanner ? null : 'No banner']),
        h('span', { style: 'flex:1;min-width:160px' }, [
          h('div', { class: 't', style: 'font-weight:600', text: d.title || 'Untitled' }),
          h('div', { class: 'm', style: 'font-size:12px;color:' + (hasBanner ? 'var(--muted)' : '#F5C46B'), text: d.section + ' · ' + fmtDate(d.releaseDate) + (hasBanner ? '' : ' · add a banner image') })
        ]),
        h('span', { style: 'display:flex;gap:6px;flex-wrap:wrap' }, [
          h('button', { type: 'button', class: 'btn small', 'aria-label': 'Move ' + d.title + ' up', text: '↑', disabled: i === 0 || !canWrite, on: { click: function () { var n = featured.slice(); var j = n.indexOf(m.id); n.splice(j, 1); n.splice(j - 1, 0, m.id); writeFeatured(n, 'Order saved'); } } }),
          h('button', { type: 'button', class: 'btn small', 'aria-label': 'Move ' + d.title + ' down', text: '↓', disabled: i === items.length - 1 || !canWrite, on: { click: function () { var n = featured.slice(); var j = n.indexOf(m.id); n.splice(j, 1); n.splice(j + 1, 0, m.id); writeFeatured(n, 'Order saved'); } } }),
          h('a', { class: 'btn small', href: titleHref(m), text: 'Edit title' }),
          h('button', { type: 'button', class: 'btn small danger', text: 'Remove', disabled: !canWrite, on: { click: function () { toggleFeatured(m.id); } } })
        ])
      ]));
    });
    card.appendChild(list);
    var avail = movies.filter(function (m) { return !isFeatured(m.id); });
    var sel = h('select', { class: 'in', id: 'featAdd', disabled: !canWrite || featured.length >= MAX_FEAT },
      [h('option', { value: '', text: featured.length >= MAX_FEAT ? 'All ' + MAX_FEAT + ' slots are full' : 'Choose a title to add…' })].concat(
        SECTIONS.map(function (sec) {
          var g = h('optgroup', { label: sec });
          avail.filter(function (m) { return m.data.section === sec; }).forEach(function (m) {
            g.appendChild(h('option', { value: m.id, text: m.data.title + (safeUrl(m.data.bannerUrl) ? '' : ' (no banner yet)') }));
          });
          return g;
        })));
    card.appendChild(h('div', { class: 'field' }, [
      h('label', { class: 'l', for: 'featAdd', text: 'Add a title to the banner' }),
      h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' }, [
        h('span', { style: 'flex:1;min-width:220px' }, [sel]),
        h('button', { type: 'button', class: 'btn primary', text: 'Add to banner', disabled: !canWrite || featured.length >= MAX_FEAT, on: { click: function () {
          if (!sel.value) { setStatus('Pick a title first.'); return; } toggleFeatured(sel.value);
        } } })
      ])
    ]));
    main.appendChild(card);
  }
  // ---------- page banners: TV Shows (/admin/tv-banner, settings/tvbanner) and Movies (/admin/movies-banner, settings/moviesbanner) ----------
  // The carousels at the top of the site's TV Shows and Movies pages. With nothing chosen, each page picks titles itself.
  function hasVideo(d) { return !!safeUrl(d.trailerFileUrl) || (d.videos || []).some(function (x) { return !!safeUrl(x.url); }); }
  function hasSong(d) { return (d.videos || []).some(function (x) { return !!safeUrl(x.url) && vidKind(x.kind) === 'songs'; }); }
  var PB = {
    tv: { doc: 'settings/tvbanner', page: 'tvbanner', name: 'TV Shows banner', where: 'Top of the TV Shows page', noun: 'show', nouns: 'shows', countId: 'tvFeatCount', selId: 'tvFeatAdd',
      fits: function (m) { return m.data.section === 'TV shows'; }, media: hasVideo, mediaWord: 'video',
      note: 'These shows rotate in the banner on the TV Shows page, in this order. Each plays its first trailer, or else its first promo, clip or episode, right in the banner, so give each a 16:9 banner image and a video. With nothing chosen, the page picks shows itself: pinned TV promotionals (Home rows) first, then running shows with the newest videos.',
      count: function (d) { var n = (d.videos || []).length; return n + ' video' + (n === 1 ? '' : 's'); }, items: [], writing: false },
    movies: { doc: 'settings/moviesbanner', page: 'moviesbanner', name: 'Movies banner', where: 'Top of the Movies page', noun: 'movie', nouns: 'movies', countId: 'movFeatCount', selId: 'movFeatAdd',
      fits: function (m) { return m.data.section !== 'TV shows'; }, media: hasSong, mediaWord: 'song',
      note: 'These movies rotate in the banner on the Movies page, in this order. Each plays its newest song right in the banner, so give each a 16:9 banner image and a song video. With nothing chosen, the page picks movies itself: pinned New songs (Home rows) first, then the movies with the newest songs.',
      count: function (d) { var n = (d.videos || []).filter(function (x) { return vidKind(x.kind) === 'songs'; }).length; return n + ' song' + (n === 1 ? '' : 's'); }, items: [], writing: false }
  };
  var pbMode = null;
  function pbHas(k, id) { return PB[k].items.indexOf(id) !== -1; }
  function pbWrite(k, next, msg) {
    var c = PB[k];
    if (c.writing) { setStatus('Still saving the ' + c.name + ', try again in a moment.'); return; }
    c.writing = true; c.items = next; pbCount(k); if (pbMode === k) renderPageBanner(k); else renderEditor();
    db.doc(c.doc).set({ featured: next, updatedAt: new Date().toISOString() }).then(function () {
      c.writing = false; setStatus(msg || c.name + ' saved');
    }).catch(function () { c.writing = false; setStatus('Couldn’t save the ' + c.name + '. Try again.'); });
  }
  function pbToggle(k, id) {
    var c = PB[k];
    if (pbHas(k, id)) pbWrite(k, c.items.filter(function (x) { return x !== id; }), 'Removed from the ' + c.name);
    else if (c.items.length >= MAX_FEAT) setStatus('The banner holds up to ' + MAX_FEAT + ' ' + c.nouns + '. Remove one first.');
    else pbWrite(k, c.items.concat([id]), 'Added to the ' + c.name);
  }
  function pbCount(k) { var el = $(PB[k].countId); if (el) el.textContent = PB[k].items.length + '/' + MAX_FEAT; }
  function renderPageBanner(k) {
    var c = PB[k], main = $('main'); main.innerHTML = '';
    var items = c.items.map(function (id) { return movies.find(function (m) { return m.id === id; }); }).filter(Boolean);
    var card = h('section', { class: 'card' }, [
      h('div', { class: 'head' }, [
        h('div', {}, [h('div', { class: 'sub', text: c.where }), h('h1', { text: c.name })]),
        h('div', { class: 'sub', text: items.length + ' of ' + MAX_FEAT + ' slots' })
      ]),
      h('div', { class: 'note', text: c.note })
    ]);
    var list = h('div', { class: 'rows' });
    if (!items.length) list.appendChild(h('div', { class: 'empty', style: 'padding:24px', text: 'No ' + c.nouns + ' chosen yet, so the page picks them itself. Add one below.' }));
    items.forEach(function (m, i) {
      var d = m.data, hasBanner = !!safeUrl(d.bannerUrl), med = c.media(d);
      var warn = [hasBanner ? '' : 'add a banner image', med ? '' : 'add a ' + c.mediaWord].filter(Boolean).join(' and ');
      list.appendChild(h('div', { style: 'display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:10px;border:1px solid var(--line);border-radius:12px;background:var(--bg)' }, [
        h('span', { style: 'font-family:Anton,Impact,sans-serif;font-size:22px;width:24px;text-align:center;color:var(--accent)', text: String(i + 1) }),
        h('span', { class: 'thumb', style: 'width:112px;height:63px;' + bgUrl(d.bannerUrl), 'aria-hidden': 'true' }, [hasBanner ? null : 'No banner']),
        h('span', { style: 'flex:1;min-width:160px' }, [
          h('div', { class: 't', style: 'font-weight:600', text: d.title || 'Untitled' }),
          h('div', { class: 'm', style: 'font-size:12px;color:' + (warn ? '#F5C46B' : 'var(--muted)'), text: [k === 'tv' ? (d.platform || 'TV show') : d.section, c.count(d)].join(' · ') + (warn ? ' · ' + warn : '') })
        ]),
        h('span', { style: 'display:flex;gap:6px;flex-wrap:wrap' }, [
          h('button', { type: 'button', class: 'btn small', 'aria-label': 'Move ' + d.title + ' up', text: '↑', disabled: i === 0 || !canWrite, on: { click: function () { var n = c.items.slice(); var j = n.indexOf(m.id); n.splice(j, 1); n.splice(j - 1, 0, m.id); pbWrite(k, n, 'Order saved'); } } }),
          h('button', { type: 'button', class: 'btn small', 'aria-label': 'Move ' + d.title + ' down', text: '↓', disabled: i === items.length - 1 || !canWrite, on: { click: function () { var n = c.items.slice(); var j = n.indexOf(m.id); n.splice(j, 1); n.splice(j + 1, 0, m.id); pbWrite(k, n, 'Order saved'); } } }),
          h('a', { class: 'btn small', href: titleHref(m), text: 'Edit ' + c.noun }),
          h('button', { type: 'button', class: 'btn small danger', text: 'Remove', disabled: !canWrite, on: { click: function () { pbToggle(k, m.id); } } })
        ])
      ]));
    });
    card.appendChild(list);
    var ok = function (m) { return c.media(m.data) && !!safeUrl(m.data.bannerUrl); };
    var avail = movies.filter(function (m) { return c.fits(m) && !pbHas(k, m.id); })
      .sort(function (a, b) { return ok(b) - ok(a) || String(b.data.releaseDate || '').localeCompare(String(a.data.releaseDate || '')); });
    var ready = avail.filter(ok), rest = avail.filter(function (m) { return !ok(m); });
    var opt = function (m) { var d = m.data, miss = [safeUrl(d.bannerUrl) ? '' : 'no banner', c.media(d) ? '' : 'no ' + c.mediaWord].filter(Boolean).join(', '); return h('option', { value: m.id, text: d.title + (d.releaseDate ? ' (' + String(d.releaseDate).slice(0, 4) + ')' : '') + (miss ? ' · ' + miss : '') }); };
    var full = c.items.length >= MAX_FEAT;
    var sel = h('select', { class: 'in', id: c.selId, disabled: !canWrite || full },
      [h('option', { value: '', text: full ? 'All ' + MAX_FEAT + ' slots are full' : 'Choose a ' + c.noun + ' to add…' }),
        h('optgroup', { label: 'With a banner and a ' + c.mediaWord }, ready.map(opt)),
        h('optgroup', { label: 'Missing a banner or a ' + c.mediaWord }, rest.map(opt))]);
    card.appendChild(h('div', { class: 'field' }, [
      h('label', { class: 'l', for: c.selId, text: 'Add a ' + c.noun + ' to the banner' }),
      h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' }, [
        h('span', { style: 'flex:1;min-width:220px' }, [sel]),
        h('button', { type: 'button', class: 'btn primary', text: 'Add to banner', disabled: !canWrite || full, on: { click: function () {
          if (!sel.value) { setStatus('Pick a ' + c.noun + ' first.'); return; } pbToggle(k, sel.value);
        } } })
      ])
    ]));
    main.appendChild(card);
  }
  var remoteChanged = false;
  var confirmDelete = false;

  var $ = function (id) { return document.getElementById(id); };

  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'text') el.textContent = v;
      else if (k === 'on') Object.keys(v).forEach(function (ev) { el.addEventListener(ev, v[ev]); });
      else if (k === 'style') el.setAttribute('style', v);
      else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c != null) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  function clone(o) { return JSON.parse(JSON.stringify(o || {})); }
  function setStatus(t) { $('status').textContent = t; }
  function safeUrl(u) { return (typeof u === 'string' && (/^\/_blob\//.test(u) || /^https:\/\//.test(u))) ? u : ''; }
  function bgUrl(u) { u = safeUrl(u); return u ? 'background-image:url("' + u.replace(/"/g, '%22') + '")' : ''; }
  // Now playing (set in the admin panel): theatres | out | ott | direct. It decides a film's home page section, and
  // a film marked theatres or out moves to ott once its OTT Release Date has passed. Same rule in scripts/build.mjs
  // and app/admin.js. TV shows keep their section; for them it is a label only.
  var NP_LABEL = { theatres: 'Theatres only', out: 'Out of theatres', ott: 'Now on OTT', direct: 'Direct to OTT' };
  function npToday() { var t = new Date(); return t.getFullYear() + '-' + ('0' + (t.getMonth() + 1)).slice(-2) + '-' + ('0' + t.getDate()).slice(-2); }
  function nowPlayingOf(d, today) {
    var np = d.nowPlaying || ''; today = today || npToday();
    if ((np === 'theatres' || np === 'out') && d.ottReleaseDate && d.ottReleaseDate <= today) np = 'ott';
    return NP_LABEL[np] ? np : '';
  }
  function npSection(d, today) {
    var np = nowPlayingOf(d, today); today = today || npToday();
    if (!np || d.section === 'TV shows') return d.section;
    if (d.releaseDate && d.releaseDate > today) return 'Coming soon';
    if (np === 'theatres') return 'In theatres';
    if (np === 'out') return 'Older releases';
    // On OTT while recent (streaming for under a year); after that it is an older release that streams.
    var from = d.ottReleaseDate || d.releaseDate || '', ago = new Date(); ago.setFullYear(ago.getFullYear() - 1);
    return !from || from >= ago.toISOString().slice(0, 10) ? 'On OTT' : 'Older releases';
  }
  // Now playing select. For films it sets the Home page section (which is then locked); TV shows only get the
  // two OTT choices, as a label.
  function nowPlayingField(tvEd) {
    var opts = tvEd ? [['', 'Not set'], ['ott', 'Now on OTT'], ['direct', 'Direct to OTT']]
      : [['', 'Not set'], ['theatres', 'Theatres only'], ['out', 'Out of theatres'], ['ott', 'Now on OTT'], ['direct', 'Direct to OTT']];
    var cur = draft.nowPlaying || '';
    var sel = h('select', { id: 'f_nowPlaying', class: 'in', disabled: !canWrite }, opts.map(function (o) { return h('option', { value: o[0], text: o[1], selected: o[0] === cur }); }));
    sel.addEventListener('change', function () {
      if (sel.value) draft.nowPlaying = sel.value; else delete draft.nowPlaying;
      if (!tvEd && draft.nowPlaying) draft.section = npSection(draft);
      touch(); renderEditor();
    });
    var eff = nowPlayingOf(draft), note = !cur ? 'Sets the home page section for you. Leave as “Not set” to choose the section yourself.'
      : eff !== cur ? 'Now on OTT since ' + draft.ottReleaseDate + ' (its OTT Release Date), so it shows as streaming.'
      : tvEd ? 'Shown as a label on the show’s page and cards.' : 'Shown to visitors on the film’s page and cards. Moves to OTT on its own once the OTT Release Date passes.';
    return h('div', { class: 'field' }, [h('label', { class: 'l', for: 'f_nowPlaying', text: 'Now playing' }), sel, h('span', { class: 'note', text: note })]);
  }
  // A synopsis counts as filled when the site shows one from the editorial file (same rule as the Missing synopsis chip).
  function missField(d, id, k) { return k === 'synopsis' ? missingSynopsis(d, id) : !d[k]; }
  function missing(d, id) { return REQUIRED.filter(function (r) { return missField(d, id, r[0]); }); }
  function pct(d, id) { return Math.round(100 * (REQUIRED.length - missing(d, id).length) / REQUIRED.length); }
  function fmtDate(iso) {
    if (!iso) return 'No date';
    if (/^\d{4}$/.test(iso)) return iso;
    var p = iso.split('-'); var m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+p[1] - 1];
    return (+p[2]) + ' ' + m + ' ' + p[0];
  }
  function blank() {
    return { title: '', subtitle: '', section: 'Coming soon', platform: '', releaseDate: '', releaseNote: '', languages: '', genre: '',
      runtime: '', certificate: '', director: '', synopsis: '', cast: [], videos: [], formats: '', posterId: '', posterUrl: '',
      bannerId: '', bannerUrl: '', published: false, order: movies.length ? Math.max.apply(null, movies.map(function (m) { return +m.data.order || 0; })) + 1 : 0, source: 'Added in admin' };
  }

  // ---------- list ----------
  var SORTS = { release: 'Release date', title: 'Title', complete: 'Completeness', updated: 'Last edited', section: 'Section' };
  var SEC_SLUG = { 'In theatres': 'in-theatres', 'Coming soon': 'coming-soon', 'On OTT': 'on-ott', 'Older releases': 'older-releases', 'TV shows': 'tv-shows', 'Missing info': 'missing-info', 'Missing photos': 'missing-photos', 'Missing posters': 'missing-posters', 'Missing trailers': 'missing-trailers', 'Missing synopsis': 'missing-synopsis' };
  // SEO status of a title page, same rules as scripts/build.mjs (seoTier): only "Good substance" pages are in Google.
  var SEO_TIERS = [['kept', 'Kept out of Google'], ['thin', 'Clearly thin'], ['border', 'Borderline'], ['good', 'Good substance']];
  // Published = what visitors can see on the site; the list starts there so its counts match the live site.
  var STATUS_OPTS = { published: 'Published', unpublished: 'Unpublished', all: 'All' };
  function pubOk(d, st) { return st === 'all' || (st === 'unpublished' ? d.published === false : d.published !== false); }
  function hasWhere(d) { return !!(String(d.platform || '').trim() || safeUrl(d.platformUrl) || safeUrl(d.bookingUrl) || Object.keys(d.bookingUrls || {}).some(function (c) { return safeUrl(d.bookingUrls[c]); }) || (d.moreBooking || []).some(function (p) { return p && Object.keys(p.urls || {}).some(function (c) { return safeUrl(p.urls[c]); }); })); }
  function hasYt(d) { return (d.videos || []).some(function (v) { return /youtu\.?be/.test(v.url || ''); }); }
  function seoTier(d, id) {
    var syn = String(d.synopsis || '').trim().length, tot = (seoVotes && seoVotes[id]) || 0;
    if (!syn && !safeUrl(d.posterUrl) && !hasYt(d) && !tot) return 'kept';
    if (safeUrl(d.posterUrl) || hasYt(d) || hasWhere(d) || syn >= 200 || tot >= 3) return 'good';
    return syn < 80 ? 'thin' : 'border';
  }
  function loadSeoVotes() {
    if (seoVotes || !db) return; seoVotes = {};
    db.collection('verdicts').get().then(function (snap) { var c = {}; snap.docs.forEach(function (x) { var v = (x.data() || {}).v || {}; Object.keys(v).forEach(function (k) { c[k] = (c[k] || 0) + 1; }); }); seoVotes = c; if (seoF) renderList(); }).catch(function () {});
  }
  function yearOf(d) { var y = (d.releaseDate || '').slice(0, 4); return /^\d{4}$/.test(y) ? y : 'none'; }
  function langsOf(d) { return (d.languages || '').split(/[,;/]| dubbed in | and /i).map(function (x) { return x.trim(); }).filter(Boolean); }
  function readListState() {
    var q = new URLSearchParams(location.search);
    if (!location.search) return;
    query = q.get('q') || ''; langF = q.get('lang') || ''; yearF = q.get('year') || ''; seoF = q.get('seo') || '';
    statusF = STATUS_OPTS[q.get('status')] ? q.get('status') : 'published';
    var sec = q.get('section'); filter = 'All'; missF = [];
    fieldF = (q.get('fields') || '').split(',').filter(function (k) { return REQUIRED.some(function (r) { return r[0].toLowerCase() === k.toLowerCase(); }); }).map(function (k) { return REQUIRED.filter(function (r) { return r[0].toLowerCase() === k.toLowerCase(); })[0][0]; });
    (q.get('missing') || '').split(',').forEach(function (x) { Object.keys(MISS_SLUG).forEach(function (k) { if (MISS_SLUG[k] === x && missF.indexOf(k) === -1) missF.push(k); }); });
    if (sec === 'unpublished') statusF = 'unpublished'; // old link to the removed Unpublished chip
    Object.keys(SEC_SLUG).forEach(function (k) { if (SEC_SLUG[k] === sec) { if (isMiss(k)) { if (missF.indexOf(k) === -1) missF.push(k); } else filter = k; } }); // old ?section=missing-… links
    sortKey = SORTS[q.get('sort')] ? q.get('sort') : 'release';
    sortDir = q.get('dir') === 'asc' ? 'asc' : (q.get('dir') === 'desc' ? 'desc' : defaultDir(sortKey));
    pageNo = Math.max(1, parseInt(q.get('page'), 10) || 1);
  }
  function defaultDir(k) { return k === 'title' || k === 'section' || k === 'complete' ? 'asc' : 'desc'; }
  function writeListState() {
    if (page !== 'titles') return;
    var q = new URLSearchParams();
    if (query.trim()) q.set('q', query.trim());
    if (filter !== 'All') q.set('section', SEC_SLUG[filter]);
    if (missF.length) q.set('missing', FILTERS.filter(function (f) { return missF.indexOf(f) !== -1; }).map(function (f) { return MISS_SLUG[f]; }).join(','));
    if (fieldF.length && missF.indexOf('Missing info') !== -1) q.set('fields', fieldF.join(','));
    if (langF) q.set('lang', langF);
    if (yearF) q.set('year', yearF);
    if (seoF) q.set('seo', seoF);
    if (statusF !== 'published') q.set('status', statusF);
    if (sortKey !== 'release' || sortDir !== 'desc') { q.set('sort', sortKey); if (sortDir !== defaultDir(sortKey)) q.set('dir', sortDir); }
    if (pageNo > 1) q.set('page', String(pageNo));
    var url = '/admin/titles' + (q.toString() ? '?' + q.toString() : '');
    if (location.pathname + location.search !== url) history.replaceState(null, '', url);
  }
  // Section chips pick one section (tap again for All); Missing chips stack, and a title must be missing every picked one.
  var MISS_SLUG = { 'Missing info': 'info', 'Missing photos': 'photos', 'Missing posters': 'posters', 'Missing trailers': 'trailers', 'Missing synopsis': 'synopsis' };
  function isMiss(f) { return !!MISS_SLUG[f]; }
  // With Missing info picked, the field chips (fieldF) narrow it to titles missing every picked field.
  function chipOk(d, id, sec, miss, fields) {
    sec = sec || filter; miss = miss || missF; fields = fields || fieldF;
    return matchSection(d, sec, id) && miss.every(function (g) { return matchSection(d, g, id); })
      && (miss.indexOf('Missing info') === -1 || fields.every(function (k) { return missField(d, id, k); }));
  }
  function setList(fn) { fn(); renderList(); }
  function renderFilters() {
    var box = $('filters'); box.innerHTML = '';
    var base = movies.filter(function (m) { return passQL(m.data, m.id); });
    FILTERS.forEach(function (f, i) {
      var on, n, click;
      if (f === 'All') {
        on = filter === 'All' && !missF.length; n = base.length;
        click = function () { filter = 'All'; missF = []; fieldF = []; };
      } else if (isMiss(f)) {
        on = missF.indexOf(f) !== -1;
        n = base.filter(function (m) { return chipOk(m.data, m.id, filter, on ? missF : missF.concat(f)); }).length;
        click = function () { missF = on ? missF.filter(function (x) { return x !== f; }) : missF.concat(f); if (f === 'Missing info' && on) fieldF = []; };
      } else {
        on = filter === f;
        n = base.filter(function (m) { return chipOk(m.data, m.id, f); }).length;
        click = function () { filter = on ? 'All' : f; };
      }
      if (isMiss(f) && !isMiss(FILTERS[i - 1])) box.appendChild(h('span', { class: 'chipsep', 'aria-hidden': 'true' }));
      box.appendChild(h('button', { type: 'button', class: 'chip' + (isMiss(f) ? ' gap' : ''), 'aria-pressed': String(on), text: (isMiss(f) && on ? '✓ ' : '') + f + ' · ' + n,
        title: isMiss(f) ? 'Combine with a section and other Missing filters' : null,
        on: { click: function () { setList(function () { click(); pageNo = 1; }); } } }));
    });
    if (missF.indexOf('Missing info') !== -1) {
      var fr = h('div', { class: 'fieldrow', role: 'group', 'aria-label': 'Missing which field' }, [
        h('span', { class: 'note', text: 'Missing info = missing any of: ' + REQUIRED.map(function (r) { return r[1].toLowerCase(); }).join(', ') + '. Tap fields to narrow it down:' })]);
      var cur = base.filter(function (m) { return chipOk(m.data, m.id); });
      REQUIRED.forEach(function (r) {
        var k = r[0], fon = fieldF.indexOf(k) !== -1;
        var n = fon ? cur.length : cur.filter(function (m) { return missField(m.data, m.id, k); }).length;
        fr.appendChild(h('button', { type: 'button', class: 'chip small gap', 'aria-pressed': String(fon), text: (fon ? '✓ ' : '') + r[1] + ' · ' + n,
          on: { click: function () { setList(function () { fieldF = fon ? fieldF.filter(function (x) { return x !== k; }) : fieldF.concat(k); pageNo = 1; }); } } }));
      });
      box.appendChild(fr);
    }
    var ls = $('langSel'), counts = {};
    movies.forEach(function (m) { if (pubOk(m.data, statusF)) langsOf(m.data).forEach(function (l) { counts[l] = (counts[l] || 0) + 1; }); });
    var langs = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || a.localeCompare(b); });
    if (langF && langs.indexOf(langF) === -1) langs.unshift(langF);
    ls.innerHTML = '';
    ls.appendChild(h('option', { value: '', text: 'All languages' }));
    langs.forEach(function (l) { ls.appendChild(h('option', { value: l, text: l + ' (' + (counts[l] || 0) + ')', selected: l === langF })); });
    var ys = $('yearSel'), yc = {};
    movies.forEach(function (m) { if (!pubOk(m.data, statusF)) return; var y = yearOf(m.data); yc[y] = (yc[y] || 0) + 1; });
    var years = Object.keys(yc).filter(function (y) { return y !== 'none'; }).sort().reverse();
    if (yearF && !yc[yearF]) yc[yearF] = 0;
    ys.innerHTML = '';
    ys.appendChild(h('option', { value: '', text: 'All years' }));
    years.forEach(function (y) { ys.appendChild(h('option', { value: y, text: y + ' (' + yc[y] + ')', selected: y === yearF })); });
    if (yc.none) ys.appendChild(h('option', { value: 'none', text: 'No release date (' + yc.none + ')', selected: yearF === 'none' }));
    var es = $('seoSel'), ec = {};
    movies.forEach(function (m) { if (chipOk(m.data, m.id) && passQL(m.data, m.id, true)) { var t = seoTier(m.data, m.id); ec[t] = (ec[t] || 0) + 1; } });
    es.innerHTML = '';
    es.appendChild(h('option', { value: '', text: 'All SEO statuses' }));
    SEO_TIERS.forEach(function (t) { es.appendChild(h('option', { value: t[0], text: t[1] + ' (' + (ec[t[0]] || 0) + ')', selected: t[0] === seoF })); });
    var st = $('statusSel'), sc = { published: 0, unpublished: 0, all: 0 };
    movies.forEach(function (m) { if (chipOk(m.data, m.id) && passQL(m.data, m.id, false, true)) { sc.all++; sc[m.data.published === false ? 'unpublished' : 'published']++; } });
    st.innerHTML = '';
    Object.keys(STATUS_OPTS).forEach(function (k) { st.appendChild(h('option', { value: k, text: STATUS_OPTS[k] + ' (' + sc[k] + ')', selected: k === statusF })); });
    var ss = $('sortSel'); ss.innerHTML = '';
    [['release', 'desc', 'Newest release first'], ['release', 'asc', 'Oldest release first'], ['title', 'asc', 'Title A–Z'], ['updated', 'desc', 'Recently edited'], ['complete', 'asc', 'Least complete first'], ['section', 'asc', 'Section']].forEach(function (o) {
      ss.appendChild(h('option', { value: o[0] + ':' + o[1], text: o[2], selected: sortKey === o[0] && sortDir === o[1] }));
    });
    if (!ss.value) ss.appendChild(h('option', { value: sortKey + ':' + sortDir, text: SORTS[sortKey] + (sortDir === 'asc' ? ' ↑' : ' ↓'), selected: true }));
  }
  function missingPhotos(d) { return !safeUrl(d.posterUrl) || !safeUrl(d.bannerUrl); }
  // No story on the site: none saved here, and none from the editorial file (content/synopses.json), whose titles
  // the build lists in /synopsis-file-ids.json. Until that list loads, only the saved story counts.
  var synFile = {};
  fetch('/synopsis-file-ids.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : []; }).then(function (ids) {
    (ids || []).forEach(function (id) { synFile[id] = 1; }); if (typeof renderList === 'function' && page === 'titles') renderList();
  }).catch(function () {});
  function missingSynopsis(d, id) { return !String(d.synopsis || '').trim() && !synFile[id]; }
  // No trailer, teaser, promo, clip or interview with a link (songs and episodes don't count).
  function missingTrailer(d) { return !(d.videos || []).some(function (v) { return (v.url || '').trim() && !/^(song|episode)$/i.test((v.kind || '').trim()); }); }
  function matchSection(d, f, id) { return f === 'All' || (f === 'Missing info' ? missing(d, id).length > 0 : f === 'Missing photos' ? missingPhotos(d) : f === 'Missing posters' ? !safeUrl(d.posterUrl) : f === 'Missing trailers' ? missingTrailer(d) : f === 'Missing synopsis' ? missingSynopsis(d, id) : d.section === f); }
  function passQL(d, id, skipSeo, skipStatus) {
    if (!skipStatus && !pubOk(d, statusF)) return false;
    if (seoF && !skipSeo && seoTier(d, id) !== seoF) return false;
    if (langF && langsOf(d).indexOf(langF) === -1) return false;
    if (yearF && yearOf(d) !== yearF) return false;
    var q = query.trim().toLowerCase(); if (!q) return true;
    var hay = [d.title, d.subtitle, d.director, d.platform, slugOf({ data: d, id: '' }), (d.cast || []).map(function (c) { return c.name; }).join(' ')].join(' ').toLowerCase();
    return q.split(/\s+/).every(function (w) { return hay.indexOf(w) !== -1; });
  }
  function visible() {
    var secIdx = {}; SECTIONS.forEach(function (x, i) { secIdx[x] = i; });
    var list = movies.filter(function (m) { return chipOk(m.data, m.id) && passQL(m.data, m.id); });
    var dir = sortDir === 'asc' ? 1 : -1;
    function val(m) {
      var d = m.data;
      if (sortKey === 'title') return (d.title || '').toLowerCase();
      if (sortKey === 'complete') return pct(d, m.id);
      if (sortKey === 'updated') return d.updatedAt || '';
      if (sortKey === 'section') return secIdx[d.section] != null ? secIdx[d.section] : 9;
      return d.releaseDate || '';
    }
    return list.sort(function (a, b) {
      var x = val(a), y = val(b);
      if (x === '' && y !== '') return 1; if (y === '' && x !== '') return -1; // blanks last
      if (x < y) return -dir; if (x > y) return dir;
      return (a.data.title || '').localeCompare(b.data.title || '');
    });
  }
  function fmtAgo(iso) {
    if (!iso) return '—';
    var t = Date.parse(iso); if (isNaN(t)) return '—';
    var d = Math.floor((Date.now() - t) / 86400000);
    if (d <= 0) return 'Today'; if (d === 1) return 'Yesterday'; if (d < 30) return d + ' days ago';
    return fmtDate(iso.slice(0, 10));
  }
  // CSV of the filtered list: title, release year and the title's ID (its database document id, which never changes).
  function downloadList(list) {
    var q = function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var rows = [['Title', 'Release year', 'Title ID']].concat(list.map(function (m) {
      var y = String(m.data.releaseDate || '').slice(0, 4);
      return [m.data.title || '', /^\d{4}$/.test(y) ? y : '', m.id];
    }));
    var csv = '\ufeff' + rows.map(function (r) { return r.map(q).join(','); }).join('\r\n') + '\r\n';
    var parts = [filter !== 'All' ? SEC_SLUG[filter] : (missF.length ? '' : 'all-titles')].concat(missF.map(function (f) { return SEC_SLUG[f]; }), fieldF.length && missF.indexOf('Missing info') !== -1 ? ['no-' + fieldF.join('-')] : [], [statusF !== 'published' ? statusF : '', langF, yearF, seoF, query ? 'search' : '']).filter(Boolean).map(function (x) { return String(x).toLowerCase().replace(/[^a-z0-9]+/g, '-'); });
    var a = h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), download: 'reelscore-' + parts.join('-') + '-' + new Date().toISOString().slice(0, 10) + '.csv' });
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    setStatus('Downloaded ' + list.length + ' title' + (list.length === 1 ? '' : 's') + '.');
  }
  function renderList() {
    if (seoF) loadSeoVotes();
    var tc = $('titleCount'); if (tc) tc.textContent = movies.length ? String(movies.length) : '';
    if (page !== 'titles') return;
    var qi = $('q'); if (qi && document.activeElement !== qi) qi.value = query;
    renderFilters();
    var table = $('list'), pager = $('pager'), sum = $('tsum');
    table.innerHTML = ''; pager.innerHTML = '';
    var vis = visible(), total = vis.length, pages = Math.max(1, Math.ceil(total / PAGE));
    if (pageNo > pages) pageNo = pages;
    writeListState();
    var from = (pageNo - 1) * PAGE, slice = vis.slice(from, from + PAGE);
    sum.textContent = !movies.length ? '' : total ? 'Showing ' + (from + 1) + '–' + (from + slice.length) + ' of ' + total + (total !== movies.length ? ' (filtered from ' + movies.length + ' titles)' : '') : '';
    $('list').parentNode.hidden = !total;
    if (statusF === 'published' && query.trim()) {
      var hid = movies.filter(function (m) { return m.data.published === false && chipOk(m.data, m.id) && passQL(m.data, m.id, false, true); }).length;
      if (hid) sum.appendChild(h('button', { type: 'button', class: 'btn small', style: 'margin-left:12px', text: hid + ' unpublished match' + (hid === 1 ? '' : 'es') + ' — show them',
        on: { click: function () { setList(function () { statusF = 'all'; pageNo = 1; }); } } }));
    }
    if (total) sum.appendChild(h('button', { type: 'button', class: 'btn small', style: 'margin-left:12px', title: 'Every title in this filtered list, not only this page',
      text: '⬇ Download list (' + total + ')', on: { click: function () { downloadList(vis); } } }));
    if (!movies.length) { sum.appendChild(h('div', { class: 'empty', text: moviesLoaded ? 'No titles yet. Use + Add title to create one.' : 'Loading titles…' })); return; }
    if (!total) {
      sum.appendChild(h('div', { class: 'empty' }, ['No titles match. ', h('button', { type: 'button', class: 'btn small', text: 'Clear filters', on: { click: function () { setList(function () { query = ''; langF = ''; yearF = ''; seoF = ''; statusF = 'published'; filter = 'All'; missF = []; fieldF = []; pageNo = 1; }); } } })]));
      return;
    }
    function th(key, label, cls) {
      var st = sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : null;
      return h('th', { class: cls || '', scope: 'col', 'aria-sort': st }, key ? [h('button', { type: 'button', text: label, on: { click: function () {
        setList(function () { if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc'; else { sortKey = key; sortDir = defaultDir(key); } pageNo = 1; });
      } } })] : [label ? h('span', { class: 'sr', text: label }) : null]);
    }
    table.appendChild(h('thead', {}, [h('tr', {}, [
      th(null, 'Poster', 'pc'), th('title', 'Title'), th('section', 'Section', 'c-sec'), th('release', 'Release'), h('th', { scope: 'col', class: 'c-lang', text: 'Language' }), th('complete', 'Complete', 'c-cpl'), th('updated', 'Edited', 'c-upd')
    ])]));
    var tb = h('tbody');
    slice.forEach(function (m) {
      var d = m.data, p = pct(d, m.id), href = titleHref(m), poster = safeUrl(d.posterUrl), miss = missing(d, m.id);
      var tr = h('tr', { class: d.published === false ? 'unpubrow' : '' }, [
        h('td', { class: 'pc' }, [poster ? h('img', { src: poster, alt: '', loading: 'lazy', decoding: 'async' }) : h('span')]),
        h('td', {}, [
          h('a', { class: 'tt', href: href, text: d.title || 'Untitled' }),
          isFeatured(m.id) ? h('span', { class: 'star', title: 'On the home banner', text: ' ★' }) : null,
          d.published === false ? h('span', { class: 'unpub', title: 'Visitors can’t see this title', text: 'Not published' }) : null,
          h('div', { class: 'ts', text: [(d.section === 'On OTT' || d.section === 'TV shows') && d.platform ? d.platform : '', d.director ? 'Dir. ' + d.director : '', pathBase(d) + slugOf(m)].filter(Boolean).join(' · ') }),
          missF.indexOf('Missing info') !== -1 && miss.length ? h('div', { class: 'ts', style: 'color:var(--warn,#b45309)', text: 'Missing: ' + miss.map(function (r) { return r[1].toLowerCase(); }).join(', ') }) : null,
          missF.indexOf('Missing photos') !== -1 && missF.indexOf('Missing info') === -1 ? h('div', { class: 'ts', style: 'color:var(--warn,#b45309)', text: 'Missing: ' + [safeUrl(d.posterUrl) ? '' : 'poster', safeUrl(d.bannerUrl) ? '' : 'banner'].filter(Boolean).join(' and ') }) : null
        ]),
        h('td', { class: 'c-sec' }, [h('span', { class: 'sec', text: d.section || '—' })]),
        h('td', { class: 'nw', text: fmtDate(d.releaseDate) }),
        h('td', { class: 'nw c-lang', text: langsOf(d).slice(0, 2).join(', ') + (langsOf(d).length > 2 ? ' +' + (langsOf(d).length - 2) : '') || '—' }),
        h('td', { class: 'c-cpl' }, [h('span', { class: 'cpl', title: miss.length ? 'Missing: ' + miss.map(function (r) { return r[1]; }).join(', ') : 'All key fields filled' }, [
          h('span', { class: 'bar', 'aria-hidden': 'true' }, [h('span', { style: 'width:' + p + '%' })]), p + '%'])]),
        h('td', { class: 'nw c-upd', text: fmtAgo(d.updatedAt) })
      ]);
      tr.addEventListener('click', function (e) { if (e.target.closest('a')) return; go(href); });
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    if (pages > 1) {
      function pbtn(n, label, dis) {
        return h('button', { type: 'button', class: 'chip', text: label || String(n), disabled: dis, 'aria-current': n === pageNo && !label ? 'page' : null, 'aria-label': label ? null : 'Page ' + n,
          on: { click: function () { setList(function () { pageNo = n; }); window.scrollTo({ top: 0 }); } } });
      }
      pager.appendChild(pbtn(pageNo - 1, '← Prev', pageNo === 1));
      var shown = {}; [1, 2, pageNo - 1, pageNo, pageNo + 1, pages - 1, pages].forEach(function (n) { if (n >= 1 && n <= pages) shown[n] = 1; });
      var last = 0;
      Object.keys(shown).map(Number).sort(function (a, b) { return a - b; }).forEach(function (n) {
        if (n - last > 1) pager.appendChild(h('span', { class: 'gap', text: '…' }));
        pager.appendChild(pbtn(n)); last = n;
      });
      pager.appendChild(pbtn(pageNo + 1, 'Next →', pageNo === pages));
    }
  }

  // ---------- pages: /admin/titles, /admin/titles/<slug>, /admin/titles/new, /admin/people, /admin/home-banner ----------
  function titleHref(m) { return '/admin/titles/' + slugOf(m); }
  function findBySlug(k) {
    return movies.find(function (m) { return m.id === k || slugOf(m) === k; }) ||
      movies.find(function (m) { return (m.data.slugHistory || []).indexOf(k) !== -1; }) || null;
  }
  function showPage() {
    $('titlesPage').hidden = page !== 'titles';
    $('editPage').hidden = page === 'titles';
    document.querySelectorAll('.atabs a').forEach(function (a) {
      var p = a.getAttribute('data-p'), on = p === page || (p === 'titles' && page === 'title');
      a.setAttribute('aria-current', on ? 'page' : 'false');
    });
    var names = { titles: 'All titles', title: (draft && draft.title) || 'Edit title', people: 'Cast & crew', popular: 'Popular cast', banner: 'Home banner', tvbanner: 'TV Shows banner', moviesbanner: 'Movies banner', rows: 'Home rows', buttons: 'Buttons' };
    document.title = names[page] + ' · Admin · Reelscore';
  }
  function resolveTitle() {
    if (page !== 'title' || !wantSlug) return;
    if (wantSlug === 'new') { if (currentId !== '__new__') { currentId = '__new__'; draft = blank(); setDirty(true); } return; }
    var m = findBySlug(wantSlug);
    if (m) {
      if (m.id !== currentId) select(m.id);
      if (location.pathname !== titleHref(m)) history.replaceState(null, '', titleHref(m));
    } else if (movies.length || moviesLoaded) { currentId = null; draft = null; }
  }
  function route(sub) {
    var parts = String(sub || '').split('/').filter(Boolean);
    featuredMode = false; pbMode = null; peopleMode = false; popularMode = false; rowsMode = false; btnMode = false; wantSlug = null;
    if (parts[0] === 'people') { page = 'people'; peopleMode = true; }
    else if (parts[0] === 'popular') { page = 'popular'; popularMode = true; }
    else if (parts[0] === 'home-banner') { page = 'banner'; featuredMode = true; }
    else if (parts[0] === 'tv-banner') { page = 'tvbanner'; pbMode = 'tv'; }
    else if (parts[0] === 'movies-banner') { page = 'moviesbanner'; pbMode = 'movies'; }
    else if (parts[0] === 'home-rows') { page = 'rows'; rowsMode = true; }
    else if (parts[0] === 'buttons') { page = 'buttons'; btnMode = true; }
    else if (parts[0] === 'titles' && parts[1]) { page = 'title'; wantSlug = parts[1].toLowerCase(); }
    else { page = 'titles'; readListState(); }
    if (page !== 'title') { if (currentId === '__new__' || !dirty) { currentId = null; draft = null; setDirty(false); } }
    resolveTitle();
    showPage();
    if (page === 'titles') renderList(); else renderEditor();
    if (page === 'title' && wantSlug === 'new') { var t = $('f_title'); if (t) t.focus(); }
  }
  function canLeave(nextPath) {
    if (!dirty || page !== 'title') return true;
    if (nextPath && nextPath === location.pathname) return true;
    var target = nextPath || (location.pathname + location.search);
    if (leaveAsking) return false;
    leaveAsking = true;
    askConfirm('Leave without saving?', 'You have unsaved changes to ' + ((draft && draft.title) || 'this title') + '.', 'Discard changes', true).then(function (yes) {
      leaveAsking = false;
      if (!yes) return;
      var m = movies.find(function (x) { return x.id === currentId; });
      draft = m ? clone(m.data) : null; if (!m) currentId = null; setDirty(false);
      history.pushState(null, '', target); window.dispatchEvent(new PopStateEvent('popstate'));
    });
    return false;
  }
  var leaveAsking = false;
  function select(id) {
    currentId = id; pendingSwitch = null; remoteChanged = false; confirmDelete = false;
    var m = movies.find(function (x) { return x.id === id; });
    draft = m ? clone(m.data) : null;
    setDirty(false);
    if (page === 'title') { showPage(); renderEditor(); }
  }
  function setDirty(v) {
    dirty = v;
    var bar = $('savebar');
    bar.hidden = !(v || saving);
    $('saveBtn').disabled = !v || saving || !canWrite;
    $('saveMsg').innerHTML = '';
    $('saveMsg').appendChild(document.createTextNode(saving ? 'Saving…' : 'Unsaved changes to '));
    if (!saving) $('saveMsg').appendChild(h('b', { text: (draft && draft.title) || 'this title' }));
  }
  function touch() { if (!dirty) setDirty(true); }

  // ---------- genre picker ----------
  // A fixed list so a typo can't create a new genre. Stored as "Crime, Thriller" (main genre first), which the
  // site's genre pages already read (app/main.js genreTags, scripts/build.mjs GENRE_RULES).
  var GENRE_LIST = ['Action', 'Adventure', 'Animated', 'Anthology', 'Biopic', 'Black comedy', "Children's", 'Comedy', 'Coming-of-age',
    'Crime', 'Devotional', 'Disaster', 'Documentary', 'Drama', 'Erotic', 'Family', 'Fantasy', 'Game show', 'Gangster', 'Heist', 'Historical',
    'Horror', 'Horror comedy', 'Legal', 'Masala', 'Medical', 'Melodrama', 'Musical', 'Mystery', 'Mythological', 'Period', 'Political',
    'Psychological', 'Quiz show', 'Reality', 'Romance', 'Romantic comedy', 'Satire', 'Sci-fi', 'Sitcom', 'Soap opera', 'Social', 'Sports',
    'Spy', 'Superhero', 'Supernatural', 'Survival', 'Talk show', 'Teen', 'Thriller', 'War', 'Western'];
  var GENRE_MAX = 3;
  // Old free-text labels → list entries ("Romantic drama" → Romance, Drama). Used only to pre-select the picker.
  var GENRE_WORDS = [[/^rom-?com|^romantic comedy/, 'Romantic comedy'], [/^black comedy|^dark comedy/, 'Black comedy'], [/^horror comedy|^comedy horror/, 'Horror comedy'],
    [/coming-of-age/, 'Coming-of-age'], [/roman/, 'Romance'], [/biograph|biopic/, 'Biopic'], [/science|sci-fi/, 'Sci-fi'], [/sport/, 'Sports'], [/histor/, 'Historical'],
    [/animat/, 'Animated'], [/courtroom|legal/, 'Legal'], [/child/, "Children's"], [/music/, 'Musical'], [/myth/, 'Mythological'], [/epic/, 'Historical']];
  function genreParts(s) {
    var out = [];
    String(s || '').split(/[,/;]/).forEach(function (p) {
      p = p.trim().toLowerCase(); if (!p) return;
      var exact = GENRE_LIST.filter(function (g) { return g.toLowerCase() === p; })[0];
      var add = function (g) { if (g && out.indexOf(g) === -1) out.push(g); };
      if (exact) return add(exact);
      for (var i = 0; i < GENRE_WORDS.length; i++) if (GENRE_WORDS[i][0].test(p) && GENRE_WORDS[i][1].indexOf(' ') !== -1) { add(GENRE_WORDS[i][1]); return; }
      p.split(/\s+/).forEach(function (w) {
        var hit = GENRE_LIST.filter(function (g) { return g.toLowerCase() === w; })[0];
        if (!hit) for (var j = 0; j < GENRE_WORDS.length; j++) if (GENRE_WORDS[j][0].test(w)) { hit = GENRE_WORDS[j][1]; break; }
        add(hit);
      });
    });
    return out;
  }
  // The site's browse genres a value appears under (same rules as app/main.js genreTags).
  var BROWSE_RULES = [['Action', /action|spy|superhero|heist/], ['Comedy', /comed|rom-com/], ['Drama', /drama/], ['Thriller', /thriller|mystery|crime/], ['Horror', /horror/],
    ['Romance', /roman|rom-com/], ['Family', /family/], ['Animated', /animat/], ['Biopic', /biograph|biopic/], ['Mythological', /myth|epic/], ['War', /war/], ['Sci-fi', /science|sci-fi/]];
  function browseGenres(s) { s = String(s || '').toLowerCase(); return BROWSE_RULES.filter(function (r) { return r[1].test(s); }).map(function (r) { return r[0]; }); }
  function genreField() {
    var original = draft.genre || '';
    var picked = genreParts(original);
    var exactOld = picked.join(', ').toLowerCase() === original.trim().toLowerCase();
    var isMissing = !original;
    var pill = h('span', { class: 'miss', text: 'MISSING', hidden: !isMissing });
    var box = h('div', { class: 'gpick' }), note = h('span', { class: 'note' });
    function draw() {
      box.innerHTML = '';
      picked.forEach(function (g, i) {
        box.appendChild(h('span', { class: 'gchip' + (i === 0 ? ' main' : '') }, [
          i === 0 ? h('span', { class: 'sr', text: 'Main genre: ' }) : null, g,
          h('button', { type: 'button', class: 'gx', 'aria-label': 'Remove ' + g, text: '×', disabled: !canWrite,
            on: { click: function () { picked.splice(i, 1); changed(); } } })
        ]));
      });
      if (picked.length < GENRE_MAX) {
        var sel = h('select', { class: 'in', 'aria-label': 'Add a genre', disabled: !canWrite },
          [h('option', { value: '', text: picked.length ? 'Add another genre…' : 'Choose a genre…' })].concat(
            GENRE_LIST.filter(function (g) { return picked.indexOf(g) === -1; }).map(function (g) { return h('option', { value: g, text: g }); })));
        sel.addEventListener('change', function () { if (sel.value) { picked.push(sel.value); changed(); } });
        box.appendChild(sel);
      }
      var under = browseGenres(picked.join(', '));
      var oldNote = original && !exactOld && draft.genre === original ? 'Saved as “' + original + '”, which stays as it is unless you change the genres here. ' : '';
      note.textContent = oldNote + 'Pick up to ' + GENRE_MAX + ', main genre first. ' +
        (picked.length ? (under.length ? 'Listed under the site’s genre pages: ' + under.join(', ') + '.' : 'Not listed under any of the site’s genre pages.') : '');
      pill.hidden = !!picked.length;
    }
    function changed() { draft.genre = picked.join(', '); touch(); draw(); }
    draw();
    return h('div', { class: 'field', role: 'group', 'aria-label': 'Genre' }, [h('label', { class: 'l' }, ['Genre', pill]), box, note]);
  }

  // ---------- streaming platform picker ----------
  // A list instead of free text, so names match the logos on poster tiles (app/main.js PLAT). Platforms already used on any
  // title are added to the list, so one you add by hand shows up as an option next time.
  var OTT_LIST = ['Netflix', 'Prime Video', 'JioHotstar', 'ZEE5', 'SonyLIV', 'Sun NXT', 'aha', 'Hoichoi', 'ALTT', 'Amazon MX Player', 'Amazon miniTV',
    'Apple TV', 'YouTube', 'Lionsgate Play', 'discovery+', 'Eros Now', 'ShemarooMe', 'Hungama Play', 'Ultra Jhakaas', 'Planet Marathi', 'ManoramaMAX',
    'Simply South', 'Chaupal', 'Addatimes', 'Klikk', 'Tentkotta', 'Namma Flix', 'Saina Play', 'Neestream', 'Koode', 'Crunchyroll', 'MUBI',
    'BookMyShow Stream', 'Vi Movies & TV', 'YuppTV', 'Airtel Xstream Play', 'Tata Play Binge', 'Waves', 'Stage', 'Epic ON', 'DocuBay', 'Dangal Play',
    'TVFPlay', 'Viu', 'Ullu', 'Gemplex', 'Bongo', 'Bioscope', 'Binge', 'Chorki', 'Flipkart Video', 'PowerKids', 'JioCinema (now JioHotstar)', 'Voot (now JioHotstar)', 'Disney+ Hotstar (now JioHotstar)'];
  var TV_LIST = ['StarPlus', 'Colors', 'Sony Entertainment Television', 'Zee TV', 'Star Bharat', '&TV', 'Sony SAB', 'DD National', 'Sony Pal', 'Zee Anmol',
    'Dangal', 'Shemaroo TV', 'Sun TV', 'Star Vijay', 'Zee Tamil', 'Colors Tamil', 'Asianet', 'Mazhavil Manorama', 'Zee Keralam', 'Flowers TV',
    'Star Maa', 'Gemini TV', 'Zee Telugu', 'ETV Telugu', 'Colors Kannada', 'Zee Kannada', 'Star Suvarna', 'Udaya TV', 'Star Pravah', 'Zee Marathi',
    'Colors Marathi', 'Sony Marathi', 'Star Jalsha', 'Zee Bangla', 'Colors Bangla', 'Colors Gujarati', 'PTC Punjabi', 'Nickelodeon', 'Disney Channel',
    'Pogo', 'Cartoon Network', 'MTV', 'Discovery', 'Animal Planet', 'History TV18', 'TLC', 'Investigation Discovery', 'Epic TV'];
  function platformField(label, withTv, note) {
    var cur = draft.platform || '', used = {};
    movies.forEach(function (m) { var p = (m.data.platform || '').trim(); if (p) used[p] = 1; });
    var known = OTT_LIST.concat(TV_LIST), lower = known.map(function (x) { return x.toLowerCase(); });
    var extra = Object.keys(used).filter(function (p) { return lower.indexOf(p.toLowerCase()) === -1; }).sort();
    var sel = h('select', { id: 'f_platform', class: 'in', disabled: !canWrite });
    var opt = function (v, t) { return h('option', { value: v, text: t || v, selected: v === cur }); };
    sel.appendChild(opt('', withTv ? 'Not set' : 'Not known'));
    sel.appendChild(h('optgroup', { label: 'Streaming services' }, OTT_LIST.map(function (x) { return opt(x); })));
    if (withTv) sel.appendChild(h('optgroup', { label: 'TV channels' }, TV_LIST.map(function (x) { return opt(x); })));
    if (extra.length) sel.appendChild(h('optgroup', { label: 'Also used on titles here' }, extra.map(function (x) { return opt(x); })));
    if (cur && known.indexOf(cur) === -1 && extra.indexOf(cur) === -1) sel.appendChild(opt(cur));
    sel.appendChild(h('option', { value: '__new__', text: '+ Add a new platform…' }));
    var box = h('input', { class: 'in', type: 'text', placeholder: 'Type the platform’s name, e.g. Lionsgate Play', hidden: true, disabled: !canWrite });
    sel.addEventListener('change', function () {
      if (sel.value === '__new__') { box.hidden = false; box.value = ''; box.focus(); return; }
      box.hidden = true; draft.platform = sel.value; touch();
    });
    box.addEventListener('input', function () { draft.platform = box.value.trim(); touch(); });
    return h('div', { class: 'field' }, [
      h('label', { class: 'l', for: 'f_platform' }, [label]), sel, box,
      h('span', { class: 'note', text: (note ? note + ' ' : '') + 'Pick from the list, or choose “+ Add a new platform…” to type one. A platform you add is offered on every title after that.' })
    ]);
  }

  // Cities for ticket booking links. Popular ones are always listed; any other city can be added per title.
  var POP_CITIES = ['Mumbai', 'Delhi-NCR', 'Bengaluru', 'Hyderabad', 'Chandigarh', 'Ahmedabad', 'Pune', 'Chennai', 'Kolkata', 'Kochi'];
  // Booking links by city. Older titles have a single bookingUrl, which was added for Bengaluru.
  function bookUrls(d) {
    var o = {}, src = d.bookingUrls || {};
    Object.keys(src).forEach(function (c) { var u = String(src[c] || '').trim(); if (u) o[c] = u; });
    if (d.bookingUrl && !o.Bengaluru && !('Bengaluru' in src)) o.Bengaluru = String(d.bookingUrl).trim();
    return o;
  }
  var OTHER_CITIES = ['Agra', 'Ajmer', 'Aligarh', 'Allahabad (Prayagraj)', 'Amravati', 'Amritsar', 'Anand', 'Asansol', 'Aurangabad', 'Bareilly', 'Belagavi', 'Bhavnagar', 'Bhilai', 'Bhopal', 'Bhubaneswar', 'Bikaner', 'Calicut (Kozhikode)', 'Coimbatore', 'Cuttack', 'Davanagere', 'Dehradun', 'Dhanbad', 'Durgapur', 'Erode', 'Gandhinagar', 'Goa', 'Gorakhpur', 'Guntur', 'Guwahati', 'Gwalior', 'Haridwar', 'Hubballi', 'Indore', 'Jabalpur', 'Jaipur', 'Jalandhar', 'Jammu', 'Jamnagar', 'Jamshedpur', 'Jodhpur', 'Kakinada', 'Kannur', 'Kanpur', 'Karimnagar', 'Kolhapur', 'Kollam', 'Kota', 'Kottayam', 'Kurnool', 'Lucknow', 'Ludhiana', 'Madurai', 'Mangaluru', 'Manipal', 'Meerut', 'Mohali', 'Moradabad', 'Mysuru', 'Nagpur', 'Nanded', 'Nashik', 'Nellore', 'Noida', 'Palakkad', 'Panipat', 'Patiala', 'Patna', 'Puducherry', 'Raipur', 'Rajahmundry', 'Rajkot', 'Ranchi', 'Rourkela', 'Salem', 'Sangli', 'Shillong', 'Shimla', 'Siliguri', 'Solapur', 'Srinagar', 'Surat', 'Thane', 'Thiruvananthapuram', 'Thrissur', 'Tiruchirappalli', 'Tirunelveli', 'Tirupati', 'Udaipur', 'Ujjain', 'Vadodara', 'Varanasi', 'Vellore', 'Vijayawada', 'Visakhapatnam', 'Warangal'];
  // Ticket booking URLs, one per city. The 10 popular cities always have a box; “+ Add” takes any other city.
  // Booking partners: partner 1 is bookingPlatform + bookingUrls (as before); more partners live in moreBooking [{ platform, urls }].
  var MAX_PARTNERS = 3;
  function morePartners() { if (!Array.isArray(draft.moreBooking)) draft.moreBooking = []; return draft.moreBooking; }
  function bkId(pi, c) { return 'f_bk_' + (pi ? pi + '_' : '') + c.toLowerCase().replace(/[^a-z0-9]+/g, '-'); }
  function bookingUrlsField(pi) {
    pi = pi || 0;
    var mp = pi ? morePartners()[pi - 1] : null, urls;
    if (pi) { var src = mp.urls || {}; urls = {}; Object.keys(src).forEach(function (c) { var u = String(src[c] || '').trim(); if (u) urls[c] = u; }); mp.urls = urls; }
    else urls = draft.bookingUrls = bookUrls(draft);
    var sync = function () { if (!pi) draft.bookingUrl = urls.Bengaluru || ''; touch(); if (bkRefresh) bkRefresh(); };
    var rows = h('div', { class: 'cityurls' });
    var idOf = function (c) { return bkId(pi, c); };
    var row = function (city, removable) {
      var inp = h('input', { id: idOf(city), class: 'in', type: 'url', placeholder: pi ? 'https://…' : 'https://in.bookmyshow.com/…', disabled: !canWrite });
      inp.value = urls[city] || '';
      inp.addEventListener('input', function () { var v = inp.value.trim(); if (v) urls[city] = v; else delete urls[city]; sync(); });
      var r = h('div', { class: 'cityrow' }, [h('label', { class: 'cl', for: idOf(city), text: city }), inp,
        removable ? h('button', { type: 'button', class: 'btn small', disabled: !canWrite, text: 'Remove', on: { click: function () { delete urls[city]; r.remove(); sync(); } } }) : h('span')]);
      return r;
    };
    POP_CITIES.forEach(function (c) { rows.appendChild(row(c, false)); });
    Object.keys(urls).filter(function (c) { return POP_CITIES.indexOf(c) === -1; }).sort().forEach(function (c) { rows.appendChild(row(c, true)); });
    var known = {}; OTHER_CITIES.forEach(function (c) { known[c] = 1; });
    movies.forEach(function (m) { Object.keys(m.data.bookingUrls || {}).forEach(function (c) { known[c] = 1; }); (m.data.moreBooking || []).forEach(function (p) { Object.keys((p && p.urls) || {}).forEach(function (c) { known[c] = 1; }); }); });
    var dl = h('datalist', { id: 'cityList' + (pi || '') }, Object.keys(known).filter(function (c) { return POP_CITIES.indexOf(c) === -1; }).sort().map(function (c) { return h('option', { value: c }); }));
    var add = h('input', { class: 'in', type: 'text', list: 'cityList' + (pi || ''), placeholder: 'Another city, e.g. Jaipur', disabled: !canWrite });
    var addIt = function () {
      var name = add.value.trim().replace(/\s+/g, ' '); if (!name) return;
      var all = POP_CITIES.concat(Object.keys(urls), Object.keys(known));
      var hit = all.filter(function (c) { return c.toLowerCase() === name.toLowerCase(); })[0]; if (hit) name = hit;
      var ex = $(idOf(name)); add.value = '';
      if (ex) { ex.focus(); return; }
      var r = row(name, true); rows.appendChild(r); r.querySelector('input').focus();
    };
    add.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addIt(); } });
    return h('div', { class: 'field wide' }, [h('label', { class: 'l' }, ['Ticket booking URLs by city']),
      h('span', { class: 'note', text: pi ? 'Only the cities this partner sells tickets in. Where two partners cover a city, Book tickets lets visitors choose.' : 'Visitors pick their city at the top of the site, and Book tickets opens that city’s link. Leave a city blank to hide the button there.' }),
      rows, h('div', { class: 'cityrow' }, [h('span', { class: 'cl', text: '+ Add a city' }), add, h('button', { type: 'button', class: 'btn small', disabled: !canWrite, text: 'Add', on: { click: addIt } })]), dl]);
  }

  // Ticket booking platform: a list, with “+ Add a new platform…” for anything else (offered on every title after that).
  var BOOK_LIST = ['BookMyShow', 'District', 'PVR INOX', 'Cinépolis', 'Miraj Cinemas', 'Movietime Cinemas', 'Carnival Cinemas', 'Rajhans Cinemas', 'Mukta A2 Cinemas', 'Ticketnew'];
  function bookingField(pi) {
    pi = pi || 0;
    var mp = pi ? morePartners()[pi - 1] : null, fid = 'f_bookingPlatform' + (pi ? '_' + pi : '');
    var get = function () { return (pi ? mp.platform : draft.bookingPlatform) || ''; }, set = function (v) { if (pi) mp.platform = v; else draft.bookingPlatform = v; };
    var cur = get(), extra = {};
    var addExtra = function (p) { p = (p || '').trim(); if (p && BOOK_LIST.indexOf(p) === -1) extra[p] = 1; };
    movies.forEach(function (m) { addExtra(m.data.bookingPlatform); (m.data.moreBooking || []).forEach(function (x) { addExtra(x && x.platform); }); });
    addExtra(cur);
    var opt = function (v, t) { return h('option', { value: v, text: t || v, selected: v === cur }); };
    var sel = h('select', { id: fid, class: 'in', disabled: !canWrite },
      [opt('', 'Not set')].concat(BOOK_LIST.map(function (x) { return opt(x); }), Object.keys(extra).sort().map(function (x) { return opt(x); }),
        [h('option', { value: '__new__', text: '+ Add a new platform…' })]));
    var box = h('input', { class: 'in', type: 'text', placeholder: 'Type the booking platform’s name', hidden: true, disabled: !canWrite });
    sel.addEventListener('change', function () {
      if (sel.value === '__new__') { box.hidden = false; box.value = ''; box.focus(); return; }
      box.hidden = true; set(sel.value); touch(); if (bkRefresh) bkRefresh();
    });
    box.addEventListener('input', function () { set(box.value.trim()); touch(); if (bkRefresh) bkRefresh(); });
    return h('div', { class: 'field' }, [h('label', { class: 'l', for: fid }, ['Ticket booking platform']), sel, box,
      h('span', { class: 'note', text: 'Names the Book tickets button, e.g. “Book on BookMyShow”.' })]);
  }

  // ---------- editor ----------
  function field(label, key, opts) {
    opts = opts || {};
    var id = 'f_' + key;
    var isMissing = REQUIRED.some(function (r) { return r[0] === key; }) && !draft[key];
    var input;
    if (opts.type === 'select') {
      input = h('select', { id: id, class: 'in' }, opts.options.map(function (o) { return h('option', { value: o, text: o, selected: draft[key] === o }); }));
    } else if (opts.type === 'textarea') {
      input = h('textarea', { id: id, class: 'in', rows: 4, placeholder: opts.placeholder || '' });
      input.value = draft[key] || '';
    } else {
      input = h('input', { id: id, class: 'in', type: opts.type || 'text', placeholder: opts.placeholder || '' });
      input.value = draft[key] || '';
    }
    input.disabled = !canWrite;
    var pill = h('span', { class: 'miss', text: 'MISSING', hidden: !isMissing });
    input.addEventListener('input', function () {
      draft[key] = input.value; touch();
      pill.hidden = !(REQUIRED.some(function (r) { return r[0] === key; }) && !input.value);
      if (key === 'title') { var t = $('pvTitle'); if (t) t.textContent = input.value || 'Untitled'; setDirty(true); }
      if (key === 'section') renderEditor();
    });
    return h('div', { class: 'field' + (opts.wide ? ' wide' : '') }, [
      h('label', { class: 'l', for: id }, [label, pill]), input,
      opts.note ? h('span', { class: 'note', text: opts.note }) : null
    ]);
  }

  function imageSlot(kind) {
    var isPoster = kind === 'poster';
    var urlKey = kind + 'Url', idKey = kind + 'Id';
    var errEl = h('span', { class: 'err', hidden: true });
    var warnEl = h('span', { class: 'warn', hidden: true });
    var fileIn = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', class: 'sr', id: 'file_' + kind, tabindex: '-1' });
    var drop = h('div', { class: 'drop ' + kind + (draft[urlKey] ? ' has' : ''), style: bgUrl(draft[urlKey]) });
    var hint = h('div', { class: 'hint' }, [
      h('div', { style: 'font-weight:600;color:var(--text)', text: isPoster ? 'Poster / thumbnail' : 'Banner / backdrop' }),
      h('div', { text: isPoster ? '2:3 · e.g. 1000 × 1500 px' : '16:9 · e.g. 1920 × 1080 px' }),
      h('div', { text: canUpload ? 'Drop an image here or choose a file' : 'Uploads need editor access' })
    ]);
    var pick = h('button', { type: 'button', class: 'btn small primary', text: draft[urlKey] ? 'Replace' : 'Choose image', disabled: !canUpload,
      on: { click: function () { fileIn.click(); } } });
    var remove = draft[urlKey] ? h('button', { type: 'button', class: 'btn small', text: 'Remove', disabled: !canWrite,
      on: { click: function () { draft[urlKey] = ''; draft[idKey] = ''; touch(); renderEditor(); } } }) : null;
    drop.appendChild(hint);
    drop.appendChild(h('div', { class: 'acts' }, [pick, remove]));

    function handle(file) {
      errEl.hidden = true; warnEl.hidden = true;
      if (!file) return;
      if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { errEl.textContent = 'Use a PNG, JPEG or WebP image.'; errEl.hidden = false; return; }
      if (file.size > 10 * 1024 * 1024) { errEl.textContent = 'That image is over 10 MB.'; errEl.hidden = false; return; }
      var img = new Image(); var obj = URL.createObjectURL(file);
      img.onload = function () {
        var want = isPoster ? 2 / 3 : 16 / 9, got = img.naturalWidth / img.naturalHeight;
        URL.revokeObjectURL(obj);
        if (Math.abs(got - want) / want > 0.06) {
          warnEl.textContent = 'This image is ' + img.naturalWidth + ' × ' + img.naturalHeight + ' px; it will be cropped to ' + (isPoster ? '2:3.' : '16:9.');
          warnEl.hidden = false;
        }
      };
      img.src = obj;
      pick.disabled = true; pick.textContent = 'Uploading…';
      assets.upload(file).then(function (res) {
        draft[urlKey] = res.url; draft[idKey] = res.id; touch();
        drop.classList.add('has'); drop.setAttribute('style', bgUrl(res.url));
        pick.disabled = false; pick.textContent = 'Replace';
        updatePreview();
      }).catch(function (e) {
        pick.disabled = false; pick.textContent = draft[urlKey] ? 'Replace' : 'Choose image';
        errEl.textContent = 'Upload failed' + (e && e.message ? ': ' + e.message : '') + '.'; errEl.hidden = false;
      });
    }
    fileIn.addEventListener('change', function () { handle(fileIn.files[0]); fileIn.value = ''; });
    if (canUpload) {
      drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('over'); });
      drop.addEventListener('dragleave', function () { drop.classList.remove('over'); });
      drop.addEventListener('drop', function (e) { e.preventDefault(); drop.classList.remove('over'); handle(e.dataTransfer.files[0]); });
    }
    var label = h('span', { class: 'l' }, [isPoster ? 'Poster (used for thumbnails)' : 'Banner (title page and home carousel)',
      h('span', { class: 'miss', text: 'MISSING', hidden: !!draft[urlKey] })]);
    return h('div', { class: 'field' }, [label, drop, fileIn, warnEl, errEl]);
  }

  function videoSlot() {
    var errEl = h('span', { class: 'err', hidden: true });
    var fileIn = h('input', { type: 'file', accept: 'video/mp4,video/webm', class: 'sr', id: 'file_trailer', tabindex: '-1' });
    var url = safeUrl(draft.trailerFileUrl);
    var box = h('div', { class: 'drop banner clip' + (url ? ' has' : ''), style: 'padding:0;overflow:hidden' });
    if (url) {
      var vid = h('video', { src: url, controls: true, playsinline: true, preload: 'metadata', style: 'width:100%;height:100%;object-fit:cover;background:#000' });
      vid.setAttribute('aria-label', 'Trailer clip preview');
      box.appendChild(vid);
    } else {
      box.appendChild(h('div', { class: 'hint', style: 'padding:12px' }, [
        h('div', { style: 'font-weight:600;color:var(--text)', text: 'Trailer clip (plays in the home banner)' }),
        h('div', { text: 'MP4 or WebM · up to 20 MB · 16:9' }),
        h('div', { text: canUpload ? 'Drop a video here or choose a file' : 'Uploads need editor access' })
      ]));
    }
    var pick = h('button', { type: 'button', class: 'btn small primary', text: url ? 'Replace clip' : 'Choose video', disabled: !canUpload, on: { click: function () { fileIn.click(); } } });
    var remove = url ? h('button', { type: 'button', class: 'btn small', text: 'Remove clip', disabled: !canWrite, on: { click: function () { draft.trailerFileUrl = ''; draft.trailerFileId = ''; touch(); renderEditor(); } } }) : null;
    function handle(file) {
      errEl.hidden = true;
      if (!file) return;
      if (!/^video\/(mp4|webm)$/.test(file.type)) { errEl.textContent = 'Use an MP4 or WebM video.'; errEl.hidden = false; return; }
      if (file.size > 20 * 1024 * 1024) { errEl.textContent = 'That file is ' + Math.round(file.size / 1048576) + ' MB. Clips must be 20 MB or less: trim it or export at a lower bitrate.'; errEl.hidden = false; return; }
      pick.disabled = true; pick.textContent = 'Uploading…';
      assets.upload(file).then(function (res) {
        draft.trailerFileUrl = res.url; draft.trailerFileId = res.id; touch(); renderEditor();
      }).catch(function (e) {
        pick.disabled = false; pick.textContent = url ? 'Replace clip' : 'Choose video';
        errEl.textContent = 'Upload failed' + (e && e.message ? ': ' + e.message : '') + '.'; errEl.hidden = false;
      });
    }
    fileIn.addEventListener('change', function () { handle(fileIn.files[0]); fileIn.value = ''; });
    if (canUpload) {
      box.addEventListener('dragover', function (e) { e.preventDefault(); box.classList.add('over'); });
      box.addEventListener('dragleave', function () { box.classList.remove('over'); });
      box.addEventListener('drop', function (e) { e.preventDefault(); box.classList.remove('over'); handle(e.dataTransfer.files[0]); });
    }
    return h('div', { class: 'field' }, [
      box, h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [pick, remove]), fileIn, errEl,
      h('span', { class: 'note', text: 'YouTube links can’t play inside the page, so upload the clip here to have ▶ Trailer play in the banner. Without a clip, ▶ Trailer opens the YouTube link instead.' })
    ]);
  }
  function updatePreview() {
    var bg = $('pvBg'), pp = $('pvPoster');
    if (bg) bg.setAttribute('style', bgUrl(draft.bannerUrl));
    if (pp) pp.setAttribute('style', bgUrl(draft.posterUrl));
  }

  // Under each cast row: tells you whether the name is a known person, offers close matches, or lets you add them.
  function knownPersonKeys() {
    var k = {}; Object.keys(people).forEach(function (x) { k[x] = 1; });
    // saved titles (including the saved version of this one); unsaved new names count as new
    movies.forEach(function (m) { (m.data.cast || []).forEach(function (c) { var x = personKey(c.name); if (x) k[x] = 1; }); });
    return k;
  }
  function castHint(item, redraw) {
    var el = h('div', { class: 'note', style: 'margin:-2px 0 6px 56px;display:flex;flex-wrap:wrap;gap:6px;align-items:center' });
    function update() {
      el.innerHTML = '';
      var name = (item.name || '').trim(), k = personKey(name);
      if (!k) { el.hidden = true; return; }
      el.hidden = false;
      if (knownPersonKeys()[k]) { el.appendChild(h('span', {}, ['✓ ', h('a', { href: '/person/' + k, target: '_blank', rel: 'noopener', text: '/person/' + k })])); return; }
      var sim = similarPeople(name).slice(0, 3);
      el.appendChild(h('span', { class: 'warn', text: sim.length ? 'Not in your cast list. Did you mean' : 'New person — not in your cast list yet.' }));
      sim.forEach(function (p) { el.appendChild(h('button', { type: 'button', class: 'btn small', style: 'height:28px', text: p.name, on: { click: function () { item.name = p.name; touch(); redraw(); } } })); });
      el.appendChild(h('button', { type: 'button', class: 'btn small primary', style: 'height:28px', disabled: !canWrite, text: sim.length ? 'No — add “' + name + '” as new' : 'Add with details', on: { click: function () {
        openPersonForm({ name: name, onSaved: function (finalName) { item.name = finalName; touch(); redraw(); } });
      } } }));
    }
    update();
    return { el: el, update: update };
  }
  // Cast name cell: a picked person is locked (remove the row to change it); an empty row is a search-and-pick box.
  function castNameLocked(item) {
    var k = personKey(item.name);
    return h('div', { class: 'cname' }, [
      h('strong', { text: item.name }),
      h('a', { href: '/person/' + k, target: '_blank', rel: 'noopener', text: '/person/' + k })
    ]);
  }
  function castPicker(id, onPick) {
    var wrap = h('div', { class: 'pick' });
    var inp = h('input', { id: id, class: 'in', placeholder: 'Search cast & crew…', autocomplete: 'off', role: 'combobox', 'aria-expanded': 'false', 'aria-autocomplete': 'list', 'aria-controls': id + '_lb', disabled: !canWrite });
    var lb = h('ul', { id: id + '_lb', class: 'picklist', role: 'listbox', hidden: true });
    var opts = [], active = -1;
    function close() { lb.hidden = true; inp.setAttribute('aria-expanded', 'false'); active = -1; }
    function choose(o) { close(); if (o.add) openPersonForm({ name: o.add, onSaved: onPick }); else onPick(o.name); }
    function setActive(i) {
      active = i;
      Array.prototype.forEach.call(lb.children, function (li, j) { li.setAttribute('aria-selected', String(j === i)); });
      if (i >= 0) { inp.setAttribute('aria-activedescendant', id + '_o' + i); var li = lb.children[i]; if (li && li.scrollIntoView) li.scrollIntoView({ block: 'nearest' }); }
      else inp.removeAttribute('aria-activedescendant');
    }
    function render() {
      var q = inp.value.trim(), qk = personKey(q), ql = q.toLowerCase();
      var list = allPeople();
      var hits = !q ? list.slice(0, 8) : list.filter(function (p) {
        return p.name.toLowerCase().indexOf(ql) !== -1 || (qk && p.key.indexOf(qk) !== -1);
      }).sort(function (a, b) {
        var as = a.name.toLowerCase().indexOf(ql) === 0 ? 0 : 1, bs = b.name.toLowerCase().indexOf(ql) === 0 ? 0 : 1;
        return as - bs || b.titles.length - a.titles.length;
      }).slice(0, 8);
      if (q && hits.length < 3) similarPeople(q, list).forEach(function (p) { if (hits.length < 8 && !hits.some(function (x) { return x.key === p.key; })) hits.push(p); });
      opts = hits.map(function (p) { return { name: p.name, key: p.key, sub: p.titles.length ? p.titles.length + (p.titles.length === 1 ? ' title' : ' titles') : 'no titles yet' }; });
      var exact = qk && hits.some(function (p) { return p.key === qk; });
      if (q && !exact) opts.push({ add: q });
      lb.innerHTML = '';
      if (!opts.length) { lb.appendChild(h('li', { class: 'none', text: 'Type a name to search' })); }
      opts.forEach(function (o, i) {
        var li = h('li', { id: id + '_o' + i, role: 'option', 'aria-selected': 'false', class: o.add ? 'add' : '' },
          o.add ? ['+ Add new person “' + o.add + '”'] : [h('span', { text: o.name }), h('small', { text: o.sub })]);
        li.addEventListener('mousedown', function (e) { e.preventDefault(); choose(o); });
        lb.appendChild(li);
      });
      lb.hidden = false; inp.setAttribute('aria-expanded', 'true'); setActive(q && opts.length ? 0 : -1);
    }
    inp.addEventListener('input', render);
    inp.addEventListener('focus', render);
    inp.addEventListener('blur', function () { setTimeout(close, 120); });
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (lb.hidden) render(); setActive(Math.min(active + 1, opts.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(active - 1, 0)); }
      else if (e.key === 'Enter') { e.preventDefault(); if (!lb.hidden && active >= 0 && opts[active]) choose(opts[active]); }
      else if (e.key === 'Escape') { close(); }
    });
    wrap.appendChild(inp); wrap.appendChild(lb);
    return wrap;
  }
  function listEditor(title, key, cols, empty) {
    var rows = h('div', { class: 'rows' });
    function draw() {
      rows.innerHTML = '';
      var arr = draft[key] || [];
      if (!arr.length) rows.appendChild(h('div', { class: 'note', text: empty }));
      arr.forEach(function (item, i) {
        var av = key === 'cast' ? avatarBtn(item.name || '') : null;
        if (av && !(item.name || '').trim()) av.disabled = true;
        var cells = cols.map(function (c) {
          var lab = h('label', { class: 'sr', for: key + i + c.k, text: c.label + ' ' + (i + 1) });
          var el;
          if (key === 'cast' && c.k === 'name') {
            el = (item.name || '').trim() ? castNameLocked(item)
              : castPicker(key + i + c.k, function (nm) {
                  var dup = arr.some(function (o, j) { return j !== i && personKey(o.name) === personKey(nm); });
                  var apply = function () { item.name = nm; touch(); draw(); var r = rows.querySelector('#' + key + i + 'role'); if (r) r.focus(); };
                  if (!dup) { apply(); return; }
                  askConfirm(nm + ' is already in this cast', 'Add them again, for example for a second role?', 'Add again').then(function (yes) { if (yes) apply(); });
                });
            if (el.classList.contains('cname')) lab = null;
            return h('span', { style: 'min-width:0' }, [lab, el]);
          } else if (c.options) {
            el = h('select', { id: key + i + c.k, class: 'in', disabled: !canWrite }, c.options.map(function (o) { return h('option', { value: o, text: o, selected: (item[c.k] || '').toLowerCase() === o.toLowerCase() }); }));
          } else {
            el = h('input', { id: key + i + c.k, class: 'in', placeholder: c.label, disabled: !canWrite, autocomplete: 'off' }); el.value = item[c.k] || '';
          }
          el.addEventListener('input', function () { item[c.k] = el.value; touch(); });
          el.addEventListener('change', function () { item[c.k] = el.value; touch(); });
          return h('span', { style: 'min-width:0' }, [lab, el]);
        });
        // Videos: ★ picks the one the Movies / TV Shows page banner plays for this title (draft.bannerVideo, its URL).
        if (key === 'videos') {
          var star = !!item.url && draft.bannerVideo === item.url;
          cells.push(h('button', { type: 'button', class: 'x vstar' + (star ? ' on' : ''), 'aria-pressed': String(star), disabled: !canWrite,
            'aria-label': (star ? 'Stop featuring' : 'Feature') + ' video ' + (i + 1) + ' on the banner', title: star ? 'Plays on the banner. Click to unpick.' : 'Play this video on the banner',
            text: star ? '★' : '☆', on: { click: function () {
              if (!String(item.url || '').trim()) { setStatus('Add the YouTube link first.'); return; }
              draft.bannerVideo = star ? '' : item.url; touch(); draw();
            } } }));
        }
        cells.push(h('button', { type: 'button', class: 'x', 'aria-label': 'Remove row ' + (i + 1), text: '×', disabled: !canWrite,
          on: { click: function () { if (key === 'videos' && item.url && draft.bannerVideo === item.url) draft.bannerVideo = ''; arr.splice(i, 1); touch(); draw(); } } }));
        if (av) cells.unshift(av);
        rows.appendChild(h('div', { class: 'row' + (cols.length > 2 ? ' v' : '') + (key === 'videos' ? ' feat' : '') + (av ? ' cast' : '') }, cells));
      });
    }
    draw();
    var add = h('button', { type: 'button', class: 'btn small', text: '+ Add', disabled: !canWrite, on: { click: function () {
      draft[key] = draft[key] || []; var o = {}; cols.forEach(function (c) { o[c.k] = c.options ? c.options[0] : ''; }); draft[key].push(o); touch(); draw();
      var last = rows.querySelector('.row:last-child input'); if (last) last.focus();
    } } });
    var extra = key === 'cast' ? h('button', { type: 'button', class: 'btn small', text: '+ New person', disabled: !canWrite, on: { click: function () {
      openPersonForm({ onSaved: function (nm) { draft.cast = draft.cast || []; draft.cast.push({ name: nm, role: '' }); touch(); draw(); var l = rows.querySelectorAll('.row'); l = l[l.length - 1]; var r = l && l.querySelector('input'); if (r) r.focus(); } });
    } } }) : null;
    var bname = draft.section === 'TV shows' ? 'TV Shows' : 'Movies';
    var hint = key === 'videos' ? h('div', { class: 'note', style: 'margin-top:8px', text: '★ picks the video the ' + bname + ' page banner plays for this title, and adds the title to the ' + bname + ' banner when you save. With none picked, it plays ' + (draft.section === 'TV shows' ? 'the first trailer, or else the first promo, clip or episode.' : 'the newest song.') }) : null;
    return h('section', { class: 'card' }, [h('div', { class: 'head' }, [h('h2', { text: title }), h('span', { style: 'display:flex;gap:8px' }, [extra, add])]), rows, hint]);
  }

  function renderEditor() {
    if (page === 'titles') { renderList(); return; }
    renderEditorInner();
    if (page === 'title' && draft) addJumpBar();
    showPage();
    // A new title: put the cursor in the Title box.
    if (page === 'title' && draft && !draft.title && !movies.some(function (m) { return m.id === currentId; }) && (!document.activeElement || document.activeElement === document.body)) {
      var ti = $('f_title'); if (ti) ti.focus();
    }
  }
  function addJumpBar() {
    var main = $('main'), cards = main.querySelectorAll(':scope > section.card');
    if (cards.length < 3) return;
    var bar = h('nav', { class: 'jump', 'aria-label': 'Jump to section' });
    Array.prototype.forEach.call(cards, function (c, i) {
      if (!i) return;
      var t = c.querySelector('h2'); if (!t) return;
      var label = t.textContent.split(' · ')[0];
      bar.appendChild(h('button', { type: 'button', class: 'chip', text: label, on: { click: function () { c.scrollIntoView({ behavior: 'smooth', block: 'start' }); } } }));
    });
    if (cards[1]) main.insertBefore(bar, cards[1]);
  }
  function renderEditorInner() {
    if (peopleMode) { renderPeople(); return; }
    if (popularMode) { renderPopular(); return; }
    if (featuredMode) { renderFeatured(); return; }
    if (pbMode) { renderPageBanner(pbMode); return; }
    if (rowsMode) { renderRows(); return; }
    if (btnMode) { renderButtons(); return; }
    var main = $('main'); main.innerHTML = '';
    if (!draft) {
      main.appendChild(h('div', { class: 'crumbs' }, [h('a', { href: '/admin/titles', text: '← All titles' })]));
      main.appendChild(h('div', { class: 'empty', text: moviesLoaded ? 'No title at this address. It may have been deleted or renamed.' : 'Loading…' }));
      return;
    }
    var live = movies.find(function (m) { return m.id === currentId; });
    main.appendChild(h('div', { class: 'crumbs' }, [
      h('a', { href: '/admin/titles', text: '← All titles' }),
      live ? h('a', { href: pathBase(live.data) + slugOf(live), target: '_blank', rel: 'noopener', text: live.data.published === false ? 'Preview page ↗ (admins only)' : 'View public page ↗' }) : h('span', { class: 'sub', text: 'New title · not saved yet' })
    ]));
    // Publish / Unpublish. Titles without the field (all those from before it existed) count as published;
    // a new title starts unpublished. Either button also saves any other changes.
    var pubNow = live ? live.data.published !== false : false;
    main.appendChild(h('section', { class: 'card pubcard' }, [
      h('div', { class: 'pubrow' }, [
        h('div', {}, [
          h('span', { class: 'pubdot' + (pubNow ? ' on' : ''), 'aria-hidden': 'true' }),
          h('b', { text: pubNow ? 'Published' : 'Not published' }),
          h('span', { class: 'sub', text: pubNow ? ' · Visible on the site.' : live ? ' · Hidden from visitors: not in lists, search or Google. Admins can still preview it.' : ' · Save it, then publish when it’s ready.' })
        ]),
        h('button', { type: 'button', class: 'btn ' + (pubNow ? '' : 'primary'), disabled: !canWrite || saving || (!live && !draft.title),
          text: pubNow ? 'Unpublish' : (dirty || !live ? 'Save and publish' : 'Publish'),
          on: { click: function () {
            var was = draft.published; draft.published = !pubNow;
            save().then(function (ok) { if (!ok) { draft.published = was; renderEditor(); return; } setStatus((pubNow ? 'Unpublished ' : 'Published ') + (draft.title || 'title') + (pubNow ? '. It’s hidden from visitors.' : '. It’s live on the site.')); renderEditor(); });
          } } })
      ])
    ]));
    if (pendingSwitch) {
      var target = movies.find(function (m) { return m.id === pendingSwitch; });
      main.appendChild(h('div', { class: 'banner-note', role: 'status' }, [
        h('span', { text: 'You have unsaved changes to ' + (draft.title || 'this title') + '.' }),
        h('span', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [
          h('button', { type: 'button', class: 'btn small primary', text: 'Save and open ' + (target ? target.data.title : 'next'), on: { click: function () { var id = pendingSwitch; save().then(function (ok) { if (ok) select(id); }); } } }),
          h('button', { type: 'button', class: 'btn small', text: 'Discard', on: { click: function () { select(pendingSwitch); } } }),
          h('button', { type: 'button', class: 'btn small ghost', text: 'Keep editing', on: { click: function () { pendingSwitch = null; renderEditor(); } } })
        ])
      ]));
      main.appendChild(h('div', { style: 'height:16px' }));
    }
    if (remoteChanged) {
      main.appendChild(h('div', { class: 'banner-note' }, [h('span', { text: 'Someone else saved this title while you were editing. Saving will overwrite their version.' })]));
      main.appendChild(h('div', { style: 'height:16px' }));
    }
    var miss = missing(draft, currentId);
    // header + preview
    main.appendChild(h('section', { class: 'card' }, [
      h('div', { class: 'head' }, [
        h('div', {}, [
          h('div', { class: 'sub', text: draft.section + (draft.section === 'On OTT' && draft.platform ? ' · ' + draft.platform : '') + ' · ' + fmtDate(draft.releaseDate) }),
          h('h1', { text: draft.title || 'Untitled' })
        ]),
        h('div', { class: 'sub', text: miss.length ? 'Missing: ' + miss.map(function (r) { return r[1]; }).join(', ') : 'All key fields filled' })
      ]),
      h('div', { class: 'preview', 'aria-label': 'Title page preview' }, [
        h('div', { class: 'bg', id: 'pvBg', style: bgUrl(draft.bannerUrl) }),
        h('div', { class: 'fade' }),
        h('div', { class: 'in2' }, [
          h('div', { class: 'pp', id: 'pvPoster', style: bgUrl(draft.posterUrl) }),
          h('div', {}, [h('div', { class: 'tt', id: 'pvTitle', text: draft.title || 'Untitled' }), h('div', { class: 'sub', text: draft.subtitle || '' })])
        ])
      ]),
      movies.some(function (m) { return m.id === currentId; }) ? h('div', { style: 'display:flex;flex-wrap:wrap;align-items:center;gap:10px' }, [
        h('button', { type: 'button', class: 'btn small' + (isFeatured(currentId) ? ' primary' : ''), 'aria-pressed': String(isFeatured(currentId)), disabled: !canWrite,
          text: isFeatured(currentId) ? '★ On the home banner (slot ' + (featured.indexOf(currentId) + 1) + ')' : '☆ Feature on home banner',
          on: { click: function () { toggleFeatured(currentId); } } }),
        h('span', { class: 'note', text: isFeatured(currentId) ? 'Saved straight away. Click to remove.' : (safeUrl(draft.bannerUrl) ? 'Adds it to the first scroll of the home page.' : 'Add a banner image first for the best look.') })
      ]) : null,
      movies.some(function (m) { return m.id === currentId; }) ? (function () {
        var k = draft.section === 'TV shows' ? 'tv' : 'movies', c = PB[k], on = pbHas(k, currentId);
        return h('div', { style: 'display:flex;flex-wrap:wrap;align-items:center;gap:10px' }, [
          h('button', { type: 'button', class: 'btn small' + (on ? ' primary' : ''), 'aria-pressed': String(on), disabled: !canWrite,
            text: on ? '★ On the ' + c.name + ' (slot ' + (c.items.indexOf(currentId) + 1) + ')' : '☆ Feature on ' + c.name,
            on: { click: function () { pbToggle(k, currentId); } } }),
          h('span', { class: 'note', text: on ? 'Saved straight away. Click to remove.' : 'Adds it to the banner at the top of the ' + (k === 'tv' ? 'TV Shows' : 'Movies') + ' page.' })
        ]);
      })() : null,
      draft.source ? h('div', { class: 'note', text: draft.source + '. Check facts before publishing.' }) : null
    ]));

    // basics
    var tvEd = draft.section === 'TV shows';
    var g1 = h('div', { class: 'grid' }, [
      field('Title', 'title', { placeholder: 'e.g. Ramayana' }),
      field('Subtitle', 'subtitle', { placeholder: 'e.g. Rise of a Legend · Part One' }),
      (function () { var f = field('Home page section', 'section', { type: 'select', options: SECTIONS });
        if (!tvEd && draft.nowPlaying) { var se = f.querySelector('select'); se.disabled = true; f.appendChild(h('span', { class: 'note', text: 'Set by Now playing.' })); }
        return f; })(),
      nowPlayingField(tvEd),
      draft.section === 'On OTT' ? platformField('Streaming platform', false) : draft.section === 'Older releases' ? platformField('Now streaming on', false, 'Leave as “Not known” if you are not sure.') : tvEd ? platformField('Channel or platform', true) : null,
      field('Streaming platform URL', 'platformUrl', { type: 'url', placeholder: 'https://www.netflix.com/title/…',
        note: 'Shown as a “Watch on …” button on the title page. Leave blank to hide it. Starts with https://' }),
      field(draft.section === 'On OTT' ? 'Streaming date' : tvEd ? 'First aired' : 'Release date', 'releaseDate', { type: 'date' }),
      field('OTT Release Date', 'ottReleaseDate', { type: 'date', note: 'When it starts streaming. Leave blank if not announced.' }),
      tvEd ? field('Seasons', 'seasons', { placeholder: 'e.g. 16' }) : null,
      tvEd ? field('Episodes', 'episodes', { placeholder: 'e.g. 240', note: 'Total across all seasons.' }) : null,
      tvEd ? field('Last aired (year)', 'endYear', { placeholder: 'e.g. 2019', note: 'Leave blank if the show is still running.' }) : null,
      field('Date note', 'releaseNote', { placeholder: 'e.g. Reported, not confirmed' }),
      slugField()
    ]);
    main.appendChild(h('section', { class: 'card' }, [h('h2', { text: 'Basics' }), g1]));

    // images
    main.appendChild(h('section', { class: 'card' }, [
      h('h2', { text: 'Images' }),
      h('div', { class: 'images' }, [imageSlot('poster'), imageSlot('banner')]),
      h('div', { class: 'grid', style: 'margin-top:12px' }, [
        field('Poster source & permission', 'posterSource', { placeholder: 'e.g. Press kit from Yash Raj Films, OK by email 21 Nov 2026', note: 'Who supplied the image and how you have permission. Kept private, never shown on the site.' })
      ]),
      h('div', { class: 'note', text: 'Only upload images you have the rights to use: press-kit art sent or approved by the producer or distributor, or an image under a licence that allows it (TVmaze CC BY-SA images are credited automatically). Do not copy posters from Wikipedia, IMDb or TMDB.' })
    ]));

    main.appendChild(listEditor('Trailers & songs', 'videos', [{ k: 'kind', label: 'Type', options: VIDEO_KINDS }, { k: 'title', label: 'Title' }, { k: 'url', label: 'YouTube URL' }], 'No videos yet. Add the YouTube link for each trailer or song.'));


    // Buy tickets (films only): booking partner and a link per city. Folded for Older releases and On OTT; a tap opens it.
    if (!tvEd) {
      var mps = morePartners(), total = mps.length + 1;
      if (bkTab.id !== currentId || bkTab.i >= total) bkTab = { id: currentId, i: 0 };
      var pi = bkTab.i, mp = pi ? mps[pi - 1] : null;
      var pname = function (i) { return (i ? (mps[i - 1] || {}).platform : draft.bookingPlatform) || 'Partner ' + (i + 1); };
      var pcount = function (i) { var u = i ? ((mps[i - 1] || {}).urls || {}) : bookUrls(draft); return Object.keys(u).filter(function (c) { return String(u[c] || '').trim(); }).length; };
      // Switcher: one chip per partner (with how many cities it has links for), then + Add partner.
      var sw = h('div', { class: 'chips bkswitch', role: 'tablist', 'aria-label': 'Booking partners' });
      var plabel = function (i) { var n = pcount(i); return pname(i) + (n ? ' · ' + n + (n === 1 ? ' city' : ' cities') : ' · no links'); };
      bkRefresh = function () { sw.querySelectorAll('[role=tab]').forEach(function (b, i) { b.textContent = plabel(i); }); };
      for (var ti = 0; ti < total; ti++) (function (i) {
        sw.appendChild(h('button', { type: 'button', class: 'chip', role: 'tab', 'aria-selected': String(i === pi), 'aria-controls': 'bkPanel',
          text: plabel(i),
          on: { click: function () { bkTab = { id: currentId, i: i }; linksOpenFor = currentId; renderEditor(); } } }));
      })(ti);
      if (total < MAX_PARTNERS) sw.appendChild(h('button', { type: 'button', class: 'chip bkadd', disabled: !canWrite, text: '+ Add partner',
        on: { click: function () { var all = morePartners(); all.push({ platform: '', urls: {} }); touch(); bkTab = { id: currentId, i: all.length }; linksOpenFor = currentId; renderEditor(); setTimeout(function () { var f = $('f_bookingPlatform_' + all.length); if (f) f.focus(); }, 0); } } }));
      var tools = [];
      if (pi) {
        tools.push(h('button', { type: 'button', class: 'btn small', disabled: !canWrite, text: 'Make partner 1', title: 'Show this partner first on the site', on: { click: function () {
          var first = { platform: draft.bookingPlatform || '', urls: bookUrls(draft) };
          var cur = morePartners()[pi - 1] || {};
          draft.bookingPlatform = cur.platform || ''; draft.bookingUrls = cur.urls || {}; draft.bookingUrl = draft.bookingUrls.Bengaluru || '';
          morePartners()[pi - 1] = first; touch(); bkTab = { id: currentId, i: 0 }; renderEditor();
        } } }));
        tools.push(h('button', { type: 'button', class: 'btn small danger', disabled: !canWrite, text: 'Remove partner', on: { click: function () {
          morePartners().splice(pi - 1, 1); touch(); bkTab = { id: currentId, i: 0 }; renderEditor();
        } } }));
      }
      var gL = h('div', {}, [
        sw,
        h('div', { class: 'bkpartner', id: 'bkPanel', role: 'tabpanel' }, [
          total > 1 || tools.length ? h('div', { class: 'bkpartner-h' }, [h('h3', { text: 'Booking partner ' + (pi + 1) + (pi === 0 && total > 1 ? ' · shown first' : '') })].concat(tools)) : null,
          h('div', { class: 'grid' }, [bookingField(pi), bookingUrlsField(pi)])]),
        total >= MAX_PARTNERS ? h('div', { class: 'note', style: 'margin-top:12px', text: 'Up to ' + MAX_PARTNERS + ' booking partners per title.' }) : null]);
      var foldable = draft.section === 'Older releases' || draft.section === 'On OTT';
      var fold = foldable && linksOpenFor !== currentId;
      gL.hidden = fold;
      var head = foldable
        ? h('button', { type: 'button', class: 'cardtoggle', 'aria-expanded': String(!fold), 'aria-controls': 'linksBody', on: { click: function () {
            var open = gL.hidden; gL.hidden = !open; linksOpenFor = open ? currentId : null;
            head.setAttribute('aria-expanded', String(open)); head.querySelector('.chev').textContent = open ? '▾' : '▸';
          } } }, [h('h2', { text: 'Buy tickets' }), h('span', { class: 'sub', text: draft.section === 'On OTT' ? 'Usually not needed once a film is streaming' : 'Usually not needed for older releases' }), h('span', { class: 'chev', 'aria-hidden': 'true', text: fold ? '▸' : '▾' })])
        : h('h2', { text: 'Buy tickets' });
      gL.id = 'linksBody';
      main.appendChild(h('section', { class: 'card', id: 'linksCard' }, [head, gL]));
    }

    var g2 = h('div', { class: 'grid' }, [
      field('Languages', 'languages', { placeholder: 'Hindi, English' }),
      genreField(),
      field(tvEd ? 'Episode length' : 'Runtime', 'runtime', { placeholder: tvEd ? 'About 45 min' : '2h 18m' }),
      field('Certificate', 'certificate', { placeholder: 'U, UA 13+, A' }),
      field(tvEd ? 'Creator or director' : 'Director', 'director', { placeholder: 'Name' }),
      draft.section === 'On OTT' || tvEd ? null : field('Formats', 'formats', { placeholder: 'IMAX 3D · Hindi, 3D · Hindi', note: 'Comma-separated; shown as format choices in Book tickets.' }),
      field('Synopsis', 'synopsis', { type: 'textarea', wide: true, placeholder: 'One or two sentences, no spoilers.' })
    ]);
    main.appendChild(h('section', { class: 'card' }, [h('h2', { text: 'Details' }), g2]));

    main.appendChild(listEditor('Cast & crew · tap 📷 to add a photo', 'cast', [{ k: 'name', label: 'Name' }, { k: 'role', label: 'Role or character' }].concat(tvEd ? [{ k: 'episodes', label: 'Episodes' }, { k: 'year', label: 'Year(s)' }] : []), 'No cast or crew yet.'));

    // home banner clip: optional, so it comes last
    main.appendChild(h('section', { class: 'card' }, [h('h2', {}, ['Trailer clip for the home banner ', h('span', { class: 'note', text: '(optional)' })]), videoSlot()]));

    // danger zone
    var del = h('section', { class: 'card' }, [
      h('h2', { text: 'Remove title' }),
      confirmDelete
        ? h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;align-items:center' }, [
            h('span', { class: 'sub', text: 'Delete ' + (draft.title || 'this title') + ' from the catalogue? Uploaded images stay in the asset library.' }),
            h('button', { type: 'button', class: 'btn small danger', text: 'Yes, delete', on: { click: doDelete } }),
            h('button', { type: 'button', class: 'btn small', text: 'Cancel', on: { click: function () { confirmDelete = false; renderEditor(); } } })
          ])
        : h('div', {}, [h('button', { type: 'button', class: 'btn small danger', text: 'Delete title…', disabled: !canWrite || !movies.some(function (m) { return m.id === currentId; }),
            on: { click: function () { confirmDelete = true; renderEditor(); } } })])
    ]);
    main.appendChild(del);
    if (!canWrite) main.insertBefore(h('div', { class: 'banner-note', text: 'You don’t have admin access.' }), main.firstChild);
  }

  // ---------- writes ----------
  function slugify(t) { return (t || 'title').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'title'; }
  // Page URL (/movie/<slug>) helpers — must match the site's rules.
  function urlSlug(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80); }
  function suggestedSlug(d) { var b = urlSlug(d.title), y = (d.releaseDate || '').slice(0, 4); return b ? (/^\d{4}$/.test(y) ? b + '-' + y : b) : ''; }
  function slugOf(m) { return urlSlug(m.data.slug) || suggestedSlug(m.data) || m.id; }
  function pathBase(d) { return d && d.section === 'TV shows' ? '/tv/' : '/movie/'; }
  function slugTakenBy(slug, exceptId) {
    return movies.find(function (m) { return m.id !== exceptId && (slugOf(m) === slug || m.id === slug); }) || null;
  }
  function slugField() {
    var input = h('input', { id: 'f_slug', class: 'in', type: 'text', placeholder: suggestedSlug(draft) || 'e.g. ramayana-2026', spellcheck: 'false', autocomplete: 'off', disabled: !canWrite });
    input.value = draft.slug || '';
    var full = h('div', { class: 'note' }), err = h('div', { class: 'err', hidden: true });
    function show() {
      var v = urlSlug(input.value) || suggestedSlug(draft);
      full.textContent = location.origin + pathBase(draft) + (v || '…') + (input.value.trim() ? '' : '  (from the title and year)');
      var clash = v && slugTakenBy(v, currentId);
      err.hidden = !clash; err.textContent = clash ? 'Already used by ' + (clash.data.title || clash.id) + '. Pick another.' : '';
      if (input.value && input.value !== urlSlug(input.value) && !/-$/.test(input.value)) { err.hidden = false; err.textContent = 'Use lowercase letters, numbers and hyphens. It will be saved as: ' + urlSlug(input.value); }
    }
    input.addEventListener('input', function () { draft.slug = input.value; touch(); show(); });
    show();
    var reset = h('button', { type: 'button', class: 'btn small', text: 'Use title + year', disabled: !canWrite, on: { click: function () { input.value = suggestedSlug(draft); draft.slug = input.value; touch(); show(); } } });
    return h('div', { class: 'field wide' }, [
      h('label', { class: 'l', for: 'f_slug', text: 'Page URL' }),
      h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [
        h('span', { class: 'sub', style: 'white-space:nowrap', text: pathBase(draft) }),
        h('span', { style: 'flex:1;min-width:200px' }, [input]), reset
      ]),
      full, err,
      (draft.slugHistory && draft.slugHistory.length) ? h('div', { class: 'note', text: 'Old addresses that still redirect here: ' + draft.slugHistory.map(function (x) { return pathBase(draft) + x; }).join(', ') }) : null
    ]);
  }
  function save() {
    if (!draft || saving || !db) return Promise.resolve(false);
    if (!draft.title.trim()) { setStatus('Add a title before saving.'); return Promise.resolve(false); }
    if (draft.bookingUrls) {
      var bu = draft.bookingUrls, badCity = Object.keys(bu).filter(function (c) { bu[c] = String(bu[c] || '').trim(); if (!bu[c]) delete bu[c]; return bu[c] && !/^https:\/\/[^\s]+\.[^\s]+/.test(bu[c]); })[0];
      if (badCity) { setStatus('The ' + badCity + ' booking URL must be a full link starting with https://'); if (bkTab.i !== 0) { bkTab = { id: currentId, i: 0 }; linksOpenFor = currentId; renderEditor(); } var bc = $('f_bk_' + badCity.toLowerCase().replace(/[^a-z0-9]+/g, '-')); if (bc) bc.focus(); return Promise.resolve(false); }
      draft.bookingUrl = bu.Bengaluru || '';
    }
    if (Array.isArray(draft.moreBooking)) {
      // Tidy in place (the open editor holds these objects), and drop empty partners only once every link checks out.
      var badP = null;
      draft.moreBooking.forEach(function (p) {
        if (!p) return; p.platform = String(p.platform || '').trim(); if (!p.urls || typeof p.urls !== 'object') p.urls = {};
        Object.keys(p.urls).forEach(function (c) { var v = String(p.urls[c] || '').trim(); if (v) p.urls[c] = v; else delete p.urls[c]; });
      });
      draft.moreBooking.forEach(function (p, i) { if (!p) return; if (badP) return; Object.keys(p.urls).forEach(function (c) { if (!badP && !/^https:\/\/[^\s]+\.[^\s]+/.test(p.urls[c])) badP = [i + 1, c, p.platform]; }); });
      if (badP) { setStatus('The ' + badP[1] + ' booking URL' + (badP[2] ? ' for ' + badP[2] : '') + ' must be a full link starting with https://'); if (bkTab.i !== badP[0]) { bkTab = { id: currentId, i: badP[0] }; linksOpenFor = currentId; renderEditor(); } var bp2 = $(bkId(badP[0], badP[1])); if (bp2) bp2.focus(); return Promise.resolve(false); }
      draft.moreBooking = draft.moreBooking.filter(function (p) { return p && (p.platform || Object.keys(p.urls).length); });
    }
    var badUrl = [['platformUrl', 'Streaming platform URL']].filter(function (f) { var v = (draft[f[0]] || '').trim(); draft[f[0]] = v; return v && !/^https:\/\/[^\s]+\.[^\s]+/.test(v); })[0];
    if (badUrl) { setStatus(badUrl[1] + ' must be a full link starting with https://'); var bf = $('f_' + badUrl[0]); if (bf) bf.focus(); return Promise.resolve(false); }
    // Date each new video, so the site knows which trailer or song is newest (banners and rows play the newest).
    if (Array.isArray(draft.videos)) {
      var vday = new Date().toISOString().slice(0, 10), was = movies.filter(function (m) { return m.id === currentId; })[0], had = {};
      ((was && was.data.videos) || []).forEach(function (x) { if (x && x.url) had[x.url] = 1; });
      draft.videos.forEach(function (x) { if (x && x.url && !x.addedAt && !had[x.url]) x.addedAt = vday; });
    }
    saving = true; setDirty(true);
    var isNew = !movies.some(function (m) { return m.id === currentId; });
    var slug = urlSlug(draft.slug) || suggestedSlug(draft);
    var clash = slug && slugTakenBy(slug, isNew ? null : currentId);
    if (clash) { saving = false; setDirty(true); setStatus('The page URL ' + pathBase(draft) + slug + ' is already used by ' + (clash.data.title || clash.id) + '. Change it before saving.'); var f = $('f_slug'); if (f) f.focus(); return Promise.resolve(false); }
    if (isNew) currentId = slugify(draft.title) + '-' + Math.random().toString(36).slice(2, 6);
    var body = clone(draft); body.updatedAt = new Date().toISOString();
    if (body.nowPlaying && body.section !== 'TV shows') body.section = npSection(body); // dates may have changed since it was picked
    body.slug = slug;
    var prev = movies.find(function (m) { return m.id === currentId; });
    var prevSlug = prev ? slugOf(prev) : '';
    var hist = (body.slugHistory || []).filter(function (x) { return x && x !== slug; });
    if (prevSlug && prevSlug !== slug && hist.indexOf(prevSlug) === -1) hist.push(prevSlug);
    body.slugHistory = hist.slice(-10);
    body.cast = (body.cast || []).filter(function (c) { return (c.name || '').trim(); });
    body.videos = (body.videos || []).filter(function (v) { return (v.title || v.url || '').trim(); });
    var prevStar = (movies.filter(function (m) { return m.id === currentId; })[0] || { data: {} }).data.bannerVideo || '';
    return db.doc('movies/' + currentId).set(body).then(function () {
      saving = false; remoteChanged = false; draft = clone(body); setDirty(false); setStatus('Saved ' + body.title);
      if (page === 'title') { wantSlug = slug || currentId; var want = '/admin/titles/' + (slug || currentId); if (location.pathname !== want) history.replaceState(null, '', want); }
      renderEditor();
      // A newly starred video also puts the title on its page banner (Movies or TV Shows), if there is room.
      if (body.bannerVideo && body.bannerVideo !== prevStar) {
        var bk = body.section === 'TV shows' ? 'tv' : 'movies', bc = PB[bk];
        if (!pbHas(bk, currentId)) {
          if (bc.items.length >= MAX_FEAT) setStatus('Saved ' + body.title + '. The ' + bc.name + ' is full (' + MAX_FEAT + '), so it wasn’t added. Remove one in Admin › ' + bc.name + '.');
          else pbWrite(bk, bc.items.concat([currentId]), 'Saved ' + body.title + ' and added it to the ' + bc.name);
        }
      }
      return true;
    }).catch(function (e) {
      saving = false; setDirty(true);
      if (e && e.code === 'invalid_argument') { canWrite = false; setStatus('You don’t have permission to save here.'); renderEditor(); }
      else setStatus('Couldn’t save' + (e && e.message ? ': ' + e.message : '') + '. Try again.');
      return false;
    });
  }
  function doDelete() {
    var id = currentId;
    db.doc('movies/' + id).delete().then(function () {
      tombstone('movies', id);
      setStatus('Deleted ' + (draft.title || 'title'));
      currentId = null; draft = null; confirmDelete = false; setDirty(false); go('/admin/titles');
    }).catch(function (e) { setStatus('Couldn’t delete' + (e && e.message ? ': ' + e.message : '') + '.'); });
  }

  $('saveBtn').addEventListener('click', function () { save(); });
  $('discardBtn').addEventListener('click', function () {
    var m = movies.find(function (x) { return x.id === currentId; });
    if (m) select(currentId); else { currentId = null; draft = null; setDirty(false); go('/admin/titles'); }
  });
  var qTimer = null;
  $('q').addEventListener('input', function (e) { var v = e.target.value; clearTimeout(qTimer); qTimer = setTimeout(function () { setList(function () { query = v; pageNo = 1; }); }, 120); });
  $('langSel').addEventListener('change', function (e) { setList(function () { langF = e.target.value; pageNo = 1; }); });
  $('yearSel').addEventListener('change', function (e) { setList(function () { yearF = e.target.value; pageNo = 1; }); });
  $('seoSel').addEventListener('change', function (e) { loadSeoVotes(); setList(function () { seoF = e.target.value; pageNo = 1; }); });
  $('statusSel').addEventListener('change', function (e) { setList(function () { statusF = e.target.value; pageNo = 1; }); });
  $('sortSel').addEventListener('change', function (e) { var v = e.target.value.split(':'); setList(function () { sortKey = v[0]; sortDir = v[1]; pageNo = 1; }); });
  window.addEventListener('beforeunload', function (e) { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  // ---------- connect (from the prototype shell) ----------
  db = env.db; assets = env.assets; canWrite = env.canWrite !== false; canUpload = !!assets && canWrite;
  if (env.go) go = env.go;
  var moviesLoaded = false;
  var timer = setTimeout(function () { setStatus('Can’t reach the catalogue yet. Check your connection.'); }, 10000);
  db.doc('settings/home').onSnapshot(function (snap) {
    if (featWriting) return;
    var d = snap.exists ? snap.data() : {};
    featured = Array.isArray(d.featured) ? d.featured.filter(function (x) { return typeof x === 'string'; }) : [];
    featLoaded = true; renderFeatCount();
    if (featuredMode) renderFeatured(); else if (page === 'title' && !dirty) renderEditor();
  }, function () {});
  Object.keys(PB).forEach(function (k) {
    db.doc(PB[k].doc).onSnapshot(function (snap) {
      if (PB[k].writing) return;
      var d = snap.exists ? snap.data() : {};
      PB[k].items = Array.isArray(d.featured) ? d.featured.filter(function (x) { return typeof x === 'string'; }) : [];
      pbCount(k);
      if (pbMode === k) renderPageBanner(k); else if (page === 'title' && !dirty) renderEditor();
    }, function () {});
  });
  db.doc('settings/buttons').onSnapshot(function (snap) {
    if (btnWriting) return;
    btnCfg = snap.exists ? snap.data() : {}; btnLoaded = true; renderBtnCount();
    if (btnMode) renderButtons();
  }, function () {});
  db.doc('settings/rows').onSnapshot(function (snap) {
    if (rowsWriting) return;
    var d = snap.exists ? snap.data() : {}, ids = function (a) { return Array.isArray(a) ? a.filter(function (x) { return typeof x === 'string'; }) : []; };
    rowPins = noPins(); ROW_KEYS.forEach(function (k) { rowPins[k] = ids(d[k]); }); rowsLoaded = true; renderRowsCount();
    if (rowsMode && !rowsDragging) renderRows();
  }, function () {});
  db.doc('settings/popular').onSnapshot(function (snap) {
    if (popWriting) return;
    var d = snap.exists ? snap.data() : {};
    popOrder = Array.isArray(d.order) ? d.order.filter(function (x) { return typeof x === 'string'; }) : [];
    popLoaded = true; renderPopCount();
    if (popularMode && !popDragging) renderPopular();
  }, function () {});
  db.collection('people').onSnapshot(function (snap) {
    var o = {}; snap.docs.forEach(function (d) { o[d.id] = d.data(); }); people = o;
    renderPopCount(); if (popularMode && !popDragging) renderPopular();
    renderPeopleCount();
    namesDatalist();
    if (peopleMode) { var a = document.activeElement; if (!(a && a.id === 'pplQ')) renderPeople(); else refreshAvatars(); }
    else refreshAvatars();
  }, function () {});
  db.collection('movies').orderBy('order').onSnapshot(function (snap) {
      if (!snap.metadata.fromCache) { clearTimeout(timer); }
      movies = snap.docs.map(function (s) { var d = s.data(); if (d.section === 'Releasing this week') { d = clone(d); d.section = 'In theatres'; } return { id: s.id, data: d }; });
      var nHid = movies.filter(function (m) { return m.data.published === false; }).length;
      renderRowsCount();
      setStatus((movies.length - nHid).toLocaleString('en-IN') + ' published · ' + nHid.toLocaleString('en-IN') + ' hidden' + (snap.metadata.fromCache ? ' · syncing…' : ''));
      var cur = movies.find(function (m) { return m.id === currentId; });
      if (currentId && currentId !== '__new__' && !cur) { currentId = null; draft = null; setDirty(false); }
      else if (cur && !dirty && !saving) { draft = clone(cur.data); }
      else if (cur && dirty && !saving && !snap.metadata.hasPendingWrites) {
        var changed = snap.docChanges().some(function (c) { return c.doc.id === currentId && c.type === 'modified'; });
        if (changed) remoteChanged = true;
      }
      renderPeopleCount(); renderPopCount();
      if (!snap.metadata.fromCache) moviesLoaded = true;
      if (page === 'title' && !currentId) resolveTitle();
      renderList();
      if (page !== 'titles' && !(dirty && document.activeElement && document.activeElement.closest && document.activeElement.closest('#main'))) renderEditor();
  }, function (e) { clearTimeout(timer); setStatus('Lost connection to the catalogue. Reload to retry.'); });
  route(env.sub);
  return { route: route, canLeave: canLeave };
};

