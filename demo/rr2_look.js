// rr2_look.js (agent look, wave 13, Oct 19 2026): the overview as one designed presentation model, behind RR_FLAGS.look.
// OVERVIEW_DESIGN.md A1 to A3 and C9, C10; B7 (fly-in as one authored shot). rr_section.js calls installLook(P, M) right
// after the player and the modes controller are made (before the load: the clip planes must be in place before the first
// program compiles), then init() once the modes controller has its meshes.
//  1. Section cut: five global clip planes (renderer.clippingPlanes), compiled into every program from the start, so the cut
//     never recompiles anything: a horizontal cut at 2.4 m plus the four sides of the crop box, all parked 1e5 m away outside
//     the overview. Cut walls get solid caps: a back face child per wall mesh that crosses the cut, one flat warm off-white
//     material (#EDE6DC), drawn in the same pass (back faces you see through a cut are the inside of the wall). No stencil
//     pass, one program. The translucent grey veils are not drawn.
//  2. Clay neighbours: every mesh outside Gjelina, Milos and Delmonico (modes tags, rr.role) wears ONE matte clay material
//     (#D9D2C7, unlit normal shading, soft height AO) while the camera is above 10 m in the overview or a glide; transparent
//     neighbour pieces are hidden there. Heroes keep their materials, +0.5 EV on their room gains (rr2_rooms.js gain texture,
//     data only) and a thin red outline (#E00, 60 %) on their floor plate edge.
//     Programs: the materials only neighbours use are not compiled for the open view (they wear clay there); a second, slower
//     gate (rr2_gate.js) compiles them behind the open view, paused during glides. RR_FLAGS.lookdefer = 0 compiles all as before.
//  3. Plinth: one slab under the crop box, a soft contact shadow, the page colour around it; meshes outside the crop are hidden
//     and the crop planes cut what crosses its edge.
//  4. Fly-ins: the overview to ground glide drops into the corridor in front of the entrance (a column over the walk
//     polygon) instead of a straight line through the roofs; the cut rises with the camera below 2.9 m so the ceilings close
//     only once the camera is under them. Before a glide starts the deferred programs get up to 1.5 s to finish; during the
//     glide the DPR governor is held at the full ratio, the floor mirror and the cove probe set are frozen and the deferred
//     gate is paused.
import * as THREE from 'three';
import { ProgramGate } from './rr2_gate.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { insideWalk, lookVec, B2T, pointInPoly } from './rr2_modes.js';
import { FLOOR_MIRROR_ON } from './rr2_reflect.js';

const LOOK = { cut: 2.4, clay: '#D9D2C7', cap: '#EDE6DC', slab: '#E4E1DC', line: '#EE0000', lineOpacity: 0.6, heroEV: 1.5, el: 55, introEl: 40, frameBox: [-36, -14, 28, 20], rotR: 9.5, clayY: 10, crop: 1.0, slabPad: 1.2, slabH: 0.6 };
const OFF = 1e5;

// clay: the face normal comes from the screen derivatives of the world position, so merged geometry needs positions only
// and a mesh without (or with zero) normals can never write NaN into the HDR target (a NaN pixel spreads through the AO blur)
const CLAY_VS = `
#include <common>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
varying vec3 vWP; uniform float uRevT; uniform vec3 uRev;
void main() {
  #include <begin_vertex>
  vec4 wp = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    wp = instanceMatrix * wp;
  #endif
  wp = modelMatrix * wp;
  if (uRev.z > 0.5) { float dl = clamp((wp.x - uRev.x) * uRev.y, 0.0, 1.0) * 0.7; float k = clamp((uRevT - dl) / 0.8, 0.0, 1.0); k = 1.0 - (1.0 - k) * (1.0 - k) * (1.0 - k); wp.y -= (1.0 - k) * 3.0; }
  vWP = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <clipping_planes_vertex>
}`;
const CLAY_FS = `
uniform vec3 uColor; uniform float uDim; uniform float uFade; uniform float uCut;
varying vec3 vWP;
#include <common>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
  #include <clipping_planes_fragment>
  #include <logdepthbuf_fragment>
  if (uFade < 0.999 && fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) >= uFade) discard;   // dithered fade (no blending, no sort)
  #ifdef USE_LOGDEPTHBUF
  gl_FragDepth = max(gl_FragDepth - 2e-6, 0.0);   // clay wins the tie over the real piece under it during a fade
  #endif
  vec3 n = cross(dFdx(vWP), dFdy(vWP)); float nl = length(n); n = nl > 1e-12 ? n / nl : vec3(0.0, 1.0, 0.0);
  if (dot(n, cameraPosition - vWP) < 0.0) n = -n;
  float key = max(dot(n, normalize(vec3(-0.45, 0.8, 0.4))), 0.0);
  float hemi = 0.5 + 0.5 * n.y;
  float ao = mix(0.58, 1.0, smoothstep(0.0, 1.1, vWP.y));                                    // contact darkening at wall bases
  float crease = 1.0 - 0.4 * clamp(length(fwidth(n)) * 1.2, 0.0, 1.0);                   // corners and edges: one pixel darker line
  float top = abs(n.y) < 0.5 ? 1.0 - 0.5 * (1.0 - smoothstep(0.0, 0.04, uCut - vWP.y)) : 1.0;   // dark rim under each cap
  gl_FragColor = vec4(uDim * uColor * (0.36 + 0.22 * hemi + 0.52 * key) * mix(1.0, ao, step(abs(n.y), 0.5)) * crease * top, 1.0);
}`;

// world space positions (and index) of a mesh list in one geometry per cell of `cell` metres; positions only
// q > 0: vertices snap to a q metre grid and triangles that collapse are dropped (props and mouldings fall away, walls stay)
function mergeCells(list, cell = 20, q = 0.1, vertOnly = false) {
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  const groups = new Map(), v = new THREE.Vector3(), bb = new THREE.Box3(), c = new THREE.Vector3();
  // instanced pieces (COTE and Yardbird furniture) go in one copy per instance
  const items = []; for (const o of list) { o.updateWorldMatrix(true, false);
    if (!o.isInstancedMesh) { items.push(o); continue; } const im = new THREE.Matrix4();
    for (let k = 0; k < o.count; k++) { o.getMatrixAt(k, im); items.push({ geometry: o.geometry, matrixWorld: o.matrixWorld.clone().multiply(im), updateWorldMatrix() {} }); } }
  for (const o of items) { const G = o.geometry; if (!G.boundingSphere) G.computeBoundingSphere(); c.copy(G.boundingSphere.center).applyMatrix4(o.matrixWorld); const k = Math.floor(c.x / cell) + ',' + Math.floor(c.z / cell); (groups.get(k) || groups.set(k, []).get(k)).push(o); }
  const out = []; let verts = 0, tris = 0, kept = 0, bad = 0, kv = 0; const ok = (X) => Number.isFinite(X) && Math.abs(X) < 500;
  for (const g of groups.values()) {
    let nv = 0, ni = 0; for (const o of g) { const p = o.geometry.attributes.position; nv += p.count; ni += o.geometry.index ? o.geometry.index.count : p.count; }
    const pos = new Float32Array(nv * 3), idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni); let vo = 0, io = 0;
    for (const o of g) { const G = o.geometry, p = G.attributes.position, I = G.index; o.updateWorldMatrix(true, false); const flip = o.matrixWorld.determinant() < 0;
      for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); if (q > 0) v.set(Math.round(v.x / q) * q, Math.round(v.y / q) * q, Math.round(v.z / q) * q); pos[(vo + i) * 3] = v.x; pos[(vo + i) * 3 + 1] = v.y; pos[(vo + i) * 3 + 2] = v.z; }
      const n = I ? I.count : p.count;
      for (let i = 0; i < n; i += 3) { const a = I ? I.getX(i) : i, b = I ? I.getX(i + 1) : i + 1, d = I ? I.getX(i + 2) : i + 2;
        tris++; { const A = (vo + a) * 3, B = (vo + b) * 3, C = (vo + d) * 3; if (!(ok(pos[A]) && ok(pos[A + 1]) && ok(pos[A + 2]) && ok(pos[B]) && ok(pos[B + 1]) && ok(pos[B + 2]) && ok(pos[C]) && ok(pos[C + 1]) && ok(pos[C + 2]))) { bad++; continue; } }
        if (q > 0) { const A = (vo + a) * 3, B = (vo + b) * 3, C = (vo + d) * 3, eq = (X, Y) => pos[X] === pos[Y] && pos[X + 1] === pos[Y + 1] && pos[X + 2] === pos[Y + 2]; if (eq(A, B) || eq(B, C) || eq(A, C)) continue; }
        if (vertOnly) { const A = (vo + a) * 3, B = (vo + b) * 3, C = (vo + d) * 3; e1.set(pos[B] - pos[A], pos[B + 1] - pos[A + 1], pos[B + 2] - pos[A + 2]); e2.set(pos[C] - pos[A], pos[C + 1] - pos[A + 1], pos[C + 2] - pos[A + 2]); e1.cross(e2); const L = e1.length(); if (!(L > 0) || Math.abs(e1.y) / L > 0.5) continue; }
        kept++; idx[io++] = vo + a; idx[io++] = vo + (flip ? d : b); idx[io++] = vo + (flip ? b : d); }
      vo += p.count; }
    // keep only the vertices a kept triangle uses (the snap drops most of them): the CPU and GPU copies shrink with the triangle count
    const remap = new Int32Array(nv).fill(-1); let nn = 0; for (let k = 0; k < io; k++) { const v0 = idx[k]; if (remap[v0] < 0) remap[v0] = nn++; }
    const cpos = new Float32Array(nn * 3); for (let v1 = 0; v1 < nv; v1++) { const r = remap[v1]; if (r >= 0) { cpos[r * 3] = pos[v1 * 3]; cpos[r * 3 + 1] = pos[v1 * 3 + 1]; cpos[r * 3 + 2] = pos[v1 * 3 + 2]; } }
    const cidx = nn > 65535 ? new Uint32Array(io) : new Uint16Array(io); for (let k = 0; k < io; k++) cidx[k] = remap[idx[k]];
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(cpos, 3)); geo.setIndex(new THREE.BufferAttribute(cidx, 1)); kv += nn;
    geo.computeBoundingSphere(); geo.computeBoundingBox(); out.push(geo); verts += nv; }
  for (const g of out) { const p = g.attributes.position.array; for (let i = 0; i < p.length; i++) if (!ok(p[i])) p[i] = 0; g.computeBoundingSphere(); g.computeBoundingBox(); }
  return { geos: out, verts, keptVerts: kv, tris, kept, bad };
}
const COLOUR_RE = /^(gjl_|rot_|mil_|del_|fld_|brd_|w_(base|dec|jW|jE|menu|mull|rust|wordmark|glass|head|low|sign|sill)|ri_|gt_ri|PIL_|wing_|facetA_|rb_|ent_|cl_de_s1_|cl_nw_neon_mart|m2_)/;
// colour (keeps its real material in the overview) or clay; bb is the mesh's world box
// s43: build's library pieces for COTE and Yardbird (r9zl_cote_*, r9zl_yardbird_*, their merged materials) partly sit inside the
// Delmonico and Gjelina polygons of the modes data and came out tagged hero there (COTE booths in full colour, inspect sw1b)
const FURN_NAME = [[/r9zl_cote_|RR_COTE_|CoteGreen/i, 'u137'], [/r9zl_yardbird_|RR_Yardbird_/i, 'u133']];
function furnUnit(o) { const nm = (o.userData.invName || o.name || '') + ' ' + [].concat(o.material).map(m => m && m.name).join(' '); for (const [re, u] of FURN_NAME) if (re.test(nm)) return u; return null; }
function isColour(o, bb, M, LOOK) {
  if ((o.userData.lkUnit ??= furnUnit(o))) return false;
  const r = o.userData.rr; if (r && r.role === 'hero') return true;
  const nm = o.userData.invName || o.name || ''; if (COLOUR_RE.test(nm)) return true;
  const cx = (bb.min.x + bb.max.x) / 2, cy = -(bb.min.z + bb.max.z) / 2, D = M.D;
  const mw = D.walk && { outer: D.walk.outer, holes: D.walk.holes }, inW = (x, y) => insideWalk(x, y, mw);   // main walk only: the east extension stays clay (inspect sw6b: brown floor scraps at Donutique)
  if (bb.max.y <= 0.3 && mw && inW(cx, cy)) { o.userData.lkFloor = true; return true; }   // every walk floor surface
  if (r && r.unit) return false;
  if (!r && D.units.some(u => u.role === 'hero' && u.poly && pointInPoly(cx, cy, u.poly))) return true;                                   // another tenant's unit
  const rn = D.graph && D.graph.nodes && D.graph.nodes.rotunda;    // the whole rotunda in front of Gjelina
  if (rn && Math.hypot(cx - rn[0], cy - rn[1]) < LOOK.rotR) return true;
  return false;
}

