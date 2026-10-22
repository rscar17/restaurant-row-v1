// rr2_delmint.js (agent delmint, Oct 22): Delmonico interior from Ryan's photos (IMG_5477 to 5513, IMG_5487 dining,
// IMG_5501 stone room). RR_FLAGS.delmint = 0 turns all of it off.
// 1. Light and colour: Delmonico walls (and the front room ceiling) read brown because their base colours are brown
//    (Material_87, Material_107, painted plaster under the 0.59 room ceiling gain) and the bake multiplies base colour.
//    Wall and ceiling fragments inside the Delmonico box take a cream base (baked: the lightmap then lights cream;
//    live: reflected light scaled by cream / old colour). Box and normal gated in the shader, so Milos and COTE, which
//    share some of these meshes, are untouched.
// 2. Front dining room (IMG_5487, 5488, 5493): white groin vaulted ceiling over x 4.85..13.2, y -1.85..9.2 (Blender):
//    one long elliptical barrel along y crossed by three bay barrels (lunettes on the side walls, transverse arches),
//    rib bands and the thin dark slot lines of the photos. The flat 3.3 m ceiling, the plank ceiling and its beams are
//    clipped out of that footprint (geometry clip, outside parts kept). Shading is baked per vertex here from the
//    chandelier positions (MeshBasicMaterial, no live light).
// 3. Brass Adler style chandeliers (rods with globes, IMG_5487) in two bays; ring chandeliers copied from del_chand_2
//    into the rear room (IMG_5501).
// 4. Rear room (IMG_5497 to 5503): dark walnut plank ceiling with beams, flagstone wall with white pilasters on the
//    back wall (Mesh_2256 face at y 18.5), blocky Material_87 chairs parked and replaced by del_chair copies facing
//    their tables.
// Coordinates: Blender (x, y, z) = three (x, -z, y).
import * as THREE from 'three';

const F = () => globalThis.RR_FLAGS || {};
const B2T = (x, y, z) => new THREE.Vector3(x, z, -y);
export const DM = {
  vault: { x0: 4.85, x1: 13.2, y0: -1.85, y1: 9.2, spring: 3.0, rise: 1.6, bays: 3 },
  rear: { x0: 4.85, x1: 15.15, y0: 9.25, y1: 18.45, zc: 3.27 },
  wallBox: [4.6, -2.0, 15.15, 18.6], ceilBox: [4.6, -4.2, 15.15, 9.25],   // walls stop short of the facade (frontsfix walnut headers stay)
  cream: [0.80, 0.70, 0.56],         // scene linear, IMG_5487 lit plaster about sRGB 228 214 194
  rings: [[7.6, -0.6, 3.2], [11.1, 0.9, 3.2], [13.6, 5.6, 3.2], [7.4, 5.6, 3.2]],
  adler: [[10.4, 3.4], [11.4, 7.3]],
  rearRings: [[10.2, 13.7], [9.3, 16.6], [13.4, 15.8]],
  stone: { y: 18.42, x0: 6.55, x1: 15.15, z0: 0.02, z1: 3.27, pil: [9.45, 12.35] },
};
// shared uniforms (live tuning: RR_DELMINT.u.*)
const U = {
  uDmCream: { value: new THREE.Vector3(...DM.cream) },
  uDmWall: { value: new THREE.Vector4(...DM.wallBox) },
  uDmCeil: { value: new THREE.Vector4(...DM.ceilBox) },
  uDmGainB: { value: +(F().dmgainb ?? 1.25) },   // baked surfaces: cream x lightmap x this
  uDmGainU: { value: +(F().dmgainu ?? 1.0) },    // live surfaces: reflected light x cream / old colour x this
  uDmOn: { value: 1 },
};

// ---------------------------------------------------------------- 1. cream walls and ceiling (shader, box gated)
function patchCream(m) {
  if (m.userData.dmCream) return m;
  const c = m.clone(); c.userData = { ...m.userData, dmCream: true }; if (m.defines) c.defines = { ...m.defines };
  const ob = m.onBeforeCompile, ok = m.customProgramCacheKey;
  c.onBeforeCompile = function (sh, r) { if (ob) ob.call(this, sh, r);
    if (!sh.vertexShader.includes('#include <project_vertex>') || !sh.fragmentShader.includes('#include <opaque_fragment>') || !sh.vertexShader.includes('#include <beginnormal_vertex>')) { c.userData.dmSkip = 1; return; }
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vDmW; varying vec3 vDmN;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n{ vec4 dmw = vec4( transformed, 1.0 ); dmw = modelMatrix * dmw; vDmW = dmw.xyz; vDmN = normalize( mat3( modelMatrix ) * objectNormal ); }');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vDmW; varying vec3 vDmN; uniform vec3 uDmCream; uniform vec4 uDmWall; uniform vec4 uDmCeil; uniform float uDmGainB; uniform float uDmGainU; uniform float uDmOn;')
      .replace('#include <opaque_fragment>', `{ float dmx = vDmW.x, dmy = -vDmW.z, dmz = vDmW.y; vec3 dmn = normalize( vDmN );
  float dmWall = step( abs( dmn.y ), 0.45 ) * step( uDmWall.x, dmx ) * step( dmx, uDmWall.z ) * step( uDmWall.y, dmy ) * step( dmy, uDmWall.w ) * step( dmz, 3.6 );
  float dmCeil = step( dmn.y, -0.6 ) * step( uDmCeil.x, dmx ) * step( dmx, uDmCeil.z ) * step( uDmCeil.y, dmy ) * step( dmy, uDmCeil.w ) * step( 3.25, dmz );
  float dmw = max( dmWall, dmCeil ) * uDmOn;
  if ( dmw > 0.5 ) { vec3 dmc0 = max( diffuseColor.rgb, vec3( 0.03 ) ); outgoingLight *= min( uDmCream / dmc0, vec3( 8.0 ) ) * uDmGainU; diffuseColor.rgb = uDmCream * uDmGainB; } }
#include <opaque_fragment>`);
    c.userData.dmPatched = 1; };
  c.customProgramCacheKey = function () { return (ok ? ok.call(this) : '') + '|dmc'; };
  c.name = (m.name || 'm') + ' [dm]';
  return c;
}

