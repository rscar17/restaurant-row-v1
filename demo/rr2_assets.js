// Asset scheduling and lifetime for the row viewer.
//  p-queue (sindresorhus): every network fetch goes through one queue with bounded concurrency and a priority, so the
//    start view's files are first in line and nothing starts hundreds of downloads at once.
//  Comlink (GoogleChromeLabs): capture PNG decode and downsampling run in a worker, buffers transferred, not copied.
//  lru-cache (isaacs): one capture cache shared by every section. Captures in use are reference counted and pinned;
//    a capture no section uses moves to a bounded LRU, and eviction disposes its GPU texture.
//  Images decode off the main thread with createImageBitmap (first-draw decode of 4096 images was most of the
//    "Preparing textures" time); the GPU upload still happens on the page thread, before the view opens.
import { capBitmap } from './rr2_tier.js';
import * as THREE from 'three';
import PQueue from 'p-queue';
import { LRUCache } from 'lru-cache';
import * as Comlink from 'comlink';

export const netQueue = new PQueue({ concurrency: 6 });
export const PRI = { start: 30, near: 20, area: 10, far: 0 };

export const stats = { fetches: 0, bytes: 0, workerDecodes: 0, mainDecodes: 0, capHits: 0, capLoads: 0, capDisposed: 0, bitmapImages: 0 };

// RR_FLAGS.gzdata (ship speed, side copy, default off): area GLB and JSON files are fetched as <file>.gz (written next to the
// plain file by the data build) and inflated here with the browser's DecompressionStream. Meshopt geometry and JSON shrink
// to about 45 % and 13 %. A host that already strips the gzip layer (Content-Encoding) is detected by the magic bytes; a
// missing .gz falls back to the plain file, so a data folder without .gz files works unchanged.
const gzOn = () => !!+((globalThis.RR_FLAGS || {}).gzdata || 0) && typeof DecompressionStream !== 'undefined';
const GZ_RE = /\.(glb|json)(\.part\d+)?$/;
async function asType(buf, as) {
  if (as === 'arrayBuffer') return buf; if (as === 'blob') return new Blob([buf]);
  const txt = new TextDecoder().decode(buf); return as === 'json' ? JSON.parse(txt) : txt;
}
export const gzStats = { files: 0, wire: 0, inflated: 0, fallback: 0 };
// RR_FLAGS.zstdata (ship speed, eng_v2, default off): area files as <file>.zst (zstd level 19, about 11 % smaller than gzip),
// decoded with three's own ZSTDDecoder (vendor/three/examples/jsm/libs/zstddec.module.js, the wasm the KTX2 loader uses).
// A missing .zst falls back to .gz (gzdata) and then to the plain file.
let zstdP = null;
const zstdOn = () => !!+((globalThis.RR_FLAGS || {}).zstdata || 0);
function zstd() { return zstdP ||= import('three/examples/jsm/libs/zstddec.module.js').then(async ({ ZSTDDecoder }) => { const d = new ZSTDDecoder(); await d.init(); return d; }); }
export function queuedFetch(url, { priority = PRI.area, as = 'arrayBuffer' } = {}) {
  return netQueue.add(async () => {
    if (zstdOn() && GZ_RE.test(url) && !/\/caps\//.test(url)) {
      const r = await fetch(url + '.zst');
      if (r.ok) { const buf = new Uint8Array(await r.arrayBuffer()); stats.fetches++; stats.bytes += buf.byteLength; gzStats.files++; gzStats.wire += buf.byteLength;
        const dec = await zstd(); const out = dec.decode(buf); gzStats.inflated += out.byteLength;
        return asType(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength), as); }
      gzStats.fallback++;
    }
    if (gzOn() && GZ_RE.test(url) && !/\/caps\//.test(url)) {
      const r = await fetch(url + '.gz');
      if (r.ok) { let buf = await r.arrayBuffer(); const u8 = new Uint8Array(buf, 0, Math.min(2, buf.byteLength)); stats.fetches++; stats.bytes += buf.byteLength; gzStats.files++; gzStats.wire += buf.byteLength;
        if (u8[0] === 0x1f && u8[1] === 0x8b) buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
        gzStats.inflated += buf.byteLength; return asType(buf, as); }
      gzStats.fallback++;
    }
    const r = await fetch(url); if (!r.ok) throw new Error(r.status + ' ' + url); stats.fetches++;
    const v = await r[as](); stats.bytes += v.byteLength || v.size || v.length || 0; return v; }, { priority });
}

