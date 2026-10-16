// Compile a Blender shader-node graph (as dumped by _claude_export_area.py) into GLSL that drives a three.js
// MeshPhysicalMaterial: base colour, roughness, metallic, normal (bump / normal map / displacement-as-bump),
// emission and alpha. Nodes evaluate with Blender's own algorithms (blender_nodes.glsl.js), in Blender's axes.
// Everything not linked to a node tree keeps the value the glTF exporter wrote.
import * as THREE from 'three';
import { BLENDER_NODES_GLSL, shakeBlenderGLSL } from './blender_nodes.glsl.js';

export const PRELUDE = /* glsl */ `
mat3 bl_euler(vec3 r) {
  float cx = cos(r.x), sx = sin(r.x), cy = cos(r.y), sy = sin(r.y), cz = cos(r.z), sz = sin(r.z);
  mat3 X = mat3(1, 0, 0, 0, cx, sx, 0, -sx, cx), Y = mat3(cy, 0, -sy, 0, 1, 0, sy, 0, cy), Z = mat3(cz, sz, 0, -sz, cz, 0, 0, 0, 1);
  return Z * Y * X;
}
vec3 bl_normal_map(vec3 N, vec3 P, vec2 uv, vec3 mapc, float strength) {
  vec3 m = mapc * 2.0 - 1.0;
  vec3 dp1 = dFdx(P), dp2 = dFdy(P); vec2 du1 = dFdx(uv), du2 = dFdy(uv);
  vec3 dp2perp = cross(dp2, N), dp1perp = cross(N, dp1);
  vec3 T = dp2perp * du1.x + dp1perp * du2.x, B = dp2perp * du1.y + dp1perp * du2.y;
  float invmax = inversesqrt(max(dot(T, T), dot(B, B)));
  if (invmax > 1e12) return N;
  vec3 nm = normalize(mat3(T * invmax, B * invmax, N) * m);
  return normalize(mix(N, nm, max(strength, 0.0)));
}
`;

// loop bound of the node library's noise and voronoi loops (blender_nodes.glsl.js shakeBlenderGLSL), always 1
export const BL_L1 = { value: 1 };
// alpha coverage switch shared by every cutout program (alphaCoverageGLSL): 1 in MSAA passes, 0 while FloorReflector
// draws its single sample mirror target. Alpha to coverage does nothing without MSAA, so the filtered alpha path wrote
// the holes of minified cutouts as solid surface there (m61 to m65: the Starbucks lattice mirrored as a dark brown slab
// and the corridor floor under it went from 216 172 132 to 189 141 94)
export const BL_A2C = { value: 1 };
const T = { F: 'f', C: 'c', V: 'v' };
function lit(v, t) {
  const f = (x) => { const s = (+x).toString(); return /[.eE]/.test(s) ? s : s + '.0'; };
  if (Array.isArray(v)) {
    if (t === T.F) return f(v.length >= 3 ? (v[0] + v[1] + v[2]) / 3 : v[0]);
    return `vec3(${f(v[0])}, ${f(v[1] ?? v[0])}, ${f(v[2] ?? v[0])})`;
  }
  if (typeof v === 'boolean') v = v ? 1 : 0;
  if (typeof v !== 'number' || !isFinite(v)) v = 0;
  return t === T.F ? f(v) : `vec3(${f(v)})`;
}
function conv(e, from, to) {
  if (from === to || (from !== T.F && to !== T.F)) return e;
  if (to === T.F) return from === T.C ? `bl_rgb_to_bw(${e})` : `((${e}).x + (${e}).y + (${e}).z) / 3.0`;
  return `vec3(${e})`;
}
// output socket types per node type
const OUT_T = {
  TEX_COORD: T.V, UVMAP: T.V, NEW_GEOMETRY: T.V, MAPPING: T.V, COMBXYZ: T.V, VECT_MATH: { Value: T.F, Vector: T.V },
  TEX_NOISE: { Fac: T.F, Color: T.C }, TEX_WAVE: { Fac: T.F, Color: T.C }, TEX_BRICK: { Fac: T.F, Color: T.C },
  TEX_WHITE_NOISE: { Value: T.F, Color: T.C }, TEX_VORONOI: { Distance: T.F, Color: T.C, Position: T.V }, TEX_GRADIENT: { Fac: T.F, Color: T.C },
  TEX_IMAGE: { Color: T.C, Alpha: T.F }, MATH: T.F, MAP_RANGE: { Result: T.F, Vector: T.V }, VALTORGB: { Color: T.C, Alpha: T.F },
  RGBTOBW: T.F, COMBINE_COLOR: T.C, SEPARATE_COLOR: T.F, SEPXYZ: T.F, HUE_SAT: T.C, INVERT: T.C, BRIGHTCONTRAST: T.C,
  BLACKBODY: T.C, CURVE_RGB: T.C, VALUE: T.F, RGB: T.C, LAYER_WEIGHT: T.F, LIGHT_PATH: T.F, BUMP: T.V, NORMAL_MAP: T.V,
  DISPLACEMENT: T.V, OBJECT_INFO: { Random: T.F, Location: T.V, Color: T.C, Alpha: T.F }, MIX_RGB: T.C, GAMMA: T.C, CLAMP: T.F,
};
function outType(node, sock) {
  if (node.type === 'MIX') return sock.startsWith('Result_Float') ? T.F : sock.startsWith('Result_Vector') ? T.V : T.C;
  const o = OUT_T[node.type]; if (!o) return T.F;
  return typeof o === 'string' ? o : (o[sock] ?? T.F);
}
// Blender's default socket values, for sockets whose link Cycles drops (see input()): Mix Factor 0.5 and colours 0.5 grey,
// Color Ramp Fac 0.5, Invert Color black, Math values 0.5
const DROPPED_DEFAULT = { MIX: { Factor_Float: 0.5, A_Color: [0.5, 0.5, 0.5], B_Color: [0.5, 0.5, 0.5], A_Float: 0, B_Float: 0 }, MIX_RGB: { Fac: 0.5, Color1: [0.5, 0.5, 0.5], Color2: [0.5, 0.5, 0.5] },
  VALTORGB: { Fac: 0.5 }, INVERT: { Color: [0, 0, 0] }, MATH: { Value: 0.5, Value_001: 0.5, Value_002: 0.5 }, RGBTOBW: { Color: [0.5, 0.5, 0.5] }, HUE_SAT: { Color: [0.8, 0.8, 0.8] } };
// colour or value nodes (every node with a known non closure output): one of them linked into a shader socket is turned
// into an Emission shader by Cycles (shader_graph.cpp ShaderGraph::connect: colour into Color, value into Strength)
const isValueNode = (t) => !!OUT_T[t] || t === 'MIX';
const COORD_DEFAULT = { TEX_NOISE: 'vBlGen', TEX_WAVE: 'vBlGen', TEX_BRICK: 'vBlGen', TEX_VORONOI: 'vBlGen', TEX_GRADIENT: 'vBlGen', TEX_WHITE_NOISE: 'vBlGen', TEX_IMAGE: 'vec3(blUV, 0.0)', MAPPING: 'vBlGen' };

// a graph (or one of its groups) with a Distance to Edge or non Euclidean voronoi node
function hasExactVoronoi(g) {
  return (g?.nodes || []).some(n => (n.type === 'TEX_VORONOI' && ((n.feature && n.feature !== 'F1') || (n.distance && n.distance !== 'EUCLIDEAN'))) || (n.group_graph && hasExactVoronoi(n.group_graph)));
}

