/* 拐弯逻辑 · 真实性数值检查（Node 无头）
 * 运行：node tools/turn_check.js
 *
 * 对照两个模型在同一机动下的表现：
 *  - Model S = 游戏现模型（js/physics.js 原样：车几何中心沿航向推进 + 后轴公式偏航率）
 *  - Model R = 真车参考模型（严格自行车模型：以后轴中心为参考点，后轴无侧向速度——
 *    真实车后轮不偏转、不侧滑，瞬时转向中心必在后轴延长线上）
 *
 * 检查项（真实世界依据）：
 *  1. 瞬时转向中心是否在后轴延长线上（真车刚体转向不变量）
 *  2. 后轴转弯半径 R = 轴距/tan(前轮角)；前外轮最小转弯半径 vs GR9 标定 4.9m
 *  3. 内轮差：同转 90° 后前外轮与后外轮的横向轨迹差
 *  4. 车尾外摆：外后角甩出初始车宽包络的最大量
 *  5. 倒车打左舵 → 车尾向车左摆（真车倒车指向逻辑） */
'use strict';
var path = require('path');
var JS = path.join(__dirname, '..', 'js');
var CFG = require(path.join(JS, 'config.js'));
var PHYS = require(path.join(JS, 'physics.js'));
var D2R = CFG.D2R;
var CAR = CFG.CAR;
var wb = CAR.wheelbase, hw = CAR.width / 2, halfL = CAR.length / 2;
var FRONT_OH = 0.84;                       // 前悬（carModel.js 标定）
var rearOH = CAR.length - FRONT_OH - wb;   // 后悬 0.739
var dRear = halfL - rearOH;                // 中心→后轴 1.3155

function fwd(h) { return { x: Math.sin(h), z: Math.cos(h) }; }
function left(h) { return { x: Math.cos(h), z: -Math.sin(h) }; }

function circleCenter(p, i0, i1, i2) {
  var a = p[i0], b = p[i1], c = p[i2];
  var d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  var ux = ((a[0] * a[0] + a[1] * a[1]) * (b[1] - c[1]) + (b[0] * b[0] + b[1] * b[1]) * (c[1] - a[1]) +
            (c[0] * c[0] + c[1] * c[1]) * (a[1] - b[1])) / d;
  var uz = ((a[0] * a[0] + a[1] * a[1]) * (c[0] - b[0]) + (b[0] * b[0] + b[1] * b[1]) * (a[0] - c[0]) +
            (c[0] * c[0] + c[1] * c[1]) * (b[0] - a[0])) / d;
  return { x: ux, z: uz };
}
function fitRadius(p, i0, i1, i2) {
  var c = circleCenter(p, i0, i1, i2);
  return Math.hypot(p[i0][0] - c.x, p[i0][1] - c.z);
}

/* ---- Model S：游戏现模型（physics.js 原样，参考点=车几何中心） ---- */
function simModel(steerFrac, dir, headingTargetDeg) {
  var c = new PHYS.CarPhysics({ car: CAR, phys: CFG.PHYS }, { x: 0, z: 0, heading: 0 });
  c.steer = steerFrac * CAR.maxSteer;      // 直接置舵角（跳过输入斜坡，纯几何对比）
  var pts = { rearAxle: [], frontAxle: [], rearLC: [], rearRC: [], center: [] };
  var guard = 0;
  while (Math.abs(c.heading) < headingTargetDeg * D2R && guard++ < 40000) {
    c.update(1 / 60, { drive: dir > 0 ? 1 : -1, holdSteer: true });
    var f = fwd(c.heading), l = left(c.heading);
    pts.center.push([c.x, c.z]);
    pts.rearAxle.push([c.x - f.x * dRear, c.z - f.z * dRear]);
    pts.frontAxle.push([c.x + f.x * (halfL - FRONT_OH), c.z + f.z * (halfL - FRONT_OH)]);
    pts.rearLC.push([c.x - f.x * halfL + l.x * hw, c.z - f.z * halfL + l.z * hw]);
    pts.rearRC.push([c.x - f.x * halfL - l.x * hw, c.z - f.z * halfL - l.z * hw]);
  }
  return pts;
}

/* ---- Model R：真车参考（后轴参考自行车模型，后轴无侧滑，恒速） ---- */
function realModel(steerFrac, dir, headingTargetDeg) {
  var v = dir * 2.0;                        // 恒速 2m/s（低速运动学轨迹与速度无关）
  var rx = 0, rz = 0, h = 0, dt = 1 / 60;
  var pts = { rearAxle: [], frontAxle: [], rearLC: [], rearRC: [], center: [] };
  var guard = 0;
  while (Math.abs(h) < headingTargetDeg * D2R && guard++ < 40000) {
    pts.rearAxle.push([rx, rz]);
    pts.center.push([rx + Math.sin(h) * dRear, rz + Math.cos(h) * dRear]);
    pts.frontAxle.push([rx + Math.sin(h) * wb, rz + Math.cos(h) * wb]);
    pts.rearLC.push([rx - Math.sin(h) * rearOH + Math.cos(h) * hw, rz - Math.cos(h) * rearOH - Math.sin(h) * hw]);
    pts.rearRC.push([rx - Math.sin(h) * rearOH - Math.cos(h) * hw, rz - Math.cos(h) * rearOH + Math.sin(h) * hw]);
    h += v * Math.tan(steerFrac * CAR.maxSteer) / wb * dt;
    rx += v * Math.sin(h) * dt;
    rz += v * Math.cos(h) * dt;
  }
  return pts;
}

