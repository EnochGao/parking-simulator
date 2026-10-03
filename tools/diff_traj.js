/* 轨迹对比诊断：规划积分（pulse.js，与 solver/autopilot 同一积分源）
 * vs 玩家实车模型（physics.js CarPhysics 吃同样的控制段输入），逐步找发散点。
 * 注意：脉冲积分的段内车速恒为 PHYS.demoSpeed（m/s），实车模型受蠕行窗口/
 * 加速度渐入影响，同输入下纵向速度本就不同——本工具量化的是两套速度法则
 * 与同一转向几何的轨迹差，用于评估"按标准答案手动开"的手感落差。
 * 运行：node tools/diff_traj.js [levelId] [margin] [gearCost] */
'use strict';
var path = require('path');
var JS = path.join(__dirname, '..', 'js');
var CFG = require(path.join(JS, 'config.js'));
var PHYS = require(path.join(JS, 'physics.js'));
var PULSE = require(path.join(JS, 'pulse.js'));
var LVL = require(path.join(JS, 'levels.js'));
var SOLVE = require(path.join(__dirname, 'solver.js'));

var id = process.argv[2] || 'lv01';
var margin = parseFloat(process.argv[3] || '0.12');
var lv = LVL.byId(id);
var r = SOLVE.solve(lv, { margin: margin, gearCost: parseFloat(process.argv[4] || '2.5') });
if (!r.ok) { console.log('求解失败', r.reason); process.exit(1); }
var segs = r.segs;
console.log('段数', segs.length, JSON.stringify(segs.map(function (s) { return [s.g, s.sf, s.dur]; })));

var car = CFG.CAR, dt = 1 / 60;

/* 规划侧仿真：与 solver.expand 同一积分（PULSE）与段内回正斜坡。
 * 此前这里复刻的是 v1.1 前的"车中心沿航向推进"模型，与现行后轴参考积分
 * 必然发散，诊断结论失真——现直接调用 PULSE，杜绝第三份模型拷贝 */
var st = { x: lv.player.x, z: lv.player.z, h: lv.player.a * Math.PI / 180, v: 0, steer: 0, gear: 'D' };
var plan = [];
segs.forEach(function (ac, si) {
  if (si === 0) st.gear = ac.g;
  else if (st.gear !== ac.g) {
    var guard = 80;
    while (Math.abs(st.v) > 1e-3 && guard-- > 0) PULSE.brakeStep(st, dt, CFG.PHYS);
    st.gear = ac.g;
  }
  var steps = Math.round(ac.dur / dt);
  var downSteps = ac.sf !== 0 ? Math.max(1, Math.ceil(Math.abs(ac.sf) * car.maxSteer / CFG.PHYS.centerRate / dt)) : 0;
  for (var i = 0; i < steps; i++) {
    var isDown = i >= steps - downSteps && ac.sf !== 0;
    PULSE.stepMotion(st, isDown ? 0 : ac.sf, dt, CFG.PHYS, car);
    plan.push([st.x, st.z, st.h, st.v, st.steer]);
  }
});

/* 执行侧：玩家实车模型 CarPhysics 按同样控制段给输入（drive 按档位给满；
 * CarPhysics 对反向输入自带"先刹后驱"，档位切换处与真车松刹换挡手感一致） */
var carP = new PHYS.CarPhysics({ car: car, phys: CFG.PHYS }, { x: lv.player.x, z: lv.player.z, heading: lv.player.a * Math.PI / 180 });
var exec = [];
segs.forEach(function (ac) {
  var steps = Math.round(ac.dur / dt);
  var downSteps = ac.sf !== 0 ? Math.max(1, Math.ceil(Math.abs(ac.sf) * car.maxSteer / CFG.PHYS.centerRate / dt)) : 0;
  for (var i = 0; i < steps; i++) {
    var isDown = i >= steps - downSteps && ac.sf !== 0;
    carP.update(dt, { drive: ac.g === 'R' ? -1 : 1, steer: isDown ? 0 : ac.sf });
    exec.push([carP.x, carP.z, carP.heading, carP.speed, carP.steer]);
  }
});

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
