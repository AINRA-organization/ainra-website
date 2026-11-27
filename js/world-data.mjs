// SPDX-License-Identifier: Apache-2.0 OR MIT
// AINRA World, the record. Everything the page shows comes from here, and everything here comes from the published
// record under net/ and from the verifier the site ships. No drawing and no DOM in this file.
//
//   parts, counts      net/index.json, net/roots.json, net/directory.json, net/epochs.json, net/registry.json
//   status bits        each registrar's signed status list (status/current.json), inflated in the tab; they are the
//                      dots of that registrar's globe, bit 0 at the top
//   the log            a ring of entries in log order; a passport's proof names the rest of the log in the runs of
//                      entries RFC 6962 gives for a log of that size, one hash each
//   order and dates    each passport's log position and issue date, each status change's sequence and date, each
//                      directory epoch's date, all as the record states them
//   verdicts           vendor/ainra-sdk.js in this tab, against the published directory and roots, at the record's time

const fromB64u = (s) => { const b = s.replace(/-/g, "+").replace(/_/g, "/"); return Uint8Array.from(atob(b.padEnd(Math.ceil(b.length / 4) * 4, "=")), (c) => c.charCodeAt(0)); };
const toB64u = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function getJSON(url) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), 20000);
  try { const r = await fetch(url, { signal: c.signal, cache: "no-cache" }); if (!r.ok) throw new Error(`${url} answered HTTP ${r.status}`); return await r.json(); }
  catch (e) { throw new Error(e.name === "AbortError" ? `${url} did not answer in 20 seconds` : e.message); }
  finally { clearTimeout(t); }
}

