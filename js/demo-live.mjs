// SPDX-License-Identifier: Apache-2.0 OR MIT
// M17 Task 2 — the LIVE lifecycle. Runs the WHOLE lifecycle against a real registrar's public door on a TEST-ROOT,
// in the visitor's browser, with real cryptography: issue → logged-before-valid → verify (the SDK recomputes the
// inclusion proof locally) → revoke → re-verify (fail-closed). Streams the one canonical M16 verdict-event at each
// verify. If no registrar is reachable (e.g. a public static deploy), the section degrades to an honest note.
import { conformance, verdictEvent, serializeVerdictEvent } from "../vendor/ainra-sdk.js";
const { runVector } = conformance;
import { fetchT, why } from "./net.mjs";
// The registrar's whole accreditation, as the directory states it: both keys, and the distrust cutoff and the leaf
// from which delegation chains are bound (D-113) when present. Without the last, a bound chain is not checked.
const anchorOf = (a) => ({ issuer_key: a.issuer_key, log_root_key: a.log_root_key, ...(a.distrust_from_leaf != null ? { distrust_from_leaf: a.distrust_from_leaf } : {}), ...(a.distrust_root ? { distrust_root: a.distrust_root } : {}), ...(a.chains_bound_from_leaf != null ? { chains_bound_from_leaf: a.chains_bound_from_leaf } : {}) });

const qs = new URLSearchParams(location.search);
const meta = (n) => document.querySelector(`meta[name="${n}"]`)?.content?.trim();
const onLocal = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(location.hostname);
const REG = (qs.get("reg") || meta("ainra-registrar") || (onLocal ? "http://127.0.0.1:4907" : "")).replace(/\/$/, "");
const REGID = qs.get("regid") || "registrar-07";
const CONTRACT = (qs.get("net") || meta("ainra-contract") || (onLocal ? "http://127.0.0.1:8091" : "")).replace(/\/$/, "");
const EXPLORER = (qs.get("scan") || (onLocal ? "http://127.0.0.1:8090" : "")).replace(/\/$/, "");
// The clock is the network's own, stated in its record (index.json): `"clock": "wall"` is a network that keeps real
// time; no such field is the pinned one. Pinned: every request names the fixed instant below and every verdict is dated
// by it, as this page always did. Real time: no instant is named (the registrar answers and signs at its own clock, and
// refuses a write dated April 2026), and a verdict is dated by the bundle it is about.
const PINNED_NOW = 1776729600; // the pinned network's verification time (nbf + 10d)
let WALL = false;              // set once, at boot, from the record
const nowQ = (lead) => (WALL ? "" : `${lead}now=${PINNED_NOW}`);
const stamped = (body) => (WALL ? body : { ...body, now: PINNED_NOW });
const timeOf = (signedAt) => (WALL ? (Number.isInteger(signedAt) ? signedAt : Math.floor(Date.now() / 1000)) : PINNED_NOW);

const $ = (s) => document.querySelector(s);
let sub = null, anchors = null;

const log = (text, cls = "") => {
  const el = $("#ll-log"); if (!el) return;
  const line = document.createElement("div");
  line.className = "ll-line " + cls;
  line.textContent = text;
  el.appendChild(line); el.scrollTop = el.scrollHeight;
};
const setStep = (i, state) => {
  const el = document.querySelector(`.ll-step[data-i="${i}"]`); if (!el) return;
  el.dataset.state = state;
  el.querySelector(".ll-ico").textContent = state === "ok" ? "✓" : state === "no" ? "✗" : state === "run" ? "…" : "·";
};
const enable = (id, on) => { const b = $(id); if (b) b.disabled = !on; };
const verdict = (t, cls) => { const v = $("#ll-verdict"); if (v) { v.textContent = t; v.className = "ll-verdict " + cls; } };

