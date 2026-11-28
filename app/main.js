(function () {
  // ---------- constants ----------
  var SECTIONS = ['In theatres', 'Coming soon', 'On OTT', 'Older releases', 'TV shows'];
  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var PAL = [['#241C3A','#E8A33A'],['#14213D','#5BA3C7'],['#3A1414','#D94A3A'],['#14283A','#F2A7A0'],['#2E1612','#E8703A'],['#16231A','#8DBF6A'],['#2A1A33','#C77FD6'],['#2E2814','#E8C547'],['#24242A','#B9B4C2'],['#183A37','#9FD8CB'],['#33141E','#F2A7A0'],['#1E2A1A','#C7843F']];
  var VERD = {
    theatre: [['a','Theatre','Worth the big screen'],['b','OTT','Wait for streaming'],['c','Skip','Not worth it']],
    ott: [['a','Must watch','Watch it tonight'],['b','Watch','Worth a watch'],['c','Skip','Not worth it']]
  };
  var VCOL = { a: 'var(--accent)', b: 'var(--text)', c: '#8E8899' };

  // ---------- state ----------
  var S = {
    db: null, assets: null, user: null, uid: null, canEdit: false, canWrite: true,
    featured: Array.isArray(window.RS_FEATURED) ? window.RS_FEATURED.slice() : [], popOrder: [], people: {}, movies: [], byId: {}, verdicts: {}, reviews: {}, mine: { watchlist: [], following: [], reminders: [], wtw: [], seen: [] }, mineLoaded: false,
    route: 'home', param: null, slide: 0, rtab: 'all', reviewDraft: {}, spoilerShown: {}, peopleQuery: '', peopleHits: [],
    browse: { status: 'All', lang: '', genre: '', year: '', ott: '', sort: 'new', page: 1 }, cat: { movies: { status: 'All', lang: '', genre: '', year: '', ott: '', sort: 'new', page: 1 }, tv: { status: 'All', lang: '', genre: '', year: '', ott: '', sort: 'new', page: 1 } }, ppl: { q: '', role: 'Popular', lang: '', sort: 'popular', page: 1 }, gen: { genre: '', lang: '', page: 1 }, yr: { year: '', lang: '', page: 1 }, loaded: false, pending: false, adminStarted: false, planPick: {}
  };
  try { localStorage.removeItem('rs_lang'); } catch (e) {} // the old header language picker's saved choice
  try { S.city = localStorage.getItem('rs_city') || ''; } catch (e) { S.city = ''; }
  // Cities for ticket booking links. Popular ones are always listed; any other city can be added per title.
  var POP_CITIES = ['Mumbai', 'Delhi-NCR', 'Bengaluru', 'Hyderabad', 'Chandigarh', 'Ahmedabad', 'Pune', 'Chennai', 'Kolkata', 'Kochi'];
  // Booking links by city. Older titles have a single bookingUrl, which was added for Bengaluru.
  function bookUrls(d) {
    var o = {}, src = d.bookingUrls || {};
    Object.keys(src).forEach(function (c) { var u = String(src[c] || '').trim(); if (u) o[c] = u; });
    if (d.bookingUrl && !o.Bengaluru && !('Bengaluru' in src)) o.Bengaluru = String(d.bookingUrl).trim();
    return o;
  }
  // Booking partners: the first is bookingPlatform + bookingUrls; a second one, if added in Admin, is moreBooking[0] { platform, urls }.
  function bookPartners(d) {
    var out = [{ platform: String(d.bookingPlatform || '').trim(), urls: bookUrls(d) }];
    (Array.isArray(d.moreBooking) ? d.moreBooking : []).forEach(function (p) {
      if (!p) return; var u = {}, src = p.urls || {};
      Object.keys(src).forEach(function (c) { var v = String(src[c] || '').trim(); if (v) u[c] = v; });
      out.push({ platform: String(p.platform || '').trim(), urls: u });
    });
    return out.filter(function (p) { return Object.keys(p.urls).some(function (c) { return !!safeUrl(p.urls[c]); }); });
  }
  // Every city with a link from any partner (the first partner's link wins for a city both cover).
  function allBookUrls(d) { var o = {}; bookPartners(d).forEach(function (p) { Object.keys(p.urls).forEach(function (c) { if (!o[c] && safeUrl(p.urls[c])) o[c] = p.urls[c]; }); }); return o; }
  function partnersFor(d, city) { return city ? bookPartners(d).filter(function (p) { return !!safeUrl(p.urls[city]); }).map(function (p) { return { platform: p.platform, url: safeUrl(p.urls[city]) }; }) : []; }
  function partnerNames(d) { return bookPartners(d).map(function (p) { return p.platform; }).filter(Boolean); }
  function hasBooking(d) { return bookPartners(d).length > 0; }
  function bookUrlFor(d) { var p = partnersFor(d, S.city)[0]; return p ? p.url : ''; }
  function citiesFor(d) { var u = allBookUrls(d); return POP_CITIES.filter(function (c) { return safeUrl(u[c]); }).concat(Object.keys(u).filter(function (c) { return POP_CITIES.indexOf(c) === -1 && safeUrl(u[c]); }).sort()); }
  function setCity(v) {
    S.city = v || '';
    try { if (S.city) localStorage.setItem('rs_city', S.city); else localStorage.removeItem('rs_city'); } catch (e) {}
    S.lastDrawn = null; render(true);
  }
  function fillNavCity() {
    var sel = $('navCity'); if (!sel) return;
    var other = {}; S.movies.forEach(function (m) { Object.keys(allBookUrls(m.data)).forEach(function (c) { if (POP_CITIES.indexOf(c) === -1) other[c] = 1; }); });
    if (S.city && POP_CITIES.indexOf(S.city) === -1) other[S.city] = 1;
    var list = POP_CITIES.concat(Object.keys(other).sort()), want = list.join('|');
    if (sel.getAttribute('data-k') !== want) {
      sel.innerHTML = '';
      sel.appendChild(h('option', { value: '', text: 'City' }));
      list.forEach(function (c) { sel.appendChild(h('option', { value: c, text: c })); });
      sel.setAttribute('data-k', want);
    }
    sel.value = S.city; sel.classList.toggle('on', !!S.city);
  }
  // Book tickets: opens the link for the visitor's city. With no city chosen yet, asks for one first.
  // With two partners in the visitor's city, it opens a small chooser instead.
  function bookBtn(m, cls) {
    var d = m.data; if (!hasBooking(d)) return null;
    var nm = partnerNames(d), say = 'Book tickets' + (nm.length ? ' on ' + nm.join(' or ') : '');
    if (S.city) {
      var ps = partnersFor(d, S.city); if (!ps.length) return null;
      if (ps.length === 1) return h('a', { class: cls, href: ps[0].url, target: '_blank', rel: 'noopener', text: 'Book tickets', 'aria-label': 'Book tickets' + (ps[0].platform ? ' on ' + ps[0].platform : '') + ' in ' + S.city });
      return h('button', { type: 'button', class: cls, text: 'Book tickets', 'aria-haspopup': 'dialog', 'aria-label': say + ' in ' + S.city, on: { click: function (e) { e.preventDefault(); partnerChooser(m, S.city); } } });
    }
    return h('button', { type: 'button', class: cls, text: 'Book tickets', 'aria-label': say, on: { click: function (e) { e.preventDefault(); cityPicker(m); } } });
  }
  function modal(label, kids, onClose) {
    var prev = document.activeElement;
    var close = function () { ov.remove(); document.removeEventListener('keydown', esc); if (onClose) onClose(); else if (prev && prev.focus) prev.focus(); };
    var esc = function (e) { if (e.key === 'Escape') close(); };
    var box = h('div', { class: 'citybox', role: 'dialog', 'aria-modal': 'true', 'aria-label': label }, kids(close));
    var ov = h('div', { class: 'cityov', on: { click: function (e) { if (e.target === ov) close(); } } }, [box]);
    document.body.appendChild(ov); document.addEventListener('keydown', esc);
    var first = box.querySelector('.citygrid a, .citygrid button'); if (first) first.focus();
    return close;
  }
  function partnerChooser(m, city) {
    var d = m.data, ps = partnersFor(d, city);
    modal('Choose where to book', function (close) { return [
      h('h2', { text: 'Book tickets' }),
      h('p', { class: 'note', text: d.title + ' in ' + city + '. Pick where to book.' }),
      h('div', { class: 'citygrid partners' }, ps.map(function (p) {
        return h('a', { class: 'btn primary', href: p.url, target: '_blank', rel: 'noopener', text: p.platform ? 'Book on ' + p.platform : 'Book tickets', on: { click: function () { close(); } } });
      })),
      h('button', { type: 'button', class: 'btn small', text: 'Close', on: { click: close } })]; });
  }
  function cityPicker(m) {
    var d = m.data, prev = document.activeElement;
    var close = function () { ov.remove(); document.removeEventListener('keydown', esc); if (prev && prev.focus) prev.focus(); };
    var esc = function (e) { if (e.key === 'Escape') close(); };
    var box = h('div', { class: 'citybox', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Choose your city' }, [
      h('h2', { text: 'Choose your city' }),
      h('p', { class: 'note', text: 'Tickets for ' + d.title + (partnerNames(d).length ? ' on ' + partnerNames(d).join(' or ') : '') + '. We’ll remember your city; change it any time from City at the top.' }),
      h('div', { class: 'citygrid' }, citiesFor(d).map(function (c) {
        var ps = partnersFor(d, c);
        if (ps.length > 1) return h('button', { type: 'button', class: 'btn', text: c, on: { click: function () { ov.remove(); document.removeEventListener('keydown', esc); setCity(c); partnerChooser(m, c); } } });
        return h('a', { class: 'btn', href: ps[0] ? ps[0].url : '#', target: '_blank', rel: 'noopener', text: c, on: { click: function () { close(); setCity(c); } } });
      })),
      h('p', { class: 'note', text: 'Don’t see your city? Booking links for more cities are on the way.' }),
      h('button', { type: 'button', class: 'btn small', text: 'Close', on: { click: close } })]);
    var ov = h('div', { class: 'cityov', on: { click: function (e) { if (e.target === ov) close(); } } }, [box]);
    document.body.appendChild(ov); document.addEventListener('keydown', esc);
    var first = box.querySelector('.citygrid a'); if (first) first.focus();
  }
  function langsOf(d) { return (d.languages || '').split(/[,;/]| dubbed in | and /i).map(function (x) { return x.trim(); }).filter(Boolean); }
  var $ = function (id) { return document.getElementById(id); };
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'text') el.textContent = v;
      else if (k === 'on') Object.keys(v).forEach(function (ev) { el.addEventListener(ev, v[ev]); });
      else if (k === 'style') el.setAttribute('style', v);
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c != null && c !== false) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  // Elements created with a 'data-bg' URL get it as their background once they are within ~1.5 screens of view.
  var bgIO = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { showBg(e.target); bgIO.unobserve(e.target); } });
  }, { rootMargin: '800px 400px' }) : null;
  function showBg(el) { var u = el.getAttribute('data-bg'); if (u) { el.style.backgroundImage = 'url("' + u.replace(/"/g, '%22') + '")'; el.removeAttribute('data-bg'); } }
  function watchBg(el) { if (bgIO) bgIO.observe(el); else showBg(el); }
  new MutationObserver(function (ms) {
    ms.forEach(function (mu) { mu.addedNodes.forEach(function (n) {
      if (n.nodeType !== 1) return;
      if (n.hasAttribute('data-bg')) watchBg(n);
      if (n.querySelectorAll) n.querySelectorAll('[data-bg]').forEach(watchBg);
    }); });
  }).observe(document.documentElement, { childList: true, subtree: true });
  // A short message at the bottom. With undo, it carries an Undo button and stays up a little longer.
  function toast(t, undo) {
    var el = $('toast'); el.textContent = t; clearTimeout(toast._t);
    if (undo) el.appendChild(h('button', { type: 'button', class: 'toast-undo', text: 'Undo', on: { click: function () { clearTimeout(toast._t); el.hidden = true; undo(); } } }));
    el.hidden = false; toast._t = setTimeout(function () { el.hidden = true; }, undo ? 6000 : 2600);
  }
  function safeUrl(u) { return (typeof u === 'string' && (/^\/_blob\//.test(u) || /^https:\/\//.test(u))) ? u : ''; }
  function hash(s) { var x = 0; for (var i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) >>> 0; return x; }
  // Cloudinary serves the uploaded original unless the URL asks for a size. Ask for a modern format, automatic quality and
  // at most the width the slot needs (2x for sharp screens); never upscale. Other hosts are left alone.
  function cld(u, w) {
    var m = typeof u === 'string' && u.match(/^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.*)$/);
    if (!m || /^[a-z]{1,3}_[^/]*\//.test(m[2])) return u;
    return m[1] + 'f_auto,q_auto,c_limit,w_' + (w || 800) + '/' + m[2];
  }
  // Widths that fit this screen: posters at card size, banners at screen width (both times pixel density), in steps
  // so neighbouring sizes share Cloudinary's cache.
  var DPR = Math.min(window.devicePixelRatio || 1, 2), VW = Math.max(320, Math.min(window.innerWidth || 1280, 2560));
  var POSTER_W = Math.min(400, Math.ceil((VW < 600 ? 150 : 200) * DPR / 50) * 50);
  function bannerW(max) { return Math.min(max || 1920, Math.ceil(VW * DPR / 320) * 320); }
  function artUrl(m, kind, w) {
    var url = safeUrl(kind === 'banner' ? (m.data.bannerUrl || '') : (m.data.posterUrl || ''));
    if (kind === 'banner') w = bannerW(w || 1280); else if (!w || w === 400) w = POSTER_W;
    return url ? cld(url, w) : '';
  }
  // Rows can hold hundreds of cards: their pictures load only as they come near the screen (see lazyBg below).
  function artLazy(m, kind, w) {
    var url = artUrl(m, kind, w);
    if (!url) return { style: art(m, kind), bg: null };
    return { style: 'background-color:' + PAL[hash(m.id) % PAL.length][0], bg: url };
  }
  function art(m, kind, w) {
    var url = artUrl(m, kind, w);
    if (url) return 'background-image:url("' + url.replace(/"/g, '%22') + '")';
    var p = PAL[hash(m.id) % PAL.length];
    var pos = kind === 'banner' ? '72% 30%' : (20 + hash(m.id + 'x') % 50) + '% ' + (25 + hash(m.id + 'y') % 30) + '%';
    var r = kind === 'banner' ? '22%' : '42%';
    return 'background-image:radial-gradient(circle at ' + pos + ', ' + p[1] + ' 0 ' + r + ', transparent calc(' + r + ' + 1px));background-color:' + p[0];
  }
  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function released(m) { return !!m.data.releaseDate && m.data.releaseDate <= today(); }
  // Not out yet: a future date, or listed as Coming soon. Undated titles in other sections count as released.
  function isUpcoming(m) { var d = m.data.releaseDate; return d ? d > today() : m.data.section === 'Coming soon'; }
  function isOtt(m) { return m.data.section === 'On OTT'; }
  function isTv(m) { return m.data.section === 'TV shows'; }
  // "2000–present", "2016–2019", or "2024"
  function tvYears(d) { var a = (d.releaseDate || '').slice(0, 4), b = String(d.endYear || '').trim(); if (!a) return b; return b ? (b === a ? a : a + '–' + b) : a + '–present'; }
  function fmtDate(iso, withYear) { if (!iso) return 'Date TBA'; if (/^\d{4}$/.test(iso)) return iso; var p = iso.split('-'); return (+p[2]) + ' ' + MONTHS[+p[1] - 1] + (withYear ? ' ' + p[0] : ''); }
  // The day a film started (or starts) streaming: its OTT Release Date; for straight-to-OTT films, the release date.
  // A theatre film marked Now on OTT with no OTT date has none (its release date is the theatre date).
  function streamDate(d) { return /^\d{4}-\d{2}-\d{2}$/.test(d.ottReleaseDate || '') ? d.ottReleaseDate : d.nowPlaying === 'ott' ? '' : d.releaseDate || ''; }
  function isOld(m) { return m.data.section === 'Older releases'; }
  function statusLabel(m) {
    var d = m.data, rel = released(m);
    if (isTv(m)) return 'TV show' + (tvYears(d) ? ' · ' + tvYears(d) : '') + (d.platform ? ' · on ' + d.platform : '');
    if (isOtt(m)) return (rel ? 'Now on ' : 'On ') + (d.platform || 'OTT') + (rel ? '' : ' ' + fmtDate(d.releaseDate));
    if (isOld(m)) return 'Released ' + fmtDate(d.releaseDate, true) + (d.platform ? ' · on ' + d.platform : '');
    return rel ? 'In theatres' : 'Releases ' + fmtDate(d.releaseDate);
  }
  // The Theatre / OTT / Skip scale only fits films that are in, or coming to, theatres. Streaming titles, TV shows and
  // older releases use Must watch / Watch / Skip (same a/b/c keys, so existing verdicts keep their meaning).
  function bigScreen(m) { return m.data.section === 'In theatres' || m.data.section === 'Coming soon'; }
  function vset(m) { return bigScreen(m) ? VERD.theatre : VERD.ott; }
  function inList(id) { return S.mine.watchlist.indexOf(id) !== -1; }
  function following(uid) { return S.mine.following.indexOf(uid) !== -1; }

  function score(mid, onlyUids) {
    var n = { a: 0, b: 0, c: 0 }, raters = [];
    Object.keys(S.verdicts).forEach(function (uid) {
      if (onlyUids && onlyUids.indexOf(uid) === -1) return;
      var v = (S.verdicts[uid].v || {})[mid];
      if (v && n[v] !== undefined) { n[v]++; raters.push(uid); }
    });
    var tot = n.a + n.b + n.c;
    return { tot: tot, n: n, pct: tot ? Math.round(100 * (n.a + n.b) / tot) : null, raters: raters };
  }
  // A score is shown only once a title has this many verdicts; until then posters say "New".
  var MIN_SHOW = 3;
  function shownPct(sc) { return sc.tot >= MIN_SHOW ? sc.pct : null; }
  // Poster badge: the Reelscore % once a title has MIN_SHOW verdicts; before release, the release date; "New" for the first
  // NEW_DAYS days after release (release day is day 1); after that, with no score yet, no badge. Null means no badge.
  var NEW_DAYS = 14;
  // On streaming rows and pages (ott), a theatre film that came to OTT later counts its days from the streaming date.
  function badgeText(m, sc, noNew, ott) {
    var pct = shownPct(sc || score(m.id));
    if (pct !== null) return pct + '%';
    if (!released(m)) return m.data.releaseDate ? fmtDate(m.data.releaseDate) : null;
    if (noNew) return null;
    var from = m.data.releaseDate, st = ott && !isTv(m) ? streamDate(m.data) : '';
    if (st && st > from && st <= today()) from = st;
    return daysSince(from) < NEW_DAYS ? 'New' : null;
  }
  // Streaming pages: Browse or Movies showing On OTT, or Browse filtered to streaming services.
  function streamingPage() {
    return (S.route === 'browse' && S.browse && (S.browse.status === 'On OTT' || !!S.browse.ott)) || (S.route === 'movies' && S.cat && S.cat.movies && S.cat.movies.status === 'On OTT');
  }
  function myVerdict(mid) { return S.uid && S.verdicts[S.uid] ? (S.verdicts[S.uid].v || {})[mid] : null; }

  // ---------- writes ----------
  var writing = {};
  function guard(p, ok) {
    return p.then(function () { if (ok) toast(ok); }).catch(function (e) {
      if (e && e.code === 'invalid_argument') toast('You don’t have permission to do that.');
      else if (e && e.code === 'quota_exceeded') toast('Storage is full.');
      else toast('Couldn’t save. Try again.');
    });
  }
  function needUser() { if (!S.db || !S.uid) { if (window.reelSignIn) { toast('Sign in with Google to do that.'); window.reelSignIn(); } else toast('Sign in to do that.'); return false; } return true; }
  function setVerdict(mid, val) {
    if (!needUser() || writing.v || !verdictsReady()) return;
    var cur = clone(S.verdicts[S.uid] || { v: {} }); cur.v = cur.v || {};
    if (cur.v[mid] === val) delete cur.v[mid]; else cur.v[mid] = val;
    cur.at = new Date().toISOString();
    S.verdicts[S.uid] = cur;
    // When each title was rated (for My List > Your verdicts, newest first). Kept in your private list document, one
    // key per title (merged in, never rewriting the rest); the public verdicts document stays as it is.
    if (cur.v[mid]) { S.ratedAt = S.ratedAt || {}; S.ratedAt[mid] = cur.at; var ra = {}; ra[mid] = cur.at; S.db.doc('data/users/' + S.uid + '/profile').edit([{ field: 'ratedAt', value: ra }]).catch(function () {}); }
    if (S.route === 'tonight') { /* the Tonight page redraws itself */ }
    else if (S.route === 'home' && S.lastDrawn === 'home:') patchVerdicts(); else if (!patchTitleBits()) render();
    writing.v = true;
    guard(S.db.doc('verdicts/' + S.uid).set(cur)).then(function () { writing.v = false; });
  }
  // Home page: show a new verdict (and changed scores) on the cards already drawn, without rebuilding the page,
  // so images don't reload and rows keep their place.
  function patchVerdicts() {
    var v = $('view-home'); if (!v) return;
    v.querySelectorAll('.pc[data-id]').forEach(function (pc) {
      var id = pc.getAttribute('data-id'), my = myVerdict(id), b = pc.querySelector('.badge');
      pc.querySelectorAll('.qb[data-v]').forEach(function (q) { q.setAttribute('aria-pressed', String(my === q.getAttribute('data-v'))); });
      if (b && b.lastChild && b.lastChild.nodeType === 3) {
        var m = S.byId[id], sc = score(id);
        var rs = pc.closest('section[aria-label]'), rl = rs ? rs.getAttribute('aria-label') : '';
        var bt = m ? badgeText(m, sc, false, rl === 'Released recently on OTT' || rl === 'Streaming this year' || /^New on /.test(rl)) : null; if (bt) b.lastChild.nodeValue = bt;
      }
    });
    var sub = v.querySelector('section[aria-label="Seen these? Give your verdict"] .sect-h .sub .rnote');
    if (sub) sub.textContent = rateNote();
  }
  function saveReview(mid, text, spoiler, where, via) {
    if (!needUser() || writing.r) return;
    if (!S.reviewsIn) { toast('Loading reviews. Try again in a moment.'); return; }
    var cur = clone(S.reviews[S.uid] || { items: {} }); cur.items = cur.items || {};
    if (text) { cur.items[mid] = { text: text.slice(0, 2000), spoiler: !!spoiler, at: new Date().toISOString() }; if (where) cur.items[mid].where = where; if (via) cur.items[mid].via = String(via).slice(0, 40); }
    else delete cur.items[mid];
    S.reviews[S.uid] = cur; S.reviewDraft[mid] = undefined; render();
    writing.r = true;
    guard(S.db.doc('reviews/' + S.uid).set(cur), text ? 'Review posted' : 'Review removed').then(function () { writing.r = false; });
  }
  // Your list (watchlist, reminders, seen, following…) is one document, written whole. It must never be written
  // before the saved copy has loaded: the page starts with an empty list, and writing that would wipe the real one.
  // A tap that comes before it loads is kept and merged into the saved list when it arrives (mergeMine).
  // Saves go item by item (add this title, remove that one), worked out against the last copy read from Firestore,
  // so a save can never replace the whole list.
  function saveMine(msg) {
    if (!needUser()) return;
    if (!S.mineLoaded) { S.minePending = true; if (msg) toast(msg); return; }
    if (writing.m) { writing.mAgain = msg || true; if (S.waitBox) showSaveWait(waitIds(mineDiff()).concat(S.waitIds || [])); return; }
    var ch = mineDiff();
    backupMine();
    if (!ch.length) { if (msg) toast(msg); return; }
    writing.m = true;
    var was = S.mineSynced; S.mineSynced = clone(S.mine);
    // Still not confirmed after a few seconds (offline, or a slow connection): say which titles aren't saved yet.
    var ids = waitIds(ch), slow = setTimeout(function () { if (writing.m) showSaveWait(ids); }, 4000);
    S.db.doc('data/users/' + S.uid + '/profile').edit(ch).then(function () {
      if (S.waitBox) {
        var left = (S.waitIds || []).filter(function (id) { return ids.indexOf(id) === -1; });
        if (left.length) showSaveWait(left); else hideSaveWait();
        toast('Saved ' + titlesOf(ids));
      } else if (msg) toast(msg);
    }, function (e) {
      S.mineSynced = was; hideSaveWait();
      toast(e && e.code === 'invalid_argument' ? 'You don’t have permission to do that.' : 'Couldn’t save. Try again.');
    }).then(function () {
      clearTimeout(slow);
      writing.m = false; if (writing.mAgain) { var again = writing.mAgain; writing.mAgain = null; saveMine(again === true ? null : again); }
    });
  }
  // The titles a save is about (watchlist, reminders, seen), for the "not saved yet" note.
  function waitIds(ch) {
    var out = [];
    ch.forEach(function (c) { if (['watchlist', 'reminders', 'seen'].indexOf(c.field) === -1) return; (c.add || []).concat(c.remove || []).forEach(function (id) { if (S.byId[id] && out.indexOf(id) === -1) out.push(id); }); });
    return out;
  }
  function titlesOf(ids) {
    var t = ids.map(function (id) { return S.byId[id] ? S.byId[id].data.title : null; }).filter(Boolean);
    if (!t.length) return 'your change';
    return t.length === 1 ? t[0] : t.length === 2 ? t[0] + ' and ' + t[1] : t[0] + ' and ' + (t.length - 1) + ' more';
  }
  function showSaveWait(ids) {
    var u = []; ids.forEach(function (id) { if (u.indexOf(id) === -1) u.push(id); }); S.waitIds = u;
    var off = navigator.onLine === false;
    var text = 'Not saved yet: ' + titlesOf(u) + '. ' + (off ? 'You’re offline; it will save when you’re back online.' : 'Your connection is slow; still trying.') + ' Keep this page open.';
    if (!S.waitBox) { S.waitBox = h('div', { class: 'savewait', role: 'status', 'aria-live': 'polite' }); document.body.appendChild(S.waitBox); }
    S.waitBox.textContent = text;
  }
  function hideSaveWait() { if (S.waitBox && S.waitBox.parentNode) S.waitBox.parentNode.removeChild(S.waitBox); S.waitBox = null; S.waitIds = null; }
  window.addEventListener('offline', function () { if (S.waitBox) showSaveWait(S.waitIds || []); });
  window.addEventListener('online', function () { if (S.waitBox) showSaveWait(S.waitIds || []); });
  function mineDiff() {
    var base = S.mineSynced || {}, ch = [];
    MINE_KEYS.forEach(function (k) {
      var now = Array.isArray(S.mine[k]) ? S.mine[k] : [], was = Array.isArray(base[k]) ? base[k] : [];
      var add = now.filter(function (x) { return was.indexOf(x) === -1; }), rem = was.filter(function (x) { return now.indexOf(x) === -1; });
      if (add.length || rem.length) ch.push({ field: k, add: add, remove: rem });
    });
    if (Array.isArray(S.mine.apps) && JSON.stringify(S.mine.apps) !== JSON.stringify(base.apps || null)) ch.push({ field: 'apps', value: S.mine.apps });
    return ch;
  }
  // A copy of your watchlist and reminders in this browser, per account. It is never written back by itself: if the list
  // loads from Firestore with titles missing that this browser had, a bar offers to add them back (checkMineBackup).
  function bakKey() { return 'rs_listbak:' + S.uid; }
  function readBak() { try { var b = JSON.parse(localStorage.getItem(bakKey()) || 'null'); return b && Array.isArray(b.watchlist) ? b : null; } catch (e) { return null; } }
  function backupMine() {
    if (!S.uid || !S.mineLoaded || S.bakOffer) return;
    try { localStorage.setItem(bakKey(), JSON.stringify({ at: new Date().toISOString(), watchlist: S.mine.watchlist || [], reminders: S.mine.reminders || [] })); } catch (e) {}
  }
  function checkMineBackup() {
    var b = readBak(); if (!b) { backupMine(); return; }
    var miss = function (k) { var now = S.mine[k] || []; return (b[k] || []).filter(function (id) { return now.indexOf(id) === -1; }); };
    var mw = miss('watchlist'), mr = miss('reminders'), had = (b.watchlist || []).length, n = mw.length;
    // A big drop (not one or two titles taken off on another device): offer to add them back.
    if (n >= 3 && n >= had * 0.3) { showRestoreBar(mw, mr, b.at); return; }
    backupMine();
  }
  // The missing titles as a card (desktop, bottom right) or a bottom sheet (phones): each with a tickbox, poster, title and
  // where it is now. All ticked; Restore adds back the ticked ones (and their reminders). It never removes anything.
  // × hides it for now (it comes back next visit); Keep as it is makes the loaded list this browser's copy.
  function showRestoreBar(mw, mr, at) {
    if (S.bakOffer) return;
    S.bakOffer = true;
    var ids = mw.slice(); mr.forEach(function (id) { if (ids.indexOf(id) === -1) ids.push(id); });
    var on = {}; ids.forEach(function (id) { on[id] = true; });
    var known = ids.filter(function (id) { return S.byId[id]; }), unknown = ids.length - known.length;
    var when = at ? new Date(at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '';
    var nw = mw.length, nRem = mr.length;
    var prev = document.activeElement;
    var close = function () { document.removeEventListener('keydown', onKey, true); if (wrap.parentNode) wrap.parentNode.removeChild(wrap); if (prev && prev.focus) try { prev.focus({ preventScroll: true }); } catch (e) {} };
    var onKey = function (e) { if (e.key === 'Escape') close(); };
    var btn = h('button', { type: 'button', class: 'btn primary rbgo' });
    var count = function () { var n = ids.filter(function (id) { return on[id]; }).length; btn.textContent = n ? 'Restore ' + n + ' title' + (n === 1 ? '' : 's') : 'Nothing ticked'; btn.disabled = !n; };
    var rows = known.map(function (id) {
      var m = S.byId[id], d = m.data, pa = artLazy(m, 'poster', 80), cb = h('input', { type: 'checkbox', checked: true, 'aria-label': 'Restore ' + d.title });
      cb.addEventListener('change', function () { on[id] = cb.checked; count(); });
      var thumb = h('span', { class: 'rbpost', style: pa.style + (pa.bg ? ';background-image:url("' + pa.bg.replace(/"/g, '%22') + '")' : '') });
      return h('label', { class: 'rbrow' }, [cb, thumb, h('span', { class: 'rbt' }, [h('b', { text: d.title }), h('small', { text: [langOf(d), isTv(m) ? 'Series' : 'Film', statusLabel(m)].filter(Boolean).join(' · ') })]),
        mr.indexOf(id) !== -1 ? h('span', { class: 'rbrem', text: '🔔 Reminder' }) : null]);
    });
    var title = nw ? nw + ' title' + (nw === 1 ? ' is' : 's are') + ' missing from your watchlist' : nRem + ' release reminder' + (nRem === 1 ? ' is' : 's are') + ' missing';
    var card = h('div', { class: 'restorebar', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'rbTitle' }, [
      h('div', { class: 'rbhead' }, [h('div', {}, [h('h2', { id: 'rbTitle', text: title }),
        h('p', { text: 'This browser saved ' + (ids.length === 1 ? 'it' : 'them') + (when ? ' on ' + when : '') + ', but ' + (ids.length === 1 ? 'it isn’t' : 'they aren’t') + ' in your list now. Untick any you don’t want back.' })]),
        h('button', { type: 'button', class: 'rbx', 'aria-label': 'Close for now', text: '×', on: { click: close } })]),
      h('div', { class: 'rblist' }, rows.concat(unknown ? [h('div', { class: 'rbmore', text: 'And ' + unknown + ' more title' + (unknown === 1 ? '' : 's') + ' (restored with the rest)' })] : [])),
      h('div', { class: 'rbacts' }, [btn, h('button', { type: 'button', class: 'btn', text: 'Keep as it is', on: { click: function () { close(); S.bakOffer = false; backupMine(); } } }),
        nRem ? h('span', { class: 'rbnote', text: nRem + ' of these had release reminder' + (nRem === 1 ? '' : 's') + '; they come back too.' }) : null])
    ]);
    btn.addEventListener('click', function () {
      var aw = 0, ar = 0; S.mine.reminders = S.mine.reminders || [];
      ids.forEach(function (id) {
        if (!on[id]) return;
        if (mw.indexOf(id) !== -1 && S.mine.watchlist.indexOf(id) === -1) { S.mine.watchlist.push(id); aw++; }
        if (mr.indexOf(id) !== -1 && S.mine.reminders.indexOf(id) === -1) { S.mine.reminders.push(id); ar++; }
      });
      close(); S.bakOffer = false; render();
      saveMine('Restored ' + aw + ' title' + (aw === 1 ? '' : 's') + (ar ? ' and ' + ar + ' reminder' + (ar === 1 ? '' : 's') : ''));
    });
    count();
    var wrap = h('div', { class: 'rbwrap' }, [h('div', { class: 'rbshade', on: { click: close } }), card]);
    document.body.appendChild(wrap);
    document.addEventListener('keydown', onKey, true);
    btn.focus({ preventScroll: true });
  }
  // The list keys a tap can add to. Before the saved list loads, everything in them came from taps on this page.
  var MINE_KEYS = ['watchlist', 'following', 'reminders', 'wtw', 'nope', 'seen', 'unseen'];
  function mergeMine(saved, local) {
    var out = {};
    MINE_KEYS.forEach(function (k) {
      var a = Array.isArray(saved[k]) ? saved[k].slice() : [];
      (Array.isArray(local[k]) ? local[k] : []).forEach(function (id) { if (a.indexOf(id) === -1) a.push(id); });
      out[k] = a;
    });
    return out;
  }
  // Ratings and reviews are written whole too: wait until the saved ones have loaded.
  function verdictsReady() { if (S.verdictsIn) return true; toast('Loading your ratings. Try again in a moment.'); return false; }
  // Titles you've said you've seen (Seen it on a "Seen these?" card, Don't rate in Tonight's picks). Saved with
  // My List; the ones without a verdict show in "Seen, not rated" there.
  function isSeen(id) { return (S.mine.seen || []).indexOf(id) !== -1; }
  function markSeen(id, on) {
    if (!S.uid) return;
    S.mine.seen = S.mine.seen || [];
    var i = S.mine.seen.indexOf(id);
    if (on && i === -1) S.mine.seen.push(id); else if (!on && i !== -1) S.mine.seen.splice(i, 1); else return;
    if (S.mine.seen.length > 500) S.mine.seen = S.mine.seen.slice(-500);
    saveMine(null);
  }
  function hasReminder(id) { return (S.mine.reminders || []).indexOf(id) !== -1; }
  function toggleRemind(id) {
    if (!needUser()) return;
    S.mine.reminders = S.mine.reminders || [];
    var i = S.mine.reminders.indexOf(id), w = S.mine.watchlist.indexOf(id);
    // Setting a reminder also puts the title on the watchlist. Removing the reminder leaves the watchlist alone: the two
    // are separate choices (take it off the watchlist with the ✓ button).
    if (i === -1) { S.mine.reminders.push(id); if (w === -1) S.mine.watchlist.push(id); }
    else S.mine.reminders.splice(i, 1);
    render(); saveMine(i === -1 ? (w === -1 ? 'Reminder set and added to your watchlist' : 'Reminder set') : 'Reminder removed. It’s still on your watchlist');
  }
  function toggleList(id) {
    if (!needUser()) return;
    var i = S.mine.watchlist.indexOf(id);
    if (i === -1) S.mine.watchlist.push(id); else S.mine.watchlist.splice(i, 1);
    // On home, flip the + / ✓ buttons in place rather than redrawing every row (which made the page flicker).
    if (S.route === 'home' && S.lastDrawn === 'home:') { patchListButtons(); if (i !== -1) myListSwap(id); } else render();
    saveMine(i === -1 ? 'Added to your watchlist' : 'Removed from your watchlist');
  }
  // Home "My List" row: the whole watchlist, newest addition first. It is the visitor's own list, so the language
  // picker (which narrows the other rows) does not apply here, as on the My List page.
  function myListRow() { return S.mine.watchlist.slice().reverse().map(function (id) { return S.byId[id]; }).filter(Boolean); }
  // Home: a title taken off the watchlist (from any row) flips, in the My List row, to the next watchlist title not shown there yet.
  // With none left, the card fades out (and the row goes when it is empty).
  function myListSwap(id) {
    var sec = Array.prototype.filter.call(document.querySelectorAll('#view-home section.sect'), function (x) { return x.getAttribute('aria-label') === 'My List'; })[0];
    if (!sec) return;
    var cards = Array.prototype.slice.call(sec.querySelectorAll('.pc[data-id]'));
    var card = cards.filter(function (c) { return c.getAttribute('data-id') === id; })[0]; if (!card) return;
    var shown = cards.map(function (c) { return c.getAttribute('data-id'); });
    var next = myListRow().filter(function (m) { return shown.indexOf(m.id) === -1; })[0];
    if (!next) {
      card.classList.add('pcgone');
      setTimeout(function () { if (card.parentNode) card.parentNode.removeChild(card); if (!sec.querySelector('.pc')) sec.remove(); }, 320);
      return;
    }
    var nc = posterCard(next); nc.classList.add('pcflip');
    var had = card.contains(document.activeElement);
    card.parentNode.replaceChild(nc, card);
    if (had) { var b = nc.querySelector('.addl'); if (b) b.focus({ preventScroll: true }); }
  }
  function patchListButtons() {
    var v = $('view-home'); if (!v) return;
    v.querySelectorAll('.pc[data-id] .addl').forEach(function (b) {
      var id = b.closest('.pc').getAttribute('data-id'), m = S.byId[id]; if (!m) return;
      var on = inList(id), t = m.data.title;
      b.setAttribute('aria-pressed', String(on)); b.textContent = on ? '✓' : '+';
      b.setAttribute('aria-label', on ? 'Remove ' + t + ' from my watchlist' : 'Add ' + t + ' to my watchlist');
      b.title = on ? 'In my watchlist' : 'Add to my watchlist';
    });
    // The hero's round + / ✓ button (the hero isn't redrawn on a watchlist change either).
    v.querySelectorAll('.roundadd[data-list]').forEach(function (b) {
      var id = b.getAttribute('data-list'), m = S.byId[id]; if (!m) return;
      var on = inList(id), t = m.data.title;
      b.setAttribute('aria-pressed', String(on)); b.textContent = on ? '✓' : '+';
      b.setAttribute('aria-label', on ? 'Remove ' + t + ' from my watchlist' : 'Add ' + t + ' to my watchlist');
      b.title = on ? 'In my watchlist' : 'Add to my watchlist';
    });
  }
  function toggleFollow(uid) {
    if (!needUser() || uid === S.uid) return;
    var i = S.mine.following.indexOf(uid);
    if (i === -1) S.mine.following.push(uid); else S.mine.following.splice(i, 1);
    render(); saveMine(i === -1 ? 'Following' : 'Unfollowed');
  }
  function clone(o) { return JSON.parse(JSON.stringify(o || {})); }

  // ---------- names ----------
  function personEl(uid, cls) { return h('span', { 'data-uid': uid, class: cls || '', text: uid === S.uid ? 'You' : 'Someone' }); }
  function avatarEl(uid, size) { return h('img', { 'data-ava': uid, alt: '', width: size || 34, height: size || 34, style: 'border-radius:50%;background:#2E2A38' }); }
  function fillNames() {
    if (!S.user) return;
    var ids = {};
    document.querySelectorAll('[data-uid],[data-ava]').forEach(function (el) { ids[el.getAttribute('data-uid') || el.getAttribute('data-ava')] = 1; });
    var list = Object.keys(ids); if (!list.length) return;
    S.user.profiles(list).then(function (ps) {
      document.querySelectorAll('[data-uid]').forEach(function (el) { var p = ps[el.getAttribute('data-uid')]; if (p && el.getAttribute('data-uid') !== S.uid) el.textContent = p.name || 'Someone'; });
      document.querySelectorAll('[data-ava]').forEach(function (el) { var p = ps[el.getAttribute('data-ava')]; if (p && p.avatarUrl) el.src = p.avatarUrl; });
    });
  }

  // ---------- routing (clean URLs: /, /browse, /browse/<section>, /my-list, /admin, /movie/<title-year>) ----------
  function slugify(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80); }
  function movieSlug(m) {
    var own = slugify(m.data.slug); if (own) return own;
    var base = slugify(m.data.title) || m.id, y = (m.data.releaseDate || '').slice(0, 4);
    return /^\d{4}$/.test(y) ? base + '-' + y : base;
  }
  // Page titles: the same format the build writes into pre-rendered pages (scripts/build.mjs), so the title
  // search engines see does not change once the app has loaded. Keep the two in step.
  var dupTitles = { list: null, map: {} };
  function titleKey(m) { var d = m.data; return String(d.title || '').trim().toLowerCase() + '|' + (isTv(m) ? 'tv ' + tvYears(d) : (d.releaseDate || '').slice(0, 4)); }
  function movieTitleTag(m) {
    var ov = String(m.data.seoTitle || '').trim(); if (ov) return ov; // SEO title typed in Admin > Edit title
    if (dupTitles.list !== S.movies) { dupTitles = { list: S.movies, map: {} }; S.movies.forEach(function (x) { var k = titleKey(x); dupTitles.map[k] = (dupTitles.map[k] || 0) + 1; }); }
    var d = m.data, parts = [isTv(m) ? (tvYears(d) ? 'TV series ' + tvYears(d) : 'TV series') : (d.releaseDate || '').slice(0, 4)];
    if (dupTitles.map[titleKey(m)] > 1 && langOf(d)) parts.push(langOf(d));
    parts = parts.filter(Boolean);
    var base = d.title + (parts.length ? ' (' + parts.join(', ') + ')' : ''), tot = score(m.id).tot;
    // Same as scripts/build.mjs: a TV show whose title runs past 60 characters uses the first year only.
    var short = isTv(m) && tvYears(d) ? d.title + ' (' + ['TV series ' + String(tvYears(d)).slice(0, 4)].concat(parts.slice(1)).join(', ') + ')' : null;
    var tail = function (b) { return titleTail(b, { tv: isTv(m), upcoming: isUpcoming(m), theatres: d.section === 'In theatres', platform: !!String(d.platform || '').trim(),
      verdicts: tot, popular: d.popular === true || tot >= 20,
      songs: (d.videos || []).some(function (v) { return vidCat(v.kind) === 'songs' && !!ytId(safeUrl(v.url)); }),
      boxOffice: !isTv(m) && !!boFull(m), ottDate: !!d.ottReleaseDate && d.ottReleaseDate >= today(), tickets: btnOn('title', 'book') && hasBooking(d) }); };
    var full = tail(base);
    if (full.length <= 60 || !short) return full;
    var alt = tail(short);
    return alt.length <= 60 || alt.length < full.length ? alt : full;
  }
  // Same as scripts/build.mjs titleTail: the words after a title's name, picked by what its page actually has.
  function titleTail(base, o) {
    var say = function (ws) { return base + ' ' + (ws.length === 1 ? ws[0] : ws.slice(0, -1).join(', ') + ' & ' + ws[ws.length - 1]); };
    var drops = function (full, order) { var out = [full], c = full; order.forEach(function (w) { if (c.indexOf(w) !== -1 && c.length > 1) { c = c.filter(function (x) { return x !== w; }); out.push(c); } }); return out; };
    var cands = [], i, j;
    if (o.tv) cands = o.platform ? drops(['Review', 'Cast', 'Where to Watch'], ['Cast', 'Where to Watch']) : drops(['Review', 'Cast'], ['Cast']);
    else if (o.upcoming) cands = drops(o.songs ? ['Release Date', 'Songs', 'Trailer'] : ['Release Date', 'Cast', 'Trailer'], ['Trailer', 'Songs', 'Cast']);
    else if (o.theatres) {
      var order = ['Verdict', o.verdicts >= 3, 'Box Office', o.boxOffice, 'OTT Release Date', o.ottDate, 'Songs', o.songs, 'Tickets', o.tickets, 'Cast', true], ws = ['Review'];
      for (i = 0; i < order.length; i += 2) if (order[i + 1] && say(ws.concat(order[i])).length <= 60) ws.push(order[i]);
      cands = [ws];
    } else {
      var full = !o.platform ? ['Review', 'Cast', o.songs ? 'Songs' : 'Story']
        : o.popular ? ['Review', o.songs ? 'Songs' : 'Cast', 'Where to Watch']
        : o.verdicts >= 3 ? ['Review', 'Verdict'].concat(o.songs ? ['Songs'] : [], ['OTT'])
        : ['Review', 'Cast'].concat(o.songs ? ['Songs'] : [], ['OTT']);
      cands = drops(full, ['Cast', 'Songs', 'Story', 'Verdict', 'Where to Watch', 'OTT']);
    }
    var lims = [60, 65];
    for (j = 0; j < lims.length; j++) for (i = 0; i < cands.length; i++) { var t = say(cands[i]); if (t.length <= lims[j]) return t; }
    return (base + ' | Reelscore').length <= 60 ? base + ' | Reelscore' : base;
  }
  function personTitleTag(name) {
    var a = name + ' – Movies, TV Shows & Filmography | Reelscore', b = name + ' – Filmography | Reelscore';
    return a.length <= 60 ? a : b.length <= 60 ? b : name + ' | Reelscore';
  }
  // noindex on "not found" screens, so unknown URLs (which the server answers with the app) are not indexed.
  function setNoindex(on) {
    var el = document.querySelector('meta[name="robots"]');
    if (!on) { if (el && el.getAttribute('data-app')) el.remove(); return; }
    if (!el) { el = document.createElement('meta'); el.name = 'robots'; el.setAttribute('data-app', '1'); document.head.appendChild(el); }
    el.content = 'noindex';
  }

  // ?page=N on Browse and People, so every page of results has its own crawlable URL.
  function qPage() { var n = parseInt(new URLSearchParams(location.search).get('page'), 10); return n > 1 ? n : 1; }
  function sectionSlug(status) { for (var k in BROWSE_SECTIONS) if (BROWSE_SECTIONS[k] === status) return k; return ''; }
  // Language landing pages (same paths as scripts/build.mjs): /hindi-movies, /hindi-movies-2026, /hindi-movies-in-theatres,
  // /new-hindi-movies-on-ott, /upcoming-hindi-movies, /hindi-web-series. They open the Browse view with those filters.
  function parseLanding(path) {
    var m = path.match(/^\/(?:(upcoming|new)-)?([a-z]+)-(movies|web-series)(?:-(\d{4}|in-theatres|on-ott))?$/);
    if (!m) return null;
    var pre = m[1] || '', ls = m[2], kind = m[3], suf = m[4] || '';
    if (kind === 'web-series' && (pre || suf)) return null;
    if (pre === 'upcoming' && suf) return null;
    if ((pre === 'new') !== (suf === 'on-ott')) return null;
    var L = ls.charAt(0).toUpperCase() + ls.slice(1), year = /^\d{4}$/.test(suf) ? suf : '', mon = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });
    if (kind === 'web-series') return { path: path, lang: L, status: 'TV shows', kind: 'series', h1: L + ' web series & TV shows', title: L + ' Web Series & TV Shows – Reviews & Where to Watch' };
    if (pre === 'upcoming') return { path: path, lang: L, status: 'Coming soon', kind: 'movies', h1: 'Upcoming ' + L + ' movies', title: 'Upcoming ' + L + ' Movies (' + new Date().getFullYear() + ') – Release Dates' };
    if (suf === 'on-ott') return { path: path, lang: L, status: 'On OTT', kind: 'movies', h1: 'New ' + L + ' movies on OTT', title: 'New ' + L + ' Movies on OTT (' + mon + ')' };
    if (suf === 'in-theatres') return { path: path, lang: L, status: 'In theatres', kind: 'movies', h1: L + ' movies in theatres', title: L + ' Movies in Theatres Now (' + mon + ')' };
    if (year) return { path: path, lang: L, status: 'All', kind: 'movies', year: year, h1: L + ' movies of ' + year, title: L + ' Movies ' + year + (+year > new Date().getFullYear() ? ' – Release Dates & Cast' : ' – Reviews, Verdicts & OTT') };
    return { path: path, lang: L, status: 'All', kind: 'movies', h1: L + ' movies', title: L + ' Movies – Reviews, Verdicts & Where to Watch' };
  }
  function bHref(B, page) { return B.landing ? B.landing.path + (page > 1 ? '?page=' + page : '') : browseHref(B, page); }
  function browseHref(o, page) {
    var q = [];
    if (o.lang) q.push('lang=' + encodeURIComponent(o.lang));
    if (o.genre) q.push('genre=' + encodeURIComponent(o.genre));
    if (o.year) q.push('year=' + o.year);
    if (o.ott) q.push('ott=' + encodeURIComponent(o.ott));
    if (o.q && String(o.q).trim()) q.push('q=' + encodeURIComponent(String(o.q).trim()));
    if (page > 1) q.push('page=' + page);
    var sec = sectionSlug(o.status);
    return '/browse' + (sec ? '/' + sec : '') + (q.length ? '?' + q.join('&') : '');
  }
  // Filtered lists point search engines at the plain list; plain pages 2+ keep their own URL.
  function listCanonical() {
    var page = qPage(), qs = new URLSearchParams(location.search);
    var filtered = qs.get('lang') || qs.get('genre') || qs.get('year') || qs.get('ott') || qs.get('q');
    if (location.pathname === '/browse/movies' && page < 2) return '/movies'; // the Movies page is the one for search engines
    return location.pathname + (page > 1 && !filtered ? '?page=' + page : '');
  }
  function syncListUrl(href) {
    if (href !== location.pathname + location.search) history.replaceState(null, '', href);
    setCanonical(listCanonical());
  }
  // Keep <link rel="canonical"> in step with the page shown; null removes it (private pages).
  function setCanonical(path) {
    var el = document.querySelector('link[rel="canonical"]');
    if (!path) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('link'); el.rel = 'canonical'; document.head.appendChild(el); }
    el.href = location.origin + path;
  }
  function movieUrl(m) { return typeof m === 'string' ? '/movie/' + m : (isTv(m) ? '/tv/' : '/movie/') + movieSlug(m); }
  function findMovie(key) {
    if (!key) return null;
    if (S.byId[key]) return S.byId[key];
    for (var i = 0; i < S.movies.length; i++) if (movieSlug(S.movies[i]) === key) return S.movies[i];
    for (var k = 0; k < S.movies.length; k++) if ((S.movies[k].data.slugHistory || []).indexOf(key) !== -1) return S.movies[k];
    for (var j = 0; j < S.movies.length; j++) if (slugify(S.movies[j].data.title) === key) return S.movies[j];
    if (S.canEdit) {
      var hid = Object.keys(S.hidden || {}).map(function (id) { return S.hidden[id]; }).concat(Object.keys(S.hiddenAdmin || {}).map(function (id) { return S.hiddenAdmin[id]; }));
      for (var q = 0; q < hid.length; q++) if (hid[q].id === key || movieSlug(hid[q]) === key || slugify(hid[q].data.title) === key) return hid[q];
    }
    return null;
  }
  // Hub page titles, the same as the pre-rendered hub pages (scripts/build.mjs HUBS).
  var BROWSE_TITLES = { All: 'Browse Indian Movies & Series | Reelscore', 'In theatres': 'Indian Movies in Theatres Now | Reelscore', 'Coming soon': 'Upcoming Indian Movies | Reelscore',
    'On OTT': 'Indian Movies on OTT | Reelscore', 'All movies': 'All Indian Movies | Reelscore', 'TV shows': 'Indian TV Shows & Series | Reelscore' };
  // Browse tab labels where the status value differs ("All" is every title, films and series).
  var BROWSE_TAB = { All: 'Movies & TV' };
  var PEOPLE_TITLE = 'Indian Actors & Filmmakers | Reelscore';
  var NEWS_TITLE = 'Indian Movie & OTT News | Reelscore';
  // News and the product blog share one database collection ("news"; kind "blog" for blog posts) and one page view.
  var POSTS = {
    news: { base: '/news', label: 'News', title: NEWS_TITLE, h1: 'News', lead: 'Release dates, streaming premieres and what’s new in Indian cinema and series, written by the Reelscore team.',
      what: 'story', all: 'See all news', more: 'More news', none: 'No stories yet. Check back soon.', back: 'Back to News', tag: 'Reelscore' },
    blog: { base: '/blog', label: 'Blog', title: 'Reelscore Blog: Product News & Updates', h1: 'Blog', lead: 'What’s new on Reelscore, how it works and what we’re building next, from the Reelscore team.',
      what: 'post', all: 'See all posts', more: 'More from the blog', none: 'No posts yet. Check back soon.', back: 'Back to the Blog', tag: 'Blog' }
  };
  function postKind(p) { return p && p.kind === 'blog' ? 'blog' : p && p.kind === 'list' ? 'list' : 'news'; }
  // Movies (/movies, /movies/<section>) and TV Shows (/tv-shows): Browse split by kind. Titles match scripts/build.mjs.
  var MOVIES_TITLE = 'Indian Movies – Reviews, Verdicts & OTT | Reelscore', TV_TITLE = 'Indian TV Shows & Web Series | Reelscore';
  // Section slugs (same as scripts/build.mjs HUBS). The old slugs and /movies/<section> paths are 301s in vercel.json;
  // OLD_SECTIONS maps them for in-app navigation too.
  // Browse > All movies (/browse/movies) is every film; the "Older releases" section has no tab of its own.
  var MOVIE_SECTIONS = { 'movies-in-theatres': 'In theatres', 'movies-coming-soon': 'Coming soon', 'movies-on-ott': 'On OTT' };
  var BROWSE_SECTIONS = { 'movies': 'All movies', 'movies-in-theatres': 'In theatres', 'movies-coming-soon': 'Coming soon', 'movies-on-ott': 'On OTT', 'tv-shows': 'TV shows' };
  var OLD_SECTIONS = { 'in-theatres': 'movies-in-theatres', 'coming-soon': 'movies-coming-soon', 'on-ott': 'movies-on-ott', 'older-releases': 'movies' };
  function legacyHashToPath(hsh) {
    if (/^t-[A-Za-z0-9-]+$/.test(hsh)) return '/movie/' + hsh.slice(2);
    if (hsh === 'list') return '/my-list';
    if (hsh === 'browse') return '/browse';
    if (hsh === 'browse-older') return '/browse/movies';
    if (hsh === 'browse-ott') return '/browse/movies-on-ott';
    if (hsh === 'admin') return '/admin';
    if (hsh === 'home') return '/';
    return null;
  }
  // Where a title page was opened from, for its "← Back to …" link.
  function backLabel(f) {
    if (!f) return 'Back to home';
    var nm = function () { return String(f.docTitle || '').split(/ \(| – | \| /)[0].trim(); };
    switch (f.route) {
      case 'home': return 'Back to home';
      case 'browse': return f.status && f.status !== 'All' ? 'Back to ' + f.status : 'Back to Browse';
      case 'movies': return f.movStatus && f.movStatus !== 'All' ? 'Back to ' + f.movStatus : 'Back to Movies';
      case 'tvshows': return 'Back to TV Shows';
      case 'people': return 'Back to People';
      case 'list': return 'Back to My List';
      case 'genre': return 'Back to ' + genreBySlug(f.param) + ' movies';
      case 'year': return 'Back to ' + f.param + ' movies';
      case 'vids': return 'Back to ' + (VID_PAGES[f.param] ? VID_PAGES[f.param].h : 'videos');
      case 'about': return 'Back to About';
      case 'news': return f.param ? (nm() ? 'Back to ' + nm() : 'Back') : POSTS[f.kind || 'news'].back;
      case 'title': case 'person': case 'video': return nm() ? 'Back to ' + nm() : 'Back';
      default: return 'Back';
    }
  }
  function parseRoute() {
    var from = S.route && S.lastPath ? { route: S.route, param: S.param, kind: S.newsKind, status: S.browse && S.browse.status, movStatus: S.cat && S.cat.movies.status, path: S.lastPath + (S.lastSearch || ''), docTitle: document.title, pushed: !!S.pushed } : null;
    S.pushed = false;
    var hsh = (location.hash || '').replace(/^#/, '');
    var legacy = hsh && legacyHashToPath(hsh);
    if (legacy) history.replaceState(null, '', legacy);
    var path = decodeURIComponent(location.pathname).replace(/\/+$/, '') || '/';
    var mm;
    // Old section URLs (/browse/on-ott, /movies/in-theatres, …) move to the new /browse/<slug> addresses, as the 301s do.
    if ((mm = path.match(/^\/(browse|movies)\/([a-z-]+)$/)) && (OLD_SECTIONS[mm[2]] || (mm[1] === 'movies' && MOVIE_SECTIONS[mm[2]]))) {
      path = '/browse/' + (OLD_SECTIONS[mm[2]] || mm[2]);
      history.replaceState(null, '', path + location.search);
    }
    if ((mm = path.match(/^\/(?:movie|tv)\/([a-z0-9-]+)$/i))) { S.route = 'title'; S.param = mm[1].toLowerCase(); }
    else if ((mm = path.match(/^\/(?:movie|tv)\/([a-z0-9-]+)(\/(?:trailer|song|episode|video)(?:\/[a-z0-9-]+)?)$/i))) { S.route = 'video'; S.param = mm[1].toLowerCase(); S.vpath = mm[2].toLowerCase(); }
    else if ((mm = path.match(/^\/person\/([a-z0-9-]+)$/i))) { S.route = 'person'; S.param = mm[1].toLowerCase(); }
    else if (path === '/my-list') { S.route = 'list'; S.param = null; }
    else if (path === '/tonight') { S.route = 'tonight'; S.param = null; }
    else if (path === '/ott-release-dates') { S.route = 'ottdates'; S.param = null; var oq = new URLSearchParams(location.search); S.ottd = { plat: oq.get('ott') || '', lang: oq.get('lang') || '', kind: 'all', allTh: false }; }
    else if (path === '/trailers' || path === '/songs' || path === '/tv-promos') { S.route = 'vids'; S.param = path.slice(1); S.vids = { lang: '', n: 48, q: '', sort: /[?&]sort=views\b/.test(location.search) && path === '/songs' ? 'views' : '' }; }
    else if (path === '/people') { S.route = 'people'; S.param = null; S.ppl.page = qPage(); }
    else if ((mm = path.match(/^\/genre\/([a-z0-9-]+)$/i)) && genreBySlug(mm[1])) {
      S.route = 'genre'; S.param = mm[1].toLowerCase();
      var gq = new URLSearchParams(location.search);
      S.gen.genre = S.param; S.gen.lang = gq.get('lang') || ''; S.gen.page = qPage();
    }
    else if ((mm = path.match(/^\/year\/(\d{4})$/)) && +mm[1] >= 1900 && +mm[1] <= new Date().getFullYear() + 2) {
      S.route = 'year'; S.param = mm[1];
      S.yr.year = mm[1]; S.yr.lang = new URLSearchParams(location.search).get('lang') || ''; S.yr.page = qPage();
    }
    else if ((mm = parseLanding(path)) && !(window.RS_404 || document.querySelector('meta[name="rs-404"]'))) {
      S.route = 'browse'; S.param = null;
      S.browse = { status: mm.status, lang: mm.lang, genre: '', year: mm.year || '', ott: '', q: '', sort: (S.browse && S.browse.sort) || 'new', page: qPage(), landing: mm };
    }
    else if ((mm = path.match(/^\/browse(?:\/([a-z-]+))?$/))) {
      S.route = 'browse'; S.param = null; S.browse.status = (mm[1] && BROWSE_SECTIONS[mm[1]]) || 'All';
      var qs = new URLSearchParams(location.search);
      S.browse.lang = qs.get('lang') || ''; S.browse.genre = qs.get('genre') || ''; S.browse.year = /^\d{4}(-\d{4})?$/.test(qs.get('year') || '') ? qs.get('year') : ''; S.browse.ott = bVals(qs.get('ott')).filter(function (o) { return ottName(o); }).join(','); S.browse.q = qs.get('q') || ''; S.browse.page = qPage();
    }
    else if (path === '/movies') { S.route = 'movies'; S.param = null; catFromUrl(S.cat.movies, 'All'); }
    else if (path === '/tv-shows') { S.route = 'tvshows'; S.param = null; catFromUrl(S.cat.tv, 'All'); }
    else if ((mm = path.match(/^\/admin(\/.*)?$/))) { S.route = 'admin'; S.param = null; S.adminSub = (mm[1] || '').toLowerCase(); }
    else if ((mm = path.match(/^\/lists(?:\/([a-z0-9-]+))?$/i))) { S.route = 'lists'; S.param = mm[1] ? mm[1].toLowerCase() : null; }
    else if ((mm = path.match(/^\/(news|blog)(?:\/([a-z0-9-]+))?$/i))) { S.route = 'news'; S.newsKind = mm[1].toLowerCase(); S.param = mm[2] ? mm[2].toLowerCase() : null; }
    else if (path === '/about') { S.route = 'about'; S.param = null; }
    else if (path === '/privacy') { S.route = 'privacy'; S.param = null; }
    else if (path === '/contact') { S.route = 'contact'; S.param = null; }
    else if ((window.RS_404 || document.querySelector('meta[name="rs-404"]')) && path !== '/') { S.route = 'notfound'; S.param = path; }
    else { S.route = 'home'; S.param = null; if (path !== '/') history.replaceState(null, '', '/'); }
    if (S.route !== (S.heroCtx || 'home') && S.play) leaveHero();
    document.body.className = 'r-' + S.route;
    stopHiddenMedia();
    document.querySelectorAll('.nav a.lnk').forEach(function (a) { var v = a.getAttribute('data-v'); a.setAttribute('aria-current', a.getAttribute('data-r') === S.route && (!v || v === S.param) && !(S.route === 'news' && S.newsKind === 'blog') ? 'page' : 'false'); });
    if (S.route === 'browse') document.title = S.browse.landing ? S.browse.landing.title : (BROWSE_TITLES[S.browse.status] || BROWSE_TITLES.All);
    else if (S.route === 'movies') document.title = S.cat.movies.status === 'All' ? MOVIES_TITLE : (BROWSE_TITLES[S.cat.movies.status] || MOVIES_TITLE);
    else if (S.route === 'tvshows') document.title = TV_TITLE;
    else if (S.route === 'people') document.title = PEOPLE_TITLE;
    else if (S.route === 'genre') document.title = genreTitle(genreBySlug(S.param));
    else if (S.route === 'year') document.title = yearTitle(S.param);
    else if (S.route === 'vids') document.title = VID_PAGES[S.param].t;
    else if (S.route === 'notfound') document.title = 'Page not found | Reelscore';
    else if (S.route === 'about') document.title = 'About Reelscore & How Scores Work';
    else if (S.route === 'news') { if (!S.param) document.title = POSTS[S.newsKind].title; }
    else if (S.route === 'lists') { if (!S.param) document.title = LISTS_TITLE; } // a story's page keeps its own title until drawNews sets it
    else if (S.route === 'privacy') document.title = 'Privacy Policy | Reelscore';
    else if (S.route === 'contact') document.title = 'Contact | Reelscore';
    else if (S.route === 'tonight') document.title = 'Tonight: what to watch now | Reelscore';
    else if (S.route === 'ottdates') document.title = OTTD_TITLE;
    else if (S.route !== 'title' && S.route !== 'person' && S.route !== 'video') document.title = 'Reelscore — Reviews for Indian movies and series';
    if (S.route === 'news' || S.route === 'lists') loadNews();
    if (S.route === 'admin') startAdmin();
    S.restoreHome = S.route === 'home' && S.prevRoute === 'title' && !!S.homeSpot;
    S.prevRoute = S.route;
    if (S.route === 'title' && from && from.path !== location.pathname + location.search && !(from.route === 'title' && from.param === S.param)) S.titleFrom = from;
    else if (S.route === 'title' && !from) S.titleFrom = null;
    S.lastPath = location.pathname; S.lastSearch = location.search;
    if (S.route === 'notfound') setNoindex(true);
    else if (S.route !== 'title' && S.route !== 'person' && S.route !== 'video' && S.route !== 'news' && S.route !== 'lists') setNoindex(false);
    if (S.route === 'list' || S.route === 'admin' || S.route === 'tonight') setCanonical(null);
    else if (S.route === 'browse' || S.route === 'people' || S.route === 'genre' || S.route === 'year') setCanonical(listCanonical());
    else if (S.route === 'movies' || S.route === 'tvshows') setCanonical(catCanonical());
    else if (S.route === 'notfound') setCanonical(null);
    else if (S.route !== 'title' && S.route !== 'person' && S.route !== 'news' && S.route !== 'lists') setCanonical(location.pathname);
    S.rtab = 'all';
    render(true);
    window.scrollTo(0, 0);
  }
  function go(href) {
    if (href === location.pathname + location.search) { window.scrollTo(0, 0); return; }
    if (S.adminApi && S.route === 'admin' && !S.adminApi.canLeave(href)) return;
    history.pushState(null, '', href); S.pushed = true; parseRoute();
  }
  // Same-site links navigate without a page reload.
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest('a[href]'); if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) !== '/' || href.charAt(1) === '/') return;
    if (/^\/(setup|data|js)\b|\.\w+$/.test(href)) return;
    if (S.route === 'home') {
      var sec = a.closest('.view section[aria-label]'), row = sec && sec.querySelector('.rowx');
      S.homeSpot = sec ? { label: sec.getAttribute('aria-label'), left: row ? row.scrollLeft : 0 } : null;
    }
    e.preventDefault(); go(href);
  });
  window.addEventListener('popstate', function () {
    if (S.adminApi && S.route === 'admin' && S.lastPath && location.pathname !== S.lastPath && !S.adminApi.canLeave()) { history.pushState(null, '', S.lastPath); return; }
    parseRoute();
  });
  window.addEventListener('hashchange', function () { if (legacyHashToPath((location.hash || '').slice(1))) parseRoute(); });
  // Keep the address bar on the canonical /movie/<title-year> once the catalogue is in.
  function canonicalizeTitleUrl(m) {
    var want = movieUrl(m);
    if (S.route === 'title' && location.pathname !== want) { history.replaceState(null, '', want); S.param = movieSlug(m); S.lastDrawn = S.route + ':' + S.param; }
  }

  // ---------- render scheduling ----------
  var raf = null;
  function render(force) {
    if (!force) {
      var a = document.activeElement;
      if (a && a.closest && a.closest('.view') && /^(TEXTAREA|INPUT|SELECT)$/.test(a.tagName)) { S.pending = true; return; }
    }
    if (raf) return;
    raf = requestAnimationFrame(function () { raf = null; S.pending = false; fillNavCity(); draw(); fillNames(); });
  }
  // Phones: a slim header (logo, search, account, menu). The menu opens the page links, and the City picker
  // move into it while the screen is phone-sized (the same elements, so everything that fills or reads them still works).
  (function () {
    var hdr = document.querySelector('header.nav'), btn = $('menuBtn'), nav = $('mainNav'), navr = document.querySelector('.navr');
    if (!hdr || !btn || !nav || !navr) return;
    var mq = window.matchMedia('(max-width: 760px)'), box = null;
    function place() {
      var ids = ['navCity'];
      if (mq.matches) {
        if (!box) { box = h('div', { class: 'navsels' }); nav.appendChild(box); }
        ids.forEach(function (id) { var l = document.querySelector('label[for="' + id + '"]'), el = $(id); if (l) box.appendChild(l); if (el) box.appendChild(el); });
      } else {
        if (box) ids.forEach(function (id) { var l = document.querySelector('label[for="' + id + '"]'), el = $(id); if (l) navr.insertBefore(l, btn); if (el) navr.insertBefore(el, btn); });
        setOpen(false);
      }
    }
    function setOpen(on) {
      hdr.classList.toggle('open', on); btn.setAttribute('aria-expanded', String(on));
      btn.setAttribute('aria-label', on ? 'Close menu' : 'Menu');
    }
    btn.addEventListener('click', function (e) { e.stopPropagation(); setOpen(!hdr.classList.contains('open')); });
    nav.addEventListener('click', function (e) { if (e.target.closest('a')) setOpen(false); });
    document.addEventListener('click', function (e) { if (hdr.classList.contains('open') && !hdr.contains(e.target)) setOpen(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && hdr.classList.contains('open')) { setOpen(false); btn.focus(); } });
    window.addEventListener('popstate', function () { setOpen(false); });
    if (mq.addEventListener) mq.addEventListener('change', place); else if (mq.addListener) mq.addListener(place);
    place();
  })();
  (function () { var sel = $('navCity'); if (sel) sel.addEventListener('change', function () { setCity(sel.value); }); })();
  document.addEventListener('focusout', function () { setTimeout(function () { if (S.pending) render(); }, 0); });

  // Back on the home page after opening a title from one of its rows: return to that row, scrolled as it was.
  function restoreHomeSpot() {
    var spot = S.homeSpot; if (!spot) return;
    var sec = Array.prototype.filter.call(document.querySelectorAll('#view-home section[aria-label]'), function (x) { return x.getAttribute('aria-label') === spot.label; })[0];
    if (!sec) return;
    var row = sec.querySelector('.rowx'); if (row) row.scrollLeft = spot.left;
    var off = 16;
    var put = function () { window.scrollTo(0, Math.max(0, sec.getBoundingClientRect().top + window.pageYOffset - off)); if (row) row.scrollLeft = spot.left; };
    put(); setTimeout(put, 60); setTimeout(put, 400);
  }
  // While only the core part of the catalogue is in (everything except Older releases), only the home page draws from
  // it; other pages wait for the rest so "not found" and counts are never decided on part of the data.
  // A title page found in the core part draws at once too; the rest is fetched once the page is idle.
  function syncLoaded() {
    // (While only a title page's seed is in, the home page waits for the catalogue; its own seed draws just the hero.)
    var early = (S.route === 'home' && (!S.seedOnly || S.seedKind === 'home')) || (S.route === 'title' && !!S.hasCat && !!findMovie(S.param));
    S.loaded = !!S.hasCat && (!S.partial || early);
    if (S.partial && S.kickOlder) { if (!early) S.kickOlder(); else if (S.route === 'title' && !S.seedOnly) idleKick(); }
  }
  function idleKick() { if (idleKick.on) return; idleKick.on = 1; var k = function () { if (S.kickOlder) S.kickOlder(); }; if (window.requestIdleCallback) requestIdleCallback(k, { timeout: 4000 }); else setTimeout(k, 3000); }
  function draw() {
    syncLoaded();
    // Keep each horizontal row's scroll position (and keyboard focus) across re-renders of the same page.
    var here = S.route + ':' + (S.param || ''), keep = {}, focusKey = null;
    if (S.lastDrawn === here) {
      document.querySelectorAll('.view .rowx').forEach(function (r) {
        var s = r.closest('section'); if (s && s.getAttribute('aria-label')) keep[s.getAttribute('aria-label')] = r.scrollLeft;
      });
      var a = document.activeElement;
      if (a && a.classList && a.classList.contains('addl')) {
        var sec = a.closest('section'), pc = a.closest('.pc');
        if (sec && pc) focusKey = [sec.getAttribute('aria-label'), Array.prototype.indexOf.call(pc.parentNode.children, pc)];
      }
    }
    S.lastDrawn = here;
    if (S.route === 'home') { drawHome(); if (S.restoreHome) { S.restoreHome = false; restoreHomeSpot(); } }
    else if (S.route === 'title') drawTitle();
    else if (S.route === 'list') drawList();
    else if (S.route === 'tonight') drawTonight();
    else if (S.route === 'ottdates') drawOttDates();
    else if (S.route === 'browse') drawBrowse();
    else if (S.route === 'movies') drawCatalog('movies');
    else if (S.route === 'tvshows') drawCatalog('tv');
    else if (S.route === 'person') drawPerson();
    else if (S.route === 'people') drawPeople();
    else if (S.route === 'genre') drawGenre();
    else if (S.route === 'year') drawYear();
    else if (S.route === 'vids') drawVids();
    else if (S.route === 'video') drawVideo();
    else if (S.route === 'notfound') drawNotFound();
    else if (S.route === 'about') drawAbout();
    else if (S.route === 'news') drawNews();
    else if (S.route === 'lists') drawLists();
    else if (S.route === 'privacy') drawAbout('privacy');
    else if (S.route === 'contact') drawContact();
    applyAdsRule();
    if (Object.keys(keep).length) {
      document.querySelectorAll('.view .rowx').forEach(function (r) {
        var s = r.closest('section'), k = s && s.getAttribute('aria-label');
        if (k && keep[k] != null) r.scrollLeft = keep[k];
      });
    }
    if (focusKey) {
      document.querySelectorAll('.view section.sect').forEach(function (s) {
        if (s.getAttribute('aria-label') !== focusKey[0]) return;
        var row = s.querySelector('.rowx'), pc = row && row.children[Math.min(focusKey[1], row.children.length - 1)];
        var b = pc && pc.querySelector('.addl'); if (b) b.focus({ preventScroll: true });
      });
    }
  }

  // ---------- components ----------
  // Streaming service tile, bottom right of a poster: the service's own logo where we have one (rehosted on Cloudinary: Netflix,
  // JioHotstar, SonyLIV, Prime Video, ZEE5, Apple TV, YuppTV and Vi Movies icons from provider-static.plex.tv, supplied by the owner; Sun NXT, aha, Hoichoi, ALTT, MX Player, Eros Now, TVFPlay, Addatimes, Viu, Hungama and Binge icons supplied by the owner and
  // kept in app/plat/; the rest public-domain files from Wikimedia Commons; the logos stay their owners' trademarks), else its short name on its colour.
  var PLAT = [[/netflix/i, 'Netflix', '#B20710', 'https://res.cloudinary.com/g7mcmxdv/image/upload/f_png,h_96/v1795278115/spekvxajic0oi9ol4afr.svg'], [/prime|amazon prime/i, 'Prime', '#0F79AF', 'https://res.cloudinary.com/g7mcmxdv/image/upload/f_png,h_96/v1795280078/ac5gnb40dhij723apdsq.svg'], [/mini ?tv/i, 'miniTV', '#2B2F3D', 'https://res.cloudinary.com/g7mcmxdv/image/upload/f_png,h_96/v1795277618/favq4myki6jl5iygkxdk.png'],
    [/mx player/i, 'MX', '#1E5BD7', '/app/plat/mx-player.png'], [/hotstar/i, 'Hotstar', '#0C1E5B', 'https://res.cloudinary.com/g7mcmxdv/image/upload/f_png,h_96/v1795278113/zfybbia3pipljitcb1wl.svg'], [/jiocinema/i, 'JioCinema', '#C2185B', 'https://res.cloudinary.com/g7mcmxdv/image/upload/f_png,h_96/v1795278113/zfybbia3pipljitcb1wl.svg', 'now on JioHotstar'], [/zee5/i, 'ZEE5', '#5B2A86', 'https://res.cloudinary.com/g7mcmxdv/image/upload/f_png,h_96/v1795280075/ya5lndxvqdeaszeon5j6.svg'],
    [/sony ?liv/i, 'SonyLIV', '#1F1F1F', 'https://res.cloudinary.com/g7mcmxdv/image/upload/f_png,h_96/v1795278117/vybazqeucxvmpipazla0.svg'], [/hoichoi/i, 'hoichoi', '#C0392B', '/app/plat/hoichoi.png'], [/altt/i, 'ALTT', '#7A1F3D', '/app/plat/altt.png'], [/sun ?nxt/i, 'Sun NXT', '#D35400', '/app/plat/sun-nxt.png'],
    [/\baha\b/i, 'aha', '#E65100', '/app/plat/aha.png'], [/youtube/i, 'YouTube', '#C4302B', 'https://res.cloudinary.com/g7mcmxdv/image/upload/f_png,h_96/v1795277562/hbr6zyrvtrw6u2lphsjz.png'], [/eros/i, 'Eros', '#2B2F3D', '/app/plat/eros-now.png'], [/viu/i, 'Viu', '#B8860B', '/app/plat/viu.png'], [/apple ?tv|itunes/i, 'Apple TV', '#000000', 'https://res.cloudinary.com/g7mcmxdv/image/upload/f_png,h_96/v1795280070/ijn0w6xe9tyivzfddetv.svg'], [/yupp/i, 'YuppTV', '#000000', 'https://res.cloudinary.com/g7mcmxdv/image/upload/f_png,h_96/v1795280072/ohxewc8wkm8co4j90ceo.svg'],
    [/\bvi movies|vi movies/i, 'Vi Movies', '#E4002B', 'https://res.cloudinary.com/g7mcmxdv/image/upload/f_png,h_96/v1795280073/lf3wglbbvsvr9cqtv51a.svg'], [/tvf/i, 'TVFPlay', '#E0A82E', '/app/plat/tvfplay.png'], [/addatimes/i, 'Addatimes', '#E53935', '/app/plat/addatimes.png'], [/hungama/i, 'Hungama', '#111827', '/app/plat/hungama.png'],
    [/^binge$/i, 'Binge', '#5B2A86', '/app/plat/binge.png'], [/voot/i, 'Voot', '#5B2A86', 'https://res.cloudinary.com/g7mcmxdv/image/upload/f_png,h_96/v1795278113/zfybbia3pipljitcb1wl.svg', 'now on JioHotstar']];
  // TV shows (logoOnly) get a tile only when one of their platforms has a logo, so TV channels get none.
  function platBadge(p, logoOnly) {
    var parts = String(p).split('/').map(function (x) { return x.trim(); }), first = parts[0], hit = PLAT.filter(function (x) { return x[0].test(first); })[0];
    if (logoOnly) {
      hit = null;
      parts.some(function (part) { hit = PLAT.filter(function (x) { return x[3] && x[0].test(part); })[0] || null; return !!hit; });
      if (!hit) return null;
    }
    var label = hit ? hit[1] : (first.length > 9 ? first.split(/\s+/)[0] : first);
    var say = 'On ' + p + (hit && hit[4] && !/\bnow\b/i.test(p) ? ', ' + hit[4] : '');
    if (hit && hit[3]) return h('span', { class: 'plat logo' + (hit[1] === 'miniTV' ? ' wide' : ''), title: say, role: 'img', 'aria-label': say }, [h('img', { src: hit[3], alt: '', width: 32, height: 32, loading: 'lazy', decoding: 'async' })]);
    return h('span', { class: 'plat', title: 'On ' + p, 'aria-label': 'On ' + p, style: 'background:' + (hit ? hit[2] : 'rgba(11,10,15,.88)'), text: label });
  }

  // Small inline logo for a button; null if the platform has no logo on file.
  // What visitors see for Now playing, e.g. "Theatres only", "On Netflix", "Direct to OTT"
  function npLabel(m) {
    var d = m.data, np = nowPlayingOf(d), up = d.releaseDate && d.releaseDate > npToday();
    if (!np) return '';
    if (np === 'theatres') return up ? 'Theatrical release' : 'Theatres only';
    if (np === 'out') return 'Out of theatres';
    if (np === 'direct') return 'Direct to OTT';
    return up ? '' : d.platform ? 'On ' + d.platform : 'Now on OTT';
  }
  function platLogo(p) {
    if (!p) return null;
    var hit = null;
    String(p).split('/').some(function (part) { hit = PLAT.filter(function (x) { return x[3] && x[0].test(part.trim()); })[0] || null; return !!hit; });
    return hit ? h('img', { class: 'ctalogo', src: hit[3], alt: '', width: 18, height: 18, loading: 'lazy', decoding: 'async' }) : null;
  }

  // Book tickets / Watch now, switched on or off per page in Admin > Buttons (settings/buttons). Missing = shown.
  function btnPlace() {
    return S.route === 'home' ? 'home' : S.route === 'browse' ? (S.browse && S.browse.landing ? 'lang' : 'browse') : S.route === 'movies' || S.route === 'tvshows' ? 'browse' : S.route === 'list' ? 'mylist' : S.route === 'title' ? 'title' : '';
  }
  function btnOn(place, kind) {
    var b = S.buttons || window.RS_BTNS || {}, p = place && b[place];
    return !(p && p[kind] === false);
  }
  // Days to go for a dated upcoming film: Tomorrow, In 12 days (up to 99 days; past that the date badge says enough).
  function dueLabel(d) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.releaseDate || '')) return '';
    var n = Math.round((new Date(d.releaseDate + 'T00:00:00') - new Date(today() + 'T00:00:00')) / 864e5);
    return n <= 0 ? 'Out today' : n === 1 ? 'Tomorrow' : n < 100 ? 'In ' + n + ' days' : '';
  }
  // The first listed actor (crew left out); with no cast yet, the first genre.
  function upLead(d) {
    var c = (d.cast || []).filter(function (x) { return x && x.name && !CREW_RE.test(x.role || ''); })[0];
    return c ? c.name : String(d.genre || '').split(/,/)[0].trim();
  }
  // Coming soon icon row, laid out like the verdict icons: Trailer, then Tickets when booking is open (else Remind me), then Not for me.
  // The word pops up on hover or keyboard focus; each tap confirms with a toast.
  function upRow(m) {
    var d = m.data, t = d.title;
    var tip = function (x) { return h('span', { class: 'qtip', 'aria-hidden': 'true', text: x }); };
    var tr = vidItems(m).filter(function (x) { return x.cat === 'trailers' && (x.yt || x.clip); })[0] || null;
    var trB = h('button', { type: 'button', class: 'qb tr' + (tr ? '' : ' off'), 'aria-disabled': tr ? null : 'true',
      'aria-label': tr ? 'Play the trailer of ' + t : 'No trailer for ' + t + ' yet',
      on: { click: function (e) { e.preventDefault(); if (tr) openTrailerOverlay(m, tr, trB, titleQueue(m, tr)); else toast('No trailer for ' + t + ' yet'); } } },
      [icon('play', 18), tip(tr ? 'Trailer' : 'No trailer yet')]);
    var mid = btnOn(btnPlace(), 'book') ? bookBtn(m, 'qb tk') : null;
    if (mid) { mid.textContent = ''; mid.appendChild(icon('ticket', 18)); mid.appendChild(tip('Tickets')); }
    else {
      var rem = hasReminder(m.id);
      mid = h('button', { type: 'button', class: 'qb rm' + (rem ? ' on' : ''), 'aria-pressed': String(rem),
        'aria-label': rem ? 'Reminder set for ' + t + '. Tap to turn it off' : 'Remind me when ' + t + ' releases',
        on: { click: function () { toggleRemind(m.id); } } }, [icon('bell', 18), tip(rem ? 'Reminder set' : 'Remind me')]);
    }
    var no = myPlan(m.id) === 'c';
    var skB = h('button', { type: 'button', class: 'qb sk' + (no ? ' on' : ''), 'aria-pressed': String(no),
      'aria-label': no ? t + ' is marked Not for me. Tap to clear' : 'Not for me: ' + t,
      on: { click: function () {
        var had = hasReminder(m.id); setPlan(m.id, 'c');
        var now = myPlan(m.id) === 'c'; if (now === no) return;
        if (!now) toast('Cleared Not for me for ' + t); else if (!had) toast(t + ' marked Not for me');
      } } }, [icon('skip', 18), tip('Not for me')]);
    return h('div', { class: 'qv icons up', role: 'group', 'aria-label': 'Your plan for ' + t }, [trB, mid, skB]);
  }
  function posterCard(m, opts) {
    opts = opts || {};
    var bpl = btnPlace();
    if ((opts.book && !btnOn(bpl, 'book')) || (opts.stream && !btnOn(bpl, 'watch'))) {
      var o2 = {}; Object.keys(opts).forEach(function (k) { o2[k] = opts[k]; });
      if (!btnOn(bpl, 'book')) o2.book = false;
      if (!btnOn(bpl, 'watch')) o2.stream = false;
      opts = o2;
    }
    var d = m.data, sc = score(m.id), img = !!safeUrl(d.posterUrl);
    var top;
    if (opts.dateBadge && !d.releaseDate && !released(m)) {
      top = h('span', { class: 'datebadge tba', title: 'Release date not announced yet' }, [h('b', { text: 'TBA' }), h('small', { text: 'DATE' })]);
    } else if (opts.dateBadge && d.releaseDate) {
      var p = d.releaseDate.split('-');
      top = h('span', { class: 'datebadge' }, [h('b', { text: String(+p[2]) }), h('small', { text: MONTHS[+p[1] - 1].toUpperCase() })]);
    } else {
      var bt = badgeText(m, sc, opts.noNew, opts.ottNew || streamingPage());
      if (bt) top = h('span', { class: 'badge' }, [h('i'), bt]);
    }
    var meta = isTv(m) ? [d.platform || 'TV', tvYears(d)].filter(Boolean).join(' · ') : isOtt(m) ? (d.platform || 'OTT') + (streamDate(d) ? ' · ' + fmtDate(streamDate(d)) : '') : (d.languages || '').split(/[,;]/)[0] + ' · ' + (d.genre || fmtDate(d.releaseDate));
    // Coming soon cards (upIcons): lead actor · language, a days-to-go pill and the Trailer / Remind me or Tickets / Not for me icons.
    var up = !!opts.upIcons && !isTv(m) && !released(m), due = up ? dueLabel(d) : '';
    if (up) meta = [upLead(d), (d.languages || '').split(/[,;]/)[0].trim()].filter(Boolean).join(' · ');
    if (opts.ottMeta) meta = opts.ottMeta(m);
    var on = inList(m.id), pa = artLazy(m, 'poster');
    var kids = [
      h('div', { class: 'pw' }, [
        h('a', { class: 'pa art', href: movieUrl(m), style: pa.style, 'data-bg': pa.bg, 'aria-label': d.title }, [
          h('span', { class: 'pfade' }), h('span', { class: 'ptitle', 'aria-hidden': 'true', text: d.title }), top,
          d.platform && (isOtt(m) || isTv(m)) ? platBadge(d.platform, isTv(m)) : null,
          // Now playing pill (left out for "Now on OTT" when the platform logo already says it)
          up ? (due ? h('span', { class: 'nppill duepill', text: due }) : null)
            : npLabel(m) && !(nowPlayingOf(d) === 'ott' && d.platform) && !(opts.inTheatresList && nowPlayingOf(d) === 'theatres') ? h('span', { class: 'nppill', text: npLabel(m) }) : null
        ]),
        h('button', { type: 'button', class: 'addl', 'aria-pressed': String(on),
          'aria-label': on ? 'Remove ' + d.title + ' from my watchlist' : 'Add ' + d.title + ' to my watchlist',
          title: on ? 'In my watchlist' : 'Add to my watchlist', text: on ? '✓' : '+',
          on: { click: function (e) { e.preventDefault(); e.stopPropagation(); toggleList(m.id); } } })
      ]),
      h('a', { class: 'nm', href: movieUrl(m), text: d.title, tabindex: '-1' }),
      h('span', { class: 'mt', text: meta, title: meta })
    ];
    var tagTxt = opts.tagFor ? opts.tagFor(m) : opts.tag;
    if (tagTxt) kids.push(h('span', { class: 'pctag' + (opts.tagClass ? ' ' + opts.tagClass : ''), text: tagTxt, title: tagTxt }));
    if (up) { kids.push(upRow(m)); return h('div', { class: 'pc' + (img ? ' img' : ''), 'data-id': m.id }, kids); }
    // My Watchlist (not out yet) and Release reminders: the Coming soon icons (Trailer, Remind me or Tickets, Not for me), films and series.
    if (opts.upRowOnly && (!released(m) || opts.upRowAll)) { kids.push(upRow(m)); return h('div', { class: 'pc' + (img ? ' img' : ''), 'data-id': m.id }, kids); }
    var cta = opts.stream && safeUrl(d.platformUrl) ? h('a', { class: 'btn small cta watch', href: d.platformUrl, target: '_blank', rel: 'noopener', 'aria-label': 'Watch now' + (d.platform ? ' on ' + d.platform : '') }, [platLogo(d.platform), h('span', { text: 'Watch now' })]) : opts.book ? bookBtn(m, 'btn small cta book') : null;
    // Browse In theatres cards carry Tickets inside their icon row instead of a Book tickets button.
    if (cta && opts.seenIcons && released(m) && !isTv(m) && !(opts.stream && safeUrl(d.platformUrl))) cta = null;
    if (cta) kids.push(cta);
    else if (opts.followUp) kids.push(followUpBox(m));
    if (opts.rate && !cta && released(m)) {
      kids.push(rateBox(m));
    }
    if (opts.seenIcons && released(m) && !isTv(m)) kids.push(rateBox(m, true));
    if (opts.seenRate) kids.push(seenRateBox(m));
    if (opts.wlVerdict && released(m)) kids.push(wlVerdictBox(m));
    if (opts.myVerdict) {
      var mv = myVerdict(m.id), ml = mv && vset(m).filter(function (x) { return x[0] === mv; })[0];
      if (ml) kids.push(h('span', { class: 'vtag myv', style: 'background:' + VCOL[mv], text: 'Your verdict: ' + ml[1] }));
    }
    // A Book tickets button replaces the reminder (advance booking is open).
    if (opts.remind && !(cta && opts.book && !(opts.stream && safeUrl(d.platformUrl)))) kids.push(h('button', { type: 'button', class: 'btn small rem' + (hasReminder(m.id) ? ' on' : ''), 'aria-pressed': String(hasReminder(m.id)),
      title: hasReminder(m.id) ? 'Tap to cancel the reminder' : 'Get a reminder on release day',
      text: hasReminder(m.id) ? 'Reminder set' : 'Remind me', on: { click: function () { toggleRemind(m.id); } } }));
    return h('div', { class: 'pc' + (img ? ' img' : ''), 'data-id': m.id }, kids);
  }
  var HOME_MAX = 20;
  function seeAll(href) { return h('span', { class: 'sub' }, [h('a', { href: href, text: 'See all' })]); }
  // "More like what you love" (home): a taste profile built from your whole watchlist and your verdicts.
  // Watchlist titles count 1, Theatre / Must watch 1.5, OTT / Watch 0.5, Skip -1 (pushes those genres and people down).
  // A pick needs a real link to one title you saved or liked: a shared actor or director, or two shared genres that aren't
  // broad ones (drama, action, comedy…). Language only filters (it must share one with your titles); it adds nothing to the score.
  // Scored on genre (3) and shared people (2 each, up to 3), plus 1 if it's out in the last two years, in theatres or streaming now.
  // Titles without a poster go to the end. At most 3 cards per saved title, 20 in all; the row hides below 6.
  var BROAD_GENRES = { drama: 1, action: 1, comedy: 1, romance: 1, romantic: 1, family: 1, thriller: 1, film: 1, series: 1, show: 1, entertainer: 1, masala: 1 };
  function tasteFeatures(m) {
    var d = m.data, g = {}, l = {}, p = {};
    String(d.genre || '').toLowerCase().split(/[^a-z-]+/).forEach(function (t) { if (t.length > 2 && t !== 'and') g[t] = 1; });
    langsOf(d).forEach(function (x) { l[x.toLowerCase()] = 1; });
    var actors = 0;
    (d.cast || []).forEach(function (c) {
      if (!c || !c.name) return; var k = personSlug(c.name); if (!k) return;
      if (/director/i.test(c.role || '')) p[k] = 1;
      else if (!CREW_RE.test(c.role || '') && actors < 6) { actors++; p[k] = 1; }
    });
    return { g: g, l: l, p: p };
  }
  // Once the row has been shown, it stays put for the session: saving one of its picks to your list doesn't pull the
  // card out or reshuffle the row (the watchlist it was built from is held until the page reloads).
  var mlShown = Object.create(null), mlWatch = null, mlVerd = null;
  function becauseListSection() {
    if ((mlWatch && mlWatch.uid !== S.uid) || (mlVerd && mlVerd.uid !== S.uid)) { mlWatch = null; mlVerd = null; mlShown = Object.create(null); }
    var wl = mlWatch || S.mine.watchlist || [];
    if (!S.uid && !wl.length) return null;
    var seeds = {}, add = function (id, w, why) { if (!S.byId[id]) return; var s = seeds[id]; if (!s || Math.abs(w) > Math.abs(s.w)) seeds[id] = { w: w, why: why }; };
    wl.forEach(function (id) { add(id, 1, 'saved'); });
    // Verdicts given this visit (from the row's own buttons, say) don't reshuffle the row either: it uses the ones from when it was first shown.
    var vv = mlVerd || (S.uid && S.verdicts[S.uid] ? S.verdicts[S.uid].v || {} : {});
    var ck = wl.join(',') + '|' + JSON.stringify(vv) + '|' + S.movies.length;
    if (becauseListSection.ck === ck) return becauseListSection.draw();
    Object.keys(vv).forEach(function (id) { var x = vv[id]; add(id, x === 'a' ? 1.5 : x === 'b' ? 0.5 : -1, x === 'c' ? 'skip' : 'rated'); });
    var ids = Object.keys(seeds), W = 0, pg = {}, pl = {}, pp = {}, feat = {};
    ids.forEach(function (id) {
      var s = seeds[id], f = feat[id] = tasteFeatures(S.byId[id]); if (s.w > 0) W += s.w;
      Object.keys(f.g).forEach(function (k) { pg[k] = (pg[k] || 0) + s.w; });
      Object.keys(f.l).forEach(function (k) { pl[k] = (pl[k] || 0) + s.w; });
      Object.keys(f.p).forEach(function (k) { pp[k] = (pp[k] || 0) + s.w; });
    });
    if (!W) return null;
    var myLangs = {}; ids.forEach(function (id) { if (seeds[id].w > 0) Object.keys(feat[id].l).forEach(function (k) { myLangs[k] = 1; }); });
    var scored = [];
    S.movies.forEach(function (m) {
      if (seeds[m.id] || (inList(m.id) && !mlShown[m.id]) || vv[m.id] || m.data.published === false) return;
      var f = tasteFeatures(m), gs = 0, ps = 0, gk = Object.keys(f.g), pk = Object.keys(f.p);
      if (!Object.keys(f.l).some(function (k) { return myLangs[k]; })) return;
      gk.forEach(function (k) { gs += (pg[k] || 0) / W; });
      if (gk.length) gs = gs / Math.sqrt(gk.length);
      pk.forEach(function (k) { ps += pp[k] || 0; });
      ps = Math.max(-3, Math.min(3, ps));
      if (gs <= 0 && ps <= 0) return;
      var np = nowPlayingOf(m.data), now = np === 'theatres' || np === 'ott' || m.data.section === 'In theatres' || m.data.section === 'On OTT';
      var rd = String(m.data.releaseDate || ''), recent = released(m) && rd && daysSince(rd) <= 730;
      var w = gs * 3 + ps * 2 + (now || recent ? 1 : 0);
      if (w > 1) scored.push({ m: m, w: w, f: f, art: !!safeUrl(m.data.posterUrl) });
    });
    scored.sort(function (a, b) { return (b.art - a.art) || b.w - a.w || (b.m.data.releaseDate || '').localeCompare(a.m.data.releaseDate || ''); });
    var pos = ids.filter(function (id) { return seeds[id].w > 0; }), per = {}, out = [], why = {};
    // 40 picks: the row shows 20; the rest stand by for cards marked "Not for me".
    for (var i = 0; i < scored.length && out.length < 40 && i < 400; i++) {
      var o = scored[i], best = null, bw = 0;
      pos.forEach(function (id) {
        var f = feat[id], sw = 0, people = 0, sharp = 0;
        Object.keys(o.f.p).forEach(function (k) { if (f.p[k]) { sw += 2; people++; } });
        Object.keys(o.f.g).forEach(function (k) { if (f.g[k]) { sw += 1; if (!BROAD_GENRES[k]) sharp++; } });
        if (!people && sharp < 2) return;
        sw *= seeds[id].w;
        if (sw > bw) { bw = sw; best = id; }
      });
      if (!best || (per[best] || 0) >= 3) continue;
      per[best] = (per[best] || 0) + 1; out.push(o.m);
      why[o.m.id] = (vv[best] === 'a' ? 'Because you loved ' : seeds[best].why === 'rated' ? 'Because you rated ' : 'Because you saved ') + S.byId[best].data.title;
    }
    becauseListSection.ck = ck;
    becauseListSection.draw = function () {
      // Left out: "Not for me" (Tonight) and "Haven't seen" on this row's cards (we said we won't ask about them here again).
      var nope = tnNope(), fits = function (m) { var un = rateUnseen(); return S.byId[m.id] && nope.indexOf(m.id) === -1 && un.indexOf(m.id) === -1 && (!inList(m.id) || mlShown[m.id]); };
      var list = out.filter(fits).slice(0, 20);
      if (list.length < 6) return null;
      var opts = { noNew: true, rate: true, tagFor: function (m) { return why[m.id]; } };
      S.rateRows = S.rateRows || {};
      S.rateRows['More like what you love'] = { opts: opts, next: function (shown) {
        var n = out.filter(function (m) { return fits(m) && !inList(m.id) && !myVerdict(m.id) && shown.indexOf(m.id) === -1; })[0];
        if (n) mlShown[n.id] = 1; return n;
      } };
      list.forEach(function (m) { mlShown[m.id] = 1; }); if (!mlWatch) { mlWatch = (S.mine.watchlist || []).slice(); mlWatch.uid = S.uid; }
      if (!mlVerd && S.uid && S.verdictsIn) { mlVerd = clone(vv); mlVerd.uid = S.uid; }
      var sec = rowSection('More like what you love', list, opts, h('span', { class: 'sub', text: 'Picked from your watchlist and verdicts' }));
      if (sec) sec.id = 'becauselist';
      return sec;
    };
    return becauseListSection.draw();
  }
  // ---------- Tonight: three picks for right now ----------
  // My apps: the streaming apps a viewer pays for. Kept on this device, and in the profile doc when signed in.
  var TN_APPS = [['Netflix', /netflix/i], ['Prime Video', /prime video|amazon prime/i], ['JioHotstar', /hotstar|jiocinema|voot/i], ['ZEE5', /zee5/i],
    ['SonyLIV', /sony ?liv/i], ['aha', /\baha\b/i], ['Sun NXT', /sun ?nxt/i], ['ManoramaMAX', /manorama ?max/i], ['Hoichoi', /hoichoi/i],
    ['MX Player', /mx player/i], ['ALTT', /\baltt\b|altbalaji/i], ['YouTube', /youtube/i]];
  var TN_MOODS = [['thrill', 'Thrill', /thriller|crime|action|mystery|suspense|heist|spy|gangster|psychological|war/],
    ['laugh', 'Laugh', /comedy|satire|comic/], ['feel', 'Feel-good', /romantic|romance|family|musical|music|coming-of-age|feel-good|slice/],
    ['think', 'Think', /drama|political|social|biograph|historical|history|period|legal|documentary|sports?\b/],
    ['family', 'With family', /family|animated|animation|children|kids|devotional/], ['scare', 'Scare', /horror|supernatural/]];
  var TN_LANGS = ['Hindi', 'Tamil', 'Telugu', 'Malayalam', 'Kannada'], TN_MORE_LANGS = ['Marathi', 'Bengali', 'Punjabi', 'Gujarati', 'English'];
  function myApps() {
    if (S.uid && Array.isArray(S.mine.apps)) return S.mine.apps.slice();
    try { var a = JSON.parse(localStorage.getItem('rs_apps') || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  function setApps(list) {
    try { localStorage.setItem('rs_apps', JSON.stringify(list)); } catch (e) {}
    if (S.uid && S.mineLoaded) { S.mine.apps = list.slice(); saveMine(null); }
  }
  function appsOf(d) { var p = String(d.platform || ''); return TN_APPS.filter(function (a) { return a[1].test(p); }).map(function (a) { return a[0]; }); }
  function runtimeMin(d) { var r = String(d.runtime || ''), hh = r.match(/(\d+)\s*h/i), mm = r.match(/(\d+)\s*m/i); var t = (hh ? +hh[1] * 60 : 0) + (mm ? +mm[1] : 0); if (!t && /^\d+$/.test(r)) t = +r; return t || 0; }
  function daysSince(iso) { if (!iso || iso.length < 10) return 9999; return Math.floor((Date.parse(today()) - Date.parse(iso.slice(0, 10))) / 864e5); }
  // State: answers persist on this device; titles passed over with "None of these" are only dropped for the session.
  var TN_RECENT_DAYS = 730, TN_ERAS = [['recent', 'Recent'], ['old', 'Older'], ['any', 'Any']];
  function tnState() {
    if (!S.tonight) {
      var saved = {}; try { saved = JSON.parse(localStorage.getItem('rs_tonight') || '{}') || {}; } catch (e) {}
      S.tonight = { where: saved.where === 'out' ? 'out' : 'home', time: saved.time === 'short' ? 'short' : 'any',
        era: saved.era === 'recent' || saved.era === 'old' ? saved.era : 'any',
        kind: saved.kind === 'movie' || saved.kind === 'tv' ? saved.kind : 'any',
        mood: TN_MOODS.some(function (x) { return x[0] === saved.mood; }) ? saved.mood : 'thrill',
        langs: Array.isArray(saved.langs) ? saved.langs : [], seen: [], step: 'ask', allLangs: false,
        // The 3 cards (title ids, null = no pick left), how often each slot has changed (drives the flip-in), the
        // shortlist (titles added with + tonight, at most 3) and titles marked seen this session.
        slots: null, n: [0, 0, 0], drawn: [0, 0, 0], pins: [], gone: [], rating: null, anim: {} };
    }
    return S.tonight;
  }
  function tnSave() { var t = S.tonight; try { localStorage.setItem('rs_tonight', JSON.stringify({ where: t.where, time: t.time, era: t.era, kind: t.kind, mood: t.mood, langs: t.langs })); } catch (e) {} }
  // Taste profile from the watchlist and verdicts (same weights as "More like what you love").
  function tasteModel() {
    var vv = S.uid && S.verdicts[S.uid] ? S.verdicts[S.uid].v || {} : {};
    var ck = (S.mine.watchlist || []).join(',') + '|' + JSON.stringify(vv) + '|' + S.movies.length;
    if (tasteModel.ck === ck) return tasteModel.m;
    var seeds = {}, add = function (id, w, why) { if (!S.byId[id]) return; var s = seeds[id]; if (!s || Math.abs(w) > Math.abs(s.w)) seeds[id] = { w: w, why: why }; };
    (S.mine.watchlist || []).forEach(function (id) { add(id, 1, 'saved'); });
    Object.keys(vv).forEach(function (id) { var x = vv[id]; add(id, x === 'a' ? 1.5 : x === 'b' ? 0.5 : -1, x === 'a' ? 'loved' : x === 'c' ? 'skip' : 'rated'); });
    var ids = Object.keys(seeds), W = 0, pg = {}, pl = {}, pp = {}, feat = {};
    ids.forEach(function (id) {
      var s = seeds[id], f = feat[id] = tasteFeatures(S.byId[id]); if (s.w > 0) W += s.w;
      Object.keys(f.g).forEach(function (k) { pg[k] = (pg[k] || 0) + s.w; });
      Object.keys(f.l).forEach(function (k) { pl[k] = (pl[k] || 0) + s.w; });
      Object.keys(f.p).forEach(function (k) { pp[k] = (pp[k] || 0) + s.w; });
    });
    var pos = ids.filter(function (id) { return seeds[id].w > 0; });
    var model = {
      vv: vv,
      score: function (m) {
        if (!W) return 0;
        var f = tasteFeatures(m), gs = 0, ls = 0, ps = 0, gk = Object.keys(f.g);
        gk.forEach(function (k) { gs += (pg[k] || 0) / W; }); if (gk.length) gs = gs / Math.sqrt(gk.length);
        Object.keys(f.l).forEach(function (k) { ls = Math.max(ls, (pl[k] || 0) / W); });
        Object.keys(f.p).forEach(function (k) { ps += pp[k] || 0; });
        return gs * 3 + ls * 2 + Math.max(-3, Math.min(3, ps)) * 2;
      },
      // The saved or rated title this one is most like, when the link is real (a shared person, or two shared genres).
      reason: function (m) {
        var f = tasteFeatures(m), best = null, bw = 0;
        pos.forEach(function (id) {
          var g = feat[id], sp = 0, sg = 0;
          Object.keys(f.p).forEach(function (k) { if (g.p[k]) sp++; });
          Object.keys(f.g).forEach(function (k) { if (g.g[k]) sg++; });
          var sw = (sp * 2 + sg) * seeds[id].w; if ((sp || sg >= 2) && sw > bw) { bw = sw; best = id; }
        });
        if (!best) return '';
        return (seeds[best].why === 'loved' ? 'Because you loved ' : seeds[best].why === 'rated' ? 'Because you rated ' : 'Because you saved ') + S.byId[best].data.title;
      }
    };
    tasteModel.ck = ck; tasteModel.m = model;
    return model;
  }
  // "Not for me": titles a viewer never wants suggested. In the profile doc when signed in, else on this device.
  function tnNope() {
    var a = S.uid && S.mineLoaded ? (S.mine.nope || []) : []; try { a = a.concat(JSON.parse(localStorage.getItem('rs_nope') || '[]') || []); } catch (e) {}
    return a;
  }
  function tnAddNope(id) {
    if (S.uid && S.mineLoaded) { S.mine.nope = (S.mine.nope || []).filter(function (x) { return x !== id; }).concat([id]).slice(-500); saveMine(null); }
    else { try { var a = JSON.parse(localStorage.getItem('rs_nope') || '[]') || []; if (a.indexOf(id) === -1) a.push(id); localStorage.setItem('rs_nope', JSON.stringify(a.slice(-500))); } catch (e) {} }
  }
  // "Not tonight" in Your 3 for tonight: skipped for the rest of today only, on this device; tomorrow it can come back.
  function tnSkipped() {
    try { var o = JSON.parse(localStorage.getItem('rs_tnskip') || '{}') || {}; return o.d === today() && Array.isArray(o.ids) ? o.ids : []; } catch (e) { return []; }
  }
  function tnSkipToday(id) {
    try { var a = tnSkipped(); if (a.indexOf(id) === -1) a.push(id); localStorage.setItem('rs_tnskip', JSON.stringify({ d: today(), ids: a.slice(-200) })); } catch (e) {}
  }
  // "Movies or TV shows?" only applies at home (cinemas show films). TV shows have no "How much time?": episodes are short.
  function tnKind(t) { return t.where === 'out' ? 'any' : t.kind || 'any'; }
  function tnTime(t) { return tnKind(t) === 'tv' ? 'any' : t.time; }
  function tnPool(t) {
    var apps = myApps(), mood = TN_MOODS.filter(function (x) { return x[0] === t.mood; })[0], tm = tasteModel(), nope = tnNope().concat(tnSkipped());
    var out = [];
    S.movies.forEach(function (m) {
      var d = m.data, pinned = t.pins.indexOf(m.id) !== -1;
      if (d.published === false || !released(m) || (inList(m.id) && !pinned) || tm.vv[m.id] || (!pinned && (t.seen.indexOf(m.id) !== -1 || t.gone.indexOf(m.id) !== -1 || nope.indexOf(m.id) !== -1))) return;
      var np = nowPlayingOf(d), sec = npSection(d);
      if (t.where === 'out') { if (sec !== 'In theatres' && np !== 'theatres') return; }
      else {
        if (sec === 'In theatres' || np === 'theatres' || !d.platform) return;
        var mine = appsOf(d); if (apps.length && !mine.some(function (a) { return apps.indexOf(a) !== -1; })) return;
        var kind = tnKind(t);
        if ((kind === 'movie' && isTv(m)) || (kind === 'tv' && !isTv(m))) return;
        if (isTv(m) && tnTime(t) === 'short') return;
      }
      if (t.langs.length && !langsOf(d).some(function (l) { return t.langs.indexOf(l) !== -1; })) return;
      var g = String(d.genre || '').toLowerCase(), cert = String(d.certificate || '').toUpperCase();
      // Mood fit: how many of the title's genres match, with extra weight when its first (main) genre does.
      var gl = g.split(/,|\//).map(function (x) { return x.trim(); }).filter(Boolean), fit = gl.filter(function (x) { return mood[2].test(x); }).length;
      if (t.mood === 'family') { if (cert === 'A' || /horror|erotic|adult|crime/.test(g)) return; if (!fit && cert === 'U' && /comedy|fantasy|adventure/.test(g)) fit = 1; }
      if (!fit) return;
      var moodW = fit * 1.2 + (gl[0] && mood[2].test(gl[0]) ? 1.5 : 0);
      var rt = runtimeMin(d); if (tnTime(t) === 'short' && rt > 120) return;
      // "How new?" (at home only; cinemas are new by nature). Recent = first released in the last 2 years, Older = before that.
      var era = t.where === 'out' ? 'any' : t.era, made = daysSince(d.releaseDate);
      if (era === 'recent' && made > TN_RECENT_DAYS) return;
      if (era === 'old' && (made <= TN_RECENT_DAYS || made === 9999)) return;
      var sc = score(m.id), pct = shownPct(sc), age = daysSince(t.where === 'out' ? d.releaseDate : (d.ottReleaseDate || d.releaseDate));
      // Taste is capped so a viewer's saved and rated titles (often older films) can't outweigh how new a title is.
      // Newer titles get a bigger lift, and anything over five years old is pushed down.
      // Asking for older titles turns the recency lift off, so the best-liked fits come first.
      var taste = tm.score(m), fresh = era === 'old' ? 0 : age <= 30 ? 2 : age <= 90 ? 1.5 : age <= 365 ? 1 : age <= 730 ? 0.5 : age <= 1825 ? 0 : -1.5;
      var w = moodW + Math.max(-3, Math.min(2.5, taste)) + (pct !== null ? pct / 40 + Math.min(1, sc.tot / 20) : 0) + fresh + (safeUrl(d.posterUrl) ? 0.3 : 0) + (t.mood === 'family' && cert === 'U' ? 1 : 0) + (rt && tnTime(t) === 'short' ? 0.3 : 0);
      out.push({ m: m, w: w, taste: taste, pct: pct, age: age, rt: rt, cert: cert });
    });
    out.sort(function (a, b) { return b.w - a.w || (b.m.data.releaseDate || '').localeCompare(a.m.data.releaseDate || ''); });
    return out;
  }
  function tnReason(o, t) {
    var d = o.m.data, r = o.taste > 1.5 ? tasteModel().reason(o.m) : '';
    if (r) return r;
    if (o.pct !== null && o.pct >= 70) return o.pct + '% say it’s worth it';
    if (o.age <= 30) return t.where === 'out' ? 'New in cinemas' : 'New on ' + (appsOf(d)[0] || String(d.platform).split('/')[0].trim());
    if (t.mood === 'family' && o.cert === 'U') return 'U certificate';
    if (tnTime(t) === 'short' && o.rt) return 'Under 2 hrs';
    return 'Matches ' + TN_MOODS.filter(function (x) { return x[0] === t.mood; })[0][1];
  }
  function tnCta(m, t) {
    var d = m.data;
    if (t.where === 'out') return bookBtn(m, 'btn small primary tncta') || h('a', { class: 'btn small tncta', href: movieUrl(m), text: 'See showtimes' });
    var url = safeUrl(d.platformUrl), app = appsOf(d)[0] || String(d.platform || '').split('/')[0].trim();
    return url ? h('a', { class: 'btn small primary tncta', href: url, target: '_blank', rel: 'noopener' }, [platLogo(d.platform), h('span', { text: 'Watch on ' + app })])
      : h('a', { class: 'btn small tncta', href: movieUrl(m), text: 'Where to watch' });
  }
  function tnSummary(t) {
    var k = tnKind(t);
    return [t.where === 'out' ? 'Going out' : 'At home'].concat(k === 'movie' ? ['Movies'] : k === 'tv' ? ['TV shows'] : []).concat(k === 'tv' ? [] : [t.time === 'short' ? 'Under 2 hrs' : 'Any length']).concat(t.where === 'out' || t.era === 'any' ? [] : [t.era === 'recent' ? 'Recent' : 'Older']).concat([TN_MOODS.filter(function (x) { return x[0] === t.mood; })[0][1], t.langs.length ? t.langs.join(' or ') : 'Any language']).join(' · ');
  }
  // The questions. onChange redraws whatever holds them.
  function tnQuestions(t, onChange) {
    var set = function (k, v) { t[k] = v; t.seen = []; t.rating = null; tnSave(); tnFill(t, false); onChange(); };
    var group = function (label, kids) { return h('div', { class: 'tnq', role: 'group', 'aria-label': label }, [h('div', { class: 'tnql', text: label }), h('div', { class: 'tnopts' }, kids)]); };
    // An icon plays its small animation on hover, and once on the chip you just picked (the section redraws on a pick).
    var opt = function (k, v, label, ic) {
      var go = S.tnChipGo === k + ':' + v;
      return h('button', { type: 'button', class: 'chip tnchip' + (ic ? ' tni-' + ic : '') + (go ? ' go' : ''), 'aria-pressed': String(t[k] === v), on: { click: function () { S.tnChipGo = k + ':' + v; set(k, v); } } }, ic ? [icon(ic, 16), h('span', { text: label })] : [label]);
    };
    var MOOD_IC = { thrill: 'zap', laugh: 'smile', feel: 'heart', think: 'bulb', family: 'users', scare: 'ghost' };
    var langs = TN_LANGS.concat(t.allLangs ? TN_MORE_LANGS : []);
    var out = [
      group('Where are you watching?', [opt('where', 'home', 'At home', 'home'), opt('where', 'out', 'Going out', 'ticket')]),
      t.where === 'out' ? null : group('Movies or TV shows?', [opt('kind', 'movie', 'Movies', 'screen'), opt('kind', 'tv', 'TV shows', 'tv'), opt('kind', 'any', 'Any')]),
      tnKind(t) === 'tv' ? null : group('How much time?', [opt('time', 'short', 'Under 2 hrs'), opt('time', 'any', 'Any length')]),
      t.where === 'out' ? null : group('How new?', TN_ERAS.map(function (x) { return opt('era', x[0], x[1]); })),
      group('What mood?', TN_MOODS.map(function (x) { return opt('mood', x[0], x[1], MOOD_IC[x[0]]); })),
      group('Languages (pick any)', [h('button', { type: 'button', class: 'chip tnchip', 'aria-pressed': String(!t.langs.length), text: 'Any', on: { click: function () { set('langs', []); } } })]
        .concat(langs.map(function (l) { var on = t.langs.indexOf(l) !== -1; return h('button', { type: 'button', class: 'chip tnchip', 'aria-pressed': String(on), text: l, on: { click: function () { set('langs', on ? t.langs.filter(function (y) { return y !== l; }) : t.langs.concat([l])); } } }); }))
        .concat(t.allLangs ? [] : [h('button', { type: 'button', class: 'chip tnchip gap', text: 'More languages', on: { click: function () { t.allLangs = true; onChange(); } } })]))
    ];
    S.tnChipGo = null;
    return out.filter(Boolean);
  }
  // Tonight card art with a ▶ on it (no label) when the title has a YouTube trailer. Tapping plays it in the art's place, with sound;
  // the player loads only then, so the cards stay light. ✕ or Esc puts the art back. One trailer plays at a time.
  function tnTrailer(m) { return vidItems(m).filter(function (x) { return x.cat === 'trailers' && x.yt; })[0] || null; }
  var tnStopPlaying = null;
  function tnMedia(m, art) {
    var tr = tnTrailer(m), box = h('div', { class: 'tnmedia' }, [art]);
    if (!tr) return box;
    var label = (/teaser/i.test(tr.kind) ? 'Teaser' : /promo/i.test(tr.kind) ? 'Promo' : 'Trailer') + (tr.dur ? ' · ' + tr.dur : '');
    var play = h('button', { type: 'button', class: 'tnplay', 'aria-label': 'Play the ' + label.split(' ·')[0].toLowerCase() + ' of ' + m.data.title, on: { click: start } },
      [h('span', { class: 'pb', 'aria-hidden': 'true', text: '▶' })]);
    box.appendChild(play);
    // A click anywhere on the art plays the trailer too (the title under it goes to the page). The art keeps its link for
    // search engines and for opening in a new tab (Cmd/Ctrl-click, middle-click); the ▶ button is the keyboard stop.
    art.setAttribute('tabindex', '-1'); art.setAttribute('aria-hidden', 'true');
    art.addEventListener('click', function (e) { if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return; e.preventDefault(); start(); });
    function onKey(e) { if (e.key === 'Escape') stopIt(); }
    function stopIt() {
      if (tnStopPlaying === stopIt) tnStopPlaying = null;
      document.removeEventListener('keydown', onKey);
      box.classList.remove('playing'); box.closest('.tnpick') && box.closest('.tnpick').classList.remove('playing');
      box.innerHTML = ''; box.appendChild(art); box.appendChild(play); play.focus();
    }
    function start() {
      if (miniOn()) { toMini(m, tr); return; }
      if (tnStopPlaying) tnStopPlaying();
      tnStopPlaying = stopIt;
      var frame = h('iframe', { class: 'tnframe', src: 'https://www.youtube-nocookie.com/embed/' + tr.yt + '?autoplay=1&rel=0&playsinline=1&modestbranding=1', title: m.data.title + ' · ' + tr.title,
        allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin' });
      var x = h('button', { type: 'button', class: 'tnclose', 'aria-label': 'Close the trailer', text: '✕', on: { click: stopIt } });
      box.innerHTML = ''; box.classList.add('playing'); box.closest('.tnpick') && box.closest('.tnpick').classList.add('playing');
      box.appendChild(frame); box.appendChild(x); x.focus();
      document.addEventListener('keydown', onKey);
    }
    return box;
  }
  // The 3 cards. Slots hold title ids; a shortlisted title that still fits the answers keeps its card, shortlisted titles
  // that fit come back first, then the best of the pool. A slot whose title changes flips in (CSS), once.
  function tnFill(t, first) {
    if (!tnReady()) { t.slots = null; return; }
    var ids = tnPool(t).map(function (o) { return o.m.id; }), old = t.slots || [null, null, null];
    var keep = old.map(function (id) { return id && t.pins.indexOf(id) !== -1 && ids.indexOf(id) !== -1 ? id : null; });
    var q = t.pins.filter(function (id) { return ids.indexOf(id) !== -1 && keep.indexOf(id) === -1; })
      .concat(ids.filter(function (id) { return t.pins.indexOf(id) === -1; }));
    t.slots = keep.map(function (id, i) {
      if (id) return id;
      var next = q.shift() || null; if (!first && next !== old[i]) t.n[i]++;
      return next;
    });
    if (first) t.drawn = t.n.slice();
  }
  function tnNext(t) {
    var ids = tnPool(t).map(function (o) { return o.m.id; });
    return ids.filter(function (id) { return t.slots.indexOf(id) === -1 && t.pins.indexOf(id) === -1; });
  }
  function tnSwap(t, i) { var next = tnNext(t)[0] || null; t.slots[i] = next; t.n[i]++; if (t.rating === i) t.rating = null; return next; }
  function tnPin(t, m, onChange) {
    var id = m.id, i = t.pins.indexOf(id), title = m.data.title;
    if (i !== -1) {
      t.pins.splice(i, 1);
      if (S.uid && inList(id)) { S.mine.watchlist.splice(S.mine.watchlist.indexOf(id), 1); saveMine(null); if (S.route === 'home' && S.lastDrawn === 'home:') patchListButtons(); }
      toast(title + (S.uid ? ' removed from your shortlist and watchlist' : ' removed from your shortlist'));
    } else {
      if (t.pins.length >= 3) { toast('Your shortlist holds 3. Remove one, or pick one for tonight.'); return; }
      t.pins.push(id); t.anim.pin = id; t.anim.chip = id;
      if (S.uid) { if (!inList(id)) { S.mine.watchlist.push(id); saveMine(null); if (S.route === 'home' && S.lastDrawn === 'home:') patchListButtons(); } toast(title + ' added to your watchlist' + (t.pins.length === 3 ? '. That’s 3: pick one for tonight.' : '')); }
      else toast(title + ' is on your shortlist. Sign in to keep it on your watchlist.');
    }
    onChange();
  }
  function tnWatch(m, t, cls) {
    var d = m.data;
    if (t.where === 'out') return bookBtn(m, 'btn small primary ' + cls) || h('a', { class: 'btn small ' + cls, href: movieUrl(m), text: 'Showtimes' });
    var url = safeUrl(d.platformUrl);
    return url ? h('a', { class: 'btn small primary ' + cls, href: url, target: '_blank', rel: 'noopener', text: 'Watch' }) : h('a', { class: 'btn small ' + cls, href: movieUrl(m), text: cls === 'tnmini' ? 'Watch' : 'Where to watch' });
  }
  // The shortlist bar above the cards, always shown: three slots that fill as titles are added with +. Before the first +
  // it says what the + does; the status sits under the label so the bar stays one row. A name on a card makes that card
  // glow; a name that isn't on screen (answers changed) brings it back as a card.
  function tnBar(t, onChange) {
    t.pins = t.pins.filter(function (id) { return S.byId[id]; });
    var pins = t.pins, n = pins.length;
    var status = !n ? h('span', { class: 'tnbar-n' }, [h('span', { class: 'tnlong' }, ['Tap ', h('b', { class: 'tnplus', text: '+' }), ' on a pick to add it here']), h('span', { class: 'tnshort' }, ['Tap ', h('b', { class: 'tnplus', text: '+' }), ' on a pick'])])
      : n >= 3 ? h('span', { class: 'tnbar-n full' }, ['3 of 3 · Pick one', h('span', { class: 'tnlong', text: ' for tonight' })])
      : h('span', { class: 'tnbar-n' }, [n + ' of 3', S.uid ? h('span', { class: 'tnlong', text: ' · also on your watchlist' }) : null]);
    var slots = [0, 1, 2].map(function (k) {
      var id = pins[k];
      if (!id) return h('div', { class: 'tneslot', 'aria-hidden': 'true' }, [h('span', { class: 'g', text: '+' }), h('span', { class: 'tnlong', text: k === n ? (n ? 'Add another' : 'Narrow it down to one') : '' })]);
      var m = S.byId[id], pa = artLazy(m, 'poster'), on = (t.slots || []).indexOf(id) !== -1;
      return h('div', { class: 'tnchipx' + (t.anim.chip === id ? ' new' : '') }, [
        h('span', { class: 'tnsw art', style: pa.style, 'data-bg': pa.bg, 'aria-hidden': 'true' }),
        h('button', { type: 'button', class: 'tnname', text: m.data.title, 'aria-label': on ? 'Point out ' + m.data.title + ' in your picks' : 'Show ' + m.data.title + ' as a card', on: { click: function () {
          if (on) { t.anim.flash = id; onChange(); return; }
          var i = t.slots.indexOf(null); if (i === -1) i = t.slots.findIndex(function (x) { return t.pins.indexOf(x) === -1; });
          if (i === -1) return;
          t.slots[i] = id; t.n[i]++; if (t.rating === i) t.rating = null; onChange();
        } } }),
        tnWatch(m, t, 'tnmini')
      ]);
    });
    var area = h('div', { class: 'tnbar-l' + (S.tnSlotsIn ? ' tnslotsin' : '') }, slots); S.tnSlotsIn = false;
    var bar = h('div', { class: 'tnbar', role: 'region', 'aria-label': 'Your shortlist' }, [
      h('div', { class: 'tnbar-h' }, [h('span', { class: 'tnbar-k', text: 'YOUR SHORTLIST' }), status]),
      area
    ]);
    if (tnPopWanted(t)) {
      if (S.tnPop && S.tnPop.t0) { area.classList.add('tnpopping'); area.appendChild(tnPopScene(t, Date.now() - S.tnPop.t0)); }
      else tnPopWhenSeen(t, area);
    }
    return bar;
  }
  // Small popcorn scene in the empty shortlist bar while the picks get ready: once per visit, the first time the bar is
  // on screen. The cards wait until it ends and the account data is in, then flip in. Not with reduce motion, or when
  // the shortlist already has titles.
  var TNPOP_MS = 3650, TNPOP_SVG = "<svg class=\"tpsv\" viewBox=\"0 0 300 60\" aria-hidden=\"true\"><rect x=\"0\" y=\"54\" width=\"300\" height=\"2\" rx=\"1\" fill=\"#3A3545\"></rect><rect x=\"150\" y=\"16\" width=\"70\" height=\"38\" rx=\"5\" fill=\"#1C1A23\" stroke=\"#4A4458\" stroke-width=\"1.2\"></rect><rect x=\"154\" y=\"20\" width=\"46\" height=\"30\" rx=\"3\" fill=\"#0F0D14\"></rect><rect class=\"tpglow\" x=\"154\" y=\"20\" width=\"46\" height=\"30\" rx=\"3\" fill=\"#F5A524\"></rect><rect x=\"205\" y=\"21\" width=\"11\" height=\"6\" rx=\"1.5\" fill=\"#0B0A0F\"></rect><rect class=\"tpled\" x=\"206.5\" y=\"22.5\" width=\"8\" height=\"3\" rx=\"1\" fill=\"#F5A524\"></rect><circle cx=\"210.5\" cy=\"34\" r=\"2.6\" fill=\"none\" stroke=\"#4A4458\" stroke-width=\"1.2\"></circle><circle cx=\"210.5\" cy=\"43\" r=\"2.6\" fill=\"none\" stroke=\"#4A4458\" stroke-width=\"1.2\"></circle><g class=\"tpbowl\"><ellipse cx=\"0\" cy=\"0\" rx=\"14\" ry=\"2\" fill=\"#8E2E22\"></ellipse><ellipse class=\"tpk k1\" style=\"--x:-7px\" cx=\"0\" cy=\"0\" rx=\"1.2\" ry=\"1.5\" fill=\"#F5C542\"></ellipse><ellipse class=\"tpk k2\" style=\"--x:-2px\" cx=\"0\" cy=\"0\" rx=\"1.2\" ry=\"1.5\" fill=\"#F5C542\"></ellipse><ellipse class=\"tpk k3\" style=\"--x:3px\" cx=\"0\" cy=\"0\" rx=\"1.2\" ry=\"1.5\" fill=\"#F5C542\"></ellipse><ellipse class=\"tpk k4\" style=\"--x:7px\" cx=\"0\" cy=\"0\" rx=\"1.2\" ry=\"1.5\" fill=\"#F5C542\"></ellipse><ellipse class=\"tpk k5\" style=\"--x:-4px\" cx=\"0\" cy=\"0\" rx=\"1.2\" ry=\"1.5\" fill=\"#F5C542\"></ellipse><ellipse class=\"tpk k6\" style=\"--x:5px\" cx=\"0\" cy=\"0\" rx=\"1.2\" ry=\"1.5\" fill=\"#F5C542\"></ellipse><g transform=\"translate(-8 -2)\"><g class=\"tpp p1\"><circle r=\"3\" fill=\"#FBF3DC\"></circle><circle cx=\"2.4\" cy=\"-1.6\" r=\"2.2\" fill=\"#FFF8E6\"></circle><circle cx=\"-2.2\" cy=\"-1.6\" r=\"2\" fill=\"#F4EAD0\"></circle></g></g><g transform=\"translate(8 -2)\"><g class=\"tpp p2\"><circle r=\"3\" fill=\"#FBF3DC\"></circle><circle cx=\"2.4\" cy=\"-1.6\" r=\"2.2\" fill=\"#FFF8E6\"></circle><circle cx=\"-2.2\" cy=\"-1.6\" r=\"2\" fill=\"#F4EAD0\"></circle></g></g><g transform=\"translate(0 -3)\"><g class=\"tpp p3\"><circle r=\"3\" fill=\"#FBF3DC\"></circle><circle cx=\"2.4\" cy=\"-1.6\" r=\"2.2\" fill=\"#FFF8E6\"></circle><circle cx=\"-2.2\" cy=\"-1.6\" r=\"2\" fill=\"#F4EAD0\"></circle></g></g><g transform=\"translate(-4 -8)\"><g class=\"tpp p4\"><circle r=\"3\" fill=\"#FBF3DC\"></circle><circle cx=\"2.4\" cy=\"-1.6\" r=\"2.2\" fill=\"#FFF8E6\"></circle><circle cx=\"-2.2\" cy=\"-1.6\" r=\"2\" fill=\"#F4EAD0\"></circle></g></g><g transform=\"translate(5 -8)\"><g class=\"tpp p5\"><circle r=\"3\" fill=\"#FBF3DC\"></circle><circle cx=\"2.4\" cy=\"-1.6\" r=\"2.2\" fill=\"#FFF8E6\"></circle><circle cx=\"-2.2\" cy=\"-1.6\" r=\"2\" fill=\"#F4EAD0\"></circle></g></g><g transform=\"translate(0 -12)\"><g class=\"tpp p6\"><circle r=\"3\" fill=\"#FBF3DC\"></circle><circle cx=\"2.4\" cy=\"-1.6\" r=\"2.2\" fill=\"#FFF8E6\"></circle><circle cx=\"-2.2\" cy=\"-1.6\" r=\"2\" fill=\"#F4EAD0\"></circle></g></g><path d=\"M-14 0 Q-13.5 12 0 12 Q13.5 12 14 0 Z\" fill=\"#C2412F\"></path><path d=\"M-13.4 3.4 Q0 6 13.4 3.4\" fill=\"none\" stroke=\"#F4F1EA\" stroke-width=\"1.8\"></path></g><g class=\"tpdoor\"><rect x=\"152\" y=\"18\" width=\"50\" height=\"34\" rx=\"3.5\" fill=\"rgba(60,54,74,.42)\" stroke=\"#5A5266\" stroke-width=\"1.2\"></rect><rect x=\"197\" y=\"27\" width=\"2.4\" height=\"16\" rx=\"1.2\" fill=\"#5A5266\"></rect></g><g transform=\"translate(258 36)\"><g class=\"tpjb j1\" style=\"--x:-11px\"><circle r=\"2.6\" fill=\"#FBF3DC\"></circle></g><g class=\"tpjb j2\" style=\"--x:10px\"><circle r=\"2.6\" fill=\"#FFF8E6\"></circle></g><g class=\"tpjb j3\" style=\"--x:-4px\"><circle r=\"2.2\" fill=\"#F4EAD0\"></circle></g><g class=\"tpjb j4\" style=\"--x:5px\"><circle r=\"2.2\" fill=\"#FBF3DC\"></circle></g></g><path class=\"tpsteam\" d=\"M254 28 q-2 -4 0 -8 q2 -4 0 -8\" fill=\"none\" stroke=\"#8E8899\" stroke-width=\"1.4\" stroke-linecap=\"round\"></path><path class=\"tpsteam s2\" d=\"M262 29 q-2 -4 0 -8 q2 -4 0 -8\" fill=\"none\" stroke=\"#8E8899\" stroke-width=\"1.4\" stroke-linecap=\"round\"></path><g class=\"tpbag\"><path d=\"M-10 -13 L-8 -11 L-6 -13 L-4 -11 L-2 -13 L0 -11 L2 -13 L4 -11 L6 -13 L8 -11 L10 -12.5 L10 17 Q10 18 9 18 L-9 18 Q-10 18 -10 17 Z\" fill=\"#F4F1EA\"></path><rect x=\"-7\" y=\"-10\" width=\"3\" height=\"28\" fill=\"#D64545\"></rect><rect x=\"-1.5\" y=\"-10\" width=\"3\" height=\"28\" fill=\"#D64545\"></rect><rect x=\"4\" y=\"-10\" width=\"3\" height=\"28\" fill=\"#D64545\"></rect><rect x=\"-7\" y=\"1\" width=\"14\" height=\"7\" rx=\"2\" fill=\"#0B0A0F\"></rect><g class=\"tpstrip\"><path d=\"M-10 -18 L10 -18 L10 -12.5 L8 -11 L6 -13 L4 -11 L2 -13 L0 -11 L-2 -13 L-4 -11 L-6 -13 L-8 -11 L-10 -13 Z\" fill=\"#F4F1EA\"></path><rect x=\"-7\" y=\"-18\" width=\"3\" height=\"5\" fill=\"#D64545\"></rect><rect x=\"-1.5\" y=\"-18\" width=\"3\" height=\"5\" fill=\"#D64545\"></rect><rect x=\"4\" y=\"-18\" width=\"3\" height=\"5\" fill=\"#D64545\"></rect></g></g></svg>";
  function tnPopWanted(t) {
    if (S.tnPop === 'done' || t.pins.length) return false;
    try { if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false; } catch (e) {}
    return typeof IntersectionObserver === 'function';
  }
  function tnPopWhenSeen(t, area) {
    var io = new IntersectionObserver(function (es) {
      if (!es.some(function (e) { return e.isIntersecting; })) return;
      io.disconnect();
      if (!area.isConnected || !tnPopWanted(t) || (S.tnPop && S.tnPop.t0)) return;
      S.tnPop = { t0: Date.now() };
      area.classList.add('tnpopping'); area.appendChild(tnPopScene(t, 0));
      clearTimeout(S.tnPopTimer); S.tnPopTimer = setTimeout(tnPopEnd, TNPOP_MS);
    }, { threshold: 0.6 });
    io.observe(area);
  }
  function tnPopEnd() {
    if (S.tnPop === 'done') return;
    clearTimeout(S.tnPopTimer); S.tnPop = 'done'; S.tnRevealFlip = true; S.tnSlotsIn = true;
    tnRedraw();
  }
  function tnPopScene(t, elapsed) {
    var mood = (TN_MOODS.filter(function (x) { return x[0] === t.mood; })[0] || [0, 'your mood'])[1];
    var langs = !t.langs.length ? 'any language' : t.langs.length > 2 ? t.langs.slice(0, 2).join(', ') + ' and more' : t.langs.join(' and ');
    var w = h('div', { class: 'tnpop', role: 'status', 'aria-label': 'Getting your 3 picks ready', style: '--o:' + (-Math.min(elapsed, TNPOP_MS) / 1000).toFixed(2) + 's' });
    var art = h('span', { class: 'tnpopart', 'aria-hidden': 'true' }); art.innerHTML = TNPOP_SVG;
    w.appendChild(art);
    w.appendChild(h('div', { class: 'tnpoptx' }, [
      h('div', { class: 'tnpopcap' }, [
        h('span', { class: 'c1', text: t.where === 'out' ? 'Checking what\u2019s in theatres\u2026' : 'Checking your apps\u2026' }),
        h('span', { class: 'c2', text: 'Matching ' + mood + ' in ' + langs + '\u2026' }),
        h('span', { class: 'c3', text: 'Sorting by what you love\u2026' }),
        h('span', { class: 'c4', text: 'Your 3 are ready' })]),
      h('div', { class: 'tnpopbar' }, [h('i')])]));
    w.appendChild(h('button', { type: 'button', class: 'tnpopskip', text: 'Skip', on: { click: tnPopEnd } }));
    return w;
  }
  // Picks wait until we know who you are and have your apps, watchlist, verdicts and "Not for me" list. Drawn
  // before that, the first 3 were swapped a moment later when that data arrived.
  function tnReady() { return !!S.tnForce || (!!S.authDone && (!S.uid || (S.mineLoaded && !!S.verdictsIn))); }
  function tnSkeleton() {
    return h('div', { class: 'tngrid', 'aria-busy': 'true', 'aria-label': 'Getting your 3 picks' }, [0, 1, 2].map(function () {
      return h('article', { class: 'tnpick tnskel', 'aria-hidden': 'true' }, [h('div', { class: 'tnart sk' }), h('div', { class: 'sk l1' }), h('div', { class: 'sk l2' }), h('div', { class: 'sk l3' }), h('div', { class: 'sk b1' }), h('div', { class: 'sk b2' })]);
    }));
  }
  function tnPicks(t, onChange, wide) {
    if (!tnReady() || tnPopWanted(t)) return { list: tnSkeleton(), bar: tnBar(t, onChange), empty: null, thin: null, again: h('button', { type: 'button', class: 'btn', disabled: true, text: 'Show 3 more' }) };
    if (!t.slots) tnFill(t, true);
    // Right after the popcorn: the 3 cards flip in, one after another.
    if (S.tnRevealFlip) { S.tnRevealFlip = false; t.drawn = t.n.map(function (x) { return x - 1; }); }
    var pool = tnPool(t), byId = {}; pool.forEach(function (o) { byId[o.m.id] = o; });
    // A shortlisted title brought back from the bar may not fit tonight's answers: it still gets its card.
    t.pins.forEach(function (id) { var m = S.byId[id]; if (m && !byId[id] && t.slots.indexOf(id) !== -1) byId[id] = { m: m, taste: 0, pct: null, age: 9999, rt: runtimeMin(m.data), cert: '', pinned: true }; });
    // A card whose title no longer fits (rated or listed elsewhere) gets the next pick, without a flip.
    var used = t.slots.filter(function (id) { return id && byId[id]; });
    t.slots = t.slots.map(function (id, i) {
      if (!id || byId[id]) return id;
      var next = tnNext(t).filter(function (x) { return used.indexOf(x) === -1; })[0] || null; if (next) used.push(next); t.drawn[i] = t.n[i]; return next;
    });
    var any = t.slots.some(Boolean);
    var kids = t.slots.map(function (id, i) {
      var flip = t.n[i] !== t.drawn[i] ? ' tnin' + (t.n[i] % 2) : '';
      if (!id) return h('article', { class: 'tnpick tnnone' + flip }, [h('div', { class: 'tnempty', text: 'That’s every pick for these answers. Try another mood or more languages.' })]);
      var o = byId[id], m = o.m, d = m.data, useBanner = wide && !!safeUrl(d.bannerUrl), pa = artLazy(m, useBanner ? 'banner' : 'poster', useBanner ? 640 : undefined);
      var pinned = t.pins.indexOf(id) !== -1, title = d.title;
      // With languages picked, show the language(s) you picked that this title is in, not its original language.
      var tl = t.langs.length ? langsOf(d).filter(function (l) { return t.langs.indexOf(l) !== -1; }) : [];
      var meta = [tl.length ? tl.join(' / ') : langsOf(d)[0], String(d.genre || '').split(/,/).slice(0, 2).join(','), isTv(m) ? (o.rt ? 'Series · ' + o.rt + 'm episodes' : 'Series') : o.rt ? Math.floor(o.rt / 60) + 'h ' + (o.rt % 60) + 'm' : '', t.where === 'home' && !safeUrl(d.platformUrl) ? (appsOf(d)[0] || d.platform) : ''].filter(Boolean).join(' · ');
      var art = h('a', { class: 'tnart art' + (wide && !useBanner ? ' tnposter' : ''), href: movieUrl(m), style: pa.style, 'data-bg': pa.bg, 'aria-label': title });
      var add = h('button', { type: 'button', class: 'addl tnadd' + (t.anim.pin === id ? ' tnpopin' : ''), 'aria-pressed': String(pinned), title: pinned ? 'On your shortlist' : 'Add to your shortlist',
        'aria-label': pinned ? 'Remove ' + title + ' from your shortlist' : 'Add ' + title + ' to your shortlist', text: pinned ? '✓' : '+', on: { click: function () { tnPin(t, m, onChange); } } });
      var body;
      if (t.rating === i) {
        var VT = VTIP[bigScreen(m) ? 'theatre' : 'ott'];
        body = h('div', { class: 'tnrate' + (t.anim.rate === id ? ' new' : '') }, [
          h('div', { class: 'tnrate-k', text: 'You’ve seen it. How was it?' }),
          h('div', { class: 'qv icons' + (bigScreen(m) ? ' th' : ''), role: 'group', 'aria-label': 'Your verdict on ' + title }, vset(m).map(function (x) {
            return h('button', { type: 'button', class: 'qb ' + x[0], 'data-v': x[0], 'aria-pressed': 'false', 'aria-label': VT[x[0]], on: { click: function () {
              if (!needUser()) return;
              // Swap first: saving the verdict can redraw the page, and that draw should already show the new pick.
              var next = tnSwap(t, i);
              setVerdict(id, x[0]);
              toast('Saved “' + VT[x[0]] + '” for ' + title + (next ? '. Here’s a new pick.' : '. That was the last pick for these answers.'));
              if (t.drawn[i] !== t.n[i]) onChange();
            } } }, [icon(vIconName(m, x[0]), 18), h('span', { class: 'qtip', 'aria-hidden': 'true', text: VT[x[0]] })]);
          })),
          h('div', { class: 'tnrate-f' }, [
            h('button', { type: 'button', class: 'linkbtn', text: 'Don’t rate', on: { click: function () {
              t.gone.push(id); t.pins = t.pins.filter(function (x) { return x !== id; }); markSeen(id, true);
              var next = tnSwap(t, i); toast(title + ' marked as seen' + (next ? '. Here’s a new pick.' : '.')); onChange();
            } } }),
            h('button', { type: 'button', class: 'linkbtn', text: 'Haven’t seen it', on: { click: function () { t.rating = null; onChange(); } } })])
        ]);
      } else {
        body = h('div', { class: 'tnbody2' }, [
          h('div', { class: 'tnwhy', text: o.pinned ? 'From your shortlist' : tnReason(o, t) }),
          tnCta(m, t),
          h('div', { class: 'tnacts' }, [
            h('button', { type: 'button', class: 'tnact', on: { click: function () { t.rating = i; t.anim.rate = id; onChange(); } } }, [icon('eye', 17), h('span', { text: 'Seen it' })]),
            h('button', { type: 'button', class: 'tnact dim tnmoon', on: { click: function () {
              tnSkipToday(id); t.gone.push(id); t.pins = t.pins.filter(function (x) { return x !== id; });
              var next = tnSwap(t, i); toast('Okay, not tonight.' + (next ? ' Here’s a new pick.' : '')); onChange();
            } } }, [icon('moon', 17), h('span', { text: 'Not tonight' })])])
        ]);
      }
      return h('article', { class: 'tnpick' + (pinned ? ' on' : '') + flip + (t.anim.flash === id ? ' glow' : ''), 'data-id': id }, [
        h('div', { class: 'tnmediaw' }, [tnMedia(m, art), add]),
        h('div', { class: 'tnbody' }, [h('a', { class: 'tnt', href: movieUrl(m), text: title }), h('div', { class: 'tnm', text: meta }), body])
      ]);
    });
    t.drawn = t.n.slice(); var bar = tnBar(t, onChange); t.anim = {};
    var unpinned = t.slots.map(function (id, i) { return i; }).filter(function (i) { return !t.slots[i] || t.pins.indexOf(t.slots[i]) === -1; });
    var more = function () {
      var open = unpinned.filter(function (i) { return t.slots[i]; });
      open.forEach(function (i) { t.seen.push(t.slots[i]); });
      var q = tnNext(t), n = 0;
      unpinned.forEach(function (i) { var next = q.shift() || null; if (next || t.slots[i]) { if (next) n++; t.slots[i] = next; t.n[i]++; } });
      if (t.rating !== null && unpinned.indexOf(t.rating) !== -1) t.rating = null;
      toast(n ? n + (n === 1 ? ' new pick' : ' new picks') + (t.pins.length ? '. Your shortlist stayed put.' : '.') : 'No more picks for these answers.');
      onChange();
    };
    var canMore = unpinned.length && tnNext(t).length;
    var empty = !any && !t.pins.length ? h('div', { class: 'tnempty' }, [
      t.seen.length ? 'That’s everything for these answers. Try another mood or more languages, or ' : 'Nothing matches these answers right now. Try another mood, more languages' + (tnKind(t) === 'tv' ? '' : ' or Any length') + (tnKind(t) !== 'any' ? ', or Any under Movies or TV shows' : '') + (t.where === 'home' && t.era !== 'any' ? ', or Any under How new' : '') + (myApps().length && t.where === 'home' ? ', or check your apps' : '') + '.',
      t.seen.length ? h('button', { type: 'button', class: 'linkbtn', text: 'see the first picks again', on: { click: function () { t.seen = []; tnFill(t, false); onChange(); } } }) : null,
      t.seen.length ? '.' : null]) : null;
    return { list: h('div', { class: 'tngrid' }, kids), bar: bar, empty: empty, thin: null,
      again: any ? h('button', { type: 'button', class: 'btn', disabled: !canMore, text: 'Show 3 more', on: { click: more } }) : null };
  }
  function tnAppsLine() {
    var a = myApps();
    return h('div', { class: 'tnapps' }, [h('span', { text: a.length ? 'Your apps: ' + a.join(' · ') : 'Showing every streaming app.' }), ' ',
      h('button', { type: 'button', class: 'linkbtn', text: a.length ? 'Edit' : 'Pick your apps', on: { click: function () { appsPicker(); } } })]);
  }
  function appsPicker() {
    var picked = myApps();
    modal('My apps', function (close) {
      var grid = h('div', { class: 'citygrid tnappgrid' }, TN_APPS.map(function (a) {
        return h('button', { type: 'button', class: 'chip tnchip', 'aria-pressed': String(picked.indexOf(a[0]) !== -1), text: a[0], on: { click: function (e) {
          var i = picked.indexOf(a[0]); if (i === -1) picked.push(a[0]); else picked.splice(i, 1); e.currentTarget.setAttribute('aria-pressed', String(i === -1)); } } });
      }));
      return [h('h2', { text: 'My apps' }), h('p', { class: 'note', text: 'Tick the apps you pay for. Tonight will only suggest what you can press play on. Leave all unticked to see every app.' }), grid,
        h('div', { style: 'display:flex;gap:8px;margin-top:16px' }, [
          h('button', { type: 'button', class: 'btn primary', text: 'Save', on: { click: function () { setApps(picked); close(); tnRedraw(); } } }),
          h('button', { type: 'button', class: 'btn ghost', text: 'Cancel', on: { click: close } })])];
    });
  }
  function tnRedraw() { tnStopPlaying = null; var el = $('tonight'); if (el && S.route === 'home') el.replaceWith(tonightSection()); else if (S.route === 'tonight') drawTonight(); }
  // Home: on wide screens the questions and live picks sit side by side; on phones a card opens /tonight.
  function tonightSection() {
    var t = tnState(), redraw = function () { tnRedraw(); }, p = tnPicks(t, redraw, true);
    var sec = h('section', { class: 'sect tonight', id: 'tonight', 'aria-label': 'Tonight' }, [
      h('div', { class: 'tnwide' }, [
        h('div', { class: 'tnleft' }, [h('div', { class: 'tnkick', text: 'TONIGHT' }), h('h2', { class: 'tnh', text: 'What should I watch?' })].concat(tnQuestions(t, redraw))),
        h('div', { class: 'tnright' }, [
          h('div', { class: 'tnhead' }, [h('h3', {}, ['Your 3 for tonight ', h('span', { class: 'sub', text: '· ' + tnSummary(t) })]), p.again]),
          p.bar, p.empty || p.list, tnAppsLine()])
      ]),
      h('div', { class: 'tnnarrow' }, [
        h('div', { class: 'tnkick', text: 'TONIGHT' }), h('h2', { class: 'tnh', text: 'What should I watch?' }),
        h('p', { class: 'note', text: 'Three picks for your apps, your time and your mood.' }),
        h('a', { class: 'btn primary tngo', href: '/tonight', text: 'Pick for me' }), tnAppsLine()])
    ]);
    return sec;
  }
  // /tonight (mainly phones): questions first, then three picks.
  function drawTonight() {
    var v = $('view-tonight'); v.innerHTML = ''; var t = tnState();
    var w = h('div', { class: 'wrapx tnpage' }); v.appendChild(w);
    w.appendChild(h('h1', { class: 'display', style: 'font-size:40px;margin:6px 0 14px', text: 'Tonight' }));
    if (t.step !== 'picks') {
      tnQuestions(t, drawTonight).forEach(function (q) { w.appendChild(q); });
      w.appendChild(tnAppsLine());
      w.appendChild(h('button', { type: 'button', class: 'btn primary tngo', text: 'Show my 3 picks', on: { click: function () { t.step = 'picks'; t.seen = []; tnFill(t, !t.slots); drawTonight(); window.scrollTo(0, 0); } } }));
      return;
    }
    var p = tnPicks(t, drawTonight, true);
    w.appendChild(h('div', { class: 'note', style: 'margin-bottom:12px', text: tnSummary(t) }));
    if (p.bar) w.appendChild(p.bar);
    w.appendChild(p.empty || p.list);
    w.appendChild(h('div', { class: 'tnfoot' }, [p.again, h('button', { type: 'button', class: 'btn ghost', text: 'Change answers', on: { click: function () { t.step = 'ask'; drawTonight(); } } })]));
  }
  function rowSection(title, items, opts, link) {
    if (!items.length) return null;
    if (opts && opts.max && items.length > opts.max) items = items.slice(0, opts.max);
    return h('section', { class: 'sect', 'aria-label': title }, [
      h('div', { class: 'sect-h' }, [h('h2', { text: title }), link || null]),
      h('div', { class: 'rowx' }, items.map(function (m) { return posterCard(m, opts); }))
    ]);
  }
  function sectionOf(name) { return S.movies.filter(function (m) { return m.data.section === name; }); }
  function homeSection(name) { return sectionOf(name); }
  // Titles the admin pins to the front of a homescreen row (Admin > Home rows); the rest keep their usual order after them.
  // Keys: theatres, coming, ott (by section name too), trailers, songs, tvpromos.
  var ROW_KEYS = ['theatres', 'coming', 'ott', 'trailers', 'songs', 'tvpromos'], ROW_KEY = { 'In theatres': 'theatres', 'Coming soon': 'coming', 'On OTT': 'ott' };
  function rowPins(sec) {
    var r = S.rowPins || window.RS_ROWS || {}, k = ROW_KEY[sec] || sec;
    return ROW_KEYS.indexOf(k) !== -1 && Array.isArray(r[k]) ? r[k] : [];
  }
  // Same for the video rows: cards of pinned titles first (in pin order), the rest keep their order.
  function pinPicks(picks, ids) {
    if (!ids || !ids.length) return picks;
    var pos = Object.create(null); ids.forEach(function (id, i) { if (!(id in pos)) pos[id] = i; });
    var a = [], b = []; picks.forEach(function (p) { (p.m.id in pos ? a : b).push(p); });
    return a.sort(function (x, y) { return pos[x.m.id] - pos[y.m.id]; }).concat(b);
  }
  // Coming soon rows show titles with a release date; ones still TBA stay on Browse > Coming soon (last), unless pinned in Admin.
  // A Coming soon title with no full release date (TBA) and not pinned in Admin > Home rows: left out of Coming soon lists.
  function soonTba(m) { return m.data.section === 'Coming soon' && !/^\d{4}-\d{2}-\d{2}$/.test(m.data.releaseDate || '') && rowPins('Coming soon').indexOf(m.id) === -1; }
  function withDate(list, sec) { var pins = rowPins(sec); return list.filter(function (m) { return /^\d{4}-\d{2}-\d{2}$/.test(m.data.releaseDate || '') || pins.indexOf(m.id) !== -1; }); }
  function pinFirst(list, ids) {
    if (!ids || !ids.length) return list;
    var pos = Object.create(null); ids.forEach(function (id, i) { if (!(id in pos)) pos[id] = i; });
    return list.filter(function (m) { return m.id in pos; }).sort(function (a, b) { return pos[a.id] - pos[b.id]; })
      .concat(list.filter(function (m) { return !(m.id in pos); }));
  }
  function firstVideo(m) { return (m.data.videos || []).filter(function (v) { return safeUrl(v.url); })[0]; }
  function trailerBtn(m, cls) {
    var v = firstVideo(m);
    return h('button', { type: 'button', class: 'btn lg glass', disabled: true, title: 'Add a YouTube link in Admin' }, ['▶  Trailer coming soon']);
  }
  function listBtn(m) {
    var on = inList(m.id);
    return h('button', { type: 'button', class: 'btn lg glass listbtn', 'aria-pressed': String(on), on: { click: function () { toggleList(m.id); } } }, [on ? '✓  In my watchlist' : '+  Watchlist']);
  }

  // ---------- home ----------
  // A stand-in that becomes the real section when it nears the screen. Sections already shown in this visit are built at
  // once on a redraw, so the page never collapses under the visitor.
  var homeShown = {}, homeIO = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      if (!e.isIntersecting) return; var ph = e.target; homeIO.unobserve(ph);
      if (!ph.parentNode) return; homeShown[ph._key] = 1;
      var n = ph._make(); if (n) ph.parentNode.replaceChild(n, ph); else ph.parentNode.removeChild(ph);
    });
  }, { rootMargin: '600px 0px' }) : null;
  function lazySection(make, key) {
    if (!homeIO || homeShown[key] || S.restoreHome) return make();
    var ph = h('div', { class: 'lazysec', 'aria-hidden': 'true', style: 'min-height:380px' }); ph._make = make; ph._key = key;
    homeIO.observe(ph); return ph;
  }
  function drawHome() {
    var v = $('view-home');
    if (!S.loaded && v.querySelector('[data-prerendered]')) return;
    v.innerHTML = '';
    if (!S.loaded) { v.appendChild(h('div', { class: 'wrapx' }, [h('div', { class: 'empty', text: S.loadMsg || 'Loading titles…' })])); return; }
    if (!S.movies.length) { v.appendChild(h('div', { class: 'wrapx' }, [h('div', { class: 'empty', text: 'No titles yet. Add some in Admin.' })])); return; }
    var feat = S.featured.map(function (id) { return S.byId[id]; }).filter(Boolean);
    if (!feat.length) {
      feat = S.movies.filter(function (m) { return safeUrl(m.data.bannerUrl); });
      homeSection('In theatres').forEach(function (m) { if (feat.length < 4 && feat.indexOf(m) === -1) feat.push(m); });
      if (!feat.length) feat = S.movies.slice(0, 3);
    }
    setHeroCtx('home', feat, 'heroBox');
    if (S.slide >= feat.length) S.slide = 0;
    var heroBox = h('div', { id: 'heroBox' });
    v.appendChild(heroBox);
    drawHero();
    // Only the home seed is in (the featured titles): the hero now, the rows once the catalogue arrives.
    if (S.seedOnly) { v.appendChild(h('div', { class: 'wrapx' }, [h('div', { class: 'empty', text: 'Loading titles…' })])); return; }

    var friendPicks = S.movies.filter(function (x) { return S.mine.following.length && score(x.id, S.mine.following).tot > 0; });
    var mine = myListRow();
    // Rows below the first screen are built as they come near it (lazySection): the home page holds thousands of
    // elements, and building them all at once kept phones busy just after the hero appeared.
    [
      tonightSection(),
      lazySection(function () { return mine.length ? rowSection('My List', mine, { max: HOME_MAX }, h('span', { class: 'sub' }, [h('a', { href: '/my-list', text: 'See all' })])) : null; }, 0),
      lazySection(function () { return trailerSection(); }, 2),
      lazySection(function () { return rowSection('In theatres', pinFirst(homeSection('In theatres').slice().sort(function (a, b) {
        var ra = released(a), rb = released(b);
        if (ra !== rb) return ra ? -1 : 1;
        return ra ? (b.data.releaseDate || '').localeCompare(a.data.releaseDate || '') : (a.data.releaseDate || '').localeCompare(b.data.releaseDate || '');
      }), rowPins('In theatres')), { book: true, max: 24, inTheatresList: true }, h('span', { class: 'sub' }, ['Now showing, plus this week’s releases · ', h('a', { href: '/browse/movies-in-theatres', text: 'All films in theatres' })])); }, 3),
      lazySection(function () { return becauseListSection(); }, 1),
      lazySection(function () { return songSection(); }, 7),
      lazySection(function () { return rateSection(); }, 4),
      lazySection(function () { return friendPicks.length ? rowSection('Rated by people you follow', friendPicks) : null; }, 5),
      lazySection(function () { return rowSection('Coming soon', pinFirst(withDate(homeSection('Coming soon'), 'Coming soon').sort(function (a, b) { return (a.data.releaseDate || '9999').localeCompare(b.data.releaseDate || '9999'); }), rowPins('Coming soon')), { dateBadge: true, upIcons: true, max: 24 }, seeAll('/browse/movies-coming-soon')); }, 6),
      lazySection(function () { return recentOttSection(); }, 15),
      lazySection(function () { return genreSection(); }, 8),
      lazySection(function () { return rowSection('Streaming this year', streamingYearList(), { max: HOME_MAX, ottNew: true, ottMeta: streamingYearMeta }, allStreamingLink()); }, 9),
      lazySection(function () { return rowSection('TV shows', homeSection('TV shows'), { max: HOME_MAX }, seeAll('/browse/tv-shows')); }, 10),
      lazySection(function () { return tvPromoSection(); }, 11),
      lazySection(function () { return yearSection(); }, 12),
      lazySection(function () { return rowSection('Catch up on 2025–26 releases', homeSection('Older releases').filter(function (m) { return (m.data.releaseDate || '') >= '2025' && nowPlayingOf(m.data) !== 'out'; }).sort(function (a, b) { return (b.data.releaseDate || '').localeCompare(a.data.releaseDate || ''); }).slice(0, 30), null, h('span', { class: 'sub' }, [h('a', { href: '/browse/movies', text: 'Browse all' })])); }, 13),
      lazySection(function () { return langSection(); }, 14)
    ].forEach(function (s) { if (s) v.appendChild(s); });
    v.appendChild(footer());
  }
  // ---------- genre landing pages: /genre/<slug> ----------
  function genreSlug(g) { return String(g || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
  function genreBySlug(sl) { sl = String(sl || '').toLowerCase(); for (var i = 0; i < GENRES.length; i++) if (genreSlug(GENRES[i]) === sl) return GENRES[i]; return ''; }
  function genreUrl(g) { return '/genre/' + genreSlug(g); }
  // Same as the pre-rendered genre pages (scripts/build.mjs GENRE_PAGES).
  function genreTitle(g) { return 'Indian ' + g + ' Movies & Series | Reelscore'; }
  function genreHref(G, page) {
    var q = []; if (G.lang) q.push('lang=' + encodeURIComponent(G.lang)); if (page > 1) q.push('page=' + page);
    return '/genre/' + G.genre + (q.length ? '?' + q.join('&') : '');
  }
  function drawGenre() {
    var v = $('view-genre');
    if (!S.loaded && v.querySelector('[data-prerendered]')) return;
    v.innerHTML = '';
    var G = S.gen, g = genreBySlug(G.genre), c = GENRE_COL[g] || ['#2B2F3D', '#4A5068'];
    var all = S.movies.filter(function (m) { return genreTags(m.data).indexOf(g) !== -1; });
    v.appendChild(h('section', { class: 'ghero', style: '--g1:' + c[0] + ';--g2:' + c[1] }, [
      h('nav', { class: 'gcrumbs', 'aria-label': 'Breadcrumb' }, [h('a', { href: '/', text: 'Home' }), ' › ', h('a', { href: '/browse', text: 'Browse' }), ' › ', g]),
      h('h1', { class: 'display', text: g }),
      h('p', { text: S.loaded ? all.length.toLocaleString('en-IN') + ' ' + g.toLowerCase() + ' movies and series on Reelscore, with verdicts on whether each is worth the theatre, OTT or a skip.' : 'Loading…' })
    ]));
    v.appendChild(h('nav', { class: 'gnav', 'aria-label': 'Other genres' }, GENRES.map(function (x) {
      return h('a', { class: 'chip', href: genreUrl(x), 'aria-current': x === g ? 'page' : null, 'aria-pressed': String(x === g), text: x });
    })));
    if (!S.loaded) return;
    var lc = g.toLowerCase();
    var w = h('section', { class: 'wrapx', style: 'padding-top:18px', 'aria-label': g + ' titles' }); v.appendChild(w);
    var langs = {}; all.forEach(function (m) { var l = langOf(m.data); if (l) langs[l] = 1; });
    function sel(id, label, val, opts, onc) {
      var e = h('select', { class: 'in', id: id }, opts.map(function (o) { return h('option', { value: o[0], text: o[1], selected: o[0] === val }); }));
      e.addEventListener('change', function () { onc(e.value); G.page = 1; e.blur(); render(true); });
      return h('div', { class: 'field', style: 'min-width:160px;flex:0 1 220px' }, [h('label', { class: 'l', for: id, text: label }), e]);
    }
    w.appendChild(h('div', { style: 'display:flex;flex-wrap:wrap;gap:12px;margin-bottom:18px' }, [
      sel('gLang', 'Language', G.lang, [['', 'All languages']].concat(Object.keys(langs).sort().map(function (l) { return [l, l]; })), function (x) { G.lang = x; })
    ]));
    var list = all.filter(function (m) { return !G.lang || langOf(m.data) === G.lang; });
    list.sort(function (a, b) { return (b.data.releaseDate || '').localeCompare(a.data.releaseDate || '') || (a.data.title || '').localeCompare(b.data.title || ''); });
    if (!list.length) { w.appendChild(h('div', { class: 'empty', text: 'No ' + lc + ' titles here yet.' })); v.appendChild(footer()); return; }
    var PER = gridPer(w), pages = Math.ceil(list.length / PER); G.page = Math.min(Math.max(1, G.page || 1), pages);
    syncListUrl(genreHref(G, G.page));
    var from = (G.page - 1) * PER;
    w.appendChild(h('div', { class: 'sub', style: 'margin-bottom:14px', text: list.length > PER ? 'Showing ' + (from + 1) + '–' + Math.min(from + PER, list.length) + ' of ' + list.length.toLocaleString('en-IN') + ' titles' : list.length + (list.length === 1 ? ' title' : ' titles') }));
    w.appendChild(h('div', { class: 'grid-posters' }, list.slice(from, from + PER).map(function (m) { return posterCard(m, m.data.section === 'Coming soon' ? { dateBadge: true, upIcons: true } : null); })));
    if (pages > 1) w.appendChild(pagerNav(G.page, pages, function (n) { return genreHref(G, n); }));
    v.appendChild(footer());
  }

  // Full-screen trailer player over the current page; Esc, the close button or a click outside the video closes it.
  // queue: { list: [{m, x}], i } — the row the video was opened from, so the next one can follow.
  function openTrailerOverlay(m, x, opener, queue, keepMini, startAt) {
    // A video you open yourself starts full size, unless the mini player is already showing: then it plays there.
    if (!keepMini && !(S.tov && S.tovMini)) S.tovMini = false;
    var st = startAt > 1 ? Math.floor(startAt) : 0;
    closeTrailerOverlay();
    var d = m.data, media;
    if (x.yt) media = h('iframe', { src: 'https://www.youtube-nocookie.com/embed/' + x.yt + '?autoplay=1&rel=0&playsinline=1&modestbranding=1&enablejsapi=1' + (st ? '&start=' + st : '') + '&origin=' + encodeURIComponent(location.origin), title: d.title + ' · ' + x.title,
      allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin' });
    else { media = h('video', { src: x.clip, controls: true, autoplay: true, playsinline: true }); media.setAttribute('aria-label', d.title + ' · ' + x.title); if (st) media.addEventListener('loadedmetadata', function () { try { media.currentTime = st; } catch (e) {} }, { once: true }); setTimeout(function () { safePlay(media); }, 0); }
    var close = h('button', { type: 'button', class: 'tov-x', 'aria-label': 'Close video', text: '×', on: { click: function () { S.tovMini = false; closeTrailerOverlay(); } } });
    // Go to the title's page from the player: close it, remember the home row it was opened from, then navigate.
    var toPage = function (e) {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault(); e.stopPropagation();
      var href = movieUrl(m);
      if (S.route === 'home' && opener && opener.closest) {
        var sec = opener.closest('.view section[aria-label]'), row = sec && sec.querySelector('.rowx');
        S.homeSpot = sec ? { label: sec.getAttribute('aria-label'), left: row ? row.scrollLeft : 0 } : null;
      }
      // The video keeps playing while you go to the page: the full player shrinks to the mini player (desktop).
      // Phones have no mini player, so there the player closes.
      if (!S.tovMini) { if (S.tov && tovMiniOk()) setTovMini(true, true); else { S.tov && (S.tov.opener = null); closeTrailerOverlay(); } }
      if (S.route === 'title' && location.pathname === href) return;
      go(href);
    };
    var more = h('a', { class: 'btn small tov-go', href: movieUrl(m), text: isTv(m) ? 'Go to show page' : 'Go to movie page', on: { click: toPage } });
    var vu = videoUrl(m, x.yt), vp = vu && videoPaths(m.data).filter(function (p) { return p.yt === x.yt; })[0];
    var shareB = vu ? h('button', { type: 'button', class: 'btn small tov-go', text: 'Share', on: { click: function () { shareVideo(m, vp, vu); } } }) : null;
    // Autoplay: the next video in the row plays when this one ends. On by default; the choice is remembered.
    var hasNext = !!(queue && queue.list && queue.list[queue.i + 1]);
    var auto = hasNext ? h('button', { type: 'button', class: 'tov-auto', role: 'switch', 'aria-checked': String(tovAutoplay()), title: 'Play the next video in the row when this one ends',
      on: { click: function () { var on = !tovAutoplay(); try { localStorage.setItem('rs_autoplay', on ? '1' : '0'); } catch (e) {} auto.setAttribute('aria-checked', String(on)); if (S.tov && S.tov.autoChanged) S.tov.autoChanged(on); } } },
      [h('span', { class: 'tov-sw', 'aria-hidden': 'true' }), h('span', { text: 'Autoplay' })]) : null;
    // Mini player (desktop): the video shrinks to a corner and keeps playing while you browse. The player itself is never
    // moved in the page, so it doesn't restart.
    var miniB = tovMiniOk() ? h('button', { type: 'button', class: 'tov-mn', on: { click: function () { setTovMini(!S.tovMini); } } }, [icon('pip', 18), h('span', { class: 'tov-mnl' })]) : null;
    // Previous / next in the row the video was opened from (Songs, Trailers, the home rows). Shift+P and Shift+N too.
    var what = x.cat === 'songs' ? 'song' : x.cat === 'trailers' ? 'trailer' : 'video';
    var qPrev = queue && queue.list && queue.i > 0 ? queue.list[queue.i - 1] : null, qNext = queue && queue.list ? queue.list[queue.i + 1] : null;
    var step = function (d2) { var q = d2 < 0 ? qPrev : qNext; if (q && q.m && q.x) openTrailerOverlay(q.m, q.x, opener, { list: queue.list, i: queue.i + d2 }, true); };
    var navB = function (d2) {
      var q = d2 < 0 ? qPrev : qNext, lab = (d2 < 0 ? 'Previous ' : 'Next ') + what;
      return h('button', { type: 'button', class: 'tov-nav', disabled: !q, 'aria-label': q ? lab + ': ' + q.m.data.title + (q.x.title ? ' · ' + q.x.title : '') : lab, title: q ? lab + ' (Shift+' + (d2 < 0 ? 'P' : 'N') + ')' : 'No ' + lab.toLowerCase(), on: { click: function () { step(d2); } } },
        d2 < 0 ? [h('span', { 'aria-hidden': 'true', text: '‹' }), h('span', { class: 'tov-nl', text: lab })] : [h('span', { class: 'tov-nl', text: lab }), h('span', { 'aria-hidden': 'true', text: '›' })]);
    };
    var navs = qPrev || qNext ? h('div', { class: 'tov-navs', role: 'group', 'aria-label': 'Previous and next ' + what }, [navB(-1), navB(1)]) : null;
    // Repeat (songs): play the same song again when it ends, instead of moving on. Remembered like Autoplay.
    var isSong = x.cat === 'songs';
    if (isSong && media.tagName === 'VIDEO') media.loop = tovRepeat();
    var repB = isSong ? h('button', { type: 'button', class: 'tov-auto tov-rep', role: 'switch', 'aria-checked': String(tovRepeat()), title: 'Play this song again when it ends',
      on: { click: function () { var on = !tovRepeat(); try { localStorage.setItem('rs_repeat', on ? '1' : '0'); } catch (e) {} repB.setAttribute('aria-checked', String(on)); if (media.tagName === 'VIDEO') media.loop = on; if (on && S.tov && S.tov.hideNext) S.tov.hideNext(); } } },
      [h('span', { class: 'tov-sw', 'aria-hidden': 'true' }), h('span', { text: 'Repeat' })]) : null;
    var box = h('div', { class: 'tov', role: 'dialog', 'aria-modal': 'true', 'aria-label': d.title + ' · ' + x.title }, [
      h('div', { class: 'tov-bar' }, [
        tovMiniOk() ? h('button', { type: 'button', class: 'tov-grip', 'aria-label': 'Move the mini player: drag, or use the arrow keys', title: 'Drag to move', text: '⠿' }) : null,
        h('div', { class: 'tov-t' }, [h('a', { class: 'tov-tl', href: movieUrl(m), text: d.title, on: { click: toPage } }), h('span', { class: 'note', text: ' · ' + x.title })]),
        h('div', { class: 'tov-acts' }, [navs, repB, auto, shareB, more, miniB, close])
      ]),
      h('div', { class: 'tov-v' }, [media])
    ]);
    box.addEventListener('click', function (e) { if (e.target === box && !S.tovMini) closeTrailerOverlay(); });
    // Keys while a video is open (not while typing in a box): Esc closes the big player; Shift+N / Shift+P next / previous;
    // I mini player on / off (wide screens); F full screen on / off. While the YouTube player itself has focus, YouTube's own keys apply.
    S.tov = { node: box, opener: opener, miniB: miniB, key: function (e) {
      var ae = document.activeElement || {}, typing = /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName || '') || ae.isContentEditable, plain = !e.metaKey && !e.ctrlKey && !e.altKey;
      if (e.key === 'Escape') { if (!S.tovMini && !fsEl()) closeTrailerOverlay(); }
      else if (typing || !plain) return;
      else if (e.shiftKey && (e.key === 'N' || e.key === 'P')) { e.preventDefault(); step(e.key === 'N' ? 1 : -1); }
      else if (!e.shiftKey && (e.key === 'i' || e.key === 'I') && tovMiniOk() && !fsEl()) { e.preventDefault(); setTovMini(!S.tovMini); }
      else if (!e.shiftKey && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); toggleFs(media); }
    } };
    document.addEventListener('keydown', S.tov.key);
    if (isSong) { S.tov.repeatOn = tovRepeat; if (media.tagName !== 'VIDEO') repeatYt(S.tov, media); }
    upNext(box, media, opener, queue);
    document.body.appendChild(box);
    if (!tovMiniOk()) S.tovMini = false;
    setTovMini(!!S.tovMini, true);
    if (!S.tovMini) close.focus();
  }
  // Mini player helpers. miniOn: a video is playing in the corner. toMini: play this video of the title there, with the
  // title's other videos as previous / next. ytClock: follow an inline YouTube player's position, so moving it to the
  // mini player carries on from the same moment.
  function fsEl() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
  function toggleFs(el) {
    try {
      if (fsEl()) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
      var go = el.requestFullscreen || el.webkitRequestFullscreen; if (go) { var p = go.call(el); if (p && p.catch) p.catch(function () {}); }
    } catch (e) {}
  }
  function miniOn() { return !!(S.tov && S.tovMini); }
  function titleQueue(m, x) {
    var list = vidItems(m).filter(function (y) { return y.yt || y.clip; }).map(function (y) { return { m: m, x: y }; });
    var i = -1; list.some(function (q, k) { if (q.x === x || (x.yt && q.x.yt === x.yt) || (x.clip && q.x.clip === x.clip)) { i = k; return true; } return false; });
    return i === -1 ? null : { list: list, i: i };
  }
  function toMini(m, x, startAt) { if (!x) return; S.tovMini = true; openTrailerOverlay(m, x, null, titleQueue(m, x), true, startAt); }
  function ytClock(frame) {
    var YT = 'https://www.youtube-nocookie.com';
    frame._t = 0;
    var onMsg = function (e) {
      if (!frame.isConnected) { window.removeEventListener('message', onMsg); return; }
      if (e.origin !== YT || e.source !== frame.contentWindow) return;
      var m; try { m = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch (er) { return; }
      if (m && m.info && typeof m.info === 'object' && typeof m.info.currentTime === 'number') frame._t = m.info.currentTime;
    };
    var hello = function () { try { frame.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 'rs-inl', channel: 'widget' }), YT); } catch (er) {} };
    window.addEventListener('message', onMsg);
    frame.addEventListener('load', function () { hello(); setTimeout(hello, 1000); });
    return frame;
  }
  function miniBtn(cls, onClick) {
    return tovMiniOk() ? h('button', { type: 'button', class: cls, title: 'Keep watching in a small player while you browse', on: { click: onClick } }, [icon('pip', 16), h('span', { text: 'Mini player' })]) : null;
  }
  function tovRepeat() { try { return localStorage.getItem('rs_repeat') === '1'; } catch (e) { return false; } }
  // Repeat for a YouTube song: when the player reports the end (state 0), go back to the start and play again.
  function repeatYt(t, media) {
    var YT = 'https://www.youtube-nocookie.com';
    var send = function (func, args) { try { media.contentWindow.postMessage(JSON.stringify({ event: 'command', func: func, args: args || [], id: 'rs-tov', channel: 'widget' }), YT); } catch (e) {} };
    var onMsg = function (e) {
      if (e.origin !== YT || e.source !== media.contentWindow || S.tov !== t || !tovRepeat()) return;
      var m; try { m = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch (er) { return; }
      var ended = m && ((m.event === 'onStateChange' && m.info === 0) || (m.info && typeof m.info === 'object' && m.info.playerState === 0));
      if (ended) { send('seekTo', [0, true]); send('playVideo'); }
    };
    var hello = function () {
      try {
        media.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 'rs-tov', channel: 'widget' }), YT);
        media.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'addEventListener', args: ['onStateChange'], id: 'rs-tov', channel: 'widget' }), YT);
      } catch (er) {}
    };
    window.addEventListener('message', onMsg);
    media.addEventListener('load', function () { hello(); setTimeout(hello, 1000); });
    var prev = t.cleanup; t.cleanup = function () { window.removeEventListener('message', onMsg); if (prev) prev(); };
  }
  function tovAutoplay() { try { return localStorage.getItem('rs_autoplay') !== '0'; } catch (e) { return true; } }
  function tovMiniOk() { try { return window.matchMedia('(min-width: 900px) and (hover: hover)').matches; } catch (e) { return false; } }
  // Mini player position: dragged by its title bar (or the ⠿ grip, which also takes the arrow keys), kept inside the
  // window and remembered in this browser. No position saved = the bottom-right corner.
  function miniPos() { try { var p = JSON.parse(localStorage.getItem('rs_mini_pos') || 'null'); return p && isFinite(p.x) && isFinite(p.y) ? p : null; } catch (e) { return null; } }
  function placeMini(node, p, save) {
    if (!p) { node.style.left = node.style.top = node.style.right = node.style.bottom = ''; return; }
    var w = node.offsetWidth || 420, ht = node.offsetHeight || 280, m = 8;
    var x = Math.max(m, Math.min(window.innerWidth - w - m, p.x)), y = Math.max(m, Math.min(window.innerHeight - ht - m, p.y));
    node.style.left = x + 'px'; node.style.top = y + 'px'; node.style.right = 'auto'; node.style.bottom = 'auto';
    if (save) try { localStorage.setItem('rs_mini_pos', JSON.stringify({ x: Math.round(x), y: Math.round(y) })); } catch (e) {}
  }
  function miniDrag(t) {
    if (t.dragOn) return; t.dragOn = true;
    var node = t.node, bar = node.querySelector('.tov-bar'), grip = node.querySelector('.tov-grip'); if (!bar) return;
    var start = null, moved = false;
    // Starts on the title too (it's a link): a press that moves more than 4px drags and the click is dropped; a plain click still opens the page.
    bar.addEventListener('pointerdown', function (e) {
      if (!S.tovMini || S.tov !== t || e.button !== 0) return;
      if (e.target.closest('button, input, select') && !e.target.closest('.tov-grip')) return;
      var r = node.getBoundingClientRect(); start = { px: e.clientX, py: e.clientY, x: r.left, y: r.top, id: e.pointerId }; moved = false;
      if (e.target.closest('.tov-grip')) e.preventDefault();
    });
    document.addEventListener('pointermove', function (e) {
      if (!start || e.pointerId !== start.id) return;
      var dx = e.clientX - start.px, dy = e.clientY - start.py;
      if (!moved) { if (Math.abs(dx) + Math.abs(dy) < 5) return; moved = true; node.classList.add('tov-dragging'); }
      placeMini(node, { x: start.x + dx, y: start.y + dy }, false);
    });
    var end = function (e) {
      if (!start || (e && e.pointerId !== start.id)) return; start = null;
      if (!moved) return;
      node.classList.remove('tov-dragging');
      var r = node.getBoundingClientRect(); placeMini(node, { x: r.left, y: r.top }, true);
      setTimeout(function () { moved = false; }, 0); // the click that may follow this pointerup is dropped first
    };
    document.addEventListener('pointerup', end); document.addEventListener('pointercancel', end);
    bar.addEventListener('click', function (e) { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } }, true);
    bar.addEventListener('dragstart', function (e) { if (S.tovMini) e.preventDefault(); });
    if (grip) grip.addEventListener('keydown', function (e) {
      var k = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]; if (!k || !S.tovMini) return;
      e.preventDefault(); var r = node.getBoundingClientRect(), d = e.shiftKey ? 80 : 24;
      placeMini(node, { x: r.left + k[0] * d, y: r.top + k[1] * d }, true);
    });
  }
  window.addEventListener('resize', function () { if (S.tov && S.tovMini && miniPos()) placeMini(S.tov.node, miniPos(), false); });
  function setTovMini(on, quiet) {
    var t = S.tov; if (!t) return;
    S.tovMini = on;
    t.node.classList.toggle('tov-mini', on);
    if (on) { miniDrag(t); var mp = miniPos(); if (mp) requestAnimationFrame(function () { if (S.tov === t && S.tovMini) placeMini(t.node, mp, false); }); } else placeMini(t.node, null);
    t.node.setAttribute('aria-modal', on ? 'false' : 'true');
    document.body.classList.toggle('tov-open', !on);
    if (t.miniB) {
      t.miniB.setAttribute('aria-label', on ? 'Back to the full-size player' : 'Mini player: keep watching while you browse');
      t.miniB.title = on ? 'Full size (I)' : 'Mini player (I)';
      t.miniB.querySelector('.tov-mnl').textContent = on ? '' : 'Mini player';
    }
    if (!quiet && !on) { var x = t.node.querySelector('.tov-x'); if (x) x.focus(); }
    if (!quiet && on && t.opener && t.opener.isConnected) t.opener.focus({ preventScroll: true });
  }
  // "Up next": in the last 10 seconds, a card offers the next video from the same row; it plays when this one ends
  // unless the viewer cancels. YouTube reports progress through its embed postMessage protocol (no extra script).
  function upNext(box, media, opener, queue) {
    var nx = queue && queue.list && queue.list[queue.i + 1];
    if (!nx || !nx.m || !nx.x) return;
    var t = S.tov, shown = false, cancelled = false, done = false, left = null, autoOn = tovAutoplay();
    t.autoChanged = function (on) { autoOn = on; if (on) cancelled = false; if (left !== null && shown) count.textContent = on ? ' · in ' + left + 's' : ''; };
    var playNext = function () { if (done || S.tov !== t) return; done = true; openTrailerOverlay(nx.m, nx.x, opener, { list: queue.list, i: queue.i + 1 }, true); };
    var count = h('span', { class: 'un-c' });
    var thumb = nx.x.yt ? h('img', { src: 'https://i.ytimg.com/vi/' + nx.x.yt + '/mqdefault.jpg', alt: '', width: 320, height: 180 }) : h('span', { class: 'ph', style: artLazy(nx.m, 'banner', 320).style });
    var card = h('div', { class: 'upnext', role: 'status', hidden: true }, [
      h('button', { type: 'button', class: 'un-th', 'aria-label': 'Play next: ' + nx.m.data.title, on: { click: playNext } }, [thumb, h('span', { class: 'pb', 'aria-hidden': 'true', text: '▶' })]),
      h('div', { class: 'un-b' }, [
        h('span', { class: 'un-k' }, ['Up next', count]),
        h('b', { class: 'un-t', text: nx.m.data.title }),
        h('span', { class: 'note', text: nx.x.title }),
        h('div', { class: 'un-a' }, [
          h('button', { type: 'button', class: 'btn small primary', text: 'Play now', on: { click: playNext } }),
          h('button', { type: 'button', class: 'btn small ghost', text: 'Cancel', on: { click: function () { cancelled = true; card.hidden = true; box.classList.remove('has-next'); } } })
        ])
      ])
    ]);
    box.querySelector('.tov-v').appendChild(card);
    t.hideNext = function () { shown = false; card.hidden = true; box.classList.remove('has-next'); };
    var tick = function (cur, dur, ended) {
      if (done || S.tov !== t) return;
      if (t.repeatOn && t.repeatOn()) { if (shown) t.hideNext(); return; } // Repeat is on: this song plays again instead
      if (ended) {
        if (!cancelled && autoOn) playNext();
        else if (!cancelled) { shown = true; card.hidden = false; box.classList.add('has-next'); count.textContent = ''; }
        return;
      }
      if (!(dur > 15) || !(cur >= 0)) return;
      left = Math.max(0, Math.ceil(dur - cur));
      if (left <= 10 && !cancelled) { if (!shown) { shown = true; card.hidden = false; box.classList.add('has-next'); } count.textContent = autoOn ? ' · in ' + left + 's' : ''; }
      else if (shown && left > 10) { shown = false; card.hidden = true; box.classList.remove('has-next'); } // viewer seeked back
    };
    if (media.tagName === 'VIDEO') {
      media.addEventListener('timeupdate', function () { tick(media.currentTime, media.duration, false); });
      media.addEventListener('ended', function () { tick(0, 0, true); });
      return;
    }
    var YT = 'https://www.youtube-nocookie.com', cur = 0, dur = 0;
    var onMsg = function (e) {
      if (e.origin !== YT || e.source !== media.contentWindow) return;
      var m; try { m = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch (er) { return; }
      var info = m && m.info;
      if (m && m.event === 'onStateChange' && info === 0) return tick(0, 0, true);
      if (!info || typeof info !== 'object') return;
      if (typeof info.duration === 'number' && info.duration) dur = info.duration;
      if (typeof info.currentTime === 'number') cur = info.currentTime;
      if (info.playerState === 0) return tick(0, 0, true);
      tick(cur, dur, false);
    };
    var hello = function () {
      try {
        media.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 'rs-tov', channel: 'widget' }), YT);
        media.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'addEventListener', args: ['onStateChange'], id: 'rs-tov', channel: 'widget' }), YT);
      } catch (er) {}
    };
    window.addEventListener('message', onMsg);
    media.addEventListener('load', function () { hello(); setTimeout(hello, 1000); });
    var prevClean = t.cleanup; t.cleanup = function () { window.removeEventListener('message', onMsg); if (prevClean) prevClean(); };
  }
  function closeTrailerOverlay() {
    if (!S.tov) return;
    var t = S.tov; S.tov = null;
    document.removeEventListener('keydown', t.key);
    if (document.fullscreenElement) { try { document.exitFullscreen(); } catch (e) {} }
    if (t.cleanup) t.cleanup();
    if (t.node.parentNode) t.node.parentNode.removeChild(t.node);
    document.body.classList.remove('tov-open');
    if (t.opener && t.opener.isConnected && !S.tovMini) t.opener.focus({ preventScroll: true });
  }

  // ---------- Give your verdict row: recent and popular titles you haven't rated yet, one tap to rate ----------
  function rateSection() {
    var list = rateList().slice(0, 15);
    S.rateOrder = { ids: list.map(function (m) { return m.id; }) };
    S.rateRows = S.rateRows || {};
    S.rateRows['Seen these? Give your verdict'] = { opts: { rate: true }, next: function (shown) {
      var ro = S.rateOrder.ids; return rateList().filter(function (x) { return ro.indexOf(x.id) === -1 && shown.indexOf(x.id) === -1; })[0];
    }, swap: function (oldId, newId) { var ro = S.rateOrder.ids, i = ro.indexOf(oldId); if (i === -1) return; if (newId) ro[i] = newId; else ro.splice(i, 1); } };
    return rowSection('Seen these? Give your verdict', list, { rate: true }, h('span', { class: 'sub' }, [h('span', { class: 'rnote', text: rateNote() }), qvLegend(list)]));
  }
  // Every title the row could show, in row order; titles marked "Not for me" (Tonight) or "Haven't seen" are left out.
  function rateList() {
    var today = new Date().toISOString().slice(0, 10), cut = new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10);
    var done = S.justRated || {}, nope = tnNope().concat(rateUnseen());
    var list = S.movies.filter(function (m) {
      var d = m.data, r = d.releaseDate || '';
      if (!released(m) || d.section === 'Coming soon' || nope.indexOf(m.id) !== -1) return false;
      if (myVerdict(m.id) && !done[m.id]) return false;
      return d.section === 'In theatres' || d.section === 'On OTT' || (isTv(m) ? !d.endYear || String(d.endYear) >= today.slice(0, 4) : r.length === 10 && r >= cut && r <= today);
    });
    var pop = popularityOf(list);
    list.sort(function (a, b) { return pop[b.id] - pop[a.id] || (b.data.releaseDate || '').localeCompare(a.data.releaseDate || ''); });
    // Keep the order the row was first shown in: a new verdict raises a title's popularity, which would otherwise
    // move it to the front. Titles new to the row go after the ones already shown.
    var ro = S.rateOrder ? S.rateOrder.ids : null;
    if (ro) {
      var at = {}; ro.forEach(function (id, i) { at[id] = i; });
      list = list.filter(function (m) { return m.id in at; }).sort(function (a, b) { return at[a.id] - at[b.id]; })
        .concat(list.filter(function (m) { return !(m.id in at); }));
    }
    return list;
  }
  // The verdict part of a "Seen these?" card: first "Seen it" / "Haven't seen". Seen it flips to the verdict icons;
  // Haven't seen flips the whole card to the next title in the row, in the same place.
  // Seen it / Haven't seen on a card; after Seen it, the verdict icons. icons: the Browse "In theatres" look, three icons
  // like the verdict row (Seen it, Trailer in the mini player, Haven't seen), the word popping up on hover.
  function rateBox(m, icons) {
    var box = h('div', { class: 'rbox' });
    function show(anim) {
      box.textContent = '';
      var seen = (S.rateSeen && S.rateSeen[m.id]) || isSeen(m.id) || myVerdict(m.id), face;
      var markOn = function () { S.rateSeen = S.rateSeen || {}; S.rateSeen[m.id] = 1; markSeen(m.id, true); };
      if (seen) {
        var back = myVerdict(m.id) ? null : h('button', { type: 'button', class: 'rback', 'aria-label': 'I haven’t seen ' + m.data.title,
          on: { click: function () {
            if (S.rateSeen) delete S.rateSeen[m.id]; markSeen(m.id, false); show(true); var b = box.querySelector('.rch .tnact, .qb'); if (b) b.focus();
            toast(m.data.title + ' marked as not seen', function () { markOn(); rateRefresh(m.id); });
          } } }, [icon('eyeoff', 15), h('span', { class: 'qtip', 'aria-hidden': 'true', text: 'Haven’t seen' })]);
        face = h('div', { class: 'rvq' + (back ? ' wb' : '') + (anim ? ' rflip' : '') }, [qvButtons(m, function () {
          var r = box.querySelector('.rvq'); if (myVerdict(m.id) && r && r.querySelector('.rback')) { r.removeChild(r.querySelector('.rback')); r.classList.remove('wb'); }
        }), back]);
      } else if (icons) {
        var tip = function (x) { return h('span', { class: 'qtip', 'aria-hidden': 'true', text: x }); };
        var tr = vidItems(m).filter(function (x) { return x.cat === 'trailers' && (x.yt || x.clip); })[0] || null;
        var no = rateUnseen().indexOf(m.id) !== -1;
        var trB = h('button', { type: 'button', class: 'qb tr' + (tr ? '' : ' off'), 'aria-disabled': tr ? null : 'true',
          'aria-label': tr ? 'Play the trailer of ' + m.data.title + (tovMiniOk() ? ' in the mini player' : '') : 'No trailer for ' + m.data.title + ' yet',
          on: { click: function () {
            if (!tr) { toast('No trailer for ' + m.data.title + ' yet'); return; }
            if (tovMiniOk()) toMini(m, tr); else openTrailerOverlay(m, tr, trB, titleQueue(m, tr));
          } } }, [icon('play', 18), tip(tr ? 'Trailer' : 'No trailer yet')]);
        var seB = h('button', { type: 'button', class: 'qb se', 'aria-label': 'I’ve seen ' + m.data.title, on: { click: function () {
            markOn(); show(true); var q = box.querySelector('.qv:not(.up) .qb'); if (q) q.focus();
          } } }, [icon('eye', 18), tip('Seen it')]);
        // Booking open: Trailer, Tickets, Seen it. Otherwise: Seen it, Trailer, Haven't seen.
        var tk = btnOn(btnPlace(), 'book') ? bookBtn(m, 'qb tk') : null;
        if (tk) { tk.textContent = ''; tk.appendChild(icon('ticket', 18)); tk.appendChild(tip('Tickets')); }
        face = h('div', { class: 'qv icons up seenrow' + (tk ? ' bk' : '') + (anim ? ' rflip' : ''), role: 'group', 'aria-label': 'Have you seen ' + m.data.title + '?' }, tk ? [trB, tk, seB] : [
          seB,
          trB,
          h('button', { type: 'button', class: 'qb nv' + (no ? ' on' : ''), 'aria-pressed': String(no), 'aria-label': no ? 'Marked as not seen. Tap to clear' : 'I haven’t seen ' + m.data.title, on: { click: function () {
            if (no) { rateDelUnseen(m.id); show(true); toast('Cleared “haven’t seen” for ' + m.data.title); return; }
            rateAddUnseen(m.id); markSeen(m.id, false); show(true);
            toast(m.data.title + ' marked as not seen', function () { rateDelUnseen(m.id); rateRefresh(m.id); });
          } } }, [icon('eyeoff', 18), tip('Haven’t seen')])
        ]);
      } else {
        face = h('div', { class: 'rch' + (anim ? ' rflip' : '') }, [
          h('button', { type: 'button', class: 'tnact', on: { click: function () {
            markOn(); show(true); var q = box.querySelector('.qb'); if (q) q.focus();
          } } }, [icon('eye', 15), h('span', { text: 'Seen it' })]),
          h('button', { type: 'button', class: 'tnact dim', on: { click: function (e) { rateNope(m, e.currentTarget); } } }, [icon('eyeoff', 15), h('span', { text: 'Haven’t seen' })])
        ]);
      }
      box.appendChild(face);
    }
    box._show = show; box.setAttribute('data-rate', m.id);
    show(false);
    return box;
  }
  // My List › My Watchlist (design board: "My Watchlist: give a verdict on what you've seen"), films and series:
  // Seen / Not seen under the main button. Seen flips to the verdict icons plus Not seen; once rated, the icons stay with
  // your verdict lit up and the others dimmed (tap another to change it, the lit one to clear it). Not seen is recorded
  // (the home "Seen these?" row stops asking) and the two buttons stay, with Not seen shown as picked.
  function wlVerdictBox(m) {
    var box = h('div', { class: 'rbox wlv' }), t = m.data.title;
    var tip = function (x) { return h('span', { class: 'qtip', 'aria-hidden': 'true', text: x }); };
    function show(anim) {
      box.textContent = '';
      var v = myVerdict(m.id);
      if (v || isSeen(m.id) || (S.rateSeen && S.rateSeen[m.id])) {
        var q = qvButtons(m, function () { show(false); });
        q.classList.add('q4'); if (v) q.classList.add('rated');
        q.appendChild(h('button', { type: 'button', class: 'qb nv', 'aria-label': v ? 'I haven’t seen ' + t + ' (clears your verdict)' : 'I haven’t seen ' + t,
          on: { click: function () {
            var had = myVerdict(m.id);
            if (had) setVerdict(m.id, had); // tapping the same verdict again clears it
            if (S.rateSeen) delete S.rateSeen[m.id]; markSeen(m.id, false); show(true);
            var f = box.querySelector('.tnact'); if (f) f.focus();
            toast(t + ' marked as not seen', function () { markSeen(m.id, true); if (had && myVerdict(m.id) !== had) setVerdict(m.id, had); rateRefresh(m.id); });
          } } }, [icon('eyeoff', 18), tip('Not seen')]));
        box.appendChild(h('div', { class: anim ? 'rflip' : '' }, [q]));
      } else {
        var no = rateUnseen().indexOf(m.id) !== -1;
        box.appendChild(h('div', { class: 'rch wlsn' + (anim ? ' rflip' : ''), role: 'group', 'aria-label': 'Have you seen ' + t + '?' }, [
          h('button', { type: 'button', class: 'tnact', on: { click: function () {
            S.rateSeen = S.rateSeen || {}; S.rateSeen[m.id] = 1; markSeen(m.id, true); if (no) rateDelUnseen(m.id);
            show(true); var b = box.querySelector('.qb'); if (b) b.focus();
          } } }, [icon('eye', 15), h('span', { text: 'Seen' })]),
          h('button', { type: 'button', class: 'tnact dim', 'aria-pressed': String(no), 'aria-label': no ? 'Marked as not seen. Tap to clear' : 'I haven’t seen ' + t,
            on: { click: function () {
              if (no) { rateDelUnseen(m.id); show(false); toast('Cleared “not seen” for ' + t); return; }
              rateAddUnseen(m.id); markSeen(m.id, false); show(false);
              toast(t + ' marked as not seen', function () { rateDelUnseen(m.id); rateRefresh(m.id); });
            } } }, [icon('eyeoff', 15), h('span', { text: 'Not seen' })])
        ]));
      }
    }
    box._show = show; box.setAttribute('data-rate', m.id);
    show(false);
    return box;
  }
  // Redraw every Seen / Haven't seen box of a title on the page (the page may have redrawn since a toast's Undo was set up).
  function rateRefresh(id) { Array.prototype.forEach.call(document.querySelectorAll('.rbox[data-rate]'), function (b) { if (b.getAttribute('data-rate') === id && b._show) b._show(true); }); }
  // "Haven't seen" on a card: the title leaves the "Seen these?" rows (it stays a candidate everywhere else, so it
  // can still be suggested to watch), and the card flips to the row's next title, one that isn't already in the row
  // (each row says where its next title comes from: S.rateRows).
  function rateUnseen() {
    var a = S.uid && S.mineLoaded ? (S.mine.unseen || []) : []; try { a = a.concat(JSON.parse(localStorage.getItem('rs_unseen') || '[]') || []); } catch (e) {}
    return a;
  }
  function rateAddUnseen(id) {
    if (S.uid && S.mineLoaded) { S.mine.unseen = (S.mine.unseen || []).filter(function (x) { return x !== id; }).concat([id]).slice(-500); saveMine(null); }
    else { try { var a = JSON.parse(localStorage.getItem('rs_unseen') || '[]') || []; if (a.indexOf(id) === -1) a.push(id); localStorage.setItem('rs_unseen', JSON.stringify(a.slice(-500))); } catch (e) {} }
  }
  function rateDelUnseen(id) {
    if (S.uid && S.mineLoaded) { S.mine.unseen = (S.mine.unseen || []).filter(function (x) { return x !== id; }); saveMine(null); }
    try { var a = JSON.parse(localStorage.getItem('rs_unseen') || '[]') || []; localStorage.setItem('rs_unseen', JSON.stringify(a.filter(function (x) { return x !== id; }))); } catch (e) {}
  }
  function rateNope(m, btn) {
    var card = btn.closest('.pc'); rateAddUnseen(m.id);
    if (!card) return;
    var sec = card.closest('section[aria-label]'), R = sec && S.rateRows && S.rateRows[sec.getAttribute('aria-label')];
    var shown = sec ? Array.prototype.map.call(sec.querySelectorAll('.pc[data-id]'), function (c) { return c.getAttribute('data-id'); }) : [m.id];
    var next = R ? R.next(shown) : null, parent = card.parentNode, after = card.nextSibling, nc = null;
    if (R && R.swap) R.swap(m.id, next ? next.id : null);
    // Undo (a mis-tap): the title is asked about again and its card comes back where it was.
    toast('Got it. We won\u2019t ask about ' + m.data.title + ' here again', function () {
      rateDelUnseen(m.id);
      if (R && R.swap && next) R.swap(next.id, m.id);
      var back = posterCard(m, R ? R.opts : { rate: true }); back.classList.add('pcflip');
      if (nc && nc.parentNode) nc.parentNode.replaceChild(back, nc);
      else if (card.parentNode) card.parentNode.replaceChild(back, card);
      else if (parent) parent.insertBefore(back, after && after.parentNode === parent ? after : null);
      var f = back.querySelector('.rch .tnact, .qb'); if (f) f.focus({ preventScroll: true });
    });
    if (!next) { card.classList.add('pcgone'); setTimeout(function () { if (card.parentNode) card.parentNode.removeChild(card); }, 320); return; }
    nc = posterCard(next, R.opts); nc.classList.add('pcflip');
    card.parentNode.replaceChild(nc, card);
    var f = nc.querySelector('.rch .tnact'); if (f) f.focus({ preventScroll: true });
  }
  function rateNote() {
    var done = S.justRated || {}, n = Object.keys(done).filter(function (id) { return myVerdict(id); }).length;
    return n ? 'Thanks — ' + n + ' verdict' + (n === 1 ? '' : 's') + ' added. Every one counts toward the score.' : 'One tap each. Your verdict counts toward the score.';
  }

  // ---------- New trailers row: latest titles with a playable trailer; a card opens the title and plays it ----------
  function trailerPicks(all) {
    var cut = new Date(Date.now() - 180 * 864e5).toISOString().slice(0, 10);
    var picks = [], pins = rowPins('trailers'); // pinned films show even when older than the 6-month window
    S.movies.forEach(function (m) {
      if (isTv(m) || (!all && pins.indexOf(m.id) === -1 && (m.data.releaseDate || '') < cut)) return;
      var it = vidItems(m), k = -1;
      it.some(function (x, i) { if (x.cat === 'trailers' && (x.yt || x.clip)) { k = i; return true; } });
      if (k >= 0) picks.push({ m: m, i: k, x: it[k] });
    });
    picks.sort(function (a, b) { return (b.m.data.releaseDate || '').localeCompare(a.m.data.releaseDate || ''); });
    return pinPicks(picks, pins);
  }
  function trailerCard(p, i, arr) {
    var m = p.m, d = m.data, rel = released(m);
    var th = p.x.yt ? h('img', { src: 'https://i.ytimg.com/vi/' + p.x.yt + '/hqdefault.jpg', alt: '', width: 480, height: 360, loading: 'lazy' }) : h('span', { class: 'ph', style: artLazy(m, 'banner', 640).style, 'data-bg': artLazy(m, 'banner', 640).bg });
    // The thumbnail plays the trailer in the overlay; the button below goes to the title's page.
    return h('div', { class: 'tcard' }, [
      h('a', { class: 'tplay', href: videoUrl(m, p.x.yt) || movieUrl(m), 'aria-label': 'Play the ' + d.title + ' ' + p.x.kind.toLowerCase(), on: { click: function (e) {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault(); e.stopPropagation();
        openTrailerOverlay(m, p.x, e.currentTarget, arr ? { list: arr, i: i } : null);
      } } }, [
        h('span', { class: 'th' }, [th, h('span', { class: 'kb', text: String(p.x.kind).toUpperCase() }), h('span', { class: 'pb', 'aria-hidden': 'true', text: '▶' })]),
        h('span', { class: 'tt', text: d.title }),
        h('span', { class: 'note', text: [langOf(d), rel ? (isOtt(m) ? 'On ' + (d.platform || 'OTT') : 'Out now') : 'Releases ' + fmtDate(d.releaseDate)].filter(Boolean).join(' · ') })
      ]),
      h('a', { class: 'btn small tdet', href: movieUrl(m), 'aria-label': 'View details for ' + d.title, text: 'View details' })
    ]);
  }
  function showAll(href) { return h('span', { class: 'sub' }, [h('a', { href: href, text: 'Show all' })]); }
  function trailerSection() {
    var picks = trailerPicks(false).slice(0, 20);
    if (!picks.length) return null;
    return h('section', { class: 'sect', 'aria-label': 'New trailers' }, [
      h('div', { class: 'sect-h' }, [h('h2', { text: 'New trailers' }), showAll('/trailers')]),
      h('div', { class: 'rowx' }, picks.map(trailerCard))
    ]);
  }

  // ---------- New songs row: songs from recent and upcoming titles, played in the full-screen overlay ----------
  function songPicks(all) {
    var cut = new Date(Date.now() - 180 * 864e5).toISOString().slice(0, 10), picks = [], pins = rowPins('songs');
    S.movies.forEach(function (m) {
      if (isTv(m) || (!all && pins.indexOf(m.id) === -1 && (m.data.releaseDate || '') < cut)) return;
      var ss = vidItems(m).filter(function (x) { return x.cat === 'songs' && (x.yt || x.clip); });
      (all ? ss : ss.slice(0, 3)).forEach(function (x) { picks.push({ m: m, x: x }); });
    });
    // Newest first by when the song came out: its YouTube upload date or the film's release, whichever is earlier
    // (labels often upload old film songs years later, and new songs come out before the film).
    var when = function (p) { var r = /^\d{4}/.test(p.m.data.releaseDate || '') ? String(p.m.data.releaseDate) : '', u = p.x.pub; return u && r ? (u < r ? u : r) : u || r; };
    picks.forEach(function (p, i) { p._w = when(p); p._i = i; });
    picks.sort(function (a, b) { return b._w.localeCompare(a._w) || a._i - b._i; });
    return pinPicks(picks, pins);
  }
  function songCard(p, i, arr) {
    var m = p.m, d = m.data;
    var th = p.x.yt ? h('img', { src: 'https://i.ytimg.com/vi/' + p.x.yt + '/hqdefault.jpg', alt: '', width: 480, height: 360, loading: 'lazy' }) : h('span', { class: 'ph', style: artLazy(m, 'banner', 640).style, 'data-bg': artLazy(m, 'banner', 640).bg });
    return h('a', { class: 'tcard', href: videoUrl(m, p.x.yt) || movieUrl(m), 'aria-label': 'Play ' + p.x.title + ' from ' + d.title, on: { click: function (e) {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault(); e.stopPropagation();
      openTrailerOverlay(m, p.x, e.currentTarget, arr ? { list: arr, i: i } : null);
    } } }, [
      h('span', { class: 'th' }, [th, h('span', { class: 'kb', text: String(p.x.kind).toUpperCase() }), h('span', { class: 'pb', 'aria-hidden': 'true', text: '▶' })]),
      h('span', { class: 'tt', text: p.x.title }),
      h('span', { class: 'note', text: [d.title, langOf(d)].filter(Boolean).join(' · ') }),
      p.x.yt ? h('span', { class: 'note vviews', 'data-yt': p.x.yt }) : null
    ]);
  }
  // YouTube view counts under each song on /songs, from /api/views (cached by the CDN for 6 hours).
  function fmtViews(n) {
    var u = [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']], t = String(n);
    for (var i = 0; i < u.length; i++) {
      var x = n / u[i][0], r = x < 10 ? Math.round(x * 10) / 10 : Math.round(x);
      if (x >= 1) { t = r >= 1000 && i ? '1' + u[i - 1][1] : String(r) + u[i][1]; break; }
    }
    return t + (n === 1 ? ' view' : ' views');
  }
  // allIds: the whole list in its usual order, cut into fixed 50-id batches (the same URLs for every visitor, so the
  // CDN cache is shared). Only the batches holding a song on screen are asked for.
  function loadViews(allIds, shownIds, done) {
    S.views = S.views || {}; S.viewsAsked = S.viewsAsked || {};
    var ids = allIds.filter(function (id, i) { return id && allIds.indexOf(id) === i; }), want = {};
    shownIds.forEach(function (id) { if (id) want[id] = 1; });
    for (var i = 0; i < ids.length; i += 50) {
      var b = ids.slice(i, i + 50);
      if (!b.some(function (id) { return want[id]; })) continue;
      (function (k) {
        if (S.viewsAsked[k]) return; S.viewsAsked[k] = 1;
        fetch('/api/views?ids=' + k).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
          if (!j || !j.counts) return;
          Object.keys(j.counts).forEach(function (id) { S.views[id] = j.counts[id]; }); S.viewsAsked[k] = 2;
          done();
        }).catch(function () {});
      })(b.join(','));
    }
  }
  function fillViews(root) {
    if (!S.views) return;
    Array.prototype.forEach.call(root.querySelectorAll('.vviews[data-yt]'), function (el) {
      var n = S.views[el.getAttribute('data-yt')];
      if (typeof n === 'number' && !el.textContent) el.textContent = fmtViews(n);
    });
  }
  function songSection() {
    var picks = songPicks(false).slice(0, 20);
    if (!picks.length) return null;
    return h('section', { class: 'sect', 'aria-label': 'New songs' }, [
      h('div', { class: 'sect-h' }, [h('h2', { text: 'New songs' }), showAll('/songs')]),
      h('div', { class: 'rowx' }, picks.map(songCard))
    ]);
  }

  // ---------- /trailers and /songs: every trailer or video song, newest first, filterable by language ----------
  var VID_PAGES = { trailers: { h: 'All trailers', t: 'Latest Movie Trailers | Reelscore', what: 'trailers', picks: trailerPicks, card: trailerCard },
                    'tv-promos': { h: 'All TV promotionals', t: 'TV Show Trailers, Promos & Episodes | Reelscore', what: 'TV promotionals', picks: tvPromoPicks, card: tvPromoCard },
                    songs: { h: 'All video songs', t: 'Latest Video Songs | Reelscore', what: 'video songs', picks: songPicks, card: songCard } };
  // ---------- Reelscore News: our own stories (Firestore "news", status "published") at /news and /news/<slug> ----------
  // Each build writes the story pages for search engines and lists every story in window.RS_NEWS (no body), which the
  // title pages use. /news pages also read Firestore, so a story shows as soon as it's published, before the next build.
  function newsList(kind) { var all = S.newsLive || (Array.isArray(window.RS_NEWS) ? window.RS_NEWS : []); return all.filter(function (p) { return postKind(p) === (kind || 'news'); }); }
  function loadNews() {
    if (S.newsLive || loadNews.on) return; loadNews.on = true;
    if (window.__reelStartFirebase) window.__reelStartFirebase();
    (S.db ? Promise.resolve(S.db) : window.claude.use('db')).then(function (db) {
      if (!db) throw new Error('offline');
      return db.collection('news').where('status', '==', 'published').get();
    }).then(function (snap) {
      S.newsLive = snap.docs.map(function (x) { var d = x.data() || {}; d.id = x.id; return d; })
        .filter(function (d) { return d.slug && d.title; })
        .sort(function (a, b) { return String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')); });
      if (S.route === 'news' || S.route === 'lists') render(true);
    }).catch(function () { loadNews.failed = true; if (S.route === 'news' || S.route === 'lists') render(true); });
  }
  function newsUrl(p) { return POSTS[postKind(p)].base + '/' + p.slug; }
  function newsDate(p) { return /^\d{4}-\d{2}-\d{2}/.test(p.publishedAt || '') ? fmtDate(p.publishedAt.slice(0, 10), true) : ''; }
  function newsTitles(p) { return (p.titles || []).map(function (id) { return S.byId[id]; }).filter(Boolean); }
  // The story's own picture, else the banner (or poster) of the first title it's about.
  function newsCover(p, w) {
    var u = safeUrl(p.coverUrl); if (u) return cld(u, w);
    var m = newsTitles(p)[0]; return m ? artUrl(m, 'banner', w) || artUrl(m, 'poster') : '';
  }
  // Story text: blank lines between paragraphs; "## " and "### " headings; lines starting "- " make a list; "> " a quote;
  // **bold**; [words](https://… or /movie/…) links. Same rules as scripts/build.mjs newsHtml.
  function newsInline(s) {
    var out = [], re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(((?:https:\/\/|\/)[^\s)]+)\)/g, last = 0, mm;
    while ((mm = re.exec(s))) {
      if (mm.index > last) out.push(s.slice(last, mm.index));
      if (mm[1]) out.push(h('strong', { text: mm[1] }));
      else { var ext = /^https:/.test(mm[3]); out.push(h('a', { href: mm[3], target: ext ? '_blank' : null, rel: ext ? 'noopener' : null, text: mm[2] })); }
      last = re.lastIndex;
    }
    if (last < s.length) out.push(s.slice(last));
    return out;
  }
  function newsBody(text) {
    return String(text || '').replace(/\r/g, '').split(/\n\s*\n/).map(function (b) { return b.trim(); }).filter(Boolean).map(function (b) {
      var lines = b.split('\n'), mm = lines.length === 1 && b.match(/^(#{2,3})\s+(.+)$/);
      if (mm) return h(mm[1].length === 2 ? 'h2' : 'h3', {}, newsInline(mm[2]));
      if (lines.every(function (l) { return /^\s*[-*]\s+/.test(l); })) return h('ul', {}, lines.map(function (l) { return h('li', {}, newsInline(l.replace(/^\s*[-*]\s+/, ''))); }));
      if (lines.every(function (l) { return /^>/.test(l); })) return h('blockquote', {}, newsInline(lines.map(function (l) { return l.replace(/^>\s?/, ''); }).join(' ')));
      var kids = []; lines.forEach(function (l, i) { if (i) kids.push(h('br')); newsInline(l).forEach(function (x) { kids.push(x); }); });
      return h('p', {}, kids);
    });
  }
  window.reelNewsBody = newsBody;
  function newsItem(p) {
    var c = newsCover(p, 320);
    return h('a', { class: 'nwi', href: newsUrl(p) }, [
      h('span', { class: 'nth', 'aria-hidden': 'true' }, c ? [h('img', { src: c, alt: '', loading: 'lazy', width: 256, height: 144, on: { error: function () { this.remove(); } } })] : []),
      h('span', { class: 'nm' }, [h('span', { class: 'ntag', text: POSTS[postKind(p)].tag }), h('span', { class: 'note', text: newsDate(p) })]),
      h('span', { class: 'nt', text: p.title }), h('span', { class: 'na', 'aria-hidden': 'true', text: '→' })
    ]);
  }
  function drawNews() {
    var v = $('view-news');
    // The built page for this address (when the visit started here) stays as it is until the stories come in from the database.
    var built = !!v.querySelector('[data-prerendered]') && location.pathname.replace(/\/+$/, '') === adsFirst.path.replace(/\/+$/, '');
    if (!S.newsLive && built) return;
    var K = POSTS[S.newsKind] || POSTS.news, list = newsList(S.newsKind), p = S.param ? list.filter(function (x) { return x.slug === S.param; })[0] : null;
    // A story from the last build, opened inside the app while the database can't be reached: load its built page.
    if (p && !p.body && loadNews.failed && !built) { location.reload(); return; }
    v.innerHTML = '';
    var w = h('div', { class: 'wrapx nwpage' }); v.appendChild(w);
    var crumbs = [h('a', { href: '/', text: 'Home' }), ' › '].concat(S.param ? [h('a', { href: K.base, text: K.label })] : [K.label]);
    w.appendChild(h('nav', { class: 'gcrumbs', 'aria-label': 'Breadcrumb' }, crumbs));
    if (S.param) {
      if (!p || !p.body && !S.newsLive) {
        if (!S.newsLive && !loadNews.failed) { w.appendChild(h('div', { class: 'empty', text: 'Loading…' })); return; }
        document.title = 'Not found | Reelscore'; setNoindex(true); setCanonical(null);
        w.appendChild(h('div', { class: 'empty' }, ['We couldn’t find this ' + K.what + '. ', h('a', { href: K.base, text: K.all })])); w.appendChild(footer()); return;
      }
      setNoindex(false); setCanonical(newsUrl(p)); document.title = (p.title + ' | Reelscore').length <= 60 ? p.title + ' | Reelscore' : p.title.length <= 65 ? p.title : p.title.slice(0, 64).replace(/\s+\S*$/, '') + '…'; // same as scripts/build.mjs
      var cover = newsCover(p, 1280), linked = newsTitles(p), more = list.filter(function (x) { return x.slug !== p.slug; }).slice(0, 4);
      w.appendChild(h('article', { class: 'nwart' }, [
        h('h1', { class: 'nwh', text: p.title }),
        p.summary ? h('p', { class: 'nwdek', text: p.summary }) : null,
        h('div', { class: 'note nwmeta', text: [S.newsKind === 'blog' ? 'By the Reelscore team' : 'By Reelscore', newsDate(p)].filter(Boolean).join(' · ') }),
        cover ? h('img', { class: 'nwcover', src: cover, alt: p.coverAlt || '', width: 1280, height: 720 }) : null,
        h('div', { class: 'nwbody' }, newsBody(p.body))
      ]));
      var rs = linked.length ? rowSection(linked.length === 1 ? 'In this ' + K.what : 'Titles in this ' + K.what, linked, null) : null;
      if (rs) w.appendChild(rs);
      if (more.length) w.appendChild(h('section', { class: 'nwmore', 'aria-labelledby': 'h-nwmore' }, [h('h2', { id: 'h-nwmore', text: K.more }), h('div', { class: 'card news' }, more.map(newsItem))]));
      w.appendChild(footer());
      return;
    }
    setNoindex(false); setCanonical(K.base); document.title = K.title;
    w.appendChild(h('h1', { class: 'display', style: 'margin:0 0 6px', text: K.h1 }));
    w.appendChild(h('p', { class: 'note', style: 'margin:0 0 18px', text: K.lead }));
    w.appendChild(list.length ? h('div', { class: 'card news' }, list.map(newsItem)) : h('div', { class: 'empty', text: S.newsLive || loadNews.failed ? K.none : 'Loading…' }));
    w.appendChild(footer());
  }
  // ---------- Lists (/lists, /lists/<slug>): hand-picked titles with a note each, written in Admin > Lists ----------
  // Stored in Firestore "news" with kind "list". Each build writes the pages for search engines; the app redraws them
  // from the database (with posters and where to watch), so a list shows as soon as it is published.
  var LISTS_TITLE = 'Movie Lists: What to Watch by Language & OTT | Reelscore';
  function listsLive() { return (S.newsLive || []).filter(function (p) { return postKind(p) === 'list'; }); }
  function listItems(p) { return (Array.isArray(p.items) ? p.items : []).map(function (x) { return { m: x && S.byId[x.id], note: String((x && x.note) || '').trim() }; }).filter(function (x) { return x.m; }); }
  function listWhere(m) {
    var d = m.data;
    if (!isTv(m) && isUpcoming(m)) return d.releaseDate ? 'In theatres ' + fmtDate(d.releaseDate, true) : 'Coming soon';
    if (!isTv(m) && (nowPlayingOf(d) === 'theatres' || d.section === 'In theatres')) return 'In theatres now';
    return d.platform ? 'On ' + String(d.platform).split('/').map(function (x) { return x.trim(); }).filter(Boolean).join(', ') : '';
  }
  function drawLists() {
    var v = $('view-lists');
    var built = !!v.querySelector('[data-prerendered]') && location.pathname.replace(/\/+$/, '') === adsFirst.path.replace(/\/+$/, '');
    if ((!S.newsLive || !S.loaded) && built) return;
    // Opened inside the app while the database can't be reached: load the built page instead.
    if (loadNews.failed && !S.newsLive && !built && S.pushed) { location.reload(); return; }
    v.innerHTML = '';
    var w = h('div', { class: 'wrapx nwpage' }); v.appendChild(w);
    var lists = listsLive();
    w.appendChild(h('nav', { class: 'gcrumbs', 'aria-label': 'Breadcrumb' }, [h('a', { href: '/', text: 'Home' }), ' › '].concat(S.param ? [h('a', { href: '/lists', text: 'Lists' })] : ['Lists'])));
    if (!S.loaded || (!S.newsLive && !loadNews.failed)) { w.appendChild(h('div', { class: 'empty', text: 'Loading…' })); return; }
    if (S.param) {
      var p = lists.filter(function (x) { return x.slug === S.param; })[0];
      if (!p) {
        document.title = 'Not found | Reelscore'; setNoindex(true); setCanonical(null);
        w.appendChild(h('div', { class: 'empty' }, ['We couldn’t find this list. ', h('a', { href: '/lists', text: 'See all lists' })])); w.appendChild(footer()); return;
      }
      var items = listItems(p), up = String(p.updatedAt || p.publishedAt || '').slice(0, 10);
      setNoindex(items.filter(function (x) { return titleHasSubstance(x.m); }).length < 5); setCanonical('/lists/' + p.slug);
      document.title = (p.title + ' | Reelscore').length <= 60 ? p.title + ' | Reelscore' : p.title.length <= 65 ? p.title : p.title.slice(0, 64).replace(/\s+\S*$/, '') + '…'; // same as scripts/build.mjs
      var box = h('div', { class: 'lsw' }); w.appendChild(box);
      box.appendChild(h('h1', { class: 'nwh', style: 'font-family:Anton, "Anton Fallback", Impact, sans-serif;font-weight:400;font-size:clamp(34px,4.4vw,52px);letter-spacing:.5px;line-height:1.08;margin:0 0 10px', text: p.title }));
      if (p.summary) box.appendChild(h('p', { class: 'nwdek', text: p.summary }));
      box.appendChild(h('div', { class: 'note', style: 'margin-bottom:8px', text: ['By Reelscore', /^\d{4}-\d{2}-\d{2}$/.test(up) ? 'Updated ' + fmtDate(up, true) : '', items.length + (items.length === 1 ? ' title' : ' titles')].filter(Boolean).join(' · ') }));
      if (p.body) box.appendChild(h('div', { class: 'nwbody' }, newsBody(p.body)));
      var ol = h('ol', { style: 'list-style:none;padding:0;margin:8px 0 0' });
      items.forEach(function (x, i) {
        var m = x.m, d = m.data, pa = artLazy(m, 'poster'), sc = score(m.id), wh = listWhere(m);
        ol.appendChild(h('li', { class: 'lsi' }, [
          h('a', { class: 'lsp art', href: movieUrl(m), style: pa.style, 'data-bg': pa.bg, 'aria-label': d.title, tabindex: '-1' }, [safeUrl(d.posterUrl) ? null : h('span', { class: 'ptitle', 'aria-hidden': 'true', text: d.title })]),
          h('div', { class: 'lsb' }, [
            h('span', { class: 'lsn', 'aria-hidden': 'true', text: String(i + 1) }),
            h('h2', { style: 'margin:0;font-size:inherit' }, [h('a', { class: 'lst', href: movieUrl(m), text: d.title })]),
            h('span', { class: 'lsm', text: [isTv(m) ? 'TV' : '', (d.releaseDate || '').slice(0, 4), langOf(d), d.genre, d.runtime].filter(Boolean).join(' · ') }),
            wh ? h('span', { class: 'lsv' }, [/^On /.test(wh) ? platLogo(d.platform) : null, h('span', { text: wh })]) : null,
            x.note ? h('p', { class: 'lsnote' }, newsInline(x.note)) : null,
            shownPct(sc) != null ? h('span', { class: 'note', text: shownPct(sc) + '% of ' + sc.tot + ' Reelscore verdicts say watch it' }) : null
          ])
        ]));
      });
      box.appendChild(ol);
      var more = lists.filter(function (x) { return x !== p; }).slice(0, 4);
      if (more.length) w.appendChild(h('section', { class: 'nwmore', 'aria-labelledby': 'h-lsmore' }, [h('h2', { id: 'h-lsmore', text: 'More lists' }), h('div', { class: 'lshub' }, more.map(listCard))]));
      w.appendChild(footer());
      return;
    }
    setNoindex(!lists.length); setCanonical('/lists'); document.title = LISTS_TITLE;
    w.appendChild(h('h1', { class: 'display', style: 'margin:0 0 6px', text: 'Lists' }));
    w.appendChild(h('p', { class: 'note', style: 'margin:0 0 18px', text: 'Hand-picked lists of Indian films and series: what to stream by language, genre and platform, written by the Reelscore team.' }));
    w.appendChild(lists.length ? h('div', { class: 'lshub' }, lists.map(listCard)) : h('div', { class: 'empty', text: 'No lists yet. Check back soon.' }));
    w.appendChild(footer());
  }
  function listCard(p) {
    var items = listItems(p);
    return h('a', { class: 'lsc', href: '/lists/' + p.slug }, [
      h('span', { class: 'lscs', 'aria-hidden': 'true' }, items.slice(0, 4).map(function (x) { return h('span', { style: art(x.m, 'poster', 160) }); })),
      h('span', { class: 'lsct', text: p.title }),
      p.summary ? h('span', { class: 'note', text: p.summary }) : null,
      h('span', { class: 'note', text: items.length + ' titles' })
    ]);
  }
  // /about is a static page; navigating to it inside the app loads it in full.
  function drawAbout(id) { if (!$('view-' + (id || 'about')).querySelector('[data-prerendered]')) location.reload(); }
  // ---------- Ads rule (no ad code yet) ----------
  // Ads may only run on pages with real substance. The build marks every page that must stay ad-free with
  // <meta name="rs-ads" content="off"> (thin titles and anything kept out of Google, video pages and hubs, the site's own
  // pages). After in-app navigation the same rule is worked out here, the meta tag is kept in step, and body.noads hides
  // any ad already on screen. Any ad script added later must call window.reelAdsAllowed() first.
  var ADS_OFF_ROUTES = { video: 1, vids: 1, about: 1, privacy: 1, contact: 1, list: 1, tonight: 1, admin: 1, notfound: 1 };
  // The title a pre-built page arrived with (its canonical points at this address). Title pages keep it on first load,
  // so the app doesn't swap it for one worked out before verdicts have loaded.
  var builtHead = (function () { var c = document.querySelector('link[rel="canonical"]'), p = location.pathname.replace(/\/+$/, ''); try { return c && new URL(c.href).pathname.replace(/\/+$/, '') === p ? { path: p, title: document.title } : {}; } catch (e) { return {}; } })();
  var adsFirst = { path: location.pathname, off: !!document.querySelector('meta[name="rs-ads"][content="off"]') };
  function titleHasSubstance(m) {
    var d = m.data, syn = String(d.synopsis || '').trim().length;
    return !!(safeUrl(d.posterUrl) || (d.videos || []).some(function (v) { return v && /youtu/.test(v.url || ''); }) || String(d.platform || '').trim() ||
      safeUrl(d.platformUrl) || safeUrl(d.bookingUrl) || syn >= 200 || score(m.id).tot >= 3);
  }
  function adsAllowedHere() {
    if (location.pathname === adsFirst.path) return !adsFirst.off;
    if (ADS_OFF_ROUTES[S.route] || S.route === 'person') return false;
    if (S.route === 'title') { var m = S.loaded ? findMovie(S.param) : null; return !!(m && titleHasSubstance(m)); }
    return true;
  }
  function applyAdsRule() {
    var ok = adsAllowedHere(), el = document.querySelector('meta[name="rs-ads"]');
    document.body.classList.toggle('noads', !ok);
    if (!ok && !el) { el = document.createElement('meta'); el.name = 'rs-ads'; document.head.appendChild(el); }
    if (el) { if (ok) el.parentNode.removeChild(el); else el.content = 'off'; }
  }
  window.reelAdsAllowed = adsAllowedHere;
  // ---------- Contact form: messages go to Firestore "contact"; the admin panel lists them ----------
  var CONTACT_TOPICS = [['correction', 'A correction or missing information'], ['add', 'Add a title or person'], ['takedown', 'Takedown or copyright'],
    ['privacy', 'Privacy or my data'], ['partner', 'Partnership or business'], ['other', 'Something else']];
  function drawContact() {
    var v = $('view-contact'), slot = v.querySelector('#contactForm');
    if (!v.querySelector('[data-prerendered]') || !slot) { location.reload(); return; }
    if (slot.getAttribute('data-ready')) return;
    slot.setAttribute('data-ready', '1'); slot.innerHTML = '';
    var me = S.uid && S.user ? S.user : null;
    var topic = h('select', { id: 'cTopic', required: true }, [h('option', { value: '', text: 'Choose one' })].concat(CONTACT_TOPICS.map(function (t) { return h('option', { value: t[0], text: t[1] }); })));
    var name = h('input', { id: 'cName', type: 'text', maxlength: '80', autocomplete: 'name' });
    var email = h('input', { id: 'cEmail', type: 'email', required: true, maxlength: '120', autocomplete: 'email' });
    var page = h('input', { id: 'cPage', type: 'url', maxlength: '300', placeholder: 'https://reelscore-xi.vercel.app/movie/…' });
    var msg = h('textarea', { id: 'cMsg', required: true, maxlength: '2000', rows: '7' });
    var trap = h('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true', class: 'ctrap' });
    var count = h('span', { class: 'note', text: '0 / 2,000' });
    var out = h('p', { class: 'cout', role: 'status' });
    var send = h('button', { type: 'submit', class: 'btn primary', text: 'Send message' });
    msg.addEventListener('input', function () { count.textContent = msg.value.length.toLocaleString('en-IN') + ' / 2,000'; });
    var q = new URLSearchParams(location.search); if (q.get('topic') && CONTACT_TOPICS.some(function (t) { return t[0] === q.get('topic'); })) topic.value = q.get('topic');
    if (q.get('page') && /^https:\/\//.test(q.get('page'))) page.value = q.get('page').slice(0, 300);
    var field = function (id, label, input, hint) { return h('div', { class: 'cfield' }, [h('label', { for: id, text: label }), input, hint ? h('span', { class: 'note', text: hint }) : null]); };
    var form = h('form', { class: 'cform', novalidate: true }, [
      field('cTopic', 'What is it about?', topic),
      field('cName', 'Your name (optional)', name),
      field('cEmail', 'Your email', email, 'Only used to reply to you.'),
      field('cPage', 'Which page is it about? (optional)', page),
      h('div', { class: 'cfield' }, [h('label', { for: 'cMsg', text: 'Message' }), msg, count]),
      trap, h('div', { class: 'cact' }, [send]), out]);
    form.addEventListener('submit', function (e) {
      e.preventDefault(); out.className = 'cout';
      var problem = !topic.value ? [topic, 'Choose what your message is about.'] : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim()) ? [email, 'Enter an email address we can reply to.']
        : !msg.value.trim() ? [msg, 'Write your message.'] : (page.value.trim() && !/^https:\/\//.test(page.value.trim())) ? [page, 'Paste the page address starting with https://, or leave it empty.'] : null;
      if (problem) { out.className = 'cout err'; out.textContent = problem[1]; problem[0].focus(); return; }
      if (trap.value) { form.replaceWith(h('p', { class: 'cdone', text: 'Thanks, your message is on its way.' })); return; }
      send.disabled = true; send.textContent = 'Sending…';
      var body = { topic: topic.value, name: name.value.trim().slice(0, 80), email: email.value.trim().slice(0, 120), message: msg.value.trim().slice(0, 2000), page: page.value.trim().slice(0, 300), at: new Date().toISOString() };
      if (S.uid) body.uid = S.uid;
      var id = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      if (window.__reelStartFirebase) window.__reelStartFirebase();
      (S.db ? Promise.resolve(S.db) : window.claude.use('db')).then(function (db) {
        if (!db) throw new Error('offline');
        return db.doc('contact/' + id).set(body);
      }).then(function () {
        var done = h('div', { class: 'cdone', role: 'status' }, [h('b', { text: 'Thanks, your message is on its way.' }), ' We’ll reply to ' + body.email + '.']);
        form.replaceWith(done); done.setAttribute('tabindex', '-1'); done.focus();
      }).catch(function () {
        send.disabled = false; send.textContent = 'Send message';
        out.className = 'cout err'; out.textContent = 'Your message couldn’t be sent. Check your connection and try again.';
      });
    });
    slot.appendChild(form);
    if (me) { /* signed-in visitors: nothing extra is shown; the account ID is attached to the message */ }
  }
  function drawNotFound() {
    var v = $('view-home');
    if (v.querySelector('[data-prerendered]') && !S.nfDrawn) { S.nfDrawn = true; return; }
    v.innerHTML = '';
    v.appendChild(h('div', { class: 'wrapx' }, [h('div', { class: 'empty' }, ['This page doesn’t exist, or the title has moved. ', h('a', { href: '/', text: 'Go to the home page' }), ' · ', h('a', { href: '/browse', text: 'Browse all titles' })])]));
  }
  // ---------- OTT release dates: /ott-release-dates ----------
  // One entry per title with a known streaming start: a theatre film's OTT date (ottReleaseDate), a straight-to-OTT
  // film's release date, or a series premiere on a streaming service. "Expected" dates (Admin > Coming to OTT) give a
  // month and early / mid / late instead of a day. Same rules as scripts/build.mjs (ottEntry).
  var OTTD_TITLE = 'OTT Release Dates This Week: New Movies & Series | Reelscore';
  var OTT_SVC_RE = /netflix|prime video|amazon|hotstar|jiocinema|zee5|sony ?liv|\baha\b|sun ?nxt|mx player|hoichoi|\baltt\b|apple tv|manorama|lionsgate|chaupal|etv win|tentkotta|addatimes|klikk|tvf ?play|eros now|shemaroo|planet marathi|ultra jhakaas|koode|simply south|youtube/i;
  var OTT_COL = { netflix: '#E50914', 'prime-video': '#00A8E1', jiohotstar: '#1F80E0', zee5: '#8230C6', sonyliv: '#E8B10B', aha: '#FF6A00', 'sun-nxt': '#F2A900', 'mx-player': '#2A9DF4', hoichoi: '#E2231A', altt: '#C2185B', 'eros-now': '#D23B3B', youtube: '#FF0033', tvfplay: '#E53935' };
  var EXP_DAY = { early: '05', mid: '15', late: '25' };
  function isoDay(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || ''); }
  function addDays(iso, n) { var t = new Date(iso + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
  function daysBetween(a, b) { return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5); }
  function ottEntry(m) {
    var d = m.data, np = d.nowPlaying || '', p = String((!isTv(m) && (np === 'theatres' || d.section === 'In theatres' || d.section === 'Coming soon') && d.ottPlatform) || d.platform || d.ottPlatform || '').trim();
    var e = { m: m, plat: ottOf({ platform: p }), platName: ottName(ottOf({ platform: p })) || p, expected: '' };
    var ex = d.ottDateStatus === 'expected' && /^(\d{4}-\d{2})-(early|mid|late)$/.exec(d.ottExpected || '');
    if (isTv(m)) { if (!OTT_SVC_RE.test(p) || !isoDay(d.releaseDate)) return null; e.date = d.releaseDate; e.kind = 'series'; return e; }
    if (isoDay(d.ottReleaseDate) && d.ottDateStatus !== 'expected') { e.date = d.ottReleaseDate; e.kind = 'theatre'; return e; }
    if (ex) { e.date = ex[1] + '-' + EXP_DAY[ex[2]]; e.expected = ex[2]; e.kind = 'theatre'; return e; }
    if ((np === 'direct' || (d.section === 'On OTT' && !np)) && OTT_SVC_RE.test(p) && isoDay(d.releaseDate)) { e.date = d.releaseDate; e.kind = 'direct'; return e; }
    return null;
  }
  function expLabel(e) { var p = e.date.split('-'); return e.expected + '-' + MONTHS_FULL[+p[1] - 1]; }
  var MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var WDAY = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  function weekStart(iso) { var t = new Date(iso + 'T12:00:00Z'), w = (t.getUTCDay() + 6) % 7; return addDays(iso, -w); }
  // Every entry from 30 days back to 120 days ahead, and the theatre films with no OTT date yet.
  function ottDatesData() {
    var td = today(), from = addDays(td, -30), to = addDays(td, 120), out = [], tba = [];
    S.movies.forEach(function (m) {
      var e = ottEntry(m);
      if (e) { if (e.date >= from && e.date <= to) out.push(e); return; }
      var d = m.data;
      if (!isTv(m) && nowPlayingOf(d) === 'theatres' && isoDay(d.releaseDate) && d.releaseDate <= td && d.releaseDate >= addDays(td, -70)) tba.push(m);
    });
    out.sort(function (a, b) { return a.date.localeCompare(b.date) || (a.m.data.title || '').localeCompare(b.m.data.title || ''); });
    tba.sort(function (a, b) { return b.data.releaseDate.localeCompare(a.data.releaseDate) || (a.data.title || '').localeCompare(b.data.title || ''); });
    return { all: out, tba: tba };
  }
  // Home "Streaming this year": On OTT films by streaming date, newest first; ones with no known streaming date last.
  // Films that started in the last 30 days are left out (they are in Released recently on OTT), unless pinned in Admin.
  function streamingYearList() {
    var td = today(), from = addDays(td, -30), pins = rowPins('On OTT'), ago = new Date(); ago.setFullYear(ago.getFullYear() - 1);
    var yAgo = ago.toISOString().slice(0, 10), when = function (m) { return isTv(m) ? m.data.releaseDate : streamDate(m.data); };
    var recent = function (m) { var s = when(m); return pins.indexOf(m.id) === -1 && !!s && s >= from && s <= td; };
    // Series: premiered on a streaming service (not a TV channel) in the last 12 months.
    var series = S.movies.filter(function (m) { var e = isTv(m) && ottEntry(m); return e && e.date >= yAgo && e.date <= td; });
    var list = homeSection('On OTT').concat(series).filter(function (m) { return !recent(m); });
    list.sort(function (a, b) { return (when(b) || '0').localeCompare(when(a) || '0') || (a.data.title || '').localeCompare(b.data.title || ''); });
    return pinFirst(list, pins);
  }
  // See all from Streaming this year: Browse with every "Streaming on" service ticked (the ones any title is on).
  function allStreamingHref() {
    var on = {}; S.movies.forEach(function (m) { ottsOf(m.data).forEach(function (k) { on[k] = (on[k] || 0) + 1; }); });
    var keys = Object.keys(on).sort(function (a, b) { return on[b] - on[a] || a.localeCompare(b); });
    return keys.length ? browseHref({ ott: keys.join(',') }, 1) : '/browse';
  }
  // The older part of the catalogue can arrive after the row is drawn, so the link is refreshed just before it is used.
  function allStreamingLink() {
    var el = seeAll(allStreamingHref()), a = el.querySelector('a'), upd = function () { a.setAttribute('href', allStreamingHref()); };
    a.addEventListener('pointerdown', upd); a.addEventListener('focus', upd); a.addEventListener('mouseenter', upd);
    return el;
  }
  // Card line in Streaming this year: service, Series for shows, and the day it started streaming.
  function streamingYearMeta(m) {
    var d = m.data, s = isTv(m) ? d.releaseDate : streamDate(d), e = isTv(m) && ottEntry(m);
    return [(e && e.platName) || d.platform || 'OTT', isTv(m) ? 'Series' : '', s ? fmtDate(s) : ''].filter(Boolean).join(' · ');
  }
  // Home: what started streaming in the last 30 days, newest first (See all opens the OTT release dates page).
  function recentOttSection() {
    var td = today(), from = addDays(td, -30), list = [];
    S.movies.forEach(function (m) { var e = ottEntry(m); if (e && !e.expected && e.date <= td && e.date >= from) list.push(e); });
    if (list.length < 4) return null;
    list.sort(function (a, b) { return b.date.localeCompare(a.date) || (a.m.data.title || '').localeCompare(b.m.data.title || ''); });
    var when = {}; list.forEach(function (e) { when[e.m.id] = e; });
    return rowSection('Released recently on OTT', list.map(function (e) { return e.m; }), { max: HOME_MAX, ottNew: true, ottMeta: function (m) { var e = when[m.id]; return [e.platName || 'OTT', isTv(m) ? 'Series' : '', e.date === td ? 'Today' : fmtDate(e.date)].filter(Boolean).join(' · '); } }, seeAll('/ott-release-dates'));
  }
  function drawOttDates() {
    var v = $('view-ottdates');
    if (!S.loaded && v.querySelector('[data-prerendered]')) return;
    v.innerHTML = '';
    var F = S.ottd || (S.ottd = { plat: '', lang: '', kind: 'all', allTh: false });
    var td = today(), ws = weekStart(td), we = addDays(ws, 6), ns = addDays(ws, 7), ne = addDays(ws, 13);
    var page = h('div', { class: 'wrapx odpage' }), main = h('div', { class: 'odmain' }), rail = h('aside', { class: 'odrail', 'aria-label': 'More on OTT releases' });
    page.appendChild(main); v.appendChild(page);
    main.appendChild(h('nav', { class: 'gcrumbs', 'aria-label': 'Breadcrumb' }, [h('a', { href: '/', text: 'Home' }), ' › OTT release dates']));
    main.appendChild(h('h1', { class: 'odh1', text: 'OTT release dates: new movies and series this week' }));
    if (!S.loaded) { main.appendChild(h('p', { class: 'note', text: S.loadMsg || 'Loading…' })); return; }
    var D = ottDatesData(), all = D.all;
    var isFilm = function (m) { return !isTv(m); };
    var keep = function (m, plat) {
      if (F.kind === 'films' && !isFilm(m)) return false;
      if (F.kind === 'series' && isFilm(m)) return false;
      if (F.lang && langsOf(m.data).indexOf(F.lang) === -1) return false;
      if (plat !== undefined && F.plat && plat !== F.plat) return false;
      return true;
    };
    var list = all.filter(function (e) { return keep(e.m, e.plat); });
    var tba = D.tba.filter(function (m) { return keep(m) && !F.plat; });
    var upcoming = all.filter(function (e) { return e.date > td; });
    var svcNames = []; upcoming.concat(all).forEach(function (e) { var n = ottName(e.plat); if (n && svcNames.indexOf(n) === -1) svcNames.push(n); });
    var nUp = upcoming.length, nNew = all.filter(function (e) { return e.date >= ws; }).length;
    var intro = (nUp ? nUp + ' movies and series coming to ' : 'Movies and series new on ') + (svcNames.length ? listWords(svcNames.slice(0, 5)) + (svcNames.length > 5 ? ' and more' : '') : 'Netflix, Prime Video, JioHotstar and more') +
      ', with the day each one starts streaming, how long after the theatre release it comes, and the verdict once it’s out.';
    main.appendChild(h('p', { class: 'odintro', text: intro }));
    var hasExp = all.some(function (e) { return e.expected; });
    main.appendChild(h('div', { class: 'odupd' }, [h('span', { text: 'Updated ' + fmtDate(td, true) }), h('span', { text: '·' }), h('span', { text: 'Dates from official platform announcements' }),
      hasExp ? h('span', { class: 'ok', text: '● Confirmed' }) : null, hasExp ? h('span', { class: 'exp', text: '◌ Expected' }) : null]));

    // Groups: This week (with day headers), Next week, Later (months), Streaming now (the 30 days before this week),
    // then theatre films with no OTT date yet.
    var thisWeek = list.filter(function (e) { return e.date >= ws && e.date <= we && !e.expected; });
    var nextWeek = list.filter(function (e) { return e.date >= ns && e.date <= ne && !e.expected; });
    var later = list.filter(function (e) { return e.date > ne || (e.expected && e.date > we); });
    if (nextWeek.length && nextWeek.length < 3) { later = nextWeek.concat(later); nextWeek = []; }
    var recent = list.filter(function (e) { return e.date < ws && !e.expected; }).reverse();
    var monthsIn = function (l) { var ms = []; l.forEach(function (e) { var k = MONTHS_FULL[+e.date.slice(5, 7) - 1]; if (ms.indexOf(k) === -1) ms.push(k); }); return ms; };
    var lm = monthsIn(later), laterH = lm.length === 1 ? 'Later in ' + lm[0] : 'Coming later';
    var span = function (a, b) { var pa = a.split('-'), pb = b.split('-'); return WDAY[new Date(a + 'T12:00:00Z').getUTCDay()].charAt(0) + WDAY[new Date(a + 'T12:00:00Z').getUTCDay()].slice(1).toLowerCase() + ' ' + (+pa[2]) + (pa[1] === pb[1] ? '' : ' ' + MONTHS[+pa[1] - 1]) + ' – Sun ' + (+pb[2]) + ' ' + MONTHS[+pb[1] - 1]; };
    var n = function (k, one, many) { return k + ' ' + (k === 1 ? one : many); };
    var groups = [
      { id: 'od-week', h: 'This week', chip: 'This week', sub: span(ws, we) + ' · ' + n(thisWeek.length, 'title', 'titles'), items: thisWeek, days: true },
      { id: 'od-next', h: 'Next week', chip: 'Next week', sub: span(ns, ne) + ' · ' + n(nextWeek.length, 'title', 'titles'), items: nextWeek, days: true },
      { id: 'od-later', h: laterH, chip: lm.length === 1 ? lm[0] : 'Later', sub: n(later.length, 'title', 'titles') + ' so far', items: later, days: true },
      { id: 'od-now', h: 'Streaming now', chip: 'Streaming now', sub: 'Started in the last 30 days', items: recent, days: false },
      { id: 'od-tba', h: 'In theatres: OTT date not announced', chip: 'Not announced', sub: 'Tap the bell to hear the day it streams', items: tba, tba: true }
    ].filter(function (g) { return g.items.length; });

    // Jump bar (sticky on phones): scrolls to a group.
    var jump = h('div', { class: 'odjump', role: 'navigation', 'aria-label': 'Jump to' }, groups.map(function (g) {
      return h('button', { type: 'button', class: 'chip', text: g.chip + ' · ' + g.items.length, on: { click: function () { var el = $(g.id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } } });
    }));
    if (groups.length > 1) main.appendChild(jump);

    // Filters: platform, language, films or series. Chips only for what the page holds.
    var plats = {}, langs = {};
    all.forEach(function (e) { if (e.plat) plats[e.plat] = (plats[e.plat] || 0) + 1; var l = langOf(e.m.data); if (l) langs[l] = (langs[l] || 0) + 1; });
    D.tba.forEach(function (m) { var l = langOf(m.data); if (l) langs[l] = (langs[l] || 0) + 1; });
    var platKeys = OTTS.map(function (o) { return o[0]; }).filter(function (k) { return plats[k]; });
    if (F.plat && platKeys.indexOf(F.plat) === -1 && ottName(F.plat)) platKeys.push(F.plat);
    var langKeys = Object.keys(langs).filter(function (l) { return /^[A-Za-z]+$/.test(l); }).sort(function (a, b) { return langs[b] - langs[a] || a.localeCompare(b); }).slice(0, 8);
    if (F.lang && langKeys.indexOf(F.lang) === -1) langKeys.push(F.lang);
    var setF = function (k, val) { F[k] = val; var q = []; if (F.plat) q.push('ott=' + F.plat); if (F.lang) q.push('lang=' + encodeURIComponent(F.lang)); var u = '/ott-release-dates' + (q.length ? '?' + q.join('&') : ''); if (u !== location.pathname + location.search) history.replaceState(null, '', u); var y = window.scrollY; drawOttDates(); window.scrollTo(0, y); };
    var chip = function (label, on, click, dot) { return h('button', { type: 'button', class: 'chip', 'aria-pressed': String(on), on: { click: click } }, [dot ? h('i', { class: 'oddot', style: 'background:' + dot }) : null, label]); };
    var frow = function (label, kids, cls) { return h('div', { class: 'odfrow' + (cls ? ' ' + cls : '') }, [h('span', { class: 'odfl', text: label })].concat(kids)); };
    var filters = h('div', { class: 'odfilters' }, [
      platKeys.length > 1 ? frow('Platform', [chip('All', !F.plat, function () { setF('plat', ''); })].concat(platKeys.map(function (k) { return chip(ottName(k), F.plat === k, function () { setF('plat', F.plat === k ? '' : k); }, OTT_COL[k] || '#8E8899'); }))) : null,
      langKeys.length > 1 ? frow('Language', [chip('All', !F.lang, function () { setF('lang', ''); })].concat(langKeys.map(function (l) { return chip(l, F.lang === l, function () { setF('lang', F.lang === l ? '' : l); }); })), 'odlang') : null,
      frow('Show', [['all', 'All'], ['films', 'Films'], ['series', 'Series']].map(function (o) { return chip(o[1], F.kind === o[0], function () { setF('kind', o[0]); }); }), 'odkind')
    ]);
    var fbtn = h('button', { type: 'button', class: 'chip odfbtn', 'aria-expanded': 'false', text: 'Filters' + (F.lang || F.kind !== 'all' ? ' · on' : ''), on: { click: function () { var o = filters.classList.toggle('open'); fbtn.setAttribute('aria-expanded', String(o)); } } });
    main.appendChild(h('div', { class: 'odfwrap' }, [fbtn, filters]));

    var rowOf = function (x, g) {
      var e = x.m ? x : { m: x, tba: true }, m = e.m, d = m.data, t = d.title, sc = score(m.id), pct = shownPct(sc);
      var genre = String(d.genre || '').split(/,/).slice(0, 2).map(function (s) { return s.trim(); }).filter(Boolean).join(', ');
      var meta = [langOf(d), genre, isTv(m) ? 'Series' : 'Film'].filter(Boolean).join(' · ') + (g && g.id === 'od-now' ? ' · since ' + fmtDate(e.date) : '');
      var line = e.tba ? 'In theatres since ' + fmtDate(d.releaseDate) + ' · ' + n(daysBetween(d.releaseDate, td), 'day', 'days') + ' so far'
        : e.kind === 'theatre' ? (isoDay(d.releaseDate) ? 'In theatres ' + fmtDate(d.releaseDate) + (e.expected ? ' · expected ' + expLabel(e) : ' · on OTT ' + n(daysBetween(d.releaseDate, e.date), 'day', 'days') + ' later') : 'After its theatre run')
        : e.kind === 'direct' ? 'Straight to OTT' : 'Series premiere';
      var status = e.tba ? ['', 'Not announced'] : e.expected ? ['exp', '◌ Expected ' + expLabel(e)] : e.date <= td ? ['ok', '● Streaming now'] : ['ok', '● Confirmed'];
      var tp = e.tba && String(d.ottPlatform || '').trim(), tpk = tp ? ottOf({ platform: tp }) : '';
      var plat = e.tba ? (tp ? h('span', { class: 'odplat', style: 'border-left-color:' + (OTT_COL[tpk] || '#8E8899') }, [platLogo(tp), ottName(tpk) || tp]) : h('span', { class: 'odplat none', text: 'Platform not announced' })) : h('span', { class: 'odplat', style: 'border-left-color:' + (OTT_COL[e.plat] || '#8E8899') }, [platLogo(e.platName), e.platName || 'OTT']);
      var tr = vidItems(m).filter(function (x) { return x.cat === 'trailers' && (x.yt || x.clip); })[0] || null;
      var trB = h('button', { type: 'button', class: 'qb odtr' + (tr ? '' : ' off'), 'aria-label': tr ? 'Play the trailer of ' + t : 'No trailer for ' + t + ' yet', title: tr ? 'Trailer' : 'No trailer yet',
        on: { click: function () { if (tr) openTrailerOverlay(m, tr, trB, titleQueue(m, tr)); else toast('No trailer for ' + t + ' yet'); } } }, [icon('play', 18)]);
      var rem = hasReminder(m.id), future = e.tba || e.date > td;
      var bell = future ? h('button', { type: 'button', class: 'qb odbell' + (rem ? ' on' : ''), 'aria-pressed': String(rem), title: rem ? 'Reminder set' : 'Remind me when it streams',
        'aria-label': rem ? 'Reminder set for ' + t + '. Tap to turn it off' : 'Remind me when ' + t + ' streams', on: { click: function () { toggleRemind(m.id); } } }, [icon('bell', 18)]) : null;
      var pa = artLazy(m, 'poster', 120);
      return h('div', { class: 'odrow', 'data-id': m.id }, [
        h('a', { class: 'odpost art', href: movieUrl(m), style: pa.style, 'data-bg': pa.bg, 'aria-hidden': 'true', tabindex: '-1' }, pa.bg ? null : [h('span', { text: t })]),
        h('div', { class: 'odinfo' }, [
          h('a', { class: 'odt', href: movieUrl(m), text: t }),
          h('div', { class: 'odmeta', text: meta }),
          h('div', { class: 'odline', text: line }),
          h('div', { class: 'odpm' }, [plat.cloneNode(true), h('span', { class: 'odst ' + status[0], text: status[1] })])
        ]),
        h('div', { class: 'odpc' }, [plat, h('span', { class: 'odst ' + status[0], text: status[1] })]),
        h('div', { class: 'odact' }, [pct !== null ? h('span', { class: 'odsc', title: 'Reelscore', text: pct + '%' }) : null, trB, bell])
      ]);
    };
    var dayHead = function (iso) {
      var dt = new Date(iso + 'T12:00:00Z'), p = iso.split('-');
      return h('div', { class: 'odday' + (iso === td ? ' today' : ''), text: WDAY[dt.getUTCDay()] + ' ' + (+p[2]) + ' ' + MONTHS[+p[1] - 1].toUpperCase() + (iso === td ? ' · TODAY' : iso === addDays(td, 1) ? ' · TOMORROW' : '') });
    };
    if (!groups.length) main.appendChild(h('div', { class: 'empty', text: 'Nothing matches these filters yet. Try another platform or language.' }));
    groups.forEach(function (g) {
      var sec = h('section', { class: 'odgrp', id: g.id, 'aria-labelledby': g.id + '-h' }, [h('div', { class: 'odgh' }, [h('h2', { id: g.id + '-h', text: g.h }), h('span', { text: g.sub })])]);
      var items = g.items, last = '';
      if (g.tba && !F.allTh && items.length > 12) items = items.slice(0, 12);
      items.forEach(function (x) {
        if (g.days) { var key = x.expected ? 'x' + x.date : x.date; if (key !== last) { sec.appendChild(x.expected ? h('div', { class: 'odday', text: 'EXPECTED ' + expLabel(x).toUpperCase() }) : dayHead(x.date)); last = key; } }
        sec.appendChild(rowOf(x, g));
      });
      if (items.length < g.items.length) sec.appendChild(h('button', { type: 'button', class: 'btn small odmore', text: 'Show all ' + g.items.length, on: { click: function () { F.allTh = true; var y = window.scrollY; drawOttDates(); window.scrollTo(0, y); } } }));
      main.appendChild(sec);
    });
    main.appendChild(h('p', { class: 'note odfoot', text: 'Tap a title for its trailer, cast and where to watch. Tap the bell to get a reminder the day it streams.' }));

    // Common questions (same text as the pre-rendered page and its FAQ markup).
    var wkTitles = all.filter(function (e) { return e.date >= ws && e.date <= we && !e.expected; });
    var faq1 = wkTitles.length ? 'This week (' + (+ws.slice(8)) + (ws.slice(5, 7) === we.slice(5, 7) ? '' : ' ' + MONTHS[+ws.slice(5, 7) - 1]) + '–' + (+we.slice(8)) + ' ' + MONTHS[+we.slice(5, 7) - 1] + '): ' + listWords(wkTitles.slice(0, 6).map(function (e) { return e.m.data.title + (e.platName ? ' on ' + e.platName : ''); })) + (wkTitles.length > 6 ? ', and ' + (wkTitles.length - 6) + ' more' : '') + '. The list above updates every day.'
      : 'Nothing has a confirmed OTT date this week yet. The list above updates every day as platforms announce dates.';
    main.appendChild(h('section', { class: 'odfaq', 'aria-label': 'Common questions' }, [h('h2', { text: 'OTT release dates: common questions' }),
      h('div', { class: 'faq' }, [h('h3', { text: 'Which movies release on OTT this week?' }), h('p', { text: faq1 })]),
      h('div', { class: 'faq' }, [h('h3', { text: 'How long after the theatre release does a film come to OTT?' }), h('p', { text: 'It varies by film and platform deal. Each entry above shows the gap for that film, counted from its theatre release.' })]),
      h('div', { class: 'faq' }, [h('h3', { text: 'Where do these dates come from?' }), h('p', { text: 'From the platforms’ own announcements and official channels.' + (hasExp ? ' Dates marked “Expected” are not confirmed yet and change when the platform announces them.' : '') })])
    ]));

    // Right rail: most awaited (popularity: verdicts, then the cast's body of work), dates by platform, reminders.
    var waitL = D.tba.concat(upcoming.filter(function (e) { return !isTv(e.m); }).map(function (e) { return e.m; })), pop = popularityOf(waitL);
    waitL = waitL.filter(function (m, i) { return waitL.indexOf(m) === i; }).sort(function (a, b) { return pop[b.id] - pop[a.id]; }).slice(0, 5);
    var eOf = {}; all.forEach(function (e) { eOf[e.m.id] = e; });
    if (waitL.length >= 3) rail.appendChild(h('div', { class: 'odbox' }, [h('h3', { text: 'Most awaited on OTT' })].concat(waitL.map(function (m, i) {
      var e = eOf[m.id];
      return h('a', { class: 'odaw', href: movieUrl(m) }, [h('b', { text: String(i + 1) }), h('span', { text: m.data.title }), h('small', { text: e ? (e.platName || 'OTT') + ' · ' + (e.expected ? expLabel(e) : fmtDate(e.date)) : 'Date not announced' })]);
    }))));
    if (platKeys.length) rail.appendChild(h('div', { class: 'odbox' }, [h('h3', { text: 'Release dates by platform' })].concat(platKeys.map(function (k) {
      return h('a', { class: 'odpl', href: '/ott-release-dates?ott=' + k, 'aria-current': F.plat === k ? 'page' : null, on: { click: function (ev) { ev.preventDefault(); setF('plat', k); window.scrollTo(0, 0); } } }, [h('span', {}, [h('i', { class: 'oddot', style: 'background:' + (OTT_COL[k] || '#8E8899') }), ottName(k) + ' release dates']), h('small', { text: plats[k] + ' →' })]);
    }))));
    var nRem = (S.mine.reminders || []).length;
    rail.appendChild(h('div', { class: 'odbox' }, [h('h3', { text: 'Never miss a release' }), h('p', { text: 'Tap the bell on any title and it goes on your list with a reminder for the day it starts streaming.' }),
      S.uid ? h('a', { class: 'chip', href: '/my-list', 'aria-pressed': 'true', text: nRem ? n(nRem, 'reminder', 'reminders') + ' set · My List' : 'Your reminders · My List' })
        : h('button', { type: 'button', class: 'chip', 'aria-pressed': 'true', text: 'Sign in to set reminders', on: { click: function () { if (window.reelSignIn) window.reelSignIn(); else toast('Sign in to do that.'); } } })]));
    page.appendChild(rail);
    v.appendChild(footer());
  }
  function listWords(a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
  function drawVids() {
    var v = $('view-vids'), P = VID_PAGES[S.param];
    if (!S.loaded && v.querySelector('[data-prerendered]')) return;
    v.innerHTML = '';
    var w = h('section', { class: 'wrapx', style: 'padding-top:28px', 'aria-label': P.h }); v.appendChild(w);
    w.appendChild(h('nav', { class: 'gcrumbs', 'aria-label': 'Breadcrumb', style: 'margin-bottom:10px' }, [h('a', { href: '/', text: 'Home' }), ' › ', P.h]));
    var head = h('div', {}, [h('h1', { class: 'display', style: 'margin:0 0 6px', text: P.h })]);
    var bar = h('div', { style: 'display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:12px 24px;margin-bottom:18px' }, [head]);
    w.appendChild(bar);
    if (!S.loaded) { head.appendChild(h('p', { class: 'note', style: 'margin:0', text: 'Loading…' })); return; }
    var all = P.picks(true), langs = {};
    all.forEach(function (p) { var l = langOf(p.m.data); if (l) langs[l] = 1; });
    // Search: by song or video name, the film, singers and the film's cast and director; every word has to match.
    var fold = function (t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); };
    var hay = function (p) { var d = p.m.data; return fold([p.x.title, p.x.kind, p.x.artists, d.title, d.director, (d.cast || []).slice(0, 8).map(function (c) { return c.name; }).join(' ')].join(' ')); };
    var filtered = function () {
      var words = fold(S.vids.q).split(/\s+/).filter(Boolean);
      var out = all.filter(function (p) { return (!S.vids.lang || langOf(p.m.data) === S.vids.lang) && (!words.length || (function (t) { return words.every(function (wd) { return t.indexOf(wd) !== -1; }); })(hay(p))); });
      // Most viewed: YouTube views, highest first; songs without a count keep their place after the counted ones.
      if (S.vids.sort === 'views' && S.views) {
        var vw = function (p) { var n = S.views[p.x.yt]; return typeof n === 'number' ? n : -1; };
        out = out.map(function (p, i) { return [p, vw(p), i]; }).sort(function (a, b) { return b[1] - a[1] || a[2] - b[2]; }).map(function (x) { return x[0]; });
      }
      return out;
    };
    var allYt = S.param === 'songs' ? all.map(function (p) { return p.x.yt; }) : [];
    var allViews = false;
    // Most viewed needs every song's count: the same fixed 50-id batches as the page uses, 6 at a time, cached by the CDN.
    var wantAllViews = function () {
      var ids = allYt.filter(function (id, i) { return id && allYt.indexOf(id) === i; }), batches = [], left;
      for (var i = 0; i < ids.length; i += 50) batches.push(ids.slice(i, i + 50).join(','));
      S.views = S.views || {}; S.viewsAsked = S.viewsAsked || {};
      var todo = batches.filter(function (k) { return S.viewsAsked[k] !== 2; }); left = todo.length;
      if (!left) { allViews = true; list = filtered(); drawRes(); return; }
      var q = todo.slice(), finish = function () { left--; if (left > 0) { countEl.textContent = countText().replace('loading view counts…', 'loading view counts… ' + Math.round(100 * (todo.length - left) / todo.length) + '%'); return; } allViews = true; if (S.vids.sort === 'views' && res.isConnected) { list = filtered(); drawRes(); } };
      var pump = function () {
        var k = q.shift(); if (!k) return;
        S.viewsAsked[k] = 1;
        fetch('/api/views?ids=' + k).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
          if (j && j.counts) { Object.keys(j.counts).forEach(function (id) { S.views[id] = j.counts[id]; }); S.viewsAsked[k] = 2; }
        }).catch(function () {}).then(function () { finish(); pump(); });
      };
      for (var c = 0; c < 6; c++) pump();
    };
    var list = filtered(), countEl = h('p', { class: 'note', style: 'margin:0' }), res = h('div', {});
    var countText = function () { return list.length + ' ' + P.what + (S.vids.q.trim() ? ' matching “' + S.vids.q.trim() + '”' : '') + (S.vids.sort === 'views' ? (allViews ? ', most viewed first' : ' · loading view counts…') : S.vids.q.trim() ? '' : ', newest first'); };
    var drawRes = function () {
      res.innerHTML = ''; countEl.textContent = countText();
      var shown = Math.ceil(S.vids.n / 48) * gridPer(res, 'vgrid', 48); // whole rows: 48 a time, rounded to the grid's columns
      res.appendChild(h('div', { class: 'vgrid' }, list.slice(0, shown).map(function (p, i) { return P.card(p, i, list); }))); // the player's previous/next runs through the whole list
      if (list.length > shown) res.appendChild(h('div', { style: 'text-align:center;margin:24px 0' }, [h('button', { type: 'button', class: 'btn', text: 'Show more', on: { click: function () { S.vids.n += 48; drawRes(); } } })]));
      fillViews(res);
      if (S.param === 'songs') loadViews(allYt, list.slice(0, shown).map(function (p) { return p.x.yt; }), function () { if (res.isConnected) fillViews(res); });
      if (!list.length) res.appendChild(h('p', { class: 'note', text: S.vids.q.trim() ? 'No ' + P.what + ' match “' + S.vids.q.trim() + '”. Try a film, a singer or fewer words.' : 'Nothing here yet.' }));
    };
    head.appendChild(countEl);
    var what = S.param === 'songs' ? 'Search songs, films or singers' : S.param === 'trailers' ? 'Search trailers or films' : 'Search videos or shows';
    var qIn = h('input', { class: 'in', id: 'vQ', type: 'search', placeholder: what, autocomplete: 'off' }); qIn.value = S.vids.q;
    var tmr = null;
    qIn.addEventListener('input', function () { clearTimeout(tmr); tmr = setTimeout(function () { S.vids.q = qIn.value; S.vids.n = 48; list = filtered(); drawRes(); }, 150); });
    var tools = h('div', { class: 'vtools' }, [
      h('div', { class: 'field vq' }, [h('label', { class: 'l', for: 'vQ', text: 'Search' }), qIn])
    ]);
    bar.appendChild(tools);
    if (Object.keys(langs).length > 1) {
      var e = h('select', { class: 'in', id: 'vLang' }, [['', 'All languages']].concat(Object.keys(langs).sort().map(function (l) { return [l, l]; })).map(function (o) { return h('option', { value: o[0], text: o[1], selected: o[0] === S.vids.lang }); }));
      e.addEventListener('change', function () { S.vids.lang = e.value; S.vids.n = 48; e.blur(); list = filtered(); drawRes(); });
      tools.appendChild(h('div', { class: 'field vl' }, [h('label', { class: 'l', for: 'vLang', text: 'Language' }), e]));
    }
    if (S.param === 'songs') {
      var so = h('select', { class: 'in', id: 'vSort' }, [['', 'Latest'], ['views', 'Most viewed']].map(function (o) { return h('option', { value: o[0], text: o[1], selected: o[0] === S.vids.sort }); }));
      so.addEventListener('change', function () {
        S.vids.sort = so.value; S.vids.n = 48; so.blur();
        try { var u = new URL(location.href); if (so.value) u.searchParams.set('sort', so.value); else u.searchParams.delete('sort'); history.replaceState(history.state, '', u.pathname + u.search + u.hash); } catch (e) {}
        if (so.value === 'views') wantAllViews();
        list = filtered(); drawRes();
      });
      tools.appendChild(h('div', { class: 'field vs' }, [h('label', { class: 'l', for: 'vSort', text: 'Sort' }), so]));
    }
    w.appendChild(res); drawRes();
    if (S.vids.sort === 'views') wantAllViews();
  }

  // ---------- New TV promotionals: trailers, teasers, promos and full episodes of TV shows, played in the overlay ----------
  function tvPromoPicks(all) {
    var thisYear = String(new Date().getFullYear()), picks = [];
    var shows = homeSection('TV shows').slice().sort(function (a, b) {
      var aa = !a.data.endYear || String(a.data.endYear) >= thisYear ? 1 : 0, bb = !b.data.endYear || String(b.data.endYear) >= thisYear ? 1 : 0;
      return bb - aa || (b.data.releaseDate || '').localeCompare(a.data.releaseDate || '');
    });
    shows.forEach(function (m) { var vs = vidItems(m).filter(function (x) { return (x.yt || x.clip) && x.cat !== 'extras' && x.cat !== 'interviews'; }); (all ? vs : vs.slice(0, 2)).forEach(function (x) { picks.push({ m: m, x: x }); }); });
    return pinPicks(picks, rowPins('tvpromos'));
  }
  function tvPromoCard(p, i, arr) {
    var m = p.m, d = m.data;
    var th = p.x.yt ? h('img', { src: 'https://i.ytimg.com/vi/' + p.x.yt + '/hqdefault.jpg', alt: '', width: 480, height: 360, loading: 'lazy' }) : h('span', { class: 'ph', style: artLazy(m, 'banner', 640).style, 'data-bg': artLazy(m, 'banner', 640).bg });
    return h('a', { class: 'tcard', href: videoUrl(m, p.x.yt) || movieUrl(m), 'aria-label': 'Play ' + d.title + ': ' + p.x.title, on: { click: function (e) {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault(); e.stopPropagation();
      openTrailerOverlay(m, p.x, e.currentTarget, arr ? { list: arr, i: i } : null);
    } } }, [
      h('span', { class: 'th' }, [th, h('span', { class: 'kb', text: String(p.x.kind).toUpperCase() }), h('span', { class: 'pb', 'aria-hidden': 'true', text: '▶' })]),
      h('span', { class: 'tt', text: d.title }),
      h('span', { class: 'note', text: [p.x.title, d.platform].filter(Boolean).join(' · ') })
    ]);
  }
  function tvPromoSection() {
    var picks = tvPromoPicks(false).slice(0, 20);
    if (!picks.length) return null;
    return h('section', { class: 'sect', 'aria-label': 'New TV promotionals' }, [
      h('div', { class: 'sect-h' }, [h('h2', { text: 'New TV promotionals' }), showAll('/tv-promos')]),
      h('div', { class: 'rowx' }, picks.map(tvPromoCard))
    ]);
  }

  // ---------- year landing pages: /year/<yyyy> ----------
  // Same as the pre-rendered year pages (scripts/build.mjs).
  function yearTitle(y) { return 'Indian Movies of ' + y + ' | Reelscore'; }
  var YEAR_COL = [['#1F5F86', '#2E86AB'], ['#5B2A86', '#7B3FB0'], ['#8A2650', '#B3406E'], ['#2F6B3A', '#4C8F45'], ['#7A4A12', '#A8661E'], ['#1F6E6A', '#2E918B'], ['#22306E', '#3A4BA0'], ['#5A1A1F', '#8A2A30'], ['#3D4A2A', '#5B6B3C'], ['#2B2F3D', '#4A5068']];
  function yearCol(y) { return YEAR_COL[((+y % 10) + 10) % 10]; }
  // Popularity: verdicts first, then how established the lead cast is (titles they appear in across the catalogue).
  function popularityOf(list) {
    var credits = {};
    S.movies.forEach(function (m) { (m.data.cast || []).forEach(function (c) { var k = personSlug(c.name); if (k) credits[k] = (credits[k] || 0) + 1; }); });
    var pop = {};
    list.forEach(function (m) {
      var sc = score(m.id), star = 0;
      (m.data.cast || []).filter(function (c) { return !CREW_RE.test(c.role || ''); }).slice(0, 4).forEach(function (c) { star += credits[personSlug(c.name)] || 0; });
      pop[m.id] = sc.tot * 1000 + star + (safeUrl(m.data.posterUrl) ? 5 : 0);
    });
    return pop;
  }
  function yearHref(Y, page) {
    var q = []; if (Y.lang) q.push('lang=' + encodeURIComponent(Y.lang)); if (page > 1) q.push('page=' + page);
    return '/year/' + Y.year + (q.length ? '?' + q.join('&') : '');
  }
  function yearMovies(y) { return S.movies.filter(function (m) { return !isTv(m) && (m.data.releaseDate || '').slice(0, 4) === y; }); }
  function drawYear() {
    var v = $('view-year');
    if (!S.loaded && v.querySelector('[data-prerendered]')) return;
    v.innerHTML = '';
    var Y = S.yr, y = Y.year, c = yearCol(y), all = yearMovies(y), now = new Date().getFullYear();
    v.appendChild(h('section', { class: 'ghero', style: '--g1:' + c[0] + ';--g2:' + c[1] }, [
      h('nav', { class: 'gcrumbs', 'aria-label': 'Breadcrumb' }, [h('a', { href: '/', text: 'Home' }), ' › ', h('a', { href: '/browse', text: 'Browse' }), ' › ', y]),
      h('h1', { class: 'display', text: y }),
      h('p', { text: S.loaded ? all.length.toLocaleString('en-IN') + ' Bollywood and regional movies ' + (+y > now ? 'due in ' : 'released in ') + y + ', most popular first.' : 'Loading…' })
    ]));
    var yrs = []; for (var k = now + (S.movies.some(function (m) { return (m.data.releaseDate || '').slice(0, 4) === String(now + 1); }) ? 1 : 0); k >= now - 9; k--) yrs.push(String(k));
    v.appendChild(h('nav', { class: 'gnav', 'aria-label': 'Other years' }, yrs.map(function (x) {
      return h('a', { class: 'chip', href: '/year/' + x, 'aria-current': x === y ? 'page' : null, 'aria-pressed': String(x === y), text: x });
    }).concat([h('a', { class: 'chip', href: '/browse/movies', text: 'All movies' })])));
    if (!S.loaded) return;
    var w = h('section', { class: 'wrapx', style: 'padding-top:18px', 'aria-label': 'Movies of ' + y }); v.appendChild(w);
    var langs = {}; all.forEach(function (m) { var l = langOf(m.data); if (l) langs[l] = 1; });
    var e = h('select', { class: 'in', id: 'yLang' }, [['', 'All languages']].concat(Object.keys(langs).sort().map(function (l) { return [l, l]; })).map(function (o) { return h('option', { value: o[0], text: o[1], selected: o[0] === Y.lang }); }));
    e.addEventListener('change', function () { Y.lang = e.value; Y.page = 1; e.blur(); render(true); });
    w.appendChild(h('div', { style: 'display:flex;flex-wrap:wrap;gap:12px;margin-bottom:18px' }, [h('div', { class: 'field', style: 'min-width:160px;flex:0 1 220px' }, [h('label', { class: 'l', for: 'yLang', text: 'Language' }), e])]));
    var list = all.filter(function (m) { return !Y.lang || langOf(m.data) === Y.lang; });
    var pop = popularityOf(list);
    list.sort(function (a, b) { return pop[b.id] - pop[a.id] || (b.data.releaseDate || '').localeCompare(a.data.releaseDate || '') || (a.data.title || '').localeCompare(b.data.title || ''); });
    if (!list.length) { w.appendChild(h('div', { class: 'empty', text: 'No movies from ' + y + ' here yet.' })); v.appendChild(footer()); return; }
    var PER = gridPer(w), pages = Math.ceil(list.length / PER); Y.page = Math.min(Math.max(1, Y.page || 1), pages);
    syncListUrl(yearHref(Y, Y.page));
    var from = (Y.page - 1) * PER;
    w.appendChild(h('div', { class: 'sub', style: 'margin-bottom:14px', text: list.length > PER ? 'Showing ' + (from + 1) + '–' + Math.min(from + PER, list.length) + ' of ' + list.length.toLocaleString('en-IN') + ' movies' : list.length + (list.length === 1 ? ' movie' : ' movies') }));
    w.appendChild(h('div', { class: 'grid-posters' }, list.slice(from, from + PER).map(function (m) { return posterCard(m, m.data.section === 'Coming soon' ? { dateBadge: true, upIcons: true } : null); })));
    if (pages > 1) w.appendChild(pagerNav(Y.page, pages, function (n) { return yearHref(Y, n); }));
    v.appendChild(footer());
  }
  function yearSection() {
    var now = new Date().getFullYear(), tiles = [];
    var st = S.partial && window.RS_STATS ? window.RS_STATS.year : null; // whole-catalogue counts until the older part loads
    for (var k = now; k > now - 10; k--) { var n = st ? st[k] || 0 : yearMovies(String(k)).length; if (n) tiles.push([String(k), n]); }
    if (tiles.length < 3) return null;
    return h('section', { class: 'sect', 'aria-label': 'Years' }, [
      h('div', { class: 'sect-h' }, [h('h2', { text: 'Movies by year' }), h('span', { class: 'sub' }, [h('a', { href: '/browse/movies', text: 'All movies' })])]),
      h('div', { class: 'rowx gtiles' }, tiles.map(function (x) {
        var c = yearCol(x[0]);
        return h('a', { class: 'gtile ytile', href: '/year/' + x[0], style: '--g1:' + c[0] + ';--g2:' + c[1], 'aria-label': x[0] + ', ' + x[1] + ' movies' }, [
          h('span', { class: 'gn', text: x[0] }), h('span', { class: 'gc', 'aria-hidden': 'true', text: x[1] + ' movies' })
        ]);
      }))
    ]);
  }

  // Language tiles on the home page; each opens that language's landing page (/hindi-movies etc.).
  var LANG_TILES = [['English', 'English', '#2B4C7E', '#3F6BAE'], ['Hindi', 'हिन्दी', '#B4532A', '#D9773F'], ['Tamil', 'தமிழ்', '#7A1F3D', '#A8325A'], ['Telugu', 'తెలుగు', '#2F6B3A', '#4C8F45'],
    ['Bengali', 'বাংলা', '#6A4A2E', '#8C6A48'], ['Kannada', 'ಕನ್ನಡ', '#8A6A12', '#B8901E'], ['Marathi', 'मराठी', '#5B2A86', '#7B3FB0'], ['Malayalam', 'മലയാളം', '#1F5F6B', '#2E8794']];
  function langSection() {
    var st = S.partial && window.RS_STATS ? window.RS_STATS.lang : null, cnt = {};
    if (!st) S.movies.forEach(function (m) { if (!isTv(m)) { var l = langOf(m.data); cnt[l] = (cnt[l] || 0) + 1; } });
    var tiles = LANG_TILES.map(function (x) { return x.concat([(st || cnt)[x[0]] || 0]); }).filter(function (x) { return x[4] >= 5; });
    if (tiles.length < 3) return null;
    return h('section', { class: 'sect', 'aria-label': 'Languages' }, [
      h('div', { class: 'sect-h' }, [h('h2', { text: 'Movies by language' }), h('span', { class: 'sub' }, [h('a', { href: '/browse', text: 'Browse all' })])]),
      h('div', { class: 'rowx gtiles' }, tiles.map(function (x) {
        return h('a', { class: 'gtile ltile', href: '/' + x[0].toLowerCase() + '-movies', style: '--g1:' + x[2] + ';--g2:' + x[3], 'aria-label': x[0] + ' movies, ' + x[4].toLocaleString('en-IN') },
          [h('span', { class: 'gnat', 'aria-hidden': 'true', text: x[0] === 'English' ? 'Aa' : x[1] }), h('span', { class: 'gn', text: x[0] }), h('span', { class: 'gc', 'aria-hidden': 'true', text: x[4].toLocaleString('en-IN') + ' movies' })]);
      }))
    ]);
  }
  // Genre tiles on the home page; each opens Browse filtered to that genre (and the nav language, if set).
  var GENRE_COL = { Action: ['#1F5F86', '#2E86AB'], Comedy: ['#5B2A86', '#7B3FB0'], Drama: ['#6A4A2E', '#8C6A48'], Thriller: ['#2B2F3D', '#4A5068'], Horror: ['#5A1A1F', '#8A2A30'], Romance: ['#8A2650', '#B3406E'], Family: ['#2F6B3A', '#4C8F45'], Animated: ['#1F6E6A', '#2E918B'], Biopic: ['#7A4A12', '#A8661E'], Mythological: ['#6B3A10', '#9A5A18'], War: ['#3D4A2A', '#5B6B3C'], 'Sci-fi': ['#22306E', '#3A4BA0'] };
  function genreSection() {
    var tiles = GENRES.map(function (g) {
      var n = S.movies.filter(function (m) { return genreTags(m.data).indexOf(g) !== -1; }).length;
      return [g, n];
    }).filter(function (x) { return x[1] >= 3; });
    if (tiles.length < 3) return null;
    return h('section', { class: 'sect', 'aria-label': 'Genres' }, [
      h('div', { class: 'sect-h' }, [h('h2', { text: 'Genres' }), h('span', { class: 'sub' }, [h('a', { href: '/browse', text: 'Browse all' })])]),
      h('div', { class: 'rowx gtiles' }, tiles.map(function (x) {
        var c = GENRE_COL[x[0]] || ['#2B2F3D', '#4A5068'];
        return h('a', { class: 'gtile', href: genreUrl(x[0]), style: '--g1:' + c[0] + ';--g2:' + c[1], 'aria-label': x[0] + ', ' + x[1] + ' titles' }, [
          h('span', { class: 'gn', text: x[0] }), h('span', { class: 'gc', 'aria-hidden': 'true', text: x[1] + ' titles' })
        ]);
      }))
    ]);
  }
  var LANG_AB = { hindi: 'Hin', english: 'Eng', telugu: 'Tel', tamil: 'Tam', kannada: 'Kan', malayalam: 'Mal', bengali: 'Ben', marathi: 'Mar', punjabi: 'Pun' };
  function langShort(d) {
    var out = [];
    (d.languages || '').split(/[,;]| dubbed in | and /i).forEach(function (p) {
      var k = p.trim().toLowerCase().replace(/^dubbed in\s*/, ''); if (LANG_AB[k] && out.indexOf(LANG_AB[k]) === -1) out.push(LANG_AB[k]);
    });
    return out;
  }
  function rankIn(m) {
    // Only titles whose score is shown (MIN_SHOW verdicts or more) are ranked, so one early verdict can't make a "TOP #1".
    var list = sectionOf(m.data.section).map(function (x) { return { id: x.id, s: score(x.id) }; }).filter(function (x) { return shownPct(x.s) !== null; });
    list.sort(function (a, b) { return b.s.pct - a.s.pct || b.s.tot - a.s.tot; });
    for (var i = 0; i < list.length; i++) if (list[i].id === m.id) return i + 1;
    return 0;
  }
  // Banner line: the admin's one-line hook, else the synopsis's first sentence (the full synopsis belongs on the title page).
  function heroLine(d) {
    var hk = String(d.hook || '').trim();
    if (hk) return hk;
    var syn = String(d.synopsis || '').trim();
    if (!syn) return '';
    var m = syn.match(/^.{20,}?[.!?](?=\s|$)/);
    var first = m ? m[0] : syn;
    return first.length > 160 ? first.slice(0, 157).replace(/\s+\S*$/, '') + '…' : first;
  }
  function drawHero() {
    var box = $(S.heroBoxId || 'heroBox'); if (!box || !S.feat || !S.feat.length) return;
    var feat = S.feat; if (S.slide >= feat.length) S.slide = 0;
    var m = feat[S.slide], d = m.data, sc = score(m.id);
    var songs = S.heroCtx === 'movies', pick = S.heroCtx === 'tvshows' ? heroPicked(m) : null, clip = songs || pick ? null : safeUrl(d.trailerFileUrl), yt = clip ? null : songs ? heroSong(m) : pick || heroYt(m), playing = !!(S.play && S.play.id === m.id && (clip || yt));
    var pv = S.play && S.play.id === m.id && S.play.vid ? vidItems(m).filter(function (x) { return x.yt && x.url === S.play.vid; })[0] : null;
    if (pv) { clip = null; yt = pv; playing = true; }
    var news = heroNews(m);
    if (playing && S.heroNode && S.heroNode._mid === m.id) {
      box.innerHTML = ''; box.appendChild(S.heroNode);
      if (!S.play.paused && S.heroVideo) safePlay(S.heroVideo);
      return;
    }
    var metaBits = [isTv(m) ? 'TV show' + (d.platform ? ' · ' + d.platform : '') : isOtt(m) ? 'Film · ' + (d.platform || 'OTT') : 'Film', (d.genre || '').split(/,| /)[0] ? d.genre.split(',')[0] : null, d.releaseDate ? d.releaseDate.slice(0, 4) : null, d.runtime || null];
    var meta = h('div', { class: 'meta' });
    metaBits.filter(Boolean).forEach(function (t, i) { if (i) meta.appendChild(h('i', { 'aria-hidden': 'true' })); meta.appendChild(h('span', { text: t })); });
    if (d.certificate) { meta.appendChild(h('i', { 'aria-hidden': 'true' })); meta.appendChild(h('span', { class: 'cert', text: d.certificate })); }
    var v = firstVideo(m), on = inList(m.id);
    var langs = langShort(d), rk = rankIn(m);
    var secName = { 'In theatres': 'in Theatres', 'On OTT': 'on OTT', 'Coming soon': 'Coming soon', 'Older releases': 'in Older releases', 'TV shows': 'in TV shows' }[d.section] || '';
    var chips = [];
    if (langs.length) chips.push(h('span', { class: 'hc', title: 'Languages' }, [icon('lang', 18), 'In ' + langs.join(', ')]));
    if (rk && rk <= 10) chips.push(h('span', { class: 'hc' }, [h('b', { text: 'TOP' }), '#' + rk + ' ' + secName]));
    else if (shownPct(sc) !== null) chips.push(h('span', { class: 'hc' }, [h('b', { text: sc.pct + '%' }), sc.tot + (sc.tot === 1 ? ' verdict' : ' verdicts')]));
    else chips.push(h('span', { class: 'hc' }, [statusLabel(m)]));
    var video = null;
    if (playing && yt) {
      // YouTube trailer plays right here in the banner; YouTube's own controls handle pause, sound and fullscreen.
      video = h('iframe', { class: 'fv', src: 'https://www.youtube-nocookie.com/embed/' + yt.yt + '?autoplay=1&rel=0&playsinline=1&modestbranding=1', title: d.title + ' · ' + yt.title,
        allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin' });
    } else if (playing) {
      video = h('video', { class: 'fv', src: clip, autoplay: true, playsinline: true, preload: 'auto' });
      video.muted = !!S.play.muted;
      video.setAttribute('aria-label', d.title + ' trailer');
      video.addEventListener('ended', stopTrailer);
      video.addEventListener('timeupdate', function () { var p = document.getElementById('vProg'); if (p && video.duration) p.style.width = (100 * video.currentTime / video.duration) + '%'; });
      video.addEventListener('error', function () { toast('This clip couldn’t play.'); stopTrailer(); });
    }
    // With a tag, the main button does what the tag says: Book tickets, or play that new trailer or song.
    var newsBtns = null;
    if (news && !playing) {
      var nMain = news.btn === 'book' && btnOn(btnPlace(), 'book') ? bookBtn(m, 'pill play') : news.vid ? h('button', { type: 'button', class: 'pill play', on: { click: function () { startTrailer(m.id, news.vid.url); } } }, [icon(news.vid.cat === 'songs' ? 'music' : 'play', 18), news.btnText]) : null;
      if (nMain) {
        var tv = heroYt(m), second = news.kind !== 'trailer' && tv && tv.yt && (!news.vid || tv.url !== news.vid.url)
          ? h('button', { type: 'button', class: 'pill info', on: { click: function () { startTrailer(m.id, tv.url); } } }, [h('span', { 'aria-hidden': 'true', text: '▶ ' }), vidWord(tv) === 'video' ? 'Video' : heroVidLabel(tv)])
          : h('a', { class: 'pill info', href: movieUrl(m), text: 'View details' });
        newsBtns = [nMain, second, h('button', { type: 'button', class: 'roundadd', 'data-list': m.id, 'aria-pressed': String(on), 'aria-label': on ? 'Remove ' + d.title + ' from my watchlist' : 'Add ' + d.title + ' to my watchlist', title: on ? 'In my watchlist' : 'Add to my watchlist', text: on ? '✓' : '+',
          on: { click: function () { toggleList(m.id); } } })];
      }
    }
    var hero = h('section', { class: 'fh' + (S.heroCtx && S.heroCtx !== 'home' ? ' tvh' : '') + (playing ? ' playing' : '') + (playing && yt ? ' yt' : ''), style: heroArt(m, yt), 'aria-roledescription': 'carousel', 'aria-label': 'Featured: ' + d.title,
      on: { mouseenter: function () { S.heroPause = true; }, mouseleave: function () { S.heroPause = false; }, focusin: function () { S.heroPause = true; }, focusout: function () { S.heroPause = false; } } }, [
      video,
      h('div', { class: 'scrim' }),
      playing ? h('button', { type: 'button', class: 'vclose', 'aria-label': 'Close trailer', text: '×', on: { click: stopTrailer } }) : null,
      playing ? h('div', { class: 'vprog', 'aria-hidden': 'true' }, [h('span', { id: 'vProg' })]) : null,
      h('div', { class: 'fb' }, [
        news && !playing ? h('div', { class: 'ftag' }, [h('span', { class: 'ftag-p' }, [icon(news.icon, 15), news.label]), news.sub ? h('span', { class: 'ftag-s', text: news.sub }) : null]) : null,
        h(S.heroCtx && S.heroCtx !== 'home' ? 'h2' : 'h1', { class: 'logo' + (String(d.title || '').length > 28 ? ' long' : String(d.title || '').length > 16 ? ' mid' : '') }, [newsBtns ? h('a', { href: movieUrl(m), text: d.title }) : d.title]),
        meta,
        songs && yt && yt.cat === 'songs' && !/^(official )?(video )?song$/i.test(String(yt.title || '').trim()) ? h('div', { class: 'songl' }, [h('span', { 'aria-hidden': 'true', text: '♪ ' }), yt.title]) : null,
        heroLine(d) ? h('p', { class: 'syn', text: heroLine(d) }) : null,
        newsBtns ? h('div', { class: 'btns' }, newsBtns) : h('div', { class: 'btns' }, [
          playing ? h('button', { type: 'button', class: 'pill play', id: 'vPlay', on: { click: togglePause } }, ['❚❚  Pause'])
            : clip ? h('button', { type: 'button', class: 'pill play', on: { click: function () { startTrailer(m.id); } } }, [h('span', { 'aria-hidden': 'true', text: '▶' }), 'Trailer'])
            : yt ? h('button', { type: 'button', class: 'pill play', on: { click: function () { startTrailer(m.id); } } }, [h('span', { 'aria-hidden': 'true', text: '▶' }), S.heroCtx && S.heroCtx !== 'home' ? heroVidLabel(yt) : 'Trailer'])
            : h('a', { class: 'pill play', href: movieUrl(m) }, [h('span', { 'aria-hidden': 'true', text: '▶' }), 'Trailer']),
          h('a', { class: 'pill info', href: movieUrl(m), text: 'View details' }),
          playing && !yt ? h('button', { type: 'button', class: 'roundadd', id: 'vMute', 'aria-label': S.play.muted ? 'Unmute' : 'Mute', text: S.play.muted ? '🔇' : '🔊', on: { click: toggleMute } }) : null,
          playing ? null : h('button', { type: 'button', class: 'roundadd', 'data-list': m.id, 'aria-pressed': String(on), 'aria-label': on ? 'Remove ' + d.title + ' from my watchlist' : 'Add ' + d.title + ' to my watchlist', title: on ? 'In my watchlist' : 'Add to my watchlist', text: on ? '✓' : '+',
            on: { click: function () { toggleList(m.id); } } })
        ])
      ]),
      chips.length ? h('div', { class: 'chipsr' }, chips) : null,
      feat.length > 1 ? h('div', { class: 'fdots', role: 'group', 'aria-label': 'Featured titles' }, feat.map(function (f, i) {
        return h('button', { type: 'button', 'aria-label': 'Show ' + f.data.title, 'aria-current': String(i === S.slide), on: { click: function () { if (S.play) stopTrailer(); S.slide = i; drawHero(); } } }, [h('span')]);
      })) : null
    ]);
    hero._mid = m.id;
    S.heroNode = playing ? hero : null; S.heroVideo = video;
    box.innerHTML = ''; box.appendChild(hero);
    if (video && !yt) safePlay(video, function () { video.muted = true; S.play.muted = true; safePlay(video); var b = document.getElementById('vMute'); if (b) { b.textContent = '🔇'; b.setAttribute('aria-label', 'Unmute'); } });
  }
  // The banner is drawn on Home and on TV Shows; each keeps its own slide, and a playing video stops on leaving its page.
  function setHeroCtx(ctx, feat, boxId) {
    if (S.heroCtx !== ctx) {
      S.slideBy = S.slideBy || {}; S.slideBy[S.heroCtx || 'home'] = S.slide || 0;
      if (S.play) leaveHero();
      S.slide = S.slideBy[ctx] || 0; S.heroCtx = ctx;
    }
    S.feat = feat; S.heroBoxId = boxId;
  }
  // Stop a playing banner video and empty its box, so a YouTube player in a page that is no longer shown stops too.
  // Leaving a page stops its trailer or song: YouTube players in hidden pages are removed and sound-on clips paused,
  // and the title and video pages forget what was playing, so going back shows the video ready to play again.
  function stopHiddenMedia() {
    if (S.route !== 'title' && (S.vplay || S.vKeep)) { if (S.vKeep && S.vKeep.parentNode) S.vKeep.parentNode.removeChild(S.vKeep); S.vplay = null; S.vKeep = null; S.vIdle = null; }
    if (S.route !== 'video') S.vpKey = null;
    document.querySelectorAll('.view').forEach(function (v) {
      if (getComputedStyle(v).display !== 'none') return;
      v.querySelectorAll('iframe').forEach(function (f) { if (/youtube/.test(f.src || '')) f.remove(); });
      v.querySelectorAll('video').forEach(function (x) { if (!x.muted && !x.paused) try { x.pause(); } catch (e) {} });
    });
  }
  function leaveHero() {
    try { S.heroVideo && S.heroVideo.pause && S.heroVideo.pause(); } catch (e) {}
    var b = S.heroNode && S.heroNode.parentNode; if (b) b.innerHTML = '';
    S.play = null; S.heroNode = null; S.heroVideo = null;
  }
  // What the TV Shows banner's play button says: the kind of video it plays.
  function heroVidLabel(x) {
    var k = String(x.kind || '').toLowerCase();
    if (x.cat === 'songs') return /soundtrack|score|bgm|\bost\b|theme/.test(k) ? 'Soundtrack' : 'Song';
    return /teaser/.test(k) ? 'Teaser' : /trailer/.test(k) ? 'Trailer' : /promo|precap|glimpse/.test(k) ? 'Promo' : /episode/.test(k) ? 'Episode' : /clip/.test(k) ? 'Clip' : x.cat === 'trailers' ? 'Trailer' : 'Play video';
  }
  // TV Shows banner: shows with a banner image and a video. Pinned TV promotionals (Admin > Home rows) first, then shows
  // still running, then those whose newest video is most recent. At most 8.
  function tvHeroPicks() {
    // Shows chosen in Admin > TV Shows banner, in that order; with none, the automatic pick below.
    var chosen = (S.tvFeatured || []).map(function (id) { return S.byId[id]; }).filter(function (m) { return m && isTv(m); });
    if (chosen.length) return chosen;
    var pins = rowPins('tvpromos'), thisYear = String(new Date().getFullYear());
    var newest = function (m) { return (m.data.videos || []).reduce(function (a, x) { var t = String(x.publishedAt || x.addedAt || ''); return t > a ? t : a; }, ''); };
    var list = homeSection('TV shows').filter(function (m) { return safeUrl(m.data.bannerUrl) && (safeUrl(m.data.trailerFileUrl) || heroYt(m)); });
    var nv = {}; list.forEach(function (m) { nv[m.id] = newest(m); });
    list.sort(function (a, b) {
      var pa = pins.indexOf(a.id), pb = pins.indexOf(b.id);
      if (pa !== -1 || pb !== -1) return (pa === -1 ? 1e9 : pa) - (pb === -1 ? 1e9 : pb);
      var ra = !a.data.endYear || String(a.data.endYear) >= thisYear ? 1 : 0, rb = !b.data.endYear || String(b.data.endYear) >= thisYear ? 1 : 0;
      return rb - ra || nv[b.id].localeCompare(nv[a.id]) || (b.data.releaseDate || '').localeCompare(a.data.releaseDate || '');
    });
    return list.slice(0, 8);
  }
  // The picture behind the banner. Movies and TV Shows banners can show the playing video's own YouTube thumbnail:
  // Admin's choice per title (settings/<page>banner images: thumb / banner), else the thumbnail when YouTube has it in HD.
  function heroArt(m, v) {
    var ctx = S.heroCtx, imgs = (ctx === 'movies' ? S.movImages : ctx === 'tvshows' ? S.tvImages : null) || {};
    if (ctx && ctx !== 'home' && v && v.yt) {
      var pick = imgs[m.id] || 'auto', th = v.thumb || 'https://i.ytimg.com/vi/' + v.yt + '/hqdefault.jpg', hasBanner = !!safeUrl(m.data.bannerUrl);
      if (pick === 'thumb' || (pick === 'auto' && ((v.thumb && v.thumbHd) || !hasBanner)))
        return 'background-image:url("' + th.replace(/"/g, '%22') + '");background-position:center';
    }
    return art(m, 'banner', 1920);
  }
  // Movies banner: the movie's newest YouTube song (by publish date, else the one saved last).
  function heroPicked(m) {
    var u = safeUrl(m.data.bannerVideo); if (!u) return null;
    return vidItems(m).filter(function (x) { return x.yt && x.url === u; })[0] || null;
  }
  function heroSong(m) {
    var pk = heroPicked(m); if (pk) return pk;
    var vs = m.data.videos || [], best = null, bt = '';
    vidItems(m).forEach(function (x, i) {
      if (!x.yt || x.cat !== 'songs') return;
      var raw = vs.filter(function (v) { return safeUrl(v.url) === x.url; })[0] || {}, t = String(raw.publishedAt || raw.addedAt || '') + '|' + ('000' + i).slice(-4);
      if (!best || t > bt) { best = x; bt = t; }
    });
    return best;
  }
  // Movies page banner: movies chosen in Admin > Movies banner, in that order; with none, movies with a banner image and
  // a song: pinned New songs (Admin > Home rows) first, then the newest songs. At most 8.
  function movieHeroPicks() {
    var chosen = (S.movFeatured || []).map(function (id) { return S.byId[id]; }).filter(function (m) { return m && !isTv(m); });
    if (chosen.length) return chosen;
    var pins = rowPins('songs'), when = {};
    var list = S.movies.filter(function (m) { return !isTv(m) && safeUrl(m.data.bannerUrl) && heroSong(m); });
    list.forEach(function (m) { var s = heroSong(m), raw = (m.data.videos || []).filter(function (v) { return safeUrl(v.url) === s.url; })[0] || {}; when[m.id] = String(raw.publishedAt || raw.addedAt || ''); });
    list.sort(function (a, b) {
      var pa = pins.indexOf(a.id), pb = pins.indexOf(b.id);
      if (pa !== -1 || pb !== -1) return (pa === -1 ? 1e9 : pa) - (pb === -1 ? 1e9 : pb);
      return when[b.id].localeCompare(when[a.id]) || (b.data.releaseDate || '').localeCompare(a.data.releaseDate || '');
    });
    return list.slice(0, 8);
  }
  // The hero's YouTube trailer: the first trailer/teaser with a YouTube link, else any YouTube video of the title.
  function heroYt(m) {
    var it = vidItems(m).filter(function (x) { return x.yt && x.cat !== 'extras' && x.cat !== 'interviews'; });
    return it.filter(function (x) { return x.cat === 'trailers'; })[0] || it[0] || null;
  }
  function safePlay(el, onFail) { try { var p = el.play(); if (p && p.catch) p.catch(function () { if (onFail) onFail(); }); } catch (e) { if (onFail) onFail(); } }
  // vid: the URL of one video to play (a banner tag's new trailer or song); without it the banner's usual video.
  function startTrailer(id, vid) {
    var mm = S.byId[id], pv = vid && mm ? vidItems(mm).filter(function (x) { return x.yt && x.url === vid; })[0] : null;
    if (miniOn()) { if (mm) { toMini(mm, pv || heroYt(mm) || vidItems(mm).filter(function (x) { return x.clip; })[0]); return; } }
    S.play = { id: id, muted: false, paused: false, vid: pv ? vid : '' }; S.heroNode = null; drawHero();
  }
  // ---------- banner tags: one piece of news per slide for 7 days (design board: "Home banner: a tag for what's new") ----------
  // In order: a note set in Admin › Home banner (until its end date), Out today / Now in theatres (days 0–6 of a theatre
  // release), New trailer (trailer, teaser or promo uploaded on YouTube in the last 7 days), New song, Streaming now.
  // Video dates are YouTube's own upload dates (publishedAt); a video with none never counts as new.
  var NEWS_DAYS = 7;
  function agoLabel(iso) { var n = daysSince(iso); return n <= 0 ? 'today' : n === 1 ? 'yesterday' : n + ' days ago'; }
  function vidWord(x) { var w = heroVidLabel(x); return w === 'Play video' ? 'video' : w.toLowerCase(); }
  function freshVid(vids, cat) {
    var td = today(), best = null;
    vids.forEach(function (x) { if (x.yt && x.cat === cat && x.pub && x.pub <= td && daysSince(x.pub) < NEWS_DAYS && (!best || x.pub > best.pub)) best = x; });
    return best;
  }
  function newestVid(vids, cat) {
    var best = null;
    vids.forEach(function (x) { if (x.yt && x.cat === cat && (!best || (x.pub || '') > (best.pub || ''))) best = x; });
    return best;
  }
  // A video's own name without the film's title in front ("Avengers: Doomsday | Special Look" → "Special Look").
  function vidName(m, x) {
    var t = String(x.title || '').trim(), ft = String(m.data.title || '').trim();
    if (ft && t.toLowerCase().indexOf(ft.toLowerCase()) === 0 && !/\w/.test(t.charAt(ft.length))) { var rest = t.slice(ft.length).replace(/^[\s|:\-–—]+/, '').trim(); if (rest) t = rest; }
    else { var w = ft.split(/[\s:]+/)[0]; if (w && w.length > 2 && new RegExp('^' + w.replace(/[^\w]/g, '') + '\\s*[:|\\-–—]\\s*', 'i').test(t)) t = t.replace(new RegExp('^' + w.replace(/[^\w]/g, '') + '\\s*[:|\\-–—]\\s*', 'i'), ''); }
    return t;
  }
  function heroNews(m) {
    var d = m.data, td = today(), vids = vidItems(m), n = d.bannerNote;
    if (n && String(n.text || '').trim() && isoDay(n.until) && n.until >= td) {
      var nv = n.btn === 'trailer' ? newestVid(vids, 'trailers') : n.btn === 'song' ? newestVid(vids, 'songs') : null;
      return { kind: 'note', icon: 'bell', label: String(n.text).trim().slice(0, 40), sub: '', btn: n.btn === 'book' && hasBooking(d) ? 'book' : '', vid: nv,
        btnText: nv ? (nv.cat === 'songs' ? 'Play song' : 'Watch ' + vidWord(nv)) : '' };
    }
    if (!isTv(m) && isoDay(d.releaseDate) && d.section === 'In theatres') {
      var ds = daysSince(d.releaseDate);
      if (ds >= 0 && ds < NEWS_DAYS) return { kind: 'theatres', icon: 'ticket', label: ds === 0 ? 'Out today' : 'Now in theatres', sub: ds === 0 ? '' : 'Released ' + fmtDate(d.releaseDate), btn: hasBooking(d) ? 'book' : '' };
    }
    var tr = freshVid(vids, 'trailers');
    if (tr) return { kind: 'trailer', icon: 'play', label: 'New ' + vidWord(tr), sub: vidName(m, tr) + ' · ' + agoLabel(tr.pub), vid: tr, btnText: 'Watch new ' + vidWord(tr) };
    var sg = freshVid(vids, 'songs');
    if (sg) return { kind: 'song', icon: 'music', label: 'New song', sub: [vidName(m, sg), String(sg.artists || '').split(/,|&| and /)[0].trim()].filter(Boolean).join(' · '), vid: sg, btnText: 'Play song' };
    var e = ottEntry(m);
    if (e && !e.expected && e.date <= td && daysSince(e.date) < NEWS_DAYS) return { kind: 'ott', icon: 'tv', label: 'Streaming now', sub: 'on ' + (e.platName || d.platform || 'OTT') + ' · ' + (daysSince(e.date) ? 'since ' + fmtDate(e.date) : 'from today') };
    return null;
  }
  function stopTrailer() { if (S.heroVideo) { try { S.heroVideo.pause(); } catch (e) {} } S.play = null; S.heroNode = null; S.heroVideo = null; drawHero(); }
  function togglePause() {
    var vd = S.heroVideo, b = document.getElementById('vPlay'); if (!vd || !S.play) return;
    if (vd.paused) { safePlay(vd); S.play.paused = false; if (b) b.textContent = '❚❚  Pause'; }
    else { vd.pause(); S.play.paused = true; if (b) b.textContent = '▶  Resume'; }
  }
  function toggleMute() {
    var vd = S.heroVideo, b = document.getElementById('vMute'); if (!vd || !S.play) return;
    vd.muted = !vd.muted; S.play.muted = vd.muted;
    if (b) { b.textContent = vd.muted ? '🔇' : '🔊'; b.setAttribute('aria-label', vd.muted ? 'Unmute' : 'Mute'); }
  }
  setInterval(function () {
    if (S.route !== (S.heroCtx || 'home') || S.heroPause || S.play || document.hidden || !S.feat || S.feat.length < 2) return;
    S.slide = (S.slide + 1) % S.feat.length; drawHero();
  }, 8000);
  // Credit for data from open sources (TVmaze is CC BY-SA and asks for a link; Wikidata is CC0 but credited anyway).
  function srcCredit(d) {
    var tvm = safeUrl(d.srcTvmaze);
    if (tvm) return h('p', { class: 'note', style: 'margin:6px 0 0;font-size:12px;color:var(--muted)' }, ['Show details and image from ', h('a', { href: tvm, rel: 'noopener', target: '_blank', text: 'TVmaze' }), ' (', h('a', { href: 'https://creativecommons.org/licenses/by-sa/4.0/', rel: 'noopener license', target: '_blank', text: 'CC BY-SA 4.0' }), ')']);
    if (/^Q\d+$/.test(d.wikidata || '')) return h('p', { class: 'note', style: 'margin:6px 0 0;font-size:12px;color:var(--muted)' }, ['Film facts from ', h('a', { href: 'https://www.wikidata.org/wiki/' + d.wikidata, rel: 'noopener', target: '_blank', text: 'Wikidata' })]);
    return null;
  }
  // ---------- Send feedback ----------
  // One form for every entry point (footer, account menu, phone menu, title and person pages, search with no results).
  // Messages go to the contact collection (firestore.rules) and show in Admin > Messages: Wrong info = correction,
  // Missing film = add, the rest = other with the kind at the start of the message.
  var FB_TYPES = [['correction', 'Wrong info'], ['add', 'Missing film or show'], ['broken', 'Something\u2019s broken'], ['idea', 'An idea'], ['other', 'Other']];
  function fixRow(o) {
    return h('div', { class: 'fixrow' }, [h('button', { type: 'button', class: 'linkbtn', on: { click: function () { openFeedback({ type: 'correction', m: o.m, person: o.person, path: o.path }); } } },
      [icon('flag', 15), h('span', { text: 'Something wrong here? Suggest a fix' })])]);
  }
  function openFeedback(o) {
    o = o || {};
    var me = S.uid && S.user ? S.user : null, type = o.type || '';
    var path = o.path || (o.m ? movieUrl(o.m) : o.q ? '' : location.pathname + location.search);
    var about = o.m ? o.m.data.title : o.person ? o.person : o.filters ? 'Browse: ' + o.filters : o.q ? 'Searched: \u201c' + o.q + '\u201d' : (path && path !== '/' ? document.title.replace(/\s*\|\s*Reelscore$/, '') : '');
    var keepCtx = !!about;
    modal('Send feedback', function (close) {
      var chips = h('div', { class: 'fbchips', role: 'group', 'aria-label': 'What\u2019s it about?' });
      var lab = h('label', { class: 'fblab', for: 'fbMsg' });
      var msg = h('textarea', { id: 'fbMsg', class: 'fbin', rows: 4, maxlength: 1800 });
      if (o.q) msg.value = o.q;
      var mail = h('input', { id: 'fbMail', class: 'fbin', type: 'email', maxlength: 120, autocomplete: 'email', placeholder: 'you@example.com' });
      if (me && me.email) mail.value = me.email;
      var trap = h('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true', class: 'ctrap' });
      var out = h('p', { class: 'cout', role: 'status' });
      var send = h('button', { type: 'submit', class: 'btn primary', text: 'Send' });
      var ctx = keepCtx ? h('div', { class: 'fbctx' }, [h('span', { text: about }), h('button', { type: 'button', class: 'linkbtn', text: 'Remove', on: { click: function () { keepCtx = false; ctx.remove(); } } })]) : null;
      function drawChips() {
        chips.innerHTML = '';
        FB_TYPES.forEach(function (t) { chips.appendChild(h('button', { type: 'button', class: 'chip fbchip' + (type === t[0] ? ' on' : ''), 'aria-pressed': String(type === t[0]), text: t[1], on: { click: function () { type = t[0]; drawChips(); msg.focus(); } } })); });
        lab.textContent = type === 'correction' ? 'What\u2019s wrong, and what should it say?' : type === 'add' ? 'Which film or show? Add the year or language if you know it.' : type === 'broken' ? 'What went wrong?' : 'Your message';
      }
      drawChips();
      var form = h('form', { class: 'fbform', novalidate: true }, [
        h('div', { class: 'fbhead' }, [h('h2', { text: 'Send feedback' }), h('button', { type: 'button', class: 'fbx', 'aria-label': 'Close', text: '\u2715', on: { click: function () { close(); } } })]),
        h('div', {}, [h('span', { class: 'fblab', text: 'What\u2019s it about?' }), chips]),
        h('div', {}, [lab, msg]), ctx,
        h('div', {}, [h('label', { class: 'fblab', for: 'fbMail', text: me && me.email ? 'Your email (we\u2019ll reply here)' : 'Your email, so we can reply' }), mail]),
        trap, h('div', { class: 'fbact' }, [send, h('span', { class: 'note', text: 'We read every message.' })]), out]);
      form.addEventListener('submit', function (e) {
        e.preventDefault(); out.className = 'cout';
        var problem = !type ? [chips.querySelector('button'), 'Pick what it\u2019s about.'] : !msg.value.trim() ? [msg, 'Write a line or two.'] : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail.value.trim()) ? [mail, 'Enter an email address we can reply to.'] : null;
        if (problem) { out.className = 'cout err'; out.textContent = problem[1]; problem[0].focus(); return; }
        var box = form.parentNode;
        function thanks() {
          box.innerHTML = '';
          var done = h('button', { type: 'button', class: 'btn', text: 'Done', on: { click: function () { close(); } } });
          box.appendChild(h('div', { class: 'fbdone', role: 'status' }, [h('span', { class: 'fbok', 'aria-hidden': 'true' }, [icon('check', 22)]), h('h2', { text: 'Thanks, got it' }),
            h('p', { class: 'note', text: 'We read every message and will write back to ' + mail.value.trim() + ' if we need more or once it\u2019s fixed.' }), done]));
          done.focus();
        }
        if (trap.value) { thanks(); return; }
        send.disabled = true; send.textContent = 'Sending\u2026';
        var kind = FB_TYPES.filter(function (t) { return t[0] === type; })[0];
        var topic = type === 'correction' || type === 'add' ? type : 'other';
        var text = (topic === 'other' ? '[' + kind[1] + '] ' : '') + msg.value.trim() + (keepCtx && o.q && !o.filters ? '\n\nSearched for: ' + o.q : '') + (keepCtx && about && (o.filters || !o.q) ? '\n\nAbout: ' + about : '');
        var body = { topic: topic, name: String((me && me.displayName) || '').slice(0, 80), email: mail.value.trim().slice(0, 120), message: text.slice(0, 2000),
          page: keepCtx && path ? (location.origin + path).slice(0, 300) : '', at: new Date().toISOString() };
        if (S.uid) body.uid = S.uid;
        var id = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        if (window.__reelStartFirebase) window.__reelStartFirebase();
        (S.db ? Promise.resolve(S.db) : window.claude.use('db')).then(function (db) {
          if (!db) throw new Error('offline');
          return db.doc('contact/' + id).set(body);
        }).then(thanks).catch(function () {
          send.disabled = false; send.textContent = 'Send';
          out.className = 'cout err'; out.textContent = 'It couldn\u2019t be sent. Check your connection and try again.';
        });
      });
      setTimeout(function () { (type ? msg : chips.querySelector('button')).focus(); }, 0);
      return [form];
    });
  }
  // Floating "Feedback" tab on the right edge (desktop with a mouse only, see app.css). Not on admin pages.
  (function () {
    var tab = h('button', { type: 'button', class: 'fbtab', 'data-feedback': '', 'aria-label': 'Send feedback', text: 'Feedback' });
    document.body.appendChild(tab);
  })();
  // Any element with data-feedback opens the form (footer link, account menu, phone menu); its value picks the type.
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-feedback]'); if (!el) return;
    e.preventDefault(); e.stopPropagation();
    var mm = $('meMenu'); if (mm && !mm.hidden) { mm.hidden = true; var mb = $('meBtn'); if (mb) mb.setAttribute('aria-expanded', 'false'); }
    var hd = document.querySelector('header.nav.open'); if (hd) { hd.classList.remove('open'); var bt = $('menuBtn'); if (bt) bt.setAttribute('aria-expanded', 'false'); }
    openFeedback({ type: el.getAttribute('data-feedback') || '' });
  }, true);
  function footer() {
    return h('footer', { class: 'ft' }, [h('span', { text: 'Reelscore · Verdicts and reviews are public.' }), h('a', { href: '/about', text: 'About & how scores work' }), h('a', { href: '/news', text: 'News' }), h('a', { href: '/lists', text: 'Lists' }), h('a', { href: '/blog', text: 'Blog' }), h('a', { href: '/privacy', text: 'Privacy' }), h('a', { href: '/contact', text: 'Contact' }), h('a', { href: '/contact', 'data-feedback': '', text: 'Send feedback' }), h('span', { class: 'note', text: 'Some data: Wikidata (CC0) and TVmaze (CC BY-SA 4.0)' })]);
  }

  // ---------- title ----------
  var FOLLOW_ON = false; // following other reviewers isn't live yet
  function drawTitle() {
    var v = $('view-title');
    // A pre-rendered page (built for search engines) stays on screen until the catalogue arrives.
    if (!S.loaded && v.querySelector('[data-prerendered]')) return;
    // Redrawing the same title (a vote, a toggle): hold the page's height while it rebuilds so the scroll position isn't lost.
    var sy = window.scrollY, prevTitle = S.titleDrawnId;
    if (prevTitle) v.style.minHeight = v.offsetHeight + 'px';
    var keep = S.vKeep && S.vKeep.parentNode === v && S.vplay && S.vKeep._mid === S.vplay.mid ? S.vKeep : null;
    Array.prototype.slice.call(v.childNodes).forEach(function (c) { if (c !== keep) v.removeChild(c); });
    if (!keep) S.vKeep = null;
    var put = function (n) { if (!n) return; if (n === keep) { keep = null; return; } if (keep) v.insertBefore(n, keep); else v.appendChild(n); };
    var m = findMovie(S.param);
    if (keep && (!m || keep._mid !== m.id)) { if (keep.parentNode) keep.parentNode.removeChild(keep); keep = null; S.vKeep = null; S.vIdle = null; }
    if (!m || (S.vplay && S.vplay.mid !== m.id)) { S.vplay = null; if (S.vKeep && S.vKeep.parentNode) S.vKeep.parentNode.removeChild(S.vKeep); S.vKeep = null; keep = null; }
    if (m) { canonicalizeTitleUrl(m); document.title = builtHead && builtHead.title && location.pathname.replace(/\/+$/, '') === builtHead.path ? builtHead.title : movieTitleTag(m); setCanonical(movieUrl(m)); }
    setNoindex(!m && S.loaded);
    v.classList.remove('tpage');
    if (!S.loaded || !m) { v.style.minHeight = ''; S.titleDrawnId = null; }
    if (!S.loaded) { put(h('div', { class: 'wrapx' }, [h('div', { class: 'empty', text: 'Loading…' })])); return; }
    if (!m) { put(h('div', { class: 'wrapx' }, [h('div', { class: 'empty' }, ['This title isn’t in the catalogue. ', h('a', { href: '/', text: 'Back to home' })])])); return; }
    if (m.data._part && S.loadFull) S.loadFull(m); // the full story, trivia and interviews follow in a moment
    var d = m.data, rel = released(m), ott = isOtt(m);
    v.classList.add('tpage');
    // Badges: status (with the day count while it runs in theatres), then what's new or the release note.
    var live = d.section === 'In theatres' && rel && /^\d{4}-\d{2}-\d{2}$/.test(d.releaseDate || '');
    var dayN = live ? Math.floor((new Date(today() + 'T00:00:00') - new Date(d.releaseDate + 'T00:00:00')) / 864e5) + 1 : 0;
    var tags = [h('span', { class: 'tag hot' + (live ? ' live' : ''), text: live && dayN <= 200 ? '● In theatres · day ' + dayN : statusLabel(m) })];
    var npl = npLabel(m); if (npl) tags.push(h('span', { class: 'tag np', text: npl }));
    if (d.published === false) tags.unshift(h('span', { class: 'tag', style: 'background:var(--danger);color:#0B0A0F', text: 'Not published · admins only' }));
    if (d.releaseNote) tags.push(h('span', { class: 'tag', text: d.releaseNote }));
    put(titleHero(m, tags));
    put(verdictStrip(m, rel));

    var items = vidItems(m), groups = vidGroups(m, items);
    var bo = boxOfficeBlock(m), boc = boCollBlock(m);
    var act = actionBlock(m, rel, ott);
    var side = h('aside', { class: 'tside', 'aria-label': 'Where to watch and details' }, [act, factsBlock(m), planBlock(m), triviaBlock(m), pollBlock(m), locationsBlock(m), awardsBlock(m)]);
    var vsecs = groups.map(function (g) { return keep && keep.id === g.id && keep._mid === m.id ? keep : vidSection(m, g, items); });
    // Fan videos (announcements, breakdowns, post-credit) sit below Reviews; the other video sections stay near the top.
    var fan = null; vsecs = vsecs.filter(function (s) { if (s && s.id === 'extras') { fan = s; return false; } return true; });
    if (fan) groups.forEach(function (g) { if (g.id === 'extras') fan._n = g.idx.length; });
    var story = storyBlock(m), cast = castBlock(m), reviews = rel ? reviewsBlock(m, rel) : null, news = newsBlock(m);
    var posters = postersBlock(m);
    if (reviews) { reviews.classList.remove('card'); reviews.classList.add('tsec'); }
    var more = pinFirst(S.movies.filter(function (x) { return x.data.section === d.section && x.id !== m.id; }).sort(function (a, b) { return (b.data.releaseDate || '').localeCompare(a.data.releaseDate || ''); }), rowPins(d.section)).slice(0, 24);
    var r = rowSection('More ' + (isTv(m) ? 'TV shows' : d.section.toLowerCase().replace('on ott', 'on OTT')), more, d.section === 'Coming soon' ? { dateBadge: true, upIcons: true } : null);
    if (r) r.id = 'more';
    // Titles sharing cast or crew with this one: more shared people (top-billed weigh more) first, then newest.
    var ppl = {};
    (d.cast || []).forEach(function (c, i) { var k = personSlug(c.name); if (k && !(k in ppl)) ppl[k] = i < 4 ? 3 : CREW_RE.test(c.role || '') ? 2 : 1; });
    var byCrew = Object.keys(ppl).length ? S.movies.filter(function (x) { return x.id !== m.id; }).map(function (x) {
      var w = 0, seen = {};
      (x.data.cast || []).forEach(function (c) { var k = personSlug(c.name); if (k && ppl[k] && !seen[k]) { seen[k] = 1; w += ppl[k]; } });
      return { m: x, w: w };
    }).filter(function (o) { return o.w > 0; }).sort(function (a, b) { return b.w - a.w || (b.m.data.releaseDate || '').localeCompare(a.m.data.releaseDate || ''); }).slice(0, 20).map(function (o) { return o.m; }) : [];
    var rc = byCrew.length ? rowSection('More from Cast & Crew', byCrew, null) : null;
    if (rc) rc.id = 'morecast';
    // 10 titles most like this one: shared genre words, same language, close release year. Skips titles already in the cast row.
    var gw = function (x) { return String(x.data.genre || '').toLowerCase().split(/[^a-z-]+/).filter(function (t) { return t.length > 2 && t !== 'and'; }); };
    var lang = function (x) { return String(x.data.languages || '').split(/[,;]/)[0].trim().toLowerCase(); };
    var myG = gw(m), myL = lang(m), myY = +(String(d.releaseDate || d.year || '').slice(0, 4)) || 0, inCrew = {};
    byCrew.forEach(function (x) { inCrew[x.id] = 1; });
    var similar = myG.length ? S.movies.filter(function (x) { return x.id !== m.id && !inCrew[x.id] && isTv(x) === isTv(m); }).map(function (x) {
      var g = gw(x), shared = myG.filter(function (t) { return g.indexOf(t) !== -1; }).length;
      var y = +(String(x.data.releaseDate || x.data.year || '').slice(0, 4)) || 0;
      return { m: x, shared: shared, w: shared * 3 + (lang(x) === myL ? 2 : 0) + (myY && y ? Math.max(0, 2 - Math.abs(myY - y) / 3) : 0) };
    }).filter(function (o) { return o.shared > 0; }).sort(function (a, b) { return b.w - a.w || (b.m.data.releaseDate || '').localeCompare(a.m.data.releaseDate || ''); }).slice(0, 10).map(function (o) { return o.m; }) : [];
    var rs = similar.length ? rowSection(inList(m.id) ? 'Because it’s on your list' : 'More like ' + d.title, similar, null) : null;
    if (rs) rs.id = 'similar';
    var nRev = 0;
    Object.keys(S.reviews).forEach(function (uid) { var it = (S.reviews[uid].items || {})[m.id]; if (it && it.text) nRev++; });
    var nWatch = d.platform ? String(d.platform).split(/\s*[,/&]\s*|\s+and\s+/).filter(Boolean).length : 0;
    put(pageTabs([
      bo ? ['boxoffice', 'Box office', 0] : null
    ].concat(groups.filter(function (g) { return g.id !== 'extras'; }).map(function (g) { return [g.id, g.label, g.idx.length]; })).concat([
      posters ? ['posters', 'Posters', postersOf(m).length] : null,
      act ? ['watch', 'Where to watch', nWatch] : null,
      ['cast', 'Cast & crew', 0],
      boc ? ['bocoll', 'Collections', 0] : null,
      reviews ? ['reviews', 'Reviews', nRev] : null,
      fan ? ['extras', 'Fan videos', fan._n || 0] : null,
      news ? ['news', 'News', 0] : null,
      rc || rs || r ? [(rs || rc || r).id, 'More like this', 0] : null
    ]).filter(Boolean)));
    // Main sections and the sidebar are direct children of the page, so a video playing in one of them stays put when the page redraws.
    put(side);
    put(bo);
    vsecs.forEach(put);
    put(posters);
    put(story); put(cast); put(boc); put(reviews); put(fan); put(news);
    if (rs) put(rs);
    if (rc) put(rc);
    if (r) put(r);
    put(fixRow({ m: m }));
    put(footer());
    S.titleDrawnId = m.id; v.style.minHeight = '';
    if (prevTitle === m.id && Math.abs(window.scrollY - sy) > 2) window.scrollTo(0, sy);
  }

  // Sticky section tabs on the title page; the tab for the section in view is marked current.
  function pageTabs(tabs) {
    var links = tabs.map(function (t) {
      return h('a', { class: 'ptab', href: '#' + t[0], on: { click: function (e) {
        var el = $(t[0]); if (!el) return; e.preventDefault(); el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (history.replaceState) history.replaceState(history.state, '', location.pathname + location.search + '#' + t[0]);
      } } }, [t[1], t[2] ? h('span', { class: 'n', text: ' ' + t[2] }) : null]);
    });
    var nav = h('nav', { class: 'ptabs', 'aria-label': 'On this page' }, links);
    if (S.tabSpy) window.removeEventListener('scroll', S.tabSpy);
    S.tabSpy = function () {
      if (!nav.isConnected) { window.removeEventListener('scroll', S.tabSpy); S.tabSpy = null; return; }
      var cur = 0, off = nav.getBoundingClientRect().height + 24;
      tabs.forEach(function (t, i) { var el = $(t[0]); if (el && el.getBoundingClientRect().top - off <= 0) cur = i; });
      links.forEach(function (a, i) { if (i === cur) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
    };
    window.addEventListener('scroll', S.tabSpy, { passive: true });
    setTimeout(S.tabSpy, 0);
    return nav;
  }

  function titleHero(m, tags) {
    var d = m.data, clip = safeUrl(d.trailerFileUrl);
    var playing = !!(S.tplay && S.tplay.id === m.id && clip);
    if (playing && S.tpNode && S.tpNode._mid === m.id) {
      if (!S.tplay.paused && S.tpVideo) setTimeout(function () { safePlay(S.tpVideo); }, 0);
      return S.tpNode;
    }
    var video = null;
    if (playing) {
      video = h('video', { class: 'fv', src: clip, autoplay: true, playsinline: true, preload: 'auto' });
      video.muted = !!S.tplay.muted;
      video.setAttribute('aria-label', d.title + ' trailer');
      video.addEventListener('ended', stopTitleTrailer);
      video.addEventListener('timeupdate', function () { var p = document.getElementById('tProg'); if (p && video.duration) p.style.width = (100 * video.currentTime / video.duration) + '%'; });
      video.addEventListener('error', function () { toast('This clip couldn’t play.'); stopTitleTrailer(); });
    }
    var playBtn = playing
      ? h('button', { type: 'button', class: 'btn lg primary', id: 'tPlay', on: { click: toggleTitlePause } }, ['❚❚  Pause'])
      : clip ? h('button', { type: 'button', class: 'btn lg primary', on: { click: function () { startTitleTrailer(m.id); } } }, ['▶  Watch trailer'])
      : vidItems(m).some(function (x) { return x.yt && x.cat !== 'extras' && x.cat !== 'interviews'; }) ? h('button', { type: 'button', class: 'btn lg primary', on: { click: function () { var it = vidItems(m), k = -1; it.some(function (x, i) { if (x.yt && x.cat === 'trailers') { k = i; return true; } }); if (k < 0) it.some(function (x, i) { if (x.yt && x.cat !== 'extras' && x.cat !== 'interviews') { k = i; return true; } }); playVid(m.id, k, true); } } }, ['▶  Watch trailer'])
      : trailerBtn(m);
    var node = h('section', { class: 'tp art' + (playing ? ' playing' : ''), style: art(m, 'banner', 1920) }, [
      video,
      h('div', { class: 'shade' }),
      playing ? h('button', { type: 'button', class: 'vclose', 'aria-label': 'Close trailer', text: '×', on: { click: stopTitleTrailer } }) : null,
      playing ? miniBtn('btn small tp-mini', function () { var t = video ? video.currentTime : 0, cx = vidItems(m).filter(function (x) { return x.clip === clip; })[0]; stopTitleTrailer(); toMini(m, cx || { clip: clip, title: 'Trailer', kind: 'Trailer', cat: 'trailers' }, t); }) : null,
      playing ? h('div', { class: 'vprog', 'aria-hidden': 'true' }, [h('span', { id: 'tProg' })]) : null,
      h('div', { class: 'in' }, [
        h('div', { class: 'poster art', style: art(m, 'poster', 480), role: 'img', 'aria-label': d.title + ' poster' }),
        h('div', { class: 'txt' }, [
          (function () {
            var f = S.titleFrom;
            return h('a', { href: f ? f.path : '/', style: 'color:var(--muted);font-weight:600;font-size:14px;text-decoration:none', text: '← ' + backLabel(f),
              on: { click: function (e) {
                if (!f || !f.pushed || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                e.preventDefault(); e.stopPropagation(); history.back(); // back through history, so the page comes back where it was
              } } });
          })(),
          h('div', { class: 'tags' }, tags),
          h('h1', { class: 'display ttl', style: 'font-size:clamp(44px,6vw,84px)', text: d.title }),
          d.subtitle ? h('div', { class: 'display sbt', style: 'font-size:clamp(24px,3vw,36px);color:#D9D5DF', text: d.subtitle }) : null,
          (function () {
            var y = String(d.releaseDate || '').slice(0, 4), bits = [isTv(m) ? tvYears(d) : y, d.languages, d.genre, d.runtime].filter(Boolean);
            return bits.length || d.certificate ? h('p', { class: 'tmeta' }, [bits.join(' · '), d.certificate ? h('span', { class: 'cert', text: d.certificate }) : null]) : null;
          })(),
          heroLine(d) ? h('p', { class: 'lede hook', text: heroLine(d) }) : null,
          srcCredit(d),
          h('div', { class: 'acts2' }, [
            playBtn,
            playing ? h('button', { type: 'button', class: 'roundadd', id: 'tMute', 'aria-label': S.tplay.muted ? 'Unmute' : 'Mute', text: S.tplay.muted ? '🔇' : '🔊', on: { click: toggleTitleMute } }) : null,
            listBtn(m),
            playing ? null : h('button', { type: 'button', class: 'btn lg glass', on: { click: function () { copyText(shareText(m), 'Copied a link-ready message'); } } }, ['Share'])
          ])
        ])
      ])
    ]);
    node._mid = m.id;
    S.tpNode = playing ? node : null; S.tpVideo = video;
    if (video) setTimeout(function () { safePlay(video, function () { video.muted = true; S.tplay.muted = true; safePlay(video); var b = document.getElementById('tMute'); if (b) { b.textContent = '🔇'; b.setAttribute('aria-label', 'Unmute'); } }); }, 0);
    return node;
  }
  function startTitleTrailer(id) {
    if (miniOn()) { var mm = S.byId[id]; if (mm) { toMini(mm, vidItems(mm).filter(function (x) { return x.clip; })[0] || heroYt(mm)); return; } }
    if (S.play) stopTrailer();
    S.tplay = { id: id, muted: false, paused: false }; S.tpNode = null; render(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function stopTitleTrailer() { if (S.tpVideo) { try { S.tpVideo.pause(); } catch (e) {} } S.tplay = null; S.tpNode = null; S.tpVideo = null; render(true); }
  function toggleTitlePause() {
    var vd = S.tpVideo, b = document.getElementById('tPlay'); if (!vd || !S.tplay) return;
    if (vd.paused) { safePlay(vd); S.tplay.paused = false; if (b) b.textContent = '❚❚  Pause'; }
    else { try { vd.pause(); } catch (e) {} S.tplay.paused = true; if (b) b.textContent = '▶  Resume'; }
  }
  function toggleTitleMute() {
    var vd = S.tpVideo, b = document.getElementById('tMute'); if (!vd || !S.tplay) return;
    vd.muted = !vd.muted; S.tplay.muted = vd.muted;
    if (b) { b.textContent = vd.muted ? '🔇' : '🔊'; b.setAttribute('aria-label', vd.muted ? 'Unmute' : 'Mute'); }
  }
  function reviewsBlock(m, rel) {
    var box = h('section', { class: 'card', id: 'reviews', 'aria-labelledby': 'h-rv' }, [h('h2', { id: 'h-rv', text: 'Reviews' })]);
    var myR = S.uid && S.reviews[S.uid] && (S.reviews[S.uid].items || {})[m.id];
    if (rel) {
      var ta = h('textarea', { class: 'in', id: 'rvText', rows: 3, placeholder: myVerdict(m.id) ? 'What worked, what didn’t? Tag spoilers below.' : 'Pick a verdict above first, then tell people why.' });
      ta.value = S.reviewDraft[m.id] !== undefined ? S.reviewDraft[m.id] : (myR ? myR.text : '');
      ta.addEventListener('input', function () { S.reviewDraft[m.id] = ta.value; });
      var sp = h('input', { type: 'checkbox', id: 'rvSp', checked: !!(myR && myR.spoiler), style: 'width:18px;height:18px;accent-color:var(--accent)' });
      // Where you watched it: Theatre or OTT (and which service). TV shows skip this.
      S.rvWhere = S.rvWhere || {};
      var tvT = isTv(m), plats = String(m.data.platform || '').split(/\s*[,/&]\s*|\s+and\s+/).map(function (x) { return x.trim(); }).filter(Boolean);
      var wh = S.rvWhere[m.id] || (S.rvWhere[m.id] = { where: myR && myR.where ? myR.where : (isOtt(m) ? 'ott' : ''), via: myR && myR.via ? myR.via : (isOtt(m) && plats[0]) || '' });
      var whereRow = tvT ? null : h('div', { class: 'rvwhere', role: 'group', 'aria-label': 'Where did you watch it?' }, [
        h('span', { class: 'note', text: 'Where did you watch it?' }),
        isOtt(m) ? null : h('button', { type: 'button', class: 'chip', 'aria-pressed': String(wh.where === 'theatre'), on: { click: function () { wh.where = wh.where === 'theatre' ? '' : 'theatre'; render(true); } } }, [icon('screen', 15), ' Theatre']),
        h('button', { type: 'button', class: 'chip', 'aria-pressed': String(wh.where === 'ott'), on: { click: function () { wh.where = wh.where === 'ott' ? '' : 'ott'; if (!wh.via && plats.length === 1) wh.via = plats[0]; render(true); } } }, [icon('tv', 15), ' OTT']),
        wh.where === 'ott' ? (function () {
          var opts = plats.concat(['Other']).filter(function (x, i, a) { return a.indexOf(x) === i; });
          var sel = h('select', { class: 'in', 'aria-label': 'Which service', style: 'width:auto;height:34px;border-radius:17px' }, [h('option', { value: '', text: 'Which service? (optional)' })].concat(opts.map(function (o) { return h('option', { value: o, text: o, selected: wh.via === o }); })));
          sel.addEventListener('change', function () { wh.via = sel.value; });
          return sel;
        })() : null
      ]);
      box.appendChild(h('div', { class: 'field' }, [
        h('label', { class: 'l', for: 'rvText', text: myR ? 'Your review' : 'Write a review' }), ta, whereRow,
        h('div', { style: 'display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px' }, [
          h('label', { style: 'display:flex;align-items:center;gap:8px;font-size:14px;color:var(--muted)' }, [sp, 'Contains spoilers']),
          h('span', { style: 'display:flex;gap:8px' }, [
            myR ? h('button', { type: 'button', class: 'btn small', text: 'Delete', on: { click: function () { saveReview(m.id, '', false); } } }) : null,
            h('button', { type: 'button', class: 'btn small primary', text: myR ? 'Update review' : 'Post review', on: { click: function () {
              var t = ta.value.trim(); if (!t) { toast('Write something first.'); return; }
              if (!myVerdict(m.id)) { toast('Pick a verdict first.'); return; }
              saveReview(m.id, t, sp.checked, wh.where, wh.where === 'ott' && wh.via !== 'Other' ? wh.via : '');
            } } })
          ])
        ])
      ]));
    } else {
      box.appendChild(h('div', { class: 'note', text: 'Reviews open on release, ' + fmtDate(m.data.releaseDate, true) + '.' }));
    }
    var all = [];
    Object.keys(S.reviews).forEach(function (uid) { var it = (S.reviews[uid].items || {})[m.id]; if (it && it.text) all.push({ uid: uid, it: it }); });
    var fol = all.filter(function (r) { return following(r.uid); });
    // The All / People you follow tabs come back once following is ready (FOLLOW_ON).
    if (!FOLLOW_ON) S.rtab = 'all';
    else box.appendChild(h('div', { class: 'chips', role: 'tablist' }, [['all', 'All reviews (' + all.length + ')'], ['friends', 'People you follow (' + fol.length + ')']].map(function (t) {
      return h('button', { type: 'button', role: 'tab', class: 'chip', 'aria-selected': String(S.rtab === t[0]), text: t[1], on: { click: function () { S.rtab = t[0]; render(true); } } });
    })));
    var show = (S.rtab === 'friends' ? fol : all).slice().sort(function (a, b) {
      var fa = following(a.uid) || a.uid === S.uid ? 1 : 0, fb = following(b.uid) || b.uid === S.uid ? 1 : 0;
      return fb - fa || (b.it.at || '').localeCompare(a.it.at || '');
    });
    if (!show.length) box.appendChild(h('div', { class: 'empty', style: 'padding:24px', text: S.rtab === 'friends' ? (S.mine.following.length ? 'No one you follow has reviewed it yet.' : 'Follow reviewers to see their take here first.') : (rel ? 'No reviews yet. Be the first.' : 'No reviews yet.') }));
    show.forEach(function (r) {
      var vv = (S.verdicts[r.uid] && (S.verdicts[r.uid].v || {})[m.id]);
      var lab = vv ? vset(m).filter(function (x) { return x[0] === vv; })[0] : null;
      var hidden = r.it.spoiler && !S.spoilerShown[r.uid + m.id];
      var p = h('p', { style: 'margin:0;line-height:1.55;white-space:pre-wrap', class: hidden ? 'spoil' : '', text: r.it.text });
      box.appendChild(h('article', { class: 'rv' }, [
        h('div', { class: 'who' }, [
          avatarEl(r.uid), personEl(r.uid), lab ? h('span', { class: 'vtag', style: 'background:' + VCOL[vv], text: lab[1].toUpperCase() }) : null,
          r.it.where === 'theatre' || r.it.where === 'ott' ? h('span', { class: 'wtag' }, [icon(r.it.where === 'theatre' ? 'screen' : 'tv', 13), r.it.where === 'theatre' ? 'Watched in theatre' : 'Watched on ' + (r.it.via || 'OTT')]) : null,
          r.it.spoiler ? h('span', { class: 'miss', text: 'SPOILER' }) : null,
          h('span', { class: 'note', style: 'margin-left:auto', text: (r.it.at || '').slice(0, 10) }),
          r.uid !== S.uid ? h('button', { type: 'button', class: 'btn small', text: following(r.uid) ? 'Following' : 'Follow', 'aria-pressed': String(following(r.uid)), on: { click: function () { toggleFollow(r.uid); } } }) : null
        ]),
        p,
        hidden ? h('button', { type: 'button', class: 'btn small ghost', style: 'align-self:flex-start', text: 'Show spoiler', on: { click: function () { S.spoilerShown[r.uid + m.id] = true; render(true); } } }) : null
      ]));
    });
    return box;
  }
  // ---------- trailers & songs: a player with a playlist ----------
  function ytId(u) {
    u = String(u || '');
    var mm = u.match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    return mm ? mm[1] : '';
  }
  function vidCat(k) { k = String(k || '').toLowerCase(); return /trailer|teaser|promo|glimpse/.test(k) ? 'trailers' : /song|lyric|music|jukebox|audio|soundtrack|score|bgm|\bost\b|theme/.test(k) ? 'songs' : /episode/.test(k) ? 'episodes' : 'more'; }
  function vidItems(m) {
    var d = m.data, out = [], clip = safeUrl(d.trailerFileUrl);
    if (clip) out.push({ title: 'Trailer', kind: 'Trailer', clip: clip, cat: 'trailers' });
    (d.videos || []).forEach(function (x) {
      var u = safeUrl(x.url), id = ytId(u);
      // The catalogue leaves out a thumbnail that is the video's standard HD still (thumbHd set): rebuilt here from the id.
      var tu = x.thumbUrl || (x.thumbHd && id ? 'https://i.ytimg.com/vi/' + id + '/maxresdefault.jpg' : '');
      out.push({ title: x.title || x.kind || 'Video', kind: x.kind || 'Video', url: u, yt: id, cat: vidCat(x.kind), pub: /^\d{4}-\d{2}-\d{2}/.test(x.publishedAt || '') ? x.publishedAt.slice(0, 10) : '', thumb: id && safeUrl(tu) && tu.indexOf('/vi/' + id + '/') !== -1 ? tu : '', thumbHd: !!x.thumbHd,
        artists: String(x.artists || '').trim().slice(0, 120), dur: /^\d{1,2}(:\d{2}){1,2}$/.test(String(x.dur || '').trim()) ? String(x.dur).trim() : '' });
    });
    // Announcements and trailer breakdowns (Admin > their own card) come after, so the indexes above stay the same.
    // Cast interviews (Admin > Cast interviews card).
    (d.interviews || []).forEach(function (x) {
      var u = safeUrl(x.url), id = ytId(u); if (!u) return;
      out.push({ title: x.title || 'Interview', kind: 'Interview', url: u, yt: id, cat: 'interviews', thumb: id && safeUrl(x.thumbUrl) && x.thumbUrl.indexOf('/vi/' + id + '/') !== -1 ? x.thumbUrl : '', thumbHd: !!x.thumbHd,
        artists: String(x.artists || '').trim().slice(0, 120), dur: /^\d{1,2}(:\d{2}){1,2}$/.test(String(x.dur || '').trim()) ? String(x.dur).trim() : '' });
    });
    (d.extras || []).forEach(function (x) {
      var u = safeUrl(x.url), id = ytId(u); if (!u) return;
      out.push({ title: x.title || x.kind || 'Video', kind: x.kind || 'Video', url: u, yt: id, cat: 'extras', spoil: /post.?credit/i.test(x.kind || ''), blur: !!x.blur, thumb: id && safeUrl(x.thumbUrl) && x.thumbUrl.indexOf('/vi/' + id + '/') !== -1 ? x.thumbUrl : '', thumbHd: !!x.thumbHd,
        artists: String(x.channel || '').trim().slice(0, 80), dur: /^\d{1,2}(:\d{2}){1,2}$/.test(String(x.dur || '').trim()) ? String(x.dur).trim() : '' });
    });
    return out;
  }
  // ---------- shareable video pages: /movie/<slug>/trailer, /trailer/<name>, /song/<name>, /episode…, /video… ----------
  // One address per YouTube video, in the order saved. The first trailer (or episode, or other video) is just /trailer;
  // songs always carry their name. Same rule as scripts/build.mjs videoPaths, which pre-renders each page.
  var VSEG = { trailers: 'trailer', songs: 'song', episodes: 'episode', more: 'video' };
  function videoPaths(d) {
    var out = [], used = {};
    (d.videos || []).forEach(function (x, i) {
      var id = ytId(safeUrl(x.url)); if (!id) return;
      var seg = VSEG[vidCat(x.kind)], first = !used[seg];
      var p = '/' + seg + (seg === 'song' || !first ? '/' + (slugify(x.title || '').slice(0, 60).replace(/-+$/, '') || seg) : '');
      if (used[p]) { var n = 2; while (used[p + '-' + n]) n++; p += '-' + n; }
      used[seg] = 1; used[p] = 1; out.push({ i: i, yt: id, seg: seg, path: p, x: x });
    });
    return out;
  }
  function videoUrl(m, yt) { if (!yt) return ''; var v = videoPaths(m.data).filter(function (p) { return p.yt === yt; })[0]; return v ? movieUrl(m) + v.path : ''; }
  function videoName(m, v) { return v.seg === 'song' ? (v.x.title || 'Song') : m.data.title + ' – ' + (v.x.title || v.x.kind || 'Video'); }
  // Same as the pre-rendered page's <title> (scripts/build.mjs videoTitleTag).
  function videoTitleTag(m, v) {
    var d = m.data, y = String(d.releaseDate || '').slice(0, 4), yy = y && !isTv(m) ? ' (' + y + ')' : '';
    var a = v.seg === 'song' ? (v.x.title || 'Song') + ' – ' + d.title + yy + ' Song | Reelscore' : d.title + yy + ' – ' + (v.x.title || v.x.kind || 'Video') + ' | Reelscore';
    return a.length <= 60 ? a : a.replace(/ \| Reelscore$/, '');
  }
  function shareVideo(m, v, url) {
    var full = location.origin + url, text = videoName(m, v) + (v.seg === 'song' ? ' · ' + m.data.title : '') + ' on Reelscore';
    if (navigator.share) { try { navigator.share({ title: text, text: text, url: full }).catch(function () {}); return; } catch (e) {} }
    copyText(full, 'Link copied');
  }
  function drawVideo() {
    var v = $('view-video');
    if (!S.loaded && v.querySelector('[data-prerendered]')) return;
    var key = S.param + S.vpath;
    if (S.vpKey === key && v.querySelector('.vstage iframe')) return; // don't interrupt a playing video on a data refresh
    S.vpKey = key; v.innerHTML = '';
    var w = h('section', { class: 'wrapx vpage', style: 'padding-top:24px', 'aria-label': 'Video' }); v.appendChild(w);
    if (!S.loaded) { w.appendChild(h('div', { class: 'empty', text: 'Loading…' })); return; }
    var m = findMovie(S.param);
    // A title from the catalogue without its full record: interviews and other videos may be missing until it loads.
    if (m && m.data._part && S.loadFull) { S.loadFull(m); S.vpKey = null; w.appendChild(h('div', { class: 'empty', text: 'Loading…' })); return; }
    var all = m ? videoPaths(m.data) : [], cur = all.filter(function (p) { return p.path === S.vpath; })[0];
    if (!m || !cur) {
      document.title = 'Video not found | Reelscore'; setCanonical(null); setNoindex(true);
      w.appendChild(h('div', { class: 'empty' }, ['This video isn’t on Reelscore any more. ', m ? h('a', { href: movieUrl(m), text: 'See ' + m.data.title }) : h('a', { href: '/trailers', text: 'See the latest trailers' })]));
      return;
    }
    var d = m.data, here = movieUrl(m) + cur.path, x = cur.x, tv = isTv(m);
    if (location.pathname !== here) history.replaceState(null, '', here);
    document.title = videoTitleTag(m, cur); setCanonical(here); setNoindex(false);
    var kindName = cur.seg === 'song' ? (/soundtrack/i.test(x.kind || '') ? 'Soundtrack' : 'Song') : (x.kind || 'Video');
    w.appendChild(h('nav', { class: 'gcrumbs', 'aria-label': 'Breadcrumb', style: 'margin-bottom:12px' }, [h('a', { href: '/', text: 'Home' }), ' › ',
      h('a', { href: tv ? '/browse/tv-shows' : '/browse', text: tv ? 'TV shows' : 'Movies' }), ' › ', h('a', { href: movieUrl(m), text: d.title }), ' › ', kindName]));
    var stage = h('div', { class: 'vstage', style: 'background-image:url("https://i.ytimg.com/vi/' + cur.yt + '/hqdefault.jpg")' });
    var play = function () {
      if (miniOn()) { toMini(m, x); return; }
      stage.innerHTML = ''; stage.classList.add('on');
      var fr = ytClock(h('iframe', { src: 'https://www.youtube-nocookie.com/embed/' + cur.yt + '?autoplay=1&rel=0&playsinline=1&modestbranding=1&enablejsapi=1&origin=' + encodeURIComponent(location.origin), title: videoName(m, cur),
        allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin' }));
      stage.appendChild(fr);
      var mb = miniBtn('btn small vp-mini', function () { var t = fr._t; stage.innerHTML = ''; stage.classList.remove('on'); toMini(m, x, t); w.querySelector('.vp-mini') && w.querySelector('.vp-mini').remove(); });
      var acts = w.querySelector('.vacts'); if (mb && acts && !acts.querySelector('.vp-mini')) acts.insertBefore(mb, acts.firstChild);
    };
    stage.appendChild(h('span', { class: 'kb', text: kindName.toUpperCase() }));
    stage.appendChild(h('button', { type: 'button', class: 'vplay', 'aria-label': 'Play ' + videoName(m, cur), on: { click: play } }, [h('span', { 'aria-hidden': 'true', text: '▶' })]));
    w.appendChild(stage);
    var y = String(d.releaseDate || '').slice(0, 4);
    w.appendChild(h('div', { class: 'vhead' }, [
      h('div', { style: 'min-width:0' }, [
        h('h1', { class: 'display', text: videoName(m, cur) }),
        h('p', { class: 'note', text: [cur.seg === 'song' ? kindName + ' from ' + d.title : kindName, langOf(d), tv ? (d.platform || 'TV series') : (released(m) ? y : d.releaseDate ? 'Releases ' + fmtDate(d.releaseDate) : y)].filter(Boolean).join(' · ') })
      ]),
      h('div', { class: 'vacts' }, [
        h('button', { type: 'button', class: 'btn primary', text: navigator.share ? 'Share' : 'Copy link', on: { click: function () { shareVideo(m, cur, here); } } }),
        h('a', { class: 'btn', href: 'https://wa.me/?text=' + encodeURIComponent(videoName(m, cur) + (cur.seg === 'song' ? ' · ' + d.title : '') + ' ' + location.origin + here), target: '_blank', rel: 'noopener', text: 'WhatsApp' }),
        h('a', { class: 'btn ghost', href: movieUrl(m), text: tv ? 'About the show' : 'About the film' })
      ])
    ]));
    var others = all.filter(function (p) { return p !== cur; });
    if (others.length) {
      w.appendChild(h('h2', { style: 'margin:32px 0 14px', text: 'More from ' + d.title }));
      w.appendChild(h('div', { class: 'vgrid' }, others.map(function (p) {
        return h('a', { class: 'tcard', href: movieUrl(m) + p.path }, [
          h('span', { class: 'th' }, [h('img', { src: 'https://i.ytimg.com/vi/' + p.yt + '/hqdefault.jpg', alt: '', width: 480, height: 360, loading: 'lazy' }),
            h('span', { class: 'kb', text: (p.seg === 'song' ? (/soundtrack/i.test(p.x.kind || '') ? 'Soundtrack' : 'Song') : p.x.kind || 'Video').toUpperCase() }), h('span', { class: 'pb', 'aria-hidden': 'true', text: '▶' })]),
          h('span', { class: 'tt', text: p.x.title || p.x.kind }),
          h('span', { class: 'note', text: d.title })
        ]);
      })));
    }
    w.appendChild(h('p', { class: 'note', style: 'margin-top:28px' }, ['More videos: ', h('a', { href: tv ? '/tv-promos' : '/trailers', text: tv ? 'TV promotionals' : 'Latest trailers' }), tv ? null : ' · ', tv ? null : h('a', { href: '/songs', text: 'Video songs' })]));
  }
  // On the title page, swap only the video sections that change (no full redraw, so the rest of the page doesn't flash or reload).
  function refreshVideos(mid, idxs) {
    if (S.route !== 'title') return false;
    var m = findMovie(S.param); if (!m || m.id !== mid) return false;
    var items = vidItems(m), groups = vidGroups(m, items), done = false;
    groups.forEach(function (g) {
      if (!g.idx.some(function (i) { return idxs.indexOf(i) !== -1; })) return;
      var old = document.getElementById(g.id); if (!old || !old.classList.contains('vsec')) return;
      if (S.vKeep === old) S.vKeep = null;
      old.replaceWith(vidSection(m, g, items)); done = true;
    });
    return done;
  }
  function playVid(mid, i, scroll) {
    if (miniOn()) { var mm = S.byId[mid]; if (mm) { toMini(mm, vidItems(mm)[i]); return; } }
    S.vsel = S.vsel || {}; S.vsel[mid] = i;
    var prev = S.vplay && S.vplay.mid === mid ? S.vplay.i : -1;
    S.vplay = { mid: mid, i: i }; S.vIdle = null;
    if (S.tplay) { if (S.tpVideo) { try { S.tpVideo.pause(); } catch (e) {} } S.tplay = null; S.tpNode = null; S.tpVideo = null; S.vKeep = null; render(true); }
    else if (!refreshVideos(mid, [prev, i])) { S.vKeep = null; render(true); }
    if (scroll) setTimeout(function () { var t = document.querySelector('.vsec.playing') || $('trailers'); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 30);
  }
  function stepVid(m, dir, play) {
    var it = vidItems(m), n = it.length; if (!n) return;
    var cur = (S.vsel && S.vsel[m.id]) || 0, k = cur;
    for (var t = 0; t < n; t++) { k = (k + dir + n) % n; if (it[k].yt || it[k].clip) break; }
    if (play) playVid(m.id, k); else { S.vsel = S.vsel || {}; S.vsel[m.id] = k; S.vplay = null; S.vKeep = null; S.vIdle = null; render(true); }
  }
  function epText(n) { n = String(n || '').trim(); return n ? n + (n === '1' ? ' episode' : ' episodes') : ''; }
  // Plain-language summary written from the title's facts (app/about.js; the pre-rendered page uses the same text).
  function aboutBlock(m) {
    if (!window.RS_ABOUT) return null;
    var d = m.data, sc = score(m.id), y = String(d.releaseDate || '').slice(0, 4);
    var text = RS_ABOUT.title({ title: d.title, tv: isTv(m), date: d.releaseDate || '', year: y, upcoming: isUpcoming(m), released: released(m),
      languages: d.languages, genre: d.genre, runtime: d.runtime, certificate: d.certificate, seasons: d.seasons, episodes: d.episodes, endYear: d.endYear,
      platform: d.platform, director: d.director, cast: (d.cast || []).filter(function (c) { return c && c.name; }), verdicts: { pct: sc.pct, tot: sc.tot } });
    return h('section', { class: 'card', id: 'about' }, [h('h2', { text: 'About ' + d.title }), h('p', { class: 'about', text: text })]);
  }
  // ---------- title page blocks (2026 redesign) ----------
  // Small inline icons; static markup only.
  var ICONS = { sliders: '<path d="M4 6h16M7 12h10M10 18h4"/>',
    pip: '<rect x="2.5" y="4.5" width="19" height="15" rx="2"/><rect x="11.5" y="11.5" width="8" height="6" rx="1" fill="currentColor"/>',
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-6h4v6"/>',
    ticket: '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h15A1.5 1.5 0 0 1 21 7.5V10a2 2 0 0 0 0 4v2.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5V14a2 2 0 0 0 0-4z"/><path d="M14 6v2.5M14 11v2M14 15.5V18"/>',
    zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    smile: '<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2.5 4 2.5 4-2.5 4-2.5"/><path d="M9 9.5h.01M15 9.5h.01"/>',
    heart: '<path d="M12 20s-7-4.4-9-9a4.5 4.5 0 0 1 9-3 4.5 4.5 0 0 1 9 3c-2 4.6-9 9-9 9z"/>',
    bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.6"/><path d="M15.5 14.3A5 5 0 0 1 21 19"/>',
    ghost: '<path d="M5 21V10a7 7 0 0 1 14 0v11l-2.5-2-2.3 2-2.2-2-2.2 2-2.3-2z"/><path d="M9.5 10h.01M14.5 10h.01"/>',
    screen: '<path d="M3 4h18l-2 9H5z"/><path d="M5 18h3M10.5 18h3M16 18h3M6 21h2M11 21h2M16 21h2"/>',
    tv: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/><path d="M10.5 8.3l4 2.2-4 2.2z" fill="currentColor"/>',
    skip: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
    play: '<path d="M7 4.5l12.5 7.5L7 19.5z"/>',
    music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
    lang: '<path d="M4 5h9M8.5 3v2M6 5c.6 3.2 2.6 5.8 5.5 7.2M11 5c-.8 3.6-3.4 6.6-7 8"/><path d="M13 21l4-9 4 9M14.4 18h5.2"/>',
    flag: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    moon: '<path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeoff: '<path d="M10.7 5.1A10.7 10.7 0 0 1 12 5c7 0 10 7 10 7a13 13 0 0 1-1.7 2.7"/><path d="M14.1 14.2a3 3 0 0 1-4.2-4.2"/><path d="M17.5 17.5A10.7 10.7 0 0 1 12 19c-7 0-10-7-10-7a13 13 0 0 1 4.7-5.2"/><path d="M2 2l20 20"/>',
    bell: '<path d="M6 8a6 6 0 1112 0c0 7 3 8 3 8H3s3-1 3-8M10.3 20a2 2 0 003.4 0"/>',
    cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9 6.8 19.6l1-5.8L3.5 9.7l5.9-.8z"/>',
    thumb: '<path d="M7 10v10H4V10zM7 10l4-7c1.5 0 2.5 1 2.2 2.6L12.6 9H19a2 2 0 012 2.3l-1.2 7A2 2 0 0117.8 20H7"/>'
  };
  function icon(name, size) {
    var s = h('span', { class: 'ic', 'aria-hidden': 'true' });
    s.innerHTML = '<svg width="' + (size || 18) + '" height="' + (size || 18) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ICONS[name] + '</svg>';
    return s;
  }
  function vIconName(m, k) { return k === 'c' ? 'skip' : !bigScreen(m) ? (k === 'a' ? 'star' : 'thumb') : (k === 'a' ? 'screen' : 'tv'); }
  var SPLITCOL = { a: 'var(--accent)', b: '#7FB2FF', c: '#6B6577' };

  // ---------- before release: countdown, your plan, buzz ----------
  // Plans live in each person's public verdicts doc (bo map, key "<id>:plan" = a / b / c), like the box office call and fan poll.
  var MIN_PLANS = 5;
  function relAt(m) { var d = m.data.releaseDate || ''; return /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + 'T00:00:00') : null; }
  function cdParts(m) {
    var t = relAt(m); if (!t) return null;
    var sec = Math.floor((t - Date.now()) / 1000); if (sec <= 0) return null;
    return [Math.floor(sec / 86400), Math.floor(sec / 3600) % 24, Math.floor(sec / 60) % 60, sec % 60];
  }
  function streamFirst(m) { return isOtt(m) || isTv(m); }
  function planSet(m) {
    var o = streamFirst(m);
    return [['a', o ? 'Day one' : 'First weekend', o ? 'Watch when it drops' : 'Catch it in theatres'], ['b', o ? 'Later' : 'On OTT', o ? 'Save it for later' : 'Wait for streaming'], ['c', 'Not for me', 'Stop reminders']];
  }
  function planIcon(m, k) { return k === 'c' ? 'skip' : streamFirst(m) ? (k === 'a' ? 'star' : 'thumb') : (k === 'a' ? 'screen' : 'tv'); }
  function planKey(id) { return id + ':plan'; }
  function myPlan(id) { return S.uid && S.verdicts[S.uid] ? (S.verdicts[S.uid].bo || {})[planKey(id)] : null; }
  function planCounts(id, onlyUids) {
    var n = { a: 0, b: 0, c: 0, tot: 0, who: [] }, k = planKey(id);
    Object.keys(S.verdicts).forEach(function (u) {
      if (onlyUids && onlyUids.indexOf(u) === -1) return;
      var x = (S.verdicts[u].bo || {})[k]; if (n[x] !== undefined) { n[x]++; n.tot++; n.who.push([u, x]); }
    });
    return n;
  }
  // Rank by people planning to watch (first weekend or OTT), among unreleased titles out the same month.
  function buzzRank(m) {
    var mo = String(m.data.releaseDate || '').slice(0, 7); if (!/^\d{4}-\d{2}$/.test(mo)) return null;
    var cnt = {};
    Object.keys(S.verdicts).forEach(function (u) {
      var bo = S.verdicts[u].bo || {};
      Object.keys(bo).forEach(function (k) { if (/:plan$/.test(k) && (bo[k] === 'a' || bo[k] === 'b')) { var id = k.slice(0, -5); cnt[id] = (cnt[id] || 0) + 1; } });
    });
    var mine = cnt[m.id] || 0; if (mine < MIN_PLANS) return null;
    var n = 1 + S.movies.filter(function (x) { return x.id !== m.id && !released(x) && String(x.data.releaseDate || '').slice(0, 7) === mo && (cnt[x.id] || 0) > mine; }).length;
    if (n > 10) return null;
    var dt = new Date(mo + '-01T00:00:00'), when = dt.toLocaleDateString('en-IN', { month: 'long' }) + (dt.getFullYear() !== new Date().getFullYear() ? ' ' + dt.getFullYear() : '');
    return { n: n, when: when };
  }
  function setPlan(mid, val) {
    if (!needUser() || writing.v || !verdictsReady()) return;
    var cur = clone(S.verdicts[S.uid] || { v: {} }); cur.v = cur.v || {}; cur.bo = cur.bo || {};
    var k = planKey(mid), off = cur.bo[k] === val;
    if (off) delete cur.bo[k]; else cur.bo[k] = val;
    cur.at = new Date().toISOString(); S.verdicts[S.uid] = cur;
    // First weekend / Day one sets the release-day reminder; either plan to watch saves it to the watchlist; Not for me turns the reminder off.
    if (!off) {
      S.mine.reminders = S.mine.reminders || [];
      var ri = S.mine.reminders.indexOf(mid), wi = S.mine.watchlist.indexOf(mid), msg = '';
      if (val === 'a' && ri === -1) { S.mine.reminders.push(mid); msg = 'Reminder set for release day'; }
      if (val !== 'c' && wi === -1) { S.mine.watchlist.push(mid); msg = msg ? msg + ' and added to your watchlist' : 'Added to your watchlist'; }
      if (val === 'c' && ri !== -1) { S.mine.reminders.splice(ri, 1); msg = 'Reminder turned off'; }
      if (msg) saveMine(msg);
    }
    if (!patchTitleBits()) render();
    writing.v = true;
    guard(S.db.doc('verdicts/' + S.uid).set(cur)).then(function () { writing.v = false; });
  }
  function icsEsc(t) { return String(t).replace(/[\;,]/g, function (c) { return '\\' + c; }).replace(/\n/g, '\\n'); }
  function addToCalendar(m) {
    var t = relAt(m); if (!t) return;
    var ymd = function (x) { return x.getFullYear() + String(x.getMonth() + 1).padStart(2, '0') + String(x.getDate()).padStart(2, '0'); };
    var end = new Date(t.getTime()); end.setDate(end.getDate() + 1);
    var stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    var where = streamFirst(m) ? 'Streams on ' + (m.data.platform || 'OTT') : 'In theatres';
    var ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Reelscore//EN', 'BEGIN:VEVENT', 'UID:' + m.id + '-release@reelscore', 'DTSTAMP:' + stamp,
      'DTSTART;VALUE=DATE:' + ymd(t), 'DTEND;VALUE=DATE:' + ymd(end), 'SUMMARY:' + icsEsc(m.data.title + ' · ' + where), 'URL:' + location.origin + movieUrl(m), 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' })); a.download = slugify(m.data.title) + '-release.ics';
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function cdTiles(cd) {
    return [['days', cd[0]], ['hrs', cd[1]], ['min', cd[2]], ['sec', cd[3]]].map(function (x, i) { return h('span', {}, [h('b', { text: i ? String(x[1]).padStart(2, '0') : String(x[1]) }), h('small', { text: x[0] })]); });
  }
  // Keep the countdown ticking without redrawing the page; redraw once the title is out.
  setInterval(function () {
    var el = document.querySelector('.cd[data-cd]'); if (!el || document.hidden) return;
    var m = S.byId[el.getAttribute('data-cd')]; if (!m) return;
    var cd = cdParts(m); if (!cd) { render(); return; }
    el.querySelectorAll('b').forEach(function (b, i) { b.textContent = i ? String(cd[i]).padStart(2, '0') : String(cd[i]); });
    // The spoken label changes once a minute, so screen readers aren't flooded every second.
    if (cd[3] === 59) el.setAttribute('aria-label', (el.getAttribute('data-name') ? el.getAttribute('data-name') + ': ' : '') + cdSay(cd));
  }, 1000);
  function cdSay(cd) { return cd[0] + ' days, ' + cd[1] + ' hours and ' + cd[2] + ' minutes to release'; }
  // A title can give its countdown a name and colour in Admin (e.g. Avengers: Doomsday's "Doomsday Clock").
  function cdColor(d) { return /^#[0-9a-f]{6}$/i.test(String(d.cdColor || '').trim()) ? String(d.cdColor).trim() : ''; }
  function preStrip(m) {
    var d = m.data, o = streamFirst(m), t = relAt(m), cd = cdParts(m), my = myPlan(m.id), ps = planSet(m), pc = planCounts(m.id);
    var wk = t ? t.toLocaleDateString('en-IN', { weekday: 'short' }) + ' ' + fmtDate(d.releaseDate, true) : '';
    var kick = o ? (t ? (isTv(m) ? 'Premieres' : 'Streams') + (d.platform ? ' on ' + d.platform : '') + ' · ' + wk : 'Release date TBA') : (t ? 'In theatres · ' + wk : 'Release date TBA');
    var cdName = String(d.cdName || '').trim().slice(0, 30), cdc = cdColor(d);
    var hasVid = (d.videos || []).some(function (v) { return safeUrl(v.url); });
    var steps = o ? [['Announced', true], ['Trailer out', hasVid], [isTv(m) ? 'Premiere' : 'Streaming', false]]
      : [['Announced', true], ['Trailer out', hasVid], ['Bookings open', hasBooking(d)], ['Release', false]];
    var last = 0; steps.forEach(function (x, i) { if (x[1]) last = i; });
    var line = h('div', { class: 'tl', role: 'img', 'aria-label': 'Done so far: ' + steps.filter(function (x) { return x[1]; }).map(function (x) { return x[0]; }).join(', ') }, []);
    steps.forEach(function (x, i) { if (i) line.appendChild(h('em', { class: x[1] ? 'd' : '' })); line.appendChild(h('i', { class: x[1] ? 'd' : '' })); });
    var left = h('div', { class: 'vs-score' }, [
      cdName && cd ? h('div', { class: 'kicker cdname' }, [h('span', { class: 'cdn' }, [h('span', { class: 'pulse', 'aria-hidden': 'true' }), cdName]), h('span', { class: 'cdw', text: kick })]) : h('div', { class: 'kicker', text: kick }),
      cd ? h('div', { class: 'cd', 'data-cd': m.id, 'data-name': cdName || null, role: 'timer', 'aria-label': (cdName ? cdName + ': ' : '') + cdSay(cd) }, cdTiles(cd))
        : h('div', { class: 'vs-big' }, [h('span', { class: 'big', style: 'font-size:30px', text: /^\d{4}$/.test(d.releaseDate || '') ? 'Coming ' + d.releaseDate : 'Date TBA' })]),
      h('div', { class: 'tlw' }, [line, h('div', { class: 'tll' }, steps.map(function (x, i) { return h('span', { class: i === last ? 'on' : '', text: x[0] }); }))]),
      h('div', { class: 'pre-acts' }, [
        h('button', { type: 'button', class: 'btn small' + (hasReminder(m.id) ? '' : ' primary'), 'aria-pressed': String(hasReminder(m.id)), title: hasReminder(m.id) ? 'Tap to cancel the reminder' : 'Get a reminder on release day', on: { click: function () { toggleRemind(m.id); } } }, [icon('bell', 15), hasReminder(m.id) ? 'Reminder set' : 'Remind me']),
        t ? h('button', { type: 'button', class: 'btn small', on: { click: function () { addToCalendar(m); } } }, [icon('cal', 15), 'Add to calendar']) : null
      ])
    ]);
    var fol = S.mine.following || [], fw = planCounts(m.id, fol).who.filter(function (x) { return x[1] !== 'c'; });
    var foot = fw.length ? h('div', { class: 'note pre-fr' }, [h('span', { class: 'faces' }, fw.slice(0, 3).map(function (x) { return avatarEl(x[0], 24); })),
      h('span', {}, [personEl(fw[0][0]), fw.length > 1 ? ' and ' + (fw.length - 1) + (fw.length > 2 ? ' others' : ' other') + ' you follow plan to watch it' : ', who you follow, plans to watch it'])])
      : h('div', { class: 'note', text: my === 'a' ? 'Reminder set for release day · tap again to clear' : my === 'b' ? 'Saved to your watchlist · tap again to clear' : my === 'c' ? 'No reminders for this one · tap again to clear'
        : (o ? 'Day one' : 'First weekend') + ' sets a release-day reminder; ' + (o ? 'Later' : 'On OTT') + ' saves it to your watchlist.' });
    var mid = h('div', { class: 'vs-mine pre-plan', role: 'group', 'aria-label': 'Your plan' }, [
      h('div', { class: 'kicker', text: 'Your plan · how will you watch it?' }),
      h('div', { class: 'vbtns' }, ps.map(function (x) {
        return h('button', { type: 'button', class: 'vb2 ' + x[0], 'aria-pressed': String(my === x[0]), on: { click: function () { setPlan(m.id, x[0]); } } },
          [h('span', { class: 'vi i-' + planIcon(m, x[0]) }, [icon(planIcon(m, x[0]), 20)]), h('span', { class: 'vt' }, [h('b', { text: x[1] }), h('small', { text: x[2] })])]);
      })),
      foot
    ]);
    var shown = pc.tot >= MIN_PLANS, rk = shown ? buzzRank(m) : null, pctOf = function (k) { return Math.round(100 * pc[k] / pc.tot); };
    var right = h('div', { class: 'vs-peer pre-buzz' }, [
      h('div', { class: 'kicker', text: 'Buzz on Reelscore' }),
      shown ? h('div', { class: 'vs-big' }, rk ? [h('span', { class: 'big rank', text: '#' + rk.n }), h('span', { class: 'vs-cap', text: 'most awaited in ' + rk.when })]
          : [h('span', { class: 'big', text: pctOf('a') + '%' }), h('span', { class: 'vs-cap', text: 'plan to watch it ' + (o ? 'day one' : 'first weekend') })])
        : h('div', { class: 'vs-big' }, [h('span', { class: 'big', style: 'font-size:30px;color:var(--text)', text: 'Be one of the first' })]),
      shown ? h('div', { class: 'vs-bar', role: 'img', 'aria-label': ps.map(function (x) { return x[1] + ' ' + pctOf(x[0]) + '%'; }).join(', ') },
          ps.map(function (x) { return h('span', { style: 'width:' + (100 * pc[x[0]] / pc.tot) + '%;background:' + SPLITCOL[x[0]] }); }))
        : h('div', { class: 'vs-bar pre-empty', 'aria-hidden': 'true' }),
      shown ? h('div', { class: 'vs-leg' }, ps.map(function (x) {
          return h('span', {}, [h('i', { class: 'sw', style: 'background:' + SPLITCOL[x[0]] }), h('span', { class: 'note', text: x[1] + ' ' + pctOf(x[0]) + '%' })]);
        }).concat([h('span', { class: 'note', text: pc.tot + ' plans' })]))
        : h('div', { class: 'note', text: pc.tot ? pc.tot + (pc.tot === 1 ? ' plan' : ' plans') + ' so far · the split shows at ' + MIN_PLANS : 'The split shows once ' + MIN_PLANS + ' people have made a plan.' })
    ]);
    return h('section', { class: 'card vstrip pre' + (cdName && cd ? ' named' : ''), style: cdc ? '--cd:' + cdc : null, 'aria-label': 'Before release' }, [left, h('div', { class: 'vs-sep' }), mid, h('div', { class: 'vs-sep' }), right]);
  }

  // Score, your verdict, and what people you follow said: one strip under the banner.
  function verdictStrip(m, rel) {
    if (!rel) return preStrip(m);
    var d = m.data, sc = score(m.id), vs = vset(m), my = myVerdict(m.id), pct = shownPct(sc);
    var left = h('div', { class: 'vs-score' }, [
      h('div', { class: 'kicker', text: 'Reelscore verdict' }),
      h('div', { class: 'vs-big' }, [
        h('span', { class: 'big', style: pct === null ? 'font-size:30px' : '', text: pct === null ? (rel ? 'Verdicts open' : 'Opens on release') : pct + '%' }),
        pct !== null ? h('span', { class: 'vs-cap', text: 'say it’s worth watching' }) : null
      ]),
      pct !== null ? h('div', { class: 'vs-bar', role: 'img', 'aria-label': vs.map(function (x) { return x[1] + ' ' + Math.round(100 * sc.n[x[0]] / sc.tot) + '%'; }).join(', ') },
        vs.map(function (x) { return h('span', { style: 'width:' + (100 * sc.n[x[0]] / sc.tot) + '%;background:' + SPLITCOL[x[0]] }); })) : null,
      h('div', { class: 'vs-leg' }, (pct !== null ? vs.map(function (x) {
        return h('span', { style: 'color:' + SPLITCOL[x[0]] }, [icon(vIconName(m, x[0]), 14), h('span', { class: 'note', text: x[1] + ' ' + Math.round(100 * sc.n[x[0]] / sc.tot) + '%' })]);
      }) : []).concat([h('span', { class: 'note' }, [sc.tot && pct === null ? sc.tot + (sc.tot === 1 ? ' verdict' : ' verdicts') + ' so far · the score shows at ' + MIN_SHOW : pct !== null ? sc.tot + ' verdicts' : rel ? 'Seen it? Your verdict starts the score' : 'Verdicts open on ' + fmtDate(d.releaseDate, true),
        ' · ', h('a', { href: '/about', style: 'color:var(--muted)', text: 'How scores work' })])]))
    ]);
    var mid = rel ? h('div', { class: 'vs-mine', role: 'group', 'aria-label': 'Your verdict' }, [
      h('div', { class: 'kicker', text: my ? 'Your verdict · tap again to clear' : 'Your verdict' }),
      h('div', { class: 'vbtns' }, vs.map(function (x) {
        return h('button', { type: 'button', class: 'vb2 ' + x[0], 'aria-pressed': String(my === x[0]), on: { click: function () { setVerdict(m.id, x[0]); } } },
          [h('span', { class: 'vi i-' + vIconName(m, x[0]) }, [icon(vIconName(m, x[0]), 20)]), h('span', { class: 'vt' }, [h('b', { text: x[1] }), h('small', { text: x[2] })])]);
      }))
    ]) : h('div', { class: 'vs-mine' }, [
      h('div', { class: 'kicker', text: 'Releases ' + fmtDate(d.releaseDate, true) }),
      h('button', { type: 'button', class: 'btn', 'aria-pressed': String(hasReminder(m.id)), on: { click: function () { toggleRemind(m.id); } } }, [hasReminder(m.id) ? '🔔 Reminder set' : 'Remind me on release'])
    ]);
    var fs = score(m.id, S.mine.following), fr = fs.raters;
    var right = h('div', { class: 'vs-peer' }, [
      h('div', { class: 'kicker', text: 'People you follow' }),
      fr.length >= 3 ? h('div', { class: 'vs-big' }, [h('span', { class: 'big', style: 'font-size:34px', text: fs.pct + '%' }), h('span', { class: 'vs-cap', text: fr.length + ' ratings' })])
        : h('div', { style: 'font-size:15px;font-weight:600', text: fr.length ? fr.length + (fr.length === 1 ? ' person you follow rated it' : ' people you follow rated it') : (S.mine.following.length ? 'None of them have rated it yet' : 'You’re not following anyone yet') }),
      fr.length ? h('div', { class: 'faces' }, fr.slice(0, 5).map(function (u) { return avatarEl(u, 32); })) : null,
      fr.length >= 3 ? null : h('div', { class: 'note' }, ['Their score shows at 3 ratings. ', h('a', { href: '/my-list', text: 'Find people' })])
    ]);
    return h('section', { class: 'card vstrip', 'aria-label': 'Verdict' }, [left, h('div', { class: 'vs-sep' }), mid, h('div', { class: 'vs-sep' }), boCall(m) || right]);
  }

  // Box office: the tiles are in place; figures come once there's a source for them.
  // Box office figures entered in Admin (₹ crore). null when none are set.
  function boData(m) {
    var d = m.data, n = function (v) { var x = parseFloat(String(v == null ? '' : v).replace(/[,₹\s]|cr(ore)?s?\.?$/ig, '')); return isFinite(x) && x > 0 ? x : null; };
    var chg = parseFloat(String(d.boDayChg == null ? '' : d.boDayChg).replace(/[%\s]/g, ''));
    var o = { gross: n(d.boGross), nett: n(d.boNett), world: n(d.boWorld), day: n(d.boDay), chg: isFinite(chg) ? chg : null, updated: /^\d{4}-\d{2}-\d{2}$/.test(d.boUpdated || '') ? d.boUpdated : '', source: String(d.boSource || '').trim(), url: safeUrl(d.boUrl) };
    return o.gross || o.nett || o.world || o.day ? o : null;
  }
  // The figures with every tile filled: India gross, India nett, worldwide gross, and the fourth tile (the latest day's
  // nett while it runs in theatres or when one is entered, else overseas = worldwide minus India gross). null otherwise,
  // so the section, and "Box Office" in the page title, only appear with the full set. Same rule in scripts/build.mjs.
  function boFull(m) {
    var b = boData(m); if (!b) return null;
    var fourth = m.data.section === 'In theatres' || b.day ? b.day : (b.world && b.gross && b.world > b.gross ? b.world - b.gross : null);
    return b.gross && b.nett && b.world && fourth ? b : null;
  }
  function crore(x) { return x == null ? '₹ — Cr' : '₹' + (Math.round(x * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Cr'; }
  var CLUBS = [100, 250, 500, 1000, 1500, 2000];
  function boSourceLine(bo) {
    var bits = [];
    if (bo.updated) bits.push('As of ' + fmtDate(bo.updated, true));
    var src = bo.source || (bo.url ? (function () { try { return new URL(bo.url).hostname.replace(/^www\./, ''); } catch (e) { return ''; } })() : '');
    return h('div', { class: 'note' }, [bits.join(''), bits.length && src ? ' · ' : '', src ? 'Source: ' : '', src ? (bo.url ? h('a', { href: bo.url, target: '_blank', rel: 'noopener nofollow', style: 'color:var(--muted)', text: src }) : src) : '', ' · reported figures']);
  }
  // ---------- box office in detail: daily figures (Admin > Daily figures, or the CSV import) ----------
  var WD3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function boN(v) { var x = parseFloat(String(v == null ? '' : v).replace(/[,₹\s]|cr(ore)?s?\.?$/ig, '')); return isFinite(x) && x > 0 ? x : null; }
  // Rows with a date and that day's India nett, numbered from the release date (release day = Day 1), oldest first.
  function boDays(m) {
    var rel = String(m.data.releaseDate || ''); if (!/^\d{4}-\d{2}-\d{2}$/.test(rel)) return [];
    var r0 = Date.parse(rel + 'T00:00:00'), seen = {};
    var rows = (m.data.boDaily || []).filter(function (r) { return r && /^\d{4}-\d{2}-\d{2}$/.test(r.date || '') && boN(r.nett) != null; })
      .map(function (r) { var t = Date.parse(r.date + 'T00:00:00'); return { date: r.date, t: t, nett: boN(r.nett), dgross: boN(r.dgross), world: boN(r.world), langs: String(r.langs || '').trim(), day: Math.round((t - r0) / 864e5) + 1, wd: new Date(t).getDay() }; })
      .filter(function (r) { if (seen[r.date] || r.day < 1) return false; seen[r.date] = 1; return true; })
      .sort(function (a, b) { return a.t - b.t; });
    // Trade weeks run Friday to Thursday. Week 1 runs from release to the first Thursday at least a week in
    // (a Thursday release makes an 8-day Week 1), or to the first Thursday for weekend and early-week releases.
    var wr = new Date(r0).getDay(), minD = wr >= 3 && wr <= 5 ? 7 : 2, end1 = minD;
    while (new Date(r0 + (end1 - 1) * 864e5).getDay() !== 4) end1++;
    rows.end1 = end1;
    rows.forEach(function (r) { r.wk = r.day <= end1 ? 0 : 1 + Math.floor((r.day - end1 - 1) / 7); });
    return rows;
  }
  function wkStart(rows, k) { return k === 0 ? 1 : rows.end1 + 7 * (k - 1) + 1; }
  function wkEnd(rows, k) { return k === 0 ? rows.end1 : rows.end1 + 7 * k; }
  function dmy(r) { var p = r.date.split('-'); return WD3[r.wd] + ' ' + (+p[2]) + ' ' + MONTHS[+p[1] - 1]; }
  function pctCh(a, b) { return b ? Math.round(1000 * (a - b) / b) / 10 : null; }
  function chgEl(c, vs) { return c == null ? h('span', { class: 'note', text: '–' }) : h('span', { class: 'bochg ' + (c < 0 ? 'dn' : 'up'), text: (c < 0 ? '▼ ' : '▲ ') + Math.abs(c) + '%' + (vs ? ' ' + vs : '') }); }
  // Club tracker on India nett: crossed clubs get a tick and, when the daily rows show it, the day it was crossed.
  var NCLUBS = [100, 200, 300, 500, 1000, 1500];
  function boClubs(m, bo, rows) {
    var w = bo && bo.nett; if (!w) return null;
    var CL = NCLUBS, n = CL.length, pos = function (v) {
      if (v >= CL[n - 1]) return 100;
      var k = 0; while (k < n - 1 && v >= CL[k + 1]) k++;
      if (v < CL[0]) return 0;
      return 100 * (k + (v - CL[k]) / (CL[k + 1] - CL[k])) / (n - 1);
    };
    // Running India nett per day: the stated total when a row has one, else the sum of every day from Day 1 (only while no day is missing).
    var run = 0, full = true, cum = (m.data.boDaily || []).reduce(function (o, r) { if (r && r.date) o[r.date] = boN(r.tnett); return o; }, {});
    var tr = rows.map(function (r, i) {
      full = full && r.day === (i ? rows[i - 1].day + 1 : 1); run += r.nett;
      return { day: r.day, tot: cum[r.date] != null ? cum[r.date] : full ? Math.round(run * 100) / 100 : null };
    }).filter(function (r) { return r.tot != null; });
    var next = CL.filter(function (c) { return c > w; })[0];
    var marks = CL.map(function (c, k) {
      var done = w >= c, hi = -1;
      for (var q = 0; q < tr.length; q++) if (tr[q].tot >= c) { hi = q; break; }
      var hit = hi >= 0 ? tr[hi] : null, exact = hit && (hit.day === 1 || (hi > 0 && tr[hi - 1].tot < c && tr[hi - 1].day === hit.day - 1));
      return h('div', { class: 'bc-mark' + (done ? ' done' : '') + (c === next ? ' next' : ''), style: 'left:' + (100 * k / (n - 1)) + '%' }, [
        h('span', { class: 'bc-lab' }, ['₹' + c.toLocaleString('en-IN'), h('i', { text: ' Cr' })]), h('span', { class: 'bc-dot', 'aria-hidden': 'true', text: done ? '✓' : '' }),
        done && exact ? h('span', { class: 'bc-day', text: 'Day ' + hit.day }) : null]);
    });
    var nowX = pos(w);
    return h('div', { class: 'bo-blk' }, [
      h('div', { class: 'bo-bh' }, [h('h3', { text: 'Club tracker · India nett' }), h('span', { class: 'note' }, ['Now ', h('b', { text: crore(w) })].concat(next ? [' · ', h('b', { text: crore(next - w) }), ' to the ₹' + next.toLocaleString('en-IN') + ' Cr club'] : [' · past every club']))]),
      h('div', { class: 'bo-card bc', role: 'img', 'aria-label': 'India nett ' + crore(w) + (next ? ', ' + crore(next - w) + ' short of the ₹' + next.toLocaleString('en-IN') + ' Cr club' : '') }, [
        h('div', { class: 'bc-track' }, [h('div', { class: 'bc-fill', style: 'width:' + nowX + '%' }), h('div', { class: 'bc-now', style: 'left:' + nowX + '%' })].concat(marks))])
    ]);
  }
  function boDayByDay(m, rows) {
    S.boView = S.boView || {}; S.boAll = S.boAll || {};
    var view = S.boView[m.id] === 'table' ? 'table' : 'chart', last = rows[rows.length - 1];
    var byDay = {}; rows.forEach(function (r, i) { byDay[r.day] = r; r.prev = i && rows[i - 1].day === r.day - 1 ? rows[i - 1] : null; r.chg = r.prev ? pctCh(r.nett, r.prev.nett) : null; });
    var max = Math.max.apply(null, rows.map(function (r) { return r.nett; })), d0 = rows[0].day, d1 = last.day, span = d1 - d0 + 1;
    var sec;
    var toggle = h('span', { class: 'seg', role: 'group', 'aria-label': 'Show as' }, [['chart', 'Chart'], ['table', 'Table']].map(function (o) {
      return h('button', { type: 'button', class: o[0] === view ? 'on' : '', 'aria-pressed': String(o[0] === view), text: o[1], on: { click: function () { S.boView[m.id] = o[0]; swapInPlace($('bocoll'), boCollBlock(m), '#bocoll .seg .on'); } } });
    }));
    var body;
    if (view === 'chart') {
      var every = span > 45 ? 7 : span > 24 ? 3 : span > 14 ? 2 : 1, bars = [], xs = [];
      for (var d = d0; d <= d1; d++) {
        var r = byDay[d];
        if (!r) { bars.push(h('span', { class: 'bd-gap', 'aria-hidden': 'true' })); xs.push(h('span', { text: '' })); continue; }
        var cls = r === last ? ' last' : (r.wd === 5 || r.wd === 6 || r.wd === 0) ? ' wk' : '';
        var fx = (d - d0) / Math.max(1, span - 1); cls += fx < 0.2 ? ' tl' : fx > 0.8 ? ' tr' : '';
        var tip = 'Day ' + r.day + ' · ' + dmy(r);
        bars.push(h('button', { type: 'button', class: 'bd-bar' + cls, style: 'height:' + Math.max(2, 100 * r.nett / max) + '%', 'aria-label': tip + ': ' + crore(r.nett) + ' India nett' + (r.chg != null ? ', ' + (r.chg < 0 ? 'down ' : 'up ') + Math.abs(r.chg) + '% on the day before' : '') }, [
          h('span', { class: 'bd-tip' }, [h('b', { text: tip }), h('span', { text: 'India nett ' + crore(r.nett) }), r.chg != null ? chgEl(r.chg, 'vs Day ' + (r.day - 1)) : null])]));
        xs.push(h('span', { text: (d - d0) % every === 0 || d === d1 ? String(d) : '' }));
      }
      var weeks = [], w0 = rows[0].wk, w1 = last.wk;
      for (var wk = w0; wk <= w1; wk++) {
        var a = Math.max(d0, wkStart(rows, wk)), b = Math.min(d1, wkEnd(rows, wk));
        weeks.push(h('span', { style: 'flex:' + (b - a + 1) }, [h('i'), 'Week ' + (wk + 1) + (wkEnd(rows, wk) > d1 ? ' (so far)' : '')]));
      }
      body = h('div', { class: 'bo-card bd' }, [h('div', { class: 'bd-bars' }, bars), h('div', { class: 'bd-x', 'aria-hidden': 'true' }, xs), h('div', { class: 'bd-w', 'aria-hidden': 'true' }, weeks),
        h('div', { class: 'bd-key note' }, [h('span', {}, [h('i', { class: 'wk' }), 'Fri–Sun']), h('span', {}, [h('i'), 'Mon–Thu']), h('span', {}, [h('i', { class: 'last' }), 'Latest day'])])]);
    } else {
      var all = !!S.boAll[m.id], list = rows.slice().reverse(), show = all ? list : list.slice(0, 7);
      var running = rows[0].day === 1 && rows.length === d1, anyG = rows.some(function (r) { return r.dgross; }); // running: every day from Day 1 is there
      var acc = 0, run = {}; rows.forEach(function (r) { acc += r.nett; run[r.day] = acc; });
      body = h('div', { class: 'bo-card' }, [h('table', { class: 'bo-tbl' }, [
        h('thead', {}, [h('tr', {}, [h('th', { text: 'Day' }), h('th', { text: 'Date' }), h('th', { class: 'n', text: 'India nett' })].concat(anyG ? [h('th', { class: 'n', text: 'India gross' })] : []).concat([h('th', { class: 'n', text: 'Change' })]).concat(running ? [h('th', { class: 'n', text: 'Running India nett' })] : []))]),
        h('tbody', {}, show.map(function (r) {
          return h('tr', {}, [h('td', {}, [h('b', { text: 'Day ' + r.day })]), h('td', { class: 'note', text: dmy(r) }), h('td', { class: 'n', text: crore(r.nett) })].concat(anyG ? [h('td', { class: 'n', text: r.dgross ? crore(r.dgross) : '–' })] : []).concat([h('td', { class: 'n' }, [chgEl(r.chg)])]).concat(running ? [h('td', { class: 'n', text: crore(run[r.day]) })] : []));
        }))]),
        list.length > 7 ? h('button', { type: 'button', class: 'btn more', 'aria-expanded': String(all), text: all ? 'Show fewer' : 'Show all ' + list.length + ' days', on: { click: function () { S.boAll[m.id] = !all; swapInPlace($('bocoll'), boCollBlock(m), '#bocoll .bo-card .btn.more'); } } }) : null]);
    }
    // Quick stats: opening day, opening weekend (release day to the first Sunday), best day, Mon–Thu average in the latest week.
    var first = byDay[1], sun = 0; for (var k = 1; k <= 7; k++) { if (byDay[k] && byDay[k].wd === 0) { sun = k; break; } }
    var owk = null; if (first && sun) { owk = 0; for (k = 1; k <= sun; k++) { if (!byDay[k]) { owk = null; break; } owk += byDay[k].nett; } }
    var best = rows.reduce(function (a, r) { return !a || r.nett > a.nett ? r : a; }, null);
    var lw = last.wk, wdays = rows.filter(function (r) { return r.wk === lw && r.wd >= 1 && r.wd <= 4; });
    var stats = [first ? ['Opening day', crore(first.nett), dmy(first)] : null, owk != null ? ['Opening weekend', crore(owk), 'Days 1–' + sun] : null,
      ['Best day', crore(best.nett), 'Day ' + best.day + ' · ' + WD3[best.wd]],
      wdays.length >= 2 ? ['Mon–Thu average', crore(wdays.reduce(function (a, r) { return a + r.nett; }, 0) / wdays.length), 'Week ' + (lw + 1)] : null].filter(Boolean);
    return h('div', { class: 'bo-blk' }, [h('div', { class: 'bo-bh' }, [h('h3', { text: 'Day by day · India nett' }), toggle]), body,
      h('div', { class: 'bo-stats' }, stats.map(function (t) { return h('div', { class: 'bo-tile' }, [h('span', { class: 'kicker', text: t[0] }), h('span', { class: 'bo-v on sm', text: t[1] }), h('span', { class: 'note', text: t[2] })]); }))]);
  }
  function boWeeks(rows) {
    var last = rows[rows.length - 1].day, wk = {};
    rows.forEach(function (r) { (wk[r.wk] = wk[r.wk] || []).push(r); });
    var keys = Object.keys(wk).map(Number).sort(function (a, b) { return a - b; }); if (keys.length < 1) return null;
    var anyG = rows.some(function (r) { return r.dgross; });
    var prevFull = null;
    var trs = keys.map(function (k) {
      var len = wkEnd(rows, k) - wkStart(rows, k) + 1, list = wk[k], sum = list.reduce(function (a, r) { return a + r.nett; }, 0), ended = wkEnd(rows, k) <= last, full = list.length === len;
      var gs = list.every(function (r) { return r.dgross; }) ? list.reduce(function (a, r) { return a + r.dgross; }, 0) : null;
      var note = full ? '' : ended ? ' · ' + list.length + ' of ' + len + ' days' : ' · so far';
      var c = full && prevFull != null ? pctCh(sum, prevFull) : null; if (full) prevFull = sum; else prevFull = null;
      return h('tr', {}, [h('td', {}, [h('b', { text: 'Week ' + (k + 1) })]), h('td', { class: 'note', text: 'Days ' + wkStart(rows, k) + '–' + Math.min(wkEnd(rows, k), ended ? wkEnd(rows, k) : last) + note }), h('td', { class: 'n', text: crore(sum) })].concat(anyG ? [h('td', { class: 'n', text: gs != null ? crore(gs) : '–' })] : []).concat([h('td', { class: 'n' }, [chgEl(c)])]));
    });
    return h('div', {}, [h('div', { class: 'bo-bh' }, [h('h3', { text: 'Week by week' })]), h('div', { class: 'bo-card' }, [h('table', { class: 'bo-tbl' }, [
      h('thead', {}, [h('tr', {}, [h('th', { text: 'Week' }), h('th', { text: 'Days' }), h('th', { class: 'n', text: 'India nett' })].concat(anyG ? [h('th', { class: 'n', text: 'India gross' })] : []).concat([h('th', { class: 'n', text: 'vs week before' })]))]), h('tbody', {}, trs)])])]);
  }
  var LANG_COL = ['#F5A524', '#7FB2FF', '#B58CFF', '#7BD88F', '#FF7A6B', '#5FD3C6'];
  function boLangs(rows, bo) {
    var ov = bo && bo.world && bo.gross && bo.world > bo.gross ? (Math.round(1000 * bo.gross / bo.world) / 10) + '% / ' + (Math.round(1000 * (bo.world - bo.gross) / bo.world) / 10) + '%' : '';
    var r = rows.slice().reverse().filter(function (x) { return x.langs; })[0]; if (!r) return null;
    var parts = r.langs.split(/[,;]/).map(function (t) { var mm = t.trim().match(/^([A-Za-z][A-Za-z .]*?)\s*[:\-]?\s*₹?\s*([\d.]+)/); return mm ? [mm[1].trim(), parseFloat(mm[2])] : null; }).filter(function (x) { return x && x[1] > 0; });
    if (parts.length < 2) return null;
    var tot = parts.reduce(function (a, x) { return a + x[1]; }, 0);
    return h('div', {}, [h('div', { class: 'bo-bh' }, [h('h3', { text: 'By language' }), h('span', { class: 'note', text: 'India nett, Days 1–' + r.day })]),
      h('div', { class: 'bo-card' }, [h('div', { class: 'bl-bar', role: 'img', 'aria-label': parts.map(function (x) { return x[0] + ' ' + Math.round(100 * x[1] / tot) + '%'; }).join(', ') }, parts.map(function (x, i) { return h('span', { style: 'width:' + (100 * x[1] / tot) + '%;background:' + LANG_COL[i % LANG_COL.length] }); })),
        h('div', { class: 'bl-key' }, parts.map(function (x, i) { return h('span', { class: 'note' }, [h('i', { style: 'background:' + LANG_COL[i % LANG_COL.length] }), x[0] + ' ' + crore(x[1]) + ' · ' + (Math.round(1000 * x[1] / tot) / 10) + '%']); })),
        ov ? h('div', { class: 'bl-ov note' }, ['India gross / overseas', h('b', { text: ov })]) : null])]);
  }

  // Box office: tiles from the Admin figures, shown only when every tile has a figure (boFull).
  function boxOfficeBlock(m) {
    if (isTv(m) || isOtt(m) || !released(m)) return null;
    var bo = boFull(m), live = m.data.section === 'In theatres', dt = String(m.data.releaseDate || '');
    if (!bo) return null;
    var b = bo;
    // Which day the latest figure is for: days from release to "Figures as of", counting release day as Day 1.
    var dayN = b.updated && /^\d{4}-\d{2}-\d{2}$/.test(dt) ? Math.round((new Date(b.updated + 'T00:00:00') - new Date(dt + 'T00:00:00')) / 864e5) + 1 : 0;
    var dayLab = dayN > 0 ? 'Day ' + dayN + ' · nett' : 'Latest day · nett';
    var daySub = b.chg != null && b.chg !== 0 ? h('span', { class: 'note bochg ' + (b.chg < 0 ? 'dn' : 'up') }, [(b.chg < 0 ? '▼ ' : '▲ ') + Math.abs(b.chg) + '% vs ' + (dayN > 1 ? 'Day ' + (dayN - 1) : 'the day before')]) : 'India';
    var tiles = [['India gross', b.gross, 'before taxes'], ['India nett', b.nett, 'after taxes'], ['Worldwide gross', b.world, 'India + overseas'],
      live || b.day ? [dayLab, b.day, daySub] : ['Overseas gross', b.world && b.gross && b.world > b.gross ? b.world - b.gross : null, 'outside India']];
    return h('section', { class: 'tsec', id: 'boxoffice', 'aria-labelledby': 'h-bo' }, [
      h('div', { class: 'tsec-h' }, [h('h2', { id: 'h-bo' }, [m.data.title + ' box office']), bo ? null : h('span', { class: 'soon', text: 'Coming soon' })]),
      h('div', { class: 'bo-tiles' }, tiles.map(function (t) {
        return h('div', { class: 'bo-tile' }, [h('span', { class: 'kicker', text: t[0] }), h('span', { class: 'bo-v' + (t[1] == null ? '' : ' on'), text: crore(t[1]) }), typeof t[2] === 'string' ? h('span', { class: 'note', text: t[2] }) : t[2]]);
      })),
      bo ? boSourceLine(bo) : h('div', { class: 'note', text: live ? 'Collections will show here while it runs in theatres.' : 'Collections will show here.' })
    ].concat(boMore(m, bo)));
  }
  // With 2 or more days of figures: the club tracker, day by day, week by week and the language split.
  function boMore(m, bo) {
    return bo ? [boClubs(m, bo, boDays(m))] : [];
  }
  // Box office collections (its own section, above Reviews): day by day, week by week and the language split. Needs 2 or more days.
  function boCollBlock(m) {
    if (isTv(m) || isOtt(m) || !released(m)) return null;
    var bo = boData(m), rows = boDays(m); if (!bo || rows.length < 2) return null;
    var wk = boWeeks(rows), lg = boLangs(rows, bo);
    return h('section', { class: 'tsec', id: 'bocoll', 'aria-labelledby': 'h-bocoll' }, [
      h('div', { class: 'tsec-h' }, [h('h2', { id: 'h-bocoll', text: 'Box office collections' })]),
      boDayByDay(m, rows), wk || lg ? h('div', { class: 'bo-2col' + (lg ? '' : ' one') }, [wk, lg]) : null]);
  }
  // The box office call in the verdict strip: will it reach the next club? Votes live in each person's public verdicts doc (bo).
  function boCall(m) {
    var bo = boData(m); if (!bo || !bo.world || m.data.section !== 'In theatres' || isTv(m) || isOtt(m)) return null;
    var next = CLUBS.filter(function (c) { return c > bo.world; })[0], prev = CLUBS.filter(function (c) { return c <= bo.world; }).pop() || 0;
    var key = m.id + ':' + (next || 'done'), mine = S.uid && S.verdicts[S.uid] && (S.verdicts[S.uid].bo || {})[key];
    var y = 0, n = 0;
    Object.keys(S.verdicts).forEach(function (u) { var x = (S.verdicts[u].bo || {})[key]; if (x === 'y') y++; else if (x === 'n') n++; });
    var vote = function (val) {
      if (!needUser() || writing.v || !verdictsReady()) return;
      var cur = clone(S.verdicts[S.uid] || { v: {} }); cur.v = cur.v || {}; cur.bo = cur.bo || {};
      if (cur.bo[key] === val) delete cur.bo[key]; else cur.bo[key] = val;
      cur.at = new Date().toISOString(); S.verdicts[S.uid] = cur; if (!patchTitleBits()) render();
      writing.v = true; guard(S.db.doc('verdicts/' + S.uid).set(cur)).then(function () { writing.v = false; });
    };
    var pctTo = next ? Math.max(4, Math.min(100, Math.round(100 * (bo.world - prev) / (next - prev)))) : 100;
    var tot = y + n;
    return h('div', { class: 'vs-peer vs-bo' }, [
      h('div', { class: 'kicker' }, [h('span', { style: 'color:#7BD88F', text: '● ' }), 'Box office', bo.updated ? ' · as of ' + fmtDate(bo.updated) : '']),
      h('div', { class: 'vs-big' }, [h('span', { class: 'bo-big', text: crore(bo.world) }), h('span', { class: 'note', text: 'worldwide' })]),
      h('div', { class: 'vs-bar' }, [h('span', { style: 'width:' + pctTo + '%;background:var(--accent)' })]),
      h('div', { class: 'vs-bofoot' }, [
        h('div', { class: 'bogap', text: next ? crore(next - bo.world) + ' to the ₹' + next.toLocaleString('en-IN') + ' Cr club' : 'Past the ₹2,000 Cr club' }),
        next ? h('div', { class: 'bocall' }, [h('span', { class: 'boq', text: 'Will it get there?' })].concat([['y', 'Yes'], ['n', 'No']].map(function (o) {
          return h('button', { type: 'button', class: 'chip', 'aria-pressed': String(mine === o[0]), 'aria-label': (o[0] === 'y' ? 'Yes, it will' : 'No, it falls short'), on: { click: function () { vote(o[0]); } } }, [o[1] + (mine && tot ? ' · ' + Math.round(100 * (o[0] === 'y' ? y : n) / tot) + '%' : '')]);
        })).concat(mine && tot ? [h('span', { class: 'note', text: tot + (tot === 1 ? ' call' : ' calls') })] : [])) : null
      ])
    ]);
  }


  // Videos are split into their own sections: Trailers (a player with every trailer under it), Songs, Interviews and Episodes (grids that play in place).
  function vidGroups(m, items) {
    var g = { trailers: [], songs: [], extras: [], interviews: [], episodes: [] };
    items.forEach(function (x, i) {
      var k = x.cat === 'extras' ? 'extras' : x.cat === 'interviews' || /interview/i.test(x.kind) ? 'interviews' : x.cat === 'songs' ? 'songs' : x.cat === 'episodes' ? 'episodes' : 'trailers';
      g[k].push(i);
    });
    return [['trailers', isTv(m) ? 'Trailers & promos' : 'Trailers'], ['songs', 'Songs'], ['interviews', 'Cast interviews'], ['extras', 'Fan videos'], ['episodes', 'Episodes']]
      .filter(function (k) { return g[k[0]].length; }).map(function (k) { return { id: k[0], label: k[1], idx: g[k[0]] }; });
  }
  function vThumb(m, y, w) {
    if (y.yt) return h('img', { src: y.thumb && y.thumbHd && w > 400 ? y.thumb : 'https://i.ytimg.com/vi/' + y.yt + '/' + (w > 400 ? 'hqdefault' : 'mqdefault') + '.jpg', alt: '', width: 320, height: 180, loading: 'lazy' });
    var a = artLazy(m, 'banner', 640); return h('span', { class: 'ph', style: a.style, 'data-bg': a.bg });
  }
  // Under a video card: its singers (or people) and length; the type when neither is known.
  function vSub(y, can) {
    var bits = [y.artists, y.dur].filter(Boolean);
    return h('span', { class: 'note vsub', text: bits.length ? bits.join(' · ') : can ? y.kind : y.kind + ' · link coming' });
  }
  function vidStage(m, items, i, playing, onClose) {
    var d = m.data, x = items[i], media = null;
    if (playing && x.yt) media = ytClock(h('iframe', { src: 'https://www.youtube-nocookie.com/embed/' + x.yt + '?autoplay=1&rel=0&playsinline=1&modestbranding=1&enablejsapi=1&origin=' + encodeURIComponent(location.origin),
      title: d.title + ' · ' + x.title, allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin' }));
    else if (playing && x.clip) {
      media = h('video', { src: x.clip, controls: true, autoplay: true, playsinline: true, preload: 'auto' });
      media.setAttribute('aria-label', d.title + ' · ' + x.title);
      setTimeout(function () { safePlay(media); }, 0);
    }
    var bg = x.yt ? 'background-image:url("https://i.ytimg.com/vi/' + x.yt + '/' + (x.thumbHd ? 'maxresdefault' : 'hqdefault') + '.jpg")' : art(m, 'banner');
    var stage = h('div', { class: 'stage' + (playing ? ' on' : ''), style: playing ? '' : bg }, playing ? [media] : [
      h('div', { class: 'shade' }),
      h('div', { class: 'top' }, [h('span', { class: 'kb', text: String(x.kind).toUpperCase() })]),
      x.yt || x.clip ? h('button', { type: 'button', class: 'big', 'aria-label': 'Play ' + x.title, on: { click: function () { playVid(m.id, i); } } }, [h('span', { 'aria-hidden': 'true', text: '▶' })])
        : h('div', { class: 'big off', text: 'Link coming' })
    ]);
    var vp = videoPaths(d).filter(function (p) { return p.yt === x.yt; })[0];
    var info = h('div', { class: 'thx-i' }, [
      h('div', { style: 'min-width:0' }, [h('div', { class: 'kicker', style: 'color:var(--accent)', text: playing ? 'Now playing' : x.kind }), h('h3', { text: x.title })]),
      h('div', { class: 'thx-c' }, [
        playing && media ? miniBtn('btn small', function () {
          var t = media.tagName === 'VIDEO' ? media.currentTime : media._t;
          var was = S.vplay ? S.vplay.i : -1; S.vplay = null; if (!refreshVideos(m.id, [was])) { S.vKeep = null; render(true); }
          toMini(m, x, t);
        }) : null,
        vp ? h('button', { type: 'button', class: 'btn small', 'aria-label': 'Share ' + x.title, text: 'Share', on: { click: function () { shareVideo(m, vp, movieUrl(m) + vp.path); } } }) : null,
        onClose ? h('button', { type: 'button', class: 'btn small', 'aria-label': 'Close player', text: 'Close', on: { click: onClose } }) : null
      ])
    ]);
    return [stage, info];
  }
  function vidSection(m, g, items) {
    S.vsel = S.vsel || {}; S.vmore = S.vmore || {};
    var key = m.id + ':' + g.id, pl = S.vplay && S.vplay.mid === m.id && g.idx.indexOf(S.vplay.i) !== -1 ? S.vplay.i : -1;
    var playing = pl !== -1 && !!(items[pl].yt || items[pl].clip);
    var kids = [h('div', { class: 'tsec-h' }, [h('h2', { id: 'h-' + g.id }, [m.data.title + ' ' + g.label.toLowerCase(), ' ', h('span', { class: 'cnt', text: String(g.idx.length) })])])];
    var stop = function () { var was = S.vplay ? S.vplay.i : -1; S.vplay = null; if (!refreshVideos(m.id, [was])) { S.vKeep = null; render(true); } };
    var vurl = function (y) { return y.yt ? videoUrl(m, y.yt) : ''; };
    if (g.id === 'trailers') {
      var cur = playing ? pl : (g.idx.indexOf(S.vsel[key]) !== -1 ? S.vsel[key] : g.idx[0]);
      kids = kids.concat(vidStage(m, items, cur, playing, null));
      if (g.idx.length > 1) kids.push(h('div', { class: 'vgrid' }, g.idx.map(function (i) {
        var y = items[i], sel = i === cur, can = !!(y.yt || y.clip), u = vurl(y);
        return h(u ? 'a' : 'button', { class: 'vcard', href: u || null, type: u ? null : 'button', 'aria-current': sel ? 'true' : 'false', 'aria-disabled': can ? null : 'true', on: { click: function (e) { if (!can) return; e.preventDefault(); playVid(m.id, i); } } }, [
          h('span', { class: 'th' }, [vThumb(m, y, 640), y.dur ? h('span', { class: 'dur', text: y.dur }) : null, sel && playing ? h('span', { class: 'pl', text: 'Playing' }) : h('span', { class: 'pb', 'aria-hidden': 'true', text: '▶' })]),
          h('span', { class: 'tt', text: y.title }), vSub(y, can)
        ]);
      })));
    } else {
      if (pl !== -1) kids = kids.concat(vidStage(m, items, pl, playing, stop));
      var all = !!S.vmore[key], show = all ? g.idx : g.idx.slice(0, 6);
      kids.push(h('div', { class: 'vgrid' }, show.map(function (i) {
        var y = items[i], on = i === pl, can = !!(y.yt || y.clip), u = vurl(y);
        return h(u ? 'a' : 'button', { class: 'vcard', href: u || null, type: u ? null : 'button', 'aria-current': on ? 'true' : 'false', 'aria-disabled': can ? null : 'true', 'aria-label': y.spoil ? y.title + ' (spoilers)' : null, on: { click: function (e) { if (!can) return; e.preventDefault(); playVid(m.id, i, true); } } }, [
          h('span', { class: 'th' + (y.blur && !on ? ' pcsp' : '') }, [vThumb(m, y, 640), y.spoil ? h('span', { class: 'sptag', text: 'Spoilers · post-credit scene' }) : null, y.dur ? h('span', { class: 'dur', text: y.dur }) : null, on ? h('span', { class: 'pl', text: 'Playing' }) : h('span', { class: 'pb', 'aria-hidden': 'true', text: '▶' })]),
          h('span', { class: 'tt', text: y.title }), vSub(y, can)
        ]);
      })));
      if (g.idx.length > 6) kids.push(h('button', { type: 'button', class: 'btn more', 'aria-expanded': String(all), text: all ? 'Show fewer' : 'Show all ' + g.idx.length + ' ' + g.label.toLowerCase(), on: { click: function () { S.vmore[key] = !all; if (!refreshVideos(m.id, g.idx)) { if (!S.vplay) S.vKeep = null; render(true); } } } }));
    }
    var sec = h('section', { class: 'tsec vsec' + (playing ? ' playing' : ''), id: g.id, 'aria-labelledby': 'h-' + g.id }, kids);
    sec._mid = m.id;
    if (playing) S.vKeep = sec;
    return sec;
  }

  // Story: the synopsis, in full. The banner shows the one-line hook instead.
  function storyBlock(m) {
    var d = m.data, text = String(d.synopsis || '').trim();
    if (!text && window.RS_ABOUT) { var a = aboutBlock(m); return a ? (a.classList.add('tsec'), a.classList.remove('card'), a) : null; }
    if (!text) return null;
    return h('section', { class: 'tsec', id: 'about' }, [h('h2', { text: 'Story' }), h('p', { class: 'story', text: text })]);
  }

  // Cast & crew: the two leads large, key crew by role, then everyone else.
  function castBlock(m) {
    var d = m.data, all = (d.cast || []).filter(function (c) { return c && c.name; }), tv = isTv(m);
    var crew = all.filter(function (c) { return CREW_RE.test(c.role || ''); });
    var actors = all.filter(function (c) { return !CREW_RE.test(c.role || ''); });
    String(d.director || '').split(/,| and /).map(function (x) { return x.trim(); }).filter(Boolean).forEach(function (nm) {
      if (!crew.some(function (c) { return personSlug(c.name) === personSlug(nm); })) crew.unshift({ name: nm, role: tv ? 'Created by' : 'Director' });
    });
    var box = h('section', { class: 'tsec', id: 'cast', 'aria-labelledby': 'h-cast' }, [h('div', { class: 'tsec-h' }, [h('h2', { id: 'h-cast', text: 'Cast & crew' }),
      all.length ? h('span', { class: 'note', text: actors.length + ' cast · ' + crew.length + ' crew' }) : null])]);
    if (!actors.length && !crew.length) { box.appendChild(h('div', { class: 'note', text: 'Cast and crew not added yet.' })); return box; }
    var face = function (c, i, cls) {
      var ph = personPhotoUrl(c.name);
      return ph ? h('img', { src: ph, alt: '', class: cls, loading: 'lazy' }) : h('span', { class: cls, style: 'background:' + PAL[i % PAL.length][1], 'aria-hidden': 'true', text: initials(c.name) });
    };
    // No aria-label: the card's visible text (name, role or character) is its name for screen readers too.
    var link = function (c, cls, kids) { var pk = personSlug(c.name); return pk ? h('a', { class: cls, href: personUrl(c.name) }, kids) : h('div', { class: cls }, kids); };
    var sub = function (c) { return [CREW_RE.test(c.role || '') ? c.role : charOf(c) || (HOST_RE.test(c.role || '') ? String(c.role).replace(/^as\s+/i, '') : ''), tv ? epText(c.episodes) : '', tv ? c.year || '' : ''].filter(Boolean).join(' · '); };
    // Leads: the cast marked ★ in Admin; with none marked, the first two actors.
    var marked = actors.filter(function (c) { return c.lead; });
    var leads = marked.length ? marked : actors.slice(0, actors.length > 2 ? 2 : actors.length);
    var rest = actors.filter(function (c) { return leads.indexOf(c) === -1; });
    if (leads.length) box.appendChild(h('div', { class: 'leads' + (leads.length > 2 ? ' three' : '') }, leads.map(function (c, i) {
      return link(c, 'lead card', [face(c, i, 'lf'), h('span', { class: 'lt' }, [h('span', { class: 'lbadge', text: 'Lead' }), h('span', { class: 'ln', text: c.name }), sub(c) ? h('span', { class: 'note', text: sub(c) }) : null])], c.name + ', lead');
    })));
    if (crew.length) {
      var byRole = [], at = {};
      crew.forEach(function (c) { var r = (c.role || 'Crew').trim(), k = r.toLowerCase(); if (!(k in at)) { at[k] = byRole.length; byRole.push({ role: r, people: [] }); } byRole[at[k]].people.push(c); });
      box.appendChild(h('div', { class: 'crew card' }, byRole.map(function (r) {
        var names = []; r.people.forEach(function (c, j) { if (j) names.push(', '); names.push(personSlug(c.name) ? h('a', { href: personUrl(c.name), text: c.name }) : c.name); });
        return h('div', { class: 'cr' }, [h('span', { class: 'kicker', text: r.role }), h('span', { class: 'crn' }, names)]);
      })));
    }
    if (rest.length) {
      S.castAll = S.castAll || {};
      var open = !!S.castAll[m.id], show = open ? rest : rest.slice(0, 12);
      box.appendChild(h('div', { class: 'castg' }, show.map(function (c, i) {
        return link(c, 'cp', [face(c, i + 2, 'c'), h('span', { class: 'cn', style: 'font-size:14px;font-weight:600', text: c.name }), sub(c) ? h('span', { class: 'note', text: sub(c) }) : null], c.name + (charOf(c) ? ', as ' + charOf(c) : c.role ? ', ' + c.role : '') + ' — see all titles');
      })));
      if (rest.length > 12) box.appendChild(h('button', { type: 'button', class: 'btn more', 'aria-expanded': String(open), text: open ? 'Show fewer' : 'Show all ' + actors.length + ' cast', on: { click: function () { S.castAll[m.id] = !open; swapInPlace(box, castBlock(m), '#cast .btn.more'); } } }));
    }
    return box;
  }


  // Title page: after a vote, redraw only the verdict strip, the fan poll and the review box (no full redraw, no image reloads).
  function patchTitleBits() {
    if (S.route !== 'title' || !S.loaded) return false;
    var m = findMovie(S.param), v = $('view-title'); if (!m || !v || !v.classList.contains('tpage')) return false;
    var strip = v.querySelector('.vstrip'); if (!strip) return false;
    var sy = window.scrollY;
    strip.replaceWith(verdictStrip(m, released(m)));
    var lb = v.querySelector('.listbtn'); if (lb) lb.replaceWith(listBtn(m));
    fillNames();
    var poll = $('poll'), np = pollBlock(m); if (poll && np) poll.replaceWith(np);
    if (window.scrollY !== sy) window.scrollTo(0, sy);
    return true;
  }
  // Swap one section for its redrawn copy without redrawing the page, so the scroll position stays put; keeps focus on the toggle.
  function swapInPlace(oldEl, newEl, focusSel) {
    if (!oldEl || !newEl || !oldEl.parentNode) { render(true); return; }
    var sy = window.scrollY;
    oldEl.replaceWith(newEl);
    if (window.scrollY !== sy) window.scrollTo(0, sy);
    var f = focusSel && document.querySelector(focusSel); if (f) f.focus({ preventScroll: true });
  }
  // ---------- posters: one scrolling row, filter chips, and a full-screen viewer ----------
  // Only posters with a permission picked in Admin are shown (distributor permission, or official art re-hosted).
  var POSTER_PERM = /^(distributor permission|official art, re-hosted)$/i;
  function postersOf(m) {
    return (m.data.posters || []).filter(function (p) { return p && safeUrl(p.url) && POSTER_PERM.test(String(p.permission || '').trim()); });
  }
  // Posters stay the studio's: no right-click menu, no dragging the image out, no long-press save.
  function guardImg(el) {
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    el.addEventListener('dragstart', function (e) { e.preventDefault(); });
    return el;
  }
  function posterImg(p, w, alt) {
    var img = h('img', { src: cld(p.url, w), alt: alt, loading: 'lazy', draggable: 'false', width: 400, height: 600 });
    return guardImg(img);
  }
  function postersBlock(m) {
    var all = postersOf(m); if (all.length < 2) return null;
    var d = m.data; S.pfilt = S.pfilt || {};
    var kinds = []; all.forEach(function (p) { var k = p.kind || 'Poster'; if (kinds.indexOf(k) === -1) kinds.push(k); });
    var f = kinds.indexOf(S.pfilt[m.id]) !== -1 ? S.pfilt[m.id] : 'All';
    var list = all.map(function (p, i) { return { p: p, i: i }; }).filter(function (x) { return f === 'All' || (x.p.kind || 'Poster') === f; });
    var track = h('div', { class: 'prow', role: 'list' }, list.map(function (x) {
      var p = x.p, name = p.label || (p.kind || 'Poster');
      return h('div', { role: 'listitem', class: 'pcard' }, [
        h('button', { type: 'button', class: 'pth', 'aria-label': 'Open ' + name + ' larger', on: { click: function () { openPosterViewer(m, x.i); } } }, [
          posterImg(p, 500, d.title + ' ' + name.toLowerCase()), p.kind ? h('span', { class: 'ptag', text: p.kind }) : null]),
        h('span', { class: 'pcap', text: name }), h('span', { class: 'note psub', text: [p.kind, p.date && /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? fmtDate(p.date, true) : ''].filter(Boolean).join(' · ') })
      ]);
    }));
    var scroll = function (dir) { track.scrollBy({ left: dir * Math.max(200, track.clientWidth * 0.8), behavior: 'smooth' }); };
    // The row's scrollbar is hidden; the arrows grey out at either end instead.
    var lBtn, rBtn, syncArr = function () {
      if (!lBtn) return; var max = track.scrollWidth - track.clientWidth - 2;
      lBtn.disabled = track.scrollLeft <= 2; rBtn.disabled = track.scrollLeft >= max;
    };
    track.addEventListener('scroll', syncArr, { passive: true });
    setTimeout(syncArr, 0); window.addEventListener('resize', syncArr);
    var sec = h('section', { class: 'tsec psec', id: 'posters', 'aria-labelledby': 'h-posters' }, [
      h('div', { class: 'tsec-h' }, [h('h2', { id: 'h-posters' }, [d.title + ' posters', ' ', h('span', { class: 'cnt', text: String(all.length) })]),
        h('span', { class: 'parr' }, [
          lBtn = h('button', { type: 'button', class: 'pib', 'aria-label': 'Scroll posters left', on: { click: function () { scroll(-1); } } }, ['‹']),
          rBtn = h('button', { type: 'button', class: 'pib', 'aria-label': 'Scroll posters right', on: { click: function () { scroll(1); } } }, ['›'])])]),
      kinds.length > 1 ? h('div', { class: 'pchips', role: 'group', 'aria-label': 'Filter posters' }, ['All'].concat(kinds).map(function (k) {
        var n = k === 'All' ? all.length : all.filter(function (p) { return (p.kind || 'Poster') === k; }).length;
        return h('button', { type: 'button', class: 'chip' + (k === f ? ' on' : ''), 'aria-pressed': String(k === f), on: { click: function () {
          S.pfilt[m.id] = k; swapInPlace(sec, postersBlock(m), '#posters .pchips .chip.on');
        } } }, [k, ' ', h('span', { class: 'n', text: String(n) })]);
      })) : null,
      track
    ]);
    return sec;
  }
  function openPosterViewer(m, start) {
    var all = postersOf(m); if (!all.length) return;
    var d = m.data, i = Math.max(0, Math.min(start, all.length - 1)), back = document.activeElement;
    var box = h('div', { class: 'pview', role: 'dialog', 'aria-modal': 'true', 'aria-label': d.title + ' posters' });
    var close = function () { document.removeEventListener('keydown', onKey); box.remove(); document.body.style.overflow = ''; if (back && back.focus) back.focus(); };
    var go = function (n) { i = (n + all.length) % all.length; paint(); };
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(i + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(i - 1); }
    }
    function paint() {
      var p = all[i], name = p.label || p.kind || 'Poster';
      box.innerHTML = '';
      var big = h('div', { class: 'pvimg' }, [posterImg(p, 1400, d.title + ' ' + name.toLowerCase())]);
      var tx0 = null;
      big.addEventListener('touchstart', function (e) { tx0 = e.touches[0].clientX; }, { passive: true });
      big.addEventListener('touchend', function (e) { if (tx0 === null) return; var dx = e.changedTouches[0].clientX - tx0; tx0 = null; if (Math.abs(dx) > 40) go(i + (dx < 0 ? 1 : -1)); });
      var perm = /official/i.test(p.permission) ? 'Official art' : 'Shown with distributor permission';
      box.appendChild(h('div', { class: 'pv-top' }, [h('span', { class: 'note', text: (i + 1) + ' of ' + all.length + (p.kind ? ' · ' + p.kind : '') }),
        h('button', { type: 'button', class: 'pib', 'aria-label': 'Close', on: { click: close } }, ['✕'])]));
      box.appendChild(h('div', { class: 'pv-mid' }, [
        all.length > 1 ? h('button', { type: 'button', class: 'pib pv-nav pv-prev', 'aria-label': 'Previous poster', on: { click: function () { go(i - 1); } } }, ['‹']) : null,
        big,
        h('div', { class: 'pv-info' }, [
          h('h2', { text: name }),
          h('div', { class: 'note' }, [
            p.date && /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? h('div', { text: 'Released ' + fmtDate(p.date, true) }) : null,
            h('div', { text: 'Official poster' + (p.credit ? ' · ' + p.credit : '') }),
            h('div', { class: 'pv-ok', text: '✓ ' + perm })]),
          h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [h('button', { type: 'button', class: 'btn primary', text: navigator.share ? 'Share' : 'Copy link', on: { click: function () {
            var full = location.origin + movieUrl(m) + '#posters', text = d.title + ' – ' + name + ' on Reelscore';
            if (navigator.share) { try { navigator.share({ title: text, text: text, url: full }).catch(function () {}); return; } catch (e) {} }
            copyText(full, 'Link copied');
          } } })])
        ]),
        all.length > 1 ? h('button', { type: 'button', class: 'pib pv-nav pv-next', 'aria-label': 'Next poster', on: { click: function () { go(i + 1); } } }, ['›']) : null
      ]));
      if (all.length > 1) box.appendChild(h('div', { class: 'pv-thumbs' }, all.map(function (q, k) {
        return h('button', { type: 'button', class: 'pv-t' + (k === i ? ' on' : ''), 'aria-label': 'Poster ' + (k + 1), 'aria-current': k === i ? 'true' : null, on: { click: function () { go(k); } } }, [posterImg(q, 120, '')]);
      })));
      var f = box.querySelector('.pv-t.on') || box.querySelector('.pib'); if (f) f.focus({ preventScroll: true });
    }
    box.addEventListener('click', function (e) { if (e.target === box) close(); });
    guardImg(box);
    document.addEventListener('keydown', onKey);
    document.body.appendChild(box); document.body.style.overflow = 'hidden';
    paint();
  }

  // ---------- sidebar extras: trivia, fan poll, filming locations, awards ----------
  function triviaBlock(m) {
    var items = (m.data.trivia || []).filter(function (t) { return t && String(t.text || '').trim(); });
    if (!items.length) return null;
    S.trivAll = S.trivAll || {};
    var open = !!S.trivAll[m.id], show = open ? items : items.slice(0, 3);
    var sec = h('section', { class: 'card side-x', id: 'trivia', 'aria-labelledby': 'h-triv' }, [
      h('div', { class: 'sx-h' }, [h('h2', { id: 'h-triv', text: 'Did you know?' }), h('span', { class: 'note', text: items.length + (items.length === 1 ? ' fact' : ' facts') })]),
      h('ol', { class: 'trivia' }, show.map(function (t, i) {
        var u = safeUrl(t.source);
        return h('li', {}, [h('span', { class: 'tn', 'aria-hidden': 'true', text: String(i + 1).padStart(2, '0') }), h('p', {}, [String(t.text).trim(), u ? ' ' : null, u ? h('a', { href: u, target: '_blank', rel: 'noopener nofollow', class: 'tsrc', text: 'Source ↗' }) : null])]);
      })),
      items.length > 3 ? h('button', { type: 'button', class: 'chip', style: 'align-self:flex-start', 'aria-expanded': String(open), text: open ? 'Show fewer' : 'Show ' + (items.length - 3) + ' more', on: { click: function () { S.trivAll[m.id] = !open; swapInPlace(sec, triviaBlock(m), '#trivia .chip'); } } }) : null
    ]);
    return sec;
  }
  // Fan poll: best performance among the leads and top-billed cast. Votes live in each person's public verdicts doc (bo map).
  function pollBlock(m) {
    if (!released(m)) return null;
    var actors = (m.data.cast || []).filter(function (c) { return c && c.name && !CREW_RE.test(c.role || ''); });
    var leads = actors.filter(function (c) { return c.lead; }), rest = actors.filter(function (c) { return !c.lead; });
    var opts = leads.concat(rest).slice(0, 4).filter(function (c) { return personSlug(c.name); });
    if (opts.length < 2) return null;
    var key = m.id + ':best', mine = S.uid && S.verdicts[S.uid] && (S.verdicts[S.uid].bo || {})[key], n = {}, tot = 0;
    Object.keys(S.verdicts).forEach(function (u) { var x = (S.verdicts[u].bo || {})[key]; if (x) { n[x] = (n[x] || 0) + 1; tot++; } });
    var vote = function (slug) {
      if (!needUser() || writing.v || !verdictsReady()) return;
      var cur = clone(S.verdicts[S.uid] || { v: {} }); cur.v = cur.v || {}; cur.bo = cur.bo || {};
      if (cur.bo[key] === slug) delete cur.bo[key]; else cur.bo[key] = slug;
      cur.at = new Date().toISOString(); S.verdicts[S.uid] = cur; if (!patchTitleBits()) render();
      writing.v = true; guard(S.db.doc('verdicts/' + S.uid).set(cur)).then(function () { writing.v = false; });
    };
    return h('section', { class: 'card side-x', id: 'poll', 'aria-labelledby': 'h-poll' }, [
      h('div', { class: 'kicker', style: 'color:var(--accent)', text: 'Fan poll' }),
      h('h2', { id: 'h-poll', text: 'Best performance in ' + m.data.title + '?' }),
      h('div', { class: 'poll', role: 'group', 'aria-label': 'Best performance' }, opts.map(function (c, i) {
        var k = personSlug(c.name), pct = mine && tot ? Math.round(100 * (n[k] || 0) / tot) : null, ph = personPhotoUrl(c.name, 96);
        return h('button', { type: 'button', class: 'po', 'aria-pressed': String(mine === k), on: { click: function () { vote(k); } } }, [
          pct !== null ? h('span', { class: 'pobar', style: 'width:' + pct + '%' }) : null,
          ph ? h('img', { src: ph, alt: '', class: 'pof', loading: 'lazy' }) : h('span', { class: 'pof', style: 'background:' + PAL[i % PAL.length][1], 'aria-hidden': 'true', text: initials(c.name) }),
          h('span', { class: 'pon', text: c.name }),
          pct !== null ? h('span', { class: 'pop', text: pct + '%' }) : null
        ]);
      })),
      h('div', { class: 'note', text: mine ? tot + (tot === 1 ? ' vote' : ' votes') + ' · tap your pick again to take it back' : 'Results show after you vote.' })
    ]);
  }
  function locationsBlock(m) {
    var items = (m.data.locations || []).map(function (l) { return String(l && l.name || '').trim(); }).filter(Boolean);
    if (!items.length) return null;
    return h('section', { class: 'card side-x', 'aria-labelledby': 'h-loc' }, [
      h('h2', { id: 'h-loc', text: 'Filmed in' }),
      h('div', { class: 'chips' }, items.map(function (n) { return h('a', { class: 'chip lchip', href: 'https://www.openstreetmap.org/search?query=' + encodeURIComponent(n), target: '_blank', rel: 'noopener nofollow', text: n }); }))
    ]);
  }
  function awardsBlock(m) {
    var items = (m.data.awards || []).filter(function (a) { return a && String(a.award || '').trim(); });
    if (!items.length) return null;
    var won = items.filter(function (a) { return /^won/i.test(a.result || ''); });
    items = won.concat(items.filter(function (a) { return !/^won/i.test(a.result || ''); }));
    return h('section', { class: 'card side-x', 'aria-labelledby': 'h-aw' }, [
      h('div', { class: 'sx-h' }, [h('h2', { id: 'h-aw', text: 'Awards' }), h('span', { class: 'note', text: [won.length ? won.length + (won.length === 1 ? ' win' : ' wins') : '', items.length - won.length ? (items.length - won.length) + (items.length - won.length === 1 ? ' nomination' : ' nominations') : ''].filter(Boolean).join(' · ') })]),
      h('ul', { class: 'awards' }, items.map(function (a) {
        var w = /^won/i.test(a.result || '');
        return h('li', {}, [h('span', { class: 'adot' + (w ? ' w' : ''), 'aria-hidden': 'true' }), h('span', {}, [
          h('b', { text: String(a.award).trim() + (a.year ? ' ' + String(a.year).trim() : '') }), a.category ? ' · ' + String(a.category).trim() : '',
          h('span', { class: 'note', style: 'display:block', text: [w ? 'Won' : 'Nominated', String(a.person || '').trim()].filter(Boolean).join(' · ') })])]);
      }))
    ]);
  }
  // News: headline, publisher and date only; each item links out to the publisher.
  function newsBlock(m) {
    var items = (m.data.news || []).filter(function (n) { return n && n.title && safeUrl(n.url); }).slice().sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); });
    // Our own stories about this title come first and open on Reelscore; publishers' headlines follow.
    var own = newsList().filter(function (p) { return (p.titles || []).indexOf(m.id) !== -1; }).slice(0, 3);
    if (!items.length && !own.length) return null;
    S.newsAll = S.newsAll || {};
    var open = !!S.newsAll[m.id], show = open ? items : items.slice(0, 5);
    var host = function (u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };
    var sec = h('section', { class: 'tsec', id: 'news', 'aria-labelledby': 'h-news' }, [
      h('div', { class: 'tsec-h' }, [h('h2', { id: 'h-news', text: m.data.title + ' news' })]),
      h('div', { class: 'card news' }, own.map(newsItem).concat(show.map(function (n) {
        return h('a', { class: 'nwi', href: safeUrl(n.url), target: '_blank', rel: 'noopener nofollow' }, [
          safeUrl(n.img) ? h('span', { class: 'nth', style: art(m, 'banner', 320) }, [guardImg(h('img', { src: cld(n.img, 320), alt: '', loading: 'lazy', draggable: 'false', referrerpolicy: 'no-referrer', width: 256, height: 144, on: { error: function () { this.remove(); } } }))]) : h('span', { class: 'nth', style: art(m, 'banner', 320), 'aria-hidden': 'true' }),
          h('span', { class: 'nm' }, [n.topic && n.topic !== 'Other' ? h('span', { class: 'ntag', text: n.topic }) : null, h('span', { class: 'note', text: [n.source || host(n.url), /^\d{4}-\d{2}-\d{2}$/.test(n.date || '') ? fmtDate(n.date, true) : ''].filter(Boolean).join(' · ') })]),
          h('span', { class: 'nt', text: n.title }), h('span', { class: 'na', 'aria-hidden': 'true', text: '↗' })
        ]);
      }))),
      items.length > 5 ? h('button', { type: 'button', class: 'btn more', 'aria-expanded': String(open), text: open ? 'Show fewer' : 'Show all ' + items.length + ' stories', on: { click: function () { S.newsAll[m.id] = !open; swapInPlace(sec, newsBlock(m), '#news .btn.more'); } } }) : null,
      items.length ? h('div', { class: 'note', text: own.length ? 'Headlines marked ↗ link to the publisher’s own page.' : 'Headlines link to the publisher’s own page.' }) : null
    ]);
    return sec;
  }
  // Where to watch tile: the service's own logo when we have one, else its initials on its colour.
  function watchTile(p) {
    var parts = String(p || '').split('/').map(function (x) { return x.trim(); }), hit = null;
    parts.some(function (part) { hit = PLAT.filter(function (x) { return x[3] && x[0].test(part); })[0] || null; return !!hit; });
    if (hit) return h('span', { class: 'c wtile logo', role: 'img', 'aria-label': hit[1] }, [h('img', { src: hit[3], alt: '', width: 44, height: 44, decoding: 'async' })]);
    var any = PLAT.filter(function (x) { return x[0].test(parts[0]); })[0];
    return h('span', { class: 'c wtile', 'aria-hidden': 'true', style: any ? 'background:' + any[2] + ';color:#fff' : '', text: (parts[0] || 'OTT').slice(0, 2).toUpperCase() });
  }
  // ---------- Where to watch (sidebar card): Book tickets, Stream, Rent or buy, with an audio-language filter ----------
  // Rows come from Admin's "Where to watch" list (d.watch: platform, kind, langs, url). The main Streaming platform and
  // its link (d.platform / d.platformUrl) still count: any service named there that the list doesn't have becomes a Stream row.
  var WW_RENT = /^(rent|buy|rent or buy)$/i;
  var BOOK_TILE = { bookmyshow: ['BMS', '#C4242B', '#fff'], district: ['D', '#F4F1EA', '#0B0A0F'], 'pvr inox': ['PVR', '#F5C518', '#0B0A0F'], ticketnew: ['TN', '#E2231A', '#fff'] };
  function bookTile(p) {
    var t = BOOK_TILE[String(p || '').toLowerCase()];
    return h('span', { class: 'c wtile', 'aria-hidden': 'true', style: t ? 'background:' + t[1] + ';color:' + t[2] : '', text: t ? t[0] : String(p || 'T').slice(0, 2).toUpperCase() });
  }
  // Which of several services named in d.platform a single link belongs to, from the link's address.
  var WW_HOST = [[/netflix/, /netflix/i], [/primevideo|amazon\./, /prime/i], [/hotstar/, /hotstar/i], [/zee5/, /zee5/i], [/sonyliv/, /sony ?liv/i], [/sunnxt/, /sun ?nxt/i], [/aha\.video/, /\baha\b/i], [/mxplayer/, /mx player/i], [/hoichoi/, /hoichoi/i], [/youtube/, /youtube/i], [/jiocinema/, /jiocinema/i], [/apple\.com/, /apple/i]];
  function linkOwner(url, names) {
    var host = ''; try { host = new URL(url).hostname.toLowerCase(); } catch (e) { return ''; }
    var hit = WW_HOST.filter(function (x) { return x[0].test(host); })[0];
    return hit ? names.filter(function (n) { return hit[1].test(n); })[0] || '' : '';
  }
  function langList(s) { return String(s || '').split(/[,;/]|\band\b/).map(function (x) { return x.trim(); }).filter(Boolean); }
  function watchRows(m) {
    var d = m.data, rows = [];
    (Array.isArray(d.watch) ? d.watch : []).forEach(function (w) {
      if (!w || !String(w.platform || '').trim()) return;
      rows.push({ platform: String(w.platform).trim(), kind: String(w.kind || '').trim(), langs: langList(w.langs), url: safeUrl(w.url) });
    });
    var named = String(d.platform || '').split('/').map(function (x) { return x.trim(); }).filter(Boolean), url = safeUrl(d.platformUrl);
    var owner = url ? (named.length === 1 ? named[0] : linkOwner(url, named) || named[0]) : '';
    named.forEach(function (p) {
      var have = rows.filter(function (r) { return r.platform.toLowerCase() === p.toLowerCase(); })[0];
      if (have) { if (!have.url && p === owner) have.url = url; return; }
      rows.push({ platform: p, kind: '', langs: [], url: p === owner ? url : '', main: true });
    });
    if (!named.length && url) rows.push({ platform: 'Streaming', kind: '', langs: [], url: url, main: true });
    return rows;
  }
  function actionBlock(m, rel, ott) {
    var d = m.data, tv = isTv(m);
    var all = watchRows(m), canWatch = btnOn('title', 'watch'), canBook = btnOn('title', 'book');
    var streams = all.filter(function (r) { return !WW_RENT.test(r.kind); }), rents = all.filter(function (r) { return WW_RENT.test(r.kind); });
    var theatrical = !ott && !tv && !isOld(m) && hasBooking(d) && canBook;
    var pending = ott && !rel; // direct to OTT, not streaming yet
    if (!theatrical && !all.length && !(ott || isOld(m) || tv)) return null; // no booking or streaming link added for this film
    var filmLangs = langList(d.languages), fm = (d.formats || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    // Audio-language chips, once the rows say which languages each service has.
    var langs = []; all.forEach(function (r) { r.langs.forEach(function (l) { if (langs.indexOf(l) === -1) langs.push(l); }); });
    S.wwLang = S.wwLang && S.wwLang.id === m.id ? S.wwLang : { id: m.id, l: '' };
    if (S.wwLang.l && langs.indexOf(S.wwLang.l) === -1) S.wwLang.l = '';
    var sec = h('section', { class: 'card wwcard', id: 'watch', 'aria-labelledby': 'wwh' });
    function draw() {
      sec.innerHTML = '';
      var L = S.wwLang.l, fits = function (ls) { return !L || !ls.length || ls.indexOf(L) !== -1; };
      sec.appendChild(h('h2', { id: 'wwh', text: 'Where to watch' }));
      if (langs.length > 1) sec.appendChild(h('div', { class: 'wwlangs', role: 'group', 'aria-label': 'Audio language' }, [''].concat(langs).map(function (l) {
        return h('button', { type: 'button', class: 'chip', 'aria-pressed': String(l === L), text: l || 'All', on: { click: function () { S.wwLang.l = l; draw(); var b = sec.querySelector('.wwlangs [aria-pressed=true]'); if (b) b.focus(); } } });
      })));
      var row = function (tile, name, sub, act) {
        return h('div', { class: 'wwrow' }, [tile, h('div', { class: 'wwt' }, [h('div', { class: 'wwn', text: name }), sub ? h('div', { class: 'wws', text: sub }) : null]), act]);
      };
      var go = function (url, label, pri, aria) { return h('a', { class: 'wwbtn' + (pri ? ' pri' : ''), href: url, target: '_blank', rel: 'noopener', 'aria-label': aria }, [label, h('span', { 'aria-hidden': 'true', text: '↗' })]); };
      // Book tickets
      if (theatrical) {
        var bps = partnersFor(d, S.city), cs = citiesFor(d);
        var cityBox = h('span', { class: 'wwcity', hidden: !!S.city && !sec._pickCity });
        var csel = h('select', { class: 'in', id: 'bookCity', 'aria-label': 'Your city' }, [h('option', { value: '', text: 'Choose your city' })].concat((S.city && cs.indexOf(S.city) === -1 ? cs.concat([S.city]) : cs).map(function (c) { return h('option', { value: c, text: c, selected: c === S.city }); })));
        csel.addEventListener('change', function () { csel.blur(); sec._pickCity = false; setCity(csel.value); });
        cityBox.appendChild(csel);
        var status = S.city ? h('div', { class: 'wwstat' }, [h('span', { class: 'dot', 'aria-hidden': 'true', text: '●' }), ' ' + (rel ? 'In theatres in ' : 'Advance booking in '), h('b', { text: S.city }),
          bps.length ? null : ' · no booking link yet', ' · ', h('button', { type: 'button', class: 'linkish', 'aria-expanded': String(!!sec._pickCity), text: 'Change city', on: { click: function () { sec._pickCity = !sec._pickCity; draw(); var s = sec.querySelector('#bookCity'); if (s && sec._pickCity) s.focus(); } } })])
          : h('div', { class: 'wwstat' }, [rel ? 'In theatres. ' : 'Advance booking. ', 'Pick your city to see the booking link' + (partnerNames(d).length > 1 ? 's' : '') + '.']);
        sec.appendChild(status); sec.appendChild(cityBox);
        var bsub = [filmLangs.join(', '), fm.join(', ')].filter(Boolean).join(' · ');
        if (bps.length && fits(filmLangs)) {
          sec.appendChild(h('div', { class: 'lbl wwl', text: rel ? 'Book tickets' : 'Advance booking' }));
          bps.forEach(function (p, i) { sec.appendChild(row(bookTile(p.platform), p.platform || 'Tickets', bsub, go(p.url, 'Book', i === 0, 'Book tickets on ' + (p.platform || 'the booking site') + ' in ' + S.city))); });
        }
      }
      // Stream
      var vis = streams.filter(function (r) { return fits(r.langs); }), anyPri = false;
      if (vis.length) {
        sec.appendChild(h('div', { class: 'lbl wwl', text: tv ? 'Watch' : 'Stream' }));
        vis.forEach(function (r) {
          var sub = [r.kind, r.langs.join(', ')].filter(Boolean).join(' · ');
          if (!sub && r.main) sub = pending ? 'Streams from ' + fmtDate(d.ottReleaseDate || d.releaseDate, true) : tv ? (d.endYear ? 'Aired ' + tvYears(d) : 'Running now') : 'Streaming now';
          var act = r.url && canWatch && !pending ? go(r.url, 'Watch', !anyPri, 'Watch ' + d.title + ' on ' + r.platform) : null;
          if (act) anyPri = true;
          sec.appendChild(row(watchTile(r.platform), r.platform, sub, act));
        });
      }
      // Rent or buy
      var vr = rents.filter(function (r) { return fits(r.langs); });
      if (vr.length) {
        sec.appendChild(h('div', { class: 'lbl wwl', text: 'Rent or buy' }));
        vr.forEach(function (r) {
          var verb = /^buy$/i.test(r.kind) ? 'Buy' : 'Rent';
          sec.appendChild(row(watchTile(r.platform), r.platform, [r.kind, r.langs.join(', ')].filter(Boolean).join(' · '), r.url && canWatch ? go(r.url, verb, false, verb + ' ' + d.title + ' on ' + r.platform) : null));
        });
      }
      if (L && !sec.querySelector('.wwrow')) sec.appendChild(h('div', { class: 'note', text: 'Nothing here has ' + L + ' audio yet.' }));
      if (!all.length && !theatrical) sec.appendChild(h('div', { class: 'note', text: tv ? 'Where to watch will show here once added.' : ott ? 'A link to watch it will show here once it’s added.' : 'No longer in theatres. Streaming details will show here once added.' }));
      else if (ott && streams.length && !streams.some(function (r) { return r.url; }) && canWatch) sec.appendChild(h('div', { class: 'note', text: 'A link to watch it will show here once it’s added.' }));
    }
    draw();
    return sec;
  }
  function planBlock(m) {
    var people = S.mine.following;
    var pick = S.planPick[m.id] || (S.planPick[m.id] = {});
    var box = h('section', { class: 'card' }, [h('h2', { text: isOtt(m) ? 'Plan a watch party' : 'Plan with friends' })]);
    if (people.length) {
      box.appendChild(h('div', { class: 'note', text: 'Pick who’s coming, then send the plan on WhatsApp.' }));
      box.appendChild(h('div', { class: 'people' }, people.slice(0, 8).map(function (u) {
        var cb = h('input', { type: 'checkbox', checked: !!pick[u], style: 'width:18px;height:18px;accent-color:var(--accent)', on: { change: function () { pick[u] = cb.checked; } } });
        return h('label', { class: 'person', style: 'cursor:pointer' }, [cb, avatarEl(u, 32), personEl(u, 'nmx')]);
      })));
    } else box.appendChild(h('div', { class: 'note' }, ['Follow people to invite them here, or just send the plan to anyone. ', h('a', { href: '/my-list', text: 'Find people' })]));
    var msg = planTextWithLink(m);
    box.appendChild(h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [
      h('a', { class: 'btn primary', href: 'https://wa.me/?text=' + encodeURIComponent(msg), target: '_blank', rel: 'noopener', text: 'Send on WhatsApp' }),
      h('button', { type: 'button', class: 'btn', text: 'Copy message', on: { click: function () { copyText(msg, 'Plan copied'); } } })
    ]));
    return box;
  }
  function planText(m) {
    var d = m.data;
    return isOtt(m) ? 'Watch party? ' + d.title + ' is ' + (released(m) ? 'on ' : 'coming to ') + (d.platform || 'OTT') + '. This weekend? Reply with a day that works.'
      : 'Movie plan: ' + d.title + (released(m) ? ' is in theatres.' : ' releases ' + fmtDate(d.releaseDate, true) + '.') + ' Want to go? Reply with a day and I’ll book.';
  }
  function planTextWithLink(m) { return planText(m) + ' ' + location.origin + movieUrl(m); }
  function shareText(m) { var s = score(m.id); return m.data.title + (s.pct !== null ? ' — ' + s.pct + '% on Reelscore (' + s.tot + ' verdicts)' : ' on Reelscore') + ' ' + location.origin + movieUrl(m); }
  function copyText(t, ok) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { toast(ok); }, function () { toast('Copy isn’t allowed here. Message: ' + t); });
    else toast(t);
  }
  function factsBlock(m) {
    // The release date is a theatre date unless the film went straight to streaming (Now playing "Direct to OTT", or no
    // separate OTT date): only then is it "Streaming from". A theatre film now on OTT shows both dates.
    var directOtt = isOtt(m) && (m.data.nowPlaying === 'direct' || !m.data.ottReleaseDate || m.data.ottReleaseDate <= (m.data.releaseDate || ''));
    var d = m.data, rows = isTv(m) ? [['First aired', d.releaseDate ? fmtDate(d.releaseDate, true) : ''], ['Years', tvYears(d)], ['Channel or platform', d.platform], ['OTT release', d.ottReleaseDate ? fmtDate(d.ottReleaseDate, true) : ''], ['Seasons', d.seasons], ['Episodes', d.episodes], ['Languages', d.languages], ['Genre', d.genre], ['Episode length', d.runtime], ['Certificate', d.certificate], ['Created by', d.director]] : [[directOtt ? 'Streaming from' : d.ottReleaseDate ? 'Theatre release' : 'Release date', fmtDate(d.releaseDate, true) + (d.releaseNote ? ' (' + d.releaseNote.toLowerCase() + ')' : '')], ['OTT release', d.ottReleaseDate && !directOtt ? fmtDate(d.ottReleaseDate, true) : ''], ['Platform', isOtt(m) ? d.platform : ''], ['Languages', d.languages], ['Genre', d.genre], ['Runtime', d.runtime], ['Certificate', d.certificate], ['Director', d.director]];
    var linkers = {
      'Directed by': function (v) { return names(v, function (n) { return personUrl(n); }); }, 'Created by': function (v) { return names(v, function (n) { return personUrl(n); }); },
      'Director': function (v) { return names(v, function (n) { return personUrl(n); }); },
      'Languages': function (v) { return names(v, function (n) { return browseHref({ status: 'All', lang: n }, 1); }, /\s*[,;]\s*/); },
      'Language': function (v) { return names(v, function (n) { return browseHref({ status: 'All', lang: n }, 1); }, /\s*[,;]\s*/); }
    };
    function names(v, href, sep) {
      var parts = String(v).split(sep || /\s*,\s*|\s+and\s+/).map(function (x) { return x.trim(); }).filter(Boolean), out = [];
      parts.forEach(function (n, i) { if (i) out.push(', '); out.push(h('a', { href: href(n), style: 'color:inherit', text: n })); });
      return out;
    }
    return h('section', { class: 'card facts' }, [h('h2', { text: 'Details' })].concat(rows.filter(function (r) { return r[1]; }).map(function (r) {
      var val = linkers[r[0]] ? h('span', { style: 'text-align:right' }, linkers[r[0]](r[1])) : h('span', { style: 'text-align:right', text: r[1] });
      return h('div', {}, [h('span', { text: r[0] }), val]);
    })));
  }

  // ---------- browse ----------
  var GENRES = ['Action', 'Comedy', 'Drama', 'Thriller', 'Horror', 'Romance', 'Family', 'Animated', 'Biopic', 'Mythological', 'War', 'Sci-fi'];
  function genreTags(d) {
    var g = (d.genre || '').toLowerCase(), out = [];
    var map = { Action: /action|spy|superhero|heist/, Comedy: /comed|rom-com/, Drama: /drama/, Thriller: /thriller|mystery|crime/, Horror: /horror/, Romance: /roman|rom-com/, Family: /family/, Animated: /animat/, Biopic: /biograph|biopic/, Mythological: /myth|epic/, War: /war/, 'Sci-fi': /science|sci-fi/ };
    GENRES.forEach(function (k) { if (map[k].test(g)) out.push(k); });
    return out;
  }
  function langOf(d) { return ((d.languages || '').split(/[,;]/)[0] || '').trim(); }
  // "Streaming on" filter: where a title streams, by service. TV channels count under the service that streams them now.
  var OTTS = [['netflix', 'Netflix', /netflix/i], ['prime-video', 'Prime Video', /prime video|amazon prime/i],
    ['jiohotstar', 'JioHotstar', /hotstar|jiocinema|voot|star ?plus|star bharat|star vijay|colors|\bmtv\b|disney|asianet|nickelodeon/i],
    ['zee5', 'ZEE5', /zee|&\s*tv/i], ['sonyliv', 'SonyLIV', /sony|\bsab\b/i], ['mx-player', 'MX Player', /mx player|mini ?tv/i],
    ['altt', 'ALTT', /\baltt\b|alt ?balaji/i], ['hoichoi', 'Hoichoi', /hoichoi/i], ['aha', 'aha', /\baha\b/i], ['sun-nxt', 'Sun NXT', /sun ?nxt/i],
    ['eros-now', 'Eros Now', /eros/i], ['youtube', 'YouTube', /youtube/i], ['tvfplay', 'TVFPlay', /\btvf/i], ['doordarshan', 'Doordarshan', /\bdd\b|doordarshan/i]];
  function ottOf(d) { var p = String(d.platform || ''); if (!p) return ''; for (var i = 0; i < OTTS.length; i++) if (OTTS[i][2].test(p)) return OTTS[i][0]; return ''; }
  function ottName(slug) { for (var i = 0; i < OTTS.length; i++) if (OTTS[i][0] === slug) return OTTS[i][1]; return ''; }
  // The services that some title in the list streams on, in OTTS order, for the dropdown.
  function ottOptions(list, keep) {
    var have = {}; list.forEach(function (m) { var o = ottOf(m.data); if (o) have[o] = 1; });
    if (keep) have[keep] = 1;
    return OTTS.filter(function (o) { return have[o[0]]; }).map(function (o) { return [o[0], o[1]]; });
  }
  // ---------- people (cast & crew pages: /person/<name>) ----------
  var CREW_RE = /(director|producer|music|writer|screenplay|composer|cinematograph|editor)/i;
  // Character name for an acting credit: the new `character` field, else an old free-text role that isn't a crew job.
  var HOST_RE = /^(as\s+)?(host|co-host|judge|narrator|guest|presenter|anchor|mentor|contestant|self)\b/i;
  function charOf(c) { if (!c) return ''; var x = String(c.character || '').trim(); if (x) return x; var r = String(c.role || '').trim(); return r && !CREW_RE.test(r) && !/^(cast|actor|actress|lead|self)$/i.test(r) && !HOST_RE.test(r) ? r.replace(/^as\s+/i, '') : ''; }
  function personSlug(name) { return String(name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80); }
  function personUrl(name) { return '/person/' + personSlug(name); }
  function personPhotoUrl(name, w) { var p = S.people[personSlug(name)]; return p && safeUrl(p.photoUrl) ? cld(p.photoUrl, w || 320) : ''; }
  function initials(name) { var w = String(name || '?').replace(/\./g, '').split(/\s+/).filter(Boolean); if (!w.length) return '?'; return (w[0][0] + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase(); }
  function creditsOf(slug) {
    var out = [];
    S.movies.forEach(function (m) {
      (m.data.cast || []).forEach(function (c) { if (personSlug(c.name) === slug) out.push({ m: m, name: c.name, role: CREW_RE.test(c.role || '') ? c.role : charOf(c) || (HOST_RE.test(c.role || '') ? String(c.role).replace(/^as\s+/i, '') : ''), crew: CREW_RE.test(c.role || ''), episodes: c.episodes || '', year: c.year || '' }); });
      if (!(m.data.cast || []).some(function (c) { return personSlug(c.name) === slug; })) {
        String(m.data.director || '').split(/,| and /).forEach(function (d) { if (d.trim() && personSlug(d) === slug) out.push({ m: m, name: d.trim(), role: 'Director', crew: true }); });
      }
    });
    return out;
  }
  function allPeopleIndex() {
    var idx = {};
    S.movies.forEach(function (m) { (m.data.cast || []).forEach(function (c) { var k = personSlug(c.name); if (!k) return; if (!idx[k]) idx[k] = { slug: k, name: c.name, n: 0 }; idx[k].n++; }); });
    return idx;
  }
  function personFacts(st) {
    if (!st) return null;
    var bits = [];
    if (/^\d{4}-\d{2}-\d{2}$/.test(st.birthday || '')) {
      var b = new Date(st.birthday + 'T00:00:00'), n = new Date(), age = n.getFullYear() - b.getFullYear() - ((n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) ? 1 : 0);
      bits.push(['Born', b.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) + (age >= 0 && age < 120 ? ' (age ' + age + ')' : '')]);
    }
    if (st.birthplace) bits.push([bits.length ? 'in' : 'Born in', st.birthplace]);
    var aka = (st.aka || []).filter(Boolean);
    if (!bits.length && !aka.length) return null;
    return h('div', { class: 'pfacts' }, [
      bits.length ? h('div', {}, bits.map(function (x, i) { return h('span', {}, [i ? ' ' : '', h('span', { class: 'note', text: x[0] + ' ' }), x[1]]); })) : null,
      aka.length ? h('div', {}, [h('span', { class: 'note', text: 'Also known as ' }), aka.join(', ')]) : null
    ]);
  }
  function drawPerson() {
    var v = $('view-person');
    if (!S.loaded && v.querySelector('[data-prerendered]')) return;
    v.innerHTML = '';
    setCanonical(personUrl(S.param));
    var slug = S.param, credits = creditsOf(slug);
    var stored = S.people[slug];
    if (!credits.length && !stored) {
      v.appendChild(h('div', { class: 'wrapx' }, [h('div', { class: 'empty' }, [S.loaded ? 'We couldn’t find this person on Reelscore. ' : 'Loading… ', h('a', { href: '/', text: 'Back to home' })])]));
      document.title = 'Reelscore'; setNoindex(S.loaded); return;
    }
    setNoindex(false);
    var name = (credits[0] && credits[0].name) || (stored && stored.name) || slug;
    var photo = personPhotoUrl(name, 480);
    // group: one entry per title, roles joined
    var byTitle = {}, order = [];
    credits.forEach(function (c) {
      if (!byTitle[c.m.id]) { byTitle[c.m.id] = { m: c.m, roles: [], acting: false, crew: false, tv: isTv(c.m), eps: 0, yrs: [] }; order.push(c.m.id); }
      var t = byTitle[c.m.id]; if (c.role && c.role !== 'Cast' && t.roles.indexOf(c.role) === -1) t.roles.push(c.role); if (c.crew) t.crew = true; else t.acting = true;
      var n = parseInt(c.episodes, 10); if (n > 0) t.eps += n;
      String(c.year || '').split(/[^0-9]+/).forEach(function (y) { if (/^\d{4}$/.test(y) && t.yrs.indexOf(y) === -1) t.yrs.push(y); });
    });
    // A TV credit dates from the person's own episode year(s), not the show's first air date.
    function when(t) { return t.tv && t.yrs.length ? t.yrs.slice().sort().pop() : (t.m.data.releaseDate || ''); }
    var titles = order.map(function (id) { return byTitle[id]; }).sort(function (a, b) { return when(b).localeCompare(when(a)); });
    var acting = titles.filter(function (t) { return t.acting; }), crew = titles.filter(function (t) { return t.crew; });
    var known = acting.length >= crew.length ? 'Acting' : (crew[0] && /direct/i.test(crew[0].roles.join(' ')) ? 'Directing' : 'Crew');
    var upcoming = titles.filter(function (t) { return !t.tv && isUpcoming(t.m); }).length;
    var years = []; titles.forEach(function (t) { (t.tv && t.yrs.length ? t.yrs : [(t.m.data.releaseDate || '').slice(0, 4)]).forEach(function (y) { if (y) years.push(y); }); }); years.sort();
    if (!S.pf || S.pf.slug !== slug) S.pf = { slug: slug, tab: 'all', lang: '', svc: '', svcAll: false, asc: false, all: false, about: false };
    var PF = S.pf;
    // Where a title can be seen right now: in theatres (with tickets when we have them), or on the services named in
    // "Now streaming on", with or without a link. The built page uses the same rules (scripts/build.mjs, person pages).
    function whereOf(t) {
      var m = t.m, d = m.data, np = nowPlayingOf(d);
      if (!t.tv && isUpcoming(m)) return { up: true, text: d.releaseDate ? 'Coming ' + fmtDate(d.releaseDate, true) : 'Coming soon' };
      if (!t.tv && (np === 'theatres' || d.section === 'In theatres')) return { text: 'In theatres', th: true, book: hasBooking(d) };
      if (d.platform) return { text: 'On ' + d.platform, url: safeUrl(d.platformUrl) || '' };
      return { text: '' };
    }
    titles.forEach(function (t) {
      t.w = whereOf(t); t.lang = langOf(t.m.data); t.key = t.w.up && !t.m.data.releaseDate ? '9999' : when(t);
      t.svc = !t.w.up && !t.w.th ? String(t.m.data.platform || '').split('/').map(function (x) { return x.trim(); }).filter(Boolean) : [];
    });
    var comingUp = titles.filter(function (t) { return t.w.up; }).sort(function (a, b) { return (a.m.data.releaseDate || '9999').localeCompare(b.m.data.releaseDate || '9999'); });
    var theatres = titles.filter(function (t) { return t.w.th; }), streams = titles.filter(function (t) { return t.svc.length; });
    var bySvc = {}; streams.forEach(function (t) { t.svc.forEach(function (x) { (bySvc[x] = bySvc[x] || []).push(t); }); });
    var svcNames = Object.keys(bySvc).sort(function (a, b) { return bySvc[b].length - bySvc[a].length || a.localeCompare(b); });
    var latest = titles.filter(function (t) { return !t.w.up && when(t); })[0];
    var pron = stored && stored.gender === 'Male' ? 'his' : stored && stored.gender === 'Female' ? 'her' : 'their';
    if (window.RS_ABOUT && RS_ABOUT.personSeo) {
      var seo = RS_ABOUT.personSeo({ name: name, gender: stored && stored.gender, bio: stored && stored.bio, total: titles.length, tvOnly: titles.every(function (t) { return t.tv; }),
        upcoming: comingUp.map(function (t) { return { title: t.m.data.title, date: t.m.data.releaseDate || '' }; }),
        latest: latest && { title: latest.m.data.title, year: when(latest).slice(0, 4), theatres: !!latest.w.th, platform: latest.svc.join(' / ') },
        streaming: streams.length, services: svcNames, picks: streams.filter(function (t) { return t.acting || !acting.length; }).slice(0, 4).map(function (t) { return t.m.data.title; }),
        famous: (acting.length ? acting : crew).filter(function (t) { return !t.w.up && when(t) && when(t) <= today(); }).slice(0, 4).map(function (t) { return t.m.data.title; }) });
      document.title = builtHead && builtHead.title && location.pathname.replace(/\/+$/, '') === builtHead.path ? builtHead.title : (String((stored && stored.seoTitle) || '').trim() || seo.title);
    } else document.title = personTitleTag(name);
    var langCount = {}; titles.forEach(function (t) { if (t.lang) langCount[t.lang] = (langCount[t.lang] || 0) + 1; });
    var langList = Object.keys(langCount).sort(function (a, b) { return langCount[b] - langCount[a] || a.localeCompare(b); });
    // Where to watch: the latest title first if it can be watched, then the most-rated of the rest (theatres, then streaming).
    var watchable = theatres.concat(streams);
    var nowList = watchable.filter(function (t) { return t === latest; }).concat(watchable.filter(function (t) { return t !== latest; }).sort(function (a, b) {
      return ((b.w.th ? 1 : 0) - (a.w.th ? 1 : 0)) || (score(b.m.id).tot - score(a.m.id).tot) || ((safeUrl(b.m.data.posterUrl) ? 1 : 0) - (safeUrl(a.m.data.posterUrl) ? 1 : 0)) || b.key.localeCompare(a.key);
    })).slice(0, 4);
    var roleWords = []; if (acting.length) roleWords.push('Actor'); crew.forEach(function (t) { t.roles.forEach(function (r) { if (CREW_RE.test(r)) { var w = r.replace(/^(co-|executive )/i, ''); w = w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(); if (roleWords.indexOf(w) === -1) roleWords.push(w); } }); });
    function stat(n, l) { return h('div', { class: 'pstat' }, [h('b', { text: String(n) }), h('span', { text: l })]); }
    v.appendChild(h('nav', { class: 'pcrumb', 'aria-label': 'Breadcrumb' }, [h('a', { href: '/', text: 'Home' }), ' › ', h('a', { href: '/people', text: 'People' }), ' › ', h('span', { 'aria-current': 'page', text: name })]));
    v.appendChild(h('section', { class: 'ph phx' }, [
      photo ? h('img', { class: 'pimg', src: photo, alt: name }) : h('span', { class: 'pini', style: 'background:' + PAL[hash(slug) % PAL.length][1], 'aria-hidden': 'true', text: initials(name) }),
      h('div', { style: 'min-width:0;flex:999 1 420px' }, [
        h('div', { class: 'kicker acc', text: roleWords.slice(0, 3).join(' · ') || 'Known for · ' + known }),
        h('h1', { class: 'display', style: 'font-size:clamp(36px,5vw,64px);margin-top:6px', text: name }),
        stored && stored.bio ? h('p', { class: 'lede', style: 'margin:10px 0 0;max-width:720px', text: stored.bio }) : null,
        personFacts(stored),
        h('div', { class: 'pstats' }, [
          stat(titles.length, titles.length === 1 ? 'title on Reelscore' : 'titles on Reelscore'),
          years.length ? stat(years[0] === years[years.length - 1] ? years[0] : years[0] + '–' + years[years.length - 1], 'years listed') : null,
          langList.length > 1 ? stat(langList.length, 'languages') : null,
          upcoming ? stat(upcoming, 'upcoming') : null,
          watchable.length ? stat(watchable.length, 'to watch now') : null
        ])
      ])
    ]));
    var main = h('div', { class: 'wrapx pwrap' }); v.appendChild(main);
    // Coming up: published coming-soon titles, soonest first; Remind me works as on title pages.
    if (comingUp.length) main.appendChild(h('section', { class: 'psec', 'aria-labelledby': 'pup' }, [
      h('h2', { id: 'pup', text: 'Coming up' }),
      h('div', { class: 'pnow' }, comingUp.slice(0, 4).map(function (t) {
        var d = t.m.data, pa = artLazy(t.m, 'poster'), on = hasReminder(t.m.id);
        return h('article', { class: 'pnc' }, [
          h('a', { class: 'pnp art', href: movieUrl(t.m), style: pa.style, 'data-bg': pa.bg, 'aria-label': d.title }),
          h('div', { class: 'pnb' }, [
            h('span', { class: 'pntag th', text: 'Coming soon' }),
            h('a', { class: 'pnt', href: movieUrl(t.m), text: d.title }),
            h('span', { class: 'pnm', text: [t.lang, d.genre].filter(Boolean).join(' · ') }),
            h('span', { class: 'pnd', text: d.releaseDate ? 'Releasing ' + fmtDate(d.releaseDate) : 'Release date not announced' }),
            h('button', { type: 'button', class: 'btn small cta', 'aria-pressed': String(on), title: on ? 'Tap to cancel the reminder' : 'Get a reminder on release day', on: { click: function () { toggleRemind(t.m.id); } } }, [icon('bell', 15), on ? 'Reminder set' : 'Remind me'])
          ])
        ]);
      }))
    ]));
    // Where to watch: in theatres (tickets when we have them) or streaming (a link when we have one, else the service name).
    if (nowList.length) main.appendChild(h('section', { class: 'psec', 'aria-labelledby': 'pnow' }, [
      h('div', { class: 'psech' }, [h('h2', { id: 'pnow', text: 'Where to watch' }),
        svcNames.length && watchable.length > nowList.length ? h('a', { class: 'psecl', href: '#pfsvc', text: 'All ' + streams.length + ' by service ↓', on: { click: function (e) { e.preventDefault(); var g = $('pfsvc'); if (g) { g.scrollIntoView({ behavior: 'smooth', block: 'center' }); var b = g.querySelector('button'); if (b) b.focus({ preventScroll: true }); } } } }) : null]),
      h('div', { class: 'pnow' }, nowList.map(function (t) {
        var d = t.m.data, pa = artLazy(t.m, 'poster'), sv = t.svc.join(' / ') || d.platform || 'streaming';
        var cta = t.w.th ? (t.w.book ? bookBtn(t.m, 'btn small cta book') : h('span', { class: 'btn small cta static', text: 'In theatres now' }))
          : t.w.url ? h('a', { class: 'btn small cta watch', href: t.w.url, target: '_blank', rel: 'noopener', 'aria-label': 'Watch ' + d.title + ' on ' + sv }, [platLogo(sv), h('span', { text: 'Watch on ' + t.svc[0] })])
          : h('span', { class: 'btn small cta static' }, [platLogo(sv), h('span', { text: 'On ' + t.svc.join(', ') })]);
        return h('article', { class: 'pnc' }, [
          h('a', { class: 'pnp art', href: movieUrl(t.m), style: pa.style, 'data-bg': pa.bg, 'aria-label': d.title }),
          h('div', { class: 'pnb' }, [
            h('span', { class: 'pntag' + (t.w.th ? ' th' : ''), text: (t === latest ? 'Latest · ' : '') + (t.w.th ? 'In theatres' : 'Streaming') }),
            h('a', { class: 'pnt', href: movieUrl(t.m), text: d.title }),
            h('span', { class: 'pnm', text: [t.lang, d.genre, t.tv ? 'TV' : d.runtime].filter(Boolean).join(' · ') }),
            cta
          ])
        ]);
      }))
    ]));
    // Known for: released titles, most-rated first, then ones with a poster, then newest.
    var inNow = {}; nowList.forEach(function (t) { inNow[t.m.id] = 1; });
    var kfl = titles.filter(function (t) { return !t.w.up && !t.tv && !inNow[t.m.id] && (t.acting || !acting.length); }).slice().sort(function (a, b) {
      return (score(b.m.id).tot - score(a.m.id).tot) || ((safeUrl(b.m.data.posterUrl) ? 1 : 0) - (safeUrl(a.m.data.posterUrl) ? 1 : 0)) || b.key.localeCompare(a.key);
    }).slice(0, 6);
    if (titles.length > 6 && kfl.length >= 3) main.appendChild(h('section', { class: 'psec', 'aria-labelledby': 'pkf' }, [
      h('h2', { id: 'pkf', text: 'Known for' }),
      h('div', { class: 'pkf' }, kfl.map(function (t) {
        var pa = artLazy(t.m, 'poster');
        return h('a', { class: 'pkc', href: movieUrl(t.m) }, [
          h('span', { class: 'pkp art', style: pa.style, 'data-bg': pa.bg }, [safeUrl(t.m.data.posterUrl) ? null : h('span', { class: 'ptitle', 'aria-hidden': 'true', text: t.m.data.title })]),
          h('span', { class: 'pkt', text: t.m.data.title }),
          h('span', { class: 'pkm', text: [t.key.slice(0, 4), t.lang].filter(Boolean).join(' · ') })
        ]);
      }))
    ]));
    var cols = h('div', { class: 'pcols' }); main.appendChild(cols);
    // Filmography: grouped by year, with credit-type and language filters.
    var TABS = [['all', 'All credits', titles], ['act', 'Acting', titles.filter(function (t) { return t.acting && !t.tv; })], ['tv', 'TV shows', titles.filter(function (t) { return t.tv; })], ['crew', 'Behind the camera', titles.filter(function (t) { return t.crew && !t.tv; })]].filter(function (x) { return x[0] === 'all' || x[2].length; });
    if (!TABS.some(function (x) { return x[0] === PF.tab; })) PF.tab = 'all';
    if (PF.lang && !langCount[PF.lang]) PF.lang = '';
    if (PF.svc && !bySvc[PF.svc]) PF.svc = '';
    // A service's tile: its logo when we have one, else its first letter on its colour.
    function svcIcon(x) {
      var lg = platLogo(x); if (lg) return lg;
      var hit = PLAT.filter(function (p) { return p[0].test(x); })[0];
      return h('span', { class: 'ctalogo svcini', 'aria-hidden': 'true', style: 'background:' + (hit ? hit[2] : '#2B2F3D'), text: x.charAt(0).toUpperCase() });
    }
    var film = h('section', { class: 'pfilm', 'aria-labelledby': 'pfh' }); cols.appendChild(film);
    function drawFilm(focusSel) {
      film.innerHTML = '';
      var base = TABS.filter(function (x) { return x[0] === PF.tab; })[0][2];
      var pre = base.filter(function (t) { return !PF.lang || t.lang === PF.lang; });
      var svcN = {}; pre.forEach(function (t) { t.svc.forEach(function (x) { svcN[x] = (svcN[x] || 0) + 1; }); });
      var svcShow = svcNames.filter(function (x) { return svcN[x] || x === PF.svc; });
      var list = pre.filter(function (t) { return !PF.svc || t.svc.indexOf(PF.svc) !== -1; }).slice().sort(function (a, b) { return PF.asc ? a.key.localeCompare(b.key) : b.key.localeCompare(a.key); });
      var LIM = 14, shown = PF.all ? list : list.slice(0, LIM);
      function upd(ch, sel) { return function () { Object.keys(ch).forEach(function (k) { PF[k] = ch[k]; }); drawFilm(sel); }; }
      film.appendChild(h('div', { class: 'pfhd' }, [
        h('h2', { id: 'pfh' }, ['Filmography ', h('span', { class: 'note', text: '· ' + list.length + (list.length === 1 ? ' title' : ' titles') })]),
        list.length > 1 ? h('button', { type: 'button', class: 'chip', id: 'pfsort', text: PF.asc ? 'Oldest first' : 'Newest first', 'aria-label': 'Sort: ' + (PF.asc ? 'oldest first' : 'newest first') + '. Tap to change', on: { click: upd({ asc: !PF.asc }, '#pfsort') } }) : null
      ]));
      if (TABS.length > 1) film.appendChild(h('div', { class: 'chips', role: 'group', 'aria-label': 'Credit type' }, TABS.map(function (x) {
        return h('button', { type: 'button', class: 'chip', 'data-k': x[0], 'aria-pressed': String(PF.tab === x[0]), text: x[1] + ' · ' + x[2].length, on: { click: upd({ tab: x[0], all: false }, '[data-k="' + x[0] + '"]') } });
      })));
      if (langList.length > 1) film.appendChild(h('div', { class: 'chips', role: 'group', 'aria-label': 'Language' }, [['', 'Any language']].concat(langList.map(function (l) { return [l, l]; })).map(function (x) {
        return h('button', { type: 'button', class: 'chip', 'data-l': x[0], 'aria-pressed': String(PF.lang === x[0]), text: x[1], on: { click: upd({ lang: x[0], all: false }, '[data-l="' + x[0] + '"]') } });
      })));
      if (svcShow.length) {
        var SV = 6, svs = PF.svcAll ? svcShow : svcShow.slice(0, SV);
        if (PF.svc && svs.indexOf(PF.svc) === -1) svs = svs.concat([PF.svc]);
        film.appendChild(h('div', { class: 'chips psvc', id: 'pfsvc', role: 'group', 'aria-label': 'Streaming on' }, [h('span', { class: 'psvcl', text: 'Streaming on' })].concat(svs.map(function (x) {
          return h('button', { type: 'button', class: 'chip', 'data-s': x, 'aria-pressed': String(PF.svc === x), on: { click: upd({ svc: PF.svc === x ? '' : x, all: false }, '[data-s="' + x.replace(/"/g, '') + '"]') } }, [svcIcon(x), h('span', { text: x }), h('span', { class: 'psvcn', text: String(svcN[x] || 0) })]);
        }), svcShow.length > SV && !PF.svcAll ? [h('button', { type: 'button', class: 'chip', id: 'pfsvcm', text: '+' + (svcShow.length - SV) + ' more', on: { click: upd({ svcAll: true }, '[data-s="' + svcShow[SV].replace(/"/g, '') + '"]') } })] : [])));
      }
      if (PF.svc) film.appendChild(h('div', { class: 'psvcon', role: 'status' }, [h('span', {}, ['Showing ' + pron + ' ', h('b', { text: String(list.length) }), ' on ', h('b', { text: PF.svc })]),
        h('button', { type: 'button', class: 'linkbtn', text: 'Show all credits', on: { click: upd({ svc: '', all: false }, '#pfsort') } })]));
      if (!list.length) film.appendChild(h('div', { class: 'empty', text: 'Nothing matches. Try another language or All credits.' }));
      var box = h('div', { class: 'pyl' }), cur = null;
      shown.forEach(function (t) {
        var y = t.w.up && !t.m.data.releaseDate ? 'Upcoming' : t.key.slice(0, 4) || 'Year not listed';
        if (y !== cur) { cur = y; box.appendChild(h('div', { class: 'pyr', text: y })); }
        var d = t.m.data, pa = artLazy(t.m, 'poster');
        var ch = t.roles.filter(function (x) { return !CREW_RE.test(x) && !HOST_RE.test(x); }), cr = t.roles.filter(function (x) { return CREW_RE.test(x) || HOST_RE.test(x); });
        var role = [ch.length ? 'as ' + ch.join(' · ') : '', cr.join(' · '), t.tv && t.eps ? epText(t.eps) : ''].filter(Boolean).join(' · ');
        box.appendChild(h('a', { class: 'prow', href: movieUrl(t.m) }, [
          h('span', { class: 'prt art', style: pa.style, 'data-bg': pa.bg, 'aria-hidden': 'true' }),
          h('span', { class: 'prb' }, [
            h('span', { class: 'prn', text: d.title }),
            h('span', { class: 'prm', text: [t.lang, d.genre, t.tv ? 'TV' : d.runtime, d.certificate].filter(Boolean).join(' · ') }),
            role ? h('span', { class: 'prr', text: role }) : null
          ]),
          t.w.text ? h('span', { class: 'prw' + (t.w.up ? ' up' : '') }, [t.svc.length ? platLogo(t.svc.join(' / ')) : null, h('span', { text: t.w.text })]) : null
        ]));
      });
      if (shown.length) film.appendChild(box);
      if (!PF.all && list.length > LIM) film.appendChild(h('button', { type: 'button', class: 'btn more', id: 'pfmore', text: 'Show all ' + list.length, on: { click: upd({ all: true }, '.prow:nth-of-type(' + (LIM + 1) + ')') } }));
      if (focusSel) { var f = film.querySelector(focusSel); if (f) f.focus(); }
    }
    drawFilm();
    // Side column: About, languages, collaborators.
    var side = h('aside', { class: 'pside' }); cols.appendChild(side);
    if (window.RS_ABOUT) {
      var facts = titles.map(function (t) { return { m: t.m, title: t.m.data.title, year: when(t).slice(0, 4), date: t.m.data.releaseDate || '', languages: t.m.data.languages, genre: t.m.data.genre,
        tv: t.tv, acting: t.acting, crew: t.crew, roles: t.roles, synopsis: t.m.data.synopsis || '', upcoming: !t.tv && isUpcoming(t.m) }; });
      var collab = RS_ABOUT.collaborators(slug, titles.map(function (t) { return t.m.data; }), personSlug);
      var ap = h('p', { class: 'about' + (PF.about ? '' : ' clamp'), id: 'pabout', text: RS_ABOUT.person({ name: name, titles: facts, collab: collab }) });
      var more = h('button', { type: 'button', class: 'linkbtn', 'aria-expanded': String(!!PF.about), 'aria-controls': 'pabout', text: PF.about ? 'Show less' : 'Read more', on: { click: function () { PF.about = !PF.about; ap.classList.toggle('clamp', !PF.about); more.textContent = PF.about ? 'Show less' : 'Read more'; more.setAttribute('aria-expanded', String(PF.about)); } } });
      side.appendChild(h('section', { class: 'pbox pabout', 'aria-labelledby': 'pab' }, [h('h2', { id: 'pab', text: 'About ' + name }), ap, more]));
      var cw = collab.directors.filter(function (x) { return x.n >= 2; }).map(function (x) { return [x, 'Director']; }).concat(collab.costars.filter(function (x) { return x.n >= 2; }).slice(0, 6).map(function (x) { return [x, 'Co-star']; }));
      if (cw.length) side.appendChild(h('section', { class: 'pbox', 'aria-labelledby': 'pcw' }, [h('h2', { id: 'pcw', text: 'Works most with' }),
        h('div', { class: 'pcw' }, cw.map(function (p) {
          var ph = personPhotoUrl(p[0].name, 96);
          return h('a', { class: 'pcwr', href: personUrl(p[0].name) }, [
            ph ? h('img', { class: 'pcwi', src: ph, alt: '', loading: 'lazy', width: 40, height: 40 }) : h('span', { class: 'pcwi', 'aria-hidden': 'true', style: 'background:' + PAL[hash(p[0].slug) % PAL.length][1], text: initials(p[0].name) }),
            h('span', { class: 'pcwn' }, [h('b', { text: p[0].name }), h('span', { text: p[1] })]),
            h('span', { class: 'pcwk', text: p[0].n + ' titles' })
          ]);
        }))]));
    }
    side.appendChild(fixRow({ person: name, path: '/person/' + slug }));
    if (langList.length > 1) side.appendChild(h('section', { class: 'pbox', 'aria-labelledby': 'plg' }, [h('h2', { id: 'plg', text: 'By language' })].concat(langList.slice(0, 6).map(function (l) {
      return h('div', { class: 'plb' }, [h('div', { class: 'plbt' }, [h('span', { text: l }), h('span', { class: 'note', text: String(langCount[l]) })]),
        h('div', { class: 'plbb', 'aria-hidden': 'true' }, [h('i', { style: 'width:' + Math.max(2, Math.round(langCount[l] / langCount[langList[0]] * 100)) + '%' })])]);
    }))));
  }

  // ---------- people directory (/people) ----------
  // One entry per person across all titles: title count, acting vs crew, languages, latest year.
  function peopleDirectory() {
    var idx = {};
    function add(name, m, crew) {
      var k = personSlug(name); if (!k) return;
      var p = idx[k] || (idx[k] = { slug: k, name: name, ids: {}, n: 0, acting: 0, crew: 0, langs: {}, last: '', titles: [], pop: 0 });
      var first = !p.ids[m.id];
      if (first) { p.ids[m.id] = 1; p.n++; p.titles.push(m); var l = langOf(m.data); if (l) p.langs[l] = 1; var y = (m.data.releaseDate || '').slice(0, 4); if (y > p.last) p.last = y; }
      if (crew) p.crew++; else p.acting++;
      if (first) p.pop += weight;
    }
    // Popularity: top billing counts most, recent and upcoming work counts extra, and audience verdicts add a little.
    var weight = 0, cutoff = String(new Date().getFullYear() - 2);
    S.movies.forEach(function (m) {
      var cast = m.data.cast || [], fresh = (m.data.releaseDate || '') >= cutoff || isUpcoming(m) ? 1.5 : 1, buzz = 1 + Math.min(score(m.id).tot, 50) / 25;
      var ai = 0;
      cast.forEach(function (c) {
        if (!(c.name || '').trim()) return;
        var crew = CREW_RE.test(c.role || '');
        var bill = crew ? (/direct|music|composer/i.test(c.role) ? 2 : 1) : (ai < 3 ? 4 : ai < 6 ? 2 : 1);
        if (!crew) ai++;
        weight = bill * fresh * buzz; add(c.name.trim(), m, crew);
      });
      weight = 2 * fresh * buzz;
      String(m.data.director || '').split(/,| and /).forEach(function (d) { d = d.trim(); if (d && !cast.some(function (c) { return personSlug(c.name) === personSlug(d); })) add(d, m, true); });
    });
    Object.keys(idx).forEach(function (k) { var st = S.people[k], p = idx[k]; if (st && st.name) p.name = st.name; p.aka = (st && st.aka) || []; p.gender = (st && st.gender) || ''; var hid = st && st.popular === 'hide', oi = S.popOrder.indexOf(k); p.pin = hid ? 'hide' : (oi !== -1 || (st && st.popular === 'pin')) ? 'pin' : ''; p.pinAt = oi !== -1 ? oi : 9999; if (personPhotoUrl(p.name)) p.pop *= 1.2; });
    return Object.keys(idx).map(function (k) { return idx[k]; });
  }
  function drawPeople() {
    var v = $('view-people');
    if (!S.loaded && v.querySelector('[data-prerendered]')) return;
    v.innerHTML = '';
    var P = S.ppl, w = h('div', { class: 'wrapx' }); v.appendChild(w);
    document.title = PEOPLE_TITLE;
    w.appendChild(h('h1', { class: 'display', style: 'font-size:44px;margin-bottom:6px', text: 'People' }));
    w.appendChild(h('div', { class: 'sub', style: 'margin-bottom:18px', text: 'Actors, directors and crew across every title on Reelscore.' }));
    if (!S.loaded) { w.appendChild(h('div', { class: 'empty', text: 'Loading…' })); return; }
    var all = peopleDirectory().filter(function (p) { return p.titles.length; });
    var langs = {}; all.forEach(function (p) { Object.keys(p.langs).forEach(function (l) { langs[l] = 1; }); });
    if (P.lang && !langs[P.lang]) P.lang = '';
    // Popular = people pinned in admin, then the top automatic picks up to 120; people hidden in admin never show.
    var pinned = all.filter(function (p) { return p.pin === 'pin'; });
    var auto = all.filter(function (p) { return !p.pin; }).sort(function (a, b) { return b.pop - a.pop; }).slice(0, Math.max(0, 120 - pinned.length));
    var popSet = {}; pinned.concat(auto).forEach(function (p) { popSet[p.slug] = 1; });
    // "All Cast & Crew" and "Behind the camera" are hidden (owner's call); a saved choice of either falls back to Popular.
    if (P.role === 'All' || P.role === 'Behind the camera') P.role = 'Popular';
    w.appendChild(h('div', { class: 'chips', role: 'group', 'aria-label': 'Show', style: 'margin-bottom:14px' }, ['Popular', 'Male actors', 'Female actors', 'Acting'].map(function (r) {
      return h('button', { type: 'button', class: 'chip', 'aria-pressed': String(P.role === r), text: { All: 'All Cast & Crew', Acting: 'All Actors' }[r] || r, on: { click: function () { P.role = r; P.page = 1; render(true); } } });
    })));
    var q = h('input', { id: 'pplQ', class: 'in', type: 'search', placeholder: 'Search by name', autocomplete: 'off' }); q.value = P.q;
    function sel(id, label, val, opts, onc) {
      var e = h('select', { class: 'in', id: id }, opts.map(function (o) { return h('option', { value: o[0], text: o[1], selected: o[0] === val }); }));
      e.addEventListener('change', function () { onc(e.value); P.page = 1; e.blur(); render(true); });
      return h('div', { class: 'field', style: 'min-width:160px;flex:1 1 160px' }, [h('label', { class: 'l', for: id, text: label }), e]);
    }
    w.appendChild(h('div', { style: 'display:flex;flex-wrap:wrap;gap:12px;margin-bottom:22px' }, [
      h('div', { class: 'field', style: 'min-width:220px;flex:2 1 220px' }, [h('label', { class: 'l', for: 'pplQ', text: 'Name' }), q]),
      sel('pplLang', 'Works in', P.lang, [['', 'All languages']].concat(Object.keys(langs).sort().map(function (l) { return [l, l]; })), function (x) { P.lang = x; }),
      sel('pplSort', 'Sort by', P.sort, [['popular', 'Most popular'], ['titles', 'Most titles'], ['recent', 'Most recent work'], ['az', 'A–Z']], function (x) { P.sort = x; })
    ]));
    var count = h('span', { class: 'sub' }), top = h('div', { style: 'margin-bottom:16px' }, [count]), grid = h('div', { class: 'pgrid' }), more = h('div', { style: 'margin-top:26px' });
    w.appendChild(top); w.appendChild(grid); w.appendChild(more);
    // Redraw just the results, so typing in the search box keeps focus.
    function fill() {
      var needle = P.q.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      var list = all.filter(function (p) {
        if (P.role === 'Popular' && !popSet[p.slug]) return false;
        if (P.role === 'Male actors' && !(p.acting && p.gender === 'Male')) return false;
        if (P.role === 'Female actors' && !(p.acting && p.gender === 'Female')) return false;
        if (P.role === 'Acting' && !p.acting) return false;
        if (P.role === 'Behind the camera' && !p.crew) return false;
        if (P.lang && !p.langs[P.lang]) return false;
        if (needle && [p.name].concat(p.aka).join(' | ').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').indexOf(needle) === -1) return false;
        return true;
      });
      list.sort(function (a, b) {
        if (P.sort === 'az') return a.name.localeCompare(b.name);
        if (P.sort === 'popular') return ((b.pin === 'pin') - (a.pin === 'pin')) || (a.pin === 'pin' ? a.pinAt - b.pinAt : 0) || ((a.pin === 'hide') - (b.pin === 'hide')) || b.pop - a.pop || a.name.localeCompare(b.name);
        if (P.sort === 'recent') return b.last.localeCompare(a.last) || b.n - a.n || a.name.localeCompare(b.name);
        return b.n - a.n || a.name.localeCompare(b.name);
      });
      var PER = gridPer(w, 'pgrid'), pages = Math.max(1, Math.ceil(list.length / PER));
      if (P.page > pages) P.page = pages; if (P.page < 1) P.page = 1;
      var from = (P.page - 1) * PER;
      if (S.route === 'people') syncListUrl('/people' + (P.page > 1 ? '?page=' + P.page : ''));
      count.textContent = list.length > PER ? 'Showing ' + (from + 1) + '–' + Math.min(from + PER, list.length) + ' of ' + list.length.toLocaleString('en-IN') + ' people' : list.length + (list.length === 1 ? ' person' : ' people');
      grid.innerHTML = ''; more.innerHTML = '';
      if (!list.length) { grid.appendChild(h('div', { class: 'empty', style: 'grid-column:1/-1', text: 'No one matches. Try another name or clear the filters.' })); return; }
      list.slice(from, from + PER).forEach(function (p) {
        var ph = personPhotoUrl(p.name);
        var role = p.acting && p.crew ? 'Acting · Crew' : p.acting ? 'Acting' : 'Behind the camera';
        grid.appendChild(h('a', { class: 'pcard', href: personUrl(p.name), 'aria-label': p.name + ', ' + p.n + (p.n === 1 ? ' title' : ' titles') }, [
          ph ? h('img', { class: 'pfi', src: ph, alt: '', loading: 'lazy', decoding: 'async' }) : h('span', { class: 'pfi', style: 'background:' + PAL[hash(p.slug) % PAL.length][1], 'aria-hidden': 'true', text: initials(p.name) }),
          h('span', { class: 'pn', text: p.name }),
          h('span', { class: 'pm', text: p.n + (p.n === 1 ? ' title' : ' titles') + ' · ' + role })
        ]));
      });
      if (pages > 1) {
        var pager = pagerNav(P.page, pages, function (n) { return '/people' + (n > 1 ? '?page=' + n : ''); }, function (n) {
          P.page = n; history.pushState(null, '', '/people' + (n > 1 ? '?page=' + n : '')); fill(); top.scrollIntoView({ block: 'start' }); window.scrollBy(0, -90);
        });
        pager.setAttribute('aria-label', 'People pages'); pager.style.marginTop = '';
        more.appendChild(pager);
      }
    }
    q.addEventListener('input', function () { P.q = q.value; P.page = 1; fill(); });
    fill();
  }

  // Card actions by status: Book tickets for theatre titles, Watch now for released titles with a streaming link, reminders for upcoming ones.
  function actOpts(m) {
    var sec = m.data.section, inTh = (S.route === 'browse' && S.browse && S.browse.status === 'In theatres') || (S.route === 'movies' && S.cat.movies.status === 'In theatres');
    // Upcoming films: the Coming soon icon row (Trailer, Remind me or Tickets, Not for me), as on the home page.
    if (!released(m)) return isTv(m) ? { dateBadge: true, remind: true } : { dateBadge: true, upIcons: true };
    return sec === 'In theatres' ? { book: true, inTheatresList: inTh, seenIcons: S.route === 'browse' } : { stream: true };
  }
  // ---------- Browse: status tabs with counts, a filter column (a sheet on phones), active filters as chips ----------
  // Language, Streaming on and Genre take several values (comma-separated in the URL; any of them matches); Released takes one.
  // Each group's counts apply every other filter, so a count is what ticking it would add.
  function bVals(s) { return String(s || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean); }
  function bToggle(s, v) { var a = bVals(s), i = a.indexOf(v); if (i === -1) a.push(v); else a.splice(i, 1); return a.join(','); }
  function ottsOf(d) { var p = String(d.platform || ''); if (!p) return []; return OTTS.filter(function (o) { return o[2].test(p); }).map(function (o) { return o[0]; }); }
  function bYears() {
    var y = new Date().getFullYear(), d0 = Math.floor((y - 2) / 10) * 10;
    var out = [[String(y), String(y)], [String(y - 1), String(y - 1)]];
    if (y - 2 >= d0) out.push([d0 + '-' + (y - 2), d0 + '–' + String(y - 2).slice(2)]);
    for (var d = d0 - 10; d >= 2000; d -= 10) out.push([d + '-' + (d + 9), d + 's']);
    out.push(['1900-1999', 'Before 2000']);
    return out;
  }
  function bYearOk(d, v) {
    if (!v) return true;
    var y = +(d.releaseDate || '').slice(0, 4); if (!y) return false;
    var m = String(v).match(/^(\d{4})(?:-(\d{4}))?$/); if (!m) return true;
    return y >= +m[1] && y <= +(m[2] || m[1]);
  }
  function bYearLabel(v) { var hit = bYears().filter(function (o) { return o[0] === v; })[0]; return hit ? hit[1] : String(v).replace('-', '–'); }
  var B_SORTS = [['new', 'Newest first'], ['score', 'Highest score'], ['votes', 'Most verdicts'], ['old', 'Oldest first'], ['az', 'A–Z']];
  function drawBrowse() {
    var v = $('view-browse');
    if (!S.loaded && v.querySelector('[data-prerendered]')) return;
    var sheetScroll = v.querySelector('.bsheet-body') ? v.querySelector('.bsheet-body').scrollTop : 0;
    v.innerHTML = '';
    var w = h('div', { class: 'wrapx bpage' }); v.appendChild(w);
    var B = S.browse, LP = B.landing;
    B.q = B.q || '';
    var fold = function (t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); };
    var langs = bVals(B.lang), otts = bVals(B.ott), gens = bVals(B.genre), words = fold(B.q).split(/\s+/).filter(Boolean);
    // One test per filter; `skip` leaves one out, for that group's counts.
    function pass(m, skip) {
      var d = m.data;
      if (LP && LP.kind === 'movies' && isTv(m)) return false;
      if (skip !== 'status' && B.status !== 'All' && (B.status === 'All movies' ? isTv(m) : d.section !== B.status)) return false;
      if (skip !== 'status' && B.status === 'Coming soon' && soonTba(m)) return false; // TBA titles stay off Browse > Coming soon
      if (skip !== 'lang' && langs.length && langs.indexOf(langOf(d)) === -1) return false;
      if (skip !== 'ott' && otts.length && !ottsOf(d).some(function (o) { return otts.indexOf(o) !== -1; })) return false;
      if (skip !== 'genre' && gens.length && !genreTags(d).some(function (g) { return gens.indexOf(g) !== -1; })) return false;
      if (skip !== 'year' && !bYearOk(d, B.year)) return false;
      if (words.length) {
        var hay = m._bhay || (m._bhay = fold([d.title, d.director, (d.cast || []).slice(0, 10).map(function (c) { return c.name; }).join(' ')].join(' ')));
        if (!words.every(function (wd) { return hay.indexOf(wd) !== -1; })) return false;
      }
      return true;
    }
    function counts(skip, keyOf) {
      var c = {}; if (!S.loaded) return c;
      S.movies.forEach(function (m) { if (!pass(m, skip)) return; [].concat(keyOf(m.data)).forEach(function (k) { if (k) c[k] = (c[k] || 0) + 1; }); });
      return c;
    }
    var go = function (patch, focusKey) {
      Object.keys(patch).forEach(function (k) { B[k] = patch[k]; });
      B.page = 1; B.landing = null; S.bFocus = focusKey || null; render(true);
    };
    var nf = function (n) { return Number(n || 0).toLocaleString('en-IN'); };

    // Title, count line and search
    var all = S.loaded ? S.movies.filter(function (m) { return pass(m); }) : [];
    var head = h('div', { class: 'bhead' }, [
      h('div', {}, [h('h1', { class: 'display', style: 'font-size:44px;margin:0', text: LP ? LP.h1 : 'Browse' }),
        h('p', { class: 'sub', style: 'margin:8px 0 0', text: LP ? 'Newest first, with where to watch and whether each is worth it. Change the filters to see more.' : 'Every film and series on Reelscore, from classics to what’s coming next.' })])
    ]);
    var qIn = h('input', { class: 'in', id: 'bQ', type: 'search', placeholder: 'Titles, cast or directors', autocomplete: 'off' }); qIn.value = B.q;
    var qt = null;
    qIn.addEventListener('input', function () { clearTimeout(qt); qt = setTimeout(function () { go({ q: qIn.value }, 'q'); }, 250); });
    head.appendChild(h('div', { class: 'field bq' }, [h('label', { class: 'l', for: 'bQ', text: 'Search in Browse' }), qIn]));
    w.appendChild(head);

    // Status tabs, with counts under the other filters
    var sc = counts('status', function (d) { return d.section; }), tot = 0; Object.keys(sc).forEach(function (k) { tot += sc[k]; });
    sc['All movies'] = tot - (sc['TV shows'] || 0);
    if (sc['Coming soon'] && S.loaded) sc['Coming soon'] -= S.movies.filter(function (m) { return soonTba(m) && pass(m, 'status'); }).length; // the tab counts what it shows
    var statuses = ['All', 'All movies', 'In theatres', 'Coming soon', 'On OTT', 'TV shows'];
    w.appendChild(h('nav', { class: 'btabs', 'aria-label': 'What to show' }, statuses.map(function (st) {
      var n = st === 'All' ? tot : sc[st] || 0, on = B.status === st;
      return h('a', { class: 'btab' + (on ? ' on' : '') + (S.loaded && !n ? ' zero' : ''), href: browseHref({ status: st, lang: B.lang, genre: B.genre, year: B.year, ott: B.ott }, 1), 'aria-current': on ? 'page' : null,
        on: { click: function (e) { if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; e.preventDefault(); go({ status: st }); } } },
        [h('span', { text: BROWSE_TAB[st] || st }), S.loaded ? h('span', { class: 'bn', text: nf(n) }) : null]);
    })));

    // Filter groups (the same for the column and the phone sheet)
    S.bMore = S.bMore || {};
    function groups(where) {
      var box = h('div', { class: 'bgroups' });
      var row = function (grp, key, label, n, on, icon) {
        var id = 'bf-' + where + '-' + grp + '-' + String(key).replace(/[^a-z0-9]+/gi, '-');
        var cb = h('input', { type: 'checkbox', id: id, 'data-fk': where + ':' + grp + ':' + key }); cb.checked = on;
        cb.addEventListener('change', function () { var p = {}; p[grp] = bToggle(B[grp], key); go(p, where + ':' + grp + ':' + key); });
        return h('label', { class: 'brow' + (!n && !on ? ' zero' : ''), for: id }, [cb, icon || null, h('span', { class: 'brl', text: label }), h('span', { class: 'bn', text: nf(n) })]);
      };
      var chip = function (grp, key, label, n, on) {
        return h('button', { type: 'button', class: 'chip bchip' + (on ? ' on' : ''), 'aria-pressed': String(on), 'data-fk': where + ':' + grp + ':' + key,
          on: { click: function () { var p = {}; p[grp] = grp === 'year' ? (on ? '' : key) : bToggle(B[grp], key); go(p, where + ':' + grp + ':' + key); } } },
          [label, n != null ? h('span', { class: 'bn', text: nf(n) }) : null]);
      };
      var group = function (title, kids, more) { return h('fieldset', { class: 'bgroup' }, [h('legend', { text: title })].concat(kids, more ? [more] : [])); };
      var list = function (grp, cnt, picked, label, icon, top) {
        var keys = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a] || a.localeCompare(b); });
        picked.forEach(function (k) { if (keys.indexOf(k) === -1) keys.unshift(k); });
        var open = S.bMore[grp], shown = open ? keys : keys.slice(0, top).concat(picked.filter(function (k) { return keys.indexOf(k) >= top; }));
        var more = keys.length > shown.length || open ? h('button', { type: 'button', class: 'bmore', 'aria-expanded': String(!!open), text: open ? 'Show fewer' : '+ ' + (keys.length - shown.length) + ' more',
          on: { click: function () { S.bMore[grp] = !open; S.bFocus = null; render(true); } } }) : null;
        var kids = shown.map(function (k) { return where === 'sheet' ? chip(grp, k, label(k), cnt[k] || 0, picked.indexOf(k) !== -1) : row(grp, k, label(k), cnt[k] || 0, picked.indexOf(k) !== -1, icon ? icon(k) : null); });
        return { kids: where === 'sheet' ? [h('div', { class: 'chips' }, kids)] : kids, more: more };
      };
      var L = list('lang', counts('lang', function (d) { return langOf(d); }), langs, function (k) { return k; }, null, 8);
      box.appendChild(group('Language', L.kids, L.more));
      var O = list('ott', counts('ott', ottsOf), otts, ottName, function (k) { return svcIcon(ottName(k)); }, 6);
      box.appendChild(group('Streaming on', O.kids, O.more));
      var gc = counts('genre', genreTags);
      box.appendChild(group('Genre', [h('div', { class: 'chips' }, GENRES.filter(function (g) { return gc[g] || gens.indexOf(g) !== -1; }).map(function (g) { return chip('genre', g, g, null, gens.indexOf(g) !== -1); }))]));
      var yc = {}; if (S.loaded) S.movies.forEach(function (m) { if (!pass(m, 'year')) return; bYears().forEach(function (o) { if (bYearOk(m.data, o[0])) yc[o[0]] = (yc[o[0]] || 0) + 1; }); });
      var yrs = bYears().filter(function (o) { return yc[o[0]] || o[0] === B.year; });
      if (B.year && !bYears().some(function (o) { return o[0] === B.year; })) yrs.unshift([B.year, bYearLabel(B.year)]);
      box.appendChild(group('Released', [h('div', { class: 'chips' }, yrs.map(function (o) { return chip('year', o[0], o[1], yc[o[0]] || 0, B.year === o[0]); }))]));
      return box;
    }
    function svcIcon(name) { var lg = platLogo(name); if (lg) return lg; var hit = PLAT.filter(function (p) { return p[0].test(name); })[0]; return h('span', { class: 'ctalogo svcini', 'aria-hidden': 'true', style: 'background:' + (hit ? hit[2] : '#2B2F3D'), text: String(name).charAt(0).toUpperCase() }); }
    var active = (B.status !== 'All') + langs.length + otts.length + gens.length + !!B.year + !!B.q.trim();
    var nFilters = langs.length + otts.length + gens.length + !!B.year;
    var clearAll = function () { go({ status: 'All', lang: '', genre: '', year: '', ott: '', q: '' }); };

    // Popular pages: the language pages (as links, for people and search engines alike)
    var fl = {}; S.movies.forEach(function (m) { if (isTv(m)) return; var l = langOf(m.data); if (/^[A-Za-z]+$/.test(l)) fl[l] = (fl[l] || 0) + 1; });
    var topL = Object.keys(fl).filter(function (l) { return fl[l] >= 5; }).sort(function (a, b) { return fl[b] - fl[a]; });
    var pages = h('nav', { class: 'bpages', 'aria-label': 'Popular pages' }, [h('span', { class: 'bpl', text: 'Popular pages' })].concat(
      topL.slice(0, 1).map(function (l) { return h('a', { href: '/new-' + l.toLowerCase() + '-movies-on-ott', text: 'New ' + l + ' movies on OTT →' }); }),
      topL.slice(0, 5).map(function (l) { return h('a', { href: '/' + l.toLowerCase() + '-movies', text: l + ' movies →', 'aria-current': LP && LP.lang === l && !LP.year && LP.status === 'All' ? 'page' : null }); }),
      [h('a', { href: '/year/' + new Date().getFullYear(), text: 'Movies of ' + new Date().getFullYear() + ' →' }), h('a', { href: '/lists', text: 'Lists →' })]));

    var body = h('div', { class: 'bbody' }); w.appendChild(body);
    var rail = h('aside', { class: 'brail', 'aria-label': 'Filters' }, [
      h('div', { class: 'brail-h' }, [h('h2', { text: 'Filters' }), nFilters ? h('button', { type: 'button', class: 'bclear', text: 'Clear all', on: { click: clearAll } }) : null]),
      groups('rail'), pages]);
    body.appendChild(rail);
    var main = h('section', { class: 'bmain', 'aria-label': 'Results' }); body.appendChild(main);

    // Results bar: phone Filters button, the active filters as chips, the count and Sort
    var pills = [];
    langs.forEach(function (k) { pills.push([k, function () { go({ lang: bToggle(B.lang, k) }); }]); });
    otts.forEach(function (k) { pills.push([ottName(k), function () { go({ ott: bToggle(B.ott, k) }); }]); });
    gens.forEach(function (k) { pills.push([k, function () { go({ genre: bToggle(B.genre, k) }); }]); });
    if (B.year) pills.push([bYearLabel(B.year), function () { go({ year: '' }); }]);
    if (B.q.trim()) pills.push(['“' + B.q.trim() + '”', function () { go({ q: '' }); }]);
    var so = h('select', { class: 'in', id: 'bSort' }, B_SORTS.map(function (o) { return h('option', { value: o[0], text: o[0] === 'new' && B.status === 'Coming soon' ? 'Releasing soonest' : o[1], selected: o[0] === B.sort }); }));
    so.addEventListener('change', function () { B.sort = so.value; B.page = 1; so.blur(); render(true); });
    main.appendChild(h('div', { class: 'bbar' }, [
      h('div', { class: 'bbar-l' }, [
        h('button', { type: 'button', class: 'bfbtn', 'aria-haspopup': 'dialog', on: { click: function () { S.bSheet = true; render(true); } } }, [icon('sliders', 16), 'Filters' + (nFilters ? ' · ' + nFilters : '')]),
        h('span', { class: 'bcount', role: 'status' }, S.loaded ? [h('b', { text: nf(all.length) }), all.length === 1 ? ' title' : ' titles'] : ['Loading…'])
      ].concat(pills.map(function (p) { return h('button', { type: 'button', class: 'bpill', 'aria-label': 'Remove filter: ' + p[0], on: { click: p[1] } }, [p[0], h('span', { 'aria-hidden': 'true', text: '✕' })]); }),
        active ? [h('button', { type: 'button', class: 'bclear', text: 'Clear all', on: { click: clearAll } })] : [])),
      h('div', { class: 'bsort' }, [h('label', { for: 'bSort', text: 'Sort' }), so])
    ]));

    if (!S.loaded) { main.appendChild(h('div', { class: 'empty', text: 'Loading…' })); return; }
    var list = all, scm = {}; list.forEach(function (m) { scm[m.id] = score(m.id); });
    list.sort(function (a, b) {
      var A = a.data, Bd = b.data;
      if (B.sort === 'old') return (A.releaseDate || '9').localeCompare(Bd.releaseDate || '9');
      if (B.sort === 'score') return (scm[b.id].pct === null ? -1 : scm[b.id].pct) - (scm[a.id].pct === null ? -1 : scm[a.id].pct) || scm[b.id].tot - scm[a.id].tot;
      if (B.sort === 'votes') return scm[b.id].tot - scm[a.id].tot;
      if (B.sort === 'az') return (A.title || '').localeCompare(Bd.title || '');
      // Coming soon: the default order is the soonest release first, undated (TBA) titles last.
      if (B.sort === 'new' && B.status === 'Coming soon') return (A.releaseDate || '9999').localeCompare(Bd.releaseDate || '9999');
      return (Bd.releaseDate || '').localeCompare(A.releaseDate || '');
    });
    if (B.sort === 'new' && !B.q.trim()) list = pinFirst(list, rowPins(B.status));
    if (!list.length) {
      // What was asked for, sent with a "Missing film" message: the search words and the filters picked.
      var askedFor = [B.q.trim() ? '\u201c' + B.q.trim() + '\u201d' : '', B.status !== 'All' ? B.status : '', bVals(B.lang).join(', '), bVals(B.ott).join(', '), bVals(B.genre).join(', '), B.year].filter(Boolean).join(' \u00b7 ');
      main.appendChild(h('div', { class: 'empty' }, ['Nothing matches these filters. ', active ? h('button', { type: 'button', class: 'btn small', text: 'Clear all', on: { click: clearAll } }) : null,
        h('div', { style: 'margin-top:12px' }, [h('button', { type: 'button', class: 'linkbtn fbmiss2', text: 'Missing a film? Tell us', on: { click: function () { openFeedback({ type: 'add', q: B.q.trim(), filters: askedFor, path: location.pathname + location.search }); } } })])]));
    }
    else {
      var PER = gridPer(main), pages2 = Math.ceil(list.length / PER); B.page = Math.min(Math.max(1, B.page || 1), pages2);
      syncListUrl(bHref(B, B.page));
      var from = (B.page - 1) * PER;
      main.appendChild(h('div', { class: 'grid-posters' }, list.slice(from, from + PER).map(function (m) { return posterCard(m, actOpts(m)); })));
      if (pages2 > 1) main.appendChild(pagerNav(B.page, pages2, function (n) { return bHref(B, n); }));
    }

    // Phone: the filters in a sheet from the bottom; changes apply at once, "Show N titles" closes it.
    if (S.bSheet) {
      var closeSheet = function () { S.bSheet = false; S.bFocus = 'filtersbtn'; render(true); };
      var sbody = h('div', { class: 'bsheet-body' }, [groups('sheet')]);
      var sheet = h('div', { class: 'bsheet-wrap' }, [
        h('div', { class: 'bsheet-bg', 'aria-hidden': 'true', on: { click: closeSheet } }),
        h('section', { class: 'bsheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'bsh' }, [
          h('div', { class: 'bsheet-h' }, [h('h2', { id: 'bsh', text: 'Filters' }), h('span', { style: 'flex:1' }), nFilters ? h('button', { type: 'button', class: 'bclear', text: 'Clear all', on: { click: function () { S.bFocus = 'sheetclose'; go({ lang: '', genre: '', year: '', ott: '' }, 'sheetclose'); } } }) : null,
            h('button', { type: 'button', class: 'bsheet-x', 'aria-label': 'Close filters', 'data-fk': 'sheetclose', text: '✕', on: { click: closeSheet } })]),
          sbody,
          h('div', { class: 'bsheet-f' }, [h('button', { type: 'button', class: 'btn primary', text: all.length ? 'Show ' + nf(all.length) + (all.length === 1 ? ' title' : ' titles') : 'No titles match', on: { click: closeSheet } })])
        ])]);
      sheet.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); closeSheet(); } });
      v.appendChild(sheet); document.body.classList.add('bsheet-open');
      requestAnimationFrame(function () { sbody.scrollTop = sheetScroll; });
    } else document.body.classList.remove('bsheet-open');

    // Put focus back on the control that was used, after the redraw.
    var fk = S.bFocus; S.bFocus = null;
    if (fk) requestAnimationFrame(function () {
      var el = fk === 'q' ? $('bQ') : fk === 'filtersbtn' ? v.querySelector('.bfbtn') : v.querySelector('[data-fk="' + (fk.indexOf(':') === -1 ? fk : fk) + '"]');
      if (!el && fk.indexOf(':') !== -1) { var alt = fk.replace(/^(rail|sheet):/, S.bSheet ? 'sheet:' : 'rail:'); el = v.querySelector('[data-fk="' + alt + '"]'); }
      if (el) { el.focus({ preventScroll: true }); if (fk === 'q') { var n = el.value.length; try { el.setSelectionRange(n, n); } catch (e) {} } }
    });
  }
  // ---------- Movies (/movies) and TV Shows (/tv-shows): Browse split by kind; Browse itself is unchanged ----------
  function catFromUrl(C, status) {
    var qs = new URLSearchParams(location.search);
    C.status = status; C.lang = qs.get('lang') || ''; C.genre = qs.get('genre') || ''; C.year = /^\d{4}$/.test(qs.get('year') || '') ? qs.get('year') : ''; C.ott = ottName(qs.get('ott') || '') ? qs.get('ott') : ''; C.page = qPage();
  }
  function catHref(kind, o, page) {
    var q = [];
    if (o.lang) q.push('lang=' + encodeURIComponent(o.lang));
    if (o.genre) q.push('genre=' + encodeURIComponent(o.genre));
    if (o.year) q.push('year=' + o.year);
    if (o.ott) q.push('ott=' + encodeURIComponent(o.ott));
    if (page > 1) q.push('page=' + page);
    var base = '/tv-shows';
    if (kind === 'movies') { base = '/movies'; for (var k in MOVIE_SECTIONS) if (MOVIE_SECTIONS[k] === o.status) base = '/browse/' + k; }
    return base + (q.length ? '?' + q.join('&') : '');
  }
  // A Movies section lists the same films as its Browse section, so search engines are pointed there.
  function catCanonical() {
    var page = qPage(), qs = new URLSearchParams(location.search), filtered = qs.get('lang') || qs.get('genre') || qs.get('year') || qs.get('ott');
    var m = location.pathname.match(/^\/movies\/([a-z-]+)$/);
    if (m) return '/browse/' + (OLD_SECTIONS[m[1]] || m[1]) + (page > 1 && !filtered ? '?page=' + page : '');
    return location.pathname + (page > 1 && !filtered ? '?page=' + page : '');
  }
  function drawCatalog(kind) {
    var tv = kind === 'tv', v = $(tv ? 'view-tvshows' : 'view-movies');
    if (!S.loaded && v.querySelector('[data-prerendered]')) return;
    v.innerHTML = '';
    if (tv && S.loaded) {
      var tfeat = tvHeroPicks();
      if (tfeat.length) { setHeroCtx('tvshows', tfeat, 'tvHeroBox'); if (S.slide >= tfeat.length) S.slide = 0; v.appendChild(h('div', { id: 'tvHeroBox', style: 'margin-bottom:28px' })); drawHero(); }
    }
    if (tv) { drawTvRows(v); return; }
    if (location.pathname !== '/movies' || /[?&](lang|genre|year|ott|page)=/.test(location.search)) {
      // Old section and filter links: the same list on Browse.
      history.replaceState(null, '', location.pathname.replace(/^\/movies/, '/browse') + location.search); parseRoute(); return;
    }
    if (S.loaded) {
      var mfeat = movieHeroPicks();
      if (mfeat.length) { setHeroCtx('movies', mfeat, 'movHeroBox'); if (S.slide >= mfeat.length) S.slide = 0; v.appendChild(h('div', { id: 'movHeroBox', style: 'margin-bottom:28px' })); drawHero(); }
    }
    drawMovieRows(v); return;
    var w = h('div', { class: 'wrapx' }); v.appendChild(w);
    var C = S.cat[kind];
    document.title = tv ? TV_TITLE : C.status === 'All' ? MOVIES_TITLE : (BROWSE_TITLES[C.status] || MOVIES_TITLE);
    w.appendChild(h('h1', { class: 'display', style: 'font-size:44px;margin-bottom:6px', text: tv ? 'TV Shows' : 'Movies' }));
    w.appendChild(h('div', { class: 'sub', style: 'margin-bottom:18px', text: tv ? 'Every TV show and web series on Reelscore, with where to watch and whether each is worth it.' : 'Every film on Reelscore, from classics to what’s coming next.' }));
    if (!tv) {
      var statuses = ['All', 'In theatres', 'Coming soon', 'On OTT', 'Older releases'];
      w.appendChild(h('div', { class: 'chips', role: 'group', 'aria-label': 'Status', style: 'margin-bottom:14px' }, statuses.map(function (st) {
        return h('a', { class: 'chip', href: catHref(kind, { status: st, lang: C.lang, genre: C.genre, year: C.year, ott: C.ott }, 1), 'aria-current': C.status === st ? 'page' : null, 'aria-pressed': String(C.status === st), text: st });
      })));
    }
    var pool = S.movies.filter(function (m) { return isTv(m) === tv; });
    var langs = {}, years = {};
    pool.forEach(function (m) { var l = langOf(m.data); if (l) langs[l] = 1; if (m.data.releaseDate) years[m.data.releaseDate.slice(0, 4)] = 1; });
    function sel(id, label, val, opts, onc) {
      var e = h('select', { class: 'in', id: id }, opts.map(function (o) { return h('option', { value: o[0], text: o[1], selected: o[0] === val }); }));
      e.addEventListener('change', function () { onc(e.value); C.page = 1; e.blur(); history.replaceState(null, '', catHref(kind, C, 1)); render(true); });
      return h('div', { class: 'field', style: 'min-width:160px;flex:1 1 160px' }, [h('label', { class: 'l', for: id, text: label }), e]);
    }
    var px = tv ? 't' : 'm';
    w.appendChild(h('div', { style: 'display:flex;flex-wrap:wrap;gap:12px;margin-bottom:22px' }, [
      sel(px + 'Lang', 'Language', C.lang, [['', 'All languages']].concat(Object.keys(langs).sort().map(function (l) { return [l, l]; })), function (x) { C.lang = x; }),
      sel(px + 'Genre', 'Genre', C.genre, [['', 'All genres']].concat(GENRES.map(function (g) { return [g, g]; })), function (x) { C.genre = x; }),
      sel(px + 'Year', 'Year', C.year, [['', 'Any year']].concat(Object.keys(years).sort().reverse().map(function (y) { return [y, y]; })), function (x) { C.year = x; }),
      sel(px + 'Ott', 'Streaming on', C.ott, [['', 'Any service']].concat(ottOptions(pool, C.ott)), function (x) { C.ott = x; }),
      sel(px + 'Sort', 'Sort by', C.sort, [['new', 'Newest first'], ['old', 'Oldest first'], ['score', 'Highest score'], ['votes', 'Most verdicts'], ['az', 'A–Z']], function (x) { C.sort = x; })
    ]));
    // Quick links to the language pages (languages with 5+ titles of this kind)
    var fl = {}; pool.forEach(function (m) { var l = langOf(m.data); if (/^[A-Za-z]+$/.test(l)) fl[l] = (fl[l] || 0) + 1; });
    var top = Object.keys(fl).filter(function (l) { return fl[l] >= 5; }).sort(function (a, b) { return fl[b] - fl[a]; }).slice(0, 10);
    if (top.length && S.loaded) w.appendChild(h('div', { class: 'sub', style: 'margin:-10px 0 20px' }, [h('span', { text: 'By language: ' })].concat(top.map(function (l, i) {
      return [i ? ' · ' : '', h('a', { href: '/' + l.toLowerCase() + (tv ? '-web-series' : '-movies'), text: l })];
    }).reduce(function (a, b) { return a.concat(b); }, []))));
    var list = pool.filter(function (m) {
      var d = m.data;
      if (!tv && C.status !== 'All' && d.section !== C.status) return false;
      if (!tv && C.status === 'Coming soon' && soonTba(m)) return false;
      if (C.lang && langOf(d) !== C.lang) return false;
      if (C.genre && genreTags(d).indexOf(C.genre) === -1) return false;
      if (C.year && (d.releaseDate || '').slice(0, 4) !== C.year) return false;
      if (C.ott && ottOf(d) !== C.ott) return false;
      return true;
    });
    var sc = {}; list.forEach(function (m) { sc[m.id] = score(m.id); });
    list.sort(function (a, b) {
      var A = a.data, Bd = b.data;
      if (C.sort === 'old') return (A.releaseDate || '9').localeCompare(Bd.releaseDate || '9');
      if (C.sort === 'score') return (sc[b.id].pct === null ? -1 : sc[b.id].pct) - (sc[a.id].pct === null ? -1 : sc[a.id].pct) || sc[b.id].tot - sc[a.id].tot;
      if (C.sort === 'votes') return sc[b.id].tot - sc[a.id].tot;
      if (C.sort === 'az') return (A.title || '').localeCompare(Bd.title || '');
      if (C.status === 'Coming soon') return (A.releaseDate || '9999').localeCompare(Bd.releaseDate || '9999'); // soonest first, TBA last
      return (Bd.releaseDate || '').localeCompare(A.releaseDate || '');
    });
    if (!tv && C.sort === 'new' && C.status !== 'All') list = pinFirst(list, rowPins(C.status));
    var noun = tv ? ['show', 'shows'] : ['movie', 'movies'], PER = 60;
    var active = (!tv && C.status !== 'All') + !!C.lang + !!C.genre + !!C.year + !!C.ott, pg = Math.min(C.page || 1, Math.max(1, Math.ceil(list.length / PER)));
    w.appendChild(h('div', { style: 'display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-bottom:16px' }, [
      h('span', { class: 'sub', text: list.length > PER ? 'Showing ' + ((pg - 1) * PER + 1) + '–' + Math.min(pg * PER, list.length) + ' of ' + list.length.toLocaleString('en-IN') + ' ' + noun[1] : list.length + ' ' + noun[list.length === 1 ? 0 : 1] }),
      active ? h('button', { type: 'button', class: 'btn small ghost', text: 'Clear filters', on: { click: function () { S.cat[kind] = { status: 'All', lang: '', genre: '', year: '', ott: '', sort: C.sort, page: 1 }; history.replaceState(null, '', tv ? '/tv-shows' : '/movies'); render(true); } } }) : null
    ]));
    if (!S.loaded) { w.appendChild(h('div', { class: 'empty', text: 'Loading…' })); return; }
    if (!list.length) { w.appendChild(h('div', { class: 'empty', text: 'Nothing matches these filters.' })); return; }
    var pages = Math.ceil(list.length / PER); C.page = Math.min(Math.max(1, C.page || 1), pages);
    var href = catHref(kind, C, C.page);
    if (href !== location.pathname + location.search) history.replaceState(null, '', href);
    setCanonical(catCanonical());
    var from = (C.page - 1) * PER;
    w.appendChild(h('div', { class: 'grid-posters' }, list.slice(from, from + PER).map(function (m) { return posterCard(m, actOpts(m)); })));
    if (pages > 1) w.appendChild(pagerNav(C.page, pages, function (n) { return catHref(kind, C, n); }));
  }
  // TV Shows page: rows of shows (by service and genre) under the banner. Each "See all" opens Browse › TV shows with
  // that filter, which also lists every show. Old /tv-shows?… filter links go to the same Browse list.
  var TV_ROW_MAX = 20;
  function drawTvRows(v) {
    var qs = location.search;
    if (/[?&](lang|genre|year|ott|page)=/.test(qs)) { history.replaceState(null, '', '/browse/tv-shows' + qs.replace(/([?&])page=\d+&?/, '$1').replace(/[?&]$/, '')); parseRoute(); return; }
    document.title = TV_TITLE;
    v.appendChild(h('div', { class: 'wrapx', style: 'padding-bottom:0' }, [
      h('h1', { class: 'display', style: 'font-size:44px;margin-bottom:6px', text: 'TV Shows' }),
      h('div', { class: 'sub', text: 'TV shows and web series by streaming service and genre, newest first, with where to watch and whether each is worth it.' })
    ]));
    if (!S.loaded) { v.appendChild(h('div', { class: 'wrapx' }, [h('div', { class: 'empty', text: S.loadMsg || 'Loading…' })])); return; }
    var all = homeSection('TV shows'), newest = function (a, b) { return (b.data.releaseDate || '').localeCompare(a.data.releaseDate || ''); };
    var by = function (f) { return all.filter(f).sort(newest); };
    var tvHref = function (q) { return '/browse/tv-shows' + (q ? '?' + q : ''); };
    var y = String(new Date().getFullYear()), fresh = by(function (m) { return (m.data.releaseDate || '').slice(0, 4) === y; });
    var rows = [];
    if (fresh.length >= 6) rows.push(['New this year', fresh, tvHref('year=' + y)]);
    else rows.push(['New shows', all.slice().sort(newest), tvHref('')]);
    [['netflix', 'New on Netflix'], ['prime-video', 'New on Prime Video'], ['jiohotstar', 'New on JioHotstar']].forEach(function (o) {
      rows.push([o[1], by(function (m) { return ottOf(m.data) === o[0]; }), tvHref('ott=' + o[0])]);
    });
    [['Thriller', 'Thriller & crime'], ['Comedy', 'Comedy'], ['Romance', 'Romance'], ['Action', 'Action'], ['Horror', 'Horror']].forEach(function (g) {
      rows.push([g[1], by(function (m) { return genreTags(m.data).indexOf(g[0]) !== -1; }), tvHref('genre=' + encodeURIComponent(g[0]))]);
    });
    [['zee5', 'On ZEE5'], ['sonyliv', 'On SonyLIV']].forEach(function (o) {
      rows.push([o[1], by(function (m) { return ottOf(m.data) === o[0]; }), tvHref('ott=' + o[0])]);
    });
    rows.push(['Reality & game shows', by(function (m) { return /reality|talk|game|quiz|talent/i.test(m.data.genre || ''); }), null]);
    rows.forEach(function (r) {
      if (r[1].length < 4) return;
      var sec = rowSection(r[0], r[1], { max: TV_ROW_MAX }, r[2] ? seeAll(r[2]) : null);
      if (sec) v.appendChild(sec);
    });
    v.appendChild(h('div', { class: 'wrapx', style: 'padding-top:8px' }, [h('a', { class: 'btn', href: tvHref(''), text: 'Browse all ' + all.length.toLocaleString('en-IN') + ' TV shows →' })]));
  }
  // Movies page: rows under the songs banner: what's on now, by streaming service, by language, by genre, catch-up and
  // classics. Each "See all" opens Browse, a language page, a genre page or a year page; every film is on /browse.
  function drawMovieRows(v) {
    document.title = MOVIES_TITLE;
    v.appendChild(h('div', { class: 'wrapx', style: 'padding-bottom:0' }, [
      h('h1', { class: 'display', style: 'font-size:44px;margin-bottom:6px', text: 'Movies' }),
      h('div', { class: 'sub', text: 'What’s on now, new on each streaming service, the latest in each language, and the best of each genre.' })
    ]));
    if (!S.loaded) { v.appendChild(h('div', { class: 'wrapx' }, [h('div', { class: 'empty', text: S.loadMsg || 'Loading…' })])); return; }
    var all = S.movies.filter(function (m) { return !isTv(m); });
    var td = today(), ago = new Date(); ago.setFullYear(ago.getFullYear() - 1); var yAgo = ago.toISOString().slice(0, 10);
    var out = all.filter(function (m) { var r = m.data.releaseDate || ''; return r && r <= td; });
    var newest = function (a, b) { return (b.data.releaseDate || '').localeCompare(a.data.releaseDate || ''); };
    var pop = popularityOf(out), byPop = function (a, b) { return pop[b.id] - pop[a.id] || newest(a, b); };
    var rows = [];
    var add = function (title, items, opts, href) { if (items.length >= 6) rows.push([title, items, opts, href]); };
    add('In theatres now', pinFirst(all.filter(function (m) { return m.data.section === 'In theatres'; }).sort(newest), rowPins('In theatres')), { book: true, inTheatresList: true }, '/browse/movies-in-theatres');
    add('Coming soon', pinFirst(withDate(all.filter(function (m) { return m.data.section === 'Coming soon'; }), 'Coming soon').sort(function (a, b) { return (a.data.releaseDate || '9999').localeCompare(b.data.releaseDate || '9999'); }), rowPins('Coming soon')), { dateBadge: true, upIcons: true }, '/browse/movies-coming-soon');
    // New on a service: on it in the last 12 months (its OTT date, else its release date).
    var ottDate = function (m) { return m.data.ottReleaseDate || m.data.releaseDate || ''; };
    [['netflix', 'Netflix'], ['prime-video', 'Prime Video'], ['zee5', 'ZEE5'], ['jiohotstar', 'JioHotstar'], ['sonyliv', 'SonyLIV']].forEach(function (o) {
      add('New on ' + o[1], out.filter(function (m) { var t = ottDate(m); return ottOf(m.data) === o[0] && t >= yAgo && t <= td; }).sort(function (a, b) { return ottDate(b).localeCompare(ottDate(a)); }), { ottNew: true }, '/browse?ott=' + o[0]);
    });
    // Latest in each language: released in the last 12 months, busiest languages first.
    var recent = out.filter(function (m) { return (m.data.releaseDate || '') >= yAgo; }), lc = {};
    recent.forEach(function (m) { var l = langOf(m.data); if (/^[A-Za-z]+$/.test(l)) lc[l] = (lc[l] || 0) + 1; });
    Object.keys(lc).filter(function (l) { return l !== 'English' && lc[l] >= 6; }).sort(function (a, b) { return lc[b] - lc[a]; }).slice(0, 6).forEach(function (l) {
      add('Latest ' + l + ' movies', recent.filter(function (m) { return langOf(m.data) === l; }).sort(newest), null, '/' + l.toLowerCase() + '-movies');
    });
    // Genres, most popular first.
    [['Action', 'Action'], ['Comedy', 'Comedy'], ['Thriller', 'Thriller & crime'], ['Romance', 'Romance'], ['Horror', 'Horror'], ['Biopic', 'Biopics'], ['Family', 'Family'], ['Sports', 'Sports'], ['Sci-fi', 'Sci-fi']].forEach(function (g) {
      var inG = g[0] === 'Sports' ? function (m) { return /sport/i.test(m.data.genre || ''); } : function (m) { return genreTags(m.data).indexOf(g[0]) !== -1; };
      add(g[1], out.filter(inG).sort(byPop), null, genreBySlug(genreSlug(g[0])) ? genreUrl(g[0]) : null);
    });
    var ly = String(new Date().getFullYear() - 1), yr = function (a, b) { return function (m) { var y = (m.data.releaseDate || '').slice(0, 4); return y >= a && y <= b; }; };
    add('Catch up on ' + ly + ' releases', out.filter(yr(ly, ly)).sort(byPop), null, '/year/' + ly);
    add('Popular from the 2010s', out.filter(yr('2010', '2019')).sort(byPop), null, null);
    add('’90s classics', out.filter(yr('1990', '1999')).sort(byPop), null, null);
    rows.forEach(function (r) {
      var o = Object.assign({ max: TV_ROW_MAX }, r[2] || {});
      var sec = rowSection(r[0], r[1], o, r[3] ? seeAll(r[3]) : null);
      if (sec) v.appendChild(sec);
    });
    v.appendChild(h('div', { class: 'wrapx', style: 'padding-top:8px' }, [h('a', { class: 'btn', href: '/browse', text: 'Browse all movies and shows →' })]));
  }
  // Page links are real <a href> so crawlers can reach every page; the site's link handler keeps them in-app.
  // Posters per page: about 60, rounded to whole rows of the grid as it is drawn here, so a page never ends on a half-empty row
  // (60 fills rows of 2, 3, 4, 5 and 6; 7 columns get 63, 8 get 64). A resize that changes the column count redraws.
  function gridPer(host, cls, base) {
    cls = cls || 'grid-posters';
    var g = h('div', { class: cls, 'aria-hidden': 'true', style: 'visibility:hidden;height:0;overflow:hidden' }); host.appendChild(g);
    var n = 0; try { n = getComputedStyle(g).gridTemplateColumns.split(' ').filter(function (x) { return x && x !== 'none'; }).length; } catch (e) {}
    host.removeChild(g); n = n || 1; S.gridCols = n; S.gridCls = cls;
    return n * Math.max(1, Math.round((base || 60) / n));
  }
  (function () {
    var t = null;
    window.addEventListener('resize', function () {
      clearTimeout(t); t = setTimeout(function () {
        if (!S.gridCols || ['browse', 'genre', 'year', 'people', 'vids'].indexOf(S.route) === -1) return;
        var vw = $('view-' + S.route), host = vw && vw.querySelector('.' + (S.gridCls || 'grid-posters') + ':not([aria-hidden])'); if (!host) return;
        var n = 0; try { n = getComputedStyle(host).gridTemplateColumns.split(' ').filter(Boolean).length; } catch (e) {}
        if (n && n !== S.gridCols) render(true);
      }, 250);
    });
  })();
  function pagerNav(cur, pages, hrefFor, onPick) {
    var nav = h('nav', { class: 'pager', 'aria-label': 'Pages', style: 'margin-top:26px' });
    function b(n, label, dis) {
      if (dis) return h('span', { class: 'chip off', 'aria-disabled': 'true', text: label });
      return h('a', { class: 'chip', href: hrefFor(n), rel: label ? (n < cur ? 'prev' : 'next') : null, text: label || String(n), 'aria-current': n === cur && !label ? 'page' : null, 'aria-label': label ? null : 'Page ' + n,
        on: onPick ? { click: function (e) { if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; e.preventDefault(); onPick(n); } } : null });
    }
    nav.appendChild(b(cur - 1, '← Prev', cur === 1));
    var want = {}; [1, 2, cur - 1, cur, cur + 1, pages - 1, pages].forEach(function (n) { if (n >= 1 && n <= pages) want[n] = 1; });
    var last = 0; Object.keys(want).map(Number).sort(function (a, c) { return a - c; }).forEach(function (n) { if (n - last > 1) nav.appendChild(h('span', { class: 'gap', text: '…' })); nav.appendChild(b(n)); last = n; });
    nav.appendChild(b(cur + 1, 'Next →', cur === pages));
    return nav;
  }

  // ---------- follow-up on titles that were in What to watch while in theatres and have since left ----------
  // Rate shows the verdict buttons in place; Not seen puts the title (back) on the watchlist. Either way it leaves the row.
  function wtwDone(id) {
    var i = (S.mine.wtw || []).indexOf(id); if (i !== -1) { S.mine.wtw.splice(i, 1); saveMine(null); }
  }
  function verdictButtons(m, after) { return qvButtons(m, after); }
  // Quick verdict buttons on poster cards (home "Seen these?" row, My List): icon only. The word shows on hover,
  // and for a moment after a tap (phones can't hover). Stored values stay a / b / c, so earlier verdicts are unchanged.
  var VTIP = { theatre: { a: 'Watch in theatres', b: 'Wait for OTT', c: 'Skip, not worth it' }, ott: { a: 'Must watch', b: 'Liked it', c: 'Skip' } };
  function qvTip(m, k) { return VTIP[bigScreen(m) ? 'theatre' : 'ott'][k]; }
  function qvButtons(m, after) {
    var my = myVerdict(m.id), big = bigScreen(m), fl = S.qvFlash;
    var flashOn = fl && fl.id === m.id && Date.now() - fl.t < 1500 ? fl.v : '';
    return h('div', { class: 'qv icons' + (big ? ' th' : ''), role: 'group', 'aria-label': 'Your verdict on ' + m.data.title }, vset(m).map(function (x) {
      var tip = qvTip(m, x[0]);
      return h('button', { type: 'button', class: 'qb ' + x[0] + (flashOn === x[0] ? ' flash' : ''), 'data-v': x[0], 'aria-pressed': String(my === x[0]), 'aria-label': tip,
        on: { click: function (e) {
          var btn = e.currentTarget, setting = myVerdict(m.id) !== x[0];
          S.justRated = S.justRated || {}; S.justRated[m.id] = 1;
          S.qvFlash = setting ? { id: m.id, v: x[0], t: Date.now() } : null;
          setVerdict(m.id, x[0]);
          // My List: a title just rated in Seen and Not Rated leaves that section once its verdict has shown.
          if (S.route === 'list') setTimeout(function () { if (S.route === 'list') render(); }, 1700);
          // The home page keeps the same buttons (no redraw): flash the word on this one.
          if (setting && btn && btn.isConnected) { btn.classList.remove('flash'); void btn.offsetWidth; btn.classList.add('flash'); setTimeout(function () { btn.classList.remove('flash'); }, 1700); }
          if (after) after();
        } } }, [icon(vIconName(m, x[0]), 18), h('span', { class: 'qtip', 'aria-hidden': 'true', text: tip })]);
    }));
  }
  // Key under the "Seen these?" row: what each icon means, for the kinds of film in the row.
  function qvLegend(list) {
    var hasTh = list.some(bigScreen), hasOtt = list.some(function (m) { return !bigScreen(m); });
    var items = [];
    if (hasOtt) items.push(['star', 'Must watch', 'a'], ['thumb', 'Liked it', 'b']);
    if (hasTh) items.push(['screen', 'In theatres', 'a'], ['tv', 'Wait for OTT', 'b']);
    items.push(['skip', 'Skip', 'c']);
    return h('span', { class: 'qlegend' }, items.map(function (x) { return h('span', { class: 'ql ' + x[2] }, [icon(x[0], 14), h('span', { text: x[1] })]); }));
  }
  // "Seen, not rated" card on My List: the verdict icons, and a link to take the title back off the seen list.
  function seenRateBox(m) {
    return h('div', { class: 'fu' }, [qvButtons(m), myVerdict(m.id) ? null : h('button', { type: 'button', class: 'linkbtn', style: 'margin-top:6px;font-size:12px', text: 'Haven\u2019t seen it', on: { click: function (e) {
      var card = e.currentTarget.closest('.pc'), grid = card && card.parentNode, after = card && card.nextSibling, sec = card && card.closest('section'), secParent = sec && sec.parentNode, secAfter = sec && sec.nextSibling, secGone = false;
      markSeen(m.id, false);
      if (card) { card.remove(); if (sec && !sec.querySelector('.pc')) { sec.remove(); secGone = true; } }
      toast(m.data.title + ' taken off your seen list', function () {
        markSeen(m.id, true);
        if (secGone && secParent) secParent.insertBefore(sec, secAfter && secAfter.parentNode === secParent ? secAfter : null);
        if (card && grid) { card.classList.add('pcflip'); grid.insertBefore(card, after && after.parentNode === grid ? after : null); }
      });
    } } })]);
  }
  // My Watchlist filter: where you can watch a title now. Titles that fit none (older releases with no streaming
  // details) show under All only.
  function wlKind(m) {
    var d = m.data;
    if (isUpcoming(m)) return 'soon';
    if (d.section === 'In theatres') return 'theatres';
    if (d.section === 'On OTT' || d.platform || safeUrl(d.platformUrl)) return 'ott';
    return '';
  }
  function followUpBox(m) {
    var box = h('div', { class: 'fu' });
    var showRate = function () { box.innerHTML = ''; box.appendChild(verdictButtons(m, function () { wtwDone(m.id); })); };
    if (myVerdict(m.id)) { showRate(); return box; }
    box.appendChild(h('div', { class: 'fu-b' }, [
      h('button', { type: 'button', class: 'btn small primary', text: 'Rate', on: { click: showRate } }),
      h('button', { type: 'button', class: 'btn small', text: 'Not seen', on: { click: function () {
        if (!needUser()) return;
        if (!inList(m.id)) S.mine.watchlist.push(m.id);
        var i = (S.mine.wtw || []).indexOf(m.id); if (i !== -1) S.mine.wtw.splice(i, 1);
        var card = box.closest('.pc'), sec = box.closest('section'); if (card) card.remove(); if (sec && !sec.querySelector('.pc')) sec.remove();
        saveMine('Added back to your watchlist');
      } } })
    ]));
    return box;
  }
  function followUpList() {
    if (!S.uid) return [];
    var jr = S.justRated || {};
    return (S.mine.wtw || []).map(function (id) { return S.byId[id]; }).filter(function (m) {
      return m && m.data.section !== 'In theatres' && m.data.section !== 'Coming soon' && (!myVerdict(m.id) || jr[m.id]);
    });
  }

  // ---------- What to watch this weekend or next week (top of My List) ----------
  // 1) every watchlist title releasing from this Monday to the end of next week; 2) up to 5 picks: released watchlist titles
  // you haven't rated (best score first), then popular In theatres / On OTT titles you haven't rated or listed.
  function weekendPicks(mine) {
    var t = new Date(today() + 'T00:00:00'), dow = (t.getDay() + 6) % 7; // Monday = 0
    var iso = function (d) { return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
    var from = iso(new Date(t.getTime() - dow * 864e5)), to = iso(new Date(t.getTime() + (13 - dow) * 864e5));
    var seen = {}, out = [], jr = S.justRated || {};
    var act = function (m, o) { o = o || {}; if (m.data.section === 'In theatres') o.book = true; else o.stream = true; return o; }; // titles rated this visit stay, showing the verdict just given
    var tagFor = function (m) { var r = m.data.releaseDate || ''; return r > today() ? 'Releases ' + fmtDate(r) : r === today() ? 'Out today' : 'Out ' + fmtDate(r); };
    mine.filter(function (m) { var r = m.data.releaseDate || ''; return r.length === 10 && r >= from && r <= to; })
      .sort(function (a, b) { return a.data.releaseDate.localeCompare(b.data.releaseDate); })
      .forEach(function (m) { seen[m.id] = 1; out.push({ m: m, opts: released(m) ? act(m, { rate: true, tag: tagFor(m) + ' · In your watchlist', tagClass: 'hot' }) : { dateBadge: true, remind: true, book: m.data.section === 'Coming soon' || m.data.section === 'In theatres', tag: tagFor(m) + ' · In your watchlist', tagClass: 'hot' } }); });
    var rank = function (list) { var pop = popularityOf(list); return list.sort(function (a, b) { var sa = score(a.id).pct, sb = score(b.id).pct; return ((sb === null ? -1 : sb) - (sa === null ? -1 : sa)) || (pop[b.id] - pop[a.id]); }); };
    var picks = rank(mine.filter(function (m) { return !seen[m.id] && released(m) && (!myVerdict(m.id) || jr[m.id]); })).slice(0, 5);
    picks.forEach(function (m) { seen[m.id] = 1; out.push({ m: m, opts: act(m, { rate: true, tag: 'From your watchlist' }) }); });
    if (picks.length < 5) {
      var more = rank(S.movies.filter(function (m) {
        return !seen[m.id] && !inList(m.id) && (!myVerdict(m.id) || jr[m.id]) && released(m) && (m.data.section === 'In theatres' || m.data.section === 'On OTT');
      })).slice(0, 5 - picks.length);
      more.forEach(function (m) { out.push({ m: m, opts: act(m, { rate: true, tag: 'Recommended' }) }); });
    }
    return out;
  }

  // ---------- my list & friends ----------
  function drawList() {
    var v = $('view-list'); v.innerHTML = '';
    var w = h('div', { class: 'wrapx' }); v.appendChild(w);
    w.appendChild(h('h1', { class: 'display', style: 'font-size:44px;margin-bottom:18px', text: 'My List' }));
    if (!S.uid) { w.appendChild(h('div', { class: 'empty', text: 'Sign in with Google to keep a list and follow people.' })); return; }
    var mine = S.mine.watchlist.map(function (id) { return S.byId[id]; }).filter(Boolean);
    var fu = followUpList(), fuIds = fu.map(function (m) { return m.id; });
    var wk = weekendPicks(mine).filter(function (x) { return fuIds.indexOf(x.m.id) === -1; });
    // Remember titles shown here while in theatres, so the home page can ask about them once they leave theatres.
    var newIds = wk.filter(function (x) { return x.m.data.section === 'In theatres' && (S.mine.wtw || []).indexOf(x.m.id) === -1 && !myVerdict(x.m.id); }).map(function (x) { return x.m.id; });
    if (newIds.length && S.mineLoaded) { S.mine.wtw = (S.mine.wtw || []).concat(newIds).slice(-60); saveMine(null); }
    if (wk.length) w.appendChild(h('section', { class: 'card' }, [h('h2', { text: 'What to watch this weekend or next week' }),
      h('div', { class: 'note', style: 'margin:-4px 0 14px', text: 'Your watchlist titles releasing this week or next, then up to 5 picks: unwatched titles from your watchlist first, then popular releases you haven’t rated.' }),
      h('div', { class: 'grid-posters' }, wk.map(function (x) { return posterCard(x.m, x.opts); }))]));
    // Titles that were in What to watch while in theatres and have since left: Rate or Not seen.
    if (fu.length) w.appendChild(h('section', { class: 'card' }, [h('h2', { text: 'Seen these? Give your verdict' }),
      h('div', { class: 'note', style: 'margin:-4px 0 14px', text: 'These were in What to watch while in theatres. Seen one? Rate it. Not yet? Keep it on your watchlist.' }),
      h('div', { class: 'grid-posters' }, fu.map(function (m) { return posterCard(m, { followUp: true }); }))]));
    // Released titles first (in the order they were added), then upcoming ones, soonest release first.
    mine = mine.filter(released).concat(mine.filter(function (m) { return !released(m); })
      .sort(function (a, b) { return (a.data.releaseDate || '9999').localeCompare(b.data.releaseDate || '9999'); }));
    var WLF = [['all', 'All'], ['ott', 'OTT'], ['theatres', 'In Theatres'], ['soon', 'Coming Soon']];
    var wlCount = { all: mine.length, ott: 0, theatres: 0, soon: 0 };
    mine.forEach(function (m) { var k = wlKind(m); if (k) wlCount[k]++; });
    var wlf = S.wlFilter && wlCount[S.wlFilter] ? S.wlFilter : 'all';
    var shownWl = wlf === 'all' ? mine : mine.filter(function (m) { return wlKind(m) === wlf; });
    var wlChips = mine.length ? h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter my watchlist', style: 'margin:-2px 0 14px' }, WLF.filter(function (x) { return x[0] === 'all' || wlCount[x[0]]; }).map(function (x) {
      return h('button', { type: 'button', class: 'chip', 'aria-pressed': String(wlf === x[0]), text: x[1] + ' (' + wlCount[x[0]] + ')', on: { click: function () { var y = window.scrollY; S.wlFilter = x[0]; drawList(); window.scrollTo(0, y); } } });
    })) : null;
    w.appendChild(h('section', { class: 'card' }, [h('h2', { text: 'My Watchlist (' + mine.length + ')' }), wlChips,
      mine.length ? h('div', { class: 'grid-posters' }, shownWl.map(function (m) {
        // Watch now for released titles out of theatres with a streaming link; Book tickets for theatre titles (incl. advance booking) with a booking link.
        var th = m.data.section === 'In theatres' || m.data.section === 'Coming soon';
        var o = released(m) ? { stream: !th, book: th, wlVerdict: true } : { dateBadge: true, upRowOnly: true };
        return posterCard(m, o);
      })) : h('div', { class: 'note', text: 'Nothing yet. Tap + on any poster to add it.' })]));
    var rem = (S.mine.reminders || []).map(function (id) { return S.byId[id]; }).filter(Boolean).sort(function (a, b) { return (a.data.releaseDate || '').localeCompare(b.data.releaseDate || ''); });
    w.appendChild(h('section', { class: 'card' }, [h('h2', { text: 'Release reminders (' + rem.length + ')' }),
      rem.length ? h('div', { class: 'grid-posters' }, rem.map(function (m) {
        // The Coming soon icons (Trailer, Remind me or Tickets when booking is open, Not for me), as in My Watchlist.
        return posterCard(m, { dateBadge: true, upRowOnly: true, upRowAll: true });
      })) : h('div', { class: 'note', text: 'Tap Remind me on anything coming soon to get a nudge on release day.' })]));
    // Titles you said you've seen but haven't rated yet (newest first). One you rate shows its verdict for a moment, then
    // leaves the section (it is in Your verdicts below).
    var fl = S.qvFlash, justNow = function (id) { return fl && fl.id === id && Date.now() - fl.t < 1600; };
    var seenNR = (S.mine.seen || []).slice().reverse().map(function (id) { return S.byId[id]; })
      .filter(function (m) { return m && released(m) && (!myVerdict(m.id) || justNow(m.id)) && fuIds.indexOf(m.id) === -1; });
    if (seenNR.length) w.appendChild(h('section', { class: 'card' }, [h('h2', { text: 'Seen and Not Rated (' + seenNR.filter(function (m) { return !myVerdict(m.id); }).length + ')' }),
      h('div', { class: 'note', style: 'margin:-4px 0 14px', text: 'You said you\u2019ve seen these. One tap each to give your verdict.' }),
      h('div', { class: 'grid-posters' }, seenNR.map(function (m) { return posterCard(m, { seenRate: true }); }))]));
    // Your verdicts: most recently rated first (titles rated before rating dates were kept follow, newest release first),
    // with chips to show one verdict.
    var vmap = S.verdicts[S.uid] ? (S.verdicts[S.uid].v || {}) : {}, rAt = S.ratedAt || {};
    var myV = Object.keys(vmap).filter(function (id) { return S.byId[id]; });
    myV.sort(function (a, b) {
      var ta = rAt[a] || '', tb = rAt[b] || '';
      if (ta || tb) return tb.localeCompare(ta);
      return String(S.byId[b].data.releaseDate || '').localeCompare(String(S.byId[a].data.releaseDate || ''));
    });
    var VF = [['all', 'All'], ['a', 'Theatre / Must watch'], ['b', 'OTT / Watch'], ['c', 'Skip']], vCount = { all: myV.length, a: 0, b: 0, c: 0 };
    myV.forEach(function (id) { if (vCount[vmap[id]] != null) vCount[vmap[id]]++; });
    var vf = S.vFilter && vCount[S.vFilter] ? S.vFilter : 'all';
    var shownV = vf === 'all' ? myV : myV.filter(function (id) { return vmap[id] === vf; });
    var vChips = myV.length ? h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter your verdicts', style: 'margin:-2px 0 14px' }, VF.filter(function (x) { return x[0] === 'all' || vCount[x[0]]; }).map(function (x) {
      return h('button', { type: 'button', class: 'chip', 'aria-pressed': String(vf === x[0]), text: x[1] + ' (' + vCount[x[0]] + ')', on: { click: function () { var y = window.scrollY; S.vFilter = x[0]; drawList(); window.scrollTo(0, y); } } });
    })) : null;
    w.appendChild(h('section', { class: 'card' }, [h('h2', { text: 'Your verdicts (' + myV.length + ')' }), vChips,
      myV.length ? h('div', { class: 'grid-posters' }, shownV.map(function (id) { return posterCard(S.byId[id], { myVerdict: true }); }))
        : h('div', { class: 'note', text: 'You haven’t rated anything yet.' })]));

    // People you follow and Find people are hidden until following is ready; set SHOW_PEOPLE to true to bring them back.
    var SHOW_PEOPLE = false;
    if (!SHOW_PEOPLE) return;
    // following
    var fol = S.mine.following;
    var people = h('section', { class: 'card' }, [h('h2', { text: 'People you follow (' + fol.length + ')' }),
      h('div', { class: 'note', text: 'Your Peer Score on a title appears once 3 people you follow have rated it.' })]);
    if (fol.length) people.appendChild(h('div', { class: 'people' }, fol.map(function (u) { return personRow(u); })));
    w.appendChild(people);

    var known = {}; Object.keys(S.verdicts).concat(Object.keys(S.reviews)).forEach(function (u) { if (u !== S.uid && !following(u)) known[u] = 1; });
    var sug = Object.keys(known);
    var findBox = h('section', { class: 'card' }, [h('h2', { text: 'Find people' })]);
    var q = h('input', { class: 'in', id: 'pq', type: 'search', placeholder: 'Search colleagues by name', autocomplete: 'off' });
    q.value = S.peopleQuery;
    var hits = h('div', { class: 'people' });
    function drawHits() {
      hits.innerHTML = '';
      var list = S.peopleHits.filter(function (p) { return !p.isMe; });
      if (S.peopleQuery && !list.length) hits.appendChild(h('div', { class: 'note', text: 'No matches.' }));
      list.forEach(function (p) { hits.appendChild(personRow(p.id)); });
      fillNames();
    }
    q.addEventListener('input', function () { S.peopleQuery = q.value; if (!S.user) return; S.user.search(q.value).then(function (r) { S.peopleHits = r || []; drawHits(); }); });
    q.addEventListener('focus', function () { if (S.user && !q.value) S.user.search('').then(function (r) { S.peopleHits = r || []; drawHits(); }); });
    findBox.appendChild(h('label', { class: 'sr', for: 'pq', text: 'Search people' }));
    findBox.appendChild(q); findBox.appendChild(hits);
    if (sug.length) { findBox.appendChild(h('h3', { text: 'People rating titles here' })); findBox.appendChild(h('div', { class: 'people' }, sug.map(function (u) { return personRow(u); }))); }
    w.appendChild(findBox);
    drawHits();
  }
  function personRow(u) {
    var nV = S.verdicts[u] ? Object.keys(S.verdicts[u].v || {}).length : 0;
    return h('div', { class: 'person' }, [avatarEl(u, 38), h('span', { class: 'nmx' }, [personEl(u), h('div', { class: 'note', text: nV + (nV === 1 ? ' verdict' : ' verdicts') })]),
      h('button', { type: 'button', class: 'btn small', 'aria-pressed': String(following(u)), text: following(u) ? 'Following' : 'Follow', on: { click: function () { toggleFollow(u); } } })]);
  }

  // ---------- search ----------
  var sq = $('sq'), res = $('results');
  function drawResults() {
    var q = sq.value.trim().toLowerCase(); res.innerHTML = '';
    if (!q) { res.hidden = true; return; }
    var hit = S.movies.filter(function (m) { var d = m.data; return [d.title, d.subtitle, d.director, (d.cast || []).map(function (c) { return c.name; }).join(' ')].join(' ').toLowerCase().indexOf(q) !== -1; }).slice(0, 8);
    var idx = allPeopleIndex(), ppl = Object.keys(idx).map(function (k) { return idx[k]; }).filter(function (p) { var st = S.people[p.slug]; return (p.name + ' ' + ((st && st.aka) || []).join(' ')).toLowerCase().indexOf(q) !== -1; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 4);
    res.classList.add('presults');
    if (!hit.length && !ppl.length) {
      var said = sq.value.trim();
      res.appendChild(h('div', { class: 'note', style: 'padding:10px 10px 4px', text: 'No titles or people match.' }));
      res.appendChild(h('button', { type: 'button', class: 'linkbtn fbmiss', text: 'Can\u2019t find it? Tell us and we\u2019ll add it', on: { click: function () { res.hidden = true; openFeedback({ type: 'add', q: said }); } } }));
    }
    if (ppl.length) {
      res.appendChild(h('div', { class: 'lbl', text: 'People' }));
      ppl.forEach(function (p) {
        var ph = personPhotoUrl(p.name);
        res.appendChild(h('a', { href: '/person/' + p.slug, on: { click: function () { sq.value = ''; res.hidden = true; } } }, [
          ph ? h('img', { src: ph, alt: '', style: 'width:40px;height:40px;border-radius:50%;object-fit:cover;object-position:center top;flex:0 0 auto' }) : h('span', { class: 'thumb', style: 'width:40px;height:40px;border-radius:50%;font-weight:700;color:var(--text)', text: initials(p.name) }),
          h('span', {}, [h('div', { style: 'font-weight:600;font-size:14px', text: p.name }), h('div', { class: 'note', text: p.n + (p.n === 1 ? ' title' : ' titles') })])]));
      });
      if (hit.length) res.appendChild(h('div', { class: 'lbl', text: 'Titles' }));
    }
    hit.forEach(function (m) { res.appendChild(h('a', { href: movieUrl(m), on: { click: function () { sq.value = ''; res.hidden = true; } } }, [h('span', { class: 'thumb art', style: art(m, 'poster', 120) }), h('span', {}, [h('div', { style: 'font-weight:600;font-size:14px', text: m.data.title }), h('div', { class: 'note', text: m.data.section + ' · ' + fmtDate(m.data.releaseDate) })])])); });
    res.hidden = false;
  }
  sq.addEventListener('focus', function () { if (S.kickOlder) S.kickOlder(); });
  sq.addEventListener('input', drawResults);
  sq.addEventListener('keydown', function (e) { if (e.key === 'Escape') { sq.value = ''; drawResults(); } if (e.key === 'Enter') { var a = res.querySelector('a'); if (a) { go(a.getAttribute('href')); sq.value = ''; drawResults(); } } });
  document.addEventListener('click', function (e) { if (!e.target.closest('.navr')) res.hidden = true; });

  // ---------- admin ----------
  // The admin screen's markup lives in a <template> and its code in /app/admin.js, so public pages carry neither.
  // Its styles are in /app/admin.css, loaded with it (public pages carry neither).
  var adminCss = null;
  function loadAdminCss() {
    if (adminCss) return adminCss;
    adminCss = new Promise(function (res) {
      var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/app/admin.css';
      l.onload = l.onerror = function () { res(); }; document.head.appendChild(l);
    });
    return adminCss;
  }
  function adminDom() {
    loadAdminCss();
    var t = $('adminTpl'); if (t) { t.parentNode.appendChild(t.content); t.remove(); }
  }
  function loadAdminCode(done) {
    if (window.ReelAdmin) return loadAdminCss().then(done);
    var sc = document.createElement('script'); sc.src = '/app/admin.js';
    sc.onload = function () { loadAdminCss().then(done); }; sc.onerror = function () { S.adminStarted = false; toast('Couldn’t load the admin tools. Reload to retry.'); };
    document.head.appendChild(sc);
  }
  function startAdmin() {
    adminDom();
    if (S.adminApi) { S.adminApi.route(S.adminSub); return; }
    if (S.adminStarted || !S.db) return;
    if (!S.canEdit) { $('editPage').hidden = false; $('titlesPage').hidden = true; $('main').innerHTML = ''; $('main').appendChild(h('div', { class: 'empty', text: 'Admin is for editors. Sign in with an admin account.' })); return; }
    S.adminStarted = true;
    loadAdminCode(function () {
      S.adminApi = window.ReelAdmin({ db: S.db, assets: S.assets, canWrite: true, sub: S.adminSub, go: go });
    });
  }

  // ---------- connect ----------
  parseRoute();
  var timer = setTimeout(function () { if (!S.loaded) { S.loadMsg = 'Can’t reach the catalogue yet. Check your connection.'; render(true); } }, 10000);
  // ---------- catalogue ----------
  // Titles and people come from /catalogue.json, written at each deploy and served from the CDN (no database reads).
  // On top of it we subscribe only to records changed since that file was built, plus a short list of deletions,
  // so admin edits still show up live. If the file can't be loaded we fall back to reading everything from Firestore.
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
  // Coming soon titles with no Now playing set move to In theatres on their release date (same rule in scripts/build.mjs and app/admin.js).
  function outToday(d, today) { return !d.nowPlaying && d.section === 'Coming soon' && /^\d{4}-\d{2}-\d{2}$/.test(d.releaseDate || '') && d.releaseDate <= (today || npToday()); }
  function fixSection(d) {
    if (d.section === 'Releasing this week') { d = clone(d); d.section = 'In theatres'; }
    if (d.nowPlaying) { var s2 = npSection(d); if (s2 !== d.section) { d = clone(d); d.section = s2; } }
    if (outToday(d)) { d = clone(d); d.section = 'In theatres'; }
    return d;
  }
  // Unpublished titles (published === false) are left out of every list, search and page for visitors.
  // Admins can still open their pages as a preview (findMovie looks in S.hidden for them).
  function setMovies(list) {
    S.hidden = {};
    S.movies = list.map(function (m) { return { id: m.id, data: fixSection(m.data) }; })
      .filter(function (m) { if (m.data.published === false) { S.hidden[m.id] = m; return false; } return true; })
      .sort(function (a, b) { return (+a.data.order || 0) - (+b.data.order || 0); });
    S.byId = {}; S.movies.forEach(function (m) { S.byId[m.id] = m; });
    S.hasCat = true; syncLoaded(); render();
  }
  function loadAllFromFirestore(db) {
    if (loadAllFromFirestore.on) return; loadAllFromFirestore.on = 1;
    db.collection('movies').orderBy('order').onSnapshot(function (snap) {
      if (!snap.metadata.fromCache) clearTimeout(timer);
      setMovies(snap.docs.map(function (s) { return { id: s.id, data: s.data() }; }));
    }, function () { clearTimeout(timer); S.hasCat = true; S.partial = false; S.loaded = true; S.loadMsg = 'Lost connection to the catalogue. Reload to retry.'; render(true); });
    db.collection('people').onSnapshot(function (snap) {
      var o = {}; snap.docs.forEach(function (d) { o[d.id] = d.data(); }); S.people = o; if (S.route === 'title' || S.route === 'person' || S.route === 'people') render();
    }, function () {});
  }
  function getJson(u) { return window.fetch(u).then(function (r) { if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); }); }
  // Firebase loads after the page has settled (js/firebase-adapter.js); anything that needs the database waits here for it.
  var dbWait = [];
  function whenDb(fn) { if (S.db) fn(S.db); else dbWait.push(fn); }
  // ...and when the page can't do without it (the catalogue files failed), it starts Firebase now.
  function needDb(fn) { whenDb(fn); if (!S.db && window.__reelStartFirebase) window.__reelStartFirebase(); }
  // Runs fn on the visitor's first tap, key or scroll, or a few seconds after the page has loaded, whichever is first.
  function whenSettled(fn) {
    var done = false, evs = ['pointerdown', 'keydown', 'touchstart', 'scroll', 'wheel'];
    function run() { if (done) return; done = true; evs.forEach(function (ev) { window.removeEventListener(ev, run, true); }); fn(); }
    evs.forEach(function (ev) { window.addEventListener(ev, run, { capture: true, passive: true }); });
    function later() { setTimeout(function () { if (window.requestIdleCallback) requestIdleCallback(run, { timeout: 2000 }); else run(); }, 5000); }
    if (document.readyState === 'complete') later(); else window.addEventListener('load', later);
  }
  // The page's own seed (title pages): the title, the titles in its rows, its people and their verdicts, written by the build.
  function readSeed() {
    var el = document.getElementById('rs-seed'); if (!el) return null;
    try { var x = JSON.parse(el.textContent); return x && Array.isArray(x.movies) && x.movies.length && x.builtAt ? x : null; } catch (e) { return null; }
  }
  // The catalogue comes in two parts: a small core (every section except Older releases, plus people) that the home page
  // needs first, and the much larger Older releases part, fetched right after the home page has drawn (or at once on
  // any other page). Pages built before the split only know the single full file.
  // A title page with a seed draws from it at once and fetches the catalogue once the page has settled.
  // Live changes (admin edits since the file was built) are followed once Firebase is in.
  function loadCatalogue() {
    var split = !!(window.RS_CAT_CORE && window.RS_CAT_OLD && window.fetch), olderP = null;
    function older() { if (!olderP) olderP = getJson(window.RS_CAT_OLD); return olderP; }
    function core() {
      return !window.fetch ? Promise.reject() : split ? getJson(window.RS_CAT_CORE)
        : (window.RS_CAT ? getJson(window.RS_CAT) : window.fetch('/catalogue.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('catalogue ' + r.status); return r.json(); }));
    }
    var base = {}, baseP = {}, dm = {}, dp = {}, goneM = {}, goneP = {}, tomb = { movies: {}, people: {} }, builtAt = null, live = false, seeded = false;
    function dead(kind, id, d) { var t = tomb[kind][id]; return !!t && (!d || !d.updatedAt || t > d.updatedAt); }
    function apply() {
      var out = [];
      Object.keys(base).forEach(function (id) { if (!(id in dm) && !goneM[id] && !dead('movies', id, base[id])) out.push({ id: id, data: base[id] }); });
      Object.keys(dm).forEach(function (id) { if (!dead('movies', id, dm[id])) out.push({ id: id, data: dm[id] }); });
      var ppl = {};
      Object.keys(baseP).forEach(function (id) { if (!goneP[id] && !dead('people', id, baseP[id])) ppl[id] = baseP[id]; });
      Object.keys(dp).forEach(function (id) { if (!dead('people', id, dp[id])) ppl[id] = dp[id]; });
      S.people = ppl; setMovies(out);
    }
    function track(store, gone) {
      return function (snap) {
        snap.docChanges().forEach(function (c) {
          // A record leaves this query only when it is deleted (updatedAt never goes backwards).
          if (c.type === 'removed') { delete store[c.doc.id]; gone[c.doc.id] = 1; }
          else { store[c.doc.id] = c.doc.data(); delete gone[c.doc.id]; }
        });
        apply();
      };
    }
    function attachLive(db) {
      if (live || !builtAt) return; live = true;
      // An hour of overlap covers admins whose clocks run a little behind.
      var since = new Date(Date.parse(builtAt) - 3600 * 1000).toISOString();
      db.collection('movies').where('updatedAt', '>', since).onSnapshot(track(dm, goneM), function () {});
      db.collection('people').where('updatedAt', '>', since).onSnapshot(track(dp, goneP), function () {});
      db.doc('settings/deleted').onSnapshot(function (snap) {
        var d = snap.exists ? snap.data() : {}; tomb = { movies: {}, people: {} };
        ['movies', 'people'].forEach(function (k) { (d[k] || []).forEach(function (x) { if (x && x.id) tomb[k][x.id] = x.at || ''; }); });
        apply();
      }, function () {});
    }
    // A title marked _part (see scripts/build.mjs listData) gets its full record from its own page's seed, once.
    var fullP = {};
    S.loadFull = function (m) {
      if (!m || !m.data || !m.data._part || fullP[m.id] || !window.fetch) return;
      fullP[m.id] = window.fetch(movieUrl(m)).then(function (r) { if (!r.ok) throw new Error('page ' + r.status); return r.text(); }).then(function (html) {
        var mm = html.match(/<script type="application\/json" id="rs-seed"[^>]*>([\s\S]*?)<\/script>/), seed = mm && JSON.parse(mm[1]);
        var full = seed && (seed.movies || []).filter(function (x) { return x && x.id === m.id; })[0];
        if (!full || !full.data) throw new Error('no seed');
        if (!(m.id in dm)) base[m.id] = full.data;
        Object.keys(seed.people || {}).forEach(function (k) { if (!(k in baseP)) baseP[k] = seed.people[k]; });
        apply();
      }).catch(function () {
        // No seed to read: the database has the record (once Firebase is in).
        needDb(function (db) { db.doc('movies/' + m.id).get().then(function (snap) { if (snap.exists && !(m.id in dm)) { base[m.id] = snap.data(); apply(); } }).catch(function () {}); });
      });
    };
    function addOlder() {
      older().then(function (o) {
        (o && o.movies || []).forEach(function (m) { if (!(m.id in base)) base[m.id] = m.data; });
        S.partial = false; apply();
      }).catch(function () {
        getJson(window.RS_CAT || '/catalogue.json').then(function (full) {
          (full && full.movies || []).forEach(function (m) { if (!(m.id in base)) base[m.id] = m.data; });
          S.partial = false; apply();
        }).catch(function () { needDb(loadAllFromFirestore); });
      });
    }
    function gotCore(cat) {
      if (!cat || !Array.isArray(cat.movies) || !cat.builtAt) throw new Error('bad catalogue');
      clearTimeout(timer);
      S.partial = split;
      var wasSeeded = seeded; seeded = false; S.seedOnly = false;
      builtAt = cat.builtAt;
      cat.movies.forEach(function (m) { base[m.id] = m.data; });
      // The seed's people are a subset of the catalogue's; the catalogue's copy wins.
      baseP = Object.assign({}, baseP, cat.people || {});
      apply();
      if (split) {
        S.kickOlder = function () { S.kickOlder = null; addOlder(); };
        // The home page has all it needs in the core part. The rest (older films, ~0.9 MB) is fetched on the first
        // scroll, tap or key press, or when the visitor moves to another page or the search box.
        if (wasSeeded && S.seedKind === 'title') S.kickOlder();
        else if (S.route === 'home') {
          var kick = function () { ['scroll', 'pointerdown', 'keydown', 'touchstart'].forEach(function (ev) { window.removeEventListener(ev, kick, true); }); if (S.kickOlder) S.kickOlder(); };
          ['scroll', 'pointerdown', 'keydown', 'touchstart'].forEach(function (ev) { window.addEventListener(ev, kick, { capture: true, passive: true }); });
        } else if (S.route === 'title' && S.loaded) idleKick();
        else S.kickOlder();
      }
      whenDb(attachLive);
    }
    function fetchCore() { core().then(gotCore).catch(function () { needDb(loadAllFromFirestore); }); }
    var seedEl = document.getElementById('rs-seed'), seedKind = seedEl && seedEl.getAttribute('data-kind');
    var seed = (S.route === 'title' && seedKind !== 'home') || (S.route === 'home' && seedKind === 'home') ? readSeed() : null;
    if (seed && S.route === 'home') {
      // The home page's seed holds its featured titles: the hero draws from it while the catalogue loads (at once).
      seeded = true; builtAt = seed.builtAt; S.partial = true; S.seedOnly = true; S.seedKind = 'home';
      seed.movies.forEach(function (m) { if (m && m.id && m.data) base[m.id] = m.data; });
      if (seed.verdicts && !Object.keys(S.verdicts).length) S.verdicts = seed.verdicts;
      apply();
      // The catalogue waits until the hero picture is in (the page's load event, or 3 s), so the two don't share the line.
      var started = false, go = function () { if (!started) { started = true; fetchCore(); } };
      if (document.readyState === 'complete') go(); else { window.addEventListener('load', go); setTimeout(go, 3000); }
    } else if (seed) {
      seeded = true; builtAt = seed.builtAt; S.partial = true; S.seedOnly = true; S.seedKind = 'title';
      seed.movies.forEach(function (m) { if (m && m.id && m.data) base[m.id] = m.data; });
      baseP = seed.people || {};
      if (seed.verdicts && !Object.keys(S.verdicts).length) S.verdicts = seed.verdicts;
      clearTimeout(timer);
      apply();
      whenDb(attachLive);
      // Moving to another page or the search box needs the whole catalogue now; otherwise it comes once the page has settled.
      S.kickOlder = function () { S.kickOlder = null; fetchCore(); };
      whenSettled(function () { if (S.kickOlder) S.kickOlder(); });
    } else {
      if (split && S.route !== 'home') older();
      fetchCore();
    }
  }

  // Profile picture in the header: opens a small menu with your name, My List and Sign out.
  function setupMeMenu(me) {
    var wrap = $('meWrap'), btn = $('meBtn'), menu = $('meMenu'), av = $('meAvatar'), ini = $('meIni');
    if (!wrap || !btn) return;
    if (me.avatarUrl) { av.src = me.avatarUrl; av.alt = ''; av.hidden = false; ini.hidden = true; }
    else { ini.textContent = initials(me.name || 'You'); ini.hidden = false; av.hidden = true; }
    $('meName').textContent = me.name || 'Signed in';
    btn.setAttribute('aria-label', (me.name || 'Your account') + ' · account menu');
    var out = $('meOut'); if (!window.reelSignOut) out.hidden = true;
    out.addEventListener('click', function () { if (window.reelSignOut) window.reelSignOut(); });
    var close = function () { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
    btn.addEventListener('click', function (e) { e.stopPropagation(); var open = menu.hidden; menu.hidden = !open; btn.setAttribute('aria-expanded', String(open)); if (open) { var f = menu.querySelector('a,button'); if (f) f.focus(); } });
    document.addEventListener('click', function (e) { if (!wrap.contains(e.target)) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !menu.hidden) { close(); btn.focus(); } });
    menu.addEventListener('click', function (e) { if (e.target.tagName === 'A') close(); });
    wrap.hidden = false;
  }
  // The catalogue comes from the CDN and doesn't wait for Firebase.
  loadCatalogue();
  // If the account data never arrives, Tonight still shows picks after a few seconds.
  setTimeout(function () { if (!tnReady()) { S.tnForce = true; render(); } }, 5000);
  var cl = window.claude;
  if (!cl || typeof cl.use !== 'function') { clearTimeout(timer); S.loadMsg = 'Couldn’t start. Check firebase-config.js.'; render(true); return; }
  cl.use('user').then(function (u) {
    S.user = u;
    if (!u) return;
    return u.me().then(function (me) {
      S.uid = me.id; S.canEdit = !!me.canEdit;
      if (S.canEdit) { $('adminLink').hidden = false; $('adminLink').setAttribute('href', '/admin'); }
      setupMeMenu(me);
    });
  }).catch(function () {}).then(function () {
    // Signed out: nothing more to wait for before Tonight picks (signed in waits for the profile and verdicts below).
    S.authDone = true; if (!S.uid && S.loaded) render();
    return cl.use('assets').then(function (a) { S.assets = a; }).catch(function () {});
  }).then(function () { return cl.use('db'); }).then(function (db) {
    // Admins: unpublished titles, which the public catalogue leaves out, so their pages can be previewed.
    if (S.canEdit && db) db.collection('movies').where('published', '==', false).onSnapshot(function (snap) {
      S.hiddenAdmin = {}; snap.docs.forEach(function (x) { S.hiddenAdmin[x.id] = { id: x.id, data: fixSection(x.data()) }; }); render();
    }, function () {});
    S.db = db;
    if (!db) { if (!S.hasCat) { clearTimeout(timer); S.loadMsg = 'Couldn’t connect to the catalogue. Check firebase-config.js.'; render(true); } return; }
    if (S.route === 'admin') startAdmin();
    dbWait.splice(0).forEach(function (fn) { fn(db); });
    db.collection('verdicts').onSnapshot(function (snap) {
      var o = {}; snap.docs.forEach(function (s) { o[s.id] = s.data(); });
      if (S.uid && writing.v && S.verdicts[S.uid]) o[S.uid] = S.verdicts[S.uid];
      S.verdicts = o;
      // After the first load, verdict changes only update scores and buttons on a drawn home page.
      if (S.verdictsIn && S.route === 'home' && S.lastDrawn === 'home:' && S.loaded) patchVerdicts(); else if (!(S.verdictsIn && S.loaded && patchTitleBits())) render();
      S.verdictsIn = true;
    }, function () {});
    db.doc('settings/home').onSnapshot(function (snap) {
      var d = snap.exists ? snap.data() : {};
      S.featured = Array.isArray(d.featured) ? d.featured.filter(function (x) { return typeof x === 'string'; }) : [];
      S.slide = 0; render();
    }, function () {});
    db.doc('settings/moviesbanner').onSnapshot(function (snap) {
      var d = snap.exists ? snap.data() : {}, was = JSON.stringify(S.movFeatured || []);
      S.movFeatured = Array.isArray(d.featured) ? d.featured.filter(function (x) { return typeof x === 'string'; }) : [];
      var wi = JSON.stringify(S.movImages || {}); S.movImages = d.images && typeof d.images === 'object' ? d.images : {};
      if (wi !== JSON.stringify(S.movImages) && S.route === 'movies' && !S.play) drawHero();
      if (was !== JSON.stringify(S.movFeatured) && S.route === 'movies') { if (S.play) leaveHero(); S.slide = 0; render(); }
    }, function () {});
    db.doc('settings/tvbanner').onSnapshot(function (snap) {
      var d = snap.exists ? snap.data() : {}, was = JSON.stringify(S.tvFeatured || []);
      S.tvFeatured = Array.isArray(d.featured) ? d.featured.filter(function (x) { return typeof x === 'string'; }) : [];
      var wt = JSON.stringify(S.tvImages || {}); S.tvImages = d.images && typeof d.images === 'object' ? d.images : {};
      if (wt !== JSON.stringify(S.tvImages) && S.route === 'tvshows' && !S.play) drawHero();
      if (was !== JSON.stringify(S.tvFeatured) && S.route === 'tvshows') { if (S.play) leaveHero(); S.slide = 0; render(); }
    }, function () {});
    db.doc('settings/buttons').onSnapshot(function (snap) {
      var d = snap.exists ? snap.data() : {}, next = {};
      ['home', 'browse', 'lang', 'mylist', 'title'].forEach(function (k) { var x = d[k] || {}; next[k] = { book: x.book !== false, watch: x.watch !== false }; });
      var was = JSON.stringify(S.buttons || null); S.buttons = next;
      if (was !== JSON.stringify(next) && /^(home|browse|movies|tvshows|list|title)$/.test(S.route)) render();
    }, function () {});
    db.doc('settings/rows').onSnapshot(function (snap) {
      var d = snap.exists ? snap.data() : {}, ids = function (a) { return Array.isArray(a) ? a.filter(function (x) { return typeof x === 'string'; }) : []; };
      var next = {}, prev = S.rowPins || window.RS_ROWS || {}, was = {};
      ROW_KEYS.forEach(function (k) { next[k] = ids(d[k]); was[k] = ids(prev[k]); });
      S.rowPins = next;
      if (JSON.stringify(next) !== JSON.stringify(was) && /^(home|browse|movies|title|vids)$/.test(S.route)) render();
    }, function () {});
    db.doc('settings/popular').onSnapshot(function (snap) {
      var d = snap.exists ? snap.data() : {};
      S.popOrder = Array.isArray(d.order) ? d.order.filter(function (x) { return typeof x === 'string'; }) : [];
      if (S.route === 'people') render();
    }, function () {});
    db.collection('reviews').onSnapshot(function (snap) {
      var o = {}; snap.docs.forEach(function (s) { o[s.id] = s.data(); });
      if (S.uid && writing.r && S.reviews[S.uid]) o[S.uid] = S.reviews[S.uid];
      S.reviews = o; S.reviewsIn = true; render();
    }, function () {});
    if (S.uid) db.doc('data/users/' + S.uid + '/profile').onSnapshot(function (snap) {
      if (writing.m) return;
      var d = snap.exists ? snap.data() : {};
      if (d.ratedAt && typeof d.ratedAt === 'object') S.ratedAt = Object.assign({}, d.ratedAt, S.ratedAt || {});
      var key = function (o) { return JSON.stringify([o.watchlist || [], o.following || [], o.reminders || [], o.wtw || [], o.nope || [], o.seen || []]); };
      // Our own save coming back unchanged: nothing to redraw (a full home redraw here caused a second flicker).
      if (S.mineLoaded && key(d) === key(S.mine) && (!Array.isArray(d.apps) || JSON.stringify(d.apps) === JSON.stringify(S.mine.apps || []))) return;
      var pending = !S.mineLoaded && S.minePending ? S.mine : null;
      S.mine = mergeMine(d, pending || {});
      S.mineSynced = mergeMine(d, {}); if (Array.isArray(d.apps)) S.mineSynced.apps = d.apps.slice();
      if (Array.isArray(d.apps)) S.mine.apps = d.apps.slice(); else { var la = myApps(); if (la.length) { S.mine.apps = la; } }
      S.mineLoaded = true; S.minePending = false; render();
      if (pending) saveMine(null);
      checkMineBackup();
    }, function () { if (S.minePending) toast('Couldn’t load your list, so your last change wasn’t saved. Reload to try again.'); });
  }).catch(function () { clearTimeout(timer); S.loadMsg = 'The catalogue is unavailable in this view.'; render(true); });
})();
