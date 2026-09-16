/* lv09 求解：复用 lv03 已验证的入库段（两关车位横截面一致），仅为 lv09 单独求接近段 */
'use strict';
var path = require('path');
var JS = path.join(__dirname, '..', 'js');
var CFG = require(path.join(JS, 'config.js'));
var COL = require(path.join(JS, 'collision.js'));
var SCO = require(path.join(JS, 'scoring.js'));
var LVL = require(path.join(JS, 'levels.js'));
var AUTO = require(path.join(JS, 'autopilot.js'));
var PULSE = require(path.join(JS, 'pulse.js'));
var Heap = require('./heap-shim.js');

var lv09 = LVL.byId('lv09');
var lv03 = LVL.byId('lv03');
var segs03 = require(path.join(JS, 'demo_paths.js')).lv03;
var car = CFG.CAR;
var dt = 1 / 60;

var obstacles09 = LVL.getObstacleObbs(lv09).map(function (o) { return COL.makeObb(o.x, o.z, o.angle, o.hw, o.hl); });
var obsR = obstacles09.map(function (o) { return Math.hypot(o.hw, o.hl) + 6.2; });
var b = lv09.bounds;

function collides(x, z, h) {
  for (var i = 0; i < obstacles09.length; i++) {
    var o = obstacles09[i];
    if (Math.hypot(x - o.x, z - o.z) > obsR[i]) continue;
    if (COL.obbOverlap(COL.makeObb(x, z, h, car.width / 2 + 0.25, car.length / 2 + 0.25), o)) return true;
  }
  return false;
}

/* 1) 找 lv03 路径中"进入 dock"的分割点：第一次距车位中心 <2.0m 的段边界 */
function replayBounds(level, segs) {
  var st = { x: level.player.x, z: level.player.z, h: level.player.a * Math.PI / 180, v: 0, steer: 0, gear: segs[0].g };
  var bounds = [{ x: st.x, z: st.z, h: st.h, v: st.v, gear: st.gear, idx: 0 }];
  var spot = { x: level.spot.x, z: level.spot.z };
  var entered = false;
  segs.forEach(function (seg, idx) {
    if (st.gear !== seg.g) {
      var g2 = 80;
      while (Math.abs(st.v) > 1e-3 && g2-- > 0) PULSE.brakeStep(st, dt, CFG.PHYS);
      st.gear = seg.g;
    }
    for (var i = 0; i < Math.round(seg.dur / dt); i++) {
      PULSE.stepMotion(st, seg.sf, dt, CFG.PHYS, car);
    }
    var d = Math.hypot(st.x - spot.x, st.z - spot.z);
    if (!entered && d < 2.0 && idx < segs.length - 4) {
      entered = true;
      bounds.push({ x: st.x, z: st.z, h: st.h, v: st.v, gear: st.gear, idx: idx + 1 });
    }
    bounds.push({ x: st.x, z: st.z, h: st.h, v: st.v, gear: st.gear, idx: idx + 1 });
  });
  return bounds;
}

var bounds03 = replayBounds(lv03, segs03);
var dockStart = null;
for (var i = bounds03.length - 1; i >= 0; i--) {
  if (bounds03[i].idx !== undefined && bounds03[i].hasOwnProperty('idx') && bounds03[i].idx > 0 && dockStart === null && bounds03[i].entered) { dockStart = bounds03[i]; }
}
// 上面过滤复杂，直接取第一个进入 2m 邻域的边界
dockStart = null;
for (i = 0; i < bounds03.length; i++) {
  var bb = bounds03[i];
  var d = Math.hypot(bb.x - lv03.spot.x, bb.z - lv03.spot.z);
  if (d < 2.0) { dockStart = bb; break; }
}
if (!dockStart) { console.log('未找到 lv03 dock 分割点'); process.exit(1); }
console.log('lv03 dock 分割点: idx=' + dockStart.idx, 'pos=(' + dockStart.x.toFixed(2) + ',' + dockStart.z.toFixed(2) + ') h=' + (dockStart.h * 180 / Math.PI).toFixed(0) + '°');

var dockSegs = segs03.slice(dockStart.idx);
console.log('dock 段数:', dockSegs.length);

