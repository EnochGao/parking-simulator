/* Hybrid A* 泊车路径规划器（离线工具）
 * 输出"控制段"（档位/转向/时长），执行器（js/autopilot.js）逐段重放。
 * 基元 = 转向脉冲：转向以游戏同款转向速率从 0 斜升到目标、保持、再斜降回 0；
 * 与执行器使用同一运动学/步长，规划与执行一致（规划即所行）。
 * 约束：非零转向脉冲之间必须插入回正脉冲（sf=0），保证转向状态无历史依赖。
 *
 * 运行：node tools/solver.js [levelId ...] [--margin=0.3]   无参数=全部关卡 */
'use strict';
var path = require('path'), fs = require('fs');
var JS = path.join(__dirname, '..', 'js');
var CFG = require(path.join(JS, 'config.js'));
var COL = require(path.join(JS, 'collision.js'));
var SCO = require(path.join(JS, 'scoring.js'));
var LVL = require(path.join(JS, 'levels.js'));
var AUTO = require(path.join(JS, 'autopilot.js'));
var PULSE = require(path.join(JS, 'pulse.js'));

var Heap = require("./heap-shim.js");

function HeapUnused() { this.a = []; }
Heap.prototype.push = function (n) {
  var a = this.a; a.push(n); var i = a.length - 1;
  while (i > 0) { var p = (i - 1) >> 1; if (a[p].f <= a[i].f) break; var t = a[p]; a[p] = a[i]; a[i] = t; i = p; }
};
Heap.prototype.pop = function () {
  var a = this.a, top = a[0], last = a.pop();
  if (a.length) {
    a[0] = last; var i = 0;
    for (;;) {
      var l = 2 * i + 1, r = l + 1, m = i;
      if (l < a.length && a[l].f < a[m].f) m = l;
      if (r < a.length && a[r].f < a[m].f) m = r;
      if (m === i) break;
      var t = a[m]; a[m] = a[i]; a[i] = t; i = m;
    }
  }
  return top;
};


function wrapDegRad(d) { while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }

