#!/usr/bin/env node
/* 外部车模接入工具（零依赖，纯 Node）
 *
 * 把一个第三方 GLB（美术做的车模）规整成本项目的坐标约定：
 *   +Y 向上、+Z 车头、+X 车左侧、1 单位 = 1 米、原点 = 车身中心的地面投影。
 * 不重写顶点，只在最外层加一个「归一化矩阵」根节点——无损、可逆、秒级完成。
 *
 * 用法：
 *   node tools/import_model.js in.glb --name car_real
 *   node tools/import_model.js in.glb --name car_real --length 4.109 --yaw 180
 *   node tools/import_model.js in.glb --name car_real --up Z --manifest
 *   node tools/import_model.js in.glb --inspect          # 只体检，不写文件
 *
 * 常用参数：
 *   --name <id>        输出文件名（默认 in 的文件名）
 *   --out <dir>        输出目录（默认 assets/models）
 *   --length <m>       把车长缩放到该米数（默认 4.109，飞度 GR9）
 *   --yaw <deg>        绕 Y 轴额外旋转（车头不对时用，常用 90/180/-90）
 *   --up <Y|Z>         源模型上轴（Z-up 的 CAD 导出用 Z）
 *   --pivot <ground|center>  原点放在地面中心（默认）还是几何中心
 *   --rename <a=b>     材质改名，可重复：--rename body=Paint --rename windows=Glass
 *   --manifest         顺手写进 manifest.json（标记 imported: true）
 *   --inspect          只打印结构/尺寸/材质，不输出文件
 */

'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var DEFAULT_OUT = path.join(ROOT, 'assets', 'models');
var D2R = Math.PI / 180;

/* ---------------- GLB 读写 ---------------- */

function readGLB(buf) {
  if (buf.readUInt32LE(0) !== 0x46546C67) throw new Error('不是 GLB 文件（magic 不对）');
  var total = buf.readUInt32LE(8);
  var off = 12, json = null, bin = null;
  while (off < total) {
    var len = buf.readUInt32LE(off);
    var type = buf.readUInt32LE(off + 4);
    if (type === 0x4E4F534A) json = JSON.parse(buf.slice(off + 8, off + 8 + len).toString('utf8'));
    else if (type === 0x004E4942) bin = buf.slice(off + 8, off + 8 + len);
    off += 8 + len;
  }
  if (!json) throw new Error('GLB 缺少 JSON chunk');
  return { gl: json, bin: bin };
}

function writeGLB(gl, bin) {
  var jsonBuf = Buffer.from(JSON.stringify(gl), 'utf8');
  var jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  if (jsonPad) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);
  var binBuf = bin || Buffer.alloc(0);
  var binPad = (4 - (binBuf.length % 4)) % 4;
  if (binPad) binBuf = Buffer.concat([binBuf, Buffer.alloc(binPad)]);

  var total = 12 + 8 + jsonBuf.length + (binBuf.length ? 8 + binBuf.length : 0);
  var head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546C67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(total, 8);

  var jsonHead = Buffer.alloc(8);
  jsonHead.writeUInt32LE(jsonBuf.length, 0);
  jsonHead.writeUInt32LE(0x4E4F534A, 4);

  var parts = [head, jsonHead, jsonBuf];
  if (binBuf.length) {
    var binHead = Buffer.alloc(8);
    binHead.writeUInt32LE(binBuf.length, 0);
    binHead.writeUInt32LE(0x004E4942, 4);
    parts.push(binHead, binBuf);
  }
  return Buffer.concat(parts);
}

/* ---------------- 4x4 矩阵（列主序，与 glTF 一致） ---------------- */

function mIdent() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }

function mMul(a, b) {
  var o = new Array(16);
  for (var c = 0; c < 4; c++) {
    for (var r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

function mTRS(t, yawDeg, s) {
  var m = mIdent();
  var c = Math.cos(yawDeg * D2R), sn = Math.sin(yawDeg * D2R);
  m[0] = c * s; m[1] = 0; m[2] = -sn * s; m[3] = 0;
  m[4] = 0; m[5] = s; m[6] = 0; m[7] = 0;
  m[8] = sn * s; m[9] = 0; m[10] = c * s; m[11] = 0;
  m[12] = t[0]; m[13] = t[1]; m[14] = t[2]; m[15] = 1;
  return m;
}

function mRotX(deg) {
  var m = mIdent();
  var c = Math.cos(deg * D2R), s = Math.sin(deg * D2R);
  m[5] = c; m[6] = s; m[9] = -s; m[10] = c;
  return m;
}

function mPoint(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]
  ];
}

function quatToMat(q) {
  var x = q[0], y = q[1], z = q[2], w = q[3];
  var x2 = x + x, y2 = y + y, z2 = z + z;
  var xx = x * x2, xy = x * y2, xz = x * z2;
  var yy = y * y2, yz = y * z2, zz = z * z2;
  var wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    1 - (yy + zz), xy + wz, xz - wy, 0,
    xy - wz, 1 - (xx + zz), yz + wx, 0,
    xz + wy, yz - wx, 1 - (xx + yy), 0,
    0, 0, 0, 1
  ];
}

function nodeMatrix(n) {
  if (n.matrix) return n.matrix.slice();
  var t = n.translation || [0, 0, 0];
  var r = n.rotation || [0, 0, 0, 1];
  var s = n.scale || [1, 1, 1];
  var m = quatToMat(r);
  for (var c = 0; c < 3; c++) {
    m[c * 4] *= s[0];
    m[c * 4 + 1] *= s[1];
    m[c * 4 + 2] *= s[2];
  }
  m[12] = t[0]; m[13] = t[1]; m[14] = t[2];
  return m;
}

/* ---------------- 结构统计 ---------------- */

function analyse(gl) {
  var bbox = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  var tris = 0, meshes = 0, mats = {};
  var nodes = [];

  function walk(ni, parent) {
    var n = gl.nodes[ni];
    var world = mMul(parent, nodeMatrix(n));
    if (n.mesh != null) {
      var mesh = gl.meshes[n.mesh];
      meshes++;
      mesh.primitives.forEach(function (p) {
        var acc = gl.accessors[p.attributes.POSITION];
        var tri = p.indices != null ? gl.accessors[p.indices].count / 3 : acc.count / 3;
        tris += tri;
        if (p.material != null && gl.materials && gl.materials[p.material]) {
          mats[gl.materials[p.material].name || ('mat' + p.material)] = true;
        }
        if (acc.min && acc.max) {
          for (var c = 0; c < 8; c++) {
            var corner = [
              c & 1 ? acc.max[0] : acc.min[0],
              c & 2 ? acc.max[1] : acc.min[1],
              c & 4 ? acc.max[2] : acc.min[2]
            ];
            var w = mPoint(world, corner);
            for (var k = 0; k < 3; k++) {
              bbox.min[k] = Math.min(bbox.min[k], w[k]);
              bbox.max[k] = Math.max(bbox.max[k], w[k]);
            }
          }
        }
      });
    }
    nodes.push({ name: n.name || '(node' + ni + ')', hasMesh: n.mesh != null, children: (n.children || []).length });
    (n.children || []).forEach(function (c) { walk(c, world); });
  }
  (gl.scenes[gl.scene || 0].nodes || []).forEach(function (ni) { walk(ni, mIdent()); });
  return { bbox: bbox, tris: Math.round(tris), meshes: meshes, materials: Object.keys(mats), nodes: nodes };
}

/* ---------------- 主流程 ---------------- */