// ---------------------------------------------------------------- carpet: blue swirl to the photos' brown and bronze (IMG_5488, 5498)
function patchCarpet(m) {
  if (m.userData.dmCarpet) return m;
  const c = m.clone(); c.userData = { ...m.userData, dmCarpet: true }; if (m.defines) c.defines = { ...m.defines };
  const ob = m.onBeforeCompile, ok = m.customProgramCacheKey;
  c.onBeforeCompile = function (sh, r) { if (ob) ob.call(this, sh, r); if (!sh.fragmentShader.includes('#include <opaque_fragment>')) { c.userData.dmSkip = 1; return; }
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `{ vec3 dmc0 = max( diffuseColor.rgb, vec3( 0.02 ) ); float dml = max( max( dmc0.r, dmc0.g ), dmc0.b );
  vec3 dmc = mix( vec3( 0.045, 0.028, 0.017 ), vec3( 0.36, 0.25, 0.155 ), smoothstep( 0.04, 0.6, dml ) );
  outgoingLight *= min( dmc / dmc0, vec3( 8.0 ) ); diffuseColor.rgb = dmc; }
#include <opaque_fragment>`); c.userData.dmPatched = 1; };
  c.customProgramCacheKey = function () { return (ok ? ok.call(this) : '') + '|dmk'; }; c.name = (m.name || 'm') + ' [dmk]'; return c;
}
// ---------------------------------------------------------------- geometry clip (keeps the parts outside a box)
const _v = new THREE.Vector3();
function clipOutside(mesh, box) {   // box: blender [x0, y0, x1, y1]; triangles split against the four outside regions
  const g0 = mesh.geometry; if (!g0 || !g0.attributes.position) return 0;
  mesh.updateWorldMatrix(true, false); const M = mesh.matrixWorld;
  const names = Object.keys(g0.attributes), idx = g0.index, n = idx ? idx.count : g0.attributes.position.count;
  const get = (k) => { const vi = idx ? idx.getX(k) : k; const out = {}; for (const a of names) { const at = g0.attributes[a], s = at.itemSize, v = new Array(s); for (let i = 0; i < s; i++) v[i] = at.getComponent ? at.getComponent(vi, i) : at.array[vi * s + i]; out[a] = v; }
    _v.set(out.position[0], out.position[1], out.position[2]).applyMatrix4(M); out._b = [_v.x, -_v.z]; return out; };
  const lerp = (p, q, t) => { const o = {}; for (const a of names) o[a] = p[a].map((x, i) => x + (q[a][i] - x) * t); o._b = [p._b[0] + (q._b[0] - p._b[0]) * t, p._b[1] + (q._b[1] - p._b[1]) * t]; return o; };
  const clipHalf = (poly, ax, val, keepLess) => { const out = []; for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length];
      const dp = keepLess ? val - p._b[ax] : p._b[ax] - val, dq = keepLess ? val - q._b[ax] : q._b[ax] - val;
      if (dp >= 0) out.push(p); if ((dp >= 0) !== (dq >= 0)) out.push(lerp(p, q, dp / (dp - dq))); } return out; };
  const [x0, y0, x1, y1] = box; const regions = [[[0, x0, true]], [[0, x1, false]], [[0, x0, false], [0, x1, true], [1, y0, true]], [[0, x0, false], [0, x1, true], [1, y1, false]]];
  const tris = []; let cut = 0;
  for (let t = 0; t + 2 < n; t += 3) { const tri = [get(t), get(t + 1), get(t + 2)];
    const inside = tri.every(p => p._b[0] > x0 && p._b[0] < x1 && p._b[1] > y0 && p._b[1] < y1);
    const allOut = tri.every(p => p._b[0] <= x0) || tri.every(p => p._b[0] >= x1) || tri.every(p => p._b[1] <= y0) || tri.every(p => p._b[1] >= y1);
    if (allOut) { tris.push(tri); continue; } cut++; if (inside) continue;
    for (const reg of regions) { let poly = tri; for (const [ax, val, less] of reg) { poly = clipHalf(poly, ax, val, less); if (poly.length < 3) break; }
      for (let k = 1; k + 1 < poly.length; k++) tris.push([poly[0], poly[k], poly[k + 1]]); } }
  if (!cut) return 0;
  const g = new THREE.BufferGeometry();
  for (const a of names) { const s = g0.attributes[a].itemSize, arr = new Float32Array(tris.length * 3 * s); let o = 0; for (const tri of tris) for (const p of tri) for (let i = 0; i < s; i++) arr[o++] = p[a][i]; g.setAttribute(a, new THREE.BufferAttribute(arr, s)); }
  for (const gr of g0.groups || []) { /* single material pieces only (callers skip multi material) */ }
  g.computeBoundingBox(); g.computeBoundingSphere(); g.userData = { ...g0.userData, dmClipped: true };
  mesh.geometry = g; return cut;
}

