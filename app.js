(() => {
"use strict";

const SEASONS = [
  { id:"autumn",  fa:"پاییز",   en:"Autumn", tag:"عطر دارچین، باد، و برگ‌هایی که یکی‌یکی می‌ریزن" },
  { id:"winter",  fa:"زمستان",  en:"Winter", tag:"برف، شومینه، و قطاری که تو سکوت می‌گذره" },
  { id:"spring",  fa:"بهار",    en:"Spring", tag:"شکوفه‌ها و صبح‌هایی که تازه دارن شروع می‌شن" },
  { id:"summer",  fa:"تابستان", en:"Summer", tag:"نور طلایی، صدای موج، و شب‌هایی که تموم نمی‌شن" },
  { id:"reserve", fa:"سال دوم", en:"Next year", tag:"کتاب‌هایی که تو سایه، صبور منتظرن" },
];
const BY = Object.fromEntries(SEASONS.map(s => [s.id, s]));
const FA_NAME = { autumn:"پاییز", winter:"زمستان", spring:"بهار", summer:"تابستان" };
const WEIGHT = { "سبک":1, "متوسط":2, "سنگین":3 };
const fa = n => Number(n).toLocaleString("fa-IR");

/* ───────── data ───────── */
const BASE = window.BOOKS;
const LIB_KEY = "fasl-khani:lib:v1";
const SEASON_IDS = ["autumn","winter","spring","summer"];

/* a library = { seasons:{autumn,winter,spring,summer}, reserve:[...] } (+ optional progress) */
function normalizeLib(raw) {
  const errs = [], seen = new Map();
  if (!raw || typeof raw !== "object") throw new Error("فایل JSON درست نیست.");
  const rs = raw.seasons || {};
  const one = (b, where, season) => {
    if (!b || typeof b.t !== "string" || !b.t.trim()) { errs.push("کتاب بدون عنوان تو " + where); return null; }
    const t = b.t.trim();
    if (seen.has(t)) { errs.push("عنوان تکراری: " + t + " (" + seen.get(t) + " و " + where + ")"); return null; }
    seen.set(t, where);
    const o = { t, g: typeof b.g === "string" ? b.g : "", w: WEIGHT[b.w] ? b.w : "متوسط", n: typeof b.n === "string" ? b.n : "" };
    if (b.later) o.later = true;
    if (b.u) o.u = 1;
    if (season) o.s = SEASON_IDS.includes(b.s) ? b.s : "autumn";
    return o;
  };
  const seasons = {};
  for (const id of SEASON_IDS) {
    if (rs[id] !== undefined && !Array.isArray(rs[id])) errs.push("seasons." + id + " باید آرایه باشه");
    seasons[id] = (Array.isArray(rs[id]) ? rs[id] : []).map((b, i) => one(b, id + " #" + (i + 1), false)).filter(Boolean);
  }
  if (raw.reserve !== undefined && !Array.isArray(raw.reserve)) errs.push("reserve باید آرایه باشه");
  const reserve = (Array.isArray(raw.reserve) ? raw.reserve : []).map((b, i) => one(b, "reserve #" + (i + 1), true)).filter(Boolean);
  if (errs.length) { const e = new Error(errs.slice(0, 4).join("\n") + (errs.length > 4 ? "\n… و " + (errs.length - 4) + " مورد دیگه" : "")); e.list = errs; throw e; }
  const lib = { seasons, reserve };
  if (raw.progress && Array.isArray(raw.progress.read)) lib.progress = { read: raw.progress.read.filter(x => typeof x === "string") };
  return lib;
}
let D = BASE;
try {
  const stored = JSON.parse(localStorage.getItem(LIB_KEY) || "null");
  if (stored) D = normalizeLib(stored);
} catch (e) { D = BASE; }
const plan = {};
for (const s of SEASON_IDS) plan[s] = D.seasons[s];
const reserve = D.reserve;

// reading order: now-autumn, winter, spring, summer, then autumn of next year
const order = [
  ...plan.autumn.filter(b => !b.later), ...plan.winter, ...plan.spring, ...plan.summer,
  ...plan.autumn.filter(b => b.later),
];
const SEASON_OF = new Map();
for (const s in plan) for (const b of plan[s]) SEASON_OF.set(b.t, s);

/* ───────── state ───────── */
const KEY = "fasl-khani:read:v1";
let read = new Set();
try { read = new Set(JSON.parse(localStorage.getItem(KEY) || "[]")); } catch (e) {}
const META_KEY = "fasl-khani:meta:v1";
/* mark local data as changed (timestamp for cloud merge) and tell sync.js */
const changed = what => {
  try { const m = JSON.parse(localStorage.getItem(META_KEY) || "{}"); m[what + "At"] = Date.now(); localStorage.setItem(META_KEY, JSON.stringify(m)); } catch (e) {}
  window.dispatchEvent(new CustomEvent("fk:change", { detail: { what } }));
};
const save = () => { try { localStorage.setItem(KEY, JSON.stringify([...read])); } catch (e) {} changed("read"); };
const afterSync = () => Promise.resolve(window.fkSync && window.fkSync.flush()).catch(() => {}).then(() => location.reload());

let current = null;
const $ = id => document.getElementById(id);

/* ───────── ui ───────── */
function buildTabs() {
  const t = $("tabs");
  t.innerHTML = "";
  for (const s of SEASONS) {
    const b = document.createElement("button");
    b.className = "tab"; b.type = "button"; b.role = "tab"; b.dataset.id = s.id;
    b.textContent = s.fa;
    b.addEventListener("click", () => go(s.id));
    t.appendChild(b);
  }
}

function seasonBooks(id) { return id === "reserve" ? reserve : plan[id]; }

function progress(id) {
  const list = seasonBooks(id);
  const done = list.filter(b => read.has(b.t)).length;
  return { done, total: list.length };
}

function drops(w) {
  const n = WEIGHT[w] || 1;
  return `<span class="drops" title="${w}">${[1,2,3].map(i => `<s class="${i <= n ? "on" : ""}"></s>`).join("")}</span><span>${w}</span>`;
}

function esc(s) { return s.replace(/[&<>"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c])); }

function cardHTML(b, i, extra = "") {
  const genre = b.g ? `<span>${esc(b.g)}</span>` : `<span class="dim">ژانر نامشخص</span>`;
  const note = b.n ? `<span class="note">· ${esc(b.n)}</span>` : "";
  return `<article class="card ${read.has(b.t) ? "done" : ""}" data-t="${esc(b.t)}" style="--d:${Math.min(i, 14) * 38}ms">
    <button class="chk" type="button" aria-label="خوندم: ${esc(b.t)}" aria-pressed="${read.has(b.t)}">
      <svg viewBox="0 0 24 24"><path d="M5 12.5l4.6 4.6L19 7.5"/></svg></button>
    <div class="body">
      <div class="title">${esc(b.t)}</div>
      <div class="meta">${genre}${drops(b.w)}${note}${extra}</div>
    </div>
    <span class="num">${fa(i + 1)}</span>
    <button class="mv" type="button" aria-label="انتقال به فصل دیگه: ${esc(b.t)}">⇄</button>
    <button class="del" type="button" aria-label="حذف: ${esc(b.t)}">✕</button>
  </article>`;
}

function renderList(id) {
  const el = $("list");
  let html = "", i = 0;
  if (id === "reserve") {
    let last = "";
    reserve.forEach((b, k) => {
      if (b.s !== last) { html += `<div class="group">${FA_NAME[b.s]}</div>`; last = b.s; }
      html += cardHTML(b, k, b.u ? "" : "");
    });
  } else {
    plan[id].forEach((b, k) => {
      if (b.later && !plan[id][k - 1]?.later) html += `<div class="divider">پاییز سال بعد · بعد از تابستون</div>`;
      html += cardHTML(b, k);
    });
  }
  el.innerHTML = html;
  el.classList.remove("swap"); void el.offsetWidth;
}

function renderRing(id) {
  const { done, total } = progress(id);
  const r = 36, c = 2 * Math.PI * r, f = total ? done / total : 0;
  $("ring").innerHTML = `<svg viewBox="0 0 86 86"><circle class="tr" cx="43" cy="43" r="${r}" stroke-width="3"/>
    <circle class="pr" cx="43" cy="43" r="${r}" stroke-width="5" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - f)}"/></svg>
    <b>${fa(done)}<small>از ${fa(total)}</small></b>`;
}

function renderTotals() {
  const total = order.length, done = order.filter(b => read.has(b.t)).length;
  $("total").textContent = `${fa(done)} از ${fa(total)} کتاب`;
  const nxt = order.find(b => !read.has(b.t));
  const btn = $("next");
  if (nxt) {
    btn.hidden = false;
    btn.innerHTML = `<i></i><span>بعدی تو</span><b>${esc(nxt.t)}</b>`;
    btn.onclick = () => focusBook(nxt.t);
  } else {
    btn.hidden = false;
    btn.innerHTML = `<i></i><span>برنامه‌ی این لیست تموم شد. پایین صفحه خروجی بگیر و لیست جدید بساز.</span>`;
    btn.onclick = () => $("export").scrollIntoView({ behavior:"smooth", block:"center" });
  }
}

function focusBook(title) {
  const s = SEASON_OF.get(title);
  if (s && s !== current) go(s);
  requestAnimationFrame(() => {
    const el = [...document.querySelectorAll(".card")].find(c => c.dataset.t === title);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
  });
}

function go(id, push = true) {
  if (!BY[id]) id = "autumn";
  const first = current === null;
  current = id;
  document.body.dataset.season = id;
  document.querySelector('meta[name="theme-color"]').content = THEME[id];
  document.querySelectorAll(".tab").forEach(t => {
    const on = t.dataset.id === id;
    t.setAttribute("aria-selected", on);
    if (on) t.scrollIntoView({ inline:"center", block:"nearest", behavior: first ? "auto" : "smooth" });
  });
  const s = BY[id];
  const en = $("heroEn"), fan = $("heroFa"), tag = $("heroTag");
  en.textContent = s.en; fan.textContent = s.fa; tag.textContent = s.tag;
  [en, fan, tag].forEach((e, i) => { e.classList.remove("reveal", "d1", "d2"); void e.offsetWidth; e.classList.add("reveal"); if (i) e.classList.add("d" + i); });
  renderList(id);
  $("list").classList.add("swap");
  renderRing(id);
  renderTotals();
  Fx.setSeason(id);
  if (push) history.replaceState(null, "", "#" + id);
}
const THEME = { autumn:"#4a2224", winter:"#1b2554", spring:"#f9d7e3", summer:"#7fd6dc", reserve:"#1f1747" };

/* toggle read */
$("list").addEventListener("click", e => {
  const chk = e.target.closest(".chk");
  if (!chk) return;
  const card = chk.closest(".card"), t = card.dataset.t;
  const now = !read.has(t);
  now ? read.add(t) : read.delete(t);
  save();
  card.classList.toggle("done", now);
  chk.setAttribute("aria-pressed", now);
  if (now) { const r = chk.getBoundingClientRect(); Fx.burst(r.left + r.width / 2, r.top + r.height / 2); }
  renderRing(current === "reserve" ? "reserve" : current);
  renderTotals();
});

/* reset (two taps) */
let armTimer;
$("reset").addEventListener("click", e => {
  const b = e.currentTarget;
  if (!b.classList.contains("armed")) {
    b.classList.add("armed"); b.textContent = "مطمئنی؟ دوباره بزن";
    armTimer = setTimeout(() => { b.classList.remove("armed"); b.textContent = "پاک‌کردن همه‌ی تیک‌ها"; }, 3500);
    return;
  }
  clearTimeout(armTimer); read.clear(); save();
  b.classList.remove("armed"); b.textContent = "پاک‌کردن همه‌ی تیک‌ها";
  go(current, false);
});

/* navigation: keys, swipe, hash */
const ids = SEASONS.map(s => s.id);
document.addEventListener("keydown", e => {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  const i = ids.indexOf(current), d = e.key === "ArrowLeft" ? 1 : -1; // RTL: left = forward
  go(ids[(i + d + ids.length) % ids.length]);
});
let tx = 0, ty = 0;
document.addEventListener("touchstart", e => { tx = e.touches[0].clientX; ty = e.touches[0].clientY; }, { passive:true });
document.addEventListener("touchend", e => {
  const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty;
  if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
  const i = ids.indexOf(current), d = dx > 0 ? 1 : -1; // swipe right → forward in RTL
  const n = i + d; if (n >= 0 && n < ids.length) go(ids[n]);
}, { passive:true });
window.addEventListener("hashchange", () => { const h = location.hash.slice(1); if (BY[h] && h !== current) go(h, false); });
document.addEventListener("pointermove", e => {
  const s = document.body.style;
  s.setProperty("--px", ((e.clientX / innerWidth) * 2 - 1).toFixed(3));
  s.setProperty("--py", ((e.clientY / innerHeight) * 2 - 1).toFixed(3));
}, { passive:true });

/* ───────── scenery (generated svg) ───────── */
function rng(seed) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }
const W = 1440, H = 420;
const ridge = (base, amp, f, ph) => x => base + amp * Math.sin(x * f + ph) + amp * .5 * Math.sin(x * f * 2.3 + ph * 1.7) + amp * .25 * Math.sin(x * f * 5.1 + ph * .6);
function ridgePath(fn, fill, op = 1, extra = "") {
  let d = `M0 ${H} L0 ${fn(0).toFixed(1)}`;
  for (let x = 24; x <= W; x += 24) d += ` L${x} ${fn(x).toFixed(1)}`;
  return `<path d="${d} L${W} ${H} Z" fill="${fill}" opacity="${op}" ${extra}/>`;
}
const blob = (x, y, r, c, op = 1) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="${c}" opacity="${op}"/>`;

function tree(x, y, h, cols, R) {
  const tr = `<rect x="${x - h * .035}" y="${y - h * .5}" width="${h * .07}" height="${h * .55}" rx="2" fill="#2a1219"/>`;
  let crown = "";
  const cx = x, cy = y - h * .62;
  for (let i = 0; i < 7; i++) {
    const a = R() * Math.PI * 2, d = R() * h * .26;
    crown += blob(cx + Math.cos(a) * d * 1.2, cy + Math.sin(a) * d * .8, h * (.17 + R() * .13), cols[(R() * cols.length) | 0], .96);
  }
  return tr + crown;
}
function pine(x, y, h, c, snow) {
  let s = `<rect x="${x - 2}" y="${y - h * .14}" width="4" height="${h * .16}" fill="#1a2250"/>`;
  for (let i = 0; i < 4; i++) {
    const w = h * (.46 - i * .09), top = y - h * (.2 + i * .22), bot = y - h * (.02 + i * .2);
    s += `<path d="M${x} ${top - h * .2} L${x + w / 2} ${bot} L${x - w / 2} ${bot} Z" fill="${c}"/>`;
    if (snow) s += `<path d="M${x} ${top - h * .2} L${x + w * .22} ${top - h * .02} Q${x} ${top + h * .02} ${x - w * .22} ${top - h * .02} Z" fill="${snow}" opacity=".9"/>`;
  }
  return s;
}
function palm(x, y, s, c) {
  let out = `<path d="M${x} ${y} Q${x + 20 * s} ${y - 90 * s} ${x + 6 * s} ${y - 190 * s}" stroke="${c}" stroke-width="${7 * s}" fill="none" stroke-linecap="round"/>`;
  const tx = x + 6 * s, ty = y - 190 * s;
  [[-90,-20],[-60,-60],[-20,-80],[20,-80],[60,-60],[90,-20],[-45,10],[45,10]].forEach(([dx, dy]) => {
    out += `<path d="M${tx} ${ty} Q${tx + dx * s * .5} ${ty + dy * s * 1.1 - 20 * s} ${tx + dx * s} ${ty + dy * s + 28 * s}" stroke="${c}" stroke-width="${6 * s}" fill="none" stroke-linecap="round"/>`;
  });
  return out;
}

function sceneAutumn() {
  const R = rng(11), f1 = ridge(250, 34, .004, 1), f2 = ridge(300, 30, .006, 3), f3 = ridge(360, 20, .008, 5);
  let s = ridgePath(f1, "#7b3a38", .75) + ridgePath(f2, "#4d2230", .95);
  const cols1 = ["#c24a2c", "#e0702d", "#f0a63a"], cols2 = ["#a8341f", "#d4601f", "#f2b44a", "#8c2a1c"];
  for (let x = 40; x < W; x += 70 + R() * 70) s += tree(x, f2(x) + 6, 90 + R() * 50, cols1, R);
  s += ridgePath(f3, "#25101b");
  for (let x = 90; x < W; x += 210 + R() * 160) s += tree(x, f3(x) + 8, 190 + R() * 90, cols2, R);
  // fallen leaves
  for (let i = 0; i < 40; i++) { const x = R() * W; s += `<ellipse cx="${x.toFixed(0)}" cy="${(f3(x) + 14 + R() * 30).toFixed(0)}" rx="${4 + R() * 4}" ry="${2 + R() * 2}" fill="${cols2[(R() * 4) | 0]}" opacity=".85" transform="rotate(${(R() * 180) | 0} ${x.toFixed(0)} ${(f3(x) + 20).toFixed(0)})"/>`; }
  return s;
}
function sceneWinter() {
  const R = rng(23), f1 = ridge(260, 36, .0045, 2), f2 = ridge(310, 26, .007, 4), f3 = ridge(372, 16, .009, 1);
  let s = ridgePath(f1, "#8da0d6", .7) + ridgePath(f2, "#dfe8fb", .95);
  for (let x = 30; x < W; x += 36 + R() * 44) s += pine(x, f2(x) + 4, 70 + R() * 60, "#2e3e78", "#f4f8ff");
  s += ridgePath(f3, "#f4f8ff");
  for (let x = 60; x < W; x += 150 + R() * 200) s += pine(x, f3(x) + 6, 150 + R() * 90, "#1f2c63", "#ffffff");
  // glowing cabin window
  const cx = 1130, cy = f3(cx) + 2;
  s += `<rect x="${cx - 26}" y="${cy - 30}" width="52" height="32" fill="#2a2446"/><path d="M${cx - 32} ${cy - 30} L${cx} ${cy - 56} L${cx + 32} ${cy - 30} Z" fill="#f4f8ff"/>`
     + `<rect x="${cx - 8}" y="${cy - 22}" width="14" height="14" fill="#ffd27a"/><circle cx="${cx}" cy="${cy - 15}" r="38" fill="#ffd27a" opacity=".18"/>`;
  return s;
}
function sceneSpring() {
  const R = rng(37), f1 = ridge(250, 30, .004, 2), f2 = ridge(310, 24, .006, 0), f3 = ridge(368, 18, .008, 4);
  let s = ridgePath(f1, "#f4c3d3", .75) + ridgePath(f2, "#c4e3cc", .95);
  const pk = ["#f9a8c4", "#ffd0df", "#f6b6cf", "#ffe3ec"];
  for (let x = 50; x < W; x += 110 + R() * 90) s += tree(x, f2(x) + 6, 80 + R() * 40, pk, R).replace(/#2a1219/g, "#7a5a64");
  s += ridgePath(f3, "#9fd2ab");
  for (let x = 130; x < W; x += 260 + R() * 200) s += tree(x, f3(x) + 8, 170 + R() * 70, pk, R).replace(/#2a1219/g, "#6e4f5a");
  for (let i = 0; i < 90; i++) { const x = R() * W, y = f3(x) + 12 + R() * 34; s += blob(x, y, 1.6 + R() * 2.2, ["#ffffff", "#ffd0df", "#fff3a8", "#e8a6ff"][(R() * 4) | 0], .95); }
  return s;
}
function sceneSummer() {
  const R = rng(51);
  let s = `<defs><linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7fe0e0"/><stop offset="1" stop-color="#1c97b3"/></linearGradient>
    <linearGradient id="glint" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff6c8" stop-opacity=".9"/><stop offset="1" stop-color="#fff6c8" stop-opacity="0"/></linearGradient></defs>`;
  s += `<rect x="0" y="210" width="${W}" height="${H - 210}" fill="url(#sea)"/>`;
  s += `<rect x="620" y="210" width="200" height="190" fill="url(#glint)" opacity=".7"/>`;
  for (let i = 0; i < 26; i++) { const y = 218 + i * 6.4, w = 30 + R() * 140, x = 560 + R() * 320 - w / 2; s += `<rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="${w.toFixed(0)}" height="2" rx="1" fill="#fff8d6" opacity="${(.7 - i * .02).toFixed(2)}"/>`; }
  s += ridgePath(ridge(318, 7, .018, 0), "#2fb2c3", .85) + ridgePath(ridge(340, 8, .014, 2), "#5fd0d2", .9);
  s += ridgePath(ridge(368, 6, .01, 1), "#ffe6b4", 1) + ridgePath(ridge(392, 10, .006, 3), "#ffd493", 1);
  s += palm(180, 396, 1.15, "#12525f") + palm(1250, 400, 1.35, "#12525f") + palm(1330, 404, .85, "#1a6573");
  return s;
}
function sceneReserve() {
  const R = rng(63), f1 = ridge(280, 34, .004, 3), f2 = ridge(340, 24, .006, 1);
  let s = ridgePath(f1, "#2c2160", .85) + ridgePath(f2, "#150f33");
  for (let x = 20; x < W; x += 28 + R() * 40) s += pine(x, f2(x) + 4, 60 + R() * 70, "#0d0924", null);
  for (let i = 0; i < 14; i++) { const x = R() * W; s += blob(x, f2(x) - 40 - R() * 60, 2 + R() * 2.4, "#ffe3a0", .9) + blob(x, f2(x) - 40, 12, "#ffe3a0", .12); }
  return s;
}
function buildScenes() {
  const gens = { autumn:sceneAutumn, winter:sceneWinter, spring:sceneSpring, summer:sceneSummer, reserve:sceneReserve };
  $("scenes").innerHTML = Object.entries(gens).map(([k, g]) =>
    `<div class="scene" data-s="${k}"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice">${g()}</svg></div>`).join("");
}

/* ───────── particles ───────── */
const Fx = (() => {
  const cv = $("fx"), ctx = cv.getContext("2d");
  let w = 0, h = 0, dpr = 1, layers = [], t = 0, raf = 0, bursts = [];
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = a => a[(Math.random() * a.length) | 0];

  const KIND = {
    autumn: { n:46, cols:["#e0702d","#f0a63a","#c1432c","#ffc15e","#a8341f"],
      make:(top) => ({ x:rnd(0,w), y:top ? rnd(-h*.2,-10) : rnd(0,h), s:rnd(7,15), vy:rnd(.5,1.25), vx:rnd(-.2,.5), r:rnd(0,6.28), vr:rnd(-.025,.025), sw:rnd(.012,.03), ph:rnd(0,6.28), a:rnd(.55,.95) }),
      draw:(p,c) => { ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.r); ctx.scale(1, .55 + .45 * Math.cos(p.ph + t * .02)); ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(0,-p.s); ctx.bezierCurveTo(p.s*.9,-p.s*.5,p.s*.8,p.s*.6,0,p.s); ctx.bezierCurveTo(-p.s*.8,p.s*.6,-p.s*.9,-p.s*.5,0,-p.s); ctx.fill(); ctx.strokeStyle="rgba(60,20,10,.35)"; ctx.lineWidth=.8; ctx.beginPath(); ctx.moveTo(0,-p.s); ctx.lineTo(0,p.s); ctx.stroke(); ctx.restore(); } },
    winter: { n:130, cols:["#ffffff","#eaf1ff","#d4e3ff"],
      make:(top) => ({ x:rnd(0,w), y:top ? rnd(-h*.2,-5) : rnd(0,h), s:rnd(1.1,3.8), vy:rnd(.25,.95), vx:rnd(-.2,.25), r:0, vr:0, sw:rnd(.006,.02), ph:rnd(0,6.28), a:rnd(.5,.95) }),
      draw:(p,c) => { const g = ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,p.s*2.4); g.addColorStop(0,c); g.addColorStop(.35,c); g.addColorStop(1,"rgba(255,255,255,0)"); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x,p.y,p.s*2.4,0,6.283); ctx.fill(); } },
    spring: { n:42, cols:["#f9a8c4","#ffc9da","#ffe0ea","#f58db3"],
      make:(top) => ({ x:rnd(0,w), y:top ? rnd(-h*.2,-10) : rnd(0,h), s:rnd(5,10), vy:rnd(.35,.8), vx:rnd(.1,.6), r:rnd(0,6.28), vr:rnd(-.03,.03), sw:rnd(.008,.02), ph:rnd(0,6.28), a:rnd(.6,.95) }),
      draw:(p,c) => { ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.r); ctx.scale(1, .5 + .5 * Math.cos(p.ph + t * .025)); ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(0,p.s); ctx.bezierCurveTo(p.s*1.1,p.s*.3,p.s*.7,-p.s*.9,0,-p.s*.55); ctx.bezierCurveTo(-p.s*.7,-p.s*.9,-p.s*1.1,p.s*.3,0,p.s); ctx.fill(); ctx.restore(); } },
    summer: { n:56, cols:["#fff3b0","#ffe08a","#ffffff","#ffd2a0"],
      make:() => ({ x:rnd(0,w), y:rnd(h*.15,h*.95), s:rnd(1.6,4.2), vy:rnd(-.22,-.05), vx:rnd(-.15,.15), r:0, vr:0, sw:rnd(.004,.012), ph:rnd(0,6.28), a:rnd(.5,1) }),
      draw:(p,c) => { const pulse = .55 + .45 * Math.sin(p.ph + t * .03); const g = ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,p.s*5); g.addColorStop(0,c); g.addColorStop(.2,c); g.addColorStop(1,"rgba(255,230,150,0)"); ctx.globalAlpha *= pulse; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x,p.y,p.s*5,0,6.283); ctx.fill(); } },
    reserve: { n:50, cols:["#cfc2ff","#ffffff","#b9a2ff","#ffe3a0"],
      make:() => ({ x:rnd(0,w), y:rnd(0,h*.8), s:rnd(.9,2.4), vy:rnd(-.05,.03), vx:rnd(-.04,.06), r:0, vr:0, sw:rnd(.004,.01), ph:rnd(0,6.28), a:rnd(.4,1) }),
      draw:(p,c) => { const pulse = .35 + .65 * Math.abs(Math.sin(p.ph + t * .02)); ctx.globalAlpha *= pulse; ctx.fillStyle = c; ctx.beginPath(); ctx.arc(p.x,p.y,p.s,0,6.283); ctx.fill(); ctx.globalAlpha *= .35; ctx.beginPath(); ctx.arc(p.x,p.y,p.s*3.2,0,6.283); ctx.fill(); } },
  };

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    w = innerWidth; h = innerHeight;
    cv.width = w * dpr; cv.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function spawn(id) {
    const k = KIND[id], n = reduce ? Math.round(k.n / 3) : (w < 560 ? Math.round(k.n * .65) : k.n);
    return { id, alpha:0, list: Array.from({ length:n }, () => ({ ...k.make(false), c: pick(k.cols) })) };
  }
  function setSeason(id) {
    layers.forEach(l => l.fading = true);
    layers.push({ ...spawn(id), fading:false });
    if (!raf) loop();
  }
  function step(L) {
    const k = KIND[L.id];
    for (const p of L.list) {
      p.ph += p.sw * 6; p.r += p.vr;
      if (L.id === "summer" || L.id === "reserve") {
        p.x += p.vx + Math.sin(p.ph) * .25; p.y += p.vy + Math.cos(p.ph * .8) * .12;
        if (p.y < -20) p.y = h + 10; if (p.x < -20) p.x = w + 10; if (p.x > w + 20) p.x = -10;
      } else {
        p.x += p.vx + Math.sin(p.ph) * (L.id === "winter" ? .45 : .9); p.y += p.vy;
        if (p.y > h + 24 || p.x > w + 30 || p.x < -30) Object.assign(p, k.make(true));
      }
    }
  }
  function draw(L, alpha) {
    const k = KIND[L.id];
    for (const p of L.list) { ctx.globalAlpha = alpha * p.a; k.draw(p, p.c); }
  }
  function loop() {
    raf = requestAnimationFrame(loop);
    t++;
    ctx.clearRect(0, 0, w, h);
    layers = layers.filter(l => !(l.fading && l.alpha <= .01));
    for (const L of layers) {
      L.alpha += L.fading ? -.018 : .014;
      L.alpha = Math.max(0, Math.min(1, L.alpha));
      if (!reduce) step(L);
      draw(L, L.alpha);
    }
    // bursts
    const k = KIND[document.body.dataset.season] || KIND.autumn;
    bursts = bursts.filter(b => b.life > 0);
    for (const b of bursts) {
      b.x += b.vx; b.y += b.vy; b.vy += .05; b.vx *= .985; b.life--; b.r += b.vr;
      ctx.globalAlpha = Math.min(1, b.life / 30);
      const sv = KIND[b.id]; sv.draw({ ...b, ph:b.ph }, b.c);
    }
    ctx.globalAlpha = 1;
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
  }
  function burst(x, y) {
    const id = document.body.dataset.season, k = KIND[id];
    for (let i = 0; i < 16; i++) {
      const a = rnd(0, 6.283), v = rnd(1.5, 4.5);
      const base = k.make(false);
      bursts.push({ ...base, id, x, y, vx:Math.cos(a) * v, vy:Math.sin(a) * v - 1.5, s: base.s * .8, life: rnd(40, 80), c: pick(k.cols), a:1 });
    }
    if (!raf) loop();
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && !raf) loop(); });
  addEventListener("resize", () => { resize(); layers.forEach(l => { l.list.forEach(p => { p.x = Math.min(p.x, w); p.y = Math.min(p.y, h); }); }); });
  resize();
  return { setSeason, burst };
})();

