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
export const ROOM_CAL_M54 = {
  delmonico: { g: [0.839, 0.589, 0.656], t: [1.018, 1.001, 0.935] },
  gjelina: { g: [0.916, 4, 0.438], t: [0.948, 0.998, 1.168] },
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
  Mesh_2262: { room: 'milos', k: [0.4, 0.4, 0.4], box: MIL_BOX },      // back bar shelving (mil_stool_fabric): ref 35 to 69 against 97 to 143, 0.31
  Mesh_2249: { room: 'milos', k: [0.55, 0.55, 0.55], box: MIL_BOX },   // back and side walls (Material_110), 0.54
  Mesh_2253: { room: 'milos', k: [0.65, 0.65, 0.65], box: MIL_BOX },   // dark wood trim (Material_107), 0.62
  Mesh_2265: { room: 'milos', k: [0.65, 0.65, 0.65], box: MIL_BOX },   // terracotta under the rack, 0.63
  Mesh_1647: { k: [1.35, 1.35, 1.35], box: MIL_BOX },   // no room gate: its bbox centre lands 1 cm outside the Milos mask (m80/m81: 0 hits); the shader still limits it to Milos cells   // white west wall (Material_617), 1.38
  Mesh_352: { room: 'milos', k: [1.4, 1.4, 1.4], box: MIL_BOX },       // white marble round bar front, 1.49
  mil_barpot0: { room: 'milos', k: [1.2, 1.2, 1.2], box: MIL_BOX }, mil_barpot1: { room: 'milos', k: [1.2, 1.2, 1.2], box: MIL_BOX }, // m80: 1.4/1.6 overshot at B082 nz // stone urns 1.49 / 2.0
  // endfix (fix86, Oct 14): Mesh_240, the 20.7 m photo quad behind the Milos back bar (Material_115: Image_14 feeds base
  // colour and emission 0.42). The room gain leaves emission untouched and Material_115 has no material entry, so it kept
  // its full glow: ray cast hits at B076 B077 B080 B081 B082 B084 nz read ref / m83 0.13 in linear (mean, 142 rays).
  // e scales its emission inside MIL_BOX (uRoomME, no new program); k its reflected light on top of the room gain.
  // Uncalibrated first guess, flags mil240e (default 0.2) and mil240k (default 1)
  ...((globalThis.RR_FLAGS || {}).endfix ? { Mesh_240: { room: 'milos', k: Array(3).fill(+((globalThis.RR_FLAGS || {}).mil240k ?? 1)), e: +((globalThis.RR_FLAGS || {}).mil240e ?? 0.2), box: MIL_BOX } } : {}),
};
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
    const FF = globalThis.RR_FLAGS || {}, dExp = +(FF.mildepth ?? 1.3), rackK = +(FF.milrack ?? 1), milX = +(FF.milx ?? -6); // m76 audit: rack shadow drew a dark block (off); west dining room x < -6 is bright in the 360s
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
    const clip = +((globalThis.RR_FLAGS || {}).roomclip ?? 0) ? this.clipToObjects(root) : null;
    // per object entries: a clone of the material for the matching meshes (one clone per material and entry)
    if (Object.keys(this.objCal).length) { const clones = new Map(), bb = new THREE.Box3(), cc = new THREE.Vector3(); root.updateMatrixWorld(true);
      root.traverse(o => { if (!o.isMesh || Array.isArray(o.material) || !o.material || !o.material.isMeshStandardMaterial) return;
        const nm = o.userData.invName || o.name, ent = this.objCal[nm]; if (!ent) return; const src = o.material;
        if ((src.transmission ?? 0) > 0 || src.userData.glassEmit || (src.transparent && !ent.tr)) return;
        // endfix: a piece of an object split for its size gates on the whole object's centre (rr2_player.js splitC), so
        // every piece keeps the entry (pieces whose own centre fell outside the Milos mask lost it)
        if (o.userData.splitC) cc.fromArray(o.userData.splitC); else { bb.setFromObject(o); bb.getCenter(cc); }
        if (ent.room && this.roomAt(cc.x, -cc.z) !== ent.room) return;
        const key = src.uuid + '|' + nm; let m = clones.get(key);
        if (!m) { const ud = src.userData; src.userData = {}; m = src.clone(); src.userData = ud; m.userData = { ...ud };
          m.defines = { ...src.defines }; m.onBeforeCompile = src.onBeforeCompile; m.customProgramCacheKey = src.customProgramCacheKey;
          m.userData.roomObjCal = ent; m.userData.roomObjName = nm; clones.set(key, m); }
        o.material = m; nObj++; this.objCalHits[nm] = (this.objCalHits[nm] || 0) + 1; }); }
    root.traverse(o => { if (!o.isMesh) return; for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
      if (!m || done.has(m) || !m.isMeshStandardMaterial || (m.transparent && !m.userData.roomObjCal) || (m.transmission ?? 0) > 0 || m.userData.glassEmit) continue; done.add(m); this.patch(m); n++; } });
    for (const v of this.id) if (v) cells++;
    return { materials: n, rooms: this.names.length, cells, grid: [this.W, this.H], objMeshes: nObj, objCal: this.objCalHits, ...(clip ? { roomclip: clip } : {}) };
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
      sh.uniforms.uRoomZB = { value: Array.from({ length: ROOM_NZ }, (_, i) => new THREE.Vector4(...(zs[i] ? zs[i].slice(0, 4) : [1, 1, -1, -1]))) };
      sh.uniforms.uRoomZK = { value: Array.from({ length: ROOM_NZ }, (_, i) => new THREE.Vector3(...(zs[i] ? zs[i].slice(4, 7) : [1, 1, 1]))) };
      sh.uniforms.uRoomZG = { value: new THREE.Vector3(...(mc && mc.zg ? mc.zg : [-1e4, 1e4, 0])) };
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
    };
    material.customProgramCacheKey = () => (prevKey ? prevKey.call(material) : '') + '|room2' + (SUG_MASK_ON ? 'gm' : '') + (((globalThis.RR_FLAGS || {}).ceilfix === true ? 15 : +((globalThis.RR_FLAGS || {}).ceilfix) || 0) & 1 ? 'cf' : '') + ((globalThis.RR_FLAGS || {}).endfix ? 's' : '');
    material.needsUpdate = true;
  }
}
