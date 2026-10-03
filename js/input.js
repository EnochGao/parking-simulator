/* 驾驶输入源：键盘/手柄 → 统一 input 对象的可替换抽象
 * sample() 产出 {steer, drive, handbrake, holdSteer}，与 CarPhysics.update 约定一致。
 * 输入路径收口于此的意义：录像（createRecorder 逐帧记录）与回放/联机
 * （createTapeSource 按帧序喂入）只是换一个 sample() 实现，物理与规则层零改动。
 * Node/浏览器双端通用（合并函数复用 gamepad.js 的纯函数部分）。 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.PS = root.PS || {}; root.PS.Input = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  var GP;
  function deps() {
    if (GP) return;   // 只解析一次（浏览器端脚本加载顺序不保证，故不能在模块加载时解析）
    if (typeof module === 'object' && module.exports) GP = require('./gamepad.js');
    else GP = window.PS.Gamepad;
  }

  /** 中性制动输入：松开即刹车、保持当前转角（后视镜调节等驾驶封锁场景用） */
  function blockedInput() {
    return { steer: 0, drive: 0, handbrake: false, holdSteer: true };
  }

  /**
   * 创建驾驶输入源。
   * keys: 键位状态表 {w,a,s,d,space:true/false}（由壳层键盘监听维护）
   * gpad: 手柄句柄（可选，需提供 drive() → {steer,drive,handbrake|null}）
   * 键盘优先（数字量），手柄模拟量补位——合并语义见 gamepad.js mergeDrive。
   */
  function createDriver(keys, gpad) {
    return {
      sample: function () {
        deps();
        var gs = gpad ? gpad.drive() : null;
        var m = GP.mergeDrive(
          (keys.a ? 1 : 0) - (keys.d ? 1 : 0),
          (keys.w ? 1 : 0) - (keys.s ? 1 : 0),
          gs
        );
        m.handbrake = m.handbrake || !!keys.space;
        return m;
      },
      blocked: blockedInput
    };
  }

  /** 录像：包一层输入源，sample() 照常透传并逐帧记录（dt 固定 1/60，帧序即时间） */
  function createRecorder(source) {
    var tape = [];
    return {
      sample: function () {
        var i = source.sample();
        tape.push({ s: i.steer, d: i.drive, hb: i.handbrake, hs: i.holdSteer });
        return i;
      },
      blocked: function () {
        var i = source.blocked();
        tape.push({ s: i.steer, d: i.drive, hb: i.handbrake, hs: i.holdSteer });
        return i;
      },
      tape: tape,
      reset: function () { tape = []; }
    };
  }

  /** 回放：按帧序喂出录像带（超带后持续给中性制动——与真人松手一致） */
  function createTapeSource(tape) {
    var i = 0;
    return {
      sample: function () {
        if (i < tape.length) {
          var t = tape[i++];
          return { steer: t.s, drive: t.d, handbrake: t.hb, holdSteer: t.hs };
        }
        return blockedInput();
      },
      blocked: blockedInput,
      isDone: function () { return i >= tape.length; },
      seek: function (n) { i = n; }
    };
  }

  return {
    createDriver: createDriver,
    createRecorder: createRecorder,
    createTapeSource: createTapeSource,
    blockedInput: blockedInput
  };
});
