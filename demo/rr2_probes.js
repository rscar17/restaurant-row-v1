// Per-object capture lighting. Every object is lit and reflects from the Cycles capture that can see it (computed in
// Blender at export: inventory row .cap), falling back to the nearest capture. Objects no capture sees and that sit
// in a room interior get a dimmer share, because the corridor captures do not see the room lamps. Because the
// assignment is per object, nothing changes or pops as the visitor walks.
import * as THREE from 'three';
import { loadCaptureEnv } from './rr2_light.js';
import { makeBox, addBoxProjection } from './rr2_reflect.js';

// one shared scale for the diffuse part of the capture lighting (the specular part keeps full strength); live lamps add
// direct light on top, so the capture's own copy of that light is scaled down here instead of counted twice
export const IBL_DIFFUSE = { value: 1.0 };
// separate strength for surfaces facing up (floors) and down (ceilings), fitted against the 360s: the capture at 1.6 m sees
// the bright floor and pours it onto the ceilings, while in Cycles the ceilings sit above the downlights' cones
export const IBL_UP = { value: 1.0 }, IBL_DOWN = { value: 1.0 };
// colour of the capture light on surfaces facing up (floors, counters, tables). The light field is the Cycles 360 at 1.6 m,
// which sits outside nearly every downlight cone (SPOT lamps, colour 1.0 0.95 0.9, pointing down) but sees the warm coves and
// ceiling glow directly, so its upward irradiance is far warmer than what the floor under the cones receives in Cycles.
// Measured on the 25 reference linear captures (caps_small *_lin.f16): cosine weighted upper hemisphere of each 360 against
// the floor radiance straight down (ny) divided by the rr_plain_floor albedo gives a chromaticity ratio of R 1.157, G 0.996,
// B 0.722 (B000 to B020, B070, B071, B080, B082; spread B 0.46 to 1.05). Half of that correction in log terms, luminance
// kept (0.930 1.003 1.178), is applied: the live lamps (lights 0.25) and the mirror already carry part of the neutral
// light, and the full correction predicts an overshoot (floor b* -5.5 to -7.7 against the m56 offset of +3.8).
// RR_FLAGS.uptint = [r, g, b] overrides, [1, 1, 1] turns it off.
export const IBL_UP_TINT = { value: new THREE.Vector3(...((globalThis.RR_FLAGS || {}).uptint || [0.930, 1.003, 1.178])) };
// Light field from the Cycles captures (caps/sh.json: L2 spherical harmonics of each capture, three.js convention).
// Floor and ceiling pieces take their diffuse light from it, blended by distance between the nearest captures, so a
// floor never steps in brightness where one capture hands over to the next (Ryan: every tile the same shade).
// ceilfix (agent ceilfix, Oct 14): the field holds at most SHN captures and loadSHField dropped the rest without a word.
// The 34 captures plus B134 to B157 are 58: RR_FLAGS.shn = 58 (40 to 64) sizes the arrays for them. Each capture is 10
// fragment uniform vectors (58: 580), so check the compile log for a uniform limit error on the cove lit ceilings.
const SHN = Math.max(40, Math.min(64, +((globalThis.RR_FLAGS || {}).shn) || 40));
export const SHF = { pos: { value: Array.from({ length: SHN }, () => new THREE.Vector3(0, -1e4, 0)) }, c: { value: Array.from({ length: SHN * 9 }, () => new THREE.Vector3()) }, n: { value: 0 } };
// shtex (flag shtex=1, agent capwire, Oct 14): the field lives in a float data texture instead of the uShPos / uShC
// uniform arrays, so the capture count has no fixed bound (58 captures with the 23 new spots; 64 x 10 vec3 uniforms is
// near ANGLE's 1024 fragment vectors on D3D). One row per capture, 10 RGBA32F texels: texel 0 the position (three
// axes), texels 1 to 9 the nine L2 coefficients; read with texelFetch, so the values are the same float32 numbers the
// uniform arrays carry and the loop does the same arithmetic in the same order (same output for the same sh.json).
// The texture is replaced (old one disposed) when a later call loads more captures; the shader does not change.
export const shTexOn = () => !!(globalThis.RR_FLAGS || {}).shtex;
SHF.tex = { value: null };
export function setSHFieldTexture(entries) {
  const n = entries.length, data = new Float32Array(Math.max(n, 1) * 10 * 4);
  entries.forEach((v, i) => { const o = i * 40; data.set(v.pos, o); v.sh.forEach((c, k) => data.set(c, o + 4 * (k + 1))); });
  const t = new THREE.DataTexture(data, 10, Math.max(n, 1), THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.flipY = false; t.needsUpdate = true;
  const old = SHF.tex.value; SHF.tex.value = t; if (old) old.dispose();
  SHF.n.value = n; return n;
}
export async function loadSHField(url) {
  try { const j = await (await fetch(url)).json(); let i = 0;
    if (shTexOn()) return setSHFieldTexture(Object.values(j));
    for (const v of Object.values(j)) { if (i >= SHN) break; SHF.pos.value[i].set(...v.pos); v.sh.forEach((c, k) => SHF.c.value[i * 9 + k].set(...c)); i++; }
    SHF.n.value = i; if (Object.keys(j).length > i) console.warn('rr2_probes: light field holds ' + i + ' of ' + Object.keys(j).length + ' captures (raise RR_FLAGS.shn)'); return i; } catch (e) { return 0; }
}
// light field variant switched by a per material uniform: a material that carries the field code but is not a split sheet
// (userData.shCode without shField, set by unifyVariants) binds this zero count, so its loop runs no iteration and its
// result is the plain capture irradiance, exactly as without the code. Every material binds its own uShN: three runs
// onBeforeCompile for each material (once per material and program key), also when it reuses another material's program,
// and draws each material with its own uniforms.
// idnmat (Oct 14, agent_idnmat, flag idnmat=1): per material iblDown and a gain on down facing surfaces, keyed by
// material name, or by material name plus object class (Blender object name with digit and dot runs as '#', the
// inventory row name) where the class differs from the rest of its material. Fitted on m83_ab_ctrl / idn45 / idn35
// (idn 0.55 0.45 0.35) against the 360s at every labelled pixel facing down (ny < -0.7, /dev/shm/ab6/lab8.json,
// 271k samples, 9 spots): the pixel's linear value is a line in idn per run, the cell's idn and gain minimise the
// display MAE with shrinkage toward the material and then the global value. Leave one spot out MAE 10.95 against 14.81
// for the constant 0.55 and 12.73 for the best constant (0.47). Entries are [k, gain]: uIblDown = iblDown * k, so the
// table is relative to the base idn 0.55 it was fitted at. Unlisted materials take DEF. The gain multiplies the
// outgoing light only where the surface faces down (smoothstep 0.5 to 0.7 of -n.y, the fitted population), so walls
// and floors of a listed material keep their light. Per material uniforms on the probe clones: no extra programs.
// RR_FLAGS.idnmatDef sets DEF (1 keeps unlisted materials at the base idn), idnmatNoGain=1 drops the gain.
// v2 (Oct 14, agent_idnmat2): refit anchored on the real m87 run (v1 applied) at all 34 spots, 977k down facing
// samples (labels for the 25 spots without them from agent_ab6 lab.mjs, step 8). Per pixel the m87 value is scaled from
// v1's [k, gain] to the candidate's through the pixel's idn slope fraction f (from the m83 A/B runs where they exist,
// else the cell median), so the slope comes from the A/B runs and the level from the real v1 run. k and gain are fitted
// jointly per cell, k within 0.60 to 1.40 and gain within 0.76 to 1.30 (v1 had 0.36 to 1.64 and 0.5 to 1.6, and seven
// cells sat at those bounds). New key level 'material@=object' (the exact object name) where one class spans rooms:
// tray_M1_field (Milos coffers) and tray_M2_field (corridor) need different levels. DEF fitted on materials with too
// little data of their own, held within 0.80 to 0.92 of the base. Lookup order: material@=object, material@class, material, DEF.
// v3 (Oct 14, agent_idnmat3): refit on two real runs per pixel, m88 (v1) and m89 (v2). Per cell the pixel's linear value is
// g * Y * (1 - f + f k); f comes from the median ratio of the two runs (the m83 A/B median where k barely moved), Y from both
// runs, and k, g stay within the span of v1 and v2 plus half of it. Refit: every cell whose real m89 error was worse than
// m88. ceil_soffit is one split sheet that runs from the corridor into Milos: v1 was 7 to 17 bright in the corridor and 2
// to 4 dark over Milos, v2 darkened all of it by about 7, so it now has a zone (IDNMAT.z): split pieces whose centre lies in
// the box (Blender XY, Milos) take the zone entry; the zone keys its own clone (key '#z') on top of the per capture clones,
// no extra programs. rot_soffit_south goes back to v1 because rotramp was fitted on m88 (v1) and would count twice on v2.
// Cells where v1 predicted better than any fit keep v1. RR_FLAGS.idnmatNoZone=1 drops the zone. Predicted down facing MAE
// over 34 spots 9.21 (m88 real 10.21, m89 real 9.44), before rotramp.
export const IDNMAT = { v: 3.1, def: 0.85, t: {'Felt kvadrat 0967': [0.85, 0.88], 'Material_107': [0.85, 0.98], 'Material_107.003': [0.85, 1.3], 'Material_108': [0.927, 1.24], 'Material_109': [0.6, 0.76], 'Material_109.001': [0.85, 0.92], 'Material_110': [1.392, 1.06], 'Material_110.003': [0.98, 1], 'Material_492.002': [0.85, 1.3], 'Material_545': [1.392, 1.22], 'Material_548': [1.088, 1.18], 'Material_572': [0.855, 1.0], 'Material_622': [0.92, 1], 'Material_624': [0.85, 1], 'Material_87': [1.636, 1.14], 'Material_87.004': [0.364, 0.5], 'Plain Natural Texture': [0.85, 0.94], 'bmn_black': [0.85, 0.8], 'bmn_black_matte': [0.85, 1.3], 'bmn_black_matte@bmn_alcovesides': [0.85, 1], 'cl_ceil_plaster': [1.09, 1], 'cl_mt_doorwood.001': [1.64, 1.6], 'cl_mtr_intceil': [0.869, 0.845], 'cl_v2_bronze': [0.85, 1.3], 'del_plank': [0.6, 0.5], 'del_wood_dark': [0.85, 0.76], 'facetA_int_dark': [0.855, 1.0], 'gi_proj1180': [0.848, 0.9], 'gjl_black': [0.797, 0.6], 'mil_blossom': [0.85, 1.3], 'mil_ceiling': [1.4, 0.92], 'mil_copper': [0.85, 0.84], 'mil_fish_navy': [0.85, 1], 'mil_fish_teal': [0.85, 0.76], 'mil_letter_black': [0.85, 1], 'mil_oak_floor': [0.6, 0.76], 'mil_oak_reeded': [1.24, 1], 'mil_side_oak': [0.632, 0.913], 'mil_sign_marble': [0.85, 1.02], 'mil_sign_marble@Mesh_#': [0.85, 1], 'mil_sign_marble@m#_pier': [0.85, 1.06], 'mil_stool_fabric': [0.6, 0.76], 'mil_terracotta': [0.364, 0.5], 'mt_steel': [0.797, 0.66], 'mt_steel@=mt_head-21.4': [0.85, 0.76], 'mt_steel@=mt_trans-21.4_2.25': [0.85, 0.76], 'mt_steel@cl_mtr_tr_top': [0.6, 0.76], 'rot_crown': [0.95, 1], 'rot_crown@=tray_P1_lip': [0.92, 1], 'rot_crown@rot_coffers': [1.13, 1.06], 'rot_crown@rot_crown': [0.922, 0.773], 'rot_crown@rot_dentils': [0.95, 1.1], 'rot_crown@rot_mould_drum': [1.02, 1.16], 'rot_crown@rot_mould_ocB': [1.17, 1.3], 'rot_crown@rot_mould_step#': [0.84, 1], 'rot_crown@tray_P#_lip': [0.92, 1], 'rot_drum_cream': [1.27, 1.06], 'rot_rope_mat': [0.85, 1.24], 'rot_sky_proc': [0.91, 1.02], 'rr_bead': [0.99, 1.04], 'rr_bead@=tray_M1_bead0': [1.4, 0.78], 'rr_bead@=tray_M1_bead1': [1.39, 0.76], 'rr_bead@=tray_M1_cr0_soffit': [1.4, 1.12], 'rr_bead@=tray_M1_cr1_soffit': [1.4, 1.02], 'rr_bead@=tray_M1_cr2_soffit': [1.4, 0.9], 'rr_bead@=tray_M2_bead0': [1.4, 0.78], 'rr_bead@=tray_M2_bead1': [1.4, 0.76], 'rr_bead@=tray_M2_cr0_soffit': [1.4, 1.14], 'rr_bead@=tray_M2_cr1_soffit': [1.4, 1.02], 'rr_bead@=tray_M2_cr2_soffit': [1.4, 0.86], 'rr_bead@tray_FW_bead#': [0.99, 0.76], 'rr_bead@tray_FW_cr#_soffit': [1.4, 1.06], 'rr_bead@tray_M#_bead#': [1.4, 0.76], 'rr_bead@tray_M#_cr#_soffit': [1.4, 1.02], 'rr_del_black': [0.71, 1], 'rr_del_cream': [0.85, 1], 'rr_del_cream@=tray_M1_field': [0.98, 1], 'rr_del_cream@=tray_M1_lip': [0.96, 1], 'rr_del_cream@=tray_M2_field': [0.92, 0.88], 'rr_del_cream@=tray_M2_lip': [0.9, 0.96], 'rr_del_cream@ceil_corner_clean': [0.81, 0.76], 'rr_del_cream@ceil_patch_delwing': [0.364, 0.5], 'rr_del_cream@ceil_recess_L': [0.63, 0.94], 'rr_del_cream@ceil_soffit': [0.56, 1.294], 'rr_del_cream@cl#_fascia': [0.6, 0.76], 'rr_del_cream@cl_soffit_patch_P#': [1.05, 1.12], 'rr_del_cream@rot_soffit_ring': [0.62, 0.97], 'rr_del_cream@rot_soffit_south': [0.691, 1.28], 'rr_del_cream@tray_FW_field': [1.16, 0.86], 'rr_del_cream@tray_FW_lip': [0.82, 0.76], 'rr_del_cream@tray_G': [0.83, 1], 'rr_del_cream@tray_M#_field': [0.98, 0.9], 'rr_del_cream@tray_M#_lip': [0.9, 1], 'rr_del_cream@tray_P#': [0.89, 1], 'rr_del_dl': [0.98, 1], 'rr_del_plaster': [0.36, 0.5], 'rr_del_plaster@wing_front_header': [0.6, 1], 'rr_speaker': [0.9, 1.1], 'rr_speaker@=tfix_spkP11': [1.01, 1], 'rr_speaker@tfix_spkM#': [0.92, 1], 'rr_speaker@tfix_spkP#': [1, 1]}, z: {'rr_del_cream@ceil_soffit': { box: [[-7, -14], [12, 2]], e: [0.728, 1.335], ry: [-10.5, -8] }} };
export const idnmatOn = () => !!(globalThis.RR_FLAGS || {}).idnmat;
export function idnmatEntry(mname, oname, bxy = null) {
  mname = String(mname || '').replace(/ \[[a-z]+\]$/, ''); // ' [csm]' copies (rr2_csm.js) keep their source's entry
  const t = IDNMAT.t, F = globalThis.RR_FLAGS || {}, cls = String(oname || '').replace(/[0-9.]+/g, '#'), k = (mname || '') + '@' + cls;
  const kx = (mname || '') + '@=' + String(oname || ''), e = t[kx] || t[k] || t[mname || ''] || [+(F.idnmatDef ?? IDNMAT.def), 1];
  const key = t[kx] ? kx : t[k] ? k : t[mname || ''] ? mname : '', z = key && bxy && !F.idnmatNoZone && (IDNMAT.z || {})[key];
  // v3.1: with bxy === 'frag' the zone is decided per fragment (addIblDiffuseScale): the entry carries the zone's own
  // [k, g] plus its edges in Blender XY, and one clone (one program) blends base and zone with a soft edge. The low y
  // edge ramps over z.ry (RR_FLAGS.idnmatZy overrides), the other three edges over half a metre either side.
  if (z && bxy === 'frag') { const ry = F.idnmatZy || z.ry || [z.box[0][1] - 0.5, z.box[0][1] + 0.5], h = 0.5;
    return { key, k: e[0], g: F.idnmatNoGain ? 1 : e[1], z: { k: z.e[0], g: F.idnmatNoGain ? 1 : z.e[1], x: [z.box[0][0] - h, z.box[0][0] + h, z.box[1][0] - h, z.box[1][0] + h], y: [+ry[0], +ry[1], z.box[1][1] - h, z.box[1][1] + h] } }; }
  if (z && bxy[0] >= z.box[0][0] && bxy[0] <= z.box[1][0] && bxy[1] >= z.box[0][1] && bxy[1] <= z.box[1][1]) return { key: key + '#z', k: z.e[0], g: F.idnmatNoGain ? 1 : z.e[1] };
  return { key, k: e[0], g: F.idnmatNoGain ? 1 : e[1] };
}
const SH_OFF = { value: 0 };
// ceilfix (agent ceilfix, Oct 14, RR_FLAGS.ceilfix, default 0 = off): a bit mask. 1: the room plan gain (rr2_rooms.js)
// leaves corridor ceilings alone; 2: down facing light field without the 14 m cut (addIblDiffuseScale); 4: the box
// projected reflection falls back to the plain capture direction outside the projection box (rr2_reflect.js).
// 8: the up facing rotunda soffit sheets are lifted 6 mm off the down facing soffits they z fight with (rr2_ceilfix.js,
// applied in rr2_player.js). ceilfix=15 turns all four on.
export const ceilfixBits = () => { const v = (globalThis.RR_FLAGS || {}).ceilfix; return v === true ? 15 : (+v || 0) & 15; };
export function addIblDiffuseScale(m) {
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(m, sh, r);
    sh.uniforms.uIblDiffuse = IBL_DIFFUSE; sh.uniforms.uIblUp = IBL_UP; sh.uniforms.uIblDown = IBL_DOWN; sh.uniforms.uIblUpTint = IBL_UP_TINT;
    const idm = idnmatOn(); if (idm) { const e = m.userData.idnmat ||= idnmatEntry(m.name, ''); // live: follows IBL_DOWN
      sh.uniforms.uIblDown = m.userData.idnU ||= { get value() { return IBL_DOWN.value * e.k; } }; sh.uniforms.uIdnGain = m.userData.idnG ||= { value: e.g };
      // v3.1 zone uniforms; an entry without a zone gets edges far outside the model, so its zone weight is 0
      const z = e.z, ez = z || { k: e.k, g: e.g, x: [1e5, 1e5 + 1, 2e5, 2e5 + 1], y: [1e5, 1e5 + 1, 2e5, 2e5 + 1] };
      sh.uniforms.uIblDownZ = m.userData.idnZU ||= { get value() { return IBL_DOWN.value * ez.k; } }; sh.uniforms.uIdnGainZ = m.userData.idnZG ||= { value: ez.g };
      sh.uniforms.uIdnZx = m.userData.idnZx ||= { value: new THREE.Vector4(...ez.x) }; sh.uniforms.uIdnZy = m.userData.idnZy ||= { value: new THREE.Vector4(...ez.y) }; }
    const field = !!(m.userData.shField || m.userData.shCode) && SHF.n.value > 0;
    // ceilfix bit 2 (agent ceilfix, Oct 14): down facing receivers take every capture of the field, so the 14 m cut no
    // longer draws arcs where a capture drops out, and a ceiling piece more than 14 m from every capture (the Yardbird end,
    // the Starbucks and Bar Mia end, Delmonico east and the Palazzo side) stays on the smooth field instead of falling
    // back to its 6 m cell's own capture, which drew hard edged rectangles and triangles along the cell cuts
    const cf2 = !!(ceilfixBits() & 2);
    const stx = field && shTexOn();
    if (field) { if (stx) sh.uniforms.uShTex = SHF.tex; else { sh.uniforms.uShPos = SHF.pos; sh.uniforms.uShC = SHF.c; } sh.uniforms.uShN = m.userData.shField ? SHF.n : SH_OFF;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vShWP;').replace('#include <fog_vertex>', '#include <fog_vertex>\n  vShWP = (modelMatrix * vec4(transformed, 1.0)).xyz;'); }
    const fieldCode = field ? (stx ? `
  { vec3 wn = inverseTransformDirection(normal, viewMatrix); vec3 acc = vec3(0.0); float ws = 0.0;
    for (int i = 0; i < uShN; i++) { // shtex: row i of uShTex, texel 0 position, texels 1 to 9 the coefficients
      vec3 dd = vShWP - texelFetch(uShTex, ivec2(0, i), 0).xyz; float d2 = dot(dd.xz, dd.xz); if (d2 > ${cf2 ? '(wn.y < -0.5 ? 1e8 : 196.0)' : '196.0'}) continue;
      float w = 1.0 / (d2 + 4.0); vec3 c[9]; for (int k = 0; k < 9; k++) c[k] = texelFetch(uShTex, ivec2(k + 1, i), 0).xyz; acc += w * shGetIrradianceAt(wn, c); ws += w; }
    if (ws > 0.0) iblIrradiance = acc / ws * envMapIntensity; }` : `
  { vec3 wn = inverseTransformDirection(normal, viewMatrix); vec3 acc = vec3(0.0); float ws = 0.0;
    for (int i = 0; i < uShN; i++) { // uShN <= SHN (loadSHField): the same iterations as the old constant bound and its break, but FXC cannot unroll 40 bodies
      vec3 dd = vShWP - uShPos[i]; float d2 = dot(dd.xz, dd.xz); if (d2 > ${cf2 ? '(wn.y < -0.5 ? 1e8 : 196.0)' : '196.0'}) continue;
      float w = 1.0 / (d2 + 4.0); vec3 c[9]; for (int k = 0; k < 9; k++) c[k] = uShC[i * 9 + k]; acc += w * shGetIrradianceAt(wn, c); ws += w; }
    if (ws > 0.0) iblIrradiance = acc / ws * envMapIntensity; }`) : '';
    const fieldDecl = !field ? '' : stx ? '\nvarying vec3 vShWP; uniform highp sampler2D uShTex; uniform int uShN;' : `\nvarying vec3 vShWP; uniform vec3 uShPos[${SHN}]; uniform vec3 uShC[${SHN * 9}]; uniform int uShN;`;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uIblDiffuse, uIblUp, uIblDown; uniform vec3 uIblUpTint;' + fieldDecl)
      .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\n  #ifdef USE_ENVMAP' + fieldCode + '\n  { float wy = inverseTransformDirection(normal, viewMatrix).y; iblIrradiance *= uIblDiffuse * (wy > 0.0 ? mix(vec3(1.0), uIblUp * uIblUpTint, wy) : vec3(mix(1.0, uIblDown, -wy))); }\n  #endif');
    // rotramp (flag rotramp=1, agent_rot2): rot_soffit_south gets a smooth gain along its length, fitted on m88 at 21 spots
    // (LOSO rms of the per spot mean error 7.35 to 4.57). North end (Blender y > -17) x0.88, Sugarcane end (y < -25) x1.3,
    // with the ramp half strength east of Blender x -14 and full west of x -24. Blender y = -three z.
    // idnmat v3.1 reuses the rotramp world position varying (vRrWP); with idnmat on it also takes the instance matrix.
    const rr = m.userData.rotRamp;
    if (rr || idm) { sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRrWP;').replace('#include <fog_vertex>', idm
        ? '#include <fog_vertex>\n  { vec4 rrp = vec4(transformed, 1.0);\n  #ifdef USE_INSTANCING\n  rrp = instanceMatrix * rrp;\n  #endif\n  vRrWP = (modelMatrix * rrp).xyz; }'
        : '#include <fog_vertex>\n  vRrWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vRrWP;'); }
    if (rr) { sh.fragmentShader = sh.fragmentShader
        .replace('#include <opaque_fragment>', 'outgoingLight *= mix(' + rr[0].toFixed(3) + ', ' + rr[1].toFixed(3) + ', smoothstep(' + (-rr[2]).toFixed(2) + ', ' + (-rr[3]).toFixed(2) + ', vRrWP.z) * (0.5 + 0.5 * (1.0 - smoothstep(-24.0, -14.0, vRrWP.x))));\n  #include <opaque_fragment>'); }
    // v3.1 zone weight per fragment from world position, Blender x = three x, Blender y = -three z
    if (idm) sh.fragmentShader = sh.fragmentShader.replace('#include <common>\nvarying vec3 vRrWP;', '#include <common>\nvarying vec3 vRrWP;\nuniform float uIdnGain, uIblDownZ, uIdnGainZ; uniform vec4 uIdnZx, uIdnZy;\n'
        + 'float idnZW() { float bx = vRrWP.x, by = -vRrWP.z; return smoothstep(uIdnZx.x, uIdnZx.y, bx) * (1.0 - smoothstep(uIdnZx.z, uIdnZx.w, bx)) * smoothstep(uIdnZy.x, uIdnZy.y, by) * (1.0 - smoothstep(uIdnZy.z, uIdnZy.w, by)); }')
      .replace('vec3(mix(1.0, uIblDown, -wy))', 'vec3(mix(1.0, mix(uIblDown, uIblDownZ, idnZW()), -wy))')
      .replace('#include <opaque_fragment>', 'outgoingLight *= mix(1.0, mix(uIdnGain, uIdnGainZ, idnZW()), smoothstep(0.5, 0.7, -inverseTransformDirection(normal, viewMatrix).y));\n  #include <opaque_fragment>');
  };
  m.customProgramCacheKey = () => (prevKey ? prevKey.call(m) : '') + '|ibld4' + (m.userData.shField || m.userData.shCode ? 'sh' + (shTexOn() ? 'T' : '') + (ceilfixBits() & 2 ? 'cf' : '') : '') + (idnmatOn() ? '|idg' : '') + (m.userData.rotRamp ? '|rr' + m.userData.rotRamp.join(',') : '');
}
const INTERIOR = /Interior|RotInterior|GJTables|_Int|ROOM_|MBF_|Decor|RealBottles|Tables/i;