export function installLook(P, M, { ungrade = (h) => new THREE.Color(h), flags = globalThis.RR_FLAGS || {} } = {}) {
  const R = P.renderer, F = flags;
  let av0Ref = () => {}; const LK = { P, M, report: { programs: {} }, clayOn: false, cutH: OFF, gliding: false, mats: {} };
  const rowBox = [M.D.overview.rowBox[0], M.D.overview.rowBox[1], Math.min(M.D.overview.rowBox[2], +(F.lookcrope ?? 38.5)), Math.max(M.D.overview.rowBox[3], +(F.lookcropn ?? 48.5))] /* main Oct 21: the plinth takes in all of COTE (r137 reaches y 48); east edge pulled in to just past the Palazzo medallion (Oct 12 rule; the torn floor edges of the back hallway, #5) */, cb = LK.crop = [rowBox[0] - LOOK.crop, rowBox[1] - LOOK.crop, rowBox[2] + LOOK.crop, rowBox[3] + LOOK.crop];
  // inspect sw6b / main: no unit sliced along the row. A unit whose whole outline fits in the old box grown by 3 m (or listed
  // in RR_FLAGS.lookunitgrow, default Sugarcane) is kept whole and the plinth grows to take it in; units in
  // RR_FLAGS.lookunitout (default illy, Waterfall, Nomikai: mostly outside, a sliver inside) are left out whole; the big
  // south units (Voltaire, Summit, Starbucks, the empty room) keep the old straight edge, dropping them left holes in the
  // plinth (progress sheet 1021_0605_look_plinth_B.png). The camera framing keeps the original box (LK.cropFrame).
  LK.cropFrame = cb.slice(); LK.unitOut = new Set();
  if (+(F.lookunitcrop ?? 1)) { const gr = LK.cropFrame.map((v, i) => v + (i < 2 ? -3 : 3)), grow = new Set(String(F.lookunitgrow ?? 'u105').split(',')), out = new Set(String(F.lookunitout ?? 'u166,u138,u169').split(','));
    for (const u of M.D.units || []) { if (!u.poly || !u.poly.length) continue;
      if (out.has(u.id)) { LK.unitOut.add(u.id); continue; }
      if (!grow.has(u.id) && !u.poly.every(([x, y]) => x >= gr[0] && x <= gr[2] && y >= gr[1] && y <= gr[3])) continue;
      for (const [x, y] of u.poly) { cb[0] = Math.min(cb[0], x - 0.5); cb[2] = Math.max(cb[2], x + 0.5); cb[1] = Math.min(cb[1], y - 0.5); cb[3] = Math.max(cb[3], y + 0.5); } } }
  // 1. planes: cut (keep y <= h), crop x >= x0, x <= x1, Blender y >= y0 (three z <= -y0), y <= y1 (z >= -y1)
  const planes = LK.planes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), OFF), new THREE.Plane(new THREE.Vector3(1, 0, 0), OFF), new THREE.Plane(new THREE.Vector3(-1, 0, 0), OFF),
    new THREE.Plane(new THREE.Vector3(0, 0, -1), OFF), new THREE.Plane(new THREE.Vector3(0, 0, 1), OFF)];
  const cropC = [-cb[0], cb[2], -cb[1], cb[3]];
  R.clippingPlanes = planes;
  // three r169 sets clipping.numPlanes only inside render(): one empty render now, so the load's compile() calls already see 5 planes
  R.render(new THREE.Scene(), new THREE.PerspectiveCamera());
  LK.setPlanes = (h, crop) => { const c = planes[0].constant; planes[0].constant = h; for (let i = 0; i < 4; i++) planes[i + 1].constant = crop ? cropC[i] : OFF; return c !== h; };

  // s85q: the player sizes N8AO to the CSS size after the composer sized it to the drawing buffer, so AO ran at DPR 1 whatever the
  // governor chose (805 x 453 against a 603 x 339 canvas at DPR 0.75: 137 -> 94 ms). AO now follows the drawing buffer.
  { const rs0 = P.resize.bind(P); P.resize = () => { rs0(); if (P.aoPass && +(F.lookaodpr ?? 1)) { const c = R.domElement; P.aoPass.setSize(c.width, c.height); } }; }
  // ship c46 probe (Delmonico entrance, windowed Intel): base 92 ms, floor mirror off 50 ms. While the camera moves the mirror
  // refreshes every second frame (the player's mirrorhalf; a still view always gets a fresh one), and the mirror pass skips
  // transparent pieces (glass reflected in the floor is lost in its own reflection). Not on the desktop tier unless asked.
  if (F.mirrorhalf === undefined && (!P.tier || P.tier.name !== 'desktop')) F.mirrorhalf = +(F.lookmirrorhalf ?? 1);
  // deferral: wrap the gate stream (rr2_player.gateStream) before the load reaches it
  const defer = +(F.lookdefer ?? 1);
  // the hidden preload draws nothing, so the gate may use more of each frame and keep more compiles in flight (ship c43: 40 s of compile after the last byte)
  if (F.gateMs === undefined) F.gateMs = +(F.lookgatems ?? 14); if (F.gateF === undefined) F.gateF = +(F.lookgatef ?? 96);
  const gs0 = P.gateStream.bind(P);
  P.gateStream = (order, issue, apply, mark) => {
    const byMat = P.byMat;
    if (+(F.looknotrans ?? 1)) for (const m of order) if (m && m.transmission > 0) { m.opacity = Math.min(m.opacity ?? 1, 1 - 0.7 * m.transmission); m.transmission = 0; m.transparent = true; m.depthWrite = false; m.needsUpdate = true; (LK._ntSeen ||= new Set()).add(m); }   // before the first compile (patched later they recompiled at init: part of the ready regression)
    const wrapApply = (m) => { const e = byMat && byMat.get(m); if (!e) return apply(m);
      for (const o of e.meshes) o.material = m; };
    LK._issue = issue; LK._apply = wrapApply;
    let need = order, later = [];
    if (defer && byMat) { need = []; const b3 = new THREE.Box3(), ents = Object.values(M.D.heroes).map(h => h.view.pos); for (const m of order) { const e = byMat.get(m); const rn = M.D.graph && M.D.graph.nodes && M.D.graph.nodes.rotunda, ground = +(F.lookneedground ?? 0); const hero = !e || e.meshes.some(o => { b3.setFromObject(o); const cx0 = (b3.min.x + b3.max.x) / 2, cy0 = -(b3.min.z + b3.max.z) / 2, nearRot = rn && Math.hypot(cx0 - rn[0], cy0 - rn[1]) < LOOK.rotR; /* ship c43: ready waited 40 s on compiles; only what the first overview shows is needed (pieces under the cut, the rotunda dome and chandelier), the rest streams behind it */ if (!o.userData.rr) return b3.min.y <= LOOK.cut || nearRot; if (isColour(o, b3, M, LOOK) && (b3.min.y <= LOOK.cut + 0.05 || nearRot) && !o.userData.rr.ceil) return true; if (!ground || !M.nearWalk(b3, 2.5)) return false; const cx = (b3.min.x + b3.max.x) / 2, cy = -(b3.min.z + b3.max.z) / 2; return ents.some(p => Math.hypot(cx - p[0], cy - p[1]) < 18); }); /* main Oct 20: near the walk AND within 18 m of a hero entrance (what the cards fly to); the rest streams behind the open view */ (hero ? need : later).push(m); }
      // deferred order: what the fly-ins reach first (near the walk within 18 m of a hero entrance), then the rest
      const pri = (m) => { const e = byMat.get(m); return e && e.meshes.some(o => { b3.setFromObject(o); if (!M.nearWalk(b3, 2.5)) return false; const cx = (b3.min.x + b3.max.x) / 2, cy = -(b3.min.z + b3.max.z) / 2; return ents.some(p => Math.hypot(cx - p[0], cy - p[1]) < 18); }) ? 0 : 1; };
      const pr = new Map(later.map(m => [m, pri(m)])); later.sort((a, b) => pr.get(a) - pr.get(b)); }
    LK.report.programs.materials = { need: need.length, deferred: later.length };
    const g = gs0(need, issue, wrapApply, mark);
    g.finished.then(() => { LK.report.programs.atReady = R.info.programs.length; LK.report.readyAt = Math.round(performance.now());
      if (!later.length) return;
      const dg = LK.deferGate = new ProgramGate(R, { gateMs: 4, maxInFlight: 8, perFrame: 64 });
      for (const m of later) dg.add(m, issue, wrapApply);
      setTimeout(() => { if (!LK.gliding) dg.start(); }, 400);
      dg.finished.then(() => { dg.frameLog = []; dg.progs = new Map(); dg.waiters = new Map(); LK.report.programs.afterDeferred = R.info.programs.length; LK.report.deferredAt = Math.round(performance.now()); P.invalidate(2); });
    });
    return g;
  };
  // C9 final approach: one hidden render of the ground view at the destination before the drop starts, with the ground state
  // (no clay, no cut, ceilings and neighbours in), so the first-draw work of the last metre (buffers, uniforms, texture binds)
  // happens before the glide instead of inside it. Drawn into the composer target, never shown.
  LK.prewarm = (to, ground = true) => { const a = performance.now(), cam0 = P.camera, wc = cam0.clone(); wc.position.copy(to.pos); wc.fov = to.fov || 60; wc.near = 0.05; wc.far = 400; wc.updateProjectionMatrix();
    wc.lookAt(wc.position.clone().add(lookVec(to.yaw, to.pitch))); wc.updateMatrixWorld(true);
    const keep = { clay: LK.clayOn, roof: M.roofOff, cut: planes.map(q => q.constant), cg: LK.clayGroup.visible, cap: LK.capGroup.visible, deco: LK.deco.visible };
    try { LK.clayOn = !ground; M.roofOff = !ground; LK.setPlanes(ground ? OFF : LOOK.cut, !ground); LK.clayGroup.visible = LK.capGroup.visible = LK.deco.visible = !ground; M.applyVis();
      P.camera = wc; P.cull(0.75); const prev = R.getRenderTarget(); R.setRenderTarget(P.composer ? P.composer.renderTarget1 : null); R.render(P.scene, wc); R.setRenderTarget(prev); }
    finally { P.camera = cam0; LK.clayOn = keep.clay; M.roofOff = keep.roof; keep.cut.forEach((c, i) => { planes[i].constant = c; }); LK.clayGroup.visible = keep.cg; LK.capGroup.visible = keep.cap; LK.deco.visible = keep.deco; M.applyVis(); P.cull(0.75); P.invalidate(2); }
    (LK.report.prewarmMs ||= []).push(Math.round(performance.now() - a)); };
  LK.prepare = async (maxMs = +(F.lookprepms ?? 3000)) => {   // C9: the destination's programs (everything deferred) before a glide; textures are uploaded at load
    const dg = LK.deferGate; if (!dg || dg.done) return 0; const a = performance.now(); const g0 = [dg.gateMs, dg.maxInFlight]; dg.gateMs = 14; dg.maxInFlight = 32; dg.start(); dg.finished.then(() => {}); setTimeout(() => { dg.gateMs = g0[0]; dg.maxInFlight = g0[1]; }, maxMs);
    await Promise.race([dg.finished, new Promise(r => setTimeout(r, maxMs))]); return Math.round(performance.now() - a);
  };

  LK.init = () => {
    const T0 = performance.now(), D = M.D, root = P.root, bb = new THREE.Box3();
    M.cutZ = 1e4;
    const of0 = M.overviewFrames.bind(M);
    M.overviewFrames = () => { if (M._v52top) return of0(); const O = M.D.overview, sv = [O.rowBox, O.heroBox, O.introElDeg, O.restElDeg]; O.rowBox = LK.cropFrame; O.heroBox = LOOK.frameBox; O.introElDeg = LOOK.introEl; O.restElDeg = +F.lookpitch || LOOK.el;
      try { return of0(); } finally { [O.rowBox, O.heroBox, O.introElDeg, O.restElDeg] = sv; } };                                     // the modes near plane cut is replaced by the clip planes
    const mk = (hex) => ungrade(hex);
    const U = LK.U = { cut: { value: LOOK.cut }, dim: { value: 1 }, revT: { value: 10 }, rev: { value: new THREE.Vector3(cb[0], 1 / Math.max(1, cb[2] - cb[0]), 0) } };
    const clayU = (fade) => ({ uColor: { value: mk(LOOK.clay) }, uDim: U.dim, uCut: U.cut, uFade: { value: fade }, uRevT: U.revT, uRev: U.rev });
    const clay = LK.mats.clay = new THREE.ShaderMaterial({ name: 'look_clay', uniforms: clayU(1), vertexShader: CLAY_VS, fragmentShader: CLAY_FS, clipping: true });
    const clayH = LK.mats.clayH = clay.clone(); clayH.uniforms = clayU(1);   // heroes as clay during the opening reveal (same program)
    const slabM = LK.mats.slab = clay.clone(); slabM.name = 'look_slab'; slabM.uniforms = { uColor: { value: mk(LOOK.slab) }, uDim: { value: 1 }, uCut: { value: -1e5 }, uFade: { value: 1 }, uRevT: { value: 10 }, uRev: { value: new THREE.Vector3() } }; slabM.clipping = false; slabM.defines = { LOOK_SLAB: 1 };   // own program: the clip uniform is never set on it (zeros keep everything)
    const cap = LK.mats.cap = new THREE.MeshBasicMaterial({ name: 'look_cap', color: mk(LOOK.cap), side: THREE.BackSide });
    cap.onBeforeCompile = (sh) => { sh.uniforms.uRevT = U.revT; sh.uniforms.uRev = U.rev;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uRevT; uniform vec3 uRev;').replace('#include <project_vertex>', 'if (uRev.z > 0.5) { float dl = clamp((transformed.x - uRev.x) * uRev.y, 0.0, 1.0) * 0.7; float k = clamp((uRevT - dl) / 0.8, 0.0, 1.0); k = 1.0 - (1.0 - k) * (1.0 - k) * (1.0 - k); transformed.y -= (1.0 - k) * 3.0; }\n#include <project_vertex>');
      sh.fragmentShader = sh.fragmentShader.replace('#include <logdepthbuf_fragment>', '#include <logdepthbuf_fragment>\n#ifdef USE_LOGDEPTHBUF\n gl_FragDepth = min(gl_FragDepth + 1e-5, 1.0);\n#endif'); };
    cap.customProgramCacheKey = () => 'look_cap';
    const lineM = LK.mats.line = new THREE.LineBasicMaterial({ color: mk(LOOK.line), transparent: true, opacity: LOOK.lineOpacity, depthWrite: false });
    // ground speed (s56q: the rotunda frame was 146 ms in one pass, three's transmission pass draws the whole opaque scene a
    // second time whenever a transmissive piece is on screen: cake displays, lantern glass, reeded panels, rotunda curtain).
    // Those few materials become plain see-through (opacity from their transmission), so that second scene pass never runs.
    LK.noTrans = () => { if (!+(F.looknotrans ?? 1)) return; const seen = LK._ntSeen ||= new Set(); root.traverse(o => { if (!o.isMesh) return; for (const m of [].concat(o.material)) { if (!m || seen.has(m) || !(m.transmission > 0)) continue; seen.add(m);
      m.opacity = Math.min(m.opacity ?? 1, 1 - 0.7 * m.transmission); m.transmission = 0; m.transparent = true; m.depthWrite = false; m.needsUpdate = true; } }); LK.report.noTransmission = seen.size; };   // run again with the foliage scan: later areas bring their own (s61: the lantern chandelier glass)
    LK.noTrans();
    // ship c45 (Nomikai TO GO fish, EAT SUSHI letters): thin neon tubes broke up into faint dotted outlines at walk distance.
    // Neon pieces (mesh or material named neon, not the hardware: clips, electrodes, brackets, backers) are pushed out along
    // their normals by RR_FLAGS.lookneonpx (default 0.8 px each side, so a tube is at least about 1.6 px wide) and drawn
    // RR_FLAGS.lookneonk (default 2.5) times brighter, so they read solid at 5 to 15 m. One extra program per neon material.
    LK.U.neonPx = { value: 0 }; LK.U.neonK = { value: +(F.lookneonk ?? 2.5) };
    LK.neonScan = () => { if (!+(F.lookneon ?? 1)) return; const done = LK._neon ||= new WeakSet(); const HW = /hw_|clip|electrode|bracket|backer|mount|wire|cable/i;
      root.traverse(o => { if (!o.isMesh) return; const nm = o.userData.invName || o.name || ''; for (const m of [].concat(o.material)) { if (!m || done.has(m)) continue; const mn = m.name || '';
        if (!(/neon/i.test(nm) || /neon/i.test(mn)) || HW.test(nm + ' ' + mn) || m.isShaderMaterial) continue; done.add(m); (LK.report.neon ||= []).push(mn);
        const ob = m.onBeforeCompile, ok = m.customProgramCacheKey;
        m.onBeforeCompile = function (sh, r) { if (ob) ob.call(this, sh, r); sh.uniforms.uNeonPx = LK.U.neonPx; sh.uniforms.uNeonK = LK.U.neonK;
          sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uNeonPx;').replace('#include <begin_vertex>', '#include <begin_vertex>\n{ vec4 rrMv = modelViewMatrix * vec4(transformed, 1.0); float rrS = max(length(modelMatrix[0].xyz), 1e-4); transformed += normalize(objectNormal + 1e-6) * (-rrMv.z * uNeonPx / rrS); }');
          sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNeonK;').replace('#include <opaque_fragment>', '#include <opaque_fragment>\n{ vec3 c = gl_FragColor.rgb; float mx = max(c.r, max(c.g, c.b)); vec3 hue = c / max(mx, 1e-4); float l = dot(hue, vec3(0.2126, 0.7152, 0.0722)); hue = clamp(mix(vec3(l), hue, 1.5), 0.0, 1.0); gl_FragColor.rgb = hue * min(mx * uNeonK, 1.15); }'); };
        m.customProgramCacheKey = function () { return (ok ? ok.call(this) : '') + '|neonw'; }; m.needsUpdate = true; } }); };
    LK.neonScan();
    // s78 profile (real free walk loop): Matrix4.compose for every model object on every scene.updateMatrixWorld (several per
    // frame: main, N8AO transparency, mirror) was the top CPU cost. The model is static: local matrices are frozen once (and
    // for later areas with the 2 s scan); the hover lift already updates the matrices it moves.
    LK.freezeM = () => { if (!+(F.lookfreezem ?? 1)) return; root.traverse(o => { if (o.matrixAutoUpdate) { o.updateMatrix(); o.matrixAutoUpdate = false; } }); if (P.scene.matrixAutoUpdate) { P.scene.updateMatrix(); P.scene.matrixAutoUpdate = false; } };   // the scene too: its own updateMatrix flags its world dirty and forces every descendant's world multiply (s79)
    LK.freezeM();
    // classify
    const heroes = [], clayList = [], ovHide = [], capped = [], minY = [];
    root.traverse(o => { if (!o.isMesh || o.userData.rrOwn || !o.material) return; const r = o.userData.rr;
      bb.setFromObject(o); if (bb.isEmpty()) return; o.userData.lkMinY = bb.min.y; minY.push(o);
      const cx = (bb.min.x + bb.max.x) / 2, cy = -(bb.min.z + bb.max.z) / 2;
      if (cx < cb[0] || cx > cb[2] || cy < cb[1] || cy > cb[3] || (r && r.unit && LK.unitOut.has(r.unit))) o.userData.lkStray = true;
      if (isColour(o, bb, M, LOOK)) { heroes.push(o); o.userData.lkColour = true; if (o.userData.lkFloor && !(r && r.role === 'hero')) { const fl = LK.report.floorColour ||= { n: 0, names: [] }; fl.n++; if (fl.names.length < 60) fl.names.push(o.userData.invName || o.name); } const k = (r && r.role === 'hero' ? r.unit : ((o.userData.invName || o.name || '').match(COLOUR_RE) ? 'facade' : 'corridor')); (LK.report.colour ||= {})[k] = (LK.report.colour[k] || 0) + 1; }
      else { const ms = Array.isArray(o.material) ? o.material : [o.material]; if (ms.some(m => m.transparent || (m.transmission ?? 0) > 0)) { o.userData.lkHideOv = true; ovHide.push(o); } else clayList.push(o); }
      if (!o.isInstancedMesh && bb.min.y < LOOK.cut - 0.1 && bb.max.y > LOOK.cut + 0.05 && !o.userData.lkHideOv) capped.push(o); });
    // static clay pieces drawn as a few merged cell meshes (one draw per 20 m cell instead of one per piece); the pieces
    // themselves are hidden while the clay is on. Instanced pieces keep a material swap.
    const mergeable = clayList.filter(o => !o.isInstancedMesh && !o.userData.lkStray && !(o.userData.rr && (o.userData.rr.ceil || o.userData.rr.omit || o.userData.rr.ovHide)) && o.userData.lkMinY <= LOOK.cut && o.geometry.attributes.position);
    for (const o of clayList) if (o.isInstancedMesh) o.userData.lkHideOv = true;   // neighbour props: hidden in the overview, not clay
    for (const o of clayList) if (!o.isInstancedMesh) o.userData.lkMerged = true;
    const clayGrp = LK.clayGroup = new THREE.Group(); clayGrp.name = 'look_clay'; clayGrp.visible = false;
    const FURN = new Set(['u137', 'u133']), furn = (o) => !!o.userData.lkUnit || (o.userData.rr && FURN.has(o.userData.rr.unit));
    const mc = mergeCells(mergeable.filter(o => !furn(o))); for (const g of mc.geos) { const m = new THREE.Mesh(g, clay); m.userData.rrOwn = true; clayGrp.add(m); }
    // main Oct 21: hanging fixtures (bottom above 1.9 m) left out of the COTE and Yardbird clay, so the furniture reads from above
    const mf = mergeCells(clayList.filter(o => furn(o) && !o.userData.lkStray && !(o.userData.rr && (o.userData.rr.ceil || o.userData.rr.omit || o.userData.rr.ovHide)) && o.userData.lkMinY <= 1.9 && !(o.userData.lkMinY > 1.2 && /pendant|globe|lamp|bulb|shade/i.test((o.userData.invName || o.name || '') + ' ' + [].concat(o.material).map(m => m && m.name).join(' '))) && o.geometry.attributes.position), 20, 0.02);
    for (const g of mf.geos) { const m = new THREE.Mesh(g, clay); m.userData.rrOwn = true; clayGrp.add(m); } LK.report.furnished = { tris: [mf.tris, mf.kept] };
    const capGrp = LK.capGroup = new THREE.Group(); capGrp.name = 'look_caps'; capGrp.visible = false;
    const cm = mergeCells(capped.filter(o => !o.userData.lkStray && o.geometry.attributes.position), 20, 0.1, true); for (const g of cm.geos) { const m = new THREE.Mesh(g, cap); m.userData.rrOwn = true; capGrp.add(m); }
    const heroGrp = LK.heroClayGroup = new THREE.Group(); heroGrp.name = 'look_hero_clay'; heroGrp.visible = false;
    const hm = mergeCells(heroes.filter(o => !o.isInstancedMesh && !o.userData.lkStray && !(o.userData.rr && (o.userData.rr.ceil || o.userData.rr.omit || o.userData.rr.ovHide)) && o.userData.lkMinY <= LOOK.cut && !(Array.isArray(o.material) ? o.material : [o.material]).some(m => m.transparent) && o.geometry.attributes.position));
    for (const g of hm.geos) { const m = new THREE.Mesh(g, clayH); m.userData.rrOwn = true; heroGrp.add(m); }
    LK.heroBy = {}; for (const o of heroes) { const r = o.userData.rr; if (!r || r.role !== 'hero') continue; o.userData.lkY0 = o.position.y; (LK.heroBy[r.unit] ||= []).push(o); }
    P.scene.add(clayGrp, capGrp, heroGrp);
    // RR_FLAGS.lookgroundmerge = 1 (default off until shot; main Oct 21, draw calls at the Delmonico entrance): at the ground the
    // static opaque pieces of each unit are drawn as merged meshes, one per material, unit and 6 m cell (world space copies made
    // here, while the vertex arrays still exist), instead of one draw per piece. The originals stay for the overview, the
    // glides and the hover (roomCull swaps them at the ground). Left out: transparent and multi material pieces, instanced,
    // the floor mirror materials, pieces without vertex arrays, groups under 3 pieces.
    { const gm = LK.gmGroup = new THREE.Group(); gm.name = 'look_groundmerge'; gm.visible = false; LK.report.groundMerge = null;
      if (+(F.lookgroundmerge ?? 0)) { const t0 = performance.now(), groups = new Map(), v = new THREE.Vector3(), real = new Map();
        if (P.byMat) for (const [mm, en] of P.byMat) for (const o of en.meshes || []) real.set(o, mm);   // the gate may still have stand-ins on the pieces: merge with the real material
        root.traverse(o => { if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || o.morphTargetInfluences || o.userData.rrOwn) return; const r = o.userData.rr, m = real.get(o) || o.material;
          if (!r || !r.unit || !m || Array.isArray(m) || m.transparent || m.userData.floorCode || m.userData.floorReflect || !o.geometry.attributes.position || !o.geometry.attributes.position.array) return;
          const g = o.geometry, sig = Object.keys(g.attributes).sort().map(k => k + g.attributes[k].itemSize + (g.attributes[k].normalized ? 'n' : '')).join(',') + (g.index ? '|i' : '|n');
          o.updateWorldMatrix(true, false); if (!g.boundingBox) g.computeBoundingBox(); g.boundingBox.getCenter(v).applyMatrix4(o.matrixWorld);
          const key = m.uuid + '|' + r.unit + '|' + sig + '|' + Math.floor(v.x / 6) + ',' + Math.floor(v.z / 6); let e = groups.get(key); if (!e) groups.set(key, e = { m, unit: r.unit, list: [] }); e.list.push(o); });
        let made = 0, pieces = 0;
        for (const e of groups.values()) { if (e.list.length < 3) continue;
          try { const geos = e.list.map(o => { const c = o.geometry.clone(); c.applyMatrix4(o.matrixWorld); return c; }); const mg = mergeGeometries(geos, false); geos.forEach(c => c.dispose()); if (!mg) continue;
            const mesh = new THREE.Mesh(mg, e.m); mesh.matrixAutoUpdate = false; mesh.userData.rrOwn = true; mesh.name = 'look_gm_' + e.unit; mesh.layers.mask = e.list[0].layers.mask; mesh.renderOrder = e.list[0].renderOrder; gm.add(mesh);
            for (const o of e.list) o.userData.lkGM = true; made++; pieces += e.list.length; } catch (err) { (LK.report.groundMergeErr ||= []).push(String(err).slice(0, 120)); } }
        P.scene.add(gm); LK.report.groundMerge = { meshes: made, pieces, ms: Math.round(performance.now() - t0) }; } }
    // main Oct 21 (ground speed, foliage only, never fewer pieces up close): the big leaf and flower instance sets (one
    // InstancedMesh each across the whole corridor, about 50k leaves of 72 triangles) are split into 3 m clusters, so off
    // screen clusters are frustum culled, and a cluster farther than 5 m draws a shuffled share of its leaves (30 % floor).
    // The originals keep count 0. The clusters show at the ground only (the clay overview hid these neighbour props anyway).
    { const FOL = /top_leaf|poppy|blossom|flower|leaf/i, fol = LK.foliage = new THREE.Group(); fol.name = 'look_foliage'; const v = new THREE.Vector3(), m4 = new THREE.Matrix4(); let nC = 0, nI = 0;
      // build's illusion cards (Palazzo atrium past the Waterfall, Chica past Nomikai) exist only for ground views: found by name
      // or as a large piece standing within 1.2 m of a card centre, hidden in the overview and during glides (applyVis below)
      // build's illusion cards (r9zi2_card_palazzo past the Waterfall, r9zi2_card_chica past Nomikai) exist only for ground
      // views: found by name (build may still resize them), hidden in the overview and during glides (applyVis below)
      LK.cardScan = () => { const out = []; root.traverse(o => { if (!o.isMesh) return; const nm = (o.userData.invName || o.name || '') + ' ' + [].concat(o.material).map(m => m && m.name).join(' ');
          if (/r9zi2_card_|illusion_card|backdrop_card/i.test(nm)) out.push(o); }); LK.cards = out; LK.report.cards = out.map(o => o.userData.invName || o.name); if (LK.clayOn || LK.gliding) for (const o of out) { o.userData.rrHide = true; o.visible = false; } };
      LK.folScan = () => { LK._instU = null; LK._trList = null; if (LK.cardScan) LK.cardScan(); if (LK.noTrans) LK.noTrans(); if (LK.neonScan) LK.neonScan(); if (LK.freezeM) LK.freezeM(); if (+(F.lookfoliage ?? 1)) root.traverse(o => { if (!o.isInstancedMesh || o.userData.lkFol || o.count < 200 || o.userData.rrOwn || !FOL.test([].concat(o.material).map(m => m && m.name).join(' '))) return;
        o.updateWorldMatrix(true, false); const cells = new Map();
        for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m4); v.setFromMatrixPosition(m4).applyMatrix4(o.matrixWorld); const k = Math.floor(v.x / 3) + ',' + Math.floor(v.z / 3); let c = cells.get(k); if (!c) cells.set(k, c = []); c.push(i); }
        for (const ids of cells.values()) { for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
          const im = new THREE.InstancedMesh(o.geometry, o.material, ids.length); ids.forEach((id, k) => { o.getMatrixAt(id, m4); im.setMatrixAt(k, m4); }); im.instanceMatrix.needsUpdate = true;
          im.matrixAutoUpdate = false; im.matrix.copy(o.matrixWorld); im.matrixWorld.copy(o.matrixWorld); im.computeBoundingSphere(); im.userData.rrOwn = true; im.userData.lkN = ids.length; im.userData.lkC = im.boundingSphere.center.clone().applyMatrix4(im.matrixWorld); im.userData.lkR = im.boundingSphere.radius;
          im.layers.mask = o.layers.mask; im.name = 'look_fol'; fol.add(im); nC++; nI += ids.length; }
        o.count = 0; o.userData.lkFol = true; }); LK.report.foliage = { clusters: nC, instances: nI }; };   // instance sets arrive with their area after init: scanned again every 2 s
      LK.folScan(); fol.visible = false; P.scene.add(fol);
      LK.folStep = () => { { const t = performance.now(); if (t - (LK._folT || 0) > 2000 && (LK._folK = (LK._folK || 0) + 1) < 120) { LK._folT = t; LK.folScan(); } } const g = LK.foliage; const on = !LK.clayOn && !LK.gliding ? true : P.camera.position.y < 3; if (g.visible !== on) g.visible = on; if (!on) return; const c = P.camera.position;
        for (const im of g.children) { const d = c.distanceTo(im.userData.lkC) - im.userData.lkR, n = im.userData.lkN; im.count = d < 5 ? n : Math.max(Math.ceil(n * 0.3), Math.round(n * Math.pow(5 / d, 1.5))); } }; }
    LK.lists = { heroes, clayList, ovHide, capped, minY };
    // meshes the modes controller never tagged (far area pieces it missed) are merged into clay too, so they must be hidden with the rest (AIR_NE black voids: untagged floors on gate fallbacks)
    // build Oct 20: hanging pendants and lamps inside the hero rooms (bottom above 1.9 m) cover the tables from above: hidden in the overview only
    { const PEND = /pendant|globe|lamp|bulb|shade|sconce/i; let np = 0;
      for (const o of heroes) { const r = o.userData.rr; if (!r || r.role !== 'hero' || r.ceil || o.userData.lkMinY <= 1.2) continue;   // named fixtures from 1.2 m up (s41: the merged Gjelina globes hang to about 1.8 m); unnamed pieces only above 2.2 m
        if (o.userData.lkMinY <= 1.9 && !PEND.test((o.userData.invName || o.name || '') + ' ' + [].concat(o.material).map(m => m && m.name).join(' '))) continue; if (o.userData.lkMinY > 2.2 && !o.userData.lkNoClip) { o.userData.lkPendant = true; np++; continue; } const nm = (o.userData.invName || o.name || '') + ' ' + [].concat(o.material).map(m => m && m.name).join(' ');
        if (PEND.test(nm) && !/(^|\s|:)rot_|chand/i.test(nm)) { o.userData.lkPendant = true; np++; } } LK.report.pendants = np; }
    { const tagged = new Set(M.meshes); LK.extra = minY.filter(o => !tagged.has(o)); LK.visList = [...M.meshes, ...LK.extra]; LK.report.untagged = LK.extra.length; } LK.report.merged = { clayMeshes: mergeable.length, clayCells: mc.geos.length, clayTris: [mc.tris, mc.kept, mc.bad], clayVerts: [mc.verts, mc.keptVerts], capMeshes: capped.length, capCells: cm.geos.length, capTris: [cm.tris, cm.kept, cm.bad] };
    // DECISIONS C / main Oct 20: never hide the rotunda sky or the chandelier. Rotunda pieces above the cut wear a copy of their material
    // without the clip test (one extra program per material, compiled below), so the dome and chandelier stay in the overview.
    // The original material's own program loses the clip test (same material object, so its uniforms and textures stay bound;
    // a clone drew the sky black), only for materials used by nothing but rotunda pieces above the cut that are big or named
    // dome / sky / chandelier, and never a restaurant's own interior.
    { const rn = D.graph && D.graph.nodes && D.graph.nodes.rotunda, cand = new Set(), mats = new Set(); LK.noclip = [];
      const NAME = /dome|sky|chand|crystal|lustre|oculus|cupola/i;
      if (rn) for (const o of heroes) { const r = o.userData.rr; if (r && r.role === 'hero') continue; bb.setFromObject(o); const cx = (bb.min.x + bb.max.x) / 2, cy = -(bb.min.z + bb.max.z) / 2;
        if (bb.max.y <= LOOK.cut + 0.3 || Math.hypot(cx - rn[0], cy - rn[1]) > LOOK.rotR) continue;
        const ms = Array.isArray(o.material) ? o.material : [o.material], big = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) > 3;
        const nm0 = (o.userData.invName || o.name || '') + ' ' + ms.map(m => m.name).join(' '); if (!/(^|\s|:)rot_/.test(nm0) && !NAME.test(nm0)) continue; cand.add(o); }
      for (const o of cand) for (const m of (Array.isArray(o.material) ? o.material : [o.material])) { const e = P.byMat && P.byMat.get(m); if (e && e.meshes.every(x => cand.has(x))) mats.add(m); }
      LK.U.domeCream = { value: 0 }; LK.U.creamCol = { value: ungrade('#E9E1D4') };
      const RING = /drum|band|crown|dentil|mould|rope|rust/i, CHAND = /chand|crystal|bulb/i, nmOf = (o) => (o.userData.invName || o.name || '') + ' ' + [].concat(o.material).map(m => m.name).join(' ');
      for (const o of cand) o.userData.lkDome = CHAND.test(nmOf(o)) ? 'chand' : RING.test(nmOf(o)) ? 'ring' : 'shell';
      const ringMats = new Set(); for (const o of cand) if (o.userData.lkDome === 'ring') for (const m of [].concat(o.material)) ringMats.add(m);
      for (const m of mats) { const ob = m.onBeforeCompile, ok = m.customProgramCacheKey, cu = ringMats.has(m) ? LK.U.domeCream : { value: 0 }; m.onBeforeCompile = function (sh, r) { if (ob) ob.call(this, sh, r); sh.uniforms.uDomeCream = cu; sh.uniforms.uCreamCol = LK.U.creamCol;
          sh.fragmentShader = sh.fragmentShader.replace('#include <clipping_planes_fragment>', '').replace('void main() {', 'uniform float uDomeCream; uniform vec3 uCreamCol;\nvoid main() {').replace('#include <dithering_fragment>', '#include <dithering_fragment>\n if (uDomeCream > 0.5) gl_FragColor.rgb = uCreamCol * (0.8 + 0.2 * gl_FragColor.a);'); };
        m.customProgramCacheKey = function () { return (ok ? ok.call(this) : '') + '|noclip'; }; m.needsUpdate = true; }
      for (const o of cand) if ((Array.isArray(o.material) ? o.material : [o.material]).every(m => mats.has(m))) { o.userData.lkNoClip = true; LK.noclip.push(o); }
      LK.report.noclip = { meshes: LK.noclip.length, materials: mats.size, names: LK.noclip.slice(0, 20).map(o => o.userData.invName || o.name) }; }
    // hero outline: the unit floor plate edge, 5 cm over the floor
    const deco = LK.deco = new THREE.Group(); deco.name = 'look_deco'; deco.visible = false;
    for (const u of D.units) { if (u.role !== 'hero' || !u.poly || u.poly.length < 3) continue;
      const g = new THREE.BufferGeometry().setFromPoints(u.poly.map(p => B2T([p[0], p[1], 0.05])));
      if (!LK.mats.rim) LK.mats.rim = new THREE.ShaderMaterial({ name: 'look_rim', uniforms: { uOp: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        vertexShader: '#include <common>\n#include <logdepthbuf_pars_vertex>\nvarying float vT;\nvoid main() { vT = uv.y; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;\n#include <logdepthbuf_vertex>\n}',
        fragmentShader: 'uniform float uOp; varying float vT;\n#include <common>\n#include <logdepthbuf_pars_fragment>\nvoid main() {\n#include <logdepthbuf_fragment>\n float a = pow(1.0 - abs(vT * 2.0 - 1.0), 2.0) * uOp; gl_FragColor = vec4(vec3(2.2, 1.25, 0.55), a); }' });
      { const rm = LK.mats.rim.clone(); rm.uniforms = { uOp: { value: 0 } }; (LK.rimBy ||= {})[u.id] = rm; const P3 = [], UV = [], IX = [], n = u.poly.length, wdt = +(F.lookrimw ?? 0.6);
        for (let i = 0; i < n; i++) { const a = u.poly[i], b = u.poly[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L * wdt, ny = dx / L * wdt, k = P3.length / 3;
          for (const [px, py, t] of [[a[0] - nx, a[1] - ny, 0], [a[0] + nx, a[1] + ny, 1], [b[0] - nx, b[1] - ny, 0], [b[0] + nx, b[1] + ny, 1]]) { P3.push(px, LOOK.cut + 0.03, -py); UV.push(0, t); }   // hover glow on top of the cut walls (at the floor it was 2 px and behind the walls: hover read as nothing, s63)
          IX.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
        const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(P3, 3)); rg.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); rg.setIndex(IX);
        const rmesh = new THREE.Mesh(rg, rm); rmesh.name = 'look_rim_' + u.id; rmesh.userData.rrOwn = true; rmesh.userData.lkHeroId = u.id; deco.add(rmesh); LK.rimMesh = (LK.rimMesh || {}); LK.rimMesh[u.id] = rmesh; }
      const lm = lineM.clone(); (LK.lineBy ||= {})[u.id] = lm; const l = new THREE.LineLoop(g, lm); l.name = 'look_outline_' + u.id; l.userData.rrOwn = true; deco.add(l); }
    // plinth: a rounded slab under the crop box, top 3 cm under the floor; contact shadow under it
    const pad = LOOK.slabPad, x0 = cb[0] - pad, y0 = cb[1] - pad, x1 = cb[2] + pad, y1 = cb[3] + pad, rr = 1.2;
    const sh = new THREE.Shape(); sh.moveTo(x0 + rr, y0); sh.lineTo(x1 - rr, y0); sh.quadraticCurveTo(x1, y0, x1, y0 + rr); sh.lineTo(x1, y1 - rr); sh.quadraticCurveTo(x1, y1, x1 - rr, y1);
    sh.lineTo(x0 + rr, y1); sh.quadraticCurveTo(x0, y1, x0, y1 - rr); sh.lineTo(x0, y0 + rr); sh.quadraticCurveTo(x0, y0, x0 + rr, y0);
    const slabG = new THREE.ExtrudeGeometry(sh, { depth: LOOK.slabH, bevelEnabled: false, curveSegments: 6 });
    const slab = new THREE.Mesh(slabG, slabM); slab.rotation.x = -Math.PI / 2; slab.position.y = -0.03 - LOOK.slabH; slab.name = 'look_slab'; slab.userData.rrOwn = true; deco.add(slab);
    { const cv = document.createElement('canvas'); cv.width = 256; cv.height = 256; const c2 = cv.getContext('2d'); const w = x1 - x0 + 10, h = y1 - y0 + 10;
      c2.fillStyle = '#000'; c2.fillRect(0, 0, 256, 256); c2.filter = 'blur(14px)'; c2.fillStyle = '#fff'; const sx = 256 / w, sy = 256 / h; c2.fillRect(5 * sx + 4, 5 * sy + 6, (x1 - x0) * sx - 4, (y1 - y0) * sy - 2);
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.NoColorSpace;
      const shM = LK.mats.shadow = new THREE.ShaderMaterial({ name: 'look_shadow', uniforms: { uMap: { value: tex }, uOp: { value: 0.22 } }, transparent: true, depthWrite: false,   // no clip chunks: the shadow reaches past the crop
        vertexShader: '#include <common>\n#include <logdepthbuf_pars_vertex>\nvarying vec2 vUv;\nvoid main() { vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;\n#include <logdepthbuf_vertex>\n}',
        fragmentShader: 'uniform sampler2D uMap; uniform float uOp; varying vec2 vUv;\n#include <common>\n#include <logdepthbuf_pars_fragment>\nvoid main() {\n#include <logdepthbuf_fragment>\n gl_FragColor = vec4(0.0, 0.0, 0.0, texture2D(uMap, vUv).g * uOp); }' });
      const shp = new THREE.Mesh(new THREE.PlaneGeometry(w, h), shM); shp.rotation.x = -Math.PI / 2; shp.position.set((x0 + x1) / 2, -0.03 - LOOK.slabH - 0.02, -(y0 + y1) / 2); shp.renderOrder = -2; shp.name = 'look_shadow'; shp.userData.rrOwn = true; deco.add(shp); }
    // hover shadows: the plinth's blurred rect under each hero box, faded in with the lift
    LK.shadowBy = {}; for (const [id, h] of Object.entries(M.hero || {})) { if (!h.box) continue; const sm = LK.mats.shadow.clone(); sm.uniforms = { uMap: LK.mats.shadow.uniforms.uMap, uOp: { value: 0 } };
      const w = h.box.max.x - h.box.min.x + 3, d = h.box.max.z - h.box.min.z + 3, q = new THREE.Mesh(new THREE.PlaneGeometry(w, d), sm);
      q.rotation.x = -Math.PI / 2; q.position.set((h.box.min.x + h.box.max.x) / 2, 0.015, (h.box.min.z + h.box.max.z) / 2); q.userData.rrOwn = true; q.name = 'look_hover_shadow_' + id; deco.add(q); LK.shadowBy[id] = sm; }
    // A2 sign glow: an additive billboard halo per lit hero sign (no bloom pass: no cost outside the overview, one program)
    { const haloM = LK.mats.halo = new THREE.ShaderMaterial({ name: 'look_halo', uniforms: { uCol: { value: new THREE.Color(1.6, 1.1, 0.7) }, uOp: { value: 0.35 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        vertexShader: '#include <common>\n#include <logdepthbuf_pars_vertex>\nvarying vec2 vUv;\nvoid main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0); mv.xy += position.xy * vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz)); gl_Position = projectionMatrix * mv;\n#include <logdepthbuf_vertex>\n}',
        fragmentShader: 'uniform vec3 uCol; uniform float uOp; varying vec2 vUv;\n#include <common>\n#include <logdepthbuf_pars_fragment>\nvoid main() {\n#include <logdepthbuf_fragment>\n float r = length(vUv - 0.5) * 2.0; float a = pow(max(1.0 - r, 0.0), 2.0); gl_FragColor = vec4(uCol, a * uOp); }' });
      const SIGN = /sign|wordmark|neon|logo|letter|marquee/i, heroesOnly = heroes.filter(o => o.userData.rr && o.userData.rr.role === 'hero' || COLOUR_RE.test(o.userData.invName || o.name || '')), hb = new THREE.Box3(), hc = new THREE.Vector3(), hs = new THREE.Vector3(); LK.haloBy = {}; const per = {};
      for (const o of heroesOnly) { const ms = Array.isArray(o.material) ? o.material : [o.material]; const nm = (o.userData.invName || o.name || '') + ' ' + ms.map(m => m.name || '').join(' ');
        if (!SIGN.test(nm)) continue; hb.setFromObject(o); hb.getCenter(hc); hb.getSize(hs); const sz = Math.max(hs.x, hs.y, hs.z); if (sz < 0.25 || sz > 9) continue;
        const id = (o.userData.rr && o.userData.rr.role === 'hero') ? o.userData.rr.unit : (/^(gjl_|w_|ri_|gt_ri|rot_)/.test(o.userData.invName || o.name || '') ? 'gjelina' : /^(mil_|m2_)/.test(o.userData.invName || o.name || '') ? 'milos' : 'delmonico'); if ((per[id] = (per[id] || 0) + 1) > 14) continue;
        let hm2 = LK.haloBy[id]; if (!hm2) { hm2 = LK.haloBy[id] = haloM.clone(); hm2.uniforms = { uCol: { value: new THREE.Color(1.6, 1.1, 0.7) }, uOp: { value: 0.35 } }; const e = ms[0].emissive; if (e && e.r + e.g + e.b > 0.05) hm2.uniforms.uCol.value.copy(e).multiplyScalar(1.6 / Math.max(e.r, e.g, e.b)); }
        const q = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), hm2); q.position.set(hc.x, Math.min(hc.y, LOOK.cut + 0.3), hc.z); q.scale.setScalar(sz * 1.6 + 1); q.userData.rrOwn = true; q.name = 'look_halo_' + id; deco.add(q); }
      LK.report.halos = per; }
    P.scene.add(deco);
    // hero exposure lift: the rooms gain texture, hero cells times 2^EV (texture data only)
    const rooms = P.rooms; if (rooms && rooms.uG) { const G = rooms.uG.value.image.data, EV = { gjelina: 2, milos: 1.5, delmonico: 2.5 }, H = THREE.DataUtils;
      const ids = new Set(['gjelina', 'milos', 'delmonico'].map(n => rooms.names.indexOf(n) + 1).filter(i => i > 0));
      const orig = G.slice(), lift = G.slice(); let n = 0;
      const W = rooms.W, Hh = rooms.H, inner = (c) => { const x = c % W, y = (c / W) | 0, id = rooms.id[c]; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= Hh || rooms.id[Y * W + X] !== id) return false; } return true; };
      for (let c = 0; c < rooms.W * rooms.H; c++) if (ids.has(rooms.id[c]) && inner(c) && !(M.D.walk && insideWalk(rooms.x0 + ((c % W) + 0.5) * rooms.C, rooms.y0 + (((c / W) | 0) + 0.5) * rooms.C, M.D.walk))) { const k = Math.pow(2, EV[rooms.names[rooms.id[c] - 1]] ?? LOOK.heroEV); for (let j = 0; j < 3; j++) lift[c * 4 + j] = H.toHalfFloat(H.fromHalfFloat(orig[c * 4 + j]) * k); n++; }
      const per = {}; for (let c = 0; c < W * Hh; c++) if (lift[c * 4] !== orig[c * 4]) { const nm = rooms.names[rooms.id[c] - 1]; per[nm] = (per[nm] || 0) + 1; }
      const all = {}; for (let c = 0; c < W * Hh; c++) if (ids.has(rooms.id[c])) { const nm = rooms.names[rooms.id[c] - 1]; all[nm] = (all[nm] || 0) + 1; }
      LK.gain = { orig, lift, tex: rooms.uG.value, cells: n }; LK.report.gainCells = { lifted: per, maskCells: all }; }
    // compile the new programs now (clay plain and instanced, cap, line, slab, shadow), not at the first overview frame
    { const px = new THREE.Scene(), bx = new THREE.BoxGeometry(); px.add(new THREE.Mesh(bx, clay), new THREE.Mesh(bx, cap), new THREE.Mesh(bx, LK.mats.halo), new THREE.Mesh(bx, LK.mats.rim), new THREE.Mesh(bx, slabM), new THREE.Mesh(bx, LK.mats.shadow), new THREE.LineLoop(bx, lineM));
      for (const o of LK.noclip || []) { const q = new THREE.Mesh(o.geometry, o.material); q.matrixAutoUpdate = false; q.matrixWorld.copy(o.matrixWorld); px.add(q); }
      px.traverse(o => { o.frustumCulled = false; }); const prev = R.getRenderTarget(); if (P.composer) R.setRenderTarget(P.composer.renderTarget1); try { P.compileLit ? P.compileLit(px) : R.compile(px, P.camera, P.scene); } finally { R.setRenderTarget(prev); } }
    // hooks: visibility, per frame state, glides, frozen probes and mirror
    const av0 = M.applyVis.bind(M); av0Ref = av0;
    M.applyVis = () => { av0(); if (LK._domeHid) for (const o of LK.noclip || []) { o.userData.rrHide = true; o.visible = false; }
      if (LK._shellHid) for (const o of LK.noclip || []) if (o.userData.lkDome === 'shell') { o.userData.rrHide = true; o.visible = false; } if (M.isolated) return;
      if (LK.gliding && LK._gHigh && LK.glideKeep !== undefined && +(F.lookglidecull ?? 0) /* s47: culling the other heroes left black holes in every fly-in; off */) for (const o of M.meshes) { const r = o.userData.rr; if (r && r.role === 'hero' && r.unit !== LK.glideKeep && !COLOUR_RE.test(o.userData.invName || o.name || '') && !o.userData.lkFloor) { o.userData.rrHide = true; o.visible = false; } }
      for (const o of M.meshes) { const r = o.userData.rr; if (r && r.ceil && !r.omit && !r.ovHide && o.userData.rrHide && !o.userData.lkStray && !o.userData.lkNoClip) { o.userData.rrHide = false; if (o.isInstancedMesh) o.visible = true; } }
      for (const o of LK.extra || []) { o.userData.rrHide = false; if (o.isInstancedMesh) o.visible = true; }   // untagged meshes: the modes rule never touches them
      if (LK.cards && (LK.clayOn || LK.gliding)) for (const o of LK.cards) { o.userData.rrHide = true; o.visible = false; }   // illusion cards: ground views only
      if (!LK.clayOn) return; const h = LK.cutH;
      for (const o of LK.visList || M.meshes) { const u = o.userData; if (u.rrHide) continue; if ((LK.revealing && u.lkColour) || u.lkPendant || u.lkStray || u.lkHideOv || u.lkMerged || (u.lkMinY > h + 0.01 && !(u.rr && u.rr.ceil) && !u.lkNoClip)) { u.rrHide = true; o.visible = false; } } };
    // array uniforms: three r169 re-flattens and re-uploads every array uniform on every material switch (no cache for
    // PureArrayUniform); the cove light lists alone are about 300 vec4 per upload (s44 profile: uniform4fv 1.9 s of an
    // 8 s glide window). An array tagged with _rrVer (rr2_cove.js bumps it per update, constant ones carry 0) is sent to a
    // program only when that program last got a different array or version.
    LK.arrCache = () => { const ps = R.info.programs; if (ps.length === LK._arrN) return; LK._arrN = ps.length;
      for (const pr of ps) { if (pr._rrArr) continue; pr._rrArr = true; const us = pr.getUniforms && pr.getUniforms(); if (!us) continue;
        for (const u of us.seq) { if (u.size === undefined || !('cache' in u) || u._rrWrap) continue; const f = u.setValue; u._rrWrap = true;
          u.setValue = function (gl, v, t) { if (v && v._rrVer !== undefined && v === this._rrV && v._rrVer === this._rrVer) return; this._rrV = v; this._rrVer = v && v._rrVer; f.call(this, gl, v, t); }; } } };
    if (+(F.lookarrcache ?? 1)) { const r0 = P.render.bind(P); P.render = (...a) => { LK.arrCache(); return r0(...a); }; }
    const freeze = (obj, name) => { if (!obj || !obj[name]) return; const f = obj[name].bind(obj); obj[name] = (...a) => LK.gliding && +(F.lookfreeze ?? 1) ? undefined : f(...a); };
    // the overview skips pieces under 2 px (0.75 px elsewhere): from 60 m up they are noise and cost a draw each
    // main Oct 21 (ground speed): at the ground, pieces of a unit the camera is not in are skipped when that unit is more
    // than 9 m away (walls, floors, ceilings, facades and pieces over 2.5 m stay), and the floor mirror pass skips every
    // unit interior except the one the camera stands in (the mirror is the corridor floor). Draw calls were the cost
    // (s52g: 5.5k calls, 170 to 225 ms a frame at the hero entrances, headless Intel).
    const unitPolys = (M.D.units || []).filter(u => u.poly).map(u => ({ id: u.id, poly: u.poly }));
    const dSeg = (px, py, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)); return Math.hypot(px - ax - t * dx, py - ay - t * dy); };
    const roomCull = (mirror) => { const L = P.cullList; if (!L || !+(F.lookroomcull ?? 1)) return; const c = P.camera.position; const gmOn = !!(LK.gmGroup && LK.gmGroup.children.length) && (!LK.deferGate || LK.deferGate.done) && !(c.y > 3 || LK.clayOn || LK.gliding);   // only once every program is compiled (merged meshes bypass the gate) if (LK.gmGroup && LK.gmGroup.visible !== gmOn) LK.gmGroup.visible = gmOn;
      if (c.y > 3 || LK.clayOn || LK.gliding) { if (LK._instU) for (const o of LK._instU) if (o.userData.lkRoomOff) { o.userData.lkRoomOff = false; o.visible = !o.userData.rrHide; } return; }
      const x = c.x, y = -c.z, far = {}; let inU = null;
      for (const u of unitPolys) { if (pointInPoly(x, y, u.poly)) { inU = u.id; far[u.id] = 0; continue; } let d = Infinity; for (let i = 0, j = u.poly.length - 1; i < u.poly.length; j = i++) d = Math.min(d, dSeg(x, y, u.poly[j][0], u.poly[j][1], u.poly[i][0], u.poly[i][1])); far[u.id] = d; }
      if (!LK._instU) { LK._instU = []; root.traverse(o => { const r = o.userData.rr; if (o.isInstancedMesh && !o.userData.rrOwn && r && r.unit) { if (!o.boundingSphere) o.computeBoundingSphere(); LK._instU.push(o); } }); }
      for (const o of LK._instU) { const u = o.userData.rr.unit; const off = u !== inU && far[u] > 9; if (off) { if (o.visible) { o.visible = false; o.userData.lkRoomOff = true; } } else if (o.userData.lkRoomOff) { o.userData.lkRoomOff = false; o.visible = !o.userData.rrHide; } }
      for (const e of L) { if (!e.o.visible) continue; if (gmOn && e.o.userData.lkGM) { e.o.visible = false; continue; } if (e.lkU === undefined) { const o = e.o, r = o.userData.rr, nm = o.userData.invName || o.name || ''; e.lkU = r && r.unit && !r.ceil && !o.userData.lkFloor && !COLOUR_RE.test(nm) && e.r <= 2.5 && e.c.y + e.r < 2.3 &&   /* furniture height only: walls, panels and lit backs stay (inspect sw5: illy read black from the corridor) */ !/glass|floor|wall|ceil/i.test(nm + ' ' + [].concat(o.material).map(m => m && m.name).join(' ')) ? r.unit : null; }
        const u = e.lkU; if (!u || u === inU) continue; if (far[u] > 9) e.o.visible = false; } };   // the mirror keeps them too (occluders for the glints)
    const cull0r = P.cull.bind(P), cull0 = (minPx, small, far) => { cull0r(minPx, small, far); roomCull(minPx === 2.5 && small === 12); };
    P.cull = (minPx, small = Infinity, far = Infinity) => LK.gliding ? cull0(Math.max(minPx, +(F.lookglidepx ?? 6)), Math.min(small, +(F.lookglidesmall ?? 20)), far) : cull0(LK.clayOn ? Math.max(minPx, +(F.lookminpx ?? 2)) : minPx, small, far);   // glides: pieces under 6 px and small ones beyond 20 m are skipped (ground parity untouched: only while gliding)
    freeze(P.floor, 'update'); freeze(P.cove, 'update');
    // s49: from above the floor mirror holds the page and the clay roofs, a grey wash over every glossy hero floor (the Gjelina
    // 'grey slab', #24); it is off (and not drawn: one scene pass less) whenever the camera is above 3 m or gliding
    if (P.floor && P.floor.update) { const fu = P.floor.update.bind(P.floor); P.floor.update = (...a) => { if (!FLOOR_MIRROR_ON.value) return; const fv = LK.foliage && LK.foliage.visible; if (fv) LK.foliage.visible = false;
      const tr = +(F.lookmirrornotr ?? 1) ? (LK._trList ||= (() => { const l = []; P.root.traverse(o => { if (o.isMesh && [].concat(o.material).some(m => m && m.transparent)) l.push(o); }); return l; })()) : [], was = []; for (const o of tr) if (o.visible) { o.visible = false; was.push(o); }
      try { return fu(...a); } finally { if (fv) LK.foliage.visible = true; for (const o of was) o.visible = true; } }; }   // leaves and glass stay out of the mirror   // leaves stay out of the mirror
    const sg0 = M.startGlide.bind(M);
    M.startGlide = (o) => {
      { const p0 = M.pose(); P.yaw = p0.yaw; P.pitch = p0.pitch; }   // the player's yaw and pitch are stale after the overview orbit and it writes them to the camera in the frames before the glide (s38: every fly-in started level, the row at the bottom edge)
      const go = () => { const pr = sg0(o); const g = M.glide; if (g && o.arc && +(F.lookarc ?? 1)) { const p = arcPath(M, g.from, g.to); if (p) { g.path = p; g.dur = Math.max(g.dur, 3.2); g.lookArc = true; } } return pr; };
      const down = o.arc && o.to && o.to.pos && o.to.pos.y < P.camera.position.y;
      const goW = () => { if (!o.arc || !+(F.lookwarm ?? 1)) return go(); LK.prewarm(o.to, down); return new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => res(M.mode === o.mode ? go() : undefined)))); };
      if (!o.arc || !LK.deferGate || LK.deferGate.done) return goW();
      return LK.prepare().then((ms) => { (LK.report.prepareMs ||= []).push(ms); return M.mode === o.mode ? goW() : undefined; });
    };
    // B7 look-at lock (camera-controls style setLookAt, eased): on the arc glides the camera aims at the entrance point (10 m out
    // along the ground view) the whole way, so the frame is the corridor and the facade growing, never the page; the lock eases in
    // over the first quarter going down and out over the last quarter going up
    const sgl0 = M.stepGlide.bind(M), lv = new THREE.Vector3(), lt = new THREE.Vector3();
    M.stepGlide = (dt) => { const g = M.glide; sgl0(dt); if (!g || !g.lookArc || M.glide !== g) return;
      const down = g.to.pos.y < g.from.pos.y, gp = down ? g.to : g.from; lt.copy(gp.pos).addScaledVector(lookVec(gp.yaw, down ? gp.pitch : Math.max(gp.pitch, 0.35)), 10);   // fly-out: aim below the horizon (looking up at the dome or ceiling as the cut opened gave a blank white top third, inspect sw5)
      // Mini Moto (refs_repos\mini_moto\app.js, read only): its follow cameras damp toward their subject with 1 - exp(-k dt), k 5 in / 1.6 out; same law on the aim point
      if (!g._lt) g._lt = down ? lt.clone() : gp.pos.clone().addScaledVector(lookVec(gp.yaw, gp.pitch), 10); else g._lt.lerp(lt, 1 - Math.exp(-(down ? 5 : (g.t < 0.3 ? 4 : 1.6)) * dt)); lt.copy(g._lt);   // fly-out starts on the real view and tilts down quickly
      const c = P.camera; lv.copy(lt).sub(c.position); const L = lv.length() || 1, yaw = Math.atan2(-lv.x, -lv.z), pitch = -Math.asin(THREE.MathUtils.clamp(lv.y / L, -1, 1));
      const t = g.t, ss = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); }, w = down ? ss(0, 0.25, t) : 1 - ss(0.75, 1, t);
      const cur = M.pose(); let pz = cur.pitch + (pitch - cur.pitch) * w;
      // inspect sw6 (#20): between about 12 m and the ceilings the camera levelled out over the cut-open rooms and the top 40 %
      // of the frame was the page. Above 3.2 m it now looks at least 36 degrees down (the horizon stays above the frame at the
      // 60 to 66 degree view), easing to its own view between 3.2 m and 1.6 m. Both ways.
      if (+(F.lookhorizon ?? 1)) { const yy = c.position.y, minP = yy >= 3.2 ? 0.62 : 0.62 - (3.2 - yy) / 1.6 * 1.3; if (pz < minP) pz = minP; }
      // long lens high up (casa-serra stations as the guide: fov 36 at about 46 m, 44 on the approach, 50 at the door, 60 in the
      // hall): the view angle follows the height, eased in from the start view and out to the end view, both ways
      let fv = c.fov; if (+(F.looklens ?? 1)) { const yy = c.position.y, gf = (down ? g.to : g.from).fov || 60, L = (a, b, u) => a + (b - a) * Math.min(1, Math.max(0, u));
        const lens = yy >= 40 ? 36 : yy >= 12 ? L(44, 36, (yy - 12) / 28) : yy >= 4 ? L(50, 44, (yy - 4) / 8) : L(gf, 50, (yy - 1.6) / 2.4);
        const wl = down ? ss(0, 0.15, t) : 1 - ss(0.85, 1, t); fv = c.fov + (lens - c.fov) * wl; }
      M.applyPose({ pos: c.position.clone(), yaw: cur.yaw + Math.atan2(Math.sin(yaw - cur.yaw), Math.cos(yaw - cur.yaw)) * w, pitch: pz, fov: fv }); };
    const st0 = M.step.bind(M);
    // shortcut: the overview's last frame before the loop goes idle sometimes comes out blank (transparent canvas, intermittent
    // since s1, cured by any later frame; root cause not found). Two more frames 250 ms after rendering stops repaint it.
    // Upgrade: find the bad frame (log composer target state on a blank readback) and drop this.
    { const rd0 = P.render.bind(P); let tm = 0, rep = 0; P.render = () => { rd0(); if (rep > 0) { rep--; return; } clearTimeout(tm); tm = setTimeout(() => { LK.report.repaints = (LK.report.repaints || 0) + 1; rep = 2; P.invalidate(2); }, 250); }; }
    // runs after the controller even when it is paused (P.step calls M.step first in every capture path)
    M.step = (dt) => { const r = st0(dt); LK.frame(); if (LK.folStep) LK.folStep(); return r; };
    LK.report.init = { ms: Math.round(performance.now() - T0), heroes: heroes.length, clay: clayList.length, merged: LK.report.merged, hiddenOv: ovHide.length, caps: capped.length, strays: minY.filter(o => o.userData.lkStray).length, gainCells: LK.gain?.cells || 0, programsAfterInit: R.info.programs.length };
    // B6 hover: a hero's name pill lifts its floor plate 10 cm (exponential damp, the maath damp law), soft shadow, clay
    // neighbours dim 20 %, outline and sign halo brighten, the pill pulses
    if (!document.getElementById('rrlk-style')) { const st = document.createElement('style'); st.id = 'rrlk-style'; st.textContent = '.rrlk-pulse{animation:rrlkp 1.1s ease-in-out infinite}@keyframes rrlkp{0%,100%{box-shadow:0 1px 6px rgba(0,0,0,.45),0 0 0 0 rgba(238,0,0,.6)}50%{box-shadow:0 1px 6px rgba(0,0,0,.45),0 0 0 8px rgba(238,0,0,0)}}'; document.head.append(st); }
    LK.hov = { id: null, cur: {} };
    const pillOf = (t) => t && t.closest && t.closest('.rr-ui .marker .pill, .rrm-label'), idOf = (el) => { const t = (el.textContent || '').trim().toLowerCase(); return t.includes('milos') ? 'milos' : t.includes('delmonico') ? 'delmonico' : t.includes('gjelina') ? 'gjelina' : null; };
    const hin = (e) => { const p = pillOf(e.target); if (!p) return; LK.hov.id = idOf(p); LK._pill = p; p.classList.add('rrlk-pulse'); }, hout = (e) => { const p = pillOf(e.target); if (!p || (e.relatedTarget && p.contains(e.relatedTarget))) return; if (LK._pill === p) { LK.hov.id = null; LK._pill = null; } p.classList.remove('rrlk-pulse'); };
    document.addEventListener('pointerover', hin); document.addEventListener('pointerout', hout); document.addEventListener('focusin', hin); document.addEventListener('focusout', hout);
    // public for ship's dock (rr_ui.js cut-away toggle and settings popover); the test helpers below only with RR_FLAGS.lookdebug
    globalThis.RRLook = { setCut: (h) => { LOOK.cut = +h; LK.frame(true); }, toggleCut: (on) => { LK.cutOff = !on; LK.frame(true); }, labels: (on) => { M.uiParts.labels = !!on; M.updateLabels(); } };
    if (+(F.lookdebug ?? 0)) Object.assign(globalThis.RRLook, {
      reveal: () => { LK.revealed = false; LK.frame(true); }, audit: () => LK.audit(), pitch: (deg) => { F.lookpitch = +deg; return M.overview({ intro: false }); }, hover: (id) => { LK.hov.id = id || null; }, get state() { return { cut: LOOK.cut, cutOff: !!LK.cutOff, clayOn: LK.clayOn, fade: LK.fade, revealing: !!LK.revealing, hover: LK.hov.id }; }, lk: LK });
    LK.frame(true);
    return LK.report.init;
  };

  // per frame: cut height from the camera, clay on or off, glide start and end
  LK.audit = () => {
    const out = { y: +P.camera.position.y.toFixed(2), mode: M.mode, planesOff: planes.every(p => p.constant >= OFF), groupsOn: [], clayMat: [], fallback: 0, hideDiff: [] };
    for (const [k, gp] of [['clay', LK.clayGroup], ['caps', LK.capGroup], ['heroClay', LK.heroClayGroup], ['deco', LK.deco]]) if (gp && gp.visible) out.groupsOn.push(k);
    const before = M.meshes.map(o => [o, !!o.userData.rrHide]); av0Ref(); for (const [o, b] of before) if (!!o.userData.rrHide !== b && out.hideDiff.length < 40) out.hideDiff.push([o.userData.invName || o.name, b, !!o.userData.rrHide]); M.applyVis();
    P.root.traverse(o => { if (!o.isMesh || o.userData.rrOwn) return; for (const m of [].concat(o.material)) { if (m && m === LK.mats.clay) { if (out.clayMat.length < 40) out.clayMat.push(o.userData.invName || o.name); } else if (m && m.userData && m.userData.fallback) out.fallback++; } });
    out.ok = out.planesOff && !out.groupsOn.length && !out.clayMat.length && !out.hideDiff.length; return out; };
  LK.frame = (force = false) => {
    const c = P.camera.position, y = c.y, ov = M.mode === 'overview' || M.mode === 'isolate';
    const now = performance.now(), dt = Math.min(0.1, (now - (LK._fn || now)) / 1000); LK._fn = now;
    const h = LK.cutOff ? OFF : y >= 2.9 ? LOOK.cut : y > 2.6 ? LOOK.cut + (2.9 - y) / 0.3 * 5 : OFF;   // inspect sw7: rising over 1.2 m left the rotunda walls above 4 m cut away (white top) at about 36 % of the fly-ins; below the lowest ceiling (2.95 m) the cut now opens within 0.3 m
    // B8 clay fades in and out by height (8 to 14 m) in the overview and in glides, both ways: dithered clay over the real pieces
    const act = ov || !!M.glide; let fd = act ? Math.min(1, Math.max(0, (y - 3) / 4)) : 0; fd = fd * fd * (3 - 2 * fd); if (!+(F.lookfade ?? 1)) fd = act && y > LOOK.clayY ? 1 : 0;
    LK.U.cut.value = h; LK.fade = fd; LK.mats.clay.uniforms.uFade.value = fd; const clayOn = fd >= 0.999;
    const g = !!M.glide;
    if (LK.U.neonPx) LK.U.neonPx.value = +(F.lookneonpx ?? 0.8) * 2 * Math.tan(THREE.MathUtils.degToRad(P.camera.fov) / 2) / Math.max(1, R.domElement.height);   // world size of one pixel at distance 1
    { const ul = M._ul || (LK._ul ||= ((LK._ulN = (LK._ulN || 0) + 1) % 30 === 1 ? P.root.getObjectByName('floor_underlay') : null)); if (ul && y > 3 && (ul.visible || !ul.userData.rrHide)) { ul.userData.rrHide = true; ul.visible = false; } }   // s64: the floor underlay disc showed black below the plinth at the start and end of every glide (modes keys it on its roof fade, 0 in restaurant mode)
    // ground speed (s55g: Delmonico entrance 166 -> 46 ms, Milos 148 -> 47 ms, headless Intel): at the ground, pieces under
    // 0.25 m radius beyond 15 m are skipped (player smallfar) and the floor mirror skips everything beyond 15 m (mirrorfar)
    if (+(F.lookgroundfar ?? 15) > 0 && !LK._userFar) { const gf = y < 3 && !g ? +(F.lookgroundfar ?? 15) : 0; if (F.smallfar !== gf) { F.smallfar = gf; F.mirrorfar = 0; } }   // mirrorfar off again (inspect sw5 C04: with far walls gone from the mirror the lamp glints showed unoccluded, white smears along the floor)
    if (+(F.lookmirroroff ?? 1)) { const mo = !g && y < 3 ? 1 : 0; if (FLOOR_MIRROR_ON.value !== mo) { FLOOR_MIRROR_ON.value = mo; P.invalidate(1); } }   // on again at the ground: the next render refreshes it before drawing
    if (g !== LK.gliding) { LK.gliding = g; LK._gHigh = y > 4; g ? glideStart() : glideEnd(); }
    else if (g && (y > 4) !== LK._gHigh) { LK._gHigh = y > 4; M.applyVis(); P.invalidate(1); }   // inspect: Milos front blank white beside the Delmonico entrance at the start of the fly-out
    const changed = LK.setPlanes(h, clayOn) || Math.abs(h - LK.cutH) > 1e-4; LK.cutH = h;
    if (clayOn && !g && P.dprGov && !P.lowresActive && !LK._ovDpr) { LK._ovDpr = true; P.dprGov.pause(); /* the governor's own resizes in the overview left a blank first overview (c32 smoke, s5, s6); held here, resumed on the ground */ const v = Math.min(+(F.lookdpr ?? 1.25), (P.tier && P.tier.dprMax) || devicePixelRatio || 1); /* fixed overview and glide ratio (main Oct 20) */ if (Math.abs(v - R.getPixelRatio()) > 0.01) P.setDpr(v); }
    if (!clayOn && !g && LK._ovDpr && y < 3) { LK._ovDpr = false; P.dprGov && P.dprGov.resume(R.getPixelRatio()); }
    // main Oct 21 ('lazer sharp'): when the camera has been still for 350 ms the view is drawn once at the rest ratio
    // (devicePixelRatio, at least 1, capped at RR_FLAGS.lookrestdpr, default 1.5); the first moving frame goes back to the
    // governor's (or the overview's) ratio. Rendering is on demand, so the sharp frame costs one frame per stop.
    if (+(F.lookrest ?? 1) && P.dprGov && !P.lowresActive) { const restDpr = Math.max(1, Math.min(globalThis.devicePixelRatio || 1, +(F.lookrestdpr ?? 1.5)));
      // camera only: the player's own _moveAt also moves while the background gate swaps materials (its pending and ready counts
      // are part of its change test), so a stop made soon after ready (ship c50: Milos) never counted as still
      { const e = P.camera.matrixWorld.elements, l = LK._camLast ||= new Float32Array(17); let mv = Math.abs(P.camera.fov - l[16]) > 1e-4; for (let k = 0; k < 16 && !mv; k++) if (Math.abs(e[k] - l[k]) > 1e-5) mv = true;
        if (mv) { l.set(e); l[16] = P.camera.fov; LK._camMoveAt = now; } }
      const want = !g && now - (LK._camMoveAt || 0) > 350;
      if (want && !LK._rest) { const cur = R.getPixelRatio(); if (cur < restDpr - 0.01) { LK._rest = { from: cur }; P.dprGov.pause(); P.setDpr(restDpr); P.invalidate(2); } }
      else if (!want && LK._rest) { const from = LK._rest.from; LK._rest = null; if (LK._hold) LK._hold = from; if (LK._ovDpr || g) P.setDpr(from); else P.dprGov.resume(from); } }
    if (LK._reapply > 0 && --LK._reapply === 0 && !g) M.applyVis();   // once more a few frames after a glide or the clay ends (stale hides seen at the first ground pose)
    if (clayOn !== LK.clayOn || force) { LK.clayOn = clayOn; if (!clayOn) LK._reapply = 3; setClay(clayOn); M.applyVis(); P.invalidate(2); }
    else if (changed && clayOn) M.applyVis();
    const capsOn = h < OFF && !M.isolated; if (capsOn !== LK.capsOn || force) { LK.capsOn = capsOn; LK.capGroup.visible = capsOn; P.invalidate(1); }
    if (changed) P.invalidate(1);
    if (M.veils) M.veils.visible = false;
    if (LK.U.domeCream) LK.U.domeCream.value = y > 9 ? 1 : 0;
    const sh9 = y > 9; if (sh9 !== LK._shellHid && LK.noclip) { LK._shellHid = sh9; M.applyVis(); P.invalidate(1); }
    const dh = LK.gliding && y > 9;   // inspect sw6: above 2.9 m the sky went and the chandelier hung in white; the dome and chandelier now stay through the cut transition, hidden only high up with the shell if (dh !== LK._domeHid && LK.noclip) { LK._domeHid = dh; if (dh) for (const o of LK.noclip) { o.userData.rrHide = true; o.visible = false; } else M.applyVis(); P.invalidate(1); }   // back on: the normal rule decides (s50: showing every rotunda piece popped the cream drum for 3 frames at the end of the fly-out)   // the shell stays hidden above 9 m (inspect: white blue disc popped over the rotunda at the end of the fly-out)
    if (P.scene.background && P.scene.background.isColor) { if (!LK._bgL) LK._bgL = ungrade('#f4f7f9'); if ((act || M.mode === 'isolate') && h < OFF && !P.scene.background.equals(LK._bgL)) { P.scene.background.copy(LK._bgL); P.invalidate(1); } }
    const cg = fd > 0 && !M.isolated; if (LK.clayGroup.visible !== cg) { LK.clayGroup.visible = cg; P.invalidate(1); }
    if (fd > 0 && fd < 1) P.invalidate(1);
    if (LK.mats.halo) for (const m of [LK.mats.halo, ...Object.values(LK.haloBy || {})]) m.visible = !LK.gliding;
    // B5 opening reveal (first time the overview is fully clay): the row rises 3 m from the plinth with a west to east stagger
    // (0.7 s spread, 0.8 s rise), then the heroes warm from clay to their own colour (1.5 to 2.0 s). Uniforms only.
    if (!LK.revealed && clayOn && M.mode === 'overview' && !M.isolated && +(F.lookreveal ?? 1)) { LK.revealed = true; LK._rt0 = now; LK.revealing = true; LK.U.rev.value.z = 1; LK.heroClayGroup.visible = true; M.applyVis(); }
    if (LK._rt0 != null) { const t = (now - LK._rt0) / 1000; LK.U.revT.value = t; const hf = Math.min(1, Math.max(0, (t - 1.5) / 0.5)); LK.mats.clayH.uniforms.uFade.value = 1 - hf;
      if (LK.revealing && t >= 1.5) { LK.revealing = false; M.applyVis(); }
      if (t >= 2.0 || !clayOn) { LK._rt0 = null; LK.revealing = false; LK.U.rev.value.z = 0; LK.U.revT.value = 10; LK.heroClayGroup.visible = false; M.applyVis(); } P.invalidate(1); }
    // hover: damp toward the target, lift the hero's meshes, dim the clay, brighten its outline, halo and shadow
    let mx = 0; const om = 2 / 0.22, e = Math.exp(-om * dt), pp = e * (1 + om * dt), pv = e * dt, vp = -e * om * om * dt, vv = e * (1 - om * dt);   // maath spring-core coefficients, critically damped, smoothTime 0.22 s
    for (const id of Object.keys(LK.heroBy || {})) { const tgt = clayOn && LK.hov.id === id ? 1 : 0, sp = LK.hov.cur[id] ||= { v: 0, w: 0 }, c0 = sp.v, d = c0 - tgt;
      let c1 = tgt + pp * d + pv * sp.w; sp.w = vp * d + vv * sp.w; if (Math.abs(c1 - tgt) < 1e-3 && Math.abs(sp.w) < 1e-3) { c1 = tgt; sp.w = 0; } sp.v = c1; mx = Math.max(mx, Math.max(0, c1));
      if (LK.rimBy && LK.rimBy[id]) LK.rimBy[id].uniforms.uOp.value = 2.5 * Math.max(0, c1);
      if (c1 !== c0) { for (const o of LK.heroBy[id]) { o.position.y = o.userData.lkY0 + 0.5 * c1; if (!o.matrixAutoUpdate) o.updateMatrix(); o.matrixWorldNeedsUpdate = true; }
        if (LK.lineBy && LK.lineBy[id]) { LK.lineBy[id].opacity = Math.min(1, LOOK.lineOpacity + 0.4 * c1); LK.lineBy[id].color.copy(LK.lineRed ||= LK.lineBy[id].color.clone()).lerp(LK.lineWarm ||= new THREE.Color(1.6, 0.75, 0.25), Math.max(0, Math.min(1, c1))); } if (LK.haloBy && LK.haloBy[id]) LK.haloBy[id].uniforms.uOp.value = 0.35 + 0.45 * c1;
        if (LK.shadowBy && LK.shadowBy[id]) LK.shadowBy[id].uniforms.uOp.value = 0.6 * Math.max(0, c1); if (LK.rimMesh && LK.rimMesh[id]) LK.rimMesh[id].position.y = 0.5 * c1; P.invalidate(1); } }
    LK.U.dim.value = 1 - 0.5 * mx;
    // an open info card (rr_ui, right side) shifts the overview left by half its width so it never covers the heroes
    const stg = LK._stage || (LK._stage = P.canvas.closest('.v3-stage')); const cw = P.canvas.clientWidth, chh = P.canvas.clientHeight;
    const want = clayOn && stg && stg.classList.contains('rr-card-open') && cw > 760 ? 160 : 0; const so = LK._shift || 0; let s1 = so + (want - so) * (1 - Math.exp(-dt * 7)); if (Math.abs(want - s1) < 0.5) s1 = want;
    if (s1 !== so || (s1 && LK._shW !== cw)) { LK._shift = s1; LK._shW = cw; if (s1) P.camera.setViewOffset(cw, chh, s1, 0, cw, chh); else P.camera.clearViewOffset(); P.invalidate(1); }
  };
  function setClay(on) {
    if (!LK.lists) return;
    LK.deco.visible = on;
    if (LK.gain) { LK.gain.tex.image.data.set(on ? LK.gain.lift : LK.gain.orig); LK.gain.tex.needsUpdate = true; }
  }
  // C10: full pixel ratio, frozen mirror and probes, deferred compiles paused while the camera moves
  function glideStart() {
    const dest = M.restaurantId && M.mode === 'restaurant' ? M.restaurantId : null; LK.glideKeep = dest || LK._lastHero || null; if (dest) LK._lastHero = dest; M.applyVis();
    if (P.aoPass && P.composer && +(F.lookaoglide ?? 1)) { const i = P.composer.passes.indexOf(P.aoPass); if (i >= 0) { LK._rp ||= new RenderPass(P.scene, P.camera); P.composer.passes[i] = LK._rp; LK._aoSwapped = i; } }
    LK._gt = { t: performance.now(), frames: [] };
    if (LK.deferGate && !LK.deferGate.done) LK.deferGate.stop();
    const gov = P.dprGov; if (gov && !P.lowresActive) { LK._hold = R.getPixelRatio(); gov.pause(); }
  }
  function glideEnd() {
    LK._reapply = 3;
    LK.glideKeep = undefined; M.applyVis();
    if (LK._aoSwapped != null) { P.composer.passes[LK._aoSwapped] = P.aoPass; LK._aoSwapped = null; }
    if (LK.deferGate && !LK.deferGate.done) LK.deferGate.start();
    const gov = P.dprGov; if (gov && LK._hold) { if (!LK._ovDpr) gov.resume(LK._hold); LK._hold = null; }
    P.invalidate(3);
  }
  return LK;
}

