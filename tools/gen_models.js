#!/usr/bin/env node
/* 程序化汽车 3D 模型生成器（零依赖，纯 Node）
 *
 * 产出 assets/models/ 下的 glTF 2.0 / GLB 资产——与 js/carModel.js 的程序化低模
 * 同源同尺寸（飞度 GR9：4.109×1.694×1.537m、轴距 2.53m、185/60 R15），但为
 * 通用 3D 资产规格：分材质、分节点、带车轮/后视镜枢轴，可直接导入 Blender/
 * three.js/Unity/微信小游戏，也可给本项目后续替换程序化车身用。
 *
 * 坐标约定（与游戏一致）：+Z 车头、+Y 向上、+X 车身左侧；1 单位 = 1 米；
 * 原点 = 车辆中心地面投影（y=0 即地面）。
 *
 * 用法：
 *   node tools/gen_models.js                # 生成全部车型 + 清单
 *   node tools/gen_models.js --only hatch   # 只生成飞度两厢
 *   node tools/gen_models.js --check        # 生成后回读校验 GLB/glTF 结构
 *   node tools/gen_models.js --out <dir>    # 指定输出目录
 */
'use strict';

var fs = require('fs');
var path = require('path');
var zlib = require('zlib');

var ROOT = path.resolve(__dirname, '..');
var DEFAULT_OUT = path.join(ROOT, 'assets', 'models');

var D2R = Math.PI / 180;

/* ---------- 程序化贴图（PNG 内嵌进 GLB 的 bufferView） ---------- */

var CRC_TABLE = (function () {
  var t = new Uint32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  var c = 0xFFFFFFFF;
  for (var i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** 确定性哈希噪声（0..1），保证每次生成结果一致 */
function noise2(x, y, seed) {
  var n = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0;
  n = (n ^ (n >>> 13)) | 0;
  n = Math.imul(n, 1274126177) | 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function pngFromRGB(w, h, pixelFn) {
  var raw = Buffer.alloc((w * 3 + 1) * h);
  for (var y = 0; y < h; y++) {
    var row = y * (w * 3 + 1);
    raw[row] = 0;                       // filter: none
    for (var x = 0; x < w; x++) {
      var c = pixelFn(x, y);
      raw[row + 1 + x * 3] = c[0];
      raw[row + 2 + x * 3] = c[1];
      raw[row + 3 + x * 3] = c[2];
    }
  }
  var idat = zlib.deflateSync(raw, { level: 9 });
  function chunk(type, data) {
    var len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    var td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    var crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
    return Buffer.concat([len, td, crc]);
  }
  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))
  ]);
}

/** 生成贴图：织物 / 地毯 / 塑料颗粒 —— 只做明暗噪声，颜色仍由材质基色决定 */
var TEXTURES = {
  fabric: { size: 64, scale: 26, build: function (x, y) {
    var weave = ((x + y) % 4 < 2) ? 0.035 : -0.035;
    var v = 0.80 + weave + 0.14 * (noise2(x, y, 7) - 0.5);
    return [v * 255, v * 255, v * 255];
  } },
  carpet: { size: 64, scale: 14, build: function (x, y) {
    var v = 0.74 + 0.30 * (noise2(x >> 1, y >> 1, 21) - 0.5) + 0.16 * (noise2(x, y, 33) - 0.5);
    return [v * 255, v * 255, v * 255];
  } },
  grain: { size: 64, scale: 18, build: function (x, y) {
    var v = 0.90 + 0.10 * (noise2(x, y, 5) - 0.5);
    return [v * 255, v * 255, v * 255];
  } }
};

var TEX_CACHE = {};
function texturePNG(name) {
  if (!TEX_CACHE[name]) {
    var t = TEXTURES[name];
    TEX_CACHE[name] = pngFromRGB(t.size, t.size, t.build);
  }
  return TEX_CACHE[name];
}

/** 盒式投影 UV（噪声贴图无需连续 UV，按法线主轴取平面即可） */
function boxUV(pos, nrm, scale) {
  var out = new Float32Array(pos.length / 3 * 2);
  for (var i = 0; i < pos.length / 3; i++) {
    var nx = Math.abs(nrm[i * 3]), ny = Math.abs(nrm[i * 3 + 1]), nz = Math.abs(nrm[i * 3 + 2]);
    var u, v;
    if (nz >= nx && nz >= ny) { u = pos[i * 3]; v = pos[i * 3 + 1]; }
    else if (ny >= nx) { u = pos[i * 3]; v = pos[i * 3 + 2]; }
    else { u = pos[i * 3 + 2]; v = pos[i * 3 + 1]; }
    out[i * 2] = u * scale;
    out[i * 2 + 1] = v * scale;
  }
  return out;
}

/* ============================ 1. 向量与数学 ============================ */

var V = {
  add: function (a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; },
  sub: function (a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; },
  mul: function (a, s) { return [a[0] * s, a[1] * s, a[2] * s]; },
  dot: function (a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; },
  cross: function (a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  },
  len: function (a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); },
  norm: function (a) { var l = V.len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
};

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

/** 折线查表（按 z 线性插值，表可任意顺序书写） */
function tableAt(tbl, z) {
  var t = tbl.slice().sort(function (a, b) { return a[0] - b[0]; });
  if (z <= t[0][0]) return t[0][1];
  if (z >= t[t.length - 1][0]) return t[t.length - 1][1];
  for (var i = 0; i < t.length - 1; i++) {
    if (z >= t[i][0] && z <= t[i + 1][0]) {
      var span = t[i + 1][0] - t[i][0] || 1;
      var u = (z - t[i][0]) / span;
      return t[i][1] + (t[i + 1][1] - t[i][1]) * u;
    }
  }
  return t[t.length - 1][1];
}

function srgbToLinear(v) {
  var s = clamp(v, 0, 255) / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
/** sRGB 十六进制 → glTF 线性基色 */
function hexLinear(hex) {
  return [srgbToLinear((hex >> 16) & 255), srgbToLinear((hex >> 8) & 255), srgbToLinear(hex & 255)];
}

/* ============================ 2. 网格容器 ============================ */

function Geo(name, material) {
  this.name = name;
  this.material = material;
  this.pos = [];      // 扁平 xyz
  this.acc = [];      // 法线累加（面积加权），导出时归一化
  this.idx = [];
}

Geo.prototype.vert = function (p) {
  this.pos.push(p[0], p[1], p[2]);
  this.acc.push(0, 0, 0);
  return this.pos.length / 3 - 1;
};

/** 三角面：面法线累加到三个顶点——顶点不复用时即为平面着色，复用即为平滑着色 */
Geo.prototype.tri = function (a, b, c) {
  var p = this.pos;
  var ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2];
  var bx = p[b * 3], by = p[b * 3 + 1], bz = p[b * 3 + 2];
  var cx = p[c * 3], cy = p[c * 3 + 1], cz = p[c * 3 + 2];
  var e1x = bx - ax, e1y = by - ay, e1z = bz - az;
  var e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
  var nx = e1y * e2z - e1z * e2y;
  var ny = e1z * e2x - e1x * e2z;
  var nz = e1x * e2y - e1y * e2x;
  var acc = this.acc;
  acc[a * 3] += nx; acc[a * 3 + 1] += ny; acc[a * 3 + 2] += nz;
  acc[b * 3] += nx; acc[b * 3 + 1] += ny; acc[b * 3 + 2] += nz;
  acc[c * 3] += nx; acc[c * 3 + 1] += ny; acc[c * 3 + 2] += nz;
  this.idx.push(a, b, c);
};

Geo.prototype.quad = function (a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); };
Geo.prototype.verts = function () { return this.pos.length / 3; };
Geo.prototype.tris = function () { return this.idx.length / 3; };
Geo.prototype.isEmpty = function () { return this.idx.length === 0; };

/** 归一化法线；退化三角形（面积为 0）沿用首个有效方向兜底 */
Geo.prototype.normals = function () {
  var out = new Float32Array(this.acc.length);
  for (var i = 0; i < this.acc.length; i += 3) {
    var x = this.acc[i], y = this.acc[i + 1], z = this.acc[i + 2];
    var l = Math.sqrt(x * x + y * y + z * z);
    if (l < 1e-9) { out[i] = 0; out[i + 1] = 1; out[i + 2] = 0; }
    else { out[i] = x / l; out[i + 1] = y / l; out[i + 2] = z / l; }
  }
  return out;
};

/** 顶点变换 + 三角绕序跟随（镜像后必须翻面，否则法线朝内） */
Geo.prototype.mapVerts = function (fn, flip) {
  for (var i = 0; i < this.pos.length; i += 3) {
    var p = fn([this.pos[i], this.pos[i + 1], this.pos[i + 2]]);
    this.pos[i] = p[0]; this.pos[i + 1] = p[1]; this.pos[i + 2] = p[2];
  }
  if (flip) {
    for (var j = 0; j < this.idx.length; j += 3) {
      var tmp = this.idx[j + 1];
      this.idx[j + 1] = this.idx[j + 2];
      this.idx[j + 2] = tmp;
    }
  }
};

Geo.prototype.mirrorX = function () {
  this.mapVerts(function (p) { return [-p[0], p[1], p[2]]; }, true);
  return this;
};

Geo.prototype.translate = function (t) {
  this.mapVerts(function (p) { return [p[0] + t[0], p[1] + t[1], p[2] + t[2]]; }, false);
  return this;
};

