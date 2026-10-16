// Prop fixes at the Palazzo end (propfix agent, Oct 14). Opt in with RR_FLAGS.propfix=1 until A/B on the laptop.
// All positions are Blender coordinates (x, y, z up); three is (x, z, -y). Objects are matched by their Blender name
// (userData.invName, set by assignCaptureLighting before this runs).
//
// cull: triangles of an object whose world centroid lies in a box are removed (index rewrite, attributes untouched).
//   Mesh_1057 (Scene Collection, cl_nero_marquina) holds four round black two tier column bases. Two stand under the
//   cream round columns (Mesh_1056) at (32.31, 11.48) and (38.23, 7.10) and stay. The other two sit where Ryan's square
//   stone piers CL_PalPortal pp_base0/pp_shaft0 (38.04, 15.72) and pp_base1/pp_shaft1 (43.96, 11.34) now stand, so the
//   round base pokes out through the square plinth (sweep S51/S52/S53).
//   Mesh_1126 (Scene Collection, Material_381 stone) has a stray 6 triangle island (x 39.04..40.47, y 17.38..18.44,
//   z 0.04..0.84), a broken leftover pedestal face under the topiary urn cl_topiary_C: the semi transparent white block
//   by the cypress planter (S53y300p40, S52y000p40).
// pedestal: cl_topiary_C (mt32c) has no pedestal (topiaries A, B, D stand on cl_ped_A, _B, _D at z 0.04..0.88; C's urn
//   sits at z 0.88 on nothing but that stray island). A copy of cl_ped_A (mt31c) is placed under it, offset by the
//   difference of the two urn centres.
// hide: duplicate cafe chairs. The imported cafe sets overlap, so two chairs stand on the same spot facing opposite ways
//   (two backs, one seat inside the other): Mesh_1085 + Mesh_1086 duplicate Mesh_1077 + Mesh_1078 at (41.55, 14.6) and
//   Mesh_1100 + Mesh_1101 duplicate Mesh_1092 + Mesh_1093 at (43.2, 13.37).
//   Mullions (mt31c, mt_steel): cl_mt2_mull1.3_1.30_x2 is an exact copy of cl_mt2_mull1.3_7.00_x1 (same bbox at
//   x 32.03..32.15, y -1.33..-1.18, 54 faces each), and the old 6 face box mt2_mull1.3_7.00 sits inside its rebuild
//   cl_mt2_mull1.3_1.30_x1 (x 26.75..26.87, y -3.49..-3.33, within 4 mm): coplanar faces z fight. Not in the float agent's list.
// move: the walnut host podium mw_podium + mw_podium_top (CL_MatteoWedge) stands inside the limestone topiary pedestal
//   cl_ped_A, so urn A hangs over both (S49y240p40). Slide the podium 0.545 m along the tan wall pal_tanwall (direction
//   (0.928, 0.371)) away from the pedestal: it then clears cl_ped_A by 3 cm and the bin pal_bin by 11 cm.
//
// r3 guards (agent flagset3, Oct 14). apply_fixes_v2.py (agent_blendfix2) makes the same changes in the .blend (steps
// pier_bases, ped_sliver_and_ped_C, podium_move, dup_chairs, dup_mullions, rods_1495, capital_bump), so on r3 data every
// table here must do nothing, and on r2 data it must still work. Each part now checks its target first:
//   cull, rods: the triangles in the boxes are counted over every mesh of that name in the area (the 6 m split pieces
//     summed); 0 is already fixed, a count outside n (the blendfix ranges) is not the known defect; either way nothing goes.
//   hide: an object the .blend parked is simply absent (no change needed).
//   move: each object moves only while its world centre is at the master place (at, within 0.1 m in plan); once the
//     .blend moved it, or the port put it elsewhere, it stays.
//   copy: no copy while an object named like the copy (cl_ped_C) exists in this or any earlier area, and a copy made
//     earlier is taken out again when a later area brings the real one (ped A is in mt31c, urn C and a real ped C in mt32c).
//   propcol: a column is scaled only while its top is above 4.3 m (4.55 in the master; 3.75 once scaled).
//   propcap: an input is set only while it still holds the master value (from).
import * as THREE from 'three';

