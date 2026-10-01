// Firebase projekta pārbaude GitHub Actions vidē. Izveido pagaidu testa kontu, pārbauda noteikumus un to izdzēš.
import { readFileSync, writeFileSync } from "node:fs";
import { initializeApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, deleteUser } from "firebase/auth";
import { getFirestore, doc, setDoc, getDoc, updateDoc, deleteDoc, collection, query, where, getDocs } from "firebase/firestore";

const src = readFileSync(new URL("../src/firebase-config.js", import.meta.url), "utf8");
const config = JSON.parse(src.slice(src.indexOf("{"), src.lastIndexOf("}") + 1)
  .replace(/^(\s*)(\w+):/gm, '$1"$2":').replace(/,\s*}/, "}"));
const app = initializeApp(config);
const auth = getAuth(app), db = getFirestore(app);
const stage = process.argv[2];
const credFile = "/tmp/iemetejs-smoke.json";
const log = (...a) => console.log("•", ...a);

try {
  if (stage === "auth") {
    const email = `smoke-${Date.now()}@iemetejs-test.lv`, pass = "Smoke-" + Math.random().toString(36).slice(2, 12);
    const c = await createUserWithEmailAndPassword(auth, email, pass);
    writeFileSync(credFile, JSON.stringify({ email, pass }));
    log("Konts izveidots", c.user.uid);
  } else {
    const { email, pass } = JSON.parse(readFileSync(credFile, "utf8"));
    const c = await signInWithEmailAndPassword(auth, email, pass);
    const uid = c.user.uid;
    if (stage === "firestore") {
      await setDoc(doc(db, "users", uid), { name: "Tests", email });
      log("users/uid ieraksts OK");
      await setDoc(doc(db, "users", uid, "courses", "t1"), { name: "Testa laukums", holes: [{ par: 3, dist: 0 }] });
      log("laukuma ieraksts OK");
      const rid = uid + "_smoke";
      await setDoc(doc(db, "rounds", rid), { status: "live", memberUids: [uid], ownerUid: uid, pars: [3], players: [{ name: "Tests", uid }], cells: {} });
      log("raunda izveide OK");
      await updateDoc(doc(db, "rounds", rid), { "cells.p0_h0": 3 });
      log("metiena ieraksts OK");
      const q = await getDocs(query(collection(db, "rounds"), where("memberUids", "array-contains", uid)));
      if (q.size < 1) throw new Error("vaicājums neatrada raundu");
      log("raundu vaicājums OK", q.size);
      const other = await getDoc(doc(db, "rounds", "nav-mans-" + Date.now())).then(() => "ok", e => e.code);
      log("sveša raunda lasīšana:", other);
      const cnt = await getDoc(doc(db, "meta", "counter"));
      log("ID skaitītāja lasīšana OK", cnt.exists() ? cnt.data().next : "(vēl nav)");
      const byName = await getDocs(query(collection(db, "users"), where("pid", "==", "9999")));
      log("meklēšana pēc ID OK", byName.size);
      const cid = "smoke-" + uid;
      await setDoc(doc(db, "courses", cid), { name: "Testa kopīgais laukums", ownerUid: uid, holes: [{ par: 3, dist: 0 }] });
      await setDoc(doc(db, "courses", cid), { name: "Testa kopīgais laukums", ownerUid: uid, holes: [{ par: 3, dist: 50 }] });
      const steal = await setDoc(doc(db, "courses", cid), { name: "x", ownerUid: "kāds-cits", holes: [] }).then(() => "ATĻAUTS (slikti)", e => e.code);
      log("kopīgā laukuma izveide/labošana OK; īpašnieka maiņa:", steal);
      if (steal === "ATĻAUTS (slikti)") throw new Error("noteikumi atļauj mainīt laukuma īpašnieku");
      await deleteDoc(doc(db, "courses", cid));
      log("kopīgā laukuma dzēšana OK");
      await deleteDoc(doc(db, "rounds", rid));
      await deleteDoc(doc(db, "users", uid, "courses", "t1"));
      log("dzēšana OK");
    } else if (stage === "cleanup") {
      await deleteDoc(doc(db, "users", uid)).catch(() => {});
      await deleteUser(c.user);
      log("Testa konts izdzēsts");
    }
  }
  process.exit(0);
} catch (e) {
  console.error("KĻŪDA:", e.code || "", e.message);
  process.exit(1);
}
