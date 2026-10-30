// rr2_lodworker.js (main, Oct 29): off-thread mesh simplification for rr2_lod.js (meshoptimizer, MIT, vendor/meshoptimizer).
// in: { id, pos: Float32Array (xyz), idx: Uint32Array, ratio, err }; out: { id, idx: Uint32Array, error } or { id, fail }
import { MeshoptSimplifier } from './vendor/meshoptimizer/meshopt_simplifier.js';
self.onmessage = async (e) => {
  const { id, pos, idx, ratio, err } = e.data;
  try { await MeshoptSimplifier.ready;
    const target = Math.max(3, Math.floor(idx.length * ratio / 3) * 3);
    const [out, error] = MeshoptSimplifier.simplify(idx, pos, 3, target, err, []);
    self.postMessage({ id, idx: out, error }, [out.buffer]);
  } catch (x) { self.postMessage({ id, fail: String(x) }); }
};