export const PROPFIX = {
  cull: [
    { name: 'Mesh_1057', boxes: [[37.15, 14.75, -0.1, 39.15, 16.75, 0.5], [43.05, 10.35, -0.1, 45.05, 12.35, 0.5]], n: [300, 450] },
    { name: 'Mesh_1126', boxes: [[39.0, 17.33, 0.0, 40.52, 18.5, 0.9]], n: [4, 8] },
  ],
  hide: ['Mesh_1085', 'Mesh_1086', 'Mesh_1100', 'Mesh_1101', 'cl_mt2_mull1.3_1.30_x2', 'mt2_mull1.3_7.00'],
  // at: master world centre in plan (Blender x, y) of each object, from the master export bboxes
  move: [{ names: ['mw_podium', 'mw_podium_top'], d: [-0.506, -0.202, 0], at: { mw_podium: [39.507, 2.2415], mw_podium_top: [39.507, 2.2415] }, tol: 0.1 }],
  copy: [{ src: 'cl_ped_A', name: 'cl_ped_C:propfix', real: 'cl_ped_C', d: [0.02, 15.445, 0] }],
};

// RR_FLAGS.propcol=1: the two Gjelina rotunda columns rot_colE (-16.78, -10.99) and rot_colW (-24.89, -16.14) (GJL_Rotunda,
// gjl_column + gjl_apron) are 4.55 m tall with a Tuscan capital from 4.10 (astragal) to 4.55 (abacus, radius 0.55). They
// stand on the rotunda ring, whose drum fascia rot_ceiling (rot_drum_cream) starts at 3.75 and soffit rot_soffit_ring at
// 3.85, so the whole capital is buried in the ring: from below the shaft runs straight into the cornice with no capital
// (S36y240p80) and from the side the echinus pokes out of the curved drum as a lumpy blob (S23, S30 p80). Scale both
// columns vertically about the floor by 3.75 / 4.55 so the abacus meets the drum underside.
// RR_FLAGS.proprods=1: bare drop rods. Mesh_1495 (Scene Collection, Material_107.003 dark bronze) holds 5 cm rods from
// the true ceiling (z 5.0) down through the 3.85 soffit to z 3.65 (Yardbird corridor) or 3.45 (south corridor) with
// nothing on them: no exported object in any area (gjM2c, gjR, gj_t*, mt*) and no triangle of gjM2c lies within 0.6 m
// below their ends (S13, S14, S20, S21, S22, S28, S29). Their lamp heads are not in the export; until Ryan finds them in
// the .blend, cull the rods.
export const RODS = { name: 'Mesh_1495', n: [300, 800], z: [3.3, 5.05], r: 0.1, xy: [[-31.33, -13.22], [-34.66, -14.58], [-37.9, -15.91], [-41.14, -17.23], [-43.91, -18.36], [-29.84, -39.89], [-28.85, -42.29], [-27.95, -44.51]] };

export const COLSCALE = { names: ['rot_colE', 'rot_colW'], sz: 3.75 / 4.55, top: 4.3 };

const b2t = ([x, y, z]) => new THREE.Vector3(x, z, -y);

function cullTris(o, boxes, out, countOnly = false) {
  const g = o.geometry, pos = g.attributes.position, idx = g.index, n = idx ? idx.count : pos.count;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), keep = [];
  let cut = 0;
  for (let i = 0; i < n; i += 3) {
    const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
    a.fromBufferAttribute(pos, i0).applyMatrix4(o.matrixWorld); b.fromBufferAttribute(pos, i1).applyMatrix4(o.matrixWorld); c.fromBufferAttribute(pos, i2).applyMatrix4(o.matrixWorld);
    const x = (a.x + b.x + c.x) / 3, y = -(a.z + b.z + c.z) / 3, z = (a.y + b.y + c.y) / 3; // Blender coords
    if (boxes.some(q => x > q[0] && x < q[3] && y > q[1] && y < q[4] && z > q[2] && z < q[5])) { cut++; continue; }
    keep.push(i0, i1, i2);
  }
  if (countOnly) return cut;
  if (!cut) return 0;
  if (g.groups && g.groups.length > 1) { out.skipped.push(o.userData.invName + ':groups'); return; } // multi material: leave it
  const ng = new THREE.BufferGeometry();
  for (const k of Object.keys(g.attributes)) ng.setAttribute(k, g.attributes[k]);
  ng.setIndex(keep); ng.boundingBox = null; ng.boundingSphere = null; o.geometry = ng; out.culled += cut;
  return cut;
}

