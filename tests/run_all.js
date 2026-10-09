/* 停车模拟器测试套件：单元测试 + 关卡数据校验 + 自动驾驶回归
 * 运行：node tests/run_all.js   （零依赖，Node >= 14） */
'use strict';
var path = require('path');
var JS = path.join(__dirname, '..', 'js');
var CFG = require(path.join(JS, 'config.js'));
var PHYS = require(path.join(JS, 'physics.js'));
var COL = require(path.join(JS, 'collision.js'));
var SCO = require(path.join(JS, 'scoring.js'));
var LVL = require(path.join(JS, 'levels.js'));
var AUTO = require(path.join(JS, 'autopilot.js'));
var SIM = require(path.join(JS, 'sim.js'));
var PROG = require(path.join(JS, 'progress.js'));
var INPUT = require(path.join(JS, 'input.js'));

var passed = 0, failed = 0, failures = [];
function check(name, cond, extra) {
  if (cond) { passed++; }
  else { failed++; failures.push(name + (extra ? ('  [' + extra + ']') : '')); }
}
function section(name) { console.log('\n== ' + name + ' =='); }

function approx(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-6); }

/* ---------------- 1. 物理单元测试 ---------------- */
section('物理模型');
(function () {
  var P = CFG.PHYS;
  // 直行积分
  var c = new PHYS.CarPhysics({ car: CFG.CAR, phys: CFG.PHYS }, { x: 0, z: 0, heading: 0 });
  for (var i = 0; i < 120; i++) c.update(1 / 60, { drive: 1, steer: 0 });
  check('直行：沿 +z 前进', c.z > 3 && c.z < 8, 'z=' + c.z.toFixed(2));
  check('直行：x 无偏移', Math.abs(c.x) < 1e-9);
  check('直行：航向不变', approx(c.heading, 0));

  // 左转：heading 增加，x 增加（面向 +z 时左侧为 +x）
  c = new PHYS.CarPhysics({ car: CFG.CAR, phys: CFG.PHYS }, { x: 0, z: 0, heading: 0 });
  for (i = 0; i < 180; i++) c.update(1 / 60, { drive: 1, steer: 1 });
  check('左转：航向增加', c.heading > 0.5, 'h=' + c.heading.toFixed(2));
  check('左转：向 +x 偏移', c.x > 0.5, 'x=' + c.x.toFixed(2));

  // 静止打轮不动车（W/S 都不按＝刹车，位置不变）
  c = new PHYS.CarPhysics({ car: CFG.CAR, phys: CFG.PHYS }, { x: 0, z: 0, heading: 0 });
  for (i = 0; i < 60; i++) c.update(1 / 60, { steer: 1 });
  check('静止打轮：位置不变', approx(c.x, 0) && approx(c.z, 0));
  check('静止打轮：前轮已转到位', approx(c.steer, CFG.CAR.maxSteer, 1e-4));
  check('无输入：静止时不自行蠕动', c.speed === 0, 'v=' + c.speed.toFixed(3));

  // 松开方向保持角度（holdSteer：不自动回正；反打方向回正）
  c = new PHYS.CarPhysics({ car: CFG.CAR, phys: CFG.PHYS }, { x: 0, z: 0, heading: 0 });
  for (i = 0; i < 30; i++) c.update(1 / 60, { steer: 1 });
  var ang0 = c.steer;
  check('松开保持：打轮中角度渐增', ang0 > 0.2 && ang0 < CFG.CAR.maxSteer, 'a=' + ang0.toFixed(3));
  for (i = 0; i < 120; i++) c.update(1 / 60, { steer: 0, holdSteer: true });
  check('松开保持：转角不自动回正', approx(c.steer, ang0, 1e-9));
  for (i = 0; i < 150; i++) c.update(1 / 60, { steer: -1 });
  check('松开保持：反打方向可回正并反向', c.steer < 0, 'a=' + c.steer.toFixed(3));

  // 倒车蠕行：轻点 S 保持在蠕行速度，持续按住才加速到极速，松开后再点重新从蠕行开始
  c = new PHYS.CarPhysics({ car: CFG.CAR, phys: CFG.PHYS }, { x: 0, z: 0, heading: 0 });
  for (i = 0; i < 30; i++) c.update(1 / 60, { drive: -1 }); // 0.5s < creepRampTime
  check('倒车蠕行：轻点 S 保持蠕行速度', Math.abs(Math.abs(c.speed) - CFG.PHYS.creep / 3.6) < 0.02, 'v=' + c.speed.toFixed(3));
  for (i = 0; i < 120; i++) c.update(1 / 60, { drive: -1 }); // 累计 2.5s > creepRampTime
  check('倒车蠕行：持续按住后加速到极速', Math.abs(Math.abs(c.speed) - CFG.PHYS.maxRev) < 0.02, 'v=' + c.speed.toFixed(3));
  for (i = 0; i < 40; i++) c.update(1 / 60, {});
  check('倒车蠕行：松开 S 刹停', c.speed === 0);
  for (i = 0; i < 30; i++) c.update(1 / 60, { drive: -1 }); // 再次轻点 0.5s（软接合下蠕行到位）
  check('倒车蠕行：再次轻点重新从蠕行开始', Math.abs(Math.abs(c.speed) - CFG.PHYS.creep / 3.6) < 0.02, 'v=' + c.speed.toFixed(3));
  // 软接合：起步加速度受 creepAccel 限制（不再瞬间贴上蠕行速度），且拉起段加速度渐入无阶跃
  c = new PHYS.CarPhysics({ car: CFG.CAR, phys: CFG.PHYS }, { x: 0, z: 0, heading: 0 });
  var prevV = 0, maxAcc = 0;
  for (i = 0; i < 15; i++) {                       // 接合段 0.25s：加速度恒为 creepAccel
    var v0 = c.speed;
    c.update(1 / 60, { drive: -1 });
    maxAcc = Math.max(maxAcc, Math.abs(c.speed - v0) * 60);
  }
  check('倒车软接合：起步加速度 ≈ creepAccel', approx(maxAcc, CFG.PHYS.creepAccel, 0.01), 'a=' + maxAcc.toFixed(3));
  for (i = 0; i < 21; i++) c.update(1 / 60, { drive: -1 }); // 推进到蠕行窗口结束（累计 0.6s）
  var accRamp = 0;
  for (i = 0; i < 6; i++) {                        // 窗口结束后首 0.1s：加速度应明显低于满值（渐入中）
    var v1 = c.speed;
    c.update(1 / 60, { drive: -1 });
    accRamp = Math.max(accRamp, Math.abs(c.speed - v1) * 60);
  }
  check('倒车拉起：加速度渐入低于满值', accRamp < CFG.PHYS.accelRev * 0.75, 'a=' + accRamp.toFixed(3));

  // 蠕行钳制只限加速不回拍：后溜中松开再按 S，速度不被瞬间压回蠕行值，而是从当前速度继续加速
  c = new PHYS.CarPhysics({ car: CFG.CAR, phys: CFG.PHYS }, { x: 0, z: 0, heading: 0 });
  for (i = 0; i < 180; i++) c.update(1 / 60, { drive: -1 }); // 倒车至极速
  for (i = 0; i < 4; i++) c.update(1 / 60, {});              // 松开 4 帧：蠕行计时清零、车仍在后溜
  var vRoll = c.speed;
  check('蠕行不回拍：场景成立（后溜快于蠕行）', vRoll < -CFG.PHYS.creep / 3.6, 'v=' + vRoll.toFixed(3));
  c.update(1 / 60, { drive: -1 });                           // 再按住 S 第 1 帧
  check('蠕行不回拍：续按第 1 帧不顿挫回拍', c.speed <= vRoll, 'v=' + c.speed.toFixed(3) + ' roll=' + vRoll.toFixed(3));
  for (i = 0; i < 30; i++) c.update(1 / 60, { drive: -1 });
  check('蠕行不回拍：续按从当前速度平滑加速到极速', Math.abs(Math.abs(c.speed) - CFG.PHYS.maxRev) < 0.02, 'v=' + c.speed.toFixed(3));

  // 倒车（S = drive -1，档位自动切 R）
  c = new PHYS.CarPhysics({ car: CFG.CAR, phys: CFG.PHYS }, { x: 0, z: 0, heading: 0 });
  for (i = 0; i < 120; i++) c.update(1 / 60, { drive: -1, steer: 0.5 });
  check('倒车：速度为负', c.speed < -0.3, 'v=' + c.speed.toFixed(2));
  check('倒车：自动进入 R 挡', c.gear === 'R');
  check('倒车：沿 -z 后退', c.z < -0.5, 'z=' + c.z.toFixed(2));
  check('倒车打左轮航向减小', c.heading < 0, 'h=' + c.heading.toFixed(3));

  // 前进中按 S：先按制动减速，减速完毕再反向倒车
  c = new PHYS.CarPhysics({ car: CFG.CAR, phys: CFG.PHYS }, { x: 0, z: 0, heading: 0 });
  for (i = 0; i < 120; i++) c.update(1 / 60, { drive: 1 });
  var vFwd = c.speed;
  for (i = 0; i < 30; i++) c.update(1 / 60, { drive: -1 });
  check('前进中按 S：先减速不直接反向驱动', c.speed < vFwd && c.speed >= 0, 'v=' + c.speed.toFixed(2));
  for (i = 0; i < 120; i++) c.update(1 / 60, { drive: -1 });
  check('减速完毕后进入倒车', c.speed < -0.3, 'v=' + c.speed.toFixed(2));

  // setGear API（保留：停稳才可换挡）
  c = new PHYS.CarPhysics({ car: CFG.CAR, phys: CFG.PHYS }, { x: 0, z: 0, heading: 0 });
  for (i = 0; i < 120; i++) c.update(1 / 60, { drive: 1 });
  check('移动中禁止切挡', c.setGear('R') === false);
  for (i = 0; i < 240; i++) { c.update(1 / 60, {}); if (c.speed === 0) break; }
  check('停稳后可切倒挡', c.setGear('R') === true);

  // 极速限制
  c = new PHYS.CarPhysics({ car: CFG.CAR, phys: CFG.PHYS }, { x: 0, z: 0, heading: 0 });
  for (i = 0; i < 60 * 20; i++) c.update(1 / 60, { drive: 1 });
  check('前进极速限制', c.speed <= P.maxFwd + 1e-9, 'v=' + c.speed.toFixed(3));
  c = new PHYS.CarPhysics({ car: CFG.CAR, phys: CFG.PHYS }, { x: 0, z: 0, heading: 0 });
  for (i = 0; i < 60 * 20; i++) c.update(1 / 60, { drive: -1 });
  check('倒车极速限制', Math.abs(c.speed) <= P.maxRev + 1e-9, 'v=' + c.speed.toFixed(3));

  // 松开即刹车 / 手刹
  c = new PHYS.CarPhysics({ car: CFG.CAR, phys: CFG.PHYS }, { x: 0, z: 0, heading: 0 });
  for (i = 0; i < 120; i++) c.update(1 / 60, { drive: 1 });
  var stopped = false;
  for (i = 0; i < 240; i++) { c.update(1 / 60, {}); if (c.speed === 0) { stopped = true; break; } }
  check('松开输入即可刹停', stopped);
  var zStop = c.z;
  for (i = 0; i < 120; i++) c.update(1 / 60, {});
  check('停稳后保持静止', c.speed === 0 && approx(c.z, zStop));
  c = new PHYS.CarPhysics({ car: CFG.CAR, phys: CFG.PHYS }, { x: 0, z: 0, heading: 0 });
  for (i = 0; i < 120; i++) c.update(1 / 60, { drive: 1 });
  for (i = 0; i < 60; i++) c.update(1 / 60, { handbrake: true });
  check('手刹可停稳', c.speed === 0 || c.isStopped());

  // 反弹
  c = new PHYS.CarPhysics({ car: CFG.CAR, phys: CFG.PHYS }, { x: 0, z: 0, heading: 0 });
  for (i = 0; i < 60; i++) c.update(1 / 60, { drive: 1 });
  var v0 = c.speed;
  c.bounce();
  check('碰撞反弹反向衰减', c.speed < 0 && Math.abs(c.speed) < v0);
})();

