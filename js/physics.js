/* 车辆物理：运动学自行车模型 + 前后油门控制（Node/浏览器双端通用）
 * 控制约定：W/↑ 前进、S/↓ 倒车、松开即刹车停稳；档位 D/R 随驾驶意图自动切换。
 * 坐标约定：地面为 x-z 平面，y 向上；heading=0 时车头朝 +z；
 * forward = (sin h, 0, cos h)；steer > 0 为左转。 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.PS = root.PS || {}; root.PS.Physics = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function wrapPi(a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
  }

  function CarPhysics(cfg, pose) {
    cfg = cfg || {};
    this.car = cfg.car;   // 车辆尺寸参数
    this.phys = cfg.phys; // 动力学参数
    this.x = pose && pose.x || 0;
    this.z = pose && pose.z || 0;
    this.heading = pose && pose.heading || 0;
    this.speed = 0;          // m/s, 沿车头方向（负=倒退）
    this.steer = 0;          // 前轮转角 rad
    this.gear = 'D';         // 'D' | 'R'
    this.odometer = 0;       // 累计行驶里程（绝对值）
    /* 后轴参考：真车低速运动学的正确参考点——后轮不偏转、不侧滑，瞬时转向中心
     * 在后轴延长线上。x/z 仍存车几何中心（碰撞 OBB/渲染/评分锚点），由后轴位置
     * 沿航向前推 dRear（中心→后轴距离）推导，保证刚体一致。 */
    this._dRear = cfg.car.frontOverhang + cfg.car.wheelbase - cfg.car.length / 2;
  }

  CarPhysics.prototype.forward = function () {
    return { x: Math.sin(this.heading), z: Math.cos(this.heading) };
  };

  /** 仅在接近静止时允许切换档位，返回是否成功 */
  CarPhysics.prototype.setGear = function (g) {
    if (g !== 'D' && g !== 'R') return false;
    if (Math.abs(this.speed) > this.phys.gearSwitchMaxSpeed) return false;
    if (g === this.gear) return false;
    this.gear = g;
    return true;
  };

  /**
   * 输入 input: {drive:-1|0|1(1=W 前进, -1=S 倒车), steer:-1..1(左正右负), handbrake:bool,
   *              holdSteer:bool(true=松开方向键时保持当前转角，不自动回正)}
   * 兼容旧字段：throttle>0 视为前进，reverse 视为倒车；不传 holdSteer 保持旧的自动回正行为。
   * 松开前后键（drive=0）＝刹车，平顺制动至完全停稳。
   * dt 固定步长
   */
  CarPhysics.prototype.update = function (dt, input) {
    var P = this.phys;
    input = input || {};

    // --- 转向（静止时仅转轮不动车） ---
    // holdSteer=true 时目标角为当前角：转角保持不动（真实驾驶习惯，反打方向即可回正）
    var holdSteer = input.holdSteer === true;
    var target = holdSteer ? this.steer : clamp(input.steer || 0, -1, 1) * this.car.maxSteer;
    var rate = (Math.abs(target) < Math.abs(this.steer) && Math.sign(target) === Math.sign(this.steer)) ||
               target === 0 ? P.centerRate : P.steerRate;
    if (this.steer < target) this.steer = Math.min(target, this.steer + rate * dt);
    else if (this.steer > target) this.steer = Math.max(target, this.steer - rate * dt);

    // --- 纵向控制：W 前进 / S 倒车 / 松开即刹车 ---
    var drive = 0;
    if (input.drive != null && input.drive !== 0) drive = input.drive > 0 ? 1 : -1;
    else if (input.throttle) drive = 1;      // 兼容旧接口
    else if (input.reverse) drive = -1;

    // 档位随驾驶意图自动切换（HUD/倒车影像/倒车雷达依赖 gear）
    if (drive > 0) this.gear = 'D';
    else if (drive < 0) this.gear = 'R';

    if (input.handbrake) {
      // 手刹：最强制动
      var dvh = P.handbrakeDecel * dt;
      if (Math.abs(this.speed) <= dvh) this.speed = 0;
      else this.speed -= Math.sign(this.speed) * dvh;
    } else if (drive !== 0) {
      if (this.speed * drive < 0) {
        // 与当前运动方向相反（前进中按 S / 倒车中按 W）：先按制动减速，不直接反向驱动
        var dvb = P.brake * dt;
        if (Math.abs(this.speed) <= dvb) this.speed = 0;
        else this.speed -= Math.sign(this.speed) * dvb;
      } else {
        // 极速限制（前进 / 倒车各有限速）
        var maxAbs = drive > 0 ? P.maxFwd : P.maxRev;
        // 本帧纵向加速度（默认前进的全局 accel）
        var accel = P.accel;
        // 倒车蠕行：新按下的前 creepRampTime 秒钳在蠕行速度（轻点＝低速对位），
        // 之后经渐入的加速度平滑拉起到倒车极速，无阶跃感
        if (drive < 0) {
          accel = P.accelRev || P.accel;     // 倒车独立加速度（缺省回退全局值）
          var creepAbs = P.creep / 3.6;
          if (this._revHold == null) this._revHold = 0;
          // 已在蠕行速度以上后溜（松开后再按 S）：蠕行窗口视同已过，不叠加迟滞
          if (this._revHold < P.creepRampTime && -this.speed > creepAbs) this._revHold = P.creepRampTime;
          this._revHold += dt;
          if (this._revHold < P.creepRampTime) {
            // 蠕行窗口内：钳极速 + 软接合（液力变矩器缓放，而非满加速度瞬间贴上蠕行速度）
            maxAbs = Math.min(maxAbs, creepAbs);
            accel = Math.min(accel, P.creepAccel || accel);
          } else if (P.accelRampTime > 0) {
            // 拉起段：加速度在 accelRampTime 内从 0 线性渐入，消除窗口结束处的加速度阶跃
            accel *= clamp((this._revHold - P.creepRampTime) / P.accelRampTime, 0, 1);
          }
        } else {
          this._revHold = 0;
        }
        // 钳制只限加速：未超速时正常拉起、到顶钳住；
        // 已超速（后溜中续按）保持滑行不回拍，避免速度被瞬间压回蠕行值的顿挫
        if (this.speed * drive <= maxAbs) {
          this.speed += drive * accel * dt;
          if (this.speed * drive > maxAbs) this.speed = maxAbs * drive;
        }
      }
    } else {
      // 无输入＝刹车：平顺制动至完全停稳
      this._revHold = 0; // 松开倒车键后，下次轻点 S 重新从蠕行开始
      var dv1 = P.brake * dt;
      if (Math.abs(this.speed) <= dv1) this.speed = 0;
      else this.speed -= Math.sign(this.speed) * dv1;
    }

    // --- 运动学积分（后轴参考，与真车一致） ---
    // 偏航率 ω = v·tan(δ)/轴距 以后轴速度定义；后轴沿新航向推进（后轮纯滚动无侧滑），
    // 车几何中心由后轴沿航向前推 _dRear——转陡弯时车中心带真实侧偏角、车尾真实外摆
    if (this.speed !== 0) {
      var f0x = Math.sin(this.heading), f0z = Math.cos(this.heading);
      var rx = this.x - f0x * this._dRear;
      var rz = this.z - f0z * this._dRear;
      var dh = (this.speed / this.car.wheelbase) * Math.tan(this.steer) * dt;
      this.heading = wrapPi(this.heading + dh);
      var f1x = Math.sin(this.heading), f1z = Math.cos(this.heading);
      rx += this.speed * f1x * dt;
      rz += this.speed * f1z * dt;
      this.x = rx + f1x * this._dRear;
      this.z = rz + f1z * this._dRear;
      this.odometer += Math.abs(this.speed) * dt;
    }
    return { speed: this.speed, steer: this.steer, gear: this.gear, heading: this.heading };
  };

  CarPhysics.prototype.isStopped = function () {
    return Math.abs(this.speed) < this.phys.stoppedEps;
  };

  /** 碰撞反弹：速度衰减并反向（纯函数，sim/无头回归与 CarPhysics 共用同一公式） */
  function bounceSpeed(v, phys) {
    var out = -v * phys.bounceFactor;
    return Math.abs(out) < 0.25 ? 0 : out;
  }

  CarPhysics.prototype.bounce = function () {
    this.speed = bounceSpeed(this.speed, this.phys);
  };

  return {
    CarPhysics: CarPhysics,
    clamp: clamp,
    wrapPi: wrapPi,
    bounceSpeed: bounceSpeed
  };
});
