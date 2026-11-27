// Firebase adapter: gives the app the same db / assets / user API it used as a prototype,
// backed by Firestore + Firebase Auth (Google sign-in) on the free Spark plan, and Cloudinary (free) for media.
const V = '10.14.1';
const base = 'https://www.gstatic.com/firebasejs/' + V + '/';

const cfg = window.REEL_FIREBASE_CONFIG || {};
// Firebase (about 1 MB) is not needed to show a page: the page and catalogue come from the CDN. So it starts at once only
// for signed-in visitors and the admin panel, and for everyone else on their first tap, key, or scroll, or a few seconds
// after the page has loaded, whichever comes first. Sign-in starts it too.
const AUTH_FLAG = 'rs_auth';
const flagged = () => { try { return localStorage.getItem(AUTH_FLAG) === '1'; } catch (e) { return false; } };
const setFlag = (on) => { try { if (on) localStorage.setItem(AUTH_FLAG, '1'); else localStorage.removeItem(AUTH_FLAG); } catch (e) {} };
let started = null, signInReady = null;
const signInWhenReady = new Promise((res) => { signInReady = res; });
function go() {
  if (started) return started;
  if (window.__reelFailOpen) window.__reelFailOpen();
  if (!cfg.apiKey || /PASTE/.test(cfg.apiKey)) {
    console.error('Reelscore: fill in firebase-config.js');
    window.__reelProvide({});
    started = Promise.resolve();
  } else {
    started = start().catch((e) => { console.error('Reelscore: Firebase failed to start', e); window.__reelProvide({}); });
  }
  return started;
}
window.__reelStartFirebase = go;
// Until Firebase is in, sign-in starts it and then signs in (a popup, or a redirect if the browser blocks it).
window.reelSignIn = async () => { setFlag(true); go(); const real = await signInWhenReady; if (real) return real(); };
if (/^\/admin(\/|$)/.test(location.pathname) || flagged()) go();
else {
  const evs = ['pointerdown', 'keydown', 'touchstart', 'scroll', 'wheel'];
  const kick = () => { evs.forEach((e) => window.removeEventListener(e, kick, true)); go(); };
  evs.forEach((e) => window.addEventListener(e, kick, { capture: true, passive: true }));
  const later = () => setTimeout(() => { if (window.requestIdleCallback) requestIdleCallback(kick, { timeout: 2000 }); else kick(); }, 6000);
  if (document.readyState === 'complete') later(); else window.addEventListener('load', later, { once: true });
}

