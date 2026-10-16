// Scene assembly for the code build: Blender materials onto the exported meshes.
import * as THREE from 'three';
import { BlenderMaterialCompiler, applyBlenderGraph, addBlenderAttributes, principledExtras } from './blender_material.js';
import { bitmapTexture, queuedFetch, PRI } from './rr2_assets.js';

// one texture per image file across all areas (areas share most Blender images; loading them per area tripled the
// GPU uploads)
const TEX_BY_URL = new Map();
let DEFAULT_SURFACE = null; // shared stand in for faces in an empty material slot with no sibling material (see compileAndApply)
export async function compileAndApply(root, extra, areaUrl, { mode = 'full', ktx2 = null, priority = PRI.area } = {}) {
  // per-tile variation kept (Ryan 14:16: it adds realism); evenFloorTiles below stays available but is not called
  const texCache = new Map(); const loader = new THREE.TextureLoader(); const pending = [];
  const imageLookup = (name, node) => {
    const info = extra.images?.[name];
    if (!info || !info.file) return null;
    const key = name;
    if (texCache.has(key)) return texCache.get(key);
    // info.url: an image replaced by the viewer (rr2_signfix.js, RR_FLAGS.signfix), else the area's own file
    const url = info.url || new URL(areaUrl + '/' + info.file, location.href).href;
    const ext0 = node?.extension || 'REPEAT', ukey = url + '|' + ext0 + '|' + (info.noncolor ? 'n' : 'c') + '|' + (node?.interpolation || '');
    if (TEX_BY_URL.has(ukey)) { const t0 = TEX_BY_URL.get(ukey); if (t0.userData.ready) pending.push(t0.userData.ready); texCache.set(key, t0); return t0; }
    let t;
    if (info.file.endsWith('.ktx2') && ktx2 && !info.url) {
      // KTX2 images are stored pre-flipped by the build (compressed textures cannot be flipped on upload)
      t = new THREE.Texture(); const holder = t; const keep = t.userData.ktxKeep = {};
      pending.push(new Promise(r => ktx2.load(areaUrl + '/' + info.file, (ct) => { holder.copy(ct); holder.source = ct.source; holder.mipmaps = ct.mipmaps; holder.format = ct.format; holder.type = ct.type; holder.isCompressedTexture = true;
        // Texture.copy also took the loader's wrap, colour space and anisotropy (1): put back the values set below for this node
        Object.assign(holder, keep); holder.needsUpdate = true; r(); }, undefined, () => r())));
      t.flipY = false;
    } else {
      t = bitmapTexture(url, { flipY: true, priority }); pending.push(t.userData.ready);
    }
    t.colorSpace = info.noncolor ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    const ext = node?.extension || 'REPEAT';
    t.wrapS = t.wrapT = ext === 'REPEAT' ? THREE.RepeatWrapping : ext === 'MIRROR' ? THREE.MirroredRepeatWrapping : THREE.ClampToEdgeWrapping;
    t.anisotropy = globalThis.RR_MAX_ANISO || 8;
    if (node?.interpolation === 'Closest') { t.magFilter = THREE.NearestFilter; }
    if (t.userData.ktxKeep) Object.assign(t.userData.ktxKeep, { colorSpace: t.colorSpace, wrapS: t.wrapS, wrapT: t.wrapT, anisotropy: t.anisotropy, magFilter: t.magFilter, flipY: false });
    texCache.set(key, t); TEX_BY_URL.set(ukey, t); return t;
  };
  const compiled = new Map(); const stats = { compiled: 0, materials: 0, skipped: 0, notes: {}, glass: 0, failed: [] };
  const byMat = new Map();
  // faces in an empty Blender material slot (ceil_soffit, ap_floor, rot_soffit_ring, rot_soffit_south and
  // rest_rot_soffit_south have one) come out of glTF without a material, and GLTFLoader gives them its unnamed default:
  // white, metalness 1, roughness 1, which reads as a dull mirror. They take the material of the object's other
  // primitive (the same Blender object), or else Cycles' own default surface, a 0.8 grey diffuse. In the Oct 13 export
  // every such slot is unused (no primitive without a material in any GLB), so this changes nothing there today.
  let emptySlots = 0;
  root.traverse(o => { if (!o.isMesh || Array.isArray(o.material) || !o.material?.isMeshStandardMaterial || o.material.name || o.material.metalness !== 1 || o.material.roughness !== 1 || o.material.map) return;
    const sib = o.parent?.children.find(s => s !== o && s.isMesh && !Array.isArray(s.material) && s.material?.name);
    o.material = sib ? sib.material : (DEFAULT_SURFACE ||= Object.assign(new THREE.MeshStandardMaterial({ color: new THREE.Color(0.8, 0.8, 0.8), roughness: 1, metalness: 0 }), { name: 'cycles_default_surface' }));
    emptySlots++; console.warn(`[rr2_scene] ${o.name || o.parent?.name}: empty material slot, using ${sib ? sib.material.name : 'a 0.8 grey diffuse'}`); });
  if (emptySlots) stats.emptySlots = emptySlots;
  root.traverse(o => { if (o.isMesh) { const m = o.material; if (!byMat.has(m)) byMat.set(m, []); byMat.get(m).push(o); } });
  // standard-map textures: same image files, glTF orientation (flipY off), shared across areas
  const stdTex = (name, node, noncolor) => {
    const info = extra.images?.[name]; if (!info || !info.file) return null;
    const url = info.url || new URL(areaUrl + '/' + info.file, location.href).href;
    const ext = node?.extension || 'REPEAT', key = url + '|std|' + ext + '|' + (noncolor ? 'n' : 'c');
    if (TEX_BY_URL.has(key)) { const t0 = TEX_BY_URL.get(key); if (t0.userData.ready) pending.push(t0.userData.ready); return t0; }
    const t = bitmapTexture(url, { flipY: false, priority }); t.colorSpace = noncolor ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = ext === 'REPEAT' ? THREE.RepeatWrapping : ext === 'MIRROR' ? THREE.MirroredRepeatWrapping : THREE.ClampToEdgeWrapping; t.anisotropy = globalThis.RR_MAX_ANISO || 8;
    pending.push(t.userData.ready);
    TEX_BY_URL.set(key, t); return t;
  };
  for (const [m, meshes] of byMat) {
    stats.materials++;
    const name = m.name; const src = extra.materials?.[name];
    if (!src || mode === 'gltf') { stats.skipped++; continue; }
    // Principled values the glTF export lost (sheen weight, specular level, IOR): uniforms only, every material
    const px = principledExtras(m, src); if (px) stats.principledExtras = (stats.principledExtras || 0) + 1;
    // image-only graphs map straight onto three's standard texture slots: they then share a handful of shader programs
    // instead of one each (each program costs about half a second to compile on Windows on a first visit)
    if (applySimpleGraph(m, src, stdTex)) { stats.simple = (stats.simple || 0) + 1; continue; }
    let c = compiled.get(name);
    if (c === undefined) {
      // &floorfix2=1&ff2grout=1|2 (sweep Oct 14, grid seams S45y300p00, S47y180p00): the corridor floor is two stacked sheets
      // with the same world tile grid but different grout, d2_floor (rr_plain_floor, .004, .005: Mortar Size 0.012, Smooth
      // 0.3, mortar 0.42 0.37 0.30) on continuous-marble-floor (rr_plain_floor.003: 0.004, 0.6, 0.62 0.57 0.48); where d2_floor
      // ends the joints turn from dark 7 mm lines into faint 2.4 mm ones and read as a broken grid. ff2grout=1 gives .003 the
      // d2_floor grout, ff2grout=2 the reverse. Both brick nodes of the graph (colour and bump) get the same values.
      const FF = globalThis.RR_FLAGS || {}; let csrc = src;
      if (FF.floorfix2 && FF.ff2grout && /^rr_plain_floor(\.00[345])?$/.test(name)) {
        const G = FF.ff2grout == 2 ? { s: 0.004, m: 0.6, c: [0.62, 0.57, 0.48, 1.0], who: /^rr_plain_floor(\.00[45])?$/ } : { s: 0.012, m: 0.3, c: [0.42, 0.37, 0.30, 1.0], who: /^rr_plain_floor\.003$/ };
        if (G.who.test(name)) { csrc = JSON.parse(JSON.stringify(src));
          for (const n of csrc.graph?.nodes || []) if (n.type === 'TEX_BRICK' && n.in) { n.in['Mortar Size'] = G.s; n.in['Mortar Smooth'] = G.m; n.in.Mortar = G.c.slice(); } } }
      // RR_FLAGS.ff2ph = k (agent vmisc, Oct 15, off unless set; K13 doubled grout): every rr_plain_floor variant overlays
      // (PH_mix, OVERLAY, factor 0.55) the photo marble_01_diff.jpg, box projected in Object coordinates at 1.4 m a repeat,
      // on top of its own world brick grid (0.6 m, turned 22 degrees). That photo is itself an ashlar of 0.35 m rows with dark
      // joints, so the floor shows a second, unrotated and staggered joint grid inside the real tiles (sweep rv10, W107y120p00,
      // W103y180p00; rv02, rv03 rotunda). The r8f Cycles capture B084 shows one clean grid. Here the overlay factor is
      // multiplied by k (0 drops the photo layer; the graph's own noise ramp keeps the stone variation). ff2ph=mean keeps the
      // overlay at its factor but replaces the photo by its own mean colour (linear 0.443 0.340 0.197, measured on the image):
      // the warm tone the photo gives the floor stays, its joint grid goes (k=0 turned the floor pale pink grey, vmisc h2f).
      if (FF.ff2ph !== undefined && FF.ff2ph !== '' && /^rr_plain_floor(\.\d+)?$/.test(name)) {
        if (csrc === src) csrc = JSON.parse(JSON.stringify(src));
        if (FF.ff2ph === 'mean') { for (const n of csrc.graph?.nodes || []) if (n.name === 'PH_diff' && n.type === 'TEX_IMAGE') {
            n.type = 'RGB'; n.bl = 'ShaderNodeRGB'; n.out = { Color: [0.443, 0.340, 0.197, 1.0] }; delete n.image; stats.ff2ph = (stats.ff2ph || 0) + 1; }
          if (csrc.graph?.links) csrc.graph.links = csrc.graph.links.filter(l => l[2] !== 'PH_diff'); }
        else { const k = Math.max(0, +FF.ff2ph);
          for (const n of csrc.graph?.nodes || []) if (n.name === 'PH_mix' && n.in && typeof n.in.Factor_Float === 'number') { n.in.Factor_Float *= k; stats.ff2ph = (stats.ff2ph || 0) + 1; } } }
      try { c = new BlenderMaterialCompiler(csrc, imageLookup).compile(); }
      catch (e) { stats.failed.push(name + ': ' + e.message); c = null; }
      compiled.set(name, c);
    }
    if (!c) { stats.skipped++; continue; }
    if (c.res.glass) stats.glass++;
    for (const msh of meshes) addBlenderAttributes(msh, msh.name);
    applyBlenderGraph(m, c); stats.compiled++;
    for (const n of c.notes) stats.notes[n] = (stats.notes[n] || 0) + 1;
  }
  await Promise.all(pending);
  return stats;
}