export class BlenderMaterialCompiler {
  constructor(mat, imageLookup) {
    this.mat = mat; this.imageLookup = imageLookup; this.lines = []; this.memo = new Map(); this.n = 0;
    this.uniforms = {}; this.notes = []; this.texCount = 0; this.texByName = new Map();
    this.samples = []; // every image sample: { s: result vec4, u: sampler uniform, uv: vec2 variable }, for the alpha coverage below
  }
  v(prefix = 'b') { return `${prefix}${this.n++}`; }
  link(g, node, sock) { return g.links.find(l => l[2] === node && l[3] === sock); }
  nodeOf(g, name) { return g.nodes.find(n => n.name === name); }
  // value of an input socket, converted to type t
  input(g, scope, node, sock, t, fallback) {
    const l = this.link(g, node.name, sock);
    if (l) { const r = this.out(g, scope, l[0], l[1]);
      // a link from a node Cycles does not build (Shader to RGB is EEVEE only): Cycles drops the link and the socket keeps
      // its own value. The export leaves linked sockets' values out, so Blender's node default stands in for it.
      if (r && r.dropped) { const dv = DROPPED_DEFAULT[node.type]?.[sock]; return dv !== undefined ? lit(dv, t) : fallback !== undefined ? fallback : lit(0, t); }
      return r ? conv(r.e, r.t, t) : lit(0, t); }
    if (node.in && sock in node.in) return lit(node.in[sock], t);
    if (fallback !== undefined) return fallback;
    return lit(0, t);
  }
  linked(g, node, sock) { return !!this.link(g, node.name, sock); }
  // expression for an output socket
  out(g, scope, nodeName, sock) {
    const key = scope.id + '/' + nodeName + '/' + sock;
    if (this.memo.has(key)) return this.memo.get(key);
    const node = this.nodeOf(g, nodeName);
    if (!node) return null;
    let r = this.emit(g, scope, node, sock);
    if (r && typeof r === 'string') r = { e: r, t: outType(node, sock) };
    this.memo.set(key, r);
    return r;
  }
  decl(t, expr) { const name = this.v(); this.lines.push(`${t === T.F ? 'float' : 'vec3'} ${name} = ${expr};`); return name; }
  texture(name, nodeAttrs) {
    if (this.texByName.has(name)) return this.texByName.get(name);
    const u = `blTex${this.texCount++}`; const tex = this.imageLookup(name, nodeAttrs);
    if (!tex) { this.notes.push('missing image ' + name); console.warn(`[blender_material] ${this.mat?.name || 'material'}: image "${name}" is missing, using the base colour (or a neutral value for data images) instead`); this.texByName.set(name, null); return null; }
    this.uniforms[u] = { value: tex }; this.texByName.set(name, u); return u;
  }
  emit(g, scope, n, sock) {
    const I = (s, t, fb) => this.input(g, scope, n, s, t, fb);
    const vec = (s = 'Vector') => this.linked(g, n, s) ? I(s, T.V) : (COORD_DEFAULT[n.type] ?? 'vBlGen');
    switch (n.type) {
      case 'REROUTE': { const l = this.link(g, n.name, 'Input'); return l ? this.out(g, scope, l[0], l[1]) : { e: '0.0', t: T.F }; }
      // EEVEE only node: Cycles has no such node (blender/shader.cpp add_node), so whatever reads it keeps its own default
      case 'SHADERTORGB': return { e: '0.0', t: T.F, dropped: true };
      case 'TEX_COORD': return { Object: 'vBlObj', Generated: 'vBlGen', UV: 'vec3(blUV, 0.0)', Normal: 'blN', Camera: 'blI', Window: 'vec3(0.0)', Reflection: 'reflect(-blI, blN)' }[sock] ?? 'vBlGen';
      case 'UVMAP': return 'vec3(blUV, 0.0)';
      case 'NEW_GEOMETRY': return { Position: 'vBlWP', Normal: 'blN', True_Normal: 'blN', Incoming: 'blI', Tangent: 'vec3(1.0, 0.0, 0.0)' }[sock] ?? 'vBlWP';
      case 'OBJECT_INFO': return { Random: { e: 'vBlRand', t: T.F }, Location: { e: 'vec3(0.0)', t: T.V }, Color: { e: 'vec3(1.0)', t: T.C }, Alpha: { e: '1.0', t: T.F } }[sock] ?? { e: '0.0', t: T.F };
      case 'LIGHT_PATH': return { e: sock === 'Is Camera Ray' ? '1.0' : '0.0', t: T.F };
      case 'VALUE': return { e: lit((n.out && (n.out.Value ?? Object.values(n.out)[0])) ?? 0.5, T.F), t: T.F };
      case 'RGB': return { e: lit((n.out && (n.out.Color ?? Object.values(n.out)[0])) ?? [0.5, 0.5, 0.5], T.C), t: T.C };
      case 'MAPPING': {
        const v = vec(), L = I('Location', T.V), Rr = I('Rotation', T.V), S = I('Scale', T.V); const vt = n.vector_type || 'POINT';
        const e = vt === 'TEXTURE' ? `(transpose(bl_euler(${Rr})) * (${v} - ${L})) / ${S}` : vt === 'VECTOR' ? `bl_euler(${Rr}) * (${v} * ${S})` : vt === 'NORMAL' ? `normalize(bl_euler(${Rr}) * (${v} / ${S}))` : `bl_euler(${Rr}) * (${v} * ${S}) + ${L}`;
        return { e: this.decl(T.V, e), t: T.V };
      }
      case 'TEX_NOISE': {
        if ((n.noise_dimensions && n.noise_dimensions !== '3D') || (n.noise_type && n.noise_type !== 'FBM')) this.notes.push(`noise ${n.noise_dimensions}/${n.noise_type} evaluated as 3D fBM`);
        const f = this.v(), c = this.v(); const wantC = sock === 'Color';
        const key = scope.id + '/' + n.name;
        const done = this.memo.get(key + '#noise');
        if (done) return sock === 'Color' ? { e: done.c, t: T.C } : { e: done.f, t: T.F };
        // noisespec (RR_FLAGS.noisespec = 1, load time A/B): every Noise Texture in the export is 3D fBM, almost all with
        // Distortion 0 and all with an integer Detail, neither linked. Hoisted into blK those two are opaque to D3D's
        // compiler, so each noise site keeps the distortion branch (3 more snoise) and the fractional octave (one more
        // snoise, and an fbm per colour channel). A specialised call is emitted instead: _nd without the distortion branch
        // when Distortion is unlinked and 0, _i (integer Detail, no fractional octave) when Detail is unlinked and whole.
        // Detail itself stays in blK, so graphs that differ only in Detail still share one program.
        const NS = (globalThis.RR_FLAGS || {}).noisespec, dIn = n.in || {};
        const nd = NS && !this.linked(g, n, 'Distortion') && (dIn.Distortion ?? 0) === 0, ni = NS && !this.linked(g, n, 'Detail') && Number.isInteger(dIn.Detail ?? 2);
        if (nd || ni) { this.lines.push(`float ${f}; vec3 ${c}; bl_tex_noise_fbm3${nd ? '_nd' : '_d'}${ni ? 'i' : ''}(${vec()}, ${I('Scale', T.F)}, ${I('Detail', T.F)}, ${I('Roughness', T.F)}, ${I('Lacunarity', T.F)}${nd ? '' : ', ' + I('Distortion', T.F)}, ${n.normalize === false ? 'false' : 'true'}, ${this.usesSock(g, n, 'Color') ? 'true' : 'false'}, ${f}, ${c});`);
          this.memo.set(key + '#noise', { f, c }); return wantC ? { e: c, t: T.C } : { e: f, t: T.F }; }
        this.lines.push(`float ${f}; vec3 ${c}; bl_tex_noise_fbm3(${vec()}, ${I('Scale', T.F)}, ${I('Detail', T.F)}, ${I('Roughness', T.F)}, ${I('Lacunarity', T.F)}, ${I('Distortion', T.F)}, ${n.normalize === false ? 'false' : 'true'}, ${this.usesSock(g, n, 'Color') ? 'true' : 'false'}, ${f}, ${c});`);
        this.memo.set(key + '#noise', { f, c });
        return wantC ? { e: c, t: T.C } : { e: f, t: T.F };
      }
      case 'TEX_WAVE': {
        const wt = n.wave_type === 'RINGS' ? 1 : 0, bd = { X: 0, Y: 1, Z: 2, DIAGONAL: 3 }[n.bands_direction] ?? 0, rd = { X: 0, Y: 1, Z: 2, SPHERICAL: 3 }[n.rings_direction] ?? 0, pr = { SIN: 0, SAW: 1, TRI: 2 }[n.wave_profile] ?? 0;
        const f = this.decl(T.F, `bl_tex_wave(${vec()}, ${I('Scale', T.F)}, ${I('Distortion', T.F)}, ${I('Detail', T.F)}, ${I('Detail Scale', T.F)}, ${I('Detail Roughness', T.F)}, ${I('Phase Offset', T.F)}, ${wt}, ${bd}, ${rd}, ${pr})`);
        return sock === 'Color' ? { e: `vec3(${f})`, t: T.C } : { e: f, t: T.F };
      }
      case 'TEX_BRICK': {
        const c = this.v(), f = this.v();
        this.lines.push(`vec3 ${c}; float ${f}; bl_tex_brick(${vec()}, ${I('Color1', T.C)}, ${I('Color2', T.C)}, ${I('Mortar', T.C)}, ${I('Scale', T.F)}, ${I('Mortar Size', T.F)}, ${I('Mortar Smooth', T.F)}, ${I('Bias', T.F)}, ${I('Brick Width', T.F)}, ${I('Row Height', T.F)}, ${lit(n.offset ?? 0.5, T.F)}, ${lit(n.offset_frequency ?? 2, T.F)}, ${lit(n.squash ?? 1, T.F)}, ${lit(n.squash_frequency ?? 2, T.F)}, ${c}, ${f});`);
        return sock === 'Color' ? { e: c, t: T.C } : { e: f, t: T.F };
      }
      case 'TEX_WHITE_NOISE': { const v = this.v(), c = this.v(); const dim = n.noise_dimensions || '3D';
        // 1D noise is driven by W alone (per plank tones from floor(u / 0.16) in nk_walnut, rr_del_door_oak); hashing the
        // 3D generated coordinate instead gave every pixel its own value, grain turned to static (material audit, Oct 13)
        const arg = dim === '1D' ? `vec3(${I('W', T.F)}, 0.0, 0.0)` : dim === '2D' ? `vec3((${vec()}).xy, 0.0)` : dim === '4D' ? `(${vec()} + vec3(${I('W', T.F)} * 1.618))` : vec();
        this.lines.push(`float ${v}; vec3 ${c}; bl_tex_white3(${arg}, ${v}, ${c});`); return sock === 'Color' ? { e: c, t: T.C } : { e: v, t: T.F }; }
      case 'TEX_VORONOI': {
        // graphs with a Distance to Edge or non Euclidean voronoi (pm_mosaic_champagne: Chebychev tiles plus their grout
        // from Distance to Edge; del_stone: F1 cells plus Distance to Edge joints) take Blender 5.0's own voronoi for every
        // voronoi node, so cells and edges come from one hash and line up. Before, both were drawn as F1 Euclidean, so the
        // grout test (edge distance > 0.06) ran on the distance to the cell centre and drew dots instead of joints.
        if (this.vorExact) {
          const feat = { F1: 0, DISTANCE_TO_EDGE: 3 }[n.feature || 'F1'], met = { EUCLIDEAN: 0, MANHATTAN: 1, CHEBYCHEV: 2, MINKOWSKI: 3 }[n.distance || 'EUCLIDEAN'] ?? 0;
          if (feat === undefined) this.notes.push(`voronoi ${n.feature} evaluated as F1`);
          if ((n.voronoi_dimensions && n.voronoi_dimensions !== '3D')) this.notes.push(`voronoi ${n.voronoi_dimensions} evaluated as 3D`);
          const det = n.in?.Detail, rgh = n.in?.Roughness; if ((this.linked(g, n, 'Detail') || (det ?? 0) > 0) && (this.linked(g, n, 'Roughness') || (rgh ?? 0.5) > 0)) this.notes.push('voronoi detail above 0 evaluated as one octave');
          const d = this.v(), c = this.v(), p = this.v();
          this.lines.push(`float ${d}; vec3 ${c}; vec3 ${p}; bl_voronoi3(${vec()}, ${I('Scale', T.F)}, ${I('Randomness', T.F, '1.0')}, ${I('Exponent', T.F, '0.5')}, ${met}, ${feat ?? 0}, ${n.normalize ? 'true' : 'false'}, ${d}, ${c}, ${p});`);
          return sock === 'Color' ? { e: c, t: T.C } : sock === 'Position' ? { e: p, t: T.V } : { e: d, t: T.F };
        }
        if ((n.feature && n.feature !== 'F1') || (n.distance && n.distance !== 'EUCLIDEAN')) this.notes.push(`voronoi ${n.feature}/${n.distance} evaluated as F1 euclidean`);
        const d = this.v(), c = this.v(), p = this.v();
        this.lines.push(`float ${d}; vec3 ${c}; vec3 ${p}; bl_voronoi_f1_3d(${vec()}, ${I('Scale', T.F)}, ${I('Randomness', T.F, '1.0')}, ${d}, ${c}, ${p});`);
        return sock === 'Color' ? { e: c, t: T.C } : sock === 'Position' ? { e: p, t: T.V } : { e: d, t: T.F };
      }
      case 'TEX_GRADIENT': {
        const v = this.decl(T.V, vec()); const gt = n.gradient_type || 'LINEAR';
        const e = { LINEAR: `${v}.x`, QUADRATIC: `pow(max(${v}.x, 0.0), 2.0)`, EASING: `smoothstep(0.0, 1.0, clamp(${v}.x, 0.0, 1.0))`, DIAGONAL: `(${v}.x + ${v}.y) * 0.5`, RADIAL: `atan(${v}.y, ${v}.x) / (2.0 * BL_PI) + 0.5`, QUADRATIC_SPHERE: `pow(max(1.0 - length(${v}), 0.0), 2.0)`, SPHERICAL: `max(1.0 - length(${v}), 0.0)` }[gt];
        const f = this.decl(T.F, `clamp(${e}, 0.0, 1.0)`); return sock === 'Color' ? { e: `vec3(${f})`, t: T.C } : { e: f, t: T.F };
      }
      case 'TEX_IMAGE': {
        const u = this.texture(n.image, n);
        // a missing image used to draw Cycles' magenta. Fall back to what the surface would be without it: a colour image
        // gives the material's own base colour (three's diffuse uniform, which the glTF export filled from the Principled
        // Base Color), a normal map image gives a flat normal, other data images a neutral 0.5
        if (!u) {
          if (sock === 'Alpha') return { e: '1.0', t: T.F };
          const toNormalMap = g.links.some(l => l[0] === n.name && l[1] === 'Color' && this.nodeOf(g, l[2])?.type === 'NORMAL_MAP');
          return { e: toNormalMap ? 'vec3(0.5, 0.5, 1.0)' : n.cs === 'Non-Color' ? 'vec3(0.5)' : 'diffuse', t: T.C };
        }
        const key = scope.id + '/' + n.name + '#img';
        let s = this.memo.get(key);
        if (!s) { s = this.v();
          if (n.projection === 'BOX') {
            // Cycles box projection (svm_node_tex_image_box, blend 0): the face is chosen by the dominant normal axis.
            // Sampling .xy on every face streaked the stone piers, door jambs and walnut headers (material audit, Oct 13).
            const c = this.v('c'), an = this.v('n'), uv = this.v('u');
            this.lines.push(`vec3 ${c} = ${vec()}; vec3 ${an} = abs(blN); vec2 ${uv} = (${an}.x >= ${an}.y && ${an}.x >= ${an}.z) ? vec2(blN.x < 0.0 ? 1.0 - ${c}.y : ${c}.y, ${c}.z) : (${an}.y >= ${an}.z ? vec2(blN.y > 0.0 ? 1.0 - ${c}.x : ${c}.x, ${c}.z) : vec2(blN.z > 0.0 ? 1.0 - ${c}.y : ${c}.y, ${c}.x));`);
            this.lines.push(`vec4 ${s} = texture2D(${u}, ${uv});`); this.samples.push({ s, u, uv });
          } else { const uv = s + '_uv'; this.lines.push(`vec2 ${uv} = (${vec()}).xy; vec4 ${s} = texture2D(${u}, ${uv});`); this.samples.push({ s, u, uv }); }
          this.memo.set(key, s); }
        return sock === 'Alpha' ? { e: `${s}.a`, t: T.F } : { e: `${s}.rgb`, t: T.C };
      }
      case 'MATH': {
        const a = I('Value', T.F), b = I('Value_001', T.F), c = I('Value_002', T.F); const op = n.operation;
        const E = {
          ADD: `${a} + ${b}`, SUBTRACT: `${a} - ${b}`, MULTIPLY: `${a} * ${b}`, DIVIDE: `bl_safe_div(${a}, ${b})`, MULTIPLY_ADD: `${a} * ${b} + ${c}`,
          POWER: `bl_safe_pow(${a}, ${b})`, LOGARITHM: `bl_safe_log(${a}, ${b})`, SQRT: `bl_safe_sqrt(${a})`, INVERSE_SQRT: `(${a} > 0.0 ? inversesqrt(${a}) : 0.0)`, ABSOLUTE: `abs(${a})`, EXPONENT: `exp(${a})`,
          MINIMUM: `min(${a}, ${b})`, MAXIMUM: `max(${a}, ${b})`, LESS_THAN: `(${a} < ${b} ? 1.0 : 0.0)`, GREATER_THAN: `(${a} > ${b} ? 1.0 : 0.0)`, SIGN: `sign(${a})`,
          COMPARE: `(abs(${a} - ${b}) <= max(${c}, 1e-5) ? 1.0 : 0.0)`, SMOOTH_MIN: `bl_smoothmin(${a}, ${b}, ${c})`, SMOOTH_MAX: `-bl_smoothmin(-${a}, -${b}, ${c})`,
          ROUND: `floor(${a} + 0.5)`, FLOOR: `floor(${a})`, CEIL: `ceil(${a})`, TRUNC: `trunc(${a})`, FRACT: `fract(${a})`, MODULO: `bl_compat_mod(${a}, ${b})`, FLOORED_MODULO: `bl_safe_mod(${a}, ${b})`,
          WRAP: `bl_wrap(${a}, ${b}, ${c})`, SNAP: `(${b} != 0.0 ? floor(${a} / ${b}) * ${b} : 0.0)`, PINGPONG: `bl_pingpong(${a}, ${b})`,
          SINE: `sin(${a})`, COSINE: `cos(${a})`, TANGENT: `tan(${a})`, ARCSINE: `asin(clamp(${a}, -1.0, 1.0))`, ARCCOSINE: `acos(clamp(${a}, -1.0, 1.0))`, ARCTANGENT: `atan(${a})`, ARCTAN2: `atan(${a}, ${b})`,
          SINH: `sinh(${a})`, COSH: `cosh(${a})`, TANH: `tanh(${a})`, RADIANS: `radians(${a})`, DEGREES: `degrees(${a})`,
        }[op];
        if (!E) this.notes.push('math op ' + op);
        const e = E ?? a; return { e: this.decl(T.F, n.use_clamp ? `clamp(${e}, 0.0, 1.0)` : e), t: T.F };
      }
      case 'VECT_MATH': {
        const a = I('Vector', T.V), b = I('Vector_001', T.V), c = I('Vector_002', T.V), s = I('Scale', T.F, '1.0'); const op = n.operation;
        const V = { ADD: `${a} + ${b}`, SUBTRACT: `${a} - ${b}`, MULTIPLY: `${a} * ${b}`, DIVIDE: `bl_safe_div3(${a}, ${b})`, MULTIPLY_ADD: `${a} * ${b} + ${c}`, CROSS_PRODUCT: `cross(${a}, ${b})`,
          SCALE: `${a} * ${s}`, NORMALIZE: `(length(${a}) > 0.0 ? normalize(${a}) : vec3(0.0))`, ABSOLUTE: `abs(${a})`, MINIMUM: `min(${a}, ${b})`, MAXIMUM: `max(${a}, ${b})`, FLOOR: `floor(${a})`, CEIL: `ceil(${a})`,
          FRACTION: `fract(${a})`, MODULO: `vec3(bl_compat_mod(${a}.x, ${b}.x), bl_compat_mod(${a}.y, ${b}.y), bl_compat_mod(${a}.z, ${b}.z))`, SNAP: `floor(bl_safe_div3(${a}, ${b})) * ${b}`,
          SINE: `sin(${a})`, COSINE: `cos(${a})`, TANGENT: `tan(${a})`, REFLECT: `reflect(${a}, normalize(${b}))`, PROJECT: `(dot(${b}, ${b}) > 0.0 ? ${b} * dot(${a}, ${b}) / dot(${b}, ${b}) : vec3(0.0))` }[op];
        const F = { DOT_PRODUCT: `dot(${a}, ${b})`, DISTANCE: `distance(${a}, ${b})`, LENGTH: `length(${a})` }[op];
        if (F) return sock === 'Value' ? { e: this.decl(T.F, F), t: T.F } : { e: 'vec3(0.0)', t: T.V };
        if (!V) this.notes.push('vector math op ' + op);
        return sock === 'Value' ? { e: '0.0', t: T.F } : { e: this.decl(T.V, V ?? a), t: T.V };
      }
      case 'MAP_RANGE': {
        const mode = { LINEAR: 0, STEPPED: 1, SMOOTHSTEP: 2, SMOOTHERSTEP: 3 }[n.interpolation_type] ?? 0;
        const cl = n.clamp !== false;
        if (n.data_type === 'FLOAT_VECTOR') {
          const v = I('Vector', T.V); const r = this.v(); const f = (s) => I(s + '_FLOAT3', T.V, I(s, T.V));
          this.lines.push(`vec3 ${r} = vec3(${[0, 1, 2].map(k => `bl_map_range((${v})[${k}], (${f('From_Min')})[${k}], (${f('From_Max')})[${k}], (${f('To_Min')})[${k}], (${f('To_Max')})[${k}], 4.0, ${mode}, ${cl})`).join(', ')});`);
          return { e: r, t: T.V };
        }
        return { e: this.decl(T.F, `bl_map_range(${I('Value', T.F)}, ${I('From Min', T.F, I('From_Min', T.F, '0.0'))}, ${I('From Max', T.F, I('From_Max', T.F, '1.0'))}, ${I('To Min', T.F, I('To_Min', T.F, '0.0'))}, ${I('To Max', T.F, I('To_Max', T.F, '1.0'))}, ${I('Steps', T.F, '4.0')}, ${mode}, ${cl})`), t: T.F };
      }
      case 'VALTORGB': {
        const f = this.decl(T.F, `clamp(${I('Fac', T.F)}, 0.0, 1.0)`); const r = n.ramp || { interp: 'LINEAR', stops: [[0, [0, 0, 0, 1]], [1, [1, 1, 1, 1]]] };
        const st = [...r.stops].sort((a, b) => a[0] - b[0]); const c = this.v(), a = this.v();
        const col = (s) => `vec4(${s[1].map(x => lit(x, T.F)).join(', ')})`;
        let code = `vec4 ${c}_4 = ${col(st[0])};`;
        for (let i = 1; i < st.length; i++) {
          const p0 = st[i - 1][0], p1 = st[i][0];
          if (r.interp === 'CONSTANT') code += ` if (${f} >= ${lit(p1, T.F)}) ${c}_4 = ${col(st[i])};`;
          else {
            const t = p1 > p0 ? `clamp((${f} - ${lit(p0, T.F)}) / ${lit(p1 - p0, T.F)}, 0.0, 1.0)` : '1.0';
            const tt = r.interp === 'EASE' ? `smoothstep(0.0, 1.0, ${t})` : t;
            code += ` if (${f} > ${lit(p0, T.F)}) ${c}_4 = mix(${col(st[i - 1])}, ${col(st[i])}, ${tt});`;
          }
        }
        this.lines.push(code); this.lines.push(`vec3 ${c} = ${c}_4.rgb; float ${a} = ${c}_4.a;`);
        if (r.interp === 'B_SPLINE' || r.interp === 'CARDINAL') this.notes.push('color ramp ' + r.interp + ' evaluated linear');
        return sock === 'Alpha' ? { e: a, t: T.F } : { e: c, t: T.C };
      }
      case 'RGBTOBW': return this.decl(T.F, `bl_rgb_to_bw(${I('Color', T.C)})`);
      case 'COMBINE_COLOR': { const e = `vec3(${I('Red', T.F)}, ${I('Green', T.F)}, ${I('Blue', T.F)})`; return { e: this.decl(T.C, n.mode === 'HSV' ? `bl_hsv_to_rgb(${e})` : e), t: T.C }; }
      case 'COMBXYZ': return { e: this.decl(T.V, `vec3(${I('X', T.F)}, ${I('Y', T.F)}, ${I('Z', T.F)})`), t: T.V };
      case 'SEPARATE_COLOR': { const c = this.decl(T.C, n.mode === 'HSV' ? `bl_rgb_to_hsv(${I('Color', T.C)})` : I('Color', T.C)); return { e: `${c}.${{ Red: 'r', Green: 'g', Blue: 'b' }[sock] ?? 'r'}`, t: T.F }; }
      case 'SEPXYZ': { const c = this.decl(T.V, I('Vector', T.V)); return { e: `${c}.${{ X: 'x', Y: 'y', Z: 'z' }[sock] ?? 'x'}`, t: T.F }; }
      case 'HUE_SAT': return { e: this.decl(T.C, `bl_hue_sat(${I('Hue', T.F, '0.5')}, ${I('Saturation', T.F, '1.0')}, ${I('Value', T.F, '1.0')}, ${I('Fac', T.F, '1.0')}, ${I('Color', T.C)})`), t: T.C };
      case 'INVERT': { const c = I('Color', T.C); return { e: this.decl(T.C, `mix(${c}, vec3(1.0) - ${c}, ${I('Fac', T.F, '1.0')})`), t: T.C }; }
      case 'BRIGHTCONTRAST': return { e: this.decl(T.C, `bl_bright_contrast(${I('Color', T.C)}, ${I('Bright', T.F)}, ${I('Contrast', T.F)})`), t: T.C };
      case 'GAMMA': return { e: this.decl(T.C, `pow(max(${I('Color', T.C)}, vec3(0.0)), vec3(${I('Gamma', T.F, '1.0')}))`), t: T.C };
      case 'CLAMP': return { e: this.decl(T.F, `clamp(${I('Value', T.F)}, ${I('Min', T.F, '0.0')}, ${I('Max', T.F, '1.0')})`), t: T.F };
      case 'BLACKBODY': return { e: this.decl(T.C, `bl_blackbody(${I('Temperature', T.F, '1500.0')})`), t: T.C };
      case 'CURVE_RGB': {
        const c = this.decl(T.C, I('Color', T.C)); const cv = n.curves || [];
        const fn = (pts, x) => { if (!pts || pts.length < 2) return x; let e = lit(pts[0][1], T.F); for (let i = 1; i < pts.length; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; e = `(${x} > ${lit(x0, T.F)} ? mix(${lit(y0, T.F)}, ${lit(y1, T.F)}, clamp((${x} - ${lit(x0, T.F)}) / ${lit(Math.max(x1 - x0, 1e-6), T.F)}, 0.0, 1.0)) : ${e})`; } return e; };
        const ch = (k) => fn(cv[k], fn(cv[3], `${c}.${'rgb'[k]}`));
        this.notes.push('rgb curves evaluated piecewise linear');
        return { e: this.decl(T.C, `mix(${c}, vec3(${ch(0)}, ${ch(1)}, ${ch(2)}), ${I('Fac', T.F, '1.0')})`), t: T.C };
      }
      case 'LAYER_WEIGHT': { const w = this.v(); this.lines.push(`vec2 ${w} = bl_layer_weight(${I('Blend', T.F, '0.5')}, ${this.linked(g, n, 'Normal') ? I('Normal', T.V) : 'blN'}, blI);`); return { e: sock === 'Facing' ? `${w}.y` : `${w}.x`, t: T.F }; }
      case 'MIX':
      case 'MIX_RGB': {
        const legacy = n.type === 'MIX_RGB'; const dt = legacy ? 'RGBA' : (n.data_type || 'RGBA');
        if (dt === 'FLOAT') return { e: this.decl(T.F, `mix(${I('A_Float', T.F)}, ${I('B_Float', T.F)}, clamp(${I('Factor_Float', T.F, '0.5')}, 0.0, 1.0))`), t: T.F };
        if (dt === 'VECTOR') return { e: this.decl(T.V, `mix(${I('A_Vector', T.V)}, ${I('B_Vector', T.V)}, clamp(${I('Factor_Float', T.F, '0.5')}, 0.0, 1.0))`), t: T.V };
        const f = this.decl(T.F, `clamp(${legacy ? I('Fac', T.F, '0.5') : I('Factor_Float', T.F, '0.5')}, 0.0, 1.0)`);
        const a = this.decl(T.C, legacy ? I('Color1', T.C) : I('A_Color', T.C)), b = this.decl(T.C, legacy ? I('Color2', T.C) : I('B_Color', T.C));
        const bt = n.blend_type || 'MIX';
        const E = { MIX: `mix(${a}, ${b}, ${f})`, MULTIPLY: `mix(${a}, ${a} * ${b}, ${f})`, ADD: `mix(${a}, ${a} + ${b}, ${f})`, SUBTRACT: `mix(${a}, ${a} - ${b}, ${f})`,
          SCREEN: `vec3(1.0) - (vec3(1.0 - ${f}) + ${f} * (vec3(1.0) - ${b})) * (vec3(1.0) - ${a})`, DIVIDE: `mix(${a}, bl_safe_div3(${a}, ${b}), ${f})`, DIFFERENCE: `mix(${a}, abs(${a} - ${b}), ${f})`,
          EXCLUSION: `max(mix(${a}, ${a} + ${b} - 2.0 * ${a} * ${b}, ${f}), vec3(0.0))`, DARKEN: `mix(${a}, min(${a}, ${b}), ${f})`, LIGHTEN: `mix(${a}, max(${a}, ${b}), ${f})`,
          OVERLAY: `bl_mix_overlay(${f}, ${a}, ${b})`, DODGE: `bl_mix_dodge(${f}, ${a}, ${b})`, BURN: `bl_mix_burn(${f}, ${a}, ${b})`, SOFT_LIGHT: `bl_mix_soft(${f}, ${a}, ${b})`, LINEAR_LIGHT: `bl_mix_linear(${f}, ${a}, ${b})`,
          COLOR: `bl_mix_color(${f}, ${a}, ${b})`, HUE: `bl_mix_hue(${f}, ${a}, ${b})`, SATURATION: `bl_mix_sat(${f}, ${a}, ${b})`, VALUE: `bl_mix_val(${f}, ${a}, ${b})` }[bt];
        if (!E) this.notes.push('blend ' + bt);
        const clampRes = legacy ? n.use_clamp : n.clamp_result;
        const e = E ?? `mix(${a}, ${b}, ${f})`;
        return { e: this.decl(T.C, clampRes ? `clamp(${e}, 0.0, 1.0)` : e), t: T.C };
      }
      case 'BUMP': {
        const h = this.decl(T.F, I('Height', T.F));
        return { e: this.decl(T.V, `bl_bump(${I('Strength', T.F, '1.0')}, ${I('Distance', T.F, '1.0')}, ${I('Filter Width', T.F, '0.1')}, ${h}, ${this.linked(g, n, 'Normal') ? I('Normal', T.V) : 'blN'}, vBlWP, ${n.invert ? 'true' : 'false'})`), t: T.V };
      }
      case 'NORMAL_MAP': {
        if (n.space && n.space !== 'TANGENT') this.notes.push('normal map space ' + n.space + ' treated as tangent');
        return { e: this.decl(T.V, `bl_normal_map(blN, vBlWP, blUV, ${I('Color', T.C, 'vec3(0.5, 0.5, 1.0)')}, ${I('Strength', T.F, '1.0')})`), t: T.V };
      }
      case 'DISPLACEMENT': {
        const h = this.decl(T.F, `(${I('Height', T.F)} - ${I('Midlevel', T.F, '0.5')}) * ${I('Scale', T.F, '1.0')}`);
        return { e: h, t: T.F, displacementHeight: true };
      }
      case 'GROUP': {
        const gg = n.group_graph; if (!gg) { this.notes.push('group without graph ' + n.group); return { e: '0.0', t: T.F }; }
        const inner = { id: scope.id + '>' + n.name, parent: scope, g, node: n };
        const go = gg.nodes.find(x => x.type === 'GROUP_OUTPUT'); if (!go) return { e: '0.0', t: T.F };
        const l = gg.links.find(x => x[2] === go.name && x[3] === sock);
        if (!l) return { e: lit(go.in?.[sock] ?? 0, T.F), t: T.F };
        return this.out(gg, inner, l[0], l[1]);
      }
      case 'GROUP_INPUT': {
        const p = scope.node; if (!p) return { e: '0.0', t: T.F };
        const l = scope.g.links.find(x => x[2] === p.name && x[3] === sock);
        if (l) return this.out(scope.g, scope.parent, l[0], l[1]);
        const dv = p.in?.[sock]; return { e: lit(dv ?? 0, Array.isArray(dv) ? T.C : T.F), t: Array.isArray(dv) ? T.C : T.F };
      }
      default:
        this.notes.push('unsupported node ' + n.type);
        return { e: '0.0', t: T.F };
    }
  }
  usesSock(g, n, s) { return g.links.some(l => l[0] === n.name && l[1] === s); }