/** 两点间矩形梁（A 柱/C 柱/后视镜支臂/行李架等） */
function addBeam(g, p0, p1, w, h) {
  var d = V.norm(V.sub(p1, p0));
  var upHint = Math.abs(d[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0];
  var ex = V.norm(V.cross(d, upHint));
  var ey = V.norm(V.cross(d, ex));
  var mid = V.mul(V.add(p0, p1), 0.5);
  addBox(g, mid, [w / 2, h / 2, V.len(V.sub(p1, p0)) / 2], [ex, ey, d]);
}

/** 有向长方体：basis = [ex, ey, ez] 三个正交单位轴 */
function addBox(g, center, half, basis) {
  var ex = basis ? basis[0] : [1, 0, 0];
  var ey = basis ? basis[1] : [0, 1, 0];
  var ez = basis ? basis[2] : [0, 0, 1];
  var S = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
           [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
  var C = S.map(function (s) {
    return [
      center[0] + ex[0] * half[0] * s[0] + ey[0] * half[1] * s[1] + ez[0] * half[2] * s[2],
      center[1] + ex[1] * half[0] * s[0] + ey[1] * half[1] * s[1] + ez[1] * half[2] * s[2],
      center[2] + ex[2] * half[0] * s[0] + ey[2] * half[1] * s[1] + ez[2] * half[2] * s[2]
    ];
  });
  var faces = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [3, 2, 6, 7], [0, 3, 7, 4], [1, 2, 6, 5]];
  for (var f = 0; f < faces.length; f++) {
    var pts = faces[f].map(function (i) { return C[i]; });
    var mid = V.mul(pts.reduce(function (a, b) { return V.add(a, b); }, [0, 0, 0]), 0.25);
    addQuadPts(g, pts, V.sub(mid, center));
  }
}

/** 四边形面片（顶点独立 → 平面法线），ref 用于保证朝外 */
function addQuadPts(g, pts, ref) {
  var n = V.cross(V.sub(pts[1], pts[0]), V.sub(pts[2], pts[0]));
  if (ref && V.dot(n, ref) < 0) pts = [pts[0], pts[3], pts[2], pts[1]];
  var i0 = g.vert(pts[0]), i1 = g.vert(pts[1]), i2 = g.vert(pts[2]), i3 = g.vert(pts[3]);
  g.quad(i0, i1, i2, i3);
}

/** 沿 +Z 放样：rings 为 z 递增的等点数闭合环（环在 XY 平面内逆时针）
 *  skip(k, j, zA, zB) 返回 true 时跳过该四边形（用于在车身上开座舱口） */
function addLoft(g, rings, capStart, capEnd, skip) {
  var N = rings[0].length;
  var base = g.verts();
  for (var k = 0; k < rings.length; k++) {
    for (var j = 0; j < N; j++) g.vert(rings[k][j]);
  }
  for (var k2 = 0; k2 < rings.length - 1; k2++) {
    for (var j2 = 0; j2 < N; j2++) {
      if (skip && skip(k2, j2, rings[k2][0][2], rings[k2 + 1][0][2])) continue;
      var jn = (j2 + 1) % N;
      var a = base + k2 * N + j2, b = base + k2 * N + jn;
      var c = base + (k2 + 1) * N + jn, d = base + (k2 + 1) * N + j2;
      g.quad(a, b, c, d);
    }
  }
  if (capStart) {
    var r0 = rings[0];
    var c0 = ringCenter(r0);
    var i0 = g.vert(c0);
    for (var s = 0; s < N; s++) g.tri(i0, base + (s + 1) % N, base + s);
  }
  if (capEnd) {
    var rl = rings[rings.length - 1];
    var cl = ringCenter(rl);
    var il = g.vert(cl);
    var lb = base + (rings.length - 1) * N;
    for (var s2 = 0; s2 < N; s2++) g.tri(il, lb + s2, lb + (s2 + 1) % N);
  }
}

function ringCenter(ring) {
  var x = 0, y = 0, z = 0;
  for (var i = 0; i < ring.length; i++) { x += ring[i][0]; y += ring[i][1]; z += ring[i][2]; }
  return [x / ring.length, y / ring.length, z / ring.length];
}

/**
 * 车身截面环：底部/顶部内收、最宽点在 shoulder 处。
 * 右侧自下而上 + 左侧自上而下 → 逆时针，底/顶由闭合边形成平面。
 */
function sectionRing(hwBot, hwTop, yBot, yTop, K, opt) {
  opt = opt || {};
  var sBot = opt.tuckBot != null ? opt.tuckBot : 0.84;
  var sTop = opt.tuckTop != null ? opt.tuckTop : 0.95;
  var tMax = opt.shoulder != null ? opt.shoulder : 0.66;
  var right = [];
  for (var i = 0; i < K; i++) {
    var t = i / (K - 1);
    var base = hwBot + (hwTop - hwBot) * t;
    var f;
    if (t <= tMax) {
      var u = t / tMax;
      f = sBot + (1 - sBot) * Math.sin(u * Math.PI / 2);
    } else {
      var u2 = (t - tMax) / (1 - tMax);
      f = 1 - (1 - sTop) * u2 * u2;
    }
    right.push([base * f, yBot + (yTop - yBot) * t]);
  }
  var ring = right.map(function (p) { return p; });
  for (var j = K - 1; j >= 0; j--) ring.push([-right[j][0], right[j][1]]);
  return ring;
}

/** 绕 X 轴旋转成型（轮胎、轮辋）；profile = [[x, r], ...] */
function addRevolveX(g, profile, segs, center, capAt) {
  center = center || [0, 0, 0];
  var base = g.verts();
  for (var i = 0; i < profile.length; i++) {
    for (var s = 0; s < segs; s++) {
      var th = s / segs * Math.PI * 2;
      g.vert([center[0] + profile[i][0], center[1] + profile[i][1] * Math.cos(th), center[2] + profile[i][1] * Math.sin(th)]);
    }
  }
  for (var i2 = 0; i2 < profile.length - 1; i2++) {
    for (var s2 = 0; s2 < segs; s2++) {
      var sn = (s2 + 1) % segs;
      var a = base + i2 * segs + s2, b = base + i2 * segs + sn;
      var c = base + (i2 + 1) * segs + sn, d = base + (i2 + 1) * segs + s2;
      var p = g.pos;
      var cx = (p[a * 3] + p[c * 3]) / 2;
      var cy = (p[a * 3 + 1] + p[c * 3 + 1]) / 2;
      var cz = (p[a * 3 + 2] + p[c * 3 + 2]) / 2;
      var ref = [0, cy - center[1], cz - center[2]];
      var n = V.cross(V.sub([p[b * 3], p[b * 3 + 1], p[b * 3 + 2]], [p[a * 3], p[a * 3 + 1], p[a * 3 + 2]]),
                      V.sub([p[c * 3], p[c * 3 + 1], p[c * 3 + 2]], [p[a * 3], p[a * 3 + 1], p[a * 3 + 2]]));
      if (V.dot(n, ref) < 0) g.quad(a, d, c, b); else g.quad(a, b, c, d);
      void cx;
    }
  }
  if (capAt) {
    addDiscX(g, profile[capAt.index][0], profile[capAt.index][1], segs, capAt.dir, center);
  }
}

/** 朝 ±X 的圆盘（轮辋中心盖/刹车盘端面） */
function addDiscX(g, x, r, segs, dir, center) {
  center = center || [0, 0, 0];
  var c = g.vert([center[0] + x, center[1], center[2]]);
  var ids = [];
  for (var s = 0; s < segs; s++) {
    var th = s / segs * Math.PI * 2;
    ids.push(g.vert([center[0] + x, center[1] + r * Math.cos(th), center[2] + r * Math.sin(th)]));
  }
  for (var s2 = 0; s2 < segs; s2++) {
    var s3 = (s2 + 1) % segs;
    if (dir > 0) g.tri(c, ids[s2], ids[s3]);
    else g.tri(c, ids[s3], ids[s2]);
  }
}

/* ============================ 3. 材质表 ============================ */

var MAT = {
  Paint: { base: 0xd8dde4, metallic: 0.55, roughness: 0.32 },
  Glass: { base: 0x1e262e, metallic: 0.0, roughness: 0.18, alpha: 0.88 },
  Trim: { base: 0x1a1d21, metallic: 0.10, roughness: 0.78 },
  Chrome: { base: 0xc9ced6, metallic: 1.0, roughness: 0.20 },
  Tire: { base: 0x15171a, metallic: 0.0, roughness: 0.94 },
  Rim: { base: 0xb6bdc7, metallic: 0.95, roughness: 0.26 },
  BrakeDisc: { base: 0x6d737b, metallic: 0.85, roughness: 0.48 },
  HeadLamp: { base: 0xfff6dc, metallic: 0.1, roughness: 0.10, emissive: 0xfff0c8 },
  TailLamp: { base: 0x7d1a14, metallic: 0.1, roughness: 0.18, emissive: 0xc8321f },
  Indicator: { base: 0x6b4a00, metallic: 0.1, roughness: 0.18, emissive: 0xffa000 },
  MirrorGlass: { base: 0x39414a, metallic: 1.0, roughness: 0.05 },
  Plate: { base: 0xe8ecef, metallic: 0.0, roughness: 0.55 },
  Interior: { base: 0x2e343b, metallic: 0.02, roughness: 0.88 },
  Cabin: { base: 0x262b31, metallic: 0.02, roughness: 0.86, tex: 'grain' },     // 软质仪表台/门板
  Fabric: { base: 0x2b3138, metallic: 0.0, roughness: 0.96, tex: 'fabric' },     // 织物座椅
  Carpet: { base: 0x1b1f24, metallic: 0.0, roughness: 1.0, tex: 'carpet' },      // 地毯
  Screen: { base: 0x090c10, metallic: 0.10, roughness: 0.14, emissive: 0x0b1a26 }, // 屏幕
  Leather: { base: 0x1c2025, metallic: 0.04, roughness: 0.62, tex: 'grain' }     // 方向盘/扶手
};

function gltfMaterial(name, m, texIndex) {
  var out = {
    name: name,
    doubleSided: true,     // 薄板件（车灯/牌照/镜片）与资产通用性考虑，双面渲染
    pbrMetallicRoughness: {
      baseColorFactor: hexLinear(m.base).concat([m.alpha != null ? m.alpha : 1]),
      metallicFactor: m.metallic,
      roughnessFactor: m.roughness
    }
  };
  if (m.alpha != null && m.alpha < 1) out.alphaMode = 'BLEND';
  if (m.emissive != null) out.emissiveFactor = hexLinear(m.emissive);
  if (m.tex && texIndex && texIndex[m.tex] != null) {
    out.pbrMetallicRoughness.baseColorTexture = { index: texIndex[m.tex] };
  }
  return out;
}

/* ============================ 4. 车型定义 ============================ */

/**
 * 车型参数：全部单位米。topProfile = 下部车身顶面（引擎盖/腰线/尾箱盖）沿 z 的高度，
 * widthProfile = 俯视半宽，bottomProfile = 底边高度（轮拱由 archR 叠加）。
 */
var STYLES = {
  hatch: {
    key: 'hatch',
    label: '本田飞度 GR9 两厢（玩家车同款尺寸）',
    paint: 0xd8dde4,
    L: 4.109, W: 1.694, H: 1.537,
    WB: 2.53, frontOverhang: 0.84, tireR: 0.3015,
    trackF: 1.48, trackR: 1.465, tireWidth: 0.185,
    archR: 0.365, archP: 2.4,
    topProfile: [
      [2.0545, 0.775], [2.020, 0.815], [1.960, 0.838], [1.900, 0.848], [1.860, 0.852],
      [1.550, 0.872], [1.160, 0.898], [0.950, 0.925], [0.600, 0.944], [0.000, 0.952],
      [-1.200, 0.962], [-1.700, 0.972], [-1.980, 0.965], [-2.0545, 0.930]
    ],
    widthProfile: [
      [2.0545, 0.660], [2.020, 0.760], [1.960, 0.812], [1.900, 0.838], [1.860, 0.843],
      [1.750, 0.847], [0.000, 0.847], [-1.600, 0.847], [-1.900, 0.835], [-2.0545, 0.790]
    ],
    bottomProfile: [
      [2.0545, 0.340], [1.990, 0.255], [1.860, 0.215], [0.900, 0.195],
      [-1.200, 0.215], [-1.900, 0.235], [-2.0545, 0.330]
    ],
    greenhouse: [
      { z: 1.020, yHigh: 0.950, wLow: 0.790, wHigh: 0.770 },
      { z: 0.900, yHigh: 1.120, wLow: 0.800, wHigh: 0.735 },
      { z: 0.700, yHigh: 1.330, wLow: 0.805, wHigh: 0.715 },
      { z: 0.420, yHigh: 1.470, wLow: 0.810, wHigh: 0.700 },
      { z: 0.180, yHigh: 1.489, wLow: 0.812, wHigh: 0.695 },
      { z: -0.700, yHigh: 1.492, wLow: 0.814, wHigh: 0.700 },
      { z: -1.180, yHigh: 1.490, wLow: 0.812, wHigh: 0.702 },
      { z: -1.470, yHigh: 1.462, wLow: 0.804, wHigh: 0.706 },
      { z: -1.720, yHigh: 1.330, wLow: 0.790, wHigh: 0.712 },
      { z: -1.900, yHigh: 1.120, wLow: 0.756, wHigh: 0.716 },
      { z: -1.985, yHigh: 0.982, wLow: 0.706, wHigh: 0.696 }
    ],
    roof: { z0: -1.200, z1: 0.360, hw: 0.700, y: 1.492, thick: 0.020 },
    aPillar: { zTop: 0.380, zBottom: 0.990, yTop: 1.475 },
    cPillar: { zTop: -1.200, zBottom: -1.860, yTop: 1.478 },
    bPillarZ: -0.440
  },

  sedan: {
    key: 'sedan',
    label: '紧凑型三厢轿车（场景停放车）',
    paint: 0x8a9099,
    L: 4.620, W: 1.780, H: 1.455,
    WB: 2.70, frontOverhang: 0.95, tireR: 0.312,
    trackF: 1.55, trackR: 1.55, tireWidth: 0.205,
    archR: 0.375, archP: 2.4,
    topProfile: [
      [2.310, 0.700], [2.240, 0.745], [2.120, 0.762], [1.750, 0.775], [1.100, 0.795],
      [0.920, 0.845], [0.550, 0.868], [-0.550, 0.872], [-1.350, 0.872], [-1.750, 0.878],
      [-2.050, 0.872], [-2.310, 0.800]
    ],
    widthProfile: [
      [2.310, 0.700], [2.240, 0.800], [2.120, 0.855], [1.980, 0.880], [1.850, 0.890],
      [0.000, 0.890], [-1.800, 0.890], [-2.100, 0.875], [-2.310, 0.800]
    ],
    bottomProfile: [
      [2.310, 0.330], [2.240, 0.240], [2.100, 0.195], [0.900, 0.180],
      [-1.200, 0.190], [-2.100, 0.215], [-2.310, 0.320]
    ],
    greenhouse: [
      { z: 0.920, yHigh: 0.872, wLow: 0.800, wHigh: 0.790 },
      { z: 0.800, yHigh: 1.060, wLow: 0.815, wHigh: 0.745 },
      { z: 0.550, yHigh: 1.240, wLow: 0.825, wHigh: 0.720 },
      { z: 0.280, yHigh: 1.437, wLow: 0.830, wHigh: 0.705 },
      { z: -0.550, yHigh: 1.437, wLow: 0.830, wHigh: 0.705 },
      { z: -0.950, yHigh: 1.400, wLow: 0.820, wHigh: 0.710 },
      { z: -1.180, yHigh: 1.250, wLow: 0.800, wHigh: 0.720 },
      { z: -1.320, yHigh: 0.900, wLow: 0.775, wHigh: 0.775 }
    ],
    roof: { z0: -0.980, z1: 0.300, hw: 0.706, y: 1.437, thick: 0.020 },
    aPillar: { zTop: 0.300, zBottom: 0.900, yTop: 1.425 },
    cPillar: { zTop: -0.950, zBottom: -1.300, yTop: 1.400 },
    bPillarZ: -0.320
  },

  suv: {
    key: 'suv',
    label: '紧凑型 SUV（场景停放车）',
    paint: 0x5b6470,
    L: 4.450, W: 1.850, H: 1.660,
    WB: 2.66, frontOverhang: 0.95, tireR: 0.345,
    trackF: 1.58, trackR: 1.57, tireWidth: 0.225,
    archR: 0.405, archP: 2.4,
    topProfile: [
      [2.225, 0.860], [2.150, 0.920], [2.020, 0.955], [1.600, 0.975], [1.200, 0.998],
      [1.020, 1.030], [0.600, 1.050], [0.000, 1.055], [-1.500, 1.055], [-1.950, 1.040],
      [-2.150, 0.990], [-2.225, 0.930]
    ],
    widthProfile: [
      [2.225, 0.680], [2.150, 0.820], [2.020, 0.890], [1.900, 0.915], [0.000, 0.925],
      [-1.900, 0.925], [-2.100, 0.900], [-2.225, 0.840]
    ],
    bottomProfile: [
      [2.225, 0.420], [2.150, 0.340], [2.020, 0.290], [1.000, 0.270],
      [-1.200, 0.290], [-2.050, 0.300], [-2.225, 0.400]
    ],
    greenhouse: [
      { z: 1.020, yHigh: 1.062, wLow: 0.850, wHigh: 0.840 },
      { z: 0.900, yHigh: 1.240, wLow: 0.862, wHigh: 0.795 },
      { z: 0.650, yHigh: 1.460, wLow: 0.870, wHigh: 0.765 },
      { z: 0.350, yHigh: 1.620, wLow: 0.876, wHigh: 0.750 },
      { z: -1.050, yHigh: 1.625, wLow: 0.876, wHigh: 0.755 },
      { z: -1.550, yHigh: 1.610, wLow: 0.870, wHigh: 0.760 },
      { z: -1.950, yHigh: 1.420, wLow: 0.840, wHigh: 0.775 },
      { z: -2.120, yHigh: 1.100, wLow: 0.800, wHigh: 0.790 },
      { z: -2.180, yHigh: 1.062, wLow: 0.760, wHigh: 0.750 }
    ],
    roof: { z0: -1.560, z1: 0.360, hw: 0.752, y: 1.620, thick: 0.024 },
    aPillar: { zTop: 0.350, zBottom: 1.000, yTop: 1.606 },
    cPillar: { zTop: -1.560, zBottom: -2.100, yTop: 1.596 },
    bPillarZ: -0.480,
    roofRails: true
  }
};

/* ============================ 5. 车辆几何构建 ============================ */

function styleDims(def) {
  var axleF = def.L / 2 - def.frontOverhang;
  return {
    axleF: axleF,
    axleR: axleF - def.WB,
    hw: def.W / 2,
    beltY: tableAt(def.topProfile, 0)
  };
}

function archY(def, z, axleF, axleR) {
  var best = -Infinity;
  [axleF, axleR].forEach(function (az) {
    var d = Math.abs(z - az);
    if (d >= def.archR) return;
    var u = d / def.archR;
    var top = def.tireR + def.archR - 0.02;
    var base = tableAt(def.bottomProfile, az);
    var y = base + (top - base) * Math.pow(1 - Math.pow(u, def.archP), 1 / def.archP);
    if (y > best) best = y;
  });
  return best;
}

/** 车身放样站位：轮廓控制点 + 轮拱弧线加密采样 */
function stationList(def, axleF, axleR) {
  var s = [];
  function push(z) {
    if (!s.some(function (v) { return Math.abs(v - z) < 0.012; })) s.push(z);
  }
  def.topProfile.forEach(function (p) { push(p[0]); });
  def.bottomProfile.forEach(function (p) { push(p[0]); });
  def.widthProfile.forEach(function (p) { push(p[0]); });
  def.greenhouse.forEach(function (g) { push(g.z); });
  [axleF, axleR].forEach(function (az) {
    for (var d = -def.archR; d <= def.archR + 1e-6; d += 0.05) push(az + d);
  });
  return s.sort(function (a, b) { return a - b; });
}

function bodyRing(def, z, dims, K) {
  var s = bodySection(def, z, dims);
  return sectionRing(s.hw, s.hw, s.yb, s.yt, K, { tuckBot: s.tuckBot, tuckTop: 0.95, shoulder: 0.66 })
    .map(function (p) { return [p[0], p[1], z]; });
}

/** 沿 X 扫掠闭合二维剖面（剖面写 [z, y]，自动处理朝向与端盖）
 *  stations = [{ x, s(缩放), dz, dy }]，两端 s 收小即可得到圆角 */
function addSweepX(g, profile, stations) {
  var N = profile.length;
  var cz = 0, cy = 0;
  profile.forEach(function (p) { cz += p[0]; cy += p[1]; });
  cz /= N; cy /= N;

  function pt(st, p) {
    return [st.x,
      cy + (p[1] - cy) * (st.s == null ? 1 : st.s) + (st.dy || 0),
      cz + (p[0] - cz) * (st.s == null ? 1 : st.s) + (st.dz || 0)];
  }

  for (var k = 0; k < stations.length - 1; k++) {
    for (var j = 0; j < N; j++) {
      var jn = (j + 1) % N;
      var p0 = profile[j], p1 = profile[jn];
      var my = (p0[1] + p1[1]) / 2 - cy, mz = (p0[0] + p1[0]) / 2 - cz;
      addQuadPts(g, [pt(stations[k], p0), pt(stations[k], p1),
        pt(stations[k + 1], p1), pt(stations[k + 1], p0)], [0, my, mz]);
    }
  }
  // 两端封口
  var first = stations[0], last = stations[stations.length - 1];
  var c0 = [first.x, cy + (first.dy || 0), cz + (first.dz || 0)];
  var cl = [last.x, cy + (last.dy || 0), cz + (last.dz || 0)];
  for (var t = 0; t < N; t++) {
    var q0 = profile[t], q1 = profile[(t + 1) % N];
    addTriRef(g, c0, pt(first, q0), pt(first, q1), [-1, 0, 0]);
    addTriRef(g, cl, pt(last, q0), pt(last, q1), [1, 0, 0]);
  }
}

/** 沿 X 扫掠并让两端收圆（内饰件常用） */
function sweepRounded(g, profile, xCenter, xHalf, segs, taper) {
  var n = segs || 8, tp = taper == null ? 0.12 : taper;
  var st = [];
  for (var i = 0; i <= n; i++) {
    var t = i / n;
    var e = Math.abs(t * 2 - 1);
    st.push({ x: xCenter - xHalf + 2 * xHalf * t, s: 1 - tp * Math.pow(e, 4) });
  }
  addSweepX(g, profile, st);
}

function addTriRef(g, a, b, c, ref) {
  var n = V.cross(V.sub(b, a), V.sub(c, a));
  if (ref && V.dot(n, ref) < 0) { var t = b; b = c; c = t; }
  g.tri(g.vert(a), g.vert(b), g.vert(c));
}

/** 圆环（方向盘轮缘等）：basis = [e1, e2, n] 正交基 */
function addTorus(g, center, R, r, basis, segs, tubeSegs) {
  var e1 = basis[0], e2 = basis[1], n = basis[2];
  for (var i = 0; i < segs; i++) {
    var u0 = i / segs * Math.PI * 2, u1 = (i + 1) / segs * Math.PI * 2;
    for (var j = 0; j < tubeSegs; j++) {
      var v0 = j / tubeSegs * Math.PI * 2, v1 = (j + 1) / tubeSegs * Math.PI * 2;
      function P(u, v) {
        var ru = R + r * Math.cos(v);
        return [
          center[0] + ru * (Math.cos(u) * e1[0] + Math.sin(u) * e2[0]) + r * Math.sin(v) * n[0],
          center[1] + ru * (Math.cos(u) * e1[1] + Math.sin(u) * e2[1]) + r * Math.sin(v) * n[1],
          center[2] + ru * (Math.cos(u) * e1[2] + Math.sin(u) * e2[2]) + r * Math.sin(v) * n[2]
        ];
      }
      var a = P(u0, v0), b = P(u1, v0), c = P(u1, v1), d = P(u0, v1);
      var mid = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2];
      var tube = [
        center[0] + R * (Math.cos((u0 + u1) / 2) * e1[0] + Math.sin((u0 + u1) / 2) * e2[0]),
        center[1] + R * (Math.cos((u0 + u1) / 2) * e1[1] + Math.sin((u0 + u1) / 2) * e2[1]),
        center[2] + R * (Math.cos((u0 + u1) / 2) * e1[2] + Math.sin((u0 + u1) / 2) * e2[2])
      ];
      addQuadPts(g, [a, b, c, d], V.sub(mid, tube));
    }
  }
}