/* ───────── export / import ───────── */
const msg = (t, err) => { const m = $("ioMsg"); m.textContent = t; m.classList.toggle("err", !!err); };
const stamp = () => { const d = new Date(), p = n => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); };

$("export").addEventListener("click", () => {
  const nxt = order.find(b => !read.has(b.t));
  const allTitles = new Set([...SEASON_IDS.flatMap(s => D.seasons[s]), ...D.reserve].map(b => b.t));
  const readList = [...order, ...D.reserve].filter(b => read.has(b.t)).map(b => b.t);
  const out = {
    app: "fasl-khani", format: 1, exportedAt: new Date().toISOString(),
    _about: "Fasl-khani library. seasons.* = this year's plan in reading order (books with later:true are read after summer, in autumn of next year). reserve = backlog (s = season it belongs to). Book: t=title, g=genre, w=weight (سبک/متوسط/سنگین), n=note. progress.read = titles already read, progress.next = where the reader is now. Edit lists freely, keep titles unique, and import the file back.",
    progress: { read: readList, readCount: readList.length, total: allTitles.size, next: nxt ? nxt.t : null, nextSeason: nxt ? SEASON_OF.get(nxt.t) : null },
    seasons: D.seasons, reserve: D.reserve,
  };
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "fasl-khani-" + stamp() + ".json";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  msg("خروجی ذخیره شد. فایل رو بده به Claude تا لیست رو عوض کنه.");
});

