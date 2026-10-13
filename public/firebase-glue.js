// Connects the app to Firebase: Google sign-in and the shared Firestore storage.
// The app itself only talks to window.FB, so it never touches the Firebase SDK directly.
const cfg = window.MEALBOOK_CONFIG;
const notConfigured =
  !cfg || !cfg.firebase || Object.values(cfg.firebase).some((v) => /PASTE/i.test(String(v)));

if (notConfigured) {
  window.FB_SETUP = true;
} else {
  try {
    const base = "https://www.gstatic.com/firebasejs/10.14.1/";
    const [App, Auth, Fs] = await Promise.all([
      import(base + "firebase-app.js"),
      import(base + "firebase-auth.js"),
      import(base + "firebase-firestore.js"),
    ]);

    const app = App.initializeApp(cfg.firebase);
    const auth = Auth.getAuth(app);
    // Offline cache: the app keeps working in a shop with no signal and syncs when back online.
    const db = Fs.initializeFirestore(app, {
      localCache: Fs.persistentLocalCache({ tabManager: Fs.persistentMultipleTabManager() }),
    });

    // All shared data lives under household/main/<collection>/<id>
    const col = (name) => Fs.collection(db, "household", "main", name);
    Auth.getRedirectResult(auth).catch(() => {});

    window.FB = {
      onAuth(cb) {
        return Auth.onAuthStateChanged(auth, (u) => cb(u ? { email: u.email, name: u.displayName } : null));
      },
      async signIn() {
        const provider = new Auth.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" });
        try {
          await Auth.signInWithPopup(auth, provider);
        } catch (e) {
          if (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment") {
            await Auth.signInWithRedirect(auth, provider);
            return;
          }
          throw e;
        }
      },
      signOut: () => Auth.signOut(auth),
      token: () => auth.currentUser.getIdToken(),
      // cb(docs, error). docs = [{id, ...data}]
      listen(name, cb) {
        return Fs.onSnapshot(
          col(name),
          (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })), null),
          (err) => cb(null, err)
        );
      },
      // ops = [{op:'set'|'del', key:'collection/id', data}]
      async commit(ops) {
        for (let i = 0; i < ops.length; i += 400) {
          const batch = Fs.writeBatch(db);
          for (const o of ops.slice(i, i + 400)) {
            const [c, ...rest] = o.key.split("/");
            const ref = Fs.doc(db, "household", "main", c, rest.join("/"));
            if (o.op === "set") batch.set(ref, o.data);
            else batch.delete(ref);
          }
          await batch.commit();
        }
      },
    };
  } catch (e) {
    window.FB_ERROR = String((e && e.message) || e);
  }
}
document.dispatchEvent(new Event("fb-ready"));