export async function assignCaptureLighting(root, inv, capsUrl, renderer, { size = 256, interiorK = 0.35, boxHalf = [8, 8], boxZ = [-1.6, 3.6], report = {}, capFmt = 'f16', cache = null, center = null } = {}) {
  const byNode = new Map(inv.inventory.filter(r => r.node).map(r => [r.node, r]));
  const protoRow = new Map(inv.inventory.filter(r => r.status === 'instanced' && r.proto).map(r => [r.proto, r]));
  const meshes = [];
  root.traverse(o => {
    if (!o.isMesh || !o.material || !o.material.isMeshStandardMaterial) return;
    let n = o; while (n && !byNode.has(n.name) && !protoRow.has(n.name)) n = n.parent;
    const r = n ? (byNode.get(n.name) || protoRow.get(n.name)) : null;
    if (r && r.group) o.userData.invGroup = r.group; // export group, read by rr2_cove.js (constant emitters by group)
    if (r && r.name) o.userData.invName = r.name; // Blender object name (three names the mesh after its glTF node, n01530): rr2_cove.js slot strips
    meshes.push({ o, r });
  });
  const need = new Set(meshes.map(m => m.r && (m.r.cap || m.r.capnear)).filter(Boolean));
  const envs = new Map(); const metas = new Map();
  let metaAll = null;
  if (capFmt === 'rgbe1') { try { metaAll = await (await fetch(`${capsUrl}/meta.json`)).json(); } catch (e) { (report.errors ||= []).push('capture meta: ' + e.message); } }
  // room probes: captures rendered inside a restaurant (meta.interior, meta.box = the room's walls). An object that the
  // corridor probe sees only through storefront glass, and that a room probe sees without crossing glass, is lit by
  // that room probe at full strength, box-projected to the room: Cycles lights a room from inside it.
  const roomIds = metaAll ? Object.keys(metaAll).filter(k => metaAll[k].interior) : [];
  for (const id of roomIds) need.add(id);
  if (cache && capFmt === 'rgbe1' && metaAll) {
    // shared cache: a capture several sections use is fetched and decoded once (in a worker), nearest to the start first
    const dist = (id) => { const p = metaAll[id]?.pos_blender; return p && center ? Math.hypot(p[0] - center[0], p[1] - center[1]) : 50; };
    await Promise.all([...need].map(async (id) => {
      try { if (!metaAll[id]) throw new Error('no meta');
        const tex = await cache.acquire(id, `${capsUrl}/${id}.rgbe.png`, size, { priority: Math.round(100 - dist(id)),
          fallback: async () => { const env = await loadCaptureEnv(renderer, `${capsUrl}/${id}`, 512, size, capFmt, true); return env; } });
        envs.set(id, tex); metas.set(id, metaAll[id]);
      } catch (e) { (report.errors ||= []).push('capture ' + id + ': ' + e.message); }
    }));
  } else for (const id of need) {
    try {
      const env = await loadCaptureEnv(renderer, `${capsUrl}/${id}`, 512, size, capFmt);
      const meta = metaAll ? metaAll[id] : await (await fetch(`${capsUrl}/${id}/meta.json`)).json(); if (!meta) throw new Error('no meta');
      env.cube.dispose(); envs.set(id, env.pmrem); metas.set(id, meta);
    } catch (e) { (report.errors ||= []).push('capture ' + id + ': ' + e.message); }
  }
  // behind-glass test: an object is a room interior when the straight line from its capture to its centre passes a
  // storefront pane. Captures see through glass in Cycles, so the export's visibility flag alone over-lights shop interiors.
  root.updateMatrixWorld(true);
  const glassTris = []; const v = new THREE.Vector3(); const bb = new THREE.Box3();
  const isGlass = (mt) => mt && mt.isMeshPhysicalMaterial && mt.transmission >= 0.5;
  // only storefront panes count: transmissive props (chandelier crystals, bottles, glassware, lamp shades) are not
  // walls between the corridor and a room (the crystals were dimming the dome coffers to the interior share)
  const PROP = /crystal|chand|bottle|wine|cup|glassware|vase|lamp|bulb|shade|pendant|sconce|decanter|carafe|jar/i;
  const paneOK = (o, r) => { if (PROP.test(o.material.name || '') || PROP.test(o.name || '') || (r && PROP.test(r.name || ''))) return false;
    bb.setFromObject(o); const sx = bb.max.x - bb.min.x, sy = bb.max.y - bb.min.y, sz = bb.max.z - bb.min.z; return sy > 0.8 && Math.max(sx, sz) > 0.6; };
  for (const { o, r } of meshes) { if (o.isInstancedMesh || !isGlass(o.material) || !paneOK(o, r)) continue;
    const g = o.geometry, pa = g.attributes.position, idx = g.index, n = idx ? idx.count : pa.count;
    for (let i = 0; i < n; i++) { v.fromBufferAttribute(pa, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld); glassTris.push(v.x, v.y, v.z); } }
  let glass = null;
  if (glassTris.length) { const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(glassTris, 3)); if (gg.computeBoundsTree) gg.computeBoundsTree(); glass = new THREE.Mesh(gg, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); }
  const capPos = (id) => { const p = metas.get(id).pos_blender; return new THREE.Vector3(p[0], p[2], -p[1]); };
  const rc = new THREE.Raycaster(); rc.firstHitOnly = true; const c = new THREE.Vector3(), d = new THREE.Vector3();
  // cAt: a fixed centre (three coordinates) in place of the object's own box centre (endfix split pieces)
  const behindGlass = (o, id, cAt = null) => {
    if (!glass || o.isInstancedMesh || isGlass(o.material)) return false;
    if (cAt) c.fromArray(cAt); else { bb.setFromObject(o); bb.getCenter(c); } const a = capPos(id); d.subVectors(c, a); const L = d.length(); if (L < 0.2) return false;
    rc.set(a, d.normalize()); rc.far = L - 0.05; const hit = rc.intersectObject(glass)[0]; if (!hit) return false;
    // a frame member the pane runs through is not behind it (glass agent 6): Matteo's mullions and transoms (mt_steel,
    // mt_mull / mt_trans, 7 x 14 cm) carry the 2 cm reeded pane through their middle, so the line from the capture to
    // their centre crosses the pane's near face 1 to 6 cm before the centre, past the 5 cm margin at oblique angles. They
    // were then lit as Matteo's interior (room probe projected on the room's walls, or interiorK) and their front faces
    // mirrored the lit room and its glow card: grey silver 109 98 84 at B075 pz where Cycles has them black (18 10 1,
    // they face and mirror the corridor). An object whose centre lies within 10 cm of the plane of the pane it crossed
    // stands in that pane's plane, so it keeps the corridor capture. Room interiors sit 0.25 m and more behind the panes.
    // OPT IN until A/B (RR_FLAGS.paneframe = 1): not proven to be the grey frame cause, see report.envDbg
    if ((globalThis.RR_FLAGS || {}).paneframe && hit.face && Math.abs(v.subVectors(c, hit.point).dot(hit.face.normal)) < 0.1) { (report.paneFrames ||= []).length < 200 && report.paneFrames.push(o.name); return false; }
    return true;
  };
  const clones = new Map(); let nInt = 0, nAssigned = 0, nGlassInt = 0, nFallback = 0, nRoom = 0;
  for (const { o, r } of meshes) {
    // endfix: a piece of an object split for its size (userData.splitC, rr2_player.js) is classified as the whole object
    // (its capture, behind glass test and room probe vote from the whole box centre). When that object is an interior
    // (behind glass, a room probe, or an interior group) the piece keeps that lighting and interiorK; otherwise it stays a
    // capNearest cell. The Milos back bar meshes (Mesh_240, Mesh_2262, Mesh_2249, Mesh_2253, all over 15 m) lost interiorK
    // and their room probe to the split and read about 4x bright through the storefront at the corridor end
    const sC = o.userData.splitC || null; let pieceInt = false;
    if (sC && r && (r.cap || r.capnear) && envs.has(r.cap || r.capnear)) { const id0 = r.cap || r.capnear;
      pieceInt = behindGlass(o, id0, sC) || (!r.cap && INTERIOR.test(r.group || '')); }
    const capN = !!o.userData.capNearest && !pieceInt;
    let id = capN ? null : (r && (r.cap || r.capnear));
    if (!id || !envs.has(id)) { // capture missing from the set: nearest loaded capture to the object's centre
      if (!envs.size) continue; bb.setFromObject(o); bb.getCenter(c); let best = null, bd = Infinity;
      for (const k of envs.keys()) { const q = capPos(k); const dd = q.distanceToSquared(c); if (dd < bd) { bd = dd; best = k; } }
      id = best; nFallback++;
    }
    // split cells (capNearest) of big corridor floors and ceilings: the single nearest capture can sit across a
    // storefront corner, which halved whole cells (m21 picks at B009: grey ceiling wedges on rr_del_cream n01026 and grey
    // floor shards on rr_plain_floor.003 n02976, envMapIntensity 0.5). A cell counts as behind glass only when the three
    // nearest captures all see it through a pane.
    // split cells (capNearest) of corridor floors and ceilings are never halved as shop interiors: they are lit by the SH
    // light field, and the glass vote still halved floor cells by the rotunda (m36 picks at B009 nz: the pale shards are
    // rr_plain_floor.003 cells at envMapIntensity 0.5 next to cells at 1). A sheet inside a shop is still caught by its group.
    let bg = capN ? false : behindGlass(o, id, pieceInt ? sC : null); // let: the room probe branch below clears it (const threw a TypeError there)
    let useRoom = false;
    if (bg && roomIds.length) { const cAt = pieceInt ? sC : null; if (cAt) c.fromArray(cAt); else { bb.setFromObject(o); bb.getCenter(c); } let best = null, bd = 15 * 15;
      for (const rid of roomIds) { if (!envs.has(rid)) continue; const q = capPos(rid); const dd = q.distanceToSquared(c); if (dd < bd && !behindGlass(o, rid, cAt)) { bd = dd; best = rid; } }
      if (best) { id = best; useRoom = true; bg = false; nRoom++; } }
    if (bg) { nGlassInt++; const nm = r ? r.name : o.name; if ((report.behindGlassNames ||= []).length < 400) report.behindGlassNames.push(nm); }
    const interior = !useRoom && (bg || (!!r && !r.cap && INTERIOR.test(r.group || '')));
    // endfix: every split piece that left capNearest for interior lighting, with the reason (report.endfixPieces)
    if (pieceInt && (report.endfixPieces ||= []).length < 400) report.endfixPieces.push({ name: o.name, src: r ? r.name : null, cap: id, reason: useRoom ? 'room probe' : bg ? 'behind glass' : interior ? 'interior group ' + (r?.group || '') : 'none (kept corridor light)' });
    // Sugarcane (CL_Sug groups): its room has no room probe and is lit from the corridor captures through green glass,
    // halved as an interior; flag sugik sets its own factor (default: interiorK, unchanged)
    // sugint (flag sugint=1, agent_rot2): the Sugarcane interior seen through Material_501 reads 20 to 25 luma dark at B003
    // B004 nx (ref 152 / 184 against m88 131 / 165, linear 1.27 to 1.39); without sugik it gets interiorK x 1.35. First guess,
    // not fitted per object (no labels exist behind the green glass)
    const sugK = (globalThis.RR_FLAGS || {}).sugik ?? ((globalThis.RR_FLAGS || {}).sugint ? interiorK * 1.35 : undefined), sug = interior && sugK !== undefined && !!r && /^CL_Sug/.test(r.group || '');
    const shF = capN;
    // out of reach of every capture (Oct 14, vault agent): the lower hall past the ramp at the corridor end (B009, B012,
    // B016, B017 pz, about 25 m from the nearest capture) took the corridor's own irradiance through its capture and read
    // as a flat beige box; in the 360s that hall is about half as bright (B009 pz back wall: ref 0.38 0.28 0.17 linear,
    // m54 0.83 0.56 0.30). An object whose centre lies farther than farR from every loaded capture (horizontal distance)
    // gets farK on its capture light. Captures sit 2 to 3 m apart along the row, so only rooms no capture sees qualify.
    // The test uses the nearest point of the object's box, so a long sheet that also reaches the corridor (Mesh_1503
    // floor, Mesh_2236 ceiling) is never dimmed. Each object's own capture (cap or capnear) is the nearest one and is
    // loaded, so the loaded set is enough for the minimum. Gated to the lower hall south of the ramp (farbox, Blender XY
    // min/max): unrestricted, the test also caught about 4800 objects of the Yardbird frontage, Nomikai, the Palazzo atrium
    // and the Delmonico end, which no reference measurement supports yet. Flags: farr (m, default 14), fark (default 0.5,
    // 1 turns it off), farbox ([[xmin, ymin], [xmax, ymax]] in Blender metres, default the lower hall).
    // end agent (Oct 14): the box stopped at x -8, so the far half of the lower hall (lw_endwall_patch x -5.9 to 2.4,
    // grpmv_Mesh_1503 / _1491 / _1493, Mesh_1513, Mesh_1187: the end wall, floor and side walls the corridor end shows at
    // B009 B016 B017 pz, 42 to 47 m away) was never dimmed: ref / m59 linear 0.26 to 0.34 there. The east edge now runs to
    // x 4 (the hall ends at 2.7); the north edge stays at y -44, so the Starbucks front, the ramp and the stair landing keep
    // their light (they match or read dark already). Objects already dimmed at 0.5 still read about 2x bright (rs_ceilfill
    // pieces, ratio 0.51); 0.3 overshot at B010/B020 pz in m61, so 0.4.
    const FF = globalThis.RR_FLAGS || {}, farR = FF.farr ?? 14, farK = FF.fark ?? 0.4, fbx = FF.farbox || [[-19.5, -80], [4, -44]];
    let far = false;
    if (farK !== 1 && !useRoom && !o.isInstancedMesh && (bb.setFromObject(o), bb.min.x >= fbx[0][0] && bb.max.x <= fbx[1][0] && -bb.max.z >= fbx[0][1] && -bb.min.z <= fbx[1][1]) && bb.max.y > (FF.farfloor ?? 0.3)) { let dmin = Infinity; // floors stay out (m63: the far corridor floor went dark orange)
      for (const k of envs.keys()) { const q = capPos(k);
        dmin = Math.min(dmin, Math.hypot(Math.max(bb.min.x - q.x, 0, q.x - bb.max.x), Math.max(bb.min.z - q.z, 0, q.z - bb.max.z))); }
      far = dmin > farR; if (far) { report.farLit = (report.farLit || 0) + 1; if ((report.farLitNames ||= []).length < 200) report.farLitNames.push(r ? r.name : o.name); } }
    // diagnostics (glass agent 6): RR_FLAGS.envdbg = a material name pattern (e.g. 'mt_steel') lists how each matching
    // object is lit: capture, behind glass, room probe, interior, far, the resulting env intensity factor
    if (FF.envdbg && new RegExp(FF.envdbg).test(o.material.name || '') && (report.envDbg ||= []).length < 300)
      report.envDbg.push({ o: r ? r.name : o.name, cap: id, bg, useRoom, interior, far, eK: +((interior ? (sug ? sugK : interiorK) : 1) * (far ? farK : 1)).toFixed(3), group: r?.group });
    // idnmat: objects whose class has its own entry get their own clone (same program, own uniforms)
    let idE = idnmatOn() ? idnmatEntry(o.material.name, r ? r.name : o.name) : null;
    // v3 zone: piece centre, Blender XY (RR_FLAGS.idnmatZonePiece=1); v3.1 default: per fragment, one clone per key
    if (idE && idE.key && (IDNMAT.z || {})[idE.key]) { if (FF.idnmatZonePiece) { bb.setFromObject(o); bb.getCenter(c); idE = idnmatEntry(o.material.name, r ? r.name : o.name, [c.x, -c.z]); } else idE = idnmatEntry(o.material.name, r ? r.name : o.name, 'frag'); }
    const rrOn = !!FF.rotramp && /^rot_soffit_south/.test(r ? r.name : o.name);
    // delmfix (agent delm2, Oct 14): Matteo's clear storefront panes and copper screens across from the Delmonico wing
    // (mt_glass, cl_copper_perf, capture B084) mirror the capture box projected onto the default 16 m box, whose top
    // (5.2 m) and north wall (Blender y +1) lie past the 3.57 m soffit and the Delmonico wing front (y -2.4 to -3.8). The
    // mirror rays then land on the box wall behind the chain curtain and read the bright curtain and chandelier out of the
    // capture: vertical dashed strands over a pale mist at B084 B085 px, where Cycles mirrors the dark soffit and the cove
    // line. RR_FLAGS.delmfix = 1: rr2_reflect.js scales their mirrored capture (delmk); delmfix = 2 also projects them onto the
    // corridor itself (delmbox, Blender [[x, y, z] min, max], default x -3 to 16, y -11 to -2.4, z 0 to 3.7), untested
    const DF = globalThis.RR_FLAGS || {};
    // RR_FLAGS.lowglass = 1 (agent glassfix3, Oct 14): the five copper screen bays east of Matteo's (mt2_glass / mt2_frost /
    // cl_perf_mt2_* at Blender x 9.8 to 37.4, the long storefront in Ryan's 'Voltaire' screenshot and sweep S37 to S53) all
    // take capture B084 (x 5, y -7). Two things then go wrong past x 13: (1) delmfix scales their mirrored capture to delmk
    // (0.15 in the current flags) although they are 3 to 30 m east of the Delmonico wing front it was fitted on, so their
    // upper glass reads pure black with no reflection; (2) they lie outside B084's projection box (x -3 to 13), where
    // boxProject's ray to the box wall runs backwards (negative t) and the lookup direction is meaningless. With lowglass,
    // delmfix keeps only objects whose box centre lies inside delmbox in x (default x up to 16), and objects matching
    // RR_FLAGS.lowglassre (default mt_glass, mt_frost, cl_copper_perf) whose centre lies outside their capture's box get that
    // box grown to hold their own box plus RR_FLAGS.lowglassm metres (default 3). Uniform values only, no new program.
    const LG = +(DF.lowglass ?? 0) && new RegExp(DF.lowglassre || '^(mt_glass|mt_frost|cl_copper_perf)(\\.\\d+)?$').test(o.material.name || '');
    // bluepatch (Oct 14): the grown box above put the box wall the mirror ray meets 15 to 30 m from B084, so the lookup
    // (wall hit minus capture position) swung far off the pane's own mirror direction and read whatever B084 sees that
    // way: at S47 (Blender 29, 3.5, yaw 180) cl_mt2_glass1.3_x1 showed the blue Milos wall art (B084 nx about 706, 507 of
    // 1024) through the cl_perf holes and a white pendant / blossom streak (nx about 814, 404) on its upper glass.
    // RR_FLAGS.lowglassshift = 1 (default) instead slides the capture and its own 16 m box along the pane's line (the
    // horizontal direction across the pane normal) until it sits opposite the pane centre, as B084 sits opposite the
    // bays next to it: the pane then mirrors the corridor as B084 sees it at its own spot (soffit, cove, the far side),
    // the lookup a pane near B084 already gets. Its mirrored capture is scaled by RR_FLAGS.lowglassfk (default 0.35).
    // lowglassshift = 0 keeps the grown box.
    let lgBox = null, lgPos = null;
    // RR_FLAGS.lowglassbay = 1 (agent resid, Oct 14): one treatment for all five copper screen bays (lowglassbayre, default
    // mt2_glass / mt2_frost of mt2_*, cl_mt2_* and the cl_perf_ copies). (1) The pane line for lowglassshift comes from the
    // pane's own vertices (principal horizontal axis), not from the normal of vertex 0: that vertex lies on an edge face of
    // the thin pane (normal vertical or along the line), so the capture was slid along Blender x only (mt2_glass-4.9 got its
    // capture on the pane itself, x 18.38 y -7) or off into the rooms (cl_mt2_glass1.3_x1 at x 13.76 y -16.62, the S47 blue
    // patch). (2) No bay pane takes delmfix (the -11.4 bay at x 9.8 to 15.2 kept delmk 0.15, the -4.9 bay to the east got
    // lowglassfk 0.35 instead, so neighbouring bays differed). (3) Every bay pane, inside or outside B084's box, scales its
    // mirrored capture by one value per material: mt_glass lowglassgk (default 0.15, the -11.4 bay value, whose B084 px upper glass already reads 41 to 49 against Cycles 21 to 28), mt_frost lowglassfsk (default 0.4,
    // B084 px fit: the lower band read 113 against Cycles 72 to 94, about 0.8 of it being the capture reflection).
    const LGB = LG && +(DF.lowglassbay ?? 0) && new RegExp(DF.lowglassbayre || '^(cl_perf_)?(cl_)?mt2_(glass|frost)').test(r ? r.name : o.name || '');
    const lineDir = (obj) => { const pa = obj.geometry && obj.geometry.attributes.position; if (!pa) return null; const v = new THREE.Vector3(); let n = 0, mx = 0, mz = 0, sxx = 0, szz = 0, sxz = 0;
      for (let i = 0; i < pa.count; i++) { v.fromBufferAttribute(pa, i).applyMatrix4(obj.matrixWorld); n++; mx += v.x; mz += v.z; sxx += v.x * v.x; szz += v.z * v.z; sxz += v.x * v.z; }
      if (n < 3) return null; mx /= n; mz /= n; const a = sxx / n - mx * mx, b = sxz / n - mx * mz, d = szz / n - mz * mz;
      const th = 0.5 * Math.atan2(2 * b, a - d); return [Math.cos(th), Math.sin(th)]; };
    if (LG && id && metas.has(id) && !metas.get(id).box) { bb.setFromObject(o); bb.getCenter(c); const p0 = metas.get(id).pos_blender, P = [p0[0], p0[2], -p0[1]];
      if (Math.abs(c.x - P[0]) > boxHalf[0] || Math.abs(c.z - P[2]) > boxHalf[1]) { const mg = +(DF.lowglassm ?? 3);
        const nA = +(DF.lowglassshift ?? 1) && o.geometry && o.geometry.attributes.normal;
        const ld = LGB && nA ? lineDir(o) : null;
        if (nA) { const nv = new THREE.Vector3().fromBufferAttribute(nA, 0).transformDirection(o.matrixWorld); const L = Math.hypot(nv.x, nv.z);
          const ux = ld ? ld[0] : L > 0.5 ? -nv.z / L : 1, uz = ld ? ld[1] : L > 0.5 ? nv.x / L : 0, s = ux * (c.x - P[0]) + uz * (c.z - P[2]);
          lgPos = [P[0] + ux * s, P[1], P[2] + uz * s];
          lgBox = [[lgPos[0] - boxHalf[0], P[1] + boxZ[0], lgPos[2] - boxHalf[1]], [lgPos[0] + boxHalf[0], P[1] + boxZ[1], lgPos[2] + boxHalf[1]]]; }
        else lgBox = [[Math.min(P[0] - boxHalf[0], bb.min.x - mg), P[1] + boxZ[0], Math.min(P[2] - boxHalf[1], bb.min.z - mg)], [Math.max(P[0] + boxHalf[0], bb.max.x + mg), P[1] + boxZ[1], Math.max(P[2] + boxHalf[1], bb.max.z + mg)]];
        if ((report.lowglassBox ||= []).length < 60) report.lowglassBox.push({ o: r ? r.name : o.name, cap: id, box: lgBox.map(a => a.map(x => +x.toFixed(2))), pos: lgPos && lgPos.map(x => +x.toFixed(2)) }); } }
    let delmOn = !!+(DF.delmfix ?? 0) && /^B08[045]_/.test(id || '') && new RegExp(DF.delmre || '^(mt_glass|cl_copper_perf)(\\.\\d+)?$').test(o.material.name || '') && !interior;
    if (LGB) delmOn = false;
    if (delmOn && +(DF.lowglass ?? 0)) { bb.setFromObject(o); bb.getCenter(c); const dbx = (DF.delmbox || [[-3, -11, 0], [16, -2.4, 3.7]]); if (c.x > dbx[1][0] || c.x < dbx[0][0]) delmOn = false; }
    // vglass (Oct 15) RR_FLAGS.lowglassbox = 1: the copper screen bay panes (LGB above) mirror the corridor, not B084's
    // 16 m box. Their glass passes almost nothing (mt_glass base 0.034 at transmission 0.85: about 3 % through a box pane),
    // so in Cycles the upper panes are their reflection alone: the dark soffit with the cove line and the downlights of the
    // far side (r8f B084 px near bay: median 16, 90th percentile 77 of 255). In the viewer the mirror ray met the 16 m box
    // wall past the soffit and the far storefronts, so the lookup read whatever B084 sees there (the lit chain curtain at
    // first, hence lowglassgk 0.15, which leaves the panes pure black). With this flag each bay pane is projected onto the
    // corridor slab in front of it: the plan box of the pane line pushed RR_FLAGS.lowglassbd metres (default 6, the bay to
    // Delmonico front distance) to the corridor side (the side of its capture), floor to RR_FLAGS.lowglassbz (default
    // 3.57, the soffit), with the capture slid opposite the pane centre as lowglassshift does. The mirrored capture then
    // reads the soffit, the cove and the far side, and the scale goes back up (lowglassgk, lowglassfsk, see the report).
    let lbBox = null, lbPos = null;
    if (LGB && +(DF.lowglassbox ?? 0) && id && metas.has(id) && !metas.get(id).box) { const ld = lineDir(o);
      if (ld) { bb.setFromObject(o); bb.getCenter(c); const p0 = metas.get(id).pos_blender, P = [p0[0], p0[2], -p0[1]];
        let nx = -ld[1], nz = ld[0]; const sd = nx * (P[0] - c.x) + nz * (P[2] - c.z); if (sd < 0) { nx = -nx; nz = -nz; }
        // the corridor runs on past both ends of the pane: the box does too (RR_FLAGS.lowglassbl metres each way, default 12),
        // or a mirror ray seen at a grazing angle (every walk view along the bays, B084 px) left through the short end wall at
        // once and read the capture back along the pane line
        const hl = 0.5 * (Math.abs(ld[0]) * (bb.max.x - bb.min.x) + Math.abs(ld[1]) * (bb.max.z - bb.min.z)) + Math.max(0.05, +(DF.lowglassbl ?? 12));
        const D = +(DF.lowglassbd ?? 6), bz = +(DF.lowglassbz ?? 3.57), pts = [];
        for (const e of [-hl, hl]) for (const q of [-0.1, D]) pts.push([c.x + ld[0] * e + nx * q, c.z + ld[1] * e + nz * q]);
        lbBox = [[Math.min(...pts.map(t => t[0])), 0, Math.min(...pts.map(t => t[1]))], [Math.max(...pts.map(t => t[0])), bz, Math.max(...pts.map(t => t[1]))]];
        const dist = Math.abs(sd); lbPos = [c.x + nx * dist, P[1], c.z + nz * dist];
        if ((report.lowglassBox2 ||= []).length < 60) report.lowglassBox2.push({ o: r ? r.name : o.name, cap: id, box: lbBox.map(a => a.map(x => +x.toFixed(2))), pos: lbPos.map(x => +x.toFixed(2)), dist: +dist.toFixed(2) }); } }
    // vglass (Oct 15) RR_FLAGS.paneboxfix = 1: a storefront pane (transmissive, pane sized, not a bay pane above) that is
    // not wholly inside its capture's projection box. Every pane east of x 13 takes B084 or B085 (the last captures), the
    // Yardbird bays (x -44 to -33) take B001 or a fallback 20 m away, the D1 fronts at illy / Donutique (int_mb_glass, no
    // capture) B084 from 45 m. Box projection then fails (negative or mixed box distances; interfix fades those to the
    // plain direction) and the pane mirrors the far capture's own surroundings at full strength: sharp but wrong content,
    // stretched over a pane seen from 1 m (the smeared wood and glass at W078y120p40, the milky Yardbird upper panes).
    // Such a pane is projected onto a box of the default size around its own centre (capture height), so the lookup is
    // its own mirror direction, its mirrored capture is scaled by RR_FLAGS.paneboxk (default 0.5) and its roughness gets
    // a floor RR_FLAGS.paneboxr (default 0.2): a dim soft ceiling / floor gradient instead of a wrong sharp image.
    let pbPos = null;
    if (+(DF.paneboxfix ?? 0) && !LG && !delmOn && id && metas.has(id) && !metas.get(id).box && isGlass(o.material) && paneOK(o, r)) {
      const p0 = metas.get(id).pos_blender, P = [p0[0], p0[2], -p0[1]]; bb.setFromObject(o);
      if (bb.min.x < P[0] - boxHalf[0] || bb.max.x > P[0] + boxHalf[0] || bb.min.z < P[2] - boxHalf[1] || bb.max.z > P[2] + boxHalf[1]) {
        bb.getCenter(c); pbPos = [c.x, P[1], c.z];
        if ((report.paneBox ||= []).length < 200) report.paneBox.push({ o: r ? r.name : o.name, m: o.material.name, cap: id, c: [+c.x.toFixed(2), +(-c.z).toFixed(2)] }); } }
    const cf1 = !!(ceilfixBits() & 1);
    const key = o.material.uuid + '|' + id + '|' + (interior ? (sug ? 'is' : 'i') : 'c') + (cf1 && useRoom ? 'r' : '') + (shF ? '|sh' : '') + (far ? '|far' : '') + (idE && idE.key.includes('@') ? '|' + idE.key : '') + (rrOn ? '|rr' : '') + (delmOn ? '|delm' : '') + (lgBox ? '|lg' + lgBox.flat().map(x => x.toFixed(1)).join(',') + (lgPos ? 's' : '') : '') + (LGB ? '|bay' : '') + (lbBox ? '|lb' + lbBox.flat().map(x => x.toFixed(1)).join(',') : '') + (pbPos ? '|pb' + pbPos.map(x => x.toFixed(1)).join(',') : '');
    let m = clones.get(key);
    if (!m) {
      const src = o.material; const ud = src.userData; src.userData = {};
      m = src.clone(); src.userData = ud; m.userData = { ...ud, boxProjected: false };
      m.defines = { ...src.defines }; m.onBeforeCompile = src.userData.baseOnBeforeCompile || src.onBeforeCompile; m.customProgramCacheKey = src.customProgramCacheKey;
      if (shF) m.userData.shField = true;
      // ceilfix bit 1: a corridor surface (lit by a corridor capture, not behind glass, not a room interior group, not a
      // room probe) is marked so rr2_rooms.js keeps the room plan gain off its down facing faces above 2.3 m
      // (revA 10: and not lit by a room probe with its own projection box, metas box: those are room surfaces too)
      if (cf1) m.userData.roomCorr = !interior && !useRoom && !(metas.get(id) || {}).box;
      if (rrOn) m.userData.rotRamp = [0.88, 1.3, -17, -25];
      if (idE) { m.userData.idnmat = idE; for (const q of ['idnU', 'idnG', 'idnZU', 'idnZG', 'idnZx', 'idnZy']) delete m.userData[q]; if (idE.key) (report.idnmat ||= {})[idE.key] = (report.idnmat[idE.key] || 0) + 1; }
      addIblDiffuseScale(m);
      m.envMap = envs.get(id); m.envMapIntensity = (src.envMapIntensity ?? 1) * (interior ? (sug ? sugK : interiorK) : 1) * (far ? farK : 1);
      const p = metas.get(id).pos_blender; // Blender -> three
      const pos = [p[0], p[2], -p[1]];
      const rb = metas.get(id).box; // room probe: project onto the room's own walls (Blender min/max -> three)
      const db = delmOn && +DF.delmfix >= 2 ? (DF.delmbox || [[-3, -11, 0], [16, -2.4, 3.7]]) : null;
      if (delmOn) m.userData.delmfix = true;
      if (db) { addBoxProjection(m, makeBox(pos, [db[0][0], db[0][2], -db[1][1]], [db[1][0], db[1][2], -db[0][1]])); }
      else if (lbBox) addBoxProjection(m, makeBox(lbPos, lbBox[0], lbBox[1]));
      else if (pbPos) { addBoxProjection(m, makeBox(pbPos, [pbPos[0] - boxHalf[0], pbPos[1] + boxZ[0], pbPos[2] - boxHalf[1]], [pbPos[0] + boxHalf[0], pbPos[1] + boxZ[1], pbPos[2] + boxHalf[1]]));
        const pk = THREE.MathUtils.clamp(+(DF.paneboxk ?? 0.5), 0, 1); if (pk < 1) m.userData.lowglassK = pk; m.userData.lowglassR = THREE.MathUtils.clamp(+(DF.paneboxr ?? 0.2), 0, 1); }
      else if (lgBox) { addBoxProjection(m, makeBox(lgPos || pos, lgBox[0], lgBox[1])); if (lgPos && !LGB) m.userData.lowglassK = THREE.MathUtils.clamp(+(DF.lowglassfk ?? 0.35), 0, 1); }
      else if (rb) addBoxProjection(m, makeBox(pos, [rb[0][0], rb[0][2], -rb[1][1]], [rb[1][0], rb[1][2], -rb[0][1]]));
      else addBoxProjection(m, makeBox(pos, [pos[0] - boxHalf[0], pos[1] + boxZ[0], pos[2] - boxHalf[1]], [pos[0] + boxHalf[0], pos[1] + boxZ[1], pos[2] + boxHalf[1]]));
      if (LGB) m.userData.lowglassK = THREE.MathUtils.clamp(/^mt_frost/.test(src.name || '') ? +(DF.lowglassfsk ?? 0.4) : +(DF.lowglassgk ?? 0.15), 0, 1);
      clones.set(key, m);
    }
    o.material = m; nAssigned++; if (interior) nInt++;
  }
  Object.assign(report, { captures: envs.size, probeMaterials: clones.size, probeAssigned: nAssigned, probeInterior: nInt, probeBehindGlass: nGlassInt, probeFallback: nFallback, probeRoom: nRoom, glassTris: glassTris.length / 9 });
  return envs;
}

