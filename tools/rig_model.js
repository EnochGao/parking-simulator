#!/usr/bin/env node
/* 车模拆件 / 加枢轴工具（零依赖，纯 Node）
 *
 * 解决"后视镜和车门在同一个网格里，但几何上是独立壳"的问题：
 * 按连通分量把指定的一块壳拆成独立节点，并把节点原点放到铰链/轮心等枢轴上。
 * 也能给本来就独立的节点（方向盘、码表）补一个枢轴父节点。
 *
 * 用法：
 *   node tools/rig_model.js in.glb --out out.glb --spec rig.json
 *   node tools/rig_model.js in.glb --spec rig.json --report   # 只报告可拆的壳
 *
 * rig.json 结构：
 * {
 *   "extract": [
 *     { "from": "polymsh_detached29_SUB1_LIVREA_0",
 *       "name": "Mirror_L",
 *       "center": [1.04, 1.18, 0.48], "radius": 0.30,   // 选中包围盒中心落在球内的连通块
 *       "pivot": [0.93, 1.18, 0.48],                     // 枢轴（世界坐标）
 *       "attach": ["polymsh_detached29_SUB2_MIRROR_0"]   // 一起挂到新节点下（可选）
 *     }
 *   ],
 *   "pivot": [
 *     { "node": "polymsh258_SUB1_INT_Plaastica_NERA_0", "name": "SteeringWheel",
 *       "pivot": [0.42, 1.02, 0.28] }
 *   ]
 * }
 */

'use strict';

var fs = require('fs');
var path = require('path');

/* ---------------- GLB ---------------- */

function readGLB(buf) {
  if (buf.readUInt32LE(0) !== 0x46546C67) throw new Error('不是 GLB');
  var total = buf.readUInt32LE(8), off = 12, json = null, bin = null;
  while (off < total) {
    var len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
    if (type === 0x4E4F534A) json = JSON.parse(buf.slice(off + 8, off + 8 + len).toString('utf8'));
    else if (type === 0x004E4942) bin = buf.slice(off + 8, off + 8 + len);
    off += 8 + len;
  }
  return { gl: json, bin: bin || Buffer.alloc(0) };
}

function writeGLB(gl, bin) {
  var jsonBuf = Buffer.from(JSON.stringify(gl), 'utf8');
  var pad = (4 - (jsonBuf.length % 4)) % 4;
  if (pad) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(pad, 0x20)]);
  var binBuf = bin || Buffer.alloc(0);
  var bpad = (4 - (binBuf.length % 4)) % 4;
  if (bpad) binBuf = Buffer.concat([binBuf, Buffer.alloc(bpad)]);
  var total = 12 + 8 + jsonBuf.length + (binBuf.length ? 8 + binBuf.length : 0);
  var head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546C67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(total, 8);
  var jh = Buffer.alloc(8); jh.writeUInt32LE(jsonBuf.length, 0); jh.writeUInt32LE(0x4E4F534A, 4);
  var parts = [head, jh, jsonBuf];
  if (binBuf.length) {
    var bh = Buffer.alloc(8); bh.writeUInt32LE(binBuf.length, 0); bh.writeUInt32LE(0x004E4942, 4);
    parts.push(bh, binBuf);
  }
  return Buffer.concat(parts);
}

/* ---------------- 矩阵 ---------------- */

function mId() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }

function mMul(a, b) {
  var o = new Array(16);
  for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}

function mInv(m) {
  var inv = new Array(16);
  inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
  inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
  inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
  inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
  inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
  inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
  inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
  inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
  inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
  inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
  inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
  inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
  inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
  inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
  inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
  inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
  var det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
  if (!det) return mId();
  det = 1 / det;
  for (var i = 0; i < 16; i++) inv[i] *= det;
  return inv;
}

function mApply(m, x, y, z) {
  return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
}