// B7: overview <-> ground as one shot: the drop happens over the corridor in front of the entrance, never through a roof.
// Cubic Bezier sky -> over the drop column -> 6 m over the drop point -> the entrance view (reversed for the way out).
function arcPath(M, from, to) {
  const down = to.pos.y < from.pos.y, g = down ? to : from, sky = down ? from : to;
  const f = lookVec(g.yaw, 0); f.y = 0; if (f.lengthSq() < 1e-6) return null; f.normalize();
  let D = null; for (const back of [2.5, 1.6, 0.8, 0]) { const p = g.pos.clone().addScaledVector(f, -back); if (insideWalk(p.x, -p.z, M.D.walk)) { D = p; break; } }
  if (!D) D = g.pos.clone();
  const low = D.clone(); low.y = g.pos.y + 4.5;
  const rn = M.D.graph && M.D.graph.nodes && M.D.graph.nodes.rotunda; if (rn && Math.hypot(D.x - rn[0], -D.z - rn[1]) < 11) low.y = Math.max(low.y, (M._drumTop || 8.5) + 1);
  const highCol = D.clone(); highCol.y = Math.max(14, sky.pos.y * 0.45);
  const mid = sky.pos.clone().lerp(highCol, 0.85);
  const pts = down ? [sky.pos.clone(), mid, low, g.pos.clone()] : [g.pos.clone(), low, mid, sky.pos.clone()];
  const bz = new THREE.CubicBezierCurve3(...pts); bz.arcLengthDivisions = 240; bz.updateArcLengths();
  return { len: bz.getLength(), at: (s) => ({ p: bz.getPointAt(Math.max(0, Math.min(1, s))) }), drop: D.toArray().map(v => +v.toFixed(2)) };
}
