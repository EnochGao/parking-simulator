/* js/autopilot.js · 微信小游戏模块（tools/build_wx.js 生成，勿手改） */
var window = GameGlobal, self = GameGlobal;   /* UMD 根 → 跨模块共享全局 */
var module, exports, define;                  /* 声明以捕获外层泄露 */
module = exports = define = undefined;        /* 强制浏览器分支（var 对参数式包装无效） */
/* 标准答案执行器：重放规划器（tools/solver.js）生成的控制段
 * 控制段 = { g:'D'|'R', sf:-1..1(转向), dur:秒 }
 * 运动积分调用 js/pulse.js（与规划器同一代码）——"规划即所行"。
 * 一局规则（碰撞/计次/评分/完成/失败）走 js/sim.js，与游戏内主循环同一实现；
 * 本模块只负责"按控制段推进 + 超时/卡死看护 + 结果采集"。 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.PS = root.PS || {}; root.PS.Autopilot = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  var CFG_, SIM;
  function deps() {
    if (typeof module === 'object' && module.exports) {
      CFG_ = require('./config.js'); SIM = require('./sim.js');
    } else {
      CFG_ = window.PS; SIM = window.PS.Sim;
    }
  }

  /**
   * 创建重放器：返回 step(dt) 函数，逐步推进脉冲状态 st（同一积分源）。
   * 游戏内演示驾驶与无头回归共用，保证一致。
   */
  function createReplay(segs, dt, startPose) {
    var PULSE;
    if (typeof module === 'object' && module.exports) PULSE = require('./pulse.js');
    else PULSE = window.PS.Pulse;
    if (!segs || !segs.length) segs = [];   // 无标准答案：退化为持续刹车的空重放器，调用方不 crash
    var st = { x: startPose.x, z: startPose.z, h: startPose.h, v: 0, steer: 0, gear: segs.length ? segs[0].g : 'D' };
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

  /* 脉冲状态 {x,z,h,v} → sim 期望的 {x,z,heading,speed} 只读写视图（零拷贝） */
  function simView(st) {
    var view = {};
    Object.defineProperty(view, 'x', { get: function () { return st.x; }, set: function (v) { st.x = v; } });
    Object.defineProperty(view, 'z', { get: function () { return st.z; }, set: function (v) { st.z = v; } });
    Object.defineProperty(view, 'heading', { get: function () { return st.h; }, set: function (v) { st.h = v; } });
    Object.defineProperty(view, 'speed', { get: function () { return st.v; }, set: function (v) { st.v = v; } });
    Object.defineProperty(view, 'steer', { get: function () { return st.steer; }, set: function (v) { st.steer = v; } });
    Object.defineProperty(view, 'gear', { get: function () { return st.gear; }, set: function (v) { st.gear = v; } });
    return view;
  }

  /**
   * 无头重放一关的标准答案控制段
   * opts: {dt, maxTime, record, phasesOverride}
   * 返回 { success, reason, result, collisions, hits, time, final, path }
   */
  function runLevel(level, opts) {
    deps();
    opts = opts || {};
    var dt = opts.dt || CFG_.PHYS.fixedDt;   // 与游戏壳层同一固定步长（config 单源）
    var SC = CFG_.SCORE;
    var segs = opts.phasesOverride || (function () {
      var LVL = typeof module === 'object' && module.exports ? require('./levels.js') : window.PS.Levels;
      return LVL.getPhases(level);
    })();
    if (!segs || !segs.length) {
      return { success: false, reason: '无标准答案', collisions: 0, time: 0, hits: [], result: null, final: {}, path: [] };
    }

    // 脉冲状态（与规划器同一积分）；sim 以只读写视图消费它
    var step = createReplay(segs, dt, { x: level.player.x, z: level.player.z, h: level.player.a * Math.PI / 180 });
    var S = step.getSt();
    var run = SIM.createRun(level, { car: simView(S) });

    var hits = [];
    var record = opts.record ? [] : null;
    var maxTime = opts.maxTime || (level.par * 4 + 60);
    var stuck = { timer: 0, x: level.player.x, z: level.player.z, count: 0 };

    var res = null;
    var guard = Math.ceil(maxTime / dt);
    while (guard-- > 0) {
      step(dt);                       // 推进脉冲状态（与规划器同一积分）
      var r = run.post(dt);           // 规则步（碰撞/评分/完成/失败——与游戏内同一实现）
      if (record && record.length < 20000) record.push({ x: S.x, z: S.z, h: S.h });

      if (r.counted && hits.length < 20) {
        hits.push({ t: run.time, x: S.x, z: S.z, obst: r.obDef.t, ox: r.obDef.x, oz: r.obDef.z });
      }
      if (r.completed) { res = { done: 'success', ev: r.ev }; break; }
      if (r.failed) { res = { done: 'fail', reason: '碰撞超过 ' + SC.maxCollisions + ' 次', ev: r.ev }; break; }
      if (run.time >= maxTime) { res = { done: 'fail', reason: '超时', ev: run.evaluate() }; break; }

      // 卡死看护：每秒检查位移，长时间原地不动视为执行失败
      stuck.timer += dt;
      if (stuck.timer >= 1) {
        var moved = Math.hypot(S.x - stuck.x, S.z - stuck.z);
        if (moved < 0.06 && run.time > 2) {
          stuck.count++;
          if (stuck.count > 8) { res = { done: 'fail', reason: '执行卡死', ev: run.evaluate() }; break; }
        } else stuck.count = 0;
        stuck.x = S.x; stuck.z = S.z; stuck.timer = 0;
      }
    }
    if (!res) res = { done: 'fail', reason: '模拟步数耗尽', ev: null };
    return {
      success: res.done === 'success',
      reason: res.reason || '',
      result: res.ev,
      collisions: run.collisions,
      hits: hits,
      time: run.time,
      final: { x: S.x, z: S.z, heading: S.h, gear: S.gear },
      path: record
    };
  }

  return { runLevel: runLevel, createReplay: createReplay };
});