// Program sharing across patch variants (load time, Oct 14). Three compiles one program per cache key, and the light
// field (ibld2sh), cove receiver (cove6) and floor mirror (floorrefl9) patches each split a material family in two: the
// same Blender structure with and without the patch. Materials whose programs differ only by those patches get the union
// of their code, each part switched off by its own per material uniforms (light field count 0, cove loop counts 0, mirror
// gate 0), so they share one program and draw exactly what they drew before. Grouping is by the parts of three's own
// cache key a material decides (custom key without the variant tags, defines, maps, feature flags), so a group never
// mixes programs that could not be shared anyway. Run after every patch layer (rr2_player: after the glassLate flip).
// version agnostic (m59: the cove7sd and ibld4sh renames silently disabled unification and added ~80 programs)
const VARIANT_TAGS = /\|cove\d+[a-z]*(?=\||$)|\|floorrefl\d+[a-z0-9._]*(?=\||$)/g;
const MAP_SLOTS = ['map', 'alphaMap', 'lightMap', 'aoMap', 'bumpMap', 'normalMap', 'displacementMap', 'emissiveMap', 'metalnessMap', 'roughnessMap', 'anisotropyMap',
  'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap', 'iridescenceMap', 'iridescenceThicknessMap', 'sheenColorMap', 'sheenRoughnessMap', 'specularMap',
  'specularColorMap', 'specularIntensityMap', 'transmissionMap', 'thicknessMap', 'envMap', 'matcap', 'gradientMap'];