$("import").addEventListener("click", () => $("importFile").click());
$("importFile").addEventListener("change", e => {
  const f = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!f) return;
  const rd = new FileReader();
  rd.onerror = () => msg("فایل خونده نشد.", true);
  rd.onload = () => {
    let lib;
    try { lib = normalizeLib(JSON.parse(rd.result)); }
    catch (err) { msg(err instanceof SyntaxError ? "این فایل JSON معتبر نیست." : err.message, true); return; }
    const n = SEASON_IDS.reduce((a, s) => a + lib.seasons[s].length, 0);
    const keep = lib.progress ? "تیک‌ها هم از فایل میاد." : "تیک‌های فعلی می‌مونن.";
    if (!window.confirm("لیست جدید: " + n + " کتاب تو فصل‌ها و " + lib.reserve.length + " کتاب تو ذخیره. لیست فعلی جایگزین می‌شه. " + keep + "\nادامه بدم؟")) { msg("وارد نشد."); return; }
    try {
      localStorage.setItem(LIB_KEY, JSON.stringify(lib));
      if (lib.progress) localStorage.setItem(KEY, JSON.stringify(lib.progress.read));
    } catch (err) { msg("ذخیره تو مرورگر نشد.", true); return; }
    changed("lib"); if (lib.progress) changed("read");
    msg("در حال همگام‌سازی…");
    afterSync();
  };
  rd.readAsText(f);
});

