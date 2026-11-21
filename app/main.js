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
    featured: [], popOrder: [], people: {}, movies: [], byId: {}, verdicts: {}, reviews: {}, mine: { watchlist: [], following: [], reminders: [] }, mineLoaded: false,
    route: 'home', param: null, slide: 0, rtab: 'all', reviewDraft: {}, spoilerShown: {}, peopleQuery: '', peopleHits: [],
    browse: { status: 'All', lang: '', genre: '', year: '', sort: 'new', page: 1 }, ppl: { q: '', role: 'Popular', lang: '', sort: 'popular', page: 1 }, gen: { genre: '', lang: '', page: 1 }, yr: { year: '', lang: '', page: 1 }, loaded: false, pending: false, adminStarted: false, planPick: {}
  };
  try { S.navLang = localStorage.getItem('rs_lang') || ''; } catch (e) { S.navLang = ''; }
  function inNavLang(m) { return !S.navLang || langsOf(m.data).indexOf(S.navLang) !== -1; }
  function langsOf(d) { return (d.languages || '').split(/[,;/]| dubbed in | and /i).map(function (x) { return x.trim(); }).filter(Boolean); }
  function fillNavLang() {
    var sel = $('navLang'); if (!sel) return;
    var n = {}; S.movies.forEach(function (m) { langsOf(m.data).forEach(function (l) { n[l] = (n[l] || 0) + 1; }); });
    var langs = Object.keys(n).sort();
    if (S.navLang && !n[S.navLang]) langs.push(S.navLang);
    var want = [''].concat(langs).join('|');
    if (sel.getAttribute('data-k') !== want) {
      sel.innerHTML = '';
      sel.appendChild(h('option', { value: '', text: 'All languages' }));
      langs.forEach(function (l) { sel.appendChild(h('option', { value: l, text: l })); });
      sel.setAttribute('data-k', want);
    }
    sel.value = S.navLang; sel.classList.toggle('on', !!S.navLang);
  }
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
  function toast(t) { var el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(function () { el.hidden = true; }, 2600); }
  function safeUrl(u) { return (typeof u === 'string' && (/^\/_blob\//.test(u) || /^https:\/\//.test(u))) ? u : ''; }
  function hash(s) { var x = 0; for (var i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) >>> 0; return x; }
  // Cloudinary serves the uploaded original unless the URL asks for a size. Ask for a modern format, automatic quality and
  // at most the width the slot needs (2x for sharp screens); never upscale. Other hosts are left alone.
  function cld(u, w) {
    var m = typeof u === 'string' && u.match(/^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.*)$/);
    if (!m || /^[a-z]{1,3}_[^/]*\//.test(m[2])) return u;
    return m[1] + 'f_auto,q_auto,c_limit,w_' + (w || 800) + '/' + m[2];
  }
  function artUrl(m, kind, w) {
    var url = safeUrl(kind === 'banner' ? (m.data.bannerUrl || '') : (m.data.posterUrl || ''));
    return url ? cld(url, w || (kind === 'banner' ? 1280 : 400)) : '';
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
  function isOld(m) { return m.data.section === 'Older releases'; }
  function statusLabel(m) {
    var d = m.data, rel = released(m);
    if (isTv(m)) return 'TV show' + (tvYears(d) ? ' · ' + tvYears(d) : '') + (d.platform ? ' · on ' + d.platform : '');
    if (isOtt(m)) return (rel ? 'Now on ' : 'On ') + (d.platform || 'OTT') + (rel ? '' : ' ' + fmtDate(d.releaseDate));
    if (isOld(m)) return 'Released ' + fmtDate(d.releaseDate, true) + (d.platform ? ' · on ' + d.platform : '');
    return rel ? 'In theatres' : 'Releases ' + fmtDate(d.releaseDate);
  }
  function vset(m) { return isOtt(m) || isTv(m) ? VERD.ott : VERD.theatre; }
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
    if (!needUser() || writing.v) return;
    var cur = clone(S.verdicts[S.uid] || { v: {} }); cur.v = cur.v || {};
    if (cur.v[mid] === val) delete cur.v[mid]; else cur.v[mid] = val;
    cur.at = new Date().toISOString();
    S.verdicts[S.uid] = cur; render();
    writing.v = true;
    guard(S.db.doc('verdicts/' + S.uid).set(cur)).then(function () { writing.v = false; });
  }
  function saveReview(mid, text, spoiler) {
    if (!needUser() || writing.r) return;
    var cur = clone(S.reviews[S.uid] || { items: {} }); cur.items = cur.items || {};
    if (text) cur.items[mid] = { text: text.slice(0, 2000), spoiler: !!spoiler, at: new Date().toISOString() };
    else delete cur.items[mid];
    S.reviews[S.uid] = cur; S.reviewDraft[mid] = undefined; render();
    writing.r = true;
    guard(S.db.doc('reviews/' + S.uid).set(cur), text ? 'Review posted' : 'Review removed').then(function () { writing.r = false; });
  }
  function saveMine(msg) {
    if (!needUser()) return;
    if (writing.m) { writing.mAgain = msg || true; return; }
    writing.m = true;
    guard(S.db.doc('data/users/' + S.uid + '/profile').set(clone(S.mine)), msg).then(function () {
      writing.m = false; if (writing.mAgain) { var again = writing.mAgain; writing.mAgain = null; saveMine(again === true ? null : again); }
    });
  }
  function hasReminder(id) { return (S.mine.reminders || []).indexOf(id) !== -1; }
  function toggleRemind(id) {
    if (!needUser()) return;
    S.mine.reminders = S.mine.reminders || [];
    var i = S.mine.reminders.indexOf(id);
    if (i === -1) S.mine.reminders.push(id); else S.mine.reminders.splice(i, 1);
    render(); saveMine(i === -1 ? 'We’ll remind you on release day' : 'Reminder removed');
  }
  function toggleList(id) {
    if (!needUser()) return;
    var i = S.mine.watchlist.indexOf(id);
    if (i === -1) S.mine.watchlist.push(id); else S.mine.watchlist.splice(i, 1);
    render(); saveMine(i === -1 ? 'Added to your list' : 'Removed from your list');
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
    if (dupTitles.list !== S.movies) { dupTitles = { list: S.movies, map: {} }; S.movies.forEach(function (x) { var k = titleKey(x); dupTitles.map[k] = (dupTitles.map[k] || 0) + 1; }); }
    var d = m.data, parts = [isTv(m) ? (tvYears(d) ? 'TV series ' + tvYears(d) : 'TV series') : (d.releaseDate || '').slice(0, 4)];
    if (dupTitles.map[titleKey(m)] > 1 && langOf(d)) parts.push(langOf(d));
    parts = parts.filter(Boolean);
    var base = d.title + (parts.length ? ' (' + parts.join(', ') + ')' : ''), full = base + ' – Verdicts & Reviews | Reelscore';
    return full.length <= 60 ? full : base + ' | Reelscore';
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
  function browseHref(o, page) {
    var q = [];
    if (o.lang) q.push('lang=' + encodeURIComponent(o.lang));
    if (o.genre) q.push('genre=' + encodeURIComponent(o.genre));
    if (o.year) q.push('year=' + o.year);
    if (page > 1) q.push('page=' + page);
    var sec = sectionSlug(o.status);
    return '/browse' + (sec ? '/' + sec : '') + (q.length ? '?' + q.join('&') : '');
  }
  // Filtered lists point search engines at the plain list; plain pages 2+ keep their own URL.
  function listCanonical() {
    var page = qPage(), qs = new URLSearchParams(location.search);
    var filtered = qs.get('lang') || qs.get('genre') || qs.get('year');
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
    return null;
  }
  // Hub page titles, the same as the pre-rendered hub pages (scripts/build.mjs HUBS).
  var BROWSE_TITLES = { All: 'Browse Indian Movies & Series | Reelscore', 'In theatres': 'Indian Movies in Theatres Now | Reelscore', 'Coming soon': 'Upcoming Indian Movies | Reelscore',
    'On OTT': 'Indian Movies on OTT | Reelscore', 'Older releases': 'Older Indian Movies | Reelscore', 'TV shows': 'Indian TV Shows & Series | Reelscore' };
  var PEOPLE_TITLE = 'Indian Actors & Filmmakers | Reelscore';
  var BROWSE_SECTIONS = { 'in-theatres': 'In theatres', 'coming-soon': 'Coming soon', 'on-ott': 'On OTT', 'older-releases': 'Older releases', 'tv-shows': 'TV shows' };
  function legacyHashToPath(hsh) {
    if (/^t-[A-Za-z0-9-]+$/.test(hsh)) return '/movie/' + hsh.slice(2);
    if (hsh === 'list') return '/my-list';
    if (hsh === 'browse') return '/browse';
    if (hsh === 'browse-older') return '/browse/older-releases';
    if (hsh === 'browse-ott') return '/browse/on-ott';
    if (hsh === 'admin') return '/admin';
    if (hsh === 'home') return '/';
    return null;
  }
  function parseRoute() {
    var hsh = (location.hash || '').replace(/^#/, '');
    var legacy = hsh && legacyHashToPath(hsh);
    if (legacy) history.replaceState(null, '', legacy);
    var path = decodeURIComponent(location.pathname).replace(/\/+$/, '') || '/';
    var mm;
    if ((mm = path.match(/^\/(?:movie|tv)\/([a-z0-9-]+)$/i))) { S.route = 'title'; S.param = mm[1].toLowerCase(); }
    else if ((mm = path.match(/^\/person\/([a-z0-9-]+)$/i))) { S.route = 'person'; S.param = mm[1].toLowerCase(); }
    else if (path === '/my-list') { S.route = 'list'; S.param = null; }
    else if (path === '/trailers' || path === '/songs' || path === '/tv-promos') { S.route = 'vids'; S.param = path.slice(1); S.vids = { lang: '', n: 48 }; }
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
    else if ((mm = path.match(/^\/browse(?:\/([a-z-]+))?$/))) {
      S.route = 'browse'; S.param = null; S.browse.status = (mm[1] && BROWSE_SECTIONS[mm[1]]) || 'All';
      var qs = new URLSearchParams(location.search);
      S.browse.lang = qs.get('lang') || ''; S.browse.genre = qs.get('genre') || ''; S.browse.year = /^\d{4}$/.test(qs.get('year') || '') ? qs.get('year') : ''; S.browse.page = qPage();
    }
    else if ((mm = path.match(/^\/admin(\/.*)?$/))) { S.route = 'admin'; S.param = null; S.adminSub = (mm[1] || '').toLowerCase(); }
    else if (path === '/about') { S.route = 'about'; S.param = null; }
    else if (window.RS_404 && path !== '/') { S.route = 'notfound'; S.param = path; }
    else { S.route = 'home'; S.param = null; if (path !== '/') history.replaceState(null, '', '/'); }
    if (S.route !== 'home' && S.play) { try { S.heroVideo && S.heroVideo.pause(); } catch (e) {} S.play = null; S.heroNode = null; S.heroVideo = null; }
    document.body.className = 'r-' + S.route;
    document.querySelectorAll('.nav a.lnk').forEach(function (a) { a.setAttribute('aria-current', a.getAttribute('data-r') === S.route ? 'page' : 'false'); });
    if (S.route === 'browse') document.title = BROWSE_TITLES[S.browse.status] || BROWSE_TITLES.All;
    else if (S.route === 'people') document.title = PEOPLE_TITLE;
    else if (S.route === 'genre') document.title = genreTitle(genreBySlug(S.param));
    else if (S.route === 'year') document.title = yearTitle(S.param);
    else if (S.route === 'vids') document.title = VID_PAGES[S.param].t;
    else if (S.route === 'notfound') document.title = 'Page not found | Reelscore';
    else if (S.route === 'about') document.title = 'About Reelscore & How Scores Work';
    else if (S.route !== 'title' && S.route !== 'person') document.title = 'Reelscore — Reviews for Indian movies and series';
    if (S.route === 'admin') startAdmin();
    S.restoreHome = S.route === 'home' && S.prevRoute === 'title' && !!S.homeSpot;
    S.prevRoute = S.route;
    S.lastPath = location.pathname;
    if (S.route === 'notfound') setNoindex(true);
    else if (S.route !== 'title' && S.route !== 'person') setNoindex(false);
    if (S.route === 'list' || S.route === 'admin') setCanonical(null);
    else if (S.route === 'browse' || S.route === 'people' || S.route === 'genre' || S.route === 'year') setCanonical(listCanonical());
    else if (S.route === 'notfound') setCanonical(null);
    else if (S.route !== 'title' && S.route !== 'person') setCanonical(location.pathname);
    S.rtab = 'all';
    render(true);
    window.scrollTo(0, 0);
  }
  function go(href) {
    if (href === location.pathname + location.search) { window.scrollTo(0, 0); return; }
    if (S.adminApi && S.route === 'admin' && !S.adminApi.canLeave(href)) return;
    history.pushState(null, '', href); parseRoute();
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
    raf = requestAnimationFrame(function () { raf = null; S.pending = false; fillNavLang(); draw(); fillNames(); });
  }
  function setNavLang(v) {
    S.navLang = v || '';
    try { if (S.navLang) localStorage.setItem('rs_lang', S.navLang); else localStorage.removeItem('rs_lang'); } catch (e) {}
    S.lastDrawn = null; render(true);
  }
  (function () { var sel = $('navLang'); if (sel) sel.addEventListener('change', function () { setNavLang(sel.value); }); })();
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
  function syncLoaded() { S.loaded = !!S.hasCat && (!S.partial || S.route === 'home'); if (S.partial && S.route !== 'home' && S.kickOlder) S.kickOlder(); }
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
    else if (S.route === 'browse') drawBrowse();
    else if (S.route === 'person') drawPerson();
    else if (S.route === 'people') drawPeople();
    else if (S.route === 'genre') drawGenre();
    else if (S.route === 'year') drawYear();
    else if (S.route === 'vids') drawVids();
    else if (S.route === 'notfound') drawNotFound();
    else if (S.route === 'about') drawAbout();
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
  function posterCard(m, opts) {
    opts = opts || {};
    var d = m.data, sc = score(m.id), img = !!safeUrl(d.posterUrl);
    var top;
    if (opts.dateBadge && d.releaseDate) {
      var p = d.releaseDate.split('-');
      top = h('span', { class: 'datebadge' }, [h('b', { text: String(+p[2]) }), h('small', { text: MONTHS[+p[1] - 1].toUpperCase() })]);
    } else {
      top = h('span', { class: 'badge' }, [h('i'), sc.pct === null ? (released(m) ? 'New' : fmtDate(d.releaseDate)) : sc.pct + '%']);
    }
    var meta = isTv(m) ? [d.platform || 'TV', tvYears(d)].filter(Boolean).join(' · ') : isOtt(m) ? (d.platform || 'OTT') + ' · ' + fmtDate(d.releaseDate) : (d.languages || '').split(/[,;]/)[0] + ' · ' + (d.genre || fmtDate(d.releaseDate));
    var on = inList(m.id), pa = artLazy(m, 'poster');
    var kids = [
      h('div', { class: 'pw' }, [
        h('a', { class: 'pa art', href: movieUrl(m), style: pa.style, 'data-bg': pa.bg, 'aria-label': d.title }, [
          h('span', { class: 'pfade' }), h('span', { class: 'ptitle', 'aria-hidden': 'true', text: d.title }), top,
          isOtt(m) && d.platform ? h('span', { class: 'plat', text: d.platform }) : null
        ]),
        h('button', { type: 'button', class: 'addl', 'aria-pressed': String(on),
          'aria-label': on ? 'Remove ' + d.title + ' from my list' : 'Add ' + d.title + ' to my list',
          title: on ? 'In my list' : 'Add to my list', text: on ? '✓' : '+',
          on: { click: function (e) { e.preventDefault(); e.stopPropagation(); toggleList(m.id); } } })
      ]),
      h('a', { class: 'nm', href: movieUrl(m), text: d.title, tabindex: '-1' }),
      h('span', { class: 'mt', text: meta, title: meta })
    ];
    if (opts.rate) {
      var my = myVerdict(m.id);
      kids.push(h('div', { class: 'qv', role: 'group', 'aria-label': 'Your verdict on ' + d.title }, vset(m).map(function (x) {
        return h('button', { type: 'button', class: 'qb ' + x[0], 'aria-pressed': String(my === x[0]), title: x[2], text: x[1],
          on: { click: function () { S.justRated = S.justRated || {}; S.justRated[m.id] = 1; setVerdict(m.id, x[0]); } } });
      })));
    }
    if (opts.remind) kids.push(h('button', { type: 'button', class: 'btn small', 'aria-pressed': String(hasReminder(m.id)),
      style: hasReminder(m.id) ? 'background:var(--accent);border-color:var(--accent);color:#0B0A0F' : '',
      text: hasReminder(m.id) ? '🔔 Reminder set' : 'Remind me', on: { click: function () { toggleRemind(m.id); } } }));
    return h('div', { class: 'pc' + (img ? ' img' : '') }, kids);
  }
  function rowSection(title, items, opts, link) {
    if (!items.length) return null;
    return h('section', { class: 'sect', 'aria-label': title }, [
      h('div', { class: 'sect-h' }, [h('h2', { text: title }), link || null]),
      h('div', { class: 'rowx' }, items.map(function (m) { return posterCard(m, opts); }))
    ]);
  }
  function sectionOf(name) { return S.movies.filter(function (m) { return m.data.section === name; }); }
  function homeSection(name) { return sectionOf(name).filter(inNavLang); }
  function firstVideo(m) { return (m.data.videos || []).filter(function (v) { return safeUrl(v.url); })[0]; }
  function trailerBtn(m, cls) {
    var v = firstVideo(m);
    return h('button', { type: 'button', class: 'btn lg glass', disabled: true, title: 'Add a YouTube link in Admin' }, ['▶  Trailer coming soon']);
  }
  function listBtn(m) {
    var on = inList(m.id);
    return h('button', { type: 'button', class: 'btn lg glass', 'aria-pressed': String(on), on: { click: function () { toggleList(m.id); } } }, [on ? '✓  In my list' : '+  Watchlist']);
  }

  // ---------- home ----------
  function drawHome() {
    var v = $('view-home');
    if (!S.loaded && v.querySelector('[data-prerendered]')) return;
    v.innerHTML = '';
    if (!S.loaded) { v.appendChild(h('div', { class: 'wrapx' }, [h('div', { class: 'empty', text: S.loadMsg || 'Loading titles…' })])); return; }
    if (!S.movies.length) { v.appendChild(h('div', { class: 'wrapx' }, [h('div', { class: 'empty', text: 'No titles yet. Add some in Admin.' })])); return; }
    var all = S.featured.map(function (id) { return S.byId[id]; }).filter(Boolean), feat = all.filter(inNavLang);
    if (!feat.length) {
      feat = S.movies.filter(function (m) { return inNavLang(m) && safeUrl(m.data.bannerUrl); });
      homeSection('In theatres').forEach(function (m) { if (feat.length < 4 && feat.indexOf(m) === -1) feat.push(m); });
      if (!feat.length) feat = S.movies.filter(inNavLang).slice(0, 3);
      if (!feat.length) feat = all.length ? all : S.movies.slice(0, 3);
    }
    if (S.slide >= feat.length) S.slide = 0;
    S.feat = feat;
    var heroBox = h('div', { id: 'heroBox' });
    v.appendChild(heroBox);
    drawHero();

    var friendPicks = S.movies.filter(function (x) { return inNavLang(x) && S.mine.following.length && score(x.id, S.mine.following).tot > 0; });
    var mine = S.movies.filter(function (x) { return inNavLang(x) && inList(x.id); });
    var langNote = S.navLang ? h('div', { class: 'sect-h', style: 'margin-top:18px' }, [h('span', { class: 'sub' }, ['Showing ' + S.navLang + ' titles · ', h('a', { href: '#', on: { click: function (e) { e.preventDefault(); setNavLang(''); } }, text: 'Show all languages' })])]) : null;
    var none = S.navLang && !S.movies.some(inNavLang) ? h('div', { class: 'wrapx' }, [h('div', { class: 'empty', text: 'No ' + S.navLang + ' titles yet.' })]) : null;
    [langNote, none,
      mine.length ? rowSection('My List', mine, null, h('span', { class: 'sub' }, [h('a', { href: '/my-list', text: 'See all' })])) : null,
      trailerSection(),
      rowSection('In theatres', homeSection('In theatres').slice().sort(function (a, b) {
        var ra = released(a), rb = released(b);
        if (ra !== rb) return ra ? -1 : 1;
        return ra ? (b.data.releaseDate || '').localeCompare(a.data.releaseDate || '') : (a.data.releaseDate || '').localeCompare(b.data.releaseDate || '');
      }), null, h('span', { class: 'sub', text: 'Now showing, plus this week’s releases' })),
      rateSection(),
      friendPicks.length ? rowSection('Rated by people you follow', friendPicks) : null,
      rowSection('Coming soon', homeSection('Coming soon'), { dateBadge: true, remind: true }),
      songSection(),
      genreSection(),
      rowSection('New on OTT', homeSection('On OTT')),
      rowSection('TV shows', homeSection('TV shows')),
      tvPromoSection(),
      yearSection(),
      rowSection('Catch up on 2025–26 releases', homeSection('Older releases').filter(function (m) { return (m.data.releaseDate || '') >= '2025'; }).sort(function (a, b) { return (b.data.releaseDate || '').localeCompare(a.data.releaseDate || ''); }).slice(0, 30), null, h('span', { class: 'sub' }, [h('a', { href: '/browse/older-releases', text: 'Browse all' })]))
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
    var all = S.movies.filter(function (m) { return inNavLang(m) && genreTags(m.data).indexOf(g) !== -1; });
    v.appendChild(h('section', { class: 'ghero', style: '--g1:' + c[0] + ';--g2:' + c[1] }, [
      h('nav', { class: 'gcrumbs', 'aria-label': 'Breadcrumb' }, [h('a', { href: '/', text: 'Home' }), ' › ', h('a', { href: '/browse', text: 'Browse' }), ' › ', g]),
      h('h1', { class: 'display', text: g }),
      h('p', { text: S.loaded ? all.length.toLocaleString('en-IN') + ' ' + (S.navLang ? S.navLang + ' ' : '') + g.toLowerCase() + ' movies and series on Reelscore, with verdicts on whether each is worth the theatre, OTT or a skip.' : 'Loading…' })
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
    var PER = 60, pages = Math.ceil(list.length / PER); G.page = Math.min(Math.max(1, G.page || 1), pages);
    syncListUrl(genreHref(G, G.page));
    var from = (G.page - 1) * PER;
    w.appendChild(h('div', { class: 'sub', style: 'margin-bottom:14px', text: list.length > PER ? 'Showing ' + (from + 1) + '–' + Math.min(from + PER, list.length) + ' of ' + list.length.toLocaleString('en-IN') + ' titles' : list.length + (list.length === 1 ? ' title' : ' titles') }));
    w.appendChild(h('div', { class: 'grid-posters' }, list.slice(from, from + PER).map(function (m) { return posterCard(m, m.data.section === 'Coming soon' ? { dateBadge: true, remind: true } : null); })));
    if (pages > 1) w.appendChild(pagerNav(G.page, pages, function (n) { return genreHref(G, n); }));
    v.appendChild(footer());
  }

  // Full-screen trailer player over the current page; Esc, the close button or a click outside the video closes it.
  function openTrailerOverlay(m, x, opener) {
    closeTrailerOverlay();
    var d = m.data, media;
    if (x.yt) media = h('iframe', { src: 'https://www.youtube-nocookie.com/embed/' + x.yt + '?autoplay=1&rel=0&playsinline=1&modestbranding=1', title: d.title + ' · ' + x.title,
      allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin' });
    else { media = h('video', { src: x.clip, controls: true, autoplay: true, playsinline: true }); media.setAttribute('aria-label', d.title + ' · ' + x.title); setTimeout(function () { safePlay(media); }, 0); }
    var close = h('button', { type: 'button', class: 'tov-x', 'aria-label': 'Close video', text: '×', on: { click: closeTrailerOverlay } });
    var box = h('div', { class: 'tov', role: 'dialog', 'aria-modal': 'true', 'aria-label': d.title + ' · ' + x.title }, [
      h('div', { class: 'tov-bar' }, [h('div', { class: 'tov-t' }, [h('b', { text: d.title }), h('span', { class: 'note', text: ' · ' + x.title })]), close]),
      h('div', { class: 'tov-v' }, [media])
    ]);
    box.addEventListener('click', function (e) { if (e.target === box) closeTrailerOverlay(); });
    S.tov = { node: box, opener: opener, key: function (e) { if (e.key === 'Escape') closeTrailerOverlay(); } };
    document.addEventListener('keydown', S.tov.key);
    document.body.appendChild(box); document.body.classList.add('tov-open');
    close.focus();
  }
  function closeTrailerOverlay() {
    if (!S.tov) return;
    var t = S.tov; S.tov = null;
    document.removeEventListener('keydown', t.key);
    if (document.fullscreenElement) { try { document.exitFullscreen(); } catch (e) {} }
    if (t.node.parentNode) t.node.parentNode.removeChild(t.node);
    document.body.classList.remove('tov-open');
    if (t.opener && t.opener.isConnected) t.opener.focus({ preventScroll: true });
  }

  // ---------- Give your verdict row: recent and popular titles you haven't rated yet, one tap to rate ----------
  function rateSection() {
    var today = new Date().toISOString().slice(0, 10), cut = new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10);
    var done = S.justRated || {};
    var list = S.movies.filter(function (m) {
      var d = m.data, r = d.releaseDate || '';
      if (!inNavLang(m) || !released(m) || d.section === 'Coming soon') return false;
      if (myVerdict(m.id) && !done[m.id]) return false;
      return d.section === 'In theatres' || d.section === 'On OTT' || (isTv(m) ? !d.endYear || String(d.endYear) >= today.slice(0, 4) : r.length === 10 && r >= cut && r <= today);
    });
    var pop = popularityOf(list);
    list.sort(function (a, b) { return pop[b.id] - pop[a.id] || (b.data.releaseDate || '').localeCompare(a.data.releaseDate || ''); });
    list = list.slice(0, 15);
    var n = Object.keys(done).filter(function (id) { return myVerdict(id); }).length;
    return rowSection('Seen these? Give your verdict', list, { rate: true }, h('span', { class: 'sub', text: n ? 'Thanks — ' + n + ' verdict' + (n === 1 ? '' : 's') + ' added. Every one counts toward the score.' : 'One tap each. Your verdict counts toward the score.' }));
  }

  // ---------- New trailers row: latest titles with a playable trailer; a card opens the title and plays it ----------
  function trailerPicks(all) {
    var cut = new Date(Date.now() - 180 * 864e5).toISOString().slice(0, 10);
    var picks = [];
    S.movies.forEach(function (m) {
      if (!inNavLang(m) || isTv(m) || (!all && (m.data.releaseDate || '') < cut)) return;
      var it = vidItems(m), k = -1;
      it.some(function (x, i) { if (x.cat === 'trailers' && (x.yt || x.clip)) { k = i; return true; } });
      if (k >= 0) picks.push({ m: m, i: k, x: it[k] });
    });
    picks.sort(function (a, b) { return (b.m.data.releaseDate || '').localeCompare(a.m.data.releaseDate || ''); });
    return picks;
  }
  function trailerCard(p) {
    var m = p.m, d = m.data, rel = released(m);
    var th = p.x.yt ? h('img', { src: 'https://i.ytimg.com/vi/' + p.x.yt + '/hqdefault.jpg', alt: '', loading: 'lazy' }) : h('span', { class: 'ph', style: artLazy(m, 'banner', 640).style, 'data-bg': artLazy(m, 'banner', 640).bg });
    return h('a', { class: 'tcard', href: movieUrl(m), 'aria-label': 'Play the ' + d.title + ' ' + p.x.kind.toLowerCase(), on: { click: function (e) {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault(); e.stopPropagation();
      openTrailerOverlay(m, p.x, e.currentTarget);
    } } }, [
      h('span', { class: 'th' }, [th, h('span', { class: 'kb', text: String(p.x.kind).toUpperCase() }), h('span', { class: 'pb', 'aria-hidden': 'true', text: '▶' })]),
      h('span', { class: 'tt', text: d.title }),
      h('span', { class: 'note', text: [langOf(d), rel ? (isOtt(m) ? 'On ' + (d.platform || 'OTT') : 'Out now') : 'Releases ' + fmtDate(d.releaseDate)].filter(Boolean).join(' · ') })
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
    var cut = new Date(Date.now() - 180 * 864e5).toISOString().slice(0, 10), picks = [];
    S.movies.forEach(function (m) {
      if (!inNavLang(m) || isTv(m) || (!all && (m.data.releaseDate || '') < cut)) return;
      var ss = vidItems(m).filter(function (x) { return x.cat === 'songs' && (x.yt || x.clip); });
      (all ? ss : ss.slice(0, 3)).forEach(function (x) { picks.push({ m: m, x: x }); });
    });
    picks.sort(function (a, b) { return (b.m.data.releaseDate || '').localeCompare(a.m.data.releaseDate || ''); });
    return picks;
  }
  function songCard(p) {
    var m = p.m, d = m.data;
    var th = p.x.yt ? h('img', { src: 'https://i.ytimg.com/vi/' + p.x.yt + '/hqdefault.jpg', alt: '', loading: 'lazy' }) : h('span', { class: 'ph', style: artLazy(m, 'banner', 640).style, 'data-bg': artLazy(m, 'banner', 640).bg });
    return h('a', { class: 'tcard', href: movieUrl(m), 'aria-label': 'Play ' + p.x.title + ' from ' + d.title, on: { click: function (e) {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault(); e.stopPropagation();
      openTrailerOverlay(m, p.x, e.currentTarget);
    } } }, [
      h('span', { class: 'th' }, [th, h('span', { class: 'kb', text: String(p.x.kind).toUpperCase() }), h('span', { class: 'pb', 'aria-hidden': 'true', text: '▶' })]),
      h('span', { class: 'tt', text: p.x.title }),
      h('span', { class: 'note', text: [d.title, langOf(d)].filter(Boolean).join(' · ') })
    ]);
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
  // /about is a static page; navigating to it inside the app loads it in full.
  function drawAbout() { if (!$('view-about').querySelector('[data-prerendered]')) location.reload(); }
  function drawNotFound() {
    var v = $('view-home');
    if (v.querySelector('[data-prerendered]') && !S.nfDrawn) { S.nfDrawn = true; return; }
    v.innerHTML = '';
    v.appendChild(h('div', { class: 'wrapx' }, [h('div', { class: 'empty' }, ['This page doesn’t exist, or the title has moved. ', h('a', { href: '/', text: 'Go to the home page' }), ' · ', h('a', { href: '/browse', text: 'Browse all titles' })])]));
  }
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
    var list = all.filter(function (p) { return !S.vids.lang || langOf(p.m.data) === S.vids.lang; });
    head.appendChild(h('p', { class: 'note', style: 'margin:0', text: list.length + ' ' + P.what + ', newest first' + (S.navLang ? ' · ' + S.navLang + ' only' : '') }));
    if (!S.navLang && Object.keys(langs).length > 1) {
      var e = h('select', { class: 'in', id: 'vLang' }, [['', 'All languages']].concat(Object.keys(langs).sort().map(function (l) { return [l, l]; })).map(function (o) { return h('option', { value: o[0], text: o[1], selected: o[0] === S.vids.lang }); }));
      e.addEventListener('change', function () { S.vids.lang = e.value; S.vids.n = 48; e.blur(); render(true); });
      bar.appendChild(h('div', { class: 'field', style: 'width:220px;margin:0' }, [h('label', { class: 'l', for: 'vLang', text: 'Language' }), e]));
    }
    w.appendChild(h('div', { class: 'vgrid' }, list.slice(0, S.vids.n).map(P.card)));
    if (list.length > S.vids.n) w.appendChild(h('div', { style: 'text-align:center;margin:24px 0' }, [h('button', { type: 'button', class: 'btn', text: 'Show more', on: { click: function () { S.vids.n += 48; render(true); } } })]));
    if (!list.length) w.appendChild(h('p', { class: 'note', text: 'Nothing here yet.' }));
  }

  // ---------- New TV promotionals: trailers, teasers, promos and full episodes of TV shows, played in the overlay ----------
  function tvPromoPicks(all) {
    var thisYear = String(new Date().getFullYear()), picks = [];
    var shows = homeSection('TV shows').slice().sort(function (a, b) {
      var aa = !a.data.endYear || String(a.data.endYear) >= thisYear ? 1 : 0, bb = !b.data.endYear || String(b.data.endYear) >= thisYear ? 1 : 0;
      return bb - aa || (b.data.releaseDate || '').localeCompare(a.data.releaseDate || '');
    });
    shows.forEach(function (m) { var vs = vidItems(m).filter(function (x) { return x.yt || x.clip; }); (all ? vs : vs.slice(0, 2)).forEach(function (x) { picks.push({ m: m, x: x }); }); });
    return picks;
  }
  function tvPromoCard(p) {
    var m = p.m, d = m.data;
    var th = p.x.yt ? h('img', { src: 'https://i.ytimg.com/vi/' + p.x.yt + '/hqdefault.jpg', alt: '', loading: 'lazy' }) : h('span', { class: 'ph', style: artLazy(m, 'banner', 640).style, 'data-bg': artLazy(m, 'banner', 640).bg });
    return h('a', { class: 'tcard', href: movieUrl(m), 'aria-label': 'Play ' + d.title + ': ' + p.x.title, on: { click: function (e) {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault(); e.stopPropagation();
      openTrailerOverlay(m, p.x, e.currentTarget);
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
  function yearMovies(y) { return S.movies.filter(function (m) { return !isTv(m) && inNavLang(m) && (m.data.releaseDate || '').slice(0, 4) === y; }); }
  function drawYear() {
    var v = $('view-year');
    if (!S.loaded && v.querySelector('[data-prerendered]')) return;
    v.innerHTML = '';
    var Y = S.yr, y = Y.year, c = yearCol(y), all = yearMovies(y), now = new Date().getFullYear();
    v.appendChild(h('section', { class: 'ghero', style: '--g1:' + c[0] + ';--g2:' + c[1] }, [
      h('nav', { class: 'gcrumbs', 'aria-label': 'Breadcrumb' }, [h('a', { href: '/', text: 'Home' }), ' › ', h('a', { href: '/browse', text: 'Browse' }), ' › ', y]),
      h('h1', { class: 'display', text: y }),
      h('p', { text: S.loaded ? all.length.toLocaleString('en-IN') + ' ' + (S.navLang ? S.navLang + ' ' : 'Bollywood and regional ') + 'movies ' + (+y > now ? 'due in ' : 'released in ') + y + ', most popular first.' : 'Loading…' })
    ]));
    var yrs = []; for (var k = now + (S.movies.some(function (m) { return (m.data.releaseDate || '').slice(0, 4) === String(now + 1); }) ? 1 : 0); k >= now - 9; k--) yrs.push(String(k));
    v.appendChild(h('nav', { class: 'gnav', 'aria-label': 'Other years' }, yrs.map(function (x) {
      return h('a', { class: 'chip', href: '/year/' + x, 'aria-current': x === y ? 'page' : null, 'aria-pressed': String(x === y), text: x });
    }).concat([h('a', { class: 'chip', href: '/browse/older-releases', text: 'Older…' })])));
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
    var PER = 60, pages = Math.ceil(list.length / PER); Y.page = Math.min(Math.max(1, Y.page || 1), pages);
    syncListUrl(yearHref(Y, Y.page));
    var from = (Y.page - 1) * PER;
    w.appendChild(h('div', { class: 'sub', style: 'margin-bottom:14px', text: list.length > PER ? 'Showing ' + (from + 1) + '–' + Math.min(from + PER, list.length) + ' of ' + list.length.toLocaleString('en-IN') + ' movies' : list.length + (list.length === 1 ? ' movie' : ' movies') }));
    w.appendChild(h('div', { class: 'grid-posters' }, list.slice(from, from + PER).map(function (m) { return posterCard(m, m.data.section === 'Coming soon' ? { dateBadge: true, remind: true } : null); })));
    if (pages > 1) w.appendChild(pagerNav(Y.page, pages, function (n) { return yearHref(Y, n); }));
    v.appendChild(footer());
  }
  function yearSection() {
    var now = new Date().getFullYear(), tiles = [];
    for (var k = now; k > now - 10; k--) { var n = yearMovies(String(k)).length; if (n) tiles.push([String(k), n]); }
    if (tiles.length < 3) return null;
    return h('section', { class: 'sect', 'aria-label': 'Years' }, [
      h('div', { class: 'sect-h' }, [h('h2', { text: 'Movies by year' }), h('span', { class: 'sub' }, [h('a', { href: '/browse/older-releases', text: 'Older releases' })])]),
      h('div', { class: 'rowx gtiles' }, tiles.map(function (x) {
        var c = yearCol(x[0]);
        return h('a', { class: 'gtile ytile', href: '/year/' + x[0], style: '--g1:' + c[0] + ';--g2:' + c[1], 'aria-label': x[0] + ', ' + x[1] + ' movies' }, [
          h('span', { class: 'gn', text: x[0] }), h('span', { class: 'gc', 'aria-hidden': 'true', text: x[1] + ' movies' })
        ]);
      }))
    ]);
  }

  // Genre tiles on the home page; each opens Browse filtered to that genre (and the nav language, if set).
  var GENRE_COL = { Action: ['#1F5F86', '#2E86AB'], Comedy: ['#5B2A86', '#7B3FB0'], Drama: ['#6A4A2E', '#8C6A48'], Thriller: ['#2B2F3D', '#4A5068'], Horror: ['#5A1A1F', '#8A2A30'], Romance: ['#8A2650', '#B3406E'], Family: ['#2F6B3A', '#4C8F45'], Animated: ['#1F6E6A', '#2E918B'], Biopic: ['#7A4A12', '#A8661E'], Mythological: ['#6B3A10', '#9A5A18'], War: ['#3D4A2A', '#5B6B3C'], 'Sci-fi': ['#22306E', '#3A4BA0'] };
  function genreSection() {
    var tiles = GENRES.map(function (g) {
      var n = S.movies.filter(function (m) { return inNavLang(m) && genreTags(m.data).indexOf(g) !== -1; }).length;
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
    var list = sectionOf(m.data.section).map(function (x) { return { id: x.id, s: score(x.id) }; }).filter(function (x) { return x.s.pct !== null; });
    list.sort(function (a, b) { return b.s.pct - a.s.pct || b.s.tot - a.s.tot; });
    for (var i = 0; i < list.length; i++) if (list[i].id === m.id) return i + 1;
    return 0;
  }
  function drawHero() {
    var box = $('heroBox'); if (!box || !S.feat || !S.feat.length) return;
    var feat = S.feat; if (S.slide >= feat.length) S.slide = 0;
    var m = feat[S.slide], d = m.data, sc = score(m.id);
    var clip = safeUrl(d.trailerFileUrl), yt = clip ? null : heroYt(m), playing = !!(S.play && S.play.id === m.id && (clip || yt));
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
    var secName = { 'In theatres': 'in Theatres', 'On OTT': 'on OTT', 'Coming soon': 'Coming soon', 'Older releases': 'of 2025–26', 'TV shows': 'in TV shows' }[d.section] || '';
    var chips = [];
    if (langs.length) chips.push(h('span', { class: 'hc' }, [h('span', { 'aria-hidden': 'true', text: '🗣' }), 'In ' + langs.join(', ')]));
    if (rk && rk <= 10) chips.push(h('span', { class: 'hc' }, [h('b', { text: 'TOP' }), '#' + rk + ' ' + secName]));
    else if (sc.pct !== null) chips.push(h('span', { class: 'hc' }, [h('b', { text: sc.pct + '%' }), sc.tot + (sc.tot === 1 ? ' verdict' : ' verdicts')]));
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
    var hero = h('section', { class: 'fh' + (playing ? ' playing' : '') + (playing && yt ? ' yt' : ''), style: art(m, 'banner', 1920), 'aria-roledescription': 'carousel', 'aria-label': 'Featured: ' + d.title,
      on: { mouseenter: function () { S.heroPause = true; }, mouseleave: function () { S.heroPause = false; }, focusin: function () { S.heroPause = true; }, focusout: function () { S.heroPause = false; } } }, [
      video,
      h('div', { class: 'scrim' }),
      playing ? h('button', { type: 'button', class: 'vclose', 'aria-label': 'Close trailer', text: '×', on: { click: stopTrailer } }) : null,
      playing ? h('div', { class: 'vprog', 'aria-hidden': 'true' }, [h('span', { id: 'vProg' })]) : null,
      h('div', { class: 'fb' }, [
        h('h1', { class: 'logo', text: d.title }),
        meta,
        d.synopsis ? h('p', { class: 'syn', text: d.synopsis }) : null,
        h('div', { class: 'btns' }, [
          playing ? h('button', { type: 'button', class: 'pill play', id: 'vPlay', on: { click: togglePause } }, ['❚❚  Pause'])
            : clip ? h('button', { type: 'button', class: 'pill play', on: { click: function () { startTrailer(m.id); } } }, [h('span', { 'aria-hidden': 'true', text: '▶' }), 'Trailer'])
            : yt ? h('button', { type: 'button', class: 'pill play', on: { click: function () { startTrailer(m.id); } } }, [h('span', { 'aria-hidden': 'true', text: '▶' }), 'Trailer'])
            : h('a', { class: 'pill play', href: movieUrl(m) }, [h('span', { 'aria-hidden': 'true', text: '▶' }), 'Trailer']),
          h('a', { class: 'pill info', href: movieUrl(m), text: 'More Info' }),
          playing && !yt ? h('button', { type: 'button', class: 'roundadd', id: 'vMute', 'aria-label': S.play.muted ? 'Unmute' : 'Mute', text: S.play.muted ? '🔇' : '🔊', on: { click: toggleMute } }) : null,
          playing ? null : h('button', { type: 'button', class: 'roundadd', 'aria-pressed': String(on), 'aria-label': on ? 'Remove ' + d.title + ' from my list' : 'Add ' + d.title + ' to my list', title: on ? 'In my list' : 'Add to my list', text: on ? '✓' : '+',
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
  // The hero's YouTube trailer: the first trailer/teaser with a YouTube link, else any YouTube video of the title.
  function heroYt(m) {
    var it = vidItems(m).filter(function (x) { return x.yt; });
    return it.filter(function (x) { return x.cat === 'trailers'; })[0] || it[0] || null;
  }
  function safePlay(el, onFail) { try { var p = el.play(); if (p && p.catch) p.catch(function () { if (onFail) onFail(); }); } catch (e) { if (onFail) onFail(); } }
  function startTrailer(id) { S.play = { id: id, muted: false, paused: false }; S.heroNode = null; drawHero(); }
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
    if (S.route !== 'home' || S.heroPause || S.play || document.hidden || !S.feat || S.feat.length < 2) return;
    S.slide = (S.slide + 1) % S.feat.length; drawHero();
  }, 8000);
  // Credit for data from open sources (TVmaze is CC BY-SA and asks for a link; Wikidata is CC0 but credited anyway).
  function srcCredit(d) {
    var tvm = safeUrl(d.srcTvmaze);
    if (tvm) return h('p', { class: 'note', style: 'margin:6px 0 0;font-size:12px;color:var(--muted)' }, ['Show details and image from ', h('a', { href: tvm, rel: 'noopener', target: '_blank', text: 'TVmaze' }), ' (', h('a', { href: 'https://creativecommons.org/licenses/by-sa/4.0/', rel: 'noopener license', target: '_blank', text: 'CC BY-SA 4.0' }), ')']);
    if (/^Q\d+$/.test(d.wikidata || '')) return h('p', { class: 'note', style: 'margin:6px 0 0;font-size:12px;color:var(--muted)' }, ['Film facts from ', h('a', { href: 'https://www.wikidata.org/wiki/' + d.wikidata, rel: 'noopener', target: '_blank', text: 'Wikidata' })]);
    return null;
  }
  function footer() {
    return h('footer', { class: 'ft' }, [h('span', { text: 'Reelscore · Verdicts and reviews are public.' }), h('a', { href: '/about', text: 'About & how scores work' }), h('span', { class: 'note', text: 'Some data: Wikidata (CC0) and TVmaze (CC BY-SA 4.0)' })]);
  }

  // ---------- title ----------
  function drawTitle() {
    var v = $('view-title');
    // A pre-rendered page (built for search engines) stays on screen until the catalogue arrives.
    if (!S.loaded && v.querySelector('[data-prerendered]')) return;
    var keep = S.vKeep && S.vKeep.parentNode === v && ((S.vplay && S.vKeep._mid === S.vplay.mid) || (S.vIdle && S.vKeep._mid === S.vIdle.mid)) ? S.vKeep : null;
    Array.prototype.slice.call(v.childNodes).forEach(function (c) { if (c !== keep) v.removeChild(c); });
    if (!keep) S.vKeep = null;
    var put = function (n) { if (!n) return; if (n === keep) { keep = null; return; } if (keep) v.insertBefore(n, keep); else v.appendChild(n); };
    var m = findMovie(S.param);
    if (keep && (!m || keep._mid !== m.id)) { if (keep.parentNode) keep.parentNode.removeChild(keep); keep = null; S.vKeep = null; S.vIdle = null; }
    if (!m || (S.vplay && S.vplay.mid !== m.id)) { S.vplay = null; if (S.vKeep && S.vKeep.parentNode) S.vKeep.parentNode.removeChild(S.vKeep); S.vKeep = null; keep = null; }
    if (m) { canonicalizeTitleUrl(m); document.title = movieTitleTag(m); setCanonical(movieUrl(m)); }
    setNoindex(!m && S.loaded);
    if (!S.loaded) { put(h('div', { class: 'wrapx' }, [h('div', { class: 'empty', text: 'Loading…' })])); return; }
    if (!m) { put(h('div', { class: 'wrapx' }, [h('div', { class: 'empty' }, ['This title isn’t in the catalogue. ', h('a', { href: '/', text: 'Back to home' })])])); return; }
    var d = m.data, rel = released(m), ott = isOtt(m);
    var tags = [h('span', { class: 'tag hot', text: statusLabel(m) })];
    [d.languages, d.genre, [d.runtime, d.certificate].filter(Boolean).join(' · ')].forEach(function (t) { if (t) tags.push(h('span', { class: 'tag', text: t })); });
    if (d.releaseNote) tags.push(h('span', { class: 'tag', text: d.releaseNote }));
    var actLabel = ott ? (rel ? 'Watch on ' + (d.platform || 'OTT') : 'Remind me') : isOld(m) || isTv(m) ? 'Where to watch' : null; // ticket booking hidden until a partner is integrated
    put(titleHero(m, tags, actLabel));

    // scores
    var sc = score(m.id), vs = vset(m), my = myVerdict(m.id);
    var friendScore = score(m.id, S.mine.following);
    var overall = h('div', { class: 'scard' }, [
      h('div', {}, [
        h('div', { class: 'kicker', text: 'Overall score' }),
        h('div', { class: 'big', style: 'color:var(--accent);font-size:' + (sc.pct === null ? '34px' : '52px'), text: sc.pct === null ? (rel ? 'Verdicts open' : 'Opens on release') : sc.pct + '%' }),
        sc.tot ? h('div', { class: 'split', 'aria-hidden': 'true' }, [h('span', { style: 'width:' + (100 * sc.n.a / sc.tot) + '%;background:var(--accent)' }), h('span', { style: 'width:' + (100 * sc.n.b / sc.tot) + '%;background:var(--text)' })]) : null,
        h('div', { class: 'sub', style: 'margin-top:6px' }, [sc.tot ? vs.map(function (x) { return x[1] + ' ' + Math.round(100 * sc.n[x[0]] / sc.tot) + '%'; }).join(' · ') + ' · ' + sc.tot + (sc.tot === 1 ? ' verdict' : ' verdicts') : (rel ? 'Seen it? Your verdict starts the score.' : 'Verdicts open on ' + fmtDate(d.releaseDate, true) + '.'), ' ', h('a', { href: '/about', style: 'color:var(--muted)', text: 'How scores work' })])
      ]),
      rel ? h('div', { role: 'group', 'aria-label': 'Your verdict' }, [
        h('div', { class: 'kicker', style: 'margin-bottom:8px', text: my ? 'Your verdict · tap again to clear' : 'Your verdict' }),
        h('div', { class: 'vbtns' }, vs.map(function (x) {
          return h('button', { type: 'button', class: 'vb ' + x[0], 'aria-pressed': String(my === x[0]), on: { click: function () { setVerdict(m.id, x[0]); } } }, [h('b', { text: x[1] }), h('small', { text: x[2] })]);
        })),
        // After a verdict: ask friends for theirs. More verdicts make the score worth trusting.
        my ? h('div', { class: 'sub', style: 'margin-top:10px' }, ['Ask friends who saw it: ',
          h('a', { href: 'https://wa.me/?text=' + encodeURIComponent('My verdict on ' + d.title + ': ' + (vs.filter(function (x) { return x[0] === my; })[0] || [0, ''])[1] + '. What’s yours? ' + location.origin + movieUrl(m)), target: '_blank', rel: 'noopener', style: 'color:var(--accent);font-weight:600', text: 'Share on WhatsApp' }),
          navigator.share ? ' · ' : null,
          navigator.share ? h('a', { href: '#', style: 'color:var(--accent);font-weight:600', text: 'More…', on: { click: function (e) { e.preventDefault(); try { navigator.share({ title: d.title + ' on Reelscore', text: 'What’s your verdict on ' + d.title + '?', url: location.origin + movieUrl(m) }); } catch (er) {} } } }) : null]) : null
      ]) : h('button', { type: 'button', class: 'btn', 'aria-pressed': String(hasReminder(m.id)), on: { click: function () { toggleRemind(m.id); } } }, [hasReminder(m.id) ? '🔔 Reminder set' : 'Remind me on release'])
    ]);
    var fr = friendScore.raters;
    var friends = h('div', { class: 'scard', style: 'flex:1 1 300px' }, [
      h('div', {}, [
        h('div', { class: 'kicker', text: 'People you follow' }),
        fr.length >= 3 ? h('div', { class: 'big', text: friendScore.pct + '%' }) : h('div', { style: 'font-size:16px;font-weight:600;margin-top:6px', text: fr.length ? fr.length + (fr.length === 1 ? ' person you follow rated it' : ' people you follow rated it') : (S.mine.following.length ? 'None of them have rated it yet' : 'You’re not following anyone yet') }),
        h('div', { class: 'sub', style: 'margin-top:6px' }, [fr.length >= 3 ? fr.length + ' ratings · Peer Score' : 'Peer Score appears at 3 ratings. ', fr.length >= 3 ? null : h('a', { href: '/my-list', text: 'Find people' })])
      ]),
      fr.length ? h('div', { class: 'faces' }, fr.slice(0, 5).map(function (u) { return avatarEl(u, 36); })) : null
    ]);
    put(h('div', { class: 'scores', style: 'margin-top:8px' }, [overall, friends]));

    // columns
    // sections, in the order of the tabs above them
    var act = actionBlock(m, rel, ott);
    var theatre = keep && keep._mid === m.id ? keep : videosBlock(m);
    var main = h('div', { class: 'colm' }, [act, aboutBlock(m), castBlock(m), reviewsBlock(m, rel)]);
    var side = h('div', { class: 'cols2' }, [planBlock(m), factsBlock(m)]);
    var more = S.movies.filter(function (x) { return x.data.section === d.section && x.id !== m.id; }).sort(function (a, b) { return (b.data.releaseDate || '').localeCompare(a.data.releaseDate || ''); }).slice(0, 24);
    var r = rowSection('More ' + (isTv(m) ? 'TV shows' : d.section.toLowerCase().replace('on ott', 'on OTT')), more, d.section === 'Coming soon' ? { dateBadge: true, remind: true } : null);
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
    var nVids = vidItems(m).length, nRev = 0;
    Object.keys(S.reviews).forEach(function (uid) { var it = (S.reviews[uid].items || {})[m.id]; if (it && it.text) nRev++; });
    var nWatch = d.platform ? String(d.platform).split(/\s*[,/&]\s*|\s+and\s+/).filter(Boolean).length : 0;
    put(pageTabs([
      ['videos', 'Trailers & songs', nVids],
      act ? ['watch', 'Where to watch', nWatch] : null,
      ['cast', 'Cast & crew', 0],
      ['reviews', 'Reviews', nRev],
      r ? ['more', 'More like this', 0] : null
    ].filter(Boolean)));
    put(theatre);
    put(h('div', { class: 'cols' }, [main, side]));
    if (rc) put(rc);
    if (rs) put(rs);
    if (r) put(r);
    put(footer());
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

  function titleHero(m, tags, actLabel) {
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
      ? h('button', { type: 'button', class: 'btn lg light', id: 'tPlay', on: { click: toggleTitlePause } }, ['❚❚  Pause'])
      : clip ? h('button', { type: 'button', class: 'btn lg light', on: { click: function () { startTitleTrailer(m.id); } } }, ['▶  Play trailer'])
      : vidItems(m).some(function (x) { return x.yt; }) ? h('button', { type: 'button', class: 'btn lg light', on: { click: function () { var it = vidItems(m), k = 0; it.some(function (x, i) { if (x.yt) { k = i; return true; } }); playVid(m.id, k, true); } } }, ['▶  Play trailer'])
      : trailerBtn(m);
    var node = h('section', { class: 'tp art' + (playing ? ' playing' : ''), style: art(m, 'banner', 1920) }, [
      video,
      h('div', { class: 'shade' }),
      playing ? h('button', { type: 'button', class: 'vclose', 'aria-label': 'Close trailer', text: '×', on: { click: stopTitleTrailer } }) : null,
      playing ? h('div', { class: 'vprog', 'aria-hidden': 'true' }, [h('span', { id: 'tProg' })]) : null,
      h('div', { class: 'in' }, [
        h('div', { class: 'poster art', style: art(m, 'poster', 480), role: 'img', 'aria-label': d.title + ' poster' }),
        h('div', { class: 'txt' }, [
          h('a', { href: '/', style: 'color:var(--muted);font-weight:600;font-size:14px;text-decoration:none', text: '← Back to home' }),
          h('div', { class: 'tags' }, tags),
          h('h1', { class: 'display ttl', style: 'font-size:clamp(44px,6vw,84px)', text: d.title }),
          d.subtitle ? h('div', { class: 'display sbt', style: 'font-size:clamp(24px,3vw,36px);color:#D9D5DF', text: d.subtitle }) : null,
          d.synopsis ? h('p', { class: 'lede', style: 'max-width:680px', text: d.synopsis }) : null,
          srcCredit(d),
          h('div', { class: 'acts2' }, [
            playBtn,
            playing ? h('button', { type: 'button', class: 'roundadd', id: 'tMute', 'aria-label': S.tplay.muted ? 'Unmute' : 'Mute', text: S.tplay.muted ? '🔇' : '🔊', on: { click: toggleTitleMute } }) : null,
            actLabel === null ? null : h('a', { class: 'btn lg primary', href: '#watch', on: { click: function (e) { e.preventDefault(); var t = $('watch'); if (t) t.scrollIntoView({ behavior: 'smooth' }); } } }, [actLabel]),
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
      box.appendChild(h('div', { class: 'field' }, [
        h('label', { class: 'l', for: 'rvText', text: myR ? 'Your review' : 'Write a review' }), ta,
        h('div', { style: 'display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px' }, [
          h('label', { style: 'display:flex;align-items:center;gap:8px;font-size:14px;color:var(--muted)' }, [sp, 'Contains spoilers']),
          h('span', { style: 'display:flex;gap:8px' }, [
            myR ? h('button', { type: 'button', class: 'btn small', text: 'Delete', on: { click: function () { saveReview(m.id, '', false); } } }) : null,
            h('button', { type: 'button', class: 'btn small primary', text: myR ? 'Update review' : 'Post review', on: { click: function () {
              var t = ta.value.trim(); if (!t) { toast('Write something first.'); return; }
              if (!myVerdict(m.id)) { toast('Pick a verdict first.'); return; }
              saveReview(m.id, t, sp.checked);
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
    box.appendChild(h('div', { class: 'chips', role: 'tablist' }, [['all', 'All reviews (' + all.length + ')'], ['friends', 'People you follow (' + fol.length + ')']].map(function (t) {
      return h('button', { type: 'button', role: 'tab', class: 'chip', 'aria-pressed': String(S.rtab === t[0]), 'aria-selected': String(S.rtab === t[0]), text: t[1], on: { click: function () { S.rtab = t[0]; render(true); } } });
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
  function vidCat(k) { k = String(k || '').toLowerCase(); return /trailer|teaser|promo|glimpse/.test(k) ? 'trailers' : /song|lyric|music|jukebox|audio/.test(k) ? 'songs' : /episode/.test(k) ? 'episodes' : 'more'; }
  function vidItems(m) {
    var d = m.data, out = [], clip = safeUrl(d.trailerFileUrl);
    if (clip) out.push({ title: 'Trailer', kind: 'Trailer', clip: clip, cat: 'trailers' });
    (d.videos || []).forEach(function (x) {
      var u = safeUrl(x.url), id = ytId(u);
      out.push({ title: x.title || x.kind || 'Video', kind: x.kind || 'Video', url: u, yt: id, cat: vidCat(x.kind) });
    });
    return out;
  }
  function playVid(mid, i, scroll) {
    S.vsel = S.vsel || {}; S.vsel[mid] = i;
    S.vplay = { mid: mid, i: i }; S.vKeep = null; S.vIdle = null;
    if (S.tplay) { if (S.tpVideo) { try { S.tpVideo.pause(); } catch (e) {} } S.tplay = null; S.tpNode = null; S.tpVideo = null; }
    render(true);
    if (scroll) setTimeout(function () { var t = $('videos'); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 30);
  }
  function stepVid(m, dir, play) {
    var it = vidItems(m), n = it.length; if (!n) return;
    var cur = (S.vsel && S.vsel[m.id]) || 0, k = cur;
    for (var t = 0; t < n; t++) { k = (k + dir + n) % n; if (it[k].yt || it[k].clip) break; }
    if (play) playVid(m.id, k); else { S.vsel = S.vsel || {}; S.vsel[m.id] = k; S.vplay = null; S.vKeep = null; S.vIdle = null; render(true); }
  }
  function videosBlock(m) {
    var d = m.data, items = vidItems(m), n = items.length;
    var head = function (extra) { return h('div', { class: 'thx-h' }, [h('h2', { id: 'h-vid', text: 'Trailers & songs' })].concat(extra || [])); };
    if (!n) return h('section', { class: 'thx', id: 'videos', 'aria-labelledby': 'h-vid' }, [head(), h('div', { class: 'note', text: 'No trailers or songs yet.' })]);
    S.vsel = S.vsel || {}; S.vf = S.vf || {};
    var cur = Math.min(S.vsel[m.id] || 0, n - 1), x = items[cur];
    var playing = !!(S.vplay && S.vplay.mid === m.id && S.vplay.i === cur && (x.yt || x.clip));
    var cats = [['all', 'All'], ['trailers', 'Trailers'], ['songs', 'Songs'], ['episodes', 'Episodes'], ['more', 'More']].map(function (c) {
      return [c[0], c[1], c[0] === 'all' ? n : items.filter(function (y) { return y.cat === c[0]; }).length];
    }).filter(function (c) { return c[2]; });
    var vf = S.vf[m.id] || 'all'; if (!cats.some(function (c) { return c[0] === vf; })) vf = 'all';
    var chips = cats.length > 2 ? h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter videos' }, cats.map(function (c) {
      return h('button', { type: 'button', class: 'chip', 'aria-pressed': String(vf === c[0]), text: c[1] + ' · ' + c[2], on: { click: function () { S.vf[m.id] = c[0]; if (!S.vplay) { S.vKeep = null; S.vIdle = null; } render(true); } } });
    })) : null;

    // the stage
    var media = null;
    if (playing && x.yt) {
      media = h('iframe', { src: 'https://www.youtube-nocookie.com/embed/' + x.yt + '?autoplay=1&rel=0&playsinline=1&modestbranding=1',
        title: d.title + ' · ' + x.title, allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin' });
    } else if (playing && x.clip) {
      media = h('video', { src: x.clip, controls: true, autoplay: true, playsinline: true, preload: 'auto' });
      media.setAttribute('aria-label', d.title + ' · ' + x.title);
      setTimeout(function () { safePlay(media); }, 0);
    }
    // A YouTube video sits in the page as a real (lazy) embed even before it is played, so search engines can see it;
    // the section is then kept across re-renders so a video started in that player isn't interrupted.
    var idle = !playing && !!x.yt;
    if (idle) media = h('iframe', { src: 'https://www.youtube-nocookie.com/embed/' + x.yt + '?rel=0&playsinline=1&modestbranding=1', loading: 'lazy',
      title: d.title + ' · ' + x.title, allow: 'encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin' });
    var bg = x.yt ? 'background-image:url("https://i.ytimg.com/vi/' + x.yt + '/hqdefault.jpg")' : art(m, 'banner');
    var stage = h('div', { class: 'stage' + (playing || idle ? ' on' : ''), style: playing ? '' : bg }, playing || idle ? [media] : [
      h('div', { class: 'shade' }),
      h('div', { class: 'top' }, [h('span', { class: 'kb', text: String(x.kind).toUpperCase() }), h('span', { class: 'pos', text: (cur + 1) + ' / ' + n })]),
      x.yt || x.clip
        ? h('button', { type: 'button', class: 'big', 'aria-label': 'Play ' + x.title, on: { click: function () { playVid(m.id, cur); } } }, [h('span', { 'aria-hidden': 'true', text: '▶' })])
        : h('div', { class: 'big off', text: x.url ? '' : 'Link coming' }),
      h('div', { class: 'bot' }, [h('div', { class: 'display t', text: x.title }), h('div', { class: 'note', style: 'color:#E4E0D8', text: d.title + ' · ' + x.kind })])
    ]);
    var nextI = cur + 1 < n ? cur + 1 : -1;
    var info = h('div', { class: 'thx-i' }, [
      h('div', { style: 'min-width:0' }, [
        h('h3', { text: x.title }),
        h('div', { class: 'note', text: nextI >= 0 ? 'Next: ' + items[nextI].title + ' · ' + items[nextI].kind : x.kind })
      ]),
      h('div', { class: 'thx-c' }, [
        n > 1 ? h('button', { type: 'button', class: 'btn sq', 'aria-label': 'Previous video', text: '‹', on: { click: function () { stepVid(m, -1, playing); } } }) : null,
        n > 1 ? h('button', { type: 'button', class: 'btn sq', 'aria-label': 'Next video', text: '›', on: { click: function () { stepVid(m, 1, playing); } } }) : null,
      ])
    ]);
    var shown = items.map(function (y, i) { return [y, i]; }).filter(function (p) { return vf === 'all' || p[0].cat === vf; });
    var list = n > 1 ? h('aside', { class: 'thx-l', 'aria-label': 'Playlist' }, [
      h('div', { class: 'thx-lh' }, [h('b', { text: 'Playlist' }), h('span', { class: 'note', text: shown.length + ' of ' + n + (n === 1 ? ' video' : ' videos') })]),
      h('div', { class: 'thx-ls' }, shown.map(function (p) {
        var y = p[0], i = p[1], sel = i === cur, can = !!(y.yt || y.clip);
        var th = y.yt ? h('img', { src: 'https://i.ytimg.com/vi/' + y.yt + '/mqdefault.jpg', alt: '', loading: 'lazy' }) : h('span', { class: 'ph', style: artLazy(m, 'banner', 640).style, 'data-bg': artLazy(m, 'banner', 640).bg });
        return h('button', { type: 'button', class: 'pli', 'aria-current': sel ? 'true' : 'false', disabled: !can, on: { click: function () { playVid(m.id, i); } } }, [
          h('span', { class: 'th' }, [th, h('span', { class: 'pb', 'aria-hidden': 'true', text: '▶' })]),
          h('span', { class: 'tx' }, [
            h('span', { class: 'bd' + (sel ? ' on' : ''), text: sel ? (playing ? 'NOW PLAYING' : 'SELECTED') : String(i + 1).padStart(2, '0') }),
            h('span', { class: 'tt', text: y.title }),
            h('span', { class: 'note', text: can ? y.kind : y.kind + ' · link coming' })
          ])
        ]);
      }))
    ]) : null;
    var sec = h('section', { class: 'thx', id: 'videos', 'aria-labelledby': 'h-vid' }, [
      head([chips]),
      h('div', { class: 'thx-g' }, [h('div', { class: 'thx-p' }, [stage, info]), list])
    ]);
    sec._mid = m.id;
    S.vKeep = playing || idle ? sec : null; S.vIdle = idle ? { mid: m.id } : null;
    return sec;
  }
  function epText(n) { n = String(n || '').trim(); return n ? n + (n === '1' ? ' episode' : ' episodes') : ''; }
  // Plain-language summary written from the title's facts (app/about.js; the pre-rendered page uses the same text).
  function aboutBlock(m) {
    if (!window.RS_ABOUT) return null;
    var d = m.data, sc = score(m.id), y = String(d.releaseDate || '').slice(0, 4);
    var text = RS_ABOUT.title({ title: d.title, tv: isTv(m), date: d.releaseDate || '', year: y, upcoming: isUpcoming(m), released: released(m),
      languages: d.languages, genre: d.genre, runtime: d.runtime, certificate: d.certificate, seasons: d.seasons, endYear: d.endYear,
      platform: d.platform, director: d.director, cast: (d.cast || []).filter(function (c) { return c && c.name; }), verdicts: { pct: sc.pct, tot: sc.tot } });
    return h('section', { class: 'card', id: 'about' }, [h('h2', { text: 'About ' + d.title }), h('p', { class: 'about', text: text })]);
  }
  function castBlock(m) {
    var cast = m.data.cast || [];
    return h('section', { class: 'card', id: 'cast' }, [h('h2', { text: 'Cast & crew' }),
      cast.length ? h('div', { class: 'castg' }, cast.map(function (c, i) {
        var pk = personSlug(c.name), ph = personPhotoUrl(c.name);
        var face = ph ? h('img', { src: ph, alt: '', class: 'c', style: 'object-fit:cover;background:#2E2A38' })
          : h('span', { class: 'c', style: 'background:' + PAL[i % PAL.length][1], 'aria-hidden': 'true', text: initials(c.name) });
        var kids = [face, h('span', { class: 'cn', style: 'font-size:14px;font-weight:600', text: c.name }), h('span', { class: 'note', text: [c.role || '', isTv(m) ? epText(c.episodes) : '', isTv(m) ? c.year || '' : ''].filter(Boolean).join(' · ') })];
        return pk ? h('a', { class: 'cp', href: personUrl(c.name), 'aria-label': c.name + (c.role ? ', ' + c.role : '') + ' — see all titles' }, kids) : h('div', {}, kids);
      })) : h('div', { class: 'note', text: 'Cast and crew not added yet.' })]);
  }
  function actionBlock(m, rel, ott) {
    var d = m.data;
    if (ott) return h('section', { class: 'card', id: 'watch' }, [h('h2', { text: 'Where to watch' }),
      h('div', { class: 'person' }, [h('span', { class: 'c', style: 'width:44px;height:44px;border-radius:10px;background:var(--accent);color:#0B0A0F;display:flex;align-items:center;justify-content:center;font-weight:800', text: (d.platform || 'OTT').slice(0, 2).toUpperCase() }),
        h('span', { class: 'nmx' }, [h('div', { text: d.platform || 'Streaming service' }), h('div', { class: 'note', text: rel ? 'Streaming now · included with subscription' : 'Streams from ' + fmtDate(d.releaseDate, true) })])]),
      h('button', { type: 'button', class: 'btn primary', disabled: true, text: rel ? 'Watch on ' + (d.platform || 'OTT') : 'Not streaming yet' }),
      h('div', { class: 'note', text: 'Deep links go live once the platform partnership is in place.' })]);
    if (isOld(m) || isTv(m)) return h('section', { class: 'card', id: 'watch' }, [h('h2', { text: 'Where to watch' }),
      d.platform ? h('div', { class: 'person' }, [h('span', { class: 'c', style: 'width:44px;height:44px;border-radius:10px;background:var(--accent);color:#0B0A0F;display:flex;align-items:center;justify-content:center;font-weight:800', text: d.platform.slice(0, 2).toUpperCase() }),
        h('span', { class: 'nmx' }, [h('div', { text: d.platform }), h('div', { class: 'note', text: isTv(m) ? (d.endYear ? 'Aired ' + tvYears(d) : 'Running now') : 'Streaming now' })])]) : h('div', { class: 'note', text: isTv(m) ? 'Where to watch will show here once added.' : 'No longer in theatres. Streaming details will show here once added.' }),
      d.platform ? h('button', { type: 'button', class: 'btn primary', disabled: true, text: 'Watch on ' + d.platform }) : null]);
    return null; // ticket booking hidden until a ticketing partner is integrated
    var fm = (d.formats || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    return h('section', { class: 'card', id: 'watch' }, [h('h2', { text: rel ? 'Book tickets' : 'Advance booking' }),
      h('div', { class: 'field' }, [h('label', { class: 'l', for: 'city', text: 'City' }), h('select', { class: 'in', id: 'city' }, ['Bengaluru', 'Mumbai', 'Delhi NCR', 'Hyderabad', 'Chennai', 'Kolkata', 'Pune'].map(function (c) { return h('option', { text: c }); }))]),
      fm.length ? h('div', { class: 'chips' }, fm.map(function (f, i) { return h('span', { class: 'chip', style: 'display:inline-flex;align-items:center;cursor:default', text: f }); })) : null,
      h('div', { class: 'note', text: 'Showtimes and seats come from the ticketing partner once it’s connected.' }),
      h('button', { type: 'button', class: 'btn primary', disabled: true, text: 'See showtimes' })]);
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
    var d = m.data, rows = isTv(m) ? [['First aired', d.releaseDate ? fmtDate(d.releaseDate, true) : ''], ['Years', tvYears(d)], ['Channel or platform', d.platform], ['Seasons', d.seasons], ['Languages', d.languages], ['Genre', d.genre], ['Episode length', d.runtime], ['Certificate', d.certificate], ['Created by', d.director]] : [[isOtt(m) ? 'Streaming from' : 'Release date', fmtDate(d.releaseDate, true) + (d.releaseNote ? ' (' + d.releaseNote.toLowerCase() + ')' : '')], ['Platform', isOtt(m) ? d.platform : ''], ['Languages', d.languages], ['Genre', d.genre], ['Runtime', d.runtime], ['Certificate', d.certificate], ['Director', d.director]];
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
  // ---------- people (cast & crew pages: /person/<name>) ----------
  var CREW_RE = /(director|producer|music|writer|screenplay|composer|cinematograph|editor)/i;
  function personSlug(name) { return String(name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80); }
  function personUrl(name) { return '/person/' + personSlug(name); }
  function personPhotoUrl(name, w) { var p = S.people[personSlug(name)]; return p && safeUrl(p.photoUrl) ? cld(p.photoUrl, w || 320) : ''; }
  function initials(name) { var w = String(name || '?').replace(/\./g, '').split(/\s+/).filter(Boolean); if (!w.length) return '?'; return (w[0][0] + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase(); }
  function creditsOf(slug) {
    var out = [];
    S.movies.forEach(function (m) {
      (m.data.cast || []).forEach(function (c) { if (personSlug(c.name) === slug) out.push({ m: m, name: c.name, role: c.role || '', crew: CREW_RE.test(c.role || ''), episodes: c.episodes || '', year: c.year || '' }); });
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
    document.title = personTitleTag(name);
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
    v.appendChild(h('a', { href: '/people', style: 'display:inline-block;margin:24px 40px 0;color:var(--muted);font-weight:600;font-size:14px;text-decoration:none', on: { click: function (e) { if (history.length > 1) { e.preventDefault(); history.back(); } else { e.preventDefault(); go('/'); } } }, text: '← Back' }));
    v.appendChild(h('section', { class: 'ph' }, [
      photo ? h('img', { class: 'pimg', src: photo, alt: name }) : h('span', { class: 'pini', style: 'background:' + PAL[hash(slug) % PAL.length][1], 'aria-hidden': 'true', text: initials(name) }),
      h('div', { style: 'min-width:0;flex:1' }, [
        h('div', { class: 'kicker', text: 'Known for · ' + known }),
        h('h1', { class: 'display', style: 'font-size:clamp(36px,5vw,64px);margin-top:6px', text: name }),
        stored && stored.bio ? h('p', { class: 'lede', style: 'margin:10px 0 0;max-width:720px', text: stored.bio }) : null,
        personFacts(stored),
        h('div', { class: 'facts2' }, [
          h('span', { class: 'tag', text: titles.length + (titles.length === 1 ? ' title' : ' titles') + ' on Reelscore' }),
          upcoming ? h('span', { class: 'tag hot', text: upcoming + ' upcoming' }) : null,
          years.length ? h('span', { class: 'tag', text: years[0] === years[years.length - 1] ? years[0] : years[0] + '–' + years[years.length - 1] }) : null
        ])
      ])
    ]));
    function section(title, list) {
      if (!list.length) return null;
      return h('section', { class: 'wrapx', style: 'padding-top:20px;padding-bottom:0' }, [
        h('h2', { style: 'margin:0 0 14px;font-size:22px', text: title + ' (' + list.length + ')' }),
        h('div', { class: 'grid-posters' }, list.map(function (t) {
          var card = posterCard(t.m, t.m.data.section === 'Coming soon' ? { dateBadge: true } : null);
          var r = title === 'Upcoming' || title === 'TV shows' ? t.roles : t.roles.filter(function (x) { return title === 'Acting' ? !CREW_RE.test(x) : CREW_RE.test(x); });
          var ch = r.filter(function (x) { return !CREW_RE.test(x); }), cr = r.filter(function (x) { return CREW_RE.test(x); });
          var label = title === 'TV shows' ? [ch.length ? 'as ' + ch.join(' · ') : '', cr.join(' · '), t.eps ? epText(t.eps) : '', t.yrs.slice().sort().join(', ')].filter(Boolean).join(' · ') : title === 'Acting' ? 'as ' + r.join(' · ') : title === 'Upcoming' ? (ch.length ? 'as ' + ch.join(' · ') : '') + (ch.length && cr.length ? ' · ' : '') + cr.join(' · ') : r.join(' · ');
          if (label) card.appendChild(h('span', { class: 'pcrole', text: label }));
          return card;
        }))
      ]);
    }
    // About, Known for and Frequent collaborators (app/about.js; the pre-rendered page uses the same text and picks).
    if (window.RS_ABOUT) {
      var facts = titles.map(function (t) { return { m: t.m, title: t.m.data.title, year: when(t).slice(0, 4), date: t.m.data.releaseDate || '', languages: t.m.data.languages, genre: t.m.data.genre,
        tv: t.tv, acting: t.acting, crew: t.crew, roles: t.roles, synopsis: t.m.data.synopsis || '', upcoming: !t.tv && isUpcoming(t.m) }; });
      var collab = RS_ABOUT.collaborators(slug, titles.map(function (t) { return t.m.data; }), personSlug);
      var kf = RS_ABOUT.knownFor(facts);
      var cw = collab.directors.map(function (x) { return [x, 'director']; }).concat(collab.costars.slice(0, 6).map(function (x) { return [x, 'co-star']; }));
      v.appendChild(h('section', { class: 'wrapx pabout', style: 'padding-top:20px;padding-bottom:0' }, [
        h('h2', { style: 'margin:0 0 10px;font-size:22px', text: 'About ' + name }),
        h('p', { class: 'about', text: RS_ABOUT.person({ name: name, titles: facts, collab: collab }) }),
        kf.length ? h('h3', { text: 'Known for' }) : null,
        kf.length ? h('ul', { class: 'kfor' }, kf.map(function (k) { return h('li', {}, [h('a', { href: movieUrl(k.t.m), text: k.t.title }), ' ', h('span', { class: 'note', text: k.t.year }), ' – ' + k.line]); })) : null,
        cw.length ? h('h3', { text: 'Frequent collaborators' }) : null,
        cw.length ? h('div', { class: 'collab' }, cw.map(function (p) { return h('a', { class: 'tag', href: personUrl(p[0].name), text: p[0].name + ' · ' + p[1] + ' · ' + p[0].n }); })) : null
      ]));
    }
    // Unreleased titles first, in their own section (soonest first; undated last), then released work.
    var films = titles.filter(function (t) { return !t.tv; }), tv = titles.filter(function (t) { return t.tv; });
    var soon = films.filter(function (t) { return isUpcoming(t.m); }).sort(function (a, b) { return (a.m.data.releaseDate || '9999').localeCompare(b.m.data.releaseDate || '9999'); });
    var out = films.filter(function (t) { return !isUpcoming(t.m); });
    v.appendChild(section('Upcoming', soon) || h('span'));
    acting = out.filter(function (t) { return t.acting; }); crew = out.filter(function (t) { return t.crew; });
    v.appendChild(section('Acting', acting) || h('span'));
    v.appendChild(section('TV shows', tv) || h('span'));
    v.appendChild(section(acting.length ? 'Behind the camera' : 'Credits', crew) || h('span'));
    v.appendChild(h('div', { style: 'height:40px' }));
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
    var all = peopleDirectory().filter(function (p) { return p.titles.some(inNavLang); });
    var langs = {}; all.forEach(function (p) { Object.keys(p.langs).forEach(function (l) { langs[l] = 1; }); });
    if (P.lang && !langs[P.lang]) P.lang = '';
    // Popular = people pinned in admin, then the top automatic picks up to 120; people hidden in admin never show.
    var pinned = all.filter(function (p) { return p.pin === 'pin'; });
    var auto = all.filter(function (p) { return !p.pin; }).sort(function (a, b) { return b.pop - a.pop; }).slice(0, Math.max(0, 120 - pinned.length));
    var popSet = {}; pinned.concat(auto).forEach(function (p) { popSet[p.slug] = 1; });
    w.appendChild(h('div', { class: 'chips', role: 'group', 'aria-label': 'Show', style: 'margin-bottom:14px' }, ['Popular', 'Male actors', 'Female actors', 'Acting', 'All', 'Behind the camera'].map(function (r) {
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
      var PER = 60, pages = Math.max(1, Math.ceil(list.length / PER));
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

  function drawBrowse() {
    var v = $('view-browse');
    if (!S.loaded && v.querySelector('[data-prerendered]')) return;
    v.innerHTML = '';
    var w = h('div', { class: 'wrapx' }); v.appendChild(w);
    var B = S.browse;
    w.appendChild(h('h1', { class: 'display', style: 'font-size:44px;margin-bottom:6px', text: 'Browse' }));
    w.appendChild(h('div', { class: 'sub', style: 'margin-bottom:18px', text: 'Every film and series on Reelscore, from 2025–26 releases to what’s coming next.' }));
    var statuses = ['All', 'In theatres', 'Coming soon', 'On OTT', 'Older releases', 'TV shows'];
    w.appendChild(h('div', { class: 'chips', role: 'group', 'aria-label': 'Status', style: 'margin-bottom:14px' }, statuses.map(function (st) {
      return h('a', { class: 'chip', href: browseHref({ status: st, lang: B.lang, genre: B.genre, year: B.year }, 1), 'aria-current': B.status === st ? 'page' : null, 'aria-pressed': String(B.status === st), text: st });
    })));
    var langs = {}, years = {};
    S.movies.forEach(function (m) { var l = langOf(m.data); if (l) langs[l] = 1; if (m.data.releaseDate) years[m.data.releaseDate.slice(0, 4)] = 1; });
    function sel(id, label, val, opts, onc) {
      var e = h('select', { class: 'in', id: id }, opts.map(function (o) { return h('option', { value: o[0], text: o[1], selected: o[0] === val }); }));
      e.addEventListener('change', function () { onc(e.value); B.page = 1; e.blur(); render(true); });
      return h('div', { class: 'field', style: 'min-width:160px;flex:1 1 160px' }, [h('label', { class: 'l', for: id, text: label }), e]);
    }
    w.appendChild(h('div', { style: 'display:flex;flex-wrap:wrap;gap:12px;margin-bottom:22px' }, [
      sel('bLang', 'Language', B.lang, [['', 'All languages']].concat(Object.keys(langs).sort().map(function (l) { return [l, l]; })), function (x) { B.lang = x; }),
      sel('bGenre', 'Genre', B.genre, [['', 'All genres']].concat(GENRES.map(function (g) { return [g, g]; })), function (x) { B.genre = x; }),
      sel('bYear', 'Year', B.year, [['', 'Any year']].concat(Object.keys(years).sort().reverse().map(function (y) { return [y, y]; })), function (x) { B.year = x; }),
      sel('bSort', 'Sort by', B.sort, [['new', 'Newest first'], ['old', 'Oldest first'], ['score', 'Highest score'], ['votes', 'Most verdicts'], ['az', 'A–Z']], function (x) { B.sort = x; })
    ]));
    var list = S.movies.filter(function (m) {
      var d = m.data;
      if (B.status !== 'All' && d.section !== B.status) return false;
      if (B.lang && langOf(d) !== B.lang) return false;
      if (!inNavLang(m)) return false;
      if (B.genre && genreTags(d).indexOf(B.genre) === -1) return false;
      if (B.year && (d.releaseDate || '').slice(0, 4) !== B.year) return false;
      return true;
    });
    var sc = {}; list.forEach(function (m) { sc[m.id] = score(m.id); });
    list.sort(function (a, b) {
      var A = a.data, Bd = b.data;
      if (B.sort === 'old') return (A.releaseDate || '9').localeCompare(Bd.releaseDate || '9');
      if (B.sort === 'score') return (sc[b.id].pct === null ? -1 : sc[b.id].pct) - (sc[a.id].pct === null ? -1 : sc[a.id].pct) || sc[b.id].tot - sc[a.id].tot;
      if (B.sort === 'votes') return sc[b.id].tot - sc[a.id].tot;
      if (B.sort === 'az') return (A.title || '').localeCompare(Bd.title || '');
      return (Bd.releaseDate || '').localeCompare(A.releaseDate || '');
    });
    var active = (B.status !== 'All') + !!B.lang + !!B.genre + !!B.year;
    w.appendChild(h('div', { style: 'display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-bottom:16px' }, [
      h('span', { class: 'sub', text: list.length > 60 ? 'Showing ' + ((Math.min(B.page || 1, Math.ceil(list.length / 60)) - 1) * 60 + 1) + '–' + Math.min(Math.min(B.page || 1, Math.ceil(list.length / 60)) * 60, list.length) + ' of ' + list.length.toLocaleString('en-IN') + ' titles' : list.length + (list.length === 1 ? ' title' : ' titles') }),
      active ? h('button', { type: 'button', class: 'btn small ghost', text: 'Clear filters', on: { click: function () { S.browse = { status: 'All', lang: '', genre: '', year: '', sort: B.sort, page: 1 }; render(true); } } }) : null
    ]));
    if (!S.loaded) { w.appendChild(h('div', { class: 'empty', text: 'Loading…' })); return; }
    if (!list.length) { w.appendChild(h('div', { class: 'empty', text: 'Nothing matches these filters.' })); return; }
    var PER = 60, pages = Math.ceil(list.length / PER); B.page = Math.min(Math.max(1, B.page || 1), pages);
    syncListUrl(browseHref(B, B.page));
    var from = (B.page - 1) * PER;
    w.appendChild(h('div', { class: 'grid-posters' }, list.slice(from, from + PER).map(function (m) { return posterCard(m, m.data.section === 'Coming soon' ? { dateBadge: true, remind: true } : null); })));
    if (pages > 1) w.appendChild(pagerNav(B.page, pages, function (n) { return browseHref(B, n); }));
  }
  // Page links are real <a href> so crawlers can reach every page; the site's link handler keeps them in-app.
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

  // ---------- my list & friends ----------
  function drawList() {
    var v = $('view-list'); v.innerHTML = '';
    var w = h('div', { class: 'wrapx' }); v.appendChild(w);
    w.appendChild(h('h1', { class: 'display', style: 'font-size:44px;margin-bottom:18px', text: 'My List' }));
    if (!S.uid) { w.appendChild(h('div', { class: 'empty', text: 'Sign in with Google to keep a list and follow people.' })); return; }
    var mine = S.mine.watchlist.map(function (id) { return S.byId[id]; }).filter(Boolean);
    w.appendChild(h('section', { class: 'card' }, [h('h2', { text: 'My list (' + mine.length + ')' }),
      mine.length ? h('div', { class: 'grid-posters' }, mine.map(function (m) { return posterCard(m, released(m) ? null : { dateBadge: true, remind: true }); })) : h('div', { class: 'note', text: 'Nothing yet. Tap + on any poster to add it.' })]));
    var rem = (S.mine.reminders || []).map(function (id) { return S.byId[id]; }).filter(Boolean).sort(function (a, b) { return (a.data.releaseDate || '').localeCompare(b.data.releaseDate || ''); });
    w.appendChild(h('section', { class: 'card' }, [h('h2', { text: 'Release reminders (' + rem.length + ')' }),
      rem.length ? h('div', { class: 'grid-posters' }, rem.map(function (m) { return posterCard(m, { dateBadge: true, remind: true }); })) : h('div', { class: 'note', text: 'Tap Remind me on anything coming soon to get a nudge on release day.' })]));
    var myV = S.verdicts[S.uid] ? Object.keys(S.verdicts[S.uid].v || {}).filter(function (id) { return S.byId[id]; }) : [];
    w.appendChild(h('section', { class: 'card' }, [h('h2', { text: 'Your verdicts (' + myV.length + ')' }),
      myV.length ? h('div', { class: 'people' }, myV.map(function (id) {
        var m = S.byId[id], vv = S.verdicts[S.uid].v[id], lab = vset(m).filter(function (x) { return x[0] === vv; })[0];
        return h('a', { class: 'person', href: movieUrl(S.byId[id] || id), style: 'color:var(--text);text-decoration:none' }, [h('span', { class: 'nmx', text: m.data.title }), lab ? h('span', { class: 'vtag', style: 'background:' + VCOL[vv], text: lab[1].toUpperCase() }) : null]);
      })) : h('div', { class: 'note', text: 'You haven’t rated anything yet.' })]));

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
    if (!hit.length && !ppl.length) res.appendChild(h('div', { class: 'note', style: 'padding:10px', text: 'No titles or people match.' }));
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
  function adminDom() {
    var t = $('adminTpl'); if (t) { t.parentNode.appendChild(t.content); t.remove(); }
  }
  function loadAdminCode(done) {
    if (window.ReelAdmin) return done();
    var sc = document.createElement('script'); sc.src = '/app/admin.js';
    sc.onload = done; sc.onerror = function () { S.adminStarted = false; toast('Couldn’t load the admin tools. Reload to retry.'); };
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
  function fixSection(d) { if (d.section === 'Releasing this week') { d = clone(d); d.section = 'In theatres'; } return d; }
  function setMovies(list) {
    S.movies = list.map(function (m) { return { id: m.id, data: fixSection(m.data) }; })
      .sort(function (a, b) { return (+a.data.order || 0) - (+b.data.order || 0); });
    S.byId = {}; S.movies.forEach(function (m) { S.byId[m.id] = m; });
    S.hasCat = true; syncLoaded(); render();
  }
  function loadAllFromFirestore(db) {
    db.collection('movies').orderBy('order').onSnapshot(function (snap) {
      if (!snap.metadata.fromCache) clearTimeout(timer);
      setMovies(snap.docs.map(function (s) { return { id: s.id, data: s.data() }; }));
    }, function () { clearTimeout(timer); S.hasCat = true; S.partial = false; S.loaded = true; S.loadMsg = 'Lost connection to the catalogue. Reload to retry.'; render(true); });
    db.collection('people').onSnapshot(function (snap) {
      var o = {}; snap.docs.forEach(function (d) { o[d.id] = d.data(); }); S.people = o; if (S.route === 'title' || S.route === 'person' || S.route === 'people') render();
    }, function () {});
  }
  function getJson(u) { return window.fetch(u).then(function (r) { if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); }); }
  // The catalogue comes in two parts: a small core (every section except Older releases, plus people) that the home page
  // needs first, and the much larger Older releases part, fetched right after the home page has drawn (or at once on
  // any other page). Pages built before the split only know the single full file.
  function loadCatalogue(db) {
    var split = !!(window.RS_CAT_CORE && window.RS_CAT_OLD && window.fetch), olderP = null;
    function older() { if (!olderP) olderP = getJson(window.RS_CAT_OLD); return olderP; }
    if (split && S.route !== 'home') older();
    var f = !window.fetch ? Promise.reject() : split ? getJson(window.RS_CAT_CORE)
      : (window.RS_CAT ? getJson(window.RS_CAT) : window.fetch('/catalogue.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('catalogue ' + r.status); return r.json(); }));
    f.then(function (cat) {
      if (!cat || !Array.isArray(cat.movies) || !cat.builtAt) throw new Error('bad catalogue');
      clearTimeout(timer);
      S.partial = split;
      // An hour of overlap covers admins whose clocks run a little behind.
      var since = new Date(Date.parse(cat.builtAt) - 3600 * 1000).toISOString();
      var base = {}, baseP = cat.people || {}, dm = {}, dp = {}, goneM = {}, goneP = {}, tomb = { movies: {}, people: {} };
      cat.movies.forEach(function (m) { base[m.id] = m.data; });
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
      apply();
      if (split) {
        var addOlder = function () {
          older().then(function (o) {
            (o && o.movies || []).forEach(function (m) { if (!(m.id in base)) base[m.id] = m.data; });
            S.partial = false; apply();
          }).catch(function () {
            getJson(window.RS_CAT || '/catalogue.json').then(function (full) {
              (full && full.movies || []).forEach(function (m) { if (!(m.id in base)) base[m.id] = m.data; });
              S.partial = false; apply();
            }).catch(function () { loadAllFromFirestore(db); });
          });
        };
        S.kickOlder = function () { S.kickOlder = null; addOlder(); };
        if (S.route === 'home') { var kick = function () { if (S.kickOlder) S.kickOlder(); }; if (window.requestIdleCallback) requestIdleCallback(kick, { timeout: 2500 }); else setTimeout(kick, 1200); }
        else S.kickOlder();
      }
      db.collection('movies').where('updatedAt', '>', since).onSnapshot(track(dm, goneM), function () {});
      db.collection('people').where('updatedAt', '>', since).onSnapshot(track(dp, goneP), function () {});
      db.doc('settings/deleted').onSnapshot(function (snap) {
        var d = snap.exists ? snap.data() : {}; tomb = { movies: {}, people: {} };
        ['movies', 'people'].forEach(function (k) { (d[k] || []).forEach(function (x) { if (x && x.id) tomb[k][x.id] = x.at || ''; }); });
        apply();
      }, function () {});
    }).catch(function () { loadAllFromFirestore(db); });
  }

  var cl = window.claude;
  if (!cl || typeof cl.use !== 'function') { clearTimeout(timer); S.loadMsg = 'Couldn’t start. Check firebase-config.js.'; render(true); return; }
  cl.use('user').then(function (u) {
    S.user = u;
    if (!u) return;
    return u.me().then(function (me) {
      S.uid = me.id; S.canEdit = !!me.canEdit;
      if (S.canEdit) { $('adminLink').hidden = false; $('adminLink').setAttribute('href', '/admin'); }
      var av = $('meAvatar'); if (me.avatarUrl) { av.src = me.avatarUrl; av.alt = me.name || 'You'; av.hidden = false; }
    });
  }).catch(function () {}).then(function () {
    return cl.use('assets').then(function (a) { S.assets = a; }).catch(function () {});
  }).then(function () { return cl.use('db'); }).then(function (db) {
    S.db = db;
    if (!db) { clearTimeout(timer); S.loadMsg = 'Couldn’t connect to the catalogue. Check firebase-config.js.'; render(true); return; }
    if (S.route === 'admin') startAdmin();
    loadCatalogue(db);
    db.collection('verdicts').onSnapshot(function (snap) {
      var o = {}; snap.docs.forEach(function (s) { o[s.id] = s.data(); });
      if (S.uid && writing.v && S.verdicts[S.uid]) o[S.uid] = S.verdicts[S.uid];
      S.verdicts = o; render();
    }, function () {});
    db.doc('settings/home').onSnapshot(function (snap) {
      var d = snap.exists ? snap.data() : {};
      S.featured = Array.isArray(d.featured) ? d.featured.filter(function (x) { return typeof x === 'string'; }) : [];
      S.slide = 0; render();
    }, function () {});
    db.doc('settings/popular').onSnapshot(function (snap) {
      var d = snap.exists ? snap.data() : {};
      S.popOrder = Array.isArray(d.order) ? d.order.filter(function (x) { return typeof x === 'string'; }) : [];
      if (S.route === 'people') render();
    }, function () {});
    db.collection('reviews').onSnapshot(function (snap) {
      var o = {}; snap.docs.forEach(function (s) { o[s.id] = s.data(); });
      if (S.uid && writing.r && S.reviews[S.uid]) o[S.uid] = S.reviews[S.uid];
      S.reviews = o; render();
    }, function () {});
    if (S.uid) db.doc('data/users/' + S.uid + '/profile').onSnapshot(function (snap) {
      if (writing.m) return;
      var d = snap.exists ? snap.data() : {};
      S.mine = { watchlist: (d.watchlist || []).slice(), following: (d.following || []).slice(), reminders: (d.reminders || []).slice() };
      S.mineLoaded = true; render();
    }, function () {});
  }).catch(function () { clearTimeout(timer); S.loadMsg = 'The catalogue is unavailable in this view.'; render(true); });
})();