export function variantGroupKey(m) {
  // a material without a Blender graph has three's default custom key, the source text of its outermost onBeforeCompile
  // layer, which follows from its patch tags: the tags alone stand for it here
  let ck = String(m.customProgramCacheKey()); if (!m.userData.blender) ck = 'std' + ((ck.match(/(\|[a-z][a-z0-9.]*)+$/) || [''])[0]);
  const k = [ck.replace(VARIANT_TAGS, '').replace(/\|ibld(\d+)sh[A-Za-z]*(?=\||$)/, '|ibld$1'), m.type, JSON.stringify(m.defines || {})];
  for (const s of MAP_SLOTS) { const t = m[s]; k.push(t ? (t.channel ?? 0) + ':' + (t.colorSpace || '') + (s === 'envMap' ? ':' + t.mapping + ':' + (t.image?.height ?? '') : '') : '-'); }
  k.push(m.normalMapType, m.clearcoat > 0, m.iridescence > 0, m.alphaTest > 0, !!m.vertexColors, m.anisotropy > 0, !!m.alphaHash, m.dispersion > 0, !!m.flatShading,
    !!m.premultipliedAlpha, m.side, !!m.dithering, m.transmission > 0, m.sheen > 0, m.transparent, m.blending, !!m.alphaToCoverage, m.toneMapped, m.fog);
  return k.join('#');
}
export function unifyVariants(root, { cove = null, floor = null, rooms = null } = {}) {
  const mats = new Set();
  root.traverse(o => { if (!o.isMesh) return; for (const m of (Array.isArray(o.material) ? o.material : [o.material])) if (m && m.isMeshStandardMaterial) mats.add(m); });
  const groups = new Map(); for (const m of mats) { const k = variantGroupKey(m); (groups.get(k) || groups.set(k, []).get(k)).push(m); }
  const n = { groups: groups.size, sh: 0, cove: 0, floor: 0 };
  // the layers above the one to insert come off and go back on in the viewer's order (floor mirror, cove emitter cap,
  // cove receiver, room gain), so every material of a group ends up with the same layer order: the same source text
  const peel = (m, upto) => { const st = {}; for (const l of ['room', 'cove', 'cap']) { if (l === upto) break; st[l] = l === 'room' ? rooms?.unwrap(m) : l === 'cove' ? cove?.unwrap(m) : cove?.unwrapCap(m); } return st; };
  const wrap = (m, st) => { if (st.cap) cove.rewrapCap(m, st.cap); if (st.cove) cove.patch(m, st.cove.lit); if (st.room) rooms.patch(m); };
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const want = { sh: list.some(m => m.userData.shField || m.userData.shCode), cove: !!cove && list.some(m => m.userData.coveCode), floor: !!floor && list.some(m => m.userData.floorCode) };
    if (!want.sh && !want.cove && !want.floor) continue;
    if (want.sh) for (const m of list) if (!m.userData.shField && !m.userData.shCode) { m.userData.shCode = true; m.needsUpdate = true; n.sh++; }
    for (const m of list) {
      if (want.floor && !m.userData.floorCode) { const st = peel(m, 'floor'); floor.patch(m, false); wrap(m, st); n.floor++; }
      if (want.cove && !m.userData.coveCode) { const st = peel(m, 'cove'); cove.patch(m, false); wrap(m, st); n.cove++; }
    }
  }
  return n;
}
