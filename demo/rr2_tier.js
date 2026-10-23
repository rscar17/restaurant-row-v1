// rr2_tier.js: device tier (desktop / laptop / phone) and a live pixel ratio governor.
// Ideas from drei: AdaptiveDpr (scale the pixel ratio by a performance factor) and PerformanceMonitor (average the
// frame rate over short windows, step the factor only when most windows of a run agree, and stop stepping after too
// many flips). Here the governor runs on frame time in ms and holds a dead band between the two bounds, so a frame rate
// that sits near one bound does not toggle the pixel ratio back and forth.
//
// Opt in with RR_FLAGS.tier = 'auto' | 'desktop' | 'laptop' | 'phone'. With no tier flag, pickTier returns null and the
// player keeps its current behaviour exactly (no setting is changed and no governor runs).
// Other flags: RR_FLAGS.adaptdpr = 0 keeps the tier's starting pixel ratio fixed; RR_FLAGS.dpr sets the start ratio.

// Per tier settings. dpr: start ratio cap; dprMin / dprMax: governor range; msaa: scene target samples; reflect: floor
// mirror target scale of the drawing buffer (0 = no planar mirror, the capture reflection stays); coveNSlot: reserved cove
// slot sides (rr2_cove.js NS_SLOT is 8); transmission: three's transmission pass on glass; texMax: largest side of a
// bitmap texture after decode (rr2_assets.js bitmapTexture; KTX2 and glTF embedded images are not resized).
export const TIERS = {
  desktop: { dpr: 2, dprMin: 1, dprMax: 2, msaa: 4, reflect: 0.5, coveNSlot: 8, transmission: true, texMax: 8192, lite: false },
  laptop: { dpr: 1.5, dprMin: 0.85, dprMax: 1.75, msaa: 0 /* agent look Oct 21: 4x MSAA on N8AO's beauty target cost 88 ms a frame on the Intel Arc (s85q: 137 -> 50 ms); SMAA stays */, reflect: 0.5, coveNSlot: 8, transmission: true, texMax: 4096 /* Ryan Oct 23: keep 4K (decided); memory comes down through KTX2, not a lower cap */, lite: false },
  phone: { dpr: 1.25, dprMin: 0.7, dprMax: 1.5, msaa: 0, reflect: 0, coveNSlot: 4, transmission: false, texMax: 2048, lite: true },
};

const MOBILE_GPU = /adreno|mali|powervr|apple gpu|apple a\d|videocore|immortalis|xclipse|tegra/i;
const DISCRETE_GPU = /nvidia|geforce|rtx|gtx|quadro|radeon (rx|pro)|radeon\s*\d{4}|arc a\d|radeon vii/i;
const INTEGRATED_GPU = /intel|iris|uhd|hd graphics|radeon\(tm\) graphics|radeon graphics|vega \d|apple m\d/i;
const SOFTWARE_GPU = /swiftshader|llvmpipe|software|basic render/i;

// GPU string: the unmasked renderer when the browser exposes it (Firefox and Safari mask or round it)
export function gpuString(renderer) {
  try { const gl = renderer.getContext(); const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || ''); } catch (e) { return ''; }
}

