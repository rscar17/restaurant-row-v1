// Floating leftovers of the original model (floatfix2 agent, Oct 14). Opt in: RR_FLAGS.floatfix2=1.
//
// The objects named Mesh_<n> (export group "Scene Collection") are the original imported model: each one is a large merged
// mesh that spans the whole row (Mesh_1490 runs from x -52 to 25). The row was rebuilt on top of it (mt_, mt2_, pal_, pc_,
// ceil_ objects) and the leftovers that showed were trimmed face by face in Blender (FACTS: Mesh_1490, 1491, 1494, 1570).
// Some pieces were missed. Where the rebuilt storefront line moved (the mt2 front runs diagonally, normal (-0.38, 0.93);
// the original front ran along Blender y = -6.97) and where the ceiling was raised (Palazzo approach, coffers at 5.0 to
// 5.45), they now hang in the corridor. Every piece below was named by ray picks on the sweep renders (sweep7..9, volt3)
// against the decoded live GLBs, and each box was checked to hold only that piece (a triangle goes only when all three of
// its vertices are inside the box, so the large meshes keep everything else).
//
// Boxes are Blender coordinates [xmin, ymin, zmin, xmax, ymax, zmax]. RR_FLAGS.floatfix2skip=group,group leaves groups in.
//
// r3 guard (agent flagset3, Oct 14): apply_fixes_v2.py (agent_blendfix2) cuts the same pieces out of the .blend (steps
// slatbar, sconce, palazzo_ring, rods_1494, gold_disc), and the floorplan port swapped the mesh data of Mesh_1490, 1493,
// 1495, 1499 and 1510 for the top file's shell cut versions and moved some blocks. The boxes below are master coordinates,
// so on r3 data they must cut nothing, and they must never cut whatever else a swapped or moved mesh now holds there.
// Each entry carries n, the triangle count range its box held in the master export (the blendfix ranges where it has
// one). The triangles in each entry's box are counted over every mesh of that name in the area first (split pieces and
// primitives summed): 0 means already fixed (reported in floatfix2.done), a count outside n means the geometry there is
// not the known defect (reported in floatfix2.offcount, nothing cut), and only an entry inside its range is cut.
// RR_FLAGS.floatfix2nogate=1 restores the old ungated behaviour.
import * as THREE from 'three';

