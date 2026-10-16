// Lamps seen through rough glass, and the lamps of Matteo's light shaft (mtint agent, Oct 14).
//
// What Cycles does behind Matteo's B075 transom (verified by ray casts in the master .blend and in gjM2c 009.glb, which
// agree hit for hit): the reeded transom looks up into an open shaft between the storefront and the glow card
// (x 2.8 to 6.5, y -13.2 to -19.5, no ceiling between the card top at 3.45 m and the slab Mesh_2225 at 5.05 m). Three
// lamps sit in that shaft, all render visible, hidden from camera rays but visible to TRANSMISSION rays:
//   mt_intL0   AREA SQUARE 3 x 3 m at (3.49, -15.08, 3.00), facing down, 150 W, colour 1 0.859 0.717
//              radiance P / (pi A) = 5.31 4.56 3.81: the lower transom rays (pz rows 0.17 to 0.29) cross its square
//   Point      POINT r 0.15 at (3.047, -16.205, 3.90), 275.98 W, colour 0.785 0.854 0.828
//   Point.025  POINT r 0.15 at the same place, 121.43 W, colour 0.725 0.896 0.885
// Material_87 (the slab) is a plain textured Principled BSDF, emission 0: it is bright in the 360 only because the two
// Point lamps sit 1.15 m under it (irradiance 13 to 21 at the transom pick points, Cycles units). In the viewer the
// lamp emitters are not drawn at all, and the slab gets the two lamps at the live pool factor (lights = 0.25) plus the
// corridor capture, which never saw this shaft.
//
// Two fixes, both opt in (RR_FLAGS.lampcards, RR_FLAGS.shaftlamps) until A/B:
//  1. addLampCards: an emitter card per named lamp (area: its rectangle, point: its sphere) drawn ONLY into three's
//     transmission target, so it shows through reeded and rough panes, exactly like a Cycles light with camera
//     visibility off and transmission visibility on, and never in the main pass (no occlusion, no direct view).
//  2. addShaftLamps: the Point lamps' missing share (1 - live factor) added per pixel to the shaft surfaces only (world box
//     test in the shader), so the slab gets the full Cycles direct light without the shadowless live lights brightening
//     the corridor through the walls.
import * as THREE from 'three';

const C = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1); // Blender -> three axes
export const MATTEO_CARDS = ['mt_intL0', 'mt_intL1', 'cl_mtr_roomlight', 'Point', 'Point.025'];
const isTxTarget = (rt) => !!rt && rt.resolveDepthBuffer === false && rt.texture && rt.texture.generateMipmaps === true;