function solve(level, opt) {
  opt = opt || {};
  var car = CFG.CAR;
  var margin = opt.margin != null ? opt.margin : 0.30;
  var maxExp = opt.maxExp || 150000;
  var w = 1.8;
  var obsRaw = LVL.getObstacleObbs(level);
  var obstacles = obsRaw.map(function (o) { return COL.makeObb(o.x, o.z, o.angle, o.hw, o.hl); });
  // 粗筛半径（避免对全部障碍物做 SAT）
  var obsR = obstacles.map(function (o) { return Math.hypot(o.hw, o.hl) + 6.2; });
  var b = level.bounds;
  var spotJ = { x: level.spot.x, z: level.spot.z, angle: level.spot.a * Math.PI / 180, w: level.spot.w, l: level.spot.l };

  function collides(x, z, h) {
    // 非均匀边距：离车位越近边距越小（现实中最后微调依赖雷达与感觉）
    var dSpot = Math.hypot(x - spotJ.x, z - spotJ.z);
    var m = Math.min(margin, Math.max(0.03, margin * dSpot / 3));
    var hw = car.width / 2 + m, hl = car.length / 2 + m;
    for (var i = 0; i < obstacles.length; i++) {
      var o = obstacles[i];
      if (Math.hypot(x - o.x, z - o.z) > obsR[i]) continue; // 距离粗筛
      if (COL.obbOverlap(COL.makeObb(x, z, h, hw, hl), o)) return true;
    }
    return false;
  }
  function goalDev(x, z, h) {
    var ev = SCO.evaluate({ x: x, z: z, heading: h, spot: spotJ, collisions: 0, time: 0, par: level.par, carCfg: car, cfg: CFG.SCORE });
    return ev.completed ? ev.devDeg : 1e9;
  }
  function key(x, z, h) {
    return Math.round(x * 5) + '|' + Math.round(z * 5) + '|' + Math.round(h * 36 / Math.PI);
  }

  /* ---- 控制段基元（与执行器同模型） ---- */
  var dt = 1 / 60, L = car.wheelbase;
  var rate = CFG.PHYS.steerRate, acc = CFG.PHYS.accel * 0.35, vr = CFG.PHYS.creep;
  var actions = [];
  [0.6, -0.6].forEach(function (sf) {
    [0.7, 1.0, 1.6, 2.4].forEach(function (dur) {
      actions.push({ g: 'D', sf: sf, dur: dur });
      actions.push({ g: 'R', sf: sf, dur: dur });
    });
  });
  [1, -1].forEach(function (sf) {
    [1.1, 1.6, 2.4].forEach(function (dur) {
      actions.push({ g: 'D', sf: sf, dur: dur });
      actions.push({ g: 'R', sf: sf, dur: dur });
    });
  });
  [0.5, 1.2].forEach(function (dur) {
    actions.push({ g: 'D', sf: 0, dur: dur });
    actions.push({ g: 'R', sf: 0, dur: dur });
  });

  /* 精细对接微脉冲：全舵角权限 + 短时长（末端落位精度 ~0.1-0.2m） */
  var fineActions = [];
  [0.8, -0.8].forEach(function (sf) {
    [0.9, 1.3].forEach(function (dur) {
      fineActions.push({ g: 'D', sf: sf, dur: dur });
      fineActions.push({ g: 'R', sf: sf, dur: dur });
    });
  });
  [1, -1].forEach(function (sf) {
    [1.1, 1.6].forEach(function (dur) {
      fineActions.push({ g: 'D', sf: sf, dur: dur });
      fineActions.push({ g: 'R', sf: sf, dur: dur });
    });
  });
  [0.4].forEach(function (dur) {
    fineActions.push({ g: 'D', sf: 0, dur: dur });
    fineActions.push({ g: 'R', sf: 0, dur: dur });
  });

  /** 执行一个控制段，返回末状态；不可行返回 null（与执行器共用 Pulse 积分） */
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
    var downSteps = ac.sf !== 0 ? Math.max(1, Math.ceil(Math.abs(ac.sf) * CFG.CAR.maxSteer / CFG.PHYS.centerRate / dt)) : 0;
    for (var i = 0; i < steps; i++) {
      var isDown = i >= steps - downSteps && ac.sf !== 0;
      PULSE.stepMotion(st, isDown ? 0 : ac.sf, dt, CFG.PHYS, CFG.CAR);
      if ((i & 3) === 0) {
        if (st.x < b.minX - 1.5 || st.x > b.maxX + 1.5 || st.z < b.minZ - 1.5 || st.z > b.maxZ + 1.5) return null;
        if (collides(st.x, st.z, st.h)) return null;
      }
    }
    if (st.x < b.minX - 1.5 || st.x > b.maxX + 1.5 || st.z < b.minZ - 1.5 || st.z > b.maxZ + 1.5) return null;
    if (collides(st.x, st.z, st.h)) return null;
    return { x: st.x, z: st.z, h: st.h, v: st.v, gear: ac.g, lastSf: ac.sf };
  }

  function astar(startState, isGoal, hfn, budget, hWeight, actionSet) {
    var hw = hWeight != null ? hWeight : w;
    var acts = actionSet === 'fine' ? fineActions : actions;
    var start = {
      x: startState.x, z: startState.z, h: startState.h,
      gear: startState.gear || 'D', lastSf: 0, isStart: !!startState.isStart, v: startState.v || 0, g: 0,
      f: hw * hfn(startState.x, startState.z, startState.h), par: null, act: null
    };
    if (collides(start.x, start.z, start.h)) return { ok: false, reason: '起点碰撞(含边距)' };
    var open = new Heap(); open.push(start);
    var bestG = new Map(); bestG.set(key(start.x, start.z, start.h), 0);
    var goal = null, exp = 0;
    var minDev = Infinity;
    while (open.size && exp < budget) {
      var n = open.pop();
      var k0 = key(n.x, n.z, n.h);
      if ((bestG.get(k0) || Infinity) < n.g - 1e-6) continue;
      exp++;
      if (actionSet === 'fine') { var dv = goalDev(n.x, n.z, n.h); if (dv < minDev) minDev = dv; }
      if (opt.progress && exp % 20000 === 0) opt.progress(exp, n);
      if (isGoal(n.x, n.z, n.h)) { goal = n; break; }
      for (var ai = 0; ai < acts.length; ai++) {
        var ac = acts[ai];
        var ns = expand(n, ac);
        if (!ns) continue;
        var ng = n.g + 1 + (ac.g !== n.gear ? opt.gearCost || 2.5 : 0) + (ac.g === 'R' ? 0.12 : 0);
        var kk = key(ns.x, ns.z, ns.h);
        if ((bestG.get(kk) || Infinity) <= ng) continue;
        bestG.set(kk, ng);
        ns.g = ng; ns.f = ng + hw * hfn(ns.x, ns.z, ns.h); ns.par = n; ns.act = ac;
        open.push(ns);
      }
    }
    if (!goal) {
      if (actionSet === 'fine') return { ok: false, reason: '未找到路径(最近可达偏差 ' + (minDev === Infinity ? '∞' : minDev.toFixed(1) + '°') + ')', expansions: exp };
      return { ok: false, reason: '未找到路径', expansions: exp };
    }
    var seq = [], cur = goal;
    while (cur) { seq.push(cur); cur = cur.par; }
    seq.reverse();
    return { ok: true, seq: seq, end: goal, expansions: exp };
  }

  /** 末端暴力搜索：从当前状态用 1-2 个连续时长脉冲精确落位 */
  function endgameBrute(startNode) {
    var bestSeen = Infinity;
    var cnt = { calls: 0, nulls: 0, singles: 0 };
    var sfs = [-1, -0.8, -0.6, -0.5, -0.4, -0.2, 0, 0.2, 0.4, 0.5, 0.6, 0.8, 1];
    var durs = [];
    for (var d = 0.4; d <= 2.61; d += 0.075) durs.push(Math.round(d * 1000) / 1000);
    var gears = ['R', 'D'];

    /* 轴线窗口：横偏差≤8cm、航向≤5°、沿轴距离合适 —— 命中后直行精确滑入 */
    function axisTest(n) {
      var dx = spotJ.x - n.x, dz = spotJ.z - n.z;
      var along = dx * Math.sin(n.h) + dz * Math.cos(n.h);
      var cross = Math.abs(dx * Math.cos(n.h) - dz * Math.sin(n.h));
      var dev = SCO.angleDevDeg(n.h, spotJ.angle);
      if (dev > 5) return 0;
      if (cross > 0.08) return 0;
      if (along < -0.5 || along > 3.4) return 0;
      return 1;
    }
    function tryAxis(n, segsSoFar) {
      if (!n || !axisTest(n)) return null;
      var dx = spotJ.x - n.x, dz = spotJ.z - n.z;
      var along = dx * Math.sin(n.h) + dz * Math.cos(n.h);
      var g = along >= 0 ? 'D' : 'R';
      var dur = Math.abs(along) / CFG.PHYS.creep;
      var out = segsSoFar.concat([{ g: g, sf: 0, dur: Math.round(dur * 100) / 100 }]);
      return { ok: true, segs: out };
    }

    /* 单脉冲 */
    for (var gi = 0; gi < gears.length; gi++) {
      var g1 = gears[gi];
      for (var si = 0; si < sfs.length; si++) {
        for (var di = 0; di < durs.length; di++) {
          var n1 = expand(startNode, { g: g1, sf: sfs[si], dur: durs[di] });
          var hit = tryAxis(n1, [{ g: g1, sf: sfs[si], dur: durs[di] }]);
          if (hit) return hit;
        }
      }
    }
    /* 双脉冲 */
    for (gi = 0; gi < gears.length; gi++) {
      var ga = gears[gi];
      for (var sia = 0; sia < sfs.length; sia++) {
        for (var dia = 0; dia < durs.length; dia++) {
          var na = expand(startNode, { g: ga, sf: sfs[sia], dur: durs[dia] });
          if (!na) continue;
          na.lastSf = sfs[sia];
          for (var gj = 0; gj < gears.length; gj++) {
            var gb = gears[gj];
            for (var sib = 0; sib < sfs.length; sib++) {
              if (ga === gb && sfs[sib] !== 0 && sfs[sia] !== 0) continue;
              for (var dib = 0; dib < durs.length; dib++) {
                var nb = expand(na, { g: gb, sf: sfs[sib], dur: durs[dib] });
                var hit2 = tryAxis(nb, [{ g: ga, sf: sfs[sia], dur: durs[dia] }, { g: gb, sf: sfs[sib], dur: durs[dib] }]);
                if (hit2) return hit2;
              }
            }
          }
        }
      }
    }
    /* 三脉冲（带逼近剪枝） */
    for (gi = 0; gi < gears.length; gi++) {
      var g1b = gears[gi];
      for (var si1 = 0; si1 < sfs.length; si1++) {
        for (var di1 = 0; di1 < durs.length; di1++) {
          var nA = expand(startNode, { g: g1b, sf: sfs[si1], dur: durs[di1] });
          if (!nA) continue;
          nA.lastSf = sfs[si1];
          for (var gj1 = 0; gj1 < gears.length; gj1++) {
            var g2b = gears[gj1];
            for (var si2 = 0; si2 < sfs.length; si2++) {
              if (g1b === g2b && sfs[si2] !== 0 && sfs[si1] !== 0) continue;
              for (var di2 = 0; di2 < durs.length; di2++) {
                var nB = expand(nA, { g: g2b, sf: sfs[si2], dur: durs[di2] });
                if (!nB) continue;
                if (Math.hypot(nB.x - spotJ.x, nB.z - spotJ.z) > 3.2) continue;
                nB.lastSf = sfs[si2];
                for (var gj2 = 0; gj2 < gears.length; gj2++) {
                  var g3 = gears[gj2];
                  for (var si3 = 0; si3 < sfs.length; si3++) {
                    if (g2b === g3 && sfs[si3] !== 0 && sfs[si2] !== 0) continue;
                    for (var di3 = 0; di3 < durs.length; di3++) {
                      var nC = expand(nB, { g: g3, sf: sfs[si3], dur: durs[di3] });
                      var dv3x = nC ? SCO.angleDevDeg(nC.h, spotJ.angle) : 999;
                      var dxx = nC ? (spotJ.x - nC.x) : 0, dzz = nC ? (spotJ.z - nC.z) : 0;
                      var crx = nC ? Math.abs(dxx * Math.cos(nC.h) - dzz * Math.sin(nC.h)) : 999;
                      var hit3 = tryAxis(nC, [
                        { g: g1b, sf: sfs[si1], dur: durs[di1] },
                        { g: g2b, sf: sfs[si2], dur: durs[di2] },
                        { g: g3, sf: sfs[si3], dur: durs[di3] }
                      ]);
                      if (hit3) return hit3;
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    return null;
  }

  function seqToSegs(seq) {
    // 每个动作 = 一个控制段；禁止合并（脉冲自带回正斜坡，合并破坏轨迹）
    var segs = [];
    for (var i = 1; i < seq.length; i++) {
      var ac = seq[i].act;
      segs.push({ g: ac.g, sf: ac.sf, dur: ac.dur });
    }
    return segs;
  }

  var totalExp = 0;
  var via = level.via;
  var legs = [];
  var goalHfn = function (x, z, h) {
    var d = Math.hypot(x - spotJ.x, z - spotJ.z);
    var dev = SCO.angleDevDeg(h, spotJ.angle) * Math.PI / 180;
    return d + dev * 0.8;
  };
  if (via) {
    var vh = via.a * Math.PI / 180;
    var leg1 = astar(
      { x: level.player.x, z: level.player.z, h: level.player.a * Math.PI / 180, gear: 'D', isStart: true },
      function (x, z, h) {
        return Math.hypot(x - via.x, z - via.z) < 0.5 && Math.abs(wrapDegRad(h - vh)) < 15 * Math.PI / 180;
      },
      function (x, z, h) { return Math.hypot(x - via.x, z - via.z) + Math.abs(wrapDegRad(h - vh)); },
      maxExp
    );
    if (!leg1.ok) return { ok: false, reason: '预备位段:' + leg1.reason, expansions: leg1.expansions };
    totalExp += leg1.expansions;
    legs.push(leg1);
    var leg2 = astar(
      // 关键：继承 leg1 末档位与运动状态（非静止、非 isStart），与执行器衔接一致
      { x: leg1.end.x, z: leg1.end.z, h: leg1.end.h, v: leg1.end.v, gear: leg1.end.gear, isStart: false },
      // 粗定位：进入车位 2.2m 邻域且姿态大致朝向车位
      function (x, z, h) {
        var d2 = Math.hypot(x - spotJ.x, z - spotJ.z), dev2 = SCO.angleDevDeg(h, spotJ.angle);
        var okz = d2>0.7&&d2<1.6&&dev2<15;
        return okz;
      },
      goalHfn, maxExp, 1.2
    );
    if (!leg2.ok) return { ok: false, reason: '入库段:' + leg2.reason, expansions: leg2.expansions };
    totalExp += leg2.expansions;
    legs.push(leg2);
    if (goalDev(leg2.end.x, leg2.end.z, leg2.end.h) >= 7) {
      var fine = astar(
        { x: leg2.end.x, z: leg2.end.z, h: leg2.end.h, v: leg2.end.v, gear: leg2.end.gear, isStart: false },
        function (x, z, h) { return goalDev(x, z, h) < 7; },
        goalHfn, 90000, 1.3, 'fine'
      );
      if (fine.ok) {
        totalExp += fine.expansions;
        legs.push(fine);
      } else {
        var tail = endgameBrute(leg2.end);
        if (!tail) return { ok: false, reason: '精细对接:失败(' + fine.reason + ')', expansions: fine.expansions };
        legs.push(tail);
      }
    }
  } else {
    var leg = astar(
      { x: level.player.x, z: level.player.z, h: level.player.a * Math.PI / 180 },
      function (x, z, h) { return goalDev(x, z, h) < 7; },
      goalHfn, maxExp
    );
    if (!leg.ok) return { ok: false, reason: leg.reason, expansions: leg.expansions };
    totalExp += leg.expansions;
    legs.push(leg);
  }

  var allSegs = [];
  legs.forEach(function (leg) {
    var ss = leg.segs || seqToSegs(leg.seq);
    allSegs = allSegs.concat(ss);
  });
  // 一致性自检：从出生点用 expand 链式重放控制段，终点应可入库
  var rp = { x: level.player.x, z: level.player.z, h: level.player.a * Math.PI / 180, v: 0, steer: 0, gear: allSegs[0].g, lastSf: 0, isStart: true };
  var replayPts = [];
  allSegs.forEach(function (s) {
    if (rp.gear !== s.g) { var g2 = 80; while (Math.abs(rp.v) > 1e-3 && g2-- > 0) PULSE.brakeStep(rp, dt, CFG.PHYS); rp.gear = s.g; }
    for (var q2 = 0; q2 < Math.round(s.dur / dt); q2++) PULSE.stepMotion(rp, s.sf, dt, CFG.PHYS, CFG.CAR);
    replayPts.push({ x: rp.x, z: rp.z, h: rp.h });
  });
  var chainDev = goalDev(rp.x, rp.z, rp.h);
  if (process.env.VERBOSE) {
    console.log('    [chain] 重放终点: (' + rp.x.toFixed(2) + ',' + rp.z.toFixed(2) + ') goalDev=' + (chainDev === 1e9 ? '1e9' : chainDev.toFixed(2)));
    console.log('    [chain] 搜索链前3节点:', legs[0].seq.slice(1, 4).map(function (n) { return '(' + n.x.toFixed(2) + ',' + n.z.toFixed(2) + ',' + (n.h * 180 / Math.PI).toFixed(0) + '°)'; }).join(' '));
    console.log('    [chain] 重放前3节点:', replayPts.slice(0, 3).map(function (n) { return '(' + n.x.toFixed(2) + ',' + n.z.toFixed(2) + ',' + (n.h * 180 / Math.PI).toFixed(0) + '°)'; }).join(' '));
  }
  return { ok: true, segs: allSegs, expansions: totalExp, margin: margin, chainDev: chainDev };
}

/* ---------- 主流程 ---------- */
var out = {};

function main() {
var args = process.argv.slice(2);
var margin = 0.30;
var ids = [];
args.forEach(function (a) {
  if (a.indexOf('--margin=') === 0) margin = parseFloat(a.split('=')[1]);
  else ids.push(a);
});
var levels = ids.length ? ids.map(function (i) { return LVL.byId(i); }).filter(Boolean) : LVL.LEVELS;

try { out = require(path.join(JS, 'demo_paths.js')); } catch (e) { /* 首次生成 */ }
var fail = 0;
levels.forEach(function (lv) {
  var r = null, verified = false, gearCosts = [2.5, 5, 8, 14];
  var tries = [margin, 0.18, 0.12];
  outer:
  for (var gi = 0; gi < gearCosts.length; gi++) {
    for (var ti = 0; ti < tries.length; ti++) {
      r = solve(lv, { margin: tries[ti], gearCost: gearCosts[gi] });
      if (!r.ok) continue;
      var vr = AUTO.runLevel(lv, { phasesOverride: r.segs, maxTime: lv.par * 4 + 60 });
      if (vr.success && vr.collisions <= 2) { verified = true; break outer; }
      if (process.env.VERBOSE) {
        console.log('    尝试 margin=' + tries[ti] + ' gearCost=' + gearCosts[gi] +
          ' 段数=' + r.segs.length + ' -> 成功=' + vr.success + ' 碰撞=' + vr.collisions +
          (vr.result ? ' 偏差=' + vr.result.posOffset.toFixed(2) + '/' + vr.result.devDeg.toFixed(1) + '°' : ' (' + vr.reason + ')') +
          (vr.hits.length ? ' 首撞@t' + vr.hits[0].t.toFixed(1) + ' ' + vr.hits[0].obst : ''));
      }
      r.verifyFail = '重放验证未过: 成功=' + vr.success + ' 碰撞=' + vr.collisions + (vr.result ? ' 偏差=' + vr.result.posOffset.toFixed(2) : ' (' + vr.reason + ')');
    }
  }
  if (r && r.ok) {
    console.log((verified ? '✓' : '△') + ' ' + lv.id + ' ' + lv.name +
      '  边距=' + r.margin.toFixed(2) + 'm 段数=' + r.segs.length +
      ' 展开=' + r.expansions + (verified ? ' [重放验证通过]' : ' [!!' + r.verifyFail + ']'));
    if (verified) {
      out[lv.id] = r.segs;
      writeOut(); // 即时写入，进度可累积
    } else fail++;
  } else {
    fail++;
    console.log('✗ ' + lv.id + ' ' + lv.name + '  ' + (r && r.reason ? r.reason : '求解失败'));
  }
});

if (!ids.length || !fail) {
  writeOut();
  console.log('已写入 js/demo_paths.js');
}
process.exit(fail ? 1 : 0);
}

function writeOut() {
  var file = '/* 自动生成：tools/solver.js 产物（控制段：g 档位 sf 转向 dur 秒），勿手改 */\n' +
    '(function (root, factory) {\n' +
    '  var api = factory();\n' +
    "  if (typeof module === 'object' && module.exports) { module.exports = api; }\n" +
    "  else { root.PS = root.PS || {}; root.PS.DEMO_PATHS = api; }\n" +
    "})(typeof self !== 'undefined' ? self : this, function () {\n" +
    '  return ' + JSON.stringify(out) + ';\n' +
    '});\n';
  fs.writeFileSync(path.join(JS, 'demo_paths.js'), file, 'utf8');
}
if (require.main === module) main();
module.exports = { solve: solve };
