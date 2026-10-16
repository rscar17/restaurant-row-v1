// Non blocking program readiness gate (gate agent, Oct 14; gate2 agent: time budget, program dedupe, timings), used by
// RR_FLAGS.lowres = 2 and RowPlayer.preload().
// Each animation frame: (1) poll every program in flight (isReady() reads COMPLETION_STATUS_KHR, which never blocks),
// (2) swap in every material whose programs are all ready, (3) issue new materials until gateMs of main thread time is
// used in this tick or maxInFlight new programs are in flight. A material whose dedupe key (its program cache key
// guess) matches one still in flight is parked, not issued; it is issued right after that leader swaps, when its
// compile only finds the existing program and it swaps in the same tick.
// Without KHR_parallel_shader_compile (SwiftShader, some phones) isReady() is always true, so the gate reads
// LINK_STATUS on at most one program per frame (that read waits for the link) and only one program is in flight.
// Timing: stat.frameLog keeps per tick fields (issue, check, swap, uni, tex ms, render ms from the player); topFrames()
// gives the slowest frames; progs maps each new program to issue and ready times, key head and owner material.
export class ProgramGate {
  constructor(renderer, { perFrame = 256, gateMs = 8, issuePerFrame = Infinity, maxInFlight = 64, preUniforms = true, preTextures = true, keyOf = null, onDone = null, onSwap = null } = {}) {
    this.R = renderer; this.gl = renderer.getContext(); this.khr = !!renderer.extensions.get('KHR_parallel_shader_compile');
    // without KHR the first status read waits for every compile queued before it (the GPU command stream is in order),
    // so only one program is in flight there: each frame then waits for one link at most
    if (!this.khr) { issuePerFrame = 1; maxInFlight = 1; }
    this.perFrame = perFrame; this.gateMs = gateMs; this.issuePerFrame = issuePerFrame; this.maxInFlight = maxInFlight;
    this.preUniforms = preUniforms; this.preTextures = preTextures; this.keyOf = keyOf; this.onDone = onDone; this.onSwap = onSwap;
    this.queue = []; this.pending = []; this.ready = new WeakSet(); this.raf = 0; this.done = false; this._last = 0;
    this.inflight = new Set();            // programs issued by the gate and not yet ready
    this.waiters = new Map();             // program to the pending entries waiting on it
    this.leaders = new Map();             // dedupe key to the entry issued for it while its programs are in flight
    this.progs = new Map();               // program to { key, owner, t0, t1, frame0, frame1, merged }
    this.uniDone = new WeakSet(); this.texDone = new WeakSet(); this.uniQ = []; this._swapList = [];
    this.t0 = performance.now(); this.frameLog = []; this.cur = null;
    this.stat = { issued: 0, parked: 0, reused: 0, swaps: 0, checks: 0, linkReads: 0, frames: 0, maxFrameMs: 0, maxTickMs: 0, newPrograms: 0, uniMs: 0, texMs: 0, texCount: 0, khr: this.khr };
    this.finished = new Promise(res => { this._res = res; });
  }
  // issue(m) creates the programs (renderer.compile on a proxy, no wait); apply(m) swaps the material in
  add(m, issue, apply) { this.queue.push({ m, issue, apply, progs: null, key: this.keyOf ? this.keyOf(m) : null, parked: null, left: 0 }); }
  // already issued elsewhere (compileAsync on the post chain, the mirror extras): only wait for it, then apply
  watch(m, apply) { const e = { m, issue: null, apply, progs: this.programsOf(m), key: null, parked: null, left: 0 }; this.track(e, 'watch'); }
  programsOf(m) { const pp = this.R.properties.get(m).programs; return pp ? [...pp.values()].filter(Boolean) : []; }
  get left() { return this.queue.length + this.pending.length + this._parkedN(); }
  _parkedN() { let n = 0; for (const e of this.leaders.values()) n += e.parked ? e.parked.length : 0; return n; }
  start() { if (this.raf || this.done) return this; const loop = (n) => { this.raf = requestAnimationFrame(loop);
      if (this._last) { const g = n - this._last; if (g > this.stat.maxFrameMs) this.stat.maxFrameMs = g; if (this.cur) this.cur.gap = g; } this._last = n; this.tick(); };
    this.raf = requestAnimationFrame(loop); return this; }
  stop() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; }
  now() { return performance.now(); }
  // record the programs an entry holds; new ones (not seen before) get their issue time, owner and key head
  track(e, how) {
    let left = 0;
    for (const pg of e.progs) {
      if (!this.progs.has(pg)) { const k = String(pg.cacheKey || '');
        this.progs.set(pg, { key: (k.split(',').slice(0, 2).join(',').slice(0, 24) + ' ' + ((k.match(/blm?:[^,]{0,60}/) || [''])[0])).trim(), owner: (how === 'watch' ? 'extra:' : '') + (e.m.name || e.m.type), t0: this.now() - this.t0, t1: null, f0: this.stat.frames, f1: null, merged: /blm:/.test(k) });
        if (this.cur) this.cur.newProgs++; this.stat.newPrograms++; }
      if (this.ready.has(pg)) continue; left++;
      this.inflight.add(pg); let w = this.waiters.get(pg); if (!w) this.waiters.set(pg, w = []); w.push(e); }
    e.left = left; this.pending.push(e);
    if (!left) this._swapList.push(e);
  }
  markReady(pg) {
    this.ready.add(pg); this.inflight.delete(pg); const p = this.progs.get(pg); if (p && p.t1 == null) { p.t1 = this.now() - this.t0; p.f1 = this.stat.frames; }
    if (this.preUniforms && pg.getUniforms) this.uniQ.push(pg);
    const w = this.waiters.get(pg); if (w) { this.waiters.delete(pg); for (const e of w) if (--e.left <= 0) this._swapList.push(e); }
  }
  // texture uploads a material will do at its first draw, done here instead (counted in the frame budget)
  prepTextures(m) { const R = this.R; if (!R.initTexture) return; const u = m.uniforms || m.userData?.blender?.uniforms, list = [];
    for (const k in m) { const v = m[k]; if (v && v.isTexture) list.push(v); }
    if (u) for (const k in u) { const v = u[k] && u[k].value; if (v && v.isTexture) list.push(v); else if (Array.isArray(v)) for (const x of v) if (x && x.isTexture) list.push(x); }
    for (const t of list) { if (this.texDone.has(t) || t.isRenderTargetTexture || t.isVideoTexture) continue; this.texDone.add(t);
      const img = t.image; if (!img || (Array.isArray(img) && !img.length) || t.version === 0) continue;
      try { R.initTexture(t); this.stat.texCount++; if (this.cur) this.cur.texN = (this.cur.texN || 0) + 1; } catch (err) {} } }
  tick() {
    if (this.done) return; const a = this.now(); this.stat.frames++;
    const F = this.cur = { f: this.stat.frames, t: Math.round(a - this.t0), gap: 0, check: 0, uni: 0, swap: 0, issue: 0, tex: 0, render: 0, issued: 0, parked: 0, newProgs: 0, readyProgs: 0, swaps: 0, inflight: 0, names: [] };
    this.frameLog.push(F); if (this.frameLog.length > 20000) this.frameLog.splice(0, 5000);
    // 1 poll the programs in flight
    let budget = this.perFrame, reads = this.khr ? Infinity : 1;
    for (const pg of [...this.inflight]) { if (budget-- <= 0) break; this.stat.checks++; let ok = false;
      if (this.khr) ok = pg.isReady();
      else if (reads > 0) { reads--; this.stat.linkReads++; this.gl.getProgramParameter(pg.program, this.gl.LINK_STATUS); ok = true; }
      if (ok) { this.markReady(pg); F.readyProgs++; } }
    const b = this.now(); F.check = b - a;
    // 2 uniform reflection for newly ready programs (what the first draw would do), within the budget
    while (this.uniQ.length && this.now() - a < this.gateMs) { const pg = this.uniQ.shift(); if (this.uniDone.has(pg)) continue; this.uniDone.add(pg); try { pg.getUniforms(); } catch (err) {} }
    const c = this.now(); F.uni = c - b; this.stat.uniMs += F.uni;
    // 3 swaps (and the parked followers of a swapped leader go to the front of the queue)
    this.doSwaps(F);
    const d = this.now(); F.swap = d - c;
    // 4 issue by time budget
    let n = 0;
    while (this.queue.length && n < this.issuePerFrame && this.inflight.size < this.maxInFlight && (n === 0 || this.now() - a < this.gateMs)) {
      const e = this.queue.shift();
      if (e.key != null) { const L = this.leaders.get(e.key); if (L && L.left > 0) { (L.parked ||= []).push(e); this.stat.parked++; F.parked++; continue; } }
      const ti = this.now(); if (this.preTextures) this.prepTextures(e.m); F.tex += this.now() - ti;
      e.issue(e.m); e.progs = this.programsOf(e.m); n++; this.stat.issued++; F.issued++; if (F.names.length < 6) F.names.push(e.m.name || e.m.type);
      const nb = this.stat.newPrograms; this.track(e, 'issue'); if (this.stat.newPrograms === nb) this.stat.reused++;
      if (e.key != null && e.left > 0) this.leaders.set(e.key, e);
      if (this._swapList.length) this.doSwaps(F);
    }
    const g = this.now(); F.issue = g - d - F.tex; this.stat.texMs += F.tex; F.inflight = this.inflight.size;
    const t = g - a; if (t > this.stat.maxTickMs) this.stat.maxTickMs = t;
    if (!this.queue.length && !this.pending.length && !this._parkedN()) { this.done = true; this.stop(); this.summary(); if (this.onDone) this.onDone(this.stat); this._res(this.stat); }
  }
  doSwaps(F) { const list = this._swapList; this._swapList = [];
    for (const e of list) { const i = this.pending.indexOf(e); if (i < 0) continue; this.pending.splice(i, 1);
      e.apply(e.m); this.stat.swaps++; F.swaps++; if (this.onSwap) this.onSwap(e.m, this.left);
      if (e.key != null && this.leaders.get(e.key) === e) this.leaders.delete(e.key);
      if (e.parked) { this.queue.unshift(...e.parked); e.parked = null; } } }
  // the player's render loop adds its own cost to the current frame record
  noteRender(ms, progsMade = 0) { if (this.cur) { this.cur.render += ms; if (progsMade) this.cur.renderProgs = (this.cur.renderProgs || 0) + progsMade; } }
  topFrames(n = 10) { const r = (x) => Math.round(x * 10) / 10;
    return [...this.frameLog].sort((x, y) => (y.gap || 0) - (x.gap || 0)).slice(0, n).map(F => ({ f: F.f, t: F.t, gap: r(F.gap), issue: r(F.issue), check: r(F.check), uni: r(F.uni), swap: r(F.swap), tex: r(F.tex), render: r(F.render), renderProgs: F.renderProgs || 0, issued: F.issued, parked: F.parked, newProgs: F.newProgs, readyProgs: F.readyProgs, swaps: F.swaps, texN: F.texN || 0, inflight: F.inflight, names: F.names })); }
  programTimes() { const out = []; for (const [pg, p] of this.progs) out.push({ ...p, ms: p.t1 == null ? null : Math.round(p.t1 - p.t0), frames: p.f1 == null ? null : p.f1 - p.f0, name: pg.name });
    return out; }
  summary() { const all = this.programTimes(), done = all.filter(p => p.ms != null).sort((x, y) => y.ms - x.ms), ms = done.map(p => p.ms).sort((x, y) => x - y);
    const q = (f) => ms.length ? ms[Math.min(ms.length - 1, Math.floor(ms.length * f))] : null;
    const merged = done.filter(p => p.merged), mm = merged.map(p => p.ms).sort((x, y) => x - y);
    this.stat.programs = { n: all.length, ready: done.length, notReady: all.length - done.length, p50: q(0.5), p90: q(0.9), p99: q(0.99), max: ms[ms.length - 1] ?? null,
      buckets: [100, 500, 1000, 5000, 20000, 60000, Infinity].map((lim, i, A) => ({ le: lim === Infinity ? 'inf' : lim, n: ms.filter(x => x <= lim && (i === 0 || x > A[i - 1])).length })),
      merged: merged.length ? { n: merged.length, p50: mm[Math.floor(mm.length / 2)], max: mm[mm.length - 1] } : null,
      slowest: done.slice(0, 30).map(p => ({ ms: p.ms, frames: p.frames, key: p.key, owner: p.owner, merged: p.merged || undefined, issuedAt: Math.round(p.t0) })),
      // still in flight when summary() runs (call globalThis.__rrGate.summary() on a run that times out)
      waiting: all.filter(p => p.ms == null).sort((x, y) => x.t0 - y.t0).slice(0, 30).map(p => ({ ageMs: Math.round(this.now() - this.t0 - p.t0), key: p.key, owner: p.owner, merged: p.merged || undefined })) };
    this.stat.topFrames = this.topFrames(10); return this.stat; }
}
