// Firebase savienojums: konti (e-pasts + parole) un Firestore ar bezsaistes kešatmiņu.
// Tiek iebūvēts www/cloud.js ar esbuild. Ja firebase-config.js ir tukšs, nekas netiek ieslēgts.
import config from "./firebase-config.js";
import { initializeApp } from "firebase/app";
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, inMemoryPersistence, onAuthStateChanged,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  sendPasswordResetEmail, updateProfile
} from "firebase/auth";
import {
  initializeFirestore, persistentLocalCache, persistentSingleTabManager, memoryLocalCache,
  doc, setDoc, updateDoc, deleteDoc, collection, query, where, onSnapshot,
  getDocs, writeBatch, arrayRemove, limit, documentId, runTransaction, orderBy, startAt, endAt, getDoc
} from "firebase/firestore";

if (config && config.apiKey) try {
  const app = initializeApp(config);
  let auth;
  try { auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence, inMemoryPersistence] }); }
  catch (e) { window.CloudWarn = "auth: " + e.message; auth = initializeAuth(app, { persistence: inMemoryPersistence }); }
  let db;
  try { db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() }) }); }
  catch (e) { window.CloudWarn = "firestore: " + e.message; db = initializeFirestore(app, { localCache: memoryLocalCache() }); }

  let first = true, resolveReady;
  const ready = new Promise(r => (resolveReady = r));
  setTimeout(() => { if (first) { first = false; window.CloudWarn = "auth timeout"; resolveReady(auth.currentUser); } }, 8000);
  onAuthStateChanged(auth, u => {
    if (first) { first = false; resolveReady(u); }
    else if (window.Cloud && window.Cloud.onAuthChange) window.Cloud.onAuthChange(u);
  }, e => { window.CloudWarn = "auth: " + (e && e.message); });

  const noId = o => { const { id, ...rest } = o; return rest; };

  window.Cloud = {
    ready: () => ready,
    user: () => auth.currentUser,
    async signUp(email, pass, name) {
      const c = await createUserWithEmailAndPassword(auth, email.trim(), pass);
      try { await updateProfile(c.user, { displayName: name }); } catch (e) {}
      await setDoc(doc(db, "users", c.user.uid), { name, email: email.trim().toLowerCase() }, { merge: true });
      return c.user;
    },
    signIn: (email, pass) => signInWithEmailAndPassword(auth, email.trim(), pass),
    signOut: () => signOut(auth),
    reset: email => sendPasswordResetEmail(auth, email.trim()),

    listenProfile(uid, cb, err) {
      return onSnapshot(doc(db, "users", uid), s => cb(s.exists() ? s.data() : null), err);
    },
    saveProfile: (uid, data) => setDoc(doc(db, "users", uid), data, { merge: true }),

    listenCourses(uid, cb, err) {
      return onSnapshot(collection(db, "users", uid, "courses"), s => cb(s.docs.map(d => ({ ...d.data(), id: d.id }))), err);
    },
    setCourse: (uid, c) => setDoc(doc(db, "users", uid, "courses", c.id), noId(c)),
    delCourse: (uid, id) => deleteDoc(doc(db, "users", uid, "courses", id)),

    listenRounds(uid, cb, err) {
      const q = query(collection(db, "rounds"), where("memberUids", "array-contains", uid));
      return onSnapshot(q, s => cb(s.docs.map(d => ({ ...d.data(), id: d.id }))), err);
    },
    setRound: (id, data) => setDoc(doc(db, "rounds", id), noId(data)),
    updateRound: (id, fields) => updateDoc(doc(db, "rounds", id), fields),
    leaveRound: (id, uid) => updateDoc(doc(db, "rounds", id), { memberUids: arrayRemove(uid) }),
    delRound: id => deleteDoc(doc(db, "rounds", id)),

    // Kopīgi laukumi: redz visi, izveido/dzēš īpašnieks, labot var jebkurš (īpašnieks nemainās)
    listenShared(cb, err) {
      return onSnapshot(collection(db, "courses"), s => cb(s.docs.map(d => ({ ...d.data(), id: d.id }))), err);
    },
    setShared: c => setDoc(doc(db, "courses", c.id), noId(c)),
    delShared: id => deleteDoc(doc(db, "courses", id)),
    sharedExists: id => getDoc(doc(db, "courses", id)).then(s => s.exists()),

    async bulk(uid, courses, rounds, progress) {
      // laukumus raksta pa vienam (ja tāds jau ir kopīgajā sarakstā, to izlaiž)
      for (const c of courses) { try { await setDoc(doc(db, "courses", c.id), noId({ ...c, ownerUid: c.ownerUid || uid })); } catch (e) {} }
      courses = [];
      let b = writeBatch(db), n = 0, done = 0;
      const total = rounds.length;
      const flush = async () => {
        if (!n) return;
        await b.commit(); done += n; n = 0; b = writeBatch(db);
        if (progress) progress(done, total);
      };
      for (const c of courses) { b.set(doc(db, "users", uid, "courses", c.id), noId(c)); if (++n >= 400) await flush(); }
      for (const r of rounds) { b.set(doc(db, "rounds", r.id), noId(r)); if (++n >= 400) await flush(); }
      await flush();
    },

    async findUser(email) {
      const s = await getDocs(query(collection(db, "users"), where("email", "==", email.trim().toLowerCase()), limit(1)));
      if (s.empty) return null;
      const d = s.docs[0];
      return { uid: d.id, ...d.data() };
    },

    // Secīgs spēlētāja ID (0000, 0001, …) — piešķir vienreiz, prasa internetu
    async ensurePid(uid, name, nameLower) {
      const cref = doc(db, "meta", "counter"), uref = doc(db, "users", uid);
      return runTransaction(db, async t => {
        const u = await t.get(uref);
        if (u.exists() && u.data().pid) return u.data().pid;
        const c = await t.get(cref);
        const n = c.exists() ? c.data().next : 0;
        const pid = String(n).padStart(4, "0");
        t.set(cref, { next: n + 1 });
        t.set(uref, { pid, name, nameLower }, { merge: true });
        return pid;
      });
    },
    async findByPid(pid) {
      const s = await getDocs(query(collection(db, "users"), where("pid", "==", pid), limit(1)));
      return s.docs.map(d => ({ uid: d.id, name: d.data().name || "Spēlētājs", pid: d.data().pid }));
    },
    async searchUsers(prefix) {
      const s = await getDocs(query(collection(db, "users"), orderBy("nameLower"), startAt(prefix), endAt(prefix + "\uf8ff"), limit(8)));
      return s.docs.map(d => ({ uid: d.id, name: d.data().name || "Spēlētājs", pid: d.data().pid || "" }));
    },
    readCounter: () => getDoc(doc(db, "meta", "counter")).then(s => (s.exists() ? s.data().next : 0)),

    listenUsers(uids, cb) {
      const chunks = [];
      for (let i = 0; i < uids.length; i += 30) chunks.push(uids.slice(i, i + 30));
      const parts = chunks.map(() => []);
      if (!chunks.length) { cb([]); return () => {}; }
      const unsubs = chunks.map((ch, k) => onSnapshot(query(collection(db, "users"), where(documentId(), "in", ch)), s => {
        parts[k] = s.docs.map(d => ({ uid: d.id, name: d.data().name || "Draugs", pid: d.data().pid || "" }));
        cb(parts.flat());
      }, () => {}));
      return () => unsubs.forEach(u => u());
    }
  };
} catch (e) {
  window.CloudError = (e && (e.code || e.message)) || String(e);
}
