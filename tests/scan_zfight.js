/* 全关卡静态障碍共面/穿模扫描（关卡数据门禁，node tests/scan_zfight.js）
 * - 共面 z-fight：两 OBB 的一对**同法线**表面共面（间距 < 1mm，深度缓冲无法区分）
 *   且投影重叠——两面同时朝向相机争夺深度 → 行驶中呈虚影闪烁（lv01 大楼虚影即此）。
 *   背靠背贴合（法线相反，如两栋楼共用手拉手墙面）任何视角只有一面朝前，
 *   不会争夺，不报。
 * - 穿模：停放车与其他障碍互相嵌入超过 2cm（视觉穿帮）。楼/墙/柱互相穿插是
 *   正常的关卡拼接手法（L 形墙角、连片楼群），不构成视觉问题，不报。
 * scan() 返回发现列表（空 = 通过）；直接运行本文件时打印并以发现数作退出码。 */
'use strict';
var path = require('path');
var JS = path.join(__dirname, '..', 'js');
var L = require(path.join(JS, 'levels.js'));
var D2R = Math.PI / 180;
var COPLANAR_TOL = 1e-3;      // 1mm：视为共面（深度缓冲无法区分）
var INTERPEN_TOL = 0.02;      // 2cm：嵌入超过此值算穿模

function obbOf(o) {
  if (o.t === 'wall' || o.t === 'bldg') return { hw: (o.wid || 0.4) / 2, hl: o.len / 2, h: o.h || (o.t === 'bldg' ? 10 : 2.2) };
  if (o.t === 'pillar') return { hw: 0.25, hl: 0.25, h: 3.0 };
  if (o.t === 'car') return { hw: 1.694 / 2, hl: 4.109 / 2, h: 1.52 };
  return null;   // tree/bin 非盒体（圆柱/圆角），跳过
}

function scan() {
  var out = [];
  L.LEVELS.forEach(function (lv) {
    var obs = [];
    lv.obstacles.forEach(function (o) {
      var d = obbOf(o);
      if (d) obs.push({ x: o.x, z: o.z, ang: (o.a || 0) * D2R, hw: d.hw, hl: d.hl, h: d.h, t: o.t, id: o.t + '@(' + o.x + ',' + o.z + ',' + (o.a || 0) + ')' });
    });
    for (var i = 0; i < obs.length; i++) {
      for (var j = i + 1; j < obs.length; j++) {
        var A = obs[i], B = obs[j];
        // 面平行的条件：相对角为 90° 的整数倍；相差恰 90° 时 B 的长宽沿 A 的两轴互换
        var adiff = Math.abs(A.ang - B.ang) % Math.PI;                    // [0, π)
        var parallel = adiff < 1e-9 || Math.abs(adiff - Math.PI / 2) < 1e-9;
        if (!parallel) continue;
        var swapped = Math.abs(adiff - Math.PI / 2) < 1e-9;
        var exB = swapped ? B.hl : B.hw;   // B 沿 A 局部 x 的半宽
        var ezB = swapped ? B.hw : B.hl;   // B 沿 A 局部 z 的半宽
        // B 中心变换到 A 局部系（A 的右轴=(cos a,-sin a)，前轴=(sin a,cos a)）
        var dx = B.x - A.x, dz = B.z - A.z;
        var c = Math.cos(A.ang), s = Math.sin(A.ang);
        var bx = dx * c - dz * s, bz = dx * s + dz * c;
        [['x', A.hw, exB, bx, bz, A.hl, ezB], ['z', A.hl, ezB, bz, bx, A.hw, exB]].forEach(function (row) {
          var axis = row[0], hwA = row[1], hwB2 = row[2], bC = row[3], oC = row[4], hlA = row[5], hlB2 = row[6];
          [-1, 1].forEach(function (sA) {
            [-1, 1].forEach(function (sB) {
              var p = sA * hwA;
              var gap = Math.abs(p - (bC + sB * hwB2));
              var o0 = Math.max(-hlA, oC - hlB2), o1 = Math.min(hlA, oC + hlB2);
              if (gap >= COPLANAR_TOL || o1 - o0 <= COPLANAR_TOL) return;
              // 同法线判定：两面各自的实体都在平面的同一侧 → 两面同时朝向相机 → 争夺；
              // 实体分居两侧（背靠背贴合）→ 任一视角只有一面朝前 → 安全
              if ((bC - p) * (-sA) <= 0) return;
              out.push(lv.id + ' 共面zfight: ' + A.id + ' × ' + B.id + '  ' + axis +
                '面间距=' + (gap * 1000).toFixed(3) + 'mm 重叠=' + (o1 - o0).toFixed(2) + 'm(高至' + Math.min(A.h, B.h).toFixed(1) + 'm)');
            });
          });
        });
        // 穿模：两轴嵌入深度均超阈值（仅查涉及停放车的对）
        var depX = A.hw + exB - Math.abs(bx);
        var depZ = A.hl + ezB - Math.abs(bz);
        if ((A.t === 'car' || B.t === 'car') && depX > INTERPEN_TOL && depZ > INTERPEN_TOL) {
          out.push(lv.id + ' 穿模: ' + A.id + ' × ' + B.id + '  嵌入 x=' + depX.toFixed(2) + 'm z=' + depZ.toFixed(2) + 'm');
        }
      }
    }
  });
  return out;
}

module.exports = { scan: scan };

if (require.main === module) {
  var f = scan();
  f.forEach(function (l) { console.log(l); });
  console.log(f.length === 0 ? '全部关卡无共面zfight/车辆穿模问题' : '共 ' + f.length + ' 处发现');
  process.exit(f.length ? 1 : 0);
}