// ---------------------------------------------------------------- 2. groin vault
function vaultZ(x, y) {
  const V = DM.vault, xc = (V.x0 + V.x1) / 2, hx = (V.x1 - V.x0) / 2, bay = (V.y1 - V.y0) / V.bays, hb = bay / 2;
  const u = (x - xc) / hx, zm = V.spring + V.rise * Math.sqrt(Math.max(0, 1 - u * u));
  let ly = (y - V.y0) % bay; if (ly < 0) ly += bay; const w = (ly - hb) / hb, zc = V.spring + V.rise * Math.sqrt(Math.max(0, 1 - w * w));
  return [Math.max(zm, zc), zm, zc];
}
function vaultN(x, y) {   // room facing (downward) normal by finite differences, blender axes
  const e = 0.01, z = vaultZ(x, y)[0], fx = (vaultZ(x + e, y)[0] - vaultZ(x - e, y)[0]) / (2 * e), fy = (vaultZ(x, y + e)[0] - vaultZ(x, y - e)[0]) / (2 * e);
  const cfx = Math.max(-8, Math.min(8, fx)), cfy = Math.max(-8, Math.min(8, fy)); const l = Math.hypot(cfx, cfy, 1); return [cfx / l, cfy / l, -1 / l, z];
}
const LIGHTS = () => [...DM.rings.map(p => [p[0], p[1], p[2] - 0.2, 1.0]), ...DM.adler.map(p => [p[0], p[1], 2.8, 0.8])];
function shade(p, n, ambient = 0.6) {   // baked here: ambient + chandeliers (Lambert, soft falloff) + sconce uplight near the springing
  let L = ambient; for (const [lx, ly, lz, k] of LIGHTS()) { const dx = lx - p[0], dy = ly - p[1], dz = lz - p[2], d = Math.hypot(dx, dy, dz) || 1; L += k * 0.85 * Math.max(0, (n[0] * dx + n[1] * dy + n[2] * dz) / d) / (1 + 0.1 * d * d); }
  L += 0.12 * Math.max(0, Math.min(1, (3.9 - p[2]) / 0.9)); return Math.min(1.12, L);
}
class GB {   // tiny geometry builder (blender coords in, three out), vertex colours
  constructor() { this.p = []; this.c = []; this.uv = []; }
  v(x, y, z, col, u = 0, w = 0) { this.p.push(x, z, -y); this.c.push(col[0], col[1], col[2]); this.uv.push(u, w); }
  quad(a, b, c, d) { for (const q of [a, b, c, a, c, d]) this.v(...q); }
  build() { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2)); g.computeBoundingSphere(); g.computeBoundingBox(); return g; }
}
const mulc = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
function buildVault() {
  const V = DM.vault, C = DM.cream, gb = new GB(), NX = 64, NYB = 32, bay = (V.y1 - V.y0) / V.bays, NY = NYB * V.bays;
  const P = (i, j) => { const x = V.x0 + (V.x1 - V.x0) * i / NX, y = V.y0 + (V.y1 - V.y0) * j / NY; const n = vaultN(x, y); const p = [x, y, n[3] + 0.0]; return [x, y, n[3], mulc(C, shade(p, n))]; };
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) gb.quad(P(i, j), P(i, j + 1), P(i + 1, j + 1), P(i + 1, j));
  // tympanum walls (lunettes and end arches) from 2.9 m up to the vault edge
  const zb = 2.9, wallC = (x, y, z, nx, ny) => mulc(C, shade([x, y, z], [nx, ny, 0], 0.62));
  for (let j = 0; j < NY; j++) for (const [x, nx] of [[V.x0, 1], [V.x1, -1]]) { const ya = V.y0 + (V.y1 - V.y0) * j / NY, yb = V.y0 + (V.y1 - V.y0) * (j + 1) / NY, za = vaultZ(x, ya)[0], zb2 = vaultZ(x, yb)[0];
    gb.quad([x, ya, zb, wallC(x, ya, zb, nx, 0)], [x, yb, zb, wallC(x, yb, zb, nx, 0)], [x, yb, zb2, wallC(x, yb, zb2, nx, 0)], [x, ya, za, wallC(x, ya, za, nx, 0)]); }
  for (let i = 0; i < NX; i++) for (const [y, ny] of [[V.y0, 1], [V.y1, -1]]) { const xa = V.x0 + (V.x1 - V.x0) * i / NX, xb = V.x0 + (V.x1 - V.x0) * (i + 1) / NX, za = vaultZ(xa, y)[0], zb2 = vaultZ(xb, y)[0];
    gb.quad([xa, y, zb, wallC(xa, y, zb, 0, ny)], [xb, y, zb, wallC(xb, y, zb, 0, ny)], [xb, y, zb2, wallC(xb, y, zb2, 0, ny)], [xa, y, za, wallC(xa, y, za, 0, ny)]); }
  // transverse rib bands (0.32 m wide, 0.07 m proud) on the interior bay lines, and the dark slot lines beside them
  const rib = mulc(C, 1.03), slot = [0.035, 0.03, 0.026];
  for (let b = 1; b < V.bays; b++) { const yb = V.y0 + bay * b;
    for (let i = 0; i < NX; i++) { const xa = V.x0 + (V.x1 - V.x0) * i / NX, xb = V.x0 + (V.x1 - V.x0) * (i + 1) / NX;
      const za = vaultZ(xa, yb)[1] - 0.07, zbb = vaultZ(xb, yb)[1] - 0.07, na = vaultN(xa, yb), nb = vaultN(xb, yb);
      const ca = mulc(rib, shade([xa, yb, za], na)), cb = mulc(rib, shade([xb, yb, zbb], nb)), cs = mulc(rib, 0.82);
      gb.quad([xa, yb - 0.16, za, ca], [xa, yb + 0.16, za, ca], [xb, yb + 0.16, zbb, cb], [xb, yb - 0.16, zbb, cb]);
      for (const s of [-0.16, 0.16]) { const zsa = vaultZ(xa, yb + s)[0], zsb = vaultZ(xb, yb + s)[0]; gb.quad([xa, yb + s, za, cs], [xb, yb + s, zbb, cs], [xb, yb + s, zsb, cs], [xa, yb + s, zsa, cs]); }
      for (const s of [-0.55, 0.55]) { const y = yb + s, z1 = vaultZ(xa, y), z2 = vaultZ(xb, y); if (z1[1] < z1[2] + 0.02 || z2[1] < z2[2] + 0.02) continue;
        gb.quad([xa, y - 0.018, z1[0] - 0.004, slot], [xa, y + 0.018, z1[0] - 0.004, slot], [xb, y + 0.018, z2[0] - 0.004, slot], [xb, y - 0.018, z2[0] - 0.004, slot]); } } }
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }); m.name = 'dm_vault';
  const mesh = new THREE.Mesh(gb.build(), m); mesh.name = 'dm_vault'; return mesh;
}