// r3 gate: count over every mesh of the name first; cull only when the total is inside range
function gatedCull(meshes, boxes, range, out, tag) {
  if (!meshes.length) return;
  const k = meshes.reduce((a, o) => a + cullTris(o, boxes, out, true), 0);
  if (!k) { out.done.push(tag); return; }
  if (range && (k < range[0] || k > range[1])) { out.offcount.push(tag + ' ' + k + ' (expected ' + range.join('..') + ')'); return; }
  for (const o of meshes) cullTris(o, boxes, out);
}

// state kept across the areas of one player (ped C copies), on the report object so two players never share it
function propState(report) {
  if (!report._propfix) Object.defineProperty(report, '_propfix', { value: { names: new Set(), copies: new Map() }, enumerable: false });
  return report._propfix;
}

export function propFix(area, flags = {}, report = {}, inv = null) {
  const out = { culled: 0, hidden: 0, moved: 0, copied: 0, skipped: [], done: [], offcount: [] };
  area.updateMatrixWorld(true);
  const nameOf = (o) => o.userData.invName || o.name;
  const cull = new Map(PROPFIX.cull.map(r => [r.name, r])), hide = new Set(PROPFIX.hide);
  const move = new Map(); for (const r of PROPFIX.move) for (const n of r.names) move.set(n, r);
  const copy = new Map(PROPFIX.copy.map(r => [r.src, r]));
  const found = [], on = flags.propfix && flags.propfix !== '0', st = propState(report);
  if (on) {
    // names of this area (meshes and their named parents), then the copy targets that now exist for real
    area.traverse(o => { const n = o.userData.invName || o.name; if (n) st.names.add(n); });
    // and every exported or instanced inventory row (a linked duplicate such as the .blend's cl_ped_C may export as an instance)
    for (const r of (inv && inv.inventory) || []) if (r.name && (r.status === 'exported' || r.status === 'instanced')) st.names.add(r.name);
    for (const r of PROPFIX.copy) { const cs = st.copies.get(r.real); if (cs && st.names.has(r.real)) { for (const c of cs) if (c.parent) { c.parent.remove(c); out.uncopied = (out.uncopied || 0) + 1; }
      st.copies.delete(r.real); out.done.push('copy ' + r.real + ' exists, earlier copy removed'); } }
    area.traverse(o => { if (o.isMesh && !o.isInstancedMesh) { const n = nameOf(o); if (cull.has(n) || hide.has(n) || move.has(n) || copy.has(n)) found.push([o, n]); } });
  }
  { const per = new Map(); for (const [o, n] of found) if (cull.has(n)) (per.get(n) || per.set(n, []).get(n)).push(o);
    for (const [n, ms] of per) gatedCull(ms, cull.get(n).boxes, cull.get(n).n, out, 'cull ' + n); }
  const madeHere = new Set();   // a source with several primitives is copied whole within one area
  for (const [o, n] of found) {
    if (hide.has(n)) { o.parent.remove(o); out.hidden++; continue; }
    if (move.has(n)) {
      const r = move.get(n), at = r.at && r.at[n];
      if (at) { const bb = new THREE.Box3().setFromObject(o), cx = (bb.min.x + bb.max.x) / 2, cy = -(bb.min.z + bb.max.z) / 2;
        if (Math.hypot(cx - at[0], cy - at[1]) > (r.tol || 0.1)) { out.done.push('move ' + n + ' at (' + cx.toFixed(2) + ', ' + cy.toFixed(2) + '), not the master place'); continue; } }
    }
    if (copy.has(n)) {
      const r = copy.get(n);
      if (st.names.has(r.real) || (st.copies.has(r.real) && !madeHere.has(r.real))) { out.done.push('copy ' + r.real + (st.names.has(r.real) ? ' exists' : ' already made')); continue; }
    }
    if (move.has(n) || copy.has(n)) {
      const d = b2t(move.has(n) ? move.get(n).d : copy.get(n).d);
      const W = new THREE.Matrix4().makeTranslation(d.x, d.y, d.z).multiply(o.matrixWorld);
      const L = o.parent.matrixWorld.clone().invert().multiply(W);
      if (move.has(n)) { L.decompose(o.position, o.quaternion, o.scale); o.matrixAutoUpdate = true; o.updateMatrixWorld(true); out.moved++; }
      else {
        const c = new THREE.Mesh(o.geometry, o.material); c.name = o.name + ':propfix'; c.userData = { ...o.userData, invName: copy.get(n).name };
        L.decompose(c.position, c.quaternion, c.scale); c.renderOrder = o.renderOrder; c.castShadow = o.castShadow; c.receiveShadow = o.receiveShadow;
        o.parent.add(c); c.updateMatrixWorld(true); out.copied++;
        const rl = copy.get(n).real; madeHere.add(rl); (st.copies.get(rl) || st.copies.set(rl, []).get(rl)).push(c);
      }
    }
  }
  if (flags.proprods && flags.proprods !== '0') {
    const boxes = RODS.xy.map(([x, y]) => [x - RODS.r, y - RODS.r, RODS.z[0], x + RODS.r, y + RODS.r, RODS.z[1]]), rods = [];
    area.traverse(o => { if (o.isMesh && !o.isInstancedMesh && nameOf(o) === RODS.name) rods.push(o); });
    gatedCull(rods, boxes, RODS.n, out, 'rods ' + RODS.name);
  }
  if (flags.propcol && flags.propcol !== '0') {
    const S = new THREE.Matrix4().makeScale(1, COLSCALE.sz, 1), cols = [];
    area.traverse(o => { if (o.isMesh && !o.isInstancedMesh && COLSCALE.names.includes(nameOf(o))) cols.push(o); });
    // the guard reads the highest top over all meshes of a name (shaft and apron primitives move together)
    const tops = new Map(); for (const o of cols) tops.set(nameOf(o), Math.max(tops.get(nameOf(o)) ?? -Infinity, new THREE.Box3().setFromObject(o).max.y));
    for (const [nm, t] of tops) if (!(t > COLSCALE.top)) out.done.push('propcol ' + nm + ' top ' + t.toFixed(2));
    for (const o of cols) { if (!(tops.get(nameOf(o)) > COLSCALE.top)) continue;
      const L = o.parent.matrixWorld.clone().invert().multiply(S.clone().multiply(o.matrixWorld)); L.decompose(o.position, o.quaternion, o.scale); o.updateMatrixWorld(true); out.colScaled = (out.colScaled || 0) + 1; }
  }
  (report.propFix ||= []).push(out);
  return out;
}