/* back to the built-in list (two taps) */
let armLib;
$("defaults").addEventListener("click", e => {
  const b = e.currentTarget;
  if (!b.classList.contains("armed")) {
    b.classList.add("armed"); b.textContent = "مطمئنی؟ دوباره بزن";
    armLib = setTimeout(() => { b.classList.remove("armed"); b.textContent = "برگشت به لیست اولیه"; }, 3500);
    return;
  }
  clearTimeout(armLib);
  try { localStorage.removeItem(LIB_KEY); } catch (err) {}
  changed("lib");
  afterSync();
});

/* ───────── hold & drag to reorder ───────── */
const rebuildOrder = () => order.splice(0, order.length,
  ...plan.autumn.filter(b => !b.later), ...plan.winter, ...plan.spring, ...plan.summer,
  ...plan.autumn.filter(b => b.later));
const persistLib = () => {
  rebuildOrder();
  try { localStorage.setItem(LIB_KEY, JSON.stringify({ seasons: D.seasons, reserve: D.reserve })); } catch (e) {}
  changed("lib");
};
const renumber = () => $("list").querySelectorAll(".card").forEach((c, i) => { const n = c.querySelector(".num"); if (n) n.textContent = fa(i + 1); });
(() => {
  const list = $("list"), HOLD = 380, SLOP = 9;
  let st = null;
  const isCard = n => n && n.classList && n.classList.contains("card");
  const crossable = n => isCard(n) || (n && n.classList && n.classList.contains("divider"));
  const pt = e => (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e;
  function begin(e, touch) {
    if (st || e.target.closest(".chk, .del, .mv, .pick")) return;
    const card = e.target.closest(".card");
    if (!card || (!touch && e.button !== 0)) return;
    const p = pt(e);
    st = { card, x: p.clientX, y: p.clientY, active: false, raf: 0 };
    st.timer = setTimeout(lift, HOLD);
  }
  function lift() {
    if (!st) return;
    st.active = true;
    st.grab = st.y - st.card.getBoundingClientRect().top;
    st.card.classList.add("lift"); document.body.classList.add("sorting");
    try { navigator.vibrate && navigator.vibrate(12); } catch (e) {}
    tick();
  }
  function place() {
    const c = st.card, want = st.y - st.grab;
    c.style.transform = "none";
    for (let n = 0; n < 60; n++) {
      const r = c.getBoundingClientRect(), mid = want + r.height / 2;
      const prev = c.previousElementSibling, next = c.nextElementSibling;
      if (crossable(prev)) { const pr = prev.getBoundingClientRect(); if (mid < pr.top + pr.height / 2) { list.insertBefore(c, prev); continue; } }
      if (crossable(next)) { const nr = next.getBoundingClientRect(); if (mid > nr.top + nr.height / 2) { list.insertBefore(next, c); continue; } }
      break;
    }
    c.style.transform = "translateY(" + (want - c.getBoundingClientRect().top) + "px)";
  }
  function tick() {
    if (!st || !st.active) return;
    const h = window.innerHeight;
    try { if (st.y < 90) window.scrollBy(0, -Math.ceil((90 - st.y) / 6)); else if (st.y > h - 90) window.scrollBy(0, Math.ceil((st.y - (h - 90)) / 6)); } catch (e) {}
    place();
    st.raf = requestAnimationFrame(tick);
  }
  function move(e, touch) {
    if (!st) return;
    const p = pt(e);
    if (!st.active) {
      if (Math.abs(p.clientX - st.x) > SLOP || Math.abs(p.clientY - st.y) > SLOP) { clearTimeout(st.timer); st = null; }
      return;
    }
    st.y = p.clientY;
    if (e.cancelable) e.preventDefault();
  }
  function end() {
    if (!st) return;
    clearTimeout(st.timer);
    const s = st; st = null;
    if (!s.active) return;
    cancelAnimationFrame(s.raf);
    s.card.style.transform = ""; s.card.classList.remove("lift"); document.body.classList.remove("sorting");
    commit();
  }
  function commit() {
    const id = current, arr = id === "reserve" ? reserve : plan[id];
    const cards = [...list.querySelectorAll(".card")], titles = cards.map(c => c.dataset.t);
    if (titles.length !== arr.length) return;
    const by = new Map(arr.map(b => [b.t, b]));
    let flagged = false;
    if (id === "autumn") {
      let after = false;
      for (const el of list.children) {
        if (el.classList.contains("divider")) after = true;
        else if (el.classList.contains("card")) {
          const b = by.get(el.dataset.t);
          if (b && !!b.later !== after) { flagged = true; if (after) b.later = true; else delete b.later; }
        }
      }
    }
    if (!flagged && titles.every((t, i) => t === arr[i].t)) return;
    arr.splice(0, arr.length, ...titles.map(t => by.get(t)));
    persistLib();
    if (flagged) { renderList(id); renderRing(id); } else renumber();
    renderTotals();
  }
  list.addEventListener("touchstart", e => begin(e, true), { passive: true });
  list.addEventListener("mousedown", e => begin(e, false));
  addEventListener("touchmove", e => move(e, true), { passive: false });
  addEventListener("mousemove", e => move(e, false));
  addEventListener("touchend", end); addEventListener("touchcancel", end); addEventListener("mouseup", end);
  list.addEventListener("contextmenu", e => { if (st && st.active) e.preventDefault(); });
})();

/* ───────── edit mode: delete books (with undo) ───────── */
(() => {
  const toast = $("toast"), btn = $("editBtn");
  let tm = 0, last = null;
  const arrOf = id => id === "reserve" ? reserve : plan[id];
  const tidy = () => [...$("list").children].forEach(el => {
    if (el.classList.contains("card")) return;
    const n = el.nextElementSibling;
    if (!n || !n.classList.contains("card")) el.remove();
  });
  btn.addEventListener("click", () => {
    const on = document.body.classList.toggle("editing");
    btn.textContent = on ? "تمام" : "ویرایش";
    btn.setAttribute("aria-pressed", on);
  });
  $("list").addEventListener("click", e => {
    const d = e.target.closest(".del");
    if (!d) return;
    const card = d.closest(".card"), t = card.dataset.t, id = current, arr = arrOf(id), k = arr.findIndex(b => b.t === t);
    if (k < 0) return;
    const book = arr.splice(k, 1)[0];
    if (id !== "reserve") SEASON_OF.delete(t);
    card.remove(); tidy(); renumber(); persistLib(); renderRing(id); renderTotals();
    last = { id, k, book };
    toast.innerHTML = '<span></span><button type="button">برگردون</button>';
    toast.firstChild.textContent = "«" + t + "» حذف شد";
    toast.hidden = false;
    clearTimeout(tm); tm = setTimeout(() => { toast.hidden = true; last = null; }, 8000);
  });
  const note = text => {
    toast.innerHTML = "<span></span>"; toast.firstChild.textContent = text; toast.hidden = false; last = null;
    clearTimeout(tm); tm = setTimeout(() => { toast.hidden = true; }, 3500);
  };
  const moveTo = (t, from, to) => {
    const src = arrOf(from), k = src.findIndex(b => b.t === t);
    if (k < 0 || from === to) return;
    const book = src.splice(k, 1)[0];
    if (from === "reserve") delete book.s; else SEASON_OF.delete(t);
    delete book.later;
    if (to === "reserve") {
      book.s = from;
      let at = reserve.length;
      for (let i = reserve.length - 1; i >= 0; i--) if (reserve[i].s === from) { at = i + 1; break; }
      reserve.splice(at, 0, book);
    } else {
      const dst = plan[to];
      if (to === "autumn") { let at = dst.findIndex(b => b.later); if (at < 0) at = dst.length; dst.splice(at, 0, book); }
      else dst.push(book);
      SEASON_OF.set(t, to);
    }
    persistLib(); renderList(from); renderRing(from); renderTotals();
    note("«" + t + "» رفت به " + BY[to].fa);
  };
  $("list").addEventListener("click", e => {
    const mv = e.target.closest(".mv"), chip = e.target.closest(".pick button");
    if (chip) { const card = chip.closest(".card"); moveTo(card.dataset.t, current, chip.dataset.to); return; }
    if (!mv) return;
    const card = mv.closest(".card"), had = card.querySelector(".pick");
    $("list").querySelectorAll(".pick").forEach(x => x.remove());
    if (had) return;
    const d = document.createElement("div");
    d.className = "pick";
    d.innerHTML = SEASONS.filter(x => x.id !== current).map(x => '<button type="button" data-to="' + x.id + '">' + x.fa + '</button>').join("");
    card.appendChild(d);
  });
  toast.addEventListener("click", e => {
    if (!e.target.closest("button") || !last) return;
    const { id, k, book } = last; last = null; toast.hidden = true; clearTimeout(tm);
    const arr = arrOf(id);
    arr.splice(Math.min(k, arr.length), 0, book);
    if (id !== "reserve") SEASON_OF.set(book.t, id);
    persistLib();
    if (current === id) { renderList(id); renderRing(id); }
    renderTotals();
  });
})();

/* hooks for sync.js */
window.fkApp = { applyRead(list) { read = new Set(list); renderList(current); renderRing(current); renderTotals(); } };

/* ───────── boot ───────── */
buildScenes();
buildTabs();
const startFrom = () => {
  const h = location.hash.slice(1);
  if (BY[h]) return h;
  const nxt = order.find(b => !read.has(b.t));
  return nxt ? SEASON_OF.get(nxt.t) : "autumn";
};
go(startFrom(), false);
})();
