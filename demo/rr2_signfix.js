// Signage fixes (URL flag signfix=1, default off). Viewer side only; the .blend fixes are listed in agent_signfix/REPORT.md.
// 1. Image_59 (Material_368, the green CAFE disc at the Palazzo cafe, mt31 Mesh_1069) is a packed texture that spells
//    'CAFÃ‰': the word CAFÉ with its UTF-8 bytes read as cp1252, baked into the pixels. tex/pal_cafe_sign.png is the
//    same size, colour and orientation (stored upside down like the original) spelling CAFÉ.
// 2. The poker kiosk screens pk_scr and pk_scr_back (mt32, pal_poker_screen) are one flat box mesh whose two big faces
//    share one UV projection. Each copy sits with its readable face toward the kiosk body, so the side a visitor sees
//    reads mirrored. Flipping U on both copies makes both outward faces read correctly.
// 3. DELMONICO channel letters ent_L0..ent_L8 (mt31, DEL_Entrance) sit at equal centre steps along the arc, so the
//    narrow I gets wide gaps and M O N crowd ('DELMON I CO'). They are moved along the same arc so every gap is equal,
//    keeping the word's outer edges where they were.
// 4. LOWER_HALL_columns_mural_Starbucks_wrap_0009 (mt20, V43_Downstairs, Material_34.002) is the old imported Starbucks
//    blade logo: blurry, rainbow tinted and half inside the soffit, 0.7 m above the rebuilt one (rs_sbc_logo, CL_RealStairs).
//    It is removed from the scene, which leaves one logo.
// 5. The CAFE text plane Mesh_1069 (Material_368) does not lie on its green disc Mesh_1068 (Material_367): both meshes
//    have the same slanted local plane, but the disc's object scale has a negative X, which mirrors its tilt, so the two
//    planes cross at about 17 degrees. The text runs from 11 cm behind the disc (u 0) to 18 cm in front of it (u 1) and
//    meets it at u 0.385: everything left of that is hidden inside the disc and the strip next to it z fights. With the
//    packed texture that hid 'CA' (the sign read 'FA...'); with the centred pal_cafe_sign.png it hides the C and breaks the
//    A ('AFE' in broken strokes). The text plane is turned about its own centre onto the disc's plane and set 1 cm in
//    front of it, on the side its centre was already on (the side visitors see).
// 6. Swapping Image_59 through info.url only reached the node graph's own sampler. GLTFLoader also gave Material_368 the
//    GLB's embedded Image_59 as its map (and normalMap): three's map_fragment multiplies diffuseColor by it, the graph then
//    overwrites rgb but only multiplies alpha, so the sign's alpha was old CAFE mojibake alpha times new CAFE alpha, and
//    only the strokes where both texts overlap survived (the broken '+ AB' / '4 A 3' glyphs in integA2). The glTF
//    textures named in SIGNFIX_IMAGES get the replacement image too, decoded unflipped (glTF orientation).
// 7. r3 guards (agent flagset3, Oct 14). apply_fixes_v2.py (agent_blendfix2) makes fixes 1 to 5 in the .blend (steps
//    cafe_texture, pk_scr_uv, ent_L_spacing, starbucks_old_logo, cafe_plane; the port also parks the old Starbucks logo),
//    so each fix here first checks whether its target is already fixed and then does nothing:
//    1: the .blend packs the replacement as Image_59_cafe_fixed; when the export lists that name (SIGNFIX_DONE) or no
//       longer lists Image_59, no image is swapped.
//    2: the U flip runs only while the outward face of each screen (the face turned away from the other screen) has the
//       UV handedness of the master export, measured on gpu_test/data/mt32 002.glb (agent_flagset3/tools, glTF UVs, three
//       world axes): sign((dP/du x dP/dv) . n) = +1 on the outward faces of both pk_scr and pk_scr_back. After the .blend
//       flip it is -1 and nothing changes. Without the partner screen in the area nothing is flipped.
//    3: the letters are respaced only while their gaps differ by more than 15 mm (the master export: 32 to 162 mm, spread
//       130 mm, measured by agent_flagset3/tools on mt31; equal gaps after a respace leave a few mm from the slerp).
//    4: a parked object is simply absent.
//    5: the text plane is turned only while it crosses the disc at 17 degrees, within 2, (the known defect, 16.95 on the master
//       export of mt31); under 0.5 degrees
//       it is already on the plane and stays where it is.
import * as THREE from 'three';

