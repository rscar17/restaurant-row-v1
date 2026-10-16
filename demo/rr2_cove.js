// Emissive cove bands and cove LED strips as live light.
// Two kinds of source light the coffers and trays in Ryan's 360s:
//   1. the Delmonico tray steps (tray_M1_step, tray_M2_step, tray_FW_step) wear rr_del_cove_wash / _hi, a Principled
//      BSDF whose Emission Strength is a Map Range of the world Z position (14 at the bottom of the band down to 0 about
//      10 cm higher);
//   2. the cove LED strips (tray_*_led, tray_*_cr_to_field) wear rot_cove_led, an Emission node at strength 8 fed by a
//      2700 K Blackbody.
// Both are long thin strips, so each straight run is drawn as a line light: its irradiance at a receiver is integrated
// in closed form along the run (Lambert at both ends, two sided like Cycles mesh emission). A zEmission band is split
// in three lines over its strength profile so the crown mouldings right above it get the strong near field the 360s
// show (cr0/cr1 soffits read 1.8 to 2.3 linear in the reference, 0.4 to 0.6 in m54). The old point patches with a
// 0.5 m2 footprint flattened that near field to nothing and washed the coffer field instead.
// Constant Principled emitters in CONST_GROUPS (Sugarcane's Material_108 strips, laptop operator) keep the patch path.
// Ceiling audit numbers (ceiling2, Oct 13): agent_ceiling2/targets_py.txt (bands), targets_led.txt (LED trays).
import * as THREE from 'three';

const N = 64;   // nearest constant emitter patches (Material_108 path)
const NS = 20;  // nearest line lights
// cove5 (Oct 14): the crown slot sides get their own share of the nearest set: up to NS_SLOT nearest slot sides, the
// rest to the nearest other lines (a share left unused goes to the other kind). With 16 nearest of all lines only 3 or
// 4 of the 13 slot sides made it at B084, B080, B000, B085, so most of the crown edge had no slot glow at all
const NS_SLOT = 8;
// cove6 (Oct 14): the nearest set is now picked by SIDES, all or nothing. ab5 found 57 lines (39 band lines, 3 per tray
// side, 13 crown slot sides, 5 LED strips) ranked one by one into 20 slots, so the cut split sides: some kept their slot
// glow without the band wash (raw orange stripe over dark steps: B084 nx, B081 pz, B076 pz, B077 px), others lost both.
// A side is a band run's 3 lines plus the parallel slot line whose midpoint is within SIDE_MATCH (0.6 m), or a single LED
// strip. The 3 band lines share one uniform slot (a pack: heights in SA.y, SB.y, SB.w, strengths in SP.xyz, colour x
// gain in SL.rgb, SL.w < 0 marks it). The receiver runs the same 3 line terms as before while it is inside the band's
// reach fade (rho < BAND.r1 plus the spread of the heights) and skips the pack past it, where each line adds an exact
// zero anyway. A far field of one line at the strength weighted height was tried and is NOT within 1 %: past 0.3 m
// mean 6 %, worst 100 % at grazing receivers where the receiver plane cuts between the 3 heights
// (agent_cove6/tools/packtest.mjs). The lid, fill and reach of a pack are the BAND constants. Every side of a tray
// whose outline holds the camera's footprint goes in first. Flags: covePack = 0 gives each band line its own slot again
// (sides still whole), coveSides = 0 the old per line pick (NS_SLOT reservation, coveNSlot, coveSlotR).
const SIDE_MATCH = 0.6;
// cove7 (Oct 14): band visibility. m75 (cove6, whole sides) lit surfaces the band cannot see: the corridor soffit, fascia
// boxes and upper walls outside and under the trays came out 20 to 30 of 255 too bright (B075 px soffit 206 against 170),
// and the field strip right over the crown slot took the full band wash on top of the slot glow, so the orange slot line
// read peach (saturation 0.51 to 0.56 against 0.61 to 0.68). A band line now reaches a receiver only when
//   1. the receiver is on the coffer side of the side's line (ns points into the tray, a and b ordered so; the band
//      faces into the coffer, its outer face is hidden, hideSide): sdb = dot(P - A, ns) > -VIS.sd;
//   2. the receiver is no lower than the band's bottom minus VIS.dy, 1 cm (the band's From Min, SP.w of a pack: 3.855
//      M1/M2, 3.575 FW): the corridor ceiling is level with it (3.85, 3.57) and faces down, everything under it (walls,
//      the fascia boxes over the storefronts) is out;
//   3. the receiver's projection on the line is within the side's run, softly past its ends (VIS.end m): a receiver
//      outside the next side of the same tray is in this side's half plane but past its end;
//   4. above the crown top (cr_top, band bottom + VIS.lidY: 3.855 + 0.245 = 4.10 for M1/M2, 3.575 + 0.245 = 3.82 for FW)
//      the ray from the line to the receiver crosses the cr_top plate when it does so within VIS.mouth of the line (the
//      slot mouth, 0.145 to 0.155): the field over the slot keeps only VIS.keep of the band (what bounces in off cr_top),
//      the rest of its light is the slot strip's glow (SLOT.inK). The lid test (dh >= lidW) is unchanged past it.
// Flags: coveVis = 0 turns 1 to 3 off, coveVisLid = 0 turns 4 off.
const VIS = { sd: 0.01, dy: 0.01, end: 0.3, lidY: 0.245, mouth: 0.15, mouthW: 0.02, keep: 0.1 };
// cove8 (Oct 14): the band factor on the outer side of a side (VIS test 1) per receiver kind. m78 (0.3 for all) took the
// upper corridor walls and the fascias under the crowns closer to the 360s (MIL2 m2_sign mil_sign_marble, GJL_Straight
// gjl_connector gjl_conn_cream, gjl_wall_right rot_rustband, Mesh_1666 mil_wall_white) but also lit the vertical faces of
// the corridor bulkheads between the trays (DEL_Ceiling ceil_step, rr_del_cream; their undersides ceil_soffit barely
// moved) by 14 to 18 luma (B084 py 145 to 159, B080 nz 146 to 164, B075 nz 153 to 167). A normal split (m80) cannot tell
// them apart: both are vertical. Their materials can: no wall material in these boxes is used by a ceiling object (ray cast ids,
// agent_cove8). A receiver material used by any mesh of a ceiling group (OUT.groups) or named like a ceiling piece
// (OUT.names) takes OUT.beam, every other receiver OUT.wall. A per material uniform (uCoveOutK), so the split adds no
// program. Flags: coveOut sets the beam factor, coveOutWall the wall factor.
const OUT = { beam: 0, wall: 0.3, groups: /^(DEL_Ceiling|del_ceiling|CeilingDetail)$/, names: /^(ceil_|tray_)/ };
// wallup (agent_walls, Oct 14, flag wallup=1): the corridor walls between the door heads and the cove (m2_sign
// mil_sign_marble, gjl_rust_over_L/R and gjl_wall_right rot_rustband, Mesh_1666 mil_wall_white, gjl_connector
// gjl_conn_cream, rot_ceiling rot_drum_cream, the gjl_black heads, mil_reveal cl_v2_bronze) render 26 to 37 luma under the
// 360s on m83_full while the corridor ceiling (rr_del_cream, horizontal) and rr_beige_pier match within 2. The missing
// light is near neutral to cool in linear terms (mil_sign_marble ref minus ours 0.158 0.179 0.202), so it is not cove
// spill (1 : 0.66 : 0.37): it is the bounce off the cream ceiling, the coffers and the opposite upper wall, which the
// 1.6 m capture cannot see from its height (its horizontal view is the dark storefront band). Added as extra capture
// irradiance (iblIrradiance x WALLUP.k x tint) on vertical receivers inside a height window, wall materials only (the
// cove8 OUT split: every ceiling piece and bulkhead material binds 0), so the doors (below lo0), the floor and the
// ceilings (normal test) and the bulkheads (material) cannot move. Flags: wallupK scales k, wallupT = [r, g, b] tint,
// wallupY = [lo0, lo1, hi0, hi1] height window in m. skip: receivers in the window that already match the 360s on m83
// (mat_m2_rail, rr_beige_pier, mil_oak_reeded, rr_bead, rr_del_plaster, the cove wash, labels: predicted worse with the
// term, tools/predict.py); flag wallupSkip = a regex source replaces it.
const WALLUP = { k: 1, tint: [0.35, 0.5, 0.75], y: [2.7, 2.95, 5.2, 5.5], skip: /^(mat_m2_rail|rr_beige_pier|mil_oak_reeded|rr_bead|rr_del_plaster|rr_del_cove_wash|rr_label_|mil_ceiling|del_plank)/ };
// loop counts bound by a switched off receiver (patch with on = false)
const COVE_OFF = { value: 0 };

// Blender graph test: Geometry.Position -> Separate XYZ.Z -> Map Range -> Principled Emission Strength
function zEmission(graph) {
  if (!graph) return null;
  const nodes = graph.nodes || [], links = graph.links || [];
  const mr = nodes.find(n => n.type === 'MAP_RANGE'); const bsdf = nodes.find(n => n.type === 'BSDF_PRINCIPLED');
  if (!mr || !bsdf) return null;
  const toStrength = links.some(l => l[0] === mr.name && l[2] === bsdf.name && /Emission Strength/.test(l[3]));
  const fromZ = links.some(l => l[2] === mr.name && l[1] === 'Z');
  if (!toStrength || !fromZ) return null;
  const i = mr.in || {}, c = bsdf.in?.['Emission Color'] || [1, 1, 1, 1], bc = bsdf.in?.['Base Color'] || [1, 1, 1, 1];
  // one diffuse bounce inside the cove recess, whose own surface is the band's base colour. Measured hue of the light
  // the band adds to the coffer field and crown soffits (B080, B075, B000, B070 up faces): 1 : 0.66 : 0.37; emission
  // times base^0.5 gives 1 : 0.67 : 0.36. The old base^2 tint (1 : 0.51 : 0.14) was the orange wash.
  const m = Math.max(bc[0], bc[1], bc[2]) || 1;
  const tint = [0, 1, 2].map(k => c[k] * Math.sqrt(bc[k] / m));
  return { a: i['From Min'], b: i['From Max'], s0: i['To Min'], s1: i['To Max'], clamp: mr.clamp !== false, color: tint };
}

