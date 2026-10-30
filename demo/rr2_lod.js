// rr2_lod.js (main, Oct 29): lighter copies of the heaviest props, made after the open. The Intel laptop draws up to 12 M
// triangles a frame, most of them in a few dense props (potted plants 560k to 885k each, poppy groups up to 1.3 M, orchids
// 255k, foliage 300k). For every prop over lodTris triangles (radius under 6 m, its own geometry), a worker simplifies the
// index buffer to lodRatio of the triangles (meshoptimizer, same vertices, so every UV and lightmap channel stays as it is);
// the cull switches each frame between the full and the light index by distance (light beyond lodNear m).
const F = () => globalThis.RR_FLAGS || {};
export class PropLOD {
  constructor(cullList, { invalidate = () => {} } = {}) {
    this.stats = { candidates: 0, done: 0, failed: 0, trisBefore: 0, trisAfter: 0, ms: 0 }; this.invalidate = invalidate;
    const minT = +(F().lodTris ?? 60000), users = new Map();
    for (const e of cullList) users.set(e.o.geometry, (users.get(e.o.geometry) || 0) + 1);
    this.list = cullList.filter(e => e.tris >= minT && e.r < 6 && users.get(e.o.geometry) === 1 && e.o.geometry.index && !e.o.isSkinnedMesh && !e.o.morphTargetInfluences);
    this.stats.candidates = this.list.length; this.near = +(F().lodNear ?? 5);
    this.worker = new Worker(new URL('./rr2_lodworker.js', import.meta.url), { type: 'module' }); this.wait = new Map(); this.id = 0;
    this.worker.onmessage = (m) => { const r = this.wait.get(m.data.id); if (r) { this.wait.delete(m.data.id); r(m.data); } };
  }
  async run() {
    const t0 = performance.now(), ratio = +(F().lodRatio ?? 0.2), err = +(F().lodErr ?? 0.01);
    for (const e of this.list) {
      const g = e.o.geometry, p = g.attributes.position, pos = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) { pos[i * 3] = p.getX(i); pos[i * 3 + 1] = p.getY(i); pos[i * 3 + 2] = p.getZ(i); }
      const idx = new Uint32Array(g.index.count); for (let i = 0; i < idx.length; i++) idx[i] = g.index.getX(i);
      const id = ++this.id; const res = await new Promise(r => { this.wait.set(id, r); this.worker.postMessage({ id, pos, idx, ratio, err }, [pos.buffer]); });
      if (res.fail || !res.idx || res.idx.length >= idx.length * 0.9) { this.stats.failed++; continue; }
      const Arr = p.count < 65536 ? Uint16Array : Uint32Array, I = g.index.constructor;
      e.fullIndex = g.index; e.lodIndex = new I(Arr.from(res.idx), 1); e.lod = false;
      this.stats.done++; this.stats.trisBefore += idx.length / 3; this.stats.trisAfter += res.idx.length / 3;
      await new Promise(r => setTimeout(r, 0)); }
    this.stats.ms = Math.round(performance.now() - t0); this.worker.terminate(); this.invalidate(); return this.stats;
  }
  // called by the cull with each entry's distance (camera to bounding sphere surface)
  static pick(e, d, near) { if (!e.lodIndex) return; const want = d > near; if (want === e.lod) return; e.lod = want; e.o.geometry.setIndex(want ? e.lodIndex : e.fullIndex); }
}
