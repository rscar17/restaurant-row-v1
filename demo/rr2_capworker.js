// Capture decode worker (Comlink): fetch one packed RGBE capture PNG (six faces stacked, each N x 2N: mantissa rows on
// top, exponent rows below, rows bottom-up), decode to linear float, box-downsample to the size the viewer uses and
// return six half-float face arrays. The arrays are transferred, not copied. GPU work stays on the page thread.
import * as Comlink from './vendor/comlink.mjs';

const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
function toHalf(v) {
  f32[0] = v; const x = u32[0]; const sign = (x >>> 16) & 0x8000; const e = ((x >>> 23) & 0xff) - 112; const m = x & 0x7fffff;
  if (e <= 0) { if (e < -10) return sign; const mm = (m | 0x800000) >>> (1 - e); return sign | ((mm + 0x1000) >>> 13); }
  if (e >= 31) return sign | 0x7c00;
  return (sign | (e << 10)) + ((m + 0x1000) >>> 13);
}
function decodeFace(px, N) { // -> top-down rows, RGB float
  const out = new Float32Array(N * N * 3), half = N * N * 4;
  for (let y = 0; y < N; y++) { const dy = N - 1 - y;
    for (let x = 0; x < N; x++) { const i = (y * N + x) * 4, o = (dy * N + x) * 3, e = px[half + i]; const s = e === 0 ? 0 : Math.pow(2, e - 128) / 256;
      out[o] = (px[i] + 0.5) * s; out[o + 1] = (px[i + 1] + 0.5) * s; out[o + 2] = (px[i + 2] + 0.5) * s; } }
  return out;
}
function down2(a, N) { const M = N / 2, o = new Float32Array(M * M * 3);
  for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) for (let c = 0; c < 3; c++) {
    const p = (y * 2 * N + x * 2) * 3 + c; o[(y * M + x) * 3 + c] = (a[p] + a[p + 3] + a[p + N * 3] + a[p + N * 3 + 3]) * 0.25; }
  return o; }
export async function decodeStack(url, outN) {
  const r = await fetch(url); if (!r.ok) throw new Error(r.status + ' ' + url);
  const bmp = await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const N = bmp.width; const cv = new OffscreenCanvas(N, 12 * N); const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(bmp, 0, 0); bmp.close();
  const M = Math.min(outN, N); const faces = [];
  for (let k = 0; k < 6; k++) {
    let f = decodeFace(cx.getImageData(0, k * 2 * N, N, 2 * N).data, N), n = N; while (n > M) { f = down2(f, n); n /= 2; }
    const h = new Uint16Array(M * M * 4); for (let i = 0, j = 0; i < M * M; i++, j += 3) { h[i * 4] = toHalf(f[j]); h[i * 4 + 1] = toHalf(f[j + 1]); h[i * 4 + 2] = toHalf(f[j + 2]); h[i * 4 + 3] = 15360; }
    faces.push(h);
  }
  return Comlink.transfer({ N: M, faces }, faces.map(f => f.buffer));
}
// expose only inside a worker; on the page thread rr2_assets.js imports decodeStack directly as the fallback decoder
// (Comlink.transfer then only marks the buffers, which the page thread ignores). ping answers the boot handshake.
if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) Comlink.expose({ decodeStack, ping: () => 1 });
