// SPDX-License-Identifier: Apache-2.0 OR MIT
// The way in to AINRA World, on the home page: a small window with the network turning inside it.
//
// What is drawn is a miniature in World's own vocabulary and nothing more: a registrar as a globe of dots, its log
// as a tilted ring of entries, and the reader's own point, in the one signal colour, checking an entry now and then.
// It is a drawing, not the record: no number is read from it and none is shown. The real thing is one press away.
//
// It lives on the page's one motion loop (motion.mjs), so it stops with the Motion switch and with reduced motion
// (one still frame then), sleeps while the tab is hidden, and is counted in the page's frame budget.
// While the page is being scrolled fast the window steps out of the way; it comes back when the reader slows down.
// While the page's Details panel is open in the same corner, the window stands beside it, not on it.
import { register, motionOn } from "./motion.mjs";

const dot = document.querySelector(".world-dot"), cv = dot?.querySelector("canvas");
if (dot && cv) {
  const c = cv.getContext("2d"), TAU = Math.PI * 2;
  const root = getComputedStyle(document.documentElement);
  const INK = root.getPropertyValue("--ink").trim() || "#0B1220", SIG = root.getPropertyValue("--signal").trim() || "#2F5BFF";
  const CARD = root.getPropertyValue("--card").trim() || "#F5F5F2";

  // the globe: points spread evenly over a sphere (a golden-angle spiral), as a status list is spread over World's
  const N = 132, P = [];
  for (let i = 0; i < N; i++) { const y = 1 - (i + 0.5) / N * 2, r = Math.sqrt(1 - y * y), a = i * 2.39996323; P.push([Math.cos(a) * r, y, Math.sin(a) * r]); }
  const MOONS = 7, TILT = 0.38, RING_TILT = 1.02;   // the ring leans toward the reader, as World's rings do
  let S = 0, dpr = 1, spin = 0.6, orbit = 0.4, pace = 1, paceTo = 1, clock = 0;
  let check = null, nextCheck = 1400;                // a check: { m: which entry, t: its age in ms }

  function fit() { const w = cv.clientWidth; dpr = Math.min(2, devicePixelRatio || 1); if (w && (w !== S || cv.width !== Math.round(w * dpr))) { S = w; cv.width = cv.height = Math.round(w * dpr); } }
  const moon = (k) => { const a = orbit + k / MOONS * TAU, R = 0.405 * S; return { x: Math.cos(a) * R, y: Math.sin(a) * R * Math.cos(RING_TILT), z: Math.sin(a) * Math.sin(RING_TILT), a }; };   // seen from above: the near half is the lower one

  function step(now, dt) {
    pace += (paceTo - pace) * Math.min(1, dt / 260);            // eases toward a quicker turn while the pointer is over it
    spin += dt * 0.00034 * pace; orbit += dt * 0.00015 * pace; clock += dt;
    if (check) { check.t += dt; if (check.t > 1500) check = null; }
    else if (clock > nextCheck) {                               // an uneven beat: never a steady pulse
      let best = 0, bz = -2; for (let k = 0; k < MOONS; k++) { const m = moon(k); if (m.z > bz && m.x < 0.25 * S) { bz = m.z; best = k; } }
      check = { m: best, t: 0 }; nextCheck = clock + 2600 + Math.random() * 3200;
    }
  }

  function draw(still) {
    fit(); if (!S) return;
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, S, S);
    const cx = 0.535 * S, cy = 0.45 * S, G = 0.225 * S, px = S / 104;
    const you = [0.2 * S, 0.76 * S];
    const ms = []; for (let k = 0; k < MOONS; k++) ms.push(moon(k));
    const ring = (from, to, alpha) => { c.beginPath(); for (let i = 0; i <= 40; i++) { const a = from + (to - from) * i / 40, x = cx + Math.cos(a) * 0.405 * S, y = cy + Math.sin(a) * 0.405 * S * Math.cos(RING_TILT); i ? c.lineTo(x, y) : c.moveTo(x, y); } c.strokeStyle = INK; c.globalAlpha = alpha; c.lineWidth = 0.75 * px; c.stroke(); c.globalAlpha = 1; };
    const entry = (m, k) => {
      const hit = check && check.m === k ? Math.min(1, Math.max(0, (check.t - 320) / 160)) * Math.min(1, Math.max(0, (1500 - check.t) / 300)) : 0;
      const front = m.z > 0, r = (front ? 2.1 : 1.5) * px;
      c.beginPath(); c.arc(cx + m.x, cy + m.y, r, 0, TAU); c.globalAlpha = front ? 0.92 : 0.4; c.fillStyle = INK; c.fill();
      if (hit && !still) { c.beginPath(); c.arc(cx + m.x, cy + m.y, r + (2.2 + 2.6 * hit) * px, 0, TAU); c.globalAlpha = 0.9 * hit; c.strokeStyle = SIG; c.lineWidth = 1.1 * px; c.stroke(); }
      c.globalAlpha = 1;
    };
    // behind the globe: the far half of the ring and its entries
    ring(Math.PI, TAU, 0.22); ms.forEach((m, k) => { if (m.z <= 0) entry(m, k); });
    // the globe: its far dots faint, then a veil of the page's own colour, then the near dots, so it reads as a ball
    const cs = Math.cos(spin), sn = Math.sin(spin), ct = Math.cos(TILT), st = Math.sin(TILT), near = [];
    c.fillStyle = INK;
    for (const p of P) {
      const x = p[0] * cs + p[2] * sn, z0 = -p[0] * sn + p[2] * cs, y = p[1] * ct - z0 * st, z = p[1] * st + z0 * ct;
      if (z > 0) { near.push(x, y, z); continue; }
      c.globalAlpha = 0.13; c.beginPath(); c.arc(cx + x * G, cy - y * G, 0.7 * px, 0, TAU); c.fill();
    }
    c.globalAlpha = 0.5; c.fillStyle = CARD; c.beginPath(); c.arc(cx, cy, G, 0, TAU); c.fill();
    c.fillStyle = INK;
    for (let i = 0; i < near.length; i += 3) { const z = near[i + 2]; c.globalAlpha = 0.3 + 0.62 * z; c.beginPath(); c.arc(cx + near[i] * G, cy - near[i + 1] * G, (0.72 + 0.5 * z) * px, 0, TAU); c.fill(); }
    c.globalAlpha = 1;
    // in front: the near half of the ring and its entries
    ring(0, Math.PI, 0.5); ms.forEach((m, k) => { if (m.z > 0) entry(m, k); });
    // the reader's point, and the thread of a check: out to the entry, held a moment, then let go
    if (check && !still) {
      const m = ms[check.m], grow = Math.min(1, check.t / 320), fade = Math.min(1, Math.max(0, (1500 - check.t) / 380)), e = 1 - (1 - grow) ** 3;
      c.beginPath(); c.moveTo(you[0], you[1]); c.lineTo(you[0] + (cx + m.x - you[0]) * e, you[1] + (cy + m.y - you[1]) * e);
      c.strokeStyle = SIG; c.globalAlpha = 0.9 * fade; c.lineWidth = 1.1 * px; c.stroke(); c.globalAlpha = 1;
    }
    const breath = still ? 0 : 0.5 + 0.5 * Math.sin(clock / 700);
    c.beginPath(); c.arc(you[0], you[1], (4.6 + 1.1 * breath) * px, 0, TAU); c.fillStyle = SIG; c.globalAlpha = 0.16; c.fill();
    c.beginPath(); c.arc(you[0], you[1], 2.5 * px, 0, TAU); c.globalAlpha = 1; c.fill();
  }

  const life = register({ el: dot, name: "world-dot", hz: 30, step, draw });
  draw(!motionOn());                                            // a first frame at once, before the still picture gives way
  dot.classList.add("is-live");
  new ResizeObserver(() => draw(!motionOn())).observe(cv);
  dot.addEventListener("pointerenter", () => { paceTo = 2.6; });
  dot.addEventListener("pointerleave", () => { paceTo = 1; });
  dot.addEventListener("focus", () => { away = false; place(); });

  // Out of the way while the page moves fast, back when the reader slows down. Speed is judged over the last 280 ms,
  // so one notch of a mouse wheel or an arrow-key press does not count as fast: a flick or a held scroll does. On a
  // phone the first screen stays clear as before: the window waits until the hero is scrolled past.
  const phone = matchMedia("(max-width:700px)"), hero = document.querySelector(".g-hero"), side = document.querySelector(".g-side");
  const WINDOW = 280, FAST = 150;                               // more than 150 px within 280 ms (about 540 px a second)
  let away = false, later = false, fastAt = -1e9, calm = 0; const trail = [[performance.now(), scrollY]];
  function place() {
    const hide = motionOn() && away;
    dot.classList.toggle("is-away", hide); dot.classList.toggle("is-later", phone.matches && later);
    life.paused = hide || (phone.matches && later);
  }
  addEventListener("scroll", () => {
    const now = performance.now(); trail.push([now, scrollY]);
    while (trail.length > 2 && trail[1][0] <= now - WINDOW) trail.shift();   // trail[0]: where the page stood 280 ms ago
    if (Math.abs(scrollY - trail[0][1]) > FAST) fastAt = now;
    away = now - fastAt < 380;                                  // back once it has been slower for a moment,
    clearTimeout(calm); calm = setTimeout(() => { away = false; place(); }, 380);   // or has stopped
    place();
  }, { passive: true });
  if (hero && "IntersectionObserver" in window) new IntersectionObserver((es) => { later = es[0].intersectionRatio > 0.35; place(); }, { threshold: [0, 0.35, 1] }).observe(hero);
  phone.addEventListener?.("change", place);

  // The Details panel opens in the same corner (by itself on a large screen; it is not shown at 800 px and narrower).
  // While it is open the window stands 16 px to its left. Its sideways place is one custom property that the
  // stylesheet turns into `translate`, moved with the panel's own curve and duration for each direction (is-beside
  // while the panel is open), so the two start together and keep their distance. A resize can show or hide the
  // panel at once, with no movement of its own: only then does the window take its place at once too.
  let wasBeside = false;
  function beside(e) {
    let x = 0; const open = !!side && side.classList.contains("is-open") && side.offsetWidth > 0;
    if (open) {
      const sc = getComputedStyle(side), dc = getComputedStyle(dot);
      const panelLeft = innerWidth - (parseFloat(sc.right) || 0) - side.offsetWidth, dotRight = innerWidth - (parseFloat(dc.right) || 0);
      x = Math.min(0, panelLeft - 16 - dotRight);
    }
    const changed = open !== wasBeside; wasBeside = open;
    if (changed) dot.classList.toggle("is-beside", open);
    const atOnce = changed && e && e.type === "resize" && !(side && side.getAnimations?.().length);   // the panel itself is not moving
    if (atOnce) dot.style.transition = "none";
    dot.style.setProperty("--dot-x", `${x}px`);
    void dot.offsetWidth;                                       // the new place takes effect now, in the panel's own frame,
    if (atOnce) dot.style.transition = "";                      // also when this runs outside a scroll or resize event
    place();
  }
  if (side) { new MutationObserver(beside).observe(side, { attributes: true, attributeFilter: ["class"] }); addEventListener("resize", beside); beside(); }
}
