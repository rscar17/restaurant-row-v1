// rr_ui.js (agent ship, Oct 19 2026): the in-stage overlay of OVERVIEW_DESIGN.md section E, after the Ashcombe Mill UI
// (refs_repos\iamtechartist__ashcombe-mill), in Ryan's palette (aubergine #1E0013, red #E00 for active, Gotham SSm Bold, chalk
// white). HTML and CSS over the canvas only, no engine change. Loaded by rr_v52.js, which owns the tabs, cards and modes wiring.
//  - glass dock at the bottom of the stage: Where (Overview, Gjelina, Milos, Delmonico) | How (Walkthrough, Free walk) |
//    Tools (Top view, zoom, fullscreen, snapshot); active state; tool tooltips; the hint sits above it and fades when a card is open
//  - entrance markers in the overview: a line icon and the name at each restaurant; a click slides an info card in from the right
//  - a branded loader over the stage: three storefronts drawn in line as the load percent rises, a 1 px progress line, small caps
//    status lines; it fades out over 1 s when the 3D opens
//  - narrow stages (under 760 px): the dock folds into a round button with a bottom sheet; the card docks to the bottom
const V = window.__rrV52, S = window.RowSection;
if (V && S && V.stage) {
  const stage = V.stage, CARDS = V.CARDS;
  // copy: the cuisine as the kicker, and the two lines of the v52 page's restaurant data (desc), one line each
  const INFO = {
    gjelina: { kicker: 'Californian', lines: ['Smoked glass frontage', 'Rotunda entrance'], menu: '' },
    milos: { kicker: 'Greek seafood', lines: ['Marble portal', 'Connecting corridor'], menu: '' },
    delmonico: { kicker: 'Steakhouse', lines: ['Bronze and timber', 'Angled corner'], menu: '' }
  };
  const css = `
.rr-ui{--ink:#1E0013;--red:#E00;--chalk:#f4f1ea;--chalk2:#f4f1eac7;--glass:rgba(30,0,19,.42);--line:rgba(244,241,234,.18);--font:'Gotham SSm A','Gotham SSm B','Gotham SSm','Gotham',Montserrat,'Helvetica Neue',Arial,sans-serif;
  position:absolute;inset:0;pointer-events:none;z-index:6;font-family:var(--font);color:var(--chalk)}
.v3-stage .v3-controls,.v3-stage .v3-expand,.v3-stage .rr-progress,.v3-stage .rrm-label{display:none!important}
.v3-stage .v3-hint{display:none!important}
.v3-stage .v3-freepad{bottom:78px!important;left:16px!important}   /* free walk pad sits above the dock, clear of its Where group */
.v3-stage.rr-card-open .v3-hint,.v3-stage.rr-touring .v3-hint{opacity:0}
.rr-ui .dock{position:absolute;left:50%;bottom:20px;transform:translateX(-50%);display:flex;align-items:center;gap:4px;padding:5px;pointer-events:auto;
  background:var(--glass);-webkit-backdrop-filter:blur(14px) saturate(1.15);backdrop-filter:blur(14px) saturate(1.15);border:1px solid var(--line);border-radius:16px;box-shadow:0 10px 30px rgba(20,0,12,.28)}
.rr-ui .group{display:flex;gap:2px}
.rr-ui .sep{width:1px;height:24px;margin:0 4px;background:var(--line)}
.rr-ui .btn{position:relative;display:flex;align-items:center;gap:6px;height:34px;padding:0 10px;border:0;border-radius:11px;background:transparent;color:var(--chalk2);
  font:700 12px/1 var(--font);letter-spacing:.01em;white-space:nowrap;cursor:pointer;transition:background .2s,color .2s}
.rr-ui .btn:hover{color:var(--chalk);background:rgba(244,241,234,.08)}
.rr-ui .btn.on{color:#fff;background:rgba(238,0,0,.24);box-shadow:inset 0 0 0 1px rgba(238,0,0,.65)}
.rr-ui .btn:focus-visible,.rr-ui .marker:focus-visible{outline:1.5px solid var(--red);outline-offset:2px}
.rr-ui .tools .btn{padding:0 9px}
.rr-ui .tools .btn svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.6}
.rr-ui .tools .btn span{position:absolute;bottom:calc(100% + 10px);left:50%;transform:translate(-50%,4px);opacity:0;pointer-events:none;padding:4px 8px;border-radius:7px;
  background:rgba(30,0,19,.9);color:var(--chalk);font-size:11px;transition:opacity .15s,transform .15s}
.rr-ui .tools .btn:hover span,.rr-ui .tools .btn:focus-visible span{opacity:1;transform:translate(-50%,0)}
.rr-ui .fab{display:none;position:absolute;right:16px;bottom:16px;width:48px;height:48px;border-radius:50%;place-items:center;pointer-events:auto;cursor:pointer;
  background:var(--glass);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);border:1px solid var(--line);color:var(--chalk)}
.rr-ui .fab svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.6}
.rr-ui .marker{position:absolute;left:0;top:0;display:flex;flex-direction:column;align-items:center;pointer-events:none;border:0;background:none;padding:0;opacity:0;transition:opacity .3s}
.rr-ui .marker.show{opacity:1}
.rr-ui .marker .pill{pointer-events:auto;cursor:pointer;display:block;padding:6px 11px;border-radius:999px;background:rgba(30,0,19,.88);color:#fff;border:1px solid rgba(244,241,234,.22);
  font:700 12px/1 var(--font);letter-spacing:.01em;white-space:nowrap;box-shadow:0 4px 14px rgba(20,0,12,.3);transition:transform .2s,background .2s}
.rr-ui .marker .lead{display:block;width:1px;height:30px;background:linear-gradient(rgba(244,241,234,.85),rgba(244,241,234,.35))}
.rr-ui .marker .dot{display:block;width:5px;height:5px;border-radius:50%;background:#fff;box-shadow:0 0 0 2px rgba(30,0,19,.55);margin-top:-2px}
.rr-ui .marker .pill:hover{transform:translateY(-2px);background:#1E0013}
.v3-stage.rr-touring .rr-ui .marker{opacity:0!important;pointer-events:none}
.rr-ui .card{position:absolute;top:50%;right:20px;width:280px;transform:translate(24px,-50%);opacity:0;visibility:hidden;pointer-events:auto;padding:22px 22px 18px;
  background:rgba(255,255,255,.96);color:#1E0013;border-radius:14px;border:1px solid rgba(30,0,19,.08);box-shadow:0 18px 50px rgba(20,0,12,.28);
  transition:opacity .35s ease,transform .35s ease,visibility 0s linear .35s;font-family:var(--font)}
.rr-ui .card.open{opacity:1;visibility:visible;transform:translate(0,-50%);transition:opacity .35s ease,transform .35s ease}
.rr-ui .card .kicker{font:700 9.5px/1 var(--font);letter-spacing:.22em;text-transform:uppercase;color:#E00}
.rr-ui .card h2{font:700 22px/1.15 var(--font);color:#1E0013;margin:9px 0 8px}
.rr-ui .card p{font:400 13px/1.55 Georgia,'Times New Roman',serif;color:#3a2a33;margin:0}
.rr-ui .card .acts{display:flex;gap:14px;margin-top:14px;padding-top:12px;border-top:1px solid rgba(30,0,19,.12)}
.rr-ui .card .acts a,.rr-ui .card .acts button{font:700 12px/1 var(--font);color:#1E0013;background:none;border:0;padding:0;cursor:pointer;text-decoration:none}
.rr-ui .card .acts a:hover,.rr-ui .card .acts button:hover{color:#E00}
.rr-ui .card .x{position:absolute;top:10px;right:10px;width:28px;height:28px;border-radius:50%;border:0;background:none;color:#6b4a5c;cursor:pointer;font-size:18px;line-height:1}
.rr-ui .card .x:hover{background:rgba(30,0,19,.07)}
.v3-stage.rr-narrow .rr-ui .fab{display:grid}
.v3-stage.rr-narrow .rr-ui .dock{left:12px;right:12px;bottom:72px;transform:translateY(12px);flex-direction:column;align-items:stretch;opacity:0;visibility:hidden;transition:opacity .25s,transform .25s,visibility .25s}
.v3-stage.rr-narrow.rr-sheet-open .rr-ui .dock{opacity:1;visibility:visible;transform:translateY(0)}
.v3-stage.rr-narrow .rr-ui .group{flex-wrap:wrap;justify-content:space-between}
.v3-stage.rr-narrow .rr-ui .group .btn{flex:1 1 30%;justify-content:center}
.v3-stage.rr-narrow .rr-ui .sep{width:100%;height:1px;margin:4px 0}
.v3-stage.rr-narrow .rr-ui .tools .btn span{position:static;opacity:1;transform:none;background:none;padding:0}
.v3-stage.rr-narrow .rr-ui .card{left:12px;right:12px;width:auto;top:auto;bottom:76px;transform:translateY(16px)}
.v3-stage.rr-narrow .rr-ui .card.open{transform:translateY(0)}
.v3-stage.rr-narrow .v3-hint{display:none!important}
.v3-stage.rr-narrow .v3-freepad{bottom:76px}
.rr-ui .lline{position:absolute;left:0;right:0;bottom:0;height:2px;background:rgba(30,0,19,.18);z-index:3;transition:opacity .6s}
.rr-ui .lline i{display:block;height:100%;width:0;background:#E00;transition:width .3s}
.rr-ui .lstat{position:absolute;left:50%;bottom:10px;transform:translateX(-50%);z-index:3;padding:4px 10px;border-radius:999px;background:rgba(255,255,255,.86);color:#1E0013;font:700 10px/1.3 var(--font);letter-spacing:.2em;text-transform:uppercase;white-space:nowrap;pointer-events:auto;transition:opacity .6s}
.rr-ui .lstat.go{cursor:pointer;background:#1E0013;color:#fff}
.rr-ui .gone{opacity:0}
.rr-ui .pop{position:absolute;left:50%;bottom:76px;transform:translate(-50%,8px);min-width:280px;padding:14px 16px 12px;pointer-events:auto;opacity:0;visibility:hidden;
  background:var(--glass);-webkit-backdrop-filter:blur(14px) saturate(1.15);backdrop-filter:blur(14px) saturate(1.15);border:1px solid var(--line);border-radius:16px;
  box-shadow:0 10px 30px rgba(20,0,12,.28);transition:opacity .2s,transform .2s,visibility 0s linear .2s}
.rr-ui .pop.open{opacity:1;visibility:visible;transform:translate(-50%,0);transition:opacity .2s,transform .2s}
.rr-ui .pop .row{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:6px 0}
.rr-ui .pop label{font:700 10px/1.2 var(--font);letter-spacing:.18em;text-transform:uppercase;color:var(--chalk2)}
.rr-ui .pop .seg{display:flex;padding:2px;border:1px solid var(--line);border-radius:10px}
.rr-ui .pop .seg button{border:0;background:none;color:var(--chalk2);font:700 11px/1 var(--font);padding:6px 10px;border-radius:8px;cursor:pointer}
.rr-ui .pop .seg button.on{background:rgba(238,0,0,.24);color:#fff;box-shadow:inset 0 0 0 1px rgba(238,0,0,.65)}
.rr-ui .pop input[type=range]{width:140px;accent-color:#E00}
.rr-ui .pop output{font:700 11px/1 var(--font);color:var(--chalk);min-width:38px;text-align:right}
.v3-stage.rr-pop-open .v3-hint{opacity:0}
.rr-vig{position:absolute;left:0;top:0;width:min(460px,70%);height:150px;pointer-events:none;background:radial-gradient(120% 100% at 0 0,rgba(30,0,19,.34),rgba(30,0,19,.12) 45%,transparent 72%)}
.v3-stage:not(.v52-3d) .rr-vig{display:none}
.v3-stage.rr-narrow .rr-ui .pop{left:12px;right:12px;bottom:auto;top:12px;transform:translateY(-8px);min-width:0}
.v3-stage.rr-narrow .rr-ui .pop.open{transform:translateY(0)}
@media (prefers-reduced-motion:reduce){.rr-ui .dock,.rr-ui .card,.rr-ui .marker,.rr-ui .lline,.rr-ui .lstat,.rr-ui .pop{transition:none}}`;
  const st = document.createElement('style'); st.id = 'rr-ui-style'; st.textContent = css; document.head.append(st);
  const ui = document.createElement('div'); ui.className = 'rr-ui'; stage.append(ui);
  const I = {
    eye: '<svg viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    top: '<svg viewBox="0 0 24 24"><path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/></svg>',
    zin: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="M11 8v6M8 11h6M16 16l4 4"/></svg>',
    zout: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="M8 11h6M16 16l4 4"/></svg>',
    full: '<svg viewBox="0 0 24 24"><path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/></svg>',
    snap: '<svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="13" rx="2"/><circle cx="12" cy="13.5" r="3.5"/><path d="M8 7l2-3h4l2 3"/></svg>',
    cut: '<svg viewBox="0 0 24 24"><path d="M3 9l9-5 9 5-9 5-9-5z" stroke-dasharray="2 2"/><path d="M3 15l9 5 9-5"/><path d="M12 14v6"/></svg>',
    gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>',
    menu: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    mark: '<svg viewBox="0 0 24 24"><path d="M12 2l3 7h7l-5.5 4.5L18.5 21 12 16.5 5.5 21l2-7.5L2 9h7z"/></svg>'
  };
  // ---- dock ----
  const dock = document.createElement('div'); dock.className = 'dock'; dock.setAttribute('role', 'toolbar'); dock.setAttribute('aria-label', 'Restaurant Row view');
  const btn = (k, label, tip) => `<button type="button" class="btn" data-k="${k}"${tip ? ` aria-label="${tip}"` : ''}>${label}</button>`;
  dock.innerHTML = '<div class="group where">' + btn('3d', 'Overview') + CARDS.map(c => btn(c.id, c.id === 'milos' ? 'Milos' : c.id === 'delmonico' ? 'Delmonico' : 'Gjelina')).join('') + '</div><i class="sep"></i>'
    + '<div class="group how">' + btn('walk', 'Walkthrough') + btn('free', 'Free walk') + '</div><i class="sep"></i>'
    + '<div class="group tools">' + btn('top', I.top + '<span>Top view</span>', 'Top view') + btn('in', I.zin + '<span>Zoom in</span>', 'Zoom in') + btn('out', I.zout + '<span>Zoom out</span>', 'Zoom out')
    + btn('cut', I.cut + '<span>Cut-away</span>', 'Cut-away') + btn('set', I.gear + '<span>Settings</span>', 'Settings') + btn('full', I.full + '<span>Fullscreen</span>', 'Fullscreen') + btn('snap', I.snap + '<span>Snapshot</span>', 'Snapshot') + '</div>';
  ui.append(dock);
  // look settings: the look agent's window.RRLook when present (toggleCut, setCut, labels), else no-ops
  const look = { cut: false, cutH: 3.2, labels: true, speed: 1 };
  const L = (fn, ...a) => { const R = window.RRLook; try { if (R && typeof R[fn] === 'function') R[fn](...a); } catch (e) { console.warn('RRLook.' + fn, e); } };
  const pop = document.createElement('div'); pop.className = 'pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'View settings');
  pop.innerHTML = '<div class="row"><label>Labels</label><div class="seg" data-g="labels"><button type="button" data-v="1" class="on">On</button><button type="button" data-v="0">Off</button></div></div>'
    + '<div class="row"><label>Cut height</label><input type="range" min="1.2" max="4.5" step="0.1" value="3.2" data-r="cut"><output>3.2 m</output></div>'
    + '<div class="row"><label>Walk speed</label><input type="range" min="0.5" max="2" step="0.1" value="1" data-r="speed"><output>1.0x</output></div>';
  ui.append(pop);
  pop.addEventListener('click', (e) => { const b = e.target.closest('.seg button'); if (!b) return; const g = b.parentElement.dataset.g;
    b.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    if (g === 'labels') { look.labels = b.dataset.v === '1'; L('labels', look.labels); } });
  pop.addEventListener('input', (e) => { const r = e.target.closest('input[data-r]'); if (!r) return; const v = +r.value, out = r.nextElementSibling;
    if (r.dataset.r === 'cut') { look.cutH = v; out.textContent = v.toFixed(1) + ' m'; L('setCut', v); }
    if (r.dataset.r === 'speed') { look.speed = v; out.textContent = v.toFixed(1) + 'x'; } });
  // walk speed without an engine change: in free walk the player's step runs with its time scaled (movement is velocity times time)
  const wrapSpeed = () => { const P = S.player; if (!P || P._rrSpeed) return !!P; const step0 = P.step.bind(P); P._rrSpeed = true;
    P.step = (dt) => step0(S.modes && S.modes.mode === 'free' && look.speed !== 1 ? dt * look.speed : dt); return true; };
  const sp = setInterval(() => { if (wrapSpeed()) clearInterval(sp); }, 200);
  // soft vignette behind the top-left stage title (the v52 stamp), so it reads over any view
  const vig = document.createElement('div'); vig.className = 'rr-vig'; const stampEl = stage.querySelector('.v3-stamp'); if (stampEl) stage.insertBefore(vig, stampEl); else stage.append(vig);
  const fab = document.createElement('button'); fab.type = 'button'; fab.className = 'fab'; fab.setAttribute('aria-label', 'View controls'); fab.innerHTML = I.menu; ui.append(fab);
  fab.addEventListener('click', () => stage.classList.toggle('rr-sheet-open'));
  const zoom = (f) => { const P = S.player, M = S.modes; if (!P) return; const c = P.camera; c.fov = Math.min(75, Math.max(20, c.fov * f)); c.updateProjectionMatrix(); if (M && M._set) M._set.fov = c.fov; P.invalidate && P.invalidate(2); };
  const snapshot = () => { const P = S.player; if (!P) return; try { P.render(); const a = document.createElement('a'); a.download = 'restaurant-row.png'; a.href = P.renderer.domElement.toDataURL('image/png'); a.click(); } catch (e) { console.warn('snapshot', e); } };
  dock.addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (!b) return; const k = b.dataset.k, M = S.modes;
    if (k === '3d') { if (M) M._v52top = false; S.select('3d'); setTimeout(() => V.showWhole(), 0); }
    else if (k === 'top') { if (M) M._v52top = !M._v52top; if (S.state.active !== '3d') S.select('3d'); setTimeout(() => (M && M._v52top ? V.showTop() : V.showWhole()), 0); }
    else if (k === 'in') zoom(0.85); else if (k === 'out') zoom(1.18);
    else if (k === 'full') V.setExpanded(!V.v3.classList.contains('v3-expanded'));
    else if (k === 'snap') snapshot();
    else if (k === 'cut') { look.cut = !look.cut; L('toggleCut', look.cut); }
    else if (k === 'set') { pop.classList.toggle('open'); stage.classList.toggle('rr-pop-open', pop.classList.contains('open')); return; }
    else S.select(k);
    if (stage.classList.contains('rr-narrow') && !['in', 'out'].includes(k)) stage.classList.remove('rr-sheet-open');
    setTimeout(sync, 0); });
  // ---- info card ----
  const card = document.createElement('div'); card.className = 'card'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-live', 'polite'); ui.append(card);
  let cardId = null;
  const openCard = (id) => { const c = CARDS.find(x => x.id === id), d = INFO[id]; if (!c || !d) return; cardId = id;
    card.innerHTML = `<button type="button" class="x" aria-label="Close">&times;</button><div class="kicker">${d.kicker}</div><h2>${c.name}</h2><p>${d.lines[0]}<br>${d.lines[1]}</p>`
      + `<div class="acts"><button type="button" data-go="${id}">View entrance &rarr;</button>${d.menu ? `<a href="${d.menu}" target="_blank" rel="noopener">View menu &rarr;</a>` : ''}</div>`;
    card.classList.add('open'); stage.classList.add('rr-card-open'); };
  const closeCard = () => { cardId = null; card.classList.remove('open'); stage.classList.remove('rr-card-open'); };
  card.addEventListener('click', (e) => { if (e.target.closest('.x')) closeCard(); const g = e.target.closest('[data-go]'); if (g) { closeCard(); S.select(g.dataset.go); } });
  // ---- markers (overview only, hidden while gliding) ----
  const markers = CARDS.map(c => { const b = document.createElement('button'); b.type = 'button'; b.className = 'marker'; b.innerHTML = '<span class="pill">' + (c.id === 'milos' ? 'Milos' : c.id === 'delmonico' ? 'Delmonico' : 'Gjelina') + '</span><span class="lead"></span><span class="dot"></span>';
    b.setAttribute('aria-label', c.name + ': details'); b.addEventListener('click', () => openCard(c.id)); ui.append(b); return { id: c.id, el: b }; });
  let v = null, dead = false;   // THREE comes from rr_section (RowSection.THREE) once the 3D has loaded
  document.addEventListener('rr:failed', () => { dead = true; ui.remove(); });
  const tick = () => { if (dead || S.state.failed) { dead = true; ui.remove(); return; } requestAnimationFrame(tick);
    if (!S.state.inView || document.hidden) return;
    if (!S.state.ready) { stage.classList.toggle('rr-narrow', stage.clientWidth < 760); loaderTick(); tabTick(); return; }   // before the 3D: no markers
    const M = S.modes, P = S.player; const ready = true; if (!v) v = new S.THREE.Vector3();
    const over = ready && M && M.mode === 'overview' && S.state.active === '3d'; const glide = !!(M && M.glide);
    stage.classList.toggle('rr-touring', glide);
    for (const m of markers) { const h = over && look.labels && M.D && M.D.heroes[m.id]; if (!h || !P) { m.el.classList.remove('show'); continue; }
      const L = h.label; v.set(L[0], L[2], -L[1]).project(P.camera); const w = stage.clientWidth, hh = stage.clientHeight; const vis = v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1;
      m.el.classList.toggle('show', vis); if (vis) m.el.style.transform = `translate(${((v.x + 1) / 2 * w).toFixed(1)}px,${((1 - v.y) / 2 * hh).toFixed(1)}px) translate(-50%,-100%)`; }
    if (cardId && !(over || S.state.active === cardId)) closeCard();
    stage.classList.toggle('rr-narrow', stage.clientWidth < 760);
    loaderTick(); tabTick(); };
  // ---- active state ----
  const sync = () => { const t = S.state.active, M = S.modes; dock.querySelectorAll('[data-k]').forEach(b => { const k = b.dataset.k;
    b.classList.toggle('on', k === 'cut' ? look.cut : k === 'set' ? pop.classList.contains('open') : k === 'top' ? !!(M && M._v52top) && t === '3d' : k === '3d' ? t === '3d' && !(M && M._v52top) : k === t); }); };
  new MutationObserver(sync).observe(document.querySelector('.rr-section'), { subtree: true, attributes: true, attributeFilter: ['aria-selected'] });
  // ---- load progress: the Resort map stays on the stage while the 3D loads (map first, as before); a 2 px red line along the
  // bottom of the stage and one small caps status line; both leave when the 3D opens
  const lline = document.createElement('div'); lline.className = 'lline'; lline.innerHTML = '<i></i>'; ui.append(lline);
  const lstat = document.createElement('div'); lstat.className = 'lstat'; lstat.setAttribute('role', 'status'); lstat.textContent = 'Loading the row'; ui.append(lstat);
  lstat.addEventListener('click', () => { if (S.state.ready) S.select('3d'); });
  const lbar = lline.firstChild; let shown = 0, gone = false;
  function loaderTick() {
    if (gone) return; const s = S.state;
    if (s.failed) { lline.remove(); lstat.remove(); gone = true; return; }
    if (s.ready && s.active !== 'map') { lline.classList.add('gone'); lstat.classList.add('gone'); gone = true; setTimeout(() => { lline.remove(); lstat.remove(); }, 700); return; }
    const p = s.ready ? 100 : Math.max(0, Math.min(99, s.pct || 0)); shown += (p - shown) * 0.1; lbar.style.width = shown.toFixed(1) + '%';
    const txt = s.ready ? 'Ready: open 3D' : p >= 55 ? 'Lighting the restaurants' : 'Loading the row';
    if (lstat.textContent !== txt) lstat.textContent = txt; lstat.classList.toggle('go', !!s.ready); }
  // the page tabs and the side cards show what the stage shows (a tab picked during the load stays unpressed until it opens)
  const vtabs = document.getElementById('row-view-tabs'); const vcards = [...document.querySelectorAll('.v3-cards .v3-card')];
  function tabTick() { const a = S.state.active; const view = a === 'map' ? 'flat' : a === '3d' ? '3d' : a === 'free' ? 'free' : 'walk';
    if (vtabs) vtabs.querySelectorAll('[data-view]').forEach(b => { const on = String(b.dataset.view === view); if (b.getAttribute('aria-pressed') !== on) b.setAttribute('aria-pressed', on); });
    vcards.forEach(c => { const on = String(c.dataset.id === a); if (c.getAttribute('aria-pressed') !== on) c.setAttribute('aria-pressed', on); }); }
  stage.addEventListener('pointerdown', (e) => { if (pop.classList.contains('open') && !e.target.closest('.pop') && !e.target.closest('[data-k=set]')) { pop.classList.remove('open'); stage.classList.remove('rr-pop-open'); sync(); } });
  sync(); requestAnimationFrame(tick);
}
