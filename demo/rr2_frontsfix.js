// rr2_frontsfix.js (agent frontsfix, Oct 22): storefront fixes for Yardbird, Donutique and Delmonico against Ryan's photos
// (inspect photocmp_1022 A08, A21, A01, A02). Viewer side only; no GLB or .blend is changed, every original piece stays in
// the data (parked at load). RR_FLAGS.frontsfix=0 turns all of it off for an A/B. Rows: ship\frontsfix_pkg\PATCH_rows.json.
// frontsfixExtra(extra): before an area's materials compile, edits the Blender graphs in its scene_extra (same names in
//   every area, so gjM2c, mt21c and mt31c copies all agree).
// frontsfixArea(area, inv): after compile, geometry: Yardbird beams clipped at the facade line, roll shutters parked and
//   the folding door bank completed; Donutique upper wall in stone, halo glow behind the letters, marble threshold band.
import * as THREE from 'three';

const on = () => +((globalThis.RR_FLAGS || {}).frontsfix ?? 1) !== 0;
const IMG = {   // shared webp files already in data/img (listed per area only where an area used them)
  'american_walnut_veneer_diff_2k.jpg': { file: '../img/a3c772b1b8.webp', size: [2048, 2048], noncolor: false, cs: 'sRGB' },
  'Travertine009_2K-JPG_Color.jpg': { file: '../img/9c236a2503.webp', size: [1024, 1024], noncolor: false, cs: 'sRGB' },
};
const P = (name, inp) => ({ name, type: 'BSDF_PRINCIPLED', bl: 'ShaderNodeBsdfPrincipled', distribution: 'MULTI_GGX', subsurface_method: 'RANDOM_WALK',
  in: Object.assign({ Metallic: 0, Roughness: 0.5, IOR: 1.5, Alpha: 1, 'Specular IOR Level': 0.5, 'Coat Weight': 0, 'Coat Roughness': 0.03, 'Emission Strength': 0 }, inp) });
const OUT = { name: 'Material Output', type: 'OUTPUT_MATERIAL', bl: 'ShaderNodeOutputMaterial', target: 'ALL', is_active_output: true, in: {} };
const TC = { name: 'Texture Coordinate', type: 'TEX_COORD', bl: 'ShaderNodeTexCoord', from_instancer: false, in: {} };
const MAP = (s) => ({ name: 'Mapping', type: 'MAPPING', bl: 'ShaderNodeMapping', vector_type: 'POINT', in: { Location: [0, 0, 0], Rotation: [0, 0, 0], Scale: s } });
const IMGN = (img) => ({ name: 'Image Texture', type: 'TEX_IMAGE', bl: 'ShaderNodeTexImage', image: img, size: IMG[img].size, cs: 'sRGB', interpolation: 'Linear', projection: 'BOX', extension: 'REPEAT', in: {} });
const MIXC = (b) => ({ name: 'Mix', type: 'MIX', bl: 'ShaderNodeMix', blend_type: 'MULTIPLY', data_type: 'RGBA', in: { Factor_Float: 1, B_Color: b } });
// image on Object coordinates with box projection (real world scale, no dependence on the pieces' UVs) times a tint
const boxImage = (img, scale, tint, pin) => ({ blend_method: 'OPAQUE', diffuse: [0.8, 0.8, 0.8, 1], graph: {
  nodes: [OUT, P('Principled BSDF', pin), TC, MAP(scale), IMGN(img), MIXC(tint)],
  links: [['Texture Coordinate', 'Object', 'Mapping', 'Vector'], ['Mapping', 'Vector', 'Image Texture', 'Vector'], ['Image Texture', 'Color', 'Mix', 'A_Color'],
    ['Mix', 'Result_Color', 'Principled BSDF', 'Base Color'], ['Principled BSDF', 'BSDF', 'Material Output', 'Surface']] }, frontsfix: true });
const flat = (rgb, pin = {}) => ({ blend_method: 'OPAQUE', diffuse: [0.8, 0.8, 0.8, 1], frontsfix: true, graph: {
  nodes: [OUT, P('Principled BSDF', Object.assign({ 'Base Color': [...rgb, 1] }, pin))], links: [['Principled BSDF', 'BSDF', 'Material Output', 'Surface']] } });
const node = (m, nm) => m?.graph?.nodes?.find(n => n.name === nm);

// material rows (name -> edit); each returns a note for the report
const MATS = {
  // round 2 (Bar Mia bar top): the black and white swirl read loud; bar_mia_sign_front shows dark stone with faint veins
  bmn_marble_black: (m) => { const r = node(m, 'Map Range'), x = node(m, 'Mix'); if (!r || !x) return 'graph changed, skipped';
    r.in['From Max'] = 0.012; x.in.A_Color = [0.022, 0.021, 0.023, 1]; x.in.B_Color = [0.11, 0.105, 0.1, 1]; return 'dark stone, faint veins'; },
  // Delmonico side panels, headers, pilaster casings: dark walnut burl (IMG_5420), was a saturated orange marble (metallic 0.3
  // tinted the reflections orange; the ramp read too light under the bake)
  rr_del_plaster: (m) => { const r = node(m, 'Color Ramp'), p = node(m, 'Principled BSDF'); if (!r || !p) return 'graph changed, skipped';
    // main Oct 23: IMG_5420 shows smooth burnished bronze Venetian plaster, not burl: a narrow warm ramp, fine noise, soft sheen
    r.ramp.stops = [[0.3, [0.13, 0.068, 0.03, 1]], [0.7, [0.17, 0.092, 0.042, 1]]];
    for (const n of m.graph.nodes) if (n.type === 'TEX_NOISE') { n.in.Scale = 3; n.in.Detail = 2; n.in.Distortion = 0; }
    p.in.Metallic = 0.15; p.in.Roughness = 0.32; p.in['Coat Weight'] = 0.5; p.in['Coat Roughness'] = 0.08; return 'bronze plaster, smooth'; },
  // Delmonico double doors: real walnut grain, vertical, box projected (was a flat orange procedural)
  rr_del_door_oak: () => boxImage('american_walnut_veneer_diff_2k.jpg', [0.9, 0.9, 0.9], [0.62, 0.4, 0.24, 1], /* main Oct 23: rich mid brown walnut like IMG_5420 (0.78 0.62 0.5 washed it grey beige) */ { Roughness: 0.38, 'Coat Weight': 0.45, 'Coat Roughness': 0.1 }),
  // Delmonico entrance canopy underside: the perforated lattice was a HASHED transparent mix (single sided, so it vanished
  // from below and the lit oval read as a plain light disc); now opaque dark bronze with black perforations
  rr_del_lattice: (m) => { const g = m?.graph; if (!g || !node(m, 'Math.007')) return 'graph changed, skipped';
    const p = node(m, 'Principled BSDF'); p.in['Base Color'] = [0.07, 0.048, 0.03, 1]; p.in.Metallic = 0.55; p.in.Roughness = 0.38;
    g.nodes = g.nodes.filter(n => n.type !== 'BSDF_TRANSPARENT' && n.type !== 'MIX_SHADER');
    g.nodes.push({ name: 'Mix', type: 'MIX', bl: 'ShaderNodeMix', blend_type: 'MIX', data_type: 'RGBA', in: { A_Color: [0.07, 0.048, 0.03, 1], B_Color: [0.004, 0.003, 0.002, 1] } });
    g.links = g.links.filter(l => !['Mix Shader', 'Transparent BSDF'].includes(l[0]) && l[2] !== 'Mix Shader');
    g.links.push(['Math.007', 'Value', 'Mix', 'Factor_Float'], ['Mix', 'Result_Color', 'Principled BSDF', 'Base Color'], ['Principled BSDF', 'BSDF', 'Material Output', 'Surface']);
    m.blend_method = 'OPAQUE'; return 'opaque bronze lattice'; },
  // Delmonico curtain bays (wing_front_glass, rb_striped_glass): dense reflective champagne string curtain (IMG_5419)
  rr_del_barcode: (m) => { const a = node(m, 'Math.009'), f = node(m, 'Math.002'), s = node(m, 'Principled BSDF.001'); if (!a || !f || !s) return 'graph changed, skipped';
    a.in.Value_001 = 0.55; f.in.Value_001 = 640; Object.assign(s.in, { 'Base Color': [0.74, 0.6, 0.42, 1], Metallic: 0.85, Roughness: 0.16, 'Transmission Weight': 0 }); return 'denser strands, metallic'; },
  // Yardbird folding leaves, louvres, transom frame: lighter whitewash (yardbird_front_straight), the ramp read mid grey
  yb_whitewash: (m) => { const r = node(m, 'Color Ramp'); if (!r) return 'graph changed, skipped';
    r.ramp.stops = [[0.35, [0.5, 0.46, 0.4, 1]], [0.62, [0.78, 0.75, 0.69, 1]]]; return 'lighter whitewash ramp'; },
  // Donutique and illy portal stone: deep cream limestone at real scale (was the travertine image on tiny UVs: grey sparkle)
  // round 2 (east hall P2, illy triple bays): the tinted travertine read gold and sparkly next to the cream piers, so each
  // bay showed three verticals; illy_14 and donutique_17 show one plain cream limestone. Soft cream noise on Object coords
  RR_Stone_CreamLimestone: () => ({ blend_method: 'OPAQUE', diffuse: [0.8, 0.8, 0.8, 1], frontsfix: true, graph: {
    nodes: [OUT, P('Principled BSDF', { Roughness: 0.55, 'Specular IOR Level': 0.35 }), TC,
      { name: 'Noise Texture', type: 'TEX_NOISE', bl: 'ShaderNodeTexNoise', noise_dimensions: '3D', noise_type: 'FBM', normalize: true, in: { Scale: 1.6, Detail: 4, Roughness: 0.55, Lacunarity: 2, Distortion: 0 } },
      { name: 'Color Ramp', type: 'VALTORGB', bl: 'ShaderNodeValToRGB', ramp: { interp: 'LINEAR', stops: [[0.3, [0.70, 0.62, 0.49, 1]], [0.7, [0.79, 0.715, 0.585, 1]]] }, in: {} }],
    links: [['Texture Coordinate', 'Object', 'Noise Texture', 'Vector'], ['Noise Texture', 'Fac', 'Color Ramp', 'Fac'], ['Color Ramp', 'Color', 'Principled BSDF', 'Base Color'], ['Principled BSDF', 'BSDF', 'Material Output', 'Surface']] } }),
};