// Blender's Blackbody node returns a colour of luminance 1 (the glTF export of rot_cove_led, 2700 K at strength 8, is
// factor (1, 0.415, 0.099) x 15.48: 15.48 / 8 = 1.935 = 1 / luminance). Same fit as bl_blackbody in blender_nodes.
function blackbody(T) {
  const t = Math.min(Math.max(T, 800), 12000) / 100, cl = v => Math.min(Math.max(v, 0), 1);
  const r = t <= 66 ? 1 : cl(1.29293618606 * Math.pow(t - 60, -0.1332047592));
  const g = t <= 66 ? cl(0.390081578769 * Math.log(t) - 0.631841443788) : cl(1.12989086089 * Math.pow(t - 60, -0.0755148492));
  const b = t >= 66 ? 1 : (t <= 19 ? 0 : cl(0.543206789110 * Math.log(t - 10) - 1.19625408914));
  const c = [r, g, b].map(v => Math.pow(v, 2.2)); const L = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return c.map(v => v / L);
}

// cove LED strips: an Emission node at a fixed strength of 5 or more (rot_cove_led: 8, 2700 K)
const STRIP_MIN = 5;
const STRIP_CAP = 4; // covefix3: visible radiance clamp of the strips (clampStrip)
function stripEmission(graph) {
  if (!graph) return null;
  const nodes = graph.nodes || [], links = graph.links || [];
  const em = nodes.find(n => n.type === 'EMISSION'); if (!em) return null;
  if (links.some(l => l[2] === em.name && l[3] === 'Strength')) return null;
  const s = +(em.in?.Strength ?? 1); if (!(s >= STRIP_MIN)) return null;
  const toCol = links.find(l => l[2] === em.name && l[3] === 'Color');
  let col;
  if (toCol) { const src = nodes.find(n => n.name === toCol[0]); if (src?.type !== 'BLACKBODY' || links.some(l => l[2] === src.name)) return null; col = blackbody(+(src.in?.Temperature ?? 1500)); }
  else col = (em.in?.Color || [1, 1, 1, 1]).slice(0, 3);
  return { s, color: col };
}

// constant emitters (Sugarcane's Material_108 light strips: a Principled BSDF with a fixed Emission Strength of 16.8,
// nothing linked into its emission). Cycles lights the arched Sugarcane room from those strips; the viewer left its
// ceiling and shelf wall black at B002 / B009 nx (m48 audit). Only strengths of about 5 and over count, and only in
// the groups that ask for it (CONST_GROUPS), so signs, lenses and globes elsewhere keep their current look.
const CONST_MIN = 5, CONST_GROUPS = /^CL_Sug/;
function constEmission(graph) {
  if (!graph) return null;
  const nodes = graph.nodes || [], links = graph.links || [];
  const bsdf = nodes.find(n => n.type === 'BSDF_PRINCIPLED'); if (!bsdf) return null;
  if (links.some(l => l[2] === bsdf.name && /^Emission (Strength|Color)$/.test(l[3]))) return null;
  const s = +(bsdf.in?.['Emission Strength'] ?? 0), c = bsdf.in?.['Emission Color'] || [0, 0, 0, 1];
  if (!(s >= CONST_MIN) || Math.max(c[0], c[1], c[2]) < 0.05) return null;
  return { a: -1e9, b: 1e9, s0: s, s1: s, clamp: true, color: [c[0], c[1], c[2]], constant: true };
}

// Line light fit (ceiling2): predicted = m54 - old patches + new lines, against the 360s on the up faces of B080, B075,
// B000, B070 (bands) and B013, B018, B020 (LED trays). Band gain 2.2 with a reach fade from 0.4 to 1.0 m halves the
// error of the field falloff (0.096 -> 0.045 mean |log ratio|); strip gain 1.5 with a fade from 0.6 to 1.4 m takes the
// LED trays from 0.134 to 0.037. Flags: coveZ, coveS scale the two gains.
const BAND = { gain: 2.2, r0: 0.4, r1: 1.0, lidW: 0.16, lidK: 1.2, fill: 0.6 };
const STRIP = { gain: 1.5, r0: 0.6, r1: 1.4, maxH: 0.08, minLen: 0.5 };
// crown slot LEDs (tray_M1/M2/FW_cr_to_field): the strip stands at the back of a 3 cm slot between cr_top (4.10) and the
// coffer field (4.13), 0.15 m behind the crown's inner edge (cr0..cr2 step 5 cm each). In Cycles its light leaves the slot after bouncing off
// cr_top and the field's underside, and the 360s show a saturated orange band on the field right inside the crown
// (B084 py display 195 123 50 over about 10 px; m56 228 186 138, cream). A line at the strip's own height lies 1.5 cm
// under the field, so the field sees it at grazing incidence and gets almost nothing. The slot line is dropped by
// drop (3.5 cm, between the cr2 soffit at 4.065 and cr_top at 4.10, so no crown soffit is coplanar with it) and scaled
// by gain. Flags: coveSlotDrop, coveSlot.
// ceiling4 (Oct 14): the m58 drop changed no pixel because the test read o.name, and three names every loaded mesh
// after its glTF node ('n01530'); the Blender name lives in the inventory row (userData.invName, set by
// assignCaptureLighting). With the slot found, the line keeps its height (drop 0) and the slot gets its own term on
// the field just past the crown's inner edge (the mouth, md from the strip): the B084 py reference, crown edge to
// field (x 350, y 229 to 248, 4.9 mm per px on the field plane), against the cream next to it, reads
// R 0.75 G 0.42 B 0.145 at the edge, 0.58 0.39 0.21 at 2.2 cm, 0.92 0.86 0.80 at 5 cm (display, sRGB decoded): the
// crown hides most of the room's light from that strip of field (occ 0.85, gone by 6 cm) and the slot adds an
// orange glow, irradiance about 1.8 0.6 0.02 at the edge with an e-fold of 3.5 cm (K x line colour x tint).
// The plain line term is kept only past the mouth (the crown faces under cr_top and the corridor side never see the
// strip). Flags: coveSlot (gain of the plain line), coveSlotDrop, coveSlotK, coveSlotLen, coveSlotOcc, noslot.
// cove5 (Oct 14): the reference is orange INSIDE the slot too (the field's underside seen through the 3 cm gap over
// cr_top, w 0.12 to 0.145 m from the strip: 201 130 55 display at B084, 206 130 55 at B080), and stays orange to about
// 3 cm past the mouth before it turns cream by 6 cm. m60 gated the slot interior off (cream there) and its orange was
// one 2 cm strip right past the mouth, the thin line of the audits. m62 (polish) lit the slot interior with u = 0 but
// with no lower bound on the distance, so every field point BEHIND a slot side (sd < 0: the other tray's field, both
// at 4.13) got the full glow: B080 py 75 % orange pixels. The glow is now confined to a hard window along the slot
// normal, w = distance from the strip in [0, mouth + umax], umax 0.08 m, as well as the field height band and the
// side's own length (tp in 0..1); outside it the term is exactly zero. Fitted on the B084 and B080 py faces (field
// pixels binned by w, per side; agent_cove5/fit.py): mean |error| 4.3 and 6.1 of 255 against 35 for m60, with
// K 3.0, tint 1 0.95 0.4, e-fold 5 cm, occlusion 0.8 fading from 2 to 7.5 cm past the mouth. Flags: coveSlotK,
// coveSlotOcc, coveSlotLen, coveSlotMax (umax), noslot.
// cove7 (Oct 14): inside the slot (sd < 0, the field's underside over cr_top) the glow is inK times stronger. K 3.0 was
// fitted on m63, whose slot interior also took the full band wash (the band lines had no visibility term); with the band
// now cut there (VIS) the interior lost about 40 % of its light. Side views (B077 px, B075 nz, B000 px) with no band in
// the slot (m73) read 165 104 32 display, linear 0.47 0.19 0.04; the 360s 224 143 64 (0.89 0.35 0.10) on the side faces
// and 200 to 204, 126 to 129, 56 on the py faces (0.73 to 0.76, 0.29 to 0.31, 0.10). inK 1.5 with VIS.keep 0.1 of the band
// gives about 0.80 0.35 0.095 there (between the two; glow alone is too saturated, 0.04 of blue). Flag coveSlotIn.
const SLOT = { re: /_cr_to_field$/, drop: 0, gain: 1.0, mouth: 0.15, k: 3.0, tint: [1, 0.95, 0.4], len: 0.05, occ: 0.8, occ0: 0.02, occ1: 0.075, umax: 0.08, inK: 1.5 };
// the Delmonico band's hottest bottom (From Min to From Min + 3 cm) stands behind the lip and its upturned lipface
// (tray_M*_lip 5 mm under From Min, lipface top 3 cm over it): no camera under the ceiling sees it in Cycles. In
// the viewer it showed through the hairline cracks of the lip as rows of white dots (m56/m58 B084 py, B080 py on
// tray_M2_lip, with tray_M2_step right behind it). Its visible emission is dropped below that height. Flag bandLip (m).
const BAND_LIP = 0.03;
// Near ceiling glow of the round downlights (agent_lamps, Oct 14). The 80 W IES spots (radius 6 cm, 175 deg cone) hang
// 1.6 cm under their lens; in the 360s the soffit and trim right around each lit fixture glow, and fixtures with no
// lamp, or with a radius 0 lamp (tfix_dlL*, 30 W), show a bare disc. Measured on the py faces, linear, around
// downlight_53 and _54 (B003, B009, B010, B017; rr_del_cream soffit, background 0.62): radiance excess 1.45 at
// r = 0.125 m, 0.5 at 0.175, 0.1 at 0.25, nothing past 0.35, an exponential of length 0.048 m. The live SpotLights
// never reach the ceiling above them, so each lamp with a radius adds that excess to the down facing receivers from
// 2 cm under it to 20 cm over it: E = amp exp(-(max(r, rMin) - 0.125) / len), amp = pi 1.45 / 0.74 (rr_del_cream
// luminance albedo) = 6.15 per 80 W, scaled by power. Flags: dlGlow scales amp (0 turns it off), dlLen the length.
// The fixture trim (rr_trim_mat, r 0.07 to 0.10 m, diffuse 0.86 x (1 - metallic 0.6) = 0.34) reads 10.4 linear in the
// B009 py reference (trim_53 median; trim_42 19.5) and 212 181 141 display in m56: the grey ring. trimK x amp over
// r < 0.105 takes it to 0.34 / pi x 6.15 x 15 = 10. Flag dlTrim sets trimK.
const DLG = { trimK: 0, // m59: the trim disc landed on a receiver above the lens and drew a second offset disc; off until placed on the trim itself
  trimKOn: 15, amp80: 6.15, len: 0.048, rMin: 0.06, rMax: 0.4, minRadius: 0.03, dyLo: -0.02, dyHi: 0.2 };
