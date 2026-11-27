// SPDX-License-Identifier: Apache-2.0 OR MIT
// AINRA World. The test network as a place you can turn, replay, walk through and check.
//
// Real (js/world-data.mjs): every part, count, status bit, log position, date, proof path and verdict.
// Drawn (and the About panel says so): where things sit in space and the slow turn.
//
// Motion: respond on press; drag 1:1; a flick's speed becomes momentum; the camera and the sheet move on springs
// (no overshoot, except a little after a flick), always from where they are now, so anything can be grabbed
// mid-flight; soft resistance past every limit. Under reduced motion nothing travels or turns by itself, and a check
// shows its answer at once.

import { icon } from "./icons.mjs";
import { loadRecord, buildWorld, runCheck, short } from "./world-data.mjs";
import { createEngine, perspective, lookAt, mul4 } from "./world-gl.mjs";

const $ = (s) => document.querySelector(s);
const cv = $("#world"), lab = $("#labels"), lx = lab.getContext("2d");
const RMQ = matchMedia("(prefers-reduced-motion: reduce)");
// A short, wide screen (a phone on its side, or a low window): the same query as the stylesheet. The details and the
// walk-through stand at the side there.
const SHORT = matchMedia("(max-height:520px) and (min-aspect-ratio:9/10)");
const RM = { get matches() { let pref = null; try { pref = localStorage.getItem("ainra-motion"); } catch { /* storage unavailable */ } return pref === "off" || (pref !== "on" && RMQ.matches); } };
const MONO = '"Noto Sans Mono", ui-monospace, monospace', TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const rubber = (over, dim, c = 0.55) => (over * dim * c) / (dim + c * Math.abs(over));        // resistance past a limit
const coast = (v, d = 0.998) => (v / 1000) * d / (1 - d);                                     // where a flick comes to rest
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const dayText = (t, brief) => new Date(t * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(brief ? {} : { year: "numeric" }), timeZone: "UTC" });
const msText = (ms) => `${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms`;

// A spring in two terms: response (seconds) and damping ratio (1 = no overshoot).
class Spring {
  constructor(x, response = 0.4, damping = 1) { this.x = x; this.v = 0; this.to = x; this.on = false; this.set(response, damping); }
  set(response, damping = 1) { this.k = (TAU / response) ** 2; this.c = (4 * Math.PI * damping) / response; return this; }
  go(to, v) { if (RM.matches) { this.x = this.to = to; this.v = 0; this.on = false; return; } this.to = to; this.on = true; if (v !== undefined) this.v = v; }
  jump(to) { this.x = this.to = to; this.v = 0; this.on = false; }
  step(dt) {
    if (!this.on) return;
    for (let t = dt; t > 0; t -= 1 / 240) { const h = Math.min(t, 1 / 240), a = -this.k * (this.x - this.to) - this.c * this.v; this.v += a * h; this.x += this.v * h; }
    if (Math.abs(this.x - this.to) < 1e-4 && Math.abs(this.v) < 1e-3) { this.x = this.to; this.v = 0; this.on = false; }
  }
}

// ---------- icons: painted once; a changed icon turns out and in ----------
function paintIcons(root = document) { for (const el of root.querySelectorAll("[data-icon]:not([data-painted])")) { el.dataset.painted = "1"; el.insertAdjacentHTML("afterbegin", icon(el.dataset.icon)); } }
function swapIcon(el, name) {
  if (el.dataset.now === name) return; el.dataset.now = name;
  const old = el.querySelector(".ic:not(.out)"); el.insertAdjacentHTML("beforeend", icon(name)); const neu = el.lastElementChild;
  if (!old || RM.matches) { old?.remove(); return; }
  old.classList.add("out"); neu.classList.add("in"); setTimeout(() => old.remove(), 220);
}
const KIND_ICON = { root: "root", epoch: "epoch", registrar: "registrar", list: "history", passport: "shield", leaf: "log", node: "log", head: "log", witness: "witness", open: "seat", you: "you", bit: "activity" };

// ---------- colours: read from the page's tokens, so the drawing follows light and dark ----------
let INK = [0, 0, 0], SIG = [0, 0, 1], inkCss = "#000", ink2Css = "#666", paperCss = "#fff", sigCss = "#00f";
function readTheme() {
  const cs = getComputedStyle(document.documentElement), hex = (v) => { const h = cs.getPropertyValue(v).trim().replace("#", ""); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255); };
  INK = hex("--ink"); SIG = hex("--signal"); inkCss = cs.getPropertyValue("--ink").trim(); ink2Css = cs.getPropertyValue("--ink2").trim(); paperCss = cs.getPropertyValue("--paper").trim(); sigCss = cs.getPropertyValue("--signal").trim();
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", readTheme);

// ---------- loading: determinate, each real step named ----------
const boot = $("#boot");
function bootStep(s, label, pct, ok) {
  if (s) { const li = boot.querySelector(`li[data-s="${s}"]`); if (li) li.className = ok ? "ok" : "on"; }
  if (label) $("#bootStep").textContent = label;
  if (pct != null) { $("#bootBar").style.width = `${pct}%`; boot.setAttribute("aria-valuenow", String(Math.round(pct))); }
}
function bootFail(msg) {
  const on = boot.querySelector("li.on"); if (on) on.className = "bad";
  $("#bootStep").textContent = "Could not load the network";
  const p = document.createElement("p"); p.className = "boot__err";
  p.innerHTML = `<b>What happened:</b> <span></span><br><b>What to do:</b> reload the page. If it happens again, the record is unreachable from here; it is published at <a href="net/registry.json">net/registry.json</a>.`;
  p.querySelector("span").textContent = msg; boot.querySelector(".boot__in").append(p); boot.setAttribute("aria-label", "Loading failed");
}

// ---------- state ----------
let R = null, W = null, eng = null, nodeSet = null, lineSet = null;
let vw = 0, vh = 0, dpr = 1, dprCap = 2, vp = new Array(16).fill(0), eye = [0, 0, 1], scaleCss = 1;
let step = 0, playing = false, playT = 0, seenEpoch = 0;
let sel = null, hover = null, mark = null, tags = [], threads = [], hits = [];   // mark: the part a walk-through stop points at
const times = []; let nValid = 0, nRefused = 0, order = [], cursor = 0, listOpen = false;
const live = () => step === W.events.length;

// ---------- camera: an orbit around a target, every part a spring ----------
const FOV = 0.66, PITCH = [-0.45, 1.45], DIST = [220, 3600];
const cam = { yaw: new Spring(-0.7, 1.2), pitch: new Spring(0.42, 0.6), dist: new Spring(4200, 1.2), tx: new Spring(0, 0.7), ty: new Spring(120, 0.7), tz: new Spring(0, 0.7), vyaw: 0, vpitch: 0 };
const SPR = [cam.yaw, cam.pitch, cam.dist, cam.tx, cam.ty, cam.tz];
const lift = new Spring(0, 0.6), rest = new Spring(0.1, 0.6), capShift = new Spring(0, 0.6), feedShift = new Spring(0, 0.6), sheetPos = new Spring(1, 0.42);                               // sheet: 1 = away, 0 = open
const feedW = () => (vw > 900 && !SHORT.matches && !tour.on && !$("#feed").classList.contains("closed") ? 310 : 0);   // the open list of checks takes the right-hand side
// The view at rest. The registrars travel all the way round, so the whole orbit must fit the narrow side. On a tall
// screen the camera looks from the front and from high up: the orbit fills the width, and you stay on screen below it.
// What the world has to itself. The details stand at the side (or rise from the foot on an upright phone), the walk's
// caption stands at the side on a short screen: all measured, so a chosen part is fitted and centred in what is left.
let capPx = 0, capTop = 0, sheetPx = 0, sheetH = 0, topPx = 66;
const sheetOpen = () => sheetPos.to !== 1;
// The walk's caption gives way while the details are open, at every size: one panel at a time, never two. Where the
// caption stands at the side (a wide or a short screen) its width is taken off what the world has.
const capSide = () => tour.on && !footCap() && !sheetOpen();
const freeW = () => Math.max(160, vw - Math.max(feedW(), sheetOpen() && !phone() ? sheetPx : 0) - (capSide() ? capPx : 0));
const aside = () => SHORT.matches && (tour.on || sheetOpen());       // a short screen with a panel at the side: timeline and zoom step aside
// At rest a short, wide screen lifts the scene so that your point clears the timeline. With a panel at the side there
// the scene is centred below the top bar instead. An upright screen keeps the small lift.
const restLift = () => (aside() ? -topPx / vh : SHORT.matches ? 0.3 : 0.1);
// During the walk on an upright phone or tablet (up to 900 px wide) the caption takes the foot. The scene then has
// the band between the top bar and the caption: it is centred there, and each stop is fitted to it. Read every
// frame, as the rest lift is, so that a longer caption or a turn of the screen in the middle of the walk moves the
// scene with it.
const footCap = () => vw <= 900 && !SHORT.matches;
const band = () => (tour.on && footCap() && !sheetOpen() ? Math.max(120, capTop - 8 - topPx) : 0);
const tourLift = () => { const b = band(); return b ? 1 - (2 * topPx + b) / vh - restLift() : 0; };
const home = () => { const b = band(), a = Math.min(freeW(), b || vh * 9) / Math.max(1, vh); return a < 0.9 ? { yaw: 0, pitch: 0.95, dist: clamp(1640 / a, 1700, 3600), t: [0, 0, 70] } : { yaw: 0.28, pitch: 0.3, dist: clamp(1880 / a, 1520, 2800) * (SHORT.matches ? 1.22 : 1), t: [0, 110, 0] }; };
function flyTo(t, dist, { yaw, pitch } = {}) {                                                 // always from wherever the camera is now
  for (const s of SPR) s.set(0.85, 1);
  cam.tx.go(t[0]); cam.ty.go(t[1]); cam.tz.go(t[2]); cam.dist.go(clamp(dist, DIST[0], DIST[1])); cam.vyaw = cam.vpitch = 0;
  if (pitch !== undefined) cam.pitch.go(pitch);
  if (yaw !== undefined) { let d = (yaw - cam.yaw.x) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; cam.yaw.go(cam.yaw.x + d); }
 
}
// How far back the camera must be for a ball of this radius to fit the narrower side of the screen.
const fit = (radius) => radius * 1.3 / (Math.tan(FOV / 2) * Math.min(1, freeW() / vh, sheetOpen() && phone() ? 1.5 * Math.max(60, vh - sheetH - 24 - topPx) / vh : band() ? 1.3 * band() / vh : 1));
const resetView = () => { const h = home(); flyTo(h.t, h.dist, { yaw: h.yaw, pitch: h.pitch }); };
const zoomBy = (f) => { cam.dist.set(0.35, 1).go(clamp((cam.dist.on ? cam.dist.to : cam.dist.x) * f, DIST[0], DIST[1])); };
function matrices() {
  const cp = Math.cos(cam.pitch.x), t = [cam.tx.x, cam.ty.x, cam.tz.x];
  eye = [t[0] + cam.dist.x * cp * Math.sin(cam.yaw.x), t[1] + cam.dist.x * Math.sin(cam.pitch.x), t[2] + cam.dist.x * cp * Math.cos(cam.yaw.x)];
  const m = mul4(perspective(FOV, vw / vh, 8, 9000), lookAt(eye, t));
  // the world moves aside for the details panel (wide screens) or up for the caption and the sheet (phones)
  const wide = !phone(), open = 1 - clamp(sheetPos.x, 0, 1), base = lift.x + rest.x;
  // beside a side sheet the world moves half the sheet's width; above a bottom sheet it is centred between the top bar
  // and the sheet, 16 px clear of it. A side caption's share fades as the details open: the caption gives way to them.
  // The list of checks has its share on a spring too, so the world glides when the list opens, closes or steps aside.
  const sx = wide ? -Math.max(open * sheetPx, feedShift.x * 310) / vw + capShift.x * (footCap() ? 0 : capPx * (1 - open)) / vw : 0;
  const sy = wide ? base : base + open * (1 - (topPx + vh - sheetH - 24) / vh - base);
  for (let c = 0; c < 4; c++) { m[c * 4] += sx * m[c * 4 + 3]; m[c * 4 + 1] += sy * m[c * 4 + 3]; }
  vp = m; scaleCss = vh * 0.5 / Math.tan(FOV / 2);
}
function proj(p) {
  const x = vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12], y = vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13], w = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15];
  return { x: (x / w * 0.5 + 0.5) * vw, y: (1 - (y / w * 0.5 + 0.5)) * vh, w, ok: w > 8 };
}