/* ---------------- 2. 碰撞单元测试 ---------------- */
section('碰撞检测');
(function () {
  var A = COL.makeObb(0, 0, 0, 1, 2);
  var B = COL.makeObb(0.5, 0, 0, 1, 2);
  check('重叠 OBB 相交', COL.obbOverlap(A, B));
  B = COL.makeObb(3, 0, 0, 1, 2);
  check('分离 OBB 不相交', !COL.obbOverlap(A, B));
  B = COL.makeObb(0, 5, 0, 1, 2);
  check('z 向分离不相交', !COL.obbOverlap(A, B));
  B = COL.makeObb(1.9, 1.9, Math.PI / 4, 1, 1);
  check('斜角相交判定', COL.obbOverlap(A, B));
  B = COL.makeObb(2.5, 2.5, Math.PI / 4, 1, 1);
  check('斜角分离判定', !COL.obbOverlap(A, B));
  // 车与正前方 5m 墙
  var carO = COL.carObb(0, 0, 0, CFG.CAR);
  var wall = COL.makeObb(0, 5, 0, 2, 0.2);
  check('车头距墙 5m 不碰', !COL.obbOverlap(carO, wall));
  wall = COL.makeObb(0, 1.8, 0, 2, 0.2);
  check('车头抵墙相交', COL.obbOverlap(carO, wall));
  // 四角
  var cs = COL.corners(carO);
  check('四角数量为 4', cs.length === 4);
  check('四角关于车中心对称', approx(cs[0][0], -cs[2][0]) && approx(cs[0][1], -cs[2][1]));
  // 凸多边形内点
  var poly = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  check('内点判定-内', COL.pointInConvex(0, 0, poly));
  check('内点判定-外', !COL.pointInConvex(2, 0, poly));
  // 车辆完整入库判定
  var spotPoly = SCO.spotPoly({ x: 0, z: 0, angle: 0, w: 2.5, l: 5.3 });
  check('标准车位完美入库', COL.carInsidePoly(0, 0, 0, CFG.CAR, spotPoly));
  check('偏出车位判定', !COL.carInsidePoly(0.5, 0, 0, CFG.CAR, spotPoly));
  check('横在车位外判定', !COL.carInsidePoly(4, 0, 0, CFG.CAR, spotPoly));
})();