/* 车尾外摆：外后角横向轨迹越出初始车宽包络（|lat|>hw）的最大量 */
function tailSwingOut(pts, l0, outerKey) {
  var maxAbs = 0;
  pts[outerKey].forEach(function (p) {
    var lat = p[0] * l0.x + p[1] * l0.z;
    if (Math.abs(lat) > maxAbs) maxAbs = Math.abs(lat);
  });
  return maxAbs - hw;
}
/* 横向位置（初始航向横向轴投影） */
function latOf(p, l0) { return p[0] * l0.x + p[1] * l0.z; }

var l0 = left(0);
var failures = 0;
function reportRow(name, s, r, tolPct) {
  var dev = r !== 0 ? (s - r) / r * 100 : 0;
  var ok = !(tolPct != null) || Math.abs(dev) <= tolPct;
  if (!ok) failures++;
  console.log('  ' + name + '  游戏=' + s.toFixed(3) + 'm  真车参考=' + r.toFixed(3) + 'm  偏差=' +
    (r !== 0 ? dev.toFixed(1) + '%' : '—') + (ok ? '' : '  ✗ 超阈值 ±' + tolPct + '%'));
  return dev;
}
function check(name, ok, detail) {
  if (!ok) failures++;
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + name + (detail ? '（' + detail + '）' : ''));
}

/* ============ 满舵左转 90°（前进） ============ */
console.log('== 满舵左转 90°（前进）——几何对比 ==');
var S = simModel(1, 1, 90), R = realModel(1, 1, 90);
var mid = function (n) { return Math.floor(n / 2); };
var Rr = wb / Math.tan(CAR.maxSteer);      // 真车后轴转向半径 3.483

var icrS = circleCenter(S.center, 0, mid(S.center.length), S.center.length - 1);
var icrR = circleCenter(R.rearAxle, 0, mid(R.rearAxle.length), R.rearAxle.length - 1);

// ICR 横向位置（相对初始后轴中心，沿初始车横向轴）：真车模型应在后轴延长线上（横偏=0）
var icrSLat = latOf([icrS.x - 0, icrS.z + dRear], l0);
var icrRLat = latOf([icrR.x - 0, icrR.z + dRear], l0);
var icrDev = Math.abs((icrSLat - icrRLat) / icrRLat * 100);
check('瞬时转向中心位置：游戏 vs 真车参考', icrDev <= 2.5,
  '游戏=' + icrSLat.toFixed(3) + 'm 真车参考=' + icrRLat.toFixed(3) + 'm 偏差=' + icrDev.toFixed(1) + '%');

reportRow('后轴转向半径', fitRadius(S.rearAxle, 0, mid(S.rearAxle.length), S.rearAxle.length - 1), Rr, 2.5);
reportRow('车中心转向半径', fitRadius(S.center, 0, mid(S.center.length), S.center.length - 1), Math.sqrt(Rr * Rr + dRear * dRear), 2.5);

/* 前外轮半径：前轴 ± 轮距/2，取离各自 ICR 更远的（外侧） */
function outerWheelRadius(pts, icr) {
  var p0 = pts.frontAxle[0], wl0 = left(0);
  var w1 = Math.hypot(p0[0] + wl0.x * CAR.trackF / 2 - icr.x, p0[1] + wl0.z * CAR.trackF / 2 - icr.z);
  var w2 = Math.hypot(p0[0] - wl0.x * CAR.trackF / 2 - icr.x, p0[1] - wl0.z * CAR.trackF / 2 - icr.z);
  return Math.max(w1, w2);
}
reportRow('前外轮转弯半径（GR9 标定 4.9m）', outerWheelRadius(S, icrS), outerWheelRadius(R, icrR), 2.5);
reportRow('车尾外摆（越出车宽包络）', tailSwingOut(S, l0, 'rearRC'), tailSwingOut(R, l0, 'rearRC'), 2.5);
/* 内轮差：转 90° 后前外轮与后外轮的横向位置差 */
var innerDiff = function (pts) {
  var lfe = pts.frontAxle[pts.frontAxle.length - 1], lre = pts.rearRC[pts.rearRC.length - 1];
  return Math.abs(latOf(lfe, l0) - latOf(lre, l0));
};
reportRow('内轮差（90° 后前外轮-后外轮横向差）', innerDiff(S), innerDiff(R), 2.5);

/* ============ 满舵左打、倒车 90° ============ */
console.log('== 满舵左打、倒车 90°——车尾摆向与外摆 ==');
var SRev = simModel(1, -1, 90), RRev = realModel(1, -1, 90);
var sLat = latOf(SRev.rearLC[SRev.rearLC.length - 1], l0);
var rLat = latOf(RRev.rearLC[RRev.rearLC.length - 1], l0);
check('倒车满舵左打 90°：车尾甩向车左（两模型方向一致）', sLat > 0 && rLat > 0,
  '游戏=' + sLat.toFixed(3) + 'm 真车参考=' + rLat.toFixed(3) + 'm，正值=甩向车左');
reportRow('车尾外摆（越出车宽包络，倒车）', tailSwingOut(SRev, l0, 'rearRC'), tailSwingOut(RRev, l0, 'rearRC'), 2.5);

/* ============ 门禁汇总 ============ */
if (failures > 0) {
  console.log('TURN CHECK FAIL（' + failures + ' 项超阈值）');
  process.exit(1);
}
console.log('TURN CHECK PASS（全部真实性指标在阈值内）');
