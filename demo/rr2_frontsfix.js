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
  // Delmonico side panels, headers, pilaster casings: dark walnut burl (IMG_5420), was a saturated orange marble (metallic 0.3
  // tinted the reflections orange; the ramp read too light under the bake)
  rr_del_plaster: (m) => { const r = node(m, 'Color Ramp'), p = node(m, 'Principled BSDF'); if (!r || !p) return 'graph changed, skipped';
    r.ramp.stops = [[0.36, [0.016, 0.0075, 0.0035, 1]], [0.58, [0.042, 0.020, 0.009, 1]], [0.8, [0.095, 0.050, 0.022, 1]]];
    p.in.Metallic = 0; p.in.Roughness = 0.3; p.in['Coat Weight'] = 0.8; p.in['Coat Roughness'] = 0.05; return 'walnut burl ramp, metallic 0'; },
  // Delmonico double doors: real walnut grain, vertical, box projected (was a flat orange procedural)
  rr_del_door_oak: () => boxImage('american_walnut_veneer_diff_2k.jpg', [0.9, 0.9, 0.9], [0.78, 0.62, 0.5, 1], { Roughness: 0.38, 'Coat Weight': 0.45, 'Coat Roughness': 0.1 }),
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
  RR_Stone_CreamLimestone: () => boxImage('Travertine009_2K-JPG_Color.jpg', [0.55, 0.55, 0.55], [1.0, 0.86, 0.64, 1], { Roughness: 0.55, 'Specular IOR Level': 0.35 }),
};

export function frontsfixExtra(extra, report = {}) {
  if (!on() || !extra || !extra.materials) return;
  const out = report.frontsfix ||= { mats: [], parked: [], clipped: [], added: [] };
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

const B2T = (x, y, z) => new THREE.Vector3(x, z, -y);   // Blender -> three

// quantized (normalized Int16, often interleaved) positions cannot leave their own box; edits go on a float copy
function floatPositions(o) { const g = o.geometry = o.geometry.clone(), q = g.attributes.position, a = new Float32Array(q.count * 3);
  for (let i = 0; i < q.count; i++) { a[i * 3] = q.getX(i); a[i * 3 + 1] = q.getY(i); a[i * 3 + 2] = q.getZ(i); }
  g.setAttribute('position', new THREE.BufferAttribute(a, 3)); return g; }

function clipBeam(top, out, nm) {
  top.updateMatrixWorld(true); let n = 0;
  top.traverse(o => { if (!o.isMesh) return;
    const g = floatPositions(o), p = g.attributes.position, W = o.matrixWorld, I = W.clone().invert(), v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(W); const yf = ybFacadeY(v.x) + 0.3;
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
  // 1. Yardbird: beams end 0.3 m inside the facade (they ran 5 m out across the corridor and the sign)
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
}
