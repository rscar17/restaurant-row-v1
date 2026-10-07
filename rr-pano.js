/* Restaurant Row: Blender 360 views (entrances + walkthrough). Plain script, uses window.THREE. */
(function(){
var T=window.THREE; if(!T) return;
var BASE=(window.RR_PANO_BASE||'pano/');
var MOBILE=matchMedia('(max-width:820px),(pointer:coarse)').matches;
var SUF=MOBILE?'_m':'';
var ENTR={gjelina:{id:'entrance_gjelina',yaw:-16.7},milos:{id:'entrance_milos',yaw:-19.29},delmonico:{id:'entrance_delmonico',yaw:0}};
var WALK=[];for(var i=0;i<15;i++)WALK.push('walk_'+(i<10?'0':'')+i);
var WALKYAW=[-166.7, -133.9, -90.2, -78.2, -80.3, -84.5, -86.1, -87.1, -86.2, -83.6, -79.0, -71.0, -62.8, -55.4, -51.4];
var FACES={px:[[1,0,0],[0,1,0]],nx:[[-1,0,0],[0,1,0]],py:[[0,1,0],[0,0,-1]],ny:[[0,-1,0],[0,0,1]],pz:[[0,0,1],[0,1,0]],nz:[[0,0,-1],[0,1,0]]};
var stage,wrap,canvas,renderer,scene,camera,loader,cache={},active=null,fadeFrom=null,fadeT=1,yaw=0,pitch=0,mode=null,tourIdx=0,playing=false,timer=null,ui={};
function el(t,c,h){var e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e}
function css(){if(document.getElementById('rr-pano-css'))return;var s=el('style');s.id='rr-pano-css';s.textContent=
'.rrp{position:absolute;inset:0;z-index:20;background:#000;display:none;touch-action:none}.rrp.on{display:block}'+
'.rrp canvas{display:block;width:100%;height:100%;cursor:grab}.rrp canvas:active{cursor:grabbing}'+
'.rrp-top{position:absolute;left:16px;top:16px;display:flex;gap:8px;align-items:center;z-index:2}'+
'.rrp button{font:inherit;font-size:14px;height:36px;padding:0 14px;border:1px solid rgba(255,255,255,.35);background:rgba(20,10,15,.55);color:#fff;border-radius:6px;cursor:pointer}'+
'.rrp button:hover{background:rgba(20,10,15,.8)}.rrp-title{color:#fff;font-size:14px;background:rgba(20,10,15,.55);padding:8px 12px;border-radius:6px}'+
'.rrp-bar{position:absolute;left:16px;right:16px;bottom:16px;display:none;gap:8px;align-items:center;z-index:2}.rrp.tour .rrp-bar{display:flex}'+
'.rrp-bar input{flex:1;accent-color:#fff}.rrp-load{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px;pointer-events:none}'+
'@media (max-width:820px){.rrp-top{left:12px;top:12px}.rrp-bar{left:12px;right:12px;bottom:12px;flex-wrap:wrap}.rrp-bar input{order:-1;flex-basis:100%}.rrp-bar button{flex:1}}';document.head.appendChild(s)}
function build(){
 stage=document.querySelector('.v3-stage');if(!stage)return false;css();
 wrap=el('div','rrp');canvas=el('canvas');wrap.appendChild(canvas);
 var top=el('div','rrp-top');ui.back=el('button','',' Back to map');ui.title=el('span','rrp-title','');top.appendChild(ui.back);top.appendChild(ui.title);wrap.appendChild(top);
 var bar=el('div','rrp-bar');ui.prev=el('button','','Previous');ui.play=el('button','','Pause');ui.range=el('input');ui.range.type='range';ui.range.min=0;ui.range.max=WALK.length-1;ui.range.value=0;ui.next=el('button','','Next');
 [ui.prev,ui.play,ui.range,ui.next].forEach(function(b){bar.appendChild(b)});wrap.appendChild(bar);ui.load=el('div','rrp-load','Loading view');wrap.appendChild(ui.load);
 stage.appendChild(wrap);
 renderer=new T.WebGLRenderer({canvas:canvas,antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=T.SRGBColorSpace;
 scene=new T.Scene();camera=new T.PerspectiveCamera(75,1,.01,10);camera.rotation.order='YXZ';loader=new T.TextureLoader();
 var down=null;canvas.addEventListener('pointerdown',function(e){down=[e.clientX,e.clientY,yaw,pitch];canvas.setPointerCapture(e.pointerId);if(playing)setPlay(false)});
 canvas.addEventListener('pointerup',function(){down=null});
 canvas.addEventListener('pointermove',function(e){if(!down)return;var k=camera.fov/canvas.clientHeight*Math.PI/180;yaw=down[2]+(e.clientX-down[0])*k;pitch=Math.max(-1.45,Math.min(1.45,down[3]+(e.clientY-down[1])*k));draw()});
 canvas.addEventListener('wheel',function(e){e.preventDefault();camera.fov=Math.max(30,Math.min(95,camera.fov+e.deltaY*.04));camera.updateProjectionMatrix();draw()},{passive:false});
 ui.back.onclick=close;ui.prev.onclick=function(){setPlay(false);go(tourIdx-1)};ui.next.onclick=function(){setPlay(false);go(tourIdx+1)};
 ui.play.onclick=function(){setPlay(!playing)};ui.range.oninput=function(){setPlay(false);go(+ui.range.value)};
 new ResizeObserver(size).observe(wrap);return true}
function size(){if(!renderer)return;var w=wrap.clientWidth,h=wrap.clientHeight;if(!w||!h)return;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();draw()}
function cube(id){if(window.RR_PANO_FORCE)id=window.RR_PANO_FORCE;if(cache[id])return cache[id];var g=new T.Group(),left=6,mats=[];
 var p=new Promise(function(res){Object.keys(FACES).forEach(function(k){var t=loader.load(BASE+id+'_'+k+SUF+'.jpg?v=20261007d',function(){if(--left===0)res(g)},undefined,function(){if(--left===0)res(g)});
  t.colorSpace=T.SRGBColorSpace;t.anisotropy=renderer.capabilities.getMaxAnisotropy();t.wrapS=t.wrapT=T.ClampToEdgeWrapping;
  var m=new T.MeshBasicMaterial({map:t,depthWrite:false,depthTest:false,transparent:true,opacity:1});mats.push(m);
  var f=FACES[k],mesh=new T.Mesh(new T.PlaneGeometry(2,2),m);mesh.position.set(f[0][0],f[0][1],f[0][2]);mesh.up.set(f[1][0],f[1][1],f[1][2]);mesh.lookAt(0,0,0);g.add(mesh)})});
 g.userData.mats=mats;cache[id]=p;return p}
function setOpacity(g,o){g.userData.mats.forEach(function(m){m.opacity=o})}
function show(id,y){ui.load.style.display='flex';return cube(id).then(function(g){ui.load.style.display='none';
 if(active&&active!==g){fadeFrom=active;fadeT=0}active=g;if(scene.children.indexOf(g)<0)scene.add(g);g.renderOrder=2;if(fadeFrom)fadeFrom.renderOrder=1;
 if(y!=null){yaw=y*Math.PI/180;pitch=0}setOpacity(g,fadeFrom?0:1);anim()})}
function anim(){if(fadeFrom){fadeT=Math.min(1,fadeT+1/24);setOpacity(active,fadeT);if(fadeT>=1){scene.remove(fadeFrom);fadeFrom=null}}draw();if(fadeFrom)requestAnimationFrame(anim)}
function draw(){if(!renderer)return;camera.rotation.set(pitch,yaw,0);renderer.render(scene,camera)}
function open(m){if(!wrap&&!build())return;mode=m;wrap.classList.add('on');wrap.classList.toggle('tour',m==='walk');size()}
function close(){setPlay(false);if(wrap)wrap.classList.remove('on');mode=null;scene&&scene.children.slice().forEach(function(c){scene.remove(c)});active=null;fadeFrom=null;
 var b=document.querySelector('#row-view-tabs [data-view="3d"]');if(b&&b.getAttribute('aria-pressed')!=='true')b.click()}
function entrance(rid){var e=ENTR[rid];if(!e)return;fetch(BASE+e.id+'_nz'+SUF+'.jpg?v=20261007d',{method:'HEAD'}).then(function(r){if(r.ok)entranceOpen(rid,e)}).catch(function(){})}
function entranceOpen(rid,e){open('entrance');ui.title.textContent=(document.querySelector('.v3-card[data-id="'+rid+'"] b')||{}).textContent||'Entrance';show(e.id,e.yaw)}
function go(i){i=Math.max(0,Math.min(WALK.length-1,i));tourIdx=i;ui.range.value=i;ui.title.textContent='Walkthrough '+(i+1)+' / '+WALK.length;
 show(WALK[i],WALKYAW[i]);if(WALK[i+1])cube(WALK[i+1]);if(i>=WALK.length-1)setPlay(false)}
function setPlay(p){playing=p;if(ui.play)ui.play.textContent=p?'Pause':(tourIdx>=WALK.length-1?'Replay':'Play');clearInterval(timer);
 if(p){if(tourIdx>=WALK.length-1)go(0);timer=setInterval(function(){go(tourIdx+1)},4500)}}
function walk(){open('walk');go(0);setPlay(true)}
document.addEventListener('click',function(e){var t=e.target.closest&&e.target.closest('.v3-card,[data-view]');if(!t)return;
 if(t.classList.contains('v3-card'))return;
 var v=t.dataset.view;if(false){}else if(mode&&(v==='3d'||v==='free'||v==='flat')){setPlay(false);wrap.classList.remove('on');mode=null}},true);
window.RRPano={entrance:entrance,walk:walk,close:close,state:function(){return {mode:mode,yaw:yaw*180/Math.PI,kids:scene?scene.children.length:-1,on:wrap?wrap.className:null,w:wrap?wrap.clientWidth:0,h:wrap?wrap.clientHeight:0,cw:canvas?canvas.width:0}},snap:function(){draw();return canvas.toDataURL('image/jpeg',.85)}};
})();