/* ---------------- 3. 评分单元测试 ---------------- */
section('评分系统');
(function () {
  var SC = CFG.SCORE;
  check('角度偏差-同向', approx(SCO.angleDevDeg(90 * Math.PI / 180, 90 * Math.PI / 180), 0, 1e-4));
  check('角度偏差-反向(倒泊入)', approx(SCO.angleDevDeg(-90 * Math.PI / 180, 90 * Math.PI / 180), 0, 1e-4));
  check('角度偏差-90度', approx(SCO.angleDevDeg(0, 90 * Math.PI / 180), 90, 1e-4));
  check('角度偏差-斜12度', approx(SCO.angleDevDeg(192 * Math.PI / 180, 12 * Math.PI / 180), 0, 1e-4));

  var spot = { x: 0, z: 0, angle: 0, w: 2.5, l: 5.3 };
  var ev = SCO.evaluate({ x: 0, z: 0, heading: 0, spot: spot, collisions: 0, time: 10, par: 60, carCfg: CFG.CAR, cfg: SC });
  check('完美停车-完成', ev.completed);
  check('完美停车-三星', ev.stars === 3);
  check('完美停车-满分含时间奖励', ev.score >= 100, 'score=' + ev.score);

  // 场景需真实可完成：0.1m/0.2m 偏差 + 6° 时四角仍在车位内（0.4m 横偏时车角已探出）
  ev = SCO.evaluate({ x: 0.1, z: 0.2, heading: 6 * Math.PI / 180, spot: spot, collisions: 2, time: 70, par: 60, carCfg: CFG.CAR, cfg: SC });
  check('偏差+碰撞-仍完成', ev.completed);
  check('偏差+碰撞-两星', ev.stars === 2, 'stars=' + ev.stars);
  check('碰撞扣分生效', ev.colPenalty === 15, 'pen=' + ev.colPenalty);
  check('超时无时间奖励', ev.timeBonus === 0);

  ev = SCO.evaluate({ x: 2.2, z: 1.5, heading: 40 * Math.PI / 180, spot: spot, collisions: 0, time: 10, par: 60, carCfg: CFG.CAR, cfg: SC });
  check('歪 40 度未入库-未完成', !ev.completed);

  ev = SCO.evaluate({ x: 0, z: 0, heading: 0, spot: spot, collisions: 5, time: 10, par: 60, carCfg: CFG.CAR, cfg: SC });
  check('碰撞 5 次-零星失败', ev.stars === 0);

  ev = SCO.evaluate({ x: 0.1, z: 0.1, heading: 0, spot: spot, collisions: 0, time: 59, par: 60, carCfg: CFG.CAR, cfg: SC });
  check('分数上限 110', ev.score <= 110, 'score=' + ev.score);
  check('小幅偏差仍三星', ev.stars === 3, 'score=' + ev.score + ' stars=' + ev.stars);
})();

/* ---------------- 4. 关卡数据完整性校验 ---------------- */
section('关卡数据校验');
LVL.LEVELS.forEach(function (lv) {
  var tag = lv.id;
  check(tag + ': 基础字段', !!(lv.name && lv.desc && lv.tips && lv.tips.length && lv.par > 0));
  check(tag + ': 车位宽度足够停车', lv.spot.w >= CFG.CAR.width + 0.15, 'w=' + lv.spot.w);
  check(tag + ': 车位长度足够停车', lv.spot.l >= CFG.CAR.length + 0.6, 'l=' + lv.spot.l);
  check(tag + ': 演示路径存在(控制段)', (function () {
    var ph = LVL.getPhases(lv);
    return Array.isArray(ph) && ph.length >= 1;
  })());
  (LVL.getPhases(lv) || []).forEach(function (ph, i) {
    check(tag + ': 控制段 ' + i + ' 合法', ph.dur > 0 && Math.abs(ph.sf) <= 1 && (ph.g === 'D' || ph.g === 'R'));
  });
  // 出生点不与障碍物重叠
  var obs = LVL.getObstacleObbs(lv).map(function (o) { return COL.makeObb(o.x, o.z, o.angle, o.hw, o.hl); });
  var spawn = COL.carObb(lv.player.x, lv.player.z, lv.player.a * Math.PI / 180, CFG.CAR);
  check(tag + ': 出生点无碰撞', COL.firstHit(spawn, obs) < 0);
  // 车位范围不与任何障碍物重叠（保证可停）
  var spotObb = COL.makeObb(lv.spot.x, lv.spot.z, lv.spot.a * Math.PI / 180, lv.spot.w / 2, lv.spot.l / 2);
  check(tag + ': 车位内无障碍物', COL.firstHit(spotObb, obs) < 0);
  // 出生点在边界内
  var b = lv.bounds;
  check(tag + ': 出生点在场地内', lv.player.x > b.minX && lv.player.x < b.maxX && lv.player.z > b.minZ && lv.player.z < b.maxZ);
  // 完美停放姿态可被判定为完成（车位几何自洽）
  var spotJ = { x: lv.spot.x, z: lv.spot.z, angle: lv.spot.a * Math.PI / 180, w: lv.spot.w, l: lv.spot.l };
  var ev = SCO.evaluate({ x: lv.spot.x, z: lv.spot.z, heading: spotJ.angle, spot: spotJ, collisions: 0, time: 1, par: lv.par, carCfg: CFG.CAR, cfg: CFG.SCORE });
  check(tag + ': 完美姿态可完成', ev.completed);
});

