// rr_section.js: entry module for the Restaurant Row section on the Swoogo page (swoogo2 agent, Oct 14 2026; sect3
// agent revision the same day: map first swap with a fade, keyboard and screen reader support, wall clock glides,
// overview cutaway look, walk and free walk tabs, phone touch handling, frame timing per mode).
// The section HTML and CSS live in the Swoogo theme (swoogo_section.html); this file and everything it imports come from
// the Git host. BASE is the folder this file is served from, so nothing here needs editing when the host changes.
//
// What it does:
//  1. The map tab is already visible (plain HTML). Nothing here blocks it.
//  2. Background preload of the 3D viewer starts on requestIdleCallback, or as soon as the section comes within 600 px
//     of the screen, whichever comes first. RowPlayer.preload draws nothing while hidden and compiles through the gate.
//  3. Progress shows on the 3D tab and in the panel. When the first view is ready (after the warm frame) the section
//     cross fades from the map to the 3D overview by itself, unless the visitor has chosen the map tab or is working
//     in the map panel (data-rr-swap="0" turns the automatic swap off). A restaurant tab clicked during the load is
//     remembered and the swap opens that restaurant instead. The swap waits until the section is on screen.
//  4. The render loop pauses while the 3D panel is not shown, while the section is off screen and while the browser
//     tab is hidden.
//  5. Device tier (rr2_tier.js): RR_FLAGS.tier defaults to 'auto', so phones get the light settings.
//  6. Keys: the canvas is focusable (tabindex 0 in the HTML); W A S D and the arrows only move the viewer while the
//     canvas has focus, and the wheel scrolls the page (ctrl or cmd + wheel zooms). Walk mode arrows and Escape only
//     act while focus is inside the section. The tab list follows the WAI-ARIA tabs pattern (arrows, Home, End).
//  7. Ship configuration (rr2_flags.js, imported first): the RR_FLAGS fixes, the player options and the area list of
//     the m96 gputest runs. ?rr_flags=... on the page URL overrides flags for a test (see rr2_flags.js).
//
// Optional settings on the section element (data attributes) or on window.RR_SECTION before this module runs:
//   data-rr-data   folder with the scene data (default BASE + 'data/'); can be another host, it needs CORS
//   data-rr-areas  comma separated area list (default: the full ship list)
//   data-rr-caps   capture folder (default DATA + 'caps')
//   data-rr-tier   'auto' | 'desktop' | 'laptop' | 'phone' | 'off'
//   data-rr-start  'idle' (default) | 'view' (only when scrolled near) | 'click' (only when a 3D tab is clicked)
//   data-rr-swap   '1' (default): fade from the map to 3D when ready; '0': stay on the map until a tab is clicked
//   data-rr-look   'cutaway' (default): light background, no floor disc and light roofs in the top views; 'model': as before
//   data-rr-touch  'page' (default): on touch screens a vertical swipe scrolls the page except in free walk;
//                  'viewer': every touch drives the viewer (the old behaviour)
//   data-rr-warm   '0' skips the idle warm frame
//   data-rr-player-module  test only: module whose makePlayer({ THREE, RowPlayer, assets }) returns a player class
//   data-rr-policy 'tier' (default): SHIP_TIER_POLICY in rr2_flags.js picks the areas and the texture cap per device
//                  tier before anything downloads; 'off': every device gets the full area list as before
//   data-rr-phone  'map' (default): phones and low memory devices keep the map, the 3D is never downloaded;
//                  'hero': try the three restaurant areas with 1024 px textures; 'full': the desktop set (not advised)
//
// r8 (agent ship8, Oct 15): data root is the r8f build (16 areas with mt40, see rr2_flags.js SHIP_AREA_LIST), memlean=7
// is in SHIP_FLAGS, and the device policy above runs before the download. The tier is read from a throwaway WebGL2
// context (rr2_tier.js detectTier), so a phone never creates the full renderer or fetches a byte of scene data.
// ship flags first: rr2_flags.js sets RR_FLAGS before rr2_player.js and its modules evaluate (some read flags at module scope)
import { SHIP_PLAYER, SHIP_AREAS, SHIP_AREAS_HERO, SHIP_TIER_POLICY, SHIP_PHONE_TRY } from './rr2_flags.js';
import { detectTier, TIERS } from './rr2_tier.js';
// the viewer (three.js and the rr2 modules, about 4 MB) is imported only once the device policy allows the 3D, so a
// phone that keeps the map loads none of it (agent ship8). These names are filled by loadViewer().
let THREE, RowPlayer, RowModes, pointInPoly, distToPoly, assets, installLook;
async function loadViewer() {
  if (RowPlayer) return;
  const [T, pl, md, as, lk] = await Promise.all([import('three'), import('./rr2_player.js'), import('./rr2_modes.js'), import('./rr2_assets.js'), import('./rr2_look.js')]);
  THREE = T; RowPlayer = pl.RowPlayer; RowModes = md.RowModes; pointInPoly = md.pointInPoly; distToPoly = md.distToPoly; assets = as; installLook = lk.installLook;
}