/** 车身某一 z 处的截面参数（放样与贴附细节共用，保证细节贴合曲面） */
function bodySection(def, z, dims) {
  var yb = tableAt(def.bottomProfile, z);
  var ay = archY(def, z, dims.axleF, dims.axleR);
  if (ay > yb) yb = ay;
  var yt = tableAt(def.topProfile, z);
  if (yb > yt - 0.05) yb = yt - 0.05;
  return {
    yb: yb, yt: yt,
    hw: tableAt(def.widthProfile, z),
    // 轮拱处车底抬高 → 该截面必须接近满宽，否则轮胎会凸出车身侧面
    tuckBot: yb > def.tireR + 0.18 ? 0.985 : 0.84
  };
}

/** 车身侧面在 (z, y) 处的半宽：与 sectionRing 的收口曲线同一份公式 */
function bodyHalfWidth(def, z, y, dims) {
  var s = bodySection(def, z, dims);
  var t = clamp((y - s.yb) / (s.yt - s.yb), 0, 1);
  var tMax = 0.66, f;
  if (t <= tMax) f = s.tuckBot + (1 - s.tuckBot) * Math.sin(t / tMax * Math.PI / 2);
  else {
    var u = (t - tMax) / (1 - tMax);
    f = 1 - 0.05 * u * u;
  }
  return s.hw * f;
}

