// rr2_flags.js: the ship configuration (shipcfg agent, Oct 14 2026).
// Every fix of Oct 13 and 14 is gated on a globalThis.RR_FLAGS key, and some modules read their key once at module
// scope (SHN and IBL_UP_TINT in rr2_probes.js, SUG_SPLIT, SUG_ZONES and SUG_FL in rr2_rooms.js). gputest.html builds
// RR_FLAGS from its URL before it imports rr2_player.js; the ship pages (player.html, rr_section.js) never did, so a
// visitor got none of the fixes. This module sets the defaults and must be the FIRST import of a ship entry module
// (ES modules evaluate their imports in order, so it runs before rr2_player.js and everything that imports).
// gputest.html does not import it: the test harness stays driven by its own URL only.
//
// Precedence, lowest first: SHIP_FLAGS below, then any RR_FLAGS the page set before the module loaded, then the URL:
//   ?rr_flags=none                  no ship defaults (the page and URL flags only)
//   ?rr_flags=ceilfix%3D14%26walkfix%3D0   a URL encoded query string of key=value pairs (numbers and JSON parsed)
//   ?rr_flags={"ceilfix":14}        the same as JSON
// A value of 0 turns a flag off (every gate reads +flag or truthiness). The applied set is kept in globalThis.RR_SHIP.
//
// r3 (agent flagset3, Oct 14): after apply_fixes_v2.py (agent_blendfix2) fixes many of the same defects in the .blend,
// the name keyed viewer fixes check their target first and do nothing when it is already fixed (count gates in
// floatfix2, propfix cull and rods, sugcorner; position checks for the podium move, ped C copy, ceilfix bit 8 lift,
// propcol; UV handedness for the kiosk U flip; plane angle and gap spread for the CAFE plane and DELMONICO letters;
// master value checks for propcap; signfix's image swap skips Image_59 once the export lists Image_59_cafe_fixed).
// So SHIP_FLAGS stays the ship set for r2 and r3 data alike (SHIP_FLAGS_R3 is the same object). R3_STRICT also turns off
// every flag whose whole job the .blend now does; use it only after the blendfix log of the r3 file shows every one of
// those steps as applied (not skipped), because a skipped Blender step would then show its defect again.
//   ?rr_flagset=r3strict   start from R3_STRICT instead of SHIP_FLAGS (rr_flags still overrides single keys)
//
// r8 (agent ship8, Oct 15): the data root is the r8f build (data_plan8 on the laptop, 16 areas, mt40 added) and
// memlean=7 is on (the laptop loaded all 16 areas with it at 59% RAM; without it the r7 load ran the laptop out of
// RAM). Flags still being checked on r8f data are listed in R8_PENDING below, off until their name is added to
// R8_PENDING_ON. ?rr_flagset=r8pending turns every pending flag on for a test (the laptop query_r8f set).
// Device policy (SHIP_TIER_POLICY): which areas and texture cap each device tier gets; rr_section.js applies it.
//
// r9 (agent ship8, Oct 15 wave 11): data root = the r9 build (laptop gpu_test\data_plan9, agent build9b: r8f + fixW2, fixD,
// fixE2, regfix; same 16 area names). Flags: SHIP_FLAGS is unchanged from r8.1, i.e. only flags verified on the laptop GPU
// (r8f Q3, all 16 areas). Nothing from wave 10/11 is merged (none of it is verified yet). lowglassreed is removed. Walk file
// rr2_modes_data.js = walk8 f4f3c1bb (the live laptop file). 360s are reference only (DECISIONS A2.4): this package adds NO
// capture data (no data_plan8_caps / data_plan9_caps). The engine still reads data/caps (the old B000..B085 set) for its
// lighting until lightmatch's code lighting (rr2_codelight.js, RR_FLAGS.codelight) is verified; see CAPTURE_DEPENDENCY.
//
// r10 (agent ship10, Oct 15 wave 12): data root = the r9c floorplan build (laptop gpu_test\data_plan10, 16 areas, mt40
// included; r9 + the w137 floor fill (r9b) + the Nomikai floor hole fill (r9c)). Same 16 area names, so no code reads the
// build name except RR_SHIP.data. Engine: agent_vmerge's merged engine files (vsign + vglass + vmisc code); only the sign fixes
// are on, because they ride on signfix (already on) and were checked on the laptop GPU against base (vm11_sign_b vs
// vm11_sign_m, all 16 data_plan9 areas, 16:29 ET): Starbucks 'UCKS' column hidden, full SUGARCANE blade, Milos fish tile
// capped, Yardbird menu lightbox, kiosk back mirror dimmed, EMIT caps on BELLE DE NUIT / BAR MIA / halo. Every other merged
// flag (curtfix2 roomclip globefix skyemis ff2ph floatfix2r8 boxdesat lowglassbox/gk/fsk/k paneboxfix) stays OFF: absent
// from SHIP_FLAGS means off. paneboxfix in particular regresses the Yardbird panes (audit 16:40).
//
// v1 (agent ship, wave 13): the Saturday Oct 17 floorplan package (R\ship_v1). Code = r10 above (vmerge engine, signfix
// tables, walk8 rr2_modes_data.js unless agent modes hands off a newer one, memlean 7, verified flags only, no lowglassreed).
// Data: the frozen build named in SHIP_DATA below, copied into git\data\ of the package together with the legacy data/caps.
// No 360 capture data of any kind is added by this package (DECISIONS A2.4); see CAPTURE_DEPENDENCY for the legacy data/caps.
// Phones: map only (SHIP_TIER_POLICY.phone), as before; agent phone's tier code is not merged (not verified on a device).