export const SIGNFIX_IMAGES = { Image_59: new URL('./tex/pal_cafe_sign.png', import.meta.url).href };
export const SIGNFIX_DONE = { Image_59: 'Image_59_cafe_fixed' };
const UFLIP = new Set(['pk_scr', 'pk_scr_back']);
const UFLIP_PAIR = { pk_scr: 'pk_scr_back', pk_scr_back: 'pk_scr' }, UFLIP_BAD = 1;
const PLANE_DEFECT = { deg: 17.0, tol: 2.0, done: 0.5 }, GAP_EQUAL = 0.015;
const HIDE = new Set(['LOWER_HALL_columns_mural_Starbucks_wrap_0009']);
const ONPLANE = [{ quad: 'Mesh_1069', disc: 'Mesh_1068', gap: 0.01 }];
const WORDS = [{ names: ['ent_L0', 'ent_L1', 'ent_L2', 'ent_L3', 'ent_L4', 'ent_L5', 'ent_L6', 'ent_L7', 'ent_L8'] }];

// 8. r8f tables (agent vsign, Oct 15, keyed by Blender object name on the r8f export; each entry checks its own defect
//    first and does nothing when the target is absent or already right, so a .blend fix turns it off by itself):
//    HIDE_IF: STARBUCKS_screen_0005 (mt20c, V43_Downstairs, Material_8.002 with Image_9) is the old imported vertical
//      STARBUCKS wordmark. The rebuilt facade (CL_SB_Facade cl_sbf_wordmark on the walnut panel) left it on the side of the
//      pier, half inside the new rs_pierL, where only 'UCKS' shows, upside down (sweep K6 W027y240p40). The photos show
//      one vertical STARBUCKS, on the walnut panel. Removed only while the rebuilt wordmark is in the same area.
//    UNBURY: sug_neon_txt (gjM2c, mt10, SUG_Corner, 2490 face text mesh, z 1.754 to 3.371) runs 0.32 m up into the
//      sug_ch_top header box (z 3.05 to 3.83, same plan footprint), so 'SU' sits inside it and the header's front lip hides
//      'GA' from the corridor (sweep: 'RCANE'). The text is moved down until its top sits gap metres under the header
//      plus drop metres more for the lip (default 0.30, measured on the W004 and SUGneon renders).
//    CAPFILL: Path_46 (gjM2c, mt21c, CL_MilosSign, mil_fish_teal) has its bevelled side walls but no front or back cap
//      (194 open boundary edges in two loops; its neighbour tiles are closed), so the tile reads as a hollow outline
//      (sweep W044y060p80). Each open loop is closed with a flat cap (ShapeUtils triangulation in the loop's plane). A
//      closed tile has no open loop and is left alone.
//    MENU: yb_menu_face (gjM2c, mt11c, YRD_Frontage) is a six face box with no UV layer and material yb_menu2, a flat
//      pale green emission: the lightbox is blank in the .blend too. It gets a planar UV on its two big faces and a
//      stand in menu (tex/yb_menu.png, drawn by agent_vsign/tools/mkmenu.py on the yb_menu2 emission colour). Left alone
//      when the object already has UVs.
//    ENVK (after capture lighting, signfixLight): pk_body and pk_base (mt32c, nk_black_gloss, coat 0.6) take capture
//      B085 at the Milos front, 40 m away; their gloss mirrors B085's view (the Milos wall sign, read mirrored and
//      blurred, sweep W083y240p40, 'directory kiosk back shows the Milos screen'). While the object's capture is farther
//      than far metres its envMapIntensity is scaled by k on a copy of its material (base colour 0.01: the diffuse share
//      is negligible). A capture within far metres keeps the material as it is.
const HIDE_IF = { STARBUCKS_screen_0005: 'cl_sbf_wordmark' };
const UNBURY = [{ obj: 'sug_neon_txt', cover: 'sug_ch_top', gap: 0.03, drop: 0.30 }];
const CAPFILL = new Set(['Path_46']);
const MENU = { yb_menu_face: new URL('./tex/yb_menu.png', import.meta.url).href };
const ENVK = [{ names: ['pk_body', 'pk_base'], k: 0.1, far: 12 }];
// EMIT: small emissive letters whose Blender Emission Strength (Cycles, no bloom) turns them into one white block in the
// viewer (rr2_refbloom): vp_sign_sub 'BELLE DE NUIT' (vp_sub_white, 14, letters 10 cm tall). The strength in the area's
// material graph is lowered to the value here before compile, only while it is higher (sfemit_<material> overrides).
// Same cause, same cap: bmn_letter 'BAR MIA' (bmn_sign_white, 9), cl_sign_text (the ALL SPHERE ACCESS wayfinding text on
// cl_sign_panel, both faces, 5) and sug_sign_halo (the blue backing 3 cm behind the red vertical SUGARCANE window letters
// sug_vsign, 6, which washes the red letters out; Cycles B020 shows red letters with a soft glow).
const EMIT = { vp_sub_white: 3.0, bmn_letter: 3.0, cl_sign_text: 2.5, sug_sign_halo: 1.5 };