function resize() {
  vw = innerWidth; vh = innerHeight; dpr = Math.min(devicePixelRatio || 1, dprCap);
  eng.resize(Math.round(vw * dpr), Math.round(vh * dpr));
  lab.width = Math.round(vw * dpr); lab.height = Math.round(vh * dpr);
  sheetPx = sheet.offsetWidth + 16; sheetH = sheet.offsetHeight; topPx = $(".top").getBoundingClientRect().bottom + 8;
  measureCap();
}

// ---------- replay: the record up to a step ----------
function applyStep(s, quiet) {
  const prev = step; step = clamp(s, 0, W.events.length);
  seenEpoch = 0; const seen = new Set();
  for (const r of W.regs) r.bits = live() ? new Uint8Array(r.bitsFinal) : new Uint8Array(r.list.bit_len);
  for (let i = 0; i < step; i++) {
    const e = W.events[i];
    if (e.type === "epoch") seenEpoch = Math.max(seenEpoch, e.epoch);
    else if (e.type === "leaf") seen.add(`${e.reg}:${e.leaf}`);
    else if (!live()) for (const ix of e.idx) W.byId[e.reg].bits[ix] = e.on ? 1 : 0;
  }
  const latest = live() ? W.CUR : seenEpoch;
  for (const n of W.parts) {
    if (n.kind === "epoch") { n.shown = n.epoch <= latest; n.cur = n.epoch === latest; n.r = n.cur ? W.RING : W.INNER(n.epoch - 1); n.labelAt = [0, 0, n.r]; n.label = `epoch ${n.epoch}`; }
    else if (n.kind === "registrar" || n.kind === "list") n.shown = latest >= 1;
    else if (n.kind === "passport") { n.shown = seen.has(`${n.reg}:${n.leaf}`); n.off = W.byId[n.reg].bits[n.rec.status_idx] === 1; if (!live()) n.verdict = null; }
    else if (n.kind === "leaf") n.shown = seen.has(`${n.reg}:${n.leaf}`);
    else if (n.kind === "head") n.shown = seen.has(`${n.reg}:0`);
  }
  for (const r of W.regs) fillBits(r);
  // one step forward leaves a mark: a new entry flashes, a switch-off rings out from its bit
  if (!quiet && step === prev + 1) {
    const e = W.events[step - 1];
    if (e.type === "leaf") { const n = W.byId[`t:${e.reg}:${e.leaf}`]; if (n) n.flash = 1; }
    if (e.type === "epoch") W.byId[`epoch${e.epoch}`].flash = 1;
    if (e.type === "change") for (const ix of e.idx) W.byId[e.reg].spot = { ix, t: 1 };
  }
  sayNow(); renderTrack(); stats();
  $("#feedNote").textContent = live() ? "" : "Checks pause while the record replays; they run on the record as it stands now.";
}
function fillBits(r) {
  const set = r.set, n = r.list.bit_len, d = r.dim ? 0.14 : 1;
  for (let i = 0; i < n; i++) {
    const rec = r.used.get(i), there = rec && W.byId[`pp:${rec.sub}`].shown, o = i * 3;
    if (r.bits[i]) set.set(i, r.bitPos[o], r.bitPos[o + 1], r.bitPos[o + 2], 3.1, d, 1);           // a set bit: hollow, like a moon that is switched off
    else if (there) set.set(i, r.bitPos[o], r.bitPos[o + 1], r.bitPos[o + 2], 2.4, 0.95 * d, 0);   // a passport's bit, in service: full
    else set.set(i, r.bitPos[o], r.bitPos[o + 1], r.bitPos[o + 2], 1.1, 0.46 * d, 0);
  }
}
// Where bit i of a registrar's list is now: its fixed place on the globe, turned by the globe's slow spin.
function bitAt(r, i) { const o = i * 3, x = r.bitPos[o], z = r.bitPos[o + 2], c = Math.cos(r.spin), q = Math.sin(r.spin); return [r.centre[0] + c * x + q * z, r.centre[1] + r.bitPos[o + 1], r.centre[2] - q * x + c * z]; }
function sayNow() {
  const el = $("#now"), narrow = innerWidth <= 880, reg = (id) => (narrow ? id.replace("registrar-", "r-") : id);
  if (live()) { el.innerHTML = narrow ? `<b>As it stands</b> · copy of ${dayText(R.published.published_at)}` : `<b>The record as it stands.</b> Copy taken ${dayText(R.published.published_at)}.`; return; }
  if (!step) { el.innerHTML = "<b>Before the first entry.</b> Only the root exists."; return; }
  const e = W.events[step - 1], d = e.date ? dayText(e.date, narrow) : "undated";
  let t;
  if (e.type === "epoch") t = narrow ? `the root signs directory epoch ${e.epoch}` : e.epoch === 1 ? "the root signs the first directory" : e.epoch === W.CUR ? `the root signs directory epoch ${e.epoch}: the network keeps real time from here` : `the root signs directory epoch ${e.epoch}`;
  else if (e.type === "leaf") t = narrow ? `${reg(e.reg)} logs ${e.rec ? short(e.rec.sub) : `entry ${e.leaf}`}` : `${e.reg} logs entry ${e.leaf}: ${e.rec ? short(e.rec.sub) : "an entry that is not a passport in this record"}`;
  else { const r = W.byId[e.reg], rec = r.used.get(e.idx[0]), who = rec ? short(rec.sub) : `bit ${e.idx[0]}`; t = narrow ? `${reg(e.reg)} ${e.on ? "switches off" : "restores"} ${who}` : `${e.reg} ${e.on ? "switches off" : "restores"} ${who} (list change ${e.seq})`; }
  el.innerHTML = `<b>${d}</b> · ${t}`;
}
function stats() {
  const ps = W.parts.filter((n) => n.kind === "passport" && n.shown && !W.byId[n.reg].dim);
  $("#stIn").textContent = String(ps.filter((n) => !n.off).length); $("#stOff").textContent = String(ps.filter((n) => n.off).length);
  const s = [...times].sort((a, b) => a - b); $("#stMs").textContent = s.length ? msText(s[Math.floor(s.length / 2)]) : "–";
}

// ---------- one real check, drawn along the passport's own proof ----------
function check(p, { quiet, then } = {}) {
  if (!live() || W.byId[p.reg].dim || !p.shown) return false;
  const res = runCheck(R, p.rec, W.byId[p.reg].list), path = W.pathOf(p), refusedAtBit = !res.ok && res.reason === "revoked";
  const main = [W.byId.you.pos, p.pos, ...(refusedAtBit ? [] : [path.reg, path.root])];
  const lens = main.slice(1).map((q, i) => dist3(main[i], q)), total = lens.reduce((a, b) => a + b, 0);
  const reveal = () => {
    p.verdict = res.ok ? "valid" : res.reason; p.flash = 1; p.pulse = 1; W.byId.you.flash = 0.7;
    if (res.ok) { W.byId.root.flash = 0.6; W.byId[p.reg].flash = 0.7; } else if (refusedAtBit) W.byId[p.reg].spot = { ix: p.rec.status_idx, t: 1 };
    times.push(res.ms); if (times.length > 300) times.shift(); res.ok ? nValid++ : nRefused++;
    tags = [{ p, text: res.ok ? `valid · ${msText(res.ms)}` : `${res.reason === "revoked" ? "switched off" : res.reason} · ${msText(res.ms)}`, ok: res.ok, t: 2.6, age: 0 }];                    // one verdict on screen at a time
    if (!quiet) feedLine(p, res);
    stats(); if (sel === p) fillSheet(p, true); then && then(res);
  };
  if (RM.matches) { reveal(); return true; }
  threads.push({ p, main, lens, total, path, res, refusedAtBit, t: 0, dur: clamp(total / 1500, 0.7, 1.25), fade: 1, done: false, reveal });
  return true;
}
function feedLine(p, res) {
  const li = document.createElement("li"); li.innerHTML = `<span class="n"></span><span class="tag${res.ok ? "" : " no"}">${icon(res.ok ? "valid" : "revoked")}<span></span></span><span class="t"></span>`;
  li.querySelector(".n").textContent = short(p.rec.sub); li.querySelector(".tag span").textContent = res.ok ? "valid" : res.reason === "revoked" ? "switched off" : res.reason;
  li.querySelector(".t").textContent = `${p.reg} · ${new Date().toTimeString().slice(0, 8)} · ${msText(res.ms)}`;
  const ol = $("#checks"); ol.prepend(li); while (ol.children.length > 3) ol.lastChild.remove();
}
const along = (th, f) => { let d = f * th.total; for (let i = 0; i < th.lens.length; i++) { if (d <= th.lens[i] || i === th.lens.length - 1) return { i, pos: mix3(th.main[i], th.main[i + 1], clamp(d / (th.lens[i] || 1), 0, 1)) }; d -= th.lens[i]; } return { i: 0, pos: th.main[0] }; };