// m95 base plus the Oct 14 fixes (the m96_full set), as gputest.html would parse them from the URL
export const SHIP_FLAGS = {
  lm: 1,   // Ryan Oct 22: Cycles baked lighting on by default (rr_flags=lm%3D0 turns it off)
  // m95 base (idn=0.55 of that run is the iblDown player option, see SHIP_PLAYER)
  wallup: 1,
  wallupSkip: '^(mat_m2_rail|rr_beige_pier|mil_oak_reeded|rr_bead|rr_del_plaster|rr_del_cove_wash|rr_label_|mil_ceiling|del_plank|rot_drum|sugmv_|sug_ch_|gjl_rust|rot_rustband)',
  sugmask: 1, sugdark: 1, idnmat: 1, winefix: 1, glassfix: 2, rotramp: 1, delmfix: 1, delmk: 0.15, storefix: 1,
  lowres: 2, lightloop: 1, noisespec: 1, capworker: 1, warm: 1,
  // Oct 14
  fasciafill: 1, dedupe: 1, oldpane: 1, lowglass: 1, lowglassbay: 1, floatfix2: 1, floatfix2skip: 'posts,shelf',
  floorblack: 1, ceilfix: 15, signfix: 1, propfix: 1, propcol: 1, propcap: 1, proprods: 1, floorfix2: 1, ff2grout: 1,
  shtex: 1, covefix3: 1, curtfix: 1, interfix: 1, endfix2: 1, dupdrop: 1, sugcorner: 1, walkfix: 1,
  // Oct 15 (agent memfix): bit 1 one decode per image file, freed after upload; bit 2 CPU copies of vertex data freed;
  // bit 4 textures uploaded area by area. Laptop r7mem_lean7: 16 areas, peak 59% of 63.4 GB, 0 errors.
  memlean: 7,
  // v1 speed (agent ship, Oct 16): smalltex = 512 px WebP copies of every image (data/img_s) load first, the full size ones swap in
  // behind the open view when the camera is still; gzdata = area GLB and JSON files come as .gz and are inflated in the browser.
  // Both fall back to the plain files when a copy is missing. Laptop runs v1u/v1g (SPEED_PLAN.md): 3D opens at 19 s instead of 44 s,
  // Fast 4G 96 s instead of 852 s, final frames unchanged.
  // Oct 16: smalltex was off 03:45 to 06:2x (the first swap left some textures small); the eng_v2 swap gives every swapped picture a fresh
  // Source. zstdata = area files as .zst (three ZSTDDecoder), about 11 % smaller than .gz; .gz and plain stay as fallback.
  // Oct 16 09:06: smalltex OFF for the final package (unproven: after the eng_v2 swap, walk fell to 1 to 4 fps in c19_b, prof_base)
  smalltex: 0, gzdata: 1, zstdata: 1
};