export const signfixOn = () => !!(globalThis.RR_FLAGS || {}).signfix;

// replacement images in glTF orientation for the GLB's own textures (map, normalMap ...), fetched once, early
const GLTF_BMP = new Map();
function gltfBitmap(name) {
  if (!GLTF_BMP.has(name)) GLTF_BMP.set(name, fetch(SIGNFIX_IMAGES[name]).then(r => { if (!r.ok) throw new Error(r.status + ' ' + SIGNFIX_IMAGES[name]); return r.blob(); })
    .then(b => createImageBitmap(b, { imageOrientation: 'from-image', premultiplyAlpha: 'none', colorSpaceConversion: 'none' }))
    .then(bmp => ({ bmp }), e => ({ error: String(e) })));
  return GLTF_BMP.get(name);
}
const MAP_SLOTS = ['map', 'normalMap', 'emissiveMap', 'alphaMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'bumpMap'];

// before compileAndApply: point the replaced images at their fixed files (rr2_scene.js reads info.url first)
export function signfixImages(extra) {
  if (!signfixOn()) return 0;
  for (const [mn, cap] of Object.entries(EMIT)) { const g = extra?.materials?.[mn]?.graph; if (!g) continue;
    const v = +((globalThis.RR_FLAGS || {})['sfemit_' + mn] ?? cap);
    for (const nd of g.nodes || []) if (nd.type === 'BSDF_PRINCIPLED' && nd.in && +nd.in['Emission Strength'] > v) {
      (globalThis.RR_SIGNFIX_EMIT ||= []).push(mn + ' ' + nd.in['Emission Strength'] + ' -> ' + v); nd.in = { ...nd.in, 'Emission Strength': v }; } }
  if (!extra?.images) return 0; let n = 0;
  for (const [name, url] of Object.entries(SIGNFIX_IMAGES)) {
    if (!extra.images[name]) continue;
    if (SIGNFIX_DONE[name] && extra.images[SIGNFIX_DONE[name]]) { (globalThis.RR_SIGNFIX_DONE ||= []).push(name + ' fixed in the .blend'); continue; }
    extra.images[name] = { ...extra.images[name], url }; gltfBitmap(name); n++; }
  return n;
}

// after loadArea (before mergeStatic): geometry and transform fixes, found by Blender name through the inventory
export function signfixArea(area, inv, report = {}) {
  if (!signfixOn()) return;
  const byNode = new Map(inv.inventory.filter(r => r.node).map(r => [r.node, r.name]));
  const nodes = new Map();   // Blender name -> top object of that glTF node
  area.traverse(o => { const nm = byNode.get(o.name); if (nm && !nodes.has(nm)) nodes.set(nm, o); });
  const out = report.signfix ||= { uflip: [], respaced: [], hidden: [], onplane: [], gltfTex: [] };
  // the GLB's own copies of the replaced images (one Texture object per GLB image, shared by every slot using it)
  const texs = new Set();
  area.traverse(o => { if (!o.isMesh) return; for (const m of (Array.isArray(o.material) ? o.material : [o.material])) for (const k of MAP_SLOTS) {
    const t = m && m[k]; if (t && !t.isCompressedTexture && !t.userData.signfix && Object.hasOwn(SIGNFIX_IMAGES, t.name)) texs.add(t); } });
  for (const t of texs) {
    t.userData.signfix = true; const r = (out.gltfTex ||= []);
    t.userData.signfixReady = gltfBitmap(t.name).then(({ bmp, error }) => {
      if (error) { r.push(t.name + ' failed: ' + error); return; }
      // memlean (rr2_assets.js): the texture's Source is shared and is closed after its upload, so the replacement
      // goes on a Source of its own (GLTF_BMP keeps the bitmap for the next area's copy)
      if (t.userData.memlean) t.source = new THREE.Source(bmp); else t.image = bmp;
      t.flipY = false; t.needsUpdate = true; r.push(t.name + ' ' + bmp.width + 'x' + bmp.height);
    });
  }
  // removed from the area before mergeStatic and the cull list (visible and userData.rrHide are rewritten by modes and cull)
  for (const nm of HIDE) { const top = nodes.get(nm); if (top && top.parent) { top.parent.remove(top); out.hidden.push(nm); } }
  // 8. r8f tables
  // EMIT, second half: a constant Principled graph reaches three as glTF factors (emissive x emissiveIntensity), not through
  // the graph, so the three material is capped too
  area.traverse(o => { if (!o.isMesh) return; for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
    if (!m || m.userData.signfixEmit || !Object.hasOwn(EMIT, m.name)) continue; m.userData.signfixEmit = true;
    const v = +((globalThis.RR_FLAGS || {})['sfemit_' + m.name] ?? EMIT[m.name]);
    if (m.emissiveIntensity > v) { (out.emit ||= []).push(m.name + ' emissiveIntensity ' + m.emissiveIntensity + ' -> ' + v); m.emissiveIntensity = v; } } });
  for (const [nm, keep] of Object.entries(HIDE_IF)) { const top = nodes.get(nm); if (!top || !top.parent) continue;
    if (!nodes.has(keep)) { (out.done ||= []).push('hide ' + nm + ' kept (no ' + keep + ' in this area)'); continue; }
    top.parent.remove(top); out.hidden.push(nm); }
  const FS = globalThis.RR_FLAGS || {};
  for (const u of UNBURY) { const o = nodes.get(u.obj), c = nodes.get(u.cover); if (!o || !c || !o.parent || o.userData.signfixUnbury) continue;
    o.updateWorldMatrix(true, true); c.updateWorldMatrix(true, true);
    const bo = new THREE.Box3().setFromObject(o), bc = new THREE.Box3().setFromObject(c);
    const overlapXZ = bo.min.x < bc.max.x && bo.max.x > bc.min.x && bo.min.z < bc.max.z && bo.max.z > bc.min.z;
    const lim = bc.min.y - u.gap;
    if (!overlapXZ || bo.max.y <= lim) { (out.done ||= []).push('unbury ' + u.obj + ' clear of ' + u.cover); continue; }
    const dy = bo.max.y - lim + +(FS.sfdrop ?? u.drop);
    const wp = o.getWorldPosition(new THREE.Vector3()); wp.y -= dy; o.position.copy(o.parent.worldToLocal(wp)); o.updateMatrixWorld(true);
    o.userData.signfixUnbury = true; (out.unbury ||= []).push(u.obj + ' down ' + (dy * 100).toFixed(1) + ' cm (top was ' + ((bo.max.y - bc.min.y) * 100).toFixed(1) + ' cm into ' + u.cover + ')'); }
  for (const nm of CAPFILL) { const top = nodes.get(nm); if (!top) continue;
    top.traverse(o => { if (!o.isMesh || o.userData.signfixCap) return; const r = capFill(o); o.userData.signfixCap = true;
      (r.caps ? (out.capfill ||= []) : (out.done ||= [])).push(r.caps ? nm + ' ' + r.caps + ' caps, ' + r.tris + ' triangles' : 'capfill ' + nm + ' closed (' + r.why + ')'); }); }
  for (const [nm, url] of Object.entries(MENU)) { const top = nodes.get(nm); if (!top) continue; const frame = nodes.get(nm.replace(/_face$/, '_frame'));
    top.traverse(o => { if (!o.isMesh || o.userData.signfixMenu) return; o.userData.signfixMenu = true;
      if (o.geometry.getAttribute('uv')) { (out.done ||= []).push('menu ' + nm + ' has UVs, left'); return; }
      const r = menuUV(o, frame); if (!r) { (out.done ||= []).push('menu ' + nm + ' no front face'); return; }
      const tex = new THREE.TextureLoader().load(url); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
      const src = Array.isArray(o.material) ? o.material[0] : o.material;
      const k = +(FS.sfmenuk ?? 2.0);   // yb_menu2 emission strength
      o.material = new THREE.MeshStandardMaterial({ name: (src && src.name ? src.name : 'menu') + '@menu', color: 0x000000, roughness: 0.5, emissive: 0xffffff, emissiveIntensity: k, emissiveMap: tex, side: THREE.DoubleSide });
      (out.menu ||= []).push(nm + ' ' + r); }); }
  for (const nm of UFLIP) {
    const top = nodes.get(nm); if (!top) continue;
    const h = outwardHand(top, nodes.get(UFLIP_PAIR[nm]));
    if (h !== UFLIP_BAD) { (out.done ||= []).push('uflip ' + nm + (h === 0 ? ' no partner or no uv' : ' reads correctly')); continue; }
    top.traverse(o => {
      if (!o.isMesh || o.userData.signfixU) return;
      const g = o.geometry = o.geometry.clone(); const uv = g.getAttribute('uv'); if (!uv) return;
      for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
      uv.needsUpdate = true; o.userData.signfixU = true; out.uflip.push(nm);
    });
  }
  for (const p of ONPLANE) {
    const q = nodes.get(p.quad), d = nodes.get(p.disc); if (!q || !d || q.userData.signfixPlane) continue;
    const ang = planeAngle(q, d);
    if (ang == null || ang < PLANE_DEFECT.done || Math.abs(ang - PLANE_DEFECT.deg) > PLANE_DEFECT.tol) { (out.done ||= []).push('onplane ' + p.quad + ' at ' + (ang == null ? '?' : ang.toFixed(2)) + ' deg, left'); continue; }
    const r = onPlane(q, d, p.gap); if (r) { q.userData.signfixPlane = true; (out.onplane ||= []).push(p.quad + ' ' + r); }
  }
  for (const w of WORDS) {
    const objs = w.names.map(n => nodes.get(n)); if (objs.some(o => !o)) continue;
    const sp = respace(objs, true); if (sp < GAP_EQUAL) { (out.done ||= []).push('respace ' + w.names[0] + ' gaps equal within ' + (sp * 1000).toFixed(1) + ' mm'); continue; }
    respace(objs); out.respaced.push(w.names[0] + '..' + w.names[w.names.length - 1]);
  }
}