const ND = 16; // nearest downlights
const visKey = () => { const F = globalThis.RR_FLAGS || {}; return (F.coveVis === 0 ? 'v' : '') + (F.coveVisLid === 0 ? 'l' : ''); };

export class CoveLights {
  constructor() {
    this.patches = []; this.segs = [];
    this.uP = { value: Array.from({ length: N }, () => new THREE.Vector4()) };
    // loop counts of the receiver loops: the slots update() fills (nearest first, min(N, patches) and min(NS, segs)); the
    // slots past them are zero and were skipped by the old constant bound loops, so the result is the same, and a bound the
    // compiler cannot see keeps FXC from unrolling 64 + 16 loop bodies in every receiver program
    this.uNP = { value: 0 }; this.uNS = { value: 0 };
    this.uL = { value: Array.from({ length: N }, () => new THREE.Vector4()) }; this.uN = { value: Array.from({ length: N }, () => new THREE.Vector3()) };
    this.uSA = { value: Array.from({ length: NS }, () => new THREE.Vector4()) }; this.uSB = { value: Array.from({ length: NS }, () => new THREE.Vector4()) };
    this.uSL = { value: Array.from({ length: NS }, () => new THREE.Vector4()) }; this.uSP = { value: Array.from({ length: NS }, () => new THREE.Vector4()) };
    this.dls = []; this.uND = { value: 0 };
    this.uDP = { value: Array.from({ length: ND }, () => new THREE.Vector4()) }; this.uDC = { value: Array.from({ length: ND }, () => new THREE.Vector4()) };
    this.frame = 0;
  }
  // lights: Blender lights (scene_extra.lights); keeps the down pointing spots with a radius (the 80 W and 35 W IES
  // downlights). root: when given, a lamp counts only if a surface lies within dyHi over it (a short ray up) and it is
  // not over a ceiling: 80 W lamps that sit in the void over a tray or soffit (B080: downlight_197 to 210, 1 m over
  // tray_M2_field; B009: downlight_116 to 142, 1 to 2.2 m over rot_soffit_south) would otherwise fill the nearest set
  // with glows nobody can see. Runs on the unmerged meshes, before mergeStatic
  addDownlights(lights, root = null) {
    const F = globalThis.RR_FLAGS || {}, k = F.dlGlow ?? 1; if (!(k > 0)) return 0;
    const ray = root ? new THREE.Raycaster() : null; if (ray) { ray.near = 0; ray.far = DLG.dyHi + 0.02; root.updateMatrixWorld(true); }
    const upV = new THREE.Vector3(0, 1, 0), downV = new THREE.Vector3(0, -1, 0), nW = new THREE.Vector3(), meshes = []; this.voidLamps = new Set(); if (root) root.traverse(o => { if (o.isMesh && o.visible !== false) meshes.push(o); });
    const C = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1), pos = new THREE.Vector3();
    // every lamp over 1.5 m: a lamp over a ceiling sees the first surface under it from its back (a down facing face).
    // Kept in voidLamps for the live light pool (RR_FLAGS.lampVoid, rr2_player.js); the cove term skips them
    if (ray) for (const l of lights) {
      if (l.type === 'SUN') continue;
      const M = C.clone().multiply(new THREE.Matrix4().fromArray(l.matrix.flat()).transpose()); pos.setFromMatrixPosition(M); if (pos.y < 1.5) continue;
      ray.far = 8; ray.set(pos, downV); const h = ray.intersectObjects(meshes, false).find(x => x.distance > 0.35 && x.face); // past 35 cm: a globe or shade around the lamp is not a ceiling
      if (h) { nW.copy(h.face.normal).transformDirection(h.object.matrixWorld); if (nW.y < -0.5) this.voidLamps.add(l.name); }
    }
    for (const l of lights) {
      if (l.type !== 'SPOT' || !((l.radius ?? 0) >= DLG.minRadius) || this.voidLamps.has(l.name)) continue;
      const M = C.clone().multiply(new THREE.Matrix4().fromArray(l.matrix.flat()).transpose()); pos.setFromMatrixPosition(M);
      // pointing down only (a wall washer next to a ceiling is not a downlight): the lamp shines along its local -Z
      const zy = new THREE.Vector3().setFromMatrixColumn(M, 2).normalize().y; if (zy < 0.9) continue;
      const P = l.energy * ((l.node_strength && l.node_strength[0]) ?? 1); if (!(P > 0)) continue;
      if (ray) { ray.far = DLG.dyHi + 0.02; ray.set(pos, upV); if (!ray.intersectObjects(meshes, false).length) continue; }
      const c = l.color || [1, 1, 1], lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] || 1;
      this.dls.push({ name: l.name, p: pos.clone(), amp: DLG.amp80 * k * P / 80, c: [c[0] / lum, c[1] / lum, c[2] / lum] });
    }
    return this.dls.length;
  }
  // root: loaded scene; mats: Blender material graphs by name (scene_extra.materials)
  collect(root, mats, gain = 1) {
    root.updateMatrixWorld(true);
    const F = globalThis.RR_FLAGS || {};
    const cells = new Map(), A = new THREE.Vector3(), B = new THREE.Vector3(), Cc = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nrm = new THREE.Vector3();
    root.traverse(o => {
      if (!o.isMesh || o.isInstancedMesh) return;
      const graph = mats[o.material?.name]?.graph;
      const zem = zEmission(graph);
      if (zem) { this.capEmitter(o.material, this.hideSide(o), true, Math.min(zem.a, zem.b) + (F.bandLip ?? BAND_LIP)); this.addLines(o, { kind: 'z', em: zem, gain: F.coveZ ?? BAND.gain }); return; }
      const strip = stripEmission(graph);
      if (strip) {
        // the strip's void side (behind the crown, above ceil level) showed through the hairline cracks of the corridor
        // ceiling as dotted lines along the crown's outer edge (m56 B000, B084, B080 py); hide it like the bands, but keep
        // the strip's own radiance (no cap, no recess glow: it is an Emission node with no base colour)
        // rot_cove_led is shared by the slot strips (normals inward, hide -1) and the open trays G, P1 (hide +1), so the
        // side to hide is a per mesh uniform set just before each draw, not a compile time constant
        if (F.covefix3) this.clampStrip(o.material); // before capStrip, so unwrapCap (unifyVariants) keeps it
        if ((globalThis.RR_FLAGS || {}).stripHide) this.capStrip(o, this.hideSide(o)); // opt in: m58 turned the corridor LED slot lines and Matteo's sconce tube black
        const slot = !F.noslot && SLOT.re.test(o.userData.invName || o.name || '');
        this.addLines(o, { kind: 's', em: strip, gain: F.coveS ?? STRIP.gain, slot, root: slot ? root : null }); return; }
      if (!(F.coveall || (F.coveconst && CONST_GROUPS.test(o.userData.invGroup || '')))) return; // opt in: m55 showed no visible gain and 1900+ patches crowd out the Delmonico coves
      const em = constEmission(graph); if (!em) return;
      // a constant strip keeps its own visible glow (no cap); its light uses its own gain (flag coveC, default the cove gain)
      this.constEmitters = (this.constEmitters || 0) + 1;
      const k = F.coveC ?? gain;
      const g = o.geometry, pos = g.attributes.position, idx = g.index, n = idx ? idx.count : pos.count;
      const col = new THREE.Color(em.color[0] * k, em.color[1] * k, em.color[2] * k);
      for (let i = 0; i < n; i += 3) {
        A.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld);
        B.fromBufferAttribute(pos, idx ? idx.getX(i + 1) : i + 1).applyMatrix4(o.matrixWorld);
        Cc.fromBufferAttribute(pos, idx ? idx.getX(i + 2) : i + 2).applyMatrix4(o.matrixWorld);
        // sample each triangle on a 6 x 6 barycentric grid so the Z gradient of the strength is followed
        e1.subVectors(B, A); e2.subVectors(Cc, A); nrm.crossVectors(e1, e2); const area = nrm.length() / 2; if (area < 1e-6) continue; nrm.normalize();
        const K = 6, da = area / (K * K);
        for (let u = 0; u < K; u++) for (let v = 0; v < K - u; v++) for (const up of [0, 1]) {
          if (up && u + v >= K - 1) continue;
          const bu = (u + (up ? 2 : 1) / 3) / K, bv = (v + (up ? 2 : 1) / 3) / K;
          const p = A.clone().addScaledVector(e1, bu).addScaledVector(e2, bv);
          let t = (p.y - em.a) / (em.b - em.a); if (em.clamp) t = Math.min(1, Math.max(0, t));
          const s = em.s0 + (em.s1 - em.s0) * t; if (s <= 0) continue;
          const key = Math.floor(p.x / 0.35) + ',' + Math.floor(p.y / 0.35) + ',' + Math.floor(p.z / 0.35) + ',' + Math.round(nrm.x * 2) + ',' + Math.round(nrm.z * 2) + ',' + Math.round(nrm.y * 2);
          let c = cells.get(key); if (!c) cells.set(key, c = { p: new THREE.Vector3(), n: new THREE.Vector3(), w: 0, flux: new THREE.Vector3() });
          const w = s * da; c.p.addScaledVector(p, w); c.n.addScaledVector(nrm, w); c.w += w; c.flux.x += col.r * s * da; c.flux.y += col.g * s * da; c.flux.z += col.b * s * da;
        }
      }
    });
    for (const c of cells.values()) { c.p.multiplyScalar(1 / c.w); c.n.normalize(); this.patches.push(c); }
    this.buildSides();
    this.report = { patches: this.patches.length, lines: this.segs.length, bandLines: this.segs.filter(s => s.kind === 'z').length, stripLines: this.segs.filter(s => s.kind === 's').length,
      slotLines: this.segs.filter(s => s.slotMd > 0).map(s => s.name + ':' + s.slotMd.toFixed(2) + (s.slotProbe ? '' : '?')) };
    return this.patches.length + this.segs.length;
  }
  // sides (cove6): each band side (its 3 lines) takes the nearest parallel slot line with its midpoint within SIDE_MATCH;
  // a slot line or LED strip left over is a side of its own. group: the tray a side belongs to (the band mesh, or the
  // strip mesh), for the footprint test in update()
  buildSides() {
    const mid = (ax, az, bx, bz) => [(ax + bx) / 2, (az + bz) / 2], dir = (ax, az, bx, bz) => { const l = Math.hypot(bx - ax, bz - az) || 1; return [(bx - ax) / l, (bz - az) / l]; };
    const bands = (this.bandSides || []).map(p => { p.slot = null; p.lines = p.lines.filter(l => l.kind === 'z'); return p; }), out = bands.slice();
    for (const s of this.segs) {
      if (s.kind !== 's') continue;
      if (s.slotMd > 0) {
        const m = mid(s.a.x, s.a.z, s.b.x, s.b.z), d = dir(s.a.x, s.a.z, s.b.x, s.b.z); let best = null, bd = SIDE_MATCH;
        for (const p of bands) {
          if (p.slot) continue; const mp = mid(p.ax, p.az, p.bx, p.bz), dp = dir(p.ax, p.az, p.bx, p.bz);
          const dm = Math.hypot(mp[0] - m[0], mp[1] - m[1]); if (dm < bd && Math.abs(d[0] * dp[0] + d[1] * dp[1]) > 0.95) { bd = dm; best = p; }
        }
        if (best) { best.slot = s; best.lines.push(s); continue; }
      }
      out.push({ side: true, kind: s.slotMd > 0 ? 'slot' : 'strip', name: s.name, group: s.name, lines: [s], slot: s.slotMd > 0 ? s : null });
    }
    // cove7: orient every band side so that ns = (D.z, 0, -D.x) points into its tray (the shader's visibility gate). The
    // paired slot line already points inward (slotProbe); without one, the side of the line where a point 5 cm off the
    // midpoint lies inside the tray's outline (even odd over the group's sides), else the side of the band mesh's centre
    for (const p of bands) {
      let nx = p.bz - p.az, nz = -(p.bx - p.ax); const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l; let sg = 0;
      if (p.slot) { const D = p.slot.b.clone().sub(p.slot.a); sg = Math.sign(D.z * nx - D.x * nz); }
      if (!sg) {
        const g = bands.filter(q => q.group === p.group), [mx, mz] = mid(p.ax, p.az, p.bx, p.bz);
        const inside = (x, z) => { let odd = false; for (const q of g) if ((q.az > z) !== (q.bz > z) && x < q.ax + (z - q.az) * (q.bx - q.ax) / (q.bz - q.az)) odd = !odd; return odd; };
        if (g.length >= 3) sg = inside(mx + nx * 0.05, mz + nz * 0.05) ? 1 : (inside(mx - nx * 0.05, mz - nz * 0.05) ? -1 : 0);
        if (!sg && p.center) sg = (p.center[0] - mx) * nx + (p.center[1] - mz) * nz >= 0 ? 1 : -1;
      }
      if (sg < 0) { [p.ax, p.az, p.bx, p.bz] = [p.bx, p.bz, p.ax, p.az]; for (const l of p.lines) if (l.kind === 'z') { const t = l.a; l.a = l.b; l.b = t; } }
      p.inward = sg !== 0;
    }
    this.sides = out;
  }
  // straight vertical runs of an emitter mesh -> line lights (world space, three is Y up)
  addLines(o, { kind, em, gain, slot = false, root = null }) {
    const g = o.geometry, pos = g.attributes.position, idx = g.index, n = idx ? idx.count : pos.count;
    const runs = new Map(), A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), nr = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    for (let i = 0; i < n; i += 3) {
      A.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld);
      B.fromBufferAttribute(pos, idx ? idx.getX(i + 1) : i + 1).applyMatrix4(o.matrixWorld);
      C.fromBufferAttribute(pos, idx ? idx.getX(i + 2) : i + 2).applyMatrix4(o.matrixWorld);
      nr.crossVectors(e1.subVectors(B, A), e2.subVectors(C, A)); const l = nr.length(); if (l < 1e-8) continue; nr.multiplyScalar(1 / l);
      if (Math.abs(nr.y) > 0.3) continue; // only the vertical faces of a band or strip emit sideways into the cove
      const h = Math.hypot(nr.x, nr.z); const nx = nr.x / h, nz = nr.z / h;
      // one run per plane: two-sided, so a normal and its opposite are the same run
      const sg = (nx > 1e-3 || (Math.abs(nx) <= 1e-3 && nz > 0)) ? 1 : -1, ux = nx * sg, uz = nz * sg;
      const off = A.x * ux + A.z * uz;
      const key = Math.round(ux * 100) + ',' + Math.round(uz * 100) + ',' + Math.round(off / 0.02);
      let r = runs.get(key); if (!r) runs.set(key, r = { ux, uz, off, smin: 1e9, smax: -1e9, ymin: 1e9, ymax: -1e9 });
      for (const P of [A, B, C]) { const s = -P.x * uz + P.z * ux; r.smin = Math.min(r.smin, s); r.smax = Math.max(r.smax, s); r.ymin = Math.min(r.ymin, P.y); r.ymax = Math.max(r.ymax, P.y); }
    }
    for (const r of runs.values()) {
      const len = r.smax - r.smin; if (len < 0.05) continue;
      const pt = s => [r.ux * r.off - r.uz * s, r.uz * r.off + r.ux * s]; // x, z of the point at arc s along the run
      const [ax, az] = pt(r.smin), [bx, bz] = pt(r.smax);
      if (kind === 'z') {
        // three lines over the emitting part of the band, each at the strength weighted height of its third
        const lo = Math.max(r.ymin, Math.min(em.a, em.b)), hi = Math.min(r.ymax, Math.max(em.a, em.b)); if (hi <= lo) continue;
        const str = y => { let t = (y - em.a) / (em.b - em.a); if (em.clamp) t = Math.min(1, Math.max(0, t)); return Math.max(0, em.s0 + (em.s1 - em.s0) * t); };
        // the side's pack (cove6): heights and strengths of its 3 lines; a third with no strength keeps I 0
        const bc = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
        const pk = { side: true, kind: 'band', name: o.name, group: o.name, center: [bc.x, bc.z], lines: [], ax, az, bx, bz, eps: (hi - lo) / 6 + 0.01, Lc: em.color.map(c => c * gain), y: [lo, lo, lo], I: [0, 0, 0], lo };
        for (let q = 0; q < 3; q++) {
          const y0 = lo + (hi - lo) * q / 3, y1 = lo + (hi - lo) * (q + 1) / 3; let I = 0, Iy = 0; const M = 24;
          for (let k = 0; k < M; k++) { const y = y0 + (y1 - y0) * (k + 0.5) / M, s = str(y) * (y1 - y0) / M; I += s; Iy += s * y; }
          if (I <= 0) continue; const yc = Iy / I;
          const seg = { kind, name: o.name, a: new THREE.Vector3(ax, yc, az), b: new THREE.Vector3(bx, yc, bz), eps: (y1 - y0) / 2 + 0.01,
            L: em.color.map(c => c * I * gain), r0: BAND.r0, r1: BAND.r1, lidW: BAND.lidW, lidK: BAND.lidK, fill: BAND.fill, lo };
          this.segs.push(seg); pk.lines.push(seg); pk.y[q] = yc; pk.I[q] = I; pk.eps = seg.eps;
        }
        if (pk.lines.length) (this.bandSides ||= []).push(pk);
      } else {
        const hgt = r.ymax - r.ymin; if (hgt > STRIP.maxH || len < STRIP.minLen) continue;
        const F = globalThis.RR_FLAGS || {};
        const yc = (r.ymin + r.ymax) / 2 - (slot ? (F.coveSlotDrop ?? SLOT.drop) : 0), I = em.s * hgt * (slot ? (F.coveSlot ?? SLOT.gain) : 1);
        const seg = { kind, name: o.userData.invName || o.name, a: new THREE.Vector3(ax, yc, az), b: new THREE.Vector3(bx, yc, bz), eps: hgt / 2 + 0.01,
          L: em.color.map(c => c * I * gain), r0: STRIP.r0, r1: STRIP.r1, lidW: 0, lidK: 0, fill: 0 };
        if (slot) {
          // inward side (towards the field) and mouth depth: the field lies right over the strip's top on the inward side
          // and cr_top right under its bottom, out to the crown's inner edge. ns = (D.z, 0, -D.x) in the shader must point
          // inward, so a and b swap when it does not. Fallback (no hit): the object's centre side, mouth SLOT.mouth
          const pr = root ? this.slotProbe(root, seg.a, seg.b, r.ymin, r.ymax) : null;
          let inX, inZ;
          if (pr) { inX = pr.nx; inZ = pr.nz; } else { const c = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()), mx = (ax + bx) / 2, mz = (az + bz) / 2;
            inX = r.ux; inZ = r.uz; if ((c.x - mx) * inX + (c.z - mz) * inZ < 0) { inX = -inX; inZ = -inZ; } }
          const D = seg.b.clone().sub(seg.a); if (D.z * inX - D.x * inZ < 0) { const t = seg.a; seg.a = seg.b; seg.b = t; }
          seg.slotMd = pr ? pr.md : SLOT.mouth; seg.slotProbe = !!pr; seg.slotDy = r.ymax - yc;
        }
        this.segs.push(seg);
      }
    }
  }
  // slot probe: short rays from the strip's mid run, on each side, up to the field and down to cr_top; the side with both
  // is inward. The mouth is the first 1 cm step out from the strip with no cr_top under the strip's bottom (to 0.4 m)
  slotProbe(root, a, b, ymin, ymax) {
    const meshes = this._probeMeshes || (this._probeMeshes = (() => { const l = []; root.traverse(o => { if (o.isMesh && !o.isInstancedMesh && o.visible !== false) l.push({ o, bb: new THREE.Box3().setFromObject(o) }); }); return l; })());
    const mid = a.clone().add(b).multiplyScalar(0.5), D = b.clone().sub(a).setY(0).normalize(), n = new THREE.Vector3(D.z, 0, -D.x);
    const box = new THREE.Box3(mid.clone().addScalar(-0.5), mid.clone().addScalar(0.5)); const near = meshes.filter(m => m.bb.intersectsBox(box)).map(m => m.o); if (!near.length) return null;
    const ray = new THREE.Raycaster(), up = new THREE.Vector3(0, 1, 0), dn = new THREE.Vector3(0, -1, 0), p = new THREE.Vector3(), h = ymax - ymin, yc = (ymin + ymax) / 2;
    const hit = (x, z, dir, far) => { p.set(x, yc, z); ray.set(p, dir); ray.near = 0; ray.far = far; return ray.intersectObjects(near, false).length > 0; };
    for (const s of [1, -1]) {
      const x = mid.x + n.x * s * 0.03, z = mid.z + n.z * s * 0.03;
      if (!hit(x, z, up, h / 2 + 0.01) || !hit(x, z, dn, h / 2 + 0.01)) continue;
      let md = 0.4; for (let k = 4; k <= 40; k++) if (!hit(mid.x + n.x * s * k * 0.01, mid.z + n.z * s * k * 0.01, dn, h / 2 + 0.01)) { md = (k - 0.5) * 0.01; break; }
      return { nx: n.x * s, nz: n.z * s, md };
    }
    return null;
  }
  // which side of a band must not glow: the Delmonico steps face outward, into the ceiling void above ceil_soffit, and
  // only their back is seen from the corridor. Through the hairline cracks of the soffit and crown (T junctions) the
  // void side showed its strength 14 bottom edge as rows of white dots (B080 py, nz, px: speckles along the trims).
  // +1: hide the front (normals point away from the object's centre), -1: hide the back, 0: keep both.
  hideSide(o) {
    const g = o.geometry, pos = g.attributes.position, idx = g.index, n = idx ? idx.count : pos.count; if (!n) return 0;
    const bb = new THREE.Box3().setFromObject(o), c = bb.getCenter(new THREE.Vector3());
    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), nr = new THREE.Vector3(), m = new THREE.Vector3();
    let out = 0, inn = 0;
    for (let i = 0; i < n; i += 3) {
      A.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld); B.fromBufferAttribute(pos, idx ? idx.getX(i + 1) : i + 1).applyMatrix4(o.matrixWorld); C.fromBufferAttribute(pos, idx ? idx.getX(i + 2) : i + 2).applyMatrix4(o.matrixWorld);
      nr.crossVectors(B.clone().sub(A), C.clone().sub(A)); if (Math.abs(nr.y) > 0.3 * nr.length()) continue;
      m.copy(A).add(B).add(C).multiplyScalar(1 / 3); const d = (c.x - m.x) * nr.x + (c.z - m.z) * nr.z;
      if (d < 0) out++; else if (d > 0) inn++;
    }
    return out > 0 && !inn ? 1 : (inn > 0 && !out ? -1 : 0);
  }
  // the band itself: its bottom millimetres run at strength 14. Seen from the corridor (B080/B075/B070 side faces) the
  // 360s show a soft orange band, median linear 1.2 0.66 0.27 (display 223 172 115), with a peach hot edge at the bottom,
  // 90th percentile 4.3 3.4 2.5 (247 231 213). m54: median 0.55 0.32 0.13 and a hard edge capped at 2.5.
  // Now: the void side shows no emission, the visible emission is capped at 4.5 with its own hue (p90 target), and the
  // band's surface adds the glow of the light bouncing in the recess (base colour squared x 1.65 = 0.59 0.35 0.12, which
  // takes the m54 median 0.55 0.32 0.13 to the reference 1.17 0.66 0.29).
  // cove LED strips: only the side test, per mesh (uCoveHide), the emission keeps its full radiance
  capStrip(o, hide) {
    const m = o.material; if (!m) return; const prevR = o.onBeforeRender;
    o.onBeforeRender = function (r, sc, cam, g, mat, grp) { if (prevR) prevR.apply(this, arguments);
      const u = mat.userData.coveHideU; if (u && u.value !== hide) { u.value = hide; mat.uniformsNeedUpdate = true; } };
    if (m.userData.coveCapped) return;
    m.userData.coveCapped = true; m.userData.coveHide = 0; m.userData.coveGlow = false; m.userData.coveHideU ||= { value: 0 };
    const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey; m.userData.coveCapBase = { obc: prev, key: prevKey };
    m.onBeforeCompile = (sh, r) => { if (prev) prev.call(m, sh, r);
      sh.uniforms.uCoveHide = m.userData.coveHideU;
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uCoveHide;')
        .replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>
  #ifndef FLAT_SHADED
  if ((dot(normalize(vNormal), vViewPosition) >= 0.0 ? 1.0 : -1.0) * uCoveHide > 0.5) totalEmissiveRadiance = vec3(0.0);
  #endif`); };
    m.customProgramCacheKey = () => (prevKey ? prevKey.call(m) : '') + '|covestrip1';
    m.needsUpdate = true;
  }
  // covefix3 (Oct 14, flag covefix3=1): visible radiance clamp of the cove LED strips (rot_cove_led: 15.48 x
  // (1, 0.415, 0.099) = 15.5 6.4 1.5 linear, uncapped; the band cap above never applied to strips). The scene target is
  // 4x MSAA half float, resolved in linear BEFORE the grade, so an edge pixel a quarter covered by the strip still holds
  // 3.9 linear red and grades to the same white as the core: the strip edges stay a hard 1 px staircase (sweep: white
  // sawtooth cove lines at S40 to S43 on tray_FE_led, S43y000p80 x 700 y 240 picked on tray_FE_led over the tray_FE wall,
  // and, suspected, the beaded stair-stepped lines the floor mirror draws of them, S26 S32 S33 S34 p00). The peak is
  // brought down to STRIP_CAP (4) and the hue pulled toward white by 0.68 (1 - cap / peak), which is what the Neutral
  // part of the grade would have done to the full value: 15.48 6.43 1.53 and the clamped 4 2.84 2.21 both grade to about
  // 253 227 211 (Python check of Khronos Neutral at -0.35 EV; m95 B013 pz core 249 232 217, Cycles 252 244 236), so the
  // core keeps its colour and the resolve can blend the edges. A plain per channel min would grade to 252 252 190
  // (yellow). The strip's light (line lights, em.s from the graph) is not touched. Flag covefix3Cap sets the cap.
  clampStrip(m) {
    if (!m || m.userData.coveClamp) return; m.userData.coveClamp = true;
    const c = +((globalThis.RR_FLAGS || {}).covefix3Cap ?? STRIP_CAP); if (!(c > 0)) return;
    const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
    m.onBeforeCompile = (sh, r) => { if (prev) prev.call(m, sh, r);
      sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>
  { float cvP = max(max(totalEmissiveRadiance.r, totalEmissiveRadiance.g), totalEmissiveRadiance.b);
    if (cvP > ${c.toFixed(3)}) totalEmissiveRadiance = ${c.toFixed(3)} * mix(totalEmissiveRadiance / cvP, vec3(1.0), 0.68 * (1.0 - ${c.toFixed(3)} / cvP)); }`); };
    m.customProgramCacheKey = () => (prevKey ? prevKey.call(m) : '') + '|cvclamp' + c.toFixed(3);
    m.needsUpdate = true;
  }
  // glow = false: only the side test, the emission keeps its full radiance
  // lipY: no visible emission under this world height (the band's bottom behind the lip, BAND_LIP)
  capEmitter(m, hide = 0, glow = true, lipY = null) {
    if (!m) return; if (m.userData.coveCapped) { if (m.userData.coveHide !== hide) m.userData.coveHide = 0; if (m.userData.coveLip !== lipY) m.userData.coveLip = null; return; }
    m.userData.coveCapped = true; m.userData.coveHide = hide; m.userData.coveGlow = glow; m.userData.coveLip = lipY;
    // &lipuni=1 (link agent, Oct 14): the lip height is a uniform, not a constant in the GLSL and the cache key, so cove
    // caps with different lips share one program
    (m.userData.coveLipU ||= { value: 0 }).value = lipY ?? 0;
    const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey; m.userData.coveCapBase = { obc: prev, key: prevKey };
    m.onBeforeCompile = (sh, r) => { if (prev) prev.call(m, sh, r);
      const hs = (m.userData.coveHide || 0).toFixed(1), lip = m.userData.coveLip, LU = !!+((globalThis.RR_FLAGS || {}).lipuni || 0);
      if (lip != null) {
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vCapWY;').replace('#include <fog_vertex>', '#include <fog_vertex>\n  vCapWY = (modelMatrix * vec4(transformed, 1.0)).y;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vCapWY;' + (LU ? '\nuniform float uCapLip;' : ''));
        if (LU) { (m.userData.coveLipU ||= { value: 0 }).value = +lip; sh.uniforms.uCapLip = m.userData.coveLipU; }
      }
      sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>
  {
    #ifndef FLAT_SHADED
      float cvSide = dot(normalize(vNormal), vViewPosition) >= 0.0 ? 1.0 : -1.0; // geometric side, also right in the floor mirror
    #else
      float cvSide = 0.0;
    #endif
    if (cvSide * ${hs} > 0.5) totalEmissiveRadiance = vec3(0.0);
    ${lip != null ? `else if (vCapWY < ${LU ? 'uCapLip' : (+lip).toFixed(4)}) totalEmissiveRadiance = diffuseColor.rgb * diffuseColor.rgb * 1.65;` : ''}
    ${m.userData.coveGlow === false ? '' : `else {
      float em = max(max(totalEmissiveRadiance.r, totalEmissiveRadiance.g), totalEmissiveRadiance.b); if (em > 4.5) totalEmissiveRadiance *= 4.5 / em;
      totalEmissiveRadiance += diffuseColor.rgb * diffuseColor.rgb * 1.65;
    }`}
  }`); };
    m.customProgramCacheKey = () => (prevKey ? prevKey.call(m) : '') + '|covecap3' + (m.userData.coveHide || 0) + (m.userData.coveGlow === false ? 'n' : '') + (m.userData.coveLip != null ? (+((globalThis.RR_FLAGS || {}).lipuni || 0) ? 'lu' : 'l' + (+m.userData.coveLip).toFixed(4)) : '');
    m.needsUpdate = true;
  }
  // receivers: every material on a mesh that reaches above 2.5 m (ceilings, coffers, cornices, upper walls)
  patchReceivers(root) {
    if (!this.patches.length && !this.segs.length && !this.dls.length) return 0; const bb = new THREE.Box3(), done = new Set(); let n = 0;
    // cove8: materials of ceiling pieces (OUT) keep the band dark on a side's outer half plane, the rest get OUT.wall
    const FO = globalThis.RR_FLAGS || {}, kBeam = +(FO.coveOut ?? OUT.beam), kWall = +(FO.coveOutWall ?? OUT.wall), ceil = new Set();
    const kWallUp = FO.wallup ? +(FO.wallupK ?? WALLUP.k) : 0; const wuSkip = FO.wallupSkip ? new RegExp(FO.wallupSkip) : WALLUP.skip;
    root.traverse(o => { if (o.isMesh && o.material && (OUT.groups.test(o.userData.invGroup || '') || OUT.names.test(o.userData.invName || ''))) for (const m of [].concat(o.material)) ceil.add(m); });
    this.outReport = { beam: 0, wall: 0 };
    root.traverse(o => { if (!o.isMesh || !o.material || Array.isArray(o.material) || !o.material.isMeshStandardMaterial || o.material.transparent) return;
      bb.setFromObject(o); if (bb.max.y < 2.5) return; const m = o.material; if (done.has(m)) return; done.add(m);
      const isBeam = ceil.has(m); (m.userData.coveOutU ||= { value: kBeam }).value = isBeam ? kBeam : kWall; this.outReport[isBeam ? 'beam' : 'wall']++; (m.userData.wallUpU ||= { value: 0 }).value = isBeam || wuSkip.test(m.name || '') ? 0 : kWallUp;
      this.patch(m); n++; });
    return n;
  }
  // on = false: the receiver code without its light (unifyVariants, rr2_probes.js), so a ceiling material and a wall
  // material of the same Blender structure share one program: a switched off copy binds loop counts of 0, runs no
  // iteration and adds a zero to the indirect diffuse
  patch(material, on = true) {
    const ud = material.userData;
    if (ud.coveCode) { if (on && !ud.coveLit) { ud.coveLit = true; material.needsUpdate = true; } return; }
    ud.coveCode = true; ud.coveLit = on;
    const prev = material.onBeforeCompile, prevKey = material.customProgramCacheKey, self = this; ud.coveBase = { obc: prev, key: prevKey };
    const usePatches = this.patches.length > 0, useSegs = this.segs.length > 0, useDl = this.dls.length > 0;
    material.onBeforeCompile = (sh, r) => {
      if (prev) prev.call(material, sh, r);
      const lit = !!material.userData.coveLit, FV = globalThis.RR_FLAGS || {}, F_vis = FV.coveVis ?? 1, F_lid = FV.coveVisLid ?? 1;
      if (usePatches) { sh.uniforms.uCoveNP = lit ? self.uNP : COVE_OFF; sh.uniforms.uCoveP = self.uP; sh.uniforms.uCoveL = self.uL; sh.uniforms.uCoveN = self.uN; }
      if (useDl) { sh.uniforms.uCoveND = lit ? self.uND : COVE_OFF; sh.uniforms.uCoveDP = self.uDP; sh.uniforms.uCoveDC = self.uDC; }
      if (useSegs) { sh.uniforms.uCoveNS = lit ? self.uNS : COVE_OFF; sh.uniforms.uCoveSA = self.uSA; sh.uniforms.uCoveSB = self.uSB; sh.uniforms.uCoveSL = self.uSL; sh.uniforms.uCoveSP = self.uSP;
        sh.uniforms.uCoveOutK = material.userData.coveOutU ||= { value: +((globalThis.RR_FLAGS || {}).coveOut ?? OUT.beam) }; }
      const WU = !!FV.wallup; if (WU) sh.uniforms.uWallUpK = material.userData.wallUpU ||= { value: 0 };
      if (!/varying vec3 vCoveWP/.test(sh.vertexShader)) {
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vCoveWP;')
          .replace('#include <fog_vertex>', '#include <fog_vertex>\n  vCoveWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      }
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vCoveWP;
${WU ? 'uniform float uWallUpK;\n' : ''}${useDl ? `uniform vec4 uCoveDP[${ND}]; uniform vec4 uCoveDC[${ND}]; uniform int uCoveND;` : ''}
${usePatches ? `uniform vec4 uCoveP[${N}]; uniform vec4 uCoveL[${N}]; uniform vec3 uCoveN[${N}]; uniform int uCoveNP;` : ''}
${useSegs ? `uniform vec4 uCoveSA[${NS}]; uniform vec4 uCoveSB[${NS}]; uniform vec4 uCoveSL[${NS}]; uniform vec4 uCoveSP[${NS}]; uniform int uCoveNS; uniform float uCoveOutK;
// irradiance at P (normal nr) from a two sided Lambertian line A..B, per unit of strength x height:
// E = |n_s.v0| |D| int_t0^t1 (nr.v(t)) / |v(t)|^4 dt, v(t) = v0 + t D, softened by eps (half the strip height)
float coveLineE(vec3 P, vec3 nr, vec3 A, vec3 B, float eps, out float rho, out float dh, out float dz, out float tp) {
  vec3 D = B - A, v0 = A - P; float a = dot(D, D); float b = dot(v0, D);
  vec3 ns = normalize(vec3(D.z, 0.0, -D.x));
  vec3 perp = v0 - D * (b / a); float c = dot(v0, v0) + eps * eps;
  float De = max(a * (dot(perp, perp) + eps * eps), 1e-10), sD = sqrt(De);
  rho = length(perp); dh = abs(dot(v0, ns)); dz = -v0.y; tp = -b / a;
  float b0 = dot(nr, v0), b1 = dot(nr, D), t0 = 0.0, t1 = 1.0;
  if (abs(b1) > 1e-6) { float tz = -b0 / b1; if (b1 > 0.0) t0 = max(t0, tz); else t1 = min(t1, tz); } else if (b0 <= 0.0) return 0.0;
  if (t1 <= t0) return 0.0;
  float Q0 = (a * t0 + 2.0 * b) * t0 + c, Q1 = (a * t1 + 2.0 * b) * t1 + c;
  float G0 = atan((a * t0 + b) / sD) / sD, G1 = atan((a * t1 + b) / sD) / sD;
  float F0 = b0 * ((a * t0 + b) / (2.0 * De * Q0) + a / (2.0 * De) * G0) + b1 * (-(b * t0 + c) / (2.0 * De * Q0) - b / (2.0 * De) * G0);
  float F1 = b0 * ((a * t1 + b) / (2.0 * De * Q1) + a / (2.0 * De) * G1) + b1 * (-(b * t1 + c) / (2.0 * De * Q1) - b / (2.0 * De) * G1);
  return max(sqrt(a) * dh * (F1 - F0), 0.0);
}` : ''}`)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
  {
    vec3 nW = normalize((vec4(normal, 0.0) * viewMatrix).xyz); vec3 Ec = vec3(0.0); float cvOcc = 0.0;
    ${usePatches ? `for (int i = 0; i < uCoveNP; i++) {
      vec4 P = uCoveP[i]; if (P.w <= 0.0) continue;
      vec3 d = P.xyz - vCoveWP; float r2 = dot(d, d); if (r2 > 1.3) continue; vec3 l = d * inversesqrt(max(r2, 1e-6));
      float cr = max(dot(nW, l), 0.0), cs = abs(dot(uCoveN[i], l)); // Cycles mesh emission leaves both sides of a face
      // patch footprint (P.w = its area) keeps the inverse square finite right next to the band; fade out at 3 m
      Ec += uCoveL[i].rgb * cs * cr / (r2 + P.w) * (1.0 - smoothstep(0.4, 1.1, sqrt(r2))); // m45: a 3 m reach washed the whole coffer orange; the 360s keep it near the cove
    }` : ''}
    ${useSegs ? `for (int i = 0; i < uCoveNS; i++) {
      vec4 SA = uCoveSA[i]; if (SA.w <= 0.0) continue; vec4 SB0 = uCoveSB[i], SL0 = uCoveSL[i], SP0 = uCoveSP[i];
      // band side pack (SL.w < 0): lines at heights SA.y, SB.y, SB.w with strengths SP.xyz, colour x gain SL.rgb. All 3
      // run while the receiver is within the reach fade (rho < ${BAND.r1}) of any of them; past it every one of them adds an
      // exact zero, so the pack is skipped (rho at the strength weighted height minus the spread of the heights bounds each
      // line's own rho from below)
      bool pk = SL0.w < 0.0; int nq = 1; vec3 hq = vec3(SA.y), Iq = vec3(1.0, 0.0, 0.0);
      if (pk) {
        float It = SP0.x + SP0.y + SP0.z; vec3 hy = vec3(SA.y, SB0.y, SB0.w); float yw = dot(SP0.xyz, hy) / max(It, 1e-6);
        vec3 Am = vec3(SA.x, yw, SA.z), Dm = vec3(SB0.x, yw, SB0.z) - Am; vec3 wm = vCoveWP - Am;
        vec3 cm = wm - Dm * (dot(wm, Dm) / max(dot(Dm, Dm), 1e-8)); vec3 dyq = abs(hy - yw);
        float rq = ${BAND.r1.toFixed(4)} + max(max(dyq.x, dyq.y), dyq.z) + 0.002;
        nq = dot(cm, cm) < rq * rq ? 3 : 0; hq = hy; Iq = SP0.xyz;
      }
      for (int q = 0; q < nq; q++) {
      float hy1 = q == 0 ? hq.x : (q == 1 ? hq.y : hq.z), Iq1 = q == 0 ? Iq.x : (q == 1 ? Iq.y : Iq.z);
      vec4 SB = pk ? vec4(SB0.x, hy1, SB0.z, ${BAND.lidW.toFixed(4)}) : SB0;
      vec4 SL = pk ? vec4(SL0.rgb * Iq1, 0.0) : SL0;
      vec4 SP = pk ? vec4(${[BAND.r0, BAND.r1, BAND.lidK, BAND.fill].map(v => v.toFixed(4)).join(', ')}) : SP0;
      vec3 A3 = vec3(SA.x, pk ? hy1 : SA.y, SA.z);
      float rho, dh, dz, tp; float e = coveLineE(vCoveWP, nW, A3, SB.xyz, SA.w, rho, dh, dz, tp);
      if (SL.w > 0.0) {
        // crown slot (SL.w = mouth depth, SP.z = field height over the line, SP.w = glow length; ns points inward):
        // only the field past the mouth sees the strip; right there the crown shades it and the slot glows orange
        vec3 Ds = SB.xyz - A3; vec3 nsI = normalize(vec3(Ds.z, 0.0, -Ds.x)); float sd = dot(vCoveWP - A3, nsI) - SL.w;
        if (sd < -0.005) e = 0.0;
        // slot glow, bounded on all sides: the field height band, the side's own length, and along the inward normal
        // from the strip itself (sd = -mouth) to umax past the mouth. Nothing behind the strip (the other tray, the
        // corridor ceiling) and nothing deeper in the field can get it
        if (nW.y < -0.5 && abs(vCoveWP.y - A3.y - SP.z) < 0.012 && tp > 0.0 && tp < 1.0 && sd > -SL.w && sd < ${(+((globalThis.RR_FLAGS || {}).coveSlotMax ?? SLOT.umax)).toFixed(3)}) {
          float u = max(sd, 0.0), ends = smoothstep(0.0, 0.1 / sqrt(dot(Ds, Ds)), min(tp, 1.0 - tp));
          float win = 1.0 - smoothstep(${SLOT.occ0.toFixed(3)}, ${SLOT.occ1.toFixed(3)}, u);
          Ec += SL.rgb * vec3(${SLOT.tint.map(v => v.toFixed(3)).join(', ')}) * ${(+((globalThis.RR_FLAGS || {}).coveSlotK ?? SLOT.k)).toFixed(3)} * exp(-u / SP.w) * win * ends * (1.0 + ${(+((globalThis.RR_FLAGS || {}).coveSlotIn ?? SLOT.inK) - 1).toFixed(3)} * (1.0 - smoothstep(-0.01, 0.0, sd)));
          cvOcc = max(cvOcc, ${(+((globalThis.RR_FLAGS || {}).coveSlotOcc ?? SLOT.occ)).toFixed(3)} * win * ends);
        }
      }
      if (SB.w > 0.0) {
        // the crown above a band (lid: SB.w deep, its inner edge seen at slope SP.z from the band) shades the coffer
        // field within about 0.2 m of the wall; the crown's own soffits sit inside the lid and keep the full light
        if (dh >= SB.w && dz > 0.0) e *= smoothstep(SP.z + 0.2, SP.z - 0.2, dz / max(dh, 1e-4));
        // light bouncing inside the recess reaches the crown's vertical faces too, which see no band directly
        // (reference cr0..cr2 faces 0.72 to 0.98 linear, m54 0.44 to 0.49)
        if (dh < SB.w && dz > 0.0 && dz < 0.3 && tp > 0.0 && tp < 1.0) e += SP.w * (1.0 - abs(nW.y));
      }
      ${F_vis !== 0 || F_lid !== 0 ? `if (SB.w > 0.0) {
        // band visibility (cove7, VIS in rr2_cove.js): coffer side of the line, not under the band, within the run, and
        // not over the crown top where cr_top hides the band (the slot strip). yb: the band bottom (a pack's SP.w; a
        // plain band line, flag covePack 0, its own height minus 0.1)
        vec3 Db = SB.xyz - A3; vec3 nb = normalize(vec3(Db.z, 0.0, -Db.x)); float yb = pk ? SP0.w : A3.y - 0.1;
        ${F_vis !== 0 ? `float lb = sqrt(dot(Db, Db));
        // m78: outside the tray the band factor is uCoveOutK (cove8, OUT: 0 on the ceiling pieces, the bulkheads and the
        // corridor ceiling; 0.3 on the upper walls and fascias); below the band bottom on the tray's own side (walls,
        // fascias under the crown) keep coveBelow 0.3, standing in for downlight wall wash
        if (dot(vCoveWP - A3, nb) < -${VIS.sd.toFixed(3)}) e *= uCoveOutK;
        else if (vCoveWP.y < yb - ${VIS.dy.toFixed(3)}) e *= ${(+((globalThis.RR_FLAGS || {}).coveBelow ?? 0.3)).toFixed(3)};
        e *= smoothstep(-${VIS.end.toFixed(3)}, 0.0, min(tp, 1.0 - tp) * lb);` : ''}
        ${F_lid !== 0 ? `float yl = yb + ${VIS.lidY.toFixed(3)};
        if (vCoveWP.y > yl && dz > 0.0 && dh < SB.w) e *= mix(${VIS.keep.toFixed(3)}, 1.0, smoothstep(${(VIS.mouth - VIS.mouthW).toFixed(3)}, ${(VIS.mouth + VIS.mouthW).toFixed(3)}, dh * (yl - A3.y) / max(dz, 1e-4)));` : ''}
      }` : ''}
      Ec += SL.rgb * e * (1.0 - smoothstep(SP.x, SP.y, rho));
      }
    }` : ''}
    ${useDl ? `if (nW.y < -0.5) for (int i = 0; i < uCoveND; i++) {
      vec4 D = uCoveDP[i]; float dyl = vCoveWP.y - D.y; if (dyl < ${DLG.dyLo.toFixed(3)} || dyl > ${DLG.dyHi.toFixed(3)}) continue;
      float r = length(vCoveWP.xz - D.xz); if (r > ${DLG.rMax.toFixed(3)}) continue;
      // the soffit around a downlight, lit by the lamp right under it (agent_lamps profile, see DLG in rr2_cove.js)
      Ec += uCoveDC[i].rgb * D.w * (exp(-(max(r, ${DLG.rMin.toFixed(3)}) - 0.125) / uCoveDC[i].w) * (1.0 - smoothstep(${(DLG.rMax - 0.1).toFixed(3)}, ${DLG.rMax.toFixed(3)}, r))
        + ${(+((globalThis.RR_FLAGS || {}).dlTrim ?? DLG.trimK)).toFixed(3)} * smoothstep(0.115, 0.095, r)) * (-nW.y);
    }` : ''}
${WU ? (() => { const FW = globalThis.RR_FLAGS || {}, t = FW.wallupT || WALLUP.tint, y = FW.wallupY || WALLUP.y, v = x => (+x).toFixed(3);
      return `    #ifdef USE_ENVMAP
    if (uWallUpK > 0.0) {
      // wallup: upper wall bounce the 1.6 m capture misses (WALLUP in rr2_cove.js); vertical receivers in the window only
      float wuV = 1.0 - smoothstep(0.3, 0.7, abs(nW.y));
      float wuH = smoothstep(${v(y[0])}, ${v(y[1])}, vCoveWP.y) * (1.0 - smoothstep(${v(y[2])}, ${v(y[3])}, vCoveWP.y));
      reflectedLight.indirectDiffuse += uWallUpK * wuV * wuH * vec3(${t.map(v).join(', ')}) * iblIrradiance * BRDF_Lambert(material.diffuseColor);
    }
    #endif
`; })() : ''}    reflectedLight.indirectDiffuse *= 1.0 - cvOcc; reflectedLight.directDiffuse *= 1.0 - cvOcc;
    reflectedLight.indirectDiffuse += Ec * BRDF_Lambert(material.diffuseColor);
  }`);
    };
    material.customProgramCacheKey = () => (prevKey ? prevKey.call(material) : '') + '|cove12' + visKey() + ((globalThis.RR_FLAGS || {}).wallup ? 'w' : '') + (usePatches ? 'p' : '') + (useSegs ? 's' : '') + (useDl ? 'd' : '');
    material.needsUpdate = true;
  }
  // take the receiver layer (unwrap) or the emitter cap layer (unwrapCap) off a material and put it back (unifyVariants
  // inserts a switched off layer underneath; each must be the outermost remaining layer when it comes off)
  unwrap(m) {
    const ud = m.userData; if (!ud.coveCode) return null; const st = { lit: !!ud.coveLit };
    m.onBeforeCompile = ud.coveBase.obc; m.customProgramCacheKey = ud.coveBase.key;
    delete ud.coveCode; delete ud.coveLit; delete ud.coveBase; return st;
  }
  unwrapCap(m) {
    const ud = m.userData; if (!ud.coveCapped) return null; const st = { hide: ud.coveHide || 0, glow: ud.coveGlow !== false, lip: ud.coveLip ?? null };
    m.onBeforeCompile = ud.coveCapBase.obc; m.customProgramCacheKey = ud.coveCapBase.key;
    delete ud.coveCapped; delete ud.coveHide; delete ud.coveGlow; delete ud.coveLip; delete ud.coveLipU; delete ud.coveCapBase; return st;
  }
  rewrapCap(m, st) { if (!st.glow) return this.capStrip({ material: m }, 0); this.capEmitter(m, st.hide, st.glow, st.lip); }
  // the slot entries for camPos (cove6): whole sides only. First every side of a tray whose outline (the xz polygon of
  // its sides, even odd test) holds the camera, then the rest by the side's nearest line, greedily, each side all or
  // nothing (a band side costs 1 with pack, else its line count, plus 1 for its slot line). Returns band packs (the side
  // objects) and plain lines. this.lastSides keeps the picked sides for reports
  pickSides(camPos, d2, pack = true) {
    const cost = s => s.kind === 'band' ? (pack ? 1 : s.lines.length - (s.slot ? 1 : 0)) + (s.slot ? 1 : 0) : 1;
    const ends = s => s.kind === 'band' ? [s.ax, s.az, s.bx, s.bz] : [s.lines[0].a.x, s.lines[0].a.z, s.lines[0].b.x, s.lines[0].b.z];
    const groups = new Map(); for (const s of this.sides) { const g = groups.get(s.group); g ? g.push(s) : groups.set(s.group, [s]); }
    const inside = new Set();
    for (const g of groups.values()) {
      if (g.length < 3) continue; let odd = false; const x = camPos.x, z = camPos.z;
      for (const s of g) { const [ax, az, bx, bz] = ends(s); if ((az > z) !== (bz > z) && x < ax + (z - az) * (bx - ax) / (bz - az)) odd = !odd; }
      if (odd) for (const s of g) inside.add(s);
    }
    // cove7: inside sides first, and among them nearest first (all at -1 kept this.sides order, so when they alone overflow
    // NS a far side of the tray could take the place of a near one)
    const rk = this.sides.map(s => { const d = Math.min(...s.lines.map(d2)); return [s, inside.has(s) ? d - 1e6 : d]; }).sort((a, b) => a[1] - b[1]);
    const pick = []; let used = 0;
    for (const [s] of rk) { const c = cost(s); if (used + c > NS) continue; used += c; pick.push(s); }
    this.lastSides = pick;
    const out = [];
    for (const s of pick) {
      if (s.kind !== 'band') { out.push(s.lines[0]); continue; }
      if (pack) out.push(s); else for (const l of s.lines) if (l !== s.slot) out.push(l);
      if (s.slot) out.push(s.slot);
    }
    return out;
  }
  // nearest sets of downlights, patches and lines for camPos. Throttled to every 15th call while walking (sorting a few
  // thousand entries each frame costs more than the slow drift of the set is worth). force = true (player.prepareView,
  // captures) recomputes now and restarts the cadence, so a view depends only on its camera position and never on how
  // many frames ran before it (m71: the same spot rendered from a 34 spot list and a 4 spot list differed in 6 to 10 %
  // of the px pixels, the first face of each spot drawn with the previous spot's set). A camera jump of more than
  // RR_FLAGS.coveJump metres (default 1.5, a mode switch or a teleport) also forces the update.
  update(camPos, force = false) {
    if (!this.patches.length && !this.segs.length && !this.dls.length) return;
    const jump = (globalThis.RR_FLAGS || {}).coveJump ?? 1.5;
    if (!force && this.lastPos && this.lastPos.distanceToSquared(camPos) > jump * jump) force = true;
    if (force) this.frame = 1; else if ((this.frame++ % 15) !== 0) return;
    this.updates = (this.updates || 0) + 1; (this.lastPos ||= new THREE.Vector3()).copy(camPos);
    if (this.dls.length) {
      const len = (globalThis.RR_FLAGS || {}).dlLen ?? DLG.len;
      const near = this.dls.map(d => [d, d.p.distanceToSquared(camPos)]).sort((a, b) => a[1] - b[1]).slice(0, ND); this.uND.value = near.length;
      for (let i = 0; i < ND; i++) { const d = near[i]?.[0];
        if (!d) { this.uDP.value[i].set(0, -1e4, 0, 0); this.uDC.value[i].set(0, 0, 0, 1); continue; }
        this.uDP.value[i].set(d.p.x, d.p.y, d.p.z, d.amp); this.uDC.value[i].set(d.c[0], d.c[1], d.c[2], len); }
    }
    if (this.patches.length) {
      const near = this.patches.map(c => [c, c.p.distanceToSquared(camPos)]).sort((a, b) => a[1] - b[1]).slice(0, N); this.uNP.value = near.length;
      for (let i = 0; i < N; i++) {
        const c = near[i]?.[0];
        if (!c) { this.uP.value[i].set(0, 0, 0, 0); continue; }
        const area = 0.5; // softer than the 0.35 m cells, so neighbouring patches merge into one band instead of scallops (m52)
        this.uP.value[i].set(c.p.x, c.p.y, c.p.z, area); this.uL.value[i].set(c.flux.x, c.flux.y, c.flux.z, 0); this.uN.value[i].copy(c.n);
      }
    }
    if (this.segs.length) {
      const line = new THREE.Line3(), q = new THREE.Vector3(), FR = globalThis.RR_FLAGS || {};
      const d2 = s => { line.set(s.a, s.b); line.closestPointToPoint(camPos, true, q); return q.distanceToSquared(camPos); };
      let near;
      if (FR.coveSides === 0 || !this.sides) {
        const all = this.segs.map(s => [s, d2(s)]).sort((a, b) => a[1] - b[1]);
        const sl = all.filter(x => x[0].slotMd > 0);
        // reserve slots only for slot sides within coveSlotR (default 10 m): m65 reserved 8 even at B012 to B020, where the
        // slot sides are 15 to 25 m away, and 4 nearby corridor lines dropped out (cove soffits darker, B019/B020 pz)
        const R2 = (FR.coveSlotR ?? 10) ** 2, nSlot = FR.coveNSlot ?? NS_SLOT;
        const res = sl.filter(x => x[1] < R2).slice(0, nSlot), rs = new Set(res);
        near = res.concat(all.filter(x => !rs.has(x)).slice(0, NS - res.length));
      } else near = this.pickSides(camPos, d2, FR.covePack !== 0).map(s => [s]);
      this.uNS.value = near.length;
      for (let i = 0; i < NS; i++) {
        const s = near[i]?.[0];
        if (!s) { this.uSA.value[i].set(0, 0, 0, 0); continue; }
        if (s.side) { // band side pack (see SIDE_MATCH)
          this.uSA.value[i].set(s.ax, s.y[0], s.az, s.eps); this.uSB.value[i].set(s.bx, s.y[1], s.bz, s.y[2]);
          this.uSL.value[i].set(s.Lc[0], s.Lc[1], s.Lc[2], -1); this.uSP.value[i].set(s.I[0], s.I[1], s.I[2], s.lo); continue;
        }
        this.uSA.value[i].set(s.a.x, s.a.y, s.a.z, s.eps); this.uSB.value[i].set(s.b.x, s.b.y, s.b.z, s.lidW);
        const sl = s.slotMd > 0, F = globalThis.RR_FLAGS || {};
        this.uSL.value[i].set(s.L[0], s.L[1], s.L[2], sl ? s.slotMd : 0); this.uSP.value[i].set(s.r0, s.r1, sl ? s.slotDy : s.lidK, sl ? (F.coveSlotLen ?? SLOT.len) : s.fill);
      }
    }
  }
}

