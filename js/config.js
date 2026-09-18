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
      length: 4.2,          // 车长 m
      width: 1.75,          // 车宽 m
      wheelbase: 2.55,      // 轴距 m
      maxSteer: 33 * D2R,   // 前轮最大转角
      steerVisualRatio: 270 / 33, // 方向盘视觉转角/前轮转角
      seatX: 0.36, seatY: 1.16, seatZ: 0.05 // 驾驶员眼位(车体局部坐标, 左舵)
    },
    PHYS: {
      maxFwd: 15 / 3.6,     // 前进极速 m/s
      maxRev: 10 / 3.6,     // 倒车极速
      accel: 3.0,           // 油门加速度
      brake: 6.0,           // 制动减速度
      drag: 0.6,            // 自然阻力
      creep: 1.4,           // 自动挡蠕行速度
      steerRate: 55 * D2R,  // 前轮转向速率 rad/s
      centerRate: 70 * D2R, // 回正速率
      handbrakeDecel: 9,
      bounceFactor: 0.3,
      stoppedEps: 0.04,
      gearSwitchMaxSpeed: 0.2
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
    VIEW: { fov: 72, mirrorFov: 40, inMirrorFov: 46, revFov: 80, near: 0.12, far: 220 }
    // fov: 主相机垂直视场角（72° 接近真实车内透视）；mirrorFov/inMirrorFov: 外/内后视镜相机视场，
    // 按 GB 15084（ECE R46）Ⅲ/Ⅰ类视野要求标定并适度放宽以保证可玩性；revFov: 倒影广角
  };
});