// ---------- the frame: what is drawn ----------
// Nothing appears or changes at once. Every part has a presence (0 to 1) that eases toward shown or hidden, a lift
// while it is pointed at, and, for a passport, how far it has turned from in service to switched off. A globe's dots
// are written in from the top, the way its list is counted, and the globe turns slowly. Under reduced motion each of
// these jumps to its end and nothing turns.
let clock = 0, motion = 0;
const ease = (x, to, rate, dt) => (RM.matches ? to : x + (to - x) * (1 - Math.exp(-rate * dt)));
const outBack = (t) => { const u = t - 1; return 1 + 2.70158 * u * u * u + 1.70158 * u * u; };          // arrives a little past, then settles
const bitOf = (p) => bitAt(W.byId[p.reg], p.rec.status_idx);
function scene(dt) {
  clock += dt;
  const L = lineSet, N = nodeSet; L.clear(); let ni = 0;
  const put = (pos, size, ink, shape = 0, tone = 0) => { if (ni < N.n && ink > 0.003) N.set(ni++, pos[0], pos[1], pos[2], size, ink, shape, tone); };
  const arc = (at, from, to, alpha, width, tone, seg) => { if (to - from < 1e-3) return; let a = at(from); for (let i = 1; i <= seg; i++) { const b = at(from + (to - from) * i / seg); L.add(a, b, alpha, width, tone); a = b; } };
  const circle = (rad) => (t) => [Math.cos(t * TAU) * rad, 0, Math.sin(t * TAU) * rad];
  const selPath = sel && sel.kind === "passport" ? W.pathOf(sel) : null;
  // a run of entries on a registrar's ring, drawn heavier: one hash of a proof stands for all of them
  const run = (r, lo, hi, alpha, tone, grow = 1) => { const a0 = lo - 0.32, a1 = a0 + (hi - 1 + 0.32 - a0) * grow; arc(r.ringAt, a0, a1, alpha, 3.2, tone, Math.max(2, Math.ceil((a1 - a0) * 3))); };
  const subject = [sel, hover, mark].find((n) => n && (n.kind === "witness" || n.kind === "open" || n.kind === "head"));
  // The world is alive while you only look: registrars travel along the orbit and each log's entries circle their
  // globe, slowly. The moment you choose something, come close, filter or take the walk, it holds still for you.
  const resting = !sel && !mark && !tour.on && !listOpen && !drag && !pinch && regFilter === "all" && cam.dist.x > 1150 && !cam.dist.on;
  motion = ease(motion, resting && !RM.matches ? 1 : 0, 1.6, dt); if (RM.matches) motion = 0;
  for (const r of W.regs) {                                             // each globe turns, and its dots are written in from the top
    r.ang += dt * 0.021 * motion; r.phase += dt * 0.06 * motion; r.place(); r.set.globe[0] = r.centre[0]; r.set.globe[1] = r.centre[1]; r.set.globe[2] = r.centre[2];
    if (!RM.matches) r.spin += dt * 0.028;
    const want = r.shown && clock >= r.born ? 1.12 : 0;
    r.reveal = RM.matches ? want : want > r.reveal ? Math.min(want, r.reveal + dt * 0.62) : Math.max(want, r.reveal - dt * 2.4);
    r.set.spin = r.spin; r.set.reveal = r.reveal;
  }
  for (const n of W.parts) {
    n.flash = Math.max(0, n.flash - dt * 1.4); n.pulse = Math.max(0, n.pulse - dt * 2.6);
    n.a = ease(n.a, n.shown && clock >= n.born ? 1 : 0, 7, dt);
    if (n.a < 0.01) continue;
    const on = n === sel || n === hover || n === mark; n.hv = ease(n.hv, on ? 1 : 0, 14, dt);
    const dim = n.reg && W.byId[n.reg]?.dim ? 0.16 : n.kind === "registrar" && n.dim ? 0.16 : 1, f = n.flash, k = n.a, grow = k < 0.999 ? Math.max(0, outBack(k)) : 1;
    if (n.kind === "epoch") { arc(circle(n.r), 0.25 - 0.5 * k, 0.25 + 0.5 * k, ((n.cur ? 0.55 : 0.2) + f * 0.4) * Math.min(1, k * 2), 1, 0, 96); continue; }      // an orbit draws itself from the front
    if (n.kind === "registrar") arc(n.ringAt, 0, (n.size + 1) * k, 0.2 * dim + f * 0.3, 1, 0, 80);                                                              // its log's ring
    if (n.kind === "list") { const r = W.byId[n.reg]; if (r.spot) { r.spot.t -= dt * 0.5; if (r.spot.t <= 0) r.spot = null; else put(bitAt(r, r.spot.ix), 3 + (1 - r.spot.t) * 26, r.spot.t * 0.8, 1); } continue; }
    if (n.kind === "root") { const br = RM.matches ? 0 : Math.sin(clock * 0.85); put(n.pos, n.r * grow, k, 3); put(n.pos, (n.r + 9 + br * 1.4) * grow, (0.4 + br * 0.08) * k, 1); }   // the root breathes, barely
    else if (n.kind === "registrar") put(n.pos, n.r * grow, dim * k, 3);
    else if (n.kind === "passport") {
      n.offA = ease(n.offA, n.off ? 1 : 0, 6, dt);                      // a moon closes into a ring as it is switched off
      const sz = (n.r + n.hv * 1.6 + n.pulse * 2.4) * grow * (1 - 0.24 * Math.sin(Math.PI * n.offA));
      if (n.offA < 0.98) put(n.pos, sz, dim * k * (1 - n.offA), 3);
      if (n.offA > 0.02) put(n.pos, sz, dim * k * n.offA, 1);
      if (n.hv > 0.02) L.add(n.pos, bitOf(n), 0.7 * dim * n.hv, 1.3);
    }
    else if (n.kind === "leaf") put(n.pos, n.r * grow, 0.42 * dim * k);
    else if (n.kind === "head") put(n.pos, (n.r + n.hv) * grow, 0.7 * dim * k, 1);
    else if (n.kind === "witness") put(n.pos, (n.r + n.hv) * grow, k, 3);
    else if (n.kind === "open") { if (subject) put(n.pos, n.r * grow, 0.8 * k, 1); }
    else if (n.kind === "you") { put(n.pos, n.r * grow, k, 0, 1); put(n.pos, (n.r + 6 + f * 10) * grow, 0.45 * k, 1, 1);
      if (!RM.matches) { const ph = (clock % 3.2) / 3.2; put(n.pos, n.r + 6 + ph * 30, (1 - ph) * (1 - ph) * 0.3 * k, 1, 1); } }   // a slow beacon: you are listening
    if (f > 0.02) put(n.pos, n.r + 5 + (1 - f) * 22, f * 0.5, 1, n.kind === "you" ? 1 : 0);
    if (n.hv > 0.02 && n.kind !== "you") put(n.pos, n.r + 3 + n.hv * 2.5, 0.9 * n.hv, 1);
  }
  if (subject) for (const l of W.links) {                               // the witness cosigns each log's head: shown when that is the subject
    if (!l.a.shown || !l.b.shown) continue;
    L.add(l.a.pos, l.b.pos, 0.34, 1, 0, l.kind === "dash" ? 1 : 0);
  }
  if (selPath && sel.shown) {                                           // the chosen passport's proof, held in ink
    const h = sel.hv; L.add(sel.pos, selPath.reg, 0.7 * h, 1.3); L.add(selPath.reg, selPath.root, 0.7 * h, 1.3);
    selPath.sib.forEach((x, i) => run(W.byId[sel.reg], x.lo, x.hi, 0.85, 0, clamp(h * selPath.sib.length * 1.2 - i, 0, 1)));
  }
  for (const th of threads) {                                           // a check in flight, in the signal colour
    if (!th.done) { th.t += dt / th.dur; if (th.t >= 1) { th.t = 1; th.done = true; th.reveal(); } } else th.fade -= dt * 1.5;
    const a = clamp(th.fade, 0, 1), head = along(th, th.t), tone = th.refusedAtBit && th.done ? 0 : 1;
    for (let i = 0; i < head.i; i++) L.add(th.main[i], th.main[i + 1], 0.95 * a, 1.9, tone);
    L.add(th.main[head.i], head.pos, 0.95 * a, 1.9, tone);
    if (!th.done) { put(head.pos, 7, 0.9, 2, 1); put(head.pos, 2.6, 1, 0, 1); }
    const leafAt = th.lens[0] / th.total;
    if (th.t > leafAt) {                                                // from the entry to its status bit; and the proof, one run of entries after another
      const g = clamp((th.t - leafAt) / Math.max(0.001, th.refusedAtBit ? 1 - leafAt : 0.3), 0, 1), end = mix3(th.p.pos, bitOf(th.p), g), m = th.path.sib.length;
      L.add(th.p.pos, end, 0.95 * a, th.refusedAtBit ? 2.4 : 1.6, th.refusedAtBit ? 0 : 1);
      if (!th.refusedAtBit) th.path.sib.forEach((x, i) => run(W.byId[th.p.reg], x.lo, x.hi, 0.8 * a, 0, clamp(g * m * 1.15 - i, 0, 1)));   // the proof is the record's, so it is ink; blue is yours alone
    }
  }
  threads = threads.filter((th) => th.fade > 0);
  N.count = ni; N.touch();
}

