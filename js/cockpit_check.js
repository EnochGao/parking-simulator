/* 座舱转向联动 · 渲染自测（浏览器端，?cockpittest=1 触发）
 * 校验方向盘模型 ↔ 前轮的真实联动关系：
 *   - 联动目标角 = -前轮角 × steerVisualRatio（7.5），方向一致（左转→方向盘逆时针）
 *   - 视觉层以 steerVisualRate（300°/s，真实打轮手速量级）为转速上限平滑追踪目标角，
 *     稳态（保持转向/回正到位）时与目标角完全一致——"看得出回正"且联动不失真
 *   - 物理闭环：steer>0 前进时车头向车左偏转；松开方向自动回正
 *   - 车标：挂在方向盘组上随盘转动，凸出在驾驶员侧 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.PS = root.PS || {}; root.PS.CockpitCheck = api; }
})(typeof self !== 'undefined' ? self : this, function () {

  function run(game) {
    var g = game, CAR = g.cfg.CAR, D2R = Math.PI / 180;
    var checks = [];
    function check(name, pass, detail) { checks.push({ name: name, pass: !!pass, detail: detail || '' }); }

    g.loadLevel('lv01', 'play');
    g.hud.hideScreen();
    g.state = 'playing';
    g.carP.speed = 0; g.carP.steer = 0;

    var wheel = g.rig.cockpit.wheelGroup;
    var emblem = wheel.getObjectByName('emblem');
    var frontWheels = g.rig.car.frontWheels;
    var ratio = CAR.steerVisualRatio;
    var cap = CAR.steerVisualRate || 300 * D2R;
    var deg = function (r) { return (r * 180 / Math.PI).toFixed(1) + '°'; };
    var FRAME = 1 / 60, settleN = Math.ceil((CAR.maxSteer * ratio) / (cap * FRAME)) + 10;

    /* ---- 回正对齐：平滑追踪收敛到 0° ---- */
    g.carP.steer = 0; g.carP.speed = 0;
    for (var i = 0; i < settleN; i++) g.updateVisuals(FRAME);
    check('回正：方向盘收敛到 0°', Math.abs(wheel.rotation.z) < 1e-9, deg(wheel.rotation.z));
    check('回正：前轮转角 0', frontWheels.every(function (w) { return w.rotation.y === 0; }), deg(frontWheels[0].rotation.y));
    check('回正：车标直立（无附加转角）', !!emblem && emblem.rotation.z === 0);

    /* ---- 满舵左：目标 -270°，视觉层限速追踪后精确到位 ---- */
    g.carP.steer = CAR.maxSteer;
    var prev = wheel.rotation.z, maxObs = 0;
    for (i = 0; i < settleN; i++) {
      g.updateVisuals(FRAME);
      var stepDeg = Math.abs(wheel.rotation.z - prev) / FRAME / D2R;
      if (Math.abs(wheel.rotation.z - prev) > 1e-9) maxObs = Math.max(maxObs, stepDeg);
      prev = wheel.rotation.z;
    }
    var expect = -CAR.maxSteer * ratio;
    check('满舵左：方向盘收敛到 -270°（传动比 7.5）', Math.abs(wheel.rotation.z - expect) < 1e-9, deg(wheel.rotation.z));
    check('限速：方向盘转速 ≤' + (cap / D2R).toFixed(0) + '°/s（真实打轮手速量级）',
      maxObs <= cap / D2R + 0.01, '峰值 ' + maxObs.toFixed(0) + '°/s');
    check('方向：左转时方向盘逆时针（rotation.z<0，轮缘顶部向驾驶员左侧）', wheel.rotation.z < 0);

    /* ---- 阿克曼前轮：内轮角 > 名义轮角 > 外轮角（真车转向梯形，60% 系数） ---- */
    var dDeg = CAR.maxSteer / D2R;
    var a0 = frontWheels[0].rotation.y / D2R, a1 = frontWheels[1].rotation.y / D2R;
    check('阿克曼：满舵内轮 > 名义 ' + dDeg.toFixed(0) + '° > 外轮',
      Math.max(a0, a1) > dDeg && Math.min(a0, a1) < dDeg,
      '内 ' + Math.max(a0, a1).toFixed(1) + '° / 外 ' + Math.min(a0, a1).toFixed(1) + '°');
    check('阿克曼：两轮均朝转向侧（符号与 steer 一致）',
      Math.sign(frontWheels[0].rotation.y) === Math.sign(g.carP.steer) &&
      Math.sign(frontWheels[1].rotation.y) === Math.sign(g.carP.steer));

    /* ---- 中间档线性：1/3 舵 → 收敛到 -90° ---- */
    g.carP.steer = CAR.maxSteer / 3;
    for (i = 0; i < settleN; i++) g.updateVisuals(FRAME);
    check('1/3 舵：方向盘收敛到 -90°（线性随动）', Math.abs(wheel.rotation.z + 90 * D2R) < 1e-9, deg(wheel.rotation.z));

    /* ---- 物理闭环：方向盘→车轮→车身一致，松手自动回正 ---- */
    var c = new g.PS.Physics.CarPhysics({ car: CAR, phys: g.cfg.PHYS }, { x: 0, z: 0, heading: 0 });
    for (i = 0; i < 120; i++) c.update(1 / 60, { drive: 1, steer: 1 });
    check('物理：左转输入使车头向车左偏转（heading 朝 +x 增大）', c.heading > 0.1, deg(c.heading));
    for (i = 0; i < 240; i++) c.update(1 / 60, { drive: 1, steer: 0 });
    check('物理：松开方向前轮自动回正', Math.abs(c.steer) < 1e-6, deg(c.steer));

    /* ---- 车标/12点标线：随盘转动、凸出驾驶员侧、回正时在正上方 ---- */
    check('车标挂在方向盘组上（随盘转动）', !!emblem && emblem.parent === wheel);
    var minZ = 0;
    if (emblem) emblem.traverse(function (o) {
      if (o.isMesh) {
        var d = (o.geometry.parameters && o.geometry.parameters.depth) || 0;
        minZ = Math.min(minZ, o.position.z - d / 2);
      }
    });
    check('车标凸出在驾驶员侧（局部 -z）', !!emblem && minZ < -0.02, 'minZ=' + minZ.toFixed(4));
    var stripe = wheel.getObjectByName('centerStripe');
    check('12 点回正标线在轮缘正上方（回正时）', !!stripe && stripe.parent === wheel &&
      Math.abs(stripe.position.x) < 1e-9 && Math.abs(stripe.position.y - 0.175) < 1e-9,
      stripe ? ('x=' + stripe.position.x.toFixed(3) + ' y=' + stripe.position.y.toFixed(3)) : '缺失');

    /* ---- 还原 ---- */
    g.carP.steer = 0; g.updateVisuals(FRAME);

    var allPass = checks.every(function (c3) { return c3.pass; });
    return { allPass: allPass, report: checks };
  }

  return { run: run };
});
