// Sugarcane near field light, baked per vertex at load (vault agent, Oct 14; opt in with flag sugbake=1 until tested).
// Cycles lights the Sugarcane ceiling slab (Mesh_2230, WEST_Block, Material_87 dark wood, z 3.77 to 3.93) from the
// Material_108 strips 11 to 35 cm under it (sugmv_Mesh_2235 z 3.58 to 3.66, strength 13.2) and from the vault
// (sugmv_Mesh_1499, sug_arch_glow, strength 4). In the 360s that slab reads warm cream (B009 nx: 0.75 0.69 0.55 display
// mean over its pixels), in m54 it is dark brown (0.44 0.39 0.31), and the vault looks small and low because the slab
// around it is dark. The cove patch path (rr2_cove.js, flag coveconst) keeps only the 64 patches nearest the camera
// with a 1.14 m reach, which cannot cover a 13 x 10 m strip field: that is why m55 saw no gain.
// Here every emitter triangle of the CL_Sug groups lights every receiver vertex within REACH once, on the CPU:
// irradiance E = sum L A cos_r |cos_e| / (r^2 + A / pi) (both sides of an emitter face, like Cycles mesh emission),
// stored as the vertex attribute sugBake and added as diffuse x E / pi. All meshes that share a receiver material get
// the attribute (zeros where nothing is near), so merged batches keep one attribute layout.
import * as THREE from 'three';

const REACH = 3.0, MIN_S = 3, GROUPS = /^CL_Sug/;

function constEm(graph) {
  if (!graph) return null; const nodes = graph.nodes || [], links = graph.links || [];
  const b = nodes.find(n => n.type === 'BSDF_PRINCIPLED'); if (!b) return null;
  if (links.some(l => l[2] === b.name && /^Emission (Strength|Color)$/.test(l[3]))) return null;
  const s = +(b.in?.['Emission Strength'] ?? 0), c = b.in?.['Emission Color'] || [0, 0, 0, 1];
  if (!(s >= MIN_S) || Math.max(c[0], c[1], c[2]) < 0.05) return null;
  return [c[0] * s, c[1] * s, c[2] * s];
}

export function bakeSugarcane(root, mats, { gain = 1, report = {} } = {}) {
  root.updateMatrixWorld(true);
  const em = []; const ebb = new THREE.Box3(); const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();
  const emitters = new Set();
  root.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || !GROUPS.test(o.userData.invGroup || '')) return;
    const L = constEm(mats[o.material?.name]?.graph); if (!L) return; emitters.add(o);
    const g = o.geometry, p = g.attributes.position, idx = g.index, cnt = idx ? idx.count : p.count;
    for (let i = 0; i < cnt; i += 3) {
      A.fromBufferAttribute(p, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld); B.fromBufferAttribute(p, idx ? idx.getX(i + 1) : i + 1).applyMatrix4(o.matrixWorld);
      C.fromBufferAttribute(p, idx ? idx.getX(i + 2) : i + 2).applyMatrix4(o.matrixWorld);
      e1.subVectors(B, A); e2.subVectors(C, A); n.crossVectors(e1, e2); const area = n.length() / 2; if (area < 1e-6) continue; n.normalize();
      const cx = (A.x + B.x + C.x) / 3, cy = (A.y + B.y + C.y) / 3, cz = (A.z + B.z + C.z) / 3;
      em.push(cx, cy, cz, n.x, n.y, n.z, area, L[0] * gain, L[1] * gain, L[2] * gain); ebb.expandByPoint(A.set(cx, cy, cz));
    }
  });
  const ne = em.length / 10; report.sugBakeEmitterTris = ne; if (!ne) return 0;
  ebb.expandByScalar(REACH);
  // emitters bucketed on a 1 m grid in x and z (three), so a receiver vertex visits only the cells within REACH
  const grid = new Map(), cell = (x, z) => Math.floor(x) + ',' + Math.floor(z);
  for (let k = 0; k < em.length; k += 10) { const key = cell(em[k], em[k + 2]); (grid.get(key) || grid.set(key, []).get(key)).push(k); }
  const RC = Math.ceil(REACH);
  // receivers: meshes reaching above 2.5 m whose box meets the emitter field (three: y up)
  const bb = new THREE.Box3(); const recvMats = new Set();
  root.traverse(o => { if (!o.isMesh || o.isInstancedMesh || emitters.has(o) || !o.material?.isMeshStandardMaterial || o.material.transparent) return;
    bb.setFromObject(o); if (bb.max.y < 2.5 || !bb.intersectsBox(ebb)) return; recvMats.add(o.material); });
  const P = new THREE.Vector3(), N = new THREE.Vector3(), nm = new THREE.Matrix3(); let nv = 0, lit = 0;
  root.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || !recvMats.has(o.material)) return;
    const g = o.geometry, p = g.attributes.position, nr = g.attributes.normal; const out = new Float32Array(p.count * 3);
    bb.setFromObject(o);
    if (nr && bb.intersectsBox(ebb)) { nm.getNormalMatrix(o.matrixWorld);
      for (let v = 0; v < p.count; v++) {
        P.fromBufferAttribute(p, v).applyMatrix4(o.matrixWorld); N.fromBufferAttribute(nr, v).applyMatrix3(nm).normalize();
        let r = 0, gg = 0, b = 0;
        if (!ebb.containsPoint(P)) continue;
        const gx = Math.floor(P.x), gz = Math.floor(P.z);
        for (let ix = gx - RC; ix <= gx + RC; ix++) for (let iz = gz - RC; iz <= gz + RC; iz++) { const list = grid.get(ix + ',' + iz); if (list) for (const k of list) {
          const dx = em[k] - P.x, dy = em[k + 1] - P.y, dz = em[k + 2] - P.z, r2 = dx * dx + dy * dy + dz * dz; if (r2 > REACH * REACH) continue;
          const id = 1 / Math.sqrt(Math.max(r2, 1e-8)); const cr = (N.x * dx + N.y * dy + N.z * dz) * id; if (cr <= 0) continue;
          const ce = Math.abs(em[k + 3] * dx + em[k + 4] * dy + em[k + 5] * dz) * id; const w = em[k + 6] * cr * ce / (r2 + em[k + 6] / Math.PI);
          r += w * em[k + 7]; gg += w * em[k + 8]; b += w * em[k + 9];
        } }
        out[v * 3] = r; out[v * 3 + 1] = gg; out[v * 3 + 2] = b; nv++; if (r + gg + b > 0.01) lit++;
      } }
    g.setAttribute('sugBake', new THREE.BufferAttribute(out, 3));
  });
  for (const m of recvMats) {
    if (m.userData.sugBake) continue; m.userData.sugBake = true;
    const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
    m.onBeforeCompile = (sh, r) => { if (prev) prev.call(m, sh, r);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 sugBake; varying vec3 vSugBake;')
        .replace('#include <fog_vertex>', '#include <fog_vertex>\n  vSugBake = sugBake;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vSugBake;')
        .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n  reflectedLight.indirectDiffuse += diffuseColor.rgb * vSugBake * RECIPROCAL_PI;'); };
    m.customProgramCacheKey = () => (prevKey ? prevKey.call(m) : '') + '|sugbake1';
    m.needsUpdate = true;
  }
  Object.assign(report, { sugBakeReceiverMats: recvMats.size, sugBakeVerts: nv, sugBakeLitVerts: lit });
  return recvMats.size;
}
