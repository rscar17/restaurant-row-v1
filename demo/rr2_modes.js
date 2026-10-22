// Restaurant Row mode controller: one live scene, four modes, camera glides between them.
//   overview    top view of the row (opens three quarter on the whole lit row, then rests near top on the three heroes)
//   isolate     one hero alone, orbit and tilt it (from the overview labels or the API)
//   restaurant  the entrance view of Gjelina, Milos or Delmonico
//   walk        glide between stops along the corridor, look around at every stop (and while gliding)
//   free        corridor only free walk (keys and mouse, touch stick on phones), bounded by the walk polygon
//   map         the page shows its own resort map; the viewer pauses
// The viewer never draws tabs. The Swoogo page tabs (#row-view-tabs) call the API (bindTabs does the wiring).
// All layout numbers live in rr2_modes_data.js in Blender coordinates; three.js uses (x, z, -y).
import * as THREE from 'three';
import { DATA as DEFAULT_DATA } from './rr2_modes_data.js';

const D2R = Math.PI / 180;
export const B2T = (b, out = new THREE.Vector3()) => out.set(b[0], b[2] ?? 0, -b[1]);

// ---------- plain geometry on the Blender floor plane (x, y) ----------
export function pointInPoly(x, y, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
export function closestOnPoly(x, y, poly) {
  let bx = 0, by = 0, bd = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j], [cx, cy] = poly[i]; const ex = cx - ax, ey = cy - ay; const L = ex * ex + ey * ey;
    const t = L > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / L)) : 0;
    const qx = ax + ex * t, qy = ay + ey * t, d = Math.hypot(x - qx, y - qy);
    if (d < bd) { bd = d; bx = qx; by = qy; }
  }
  return [bx, by, bd];
}
export const distToPoly = (x, y, poly) => closestOnPoly(x, y, poly)[2];
// walk.extra (agent look, Oct 20): more outer rings joined to the walk (the shopfront corridor east of the Palazzo line)
export function insideWalk(x, y, walk) { return (pointInPoly(x, y, walk.outer) || (walk.extra || []).some(r => pointInPoly(x, y, r))) && !walk.holes.some(h => pointInPoly(x, y, h)); }
export function walkClearance(x, y, walk) { return Math.min(distToPoly(x, y, walk.outer), ...(walk.extra || []).map(r => distToPoly(x, y, r)), ...walk.holes.map(h => distToPoly(x, y, h))); }
// keeps a walker inside the corridor: a step that leaves the polygon slides along the edge it crossed
export function clampToWalk(px, py, x, y, walk, eps = 0.02) {
  if (insideWalk(x, y, walk)) return [x, y];
  let q = null;
  for (const ring of [walk.outer, ...(walk.extra || []), ...walk.holes]) { const c = closestOnPoly(x, y, ring); if (!q || c[2] < q[2]) q = c; }
  const dx = px - q[0], dy = py - q[1], L = Math.hypot(dx, dy);
  if (L > 1e-9) { const sx = q[0] + dx / L * eps, sy = q[1] + dy / L * eps; if (insideWalk(sx, sy, walk)) return [sx, sy]; }
  if (insideWalk(x, py, walk)) return [x, py];
  if (insideWalk(px, y, walk)) return [px, y];
  return [px, py];
}

