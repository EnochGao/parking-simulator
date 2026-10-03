/* 脉冲运动积分（唯一积分源）：
 * 规划器（tools/solver.js）的基元扩展与游戏执行器（js/autopilot.js）的段重放
 * 都调用本模块，保证"规划即所行"。
 * 转向斜坡与后轴参考积分和 js/physics.js 的 CarPhysics 同式；纵向为简化模型——
 * 恒以 PHYS.demoSpeed（m/s）巡行、仅超出时叠加滑行阻力（玩家侧蠕行窗口/
 * 接合渐入等动力学细节不在此复刻，两套速度法则不可混用同一数值）。 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.PS = root.PS || {}; root.PS.Pulse = api; }
})(typeof self !== 'undefined' ? self : this, function () {

  /**
   * 运动一步：转向以 steerRate/centerRate 斜坡逼近 steerTargetFrac*maxSteer；
   * 速度按巡行规则逼近 ±PHYS.demoSpeed（m/s，仅高于巡行速度时叠加滑行阻力）。
   * st: {x,z,h,v,steer,gear} 会被原地修改。
   */
  function stepMotion(st, steerTargetFrac, dt, P, car) {
    var target = steerTargetFrac * (car ? car.maxSteer : P.maxSteer);
    var rate = (target === 0 || (Math.abs(target) < Math.abs(st.steer) && Math.sign(target) === Math.sign(st.steer)))
      ? P.centerRate : P.steerRate;
    if (st.steer < target) st.steer = Math.min(target, st.steer + rate * dt);
    else if (st.steer > target) st.steer = Math.max(target, st.steer - rate * dt);

    var dir = st.gear === 'R' ? -1 : 1;
    var vt = P.demoSpeed * dir;
    var diff = vt - st.v, stepA = P.accel * 0.35 * dt;
    if (Math.abs(diff) <= stepA) st.v = vt;
    else st.v += Math.sign(diff) * stepA;
    if (Math.abs(st.v) > P.demoSpeed * 1.001) {
      var dv = P.drag * dt;
      st.v -= Math.sign(st.v) * Math.min(Math.abs(st.v) - P.demoSpeed, dv);
    }

    var h0 = st.h;
    var wb = car ? car.wheelbase : P.wheelbase;
    st.h += st.v / wb * Math.tan(st.steer) * dt;
    // 后轴参考积分（与 physics.js 一致）：后轴沿新航向推进（后轮纯滚动无侧滑），
    // 状态中的 x/z 仍为车几何中心（碰撞/评分/渲染锚点），由后轴沿航向前推 dRear
    var dRear = car ? car.frontOverhang + car.wheelbase - car.length / 2 : 0;
    var rx = st.x - Math.sin(h0) * dRear, rz = st.z - Math.cos(h0) * dRear;
    rx += st.v * Math.sin(st.h) * dt;
    rz += st.v * Math.cos(st.h) * dt;
    st.x = rx + Math.sin(st.h) * dRear;
    st.z = rz + Math.cos(st.h) * dRear;
  }

  /** 制动一步（换挡前刹停）：减速度 = brakeInput * brake */
  function brakeStep(st, dt, P, brakeInput) {
    var dv = (brakeInput == null ? 0.8 : brakeInput) * P.brake * dt;
    if (Math.abs(st.v) <= dv) st.v = 0;
    else st.v -= Math.sign(st.v) * dv;
  }

  return { stepMotion: stepMotion, brakeStep: brakeStep };
});