function greenhouseRing(sec, def, dims) {
  var yLow = tableAt(def.topProfile, sec.z) - 0.018;
  var yHigh = sec.yHigh;
  if (yHigh < yLow + 0.012) yHigh = yLow + 0.012;
  return sectionRing(sec.wLow, sec.wHigh, yLow, yHigh, 5,
    { tuckBot: 0.995, tuckTop: 0.93, shoulder: 0.30 })
    .map(function (p) { return [p[0], p[1], sec.z]; });
}

function carMeta(def, dims) {
  return {
    style: def.key,
    label: def.label,
    unit: 'meter',
    forwardAxis: '+Z',
    upAxis: '+Y',
    leftAxis: '+X',
    origin: '车辆中心地面投影（y=0 为地面）',
    dimensions: { length: def.L, width: def.W, height: def.H },
    wheelbase: def.WB,
    frontOverhang: def.frontOverhang,
    tireRadius: def.tireR,
    axles: { front: dims.axleF, rear: dims.axleR },
    track: { front: def.trackF, rear: def.trackR },
    paintMaterial: 'Paint',
    glassMaterial: 'Glass',
    interiorMaterial: 'Interior',
    // 驾驶位眼点（左舵）：车内视角相机直接放这里，朝向 +Z
    driverEye: { x: def.W * 0.212, y: def.H * 0.775, z: -0.02 },
    wheelSpinAxis: 'X',
    steerAxis: 'Y'
  };
}

/** 侧面板缝：沿车身曲面贴一条深色细带（门缝） */
function addSideSeam(g, def, dims, z, side, y0, y1) {
  var N = 7, prev = null;
  for (var i = 0; i <= N; i++) {
    var y = y0 + (y1 - y0) * (i / N);
    var x = side * (bodyHalfWidth(def, z, y, dims) + 0.0022);
    var cur = [[x, y, z - 0.0055], [x, y, z + 0.0055]];
    if (prev) addQuadPts(g, [prev[0], prev[1], cur[1], cur[0]], [side, 0, 0]);
    prev = cur;
  }
}

/** 引擎盖分缝：贴在顶面上的一条细带 */
function addTopSeam(g, def, x, z0, z1) {
  var N = 6, prev = null;
  for (var i = 0; i <= N; i++) {
    var z = z0 + (z1 - z0) * i / N;
    var y = tableAt(def.topProfile, z) + 0.0022;
    var cur = [[x - 0.004, y, z], [x + 0.004, y, z]];
    if (prev) addQuadPts(g, [prev[0], prev[1], cur[1], cur[0]], [0, 1, 0]);
    prev = cur;
  }
}

/**
 * 构建一台车：返回 { geos: [{geo, material}], nodes: [...] }
 * 节点顺序与父子关系在 glTF 写入阶段展开。
 */
