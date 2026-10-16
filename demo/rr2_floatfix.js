// Floating fixture fixes (float agent, Oct 14). Both opt in until A/B on the laptop.
//
// RR_FLAGS.fasciafill=1: Matteo's door transom (cl_mtr_tr_glass, reeded, with its steel frame cl_mtr_tr_top, _bot, _L, _M, _R)
// sits under a hole in the storefront head and fascia. The head and fascia stop at Blender u = -7.317 (cl4_head, cl4_fascia)
// and start again at u = -5.536 (cl_mtg_head, cl_mtg_fascia), u being the distance along the facade (0.9258, 0.3779). The
// 1.78 m x 0.52 m gap (z 3.33 to 3.85, Blender x about -1.70 to -0.12, y about -15.0 to -14.4) opens into Matteo's open
// light shaft, so from the corridor the reeded transom reads as a ribbed linear fixture floating under the soffit. Ray casts
// through the gjM2c and gjR geometry: nothing within 3 m behind the facade line there at z 3.6. The fix copies
// cl_mtg_head and cl_mtg_fascia (same geometry, same material, same lighting data) and stretches each copy along the
// facade onto the gap.
//
// RR_FLAGS.dedupe=1: objects exported twice at the same place (bbox match within 3 cm, gjR inventory), which z fight:
// the RealBottles set over the old Scene Collection bottles Mesh_637..Mesh_703 (the old copies go), the mullion
// mt2_mull-11.4_-11.40 (exact copy of mt_mull-15.7_-11.40) and the wall mbf_w53 (exact copy of mbf_w44).
import * as THREE from 'three';

export const DEDUPE = new Set(['Mesh_637', 'Mesh_638', 'Mesh_639', 'Mesh_640', 'Mesh_641', 'Mesh_642', 'Mesh_643', 'Mesh_644', 'Mesh_645', 'Mesh_646', 'Mesh_647', 'Mesh_648', 'Mesh_649', 'Mesh_650', 'Mesh_651', 'Mesh_652', 'Mesh_653', 'Mesh_654', 'Mesh_655', 'Mesh_656', 'Mesh_657', 'Mesh_661', 'Mesh_662', 'Mesh_663', 'Mesh_664', 'Mesh_665', 'Mesh_666', 'Mesh_667', 'Mesh_668', 'Mesh_669', 'Mesh_670', 'Mesh_671', 'Mesh_672', 'Mesh_673', 'Mesh_674', 'Mesh_675', 'Mesh_676', 'Mesh_677', 'Mesh_678', 'Mesh_679', 'Mesh_680', 'Mesh_681', 'Mesh_685', 'Mesh_686', 'Mesh_687', 'Mesh_688', 'Mesh_689', 'Mesh_690', 'Mesh_691', 'Mesh_692', 'Mesh_693', 'Mesh_694', 'Mesh_695', 'Mesh_696', 'Mesh_697', 'Mesh_698', 'Mesh_699', 'Mesh_700', 'Mesh_701', 'Mesh_702', 'Mesh_703', 'mbf_w53', 'mt2_mull-11.4_-11.40']);

// facade direction in three axes (Blender (x, y) -> three (x, -z)): u = 0.9258 x - 0.3779 z
const D = new THREE.Vector3(0.9258, 0, -0.3779).normalize();
// source u range (cl_mtg_head and cl_mtg_fascia) and the gap, with 1 cm overlap at each end
export const FASCIA_GAP = { src: [-5.536, -3.807], dst: [-7.327, -5.526], names: ['cl_mtg_head', 'cl_mtg_fascia'] };

function stretchAlong(d, [t0, t1], [s0, s1]) {
  const a = (s1 - s0) / (t1 - t0), b = s0 - a * t0;
  // x' = x + ((a - 1) (d . x) + b) d
  const m = new THREE.Matrix4().set(
    1 + (a - 1) * d.x * d.x, (a - 1) * d.x * d.y, (a - 1) * d.x * d.z, b * d.x,
    (a - 1) * d.y * d.x, 1 + (a - 1) * d.y * d.y, (a - 1) * d.y * d.z, b * d.y,
    (a - 1) * d.z * d.x, (a - 1) * d.z * d.y, 1 + (a - 1) * d.z * d.z, b * d.z,
    0, 0, 0, 1);
  return m;
}

export function floatFix(area, flags = {}, report = {}) {
  const out = { fascia: 0, dropped: 0 };
  area.updateMatrixWorld(true);
  const nameOf = (o) => o.userData.invName || o.name;
  if (flags.fasciafill && flags.fasciafill !== '0') {
    const A = stretchAlong(D, FASCIA_GAP.src, FASCIA_GAP.dst), src = [];
    area.traverse(o => { if (o.isMesh && !o.isInstancedMesh && FASCIA_GAP.names.includes(nameOf(o))) src.push(o); });
    for (const o of src) {
      const c = new THREE.Mesh(o.geometry, o.material); c.name = o.name + ':gapfill'; c.userData = { ...o.userData, invName: nameOf(o) + ':gapfill' };
      c.matrixAutoUpdate = false; c.renderOrder = o.renderOrder; c.castShadow = o.castShadow; c.receiveShadow = o.receiveShadow;
      const W = A.clone().multiply(o.matrixWorld);
      c.matrix.copy(o.parent.matrixWorld).invert().multiply(W); o.parent.add(c); c.updateMatrixWorld(true); out.fascia++;
    }
  }
  if (flags.dedupe && flags.dedupe !== '0') {
    const drop = []; area.traverse(o => { if (o.isMesh && !o.isInstancedMesh && DEDUPE.has(nameOf(o))) drop.push(o); });
    for (const o of drop) o.parent.remove(o); out.dropped = drop.length;
  }
  // RR_FLAGS.roomdiag=1 (diagnostic A/B, not a fix): hide the generated unit shells that exist only in the gjR export
  // (restaurant-row-top-rooms.blend; absent from gjM2c): ROOM_1xx walls and ceilings (r101_f46, r104_ceil42, ...) and the
  // MBF_walls pieces (mbf_w90, ...). They stand on the unit polygon edges, so where an edge runs on a corridor wall they
  // z fight with it (r104_f38 velour wainscot 0 to 1.2 m and r104_f39 plaster 1.2 to 3.4 m along x -20.7..-18.8,
  // y -36.0..-30.4, beside sweep point S00) and their 3.3 m ceilings (r102_ceil38, r104_ceil42) sit under the 3.85 m soffit.
  if (flags.roomdiag && flags.roomdiag !== '0') {
    const re = /^(r1\d\d_(f\d+|ceil\d+)|mbf_w\d+)$/; const drop = []; area.traverse(o => { if (o.isMesh && !o.isInstancedMesh && re.test(nameOf(o))) drop.push(o); });
    for (const o of drop) o.parent.remove(o); out.roomHidden = drop.length;
  }
  (report.floatFix ||= []).push(out);
  return out;
}