// ---------------------------------------------------------------- 3. Adler style brass chandelier (rods with globes)
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function cyl(gb, x, y, z0, z1, r, col, seg = 6) { for (let k = 0; k < seg; k++) { const a0 = k / seg * Math.PI * 2, a1 = (k + 1) / seg * Math.PI * 2, s = 0.75 + 0.35 * Math.max(0, Math.cos(a0 - 2.4));
  const p0 = [x + r * Math.cos(a0), y + r * Math.sin(a0)], p1 = [x + r * Math.cos(a1), y + r * Math.sin(a1)], c = mulc(col, s); gb.quad([p0[0], p0[1], z0, c], [p1[0], p1[1], z0, c], [p1[0], p1[1], z1, c], [p0[0], p0[1], z1, c]); } }
function hbar(gb, xa, ya, xb, yb, z, r, col) { const dx = xb - xa, dy = yb - ya, L = Math.hypot(dx, dy), nx = -dy / L * r, ny = dx / L * r;
  gb.quad([xa + nx, ya + ny, z + r, mulc(col, 1.1)], [xb + nx, yb + ny, z + r, mulc(col, 1.1)], [xb - nx, yb - ny, z + r, mulc(col, 1.1)], [xa - nx, ya - ny, z + r, mulc(col, 1.1)]);
  gb.quad([xa + nx, ya + ny, z - r, mulc(col, 0.7)], [xb + nx, yb + ny, z - r, mulc(col, 0.7)], [xb + nx, yb + ny, z + r, col], [xa + nx, ya + ny, z + r, col]);
  gb.quad([xa - nx, ya - ny, z - r, mulc(col, 0.7)], [xb - nx, yb - ny, z - r, mulc(col, 0.7)], [xb - nx, yb - ny, z + r, col], [xa - nx, ya - ny, z + r, col]); }
function sphere(gb, x, y, z, r, col, seg = 8, ring = 6) { const P = (i, j) => { const th = i / seg * Math.PI * 2, ph = j / ring * Math.PI; return [x + r * Math.sin(ph) * Math.cos(th), y + r * Math.sin(ph) * Math.sin(th), z + r * Math.cos(ph), col]; };
  for (let j = 0; j < ring; j++) for (let i = 0; i < seg; i++) gb.quad(P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)); }
