// Firebase savienojums: konti (e-pasts + parole) un Firestore ar bezsaistes kešatmiņu.
// Tiek iebūvēts www/cloud.js ar esbuild. Ja firebase-config.js ir tukšs, nekas netiek ieslēgts.
import config from "./firebase-config.js";
import { initializeApp } from "firebase/app";
import {
  initializeAuth, indexedDBLocalPersistence, onAuthStateChanged,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  sendPasswordResetEmail, updateProfile
} from "firebase/auth";
import {
  initializeFirestore, persistentLocalCache, persistentSingleTabManager,
  doc, setDoc, updateDoc, deleteDoc, collection, query, where, onSnapshot,
  getDocs, writeBatch, arrayRemove, limit, documentId
} from "firebase/firestore";

if (config && config.apiKey) {
  const app = initializeApp(config);
  const auth = initializeAuth(app, { persistence: indexedDBLocalPersistence });
  const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() })
  });

  let first = true, resolveReady;
  const ready = new Promise(r => (resolveReady = r));
  onAuthStateChanged(auth, u => {
    if (first) { first = false; resolveReady(u); }
    else if (window.Cloud.onAuthChange) window.Cloud.onAuthChange(u);
  });

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

    async bulk(uid, courses, rounds, progress) {
      let b = writeBatch(db), n = 0, done = 0;
      const total = courses.length + rounds.length;
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

    listenUsers(uids, cb) {
      const chunks = [];
      for (let i = 0; i < uids.length; i += 30) chunks.push(uids.slice(i, i + 30));
      const parts = chunks.map(() => []);
      if (!chunks.length) { cb([]); return () => {}; }
      const unsubs = chunks.map((ch, k) => onSnapshot(query(collection(db, "users"), where(documentId(), "in", ch)), s => {
        parts[k] = s.docs.map(d => ({ uid: d.id, name: d.data().name || "Draugs" }));
        cb(parts.flat());
      }, () => {}));
      return () => unsubs.forEach(u => u());
    }
  };
}