export function frontsfixExtra(extra, report = {}) {
  if (!on() || !extra || !extra.materials) return;
  const out = report.frontsfix ||= { mats: [], parked: [], clipped: [], added: [] };
  // round 2: Palazzo junction medallion (cl_pf_floor, cl_pf_med, palazzo_floor.png) had royal blue petals and saturated
  // yellow bands; Paul's frames (IMG_1209_008, IMG_1211_148) show cream field, amber Siena bands, green grey borders and a
  // dark centre disc. Same image recoloured offline (tex/palazzo_floor_fx.webp, same size and orientation)
  if (extra.images && extra.images['palazzo_floor.png'] && !extra.images['palazzo_floor.png'].url) {
    extra.images['palazzo_floor.png'] = { ...extra.images['palazzo_floor.png'], url: new URL('./tex/palazzo_floor_fx.webp', import.meta.url).href }; out.mats.push('palazzo_floor.png -> palazzo_floor_fx.webp'); }
  for (const [nm, fn] of Object.entries(MATS)) {
    const m = extra.materials[nm]; if (!m || m.frontsfix) continue;
    const r = fn(m); if (r && typeof r === 'object') { extra.materials[nm] = r; out.mats.push(nm + ' replaced'); } else { m.frontsfix = true; out.mats.push(nm + ' ' + r); }
    for (const n of (extra.materials[nm].graph?.nodes || [])) if (n.type === 'TEX_IMAGE' && IMG[n.image]) { extra.images ||= {}; extra.images[n.image] ||= IMG[n.image]; }
  }
}

// ---------- geometry ----------
// Yardbird facade line (Blender x, y): the front faces of the folding leaves and piers, yb13_L00_jL (-46.21, -14.53) to
// yb_b4l1_jR (-32.86, -9.03); slope 0.412
const ybFacadeY = (x) => -14.53 + (x + 46.21) * 0.412;
const YB_BEAMS = Array.from({ length: 9 }, (_, i) => 'r9zzp_yb_beam' + i);
// (the two end shutters, yb13_shutE_* and yb_shut0_*, are squeezed in place below, nothing parked)
const YB_LEAF = ['jL', 'jR', 'top', 'mid', 'glass', 'low', 'mv1', 'mv2', 'mh1', 'mh2', 'mh3', 'mh4'];
const YB_PITCH = [1.2963, 0.5295];   // leaf to leaf step along the facade (L05 -> L06)
// Donutique upper wall pieces that take the portal stone (photo: stone frames and wall up to the cornice, no pale boards)
const DN_STONE = ['r9zi_donut_panel', 'r9zi_donut_pil0', 'r9zi_donut_pil1', 'r9zi_donut_pil2', 'r9zi_donut_bayhead0', 'r9zi_donut_bayhead1',
  'r9zi_pil_mbf_sf109_p0_core', 'r9zi_pil_mbf_sf109_p1_core', 'r9zi_pil_mbf_sf109_p2_core', 'r9zi_pil_mbf_w108_core',
  'r9zi_pil_mbf_sf109_p0_cap', 'r9zi_pil_mbf_sf109_p1_cap', 'r9zi_pil_mbf_sf109_p2_cap', 'r9zi_pil_mbf_w108_cap',
  'r9zi_pil_mbf_sf109_p0_plinth', 'r9zi_pil_mbf_sf109_p1_plinth', 'r9zi_pil_mbf_sf109_p2_plinth', 'r9zi_pil_mbf_w108_plinth'];
const DN_SIGNS = ['r9ze_donutique_sign_0', 'r9ze_donutique_sign_1'];

// Delmonico bays (reviewer P2, IMG_5420 / IMG_5419): the bar stood behind the right windows and dining behind the left
// glass; in the photos the left glass bay is the bar and the right windows show dining. The del_bar set (back bar,
// bottles, LED strips, counter, pendants, lounge chairs, cocktail tables, plus its old imported stools Mesh_2107..2135,
// Mesh_1702, Mesh_2351..2353) moves (-10.6, -6.95) behind the left glass; the left dining sets it lands on move into the
// freed right bay where a bbox check found room (0.35 m behind the glass, clear of the furniture that stays), the
// three that had no room are parked (removed at load, data kept). Generated by frontsfix swap.py from the inventories.
const DEL_MOVE = {"del_backbar":[-10.6,-6.95],"del_backbar_bottles":[-10.6,-6.95],"del_backbar_led":[-10.6,-6.95],"del_backbar_led.001":[-10.6,-6.95],"del_backbar_led.002":[-10.6,-6.95],"del_backbar_led.003":[-10.6,-6.95],"del_backbar_led.004":[-10.6,-6.95],"del_barcounter":[-10.6,-6.95],"del_globe_pendant0":[-10.6,-6.95],"del_globe_pendant1":[-10.6,-6.95],"del_globe_pendant2":[-10.6,-6.95],"del_globe_pendant3":[-10.6,-6.95],"del_globe_pendant4":[-10.6,-6.95],"del_globe_pendant5":[-10.6,-6.95],"del_cocktail0":[-10.6,-6.95],"del_lounge0_0":[-10.6,-6.95],"del_lounge0_1":[-10.6,-6.95],"del_cocktail1":[-10.6,-6.95],"del_cocktail2":[-10.6,-6.95],"del_lounge2_0":[-10.6,-6.95],"Mesh_1702":[-10.6,-6.95],"Mesh_2107":[-10.6,-6.95],"Mesh_2108":[-10.6,-6.95],"Mesh_2109":[-10.6,-6.95],"Mesh_2110":[-10.6,-6.95],"Mesh_2111":[-10.6,-6.95],"Mesh_2112":[-10.6,-6.95],"Mesh_2113":[-10.6,-6.95],"Mesh_2114":[-10.6,-6.95],"Mesh_2115":[-10.6,-6.95],"Mesh_2116":[-10.6,-6.95],"Mesh_2117":[-10.6,-6.95],"Mesh_2118":[-10.6,-6.95],"Mesh_2119":[-10.6,-6.95],"Mesh_2120":[-10.6,-6.95],"Mesh_2121":[-10.6,-6.95],"Mesh_2122":[-10.6,-6.95],"Mesh_2123":[-10.6,-6.95],"Mesh_2124":[-10.6,-6.95],"Mesh_2125":[-10.6,-6.95],"Mesh_2126":[-10.6,-6.95],"Mesh_2127":[-10.6,-6.95],"Mesh_2128":[-10.6,-6.95],"Mesh_2129":[-10.6,-6.95],"Mesh_2130":[-10.6,-6.95],"Mesh_2131":[-10.6,-6.95],"Mesh_2132":[-10.6,-6.95],"Mesh_2133":[-10.6,-6.95],"Mesh_2134":[-10.6,-6.95],"Mesh_2135":[-10.6,-6.95],"Mesh_2351":[-10.6,-6.95],"Mesh_2352":[-10.6,-6.95],"Mesh_2353":[-10.6,-6.95],"del_chand_1":[10.6,6.95],"r9zif_delmonico_00_del_table_0":[10.6,6.95],"r9zif_delmonico_00_del_chair_0_0":[10.6,6.95],"r9zif_delmonico_00_del_chair_0_1":[10.6,6.95],"r9zif_delmonico_00_del_set_0_0":[10.6,6.95],"r9zif_delmonico_00_del_set_0_1":[10.6,6.95],"r9zif_delmonico_00_candle":[10.6,6.95],"del_table_2":[11.679,4.93],"del_chair_2_0":[11.679,4.93],"del_chair_2_1":[11.679,4.93],"del_chair_2_2":[11.679,4.93],"del_chair_2_3":[11.679,4.93],"del_set_2_0":[11.679,4.93],"del_set_2_1":[11.679,4.93],"del_set_2_2":[11.679,4.93],"del_set_2_3":[11.679,4.93],"r9zif_delmonico_01_del_table_0":[11.594,5.008],"r9zif_delmonico_01_del_chair_0_2":[11.594,5.008],"r9zif_delmonico_01_del_set_0_2":[11.594,5.008],"r9zif_delmonico_01_del_chair_0_0":[11.594,5.008],"r9zif_delmonico_01_del_set_0_0":[11.594,5.008],"r9zif_delmonico_01_candle":[11.594,5.008]};
const DEL_PARK = ["del_chair_5_0","del_chair_5_1","del_chair_5_2","del_chair_5_3","del_set_5_0","del_set_5_1","del_set_5_2","del_set_5_3","del_table_5","r9z_delmonico_00_del_chair_0_0","r9z_delmonico_00_del_chair_0_1","r9z_delmonico_00_del_chair_0_2","r9z_delmonico_00_del_chair_0_3","r9z_delmonico_00_del_set_0_0","r9z_delmonico_00_del_set_0_1","r9z_delmonico_00_del_set_0_2","r9z_delmonico_00_del_set_0_3","r9z_delmonico_00_del_table_0","r9z_delmonico_01_candle","r9z_delmonico_01_del_chair_0_0","r9z_delmonico_01_del_chair_0_1","r9z_delmonico_01_del_chair_0_2","r9z_delmonico_01_del_chair_0_3","r9z_delmonico_01_del_set_0_0","r9z_delmonico_01_del_set_0_1","r9z_delmonico_01_del_set_0_2","r9z_delmonico_01_del_set_0_3","r9z_delmonico_01_del_table_0","r9z_delmonico_02_candle"];