// Classify the device. Returns { name, why, probe } where probe is everything the decision looked at (for the report).
export function detectTier(renderer) {
  const nav = globalThis.navigator || {}, scr = globalThis.screen || {}, caps = renderer.capabilities;
  const gpu = gpuString(renderer), ua = nav.userAgent || '';
  const touch = (nav.maxTouchPoints || 0) > 0 || !!globalThis.matchMedia?.('(pointer: coarse)').matches;
  const shortSide = Math.min(scr.width || innerWidth, scr.height || innerHeight), longSide = Math.max(scr.width || innerWidth, scr.height || innerHeight);
  const mobileUA = /iphone|ipod|android.*mobile|mobile safari|windows phone/i.test(ua) || nav.userAgentData?.mobile === true;
  const iPad = /ipad/i.test(ua) || (/macintosh/i.test(ua) && (nav.maxTouchPoints || 0) > 1);
  const mem = nav.deviceMemory || 0; // Chromium only, rounded and capped at 8
  const probe = { gpu, ua: ua.slice(0, 120), touch, screen: [scr.width || 0, scr.height || 0], dpr: globalThis.devicePixelRatio || 1, deviceMemory: mem || null,
    cores: nav.hardwareConcurrency || null, maxTexture: caps.maxTextureSize, maxSamples: caps.maxSamples || 0, maxAniso: caps.getMaxAnisotropy?.() || 1 };
  // Safari reports every Apple Silicon GPU as "Apple GPU" (Mac, iPad and iPhone alike), so that string alone says
  // nothing about the form factor: with it, the UA, touch and the screen size decide. A Mac (Macintosh UA, no touch
  // points) is a laptop; an iPad (iPad UA, or a Macintosh UA with touch points, which is iPadOS asking for the desktop
  // site) is a tablet; only an iPhone UA or a touch screen with a short side under 600 CSS px is a phone.
  const appleGpu = /apple gpu/i.test(gpu), macUA = /macintosh|mac os x/i.test(ua) && !/iphone|ipod|ipad/i.test(ua);
  const smallTouch = touch && shortSide < 600;
  const mobileGpu = MOBILE_GPU.test(gpu) && !/apple m\d/i.test(gpu) && !(appleGpu && !mobileUA && !smallTouch);
  probe.appleGpu = appleGpu; probe.macUA = macUA; probe.iPad = iPad;
  let name, why;
  if (iPad && !smallTouch) { name = 'laptop'; why = 'tablet'; }
  else if (mobileUA || smallTouch || mobileGpu) { name = 'phone'; why = mobileUA ? 'mobile UA' : smallTouch ? 'touch and small screen' : 'mobile GPU'; }
  else if (appleGpu && macUA) { name = 'laptop'; why = 'Apple GPU on a Mac'; }
  else if (caps.maxTextureSize < 8192 || (caps.maxSamples || 0) < 4) { name = 'phone'; why = 'low GL caps'; }
  else if (SOFTWARE_GPU.test(gpu)) { name = 'phone'; why = 'software renderer'; }
  else if (DISCRETE_GPU.test(gpu) && !(mem && mem < 8)) { name = 'desktop'; why = 'discrete GPU'; }
  else if (INTEGRATED_GPU.test(gpu) || (mem && mem <= 8 && longSide <= 1920)) { name = 'laptop'; why = INTEGRATED_GPU.test(gpu) ? 'integrated GPU' : 'memory and screen'; }
  else { name = 'desktop'; why = 'default'; }
  return { name, why, probe };
}

// Called once after the renderer exists. Returns null when RR_FLAGS.tier is unset (current behaviour).
export function pickTier(renderer) {
  const F = globalThis.RR_FLAGS || {}; const want = F.tier;
  if (!want) return null;
  const det = detectTier(renderer);
  const name = TIERS[want] ? want : det.name;
  const t = { name, forced: !!TIERS[want], why: TIERS[want] ? 'flag' : det.why, probe: det.probe, ...TIERS[name] };
  // never ask for more than the GL can give
  t.msaa = Math.min(t.msaa, det.probe.maxSamples); t.texMax = Math.min(t.texMax, det.probe.maxTexture);
  const devDpr = globalThis.devicePixelRatio || 1;
  // the governor always keeps room to step down: at least to 0.75 of the top ratio (a DPR 1 desktop used to get a range
  // of 1 to 1, so the governor could never act there; now 0.75 to 1)
  t.dprMax = Math.min(t.dprMax, devDpr); t.dprMin = Math.min(t.dprMin, Math.round(t.dprMax * 0.75 * 100) / 100);
  t.dpr = Math.max(t.dprMin, Math.min(F.dpr ? +F.dpr : t.dpr, t.dprMax));
  // settings that live in other modules and already read RR_FLAGS: fill them only where the URL did not set them
  if (F.coveNSlot === undefined) F.coveNSlot = t.coveNSlot;
  globalThis.RR_TEX_MAX = t.texMax; globalThis.RR_FLAGS = F;
  return t;
}