const SIMPLE_NODES = new Set(['BSDF_PRINCIPLED', 'OUTPUT_MATERIAL', 'TEX_IMAGE', 'NORMAL_MAP', 'TEX_COORD', 'UVMAP']);
function applySimpleGraph(m, src, stdTex) {
  const g = src.graph; if (!g || !m.isMeshStandardMaterial) return false;
  if (!g.nodes.every(n => SIMPLE_NODES.has(n.type))) return false;
  const P = g.nodes.filter(n => n.type === 'BSDF_PRINCIPLED'); if (P.length !== 1) return false; const p = P[0];
  const byName = new Map(g.nodes.map(n => [n.name, n]));
  const into = g.links.filter(l => l[2] === p.name);
  if (!g.nodes.some(n => n.type === 'TEX_IMAGE')) return false;
  const plan = [];
  for (const [fromN, fromS, , sock] of into) {
    const n = byName.get(fromN); if (!n) return false;
    if (n.type === 'TEX_IMAGE') {
      if (sock === 'Base Color' && fromS === 'Color') plan.push(['map', n, false]);
      else if (sock === 'Alpha' && fromS === 'Alpha') plan.push(['alpha', n]);
      else if (sock === 'Roughness') plan.push(['roughnessMap', n, true]);
      else if (sock === 'Metallic') plan.push(['metalnessMap', n, true]);
      else if (sock === 'Emission Color') plan.push(['emissiveMap', n, false]);
      else return false;
    } else if (n.type === 'NORMAL_MAP' && sock === 'Normal') {
      const l = g.links.find(l => l[2] === n.name && l[3] === 'Color'); const img = l && byName.get(l[0]); if (!img || img.type !== 'TEX_IMAGE') return false;
      plan.push(['normalMap', img, true, n.in?.Strength ?? 1]);
    } else return false;
  }
  const tex = {}; for (const [slot, n, nc] of plan) { if (slot === 'alpha') continue; const t = stdTex(n.image, n, nc); if (!t) return false; tex[slot] = t; }
  for (const [slot, n, , str] of plan) {
    if (slot === 'map') { m.map = tex.map; m.color.setRGB(1, 1, 1); }
    else if (slot === 'alpha') { if (!m.map) return false; m.alphaTest = 0.5; m.transparent = false; m.depthWrite = true; }
    else if (slot === 'roughnessMap') { m.roughnessMap = tex.roughnessMap; m.roughness = 1; }
    else if (slot === 'metalnessMap') { m.metalnessMap = tex.metalnessMap; m.metalness = 1; }
    else if (slot === 'emissiveMap') { m.emissiveMap = tex.emissiveMap; m.emissive.setRGB(1, 1, 1); m.emissiveIntensity = p.in?.['Emission Strength'] ?? 1; }
    else if (slot === 'normalMap') { m.normalMap = tex.normalMap; m.normalScale.set(str, str); }
  }
  m.userData.simpleBlender = true; m.needsUpdate = true; return true;
}

