/* 全局参数配置（Node/浏览器双端通用） */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.PS = root.PS || {}; api.CONFIG = api; Object.assign(root.PS, api); }
})(typeof self !== 'undefined' ? self : this, function () {
  var D2R = Math.PI / 180;
  return {
    D2R: D2R,
    CAR: {
      // 本田飞度 第四代 GR9（2021款 1.5L CVT）公开参数：
      // 4109×1694×1537mm，轴距 2530mm，前/后轮距 1480/1465mm，整备质量 1088kg，
      // L15BU 1.5L 自吸 96kW(131Ps)/155N·m，CVT 前驱，轮胎 185/60 R15，
      // 最小转弯半径约 4.9m（前外轮轮迹）→ 反推前轮最大转角（见 maxSteer 注释）
      length: 4.109,        // 车长 m
      width: 1.694,         // 车宽 m
      height: 1.537,        // 车高 m（外观模型参考；碰撞 OBB 只用车长/车宽）
      wheelbase: 2.53,      // 轴距 m
      frontOverhang: 0.84,  // 前悬 m（与 carModel.js/物理后轴参考共用；后悬=长-前悬-轴距≈0.74）
      trackF: 1.48,         // 前轮距 m
      trackR: 1.465,        // 后轮距 m
      tireR: 0.3015,        // 轮胎滚动半径 m（185/60 R15：直径≈603mm）
      maxSteer: 36 * D2R,   // 前轮最大转角：由最小转弯半径 4.9m 反推
                            // R=√((L/tanδ+trackF/2)²+L²)=4.9 → δ≈36.2°，取整 36°
      steerVisualRatio: 270 / 36, // 方向盘视觉转角/前轮转角（满舵 ±270°）
      steerVisualRate: 300 * D2R, // 方向盘视觉转速上限 rad/s（≈真实打轮手速量级；前轮 55°/s×7.5=412°/s
                                  // 过快，视觉层以该上限平滑追踪目标角，稳态仍与车轮严格联动）
      seatX: 0.36, seatY: 1.16, seatZ: 0.05 // 驾驶员眼位(车体局部坐标, 左舵)
    },
    PHYS: {
      maxFwd: 15 / 3.6,     // 前进极速 m/s
      maxRev: 10 / 3.6,     // 倒车极速
      fixedDt: 1 / 60,     // 固定物理步长（游戏壳层步进 / 演示重放 / 录像"帧序即时间"的唯一来源；
                            // 改步频需连 input.js 录像带语义与 demo_paths 重解一起考虑）
      accel: 3.0,           // 油门加速度
      brake: 6.0,           // 制动减速度
      drag: 0.6,            // 自然阻力（仅 pulse.js 演示/规划积分使用；玩家侧松开即刹车，不走此项）
      steerRate: 55 * D2R,  // 前轮转向速率 rad/s（演示/引导路径经 pulse.js 与此耦合，改值需重算 solver）
      centerRate: 70 * D2R, // 回正速率（同上）
      handbrakeDecel: 9,
      bounceFactor: 0.3,
      stoppedEps: 0.04,
      gearSwitchMaxSpeed: 0.2,
      creep: 1.4,           // 自动挡蠕行速度 km/h（挂 R 轻点 S 的保持速度；physics.js 按 creep/3.6 换算 m/s 使用）
      demoSpeed: 1.4,       // 演示/规划路径车速 m/s（pulse.js 直接使用；与 creep 数值巧合相同但单位不同——
                            // 玩家蠕行实为 creep/3.6≈0.39 m/s。两值单位不同不可互改，改 demoSpeed 需重算关卡演示脚本 npm run solver）
      creepRampTime: 0.6,   // 持续按住倒车键超过该时长后，从蠕行平滑加速到倒车极速（此前轻点＝蠕行对位）
      creepAccel: 1.2,      // 倒车蠕行接合加速度 m/s²（0→蠕行速度约 0.33s，模拟液力变矩器缓放；
                            // 用全局 accel 3.0 会在 0.13s 内瞬间贴上蠕行速度，起步发"咣"）
      accelRev: 2.2,        // 倒车加速段加速度 m/s²（前进保持 accel；倒车更线性，0.6s 后不蹿）
      accelRampTime: 0.4    // 蠕行窗口结束后加速度线性渐入时长 s（从 0 渐入到 accelRev，消除 jerk 阶跃）
    },
    RADAR: {
      range: 2.5,           // 报警半径 m（对标真车 2.5m 间歇音）
      urgent: 0.7           // 急促音距离 m
    },
    QUALITY: {
      mirrorRtW: 384,       // 外后视镜渲染目标宽 px（高按镜片宽高比推）
      revRtW: 320, revRtH: 180,   // 倒车影像渲染目标
      /* 触屏档（手机/平板 GPU 预算）：game.js 检测触屏后在首帧前套用——
       * pixelRatio 与阴影贴图直接设到渲染器，RT 尺寸写回本节单值（cockpit 读 PS.QUALITY） */
      touch: {
        pixelRatioMax: 1.25,
        shadowSize: 1024,
        mirrorRtW: 256,
        revRtW: 240, revRtH: 135
      }
    },
    GAMEPAD: {
      deadzone: 0.08,          // 左摇杆死区（归零阈值）
      triggerThreshold: 0.12,  // RT/LT 扳机触发阈值（0..1 模拟量）
      stickAsPad: 0.6,         // 左摇杆视为十字键的幅度（菜单导航/后视镜调节）
      navRepeat: 0.18,         // 菜单焦点移动连发间隔 s
      rumbleMs: 260            // 碰撞震动时长 ms
    },
    SCORE: {
      posFullM: 0.15,       // 位置满分偏差
      posPerCm: 1, posMaxPts: 40,
      angFullDeg: 3, angPerDeg: 2, angMaxPts: 30,
      colFirst: 10, colEach: 5, colMaxPenalty: 30,
      timeBonusMax: 10,
      passScore: 50,
      completeAngleDeg: 15, // 完成允许最大角度偏差
      stopTime: 1.5,        // 停稳判定时长
      maxCollisions: 5      // 强制失败碰撞数
    },
    VIEW: { fov: 72, mirrorFov: 40, inMirrorFov: 30, revFov: 100, near: 0.12, far: 220 }
    // fov: 主相机垂直视场角（72° 接近真实车内透视）；mirrorFov/inMirrorFov/revFov 统一为
    // "垂直视场角"约定，渲染宽高比取各自镜面/屏面的实际宽高比（见 cockpit.js），
    // 内镜 3.2:1 扁长镜片因此呈现宽幅后窗视野而非水平拉伸画面；
    // revFov 100（水平≈130°）：对标真实倒车影像的广角（130°+），保证车尾后 0.3m 起近地可见
  };
});