const B2T = (x, y, z) => new THREE.Vector3(x, z, -y);   // Blender -> three

// quantized (normalized Int16, often interleaved) positions cannot leave their own box; edits go on a float copy
function floatPositions(o) { const g = o.geometry = o.geometry.clone(), q = g.attributes.position, a = new Float32Array(q.count * 3);
  for (let i = 0; i < q.count; i++) { a[i * 3] = q.getX(i); a[i * 3 + 1] = q.getY(i); a[i * 3 + 2] = q.getZ(i); }
  g.setAttribute('position', new THREE.BufferAttribute(a, 3)); return g; }

function clipBeam(top, out, nm) {
  top.updateMatrixWorld(true); let n = 0;
  top.traverse(o => { if (!o.isMesh) return;
    const g = floatPositions(o), p = g.attributes.position, W = o.matrixWorld, I = W.clone().invert(), v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(W); const yf = ybFacadeY(v.x) + 1.0;
      if (-v.z < yf) { v.z = -yf; v.applyMatrix4(I); p.setXYZ(i, v.x, v.y, v.z); n++; } }
    p.needsUpdate = true; g.computeBoundingBox(); g.computeBoundingSphere(); });
  if (n) out.clipped.push(nm + ' ' + n + ' verts');
}

// scales a group of nodes along the Yardbird facade direction by s, about the group's min or max end on that axis
// (vertices baked per mesh, geometry cloned; the move is toward the group's own extent so quantized ranges hold)
const YB_U = new THREE.Vector3(0.9257, 0, -0.3781);   // facade direction (Blender (0.9257, 0.3781)) in three axes
function squeeze(tops, side, s) {
  const v = new THREE.Vector3(); let lo = Infinity, hi = -Infinity; const meshes = [];
  for (const t of tops) { t.updateMatrixWorld(true); t.traverse(o => { if (!o.isMesh) return; meshes.push(o); const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) { const d = v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld).dot(YB_U); lo = Math.min(lo, d); hi = Math.max(hi, d); } }); }
  const piv = side === 'min' ? lo : hi;
  for (const o of meshes) { const g = floatPositions(o), p = g.attributes.position, I = o.matrixWorld.clone().invert();
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); const d = v.dot(YB_U); v.addScaledVector(YB_U, (piv + (d - piv) * s) - d); v.applyMatrix4(I); p.setXYZ(i, v.x, v.y, v.z); }
    p.needsUpdate = true; g.computeBoundingBox(); g.computeBoundingSphere(); }
}

function stoneMaterial(area) {   // the compiled portal stone of this area (after frontsfixExtra)
  let m = null; area.traverse(o => { if (m || !o.isMesh) return; const k = Array.isArray(o.material) ? o.material[0] : o.material; if (k && /^RR_Stone_CreamLimestone/.test(k.name || '')) m = k; }); return m;
}

function haloTexture(word) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256; const x = c.getContext('2d');
  x.fillStyle = 'rgba(0,0,0,0)'; x.fillRect(0, 0, 1024, 256);
  x.font = '600 150px "Times New Roman", Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#fff3dc';
  x.filter = 'blur(18px)'; x.fillText(word, 512, 134); x.filter = 'blur(7px)'; x.globalAlpha = 0.8; x.fillText(word, 512, 134);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function veinTexture() {   // dark brown marble with light veins (the Donutique threshold band, donutique_17 and _18)
  const c = document.createElement('canvas'); c.width = 512; c.height = 128; const x = c.getContext('2d');
  x.fillStyle = '#2a1a12'; x.fillRect(0, 0, 512, 128); let s = 7;
  const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < 600; i++) { x.fillStyle = `rgba(${60 + r() * 40},${35 + r() * 25},${25 + r() * 15},0.25)`; x.fillRect(r() * 512, r() * 128, 6 + r() * 30, 3 + r() * 12); }
  x.lineCap = 'round';
  for (let i = 0; i < 26; i++) { x.strokeStyle = `rgba(${190 + r() * 50},${170 + r() * 40},${140 + r() * 40},${0.25 + r() * 0.45})`; x.lineWidth = 0.6 + r() * 1.8;
    x.beginPath(); let px = r() * 512, py = r() * 128; x.moveTo(px, py); for (let k = 0; k < 6; k++) { px += (r() - 0.3) * 70; py += (r() - 0.5) * 40; x.lineTo(px, py); } x.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

// a flat strip on the floor along a Blender segment a -> b, offset d0..d1 along the outward normal n
function floorStrip(a, b, n, d0, d1, z, mat, name) {
  const pts = [[a, d0], [b, d0], [b, d1], [a, d1]].map(([q, d]) => B2T(q[0] + n[0] * d, q[1] + n[1] * d, z));
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flatMap(v => [v.x, v.y, v.z]), 3));
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), D = Math.abs(d1 - d0);
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, L / 1.6, 0, L / 1.6, D / 0.4, 0, D / 0.4], 2)); g.setIndex([0, 1, 2, 0, 2, 3]); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.name = name; m.userData.frontsfix = true; m.receiveShadow = true; return m;
}