// RR_FLAGS.propcap=1: cl_col_capital (the rotunda and stair column capitals rs_colR*, rs_edgepair*, CL_RealStairs) fakes
// carving with a Voronoi (scale 28) plus Noise (scale 40, detail 8) height into a Bump of strength 0.9 at 2 cm. Cycles
// averages that over 4096 samples; one sample per pixel turns it into the noisy sponge blobs of the sweep (S01..S05 p80).
// Calmer inputs, applied to the Blender graph before it is compiled.
export const MAT_INPUTS = {
  cl_col_capital: { 'Bump': { Strength: 0.3 }, 'Noise Texture': { Detail: 2 } },
};
// the master values: an input is changed only while it still holds them (r3 has 0.3 and 2 from the .blend)
export const MAT_FROM = { cl_col_capital: { 'Bump': { Strength: 0.9 }, 'Noise Texture': { Detail: 8 } } };
export function propMatOverrides(materials, flags = {}, report = {}) {
  if (!flags.propcap || flags.propcap === '0' || !materials) return 0;
  let n = 0;
  for (const [mat, nodes] of Object.entries(MAT_INPUTS)) {
    const g = materials[mat]?.graph; if (!g) continue;
    for (const node of g.nodes) { const set = nodes[node.name]; if (!set) continue; node.in ||= {}; const from = MAT_FROM[mat]?.[node.name] || {};
      for (const [k, v] of Object.entries(set)) { const cur = node.in[k];
        if (typeof cur === 'number' && k in from && Math.abs(cur - from[k]) > 1e-3) { ((report.propMatDone ||= [])).push(mat + ' ' + node.name + ' ' + k + '=' + cur); continue; }
        node.in[k] = v; n++; } }
  }
  (report.propMat ||= []).push(n); return n;
}