// after assignCaptureLighting (rr2_probes.js): glossy objects whose capture is far away mirror an unrelated place (ENVK)
export function signfixLight(area, inv, report = {}) {
  if (!signfixOn()) return;
  const byNode = new Map(inv.inventory.filter(r => r.node).map(r => [r.node, r.name]));
  const nodes = new Map(); area.traverse(o => { const nm = byNode.get(o.name); if (nm && !nodes.has(nm)) nodes.set(nm, o); });
  const out = report.signfix ||= { uflip: [], respaced: [], hidden: [], onplane: [], gltfTex: [] };
  const copies = new Map(), bb = new THREE.Box3(), c = new THREE.Vector3();
  for (const e of ENVK) for (const nm of e.names) { const top = nodes.get(nm); if (!top) continue;
    top.traverse(o => { if (!o.isMesh || Array.isArray(o.material) || !o.material || o.material.userData.signfixEnv) return;
      const src = o.material, cp = src.userData && src.userData.box && src.userData.box.pos && src.userData.box.pos.value;
      if (!cp || !src.envMap) { (out.done ||= []).push('envk ' + nm + ' no capture'); return; }
      bb.setFromObject(o); bb.getCenter(c); const d = Math.hypot(c.x - cp.x, c.z - cp.z);
      if (d <= e.far) { (out.done ||= []).push('envk ' + nm + ' capture ' + d.toFixed(1) + ' m, left'); return; }
      const key = src.uuid + '|' + e.k; let m = copies.get(key);
      if (!m) { const ud = src.userData; src.userData = {}; m = src.clone(); src.userData = ud; m.userData = { ...ud, signfixEnv: true };
        m.defines = { ...src.defines }; m.onBeforeCompile = src.onBeforeCompile; m.customProgramCacheKey = src.customProgramCacheKey;
        m.envMapIntensity = (src.envMapIntensity ?? 1) * e.k; copies.set(key, m); }
      o.material = m; (out.envk ||= []).push(nm + ' capture ' + d.toFixed(1) + ' m, env x' + e.k); }); }
}

