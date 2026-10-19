// rr_v52.js (agent ship, Oct 16 2026): Ryan's v52 page shell around the ship viewer. Entry module of the Swoogo block.
// The v52 markup keeps its own page tabs (#row-view-tabs: 3D, Walkthrough, Free walk, Resort map) and the restaurant cards in
// the side panel (.v3-cards). The viewer section (.rr-section, rr_section.js) sits inside the v52 stage (.v3-stage); its own tab
// row is hidden and driven from here, so the visitor only ever sees Ryan's tabs and cards.
import './rr_section.js';

const BASE = new URL('./', import.meta.url).href;
const S = window.RowSection;
const rr = document.querySelector('.rr'); const tabs = document.getElementById('row-view-tabs');
const cardsBox = rr && rr.querySelector('.v3-cards'); const live = rr && rr.querySelector('.v3-live');
const CARDS = [
  { id: 'gjelina', name: 'Gjelina' },
  { id: 'milos', name: 'estiatorio Milos' },
  { id: 'delmonico', name: 'Delmonico Steakhouse' }
];
const VIEW_TO_TAB = { '3d': '3d', walk: 'walk', free: 'free', flat: 'map' };

if (S && rr && tabs) {
  const sec = document.querySelector('.rr-section');
  const own = [...sec.querySelectorAll('.rr-tabs [data-rr-tab]')];
  const ownTab = (t) => own.find(b => b.dataset.rrTab === t);
  // the 3D tab shows the load percentage, as the section's own 3D tab does
  const b3d = tabs.querySelector('[data-view="3d"]'); const pct = document.createElement('span'); pct.className = 'rr-v52-pct'; if (b3d) b3d.append(pct);
  // cards: the v52 card markup (photo, number, name, "View entrance")
  const cards = [];
  if (cardsBox) CARDS.forEach((d, i) => {
    const c = document.createElement('button'); c.type = 'button'; c.className = 'v3-card'; c.dataset.id = d.id; c.setAttribute('aria-pressed', 'false');
    c.innerHTML = `<img class="v3-thumb" src="${BASE}cards/${d.id}.jpg" alt=""><span><small>0${i + 1}</small><b>${d.name}</b><span class="v3-entry-hint">View entrance <img class="v3-arrow" src="https://assets.swoogo.com/uploads/6598497-69a5aed9c4fd2.svg" alt="" aria-hidden="true"></span></span>`;
    c.addEventListener('click', () => S.select(d.id)); cardsBox.append(c); cards.push(c); });
  tabs.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => { const t = VIEW_TO_TAB[b.dataset.view]; if (t) S.select(t); }));
  // mirror the section state onto Ryan's tabs and cards (the section changes it by itself too: the automatic swap to 3D,
  // a label click in the overview, the walk reaching a restaurant)
  const sync = () => {
    const sel = own.find(b => b.getAttribute('aria-selected') === 'true'); const t = sel ? sel.dataset.rrTab : 'map';
    const view = t === 'map' ? 'flat' : t === '3d' ? '3d' : t === 'free' ? 'free' : 'walk';   // a restaurant view counts as the walk tab, as on v52
    tabs.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
    cards.forEach(c => c.setAttribute('aria-pressed', String(c.dataset.id === t)));
    const p = ownTab('3d') && ownTab('3d').querySelector('.rr-pct'); pct.textContent = p && p.textContent ? ' ' + p.textContent : '';
  };
  new MutationObserver(sync).observe(sec, { subtree: true, attributes: true, attributeFilter: ['aria-selected', 'aria-disabled'], characterData: true, childList: true });
  sync();
  // v52 in-stage controls (stamp, hint, zoom, Top view / Overview, previous / next entrance, expand), driven by the ship modes.
  // v52 opens on the whole lit row (three quarter, light ground, three labels): the modes' intro frame is held there, and
  // "Top view" glides to the modes' rest view (70 degrees by default, RR_FLAGS.ovel).
  const stage = rr.querySelector('.v3-stage'), stamp = rr.querySelector('.v3-stamp'), hint = rr.querySelector('.v3-hint'), ctl = rr.querySelector('.v3-controls');
  const dot = ' · ';
  const expand = document.createElement('button'); expand.type = 'button'; expand.className = 'v3-expand'; expand.setAttribute('aria-label', 'Expand interactive map');
  const ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/></svg>';
  expand.innerHTML = ICON; if (stage) stage.append(expand);
  const v3 = rr.querySelector('.v3');
  const setExpanded = (on) => { v3.classList.toggle('v3-expanded', on); document.body.style.overflow = on ? 'hidden' : ''; expand.innerHTML = on ? '&times;' : ICON;
    expand.setAttribute('aria-label', on ? 'Close expanded map' : 'Expand interactive map'); const P = S.player; if (P && P.resize) setTimeout(() => P.resize(), 50); };
  expand.addEventListener('click', () => setExpanded(!v3.classList.contains('v3-expanded')));
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && v3.classList.contains('v3-expanded')) setExpanded(false); });
  // the overview rest frame is switched, not held: "Overview" rests on the whole row at the intro angle (v52's framing),
  // "Top view" on the three heroes at the modes' rest angle (70 degrees, RR_FLAGS.ovel). Both go through the modes' own rest path.
  let orig = null;
  const frame = (kind) => { const M = S.modes; if (!M || !M.D || !M.D.overview) return false; const O = M.D.overview;
    if (!orig) orig = { heroBox: O.heroBox, restElDeg: O.restElDeg, restAzDeg: O.restAzDeg };
    if (kind === 'whole') { O.heroBox = O.rowBox; O.restElDeg = O.introElDeg; O.restAzDeg = O.introAzDeg; } else Object.assign(O, orig); return true; };
  const holdWhole = () => frame('whole');
  const showWhole = () => { const M = S.modes; if (frame('whole') && M.overview) M.overview({ intro: false }); };
  const showTop = () => { const M = S.modes; if (frame('top') && M.overview) M.overview({ intro: false }); };
  // v52 free walk pad (bottom left, styled by v52's .v3-freepad CSS): press and hold an arrow to walk; it drives the player's
  // move vector, the same input the touch stick uses, so keyboard (W A S D, arrows) and drag-to-look keep working beside it
  const pad = document.createElement('div'); pad.className = 'v3-freepad'; pad.hidden = true; pad.setAttribute('aria-label', 'Free walking controls');
  const held = new Set(); const AX = { w: [0, 1], s: [0, -1], a: [-1, 0], d: [1, 0] };
  const apply = () => { const P = S.player; if (!P || !P.move) return; let x = 0, y = 0; for (const k of held) { x += AX[k][0]; y += AX[k][1]; } P.move.set(Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y))); P.invalidate && P.invalidate(2); };
  for (const [label, key, sym] of [['Move forward', 'w', '\u2191'], ['Move left', 'a', '\u2190'], ['Move backward', 's', '\u2193'], ['Move right', 'd', '\u2192']]) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = sym; b.setAttribute('aria-label', label); b.dataset.key = key;
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } held.add(key); apply(); });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, () => { held.delete(key); apply(); });
    pad.append(b); }
  if (stage) stage.append(pad);
  const order = CARDS.map(c => c.id);
  const ui = () => {
    const sel = own.find(b => b.getAttribute('aria-selected') === 'true'); const t = sel ? sel.dataset.rrTab : 'map';
    const M = S.modes, mode = M && M.mode; const on3d = t !== 'map' && S.state.ready;
    // the automatic open (and its select('3d')) lands on the modes' rest view: show the whole row instead, once, as v52 opens
    if (t === '3d' && S.state.swapAt && !ui.opened) { ui.opened = true; if (M) M._v52top = false; }
    const free = t === 'free';
    stage && stage.classList.toggle('v52-3d', !!on3d && (t === '3d' || order.includes(t) || free));
    const entrance = order.includes(t);
    if (pad) pad.hidden = !(free && on3d);
    if (free) { if (stamp) stamp.innerHTML = '<strong>Free walk</strong>Explore the corridor'; if (hint) hint.textContent = 'WASD / arrows to move' + dot + 'Drag to look' + dot + 'Use the arrow pad on touch'; if (ctl) ctl.querySelectorAll('[data-a]').forEach(b => { b.hidden = true; }); return; }
    if (stamp) stamp.innerHTML = entrance ? '<strong>' + (CARDS.find(c => c.id === t).name) + '</strong>Entrance view' : '<strong>Restaurant Row / ' + (M && M._v52top ? 'Top view' : 'Overview') + '</strong>Drag to explore';
    if (hint) hint.textContent = entrance ? 'Drag to look around' + dot + 'Switch to Free walk to explore' : 'Drag to orbit' + dot + 'Shift + drag to pan' + dot + 'Tap an entrance';
    if (ctl) ctl.querySelectorAll('[data-a]').forEach(b => { const a = b.dataset.a; b.hidden = entrance ? (a === 'top' || a === 'reset') : (a === 'prev' || a === 'next');
      if (a === 'reset') b.setAttribute('aria-pressed', String(!entrance && !(M && M._v52top))); if (a === 'top') b.setAttribute('aria-pressed', String(!entrance && !!(M && M._v52top))); });
  };
  if (ctl) ctl.addEventListener('click', (e) => { const b = e.target.closest('[data-a]'); if (!b) return; const a = b.dataset.a, M = S.modes, P = S.player; if (!M || !P) return;
    if (a === 'in' || a === 'out') { const c = P.camera; c.fov = Math.min(75, Math.max(20, c.fov * (a === 'in' ? 0.85 : 1.18))); c.updateProjectionMatrix(); if (M._set) M._set.fov = c.fov; P.invalidate && P.invalidate(2); return; }
    if (a === 'top') { M._v52top = true; showTop(); ui(); return; }
    if (a === 'reset') { M._v52top = false; showWhole(); ui(); return; }
    if (a === 'prev' || a === 'next') { const sel = own.find(x => x.getAttribute('aria-selected') === 'true'); const i = order.indexOf(sel && sel.dataset.rrTab);
      S.select(order[(Math.max(0, i) + (a === 'next' ? 1 : order.length - 1)) % order.length]); } });
  // the 3D tab and the automatic open both land on the whole row, as on v52
  if (b3d) b3d.addEventListener('click', () => { const M = S.modes; if (M) M._v52top = false; setTimeout(() => { if (S.state.ready) showWhole(); ui(); }, 0); });
  // v52 rules inside the viewer: a label tap opens that restaurant's entrance view (v52 "Tap an entrance"), never the isolated
  // cut-away orbit, so the modes' "Back to the row" bar never shows over the v52 controls. Entrance views keep the desktop pose
  // at every stage shape: below 16:9 (tablets, narrow windows, portrait phones) the field of view widens so the horizontal view
  // stays the desktop one, instead of the data's pulled back 'narrow' framing (capped at 95 degrees).
  const v52modes = (M) => {
    const iso = M.isolate.bind(M);
    M.isolate = (id) => (id ? S.select(id) : iso(null));
    M.heroView = function (id) { const h = this.D.heroes[id]; const src = this.heroAlt && this.heroAlt[id] && h.alt ? (h.alt.wide || h.view) : h.view;
      const a = this.P.camera.aspect || 16 / 9, base = src.fov || 60; if (a >= 16 / 9) return src;
      const hf = 2 * Math.atan(Math.tan(base * Math.PI / 360) * 16 / 9), vf = Math.min(95, 2 * Math.atan(Math.tan(hf / 2) / a) * 180 / Math.PI);
      return { ...src, fov: vf }; };
  };
  // the hint bar sits between the bottom button rows: below 900 px of stage width it would run under them, so it hides there
  if (stage && hint && 'ResizeObserver' in window) new ResizeObserver(() => { hint.style.display = stage.clientWidth < 900 ? 'none' : ''; }).observe(stage);
  const waitModes = setInterval(() => { if (S.modes && S.modes.D && S.modes.D.overview) { holdWhole(); clearInterval(waitModes); v52modes(S.modes); S.modes.on('mode', ui); } }, 50);
  new MutationObserver(ui).observe(sec, { subtree: true, attributes: true, attributeFilter: ['aria-selected', 'data-rr-ready'] });
  ui();
  const status = sec.querySelector('[data-rr-status]');
  if (status && live) new MutationObserver(() => { live.textContent = status.textContent; }).observe(status, { childList: true, characterData: true, subtree: true });
}
