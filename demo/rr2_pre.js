// rr2_pre.js (agent pre, Nov 2): load passes precomputed offline. tools/pre_build.py loads the package once in headless
// Chrome with RR_FLAGS.pre_dump = 1; the live passes run as always and their results are posted here as RRP1 files, which
// tools/pre_pack.mjs meshopt-encodes (geometry) into data/pre/. With RR_FLAGS.pre_<pass> = 1 the viewer reads those files
// and skips the pass: pre_cove (CoveLights collect and addDownlights), pre_bvh (collision and floor BVHs), pre_merge
// (mergeStatic groups). Each file carries a signature of the scene it was made from (mesh names, material names and
// sharing, vertex counts, in traversal order); on any mismatch the live pass runs and report.pre says why.
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { MeshBVH } from 'three-mesh-bvh';
import { queuedFetch, PRI } from './rr2_assets.js';

const FL = () => globalThis.RR_FLAGS || {};
export const preDump = () => !!+(FL().pre_dump || 0);
export const preOn = (k) => !preDump() && !!+(FL()['pre_' + k] || 0);
const PASSES = ['cove', 'bvh', 'merge'];

// ---------- scene signature ----------
export function meshList(root) { const L = []; root.traverse(o => { if (o.isMesh) L.push(o); }); return L; }
export function meshSig(L) {
  let h = 2166136261; const mid = new Map();
  const s = (str) => { for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } };
  for (const o of L) { const g = o.geometry, p = g && g.attributes && g.attributes.position, ms = [].concat(o.material || []);
    s(o.name + '|' + ms.map(m => (m ? m.name : '') + '#' + (mid.has(m) ? mid.get(m) : (mid.set(m, mid.size), mid.size - 1))).join(',') + '|' + (p ? p.count : 0) + '|' + (g && g.index ? g.index.count : 0) + '|' + (o.isInstancedMesh ? o.count : '') + ';'); }
  return (h >>> 0).toString(16) + ':' + L.length;
}

// a pass's signature: its meshes, every RR_FLAGS value except the pre_ keys (a flag change makes the file stale), and the
// pass's own inputs (extra)
export function passSig(L, extra = '') { return meshSig(L) + '|' + extra; }
// the flags as JSON text per key (pre_ keys left out); stored in each file and compared key by key in preGet
// mirrorhalf: set by rr2_look.js on non desktop tiers (mirror refresh cadence), read by no load pass
const FLAG_SKIP = /^(pre_|mirrorhalf$)/;
export function flagSnap() { const F = FL(); return Object.fromEntries(Object.keys(F).filter(k => !FLAG_SKIP.test(k)).sort().map(k => [k, JSON.stringify(F[k])])); }