function buildCar(def) {
  var dims = styleDims(def);
  var L = def.L, W = def.W;
  var hw = W / 2;
  var beltY = dims.beltY;

  var body = new Geo('Body', 'Paint');
  var glass = new Geo('Glass', 'Glass');
  var trim = new Geo('Trim', 'Trim');
  var chrome = new Geo('Chrome', 'Chrome');
  var head = new Geo('HeadLamp', 'HeadLamp');
  var tail = new Geo('TailLamp', 'TailLamp');
  var indL = new Geo('IndicatorL', 'Indicator');
  var indR = new Geo('IndicatorR', 'Indicator');
  var plateF = new Geo('PlateF', 'Plate');
  var plateR = new Geo('PlateR', 'Plate');
  var mirrorCapL = new Geo('MirrorCapL', 'Paint');
  var mirrorCapR = new Geo('MirrorCapR', 'Paint');
  var mirrorGlassL = new Geo('MirrorGlassL', 'MirrorGlass');
  var mirrorGlassR = new Geo('MirrorGlassR', 'MirrorGlass');
  var cabin = new Geo('Cabin', 'Cabin');
  var fabric = new Geo('Seats', 'Fabric');
  var carpet = new Geo('Carpet', 'Carpet');
  var screen = new Geo('Screens', 'Screen');
  var leather = new Geo('SteeringWheel', 'Leather');

  /* --- 5.1 下部车身（引擎盖/腰线/尾箱 + 轮拱） --- */
  var zs = stationList(def, dims.axleF, dims.axleR);
  var rings = zs.map(function (z) { return bodyRing(def, z, dims, 6); });
  // 座舱口：把腰线顶面在座舱段挖开，车内视角才不是"坐在后备箱盖板上"
  var holeZ0 = def.greenhouse[def.greenhouse.length - 1].z + 0.50;
  var holeZ1 = def.greenhouse[0].z;
  addLoft(body, rings, true, true, function (k, j, za, zb) {
    if (j !== 5) return false;
    var zm = (za + zb) / 2;
    return zm > holeZ0 && zm < holeZ1;
  });

  /* --- 5.2 座舱玻璃（前风挡/侧窗/后窗一体放样） --- */
  var gh = def.greenhouse;
  var gRings = gh.map(function (sec) { return greenhouseRing(sec, def, dims); });
  addLoft(glass, gRings, true, true);

  /* --- 5.3 车顶盖板（车身漆）：压在玻璃顶上，宽度跟随座舱上沿 --- */
  var roofStations = gh.filter(function (s) { return s.z >= def.roof.z0 && s.z <= def.roof.z1; });
  var roofZ = [def.roof.z0, def.roof.z1];
  roofStations.forEach(function (s) { roofZ.push(s.z); });
  roofZ = roofZ.filter(function (z, i, arr) { return arr.indexOf(z) === i; })
    .sort(function (a, b) { return a - b; });
  var roofRings = roofZ.map(function (z) {
    var ghAt = gh.slice().sort(function (a, b) { return Math.abs(a.z - z) - Math.abs(b.z - z); })[0];
    var w = ghAt.wHigh * 0.985;
    var y = ghAt.yHigh;
    return sectionRing(w, w * 0.97, y - 0.004, y + def.roof.thick, 5,
      { tuckBot: 0.98, tuckTop: 0.90, shoulder: 0.45 })
      .map(function (p) { return [p[0], p[1], z]; });
  });
  addLoft(body, roofRings, true, true);

  /* --- 5.4 A/C 柱车身漆饰条 + B 柱黑色饰板 --- */
  var wAtBelt = tableAt(def.widthProfile, 0) * 0.95;
  addBeam(body, [wAtBelt, beltY - 0.01, def.aPillar.zBottom], [def.aPillar.zTop < 0 ? 0.70 : 0.705, def.aPillar.yTop, def.aPillar.zTop], 0.075, 0.055);
  addBeam(body, [-wAtBelt, beltY - 0.01, def.aPillar.zBottom], [-0.705, def.aPillar.yTop, def.aPillar.zTop], 0.075, 0.055);
  addBeam(body, [wAtBelt, beltY - 0.01, def.cPillar.zBottom], [0.705, def.cPillar.yTop, def.cPillar.zTop], 0.085, 0.06);
  addBeam(body, [-wAtBelt, beltY - 0.01, def.cPillar.zBottom], [-0.705, def.cPillar.yTop, def.cPillar.zTop], 0.085, 0.06);
  addBeam(trim, [wAtBelt - 0.004, beltY + 0.01, def.bPillarZ], [0.706, def.roof.y - 0.01, def.bPillarZ], 0.030, 0.05);
  addBeam(trim, [-wAtBelt + 0.004, beltY + 0.01, def.bPillarZ], [-0.706, def.roof.y - 0.01, def.bPillarZ], 0.030, 0.05);

  /* --- 5.5 车窗下沿饰条（黑色） --- */
  addBeam(trim, [wAtBelt + 0.006, beltY - 0.012, def.greenhouse[0].z - 0.06],
    [wAtBelt + 0.006, beltY - 0.012, def.greenhouse[def.greenhouse.length - 1].z + 0.04], 0.018, 0.026);
  addBeam(trim, [-wAtBelt - 0.006, beltY - 0.012, def.greenhouse[0].z - 0.06],
    [-wAtBelt - 0.006, beltY - 0.012, def.greenhouse[def.greenhouse.length - 1].z + 0.04], 0.018, 0.026);

  /* --- 5.6 前脸：格栅、下唇、灯组（尺寸按车头断面收，避免悬空） --- */
  var noseZ = L / 2;
  var lampY = def.H * 0.455;
  // 大嘴下格栅 + 上部细进气缝（灯片之间）
  addBox(trim, [0, def.H * 0.315, noseZ - 0.020], [W * 0.255, 0.098, 0.030]);
  addBox(chrome, [0, def.H * 0.315, noseZ + 0.006], [W * 0.248, 0.010, 0.012]);
  addBox(trim, [0, def.H * 0.462, noseZ - 0.012], [W * 0.095, 0.020, 0.026]);

  var lampX = W * 0.262;
  // 灯腔（深色边框，比灯片略大且略靠前）→ 白车身上才有对比
  addBox(trim, [lampX, lampY, noseZ - 0.006], [W * 0.118, 0.050, 0.012]);
  addBox(trim, [-lampX, lampY, noseZ - 0.006], [W * 0.118, 0.050, 0.012]);
  addBox(head, [lampX, lampY, noseZ + 0.002], [W * 0.098, 0.034, 0.008]);
  addBox(head, [-lampX, lampY, noseZ + 0.002], [W * 0.098, 0.034, 0.008]);

  addBox(indL, [lampX, lampY - 0.050, noseZ - 0.002], [W * 0.066, 0.012, 0.008]);
  addBox(indR, [-lampX, lampY - 0.050, noseZ - 0.002], [W * 0.066, 0.012, 0.008]);

  /* --- 5.7 车尾：尾灯、牌照、下包围 --- */
  var tailZ = -L / 2;
  var tailY = def.H * 0.545;
  addBox(tail, [W * 0.325, tailY, tailZ + 0.037], [W * 0.110, 0.058, 0.045]);
  addBox(tail, [-W * 0.325, tailY, tailZ + 0.037], [W * 0.110, 0.058, 0.045]);
  addBox(trim, [W * 0.325, tailY, tailZ + 0.035], [W * 0.122, 0.070, 0.040]);
  addBox(trim, [-W * 0.325, tailY, tailZ + 0.035], [W * 0.122, 0.070, 0.040]);
  addBox(trim, [0, def.H * 0.240, tailZ + 0.045], [W * 0.325, 0.050, 0.050]);
  addBox(chrome, [W * 0.26, def.H * 0.190, tailZ + 0.020], [0.045, 0.030, 0.040]);

  addBox(plateF, [0, def.H * 0.315, noseZ + 0.008], [0.20, 0.060, 0.008]);
  addBox(trim, [0, def.H * 0.400, tailZ + 0.004], [0.265, 0.085, 0.010]);
  addBox(plateR, [0, def.H * 0.400, tailZ - 0.004], [0.21, 0.065, 0.008]);
  addBox(chrome, [0, tailY + 0.085, tailZ + 0.055], [0.080, 0.018, 0.010]);

  /* --- 5.8 侧裙 / 门缝 / 门把手 / 引擎盖分缝 / 轮眉 --- */
  var skirtX = tableAt(def.widthProfile, 0) * 0.86;
  addBeam(trim, [skirtX, tableAt(def.bottomProfile, 0.4) + 0.05, 0.75],
    [skirtX, tableAt(def.bottomProfile, -1.0) + 0.05, -1.05], 0.05, 0.09);
  addBeam(trim, [-skirtX, tableAt(def.bottomProfile, 0.4) + 0.05, 0.75],
    [-skirtX, tableAt(def.bottomProfile, -1.0) + 0.05, -1.05], 0.05, 0.09);

  var seamY0 = tableAt(def.bottomProfile, 0) + 0.02;
  var seamY1 = beltY - 0.035;
  [1, -1].forEach(function (sx) {
    [0.80, -0.12, -1.06].forEach(function (z) {
      addSideSeam(trim, def, dims, z, sx, seamY0, seamY1);
    });
  });
  addTopSeam(trim, def, W * 0.345, L / 2 - 0.13, def.greenhouse[0].z + 0.02);
  addTopSeam(trim, def, -W * 0.345, L / 2 - 0.13, def.greenhouse[0].z + 0.02);
  addBox(trim, [0, tableAt(def.topProfile, def.greenhouse[0].z) + 0.004, def.greenhouse[0].z + 0.02],
    [W * 0.34, 0.008, 0.026]);

  var handleY = beltY - 0.085;
  [1, -1].forEach(function (sx) {
    [0.42, -0.66].forEach(function (z) {
      var hx = sx * (bodyHalfWidth(def, z, handleY, dims) + 0.004);
      addBox(chrome, [hx, handleY, z], [0.010, 0.017, 0.060]);
    });
  });

  // 轮眉：沿轮拱弧线贴在侧面，遮住放样车的"通舱式"轮拱边缘
  [dims.axleF, dims.axleR].forEach(function (az) {
    [1, -1].forEach(function (sx) {
      var segs = 12;
      var prev = null;
      for (var i = 0; i <= segs; i++) {
        var d = -def.archR + (2 * def.archR) * (i / segs);
        var y = archY(def, az + d, dims.axleF, dims.axleR);
        if (!isFinite(y)) y = tableAt(def.bottomProfile, az + d);
        var x = sx * (tableAt(def.widthProfile, az + d) * 0.995);
        var cur = [[x, y - 0.004, az + d], [x, y + 0.022, az + d]];
        if (prev) {
          addQuadPts(trim, [prev[0], prev[1], cur[1], cur[0]], [sx, 0, 0]);
        }
        prev = cur;
      }
    });
  });

  /* --- 5.9 后视镜（枢轴节点，可动；支臂落在腰线上，不悬空） --- */
  var mirrorZ = def.greenhouse[0].z - 0.16;
  var mirrorX = hw + 0.062;
  var mirrorY = beltY + 0.055;
  var mHalf = [0.062, 0.052, 0.098];
  addBox(mirrorCapL, [0, 0, 0], mHalf);
  addBox(mirrorCapR, [0, 0, 0], mHalf);
  addBox(mirrorGlassL, [0, 0, -mHalf[2] - 0.006], [mHalf[0] * 0.86, mHalf[1] * 0.82, 0.006]);
  addBox(mirrorGlassR, [0, 0, -mHalf[2] - 0.006], [mHalf[0] * 0.86, mHalf[1] * 0.82, 0.006]);
  addBeam(trim, [hw - 0.045, beltY - 0.012, mirrorZ + 0.030],
    [mirrorX - mHalf[0] * 0.4, mirrorY, mirrorZ + 0.020], 0.032, 0.030);
  addBeam(trim, [-hw + 0.045, beltY - 0.012, mirrorZ + 0.030],
    [-mirrorX + mHalf[0] * 0.4, mirrorY, mirrorZ + 0.020], 0.032, 0.030);

  /* --- 5.10 雨刮 / 天线 / 车顶行李架 --- */
  var wiperY = tableAt(def.topProfile, def.greenhouse[0].z) + 0.012;
  addBeam(trim, [-0.52, wiperY, def.greenhouse[0].z - 0.03], [0.30, wiperY + 0.01, def.greenhouse[0].z - 0.10], 0.018, 0.012);

  var finZ = def.roof.z0 - 0.02;
  addBeam(trim, [0, def.roof.y + def.roof.thick - 0.004, finZ], [0, def.roof.y + def.roof.thick + (def.key === 'sedan' ? 0.02 : 0.042), finZ - 0.13], 0.055, 0.03);

  if (def.roofRails) {
    var railY = def.roof.y + def.roof.thick + 0.006;
    [1, -1].forEach(function (sx) {
      var railX = sx * def.roof.hw * 0.84;
      addBeam(trim, [railX, railY, def.roof.z1 - 0.04], [railX, railY, def.roof.z0 + 0.04], 0.040, 0.024);
      // 前后支脚，避免“浮空横杆”
      [def.roof.z1 - 0.10, def.roof.z0 + 0.10].forEach(function (z) {
        addBeam(trim, [railX, railY - 0.03, z], [railX, railY + 0.002, z], 0.034, 0.022);
      });
    });
  }

  /* --- 5.11 座舱内饰：仪表台/中控/方向盘/座椅/门板/立柱（曲面放样） --- */
  var cabinZ0 = def.greenhouse[0].z;
  var cabinZ1 = def.greenhouse[def.greenhouse.length - 1].z;
  var eyeX = def.W * 0.212;                       // 左舵驾驶位（+X 为车左侧）
  var cabW = W * 0.435;                           // 内饰半宽
  var dashZ = cabinZ0 - 0.02;                     // 仪表台前缘（风挡根部）
  var dashTop = beltY - 0.005;

  /* 地板 / 顶棚 / 前围 / 后隔板 */
  var floorY = def.H * 0.205;
  addBox(carpet, [0, floorY, (cabinZ0 + cabinZ1 + 0.20) / 2],
    [cabW * 1.005, 0.018, (cabinZ0 - cabinZ1 - 0.20) / 2]);
  // 中央通道鼓包
  addBox(carpet, [0, floorY + 0.055, 0.10], [cabW * 0.28, 0.055, 1.05]);
  // 前脚踏板区（真车脚窝本就比地板高，这里顺便盖住轮拱抬高的车身内壁）
  addBox(carpet, [0, 0.487, 0.950], [cabW * 0.92, 0.035, 0.090]);
  addBox(cabin, [0, def.roof.y - 0.030, (def.roof.z1 + def.roof.z0) / 2],
    [cabW * 0.96, 0.016, (def.roof.z1 - def.roof.z0) / 2]);
  addBox(cabin, [0, def.H * 0.405, dashZ + 0.005], [cabW * 0.94, def.H * 0.215, 0.018]);
  addBox(cabin, [0, def.H * 0.45, cabinZ1 + 0.46], [cabW * 0.94, def.H * 0.24, 0.018]);

  /* 仪表台：沿 X 扫掠的软质台体（上沿圆弧过渡，两端收口） */
  sweepRounded(cabin, [
    [1.000, 0.560], [1.008, 0.860], [0.996, 0.918], [0.966, 0.946],
    [0.878, 0.953], [0.800, 0.945], [0.774, 0.910], [0.780, 0.842],
    [0.822, 0.742], [0.900, 0.672], [0.968, 0.630]
  ], 0, cabW, 10, 0.10);

  // 仪表罩（驾驶位上方的小帽檐）+ 仪表屏
  sweepRounded(cabin, [
    [0.900, 0.940], [0.868, 0.982], [0.800, 0.990], [0.756, 0.970],
    [0.766, 0.938], [0.862, 0.930]
  ], eyeX, 0.150, 5, 0.20);
  addBox(screen, [eyeX, 0.947, 0.756], [0.098, 0.030, 0.008],
    [[1, 0, 0], [0, Math.cos(10 * D2R), -Math.sin(10 * D2R)], [0, Math.sin(10 * D2R), Math.cos(10 * D2R)]]);

  // 中央出风口（三条深色横槽）
  [-0.34, -0.16, 0.02].forEach(function (vx) {
    addBox(trim, [vx, 0.893, 0.779], [0.052, 0.014, 0.012]);
  });
  // 除霜风口（风挡下沿）+ 台面镀铬饰条 + 副驾侧饰板
  addBox(trim, [0, 0.949, 0.913], [cabW * 0.80, 0.006, 0.030]);
  addBox(chrome, [0, 0.836, 0.7715], [cabW * 0.84, 0.0045, 0.007]);
  addBox(leather, [eyeX + 0.430, 0.878, 0.778], [0.080, 0.028, 0.010]);

  // 中控台（向驾驶员凸出的竖面）+ 悬浮屏 + 按键排
  sweepRounded(cabin, [
    [0.770, 0.560], [0.770, 0.868], [0.742, 0.905], [0.700, 0.898],
    [0.688, 0.845], [0.700, 0.700], [0.735, 0.610]
  ], 0, 0.098, 5, 0.08);
  addBox(screen, [0, 0.856, 0.678], [0.092, 0.050, 0.008],
    [[1, 0, 0], [0, Math.cos(9 * D2R), -Math.sin(9 * D2R)], [0, Math.sin(9 * D2R), Math.cos(9 * D2R)]]);
  addBox(chrome, [0, 0.792, 0.681], [0.072, 0.004, 0.006]);
  addBox(chrome, [0, 0.760, 0.684], [0.072, 0.004, 0.006]);

  /* 方向盘：圆环轮缘 + 三辐 + 轮心，后倾 24° */
  var swTilt = 24 * D2R;
  var swE1 = [1, 0, 0];
  var swE2 = [0, Math.cos(swTilt), -Math.sin(swTilt)];
  var swN = [0, Math.sin(swTilt), Math.cos(swTilt)];
  var swC = [eyeX, 0.900, 0.650];
  var swR = 0.172;
  addTorus(leather, swC, swR, 0.017, [swE1, swE2, swN], 28, 8);
  // 轮心（气囊盖）+ 下方镀铬饰条
  sweepRounded(leather, [
    [-0.028, 0.845], [0.028, 0.845], [0.034, 0.872], [0.024, 0.900],
    [-0.024, 0.900], [-0.034, 0.872]
  ], eyeX, 0.058, 3, 0.25);
  addTorus(chrome, swC, 0.058, 0.006, [swE1, swE2, swN], 18, 6);
  // 三辐（左/右/下）
  [0, 180, 270].forEach(function (deg) {
    var a = deg * D2R;
    var rad = [Math.cos(a) * swE1[0] + Math.sin(a) * swE2[0],
      Math.cos(a) * swE1[1] + Math.sin(a) * swE2[1],
      Math.cos(a) * swE1[2] + Math.sin(a) * swE2[2]];
    var tan = [-Math.sin(a) * swE1[0] + Math.cos(a) * swE2[0],
      -Math.sin(a) * swE1[1] + Math.cos(a) * swE2[1],
      -Math.sin(a) * swE1[2] + Math.cos(a) * swE2[2]];
    var mid = [swC[0] + rad[0] * swR * 0.55, swC[1] + rad[1] * swR * 0.55, swC[2] + rad[2] * swR * 0.55];
    addBox(leather, mid, [0.030, swR * 0.44, 0.010], [tan, rad, swN]);
  });
  // 转向柱
  addBeam(cabin, [eyeX, 0.885, 0.700], [eyeX, 0.845, 0.800], 0.070, 0.070);

  /* 前排座椅：坐垫 / 靠背 / 头枕（曲面放样） */
  function addSeat(cx) {
    sweepRounded(fabric, [
      [-0.205, 0.500], [0.300, 0.500], [0.340, 0.545], [0.322, 0.592],
      [0.250, 0.615], [-0.110, 0.618], [-0.186, 0.600], [-0.212, 0.552]
    ], cx, 0.200, 8, 0.09);
    sweepRounded(fabric, [
      [-0.100, 0.592], [-0.140, 0.800], [-0.190, 1.006], [-0.222, 1.028],
      [-0.300, 1.018], [-0.322, 0.976], [-0.292, 0.800], [-0.252, 0.592]
    ], cx, 0.192, 8, 0.11);
    // 头枕（与靠背顶部相交，避免"浮块"）
    sweepRounded(fabric, [
      [-0.228, 1.000], [-0.240, 1.108], [-0.290, 1.122], [-0.322, 1.060],
      [-0.310, 0.994], [-0.256, 0.988]
    ], cx, 0.115, 4, 0.24);
    // 座椅导轨
    addBox(trim, [cx, 0.452, 0.060], [0.055, 0.012, 0.230]);
    addBox(trim, [cx, 0.452, 0.290], [0.020, 0.020, 0.030]);
  }
  addSeat(eyeX);
  addSeat(-eyeX);

  /* 后排长凳 */
  sweepRounded(fabric, [
    [-0.780, 0.500], [-0.760, 0.545], [-0.700, 0.596], [-0.420, 0.608],
    [-0.360, 0.588], [-0.372, 0.520], [-0.402, 0.500]
  ], 0, 0.540, 8, 0.05);
  sweepRounded(fabric, [
    [-0.782, 0.596], [-0.812, 0.880], [-0.846, 1.006], [-0.900, 1.020],
    [-0.960, 0.990], [-0.952, 0.880], [-0.890, 0.596]
  ], 0, 0.540, 8, 0.05);

  /* 中央扶手箱 / 换挡杆 / 手刹 */
  sweepRounded(cabin, [
    [0.560, 0.500], [0.560, 0.660], [0.520, 0.700], [0.300, 0.716],
    [-0.180, 0.716], [-0.280, 0.700], [-0.300, 0.560], [-0.240, 0.500]
  ], 0, 0.098, 6, 0.06);
  sweepRounded(leather, [
    [-0.060, 0.712], [-0.070, 0.760], [0.030, 0.765], [0.040, 0.716]
  ], 0, 0.082, 4, 0.25);
  addBox(chrome, [0, 0.744, 0.315], [0.012, 0.058, 0.012]);
  addBox(leather, [0, 0.800, 0.302], [0.026, 0.024, 0.026]);
  addBeam(trim, [0.028, 0.726, 0.060], [0.028, 0.756, -0.180], 0.020, 0.014);

  /* 门板：贴合车身内壁的分段面板 + 扶手 + 拉手 + 喇叭 */
  var dcY0 = def.H * 0.175, dcY1 = beltY - 0.020;
  var dcZ0 = cabinZ0 - 0.06, dcZ1 = -1.08, dcBands = 5;
  var dcZm = (dcZ0 + dcZ1) / 2, dcZh = (dcZ0 - dcZ1) / 2;
  [1, -1].forEach(function (sx) {
    for (var b = 0; b < dcBands; b++) {
      var ya = dcY0 + (dcY1 - dcY0) * b / dcBands;
      var yb2 = dcY0 + (dcY1 - dcY0) * (b + 1) / dcBands;
      var xw = bodyHalfWidth(def, dcZm, (ya + yb2) / 2, dims) - 0.020;
      addBox(cabin, [sx * xw, (ya + yb2) / 2, dcZm], [0.012, (yb2 - ya) / 2, dcZh]);
    }
    var armX = sx * (bodyHalfWidth(def, 0.1, 0.700, dims) - 0.055);
    addBox(cabin, [armX, 0.700, 0.030], [0.030, 0.026, 0.300]);          // 扶手
    addBox(trim, [armX - sx * 0.020, 0.762, 0.120], [0.006, 0.010, 0.070]); // 内拉手
    addBox(trim, [sx * (bodyHalfWidth(def, -0.55, 0.520, dims) - 0.030), 0.520, -0.560],
      [0.010, 0.075, 0.075]);                                             // 喇叭
    addBox(cabin, [sx * 0.700, 0.330, 0.640], [0.045, 0.075, 0.060]);     // 脚踏护板旁
  });

  /* A/B/C 柱内饰板（盖住车身白漆内壁） */
  addBeam(cabin, [hw * 0.855, beltY - 0.03, def.aPillar.zBottom],
    [0.700, def.aPillar.yTop - 0.02, def.aPillar.zTop], 0.085, 0.070);
  addBeam(cabin, [-hw * 0.855, beltY - 0.03, def.aPillar.zBottom],
    [-0.700, def.aPillar.yTop - 0.02, def.aPillar.zTop], 0.085, 0.070);
  addBeam(cabin, [hw * 0.840, beltY - 0.02, def.bPillarZ],
    [0.706, def.roof.y - 0.02, def.bPillarZ], 0.075, 0.060);
  addBeam(cabin, [-hw * 0.840, beltY - 0.02, def.bPillarZ],
    [-0.706, def.roof.y - 0.02, def.bPillarZ], 0.075, 0.060);
  addBeam(cabin, [hw * 0.870, beltY - 0.02, def.cPillar.zBottom],
    [0.706, def.cPillar.yTop - 0.02, def.cPillar.zTop], 0.090, 0.075);
  addBeam(cabin, [-hw * 0.870, beltY - 0.02, def.cPillar.zBottom],
    [-0.706, def.cPillar.yTop - 0.02, def.cPillar.zTop], 0.090, 0.075);

  /* 风挡上沿饰板 + 遮阳板 + 车内后视镜（带支臂） */
  addBox(cabin, [0, def.roof.y - 0.026, def.roof.z1 + 0.015], [cabW * 0.96, 0.032, 0.048]);
  addBox(cabin, [0, def.roof.y - 0.052, def.roof.z1 + 0.052], [cabW * 0.95, 0.012, 0.038]);
  [1, -1].forEach(function (sx) {
    addBox(cabin, [sx * W * 0.19, def.roof.y - 0.062, def.roof.z1 + 0.150], [W * 0.150, 0.012, 0.088]);
  });
  addBeam(trim, [0, def.roof.y - 0.040, def.roof.z1 + 0.035], [0, def.roof.y - 0.090, def.roof.z1 + 0.048], 0.024, 0.020);
  addBox(trim, [0, def.roof.y - 0.100, def.roof.z1 + 0.052], [0.092, 0.026, 0.012]);

  /* 踏板（脚窝，挂在抬高后的脚踏板上方） */
  addBox(chrome, [eyeX - 0.070, 0.560, 0.930], [0.045, 0.062, 0.010], [[1, 0, 0], [0, 0.94, -0.34], [0, 0.34, 0.94]]);
  addBox(chrome, [eyeX + 0.020, 0.560, 0.933], [0.022, 0.050, 0.010], [[1, 0, 0], [0, 0.94, -0.34], [0, 0.34, 0.94]]);
  addBox(trim, [eyeX + 0.155, 0.575, 0.945], [0.055, 0.082, 0.012], [[1, 0, 0], [0, 0.94, -0.34], [0, 0.34, 0.94]]);

  /* --- 5.12 车轮（四个独立节点，前轮带转向枢轴） --- */
  var wheels = [];
  function addWheel(name, side, axleZ, track, front, mirror) {
    var w = buildWheel(def, mirror);
    wheels.push({
      name: name, side: side, front: front,
      x: side * track / 2, y: def.tireR, z: axleZ,
      geos: w
    });
  }
  addWheel('FL', 1, dims.axleF, def.trackF, true, false);
  addWheel('FR', -1, dims.axleF, def.trackF, true, true);
  addWheel('RL', 1, dims.axleR, def.trackR, false, false);
  addWheel('RR', -1, dims.axleR, def.trackR, false, true);

  /* --- 5.12 可动节点：后视镜枢轴 / 转向灯 / 车轮 --- */
  var subNodes = [
    {
      name: 'Mirror_L', translation: [mirrorX, mirrorY, mirrorZ],
      extras: { kind: 'mirror', side: 'left', rotationAxis: 'Y' },
      children: [
        { name: 'Mirror_L_Cap', geos: [{ geo: mirrorCapL, material: 'Paint' }] },
        { name: 'Mirror_L_Glass', geos: [{ geo: mirrorGlassL, material: 'MirrorGlass' }] }
      ]
    },
    {
      name: 'Mirror_R', translation: [-mirrorX, mirrorY, mirrorZ],
      extras: { kind: 'mirror', side: 'right', rotationAxis: 'Y' },
      children: [
        { name: 'Mirror_R_Cap', geos: [{ geo: mirrorCapR, material: 'Paint' }] },
        { name: 'Mirror_R_Glass', geos: [{ geo: mirrorGlassR, material: 'MirrorGlass' }] }
      ]
    },
    { name: 'Indicator_L', geos: [{ geo: indL, material: 'Indicator' }], extras: { kind: 'indicator', side: 'left' } },
    { name: 'Indicator_R', geos: [{ geo: indR, material: 'Indicator' }], extras: { kind: 'indicator', side: 'right' } }
  ];
  wheels.forEach(function (w) {
    var wheelNode = {
      name: 'Wheel_' + w.name,
      geos: w.geos,
      extras: {
        kind: 'wheel', side: w.side > 0 ? 'left' : 'right',
        position: w.front ? 'front' : 'rear', spinAxis: 'X'
      }
    };
    if (w.front) {
      subNodes.push({
        name: 'WheelSteer_' + w.name,
        translation: [w.x, w.y, w.z],
        extras: { kind: 'wheel-steer', side: w.side > 0 ? 'left' : 'right', steerAxis: 'Y', spinAxis: 'X' },
        children: [wheelNode]
      });
    } else {
      wheelNode.translation = [w.x, w.y, w.z];
      subNodes.push(wheelNode);
    }
  });

  return {
    meta: carMeta(def, dims),
    geos: [
      { geo: body, material: 'Paint' },
      { geo: glass, material: 'Glass' },
      { geo: trim, material: 'Trim' },
      { geo: chrome, material: 'Chrome' },
      { geo: head, material: 'HeadLamp' },
      { geo: tail, material: 'TailLamp' },
      { geo: plateF, material: 'Plate' },
      { geo: plateR, material: 'Plate' },
      { geo: cabin, material: 'Cabin' },
      { geo: fabric, material: 'Fabric' },
      { geo: carpet, material: 'Carpet' },
      { geo: screen, material: 'Screen' },
      { geo: leather, material: 'Leather' }
    ],
    subNodes: subNodes,
    mirror: { x: mirrorX, y: mirrorY, z: mirrorZ, half: mHalf },
    dims: dims
  };
}