// A status list is a deflated bit string; bit i is byte i>>3, bit i&7.
export async function bitsOf(st) {
  if (typeof DecompressionStream === "undefined") throw new Error("this browser cannot inflate the status list");
  const p = new Uint8Array(await new Response(new Blob([fromB64u(st.status_list_b64)]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());
  const out = new Uint8Array(st.bit_len); for (let i = 0; i < st.bit_len; i++) out[i] = (p[i >> 3] >> (i & 7)) & 1; return out;
}

// ---------- the log's tree (RFC 6962, section 2.1) ----------
// A node is the range of leaves [lo, hi) it covers. A tree of n leaves splits at the largest power of two below n.
const splitAt = (n) => { let k = 1; while (k * 2 < n) k *= 2; return k; };
export function auditPath(m, n) {                                       // the siblings a proof for leaf m carries, deepest first
  const path = []; const walk = (lo, hi) => { if (hi - lo <= 1) return; const k = splitAt(hi - lo), mid = lo + k; if (m < mid) { walk(lo, mid); path.push([mid, hi]); } else { walk(mid, hi); path.push([lo, mid]); } };
  walk(0, n); return path;
}

// ---------- reading the record ----------
export async function loadRecord(base, step) {
  step("record", "Reading the published record", 4);
  let done = 0; const tick = (x) => { step(null, null, 4 + (++done / 7) * 32); return x; };
  const sdkP = import("../vendor/ainra-sdk.js").then(tick);
  const [index, roots, directory, epochs, registry, published] = await Promise.all(["index", "roots", "directory", "epochs", "registry", "published"].map((f) => getJSON(`${base}/${f}.json`).then(tick)));
  step("record", null, 38, true);
  step("lists", `Reading ${registry.registrars.length} signed status lists`, 40);
  const lists = {}; let li = 0;
  for (const R of registry.registrars) {
    const [list, deltas] = await Promise.all([getJSON(`${base}/registrars/${R.registrar}/status/current.json`), getJSON(`${base}/registrars/${R.registrar}/status/deltas.json`)]);
    lists[R.registrar] = { list, bits: await bitsOf(list), deltas: deltas.deltas };
    step(null, null, 40 + (++li / registry.registrars.length) * 22);
  }
  step("lists", null, 62, true);
  step("verifier", "Checking the directory against the root's two keys", 66);
  const sdk = await sdkP;
  await new Promise((r) => setTimeout(r, 30));                          // let the step paint before the work
  const verifier = sdk.Verifier.fromDirectoryB64(directory, roots.root_ed25519, roots.root_slh, "F1");
  if (!verifier) throw new Error("the published directory does not verify against the published root keys");
  const now = registry.generated_window?.verified_at;
  if (!Number.isInteger(now)) throw new Error("the record does not state its time");
  step("verifier", null, 84, true);
  return { index, roots, directory, epochs, registry, published, lists, verifier, now };
}

// What the verifier is handed for one passport: its record and its registrar's signed status list, nothing else.
function bundle(rec, st) {
  return {
    claims: toB64u(rec.claims), issuer_sig: { ed25519: rec.issuer_sig_ed25519, mldsa65: rec.issuer_sig_mldsa65 }, chain_keys: rec.chain_keys, hop_proofs: rec.hop_proofs,
    status_uri: st.uri, status_list: st.status_list_b64, status_len: st.bit_len, status_issued_at: st.issued_at, status_sig_ed25519: st.sig_ed25519, status_sig_mldsa65: st.sig_mldsa65,
    checkpoint: { origin: rec.log_origin, size: rec.checkpoint_size, root: rec.checkpoint_root }, checkpoint_sig: rec.checkpoint_sig, leaf_index: rec.leaf_index, inclusion_proof: rec.inclusion_proof,
    mandate_revocations: [], revoked_delegates: [],
    ...(rec.chain_parties?.length ? { chain_parties: rec.chain_parties } : {}),           // a chain its registrar bound (D-113)
  };
}
// One real check. Returns the verifier's own answer and how long it took here.
export function runCheck(R, rec, list) {
  const t0 = performance.now(); let v;
  try { v = R.verifier.verify(bundle(rec, list), R.now); } catch (e) { console.warn("the verifier threw:", e); v = { verdict: "invalid", reason: "error" }; }
  return { ok: v.verdict === "valid", reason: v.verdict === "valid" ? null : (v.reason || "refused"), ms: performance.now() - t0 };
}

// ---------- the world's parts, from the record ----------
export const short = (sub) => sub.split(":").slice(3).join(":") || sub;
const cut = (s, n = 26) => (s && s.length > n ? s.slice(0, n) + "…" : s || "");
const TAU = Math.PI * 2, GOLD = 2.399963229728653;
const day = (t) => new Date(t * 1000).toISOString().slice(0, 10);

// Layout, in world units, y up. The root is the centre, like a sun. The current directory epoch is the orbit the
// registrars move along. Each registrar is a globe: its status list, one dot per bit, wound from the top (bit 0) to
// the bottom. Around the globe runs its log as a ring of entries in log order, like moons on one orbit; the signed
// head closes the ring.
export function buildWorld(R) {
  const { roots, directory, epochs, registry, lists } = R;
  const parts = [], byId = {}, links = [], regs = [];
  const P = (id, kind, pos, r, label, info, extra = {}) => { const n = { id, kind, pos, r, label, info, flash: 0, shown: true, ...extra }; parts.push(n); byId[id] = n; return n; };
  const L = (a, b, kind = "base") => { const l = { a: byId[a], b: byId[b], kind, lit: 0 }; links.push(l); return l; };
  const CUR = directory.epoch, RING = 330, INNER = (i) => 104 + i * 44;

  P("root", "root", [0, 0, 0], 22, "root", { k: "ROOT · TEST, BEFORE THE CEREMONY", t: "The root", rows: [["Ed25519", cut(roots.root_ed25519)], ["SLH-DSA", cut(roots.root_slh)], ["Signs", "one thing: the registrar directory"], ["Issues", "no passports, sees no traffic"]] });
  const eps = epochs.epochs;
  eps.forEach((ep, i) => {
    const cur = ep.epoch === CUR;
    P(`epoch${ep.epoch}`, "epoch", [0, 0, 0], cur ? RING : INNER(i), `epoch ${ep.epoch}`, {
      k: `DIRECTORY EPOCH ${ep.epoch}`, t: cur ? `The directory, epoch ${ep.epoch} (current)` : `The directory, epoch ${ep.epoch} (replaced)`,
      rows: [["Signed", `${day(ep.issued_at)} by the root's two keys`], ["Digest", cut(ep.digest)], ["Names", cur ? `${directory.entries.length} registrars` : "kept in the directory's own log"]] }, { cur, date: ep.issued_at, epoch: ep.epoch, labelAt: [0, 0, cur ? RING : INNER(i)], labelCentre: true });
  });

  const nReg = registry.registrars.length;
  registry.registrars.forEach((G, ri) => {
    const id = G.registrar, recs = G.records.map((x) => x.record), Li = lists[id];
    // A registrar moves along the orbit, slowly; `ang` is where it stands now, and place() puts it and all it carries
    // there.
    const ang = (ri / nReg) * TAU + (nReg === 2 ? 0 : -Math.PI / 2);
    const pos = [Math.cos(ang) * RING, 0, Math.sin(ang) * RING];
    const size = Math.max(...recs.map((r) => r.checkpoint_size || 0)), n = Li.list.bit_len;
    const globeR = 84 + Math.sqrt(recs.length) * 15, centre = pos;
    // the status list: bit i always sits at the same place on the globe, winding down from the top
    const bitPos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const y = 1 - ((i + 0.5) / n) * 2, rr = Math.sqrt(1 - y * y), th = i * GOLD; bitPos[i * 3] = Math.cos(th) * rr * globeR; bitPos[i * 3 + 1] = y * globeR; bitPos[i * 3 + 2] = Math.sin(th) * rr * globeR; }   // measured from the globe's centre
    // the log: a ring around the globe, tilted like a moon's orbit. Entry k of `size` always sits at the same place,
    // in log order; a passport is the moon at its own entry.
    // Every ring leans the same way (its near side lower), so from the front each one opens toward the reader.
    const ringR = globeR + 62, tilt = 0.6, e1 = [1, 0, 0], e2 = [0, -Math.sin(tilt), Math.cos(tilt)];
    // entries run clockwise from the top, like a clock face
    const ringAt = (k, into) => { const a = -Math.PI / 2 + ((k + 0.5) / (size + 1)) * TAU + reg.phase, o = into || [0, 0, 0]; for (let d = 0; d < 3; d++) o[d] = centre[d] + ringR * (Math.cos(a) * e1[d] + Math.sin(a) * e2[d]); return o; };
    const reg = P(id, "registrar", pos, 11, id, { k: "REGISTRAR · ACCREDITED IN THE DIRECTORY", t: id, rows: [
      ["Issuer key", `Ed25519 ${cut(G.accreditation.issuer_key.ed25519, 20)} + ML-DSA-65`], ["Log", `${G.accreditation.log_origin}, ${size} entries`],
      ["Status list", `${n.toLocaleString("en")} bits, change ${G.status_seq}`], ["Passports", `${recs.length} issued, ${recs.filter((r) => Li.bits[r.status_idx]).length} switched off`]] },
      { ang, phase: 0, centre, globeR, ringR, ringAt, size, recs, bitPos, labelAt: [centre[0], centre[1] - globeR - 22, centre[2] + ringR * 0.8], labelAlt: [centre[0], centre[1] + globeR + 22, centre[2] - ringR * 0.8], labelCentre: true,
        list: Li.list, deltas: Li.deltas, bitsFinal: Li.bits, bits: new Uint8Array(Li.bits), used: new Map(recs.map((r) => [r.status_idx, r])), dim: false });
    regs.push(reg);
    P(`list:${id}`, "list", centre, 7, "", { k: "STATUS LIST · SIGNED BY THE REGISTRAR", t: `${id}'s status list`, rows: [["Bits", n.toLocaleString("en")], ["Set now", `${Li.bits.reduce((a, b) => a + b, 0)} (each is a passport switched off)`], ["Issued", day(Li.list.issued_at)], ["Signed", "Ed25519 + ML-DSA-65"], ["Reads as", "bit 0 at the top, later bits winding down"]] }, { reg: id });
    for (let k = 0; k < size; k++) {
      const rec = recs.find((r) => r.leaf_index === k), nid = `t:${id}:${k}`;
      if (rec) {
        P(`pp:${rec.sub}`, "passport", ringAt(k), 5.2, short(rec.sub).replace(/^smoke-(\d{4})\d*-\d+/, "smoke-$1…"), { k: "PASSPORT", t: short(rec.sub), rows: [
          ["Name", rec.sub], ["Registrar", id], ["Operator", rec.operator], ["Class", `${rec.auth_class}, tier ${rec.tier ?? "–"}`], ["May", (rec.capabilities || []).join(", ")],
          ["Issued", day(rec.issued_at)], ["Log entry", `${rec.leaf_index} of ${rec.checkpoint_size}`], ["Status bit", String(rec.status_idx)],
          ...((rec.chain_keys || []).length ? [["Acts through", `a chain of ${rec.chain_keys.length} earlier keys`]] : [])] },
          { rec, reg: id, leaf: k, verdict: null, off: false, });
        byId[nid] = byId[`pp:${rec.sub}`];
      } else P(nid, "leaf", ringAt(k), 2.2, "", { k: `LOG ENTRY ${k}`, t: `Entry ${k}`, rows: [["Log", G.accreditation.log_origin], ["Holds", "another entry, not a passport in this record"]] }, { reg: id, leaf: k });
    }
    // the signed head closes the ring, where the next entry will go
    P(`head:${id}`, "head", ringAt(size), 3.6, "log head", { k: "LOG HEAD · SIGNED CHECKPOINT", t: `${id}'s log, ${size} entries`, rows: [["Log", G.accreditation.log_origin], ["Size", `${size} entries`], ["Signed by", "the registrar's delegate, cosigned by the witness"], ["Means", "one hash stands for every entry on the ring; nothing can be changed or removed unseen"]] }, { reg: id, leaf: size });
    reg.headId = `head:${id}`;
    // Everything a registrar carries follows it: its entries on the ring, its name, its globe.
    reg.place = () => {
      centre[0] = Math.cos(reg.ang) * RING; centre[2] = Math.sin(reg.ang) * RING;
      reg.labelAt[0] = centre[0]; reg.labelAt[1] = centre[1] - globeR - 22; reg.labelAt[2] = centre[2] + ringR * 0.8;
      reg.labelAlt[0] = centre[0]; reg.labelAlt[1] = centre[1] + globeR + 22; reg.labelAlt[2] = centre[2] - ringR * 0.8;   // its name's second place, above
      for (const n of reg.carried) ringAt(n.leaf, n.pos);
    };
    reg.carried = parts.filter((n) => n.reg === id && (n.kind === "passport" || n.kind === "leaf" || n.kind === "head"));
  });

  const w = registry.witnesses[0];
  P("wit", "witness", [0, 270, 0], 7, "witness", { k: "WITNESS · SELF-DECLARED", t: "The network's own witness", rows: [["Operator", w.operator], ["Ed25519", cut(w.ed25519)], ["Does", "cosigns each log's head, so a log cannot show two histories"]] });
  P("wit-open", "open", [64, 286, 40], 7, "open seat", { k: "OPEN SEAT", t: "An independent witness", rows: [["Needed for", "fork resistance: witnesses run by others"], ["Who", "anyone; the software is published"]] });
  for (const r of regs) { L(r.headId, "wit", "wit"); L(r.headId, "wit-open", "dash"); }       // drawn only when the witness is the subject
  P("you", "you", [0, 0, 500], 9, "", { k: "YOU · THIS TAB", t: "You, the verifier", rows: [["Holds", "the directory, checked against the root's two keys"], ["And", "each registrar's signed status list"], ["Contacts", "nobody while it checks"]] });

  // ---------- the record's own order, with its own dates ----------
  // Epochs by number; each log's entries by position; each status change by sequence. Dates are the record's:
  // an entry that is not a passport in this record has a position but no date here.
  const events = [];
  for (const e of eps) events.push({ type: "epoch", epoch: e.epoch, date: e.issued_at, sort: [e.issued_at, 0, e.epoch] });
  for (const r of regs) for (let k = 0; k < r.size; k++) { const rec = r.recs.find((x) => x.leaf_index === k); events.push({ type: "leaf", reg: r.id, leaf: k, rec, date: rec ? rec.issued_at : null, sort: [null, 1, k / r.size + regs.indexOf(r) * 1e-4] }); }
  for (const r of regs) for (const d of r.deltas) events.push({ type: "change", reg: r.id, seq: d.seq, idx: d.idx, on: d.new_status, date: d.ts, sort: [d.ts, 2, d.seq + regs.indexOf(r) * 1e-4] });
  const firstLeaf = Math.min(...events.filter((e) => e.type === "leaf" && e.date).map((e) => e.date));
  for (const e of events) if (e.type === "leaf") e.sort[0] = e.date ?? firstLeaf;
  events.sort((a, b) => a.sort[0] - b.sort[0] || a.sort[1] - b.sort[1] || a.sort[2] - b.sort[2]);

  // What one check rests on, in the order the verifier works: the passport's entry in the log; its inclusion proof,
  // which names the rest of the log in a few runs of entries (each one hash); the signed head; the registrar that
  // signed it; the directory that names the registrar; the root that signed the directory; and the passport's bit.
  const pathOf = (p) => {
    const r = byId[p.reg], n = p.rec.checkpoint_size, m = p.rec.leaf_index, sib = auditPath(m, n);
    const ok = sib.length === p.rec.inclusion_proof.length && n === r.size;
    return { sib: ok ? sib.map(([lo, hi], i) => ({ lo, hi, hash: p.rec.inclusion_proof[i] })) : [], reg: r.pos, root: byId.root.pos, head: byId[r.headId].pos };
  };
  return { parts, byId, links, regs, events, CUR, pathOf, RING, INNER };
}
