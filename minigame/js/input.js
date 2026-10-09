/* js/input.js · 微信小游戏模块（tools/build_wx.js 生成，勿手改） */
var window = GameGlobal, self = GameGlobal;   /* UMD 根 → 跨模块共享全局 */
var module, exports, define;                  /* 声明以捕获外层泄露 */
module = exports = define = undefined;        /* 强制浏览器分支（var 对参数式包装无效） */
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

  /** 中性制动输入：松开即刹车、保持当前转角（后视镜调节等驾驶封锁场景用）。
   *  返回共享只读对象——所有调用方（物理步/录像）都同步消费字段，无人保留引用 */
  var BLOCKED = { steer: 0, drive: 0, handbrake: false, holdSteer: true };
  function blockedInput() {
    return BLOCKED;
  }

  /**
   * 创建驾驶输入源。
   * keys: 键位状态表 {w,a,s,d,space:true/false}（由壳层键盘监听维护）
   * gpad: 手柄句柄（可选，需提供 drive() → {steer,drive,handbrake|null}）
   * touch: 触屏方向盘模拟量（可选，{steer: -1..1}，由虚拟方向盘控件维护；
   *   0=居中——与"松开保持转角"同语义，走 mergeDrive 的 holdSteer 分支）
   * 优先级：键盘数字量 > 触屏方向盘模拟量 > 手柄模拟量（合并语义见 gamepad.js mergeDrive）。
   * sample() 复用同一输出对象（60Hz 热路径零分配）；调用方须同步消费，勿跨步保留。
   */
  function createDriver(keys, gpad, touch) {
    var out = { steer: 0, drive: 0, holdSteer: true, handbrake: false };
    return {
      sample: function () {
        deps();
        var gs = gpad ? gpad.drive() : null;
        var ts = (touch && touch.steer) ? touch.steer : 0;
        if (ts) {   // 方向盘有转角：与手柄模拟量同通道（键盘仍最高优先）
          gs = {
            steer: ts,
            drive: gs ? gs.drive : null,
            handbrake: gs ? gs.handbrake : false
          };
        }
        var m = GP.mergeDrive(
          (keys.a ? 1 : 0) - (keys.d ? 1 : 0),
          (keys.w ? 1 : 0) - (keys.s ? 1 : 0),
          gs,
          out
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