// close the open boundary loops of a mesh with flat caps (CAPFILL). Positions are welded at 0.01 mm; every attribute of a
// cap vertex is copied from its loop vertex, the normal is the loop plane's, turned away from the mesh centre.
function capFill(o) {
  const g = o.geometry, pa = g.getAttribute('position'); if (!pa) return { caps: 0, why: 'no position' };
  const ix = g.index, nI = ix ? ix.count : pa.count, vi = (i) => ix ? ix.getX(i) : i;
  const weld = new Map(), wid = new Int32Array(pa.count), rep = [];
  for (let i = 0; i < pa.count; i++) { const k = Math.round(pa.getX(i) * 1e5) + ',' + Math.round(pa.getY(i) * 1e5) + ',' + Math.round(pa.getZ(i) * 1e5);
    let w = weld.get(k); if (w === undefined) { w = rep.length; weld.set(k, w); rep.push(i); } wid[i] = w; }
  const edges = new Map(), ek = (a, b) => a < b ? a + '_' + b : b + '_' + a;
  for (let t = 0; t + 2 < nI; t += 3) for (let k = 0; k < 3; k++) { const a = wid[vi(t + k)], b = wid[vi(t + (k + 1) % 3)]; if (a === b) continue; const key = ek(a, b); edges.set(key, (edges.get(key) || 0) + 1); }
  const adj = new Map(); let nb = 0;
  for (const [key, cnt] of edges) { if (cnt !== 1) continue; nb++; const [a, b] = key.split('_').map(Number); (adj.get(a) || adj.set(a, []).get(a)).push(b); (adj.get(b) || adj.set(b, []).get(b)).push(a); }
  if (!nb) return { caps: 0, why: 'no open edge' };
  // chains are walked from their open ends first: Path_46's two rims each lack one edge (a non manifold edge where the
  // bevel meets itself), so each rim is a chain whose ends lie next to each other. A chain is a loop when it closes or its
  // ends are nearer than a tenth of its size.
  const used = new Set(), loops = [], starts = [...adj.keys()].sort((a, b) => adj.get(a).length - adj.get(b).length);
  for (const s of starts) { if (used.has(s)) continue; const loop = [s]; used.add(s); let prev = -1, cur = s;
    for (;;) { const nx = (adj.get(cur) || []).find(v => v !== prev && !used.has(v)); if (nx === undefined) break; loop.push(nx); used.add(nx); prev = cur; cur = nx; }
    if (loop.length < 3) continue;
    const closed = (adj.get(cur) || []).includes(s);
    if (!closed) { const b = new THREE.Box3(); for (const w of loop) b.expandByPoint(new THREE.Vector3().fromBufferAttribute(pa, rep[w]));
      const gap = new THREE.Vector3().fromBufferAttribute(pa, rep[s]).distanceTo(new THREE.Vector3().fromBufferAttribute(pa, rep[cur]));
      if (gap > 0.1 * b.getSize(new THREE.Vector3()).length()) continue; }
    loops.push(loop); }
  if (!loops.length) return { caps: 0, why: 'open edges form no closed loop' };
  const P = (w) => new THREE.Vector3().fromBufferAttribute(pa, rep[w]);
  const ctr = new THREE.Vector3(); for (let i = 0; i < pa.count; i++) ctr.add(new THREE.Vector3().fromBufferAttribute(pa, i)); ctr.divideScalar(pa.count);
  const capTris = [];   // [loop vertex (original index), normal]
  for (const loop of loops) {
    const pts = loop.map(P), n = new THREE.Vector3(), lc = new THREE.Vector3();
    for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; n.x += (a.y - b.y) * (a.z + b.z); n.y += (a.z - b.z) * (a.x + b.x); n.z += (a.x - b.x) * (a.y + b.y); lc.add(a); }
    if (n.lengthSq() < 1e-20) continue; n.normalize(); lc.divideScalar(pts.length);
    if (n.dot(lc.clone().sub(ctr)) < 0) n.negate();
    const u = new THREE.Vector3().crossVectors(n, Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize(), v = new THREE.Vector3().crossVectors(n, u);
    const c2 = pts.map(p => new THREE.Vector2(p.dot(u), p.dot(v)));
    const tris = THREE.ShapeUtils.triangulateShape(c2, []);
    for (const t of tris) capTris.push([rep[loop[t[0]]], rep[loop[t[1]]], rep[loop[t[2]]], n]);
  }
  if (!capTris.length) return { caps: 0, why: 'degenerate loops' };
  const names = Object.keys(g.attributes), total = nI + capTris.length * 3, ng = new THREE.BufferGeometry();
  const GET = ['getX', 'getY', 'getZ', 'getW'];
  for (const nm of names) { const a = g.attributes[nm], s = a.itemSize, arr = new Float32Array(total * s); let w = 0;
    for (let i = 0; i < nI; i++, w++) { const q = vi(i); for (let k = 0; k < s; k++) arr[w * s + k] = a[GET[k]](q); }
    for (const t of capTris) for (let j = 0; j < 3; j++, w++) {
      if (nm === 'normal') { arr[w * s] = t[3].x; arr[w * s + 1] = t[3].y; arr[w * s + 2] = t[3].z; }
      else for (let k = 0; k < s; k++) arr[w * s + k] = a[GET[k]](t[j]); }
    ng.setAttribute(nm, new THREE.BufferAttribute(arr, s)); }
  if (g.groups && g.groups.length) for (const gr of g.groups) ng.addGroup(gr.start, gr.count, gr.materialIndex);
  if (g.groups && g.groups.length) ng.addGroup(nI, capTris.length * 3, g.groups[g.groups.length - 1].materialIndex);
  ng.userData = { ...g.userData }; o.geometry = ng; ng.computeBoundingBox(); ng.computeBoundingSphere();
  return { caps: loops.length, tris: capTris.length };
}