// Which lamps a corridor visitor sees through glass in Cycles (cards2 agent, Oct 14): rays from all 34 360 spots to every
// lamp emitter (centre plus four area samples) through the gjM2c triangles, spot lamps kept only inside their cone, and
// only lamps whose Cycles Transmission visibility is on (read from the master .blend: every Milos interior lamp, the
// Delmonico chandelier, globe, uplight, wine wash and d2_int lamps have it OFF, so they never show through glass, which
// the 360s confirm at B071, B078, B082 nz). Two paths, after rr2_reflect.js thinGlass:
//   tx:   behind a refracting pane (frostT: only cl_mt_reeded today), drawn into three's transmission target only
//   pane: behind a clear see through pane (no transmission target), drawn in the main pass only, after the panes,
//         added on top and scaled by that pane's transmittance (Gjelina smoked glass passes 0.38)
export const LAMP_CARD_TABLE = {
  matteos: { tx: ['mt_intL0', 'mt_intL1', 'cl_mtr_roomlight', 'Point', 'Point.025', 'cl_mtr_bkpendL0', 'cl_mtr_bkpendL2'] },
  gjelina: { pane: { T: 0.381, lamps: ['ri_baylight_gB', 'ri_baylight_gC', 'ri_light0', 'ri_light1', 'ri_light2', 'ri_light3', 'ri_light4'] } },
  yardbird: { pane: { T: 0.381, lamps: ['yb_light1', 'yb_light2', 'yb_light3', 'yb_light4', 'yb_plight1', 'yb_plight2', 'yb_plight3', 'yb_plight4'] } },
  sugarcane: { pane: { T: 0.676, lamps: ['downlight_5', 'downlight_6', 'downlight_11', 'downlight_12', 'downlight_31', 'downlight_32', 'si_pl_f0', 'si_pl_f1', 'si_pl_f2', 'si_pl_f3'] } },
  nomikai: { pane: { T: 0.676, lamps: ['nk_ap_l', 'nk_backled', 'nk_cabled', 'nk_logo_glow', 'cl_wh_dl0-1.2', 'cl_wh_dl1-1.2'] } },
  milos: { pane: { T: 0.97, lamps: ['PM_sclight', 'Point.022', 'Point.030', 'mi_bell_light0', 'mi_bell_light1', 'downlight_194', 'downlight_195', 'downlight_199', 'downlight_200', 'downlight_201', 'downlight_205', 'downlight_206', 'downlight_207'] } },
  delmonico: { pane: { T: 0.97, lamps: ['ent_alcove_light', 'ent_halo0', 'ent_halo1', 'ent_halo2', 'ent_halo3', 'ent_halo4', 'ent_halo5', 'ent_halo6', 'ent_halo7', 'ent_halo8', 'ceil_dlL19', 'ceil_dlL20', 'ceil_dlL21', 'ceil_dlL22', 'ceil_dlL23', 'ceil_dlL24', 'downlight_279'] } },
};
// RR_FLAGS.lampcards: 1 = Matteo's five (default), tx = every lamp behind the reeded panes, gj = tx plus the Gjelina and
// Yardbird lamps (the ones the 360s show through clear glass: B001 px, B007 nz, B008 nz), all = the whole table, or a
// comma list of room names and lamp names (a lamp named alone takes the tx path)
export function lampCardSpec(flag) {
  const f = String(flag), T = LAMP_CARD_TABLE, tx = [], pane = [];
  const room = (r) => { const e = T[r]; if (!e) return false; if (e.tx) tx.push(...e.tx); if (e.pane) pane.push(...e.pane.lamps.map(n => [n, e.pane.T])); return true; };
  if (f === '1') return { tx: MATTEO_CARDS, pane: [] };
  if (f === 'tx') room('matteos');
  else if (f === 'gj') ['matteos', 'gjelina', 'yardbird'].forEach(room);
  else if (f === 'all') Object.keys(T).forEach(room);
  else for (const n of f.split(',')) if (!room(n)) tx.push(n);
  return { tx, pane };
}
export function addLampCardsSpec(scene, lights, spec, opts = {}) {
  const out = addLampCards(scene, lights, spec.tx, opts);
  for (const [n, t] of spec.pane) out.push(...addLampCards(scene, lights, [n], { ...opts, pane: t }));
  return out;
}

export function addLampCards(scene, lights, names = MATTEO_CARDS, { gain = 1, pane = 0, mirrorRT = null } = {}) {
  const want = new Set(names); const out = [];
  for (const l of lights) {
    if (!want.has(l.name) || (l.type !== 'AREA' && l.type !== 'POINT' && l.type !== 'SPOT')) continue;
    const Mb = new THREE.Matrix4().fromArray(l.matrix.flat()).transpose(); const M = C.clone().multiply(Mb);
    const P = l.energy * ((l.node_strength && l.node_strength[0]) ?? 1) * gain; let geo, Lr;
    if (l.type === 'AREA') {
      const w = l.size || 1, h = (l.shape === 'RECTANGLE' || l.shape === 'ELLIPSE') ? (l.size_y || w) : w;
      const A = (l.shape === 'DISK' || l.shape === 'ELLIPSE') ? Math.PI * w * h / 4 : w * h;
      geo = (l.shape === 'DISK' || l.shape === 'ELLIPSE') ? new THREE.CircleGeometry(0.5, 24).scale(w, h, 1) : new THREE.PlaneGeometry(w, h);
      geo.rotateX(Math.PI); // a Blender area light emits along its local -Z; the plane's front face now looks that way
      Lr = P / (Math.PI * A);
    } else {
      const r = l.radius || 0.05; geo = new THREE.SphereGeometry(r, 16, 8);
      Lr = P / (4 * Math.PI) / (Math.PI * r * r); // sphere light radiance: intensity P / 4 pi over its disc pi r^2
    }
    const mat = new THREE.MeshBasicMaterial({ side: THREE.FrontSide, fog: false, toneMapped: false });
    const k = pane > 0 ? pane : 1;
    mat.color.setRGB(l.color[0] * Lr * k, l.color[1] * Lr * k, l.color[2] * Lr * k, THREE.LinearSRGBColorSpace);
    const mesh = new THREE.Mesh(geo, mat); mesh.name = 'lampcard:' + l.name; mesh.matrixAutoUpdate = false; mesh.matrix.copy(M);
    if (pane > 0) {
      // clear pane path: the pane is a blended see through layer, so the card is drawn in the main pass after the panes
      // (transparent, high render order), added on top of what the pane let through, depth tested against the opaque
      // scene (the panes write no depth) and never into the transmission target or the floor mirror
      mat.transparent = true; mat.blending = THREE.AdditiveBlending; mat.depthWrite = false; mesh.renderOrder = 1e6;
      mesh.onBeforeRender = (renderer) => { const rt = renderer.getRenderTarget(); mat.colorWrite = !isTxTarget(rt) && (!mirrorRT || rt !== mirrorRT); };
    } else
    // drawn in the transmission pass only: colour and depth off in every other pass (main, floor mirror)
    mesh.onBeforeRender = (renderer) => { const tx = isTxTarget(renderer.getRenderTarget()); mat.colorWrite = tx; mat.depthWrite = tx; };
    mesh.userData.noCollide = true; mesh.frustumCulled = true;
    scene.add(mesh); mesh.updateMatrixWorld(true);
    out.push({ name: l.name, type: l.type, radiance: +Lr.toFixed(2), path: pane > 0 ? 'pane' : 'tx' });
  }
  return out;
}