// agent walkfix, RR_FLAGS.sugcorner: the Sugarcane east corner (Blender x -26.5..-25.4, y -18.2..-17.1) holds three coplanar
// layers 8 to 12 mm apart that cross each other: WEST_Block Mesh_1502 (Material_418), WEST_Block Mesh_1552 (sug_wall_paint) and
// CL_SugExt sug_corner_pier. The orange Material_418 layer pokes through the cream in triangle spikes. Drop the Mesh_1502
// triangles that lie wholly inside that box; Mesh_1552 and sug_corner_pier stay as the visible face.
// r3 guard (agent flagset3, Oct 14): apply_fixes_v2.py (step sug_corner) cuts the same faces in the .blend, and the
// floorplan port swapped Mesh_1502's mesh for the top file's version (with its own spike fix) and may have moved the block.
// The box is in master coordinates, so the triangles inside it are first counted over every matching mesh: 0 is already
// fixed (reported as [name, 0, 'done']), a count outside n (the blendfix range; walkfix dropped 62) is not the known
// defect (reported as [name, count, 'offcount'], nothing dropped).
export const SUG_CORNER = [{ re: /^Mesh_1502(\.\d+)?$/, box: [-26.5, -18.2, -25.4, -17.1], n: [50, 80] }];
// agent look (Oct 20), fix list F002/F003 (build named the pieces by rays on r9u/r9v): RR_FLAGS.fixf23 (default 1 in look) drops the
// triangles wholly inside these plan boxes. F003: the Sugarcane spikes, big single Material_418 triangles of Mesh_1502 (x -32.5..-30.7,
// y -20.2..-19.4, z 2.24..3.83) and small Mesh_1535 triangles there; F002: the Matteo bay bracket Mesh_1558 floating at 9.38,-10.48,2.71.
export const FIX_F23 = [{ re: /^Mesh_1502(\.\d+)?$/, box: [-32.6, -20.3, -30.6, -19.3], z: [2.2, 3.9], n: [1, 200] }, { re: /^Mesh_1535(\.\d+)?$/, box: [-32.6, -20.3, -30.6, -19.3], z: [2.2, 3.9], n: [1, 1300] }, { re: /^Mesh_1558(\.\d+)?$/, box: [9.0, -10.8, 9.9, -9.4], z: [2.2, 3.9], n: [1, 60] }];   // z: Blender height range; n: expected count (outside it nothing is dropped)
export function dropCornerTris(root, table = SUG_CORNER) {
  const rep = []; const v = new THREE.Vector3(); root.updateMatrixWorld(true);
  const found = new Map();   // table entry -> [[mesh, name, triangle starts inside]]
  root.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || !o.geometry?.attributes?.position) return;
    const nm = o.userData.invName || o.name || ''; const t = table.find(e => e.re.test(nm)); if (!t) return;
    const g = o.geometry, P = g.attributes.position, I = g.index, n = I ? I.count : P.count, [x0, y0, x1, y1] = t.box;
    const inn = [];
    for (let i = 0; i + 2 < n; i += 3) { let inside = true;
      for (let k = 0; k < 3; k++) { v.fromBufferAttribute(P, I ? I.getX(i + k) : i + k).applyMatrix4(o.matrixWorld); const bx = v.x, by = -v.z; if (!(bx > x0 && bx < x1 && by > y0 && by < y1 && (!t.z || (v.y > t.z[0] && v.y < t.z[1])))) { inside = false; break; } }
      if (inside) inn.push(i); }
    (found.get(t) || found.set(t, []).get(t)).push([o, nm, inn]);
  });
  for (const [t, list] of found) {
    const k = list.reduce((a, e) => a + e[2].length, 0);
    if (!k) { rep.push([list[0][1], 0, 'done']); continue; }
    if (t.n && (k < t.n[0] || k > t.n[1])) { rep.push([list[0][1], k, 'offcount']); continue; }
    for (const [o, nm, inn] of list) { if (!inn.length) continue;
      const g = o.geometry, P = g.attributes.position, I = g.index, n = I ? I.count : P.count, drop = new Set(inn), keep = [];
      for (let i = 0; i + 2 < n; i += 3) if (!drop.has(i)) for (let k2 = 0; k2 < 3; k2++) keep.push(I ? I.getX(i + k2) : i + k2);
      const ng = g.clone(); ng.setIndex(keep); o.geometry = ng; rep.push([nm, inn.length]); }
  }
  return rep;
}
// agent topview (Oct 15), RR_FLAGS.topview: the overview rules of DECISIONS.md section C on the r8f data.
//   veils: every non hero unit is greyed in 3D (a translucent grey volume over its built part: dimmed and desaturated,
//     the real model stays visible under it). The footprint comes from the live meshes of that unit at init (unit poly
//     clipped to their box), so it follows the floorplan port instead of the stale generated veil list (u132 Chica and
//     u166 illy had none, Yardbird's covered a third of its moved interior).
//   roofs: the Oct 11 roof list (Matteo's, Sugarcane, Starbucks, empty room) is superseded by the Oct 12 greyed in 3D
//     rule; those units are greyed like the rest. roofs: true brings the flat roofs back.
//   names: storefront and interior pieces whose box centre falls outside the plan poly of their unit (Gjelina straight
//     and west fronts, the rotunda bar interior ri_, Delmonico pilasters and wing glass) belong to their hero, so the
//     isolate view keeps the whole restaurant. Bar Mia (120) stays lit: its counter, stools and rug sit in the corridor.
//   stage: the overview background is the light stage colour (Ryan objected to a dark ground); it fades in with the
//     roof fade, so eye level views keep the dark ground.
//   restElDeg: 70 by default, RR_FLAGS.ovel = 55 (or any angle) for the other pick.
export const TOPVIEW = {
  roofs: false, veilFrom: 'live', veilPad: 0.25, veilMinArea: 2,
  stageColor: '#e7e1d8', veilColor: '#8a857e', veilOpacity: 0.5, veilTop: 3.0, restElDeg: 70,
  names: [
    { re: '^(gjl_|w_(base|dec|jW|jE|menu|mull|rust|wordmark|glass|head|low|sign|sill)|ri_|gt_ri)', unit: 'gjelina' },
    { re: '^(PIL_|wing_|facetA_|rb_|ent_|cl_de_s1_|cl_nw_neon_mart)', unit: 'delmonico' },
    { re: '^(m2_|mil_)', unit: 'milos' }
  ],
  // Bar Mia (120, bmn_) is an open counter bar whose stools, rug and canopy stand in the walkable corridor (24 m2 of its
  // box is walk polygon), so it stays lit with the hallway; a unit added here gets a live veil over its meshes' box
  addUnits: [],
  // agent modes (w13, tv9 look): the two event rooms south of the row, Voltaire (ROOM_101, SE) and Summit (ROOM_104, SW),
  // have 1750 and 1450 m2 of plain dark theatre carpet (mbf_floor_101_0, mbf_floor_104_0) ringed by a red velvet dado
  // (r101_f*/r104_f* cc0_velour_velvet, 0 to 1.2 m). Under their grey veil the carpet read from above as two huge flat
  // brown/grey slabs with red edges SW and SE of the row (tv9 intro, whole55, whole70). Above the ceilings these floors
  // are left out, so the rooms read as light greyed footprints on the stage like the other non hero units; their walls
  // and veils stay. Walk, stops and isolate are unchanged (only while the roof is off and nothing is isolated).
  // agent modes (w13, tv9c look): hiding the carpet alone left both rooms as plain grey lids (their live veil top, empty
  // under it) with the red velvet dado showing saturated through the veil sides. The two rooms are empty event shells
  // (no restaurant), so above the ceilings their own walls (r101_f*, r104_f*: velvet dado + plaster) go too and only the
  // grey veil footprint stays: greyed in 3D like every other non hero unit (DECISIONS C). RR_FLAGS.ovhide overrides.
  ovHide: '^(mbf_floor_10[14]_0|r10[14]_f\\d+|r166_f\\d+|mt2_glass.*|mt2_frost.*|cl_mt2_glass.*)$',   // mt2/cl_mt2 glass: Matteo's bay panes read as glass sheets over the walkway from above (main 01:39)   // r166_f*: unit 166's bare red shell walls bled red through its veil (M001b)
  // agent modes (w13 21:00, audit + main on m13ov_9b): even as grey footprints the two event halls (1450 + 1750 m2) dominate the
  // whole row shots. They are empty event rooms outside the walk (the Voltaire floor is Out, DECISIONS D), so above the ceilings
  // they are left out like the back hallway and the boutique bay: no veil, every mesh of the unit hidden. RR_FLAGS.ovkeep=1 brings them back.
  ovDrop: ['u101', 'u104', 'u166'],   // u166 (east shell past the Palazzo gate, red plaster walls) added 01:20: it sits beyond the medallion like the omitted back hallway
  // stray shell walls of the dropped halls whose own box centre falls outside every unit polygon (overview pick m13ovpick_11b:
  // mbf_w129 / int_mb_plaster at y -54..-60, mbf_w86 at 35.8,-41): untagged meshes centred in these boxes are hidden above the ceilings
  ovCullBoxes: [[-60, -70, -12, -48], [25, -60, 47, -30], [37, -27, 57, -6]]   // third box: u166 shell walls the unit polygon does not claim (ov_14a)
};
export function topviewData(data, FW = globalThis.RR_FLAGS || {}) {
  if (FW.topview !== undefined && !+FW.topview) return data;   // agent modes w13: on by default (the ship flags never set it); topview=0 gives the old overview
  const T = TOPVIEW, O = { ...data.overview, veilColor: T.veilColor, veilOpacity: T.veilOpacity, veilTop: T.veilTop, stageColor: T.stageColor, restElDeg: +FW.ovel || T.restElDeg, veilFrom: T.veilFrom, veilPad: T.veilPad, veilMinArea: T.veilMinArea };
  const units = data.units.map(u => (!T.roofs && u.role === 'roof') ? { ...u, role: 'dim', wasRoof: true } : u);
  for (const a of T.addUnits) if (!units.some(u => u.id === a.id)) units.push(a);
  return { ...data, overview: O, units, names: T.names.map(n => ({ re: new RegExp(n.re), unit: n.unit })), ovHide: (FW.ovhide ?? T.ovHide) ? new RegExp(FW.ovhide ?? T.ovHide) : null, ovDrop: +FW.ovkeep ? [] : (T.ovDrop || []), ovCullBoxes: +FW.ovkeep ? [] : (T.ovCullBoxes || []) };
}
// clip a polygon to an axis aligned box (Sutherland Hodgman), Blender xy
export function clipPolyBox(poly, [x0, y0, x1, y1]) {
  let out = poly.map(p => [p[0], p[1]]);
  const edges = [[(p) => p[0] >= x0, (a, b) => [x0, a[1] + (b[1] - a[1]) * (x0 - a[0]) / (b[0] - a[0])]], [(p) => p[0] <= x1, (a, b) => [x1, a[1] + (b[1] - a[1]) * (x1 - a[0]) / (b[0] - a[0])]],
    [(p) => p[1] >= y0, (a, b) => [a[0] + (b[0] - a[0]) * (y0 - a[1]) / (b[1] - a[1]), y0]], [(p) => p[1] <= y1, (a, b) => [a[0] + (b[0] - a[0]) * (y1 - a[1]) / (b[1] - a[1]), y1]]];
  for (const [inside, cut] of edges) { const inp = out; out = []; if (!inp.length) break;
    for (let i = 0; i < inp.length; i++) { const a = inp[(i + inp.length - 1) % inp.length], b = inp[i];
      if (inside(b)) { if (!inside(a)) out.push(cut(a, b)); out.push(b); } else if (inside(a)) out.push(cut(a, b)); } }
  return out;
}
export const polyArea = (p) => { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]); return Math.abs(a / 2); };

// ---------- corridor graph and paths ----------
export function shortestPath(graph, a, b) {
  const N = graph.nodes, adj = {};
  for (const [u, v] of graph.edges) { const w = Math.hypot(N[u][0] - N[v][0], N[u][1] - N[v][1]); (adj[u] ||= []).push([v, w]); (adj[v] ||= []).push([u, w]); }
  const dist = { [a]: 0 }, prev = {}, done = new Set();
  while (true) {
    let u = null; for (const k in dist) if (!done.has(k) && (u === null || dist[k] < dist[u])) u = k;
    if (u === null) return null; if (u === b) break; done.add(u);
    for (const [v, w] of adj[u] || []) if (dist[u] + w < (dist[v] ?? Infinity)) { dist[v] = dist[u] + w; prev[v] = u; }
  }
  const out = [b]; while (out[0] !== a) out.unshift(prev[out[0]]); return out;
}
export function nearestNode(graph, x, y, walk = null) {
  let best = null, bd = Infinity;
  for (const [k, p] of Object.entries(graph.nodes)) { const d = Math.hypot(p[0] - x, p[1] - y); if (d < bd) { bd = d; best = k; } }
  return best;
}
// centripetal Catmull-Rom through 2D points, sampled by arc length; returns { len, at(s) -> [x, y, tx, ty] }
export function corridorCurve(pts, perSeg = 24) {
  const P = pts.map(p => [p[0], p[1]]);
  if (P.length === 1) P.push([P[0][0] + 1e-4, P[0][1]]);
  const ext = [[2 * P[0][0] - P[1][0], 2 * P[0][1] - P[1][1]], ...P, [2 * P.at(-1)[0] - P.at(-2)[0], 2 * P.at(-1)[1] - P.at(-2)[1]]];
  const S = [];
  const tj = (a, b) => Math.max(1e-4, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
  for (let i = 1; i < ext.length - 2; i++) {
    const p0 = ext[i - 1], p1 = ext[i], p2 = ext[i + 1], p3 = ext[i + 2];
    const t0 = 0, t1 = t0 + tj(p0, p1), t2 = t1 + tj(p1, p2), t3 = t2 + tj(p2, p3);
    for (let k = (i === 1 ? 0 : 1); k <= perSeg; k++) {
      const t = t1 + (t2 - t1) * k / perSeg; const L = (a, b, ta, tb) => [(tb - t) / (tb - ta) * a[0] + (t - ta) / (tb - ta) * b[0], (tb - t) / (tb - ta) * a[1] + (t - ta) / (tb - ta) * b[1]];
      const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3), B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3);
      S.push(L(B1, B2, t1, t2));
    }
  }
  const cum = [0]; for (let i = 1; i < S.length; i++) cum.push(cum[i - 1] + Math.hypot(S[i][0] - S[i - 1][0], S[i][1] - S[i - 1][1]));
  const len = cum.at(-1);
  return { len, pts: S, at(s) {
    const d = Math.max(0, Math.min(1, s)) * len; let i = 1; while (i < cum.length - 1 && cum[i] < d) i++;
    const f = cum[i] > cum[i - 1] ? (d - cum[i - 1]) / (cum[i] - cum[i - 1]) : 0; const a = S[i - 1], b = S[i];
    const tx = b[0] - a[0], ty = b[1] - a[1], tl = Math.hypot(tx, ty) || 1;
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, tx / tl, ty / tl];
  } };
}