// ---------- RRP1 container: 'RRP1', u32 header length, header JSON, pad to 4, chunks ----------
// header = { meta, chunks: [{ off, len, enc: 'raw' | 'mv' (meshopt vertex: count, stride) | 'mi' (meshopt index: count, size), t: typed array name, n: raw byte length }] }
const TYPES = { Float32Array, Uint32Array, Uint16Array, Uint8Array, Int32Array, Int16Array, Int8Array, Float64Array };
export function packRRP(meta, arrays) {
  const chunks = []; let off = 0;
  for (const a of arrays) { const u8 = new Uint8Array(a.buffer || a, a.byteOffset || 0, a.byteLength); chunks.push({ off, len: u8.byteLength, enc: 'raw', t: a.constructor.name === 'ArrayBuffer' ? 'ArrayBuffer' : a.constructor.name, n: u8.byteLength, u8 }); off += (u8.byteLength + 3) & ~3; }
  const head = new TextEncoder().encode(JSON.stringify({ meta, chunks: chunks.map(({ u8, ...c }) => c) }));
  const base = (8 + head.byteLength + 3) & ~3, out = new Uint8Array(base + off), dv = new DataView(out.buffer);
  out.set([82, 82, 80, 49]); dv.setUint32(4, head.byteLength, true); out.set(head, 8);
  for (const c of chunks) out.set(c.u8, base + c.off);
  return out;
}
export async function unpackRRP(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8[0] !== 82 || u8[1] !== 82 || u8[2] !== 80 || u8[3] !== 49) throw new Error('not RRP1');
  const hl = dv.getUint32(4, true), H = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + hl))), base = (8 + hl + 3) & ~3;
  if (H.chunks.some(c => c.enc !== 'raw')) await MeshoptDecoder.ready;
  const arrays = H.chunks.map(c => {
    const src = u8.subarray(base + c.off, base + c.off + c.len); let raw;
    if (c.enc === 'raw') raw = src.slice();
    else { raw = new Uint8Array(c.n);
      if (c.enc === 'mv') MeshoptDecoder.decodeVertexBuffer(raw, c.count, c.stride, src);
      else if (c.enc === 'mi') MeshoptDecoder.decodeIndexBuffer(raw, c.count, c.size, src);
      else throw new Error('enc ' + c.enc); }
    if (c.t === 'ArrayBuffer') return raw.buffer;
    const T = TYPES[c.t]; return new T(raw.buffer, 0, raw.byteLength / T.BYTES_PER_ELEMENT);
  });
  return { meta: H.meta, arrays };
}

// ---------- load side: all enabled pass files are requested at load start (they download beside the areas) ----------
export function preStart(base = 'data/pre') {
  const out = {};
  for (const k of PASSES) if (preOn(k)) { out[k] = queuedFetch(`${base}/${k}.bin`, { priority: PRI.area }).then(unpackRRP); out[k].catch(() => {}); }
  return out;
}
// the pass data, or null (with the reason in report.pre) when it is missing or was made from another scene
export async function preGet(P, k, sig, report) {
  const r = (report.pre ||= {});
  if (!P || !P[k]) return null;
  try { const d = await P[k]; if (d.meta.sig !== sig) { r[k] = 'sig mismatch ' + d.meta.sig + ' vs ' + sig + ': live pass'; return null; }
    const fn = flagSnap(), fo = d.meta.flags || {}, diff = [...new Set([...Object.keys(fn), ...Object.keys(fo)])].filter(x => !FLAG_SKIP.test(x) && fn[x] !== fo[x]);
    if (diff.length) { r[k] = 'flags differ (' + diff.map(x => x + ' ' + fo[x] + '>' + fn[x]).join(', ').slice(0, 400) + '): live pass'; return null; } r[k] = 'pre'; return d; }
  catch (e) { r[k] = 'load failed (' + e.message + '): live pass'; return null; }
}

// ---------- dump side ----------
const pending = [];
export function preRecord(name, meta, arrays) { pending.push([name, packRRP({ ...meta, flags: flagSnap() }, arrays)]); }
export async function preFlush() {
  for (const [name, buf] of pending.splice(0)) { const r = await fetch('/__pre/' + name + '.bin', { method: 'POST', body: buf }); if (!r.ok) throw new Error('post ' + name + ' ' + r.status); }
  await fetch('/__pre/done', { method: 'POST', body: JSON.stringify({ t: performance.now() }) });
}

// ---------- mergeStatic ----------
// the plan only (groups as indices into the meshes at the start of the pass, each piece's skewed normal share): the
// merged buffers themselves are 1.1 GB of world space floats, far too big to download; rr2_player.js mergeStatic builds
// them from the plan without the grouping walk and the normal tests
export function mergeDump(sig, groups, before, after) { preRecord('merge', { sig, groups, drawGroups: { before, after } }, []); }
// ---------- collision ----------
const bvhOut = (mesh, arrays) => { const s = MeshBVH.serialize(mesh.geometry.boundsTree), add = (a) => (arrays.push(a), arrays.length - 1);
  if (s.indirectBuffer) throw new Error('indirect bvh');
  return { p: add(mesh.geometry.attributes.position.array), i: add(s.index), r: s.roots.map(add) }; };
