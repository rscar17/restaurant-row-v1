// Box-projected reflections (the 0beqz / Drei useBoxProjectedEnv technique, ported to vanilla r169) and a cheap
// physically plausible treatment for thin architectural glass. The environment cube is a Cycles capture, so the
// reflected room is the real render; box projection makes it line up with the walls instead of floating at infinity.
import * as THREE from 'three';
import { BL_A2C } from './blender_material.js';

export function makeBox(posThree, minThree, maxThree) {
  return { pos: { value: new THREE.Vector3(...posThree) }, min: { value: new THREE.Vector3(...minThree) }, max: { value: new THREE.Vector3(...maxThree) } };
}

// the outside the box reflection fade: ceilfix bit 4 (agent ceilfix) and interfix (agent interfix) asked for the same
// thing, so either flag turns on the one shader path in boxProject below
export const boxFadeOn = () => { const F = globalThis.RR_FLAGS || {}; return !!(((F.ceilfix === true ? 15 : +F.ceilfix || 0) & 4) || F.interfix); };
export function addBoxProjection(material, box) {
  if (material.userData.boxProjected) return;
  material.userData.boxProjected = true; material.userData.box = box;
  const prev = material.onBeforeCompile; const prevKey = material.customProgramCacheKey;
  material.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(material, sh, r);
    const CF4 = boxFadeOn();
    sh.uniforms.envBoxPos = box.pos; sh.uniforms.envBoxMin = box.min; sh.uniforms.envBoxMax = box.max;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBoxWP;')
      .replace('#include <fog_vertex>', `#include <fog_vertex>
  #ifdef USE_INSTANCING
  vBoxWP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
  #else
  vBoxWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
  #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vBoxWP; uniform vec3 envBoxPos; uniform vec3 envBoxMin; uniform vec3 envBoxMax;
vec3 boxProject(vec3 v) {
  vec3 d = normalize(v);
  vec3 rbmax = (envBoxMax - vBoxWP) / d, rbmin = (envBoxMin - vBoxWP) / d;
  vec3 rb = vec3(d.x > 0.0 ? rbmax.x : rbmin.x, d.y > 0.0 ? rbmax.y : rbmin.y, d.z > 0.0 ? rbmax.z : rbmin.z);
  float t = min(min(rb.x, rb.y), rb.z);
  ${CF4 ? `// box fade (ceilfix bit 4 or interfix, one shared path so the two never stack): a fragment outside the capture
  // box (far ceilings past 8 m of their capture, everything east of x 6 lit by B084 or B085 from 20 to 53 m away) has
  // negative or mixed box distances, so the corrected direction pointed at an arbitrary texel of the capture (random
  // ceiling patches, blue streaks on the nw_black_lacquer rails). Fade to the plain direction over the first metre
  // outside the box walls in plan; a hit behind the fragment (t not positive) takes the plain direction at once
  vec3 bo = max(envBoxMin - vBoxWP, vBoxWP - envBoxMax); float od = max(bo.x, bo.z);
  if (t <= 0.0) return d;
  return normalize(mix(normalize((vBoxWP + d * t) - envBoxPos), d, smoothstep(0.0, 1.0, od)));` : 'return (vBoxWP + d * t) - envBoxPos;'}
}`)
      .replace('reflectVec = inverseTransformDirection( reflectVec, viewMatrix );', 'reflectVec = inverseTransformDirection( reflectVec, viewMatrix );\n\t\treflectVec = boxProject( reflectVec );')
      // RR_FLAGS.boxdesat = k (agent vmisc, Oct 15, off unless set; sweep rv07 13 / rv08: blue fringe on the nw_black_lacquer
      // panel joints and rails by the circle, x 31 to 35): a fragment outside its capture box (the lacquer wall is lit from
      // B084 / B085, 20 to 53 m away) reflects the capture in the plain direction, i.e. whatever that far 360 saw that way:
      // the bottom faces of the rails and joints take the blue inlay of the circle floor, which Cycles never shows there
      // (it reflects the dark wall foot). The direction is wrong anyway, so its colour is the visible error: outside the
      // box the specular IBL fades to its own luminance (k times smoothstep 0..RR_FLAGS.boxdesatd m, default 2), the
      // brightness stays. Materials whose name matches RR_FLAGS.boxdesatre (default every box projected one).
      .replace('#include <lights_fragment_maps>', (+((globalThis.RR_FLAGS || {}).boxdesat ?? 0) > 0 && new RegExp((globalThis.RR_FLAGS || {}).boxdesatre || '.').test(material.name || '')) ? `#include <lights_fragment_maps>
  #if defined( RE_IndirectSpecular )
  {
    vec3 rrBo = max(envBoxMin - vBoxWP, vBoxWP - envBoxMax); float rrOd = max(rrBo.x, rrBo.z);
    float rrDs = ${(+globalThis.RR_FLAGS.boxdesat).toFixed(3)} * smoothstep(0.0, ${(+(globalThis.RR_FLAGS.boxdesatd ?? 2)).toFixed(3)}, rrOd);
    radiance = mix(radiance, vec3(dot(radiance, vec3(0.2126, 0.7152, 0.0722))), rrDs);
  }
  #endif` : '#include <lights_fragment_maps>')
      // one NaN pixel (degenerate tangent frames on anisotropic metal under punctual lights) is spread by bloom into a black block
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n\tif (any(isnan(gl_FragColor)) || any(isinf(gl_FragColor))) gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);');
  };
  material.customProgramCacheKey = () => { const F = globalThis.RR_FLAGS || {}; return (prevKey ? prevKey.call(material) : '') + '|box' + (boxFadeOn() ? 'cf' : '') + (+(F.boxdesat ?? 0) > 0 && new RegExp(F.boxdesatre || '.').test(material.name || '') ? 'ds' + F.boxdesat + '_' + (F.boxdesatd ?? 2) : ''); };
  material.needsUpdate = true;
}