// planar UV on the two big faces of a thin box (MENU): u across the face to the viewer's right, v up, seen from the side
// away from the frame (the side visitors see). Returns a short description or null.
function menuUV(o, frame) {
  o.updateWorldMatrix(true, false); const g = o.geometry, pa = g.getAttribute('position'), ix = g.index, nI = ix ? ix.count : pa.count;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), best = new THREE.Vector3(); let bl = 0;
  const W = (i, v) => v.fromBufferAttribute(pa, ix ? ix.getX(i) : i).applyMatrix4(o.matrixWorld);
  for (let t = 0; t + 2 < nI; t += 3) { W(t, a); W(t + 1, b); W(t + 2, c); n.subVectors(b, a).cross(c.clone().sub(a)); const l = n.length(); if (l > bl) { bl = l; best.copy(n).divideScalar(l); } }
  if (!bl) return null;
  const oc = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
  if (frame) { const fc = new THREE.Box3().setFromObject(frame).getCenter(new THREE.Vector3()); if (best.dot(oc.clone().sub(fc)) < 0) best.negate(); }
  best.y = 0; if (best.lengthSq() < 1e-6) return null; best.normalize();
  const up = new THREE.Vector3(0, 1, 0), right = new THREE.Vector3().crossVectors(best.clone().negate(), up).normalize();
  let r0 = Infinity, r1 = -Infinity, u0 = Infinity, u1 = -Infinity; const p = new THREE.Vector3();
  for (let i = 0; i < pa.count; i++) { p.fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld); const s = p.dot(right), t = p.y; r0 = Math.min(r0, s); r1 = Math.max(r1, s); u0 = Math.min(u0, t); u1 = Math.max(u1, t); }
  const uv = new Float32Array(pa.count * 2);
  for (let i = 0; i < pa.count; i++) { p.fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld); uv[2 * i] = (p.dot(right) - r0) / ((r1 - r0) || 1); uv[2 * i + 1] = (p.y - u0) / ((u1 - u0) || 1); }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return 'uv ' + ((r1 - r0) * 100).toFixed(0) + ' x ' + ((u1 - u0) * 100).toFixed(0) + ' cm, front ' + [best.x, -best.z].map(x => x.toFixed(2)).join(',');
}

