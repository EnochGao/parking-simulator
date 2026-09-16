/* 轨迹对比诊断：规划器仿真 vs 执行器重放，逐步找发散点 */
'use strict';
var path = require('path');
var JS = path.join(__dirname, '..', 'js');
var CFG = require(path.join(JS, 'config.js'));
var PHYS = require(path.join(JS, 'physics.js'));
var LVL = require(path.join(JS, 'levels.js'));
var SOLVE = require(path.join(__dirname, 'solver.js'));

var id = process.argv[2] || 'lv01';
var margin = parseFloat(process.argv[3] || '0.12');
var lv = LVL.byId(id);
var r = SOLVE.solve(lv, { margin: margin, gearCost: parseFloat(process.argv[4] || '2.5') });
if (!r.ok) { console.log('求解失败', r.reason); process.exit(1); }
var segs = r.segs;
console.log('段数', segs.length, JSON.stringify(segs.map(function (s) { return [s.g, s.sf, s.dur]; })));

var car = CFG.CAR, dt = 1 / 60, rate = CFG.PHYS.steerRate, acc = CFG.PHYS.accel * 0.35, vr = CFG.PHYS.creep;
var x = lv.player.x, z = lv.player.z, h = lv.player.a * Math.PI / 180, v = 0, gear = 'D';
var plan = [];
segs.forEach(function (ac, si) {
  var shifted = ac.g !== gear && si > 0; // 与 expand 一致：出生直接按第一段档位
  if (si === 0) gear = ac.g;
  if (shifted) {
    var vB = vr, dB = gear === 'R' ? -1 : 1;
    for (var bi = 0; bi < 40; bi++) {
      x += dB * vB * Math.sin(h) * dt; z += dB * vB * Math.cos(h) * dt;
      vB -= CFG.PHYS.brake * 0.8 * dt;
      if (vB <= 0) break;
    }
  }
  var steps = Math.round(ac.dur / dt);
  var target = ac.sf * car.maxSteer;
  var up = target !== 0 ? Math.max(1, Math.ceil(Math.abs(target) / rate / dt)) : 0;
  var down = target !== 0 ? Math.max(1, Math.ceil(Math.abs(target) / CFG.PHYS.centerRate / dt)) : 0;
  var isStart = si === 0;
  var vv = (shifted || isStart) ? 0 : vr;
  var sgn = Math.sign(target);
  for (var i = 0; i < steps; i++) {
    var steer;
    if (i < up) steer = sgn * Math.min(Math.abs(target), (i + 1) * rate * dt);
    else if (i >= steps - down) steer = sgn * Math.max(0, Math.abs(target) - (i - (steps - down) + 1) * CFG.PHYS.centerRate * dt);
    else steer = target;
    if (shifted || isStart) vv = Math.min(vr, vv + acc * dt);
    var dir = ac.g === 'R' ? -vv : vv;
    h += dir / car.wheelbase * Math.tan(steer) * dt;
    x += dir * Math.sin(h) * dt; z += dir * Math.cos(h) * dt;
    plan.push([x, z, h, vv, steer]);
  }
  gear = ac.g;
});

/* 执行器复刻（与 autopilot.js 逻辑一致） */
var carP = new PHYS.CarPhysics({ car: car, phys: CFG.PHYS }, { x: lv.player.x, z: lv.player.z, heading: lv.player.a * Math.PI / 180 });
carP.gear = segs[0].g;
var segIdx = 0, stepLeft = Math.round(segs[0].dur / dt), exec = [];
for (var it = 0; it < 50000 && segIdx < segs.length; it++) {
  var seg = segs[segIdx];
  if (carP.gear !== seg.g) {
    if (Math.abs(carP.speed) > 0.05) carP.update(dt, { brake: 1, steer: 0 });
    else { carP.setGear(seg.g); carP.update(dt, { brake: 1, steer: 0 }); }
  } else {
    var downSteps = Math.ceil(Math.abs(seg.sf) * car.maxSteer / CFG.PHYS.centerRate / dt);
    var rd = stepLeft <= downSteps && seg.sf !== 0;
    carP.update(dt, { throttle: 0, brake: 0, steer: rd ? 0 : seg.sf });
    stepLeft--;
    if (stepLeft <= 0) { segIdx++; if (segIdx < segs.length) stepLeft = Math.round(segs[segIdx].dur / dt); }
  }
  exec.push([carP.x, carP.z, carP.heading, carP.speed, carP.steer]);
}

console.log('plan 步数', plan.length, 'exec 步数', exec.length);
console.log('plan 终点 (', plan[plan.length - 1].slice(0, 2).map(function (q) { return q.toFixed(2); }), ')');
console.log('exec 终点 (', exec[exec.length - 1].slice(0, 2).map(function (q) { return q.toFixed(2); }), ')');
var first = -1;
for (var i2 = 0; i2 < Math.min(plan.length, exec.length); i2++) {
  if (Math.hypot(plan[i2][0] - exec[i2][0], plan[i2][1] - exec[i2][1]) > 0.03) { first = i2; break; }
}
console.log('首个>3cm 发散步:', first);
if (first >= 0) {
  for (var k = Math.max(0, first - 2); k <= Math.min(first + 2, plan.length - 1, exec.length - 1); k++) {
    console.log(k, 'plan(', plan[k].map(function (q) { return q.toFixed(4); }), ') exec(', exec[k].map(function (q) { return q.toFixed(4); }), ')');
  }
}