// box in Blender metres: the shaft above the glow cards, from the card top (3.45) to over the slab (5.3)
export const MATTEO_SHAFT = { box: [[0.5, -19.5, 3.45], [6.5, -13.2, 5.3]], lamps: ['Point', 'Point.025'], mats: /^(Material_87(\.004)?|Material_362)$/ };

export function addShaftLamps(root, lights, { box, lamps, mats } = MATTEO_SHAFT, { gain = 0.75 } = {}) {
  const L = lights.filter(l => lamps.includes(l.name) && l.type === 'POINT'); if (!L.length || gain <= 0) return { patched: 0 };
  const pos = [], I = [];
  for (const l of L) { const m = l.matrix; pos.push(new THREE.Vector3(m[0][3], m[2][3], -m[1][3]));
    const P = l.energy * ((l.node_strength && l.node_strength[0]) ?? 1) * gain / (4 * Math.PI); I.push(new THREE.Vector3(l.color[0] * P, l.color[1] * P, l.color[2] * P)); }
  const bmin = new THREE.Vector3(box[0][0], box[0][2], -box[1][1]), bmax = new THREE.Vector3(box[1][0], box[1][2], -box[0][1]);
  const bb3 = new THREE.Box3(bmin, bmax), ob = new THREE.Box3(); const done = new Set(); let n = 0; const N = L.length;
  root.traverse(o => {
    const m = o.material; if (!o.isMesh || !m || Array.isArray(m) || !m.isMeshStandardMaterial || !mats.test(m.name || '') || done.has(m)) return;
    ob.setFromObject(o); if (!ob.intersectsBox(bb3)) return; done.add(m); n++;
    const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
    m.onBeforeCompile = (sh, r) => {
      if (prev) prev.call(m, sh, r);
      sh.uniforms.uShaftMin = { value: bmin }; sh.uniforms.uShaftMax = { value: bmax }; sh.uniforms.uShaftP = { value: pos }; sh.uniforms.uShaftI = { value: I };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vShaftWP;')
        .replace('#include <project_vertex>', '#include <project_vertex>\n  vShaftWP = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vShaftWP; uniform vec3 uShaftMin, uShaftMax; uniform vec3 uShaftP[${N}]; uniform vec3 uShaftI[${N}];`)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
  if ( all( greaterThan( vShaftWP, uShaftMin ) ) && all( lessThan( vShaftWP, uShaftMax ) ) ) {
    vec3 nW = inverseTransformDirection( normal, viewMatrix );
    for ( int i = 0; i < ${N}; i ++ ) { vec3 Lv = uShaftP[ i ] - vShaftWP; float d2 = max( dot( Lv, Lv ), 0.0225 );
      reflectedLight.directDiffuse += uShaftI[ i ] * max( dot( nW, Lv * inversesqrt( d2 ) ), 0.0 ) / d2 * BRDF_Lambert( material.diffuseColor ); }
  }`);
    };
    m.customProgramCacheKey = () => (prevKey ? prevKey.call(m) : '') + '|shaft' + N;
    m.needsUpdate = true;
  });
  return { patched: n, lamps: L.map(l => l.name), gain };
}
