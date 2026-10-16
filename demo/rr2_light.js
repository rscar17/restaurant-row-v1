// Lighting from the existing Cycles captures: each capture is six linear float16 cube faces (Blender's own render
// of all 463 lights plus bounce). Used as image-based light and reflections around its position.
import * as THREE from 'three';

// face order on disk: px nx py ny pz nz in the capture's GL convention (px=+X, py=+Y up, pz=+Z = Blender -Y)
const FACES = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
const _h2f = (() => { const t = new Float32Array(1), i = new Int32Array(t.buffer); return (h) => { const s = (h & 0x8000) >> 15, e = (h & 0x7c00) >> 10, f = h & 0x03ff; if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024); if (e === 31) return f ? NaN : (s ? -Infinity : Infinity); return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024); }; })();
// 2x2 box downsample of half-float RGBA rows (keeps memory down when many captures are resident)
function half(buf, N) {
  const M = N / 2, out = new Uint16Array(M * M * 4);
  for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) for (let c = 0; c < 4; c++) {
    const a = (y * 2 * N + x * 2) * 4 + c, b = a + 4, d = a + N * 4, e = d + 4;
    out[(y * M + x) * 4 + c] = THREE.DataUtils.toHalfFloat((_h2f(buf[a]) + _h2f(buf[b]) + _h2f(buf[d]) + _h2f(buf[e])) * 0.25);
  }
  return out;
}
// web format: RGBE packed in an RGB PNG of N x 2N (mantissa rows on top, exponent rows below), rows bottom-up like the .f16
async function loadRGBEFace(url, f) {
  const r = await fetch(`${url}/${f}.rgbe.png`); if (!r.ok) throw new Error('missing ' + f);
  const bmp = await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const N = bmp.width; const cv = new OffscreenCanvas(N, 2 * N); const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(bmp, 0, 0); const px = cx.getImageData(0, 0, N, 2 * N).data; bmp.close();
  const out = new Uint16Array(N * N * 4); const half = N * N * 4;
  for (let y = 0; y < N; y++) {
    const dy = N - 1 - y; // flip to top-down rows
    for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4, o = (dy * N + x) * 4, e = px[half + i];
      const s = e === 0 ? 0 : Math.pow(2, e - 128) / 256;
      out[o] = THREE.DataUtils.toHalfFloat((px[i] + 0.5) * s); out[o + 1] = THREE.DataUtils.toHalfFloat((px[i + 1] + 0.5) * s);
      out[o + 2] = THREE.DataUtils.toHalfFloat((px[i + 2] + 0.5) * s); out[o + 3] = THREE.DataUtils.toHalfFloat(1);
    }
  }
  return { data: out, N };
}
// packed: one PNG per capture, the six faces stacked top to bottom (px nx py ny pz nz), each N wide and 2N tall
async function loadRGBEStack(url) {
  const r = await fetch(`${url}.rgbe.png`); if (!r.ok) throw new Error('missing ' + url);
  const bmp = await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const N = bmp.width; const cv = new OffscreenCanvas(N, 12 * N); const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(bmp, 0, 0); bmp.close();
  return FACES.map((f, k) => { const px = cx.getImageData(0, k * 2 * N, N, 2 * N).data; return { data: decodeRGBE(px, N), N }; });
}
function decodeRGBE(px, N) {
  const out = new Uint16Array(N * N * 4); const half = N * N * 4;
  for (let y = 0; y < N; y++) {
    const dy = N - 1 - y;
    for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4, o = (dy * N + x) * 4, e = px[half + i];
      const s = e === 0 ? 0 : Math.pow(2, e - 128) / 256;
      out[o] = THREE.DataUtils.toHalfFloat((px[i] + 0.5) * s); out[o + 1] = THREE.DataUtils.toHalfFloat((px[i + 1] + 0.5) * s);
      out[o + 2] = THREE.DataUtils.toHalfFloat((px[i + 2] + 0.5) * s); out[o + 3] = 15360; // 1.0
    }
  }
  return out;
}
export async function loadCaptureEnv(renderer, url, N, outN = N, fmt = 'f16', raw = false) {
  if (fmt === 'rgbe' || fmt === 'rgbe1') {
    const faces0 = fmt === 'rgbe1' ? await loadRGBEStack(url) : await Promise.all(FACES.map(f => loadRGBEFace(url, f)));
    N = faces0[0].N; outN = Math.min(outN, N);
    const datas = faces0.map(({ data }) => { let r2 = data, n2 = N; while (n2 > outN) { r2 = half(r2, n2); n2 /= 2; } return r2; });
    if (raw) return { N: outN, faces: datas };   // main-thread fallback for the capture cache when workers are unavailable
    return buildEnv(renderer, datas, outN);
  }
  const datas = await Promise.all(FACES.map(async f => {
    const r = await fetch(`${url}/${f}_lin.f16`); if (!r.ok) throw new Error('missing ' + f);
    const buf = new Uint16Array(await r.arrayBuffer());
    // Blender stores rows bottom-up; cube textures expect top-down rows
    const out = new Uint16Array(buf.length); const row = N * 4;
    for (let y = 0; y < N; y++) out.set(buf.subarray((N - 1 - y) * row, (N - y) * row), y * row);
    let r2 = out, n2 = N; while (n2 > outN) { r2 = half(r2, n2); n2 /= 2; }
    return r2;
  }));
  return buildEnv(renderer, datas, outN);
}
function buildEnv(renderer, datas, outN) {
  const faces = datas.map(d => { const t = new THREE.DataTexture(d, outN, outN, THREE.RGBAFormat, THREE.HalfFloatType); t.needsUpdate = true; return t; });
  const tex = new THREE.CubeTexture(faces);
  tex.format = THREE.RGBAFormat; tex.type = THREE.HalfFloatType; tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.needsUpdate = true;
  const pm = new THREE.PMREMGenerator(renderer);
  const pmrem = pm.fromCubemap(tex).texture; pm.dispose();
  return { cube: tex, pmrem };
}
