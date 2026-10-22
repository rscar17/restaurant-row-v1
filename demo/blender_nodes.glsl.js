// Blender shader-node functions for three.js (WebGL2 / GLSL ES 3.00).
// Ported from Blender's own GPU shader sources (source/blender/gpu/shaders/{material,nodes}, GPL-2.0-or-later),
// so procedural materials evaluate with the same hash, Perlin noise, fBM, wave, brick, map range, color ramp and
// blend math that Cycles/Eevee use. Only the nodes the Restaurant Row scene actually uses are included.
export const BLENDER_NODES_GLSL = /* glsl */ `
#define BL_PI 3.14159265358979
// ---- Jenkins lookup3 hash (gpu_shader_common_hash)
uint bl_rot(uint x, uint k) { return (x << k) | (x >> (32u - k)); }
void bl_hash_mix(inout uint a, inout uint b, inout uint c) {
  a -= c; a ^= bl_rot(c, 4u); c += b;
  b -= a; b ^= bl_rot(a, 6u); a += c;
  c -= b; c ^= bl_rot(b, 8u); b += a;
  a -= c; a ^= bl_rot(c, 16u); c += b;
  b -= a; b ^= bl_rot(a, 19u); a += c;
  c -= b; c ^= bl_rot(b, 4u); b += a;
}
void bl_hash_final(inout uint a, inout uint b, inout uint c) {
  c ^= b; c -= bl_rot(b, 14u);
  a ^= c; a -= bl_rot(c, 11u);
  b ^= a; b -= bl_rot(a, 25u);
  c ^= b; c -= bl_rot(b, 16u);
  a ^= c; a -= bl_rot(c, 4u);
  b ^= a; b -= bl_rot(a, 14u);
  c ^= b; c -= bl_rot(b, 24u);
}
uint bl_hash_uint(uint kx) { uint a, b, c; a = b = c = 0xdeadbeefu + (1u << 2u) + 13u; a += kx; bl_hash_final(a, b, c); return c; }
uint bl_hash_uint2(uint kx, uint ky) { uint a, b, c; a = b = c = 0xdeadbeefu + (2u << 2u) + 13u; b += ky; a += kx; bl_hash_final(a, b, c); return c; }
uint bl_hash_uint3(uint kx, uint ky, uint kz) { uint a, b, c; a = b = c = 0xdeadbeefu + (3u << 2u) + 13u; c += kz; b += ky; a += kx; bl_hash_final(a, b, c); return c; }
uint bl_hash_uint4(uint kx, uint ky, uint kz, uint kw) { uint a, b, c; a = b = c = 0xdeadbeefu + (4u << 2u) + 13u; a += kx; b += ky; c += kz; bl_hash_mix(a, b, c); a += kw; bl_hash_final(a, b, c); return c; }
uint bl_hash_int3(int x, int y, int z) { return bl_hash_uint3(uint(x), uint(y), uint(z)); }
float bl_u2f(uint h) { return float(h) / 4294967295.0; }
float bl_hash_float_to_float(float k) { return bl_u2f(bl_hash_uint(floatBitsToUint(k))); }
float bl_hash_vec2_to_float(vec2 k) { return bl_u2f(bl_hash_uint2(floatBitsToUint(k.x), floatBitsToUint(k.y))); }
float bl_hash_vec3_to_float(vec3 k) { return bl_u2f(bl_hash_uint3(floatBitsToUint(k.x), floatBitsToUint(k.y), floatBitsToUint(k.z))); }
float bl_hash_vec4_to_float(vec4 k) { return bl_u2f(bl_hash_uint4(floatBitsToUint(k.x), floatBitsToUint(k.y), floatBitsToUint(k.z), floatBitsToUint(k.w))); }
vec3 bl_hash_vec3_to_vec3(vec3 k) { return vec3(bl_hash_vec3_to_float(k), bl_hash_vec4_to_float(vec4(k, 1.0)), bl_hash_vec4_to_float(vec4(k, 2.0))); }
float bl_integer_noise(int n) {
  uint nn = (uint(n) + 1013u) & 0x7fffffffu;
  nn = (nn >> 13u) ^ nn;
  nn = (uint(nn * (nn * nn * 60493u + 19990303u)) + 1376312589u) & 0x7fffffffu;
  return 0.5 * (float(nn) / 1073741824.0);
}
// ---- Perlin noise (gpu_shader_material_noise)
float bl_fade(float t) { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }
float bl_negate_if(float v, uint c) { return (c != 0u) ? -v : v; }
float bl_grad3(uint hash, float x, float y, float z) {
  uint h = hash & 15u;
  float u = h < 8u ? x : y;
  float vt = ((h == 12u) || (h == 14u)) ? x : z;
  float v = h < 4u ? y : vt;
  return bl_negate_if(u, h & 1u) + bl_negate_if(v, h & 2u);
}
float bl_tri_mix(float v0, float v1, float v2, float v3, float v4, float v5, float v6, float v7, float x, float y, float z) {
  float x1 = 1.0 - x, y1 = 1.0 - y, z1 = 1.0 - z;
  return z1 * (y1 * (v0 * x1 + v1 * x) + y * (v2 * x1 + v3 * x)) + z * (y1 * (v4 * x1 + v5 * x) + y * (v6 * x1 + v7 * x));
}
float bl_perlin3(vec3 p) {
  vec3 fl = floor(p); ivec3 I = ivec3(fl); vec3 f = p - fl;
  float u = bl_fade(f.x), v = bl_fade(f.y), w = bl_fade(f.z);
  return bl_tri_mix(
    bl_grad3(bl_hash_int3(I.x, I.y, I.z), f.x, f.y, f.z),
    bl_grad3(bl_hash_int3(I.x + 1, I.y, I.z), f.x - 1.0, f.y, f.z),
    bl_grad3(bl_hash_int3(I.x, I.y + 1, I.z), f.x, f.y - 1.0, f.z),
    bl_grad3(bl_hash_int3(I.x + 1, I.y + 1, I.z), f.x - 1.0, f.y - 1.0, f.z),
    bl_grad3(bl_hash_int3(I.x, I.y, I.z + 1), f.x, f.y, f.z - 1.0),
    bl_grad3(bl_hash_int3(I.x + 1, I.y, I.z + 1), f.x - 1.0, f.y, f.z - 1.0),
    bl_grad3(bl_hash_int3(I.x, I.y + 1, I.z + 1), f.x, f.y - 1.0, f.z - 1.0),
    bl_grad3(bl_hash_int3(I.x + 1, I.y + 1, I.z + 1), f.x - 1.0, f.y - 1.0, f.z - 1.0), u, v, w);
}
vec3 bl_compatible_mod(vec3 a, float b) { return a - b * floor(a / b); }
float bl_snoise3(vec3 p) {
  vec3 pc = 0.5 * vec3(greaterThanEqual(abs(p), vec3(1000000.0)));
  p = bl_compatible_mod(p, 100000.0) + pc;
  return 0.9820 * bl_perlin3(p);
}
float bl_fbm3(vec3 p, float detail, float roughness, float lacunarity, bool normalize) {
  float fscale = 1.0, amp = 1.0, maxamp = 0.0, sum = 0.0;
  float fw = length(fwidth(p));   // agent look Oct 21: octaves finer than about a pixel fade to their mean (white specks on the limestone returns at grazing angles)
  int n = int(detail);
  for (int i = 0; i <= 15 * blL1; i++) {
    if (i > n) break;
    float t = bl_snoise3(fscale * p) * (1.0 - smoothstep(0.35, 0.7, fw * fscale));
    sum += t * amp; maxamp += amp; amp *= roughness; fscale *= lacunarity;
  }
  float rmd = detail - floor(detail);
  if (rmd != 0.0) {
    float t = bl_snoise3(fscale * p) * (1.0 - smoothstep(0.35, 0.7, fw * fscale));
    float sum2 = sum + t * amp;
    return normalize ? mix(0.5 * sum / maxamp + 0.5, 0.5 * sum2 / (maxamp + amp) + 0.5, rmd) : mix(sum, sum2, rmd);
  }
  return normalize ? 0.5 * sum / maxamp + 0.5 : sum;
}
vec3 bl_rand3_offset(float seed) {
  return vec3(100.0 + bl_hash_vec2_to_float(vec2(seed, 0.0)) * 100.0,
              100.0 + bl_hash_vec2_to_float(vec2(seed, 1.0)) * 100.0,
              100.0 + bl_hash_vec2_to_float(vec2(seed, 2.0)) * 100.0);
}
// Noise Texture, 3D, fBM (the only mode the scene uses). Returns fac in .x and colour in .yzw.
void bl_tex_noise_fbm3(vec3 co, float scale, float detail, float roughness, float lacunarity, float distortion, bool normalize, bool color, out float fac, out vec3 col) {
  detail = clamp(detail, 0.0, 15.0); roughness = max(roughness, 0.0);
  vec3 p = co * scale;
  if (distortion != 0.0) {
    p += vec3(bl_snoise3(p + bl_rand3_offset(0.0)) * distortion,
              bl_snoise3(p + bl_rand3_offset(1.0)) * distortion,
              bl_snoise3(p + bl_rand3_offset(2.0)) * distortion);
  }
  fac = bl_fbm3(p, detail, roughness, lacunarity, normalize);
  col = vec3(fac);
  if (color) {
    col = vec3(fac, bl_fbm3(p + bl_rand3_offset(3.0), detail, roughness, lacunarity, normalize), bl_fbm3(p + bl_rand3_offset(4.0), detail, roughness, lacunarity, normalize));
  }
}
// ---- Wave texture
float bl_tex_wave(vec3 co, float scale, float distortion, float detail, float dscale, float drough, float phase, int wtype, int bdir, int rdir, int prof) {
  vec3 p = co * scale; p = (p + 0.000001) * 0.999999;
  float n;
  if (wtype == 0) { n = bdir == 0 ? p.x * 20.0 : bdir == 1 ? p.y * 20.0 : bdir == 2 ? p.z * 20.0 : (p.x + p.y + p.z) * 10.0; }
  else { vec3 rp = p; if (rdir == 0) rp *= vec3(0, 1, 1); else if (rdir == 1) rp *= vec3(1, 0, 1); else if (rdir == 2) rp *= vec3(1, 1, 0); n = length(rp) * 20.0; }
  n += phase;
  if (distortion != 0.0) n += distortion * (bl_fbm3(p * dscale, detail, drough, 2.0, true) * 2.0 - 1.0);
  // band-limit: Cycles averages many samples per pixel, a browser takes one. Once the bands get finer than a pixel the
  // pattern (and any bump driven by it) aliases into moire / a woven look, so fade it toward its mean (Gaussian pixel
  // footprint on the phase). Unchanged where the bands are a few pixels wide or more.
  // bump is taken from screen derivatives over 2x2 pixel quads, so bands under ~4 px turn into a dot grid: fade from 10 px down to 4 px
  // (6 to 14 px since Oct 13: Matteo's 2.2 cm glazing ribs still beat into zebra stripes between 4 and 10 px)
  float aa = smoothstep(6.0, 14.0, 6.2831853 / max(fwidth(n), 1e-6));
  if (prof == 0) return 0.5 + 0.5 * aa * sin(n - BL_PI * 0.5);
  if (prof == 1) { n /= 2.0 * BL_PI; return mix(0.5, n - floor(n), aa); }
  n /= 2.0 * BL_PI; return mix(0.5, abs(n - floor(n + 0.5)) * 2.0, aa);
}
// ---- Brick texture
vec2 bl_brick(vec3 p, float msize, float msmooth, float bias, float bw, float rh, float oamt, int ofreq, float samt, int sfreq) {
  // pixel footprint in brick space: a hard mortar line thinner than a pixel breaks into dots and dashes (Ryan, floor
  // grout), so the line gets its true coverage instead (a faint even line far away, unchanged up close)
  float fw = max(fwidth(p.x) + fwidth(p.y), 1e-6);
  int rownum = int(floor(p.y / rh)); float offset = 0.0;
  if (ofreq != 0 && sfreq != 0) {
    bw *= ((rownum % sfreq) != 0) ? 1.0 : samt;
    offset = ((rownum % ofreq) != 0) ? 0.0 : (bw * oamt);
  }
  int bricknum = int(floor((p.x + offset) / bw));
  float x = (p.x + offset) - bw * float(bricknum), y = p.y - rh * float(rownum);
  float tint = clamp(bl_integer_noise((rownum << 16) + (bricknum & 0xFFFF)) + bias, 0.0, 1.0);
  float md = min(min(x, y), min(bw - x, rh - y));
  // true coverage only: a line half a pixel wide draws at half strength and never fades out (the squared fade made the
  // grid vanish a few metres out: Ryan, 'why do the tiles stop')
  // box filtered per axis (the pixel's footprint across the vertical joints is fwidth(p.x), across the horizontal joints
  // fwidth(p.y)): the overlap of the pixel with the joint, so the two pixels a joint straddles always add up to its full
  // width and a thin joint stays a continuous faint line instead of beads (m20 audit: beaded grout in the mid and far
  // field); once the footprint covers whole bricks it settles on the joint's mean coverage
  if (msmooth == 0.0) {
    float wx = max(fwidth(p.x), 1e-6), wy = max(fwidth(p.y), 1e-6);
    float dx = min(x, bw - x), dy = min(y, rh - y);
    float cx = clamp((min(dx + 0.5 * wx, msize) - max(dx - 0.5 * wx, -msize)) / wx, 0.0, 1.0);
    float cy = clamp((min(dy + 0.5 * wy, msize) - max(dy - 0.5 * wy, -msize)) / wy, 0.0, 1.0);
    cx = mix(cx, min(1.0, 2.0 * msize / bw), smoothstep(0.5 * bw, bw, wx));
    cy = mix(cy, min(1.0, 2.0 * msize / rh), smoothstep(0.5 * rh, rh, wy));
    return vec2(tint, 1.0 - (1.0 - cx) * (1.0 - cy));
  }
  // soft mortar (rr_plain_floor: size 0.012, smooth 0.3): the exact profile where the joint is several pixels wide,
  // blending to the box filtered line (half width at the profile's midpoint) as it gets thinner, per axis. The unfiltered
  // profile broke every distant joint into beads (m20 to m31 audits, also in m17)
  float wx = max(fwidth(p.x), 1e-6), wy = max(fwidth(p.y), 1e-6);
  float dx = min(x, bw - x), dy = min(y, rh - y), he = msize * (1.0 - 0.5 * msmooth);
  float ex = dx >= msize ? 0.0 : smoothstep(0.0, msmooth, 1.0 - dx / msize), ey = dy >= msize ? 0.0 : smoothstep(0.0, msmooth, 1.0 - dy / msize);
  float bx = clamp((min(dx + 0.5 * wx, he) - max(dx - 0.5 * wx, -he)) / wx, 0.0, 1.0), by = clamp((min(dy + 0.5 * wy, he) - max(dy - 0.5 * wy, -he)) / wy, 0.0, 1.0);
  float cx = mix(ex, bx, smoothstep(0.15, 0.6, wx / msize)), cy = mix(ey, by, smoothstep(0.15, 0.6, wy / msize));
  cx = mix(cx, min(1.0, 2.0 * he / bw), smoothstep(0.5 * bw, bw, wx)); cy = mix(cy, min(1.0, 2.0 * he / rh), smoothstep(0.5 * rh, rh, wy));
  return vec2(tint, max(cx, cy));
}
void bl_tex_brick(vec3 co, vec3 c1, vec3 c2, vec3 mortar, float scale, float msize, float msmooth, float bias, float bw, float rh, float oamt, float ofreq, float samt, float sfreq, out vec3 col, out float fac) {
  vec2 f2 = bl_brick(co * scale, msize, msmooth, bias, bw, rh, oamt, int(ofreq), samt, int(sfreq));
  if (f2.y != 1.0) c1 = (1.0 - f2.x) * c1 + f2.x * c2;
  col = mix(c1, mortar, f2.y); fac = f2.y;
}
// ---- White noise (3D)
void bl_tex_white3(vec3 co, out float v, out vec3 c) { v = bl_hash_vec3_to_float(co); c = bl_hash_vec3_to_vec3(co); }
// ---- Voronoi F1 Euclidean 3D (the scene's three voronoi nodes)
void bl_voronoi_f1_3d(vec3 co, float scale, float rnd, out float dist, out vec3 col, out vec3 pos) {
  vec3 coord = co * scale; vec3 cellPos = floor(coord); vec3 local = coord - cellPos;
  float md = 8.0; vec3 tOff = vec3(0); vec3 tPos = vec3(0);
  for (int k = -blL1; k <= blL1; k++) for (int j = -blL1; j <= blL1; j++) for (int i = -blL1; i <= blL1; i++) {
    vec3 off = vec3(i, j, k);
    vec3 pp = off + bl_hash_vec3_to_vec3(cellPos + off) * clamp(rnd, 0.0, 1.0);
    float d = distance(pp, local);
    if (d < md) { tOff = off; md = d; tPos = pp; }
  }
  dist = md; col = bl_hash_vec3_to_vec3(cellPos + tOff); pos = (tPos + cellPos) / scale;
}
// ---- Colour utilities (gpu_shader_common_color_utils)
vec3 bl_rgb_to_hsv(vec3 rgb) {
  float cmax = max(rgb.r, max(rgb.g, rgb.b));
  float cmin = min(rgb.r, min(rgb.g, rgb.b));
  float cd = cmax - cmin;
  float h = 0.0;
  float s = cmax != 0.0 ? cd / cmax : 0.0;
  float v = cmax;
  if (s != 0.0) {
    vec3 c = (vec3(cmax) - rgb) / cd;
    if (rgb.r == cmax) h = c.b - c.g; else if (rgb.g == cmax) h = 2.0 + c.r - c.b; else h = 4.0 + c.g - c.r;
    h /= 6.0; if (h < 0.0) h += 1.0;
  }
  return vec3(h, s, v);
}
vec3 bl_hsv_to_rgb(vec3 hsv) {
  float h = hsv.x, s = hsv.y, v = hsv.z;
  if (s == 0.0) return vec3(v);
  if (h == 1.0) h = 0.0;
  h *= 6.0; float i = floor(h); float f = h - i; float p = v * (1.0 - s); float q = v * (1.0 - s * f); float t = v * (1.0 - s * (1.0 - f));
  if (i == 0.0) return vec3(v, t, p); if (i == 1.0) return vec3(q, v, p); if (i == 2.0) return vec3(p, v, t);
  if (i == 3.0) return vec3(p, q, v); if (i == 4.0) return vec3(t, p, v); return vec3(v, p, q);
}
vec3 bl_hue_sat(float hue, float sat, float val, float fac, vec3 col) {
  vec3 hsv = bl_rgb_to_hsv(col);
  hsv.x = fract(hsv.x + hue + 0.5); hsv.y = clamp(hsv.y * sat, 0.0, 1.0); hsv.z *= val;
  return mix(col, bl_hsv_to_rgb(hsv), fac);
}
float bl_rgb_to_bw(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 bl_bright_contrast(vec3 col, float bright, float contrast) {
  float a = 1.0 + contrast, b = bright - contrast * 0.5;
  return max(a * col + b, vec3(0.0));
}
// ---- Mix (gpu_shader_common_mix_rgb), clamp handled by the caller
vec3 bl_mix_overlay(float f, vec3 a, vec3 b) {
  float fm = 1.0 - f; vec3 o = a;
  for (int i = 0; i < 3; i++) o[i] = a[i] < 0.5 ? a[i] * (fm + 2.0 * f * b[i]) : 1.0 - (fm + 2.0 * f * (1.0 - b[i])) * (1.0 - a[i]);
  return o;
}
vec3 bl_mix_dodge(float f, vec3 a, vec3 b) {
  vec3 o = a;
  for (int i = 0; i < 3; i++) { if (o[i] != 0.0) { float t = 1.0 - f * b[i]; o[i] = t <= 0.0 ? 1.0 : min(o[i] / t, 1.0); } }
  return o;
}
vec3 bl_mix_burn(float f, vec3 a, vec3 b) {
  float fm = 1.0 - f; vec3 o = a;
  for (int i = 0; i < 3; i++) { float t = fm + f * b[i]; o[i] = t <= 0.0 ? 0.0 : clamp(1.0 - (1.0 - a[i]) / t, 0.0, 1.0); }
  return o;
}
vec3 bl_mix_soft(float f, vec3 a, vec3 b) { float fm = 1.0 - f; vec3 one = vec3(1.0); vec3 scr = one - (one - b) * (one - a); return fm * a + f * ((one - a) * b * a + a * scr); }
vec3 bl_mix_linear(float f, vec3 a, vec3 b) { return a + f * (2.0 * (b - vec3(0.5))); }
vec3 bl_mix_color(float f, vec3 a, vec3 b) {
  vec3 h2 = bl_rgb_to_hsv(b);
  if (h2.y == 0.0) return a;
  vec3 h = bl_rgb_to_hsv(a); h.x = h2.x; h.y = h2.y; return mix(a, bl_hsv_to_rgb(h), f);
}
vec3 bl_mix_hue(float f, vec3 a, vec3 b) {
  vec3 h2 = bl_rgb_to_hsv(b);
  if (h2.y == 0.0) return a;
  vec3 h = bl_rgb_to_hsv(a); h.x = h2.x; return mix(a, bl_hsv_to_rgb(h), f);
}
vec3 bl_mix_sat(float f, vec3 a, vec3 b) {
  vec3 h = bl_rgb_to_hsv(a);
  if (h.y == 0.0) return a;
  vec3 h2 = bl_rgb_to_hsv(b); h.y = mix(h.y, h2.y, f); return bl_hsv_to_rgb(h);
}
vec3 bl_mix_val(float f, vec3 a, vec3 b) { vec3 h = bl_rgb_to_hsv(a); vec3 h2 = bl_rgb_to_hsv(b); h.z = mix(h.z, h2.z, f); return bl_hsv_to_rgb(h); }
// ---- Map Range
float bl_safe_div(float a, float b) { return b != 0.0 ? a / b : 0.0; }
float bl_map_range(float v, float fmin, float fmax, float tmin, float tmax, float steps, int mode, bool clampit) {
  float r;
  if (mode == 1) { // stepped
    float f = bl_safe_div(v - fmin, fmax - fmin); f = steps > 0.0 ? floor(f * (steps + 1.0)) / steps : 0.0; r = tmin + f * (tmax - tmin);
  } else if (mode == 2) { // smoothstep
    float f = (fmin > fmax) ? 1.0 - smoothstep(fmax, fmin, v) : smoothstep(fmin, fmax, v); return tmin + f * (tmax - tmin);
  } else if (mode == 3) { // smootherstep
    float x = clamp(bl_safe_div(v - min(fmin, fmax), abs(fmax - fmin)), 0.0, 1.0); x = x * x * x * (x * (x * 6.0 - 15.0) + 10.0);
    float f = (fmin > fmax) ? 1.0 - x : x; return tmin + f * (tmax - tmin);
  } else {
    r = tmin + bl_safe_div(v - fmin, fmax - fmin) * (tmax - tmin);
  }
  if (clampit && mode < 2) r = tmin > tmax ? clamp(r, tmax, tmin) : clamp(r, tmin, tmax);
  return r;
}
// ---- Math node operations that are not one-liners
float bl_pingpong(float a, float b) { return b != 0.0 ? abs(fract((a - b) / (b * 2.0)) * b * 2.0 - b) : 0.0; }
float bl_wrap(float a, float mx, float mn) { float r = mx - mn; return r != 0.0 ? a - r * floor((a - mn) / r) : mn; }
float bl_smoothmin(float a, float b, float c) { if (c != 0.0) { float h = max(c - abs(a - b), 0.0) / c; return min(a, b) - h * h * h * c * (1.0 / 6.0); } return min(a, b); }
float bl_safe_pow(float a, float b) { if (a >= 0.0 || fract(b) == 0.0) return pow(abs(a), b) * (a < 0.0 && mod(b, 2.0) != 0.0 ? -1.0 : 1.0); return 0.0; }
float bl_safe_log(float a, float b) { return (a > 0.0 && b > 0.0) ? log(a) / log(b) : 0.0; }
float bl_safe_sqrt(float a) { return a > 0.0 ? sqrt(a) : 0.0; }
float bl_safe_mod(float a, float b) { return b != 0.0 ? mod(a, b) : 0.0; }
float bl_compat_mod(float a, float b) { return b != 0.0 ? a - b * trunc(a / b) : 0.0; }
vec3 bl_safe_div3(vec3 a, vec3 b) { return vec3(bl_safe_div(a.x, b.x), bl_safe_div(a.y, b.y), bl_safe_div(a.z, b.z)); }
// ---- Layer Weight
vec2 bl_layer_weight(float blend, vec3 N, vec3 V) {
  float eta = max(1.0 - blend, 0.00001);
  float c = abs(dot(V, N)); float e = 1.0 / eta; float g = e * e - 1.0 + c * c; float fres = 1.0;
  if (g > 0.0) { g = sqrt(g); float A = (g - c) / (g + c), B = (c * (g + c) - 1.0) / (c * (g - c) + 1.0); fres = 0.5 * A * A * (1.0 + B * B); }
  float facing = abs(dot(V, N));
  if (blend != 0.5) { blend = clamp(blend, 0.0, 0.99999); blend = blend < 0.5 ? 2.0 * blend : 0.5 / (1.0 - blend); facing = pow(facing, blend); }
  return vec2(fres, 1.0 - facing);
}
// ---- Blackbody (approximation of Blender's table, good to a few percent in 800 K to 12000 K)
vec3 bl_blackbody(float t) {
  t = clamp(t, 800.0, 12000.0) / 100.0;
  float r = t <= 66.0 ? 1.0 : clamp(1.29293618606 * pow(t - 60.0, -0.1332047592), 0.0, 1.0);
  float g = t <= 66.0 ? clamp(0.390081578769 * log(t) - 0.631841443788, 0.0, 1.0) : clamp(1.12989086089 * pow(t - 60.0, -0.0755148492), 0.0, 1.0);
  float b = t >= 66.0 ? 1.0 : (t <= 19.0 ? 0.0 : clamp(0.543206789110 * log(t - 10.0) - 1.19625408914, 0.0, 1.0));
  // Blender's node returns luminance 1, not max 1: the glTF export of rot_cove_led (2700 K, strength 8) is factor
  // (1, 0.415, 0.099) x 15.48, and 15.48 / 8 = 1.935 = 1 / luminance; 4500 K gives 1.30 = 1 / 0.769 the same way.
  // The max 1 version drew every Blackbody emitter (cove LEDs, sconces, candles) about 2x too dark at 2700 K.
  vec3 s = pow(vec3(r, g, b), vec3(2.2)); return s / max(dot(s, vec3(0.2126, 0.7152, 0.0722)), 1e-4);
}
// ---- Bump (gpu_shader_material_bump): height derivatives from the screen, like Eevee
vec3 bl_bump(float strength, float dist, float filterWidth, float height, vec3 N, vec3 P, bool invert) {
  N = normalize(N);
  dist *= gl_FrontFacing ? (invert ? -1.0 : 1.0) : (invert ? 1.0 : -1.0);
  vec3 dPdx = dFdx(P), dPdy = dFdy(P);
  vec3 Rx = cross(dPdy, N), Ry = cross(N, dPdx);
  float det = dot(dPdx, Rx);
  vec2 dHd = vec2(dFdx(height), dFdy(height));
  vec3 surfgrad = dHd.x * Rx + dHd.y * Ry;
  // a height step that happens within one or two pixels (grout joints far away) gives quad derivatives that flip from
  // quad to quad: dashed joints. Cycles averages it away, so the bump fades out where the height jumps by more than a
  // half of its range per pixel
  float hj = max(abs(dHd.x), abs(dHd.y));
  strength = max(strength, 0.0) * (1.0 - smoothstep(0.5, 0.9, hj)); // (0.08..0.3 also flattened the reeded glass ribs)
  vec3 r = normalize(filterWidth * abs(det) * N - dist * sign(det) * surfgrad);
  return normalize(mix(N, r, strength));
}
`;