async function start() {
  const [{ initializeApp }, A, F] = await Promise.all([
    import(base + 'firebase-app.js'),
    import(base + 'firebase-auth.js'),
    import(base + 'firebase-firestore.js')
  ]);

  const app = initializeApp(cfg);
  const auth = A.getAuth(app);
  const fs = F.initializeFirestore(app, { ignoreUndefinedProperties: true });

  // ---- wait for the first auth state ----
  const user = await new Promise((res) => {
    let first = true;
    A.onAuthStateChanged(auth, (u) => {
      if (first) { first = false; setFlag(!!u); res(u); return; }
      location.reload(); // signed in or out after load: simplest way to resubscribe everything
    });
  });

  // ---- error codes the app understands ----
  const mapErr = (e) => {
    const err = new Error((e && e.message) || 'Request failed');
    const c = (e && e.code) || '';
    err.code = /permission-denied/.test(c) ? 'invalid_argument'
      : /resource-exhausted|quota-exceeded/.test(c) ? 'quota_exceeded'
      : c;
    return err;
  };
  const wrapP = (p) => p.catch((e) => { throw mapErr(e); });

  // ---- db ----
  const wrapDocSnap = (s) => ({
    id: s.id,
    exists: s.exists(),
    data: () => s.data(),
    metadata: { fromCache: s.metadata.fromCache, hasPendingWrites: s.metadata.hasPendingWrites }
  });
  const wrapQuerySnap = (qs) => {
    const docs = qs.docs.map(wrapDocSnap);
    return {
      docs, size: docs.length, empty: docs.length === 0,
      metadata: { fromCache: qs.metadata.fromCache, hasPendingWrites: qs.metadata.hasPendingWrites },
      forEach: (fn) => docs.forEach(fn),
      docChanges: () => qs.docChanges().map((c) => ({ type: c.type, doc: wrapDocSnap(c.doc), oldIndex: c.oldIndex, newIndex: c.newIndex }))
    };
  };
  const clean = (v) => JSON.parse(JSON.stringify(v)); // plain JSON, like the prototype store

  function docApi(path) {
    const ref = F.doc(fs, path);
    return {
      id: ref.id, path,
      get: () => wrapP(F.getDoc(ref)).then(wrapDocSnap),
      set: (data, opts) => wrapP(F.setDoc(ref, clean(data), opts && opts.merge ? { merge: true } : {})),
      update: (data) => wrapP(F.updateDoc(ref, clean(data))),
      // Item-by-item changes to list fields, in one atomic write: [{ field, add: [...], remove: [...] }, { field, value }].
      // Adding or removing one title never rewrites the rest of the list. Creates the document if it doesn't exist.
      edit: (changes) => {
        const b = F.writeBatch(fs); let n = 0;
        (changes || []).forEach((c) => {
          if (Array.isArray(c.add) && c.add.length) { b.set(ref, { [c.field]: F.arrayUnion(...clean(c.add)) }, { merge: true }); n++; }
          if (Array.isArray(c.remove) && c.remove.length) { b.set(ref, { [c.field]: F.arrayRemove(...clean(c.remove)) }, { merge: true }); n++; }
          if ('value' in c) { b.set(ref, { [c.field]: clean(c.value) }, { merge: true }); n++; }
        });
        return n ? wrapP(b.commit()) : Promise.resolve();
      },
      delete: () => wrapP(F.deleteDoc(ref)),
      onSnapshot: (next, error) => F.onSnapshot(ref, (s) => next(wrapDocSnap(s)), (e) => error && error(mapErr(e)))
    };
  }
  function queryApi(path, constraints) {
    const build = () => F.query(F.collection(fs, path), ...constraints);
    return {
      orderBy: (field, dir) => queryApi(path, constraints.concat(F.orderBy(field, dir === 'desc' ? 'desc' : 'asc'))),
      where: (f, op, v) => queryApi(path, constraints.concat(F.where(f, op, v))),
      limit: (n) => queryApi(path, constraints.concat(F.limit(n))),
      get: () => wrapP(F.getDocs(build())).then(wrapQuerySnap),
      onSnapshot: (next, error) => F.onSnapshot(build(), (qs) => next(wrapQuerySnap(qs)), (e) => error && error(mapErr(e))),
      doc: (id) => docApi(path + '/' + id)
    };
  }
  const db = Object.freeze({ doc: docApi, collection: (path) => queryApi(path, []) });

  // ---- user ----
  let isAdmin = false;
  if (user) {
    try { isAdmin = (await F.getDoc(F.doc(fs, 'admins/' + user.uid))).exists(); } catch (e) { isAdmin = false; }
    // Public profile so friends can find and follow each other.
    F.setDoc(F.doc(fs, 'users/' + user.uid), {
      name: user.displayName || 'Someone',
      avatarUrl: user.photoURL || '',
      updatedAt: new Date().toISOString()
    }, { merge: true }).catch(() => {});
  }
  const profileCache = {};
  const userNs = !user ? null : Object.freeze({
    // Used only to fill in the email box of the feedback form (the person can change it before sending).
    email: user.email || '', displayName: user.displayName || '',
    me: async () => ({ id: user.uid, name: user.displayName || 'You', avatarUrl: user.photoURL || '', canEdit: isAdmin }),
    canEdit: async () => isAdmin,
    can: async (what) => (what === 'data.write' ? true : isAdmin),
    profiles: async (ids) => {
      const out = {};
      await Promise.all((ids || []).map(async (id) => {
        if (!profileCache[id]) {
          try {
            const s = await F.getDoc(F.doc(fs, 'users/' + id));
            profileCache[id] = s.exists() ? { id, name: s.data().name || 'Someone', avatarUrl: s.data().avatarUrl || '' } : { id, name: 'Someone', avatarUrl: '' };
          } catch (e) { profileCache[id] = { id, name: 'Someone', avatarUrl: '' }; }
        }
        out[id] = profileCache[id];
      }));
      return out;
    },
    search: async (q) => {
      const qs = await F.getDocs(F.query(F.collection(fs, 'users'), F.limit(300)));
      const term = String(q || '').trim().toLowerCase();
      return qs.docs
        .map((s) => ({ id: s.id, name: s.data().name || 'Someone', avatarUrl: s.data().avatarUrl || '', isMe: s.id === user.uid }))
        .filter((p) => !term || p.name.toLowerCase().includes(term))
        .slice(0, 30);
    }
  });

  // ---- assets (admin uploads: posters, banners, clips, cast photos) ----
  // Files go to your free Cloudinary account. The upload settings live in Firestore at
  // private/media { cloudName, uploadPreset }, which only admins can read (see README).
  let mediaCfg = null;
  const assets = !user ? null : Object.freeze({
    upload: async (file) => {
      if (!mediaCfg) {
        const s = await F.getDoc(F.doc(fs, 'private/media')).catch(() => null);
        mediaCfg = s && s.exists() ? s.data() : null;
      }
      if (!mediaCfg || !mediaCfg.cloudName || !mediaCfg.uploadPreset) {
        const e = new Error('Media uploads are not set up. Add private/media in Firestore (README step 4).'); e.code = 'not_configured';
        alert(e.message); throw e;
      }
      const body = new FormData();
      body.append('file', file);
      body.append('upload_preset', mediaCfg.uploadPreset);
      const res = await fetch('https://api.cloudinary.com/v1_1/' + encodeURIComponent(mediaCfg.cloudName) + '/auto/upload', { method: 'POST', body });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.secure_url) {
        const e = new Error((out.error && out.error.message) || 'Upload failed'); e.code = 'upload_failed';
        alert('Upload failed: ' + e.message); throw e;
      }
      return { id: out.public_id, url: out.secure_url };
    }
  });

  // ---- sign-in / sign-out control in the header ----
  const realSignIn = async () => {
    setFlag(true);
    const p = new A.GoogleAuthProvider();
    try { await A.signInWithPopup(auth, p); }
    catch (e) { if (/popup-blocked|operation-not-supported/.test(e.code || '')) await A.signInWithRedirect(auth, p); else console.warn(e); }
  };
  window.reelSignIn = realSignIn; signInReady(realSignIn);
  window.reelSignOut = () => { setFlag(false); return A.signOut(auth); };
  // The Sign in button usually went up before Firebase loaded (below): signed in, it goes; signed out after all, it comes back.
  if (user) { const b = document.getElementById('authBtn'); if (b) b.remove(); } else mountAuthUi();

  window.__reelProvide({ db, assets, user: userNs });
}

// Signed out: a Sign in button, shown at once (it starts Firebase when tapped). Signed in: the profile picture opens a menu
// with Sign out (app/main.js). Visitors we know are signed in get no button; the menu appears once Firebase is in.
const mountAuthUi = () => {
  const navr = document.querySelector('.navr');
  if (!navr || document.getElementById('authBtn') || flagged()) return;
  const b = document.createElement('button');
  b.type = 'button'; b.id = 'authBtn'; b.className = 'authbtn';
  b.textContent = 'Sign in';
  b.addEventListener('click', () => { window.reelSignIn(); });
  navr.appendChild(b);
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountAuthUi); else mountAuthUi();
