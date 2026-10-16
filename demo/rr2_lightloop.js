// lightloop (RR_FLAGS.lightloop = 1, load time A/B, agent loops Oct 14). rollLightLoops (rr2_player.js) already writes
// the point and spot light loops of three's lights_fragment_begin as plain loops, but their bound is the constant
// NUM_POINT_LIGHTS / NUM_SPOT_LIGHTS, and D3D's shader compiler (FXC, behind ANGLE on Ryan's laptop) unrolls a loop
// with a constant trip count on its own, so every lit program still compiles 6 + 12 inlined copies of the BRDF; the
// rect area loop is unrolled by three's #pragma itself (6 more copies, with the LTC texture reads).
// This rewrites the chunk once, before the first program is built, so the three loops run to NUM_x_LIGHTS + rrLoopZero.
// rrLoopZero is a uniform int that nothing ever sets: GL initialises every uniform to 0 when the program links, so the
// trip count is the same, but the compiler cannot see it and keeps one copy of the body ([loop]).
// The loop bodies need no constant index: without shadow maps and spot light maps (this viewer has neither; programs
// that have them keep three's unrolled original through the #if) they read pointLights[i], spotLights[i] and
// rectAreaLights[i], uniform arrays that GLSL ES 3.00 indexes dynamically. Directional, hemisphere and light probe code
// is untouched (the scene has none of the first two; the probe is not in a loop).
// The rect area light BRDF (lights_physical_pars_fragment) reads ltc_1 and ltc_2 with texture2D, an implicit gradient
// read that D3D refuses inside a loop it cannot unroll; the chunk reads them with textureLod at level 0 when the flag is
// on. The tables have no mipmaps (RectAreaLightTexturesLib r169: 64 x 64 DataTexture, magFilter Linear, minFilter
// Nearest), so level 0 is the magnification case: bilinear, which is what texture2D gives wherever the lookup coordinate
// moves less than one texel per pixel (nearly everywhere: it follows roughness and the view angle). Where it moves faster
// (grazing silhouettes, a noisy roughness map) texture2D fell to the Nearest minFilter and textureLod keeps bilinear, so
// those few pixels can differ slightly. Everything else is the same arithmetic in the same order, so the result should
// match the unrolled program up to the compiler's float reordering.
// The cove, room, floor and glass patches all anchor on '#include <lights_fragment_begin>' or other includes (they
// insert before or after it); none edits text inside the loops, and the include is resolved after onBeforeCompile, so
// they all see this version. MeshLambert and MeshPhong programs use the same chunk and get the same loops; MeshBasic
// has no lights.
import * as THREE from 'three';
export function dynamicLightLoops() {
  const C = THREE.ShaderChunk; if (C.__rrDynLoops) return C.__rrDynLoops;
  let src = C.lights_fragment_begin; const notes = [];
  // point and spot: the rolled loops rollLightLoops wrote (only in its #else branch, so shadowed programs are untouched)
  for (const N of ['NUM_POINT_LIGHTS', 'NUM_SPOT_LIGHTS']) {
    const plain = `for ( int i = 0; i < ${N}; i ++ ) {`, at = src.lastIndexOf('\n\t' + plain + '\n');
    if (at < 0 || src.slice(0, at).endsWith('#pragma unroll_loop_start')) { notes.push(N + ' rolled loop not found'); continue; }
    src = src.slice(0, at) + `\n\tfor ( int i = 0; i < ${N} + rrLoopZero; i ++ ) {\n` + src.slice(at + plain.length + 3); notes.push(N);
  }
  // rect area: three's unrolled loop, rewritten without the pragma (no shadow or map index inside)
  // (matched on tokens, not whitespace: the r169 build that the page loads has its chunks without comments and blank lines)
  const ra = /#pragma unroll_loop_start\s*for \( int i = 0; i < NUM_RECT_AREA_LIGHTS; i \+\+ \) \{\s*rectAreaLight = rectAreaLights\[ i \];\s*(RE_Direct_RectArea\( rectAreaLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight \);)\s*\}\s*#pragma unroll_loop_end/;
  if (ra.test(src)) { src = src.replace(ra, (m, call) => `for ( int i = 0; i < NUM_RECT_AREA_LIGHTS + rrLoopZero; i ++ ) {
		rectAreaLight = rectAreaLights[ i ];
		${call}
	}`); notes.push('NUM_RECT_AREA_LIGHTS'); } else notes.push('rect area loop not found');
  let pp = C.lights_physical_pars_fragment; const ltc = ['texture2D( ltc_1, uv )', 'texture2D( ltc_2, uv )'];
  if (ltc.every(t => pp.includes(t))) { pp = pp.split('texture2D( ltc_1, uv )').join('textureLod( ltc_1, uv, 0.0 )').split('texture2D( ltc_2, uv )').join('textureLod( ltc_2, uv, 0.0 )'); notes.push('ltc textureLod'); }
  else notes.push('ltc reads not found');
  const decl = 'uniform bool receiveShadow;';
  if (!C.lights_pars_begin.includes(decl)) return (C.__rrDynLoops = 'lights_pars_begin not recognised, left as is');
  C.lights_pars_begin = C.lights_pars_begin.replace(decl, decl + '\nuniform int rrLoopZero; // never set: 0 (see rr2_lightloop.js)');
  C.lights_fragment_begin = src; C.lights_physical_pars_fragment = pp;
  return (C.__rrDynLoops = notes.join(', '));
}