// Flags that other agents are verifying on r8f data today (Oct 15). PLACEHOLDERS: each stays off for visitors until its
// name is added to R8_PENDING_ON (one edit here, nothing else changes). The values are the ones of the laptop query
// query_r8f.txt (agent build9), which has not been rendered on r8f data yet.
// flags merged from look\pkg_look (section cut overview etc.); look=0 gives the demo23 overview
Object.assign(SHIP_FLAGS, {look: 1, glintarea: 0, fixf23: 1});
export const R8_PENDING = {
  // agent fixV: three r7 only clip boxes in rr2_floatfix2.js (Mesh_1491 track frame, Mesh_2226 and Mesh_2227 brass rods).
  // fixM parks the same pieces in the .blend, so on r8f data they should count 0 and report as done. PENDING: check
  // report.floatfix2 on an r8f load shows the r7 groups as done (or that the pieces are really gone)
  floatfix2r7: 1,
  // agent fixV: keep the unit 166 interior lamps (mbf_l166_113, 114, 115) out of the live lamp pool; they light the bare
  // red shell wall r166_f0 as a hard pink rectangle (sweep rv08 12). mt40 is the area that holds unit 166's floor, so
  // this matters now that mt40 ships. PENDING: views W078y120p40 and W087y120p40 on r8f data
  lampskipre: '^mbf_l166_'
  // r9 (MAIN_DIRECTIVES 3, Oct 15 13:45): lowglassreed REMOVED from the package. The r8f Cycles 360 B084 shows Matteo's reeded
  // panes pale and glowing, so darkening them moves the viewer away from the reference (vglass, fixcheck). Not even a placeholder.
};
// Names from R8_PENDING that are verified and ship. Example once fixV's check is in: ['floatfix2r7', 'lampskipre']
export const R8_PENDING_ON = [];
for (const k of R8_PENDING_ON) if (k in R8_PENDING) SHIP_FLAGS[k] = R8_PENDING[k];

// PLACEHOLDERS for the wave 10 review agents (Oct 15, still running when this package was made). NOT APPLIED: this object
// is documentation only, nothing reads it. Each entry needs two things before it can ship: the agent's code change merged
// into the engine files of this package (their flags do nothing without it), and its flag values moved into SHIP_FLAGS
// (or R8_PENDING first). Flag names are the ones found in each agent's rr2 copy at 10:15 New York time; values unknown.
export const WAVE10_PENDING = {
  vsign: { flags: ['sfdrop', 'sfmenuk'], code: 'rr2_signfix.js', note: 'sign fixes; tuning keys of signfix (on)' },
  vglass: { flags: [], code: 'none yet', note: 'storefront glass review; no flag in its rr2 copy yet' },
  vmisc: { flags: ['curtfix2', 'roomclip', 'globefix', 'skyemis'], code: 'its rr2 copy', note: 'off by default there; renders queued' },
  ktx2: { flags: ['ktx2', 'basis', 'texmem'], code: 'rr2_player.js, rr2_scene.js, new rr2_texmem.js', note: 'KTX2 textures need a KTX2 data build (data_plan8k) too' }
};

// PLACEHOLDERS for the wave 11 agents (Oct 15 from 11:45 New York; agents 8 to 17). NOT APPLIED, documentation only, like
// WAVE10_PENDING. Same rule: code merged into this package's engine and a verified look (images compared with the Cycles 360s,
// Ryan's reference) before a flag moves into SHIP_FLAGS. Fill in flags and verdicts as each agent reports.
export const WAVE11_PENDING = {
  vsign: { flags: ['signfix (tables in rr2_signfix.js 119d8687)'], verified: true, note: 'agent 8 + vmerge: SHIPPED in r10 (laptop vm11_sign_b/m 16:29 ET, all 16 areas); sfdrop/sfmenuk/sfemit_* tuning keys stay at their defaults' },
  vglass: { flags: [], verified: false, note: 'agent 9, storefront glass (copper bays, reeded, rotunda strips)' },
  vmisc: { flags: ['curtfix2', 'roomclip', 'globefix', 'skyemis', 'ff2ph', 'floatfix2r8'], verified: false, note: 'agent 10, off by default in its rr2 copy' },
  lightmatch: { flags: ['codelight', 'codeamb', 'codelamps', 'codeev'], verified: false, note: 'agent 11, code only lighting (rr2_codelight.js) matched to the 360s' },
  slidefix: { flags: [], verified: false, note: 'agent 12' },
  capwire8: { flags: [], verified: false, note: 'agent 13, r8f captures: a data change (data_plan8_caps: caps + 16 inventories), not a flag' },
  topview: { flags: [], verified: false, note: 'agent 14, overview mode (rr2_modes.js)' },
  walkviews: { flags: [], verified: false, note: 'agent 15, walk views (rr2_modes_data.js)' },
  loadspeed: { flags: ['ktx2', 'texmem', 'progcut'], verified: false, note: 'agent 16: dedupe data (data_plan9x) same pixels on mt42; lean KTX2 mt42 PSNR 45..50, load 8.0 -> 4.2 s; needs its 4 engine files + data_plan9xk; laptop L9 queued' },
  phone: { flags: ['tier', 'phonec', 'phoner'], verified: false, note: 'agent 17: phone/phonelow tiers + proximity cull; container numbers only, phones stay map only' }
};