// equal gaps along the arc through the letter origins (letters keep their height and outward offset); with measure set it
// changes nothing and returns the spread (max minus min, metres) of the gaps between neighbouring letters
function respace(objs, measure = false) {
  const n = objs.length; objs.forEach(o => o.updateWorldMatrix(true, true));
  const P = objs.map(o => o.position.clone()), Q = objs.map(o => o.quaternion.clone());
  const S = [0]; for (let i = 1; i < n; i++) S.push(S[i - 1] + Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z));
  // extent of each letter along the local arc tangent, relative to its origin (world space, xz plane)
  const ext = objs.map((o, i) => {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)]; const t = new THREE.Vector2(b.x - a.x, b.z - a.z).normalize();
    let lo = Infinity, hi = -Infinity; const v = new THREE.Vector3(), wp = new THREE.Vector3(); o.getWorldPosition(wp);
    o.traverse(m => { if (!m.isMesh) return; const p = m.geometry.getAttribute('position');
      for (let k = 0; k < p.count; k++) { v.fromBufferAttribute(p, k).applyMatrix4(m.matrixWorld); const s = (v.x - wp.x) * t.x + (v.z - wp.z) * t.y; lo = Math.min(lo, s); hi = Math.max(hi, s); } });
    return [lo, hi];
  });
  const left = S[0] + ext[0][0], right = S[n - 1] + ext[n - 1][1];
  const W = ext.reduce((a, e) => a + e[1] - e[0], 0), gap = (right - left - W) / (n - 1);
  if (measure) { const g = []; for (let i = 0; i + 1 < n; i++) g.push((S[i + 1] + ext[i + 1][0]) - (S[i] + ext[i][1])); return Math.max(...g) - Math.min(...g); }
  let edge = left;
  for (let i = 0; i < n; i++) {
    const s = edge - ext[i][0]; edge += ext[i][1] - ext[i][0] + gap;
    let k = 0; while (k < n - 2 && s > S[k + 1]) k++;
    const f = (s - S[k]) / ((S[k + 1] - S[k]) || 1);
    objs[i].position.lerpVectors(P[k], P[k + 1], f); objs[i].quaternion.slerpQuaternions(Q[k], Q[k + 1], f);
    objs[i].updateMatrixWorld(true);
  }
}

// world plane of an object's meshes: normal of its largest triangle, centre of its world bounding box
function worldPlane(obj) {
  obj.updateWorldMatrix(true, true); const box = new THREE.Box3(); let best = 0; const n = new THREE.Vector3();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e = new THREE.Vector3(), f = new THREE.Vector3();
  obj.traverse(m => { if (!m.isMesh) return; const p = m.geometry.getAttribute('position'), ix = m.geometry.index; const cnt = ix ? ix.count : p.count;
    for (let i = 0; i + 2 < cnt; i += 3) {
      a.fromBufferAttribute(p, ix ? ix.getX(i) : i).applyMatrix4(m.matrixWorld); b.fromBufferAttribute(p, ix ? ix.getX(i + 1) : i + 1).applyMatrix4(m.matrixWorld);
      c.fromBufferAttribute(p, ix ? ix.getX(i + 2) : i + 2).applyMatrix4(m.matrixWorld); box.expandByPoint(a).expandByPoint(b).expandByPoint(c);
      e.subVectors(b, a).cross(f.subVectors(c, a)); const l = e.length(); if (l > best) { best = l; n.copy(e).divideScalar(l); } } });
  return best > 0 ? { n, c: box.getCenter(new THREE.Vector3()) } : null;
}