/* 关卡数据门禁：共面 z-fight / 车辆穿模扫描（tests/scan_zfight.js）。
 * 两障碍同法线表面共面会在深度缓冲上争夺 → 行驶中"虚影闪烁"（lv01 大楼虚影即此），
 * 此检查防止改关卡数据时再次引入 */
(function () {
  var f = require(path.join(__dirname, 'scan_zfight.js')).scan();
  check('关卡数据: 无共面zfight/车辆穿模', f.length === 0, f.join(' | '));
})();

/* ---------------- 5. 自动驾驶回归（全关卡可通关性） ---------------- */
section('自动驾驶回归');
LVL.LEVELS.forEach(function (lv) {
  var r = AUTO.runLevel(lv, {});
  var ok = r.success && r.collisions <= 2 && r.result && r.result.stars >= 1;
  var info = 'ok=' + r.success + ' 碰撞=' + r.collisions + ' 用时=' + r.time.toFixed(1) + 's';
  if (r.result) info += ' 偏差=' + r.result.posOffset.toFixed(2) + 'm/' + r.result.devDeg.toFixed(1) + '° 得分=' + r.result.score + ' 星=' + r.result.stars;
  else if (r.final && r.final.x !== undefined) info += ' final=(' + r.final.x.toFixed(2) + ',' + r.final.z.toFixed(2) + ',' + (r.final.heading * 180 / Math.PI).toFixed(0) + '°) ' + r.reason;
  else info += ' ' + (r.reason || '失败');
  check(lv.id + ' ' + lv.name, ok, info);
});

/* ---------------- 6. 一局模拟（sim）单元测试 ---------------- */
section('一局模拟');
(function () {
  // 完成判定：完美姿态 + 停稳 → stopTime 后 completed，终局评分为全量字段
  var lv = LVL.byId('lv01');
  var carP = new PHYS.CarPhysics({ car: CFG.CAR, phys: CFG.PHYS },
    { x: lv.spot.x, z: lv.spot.z, heading: lv.spot.a * Math.PI / 180 });
  var run = SIM.createRun(lv, { car: carP });
  var res = null, steps = 0;
  for (var i = 0; i < 200; i++) { steps++; res = run.step(1 / 60, {}); if (res.completed) break; }
  check('sim: 完美姿态停稳后判完成', !!res && res.completed, 'steps=' + steps);
  check('sim: 完成步数 ≈ stopTime/dt', steps >= CFG.SCORE.stopTime * 60 && steps <= CFG.SCORE.stopTime * 60 + 1, 'steps=' + steps);
  check('sim: 终局评分含全量字段', res.ev.score != null && res.ev.devDeg != null && res.ev.stars >= 1,
    'score=' + (res.ev && res.ev.score));
  check('sim: 时间按固定步长累计', approx(run.time, steps / 60));

  // 碰撞计次 1s 冷却：连续顶蹭在冷却窗内只记 1 次（与游戏内主循环同一语义）
  var lv2 = LVL.byId('lv02');
  var mkCarAt = function (x, z, hDeg) {
    return new PHYS.CarPhysics({ car: CFG.CAR, phys: CFG.PHYS }, { x: x, z: z, heading: hDeg * Math.PI / 180 });
  };
  var car2 = mkCarAt(5.9, 3, 90);          // 车头抵 lv02 东侧墙（x∈[7.0,7.4]）
  var run2 = SIM.createRun(lv2, { car: car2 });
  var first = run2.step(1 / 60, { drive: 1 });
  check('sim: 首次接触即计次', first.hit && first.counted, 'collisions=' + run2.collisions);
  for (i = 0; i < 59; i++) run2.step(1 / 60, { drive: 1 });   // 1s 内持续顶蹭
  check('sim: 冷却窗内连续顶蹭不重复计次', run2.collisions === 1, 'collisions=' + run2.collisions);

  // 失败判定：碰撞达上限 → failed，终局 stars=0
  var car3 = mkCarAt(5.9, 3, 90);
  var run3 = SIM.createRun(lv2, { car: car3 });
  run3.collisions = CFG.SCORE.maxCollisions - 1;
  var r3 = run3.step(1 / 60, { drive: 1 });
  check('sim: 碰撞超限判失败', r3.failed);
  check('sim: 失败终局 stars=0', r3.ev.stars === 0);

  // 独立计次：两个 run 互不影响（状态都在 run 实例上）
  check('sim: run 实例间状态隔离', run.collisions === 0 && run2.collisions === 1);
})();

/* ---------------- 7. 进度存档（progress）单元测试 ---------------- */
section('进度存档');
(function () {
  function memStorage() {
    var mem = {};
    return { getItem: function (k) { return k in mem ? mem[k] : null; }, setItem: function (k, v) { mem[k] = v; } };
  }
  var st = memStorage();
  var lvs = LVL.LEVELS;
  check('进度: 空档归一形状', PROG.load(st).levels && typeof PROG.load(st).levels === 'object');
  check('进度: 空档无星', PROG.anyStars(st) === false);
  check('进度: 空档续玩目标为首关', PROG.continueTarget(lvs, st) === lvs[0]);

  // 解锁链：第 1 关可玩，其余锁定；拿星后逐关解锁
  var map = PROG.unlockMap(lvs, { storage: st });
  check('进度: 首关默认解锁', map[0].unlocked === true);
  check('进度: 第二关默认锁定', map[1].unlocked === false);
  PROG.record(lvs[0].id, { stars: 2, score: 80 }, st);
  map = PROG.unlockMap(lvs, { storage: st });
  check('进度: 前关拿星解锁下一关', map[1].unlocked === true && map[2].unlocked === false);
  check('进度: 落档保留最高星与最好成绩', (function () {
    PROG.record(lvs[0].id, { stars: 1, score: 95 }, st);   // 星低分高 → stars 保持 2，best 更新 95
    var rec = PROG.load(st).levels[lvs[0].id];
    return rec.stars === 2 && rec.best === 95;
  })(), 'rec=' + JSON.stringify(PROG.load(st).levels[lvs[0].id]));
  check('进度: 拿星后 anyStars 为真', PROG.anyStars(st) === true);
  check('进度: 续玩目标为首个未拿星关', PROG.continueTarget(lvs, st) === lvs[1]);
  check('进度: 全通关后续玩目标为末关', (function () {
    lvs.forEach(function (lv) { PROG.record(lv.id, { stars: 3, score: 100 }, st); });
    return PROG.continueTarget(lvs, st) === lvs[lvs.length - 1];
  })());
  check('进度: unlockAll 全开', PROG.unlockMap(lvs, { storage: st, unlockAll: true }).every(function (m) { return m.unlocked; }));
  check('进度: 线性下一关', PROG.next(lvs, lvs[0]) === lvs[1] && PROG.next(lvs, lvs[lvs.length - 1]) === null);
  // 坏档容错：非法 JSON 归一为空进度
  var bad = memStorage(); bad.setItem('parkmaster_v1', '{oops');
  check('进度: 坏档容错归空', PROG.load(bad).levels && typeof PROG.load(bad).levels === 'object');
})();