function buildAdler(cx, cy, seed) {
  const brass = [0.62, 0.42, 0.16], bulb = [3.2, 2.5, 1.6], R = rng(seed), gm = new GB(), gl = new GB(), zf = 2.95, W = 0.75, D = 0.22;
  const ztop = vaultZ(cx, cy)[0];
  cyl(gm, cx - 0.35, cy, zf, ztop, 0.012, brass); cyl(gm, cx + 0.35, cy, zf, ztop, 0.012, brass);   // two drop rods
  hbar(gm, cx - W, cy - D, cx + W, cy - D, zf, 0.012, brass); hbar(gm, cx - W, cy + D, cx + W, cy + D, zf, 0.012, brass);
  hbar(gm, cx - W, cy - D, cx - W, cy + D, zf, 0.012, brass); hbar(gm, cx + W, cy - D, cx + W, cy + D, zf, 0.012, brass);
  hbar(gm, cx - W, cy, cx + W, cy, zf - 0.18, 0.01, brass);
  for (let k = 0; k < 40; k++) { const t = k / 39, x = cx - W + 2 * W * t + (R() - 0.5) * 0.03, y = cy + (k % 3 - 1) * D * 0.95 + (R() - 0.5) * 0.04;
    const up = k % 2 === 0, len = 0.12 + R() * (up ? 0.45 : 0.38), z0 = up ? zf : zf - len, z1 = up ? zf + len : zf;
    cyl(gm, x, y, z0, z1, 0.009, brass, 5); sphere(gl, x, y, up ? z1 + 0.03 : z0 - 0.03, 0.032, bulb, 8, 5); }
  const mb = new THREE.MeshBasicMaterial({ vertexColors: true }); mb.name = 'dm_brass';
  const ml = new THREE.MeshBasicMaterial({ vertexColors: true }); ml.name = 'dm_globe';
  const a = new THREE.Mesh(gm.build(), mb), b = new THREE.Mesh(gl.build(), ml); a.name = 'dm_adler_brass'; b.name = 'dm_adler_globes'; return [a, b];
}

// ---------------------------------------------------------------- 4. rear room: plank ceiling, beams, flagstone wall
function canvasTex(w, h, draw) { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const cx = cv.getContext('2d'); draw(cx, w, h);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; return t; }
function stoneTex() {   // irregular flagstone (jittered Voronoi), cream to sand stones, dark joints, floor uplight scallops baked in
  const S = DM.stone, Wm = S.x1 - S.x0, Hm = S.z1 - S.z0, W = 2048, H = Math.round(2048 * Hm / Wm), cell = 78, R = rng(5501);
  return canvasTex(W, H, (cx) => {
    const gx = Math.ceil(W / cell) + 2, gy = Math.ceil(H / cell) + 2, pts = [], col = [];
    for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) { pts.push([(i - 1 + 0.15 + 0.7 * R()) * cell * 1.25, (j - 1 + 0.15 + 0.7 * R()) * cell * 0.85]); const v = R(); col.push([214 + 26 * v + 8 * R(), 198 + 24 * v + 6 * R(), 168 + 22 * v + 6 * R()]); }
    const img = cx.createImageData(W, H), d = img.data, cw = cell * 1.25, ch = cell * 0.85;
    const pil = S.pil.map(x => (x - S.x0) / Wm * W), wash = [];
    for (let x = S.x0 + 0.75; x < S.x1; x += 1.45) wash.push((x - S.x0) / Wm * W);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const ci = Math.floor(x / cw) + 1, cj = Math.floor(y / ch) + 1; let f1 = 1e9, f2 = 1e9, k1 = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = ci + di, jj = cj + dj; if (ii < 0 || jj < 0 || ii >= gx || jj >= gy) continue; const k = jj * gx + ii, p = pts[k], dd = (p[0] - x) ** 2 + (p[1] - y) ** 2; if (dd < f1) { f2 = f1; f1 = dd; k1 = k; } else if (dd < f2) f2 = dd; }
      const edge = Math.sqrt(f2) - Math.sqrt(f1), joint = edge < 3.2 ? 0.32 + 0.12 * (edge / 3.2) : (edge < 7 ? 0.78 + 0.22 * ((edge - 3.2) / 3.8) : 1.0);
      const vy = 1 - y / H; let up = 0.42; for (const wx of wash) up += 0.62 * Math.exp(-(((x - wx) / (W * 0.055)) ** 2) / (0.25 + 1.4 * vy)) * Math.exp(-((1 - vy) * 1.1));
      up = Math.min(1.12, up + 0.18 * (1 - vy)); const grain = 0.94 + 0.06 * Math.sin(x * 0.9 + y * 1.3 + k1) * Math.sin(y * 0.37 + k1 * 3.1);
      const c = col[k1], o = (y * W + x) * 4, sh = joint * up * grain;
      d[o] = Math.min(255, c[0] * sh); d[o + 1] = Math.min(255, c[1] * sh); d[o + 2] = Math.min(255, c[2] * sh); d[o + 3] = 255; }
    cx.putImageData(img, 0, 0); });
}
function plankTex() { const R = rng(5499); return canvasTex(1024, 1024, (cx, W, H) => { const n = 12, ph = H / n;
  for (let k = 0; k < n; k++) { const v = R(); cx.fillStyle = `rgb(${Math.round(70 + 18 * v)},${Math.round(48 + 12 * v)},${Math.round(33 + 8 * v)})`; cx.fillRect(0, k * ph, W, ph);
    for (let g = 0; g < 26; g++) { cx.strokeStyle = `rgba(${R() < 0.5 ? '30,20,12' : '110,80,55'},${0.10 + 0.12 * R()})`; cx.lineWidth = 1 + 2 * R(); cx.beginPath(); const y0 = k * ph + R() * ph; cx.moveTo(0, y0); for (let x = 0; x <= W; x += 64) cx.lineTo(x, y0 + Math.sin(x * 0.01 + g) * 3 * R()); cx.stroke(); }
    cx.fillStyle = 'rgba(15,10,6,0.85)'; cx.fillRect(0, k * ph, W, 3); } }); }