async function boot() {
  if (!$("#lifecycle")) return;
  if (!REG) return unavailable("This runs the whole lifecycle against a live registrar. Start one locally — <code>make stage-all</code> — then reload, or pass <code>?reg=&lt;url&gt;</code>.");
  let health;
  try { health = await (await fetchT(REG + "/health", { cache: "no-store" })).json(); }
  catch (e) { return unavailable(`Registrar unavailable — ${why(e, `<code>${REG}</code>`)}. Run <code>make stage-all</code>, or check the URL you passed to <code>?reg=</code>.`); }
  if (!health || !health.ok) return unavailable("A registrar answered but isn't ready.");
  try {
    const acc = await (await fetchT(REG + "/accreditation")).json();
    anchors = { [REGID]: anchorOf(acc) };   // the registrar's presentation carries chain parties: the anchors must ask for them
  } catch { return unavailable("Couldn't read the registrar's accreditation."); }
  let netRoot = health.root || "test-root";
  if (CONTRACT) { try { const ix = await (await fetchT(CONTRACT + "/index.json", { cache: "no-store" })).json(); netRoot = ix.root || netRoot; WALL = ix.clock === "wall"; } catch {} }
  const badge = $("#ll-badge"); if (badge) badge.textContent = (health.network || "staging").toUpperCase() + " · " + netRoot.toUpperCase();
  $("#ll-issue").addEventListener("click", doIssue);
  $("#ll-verify").addEventListener("click", () => doVerify(false));
  $("#ll-revoke").addEventListener("click", doRevoke);
  $("#ll-reverify").addEventListener("click", () => doVerify(true));
  $("#ll-reset").addEventListener("click", reset);
  enable("#ll-issue", true);
  log(`connected to ${REG} · ${netRoot} · press “Issue a specimen”`, "dim");
}

async function doIssue() {
  enable("#ll-issue", false); setStep(1, "run");
  try {
    const rec = await (await fetchT(REG + "/demo/issue", { method: "POST" })).json();
    if (!rec.sub) throw new Error(rec.error || "issue failed");
    sub = rec.sub;
    setStep(1, "ok"); $("#ll-sub").textContent = sub; $("#ll-height").textContent = rec.checkpoint_size;
    log(`1 · issued ${sub} · tier ${rec.tier}`, "ok");
    setStep(2, "ok"); log(`2 · logged before valid — Merkle leaf sealed at checkpoint height ${rec.checkpoint_size}`, "ok");
    if (EXPLORER && CONTRACT) { const a = $("#ll-scan"); a.href = `${EXPLORER}/?net=${encodeURIComponent(CONTRACT)}`; a.hidden = false; }
    enable("#ll-verify", true); enable("#ll-reset", true);
  } catch (e) { setStep(1, "no"); log("issue error: " + e.message, "no"); enable("#ll-issue", true); }
}

async function doVerify(after) {
  const i = after ? 5 : 3; setStep(i, "run");
  try {
    const pres = await (await fetchT(`${REG}/present?sub=${encodeURIComponent(sub)}${nowQ("&")}`)).json();
    const v = runVector({ name: sub, expect: {}, anchors, presentation: pres });
    const ev = serializeVerdictEvent(verdictEvent(pres, v, timeOf(pres.now)));
    const ok = v.verdict === "valid";
    log(`${i} · verdict-event ${ev}`, ok ? "ok" : "no");
    if (!after) {
      setStep(3, ok ? "ok" : "no"); verdict(ok ? "VALID" : "INVALID", ok ? "ok" : "no");
      if (ok) enable("#ll-revoke", true);
    } else {
      const good = v.verdict === "invalid" && v.reason === "revoked";
      setStep(5, good ? "ok" : "no"); verdict("INVALID · " + (v.reason || ""), "no");
      log(good ? "lifecycle complete — the revoked specimen fails closed. The switch beats the calendar." : "unexpected re-verify result", good ? "dim" : "no");
    }
  } catch (e) { setStep(i, "no"); log("verify error: " + e.message, "no"); }
}

async function doRevoke() {
  enable("#ll-revoke", false); setStep(4, "run");
  try {
    const rv = await (await fetchT(REG + "/demo/revoke", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(stamped({ sub })) })).json();
    if (rv.revoked !== sub) throw new Error(rv.error || "revoke failed");
    setStep(4, "ok"); log(`4 · revoked ${sub}`, "ok");
    enable("#ll-reverify", true);
  } catch (e) { setStep(4, "no"); log("revoke error: " + e.message, "no"); enable("#ll-revoke", true); }
}

function reset() {
  sub = null;
  enable("#ll-issue", true); enable("#ll-verify", false); enable("#ll-revoke", false); enable("#ll-reverify", false);
  [1, 2, 3, 4, 5].forEach((i) => setStep(i, "pend"));
  $("#ll-log").innerHTML = ""; $("#ll-sub").textContent = "—"; $("#ll-height").textContent = "—";
  verdict("—", "pend"); const a = $("#ll-scan"); if (a) a.hidden = true;
  log("reset — issue a fresh specimen", "dim");
}

function unavailable(html) {
  const u = $("#ll-unavailable"); if (u) { u.innerHTML = html; u.hidden = false; }
  const live = $("#ll-live"); if (live) live.hidden = true;
}

boot();