const BASE = new URL('./', import.meta.url).href;
// SHIP_AREAS (live set, far sections at 32) comes from rr2_flags.js
const STOP = [-21.75, -9.61, 1.6];
const HEROES = ['gjelina', 'milos', 'delmonico'];
const NAMES = { map: 'Resort map', '3d': '3D overview', gjelina: 'Gjelina', milos: 'Milos', delmonico: 'Delmonico', walk: 'Walkthrough', free: 'Free walk' };
const HINTS = {
  '3d': 'Drag to turn the model. Ctrl or Cmd and scroll to zoom. Pick a restaurant label to see it on its own.',
  walk: 'Use Next and Prev, or the left and right arrow keys, to move between stops. Drag to look around.',
  free: 'Click the view, then walk with W A S D or the arrow keys. Drag to look around.',
  hero: 'Drag to look around. Ctrl or Cmd and scroll to zoom.'
};
const HINTS_TOUCH = { '3d': 'Drag sideways to turn. Tap a name to open it.', walk: 'Next and Prev move between stops.',
  free: 'Stick at lower left walks. Drag to look.', hero: 'Drag sideways to look around.' };

// ---- the player's display grade (GRADE360 in rr2_player.js), ported by the sect2 agent (agent_sect2/tools/grade.mjs) ----
// Colours drawn into the scene (background, roofs, veils) go through the same grade as the model, so a wanted display
// colour needs its linear input found first. sect2 checked the port: #c4beb5 in gives 165 160 152; the laptop run
// measured 164 159 151.
const gMul = (M, v) => [0, 1, 2].map(i => M[0][i] * v[0] + M[1][i] * v[1] + M[2][i] * v[2]);
const G_S2R = [[0.6274, 0.0691, 0.0164], [0.3293, 0.9195, 0.0880], [0.0433, 0.0113, 0.8956]];
const G_R2S = [[1.6605, -0.1246, -0.0182], [-0.5876, 1.1329, -0.1006], [-0.0728, -0.0083, 1.1187]];
const G_INS = [[0.856627153315983, 0.137318972929847, 0.11189821299995], [0.0951212405381588, 0.761241990602591, 0.0767994186031903], [0.0482516061458583, 0.101439036467562, 0.811302368396859]];
const G_OUTS = [[1.1271005818144368, -0.1413297634984383, -0.14132976349843826], [-0.11060664309660323, 1.157823702216272, -0.11060664309660294], [-0.016493938717834573, -0.016493938717834257, 1.2519364065950405]];
function gNeutral(c) { const x = Math.min(...c), off = x < 0.08 ? x - 6.25 * x * x : 0.04; c = c.map(v => v - off);
  const peak = Math.max(...c), S = 0.76; if (peak < S) return c; const d = 1 - S, np = 1 - d * d / (peak + d - S); c = c.map(v => v * np / peak);
  const g = 1 - 1 / (0.15 * (peak - np) + 1); return c.map(v => v + (np - v) * g); }
function gAgx(c) { c = gMul(G_INS, gMul(G_S2R, c)).map(v => Math.min(1, Math.max(0, (Math.log2(Math.max(v, 1e-10)) + 12.47393) / 16.5)));
  c = c.map(x => { const x2 = x * x, x4 = x2 * x2; return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232; });
  c = c.map(v => Math.pow(Math.max(v, 0), 1.5)); c = gMul(G_OUTS, c).map(v => Math.pow(Math.max(v, 0), 2.2)); return gMul(G_R2S, c).map(v => Math.min(1, Math.max(0, v))); }
const gEnc = (x) => { x = Math.min(1, Math.max(0, x)); return x < 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055; };
function grade360(c, ev) { const k = Math.pow(2, ev); c = c.map(v => v * k); const a = gNeutral(c.map(v => v * 0.78458)), b = gAgx(c.map(v => v * 0.84090));
  return [0, 1, 2].map(i => 0.75 * gEnc(a[i]) + 0.25 * gEnc(b[i])); }
function ungrade(hex, ev = 0.08) { const want = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255); let x = want.map(v => Math.pow(v, 2.2));
  for (let i = 0; i < 60; i++) { const o = grade360(x, ev); x = x.map((v, j) => Math.max(1e-4, v * Math.pow(want[j] / Math.max(o[j], 1e-4), 2.2))); }
  return new THREE.Color(x[0], x[1], x[2]); }   // linear values, used as is (no sRGB conversion)