function nodeMatrix(n) {
  if (n.matrix) return n.matrix.slice();
  var t = n.translation || [0, 0, 0], r = n.rotation || [0, 0, 0, 1], s = n.scale || [1, 1, 1];
  var x = r[0], y = r[1], z = r[2], w = r[3];
  var x2 = x + x, y2 = y + y, z2 = z + z;
  var xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
  var wx = w * x2, wy = w * y2, wz = w * z2;
  var m = [1 - (yy + zz), xy + wz, xz - wy, 0, xy - wz, 1 - (xx + zz), yz + wx, 0, xz + wy, yz - wx, 1 - (xx + yy), 0, 0, 0, 0, 1];
  m[0] *= s[0]; m[1] *= s[0]; m[2] *= s[0];
  m[4] *= s[1]; m[5] *= s[1]; m[6] *= s[1];
  m[8] *= s[2]; m[9] *= s[2]; m[10] *= s[2];
  m[12] = t[0]; m[13] = t[1]; m[14] = t[2];
  return m;
}

/* ---------------- 读写 accessor ---------------- */

var COMP = { 5126: [Float32Array, 4], 5125: [Uint32Array, 4], 5123: [Uint16Array, 2], 5121: [Uint8Array, 1] };
var NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function makeCtx(gl, bin) {
  var ctx = { gl: gl, bin: bin };

  ctx.read = function (ai) {
    var a = gl.accessors[ai], bv = gl.bufferViews[a.bufferView];
    var C = COMP[a.componentType], n = NC[a.type], T = C[0];
    var start = (bv.byteOffset || 0) + (a.byteOffset || 0);
    var stride = bv.byteStride || C[1] * n;
    if (stride === C[1] * n) {
      return new T(bin.buffer, bin.byteOffset + start, a.count * n).slice();
    }
    var dv = new DataView(bin.buffer, bin.byteOffset);
    var out = new T(a.count * n);
    for (var i = 0; i < a.count; i++) {
      for (var c = 0; c < n; c++) {
        var o = start + i * stride + c * C[1];
        out[i * n + c] = a.componentType === 5126 ? dv.getFloat32(o, true)
          : (a.componentType === 5123 ? dv.getUint16(o, true) : dv.getUint32(o, true));
      }
    }
    return out;
  };

  function append(typed) {
    var bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    var pad = (4 - (bin.length % 4)) % 4;
    if (pad) bin = Buffer.concat([bin, Buffer.alloc(pad)]);
    var off = bin.length;
    bin = Buffer.concat([bin, bytes]);
    ctx.bin = bin;
    return { off: off, len: bytes.length };
  }
  ctx.bin = bin;

  ctx.addAcc = function (arr, type, compType, extra) {
    var v = append(arr);
    gl.bufferViews.push({ buffer: 0, byteOffset: v.off, byteLength: v.len, target: type === 'SCALAR' ? 34963 : 34962 });
    var acc = { bufferView: gl.bufferViews.length - 1, componentType: compType, count: arr.length / NC[type], type: type };
    if (extra) for (var k in extra) acc[k] = extra[k];
    gl.accessors.push(acc);
    return gl.accessors.length - 1;
  };
  return ctx;
}

/* ---------------- 主逻辑 ---------------- */

function parseArgs(argv) {
  var a = { out: null, spec: null, report: false };
  for (var i = 2; i < argv.length; i++) {
    if (argv[i] === '--out') a.out = argv[++i];
    else if (argv[i] === '--spec') a.spec = argv[++i];
    else if (argv[i] === '--report') a.report = true;
    else if (!argv[i].startsWith('--')) a.input = argv[i];
  }
  return a;
}

