/* Fasl-khani cloud sync — Firebase Auth + Firestore (one doc per user).
   Works only when signed in; the app stays fully usable offline / signed out. */
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { getFirestore, doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

const cfg = {
  apiKey: "AIzaSyAZhFZYq2WZBYm3_0JhyUQyKl5-gB_5fek",
  authDomain: "marginalia-753d2.firebaseapp.com",
  projectId: "marginalia-753d2",
  storageBucket: "marginalia-753d2.firebasestorage.app",
  messagingSenderId: "401195836606",
  appId: "1:401195836606:web:d1a66ca2fbcd8d460aaaef",
};

const LIB_KEY = "fasl-khani:lib:v1", READ_KEY = "fasl-khani:read:v1", META_KEY = "fasl-khani:meta:v1";
const COLL = "fasl-khani";
const $ = id => document.getElementById(id);

const meta = () => { try { return Object.assign({ libAt: 0, readAt: 0 }, JSON.parse(localStorage.getItem(META_KEY) || "{}")); } catch (e) { return { libAt: 0, readAt: 0 }; } };
const setMeta = patch => { try { localStorage.setItem(META_KEY, JSON.stringify(Object.assign(meta(), patch))); } catch (e) {} };
const localRead = () => { try { const a = JSON.parse(localStorage.getItem(READ_KEY) || "[]"); return Array.isArray(a) ? a.filter(x => typeof x === "string") : []; } catch (e) { return []; } };
const localLib = () => {
  try {
    const raw = localStorage.getItem(LIB_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw); delete o.progress;
    return JSON.stringify(o);
  } catch (e) { return null; }
};

let app, auth, db, user = null, unsub = null, timer = 0, pending = { lib: false, read: false };

/* ───────── ui ───────── */
const ui = {
  status: () => $("syncStatus"), btn: () => $("syncBtn"), out: () => $("syncOut"),
  mail: () => $("syncMail"), email: () => $("syncEmail"), pass: () => $("syncPass"),
  login: () => $("syncLogin"), signup: () => $("syncSignup"), msg: () => $("syncMsg"),
};
function render(text, err) {
  const s = ui.status(); if (!s) return;
  const on = !!user;
  s.textContent = text || (on ? "همگام‌شده با " + (user.email || "حساب تو") : "همگام‌سازی خاموشه");
  s.classList.toggle("err", !!err);
  ui.btn().hidden = on; ui.mail().hidden = on; ui.out().hidden = !on;
}
const note = (t, err) => { const m = ui.msg(); if (m) { m.textContent = t || ""; m.classList.toggle("err", !!err); } };
const ERR = {
  "auth/popup-closed-by-user": "پنجره بسته شد.",
  "auth/cancelled-popup-request": "پنجره بسته شد.",
  "auth/popup-blocked": "مرورگر پنجره رو بست. با ایمیل وارد شو.",
  "auth/unauthorized-domain": "این دامنه تو فایربیس مجاز نیست.",
  "auth/operation-not-allowed": "این روش ورود فعال نیست.",
  "auth/invalid-email": "ایمیل درست نیست.",
  "auth/invalid-credential": "ایمیل یا رمز اشتباهه.",
  "auth/wrong-password": "ایمیل یا رمز اشتباهه.",
  "auth/user-not-found": "این ایمیل حساب نداره؛ «ساخت حساب» رو بزن.",
  "auth/email-already-in-use": "این ایمیل قبلاً حساب داره؛ «ورود» رو بزن.",
  "auth/weak-password": "رمز باید حداقل ۶ حرف باشه.",
  "auth/network-request-failed": "اینترنت نیست.",
  "auth/too-many-requests": "زیاد تلاش شد؛ کمی بعد دوباره بزن.",
};
const errText = e => ERR[e && e.code] || ("خطا: " + ((e && (e.code || e.message)) || "نامشخص"));

/* ───────── push ───────── */
function buildPush() {
  const m = meta(), out = { updatedAt: Date.now() };
  if (pending.lib) { out.lib = localLib(); out.libAt = m.libAt; }
  if (pending.read) { out.read = localRead(); out.readAt = m.readAt; }
  return out;
}
async function pushNow() {
  clearTimeout(timer); timer = 0;
  if (!user || !db || (!pending.lib && !pending.read)) return;
  const body = buildPush(), sent = { ...pending };
  pending = { lib: false, read: false };
  try {
    render("در حال ارسال…");
    await setDoc(doc(db, COLL, user.uid), body, { merge: true });
    render();
  } catch (e) {
    pending.lib = pending.lib || sent.lib; pending.read = pending.read || sent.read;
    render("ارسال نشد؛ بعداً دوباره می‌فرسته.", true);
  }
}
function schedule(what) {
  pending[what] = true;
  if (!user) return;
  clearTimeout(timer); timer = setTimeout(pushNow, 700);
}
window.addEventListener("fk:change", e => schedule(e.detail && e.detail.what === "lib" ? "lib" : "read"));
// flush before page goes away / import reload
window.fkSync = {
  flush: () => Promise.race([pushNow(), new Promise(r => setTimeout(r, 5000))]),
};
addEventListener("online", () => { if (user && (pending.lib || pending.read)) pushNow(); });

/* ───────── pull / merge ───────── */
function onRemote(snap) {
  if (snap.metadata.hasPendingWrites) return;          // our own echo
  const m = meta(), lr = localRead();
  if (!snap.exists()) {                                   // first device: upload what we have
    pending.lib = true; pending.read = true;
    setMeta({ libAt: m.libAt || (localLib() ? Date.now() : 0), readAt: m.readAt || (lr.length ? Date.now() : 0) });
    return pushNow();
  }
  const c = snap.data();
  let needReload = false, newRead = null;

  // library: last write wins
  const cLibAt = +c.libAt || 0;
  if (cLibAt > m.libAt) {
    try {
      if (c.lib) localStorage.setItem(LIB_KEY, c.lib); else localStorage.removeItem(LIB_KEY);
      setMeta({ libAt: cLibAt }); needReload = true;
    } catch (e) {}
  } else if (m.libAt > cLibAt) { pending.lib = true; }

  // ticks: last write wins (union the very first time a device with old ticks meets the cloud)
  const cReadAt = +c.readAt || 0, cRead = Array.isArray(c.read) ? c.read.filter(x => typeof x === "string") : [];
  if (m.readAt === 0 && lr.length && cRead.length) {
    newRead = [...new Set([...lr, ...cRead])];
    const at = Date.now(); setMeta({ readAt: at });
    localStorage.setItem(READ_KEY, JSON.stringify(newRead)); pending.read = true;
  } else if (cReadAt > m.readAt) {
    newRead = cRead; setMeta({ readAt: cReadAt });
    try { localStorage.setItem(READ_KEY, JSON.stringify(cRead)); } catch (e) {}
  } else if (m.readAt > cReadAt) { pending.read = true; }

  if (needReload) { location.reload(); return; }
  if (newRead && window.fkApp) window.fkApp.applyRead(newRead);
  if (pending.lib || pending.read) pushNow(); else render();
}

function listen() {
  if (unsub) unsub();
  unsub = onSnapshot(doc(db, COLL, user.uid), onRemote, e => render("همگام‌سازی نشد: " + (e.code || e.message), true));
}

/* ───────── auth ───────── */
function init() {
  try { app = initializeApp(cfg); auth = getAuth(app); db = getFirestore(app); }
  catch (e) { render("همگام‌سازی در دسترس نیست.", true); return; }
  onAuthStateChanged(auth, u => {
    user = u;
    if (unsub) { unsub(); unsub = null; }
    render();
    if (u) { render("در حال همگام‌سازی…"); listen(); }
  });
  ui.btn().addEventListener("click", async () => {
    note("");
    try { await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch (e) { note(errText(e), true); }
  });
  const mailGo = create => async () => {
    note("");
    const em = ui.email().value.trim(), pw = ui.pass().value;
    if (!em || !pw) { note("ایمیل و رمز رو بنویس.", true); return; }
    try { create ? await createUserWithEmailAndPassword(auth, em, pw) : await signInWithEmailAndPassword(auth, em, pw); ui.pass().value = ""; }
    catch (e) { note(errText(e), true); }
  };
  ui.login().addEventListener("click", mailGo(false));
  ui.signup().addEventListener("click", mailGo(true));
  ui.out().addEventListener("click", async () => { try { await signOut(auth); note("خارج شدی. اطلاعات روی همین دستگاه می‌مونه."); } catch (e) { note(errText(e), true); } });
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