// ---------- labels: placed by priority, never overlapping; each is a click target; each fades in ----------
// Where the page's own controls are, so that no name or verdict is drawn over them. Measured a few times a second.
let chromeAt = -1, chromeBoxes = [], lastNames = [], lastPills = [], youBox = null, youWas = null;
function chromeRects() {
  if (clock - chromeAt < 0.25 && chromeAt >= 0) return chromeBoxes; chromeAt = clock;
  chromeBoxes = [".top .brand", ".top .crumb", ".top__r", "#regSeg", "#feed", "#tools", "#time", "#caption", "#about", "#sheet"].map((q) => document.querySelector(q)).filter((el) => el && !el.hidden && el.getClientRects().length)
    .map((el) => { const r = el.getBoundingClientRect(); return [r.left - 4, r.top - 4, r.width + 8, r.height + 8]; }).filter((r) => r[0] < vw && r[1] < vh && r[2] > 8 && r[3] > 8);
  return chromeBoxes;
}
// A registrar's name may also stand beside its ring, right or left, level with the globe.
function beside(n, w, h) { if (!n.centre || !n.ringR) return []; const q = proj(n.centre); if (!q.ok) return []; const r = n.ringR * scaleCss / q.w + 8; return [[q.x + r, q.y - h / 2], [q.x - r - w, q.y - h / 2]]; }
function labels(dt) {
  const c = lx; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, vw, vh); hits = [];
  const cand = [], zoomed = cam.dist.x < 1150, drawn = new Set(); youWas = youBox; youBox = null;
  for (const n of W.parts) {
    if (n.a < 0.6 || !n.shown || !n.label && n.kind !== "you") continue;
    const p = proj(n.labelAt || n.pos); if (!p.ok || p.x < -40 || p.x > vw + 40 || p.y < 0 || p.y > vh) continue;
    const tag = tags.find((t) => t.p === n), on = n === sel || n === hover || n === mark;
    let pri = { you: 100, root: 90, registrar: 80, witness: 60, open: 40, epoch: 50, list: 45, head: 42, passport: 20 }[n.kind] ?? 0;
    if (n.kind === "epoch" && !n.cur) { if (!zoomed && !on) continue; pri = 8; }
    if ((n.kind === "passport" || n.kind === "head") && !zoomed && !on && !tag) continue;
    if ((n.kind === "witness" || n.kind === "epoch") && !zoomed && !on && !tour.on) continue;   // named when you come close, point at it, or take the walk
    if (n.kind === "open" && !on && !(mark && (mark.kind === "head" || mark.kind === "witness"))) continue;
    if (on) pri += 200; if (tag) pri += 150;
    const dim = (n.reg && W.byId[n.reg]?.dim) || n.dim;
    if (dim && !on) continue;
    const rpx = n.labelAt ? 0 : (n.r + (n.kind === "root" ? 10 : 0)) * scaleCss / p.w;
    cand.push({ n, p, pri, tag, on, rpx, text: n.kind === "you" ? "YOU ARE HERE" : n.kind === "passport" && n.off && !tag ? `${n.label} · off` : n.label });
  }
  cand.sort((a, b) => b.pri - a.pri || a.p.w - b.p.w);
  const boxes = [], chrome = chromeRects();
  const hit = (q, o) => q[0] < o[0] + o[2] && q[0] + q[2] > o[0] && q[1] < o[1] + o[3] && q[1] + q[3] > o[1];
  const inChrome = (q) => q[0] < 0 || q[0] + q[2] > vw || q[1] < 0 || q[1] + q[3] > vh || chrome.some((o) => hit(q, o)), clash = (q) => boxes.some((o) => hit(q, o));
  // Its text, its size and the places it may take, best first; those over the page's controls or past the screen's
  // edge are left out. Nothing is written over the controls: when the first place is taken by them, a name or a
  // verdict moves to its next one. A verdict has spare places beside YOU ARE HERE, where its thread begins, and then
  // down the middle of what the panels leave free; where that is narrower than the verdict, it is written without
  // its time, and where that is still too wide, as the verdict alone. A name is left out only while none of its places
  // is free.
  const lo = capSide() ? capPx - 12 : 0, hi = vw - (sheetOpen() && !phone() ? sheetPx - 8 : 0);
  const places = (k) => {
    const you = k.n.kind === "you", pill = you || k.tag; c.font = `${pill ? 600 : 400} ${pill ? 11 : 12}px ${MONO}`;
    let text = k.tag ? `${k.text} · ${k.tag.text}` : k.text, w = c.measureText(text).width + (pill ? 20 : 0); const h = pill ? 22 : 16;
    if (k.tag) for (const t of [`${k.text} · ${k.tag.text.split(" · ")[0]}`, k.tag.text.split(" · ")[0]]) { if (w <= hi - lo - 16) break; text = t; w = c.measureText(t).width + 20; }
    const mid = clamp(k.p.x - w / 2, 8, vw - w - 8), box = (x, y) => [x - 3, y - 2, w + 6, h + 4], yb = youBox || youWas;
    const spots = you ? [[mid, k.p.y - k.rpx - 34], [mid, k.p.y + k.rpx + 16], [Math.min(k.p.x + k.rpx + 14, vw - w - 8), k.p.y - h / 2], [Math.max(8, k.p.x - k.rpx - 14 - w), k.p.y - h / 2]]
      : pill ? [[Math.min(k.p.x + k.rpx + 8, vw - w - 8), k.p.y - h / 2], [Math.max(8, k.p.x - k.rpx - 8 - w), k.p.y - h / 2], [mid, k.p.y + k.rpx + 10], [mid, k.p.y - k.rpx - 10 - h]]
      : k.n.labelCentre ? [[k.p.x - w / 2, k.p.y + 2], ...(k.n.labelAlt ? [proj(k.n.labelAlt)].filter((q) => q.ok).map((q) => [q.x - w / 2, q.y - h - 2]) : []), ...beside(k.n, w, h)]
      : [[k.p.x + k.rpx + 8, k.p.y - h / 2], [k.p.x - k.rpx - 8 - w, k.p.y - h / 2], [k.p.x - w / 2, k.p.y + k.rpx + 6], [k.p.x - w / 2, k.p.y - k.rpx - 6 - h]];
    if (k.tag && yb) { for (let j = 1; j <= 3; j++) spots.push([clamp(yb[0] + yb[2] / 2 - w / 2, 8, vw - w - 8), yb[1] + 2 - j * (h + 8)]); spots.push([yb[0] + yb[2] + 8, yb[1] + 2], [yb[0] - 8 - w, yb[1] + 2]); }
    if (k.tag) for (let y = vh - 44; y > 60; y -= h + 8) spots.push([(lo + hi - w) / 2, y]);     // last, the middle of the free area, from the foot up
    return { you, pill, text, w, h, above: spots[0], free: spots.map(([x, y]) => [x, y, box(x, y)]).filter((s) => !inChrome(s[2])) };
  };
  // YOU ARE HERE and the verdicts are placed together, before the names: YOU takes the first of its places that leaves
  // every verdict a free one, so that neither is written over the other. Where no place of YOU does that, the
  // verdicts go first and YOU takes a place clear of them if it has one.
  const fixed = new Map(), pills = [], me = cand.find((k) => k.n.kind === "you"), verdicts = cand.filter((k) => k.tag);
  if (me) {
    for (const s of places(me).free) {
      youBox = s[2]; boxes.length = 0; boxes.push(s[2]); const got = [];
      for (const k of verdicts) { const at = places(k).free.find((f) => !clash(f[2])); if (!at) break; got.push([k, at]); boxes.push(at[2]); }
      if (got.length === verdicts.length) { fixed.set(me, s); for (const [k, at] of got) fixed.set(k, at); break; }
    }
    if (!fixed.size) { youBox = null; boxes.length = 0; }
    pills.push(...boxes);
  }
  for (const k of cand) {
    const { you, pill, text, w, h, above, free } = places(k), clear = (q) => !pills.some((o) => hit(q, o));
    const at = fixed.get(k) || free.find((s) => !clash(s[2])) || (pill || k.on ? free.find((s) => clear(s[2])) || free[0] : null);
    if (!at) continue;
    const [x, y, b] = at;
    if (!fixed.has(k)) boxes.push(b); hits.push({ b, n: k.n }); if (you) youBox = b; if (pill && !fixed.has(k)) pills.push(b);
    if (pill) {
      const fillC = you ? sigCss : k.tag.ok ? paperCss : inkCss;
      let a = k.n.a, s = 1;
      if (k.tag) { k.tag.age += dt; const u = RM.matches ? 1 : Math.min(1, k.tag.age / 0.22); a = Math.min(1, k.tag.age / 0.12) * clamp(k.tag.t / 0.4, 0, 1); s = 0.9 + 0.1 * outBack(u); }   // a verdict arrives: a small pop, then still
      c.save(); c.translate(x + w / 2, y + h / 2); c.scale(s, s); c.translate(-(x + w / 2), -(y + h / 2));
      c.globalAlpha = a; c.beginPath(); c.roundRect(x, y, w, h, 11); c.fillStyle = fillC; c.fill();
      if (!you && k.tag.ok) { c.strokeStyle = inkCss; c.lineWidth = 1; c.stroke(); }
      c.fillStyle = you || !k.tag.ok ? paperCss : inkCss; c.textBaseline = "middle"; c.fillText(text, x + 10, y + h / 2 + 0.5);
      if (you && x === above[0] && y === above[1]) { c.fillStyle = sigCss; c.fillRect(k.p.x - 0.5, y + h, 1, 12); }
      c.restore(); c.globalAlpha = 1;
    } else {
      drawn.add(k.n); k.n.la = RM.matches ? 1 : Math.min(1, k.n.la + dt * 6);
      c.globalAlpha = k.n.la; c.textBaseline = "middle"; c.lineWidth = 3; c.strokeStyle = paperCss; c.strokeText(text, x, y + h / 2 + 0.5);
      c.fillStyle = k.on || k.n.kind === "root" || k.n.kind === "registrar" ? inkCss : ink2Css; c.fillText(text, x, y + h / 2 + 0.5); c.globalAlpha = 1;
    }
  }
  for (const n of W.parts) if (!drawn.has(n)) n.la = 0;
  lastNames = [...drawn].map((n) => n.label); lastPills = hits.filter((x) => x.n.kind === "you" || tags.some((t) => t.p === x.n)).map((x) => (x.n.kind === "you" ? "you" : x.n.label));
  for (const t of tags) t.t -= dt; tags = tags.filter((t) => t.t > 0);
}

