/* Restaurant Row v4 loader (Oct 22 2026).
   Same place on the Swoogo page as the old v3 viewer: the <section class="v3"> two elements
   before this <script>. It replaces that section's contents with the new baked viewer in an
   iframe (GitHub Pages: /restaurant-row-v1/demo/embed.html), keeps the 16:9 container,
   hides the page's old #row-view-tabs (the viewer carries its own tabs) and adds a
   fallback link. rr-three.js and rr-pano.js may stay on the page; they stay idle.
   Override for testing: window.RR_EMBED_URL before this script. */
(function(){
'use strict';
var cs = document.currentScript;
var SRC = window.RR_EMBED_URL || 'https://rscar17.github.io/restaurant-row-v1/demo/embed.html';
var OPEN = window.RR_OPEN_URL || SRC.replace(/embed\.html(\?.*)?$/, '');
var ORIGIN; try { ORIGIN = new URL(SRC, location.href).origin; } catch (e) { ORIGIN = '*'; }

function findRoot(){
  var a = cs && cs.previousElementSibling, b = a && a.previousElementSibling;
  if (b && b.matches && b.matches('section.v3')) return b;
  if (a && a.matches && a.matches('section.v3')) return a;
  var s = document.querySelector('section.v3');
  if (s) return s;
  var d = document.createElement('section');
  d.className = 'v3';
  d.setAttribute('aria-label', 'Restaurant Row 3D map');
  if (cs && cs.parentNode) cs.parentNode.insertBefore(d, cs); else document.body.appendChild(d);
  return d;
}

function css(){
  if (document.getElementById('rr-v4-css')) return;
  var s = document.createElement('style');
  s.id = 'rr-v4-css';
  s.textContent =
    '.rr #row-view-tabs,.rr>.rr-tabs{display:none!important}' +
    '.rr-v4{position:relative;width:100%;aspect-ratio:16/9;min-height:320px;border-radius:10px;overflow:hidden;background:#e6e9ec}' +
    '.rr-v4.rr-v4-sized{aspect-ratio:auto;min-height:0;border-radius:0;overflow:visible;background:transparent}' +
    '.rr-v4 iframe{display:block;position:absolute;inset:0;width:100%;height:100%;border:0;background:transparent}' +
    '.rr-v4.rr-v4-full{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;height:100dvh!important;z-index:2147483000;border-radius:0;background:#fff}' +
    '.rr-v4-link{display:block;margin:10px 0 0;font-size:13px;line-height:1.4;color:#5f5560}' +
    '.rr-v4-link a{color:#4D144A;text-decoration:underline}' +
    '@media (max-width:767px){.rr-v4{aspect-ratio:4/5;max-height:560px}.rr-v4.rr-v4-sized{max-height:none}}';
  document.head.appendChild(s);
}

function mount(){
  var root = findRoot();
  css();
  root.innerHTML = '';
  var box = document.createElement('div');
  box.className = 'rr-v4';
  var f = document.createElement('iframe');
  f.src = SRC;
  f.title = 'Restaurant Row at The Venetian, Level 1: interactive 3D viewer';
  f.setAttribute('allow', 'fullscreen; xr-spatial-tracking; accelerometer; gyroscope');
  f.setAttribute('allowfullscreen', '');
  f.setAttribute('loading', 'eager');
  f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  box.appendChild(f);
  root.appendChild(box);

  var lastH = 0;
  addEventListener('message', function(e){
    if (ORIGIN !== '*' && e.origin !== ORIGIN) return;
    if (e.source !== f.contentWindow) return;
    var d = e.data;
    if (!d || d.rrEmbed !== 1) return;
    if (d.full) {
      box.classList.add('rr-v4-full');
      document.documentElement.style.overflow = 'hidden';
    } else {
      box.classList.remove('rr-v4-full');
      document.documentElement.style.overflow = '';
      if (d.h > 120 && d.h < 5000) {
        lastH = d.h;
        box.classList.add('rr-v4-sized');
        box.style.height = d.h + 'px';
      }
    }
  });

  /* stubs for anything that read the old globals */
  window.__RR = window.__RR || { embed: true, version: 'v4', iframe: f, src: SRC, get height(){ return lastH; } };
}

if (document.readyState === 'loading' && !(cs && cs.previousElementSibling)) document.addEventListener('DOMContentLoaded', mount);
else mount();
})();
