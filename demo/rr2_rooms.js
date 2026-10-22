// Room interiors seen through the storefronts, lit per room. The corridor captures do not see the room lamps, so the
// interiors came out flat: walls and floors too bright, ceilings near black (Sugarcane vault, Matteo's and Gjelina
// room ceilings), Milos too dark overall (m54 against the 360s, agent_interiors report). Every opaque surface looks up
// its room in a plan map (0.5 m cells, Blender x y) and scales its reflected light (not its emission) by that room's
// calibrated gain for its orientation (wall, ceiling: facing down above 1.5 m, floor: facing up below 1.5 m) and tint.
// The map comes from the rooms' own interior objects minus the corridor floor the capture spots see directly (offline:
// agent_interiors/tools/masks.py), so corridor surfaces read 1 and nothing outside a room changes. Gains and tints are
// smooth across a cell border (linear filtered gain textures), so a floor running through a door has no step.
// One extra code block and two texture reads in every opaque program; no material clones, no extra programs.
import * as THREE from 'three';

// interior groups per room (inventory row .group), as used for the map
export const ROOM_GROUPS = {
  gjelina: ['GJL_RotInterior', 'CL_GJTables', 'GJL_Interior'], yardbird: ['CL_YBInterior'], milos: ['CL_MilosInterior', 'CL_MilosDecor', 'CL_MilosDining'],
  delmonico: ['del_bar', 'del_ceiling', 'del_chairs', 'del_chandeliers', 'del_settings', 'del_stonewall', 'del_tables', 'del_winewall'],
  matteos: ['CL_Matteo_Rebuild', 'CL_MatteoDecor'], sugarcane: ['CL_SugInterior', 'CL_SugFill'], nomikai: ['CL_Nomikai'],
};
// calibration fitted on m54_full (gputest config: interiorK 0.5, lights 0.25, iblDiffuse 1.4, iblDown 0.55) against the
// 360s: weighted median of reference / viewer over object segments (object x face, 128 px ray cast masks), scene linear
// (grade inverted), per orientation. Held out by spot (leave one spot out) the median log error per segment goes from
// 0.42 to 0.23 (Delmonico), 0.34 to 0.30 (Gjelina), 0.57 to 0.48 (Matteo's), 0.51 to 0.20 (Milos), 0.85 to 0.30
// (Sugarcane), 0.63 to 0.39 (Yardbird). Gjelina's ceiling is capped at 4 (fit 6.9 from 182 pixels: its room ceiling
// renders near black). Nomikai had no pixels behind glass and stays at 1. [wall, ceiling, floor], tint (luminance about 1).
// Valid for that config only: refit after any change of interiorK, lights, iblDiffuse, iblDown, the cove constant
// emitters or the storefront glass (agent_interiors/tools: fitk3.py, classgain_rt3.py, cv_rt3.py on the new run).
// cotegj (Oct 22): Gjelina [wall, ceiling, floor] gains; RR_FLAGS.gjg = 'w,c,f' overrides
const GJ_G = (() => { const s = (globalThis.RR_FLAGS || {}).gjg; const v = s ? String(s).split(',').map(Number) : null; return v && v.length === 3 && v.every(isFinite) ? v : [1.9, 4, 1.25]; })();
export const ROOM_CAL_M54 = {
  // agent delmint Oct 22: Ryan's Delmonico photos (IMG_5477 to 5513) show bright cream walls and white vaults; the m54 fit (0.839, 0.589, 0.656) was
  // tuned to the old dark 360s and browned every live lit Delmonico piece (ceiling 0.59). Unbaked pieces only; baked ones take the lightmap.
  delmonico: { g: [1.1, 0.9, 0.85], t: [1.0, 0.99, 0.96] },
  gjelina: { g: GJ_G, t: [0.948, 0.998, 1.168] },   // cotegj Oct 22: was [0.916, 4, 0.438] (fit to the old dark 360s); Paul's photos IMG_1182 / IMG_1200 show a bright warm room through the glass
  matteos: { g: [0.692, 1.616, 0.63], t: [0.997, 1.001, 0.996] },
  milos: { g: [1.545, 1.415, 1.586], t: [0.945, 1.007, 1.093] },
  sugarcane: { g: [0.463, 3.418, 0.703], t: [0.946, 1.019, 0.969] },
  yardbird: { g: [0.57, 0.57, 0.484], t: [0.976, 1.011, 0.963] },
  nomikai: { g: [1, 1, 1], t: [1, 1, 1] },
};
// room footprints (tools/masks.py): cells covered by the room's interior objects (closed by 1 m), plus cells the 34
// capture spots see behind a storefront pane nearest that room, minus cells seen mostly with no pane on the way and
// anything within 2 m of a spot. Origin, cell, size, top of the room's objects (m), per row the runs of covered
// cells as [start, length, start, length, ...]
export const ROOM_MASKS = {"gjelina":{"x0":-41.5,"y0":-17.0,"cell":0.5,"w":79,"h":52,"runs":[[],[],[],[],[],[],[],[],[],[],[],[],[49,1],[49,4],[49,8],[49,1,51,9],[49,13],[21,3,49,14],[23,4,49,14],[19,4,26,1,48,15],[18,7,26,2,47,16,64,1],[18,11,46,17,64,1],[18,11,45,18],[18,12,44,19],[17,13,43,20],[16,13,32,2,42,8,51,12],[16,13,32,9,42,7,50,13],[16,12,31,9,41,6,48,15],[16,13,31,16,49,1,57,6],[16,14,32,14,48,1],[20,26],[22,8,32,13],[23,21],[25,20],[26,18],[30,9,40,3],[42,1],[],[],[],[],[39,2],[],[],[],[],[],[],[],[],[],[]],"ztop":3.2},"yardbird":{"x0":-54.5,"y0":-20.5,"cell":0.5,"w":58,"h":46,"runs":[[],[],[],[],[],[],[],[],[29,1,31,1],[25,2,30,2,33,1],[23,1,25,1,27,1,31,1,33,1,35,1],[23,1,25,1,27,1,30,2,35,2,38,1],[19,2,23,3,27,1,29,3,33,1,35,4,40,1,42,1],[20,6,27,1,29,3,33,1,35,3,39,1,42,1],[21,4,27,1,31,7,41,1],[24,4,29,1,31,1,34,1,36,1,40,1],[19,5,26,4,31,1,33,2,37,2,40,1],[18,7,29,5,37,1],[11,1,13,1,18,12,32,1,36,2,39,1],[13,18,34,2],[16,16],[18,18,38,1],[20,17],[22,20],[25,17],[27,15],[30,12],[32,10],[34,8],[37,3],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[]],"ztop":3.2},"milos":{"x0":-17.5,"y0":-16.0,"cell":0.5,"w":61,"h":82,"runs":[[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[18,1,21,3],[17,3,21,5],[17,10],[17,13],[18,14],[17,16],[18,18],[18,22],[18,23],[17,24],[16,25],[16,26],[16,26],[15,28],[15,28],[15,28],[15,28],[14,29],[13,30],[13,30],[12,30],[12,29],[11,29],[11,30],[10,34],[10,34],[9,35],[9,35],[9,35],[8,36],[8,37],[11,34],[12,33],[14,31],[15,30],[18,25,44,1],[19,26],[20,22,43,2],[22,16,40,5],[27,18],[25,20],[27,13,44,1],[29,12],[32,14],[33,12],[34,10,45,1],[36,7,44,2],[37,9],[41,5],[44,2],[44,2],[],[],[],[],[],[],[],[],[],[],[],[],[]],"ztop":6.01},"delmonico":{"x0":-3.5,"y0":-10.0,"cell":0.5,"w":73,"h":55,"runs":[[],[],[],[],[],[],[],[],[],[],[],[],[22,1],[22,3],[13,1,19,10],[13,1,18,14],[13,2,18,14,33,2],[14,1,18,14,33,1],[14,1,16,1,18,14,33,2,36,2],[16,2,19,19,40,1],[16,20,37,2,40,4,45,1],[17,19,37,2,40,7],[17,1,19,27,47,2,50,2],[17,30,48,2,51,1],[18,20,40,2,43,5,49,1,51,1,53,2],[18,21,42,10,53,1,56,1,58,2],[14,1,19,19,39,1,43,1,46,9,58,2,63,1],[13,3,19,24,48,2,51,4,56,1,59,1,63,1],[12,3,18,20,39,5,52,1,54,1,56,1,67,1],[13,3,18,20,39,10,50,1,52,2,56,1,58,1],[18,32,58,1],[19,32,52,3],[19,36,66,1],[19,37,66,1],[19,10,30,27,66,1],[19,9,30,1,32,24],[21,3,25,2,30,1,32,25,59,1],[30,29],[25,1,32,14,57,1],[62,1],[25,1],[],[56,1],[25,1],[],[],[],[],[],[],[],[38,2],[],[39,1],[]],"ztop":3.46},"matteos":{"x0":-16.0,"y0":-28.0,"cell":0.5,"w":91,"h":62,"runs":[[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[26,3,31,7],[26,3,31,7],[26,3,34,4],[26,3,32,7],[17,1,26,2,32,10],[18,1,22,2,26,1,32,12],[21,5,30,1,32,15],[23,4,33,16],[25,3,32,20],[32,22],[33,24,60,1],[33,26,60,3],[35,28],[40,8,53,10],[41,8,52,3,58,2,61,2],[50,11],[44,3,51,32],[47,2,52,9,62,8,71,1,74,1,77,1,80,1,82,1],[48,24,74,1,77,3,81,2],[53,14,68,8,77,6],[56,5,62,5,68,9,79,1,82,1],[58,9,68,6,75,4,81,2],[61,6,68,3,72,1,75,8],[62,2,65,1,68,2,71,2,75,2,78,1,81,2],[65,2,68,6,75,4,80,3],[68,6,76,1,78,1,81,3,86,3],[70,1,72,2,75,4,80,1,83,2,88,2],[73,1,75,4,80,2,83,2,86,1,88,2],[73,1,80,1,84,1,86,1,88,2],[80,1,83,1,88,2],[80,2,83,2,86,1,89,1],[84,1,86,1,89,1],[82,1,89,1],[85,1,88,2],[88,1],[],[],[],[],[],[],[],[],[],[],[]],"ztop":3.86},"sugarcane":{"x0":-48.5,"y0":-39.5,"cell":0.5,"w":70,"h":60,"runs":[[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[34,4,39,2],[34,3,41,4],[34,5,41,5],[34,7,42,5],[20,1,34,8,43,5],[20,4,34,8,45,7],[19,8,34,10,46,8],[19,10,34,10,47,6],[19,12,34,12,48,5],[18,29,48,4],[18,7,26,22,49,1],[17,32],[17,7,25,25],[17,7,25,25],[16,33],[16,33],[17,32],[17,31],[9,1,15,1,22,16,39,9],[19,1,24,4,29,18],[11,1,13,1,16,2,19,1,27,19],[11,1,13,1,19,1,23,1,27,19],[11,1,13,1,15,1,19,1,23,1,26,1,32,14],[13,1,15,1,21,1,24,1,26,1,34,12],[13,1,15,1,21,1,28,1,36,9],[15,1,37,9],[39,7],[42,3],[28,1],[19,1,26,1,28,1,35,1],[21,1,23,1,25,1],[23,1,26,1],[28,1],[29,2],[],[],[],[],[],[],[],[],[],[]],"ztop":3.77},"nomikai":{"x0":-68.0,"y0":-35.5,"cell":0.5,"w":56,"h":69,"runs":[[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[35,4],[30,10],[29,11],[28,12],[23,17],[23,17],[22,18],[22,18],[22,18],[21,19],[21,19,42,1],[20,19,42,1],[20,19,45,1],[20,19,42,1,44,2],[19,20,42,1,45,1],[19,19,42,1,46,2],[18,20,42,1,46,2,51,1],[18,20,43,1,46,2,51,1],[17,23,43,1,47,1,51,1],[17,21,39,1],[16,22,39,1],[16,22,50,1],[16,12,29,10,50,1,52,1],[16,11,42,1,45,1,47,1,50,1],[18,8,38,1,40,3,44,1,46,1,48,1],[19,6,41,4,46,1],[20,5,44,2],[20,5],[20,5],[20,6],[21,6],[21,17],[22,15],[23,14],[24,13],[24,13],[24,13],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[]],"ztop":4.19}};

// Milos depth falloff (agent milos2, Oct 14). The Milos lamps sit in the front half of the room: of the 40 lamps in the
// footprint (scene_extra lights) all but Point.030 (y 4.7) and downlight_206 / _207 (x 3.3, y 11.2 / 14.2) are at
// Blender y -7 to 2.5, and the room runs back to y 18. In Cycles the back of the room is therefore dark (the 360s show
// the back bar wall, the display frame and the far ceiling near black), while the viewer lights it from the capture field
// and the unshadowed live lights about as brightly as the front. Measured on m74_full (B078 B082 B071 B000 nz, pixels
// behind the storefront glass, first opaque hit inside the Milos mask, ray cast ids, sRGB decoded luminance),
// reference / viewer per 2 m of depth: y -6 1.30, -4 1.25, -2 0.95, 0 0.64, 2 0.62, 4 0.51, 6 0.34, 8 0.29, 10 0.13,
// 12 0.13, 14 0.04, 16 0.04 (about 3000 to 44000 pixels a bin; flat across x). The ratios are display linear; through the
// grade they are about the 1.3th to 1.5th power in scene linear, hence the exponent (RR_FLAGS.mildepth, default 1.3,
// 0 turns the falloff off). The front stays at the m54 fit (factor 1 up to y -1.5) although it reads 1.25x dark.
const MILOS_DEPTH = [[-1.5, 1], [-0.5, 0.85], [1, 0.64], [3, 0.6], [5, 0.5], [6.5, 0.36], [8, 0.29], [10, 0.15], [12.5, 0.12], [14.5, 0.05], [17, 0.04]];
const milosDepth = (y) => { const T = MILOS_DEPTH; if (y <= T[0][0]) return 1; if (y >= T[T.length - 1][0]) return T[T.length - 1][1];
  for (let i = 1; i < T.length; i++) if (y <= T[i][0]) { const a = T[i - 1], b = T[i], t = (y - a[0]) / (b[0] - a[0]); return Math.exp(Math.log(a[1]) * (1 - t) + Math.log(b[1]) * t); } return 1; };
// The hanging wine rack (Mesh_2262 frame, mil_wine_glass panes and shelves, Mesh_536 Material_220 purple slab under the
// ceiling: Blender x -3.34 to -0.87, y -0.57 to 2.83) is a box of transmission 1 glass. Cycles does not carry direct
// light through refractive glass to a diffuse surface (no caustics from small lamps), so the ceiling inside the rack is in
// shadow: reference sRGB 71 63 52 against 236 207 177 in m74 (B078 nz, 198 px seen through the rack). Its ceiling channel
// (down facing surfaces above 1.5 m only: the ceiling and the shelf undersides) takes RR_FLAGS.milrack (default 1 since m77, was 0.12,
// 1 turns it off) on top of the depth falloff. The wall channel is left alone: it would also darken the bar under the rack.
const MILOS_RACK = [[-3.34, -0.57], [-0.87, 2.83]];
// Per material corrections inside one room, on top of the orientation gains (agent_sug2, Oct 14): in Sugarcane the dark
// wood ceiling slab (Mesh_2230) and the bottle shelf wall (sugmv_Mesh_1490) sit next to the Material_108 strips (16.8),
// while the painted walls, the bar counter top and the bar fronts only see the corridor capture and come out too bright.
// Fitted on m74_full against B002, B009, B016 nx (mean CIE76 dE of 16 px blocks through the grade). k: reflected light
// rgb, box: Blender x0 y0 x1 y1 limit, sugBake: drop k when rr2_sugbake.js already lit the material. RR_FLAGS.nomatcal off.
const SUG_BOX = [-44.0, -31.5, -21.5, -14.5]; // aligned with the Sugarcane room mask (m76 audit: hard edges inside the room)
// m78 audit (agent rooms3, ray cast ids at B002 B009 nx): Material_87 is one mesh, the slab Mesh_2230, seen at two depths.
// Near the storefront (Blender x > -29.5, over the Material_108 strips) the reference slab is bright cream (217 against
// 112, scene linear 7x), behind the arches (x < -29.5) it is near black (81 against 180, 0.2x); everything else behind
// the arches is too bright as well (rot_soffit_south 0.24, Material_110 0.2 to 0.35, Material_418 0.5, cl_ceil_plaster
// 0.42). So the box splits at x -29.5: SUG_NEAR keeps the strip lit slab and plaster bright, the far part of the room takes
// RR_FLAGS.sugfar (default 0.4) in its cell gains, and Material_87 its own far factor on top. RR_FLAGS.nosugsplit: m78.
const SUG_X = -29.5, SUG_NEAR = [SUG_X, -31.5, -21.5, -14.5], SUG_FAR = [-44.0, -31.5, SUG_X, -14.5];
const SUG_SPLIT = !(globalThis.RR_FLAGS || {}).nosugsplit;
// m82 audit (agent sug3, ray cast object ids at B002 nx py pz, B009 nx, B016 nx, 8 px samples): every audit box (B002 nx
// interior ceiling, the "corridor arch" boxes B002 nx [341 0 682 341] and B009 nx [300 150 700 250], B002 py corner,
// B002 pz top) sees the same surface first: the slab Mesh_2230 (Material_87) behind the green glass Material_501, plus a few
// percent of cl_ceil_plaster (Mesh_2236, the slab's edge faces) and the vault glow sugmv_Mesh_1499. No corridor surface is
// in them: the corridor header soffit (Mesh_1552 sug_wall_paint, 132 against 201 since m79) and the green trim Mesh_1537
// lie outside the room mask (room weight 0) and no room gain reaches them. The reference slab is not evenly lit: per 1 m of
// slab, reference / m82 in scene linear runs from 0.22 (x -28 to -27, y -20 to -19, behind the arch) to 2.1 (y -24 to -22)
// and 0.4 to 0.9 along the storefront edge (x -26 to -25), so one k per box overshoots one box and undershoots the next.
// SUG_ZONES carries that pattern (Blender x0 y0 x1 y1, rgb factor on top of k, dampened by about 0.85); the orange cast
// is the dark wood base colour under a near neutral room tint (0.95 1.02 0.97), so the bright zones take more blue.
// The near gains also take a room and height gate (zg: only where the room weight is over 0.6 and 2.5 m < z < 4.4 m), so
// a border cell's filtered weight can no longer carry a 47x slab gain onto anything outside (the slab itself, which runs
// to the storefront where the weight drops to 0.3, keeps the height gate only: its material is on no other surface). RR_FLAGS.nosugzones: m82.
const SUG_ZG = [2.5, 4.4, 0], SUG_ZGW = [2.5, 4.4, 0.6]; // [z min, z max, room weight from which the factors start (0: height gate only)]
const SUG_ZONES = !(globalThis.RR_FLAGS || {}).sugzones ? [] : [ // m83: hard zone edges showed as seams on the slab: opt in (sugzones=1) until feathered
  [-29.5, -25.0, -26.5, -22.0, 1.75, 1.8, 2.0],   // over the strips: ref 233 to 244 against 206 to 224 (B002 nx, pz, B009 nx)
  [-29.5, -22.0, -26.5, -21.0, 1.2, 1.45, 1.7],   // ref 213 205 172 against 212 178 126: the orange band, wants blue
  [-29.5, -21.0, -26.5, -20.0, 0.65, 0.8, 0.9],   // falling off towards the arch
  [-29.5, -20.0, -26.5, -18.0, 0.35, 0.38, 0.37], // behind the arch: ref 93 to 173 against 215 to 237
  [-26.5, -25.0, -25.0, -22.0, 0.9, 1.05, 1.3],   // storefront edge, view dependent (glossy at grazing angles): B002 nx wants 2 to 3, B002 py pz 0.6 to 0.9
  [-26.5, -22.0, -25.0, -20.0, 0.55, 0.68, 0.9],  // B002 py corner: ref 100 to 150 against 167 to 229 (B002 nx up to 1.5)
  [-35.0, -27.5, -30.5, -25.5, 2.6, 2.6, 2.9],    // far room, south strip field: ref 167 to 233 against 97 to 134
  [-35.0, -25.5, -30.5, -21.5, 0.9, 0.82, 0.72],  // far room north of it (B002 nx [320 320 384 384]): ref 88 to 147 against 98 to 138
];
// m84 audit (agent sug4, ray cast ids at B002 B009 nx, 16 px rays): sug_arch_glow is on one object only, sugmv_Mesh_1499
// (10585 faces, Blender x -39.9 to -26.0, y -46.2 to -17.5, z 0.07 to 4.07): the vault sail AND the arch soffits and
// jambs under it. The m84 "leak" boxes (B002 nx [192 256 320 320], B009 nx [512 320 576 384]) are that same mesh, seen
// through Material_501 at x -27.8 to -27.2, y -22.4 to -21.1, z 3.0 to 3.5: not a spill (m83 to m84 changed no pixel
// off the mesh). Per 0.25 m of height the reference has the mesh near black below z 3.3 (40 to 110) and bright from
// z 3.5 (206 to 232); only the storefront end (x > -26.8) stays bright down to z 2.25. Its reflected light matters as
// much as its emission (base colour 1 0.85 0.54, roughness 1): from m83 (e 0.22, 183) and m84 (e 0.6, 215), about half of
// the display linear value is reflected light. So the mask scales emission and reflected light together, with smooth
// edges: m = max(smoothstep(z0, z1, z), smoothstep(x0, x1, x)), emission x mix(loE, hiE, m), reflected x mix(loK, 1, m).
// hiE lifts the sail back when RR_FLAGS.sugdark tints the green glass in front of it (1 / tint, about). RR_FLAGS.sugmask=1.
const SUG_FL = globalThis.RR_FLAGS || {};
const SUG_MASK_ON = !!+(SUG_FL.sugmask ?? 0);
const SUG_GLOW_MASK = SUG_MASK_ON ? { gm: [+(SUG_FL.sugmz0 ?? 3.25), +(SUG_FL.sugmz1 ?? 3.5), +(SUG_FL.sugmx0 ?? -27.1), +(SUG_FL.sugmx1 ?? -26.6)],
  gl: [+(SUG_FL.sugmloe ?? 0.05), +(SUG_FL.sugmlok ?? 0.2), +(SUG_FL.sugglowhi ?? (+(SUG_FL.sugdark ?? 0) ? 1.5 : 1))] } : {};
export const ROOM_MATCAL_M74 = {
  Material_87: SUG_SPLIT ? { k: [12, 14, 17], box: SUG_NEAR, k2: [1.2, 1.2, 1.2], box2: SUG_FAR, zones: SUG_ZONES, zg: SUG_ZG, sugBake: true } /* m81 audit: near 20 overshot orange (the real lever, not the plaster); far 1.8 stacked on sugfar 0.6 */ : { k: [3.6, 3.6, 3.6], box: SUG_BOX, sugBake: true },
  'Material_87.004': { k: [1.3, 1.3, 1.3], box: SUG_BOX, sugBake: true },
  sug_wall_paint: { k: [0.4, 0.4, 0.4], box: SUG_BOX },
  rr_plain_floor: { k: [0.5, 0.5, 0.5], box: SUG_BOX },
  Material_525: { k: [0.6, 0.6, 0.6], box: SUG_BOX },
  sug_terracotta: { k: [1.2, 1.4, 1.7], box: SUG_BOX },
  ...(SUG_SPLIT ? { cl_ceil_plaster: { k: [3.4, 4.1, 5], box: SUG_NEAR, zones: SUG_ZONES.length ? [[-29.5, -20.0, -26.5, -18.0, 0.4, 0.4, 0.4]] : [], zg: SUG_ZGW } /* m82 sug3: slab edge faces, ref 189 177 145 against 224 193 145 (x -28, y -22) and 129 against 229 behind the arch */ } : {}),
  sug_arch_glow: { k: [1, 1, 1], e: +((globalThis.RR_FLAGS || {}).sugglow ?? 0.6) /* m83: 0.22 darkened the large vault sail (ref 240) */, box: SUG_BOX, ...SUG_GLOW_MASK }, // m82 sug3: vault glow (sugmv_Mesh_1499, strength 4) clips white, 234 to 238 against 164 to 173 (B002 B009 nx); grade(0.22 x emission) is about 180
};
// Per OBJECT corrections (agent rooms3, Oct 14), for objects whose material is shared with surfaces that want another
// gain (Material_110 and Material_107 are Sugarcane walls too, mil_stool_fabric the front stools). Fitted on m78_full:
// median of reference / viewer luminance in scene linear (grade inverted) over the first opaque ray cast hits of B000
// B073 B074 B075 B076 B078 B080 nz and B081 nx (8 px samples, 6 px blocks), dampened. Key: Blender object name
// (userData.invName), room: only where the object's centre lies in that room. Each matching mesh gets a clone of its
// material (same program, own uniforms; as rr2_probes.js does per capture). tr: also patch it when it is transparent.
// Not here: the sheer curtain mil_curtainR (x -2, y -5.4) that fills B073 B074 B076 nz (1.79 there) lies outside the Milos
// footprint, so a room gain cannot reach it: its brightness is a material question (mil_sheer: 0.55 transparent).
// RR_FLAGS.noobjcal turns the table off.
const MIL_BOX = [-17.5, -16.0, 13.0, 25.0];
export const ROOM_OBJCAL_M78 = {
  Mesh_2262: { room: 'milos', k: [1, 1, 1], col: [0.56, 0.56, 0.54], box: MIL_BOX },   // milosint Oct 22: read as a blank dark grey band across the back; light grey panels like the photos' back wall (was mil_stool_fabric 0.2 0.23 0.26 at k 0.4)
       // back bar shelving (mil_stool_fabric): ref 35 to 69 against 97 to 143, 0.31
  Mesh_2249: { room: 'milos', k: [1, 1, 1], col: [0.84, 0.79, 0.69], box: MIL_BOX },   // milosint Oct 22: shell walls and ceiling (Material_110, peach plaster photo) read warm cream like Ryan's photos; was k 0.55 (fit to the old dark 360s)
  Mesh_2253: { room: 'milos', k: [0.65, 0.65, 0.65], box: MIL_BOX },   // dark wood trim (Material_107), 0.62
  Mesh_2265: { room: 'milos', k: [1.6, 1.6, 1.6], col: [0.86, 0.84, 0.78], plain: 1, box: MIL_BOX },   // milosint Oct 22: the recess walls around the round downlight cans read as dark brown rings; cream like the ceiling (was terracotta, k 0.65)
  Mesh_2248: { room: 'milos', col: [0.62, 0.47, 0.32], flat: 1, planks: [0.19, 1.6], box: MIL_BOX },   // milosint Oct 22: Milos floor, the oak veneer photo tiled into metre wide swirls; light oak planks about 0.19 m (milos_front_straight_pots_ryan_1022.webp)
  Mesh_1647: { k: [1.35, 1.35, 1.35], box: MIL_BOX },   // no room gate: its bbox centre lands 1 cm outside the Milos mask (m80/m81: 0 hits); the shader still limits it to Milos cells   // white west wall (Material_617), 1.38
  Mesh_352: { room: 'milos', k: [1.4, 1.4, 1.4], col: [0.80, 0.80, 0.78], flat: 1, lmc: [1.15, 1.1, 1.05], box: MIL_BOX },   // flat + constant baked light: the streaks stayed with col alone (its lightmap chart)
        // white marble round bar front, 1.49; milosint Oct 22: clean white (its noise marble drew horizontal streaks)
  mil_barpot0: { room: 'milos', k: [1.2, 1.2, 1.2], box: MIL_BOX }, mil_barpot1: { room: 'milos', k: [1.2, 1.2, 1.2], box: MIL_BOX }, // m80: 1.4/1.6 overshot at B082 nz // stone urns 1.49 / 2.0
  // endfix (fix86, Oct 14): Mesh_240, the 20.7 m photo quad behind the Milos back bar (Material_115: Image_14 feeds base
  // colour and emission 0.42). The room gain leaves emission untouched and Material_115 has no material entry, so it kept
  // its full glow: ray cast hits at B076 B077 B080 B081 B082 B084 nz read ref / m83 0.13 in linear (mean, 142 rays).
  // e scales its emission inside MIL_BOX (uRoomME, no new program); k its reflected light on top of the room gain.
  // Uncalibrated first guess, flags mil240e (default 0.2) and mil240k (default 1)
  ...((globalThis.RR_FLAGS || {}).endfix ? { Mesh_240: { room: 'milos', k: Array(3).fill(+((globalThis.RR_FLAGS || {}).mil240k ?? 1)), e: +((globalThis.RR_FLAGS || {}).mil240e ?? 0.2), box: MIL_BOX } } : {}),
};
// milosint (Oct 22, Ryan 08:07 "the inside of milos is a disaster"): Milos pieces by name pattern, for the colours of Ryan's
// Venetian photos (milos_interior_*.webp): clean white linen cloths (the noise colour and fine bump read as a blotchy
// pattern), filled in from the photos. [regex on the Blender object name, entry as above]; RR_FLAGS.nomilint turns it off
export const ROOM_OBJCAL_RE = (globalThis.RR_FLAGS || {}).nomilint ? [] : [
  [/^((md\d+_)?mi_cloth\d+|mil_bt\d+)$/, { room: 'milos', col: [0.80, 0.79, 0.76], flat: 1, lmc: [1.0, 0.96, 0.9] }],   // lmc: rr2_lightmap.js constant light, their lightmap charts are pixel noise; white linen (Material_740 is cream 0.80 0.75 0.64 with noise)
  [/^r135_ceil163$/, { room: 'milos', k: [1.6, 1.6, 1.6], col: [0.88, 0.87, 0.83], plain: 1 }],   // the dining room ceiling plane (z 3.3, painted plaster photo, unbaked): warm cream like the photos
  [/^Path_69$/, { clipTop: ['Path_70', 0.004] }], [/^Path_(77|80)$/, { clipTop: ['Path_72', 0.004] }],
  [/^mil_stool\d+_seat$/, { room: 'milos', col: [0.17, 0.22, 0.27] }],   // bar stools: pale blue grey upholstery (round bar photo), the 0.55 0.68 0.78 baked near white
  [/(Back|Seating) coushion$/, { room: 'milos', col: [0.36, 0.45, 0.52] }],   // pale blue grey upholstered chairs (photo about sRGB 160 175 185)
];
// milosint (Oct 22, Ryan 08:58): pieces taken out of the scene at load, by Blender object name. r9zz2_mil_understrip is a white
// glow strip lying on the floor along the round bar (the photos show the bar FRONT lit, not the floor); the mil_*_rope rings
// of the restored amphorae came out about 2.8 m wide and up to 0.85 m under the floor (the jar bodies mil_pithos, mil_pithosT,
// mil_jarS, mil_pithosL are the right 1 m size and stay). RR_FLAGS.nomilhide keeps them.
export const ROOM_HIDE_RE = (globalThis.RR_FLAGS || {}).nomilhide ? null : /^(r9zz2_mil_understrip|mil_(pithos|pithosT|pithosL|jarS)_rope\d+)$/;
// cotegj (Oct 22, Ryan's COTE and Gjelina photos, W\inspect\photocmp_1022 A18 A05 A06): entries as above plus
//   mat: regex on the material name (a mesh with several materials, e.g. the grill table's stone top and brass grill)
//   kx: factor on reflected light anywhere (COTE has no room mask, so k cannot reach it); em: added emission, linear rgb
// COTE (not a hero, no bake rule): table tops were bright blue (RR_Marble_Nero photo texture), photo: black stone with a
// gold grill; the room read very dim (photo: warm amber); the flat ceiling is dark bronze lit amber in the photo; the
// back wall behind the bar is a living green wall and the wall left of it a red lit wine wall. Gjelina (hero): gains
// only, no emission (fix list 54): the shelves, bottles and bar read near black through the glass. RR_FLAGS.nocotegj: off.
export const ROOM_OBJCAL_RE2 = (globalThis.RR_FLAGS || {}).nocotegj ? [] : [
  [/_RR_COTE_GrillTable(\.\d+)?$/, { mat: /^RR_Marble_Nero/, col: [0.02, 0.024, 0.021], kx: 1.4 }],
  [/_RR_COTE_GrillTable(\.\d+)?$/, { mat: /^RR_Brass_Satin/, kx: 2.2, em: [0.05, 0.03, 0.008] }],
  [/^r137_ceil\d+$/, { col: [0.16, 0.10, 0.045], kx: 1.6, em: [0.045, 0.026, 0.008], flat: 1 }],
  [/^(r137_f(255|257|259)|mbf_w(7|8|9|10))$/, { col: [0.30, 0.03, 0.03], em: [0.10, 0.006, 0.004], kx: 1.2 }],   // red lit wine wall (north west, left of the bar)
  [/^(mbf_w(11|12|13))$/, { col: [0.035, 0.10, 0.03], kx: 2.0, em: [0.004, 0.012, 0.003] }],   // living green wall behind the bar
  [/^cgx_cote_petals$/, { kx: 2.2, em: [0.05, 0.032, 0.012] }],   // new petal ceiling discs (cg_petals.glb, PATCH_rows.json): gold plaster lit amber from the coves
  [/^(r9z[lq]_cote|r137_|mbf_floor_137_|mbf_w(14|15|16))/, { kx: 2.6 }],   // the rest of the COTE room: warm amber, not dim
  [/^(gi_shelf|gi_bot|riw_shelf|ri_bott|gi_niche|gi_arch|ri_arch)\d*$/, { room: 'gjelina', kx: [1.7, 1.55, 1.35] }],   // back bar shelves and bottles (k needs a box, kx does not)
  // Gjelina main room against Trip Davis' photos (Gjelina_Vegas_main_dining_room, gjelina_web_main_room_wide_green_soffit_open_kitchen):
  // white plaster walls and ceiling, a sage green plaster canopy over the open kitchen and bar, grey stone floor, a black wine
  // peg wall on the west side (the olive photo boxes Mesh_2019 / Mesh_1970 read as olive walls). Reviewer cand_0940 sweep.
  [/^ri_ceil$/, { col: [0.075, 0.105, 0.075] }],            // green plaster canopy (was brown 0.30 0.24 0.18)
  [/^riw_ceil$/, { col: [0.075, 0.105, 0.075] }],
  [/^r134_ceil\d+$/, { col: [0.74, 0.71, 0.64], kx: 1.15 }],   // white plaster ceiling round the canopy
  [/^(ri_back|riw_back)$/, { col: [0.70, 0.66, 0.58] }],       // white plaster walls (was brown 0.22 0.14 0.09)
  [/^(ri_floor|riw_floor)$/, { col: [0.15, 0.14, 0.125] }],   // grey stone floor (was brown 0.10 0.065 0.04)
  [/^(Mesh_2019|Mesh_1970)$/, { col: [0.022, 0.021, 0.02] }],   // olive photo boxes: black wine peg wall
  // Paul's frames (Exteriors\_ref_by_place\gjelina_milos_wall): the plaster round the Milos side bay is a dark chocolate brown,
  // the model drew it salmon pink (rot_rustband)
  [/^(gjl_wall_right|gjl_rust_over_[LR]|gjl_rust_ret_top)$/, { col: [0.085, 0.05, 0.04] }],
];
// cotegj: pieces taken out at load. Mesh_154 is an emissive photo card box (11 m x 4.6 m x 4.3 m, Material_29, a photo of the
// real room) standing in the middle of the Gjelina dining room; from inside the room it is the wall that blocks the centre
// views (cand_0940 sweep int4). RR_FLAGS.nogjhide keeps it.
export const ROOM_HIDE_RE2 = (globalThis.RR_FLAGS || {}).nogjhide || (globalThis.RR_FLAGS || {}).nocotegj ? null : /^Mesh_154$/;
const ROOM_OBJCAL_ALL = [...ROOM_OBJCAL_RE, ...ROOM_OBJCAL_RE2];
// milosint (Oct 22 09:5x, reviewer on cand_0940): the 'o' glyphs of the fascia lettering (Path_69 in Milos, Path_77 and
// Path_80 in estiatorio) carry a thin sliver that rises above the letter and reads as an accent ("Milós") from 30 degrees
// either side. clipTop: [reference letter, pad m] discards fragments above that letter's top (the 's' of the same word)
// Moves (Blender metres, viewer only): mil_barpot1 and its flowers stood 1.4 m up at the west end with nothing under
// them (reviewer: floating grey pot in front of the blue painting); set on the floor as a floor planter.
// Low tableware: r9z*_milos_* glasses, plates, mugs and bowls lying on the floor (top under 0.45 m) are taken out.
export const ROOM_MOVE = (globalThis.RR_FLAGS || {}).nomilhide ? {} : { mil_barpot1: [0, 0, -1.4], mil_barflowers1: [0, 0, -1.4], mil_pithos: [-1.074, -2.222, 0] };   // milbar 10:3x: mil_pithos (015) stood inside the new bar body at its east end: on the floor in the mouth of the bartender gap, behind the pier
export const ROOM_LOW_RE = (globalThis.RR_FLAGS || {}).nomilhide ? null : /^r9z[a-z]*_milos_\d+_(Wine Glass|dinner plate|salad plate|mug|soup|Glass)/;
// milbar (Oct 22, Ryan 09:1x "interior bar looks nothing like the actual bar"): the old Milos bar is parked in the .blend
// (build/r9ze4_lmx_gj_milbar.blend, collection _park_milbar) and taken out at load by Blender object name; the rebuilt bar is
// data/gjM2c/017.glb (CL_MilBar). Mesh_2265 (the dark rings round the two hanging cans Mesh_552/553 over the old bar) is
// parked too: the soffit ribbon replaces it, so its ROOM_OBJCAL entry above no longer applies. RR_FLAGS.nomilbarhide keeps them.
export const MILBAR_HIDE_RE = (globalThis.RR_FLAGS || {}).nomilbarhide ? null : new RegExp("^(Mesh_2261|Mesh_2265|Mesh_351|Mesh_352|Mesh_353|Mesh_355|Mesh_356|Mesh_357|Mesh_358|Mesh_359|Mesh_360|Mesh_361|Mesh_362|Mesh_363|Mesh_364|Mesh_365|Mesh_366|Mesh_367|Mesh_368|Mesh_369|Mesh_370|Mesh_371|Mesh_372|Mesh_373|Mesh_374|Mesh_376|Mesh_377|Mesh_378|Mesh_379|Mesh_380|Mesh_381|Mesh_382|Mesh_383|Mesh_384|Mesh_385|Mesh_386|Mesh_387|Mesh_388|Mesh_389|Mesh_390|Mesh_391|Mesh_392|Mesh_393|Mesh_394|Mesh_395|Mesh_396|Mesh_397|Mesh_398|Mesh_399|Mesh_400|Mesh_401|Mesh_402|Mesh_403|Mesh_404|Mesh_405|Mesh_406|Mesh_407|Mesh_408|Mesh_409|Mesh_410|Mesh_411|Mesh_412|Mesh_413|Mesh_414|Mesh_415|Mesh_416|Mesh_417|Mesh_418|Mesh_419|Mesh_420|Mesh_421|Mesh_422|Mesh_423|Mesh_424|Mesh_425|Mesh_426|Mesh_427|Mesh_428|Mesh_429|Mesh_430|Mesh_431|Mesh_432|Mesh_433|Mesh_434|Mesh_435|Mesh_436|Mesh_437|Mesh_438|Mesh_439|Mesh_440|Mesh_441|Mesh_442|Mesh_443|Mesh_444|Mesh_445|Mesh_446|Mesh_447|Mesh_448|Mesh_449|Mesh_450|Mesh_451|Mesh_452|Mesh_453|Mesh_454|Mesh_455|Mesh_456|Mesh_457|Mesh_458|Mesh_459|Mesh_460|Mesh_461|Mesh_462|Mesh_463|Mesh_464|Mesh_465|Mesh_466|Mesh_467|Mesh_468|Mesh_469|Mesh_470|Mesh_471|Mesh_472|Mesh_473|Mesh_474|Mesh_475|Mesh_476|Mesh_477|Mesh_478|Mesh_479|Mesh_480|Mesh_481|Mesh_482|Mesh_483|Mesh_484|Mesh_485|Mesh_486|Mesh_487|Mesh_488|Mesh_489|Mesh_490|Mesh_491|Mesh_492|Mesh_493|Mesh_494|Mesh_495|Mesh_496|Mesh_497|Mesh_498|Mesh_499|Mesh_500|Mesh_501|Mesh_502|Mesh_503|Mesh_504|Mesh_505|Mesh_506|Mesh_507|Mesh_508|Mesh_509|Mesh_510|Mesh_511|Mesh_512|Mesh_513|Mesh_514|Mesh_515|Mesh_516|Mesh_517|Mesh_518|Mesh_519|Mesh_520|Mesh_521|Mesh_522|Mesh_523|Mesh_524|Mesh_525|Mesh_526|Mesh_527|Mesh_528|Mesh_529|Mesh_530|Mesh_531|Mesh_532|Mesh_533|Mesh_534|Mesh_535|Mesh_536|Mesh_552|Mesh_553|mil_barflowers0|mil_barflowers1|mil_barpot0|mil_barpot1|mil_branch0_blossoms|mil_branch1_blossoms|mil_bvase0|mil_bvase1|mil_stool0_frame|mil_stool0_seat|mil_stool10_frame|mil_stool10_seat|mil_stool11_frame|mil_stool11_seat|mil_stool12_frame|mil_stool12_seat|mil_stool13_frame|mil_stool13_seat|mil_stool14_frame|mil_stool14_seat|mil_stool15_frame|mil_stool15_seat|mil_stool16_frame|mil_stool16_seat|mil_stool1_frame|mil_stool1_seat|mil_stool2_frame|mil_stool2_seat|mil_stool3_frame|mil_stool3_seat|mil_stool4_frame|mil_stool4_seat|mil_stool5_frame|mil_stool5_seat|mil_stool6_frame|mil_stool6_seat|mil_stool7_frame|mil_stool7_seat|mil_stool8_frame|mil_stool8_seat|mil_stool9_frame|mil_stool9_seat|mil_urn0|r9zz2_mil_tower_bottle|r9zz2_mil_tower_bottle\\.001|r9zz2_mil_tower_bottle\\.002|r9zz2_mil_tower_bottle\\.003|r9zz2_mil_tower_bottle\\.004|r9zz2_mil_tower_bottle\\.005|r9zz2_mil_tower_bottle\\.006|r9zz2_mil_tower_bottle\\.007|r9zz2_mil_tower_bottle\\.008|r9zz2_mil_tower_bottle\\.009|r9zz2_mil_tower_bottle\\.010|r9zz2_mil_tower_bottle\\.011|r9zz2_mil_tower_bottle\\.012|r9zz2_mil_tower_bottle\\.013|r9zz2_mil_tower_bottle\\.014|r9zz2_mil_tower_glass|r9zz2_mil_tower_glass\\.001|r9zz2_mil_tower_glass\\.002|r9zz2_mil_tower_glass\\.003|r9zz2_mil_tower_lav|r9zz2_mil_tower_post|r9zz2_mil_tower_post\\.001|r9zz2_mil_tower_post\\.002|r9zz2_mil_tower_post\\.003|r9zz2_mil_tower_shelf|r9zz2_mil_tower_shelf\\.001|r9zz2_mil_tower_shelf\\.002|r9zz2_mil_understrip|r9zif_milos_0[2346789]_.*)$");
const ROOM_NZ = 8;
const clampT = (v) => Math.min(1.18, Math.max(0.85, v));
export class RoomLighting {
  constructor({ cal = ROOM_CAL_M54, masks = ROOM_MASKS , matCal = (globalThis.RR_FLAGS || {}).nomatcal ? {} : ROOM_MATCAL_M74, objCal = (globalThis.RR_FLAGS || {}).noobjcal ? {} : ROOM_OBJCAL_M78 } = {}) {
    this.masks = masks; this.cal = cal; this.matCal = matCal || {}; this.objCal = objCal || {}; this.matCalHits = {}; this.objCalHits = {};
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; const C = 0.5;
    for (const m of Object.values(masks)) { x0 = Math.min(x0, m.x0); y0 = Math.min(y0, m.y0); x1 = Math.max(x1, m.x0 + m.w * m.cell); y1 = Math.max(y1, m.y0 + m.h * m.cell); }
    this.C = C; this.x0 = x0 - 2; this.y0 = y0 - 2; this.W = Math.ceil((x1 - x0 + 4) / C); this.H = Math.ceil((y1 - y0 + 4) / C);
    this.id = new Uint8Array(this.W * this.H); this.names = Object.keys(masks);
    this.names.forEach((name, k) => { const m = masks[name];
      m.runs.forEach((rr, j) => { for (let a = 0; a < rr.length; a += 2) for (let i = rr[a]; i < rr[a] + rr[a + 1]; i++) {
        const X = Math.floor((m.x0 + (i + 0.5) * m.cell - this.x0) / C), Y = Math.floor((m.y0 + (j + 0.5) * m.cell - this.y0) / C);
        if (X >= 0 && Y >= 0 && X < this.W && Y < this.H) this.id[Y * this.W + X] = k + 1; } }); });
    const mk = () => { const t = new THREE.DataTexture(new Uint16Array(this.W * this.H * 4), this.W, this.H, THREE.RGBAFormat, THREE.HalfFloatType);
      t.magFilter = t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.colorSpace = THREE.NoColorSpace; return t; };
    this.uG = { value: mk() }; this.uT = { value: mk() };
    this.uB = { value: new THREE.Vector4(this.x0, this.y0, 1 / (this.W * C), 1 / (this.H * C)) };
    this.uOn = { value: 1 };
    this.setCalibration(cal);
  }
  // gains and tints per cell; corridor cells hold 1 (and a top of 99 m), so filtering at a room border fades the gain
  setCalibration(cal) {
    this.cal = cal; const h = THREE.DataUtils.toHalfFloat, G = this.uG.value.image.data, T = this.uT.value.image.data;
    const FF = globalThis.RR_FLAGS || {}, dExp = +(FF.mildepth ?? 0)   /* milosint Oct 22: was 1.3 (old 360s had a dark back room); the real room is evenly bright (milos_interior_*.webp) */, rackK = +(FF.milrack ?? 1), milX = +(FF.milx ?? -6); // m76 audit: rack shadow drew a dark block (off); west dining room x < -6 is bright in the 360s
    for (let c = 0; c < this.W * this.H; c++) { const k = this.id[c]; const name = k ? this.names[k - 1] : null; const r = name && cal[name];
      let g = r ? r.g : [1, 1, 1]; const t = r ? r.t.map(clampT) : [1, 1, 1], top = r ? this.masks[name].ztop + 0.6 : 99;
      if (name === 'milos' && r) {
        const bx = this.x0 + ((c % this.W) + 0.5) * this.C, by = this.y0 + (Math.floor(c / this.W) + 0.5) * this.C;
        const kd = dExp > 0 && (bx > milX || by > (FF.milxy ?? 3)) ? Math.pow(milosDepth(by), dExp) : 1, kc = Math.sqrt(kd); // m77: the x gate also lit the dark back bar (y > 3): only the front of the west room is exempt // ceiling and floor fall off more gently than the back wall it was fitted on (m76 audit)
        const inRack = bx >= MILOS_RACK[0][0] && bx <= MILOS_RACK[1][0] && by >= MILOS_RACK[0][1] && by <= MILOS_RACK[1][1];
        g = [g[0] * kd, g[1] * kc * (inRack ? rackK : 1), g[2] * kc];
      }
      if (name === 'sugarcane' && r && SUG_SPLIT) { const bx = this.x0 + ((c % this.W) + 0.5) * this.C; if (bx < SUG_X) { const f = +(FF.sugfar ?? 0.6); /* m80: 0.4 made the far room a dark cave from the corridor */ g = g.map(v => v * f); } }
      G[c * 4] = h(g[0]); G[c * 4 + 1] = h(g[1]); G[c * 4 + 2] = h(g[2]); G[c * 4 + 3] = h(r ? 1 : 0);
      T[c * 4] = h(t[0]); T[c * 4 + 1] = h(t[1]); T[c * 4 + 2] = h(t[2]); T[c * 4 + 3] = h(top); }
    this.uG.value.needsUpdate = true; this.uT.value.needsUpdate = true;
  }
  // take the room layer off a material (it must be the outermost layer) and report whether it was there; patch() puts it
  // back (rr2_probes.js unifyVariants)
  unwrap(m) {
    const ud = m.userData; if (!ud.roomLit) return false;
    m.onBeforeCompile = ud.roomBase.obc; m.customProgramCacheKey = ud.roomBase.key; delete ud.roomLit; delete ud.roomBase; return true;
  }
  roomAt(bx, by) { const X = Math.floor((bx - this.x0) / this.C), Y = Math.floor((by - this.y0) / this.C);
    if (X < 0 || Y < 0 || X >= this.W || Y >= this.H) return null; const k = this.id[Y * this.W + X]; return k ? this.names[k - 1] : null; }
  // every opaque standard material in the scene (glass and cutout panes keep their own path in thinGlass)
  // RR_FLAGS.roomclip = 1 (agent vmisc, Oct 15, off unless set): the masks were drawn as the room objects' footprint plus
  // cells seen through a pane, MINUS the corridor cells the 34 capture spots see directly. No spot stands east of Blender
  // x 5 (B084), so east of about x 13 nothing took the corridor out: the delmonico mask covers the whole corridor under
  // tray_FE and tray_H1 (x 15 to 34, y -4 to 9) and the matteos mask the corridor south of it (x 15 to 29, y -12 to -4).
  // Those corridor ceilings, walls and floors took the rooms' gains and warm tints (delmonico ceiling 0.59, matteos
  // ceiling 1.62, floor 0.63) in bilinear 0.5 m cells: the dark orange wash and stair stepped blotches east of Delmonico
  // (sweep K4 / K5 / O7: rv05 15, rv06 17, rv08 19; covefix3 measured the field there 40 % low). Here every mask cell east
  // of RR_FLAGS.roomclipx (default 13) that lies more than RR_FLAGS.roomclipd (default 1.5 m) from the plan box of any of
  // its own room's interior objects (ROOM_GROUPS, boxes under 15 m) is cleared; cells west of that line keep the fitted
  // masks. Texture data only (setCalibration), no program change.
  clipToObjects(root) {
    const F = globalThis.RR_FLAGS || {}, xc = +(F.roomclipx ?? 13), dd = +(F.roomclipd ?? 1.5), bb = new THREE.Box3();
    const g2r = {}; for (const [r, gs] of Object.entries(ROOM_GROUPS)) for (const g of gs) g2r[g] = r;
    const boxes = {}; root.updateMatrixWorld(true);
    root.traverse(o => { if (!o.isMesh) return; const r = g2r[o.userData.invGroup]; if (!r) return; bb.setFromObject(o);
      if (bb.isEmpty() || bb.max.x - bb.min.x > 15 || bb.max.z - bb.min.z > 15) return;
      (boxes[r] ||= []).push([bb.min.x - dd, -bb.max.z - dd, bb.max.x + dd, -bb.min.z + dd]); });
    let cleared = 0; const per = {};
    for (let c = 0; c < this.W * this.H; c++) { const k = this.id[c]; if (!k) continue; const name = this.names[k - 1];
      const bx = this.x0 + ((c % this.W) + 0.5) * this.C, by = this.y0 + (Math.floor(c / this.W) + 0.5) * this.C; if (bx <= xc) continue;
      if ((boxes[name] || []).some(b => bx >= b[0] && bx <= b[2] && by >= b[1] && by <= b[3])) continue;
      this.id[c] = 0; cleared++; per[name] = (per[name] || 0) + 1; }
    if (cleared) this.setCalibration(this.cal);
    return { cleared, per, boxes: Object.fromEntries(Object.entries(boxes).map(([k, v]) => [k, v.length])) };
  }
  patchAll(root) {
    const done = new Set(); let n = 0, cells = 0, nObj = 0;
    let nHide2 = 0; if (ROOM_HIDE_RE2) root.traverse(o => { if (o.isMesh && ROOM_HIDE_RE2.test(o.userData.invName || o.name)) { o.visible = false; o.userData.cotegjHidden = [o.geometry.drawRange.start, o.geometry.drawRange.count]; o.geometry.setDrawRange(0, 0); nHide2++; } });   // cotegj: hidden, kept in the scene
    let nHide = 0; if (ROOM_HIDE_RE || MILBAR_HIDE_RE) { const gone = []; root.traverse(o => { const nm = o.userData.invName || o.name; if (o.isMesh && ((ROOM_HIDE_RE && ROOM_HIDE_RE.test(nm)) || (MILBAR_HIDE_RE && MILBAR_HIDE_RE.test(nm)))) gone.push(o); });
      for (const o of gone) { o.visible = false; o.removeFromParent(); nHide++; } }
    let nMove = 0, nLow = 0; { const byN = new Map(), bx = new THREE.Box3(), low = []; root.updateMatrixWorld(true);
      root.traverse(o => { if (!o.isMesh) return; const nm = o.userData.invName || o.name; if (!byN.has(nm)) byN.set(nm, o);
        const mv = ROOM_MOVE[nm]; if (mv) { o.position.x += mv[0]; o.position.y += mv[2]; o.position.z -= mv[1]; o.updateMatrixWorld(true); nMove++; }
        if (ROOM_LOW_RE && ROOM_LOW_RE.test(nm)) { bx.setFromObject(o); if (!bx.isEmpty() && bx.max.y < 0.45) low.push(o); } });
      for (const o of low) { o.visible = false; o.removeFromParent(); nLow++; }
      for (const [, ent] of ROOM_OBJCAL_RE) if (ent.clipTop) { const r = byN.get(ent.clipTop[0]); if (r) { bx.setFromObject(r); ent.clipY = bx.max.y + ent.clipTop[1]; } } }
    const clip = +((globalThis.RR_FLAGS || {}).roomclip ?? 0) ? this.clipToObjects(root) : null;
    // per object entries: a clone of the material for the matching meshes (one clone per material and entry)
    if (Object.keys(this.objCal).length) { const clones = new Map(), bb = new THREE.Box3(), cc = new THREE.Vector3(); root.updateMatrixWorld(true);
      root.traverse(o => { if (!o.isMesh || Array.isArray(o.material) || !o.material || !o.material.isMeshStandardMaterial) return;
        const nm = o.userData.invName || o.name, src = o.material, ent = this.objCal[nm] || (ROOM_OBJCAL_ALL.find(([re, e]) => re.test(nm) && (!e.mat || e.mat.test(src.name || ''))) || [])[1]; if (!ent) return;
        if ((src.transmission ?? 0) > 0 || src.userData.glassEmit || (src.transparent && !ent.tr)) return;
        // endfix: a piece of an object split for its size gates on the whole object's centre (rr2_player.js splitC), so
        // every piece keeps the entry (pieces whose own centre fell outside the Milos mask lost it)
        if (o.userData.splitC) cc.fromArray(o.userData.splitC); else { bb.setFromObject(o); bb.getCenter(cc); }
        if (ent.room && this.roomAt(cc.x, -cc.z) !== ent.room) return;
        const key = src.uuid + '|' + nm; let m = clones.get(key);
        if (!m) { const ud = src.userData; src.userData = {}; m = src.clone(); src.userData = ud; m.userData = { ...ud };
          m.defines = { ...src.defines }; m.onBeforeCompile = src.onBeforeCompile; m.customProgramCacheKey = src.customProgramCacheKey;
          m.userData.roomObjCal = ent; m.userData.roomObjName = nm;
          // milosint 10:1x: plain: 1 swaps the Blender graph for one simple standard material of colour col (a short program that
          // always links, and whose load time fallback looks the same); the graph version of the Milos ceiling never left its
          // taupe fallback (photo texture, no room gain) in the sweeps
          if (ent.plain && ent.col) { const q = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(...ent.col, THREE.LinearSRGBColorSpace), roughness: 0.9, metalness: 0, side: src.side, envMap: src.envMap || null, envMapIntensity: src.envMapIntensity ?? 1 });
            q.name = (src.name || 'm') + ' [plain]'; q.userData = { roomObjCal: ent, roomObjName: nm, plain: true }; m = q; }
          clones.set(key, m); }
        o.material = m; nObj++; this.objCalHits[nm] = (this.objCalHits[nm] || 0) + 1; }); }
    root.traverse(o => { if (!o.isMesh) return; for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
      if (!m || done.has(m) || !m.isMeshStandardMaterial || (m.transparent && !m.userData.roomObjCal) || (m.transmission ?? 0) > 0 || m.userData.glassEmit) continue; done.add(m); this.patch(m); n++; } });
    // cotegj (Oct 22): the rotunda chandelier (rot_chand_crystals, 29k triangles) reads as sparse gold arms with few crystals
    // against the dense crystal chandelier in Paul's IMG_1181 / IMG_1182; RR_FLAGS.chandx (default 3, 0 off) more turned and
    // slightly smaller tiers of the same crystals as one InstancedMesh (same material, one extra draw, no new program)
    const CHX = Math.max(0, Math.min(4, Math.round(+((globalThis.RR_FLAGS || {}).chandx ?? 3)))); let nChand = 0;
    if (CHX) { const src = []; root.traverse(o => { if (o.isMesh && !o.isInstancedMesh && /^rot_chand_crystals$/.test(o.userData.invName || o.name)) src.push(o); });
      if (src.length) { root.updateMatrixWorld(true); const bb = new THREE.Box3(); src.forEach(o => bb.expandByObject(o)); const c = bb.getCenter(new THREE.Vector3()), h = bb.max.y - bb.min.y;
        const SPEC = [[0.21, 0.94, -0.10], [0.42, 0.86, -0.22], [0.13, 0.66, 0.06], [0.31, 0.5, -0.02]].slice(0, CHX);   // [turn rad, scale, drop as a share of the height]
        const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert(), M = new THREE.Matrix4(), A = new THREE.Matrix4(), Bm = new THREE.Matrix4();
        for (const o of src) { const im = new THREE.InstancedMesh(o.geometry, o.material, SPEC.length); im.name = (o.name || 'rot_chand_crystals') + '_cgx'; im.userData.invName = 'rot_chand_crystals_cgx';
          SPEC.forEach(([a, s, dy], i) => { A.makeTranslation(c.x, c.y + dy * h, c.z).multiply(Bm.makeRotationY(a)).multiply(M.makeScale(s, s, s)).multiply(Bm.makeTranslation(-c.x, -c.y, -c.z));
            im.setMatrixAt(i, new THREE.Matrix4().multiplyMatrices(rootInv, A).multiply(o.matrixWorld)); });
          im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); root.add(im); nChand += SPEC.length; } } }
    for (const v of this.id) if (v) cells++;
    return { hidden: nHide, hidden2: nHide2, chandx: nChand, moved: nMove, lowTableware: nLow, clipY: ROOM_OBJCAL_RE.filter(([, e]) => e.clipTop).map(([, e]) => e.clipY ?? null), materials: n, rooms: this.names.length, cells, grid: [this.W, this.H], objMeshes: nObj, objCal: this.objCalHits, ...(clip ? { roomclip: clip } : {}) };
  }
  patch(material) {
    if (material.userData.roomLit) return; material.userData.roomLit = true;
    const prev = material.onBeforeCompile, prevKey = material.customProgramCacheKey, self = this; material.userData.roomBase = { obc: prev, key: prevKey };
    material.onBeforeCompile = (sh, r) => {
      if (prev) prev.call(material, sh, r);
      sh.uniforms.uRoomG = self.uG; sh.uniforms.uRoomT = self.uT; sh.uniforms.uRoomB = self.uB; sh.uniforms.uRoomOn = self.uOn;
      // ceilfix bit 1 (agent ceilfix): the room plan mask (0.5 m cells, closed by 1 m) reaches under the corridor soffits along
      // the storefronts and, far from the capture spots, over whole corridor ceiling bays (delmonico mask under tray_FE_patch
      // at Blender x 23 to 27, yardbird mask in front of Yardbird): those ceilings took the room's ceiling gain (0.57 to 4) in
      // bilinear 0.5 m steps, the soft dark blotches and stepped ghost planes of the Oct 14 sweep. Per material uniform (the
      // corridor and interior clones of rr2_probes.js are separate materials): no extra program beyond the flag's own key
      const CF1 = !!((((globalThis.RR_FLAGS || {}).ceilfix === true ? 15 : +((globalThis.RR_FLAGS || {}).ceilfix) || 0)) & 1);
      if (CF1) sh.uniforms.uRoomCorr = { value: material.userData.roomCorr ? 1 : 0 };
      // per material entry (ROOM_MATCAL_M74): own uniforms on the shared program, identity for every other material
      // a per object entry (ROOM_OBJCAL_M78, on the material clone) takes the place of the material's entry
      const mc = material.userData.roomObjCal || self.matCal[material.name]; const useK = mc && mc.k && !(mc.sugBake && material.userData.sugBake);
      sh.uniforms.uRoomMK = { value: new THREE.Vector3(...(useK ? mc.k : [1, 1, 1])) }; sh.uniforms.uRoomME = { value: mc && mc.e != null ? mc.e : 1 };
      sh.uniforms.uRoomMBox = { value: new THREE.Vector4(...(mc && mc.box ? mc.box : [1, 1, -1, -1])) };
      sh.uniforms.uRoomMK2 = { value: new THREE.Vector3(...(useK && mc.k2 ? mc.k2 : [1, 1, 1])) };
      sh.uniforms.uRoomMBox2 = { value: new THREE.Vector4(...(useK && mc.box2 ? mc.box2 : [1, 1, -1, -1])) };
      // up to ROOM_NZ extra zones (rgb factors on top of k, box2), identity boxes when unused; zg: room weight and height gate
      const zs = useK && mc.zones ? mc.zones.slice(0, ROOM_NZ) : [];
      sh.uniforms.uRoomZB = { value: Object.assign(Array.from({ length: ROOM_NZ }, (_, i) => new THREE.Vector4(...(zs[i] ? zs[i].slice(0, 4) : [1, 1, -1, -1]))), { _rrVer: 0 }) };   // constant (rr2_look array upload cache)
      sh.uniforms.uRoomZK = { value: Array.from({ length: ROOM_NZ }, (_, i) => new THREE.Vector3(...(zs[i] ? zs[i].slice(4, 7) : [1, 1, 1]))) };
      sh.uniforms.uRoomZG = { value: new THREE.Vector3(...(mc && mc.zg ? mc.zg : [-1e4, 1e4, 0])) };
      // milosint (Oct 22): an object entry may set its base colour (col, linear rgb, replaces the Blender graph's colour, so a
      // photo or noise texture stops showing) and drop the graph's bump (flat: 1, the geometric normal); before the lights,
      // so baked copies (rr2_lightmap.js lmCopy keeps this onBeforeCompile) show the same colour
      if (mc && (mc.col || mc.flat || mc.planks || mc.clipY != null)) { let pre = '';
        if (mc.clipY != null) pre += 'if (vRoomWP.y > ' + (+mc.clipY).toFixed(4) + ') discard;\n';
        if (mc.col) { sh.uniforms.uRoomCol = { value: new THREE.Vector3(...mc.col) }; pre += 'diffuseColor.rgb = uRoomCol;\n'; sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uRoomCol;'); }
        if (mc.flat) pre += 'normal = nonPerturbedNormal;\n';
        // planks: [width, length] m, light oak boards along Blender y (the photos), per board tone, thin seams, fine grain; on col
        if (mc.planks) { const [pw, pl] = mc.planks.map(v => (+v).toFixed(3)); pre += `{ vec2 pp = vec2(vRoomWP.x, -vRoomWP.z); float prow = floor(pp.x / ${pw});
          float poff = fract(sin(prow * 12.9898) * 43758.5453) * ${pl}; float pcol = floor((pp.y + poff) / ${pl});
          float ph = fract(sin(dot(vec2(prow, pcol), vec2(12.9898, 78.233))) * 43758.5453);
          float pex = min(fract(pp.x / ${pw}), 1.0 - fract(pp.x / ${pw})) * ${pw};
          float pey = min(fract((pp.y + poff) / ${pl}), 1.0 - fract((pp.y + poff) / ${pl})) * ${pl};
          float pseam = smoothstep(0.0, 0.0035, pex) * smoothstep(0.0, 0.004, pey);
          float pgr = 0.96 + 0.04 * sin(pp.x * 260.0 + sin(pp.y * 3.1 + ph * 6.0) * 2.5 + ph * 20.0);
          diffuseColor.rgb *= (0.88 + 0.2 * ph) * pgr * mix(0.62, 1.0, pseam); }\n`; }
        sh.fragmentShader = sh.fragmentShader.replace('#include <lights_physical_fragment>', pre + '#include <lights_physical_fragment>'); }
      // glow mask (sugmask): identity edges and factors for every other material
      if (SUG_MASK_ON) { sh.uniforms.uRoomGM = { value: new THREE.Vector4(...(mc && mc.gm ? mc.gm : [-2e4, -1e4, -2e4, -1e4])) };
        sh.uniforms.uRoomGL = { value: new THREE.Vector3(...(mc && mc.gl ? mc.gl : [1, 1, 1])) }; }
      if (mc) self.matCalHits[material.userData.roomObjName || material.name] = { k: useK ? mc.k : null, k2: useK ? mc.k2 ?? null : null, e: mc.e ?? null };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRoomWP;')
        .replace('#include <fog_vertex>', `#include <fog_vertex>
  #ifdef USE_INSTANCING
  vRoomWP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
  #else
  vRoomWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
  #endif`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vRoomWP; uniform sampler2D uRoomG; uniform sampler2D uRoomT; uniform vec4 uRoomB; uniform float uRoomOn;
uniform vec3 uRoomMK; uniform float uRoomME; uniform vec4 uRoomMBox; uniform vec3 uRoomMK2; uniform vec4 uRoomMBox2;
uniform vec4 uRoomZB[${ROOM_NZ}]; uniform vec3 uRoomZK[${ROOM_NZ}]; uniform vec3 uRoomZG;${CF1 ? ' uniform float uRoomCorr;' : ''}${SUG_MASK_ON ? '\nuniform vec4 uRoomGM; uniform vec3 uRoomGL;' : ''}`)
        .replace('#include <aomap_fragment>', `{
    // room interiors: reflected light times the room's gain for this orientation, and its tint (emission untouched)
    vec2 ruv = (vec2(vRoomWP.x, -vRoomWP.z) - uRoomB.xy) * uRoomB.zw;
    vec4 rg = texture2D(uRoomG, ruv); vec4 rt = texture2D(uRoomT, ruv);
    vec2 rbp = vec2(vRoomWP.x, -vRoomWP.z); bool rInBox = uRoomOn > 0.5 && all(greaterThanEqual(rbp, uRoomMBox.xy)) && all(lessThanEqual(rbp, uRoomMBox.zw));
    bool rInBox2 = uRoomOn > 0.5 && all(greaterThanEqual(rbp, uRoomMBox2.xy)) && all(lessThanEqual(rbp, uRoomMBox2.zw));
    if (rInBox) totalEmissiveRadiance *= uRoomME;
${SUG_MASK_ON ? `    if (rInBox) { float gmk = max(smoothstep(uRoomGM.x, uRoomGM.y, vRoomWP.y), smoothstep(uRoomGM.z, uRoomGM.w, rbp.x));
      totalEmissiveRadiance *= mix(uRoomGL.x, uRoomGL.z, gmk); float gkr = mix(uRoomGL.y, 1.0, gmk);
      reflectedLight.directDiffuse *= gkr; reflectedLight.indirectDiffuse *= gkr; reflectedLight.directSpecular *= gkr; reflectedLight.indirectSpecular *= gkr; }
` : ''}    if (uRoomOn > 0.5 && rg.w > 0.01 && vRoomWP.y < rt.w) {
      float ny = normalize((vec4(normal, 0.0) * viewMatrix).xyz).y;
      float ce = smoothstep(0.5, 0.8, -ny) * smoothstep(1.3, 1.7, vRoomWP.y), fl = smoothstep(0.5, 0.8, ny) * (1.0 - smoothstep(1.3, 1.7, vRoomWP.y));
      float g = mix(mix(rg.x, rg.y, ce), rg.z, fl);
      vec3 mk = (rInBox ? uRoomMK : vec3(1.0)) * (rInBox2 ? uRoomMK2 : vec3(1.0));
      for (int i = 0; i < ${ROOM_NZ}; i++) if (all(greaterThanEqual(rbp, uRoomZB[i].xy)) && all(lessThanEqual(rbp, uRoomZB[i].zw))) mk *= uRoomZK[i];
      // gate: material factors only between the given heights and, for uRoomZG.z > 0, from that room weight up
      float zgate = step(uRoomZG.x, vRoomWP.y) * step(vRoomWP.y, uRoomZG.y) * (uRoomZG.z > 0.0 ? smoothstep(uRoomZG.z, uRoomZG.z + 0.35, rg.w) : 1.0);
      vec3 k = mix(vec3(1.0), g * rt.rgb * mix(vec3(1.0), mk, zgate), clamp(rg.w, 0.0, 1.0));${CF1 ? `
      // ceilfix bit 1: corridor ceilings over a room's plan cells keep their own light (the room gain is for the interior)
      k = mix(k, vec3(1.0), uRoomCorr * smoothstep(0.5, 0.8, -ny) * smoothstep(2.3, 2.6, vRoomWP.y));` : ''}
      reflectedLight.directDiffuse *= k; reflectedLight.indirectDiffuse *= k;
      reflectedLight.directSpecular *= k; reflectedLight.indirectSpecular *= k;
${(globalThis.RR_FLAGS || {}).endfix ? `      // endfix (end agent 2, Oct 14): sheen is reflected light too, but three keeps it outside reflectedLight
      // (sheenSpecularDirect / Indirect, added after the lights), so no room gain or object factor ever reached it.
      // The Milos back bar panel (Mesh_2262, mil_stool_fabric, Sheen Weight 0.6) sits at Blender y 11.5 where the
      // depth falloff and the object factor bring its diffuse to about 0.03: its sheen of the corridor capture stayed at
      // full strength and is what reads 180 to 228 through the wine rack at B000 B071 B076 B077 B078 B082 nz (ref 46 to 55)
      #ifdef USE_SHEEN
      sheenSpecularDirect *= k; sheenSpecularIndirect *= k;
      #endif
` : ''}    }
  }
  #include <aomap_fragment>`);
      // cotegj (Oct 22): kx and em of an object entry (identity for every other material, uniform values only, no new program);
      // the uniform objects stay on the material (userData.roomU) so a look pass can tune them live
      { const ud = material.userData, U = ud.roomU || (ud.roomU = { mx: { value: new THREE.Vector3(1, 1, 1) }, em: { value: new THREE.Vector3(0, 0, 0) } });
        if (!ud.roomUSet) { ud.roomUSet = 1; if (mc && ud.roomObjCal) (globalThis.__rrRoomU || (globalThis.__rrRoomU = [])).push([ud.roomObjName || material.name, U]); const kx = mc && mc.kx != null ? mc.kx : 1; U.mx.value.set(...(Array.isArray(kx) ? kx : [kx, kx, kx])); if (mc && mc.em) U.em.value.set(...mc.em); }
        sh.uniforms.uRoomMX = U.mx; sh.uniforms.uRoomEM = U.em; if (sh.uniforms.uRoomCol) U.col = sh.uniforms.uRoomCol; U.mk = sh.uniforms.uRoomMK;
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uRoomMX; uniform vec3 uRoomEM;')
          .replace('#include <aomap_fragment>', `reflectedLight.directDiffuse *= uRoomMX; reflectedLight.indirectDiffuse *= uRoomMX;
    reflectedLight.directSpecular *= uRoomMX; reflectedLight.indirectSpecular *= uRoomMX; totalEmissiveRadiance += uRoomEM;
  #include <aomap_fragment>`); }
    };
    material.customProgramCacheKey = () => (prevKey ? prevKey.call(material) : '') + '|room2' + (SUG_MASK_ON ? 'gm' : '') + (((globalThis.RR_FLAGS || {}).ceilfix === true ? 15 : +((globalThis.RR_FLAGS || {}).ceilfix) || 0) & 1 ? 'cf' : '') + ((globalThis.RR_FLAGS || {}).endfix ? 's' : '') + ((material.userData.roomObjCal && (material.userData.roomObjCal.col || material.userData.roomObjCal.flat || material.userData.roomObjCal.planks || material.userData.roomObjCal.clipY != null)) ? '|mc' + (material.userData.roomObjCal.col || []).join(',') + (material.userData.roomObjCal.flat ? 'f' : '') + (material.userData.roomObjCal.planks ? 'p' + material.userData.roomObjCal.planks.join(',') : '') + (material.userData.roomObjCal.clipY != null ? 'y' + material.userData.roomObjCal.clipY.toFixed(4) : '') : '');
    material.needsUpdate = true;
  }
}