export function bvhDump(sig, player) {
  const arrays = [], c = bvhOut(player.collider, arrays), f = bvhOut(player.floorCollider, arrays);
  preRecord('bvh', { sig, c, f, collisionTris: player.report.collisionTris, floorTris: player.report.floorTris }, arrays);
}
const bvhIn = (o, arrays) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(arrays[o.p], 3));
  g.boundsTree = MeshBVH.deserialize({ roots: o.r.map(k => arrays[k]), index: arrays[o.i], indirectBuffer: null }, g, { setIndex: true }); return g; };
export function bvhApply(player, d) {
  const { meta, arrays } = d;
  player.collider = new THREE.Mesh(bvhIn(meta.c, arrays), new THREE.MeshBasicMaterial()); player.collider.visible = false;
  player.floorCollider = new THREE.Mesh(bvhIn(meta.f, arrays), new THREE.MeshBasicMaterial());
  player.report.collisionTris = meta.collisionTris; player.report.floorTris = meta.floorTris;
}

// ---------- cove ----------
// CoveLights keeps plain objects with Vector3 members (patches p n flux, lines a b, downlights p) and sides that point at
// lines; they go out as JSON (numbers round trip exactly) with lines referenced by index
const V3 = new Set(['a', 'b', 'p', 'n', 'flux']);
const objOut = (o, ref) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v && v.isVector3 && V3.has(k) ? { v3: v.toArray() } : ref(k, v)]));
const objIn = (o, ref) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v && v.v3 ? new THREE.Vector3().fromArray(v.v3) : ref(k, v)]));
// hides: hideSide results in call order (collect replays only its material caps with them)
export function coveDump(sig, cv, hides, np) {
  const si = new Map(cv.segs.map((s, i) => [s, i])), id = (k, v) => v;
  const sideRef = (k, v) => k === 'lines' ? v.map(l => si.get(l)) : k === 'slot' ? (v ? si.get(v) : null) : v;
  const bs = new Set(cv.bandSides || []);
  preRecord('cove', { sig, hides, np, patches: cv.patches.map(p => objOut(p, id)), segs: cv.segs.map(s => objOut(s, id)),
    sides: (cv.sides || []).map(s => ({ band: bs.has(s), o: objOut(s, sideRef) })), dls: cv.dls.map(x => objOut(x, id)), voidLamps: [...(cv.voidLamps || [])],
    constEmitters: cv.constEmitters || 0, report: cv.report }, []);
}
export function coveApply(cv, root, mats, gain, d) {
  const m = d.meta; let k = 0;
  // the traversal of collect still runs for its material caps (capEmitter, clampStrip, capStrip); the geometry work is replaced
  cv.hideSide = () => m.hides[k++]; cv.addLines = () => {}; cv.buildSides = () => {};
  cv.collect(root, mats, gain); delete cv.hideSide; delete cv.addLines; delete cv.buildSides;
  if (k !== m.hides.length) throw new Error('cove replay ' + k + ' of ' + m.hides.length);
  const id = (k2, v) => v;
  cv.patches = m.patches.map(p => objIn(p, id)); cv.segs = m.segs.map(s => objIn(s, id));
  const sideRef = (k2, v) => k2 === 'lines' ? v.map(i => cv.segs[i]) : k2 === 'slot' ? (v === null ? null : cv.segs[v]) : v;
  cv.sides = m.sides.map(s => objIn(s.o, sideRef)); cv.bandSides = cv.sides.filter((s, i) => m.sides[i].band);
  cv.dls = m.dls.map(x => objIn(x, id)); cv.voidLamps = new Set(m.voidLamps);
  if (m.constEmitters) cv.constEmitters = m.constEmitters; cv.report = m.report;
  return m.np;
}
