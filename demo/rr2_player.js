// Restaurant Row code player: one scene, several cameras (overview, restaurant stop look-around, free walk).
// Lighting comes from the existing Cycles captures (per object), materials are the Blender node graphs compiled to GLSL.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { dynamicLightLoops } from './rr2_lightloop.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { N8AOPass } from 'n8ao';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RefBloomPass } from './rr2_refbloom.js';
import { computeBoundsTree, acceleratedRaycast, MeshBVH } from 'three-mesh-bvh';
import { LineOfSight } from './rr2_occl.js';
import { PropLOD } from './rr2_lod.js';
import { compileAndApply, loadArea, fixObjectCoords } from './rr2_scene.js';
import { signfixImages, signfixArea, signfixLight } from './rr2_signfix.js';
import { frontsfixExtra, frontsfixArea } from './rr2_frontsfix.js';
import { mapAlphaCoverage, progcutMerge } from './blender_material.js';
import { variantGroupKey, assignCaptureLighting, IBL_DIFFUSE, IBL_UP, IBL_DOWN, IBL_UP_TINT, loadSHField, unifyVariants } from './rr2_probes.js';
import { LightPool } from './rr2_lights.js';
import { addLampCardsSpec, lampCardSpec, addShaftLamps, MATTEO_SHAFT } from './rr2_lampcards.js';
import { floatFix } from './rr2_floatfix.js';
import { propFix, propMatOverrides } from './rr2_propfix.js';
import { thinGlass, FloorReflector } from './rr2_reflect.js';
import { CoveLights, addCrackBacking } from './rr2_cove.js';
import { bakeSugarcane } from './rr2_sugbake.js';
import { floatFix2 } from './rr2_floatfix2.js';
import { RoomLighting } from './rr2_rooms.js';
import { CaptureCache, queuedFetch, PRI, stats as assetStats, netQueue, memleanSeal, memleanAudit, memleanGLTFPlugin, memleanMark, memleanAreaDone, upgradeSmallTextures, streamTextures, smallStats } from './rr2_assets.js';
import { pickTier, DprGovernor } from './rr2_tier.js';
import { ProgramGate } from './rr2_gate.js';
import { lmOn, loadLightmaps, applyLightmaps } from './rr2_lightmap.js';
import { delmint } from './rr2_delmint.js';   // agent delmint Oct 22: Delmonico vaults, chandeliers, stone room, cream walls, carpet
// The exact look of Ryan's Cycles 360s (meta.json "grade"): 0.75 x Khronos PBR Neutral at -0.35 EV + 0.25 x AgX with the
// Punchy look at -0.25 EV, mixed in display space. Checked against Blender 5.2's own OCIO processors (PyOpenColorIO in
// Blender, 209k linear pixels sampled from all 34 captures): the Neutral part matches to 0.33 of 255; the AgX part is an
// approximation (Blender 5.2 AgX uses LUTs) whose best fit is power 1.5, saturation 1.0. With saturation 1.15 the whole
// grade ran warm (R +1.1, B -0.8 of 255, up to R +2.3 in highlights); with 1.0 the mean error is 0.57 of 255 and the
// colour bias is neutral (+0.4 on all three channels). Used with toneMap 'grade360'; ev = exposureEV.
// Load time (prog2b, Oct 14): three unrolls the point and spot light loops of every lit program in the GLSL text
// (#pragma unroll_loop_start: 6 + 12 inline copies of getPointLightInfo / getSpotLightInfo / RE_Direct), so ANGLE
// translates and FXC compiles every one of the ~170 programs with 18 copies of the BRDF. Without shadow maps and spot
// light maps (this viewer has neither) the loop bodies do not need the unrolled index, so a plain loop computes exactly
// the same thing in the same order. Programs that do have shadows or spot light maps keep three's unrolled original
// (the #if picks it). Rect area lights keep the unrolled loop (their LTC texture reads are gradient ops). Applied once,
// before the first program is built; ?lightunroll=1 (RR_FLAGS.lightunroll) keeps three's chunk for an A/B.
export function rollLightLoops() {
  const C = THREE.ShaderChunk; if (C.__rrRolled) return C.__rrRolled; const src = C.lights_fragment_begin;
  const a = src.indexOf('#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )'), b = src.indexOf('#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )');
  if (a < 0 || b < 0) return (C.__rrRolled = 'chunk not recognised, left as is');
  const rolled = `#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )
	PointLight pointLight;
	for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
		pointLight = pointLights[ i ];
		getPointLightInfo( pointLight, geometryPosition, directLight );
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
#endif
#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )
	SpotLight spotLight;
	for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
		spotLight = spotLights[ i ];
		getSpotLightInfo( spotLight, geometryPosition, directLight );
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
#endif
`;
  C.lights_fragment_begin = src.slice(0, a) + '#if defined( USE_SHADOWMAP ) || ( NUM_SPOT_LIGHT_MAPS > 0 )\n' + src.slice(a, b) + '#else\n' + rolled + '#endif\n' + src.slice(b);
  return (C.__rrRolled = 'point and spot loops rolled');
}
const GRADE360 = { uniforms: { tDiffuse: { value: null }, ev: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float ev; varying vec2 vUv;
vec3 neutralTM(vec3 c) { float x = min(c.r, min(c.g, c.b)); float off = x < 0.08 ? x - 6.25 * x * x : 0.04; c -= off;
  float peak = max(c.r, max(c.g, c.b)); const float S = 0.76; if (peak < S) return c; float d = 1.0 - S;
  float np = 1.0 - d * d / (peak + d - S); c *= np / peak; float g = 1.0 - 1.0 / (0.15 * (peak - np) + 1.0); return mix(c, vec3(np), g); }
vec3 agxPunchy(vec3 c) {
  const mat3 S2R = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
  const mat3 R2S = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
  const mat3 INS = mat3(0.856627153315983, 0.137318972929847, 0.11189821299995, 0.0951212405381588, 0.761241990602591, 0.0767994186031903, 0.0482516061458583, 0.101439036467562, 0.811302368396859);
  const mat3 OUTS = mat3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826, -0.11060664309660323, 1.157823702216272, -0.11060664309660294, -0.016493938717834573, -0.016493938717834257, 1.2519364065950405);
  c = INS * (S2R * c); c = max(c, 1e-10); c = clamp((log2(c) + 12.47393) / 16.5, 0.0, 1.0);
  vec3 x2 = c * c, x4 = x2 * x2; c = 15.5 * x4 * x2 - 40.14 * x4 * c + 31.96 * x4 - 6.868 * x2 * c + 0.4298 * x2 + 0.1191 * c - 0.00232;
  c = pow(max(c, 0.0), vec3(1.5)); float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); c = l + 1.0 * (c - l);
  c = pow(max(OUTS * c, 0.0), vec3(2.2)); return clamp(R2S * c, 0.0, 1.0); }