// Binary fetch. Hosts that only serve web types get the GLBs as base64 text (name.glb.txt): opts.b64.
async function fetchBin(u, b64, priority = PRI.area) {
  if (!b64) return new Uint8Array(await queuedFetch(u, { priority }));
  const t = (await queuedFetch(u + '.txt', { priority, as: 'text' })).trim(); const bin = atob(t); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function loadGLB(loader, url, file, parts, b64, priority = PRI.area) {
  const bufs = parts ? await Promise.all(Array.from({ length: parts }, (_, k) => fetchBin(`${url}/${file}.part${k}`, b64, priority))) : [await fetchBin(`${url}/${file}`, b64, priority)];
  const all = new Uint8Array(bufs.reduce((a, b) => a + b.length, 0)); let off = 0; for (const b of bufs) { all.set(b, off); off += b.length; }
  return loader.parseAsync(all.buffer, url + '/');
}
// Load one exported area: plain GLBs plus repeated geometry as GPU instance batches (inst.glb + instances.json).
export async function loadArea(loader, url, inv, report = {}, { b64 = false, priority = PRI.area } = {}) {
  const root = new THREE.Group(); root.name = 'area:' + url;
  // every file of the area is requested at once through the shared queue (bounded concurrency), added in file order
  const instP = queuedFetch(url + '/instances.json', { priority, as: 'json' }).catch(() => null);
  const scenes = await Promise.all(inv.files.map(f => loadGLB(loader, url, f.file, f.parts, b64, priority).catch(e => { (report.errors ||= []).push(f.file + ': ' + e.message); return null; })));
  for (const g of scenes) if (g) root.add(g.scene);
  const inst = await instP;
  if (inst && inst.length) {
    const g = await loadGLB(loader, url, 'inst.glb', 0, b64, priority); g.scene.updateMatrixWorld(true);
    const byName = new Map(); g.scene.traverse(o => { if (o.name) byName.set(o.name, o); });
    let n = 0; const m4 = new THREE.Matrix4();
    for (const it of inst) {
      const node = byName.get(it.proto); if (!node) { (report.errors ||= []).push('missing prototype ' + it.proto); continue; }
      const meshes = []; node.traverse(o => { if (o.isMesh) meshes.push(o); });
      for (const msh of meshes) {
        const im = new THREE.InstancedMesh(msh.geometry, msh.material, it.count); im.name = it.proto; im.userData.protoWorld = msh.matrixWorld.clone();
        const local = msh.matrixWorld.clone();   // primitive offset inside the prototype node (identity in practice)
        it.matrices.forEach((a, i) => { m4.fromArray(a).multiply(local); im.setMatrixAt(i, m4); });
        im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.frustumCulled = true; root.add(im); n += it.count;
      }
    }
    report.instanced = n; report.prototypes = inst.length;
  }
  return root;
}

// Blender "Object" texture coordinates. The export quantizes vertex positions (KHR_mesh_quantization), which moves every
// mesh into its own normalized space, so the local positions are no longer Blender object space. With each object's
// Blender world matrix (objmat.json, read from the .blend) the true object-space position is restored per vertex:
// object = inverse(blender world) * (three world -> Blender axes) * local. Procedural textures (sky clouds, noise,
// marble, wood) driven by Object coordinates then have their Blender scale again.
const _B = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1);   // three -> Blender axes
export function fixObjectCoords(area, inv, objmat, report = {}) {
  if (!objmat) return;
  const byNode = new Map(inv.inventory.filter(r => r.node).map(r => [r.node, r]));
  const protoRow = new Map(inv.inventory.filter(r => r.status === 'instanced' && r.proto).map(r => [r.proto, r]));
  area.updateMatrixWorld(true);
  const done = new Map(); let n = 0, cloned = 0, missing = 0; const T = new THREE.Matrix4(), MW = new THREE.Matrix4(), v = new THREE.Vector3();
  area.traverse(o => {
    if (!o.isMesh || !o.geometry.attributes.blObj) return;
    let q = o; while (q && !byNode.has(q.name) && !protoRow.has(q.name)) q = q.parent;
    const r = q ? (byNode.get(q.name) || protoRow.get(q.name)) : null; const key = r && (objmat[r.source] ? r.source : r.name);
    const mw = key && objmat[key]; if (!mw) { missing++; return; }
    MW.set(...mw).invert();
    const W = o.isInstancedMesh ? o.userData.protoWorld : o.matrixWorld;
    T.multiplyMatrices(MW, _B).multiply(W);
    const sig = T.elements.map(x => x.toFixed(5)).join(',');
    let g = o.geometry; const prev = done.get(g);
    if (prev === sig) return;                       // shared geometry, same object space: already correct
    if (prev !== undefined) { g = o.geometry = g.clone(); cloned++; }   // shared by an object with another transform
    const p = g.attributes.position, a = g.attributes.blObj;
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(T); a.setXYZ(i, v.x, v.y, v.z); }
    a.needsUpdate = true; done.set(g, sig); n++;
  });
  report.objectCoords = { fixed: (report.objectCoords?.fixed || 0) + n, cloned: (report.objectCoords?.cloned || 0) + cloned, missing: (report.objectCoords?.missing || 0) + missing };
}