// Live pixel ratio from frame time, with hysteresis.
// Every frame adds its time; each window of winMs ms yields one mean frame time. After n windows: when at least
// `agree` of them are slower than slowMs the ratio steps down; when at least `agree` are faster than fastMs it steps
// up. Between fastMs and slowMs nothing happens (dead band). After a step the window history is cleared and a hold
// of holdMs keeps the next step away, so the new ratio is measured before it is judged. Going up needs a longer
// hold than going down (upHoldMs). After maxFlips direction changes the governor locks at the lower of the last two
// ratios (drei's onFallback). Frames longer than 250 ms (shader compile, tab switch) are dropped, not averaged.
export class DprGovernor {
  constructor(tier, { apply, winMs = 500, n = 6, agree = 5, slowMs = 1000 / 45, fastMs = 1000 / 57, step = 0.15, holdMs = 1500, upHoldMs = 4000, maxFlips = 6 } = {}) {
    Object.assign(this, { apply, winMs, n, agree, slowMs, fastMs, step, holdMs, upHoldMs, maxFlips });
    this.min = tier.dprMin; this.max = tier.dprMax; this.dpr = tier.dpr;
    this.acc = 0; this.cnt = 0; this.wins = []; this.hold = 0; this.lastDir = 0; this.flips = 0; this.prev = this.dpr; this.locked = false;
    this.log = []; this.enabled = ((globalThis.RR_FLAGS || {}).adaptdpr ?? 1) !== 0;
  }
  // pause / resume: another owner of the pixel ratio (the player's lowres open) holds the governor off while it has the
  // ratio, then hands the ratio back through resume(v), which clamps v to the range, applies it and restarts the
  // measurement with a hold, so the two never set the ratio against each other
  pause() { this.paused = true; this.acc = 0; this.cnt = 0; this.wins.length = 0; }
  resume(v) { this.paused = false; this.acc = 0; this.cnt = 0; this.wins.length = 0; this.hold = this.holdMs;
    const c = Math.round(Math.max(this.min, Math.min(this.max, v ?? this.dpr)) * 20) / 20; this.dpr = c;
    this.log.push({ t: +(performance.now() / 1000).toFixed(1), dpr: c, why: 'resume', meanMs: null }); if (this.log.length > 40) this.log.shift(); this.apply(c); }
  frame(ms) {
    if (!this.enabled || this.paused || this.locked || !(ms > 0) || ms > 250) return;
    if (this.hold > 0) { this.hold -= ms; return; }
    this.acc += ms; this.cnt++;
    if (this.acc < this.winMs) return;
    this.wins.push(this.acc / this.cnt); this.acc = 0; this.cnt = 0;
    if (this.wins.length > this.n) this.wins.shift();
    if (this.wins.length < this.n) return;
    const slow = this.wins.filter(v => v > this.slowMs).length, fast = this.wins.filter(v => v < this.fastMs).length;
    let dir = 0; if (slow >= this.agree && this.dpr > this.min + 1e-3) dir = -1; else if (fast >= this.agree && this.dpr < this.max - 1e-3) dir = 1;
    if (!dir) return;
    if (this.lastDir && dir !== this.lastDir && ++this.flips >= this.maxFlips) { this.set(Math.min(this.dpr, this.prev), 'lock'); this.locked = true; return; }
    this.lastDir = dir; this.prev = this.dpr;
    // round to 0.05 so equal ratios compare equal and the canvas size does not drift by a pixel each step
    this.set(Math.round(Math.max(this.min, Math.min(this.max, this.dpr + dir * this.step)) * 20) / 20, dir < 0 ? 'down' : 'up');
    this.hold = dir < 0 ? this.holdMs : this.upHoldMs;
  }
  set(v, why) {
    const meanMs = this.wins.length ? +(this.wins.reduce((a, b) => a + b, 0) / this.wins.length).toFixed(1) : null;
    this.wins.length = 0; if (v === this.dpr && why !== 'lock') return;
    this.dpr = v; this.log.push({ t: +(performance.now() / 1000).toFixed(1), dpr: v, why, meanMs }); if (this.log.length > 40) this.log.shift();
    this.apply(v);
  }
}

// Downscale an ImageBitmap whose larger side exceeds RR_TEX_MAX (set by pickTier). Returns the bitmap unchanged otherwise.
// max (optional, rr2_assets.js lowtex): a cap to use in place of RR_TEX_MAX
export async function capBitmap(bmp, max) {
  const M = max || globalThis.RR_TEX_MAX; if (!M || !bmp || Math.max(bmp.width, bmp.height) <= M) return bmp;
  const k = M / Math.max(bmp.width, bmp.height);
  const out = await createImageBitmap(bmp, { resizeWidth: Math.max(1, Math.round(bmp.width * k)), resizeHeight: Math.max(1, Math.round(bmp.height * k)), resizeQuality: 'high', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  bmp.close?.(); return out;
}
