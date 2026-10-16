// ceilfix (agent ceilfix, Oct 14, RR_FLAGS.ceilfix bit 8): coplanar ceiling sheets.
// rot_soffit_south (29 faces, 1008 m2) and rot_soffit_ring (4 faces, 199 m2) are single sheets at z 3.85 whose faces
// point UP; the viewer draws them two sided (Cycles ignores backface culling), so from the corridor they are the ceiling.
// Where a down facing soffit was modelled on the same plane the two z fight (0.1 m raster of the gjM2c export,
// agent_ceilfix/tools/copl.mjs, dz under 0.3 mm):
//   rot_soffit_south with ceil_soffit (20 m2, Blender x -15.8 to -0.9, y -16.4 to -9.2: Milos and Matteo fronts),
//     nk_soffit_a (32 m2, Nomikai), cl_soffit_patch_P5old and cl_soffit_patch_P5b (Starbucks, Voltaire), and
//     vp_bulkhead 1 cm under it (24 m2, Voltaire portal);
//   rot_soffit_ring with nk_soffit_d (40 m2) and nk_soffit_a (20 m2), in front of Yardbird.
// The two pieces take different captures and light (separate material clones, separate 6 m cells), so the fight draws
// per triangle patches, stepped outlines and streaks (sweep: S05, S06, S13, S18 to S21, S24 to S27, S31, S32).
// Lifting the up facing sheet a few mm lets the down facing piece win wherever both exist and changes nothing where the
// sheet is alone. Blender fix: move these two sheets up 5 mm, or cut the overlapped parts out of them.
import * as THREE from 'three';
export const CEIL_LIFT = { rot_soffit_south: 0.006, rot_soffit_ring: 0.006 };
// r3 guard (agent flagset3, Oct 14): apply_fixes_v2.py (step ceil_lift) lifts both sheets 5 mm in the .blend. A second
// lift here would put the sheet 11 mm up and uncover cove band bottoms (see the 1.8 mm ceiling cap in rr2_player.js).
// A sheet is lifted only while its world box (Blender z, three y) is still flat at the master level CEIL_AT within
// CEIL_TOL; a sheet found anywhere else is left alone and reported in ceilLiftSkip.
export const CEIL_AT = { rot_soffit_south: 3.85, rot_soffit_ring: 3.85 }, CEIL_TOL = 0.002;
// lift in Blender z (three y) every mesh of the area whose inventory row (by glTF node, walking up the parents) is in the
// table; run before the big sheets are split (rr2_player.js), so the pieces inherit it
export function applyCeilLift(area, inv, report = {}, table = CEIL_LIFT) {
  const byNode = new Map((inv && inv.inventory || []).filter(r => r.node).map(r => [r.node, r.name]));
  area.updateMatrixWorld(true); const hits = [], bb = new THREE.Box3();
  area.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh) return;
    let n = o, nm = null; while (n && !(nm = byNode.get(n.name))) n = n.parent;
    nm = nm || o.userData.invName; const dy = nm && table[nm]; if (!dy) return;
    const at = table === CEIL_LIFT ? CEIL_AT[nm] : undefined;
    if (at !== undefined) { bb.setFromObject(o); if (Math.abs(bb.min.y - at) > CEIL_TOL || Math.abs(bb.max.y - at) > CEIL_TOL) { (report.ceilLiftSkip ||= []).push(nm + ' at ' + bb.min.y.toFixed(4) + '..' + bb.max.y.toFixed(4)); return; } }
    const w = o.getWorldPosition(o.position.clone()); w.y += dy;
    o.position.copy(o.parent ? o.parent.worldToLocal(w) : w); o.updateMatrixWorld(true); hits.push(nm);
  });
  (report.ceilLift ||= []).push(...hits);
  return hits.length;
}