// ---------- pointing: parts, then labels, then single status bits ----------
function pick(x, y) {
  let best = null, bd = 1e9;
  for (const n of W.parts) {
    if (!n.shown || n.kind === "epoch" || n.kind === "list" || (n.reg && W.byId[n.reg]?.dim)) continue;
    const p = proj(n.pos); if (!p.ok) continue;
    const d = Math.hypot(p.x - x, p.y - y), lim = Math.max(n.r * scaleCss / p.w + 5, n.kind === "node" ? 9 : 14);
    if (d < lim && d < bd) { best = n; bd = d; }
  }
  if (best) return best;
  for (const h of hits) if (x >= h.b[0] && x <= h.b[0] + h.b[2] && y >= h.b[1] && y <= h.b[1] + h.b[3]) return h.n;
  for (const r of W.regs) {
    if (r.dim || !r.shown) continue; let bi = -1; bd = 7;
    for (let i = 0; i < r.list.bit_len; i++) { const b = bitAt(r, i); if ((b[0] - r.centre[0]) * (eye[0] - b[0]) + (b[1] - r.centre[1]) * (eye[1] - b[1]) + (b[2] - r.centre[2]) * (eye[2] - b[2]) < 0) continue;   // the far side cannot be pointed at
      const p = proj(b); if (!p.ok) continue; const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; bi = i; } }
    if (bi >= 0) {
      const rec = r.used.get(bi), pp = rec && W.byId[`pp:${rec.sub}`];
      return { id: `bit:${r.id}:${bi}`, kind: "bit", pos: bitAt(r, bi), r: 2.5, shown: true, flash: 0, reg: r.id, info: { k: `STATUS BIT ${bi} · ${r.id.toUpperCase()}`, t: r.bits[bi] ? `Bit ${bi}: set` : `Bit ${bi}: clear`,
        rows: [["List", `${r.id}'s signed status list`], ["Belongs to", pp && pp.shown ? short(rec.sub) : "no passport in this record"], ["Means", r.bits[bi] ? "that passport is switched off; every verifier that checks refuses it" : pp && pp.shown ? "that passport is in service" : "not in use yet"]] } };
    }
  }
  return null;
}

const ptrs = new Map(); let drag = null, pinch = null, moved = 0, hist = [];
cv.addEventListener("pointerdown", (e) => {
  cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  for (const s of [cam.yaw, cam.pitch, cam.dist]) { s.on = false; s.v = 0; } cam.vyaw = cam.vpitch = 0;       // grab it mid-flight
  if (ptrs.size === 1) { drag = { x: e.clientX, y: e.clientY, yaw: cam.yaw.x, pitch: cam.pitch.x }; moved = 0; hist = [{ t: e.timeStamp, x: e.clientX, y: e.clientY }]; cv.classList.add("grabbing"); }
  else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: cam.dist.x }; drag = null; }
});
cv.addEventListener("pointermove", (e) => {
  const was = ptrs.get(e.pointerId);
  if (!was) {                                                           // hovering: name what is under the pointer
    if (e.pointerType === "mouse") { const n = pick(e.clientX, e.clientY); hover = n && n.kind !== "bit" ? n : null; cv.classList.toggle("point", !!n); }
    return;
  }
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && ptrs.size === 2) { const [a, b] = [...ptrs.values()]; let d = pinch.dist * pinch.d / Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)); if (d < DIST[0]) d = DIST[0] - rubber(DIST[0] - d, 300); if (d > DIST[1]) d = DIST[1] + rubber(d - DIST[1], 600); cam.dist.jump(d); return; }
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y; moved = Math.max(moved, Math.hypot(dx, dy));
  if (moved < 6) return;                                                // a small threshold before a press becomes a drag
  cam.yaw.jump(drag.yaw - dx * 0.0052); let p = drag.pitch + dy * 0.0042;
  if (p < PITCH[0]) p = PITCH[0] - rubber(PITCH[0] - p, 0.5); if (p > PITCH[1]) p = PITCH[1] + rubber(p - PITCH[1], 0.5);
  cam.pitch.jump(p); hist.push({ t: e.timeStamp, x: e.clientX, y: e.clientY }); if (hist.length > 6) hist.shift();
});
function release(e) {
  if (!ptrs.has(e.pointerId)) return; ptrs.delete(e.pointerId); cv.classList.remove("grabbing");
  if (pinch) { pinch = null; cam.dist.set(0.4, 1).go(clamp(cam.dist.x, DIST[0], DIST[1])); drag = null; return; }
  if (!drag) return;
  if (moved < 6) { const n = pick(e.clientX, e.clientY); if (n) { select(n); if (phone() || SHORT.matches) focusOn(n); } else closeSheet(); }
  else if (!RM.matches && hist.length > 1) {                           // the flick's own speed carries on
    const a = hist[0], b = hist[hist.length - 1], t = Math.max(1, b.t - a.t) / 1000;
    cam.vyaw = -(b.x - a.x) / t * 0.0052; cam.vpitch = (b.y - a.y) / t * 0.0042;
  }
  if (cam.pitch.x < PITCH[0] || cam.pitch.x > PITCH[1]) { cam.vpitch = 0; cam.pitch.set(0.4, 1).go(clamp(cam.pitch.x, PITCH[0], PITCH[1])); }
  drag = null;
}
cv.addEventListener("pointerup", release); cv.addEventListener("pointercancel", release);
cv.addEventListener("pointerleave", () => { hover = null; cv.classList.remove("point"); });
cv.addEventListener("wheel", (e) => { e.preventDefault(); cam.dist.set(0.3, 1).go(clamp((cam.dist.on ? cam.dist.to : cam.dist.x) * Math.exp(e.deltaY * 0.0012), DIST[0], DIST[1])); }, { passive: false });
function physics(dt) {
  if (!drag) {
    if (cam.vyaw || cam.vpitch) {                                       // momentum, decaying like a scroll
      cam.yaw.jump(cam.yaw.x + cam.vyaw * dt); const k = Math.pow(0.05, dt); cam.vyaw *= k; if (Math.abs(cam.vyaw) < 0.01) cam.vyaw = 0;
      if (cam.vpitch) { const p = cam.pitch.x + cam.vpitch * dt; cam.vpitch *= k; if (p < PITCH[0] || p > PITCH[1] || Math.abs(cam.vpitch) < 0.01) { cam.vpitch = 0; cam.pitch.set(0.5, 0.8).go(clamp(p, PITCH[0], PITCH[1])); } else cam.pitch.jump(p); }
    }
  }
  for (const s of SPR) s.step(dt);
}

// ---------- details: a sheet (right on wide screens, a bottom sheet on phones) ----------
const sheet = $("#sheet"), phone = () => matchMedia("(max-width: 760px)").matches && !SHORT.matches;
function placeSheet() { const v = sheetPos.x; sheet.style.transform = phone() ? `translateY(calc(${v * 100}% + ${v * 24}px))` : `translateX(calc(${v * 100}% + ${v * 24}px))`; sheet.setAttribute("aria-hidden", String(v > 0.98)); sheet.inert = v > 0.98; }
function openSheet() { sheetPx = sheet.offsetWidth + 16; sheetH = sheet.offsetHeight; sheetPos.set(0.42, 1).go(0); document.body.classList.add("detail"); }
// When the details close during the walk, the caption comes back and the view returns to the stop it describes.
function closeSheet(v, quiet) { if (sheetPos.to === 1 && !sel) return; sheetPos.set(0.42, 1).go(1, v); sel = null; document.body.classList.remove("detail"); if (tour.on && !quiet) tourShow(tour.i); }
new ResizeObserver(() => { sheetPx = sheet.offsetWidth + 16; sheetH = sheet.offsetHeight; }).observe(sheet);   // its height follows what it says
const act = $("#shCheck");
function setAct(state, ok) { act.dataset.state = state; if (ok !== undefined) act.dataset.ok = String(ok); for (const el of act.querySelectorAll(".act__s")) el.setAttribute("aria-hidden", String(el.dataset.s !== state)); }
function fillSheet(n, keepAction) {
  $("#shIc").innerHTML = icon(KIND_ICON[n.kind] || "info"); $("#shK").textContent = n.info.k; $("#shT").textContent = n.info.t;
  const dl = $("#shD"); dl.textContent = ""; for (const [k, v] of n.info.rows) { const dt = document.createElement("dt"), dd = document.createElement("dd"); dt.textContent = k; dd.textContent = v; dl.append(dt, dd); }
  const V = $("#shV"); V.textContent = ""; const pp = n.kind === "passport";
  if (pp) {
    const d = document.createElement("div");
    if (n.verdict) { const ok = n.verdict === "valid"; d.className = `verdict${ok ? "" : " no"}`; d.innerHTML = icon(ok ? "valid" : "revoked") + "<span></span>"; d.lastChild.textContent = ok ? "Valid. Checked in this tab by the shipped verifier, against the published directory." : n.verdict === "revoked" ? "Switched off. Its registrar set its status bit, so every verifier that checks refuses it." : `Refused: ${n.verdict}.`; }
    else { d.className = "verdict"; d.innerHTML = "<span></span>"; d.lastChild.textContent = live() ? "Not checked in this tab yet." : "Checks run on the record as it stands now. Move the timeline to the end."; }
    V.append(d);
    const path = W.pathOf(n), r = W.byId[n.reg], ol = $("#shSteps"); ol.textContent = "";
    const li = (a, b) => { const x = document.createElement("li"); x.textContent = a; if (b) { const s = document.createElement("span"); s.textContent = b; x.append(s); } ol.append(x); };
    li("The registrar's two signatures on the passport", "Ed25519 and ML-DSA-65, both required");
    li(`Entry ${n.rec.leaf_index} of ${n.rec.checkpoint_size} in ${r.id}'s log`, path.sib.length ? `${path.sib.length} hashes: ${path.sib.map((s) => `${s.hi - s.lo === 1 ? `entry ${s.lo}` : `entries ${s.lo}–${s.hi - 1}`} ${s.hash.slice(0, 8)}…`).join(", ")}` : "its inclusion proof");
    li("The log's head, signed by the registrar's delegate", `${n.rec.checkpoint_root.slice(0, 20)}…`);
    li(`${r.id}, named in directory epoch ${W.CUR}`); li("The directory, signed by the root's two keys");
    li(`Bit ${n.rec.status_idx} of the signed status list`, r.bitsFinal[n.rec.status_idx] ? "set: switched off" : "clear: in service");
    $("#shCopyTxt").textContent = n.rec.sub;
  }
  $("#shProof").hidden = !pp; $("#shCopy").hidden = !pp; act.hidden = !pp; $("#shFocus").hidden = n.kind === "bit";
  if (pp && !keepAction) setAct("idle");
}
function select(n) { sel = n; fillSheet(n); openSheet(); if (n.kind === "passport" && live() && !n.verdict) check(n); }
function focusOn(n) {
  const r = n.reg ? W.byId[n.reg] : n.kind === "registrar" ? n : null;
  flyTo(r ? r.centre : n.pos, n.kind === "root" ? 560 : n.kind === "you" ? 900 : r ? fit(r.ringR) : 560, { yaw: r ? 0.16 : undefined, pitch: 0.32 });   // a registrar and its whole ring, from the front
}
$("#sheetX").addEventListener("click", () => closeSheet());
$("#shFocus").addEventListener("click", () => sel && focusOn(sel));
let actT = 0;
act.addEventListener("click", () => {
  if (!sel || sel.kind !== "passport" || act.dataset.state === "busy") return;
  if (!live()) { applyStep(W.events.length); setPlaying(false); }
  const p = sel, t0 = performance.now(); setAct("busy"); clearTimeout(actT);
  check(p, { then: (res) => { const show = () => { if (sel !== p) return; $("#actIc").innerHTML = icon(res.ok ? "valid" : "revoked"); $("#actTxt").textContent = `${res.ok ? "Valid" : res.reason === "revoked" ? "Switched off" : "Refused"} · ${msText(res.ms)}`; setAct("done", res.ok); $("#actLive").textContent = $("#actTxt").textContent; actT = setTimeout(() => sel === p && setAct("idle"), 2600); };
    setTimeout(show, Math.max(0, 450 - (performance.now() - t0))); } });      // a working state is held long enough to be read
});
$("#shCopyBtn").addEventListener("click", async () => { try { await navigator.clipboard.writeText($("#shCopyTxt").textContent); swapIcon($("#shCopyIc"), "check"); $("#shCopyLive").textContent = "Copied"; setTimeout(() => { swapIcon($("#shCopyIc"), "copy"); $("#shCopyLive").textContent = ""; }, 1600); } catch { $("#shCopyLive").textContent = "Could not copy"; } });
{ // the phone sheet follows the finger and can be thrown away
  let g = null;
  sheet.addEventListener("pointerdown", (e) => { if (!phone() || $("#sheetIn").scrollTop > 0 || e.target.closest("button,a,input")) return; g = { y: e.clientY, at: sheetPos.x, h: sheet.offsetHeight + 24, hist: [{ t: e.timeStamp, y: e.clientY }], id: e.pointerId }; });
  sheet.addEventListener("pointermove", (e) => { if (!g || e.pointerId !== g.id) return; const d = (e.clientY - g.y) / g.h; if (Math.abs(e.clientY - g.y) < 6) return; sheet.setPointerCapture(g.id); sheetPos.jump(d < 0 ? -rubber(-d, 0.3) + g.at : g.at + d); g.hist.push({ t: e.timeStamp, y: e.clientY }); if (g.hist.length > 5) g.hist.shift(); });
  const up = (e) => { if (!g || e.pointerId !== g.id) return; const a = g.hist[0], b = g.hist[g.hist.length - 1], v = (b.y - a.y) / Math.max(1, b.t - a.t) * 1000 / g.h; const rest = sheetPos.x + coast(v * 1000, 0.99) / 1000; g = null; rest > 0.5 ? closeSheet(v) : sheetPos.set(0.42, 0.85).go(0, v); };
  sheet.addEventListener("pointerup", up); sheet.addEventListener("pointercancel", up);
}

