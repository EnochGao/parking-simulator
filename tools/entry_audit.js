/* 入位方向审计：用与 sim.trackEntry 同一套规则（四角全入库上升沿按近 0.5s
 * 净纵向位移判 rev/fwd）判定每关演示路径的入位方向，与关卡 entry 标注比对。
 * 运行：node tools/entry_audit.js [levelId ...]   无参数=全部关卡 */
'use strict';
var path = require('path');
var JS = path.join(__dirname, '..', 'js');
var LVL = require(path.join(JS, 'levels.js'));
var AUTO = require(path.join(JS, 'autopilot.js'));

var ids = process.argv.slice(2);
var CFG = require(path.join(JS, 'config.js'));
var CARL = CFG.CAR.length, CARW = CFG.CAR.width;

/** 角点入库状态（spot-local 判定，与 sim.trackEntry 同几何）：
 *  any=任意角在库内（与库有交集，记账条件）；front/rear=端两角全在库内 */
function cornersIn(spot, x, z, heading) {
  var cs = Math.cos(heading), sn = Math.sin(heading);
  var fx = sn, fz = cs, rx = cs, rz = -sn;
  var hw = CARW / 2, hl = CARL / 2;
  var ss = Math.sin(spot.angle), sc = Math.cos(spot.angle);
  var shw = spot.w / 2, shl = spot.l / 2;
  function inRect(cx, cz) {
    var dx = cx - spot.x, dz = cz - spot.z;
    return Math.abs(dx * ss + dz * sc) <= shl && Math.abs(dx * sc - dz * ss) <= shw;
  }
  var f0 = inRect(x + rx * hw + fx * hl, z + rz * hw + fz * hl);
  var f1 = inRect(x - rx * hw + fx * hl, z - rz * hw + fz * hl);
  var r0 = inRect(x + rx * hw - fx * hl, z + rz * hw - fz * hl);
  var r1 = inRect(x - rx * hw - fx * hl, z - rz * hw - fz * hl);
  return { front: f0 && f1, rear: r0 && r1, any: f0 || f1 || r0 || r1 };
}

var bad = 0;
LVL.LEVELS.forEach(function (lv) {
  if (ids.length && ids.indexOf(lv.id) < 0) return;
  var r = AUTO.runLevel(lv, { record: true });
  if (!r.success) { console.log('✗', lv.id, lv.name, '演示失败:', r.reason); bad++; return; }
  var spotRad = { x: lv.spot.x, z: lv.spot.z, angle: lv.spot.a * Math.PI / 180, w: lv.spot.w, l: lv.spot.l };
  // 与 sim.trackEntry 同规则（积分制）：车与库有交集期间，按档位方向累计沿库
  // 轴里程（对齐度加权）取多数派（录像帧不含速度，用相邻帧位移折算）
  var fwdIn = 0, revIn = 0;
  for (var i = 0; i < r.path.length; i++) {
    var p = r.path[i];
    var c = cornersIn(spotRad, p.x, p.z, p.h);
    if (!c.any) continue;
    var v = 0;
    if (i + 1 < r.path.length) {
      var q = r.path[i + 1];
      v = (q.x - p.x) * Math.sin(p.h) + (q.z - p.z) * Math.cos(p.h);   // 沿车头位移(m/帧)
    }
    var align = Math.abs(Math.cos(p.h - spotRad.angle));
    var d = Math.abs(v) * align;
    if (v < 0) revIn += d; else fwdIn += d;
  }
  var entryDir = revIn > fwdIn ? 'rev' : (fwdIn > revIn ? 'fwd' : null);
  var need = lv.entry || 'any';
  var ok = !lv.entry || entryDir === lv.entry;
  if (!ok) bad++;
  console.log((ok ? '✓' : '✗'), lv.id, lv.name, '→', entryDir,
    '(前进' + fwdIn.toFixed(1) + 'm/倒车' + revIn.toFixed(1) + 'm, 要求 ' + need + ')');
});
process.exit(bad ? 1 : 0);