/* ---------------- 8. 输入源（input）单元测试 ---------------- */
section('输入源');
(function () {
  var keys = { w: false, a: false, s: false, d: false, space: false };
  var driver = INPUT.createDriver(keys, null);
  var i0 = driver.sample();
  check('输入: 双空时保持转角待刹', i0.steer === 0 && i0.drive === 0 && i0.holdSteer === true && i0.handbrake === false);
  keys.w = true; keys.a = true;
  i0 = driver.sample();
  check('输入: 键盘 W/A 映射前进/左转', i0.drive === 1 && i0.steer === 1);
  keys.space = true;
  i0 = driver.sample();
  check('输入: 空格并入到手刹', i0.handbrake === true);
  var b = driver.blocked();
  check('输入: 驾驶封锁给中性制动', b.steer === 0 && b.drive === 0 && b.handbrake === false && b.holdSteer === true);

  // 录像/回放：帧序一致，超带后中性制动
  keys.w = false; keys.a = false; keys.space = false;
  keys.d = true;
  var rec = INPUT.createRecorder(driver);
  rec.sample(); rec.sample(); rec.blocked();
  check('输入: 录像逐帧记录', rec.tape.length === 3 && rec.tape[0].s === -1 && rec.tape[2].d === 0,
    'tape=' + JSON.stringify(rec.tape));
  var play = INPUT.createTapeSource(rec.tape);
  var p0 = play.sample(), p1 = play.sample(), p2 = play.sample();
  check('输入: 回放按帧序喂出', p0.steer === -1 && p1.steer === -1 && p2.steer === 0 && p2.holdSteer === true);
  check('输入: 超带后中性制动', play.isDone() && play.sample().drive === 0);
})();

/* ---------------- 9. 手柄映射单元测试 ---------------- */
section('手柄映射');
(function () {
  var GP = require(path.join(JS, 'gamepad.js'));
  // 标准布局关键键位（盖世小鸡 XInput 模式等标准映射手柄通用）
  check('手柄: 标准布局键位索引', GP.BTN.A === 0 && GP.BTN.B === 1 && GP.BTN.X === 2 && GP.BTN.Y === 3 &&
    GP.BTN.LB === 4 && GP.BTN.RB === 5 && GP.BTN.LT === 6 && GP.BTN.RT === 7 &&
    GP.BTN.BACK === 8 && GP.BTN.START === 9 && GP.BTN.UP === 12 && GP.BTN.LEFT === 14);
  // 摇杆曲线：死区归零、渐进响应、满偏 1
  check('手柄: 死区内归零', GP.steerCurve(0.05, 0.08) === 0 && GP.steerCurve(-0.08, 0.08) === 0);
  check('手柄: 满偏幅值 1 且保号', GP.steerCurve(1, 0.08) === 1 && GP.steerCurve(-1, 0.08) === -1);
  check('手柄: 渐进曲线中点减益', approx(GP.steerCurve(0.54, 0.08), 0.25, 1e-9), 'v=' + GP.steerCurve(0.54, 0.08).toFixed(3));
  check('手柄: 曲线单调不减', GP.steerCurve(0.2, 0.08) < GP.steerCurve(0.5, 0.08) && GP.steerCurve(0.5, 0.08) < GP.steerCurve(0.9, 0.08));
  // 输入合并：键盘优先（数字量），手柄模拟量补位，双空保持转角
  var m = GP.mergeDrive(1, 0, { steer: -0.5, drive: 1, handbrake: true });
  check('手柄: 键盘转向优先于摇杆', m.steer === 1);
  check('手柄: 键盘松开油门时手柄扳机可接管', m.drive === 1);
  check('手柄: 键盘与手柄都松开时为刹车', GP.mergeDrive(1, 0, { steer: -0.5, drive: null }).drive === 0);
  check('手柄: 手柄手刹可叠加', m.handbrake === true);
  check('手柄: 摇杆偏转时不保持转角', m.holdSteer === false);
  m = GP.mergeDrive(0, 0, { steer: -0.5, drive: 1 });
  check('手柄: 无键盘输入时用摇杆/扳机', m.steer === -0.5 && m.drive === 1);
  m = GP.mergeDrive(0, 0, { steer: null, drive: null });
  check('手柄: 双空输入保持转角待刹', m.steer === 0 && m.drive === 0 && m.holdSteer === true);
  m = GP.mergeDrive(-0.4, -1, null);
  check('手柄: 无手柄时纯键盘输入可用', m.steer === -0.4 && m.drive === -1);
})();

/* ---------------- 10. 手柄模块集成验证 ---------------- */
section('手柄集成');
(function () {
  // 子进程运行 tools/gpad_itest.js（内部 mock navigator/document，避免污染本进程）
  var r = require('child_process').spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'gpad_itest.js')], { encoding: 'utf8' });
  check('手柄集成：连接/菜单/驾驶/边缘开关/断连', r.status === 0,
    (r.stdout || '').split('\n').filter(function (l) { return l.indexOf('✗') >= 0; }).join(' | '));
})();