// ---------- the walk-through: seven stops, each a flight you can grab ----------
const tour = { on: false, i: 0, timer: 0, stops: [] };
function makeTour() {
  const r0 = W.regs[0], okP = W.parts.find((n) => n.kind === "passport" && n.reg === r0.id && !n.rec.revoked), ev = W.events.findIndex((e) => e.type === "change" && e.reg === r0.id && e.on);
  const offP = ev >= 0 ? W.byId[`pp:${r0.used.get(W.events[ev].idx[0])?.sub}`] : null;
  tour.stops = [
    { t: "The root", p: "One root, with two keys of different kinds (Ed25519 and SLH-DSA). It signs one thing, the directory of registrars. It issues no passports and sees no traffic. This one is a test root: the real one is made at a public ceremony.", go: () => flyTo([0, 10, 0], 560, { pitch: 0.35, yaw: 0.5 }) },
    { t: "The directory", p: `The orbit is the directory, epoch ${W.CUR}: the short list of registrars the root vouches for, signed again at least every 92 days. The fainter rings inside are the epochs it replaced.`, go: () => flyTo([0, 0, 0], Math.max(1350, fit(W.RING + 150)), { pitch: 1.0, yaw: 0.3 }) },
    { t: "A registrar", p: `${r0.id} issues passports to the agents of the companies it has checked, and it alone can switch them off. It stands on the orbit because the directory names it.`, go: () => flyTo(r0.centre, fit(r0.ringR) * 1.1, { pitch: 0.3, yaw: 0.2 }) },
    { t: "Its log", p: `Every passport is written into the registrar's log before it counts. The ring around the globe is that log: ${r0.size} entries in order, each passport a moon at its own entry. All of them are hashed into one signed head, so nothing can be changed or removed unseen, and the witness cosigns each head.`, go: () => { mark = W.byId[r0.headId]; flyTo(r0.centre, fit(r0.ringR), { pitch: 0.42, yaw: 0.1 }); } },
    { t: "Its status list", p: `The ${r0.list.bit_len.toLocaleString("en")} dots of this globe are the registrar's status list, signed as one small file. Each passport owns one dot, counted from the top: full while it is in service, hollow once it is switched off. Anyone can hold a copy, so checking needs nobody's permission.`, go: () => flyTo([r0.centre[0], r0.centre[1] + r0.globeR * 0.5, r0.centre[2]], fit(r0.globeR) * 1.05, { pitch: 0.7, yaw: 0.25 }) },
    { t: "You, the verifier", p: "You stand outside the network holding copies. The blue thread is a real check of one passport, run in this tab: its entry in the log, the registrar, the directory, the root, and its status bit. The heavy arcs are its proof: a few hashes that stand for the rest of the log.", go: () => { resetView(); mark = okP; if (okP) tour.timer = setTimeout(() => { if (!live()) applyStep(W.events.length, true); check(okP); }, RM.matches ? 0 : 900); } },
    { t: "The off switch", p: offP ? `Watch ${short(offP.rec.sub)}. Its registrar sets one bit, and every verifier that checks refuses that agent, each within the freshness window it chose, with no call to anyone. The refusal you see is this tab's own.` : "A registrar sets one bit, and every verifier that checks refuses that passport, each within the freshness window it chose.", go: () => {
      if (!offP) return; mark = offP; flyTo([r0.centre[0], r0.centre[1] + r0.globeR * 0.6, r0.centre[2]], fit(r0.ringR) * 0.9, { pitch: 0.6, yaw: 0.2 });
      applyStep(ev, true); tour.timer = setTimeout(() => { applyStep(ev + 1); tour.timer = setTimeout(() => { applyStep(W.events.length, true); offP.verdict = null; check(offP); }, RM.matches ? 0 : 1300); }, RM.matches ? 0 : 1200); } },
  ];
  const lad = $("#ladder"); tour.stops.forEach((s, i) => { const li = document.createElement("li"), b = document.createElement("button"); b.type = "button"; b.title = s.t; b.setAttribute("aria-label", `Stop ${i + 1}: ${s.t}`); b.addEventListener("click", () => tourShow(i)); li.append(b); lad.append(li); });
}
// On a short screen a stop's text may be longer than its box: it scrolls, by finger or keys, and fades where more
// follows. The caption is measured whenever it appears or changes size, also after it gave way to the details.
function capMore() { const cp = $("#capP"), over = cp.scrollHeight > cp.clientHeight + 1; if (over) cp.tabIndex = 0; else cp.removeAttribute("tabindex"); cp.classList.toggle("more", over && cp.scrollTop + cp.clientHeight < cp.scrollHeight - 2); }
$("#capP").addEventListener("scroll", capMore, { passive: true });
function measureCap() { const cap = $("#caption"); if (cap.offsetWidth) { capPx = cap.offsetWidth + 24; capTop = cap.offsetTop; capMore(); } }
new ResizeObserver(measureCap).observe($("#caption"));
function tourShow(i) {
  clearTimeout(tour.timer); mark = null; tour.i = clamp(i, 0, tour.stops.length - 1); const s = tour.stops[tour.i];
  if (!live()) applyStep(W.events.length, true); setPlaying(false);
  $("#capN").textContent = `${tour.i + 1} / ${tour.stops.length}`; $("#capT").textContent = s.t; const cp = $("#capP"); cp.textContent = s.p; cp.scrollTop = 0; measureCap();
  [...$("#ladder").querySelectorAll("button")].forEach((b, k) => k === tour.i ? b.setAttribute("aria-current", "step") : b.removeAttribute("aria-current"));
  $("#capPrev").disabled = tour.i === 0; $("#capNext").textContent = tour.i === tour.stops.length - 1 ? "Finish" : "Next"; s.go();
}
function tourStart() { tour.on = true; document.body.classList.add("touring"); closeSheet(undefined, true); $("#caption").hidden = false; measureCap(); capShift.go(1); $("#tourBtn").setAttribute("aria-pressed", "true"); tourShow(0); }
function tourEnd() { tour.on = false; document.body.classList.remove("touring"); mark = null; capShift.go(0); clearTimeout(tour.timer); if (!live()) applyStep(W.events.length, true); $("#caption").hidden = true; $("#tourBtn").setAttribute("aria-pressed", "false"); resetView(); }
$("#tourBtn").addEventListener("click", () => (tour.on ? tourEnd() : tourStart()));
$("#capPrev").addEventListener("click", () => tourShow(tour.i - 1)); $("#capNext").addEventListener("click", () => (tour.i === tour.stops.length - 1 ? tourEnd() : tourShow(tour.i + 1))); $("#capEnd").addEventListener("click", tourEnd);

