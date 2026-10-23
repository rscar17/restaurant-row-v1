// rr2_gjfix3.js (hero builder 2, Oct 22 evening): Gjelina main room against Ryan's three interior photos
// (R\Exteriors\gjelina_interior_ryan_1022: wide_canopy_banquette, bar_green_plaster, pass_counter_column) and the Trip Davis
// dining room photos. RR_FLAGS.nogjfix3 turns all of it off; each part has its own flag.
// Blender coordinates in the comments, three = (x, z, -y). The hall runs along n = (-0.378, 0.926) (22.23 degrees off +y,
// the same axis gjfix2 uses for the bar wall); u = (0.926, 0.378) is the width axis. Local group axes: x = u, y = up, z = -n.
// 1. CANOPY (wide_canopy_banquette, pass_counter_column): one thick dropped box with rounded corners over the hall centre
//    (Blender centre -19.6, 10.5; 6.4 m across the hall, 7.2 m along it, underside at 2.86 m, 0.42 m thick) in deep green
//    Venetian plaster (glossy, low roughness), 48 pin downlights in its underside, two linear slot diffusers, and a warm cove
//    strip along its top edge that glows onto the cream ceiling. RR_FLAGS.nogjcanopy.
// 2. PASS COUNTER under it: oak top 4.4 x 1.05 m at 1.0 m on an antiqued smoked mirror base, dark turned legs (cylinders),
//    a square column clad in antiqued mirror up to the canopy at the counter's east end, three gooseneck task lamps, plate
//    stacks, oil bottles and a fruit bowl. Behind it (3.0 m up the hall) a black steel framed reeded glass partition, 6 m
//    wide, 2.45 m high, with the open kitchen behind it: a lit cream back wall, stainless shelf blocks and a pass shelf
//    with glasses. Communal tables, chairs and pendants whose footprint falls inside the counter and kitchen block are taken
//    out (draw range 0 / zero scale, kept in the scene). RR_FLAGS.nogjpass.
// 3. BAR (bar_green_plaster): the long bar ri_bar_front (centre -22.55, -3.85, 11 m along u) gets a white and grey veined
//    marble top with a dark antiqued base skirt, a brass foot rail, warm LED under glow, nine tan leather stools on black
//    frames along the room side, green plaster piers either end of the back bar, and three brass ring pendant clusters of
//    glowing glass globes over the bar. RR_FLAGS.nogjbar.
// 4. Mesh_2346 (Material_92.004, an 11 x 6 x 4.3 m photo card box standing 0.4 m off the floor in the front room, the
//    twin of the hidden Mesh_154) is taken out: from inside the room it is the stray partition. RR_FLAGS.nogjhide3.
// Light: no code lights; new surfaces take the room's baked light gain (rooms.patch, as gjfix2) and the lamps are emissive.
import * as THREE from 'three';

// Procedural PBR maps (no downloads tonight): value noise fbm on a canvas, repeat wrapped. plasterMap(): mottled Venetian plaster
// colour, plasterRough(): its roughness; marbleMap(): white ground with grey violet veins (Calacatta Viola); mirrorMap(): antiqued foxing.
const _texCache = {};
function fbmCanvas(key, size, fn) {
  if (_texCache[key]) return _texCache[key];
  const cv = document.createElement('canvas'); cv.width = cv.height = size; const ctx = cv.getContext('2d'); const img = ctx.createImageData(size, size), d = img.data;
  const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const W = 64;
  const vn = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = hash(xi & (W - 1), yi & (W - 1)), b = hash((xi + 1) & (W - 1), yi & (W - 1)), c = hash(xi & (W - 1), (yi + 1) & (W - 1)), e = hash((xi + 1) & (W - 1), (yi + 1) & (W - 1));
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + e) * sx * sy; };
  const fbm = (x, y, o) => { let v = 0, a = 0.5, f = 1, n = 0; for (let i = 0; i < o; i++) { v += a * vn(x * f, y * f); n += a; a *= 0.5; f *= 2; } return v / n; };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const c = fn(x / size, y / size, fbm); const i = 4 * (y * size + x); d[i] = c[0] * 255; d[i + 1] = c[1] * 255; d[i + 2] = c[2] * 255; d[i + 3] = 255; }
  ctx.putImageData(img, 0, 0); const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; _texCache[key] = t; return t;
}
const mix3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const plasterMap = (c0, c1) => fbmCanvas('gj3_plaster' + c0.join(), 512, (x, y, fbm) => { const n = fbm(x * 12, y * 12, 6), m = fbm(x * 40 + 7, y * 40 + 3, 4); return mix3(c0, c1, Math.pow(n, 1.4) * 0.75 + m * 0.25); });
const plasterRough = () => fbmCanvas('gj3_plaster_r', 512, (x, y, fbm) => { const r = 0.15 + 0.55 * fbm(x * 16 + 3, y * 16 + 9, 5); return [1, r, 0]; });   // green channel = roughness
const marbleMap = () => fbmCanvas('gj3_marble', 1024, (x, y, fbm) => { const w = fbm(x * 6, y * 6, 5) * 3.0; const v1 = Math.abs(Math.sin((x * 3.2 + w) * Math.PI * 2 + y * 2)), v2 = Math.abs(Math.sin((y * 4.1 + w * 0.7) * Math.PI * 2));
  const vein = Math.min(1, Math.pow(1 - Math.min(v1, 1), 18) * 0.9 + Math.pow(1 - Math.min(v2, 1), 30) * 0.6), g = fbm(x * 30, y * 30, 3) * 0.08; return mix3([0.93 - g, 0.92 - g, 0.90 - g], [0.36, 0.3, 0.36], vein); });
