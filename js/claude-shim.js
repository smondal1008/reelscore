// Loads before the app. The app was written against a small capability API:
//   window.claude.use('db' | 'assets' | 'user')  →  Promise<namespace | null>
// js/firebase-adapter.js fills these in with Firebase once it has loaded.
(function () {
  var resolveReady;
  var ready = new Promise(function (r) { resolveReady = r; });
  window.__reelProvide = function (caps) { resolveReady(caps || {}); };
  window.claude = {
    use: function (name) {
      return ready.then(function (caps) { return caps[name] || null; });
    }
  };
  // If Firebase never loads (bad config, offline), fail open so the page shows its own message.
  // Firebase now starts after the page has settled (js/firebase-adapter.js), so the clock starts when it does.
  window.__reelFailOpen = function () { setTimeout(function () { resolveReady({}); }, 12000); };
})();
// Web fonts: the font CSS is preloaded in index.html and switched on here (no inline onload; see the CSP in vercel.json).
(function () { var l = document.getElementById('fontcss'); if (l) l.rel = 'stylesheet'; })();