/* 2) 为 lv09 求接近段：spawn → dockStart 位姿（简版 A*，直线+单转弯脉冲足够） */
function expand(n, ac) {
  if (n.isStart && ac.g === 'R') return null;
  if (ac.sf !== 0 && n.lastSf !== 0 && ac.g === n.gear) return null;
  var st = { x: n.x, z: n.z, h: n.h, v: n.v, steer: 0, gear: n.gear };
  if (ac.g !== n.gear && !n.isStart) {
    var guard = 80;
    while (Math.abs(st.v) > 1e-3 && guard-- > 0) PULSE.brakeStep(st, dt, CFG.PHYS);
    st.gear = ac.g;
  } else if (n.isStart) {
    st.gear = ac.g;
  }
  var steps = Math.round(ac.dur / dt);
  for (var k = 0; k < steps; k++) {
    PULSE.stepMotion(st, ac.sf, dt, CFG.PHYS, car);
    if ((k & 3) === 0 && collides(st.x, st.z, st.h)) return null;
  }
  if (collides(st.x, st.z, st.h)) return null;
  return { x: st.x, z: st.z, h: st.h, v: st.v, gear: ac.g, lastSf: ac.sf };
}
function key(x, z, h) { return Math.round(x * 5) + '|' + Math.round(z * 5) + '|' + Math.round(h * 36 / Math.PI); }

var actions = [];
[0.6, -0.6].forEach(function (sf) { [0.7, 1.0, 1.6, 2.4].forEach(function (du) { actions.push({ g: 'D', sf: sf, dur: du }); actions.push({ g: 'R', sf: sf, dur: du }); }); });
[1, -1].forEach(function (sf) { [1.1, 1.6, 2.4].forEach(function (du) { actions.push({ g: 'D', sf: sf, dur: du }); actions.push({ g: 'R', sf: sf, dur: du }); }); });
[0.5, 1.2].forEach(function (du) { actions.push({ g: 'D', sf: 0, dur: du }); actions.push({ g: 'R', sf: 0, dur: du }); });

var startPose = lv09.player;
var target = dockStart;
var start = { x: startPose.x, z: startPose.z, h: startPose.a * Math.PI / 180, v: 0, steer: 0, gear: 'D', isStart: true, g: 0, f: 0, par: null, act: null };
var open = new Heap(); open.push(start);
var bestG = new Map(); bestG.set(key(start.x, start.z, start.h), 0);
var goal = null, exp = 0;
while (open.size && exp < 150000) {
  var n = open.pop();
  var k0 = key(n.x, n.z, n.h);
  if ((bestG.get(k0) || Infinity) < n.g - 1e-6) continue;
  exp++;
  if (Math.hypot(n.x - target.x, n.z - target.z) < 0.3 && Math.abs((n.h - target.h + Math.PI * 3) % (Math.PI * 2) - Math.PI) < 0.09) { goal = n; break; }
  for (var ai = 0; ai < actions.length; ai++) {
    var ac = actions[ai];
    var ns = expand(n, ac);
    if (!ns) continue;
    var ng = n.g + 1;
    var kk = key(ns.x, ns.z, ns.h);
    if ((bestG.get(kk) || Infinity) <= ng) continue;
    bestG.set(kk, ng);
    ns.g = ng; ns.f = ng + Math.hypot(ns.x - target.x, ns.z - target.z); ns.par = n; ns.act = ac;
    open.push(ns);
  }
}
if (!goal) { console.log('接近段未找到'); process.exit(1); }
var seq = [], cur = goal;
while (cur) { seq.push(cur); cur = cur.par; }
seq.reverse();
var approach = [];
for (i = 1; i < seq.length; i++) approach.push({ g: seq[i].act.g, sf: seq[i].act.sf, dur: seq[i].act.dur });
console.log('接近段:', approach.length, '个控制段');

/* 3) 拼接 & 验证 */
var lv09segs = approach.concat(dockSegs);
var vr = AUTO.runLevel(lv09, { phasesOverride: lv09segs, maxTime: 400 });
console.log('验证: 成功=' + vr.success + ' 碰撞=' + vr.collisions, vr.result ? ('得分=' + vr.result.score + ' 星=' + vr.result.stars + ' 偏差=' + vr.result.posOffset.toFixed(2)) : ('(' + vr.reason + ')'));
if (vr.success) {
  var d0 = require(path.join(JS, 'demo_paths.js'));
  d0.lv09 = lv09segs;
  var file = '/* 自动生成：tools/solver.js 产物（控制段：g 档位 sf 转向 dur 秒），勿手改 */\n' +
    '(function (root, factory) {\n' +
    '  var api = factory();\n' +
    "  if (typeof module === 'object' && module.exports) { module.exports = api; }\n" +
    "  else { root.PS = root.PS || {}; root.PS.DEMO_PATHS = api; }\n" +
    "})(typeof self !== 'undefined' ? self : this, function () {\n" +
    '  return ' + JSON.stringify(d0) + ';\n' +
    '});\n';
  fs.writeFileSync(path.join(JS, 'demo_paths.js'), file, 'utf8');
  console.log('lv09 已写入 demo_paths.js');
} else {
  console.log('验证未通过，未写入');
  process.exit(1);
}