// Blender 5.0 voronoi, kept apart from the main library and added only to programs that call bl_voronoi3: every other
// program stays byte for byte as before (the tree shaker writes one line per gap between library functions)
export const BLENDER_VORONOI5_GLSL = /* glsl */ `
// ---- Voronoi as Blender 5.0 evaluates it (gpu_shader_material_voronoi.glsl and fractal_voronoi.glsl at Detail 0, the
// same as Cycles svm/voronoi.h): PCG cell hash (hash_pcg3d_i), F1 with the four metrics and Distance to Edge. Used only
// by graphs with a Distance to Edge or non Euclidean voronoi node (pm_mosaic_champagne, del_stone), so the old F1
// (bl_voronoi_f1_3d) and the materials built on it stay exactly as they were. The int math runs on uint (wraps the same way bit for bit);
// the one signed shift goes through int so it stays arithmetic as in Blender.
vec3 bl_hash_pcg3i_to_vec3(ivec3 k) {
  uvec3 v = uvec3(k) * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v = v ^ uvec3(ivec3(v) >> 16);
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return vec3(v & 0x7fffffffu) * (1.0 / float(0x7fffffff));
}
float bl_voronoi_metric3(vec3 a, vec3 b, int metric, float ex) {
  vec3 d = abs(a - b);
  if (metric == 1) return d.x + d.y + d.z;
  if (metric == 2) return max(d.x, max(d.y, d.z));
  if (metric == 3) return pow(pow(d.x, ex) + pow(d.y, ex) + pow(d.z, ex), 1.0 / ex);
  return length(a - b);
}
// feature 0 = F1, 3 = Distance to Edge (Blender's SHD_VORONOI_* numbering); metric 0..3 = Euclidean, Manhattan,
// Chebychev, Minkowski. Distance to Edge ignores the metric, as in Blender.
void bl_voronoi3(vec3 co, float scale, float rnd, float ex, int metric, int feature, bool nrm, out float dist, out vec3 col, out vec3 pos) {
  rnd = clamp(rnd, 0.0, 1.0);
  vec3 coord = co * scale; vec3 cpf = floor(coord); vec3 lp = coord - cpf; ivec3 cp = ivec3(cpf);
  col = vec3(0.0); pos = vec3(0.0);
  if (feature == 3) {
    vec3 toClosest = vec3(0.0); float md = 3.4e38;
    for (int k = -blL1; k <= blL1; k++) for (int j = -blL1; j <= blL1; j++) for (int i = -blL1; i <= blL1; i++) {
      ivec3 off = ivec3(i, j, k); vec3 v = vec3(off) + bl_hash_pcg3i_to_vec3(cp + off) * rnd - lp;
      float d = dot(v, v); if (d < md) { md = d; toClosest = v; }
    }
    md = 3.4e38;
    for (int k = -blL1; k <= blL1; k++) for (int j = -blL1; j <= blL1; j++) for (int i = -blL1; i <= blL1; i++) {
      ivec3 off = ivec3(i, j, k); vec3 v = vec3(off) + bl_hash_pcg3i_to_vec3(cp + off) * rnd - lp;
      vec3 perp = v - toClosest;
      if (dot(perp, perp) > 0.0001) md = min(md, dot((toClosest + v) / 2.0, normalize(perp)));
    }
    dist = nrm ? md / (0.5 + 0.5 * rnd) : md;
    return;
  }
  float md = 3.4e38; ivec3 tOff = ivec3(0); vec3 tPos = vec3(0.0);
  for (int k = -blL1; k <= blL1; k++) for (int j = -blL1; j <= blL1; j++) for (int i = -blL1; i <= blL1; i++) {
    ivec3 off = ivec3(i, j, k); vec3 pp = vec3(off) + bl_hash_pcg3i_to_vec3(cp + off) * rnd;
    float d = bl_voronoi_metric3(pp, lp, metric, ex); if (d < md) { tOff = off; md = d; tPos = pp; }
  }
  dist = nrm ? md / bl_voronoi_metric3(vec3(0.0), vec3(0.5 + 0.5 * rnd), metric, ex) : md;
  col = bl_hash_pcg3i_to_vec3(cp + tOff); pos = (tPos + cpf) / scale;
}
`;
// Only the functions a compiled graph actually calls (and what they call) go into its shader: D3D's shader compiler
// time grows with code size, and a cold first visit compiled every program with the whole library.
const _chunks = (() => {
  const src = BLENDER_NODES_GLSL; const out = []; let i = 0, pre = '';
  const re = /^[ \t]*(?:[A-Za-z_][\w]*[ \t]+)+(bl_\w+)[ \t]*\(/gm; let m; let last = 0;
  while ((m = re.exec(src))) {
    const start = m.index; if (start < last) continue;
    const open = src.indexOf('{', re.lastIndex); const semi = src.indexOf(';', re.lastIndex);
    if (open < 0 || (semi >= 0 && semi < open)) continue;
    let d = 0, j = open; for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (d === 0) break; } }
    if (start > last) pre += src.slice(last, start).split('\n').filter(l => /^\s*#/.test(l)).join('\n') + '\n';
    out.push({ name: m[1], text: src.slice(start, j + 1), idx: out.length }); last = j + 1; re.lastIndex = j + 1;
  }
  pre += src.slice(last).split('\n').filter(l => /^\s*#/.test(l)).join('\n');
  return { pre, fns: out };
})();
// blL1: a uniform int that is always 1 (blender_material.js BL_L1). The octave loop of the fBM noise and the 3 x 3 x 3 cell
// loops of the voronoi nodes run to it, the same iterations as their old constant bounds; a bound D3D's shader compiler
// cannot see keeps it from unrolling them (the exact voronoi programs stalled the first frame for about 150 s, m55)
// noisespec variants (blender_material.js TEX_NOISE, RR_FLAGS.noisespec): bl_fbm3i is bl_fbm3 for a whole Detail (no
// fractional octave); bl_tex_noise_fbm3_nd has no distortion (Distortion unlinked and 0), _ndi also a whole Detail,
// _di keeps the distortion with a whole Detail. Same arithmetic in the same order as the general versions.
// Kept out of BLENDER_NODES_GLSL (and appended only when a graph calls one) so programs without them stay byte identical.
export const BLENDER_NOISESPEC_GLSL = /* glsl */ `
float bl_fbm3i(vec3 p, float detail, float roughness, float lacunarity, bool normalize) {
  float fscale = 1.0, amp = 1.0, maxamp = 0.0, sum = 0.0;
  float fw = length(fwidth(p));   // agent look Oct 21: octaves finer than about a pixel fade to their mean (white specks on the limestone returns at grazing angles)
  int n = int(detail);
  for (int i = 0; i <= 15 * blL1; i++) {
    if (i > n) break;
    float t = bl_snoise3(fscale * p) * (1.0 - smoothstep(0.35, 0.7, fw * fscale));
    sum += t * amp; maxamp += amp; amp *= roughness; fscale *= lacunarity;
  }
  return normalize ? 0.5 * sum / maxamp + 0.5 : sum;
}
void bl_tex_noise_fbm3_nd(vec3 co, float scale, float detail, float roughness, float lacunarity, bool normalize, bool color, out float fac, out vec3 col) {
  detail = clamp(detail, 0.0, 15.0); roughness = max(roughness, 0.0);
  vec3 p = co * scale;
  fac = bl_fbm3(p, detail, roughness, lacunarity, normalize);
  col = vec3(fac);
  if (color) {
    col = vec3(fac, bl_fbm3(p + bl_rand3_offset(3.0), detail, roughness, lacunarity, normalize), bl_fbm3(p + bl_rand3_offset(4.0), detail, roughness, lacunarity, normalize));
  }
}
void bl_tex_noise_fbm3_ndi(vec3 co, float scale, float detail, float roughness, float lacunarity, bool normalize, bool color, out float fac, out vec3 col) {
  detail = clamp(detail, 0.0, 15.0); roughness = max(roughness, 0.0);
  vec3 p = co * scale;
  fac = bl_fbm3i(p, detail, roughness, lacunarity, normalize);
  col = vec3(fac);
  if (color) {
    col = vec3(fac, bl_fbm3i(p + bl_rand3_offset(3.0), detail, roughness, lacunarity, normalize), bl_fbm3i(p + bl_rand3_offset(4.0), detail, roughness, lacunarity, normalize));
  }
}
void bl_tex_noise_fbm3_di(vec3 co, float scale, float detail, float roughness, float lacunarity, float distortion, bool normalize, bool color, out float fac, out vec3 col) {
  detail = clamp(detail, 0.0, 15.0); roughness = max(roughness, 0.0);
  vec3 p = co * scale;
  if (distortion != 0.0) {
    p += vec3(bl_snoise3(p + bl_rand3_offset(0.0)) * distortion,
              bl_snoise3(p + bl_rand3_offset(1.0)) * distortion,
              bl_snoise3(p + bl_rand3_offset(2.0)) * distortion);
  }
  fac = bl_fbm3i(p, detail, roughness, lacunarity, normalize);
  col = vec3(fac);
  if (color) {
    col = vec3(fac, bl_fbm3i(p + bl_rand3_offset(3.0), detail, roughness, lacunarity, normalize), bl_fbm3i(p + bl_rand3_offset(4.0), detail, roughness, lacunarity, normalize));
  }
}
`;
export function shakeBlenderGLSL(code) {
  const ns = /\bbl_tex_noise_fbm3_(?:nd|ndi|di)\b/.test(code); if (ns) code += '\n' + BLENDER_NOISESPEC_GLSL;
  const need = new Set(); const stack = [...new Set(code.match(/bl_\w+/g) || [])];
  while (stack.length) { const n = stack.pop(); if (need.has(n)) continue; need.add(n);
    for (const f of _chunks.fns) if (f.name === n) for (const r of new Set(f.text.match(/bl_\w+/g) || [])) if (!need.has(r)) stack.push(r); }
  const lib = _chunks.pre + '\n' + _chunks.fns.filter(f => need.has(f.name)).map(f => f.text).join('\n') + (/\bbl_voronoi3\b/.test(code) ? '\n' + BLENDER_VORONOI5_GLSL : '') + (ns ? '\n' + BLENDER_NOISESPEC_GLSL : '');
  return (/\bblL1\b/.test(lib) ? 'uniform int blL1;\n' : '') + lib;
}
