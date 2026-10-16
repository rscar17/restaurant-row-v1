// The bloom of Ryan's Cycles 360s (_claude_capture.py grade_and_crop), redone on screen after the grade:
// in display space, br = max(m - 0.82, 0) / 0.18 per channel; br is box averaged by 13 px (4096 face), blurred by two box
// passes of width 5 and of width 19 (in those 13 px units), mixed 0.55 / 0.45, scaled by k = 0.5 and screen blended:
// out = m + k * bl * (1 - m). Two box passes make a triangle kernel; its half width in full resolution pixels is
// 5 * 13 = 65 px and 19 * 13 = 247 px on a face whose focal length is 2048 px, so the kernels are sized here from the
// camera focal length in pixels (0.03174 f and 0.1206 f) and match the reference at any field of view and resolution.
// Small kernel on a 1/4 resolution chain, large kernel on 1/8 (1/8 and 1/16 for the lite tier).
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const VS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
// threshold each source texel, then average a 4x4 (or 8x8) block of them (texel centres, so no filtering mixes texels)
const THR = `uniform sampler2D tSrc; uniform vec2 srcSize; uniform float blockN; varying vec2 vUv;
void main() { vec2 base = floor(vUv * srcSize / blockN) * blockN; vec3 s = vec3(0.0); float n = 0.0;
  for (int j = 0; j < 8; j++) { if (float(j) >= blockN) break; for (int i = 0; i < 8; i++) { if (float(i) >= blockN) break;
    vec2 p = base + vec2(float(i), float(j)) + 0.5; if (p.x > srcSize.x || p.y > srcSize.y) continue;
    vec3 m = texture2D(tSrc, p / srcSize).rgb; s += max(m - 0.82, 0.0) / 0.18; n += 1.0; } }
  gl_FragColor = vec4(s / max(n, 1.0), 1.0); }`;
// 2x2 average (one bilinear tap on the shared corner)
const DOWN = `uniform sampler2D tSrc; uniform vec2 srcSize; varying vec2 vUv;
void main() { vec2 p = floor(vUv * srcSize * 0.5) * 2.0 + 1.0; gl_FragColor = vec4(texture2D(tSrc, p / srcSize).rgb, 1.0); }`;
// separable triangle kernel of half width T texels: w(t) = 1 - |t| / T
const BLUR = `uniform sampler2D tSrc; uniform vec2 dir; uniform float T; varying vec2 vUv;
void main() { vec3 s = texture2D(tSrc, vUv).rgb; float wsum = 1.0;
  for (int i = 1; i < 96; i++) { float t = float(i); if (t >= T) break; float w = 1.0 - t / T;
    s += w * (texture2D(tSrc, vUv + dir * t).rgb + texture2D(tSrc, vUv - dir * t).rgb); wsum += 2.0 * w; }
  gl_FragColor = vec4(s / wsum, 1.0); }`;
const COMP = `uniform sampler2D tDiffuse; uniform sampler2D tSmall; uniform sampler2D tLarge; uniform float k; varying vec2 vUv;
void main() { vec4 m = texture2D(tDiffuse, vUv); vec3 bl = 0.55 * texture2D(tSmall, vUv).rgb + 0.45 * texture2D(tLarge, vUv).rgb;
  gl_FragColor = vec4(m.rgb + k * bl * (1.0 - m.rgb), m.a); }`;

export class RefBloomPass extends Pass {
  constructor(camera, { k = 0.5, lite = false } = {}) {
    super();
    this.camera = camera; this.k = k; this.f1 = lite ? 8 : 4;
    const rt = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
    this.rtThr = rt(); this.rtS1 = rt(); this.rtS2 = rt(); this.rtD = rt(); this.rtL1 = rt(); this.rtL2 = rt();
    const mat = (fs, u) => new THREE.ShaderMaterial({ uniforms: u, vertexShader: VS, fragmentShader: fs, depthTest: false, depthWrite: false });
    this.mThr = mat(THR, { tSrc: { value: null }, srcSize: { value: new THREE.Vector2() }, blockN: { value: this.f1 } });
    this.mDown = mat(DOWN, { tSrc: { value: null }, srcSize: { value: new THREE.Vector2() } });
    this.mBlur = mat(BLUR, { tSrc: { value: null }, dir: { value: new THREE.Vector2() }, T: { value: 1 } });
    this.mComp = mat(COMP, { tDiffuse: { value: null }, tSmall: { value: this.rtS2.texture }, tLarge: { value: this.rtL2.texture }, k: { value: k } });
    this.quad = new FullScreenQuad(null); this.w = 1; this.h = 1;
  }
  setSize(w, h) {
    this.w = w; this.h = h; const a = this.f1, b = this.f1 * 2;
    const qw = Math.max(1, Math.ceil(w / a)), qh = Math.max(1, Math.ceil(h / a)), ew = Math.max(1, Math.ceil(qw / 2)), eh = Math.max(1, Math.ceil(qh / 2));
    for (const r of [this.rtThr, this.rtS1, this.rtS2]) r.setSize(qw, qh);
    for (const r of [this.rtD, this.rtL1, this.rtL2]) r.setSize(ew, eh);
  }
  draw(renderer, m, target) { this.quad.material = m; renderer.setRenderTarget(target); this.quad.render(renderer); }
  blur(renderer, src, tmp, dst, T) {
    const u = this.mBlur.uniforms; u.T.value = Math.max(1, T);
    u.tSrc.value = src.texture; u.dir.value.set(1 / src.width, 0); this.draw(renderer, this.mBlur, tmp);
    u.tSrc.value = tmp.texture; u.dir.value.set(0, 1 / tmp.height); this.draw(renderer, this.mBlur, dst);
  }
  render(renderer, writeBuffer, readBuffer) {
    // focal length in full resolution pixels of the current camera (vertical fov)
    const fpx = (readBuffer.height / 2) / Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const a = this.f1, b = this.f1 * 2;
    const u = this.mThr.uniforms; u.tSrc.value = readBuffer.texture; u.srcSize.value.set(readBuffer.width, readBuffer.height); this.draw(renderer, this.mThr, this.rtThr);
    this.blur(renderer, this.rtThr, this.rtS1, this.rtS2, 0.03174 * fpx / a);
    const d = this.mDown.uniforms; d.tSrc.value = this.rtThr.texture; d.srcSize.value.set(this.rtThr.width, this.rtThr.height); this.draw(renderer, this.mDown, this.rtD);
    this.blur(renderer, this.rtD, this.rtL1, this.rtL2, 0.1206 * fpx / b);
    this.mComp.uniforms.tDiffuse.value = readBuffer.texture; this.mComp.uniforms.k.value = this.k;
    this.draw(renderer, this.mComp, this.renderToScreen ? null : writeBuffer);
  }
  dispose() { for (const r of [this.rtThr, this.rtS1, this.rtS2, this.rtD, this.rtL1, this.rtL2]) r.dispose(); for (const m of [this.mThr, this.mDown, this.mBlur, this.mComp]) m.dispose(); this.quad.dispose(); }
}