export function frontsfixArea(area, inv, report = {}) {
  if (!on() || !inv) return;
  const out = report.frontsfix ||= { mats: [], parked: [], clipped: [], added: [] };
  const byNode = new Map(inv.inventory.filter(r => r.node).map(r => [r.node, r.name]));
  const nodes = new Map(); area.traverse(o => { const nm = byNode.get(o.name); if (nm && !nodes.has(nm)) nodes.set(nm, o); });
  // round 2 (Matteo interior P2, rays from matteo_int poses): Mesh_1501 (Material_501.003, a glossy grey green imported
  // slab at z 1.16 to 1.44 running 8 m across the room and through the rebuilt bar) is parked; the Matteo photos show no
  // such slab. Mesh_1491 (the imported shell) carries a dark metallic block, z 0 to 1.36, along the inside of the front
  // glass at x 5.5 to 10.9 (the black slab in matteo_int_dn_y000): those triangles are cut, the rest of the shell stays
  { const t = nodes.get('Mesh_1501'); if (t && t.parent) { t.parent.remove(t); out.parked.push('Mesh_1501'); } }
  { const t = nodes.get('Mesh_1491'); if (t && !t.userData.frontsfixCut) { t.userData.frontsfixCut = true; t.updateMatrixWorld(true); let cut = 0;
    t.traverse(o => { if (!o.isMesh) return; const g = o.geometry = o.geometry.clone(), p = g.attributes.position, W = o.matrixWorld, v = new THREE.Vector3();
      const idx = g.index ? Array.from(g.index.array) : Array.from({ length: p.count }, (_, i) => i), keep = [];
      const inBox = (i) => { v.fromBufferAttribute(p, i).applyMatrix4(W); const x = v.x, y = -v.z, z = v.y; const yg = -11.96 + 0.408 * (x - 5.88); return x > 5.5 && x < 10.9 && y > yg - 0.75 && y < yg + 0.3 && z < 1.45 ? z : null; };   // within 0.75 m inside the glass line
      for (let k = 0; k < idx.length; k += 3) { const zs = [inBox(idx[k]), inBox(idx[k + 1]), inBox(idx[k + 2])];
        if (zs.every(z => z !== null) && Math.max(...zs) > 0.06) { cut++; continue; } keep.push(idx[k], idx[k + 1], idx[k + 2]); }
      g.setIndex(keep); g.computeBoundingSphere(); });
    out.clipped.push('Mesh_1491 front block ' + cut + ' tris'); } }
  // Matteo bar front: the rebuilt bar (cl_mtr_bar) shared the orange cherry door veneer; through the door the photos show a
  // dark wood bar under a light top (matteo_door_screen), so it takes the dark walnut of this area (RR_Wood_DarkWalnut)
  { const t = nodes.get('cl_mtr_bar'); let dw = null; area.traverse(o => { if (!dw && o.isMesh && /^RR_Wood_DarkWalnut/.test((Array.isArray(o.material) ? o.material[0] : o.material)?.name || '')) dw = Array.isArray(o.material) ? o.material[0] : o.material; });
    if (t && dw) { t.traverse(o => { if (o.isMesh) o.material = dw; }); out.mats.push('cl_mtr_bar -> RR_Wood_DarkWalnut'); } }
  // round 2 (east hall P2, angular ceiling wedges): pal_ceil_fill is one 36 m quad at z 5.45, 10 cm under the east hall
  // fills (cl_ee_ceilfill, F3_ceil_patch_1 at 5.55), so its diagonal edges cut wedges across the ceiling; and cl_ee_ceilfill,
  // F3_ceil_patch_1 and Mesh_1566 are coplanar at 5.55 (z fight). The quad goes to 5.60 (still closes the junction, where
  // nothing else covers), F3 to 5.57 and cl_ee_ceilfill 5 mm down so one flat plane wins everywhere
  for (const [nm, dz] of [['pal_ceil_fill', 0.15], ['F3_ceil_patch_1', 0.02], ['cl_ee_ceilfill', -0.005]]) { const t = nodes.get(nm); if (!t || t.userData.frontsfixZ) continue; t.userData.frontsfixZ = dz;
    t.updateMatrixWorld(true); t.traverse(o => { if (!o.isMesh) return; const g = floatPositions(o), p = g.attributes.position, I = o.matrixWorld.clone().invert(), v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); v.y += dz; v.applyMatrix4(I); p.setXYZ(i, v.x, v.y, v.z); }
      p.needsUpdate = true; g.computeBoundingBox(); g.computeBoundingSphere(); }); out.clipped.push(nm + ' z ' + (dz > 0 ? '+' : '') + dz); }
  // 1. Yardbird: beams end 1.0 m inside the facade (they ran 5 m out across the corridor and the sign; at 0.3 m their ends
  //    still read as stubs through the opening above the doors, which p3Fixes now closes with the transom row)
  for (const nm of YB_BEAMS) { const t = nodes.get(nm); if (t && !t.userData.frontsfixClip) { t.userData.frontsfixClip = true; clipBeam(t, out, nm); } }
  // the two shutters at the ends of the folding bank were full leaf wide grey roll shutters (1.25 m); the photo
  // (yardbird_front_straight) has a narrow whitewashed louvre panel at each end of the bank. Each shutter is squeezed to
  // 0.5 m against its outer edge (left pier, screen pier) and the freed 0.7 m takes a narrow folding leaf: a copy of
  // L06 one pitch right (L07) and of L00 one pitch left (Lm1), squeezed against the bank
  const ww = (() => { const f = nodes.get('yb13_shutE_frame'); let m = null; f && f.traverse(o => { if (!m && o.isMesh) m = o.material; }); return m; })();
  for (const [pre, side] of [['yb13_shutE_', 'max'], ['yb_shut0_', 'min']]) {
    const parts = [...nodes.entries()].filter(([nm]) => nm.startsWith(pre)).map(([, t]) => t).filter(t => !t.userData.frontsfixSq);
    if (!parts.length) continue; parts.forEach(t => t.userData.frontsfixSq = true);
    squeeze(parts, side, 0.5 / 1.25);
    if (pre === 'yb_shut0_' && ww) parts.forEach(t => t.traverse(o => { if (o.isMesh) o.material = ww; }));   // was yb_shutter grey
    out.clipped.push(pre + '* squeezed to 0.5 m (' + parts.length + ' parts)');
  }
  for (const [src, k, tag, side] of [['yb13_L06_', 1, 'L07', 'min'], ['yb13_L00_', -1, 'Lm1', 'max']]) {
    const d = B2T(YB_PITCH[0] * k, YB_PITCH[1] * k, 0), copies = [];
    for (const part of YB_LEAF) { const t = nodes.get(src + part); if (!t || !t.parent || t.userData.frontsfixCopied) continue; t.userData.frontsfixCopied = true;
      // L00 has no jR in the export (L01's jR closes it), so the left copy closes against L00's jL
      const c = t.clone(true); c.position.add(d); c.userData = { ...t.userData, frontsfixCopy: tag }; t.parent.add(c); copies.push(c); }
    if (copies.length) { squeeze(copies, side, 0.7 / 1.229); out.added.push('yb leaf ' + tag + ' 0.7 m (' + copies.length + ' parts)'); }
  }
  // 3. Delmonico: bar to the left bay, dining to the right (DEL_MOVE / DEL_PARK above)
  // A far section (every mt* area, |far:32) drops what lies within 32 m of the walk centre after this hook. A copy whose
  // original spot was that near is a duplicate of the main export's copy and is parked; a far copy that moves near (the
  // bar, mt31c only) is flagged frontsfixKeep so the far test keeps it (one added check in rr2_player.js)
  const far = inv.area && inv.area !== 'gjM2c', WC = [-21.75, -9.61], FAR = 32;
  const nearWC = (b) => Math.hypot(Math.max(b[0] - WC[0], 0, WC[0] - b[3]), Math.max(b[1] - WC[1], 0, WC[1] - b[4])) < FAR;
  const rows = new Map(inv.inventory.filter(r => r.node && r.bbox).map(r => [r.name, r]));
  // unverified and overlapping agent delmint's Delmonico pass: off unless RR_FLAGS.fxdelswap=1
  if (+((globalThis.RR_FLAGS || {}).fxdelswap ?? 0)) for (const [nm, dd] of Object.entries(DEL_MOVE)) { const t = nodes.get(nm); if (!t || !t.parent || t.userData.frontsfixMoved) continue; t.userData.frontsfixMoved = true;
    const r = rows.get(nm); if (far && r && nearWC(r.bbox)) { t.parent.remove(t); out.parked.push(nm + ' (far duplicate)'); continue; }
    t.position.add(B2T(dd[0], dd[1], 0)); t.updateMatrixWorld(true); if (far) t.traverse(o => { o.userData.frontsfixKeep = true; });
    out.moved = (out.moved || 0) + 1; }
  if (+((globalThis.RR_FLAGS || {}).fxdelswap ?? 0)) for (const nm of DEL_PARK) { const t = nodes.get(nm); if (t && t.parent) { t.parent.remove(t); out.parked.push(nm); } }
  // 4. Donutique junction (reviewer P1, sweep_cand_0955 donutique_sf_front_l30): the framed poster and THE VENETIAN lettering
  //    (r9zzr_poster, r9zzr_poster_frame, r9zzx_venetian) stood free in the corridor 2.5 m in front of the west bay, side on,
  //    their black zero thickness back and mirrored letters toward Delmonico: the wall they hung on (#43) was cut in #50.
  //    Paul's IMG_1209_005s / _007s: poster with THE VENETIAN arrow above it on a cream wall in line with the storefronts,
  //    just west of Donutique's window, facing the corridor. They are turned to face the corridor (+y side, Donutique's
  //    facade normal) and hung on a new 0.15 m cream wall section on that line, x 28.25 to 30.2 (east end stops at the
  //    mbf_w107 stone pier)
  { const P = nodes.get('r9zzr_poster'), F = nodes.get('r9zzr_poster_frame'), V = nodes.get('r9zzx_venetian');
    if (P && P.parent && !P.userData.frontsfixHung) { P.userData.frontsfixHung = true;
      area.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(P), c = box.getCenter(new THREE.Vector3());
      let nrm = null; P.traverse(o => { if (nrm || !o.isMesh) return; const g = o.geometry, p = g.attributes.position, ix = g.index;
        const i0 = ix ? ix.getX(0) : 0, i1 = ix ? ix.getX(1) : 1, i2 = ix ? ix.getX(2) : 2;
        const A = new THREE.Vector3().fromBufferAttribute(p, i0).applyMatrix4(o.matrixWorld), B = new THREE.Vector3().fromBufferAttribute(p, i1).applyMatrix4(o.matrixWorld), C = new THREE.Vector3().fromBufferAttribute(p, i2).applyMatrix4(o.matrixWorld);
        nrm = B.sub(A).cross(C.sub(A)); nrm.y = 0; nrm.normalize(); });
      // current front: the side the readable face shows to (toward the junction, Blender (+2.5, +3.7) from the poster)
      const toward = new THREE.Vector3(2.5, 0, -3.7); if (nrm && nrm.dot(toward) < 0) nrm.negate();
      const out_b = [0.1517, 0.9884], tgt = new THREE.Vector3(out_b[0], 0, -out_b[1]);   // Donutique facade outward normal, three axes
      const ang = nrm ? Math.atan2(nrm.x, nrm.z) : 0, angT = Math.atan2(tgt.x, tgt.z);
      const ly = (x) => -9.72 - 0.1517 * (x - 31.0);   // Donutique storefront line extended west (Blender)
      const px = 29.225, pivot = new THREE.Group(); pivot.name = 'frontsfix_dn_poster'; pivot.position.copy(c); area.add(pivot); pivot.updateMatrixWorld(true);
      for (const t of [P, F, V]) if (t && t.parent) pivot.attach(t);
      pivot.rotation.y = angT - ang; pivot.position.copy(B2T(px + out_b[0] * 0.07, ly(px) + out_b[1] * 0.07, c.y)); pivot.updateMatrixWorld(true);
      // the wall section (cream like the Donutique cornice), face on the storefront line
      let cream = null; const cn = nodes.get('r9zi_donut_cor1'); cn && cn.traverse(o => { if (!cream && o.isMesh) cream = o.material; });
      const x0 = 28.25, x1 = 30.2, L = Math.hypot(x1 - x0, ly(x1) - ly(x0)), H = 3.35, D = 0.15;
      const wall = new THREE.Mesh(new THREE.BoxGeometry(L, H, D), cream || new THREE.MeshStandardMaterial({ color: 0xcdbb9a, roughness: 0.6 }));
      const mx = (x0 + x1) / 2, my = ly(mx) - out_b[1] * D / 2;
      wall.position.copy(B2T(mx - out_b[0] * D / 2, my, H / 2)); wall.rotation.y = angT; wall.name = 'frontsfix_dn_wall'; wall.userData.frontsfix = true; area.add(wall);
      out.moved = (out.moved || 0) + 3; out.added.push('dn poster wall ' + L.toFixed(2) + ' m, poster turned ' + ((angT - ang) * 180 / Math.PI).toFixed(0) + ' deg');
    } }
  // Donutique P2 (same sweep): old floorplan glass panes in both portals (int_mb_glass, read as a grey box; donutique_17 has
  // open glass doors), pink int_mb_plaster partitions through the west of the shop (mbf_w118, mbf_w75; r167_f9 stays as the
  // wall), the mirrored STARBUCKS blade sign on the back wall (map_sign_starbucks, SIGNS_Map): parked, data kept
  // reviewer cand_1030: the pink partition through the shop and the grey slab at the left of the front are Matteo bay 1.3's
  // interior walls (mt2_int1.3 at x 23 to 28.3, y -9.3 to -7.0, pink int_mb_plaster back face toward Donutique; and
  // cl_mt2_int1.3_x1), standing on the corridor tiles of the Donutique junction since the junction was opened (#50).
  // Paul's junction frames show the junction open there: both parked too
  // reviewer cand_1045 (rays cast offline from sweep poses donutique_int_y000..y315 against every area's GLBs): the pink /
  // wood partition through the west of the shop is not a named object but part of gjM2c Mesh_1489 (the imported corridor
  // wall mesh, Material_362 and rr_del_cream): a 0.3 m wall at x 25.3 to 25.6, y -12.2 to -7.4, z 0 to 5.3 standing inside
  // room 167 and out onto the junction tiles. Only those triangles are dropped (collapsed), the rest of the mesh stays
  { const t = nodes.get('Mesh_1489'); if (t && !t.userData.frontsfixCut) { t.userData.frontsfixCut = true; t.updateMatrixWorld(true); let n = 0; const v = new THREE.Vector3();
      t.traverse(o => { if (!o.isMesh) return; const g = o.geometry, p = g.attributes.position; let idx = g.index; if (!idx) return;
        const a = new (idx.array.constructor)(idx.array); let hit = 0;
        for (let k = 0; k < a.length; k += 3) { let cx = 0, cy = 0; for (let j = 0; j < 3; j++) { v.fromBufferAttribute(p, a[k + j]).applyMatrix4(o.matrixWorld); cx += v.x / 3; cy += -v.z / 3; }
          if (cx > 25.2 && cx < 25.7 && cy > -12.3 && cy < -7.3) { a[k + 1] = a[k]; a[k + 2] = a[k]; hit++; } }
        if (hit) { o.geometry = g.clone(); o.geometry.setIndex(new THREE.BufferAttribute(a, 1)); n += hit; } });
      if (n) out.clipped.push('Mesh_1489 partition at x 25.4 in Donutique: ' + n + ' triangles dropped'); } }
  // the grey flat panel at the east edge of the east portal (sf_front_l30, above the banquette) is the zero thickness side
  // wall toward illy, r9zm_dn_line_r166_f5 / f6 (rr_del_cream reads grey there): it takes the blue chinoiserie panel finish
  // of the Donutique walls (donutique_18)
  { let bp = null; const s = nodes.get('r9zi_dn_panel0'); s && s.traverse(o => { if (!bp && o.isMesh) bp = o.material; });
    if (bp) for (const nm of ['r9zm_dn_line_r166_f5', 'r9zm_dn_line_r166_f6']) { const t = nodes.get(nm); if (!t) continue; t.traverse(o => { if (o.isMesh) o.material = bp; }); out.mats.push(nm + ' -> donutique blue panel'); } }
  for (const nm of ['mbf_sf109_gl0.00', 'mbf_sf109_gl0.69', 'mbf_w118', 'mbf_w75', 'map_sign_starbucks', 'mt2_int1.3', 'cl_mt2_int1.3_x1']) { const t = nodes.get(nm); if (t && t.parent) { t.parent.remove(t); out.parked.push(nm); } }
  // COTE side wall east of the bead curtain bay (CL_DelEnd, r9zzp_navy_lacquer): black lacquer as in Paul's frames and
  // IMG_5419 (was a navy that read royal blue under the bake); constant graph, so the three colour is set here
  { const done = new Set(); area.traverse(o => { if (!o.isMesh) return; for (const m of (Array.isArray(o.material) ? o.material : [o.material]))
      if (m && m.color && /^r9zzp_navy_lacquer/.test(m.name || '') && !done.has(m)) { done.add(m); m.color.setRGB(0.006, 0.006, 0.007, THREE.LinearSRGBColorSpace); m.roughness = 0.28; m.needsUpdate = true; } });
    if (done.size) out.mats.push('r9zzp_navy_lacquer black x' + done.size); }
  // 2. Donutique sign panels warm grey (donutique_17), were near black. A constant Principled graph is not compiled (it
  //    reaches three as glTF factors), so the three material colour is set here
  { const done = new Set(); area.traverse(o => { if (!o.isMesh) return; for (const m of (Array.isArray(o.material) ? o.material : [o.material]))
      if (m && m.color && /^r9ze_donutique_fascia/.test(m.name || '') && !done.has(m)) { done.add(m); m.color.setRGB(0.16, 0.135, 0.115, THREE.LinearSRGBColorSpace); m.roughness = 0.55; m.needsUpdate = true; } });
    if (done.size) out.mats.push('r9ze_donutique_fascia warm grey x' + done.size); }
  // Donutique upper wall, pilasters and piers in the portal stone
  const stone = stoneMaterial(area);
  if (stone) for (const nm of DN_STONE) { const t = nodes.get(nm); if (!t) continue; t.traverse(o => { if (o.isMesh) o.material = stone; }); out.mats.push(nm + ' -> stone'); }
  // halo glow on the warm grey panel behind each word (photo: halo lit letters)
  for (const nm of DN_SIGNS) { const t = nodes.get(nm); if (!t || t.userData.frontsfixHalo) continue; t.userData.frontsfixHalo = true;
    const r = inv.inventory.find(q => q.name === nm), b = r && r.bbox; if (!b) continue;
    const a = [b[0], b[4]], e = [b[3], b[1]];   // the word runs from (xmin, ymax) to (xmax, ymin) on this facade
    const L = Math.hypot(e[0] - a[0], e[1] - a[1]), ux = (e[0] - a[0]) / L, uy = (e[1] - a[1]) / L, nx = uy, ny = -ux;   // outward normal (+y side)
    const out2 = (nx * 0 + ny * 1) > 0 ? 1 : -1;
    const cx = (a[0] + e[0]) / 2, cy = (a[1] + e[1]) / 2, cz = (b[2] + b[5]) / 2;
    const W = L * 1.22, H = (b[5] - b[2]) * 2.6;
    const mat = new THREE.MeshBasicMaterial({ map: haloTexture('DONUTIQUE'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55, toneMapped: false });
    const q = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat); q.name = nm + ':halo'; q.userData.frontsfix = true; q.renderOrder = 2;
    q.position.copy(B2T(cx, cy, cz)); q.rotation.y = Math.atan2(nx * out2, -(ny * out2)); area.add(q); out.added.push(q.name); }
  // dark marble threshold band with brass edges along both portals (donutique_17: brown marble border with gold strips)
  if (nodes.get('r9ze_donutique_fascia_0') && !area.userData.frontsfixBand) { area.userData.frontsfixBand = true;
    const a = [31.0, -9.72], b = [38.25, -10.82], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = [(b[1] - a[1]) / L * -1, (b[0] - a[0]) / L];   // outward (corridor) normal
    const mm = new THREE.MeshStandardMaterial({ map: veinTexture(), color: 0xffffff, roughness: 0.12, metalness: 0 }), gold = new THREE.MeshStandardMaterial({ color: 0xb08a4a, roughness: 0.25, metalness: 1 });
    mm.name = 'frontsfix_dn_marble'; gold.name = 'frontsfix_dn_brass';
    const g = new THREE.Group(); g.name = 'frontsfix_dn_band';
    g.add(floorStrip(a, b, n, 0.03, 0.66, 0.047, mm, 'frontsfix_dn_band_marble'));
    g.add(floorStrip(a, b, n, 0.0, 0.03, 0.048, gold, 'frontsfix_dn_band_brass0'));
    g.add(floorStrip(a, b, n, 0.66, 0.69, 0.048, gold, 'frontsfix_dn_band_brass1'));
    area.add(g); out.added.push('dn threshold band'); }
  p2Fixes(area, nodes, out);
  p3Fixes(area, nodes, out, inv);
  ybWestWall(area, nodes, out, report);
}