  // Walk from the Material Output's Surface to the shader that defines the look.
  // sock: the output socket the link leaves from (needed for a group with several outputs and for a colour or value node
  // that Cycles turns into an emission)
  resolveShader(g, scope, name, acc, sock) {
    const n = this.nodeOf(g, name); if (!n) return acc;
    // a colour or value node plugged into a shader socket: Cycles inserts an Emission (Color, Strength 1) there
    if (isValueNode(n.type)) { const r = this.out(g, scope, name, sock); if (r && !r.dropped) acc.emission = `(${conv(r.e, r.t, T.C)})`; return acc; }
    switch (n.type) {
      case 'BSDF_PRINCIPLED': acc.principled = acc.principled || { g, scope, n }; return acc;
      case 'MIX_SHADER': {
        const a = this.link(g, n.name, 'Shader'), b = this.link(g, n.name, 'Shader_001');
        const ta = a && this.nodeOf(g, a[0])?.type, tb = b && this.nodeOf(g, b[0])?.type;
        const fac = this.input(g, scope, n, 'Fac', T.F, '0.5');
        // colour or value nodes on a shader input are emissions in Cycles (see above): orchids, poppy and the Sugarcane
        // leaves (leaf, leaves.00x: an HSV colour mixed with a Principled by a fresnel ramp) were left to the dominant side
        const colA = !!ta && isValueNode(ta), colB = !!tb && isValueNode(tb);
        if ((colA || colB) && (ta === 'EMISSION' || colA) && (tb === 'EMISSION' || colB)) {
          const ea = this.resolveShader(g, scope, a[0], {}, a[1]).emission || 'vec3(0.0)', eb = this.resolveShader(g, scope, b[0], {}, b[1]).emission || 'vec3(0.0)';
          acc.emission = `mix(${ea}, ${eb}, clamp(${fac}, 0.0, 1.0))`; return acc;
        }
        if (colA && b && tb !== 'BSDF_TRANSPARENT') { this.resolveShader(g, scope, a[0], acc, a[1]); acc.emisScale = `(1.0 - ${fac})`; acc.baseScale = `(${fac})`; return this.resolveShader(g, scope, b[0], acc, b[1]); }
        if (colB && a && ta !== 'BSDF_TRANSPARENT') { this.resolveShader(g, scope, b[0], acc, b[1]); acc.emisScale = `(${fac})`; acc.baseScale = `(1.0 - ${fac})`; return this.resolveShader(g, scope, a[0], acc, a[1]); }
        if (ta === 'BSDF_TRANSPARENT' && b) { acc.alpha = `clamp(${fac}, 0.0, 1.0)`; return this.resolveShader(g, scope, b[0], acc, b[1]); }
        if (tb === 'BSDF_TRANSPARENT' && a) { acc.alpha = `clamp(1.0 - ${fac}, 0.0, 1.0)`; return this.resolveShader(g, scope, a[0], acc, a[1]); }
        // glass + emission (lamp shades, rot_sconce_amber: Glass and Blackbody Emission at 0.5): the glass side's weight is
        // kept so the shade can be drawn as a see-through pane with the emission on top (compile, res.glassEmit)
        const fN = parseFloat(fac);
        // the shader on the other side keeps only its own share of the mix (Cycles: mix_weight). It was drawn at full weight:
        // the screens and neon tubes (Emission + Glossy at 0.08 / 0.06) reflected like a 0.8 mirror, and rot_sky_proc's
        // diffuse (Emission + Principled at 0.3) was three times too strong (surface audit, Oct 13)
        if (tb === 'EMISSION' && a) { this.resolveShader(g, scope, b[0], acc, b[1]); acc.emisScale = `(${fac})`; acc.otherW = isNaN(fN) ? null : 1 - fN; acc.otherScale = `(1.0 - ${fac})`; return this.resolveShader(g, scope, a[0], acc, a[1]); }
        if (ta === 'EMISSION' && b) { this.resolveShader(g, scope, a[0], acc, a[1]); acc.emisScale = `(1.0 - ${fac})`; acc.otherW = isNaN(fN) ? null : fN; acc.otherScale = `(${fac})`; return this.resolveShader(g, scope, b[0], acc, b[1]); }
        // clear glass mixed with an opaque Principled by a pattern (Delmonico's chain curtain rr_del_barcode: glass plus
        // gold chain strands from a UV stripe pattern): draw the opaque side and let the glass side through as alpha. The
        // dominant-side pick drew the whole curtain as the glass's white base, a flat beige panel (Ryan, B080 px, Oct 13).
        if (ta === 'BSDF_PRINCIPLED' && tb === 'BSDF_PRINCIPLED' && isNaN(parseFloat(fac))) {
          const tw = (side) => { const nd = this.nodeOf(g, side[0]); const v = nd?.in?.['Transmission Weight']; return this.linked(g, nd, 'Transmission Weight') ? 0 : (typeof v === 'number' ? v : 0); };
          const tA = tw(a), tB = tw(b);
          if (tA >= 0.9 && tB < 0.9) { acc.alpha = `clamp(${fac}, 0.0, 1.0)`; acc.glassCut = true; return this.resolveShader(g, scope, b[0], acc); }
          if (tB >= 0.9 && tA < 0.9) { acc.alpha = `clamp(1.0 - ${fac}, 0.0, 1.0)`; acc.glassCut = true; return this.resolveShader(g, scope, a[0], acc); }
        }
        // two Principled BSDFs mixed by a pattern or texture (Starbucks siren cl_sbf_siren: dark metal + glowing cream by a
        // mask; Milos tower mil_tower_mat: stone + blue metal by a brick pattern): blend every parameter per pixel, which is
        // what the mix of two such lobes looks like (the dominant-side pick drew a uniform white disc / a flat tower)
        if (ta === 'BSDF_PRINCIPLED' && tb === 'BSDF_PRINCIPLED' && isNaN(parseFloat(fac)) && !acc.principled && !acc.mixP) {
          acc.mixP = { g, scope, a: this.nodeOf(g, a[0]), b: this.nodeOf(g, b[0]), fac }; return acc;
        }
        this.notes.push(`mix shader ${ta}/${tb}: using the dominant side`);
        const facNum = parseFloat(fac); const pick = !isNaN(facNum) && facNum > 0.5 ? b : a;
        return pick ? this.resolveShader(g, scope, pick[0], acc, pick[1]) : acc;
      }
      case 'ADD_SHADER': { for (const s of ['Shader', 'Shader_001']) { const l = this.link(g, n.name, s); if (l) this.resolveShader(g, scope, l[0], acc, l[1]); } return acc; }
      case 'EMISSION': acc.emission = `(${this.input(g, scope, n, 'Color', T.C)} * ${this.input(g, scope, n, 'Strength', T.F, '1.0')})`; return acc;
      // Diffuse and Translucent BSDFs have no specular lobe in Cycles (three's standard model always adds F0 0.04 with a
      // white Fresnel rim): noSpec turns it off. The Glossy BSDF has no Fresnel at all (closure.h, MICROFACET_GGX: a
      // constant Color at every angle): metal 1 gives F0 = Color, and constF90 holds the rim at the same value instead of
      // three's white. The Metallic BSDF keeps its Fresnel (F82 tint), as before.
      case 'BSDF_DIFFUSE': case 'BSDF_TRANSLUCENT': acc.simple = acc.simple || { base: this.input(g, scope, n, 'Color', T.C), rough: '1.0', metal: '0.0', normal: this.linked(g, n, 'Normal') ? this.input(g, scope, n, 'Normal', T.V) : null, noSpec: true }; return acc;
      case 'BSDF_GLOSSY': case 'BSDF_METALLIC': acc.simple = acc.simple || { base: this.input(g, scope, n, n.type === 'BSDF_METALLIC' ? 'Base Color' : 'Color', T.C), rough: this.input(g, scope, n, 'Roughness', T.F, '0.5'), metal: '1.0', constF90: n.type === 'BSDF_GLOSSY' }; return acc;
      case 'BSDF_GLASS': case 'BSDF_REFRACTION': acc.glass = true; acc.glassNode = acc.glassNode || { g, scope, n }; return acc;
      case 'BSDF_TRANSPARENT': acc.alpha = '0.0'; return acc;
      case 'GROUP': {
        const gg = n.group_graph; if (!gg) return acc; const go = gg.nodes.find(x => x.type === 'GROUP_OUTPUT');
        // the group output the outer link reads (poppy: its first link goes to a Value output, Socket_1, and the shader
        // on Socket_0 was never reached); any first link when the socket is unknown, as before
        const l = go && (gg.links.find(x => x[2] === go.name && x[3] === sock) || gg.links.find(x => x[2] === go.name)); if (!l) return acc;
        return this.resolveShader(gg, { id: scope.id + '>' + n.name, parent: scope, g, node: n }, l[0], acc, l[1]);
      }
      case 'REROUTE': { const l = this.link(g, n.name, 'Input'); return l ? this.resolveShader(g, scope, l[0], acc, l[1]) : acc; }
      default: this.notes.push('surface shader ' + n.type + ' not modelled'); return acc;
    }
  }

