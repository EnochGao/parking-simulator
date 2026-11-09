/* 座舱转向联动 · 渲染自测（浏览器端，?cockpittest=1 触发）
 * 校验方向盘模型 ↔ 前轮的真实联动关系：
 *   - 联动目标角 = -前轮角 × steerVisualRatio（7.5），方向一致（左转→方向盘逆时针）
 *   - 视觉层以 steerVisualRate 为转速上限追踪目标角（上限须高于物理打轮/回正速率
 *     换算值，正常驾驶即时到位、松手即停；对自测直设转角的跳变起平滑作用），
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
    var cap = CAR.steerVisualRate;   // 与 carRig 同读 config 单源（旧 || 300*D2R 兜底是历史上的错误值）
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

    /* ---- 车内视角鼠标拖盘：接手当前盘位 → 顺时针拖拽=右转 → 物理跟轮 → 松手保持 ---- */
    var wc = g.wheelScreenCenter();
    var cnv = g.renderer.domElement.getBoundingClientRect();
    check('抓盘：空白处按下不接管', !g.wheelGrabAt(cnv.left + cnv.width * 0.92, cnv.top + cnv.height * 0.08));
    /* 此处物理转角仍为上一段的 1/3 左舵：抓盘须从盘的实际位置接管（模拟量同步为当前盘位） */
    check('抓盘：盘心命中并接管', g.wheelGrabAt(wc.x, wc.y) === true);
    check('抓盘：模拟量接手当前盘位（1/3 左舵 → +1/3）',
      Math.abs(g.touchAnalog.steer - g.carP.steer / CAR.maxSteer) < 1e-9, String(g.touchAnalog.steer.toFixed(3)));
    g.wheelRelease();
    g.carP.steer = 0; g.touchAnalog.steer = 0;   // 回正后重抓，测拖拽主链路
    check('重抓：起点回正 → 模拟量 0', g.wheelGrabAt(wc.x, wc.y) === true && g.touchAnalog.steer === 0);
    /* 绕盘心顺时针拉 90°（屏幕 y 向下，顺时针=极角增大）→ 模拟量 -1/3 → 前轮右转 12°。
     * 首个触点就在盘心（极角发散）：该事件只建立参考点，后续顺时针增量正常累积 */
    g.wheelDragTo(wc.x, wc.y + 120);
    g.wheelDragTo(wc.x - 120, wc.y + 120);
    g.wheelDragTo(wc.x - 120, wc.y);
    check('拖盘：顺时针拖拽写入负模拟量（右转）', g.touchAnalog.steer < -0.3,
      String(g.touchAnalog.steer.toFixed(3)));
    var steerDeg0 = g.carP.steer / D2R;
    for (i = 0; i < 30; i++) g.stepPhysics();   // 0.5s：前轮朝 -12° 打到位
    check('拖盘：前轮跟随模拟量右转（' + steerDeg0.toFixed(1) + '°→' + (g.carP.steer / D2R).toFixed(1) + '°）',
      g.carP.steer < -8 * D2R, deg(g.carP.steer));
    g.wheelRelease();
    var held = g.touchAnalog.steer;
    g.wheelDragTo(wc.x + 200, wc.y);          // 松手后拖拽必须无效
    check('松手：保持转角且拖拽不再生效', g._wheelDrag === null && g.touchAnalog.steer === held);
    for (i = 0; i < 60; i++) g.stepPhysics();   // 再走 1s：转角不因无输入而变（holdSteer）
    check('松手：前轮维持右转不自动回正', g.carP.steer < -8 * D2R, deg(g.carP.steer));
    g.touchAnalog.steer = 0;                    // 清理模拟量（"还原"段回正物理转角）

    /* ---- 还原 ---- */
    g.carP.steer = 0; g.updateVisuals(FRAME);

    var allPass = checks.every(function (c3) { return c3.pass; });
    return { allPass: allPass, report: checks };
  }

  return { run: run };
});
