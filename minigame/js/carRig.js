/* js/carRig.js · 微信小游戏模块（tools/build_wx.js 生成，勿手改） */
var window = GameGlobal, self = GameGlobal;   /* UMD 根 → 跨模块共享全局 */
var module, exports, define;                  /* 声明以捕获外层泄露 */
module = exports = define = undefined;        /* 强制浏览器分支（var 对参数式包装无效） */
/* 整车视觉装配（rig）：车身模型 + 座舱 + 三面后视镜 + 倒车影像屏的建/用/释
 * 建车流水线此前内联在 game.loadLevel（模型/座舱/镜组/调节量恢复/相机挂载），
 * 单车表现（姿态同步/阿克曼前轮/方向盘/仪表/刹车灯/转向灯）内联在 updateVisuals。
 * 收编为 rig 后：建一台车 = build 一次，释放 = dispose 一次（显存不泄漏），
 * 后续幽灵车/对手车只是多 build 一个 rig，主壳不再关心装配细节。仅浏览器端。 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.PS = root.PS || {}; root.PS.CarRig = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  var D2R = Math.PI / 180;

  /* 深度释放一棵对象树的 GPU 资源：three.js 里 scene.remove 只解除场景引用，
   * 几何体/材质不显式 dispose 会一直滞留显存——每次换关/重开都重建整车+座舱，
   * 不释放则反复游玩持续累积。只释放几何体与材质本身；材质引用的贴图
   * （如模块级缓存的仪表 CanvasTexture）生命周期独立，不在此处置。 */
  function disposeDeep(rootObj) {
    rootObj.traverse(function (o) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        var mats = Array.isArray(o.material) ? o.material : [o.material];
        for (var i = 0; i < mats.length; i++) mats[i].dispose();
      }
    });
  }

  /**
   * build(opts):
   *   scene/renderer: 渲染目标
   *   cfg:  PS.CONFIG
   *   pose: {x, z, a(度)} 出车姿态
   *   camera: 主相机（可选，挂进车组作第一人称眼位；幽灵车不传）
   *   mirrorAdj: [{y,p}x3] 后视镜调节量（跨关卡保留，换车恢复）
   * 返回 rig: {group, car, cockpit, mirrorH, sync(), dispose(), onDirty}
   */
  function build(opts) {
    var PS = window.PS;
    var cfg = opts.cfg;
    var scene = opts.scene, renderer = opts.renderer;
    var pose = opts.pose;

    var car = PS.CarModel.buildPlayerCar();
    car.group.position.set(pose.x, 0, pose.z);
    car.group.rotation.y = pose.a * D2R;
    scene.add(car.group);

    var cockpit = PS.Cockpit.buildInterior(car.group);
    /* 渲染镜面画面时隐藏内饰 → 镜中可见封闭车身侧面/后轮（舱玻璃保留，
     * 左右外镜相机均在车外，镜中呈现带玻璃的完整车身；车内镜相机在盒体
     * 内部，背面剔除后画面不受影响）；
     * 车内后视镜画面额外隐藏车顶板（否则镜中一大片是自家车顶+车尾） */
    var mirrorH = PS.Cockpit.buildMirrors(car.group, renderer, [cockpit.interior], [car.roof]);
    /* 倒车影像屏挂在中控台（车内居中 x=0），随头转动保持真实车内位置；
     * 作为 interior 子对象，镜面/倒车渲染隐藏内饰时自动一同隐藏 */
    cockpit.interior.add(mirrorH.revPlane);
    /* 恢复此前保留的后视镜调节量（换关卡不重置） */
    if (opts.mirrorAdj) {
      for (var mi = 0; mi < mirrorH.mirrors.length; mi++) {
        mirrorH.mirrors[mi].adjYaw = opts.mirrorAdj[mi].y;
        mirrorH.mirrors[mi].adjPitch = opts.mirrorAdj[mi].p;
        mirrorH.mirrors[mi].apply();
      }
    }
    if (opts.camera) {
      car.group.add(opts.camera);
      opts.camera.position.set(cfg.CAR.seatX, cfg.CAR.seatY, cfg.CAR.seatZ);
      opts.camera.rotation.set(0, 0, 0);
    }

    var rig = {
      group: car.group, car: car, cockpit: cockpit, mirrorH: mirrorH,
      onDirty: null,          // 镜面/倒影 RT 需重绘时回调（壳层置脏标志）
      _lastBrakeCol: 0, _lastIndL: 0, _lastIndR: 0
    };

    /**
     * 单车表现同步（每渲染帧调一次，与物理步频无关）：
     * 姿态、阿克曼前轮、方向盘随动限速、仪表、刹车灯、转向灯闪烁与自动回位。
     * indicator: {side, timer, peak} 由壳层持有（gamepad 也要读写 side），此处就地推进。
     */
    rig.sync = function (carP, input, elapsed, indicator) {
      var CAR = cfg.CAR;
      car.group.position.set(carP.x, 0, carP.z);
      car.group.rotation.y = carP.heading;

      /* 前轮转向可视化：阿克曼几何——内侧轮转角大于外侧（真车转向梯形）。
       * δ 为自行车模型轮角（两轮名义平均），瞬时半径 R=轴距/tan|δ|，
       * 理想内外轮角 = atan(轴距/(R∓轮距/2))；取 60% 阿克曼系数折中观感（无轮 wells 建模） */
      var fw = carP.steer;
      if (Math.abs(fw) > 1e-4) {
        var RTurn = CAR.wheelbase / Math.tan(Math.abs(fw));
        var tf2 = CAR.trackF / 2;
        var aInner = Math.atan(CAR.wheelbase / Math.max(0.3, RTurn - tf2));
        var aOuter = Math.atan(CAR.wheelbase / (RTurn + tf2));
        var kAck = 0.6;
        var angIn = fw + (Math.sign(fw) * aInner - fw) * kAck;
        var angOut = fw + (Math.sign(fw) * aOuter - fw) * kAck;
        var iIn = fw > 0 ? 1 : 0;                 // 内侧轮：左转=左轮（车左 = +trackF/2 侧）
        car.frontWheels[iIn].rotation.y = angIn;
        car.frontWheels[1 - iIn].rotation.y = angOut;
      } else {
        car.frontWheels[0].rotation.y = 0;
        car.frontWheels[1].rotation.y = 0;
      }

      /* 方向盘随转向输入旋转（传动比见 steerVisualRatio）。
       * 视觉层以 steerVisualRate 为转速上限追踪目标角：上限高于物理打轮/回正速率
       * 换算到方向盘的速度（见 config 注释），正常驾驶时方向盘每帧即时到位——
       * 松开方向键物理转角冻结，视觉盘同步停住，无"松手还在转"的延迟感；
       * 上限仅对回放/自测中转角跳变起平滑作用 */
      var target = -fw * (CAR.steerVisualRatio || 8);
      var wheel = cockpit.wheelGroup;
      var d = target - wheel.rotation.z;
      var maxStep = (CAR.steerVisualRate || 560 * D2R) * elapsed;
      if (Math.abs(d) <= maxStep) wheel.rotation.z = target;
      else wheel.rotation.z += (d > 0 ? 1 : -1) * maxStep;

      /* 仪表盘实时刷新（转速/时速指针；数值不变不重绘） */
      if (cockpit.updateGauges) cockpit.updateGauges(Math.abs(carP.speed) * 3.6, carP.gear);

      /* 刹车灯：手刹 / 松开油门滑行刹车中 / 前进中挂倒车减速（键盘与手柄统一看 input.drive）。
       * 阈值统一用 PHYS.stoppedEps：与"停稳"判定同一口径，0.04–0.05 之间不再出现
       * "车已停稳刹车灯仍亮"的错位 */
      var spd = carP.speed;
      var STOP_EPS = cfg.PHYS.stoppedEps || 0.04;
      var braking = input.handbrake ||
        (input.drive === 0 && Math.abs(spd) > STOP_EPS) ||
        (input.drive < 0 && spd > STOP_EPS);
      var bl = braking ? car.brakeOn : car.brakeOff;
      if (bl !== rig._lastBrakeCol) {
        rig._lastBrakeCol = bl;
        car.brakeLights.forEach(function (l) { l.material.color.setHex(bl); });
        if (rig.onDirty) rig.onDirty();   // 刹车灯入镜，色变才重绘镜面 RT
      }

      /* 转向灯闪烁（色变才写材质；闪烁沿同时标脏镜面 RT） */
      indicator.timer += elapsed;
      var on = indicator.side !== 0 && (Math.floor(indicator.timer / 0.45) % 2 === 0);
      var lHex = (indicator.side === 1 && on) ? car.indOn : car.indOff;
      var rHex = (indicator.side === 2 && on) ? car.indOn : car.indOff;
      if (lHex !== rig._lastIndL || rHex !== rig._lastIndR) {
        rig._lastIndL = lHex; rig._lastIndR = rHex;
        car.indicators.l.material.color.setHex(lHex);
        car.indicators.r.material.color.setHex(rHex);
        if (rig.onDirty) rig.onDirty();
      }
      /* 转向灯自动回位熄灭：打过实方向（峰值>12°）后方向盘回到 ±4° 内，
       * 与真实车拨杆回位一致——防止新手打完灯忘关 */
      if (indicator.side) {
        var steerAbs = Math.abs(carP.steer);
        if (indicator.peak == null) indicator.peak = 0;
        if (steerAbs > indicator.peak) indicator.peak = steerAbs;
        if (indicator.peak > 12 * D2R && steerAbs < 4 * D2R) {
          indicator.side = 0;
          indicator.peak = null;
        }
      } else {
        indicator.peak = null;
      }
    };

    rig.dispose = function () {
      mirrorH.dispose();        // 镜面/倒影 RT 纹理
      disposeDeep(car.group);   // 先释放 GPU 资源（scene.remove 不回收显存）
      scene.remove(car.group);
    };

    return rig;
  }

  return { build: build, disposeDeep: disposeDeep };
});