// cutaway palette (display colours): close to the page white so the top view reads as a plan cut out of the page
const LOOK = { bg: '#efe9e1', roof: '#d9d1c5', roofEdge: '#9d9387', veil: '#e2dbd1', veilOpacity: 0.6 };

function setup(root) {
  if (root.__rr) return root.__rr;
  const cfg = { ...root.dataset, ...(window.RR_SECTION || {}) };
  const opt = (k, d) => cfg['rr' + k[0].toUpperCase() + k.slice(1)] ?? cfg[k] ?? d;
  const DATA = new URL(opt('data', 'data/'), BASE).href;
  const areaOpt = opt('areas', null), policyMode = opt('policy', 'tier'), phoneMode = opt('phone', 'try');   // main Oct 23 (Ryan: has to work on mobile): phones get the light 3D (SHIP_PHONE_TRY), map only on request
  const toUrls = (list) => list.split(',').map(a => a.split('|')[0].includes('/') ? a : DATA + a);
  let AREAS = toUrls(areaOpt || SHIP_AREAS);
  const CAPS = opt('caps', DATA + 'caps');
  const tierFlag = opt('tier', 'auto'), startMode = opt('start', 'idle'), autoSwap = opt('swap', '1') !== '0';
  const lookMode = opt('look', 'cutaway'), touchMode = opt('touch', 'page');
  const F = window.RR_FLAGS = { ...(window.RR_FLAGS || {}) };
  if (tierFlag !== 'off' && F.tier === undefined) F.tier = tierFlag;
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

  const $ = (s) => root.querySelector(s);
  const tablist = $('.rr-tabs'), tabs = [...root.querySelectorAll('[data-rr-tab]')];
  const panelMap = $('[data-rr-panel="map"]'), panel3d = $('[data-rr-panel="3d"]'), canvas = panel3d.querySelector('canvas');
  const card = $('[data-rr-card]'), prog = $('[data-rr-progress]'), progPct = $('[data-rr-pct]'), progBar = prog && prog.querySelector('.rr-bar i');
  const status = $('[data-rr-status]'), hint = $('[data-rr-hint]');
  const tabPct = $('[data-rr-tab="3d"] .rr-pct');
  const tab3dLike = tabs.filter(b => b.dataset.rrTab !== 'map');
  const st = { phase: 'idle', ready: false, loaded: false, failed: null, active: 'map', pending: null, userPickedMap: false, inView: true, pageVisible: !document.hidden,
    started: false, modesStarted: false, P: null, M: null, t0: performance.now(), readyAt: null, swapAt: null, swapWhy: null, perf: {} };

  // ---- tabs (WAI-ARIA tabs pattern: one tab stop, arrows move between tabs, Enter or Space or a click activates) ----
  // Tabs that wait for the 3D are aria-disabled, not disabled, so keyboard and screen reader users can still reach
  // them and hear the progress.
  const isOff = (b) => b.getAttribute('aria-disabled') === 'true';
  const setPressed = (t) => tabs.forEach(b => { const on = b.dataset.rrTab === t; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
  const say = (msg) => { if (status) { status.textContent = ''; setTimeout(() => { status.textContent = msg; }, 30); } };
  const setPct = (p) => { const s = p == null ? '' : Math.round(p) + '%'; if (tabPct) tabPct.textContent = s; if (progPct) progPct.textContent = s || '0%'; if (progBar) progBar.style.width = (p || 0) + '%';
    if (prog) prog.setAttribute('aria-valuenow', String(Math.round(p || 0))); };
  const want3d = () => st.active !== 'map';
  // the loop runs only when the 3D panel is shown, the section is on screen and the browser tab is visible
  function applyRun() {
    const { P, M } = st; if (!P || !st.ready) return;
    const run = want3d() && st.inView && st.pageVisible;
    if (run) { if (P.hidden) P.show(); if (M && M.paused) M.resume(); }
    else { if (!P.hidden) P.hide(); if (M && st.modesStarted) M.pause(); }
  }
  // the 3D panel fades in only once a frame of the new view is on the canvas (the poster covers it until then)
  function whenDrawn(maxMs = 1500) {
    const P = st.P; if (!P) return Promise.resolve(); const f0 = P.frames || 0, t = performance.now();
    return new Promise(res => { const poll = () => { if ((P.frames || 0) > f0 + 1 || performance.now() - t > maxMs) res(); else requestAnimationFrame(poll); }; requestAnimationFrame(poll); });
  }
  let swapSeq = 0;
  async function showPanel(which) {
    const seq = ++swapSeq;
    if (which === 'map') { panelMap.removeAttribute('data-rr-off'); panel3d.setAttribute('data-rr-off', ''); return; }
    applyRun(); await whenDrawn(); if (seq !== swapSeq) return;
    panel3d.removeAttribute('data-rr-off'); panelMap.setAttribute('data-rr-off', '');
  }
  function showHint(t) {
    if (!hint) return; const key = HEROES.includes(t) ? 'hero' : t; const msg = (coarse ? HINTS_TOUCH : HINTS)[key]; if (!msg) { hint.hidden = true; return; }
    hint.textContent = msg; hint.hidden = false; clearTimeout(st.hintT); st.hintT = setTimeout(() => { hint.hidden = true; }, 6000);
  }
  function select(t, { auto = false } = {}) {
    if (st.failed && t !== 'map') return;
    if (t === 'map' && !auto) st.userPickedMap = true;
    if (t !== 'map' && !st.ready) {
      // 3D not ready yet: stay on the map; the choice is remembered and opens when the 3D is ready
      ensureStart('click'); st.pending = t; st.userPickedMap = false;
      if (card) { card.hidden = false; card.textContent = (HEROES.includes(t) ? NAMES[t] + ' is highlighted on the map. ' : '') + 'The ' + (NAMES[t] || '3D') + ' view opens here as soon as the 3D has loaded.'; }
      setPressed(t); return;
    }
    // main, Oct 29: the walk modes wait for the last programs (open on first view leaves them compiling behind the overview);
    // a walk started earlier froze for up to 4.5 s on each new material. The choice is kept and opens the moment they are linked.
    if ((t === 'walk' || t === 'free') && st.P && st.P.compiling && !st.compiled) {
      st.waitWalk = t; setPressed(t); if (card) { card.hidden = false; card.textContent = 'Getting the ' + (t === 'free' ? 'free walk' : 'walkthrough') + ' ready, a few more seconds.'; }
      if (!st.waitHooked) { st.waitHooked = true; const go = () => { if (st.compiled) return; st.compiled = true; const w = st.waitWalk; st.waitWalk = null; if (card) card.hidden = true; if (w) select(w); };
        ((st.LK && st.LK.allLinked) || st.P.compiling).then(go, go); setTimeout(go, 40000); }   // every real material (deferred ones too); never hold a walk longer than 40 s
      return; }
    if (card) card.hidden = true;
    st.active = t; setPressed(t);
    if (t === 'map') { showPanel('map'); applyRun(); return; }
    showPanel('3d'); showHint(t);
    const M = st.M; if (!M) return;
    const name = t === '3d' ? '3d' : t;
    if (!st.modesStarted) { st.modesStarted = true; M.start(name); } else M.view(name);
  }
  tablist.addEventListener('click', (e) => { const b = e.target.closest('[data-rr-tab]'); if (!b) return; if (isOff(b) && st.failed) return; select(b.dataset.rrTab); });
  tablist.addEventListener('keydown', (e) => {
    const i = tabs.indexOf(document.activeElement); if (i < 0) return; let j = null;
    if (e.key === 'ArrowRight') j = (i + 1) % tabs.length; else if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') j = 0; else if (e.key === 'End') j = tabs.length - 1;
    if (j == null) return; e.preventDefault(); tabs.forEach((b, k) => { b.tabIndex = k === j ? 0 : -1; }); tabs[j].focus();
  });
  // the walk bar arrows and Escape (rr2_modes listens on window) only while focus is inside the section
  function scopeModeKeys(M) {
    if (!M._onKey) return; removeEventListener('keydown', M._onKey);
    root.addEventListener('keydown', (e) => { if (e.target && e.target.closest && e.target.closest('.rr-tabs')) return; M._onKey(e); });
  }

  // ---- device policy (rr2_flags.js SHIP_TIER_POLICY) ----
  // The tier is read from a throwaway WebGL2 context with the same rules the player uses (rr2_tier.js detectTier), so the
  // decision comes before the renderer and before any download. data-rr-tier forces a tier; data-rr-areas set on the
  // section wins over the policy's area list; RR_FLAGS.lowtex set by the page or the URL wins over the policy's cap.
  function devicePolicy() {
    const out = { mode: policyMode, tier: null, why: null, deviceMemory: navigator.deviceMemory || null };
    if (policyMode === 'off') return out;
    let det = null;
    if (TIERS[tierFlag]) det = { name: tierFlag, why: 'data-rr-tier' };
    else {
      try { const c = document.createElement('canvas'), gl = c.getContext('webgl2');
        if (gl) { const caps = { maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE), maxSamples: gl.getParameter(gl.MAX_SAMPLES), getMaxAnisotropy: () => 1 };
          det = detectTier({ getContext: () => gl, capabilities: caps }); try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch (e) { /* ignore */ } } }
      catch (e) { det = null; }
    }
    if (!det) return out;
    out.tier = det.name; out.why = det.why;
    let key = det.name; if (out.deviceMemory && out.deviceMemory <= 4 && !TIERS[tierFlag]) { key = 'lowmem'; out.why += ', deviceMemory ' + out.deviceMemory; }
    let pol = SHIP_TIER_POLICY[key] || SHIP_TIER_POLICY.desktop;
    if (pol.map && phoneMode !== 'map') pol = phoneMode === 'full' ? SHIP_TIER_POLICY.desktop : SHIP_PHONE_TRY;
    out.key = key; out.map = !!pol.map;
    if (!pol.map) {
      out.areas = areaOpt ? 'data-rr-areas' : pol.areas;
      if (!areaOpt) AREAS = toUrls(pol.areas === 'hero' ? SHIP_AREAS_HERO : pol.areas === 'full' ? SHIP_AREAS : pol.areas);
      if (pol.lowtex && F.lowtex === undefined) F.lowtex = pol.lowtex;
      out.lowtex = F.lowtex || 0;
    }
    out.areaCount = AREAS.length; return out;
  }

  // ---- background preload ----
  async function startLoad() {
    if (st.started) return; st.started = true; st.phase = 'starting';
    try {
      st.policy = devicePolicy(); const pt = st.preT = { start: Math.round(performance.now()) };
      if (st.policy.map) return mapOnly();
      await loadViewer(); pt.viewer = Math.round(performance.now());
      let Cls = RowPlayer;
      const pm = opt('playerModule', null);
      if (pm) { const m = await import(new URL(pm, location.href).href); Cls = m.makePlayer({ THREE, RowPlayer, assets }); }
      // profile: on a page the keys belong to the viewer only while its canvas has focus, and the wheel scrolls the page
      const P = st.P = new Cls(canvas, { basis: BASE + 'vendor/three/examples/jsm/libs/basis/', onProgress: () => {}, ...SHIP_PLAYER, profile: { name: 'swoogo-section', keysNeedFocus: true, wheelModifier: true } });
      // the modes controller hooks into the load (unit tags before merging, collision near the corridor), so it is made first
      const M = st.M = new RowModes(P, { host: panel3d }); pt.ctor = Math.round(performance.now());
      // agent look (Oct 19): RR_FLAGS.look installs the clip planes and the program deferral before the load (rr2_look.js)
      if (+(F.look ?? 0)) { st.LK = installLook(P, M, { ungrade: (h) => ungrade(h, P.exposureEV ?? 0.08), flags: F }); LOOK.bg = '#f4f7f9'; }
      st.tier = P.tier ? { name: P.tier.name, why: P.tier.why } : null;
      if (prog) prog.hidden = false; setPct(0);
      P.on('progress', (d) => { if (!d) return; st.phase = d.phase || st.phase;
        // rough overall share: downloads 0 to 40, textures 40 to 55, programs or compile 55 to 99
        const f = d.total ? d.done / d.total : 0, p = d.phase === 'areas' ? 40 * f : d.phase === 'textures' ? 40 + 15 * f : (d.phase === 'programs' || d.phase === 'compile') ? 55 + 44 * f : null;
        if (p != null) setPct(Math.max(st.pct || 0, p)), st.pct = Math.max(st.pct || 0, p); });
      P.on('ready', () => { st.readyEv = true; st.allLinkedAt = performance.now(); if (st.loaded) finish(); });
      // ship speed: data-rr-open="view" opens the 3D as soon as the player's view is ready on the gate fallbacks (real programs
      // keep streaming in, nearest first); the default "ready" waits for every program as before
      const openMode = opt('open', 'ready'); let viewReady = null;
      if (openMode === 'view') viewReady = new Promise(res => P.on('viewready', () => { st.viewReadyAt = performance.now(); st.readyEv = true; res(); }));
      const pre = P.preload(AREAS, CAPS); if (viewReady) { pre.catch(fail); await viewReady; } else await pre;
      // step timings after the preload (ms), kept in state for the test page and for debugging on the live page
      const tm = st.timing = {}; let t = performance.now(); const lap = (k) => { const n = performance.now(); tm[k] = Math.round(n - t); t = n; };
      lap('preloadDone'); P.setStop?.(STOP, 0); lap('setStop');
      st.modesInit = M.init(); lap('modesInit');
      scopeModeKeys(M); wallClock(M); trackMode(M); trackPerf(P, M);
      if (lookMode === 'cutaway') { st.look = cutaway(P, M); lap('look'); }
      if (st.LK) { st.lookInit = st.LK.init(); lap('lookInit'); }
      st.loaded = true;
      if (st.readyEv || !P.gate) finish();
    } catch (e) { fail(e); }
  }
  // Glides and the overview hold advance by wall clock. The player passes dt capped at 50 ms, so at 2 fps a 3 s glide
  // took 30 s of real time (sect_shots run, Oct 14: four tab clicks 9 s apart never got below 38 m). A frame now moves
  // the glide by the real time since the last step, capped at 250 ms (a resumed loop starts from the capped dt).
  function wallClock(M) {
    const step0 = M.step.bind(M); let last = 0;
    M.step = (dt) => { const n = performance.now(), gap = (n - last) / 1000; last = n; return step0(gap > 0 && gap < 0.25 ? Math.max(dt, gap) : gap >= 0.25 && gap < 1 ? 0.25 : dt); };
  }
  // mode on the panel (CSS hooks: touch-action, hints) and the touch policy
  function trackMode(M) {
    const apply = (d) => { const m = (d && d.mode) || M.mode || ''; panel3d.dataset.rrMode = m;
      canvas.style.touchAction = touchMode === 'viewer' || m === 'free' ? 'none' : 'pan-y'; };
    M.on('mode', apply); apply();
    // a hero label click (isolate) inside the viewer keeps the page tabs in step
    M.on('mode', (d) => { if (!d || !st.ready || st.active === 'map') return; const t = d.mode === 'isolate' ? (d.isolated || '3d') : d.mode === 'overview' ? '3d' : d.mode === 'restaurant' ? M.restaurantId : d.mode;
      if (t && t !== st.active && tabs.some(b => b.dataset.rrTab === t)) { st.active = t; setPressed(t); } });
  }
  // frame time per mode (rAF interval while drawing, and the CPU side of render()), read by the test page
  function trackPerf(P, M) {
    const prev = P.onRendered; let lastN = 0;
    P.onRendered = (dt, ms) => { if (prev) prev(dt, ms); const n = performance.now(), k = (M.glide ? 'glide:' : '') + (M.mode || 'none');
      const r = st.perf[k] ||= { frames: 0, cpuMs: 0, gapMs: 0, gaps: 0, maxGap: 0 }; r.frames++; r.cpuMs += ms;
      if (lastN && n - lastN < 1000) { const g = n - lastN; r.gapMs += g; r.gaps++; r.maxGap = Math.max(r.maxGap, g); } lastN = n; };
    st.perfSummary = () => Object.fromEntries(Object.entries(st.perf).map(([k, r]) => [k, { frames: r.frames, cpuMs: +(r.cpuMs / r.frames).toFixed(1), fps: r.gaps ? +(1000 / (r.gapMs / r.gaps)).toFixed(1) : null, maxGapMs: Math.round(r.maxGap) }]));
  }
  // ---- overview cutaway look ----
  // 1. The floor underlay (rr2_player.addFloorUnderlay: a 60 m disc of 1 m cells under the corridor floor) showed as a
  //    big stepped orange disc around the model in the top views. Cells are kept only where they can fill a gap in a
  //    real floor: inside the walk polygon (plus 1.5 m) or inside a unit footprint. Same material, so no new program.
  // 2. Above the ceilings the background blends from the dark interior colour to a light page colour, and the reference
  //    bloom pass is off up there (a light background is over its threshold). Back on the ground both return.
  // 3. Roof slabs and the veils over the neighbouring units take light tones that sit on that background.
  function cutaway(P, M) {
    const out = { underlay: null };
    const D = M.D, W = D.walk, units = D.units.filter(u => u.poly && u.poly.length > 2);
    let ul = null; P.root.traverse(o => { if (!ul && o.name === 'floor_underlay') ul = o; });
    if (ul) {
      const g = ul.geometry, pos = g.attributes.position, n = pos.count, keep = [];
      for (let i = 0; i < n; i += 6) { let cx = 0, cz = 0; for (let k = 0; k < 6; k++) { cx += pos.getX(i + k); cz += pos.getZ(i + k); } cx /= 6; const by = -cz / 6;
        const ok = (pointInPoly(cx, by, W.outer) || distToPoly(cx, by, W.outer) < 1.5 || (W.extra || []).some(r => pointInPoly(cx, by, r) || distToPoly(cx, by, r) < 1.5)) || units.some(u => pointInPoly(cx, by, u.poly));
        if (ok) keep.push(i); }
      const ng = new THREE.BufferGeometry();
      for (const [name, a] of Object.entries(g.attributes)) { const s = a.itemSize, arr = new a.array.constructor(keep.length * 6 * s);
        keep.forEach((i, c) => arr.set(a.array.subarray(i * s, (i + 6) * s), c * 6 * s)); ng.setAttribute(name, new THREE.BufferAttribute(arr, s, a.normalized)); }
      ng.computeBoundingSphere(); ng.computeBoundingBox(); g.dispose(); ul.geometry = ng; out.underlay = { cellsBefore: n / 6, cellsAfter: keep.length };
    }
    const dark = P.scene.background && P.scene.background.isColor ? P.scene.background.clone() : new THREE.Color(0x15110e);
    const ev = P.exposureEV ?? 0.08, light = ungrade(LOOK.bg, ev), bg = new THREE.Color();
    if (M.veilMats) { const V = M.veilMats; V.roofM.color.copy(ungrade(LOOK.roof, ev)); V.edgeM.color.copy(ungrade(LOOK.roofEdge, ev)); V.veilM.color.copy(ungrade(LOOK.veil, ev)); V.base = LOOK.veilOpacity; }
    const step1 = M.step;
    M.step = (dt) => { const r = step1(dt); const f = M.roofFade || 0;
      if (P.scene.background && P.scene.background.isColor) { bg.copy(dark).lerp(light, f); if (!bg.equals(P.scene.background)) { P.scene.background.copy(bg); P.invalidate?.(1); } }
      if (P.refBloom) { const on = f < 0.5; if (P.refBloom.enabled !== on) { P.refBloom.enabled = on; P.invalidate?.(1); } }
      return r; };
    out.bg = { dark: '#' + dark.getHexString(), lightInput: light.toArray().map(v => +v.toFixed(4)) };
    return out;
  }
  function becomeReady() {
    if (st.ready) return; st.ready = true; st.phase = 'ready'; st.readyAt = performance.now();
    const linked = (st.LK && st.LK.allLinked) || (st.P && st.P.compiling); if (linked) linked.then(() => { st.compiled = true; }); else st.compiled = true;
    setPct(null); if (prog) prog.hidden = true; panel3d.setAttribute('data-rr-ready', '');
    tab3dLike.forEach(b => { b.removeAttribute('aria-disabled'); b.disabled = false; });
    const cap = root.querySelector('.rr-map-caption'); if (cap) cap.lastChild.textContent = 'The 3D view is ready: pick 3D or a restaurant above.';
    root.dispatchEvent(new CustomEvent('rr:ready', { bubbles: true, detail: { seconds: (st.readyAt - st.t0) / 1000 } }));
    maybeSwap('ready');
    // ship speed: with RR_FLAGS.smalltex the full size textures stream in now, behind the open view
    if (+((window.RR_FLAGS || {}).smalltex || 0) && st.P && st.P.upgradeTextures) { st.fullTexStart = performance.now(); st.P.upgradeTextures({ idle: () => performance.now() - (st.lastInput || 0) > 400 && !(st.M && st.M.glide) }).then(s => { st.fullTexAt = performance.now(); st.fullTex = s; }); }
  }
  // Map first: when the 3D is ready, swap to it once, with a fade, if the visitor has not chosen the map or moved focus
  // into the map panel. A restaurant or mode tab picked during the load opens instead of the overview. Off screen the
  // swap waits for the section to come into view (the IntersectionObserver calls back here).
  function maybeSwap(why) {
    if (!st.ready || st.swapAt || st.active !== 'map') return;
    const target = st.pending || (autoSwap ? '3d' : null); if (!target) return;
    if (!st.pending && (st.userPickedMap || panelMap.contains(document.activeElement))) return;
    if (!st.onScreen || !st.pageVisible) return;
    st.swapAt = performance.now(); st.swapWhy = why; st.pending = null;
    select(target, { auto: true }); say('The 3D view of Restaurant Row is ready. ' + (NAMES[target] || '') + ' is showing.');
  }
  // after 'ready' and the load: one warm frame in idle time, then the tabs light up. The warm frame comes first so a
  // click on the freshly enabled tab never lands behind it.
  function finish() {
    if (st.finishing) return; st.finishing = true;
    if (opt('warm', '1') === '0') return becomeReady();
    setPct(99); st.phase = 'warm'; idle(() => { warmFirstView(); gpuDone().then(becomeReady); });
  }
  // Warm frame: the first draw of the opening view is the expensive one (drivers finish pipeline state on first use; on
  // SwiftShader it was a 3 to 12 s task on the click into 3D). Draw it once in idle time while the panel is still
  // hidden, so the click only shows it. A fence tells when the GPU is really done (polled, never a blocking wait).
  function gpuDone(maxMs = 30000) {
    const gl = st.P && st.P.renderer.getContext(), t = performance.now();
    if (!gl || !gl.fenceSync) return Promise.resolve();
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush();
    return new Promise((res) => { const poll = () => {
      let done = true; try { done = gl.getSyncParameter(sync, gl.SYNC_STATUS) === gl.SIGNALED; } catch (e) { /* context lost: stop waiting */ }
      if (done || performance.now() - t > maxMs) { try { gl.deleteSync(sync); } catch (e) { /* ignore */ } (st.timing ||= {}).gpuWait = Math.round(performance.now() - t); res(); }
      else setTimeout(poll, 50); }; setTimeout(poll, 0); });
  }
  function warmFirstView() {
    const { P, M } = st; if (!P || !M || st.modesStarted) return;
    const t = performance.now();
    // warm the view the swap will open (the pending tab, else the overview)
    const first = st.pending && st.pending !== 'map' ? st.pending : '3d';
    try { st.modesStarted = true; M.start(first); P.step(30); P.step(30); P.render(); P.renderer.getContext().flush(); M.pause(); }
    catch (e) { console.warn('warm frame', e); }
    (st.timing ||= {}).warm = Math.round(performance.now() - t);
  }
  const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 3000 }) : setTimeout(fn, 200));
  // policy says map only (phones, low memory): same page state as a failure, a plain message, no console warning
  function mapOnly() { fail(null, 'The 3D view is made for laptops and desktops. The map has every restaurant.'); st.phase = 'maponly'; }
  function fail(e, msg) {
    st.failed = e ? String(e && e.message || e) : 'map only (device policy)'; st.phase = 'failed'; if (e) console.warn('Restaurant Row 3D unavailable:', e);
    msg = msg || 'The 3D view is not available on this device. The map has every restaurant.';
    if (prog) { prog.hidden = false; prog.removeAttribute('role'); prog.textContent = msg; }
    // the map caption said the 3D is loading; say what happens instead
    const cap = root.querySelector('.rr-map-caption'); if (cap && cap.lastChild) cap.lastChild.textContent = msg;
    if (tabPct) tabPct.textContent = '';
    if (card) card.hidden = true; st.pending = null;
    tab3dLike.forEach(b => b.setAttribute('aria-disabled', 'true'));
    say(msg.replace('has every', 'shows every'));
    root.dispatchEvent(new CustomEvent('rr:failed', { bubbles: true, detail: { error: st.failed } }));
  }
  let idleId = null;
  function ensureStart(why) {
    if (st.started) return; st.startWhy = why;
    if (idleId != null && window.cancelIdleCallback) cancelIdleCallback(idleId);
    startLoad();
  }

  // last visitor input on the section (texture swaps wait for a pause in input, not for a still camera: the overview turns by itself)
  for (const ev of ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart']) root.addEventListener(ev, (e) => { if (ev !== 'pointermove' || e.buttons) st.lastInput = performance.now(); }, { passive: true });
  // ---- visibility: section near the screen, browser tab hidden ----
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((es) => { for (const e of es) { st.inView = e.isIntersecting; if (e.isIntersecting && startMode !== 'click') ensureStart('view'); } applyRun(); },
      { rootMargin: '600px 0px' }).observe(root);
    // the swap waits until at least a third of the section is really on screen (not just within the preload margin)
    new IntersectionObserver((es) => { for (const e of es) { st.onScreen = e.isIntersecting; if (e.isIntersecting) maybeSwap('scrolled'); } }, { threshold: 0.33 }).observe(root);
  } else st.onScreen = true;
  document.addEventListener('visibilitychange', () => { st.pageVisible = !document.hidden; applyRun(); if (!document.hidden) maybeSwap('visible'); });
  if (startMode === 'idle') {
    if (window.requestIdleCallback) idleId = requestIdleCallback(() => ensureStart('idle'), { timeout: 4000 });
    else setTimeout(() => ensureStart('idle'), 1500);
  }
  // no WebGL2: keep the map, say so in the 3D panel, never start the download
  try { if (!document.createElement('canvas').getContext('webgl2')) { st.started = true; fail(new Error('WebGL2 not available')); } } catch (e) { /* ignore */ }
  if (reduced) root.setAttribute('data-rr-reduced', '');

  // debug and test hooks: RowSection.alt('gjelina', true) uses the other facade framing for that restaurant
  const api = root.__rr = { state: st, select, get THREE() { return THREE; }, start: () => ensureStart('api'), get player() { return st.P; }, get modes() { return st.M; },
    perf: () => (st.perfSummary ? st.perfSummary() : null),
    alt(id, on = true) { const M = st.M; if (!M) return; (M.heroAlt ||= {})[id] = on; if (st.active === id) M.view(id); } };
  return api;
}
const roots = document.querySelectorAll('.rr-section');
roots.forEach(setup);
window.RowSection = roots.length ? roots[0].__rr : null;
