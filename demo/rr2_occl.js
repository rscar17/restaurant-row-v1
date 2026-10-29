// rr2_occl.js (main, Oct 29): line of sight culling for walking level views. The Intel laptop is draw call bound (about 1800
// calls a frame, 2900 of 5200 visible meshes farther than 25 m, most of them behind walls: nothing occluded them). Opaque
// meshes of building size (radius >= occR m, never glass or anything transparent) go into one world space BVH; every other
// cullList entry belongs to an 8 m cell; a cell is drawn when any of its sample rays (box centre, then its 8 corners pulled 10 %
// in) from the camera reaches within 0.3 m of its point unblocked. Glass never blocks (transparent meshes are not occluders).
// A cell stays drawn occHold ms after its last clear ray, so a turn never shows a hole for a frame. Off above 3 m (overview).
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

export class LineOfSight {
  constructor(cullList, { occR = 2.5, cell = 8, holdMs = 600, framesPerSweep = 4 } = {}) {
    this.holdMs = holdMs; this.framesPerSweep = framesPerSweep; this.stats = { occluderTris: 0, cells: 0, buildMs: 0, rays: 0, hidden: 0 };
    const t0 = performance.now(), pos = [], idx = []; let base = 0; const v = new THREE.Vector3(), bb = new THREE.Box3();
    for (const e of cullList) { const o = e.o, m = o.material;
      if (e.r < occR || !m || m.transparent || (Array.isArray(m)) || m.opacity < 1 || m.alphaTest > 0) continue;
      // walls only: floors, ceilings and trays (under 1.8 m tall) caught the sample rays at grazing angles and hid what stood
      // on them (first proof: up to 13 % of pixels lost at the Palazzo stop)
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); bb.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld); if (bb.max.y - bb.min.y < 1.8) continue;
      const p = o.geometry.attributes.position, ix = o.geometry.index;
      for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); pos.push(v.x, v.y, v.z); }
      if (ix) for (let i = 0; i < ix.count; i++) idx.push(base + ix.getX(i)); else for (let i = 0; i < p.count; i++) idx.push(base + i);
      base += p.count; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    this.bvh = new MeshBVH(g, { maxLeafTris: 8 }); this.stats.occluderTris = idx.length / 3;
    // cells: every entry not itself an occluder sized piece
    this.cells = new Map();
    for (const e of cullList) { if (e.r >= 6) { e.cell = null; continue; }
      const key = Math.floor(e.c.x / cell) + ',' + Math.floor(e.c.y / 4) + ',' + Math.floor(e.c.z / cell);
      let c = this.cells.get(key); if (!c) this.cells.set(key, c = { box: new THREE.Box3(), seen: performance.now(), vis: true, pts: null });
      c.box.expandByPoint(e.c.clone().addScalar(-e.r)); c.box.expandByPoint(e.c.clone().addScalar(e.r)); e.cell = c; }
    this.list = [...this.cells.values()]; this.stats.cells = this.list.length;
    // 27 sample points per cell (3 x 3 x 3 grid, 80 % of the width, 25 to 75 % of the height), centre first
    for (const c of this.list) { const ctr = c.box.getCenter(new THREE.Vector3()), s = c.box.getSize(new THREE.Vector3()).multiply(new THREE.Vector3(0.4, 0.25, 0.4));
      c.pts = [ctr]; for (const sx of [-1, 0, 1]) for (const sy of [-1, 0, 1]) for (const sz of [-1, 0, 1]) if (sx || sy || sz) c.pts.push(ctr.clone().add(new THREE.Vector3(sx * s.x, sy * s.y, sz * s.z))); }
    this.ray = new THREE.Ray(); this.k = 0; this.frustum = new THREE.Frustum(); this.m = new THREE.Matrix4(); this.enabled = true;
    this.stats.buildMs = Math.round(performance.now() - t0);
  }
  // one slice of cells per call (framesPerSweep slices per full sweep); camera above 3 m or disabled: everything visible
  update(camera) {
    const cam = camera.position, now = performance.now();
    if (!this.enabled || cam.y > 3) { this.off = true; return; } this.off = false;
    this.m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); this.frustum.setFromProjectionMatrix(this.m);
    const n = this.list.length, per = Math.ceil(n / this.framesPerSweep), from = (this.k++ % this.framesPerSweep) * per;
    for (let i = from; i < Math.min(n, from + per); i++) { const c = this.list[i];
      if (c.box.containsPoint(cam) || c.box.distanceToPoint(cam) < 4 || !this.frustum.intersectsBox(c.box)) { c.seen = now; continue; }
      for (const p of c.pts) { const d = p.distanceTo(cam); this.ray.origin.copy(cam); this.ray.direction.subVectors(p, cam).divideScalar(d); this.stats.rays++;
        const hit = this.bvh.raycastFirst(this.ray, THREE.DoubleSide, 0, d);
        if (!hit || hit.distance > d - 0.3) { c.seen = now; break; } } }
    let hid = 0; for (const c of this.list) { c.vis = now - c.seen < this.holdMs; if (!c.vis) hid++; } this.stats.hidden = hid;
  }
  visible(e) { return this.off || !e.cell || e.cell.vis; }
}