// angle in degrees between the planes of obj and disc (largest triangle normals), or null
function planeAngle(obj, disc) {
  const D = worldPlane(disc), Q = worldPlane(obj); if (!D || !Q) return null;
  return THREE.MathUtils.radToDeg(Math.acos(Math.min(1, Math.abs(D.n.dot(Q.n)))));
}

// UV handedness of the face of top turned away from partner: the sign of the area weighted sum of
// (dP/du x dP/dv) . n over triangles whose normal points away from the partner's centre (0: no partner, no uv, no faces)
function outwardHand(top, partner) {
  if (!top || !partner) return 0;
  top.updateWorldMatrix(true, true); partner.updateWorldMatrix(true, true);
  const out = new THREE.Box3().setFromObject(top).getCenter(new THREE.Vector3()).sub(new THREE.Box3().setFromObject(partner).getCenter(new THREE.Vector3()));
  if (out.lengthSq() < 1e-8) return 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nn = new THREE.Vector3();
  const T = new THREE.Vector3(), B = new THREE.Vector3(), tb = new THREE.Vector3(); let sum = 0;
  top.traverse(m => { if (!m.isMesh) return; const p = m.geometry.getAttribute('position'), uv = m.geometry.getAttribute('uv'), ix = m.geometry.index; if (!p || !uv) return;
    const cnt = ix ? ix.count : p.count, g = (i) => ix ? ix.getX(i) : i;
    for (let i = 0; i + 2 < cnt; i += 3) { const i0 = g(i), i1 = g(i + 1), i2 = g(i + 2);
      a.fromBufferAttribute(p, i0).applyMatrix4(m.matrixWorld); b.fromBufferAttribute(p, i1).applyMatrix4(m.matrixWorld); c.fromBufferAttribute(p, i2).applyMatrix4(m.matrixWorld);
      e1.subVectors(b, a); e2.subVectors(c, a); nn.crossVectors(e1, e2); const A = nn.length(); if (A < 1e-9 || nn.dot(out) < 0.5 * A * out.length()) continue;
      const du1 = uv.getX(i1) - uv.getX(i0), dv1 = uv.getY(i1) - uv.getY(i0), du2 = uv.getX(i2) - uv.getX(i0), dv2 = uv.getY(i2) - uv.getY(i0), det = du1 * dv2 - du2 * dv1;
      if (Math.abs(det) < 1e-12) continue;
      T.copy(e1).multiplyScalar(dv2).addScaledVector(e2, -dv1).divideScalar(det); B.copy(e1).multiplyScalar(-du2).addScaledVector(e2, du1).divideScalar(det);
      sum += Math.sign(tb.crossVectors(T, B).dot(nn)) * A; } });
  return Math.sign(sum);
}

// turn obj about its world centre so its plane matches the disc's, then put that centre gap metres in front of the disc
function onPlane(obj, disc, gap) {
  const D = worldPlane(disc), Q = worldPlane(obj); if (!D || !Q || !obj.parent) return null;
  const nf = D.n.clone().multiplyScalar(Math.sign(Q.c.clone().sub(D.c).dot(D.n)) || 1);   // the disc side the text is on
  if (Q.n.dot(nf) < 0) Q.n.negate();
  const rot = new THREE.Quaternion().setFromUnitVectors(Q.n, nf);
  const target = Q.c.clone().addScaledVector(nf, gap - Q.c.clone().sub(D.c).dot(nf));
  const wp = new THREE.Vector3(), wq = new THREE.Quaternion(), ws = new THREE.Vector3(); obj.matrixWorld.decompose(wp, wq, ws);
  const pp = new THREE.Vector3(), pq = new THREE.Quaternion(), ps = new THREE.Vector3(); obj.parent.matrixWorld.decompose(pp, pq, ps);
  obj.position.copy(obj.parent.worldToLocal(wp.sub(Q.c).applyQuaternion(rot).add(target)));
  obj.quaternion.copy(pq.invert().multiply(rot.clone().multiply(wq)));
  obj.updateMatrixWorld(true);
  return 'turned ' + THREE.MathUtils.radToDeg(2 * Math.acos(Math.min(1, Math.abs(rot.w)))).toFixed(1) + ' deg, moved ' + (target.distanceTo(Q.c) * 100).toFixed(1) + ' cm';
}
export const _signfixTest = { capFill, menuUV };