// Which data build this package was made and tested for. Documentation plus RR_SHIP.data; the section reads whatever is in
// BASE/data (or data-rr-data). Any later build with the same folder layout and area names works with the same code;
// check SHIP_AREA_LIST against its folders.
export const SHIP_DATA = { build: 'dplm2', pkg: 'v1', folder: 'data_lm2xd', status: 'data_lm2 (dplm2) + GLB image dedupe + small texture tier + gzip area files', blend: 'dplm2', laptopFolder: 'wave13\\ship\\data\\data_lm2xd', caps: 'gpu_test\\data\\caps', areas: 16 };
// The one remaining capture dependency (DECISIONS A2.4 target: none). Documentation plus RR_SHIP.captureDependency.
export const CAPTURE_DEPENDENCY = { now: 'data/caps (old B000..B085 RGBE + sh.json) lights and reflects the scene via rr2_probes/rr2_light',
  newCapturesShipped: false, replacement: 'lightmatch rr2_codelight.js (RR_FLAGS.codelight=1), not verified at 15:00 ET Oct 15',
  whenVerified: 'add rr2_codelight.js to git/, codelight:1 (+ its fitted codeamb/codelamps/codeev) to SHIP_FLAGS, drop data/caps from the publish steps' };

export const SHIP_FLAGS_R3 = SHIP_FLAGS;
// flags whose every part is done by apply_fixes_v2.py: floatfix2 (slatbar, sconce, palazzo_ring, rods_1494, gold_disc;
// shelf and posts are skipped anyway), floorblack (floor_slab), oldpane (old_pane_1508, a decision step), signfix (cafe_texture,
// pk_scr_uv, ent_L_spacing, starbucks_old_logo, cafe_plane), propfix (pier_bases, ped_sliver_and_ped_C, podium_move,
// dup_chairs, dup_mullions), proprods (rods_1495, a decision step), propcap (capital_bump), sugcorner (sug_corner), and
// ceilfix bit 8 (ceil_lift: 15 becomes 7, bits 1, 2 and 4 are viewer only)
export const R3_DROP = ['floatfix2', 'floatfix2skip', 'floorblack', 'oldpane', 'signfix', 'propfix', 'proprods', 'propcap', 'sugcorner'];
export const R3_STRICT = Object.fromEntries(Object.entries(SHIP_FLAGS).filter(([k]) => !R3_DROP.includes(k)).map(([k, v]) => [k, k === 'ceilfix' ? 7 : v]));
// gputest.html takes flags from its URL: these strings are the same sets as query strings (append to the gputest URL)
const toQuery = (o) => Object.entries(o).map(([k, v]) => k + '=' + encodeURIComponent(typeof v === 'object' ? JSON.stringify(v) : String(v))).join('&');
export const R3FLAGS = toQuery(SHIP_FLAGS_R3);
export const R3STRICTFLAGS = toQuery(R3_STRICT);

// RowPlayer options of the gputest.html runs that produced m95 / m96 (its defaults with idn=0.55). Ship entries spread
// these and add their own basis, onProgress and profile.
export const SHIP_PLAYER = {
  interiorK: 0.5, capFmt: 'rgbe1', walkCenter: [-21.75, -9.61, 0], walkRadius: 30, lite: false, ao: true,
  lights: 0.25, iblDiffuse: 1.4, iblUp: 1, iblDown: 0.55, toneMap: 'grade360', bloom: 'ref'
};