// ---------- reviewer P2s (main 10:20, sweep_cand_0955) ----------
// Starbucks (Voltaire side, starbucks_int_y000 / dn_y000): 244 of the 364 triangles of the room floor mbf_floor_103_0 sit on
// black texels of its lightmap chart (gjM2c_1 atlas), so most of the floor drew black. Its lightmap UVs are dropped (the
// floor keeps live capture lighting instead of the bake) and it takes the photo's floor (inside-order-area.jpg: dark grey
// polished concrete), lifted 8 mm so the corridor tiles under the doorway no longer show through it.
// Bar Mia (barmia_int3_y180): vp_adpillar, the Voltaire portal ad totem (2.2 x 0.85 x 2.48 m, rotated), was a matte black
// box with its only screen on the narrow west end, so from the bar its broad side read as a flat black panel. The casing
// becomes dark gunmetal and each broad face gets the portal ad screen (vp_adscreen) in a bronze frame.
function p2Fixes(area, nodes, out) {
  const fl = nodes.get('mbf_floor_103_0');
  if (fl && !fl.userData.frontsfixFloor) { fl.userData.frontsfixFloor = true;
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.085, 0.082, 0.078, THREE.LinearSRGBColorSpace), roughness: 0.28, metalness: 0 });
    mat.name = 'frontsfix_sb_concrete';
    fl.traverse(o => { if (!o.isMesh) return; o.geometry = o.geometry.clone(); o.geometry.deleteAttribute('uv1'); o.material = mat; });
    fl.position.y += 0.008; out.mats.push('mbf_floor_103_0 -> polished grey concrete, lightmap dropped'); }
    // round 2 (cand_r2 reviewer): the black half of the room was no floor at all. mbf_floor_103_0 is missing its triangles
    // over x -1.7 to 6.4, y -39.3 to -46.8 (vertical ray map over the room), so the void drew black and the lower hall tile
    // patch (grpmv2_cl_lowerhall_holefill, z 0.031) showed at its edge. A fill polygon inside the walls (f46, f34, f36) in
    // the same floor material, at z 0.052: under the room floor (0.065 after the lift) where it exists, over the tile patch
  if (fl && !fl.userData.frontsfixFill) { fl.userData.frontsfixFill = true; let fm = null; fl.traverse(o => { if (!fm && o.isMesh) fm = o.material; });
    const P = [[-1.7, -39.3], [3.55, -39.3], [5.15, -44.1], [6.15, -44.2], [6.4, -46.8], [-1.7, -46.8]], pos = [], uv = [];
    for (let i = 1; i < P.length - 1; i++) for (const q of [P[0], P[i], P[i + 1]]) { pos.push(q[0], 0.052, -q[1]); uv.push(q[0] / 2, q[1] / 2); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals();
    if (g.attributes.normal.getY(0) < 0) { g.setIndex(Array.from({ length: pos.length / 3 }, (_, i) => i - (i % 3) + [0, 2, 1][i % 3])); g.computeVertexNormals(); }
    if (!fm) { out.skipped = (out.skipped || []).concat('starbucks floor fill: no floor material'); } else {   // main 15:0x: never build a mesh without a material (it crashed the whole load in cand_r3)
    const m = new THREE.Mesh(g, fm); m.name = 'frontsfix_sb_floorfill'; m.userData.frontsfix = true; m.receiveShadow = true; area.add(m); out.added.push('starbucks floor fill (hole in mbf_floor_103_0)'); } }
  const pil = nodes.get('vp_adpillar');
  if (pil && !pil.userData.frontsfixTotem) { pil.userData.frontsfixTotem = true;
    const gm = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.045, 0.043, 0.042, THREE.LinearSRGBColorSpace), roughness: 0.32, metalness: 0.75 });
    gm.name = 'frontsfix_totem_gunmetal'; pil.traverse(o => { if (o.isMesh) o.material = gm; });
    let scr = null; const f = nodes.get('vp_ad_front'); f && f.traverse(o => { if (!scr && o.isMesh) scr = o.material; });
    const br = new THREE.MeshStandardMaterial({ color: 0x6e5434, roughness: 0.3, metalness: 1 }); br.name = 'frontsfix_totem_bronze';
    // box frame from the exported faces: centre (-3.43, -29.21), long axis (0.945, 0.327), broad face normal (-0.327, 0.945), 0.42 m out
    const c = [-3.43, -29.21], n = [-0.327, 0.945];
    for (const s of [1, -1]) { const nx = n[0] * s, ny = n[1] * s, rot = Math.atan2(nx, -ny);
      for (const [w, h, d, m, tag] of [[1.0, 1.72, 0.425, br, 'frame'], [0.9, 1.6, 0.431, scr || gm, 'screen']]) {
        const q = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m); q.name = 'vp_adpillar:' + tag + (s > 0 ? 'N' : 'S'); q.userData.frontsfix = true;
        q.position.copy(B2T(c[0] + nx * d, c[1] + ny * d, 1.35)); q.rotation.y = rot; area.add(q); } }
    out.added.push('vp_adpillar gunmetal + 2 framed screens'); }
}