vec3 enc(vec3 x) { x = clamp(x, 0.0, 1.0); return mix(12.92 * x, 1.055 * pow(x, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, x)); }
void main() { vec3 c = texture2D(tDiffuse, vUv).rgb * exp2(ev);
  gl_FragColor = vec4(0.75 * enc(neutralTM(c * 0.78458)) + 0.25 * enc(agxPunchy(c * 0.84090)), 1.0); }` };

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;
const B2T = (b) => new THREE.Vector3(b[0], b[2], -b[1]); // Blender -> three
// copy of a geometry with every attribute as a plain, non-normalized, non-interleaved Float32 attribute
// every texture the materials under root use (material slots and Blender graph uniforms), for memlean bit 4
function areaTextures(root) {
  const out = new Set(); const add = (v) => { if (v && v.isTexture && !v.isRenderTargetTexture) out.add(v); };
  root.traverse(o => { if (!o.isMesh) return; for (const m of (Array.isArray(o.material) ? o.material : [o.material])) { if (!m) continue;
    for (const k in m) add(m[k]); const u = m.userData?.blender?.uniforms; if (u) for (const k in u) add(u[k].value); } });
  return out;
}
// perf (Oct 16): the same values as a.getComponent(i, j) per component (three r169 denormalize), read straight from the
// typed array: one divisor per array type, stride and offset for interleaved data. RR_FLAGS.perfslowfloat = 1 keeps the old loop.
const DENORM = new Map([[Uint32Array, [4294967295.0, false]], [Uint16Array, [65535.0, false]], [Uint8Array, [255.0, false]],
  [Int32Array, [2147483647.0, true]], [Int16Array, [32767.0, true]], [Int8Array, [127.0, true]]]);
function toFloatAttr(a) {
  const n = a.count, s = a.itemSize, out = new Float32Array(n * s);
  const il = !!a.isInterleavedBufferAttribute, arr = il ? a.data.array : a.array, st = il ? a.data.stride : s, off = il ? a.offset : 0;
  const dn = a.normalized && arr.constructor !== Float32Array ? DENORM.get(arr.constructor) : null;
  if (a.normalized && arr.constructor !== Float32Array && !dn) { for (let i = 0; i < n; i++) for (let j = 0; j < s; j++) out[i * s + j] = a.getComponent(i, j); return out; }
  if (!dn) { if (!il && arr.constructor === Float32Array && arr.length === n * s) out.set(arr); else if (!il) { for (let k = 0, L = n * s; k < L; k++) out[k] = arr[k]; }
    else for (let i = 0; i < n; i++) { const b = i * st + off; for (let j = 0; j < s; j++) out[i * s + j] = arr[b + j]; } return out; }
  const D = dn[0];
  if (dn[1]) { for (let i = 0; i < n; i++) { const b = i * st + off; for (let j = 0; j < s; j++) out[i * s + j] = Math.max(arr[b + j] / D, -1.0); } }
  else { for (let i = 0; i < n; i++) { const b = i * st + off; for (let j = 0; j < s; j++) out[i * s + j] = arr[b + j] / D; } }
  return out;
}
function toFloatGeometry(src) {
  const g = new THREE.BufferGeometry();
  if (src.index) g.setIndex(new THREE.BufferAttribute(new Uint32Array(src.index.array), 1));
  const slow = +((globalThis.RR_FLAGS || {}).perfslowfloat || 0);
  for (const [k, a] of Object.entries(src.attributes)) {
    const n = a.count, s = a.itemSize; let out;
    if (slow) { out = new Float32Array(n * s); for (let i = 0; i < n; i++) for (let j = 0; j < s; j++) out[i * s + j] = a.getComponent(i, j); }
    else { out = toFloatAttr(a); if (PERF_CHECK()) { const o2 = new Float32Array(n * s); for (let i = 0; i < n; i++) for (let j = 0; j < s; j++) o2[i * s + j] = a.getComponent(i, j); perfCmp('toFloat', out, o2); } }
    g.setAttribute(k, new THREE.BufferAttribute(out, s));
  }
  for (const gr of src.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
  return g;
}
// RR_FLAGS.lowglass = 1 (agent glassfix3, Oct 14): curved storefront glass (the rotunda arcs rot_gC_glass, rot_gB_glass,
// w_glass, all gjl_glass_clear) is exported as flat facets about 0.6 m wide with one normal per facet, so each facet mirrors
// the box projected capture at its own angle and the reflected corridor breaks into offset vertical strips (sweep S36
// S30 S22 S23 S28 S29, 'reflection sliced into vertical bands'). A real curved pane mirrors one continuous, smoothly bent
// image. For a mesh whose vertices lie on one vertical circle (algebraic fit in world x z, radius 2 to 20 m, rms off the
// circle under 3 cm, at least 5 cm of sag across its span), the normals that already point within 37 degrees of the
// radius are replaced by the exact radius (sign kept), so the facet normals interpolate like a smooth cylinder. Slab edges
// and tops keep their own normals. Returns the fitted circle or null. Geometry is copied, never edited in place.
const PANE_PROP = /crystal|chand|bottle|wine|cup|glassware|vase|lamp|bulb|shade|pendant|sconce|decanter|carafe|jar|lantern/i;
function smoothCurvedPane(o) {
  const g0 = o.geometry, pos = g0 && g0.attributes.position, nrm = g0 && g0.attributes.normal;
  if (!pos || !nrm || o.isInstancedMesh || pos.count < 8) return null;
  o.updateMatrixWorld(true); const mw = o.matrixWorld, p = new THREE.Vector3();
  const xs = new Float64Array(pos.count), zs = new Float64Array(pos.count);
  let sx = 0, sz = 0, sxx = 0, szz = 0, sxz = 0, sr = 0, sxr = 0, szr = 0; const n = pos.count;
  for (let i = 0; i < n; i++) { p.fromBufferAttribute(pos, i).applyMatrix4(mw); xs[i] = p.x; zs[i] = p.z; }
  let mx = 0, mz = 0; for (let i = 0; i < n; i++) { mx += xs[i]; mz += zs[i]; } mx /= n; mz /= n;
  for (let i = 0; i < n; i++) { const x = xs[i] - mx, z = zs[i] - mz, r = x * x + z * z; sx += x; sz += z; sxx += x * x; szz += z * z; sxz += x * z; sr += r; sxr += x * r; szr += z * r; }
  // Kasa fit in centred coordinates: [sxx sxz sx; sxz szz sz; sx sz n] [D E F] = -[sxr szr sr]
  const A = [[sxx, sxz, sx], [sxz, szz, sz], [sx, sz, n]], b = [-sxr, -szr, -sr];
  const det3 = (M) => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  const dA = det3(A); if (!Number.isFinite(dA) || Math.abs(dA) < 1e-9) return null;
  const sol = [0, 1, 2].map(k => det3(A.map((row, i) => row.map((v, j) => (j === k ? b[i] : v)))) / dA);
  const cx = -sol[0] / 2, cz = -sol[1] / 2, R = Math.sqrt(Math.max(cx * cx + cz * cz - sol[2], 0));
  if (!(R >= 2 && R <= 20)) return null;
  let e2 = 0; for (let i = 0; i < n; i++) { const d = Math.hypot(xs[i] - mx - cx, zs[i] - mz - cz) - R; e2 += d * d; }
  // sag: largest distance of a point from the best straight line through all of them (principal axis of the x z spread),
  // so a flat pane (or a flat slab with two faces 2 cm apart) never counts as curved
  const cxx = sxx / n, czz = szz / n, cxz = sxz / n, ang = 0.5 * Math.atan2(2 * cxz, cxx - czz), lx = Math.cos(ang), lz = Math.sin(ang);
  let minD = Infinity, maxD = -Infinity; for (let i = 0; i < n; i++) { const t = -(xs[i] - mx) * lz + (zs[i] - mz) * lx; minD = Math.min(minD, t); maxD = Math.max(maxD, t); }
  const rms = Math.sqrt(e2 / n), sag = maxD - minD;
  // revA 14: rms under 1 cm (3 cm also passed Mesh_636 Material_262.001 at 3.5, 17.3, R 4.95, not a rotunda pane) and at
  // least 4 facets: distinct plan directions of the side normals modulo 180 degrees (a pane's front and back faces are one
  // facet), clustered at 1 degree
  if (rms > 0.01 || sag < 0.05) return null;
  const nm = new THREE.Matrix3().getNormalMatrix(mw), inm = nm.clone().invert(), v = new THREE.Vector3(), rd = new THREE.Vector3();
  { const angs = []; for (let i = 0; i < n; i++) { v.fromBufferAttribute(nrm, i).applyMatrix3(nm).normalize(); if (Math.abs(v.y) < 0.5) { let t = Math.atan2(v.z, v.x); if (t < 0) t += Math.PI; if (t >= Math.PI) t -= Math.PI; angs.push(t); } }
    angs.sort((a, b) => a - b); let facets = angs.length ? 1 : 0; for (let i = 1; i < angs.length; i++) if (angs[i] - angs[i - 1] > 0.0175) facets++;
    if (angs.length > 1 && angs[0] + Math.PI - angs[angs.length - 1] <= 0.0175 && facets > 1) facets--;
    if (facets < 4) return null; }
  const C = new THREE.Vector2(mx + cx, mz + cz);
  const g = toFloatGeometry(g0), na = g.attributes.normal;
  let changed = 0;
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(na, i).applyMatrix3(nm).normalize(); rd.set(xs[i] - C.x, 0, zs[i] - C.y); if (rd.lengthSq() < 1e-8) continue; rd.normalize();
    const dt = v.dot(rd); if (Math.abs(dt) < 0.8) continue;
    rd.multiplyScalar(Math.sign(dt)).applyMatrix3(inm).normalize(); na.setXYZ(i, rd.x, rd.y, rd.z); changed++;
  }
  if (!changed) { g.dispose(); return null; }
  o.geometry = g; return { cx: +C.x.toFixed(3), cz: +C.y.toFixed(3), R: +R.toFixed(3), rms: +rms.toFixed(4), sag: +sag.toFixed(3), changed };
}
// vertex normals that disagree with their own triangles (m66 pick, glass agent 7: merged cl_mt_reeded and mt_steel at
// B075 pz, face normal . ray -0.99 while the interpolated normal . ray +0.10): thin flat slabs such as panes and
// mullions arrive with normals skewed far off their faces, so they shade as if seen edge on (pale flat reeded glass,
// grey mullions). Returns the share of triangles whose mean vertex normal is more than 60 degrees off the face normal.
// perf (Oct 16): the same arithmetic as three r169 Vector3 applyMatrix4 / applyMatrix3 + normalize / transformDirection,
// done on the Float32 arrays toFloatGeometry made (no Vector3 per vertex). Bounding volumes are recomputed like
// BufferGeometry.applyMatrix4 does when they exist. RR_FLAGS.perf = 0 uses three's own applyMatrix4.
const PERF_ON = () => +((globalThis.RR_FLAGS || {}).perf ?? 1) !== 0;
// RR_FLAGS.perfcheck = 1: every fast path also runs the old code and compares bit for bit; counts in globalThis.__perfcheck
const PERF_CHECK = () => +((globalThis.RR_FLAGS || {}).perfcheck || 0) === 1;
function perfCmp(name, a, b) { const S = (globalThis.__perfcheck ||= {}); const r = (S[name] ||= { calls: 0, bad: 0, values: 0 }); r.calls++;
  if (a.length !== b.length || a.constructor !== b.constructor) { r.bad++; return; } const ua = new Uint8Array(a.buffer, a.byteOffset, a.byteLength), ub = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  let d = 0; for (let i = 0; i < ua.length; i++) if (ua[i] !== ub[i]) d++; r.values += a.length; if (d) { r.bad++; r.diffBytes = (r.diffBytes || 0) + d; } }
function applyMatrixFast(g, matrix) {
  if (!PERF_ON()) { g.applyMatrix4(matrix); return g; }
  if (PERF_CHECK()) { const ref = g.clone(); ref.applyMatrix4(matrix); applyMatrixFast0(g, matrix); for (const k of ['position', 'normal', 'tangent']) if (g.attributes[k]) perfCmp('applyMatrix:' + k, g.attributes[k].array, ref.attributes[k].array); ref.dispose(); return g; }
  return applyMatrixFast0(g, matrix); }
function applyMatrixFast0(g, matrix) {
  const e = matrix.elements, p = g.attributes.position;
  const plain = (a) => a && !a.isInterleavedBufferAttribute && a.array instanceof Float32Array && !a.normalized && a.itemSize === 3;
  if (p && !plain(p)) { g.applyMatrix4(matrix); return g; }
  const nA = g.attributes.normal, tA = g.attributes.tangent;
  if ((nA && !plain(nA)) || tA) { g.applyMatrix4(matrix); return g; }
  if (p) { const a = p.array, L = p.count * 3;
    for (let i = 0; i < L; i += 3) { const x = a[i], y = a[i + 1], z = a[i + 2]; const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
      a[i] = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w; a[i + 1] = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w; a[i + 2] = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w; }
    p.needsUpdate = true; }
  if (nA) { const nm = new THREE.Matrix3().getNormalMatrix(matrix).elements, a = nA.array, L = nA.count * 3;
    for (let i = 0; i < L; i += 3) { const x0 = a[i], y0 = a[i + 1], z0 = a[i + 2];
      let x = nm[0] * x0 + nm[3] * y0 + nm[6] * z0, y = nm[1] * x0 + nm[4] * y0 + nm[7] * z0, z = nm[2] * x0 + nm[5] * y0 + nm[8] * z0;
      const s = 1 / (Math.sqrt(x * x + y * y + z * z) || 1); a[i] = x * s; a[i + 1] = y * s; a[i + 2] = z * s; }
    nA.needsUpdate = true; }
  if (g.boundingBox !== null) g.computeBoundingBox(); if (g.boundingSphere !== null) g.computeBoundingSphere();
  return g;
}
function badNormalShareFast(g) {
  const p = g.attributes.position, n = g.attributes.normal; if (!p || !n) return 0;
  const P = p.array, N = n.array;
  const idx = g.index ? g.index.array : null, tc = idx ? idx.length / 3 : p.count / 3; if (!tc) return 0;
  let bad = 0, cnt = 0; const step = Math.max(1, Math.floor(tc / 4000));
  for (let i = 0; i < tc; i += step) {
    const a = idx ? idx[i * 3] : i * 3, b = idx ? idx[i * 3 + 1] : i * 3 + 1, c = idx ? idx[i * 3 + 2] : i * 3 + 2;
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2], bx = P[b * 3], by = P[b * 3 + 1], bz = P[b * 3 + 2], cx = P[c * 3], cy = P[c * 3 + 1], cz = P[c * 3 + 2];
    // f = (C - B) x (A - B), as Vector3.subVectors + cross
    const fx0 = cx - bx, fy0 = cy - by, fz0 = cz - bz, tx = ax - bx, ty = ay - by, tz = az - bz;
    let fx = fy0 * tz - fz0 * ty, fy = fz0 * tx - fx0 * tz, fz = fx0 * ty - fy0 * tx;
    if (fx * fx + fy * fy + fz * fz < 1e-14) continue;
    { const s = 1 / (Math.sqrt(fx * fx + fy * fy + fz * fz) || 1); fx *= s; fy *= s; fz *= s; }
    let mx = N[a * 3] + N[b * 3], my = N[a * 3 + 1] + N[b * 3 + 1], mz = N[a * 3 + 2] + N[b * 3 + 2]; mx += N[c * 3]; my += N[c * 3 + 1]; mz += N[c * 3 + 2];
    if (mx * mx + my * my + mz * mz < 1e-12) { bad++; cnt++; continue; }
    { const s = 1 / (Math.sqrt(mx * mx + my * my + mz * mz) || 1); mx *= s; my *= s; mz *= s; }
    if (mx * fx + my * fy + mz * fz < 0.5) bad++; cnt++;
  }
  return cnt ? bad / cnt : 0;
}
function badNormalShare(g) {
  if (PERF_ON()) { const p = g.attributes.position, n = g.attributes.normal;
    const ok = (a) => a && !a.isInterleavedBufferAttribute && a.array instanceof Float32Array && !a.normalized && a.itemSize === 3;
    if (ok(p) && ok(n)) { const v = badNormalShareFast(g); if (PERF_CHECK()) { const S = (globalThis.__perfcheck ||= {}); const r = (S.badNormal ||= { calls: 0, bad: 0 }); r.calls++; if (badNormalShareSlow(g) !== v) r.bad++; } return v; } }
  return badNormalShareSlow(g); }
function badNormalShareSlow(g) {
  const p = g.attributes.position, n = g.attributes.normal; if (!p || !n) return 0;
  const idx = g.index ? g.index.array : null, tc = idx ? idx.length / 3 : p.count / 3; if (!tc) return 0;
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), f = new THREE.Vector3(), m = new THREE.Vector3(), t = new THREE.Vector3();
  let bad = 0, cnt = 0; const step = Math.max(1, Math.floor(tc / 4000));
  for (let i = 0; i < tc; i += step) {
    const a = idx ? idx[i * 3] : i * 3, b = idx ? idx[i * 3 + 1] : i * 3 + 1, c = idx ? idx[i * 3 + 2] : i * 3 + 2;
    A.fromBufferAttribute(p, a); B.fromBufferAttribute(p, b); C.fromBufferAttribute(p, c);
    f.subVectors(C, B).cross(t.subVectors(A, B)); if (f.lengthSq() < 1e-14) continue; f.normalize();
    m.fromBufferAttribute(n, a).add(t.fromBufferAttribute(n, b)).add(t.fromBufferAttribute(n, c)); if (m.lengthSq() < 1e-12) { bad++; cnt++; continue; }
    if (m.normalize().dot(f) < 0.5) bad++; cnt++;
  }
  return cnt ? bad / cnt : 0;
}
function flipWinding(g) {
  if (!g.index) { // swap the 2nd and 3rd vertex of every triangle in every attribute (keeps the geometry non-indexed)
    for (const at of Object.values(g.attributes)) { const s = at.itemSize, a = at.array;
      for (let i = 0; i + 2 < at.count; i += 3) for (let j = 0; j < s; j++) { const p = (i + 1) * s + j, q = (i + 2) * s + j, t = a[p]; a[p] = a[q]; a[q] = t; } }
    return;
  }
  const a = g.index.array; for (let i = 0; i + 2 < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; }
}

// every material reachable from a pass or helper object (gate agent): same walk as prewarmExtras' grab
function grabMaterials(root, depth, R, out = [], seen = new Set()) { const grab = (v, d) => { if (!v || typeof v !== 'object' || seen.has(v)) return; seen.add(v);
    if (v.isMaterial) { out.push(v); return; } if (v.isMesh) return grab(v.material, d);
    if (v.isTexture || v.isWebGLRenderTarget || v.isRenderTarget || v.isBufferGeometry || v.isObject3D || v.isCamera || v.domElement || ArrayBuffer.isView(v) || v === R || d <= 0) return;
    for (const k of Object.keys(v)) { let x; try { x = v[k]; } catch (e) { continue; } grab(x, d - 1); } };
  grab(root, depth); return out; }
export class RowPlayer {
  constructor(canvas, { basis = './libs/basis/', onProgress = () => {}, interiorK = 0.5, capFmt = 'f16', walkCenter = null, walkRadius = 30, b64 = false, lite = false, ao = true, lights = 0.25, iblDiffuse = 1.4, iblUp = 1.0, iblDown = 0.65, checkShaders = false, lampNames = null, toneMap = 'grade360', exposureEV = 0.08, wb = null, bloom = 'ref', deferCompile = false, compileMode = 'sequential', openBudgetS = 60, nearFirst = false, msaa = null, profile = null } = {}) {
    // profile: device tier settings from rr2_device.js (phone texture tier, effects, budgets); empty = desktop defaults
    const PF = this.profile = profile || {}; this.inputEnabled = true; this._listeners = []; this.invalid = 2;
    this.b64 = b64; this.lite = lite; this.lampNames = lampNames; this.ao = ao && !lite; this.lightFactor = lights; IBL_DIFFUSE.value = lights > 0 ? iblDiffuse : 1.0; IBL_UP.value = iblUp; IBL_DOWN.value = iblDown;
    this.blLights = new Map();
    // every comparison records the exact configuration it ran with (no reliance on constructor defaults)
    this.report = { errors: [] }; this.report.config = { three: THREE.REVISION, interiorK, capFmt, walkRadius, b64, lite, ao: this.ao, lights, iblDiffuse, iblUp, iblDown, checkShaders: !!checkShaders, lampNames, toneMap, exposureEV, wb, bloom };
    // report.config.flagsSeen: every RR_FLAGS key read from here on (a Proxy over the same object; values pass through
    // unchanged). Keys read at module scope before the player exists (rr2_rooms.js, rr2_probes.js tables) are not listed.
    { const seen = new Set(), F0 = globalThis.RR_FLAGS || {};
      if (!F0.__rrSeen) globalThis.RR_FLAGS = new Proxy(F0, { get: (t, k) => { if (k === '__rrSeen') return seen; if (typeof k === 'string') seen.add(k); return t[k]; } });
      const S = globalThis.RR_FLAGS.__rrSeen; Object.defineProperty(this.report.config, 'flagsSeen', { enumerable: true, get: () => [...S].sort() }); }
    if (PF.name) this.report.config.profile = PF.name; // only with a device profile (Swoogo page); gputest reports stay as they were
    // MSAA on the scene colour target (signage strokes and logo cutouts thinner than a pixel broke up with SMAA alone):
    // 4 samples on desktop, none on the lite (phone) profile; RR_FLAGS.msaa or the msaa option overrides (0 turns it off);
    // a device profile's msaa comes after both (rr2_device.js: 0 on the phone tiers)
    { const F = globalThis.RR_FLAGS || {}; const want = F.msaa ?? msaa ?? PF.msaa ?? (lite ? 0 : 4); this.msaa = Math.max(0, Math.floor(+want || 0)); this.report.config.msaa = this.msaa; this.report.config.upTint = IBL_UP_TINT.value.toArray(); }
    this.walkCenter = walkCenter ? B2T(walkCenter) : null; this.walkRadius = walkRadius;
    this.interiorK = interiorK; this.capFmt = capFmt; this.deferCompile = deferCompile; this.compileMode = compileMode; this.openBudgetS = openBudgetS; this.nearFirst = nearFirst; this.wbVal = wb || (toneMap === 'agx' ? [0.95, 0.98, 1.05] : [1, 1, 1]);
    this.canvas = canvas; this.onProgress = onProgress;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', logarithmicDepthBuffer: !(globalThis.RR_FLAGS || {}).nologdepth });
    r.setPixelRatio(Math.min(devicePixelRatio, PF.maxDpr ?? (lite ? 1.25 : 2)));
    // device tier (rr2_tier.js), only with RR_FLAGS.tier: start pixel ratio, MSAA samples (RR_FLAGS.msaa still wins),
    // phone = the lite profile (no AO, no planar mirror, fewer lamps); the floor mirror scale, cove slots, transmission
    // and texture size are read further down. Without the flag this.tier is null and nothing here changes.
    const T = this.tier = pickTier(r);
    if (T) { r.setPixelRatio(T.dpr); if ((globalThis.RR_FLAGS || {}).msaa === undefined && msaa == null) this.msaa = T.msaa;
      if (T.lite) { this.lite = true; this.ao = false; }
      Object.assign(this.report.config, { tier: T.name, tierWhy: T.why, tierProbe: T.probe, dpr: T.dpr, msaa: this.msaa, lite: this.lite, ao: this.ao, reflect: T.reflect, coveNSlot: (globalThis.RR_FLAGS || {}).coveNSlot, transmission: T.transmission, texMax: T.texMax }); }
    // colour and data images filter with the GPU's full anisotropy (16 on desktop GPUs); rr2_scene reads it for the graph images.
    // A device profile's anisotropy caps it (phone tiers); without a profile this is the GPU maximum as before
    globalThis.RR_MAX_ANISO = Math.max(1, Math.min(r.capabilities.getMaxAnisotropy() || 1, PF.anisotropy ?? Infinity));
    // grade: measured against the Cycles stills of the Gjelina stop (Lab, 3 views): AgX at 0 EV with the white balance
    // below scores mean dE 9; Khronos PBR Neutral (the .blend's current scene setting) scores 18 to 20 at any exposure.
    r.toneMapping = toneMap === 'agx' ? THREE.AgXToneMapping : toneMap === 'grade360' ? THREE.NoToneMapping : THREE.NeutralToneMapping; r.toneMappingExposure = Math.pow(2, exposureEV); this.toneMap = toneMap; this.exposureEV = exposureEV; this.bloomMode = bloom;
    r.debug.checkShaderErrors = !!checkShaders; // off in production: the check forces each shader to compile one at a time
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0x15110e);
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.05, 400);
    this.caps = new CaptureCache(r, { keepUnused: PF.capKeep ?? 32 });
    this.ktx2 = new KTX2Loader().setTranscoderPath(basis).detectSupport(r);
    // RR_FLAGS.memlean bit 1: the images the glTF materials reference (the same ../img files the Blender graphs use)
    // go through the shared decode of rr2_assets.js instead of GLTFLoader's own ImageBitmapLoader, which held a second
    // full decode of each one for the life of the page
    const MLc = +((globalThis.RR_FLAGS || {}).memlean || 0);
    // main, Oct 29: meshopt decoding off the main thread (it was most of the 6 s geometry step of the main export)
    if (MeshoptDecoder.useWorkers && !+((globalThis.RR_FLAGS || {}).meshoptMain || 0)) MeshoptDecoder.useWorkers(Math.max(1, Math.min(4, ((globalThis.navigator && navigator.hardwareConcurrency) || 4) - 1)));
    this.loader = new GLTFLoader().setKTX2Loader(this.ktx2).setMeshoptDecoder(MeshoptDecoder); if (MLc & 1) this.loader.register(memleanGLTFPlugin);
    this.report = { errors: [], config: this.report?.config }; this.mode = 'stop';
    this.yaw = 0; this.pitch = 0; this.keys = new Set(); this.move = new THREE.Vector2(); this.vel = new THREE.Vector3();
    this.resize(); this._ro = new ResizeObserver(() => this.resize()); this._ro.observe(canvas);
    this.bindInput();
  }
  resize() {
    const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    if (this.composer) this.composer.setSize(w, h);
    if (this.aoPass) this.aoPass.setSize(w, h);
    if (this.floor) this.floor.setSize(this.renderer); // the mirror stays at its scale of the drawing buffer (it kept its first size)
    this.invalid = 2;
  }
  // openPose (optional): the pose the view opens on, { pos: Blender [x, y, z], yaw: degrees } as setStop takes them; the
  // warm flag builds its first view frustum from it. Default: walkCenter at 1.6 m, yaw 0 (player.html opens there).
  async load(areas, capsUrl, extraLights = true, { openPose = null } = {}) {
    this.openPose = openPose;
    // fallback base textures (see fallbackFor below): defined here so memlean can make and upload them with the rest
    // (bit 1: before the upload loop; bit 4: area by area, before the area's images are freed: a clone made after its
    // Source closed would have no GL texture of its own and draw black)
    const flipped = new Map();
    const flipClone = (t) => { if (!flipped.has(t)) { const c = t.clone(); c.repeat.set(1, -1); c.offset.set(0, 1); c.userData = {}; flipped.set(t, c); } return flipped.get(t); };
    const baseTex = (m) => { if (m.map) return m.map; const u = m.userData?.blender?.uniforms; if (!u) return null;
      for (const k of Object.keys(u)) { const t = u[k].value; if (t && t.isTexture && t.colorSpace === THREE.SRGBColorSpace) return flipClone(t); } return null; };
    const root = this.root = new THREE.Group(); this.scene.add(root);
    if (!(globalThis.RR_FLAGS || {}).lightunroll) this.report.lightLoops = rollLightLoops();
    if ((globalThis.RR_FLAGS || {}).lightloop) this.report.lightLoopsDyn = dynamicLightLoops(); // rr2_lightloop.js
    this.report.shField = await loadSHField(capsUrl + '/sh.json');
    let i = 0; const tl = this.report.timeline = []; const t0 = performance.now(); this.report.loadT0 = Math.round(t0); const mark = (m) => tl.push([+((performance.now() - t0) / 1000).toFixed(2), m]);
    if (lmOn() && !this.lmData && !this.lmPromise) { this.lmPromise = loadLightmaps((globalThis.RR_FLAGS || {}).lmurl || 'data/lm/lm.json'); this.lmPromise.catch(() => {}); }   // main 04:3x: atlases download alongside the GLBs
    // every section's files are requested up front through one priority queue (the start section first, outer
    // sections after); materials and lighting are then applied section by section in order while later downloads run
    const center = this.walkCenter ? [this.walkCenter.x, -this.walkCenter.z] : null;
    const jobs = areas.map((entry, k) => {
      // 'path|far:31' = an outer section used only for what lies beyond 31 m of the start (the main export covers the rest)
      const [url, opt] = entry.split('|'); const farMin = opt && opt.startsWith('far:') ? +opt.slice(4) : 0;
      const priority = k === 0 ? PRI.start : PRI.area - k;
      const meta = Promise.all([queuedFetch(url + '/inventory.json', { priority, as: 'json' }), queuedFetch(url + '/scene_extra.json', { priority, as: 'json' }),
        queuedFetch(url + '/images.json', { priority, as: 'json' }).catch(() => null), queuedFetch(url + '/objmat.json', { priority, as: 'json' }).catch(() => null)]);
      const area = meta.then(([inv]) => loadArea(this.loader, url, inv, this.report, { b64: this.b64, priority }));
      area.catch(() => {}); return { url, farMin, priority, meta, area };
    });
    for (const { url, farMin, priority, meta, area: areaP } of jobs) {
      this.onProgress(`Loading area ${++i} of ${areas.length}`, { phase: 'areas', done: i - 1, total: areas.length });
      const [inv, extra, images, objmat] = await meta; if (images) extra.images = images; signfixImages(extra); frontsfixExtra(extra, this.report);   // rr2_frontsfix.js: Delmonico, Donutique graphs
      for (const l of extra.lights || []) if (!this.blLights.has(l.name)) this.blLights.set(l.name, l);
      Object.assign(this.blMats ||= {}, extra.materials || {});
      const area = await areaP; mark('geometry ' + url);
      // RR_FLAGS.memlean bit 4: the area's glTF slot textures before its materials are compiled (see memleanAreaDone)
      const ML4 = (+((globalThis.RR_FLAGS || {}).memlean || 0) & 5) === 5; const mlSnap = ML4 ? areaTextures(area) : null;
      // RR_FLAGS.dupdrop = 1 (integ2, Oct 14): a far section (|far:) repeats every object of the main export whose box comes
      // within its far radius (gjM2c holds all of them whole), and the far test below drops those copies only after the 6 m
      // sheet split: the pieces of a split copy that lie past 32 m survive and draw a second time over the main export's
      // own pieces (live set: 64 objects, about 439 pieces, 94k triangles, among them Mesh_1491's posts, del_carpet,
      // Mesh_2236/2237, continuous-marble-floor; the doubled floatfix2, floorblack and propFix reports). Here an object of
      // a far section whose inventory name and box (1 cm) match an object an earlier section already loaded is removed
      // before compile, capture lighting and the split, which also saves that work for the 3886 copies the far test used to
      // drop late. Instanced prototypes are left to the per instance far test.
      if (farMin && +((globalThis.RR_FLAGS || {}).dupdrop ?? 0)) {
        const byNode = new Map(((inv && inv.inventory) || []).filter(r => r.node && r.name && r.bbox).map(r => [r.node, r.name + '|' + r.bbox.map(v => Math.round(v * 100)).join(',')]));
        const seen = (this.dupKeys ||= new Set()), drop = []; let tris = 0;
        area.traverse(o => { if (!o.isMesh || o.isInstancedMesh) return; let n = o; while (n && !byNode.has(n.name)) n = n.parent; if (n && seen.has(byNode.get(n.name))) drop.push(o); });
        for (const o of drop) { const g = o.geometry; tris += g ? (g.index ? g.index.count : g.attributes.position.count) / 3 : 0; o.parent.remove(o); }
        (this.report.dupdrop ||= {})[url] = { meshes: drop.length, tris: Math.round(tris) };
      }
      // every section registers its object keys so a later far section can recognise its copies (cheap: inventory only)
      if (+((globalThis.RR_FLAGS || {}).dupdrop ?? 0)) { const seen = (this.dupKeys ||= new Set());
        for (const r of ((inv && inv.inventory) || [])) if (r.node && r.name && r.bbox && r.status === 'exported') seen.add(r.name + '|' + r.bbox.map(v => Math.round(v * 100)).join(',')); }
      // materials used only by instanced prototypes were left out of an area's scene_extra by the b7e1 exporter (mt21
      // pm_mosaic_champagne and rr_del_alabaster on the far Delmonico pilasters, mt11 Wood.002 and si_green_uph): take
      // them from the areas loaded before (images resolve only when this area lists them; these graphs are procedural)
      const xm = { ...this.blMats, ...(extra.materials || {}) };
      if ((globalThis.RR_FLAGS || {}).propcap) propMatOverrides(xm, globalThis.RR_FLAGS, this.report); // rr2_propfix.js: calmer capital bump
      // endfix2 (interfix agent, Oct 14): placeholder materials at the corridor ends. cl_vw_limestone (pat_archwall, the
      // Palazzo atrium arches; pcr_header, the Palazzo corridor header) is a two tone cream noise at scale 40 with no
      // texture, so the arches read as flat beige next to pat_bpil / pcr_pil in cl_mt_limestone (marble_01_diff.jpg):
      // it takes that graph. cl_volt_matteblack (Voltaire doors, header, vp_platform_edge, vp_door_*_gk_grv) is base
      // 0.004, roughness 0.85, specular level 0.2: a dead black that reads as cut lines along the platform and thresholds;
      // RR_FLAGS.voltblk (default 0.02, 0 keeps Blender's values) lifts it to a dark satin. Both deviate from the .blend
      // on purpose; the Blender fix is to give those objects real materials (see agent_interfix/REPORT.md)
      if ((globalThis.RR_FLAGS || {}).endfix2) {
        const EF = globalThis.RR_FLAGS;
        // RR_FLAGS.endfix2obj = 1 (agent fixV, Oct 15): the r7 plan build gave cl_vw_limestone to whole new corridor walls
        // (mt42 pcr_wallL, pcr_wallR, pcr_end, pat_wB, pat_back; mt41c pat_wA, pat_top_over), which the alias then turned
        // into marble_01 block walls. With endfix2obj only the objects named by RR_FLAGS.endfix2objre (default the two the
        // alias was made for, pat_archwall and pcr_header) take the other graph, through a renamed copy of their material;
        // every other cl_vw_limestone object keeps its own graph
        const objRe = +(EF.endfix2obj ?? 0) ? new RegExp(EF.endfix2objre || '^(pat_archwall|pcr_header)$') : null;
        for (const [dst, from] of Object.entries(EF.endfix2Alias || { cl_vw_limestone: 'cl_mt_limestone' })) if (xm[dst] && xm[from]) {
          if (!objRe) { xm[dst] = xm[from]; ((this.report.endfix2 ||= {}).alias ||= []).push(dst + '<' + from + ' ' + url); continue; }
          const nn = dst + '@ef2'; let k = 0; xm[nn] = xm[from];
          const bn = new Map(((inv && inv.inventory) || []).filter(r => r.node && r.name).map(r => [r.node, r.name]));
          const invNm = (o) => { let n = o; while (n && !bn.has(n.name)) n = n.parent; return n ? bn.get(n.name) : ''; };
          area.traverse(o => { if (!o.isMesh || !objRe.test(invNm(o))) return;
            const ms = Array.isArray(o.material) ? o.material : [o.material];
            const rep = ms.map(m => { if (!m || m.name !== dst) return m; k++; const c = m.clone(); c.name = nn; return c; });
            o.material = Array.isArray(o.material) ? rep : rep[0]; });
          ((this.report.endfix2 ||= {}).aliasObj ||= []).push(dst + '<' + from + ' ' + k + ' ' + url); }
      }
      // RR_FLAGS.globefix = 1 (agent vmisc, Oct 15, off unless set): the Gjelina rotunda globe pendants ri_globe33 to
      // ri_globe63 (14 objects, ri_glow, gjM2c / mt11c / mt21c) are crumpled in the exported mesh data: their 16 x 10 UV
      // sphere rings keep the right heights but the ring vertices sit at random radii (equator 0.002 to 0.21 m where the
      // healthy ri_globe70 to ri_globe113 have 0.124 at every vertex), so they draw as flat faceted cream discs with dark
      // notches (sweep rv03 3, W026). The same data is in every export since gjM2 (agent_fix1/data), so it is the Blender
      // mesh itself; ri_globe00 to ri_globe32 have no faces at all (inventory: excluded, no faces) and cannot be rebuilt here.
      // A mesh whose inventory name matches RR_FLAGS.globefixre (default ^ri_globe\d+$) and whose ring radii spread by more
      // than 20 % gets a clean 16 x 10 sphere in its own local frame, with the healthy globes' proportions (horizontal
      // radius 1.127 times the vertical one; the vertical extent is kept). Positions and normals only, like the export.
      if (+((globalThis.RR_FLAGS || {}).globefix ?? 0)) { const F = globalThis.RR_FLAGS, re = new RegExp(F.globefixre || '^ri_globe\\d+$'); const fixed = [];
        const bn = new Map(((inv && inv.inventory) || []).filter(r => r.node && r.name).map(r => [r.node, r.name]));
        const invNm = (o) => { let n = o; while (n && !bn.has(n.name)) n = n.parent; return n ? bn.get(n.name) : ''; };
        area.traverse(o => { if (!o.isMesh || o.isInstancedMesh || !o.geometry?.attributes?.position) return; const nm = invNm(o); if (!re.test(nm)) return;
          const p = o.geometry.attributes.position; let y0 = Infinity, y1 = -Infinity; for (let i = 0; i < p.count; i++) { const y = p.getY(i); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
          const ym = (y0 + y1) / 2, hy = (y1 - y0) / 2; let r0 = Infinity, r1 = 0;
          for (let i = 0; i < p.count; i++) if (Math.abs(p.getY(i) - ym) < 0.05 * hy) { const r = Math.hypot(p.getX(i), p.getZ(i)); r0 = Math.min(r0, r); r1 = Math.max(r1, r); }
          if (!(hy > 0) || !(r1 > 0) || r0 > 0.8 * r1) return;
          const cx = 0, cz = 0; // the node origin is the globe centre (inventory box centre = node translation for every ri_globe)
          const g = new THREE.SphereGeometry(1, 16, 10); g.deleteAttribute('uv'); g.scale(1.127 * hy, hy, 1.127 * hy); g.translate(cx, ym, cz);
          o.geometry.dispose(); o.geometry = g; fixed.push(nm); });
        (this.report.globefix ||= []).push(url + ' ' + fixed.length + (fixed.length ? ' ' + fixed.join(',') : '')); }
      const cst = await compileAndApply(area, { ...extra, materials: xm }, url, { ktx2: this.ktx2, priority }); mark('materials ' + url);
      // RR_FLAGS.skyemis = k (agent vmisc, Oct 15, off unless set): the poppy court laylight pat_skylight (pat_sky, mt41c,
      // 12 x 12 m at z 8) is a Principled with an unlinked Emission Color (1, 0.96, 0.88) and Strength 4. Unlinked emission
      // is not compiled from the graph (blender_material.js writes res.emission only for linked sockets); it reaches three as
      // the glTF emissive factor times KHR_materials_emissive_strength (emissiveIntensity 4), which the grade shows as a flat
      // pure white rectangle (sweep rv09 9, rv10 7). That is also why fixV's skycap (an edit of the graph's Emission
      // Strength) changed nothing. Here the material's emissiveIntensity is scaled by k for the materials named by
      // RR_FLAGS.skyemisre (default ^pat_sky$). No Cycles 360 lies near it, so k is a judgement value (see agent_vmisc)
      if (+((globalThis.RR_FLAGS || {}).skyemis ?? 0) > 0) { const F = globalThis.RR_FLAGS, k = +F.skyemis, re = new RegExp(F.skyemisre || '^pat_sky$'); let n = 0;
        area.traverse(o => { if (!o.isMesh) return; for (const m of (Array.isArray(o.material) ? o.material : [o.material]))
          if (m && re.test(m.name || '') && m.emissive && !m.userData.skyemis) { m.userData.skyemis = k; m.emissiveIntensity *= k; n++; } });
        (this.report.skyemis ||= []).push(url + ' ' + n + ' x' + k); }
      // endfix2: the constant Principled values of cl_volt_matteblack reach three as glTF factors, not through the graph
      if ((globalThis.RR_FLAGS || {}).endfix2 && +(globalThis.RR_FLAGS.voltblk ?? 0.02) > 0) { const EF = globalThis.RR_FLAGS, vb = +(EF.voltblk ?? 0.02); let nv = 0;
        area.traverse(o => { if (!o.isMesh) return; for (const m of (Array.isArray(o.material) ? o.material : [o.material]))
          if (m && m.isMeshStandardMaterial && /^cl_volt_matteblack(\.\d+)?$/.test(m.name || '') && !m.userData.voltblk) { m.userData.voltblk = true; nv++;
            m.color.setRGB(vb, vb, vb, THREE.LinearSRGBColorSpace); m.roughness = +(EF.voltrough ?? 0.45); if ('specularIntensity' in m) m.specularIntensity = 1; m.needsUpdate = true; } });
        (this.report.endfix2 ||= {}).voltblk = ((this.report.endfix2 || {}).voltblk || 0) + nv; }
      fixObjectCoords(area, inv, objmat, this.report);
      signfixArea(area, inv, this.report);   // RR_FLAGS.signfix: kiosk screen U flip, DELMONICO letter spacing
      frontsfixArea(area, inv, this.report);   // rr2_frontsfix.js: Yardbird beams and shutters, Donutique stone, halo, threshold
      // Cycles ignores Blender's per-material Backface Culling flag, glTF turns it into single-sided materials. Several
      // imported ceilings (rotunda Mesh_16xx) face upward with culling on, so the viewer saw through them where the
      // Cycles reference shows a ceiling. Draw every opaque surface two-sided, as Cycles does.
      if (!(globalThis.RR_FLAGS || {}).notwosided) { const fixed = new Set(); area.traverse(o => { if (!o.isMesh) return; for (const m of (Array.isArray(o.material) ? o.material : [o.material]))
          if (m && !m.transparent && m.side === THREE.FrontSide) { m.side = THREE.DoubleSide; m.needsUpdate = true; fixed.add(m.uuid); } });
        this.report.twoSided = (this.report.twoSided || 0) + fixed.size; }
      // ceilfix bit 8 (agent ceilfix, Oct 14): lift the up facing rotunda soffit sheets off the soffits they z fight with
      if (((globalThis.RR_FLAGS || {}).ceilfix === true ? 15 : +((globalThis.RR_FLAGS || {}).ceilfix) || 0) & 8) { const { applyCeilLift } = await import('./rr2_ceilfix.js'); applyCeilLift(area, inv, this.report); }
      (this.report.compile ||= {})[url] = { materials: cst.materials, compiled: cst.compiled, simple: cst.simple || 0, skipped: cst.skipped, failed: cst.failed, notes: cst.notes };
      // Big flat floor and ceiling sheets (d2_floor runs 48 m, continuous-marble-floor 98 m) used to take one capture for
      // the whole sheet, chosen by visibility at export (d2_floor got B084 at Delmonico, 25 m from B002): whole runs of tiles
      // were lit from the wrong place and stepped at object edges (Ryan, B002 floor). Cut them into 6 m pieces here, each
      // lit by its nearest capture.
      { area.updateMatrixWorld(true); const bb = new THREE.Box3(), big = [];
        area.traverse(o => { if (!o.isMesh || o.isInstancedMesh || !o.geometry || !o.geometry.attributes.position) return; bb.setFromObject(o);
          const t = bb.max.y - bb.min.y, ext = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
          // thin floor / ceiling sheets over 8 m, and any object over 15 m (the original building ceiling meshes Mesh_1566,
          // Mesh_2236, Mesh_2237 run the length of the row with several ceiling levels in one object)
          // RR_FLAGS.splitbig=0 (test, end agent Oct 14): split only the thin floor and ceiling sheets, not every object over
          // 15 m. The merged Milos meshes Mesh_2262 (display frame and stools, mil_stool_fabric 0.2 0.23 0.26), Mesh_2249
          // (Material_110), Mesh_2253 (Material_107) and Mesh_240 are all over 15 m, mirrored (scale x -1) and read 10x
          // too bright at B082 nz / B000 nz with no glass in front (frame: ref sRGB 22, m59 198)
          const splitBig = ((globalThis.RR_FLAGS || {}).splitbig ?? 1) !== 0;
          const sheet = t < 0.03 && ext > 8 && (bb.max.y < 0.3 || bb.min.y > 2.0);
          // endfix: an object split only for its size (not a floor or ceiling sheet) keeps the centre of its whole box, so
          // rr2_probes.js and rr2_rooms.js can light its pieces as the object they came from (room probe, interiorK, room gate)
          if (sheet || (splitBig && ext > 15)) { if (!sheet && (globalThis.RR_FLAGS || {}).endfix) o.userData.splitC = bb.getCenter(new THREE.Vector3()).toArray(); big.push(o); } });
        const C = 6, wp = new THREE.Vector3(); let pieces = 0;
        for (const o of big) {
          const g = o.geometry, idx = g.index, n = idx ? idx.count : g.attributes.position.count, pos = g.attributes.position, cells = new Map();
          // long triangles are cut (longest edge in half, down to 3 m) before they are sorted into cells by centroid: a
          // 40 m sliver of continuous-marble-floor used to land whole in one far cell and was lit from there (pale
          // triangular shards on the floor at B009/B002 nz). New vertices are barycentric mixes of the original three,
          // so every attribute is interpolated exactly.
          const W3 = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], bw = (b, out) => out.set(0, 0, 0).addScaledVector(W3[0], b[0]).addScaledVector(W3[1], b[1]).addScaledVector(W3[2], b[2]);
          const qa = new THREE.Vector3(), qb = new THREE.Vector3(), qc = new THREE.Vector3();
          for (let i = 0; i < n; i += 3) {
            const ids = [0, 1, 2].map(k => idx ? idx.getX(i + k) : i + k);
            for (let k = 0; k < 3; k++) W3[k].fromBufferAttribute(pos, ids[k]).applyMatrix4(o.matrixWorld);
            const stack = [[[1, 0, 0], [0, 1, 0], [0, 0, 1], 0]];
            while (stack.length) { const [b0, b1, b2, depth] = stack.pop(); bw(b0, qa); bw(b1, qb); bw(b2, qc);
              const e = [qa.distanceTo(qb), qb.distanceTo(qc), qc.distanceTo(qa)], L = Math.max(...e);
              if (L > C / 2 && depth < 12) { const k = e.indexOf(L), B = [b0, b1, b2], u = B[k], v = B[(k + 1) % 3], w = B[(k + 2) % 3], mid = [0, 1, 2].map(t => (u[t] + v[t]) / 2);
                stack.push([u, mid, w, depth + 1], [mid, v, w, depth + 1]); continue; }
              const cx = (qa.x + qb.x + qc.x) / 3, cz = (qa.z + qb.z + qc.z) / 3, key = Math.floor(cx / C) + ',' + Math.floor(cz / C);
              (cells.get(key) || cells.set(key, []).get(key)).push({ i, ids, b: [b0, b1, b2] }); } }
          if (cells.size < 2) continue;
          const names = Object.keys(g.attributes), groups = g.groups && g.groups.length ? g.groups : null;
          for (const tris of cells.values()) {
            const ng = new THREE.BufferGeometry();
            // attributes can be interleaved and quantized (meshopt): read and write through the accessors, never the raw array
            const GET = ['getX', 'getY', 'getZ', 'getW'], SET = ['setX', 'setY', 'setZ', 'setW'];
            for (const nm of names) { const a = g.attributes[nm], n2 = a.itemSize;
              const ArrT = a.isInterleavedBufferAttribute ? a.data.array.constructor : a.array.constructor;
              const out = new THREE.BufferAttribute(new ArrT(tris.length * 3 * n2), n2, a.normalized); let w = 0;
              // perf (Oct 16): the same reads and writes as getX..getW / setX..setW (three r169 denormalize and normalize),
              // straight on the typed arrays; Float16 attributes and RR_FLAGS.perf = 0 keep the accessor loop
              if (PERF_ON() && !a.isFloat16BufferAttribute && n2 <= 4) {
                const il = !!a.isInterleavedBufferAttribute, src = il ? a.data.array : a.array, st = il ? a.data.stride : n2, off = il ? a.offset : 0;
                const dn = a.normalized ? DENORM.get(src.constructor) || null : null, dst = out.array;
                const nmul = a.normalized ? (dn ? dn[0] : 0) : 0;
                const rd = dn ? (dn[1] ? (j) => Math.max(src[j] / dn[0], -1.0) : (j) => src[j] / dn[0]) : (j) => src[j];
                for (const t of tris) for (let k = 0; k < 3; k++) { const bb3 = t.b[k];
                  for (let c = 0; c < n2; c++) { let v = 0; for (let q = 0; q < 3; q++) if (bb3[q]) v += bb3[q] * rd(t.ids[q] * st + off + c); dst[w * n2 + c] = nmul ? Math.round(v * nmul) : v; } w++; }
                if (PERF_CHECK()) { const o2 = new THREE.BufferAttribute(new ArrT(tris.length * 3 * n2), n2, a.normalized); let w2 = 0;
                  for (const t of tris) for (let k = 0; k < 3; k++) { const bb3 = t.b[k]; for (let c = 0; c < n2; c++) { let v = 0; for (let q = 0; q < 3; q++) if (bb3[q]) v += bb3[q] * a[GET[c]](t.ids[q]); o2[SET[c]](w2, v); } w2++; }
                  perfCmp('sheetSplit', dst, o2.array); }
              } else {
              for (const t of tris) for (let k = 0; k < 3; k++) { const bb3 = t.b[k];
                for (let c = 0; c < n2; c++) { let v = 0; for (let q = 0; q < 3; q++) if (bb3[q]) v += bb3[q] * a[GET[c]](t.ids[q]); out[SET[c]](w, v); } w++; } }
              ng.setAttribute(nm, out); }
            if (groups) { let start = 0; for (const t of tris) { const gr = groups.find(q => t.i >= q.start && t.i < q.start + q.count); ng.addGroup(start, 3, gr ? gr.materialIndex : 0); start += 3; } }
            const m = new THREE.Mesh(ng, o.material); m.name = o.name; m.position.copy(o.position); m.quaternion.copy(o.quaternion); m.scale.copy(o.scale);
            m.userData = { ...o.userData, capNearest: true }; m.renderOrder = o.renderOrder; o.parent.add(m); pieces++; }
          o.parent.remove(o); g.dispose(); }
        (this.report.sheetSplit ||= {})[url] = { sheets: big.length, pieces }; }
      await assignCaptureLighting(area, inv, capsUrl, this.renderer, { size: this.profile.capSize ?? 256, report: this.report, interiorK: this.interiorK, capFmt: this.capFmt, cache: this.caps, center }); mark('captures ' + url);
      signfixLight(area, inv, this.report);   // RR_FLAGS.signfix: glossy signs and kiosks lit by a far capture (rr2_signfix.js ENVK)
      if (farMin && this.walkCenter) {
        area.updateMatrixWorld(true); const bb = new THREE.Box3(), drop = [];
        const near = (b) => Math.hypot(Math.max(b.min.x - this.walkCenter.x, 0, this.walkCenter.x - b.max.x), Math.max(b.min.z - this.walkCenter.z, 0, this.walkCenter.z - b.max.z)) < farMin;
        // An InstancedMesh is tested per instance: Box3.setFromObject gives the union of all its instances, so one batch
        // holding a near copy and far copies (mt21 PIL_P0 parts: pilasters P0 and S near, T and P1 far; mt21 wine glasses)
        // was dropped whole and the far copies vanished (Delmonico pilasters PIL_T and PIL_P1 missing at B080/B084).
        const im = new THREE.Matrix4(), ib = new THREE.Box3(); let instDropped = 0;
        area.traverse(o => { if (!o.isMesh) return;
          if (o.isInstancedMesh) { const g = o.geometry; if (!g.boundingBox) g.computeBoundingBox(); let k = 0;
            for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, im); ib.copy(g.boundingBox).applyMatrix4(im).applyMatrix4(o.matrixWorld);
              if (near(ib)) { instDropped++; continue; } if (k !== i) { o.setMatrixAt(k, im); if (o.instanceColor) { const c = new THREE.Color(); o.getColorAt(i, c); o.setColorAt(k, c); } } k++; }
            if (k === 0) drop.push(o); else if (k !== o.count) { o.count = k; o.instanceMatrix.needsUpdate = true; if (o.instanceColor) o.instanceColor.needsUpdate = true; o.boundingBox = null; o.boundingSphere = null; }
            return; }
          bb.setFromObject(o); if (near(bb)) drop.push(o); });
        for (const o of drop) o.parent.remove(o); (this.report.farDropped ||= {})[url] = drop.length; if (instDropped) (this.report.farDroppedInstances ||= {})[url] = instDropped;
      }
      // floating fixture fixes (rr2_floatfix.js): RR_FLAGS.fasciafill fills the head and fascia gap over Matteo's door
      // transom, RR_FLAGS.dedupe drops objects exported twice at the same place
      // integ (Oct 14): assignCaptureLighting sets userData.invName only on MeshStandardMaterial meshes; the name based hooks
      // below (floatfix2 matches invName only) also need it on basic or shader material meshes, so fill it from the inventory
      { const FF = globalThis.RR_FLAGS || {}; if (FF.fasciafill || FF.dedupe || FF.roomdiag || FF.floatfix2 || FF.propfix || FF.propcol || FF.proprods) {
        const bn = new Map(inv.inventory.filter(r => r.node && r.name).map(r => [r.node, r.name]));
        area.traverse(o => { if (!o.isMesh || o.userData.invName) return; let n = o; while (n && !bn.has(n.name)) n = n.parent; if (n) o.userData.invName = bn.get(n.name); }); } }
      { const FF = globalThis.RR_FLAGS || {}; if (FF.fasciafill || FF.dedupe || FF.roomdiag) floatFix(area, FF, this.report); }
      // original model leftovers hanging in the corridor (rr2_floatfix2.js, RR_FLAGS.floatfix2): triangle clip by object and box
      { const FF = globalThis.RR_FLAGS || {}; if (FF.floatfix2) floatFix2(area, FF, this.report); }
      // prop fixes at the Palazzo end (rr2_propfix.js): RR_FLAGS.propfix=1 culls the round bases inside the square piers,
      // the stray pedestal sliver, duplicate cafe chairs and mullions, moves the host podium off the topiary pedestal, adds
      // pedestal C; RR_FLAGS.propcol=1 lowers the two rotunda columns so their capitals sit under the ring, RR_FLAGS.proprods=1
      // culls bare pendant drop rods
      { const FP = globalThis.RR_FLAGS || {}; if (FP.propfix || FP.propcol || FP.proprods) propFix(area, FP, this.report, inv); }   // inv: r3 guard sees an instanced cl_ped_C
      // RR_FLAGS.memlean bit 4 (with bit 1, memlean=5 or 7): upload this area's textures now and free the decoded images
      // whose every Texture so far has uploaded (rr2_assets.js memleanAreaDone), so the CPU copies of all areas never
      // live at once. The glTF slot textures first get the anisotropy the pass after the loop would give them (seenM
      // below): a sampler change after the upload would need the closed image again.
      if (ML4) { const live = areaTextures(area), A = globalThis.RR_MAX_ANISO;
        // every sRGB graph texture gets its fallback clone now, not only the one baseTex picks for this material: a later
        // area's material may pick the same texture as its base after this area's Source closed
        area.traverse(o => { if (!o.isMesh) return; for (const m of (Array.isArray(o.material) ? o.material : [o.material])) { if (!m) continue; const u = m.userData?.blender?.uniforms;
          if (u) for (const k in u) { const t = u[k].value; if (t && t.isTexture && !t.isRenderTargetTexture && t.colorSpace === THREE.SRGBColorSpace) live.add(flipClone(t)); } } });
        area.traverse(o => { if (!o.isMesh || !o.material?.isMeshStandardMaterial) return; const m = o.material;
          for (const k of ['map', 'emissiveMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap', 'bumpMap']) { const t = m[k];
            if (t?.isTexture && !t.isCompressedTexture && t.anisotropy < A) { t.anisotropy = A; if (t.version > 0) t.needsUpdate = true; } } });
        let nu = 0; for (const t of live) { if (t.isRenderTargetTexture) continue; this.renderer.initTexture(t); nu++; }
        const closed = memleanAreaDone(this.renderer, live, mlSnap); (this.report.memleanAreas ||= {})[url] = { textures: nu, closed }; mark('textures ' + url); }
      root.add(area);
    }
    this.onProgress('Preparing materials', { phase: 'areas', done: areas.length, total: areas.length });
    // ?floorblack=1 (floorblack agent, Oct 14): the hard black parallelograms, combs and wedges on the corridor floor are the
    // floor level slab of the original building mesh Mesh_1491 (Material_109.001, black stone, base colour 0.018): a 2 cm
    // slab (z 0.025 to 0.045) along the OLD storefront line, which the rebuilt fronts (MATTEOS_Front, cl_mt2_*) no longer
    // follow. It sits 1 cm above continuous-marble-floor (0.035) wherever d2_floor (0.046) does not cover it, so it shows as
    // a black strip with a fan of sliver triangles (the comb) at x 30.5 to 32.4, y 0.1 to 1.5 (S44..S51), wedges at
    // x 18.4 to 24.3, y -7.3 to -4.7 (S40, S41, S43, S44) and a patch at x -4.9 to -3.8, y -17.2 to -16.2 (Blender coords).
    // Ray picks and a top down exposure test against the exported GLBs (gjM2c, mt21, mt31) found nothing else of it at
    // floor level. The table drops every triangle of the listed objects whose three corners lie below the given height
    // (Blender z, three y): 224 of 4634 triangles of Mesh_1491 (the 0.025 and 0.045 slab tops and five loose 0.075 caps,
    // none of them joined to a side face), 42 of 542 of Mesh_1494. The 12 cm kick plate tops (z 0.118) and everything above
    // stay. Mesh_1494 (Material_109) carries the same slab (z 0.019 to 0.025, under the floor today), dropped too so a floor
    // level change cannot expose it.
    // ?floorblackz=x overrides every height in the table.
    if ((globalThis.RR_FLAGS || {}).floorblack) {
      const FBZ = { Mesh_1491: 0.08, Mesh_1494: 0.08 }, zo = (globalThis.RR_FLAGS || {}).floorblackz, out = [];
      root.updateMatrixWorld(true); const va = new THREE.Vector3();
      root.traverse(o => { if (!o.isMesh || o.isInstancedMesh) return; const nm = o.userData.invName || o.name, base = FBZ[nm]; if (base === undefined) return; const zmax = zo ?? base;
        const g = o.geometry, pos = g.attributes.position, idx = g.index, n = idx ? idx.count : pos.count;
        if (g.groups && g.groups.length > 1) return;
        const keep = []; let dropped = 0;
        for (let i = 0; i + 2 < n; i += 3) { let low = 0;
          for (let k = 0; k < 3; k++) { const v = idx ? idx.getX(i + k) : i + k; va.fromBufferAttribute(pos, v).applyMatrix4(o.matrixWorld); if (va.y < zmax) low++; }
          if (low === 3) { dropped++; continue; } for (let k = 0; k < 3; k++) keep.push(idx ? idx.getX(i + k) : i + k); }
        if (!dropped) return;
        const ng = new THREE.BufferGeometry(); for (const a of Object.keys(g.attributes)) ng.setAttribute(a, g.attributes[a]);
        ng.setIndex(keep); o.geometry = ng; out.push([nm, dropped, keep.length / 3]); });
      this.report.floorBlack = out; }
    mark('pass floorblack');
    // Coplanar sheets. The model has several floor objects on the same plane (d2_floor, ap_floor, continuous-marble-floor at
    // z 0.04 to 0.05, all cream marble) and stacked ceiling fills. Cycles shows one consistent surface; here each object is
    // lit by its own capture, and the depth test picks a winner triangle by triangle, so the floor flickered tile by tile
    // between differently lit copies (Ryan, B002). One winner everywhere: among overlapping flat sheets the smaller (more
    // specific) one sits in front by 1.5 mm per rank, at most 9 mm (floors move down, ceilings up). Inlays stay on top.
    { root.updateMatrixWorld(true); const bb = new THREE.Box3(); const sheets = [];
      root.traverse(o => { if (!o.isMesh || o.isInstancedMesh || !o.material || o.material.transparent) return; bb.setFromObject(o);
        const t = bb.max.y - bb.min.y, a = (bb.max.x - bb.min.x) * (bb.max.z - bb.min.z), y = (bb.min.y + bb.max.y) / 2;
        if (t < 0.02 && a > 0.5 && (y < 0.3 || y > 2.0)) sheets.push({ o, y, a, x0: bb.min.x, x1: bb.max.x, z0: bb.min.z, z1: bb.max.z, floor: y < 0.3 }); });
      const ov = (p, q) => p.x0 < q.x1 && q.x0 < p.x1 && p.z0 < q.z1 && q.z0 < p.z1 && p.floor === q.floor && Math.abs(p.y - q.y) < (p.floor ? 0.03 : 0.05);
      let moved = 0;
      // floors: the stacked floor sheets (continuous-marble-floor 0.035, d2_floor 0.046, the inlay borders and fields 0.047
      // to 0.053, ap_floor 0.051) keep their Cycles order but the gaps between their levels shrink to 1.5 mm, all lifted to
      // the top level. An 11 mm step along d2_floor's long diagonal edge drew a dark ambient occlusion line across the
      // floor in front of Matteo's (Ryan, B080/B075, Oct 13). The mapping is global per level, so the order can never
      // change between neighbouring cells (a per-sheet version lifted the plain floor over the inlays: m26).
      const lv = [...new Set(sheets.filter(q => q.floor).map(q => Math.round(q.y * 2000) / 2000))].sort((a, b) => a - b), newLv = new Map();
      for (let k = lv.length - 1; k >= 0;) { let e = k; while (e > 0 && lv[k] - lv[e - 1] < 0.03) e--;
        for (let m = k; m >= e; m--) newLv.set(lv[m], lv[k] - (k - m) * 0.0015); k = e - 1; }
      for (const s of sheets) { let r = 0; const L = Math.round(s.y * 2000) / 2000;
        for (const t of sheets) if (t !== s && t.a < s.a && ov(s, t) && (!s.floor || Math.round(t.y * 2000) / 2000 === L)) r++;
        // ceilings: at most 1.8 mm. The old 1.5 mm per rank lifted the big ceiling cells up to 9 mm, which uncovered the
        // brightest bottom millimetres of the emissive cove bands (rr_del_cove_wash starts 5 mm above the tray lip): the
        // thin white line along every coffer where the 360s show none (B075/B080 nx, Oct 13)
        const dy = s.floor ? (newLv.get(L) - s.y) - Math.min(r, 4) * 0.0003 : Math.min(r, 6) * 0.0003; if (Math.abs(dy) < 1e-5) continue;
        const wp = new THREE.Vector3(); s.o.getWorldPosition(wp); wp.y += dy; s.o.parent.worldToLocal(wp); s.o.position.copy(wp); s.o.updateMatrixWorld(true); moved++; }
      // flat sheets get one flat normal: several imported floors carry mixed vertex normals (d2_floor: all 23 faces point
      // down; continuous-marble-floor mixes up and down), and across a long triangle the interpolated normal swings
      // through the horizontal, so the light field shaded whole triangles darker (pale and grey triangular shards on the
      // floor at B009/B002 nz). Floors face up, ceilings face down, in each object's own space.
      let renormal = 0; const m3 = new THREE.Matrix3(), nl = new THREE.Vector3();
      // The normal must agree with each triangle's winding: three flips the normal of a back face, so a floor wound
      // downward (seen from above as a back face) needs a downward vertex normal to end up facing up after the flip
      // (forcing 'up' everywhere turned the mosaics into pure mirrors in m34 and m38).
      const pa = new THREE.Vector3(), pb = new THREE.Vector3(), pc = new THREE.Vector3();
      for (const s of sheets) { const g = s.o.geometry, na = g.attributes.normal, pos = g.attributes.position, idx = g.index; if (!na) continue;
        m3.setFromMatrix4(s.o.matrixWorld).transpose(); nl.set(0, 1, 0).applyMatrix3(m3).normalize();
        // a mirrored object (negative determinant) is drawn with the opposite front face, so its world winding reads reversed
        const dsg = s.o.matrixWorld.determinant() < 0 ? -1 : 1;
        const done = new Uint8Array(na.count), n = idx ? idx.count : pos.count;
        for (let t = 0; t < n; t += 3) { const a = idx ? idx.getX(t) : t, b = idx ? idx.getX(t + 1) : t + 1, c = idx ? idx.getX(t + 2) : t + 2;
          pa.fromBufferAttribute(pos, a).applyMatrix4(s.o.matrixWorld); pb.fromBufferAttribute(pos, b).applyMatrix4(s.o.matrixWorld); pc.fromBufferAttribute(pos, c).applyMatrix4(s.o.matrixWorld);
          const up = pb.sub(pa).cross(pc.sub(pa)).y >= 0, sg = (up ? 1 : -1) * dsg;
          for (const v of [a, b, c]) if (!done[v]) { done[v] = 1; na.setXYZ(v, nl.x * sg, nl.y * sg, nl.z * sg); } }
        na.needsUpdate = true; renormal++; }
      this.report.coplanarSheets = { sheets: sheets.length, moved, renormal }; }
    mark('pass coplanar');
    // Agent voltfix (Oct 14), two flags, both off by default. Ray casts from Ryan's Voltaire view (Blender 17.9 -9.4 1.6,
    // looking +y; gpu_test volt1 cube_VS_nz; that camera stands inside the MATTEOS_Front shell, between the bays and the
    // dark mt2_int walls, looking out at the back of the storefront) name leftovers of an older storefront line, which
    // ran straight along Blender y -7.3 while the mt2_* bays stand on a slanted line next to it:
    // RR_FLAGS.sillstrip = 1: the hard black parallelograms on the floor are flat sill strips of the merged mesh Mesh_1491
    // (Material_109.001, black metal, base 0.02), 12 cm wide, lying at z 0.045, 5 mm above continuous-marble-floor (z 0.035,
    // 0.0445 after the coplanar pass) and outside d2_floor, so nothing covers them (x 7 to 32, y -11 to 1, every flat
    // floor level face of that mesh lies there). Their up facing faces within RR_FLAGS.sillstripdy (default 0.012 m) of
    // z 0.045 are collapsed to zero area; the walls and frames of the mesh are kept. RR_FLAGS.sillstripre picks the material.
    // RR_FLAGS.oldpane = 1: the dark slab under the third bay is Mesh_1508 (Material_398, black transmissive), the old
    // lower pane, 2.6 m long at Blender y -7.06 to -7.10, z 0.23 to 1.09, standing beside the slanted mt2 frost pane (on the shop side of it)
    // there. Its faces whose centre lies in RR_FLAGS.oldpanebox (Blender x0,x1,y0,y1, default 16.5,19.4,-7.2,-7.0) go;
    // the rest of the mesh (x 5.7 to 16.5) is left as it is. The Cycles 360 B084 px may show that pane as a darker panel
    // (not confirmed), so this one is a taste call for Ryan, not a match fix.
    { const FV = globalThis.RR_FLAGS || {};
      // revB: the hits are collected on the shared geometry first and only a clone is edited (a geometry shared by another
      // mesh, or by the same original loaded in two areas, must not lose those triangles too)
      const dropTris = (o, test) => { const g0 = o.geometry, pos0 = g0.attributes.position; if (!pos0) return 0;
        const idx0 = g0.index, n = idx0 ? idx0.count : pos0.count, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), hit = [];
        for (let t = 0; t + 2 < n; t += 3) { const ia = idx0 ? idx0.getX(t) : t, ib = idx0 ? idx0.getX(t + 1) : t + 1, ic = idx0 ? idx0.getX(t + 2) : t + 2;
          a.fromBufferAttribute(pos0, ia).applyMatrix4(o.matrixWorld); b.fromBufferAttribute(pos0, ib).applyMatrix4(o.matrixWorld); c.fromBufferAttribute(pos0, ic).applyMatrix4(o.matrixWorld);
          if (test(a, b, c)) hit.push(t); }
        if (!hit.length) return 0;
        const g = g0.clone(), pos = g.attributes.position, idx = g.index;
        for (const t of hit) { const ia = idx ? idx.getX(t) : t, ib = idx ? idx.getX(t + 1) : t + 1, ic = idx ? idx.getX(t + 2) : t + 2;
          if (idx) { idx.setX(t + 1, ia); idx.setX(t + 2, ia); } else { pos.setXYZ(ib, pos.getX(ia), pos.getY(ia), pos.getZ(ia)); pos.setXYZ(ic, pos.getX(ia), pos.getY(ia), pos.getZ(ia)); } }
        g.computeBoundingSphere(); g.computeBoundingBox(); o.geometry = g;
        return hit.length; };
      if (+(FV.sillstrip ?? 0)) { const reM = new RegExp(FV.sillstripre || '^Material_109\\.001$'), reS = new RegExp(FV.sillstripobj || '^Mesh_1491$'), dy = +(FV.sillstripdy ?? 0.012), n3 = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
        let tris = 0; const objs = [];
        root.updateMatrixWorld(true);
        // merger review: Material_109.001 also sits on the moved copies sugmv_Mesh_1491 (mt20) and grpmv_Mesh_1491,
        // grpmv2_Mesh_1491 (mt2n), outside the Voltaire bays, so the object name is checked too (RR_FLAGS.sillstripobj)
        root.traverse(o => { if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material) || !reM.test(o.material.name || '') || !reS.test(o.userData.invName || o.name || '')) return;
          const k = dropTris(o, (a, b, c) => { if (Math.abs(a.y - 0.045) > dy || Math.abs(b.y - 0.045) > dy || Math.abs(c.y - 0.045) > dy) return false;
            n3.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a)); const l = n3.length(); return l > 0 && Math.abs(n3.y) > 0.99 * l; });
          if (k) { tris += k; if (objs.length < 20) objs.push(o.userData.invName || o.name); } });
        this.report.sillstrip = { tris, objs }; }
      if (+(FV.oldpane ?? 0)) { const reO = new RegExp(FV.oldpaneobj || '^Mesh_1508$'), bx = String(FV.oldpanebox || '16.5,19.4,-7.2,-7.0').split(',').map(Number);
        let tris = 0; const objs = [];
        root.updateMatrixWorld(true);
        root.traverse(o => { if (!o.isMesh || o.isInstancedMesh || !reO.test(o.userData.invName || o.name || '')) return;
          // three x is Blender x, three z is Blender -y
          const k = dropTris(o, (a, b, c) => { const x = (a.x + b.x + c.x) / 3, y = -(a.z + b.z + c.z) / 3; return x > bx[0] && x < bx[1] && y > bx[2] && y < bx[3]; });
          if (k) { tris += k; objs.push(o.userData.invName || o.name); } });
        this.report.oldpane = { tris, objs }; } }
    mark('pass voltfix');
    // RR_FLAGS.glassfix = 2 (glass agent 10): the rotunda panes and the Gjelina storefront panes share gjl_glass_clear but
    // only the rotunda wants the clear glass lift (rr2_reflect.js thinGlass). Before thinGlass patches the shared
    // material, the rotunda meshes (object or parent name matching RR_FLAGS.glassfixobj, default ^rot_) get one copy of it
    // per source material, made the way rr2_probes.js copies materials (graph onBeforeCompile and program key carried
    // over) and flagged userData.glassfixOn; thinGlass gives that copy its side aware program. Other flag values leave the
    // scene untouched.
    { const FX = globalThis.RR_FLAGS || {};
      if (+FX.glassfix === 2) {
        const reM = new RegExp(FX.glassfixre || '^gjl_glass_clear(\\.\\d+)?$'), reO = new RegExp(FX.glassfixobj || '^rot_(?!gC_)'), made = new Map(), objs = []; let n = 0;
        root.traverse(o => { if (!o.isMesh || Array.isArray(o.material) || !o.material.isMeshPhysicalMaterial || !reM.test(o.material.name || '')) return;
          // Agent glass12 (m94 audit): the default leaves out rot_gC_glass, the east arc (x -19.8 to -16.6, z 4.9 to 11).
          // Ray casts put the B001 nz side window regression there (58 to 69 against 30 to 32), and it is the arc the east
          // corridor spots see first; the gains at B001 nx, B005 nz and B006 nx run west of it (rot_gB_glass, by geometry).
          // glTF nodes are named by id (rot_gB_glass is n00912), so the Blender name comes from userData.invName, which
          // assignCaptureLighting (rr2_probes.js, the same byNode walk its idnmat object keys use) set on every mesh above;
          // the three names are still tested for meshes it did not reach. The matched names go to report.glassfix2.objs.
          const on = o.userData.invName || '', hit = reO.test(on) ? on : reO.test(o.name || '') ? o.name : (o.parent && !o.parent.isScene && reO.test(o.parent.name || '')) ? o.parent.name : '';
          if (!hit) return; if (objs.length < 40) objs.push(hit);
          const src = o.material; let m = made.get(src);
          if (!m) { const ud = src.userData; src.userData = {}; m = src.clone(); src.userData = ud; m.userData = { ...ud, glassfixOn: true };
            m.defines = { ...src.defines }; m.onBeforeCompile = src.onBeforeCompile; m.customProgramCacheKey = src.customProgramCacheKey; made.set(src, m); }
          o.material = m; n++; });
        this.report.glassfix2 = { mats: made.size, meshes: n, objs };
      } }
    mark('pass glassfix');
    // RR_FLAGS.lowglass = 1 (agent glassfix3): smooth normals on curved clear panes (smoothCurvedPane above), before
    // thinGlass and before mergeStatic (transparent panes are never merged, so the copy stays). lowglasscurve = 0 skips it.
    { const FL = globalThis.RR_FLAGS || {};
      if (+(FL.lowglass ?? 0) && +(FL.lowglasscurve ?? 1)) { const out = [];
        root.traverse(o => { if (!o.isMesh || Array.isArray(o.material) || !o.material.isMeshPhysicalMaterial || o.material.transmission < 0.5 || o.material.userData.blender?.res?.glassCut) return;
          if (PANE_PROP.test(o.material.name || '') || PANE_PROP.test(o.userData.invName || o.name || '')) return;
          const r = smoothCurvedPane(o); if (r && out.length < 60) out.push({ o: o.userData.invName || o.name, m: o.material.name, ...r }); });
        this.report.lowglassCurved = out; } }
    mark('pass lowglass');
    // unlit glTF cutouts (KHR_materials_unlit: poppy_texture, orchid_leaf, orchid_pod) are MeshBasicMaterial and skip the
    // loop below. GLTFLoader gave their BLEND alpha depthWrite false; once applyBlenderGraph turns them into opaque alpha
    // tested materials, the walls drawn after them paint over every pixel (the World Cafe poppy garland, 310 bk_poppy
    // objects in mt31c, mt32c, mt41c, never showed; Ryan, Oct 14). Same depth and coverage rule as the standard cutouts.
    root.traverse(o => { if (!o.isMesh || Array.isArray(o.material)) return; const m = o.material;
      if (!m || !m.isMeshBasicMaterial || m.transparent || !(m.alphaTest > 0)) return;
      if (!m.depthWrite) { m.depthWrite = true; const L = (this.report.unlitDepth ||= []); if (!L.includes(m.name)) L.push(m.name); }
      if (this.msaa > 0 && !m.alphaToCoverage) { m.alphaToCoverage = true; m.needsUpdate = true; } });
    mark('pass unlit');
    const seenM = new Set();
    root.traverse(o => { if (!o.isMesh || !o.material.isMeshStandardMaterial) return; const m = o.material;
      // tier without transmission: three's transmission pass (one more scene render into a mip chain) is skipped. thinGlass
      // runs first, on the glTF transmission, so clear and smoked panes keep their own blended pane path (it zeroes the
      // transmission itself); nofrostT is held for the call so reeded and frosted panes take that pane path too instead of
      // the refracting one. Whatever still has transmission after it (below thinGlass's 0.5 gate) becomes a plain blended
      // surface.
      const noTx = this.tier && !this.tier.transmission;
      if (noTx) { const FG = globalThis.RR_FLAGS || (globalThis.RR_FLAGS = {}), had = FG.nofrostT; FG.nofrostT = 1; try { thinGlass(m); } finally { if (had === undefined) delete FG.nofrostT; else FG.nofrostT = had; } }
      else thinGlass(m);
      if (noTx && m.transmission > 0) { const tr = m.transmission; m.transmission = 0; m.thickness = 0; m.transparent = true; m.opacity = Math.min(m.opacity, 1 - 0.7 * tr); m.depthWrite = false; m.needsUpdate = true; }
      // brushed metal: three's anisotropy needs tangents the export does not carry, so it reads as a dark smear; widen the lobe instead
      if (!seenM.has(m) && m.anisotropy > 0) { m.roughness = Math.min(1, m.roughness + 0.15 * m.anisotropy); m.anisotropy = 0; m.needsUpdate = true; }
      // cutout materials (Blender alpha hashed, here alpha tested) are opaque and must write depth, or later walls paint over them
      if (!m.transparent && m.alphaTest > 0 && !m.depthWrite) m.depthWrite = true;
      // with MSAA the cutout edge becomes coverage (three's ALPHA_TO_COVERAGE alphatest chunk: smoothstep over fwidth of
      // alpha) instead of a hard per pixel test; the stacked logo layers (gjl_logo0..6, rot_logo0..8) and textured
      // decals stop crawling. Without samples (floor mirror target) the discard threshold is unchanged.
      if (this.msaa > 0 && !m.transparent && m.alphaTest > 0 && !m.alphaToCoverage) { m.alphaToCoverage = true; m.needsUpdate = true; }
      // thin strokes of a minified cutout image keep their coverage instead of dropping below the 0.5 test (blender_material.js alphaCoverageGLSL)
      if (m.alphaToCoverage) mapAlphaCoverage(m);
      // glTF slot textures came from GLTFLoader with anisotropy 1: signs and floors seen at a glancing angle went to mush
      if (!seenM.has(m)) for (const k of ['map', 'emissiveMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap', 'bumpMap']) { const t = m[k];
        if (t?.isTexture && !t.isCompressedTexture && t.anisotropy < globalThis.RR_MAX_ANISO) { t.anisotropy = globalThis.RR_MAX_ANISO; if (t.version > 0) t.needsUpdate = true; } }
      seenM.add(m); });
    mark('pass material traverse');
    if (!this.lite && this.profile.floor !== false && !(this.tier && !this.tier.reflect)) { // phones skip the planar floor reflection (one extra scene render per frame); the capture reflection stays
      // mirror plane in the middle of the walking floors as the coplanar pass leaves them (it chains every floor level from
      // 0.005 to 0.074 into one group 1.5 mm apart: continuous-marble-floor ends at 0.053, d2_floor 0.0545, ap_floor
      // 0.059); the old 0.04 sat 1.5 to 2 cm under them. The oblique near plane also clips the floor faces of tall chunks
      // below it, which are no longer hidden (FloorReflector.collect)
      this.floor = new FloorReflector(this.renderer, { y: 0.056, scale: this.tier ? this.tier.reflect : (this.profile.floorScale ?? 0.5) });
      const bb = new THREE.Box3();
      // floor materials: any material on a large floor-level piece; then EVERY floor-level piece wearing one of those
      // materials gets the mirror too (small pieces of the same floor used to reflect differently: blotchy patches)
      // m58 picked a material when one low piece had a bounding box over 1 m2 in plan: a long baseboard or kick plate
      // qualified (cl_rw_whitepaint, rot_frame_satin, nw_black_lacquer, mt_steel, sug_door_bronze, cl_sug_brass), as did
      // the carpets and the Sugarcane emissive strip Material_108.004. Now a material needs 0.5 m2 of horizontal faces at
      // the mirror plane over all its low pieces, and materials that cannot show a reflection are left out: Blender
      // Roughness 0.6 and up with no coat (carpets, Material_0.002, Material_1.001, Material_108.004, cl_volt_matteblack,
      // nk_black: the shader's own gate, 1 - smoothstep(0.3, 0.6, roughness), is 0 there anyway). Only flat pieces are
      // mirror meshes (hidden while the mirror is drawn); upright low pieces keep drawing into it.
      const floorMats = new Set(); const low = [], flatA = new Map(), flatOf = new Map();
      const dull = (m) => { const g = this.blMats?.[m.name]?.graph?.nodes?.find(n => n.type === 'BSDF_PRINCIPLED')?.in;
        const r = g ? g.Roughness : m.roughness, cw = g ? (g['Coat Weight'] || 0) : (m.clearcoat || 0);
        return typeof r === 'number' && r >= 0.6 && !(cw > 0); };
      root.traverse(o => { if (!o.isMesh || o.isInstancedMesh || !o.material.isMeshStandardMaterial) return; bb.setFromObject(o);
        if (bb.max.y < 0.15 && bb.max.y - bb.min.y < 0.5) { low.push(o); const f = this.floor.flatShare(o); flatOf.set(o, f);
          flatA.set(o.material.name, (flatA.get(o.material.name) || 0) + f.flat); } });
      for (const o of low) if (flatA.get(o.material.name) > 0.5 && !dull(o.material)) floorMats.add(o.material.name);
      const legacy = (globalThis.RR_FLAGS || {}).floorlegacy;
      for (const o of low) { const f = flatOf.get(o);
        if (legacy ? ((bb.setFromObject(o), (bb.max.x - bb.min.x) * (bb.max.z - bb.min.z) > 1.0)) : floorMats.has(o.material.name)) {
          if (legacy || f.flat > 0.5 * f.total) this.floor.meshes.push(o); this.floor.patch(o.material); }
        // a flat piece in a left out material (a carpet, a mat) still lies at the mirror plane: hidden from the mirror as before
        else if (!legacy && f.flat > 0.05 && f.flat > 0.5 * f.total) this.floor.meshes.push(o); }
      // floorMirror: materials = floor materials (0.5 m2 of flat faces at the mirror plane, not dull; 56 in m54 to m58,
      // fewer since floor3: the m56 'mirror only on real floors' change is per pixel, rrGate in the shader, plus the hide list in
      // collect, not a smaller material set), meshes = floor-level pieces wearing them, hidden = pieces hidden while the
      // mirror is drawn (collect), shared = other meshes wearing a floor material (walls, frames, ceilings: they keep
      // drawing into the mirror and take the capture reflection, rrGate 0), names = the materials, to audit the set
      const fm = { materials: floorMats.size, meshes: this.floor.meshes.length };
      fm.hidden = this.floor.collect(root);
      { const hid = new Set(this.floor.meshes); let shared = 0; root.traverse(o => { if (o.isMesh && o.material?.userData?.floorReflect && !hid.has(o)) shared++; }); fm.shared = shared; }
      fm.names = [...floorMats].sort();
      fm.flatArea = Object.fromEntries([...flatA].filter(([n]) => floorMats.has(n)).map(([n, v]) => [n, +v.toFixed(2)]));
      fm.left = [...flatA].filter(([n, v]) => v > 0.05 && !floorMats.has(n)).map(([n, v]) => n + ':' + v.toFixed(2)).sort();
      this.report.floorMirror = fm;
      if (this.blLights && !(globalThis.RR_FLAGS || {}).noglint && this.profile.glints !== false) { this.floor.addLampGlints(this.scene, [...this.blLights.values()], (globalThis.RR_FLAGS || {}).glint ?? 1); this.report.lampGlints = this.floor.glints; }
    }
    mark('pass floor mirror');
    if (!(globalThis.RR_FLAGS || {}).nocove && this.profile.cove !== false) { const cv = this.cove = new CoveLights(this.profile.covePatches); const np = cv.collect(root, this.blMats || {}, (globalThis.RR_FLAGS || {}).cove ?? 6) + cv.addDownlights([...(this.blLights?.values() || [])], root);
      this.report.coveLights = { patches: np, constEmitters: cv.constEmitters || 0, downlights: cv.dls.length, lines: cv.report, receivers: cv.patchReceivers(root), outKinds: cv.outReport, sample: cv.patches.slice(0, 3).map(c => ({ p: c.p.toArray().map(v => +v.toFixed(2)), n: c.n.toArray().map(v => +v.toFixed(2)), flux: c.flux.toArray().map(v => +v.toFixed(3)) })) }; if (!np) this.cove = null; }
    mark('pass cove');
    // Sugarcane near field: the Material_108 strips and the vault light the ceiling slab Mesh_2230 right above them in
    // Cycles; baked per vertex at load (rr2_sugbake.js). Opt in with RR_FLAGS.sugbake (gain, 1 = Cycles strength) until A/B
    if ((globalThis.RR_FLAGS || {}).sugbake) { const rep = {}; bakeSugarcane(root, this.blMats || {}, { gain: +(globalThis.RR_FLAGS || {}).sugbake || 1, report: rep }); this.report.sugBake = rep; }
    // room interiors behind the storefronts: per room gain and tint by surface orientation (rr2_rooms.js); RR_FLAGS.norooms
    // turns it off, RR_FLAGS.roomcal replaces the calibration table, player.rooms.uOn.value = 0 switches it live for A/B
    if (!(globalThis.RR_FLAGS || {}).norooms) { const F = globalThis.RR_FLAGS || {}; this.rooms = new RoomLighting(F.roomcal ? { cal: F.roomcal } : {}); this.report.rooms = this.rooms.patchAll(root); }
    mark('pass rooms+sugbake');
    this.buildCollision();
    mark('pass collision');
    this.addFloorUnderlay();
    mark('pass underlay');
    // ceiling crack backing (rr2_cove.js addCrackBacking): before the merge, which then takes the copies with their sheets
    this.report.crackBacking = addCrackBacking(root);
    mark('pass crackBacking');
    // hook: rr2_modes tags units and ceilings before groups merge (after the crack backing, so its copies carry the same tags)
    if (this.beforeMerge) this.beforeMerge(this.root);
    mark('pass beforeMerge');
    // agent delmint Oct 22: Delmonico from Ryan's photos (rr2_delmint.js); before the lightmaps so the cream patch and the chair copies are baked like the rest; RR_FLAGS.delmint=0 turns it off
    try { this.report.delmint = delmint(this); mark('delmint'); } catch (e) { (this.report.errors ||= []).push('delmint: ' + e.message); }
    // main 03:4x (ship found it): lightmaps go on BEFORE mergeStatic, which folds meshes into nameless 'merged:<material>' meshes;
    // baked copies are cached per source material and atlas, so the merge key keeps baked with baked of the same atlas
    if (lmOn()) { try { this.lmData ||= await (this.lmPromise || loadLightmaps((globalThis.RR_FLAGS || {}).lmurl || 'data/lm/lm.json')); this.report.lightmap = applyLightmaps(this.root, this.lmData); mark('lightmaps applied'); } catch (e) { (this.report.errors ||= []).push('lightmap: ' + e.message); } }
    // RR_FLAGS.mergeCell (main, Oct 29): merge cell in metres; the Intel laptop is draw call bound (about 1800 calls, the pass
    // barely changes at half resolution), so larger cells mean fewer calls for the same pixels
    this.mergeStatic(+((globalThis.RR_FLAGS || {}).mergeCell ?? 8));
    mark('pass mergeStatic');
    // black glass (rr2_reflect.js thinGlass, glassLate) is drawn at the end of the opaque pass, after everything opaque it
    // covers, still blended as a pane: three's transmission target then holds it, so the reeded panes in front of it read
    // dark. Set after the merge and the cove receivers, which both skip transparent materials and must keep skipping it.
    this.root.traverse(o => { const m = o.material; if (!o.isMesh || !m || Array.isArray(m) || !m.userData?.glassLate) return;
      o.renderOrder = Math.max(o.renderOrder || 0, 2); if (m.transparent) { m.transparent = false; m.needsUpdate = true; } });
    mark('pass glassLate');
    // load time: materials whose programs differ only by the light field, cove receiver or floor mirror patch share one
    // program, the missing parts switched off by per material uniforms (rr2_probes.js unifyVariants); every material draws
    // exactly what it drew before. ?nounify=1 turns it off for an A/B.
    if (!(globalThis.RR_FLAGS || {}).nounify) this.report.unifiedVariants = unifyVariants(this.root, { cove: this.cove, floor: this.floor, rooms: this.rooms });
    // load time (RR_FLAGS.progcut = 1): Blender graphs whose programs differ only by the graph code share one program,
    // one branch per graph on a per material uniform (blender_material.js progcutMerge); RR_FLAGS.progcutCap sets the
    // largest group (default 8)
    // progcut 2 also merges alpha and unlit graphs, and groups without the light field, cove and mirror tags: a second
    // unifyVariants pass then gives every material of a merged program the union of those parts, switched off per material
    { const FP = globalThis.RR_FLAGS || {}; const pc2 = +FP.progcut >= 2 && !FP.nounify;
      if (+FP.progcut) this.report.progcut = progcutMerge(this.root, { cap: +(FP.progcutCap ?? 8), alpha: +FP.progcut >= 2, groupKey: pc2 ? (m) => variantGroupKey(m) : (m) => String(m.customProgramCacheKey()) + '#' + variantGroupKey(m) });
      if (pc2) this.report.unifiedVariants2 = unifyVariants(this.root, { cove: this.cove, floor: this.floor, rooms: this.rooms }); }
    // RR_FLAGS.panesingle (ship speed, side copy, default off): three draws a transparent DoubleSide material in two passes
    // (back faces, then front faces). For a flat pane only one side faces the camera, so the back pass draws nothing and costs
    // a draw call per pane (1311 of 1314 transparent materials are double sided). A material whose every mesh is flat (world
    // box thinner than 3 mm on its thinnest axis while at least 5 cm on the other two) gets forceSinglePass: same pixels.
    if (+((globalThis.RR_FLAGS || {}).panesingle || 0)) { const bb = new THREE.Box3(), sz = new THREE.Vector3(), byM = new Map();
      this.root.updateMatrixWorld(true);
      this.root.traverse(o => { if (!o.isMesh || Array.isArray(o.material) || !o.material.transparent || o.material.side !== THREE.DoubleSide) return;
        let flat = !o.isInstancedMesh; if (flat) { bb.setFromObject(o); bb.getSize(sz); const s = [sz.x, sz.y, sz.z].sort((a, b) => a - b); flat = s[0] < 0.003 && s[1] > 0.05; }
        const r = byM.get(o.material) || { flat: true, n: 0 }; r.flat = r.flat && flat; r.n++; byM.set(o.material, r); });
      let mats = 0, meshes = 0, kept = 0; for (const [m, r] of byM) { if (r.flat) { m.forceSinglePass = true; mats++; meshes += r.n; } else kept++; }
      this.report.panesingle = { materials: mats, meshes, keptTwoPass: kept }; }    mark('pass unify+progcut');
    if (this.floor) { this.floor.meshes = []; this.floor.collect(this.root); }
    mark('pass floor collect');
    // the Blender lamps themselves, nearest and strongest first, on top of the capture lighting
    if (this.lightFactor > 0) {
      // an explicit, small lamp set (Astra: start with the lights that shape the entrance, sconces and cove) keeps every
      // shader light; the full pool made each program heavy enough to stall the page
      let src = [...this.blLights.values()];
      if (this.lampNames) { const want = new Set(this.lampNames); src = src.filter(l => want.has(l.name)); }
      // RR_FLAGS.lampskipre (agent fixV, Oct 15, off unless set): leave lamps whose name matches out of the live pool. The
      // r7 plan build put the unit 166 interior lamps (mbf_l166_113 AREA 2.6 m, 140 W at 48.87, -9.95, 2.95, and 114, 115)
      // into a shell with no ceiling or fixture; the nearest one lights the red shell wall r166_f0 0.8 m away as a hard
      // pink rectangle (sweep rv08 12, W078y120p40, W087y120p40). Suggested value ^mbf_l166_ until unit 166 is built
      if ((globalThis.RR_FLAGS || {}).lampskipre) { const re = new RegExp(globalThis.RR_FLAGS.lampskipre); const n0 = src.length; src = src.filter(l => !re.test(l.name || '')); this.report.lampSkip = n0 - src.length; }
      const cnt = (t) => src.filter(l => l.type === t).length;
      const sizes = this.lampNames ? { spots: cnt('SPOT'), points: cnt('POINT'), areas: cnt('AREA') } : (this.profile.lamps || { spots: this.lite ? 4 : 12, points: this.lite ? 2 : 6, areas: this.lite ? 2 : 6 });
      // RR_FLAGS.lampVoid = 1 (opt in): leave out the lamps the cove step found over a ceiling (rr2_cove.js addDownlights);
      // the live lights cast no shadows, so a lamp in the void over a tray lights the room through it
      const skip = (globalThis.RR_FLAGS || {}).lampVoid && this.cove?.voidLamps?.size ? this.cove.voidLamps : null;
      if (skip) this.report.voidLamps = [...skip];
      this.lamps = new LightPool(this.scene, src, { ...sizes, factor: this.lightFactor, radius: this.lampNames ? 1e9 : 16, skip });
      this.report.lamps = { names: src.map(l => l.name), ...sizes };
    }
    // lamps seen through rough glass and Matteo's shaft lamps (rr2_lampcards.js, mtint agent): Cycles shows every lamp to
    // transmission rays, so the reeded transom at B075 pz sees mt_intL0's 3 x 3 m emitter and the two Point lamps under
    // the slab Mesh_2225. RR_FLAGS.lampcards = 1 (Matteo's five lamps) or a comma list of lamp names; RR_FLAGS.shaftlamps
    // = gain of the Point lamps' missing share on the shaft surfaces (1 = Cycles strength; the live pool already adds lights).
    { const F = globalThis.RR_FLAGS || {}; const all = [...(this.blLights?.values() || [])];
      const LC = F.lampcards ?? 1; // default ON since m72 (m71 A/B: Matteo panes B080 154 vs ref 153, B076 139 vs 140; only the panes change); lampcards=0 turns it off
      // 1 = Matteo's five, tx / gj / all / a comma list of rooms and lamps: rr2_lampcards.js LAMP_CARD_TABLE (cards2 agent)
      if (LC && LC !== '0') this.report.lampCards = addLampCardsSpec(this.scene, all, lampCardSpec(LC), { mirrorRT: this.floor?.rt || null });
      if (F.shaftlamps) this.report.shaftLamps = addShaftLamps(this.root, all, MATTEO_SHAFT, { gain: Math.max(0, +F.shaftlamps - (this.lightFactor || 0)) }); }
    mark('pass lights+lampcards');
    // MSAA: the samples go on the target the SCENE is drawn into: with AO that is N8AO's own beauty target (three r169
    // resolves colour and the depth texture N8AO reads with one blit); without AO the RenderPass draws into the composer targets
    const maxS = this.renderer.capabilities.maxSamples || 0; const ns = Math.min(this.msaa, maxS); this.report.msaaSamples = ns;
    const c = this.composer = new EffectComposer(this.renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: this.ao ? 0 : ns }));
    // contact shadows and corner darkening (what the flat capture lighting lacks): N8AO in place of the plain scene pass
    if (this.ao) {
      const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight;
      const ao = this.aoPass = new N8AOPass(this.scene, this.camera, w, h);
      // RR_FLAGS.aotransp = 0 (ship fps test): N8AO without its separate transparency pass (auto detected otherwise)
      if ((globalThis.RR_FLAGS || {}).aotransp !== undefined && !+globalThis.RR_FLAGS.aotransp) { ao.autoDetectTransparency = false; ao.configuration.transparencyAware = false; }
      const AF = globalThis.RR_FLAGS || {}; // aoRad, aoInt: A/B overrides (agent_lamps)
      Object.assign(ao.configuration, { aoRadius: AF.aoRad ?? 0.9, distanceFalloff: 0.6, intensity: AF.aoInt ?? 2.2, aoSamples: 16, denoiseSamples: 8, denoiseRadius: 8, halfRes: true, gammaCorrection: false, screenSpaceRadius: false, color: new THREE.Color(0, 0, 0) }, this.profile.aoConfig || {});
      if (ns > 0) { ao.beautyRenderTarget.samples = ns; ao.beautyRenderTarget.dispose(); }
      c.addPass(ao);
    } else c.addPass(new RenderPass(this.scene, this.camera));
    // one bad pixel (NaN or inf from a degenerate normal) would be smeared over the whole frame by the bloom blur
    c.addPass(new ShaderPass({ uniforms: { tDiffuse: { value: null } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main() { vec4 c = texture2D(tDiffuse, vUv); if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0); gl_FragColor = vec4(min(c.rgb, vec3(64.0)), c.a); }' }));
    // bloom: 'ref' is the reference bloom (display space, after the grade; see rr2_refbloom.js); 'unreal' is the older
    // linear UnrealBloom (strength 0.35, threshold 3), which the Cycles captures do not have; 'off' for none
    if (this.bloomMode === 'unreal' && this.profile.bloom !== false) c.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.5, 3.0));
    // 'ref+halo' (opt in, for an A/B run): the fixture halos of the Cycles 360s are in the linear EXR before any bloom (the
    // ceiling beside each downlight is lit by the lamp itself: spot lamps 2 to 3 cm under the ceiling, radius 6 cm, 175 deg
    // IES cone), which the live SpotLights (point sources, 60 deg cone) cannot produce. A weak linear UnrealBloom before the
    // grade stands in for that light; the ref bloom still runs after the grade. Strength from RR_FLAGS.halo (default 0.12;
    // m54/m55 used 0.35, which also hazed every emitter and hid a warm bias).
    if (this.bloomMode === 'ref+halo' && this.profile.bloom !== false) c.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), (globalThis.RR_FLAGS || {}).halo ?? 0.12, 0.5, 3.0));
    // white balance matched to the Cycles stills (measured on the Gjelina stop: ours ran slightly warm)
    this.wb = new ShaderPass({ uniforms: { tDiffuse: { value: null }, wb: { value: new THREE.Vector3(...this.wbVal) } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform sampler2D tDiffuse; uniform vec3 wb; varying vec2 vUv; void main() { vec4 c = texture2D(tDiffuse, vUv); gl_FragColor = vec4(c.rgb * wb, c.a); }' });
    c.addPass(this.wb);
    // exposureEV reaches the grade through its ev uniform (toneMappingExposure does nothing with NoToneMapping, so before
    // this the ev option was ignored in grade360 mode). Default +0.08 EV: m54 against the 34 reference 360s read 0.05 to
    // 0.11 EV dark (median per channel, all regions; L* -0.75) and +0.08 scored best of -0.08, 0, +0.08, +0.15 on dE2000
    // and on the L* histogram distance
    if (this.toneMap === 'grade360') { this.grade = new ShaderPass(GRADE360, 'tDiffuse'); this.grade.uniforms.ev.value = this.exposureEV; c.addPass(this.grade); } else c.addPass(new OutputPass());
    if ((this.bloomMode === 'ref' || this.bloomMode === 'ref+halo') && this.profile.bloom !== false) c.addPass(this.refBloom = new RefBloomPass(this.camera, { lite: this.lite }));
    if (this.profile.smaa !== false) c.addPass(new SMAAPass(1, 1)); this.resize();
    mark('pass composer');
    // compile every program before the first frame so walking never stutters on a new material
    this.onProgress('Compiling shaders', { phase: 'compile', done: 0, total: 1 });
    // every program is drawn into a linear half-float target (composer and floor mirror), which is a different shader
    // variant from drawing to the screen; warm up exactly that variant so nothing compiles while someone is looking around
    const prevRT = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.composer.renderTarget1);
    // upload every texture now (first-draw uploads of 2048 images caused second-long hitches while turning)
    const texs = new Set(); const addT = (v) => { if (v && v.isTexture && !v.isRenderTargetTexture) texs.add(v); };
    this.root.traverse(o => { if (!o.isMesh) return; for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
      for (const k in m) addT(m[k]); const u = m.userData?.blender?.uniforms; if (u) for (const k in u) addT(u[k].value); } });
    // RR_FLAGS.memlean bit 1 (rr2_assets.js): the fallback clones share their Source and need one upload of it too, so
    // they are made now; the textures of one Source upload one after another, and each bitmap is closed right after the
    // last upload it serves (memleanSeal), so decoded images are freed during this loop instead of living on
    const ML = +((globalThis.RR_FLAGS || {}).memlean || 0);
    let texList = [...texs];
    if (ML & 1) {
      this.root.traverse(o => { if (!o.isMesh) return; for (const m of (Array.isArray(o.material) ? o.material : [o.material])) if (m) { const b = baseTex(m); if (b) texs.add(b); } });
      const ord = new Map(); texList = [...texs].sort((a, b) => { const ka = ord.get(a.source) ?? (ord.set(a.source, ord.size), ord.size - 1), kb = ord.get(b.source) ?? (ord.set(b.source, ord.size), ord.size - 1); return ka - kb; });
      memleanSeal(texs);
    }
    // RR_FLAGS.memlean bit 2: CPU copies of vertex data. After the merge every load pass that reads normals, UVs or the
    // Blender coordinate attributes (floatfix, propfix, cove, sugbake, rooms, probes, signfix, fixObjectCoords, the
    // merge's flat normal fix) has run; after the view opens nothing reads them again. So each attribute except
    // position drops its array the moment three has copied it to the GPU (onUpload). Kept: position and the index
    // (picking, the bounding spheres of the cull list, the collision BVHs are built earlier from their own copies),
    // interleaved and dynamic attributes, instance matrices. A raycast against a mesh then still finds the hit point,
    // but the hit's uv and normal read as NaN (only gputest's pick and gapgrid modes look at them).
    if (ML & 2) { const seenG = new Set(), mg = this.memGeo = { attrs: 0, bytes: 0, released: 0, releasedBytes: 0, kept: 0, keptBytes: 0, skipped: 0 };
      this.root.traverse(o => { if (!o.isMesh || !o.geometry || seenG.has(o.geometry)) return; const g = o.geometry; seenG.add(g);
        if (g.index && g.index.array) { mg.kept++; mg.keptBytes += g.index.array.byteLength; }
        for (const [name, a] of Object.entries(g.attributes)) {
          if (!a || a.isInterleavedBufferAttribute || !a.array) { mg.skipped++; continue; }
          if (name === 'position' || a.usage !== THREE.StaticDrawUsage || a.isInstancedBufferAttribute) { mg.kept++; mg.keptBytes += a.array.byteLength; continue; }
          if (a.userData?.memleanHooked) continue; a.userData = a.userData || {}; a.userData.memleanHooked = true;
          const nb = a.array.byteLength; mg.attrs++; mg.bytes += nb;
          a.onUpload(function () { mg.released++; mg.releasedBytes += nb; this.array = new this.array.constructor(0); }); } }); }
    if (ML || (globalThis.RR_FLAGS || {}).memreport) { const self = this; const rep = () => self.memleanReport();
      Object.defineProperty(this.report, 'memleanFinal', { enumerable: true, configurable: true, get: rep });
      globalThis.__memlean = { get final() { return rep(); } }; }
    let ti = 0; for (const t of texList) { this.renderer.initTexture(t); if (ML & 1) memleanMark(t, this.renderer); if (++ti % 20 === 0) { this.onProgress(`Preparing textures ${ti}/${texs.size}`, { phase: 'textures', done: ti, total: texs.size }); await new Promise(r => setTimeout(r, 0)); } }
    this.report.textures = texs.size; mark('textures uploaded');
    if (ML & 1) { this.memTexs = texs; this.report.memlean = memleanAudit(this.renderer, texs); }
    // shaders: everything within 15 m of the start compiles before the view opens; the rest compiles in the background,
    // nearest first, and each object appears only once its shader is ready (no frozen frames while looking around)
    const start = this.walkCenter ? this.walkCenter.clone().setY(1.6) : this.camera.position.clone();
    // lightmaps (agent look, Oct 21; RR_FLAGS.lm = 1, RR_FLAGS.lmareas, rr2_lightmap.js): baked surfaces swap to base colour x
    // Cycles lightmap copies before the programs are listed, so the gate compiles the baked versions in their place
    if (lmOn() && this.lmData) for (const a of Object.values(this.lmData.areas)) this.renderer.initTexture(a.tex);   // main 03:4x: applied before the merge
    const byMat = new Map(); const bs = new THREE.Box3();
    this.root.traverse(o => { if (!o.isMesh) return; bs.setFromObject(o); const d = bs.distanceToPoint(start);
      const e = byMat.get(o.material) || { d: Infinity, meshes: [] }; e.d = Math.min(e.d, d); e.meshes.push(o); byMat.set(o.material, e); });
    // Shader programs. three's compile(scene) compiles every material in the scene, visible or not, and a cold D3D
    // compile of ~220 Blender programs takes 75 to 95 s on Ryan's laptop. So the view opens as soon as geometry and
    // textures are in, every object first drawn with a plain standard material (its own colour, texture and capture
    // lighting: a handful of programs), while the real Blender programs compile in the background, nearest first, on a
    // small proxy scene per batch; each object switches to its real material the moment its program is ready.
    const order = [...byMat.entries()].sort((a, b) => a[1].d - b[1].d).map(([m]) => m);
    // main 04:2x (ship, windowed Intel): baked [lm] copies compiling in the background stalled the walk (12 to 16 programs in 3 s); they are
    // light programs (no live lighting), so all of them compile before the view opens
    const isNear = (m) => byMat.get(m).d <= 15 || !!m.userData?.lmBaked && / \[lm\]$/.test(m.name || '');
    const near = order.filter(isNear), far = order.filter(m => !isNear(m));
    this.byMat = byMat; this.readyMats = null;
    this.report.materialsNear = near.length; this.report.materialsFar = far.length;
    if (this.deferCompile) { this.renderer.setRenderTarget(prevRT); this.prepareCulling(); mark('view ready (compile deferred)'); this.compiling = Promise.resolve(); this.onProgress(''); return; }
    const fbCache = new Map();
    const fallbackFor = (m) => {
      const glass = m.transmission > 0 || (m.transparent && !m.userData?.ssAlpha);
      const map = glass ? null : baseTex(m);
      const key = [map?.uuid, m.envMap?.uuid, m.color?.getHexString(), Math.round((m.roughness ?? 1) * 8), Math.round((m.metalness ?? 0) * 8), m.side, glass, m.alphaTest > 0, m.emissive?.getHexString(), m.emissiveMap?.uuid].join('|');
      let f = fbCache.get(key); if (f) return f;
      f = new THREE.MeshStandardMaterial({ color: m.color ? m.color.clone() : 0xcccccc, map, roughness: m.roughness ?? 1, metalness: m.metalness ?? 0, envMap: m.envMap || null, envMapIntensity: m.envMapIntensity ?? 1,
        side: m.side, transparent: glass, opacity: glass ? 0.3 : 1, depthWrite: !glass, alphaTest: m.alphaTest || 0, alphaToCoverage: !!m.alphaToCoverage, emissive: m.emissive ? m.emissive.clone() : 0x000000, emissiveMap: m.emissiveMap || null, emissiveIntensity: m.emissiveIntensity ?? 1 });
      f.name = 'fallback:' + m.name; f.userData.fallback = true; fbCache.set(key, f); return f;
    };
    // a proxy scene holding one object per (material, instanced or not): compile only that batch, with the real lights
    const proxyScene = new THREE.Scene();
    const compileBatch = (mats, matOf = (m) => m) => {
      proxyScene.clear(); const seen = new Set();
      for (const m of mats) for (const o of byMat.get(m).meshes) { const k = (o.isInstancedMesh ? 'i' : 'm') + (o.material.side); if (seen.has(m.uuid + k)) continue; seen.add(m.uuid + k);
        const px = o.isInstancedMesh ? new THREE.InstancedMesh(o.geometry, matOf(m), 1) : new THREE.Mesh(o.geometry, matOf(m)); px.matrixAutoUpdate = false; px.matrixWorld.copy(o.matrixWorld); px.frustumCulled = false; proxyScene.add(px); }
      const prev = this.renderer.getRenderTarget(); this.renderer.setRenderTarget(this.composer.renderTarget1);
      const p = this.renderer.compileAsync(proxyScene, this.camera, this.scene);   // programs are created synchronously here
      this.renderer.setRenderTarget(prev); this.renderer.getContext().flush();      // start the driver compile now (shader-perf)
      return p;
    };
    const withTimeout = (p, ms) => Promise.race([p.then(() => true, () => false), new Promise(r => setTimeout(() => r(false), ms))]);
    // Sequential compile (shader-perf finding on Ryan's laptop): one program at a time, linked synchronously, takes
    // ~9 s for all 219 programs; issuing them all at once (compileAsync on the scene, or batches in flight) took 75 to
    // 150 s on the same driver. So: compile in distance order, yielding to the page between programs, before the view
    // opens. If a slow device runs past the budget, the view opens on fallbacks and the same loop continues behind it.
    // Load agent (Oct 14), all opt in, defaults unchanged:
    //   RR_FLAGS.warm = 1: first view materials (inside the start camera frustum) go to the front of the order, the
    //     near set compiles in one compileAsync call (r169 polls KHR_parallel_shader_compile when the driver has it),
    //     the far set streams behind the open view. warm = 2 keeps the sequential compile and only reorders.
    //   RR_FLAGS.lowres = 1: open at once on the fallback materials at half the pixel ratio; the real programs stream
    //     in and the full pixel ratio comes back when the last one is ready.
    const FL = globalThis.RR_FLAGS || {};
    if (FL.warm) {
      // the frustum of the opening pose, not of the camera as it stands during load (still at the origin, not yet placed)
      const op = this.openPose, oc = this.camera.clone(); oc.fov = 60; oc.near = 0.05; oc.aspect = this.camera.aspect;
      if (op?.pos) oc.position.copy(B2T(op.pos)); else oc.position.copy(start);
      const oy = THREE.MathUtils.degToRad(op?.yaw ?? 0); oc.lookAt(oc.position.x - Math.sin(oy), oc.position.y, oc.position.z - Math.cos(oy));
      oc.updateProjectionMatrix(); oc.updateMatrixWorld(true);
      const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(oc.projectionMatrix, oc.matrixWorldInverse));
      const inView = new Set(); for (const [m, e] of byMat) if (e.meshes.some(o => fr.intersectsObject(o))) inView.add(m);
      order.sort((a, b) => (inView.has(b) - inView.has(a)) || (byMat.get(a).d - byMat.get(b).d));
      this.report.warm = { mode: +FL.warm, inView: inView.size, pose: { pos: oc.position.toArray().map(v => +v.toFixed(3)), yaw: +(op?.yaw ?? 0), from: op ? 'openPose' : 'walkCenter' }, khrParallel: !!this.renderer.extensions.get('KHR_parallel_shader_compile') };
      if (+FL.warm === 1) this.nearFirst = true;
    }
    // precedence, warm = 1 with lowres = 1: lowres wins. lowres opens at once on the fallbacks (budget 0, no near set),
    // so the parallel near set compile of warm = 1 cannot run; warm then only reorders (what warm = 2 does). Recorded in
    // report.warm.effective and report.warm.precedence instead of happening silently.
    if (FL.lowres && this.compileMode === 'sequential') { this.openBudgetS = 0; this.nearFirst = false;
      if (FL.warm) { this.report.warm.effective = +FL.warm === 1 ? 2 : +FL.warm; if (+FL.warm === 1) { this.report.warm.precedence = 'lowres over warm=1: warm=1 runs as warm=2 (reorder only)'; console.warn('[rr2] RR_FLAGS.lowres with warm=1: lowres wins, warm runs as warm=2 (reorder only)'); } } }
    else if (FL.warm) this.report.warm.effective = +FL.warm;
    // RR_FLAGS.linkpoll = 1 (link agent, Oct 14): in r169 compile() only starts each link; the wait on it happens at the
    //   first draw (getUniforms, onFirstUse), so every program used to resolve inside the warm frame. With the flag each
    //   compile is followed by a wait on that material's programs: isReady() (KHR_parallel_shader_compile, no block)
    //   polled with a yield, then getUniforms() to finish the link and the uniform reflection here, not in the frame.
    //   The post chain, the mirror glints and the floorblur pyramid compile the same way before the warm frame, and an
    //   object only switches from its fallback to its real material once that program is linked.
    const LP = !!+(FL.linkpoll || 0); const linked = new WeakSet(); const lpStat = { programs: 0, polls: 0, pollMs: 0, linkMs: 0 };
    const linkWait = async (mats) => { const R = this.renderer; if (!LP) return;
      for (const m of mats) { const pp = R.properties.get(m).programs; if (!pp) continue;
        for (const pg of pp.values()) { if (!pg || linked.has(pg)) continue; const a = performance.now();
          while (!pg.isReady()) { lpStat.polls++; await new Promise(res => setTimeout(res, 2)); }
          const b = performance.now(); const ce = R.debug.checkShaderErrors; R.debug.checkShaderErrors = true; pg.getUniforms(); R.debug.checkShaderErrors = ce;
          lpStat.linkMs += performance.now() - b; lpStat.pollMs += b - a; lpStat.programs++; linked.add(pg); } } };
    // post chain (AO, bloom, grade, SMAA: every material its passes hold, to the target each pass draws into) plus the
    // mirror only programs, compiled and linked before the warm frame
    const prewarmExtras = async () => { const R = this.renderer, T0 = performance.now(), mats = [], seen = new Set();
      const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), quad = new THREE.PlaneGeometry(2, 2), sc = new THREE.Scene(), prev = R.getRenderTarget();
      const grab = (v, d, out) => { if (!v || typeof v !== 'object' || seen.has(v)) return; seen.add(v);
        if (v.isMaterial) { out.push(v); return; } if (v.isMesh) return grab(v.material, d, out);
        if (v.isTexture || v.isWebGLRenderTarget || v.isRenderTarget || v.isBufferGeometry || v.isObject3D || v.isCamera || v.domElement || ArrayBuffer.isView(v) || v === R || d <= 0) return;
        for (const k of Object.keys(v)) { let x; try { x = v[k]; } catch (e) { continue; } grab(x, d - 1, out); } };
      let post = 0;
      // renderToScreen is only set inside composer.render(), so the last enabled pass is found here; its materials compile
      // for both the screen and a linear target (SMAA draws edges and weights into its own targets, the blend to the screen)
      const live = this.composer.passes.filter(ps => ps.enabled), lastPass = this.composer.renderToScreen ? live[live.length - 1] : null;
      for (const pass of live) {
        // N8AO rebuilds its AO, denoise and compositer materials inside its first render() once it sees the log depth
        // buffer; the same reconfigure runs here so the programs compiled are the ones the frame will use
        const cf = pass.configuration; if (cf && pass.configureAOPass && R.capabilities.logarithmicDepthBuffer !== cf.logarithmicDepthBuffer) { cf.logarithmicDepthBuffer = R.capabilities.logarithmicDepthBuffer;
          const ortho2 = !!pass.camera?.isOrthographicCamera; pass.configureAOPass(cf.logarithmicDepthBuffer, ortho2); pass.configureDenoisePass(cf.logarithmicDepthBuffer, ortho2); pass.configureEffectCompositer(cf.logarithmicDepthBuffer, ortho2); }
        const ms = []; grab(pass, 3, ms); if (!ms.length) continue; sc.clear();
        for (const m of ms) { const q = new THREE.Mesh(quad, m); q.frustumCulled = false; sc.add(q); }
        for (const tgt of (pass === lastPass ? [null, this.composer.renderTarget1] : [this.composer.renderTarget1])) {
          R.setRenderTarget(tgt); try { R.compile(sc, ortho); } catch (e) { (this.report.linkpollErr ||= []).push(String(e)); } }
        mats.push(...ms); post += ms.length; }
      R.setRenderTarget(prev);
      let mirror = 0; if (this.floor?.precompileExtras) { const ms = this.floor.precompileExtras(R, this.scene, this.camera); mats.push(...ms); mirror = ms.length; }
      await linkWait(mats); sc.clear(); quad.dispose();
      this.report.linkpollExtras = { postMaterials: post, mirrorMaterials: mirror, s: +((performance.now() - T0) / 1000).toFixed(2) }; };
    // the frame that opens the view, with the programs it still had to create listed (by cache key head and patch tags)
    const warmFrame = async () => { const R = this.renderer; if (LP) await prewarmExtras();
      const before = new Set(R.info.programs || []); const a = performance.now(); this.onProgress('Preparing the view', { phase: 'warm', done: 0, total: 1 }); this.step(0); this.render(); R.getContext().finish();
      this.report.warmFrameS = +((performance.now() - a) / 1000).toFixed(2); this.reportPrograms();
      try { const made = (R.info.programs || []).filter(pg => !before.has(pg)), owner = new Map(), by = {};
        const own = (m, tag) => { const pp = R.properties.get(m).programs; if (pp) for (const pg of pp.values()) if (pg && !owner.has(pg)) owner.set(pg, tag + (m.name || m.type)); };
        for (const m of [...byMat.keys(), ...fbCache.values()]) own(m, '');
        // gate agent: the composer passes and the FloorReflector (glints, blur pyramid, its own quads) own the rest
        if (this.composer) for (const ps of this.composer.passes) for (const m of grabMaterials(ps, 3, R)) own(m, 'post:' + (ps.constructor?.name || 'pass') + ':');
        if (this.floor) for (const m of grabMaterials(this.floor, 3, R)) own(m, 'mirror:');
        this.scene.traverse(o => { if (o.material) for (const m of (Array.isArray(o.material) ? o.material : [o.material])) own(m, 'scene:'); });
        for (const pg of made) { const k = String(pg.cacheKey || ''); const head = k.split(',').slice(0, 2).join(',').slice(0, 40) + (k.match(/\|[a-z][a-z0-9]{1,14}/g) || []).sort().join(''); by[head] = (by[head] || 0) + 1; }
        this.report.warmFramePrograms = { created: made.length, byKey: by, owners: made.slice(0, 80).map(pg => owner.get(pg) || ('?' + pg.name)) };
      } catch (e) { this.report.warmFramePrograms = { error: String(e) }; }
      if (LP) this.report.linkpoll = { ...lpStat, pollMs: Math.round(lpStat.pollMs), linkMs: Math.round(lpStat.linkMs), khr: !!R.extensions.get('KHR_parallel_shader_compile') }; };
    if (this.compileMode === 'sequential') {
      const r = this.renderer; const px = new THREE.Scene(); const T = performance.now(); let opened = false, lastYield = performance.now(), i = 0;
      // every variant the real frame will use: instanced or not, mirrored (negative determinant: flipSided) or not.
      const compileOne = (m) => { px.clear(); const seen = new Set();
        for (const o of byMat.get(m).meshes) { const k = (o.isInstancedMesh ? 'i' : 'm') + (o.matrixWorld.determinant() < 0 ? 'f' : ''); if (seen.has(k)) continue; seen.add(k);
          const q = o.isInstancedMesh ? new THREE.InstancedMesh(o.geometry, m, 1) : new THREE.Mesh(o.geometry, m); q.matrixAutoUpdate = false; q.matrixWorld.copy(o.matrixWorld); q.frustumCulled = false; q.renderOrder = o.renderOrder; px.add(q); }
        const prev = r.getRenderTarget(); r.setRenderTarget(this.composer.renderTarget1); r.debug.checkShaderErrors = true;
        this.compileLit(px); r.debug.checkShaderErrors = false; r.setRenderTarget(prev); };
      const fbOf = new Map();
      const openOnFallbacks = async () => { for (const m of order.slice(i)) { const f = fallbackFor(m); fbOf.set(m, f); }
        const fbs = [...new Set(fbOf.values())]; for (const f of fbs) { px.clear(); px.add(new THREE.Mesh(new THREE.BoxGeometry(), f)); const prev = r.getRenderTarget(); r.setRenderTarget(this.composer.renderTarget1); this.compileLit(px); r.setRenderTarget(prev); }
        if (LP) await linkWait(fbs);
        for (const [m, f] of fbOf) for (const o of byMat.get(m).meshes) o.material = f; opened = true; this.report.fallbackMaterials = fbs.length; mark('opened on fallbacks at program ' + i + '/' + order.length); };
      const loop = async () => {
        for (; i < order.length; i++) {
          const m = order[i]; compileOne(m); if (LP) await linkWait([m]);
          if (opened && fbOf.has(m)) for (const o of byMat.get(m).meshes) o.material = m;
          this.pendingMats = order.length - i - 1;
          if (performance.now() - lastYield > 40) { lastYield = performance.now(); if (!opened) this.onProgress(`Compiling shaders ${i + 1}/${order.length}`, { phase: 'compile', done: i + 1, total: order.length }); await new Promise(res => setTimeout(res, 0));
            if (!opened && (performance.now() - T) / 1000 > this.openBudgetS) { this.renderer.setRenderTarget(prevRT); await openOnFallbacks(); return 'open'; } }
        }
        return 'done';
      };
      // near first: only what lies within 15 m of the start compiles before the view opens; the rest compiles one
      // program at a time through the driver's async path (one in flight, so no parallel pile-up and no frozen page),
      // and each object is drawn from the moment its program is ready (readyMats gates the cull)
      // RR_FLAGS.lowres = 2 (gate agent, Oct 14), also RowPlayer.preload(): open at once on the fallbacks at half the
      // ratio, then the readiness gate (rr2_gate.js) issues the real programs in small batches and swaps each material
      // only when every program it holds reports linked; no compile is waited on and no real material draws unlinked
      if (+FL.lowres === 2 || this.gateMode) {
        i = 0; await openOnFallbacks(); this.report.compileS = +((performance.now() - T) / 1000).toFixed(2); this.report.programsAtOpen = r.info.programs.length;
        this.renderer.setRenderTarget(prevRT); this.prepareCulling();
        // gate2 agent: nearest to the opening view first (openPose when there is one, else the walk start), and inside
        // the opening frustum before outside it; RR_FLAGS.gateOrder = 0 keeps the load order
        if (+(FL.gateOrder ?? 1)) { const op = this.openPose, oc = this.camera.clone(); oc.fov = 60; oc.near = 0.05; oc.aspect = this.camera.aspect;
          if (op?.pos) oc.position.copy(B2T(op.pos)); else oc.position.copy(start);
          const oy = THREE.MathUtils.degToRad(op?.yaw ?? 0); oc.lookAt(oc.position.x - Math.sin(oy), oc.position.y, oc.position.z - Math.cos(oy)); oc.updateProjectionMatrix(); oc.updateMatrixWorld(true);
          const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(oc.projectionMatrix, oc.matrixWorldInverse)), bb = new THREE.Box3(), dv = new Map(), inV = new Set();
          for (const [m, e] of byMat) { let d = Infinity; for (const o of e.meshes) { bb.setFromObject(o); d = Math.min(d, bb.distanceToPoint(oc.position)); if (!inV.has(m) && fr.intersectsObject(o)) inV.add(m); } dv.set(m, d); }
          order.sort((a, b) => (inV.has(b) - inV.has(a)) || (dv.get(a) - dv.get(b))); this.report.gateOrder = { inView: inV.size, from: op?.pos ? 'openPose' : 'walkStart' }; }
        this.gateStream(order, (m) => { compileOne(m); r.getContext().flush(); }, (m) => { for (const o of byMat.get(m).meshes) o.material = m; }, mark);
        await warmFrame();
        mark('view ready (gate)'); this.report.assets = { ...assetStats, captures: this.caps.summary() }; this.onProgress(''); return;
      }
      if (this.nearFirst) {
        const nearSet = order.filter(m => byMat.get(m).d <= 15), farSet = order.filter(m => byMat.get(m).d > 15);
        if (+FL.warm === 1) { // all near programs in flight at once; the driver links them in parallel, one await
          px.clear(); const seen = new Set();
          for (const m of nearSet) for (const o of byMat.get(m).meshes) { const k = m.uuid + (o.isInstancedMesh ? 'i' : 'm') + (o.matrixWorld.determinant() < 0 ? 'f' : ''); if (seen.has(k)) continue; seen.add(k);
            const q = o.isInstancedMesh ? new THREE.InstancedMesh(o.geometry, m, 1) : new THREE.Mesh(o.geometry, m); q.matrixAutoUpdate = false; q.matrixWorld.copy(o.matrixWorld); q.frustumCulled = false; q.renderOrder = o.renderOrder; px.add(q); }
          this.onProgress(`Compiling shaders (${nearSet.length} in parallel)`, { phase: 'compile', done: 0, total: nearSet.length });
          const prev = r.getRenderTarget(); r.setRenderTarget(this.composer.renderTarget1); const pr = r.compileAsync(px, this.camera, this.scene); r.setRenderTarget(prev); r.getContext().flush();
          await withTimeout(pr, 1000 * Math.max(10, this.openBudgetS)); i = nearSet.length; if (LP) await linkWait(nearSet);
        }
        for (i = (+FL.warm === 1 ? nearSet.length : 0); i < nearSet.length; i++) { compileOne(nearSet[i]); if (LP) await linkWait([nearSet[i]]); if (performance.now() - lastYield > 40) { lastYield = performance.now(); this.onProgress(`Compiling shaders ${i + 1}/${nearSet.length}`, { phase: 'compile', done: i + 1, total: nearSet.length }); await new Promise(res => setTimeout(res, 0)); } }
        this.readyMats = new Set(nearSet); this.report.compileS = +((performance.now() - T) / 1000).toFixed(2); this.report.programsAtOpen = r.info.programs.length;
        this.report.materialsNear = nearSet.length; this.report.materialsFar = farSet.length; this.pendingMats = farSet.length;
        const asyncOne = (m) => { px.clear(); const seen = new Set();
          for (const o of byMat.get(m).meshes) { const k = (o.isInstancedMesh ? 'i' : 'm') + (o.matrixWorld.determinant() < 0 ? 'f' : ''); if (seen.has(k)) continue; seen.add(k);
            const q = o.isInstancedMesh ? new THREE.InstancedMesh(o.geometry, m, 1) : new THREE.Mesh(o.geometry, m); q.matrixAutoUpdate = false; q.matrixWorld.copy(o.matrixWorld); q.frustumCulled = false; px.add(q); }
          const prev = r.getRenderTarget(); r.setRenderTarget(this.composer.renderTarget1); const pr = r.compileAsync(px, this.camera, this.scene); r.setRenderTarget(prev); r.getContext().flush(); return pr; };
        this.compiling = (async () => { const T2 = performance.now();
          for (let k = 0; k < farSet.length; k++) { await asyncOne(farSet[k]); if (LP) await linkWait([farSet[k]]); this.readyMats.add(farSet[k]); this.pendingMats = farSet.length - k - 1; }
          this.report.compileFarS = +((performance.now() - T2) / 1000).toFixed(2); this.report.programsAll = r.info.programs.length; mark('all real materials'); })();
        this.renderer.setRenderTarget(prevRT); this.prepareCulling();
        await warmFrame();
        mark('view ready (near compiled)'); this.report.assets = { ...assetStats, captures: this.caps.summary() }; this.onProgress(''); return;
      }
      const first = await loop();
      this.report.compileS = +((performance.now() - T) / 1000).toFixed(2); this.report.programsAtOpen = r.info.programs.length;
      if (first === 'open') this.compiling = loop().then(() => { this.report.programsAll = r.info.programs.length;
        // safety net and probe (glass agent 3, Oct 14): any mesh still wearing a fallback once every program is compiled
        // goes back to its real material, and the count is reported (m56: Matteo's reeded panes and Milos' wine glass box
        // looked exactly like their fallbacks, a 0.3 opacity flat pane, at capture time)
        let left = 0; const names = new Set();
        for (const [m] of fbOf) for (const o of byMat.get(m).meshes) if (o.material?.userData?.fallback) { o.material = m; left++; names.add(m.name); }
        this.report.fallbackLeft = { meshes: left, materials: [...names].slice(0, 40) }; this.report.compileAllS = +((performance.now() - T) / 1000).toFixed(2); mark('all real materials'); });
      else { this.compiling = Promise.resolve(); this.report.programsAll = r.info.programs.length; mark('all real materials before open'); }
      this.renderer.setRenderTarget(prevRT); this.prepareCulling();
      // lowres: half the ratio through setDpr (renderer and composer together); the tier governor, if there is one, is held
      // off until the last program is ready and then takes the full ratio back itself (resume), so the two never fight
      if (FL.lowres && first === 'open') { const pr0 = r.getPixelRatio(); this.lowresActive = true; this.dprGov?.pause(); this.setDpr(pr0 * 0.5); this.report.lowres = { from: pr0, to: pr0 * 0.5 };
        this.compiling = this.compiling.then(() => { this.lowresActive = false; if (this.dprGov) this.dprGov.resume(pr0); else this.setDpr(pr0); this.report.lowres.restored = r.getPixelRatio(); mark('full resolution'); }); }
      // the post chain (AO, bloom, output, SMAA) and the floor mirror compile on their first use: run one full frame now
      await warmFrame();
      mark('view ready'); this.report.assets = { ...assetStats, captures: this.caps.summary() }; this.onProgress(''); return;
    }
    // 1. fallbacks: compiled before the first frame, then every object wears its fallback
    for (const m of order) byMat.get(m).fb = fallbackFor(m);
    await compileBatch(order, (m) => byMat.get(m).fb); if (LP) await linkWait([...new Set(order.map(m => byMat.get(m).fb))]);
    for (const m of order) for (const o of byMat.get(m).meshes) o.material = byMat.get(m).fb;
    this.report.fallbackMaterials = fbCache.size; this.report.programsAtOpen = this.renderer.info.programs.length;
    mark('fallbacks ready');
    // 2. real programs in the background, nearest first; swap as each batch is ready
    this.pendingMats = order.length;
    // up to 4 batches in flight (the driver compiles in parallel); a batch that is not ready in 25 s keeps its
    // fallback and is reported, so one stuck program can never hold the rest back
    const batches = []; for (let i = 0; i < order.length; i += 8) batches.push(order.slice(i, i + 8));
    this.report.stuck = []; let done = 0, bi = 0;
    const runOne = async () => {
      while (bi < batches.length) {
        const batch = batches[bi++]; const ok = await withTimeout(compileBatch(batch), 25000); if (ok && LP) await linkWait(batch);
        if (ok) { for (const m of batch) for (const o of byMat.get(m).meshes) o.material = m; }
        else this.report.stuck.push(...batch.map(m => m.name));
        done += batch.length; this.pendingMats = order.length - done;
        if (bi % 20 === 0 || this.pendingMats === 0) { mark('real materials ' + done + '/' + order.length + ' programs ' + this.renderer.info.programs.length + ' stuck ' + this.report.stuck.length); this.onProgress('', { sharp: done / order.length }); }
      }
    };
    this.compiling = Promise.all([runOne(), runOne(), runOne(), runOne()]).then(() => { this.report.programsAll = this.renderer.info.programs.length; mark('all real materials'); });
    this.renderer.setRenderTarget(prevRT);
    this.prepareCulling(); mark('view ready');
    this.report.assets = { ...assetStats, captures: this.caps.summary() };
    this.onProgress('');
  }
  // static collision: one BVH over walls, counters, columns and glass (everything taller than 0.4 m that is not floor or ceiling)
  buildCollision(center = this.walkCenter, radius = this.walkRadius) {
    const parts = []; const bb = new THREE.Box3(); const v = new THREE.Vector3();
    this.root.updateMatrixWorld(true);
    this.root.traverse(o => {
      if (!o.isMesh || o.isInstancedMesh) return; bb.setFromObject(o);
      const h = bb.max.y - bb.min.y; if (h < 0.4 || bb.min.y > 2.2) return;
      if (this.collisionFilter ? !this.collisionFilter(bb) : (center && bb.distanceToPoint(center) > radius)) return;   // only what can be reached on foot
      const g = o.geometry, p = g.attributes.position, idx = g.index;
      const n = idx ? idx.count : p.count; const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { v.fromBufferAttribute(p, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld); arr[i * 3] = v.x; arr[i * 3 + 1] = v.y; arr[i * 3 + 2] = v.z; }
      parts.push(arr);
    });
    const total = parts.reduce((a, b) => a + b.length, 0); const all = new Float32Array(total); let off = 0; for (const a of parts) { all.set(a, off); off += a.length; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(all, 3));
    g.computeBoundsTree(); this.collider = new THREE.Mesh(g, new THREE.MeshBasicMaterial()); this.collider.visible = false;
    // floor finder: everything below 0.3 m
    const fparts = []; this.root.traverse(o => { if (!o.isMesh || o.isInstancedMesh) return; bb.setFromObject(o); if (bb.max.y > 0.3) return; if (this.collisionFilter ? !this.collisionFilter(bb) : (center && bb.distanceToPoint(center) > radius)) return;
      const gg = o.geometry, p = gg.attributes.position, idx = gg.index; const n = idx ? idx.count : p.count; const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { v.fromBufferAttribute(p, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld); arr[i * 3] = v.x; arr[i * 3 + 1] = v.y; arr[i * 3 + 2] = v.z; } fparts.push(arr); });
    const ft = fparts.reduce((a, b) => a + b.length, 0); const fa = new Float32Array(ft); off = 0; for (const a of fparts) { fa.set(a, off); off += a.length; }
    const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.BufferAttribute(fa, 3)); fg.computeBoundsTree();
    this.floorCollider = new THREE.Mesh(fg, new THREE.MeshBasicMaterial());
    this.report.collisionTris = all.length / 9; this.report.floorTris = fa.length / 9;
  }
  setStop(bpos, yawDeg = 0) { this.mode = 'stop'; this.camera.position.copy(B2T(bpos)); this.yaw = THREE.MathUtils.degToRad(yawDeg); this.pitch = 0; this.camera.fov = 60; this.camera.updateProjectionMatrix(); }
  setFree() { this.mode = 'free'; }
  bindInput() {
    // one record per pointer: a left-half touch in free walk drives movement, any other pointer looks around; lifting
    // one finger only ends that finger's job
    const c = this.canvas; const ptrs = new Map();
    const endP = (id) => { const p = ptrs.get(id); if (!p) return; if (p.move) this.move.set(0, 0); ptrs.delete(id); };
    c.addEventListener('pointerdown', e => {
      c.setPointerCapture(e.pointerId); const r = c.getBoundingClientRect(); if (this.profile.keysNeedFocus) c.focus({ preventScroll: true });
      const moveRole = e.pointerType === 'touch' && this.mode === 'free' && (e.clientX - r.left) < r.width / 2 && ![...ptrs.values()].some(p => p.move);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, move: moveRole });
    });
    c.addEventListener('pointermove', e => {
      const p = ptrs.get(e.pointerId); if (!p) return;
      if (p.move) { this.move.set(THREE.MathUtils.clamp((e.clientX - p.x0) / 60, -1, 1), THREE.MathUtils.clamp(-(e.clientY - p.y0) / 60, -1, 1)); return; }
      const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
      this.yaw += dx * 0.004; this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.004, -1.2, 1.2);
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) c.addEventListener(ev, e => endP(e.pointerId));
    const endAll = () => { ptrs.clear(); this.move.set(0, 0); this.keys.clear(); };
    const on = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); this._listeners.push([t, ev, fn, o]); }; this.endInput = endAll;
    on(window, 'blur', endAll); on(document, 'visibilitychange', () => { if (document.hidden) endAll(); });
    // on a page the wheel scrolls the page; zoom needs ctrl or cmd (and trackpad pinch, which arrives as ctrl + wheel)
    c.addEventListener('wheel', e => { if (this.profile.wheelModifier && !e.ctrlKey && !e.metaKey) return; e.preventDefault(); this.camera.fov = THREE.MathUtils.clamp(this.camera.fov + e.deltaY * 0.03, 30, 75); this.camera.updateProjectionMatrix(); }, { passive: false });
    const KEYS = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);
    const typing = (e) => { const t = e.target; return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)); };
    // on a page, keys belong to the viewer only while its canvas has focus (a pointer press focuses it)
    const mine = () => !this.profile.keysNeedFocus || document.activeElement === c;
    on(window, 'keydown', e => { if (typing(e) || !this.inputEnabled || !mine()) return; const k = e.key.toLowerCase(); if (KEYS.has(k)) { this.keys.add(k); if (this.mode === 'free') e.preventDefault(); } });
    on(window, 'keyup', e => this.keys.delete(e.key.toLowerCase()));
  }
  step(dt) {
    if (this.modes && this.modes.step(dt)) return;   // hook: rr2_modes owns the camera during glides and in the top views
    const cam = this.camera;
    if (this.mode === 'free') {
      const k = this.keys; let f = this.move.y, s = this.move.x;
      if (k.has('w') || k.has('arrowup')) f += 1; if (k.has('s') || k.has('arrowdown')) f -= 1;
      if (k.has('d') || k.has('arrowright')) s += 1; if (k.has('a') || k.has('arrowleft')) s -= 1;
      const dir = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)), right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const want = dir.multiplyScalar(f).add(right.multiplyScalar(s)); if (want.lengthSq() > 1) want.normalize();
      this.vel.lerp(want.multiplyScalar(1.6), Math.min(1, dt * 8));
      let d = this.vel.clone().multiplyScalar(dt);
      if (d.lengthSq() > 1e-8) {
        // slide along walls: probe at knee and chest height with a 0.3 m body radius (no BVH collider: no wall slide,
        // the walk bounds below still hold the camera in the corridor)
        if (this.collider) for (const hgt of [-1.1, -0.4]) {
          const o = cam.position.clone(); o.y += hgt; const rc = new THREE.Raycaster(o, d.clone().normalize(), 0, d.length() + 0.3); rc.firstHitOnly = true;
          const hit = rc.intersectObject(this.collider)[0];
          if (hit) { const n = hit.face.normal.clone(); n.y = 0; if (n.lengthSq() > 0) { n.normalize(); if (n.dot(d) > 0) n.negate(); d.sub(n.multiplyScalar(d.dot(n))); } }
        }
        const prev = cam.position.clone(); cam.position.add(d);
        // stay inside the walkable corridor (rr2_modes polygon), else inside the loaded neighbourhood
        if (this.walkClamp) this.walkClamp(cam.position, prev);
        else if (this.walkCenter) { const dx = cam.position.x - this.walkCenter.x, dz = cam.position.z - this.walkCenter.z, L = Math.hypot(dx, dz), lim = this.walkRadius - 4;
          if (L > lim) { cam.position.x = this.walkCenter.x + dx * lim / L; cam.position.z = this.walkCenter.z + dz * lim / L; } }
      }
      if (this.floorCollider) { const rc = new THREE.Raycaster(cam.position.clone().setY(cam.position.y + 0.5), new THREE.Vector3(0, -1, 0), 0, 4); rc.firstHitOnly = true;
        const h = rc.intersectObject(this.floorCollider)[0]; if (h) cam.position.y += ((Math.max(h.point.y, 0.0) + 1.6) - cam.position.y) * Math.min(1, dt * 10); }
    }
    const look = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), -Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    cam.lookAt(cam.position.clone().add(look));
  }
  // The .blend has gaps in the floor (the medallion corners and seams between floor pieces; Cycles shows them as black
  // voids too). A continuous corridor-marble underlay 3 mm below the floor fills them in the browser without editing
  // the model. It uses the corridor's own Blender material.
  addFloorUnderlay(name = 'Material_0.006', radius = 60) {
    let src = null; this.root.traverse(o => { if (!src && o.isMesh && o.material && o.material.name === name) src = o; });
    if (!src || !this.walkCenter) { this.report.underlay = 'none'; return; }
    // a 1 m grid inside the radius, leaving out cells over geometry that lies below the walk floor (the stair landing and
    // lower hall at z -0.6 south of B009, re-exported in gjM2): a solid disc hid them as a flat tan block (B009/B002/B018 pz)
    const low = [], bb = new THREE.Box3(); this.root.updateMatrixWorld(true);
    this.root.traverse(o => { if (!o.isMesh || o.isInstancedMesh) return; bb.setFromObject(o); if (bb.max.y < -0.2 && (bb.max.x - bb.min.x) * (bb.max.z - bb.min.z) > 0.25) low.push(bb.clone()); });
    const cx0 = Math.floor(this.walkCenter.x - radius), cz0 = Math.floor(this.walkCenter.z - radius), verts = [];
    for (let i = 0; i < 2 * radius; i++) for (let j = 0; j < 2 * radius; j++) {
      const x = cx0 + i, z = cz0 + j; if (Math.hypot(x + 0.5 - this.walkCenter.x, z + 0.5 - this.walkCenter.z) > radius) continue;
      if (low.some(b => x + 1 > b.min.x && x < b.max.x && z + 1 > b.min.z && z < b.max.z)) continue;
      verts.push(x, -0.003, z, x, -0.003, z + 1, x + 1, -0.003, z, x + 1, -0.003, z, x, -0.003, z + 1, x + 1, -0.003, z + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(verts.length).map((_, k) => k % 3 === 1 ? 1 : 0), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(verts.length / 3 * 2), 2)); this.report.underlayHoles = low.length;
    const p = g.attributes.position, n = p.count, obj = new Float32Array(n * 3), gen = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const x = p.getX(i), z = p.getZ(i); obj[i * 3] = x; obj[i * 3 + 1] = -z; obj[i * 3 + 2] = -0.003;
      gen[i * 3] = (x - this.walkCenter.x + radius) / (2 * radius); gen[i * 3 + 1] = (-z + this.walkCenter.z + radius) / (2 * radius); gen[i * 3 + 2] = 0.5; }
    g.setAttribute('blObj', new THREE.BufferAttribute(obj, 3)); g.setAttribute('blGen', new THREE.BufferAttribute(gen, 3));
    g.setAttribute('blRand', new THREE.BufferAttribute(new Float32Array(n).fill(0.5), 1));
    const m = new THREE.Mesh(g, src.material); m.name = 'floor_underlay'; m.renderOrder = -1; this.root.add(m); this.report.underlay = name;
  }
  // program census for the load-time work: how many programs each patch combination costs (cache key suffixes)
  reportPrograms() {
    try { const progs = this.renderer.info.programs || []; const by = {}, shaders = {};
      for (const p of progs) { const k = String(p.cacheKey || ''); const tags = (k.match(/\|[a-z][a-z0-9]{1,14}/g) || []).sort().join('');
        by[tags] = (by[tags] || 0) + 1; const nm = (k.match(/^[A-Za-z]+/) || ['?'])[0]; shaders[nm] = (shaders[nm] || 0) + 1; }
      this.report.programCensus = { total: progs.length, byTags: by, byShader: shaders };
    } catch (e) { this.report.programCensus = { error: String(e) }; }
  }
  // draw-call reduction: opaque meshes that share a material are merged in world space per 8 m cell (thousands of
  // draws become a few hundred; every triangle is kept, nothing is simplified). Glass and instanced batches stay as they are.
  // RR_FLAGS.memlean: what the texture and geometry parts did so far (read by report.memleanFinal when the report is
  // posted); also counts the vertex and bitmap bytes the page still holds on the CPU
  memleanReport() {
    const ML = +((globalThis.RR_FLAGS || {}).memlean || 0); const out = { memlean: ML };
    const texs = new Set(); this.root?.traverse(o => { if (!o.isMesh) return; for (const m of (Array.isArray(o.material) ? o.material : [o.material])) { if (!m) continue;
      for (const k in m) { const v = m[k]; if (v && v.isTexture) texs.add(v); } const u = m.userData?.blender?.uniforms; if (u) for (const k in u) { const v = u[k].value; if (v && v.isTexture) texs.add(v); } } });
    if (this.memTexs) for (const t of this.memTexs) texs.add(t);
    if (ML & 1) out.tex = memleanAudit(this.renderer, texs);
    const srcs = new Set(); let bmpBytes = 0, bmpOpen = 0; for (const t of texs) { const d = t.source?.data; if (!d || srcs.has(t.source)) continue; srcs.add(t.source);
      if (typeof ImageBitmap !== 'undefined' && d instanceof ImageBitmap && d.width) { bmpOpen++; bmpBytes += d.width * d.height * 4; } }
    out.cpuBitmaps = { open: bmpOpen, MB: +(bmpBytes / 1048576).toFixed(1), textures: texs.size, sources: new Set([...texs].map(t => t.source)).size };
    const seenA = new Set(); let vb = 0; this.root?.traverse(o => { if (!o.isMesh || !o.geometry) return; const g = o.geometry;
      for (const a of [g.index, ...Object.values(g.attributes)]) { const arr = a && (a.isInterleavedBufferAttribute ? a.data.array : a.array); if (!arr || seenA.has(arr.buffer)) continue; seenA.add(arr.buffer); vb += arr.buffer.byteLength; } });
    // GL variants per image file: three makes one GL texture per (Source, wrap, filters, anisotropy, colour space, ...)
    const byUrl = new Map(); for (const t of texs) { const u = t.userData?.url; if (!u) continue; const k = [t.userData.memlean ? 'L' : '', t.source.uuid.slice(0, 4), t.wrapS, t.wrapT, t.magFilter, t.minFilter, t.anisotropy, t.colorSpace, t.generateMipmaps].join(',');
      if (!byUrl.has(u)) byUrl.set(u, new Set()); byUrl.get(u).add(k); }
    let glv = 0; const hist = {}; for (const ks of byUrl.values()) { glv += ks.size; hist[ks.size] = (hist[ks.size] || 0) + 1; }
    out.glVariants = { files: byUrl.size, glTextures: glv, hist, sample: [...byUrl.entries()].filter(([, k]) => k.size > 2).slice(0, 4).map(([u, k]) => [u.split('/').pop(), [...k]]) };
    out.cpuVertexMB = +(vb / 1048576).toFixed(1); if (this.memGeo) out.geo = { ...this.memGeo, MB: +(this.memGeo.bytes / 1048576).toFixed(1), releasedMB: +(this.memGeo.releasedBytes / 1048576).toFixed(1) };
    return out;
  }
  mergeStatic(cell = 8) {
    this.root.updateMatrixWorld(true);
    const groups = new Map(); const bb = new THREE.Box3(), c = new THREE.Vector3();
    this.root.traverse(o => {
      if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || Array.isArray(o.material) || o.material.transparent || o.morphTargetInfluences) return;
      const g = o.geometry; bb.setFromObject(o); bb.getCenter(c);
      const key = o.material.uuid + '|' + Object.keys(g.attributes).sort().join(',') + '|' + (g.index ? 1 : 0) + '|' + Math.floor(c.x / cell) + ',' + Math.floor(c.z / cell) + '|' + (o.renderOrder || 0) + '|' + (o.userData.rrKey || '');
      if (!groups.has(key)) groups.set(key, []); groups.get(key).push(o);
    });
    let before = 0, after = 0;
    for (const list of groups.values()) {
      before += list.length;
      if (list.length < 2) { after++;
        // a single mesh keeps its own geometry; skewed normals are fixed on a local copy the same way
        const o = list[0], F0 = globalThis.RR_FLAGS || {};
        if (!F0.noflatfix && o.geometry.attributes.normal && !o.isInstancedMesh) { const gw = toFloatGeometry(o.geometry); applyMatrixFast(gw, o.matrixWorld); if (o.matrixWorld.determinant() < 0) flipWinding(gw); const bs = badNormalShare(gw); gw.dispose(); if (bs > 0.1) { let g = toFloatGeometry(o.geometry); g = g.index ? g.toNonIndexed() : g; g.deleteAttribute('normal'); g.computeVertexNormals(); o.geometry = g; (this.report.flatNormals = this.report.flatNormals || []).length < 200 && this.report.flatNormals.push([o.userData.invName || o.name, +bs.toFixed(2), 's']); } }
        continue; }
      // meshopt-quantized exports store positions/normals/uvs as normalized Int16/Int8 in [-1,1] with the dequantize
      // scale in the node matrix; baking world space into those arrays clamps every vertex to +-1 (the merged group
      // collapses to a 2 m box at the origin). Expand every attribute to plain Float32 before baking.
      // mirrored objects (negative scale) are drawn by three with flipped face culling; once baked into world space that
      // flag is gone, so their triangle winding is reversed here or the outside faces are culled and the insides show
      const FN = globalThis.RR_FLAGS || {}; this.report.flatNormals = this.report.flatNormals || [];
      const geos = list.map(o => { let g = toFloatGeometry(o.geometry); applyMatrixFast(g, o.matrixWorld); if (o.matrixWorld.determinant() < 0) flipWinding(g); for (const k of Object.keys(g.morphAttributes)) delete g.morphAttributes[k];
        // more than 10 % of the triangles with skewed normals: use the faces' own normals (flat; RR_FLAGS.noflatfix keeps them)
        if (!FN.noflatfix && g.attributes.normal) { const bs = badNormalShare(g); if (bs > 0.1) { g = g.index ? g.toNonIndexed() : g; g.deleteAttribute('normal'); g.computeVertexNormals(); if (this.report.flatNormals.length < 200) this.report.flatNormals.push([o.userData.invName || o.name, +bs.toFixed(2)]); } }
        return g; });
      if (geos.some(g => g.index) && geos.some(g => !g.index)) for (let i = 0; i < geos.length; i++) if (geos[i].index) geos[i] = geos[i].toNonIndexed(); // flattened pieces are non indexed: the group must match
      const merged = mergeGeometries(geos, false); geos.forEach(g => g.dispose());
      if (!merged) { after += list.length; continue; }
      const m = new THREE.Mesh(merged, list[0].material); m.name = 'merged:' + list[0].material.name; m.frustumCulled = true;
      if (list[0].userData.rr) { m.userData.rr = list[0].userData.rr; m.userData.rrKey = list[0].userData.rrKey; }
      merged.computeBoundingSphere(); merged.computeBoundingBox();
      this.root.add(m); for (const o of list) o.parent && o.parent.remove(o); after++;
    }
    this.report.drawGroups = { before, after };
  }
  // screen-size culling: objects that would cover less than about a pixel are skipped (nothing is simplified; a cup on a
  // table 30 m away is simply not drawn). The floor mirror additionally skips small things more than 12 m off.
  // perf (Oct 16): renderer.compile(px, camera, this.scene) walks the whole scene (6000+ meshes) with traverseVisible on
  // every call only to collect its lights (three r169 compile), once per material the gate issues (2562 calls, 1.7 s of
  // main thread on the laptop). The render state stays this.scene's own; only its traverseVisible is replaced for the
  // call by one over the scene's lights, in scene order, each visited only when it and every parent up to the scene is
  // visible, which is what traverseVisible would hand to compile's light callback. The light list is taken again at most
  // once per animation frame (and every 50 ms), so lights added, removed or toggled between ticks are seen.
  // RR_FLAGS.perf = 0 keeps the plain call.
  compileLit(px) { const r = this.renderer, sc = this.scene;
    if (!PERF_ON()) { r.compile(px, this.camera, sc); return; }
    const now = performance.now(), fr = globalThis.__rrGate ? globalThis.__rrGate.stat.frames : -1, c = this._litCache;
    if (!c || c.fr !== fr || now - c.t > 50 || fr < 0) { const lights = []; sc.traverse(o => { if (o.isLight) lights.push(o); }); this._litCache = { fr, t: now, lights }; }
    const L = this._litCache.lights;
    sc.traverseVisible = function (cb) { for (const l of L) { let v = true; for (let o = l; o; o = o.parent) { if (o.visible === false) { v = false; break; } if (o === sc) break; } if (v && l.parent !== null) { let top = l; while (top.parent) top = top.parent; if (top === sc) cb(l); } } };
    if (PERF_CHECK()) { const mine = [], ref = []; sc.traverseVisible(o => mine.push(o)); THREE.Object3D.prototype.traverseVisible.call(sc, o => { if (o.isLight) ref.push(o); });
      const S = (globalThis.__perfcheck ||= {}), rr = (S.compileLights ||= { calls: 0, bad: 0 }); rr.calls++; if (mine.length !== ref.length || mine.some((o, i) => o !== ref[i])) rr.bad++; }
    try { r.compile(px, this.camera, sc); } finally { delete sc.traverseVisible; } }
  prepareCulling() {
    let vid = 0; this.root.traverse(o => { if (o.isMesh) o.userData.vid = vid++; }); this.vidCount = vid;
    this.cullList = []; const sph = new THREE.Sphere();
    this.root.updateMatrixWorld(true);
    this.root.traverse(o => { if (!o.isMesh || o.isInstancedMesh) return; if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      sph.copy(o.geometry.boundingSphere).applyMatrix4(o.matrixWorld); const g = o.geometry; this.cullList.push({ o, c: sph.center.clone(), r: Math.max(sph.radius, 1e-3), tris: (g.index ? g.index.count : g.attributes.position.count) / 3 }); });
  }
  cull(minPx, maxSmallDist = Infinity, maxDist = Infinity) {
    // RR_FLAGS.smallfar = metres (ship fps test, off by default): in the main pass, objects under 0.25 m radius farther than this are skipped
    if (maxSmallDist === Infinity && +((globalThis.RR_FLAGS || {}).smallfar || 0) > 0) { maxSmallDist = +globalThis.RR_FLAGS.smallfar; this._smallR = 0.25; } else this._smallR = 0.6;
    if (!this.cullList) return; const cam = this.camera.position;
    const k = (this.renderer.domElement.height / 2) / Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const ready = this.readyMats;
    const pvs = this.pvsActive;
    // RR_FLAGS.heavyTris / heavyFar (main, Oct 29): dense props (poppy walls, merged leather chairs, neon tubes: 150k to 1.3M
    // triangles each) are skipped beyond heavyFar m; at that distance they cover a few dozen pixels and cost most of the frame
    const F = globalThis.RR_FLAGS || {}, heavyT = +(F.heavyTris ?? 60000), heavyD = +(F.heavyFar ?? 22), los = this.los;
    const lodNear = +(F.lodNear ?? 5);
    for (const e of this.cullList) { const d = Math.max(0.1, e.c.distanceTo(cam) - e.r); if (e.lodIndex) PropLOD.pick(e, d, lodNear); e.o.visible = !e.o.userData.rrHide && (!pvs || pvs.has(e.o.userData.vid) || e.o.material.transparent) && (e.r / d) * k >= minPx && (e.r > this._smallR || d < maxSmallDist) && d < maxDist && (e.tris < heavyT || e.r > 6 || d < heavyD) && (!los || los.visible(e)) && (!ready || ready.has(e.o.material)); }
  }
  setPVS(zones) { this.pvsZones = zones.map(z => ({ c: z.c, r: z.r, ids: new Set(z.ids) })); this.pvsKey = null; }
  updatePVS() {
    if (!this.pvsZones) { this.pvsActive = null; return; }
    const x = this.camera.position.x, y = -this.camera.position.z; const inZ = this.pvsZones.filter(z => Math.hypot(x - z.c[0], y - z.c[1]) <= z.r + 2);
    const key = inZ.map(z => z.c.join(',')).join('|'); if (key === this.pvsKey) return; this.pvsKey = key;
    if (!inZ.length) { this.pvsActive = null; return; }       // outside every computed zone: draw everything
    const u = new Set(); for (const z of inZ) for (const i of z.ids) u.add(i); this.pvsActive = u;
  }
  // deterministic view state for captures (gputest cube, pick, shot): everything render() updates on a schedule or
  // lazily is brought up to date for the exact current camera, so the image depends only on the camera and the flags,
  // never on the frames rendered before it. Normal viewing keeps the throttles (render() alone).
  //   cove nearest sets (rr2_cove.js update, every 15th frame otherwise), the PVS zone set (cached by zone key), the live
  //   light pool (per frame already, recomputed here so a raycast pick sees the same state), and the screen size cull
  //   (object visibility, which a pick reads without rendering). The floor mirror, lamp glints, capture lighting, room
  //   gains and N8AO (accumulate off: frame stays 0) hold no history.
  prepareView() {
    const cam = this.camera; cam.updateMatrixWorld(); this.pvsKey = null; this.updatePVS();
    if (this.lamps) this.lamps.update(cam.position);
    if (this.cove) this.cove.update(cam.position, true);
    this.cull(0.75);
  }
  render() { this.camera.updateMatrixWorld(); this.updatePVS(); if (this.los) this.los.update(this.camera);
    // RR_FLAGS.mirrorfar (ship speed, side copy, default off): the floor mirror pass skips objects farther than this many metres
    if (this.floor) { this.cull(2.5, 12, +((globalThis.RR_FLAGS || {}).mirrorfar || 0) || Infinity); } if (this.lamps) this.lamps.update(this.camera.position); if (this.cove) this.cove.update(this.camera.position); if (this.floor && this.mirrorReady !== false && (!+((globalThis.RR_FLAGS || {}).mirrorhalf || 0) || ((this._mf = (this._mf || 0) + 1) % Math.max(1, +((globalThis.RR_FLAGS || {}).mirrorEvery || 2))) === 0 || this._settled)) this.floor.update(this.renderer, this.scene, this.camera); this.cull(+((globalThis.RR_FLAGS || {}).mainMinPx ?? 0.75));
    if (this.composer && this.postReady === false) this.cheapRender(); else this.composer ? this.composer.render() : this.renderer.render(this.scene, this.camera); }
  // gate agent: until the post chain programs report linked, draw the scene into the composer's first target (the
  // target every real program was compiled for, so no draw time compile) and copy it to the screen with one tiny
  // tone map plus sRGB shader; no AO, bloom, grade or SMAA in this state
  cheapRender() { const R = this.renderer, rt = this.composer.renderTarget1, prev = R.getRenderTarget();
    if (!this._cheap) { const m = new THREE.ShaderMaterial({ uniforms: { t: { value: null }, k: { value: 1 } }, depthTest: false, depthWrite: false, toneMapped: false,
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: 'uniform sampler2D t; uniform float k; varying vec2 vUv; void main() { vec3 c = texture2D(t, vUv).rgb * k; c = c / (1.0 + c); gl_FragColor = vec4(pow(c, vec3(1.0 / 2.2)), 1.0); }' });
      const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m); q.frustumCulled = false; this._cheap = { m, sc: new THREE.Scene().add(q), cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) }; }
    R.setRenderTarget(rt); R.render(this.scene, this.camera); this._cheap.m.uniforms.t.value = rt.texture; this._cheap.m.uniforms.k.value = Math.pow(2, this.exposureEV || 0);
    R.setRenderTarget(null); R.render(this._cheap.sc, this._cheap.cam); R.setRenderTarget(prev); }
  // gate agent: the post chain (every material each enabled pass holds, compiled for the target it draws into) and the
  // mirror only programs, issued with compileAsync and not waited on; returns { post, mirror } material lists
  precompilePost() { const R = this.renderer, prev = R.getRenderTarget(), post = [], ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), quad = new THREE.PlaneGeometry(2, 2);
    if (this.composer) { const live = this.composer.passes.filter(ps => ps.enabled), lastPass = this.composer.renderToScreen ? live[live.length - 1] : null;
      for (const pass of live) {
        const cf = pass.configuration; if (cf && pass.configureAOPass && R.capabilities.logarithmicDepthBuffer !== cf.logarithmicDepthBuffer) { cf.logarithmicDepthBuffer = R.capabilities.logarithmicDepthBuffer;
          const o2 = !!pass.camera?.isOrthographicCamera; pass.configureAOPass(cf.logarithmicDepthBuffer, o2); pass.configureDenoisePass(cf.logarithmicDepthBuffer, o2); pass.configureEffectCompositer(cf.logarithmicDepthBuffer, o2); }
        const ms = grabMaterials(pass, 3, R); if (!ms.length) continue; const sc = new THREE.Scene();
        for (const m of ms) { const q = new THREE.Mesh(quad, m); q.frustumCulled = false; sc.add(q); }
        for (const tgt of (pass === lastPass ? [null, this.composer.renderTarget1] : [this.composer.renderTarget1])) { R.setRenderTarget(tgt); R.compileAsync(sc, ortho).catch(() => {}); }
        post.push(...ms); } }
    R.setRenderTarget(prev); R.getContext().flush();
    const mirror = this.floor?.precompileExtras ? this.floor.precompileExtras(R, this.scene, this.camera) : [];
    return { post: [...new Set(post)], mirror: [...new Set(mirror)] }; }
  // gate agent: stream real materials behind an open view. issue(m) creates its programs, apply(m) swaps it in. Half
  // the pixel ratio until the last program links, then the full ratio back through the governor (resume) or setDpr.
  gateStream(order, issue, apply, mark = () => {}) { const r = this.renderer, FL = globalThis.RR_FLAGS || {};
    const pr0 = r.getPixelRatio(); this.lowresActive = true; this.dprGov?.pause(); this.setDpr(pr0 * 0.5);
    // gate2 agent: issue by time budget (RR_FLAGS.gateMs, default 8 ms of main thread per tick), up to gateF programs in
    // flight (default 64), polls up to gateN programs per tick (default 256); gateB caps materials issued per tick (off
    // by default). Materials with the same dedupe key wait behind the first one (gateDedupe = 0 turns that off);
    // gateUni = 0 leaves uniform reflection to the first draw, gateTex = 0 leaves texture prep to it.
    const keyOf = +(FL.gateDedupe ?? 1) ? (m) => { let k = m.type + '|' + (m.customProgramCacheKey ? String(m.customProgramCacheKey()) : '') + '|' + (m.transparent ? 't' : '') + m.side + (m.alphaTest > 0 ? 'a' : '') + (m.vertexColors ? 'v' : '') + (m.flatShading ? 'f' : '');
      if (!m.isShaderMaterial) for (const q of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap', 'lightMap', 'envMap', 'bumpMap']) k += m[q] ? q[0] + q.length : '';
      if (m.defines) k += JSON.stringify(m.defines); return k; } : null;
    const gate = this.gate = new ProgramGate(r, { perFrame: +FL.gateN || 256, gateMs: +(FL.gateMs ?? 8), issuePerFrame: +FL.gateB || Infinity, maxInFlight: +FL.gateF || 64,
      preUniforms: !!+(FL.gateUni ?? 1), preTextures: !!+(FL.gateTex ?? 1), keyOf,
      onSwap: (m, left) => { this.pendingMats = left; this.invalidate(); this.emit('progress', { phase: 'programs', done: gate.stat.swaps, total: gate.stat.total }); } });
    globalThis.__rrGate = gate;   // live handle for a run that times out: __rrGate.summary(), __rrGate.topFrames()
    const ex = this.precompilePost(); this.postReady = ex.post.length ? false : true; this.mirrorReady = ex.mirror.length ? false : true;
    let postLeft = ex.post.length, mirLeft = ex.mirror.length;
    for (const m of ex.post) gate.watch(m, () => { if (--postLeft === 0) { this.postReady = true; this.invalidate(); mark('post chain linked'); } });
    for (const m of ex.mirror) gate.watch(m, () => { if (--mirLeft === 0) { this.mirrorReady = true; this.invalidate(); } });
    for (const m of order) gate.add(m, issue, (mm) => apply(mm));
    gate.stat.total = gate.left; this.pendingMats = gate.left;
    this.report.lowres = { from: pr0, to: pr0 * 0.5, mode: 2 }; this.report.gate = gate.stat; this.report.gateExtras = { post: ex.post.length, mirror: ex.mirror.length };
    this.compiling = this.linked = gate.start().finished.then((st) => { this.pendingMats = 0; this.postReady = true; this.mirrorReady = true;
      this.report.programsAll = r.info.programs.length; mark('all programs linked');
      this.report.gate = { issued: st.issued, swaps: st.swaps, parked: st.parked, reused: st.reused, newPrograms: st.newPrograms, maxFrameMs: Math.round(st.maxFrameMs), maxTickMs: +st.maxTickMs.toFixed(1), checks: st.checks, linkReads: st.linkReads, frames: st.frames, khr: st.khr,
        uniMs: Math.round(st.uniMs), texMs: Math.round(st.texMs), texCount: st.texCount, opts: { gateMs: gate.gateMs, maxInFlight: gate.maxInFlight, perFrame: gate.perFrame, dedupe: !!keyOf, uni: gate.preUniforms, tex: gate.preTextures } };
      this.report.gateFrames = st.topFrames; this.report.gatePrograms = st.programs;
      this.lowresActive = false; if (this.dprGov) this.dprGov.resume(pr0); else this.setDpr(pr0); this.report.lowres.restored = r.getPixelRatio(); mark('full resolution'); this.invalidate(4); this.emit('ready', this.report.gate);
      // RR_FLAGS.occl (main, Oct 29): line of sight culling, built once after the open, off the first frames
      if (+((globalThis.RR_FLAGS || {}).occl || 0) && this.cullList && !this.los) setTimeout(() => { try { this.los = new LineOfSight(this.cullList); this.report.occl = this.los.stats; this.invalidate(2); } catch (e) { this.report.occlErr = String(e); }
        // RR_FLAGS.proplod (main, Oct 29): lighter copies of the dense props, simplified in a worker (rr2_lod.js)
        if (+((globalThis.RR_FLAGS || {}).proplod || 0) && !this.lod) { try { this.lod = new PropLOD(this.cullList, { invalidate: () => this.invalidate(2) }); this.report.lod = this.lod.stats; this.lod.run().catch(e => { this.report.lodErr = String(e); }); } catch (e) { this.report.lodErr = String(e); } } }, 1500); });
    return gate; }
  // map first loading (gate agent): load in the background on a canvas that is laid out but not shown (visibility
  // hidden, not display none, so it keeps a size). Starts at idle priority, compiles only through the gate, draws
  // nothing while hidden, and fires 'progress' and 'ready'. show() starts the visible render loop.
  on(type, fn) { (this._ev ||= new EventTarget()).addEventListener(type, (e) => fn(e.detail)); return this; }
  emit(type, d) { this._ev?.dispatchEvent(new CustomEvent(type, { detail: d })); }
  preload(areas, capsUrl, opts = {}) { if (this.preloading) return this.preloading; this.hidden = true; this.gateMode = true;
    const op = this.onProgress; this.onProgress = (t, d) => { op(t, d); if (d) this.emit('progress', d); };
    const idle = () => new Promise(res => (globalThis.requestIdleCallback ? requestIdleCallback(() => res(), { timeout: opts.idleTimeout ?? 2000 }) : setTimeout(res, 50)));
    return this.preloading = (async () => { await idle(); this.emit('progress', { phase: 'start' }); await this.load(areas, capsUrl, opts.extraLights ?? true, opts);
      this.emit('viewready', { gate: !!this.gate });   // ship speed (RR_FLAGS / data-rr-open=view): the view can open on the gate fallbacks
      if (!this.gate) this.emit('ready', null); await this.compiling; return this.report; })(); }
  // RR_FLAGS.smalltex (ship speed, side copy): swap the full size textures in behind the open view (rr2_assets.js)
  upgradeTextures(opts = {}) { if (this.upgrading) return this.upgrading; this.report.smallTex = smallStats;
    const o = { invalidate: () => this.invalidate(2), idle: () => performance.now() - (this._moveAt || 0) > 400, ...opts };
    return this.upgrading = (+((globalThis.RR_FLAGS || {}).texstream || 0) ? streamTextures(this.renderer, this.scene, this.camera, o) : upgradeSmallTextures(this.renderer, o)).then(s => { this.emit('fulltex', s); return s; }); }
  show() { this.hidden = false; this.resize(); this.invalidate(4); this.start(); }
  hide() { this.hidden = true; }
  // render loop. A frame whose camera and scene state match the last drawn one is skipped (a still view costs nothing on
  // a phone); invalidate() forces the next frames (resize, material swaps, a mode controller animating something else).
  // onFrame(dt) runs before each step (the mode controller); it returns true when it changed anything.
  // live pixel ratio, only with a tier (rr2_tier.js DprGovernor) or lowres: the composer keeps its own pixel ratio, so it
  // is set too, then resize() reallocates the targets
  setDpr(v) { this.renderer.setPixelRatio(v); this.composer?.setPixelRatio?.(v); this.resize(); this.report.dprLive = v; }
  start() {
    if (this.raf) return; this._lastDrawn = 0; if (this.tier && !this.dprGov) { this.dprGov = new DprGovernor(this.tier, { apply: (v) => this.setDpr(v) }); if (this.lowresActive) this.dprGov.pause(); } let t = performance.now(); const last = new Float32Array(20), cur = new Float32Array(20);
    const loop = () => { this.raf = requestAnimationFrame(loop); if (this.hidden) return; const n = performance.now(), dt = Math.min(0.05, (n - t) / 1000); t = n;
      const extra = this.onFrame ? this.onFrame(dt) : false; this.step(dt); const cam = this.camera; cam.updateMatrixWorld();
      cur.set(cam.matrixWorld.elements, 0); cur[16] = cam.fov; cur[17] = cam.aspect; cur[18] = this.pendingMats || 0; cur[19] = this.readyMats ? this.readyMats.size : 0;
      let same = !extra && this.invalid <= 0; if (same) for (let k = 0; k < 20; k++) if (cur[k] !== last[k]) { same = false; break; }
      // the cove patch set refreshes every 15th drawn frame; when the camera comes to rest, draw one more frame with a fresh
      // set so the still view never keeps the set picked up to 14 frames earlier (integration fix for the idle skip)
      if (same && this.cove && !this._settled) { this._settled = true; this.cove.frame = 0; same = false; }
      if (!same && cur.some((x, k) => x !== last[k])) { this._settled = false; this._moveAt = n; }
      if (same && !this.alwaysRender) { this.skipped = (this.skipped || 0) + 1; this._lastDrawn = 0; return; }
      last.set(cur); if (this.invalid > 0) this.invalid--; const a = performance.now(), np = this.gate && !this.gate.done ? this.renderer.info.programs.length : 0; this.render(); this.lastFrameMs = performance.now() - a;
      if (this.gate && !this.gate.done) this.gate.noteRender(this.lastFrameMs, this.renderer.info.programs.length - np);
      // governor: the rAF interval, fed only when the previous rAF also drew (an idle skip clears _lastDrawn above), so
      // the gap after a still period, which is idle time and not render time, never reaches it
      if (this.dprGov) { if (this._lastDrawn) this.dprGov.frame(n - this._lastDrawn); this._lastDrawn = n; } this.frames = (this.frames || 0) + 1; if (this.onRendered) this.onRendered(dt, this.lastFrameMs); };
    this.raf = requestAnimationFrame(loop);
  }
  stop() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; if (this.endInput) this.endInput(); }
  invalidate(frames = 2) { this.invalid = Math.max(this.invalid || 0, frames); }
  // free everything this player made on the GPU and every listener it added (the page stays; a new player can follow)
  dispose() {
    this.stop(); this.disposed = true; if (this._ro) this._ro.disconnect();
    for (const [t, ev, fn, o] of this._listeners) t.removeEventListener(ev, fn, o); this._listeners = [];
    const seen = new Set(); const free = (x) => { if (x && !seen.has(x) && typeof x.dispose === 'function') { seen.add(x); try { x.dispose(); } catch (e) {} } };
    this.scene.traverse(o => { free(o.geometry); for (const m of (Array.isArray(o.material) ? o.material : [o.material])) { if (!m) continue;
      for (const k in m) if (m[k] && m[k].isTexture) free(m[k]); const u = m.userData?.blender?.uniforms; if (u) for (const k in u) if (u[k].value && u[k].value.isTexture) free(u[k].value); free(m); } });
    for (const g of [this.collider?.geometry, this.floorCollider?.geometry]) free(g);
    if (this.floor) free(this.floor.rt); if (this.composer) { for (const p of this.composer.passes) free(p); free(this.composer.renderTarget1); free(this.composer.renderTarget2); }
    if (this.caps) { for (const e of this.caps.live.values()) free(e.tex); this.caps.idle.clear(); if (this.caps.pm) free(this.caps.pm); }
    try { this.ktx2.dispose(); } catch (e) {}
    this.renderer.dispose(); this.renderer.forceContextLoss();
  }
}