// Ryan (Oct 13): every floor tile identical, no tile-to-tile shade, gloss or tilt changes. The plain floor materials
// (rr_plain_floor*) vary each tile on purpose through a white-noise-per-tile chain: rr_tv brightness 0.91..1.06,
// rr_hm hue 0.49..0.51, rr_rr roughness 0.04..0.16, rr_tilt normal tilt 0.04. Pin each to its middle value here, in the
// viewer only; the .blend keeps its graph.
export function evenFloorTiles(extra) {
  for (const m of Object.values(extra?.materials || {})) {
    const nodes = m?.graph?.nodes; if (!nodes || !nodes.some(n => n.name === 'rr_tv' || n.name === 'rr_rr')) continue;
    for (const n of nodes) {
      const i = n.in || (n.in = {});
      if (n.name === 'rr_tv') { const c = ((i['To Min'] ?? 0.91) + (i['To Max'] ?? 1.06)) / 2; i['To Min'] = c; i['To Max'] = c; }
      if (n.name === 'rr_hm') { i['To Min'] = 0.5; i['To Max'] = 0.5; }
      if (n.name === 'rr_rr') { const c = ((i['To Min'] ?? 0.04) + (i['To Max'] ?? 0.16)) / 2; i['To Min'] = c; i['To Max'] = c; }
      if (n.name === 'rr_tilt') i.Scale = 0;
    }
    m.evenTiles = true;
  }
}