// ---------- finding a passport ----------
const findIn = $("#find"), findList = $("#findList"); let found = [], foundAt = 0;
function renderFound() { findList.textContent = ""; found.forEach((n, i) => { const li = document.createElement("li"), b = document.createElement("button"); b.type = "button"; b.setAttribute("role", "option"); b.setAttribute("aria-selected", String(i === foundAt)); b.textContent = n.rec.sub.replace(/^ainra:/, ""); b.addEventListener("click", () => choose(n)); li.append(b); findList.append(li); }); findList.classList.toggle("on", found.length > 0); const row = findList.children[foundAt]; if (row) findList.scrollTop = Math.max(0, row.offsetTop + row.offsetHeight - findList.clientHeight + 4); }
function choose(n) { if (!eng) return; findList.classList.remove("on"); findIn.value = ""; found = []; findIn.blur(); if (!live()) applyStep(W.events.length, true); if (W.byId[n.reg].dim) setReg("all"); if (listOpen) toggleList(false); select(n); focusOn(n); }   // the details first: the flight is fitted to what they leave free
findIn.addEventListener("input", () => { const q = findIn.value.trim().toLowerCase(); found = q ? W.parts.filter((n) => n.kind === "passport" && n.rec.sub.toLowerCase().includes(q)).slice(0, 8) : []; foundAt = 0; renderFound(); });
findIn.addEventListener("keydown", (e) => { if (e.key === "ArrowDown") { foundAt = Math.min(found.length - 1, foundAt + 1); renderFound(); e.preventDefault(); } else if (e.key === "ArrowUp") { foundAt = Math.max(0, foundAt - 1); renderFound(); e.preventDefault(); } else if (e.key === "Enter" && found[foundAt]) choose(found[foundAt]); else if (e.key === "Escape") { findIn.value = ""; found = []; renderFound(); findIn.blur(); } });
findIn.addEventListener("blur", () => setTimeout(() => findList.classList.remove("on"), 150));

// ---------- segmented controls ----------
function makeSeg(box, opts, start, onChoose) {
  const pill = document.createElement("i"); pill.className = "seg__pill"; box.append(pill);
  const btns = opts.map((o) => { const b = document.createElement("button"); b.type = "button"; for (const part of [].concat(o.label)) { if (typeof part === "string") b.append(part); else { const sp = document.createElement("span"); sp.className = part[0]; sp.textContent = part[1]; b.append(sp); } } if (o.title) b.title = o.title; b.addEventListener("click", () => { set(o.id); onChoose(o.id); }); box.append(b); return b; });
  function set(id) { const i = Math.max(0, opts.findIndex((o) => o.id === id)); btns.forEach((b, k) => b.setAttribute("aria-pressed", String(k === i))); const b = btns[i]; pill.style.width = `${b.offsetWidth}px`; pill.style.transform = `translateX(${b.offsetLeft}px)`; }
  set(start); addEventListener("resize", () => set(opts[btns.findIndex((b) => b.getAttribute("aria-pressed") === "true")].id)); document.fonts?.ready.then(() => set(opts[btns.findIndex((b) => b.getAttribute("aria-pressed") === "true")].id));
  return { set };
}
let regSeg = null, regFilter = "all";
function setReg(id) { regFilter = id; for (const r of W.regs) r.dim = id !== "all" && r.id !== id; for (const r of W.regs) fillBits(r); regSeg.set(id); stats(); if (sel && sel.reg && W.byId[sel.reg].dim) closeSheet(); if (id !== "all") { const r = W.byId[id]; flyTo(r.centre, fit(r.ringR) * 1.1, { yaw: 0.2, pitch: 0.3 }); } else resetView(); }

// ---------- the list: the same record as a table, checked for real ----------
let listRun = 0;
function toggleList(on) {
  listOpen = on ?? !listOpen; $("#list").hidden = !listOpen; $("#listBtn").setAttribute("aria-expanded", String(listOpen));
  if (!listOpen) return; closeSheet(); if (!live()) applyStep(W.events.length, true);
  const body = $("#listBody"); body.textContent = ""; const run = ++listRun, ps = W.parts.filter((n) => n.kind === "passport");
  const rows = ps.map((n) => { const tr = document.createElement("tr"); tr.innerHTML = eng ? "<td><button type='button'></button></td><td>checking…</td><td></td><td></td><td></td><td></td>" : "<td><span></span></td><td>checking…</td><td></td><td></td><td></td><td></td>"; const c = tr.children; c[0].firstChild.textContent = short(n.rec.sub); if (eng) c[0].firstChild.addEventListener("click", () => choose(n)); c[2].textContent = n.reg; c[3].textContent = n.rec.operator; c[4].textContent = `${n.rec.leaf_index} of ${n.rec.checkpoint_size}`; c[5].textContent = `${n.rec.status_idx}`; body.append(tr); return tr; });
  let i = 0; const next = () => { if (run !== listRun || !listOpen || i >= ps.length) { if (i >= ps.length) $("#listNote").textContent = `${eng ? "" : NO_GL + " "}${ps.length} passports checked in this tab by the verifier the site ships: ${ps.filter((n) => n.verdict === "valid").length} valid, ${ps.filter((n) => n.verdict && n.verdict !== "valid").length} refused.`; return; }
    const n = ps[i], res = runCheck(R, n.rec, W.byId[n.reg].list); n.verdict = res.ok ? "valid" : res.reason; times.push(res.ms);
    rows[i].children[1].innerHTML = `<span class="tag${res.ok ? "" : " no"}">${icon(res.ok ? "valid" : "revoked")}<span></span></span>`; rows[i].children[1].querySelector("span span").textContent = `${res.ok ? "valid" : res.reason === "revoked" ? "switched off" : res.reason}${innerWidth < 620 ? "" : ` · ${msText(res.ms)}`}`; i++; setTimeout(next, 0); };
  $("#listNote").textContent = `${eng ? "" : NO_GL + " "}Checking each passport in this tab…`; setTimeout(next, 30);
}
$("#listBtn").addEventListener("click", () => toggleList()); $("#listX").addEventListener("click", () => toggleList(false));

// ---------- the timeline ----------
const track = $("#track");
function renderTrack() { const f = W.events.length ? step / W.events.length : 1; $("#fill").style.transform = `scaleX(${f})`; $("#knob").style.left = `${f * 100}%`; track.setAttribute("aria-valuenow", String(step)); track.setAttribute("aria-valuetext", $("#now").textContent); }
function makeTrack() {
  const n = W.events.length, T = $("#ticks"), D = $("#dates"); track.setAttribute("aria-valuemax", String(n)); let lastDay = "";
  W.events.forEach((e, i) => { const d = document.createElement("i"); d.className = e.type === "change" ? "ch" : e.type === "epoch" ? "ep" : ""; d.style.left = `${((i + 1) / n) * 100}%`; T.append(d);
    const day = e.date ? dayText(e.date, innerWidth < 620) : lastDay; if (day !== lastDay) { lastDay = day; const s = document.createElement("span"); s.textContent = day; const f = (i + 0.5) / n; s.style.left = `${(f > 0.9 ? 1 : f) * 100}%`; if (f > 0.5) s.className = "r"; D.append(s); } });
}
const stepAt = (x) => { const r = track.getBoundingClientRect(); return Math.round(clamp((x - r.left) / r.width, 0, 1) * W.events.length); };
track.addEventListener("pointerdown", (e) => { track.setPointerCapture(e.pointerId); track.classList.add("drag"); setPlaying(false); applyStep(stepAt(e.clientX)); });
track.addEventListener("pointermove", (e) => { if (track.classList.contains("drag")) applyStep(stepAt(e.clientX), true); });
const trackUp = () => track.classList.remove("drag"); track.addEventListener("pointerup", trackUp); track.addEventListener("pointercancel", trackUp);
track.addEventListener("keydown", (e) => { if (e.key === "ArrowLeft") { setPlaying(false); applyStep(step - 1, true); e.preventDefault(); e.stopPropagation(); } if (e.key === "ArrowRight") { setPlaying(false); applyStep(step + 1); e.preventDefault(); e.stopPropagation(); } });
function setPlaying(on) { playing = on; playT = 0; swapIcon($("#playIc"), on ? "pause" : "play"); $("#play").setAttribute("aria-label", on ? "Pause the replay" : "Replay the record"); if (on) { if (live()) applyStep(0, true); closeSheet(undefined, true); } }
$("#play").addEventListener("click", () => setPlaying(!playing));

// ---------- tools ----------
$("#zIn").addEventListener("click", () => zoomBy(0.72)); $("#zOut").addEventListener("click", () => zoomBy(1.38)); $("#zReset").addEventListener("click", resetView);
let viewSeg = null;
$("#aboutBtn").addEventListener("click", () => { const a = $("#about"), on = a.hidden; a.hidden = !on; $("#aboutBtn").setAttribute("aria-expanded", String(on)); if (on && viewSeg) viewSeg.set(eng.view); });   // the pill is measured once the panel is on screen
$("#feedToggle").addEventListener("click", () => { const c = $("#feed").classList.toggle("closed"); $("#feedToggle").textContent = c ? "Show the checks" : "Hide"; $("#feedToggle").setAttribute("aria-expanded", String(!c)); if (!sel && !tour.on) resetView(); });
const LIGHT = (() => { const v = [-0.5, 0.72, 0.48], l = Math.hypot(...v); return v.map((x) => x / l); })();   // where the light comes from: up and to the left
const look = () => ({ vp, scale: scaleCss * dpr, focus: focusDist(), dof: 0.14, fogA: cam.dist.x * 0.72, fogB: cam.dist.x * 2.2, ink: INK, signal: SIG, dpr, eye, light: LIGHT });
function frameOnce() { matrices(); scene(0); labels(0); eng.frame(look(), sets()); }
$("#stillBtn").addEventListener("click", () => {                       // a still, made in the tab: nothing is uploaded
  frameOnce(); const c = document.createElement("canvas"); c.width = cv.width; c.height = cv.height; const x = c.getContext("2d");
  x.fillStyle = paperCss; x.fillRect(0, 0, c.width, c.height); x.drawImage(cv, 0, 0); x.drawImage(lab, 0, 0);
  x.fillStyle = inkCss; x.font = `${12 * dpr}px ${MONO}`; x.textBaseline = "bottom"; x.fillText(`AINRA World · the test network's record, copy of ${dayText(R.published.published_at)} · ainra.org/world.html`, 20 * dpr, c.height - 16 * dpr);
  c.toBlob((b) => { if (!b) return; const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "ainra-world.png"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }, "image/png");
});
addEventListener("keydown", (e) => {
  if (e.target.closest?.("input,textarea")) return;
  if (e.key === "Escape") { if (!$("#about").hidden) $("#aboutBtn").click(); else if (listOpen && eng) toggleList(false); else if (sel) closeSheet(); else if (tour.on) tourEnd(); return; }
  if (e.metaKey || e.ctrlKey || e.altKey || listOpen || !eng) return;
  if (e.key.startsWith("Arrow") && e.target.closest?.("#capP")) return;   // there the arrows scroll the stop's text, and only that
  if (e.key === "ArrowLeft") { cam.yaw.set(0.35, 1).go((cam.yaw.on ? cam.yaw.to : cam.yaw.x) + 0.3); } else if (e.key === "ArrowRight") { cam.yaw.set(0.35, 1).go((cam.yaw.on ? cam.yaw.to : cam.yaw.x) - 0.3); }
  else if (e.key === "ArrowUp") { cam.pitch.set(0.35, 1).go(clamp((cam.pitch.on ? cam.pitch.to : cam.pitch.x) + 0.15, ...PITCH)); } else if (e.key === "ArrowDown") { cam.pitch.set(0.35, 1).go(clamp((cam.pitch.on ? cam.pitch.to : cam.pitch.x) - 0.15, ...PITCH)); }
  else if (e.key === "+" || e.key === "=") zoomBy(0.72); else if (e.key === "-" || e.key === "_") zoomBy(1.38); else if (e.key === "0") resetView();
  else if (e.key === " " && e.target === document.body) { e.preventDefault(); setPlaying(!playing); } else if (e.key === "l" || e.key === "L") toggleList();
});
for (const b of document.querySelectorAll(".btn,.act")) { b.addEventListener("pointerdown", () => b.classList.add("is-down")); for (const ev of ["pointerup", "pointerleave", "pointercancel"]) b.addEventListener(ev, () => b.classList.remove("is-down")); }