// Thin glazing: Cycles shows storefront glass as a dark, mostly clear pane with sharp reflections of the corridor.
// Screen-space transmission (a second full scene render) is both slower and warmer than that, so panes are drawn as
// a nearly transparent reflective surface instead.
// cut crystal (chandelier drops): real refraction of the scene behind, with dispersion, instead of a flat pane
export function crystal(material) {
  material.transmission = 1; material.thickness = 0.03; material.ior = 1.52; material.roughness = 0.0; material.metalness = 0;
  material.dispersion = 0.6; material.specularIntensity = 1; material.envMapIntensity = 2.0; material.transparent = false; material.opacity = 1;
  material.needsUpdate = true; return true;
}
export function thinGlass(material) {
  // glass + emission lamp shades (rot_sconce_amber) arrive as a standard material with their glass weight in
  // userData.glassEmitW (blender_material.js applyBlenderGraph, res.glassEmit): they take the clear pane path below at any weight
  const glassEmit = !!material.userData.glassEmit && material.isMeshStandardMaterial;
  // a glass + opaque pattern (chain curtain) is drawn as an opaque cutout, its glass side being the holes. Checked before
  // the transmission gate: rr_del_barcode carries a glTF transmission of 0.25, so the gate returned first and three's own
  // transmission stayed on, and the curtain read see through (m54, B080 px)
  if (material.userData.blender?.res?.glassCut) { if (material.isMeshPhysicalMaterial) { material.transmission = 0; material.thickness = 0; material.needsUpdate = true; } return false; }
  if ((!material.isMeshPhysicalMaterial && !glassEmit) || (material.transmission < 0.5 && !glassEmit)) return false;
  if (glassEmit && material.userData.glassT !== undefined) return true; // already a pane (its transmission is 0 by then)
  if (/crystal/i.test(material.name)) return crystal(material);
  // One glass family, two programs: rough or ribbed panes refract the opaque scene through three's transmission target
  // (blur and rib lens below), clear and smoked panes are a premultiplied see-through pane. Both take the Blender values:
  // IOR (glTF KHR_materials_ior, 1.5 when absent) for the Fresnel, roughness, base colour as the tint, transmission and
  // metallic weights for how much passes.
  // how much light the pane lets through, measured against Cycles (_claude_glassT_e7a3.py, a pane in front of a white
  // emitter): Principled transmission tints by the square root of the base colour at each interface, so the smoked
  // Gjelina glass (base 0.156, one sheet) passes 37 %, not 15 %, and a pane modelled as a box (two faces, both drawn) passes
  // the base colour itself; the share that is not transmission (1 - Transmission Weight) renders as ordinary diffuse
  // surface, which is what makes Matteo's frosted panes (weight 0.5) read milky; the metallic share of a Principled is a
  // mirror, not glass, so it passes nothing (the black glass panels: metallic 0.08 to 0.3). Reflection: Schlick Fresnel
  // at the material's own IOR (Milos' storefront is IOR 1.05, Delmonico's 1.2: forcing 1.5 gave them five to sixty
  // times their reflectance, the grey veil over Milos in m54).
  const F0 = globalThis.RR_FLAGS || {};
  const c = material.color || new THREE.Color(1, 1, 1);
  const w = THREE.MathUtils.clamp(glassEmit ? material.userData.glassEmitW : material.transmission, 0, 1);
  const metal = glassEmit ? 0 : THREE.MathUtils.clamp(material.metalness || 0, 0, 1);
  const ior = THREE.MathUtils.clamp(material.ior || 1.5, 1.0, 2.333), f0 = ((ior - 1) / (ior + 1)) ** 2;
  // winefix (agent wine, Oct 14): the Milos hanging wine rack (Mesh_2261, mil_wine_glass: IOR 1.05, roughness 0,
  // transmission 1, Thin Wall) rendered as a white block through the storefront (m87 B000 B071 B076..B082 nz, ref 46 to
  // 90 against 133 to 196). Ray casts: each rack pixel crosses the front pane square on, then its 2 cm glass shelves
  // (both faces drawn) edge on, NoV about 0.12, then the back pane. At that angle three's environment term (DFGApprox
  // with specularF90 = 1) reflects 0.455 of the capture per face, where the exact Fresnel of a 1.05 sheet is 0.21 / 2 faces
  // (5x too much at NoV 0.3, 11x square on), and the pane alpha (Schlick) hides 0.53 of what is behind per face. The
  // reflected capture is the bright corridor and Milos ceiling seen from outside, while in Cycles a shelf inside the box
  // reflects the box itself: the shadowed ceiling and the purple slab (ref 71 against 236 above the rack).
  // RR_FLAGS.winefix = 1: mil_wine_glass only, 2: every clear pane under IOR 1.2 (the storefronts too, untested).
  // Exact unpolarised dielectric Fresnel of a thin wall (2R / (1 + R)) for the reflection share and the alpha, the 0.97
  // transmittance cap lifted, and the reflected capture scaled by RR_FLAGS.winek (default 0.2) on the rack glass.
  const WF = +(F0.winefix ?? 0), isWine = /^mil_wine_glass/.test(material.name || '');
  const exactF = !glassEmit && ior < 1.2 && ((WF >= 1 && isWine) || WF >= 2);
  const T = THREE.MathUtils.clamp(w * (1 - metal) * Math.sqrt(0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b), 0, exactF ? 1 : 0.97);
  // frosted / reeded panes (Matteo's cl_mt_reeded: roughness 0.32 + ribbed bump): Cycles' rough transmission blurs what is
  // behind into a milky glow. Clear panes (roughness under ~0.12) stay sharp.
  const r0 = material.roughness, frost = THREE.MathUtils.smoothstep(r0, 0.12, 0.4);
  // only panes with their own relief (a bump or normal in the graph: Matteo's reeded cl_mt_reeded) take the refracting
  // path. A plainly rough pane (the Sugarcane bottle display at B002) shows what is right behind it nearly sharp in
  // Cycles (m35), so it stays a pane
  const relief = !!material.userData.blender?.res?.normal;
  if (material.userData.frostT) return true; // shared by many panes: patch once (twice made duplicate declarations, the panes vanished in m41)
  const F = globalThis.RR_FLAGS || {};
  // (a glass + emission shade stays on the clear pane path: it is a standard material, three's transmission needs a physical one)
  if (frost > 0.25 && relief && !glassEmit && !F.nofrostT) {
    material.userData.frost = frost; material.userData.frostT = true;
    // thickness 0: three's own volume offset is off, the shader below bends the ray itself; the tint is the Cycles one
    // (square root of the base colour per interface, per channel; box panes draw their back face into the target too)
    material.transmission = w; material.thickness = 0; material.ior = ior;
    material.metalness = 0; material.roughness = r0;
    material.color.setRGB(Math.sqrt(c.r), Math.sqrt(c.g), Math.sqrt(c.b));
    // RR_FLAGS.lowglass = 1 with RR_FLAGS.lowglassreed = k (agent glassfix3, Oct 14, UNTESTED, off unless set): Matteo's
    // reeded panes (cl_mt_reeded, base 0.85 0.88 0.88, sqrt tint about 0.93) read pale and milky in the sweep (S24 S25 S26
    // S31 S37) where the 360s show dark smoky ribbed glass. This scales the transmission tint by k (try 0.5 to 0.7) so the
    // blurred bright room behind is let through less. Name pattern RR_FLAGS.lowglassreedre (default cl_mt_reeded).
    // Uniform value only, same program.
    if (+(F.lowglass ?? 0) && +(F.lowglassreed ?? 0) > 0 && new RegExp(F.lowglassreedre || '^cl_mt_reeded(\\.\\d+)?$').test(material.name || ''))
      material.color.multiplyScalar(THREE.MathUtils.clamp(+F.lowglassreed, 0, 1));
    material.attenuationDistance = Infinity;
    material.specularIntensity = 1; material.transparent = false; material.opacity = 1;
    // no depth write: the black steel mullions sit in the plane of the panes and read as translucent grey bars when the
    // glass won the depth test against them (m45/m48 audits); three draws transmissive panes after the opaque pass anyway
    // m70: depth write ON (opt out RR_FLAGS.reednodw). The grey mullion look this once guarded against turned out to be
    // skewed vertex normals (fixed in mergeStatic, m68). Without depth, transparent objects behind a pane (Material_501.003
    // green cards behind Matteo's, glass agent 8 pick) were drawn sharp on top of it, and N8AO darkened the pane with the
    // depth of the room behind
    material.depthWrite = !(globalThis.RR_FLAGS || {}).reednodw;
    // single sided (glass agent 5, Oct 14): the glTF material is double sided (and the load step draws every opaque
    // FrontSide material two sided anyway, rr2_player.js notwosided), so these panes arrived here DoubleSide. Three r169 then
    // draws the back faces of a DoubleSide transmissive mesh into the transmission target before the main pass
    // (renderTransmissionPass), and the main pass draws both faces of each 2 to 3 cm pane slab (picks: two cl_mt_reeded
    // hits 2 cm apart at every B075 pz pick) in one merged draw without depth write, so whichever face comes later in the
    // index buffer wins: where it is the far face, it reads the target that already holds its own milky, blurred self and
    // the rib offset never shows (the big panes); where it is the near face, the ribs show (the narrow panes by the lamp).
    // One face per slab, the near one, reads the opaque scene as designed.
    // RR_FLAGS.reedds = 1 keeps two sided (A/B)
    if (!F.reedds) material.side = THREE.FrontSide;
    // Ribs (Oct 13, second pass): the graph's own bump comes from screen derivatives and fades out under 14 px, which is
    // where the 2.2 cm ribs sit from the corridor, so the panes read flat. The ribs are rebuilt here in closed form from
    // the Blender nodes (blender_material.js glassRibs: wave bands, bump distance and strength), filtered by their pixel
    // footprint instead of faded, and drive both the reflection and the refraction.
    // Refraction: each rib is a small prism. The ray is bent by (ior - 1) times the rib tilt and meets the room some
    // distance behind the pane (uTxD, 1 m: the rooms behind Matteo's panes run 0.25 m (black base panel) to 4 m (glow card)), so each rib shows a
    // shifted strip of the room. Roughness: GGX alpha = r^2 on each rough face spreads the transmitted ray by about
    // uTxS * alpha radians; at that distance behind the pane this is a blur radius in the transmission target, taken from
    // its mip chain. The room behind blurs into the glow the 360s show and the ribs band it.
    const rb = material.userData.blender?.ribs;
    const ax = rb ? (rb.axis === 'X' ? new THREE.Vector3(1, 0, 0) : rb.axis === 'Y' ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0)) : new THREE.Vector3(0, 1, 0);
    const U = { uRibAxis: { value: ax }, uRibFreq: { value: rb ? rb.freq : 0 }, uRibPhase: { value: rb ? rb.phase : 0 }, uRibSlope: { value: rb ? rb.slope : 0 },
      uRibStr: { value: rb ? rb.strength : 0 }, uTxD: { value: F.glassD ?? 1.0 }, uTxS: { value: F.glassS ?? 1.4 } };
    material.userData.glassU = U;
    const prevR = material.onBeforeCompile, prevRK = material.customProgramCacheKey;
    material.onBeforeCompile = (sh, r) => {
      if (prevR) prevR.call(material, sh, r);
      // glass agent 4 (m59 pick): the reeded panes drew with a sharp, unshifted room behind them although this program
      // and these values were in place, as if the rib and blur uniforms read 0 on the GPU. By default the values are
      // written into the source as constants (one material, one program), so nothing depends on their binding;
      // ?reeduni=1 keeps the uniforms for live tuning
      const lit = !F.reeduni;
      if (!lit) Object.assign(sh.uniforms, U);
      const f = (x) => { const v = +x; return Number.isFinite(v) ? (Number.isInteger(v) ? v.toFixed(1) : String(v)) : '0.0'; };
      const decl = lit ? `const vec3 uRibAxis = vec3(${f(U.uRibAxis.value.x)}, ${f(U.uRibAxis.value.y)}, ${f(U.uRibAxis.value.z)}); const float uRibFreq = ${f(U.uRibFreq.value)}, uRibPhase = ${f(U.uRibPhase.value)}, uRibSlope = ${f(U.uRibSlope.value)}, uRibStr = ${f(U.uRibStr.value)}, uTxD = ${f(U.uTxD.value)}, uTxS = ${f(U.uTxS.value)};`
        : 'uniform vec3 uRibAxis; uniform float uRibFreq, uRibPhase, uRibSlope, uRibStr, uTxD, uTxS;';
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRibWP;')
        .replace('#include <fog_vertex>', `#include <fog_vertex>
  #ifdef USE_INSTANCING
  vRibWP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
  #else
  vRibWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
  #endif`);
      // the chunk is still an #include at this point: expand it here, then patch its sampling function
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vRibWP; ${decl}
vec2 rrTxOff = vec2(0.0); float rrTxLod = 0.0;
// rib band limit (see the rib normal below): rrRibK is the share of the rib amplitude kept at this pixel, rrRibAx the rib
// tilt direction in view space; the faded share is drawn as the rib average: four taps at the quadrature phases
// (sin = +-0.383, +-0.924, equal weights: the exact mean of a sine over its period for a smooth function of it)
float rrRibK = 1.0; vec3 rrRibAx = vec3(0.0); vec4 rrOffA = vec4(0.0), rrOffB = vec4(0.0); float rrAvgLod = 0.0, rrTxF = 1.0;
vec3 rrRibN( const in vec3 ng, const in float s ) { return normalize( mix( ng, normalize( ng - uRibSlope * s * rrRibAx ), uRibStr ) ); }`)
        .replace('#include <transmission_pars_fragment>', THREE.ShaderChunk.transmission_pars_fragment.replace('vec4 getTransmissionSample( const in vec2 fragCoord, const in float roughness, const in float ior ) {',
`vec4 getTransmissionSample0( const in vec2 fragCoord, const in float roughness, const in float ior );
	vec4 getTransmissionSample( const in vec2 fragCoord, const in float roughness, const in float ior ) {
		// rib lens offset and rough blur, both worked out in main (rrTxOff, rrTxLod)
		float lmax = max( log2( max( transmissionSamplerSize.y, 1.0 ) ) - 2.0, 0.0 );
		vec4 tx = textureBicubic( transmissionSamplerMap, fragCoord.xy + rrTxOff, clamp( rrTxLod, 0.0, lmax ) );
		if ( rrRibK < 0.999 ) {
			// ribs finer than the pixels: the rib averaged room (each rib's shifted strip, averaged over its period)
			float la = clamp( rrAvgLod, 0.0, lmax );
			vec4 ta = 0.25 * ( textureBicubic( transmissionSamplerMap, fragCoord.xy + rrOffA.xy, la ) + textureBicubic( transmissionSamplerMap, fragCoord.xy + rrOffA.zw, la )
				+ textureBicubic( transmissionSamplerMap, fragCoord.xy + rrOffB.xy, la ) + textureBicubic( transmissionSamplerMap, fragCoord.xy + rrOffB.zw, la ) );
			tx = mix( ta, tx, rrRibK );
		}
		return vec4( tx.rgb * rrTxF, tx.a );
	}
	vec4 getTransmissionSample0( const in vec2 fragCoord, const in float roughness, const in float ior ) {`))
        // geometric pane normal (glass agent 7, m66 pick at B075 pz): the big centre panes are drawn by the merged mesh
        // 'merged:cl_mt_reeded' whose interpolated vertex normal disagrees with its triangle (face normal . ray -0.99, vertex
        // normal . ray +0.10 at pz 0.35:0.45; +0.32 and +0.37 at 0.2:0.3 and 0.6:0.3), while the narrow panes by the door
        // agree (both -0.46). Same material, same program, same rib constants (slope 0.56): the ribs were there, but tilted
        // about a normal lying almost in the view plane, so the rib lens and the Fresnel read the pane as seen edge on
        // (pale, flat, no offset). A pane is flat: its normal is taken from the triangle itself (screen derivatives of the
        // view position, turned toward the camera), as three's flatShading does. RR_FLAGS.reedvn = 1 keeps the vertex normal (A/B)
        .replace('#include <normal_fragment_begin>', F.reedvn ? '#include <normal_fragment_begin>' : `#include <normal_fragment_begin>
  { vec3 rrGn = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition))); if (dot(rrGn, vViewPosition) < 0.0) rrGn = -rrGn;
    normal = rrGn; nonPerturbedNormal = rrGn; }`)
        // after the graph's bump and the specular anti-aliasing (blender_material.js patches normal_fragment_maps)
        .replace('#include <clearcoat_normal_fragment_begin>', `{
    // analytic rib normal: Blender bump N' = normalize(N - dist grad h), h = 0.5 + 0.5 sin(n - pi/2), mixed by strength.
    // Band limit (agent moire, B084 pz door panes): the sinc of the phase step alone still kept 0.64 of the amplitude at
    // 2 px per rib and some up to 1 px, where the ribs alias into fans. w is the phase change per pixel (length of the
    // screen gradient); the amplitude fades to its mean (flat) between 4 px per rib (w = pi/2) and Nyquist (2 px, w = pi),
    // and the faded share is drawn as the rib average (transmission taps and mean Fresnel below)
    // so the pane keeps the ribs' brightness and smear: a fine even texture, not a milky flat pane
    vec3 ng = normalize(nonPerturbedNormal);
    if (uRibSlope != 0.0) {
      float ph = dot(vRibWP, uRibAxis) * uRibFreq + uRibPhase;
      float w = max(length(vec2(dFdx(ph), dFdy(ph))), 1e-4), hw = 0.5 * min(w, 6.2831853);
      rrRibK = 1.0 - smoothstep(${(((globalThis.RR_FLAGS || {}).ribFade0 ?? 0.75) * 3.1415927).toFixed(5)}, 3.1415927, w); // m69 started at pi/2 and flattened ribs the reference keeps at ~2.4 px
      vec3 ax = (viewMatrix * vec4(uRibAxis, 0.0)).xyz; ax -= ng * dot(ax, ng); rrRibAx = ax;
      vec3 nb = normalize(ng - uRibSlope * (sin(hw) / hw) * rrRibK * sin(ph) * ax);
      normal = normalize(mix(ng, nb, uRibStr));
    }
  }
  #include <clearcoat_normal_fragment_begin>`)
        .replace('#include <transmission_fragment>', `{
    // ray through the pane: bent at the ribbed face by its tilt against the flat pane, (ior - 1) times; the room it meets
    // uTxD behind the pane, projected back to the screen, is where the transmission target is read
    vec3 pv = -vViewPosition; float dv = length(pv); vec3 d0 = pv / dv;
    vec3 ng = normalize(nonPerturbedNormal);
    vec3 t0 = refract(d0, ng, 1.0 / material.ior), t1 = refract(d0, normalize(normal), 1.0 / material.ior);
    vec3 d1 = (dot(t1, t1) > 0.0 && dot(t0, t0) > 0.0) ? normalize(d0 + material.ior * (t1 - t0)) : d0;
    vec4 c0 = projectionMatrix * vec4(pv + d0 * uTxD, 1.0), c1 = projectionMatrix * vec4(pv + d1 * uTxD, 1.0);
    rrTxOff = 0.5 * (c1.xy / c1.w - c0.xy / c0.w);
    // rough refraction: angular spread uTxS * alpha (alpha = r^2), scaled to no blur at ior 1 like three's own; its
    // radius on screen at uTxD behind the pane picks the mip level (a bicubic read at level k spans about 1.4 x 2^k texels)
    float ga = material.roughness * material.roughness * clamp(material.ior * 2.0 - 2.0, 0.0, 1.0);
    float rpx = uTxS * ga * uTxD / (dv + uTxD) * projectionMatrix[1][1] * 0.5 * transmissionSamplerSize.y;
    rrTxLod = log2(max(1.4 * rpx, 1.0));
    if (rrRibK < 0.999) {
      // rib averaged room: the screen offset of each quadrature rib at full amplitude (same lens as above); the mip level
      // is raised until the bicubic footprint covers the tap spacing, so the taps smear into one band instead of ghosts
      float sq[4]; sq[0] = 0.3826834; sq[1] = -0.3826834; sq[2] = 0.9238795; sq[3] = -0.9238795;
      vec2 o[4]; float om = 0.0;
      for (int i = 0; i < 4; i++) {
        vec3 ts = refract(d0, rrRibN(ng, sq[i]), 1.0 / material.ior);
        vec3 ds = (dot(ts, ts) > 0.0 && dot(t0, t0) > 0.0) ? normalize(d0 + material.ior * (ts - t0)) : d0;
        vec4 cs = projectionMatrix * vec4(pv + ds * uTxD, 1.0);
        o[i] = 0.5 * (cs.xy / cs.w - c0.xy / c0.w); om = max(om, length(o[i]));
      }
      rrOffA = vec4(o[0], o[1]); rrOffB = vec4(o[2], o[3]);
      rrAvgLod = max(rrTxLod, log2(max(0.4 * om * transmissionSamplerSize.y, 1.0)));
    }
  }
  #include <transmission_fragment>`)
        // rib averaged reflection for the faded share: the mean Fresnel of the ribs (Schlick over the four quadrature
        // normals) against the flat pane's: reflection scaled by it, transmission by the matching remainder. The lobe is
        // not widened: an isotropic GGX widening by the mean squared tilt pulled the bright ceiling in through its tails
        // and lit oblique panes 2x to 4x over a 4x supersampled render of the ribs (lab: obl 32.5 vs 24.1, graz 12.6 vs 7.6)
        .replace('#include <lights_fragment_begin>', `if (rrRibK < 0.999 && uRibSlope != 0.0) {
    vec3 ng = normalize(nonPerturbedNormal), vv = normalize(vViewPosition);
    float f0 = pow2((material.ior - 1.0) / (material.ior + 1.0));
    float cf = clamp(dot(ng, vv), 0.0, 1.0), ff = f0 + (1.0 - f0) * pow(1.0 - cf, 5.0), fa = 0.0;
    float sq[4]; sq[0] = 0.3826834; sq[1] = -0.3826834; sq[2] = 0.9238795; sq[3] = -0.9238795;
    for (int i = 0; i < 4; i++) {
      vec3 ns = rrRibN(ng, sq[i]); float cs = clamp(dot(ns, vv), 0.0, 1.0);
      fa += 0.25 * (f0 + (1.0 - f0) * pow(1.0 - cs, 5.0));
    }
    float u = 1.0 - rrRibK;
    float rs = mix(1.0, fa / max(ff, 1e-4), u);
    material.specularColor *= rs; material.specularF90 = min(material.specularF90 * rs, 1.0);
    rrTxF = mix(1.0, (1.0 - fa) / max(1.0 - ff, 1e-4), u);
  }
  #include <lights_fragment_begin>`);
    };
    material.customProgramCacheKey = () => { const u = U; return (prevRK ? prevRK.call(material) : '') + '|reeded10' + (F.reedvn ? 'v' : '') + (F.reeduni ? 'u' : ':' + [u.uRibFreq, u.uRibPhase, u.uRibSlope, u.uRibStr, u.uTxD, u.uTxS].map(x => x.value).join(',') + ',' + u.uRibAxis.value.toArray().join(',')); };
    material.needsUpdate = true; return true;
  }
  const glassT = { value: T * (1 - 0.5 * frost) }, glassD = { value: (1 - w) + 0.2 * frost * w }, glassF0 = { value: f0 };
  // glass agent 9 (m87 audit, RR_FLAGS.glassfix = 1): Gjelina's storefront and rotunda glass (gjl_glass_clear base 0.156,
  // Material_236 / _237 base about 0.2, single sheets, the rotunda doubles them 4 cm apart) let 37 % and 44 % through
  // per sheet here, 16 % where two stack, so the bright interior card behind (gi_ceil, emissive gi_proj1180) read dark
  // and see through: B001 nx 71 / 84 against 192 / 191, B008 nz transom 77 against 183, B001 px 40 against 106. The
  // reflection is not the gap: ray cast reflections off these panes meet the cream tray_G ceiling at near normal
  // incidence (cos 0.87 to 0.98, F 0.034), far too little to make the white. Ryan's photos show the glass clear and
  // neutral. So the matched panes pass glassfixT (default 0.92, about 1 - F0 at IOR 1.45 plus a little absorption)
  // regardless of the base colour. Same program (uniform value only); RR_FLAGS.glassfixre overrides the name pattern.
  // RR_FLAGS.glassfix = 2 (glass agent 10, m89 against m90 on the GPU): the same lift helped where the ray meets the rotunda
  // panes (rot_gC_glass and its piers, B001 px with the bright gi_proj1180 card behind, and the floor mirror of the rotunda
  // at B005 B006 B012 B013 B014 nz/nx) and hurt where it meets the corridor storefront panes gjl_L_glass, gjl_R_glass
  // (B007 B008 nz/nx, the reference is dark smoky glass there, with the same bright card behind at B008 nz and the
  // same square on angle as B001 px). Neither the angle, the pass nor what is behind separates the two: the object
  // does. All of them share gjl_glass_clear, so rr2_player.js gives the rotunda meshes (RR_FLAGS.glassfixobj, default
  // ^rot_) their own copy of it flagged userData.glassfixOn; that copy and Material_236 / _237 take the lift here, the
  // storefront keeps the sqrt base tint.
  // The rotunda copy is lifted only for rays that leave the rotunda through it (seen from the rotunda side, as at B001
  // and in the floor mirror from B005 to B014, which looks across the rotunda at rot_gB_glass). Seen from the Gjelina
  // interior, as from the corridor through gjl_L_glass at B007 nz and B008 nx, it keeps the base tint, or the second pane
  // would lift those dark storefront views again (estimated 89 to 107 at B007 nz, reference 42). Side test per fragment:
  // the horizontal ray direction against the outward radius of the rotunda ring (centre RR_FLAGS.glassfixc, three x and
  // z, default -22.18 9.94, fitted to rot_gC_glass, radius 5.5), blended over a cosine of +-0.15; the mirror camera only
  // flips y, so the floor mirror pass gets the same answer. One more program, for the rotunda copy only;
  // RR_FLAGS.glassfixside = 0 lifts it from both sides with no new program.
  const gfBase = glassT.value, gfSide = +F.glassfix === 2 && !!material.userData.glassfixOn && +(F.glassfixside ?? 1) !== 0;
  if (+F.glassfix === 2 ? (!glassEmit && frost < 0.25 && metal < 0.05 && (material.userData.glassfixOn || new RegExp(F.glassfix2re || '^Material_23[67](\\.\\d+)?$').test(material.name || '')))
    : (F.glassfix && !glassEmit && frost < 0.25 && metal < 0.05 && new RegExp(F.glassfixre || '^(gjl_glass_clear|Material_23[67])(\\.\\d+)?$').test(material.name || '')))
    glassT.value = Math.max(glassT.value, Math.min(+(F.glassfixT ?? 0.92), 0.97));
  // RR_FLAGS.storefix = 1 (agent glass11, Oct 14): the corridor storefront panes (gjl_glass_clear outside the rotunda,
  // mt_glass) read brighter than the smoky reference at B007 B008 nz/nx and B085 px. Their transmittance is scaled by
  // RR_FLAGS.storefixk per drawn face; the rotunda copy (glassfixOn) and coloured panes are left alone.
  // Agent glass12 (m94 audit): 0.6 moved B007 B008 too little. Fitting display linear L = R + k B through m92 (k 1) and
  // m94 (k 0.6) gives k 0.4 at B007 nz (192,384); B008 nz/nx stay above the ref even at k 0 (their reflection alone is
  // brighter than the ref), so the default is 0.4 and B008 needs a reflection fix, not more transmission loss.
  if (+(F.storefix ?? 0) && !glassEmit && frost < 0.25 && !material.userData.glassfixOn && new RegExp(F.storefixre || '^(gjl_glass_clear|mt_glass)(\\.\\d+)?$').test(material.name || ''))
    glassT.value *= THREE.MathUtils.clamp(+(F.storefixk ?? 0.4), 0, 1);
  // RR_FLAGS.lowglass = 1 (agent glassfix3, Oct 14): the lower frosted band of the copper screen bays (mt_frost: transmission
  // 0.5, base 0.40 0.38 0.35, roughness 0.35, no relief, so the pane path) reads as a flat light grey slab (sweep S40 to S53,
  // Ryan's 'Voltaire' screenshot is the mt2_*-4.9 bay). Against Cycles at B084 px (mt2_frost-11.4, the only bay a 360 sees):
  // ref 94 76 51 / 103 84 60 / 80 63 40 (near, mid, far) where m83 drew 153 133 111 / 152 131 107 / 118 99 78, about 2.4x in
  // linear. In Cycles half the pane is rough transmission of the unlit room behind (mt_int_wall, base 0.02), which adds
  // almost nothing, and the other half is diffuse; here glassD adds 0.2 x frost x w of extra diffuse for the frosted share
  // on top of the 1 - w diffuse, and the capture light it is lit by is the corridor's at 1.6 m. The diffuse share becomes
  // (1 - w) x RR_FLAGS.lowglassk (default 0.55, from the B084 px crop; refit on the before / after renders). Matched by
  // RR_FLAGS.lowglassfre (default mt_frost). The clear upper panes of the same bays (RR_FLAGS.lowglassrre, default
  // mt_glass) get a roughness floor RR_FLAGS.lowglassr (default 0.12) for the mirrored capture: at 0.03 the 256 px capture's
  // chain curtain and ceiling grid alias into the white vertical speckle streaks over the copper screen (sweep S37 S38 S39
  // S40, rv front / right / far), where Cycles shows a soft dim mirror. Uniform values only.
  if (+(F.lowglass ?? 0) && !glassEmit) {
    if (new RegExp(F.lowglassfre || '^mt_frost(\\.\\d+)?$').test(material.name || '')) glassD.value = (1 - w) * THREE.MathUtils.clamp(+(F.lowglassk ?? 0.55), 0, 1);
    if (new RegExp(F.lowglassrre || '^mt_glass(\\.\\d+)?$').test(material.name || '')) material.userData.lowglassR = THREE.MathUtils.clamp(+(F.lowglassr ?? 0.12), 0, 1);
  }
  material.userData.glassT = glassT.value; material.userData.glassDiffuse = glassD.value; material.userData.frost = frost;
  // black glass (a metallic share and almost nothing let through: the base panels behind Matteo's lower reeded band,
  // Material_398, and the black cladding Material_30 to _40 / _86) is drawn at the end of the opaque pass instead of with
  // the transparent ones (rr2_player.js, glassLate), so three's transmission target has it: the reeded panes in front of
  // it read dark, as in Cycles, instead of showing the bright room through it (B080 px, B084 px lower band)
  if (T < 0.3 && metal > 0.05 && frost < 0.25 && !glassEmit && !F.noglassLate) material.userData.glassLate = true;
  material.transmission = 0; material.thickness = 0;
  material.transparent = true; material.opacity = 1; material.depthWrite = false;
  material.metalness = 0; material.roughness = frost > 0 ? r0 : Math.min(r0, w > 0.9 ? 0.05 : 1);
  if (material.userData.lowglassR !== undefined) material.roughness = Math.max(material.roughness, material.userData.lowglassR);
  material.ior = ior; material.specularIntensity = 1;
  // premultiplied: ONE / ONE_MINUS_SRC_ALPHA; alpha is the share of what is behind that the pane hides
  material.blending = THREE.CustomBlending; material.blendSrc = THREE.OneFactor; material.blendDst = THREE.OneMinusSrcAlphaFactor;
  // coloured clear glass (Sugarcane's green Material_501, base 0.52 0.55 0.47): the scalar alpha above tints what is
  // behind by its luminance only, so the green was lost (m54/m55r B002, B009). Cycles tints each channel. A light,
  // clearly coloured pane (saturation over 0.12, T over 0.5) therefore takes what is behind times a constant colour
  // instead: the per channel transmittance (base colour to the power RR_FLAGS.tintexp per drawn face, default 0.5 as
  // measured for one interface, times the non metallic weight and 1 - F0). The reflection is still added on top; the
  // per pixel Fresnel loss of transmission is not modelled on this path (it matters only at grazing angles).
  // Dark or near neutral panes (Gjelina smoked glass, Milos, Delmonico) keep the path above unchanged.
  const cMax = Math.max(c.r, c.g, c.b), cMin = Math.min(c.r, c.g, c.b), sat = cMax > 0 ? (cMax - cMin) / cMax : 0;
  if (!glassEmit && frost < 0.25 && sat > 0.12 && T >= 0.5 && !F.notint) {
    const e = +(F.tintexp ?? 0.5), k = w * (1 - metal) * (1 - f0);
    material.blendDst = THREE.ConstantColorFactor; material.blendColor = new THREE.Color(Math.min(Math.pow(c.r, e) * k, 0.97), Math.min(Math.pow(c.g, e) * k, 0.97), Math.min(Math.pow(c.b, e) * k, 0.97));
    // m84 audit (agent sug4): Sugarcane's green glass reads as dark smoky glass in the 360s; what is seen through it is
    // about 1.25x too bright in display linear (B002 nx 157 against 141, B009 nx 150 against 138, first opaque hit behind
    // Material_501). RR_FLAGS.sugdark=1 scales its transmittance by RR_FLAGS.sugdarkk (default 0.8): one constant per
    // pane, so no seams; the reflection added on top is untouched.
    if (/^Material_501(\.\d+)?$/.test(material.name || '') && +(F.sugdark ?? 0)) material.blendColor.multiplyScalar(+(F.sugdarkk ?? 0.8));
    material.blendAlpha = 1; material.userData.glassTint = material.blendColor.toArray();
  }
  const prev = material.onBeforeCompile; const prevKey = material.customProgramCacheKey;
  const gfc = Array.isArray(F.glassfixc) ? F.glassfixc : [-22.18, 9.94];
  const glassSide = { value: new THREE.Vector4(+gfc[0], +gfc[1], glassT.value, gfBase) };
  const glassIor = { value: ior }, glassEnvK = { value: isWine ? +(F.winek ?? 0.2) : 1 };
  if (exactF) material.userData.glassExactF = true;
  material.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(material, sh, r);
    sh.uniforms.uGlassT = glassT; sh.uniforms.uGlassD = glassD; sh.uniforms.uGlassF0 = glassF0;
    if (exactF) {
      sh.uniforms.uGlassIor = glassIor; sh.uniforms.uGlassEnvK = glassEnvK;
      // exact Fresnel (thin wall, both interfaces) replaces three's split sum term on the reflected capture and the
      // Schlick share in the alpha below; direct lamp highlights are left as three draws them
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform float uGlassIor; uniform float uGlassEnvK;
float glassFresnelThin(float ci, float n) {
  ci = clamp(ci, 0.0, 1.0); float s2 = (1.0 - ci * ci) / (n * n); if (s2 >= 1.0) return 1.0;
  float ct = sqrt(1.0 - s2), rs = (ci - n * ct) / (ci + n * ct), rp = (n * ci - ct) / (n * ci + ct), R = 0.5 * (rs * rs + rp * rp);
  return 2.0 * R / (1.0 + R);
}`).replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
  { vec3 gN = normalize(normal), gV = normalize(vViewPosition); float gc = abs(dot(gN, gV));
    vec2 gfab = DFGApprox(gN, gV, material.roughness); float gF3 = max(material.specularColor.g * gfab.x + material.specularF90 * gfab.y, 1e-4);
    reflectedLight.indirectSpecular *= uGlassEnvK * glassFresnelThin(gc, uGlassIor) / gF3; }`);
    }
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uGlassT; uniform float uGlassD; uniform float uGlassF0;')
      .replace('vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;', 'vec3 outgoingLight = totalSpecular + uGlassD * totalDiffuse + totalEmissiveRadiance;')
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>\n  { float gNoV = clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0); float gF = ${exactF ? 'glassFresnelThin(gNoV, uGlassIor)' : 'uGlassF0 + (1.0 - uGlassF0) * pow(1.0 - gNoV, 5.0)'}; gl_FragColor.a = 1.0 - (1.0 - gF) * ${gfSide ? 'mix(uGfSide.w, uGfSide.z, smoothstep(-0.15, 0.15, dot(normalize(vGfW - uGfSide.xy), normalize(vGfW - cameraPosition.xz + vec2(1e-5)))))' : 'uGlassT'}; }`);
    if (gfSide) {
      sh.uniforms.uGfSide = glassSide;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vGfW;')
        .replace('#include <fog_vertex>', `#include <fog_vertex>
  { vec4 gfw = modelMatrix * vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    gfw = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
  #endif
    vGfW = gfw.xz; }`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vGfW; uniform vec4 uGfSide;');
    }
  };
  // delmfix (rr2_probes.js): the mirrored capture on the delmfix panes is scaled by RR_FLAGS.delmk (default 0.35): the
  // capture is taken at B084, 6 m from the pane, and still holds the lit curtain in directions where the pane's own mirror
  // ray meets the soffit. Written as a constant (one program per k)
  const delmK0 = material.userData.delmfix && !exactF ? THREE.MathUtils.clamp(+(F.delmk ?? 0.35), 0, 1) : 1;
  // bluepatch: panes whose capture was slid along their line (rr2_probes.js, lowglassshift) take lowglassK the same way
  const delmK = delmK0 * (material.userData.lowglassK !== undefined && !exactF ? material.userData.lowglassK : 1);
  if (delmK < 1) { const prevD = material.onBeforeCompile; material.onBeforeCompile = (sh, r) => { prevD.call(material, sh, r);
    sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n  reflectedLight.indirectSpecular *= ${delmK.toFixed(4)};`); }; }
  // RR_FLAGS.storefix = 1, second part: the corridor storefront glass that stands on the floor (rr_del_glass on m2_glassL and
  // m2_grille, clear 0.95, IOR 1.2) has no base panel in the export (ray casts from B071 B074 B082 ny meet the pane at
  // 0.2 to 0.4 m and nothing else before the room), where the reference shows a dark base band with a black edge and
  // the room darkened behind it. Below RR_FLAGS.storefixh metres (world y, default 0.35) the pane hides
  // RR_FLAGS.storefixbk (default 0.85) more of what is behind and draws a near black base instead, after the pane alpha (before tone mapping). One more program.
  // Agent glass12 (m94 audit): wrong as built. The ref crops (B074 B078 B000 nz, B071 ny) show a bronze sill ledge seen
  // clearly through the pane with a lit strip under it, not a dark band, and the black band read 29 to 44 against
  // 104 to 162. It now needs its own flag, RR_FLAGS.storefixband = 1 (default off); storefix = 1 keeps only the scale.
  const sfBand = +(F.storefixband ?? 0) && !glassEmit && frost < 0.25 && new RegExp(F.storefixbre || '^rr_del_glass(\\.\\d+)?$').test(material.name || '');
  const sfH = +(F.storefixh ?? 0.35), sfK = THREE.MathUtils.clamp(+(F.storefixbk ?? 0.85), 0, 1);
  if (sfBand) { const prevS = material.onBeforeCompile; material.onBeforeCompile = (sh, r) => { prevS.call(material, sh, r);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vSfY;')
      .replace('#include <fog_vertex>', `#include <fog_vertex>
  { vec4 sfw = modelMatrix * vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    sfw = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
  #endif
    vSfY = sfw.y; }`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vSfY;')
      .replace('#include <tonemapping_fragment>', `
  { float sfB = (1.0 - smoothstep(${(sfH - 0.01).toFixed(4)}, ${(sfH + 0.01).toFixed(4)}, vSfY)) * ${sfK.toFixed(4)};
    gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * 0.2 + vec3(0.004), sfB); gl_FragColor.a = mix(gl_FragColor.a, 1.0, sfB); }
#include <tonemapping_fragment>`); }; }
  material.customProgramCacheKey = () => (prevKey ? prevKey.call(material) : '') + '|thinglass6' + (exactF ? 'x' : '') + (gfSide ? 'gs' : '') + (delmK < 1 ? '|delm' + delmK.toFixed(4) : '') + (sfBand ? '|sfb' + sfH.toFixed(3) + '_' + sfK.toFixed(3) : '');
  material.needsUpdate = true; return true;
}