export const FLOAT_CLIP = [
  // Ryan's diagonal "linear fixture" (S40, S41, S42, S43, S39): a 2.27 m x 0.11 m bar 7 cm under ceil_soffit (z 3.45 to 3.49),
  // the old fascia trim of the original front at y -6.95; it crosses the new mt2 head diagonally. 8 triangles.
  // r8f data (agent vmisc, Oct 15): the same bar is 32 triangles in mt20c (offline count on data_plan8, vmisc tools/ffcount.mjs),
  // so the 4..16 gate left it in place (sweep rv05 6, W047y240p40, the dark rods under the soffit). n8 is the gate with
  // RR_FLAGS.floatfix2r8=1.
  { group: 'slatbar', name: 'Mesh_1490', box: [16.60, -7.05, 3.40, 19.00, -6.85, 3.52], n: [4, 16], n8: [4, 40] },
  // Ryan's floating wall sconce (S37, S38, S39, S40, S41, S43): the original Sugarcane sconce at (13.7, -6.95), 1.7 m in front
  // of the rebuilt mt2 glass (mt2_glass-11.4), top poking through the soffit. Backplate Mesh_1493 (12), tube Mesh_1499 (96),
  // spiky crown Mesh_1495 (1056) and Mesh_1490 (48), the white quad Mesh_1504 (2).
  { group: 'sconce', name: 'Mesh_1493', box: [13.30, -7.12, 2.05, 14.02, -6.75, 3.62], n: [6, 24] },
  { group: 'sconce', name: 'Mesh_1499', box: [13.30, -7.12, 2.05, 14.02, -6.75, 3.62], n: [60, 130] },
  { group: 'sconce', name: 'Mesh_1495', box: [13.30, -7.12, 2.05, 14.02, -6.75, 3.62], n: [700, 1400] },
  { group: 'sconce', name: 'Mesh_1490', box: [13.30, -7.12, 2.05, 14.02, -6.75, 3.62], n: [24, 80] },
  { group: 'sconce', name: 'Mesh_1504', box: [13.30, -7.12, 2.05, 14.02, -6.75, 3.62], n: [1, 4] },
  // Floating wooden shelf bar (S40, S42, S43): original ledge Mesh_1510 at z 0.79 to 0.85 that pierces the new
  // mt2_frost-11.4 lower panel and sticks out into the corridor. 96 triangles.
  { group: 'shelf', name: 'Mesh_1510', box: [13.10, -9.75, 0.75, 14.82, -8.45, 0.88], n: [48, 144] },
  // Palazzo coffer tubes (S49, S52, S53): the original square coffer ring, rotated 45 degrees against the rebuilt Palazzo
  // ceiling (pal_ceil_fill 5.45, pc_sof*), running diagonally through the hanging sign. Plaster ring Mesh_2229 (all 2880
  // triangles, mt31c) and its emissive strip, one component of Mesh_2237 (2880 of 5772; the rest is other ceilings).
  { group: 'palazzo', name: 'Mesh_2229', box: [32.50, 7.20, 4.90, 43.90, 15.70, 5.12], n: [2000, 3600] },
  { group: 'palazzo', name: 'Mesh_2237', box: [32.50, 7.20, 4.90, 43.90, 15.70, 5.12], n: [2000, 3600] },
  // Black speaker posts hanging in the ceiling void on the Palazzo approach (S47 and the S44 boxes): original Mesh_1491
  // posts z 3.25 to 4.31 under nothing (their frame sits in the void at 3.82 to 4.30). 34 + 68 + 34 + 12 triangles.
  { group: 'posts', name: 'Mesh_1491', box: [27.75, -1.955, 3.20, 27.99, -1.755, 4.35], n: [1, 200] },
  // revB: the second post box stops at z 3.81, under the frame (3.82 to 4.30) that is wanted geometry there
  { group: 'posts', name: 'Mesh_1491', box: [29.78, -0.450, 3.20, 30.00, -0.270, 3.81], n: [1, 200] },
  { group: 'posts', name: 'Mesh_1491', box: [31.81, 1.050, 3.20, 32.05, 1.250, 4.35], n: [1, 200] },
  { group: 'posts', name: 'Mesh_1491', box: [33.81, 2.545, 3.20, 34.05, 2.745, 4.35], n: [1, 200] },
  // Black rod stubs above the storefront heads (S37, S38, S39): original hanger rods Mesh_1494, 3 cm thick, z 3.44 (head
  // top) to 4.12, nothing hangs from them; 13 cm show between the head and the soffit. 40 triangles each.
  // revB: the rods box at 1.42, -13.66 was dropped (a dead entry per review B)
  { group: 'rods', name: 'Mesh_1494', box: [6.01, -11.785, 3.40, 6.11, -11.685, 4.15], n: [20, 80] },
  { group: 'rods', name: 'Mesh_1494', box: [9.19, -10.485, 3.40, 9.29, -10.385, 4.15], n: [20, 80] },
  { group: 'rods', name: 'Mesh_1494', box: [10.39, -9.995, 3.40, 10.49, -9.895, 4.15], n: [20, 80] },
  { group: 'rods', name: 'Mesh_1494', box: [18.66, -7.05, 3.40, 18.76, -6.95, 4.15], n: [20, 80] },
  // Gold disc floating inside the Voltaire entry (volt3 VN): a 15 cm stool seat of Mesh_1531 at z 1.23 to 1.26 with no
  // legs or base under it. 92 triangles.
  { group: 'disc', name: 'Mesh_1531', box: [-5.08, -28.69, 1.20, -4.89, -28.50, 1.28], n: [40, 140] },
  // r7 plan data (agent fixV, Oct 15). Boxes in r7 coordinates, measured on the loaded data_plan7 meshes (connected
  // components of the live geometry, gputest diagtri). Their own groups, so floatfix2skip=posts does not keep them.
  // Off unless RR_FLAGS.floatfix2r7=1: agent fixM parks the same pieces in the .blend (fixM.py M1 rail_east, M2), so
  // these are only a stopgap for r7 data; on r8 data they count 0 and report as done.
  // Mesh_1491 (mt21c, Material_109.001): what is left of the old track frame after the port, three rails at z 3.82 to 4.30
  // (204 to 208 triangles each, x 25.9 to 30.0, y -3.45 to -0.26) and two posts down to z 3.25 (68 and 34). The rebuilt
  // corridor soffit is at 3.57, so the frame and posts hang in view under the soffit edge and through the ceiling gap
  // (sweep rv06 0, W057y300p80; rv06 7, W065). 718 triangles in r7; agent fixM parks it for r8 (count 0, done).
  { group: 'track7', name: 'Mesh_1491', box: [25.80, -3.55, 3.20, 30.15, -0.15, 4.40], n: [600, 800], r7: 1 },
  // Mesh_2226 (mt31c, Material_107): one brass rod 8 cm across, z 4.65 to 5.24, under pal_ceil_fill (5.45) between the
  // Palazzo and Venetian hanging signs, nothing attached (sweep rv07 0, W067y000p80; rv08 3).
  { group: 'rod7', name: 'Mesh_2226', box: [34.38, 11.43, 4.60, 34.55, 11.60, 5.30], n: [1, 600], r7: 1 },
  // Mesh_2227 (mt31c, Material_107): the same rod again at (38.25, 8.65), z 4.7 to 5.2 (inventory bbox; not yet in fixM.py)
  { group: 'rod7', name: 'Mesh_2227', box: [38.15, 8.55, 4.60, 38.35, 8.75, 5.30], n: [1, 600], r7: 1 },
  // r8f data (agent vmisc, Oct 15). Off unless RR_FLAGS.floatfix2r8=1; the .blend side is vmisc_fix.py V1 (park), after
  // which this entry counts 0 and reports done. Mesh_1122 (mt31c, Material_87, 132 faces): the original model's diagonal
  // linear fixture, 2.7 m from (35.0, 11.4) to (37.7, 8.7) at z 3.19 to 3.78, hangs under and through the rce_ceil soffit
  // (3.57) beside the Venetian sign with nothing holding it (sweep rv08 3, W080y060p40, still on r8f per verify8).
  { group: 'bar8', name: 'Mesh_1122', box: [34.90, 8.60, 3.10, 37.80, 11.50, 3.90], n: [60, 600], r8: 1 },
];