// RR_FLAGS.memlean (memfix agent, Oct 15; bit 1 = textures, bit 2 = geometry in rr2_player.js, bit 4 = textures
// uploaded area by area, needs bit 1; default off).
// Without it every Texture object decodes its own copy of its file: one image used with two wraps, two colour spaces,
// or by a Blender graph and by a standard map slot was fetched, decoded and held as up to five full RGBA ImageBitmaps,
// and every ImageBitmap stayed alive after its GPU upload for the life of the page (the r4 build: 1018 Texture
// objects over about 250 files; the laptop ran out of RAM at "Preparing textures 640/1018"). With bit 1:
//  1. one decode per (url, orientation): every Texture of that pair shares one THREE.Source, so three uploads each GL
//     variant (wrap, filter, colour space) from the same bitmap;
//  2. the bitmap is closed and the Source emptied once every Texture on it has uploaded, but only after the player has
//     called memleanSeal() (all areas compiled, so no new variant can arrive). A Texture made later on a closed Source
//     gets a fresh decode instead (stats.memRedecodes); a variant that would still need an upload from a closed Source
//     is listed by memleanAudit() (it would draw black, it cannot crash: three skips a null image with a warning).
// RR_FLAGS.lowtex (works with or without memlean): largest side of a bitmap texture after decode; 1 = 2048, a number
// over 256 = that size. It only ever lowers the tier's RR_TEX_MAX.
const SHARED = new Map(); let sealed = false; const EVER = new Map(); // url -> { f: px, n: px } decoded orientations
export const memStats = { decodes: 0, shared: 0, closed: 0, closedBytes: 0, redecodes: 0, lateVariants: 0 };
const lean = () => (+((globalThis.RR_FLAGS || {}).memlean || 0) & 1) !== 0;
function texMax() {
  const F = globalThis.RR_FLAGS || {}; const lt = +(F.lowtex || 0); const tier = globalThis.RR_TEX_MAX || 0;
  if (!lt) return tier; const want = lt > 256 ? lt : 2048; return tier ? Math.min(tier, want) : want;
}
function closeEntry(e) {
  if (e.closed) return; const b = e.src.data; e.closed = true;
  if (b && b.close) { memStats.closedBytes += (b.width * b.height * 4) || 0; b.close(); }
  e.src.data = null; memStats.closed++; SHARED.delete(e.key); CLOSED_KEYS.add(e.key);
}
const CLOSED_KEYS = new Set();
const SMALLREG = []; const smallTier = () => !!+((globalThis.RR_FLAGS || {}).smalltex || 0);
export const smallStats = { entries: 0, swapped: 0, users: 0, uploads: 0, bytes: 0, failed: 0, maxSwapMs: 0, startedAt: null, doneAt: null };
// After the view is open: fetch each full size picture (lowest network priority), decode it off thread, then swap it into the
// shared Source between frames (at most perFrame Sources per frame): every Texture on the Source that the renderer has used is
// disposed (its storage was allocated for the small size) and uploaded again from the full bitmap, which is then closed.
// order(e) (optional): smaller first. Returns smallStats when every entry is done.
export async function upgradeSmallTextures(renderer, { perFrame = 1, order = null, invalidate = () => {}, concurrency = 4, idle = null } = {}) {
  const list = SMALLREG.slice(); if (order) list.sort((a, b) => order(a) - order(b));
  smallStats.entries = list.length; smallStats.startedAt = performance.now(); const M = texMax();
  const frame = () => new Promise(r => requestAnimationFrame(() => r()));
  // idle (optional): swaps wait until it returns true (the camera has been still for a moment), so an upload hitch never lands in a glide or a drag
  // and never more than 3 s per swap, so a view that keeps moving cannot hold the full pictures back
  let slots = 0; const waitSlot = async () => { const t0 = performance.now(); while (slots >= perFrame || (idle && !idle() && performance.now() - t0 < 3000)) await frame(); slots++; };
  const tick = setInterval(() => { slots = 0; }, 16);
  let i = 0;
  const worker = async () => { while (i < list.length) { const e = list[i++]; const s = e.small;
    try {
      // only Sources the renderer drew from: an orphan (a glTF slot texture a Blender graph replaced) is never fetched again
      // a Source none of whose textures has reached the GPU yet (a graph texture first drawn later, a late clone) still gets the full
      // picture: its bitmap is then kept for that first upload instead of closed (keep), so nothing can stay at the small size
      const live = [...e.allUsers].some(t => renderer.properties.get(t).__webglInit || e.users.has(t) || (e.late && e.late.has(t)));
      if (!live) { smallStats.skipped = (smallStats.skipped || 0) + 1; continue; }
      const blob = await queuedFetch(s.url, { priority: PRI.far, as: 'blob' }); smallStats.bytes += blob.size;
      let bmp = await createImageBitmap(blob, { imageOrientation: s.flipY ? 'flipY' : 'from-image', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      bmp = await capBitmap(bmp, M);
      await waitSlot(); const t0 = performance.now();
      // a fresh Source (new cache key): every texture gets its own full size GL texture, never the storage of the small one
      const ns = new THREE.Source(bmp); ns.userData = { smallFull: s.url }; let up = 0;
      // every texture that can still draw (already on the GPU, or a live memlean user, or a late clone) is uploaded here, inside the
      // idle gated swap: a lazy first upload of a 4096 picture during a glide cost up to 1.7 s a frame (run c19_a)
      for (const t of e.allUsers) { const used = !!renderer.properties.get(t).__webglInit, live = used || e.users.has(t) || (e.late && e.late.has(t));
        if (used) t.dispose(); t.source = ns; t.needsUpdate = true; if (live) { renderer.initTexture(t); up++; } }
      if (e.src.data && e.src.data !== bmp && e.src.data.close) e.src.data.close(); e.src.data = null; e.src = ns;
      // close only when every texture on it has uploaded; a texture still waiting for its first draw keeps the bitmap
      // (memlean orphans, textures no material uses any more, are not waited for)
      const pending = [...e.allUsers].filter(t => !renderer.properties.get(t).__webglInit && (e.users.has(t) || (e.late && e.late.has(t))));
      if (!pending.length) { bmp.close(); ns.data = null; } else smallStats.keptBitmaps = (smallStats.keptBitmaps || 0) + 1;
      smallStats.users += e.allUsers.size; smallStats.uploads += up; smallStats.swapped++; smallStats.maxSwapMs = Math.max(smallStats.maxSwapMs, performance.now() - t0); invalidate();
    } catch (err) { smallStats.failed++; } } };
  await Promise.all(Array.from({ length: concurrency }, worker)); clearInterval(tick);
  smallStats.doneAt = performance.now(); smallStats.maxSwapMs = Math.round(smallStats.maxSwapMs); return smallStats;
}
// early: memlean bit 4 (memleanAreaDone), close before the global seal once every Texture known so far has uploaded
function maybeClose(e, early = false) { if ((!sealed && !early) || e.closed || !e.src.data) return; for (const t of e.users) if (!e.uploaded.has(t)) return; closeEntry(e); }
// RR_FLAGS.memlean bit 4 (memlean=7): the player uploads each area's textures as soon as that area is done (rr2_player.js
// load loop) and calls this, so the decoded images of one area are freed before the next area decodes its own, instead
// of every area's images living until the upload at the end of the load. snapshot: the glTF slot textures of the area
// before compileAndApply; those that no material of the area uses any more (a Blender graph replaced them, a far copy
// was dropped) stop holding their Source open. live: every texture the area's materials use now, all initTexture'd.
// A Source closes here once every Texture on it so far has uploaded; a Texture made on the same file later (a new wrap
// or colour space variant in a later area) decodes the file again (memStats.redecodes), never draws from a closed one.
export function memleanAreaDone(renderer, live, snapshot) {
  const touched = new Set();
  if (snapshot) for (const t of snapshot) { const e = t.source?.userData?.memleanEntry; if (!e || e.closed) continue; touched.add(e);
    if (!live.has(t) && !e.uploaded.has(t) && e.users.delete(t)) memStats.orphans = (memStats.orphans || 0) + 1; }
  for (const t of live) { const e = t.source?.userData?.memleanEntry; if (!e || e.closed) continue; touched.add(e);
    if (!e.uploaded.has(t) && renderer.properties.get(t).__version === t.version && t.version > 0) e.uploaded.add(t); }
  let n = 0; for (const e of touched) { maybeClose(e, true); if (e.closed) n++; }
  memStats.areaClosed = (memStats.areaClosed || 0) + n; return n;
}
// the player calls this once every area is compiled (before it uploads the textures): from then on a fully uploaded
// Source is closed at once, and each later upload closes its Source when it is the last one pending
// live (optional): every texture the scene uses. A Texture on a shared Source that is not in it (a glTF slot texture whose
// material took a Blender graph, a far copy dropped by dupdrop) is no longer waited for, or its Source would never close.
export function memleanSeal(live) {
  sealed = true;
  if (live) for (const e of SHARED.values()) for (const t of [...e.users]) if (!live.has(t) && !e.uploaded.has(t)) { e.users.delete(t); memStats.orphans = (memStats.orphans || 0) + 1; }
  for (const e of [...SHARED.values()]) maybeClose(e);
}
// after renderer.initTexture(t): a Texture whose GL texture already exists for its Source and sampler (a fallback clone
// with the same wraps and filters) gets no upload and so no onUpdate; it counts as served once the renderer's state for
// it is current
export function memleanMark(t, renderer) {
  const e = t.source?.userData?.memleanEntry; if (!e || e.closed || e.uploaded.has(t)) return;
  if (renderer.properties.get(t).__version === t.version && t.version > 0) { e.uploaded.add(t); maybeClose(e); }
}
// report: per shared Source, how many textures, how many uploaded, bytes still held; textures on a closed Source whose
// renderer state says they never uploaded (would draw black)
export function memleanAudit(renderer, texs) {
  let open = 0, openBytes = 0, pendingUsers = 0; for (const e of SHARED.values()) { if (e.src.data) { open++; openBytes += (e.src.data.width * e.src.data.height * 4) || 0; } for (const t of e.users) if (!e.uploaded.has(t)) pendingUsers++; }
  const late = []; if (renderer && texs) for (const t of texs) { if (!(t.userData?.memlean || t.source?.userData?.memleanEntry) || t.source.data) continue; const p = renderer.properties.get(t); if (p.__version !== t.version) late.push(t.name || t.uuid); }
  memStats.lateVariants = late.length;
  let both = 0, bothPx = 0; for (const ev of EVER.values()) if (ev.f && ev.n) { both++; bothPx += ev.n; }
  return { ...memStats, sealed, bothOrientations: both, bothOrientationsMB: +(bothPx * 4 / 1048576).toFixed(1), open, openMB: +(openBytes / 1048576).toFixed(1), pendingUsers, late: late.slice(0, 20) };
}
// a Texture on a shared Source: counted until its first upload; its clones (the player's fallback maps) share the
// Source and are counted the same way, so the bitmap is not closed under them
function addUser(e, t) {
  t.source = e.src; e.users.add(t); if (e.allUsers) e.allUsers.add(t);
  t.onUpdate = () => { e.uploaded.add(t); maybeClose(e); };
  t.clone = function () { const c = THREE.Texture.prototype.clone.call(this); if (!e.closed) addUser(e, c); else { memStats.lateClones = (memStats.lateClones || 0) + 1; if (e.allUsers) { e.allUsers.add(c); (e.late ||= new Set()).add(c); c.clone = t.clone; } } return c; };
}
// getBlob (optional): where the bytes come from when the key is not a URL (images embedded in a GLB)
function sharedBitmapTexture(url, flipY, priority, getBlob = null) {
  const key = url + '|' + (flipY ? 'f' : 'n');
  let e = SHARED.get(key);
  if (e && e.closed) e = null;
  const t = new THREE.Texture(); t.flipY = false; t.userData.memlean = true; t.userData.url = url;
  if (!e) {
    e = { key, src: new THREE.Source(null), users: new Set(), uploaded: new Set(), closed: false }; e.src.userData = { memleanEntry: e };
    if (CLOSED_KEYS.has(key)) memStats.redecodes++;
    memStats.decodes++; SHARED.set(key, e);
    const M = texMax();
    // RR_FLAGS.smalltex (ship speed, side copy): a graph or shared GLB image under /img/ first loads its small copy from /img_s/
    // (same name, longest side 512, WebP); upgradeSmallTextures() swaps the full picture in after the view opens
    let fetchUrl = url; if (smallTier() && !getBlob && /\/img\//.test(url)) { fetchUrl = url.replace('/img/', '/img_s/'); e.small = { url, flipY, priority }; e.allUsers = new Set(); SMALLREG.push(e); }
    e.ready = (getBlob ? getBlob() : queuedFetch(fetchUrl, { priority, as: 'blob' }))
      .then(b => createImageBitmap(b, { imageOrientation: flipY ? 'flipY' : 'from-image', premultiplyAlpha: 'none', colorSpaceConversion: 'none' }))
      .then(bmp => capBitmap(bmp, M))
      .then(bmp => { e.src.data = bmp; stats.bitmapImages++; const ev = EVER.get(url) || {}; ev[flipY ? 'f' : 'n'] = bmp.width * bmp.height; EVER.set(url, ev); for (const u of e.users) u.needsUpdate = true; maybeClose(e); })
      .catch(err => { e.error = String(err); for (const u of e.users) u.userData.error = e.error; });
  } else memStats.shared++;
  addUser(e, t);
  if (e.src.data) t.needsUpdate = true;
  t.userData.ready = e.ready.then(() => { if (e.error) t.userData.error = e.error; });
  return t;
}

// content key of a byte buffer: SHA-1 where crypto.subtle exists (secure contexts: https and localhost), else two
// FNV-1a 32 bit hashes with different seeds (a page served over plain http from a LAN address has no crypto.subtle)
async function bytesKey(buf) {
  if (globalThis.crypto?.subtle) { const h = new Uint8Array(await crypto.subtle.digest('SHA-1', buf)); let hex = ''; for (const b of h) hex += b.toString(16).padStart(2, '0'); return hex; }
  const a = new Uint8Array(buf); let h1 = 0x811c9dc5, h2 = 0x01000193 ^ a.length;
  for (let i = 0; i < a.length; i++) { h1 = Math.imul(h1 ^ a[i], 16777619); h2 = Math.imul(h2 ^ a[i], 2246822519); }
  return 'f' + (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16);
}
// GLTFLoader plugin (memlean bit 1): glTF images resolve to a shared Texture instead of an ImageBitmapLoader decode that
// lived as long as the page. The plugin swaps the parser's texture loader (GLTFLoader asks a LoadingManager handler
// only for images with a uri; these GLBs embed theirs). GLTFLoader then sets flipY false, the sampler's filters and
// wraps, the colour space and the name on the texture, as it does on its own ones. Embedded images arrive as blob:
// URLs of their bufferView; their key is a hash of the bytes, so the same picture embedded in several GLBs or areas
// (marble_01_diff is in 12 of the east GLBs) decodes once. Decode options as ImageBitmapLoader's: premultiplyAlpha and
// colorSpaceConversion 'none', orientation from the file.
const memleanImageLoader = {
  isImageBitmapLoader: false,
  setCrossOrigin() { return this; }, setRequestHeader() { return this; }, setPath() { return this; },
  load(url, onLoad, onProgress, onError) {
    const done = (t) => t.userData.ready.then(() => { if (t.userData.error) onError?.(new Error(t.userData.error)); else onLoad(t); });
    if (/^blob:/.test(url)) {
      fetch(url).then(r => r.arrayBuffer()).then(async (buf) => {
        const t = sharedBitmapTexture('glb:' + (await bytesKey(buf)) + ':' + buf.byteLength, false, PRI.area, () => Promise.resolve(new Blob([buf])));
        t.userData.embedded = true; memStats.embedded = (memStats.embedded || 0) + 1; done(t); }).catch(e => onError?.(e));
    } else done(sharedBitmapTexture(new URL(url, location.href).href, false, PRI.area));
  }
};
export function memleanGLTFPlugin(parser) { parser.textureLoader = memleanImageLoader; return { name: 'rr_memlean' }; }

// texture whose image is fetched through the queue and decoded off-thread; returns the Texture at once plus .ready
export function bitmapTexture(url, { flipY = true, priority = PRI.area } = {}) {
  if (lean()) return sharedBitmapTexture(url, flipY, priority);
  const M = (+((globalThis.RR_FLAGS || {}).lowtex || 0)) ? texMax() : undefined;
  const t = new THREE.Texture(); t.flipY = false; t.userData.url = url; // orientation is applied by createImageBitmap; WebGL ignores UNPACK_FLIP_Y for bitmaps
  t.userData.ready = queuedFetch(url, { priority, as: 'blob' })
    .then(b => createImageBitmap(b, { imageOrientation: flipY ? 'flipY' : 'from-image', premultiplyAlpha: 'none', colorSpaceConversion: 'none' }))
    .then(bmp => capBitmap(bmp, M)) // RR_TEX_MAX from the device tier (rr2_tier.js); unchanged when no tier is set
    .then(bmp => { t.image = bmp; t.needsUpdate = true; stats.bitmapImages++; })
    .catch(e => { t.userData.error = String(e); });
  return t;
}

let workerApi = null, workerFailed = false, workerP = null, workerObj = null;
// Capture worker, also when the modules come from another origin (Swoogo page, scripts on GitHub Pages or a CDN).
// new Worker(crossOriginUrl) throws, so the worker source is fetched with CORS, its relative imports are made absolute
// against the script host, and the worker starts from a blob URL (gate agent proposal). Same origin keeps the plain path.
// Hang fix (swoogo2 agent): a module worker whose script or imports fail to load never answers a Comlink call, so a
// decode waited forever. Now the worker must answer a ping within WORKER_BOOT_MS, an error event marks it failed and
// rejects the calls in flight, and every call has a WORKER_CALL_MS timeout. On any of these the capture decodes on the
// main thread instead (the caller's fallback, or decodeStack from rr2_capworker.js imported on the page thread).
const WORKER_BOOT_MS = 8000, WORKER_CALL_MS = 30000;
const inflight = new Set();
function withTimeout(p, ms, what) {
  let rec; const t = new Promise((_, rej) => { rec = { rej }; rec.timer = setTimeout(() => rej(new Error(what + ' timed out after ' + ms + ' ms')), ms); inflight.add(rec); });
  return Promise.race([p, t]).finally(() => { clearTimeout(rec.timer); inflight.delete(rec); });
}
function failWorker(why) {
  if (workerFailed) return; workerFailed = true; workerApi = null; stats.workerError = String(why);
  for (const r of inflight) r.rej(new Error('capture worker failed: ' + why)); inflight.clear();
  try { workerObj && workerObj.terminate(); } catch (e) { /* already gone */ }
}
async function makeWorker() {
  const src = new URL('./rr2_capworker.js', import.meta.url);
  if (src.origin === location.origin) return new Worker(src, { type: 'module' });
  const r = await fetch(src, { mode: 'cors', credentials: 'omit' }); if (!r.ok) throw new Error(r.status + ' ' + src);
  const abs = (await r.text()).replace(/(\bfrom\s*|\bimport\s*\(?\s*)(['"])(\.{1,2}\/[^'"]+)\2/g, (m, pre, q, rel) => pre + q + new URL(rel, src).href + q);
  const url = URL.createObjectURL(new Blob([abs], { type: 'text/javascript' }));
  const w = new Worker(url, { type: 'module' }); setTimeout(() => URL.revokeObjectURL(url), 30000); return w;
}
function worker() {
  if (workerFailed) return Promise.resolve(null);
  if (workerApi) return Promise.resolve(workerApi);
  return workerP ||= (async () => {
    const w = workerObj = await makeWorker();
    w.addEventListener('error', (e) => { e.preventDefault?.(); failWorker('error event ' + (e.message || 'script or import failed to load')); });
    w.addEventListener('messageerror', () => failWorker('messageerror'));
    const api = Comlink.wrap(w);
    await withTimeout(api.ping(), WORKER_BOOT_MS, 'capture worker boot');
    if (workerFailed) return null;
    return (workerApi = api);
  })().catch((e) => { failWorker(e && e.message || e); return null; });
}
// perf (Oct 16): a small pool of the same capture worker (RR_FLAGS.capworkers, default 4, at most cores - 1) so the
// start area's captures decode side by side instead of one after another; each decode is the same code on the same file,
// so the faces are the same. The first worker keeps the boot and failure rules above; a later one that fails to boot is
// left out. RR_FLAGS.perf = 0 or capworkers = 1 keeps one worker.
const pool = []; let poolBooting = 0;
async function poolApi() {
  const w0 = await worker(); if (!w0) return null;
  if (!pool.length || pool[0].api !== w0) { pool.length = 0; pool.push({ api: w0, busy: 0, w: workerObj }); }
  const F = globalThis.RR_FLAGS || {}, on = +(F.perf ?? 1) !== 0;
  const want = on ? Math.max(1, Math.min(+(F.capworkers ?? 4), ((globalThis.navigator && navigator.hardwareConcurrency) || 4) - 1)) : 1;
  while (pool.length + poolBooting < want) { poolBooting++;
    (async () => { let w = null; try { w = await makeWorker(); const api = Comlink.wrap(w), rec = { api, busy: 0, w };
        w.addEventListener('error', (e) => { e.preventDefault?.(); const i = pool.indexOf(rec); if (i > 0) pool.splice(i, 1); try { w.terminate(); } catch (x) { /* gone */ } });
        await withTimeout(api.ping(), WORKER_BOOT_MS, 'capture worker boot'); if (!workerFailed) pool.push(rec); else w.terminate(); }
      catch (e) { try { w && w.terminate(); } catch (x) { /* gone */ } } finally { poolBooting--; } })(); }
  let best = pool[0]; for (const q of pool) if (q.busy < best.busy) best = q; return best;
}
let mainDecoder = null;   // decodeStack on the page thread, only loaded when the worker is not usable
async function mainDecode(url, size) { mainDecoder ||= import('./rr2_capworker.js').then(m => m.decodeStack); return (await mainDecoder)(url, size); }

export class CaptureCache {
  constructor(renderer, { keepUnused = 32 } = {}) {
    this.renderer = renderer; this.live = new Map(); this.pending = new Map();
    this.idle = new LRUCache({ max: keepUnused, dispose: (tex) => { tex.dispose(); stats.capDisposed++; } });
    this.pm = null;
  }
  // returns a promise of the PMREM texture for one capture; every acquire must be paired with a release(id)
  acquire(id, url, size, { priority = PRI.area, fallback } = {}) {
    const e = this.live.get(id); if (e) { e.refs++; stats.capHits++; return Promise.resolve(e.tex); }
    if (this.idle.has(id)) { const tex = this.idle.get(id); this.idle.delete(id); this.live.set(id, { tex, refs: 1 }); stats.capHits++; return Promise.resolve(tex); }
    if (this.pending.has(id)) { const p = this.pending.get(id); p.refs++; stats.capHits++; return p.promise; }
    const rec = { refs: 1 };
    rec.promise = netQueue.add(() => this.decode(url, size, fallback), { priority }).then(({ N, faces }) => {
      const tex = this.build(faces, N); this.pending.delete(id); this.live.set(id, { tex, refs: rec.refs }); stats.capLoads++; return tex;
    }, (err) => { this.pending.delete(id); throw err; });
    this.pending.set(id, rec); return rec.promise;
  }
  release(id) {
    const e = this.live.get(id); if (!e) return; if (--e.refs > 0) return;
    this.live.delete(id); this.idle.set(id, e.tex);   // not disposed yet: a nearby section may want it back
  }
  async decode(url, size, fallback) {
    const p = await poolApi(), w = p && p.api, abs = new URL(url, location.href).href;
    if (w) { p.busy++; try { const r = await withTimeout(w.decodeStack(abs, size), WORKER_CALL_MS, 'capture decode'); stats.workerDecodes++; return r; }
      catch (e) { stats.workerCallErrors = (stats.workerCallErrors || 0) + 1; if (/timed out/.test(e.message)) failWorker(e.message); } finally { p.busy--; } }
    stats.mainDecodes++; return fallback ? fallback() : mainDecode(abs, size);
  }
  build(faces, N) {
    const fs = faces.map(d => { const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat, THREE.HalfFloatType); t.needsUpdate = true; return t; });
    const cube = new THREE.CubeTexture(fs); cube.format = THREE.RGBAFormat; cube.type = THREE.HalfFloatType; cube.colorSpace = THREE.LinearSRGBColorSpace;
    cube.generateMipmaps = false; cube.minFilter = cube.magFilter = THREE.LinearFilter; cube.needsUpdate = true;
    this.pm ||= new THREE.PMREMGenerator(this.renderer);
    const tex = this.pm.fromCubemap(cube).texture; cube.dispose(); return tex;
  }
  summary() { return { live: this.live.size, idle: this.idle.size, pending: this.pending.size }; }
}