// One shared planar reflection for the polished walking floor (the MeshReflectorMaterial idea, vanilla): the scene is
// rendered once more from a camera mirrored in the floor plane, into a mipmapped half-resolution target; floor
// materials then take their specular radiance from it instead of from the capture cube. One extra scene render per
// frame: desktop tier only.
// Blur model (floor agent, Oct 13, measured on the ny faces of all 34 spots against m54): Cycles' GGX blurs a
// reflection by an angle, so on screen the blur grows with how far the reflected thing lies behind the floor (a wall
// base touching the floor stays sharp, the ceiling lamps 5 m up spread into pools) and it is stretched toward the
// viewer at grazing angles (streaks, not round clouds). The old fixed mip per roughness (level 3 for the plain tile,
// 0.45 / 0.35 / 0.2 over three levels up to 6) made the lamp pools 5x dimmer than the 360s with 128 px wide halos,
// and the far floor bloomed into round clouds of light. Now: the lobe width comes from the GGX alpha, scaled by the
// share of the reflected path behind the floor (read from the mirror's depth, averaged over the blur footprint so
// the blur never steps at a silhouette), the mip level follows the narrow (across) width and five taps spread it
// along the stretch axis; a two level tail keeps the GGX halo.
// mirror switch of FloorReflector.patch: 1 on a mirror floor, 0 on a material that only carries the code (unifyVariants)
const FLOOR_ON = { value: 1 }, FLOOR_OFF = { value: 0 };
let _floorBlack = null;
const floorBlack = () => (_floorBlack ||= { value: Object.assign(new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1), { needsUpdate: true }) });
// ?floorblur=1: a vanilla port of drei's MeshReflectorMaterial blur (BlurPass, ConvolutionMaterial), done as a dual
// Kawase pyramid. The mirror target is filtered down four times (half, quarter, eighth, sixteenth of the mirror), each
// step a 13 tap Call of Duty style downsample (four box quads plus the centre box, weights 0.5 / 0.125 x 4), which is
// smooth (a tent, not a box) and spreads a sub texel lamp glint over its whole footprint instead of letting it pop in
// and out of one texel as the camera moves (the sparkle). The floor shader then reads level L of this pyramid at the
// GGX radius it already works out (depth aware: t is the behind the floor share, so a contact stays at level 0 and the
// far reflection climbs the pyramid). Every level is a normalised average of the one below, so the reflected energy is
// the same at every level and the mix weight, the Fresnel and three's env BRDF are untouched.
// ?floorkaris=K: optional firefly guard on the first step only (Karis weights 1 / (1 + luma / K)); off by default
// because it also dims the true lamp pools.
// ?floorblurk=x scales the radius (default 1), ?floorblurmin=x is the lowest level read (default 0.6 mirror texels'
// worth of blur on log2, a touch above the raw target so a glint never resolves to a single texel).
const FB_LEVELS = 4;
class FloorBlurPyramid {
  constructor() {
    this.rts = []; this.tex = []; for (let i = 0; i < FB_LEVELS; i++) this.tex.push({ value: null });
    this.src = { value: null }; this.texel = { value: new THREE.Vector2() }; this.karis = { value: 0 };
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tSrc: this.src, uTexel: this.texel, uKaris: this.karis },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `precision highp float; varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uKaris;
vec3 T(vec2 o) { return textureLod(tSrc, clamp(vUv + o * uTexel, vec2(0.0), vec2(1.0)), 0.0).rgb; }
float W(vec3 c) { return uKaris > 0.0 ? 1.0 / (1.0 + dot(c, vec3(0.2126, 0.7152, 0.0722)) / uKaris) : 1.0; }
void main() {
  // uTexel is the source texel; the 13 taps sit on a 2 texel grid around the output texel centre
  vec3 a = T(vec2(-2.0, 2.0)), b = T(vec2(0.0, 2.0)), c = T(vec2(2.0, 2.0));
  vec3 d = T(vec2(-2.0, 0.0)), e = T(vec2(0.0, 0.0)), f = T(vec2(2.0, 0.0));
  vec3 g = T(vec2(-2.0, -2.0)), h = T(vec2(0.0, -2.0)), i = T(vec2(2.0, -2.0));
  vec3 j = T(vec2(-1.0, 1.0)), k = T(vec2(1.0, 1.0)), l = T(vec2(-1.0, -1.0)), m = T(vec2(1.0, -1.0));
  vec3 q0 = (j + k + l + m) * 0.25, q1 = (a + b + d + e) * 0.25, q2 = (b + c + e + f) * 0.25, q3 = (d + e + g + h) * 0.25, q4 = (e + f + h + i) * 0.25;
  float w0 = 0.5 * W(q0), w1 = 0.125 * W(q1), w2 = 0.125 * W(q2), w3 = 0.125 * W(q3), w4 = 0.125 * W(q4);
  gl_FragColor = vec4((q0 * w0 + q1 * w1 + q2 * w2 + q3 * w3 + q4 * w4) / (w0 + w1 + w2 + w3 + w4), 1.0);
}`, depthTest: false, depthWrite: false, toneMapped: false });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat); this.quad.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.quad); this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  size(w, h) {
    for (let i = 0; i < FB_LEVELS; i++) {
      const lw = Math.max(1, w >> (i + 1)), lh = Math.max(1, h >> (i + 1));
      if (!this.rts[i]) this.rts[i] = new THREE.WebGLRenderTarget(lw, lh, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false });
      else if (this.rts[i].width !== lw || this.rts[i].height !== lh) this.rts[i].setSize(lw, lh);
      this.tex[i].value = this.rts[i].texture;
    }
  }
  run(renderer, srcRT) {
    this.size(srcRT.width, srcRT.height);
    const F = globalThis.RR_FLAGS || {}, prevRT = renderer.getRenderTarget(), prevAC = renderer.autoClear; renderer.autoClear = false;
    let src = srcRT;
    for (let i = 0; i < FB_LEVELS; i++) {
      this.src.value = src.texture; this.texel.value.set(1 / src.width, 1 / src.height); this.karis.value = i === 0 ? +(F.floorkaris || 0) : 0;
      renderer.setRenderTarget(this.rts[i]); renderer.render(this.scene, this.cam); src = this.rts[i];
    }
    renderer.setRenderTarget(prevRT); renderer.autoClear = prevAC;
  }
}
export class FloorReflector {
  constructor(renderer, { y = 0.04, scale = 0.5 } = {}) {
    const s = renderer.getDrawingBufferSize(new THREE.Vector2()).multiplyScalar(scale); this.scale = scale;
    const w = Math.max(2, Math.round(s.x)), h = Math.max(2, Math.round(s.y));
    this.rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, depthTexture: new THREE.DepthTexture(w, h, THREE.UnsignedIntType) });
    this.cam = new THREE.PerspectiveCamera(); this.y = y; this.planeY = { value: y };
    this.textureMatrix = { value: new THREE.Matrix4() }; this.tex = { value: this.rt.texture }; this.depth = { value: this.rt.depthTexture };
    this.invProj = { value: new THREE.Matrix4() }; this.proj = { value: new THREE.Vector4(1, 1, w, h) };
    // log depth constant of the mirror camera (three's logDepthBufFC, 2 / log2(far + 1)), set each update
    this.logFC = { value: 2 / Math.log2(401) };
    // the lobe is read with textureGrad along its stretch axis: hardware anisotropic filtering spreads the long axis over
    // up to 8 probes at the mip level of the short one (five point taps at a sharp level drew stacked copies of bright
    // shapes, the stepped white blocks on the B080 mosaic in m56)
    this.rt.texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    // bound in place of the mirror while the mirror itself is drawn: a mesh that wears a floor material but is not
    // hidden (a ramp piece merged with floor) would otherwise read the target being written (a feedback loop)
    this.blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); this.blank.needsUpdate = true;
    this.meshes = [];
  }
  setSize(renderer) {
    const s = renderer.getDrawingBufferSize(new THREE.Vector2()).multiplyScalar(this.scale);
    const w = Math.max(2, Math.round(s.x)), h = Math.max(2, Math.round(s.y));
    if (w !== this.rt.width || h !== this.rt.height) this.rt.setSize(w, h);
  }
  // on = false: the mirror code switched off (unifyVariants, rr2_probes.js), so floor and non floor materials of one
  // structure share a program. A switched off material binds uFloorOn 0, which zeroes rrGate and skips the whole block
  // (the capture reflection stays exactly as it was), and black 1 x 1 stand ins for the mirror targets it never samples;
  // userData.floorReflect stays false, so collect() leaves it out of the mirror bookkeeping.
  patch(material, on = true) {
    const ud = material.userData;
    if (ud.floorCode) { if (on && !ud.floorReflect) { ud.floorReflect = true; material.needsUpdate = true; } return; }
    ud.floorCode = true; ud.floorReflect = on;
    const prev = material.onBeforeCompile, prevKey = material.customProgramCacheKey, self = this;
    material.onBeforeCompile = (sh, r) => {
      if (prev) prev.call(material, sh, r);
      const F = globalThis.RR_FLAGS || {};
      if (F.nocoat) sh.fragmentShader = '#define RR_NOCOAT\n' + sh.fragmentShader;
      // ?floordirect=1 keeps three's analytic lamp highlight on the mirrored floor (the m54 look), ?coatcap=x moves the coat cap
      if (F.floordirect) sh.fragmentShader = '#define RR_FLOORDIRECT\n' + sh.fragmentShader;
      // ?coatcap=x: luminance cap on the coat's mirror sample. Default 1000, above every glint sphere (point lamps 200 to 610),
      // so the coat mirrors each lamp disc at its true radiance (see the coat block below)
      sh.fragmentShader = '#define RR_COATCAP ' + (+(F.coatcap ?? 1000)).toFixed(3) + '\n' + sh.fragmentShader;
      // ?mirrortilt=x: largest per tile tilt (radians) the mirror lookup follows (default 0.035)
      sh.fragmentShader = '#define RR_TILTCAP ' + (+(F.mirrortilt ?? 0.035)).toFixed(4) + '\n' + sh.fragmentShader;
      // ?mirrorrmin=x: lowest roughness the mirror lobe uses (default 0.1, the middle of the plain floor's per tile range)
      // ?coattail=k: weight of the coat lobe's GGX tail rings (default 1; 0 is the m60 core only coat)
      sh.fragmentShader = '#define RR_COATTAIL ' + (+(F.coattail ?? 1)).toFixed(3) + '\n' + sh.fragmentShader;
      if (F.floorfix2) sh.fragmentShader = '#define RR_FF2CSIG ' + (+(F.ff2csig ?? 0.006)).toFixed(4) + '\n' + sh.fragmentShader;
      sh.fragmentShader = '#define RR_MIRROR_RMIN ' + (+(F.mirrorrmin ?? 0.1)).toFixed(3) + '\n' + sh.fragmentShader;
      // &floorfix=1 (issue 7, floor sheets): the base lobe's GGX tail rings follow each tile's own roughness, not the
      // lifted RR_MIRROR_RMIN one, and the coat tail is halved. A tile at roughness 0.04 (alpha 0.0016) has a GGX tail about 6 times
      // narrower than the 0.1 lobe the mirror reads, so the rings at 2.8 and 8 footprints spread each lamp glint into a
      // wide pale sheet that Cycles does not have (m90: the black mosaic diamonds 1.6 to 3.2 times the 360s in linear,
      // B071, B075, B082 ny; Ryan's photos show crisp streaks). Both changes are spliced in below only with the flag on,
      // so the flag off source is unchanged.
      const liveB = !!material.userData.floorReflect;
      if (F.floorblur) {
        sh.fragmentShader = '#define RR_FLOORBLUR\n#define RR_FB_K ' + (+(F.floorblurk ?? 1)).toFixed(3) + '\n#define RR_FB_MIN ' + (+(F.floorblurmin ?? 0.6)).toFixed(3) + '\n' + sh.fragmentShader;
        const fb = self.blur || (self.blur = new FloorBlurPyramid());
        for (let i = 0; i < FB_LEVELS; i++) sh.uniforms['tFB' + (i + 1)] = liveB ? fb.tex[i] : floorBlack();
      }
      const live = !!material.userData.floorReflect; sh.uniforms.uFloorOn = live ? FLOOR_ON : FLOOR_OFF;
      sh.uniforms.tFloorRefl = live ? self.tex : floorBlack(); sh.uniforms.tFloorDepth = live ? self.depth : floorBlack(); sh.uniforms.floorReflMatrix = self.textureMatrix;
      sh.uniforms.floorReflInvProj = self.invProj; sh.uniforms.floorReflP = self.proj; sh.uniforms.floorReflY = self.planeY; sh.uniforms.floorReflLogFC = self.logFC;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vFloorWP;')
        .replace('#include <fog_vertex>', '#include <fog_vertex>\n  vFloorWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vFloorWP; uniform sampler2D tFloorRefl; uniform sampler2D tFloorDepth; uniform mat4 floorReflMatrix; uniform mat4 floorReflInvProj;
uniform float floorReflY, uFloorOn, floorReflLogFC; uniform vec4 floorReflP; // projection P[0], P[5] of the mirror camera, mirror target width and height
vec3 rrFloorTap(vec2 uv, vec2 gx, vec2 gy) { return textureGrad(tFloorRefl, clamp(uv, vec2(0.0005), vec2(0.9995)), gx, gy).rgb; }
// share of the reflected path that lies behind the floor: 0 where the reflected thing touches the floor, about 0.75
// for the ceiling lamps seen from eye height
float rrFloorT(vec2 uv, float dC) {
  float d = textureLod(tFloorDepth, clamp(uv, vec2(0.0005), vec2(0.9995)), 0.0).x; // explicit level: this runs inside the floor branch
  if (d > 0.99999) return 1.0;
  #ifdef USE_LOGDEPTHBUF
  // the viewer runs a logarithmic depth buffer (rr2_player.js): the mirror pass wrote log2(1 + w) * floorReflLogFC * 0.5,
  // w the view depth, not a projective depth. Read through the inverse projection it gave a nearly constant t of about
  // 0.3 (lamps on ny want 0.71, a wall 1 m up 0.38, and on the side faces at grazing view t fell to 0.01 to 0.13): the
  // mirror stayed sharp at mid distance and on every side face in m56
  float w = exp2(2.0 * d / floorReflLogFC) - 1.0;
  vec2 ndc = uv * 2.0 - 1.0;
  float D = w * length(vec3(ndc.x / floorReflP.x, ndc.y / floorReflP.y, 1.0));
  #else
  vec4 p = floorReflInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  float D = length(p.xyz / p.w);
  #endif
  return clamp((D - dC) / max(D, 1e-3), 0.0, 1.0);
}
// one GGX lobe of angular sigma s (radians, as seen from the camera) on the mirror image: ax is the stretch axis on
// screen, NoV narrows the spread across it; tw = weights of the two GGX tail rings (0 0: core only)
#ifdef RR_FLOORBLUR
uniform sampler2D tFB1, tFB2, tFB3, tFB4;
vec3 rrFBLevel(vec2 uv, int i) {
  if (i <= 0) return textureLod(tFloorRefl, uv, 0.0).rgb;
  if (i == 1) return textureLod(tFB1, uv, 0.0).rgb;
  if (i == 2) return textureLod(tFB2, uv, 0.0).rgb;
  if (i == 3) return textureLod(tFB3, uv, 0.0).rgb;
  return textureLod(tFB4, uv, 0.0).rgb;
}
// pyramid read at a fractional level: level i holds a blur about 2^i mirror texels wide
vec3 rrFBTap(vec2 uv, float lv) {
  uv = clamp(uv, vec2(0.0005), vec2(0.9995)); lv = clamp(lv, 0.0, 4.0);
  float i0 = floor(lv), f = lv - i0;
  vec3 a = rrFBLevel(uv, int(i0));
  return f > 0.001 ? mix(a, rrFBLevel(uv, int(i0) + 1), f) : a;
}
// the same GGX lobe as below, read from the Kawase pyramid: the level follows the narrow (across) width, three taps
// spread the long axis, the tail rings sit 1.5 and 3 levels up. Weights sum to one, so the energy is unchanged.
vec3 rrFloorLobe(vec2 uv, vec2 ax, float s, float NoV, vec2 tw) {
  vec2 kp = 0.5 * floorReflP.xy;
  s *= RR_FB_K;
  vec2 dv = kp * ax * s;
  float iso = smoothstep(0.86, 0.97, NoV);
  float wAcross = length(kp * s * mix(NoV, 1.0, iso) * floorReflP.zw);
  // level i of the pyramid has a sigma of about 0.8 x 2^i mirror texels
  // the taps along the stretch sit 0.9 sigma apart: the level never goes so sharp that they separate (each tap at least
  // 0.6 of the along sigma wide), or a lamp glint draws as two or three stacked dots
  float wAlong = length(dv * floorReflP.zw);
  float lv = max(max(log2(max(wAcross, 1e-4) / 0.8), log2(max(0.6 * wAlong, 1e-4) / 0.8)), RR_FB_MIN);
  vec2 dp = vec2(-ax.y, ax.x) * length(dv);
  vec3 c0 = rrFBTap(uv, lv);
  vec3 c = 0.5 * c0 + 0.25 * (rrFBTap(uv + 0.9 * dv, lv) + rrFBTap(uv - 0.9 * dv, lv));
  if (iso > 0.001) c = mix(c, 0.5 * c0 + 0.125 * (rrFBTap(uv + 0.9 * dv, lv) + rrFBTap(uv - 0.9 * dv, lv) + rrFBTap(uv + 0.9 * dp, lv) + rrFBTap(uv - 0.9 * dp, lv)), iso);
  if (tw.x + tw.y > 0.0) {
    // ring taps on the same two directions as the textureGrad path (d1 and d2 mirror each other about ax): with
    // uv +/- 1.5 d1 both taps sat on one diagonal and at straight down views the halo drew as a diagonal bar
    vec2 d1 = mix(dv, dp, 0.5 * iso), d2 = mix(dv, -dp, 0.5 * iso), e1 = mix(dv, dp, iso);
    vec3 t1 = 0.5 * (rrFBTap(uv + 1.5 * d1, lv + 1.5) + rrFBTap(uv - 1.5 * d2, lv + 1.5));
    vec3 t2 = 0.5 * (rrFBTap(uv + 3.0 * dv, lv + 3.0) + rrFBTap(uv - 3.0 * e1, lv + 3.0));
    c = (1.0 - tw.x - tw.y) * c + tw.x * t1 + tw.y * t2;
  }
  return c;
}
#else
vec3 rrFloorLobe(vec2 uv, vec2 ax, float s, float NoV, vec2 tw) {
  vec2 kp = 0.5 * floorReflP.xy;
  vec2 dv = kp * ax * s, dh = kp * vec2(-ax.y, ax.x) * s * NoV;
  // each tap is an elliptical footprint 2.4 sigma long and 3 sigma wide (textureGrad, anisotropic): three taps 0.9 sigma
  // apart then overlap, so the lobe is continuous (sigma about 0.95 s along, 0.87 s * NoV across) at any stretch; the
  // footprint never drops under one mirror texel, which keeps a sharp lobe exactly as sharp as the target allows
  vec2 tx = 1.0 / floorReflP.zw;
  vec2 gv = dv * 2.4, gh = dh * 3.0;
  gv = length(gv * floorReflP.zw) < 1.0 ? ax * tx : gv;
  gh = length(gh * floorReflP.zw) < 1.0 ? vec2(-ax.y, ax.x) * tx : gh;
  // polish (m60 audit): looking (nearly) straight down there is no stretch, and the axis (the view space normal's xy)
  // falls back to (0, 1) at the face centre: the taps and the tail rings strung along it drew every lamp pool as a
  // bar (B073 ny). iso blends to a round lobe: the same taps along ax plus the same along its perpendicular, with
  // round footprints (the larger of the two widths on both axes)
  float iso = smoothstep(0.86, 0.97, NoV);
  vec2 dp = vec2(-ax.y, ax.x) * length(dv);
  float gr = max(length(gv), length(gh)); vec2 gvi = mix(gv, ax * gr, iso), ghi = mix(gh, vec2(-ax.y, ax.x) * gr, iso);
  vec3 c0 = rrFloorTap(uv, ghi, gvi);
  vec3 c = 0.5 * c0 + 0.25 * (rrFloorTap(uv + 0.9 * dv, ghi, gvi) + rrFloorTap(uv - 0.9 * dv, ghi, gvi));
  if (iso > 0.001) c = mix(c, 0.5 * c0 + 0.125 * (rrFloorTap(uv + 0.9 * dv, ghi, gvi) + rrFloorTap(uv - 0.9 * dv, ghi, gvi)
    + rrFloorTap(uv + 0.9 * dp, ghi, gvi) + rrFloorTap(uv - 0.9 * dp, ghi, gvi)), iso);
  if (tw.x + tw.y > 0.0) {
    // GGX halo: two wider rings, footprints scaled like the old lod + 1.5 and lod + 3; on the round lobe the ring taps
    // alternate between the two axes (two along ax, two across), so the halo is a ring, not a bar
    vec2 d1 = mix(dv, dp, 0.5 * iso), d2 = mix(dv, -dp, 0.5 * iso);
    vec2 e1 = mix(dv, dp, iso);
    vec3 t1 = 0.5 * (rrFloorTap(uv + 1.5 * d1, ghi * 2.8, gvi * 2.8) + rrFloorTap(uv - 1.5 * d2, ghi * 2.8, gvi * 2.8));
    vec3 t2 = 0.5 * (rrFloorTap(uv + 3.0 * dv, ghi * 8.0, gvi * 8.0) + rrFloorTap(uv - 3.0 * e1, ghi * 8.0, gvi * 8.0));
    c = (1.0 - tw.x - tw.y) * c + tw.x * t1 + tw.y * t2;
  }
  return c;
}
#endif`)
        .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
  {
    // only up facing pieces at floor level take the mirror (a floor material may also sit on a ramp or a wall)
    // (a floor material on a ramp, a stair, the lower hall 0.6 m down or a wall keeps the capture reflection: the planar
    // mirror is only right at its own height)
    vec3 rrWN = (vec4(nonPerturbedNormal, 0.0) * viewMatrix).xyz;
    float rrGate = uFloorOn * step(0.9, rrWN.y) * step(abs(vFloorWP.y - floorReflY), 0.05);${F.ff2dbg ? `
    // &ff2dbg=1 (diagnostic only): red = a floor material pixel that fails the mirror gate (normal not up or off the plane
    // height), green = mirror weight k, blue = bevel share rrBev. A floor with no tint at all is not patched (no mirror material)
    reflectedLight.indirectDiffuse += vec3(1.0 - rrGate, 0.0, 0.0) * 2.0;` : ''}
    if (rrGate > 0.5) {
    vec4 rc = floorReflMatrix * vec4(vFloorWP, 1.0);
    vec2 uv0 = rc.xy / rc.w;
    float dC = length(vViewPosition);
    float NoV = clamp(dot(nonPerturbedNormal, normalize(vViewPosition)), 0.05, 1.0);
    vec2 ax = nonPerturbedNormal.xy; float axl = length(ax); ax = axl > 1e-3 ? ax / axl : vec2(0.0, 1.0);
    float rough = clamp(roughnessFactor, 0.0, 1.0);
    // the plain floor's per tile roughness (rr_rr 0.04 to 0.16, alpha 0.0016 to 0.026: a 16x range of blur) broke each
    // reflection into sharp and soft tiles along the grout (B000 nx, B080 px in m56), where the 360s show one soft
    // continuous blur; the lobe takes at least the range's middle, the shading keeps each tile's own roughness
    float rM = max(rough, RR_MIRROR_RMIN);
    float sB = 1.1 * max(rM * rM, 0.002);
    // contact hardening: the behind-the-floor share averaged over the widest footprint this lobe can have, so the blur
    // changes smoothly across a reflected silhouette instead of stepping (no outlines)
    vec2 rS = 0.5 * floorReflP.xy * clamp(sB, 0.004, 0.06);
    float t = 0.2 * (rrFloorT(uv0, dC) + rrFloorT(uv0 + vec2(rS.x, 0.0), dC) + rrFloorT(uv0 - vec2(rS.x, 0.0), dC) + rrFloorT(uv0 + vec2(0.0, rS.y), dC) + rrFloorT(uv0 - vec2(0.0, rS.y), dC));
    // the per-tile tilt and relief (Ryan's rr_tilt, up to 1.2 degrees per tile) turn the reflected ray: trace it to the
    // reflected depth and take where that lands on screen (the old normal.xz * 0.02 offset was the view-space normal
    // itself, which moved every reflection by about 1.4 % of the screen when looking down and kept reflected bases from
    // meeting their walls)
    vec3 rrP = -vViewPosition, rrI = normalize(rrP), rrN0 = nonPerturbedNormal;
    float rrL = dC * min(t, 0.98) / (1.0 - min(t, 0.98));
    vec3 rrQ0 = rrP + rrI * rrL;
    vec2 rrQ0s = rrQ0.xy / max(-rrQ0.z, 1e-3);
    // only the gentle part of the relief is traced (up to 0.035 rad, twice Ryan's rr_tilt): a grout or mosaic bump bevel
    // (Bump strength 0.35: 10 to 40 degrees) turned the ray so far that the 0.1 clamp below caught it, and each joint
    // drew a dashed line of whatever bright thing sat 10 % of the screen away (the white dashes along the grout in m56,
    // B080 px). Those steep pixels leave the mirror instead (rrBev) and keep the capture.
    vec3 rrDn = normal - rrN0 * dot(normal, rrN0); float rrDl = length(rrDn);
    float rrBev = smoothstep(0.06, 0.2, rrDl);
    vec3 rrNt = normalize(rrN0 + rrDn * (min(rrDl, RR_TILTCAP) / max(rrDl, 1e-5)));
    vec3 rrR = reflect(rrI, rrNt); rrR -= 2.0 * dot(rrR, rrN0) * rrN0; vec3 rrQ1 = rrP + rrR * rrL;
    ${F.floorfix2 ? `// floorfix2: the traced tilt offset saturates softly instead of at a hard 0.1 clamp (a clamp edge drew straight light and
    // dark cut lines across the tiles where a tilted tile's ray ran past it; tanh keeps the 0.1 limit and the slope at 0),
    // and only the tilt offset fades out over the last 6 % of the mirror target, so a tilted ray can not reach past the
    // target edge (things just outside the view were cut off as a hard line on the floor, S50y060p00) while the mirror
    // itself keeps its 1 % edge fade on uv0 (revA: a 6 % fade of the whole mirror dimmed the floor along the frame)
    float rrEdgeD = min(min(uv0.x, 1.0 - uv0.x), min(uv0.y, 1.0 - uv0.y));
    vec2 rrOff = 0.5 * floorReflP.xy * (rrQ1.xy / max(-rrQ1.z, 1e-3) - rrQ0s); rrOff = 0.1 * tanh(rrOff * 10.0);
    vec2 ruv = uv0 + rrOff * smoothstep(0.0, 0.06, rrEdgeD);
    float edge = smoothstep(0.0, 0.01, rrEdgeD);` : `vec2 ruv = uv0 + clamp(0.5 * floorReflP.xy * (rrQ1.xy / max(-rrQ1.z, 1e-3) - rrQ0s), vec2(-0.1), vec2(0.1));
    float edge = smoothstep(0.0, 0.01, min(min(ruv.x, 1.0 - ruv.x), min(ruv.y, 1.0 - ruv.y)));`}
    // the plain floor's per-tile roughness range (0.04 to 0.16) and the mosaics (0.22) sit well under the cutoff, so every
    // tile reflects and the tile to tile variation stays as subtle as in Cycles
    float kD = (1.0 - smoothstep(0.3, 0.6, rough)) * edge * rrGate;
    float k = kD * (1.0 - rrBev);${F.ff2dbg ? `
    reflectedLight.indirectDiffuse += vec3(0.0, k, rrBev) * 2.0;` : ''}
    ${F.floorfix ? `// floorfix: the tail share follows alpha of the tile's own roughness over the lobe's (rough 0.04: 0.16 of the rings; 0.1 and up: all)
    vec2 rrTw = vec2(0.2, 0.1) * clamp((rough * rough) / max(rM * rM, 1e-4), 0.0, 1.0);
    radiance = mix(radiance, rrFloorLobe(ruv, ax, sB * t, NoV, rrTw), k);` : `radiance = mix(radiance, rrFloorLobe(ruv, ax, sB * t, NoV, vec2(0.2, 0.1)), k);`}${F.floorfix2 ? `
    // floorfix2 (grout sparkle: dotted white joints in every far floor view of the Oct 14 sweep): the steep bevel pixels
    // (rrBev) took the capture along the bumped normal, 10 to 40 degrees off, so each joint pixel showed whatever bright
    // thing sat that far round the cube (skylight, coves) and the joints beaded white. Cycles averages the bevel over the
    // pixel, so a joint reads as a thin, slightly darker line of the same reflection. Here the bevel pixels take the flat
    // normal mirror at three times the lobe width, at 0.7 strength (a joint is a little duller than the polished face).
    // (revA: skipped where no bevel shows, it is a full extra lobe; it takes the tile's tail share rrTw under floorfix)
    if (kD * rrBev > 0.001) radiance = mix(radiance, 0.7 * rrFloorLobe(uv0, ax, 3.0 * sB * t, NoV, ${F.floorfix ? 'rrTw' : 'vec2(0.2, 0.1)'}), kD * rrBev);` : ''}
    // the mirror holds every lamp as a glint of its true size and radiance (addLampGlints), so the analytic highlight of
    // the same lamps (point lights of zero size: 2 to 4 px pin dots) is dropped on every mirrored floor pixel, the steep
    // grout and joint bevels included (rrBev: they take the capture there, not the mirror). m58 kept it wherever the
    // shading normal was bumped, for the star sparkles of the 360s, but the floors that show those sparkles have no bump
    // at all (rr_del_field and rr_del_rose at B080/B084: Roughness 0.22, Coat 0.2 at 0.05, no Bump node): the sparkles are
    // the lamp discs in the sharp coat, which the coat cap removed. On rr_plain_floor (Bump 0.35 at the grout) the kept
    // point light highlight drew the bright dashes along the grout (B080 px in m58).
    #ifndef RR_FLOORDIRECT
    reflectedLight.directSpecular *= 1.0 - kD;
    #endif
    #if defined( USE_CLEARCOAT ) && !defined( RR_NOCOAT )
    // the clear coat (Blender Coat Weight, glTF clearcoat) is the sharp mirror layer of the polished floors in Cycles:
    // it reflects the planar mirror at its own roughness instead of the capture cube
    {
      float cr = clamp(material.clearcoatRoughness, 0.0, 1.0);
      // the coat's normal is the geometric one (Blender Coat Normal unlinked on every floor, three's clearcoatNormal), so a
      // bump bevel does not turn it: the coat mirrors on the grout too. Gated by rrBev in m58, the grout pixels kept the
      // coat's analytic point light highlight at roughness 0.05: a sharp dash wherever a grout line crossed a lamp pool
      float kc = 0.95 * edge * rrGate;
      vec3 rrC = reflect(rrI, clearcoatNormal); rrC -= 2.0 * dot(rrC, rrN0) * rrN0; vec3 rrQc = rrP + rrC * rrL;
      vec2 cuv = uv0 + clamp(0.5 * floorReflP.xy * (rrQc.xy / max(-rrQc.z, 1e-3) - rrQ0s), vec2(-0.1), vec2(0.1));
      // Cycles: the coat (weight 0.2, roughness 0.05 on rr_del_field, rr_del_rose, rr_plain_floor) mirrors each lamp disc
      // almost sharply: at the ny view F is about 0.04, so 0.2 x 0.04 x 560 (the median point lamp radiance) is about 4.5
      // linear, display 245 and up: the bright cores of the lamp pools and the sparkles on the B080 / B084 mosaics
      // (reference: about 2000 to 3000 ny pixels over 235 per spot). The old cap of 4 removed all of them (m58: B080 0,
      // B084 0). The cap now only guards against stray emitters brighter than any lamp.
      // polish (m60 audit): the coat lobe had no tail, so each lamp disc came out as a hard 3 to 5 px pin (B080 ny); the
      // reference shows a soft core about 8 px across in a glow of about 25 px radius (its 4096 grade's bloom on a
      // larger saturated core). GGX at alpha a puts a share a^2 / (a^2 + (phi / 2)^2) of the lobe past the reflected
      // angle phi: about 15 % past 5 a and 3 % past 12 a, so the coat takes two tail rings 0.13 and 0.05 (footprints
      // about 7 and 19 sigma). The sigma also gets a floor of 1.5 mirror texels' worth of angle (0.003 rad), so the disc
      // edge is not sharper than the half resolution mirror can hold (the pin look). ?coattail=k scales both rings.
      ${F.floorfix2 ? `// floorfix2: the coat core is at least RR_FF2CSIG (default 0.006 rad, about 3 mirror texels): a cove LED strip one
      // half resolution texel thick was mirrored as a sharp beaded line across the mosaics (S38y120p00, S26y000p00, S32y000p00)
      float csig = max(1.1 * max(cr * cr, 0.002) * t, RR_FF2CSIG * t);` : `float csig = max(1.1 * max(cr * cr, 0.002) * t, 0.003 * t);`}
      vec3 cs = rrFloorLobe(cuv, ax, csig, NoV, ${F.floorfix ? '0.5 * ' : ''}RR_COATTAIL * vec2(0.13, 0.05));
      cs *= min(1.0, RR_COATCAP / max(dot(cs, vec3(0.2126, 0.7152, 0.0722)), 1e-4));
      clearcoatRadiance = mix(clearcoatRadiance, cs, kc);
      #ifndef RR_FLOORDIRECT
      clearcoatSpecularDirect *= 1.0 - kc;
      #endif
    }
    #endif
    }
  }`);
    };
    material.customProgramCacheKey = () => { const F = globalThis.RR_FLAGS || {}; return (prevKey ? prevKey.call(material) : '') + '|floorrefl12' + (F.nocoat ? 'nc' : '') + (F.floordirect ? 'fd' : '') + (F.coatcap ?? 1000) + '_' + (F.mirrortilt ?? 0.035) + '_' + (F.coattail ?? 1) + (F.floorblur ? 'fb' + (F.floorblurk ?? 1) + '_' + (F.floorblurmin ?? 0.6) : '') + (F.floorfix ? 'ff1' : '') + (F.floorfix2 ? 'ffx2_' + (+(F.ff2csig ?? 0.006)).toFixed(4) : '') + (F.ff2dbg ? 'dbg' : ''); };
    material.needsUpdate = true;
  }
  // Lamp glints for the mirror only. Cycles lamps have a size (radius 0.06 m on the corridor downlights, 0.04 to 0.05 on
  // others) and are visible in glossy reflections, so on the polished floor each lamp becomes a pool of light (the 360s
  // show them under every downlight). Each lamp is drawn here as an emitter of its true Cycles radiance (point and spot:
  // P / 4pi / (pi r^2); area: P / (pi A)) on a layer only the mirror camera sees; the mirror's roughness blur then
  // spreads it into the pool. ?glint=k scales them (default 1, physical).
  // A lamp of radius 0 (about 120 spots) used to become a 2 cm sphere: under one texel of the half resolution mirror,
  // so it was rasterised or skipped pixel by pixel (flicker, a bright speck or nothing). Small lamps are drawn at least
  // 5 cm across at the same power (radiance scaled by the area), which the GGX blur spreads the same way.
  addLampGlints(scene, lights, k = 1) {
    const C = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1);
    const pts = [], areas = [];
    for (const l of lights) { if (l.type === 'SUN') continue;
      const M = C.clone().multiply(new THREE.Matrix4().fromArray(l.matrix.flat()).transpose());
      const pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3(); M.decompose(pos, q, sc);
      if (pos.y < 1.5) continue;
      const P = l.energy * ((l.node_strength && l.node_strength[0]) ?? 1) * k, col = new THREE.Color(l.color[0], l.color[1], l.color[2]);
      if (l.type === 'AREA') { const w = l.size || 1, h = (l.shape === 'RECTANGLE' || l.shape === 'ELLIPSE') ? (l.size_y || w) : w;
        const A = (l.shape === 'DISK' || l.shape === 'ELLIPSE') ? Math.PI * w * h / 4 : w * h;
        areas.push({ pos, q, w, h, c: col.multiplyScalar(P / (Math.PI * A)) }); }
      else { const r = Math.max(l.radius ?? 0.1, 0.05); pts.push({ pos, r, c: col.multiplyScalar(P / (4 * Math.PI) / (Math.PI * r * r)) }); } }
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, side: THREE.DoubleSide, fog: false });
    const m4 = new THREE.Matrix4(), one = new THREE.Quaternion();
    if (pts.length) { const im = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 6), mat, pts.length);
      pts.forEach((p, i) => { im.setMatrixAt(i, m4.compose(p.pos, one, new THREE.Vector3(p.r, p.r, p.r))); im.setColorAt(i, p.c); });
      im.layers.set(7); im.frustumCulled = false; im.name = 'lamp_glints'; scene.add(im); }
    if (areas.length) { const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, areas.length);
      areas.forEach((a, i) => { im.setMatrixAt(i, m4.compose(a.pos, a.q, new THREE.Vector3(a.w, a.h, 1))); im.setColorAt(i, a.c); });
      im.layers.set(7); im.frustumCulled = false; im.name = 'lamp_glints_area'; scene.add(im); }
    this.glints = { points: pts.length, areas: areas.length };
  }
  // the meshes hidden while the mirror is drawn: the flat floor-level pieces that sample it (a floor sheet above the
  // mirror plane would cover it). Every other mesh wearing a floor material stays in the reflection: the old list hid
  // all of them, and a floor material also sits on walls, frames and ceilings (cl_mt_limestone on 102 of Matteo's wall
  // pieces, mt_steel on 79 frames, gjl_black on 122, the Material_109 ceiling sheets Mesh_1662 and Mesh_2241 at 5 m:
  // 18 of the 56 floor materials in m54), so those vanished from the floor reflection and it showed whatever stood
  // behind them. Their floor-level faces are under the oblique near plane anyway; while the mirror is drawn they read a
  // blank texture instead of the target being written.
  // A taller mesh that still has up-facing floor faces above the mirror plane (a merged cell or a chunk of an original
  // building mesh) would cover the reflection there, so it stays hidden as before.
  // m58 hid every low piece wearing a floor material (bounding box under 15 cm): baseboards, kick plates, the storefront
  // bases and thresholds vanished from the mirror, which showed what stood behind them (the over bright strip along the
  // B073 storefront base). Now only flat pieces are hidden: most of their area faces up or down within 5 cm of the plane.
  collect(root) {
    const set = new Set(this.meshes), bb = new THREE.Box3();
    root.traverse(o => { if (!o.isMesh || !o.material?.userData?.floorReflect || set.has(o)) return; bb.setFromObject(o);
      if (bb.min.y > 0.15) return;
      const f = this.flatShare(o);
      if ((bb.max.y < 0.15 && f.total > 0 && f.flat > 0.5 * f.total) || this.hasFloorAbove(o)) set.add(o); });
    this.meshes = [...set];
    return this.meshes.length;
  }
  // area of the mesh's horizontal faces (either winding) lying within 5 cm of the mirror plane, and its whole area, m2
  flatShare(o) {
    const g = o.geometry, pos = g?.attributes?.position, idx = g?.index; if (!pos) return { flat: 0, total: 0 };
    o.updateMatrixWorld(); const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
    const cnt = idx ? idx.count : pos.count; let flat = 0, total = 0;
    for (let t = 0; t + 2 < cnt; t += 3) {
      a.fromBufferAttribute(pos, idx ? idx.getX(t) : t).applyMatrix4(o.matrixWorld);
      b.fromBufferAttribute(pos, idx ? idx.getX(t + 1) : t + 1).applyMatrix4(o.matrixWorld); c.fromBufferAttribute(pos, idx ? idx.getX(t + 2) : t + 2).applyMatrix4(o.matrixWorld);
      const lv = Math.abs(a.y - this.y) < 0.05 && Math.abs(b.y - this.y) < 0.05 && Math.abs(c.y - this.y) < 0.05;
      n.subVectors(b, a).cross(c.sub(a)); const l = 0.5 * n.length(); total += l;
      if (lv && Math.abs(n.y) > 0.9 * 2 * l) flat += l;
    }
    return { flat, total };
  }
  hasFloorAbove(o) {
    const g = o.geometry, pos = g.attributes.position, idx = g.index; if (!pos) return false;
    o.updateMatrixWorld(); const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
    const cnt = idx ? idx.count : pos.count, y0 = this.y + 0.001, yT = this.y + 0.03; let area = 0;
    for (let t = 0; t + 2 < cnt; t += 3) {
      // floor sheets end at 0.074 (coplanar pass): only up facing faces up to 3 cm above the plane count, so the top edge
      // of a baseboard or kick plate (10 cm and up) no longer hides the whole piece from the mirror
      a.fromBufferAttribute(pos, idx ? idx.getX(t) : t).applyMatrix4(o.matrixWorld); if (a.y < y0 || a.y > yT) continue;
      b.fromBufferAttribute(pos, idx ? idx.getX(t + 1) : t + 1).applyMatrix4(o.matrixWorld); c.fromBufferAttribute(pos, idx ? idx.getX(t + 2) : t + 2).applyMatrix4(o.matrixWorld);
      if (b.y < y0 || b.y > yT || c.y < y0 || c.y > yT) continue;
      n.subVectors(b, a).cross(c.sub(a)); const l = n.length(); if (l > 0 && Math.abs(n.y) > 0.9 * l) area += 0.5 * l;
      if (area > 0.05) return true;
    }
    return false;
  }
  // link agent (Oct 14), &linkpoll=1: the programs only the mirror pass uses (the layer 7 lamp glints and, with
  // ?floorblur=1, the pyramid's filter) are compiled into the mirror's own targets before the first frame; the
  // materials come back so the caller can wait on their links
  precompileExtras(renderer, scene, camera) {
    const mats = [], prevRT = renderer.getRenderTarget(), px = new THREE.Scene(), vc = this.cam; vc.copy(camera); vc.layers.enable(7);
    scene.traverse(o => { if (!o.isMesh || o.layers.mask !== (1 << 7)) return;
      const q = o.isInstancedMesh ? new THREE.InstancedMesh(o.geometry, o.material, 1) : new THREE.Mesh(o.geometry, o.material);
      if (o.instanceColor) q.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(3), 3);
      q.matrixAutoUpdate = false; q.matrixWorld.copy(o.matrixWorld); q.frustumCulled = false; px.add(q); mats.push(o.material); });
    renderer.setRenderTarget(this.rt); if (px.children.length) renderer.compile(px, vc, scene);
    // the pyramid as live FloorBlurPyramid has it (there is no blurMaterials()): one ShaderMaterial (mat) on one quad in
    // its own scene and ortho camera, drawn by run() into rts[0..3], all the same half float format, so one program
    // compiled into rts[0] serves every level. update() makes the same this.blur on its first floorblur frame.
    if ((globalThis.RR_FLAGS || {}).floorblur) { const b = this.blur || (this.blur = new FloorBlurPyramid()); b.size(this.rt.width, this.rt.height);
      if (b.mat && b.scene && b.cam && b.rts[0]) { renderer.setRenderTarget(b.rts[0]); renderer.compile(b.scene, b.cam); mats.push(b.mat); } }
    renderer.setRenderTarget(prevRT); return mats;
  }
  update(renderer, scene, camera) {
    const n = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(0, this.y, 0);
    const cp = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    if (cp.y < this.y) return;
    const vc = this.cam; vc.copy(camera); vc.layers.enable(7);
    const view = cp.clone(); view.y = 2 * this.y - view.y;
    const look = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion); look.y = -look.y;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion); up.y = -up.y;
    vc.position.copy(view); vc.up.copy(up); vc.lookAt(view.clone().add(look)); vc.updateMatrixWorld();
    vc.projectionMatrix.copy(camera.projectionMatrix); this.logFC.value = 2.0 / Math.log2(vc.far + 1.0);
    this.textureMatrix.value.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(vc.projectionMatrix).multiply(vc.matrixWorldInverse);
    // oblique near plane at the floor so nothing below it leaks into the reflection
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, p).applyMatrix4(vc.matrixWorldInverse);
    const cl = new THREE.Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant); const P = vc.projectionMatrix.elements;
    const q = new THREE.Vector4((Math.sign(cl.x) + P[8]) / P[0], (Math.sign(cl.y) + P[9]) / P[5], -1, (1 + P[10]) / P[14]);
    cl.multiplyScalar(2 / cl.dot(q)); P[2] = cl.x; P[6] = cl.y; P[10] = cl.z + 1 - 0.003; P[14] = cl.w;
    // the depth read back in the floor shader goes through this exact (oblique) projection
    // the mirror image is flipped left to right against the screen (a point moving right on screen moves left in the
    // mirror target), so the screen x scale is passed negative
    this.invProj.value.copy(vc.projectionMatrix).invert(); this.proj.value.set(-P[0], P[5], this.rt.width, this.rt.height);
    for (const m of this.meshes) m.visible = false;
    this.tex.value = this.blank; this.depth.value = this.blank;
    // the mirror target has no MSAA: cutouts take the plain alpha test here (BL_A2C, blender_material.js alphaCoverageGLSL).
    // ?mirrora2c=1 keeps the filtered alpha in the mirror too (the m61 to m65 look: holes written as solid surface)
    const a2c = BL_A2C.value; if (!(globalThis.RR_FLAGS || {}).mirrora2c) BL_A2C.value = 0;
    const prevRT = renderer.getRenderTarget(); renderer.setRenderTarget(this.rt); renderer.clear(); renderer.render(scene, vc); renderer.setRenderTarget(prevRT);
    BL_A2C.value = a2c;
    // ?floorblur=1: filter the fresh mirror down the Kawase pyramid the floor shader reads
    if ((globalThis.RR_FLAGS || {}).floorblur) (this.blur || (this.blur = new FloorBlurPyramid())).run(renderer, this.rt);
    this.tex.value = this.rt.texture; this.depth.value = this.rt.depthTexture;
    for (const m of this.meshes) m.visible = true;
  }
}