// Ceiling crack backing (ceiling4, Oct 14). Dotted and dashed lines on the flat ceilings (m56/m58 B000 py: a dotted line
// from one downlight hole to the next and two 1 px streaks either side of a downlight; B084/B080 py along the tray lips)
// are not on any edge of the raw export's ceil_soffit; they are hairline cracks of the loaded sheets, and through them
// the camera sees the void 0.9 to 1.2 m higher (Mesh_2251, Mesh_1562, Mesh_1573: the slab lit by the 80 W lamps that
// hang over the soffit, white dots; dark slab, brown dots). A copy of each down facing ceiling sheet a few mm higher,
// same geometry and material (no new program), catches every ray through a crack with the colour of the sheet itself.
// Sheets: opaque standard meshes, not instanced, bottom over 3 m, under 0.35 m tall, over 1.5 m across, at least 80 %
// of their area facing down. Flags: crackBack = 0 turns it off, crackLift sets the lift (m, default 0.004).
export function addCrackBacking(root) {
  const F = globalThis.RR_FLAGS || {}; if (F.crackBack === 0 || F.crackBack === false) return { sheets: 0 };
  const lift = F.crackLift ?? 0.004, bb = new THREE.Box3(), A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), nr = new THREE.Vector3(), add = [];
  root.updateMatrixWorld(true);
  root.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || o.userData.crackBack || !o.material || Array.isArray(o.material) || !o.material.isMeshStandardMaterial || o.material.transparent) return;
    bb.setFromObject(o); if (bb.min.y < 3.0 || bb.max.y - bb.min.y > 0.35 || Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) < 1.5) return;
    const g = o.geometry, pos = g.attributes.position, idx = g.index, n = idx ? idx.count : pos.count; let down = 0, all = 0;
    for (let i = 0; i < n; i += 3) {
      A.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld); B.fromBufferAttribute(pos, idx ? idx.getX(i + 1) : i + 1).applyMatrix4(o.matrixWorld); C.fromBufferAttribute(pos, idx ? idx.getX(i + 2) : i + 2).applyMatrix4(o.matrixWorld);
      nr.crossVectors(B.clone().sub(A), C.clone().sub(A)); const a = nr.length(); all += a; if (a > 0 && Math.abs(nr.y) > 0.95 * a) down += a; // either winding: a sheet seen from below
    }
    if (!(all > 0) || down < 0.8 * all) return;
    add.push(o);
  });
  for (const o of add) {
    const c = new THREE.Mesh(o.geometry, o.material); c.name = (o.name || '') + ':crackback'; c.userData = { ...o.userData, crackBack: true };
    c.matrixAutoUpdate = false; c.matrix.copy(o.matrixWorld).premultiply(new THREE.Matrix4().makeTranslation(0, lift, 0));
    if (o.parent) { const inv = new THREE.Matrix4().copy(o.parent.matrixWorld).invert(); c.matrix.premultiply(inv); c.matrix.decompose(c.position, c.quaternion, c.scale); c.matrixAutoUpdate = true; o.parent.add(c); }
    c.castShadow = false; c.receiveShadow = o.receiveShadow; c.renderOrder = o.renderOrder; c.layers.mask = o.layers.mask;
  }
  return { sheets: add.length, names: add.slice(0, 40).map(o => o.userData.invName || o.name) };
}