/* ---------------- 11. 座舱转向标定（方向盘 ↔ 车轮 ↔ 车标） ---------------- */
section('座舱转向标定');
(function () {
  var CAR = CFG.CAR;
  // 真实驾驶柱标定：满舵 36° 对应方向盘 ±270°（视觉传动比 270/36）
  check('转向标定：满舵对应方向盘 ±270°', Math.abs(CAR.steerVisualRatio * CAR.maxSteer - 270 * CFG.D2R) < 1e-9,
    ((CAR.steerVisualRatio * CAR.maxSteer) / CFG.D2R).toFixed(1) + '°');
  // 座舱可无头构建（gauge 画布有 document 守卫），校验方向盘组/车标几何
  global.self = global; global.window = global;
  if (!global.THREE) global.THREE = require(path.join(__dirname, '..', 'vendor', 'three.min.js'));
  var PS_ = global.PS = global.PS || {};
  PS_.VIEW = CFG.VIEW; PS_.CAR = CFG.CAR;
  PS_.Cockpit = require(path.join(__dirname, '..', 'js', 'cockpit.js'));
  var carGroup = new global.THREE.Group();
  var cockpit = PS_.Cockpit.buildInterior(carGroup);
  var wheel = cockpit.wheelGroup;
  check('座舱：方向盘组默认回正（rotation.z=0）', wheel.rotation.z === 0);
  check('座舱：方向盘安装倾角 -24°（真实驾驶柱）', Math.abs(wheel.rotation.x + 24 * CFG.D2R) < 1e-9,
    (wheel.rotation.x / CFG.D2R).toFixed(1) + '°');
  var emblem = wheel.getObjectByName('emblem');
  check('座舱：车标挂在方向盘组上（随盘转动）', !!emblem && emblem.parent === wheel);
  var minZ = 0;
  if (emblem) emblem.traverse(function (o) {
    if (o.isMesh) {
      var d = (o.geometry.parameters && o.geometry.parameters.depth) || 0;
      minZ = Math.min(minZ, o.position.z - d / 2);
    }
  });
  check('座舱：车标凸出在驾驶员侧（局部 -z，旧贴片仅 6mm 难辨转动）', minZ < -0.02, 'minZ=' + minZ.toFixed(4));
  var stripe = wheel.getObjectByName('centerStripe');
  check('座舱：12 点回正标线挂在方向盘组顶部', !!stripe && stripe.parent === wheel &&
    Math.abs(stripe.position.y - 0.175) < 1e-9 && Math.abs(stripe.position.x) < 1e-9,
    stripe ? ('y=' + stripe.position.y.toFixed(3)) : '缺失');
})();

/* ---------------- 12. 脉冲积分（pulse）单元测试 ---------------- */
section('脉冲积分');
(function () {
  var PULSE = require(path.join(JS, 'pulse.js'));
  var P = CFG.PHYS;
  // 巡行速度语义：demoSpeed 是 m/s、供规划/演示侧专用（玩家蠕行是 creep/3.6，单位不同）
  var st = { x: 0, z: 0, h: 0, v: 0, steer: 0, gear: 'D' };
  for (var i = 0; i < 120; i++) PULSE.stepMotion(st, 0, 1 / 60, P, CFG.CAR);
  check('pulse: 前进巡行收敛到 demoSpeed(m/s)', approx(st.v, P.demoSpeed, 0.02), 'v=' + st.v.toFixed(3));
  check('pulse: demoSpeed 与玩家蠕行是两个量纲', P.demoSpeed > P.creep / 3.6);
  check('pulse: 直行沿 +z 且后轴参考无横偏', st.z > 1 && Math.abs(st.x) < 1e-9 && approx(st.h, 0));

  st = { x: 0, z: 0, h: 0, v: 0, steer: 0, gear: 'R' };
  for (i = 0; i < 120; i++) PULSE.stepMotion(st, 0, 1 / 60, P, CFG.CAR);
  check('pulse: R 挡巡行为 -demoSpeed', approx(st.v, -P.demoSpeed, 0.02), 'v=' + st.v.toFixed(3));

  // 转向斜坡：目标角以 steerRate 渐升、目标 0 以 centerRate 回正（与 physics.js 同式）
  st = { x: 0, z: 0, h: 0, v: 0, steer: 0, gear: 'D' };
  PULSE.stepMotion(st, 1, 1 / 60, P, CFG.CAR);
  check('pulse: 转向以 steerRate 斜升', approx(st.steer, P.steerRate / 60, 1e-9), (st.steer / CFG.D2R).toFixed(2) + '°');
  st = { x: 0, z: 0, h: 0, v: 0, steer: 30 * CFG.D2R, gear: 'D' };
  PULSE.stepMotion(st, 0, 1 / 60, P, CFG.CAR);
  check('pulse: 回正以 centerRate 斜降', approx(st.steer, 30 * CFG.D2R - P.centerRate / 60, 1e-9));

  // 超速滑行：高于巡行速度时按 drag 渐减（不瞬跳、不反向）
  st = { x: 0, z: 0, h: 0, v: P.demoSpeed + 1, steer: 0, gear: 'D' };
  PULSE.stepMotion(st, 0, 1 / 60, P, CFG.CAR);
  check('pulse: 超速按 drag 渐减', st.v > P.demoSpeed && st.v < P.demoSpeed + 1, 'v=' + st.v.toFixed(3));

  // 制动步：减速度 = brakeInput(缺省 0.8) × brake；低速一步刹停
  st = { x: 0, z: 0, h: 0, v: 0.5, steer: 0, gear: 'D' };
  PULSE.brakeStep(st, 1 / 60, P);
  check('pulse: brakeStep 按制动公式减速', approx(st.v, 0.5 - 0.8 * P.brake / 60, 1e-9), 'v=' + st.v.toFixed(3));
  st = { x: 0, z: 0, h: 0, v: 0.05, steer: 0, gear: 'D' };
  PULSE.brakeStep(st, 1 / 60, P);
  check('pulse: 低速一步刹停不过冲', st.v === 0);
})();

/* ---------------- 13. 双积分器差分（"规划即所行"契约门禁） ----------------
 * physics.js（玩家侧）与 pulse.js（演示/规划侧）纵向模型刻意不同（蠕行/接合 vs 巡行），
 * 巡行速度也不同（maxFwd vs demoSpeed），轨迹不可直接比对——但运动学核心必须满足
 * 同一解析契约，这是全部 15 关标准答案"规划即所行"的基础：
 *   ① Δheading = v·tan(δ)/L·dt（v=步后速度、δ=步后转角）
 *   ② 后轴每步位移恰为 v·dt·f(h_步后)（提取用步前航向、推进/回嵌用步后航向的纯滚动）
 * 任一侧改动破坏同式即红。两积分器分别钉在各自稳态速度上（每步纵向净零）验证 */