  compile() {
    const g = this.mat.graph; if (!g) return null;
    const root = { id: 'm' };
    // the exact Blender 5.0 voronoi is opt in (flag vor5=1): on Ryan's laptop (ANGLE D3D11) its programs stalled the first
    // frame for about 150 s (m55: warm frame 155 s with it, 0.6 s without it, same build). Until it is made cheaper for
    // D3D's compiler, del_stone and pm_mosaic_champagne keep the old F1 euclidean voronoi.
    this.vorExact = hasExactVoronoi(g) && (globalThis.RR_FLAGS || {}).vor5 === 1;
    const outs = g.nodes.filter(n => n.type === 'OUTPUT_MATERIAL');
    const out = outs.find(n => n.is_active_output && n.target !== 'EEVEE') || outs.find(n => n.is_active_output) || outs[0];
    if (!out) return null;
    const res = { base: null, rough: null, metal: null, normal: null, emission: null, alpha: null };
    const sl = this.link(g, out.name, 'Surface');
    if (sl) {
      const acc = this.resolveShader(g, root, sl[0], {}, sl[1]);
      if (acc.principled) {
        const { g: pg, scope: ps, n: p } = acc.principled;
        // a cutout taken from a glass mix (chain curtain): the glTF material carries the glass side's values, so the opaque
        // side's own constants must be written out too
        const L = (s) => this.linked(pg, p, s) || (acc.glassCut && ['Base Color', 'Roughness', 'Metallic'].includes(s));
        if (L('Base Color')) res.base = this.input(pg, ps, p, 'Base Color', T.C);
        // the Principled shares a Mix Shader with a colour emission (Sugarcane leaves): its diffuse takes its mix weight
        if (acc.baseScale) res.base = `(${res.base || this.input(pg, ps, p, 'Base Color', T.C)} * clamp(${acc.baseScale}, 0.0, 1.0))`;
        // the Principled's share of an emission mix scales its whole BSDF, specular included (it only scaled the diffuse)
        const pw = acc.baseScale || acc.otherScale;
        if (acc.otherScale && !acc.baseScale) res.base = `(${res.base || this.input(pg, ps, p, 'Base Color', T.C)} * clamp(${acc.otherScale}, 0.0, 1.0))`;
        if (pw) res.specScale = `clamp(${pw}, 0.0, 1.0)`;
        if (L('Roughness')) res.rough = `clamp(${this.input(pg, ps, p, 'Roughness', T.F)}, 0.0, 1.0)`;
        if (L('Metallic')) res.metal = `clamp(${this.input(pg, ps, p, 'Metallic', T.F)}, 0.0, 1.0)`;
        if (L('Normal')) res.normal = this.input(pg, ps, p, 'Normal', T.V);
        if (L('Emission Color') || L('Emission Strength')) res.emission = `(${this.input(pg, ps, p, 'Emission Color', T.C)} * ${this.input(pg, ps, p, 'Emission Strength', T.F, '0.0')})`;
        if (L('Alpha')) res.alpha = `clamp(${this.input(pg, ps, p, 'Alpha', T.F)}, 0.0, 1.0)`;
        // chain curtain gaps (glassCut): in Cycles the gaps are one open sheet of clear glass (IOR 1.5, no thin wall), so
        // every ray through them is refracted into the glass and never leaves it: the room behind reads bent and dark,
        // and the sheet carries sharp corridor reflections. A fully open hole read see through (m54/m55r B080 px). The
        // gaps are drawn as a dark glossy film instead: base near black, roughness 0.04, no metal, covering
        // RR_FLAGS.cutgap of what is behind (default 0.3: 0.45 read as a flat dark film in m57); the strands keep their own gold values and full coverage.
        if (acc.glassCut && acc.alpha) {
          const gapA = +((globalThis.RR_FLAGS || {}).cutgap ?? 0.3);
          let c = this.decl(T.F, acc.alpha);
          // curtfix (interfix agent, Oct 14): the strand mask is binary per pixel (LESS_THAN of a 420 per UV unit column
          // index, about 1 cm strands with 3 mm gaps on wing_front_glass). From about 4 m the gaps fall under a pixel and the
          // mask aliases into broken strands, dark moire bands and a ragged top edge; Cycles averages the same pattern to its
          // mean coverage. Where the mask changes inside the 2x2 pixel quad it is replaced by that mean (RR_FLAGS.curtcov,
          // default 0.3: 0.7 strand width times about 0.4 strands present for the graph's noise threshold 0.9 n minus 0.05)
          // curtfix2 (agent vmisc, Oct 15, RR_FLAGS.curtfix2 = 1, takes the place of curtfix where the graph matches): the
          // curtfix mean replaced the mask only where it flipped inside a 2x2 quad, so at walking distance the curtain was a
          // dither of binary pixels and 0.3 patches, and each of the 7 strand rows (column index U * 420 + row * 37) aliased
          // with its own phase: the staggered horizontal bands and smeared streaks of sweep rv05 10 / rv06 11 (W047, W055).
          // Here the strand mask fades to its own expectation as the strands fall under a pixel: per row the strand share
          // of a column (LESS_THAN fract(column), 0.7) times the chance the white noise of that column passes the row's
          // noise threshold (uniform white noise: P = clamp(threshold, 0, 1)), which is what Cycles converges to at 32+
          // samples a pixel. The fade runs over a footprint of RR_FLAGS.curtw0 to curtw1 columns a pixel (default 0.35, 1).
          // Both inputs are read from the graph itself (the FRACT and WHITE_NOISE LESS_THAN pair under the mix factor),
          // so any other glass cut graph falls back to curtfix.
          const F2 = globalThis.RR_FLAGS || {}; let cf2 = false;
          if (+(F2.curtfix2 ?? 0)) {
            const lts = pg.nodes.filter(n => n.type === 'MATH' && n.operation === 'LESS_THAN');
            const src = (n, s) => { const l = this.link(pg, n.name, s); return l ? this.nodeOf(pg, l[0]) : null; };
            const strand = lts.find(n => src(n, 'Value')?.type === 'MATH' && src(n, 'Value').operation === 'FRACT');
            const pres = lts.find(n => src(n, 'Value')?.type === 'TEX_WHITE_NOISE');
            if (strand && pres) {
              const fr = src(strand, 'Value'), col = this.decl(T.F, this.input(pg, ps, fr, 'Value', T.F));
              const sw = this.input(pg, ps, strand, 'Value_001', T.F, '0.7'), thr = this.input(pg, ps, pres, 'Value_001', T.F);
              const w0 = +(F2.curtw0 ?? 0.35), w1 = +(F2.curtw1 ?? 1.0);
              const e = this.decl(T.F, `clamp(${sw}, 0.0, 1.0) * clamp(${thr}, 0.0, 1.0)`);
              c = this.decl(T.F, `mix(${c}, ${e}, smoothstep(${w0.toFixed(3)}, ${w1.toFixed(3)}, fwidth(${col})))`); cf2 = true;
              this.notes.push('curtfix2 strand expectation');
            }
          }
          if ((globalThis.RR_FLAGS || {}).curtfix && !cf2) {
            const cov = +((globalThis.RR_FLAGS || {}).curtcov ?? 0.3);
            c = this.decl(T.F, `mix(${c}, ${cov.toFixed(3)}, clamp(fwidth(${c}), 0.0, 1.0))`);
          }
          res.base = `mix(vec3(0.03, 0.026, 0.022), ${res.base || this.input(pg, ps, p, 'Base Color', T.C)}, ${c})`;
          res.rough = `mix(0.04, ${res.rough || 'roughnessFactor'}, ${c})`;
          res.metal = `mix(0.0, ${res.metal || 'metalnessFactor'}, ${c})`;
          acc.alpha = `mix(${gapA.toFixed(3)}, 1.0, ${c})`;
        }
      } else if (acc.mixP) {
        const { g: pg, scope: ps, a: pa, b: pb, fac } = acc.mixP; const f = this.decl(T.F, `clamp(${fac}, 0.0, 1.0)`);
        const P = (n, sock, t, d) => this.input(pg, ps, n, sock, t, d);
        const nrm = (n) => this.linked(pg, n, 'Normal') ? P(n, 'Normal', T.V) : 'blN';
        res.base = `mix(${P(pa, 'Base Color', T.C)}, ${P(pb, 'Base Color', T.C)}, ${f})`;
        res.rough = `clamp(mix(${P(pa, 'Roughness', T.F, '0.5')}, ${P(pb, 'Roughness', T.F, '0.5')}, ${f}), 0.0, 1.0)`;
        res.metal = `clamp(mix(${P(pa, 'Metallic', T.F, '0.0')}, ${P(pb, 'Metallic', T.F, '0.0')}, ${f}), 0.0, 1.0)`;
        if (this.linked(pg, pa, 'Normal') || this.linked(pg, pb, 'Normal')) res.normal = `normalize(mix(${nrm(pa)}, ${nrm(pb)}, ${f}))`;
        const emi = (n) => { const st = n.in?.['Emission Strength']; return this.linked(pg, n, 'Emission Strength') || this.linked(pg, n, 'Emission Color') || (typeof st === 'number' && st > 0); };
        if (emi(pa) || emi(pb)) { const E = (n) => emi(n) ? `(${P(n, 'Emission Color', T.C)} * ${P(n, 'Emission Strength', T.F, '0.0')})` : 'vec3(0.0)'; res.emission = `mix(${E(pa)}, ${E(pb)}, ${f})`; }
        if (this.linked(pg, pa, 'Alpha') || this.linked(pg, pb, 'Alpha')) res.alpha = `clamp(mix(${P(pa, 'Alpha', T.F, '1.0')}, ${P(pb, 'Alpha', T.F, '1.0')}, ${f}), 0.0, 1.0)`;
      } else if (acc.simple) { res.base = acc.simple.base; res.rough = acc.simple.rough; res.metal = acc.simple.metal; if (acc.simple.normal) res.normal = acc.simple.normal;
        if (acc.otherScale) res.base = `(${res.base} * clamp(${acc.otherScale}, 0.0, 1.0))`;
        if (acc.simple.noSpec) res.noSpec = true;
        if (acc.simple.constF90) res.specF90 = `dot(max(${res.base}, vec3(0.0)), vec3(1.0 / 3.0))`; }
      if (acc.emission) { res.emission = acc.emisScale ? `(${acc.emission} * ${acc.emisScale})` : acc.emission;
        if (!acc.principled && !acc.simple && !acc.mixP && acc.glassNode) {
          // glass + emission: no diffuse (the non-glass share is the emission), the glass's own roughness, and the glass
          // side's tint, roughness and weight handed to applyBlenderGraph / thinGlass, which draw it as a see-through pane
          // (it used to become an opaque black diffuse with roughness 1 under a strong glow: a solid white blob)
          const gn = acc.glassNode.n, gl = (s) => this.linked(acc.glassNode.g, gn, s);
          res.base = 'vec3(0.0)'; res.metal = '0.0'; res.rough = `clamp(${this.input(acc.glassNode.g, acc.glassNode.scope, gn, 'Roughness', T.F, '0.0')}, 0.0, 1.0)`;
          const col = gn.in?.Color;
          res.glassEmit = { color: !gl('Color') && Array.isArray(col) ? col.slice(0, 3) : null, rough: !gl('Roughness') && typeof gn.in?.Roughness === 'number' ? gn.in.Roughness : null, weight: acc.otherW ?? null };
        } else if (!acc.principled && !acc.simple) { res.base = 'vec3(0.0)'; res.rough = '1.0'; res.metal = '0.0'; } }
      if (acc.alpha) res.alpha = res.alpha ? `(${res.alpha} * ${acc.alpha})` : acc.alpha;
      res.glass = !!acc.glass; res.glassCut = !!acc.glassCut;
    }
    const dl = this.link(g, out.name, 'Displacement');
    if (dl) {
      const r = this.out(g, root, dl[0], dl[1]);
      if (r) { const h = r.t === T.F ? r.e : `length(${r.e})`; const base = res.normal || 'blN'; res.normal = this.decl(T.V, `bl_bump(1.0, 1.0, 1.0, ${h}, ${base}, vBlWP, false)`); }
    }
    if (!res.base && !res.rough && !res.metal && !res.normal && !res.emission && !res.alpha) return null;
    // Hoist every decimal constant into a uniform array, so materials that share a node structure share one program
    // (Gjelina area: 260 graphs, 90 structures). Integers (enum arguments, loop bounds) stay literal.
    const K = []; const hoist = (str) => str ? str.replace(/(?<![\w.])\d+\.\d+(?:e-?\d+)?/g, (m) => { K.push(parseFloat(m)); return `blK[${K.length - 1}]`; }) : str;
    const body = hoist(this.lines.join('\n  '));
    const res2 = {}; for (const k of Object.keys(res)) res2[k] = typeof res[k] === 'string' ? hoist(res[k]) : res[k];
    const structKey = JSON.stringify(res2) + '|' + body.replace(/blTex\d+/g, 'T') + '|' + K.length;
    let h = 2166136261; for (let i = 0; i < structKey.length; i++) { h ^= structKey.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    if (K.length) this.uniforms.blK = { value: new Float32Array(K) };
    const ribs = glassRibs(g);
    const alphaTex = res2.alpha ? alphaSamples(res2.alpha, body, this.samples) : [];
    return { res: res2, body, uniforms: this.uniforms, notes: [...new Set(this.notes)], nK: K.length, key: h.toString(36) + '_' + K.length, ...(ribs ? { ribs } : {}), ...(alphaTex.length ? { alphaTex } : {}) };
  }
}

// Reeded glass: a transmissive Principled whose Normal is a Bump of straight sine Wave bands along one world axis
// (Matteo's cl_mt_reeded: Geometry Position, Separate Z, Combine Z, Mapping scale z 14, Wave bands Z, Bump 0.6 / 4 mm).
// Returns the ribs in closed form, so the glass shader (rr2_reflect.js thinGlass) can rebuild the rib normal analytically:
// height h = 0.5 + 0.5 sin(n - pi/2), n = freq * axis + phase (Blender svm_wave, bands: coordinate times 20), and the
// Bump node gives N' = normalize(N - dist * grad h), mixed by strength. The screen-derivative bump fades ribs under 14 px,
// which is where Matteo's 2.2 cm ribs sit at corridor distance. Anything else returns null (nothing changes).
export function glassRibs(g) {
  if (!g || !g.nodes || !g.links) return null;
  const node = (name) => g.nodes.find(n => n.name === name);
  const from = (n, sock) => { const l = g.links.find(l => l[2] === n.name && l[3] === sock); return l ? { n: node(l[0]), s: l[1] } : null; };
  const AX = { X: 0, Y: 1, Z: 2 };
  for (const p of g.nodes) {
    if (p.type !== 'BSDF_PRINCIPLED') continue;
    const tw = p.in?.['Transmission Weight'];
    if (!(typeof tw === 'number' && tw > 0) && !from(p, 'Transmission Weight')) continue;
    const b = from(p, 'Normal'); if (!b || b.n?.type !== 'BUMP' || from(b.n, 'Strength') || from(b.n, 'Distance') || from(b.n, 'Normal')) continue;
    const w = from(b.n, 'Height'); const wn = w?.n;
    if (!wn || wn.type !== 'TEX_WAVE' || w.s !== 'Fac' || wn.wave_type !== 'BANDS' || wn.wave_profile !== 'SIN' || !(wn.bands_direction in AX)) continue;
    if (['Scale', 'Distortion', 'Phase Offset'].some(s => from(wn, s)) || (wn.in?.Distortion ?? 0) !== 0) continue;
    let a = AX[wn.bands_direction], mult = 1, off = 0;
    // vector chain back to the world position: optional Mapping (point, no rotation), optional Combine <- Separate of the same axis
    let v = from(wn, 'Vector'), ok = false;
    for (let guard = 0; v && guard < 6; guard++) {
      const n = v.n;
      if (n.type === 'NEW_GEOMETRY' && v.s === 'Position') { ok = true; break; }
      if (n.type === 'MAPPING' && (n.vector_type || 'POINT') === 'POINT' && !['Location', 'Rotation', 'Scale'].some(s => from(n, s))) {
        const r = n.in?.Rotation || [0, 0, 0]; if (r.some(x => Math.abs(x) > 1e-6)) break;
        const s = (n.in?.Scale || [1, 1, 1])[a], l = (n.in?.Location || [0, 0, 0])[a]; off += mult * l; mult *= s; v = from(n, 'Vector'); continue;
      }
      if (n.type === 'COMBXYZ') { const k = 'XYZ'[a]; const c = from(n, k); if (!c || c.n?.type !== 'SEPXYZ' || c.s !== k) break; v = from(c.n, 'Vector'); continue; }
      break;
    }
    if (!ok) continue;
    // band coordinate: (axis * mult + off) * waveScale * 20 + phase offset (a Mapping applies its scale, then its location)
    const waveScale = wn.in?.Scale ?? 5, freq = 20 * waveScale * mult, phase = 20 * waveScale * off + (wn.in?.['Phase Offset'] ?? 0);
    const dist = (b.n.in?.Distance ?? 1) * (b.n.invert ? -1 : 1), strength = Math.max(b.n.in?.Strength ?? 1, 0);
    return { axis: 'XYZ'[a], freq, phase, slope: dist * 0.5 * freq, strength };
  }
  return null;
}

// the image samples an alpha expression depends on: its identifiers, followed back through the body's declarations
function alphaSamples(alpha, body, samples) {
  const decl = new Map(); for (const m of body.matchAll(/\b(?:float|vec2|vec3|vec4)\s+(\w+)\s*=\s*([^;]*);/g)) decl.set(m[1], m[2]);
  const bySample = new Map(samples.map(x => [x.s, x])); const seen = new Set(); const found = []; const todo = [alpha];
  while (todo.length) { for (const id of todo.pop().match(/\b[A-Za-z_]\w*\b/g) || []) { if (seen.has(id)) continue; seen.add(id);
    if (bySample.has(id)) found.push(bySample.get(id)); if (decl.has(id)) todo.push(decl.get(id)); } }
  return found;
}

// Alpha to coverage for image cutouts (logos, wordmarks, decals). Blender's Alpha Hashed and the Transparent mix are
// stochastic coverage: a pixel covers as much of the surface as the filtered alpha says. three's ALPHA_TO_COVERAGE chunk
// thresholds at alphaTest (0.5) instead. Under minification the mip averages a thin stroke with its transparent
// surroundings down below 0.5, so the stroke vanishes: the Voltaire wordmark's thin serifs and hairlines dropped out at
// B003/B004 px, leaving only its heavy verticals. Here the image's own texel footprint decides: magnified (one texel
// covers a pixel or more) the edge is sharpened about alphaTest over one pixel (Golus, "Anti-aliased Alpha Test", 2017);
// minified by 2x or more the filtered alpha itself is the coverage, as in Cycles. Without MSAA (floor mirror target) the
// plain alpha test stays: ALPHA_TO_COVERAGE is a per material define and the mirror draws the same programs, so the
// mirror pass sets the BL_A2C uniform to 0 (rr2_reflect.js FloorReflector.update). Every user declares blA2C.
const A2C_DECL = 'uniform float blA2C;\n';
// thin stroke materials (signs, logos, neon) take a hashed test in the single sample mirror; every other cutout (the
// Starbucks lattice screen) keeps the plain test, which m70 showed reflects closer to the reference
const HASH_RE = /logo|neon|sign|word|letter/i;
function alphaRhoTerms(alphaTex) {
  const seen = new Set(); const terms = [];
  for (const { u, uv } of alphaTex) { const k = u + '|' + uv; if (seen.has(k)) continue; seen.add(k);
    terms.push(`{ vec2 t = ${uv} * vec2(textureSize(${u}, 0)); vec2 tx = dFdx(t), ty = dFdy(t); blRho = max(blRho, max(dot(tx, tx), dot(ty, ty))); }`); }
  return terms;
}
function alphaCoverageGLSL(alphaTex, hashed = false, rho = null) {
  const terms = rho ? [`blRho = ${rho};`] : alphaRhoTerms(alphaTex);
  return `#ifdef USE_ALPHATEST
  #ifdef ALPHA_TO_COVERAGE
  if (blA2C < 0.5) { if (diffuseColor.a < ${hashed ? 'max(alphaTest * 0.2, fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))))' : 'alphaTest'}) discard; } else /* single sample mirror: hashed alpha keeps the mean coverage of thin strokes and lattice holes (m69 wordmark reflections broke up with the plain test) */
  { float blRho = 0.0;
    ${terms.join('\n    ')}
    float blMin = clamp(0.5 * log2(max(blRho, 1e-8)), 0.0, 1.0);
    float blSharp = clamp((diffuseColor.a - alphaTest) / max(fwidth(diffuseColor.a), 1e-4) + 0.5, 0.0, 1.0);
    diffuseColor.a = mix(blSharp, diffuseColor.a, blMin);
    if (diffuseColor.a < 0.004) discard; }
  #else
  if (diffuseColor.a < alphaTest) discard;
  #endif
#endif`;
}

// the same coverage for a cutout on three's own map slot (image-only graphs mapped by rr2_scene applySimpleGraph, and
// glTF materials without a graph): the map's alpha and UV
export function mapAlphaCoverage(m) {
  if (!m.map || m.userData.blender || m.userData.a2cMap) return false;
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey; m.userData.a2cMap = true;
  m.onBeforeCompile = (sh, r) => { if (prev) prev.call(m, sh, r);
    sh.uniforms.blA2C = BL_A2C;
    sh.fragmentShader = A2C_DECL + sh.fragmentShader.replace('#include <alphatest_fragment>', alphaCoverageGLSL([{ u: 'map', uv: 'vMapUv' }], HASH_RE.test(m.name || ''))); };
  m.customProgramCacheKey = () => (prevKey ? prevKey.call(m) : '') + '|a2cmap' + (HASH_RE.test(m.name || '') ? 'h' : '');
  m.needsUpdate = true; return true;
}

// progcut (RR_FLAGS.progcut, load time): Blender graphs whose programs would differ only by the graph code share one
// program. Each graph of a group runs in its own branch on a per material uniform int (blVar), so every material
// evaluates exactly its own expressions; the program holds the union of the group's graphs. Graphs with alpha (cutouts,
// sub-pixel coverage) and unlit materials keep their own program.
const PC_INFO = new WeakMap(), PC_GROUP = new WeakMap();
const PC_DUMMY = (() => { const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); t.needsUpdate = true; return t; })();
export function progcutMerge(root, { cap = 8, groupKey = null, alpha = false } = {}) {
  // one unit per distinct graph (compiled.key): every compiled copy of a graph joins the same group, so a graph never
  // splits across programs. Each graph carries the set of program keys (graph part taken out) its materials use; graphs
  // with the same set are packed together, up to cap graphs per group, so a group adds no key its graphs did not have.
  const byGk = new Map(), seen = new Set(); let mats = 0;
  root.traverse(o => { if (!o.isMesh) return; for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
    const c = m?.userData?.blender; if (!c || !PC_INFO.has(c) || PC_GROUP.has(c)) continue;
    const ci = PC_INFO.get(c); if (ci.cls && !alpha) continue;
    // (progcut 2: the alpha class and the unlit flag go into the key, so a group never mixes cutout kinds or lit with unlit)
    const k = (groupKey ? groupKey(m) : String(m.customProgramCacheKey())).replace(/bl:[^|#]*/g, 'bl').replace(/\|L1(?=[|#]|$)/g, '') + (ci.cls ? '|pa' + ci.cls : '');
    let e = byGk.get(c.key); if (!e) byGk.set(c.key, e = { cs: new Set(), R: new Set() }); e.R.add(k);
    if (!seen.has(c)) { seen.add(c); e.cs.add(c); mats++; } } });
  // clusters start as one graph each; the pair sharing the most keys is joined while it saves a program and stays within
  // cap graphs (joining A and B costs |A or B| programs instead of |A| + |B|)
  let cl = [...byGk.keys()].sort().map(gk => ({ gks: [gk], R: new Set(byGk.get(gk).R) }));
  for (;;) { let best = null, bg = 0;
    for (let i = 0; i < cl.length; i++) for (let j = i + 1; j < cl.length; j++) { const a = cl[i], b = cl[j]; if (a.gks.length + b.gks.length > cap) continue;
      let g = 0; for (const r of b.R) if (a.R.has(r)) g++; if (g > bg) { bg = g; best = [i, j]; } }
    if (!best) break; const [i, j] = best; cl[i] = { gks: cl[i].gks.concat(cl[j].gks), R: new Set([...cl[i].R, ...cl[j].R]) }; cl.splice(j, 1); }
  let groups = 0, merged = 0, gid = 0;
  for (const { gks } of cl) { { const part = gks.sort(); if (part.length < 2) continue;
    const vars = part.map(gk => PC_INFO.get([...byGk.get(gk).cs][0])); const id = 'pc' + (gid++);
    const lib = shakeBlenderGLSL(PRELUDE + '\n' + vars.map(v => v.body + '\n' + JSON.stringify(v.res)).join('\n'));
    const G = { id, vars, lib, nK: Math.max(1, ...vars.map(v => v.nK || 1)), nT: Math.max(0, ...vars.map(v => v.nT)), cls: vars[0].cls || '' };
    G.key = 'blm:' + part.join('/') + ':' + G.nT + (/\bblL1\b/.test(lib) ? '|L1' : '') + (G.cls ? '|pa' + G.cls : '');
    part.forEach((gk, j) => byGk.get(gk).cs.forEach(c => PC_GROUP.set(c, { G, idx: j, key: G.key }))); groups++; merged += part.length;
  } }
  root.traverse(o => { if (!o.isMesh) return; for (const m of (Array.isArray(o.material) ? o.material : [o.material])) if (m?.userData?.blender && PC_GROUP.has(m.userData.blender)) m.needsUpdate = true; });
  return { graphs: mats, graphKeys: byGk.size, groups, merged };
}
function emitMerged(pcm, compiled, shader, material) {
  const { G, idx } = pcm, F = globalThis.RR_FLAGS || {};
  const ss = G.cls.startsWith('ss'), tex = G.cls.startsWith('tex'), mul = G.cls.startsWith('mul'), basic = G.cls.endsWith('b');
  if (tex) shader.uniforms.blA2C = BL_A2C;
  Object.assign(shader.uniforms, compiled.uniforms);
  for (let t = 0; t < G.nT; t++) if (!shader.uniforms['blTex' + t]) shader.uniforms['blTex' + t] = { value: PC_DUMMY };
  shader.uniforms.blVar = { value: idx };
  if (/\bblL1\b/.test(G.lib)) shader.uniforms.blL1 = BL_L1;
  const br = (f) => G.vars.map((v, i) => { const t = f(v, i); return t ? `if (blVar == ${i}) { ${t} }` : ''; }).filter(Boolean).join(' else ');
  const R = (v, k) => v.res[k];
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
attribute vec3 blGen; attribute float blRand; attribute vec3 blObj;
varying vec3 vBlObj; varying vec3 vBlGen; varying vec3 vBlWP; varying float vBlRand;`)
    .replace('#include <fog_vertex>', `#include <fog_vertex>
  vBlObj = blObj;
  vBlGen = blGen; vBlRand = blRand;
  vec4 blw = modelMatrix * vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  blw = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
  #endif
  vBlWP = vec3(blw.x, -blw.z, blw.y);`);
  const decl = `uniform float blK[${G.nK}];\n` + Array.from({ length: G.nT }, (_, t) => `uniform sampler2D blTex${t};`).join('\n') + '\nuniform int blVar;' + (tex ? '\n' + A2C_DECL : '');
  // supersampled alpha (progcut 2): one blAlphaAt per graph, picked by blVar like the main branches
  const ssFns = !ss ? '' : G.vars.map((v, i) => `float blAlphaAt${i}(vec3 vBlObj, vec3 vBlGen, vec3 vBlWP, vec2 blUV, vec3 blN, vec3 blI, vec3 blCam) {
  ${v.body}
  return clamp(${v.res.alpha}, 0.0, 1.0);
}`).join('\n') + `
float blAlphaAt(vec3 o, vec3 g, vec3 w, vec2 u, vec3 n, vec3 i, vec3 c) {
  ${G.vars.map((v, i) => `if (blVar == ${i}) return blAlphaAt${i}(o, g, w, u, n, i, c);`).join('\n  ')}
  return 1.0;
}`;
  // every graph's outputs are evaluated inside its branch (its temporaries are local there) and carried to the chunks
  const baseOf = (v) => basic && R(v, 'emission') ? R(v, 'emission') : R(v, 'base');
  const body = br((v) => [v.body, baseOf(v) ? `blOB = ${baseOf(v)};` : '',
    (tex || mul) && R(v, 'alpha') ? `blOA = ${R(v, 'alpha')};` : '', tex ? `{ float blRho = 0.0; ${alphaRhoTerms(v.alphaTex).join(' ')} blORho = blRho; }` : '', R(v, 'rough') ? `blOR = ${R(v, 'rough')};` : '', R(v, 'metal') ? `blOM = ${R(v, 'metal')};` : '',
    R(v, 'normal') ? `blON = ${R(v, 'normal')};` : '', R(v, 'emission') ? `blOE = ${R(v, 'emission')};` : '', R(v, 'specScale') ? `blOSS = ${R(v, 'specScale')};` : '',
    R(v, 'specF90') ? `blOF = ${R(v, 'specF90')};` : ''].filter(Boolean).join('\n  '));
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
${G.lib}
${PRELUDE}
${decl}
varying vec3 vBlObj; varying vec3 vBlGen; varying vec3 vBlWP; varying float vBlRand;
${ssFns ? ssFns + '\n' : ''}`)
    .replace('#include <logdepthbuf_fragment>', `#include <logdepthbuf_fragment>
  vec2 blUV = vec2(vUv.x, 1.0 - vUv.y);
  ${basic ? `vec3 blCam = vec3(cameraPosition.x, -cameraPosition.z, cameraPosition.y);
  vec3 blN = normalize(cross(dFdx(vBlWP), dFdy(vBlWP))); if (dot(blN, blCam - vBlWP) < 0.0) blN = -blN;` : `vec3 blNw = normalize((vec4(normalize(vNormal), 0.0) * viewMatrix).xyz) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 blN = vec3(blNw.x, -blNw.z, blNw.y);
  vec3 blCam = vec3(cameraPosition.x, -cameraPosition.z, cameraPosition.y);`}
  vec3 blI = normalize(blCam - vBlWP);
  vec3 blOB = vec3(0.0), blON = vec3(0.0), blOE = vec3(0.0); float blOR = 0.0, blOM = 0.0, blOSS = 1.0, blOF = 0.0;${tex || mul ? ' float blOA = 1.0;' : ''}${tex ? ' float blORho = 0.0;' : ''}
  ${body}`)
    .replace('#include <map_fragment>', `#include <map_fragment>
  ${br((v) => baseOf(v) ? 'diffuseColor.rgb = max(blOB, vec3(0.0));' : '')}`)
    .replace('#include <alphamap_fragment>', `#include <alphamap_fragment>
  ${ss ? ((globalThis.RR_FLAGS || {}).bartap ? SS_COV2 : SS_COV) : tex || mul ? 'diffuseColor.a *= blOA;' : ''}`)
    .replace('#include <alphatest_fragment>', tex ? alphaCoverageGLSL([], HASH_RE.test(material.name || ''), 'blORho') : '#include <alphatest_fragment>')
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  ${br((v) => R(v, 'rough') ? 'roughnessFactor = blOR;' : '')}`)
    .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
  ${br((v) => R(v, 'metal') ? 'metalnessFactor = blOM;' : '')}`)
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  ${br((v) => R(v, 'normal') ? '{ vec3 bn = normalize(blON); if (any(isnan(bn))) bn = blN; vec3 tw = vec3(bn.x, bn.z, -bn.y); normal = normalize((viewMatrix * vec4(tw, 0.0)).xyz); }' : '')}
  ${F.nospecaa ? '' : `{
    vec3 saDu = dFdx(normal), saDv = dFdy(normal);
    float saVar = 0.15 * (dot(saDu, saDu) + dot(saDv, saDv));
    float saR = roughnessFactor * roughnessFactor;
    roughnessFactor = sqrt(sqrt(clamp(saR * saR + min(2.0 * saVar, 0.2), 0.0, 1.0)));
  }`}`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  ${br((v) => R(v, 'emission') ? 'totalEmissiveRadiance = max(blOE, vec3(0.0));' : '')}`);
  const geomOff = !F.nospecaa && !F.geomrough;
  const post = [geomOff ? 'material.roughness = min( max( roughnessFactor, 0.0525 ), 1.0 );' : '',
    br((v) => [R(v, 'specScale') ? '{ float blSS = blOSS; material.specularColor *= blSS; material.specularF90 *= blSS; }' : '',
      R(v, 'specF90') ? 'material.specularF90 = clamp(blOF, 0.0, 1.0);' : '', R(v, 'noSpec') ? 'material.specularColor = vec3(0.0); material.specularF90 = 0.0;' : ''].filter(Boolean).join(' '))].filter(Boolean).join('\n  ');
  if (post) shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
  ${post}`);
}

const SS_COV = `{ vec3 dO = dFdx(vBlObj), eO = dFdy(vBlObj), dG = dFdx(vBlGen), eG = dFdy(vBlGen), dW = dFdx(vBlWP), eW = dFdy(vBlWP); vec2 dU = dFdx(blUV), eU = dFdy(blUV);
    float cov = 0.0;
    cov += blAlphaAt(vBlObj + 0.375 * dO + 0.125 * eO, vBlGen + 0.375 * dG + 0.125 * eG, vBlWP + 0.375 * dW + 0.125 * eW, blUV + 0.375 * dU + 0.125 * eU, blN, blI, blCam);
    cov += blAlphaAt(vBlObj - 0.125 * dO + 0.375 * eO, vBlGen - 0.125 * dG + 0.375 * eG, vBlWP - 0.125 * dW + 0.375 * eW, blUV - 0.125 * dU + 0.375 * eU, blN, blI, blCam);
    cov += blAlphaAt(vBlObj - 0.375 * dO - 0.125 * eO, vBlGen - 0.375 * dG - 0.125 * eG, vBlWP - 0.375 * dW - 0.125 * eW, blUV - 0.375 * dU - 0.125 * eU, blN, blI, blCam);
    cov += blAlphaAt(vBlObj + 0.125 * dO - 0.375 * eO, vBlGen + 0.125 * dG - 0.375 * eG, vBlWP + 0.125 * dW - 0.375 * eW, blUV + 0.125 * dU - 0.375 * eU, blN, blI, blCam);
    diffuseColor.a *= cov * 0.25; }`;
// bartap (RR_FLAGS.bartap = 1, load time A/B): the supersampled alpha of every saa2 alpha graph (rr_del_barcode and any
// other ssAlpha graph) with 2 taps instead of 4. The alpha graph (noise included) is inlined once per tap, so this halves
// that part of the program. Taps at the D3D 2x MSAA positions (+0.25, +0.25) and (-0.25, -0.25) of the pixel, so the
// coverage steps in halves instead of quarters on a hard edge; smooth alpha is unchanged up to its curvature.
const SS_COV2 = `{ vec3 dO = dFdx(vBlObj) + dFdy(vBlObj), dG = dFdx(vBlGen) + dFdy(vBlGen), dW = dFdx(vBlWP) + dFdy(vBlWP); vec2 dU = dFdx(blUV) + dFdy(blUV);
    float cov = blAlphaAt(vBlObj + 0.25 * dO, vBlGen + 0.25 * dG, vBlWP + 0.25 * dW, blUV + 0.25 * dU, blN, blI, blCam);
    cov += blAlphaAt(vBlObj - 0.25 * dO, vBlGen - 0.25 * dG, vBlWP - 0.25 * dW, blUV - 0.25 * dU, blN, blI, blCam);
    diffuseColor.a *= cov * 0.5; }`;

// Patch a three.js material with a compiled Blender graph.
export function applyBlenderGraph(material, compiled) {
  const { res, body, uniforms } = compiled;
  material.defines = material.defines || {};
  material.defines.USE_UV = '';
  material.userData.blender = compiled;
  // procedural alpha patterns (perforated metal, grilles) are filtered like Cycles' pixel filter: the alpha graph is
  // evaluated at 4 sub-pixel positions and the coverage is blended (a hard cutout of 2-3 mm holes turns into moire at
  // walking distance). Textured cutouts (foliage, decals) keep the hard alpha test.
  const texAlpha = Object.keys(uniforms).some(u => u !== 'blK');
  const ssAlpha = !!res.alpha && !texAlpha;
  if (res.alpha && !ssAlpha) { material.alphaTest = Math.max(material.alphaTest || 0, 0.5); material.transparent = false; }
  if (ssAlpha) { material.alphaTest = 0; material.transparent = true; material.depthWrite = true; material.userData.ssAlpha = true; }
  // glass + emission lamp shade: the glTF export saw no glass in the mix (black base, emissive only, no transmission), so
  // the glass side's tint, roughness and weight are restored here for thinGlass (rr2_reflect.js), which then draws it as a
  // see-through pane; the emission stays on top as totalEmissiveRadiance
  if (res.glassEmit && material.isMeshStandardMaterial) {
    const ge = res.glassEmit; if (ge.color) material.color.setRGB(ge.color[0], ge.color[1], ge.color[2]);
    if (typeof ge.rough === 'number') material.roughness = ge.rough;
    // (the weight goes in userData: a standard material has no transmission, and the probes' clone() would drop it)
    material.metalness = 0; material.userData.glassEmit = true; material.userData.glassEmitW = ge.weight ?? 0.5;
  }
  // unlit glTF materials (KHR_materials_unlit, the orchids and poppy) show diffuseColor as is and have no emissive chunk:
  // an emission graph is their colour there
  const baseExpr = material.isMeshBasicMaterial && res.emission ? res.emission : res.base;
  const specAA = !(globalThis.RR_FLAGS || {}).nospecaa;
  const lib = shakeBlenderGLSL(PRELUDE + '\n' + body + '\n' + JSON.stringify(res));
  material.onBeforeCompile = (shader) => {
    const pcm = PC_GROUP.get(compiled); if (pcm) return emitMerged(pcm, compiled, shader, material);
    Object.assign(shader.uniforms, uniforms);
    if (/\bblL1\b/.test(lib)) shader.uniforms.blL1 = BL_L1;
    const a2c = !!(compiled.alphaTex && !ssAlpha); if (a2c) shader.uniforms.blA2C = BL_A2C;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec3 blGen; attribute float blRand; attribute vec3 blObj;
varying vec3 vBlObj; varying vec3 vBlGen; varying vec3 vBlWP; varying float vBlRand;`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>
  vBlObj = blObj;
  vBlGen = blGen; vBlRand = blRand;
  vec4 blw = modelMatrix * vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  blw = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
  #endif
  vBlWP = vec3(blw.x, -blw.z, blw.y);`);
    const uniformDecl = Object.keys(uniforms).map(u => u === 'blK' ? `uniform float blK[${compiled.nK}];` : `uniform sampler2D ${u};`).join('\n');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
${lib}
${PRELUDE}
${uniformDecl}
${a2c ? A2C_DECL : ''}varying vec3 vBlObj; varying vec3 vBlGen; varying vec3 vBlWP; varying float vBlRand;
${ssAlpha ? `float blAlphaAt(vec3 vBlObj, vec3 vBlGen, vec3 vBlWP, vec2 blUV, vec3 blN, vec3 blI, vec3 blCam) {
  ${body}
  return clamp(${res.alpha}, 0.0, 1.0);
}` : ''}`)
      .replace('#include <logdepthbuf_fragment>', `#include <logdepthbuf_fragment>
  vec2 blUV = vec2(vUv.x, 1.0 - vUv.y);
  ${material.isMeshBasicMaterial ? `vec3 blCam = vec3(cameraPosition.x, -cameraPosition.z, cameraPosition.y);
  // unlit materials have no vNormal varying (orchid_leaf, orchid_pod, poppy_texture failed to link): face normal from the
  // Blender space position derivatives, turned toward the camera
  vec3 blN = normalize(cross(dFdx(vBlWP), dFdy(vBlWP))); if (dot(blN, blCam - vBlWP) < 0.0) blN = -blN;` : `vec3 blNw = normalize((vec4(normalize(vNormal), 0.0) * viewMatrix).xyz) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 blN = vec3(blNw.x, -blNw.z, blNw.y);
  vec3 blCam = vec3(cameraPosition.x, -cameraPosition.z, cameraPosition.y);`}
  vec3 blI = normalize(blCam - vBlWP);
  ${body}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
  ${baseExpr ? `diffuseColor.rgb = max(${baseExpr}, vec3(0.0));` : ''}`)
      .replace('#include <alphamap_fragment>', `#include <alphamap_fragment>
  ${ssAlpha ? (globalThis.RR_FLAGS || {}).bartap ? SS_COV2 : `{ vec3 dO = dFdx(vBlObj), eO = dFdy(vBlObj), dG = dFdx(vBlGen), eG = dFdy(vBlGen), dW = dFdx(vBlWP), eW = dFdy(vBlWP); vec2 dU = dFdx(blUV), eU = dFdy(blUV);
    float cov = 0.0;
    cov += blAlphaAt(vBlObj + 0.375 * dO + 0.125 * eO, vBlGen + 0.375 * dG + 0.125 * eG, vBlWP + 0.375 * dW + 0.125 * eW, blUV + 0.375 * dU + 0.125 * eU, blN, blI, blCam);
    cov += blAlphaAt(vBlObj - 0.125 * dO + 0.375 * eO, vBlGen - 0.125 * dG + 0.375 * eG, vBlWP - 0.125 * dW + 0.375 * eW, blUV - 0.125 * dU + 0.375 * eU, blN, blI, blCam);
    cov += blAlphaAt(vBlObj - 0.375 * dO - 0.125 * eO, vBlGen - 0.375 * dG - 0.125 * eG, vBlWP - 0.375 * dW - 0.125 * eW, blUV - 0.375 * dU - 0.125 * eU, blN, blI, blCam);
    cov += blAlphaAt(vBlObj + 0.125 * dO - 0.375 * eO, vBlGen + 0.125 * dG - 0.375 * eG, vBlWP + 0.125 * dW - 0.375 * eW, blUV + 0.125 * dU - 0.375 * eU, blN, blI, blCam);
    diffuseColor.a *= cov * 0.25; }` : res.alpha ? `diffuseColor.a *= ${res.alpha};` : ''}`)
      .replace('#include <alphatest_fragment>', compiled.alphaTex && !ssAlpha ? alphaCoverageGLSL(compiled.alphaTex, HASH_RE.test(material.name || '')) : '#include <alphatest_fragment>')
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  ${res.rough ? `roughnessFactor = ${res.rough};` : ''}`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
  ${res.metal ? `metalnessFactor = ${res.metal};` : ''}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  ${res.normal ? `{ vec3 bn = normalize(${res.normal}); if (any(isnan(bn))) bn = blN; vec3 tw = vec3(bn.x, bn.z, -bn.y); normal = normalize((viewMatrix * vec4(tw, 0.0)).xyz); }` : ''}
  ${(globalThis.RR_FLAGS || {}).nospecaa ? '' : `{
    // geometric specular anti-aliasing from Filament (surface_shading_lit.fs normalFiltering; Kaplanyan 2016,
    // Tokuyoshi and Kaplanyan 2019): widen the GGX lobe by the normal's screen-space variance so bump-mapped brass and
    // grout stop glittering, with Filament's default variance 0.15 and threshold 0.2
    vec3 saDu = dFdx(normal), saDv = dFdy(normal);
    float saVar = 0.15 * (dot(saDu, saDu) + dot(saDv, saDv));
    float saR = roughnessFactor * roughnessFactor;
    roughnessFactor = sqrt(sqrt(clamp(saR * saR + min(2.0 * saVar, 0.2), 0.0, 1.0)));
  }`}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  ${res.emission ? `totalEmissiveRadiance = max(${res.emission}, vec3(0.0));` : ''}`);
    // specular response after three has filled PhysicalMaterial (lights_physical_fragment): see BlenderMaterialCompiler
    // (specScale: the BSDF's share of an emission mix; specF90: Glossy BSDF without Fresnel; noSpec: Diffuse BSDF).
    // With the Filament normal filter on, three's own geometryRoughness (added to the roughness there) is taken back out:
    // the filter already widens the lobe by the same normal derivatives, and both together turned thin curved brass and
    // steel trims fully rough (about +0.5 each at walking distance)
    const geomOff = specAA && !(globalThis.RR_FLAGS || {}).geomrough;
    const post = [geomOff ? 'material.roughness = min( max( roughnessFactor, 0.0525 ), 1.0 );' : '',
      res.specScale ? `{ float blSS = ${res.specScale}; material.specularColor *= blSS; material.specularF90 *= blSS; }` : '',
      res.specF90 ? `material.specularF90 = clamp(${res.specF90}, 0.0, 1.0);` : '',
      res.noSpec ? 'material.specularColor = vec3(0.0); material.specularF90 = 0.0;' : ''].filter(Boolean).join('\n  ');
    if (post) shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
  ${post}`);
  };
  // (cls marks the graphs only progcut 2 merges: alpha kind ss / tex / mul, and b for unlit)
  if (Object.keys(uniforms).every(u => u === 'blK' || /^blTex\d+$/.test(u))) { const cls = (ssAlpha ? 'ss' : compiled.alphaTex ? 'tex' : res.alpha ? 'mul' : 'op') + (material.isMeshBasicMaterial ? 'b' : '');
    PC_INFO.set(compiled, { body, res, nK: compiled.nK, nT: Math.max(0, ...Object.keys(uniforms).filter(u => u !== 'blK').map(u => +u.slice(5) + 1)), cls: cls === 'op' ? '' : cls, alphaTex: compiled.alphaTex || [] }); }
  material.customProgramCacheKey = () => PC_GROUP.has(compiled) ? PC_GROUP.get(compiled).key + (compiled.alphaTex && !ssAlpha && HASH_RE.test(material.name || '') ? '|ah' : '') + ((globalThis.RR_FLAGS || {}).nospecaa ? '' : (globalThis.RR_FLAGS || {}).geomrough ? '|saa1' : '|saa2') : 'bl:' + compiled.key + ':' + Object.keys(uniforms).filter(u => u !== 'blK').length + (/\bblL1\b/.test(lib) ? '|L1' : '') + (compiled.alphaTex && HASH_RE.test(material.name || '') ? '|ah' : '') + ((globalThis.RR_FLAGS || {}).nospecaa ? '' : (globalThis.RR_FLAGS || {}).geomrough ? '|saa1' : '|saa2');
  material.needsUpdate = true;
}

// Principled inputs the glTF export carries wrongly or not at all, set on the three material from the Blender node
// (Blender 5.x Cycles semantics, intern/cycles/kernel/svm/closure.h). Uniform values only: no material changes its
// shader program. Applies to every material with a graph, compiled or not (369 materials have no linked Principled
// input and take everything from the glTF). Returns the list of changes, or null.
//  sheen: the exporter writes sheenColorFactor = Sheen Tint and drops Sheen Weight, so three drew every fabric with a
//    full strength sheen (weights 0.1 to 0.6 in the file: 1.7x to 10x too bright at grazing angles) and darkened its
//    base by the full 16 % sheen energy share
//  specular: Specular IOR Level L below 0.5 exports as specularFactor 2L, which three applies to F90 as well; Cycles
//    scales F0 only (f0 *= 2L, eta from f0) and keeps the Fresnel rim at 1. Moved into specularColor (F0 only).
//  ior: KHR_materials_ior is exported only next to transmission, volume or specular, so IOR 1.45 / 1.52 / 1.2 read as 1.5
export function principledExtras(material, src) {
  const g = src?.graph; if (!g || !material?.isMeshPhysicalMaterial) return null;
  const byName = (nm) => g.nodes.find(n => n.name === nm);
  const out = g.nodes.filter(n => n.type === 'OUTPUT_MATERIAL'); const o = out.find(n => n.is_active_output && n.target !== 'EEVEE') || out.find(n => n.is_active_output) || out[0];
  let l = o && g.links.find(x => x[2] === o.name && x[3] === 'Surface'); let n = l && byName(l[0]);
  while (n && n.type === 'REROUTE') { l = g.links.find(x => x[2] === n.name && x[3] === 'Input'); n = l && byName(l[0]); }
  if (n && n.type === 'MIX_SHADER') { // a cutout or emission mix around one Principled (rot_perf, cl_copper_perf, rot_sky_proc)
    const sides = ['Shader', 'Shader_001'].map(s => g.links.find(x => x[2] === n.name && x[3] === s)).map(x => x && byName(x[0]));
    const P = sides.filter(x => x?.type === 'BSDF_PRINCIPLED'), other = sides.filter(x => x && x.type !== 'BSDF_PRINCIPLED');
    n = P.length === 1 && other.length === 1 && ['BSDF_TRANSPARENT', 'EMISSION'].includes(other[0].type) ? P[0] : null;
  }
  if (!n || n.type !== 'BSDF_PRINCIPLED') return null;
  const i = n.in || {}, lk = (s) => g.links.some(x => x[2] === n.name && x[3] === s), num = (s) => !lk(s) && typeof i[s] === 'number' ? i[s] : null;
  const ch = [];
  const sw = num('Sheen Weight');
  if (material.sheen > 0 && sw !== null && sw < 1 && !material.userData.sheenW) { material.sheenColor.multiplyScalar(Math.max(sw, 0)); material.userData.sheenW = sw; ch.push('sheen x' + sw); }
  const L = num('Specular IOR Level');
  // (L = 0 stays as exported: Cycles then has no specular lobe at all, eta 1, which specularFactor 0 already gives)
  if (L !== null && L > 1e-4 && L < 0.5 && Math.abs(material.specularIntensity - 2 * L) < 1e-3 && !material.userData.specL) {
    material.specularColor.multiplyScalar(material.specularIntensity); material.specularIntensity = 1; material.userData.specL = L; ch.push('specular F0 x' + (2 * L) + ', F90 1');
  }
  const ior = num('IOR');
  if (ior !== null && ior >= 1 && Math.abs(material.ior - ior) > 1e-3 && !(material.transmission > 0)) { material.ior = ior; ch.push('ior ' + ior); }
  return ch.length ? ch : null;
}

// Per-geometry attributes the graphs need: Blender "Generated" coordinates (object bounding box, Blender axes)
// and the Object Info random value.
export function addBlenderAttributes(mesh, seed) {
  const g = mesh.geometry; if (g.getAttribute('blGen')) return;
  const p = g.getAttribute('position'); const n = p.count; const gen = new Float32Array(n * 3);
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) { const b = [p.getX(i), -p.getZ(i), p.getY(i)]; for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], b[k]); mx[k] = Math.max(mx[k], b[k]); } }
  const sz = mx.map((v, k) => (v - mn[k]) || 1);
  for (let i = 0; i < n; i++) { const b = [p.getX(i), -p.getZ(i), p.getY(i)]; for (let k = 0; k < 3; k++) gen[i * 3 + k] = (b[k] - mn[k]) / sz[k]; }
  g.setAttribute('blGen', new THREE.BufferAttribute(gen, 3));
  // object-space position in Blender axes, kept as an attribute so the mesh can later be merged in world space
  const obj = new Float32Array(n * 3); for (let i = 0; i < n; i++) { obj[i * 3] = p.getX(i); obj[i * 3 + 1] = -p.getZ(i); obj[i * 3 + 2] = p.getY(i); }
  g.setAttribute('blObj', new THREE.BufferAttribute(obj, 3));
  let h = 2166136261; for (const ch of String(seed)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  g.setAttribute('blRand', new THREE.BufferAttribute(new Float32Array(n).fill((h % 100000) / 100000), 1));
}