// ---------- camera conventions (same as rr2_player: look = (-sin yaw cos pitch, -sin pitch, -cos yaw cos pitch)) ----------
export function lookVec(yaw, pitch, out = new THREE.Vector3()) { return out.set(-Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)); }
export function yawPitchTo(from, to) { const d = to.clone().sub(from); const L = d.length() || 1; return { yaw: Math.atan2(-d.x, -d.z), pitch: -Math.asin(THREE.MathUtils.clamp(d.y / L, -1, 1)) }; }
export const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
export const lerpAngle = (a, b, t) => a + wrapPi(b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);
export const easeInOut = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const smoothstep = (a, b, x) => smooth(THREE.MathUtils.clamp((x - a) / (b - a), 0, 1));

// distance at which a camera with this yaw/pitch frames a floor box [x0, y0, x1, y1] (Blender) from z0 to z1
export function frameDistance(box, yaw, pitch, fovDeg, aspect, { z0 = 0, z1 = 3.5, margin = 0.08 } = {}) {
  const cam = new THREE.PerspectiveCamera(fovDeg, aspect, 0.05, 2000);
  const c = B2T([(box[0] + box[2]) / 2, (box[1] + box[3]) / 2, (z0 + z1) / 2]);
  const corners = []; for (const x of [box[0], box[2]]) for (const y of [box[1], box[3]]) for (const z of [z0, z1]) corners.push(B2T([x, y, z]));
  const look = lookVec(yaw, pitch); const lim = 1 - margin; const v = new THREE.Vector3();
  const fits = (d) => { cam.position.copy(c).addScaledVector(look, -d); cam.lookAt(c); cam.updateMatrixWorld(); return corners.every(p => { v.copy(p).project(cam); return v.z < 1 && Math.abs(v.x) <= lim && Math.abs(v.y) <= lim; }); };
  let lo = 1, hi = 1500; if (!fits(hi)) return hi;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (fits(m)) hi = m; else lo = m; }
  return hi;
}
// near plane that cuts away what lies above cutY (ceilings) without cutting anything below it anywhere on screen.
// The near plane is perpendicular to the view, so it is level only when looking straight down; the smallest depth over
// the frustum corners keeps it above cutY everywhere (part of the ceiling may survive at the far edge; those objects are hidden anyway).
export function nearForCut(cam, cutY) {
  const H = cam.position.y; if (H <= cutY + 0.2) return null;
  const f = new THREE.Vector3(); cam.getWorldDirection(f);
  const inv = cam.projectionMatrixInverse, w = cam.matrixWorld; let n = Infinity; const p = new THREE.Vector3();
  for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) {
    p.set(x, y, 0.5).applyMatrix4(inv).applyMatrix4(w).sub(cam.position).normalize();
    if (p.y >= -1e-4) continue;                         // this ray never comes down to cutY: no constraint from it
    const t = (H - cutY) / -p.y; n = Math.min(n, t * p.dot(f));
  }
  return Number.isFinite(n) ? n : null;
}

// ---------- the controller ----------
const STYLE = `.rrm-layer{position:absolute;inset:0;pointer-events:none;overflow:hidden;font:600 13px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif}
.rrm-label{position:absolute;left:0;top:0;transform:translate(-50%,-100%);pointer-events:auto;border:1px solid rgba(243,236,228,.55);border-radius:999px;padding:6px 11px;background:rgba(21,17,14,.82);box-shadow:0 1px 6px rgba(0,0,0,.45);color:#f3ece4;cursor:pointer;white-space:nowrap;transition:opacity .25s}
.rrm-label:focus-visible,.rrm-btn:focus-visible{outline:2px solid #c98b6b;outline-offset:2px}
.rrm-bar{position:absolute;left:50%;bottom:max(14px,env(safe-area-inset-bottom));transform:translateX(-50%);display:flex;align-items:center;gap:4px;padding:5px;border-radius:12px;background:rgba(21,17,14,.78);pointer-events:auto;color:#f3ece4}
.rrm-btn{border:0;border-radius:8px;padding:8px 12px;background:transparent;color:inherit;font:inherit;cursor:pointer}
.rrm-btn:hover{background:rgba(255,255,255,.08)}
.rrm-name{padding:0 8px;min-width:8em;text-align:center;font-weight:500}
.rrm-stick{position:absolute;left:0;bottom:0;width:45%;height:55%;pointer-events:auto;touch-action:none}
[hidden]{display:none!important}`;