// ---------- start ----------
const FIXED = new URLSearchParams(location.search).has("fixed");                    // for measuring: never lower the quality
const sets = () => [lineSet, ...W.regs.map((r) => r.set), nodeSet];
const focusDist = () => (sel && sel.pos ? dist3(eye, sel.pos) : cam.dist.x);
async function start() {
  readTheme(); paintIcons(); swapIcon($("#playIc"), "play"); swapIcon($("#shCopyIc"), "copy");
  const motionAttr = () => { document.documentElement.dataset.motion = RM.matches ? "off" : "on"; }; motionAttr(); RMQ.addEventListener("change", motionAttr);   // the stylesheet stops its own animations under it
  eng = new URLSearchParams(location.search).has("nogl") ? null : createEngine(cv);          // ?nogl shows what a browser without WebGL2 gets
  if (!eng) { toggleListFallback(); return; }
  eng.font = MONO;
  import("./world-mark.mjs").then((m) => m.metalMark($("#bootMetal"), $("#bootMark"), () => INK, RM)).catch(() => {});
  R = await loadRecord("net", bootStep);
  const bitsTotal = Object.values(R.lists).reduce((a, l) => a + l.list.bit_len, 0);
  boot.querySelector('li[data-s="lists"]').textContent = `${R.registry.registrars.length} signed status lists, ${bitsTotal.toLocaleString("en")} bits`; bootStep("lists", null, null, true);
  bootStep("world", "Placing every part", 88);
  W = buildWorld(R);
  for (const r of W.regs) { r.set = eng.pointSet(r.list.bit_len); r.set.globe = [...r.centre, r.globeR]; r.spin = 0; r.reveal = 0; }
  // The order of arrival: the root, its orbit, each registrar, its entries one by one, the witness, then you.
  W.parts.forEach((n) => { const ri = n.reg ? W.regs.indexOf(W.byId[n.reg]) : W.regs.indexOf(n); n.a = 0; n.hv = 0; n.la = 0; n.pulse = 0; n.offA = 0;
    n.born = RM.matches ? 0 : { root: 0.15, epoch: 0.45, registrar: 0.8 + ri * 0.25, list: 0.8 + ri * 0.25, witness: 1.9, open: 1.9, you: 2.2 }[n.kind] ?? 1.25 + ri * 0.25 + (n.leaf || 0) * 0.05; });
  nodeSet = eng.pointSet(W.parts.length * 3 + 96, true); lineSet = eng.lineSet(1600);
  const narrowFind = () => { findIn.placeholder = innerWidth <= 900 ? "Find" : "Find a passport"; }; narrowFind();
  // A turn of the screen changes the layout (upright phone or tablet, short screen, wide screen), so the view is
  // framed again for it: the chosen part, the walk's stop, or the resting view. Not while the search field is in
  // use: there a keyboard on the screen may be what changed the shape, and it goes away again, so the question
  // waits for it.
  const shape = () => (SHORT.matches ? 3 : innerWidth <= 760 ? 2 : innerWidth <= 900 ? 1 : 0); let was = shape();
  const reframe = () => { if (document.activeElement === findIn || shape() === was) return; was = shape(); if (sel) focusOn(sel); else if (tour.on) tourShow(tour.i); else resetView(); };
  findIn.addEventListener("blur", () => setTimeout(reframe, 600));
  resize(); rest.jump(restLift()); feedShift.jump(feedW() ? 1 : 0); addEventListener("resize", () => { resize(); placeSheet(); narrowFind(); sayNow(); reframe(); });
  makeTrack(); makeTour();
  regSeg = makeSeg($("#regSeg"), [{ id: "all", label: ["All", ["lg", " registrars"]] }, ...W.regs.map((r) => ({ id: r.id, label: r.id.startsWith("registrar-") ? [["lg", "registrar-"], ["sm", "r-"], `${r.id.slice(10)} · ${r.recs.length}`] : `${r.id} · ${r.recs.length}`, title: `${r.id}: ${r.recs.length} passports` }))], "all", setReg);
  viewSeg = makeSeg($("#viewSeg"), [{ id: 0, label: "Points" }, { id: 1, label: "Text" }, { id: 2, label: "Braille" }, { id: 3, label: "Dither" }], 0, (v) => { eng.view = v; });
  applyStep(W.events.length, true);
  for (const n of W.parts) if (n.kind === "passport") n.offA = n.off ? 1 : 0;       // at arrival each moon already is what the record says
  order = W.parts.filter((n) => n.kind === "passport"); for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  bootStep("world", "Ready", 100, true); setTimeout(() => boot.classList.add("done"), RM.matches ? 0 : 240);
  const h = home(); cam.tx.jump(h.t[0]); cam.ty.jump(h.t[1]); cam.tz.jump(h.t[2]); cam.pitch.jump(h.pitch);
  if (RM.matches) { cam.yaw.jump(h.yaw); cam.dist.jump(h.dist); } else { cam.yaw.jump(h.yaw - 1.1); cam.dist.jump(h.dist * 2.6); cam.yaw.set(1.6, 1).go(h.yaw); cam.dist.set(1.4, 1).go(h.dist); }   // the world arrives from afar
  placeSheet();
  openHash(); addEventListener("hashchange", openHash);
  let last = performance.now(), nextCheck = last + 2200, slow = 0, frames = 0, acc = 0;
  const stat = (window.__world = { fps: 0, ms: 0, dpr, parts: W.parts.length, events: W.events.length });
  // For measuring and for tests only: where the chosen part and the camera are. The page itself never reads it.
  stat.probe = () => ({ sel: sel && { id: sel.id, shown: sel.shown, at: proj(sel.pos), bit: sel.bit && proj(sel.bit) }, cam: { yaw: cam.yaw.x, pitch: cam.pitch.x, dist: cam.dist.x, t: [cam.tx.x, cam.ty.x, cam.tz.x] }, vw, vh, dpr, cw: cv.width, ch: cv.height, sheet: sheetPos.x, lift: lift.x, names: lastNames, pills: lastPills, you: proj(W.byId.you.pos), INK, SIG, nodes: nodeSet.count, lines: lineSet.count, view: eng.view, focus: focusDist(), eye });
  const frame = (now) => {
    const raw = (now - last) / 1000, dt = Math.min(0.05, raw); last = now;
    if (!document.hidden) {
      frames++; acc += raw; if (frames === 50) { const ms = (acc / frames) * 1000; stat.ms = ms; stat.fps = 1000 / ms; frames = 0; acc = 0;
        // measured, not assumed: if frames are slow, the extra pixels go
        if (!FIXED && ms > 30 && ++slow >= 2) { slow = 0; if (dprCap > 1) { dprCap = 1; resize(); } stat.dpr = dprCap; } else if (ms <= 30) slow = 0; }
      if (playing) { playT += dt; if (playT > (RM.matches ? 0.9 : 0.5)) { playT = 0; applyStep(step + 1); if (live()) setPlaying(false); } }
      if (now >= nextCheck && live() && !tour.on && !listOpen && !playing && order.length) { check(order[cursor++ % order.length]); nextCheck = now + (RM.matches ? 3000 : 1100 + Math.random() * 1500); }   // an uneven beat, like real traffic
      { const rl = restLift(), tl = tourLift(), fs = feedW() ? 1 : 0; if (rest.to !== rl) rest.go(rl); if (lift.to !== tl) lift.go(tl); if (feedShift.to !== fs) feedShift.go(fs); } physics(dt); lift.step(dt); rest.step(dt); capShift.step(dt); feedShift.step(dt); sheetPos.step(dt); placeSheet(); matrices(); scene(dt); labels(dt);
      eng.frame(look(), sets());
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
// Without WebGL2 the record is still here: the list and its real checks, no drawing.
// A link to a panel opens it: world.html#list, world.html#about. With or without the drawing.
function openHash() { if (location.hash === "#list" && !listOpen) toggleList(true); if (location.hash === "#about" && $("#about").hidden) $("#aboutBtn").click(); }
const NO_GL = "This browser cannot draw the world (no WebGL2), so here is the same record as a table.";
async function toggleListFallback() {
  R = await loadRecord("net", bootStep); W = buildWorld(R); step = W.events.length; boot.classList.add("done");
  for (const id of ["tools", "time", "regSeg", "tourBtn", "listBtn", "feed"]) $("#" + id).hidden = true;
  $(".find").hidden = true; $(".about__view").hidden = true;
  $("#listX").hidden = true; listOpen = false; toggleList(true); openHash(); addEventListener("hashchange", openHash);
}
start().catch((e) => { console.error(e); bootFail(e.message || String(e)); });