// Remove the listed triangles from the meshes of one loaded area (called before root.add(area)). Blender (x, y, z) is
// three (x, z, -y). Returns the number of triangles removed per group into report.floatfix2.
export function floatFix2(area, flags = {}, report = {}) {
  const skip = new Set(String(flags.floatfix2skip || '').split(',').filter(Boolean));
  const byName = new Map();
  const r7 = +(flags.floatfix2r7 || 0);
  const r8 = +(flags.floatfix2r8 || 0);
  for (const e of FLOAT_CLIP) if (!skip.has(e.group) && (!e.r7 || r7) && (!e.r8 || r8)) (byName.get(e.name) || byName.set(e.name, []).get(e.name)).push(e);
  if (!byName.size) return;
  area.updateMatrixWorld(true);
  const rep = (report.floatfix2 ||= {}), v = new THREE.Vector3();
  const todo = [];
  area.traverse(o => { if (o.isMesh && !o.isInstancedMesh && o.geometry && byName.has(o.userData.invName)) todo.push(o); });
  // pass 1: the first matching entry of every triangle, counted per entry over all meshes of the area (the r3 count gate)
  const hits = new Map(), count = new Map();
  for (const o of todo) {
    const list = byName.get(o.userData.invName), g = o.geometry, P = g.attributes.position;
    if (!P) continue;
    const n = g.index ? g.index.count : P.count, idx = (i) => g.index ? g.index.getX(i) : i;
    // world position of every vertex once, in Blender axes
    const W = new Float32Array(P.count * 3);
    for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld); W[i * 3] = v.x; W[i * 3 + 1] = -v.z; W[i * 3 + 2] = v.y; }
    const inBox = (k, b) => { const x = W[k * 3], y = W[k * 3 + 1], z = W[k * 3 + 2]; return x >= b[0] && y >= b[1] && z >= b[2] && x <= b[3] && y <= b[4] && z <= b[5]; };
    const h = new Map();
    for (let t = 0; t < n; t += 3) {
      const a = idx(t), b = idx(t + 1), c = idx(t + 2);
      const hit = list.find(e => inBox(a, e.box) && inBox(b, e.box) && inBox(c, e.box));
      if (hit) { h.set(t, hit); count.set(hit, (count.get(hit) || 0) + 1); }
    }
    hits.set(o, h);
  }
  // gate: an entry with nothing in its box is already fixed, one outside its range is not the known defect
  const nogate = +(flags.floatfix2nogate || 0), live = new Set();
  for (const [nm, list] of byName) for (const e of list) {
    const k = count.get(e) || 0, tag = e.group + ' ' + nm + ' ' + k;
    if (!k) { if (todo.some(o => o.userData.invName === nm)) (rep.done ||= []).push(tag); continue; }
    const en = (r8 && e.n8) ? e.n8 : e.n;
    if (nogate || !en || (k >= en[0] && k <= en[1])) live.add(e); else (rep.offcount ||= []).push(tag + ' (expected ' + en.join('..') + ')');
  }
  // pass 2: cut only the triangles of the entries that passed
  for (const o of todo) {
    const h = hits.get(o); if (!h || !h.size) continue;
    const g = o.geometry, P = g.attributes.position, n = g.index ? g.index.count : P.count, idx = (i) => g.index ? g.index.getX(i) : i;
    const keep = []; let removed = 0; const per = {};
    for (let t = 0; t < n; t += 3) {
      const hit = h.get(t);
      if (hit && live.has(hit)) { removed++; per[hit.group] = (per[hit.group] || 0) + 1; continue; }
      keep.push(t);
    }
    if (!removed) continue;
    // new geometry (the glTF geometry can be shared by other nodes): same attributes, a filtered index, groups remapped
    const ng = new THREE.BufferGeometry();
    for (const k in g.attributes) ng.setAttribute(k, g.attributes[k]);
    for (const k in g.morphAttributes) ng.morphAttributes[k] = g.morphAttributes[k];
    const Arr = P.count > 65535 ? Uint32Array : Uint16Array, ni = new Arr(keep.length * 3);
    keep.forEach((t, j) => { ni[j * 3] = idx(t); ni[j * 3 + 1] = idx(t + 1); ni[j * 3 + 2] = idx(t + 2); });
    ng.setIndex(new THREE.BufferAttribute(ni, 1));
    if (g.groups.length) { let j = 0;
      for (const gr of g.groups) { const s = j; while (j < keep.length && keep[j] < gr.start + gr.count) j++; if (j > s) ng.addGroup(s * 3, (j - s) * 3, gr.materialIndex); } }
    ng.userData = { ...g.userData }; o.geometry = ng;
    for (const k in per) rep[k] = (rep[k] || 0) + per[k];
    (rep.meshes ||= []).push([o.userData.invName, removed]);
  }
}