// ---------- main 11:2x (offline, on cand_1045): Yardbird, Starbucks, Nomikai, Matteo 1.3 ----------
const rngOf = (seed) => { let s = seed >>> 0 || 1; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; };
function cvs(w, h, draw, repeat = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
}
const std = (name, o) => { const m = new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.6, metalness: 0 }, o)); m.name = name; return m; };
const photoTex = (f) => { const t = new THREE.TextureLoader().load(new URL('./tex/' + f, import.meta.url).href); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
// white painted brick, 0.6 m square tile: 8 courses of 75 mm, 200 mm bricks, half bond (yardbird interior-3, 43810871-3)
const brickTex = () => cvs(512, 512, (x, w, h) => { const r = rngOf(11); x.fillStyle = '#cfc9be'; x.fillRect(0, 0, w, h);
  for (let row = 0; row < 8; row++) for (let k = -1; k < 4; k++) { const bx = k * 170.67 + (row % 2 ? 85.3 : 0), by = row * 64, g = 232 + Math.floor(r() * 14 - 7);
    x.fillStyle = `rgb(${g},${g - 3},${g - 9})`; x.fillRect(bx + 5, by + 5, 160.7, 54); } });
// planks along u: tile = 2.4 m; wM = plank width (m), base colour and spread
const plankTex = (seed, base, spread, wM, grain) => cvs(1024, 1024, (x, w, h) => { const r = rngOf(seed), n = Math.round(2.4 / wM), ph = h / n;
  for (let i = 0; i < n; i++) { let u = -r() * 400; while (u < w) { const L = 300 + r() * 500, d = (r() - 0.5) * spread;
      x.fillStyle = `rgb(${base[0] + d | 0},${base[1] + d | 0},${base[2] + d * 0.9 | 0})`; x.fillRect(u, i * ph, L, ph);
      x.strokeStyle = `rgba(0,0,0,${grain})`; x.lineWidth = 1;
      for (let g = 0; g < 6; g++) { const gy = i * ph + 3 + r() * (ph - 6); x.beginPath(); x.moveTo(u, gy); x.bezierCurveTo(u + L * 0.3, gy + (r() - 0.5) * 6, u + L * 0.7, gy + (r() - 0.5) * 6, u + L, gy); x.stroke(); }
      x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(u, i * ph, 2, ph); u += L; }
    x.fillStyle = 'rgba(0,0,0,0.4)'; x.fillRect(0, i * ph, w, 2); } });
// a row of transom panes: whitewashed frame, dark glass (yardbird_front_straight: the band of panes over the doors)
const transomTex = (panes) => cvs(panes * 128, 100, (x, w, h) => { x.fillStyle = '#d3ccbf'; x.fillRect(0, 0, w, h);
  for (let i = 0; i < panes; i++) { const g = x.createLinearGradient(0, 10, 0, h - 10); g.addColorStop(0, '#3b3530'); g.addColorStop(1, '#1d1a17');
    x.fillStyle = g; x.fillRect(i * 128 + 9, 11, 110, h - 22); x.fillStyle = 'rgba(255,240,220,0.08)'; x.fillRect(i * 128 + 14, 14, 30, h - 28); } }, false);

// world projected UVs: fn(blenderX, blenderY, z) -> [u, v]
function setUV(o, fn) { o.updateMatrixWorld(true); const g = o.geometry = o.geometry.clone(), p = g.attributes.position, W = o.matrixWorld, v = new THREE.Vector3(), a = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(W); const [u, w] = fn(v.x, -v.z, v.y); a[2 * i] = u; a[2 * i + 1] = w; }
  g.setAttribute('uv', new THREE.BufferAttribute(a, 2)); }
// a quad from four Blender points (x, y, z), uv per corner
function quad(P, uv, mat, name) { const g = new THREE.BufferGeometry(), V = P.map(q => B2T(q[0], q[1], q[2]));
  g.setAttribute('position', new THREE.Float32BufferAttribute(V.flatMap(v => [v.x, v.y, v.z]), 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv.flat(), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]); g.computeVertexNormals(); const m = new THREE.Mesh(g, mat); m.name = name; m.userData.frontsfix = true; return m; }