section('双积分器差分');
(function () {
  var PULSE = require(path.join(JS, 'pulse.js'));
  var P = CFG.PHYS, dt = P.fixedDt, CAR = CFG.CAR;
  var dRear = CAR.frontOverhang + CAR.wheelbase - CAR.length / 2;
  function wrapPi(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
  function rearAxle(x, z, h) { return { x: x - Math.sin(h) * dRear, z: z - Math.cos(h) * dRear }; }

  // 同一转向输入序列（含打满/回中/反打，覆盖 steerRate 与 centerRate 两段斜坡）
  var seq = [0.5, 0.5, 0.8, 0.8, 0, -0.4, -0.4, 0.3];
  var ROUNDS = 8, EPS = 1e-9;

  function contractCheck(tag, stepFn, state) {
    var okDh = true, okRa = true, worst = 0;
    for (var i = 0; i < seq.length * ROUNDS; i++) {
      var sf = seq[i % seq.length];
      var h0 = state.h, v0 = state.v, d0 = state.steer;
      var ra0 = rearAxle(state.x, state.z, h0);
      stepFn(sf);
      // ① 航向增量（用步后速度/步后转角预言）
      var expectDh = v0 / CAR.wheelbase * Math.tan(state.steer) * dt;
      var gotDh = wrapPi(state.h - h0);
      if (Math.abs(gotDh - expectDh) > EPS) { okDh = false; break; }
      // ② 后轴位移 = v·dt·f(步后航向)
      var ra1 = rearAxle(state.x, state.z, state.h);
      var ex = ra1.x - ra0.x - v0 * dt * Math.sin(state.h);
      var ez = ra1.z - ra0.z - v0 * dt * Math.cos(state.h);
      var dev = Math.hypot(ex, ez);
      if (dev > worst) worst = dev;
      if (dev > EPS) { okRa = false; break; }
    }
    check('差分: ' + tag + ' 航向增量同式', okDh);
    check('差分: ' + tag + ' 后轴纯滚动位移同式', okRa, '最大偏差=' + worst.toExponential(2) + 'm');
  }

  // physics：前进满速稳态（drive=1 时每步钳回极速，纵向净零）
  var c = new PHYS.CarPhysics({ car: CFG.CAR, phys: P }, { x: 0, z: 0, heading: 0 });
  c.speed = P.maxFwd;
  var cView = { get x() { return c.x; }, get z() { return c.z; }, get h() { return c.heading; }, get v() { return c.speed; }, get steer() { return c.steer; } };
  contractCheck('physics', function (sf) { c.update(dt, { drive: 1, steer: sf }); }, cView);
  check('差分: physics 稳态速度钉住', approx(c.speed, P.maxFwd, 1e-9));

  // pulse：巡行稳态（v=demoSpeed，纵向净零）
  var st = { x: 0, z: 0, h: 0, v: P.demoSpeed, steer: 0, gear: 'D' };
  contractCheck('pulse', function (sf) { PULSE.stepMotion(st, sf, dt, P, CAR); }, st);
  check('差分: pulse 稳态速度钉住', approx(st.v, P.demoSpeed, 1e-9));

  // 转向斜坡差分（静止打轮）：两积分器斜坡速率/方向判定逐帧一致（数值 bit 级）
  var c2 = new PHYS.CarPhysics({ car: CFG.CAR, phys: P }, { x: 0, z: 0, heading: 0 });
  var st2 = { x: 0, z: 0, h: 0, v: 0, steer: 0, gear: 'D' };
  var rampOk = true;
  for (var i2 = 0; i2 < seq.length * 6; i2++) {
    c2.update(dt, { steer: seq[i2 % seq.length] });             // 静止：只转轮不动车
    PULSE.stepMotion(st2, seq[i2 % seq.length], dt, P, CAR);    // v 会向巡行爬升，此处只比 steer
    if (!approx(c2.steer, st2.steer, 1e-12)) { rampOk = false; break; }
  }
  check('差分: 转向斜坡速率一致（静止打轮）', rampOk);
  check('差分: 静止打轮车身不动', approx(c2.x, 0) && approx(c2.z, 0) && approx(c2.heading, 0));
})();

/* ---------------- 14. 文档与关卡数据一致性 ----------------
 * 关卡数在 README 列表与 DESIGN 关卡表里手写——加关忘改文档是真实发生过的返工，
 * 此处以 LEVELS 数量为锚做断言 */
section('文档一致性');
(function () {
  var fs = require('fs');
  var n = LVL.LEVELS.length;
  var rd = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  var dn = fs.readFileSync(path.join(__dirname, '..', 'docs', 'DESIGN.md'), 'utf8');
  check('文档: README 关卡数与 LEVELS 一致', rd.indexOf('（' + n + ' 关') >= 0, 'README 应含「' + n + ' 关」');
  var rows = (dn.match(/^\| \d+ \| /gm) || []).length;
  check('文档: DESIGN 关卡表行数与 LEVELS 一致', rows === n, '表行=' + rows + ' 关卡=' + n);
})();

/* ---------------- 15b. 烘焙路径新鲜度（物理指纹门禁） ----------------
 * demo_paths 由 solver 用当前 CAR/PHYS 烘焙；改驾驶参数而不重跑 solver 会让几十条
 * 标准答案悄悄失效（执行器与规划器共用 pulse 积分）。指纹不一致即红，提示重烘焙 */
section('路径新鲜度');
(function () {
  var DP = require(path.join(JS, 'demo_paths.js'));
  var fp = CFG.fingerprint();
  check('demo_paths 物理指纹与 config 一致（改动 CAR/PHYS 后重跑 node tools/solver.js）',
    DP._fp === fp, '烘焙=' + (DP._fp || '无') + ' 当前=' + fp);
})();

/* ---------------- 15. 拐弯真实性门禁（tools/turn_check.js） ---------------- */
section('拐弯真实性');
(function () {
  var r = require('child_process').spawnSync(process.execPath,
    [path.join(__dirname, '..', 'tools', 'turn_check.js')], { encoding: 'utf8' });
  check('拐弯真实性：全部指标在阈值内', r.status === 0,
    (r.stdout || '').split('\n').filter(function (l) { return l.indexOf('✗') >= 0 || l.indexOf('FAIL') >= 0; }).join(' | '));
})();

/* ---------------- 16. 触屏方向盘模拟量（input 第三输入源，v2 项） ---------------- */
section('触屏方向盘');
(function () {
  var touch = { steer: 0 };
  var keys = {};
  var d = INPUT.createDriver(keys, null, touch);
  var s1 = d.sample();
  check('方向盘：居中(0)=保持转角（holdSteer）', s1.steer === 0 && s1.holdSteer === true);
  touch.steer = 0.5;
  var s2 = d.sample();
  check('方向盘：转角 0.5 → 模拟量 0.5 生效', approx(s2.steer, 0.5) && s2.holdSteer === false);
  keys.a = true;
  var s3 = d.sample();
  check('方向盘：键盘优先（A 按下覆盖方向盘）', s3.steer === 1);
  keys.a = false;
  keys.d = true; keys.w = true; keys.space = true;
  touch.steer = -0.3;
  var s4 = d.sample();
  check('方向盘：油门/手刹通路不受影响', s4.steer === -1 && s4.drive === 1 && s4.handbrake === true);
  keys.d = false; keys.w = false; keys.space = false; touch.steer = 0;
  var s5 = d.sample();
  check('方向盘：全部回中后恢复 holdSteer', s5.holdSteer === true);
})();

/* ---------------- 17. 复盘回放（recorder/tape 确定性，v2 项） ---------------- */
section('复盘回放');
(function () {
  /* 录像带：假输入源按序给出，包一层 recorder 逐帧记录 */
  var seq = [
    { steer: 0, drive: 1, handbrake: false, holdSteer: false },
    { steer: 0.5, drive: 1, handbrake: false, holdSteer: false },
    { steer: 0.5, drive: 0, handbrake: false, holdSteer: false },
    { steer: 0, drive: -1, handbrake: false, holdSteer: false },
    { steer: 0, drive: 0, handbrake: true, holdSteer: true }
  ];
  var i = 0;
  var fake = {
    sample: function () { return seq[Math.min(i++, seq.length - 1)]; },
    blocked: INPUT.blockedInput
  };
  var rec = INPUT.createRecorder(fake);
  for (var k = 0; k < 3; k++) rec.sample();
  rec.blocked();
  check('录像：逐帧记录输入（4 帧）', rec.tape.length === 4 &&
    rec.tape[1].s === 0.5 && rec.tape[3].hs === true);
  /* 回放：帧序一致，超带后中性制动 */
  var tp = INPUT.createTapeSource(rec.tape);
  var got = [tp.sample(), tp.sample(), tp.sample(), tp.sample(), tp.sample()];
  check('回放：帧序重演一致', got[0].drive === 1 && got[1].steer === 0.5 && got[2].drive === 0 && got[3].holdSteer === true);
  check('回放：超带后中性制动（与真人松手一致）', tp.isDone() && got[4].holdSteer === true && got[4].drive === 0);
  tp.seek(0);
  check('回放：seek 可从头重演', tp.sample().drive === 1 && !tp.isDone());
  /* 端到端确定性：同一输入序列驱动 sim 两次，轨迹/碰撞/得分逐项一致 */
  function playOnce() {
    var lv = LVL.byId('lv02');
    var car = new PHYS.CarPhysics({ car: CFG.CAR, phys: CFG.PHYS },
      { x: lv.player.x, z: lv.player.z, heading: lv.player.a * Math.PI / 180 });
    var run = SIM.createRun(lv, { car: car });
    var scripted = [
      { steer: 0, drive: 1, handbrake: false, holdSteer: false },
      { steer: 1, drive: 1, handbrake: false, holdSteer: false }
    ];
    var j = 0;
    var src = { sample: function () { return scripted[j++ % scripted.length]; }, blocked: INPUT.blockedInput };
    var recorder = INPUT.createRecorder(src);
    var last = null;
    for (var n = 0; n < 600; n++) {
      var r = run.step(1 / 60, recorder.sample());
      last = r;
      if (r.completed || r.failed) break;
    }
    return {
      end: [car.x.toFixed(6), car.z.toFixed(6), car.heading.toFixed(6), run.collisions, last.ev ? last.ev.score : -1],
      tapeLen: recorder.tape.length
    };
  }
  var a = playOnce(), b = playOnce();
  check('复盘端到端：两次同输入逐项一致（轨迹/碰撞/得分）',
    JSON.stringify(a.end) === JSON.stringify(b.end),
    JSON.stringify(a.end) + ' vs ' + JSON.stringify(b.end));
  check('复盘端到端：录像帧数两次相同', a.tapeLen === b.tapeLen && a.tapeLen > 0);
})();

/* ---------------- 18. PWA 离线（manifest/sw 资源一致性，v2 项） ---------------- */
section('PWA 离线');
(function () {
  var fs = require('fs');
  var ROOTP = path.join(__dirname, '..');
  var manifest = JSON.parse(fs.readFileSync(path.join(ROOTP, 'manifest.webmanifest'), 'utf8'));
  check('manifest：图标与启动项齐全', manifest.icons.length >= 2 && manifest.start_url === './index.html' &&
    manifest.icons.every(function (ic) { return fs.existsSync(path.join(ROOTP, ic.src)); }));
  var sw = fs.readFileSync(path.join(ROOTP, 'sw.js'), 'utf8');
  var m = sw.match(/ASSETS = \[([\s\S]*?)\]/);
  check('sw：ASSETS 列表存在', !!m);
  if (m) {
    var assets = m[1].match(/'\.\/[^']+'/g).map(function (s) { return s.slice(3, -1); });
    check('sw：ASSETS 每一项都真实存在', assets.every(function (p2) {
      return fs.existsSync(path.join(ROOTP, p2 === '' ? 'index.html' : p2));
    }));
    /* index.html 引用的 script/css/manifest/icon 必须全部进预缓存（防发版漏项） */
    var html = fs.readFileSync(path.join(ROOTP, 'index.html'), 'utf8');
    var refs = [];
    var re = /<(?:script|link)[^>]+(?:src|href)="([^"]+)"/g, mm;
    while ((mm = re.exec(html))) {
      var r2 = mm[1];
      if (!/^(https?:|data:|#)/.test(r2)) refs.push(r2.replace(/^\.\//, ''));
    }
    var missing = refs.filter(function (r3) { return assets.indexOf(r3) < 0; });
    check('sw：index.html 引用资源全覆盖（无漏缓存）', missing.length === 0, '缺: ' + missing.join(','));
    check('sw：wx/调试专属文件不进缓存', assets.indexOf('js/ui_wx.js') < 0 &&
      assets.indexOf('js/debug_frame_entry.js') < 0 && assets.indexOf('js/platform.js') >= 0);
  }
  check('server：webmanifest MIME 已注册',
    fs.readFileSync(path.join(ROOTP, 'tools', 'server.js'), 'utf8').indexOf('webmanifest') >= 0);
})();

/* ---------------- 汇总 ---------------- */
console.log('\n========== 测试结果 ==========');
console.log('通过: ' + passed + '  失败: ' + failed);
if (failed > 0) {
  console.log('失败项:');
  failures.forEach(function (f) { console.log('  ✗ ' + f); });
  process.exit(1);
} else {
  console.log('全部通过 ✓');
}