function parseArgs(argv) {
  var a = { out: DEFAULT_OUT, length: 4.109, yaw: 0, up: 'Y', pivot: 'ground', rename: [], inspect: false, manifest: false };
  for (var i = 2; i < argv.length; i++) {
    var k = argv[i];
    if (k === '--name') a.name = argv[++i];
    else if (k === '--out') a.out = path.resolve(argv[++i]);
    else if (k === '--length') a.length = parseFloat(argv[++i]);
    else if (k === '--yaw') a.yaw = parseFloat(argv[++i]);
    else if (k === '--up') a.up = argv[++i].toUpperCase();
    else if (k === '--pivot') a.pivot = argv[++i];
    else if (k === '--rename') a.rename.push(argv[++i]);
    else if (k === '--manifest') a.manifest = true;
    else if (k === '--inspect') a.inspect = true;
    else if (k === '--help' || k === '-h') a.help = true;
    else if (!k.startsWith('--')) a.input = k;
  }
  return a;
}

function fmt(v) { return (Math.round(v * 1000) / 1000).toFixed(3); }

function main() {
  var args = parseArgs(process.argv);
  if (args.help || !args.input) {
    console.log('用法: node tools/import_model.js <in.glb> [--name id] [--length 4.109] [--yaw 0] [--up Y|Z]');
    console.log('       [--rename a=b ...] [--manifest] [--inspect] [--out dir]');
    return;
  }

  var input = path.resolve(args.input);
  var base = args.name || path.basename(input, path.extname(input));
  var raw = readGLB(fs.readFileSync(input));
  var gl = raw.gl;

  var before = analyse(gl);
  console.log('· 源模型 ' + path.basename(input));
  console.log('  节点 ' + before.nodes.length + ' / 网格 ' + before.meshes + ' / 三角面 ' + before.tris);
  console.log('  包围盒 ' + before.bbox.min.map(fmt).join(', ') + '  →  ' + before.bbox.max.map(fmt).join(', '));
  console.log('  尺寸 ' + fmt(before.bbox.max[0] - before.bbox.min[0]) + ' × ' +
    fmt(before.bbox.max[1] - before.bbox.min[1]) + ' × ' +
    fmt(before.bbox.max[2] - before.bbox.min[2]) + ' m（X×Y×Z）');
  console.log('  材质 ' + (before.materials.join(', ') || '(无)'));

  if (args.inspect) {
    console.log('\n· 节点树');
    before.nodes.slice(0, 60).forEach(function (n) {
      console.log('  ' + (n.hasMesh ? '▣' : '▢') + ' ' + n.name + (n.children ? '  (' + n.children + ' child)' : ''));
    });
    if (before.nodes.length > 60) console.log('  … 共 ' + before.nodes.length + ' 个节点');
    return;
  }

  // 1) 上轴修正：Z-up → Y-up（绕 X 轴 -90°）
  var upFix = args.up === 'Z' ? mRotX(-90) : mIdent();

  // 2) 旋转后的包围盒（用 8 个角点近似即可）
  var box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (var c = 0; c < 8; c++) {
    var p = [
      c & 1 ? before.bbox.max[0] : before.bbox.min[0],
      c & 2 ? before.bbox.max[1] : before.bbox.min[1],
      c & 4 ? before.bbox.max[2] : before.bbox.min[2]
    ];
    var q = mPoint(upFix, p);
    for (var k = 0; k < 3; k++) {
      box.min[k] = Math.min(box.min[k], q[k]);
      box.max[k] = Math.max(box.max[k], q[k]);
    }
  }

  // 3) 缩放：以车长（旋转后的 Z 向）对齐目标
  var srcLen = box.max[2] - box.min[2];
  var scale = args.length > 0 ? args.length / srcLen : 1;

  // 4) 平移到「中心 + 地面」
  var cx = (box.min[0] + box.max[0]) / 2;
  var cz = (box.min[2] + box.max[2]) / 2;
  var cy = args.pivot === 'center' ? (box.min[1] + box.max[1]) / 2 : box.min[1];
  var tx = -cx * scale, ty = -cy * scale, tz = -cz * scale;

  // 根矩阵：T · Ry · S · upFix
  var m = mMul(mTRS([0, 0, 0], args.yaw, scale), upFix);
  m[12] = tx; m[13] = ty; m[14] = tz;

  // 5) 材质改名
  if (args.rename.length) {
    var map = {};
    args.rename.forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i > 0) map[kv.slice(0, i)] = kv.slice(i + 1);
    });
    (gl.materials || []).forEach(function (mt) {
      if (map[mt.name]) {
        console.log('  ≈ 材质 ' + mt.name + ' → ' + map[mt.name]);
        mt.name = map[mt.name];
      }
    });
  }

  // 6) 包一层归一化根节点（不重写任何顶点）
  gl.nodes = gl.nodes || [];
  gl.scenes = gl.scenes || [{ nodes: [] }];
  var scene = gl.scenes[gl.scene || 0];
  var rootName = base;
  gl.nodes.push({ name: rootName, matrix: m, children: scene.nodes.slice() });
  scene.nodes = [gl.nodes.length - 1];
  gl.asset = gl.asset || { version: '2.0' };
  gl.asset.generator = (gl.asset.generator ? gl.asset.generator + ' | ' : '') + 'ParkMaster tools/import_model.js';

  // 7) 输出
  fs.mkdirSync(args.out, { recursive: true });
  var glbPath = path.join(args.out, base + '.glb');
  fs.writeFileSync(glbPath, writeGLB(gl, raw.bin));

  var gltf = JSON.parse(JSON.stringify(gl));
  gltf.buffers = gltf.buffers || [];
  if (gltf.buffers[0]) {
    var binName = base + '.bin';
    gltf.buffers[0] = { uri: binName, byteLength: raw.bin ? raw.bin.length : 0 };
    fs.writeFileSync(path.join(args.out, binName), raw.bin || Buffer.alloc(0));
  }
  fs.writeFileSync(path.join(args.out, base + '.gltf'), JSON.stringify(gltf, null, 2));

  var after = analyse(gl);
  console.log('\n✓ ' + path.relative(ROOT, glbPath) + '  ' + (fs.statSync(glbPath).size / 1024).toFixed(1) + ' KB');
  console.log('  缩放 ×' + fmt(scale) + '  旋转 ' + (args.yaw + (args.up === 'Z' ? ' + Z-up 修正' : '')) + '°');
  console.log('  归位后尺寸 ' + fmt(after.bbox.max[0] - after.bbox.min[0]) + ' × ' +
    fmt(after.bbox.max[1] - after.bbox.min[1]) + ' × ' +
    fmt(after.bbox.max[2] - after.bbox.min[2]) + ' m');
  console.log('  归位后包围盒 ' + after.bbox.min.map(fmt).join(', ') + '  →  ' + after.bbox.max.map(fmt).join(', '));

  if (args.manifest) {
    var mfPath = path.join(args.out, 'manifest.json');
    var mf = fs.existsSync(mfPath) ? JSON.parse(fs.readFileSync(mfPath, 'utf8')) : { models: [] };
    mf.models = (mf.models || []).filter(function (x) { return x.name !== base; });
    mf.models.push({
      file: base + '.glb',
      gltf: base + '.gltf',
      bin: base + '.bin',
      label: base + '（导入模型）',
      style: 'imported',
      imported: true,
      triangles: after.tris,
      bytes: fs.statSync(glbPath).size,
      bbox: { min: after.bbox.min.map(function (v) { return Math.round(v * 1000) / 1000; }), max: after.bbox.max.map(function (v) { return Math.round(v * 1000) / 1000; }) }
    });
    fs.writeFileSync(mfPath, JSON.stringify(mf, null, 2));
    console.log('  → manifest.json 已更新（imported: true）');
  }

  console.log('\n下一步：材质名对齐到 Paint / Glass / Tire / Rim / Chrome / HeadLamp / TailLamp；');
  console.log('轮组若是一个整体，需要拆成 Wheel_FL/FR/RL/RR 才能在游戏里转动（可在 Blender 里按轮心分离）。');
}

main();