/* --- 车轮：轮胎（旋转体）+ 轮辋（盘面 + 5 辐）+ 刹车盘 --- */
function buildWheel(def, mirror) {
  var R = def.tireR;
  var hwT = (def.tireWidth || 0.185) / 2;
  var tire = new Geo('Tire', 'Tire');
  var rim = new Geo('Rim', 'Rim');
  var disc = new Geo('BrakeDisc', 'BrakeDisc');

  // 轮胎剖面（x = 轴向位置，r = 半径）：胎肩微鼓、胎面平、内孔闭合
  var prof = [
    [-hwT, 0.64 * R], [-hwT, 0.86 * R], [-hwT * 0.94, 0.965 * R], [-hwT * 0.78, R],
    [hwT * 0.78, R], [hwT * 0.94, 0.965 * R], [hwT, 0.86 * R], [hwT, 0.64 * R]
  ];
  addRevolveX(tire, prof, 18, [0, 0, 0]);
  // 内孔侧壁（首尾相连，被轮辋外唇遮住）
  addRevolveX(tire, [[hwT, 0.64 * R], [-hwT, 0.64 * R]], 18, [0, 0, 0]);

  // 轮辋（15 寸胎圈 ≈0.63R）：只做外唇圈 + 轮心盘，中间镂空，刹车盘透出来
  var rimFace = [
    [hwT * 0.86, 0.572 * R], [hwT * 0.90, 0.640 * R], [hwT * 0.83, 0.648 * R],
    [hwT * 0.76, 0.560 * R]
  ];
  addRevolveX(rim, rimFace, 18, [0, 0, 0]);
  addRevolveX(rim, [[hwT * 0.86, 0.560 * R], [hwT * 0.70, 0.500 * R]], 18, [0, 0, 0]);
  addDiscX(rim, hwT * 0.62, 0.150 * R, 14, 1, [0, 0, 0]);

  // 5 辐：轮心 → 轮辋内缘
  for (var k = 0; k < 5; k++) {
    var ang = k / 5 * Math.PI * 2 + 0.35;
    var radial = [0, Math.cos(ang), Math.sin(ang)];
    var tangent = [0, -Math.sin(ang), Math.cos(ang)];
    var rc = 0.355 * R;
    addBox(rim, [hwT * 0.78, rc * Math.cos(ang), rc * Math.sin(ang)],
      [0.013, 0.205 * R, 0.048 * R], [[1, 0, 0], radial, tangent]);
  }

  // 刹车盘（轮辋内侧，透过辐条可见）+ 卡钳
  addRevolveX(disc, [[-hwT * 0.10, 0.40 * R], [-hwT * 0.10, 0.50 * R]], 16, [0, 0, 0]);
  addDiscX(disc, -hwT * 0.10, 0.50 * R, 16, -1, [0, 0, 0]);
  addDiscX(disc, -hwT * 0.10, 0.50 * R, 16, 1, [0, 0, 0]);
  addBox(disc, [-hwT * 0.05, 0.30 * R, 0], [0.035, 0.065, 0.040]);

  if (mirror) {
    tire.mirrorX(); rim.mirrorX(); disc.mirrorX();
  }

  return [
    { geo: tire, material: 'Tire' },
    { geo: rim, material: 'Rim' },
    { geo: disc, material: 'BrakeDisc' }
  ];
}