export class RowModes {
  constructor(player, { data = DEFAULT_DATA, host = null, ui = true, uiParts = null, nipplejs = null, reducedMotion = null } = {}) {
    // agent walkfix: RR_FLAGS.walkfix swaps in DATA.walkFix, the walk polygon cut back 0.35 m from every solid at 0.3 to 1.8 m
    // (Palazzo circle columns at 32.3,11.5 and 38.2,7.1, Delmonico pier rb_pier, south hall Mesh_1531, Starbucks counter, rotunda stand)
    if (+(globalThis.RR_FLAGS || {}).walkfix && data.walkFix) data = { ...data, walk: data.walkFix };
    data = topviewData(data);   // agent topview: no op unless RR_FLAGS.topview
    this.P = player; this.D = data; this.ui = ui && typeof document !== 'undefined'; this.host = host;
    // uiParts: which in-viewer controls to draw when ui is on (the Swoogo page has its own walk bar and free walk pad)
    this.uiParts = { labels: true, iso: true, walk: true, stick: true, ...(uiParts || {}) };
    this.nippleMod = nipplejs; this.mode = null; this.glide = null; this.listeners = {}; this.paused = false;
    this.reduced = reducedMotion ?? (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    this.eye = data.eye ?? 1.6; this.cutZ = data.overview.cutZ ?? 3.3;
    this.orbit = null; this.isolated = null; this.stopIndex = this.D.stops.findIndex(s => s.id === 'rotunda');
    this.lookOff = { yaw: 0, pitch: 0 }; this._set = { yaw: 0, pitch: 0, fov: 60 };
    this.roofOff = false; this.roofFade = 0; this.meshes = []; this.hero = {}; this.veils = new THREE.Group(); this.veils.name = 'rrm_veils';
    player.modes = this;
    player.walkClamp = (pos, prev) => this.clampWalk(pos, prev);
    player.beforeMerge = (root) => this.tagScene(root);
    player.collisionFilter = (bb) => this.nearWalk(bb, 1.0);   // BVH only for what borders the walkable corridor
  }
  // true when a three.js box (world) lies within m metres of the walk polygon
  nearWalk(bb, m = 1.0) {
    const W = this.D.walk; if (!this._wb) { const all = [...W.outer, ...(W.extra || []).flat()], xs = all.map(p => p[0]), ys = all.map(p => p[1]); this._wb = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; }
    const x0 = bb.min.x, x1 = bb.max.x, y0 = -bb.max.z, y1 = -bb.min.z, B = this._wb;
    if (x1 < B[0] - m || x0 > B[2] + m || y1 < B[1] - m || y0 > B[3] + m) return false;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hd = Math.hypot(x1 - x0, y1 - y0) / 2;
    if (insideWalk(cx, cy, W)) return true;
    for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) if (pointInPoly(x, y, W.outer)) return true;
    for (const [x, y] of W.outer) if (x >= x0 - m && x <= x1 + m && y >= y0 - m && y <= y1 + m) return true;
    return distToPoly(cx, cy, W.outer) - hd < m;
  }
  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); return this; }
  emit(ev, d) { for (const f of this.listeners[ev] || []) try { f(d); } catch (e) { console.error(e); }
    if (typeof dispatchEvent !== 'undefined' && typeof CustomEvent !== 'undefined') dispatchEvent(new CustomEvent('rowviewer:' + ev, { detail: d })); }

  // ----- classification (runs before rr2_player.mergeStatic, so merged groups never mix units or ceilings) -----
  tagScene(root, onlyUntagged = false) {   // agent modes w13: onlyUntagged = second pass at init for meshes that came in after the merge hook (far areas)
    const D = this.D, bb = new THREE.Box3(); root.updateMatrixWorld(true); let n = 0;
    const units = D.units.filter(u => u.poly && u.poly.length > 2), omit = D.omit.polys;
    const FW = globalThis.RR_FLAGS || {}; if (+FW.sugcorner && !onlyUntagged) this.sugCorner = dropCornerTris(root);
    if (+(FW.fixf23 ?? 0) && !onlyUntagged) this.fixF23 = dropCornerTris(root, FIX_F23);
    const big = []; this.milosBB = big;
    root.traverse(o => {
      if (!o.isMesh || (onlyUntagged && o.userData.rr) || o.userData.rrOwn) return; bb.setFromObject(o); if (bb.isEmpty()) return;
      let area = (bb.max.x - bb.min.x) * (bb.max.z - bb.min.z);
      // agent walkfix, RR_FLAGS.milosbb: a box over sharedArea is measured again from the vertices (precise), so a stale
      // geometry.boundingBox (accessor min/max) can not mark a small object shared; report in modes.milosBB
      if (+FW.milosbb && area > D.cut.sharedArea && !o.isInstancedMesh) { const a0 = area; bb.setFromObject(o, true); area = (bb.max.x - bb.min.x) * (bb.max.z - bb.min.z); if (big.length < 60) big.push([o.userData.invName || o.name, +a0.toFixed(1), +area.toFixed(1)]); }
      const cx = (bb.min.x + bb.max.x) / 2, cy = -(bb.min.z + bb.max.z) / 2;
      let unit = null;
      if (D.names) { const nm = o.userData.invName || o.name || ''; const hit = D.names.find(e => e.re.test(nm)); if (hit) unit = D.units.find(u => u.id === hit.unit) || null; }
      if (!unit) for (const u of units) if (u.plan && pointInPoly(cx, cy, u.poly)) { unit = u; break; }
      if (!unit) for (const u of units) if (u.role === 'hero' && distToPoly(cx, cy, u.poly) < D.cut.heroBuffer) { unit = u; break; }
      // agent modes w13 (main 01:39): flat corridor floor pieces whose centre falls in a non hero unit's plan polygon (u102 Matteo's
      // polygon reaches over the walk) stretched that unit's live veil box over the walkway: they stay corridor
      if (unit && unit.role !== 'hero' && bb.max.y - bb.min.y < 0.3 && D.walk && D.walk.outer && insideWalk(cx, cy, D.walk)) unit = null;
      const rr = { unit: unit ? unit.id : null, role: unit ? unit.role : 'corridor', ceil: bb.min.y > D.cut.ceilMinZ, omit: omit.some(p => pointInPoly(cx, cy, p)), shared: area > D.cut.sharedArea };
      if ((D.ovHide && D.ovHide.test(o.userData.invName || o.name || '')) || (D.ovDrop && rr.unit && D.ovDrop.includes(rr.unit))) rr.ovHide = true;
      // agent modes w13: pieces inside a dropped hall that no unit claims (units without plan polygons tag nothing) go too,
      // unless they stand in the walk (Bar Mia's counter and stools) or inside another unit's plan polygon
      else if (!rr.unit && D.ovCullBoxes && D.ovCullBoxes.some(b => cx >= b[0] && cy >= b[1] && cx <= b[2] && cy <= b[3])) rr.ovHide = true;
      else if (D.ovDrop && D.ovDrop.length && !rr.unit && units.some(u => D.ovDrop.includes(u.id) && pointInPoly(cx, cy, u.poly)) && !units.some(u => !D.ovDrop.includes(u.id) && pointInPoly(cx, cy, u.poly)) && !(D.walk && D.walk.outer && insideWalk(cx, cy, D.walk))) rr.ovHide = true;   // agent modes w13: see TOPVIEW.ovHide
      o.userData.rr = rr; o.userData.rrKey = (rr.unit || '-') + (rr.ceil ? 'c' : '') + (rr.omit ? 'o' : '') + (rr.shared ? 's' : '') + (rr.ovHide ? 'h' : ''); n++;
    });
    return n;
  }
  // after load: collect the final meshes (merged ones carry the tag of their group), build veils, roofs, labels
  init() {
    const P = this.P; this.meshes = []; this._inited = true;
    this.lateTagged = this.tagScene(P.root, true);   // agent modes w13: far area meshes were never tagged, so the overview could not hide them
    P.root.traverse(o => { if (o.isMesh && o.userData.rr) this.meshes.push(o); });
    const bb = new THREE.Box3(), heroBox = {};
    for (const o of this.meshes) { const r = o.userData.rr; if (r.role !== 'hero' || r.ceil || r.shared) continue; bb.setFromObject(o); (heroBox[r.unit] ||= new THREE.Box3()).union(bb); }
    for (const [id, h] of Object.entries(this.D.heroes)) this.hero[id] = { ...h, box: heroBox[id] || null };
    this.buildVeils(); P.scene.add(this.veils); this.veils.visible = false;
    if (this.ui) this.buildUI();
    return { meshes: this.meshes.length, heroBoxes: Object.fromEntries(Object.entries(heroBox).map(([k, b]) => [k, [b.min.toArray().map(v => +v.toFixed(2)), b.max.toArray().map(v => +v.toFixed(2))]])) };
  }
  buildVeils() {
    const O = this.D.overview;
    const veilM = new THREE.MeshBasicMaterial({ color: O.veilColor, transparent: true, opacity: O.veilOpacity, depthWrite: false, side: THREE.FrontSide, toneMapped: false });
    const roofM = new THREE.MeshBasicMaterial({ color: O.roofColor, transparent: true, opacity: 1, depthWrite: true, toneMapped: false });
    const edgeM = new THREE.LineBasicMaterial({ color: O.roofEdge, transparent: true, opacity: 1, toneMapped: false });
    this.veilMats = { veilM, roofM, edgeM, base: O.veilOpacity };
    // agent topview: veilFrom 'live' builds each unit's veil from its own meshes (see TOPVIEW)
    const live = {};
    if (O.veilFrom === 'live') { const bb = new THREE.Box3();
      for (const o of this.meshes) { const r = o.userData.rr; if (!r.unit || r.role === 'hero' || r.ceil || r.shared || r.omit) continue;
        bb.setFromObject(o); if (bb.isEmpty()) continue; const b = live[r.unit] ||= [Infinity, Infinity, -Infinity, -Infinity, 0];
        b[0] = Math.min(b[0], bb.min.x); b[1] = Math.min(b[1], -bb.max.z); b[2] = Math.max(b[2], bb.max.x); b[3] = Math.max(b[3], -bb.min.z); b[4] = Math.max(b[4], Math.min(bb.max.y, 7)); } }
    this.veilReport = {};
    for (const u of this.D.units) {
      if (u.role === 'hero' || (this.D.ovDrop && this.D.ovDrop.includes(u.id))) continue;   // agent modes w13: ovDrop units get no veil
      let polys = u.veil || [];
      if (O.veilFrom === 'live') { const b = live[u.id]; polys = [];
        if (b) { const pad = O.veilPad ?? 0.25, box = [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad];
          const base = u.poly && u.poly.length > 2 ? clipPolyBox(u.poly, box) : [[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]]];
          if (base.length > 2 && polyArea(base) >= (O.veilMinArea ?? 2)) polys = [base]; }
        this.veilReport[u.id] = { area: +polys.reduce((a, p) => a + polyArea(p), 0).toFixed(1), box: b ? b.map(v => +v.toFixed(1)) : null }; }
      // live veils reach the top of the unit's own walls (they run past the 2.95 m ceiling line), else the walls poke out un greyed
      const vTop = O.veilFrom === 'live' && live[u.id] ? Math.max(O.veilTop, live[u.id][4] + 0.05) : null;
      for (const poly of polys) {
        const sh = new THREE.Shape(poly.map(p => new THREE.Vector2(p[0], p[1])));
        const top = u.role === 'roof' ? O.roofTop : (vTop ?? O.veilTop);
        if (u.role === 'roof') {
          const g = new THREE.ShapeGeometry(sh); const m = new THREE.Mesh(g, roofM); m.rotation.x = -Math.PI / 2; m.position.y = top; m.name = 'rrm_roof_' + u.id; m.renderOrder = 2;
          const e = new THREE.LineSegments(new THREE.EdgesGeometry(g), edgeM); e.rotation.x = -Math.PI / 2; e.position.y = top + 0.01; this.veils.add(m, e);
        } else {
          const g = new THREE.ExtrudeGeometry(sh, { depth: top - 0.02, bevelEnabled: false }); const m = new THREE.Mesh(g, veilM);
          m.rotation.x = -Math.PI / 2; m.position.y = 0.02; m.name = 'rrm_veil_' + u.id; m.renderOrder = 3; this.veils.add(m);
        }
      }
    }
    // agent modes w13 (main 01:39): greyed veils that reach over the walk read as glass sheets lying on the corridor in the
    // overview. A depth only mask over the walk outline (drawn after the opaque scene, before the veils) keeps every veil
    // off the walkway; the floor and fronts under it are already drawn. OFF by default (it let lamp glints show as sparkles on the corridor, m13tvpick_14c); RR_FLAGS.veilmask=1 turns it on.
    if (O.veilFrom === 'live' && +(globalThis.RR_FLAGS || {}).veilmask && this.D.walk && this.D.walk.outer) {
      const wk = this.D.walk, sh = new THREE.Shape(wk.outer.map(p => new THREE.Vector2(p[0], p[1])));
      for (const h of wk.holes || []) sh.holes.push(new THREE.Path(h.map(p => new THREE.Vector2(p[0], p[1]))));
      const mm = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, transparent: true, side: THREE.DoubleSide });
      const mk = new THREE.Mesh(new THREE.ShapeGeometry(sh), mm); mk.rotation.x = -Math.PI / 2; mk.position.y = O.veilMaskY ?? 5.6; mk.name = 'rrm_veil_mask'; mk.renderOrder = 1;
      this.veils.add(mk); this.veilMats.maskM = mm;
    }
    this.veils.traverse(o => { o.frustumCulled = true; o.userData.rrOwn = true; });
  }
  // what is drawn: rr2_player.cull honours userData.rrHide every frame
  applyVis() {
    const iso = this.isolated, off = this.roofOff;
    for (const o of this.meshes) {
      const r = o.userData.rr; let hide = false;
      if (iso) hide = !(r.unit === iso && !r.ceil && !r.shared);
      else if (off) hide = r.ceil || r.omit || !!r.ovHide;
      o.userData.rrHide = hide; if (hide) o.visible = false; else if (o.isInstancedMesh) o.visible = true;
    }
    this.veils.visible = off && !iso;
  }
  setRoofOff(v) { if (this.roofOff === v) return; this.roofOff = v; this.applyVis(); }

  // ----- UI inside the viewer: three labels, a back button when isolated, prev/next in the walkthrough, the touch stick -----
  buildUI() {
    const host = this.host || this.P.canvas.parentElement; this.host = host;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    if (!document.getElementById('rrm-style')) { const s = document.createElement('style'); s.id = 'rrm-style'; s.textContent = STYLE; document.head.append(s); }
    const L = this.layer = document.createElement('div'); L.className = 'rrm-layer'; host.append(L);
    this.labels = Object.entries(this.D.heroes).map(([id, h]) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'rrm-label'; b.textContent = h.name;
      b.setAttribute('aria-label', h.name + ': view on its own'); b.hidden = true; b.onclick = () => this.isolate(id); L.append(b); return { id, el: b, pos: B2T(h.label) }; });
    const bar = (html) => { const d = document.createElement('div'); d.className = 'rrm-bar'; d.innerHTML = html; d.hidden = true; L.append(d); return d; };
    this.isoBar = bar('<button type="button" class="rrm-btn" data-a="back">Back to the row</button><span class="rrm-name"></span>');
    this.isoBar.querySelector('[data-a=back]').onclick = () => this.isolate(null);
    this.walkBar = bar('<button type="button" class="rrm-btn" data-a="prev" aria-label="Previous stop">&#8249; Prev</button><span class="rrm-name" aria-live="polite"></span><button type="button" class="rrm-btn" data-a="next" aria-label="Next stop">Next &#8250;</button>');
    this.walkBar.querySelector('[data-a=prev]').onclick = () => this.prev();
    this.walkBar.querySelector('[data-a=next]').onclick = () => this.next();
    this.stickZone = document.createElement('div'); this.stickZone.className = 'rrm-stick'; this.stickZone.hidden = true; L.append(this.stickZone);
    addEventListener('keydown', this._onKey = (e) => { const t = e.target; if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === 'Escape' && this.isolated) this.isolate(null);
      if (this.mode === 'walk' && !this.glide) { if (e.key === 'ArrowRight') this.next(); if (e.key === 'ArrowLeft') this.prev(); } });
  }
  syncUI() {
    if (!this.ui || !this.isoBar) return;
    const m = this.mode;
    this.isoBar.hidden = !(m === 'isolate') || !this.uiParts.iso; if (this.isolated) this.isoBar.querySelector('.rrm-name').textContent = this.D.heroes[this.isolated].name;
    this.walkBar.hidden = m !== 'walk' || !this.uiParts.walk; this.walkBar.querySelector('.rrm-name').textContent = this.D.stops[this.stopIndex]?.name || '';
    const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
    const stick = m === 'free' && coarse && this.uiParts.stick;
    this.stickZone.hidden = !stick;
    if (stick) this.ensureStick();
  }
  async ensureStick() {
    if (this.stick || this._stickLoading) return; this._stickLoading = true;
    try {
      const mod = this.nippleMod || await import('nipplejs'); const create = mod.create || mod.default?.create;
      const mgr = this.stick = create({ zone: this.stickZone, mode: 'static', position: { left: '72px', bottom: '96px' }, size: 110, color: 'white', restOpacity: 0.55 });
      const mv = this.P.move;
      mgr.on('move', (e, d) => { const v = (d || e.data || {}).vector, f = Math.min(1, (d || e.data || {}).force ?? 1); if (v) mv.set(THREE.MathUtils.clamp(v.x * f, -1, 1), THREE.MathUtils.clamp(v.y * f, -1, 1)); });
      mgr.on('end', () => mv.set(0, 0));
    } catch (err) { // no nipplejs: the player's own left-half touch stick still works under the zone
      this.stickZone.remove(); this.stickZone = { hidden: true }; this.emit('warn', 'nipplejs not loaded: ' + err);
    }
  }
  updateLabels() {
    if (!this.ui || !this.labels) return; const cam = this.P.camera; const w = this.P.canvas.clientWidth, h = this.P.canvas.clientHeight; const v = new THREE.Vector3();
    const show = this.uiParts.labels && (this.mode === 'overview' || (this.glide && this.glide.labels)) && !this.isolated && this.roofFade > 0.6 && (this.orbit?.pull ?? 0) < 0.6;
    for (const l of this.labels) {
      if (!show) { l.el.hidden = true; continue; }
      v.copy(l.pos).project(cam); const vis = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
      l.el.hidden = !vis; if (vis) l.el.style.transform = `translate(${((v.x + 1) / 2 * w).toFixed(1)}px,${((1 - v.y) / 2 * h).toFixed(1)}px) translate(-50%,-100%)`;
    }
  }

  // ----- poses -----
  // the current camera as a pose, read from the camera itself (in orbit modes the player's pitch is kept at 0 for drags)
  pose() { const c = this.P.camera; c.updateMatrixWorld(); const d = c.getWorldDirection(new THREE.Vector3());
    return { pos: c.position.clone(), yaw: Math.atan2(-d.x, -d.z), pitch: -Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)), fov: c.fov }; }
  applyPose(p) {
    const P = this.P, c = P.camera; c.position.copy(p.pos); P.yaw = p.yaw; P.pitch = p.pitch;
    if (Math.abs(c.fov - p.fov) > 1e-3) { c.fov = p.fov; c.updateProjectionMatrix(); }
    c.lookAt(c.position.clone().add(lookVec(p.yaw, p.pitch))); c.updateMatrixWorld();
    this._set = { yaw: p.yaw, pitch: p.pitch, fov: p.fov };
  }
  stopPose(i) { const s = this.D.stops[i], n = this.D.graph.nodes[s.id]; const pos = B2T([n[0], n[1], this.eye]); const yp = yawPitchTo(pos, B2T(s.look)); return { pos, ...yp, fov: 60 }; }
  // the hero view for the current canvas shape: 'narrow' below aspect 1 (phones, square stages) when the data has one;
  // heroAlt[id] = true picks the data's 'alt' framing (the other facade) for side by side checks
  heroView(id) { const h = this.D.heroes[id], narrow = (this.P.camera.aspect || 16 / 9) < 1, src = this.heroAlt && this.heroAlt[id] && h.alt ? h.alt : null;
    if (src) return (narrow && src.narrow) || src.wide || h.view;
    return (narrow && h.narrow) || h.view; }
  heroPose(id) { const v = this.heroView(id); const pos = B2T(v.pos); return { pos, ...yawPitchTo(pos, B2T(v.look)), fov: v.fov || 60 }; }
  orbitPose(o) { const t = o.target, look = lookVec(o.az, o.el); return { pos: t.clone().addScaledVector(look, -o.dist), yaw: o.az, pitch: o.el, fov: o.fov }; }
  boxCenter(box) { return B2T([(box[0] + box[2]) / 2, (box[1] + box[3]) / 2, 0.5]); }
  overviewFrames() {
    const O = this.D.overview, a = this.P.camera.aspect || 16 / 9, fov = a < 1 ? 55 : 42;
    const restEl = O.restElDeg * D2R, introEl = O.introElDeg * D2R, az = O.restAzDeg * D2R;
    const rest = { target: this.boxCenter(O.heroBox), az, el: restEl, fov, dist: frameDistance(O.heroBox, az, restEl, fov, a) };
    const whole = { target: this.boxCenter(O.rowBox), az: O.introAzDeg * D2R, el: introEl, fov, dist: frameDistance(O.rowBox, O.introAzDeg * D2R, introEl, fov, a) };
    const wholeTop = { ...whole, el: restEl, dist: frameDistance(O.rowBox, az, restEl, fov, a) };
    return { rest, whole, wholeTop };
  }

  // ----- glides -----
  // to: target pose. path: 'corridor' points (Blender xy) or 'arc' (overview to ground and back) or null (straight)
  startGlide({ to, dur, corridor = null, arc = false, lookAlong = false, labels = false, onDone = null, mode }) {
    const from = this.pose(); const P = this.P; P.mode = 'stop'; P.move.set(0, 0);
    let path = null;
    if (corridor && corridor.length > 1) { const cv = corridorCurve(corridor); path = { len: cv.len, at: (s) => { const r = cv.at(s); return { p: new THREE.Vector3(r[0], this.eye, -r[1]), tyaw: Math.atan2(-r[2], r[3]) }; } };
      // tangent (tx, ty) in Blender: three dir (tx, -ty): yaw = atan2(-tx, ty)
    } else {
      const a = from.pos, b = to.pos; let c1, c2;
      if (arc) { // overview <-> ground: drop in from above and slightly behind the final view, rise out the same way
        const up = b.y < a.y; const g = up ? b : a, sky = up ? a : b; const back = lookVec(up ? to.yaw : from.yaw, 0).multiplyScalar(-6);
        const over = g.clone().add(back).setY(g.y + 9); const high = sky.clone().lerp(over, 0.45);
        [c1, c2] = up ? [high, over] : [over, high];
      } else { c1 = a.clone().lerp(b, 1 / 3); c2 = a.clone().lerp(b, 2 / 3); }
      const bz = new THREE.CubicBezierCurve3(a.clone(), c1, c2, b.clone()); bz.arcLengthDivisions = 200; bz.updateArcLengths();
      path = { len: bz.getLength(), at: (s) => ({ p: bz.getPointAt(Math.max(0, Math.min(1, s))) }) };
    }
    dur = this.reduced ? 0.01 : (dur ?? THREE.MathUtils.clamp(path.len / 3.2, 1.2, 6));
    this.glide = { from, to, path, dur, t: 0, lookAlong, labels, onDone, mode };
    this.lookOff = { yaw: 0, pitch: 0 }; this._set = { yaw: P.yaw, pitch: P.pitch, fov: P.camera.fov };
    return new Promise(res => { this.glide.resolve = res; });
  }
  stepGlide(dt) {
    const g = this.glide, P = this.P;
    // look around while gliding: drags since the last frame become an offset that fades out
    const cl = (v) => THREE.MathUtils.clamp(v, -0.12, 0.12);   // the player clamps pitch at 1.2 rad: ignore that jump
    this.lookOff.yaw += cl(P.yaw - this._set.yaw); this.lookOff.pitch += cl(P.pitch - this._set.pitch);
    const k = Math.exp(-dt / 1.2); this.lookOff.yaw *= k; this.lookOff.pitch *= k;
    g.t = Math.min(1, g.t + dt / g.dur); const u = easeInOut(g.t); const r = g.path.at(u);
    let yaw, pitch;
    if (g.lookAlong && r.tyaw !== undefined) {
      yaw = lerpAngle(lerpAngle(r.tyaw, g.from.yaw, 1 - smoothstep(0, 0.22, g.t)), g.to.yaw, smoothstep(0.7, 1, g.t));
      pitch = THREE.MathUtils.lerp(THREE.MathUtils.lerp(0, g.from.pitch, 1 - smoothstep(0, 0.22, g.t)), g.to.pitch, smoothstep(0.7, 1, g.t));
    } else { yaw = lerpAngle(g.from.yaw, g.to.yaw, u); pitch = THREE.MathUtils.lerp(g.from.pitch, g.to.pitch, u); }
    const fov = THREE.MathUtils.lerp(g.from.fov, g.to.fov, u);
    this.applyPose({ pos: r.p, yaw: yaw + this.lookOff.yaw, pitch: THREE.MathUtils.clamp(pitch + this.lookOff.pitch, -1.45, 1.55), fov });
    if (g.t >= 1) { this.glide = null; this.applyPose(g.to); g.onDone && g.onDone(); g.resolve && g.resolve(); }
  }

  // ----- per frame (rr2_player.step calls this first; true = the controller placed the camera) -----
  step(dt) {
    if (!this._inited) return false;   // the player may step during load (warm frame), before init() built the veils and UI
    if (this.paused) return true;
    const P = this.P, c = P.camera;
    let owned = true;
    if (this.glide) this.stepGlide(dt);
    else if (this.mode === 'overview' || this.mode === 'isolate') this.stepOrbit(dt);
    else owned = false;   // stop / walk at rest / free walk: the player handles look and movement
    // roof off above the ceilings (going up it lifts the moment the camera leaves the corridor; coming down it closes
    // once the camera is back under the ceiling line)
    this.setRoofOff(c.position.y > 2.7 || this.mode === 'overview' || this.mode === 'isolate');
    this.roofFade = smoothstep(3, 12, c.position.y);
    if (this.D.overview.stageColor && P.scene.background?.isColor) { // agent topview: light stage ground above the ceilings
      if (!this._bg0) { this._bg0 = P.scene.background.clone(); this._bgS = new THREE.Color(this.D.overview.stageColor); }
      P.scene.background.copy(this._bg0).lerp(this._bgS, this.isolated || this.mode === 'overview' || this.mode === 'isolate' || this.glide ? this.roofFade : 0);
      // agent topview (r9 TV9 look): the player's floor_underlay (1 m grid disc, radius 30 around the rotunda, z -0.003, a crack filler
      // under the walk floors) reads from above as a huge orange disc with a saw tooth edge around the whole row; off above the ceilings
      if (!this._ul && P.root && ((this._ulTry = (this._ulTry || 0) + 1) % 60 === 1)) this._ul = P.root.getObjectByName('floor_underlay') || null;   // made after the load: look again every 60 frames until found
      if (this._ul) { const off = this.roofFade > 0.02; this._ul.userData.rrHide = off; this._ul.visible = !off; } }
    if (this.veilMats) { this.veilMats.veilM.opacity = this.veilMats.base * this.roofFade; this.veilMats.roofM.opacity = this.roofFade; this.veilMats.edgeM.opacity = this.roofFade; this.veilMats.roofM.transparent = this.roofFade < 0.999; }
    const want = this.roofOff && !this.isolated && c.position.y > this.cutZ + 1 ? (c.updateMatrixWorld(), nearForCut(c, this.cutZ)) : null;
    const near = want ? THREE.MathUtils.clamp(want, 0.05, 1000) : 0.05;
    if (Math.abs(c.near - near) > 1e-3) { c.near = near; c.far = Math.max(400, near + 400); c.updateProjectionMatrix(); }
    this.updateLabels();
    return owned;
  }
  stepOrbit(dt) {
    const P = this.P, o = this.orbit; if (!o) return;
    // drags arrive as player yaw/pitch changes and wheel zoom as a field of view change: turn them into orbit moves
    const dy = P.yaw - this._set.yaw, dp = P.pitch - this._set.pitch, df = P.camera.fov - this._set.fov;
    o.az += dy; o.el = THREE.MathUtils.clamp(o.el + dp, 12 * D2R, 88 * D2R);
    if (df) o.dist = THREE.MathUtils.clamp(o.dist * Math.pow(1.04, df / 0.9), o.minDist, o.maxDist);
    if (o.kind === 'overview') { // pulling back brings the whole row back into frame
      const F = this.frames; const f = THREE.MathUtils.clamp((o.dist - F.rest.dist) / Math.max(1, F.wholeTop.dist - F.rest.dist), 0, 1);
      o.pull = f; o.target.copy(F.rest.target).lerp(F.whole.target, smooth(f));
    }
    if (o.hold > 0) { o.hold -= dt; o.az += dt * 0.02; if (o.hold <= 0 && o.then) { const t = o.then; o.then = null; t(); return; } }
    this.applyPose(this.orbitPose(o));
    P.pitch = 0; this._set.pitch = 0;   // drags are read as changes from 0, clear of the player's own pitch clamp
  }

  // ----- modes -----
  setModeState(m) { this.mode = m; this.syncUI(); this.emit('mode', { mode: m, isolated: this.isolated, stop: this.D.stops[this.stopIndex]?.id }); }
  async overview({ intro = undefined } = {}) {
    this.resume(); const prev = this.mode; this.isolated = null; this.orbit = null; this.applyVis();
    const F = this.frames = this.overviewFrames(), O = this.D.overview;
    const first = intro ?? !this._seenOverview; this._seenOverview = true;
    const rest = { ...F.rest, target: F.rest.target.clone(), kind: 'overview', minDist: F.rest.dist * 0.55, maxDist: F.wholeTop.dist * 1.15, pull: 0, hold: 0 };
    this.setModeState('overview'); this.setRoofOff(true);
    const settle = (o) => { if (this.mode !== 'overview') return false; this.orbit = o; this._set = { yaw: this.P.yaw, pitch: 0, fov: this.P.camera.fov }; this.P.pitch = 0; return true; };
    const ground = this.P.camera.position.y < 3;
    if (first) { // the whole lit row from the three quarter angle, a few seconds, then down onto the three heroes
      const whole = { ...F.whole, target: F.whole.target.clone(), kind: 'intro', minDist: F.whole.dist, maxDist: F.whole.dist, pull: 1, hold: this.reduced ? 0.01 : O.introHoldS };
      if (!prev) this.applyPose(this.orbitPose(whole));
      else await this.startGlide({ to: this.orbitPose(whole), arc: ground, dur: ground ? 3.0 : 2.0, mode: 'overview' });
      if (!settle(whole)) return;
      await new Promise(res => { whole.then = res; });
      if (this.mode !== 'overview') return;
      this.orbit = null; await this.startGlide({ to: this.orbitPose(rest), dur: O.glideS, labels: true, mode: 'overview' }); settle(rest); return;
    }
    await this.startGlide({ to: this.orbitPose(rest), arc: ground, dur: ground ? 3.0 : 2.0, labels: true, mode: 'overview' }); settle(rest);
  }
  // one hero alone: everything else hidden, orbit and tilt around it; null returns to the row
  async isolate(id) {
    if (!id) { if (!this.isolated) return; this.isolated = null; this.applyVis(); return this.overview({ intro: false }); }
    const h = this.hero[id]; if (!h) return; this.resume(); this.isolated = id; this.orbit = null; this.setRoofOff(true); this.applyVis();
    const box = h.box ? [h.box.min.x, -h.box.max.z, h.box.max.x, -h.box.min.z] : this.D.overview.heroBox;
    const az = this.P.yaw, el = 38 * D2R, fov = this.frames?.rest.fov ?? 45; const dist = frameDistance(box, az, el, fov, this.P.camera.aspect || 1.6, { z1: 4 });
    const o = { target: this.boxCenter(box).setY(1.4), az, el, fov, dist, kind: 'isolate', minDist: dist * 0.45, maxDist: dist * 2.2, hold: 0 };
    this.setModeState('isolate');
    await this.startGlide({ to: this.orbitPose(o), dur: 1.8, mode: 'isolate' });
    if (this.isolated === id) { this.orbit = o; this._set = { yaw: this.P.yaw, pitch: this.P.pitch, fov: this.P.camera.fov }; }
  }
  // corridor route from where the camera is to a graph node, or null when the camera is not in the corridor
  corridorRoute(toId) {
    const c = this.P.camera.position, x = c.x, y = -c.z, W = this.D.walk, G = this.D.graph;
    if (c.y > 3 || !insideWalk(x, y, W)) return null;
    const a = nearestNode(G, x, y); const ids = shortestPath(G, a, toId); if (!ids) return null;
    const pts = ids.map(k => G.nodes[k]);
    // leave from the current spot; drop the first node when it lies behind us on the way
    if (pts.length > 1) { const [n0, n1] = pts; const v0 = [n0[0] - x, n0[1] - y], v1 = [n1[0] - n0[0], n1[1] - n0[1]]; if (v0[0] * v1[0] + v0[1] * v1[1] < 0) pts.shift(); }
    if (Math.hypot(pts[0][0] - x, pts[0][1] - y) > 0.05) pts.unshift([x, y]);
    return pts.length > 1 ? pts : null;
  }
  async restaurant(id) {
    if (!this.D.heroes[id]) return; this.resume(); const was = this.mode; this.isolated = null; this.orbit = null; this.applyVis();
    this.restaurantId = id; this.setModeState('restaurant');   // id first: the mode event syncs the page tabs from it
    const si = this.D.stops.findIndex(s => s.hero === id); if (si >= 0) this.stopIndex = si;
    const to = this.heroPose(id); const route = this.corridorRoute(this.D.stops[si]?.id);
    if (route) { route[route.length - 1] = this.heroView(id).pos.slice(0, 2); await this.startGlide({ to, corridor: route, lookAlong: true, mode: 'restaurant' }); }
    else await this.startGlide({ to, arc: this.P.camera.position.y > 3, dur: this.P.camera.position.y > 3 ? 3.0 : 1.6, mode: 'restaurant' });
    if (this.mode === 'restaurant') this.P.mode = 'stop';
    return was;
  }
  async walk(stopId = null) {
    this.resume(); this.isolated = null; this.orbit = null; this.applyVis();
    if (stopId) { const i = this.D.stops.findIndex(s => s.id === stopId); if (i >= 0) this.stopIndex = i; }
    else if (this.P.camera.position.y < 3) { const c = this.P.camera.position; let bi = this.stopIndex, bd = Infinity; this.D.stops.forEach((s, i) => { const n = this.D.graph.nodes[s.id]; const d = Math.hypot(n[0] - c.x, n[1] + c.z); if (d < bd) { bd = d; bi = i; } }); this.stopIndex = bi; }
    this.setModeState('walk'); return this.goStop(this.stopIndex);
  }
  async goStop(i) {
    const n = this.D.stops.length; i = ((i % n) + n) % n; this.stopIndex = i; this.syncUI();
    const to = this.stopPose(i), route = this.corridorRoute(this.D.stops[i].id);
    if (route) await this.startGlide({ to, corridor: route, lookAlong: true, mode: 'walk' });
    else await this.startGlide({ to, arc: this.P.camera.position.y > 3, dur: this.P.camera.position.y > 3 ? 3.0 : 1.6, mode: 'walk' });
    if (this.mode === 'walk') { this.P.mode = 'stop'; this.emit('stop', { stop: this.D.stops[i].id, index: i }); if (this.autoplay) this._auto = setTimeout(() => this.mode === 'walk' && this.autoplay && this.next(), this.autoplayDwell * 1000); }
  }
  next() { if (this.mode !== 'walk') return this.walk(); clearTimeout(this._auto); return this.goStop(this.stopIndex + 1); }
  prev() { if (this.mode !== 'walk') return this.walk(); clearTimeout(this._auto); return this.goStop(this.stopIndex - 1); }
  play(on = true, dwellS = 4) { this.autoplay = on; this.autoplayDwell = dwellS; clearTimeout(this._auto); if (on && this.mode === 'walk' && !this.glide) this.next(); }
  async free() {
    this.resume(); this.isolated = null; this.orbit = null; this.applyVis(); this.setModeState('free');
    const c = this.P.camera.position;
    if (!(c.y < 3 && insideWalk(c.x, -c.z, this.D.walk))) { const i = this.D.stops.findIndex(s => s.id === 'rotunda'); await this.startGlide({ to: this.stopPose(i), arc: c.y > 3, dur: c.y > 3 ? 3.0 : 1.6, mode: 'free' }); }
    if (this.mode !== 'free') return;
    this.P.pitch = THREE.MathUtils.clamp(this.P.pitch, -0.6, 0.6); this.P.camera.position.y = this.eye; this.P.vel?.set(0, 0, 0); this.P.mode = 'free';
  }
  map() { this.setModeState('map'); this.pause(); }
  pause() { if (this.paused) return; this.paused = true; if (this.P.raf) cancelAnimationFrame(this.P.raf); this.P.raf = null; }
  resume() { if (!this.paused) return; this.paused = false; if (this._started) this.P.start(); }
  start(initial = 'overview') { this._started = true; this.P.start(); return this.view(initial); }
  // page tab names: 3d, walk, free, flat (Resort map)
  view(name) {
    clearTimeout(this._auto); this.autoplay = false;
    if (name === '3d' || name === 'overview') return this.overview();
    if (name === 'walk') return this.walk();
    if (name === 'free') return this.free();
    if (name === 'flat' || name === 'map') return this.map();
    if (this.D.heroes[name]) return this.restaurant(name);
  }
  // restaurant and isolate map to the hero's own tab (data-view="gjelina" and so on); a page without per restaurant
  // tabs falls back to the 3d tab in bindTabs
  tabFor(mode = this.mode) {
    if (mode === 'restaurant') return this.restaurantId || '3d';
    if (mode === 'isolate') return this.isolated || '3d';
    return { overview: '3d', walk: 'walk', free: 'free', map: 'flat' }[mode] || '3d';
  }
  bindTabs(el = typeof document !== 'undefined' && document.getElementById('row-view-tabs')) {
    if (!el) return null; const btns = [...el.querySelectorAll('[data-view]')];
    const sync = () => { let t = this.tabFor(); if (!btns.some(b => b.dataset.view === t)) t = '3d';
      btns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === t))); };
    btns.forEach(b => b.addEventListener('click', () => this.view(b.dataset.view)));
    this.on('mode', sync); sync(); return sync;
  }
  // free walk boundary (called by rr2_player.step after the BVH wall slide)
  clampWalk(pos, prev) { const r = clampToWalk(prev.x, -prev.z, pos.x, -pos.z, this.D.walk); pos.x = r[0]; pos.z = -r[1]; }
  // public API for the page
  api() {
    return { view: (n) => this.view(n), restaurant: (id) => this.restaurant(id), isolate: (id) => this.isolate(id), next: () => this.next(), prev: () => this.prev(),
      goStop: (id) => this.walk(id), play: (on, s) => this.play(on, s), stops: () => this.D.stops.map(s => ({ id: s.id, name: s.name })),
      get mode() { return this._m(); }, on: (e, f) => this.on(e, f), bindTabs: (el) => this.bindTabs(el), pause: () => this.pause(), resume: () => this.resume(), _m: () => this.mode };
  }
}