function main() {
  var args = parseArgs(process.argv);
  if (!args.input || !args.spec) {
    console.log('用法: node tools/rig_model.js <in.glb> --spec rig.json [--out out.glb] [--report]');
    return;
  }
  var raw = readGLB(fs.readFileSync(path.resolve(args.input)));
  var gl = raw.gl;
  var ctx = makeCtx(gl, raw.bin);
  var spec = JSON.parse(fs.readFileSync(path.resolve(args.spec), 'utf8'));

  gl.scenes = gl.scenes || [{ nodes: [] }];
  var scene = gl.scenes[gl.scene || 0];

  // 建立父表 + 世界矩阵
  var parentOf = {}, worldOf = {};
  function walk(idx, parent, parentWorld) {
    var m = nodeMatrix(gl.nodes[idx]);
    var w = mMul(parentWorld, m);
    parentOf[idx] = parent;
    worldOf[idx] = w;
    (gl.nodes[idx].children || []).forEach(function (c) { walk(c, idx, w); });
  }
  scene.nodes.forEach(function (n) { walk(n, -1, mId()); });

  function findNode(name) {
    for (var i = 0; i < gl.nodes.length; i++) if (gl.nodes[i].name === name) return i;
    return -1;
  }

  function detach(idx) {
    var p = parentOf[idx];
    if (p >= 0) {
      var arr = gl.nodes[p].children;
      gl.nodes[p].children = arr.filter(function (c) { return c !== idx; });
    } else {
      scene.nodes = scene.nodes.filter(function (c) { return c !== idx; });
    }
  }

  function attach(parentIdx, childIdx) {
    detach(childIdx);
    if (parentIdx >= 0) {
      var pn = gl.nodes[parentIdx];
      pn.children = pn.children || [];
      pn.children.push(childIdx);
    } else {
      scene.nodes.push(childIdx);
    }
  }

  // ---- 1. 拆连通块 ----
  (spec.extract || []).forEach(function (job) {
    var ni = findNode(job.from);
    if (ni < 0) { console.log('✗ 找不到节点 ' + job.from); return; }
    var node = gl.nodes[ni];
    var mesh = gl.meshes[node.mesh];
    var W = worldOf[ni], Wp = parentOf[ni] >= 0 ? worldOf[parentOf[ni]] : mId();
    var WpInv = mInv(Wp);
    var pivotParent = mApply(WpInv, job.pivot[0], job.pivot[1], job.pivot[2]);

    var keepPrims = [], newPrims = [], picked = 0, total = 0;

    mesh.primitives.forEach(function (prim) {
      var pos = ctx.read(prim.attributes.POSITION);
      var nrm = prim.attributes.NORMAL != null ? ctx.read(prim.attributes.NORMAL) : null;
      var uv = prim.attributes.TEXCOORD_0 != null ? ctx.read(prim.attributes.TEXCOORD_0) : null;
      var idx = prim.indices != null ? ctx.read(prim.indices) : null;
      var vCount = pos.length / 3;
      var tCount = idx ? idx.length / 3 : vCount / 3;

      // 连通分量（按位置）
      var parent = new Int32Array(vCount);
      for (var i = 0; i < vCount; i++) parent[i] = i;
      function find(a) { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; }
      var key = new Map(), remap = new Int32Array(vCount);
      for (i = 0; i < vCount; i++) {
        var k = Math.round(pos[i * 3] * 1e5) + ',' + Math.round(pos[i * 3 + 1] * 1e5) + ',' + Math.round(pos[i * 3 + 2] * 1e5);
        if (!key.has(k)) key.set(k, i);
        remap[i] = key.get(k);
      }
      function union(a, b) { a = find(a); b = find(b); if (a !== b) parent[b] = a; }
      for (var t = 0; t < tCount; t++) {
        var a0 = remap[idx ? idx[t * 3] : t * 3];
        var b0 = remap[idx ? idx[t * 3 + 1] : t * 3 + 1];
        var c0 = remap[idx ? idx[t * 3 + 2] : t * 3 + 2];
        union(a0, b0); union(b0, c0);
      }

      // 每个连通块的世界包围盒中心
      var boxes = new Map();
      for (t = 0; t < tCount; t++) {
        var r0 = find(remap[idx ? idx[t * 3] : t * 3]);
        if (!boxes.has(r0)) boxes.set(r0, { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] });
        var bx = boxes.get(r0);
        for (var k2 = 0; k2 < 3; k2++) {
          var vi = idx ? idx[t * 3 + k2] : t * 3 + k2;
          var w = mApply(W, pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2]);
          for (var q = 0; q < 3; q++) { bx.min[q] = Math.min(bx.min[q], w[q]); bx.max[q] = Math.max(bx.max[q], w[q]); }
        }
      }
      var pickRoots = new Set();
      boxes.forEach(function (bx, root) {
        var c = [(bx.min[0] + bx.max[0]) / 2, (bx.min[1] + bx.max[1]) / 2, (bx.min[2] + bx.max[2]) / 2];
        var d = Math.hypot(c[0] - job.center[0], c[1] - job.center[1], c[2] - job.center[2]);
        if (d <= (job.radius || 0.3)) pickRoots.add(root);
      });

      function buildTris(roots, transform) {
        var vmap = new Map(), outPos = [], outNrm = [], outUv = [], outIdx = [];
        var normalMat = transform ? mInv(transform) : null; // 逆转置近似（均匀缩放无影响）
        for (var tt = 0; tt < tCount; tt++) {
          var rr = find(remap[idx ? idx[tt * 3] : tt * 3]);
          if (roots !== null && !roots.has(rr)) continue;
          if (roots === null && pickRoots.has(rr)) continue;
          for (var kk = 0; kk < 3; kk++) {
            var v = idx ? idx[tt * 3 + kk] : tt * 3 + kk;
            var nv = vmap.get(v);
            if (nv == null) {
              nv = outPos.length / 3;
              vmap.set(v, nv);
              var px = pos[v * 3], py = pos[v * 3 + 1], pz = pos[v * 3 + 2];
              if (transform) {
                var wp = mApply(transform, px, py, pz);
                outPos.push(wp[0], wp[1], wp[2]);
              } else outPos.push(px, py, pz);
              if (nrm) {
                if (transform) {
                  var nx = nrm[v * 3], ny = nrm[v * 3 + 1], nz = nrm[v * 3 + 2];
                  var tx = normalMat[0] * nx + normalMat[4] * ny + normalMat[8] * nz;
                  var ty = normalMat[1] * nx + normalMat[5] * ny + normalMat[9] * nz;
                  var tz = normalMat[2] * nx + normalMat[6] * ny + normalMat[10] * nz;
                  var l = Math.hypot(tx, ty, tz) || 1;
                  outNrm.push(tx / l, ty / l, tz / l);
                } else outNrm.push(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]);
              }
              if (uv) outUv.push(uv[v * 2], uv[v * 2 + 1]);
            }
            outIdx.push(nv);
          }
        }
        return { pos: outPos, nrm: outNrm, uv: outUv, idx: outIdx };
      }

      // 提取件：坐标转到「父空间 - 枢轴」
      var toParent = mMul(WpInv, W);
      var T = mId();
      T[12] = -pivotParent[0]; T[13] = -pivotParent[1]; T[14] = -pivotParent[2];
      var ex = buildTris(pickRoots, mMul(T, toParent));
      var rest = buildTris(null, null);

      picked += ex.idx.length / 3;
      total += tCount;

      if (ex.idx.length) {
        newPrims.push({ data: ex, material: prim.material, mode: prim.mode });
      }
      if (rest.idx.length) {
        keepPrims.push({ data: rest, material: prim.material, mode: prim.mode });
      }
    });

    if (!newPrims.length) { console.log('✗ ' + job.from + ' 没有选中任何连通块'); return; }

    function writePrim(list) {
      return list.map(function (p) {
        var attrs = {
          POSITION: ctx.addAcc(new Float32Array(p.data.pos), 'VEC3', 5126, boundsOf(p.data.pos)),
          NORMAL: p.data.nrm.length ? ctx.addAcc(new Float32Array(p.data.nrm), 'VEC3', 5126) : undefined
        };
        if (p.data.uv.length) attrs.TEXCOORD_0 = ctx.addAcc(new Float32Array(p.data.uv), 'VEC2', 5126);
        var use32 = p.data.pos.length / 3 > 65535;
        var indices = ctx.addAcc(use32 ? new Uint32Array(p.data.idx) : new Uint16Array(p.data.idx), 'SCALAR', use32 ? 5125 : 5123);
        var out = { attributes: attrs, indices: indices };
        if (p.material != null) out.material = p.material;
        if (p.mode != null) out.mode = p.mode;
        return out;
      }).filter(function (p) { return p.attributes.POSITION != null; });
    }

    function boundsOf(arr) {
      var min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
      for (var i = 0; i < arr.length; i += 3) for (var k = 0; k < 3; k++) {
        if (arr[i + k] < min[k]) min[k] = arr[i + k];
        if (arr[i + k] > max[k]) max[k] = arr[i + k];
      }
      return { min: min, max: max };
    }

    // 新网格 / 新节点
    gl.meshes.push({ name: job.name, primitives: writePrim(newPrims) });
    var newMeshIdx = gl.meshes.length - 1;

    // 原网格瘦身
    if (keepPrims.length) {
      gl.meshes.push({ name: (mesh.name || node.name) + '_rest', primitives: writePrim(keepPrims) });
      node.mesh = gl.meshes.length - 1;
    } else {
      delete node.mesh;
    }

    gl.nodes.push({
      name: job.name,
      translation: pivotParent,
      mesh: newMeshIdx,
      extras: { kind: 'pivot', axis: job.axis || 'Y' }
    });
    var newIdx = gl.nodes.length - 1;
    attach(parentOf[ni], newIdx);

    // 一起挂过来的零件（例如镜片）
    (job.attach || []).forEach(function (name) {
      var ci = findNode(name);
      if (ci < 0) { console.log('  ! 找不到 attach 节点 ' + name); return; }
      var L = nodeMatrix(gl.nodes[ci]);
      var T2 = mId();
      T2[12] = -pivotParent[0]; T2[13] = -pivotParent[1]; T2[14] = -pivotParent[2];
      var M = mMul(T2, L);
      delete gl.nodes[ci].translation; delete gl.nodes[ci].rotation; delete gl.nodes[ci].scale;
      gl.nodes[ci].matrix = M;
      attach(newIdx, ci);
    });

    console.log('✓ ' + job.name + ' ← ' + job.from + '  提取 ' + picked + '/' + total + ' 面，枢轴 ' + job.pivot.join(','));
  });

  // ---- 2. 给已有节点加枢轴父节点 ----
  (spec.pivot || []).forEach(function (job) {
    var ni = findNode(job.node);
    if (ni < 0) { console.log('✗ 找不到节点 ' + job.node); return; }
    var Wp = parentOf[ni] >= 0 ? worldOf[parentOf[ni]] : mId();
    var pivotParent = mApply(mInv(Wp), job.pivot[0], job.pivot[1], job.pivot[2]);
    var L = nodeMatrix(gl.nodes[ni]);
    var T = mId();
    T[12] = -pivotParent[0]; T[13] = -pivotParent[1]; T[14] = -pivotParent[2];
    var M = mMul(T, L);
    delete gl.nodes[ni].translation; delete gl.nodes[ni].rotation; delete gl.nodes[ni].scale;
    gl.nodes[ni].matrix = M;

    gl.nodes.push({
      name: job.name,
      translation: pivotParent,
      children: [ni],
      extras: { kind: 'pivot', axis: job.axis || 'Z' }
    });
    var newIdx = gl.nodes.length - 1;
    attach(parentOf[ni], newIdx);
    attach(newIdx, ni);
    console.log('✓ ' + job.name + '（枢轴）→ ' + job.node + '  枢轴 ' + job.pivot.join(','));
  });

  var outPath = path.resolve(args.out || args.input.replace(/\.glb$/i, '_rigged.glb'));
  fs.writeFileSync(outPath, writeGLB(gl, ctx.bin));
  console.log('\n→ ' + path.relative(process.cwd(), outPath) + '  ' + (fs.statSync(outPath).size / 1024 / 1024).toFixed(2) + ' MB');
}

main();
