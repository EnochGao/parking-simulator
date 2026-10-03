/* 标准答案执行器：重放规划器（tools/solver.js）生成的控制段
 * 控制段 = { g:'D'|'R', sf:-1..1(转向), dur:秒 }
 * 运动积分调用 js/pulse.js（与规划器同一代码）——"规划即所行"。
 * 游戏内"教学演示/引导线数据源"与 Node 无头回归共用同一实现。 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.PS = root.PS || {}; root.PS.Autopilot = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  var CFG_, COL, SCO, LVL, PULSE;
  function deps() {
    if (typeof module === 'object' && module.exports) {
      CFG_ = require('./config.js'); COL = require('./collision.js');
      SCO = require('./scoring.js'); LVL = require('./levels.js');
      PULSE = require('./pulse.js');
    } else {
      CFG_ = window.PS; COL = window.PS.Collision; SCO = window.PS.Scoring;
      LVL = window.PS.Levels; PULSE = window.PS.Pulse;
    }
  }

  /**
   * 创建重放器：返回 step(dt) 函数，逐步推进脉冲状态 st（同一积分源）。
   * 游戏内演示驾驶与无头回归共用，保证一致。
   */
  function createReplay(segs, dt, startPose) {
    var st = { x: startPose.x, z: startPose.z, h: startPose.h, v: 0, steer: 0, gear: segs[0].g };
    var segIdx = 0, stepLeft = Math.round(segs[0].dur / dt), segsDone = false;
    function step(dt2) {
      if (segIdx >= segs.length) { segsDone = true; PULSE.brakeStep(st, dt2, CFG_.PHYS); return st; }
      var seg = segs[segIdx];
      if (st.gear !== seg.g) {
        if (Math.abs(st.v) > 1e-3) PULSE.brakeStep(st, dt2, CFG_.PHYS);
        else st.gear = seg.g;
        return st;
      }
      var downSteps = seg.sf !== 0 ? Math.max(1, Math.ceil(Math.abs(seg.sf) * CFG_.CAR.maxSteer / CFG_.PHYS.centerRate / dt2)) : 0;
      var isDown = stepLeft <= downSteps && seg.sf !== 0;
      PULSE.stepMotion(st, isDown ? 0 : seg.sf, dt2, CFG_.PHYS, CFG_.CAR);
      stepLeft--;
      if (stepLeft <= 0) { segIdx++; if (segIdx < segs.length) stepLeft = Math.round(segs[segIdx].dur / dt2); }
      return st;
    }
    step.getSt = function () { return st; };
    step.isDone = function () { return segIdx >= segs.length; };
    return step;
  }

  /**
   * 无头重放一关的标准答案控制段
   * opts: {dt, maxTime, record, phasesOverride}
   * 返回 { success, reason, result, collisions, hits, time, final, path }
   */
  function runLevel(level, opts) {
    deps();
    opts = opts || {};
    var dt = opts.dt || 1 / 60;
    var cfg = CFG_.CAR, P = CFG_.PHYS, SC = CFG_.SCORE;
    var segs = opts.phasesOverride || LVL.getPhases(level);
    if (!segs || !segs.length) {
      return { success: false, reason: '无标准答案', collisions: 0, time: 0, hits: [], result: null, final: {}, path: [] };
    }

    var obs = LVL.getObstacleObbs(level);
    var obstacles = obs.map(function (o) { return COL.makeObb(o.x, o.z, o.angle, o.hw, o.hl); });
    var spotJ = { x: level.spot.x, z: level.spot.z, angle: level.spot.a * Math.PI / 180, w: level.spot.w, l: level.spot.l };

    // 脉冲状态（与规划器同一积分）
    var step = createReplay(segs, dt, { x: level.player.x, z: level.player.z, h: level.player.a * Math.PI / 180 });

    var t = 0, collisions = 0, hits = [], holdTimer = 0, wasColliding = false;
    var record = opts.record ? [] : null;
    var maxTime = opts.maxTime || (level.par * 4 + 60);
    var stuck = { timer: 0, x: level.player.x, z: level.player.z, count: 0 };

    var S = step.getSt();
    function postUpdate() {
      var obb = COL.carObb(S.x, S.z, S.h, cfg);
      var hi = COL.firstHit(obb, obstacles);
      if (hi >= 0) {
        if (!wasColliding) {
          collisions++;
          if (hits.length < 20) hits.push({ t: t, x: S.x, z: S.z, obst: obs[hi].t, ox: obs[hi].x, oz: obs[hi].z });
        }
        // 撞击衰减（与 CarPhysics.bounce 一致）
        S.v = -S.v * CFG_.PHYS.bounceFactor;
        if (Math.abs(S.v) < 0.25) S.v = 0;
        // 位置修正：推出障碍物，避免嵌入穿模（与游戏内主循环共用 collision.pushOut）
        COL.pushOut(S, S.h, cfg, obstacles);
      }
      wasColliding = hi >= 0;

      var ev = SCO.evaluate({
        x: S.x, z: S.z, heading: S.h,
        spot: spotJ, collisions: collisions, time: t, par: level.par, carCfg: cfg, cfg: SC
      });
      var stopped = Math.abs(S.v) < P.stoppedEps;
      if (ev.completed && stopped) {
        holdTimer += dt;
        if (holdTimer >= SC.stopTime) return { done: 'success', ev: ev };
      } else holdTimer = 0;

      if (collisions >= SC.maxCollisions) return { done: 'fail', reason: '碰撞超过 ' + SC.maxCollisions + ' 次', ev: ev };
      if (t >= maxTime) return { done: 'fail', reason: '超时', ev: ev };

      stuck.timer += dt;
      if (stuck.timer >= 1) {
        var moved = Math.hypot(S.x - stuck.x, S.z - stuck.z);
        if (moved < 0.06 && t > 2) {
          stuck.count++;
          if (stuck.count > 8) return { done: 'fail', reason: '执行卡死', ev: ev };
        } else stuck.count = 0;
        stuck.x = S.x; stuck.z = S.z; stuck.timer = 0;
      }
      return null;
    }

    function stepTick() {
      step(dt); // 推进脉冲状态（与规划器同一积分）
      t += dt;
      return postUpdate();
    }

    var res = null;
    var guard = Math.ceil(maxTime / dt);
    while (guard-- > 0) {
      res = stepTick();
      if (record && record.length < 20000) record.push({ x: S.x, z: S.z, h: S.h });
      if (res) break;
    }
    if (!res) res = { done: 'fail', reason: '模拟步数耗尽', ev: null };
    return {
      success: res.done === 'success',
      reason: res.reason || '',
      result: res.ev,
      collisions: collisions,
      hits: hits,
      time: t,
      final: { x: S.x, z: S.z, heading: S.h, gear: S.gear },
      path: record
    };
  }

  return { runLevel: runLevel, createReplay: createReplay };
});
