// Firebase adapter: gives the app the same db / assets / user API it used as a prototype,
// backed by Firestore + Firebase Auth (Google sign-in) on the free Spark plan, and Cloudinary (free) for media.
const V = '10.14.1';
const base = 'https://www.gstatic.com/firebasejs/' + V + '/';

const cfg = window.REEL_FIREBASE_CONFIG || {};
if (!cfg.apiKey || /PASTE/.test(cfg.apiKey)) {
  console.error('Reelscore: fill in firebase-config.js');
  window.__reelProvide({});
} else {
  start().catch((e) => { console.error('Reelscore: Firebase failed to start', e); window.__reelProvide({}); });
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
      if (first) { first = false; res(u); return; }
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
  window.reelSignIn = async () => {
    const p = new A.GoogleAuthProvider();
    try { await A.signInWithPopup(auth, p); }
    catch (e) { if (/popup-blocked|operation-not-supported/.test(e.code || '')) await A.signInWithRedirect(auth, p); else console.warn(e); }
  };
  window.reelSignOut = () => A.signOut(auth);
  // Signed out: a Sign in button. Signed in: the profile picture opens a menu with Sign out (app/main.js).
  const mountAuthUi = () => {
    const navr = document.querySelector('.navr');
    if (!navr || document.getElementById('authBtn') || user) return;
    const b = document.createElement('button');
    b.type = 'button'; b.id = 'authBtn'; b.className = 'authbtn';
    b.textContent = user ? 'Sign out' : 'Sign in';
    b.addEventListener('click', () => { if (user) A.signOut(auth); else window.reelSignIn(); });
    navr.appendChild(b);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountAuthUi); else mountAuthUi();

  window.__reelProvide({ db, assets, user: userNs });
}
