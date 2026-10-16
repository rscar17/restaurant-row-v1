// Live lights from the Blender scene: a fixed pool (no shader recompiles) filled with the lights nearest the camera.
// Units follow Cycles scene-linear radiance, the same units as the capture lighting: point/spot intensity = P / 4π,
// area luminance = P / (π A). The capture already contains every lamp's light at its own position, so live lights
// run at a calibrated fraction and mainly add what a single capture cannot: local falloff, highlights and contrast.
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';

const C = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1); // Blender -> three axes
export class LightPool {
  constructor(scene, lights, { spots = 12, points = 8, areas = 6, factor = 0.5, radius = 14, skip = null } = {}) {
    RectAreaLightUniformsLib.init();
    this.src = lights.map(l => {
      const Mb = new THREE.Matrix4().fromArray(l.matrix.flat()).transpose();
      const M = C.clone().multiply(Mb);
      const pos = new THREE.Vector3().setFromMatrixPosition(M);
      const q = new THREE.Quaternion(); const s = new THREE.Vector3(); M.decompose(new THREE.Vector3(), q, s);
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
      const strength = (l.node_strength && l.node_strength[0]) ?? 1;
      return { ...l, pos, q, dir, P: l.energy * strength };
    }).filter(l => l.type !== 'SUN' && !(skip && skip.has(l.name)));
    this.factor = factor; this.radius = radius;
    // lights exist and are visible from the start at zero intensity: the light count is part of every shader program,
    // so it must already be final when the shaders are compiled before the view opens (hidden lights that switched on
    // at the first frame made every program recompile on the spot, which froze the page for minutes)
    const mk = (n, f) => Array.from({ length: n }, () => { const o = f(); o.intensity = 0; o.visible = true; scene.add(o); if (o.target) scene.add(o.target); return o; });
    this.spots = mk(spots, () => new THREE.SpotLight(0xffffff, 0, 0, Math.PI / 3, 1, 2));
    this.points = mk(points, () => new THREE.PointLight(0xffffff, 0, 0, 2));
    this.areas = mk(areas, () => new THREE.RectAreaLight(0xffffff, 0, 1, 1));
  }
  update(camPos) {
    const near = this.src.map(l => ({ l, d: l.pos.distanceTo(camPos) })).filter(x => x.d < this.radius)
      .sort((a, b) => (b.l.P / (b.d * b.d + 4)) - (a.l.P / (a.d * a.d + 4)));
    let si = 0, pi = 0, ai = 0;
    for (const { l } of near) {
      const col = new THREE.Color(l.color[0], l.color[1], l.color[2]);
      if (l.type === 'AREA' && ai < this.areas.length) {
        const a = this.areas[ai++]; const w = l.size || 1, h = (l.shape === 'RECTANGLE' || l.shape === 'ELLIPSE') ? (l.size_y || w) : w;
        const A = (l.shape === 'DISK' || l.shape === 'ELLIPSE') ? Math.PI * w * h / 4 : w * h;
        a.width = w; a.height = h; a.position.copy(l.pos); a.quaternion.copy(l.q);
        a.color.copy(col); a.intensity = this.factor * l.P / (Math.PI * A); a.visible = true;
      } else if (l.type === 'SPOT' && si < this.spots.length) {
        const s = this.spots[si++]; s.position.copy(l.pos); s.target.position.copy(l.pos).add(l.dir); s.target.updateMatrixWorld();
        const cone = l.ies ? Math.PI / 3 : Math.min(l.spot_size / 2, Math.PI / 2 - 0.01);
        s.angle = cone; s.penumbra = l.ies ? 1 : Math.min(1, l.spot_blend ?? 0.15);
        s.color.copy(col); s.intensity = this.factor * l.P / (4 * Math.PI); s.visible = true;
      } else if (l.type === 'POINT' && pi < this.points.length) {
        // a spot past the spot slots is dropped, not drawn as a point light: tfix_dlL8 (30 W, 1.6 cm under the B080
        // coffer field) was the 13th spot at B080 and lit the field above it as an omni point, the large halo of m54 to m56
        // (B080 py 0 500 300 800) that the 360s do not have (a 175 deg cone sends nothing up)
        const p = this.points[pi++]; p.position.copy(l.pos); p.color.copy(col); p.intensity = this.factor * l.P / (4 * Math.PI); p.visible = true;
      }
    }
    for (const arr of [this.spots, this.points, this.areas]) for (const o of arr) if (!o.visible) o.intensity = 0;
    for (let i = si; i < this.spots.length; i++) this.spots[i].intensity = 0;
    for (let i = pi; i < this.points.length; i++) this.points[i].intensity = 0;
    for (let i = ai; i < this.areas.length; i++) this.areas[i].intensity = 0;
    for (const arr of [this.spots, this.points, this.areas]) for (const o of arr) o.visible = true; // keep light count constant: no recompiles
  }
}