function box(gb, x0, y0, z0, x1, y1, z1, col) {   // axis box, simple face shading (bottom brightest: lit from below)
  const top = mulc(col, 0.55), bot = mulc(col, 1.0), sx = mulc(col, 0.78), sy = mulc(col, 0.7);
  gb.quad([x0, y0, z0, bot], [x1, y0, z0, bot], [x1, y1, z0, bot], [x0, y1, z0, bot]); gb.quad([x0, y0, z1, top], [x0, y1, z1, top], [x1, y1, z1, top], [x1, y0, z1, top]);
  gb.quad([x0, y0, z0, sy], [x0, y0, z1, sy], [x1, y0, z1, sy], [x1, y0, z0, sy]); gb.quad([x0, y1, z0, sy], [x1, y1, z0, sy], [x1, y1, z1, sy], [x0, y1, z1, sy]);
  gb.quad([x0, y0, z0, sx], [x0, y1, z0, sx], [x0, y1, z1, sx], [x0, y0, z1, sx]); gb.quad([x1, y0, z0, sx], [x1, y0, z1, sx], [x1, y1, z1, sx], [x1, y1, z0, sx]); }
function buildRear() {
  const Rr = DM.rear, out = [];
  { const gb = new GB(), k = 1.0, c = [k, k, k], z = Rr.zc, s = 0.9;   // planks run along x, 0.9 m of texture per repeat
    gb.v(Rr.x0, Rr.y0, z, c, 0, 0); gb.v(Rr.x0, Rr.y1, z, c, 0, (Rr.y1 - Rr.y0) / s); gb.v(Rr.x1, Rr.y1, z, c, (Rr.x1 - Rr.x0) / s, (Rr.y1 - Rr.y0) / s);
    gb.v(Rr.x0, Rr.y0, z, c, 0, 0); gb.v(Rr.x1, Rr.y1, z, c, (Rr.x1 - Rr.x0) / s, (Rr.y1 - Rr.y0) / s); gb.v(Rr.x1, Rr.y0, z, c, (Rr.x1 - Rr.x0) / s, 0);
    const m = new THREE.MeshBasicMaterial({ map: plankTex(), vertexColors: true, side: THREE.DoubleSide, color: new THREE.Color(0.78, 0.74, 0.70) }); m.name = 'dm_planks';
    const mesh = new THREE.Mesh(gb.build(), m); mesh.name = 'dm_rear_planks'; out.push(mesh); }
  { const gb = new GB(), wal = [0.085, 0.052, 0.032], z1 = Rr.zc - 0.005, z0 = Rr.zc - 0.30;
    for (let y = Rr.y0 + 1.15; y < Rr.y1 - 0.5; y += 2.3) box(gb, Rr.x0, y - 0.13, z0, Rr.x1, y + 0.13, z1, wal);   // cross beams
    for (const x of [Rr.x0 + 0.15, (Rr.x0 + Rr.x1) / 2, Rr.x1 - 0.15]) box(gb, x - 0.14, Rr.y0, z0 + 0.04, x + 0.14, Rr.y1, z1, wal);
    for (let y = Rr.y0 + 1.15 + 1.15; y < Rr.y1 - 0.5; y += 2.3) for (const x of [Rr.x0 + 2.6, Rr.x1 - 2.6]) { box(gb, x - 0.05, y - 0.06, z0 - 0.08, x + 0.05, y + 0.06, z0, [0.02, 0.02, 0.02]); }   // track spots
    const m = new THREE.MeshBasicMaterial({ vertexColors: true }); m.name = 'dm_beams'; const mesh = new THREE.Mesh(gb.build(), m); mesh.name = 'dm_rear_beams'; out.push(mesh); }
  { const S = DM.stone, gb = new GB(), c = [1, 1, 1], y = S.y;
    gb.v(S.x0, y, S.z0, c, 0, 0); gb.v(S.x1, y, S.z0, c, 1, 0); gb.v(S.x1, y, S.z1, c, 1, 1); gb.v(S.x0, y, S.z0, c, 0, 0); gb.v(S.x1, y, S.z1, c, 1, 1); gb.v(S.x0, y, S.z1, c, 0, 1);
    const t = stoneTex(); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.flipY = true;
    const m = new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide, color: new THREE.Color(0.92, 0.9, 0.86) }); m.name = 'dm_stone';
    const mesh = new THREE.Mesh(gb.build(), m); mesh.name = 'dm_stonewall'; out.push(mesh);
    const gp = new GB(), wc = [0.86, 0.8, 0.7];
    for (const x of S.pil) box(gp, x - 0.27, y - 0.16, S.z0, x + 0.27, y - 0.005, S.z1, wc);
    box(gp, S.x0, y - 0.1, S.z0, S.x1, y - 0.005, 0.12, [0.07, 0.05, 0.035]);   // dark base
    const mp = new THREE.MeshBasicMaterial({ vertexColors: true }); mp.name = 'dm_pilaster'; const pm = new THREE.Mesh(gp.build(), mp); pm.name = 'dm_pilasters'; out.push(pm); }
  return out;
}