// ----- viewer contract (agent_swoogo rr2_viewer.js, INTEGRATION_GUIDE.md section 3; agreed in agent_integrate) -----
// createModes(player, ctx) is called right after the player is constructed and BEFORE player.load(), because the
// controller hooks into the load (beforeMerge tags units and ceilings, collisionFilter picks the BVH meshes). After
// the load the viewer calls ready() once, then set() for the first view. It returns
//   { set(mode, opts), update(dt), ready(), walk, zoom(f), dispose(), modes: RowModes instance, api: page API }
// Viewer mode names map to RowModes as: overview -> overview, restaurant {id} -> restaurant(id),
// walkthrough {stop?, t?, autoplay?} -> walk (stops; t picks the nearest stop), freewalk {at?} -> free.
// The viewer owns the frame loop (start/stop through setActive), so RowModes never starts it here.
// opts.animate === false places the view at once: the glide is shortened and stepped here, so set() resolves without
// the loop running (the viewer awaits the first set() before it starts the loop).
export function createModes(player, ctx = {}) {
  const M = new RowModes(player, { host: ctx.host || null, ui: ctx.ui ?? true, uiParts: ctx.uiParts ?? { walk: false, stick: false }, nipplejs: ctx.nipplejs || null });
  M._started = false;   // resume() then never starts the loop behind the viewer's back
  const inv = () => { if (player.invalidate) player.invalidate(2); };
  const av = M.applyVis.bind(M); M.applyVis = () => { av(); inv(); };   // visibility changes without a camera move
  const emit = (t, d) => { if (ctx.emit) ctx.emit(t, d); };
  const nStops = () => M.D.stops.length;
  const walkT = () => nStops() > 1 ? M.stopIndex / (nStops() - 1) : 0;
  M.on('stop', () => emit('walkprogress', { t: walkT(), playing: !!M.autoplay }));
  M.on('mode', (d) => emit('controllermode', d));   // isolate from a label click changes the mode inside the controller
  let readyDone = false;
  const ready = () => { if (readyDone) return; readyDone = true; return M.init(); };
  const run = (fn, animate) => {
    if (animate) return fn();
    const was = M.reduced; M.reduced = true; const p = fn();
    for (let i = 0; i < 4 && M.glide; i++) M.step(0.05);   // a reduced glide lasts 0.01 s
    M.reduced = was; inv(); p.catch?.(() => {}); return Promise.resolve();
  };
  const ctl = {
    modes: M, api: M.api(),
    ready,
    set(mode, opts = {}) {
      if (!readyDone) ready();
      const animate = opts.animate !== false; clearTimeout(M._auto); M.autoplay = false;
      if (mode === 'overview') return run(() => M.overview(animate ? {} : { intro: false }), animate);
      if (mode === 'restaurant') return run(() => M.restaurant(opts.id || 'gjelina'), animate);
      if (mode === 'freewalk') return run(() => opts.at && M.D.heroes[opts.at] ? M.restaurant(opts.at).then(() => M.free()) : M.free(), animate);
      if (mode === 'walkthrough') {
        let id = opts.stop || null;
        if (!id && typeof opts.t === 'number' && nStops() > 1) id = M.D.stops[Math.round(Math.max(0, Math.min(1, opts.t)) * (nStops() - 1))].id;
        const p = run(() => M.walk(id), animate);
        if (opts.autoplay === true) { M.autoplay = true; M.autoplayDwell = 4; }
        emit('walkprogress', { t: walkT(), playing: !!M.autoplay });
        return p;
      }
      return Promise.reject(new Error('unknown mode ' + mode));
    },
    // the player's step() already asks M.step() (player.modes hook) and skips its own camera code when the controller
    // owns the camera; this only reports changes the idle skip cannot see from the camera matrix
    update() { return !!M.glide || !!(M.orbit && M.orbit.hold > 0); },
    walk: {
      play() { if (M.mode !== 'walk') { M.walk().then(() => M.play(true, 4)); } else M.play(true, 4); emit('walkprogress', { t: walkT(), playing: true }); },
      pause() { M.play(false); emit('walkprogress', { t: walkT(), playing: false }); },
      seek(t) { const i = Math.round(Math.max(0, Math.min(1, t)) * (nStops() - 1)); if (M.mode !== 'walk') M.walk(M.D.stops[i].id); else if (i !== M.stopIndex || !M.glide) { if (i !== M.stopIndex) M.goStop(i); } emit('walkprogress', { t: walkT(), playing: !!M.autoplay }); },
      get t() { return walkT(); }, get playing() { return !!M.autoplay; },
    },
    zoom(f) { const c = player.camera; c.fov = THREE.MathUtils.clamp(c.fov * f, 30, 75); c.updateProjectionMatrix(); inv(); },
    dispose() {
      clearTimeout(M._auto); M.autoplay = false; M.glide = null; M.orbit = null;
      if (M.veils.parent) M.veils.parent.remove(M.veils);
      // the veils own their geometry and materials (buildVeils), so they are freed here; the keydown handler goes too
      M.veils.traverse(o => o.geometry?.dispose()); if (M.veilMats) for (const m of Object.values(M.veilMats)) if (m?.isMaterial) m.dispose();
      if (M._onKey) { removeEventListener('keydown', M._onKey); M._onKey = null; }
      if (M.layer) M.layer.remove(); if (M.stick?.destroy) M.stick.destroy();
      for (const o of M.meshes) o.userData.rrHide = false;
      if (player.modes === M) { player.modes = null; player.walkClamp = null; player.beforeMerge = null; player.collisionFilter = null; }
    },
  };
  return ctl;
}
