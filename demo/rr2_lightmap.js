// rr2_lightmap.js (agent look, Oct 21; from agent light's Oct 16 module): RR_FLAGS.lm = 1 draws baked surfaces as
// base colour x Cycles lightmap, with no live lighting on them (no probes, cove lights, lamps or room gains), which is
// where the frame time and most of the shader work go on the Intel laptop.
// Data (W\bake lm.json, agent bake): { areas: { <area>: { atlas: 'lm/<area>_rgbm.png', meshes: [names], skip_materials:
//   { <mesh>: [material names kept as they are] } } }, decode: rgb * a * 8 (RGBM, NoColorSpace, flipY false), lightmap UVs in
//   TEXCOORD_1 (three uv1), exposure_scale }. A baked area needs its GLBs from data_lm (they carry uv1) in place of the plain ones.
// RR_FLAGS.lmareas: comma list of areas to switch on (default all in lm.json), so maps can go live area by area as they land.
// Each baked material is a copy of the real one (its Blender graph still makes the base colour, textures included) whose
// output is replaced by base colour x lightmap x exposure_scale; the live lighting code is then dead and the GPU compiler
// drops it. Floors with the mirror, glass, transmissive, transparent and metallic materials keep their own material.
import * as THREE from 'three';

const F = () => globalThis.RR_FLAGS || {};
export const lmOn = () => !!+(F().lm ?? 0);
const keepOwn = (m) => !m || !m.isMeshStandardMaterial || m.userData?.floorReflect || m.userData?.floorCode || m.userData?.glassT !== undefined || m.userData?.frostT || (m.transmission > 0) || m.transparent || (m.metalness ?? 0) >= 0.5;

export async function loadLightmaps(url) {
  const j = await (await fetch(url)).json(), base = url.replace(/[^/]*$/, ''), loader = new THREE.TextureLoader();
  // main 04:3x: atlases decode off the main thread as ImageBitmaps (the image element path decoded 22 atlases inside initTexture,
  // about 6 s of the ready time on the Intel laptop); premultiply and colour conversion off, RGBM needs the exact bytes
  const bml = (typeof createImageBitmap === 'function' && !F().lmimg) ? new THREE.ImageBitmapLoader().setOptions({ imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' }) : null;
  const want = String(F().lmareas ?? 'all').split(',').map(s => s.trim()).filter(Boolean), all = want.includes('all');
  const byName = new Map(), areas = {};
  const list = Object.entries(j.areas || {}).filter(([area]) => all || want.includes(area));
  const texs = await Promise.all(list.map(([, a]) => bml ? bml.loadAsync(base + a.atlas).then(b => new THREE.Texture(b)) : loader.loadAsync(base + a.atlas)));   // parallel downloads
  for (const [k, [area, a]] of list.entries()) {
    const t = texs[k];
    t.channel = 1; t.flipY = false; t.colorSpace = THREE.NoColorSpace; t.premultiplyAlpha = false; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.needsUpdate = true;
    areas[area] = { tex: t, meshes: (a.meshes || []).length };
    for (const nm of a.meshes || []) byName.set(nm, { area, tex: t, skip: new Set((a.skip_materials || {})[nm] || []) });
  }
  return { byName, areas, scale: +(j.exposure_scale ?? 1) };
}

function lmCopy(src, tex, scale) {
  const m = src.clone(); m.userData = { ...src.userData }; if (src.defines) m.defines = { ...src.defines };   // main 07:0x: own userData copy; sharing it flagged the unbaked original too (Milos reeded oak). fixlm 07:3x: the defines copy (USE_UV for Blender procedural graphs, which read vUv) had slipped into this comment; without it ~190 [lm] programs failed to compile and drew nothing (Milos oak see-through, sign, dome)
  const ob = src.onBeforeCompile, ok = src.customProgramCacheKey;
  m.lightMap = tex; m.lightMapIntensity = 1;
  m.onBeforeCompile = function (sh, r) { if (ob) ob.call(this, sh, r); sh.uniforms.uLmScale = { value: scale };
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uLmScale;')
      .replace('#include <opaque_fragment>', '{ vec4 rrLmT = texture2D( lightMap, vLightMapUv ); outgoingLight = diffuseColor.rgb * rrLmT.rgb * rrLmT.a * 8.0 * uLmScale + totalEmissiveRadiance' + (+(F().lmspec ?? 1) ? ' + reflectedLight.indirectSpecular' : '') + '; }\n#include <opaque_fragment>'); };
  m.customProgramCacheKey = function () { return (ok ? ok.call(this) : '') + '|rrlm' + (+(F().lmspec ?? 1) ? 's' : ''); };   // main 07:0x: env reflections kept on baked surfaces (lmspec=0 drops them)
  m.name = (src.name || 'm') + ' [lm]'; m.userData.lmBaked = true; return m;
}

// swaps the materials of every baked mesh (named in an enabled area, carrying uv1); returns a report
export function applyLightmaps(root, lm) {
  const cache = new Map(); const rep = { baked: 0, keptOwn: 0, noUv1: 0, materials: 0, areas: Object.keys(lm.areas) };
  root.traverse(o => { if (!o.isMesh) return; const e = lm.byName.get(o.userData.invName || o.name); if (!e) return;
    if (!o.geometry || !o.geometry.getAttribute('uv1')) { rep.noUv1++; return; }
    const one = (src) => { if (keepOwn(src) || e.skip.has(src.name)) { rep.keptOwn++; return src; } const k = src.uuid + '|' + e.tex.uuid; let m = cache.get(k); if (!m) { m = lmCopy(src, e.tex, lm.scale); cache.set(k, m); } return m; };
    o.material = Array.isArray(o.material) ? o.material.map(one) : one(o.material); rep.baked++; });
  rep.materials = cache.size; return rep;
}