// r8f area set: the 16 areas of data_plan8, mt40 (unit 166 and the east end, new in the r8 build) included. Far sections
// at 32 m, not 32.01 (the Starbucks sbs_stileB fix of agent_merge). Order as in the laptop query_r8f.txt.
export const SHIP_AREA_LIST = ['gjM2c', 'mt00', 'mt01', 'mt10', 'mt11c', 'mt20c', 'mt21c', 'mt22', 'mt30', 'mt31c', 'mt32c', 'mt40', 'mt41c', 'mt42', 'mt1n', 'mt2n'];
const areaStr = (list) => list.map(a => a === 'gjM2c' ? a : a + '|far:32').join(',');
export const SHIP_AREAS = areaStr(SHIP_AREA_LIST);
// the three restaurant views: gjM2c (32 m around Gjelina, Milos inside it), mt21c and mt31c (Delmonico at x 18.5)
export const SHIP_AREAS_HERO = areaStr(['gjM2c', 'mt21c', 'mt31c']);

// Device policy, applied by rr_section.js before the download starts (agent ship8, Oct 15). Sizes of the r8f build
// (agent_build9 file lists; GPU figures are estimates: decoded geometry from the gltfpack logs plus RGBA textures with
// mips at 19.9 decoded bytes per image file byte, measured on 35 of the files, and 7.0 with a 1024 cap):
//   all 16 areas: 813 MB download (640 geometry, 173 images), about 2.4 GB geometry and 4.6 GB textures on the GPU
//     (laptop r7 run: VRAM peak 7.7 of 8.2 GB, RAM rise 17.9 GB); with lowtex=1024 about 4.1 GB on the GPU
//   SHIP_AREAS_HERO: 426 MB download, about 5.0 GB on the GPU, 2.5 GB with lowtex=1024
// areas: 'full' or 'hero' (a list string also works); lowtex: RR_FLAGS.lowtex (0 = the tier's own cap); map: true keeps
// the map only and never downloads the 3D (the 3D panel says why).
export const SHIP_TIER_POLICY = {
  desktop: { areas: 'full', lowtex: 0 },       // discrete GPU: the laptop set as verified
  laptop: { areas: 'full', lowtex: 0 },        // Ryan Oct 22: everything 4K, no 1024 cap (was lowtex 1024); the tier's own cap (4096) applies
  phone: { map: true },                        // no phone tier fits yet (see CHANGES.md); data-rr-phone="hero" tries one
  lowmem: { map: true }                        // navigator.deviceMemory 4 or less (Chromium), any tier
};
export const SHIP_PHONE_TRY = { areas: 'hero', lowtex: 1024 };

// the same value parsing as gputest.html: numbers, JSON objects or arrays, else the string
const parseVal = (v) => { if (v !== '' && !isNaN(+v)) return +v; if (/^[\[{]/.test(v)) { try { return JSON.parse(v); } catch (e) {} } return v; };

function urlFlags() {
  let raw = null;
  try { raw = new URLSearchParams(globalThis.location ? globalThis.location.search : '').get('rr_flags'); } catch (e) {}
  if (raw == null) return { none: false, set: {} };
  raw = raw.trim(); if (raw === 'none') return { none: true, set: {} };
  if (/^\s*{/.test(raw)) { try { return { none: false, set: JSON.parse(raw) }; } catch (e) { console.warn('[rr2_flags] rr_flags JSON did not parse', e); return { none: false, set: {} }; } }
  const set = {}; for (const [k, v] of new URLSearchParams(raw)) if (k) set[k] = parseVal(v);
  return { none: false, set };
}

function urlFlagset() {
  try { return new URLSearchParams(globalThis.location ? globalThis.location.search : '').get('rr_flagset'); } catch (e) { return null; }
}
const FSN = urlFlagset();
const U = urlFlags(), page = globalThis.RR_FLAGS || {}, FS = FSN === 'r3strict' ? R3_STRICT : FSN === 'r8pending' ? { ...SHIP_FLAGS, ...R8_PENDING } : SHIP_FLAGS;
globalThis.RR_FLAGS = Object.assign({}, U.none ? {} : FS, page, U.set);
globalThis.RR_SHIP = { flags: U.none ? null : FS, set: U.none ? 'none' : FS === R3_STRICT ? 'r3strict' : FSN === 'r8pending' ? 'r8pending' : 'ship', pendingOn: R8_PENDING_ON.slice(), data: SHIP_DATA.build, pkg: SHIP_DATA.pkg, dataStatus: SHIP_DATA.status, captureDependency: CAPTURE_DEPENDENCY.now, page: Object.keys(page), url: U.set, none: U.none };