const mirrorMap = () => fbmCanvas('gj3_mirror', 512, (x, y, fbm) => { const n = fbm(x * 9, y * 9, 6), sp = fbm(x * 50, y * 50, 3), k = Math.pow(n, 2.2); return [0.62 - 0.35 * k + 0.08 * sp, 0.52 - 0.32 * k + 0.06 * sp, 0.34 - 0.22 * k + 0.04 * sp]; });

const A = 22.23 * Math.PI / 180, NX = -Math.sin(A), NY = Math.cos(A), UX = Math.cos(A), UY = Math.sin(A);
const GJ3 = {
  canopy: { c: [-19.6, 10.3], w: 7.0, l: 7.6, z0: 2.86, z1: 3.28 },
  counter: { c: [-19.6, 10.5], w: 4.4, d: 1.05, top: 1.0 },
  banq: { c: [-22.1, 8.55], len: 4.2, leg: 3.4 },   // L banquette: back along y 8.55 (x -24.2 to -20.0, facing -y) and a leg down x -24.3 (y 5.2 to 8.55, facing +x), where communal_05 stood
  kitchen: { s: 3.0, w: 6.0, h: 2.45, back: 1.25 },
  bar: { c: [-22.55, -3.85], len: 11.0, d: 1.24, top: 1.1, stools: 9 },
  clear: { s0: -1.6, s1: 4.6, t0: -3.4, t1: 3.4 },   // block cleared of tables and chairs (local s along n, t along u, metres from the counter centre)
};
export function gjfix3Apply(root, rooms) {
  const F = globalThis.RR_FLAGS || {}, rep = {}; if (F.nogjfix3) return null;
  const BUILT = !F.gjjs;   // staged: data/gjM2c/018.glb carries the baked pieces (stage_gjhero.py); RR_FLAGS.gjjs = 1 draws the primitives instead
  root.updateMatrixWorld(true);
  const nm = (o) => o.userData.invName || o.name || '';
  const lit = (m) => { if (rooms && rooms.patch) { try { rooms.patch(m); } catch (e) { /* plain */ } } return m; };
  const B2T = (x, y, z) => new THREE.Vector3(x, z, -y);
  const std = (c, r, extra) => lit(new THREE.MeshStandardMaterial(Object.assign({ color: new THREE.Color(...c), roughness: r, metalness: 0 }, extra || {})));
  const glow = (c, k) => new THREE.MeshBasicMaterial({ color: new THREE.Color(...c).multiplyScalar(k), fog: false, side: THREE.DoubleSide });
  const box = (w, h, d, m, x, y, z, name) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.name = name || 'gjfix3'; o.userData.invName = o.name; return o; };
  const cyl = (r0, r1, h, m, x, y, z, seg, name) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg || 16), m); o.position.set(x, y, z); o.name = name || 'gjfix3'; o.userData.invName = o.name; return o; };
  const group = (cx, cy, name, ang) => { const g = new THREE.Group(); g.position.copy(B2T(cx, cy, 0)); g.rotation.y = ang == null ? 0 : ang; g.name = name; g.userData.invName = name; return g; };
  // local point (t across, s along the hall, z up) -> local group coordinates (x = t, y = z, z = -s)
  const L = (t, s, z) => [t, z, -s];
  const bToLocal = (bx, by, c) => [bx - c[0], by - c[1]];   // [t, s]: hall axis aligned (t = x, s = y)

  // 4. stray photo card box
  if (!F.nogjhide3) { let k = 0; root.traverse(o => { if (o.isMesh && !o.isInstancedMesh && /^(Mesh_2346|riw_back|riw_shelf[12]|Mesh_1919|Mesh_1970|Mesh_2019|r9zz_gj_communal_05_.*|r9zx_gj_communal_05_lt.*)$/.test(nm(o)) && (o.visible !== false || o.geometry.drawRange.count)) { o.visible = false; o.userData.gjfix3Hidden = [o.geometry.drawRange.start, o.geometry.drawRange.count]; o.geometry.setDrawRange(0, 0); k++; } }); rep.hidden = k; }

  // 2a. clear the counter and kitchen block of loose furniture (tables, chairs, pendants, table lights); shells stay
  if (!F.nogjpass) { const C = GJ3.clear, cc = GJ3.counter.c, bb = new THREE.Box3(), P = new THREE.Vector3(), M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), Z = new THREE.Vector3();
    const inBlock = (bx, by) => { const [t, s] = bToLocal(bx, by, cc); return t > C.t0 && t < C.t1 && s > C.s0 && s < C.s1; };
    const shell = /^(r134_(f|ceil)|r135_|r136_|Mesh_2254$|ri_|riw_|gi_|gjfix|gjl_|mbf_|trim_|rot_|CL_)/; let nT = 0, nI = 0;
    root.traverse(o => { if (!o.isMesh) return; const n = nm(o); if (shell.test(n) || /^gjfix3/.test(n)) return;
      if (o.isInstancedMesh) { let k = 0;
        for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, M); P.setFromMatrixPosition(M.premultiply(o.matrixWorld)); if (P.y < 3.2 && inBlock(P.x, -P.z)) { o.getMatrixAt(i, M); M.decompose(P, Q, S); o.setMatrixAt(i, M.compose(P, Q, Z)); k++; } }
        if (k) { o.instanceMatrix.needsUpdate = true; o.computeBoundingSphere(); o.userData.gjfix3Zeroed = k; nI += k; } return; }
      if (!o.geometry || !o.geometry.boundingBox) { if (o.geometry) o.geometry.computeBoundingBox(); else return; }
      bb.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld); const sz = bb.getSize(P);
      if (sz.y > 3.0 || Math.max(sz.x, sz.z) > 8) return;   // walls, floors, ceilings
      const c = bb.getCenter(new THREE.Vector3()); if (c.y < 3.2 && inBlock(c.x, -c.z) && (o.visible !== false || o.geometry.drawRange.count)) { o.visible = false; o.userData.gjfix3Hidden = [o.geometry.drawRange.start, o.geometry.drawRange.count]; o.geometry.setDrawRange(0, 0); nT++; } });
    rep.clearedMeshes = nT; rep.clearedInstances = nI; }

  // 1. canopy
  if (!BUILT && !F.nogjcanopy && !root.getObjectByName('gjfix3_canopy')) { const K = GJ3.canopy, g = group(K.c[0], K.c[1], 'gjfix3_canopy'), h = K.z1 - K.z0, r = 0.35;
    const gmap = plasterMap([0.09, 0.16, 0.12], [0.26, 0.38, 0.3]); gmap.repeat.set(2, 2); const grough = plasterRough(); grough.repeat.set(2, 2);
    const green = std([1, 1, 1], 1.0, { map: gmap, roughnessMap: grough, metalness: 0.1, envMapIntensity: 1.8 }); green.name = 'gjfix3_green_plaster';
    const shape = new THREE.Shape(); const w = K.w / 2, l = K.l / 2;   // rounded rectangle in the x z plane (t, s)
    shape.moveTo(-w + r, -l); shape.lineTo(w - r, -l); shape.quadraticCurveTo(w, -l, w, -l + r); shape.lineTo(w, l - r); shape.quadraticCurveTo(w, l, w - r, l); shape.lineTo(-w + r, l); shape.quadraticCurveTo(-w, l, -w, l - r); shape.lineTo(-w, -l + r); shape.quadraticCurveTo(-w, -l, -w + r, -l);
    const eg = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2, curveSegments: 6 }); eg.rotateX(-Math.PI / 2); eg.translate(0, K.z0, 0);   // shape y -> -z = s; extrude along +y
    const slab = new THREE.Mesh(eg, green); slab.name = 'gjfix3_canopy_slab'; slab.userData.invName = slab.name; g.add(slab);
    // pin downlights in the underside: 8 x 6 grid, 0.55 m in from the edge, 5 mm below the slab
    const dg = new THREE.CircleGeometry(0.036, 10); dg.rotateX(Math.PI / 2); const dm = glow([1.0, 0.94, 0.82], 3.0); dm.name = 'gjfix3_pin';
    const nx = 8, nz = 6, im = new THREE.InstancedMesh(dg, dm, nx * nz); im.name = 'gjfix3_pins'; im.userData.invName = im.name; const M = new THREE.Matrix4(); let i = 0;
    for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++) { const t = -w + 0.55 + a * (K.w - 1.1) / (nx - 1), s = -l + 0.55 + b * (K.l - 1.1) / (nz - 1); im.setMatrixAt(i++, M.makeTranslation(t, K.z0 - 0.045, -s)); }
    im.instanceMatrix.needsUpdate = true; g.add(im);
    // two linear slot diffusers (thin black slots) along the hall axis
    const slot = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.01, 0.01, 0.01), fog: false }); g.add(box(0.05, 0.004, K.l - 1.6, slot, -w * 0.55, K.z0 - 0.045, 0)); g.add(box(0.05, 0.004, K.l - 1.6, slot, w * 0.55, K.z0 - 0.045, 0));
    // cove: a warm lit band round the top edge of the slab sides (the LED cove that glows onto the cream ceiling above)
    const cvm = glow([1.0, 0.82, 0.58], 1.9), ch = 0.055, cy = K.z1 - 0.045; g.add(box(K.w + 0.02, ch, 0.02, cvm, 0, cy, -l)); g.add(box(K.w + 0.02, ch, 0.02, cvm, 0, cy, l)); g.add(box(0.02, ch, K.l + 0.02, cvm, -w, cy, 0)); g.add(box(0.02, ch, K.l + 0.02, cvm, w, cy, 0));
    root.add(g); rep.canopy = 1; }

  // 2. pass counter, column, kitchen partition
  if (!BUILT && !F.nogjpass && !root.getObjectByName('gjfix3_pass')) { const K = GJ3.counter, Kt = GJ3.kitchen, g = group(K.c[0], K.c[1], 'gjfix3_pass');
    let oak = null; root.traverse(o => { if (!oak && o.isMesh && /^r9zz_gj_communal/.test(nm(o)) && o.material && o.material.map) oak = o.material; }); if (!oak) { oak = std([0.46, 0.31, 0.16], 0.55); oak.name = 'gjfix3_oak'; }
    const mmap = mirrorMap(); mmap.repeat.set(3, 1); const mirror = std([1, 1, 1], 0.28, { map: mmap, metalness: 0.75, envMapIntensity: 2.2 }); mirror.name = 'gjfix3_antique_mirror';
    const black = std([0.02, 0.018, 0.016], 0.5); black.name = 'gjfix3_black';
    const steel = std([0.6, 0.6, 0.6], 0.3, { metalness: 0.9 }); steel.name = 'gjfix3_steel';
    const white = std([0.85, 0.85, 0.82], 0.35); white.name = 'gjfix3_white';
    const marble = std([0.9, 0.88, 0.85], 0.22, { map: marbleMap(), envMapIntensity: 1.4 }); marble.name = 'gjfix3_marble_column';
    const brass = std([0.78, 0.56, 0.24], 0.3, { metalness: 0.9 }); brass.name = 'gjfix3_brass';
    const [w, d, top] = [K.w, K.d, K.top];
    g.add(box(w, 0.05, d, oak, 0, top - 0.025, 0, 'gjfix3_counter_top'));
    g.add(box(w - 0.3, top - 0.12, d - 0.2, mirror, 0, (top - 0.12) / 2 + 0.06, 0, 'gjfix3_counter_base'));
    g.add(box(w - 0.3, 0.06, d - 0.2, black, 0, 0.03, 0));   // plinth
    for (const tx of [-w / 2 + 0.12, w / 2 - 0.12]) for (const sz of [-d / 2 + 0.1, d / 2 - 0.1]) g.add(cyl(0.045, 0.06, top - 0.05, black, tx, (top - 0.05) / 2, sz, 10, 'gjfix3_leg'));
    // column at the east end of the counter: 0.62 m square, antiqued mirror lower, veined marble upper, to the canopy underside
    const colx = w / 2 + 0.45; g.add(box(0.62, GJ3.canopy.z0 - 0.3, 0.62, mirror, colx, 0.3 + (GJ3.canopy.z0 - 0.3) / 2, 0.15, 'gjfix3_column_mirror')); g.add(box(0.66, 0.3, 0.66, marble, colx, 0.15, 0.15, 'gjfix3_column_marble'));
    // gooseneck lamps: black dome on a thin rod, three along the top
    for (const tx of [-1.5, -0.1, 1.3]) { g.add(cyl(0.006, 0.006, 0.42, black, tx, top + 0.21, -0.3, 6)); const sh = cyl(0.02, 0.09, 0.09, black, tx + 0.08, top + 0.44, -0.24, 12, 'gjfix3_lamp'); sh.rotation.z = 0.5; g.add(sh); g.add(cyl(0.015, 0.06, 0.01, glow([1, 0.85, 0.6], 2.5), tx + 0.1, top + 0.405, -0.22, 10)); }
    // plate stacks, bowls, oil bottles
    for (const [tx, sz, h, r] of [[-1.9, 0.2, 0.16, 0.13], [-1.55, 0.25, 0.1, 0.11], [0.5, 0.25, 0.14, 0.12], [1.2, 0.2, 0.08, 0.14]]) g.add(cyl(r, r, h, white, tx, top + h / 2, sz, 18, 'gjfix3_plates'));
    const fruit = std([0.75, 0.3, 0.1], 0.5); g.add(cyl(0.16, 0.11, 0.08, fruit, -0.8, top + 0.04, 0.25, 18, 'gjfix3_bowl'));
    const olive = std([0.25, 0.3, 0.08], 0.1, { transparent: true, opacity: 0.85 }); for (const tx of [1.65, 1.78, 1.9]) g.add(cyl(0.03, 0.03, 0.28, olive, tx, top + 0.14, -0.3, 8, 'gjfix3_bottle'));
    // kitchen partition: black steel frame grid with reeded glass, 6 m wide, 2.45 m high, on a 0.9 m black plinth wall
    const ks = Kt.s, kw = Kt.w, kh = Kt.h; const glass = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(0.86, 0.9, 0.9), roughness: 0.55, metalness: 0, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }); glass.name = 'gjfix3_reeded_glass';
    g.add(box(kw, 0.9, 0.12, black, 0, 0.45, -ks, 'gjfix3_kitchen_plinth'));
    g.add(box(kw, kh - 0.9, 0.02, glass, 0, 0.9 + (kh - 0.9) / 2, -ks, 'gjfix3_kitchen_glass'));
    const bays = 5; for (let i = 0; i <= bays; i++) g.add(box(0.07, kh, 0.08, black, -kw / 2 + i * kw / bays, kh / 2, -ks, 'gjfix3_mullion'));
    for (const zz of [0.9, 1.7, kh]) g.add(box(kw, 0.07, 0.08, black, 0, zz, -ks, 'gjfix3_rail'));
    g.add(box(kw + 0.2, 0.12, 0.16, black, 0, kh + 0.06, -ks, 'gjfix3_header'));
    // open kitchen behind: lit cream back wall, stainless shelving blocks, a bright pass shelf with glasses
    const kb = ks + Kt.back; const cream = glow([0.95, 0.84, 0.66], 0.5); cream.name = 'gjfix3_kitchen_wall';
    g.add(box(kw + 0.6, 3.2, 0.06, cream, 0, 1.6, -kb, 'gjfix3_kitchen_back'));
    for (const tx of [-2.2, 0, 2.2]) { g.add(box(1.6, 0.9, 0.7, steel, tx, 0.45, -kb + 0.4, 'gjfix3_kitchen_bench')); for (const zz of [1.5, 1.95, 2.4]) g.add(box(1.6, 0.03, 0.35, steel, tx, zz, -kb + 0.2, 'gjfix3_kitchen_shelf')); }
    const glassy = std([0.9, 0.92, 0.9], 0.1, { transparent: true, opacity: 0.6 }); for (let i = 0; i < 14; i++) g.add(cyl(0.035, 0.03, 0.12, glassy, -2.9 + i * 0.42, 1.56, -kb + 0.2, 8, 'gjfix3_glass'));
    g.add(box(kw - 0.4, 0.02, 0.1, glow([1, 0.9, 0.75], 2.0), 0, 2.46, -kb + 0.4, 'gjfix3_kitchen_strip'));   // shelf light
    // low oak stools (black metal) along the counter's room side, three each end, as the photo's bar press seats
    const seat = std([0.5, 0.33, 0.17], 0.5); for (const tx of [-1.6, -1.0, -0.4, 0.4, 1.0, 1.6]) { g.add(box(0.36, 0.03, 0.36, seat, tx, 0.74, d / 2 + 0.45, 'gjfix3_stool')); g.add(box(0.03, 0.36, 0.3, black, tx, 0.95, d / 2 + 0.6)); for (const [a, b] of [[-0.15, -0.15], [0.15, -0.15], [-0.15, 0.15], [0.15, 0.15]]) g.add(cyl(0.01, 0.01, 0.73, black, tx + a, 0.365, d / 2 + 0.45 + b, 6)); }
    root.add(g); rep.pass = 1; }


  // 5. L shaped oak banquette with tan leather cushions and pale oak slat sides (wide_canopy_banquette), two square oak
  //    tables with light oak chairs in front of it. RR_FLAGS.nogjbanq.
  if (!BUILT && !F.nogjbanq && !root.getObjectByName('gjfix3_banq')) { const K = GJ3.banq, g = group(K.c[0], K.c[1], 'gjfix3_banq');
    const oakp = std([0.58, 0.42, 0.24], 0.5); oakp.name = 'gjfix3_pale_oak'; const leather = std([0.52, 0.3, 0.13], 0.42, { envMapIntensity: 0.8 }); leather.name = 'gjfix3_tan_leather';
    const oakd = std([0.46, 0.31, 0.16], 0.5); const black = std([0.02, 0.018, 0.016], 0.5);
    const seatH = 0.46, backH = 1.1, dep = 0.6; const cx0 = -K.len / 2;   // local x along Blender x, local z = -y
    const bench = (len, ax, az, rotY) => { const b = new THREE.Group(); b.position.set(ax, 0, az); b.rotation.y = rotY;   // bench along its local x, seat faces -z (local)
      b.add(box(len, 0.12, dep, oakp, 0, 0.06, 0)); b.add(box(len, seatH - 0.22, dep - 0.04, oakp, 0, 0.12 + (seatH - 0.22) / 2, 0));   // plinth and oak box
      const cush = box(len - 0.04, 0.12, dep - 0.04, leather, 0, seatH - 0.04, 0.03); b.add(cush);
      b.add(box(len, backH - seatH, 0.1, oakp, 0, seatH + (backH - seatH) / 2, dep / 2 - 0.02));   // oak back board
      b.add(box(len - 0.04, 0.46, 0.08, leather, 0, seatH + 0.3, dep / 2 - 0.1));   // leather back cushion
      for (let i = 0; i < Math.round(len / 0.08); i++) b.add(box(0.03, backH, 0.03, oakp, -len / 2 + 0.04 + i * 0.08, backH / 2, dep / 2 + 0.01));   // slats
      b.add(box(0.06, backH, dep, oakp, -len / 2 + 0.03, backH / 2, 0)); b.add(box(0.06, backH, dep, oakp, len / 2 - 0.03, backH / 2, 0)); return b; };
    g.add(bench(K.len, 0, 0, 0));   // back run: seat faces -y (local -z)... local -z = Blender +y, so flip: rotate PI
    g.children[0].rotation.y = Math.PI;   // seat faces Blender -y (toward the room and the pose int4)
    g.add(bench(K.leg, cx0 - 0.1, (K.leg / 2) - 0.0, Math.PI / 2));   // leg down the west side, seat faces Blender +x
    // two square oak tables (0.8 m) with two light oak chairs each, 0.75 m in front of the back run
    for (const tx of [-1.1, 1.1]) { g.add(box(0.8, 0.04, 0.8, oakd, tx, 0.74, 0.85, 'gjfix3_banq_table')); g.add(cyl(0.03, 0.03, 0.72, black, tx, 0.36, 0.85, 8)); g.add(cyl(0.25, 0.25, 0.02, black, tx, 0.01, 0.85, 14));
      for (const dx of [-0.25, 0.25]) { const cz = 1.5; g.add(box(0.42, 0.03, 0.42, oakp, tx + dx, 0.45, cz, 'gjfix3_banq_chair')); g.add(box(0.42, 0.42, 0.03, oakp, tx + dx, 0.68, cz + 0.2)); for (const [a, b] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) g.add(box(0.03, 0.45, 0.03, oakp, tx + dx + a, 0.225, cz + b)); } }
    root.add(g); rep.banq = 1; }
  // 3. bar: marble top, dark base skirt, foot rail, under glow, stools, green piers, globe pendants
  if (!BUILT && !F.nogjbar && !root.getObjectByName('gjfix3_bar')) { const K = GJ3.bar, g = group(K.c[0], K.c[1], 'gjfix3_bar', A);
    const bm = marbleMap().clone(); bm.needsUpdate = true; bm.repeat.set(6, 1); const marble = std([0.92, 0.9, 0.88], 0.16, { map: bm, envMapIntensity: 1.8 }); marble.name = 'gjfix3_calacatta';
    const base = std([0.03, 0.028, 0.025], 0.45); base.name = 'gjfix3_bar_base';
    const brass = std([0.78, 0.56, 0.24], 0.3, { metalness: 0.9 }); const tan = std([0.5, 0.3, 0.14], 0.55); const black = std([0.02, 0.018, 0.016], 0.5);
    const green = std([0.055, 0.095, 0.07], 0.25, { metalness: 0.05 });
    // room side is -s (the rotunda glass side); the back bar wall is +s
    g.add(box(K.len + 0.2, 0.04, K.d + 0.16, marble, 0, K.top + 0.02, 0, 'gjfix3_bar_top'));
    g.add(box(K.len + 0.1, K.top - 0.1, 0.06, base, 0, (K.top - 0.1) / 2 + 0.04, K.d / 2 + 0.06, 'gjfix3_bar_skirt'));   // dark antiqued front skirt on the room side
    g.add(cyl(0.02, 0.02, K.len, brass, 0, 0.22, K.d / 2 + 0.3, 10).rotateZ(Math.PI / 2));
    g.add(box(K.len, 0.02, 0.05, glow([1, 0.8, 0.5], 1.6), 0, 0.06, K.d / 2 + 0.08, 'gjfix3_bar_glow'));
    for (let i = 0; i < K.stools; i++) { const tx = -K.len / 2 + 0.9 + i * (K.len - 1.8) / (K.stools - 1), sz = K.d / 2 + 0.55;
      g.add(cyl(0.19, 0.19, 0.06, tan, tx, 0.78, sz, 14, 'gjfix3_bar_stool')); g.add(cyl(0.012, 0.012, 0.75, black, tx, 0.375, sz, 6)); g.add(cyl(0.2, 0.2, 0.02, black, tx, 0.01, sz, 14));
      const bk = box(0.3, 0.26, 0.03, tan, tx, 1.02, sz + 0.17); g.add(bk); g.add(cyl(0.008, 0.008, 0.3, black, tx - 0.12, 0.93, sz + 0.17, 6)); g.add(cyl(0.008, 0.008, 0.3, black, tx + 0.12, 0.93, sz + 0.17, 6)); }
    for (const tx of [-K.len / 2 - 0.2, K.len / 2 + 0.2]) g.add(box(0.5, 3.25, 0.5, green, tx, 1.625, -K.d / 2 - 0.4, 'gjfix3_bar_pier'));
    const globe = glow([1, 0.85, 0.6], 1.8); const ring = brass;
    for (const tx of [-3.2, 0, 3.2]) { g.add(cyl(0.004, 0.004, 0.9, brass, tx, 2.85, 0, 4)); const rg = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.012, 6, 28), ring); rg.position.set(tx, 2.4, 0); rg.rotation.y = 0.4; rg.name = 'gjfix3_ring'; g.add(rg);
      for (const [a, b, c] of [[0, 0, 0], [0.26, -0.18, 0.08], [-0.2, 0.14, -0.1]]) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 10), globe); s.position.set(tx + a, 2.4 + b, c); s.name = 'gjfix3_globe'; g.add(s); } }
    root.add(g); rep.bar = 1; }
  return rep;
}