/* ============================ 6. glTF / GLB 写入 ============================ */

function buildGLTF(parts, modelName, meta) {
  var gl = {
    asset: {
      version: '2.0',
      generator: 'ParkMaster tools/gen_models.js',
      copyright: 'ParkMaster · 程序化生成，可自由用于本项目'
    },
    scene: 0,
    scenes: [{ name: modelName, nodes: [] }],
    nodes: [],
    meshes: [],
    materials: [],
    accessors: [],
    bufferViews: [],
    buffers: []
  };

  var bin = [];
  var binLen = 0;
  function appendBuffer(typed) {
    var bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    var pad = (4 - (binLen % 4)) % 4;
    if (pad) { bin.push(Buffer.alloc(pad)); binLen += pad; }
    var offset = binLen;
    bin.push(bytes);
    binLen += bytes.length;
    return { offset: offset, length: bytes.length };
  }

  /* 内嵌贴图：先占好 bufferView，材质里用 texture index 引用 */
  var texIndex = {};
  var usedTex = {};
  (parts.geos || []).forEach(function (it) {
    var mm = MAT[it.material];
    if (mm && mm.tex) usedTex[mm.tex] = true;
  });
  Object.keys(usedTex).forEach(function (name) {
    var png = texturePNG(name);
    var pad = (4 - (binLen % 4)) % 4;
    if (pad) { bin.push(Buffer.alloc(pad)); binLen += pad; }
    var off = binLen;
    bin.push(png); binLen += png.length;
    gl.bufferViews = gl.bufferViews || [];
    gl.bufferViews.push({ buffer: 0, byteOffset: off, byteLength: png.length });
    gl.images = gl.images || [];
    gl.images.push({ bufferView: gl.bufferViews.length - 1, mimeType: 'image/png', name: name });
    gl.samplers = gl.samplers || [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }];
    gl.textures = gl.textures || [];
    gl.textures.push({ sampler: 0, source: gl.images.length - 1 });
    texIndex[name] = gl.textures.length - 1;
  });

  function addAccessor(array, type, componentType, withBounds) {
    var view = appendBuffer(array);
    var comps = type === 'VEC3' ? 3 : (type === 'VEC2' ? 2 : 1);
    gl.bufferViews.push({
      buffer: 0, byteOffset: view.offset, byteLength: view.length,
      target: type === 'SCALAR' ? 34963 : 34962
    });
    var acc = {
      bufferView: gl.bufferViews.length - 1,
      componentType: componentType,
      count: array.length / comps,
      type: type
    };
    if (withBounds) {
      var min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (var i = 0; i < array.length; i += 3) {
        for (var k = 0; k < 3; k++) {
          if (array[i + k] < min[k]) min[k] = array[i + k];
          if (array[i + k] > max[k]) max[k] = array[i + k];
        }
      }
      acc.min = min; acc.max = max;
    }
    gl.accessors.push(acc);
    return gl.accessors.length - 1;
  }

  function addMesh(geos) {
    var prims = [];
    geos.forEach(function (item) {
      var g = item.geo;
      if (g.isEmpty()) return;
      var pos = new Float32Array(g.pos);
      var nrm = g.normals();
      var idx = g.verts() > 65535 ? new Uint32Array(g.idx) : new Uint16Array(g.idx);
      var matDef = MAT[item.material] || {};
      var attrs = {
        POSITION: addAccessor(pos, 'VEC3', 5126, true),
        NORMAL: addAccessor(nrm, 'VEC3', 5126, false)
      };
      if (matDef.tex && TEXTURES[matDef.tex]) {
        attrs.TEXCOORD_0 = addAccessor(boxUV(pos, nrm, TEXTURES[matDef.tex].scale), 'VEC2', 5126, false);
      }
      prims.push({
        attributes: attrs,
        indices: addAccessor(idx, 'SCALAR', idx instanceof Uint32Array ? 5125 : 5123, false),
        material: materialIndex(item.material),
        extras: { name: g.name }
      });
    });
    gl.meshes.push({ name: geos.map(function (x) { return x.geo.name; }).join('+'), primitives: prims });
    return gl.meshes.length - 1;
  }

  var matIndex = {};
  function materialIndex(name) {
    if (matIndex[name] == null) {
      gl.materials.push(gltfMaterial(name, MAT[name], texIndex));
      matIndex[name] = gl.materials.length - 1;
    }
    return matIndex[name];
  }

  function addNode(name, opts) {
    var n = { name: name };
    if (opts.translation) n.translation = opts.translation;
    if (opts.mesh != null) n.mesh = opts.mesh;
    if (opts.children) n.children = opts.children;
    if (opts.extras) n.extras = opts.extras;
    gl.nodes.push(n);
    return gl.nodes.length - 1;
  }

  /** 递归写节点：def = {name, translation, geos, children, extras} */
  function writeNode(def) {
    var children = [];
    if (def.children) {
      def.children.forEach(function (c) { children.push(writeNode(c)); });
    }
    var opts = { extras: def.extras, children: children.length ? children : undefined };
    if (def.translation) opts.translation = def.translation;
    if (def.geos && def.geos.some(function (x) { return !x.geo.isEmpty(); })) opts.mesh = addMesh(def.geos);
    return addNode(def.name, opts);
  }

  // 通用零件（车身/玻璃/饰件/灯具）
  var rootChildren = [];
  (parts.geos || []).forEach(function (item) {
    if (item.geo.isEmpty()) return;
    rootChildren.push(addNode(item.geo.name, { mesh: addMesh([item]) }));
  });
  (parts.subNodes || []).forEach(function (def) { rootChildren.push(writeNode(def)); });

  // 根节点（带整车元数据，方便引擎读取尺寸/约定）
  var root = addNode(modelName, { children: rootChildren, extras: meta });
  gl.scenes[0].nodes = [root];

  var pad = (4 - (binLen % 4)) % 4;
  if (pad) { bin.push(Buffer.alloc(pad)); binLen += pad; }
  gl.buffers = [{ byteLength: binLen }];
  return { gl: gl, bin: Buffer.concat(bin, binLen) };
}

function toGLB(gl, bin) {
  var jsonStr = JSON.stringify(gl);
  var json = Buffer.from(jsonStr, 'utf8');
  var jsonPad = (4 - (json.length % 4)) % 4;
  if (jsonPad) json = Buffer.concat([json, Buffer.alloc(jsonPad, 0x20)]);
  var binPad = (4 - (bin.length % 4)) % 4;
  if (binPad) bin = Buffer.concat([bin, Buffer.alloc(binPad, 0)]);

  var total = 12 + 8 + json.length + 8 + bin.length;
  var out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546C67, 0);   // 'glTF'
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(json.length, 12);
  out.writeUInt32LE(0x4E4F534A, 16);  // 'JSON'
  json.copy(out, 20);
  var off = 20 + json.length;
  out.writeUInt32LE(bin.length, off);
  out.writeUInt32LE(0x004E4942, off + 4); // 'BIN'
  bin.copy(out, off + 8);
  return out;
}

/* ============================ 7. 回读校验 ============================ */

function readGLB(buf) {
  if (buf.readUInt32LE(0) !== 0x46546C67) throw new Error('GLB magic 错误');
  if (buf.readUInt32LE(4) !== 2) throw new Error('GLB 版本不是 2');
  var total = buf.readUInt32LE(8);
  if (total !== buf.length) throw new Error('GLB 长度字段与文件大小不一致');
  var off = 12, json = null, bin = null;
  while (off < total) {
    var len = buf.readUInt32LE(off);
    var type = buf.readUInt32LE(off + 4);
    if (type === 0x4E4F534A) json = JSON.parse(buf.slice(off + 8, off + 8 + len).toString('utf8'));
    else if (type === 0x004E4942) bin = buf.slice(off + 8, off + 8 + len);
    off += 8 + len;
  }
  if (!json) throw new Error('缺少 JSON chunk');
  return { gl: json, bin: bin };
}