const YU = [0.9257, 0.3781], YN = [-0.3781, 0.9257];   // Yardbird facade direction and inward normal (Blender)
function p3Fixes(area, nodes, out, inv) {
  const rows = new Map(inv.inventory.filter(r => r.bbox).map(r => [r.name, r]));
  const once = (k) => { if (area.userData['fx3_' + k]) return false; area.userData['fx3_' + k] = true; return true; };
  // ---- Yardbird (yardbird interior-3 and 43810871-3: white painted brick, grey brown plank floor, plank ceiling on close
  //      dark joists, black and white photographs, dining tables up to the folding doors) ----
  if (nodes.get('yb_int_back') && once('yb')) {
    const along = (x, y) => x * YU[0] + y * YU[1], across = (x, y) => x * YN[0] + y * YN[1];
    const wall = std('frontsfix_yb_whitebrick', { map: brickTex(), roughness: 0.85 });
    nodes.get('yb_int_back').traverse(o => { if (o.isMesh) { setUV(o, (x, y, z) => [along(x, y) / 0.6, z / 0.6]); o.material = wall; } });
    const floor = std('frontsfix_yb_planks', { map: plankTex(5, [128, 118, 106], 26, 0.19, 0.18), roughness: 0.5 });
    for (const nm of ['yb_int_floor', 'mbf_floor_133_0']) { const t = nodes.get(nm); t && t.traverse(o => { if (o.isMesh) { setUV(o, (x, y) => [along(x, y) / 2.4, across(x, y) / 2.4]); o.material = floor; } }); }
    const ceil = std('frontsfix_yb_ceiling', { map: plankTex(9, [112, 78, 52], 30, 0.14, 0.25), roughness: 0.7 });
    const c = nodes.get('yb_ceiling'); c && c.traverse(o => { if (o.isMesh) { setUV(o, (x, y) => [y / 2.4, x / 2.4]); o.material = ceil; } });
    // black and white photographs in the three frames (was a blurred blue painting)
    const bw = std('frontsfix_yb_bwphoto', { map: photoTex('fx_yb_bwphoto.jpg'), roughness: 0.4 });
    for (const nm of ['yb_art2', 'yb_art3', 'yb_art4']) { const t = nodes.get(nm), b = rows.get(nm)?.bbox; if (!t || !b) continue;
      const u0 = Math.min(along(b[0], b[1]), along(b[3], b[4])), u1 = Math.max(along(b[0], b[1]), along(b[3], b[4]));
      t.traverse(o => { if (o.isMesh) { setUV(o, (x, y, z) => [(along(x, y) - u0) / (u1 - u0), (z - b[2]) / (b[5] - b[2])]); o.material = bw; } }); }
    out.mats.push('yb interior: white brick, plank floor and ceiling, b/w photos');
    // joists: three more between each pair of beams (photo: close dark joists), clipped at the facade like the beams
    let nj = 0; for (let i = 0; i < 8; i++) { const t = nodes.get('r9zzp_yb_beam' + i); if (!t || !t.parent) continue;
      for (const f of [0.25, 0.5, 0.75]) { const cpy = t.clone(true); cpy.position.x += 1.6667 * f; cpy.userData = { ...t.userData, frontsfixCopy: 'joist' }; t.parent.add(cpy); clipBeam(cpy, { clipped: [] }, 'joist'); nj++; } }
    out.added.push('yb joists ' + nj);
    // three table sets in the empty strip behind the folding doors (copies of yb_set_back1_0, 1.5 m inside the facade,
    // clear of the other sets, the banquette and the leaves by bbox)
    const src = nodes.get('yb_set_back1_0'), sb = rows.get('yb_set_back1_0')?.bbox;
    if (src && src.parent && sb) { const sx = (sb[0] + sb[3]) / 2, sy = (sb[1] + sb[4]) / 2;
      for (const cx of [-45.6, -43.6, -41.8]) { const cpy = src.clone(true); cpy.position.add(B2T(cx - sx, ybFacadeY(cx) + 1.5 - sy, 0)); cpy.userData = { ...src.userData, frontsfixCopy: 'yb set' }; src.parent.add(cpy); }
      out.added.push('yb 3 table sets'); }
    // transom row over the folding bank and over the window bay (fills the open band between the door heads and the
    // brick fascia, where the beam ends showed)
    for (const [x0, x1, z0, z1, tag] of [[-47.5, -35.86, 2.55, 3.06, 'bank'], [-35.35, -32.86, 2.62, 3.06, 'bay']]) {
      const L = (x1 - x0) / YU[0], panes = Math.max(2, Math.round(L / 0.62)), yi = 0.04;
      const m = std('frontsfix_yb_transom_' + tag, { map: transomTex(panes), roughness: 0.25, side: THREE.DoubleSide });
      const p0 = [x0, ybFacadeY(x0) + yi], p1 = [x1, ybFacadeY(x1) + yi];
      area.add(quad([[...p0, z0], [...p1, z0], [...p1, z1], [...p0, z1]], [[0, 0], [1, 0], [1, 1], [0, 1]], m, 'frontsfix_yb_transom_' + tag)); }
    out.added.push('yb transom rows');
  }
  // ---- Starbucks (ROOM_103; inside-order-area.jpg, venetian-convention-center-1: gold siren on a black panel over the
  //      back bar, framed menu boards, light oak stools at the bar counter) ----
  const b5 = rows.get('r103_b5')?.bbox, b0 = rows.get('r103_b0')?.bbox;
  if (b5 && b0 && nodes.get('r103_b5') && once('sb')) {
    const U = [0.950, 0.313], N = [-0.313, 0.950], rot = Math.atan2(N[0], -N[1]);   // back bar direction, customer side normal (fitted to the r103 boxes); b5's front face is 0.17 m in front of its bbox centre, b0's 0.41 m
    const c5 = [(b5[0] + b5[3]) / 2, (b5[1] + b5[4]) / 2];
    const at = (c, du, dn, z) => B2T(c[0] + U[0] * du + N[0] * dn, c[1] + U[1] * du + N[1] * dn, z);
    const black = std('frontsfix_sb_black', { color: 0x141312, roughness: 0.7 });
    const band = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.0, 0.05), black); band.position.copy(at(c5, 0, 0.14, 2.77)); band.rotation.y = rot; band.name = 'frontsfix_sb_sirenband';
    const siren = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.0), std('frontsfix_sb_siren', { map: photoTex('fx_sb_siren.jpg'), roughness: 0.45, metalness: 0.2 }));
    siren.position.copy(at(c5, 0, 0.17, 2.77)); siren.rotation.y = rot; siren.name = 'frontsfix_sb_siren';
    const menu = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.62), std('frontsfix_sb_menu', { map: photoTex('fx_sb_menu.jpg'), roughness: 0.5 }));
    menu.position.copy(at(c5, 0, 0.19, 1.86)); menu.rotation.y = rot; menu.name = 'frontsfix_sb_menu';
    for (const m of [band, siren, menu]) { m.userData.frontsfix = true; area.add(m); }
    // seven bar stools along the customer side of the front counter r103_b0 (0.95 m, bar height)
    const U0 = [0.950, 0.313], N0 = [-0.313, 0.950], c0 = [(b0[0] + b0[3]) / 2, (b0[1] + b0[4]) / 2];
    const oak = std('frontsfix_sb_oak', { color: 0xb88a5a, roughness: 0.55 }), seat = std('frontsfix_sb_seat', { color: 0x7d6e66, roughness: 0.7 });
    const legG = new THREE.CylinderGeometry(0.014, 0.017, 0.74, 8), seatG = new THREE.CylinderGeometry(0.19, 0.18, 0.06, 20), ringG = new THREE.TorusGeometry(0.15, 0.01, 6, 20), backG = new THREE.BoxGeometry(0.34, 0.12, 0.03);
    const zf = 0.065;
    for (let k = -3; k <= 3; k++) { const s = new THREE.Group(); s.name = 'frontsfix_sb_stool' + (k + 3); s.userData.frontsfix = true;
      for (const [lx, lz] of [[0.12, 0.12], [-0.12, 0.12], [0.12, -0.12], [-0.12, -0.12]]) { const l = new THREE.Mesh(legG, oak); l.position.set(lx, 0.37, lz); l.rotation.set(-lz * 0.25, 0, lx * 0.25); s.add(l); }
      const st = new THREE.Mesh(seatG, seat); st.position.y = 0.76; s.add(st); const rg = new THREE.Mesh(ringG, oak); rg.rotation.x = Math.PI / 2; rg.position.y = 0.3; s.add(rg);
      const bk = new THREE.Mesh(backG, oak); bk.position.set(0, 0.98, 0.17); s.add(bk);
      s.position.copy(B2T(c0[0] + U0[0] * k * 0.72 + N0[0] * 0.79, c0[1] + U0[1] * k * 0.72 + N0[1] * 0.79, zf)); s.rotation.y = Math.atan2(N0[0], -N0[1]); area.add(s); }
    out.added.push('sb siren panel, menu boards, 7 stools');
  }
  // ---- Nomikai back bar (nomikai_speakeasy_interior_bar: dense shelves of whisky, sake and clear bottles): the 74 red and
  //      black boxes (nk_sh*_*, rr_bottle_dark, nk_red_box) are parked and each shelf row is filled with lathe bottles every
  //      85 mm along its own line, most with a paper label ----
  const nkRows = new Map(); for (const [nm, r] of rows) { const m = /^nk_sh(\d+)_\d+$/.exec(nm); if (m && nodes.get(nm)) { if (!nkRows.has(m[1])) nkRows.set(m[1], []); nkRows.get(m[1]).push(r); } }
  if (nkRows.size && once('nk')) {
    const prof = [[0, 0], [0.034, 0], [0.034, 0.17], [0.03, 0.2], [0.014, 0.235], [0.011, 0.3], [0, 0.3]].map(([a, b]) => new THREE.Vector2(a, b));
    const bottleG = new THREE.LatheGeometry(prof, 14), labelG = new THREE.CylinderGeometry(0.0347, 0.0347, 0.07, 14, 1, true); labelG.translate(0, 0.1, 0);
    const mats = [[0.33, 0.13, 0.03], [0.05, 0.13, 0.06], [0.62, 0.66, 0.62], [0.12, 0.05, 0.02], [0.45, 0.22, 0.06]].map((c, i) => std('frontsfix_nk_bottle' + i, { color: new THREE.Color().setRGB(...c, THREE.LinearSRGBColorSpace), roughness: 0.12, metalness: 0.1 }));
    const label = std('frontsfix_nk_label', { color: 0xe8e0cc, roughness: 0.8 });
    const pos = mats.map(() => []), lab = []; const r = rngOf(23); let parked = 0;
    for (const [, list] of nkRows) {
      const cs = list.map(q => [(q.bbox[0] + q.bbox[3]) / 2, (q.bbox[1] + q.bbox[4]) / 2, q.bbox[2]]);
      let a = cs[0], b = cs[0], best = -1; for (const p of cs) for (const q of cs) { const d = Math.hypot(p[0] - q[0], p[1] - q[1]); if (d > best) { best = d; a = p; b = q; } }
      const L = Math.max(best, 0.01), ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, z0 = Math.min(...cs.map(p => p[2]));
      for (let t = 0; t <= L + 1e-6; t += 0.085) { const k = Math.floor(r() * mats.length), h = 0.8 + r() * 0.35;
        const M = new THREE.Matrix4().compose(B2T(a[0] + ux * t, a[1] + uy * t, z0), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28), new THREE.Vector3(1, h, 1));
        pos[k].push(M); if (r() < 0.8) lab.push(M); }
      for (const q of list) { const t = nodes.get(q.name); if (t && t.parent) { t.parent.remove(t); parked++; } } }
    const inst = (g, m, list, nm) => { if (!list.length) return; const im = new THREE.InstancedMesh(g, m, list.length); list.forEach((M, i) => im.setMatrixAt(i, M)); im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.name = nm; im.userData.frontsfix = true; area.add(im); };
    mats.forEach((m, i) => inst(bottleG, m, pos[i], 'frontsfix_nk_bottles' + i)); inst(labelG, label, lab, 'frontsfix_nk_labels');
    out.parked.push('nk shelf boxes x' + parked); out.added.push('nk bottles ' + pos.reduce((s, l) => s + l.length, 0));
  }
  // ---- Matteo bay 1.3 (vegasready_0109_matteo_front: a dim room behind dark glass, warm light washing a fluted wall):
  //      since its interior walls were parked the glass looked through to the Donutique junction. A shallow room closes
  //      it: fluted, warm washed back wall 1.4 m behind the glass, dark oak floor, dark ceiling, side returns ----
  const gb = rows.get('mt2_glass1.3')?.bbox;
  if (gb && nodes.get('mt2_glass1.3') && once('mt')) {
    const A = [gb[0], gb[1]], B = [gb[3], gb[4]], L = Math.hypot(B[0] - A[0], B[1] - A[1]), ux = (B[0] - A[0]) / L, uy = (B[1] - A[1]) / L, ix = uy, iy = -ux;   // inward: away from the corridor (+y side)
    const D = 1.4, z0 = 0.05, z1 = 3.4, Ai = [A[0] + ix * 0.05, A[1] + iy * 0.05], Bi = [B[0] + ix * 0.05, B[1] + iy * 0.05], Ad = [A[0] + ix * D, A[1] + iy * D], Bd = [B[0] + ix * D, B[1] + iy * D];
    const back = std('frontsfix_mt13_back', { map: cvs(1024, 512, (x, w, h) => { x.fillStyle = '#2b1e16'; x.fillRect(0, 0, w, h);
        for (let i = 0; i < w; i += 16) { x.fillStyle = (i / 16) % 2 ? 'rgba(255,220,180,0.05)' : 'rgba(0,0,0,0.18)'; x.fillRect(i, 0, 8, h); }
        for (const cxp of [0.12, 0.38, 0.62, 0.88]) { const gx = cxp * w, g = x.createRadialGradient(gx, h * 0.45, 10, gx, h * 0.45, 170); g.addColorStop(0, 'rgba(235,160,90,0.55)'); g.addColorStop(1, 'rgba(235,160,90,0)'); x.fillStyle = g; x.fillRect(gx - 180, 0, 360, h); }
        x.fillStyle = '#170f0b'; x.fillRect(0, h * 0.74, w, h * 0.26); x.fillStyle = '#8a6a3c'; x.fillRect(0, h * 0.735, w, 4); }, false), roughness: 0.75 });
    const dark = std('frontsfix_mt13_dark', { color: 0x1b1410, roughness: 0.8 }), fl = std('frontsfix_mt13_floor', { map: plankTex(31, [70, 50, 36], 18, 0.18, 0.3), roughness: 0.45 });
    const g = new THREE.Group(); g.name = 'frontsfix_mt13_room';
    g.add(quad([[...Ad, z0], [...Bd, z0], [...Bd, z1], [...Ad, z1]], [[0, 0], [1, 0], [1, 1], [0, 1]], back, 'frontsfix_mt13_back'));
    g.add(quad([[...Ai, z0], [...Bi, z0], [...Bd, z0], [...Ad, z0]], [[0, 0], [L / 2.4, 0], [L / 2.4, D / 2.4], [0, D / 2.4]], fl, 'frontsfix_mt13_floor'));
    g.add(quad([[...Ai, z1], [...Bi, z1], [...Bd, z1], [...Ad, z1]], [[0, 0], [1, 0], [1, 1], [0, 1]], dark, 'frontsfix_mt13_ceiling'));
    g.add(quad([[...Ai, z0], [...Ad, z0], [...Ad, z1], [...Ai, z1]], [[0, 0], [1, 0], [1, 1], [0, 1]], dark, 'frontsfix_mt13_sideW'));
    g.add(quad([[...Bi, z0], [...Bd, z0], [...Bd, z1], [...Bi, z1]], [[0, 0], [1, 0], [1, 1], [0, 1]], dark, 'frontsfix_mt13_sideE'));
    for (const m of [back, dark, fl]) m.side = THREE.DoubleSide; area.add(g); out.added.push('mt 1.3 shallow room');
  }
}