// ---------------------------------------------------------------- copies of model pieces (chairs, ring chandeliers)
const bbB = new THREE.Box3(), cB = new THREE.Vector3();
function centreB(o) { const list = Array.isArray(o) ? o : [o]; bbB.makeEmpty(); for (const x of list) bbB.expandByObject(x); bbB.getCenter(cB); return [cB.x, -cB.z, bbB.min.y, bbB.max.y]; }
function placeCopy(srcs, tx, ty, rot, dz = 0) {   // copy the pieces of one model object (share geometry and materials) so their plan centre lands at (tx, ty), turned rot about vertical
  const list = Array.isArray(srcs) ? srcs : [srcs]; for (const s of list) s.updateWorldMatrix(true, true); const [sx, sy] = centreB(list); const out = [];
  const T1 = new THREE.Matrix4().makeTranslation(-sx, 0, sy), Rm = new THREE.Matrix4().makeRotationY(rot), T2 = new THREE.Matrix4().makeTranslation(tx, dz, -ty), K = T2.multiply(Rm).multiply(T1);
  for (const src of list) { const par = src.parent; if (!par) continue;
    const cp = src.clone(true); cp.userData = JSON.parse(JSON.stringify(src.userData || {})); cp.userData.dmCopy = true;
    const Mw = K.clone().multiply(src.matrixWorld); par.updateWorldMatrix(true, false); const Ml = par.matrixWorld.clone().invert().multiply(Mw);
    Ml.decompose(cp.position, cp.quaternion, cp.scale); cp.matrixAutoUpdate = true; par.add(cp); cp.updateMatrixWorld(true); out.push(cp); }
  return out.length ? out : null;
}
export function delmint(P) {
  const rep = { on: false };
  if (!+(F().delmint ?? 1)) return rep;
  rep.on = true; const root = P.root, scene = P.scene; root.updateMatrixWorld(true);
  const byInv = new Map(); root.traverse(o => { const n = o.isMesh && o.userData && o.userData.invName; if (!n) return; if (!byInv.has(n)) byInv.set(n, []); byInv.get(n).push(o); });
  const park = new THREE.Group(); park.name = 'delmint_park'; park.visible = false; scene.add(park);
  // clip the flat ceiling, plank ceiling and beams out of the vault footprint
  const V = DM.vault, fp = [V.x0, V.y0, V.x1, V.y1]; rep.clip = {}; const ceilOwn = [];
  const CLIP = ['r136_ceil66.001', 'del_ceiling_planks', 'del_ceiling_beams', 'ceil_patch_delwing'];
  root.traverse(o => { if (!o.isMesh) return; const nm = o.userData.invName || o.name || '', pn = (o.parent && o.parent.userData && o.parent.userData.invName) || '';
    if (!CLIP.includes(nm) && !CLIP.includes(pn)) return; if (Array.isArray(o.material) || (o.geometry.groups && o.geometry.groups.length > 1)) { rep.clip[nm || pn] = 'multi'; return; }
    try { rep.clip[nm || pn] = clipOutside(o, fp); } catch (e) { rep.clip[nm || pn] = 'err ' + e.message; }
    if (nm === 'r136_ceil66.001' || pn === 'r136_ceil66.001') ceilOwn.push(o); });
  // the room ceiling is a live (unbaked) Blender material: when its program is not linked in time it stays on the load
  // time 'fallback:' stand in (brown photo texture, no room gain; milosint found the same on the Milos ceiling). Its
  // clipped geometry is drawn by an own cream material instead (not gated, no live light) and the original is parked.
  const ceilMeshes = []; for (const o of ceilOwn) { o.updateWorldMatrix(true, false); try { clipOutside(o, [-1e4, -1e4, 4.6, 1e4]); } catch (e) {}   // west of x 4.6 it would meet the Milos ceiling (r135_ceil163) at the same height
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(...DM.cream).multiplyScalar(0.9), side: THREE.DoubleSide }); m.name = 'dm_ceiling';
    const c = new THREE.Mesh(o.geometry, m); c.name = 'dm_room_ceiling'; c.matrixAutoUpdate = false; c.matrix.copy(o.matrixWorld); ceilMeshes.push(c); park.attach(o); }
  rep.ceilOwn = ceilMeshes.length;
  // cream walls and ceiling: big opaque pieces touching the Delmonico box
  const SKIP = /stonewall|winewall|carpet|mbf_floor|floor|del_ceiling_beams|chand|pendant|globe|letter|neon|glass|^wing_|^ent_|^rb_|^PIL_|PM_|^jn_|rr_del_|pm_mosaic|^tray_|_led/i; let nPatched = 0; const seenM = new Map();
  const wb = DM.wallBox, bb = new THREE.Box3();
  root.traverse(o => { if (!o.isMesh || o.isInstancedMesh || !o.material || Array.isArray(o.material)) return; const nm = (o.userData.invName || o.name || '') + ' ' + ((o.parent && o.parent.userData && o.parent.userData.invName) || '');
    if (SKIP.test(nm) || SKIP.test(o.material.name || '')) return; const m = o.material; if (m.transparent || (m.transmission ?? 0) > 0 || (m.metalness ?? 0) >= 0.5 || !m.isMeshStandardMaterial) return;
    bb.setFromObject(o); if (bb.isEmpty()) return; const bx0 = bb.min.x, bx1 = bb.max.x, by0 = -bb.max.z, by1 = -bb.min.z, ext = Math.max(bx1 - bx0, by1 - by0, bb.max.y - bb.min.y);
    if (ext < 3.0 || bx1 < wb[0] || bx0 > wb[2] || by1 < wb[1] || by0 > wb[3] || bb.min.y > 5.3) return;
    let c = seenM.get(m); if (!c) { c = patchCream(m); seenM.set(m, c); } o.material = c; nPatched++; (rep.creamNames ||= []).length < 40 && rep.creamNames.push(nm.trim()); });
  rep.cream = nPatched;
  if (+(F().dmcarpet ?? 1)) { let nk = 0; const seenK = new Map(); root.traverse(o => { if (!o.isMesh || !o.material || Array.isArray(o.material)) return; if (!/^del_carpet/.test(o.material.name || '')) return; let c = seenK.get(o.material); if (!c) { c = patchCarpet(o.material); seenK.set(o.material, c); } o.material = c; nk++; }); rep.carpet = nk; }
  // rear room: blocky chairs out (parked), del_chair copies facing their tables
  const R = DM.rear, tables = [], blocky = [];
  root.traverse(o => { if (!o.isMesh || !o.material || Array.isArray(o.material)) return; const mn = o.material.name || ''; const c = centreB(o); if (c[0] < R.x0 - 0.3 || c[0] > R.x1 || c[1] < R.y0 || c[1] > R.y1) return;
    bb.setFromObject(o); const ext = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
    if (/^Material_87( \[dm\])?$/.test(mn) && ext < 1.2 && bb.max.y < 1.5) blocky.push([o, c]); else if (/^Material_6\d\d( \[dm\])?$/.test(mn) && ext > 1.4 && ext < 2.6 && bb.max.y < 1.2) tables.push(c); });
  const groups = []; for (const [o, c] of blocky) { let g = groups.find(g => Math.hypot(g.c[0] - c[0], g.c[1] - c[1]) < 0.55); if (!g) { g = { c: [c[0], c[1]], s: [0, 0], parts: [] }; groups.push(g); } g.parts.push(o); g.s[0] += c[0]; g.s[1] += c[1]; }
  for (const g of groups) { g.c = [g.s[0] / g.parts.length, g.s[1] / g.parts.length]; }
  const srcChair = byInv.get('del_chair_5_0'), srcTab = byInv.get('del_table_5'); rep.chairs = { blocky: blocky.length, groups: groups.length, tables: tables.length, src: !!srcChair };
  if (srcChair && srcTab && tables.length) { const [scx, scy] = centreB(srcChair), [stx, sty] = centreB(srcTab), aS = Math.atan2(sty - scy, stx - scx); let n = 0;
    for (const g of groups) { let best = null, bd = 1e9; for (const t of tables) { const d = Math.hypot(t[0] - g.c[0], t[1] - g.c[1]); if (d < bd) { bd = d; best = t; } } if (!best || bd > 2.2) continue;
      const aT = Math.atan2(best[1] - g.c[1], best[0] - g.c[0]); const cp = placeCopy(srcChair, g.c[0], g.c[1], aT - aS); if (!cp) continue; n++; for (const p of g.parts) park.attach(p); }
    rep.chairs.placed = n; }
  // ring chandeliers in the rear room (copies of del_chand_2), 0.25 m lower under the 3.27 m plank ceiling
  const srcRing = byInv.get('del_chand_2'); rep.rings = 0; if (srcRing) for (const [x, y] of DM.rearRings) { if (placeCopy(srcRing, x, y, 0, -0.25)) rep.rings++; }
  // own pieces: vault, Adler chandeliers, rear ceiling, stone wall (drawn only below 4.3 m eye height; the overview keeps its cut-away)
  const grp = new THREE.Group(); grp.name = 'delmint'; grp.userData.rrOwn = true;
  grp.add(buildVault()); DM.adler.forEach(([x, y], k) => grp.add(...buildAdler(x, y, 101 + k))); for (const m of buildRear()) grp.add(m); for (const c of ceilMeshes) grp.add(c);
  grp.traverse(o => { o.userData.rrOwn = true; if (o.isMesh && o.name !== 'dm_room_ceiling') { o.frustumCulled = true; o.matrixAutoUpdate = false; o.updateMatrix(); } });
  scene.add(grp); grp.updateMatrixWorld(true);
  const prev = scene.onBeforeRender; scene.onBeforeRender = function (r, s, cam, rt) { if (prev) prev.call(this, r, s, cam, rt); if (cam && cam.isCamera) { const y = cam.matrixWorld.elements[13]; grp.visible = y < (+(F().dmeye ?? 4.3)) && y > -0.2 || (y < -0.2 && y > -4.5); } };
  let tris = 0; grp.traverse(o => { if (o.isMesh) tris += o.geometry.attributes.position.count / 3; }); rep.ownTris = tris;
  globalThis.RR_DELMINT = { DM, U, grp, park, rep, vaultZ };
  return rep;
}