function verifyGLTF(gl, bin, expect) {
  var errs = [];
  var tris = 0;
  var bbox = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  var bodyBox = null;
  if (!gl.asset || gl.asset.version !== '2.0') errs.push('asset.version 不是 2.0');
  (gl.bufferViews || []).forEach(function (bv, i) {
    if (bv.byteOffset % 4 !== 0) errs.push('bufferView[' + i + '] byteOffset 未 4 字节对齐');
    if (bv.byteOffset + bv.byteLength > (bin ? bin.length : Infinity)) errs.push('bufferView[' + i + '] 越界');
  });
  (gl.meshes || []).forEach(function (m) {
    m.primitives.forEach(function (p) {
      tris += gl.accessors[p.indices].count / 3;
      var pa = gl.accessors[p.attributes.POSITION];
      if (!pa.min || !pa.max) errs.push(m.name + ' POSITION 缺少 min/max');
    });
  });
  (gl.accessors || []).forEach(function (a, i) {
    if (a.type === 'VEC3' && a.componentType === 5126 && a.count * 12 > gl.bufferViews[a.bufferView].byteLength) {
      errs.push('accessor[' + i + '] 数据长度超出 bufferView');
    }
  });

  /* 节点变换下的世界包围盒（这里只有平移；缩放/旋转留给引擎） */
  function walk(idx, tx) {
    var n = gl.nodes[idx];
    var t = n.translation || [0, 0, 0];
    var world = [tx[0] + t[0], tx[1] + t[1], tx[2] + t[2]];
    if (n.mesh != null) {
      var isBody = n.name === 'Body';
      var local = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      gl.meshes[n.mesh].primitives.forEach(function (p) {
        var pa = gl.accessors[p.attributes.POSITION];
        for (var k = 0; k < 3; k++) {
          local.min[k] = Math.min(local.min[k], pa.min[k]);
          local.max[k] = Math.max(local.max[k], pa.max[k]);
        }
      });
      for (var k2 = 0; k2 < 3; k2++) {
        bbox.min[k2] = Math.min(bbox.min[k2], local.min[k2] + world[k2]);
        bbox.max[k2] = Math.max(bbox.max[k2], local.max[k2] + world[k2]);
        if (isBody) {
          if (!bodyBox) bodyBox = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
          bodyBox.min[k2] = Math.min(bodyBox.min[k2], local.min[k2] + world[k2]);
          bodyBox.max[k2] = Math.max(bodyBox.max[k2], local.max[k2] + world[k2]);
        }
      }
    }
    (n.children || []).forEach(function (c) { walk(c, world); });
  }
  (gl.scenes[gl.scene || 0].nodes || []).forEach(function (n) { walk(n, [0, 0, 0]); });

  if (expect) {
    var ref = bodyBox || bbox;
    var len = ref.max[2] - ref.min[2];
    var wid = ref.max[0] - ref.min[0];
    var hei = bbox.max[1] - bbox.min[1];
    if (Math.abs(len - expect.length) > 0.08) errs.push('车长偏差过大：模型 ' + len.toFixed(3) + 'm / 标称 ' + expect.length + 'm');
    if (Math.abs(wid - expect.width) > 0.08) errs.push('车宽偏差过大：模型 ' + wid.toFixed(3) + 'm / 标称 ' + expect.width + 'm');
    if (Math.abs(hei - expect.height) > 0.09) errs.push('车高偏差过大：模型 ' + hei.toFixed(3) + 'm / 标称 ' + expect.height + 'm');
  }
  return { errors: errs, triangles: tris, bbox: bbox };
}

/* ============================ 8. 主流程 ============================ */

function parseArgs(argv) {
  var args = { out: DEFAULT_OUT, only: null, check: false };
  for (var i = 2; i < argv.length; i++) {
    if (argv[i] === '--out') args.out = path.resolve(argv[++i]);
    else if (argv[i] === '--only') args.only = argv[++i];
    else if (argv[i] === '--check') args.check = true;
    else if (argv[i] === '--help' || argv[i] === '-h') args.help = true;
  }
  return args;
}

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }

function round3(v) { return Math.round(v * 1000) / 1000; }
function roundBox(b) {
  if (!b) return null;
  return { min: b.min.map(round3), max: b.max.map(round3) };
}

function writeModel(dir, baseName, parts, meta, check) {
  var built = buildGLTF(parts, baseName, meta);
  var glb = toGLB(built.gl, built.bin);
  fs.writeFileSync(path.join(dir, baseName + '.glb'), glb);

  var gltf = JSON.parse(JSON.stringify(built.gl));
  var binName = baseName + '.bin';
  gltf.buffers = [{ uri: binName, byteLength: built.bin.length }];
  fs.writeFileSync(path.join(dir, baseName + '.gltf'), JSON.stringify(gltf, null, 2));
  fs.writeFileSync(path.join(dir, binName), built.bin);

  var report = { file: baseName + '.glb', bytes: glb.length };
  if (check) {
    var rb = verifyGLTF(readGLB(glb).gl, built.bin, meta.dimensions);
    var rt = verifyGLTF(JSON.parse(fs.readFileSync(path.join(dir, baseName + '.gltf'), 'utf8')), built.bin, meta.dimensions);
    report.errors = rb.errors.concat(rt.errors.map(function (e) { return 'gltf: ' + e; }));
    report.triangles = rb.triangles;
    report.bbox = rb.bbox;
  }
  return report;
}

function writeWheelModel(dir, def, check) {
  var geos = buildWheel(def, false);
  var meta = {
    label: '轮组 185/60 R15（轮胎 + 轮辋 + 刹车盘）',
    unit: 'meter',
    upAxis: '+Y',
    forwardAxis: '+Z',
    origin: '轮心（轴向 = X）',
    tireRadius: def.tireR,
    tireWidth: def.tireWidth,
    rim: 'Rim',
    note: '滚动时绕局部 X 轴旋转：角速度 = 车速 / 轮胎半径'
  };
  return writeModel(dir, 'wheel_185_60_r15', { geos: geos }, meta, check);
}

function main() {
  var args = parseArgs(process.argv);
  if (args.help) {
    console.log('用法: node tools/gen_models.js [--out dir] [--only hatch|sedan|suv|wheel] [--check]');
    return;
  }

  ensureDir(args.out);
  var entries = [];
  var failed = false;

  Object.keys(STYLES).forEach(function (key) {
    if (args.only && args.only !== key && args.only !== 'all') return;
    var def = STYLES[key];
    var parts = buildCar(def);
    var name = 'car_' + (key === 'hatch' ? 'gr9' : key);
    var report = writeModel(args.out, name, parts, parts.meta, args.check);
    entries.push({
      file: report.file,
      gltf: name + '.gltf',
      bin: name + '.bin',
      label: def.label,
      style: key,
      dimensions: { length: def.L, width: def.W, height: def.H },
      wheelbase: def.WB,
      tireRadius: def.tireR,
      driverEye: { x: Math.round(def.W * 0.212 * 1000) / 1000, y: Math.round(def.H * 0.775 * 1000) / 1000, z: -0.02 },
      materials: ['Paint', 'Glass', 'Trim', 'Chrome', 'HeadLamp', 'TailLamp', 'Indicator', 'Tire', 'Rim', 'BrakeDisc', 'MirrorGlass', 'Plate', 'Cabin', 'Fabric', 'Carpet', 'Screen', 'Leather'],
      nodes: { root: name, wheels: ['WheelSteer_FL', 'WheelSteer_FR', 'Wheel_RL', 'Wheel_RR'], mirrors: ['Mirror_L', 'Mirror_R'] },
      triangles: report.triangles,
      bytes: report.bytes,
      bbox: roundBox(report.bbox)
    });
    if (report.errors && report.errors.length) {
      failed = true;
      console.log('✗ ' + name + ': ' + report.errors.join('; '));
    } else {
      console.log('✓ ' + name + '  ' + (report.bytes / 1024).toFixed(1) + ' KB' +
        (report.triangles ? '  ' + report.triangles + ' 三角面' : '') +
        (report.bbox ? '  bbox ' + report.bbox.min.map(function (v) { return v.toFixed(3); }).join(',') +
          ' → ' + report.bbox.max.map(function (v) { return v.toFixed(3); }).join(',') : ''));
    }
  });

  if (!args.only || args.only === 'wheel' || args.only === 'all') {
    var wr = writeWheelModel(args.out, STYLES.hatch, args.check);
    entries.push({
      file: wr.file, gltf: 'wheel_185_60_r15.gltf', bin: 'wheel_185_60_r15.bin',
      label: '轮组 185/60 R15', style: 'wheel',
      tireRadius: STYLES.hatch.tireR, bytes: wr.bytes, triangles: wr.triangles
    });
    if (wr.errors && wr.errors.length) {
      failed = true;
      console.log('✗ wheel: ' + wr.errors.join('; '));
    } else {
      console.log('✓ wheel_185_60_r15  ' + (wr.bytes / 1024).toFixed(1) + ' KB' +
        (wr.triangles ? '  ' + wr.triangles + ' 三角面' : ''));
    }
  }

  // 保留 app/import_model.js 写入的导入模型条目（程序化车型每次重算，导入模型不动）
  var mfPath = path.join(args.out, 'manifest.json');
  if (fs.existsSync(mfPath)) {
    try {
      var prev = JSON.parse(fs.readFileSync(mfPath, 'utf8'));
      (prev.models || []).forEach(function (m) {
        if (!m.imported) return;
        if (entries.some(function (e) { return e.file === m.file; })) return;
        entries.push(m);
      });
    } catch (err) { /* 旧清单损坏就忽略，重新生成即可 */ }
  }

  var manifest = {
    generatedBy: 'tools/gen_models.js',
    generatorNote: '程序化生成，改型号/尺寸请改工具内 STYLES 后重跑（npm run build:models -- --check）',
    format: 'glTF 2.0（GLB 为单文件打包，.gltf + .bin 为同内容分体版）',
    units: 'meter',
    upAxis: '+Y',
    forwardAxis: '+Z',
    origin: '车辆中心地面投影（y=0 为地面）',
    conventions: {
      paintMaterial: 'Paint（整车漆面/后视镜壳，运行时改颜色即可出多色停放车）',
      glassMaterial: 'Glass',
      wheels: 'Wheel_FL / Wheel_FR / Wheel_RL / Wheel_RR 节点原点在轮心，绕局部 X 轴滚动',
      steering: 'WheelSteer_FL / WheelSteer_FR 为前轮转向枢轴，绕局部 Y 轴旋转（阿克曼内外轮差由上层逻辑给）',
      mirrors: 'Mirror_L / Mirror_R 为后视镜枢轴，绕局部 Y 轴调角',
      lamps: 'HeadLamp / TailLamp / Indicator 为自发光材质，Indicator_L/R 为独立节点（转向灯闪烁）'
    },
    models: entries
  };
  fs.writeFileSync(path.join(args.out, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('→ ' + path.relative(ROOT, path.join(args.out, 'manifest.json')));
  if (failed) process.exitCode = 1;
}

main();