// ---------- round 2 P1 (walkfix, sweep_cand_r2 walk_west_b_005): Yardbird's west side was open, nothing between the
// pier yb_pier0 and the back wall yb_int_back (x -47.7 to -49.3, y -15.0 to -11.6), so the corridor looked into the room.
// The side is closed on the pier's west face line, which runs straight back (along the facade normal) to the back wall's
// west end (4.0 m). ryan_1016 yardbird_nomikai_corner and _ref_by_place yardbird_corridor_west show that end of the row as
// a cream painted wall with large framed windows and grey green trim: cream wall 0.25 m thick, three framed windows
// (sill 0.85, head 2.6) with dark sashes and dim glass onto the Yardbird room, grey green casings, skirting and dado rail.
// Added once per page (the area holding yb_pier0 and yb_int_back); data untouched.
function ybWestWall(area, nodes, out, report) {
  if (!nodes.get('yb_pier0') || !nodes.get('yb_int_back') || report._fxYbWest) return; report._fxYbWest = true;
  const F = [-47.737, -15.268], N = [-0.3781, 0.9257], U = [0.9257, 0.3781];   // pier front west corner; along the side; inward (east, into the room)
  const th = Math.atan2(N[1], N[0]);   // local +X -> Blender N, local +Z -> Blender U
  const cream = std('frontsfix_ybw_cream', { color: new THREE.Color().setRGB(0.80, 0.74, 0.62, THREE.LinearSRGBColorSpace), roughness: 0.8 });
  const sage = std('frontsfix_ybw_trim', { color: new THREE.Color().setRGB(0.27, 0.32, 0.27, THREE.LinearSRGBColorSpace), roughness: 0.55 });
  const sash = std('frontsfix_ybw_sash', { color: new THREE.Color().setRGB(0.03, 0.03, 0.028, THREE.LinearSRGBColorSpace), roughness: 0.45 });
  const glass = std('frontsfix_ybw_glass', { color: 0x1a1714, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.55, depthWrite: false });
  const g = new THREE.Group(); g.name = 'frontsfix_yb_westwall'; g.userData.frontsfix = true;
  const box = (s0, s1, t0, t1, z0, z1, mat, nm) => { const sm = (s0 + s1) / 2, tm = (t0 + t1) / 2;
    const m = new THREE.Mesh(new THREE.BoxGeometry(s1 - s0, z1 - z0, t1 - t0), mat); m.name = 'frontsfix_ybw_' + nm; m.userData.frontsfix = true;
    m.position.copy(B2T(F[0] + N[0] * sm + U[0] * tm, F[1] + N[1] * sm + U[1] * tm, (z0 + z1) / 2)); m.rotation.y = th; g.add(m); return m; };
  const S0 = 0.25, S1 = 4.1, T0 = 0, T1 = 0.25, Z1 = 3.85;   // starts inside the pier (pier spans s 0 to 0.41), ends inside the back wall
  const win = [[0.62, 1.48], [1.72, 2.58], [2.82, 3.68]], sill = 0.85, head = 2.6;
  // wall: piers between the openings, panels under the sills and over the heads
  let s = S0; for (const [a, b] of win) { box(s, a, T0, T1, 0, Z1, cream, 'wall'); box(a, b, T0, T1, 0, sill, cream, 'under'); box(a, b, T0, T1, head, Z1, cream, 'over'); s = b; }
  box(s, S1, T0, T1, 0, Z1, cream, 'wall');
  // trim on the corridor face (t < 0): skirting, dado rail, casings around each window
  box(S0, S1, -0.02, 0, 0, 0.16, sage, 'skirt');
  let r = S0; for (const [a, b] of win) { box(r, a - 0.08, -0.02, 0, 0.84, 0.9, sage, 'dado'); r = b + 0.08; } box(r, S1, -0.02, 0, 0.84, 0.9, sage, 'dado');
  for (const [a, b] of win) {
    box(a - 0.08, a, -0.035, 0.02, sill - 0.04, head + 0.08, sage, 'casL'); box(b, b + 0.08, -0.035, 0.02, sill - 0.04, head + 0.08, sage, 'casR');
    box(a - 0.08, b + 0.08, -0.035, 0.02, head, head + 0.08, sage, 'casH'); box(a - 0.1, b + 0.1, -0.06, 0.04, sill - 0.05, sill, sage, 'sill');
    // sash in the middle of the wall: frame, one mullion, two transoms (four tall lights over a low pair, as in the photo)
    const t0 = 0.1, t1 = 0.14, f = 0.045;
    box(a, a + f, t0, t1, sill, head, sash, 'sashL'); box(b - f, b, t0, t1, sill, head, sash, 'sashR');
    box(a, b, t0, t1, sill, sill + f, sash, 'sashB'); box(a, b, t0, t1, head - f, head, sash, 'sashT');
    box((a + b) / 2 - 0.015, (a + b) / 2 + 0.015, t0, t1, sill, head, sash, 'mull'); box(a, b, t0, t1, 2.05, 2.08, sash, 'tran');
    box(a + f, b - f, 0.118, 0.122, sill + f, head - f, glass, 'glass'); }
  // top cap over the wall where it meets the corridor soffit line of the fascia (3.85)
  box(S0, S1, -0.03, T1, Z1 - 0.06, Z1, sage, 'cap');
  area.add(g); out.added.push('yb west wall: cream, 3 framed windows, trim (' + g.children.length + ' parts)');
}
