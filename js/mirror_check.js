/* 后视镜/倒车影像 · 渲染回读自测（浏览器端，?mirrortest=1 触发）
 * 原理：在车后已知位置放置独色标记物，把各面镜子的渲染目标逐像素回读，
 * 定位标记质心，按真实镜面/倒车影像惯例断言：
 *   - 镜像方向（水平翻转）：倒影"车左后→画面左"；内镜同侧一致；
 *     外镜自车车身贴内缘（若未镜像车身会跑到外缘）
 *   - 上下不翻转（高物在上）
 *   - 倒影屏 R 挡门控（D 灭 / R 亮 / 开关可关）
 *   - 视场分区与盲区（左后物体只在左镜、右后只在右镜）
 *   - 近地覆盖（车尾后 0.35m 地面可见，近物在画面下方）
 *   - 渲染目标与显示面宽高比统一（无拉伸失真） */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.PS = root.PS || {}; root.PS.MirrorCheck = api; }
})(typeof self !== 'undefined' ? self : this, function () {

  function run(game) {
    var g = game, T = window.THREE, CAR = g.cfg.CAR;
    var checks = [];
    function check(name, pass, detail) { checks.push({ name: name, pass: !!pass, detail: detail || '' }); }

    /* ---- 场景准备：lv01 教学关后方空旷，车位姿 (0,-10) 车头 +z（局部系=世界系平移） ---- */
    g.loadLevel('lv01', 'play');
    g.hud.hideScreen();
    g.state = 'playing';
    g.carP.x = 0; g.carP.z = -10; g.carP.heading = 0; g.carP.speed = 0; g.carP.steer = 0;
    g.assist.top = false; g.assist.revCam = true;
    g.updateVisuals(1 / 60);

    var REAR = -CAR.length / 2;                    // 车尾平面（局部 z）
    var markers = [];
    function marker(color, x, y, z, sy) {          // 位置为世界坐标（车头 +z，车左 +x）
      var m = new T.Mesh(new T.BoxGeometry(0.5, sy || 0.5, 0.5),
        new T.MeshBasicMaterial({ color: color, fog: false }));
      m.position.set(x, y, z);
      g.scene.add(m);
      markers.push(m);
    }
    marker(0xff00ff, 2, 0.9, -16.5);               // mL 车左后 2m
    marker(0x00ffff, -2, 0.9, -16.5);              // mR 车右后 2m
    marker(0xff44cc, 0, 0.25, -16.0);              // mG 正后方地面（车尾后 3.95m）
    marker(0xffff00, 0, 1.6, -16.9, 3.2);          // mH 正后方高柱（0~3.2m）
    marker(0xff0088, 0, 0.25, -10 + REAR - 0.35);  // mN 车尾后 0.35m 地面
    marker(0x0088ff, 0, 0.25, -10 + REAR - 2.0);   // mM 车尾后 2.0m 地面

    var extL = g.rig.mirrorH.mirrors[0], extR = g.rig.mirrorH.mirrors[1], intM = g.rig.mirrorH.mirrors[2];
    var revRt = g.rig.mirrorH.revRt, revPlane = g.rig.mirrorH.revPlane, revCam = g.rig.mirrorH.revCam;

    /* ---- 1. 宽高比统一：渲染目标 = 显示面比例（无拉伸失真） ---- */
    [[extL, 0], [extR, 1], [intM, 2]].forEach(function (p) {
      var m = p[0], pa = m.plane.geometry.parameters.width / m.plane.geometry.parameters.height;
      var ra = m.rt.width / m.rt.height;
      check('镜' + p[1] + ' 渲染目标比例=镜面比例', Math.abs(ra - pa) / pa < 0.02,
        ra.toFixed(3) + ' vs ' + pa.toFixed(3));
    });
    var revPa = revPlane.geometry.parameters.width / revPlane.geometry.parameters.height;
    check('倒影屏 渲染目标比例=屏面比例',
      Math.abs(revRt.width / revRt.height - revPa) / revPa < 0.02,
      (revRt.width / revRt.height).toFixed(3) + ' vs ' + revPa.toFixed(3));

    /* ---- 2. 水平镜像标志（真实镜面翻转；倒影同惯例） ---- */
    [extL, extR, intM].forEach(function (m, i) {
      check('镜' + i + ' plane.scale.x=-1（镜像翻转）', m.plane.scale.x === -1);
    });
    check('倒影屏 plane.scale.x=-1（镜像翻转）', revPlane.scale.x === -1);

    /* ---- 3. 倒影屏 R 挡门控（真实车辆：挂 R 才亮） ---- */
    g.carP.gear = 'D'; g.updateVisuals(1 / 60);
    check('D 挡倒影屏熄灭', revPlane.visible === false);
    g.carP.gear = 'R'; g.updateVisuals(1 / 60);
    check('R 挡倒影屏点亮', revPlane.visible === true);
    g.assist.revCam = false; g.updateVisuals(1 / 60);
    check('关闭倒影开关后熄灭', revPlane.visible === false);
    g.assist.revCam = true; g.updateVisuals(1 / 60);

    /* ---- 渲染一帧并回读 ---- */
    g.rig.mirrorH.render(g.renderer, g.scene, true);
    /** 在渲染目标里找指定颜色标记：返回显示坐标质心（x 已按镜像翻转为"屏上所见"，
     *  y 已翻转为图像坐标：0=画面顶部）。找不到返回 null */
    function findIn(rt, color) {
      var w = rt.width, h = rt.height, buf = new Uint8Array(w * h * 4);
      g.renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
      var cr = (color >> 16) & 255, cg = (color >> 8) & 255, cb = color & 255;
      var sx = 0, sy = 0, n = 0;
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var i = (y * w + x) * 4;
          if (Math.abs(buf[i] - cr) <= 8 && Math.abs(buf[i + 1] - cg) <= 8 && Math.abs(buf[i + 2] - cb) <= 8) {
            sx += w - 1 - x;          // 显示 x：plane.scale.x=-1 的镜像翻转
            sy += h - 1 - y;          // 图像 y：WebGL 行序自下而上
            n++;
          }
        }
      }
      return n ? { n: n, fx: sx / n / w, fy: sy / n / h } : null;
    }
    var vL = findIn(extL.rt, 0xff00ff), vR = findIn(extR.rt, 0x00ffff);
    var vRinL = findIn(extL.rt, 0x00ffff), vLinR = findIn(extR.rt, 0xff00ff);
    var iL = findIn(intM.rt, 0xff00ff), iR = findIn(intM.rt, 0x00ffff);
    var iG = findIn(intM.rt, 0xff44cc), iH = findIn(intM.rt, 0xffff00);
    var rL = findIn(revRt, 0xff00ff), rR = findIn(revRt, 0x00ffff);
    var rH = findIn(revRt, 0xffff00), rN = findIn(revRt, 0xff0088), rM = findIn(revRt, 0x0088ff);

    /* ---- 4. 倒影镜像方向（真实倒车影像：车左后→画面左） ---- */
    check('倒影：车左后标记在画面左半', !!rL && rL.fx < 0.5, rL ? ('fx=' + rL.fx.toFixed(2) + ' px=' + rL.n) : '未见');
    check('倒影：车右后标记在画面右半', !!rR && rR.fx > 0.5, rR ? ('fx=' + rR.fx.toFixed(2) + ' px=' + rR.n) : '未见');

    /* ---- 5. 内镜镜像方向且与倒影同侧一致 ---- */
    check('内镜：车左后物体在车右后物体左侧（与倒影同侧）',
      !!iL && !!iR && iL.fx < iR.fx, iL && iR ? (iL.fx.toFixed(2) + ' < ' + iR.fx.toFixed(2)) : '未见');
    check('内镜：车左后物体在画面左半', !!iL && iL.fx < 0.5, iL ? 'fx=' + iL.fx.toFixed(2) : '未见');

    /* ---- 6. 上下不翻转（高物在上） ---- */
    check('内镜：高柱质心高于地面标记', !!iH && !!iG && iH.fy < iG.fy,
      iH && iG ? ('fy ' + iH.fy.toFixed(2) + ' < ' + iG.fy.toFixed(2)) : '未见');
    check('倒影：高柱质心高于地面标记', !!rH && !!rM && rH.fy < rM.fy,
      rH && rM ? ('fy ' + rH.fy.toFixed(2) + ' < ' + rM.fy.toFixed(2)) : '未见');

    /* ---- 7. 外镜视场分区与盲区（左后物体只在左镜出现） ---- */
    check('左镜：车左后标记可见', !!vL && vL.n > 20, vL ? 'px=' + vL.n : '未见');
    check('左镜：车右后标记不可见（分区内）', !vRinL, vRinL ? 'px=' + vRinL.n : '—');
    check('右镜：车右后标记可见', !!vR && vR.n > 20, vR ? 'px=' + vR.n : '未见');
    check('右镜：车左后标记不可见（分区内）', !vLinR, vLinR ? 'px=' + vLinR.n : '—');

    /* ---- 8. 外镜内缘见自车车身（真实外镜特征；未镜像则车身会跑到外缘） ---- */
    (function () {
      var w = extL.rt.width, h = extL.rt.height, buf = new Uint8Array(w * h * 4);
      g.renderer.readRenderTargetPixels(extL.rt, 0, 0, w, h, buf);
      var n = 0;
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w * 0.2; x++) {   // 原始左缘条带 = 显示的内缘
          var i = (y * w + x) * 4, r = buf[i], gg = buf[i + 1], b = buf[i + 2];
          var mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
          if (mn >= 130 && mx - mn <= 40) n++;   // 近白的自车漆面（排除蓝天/路面/砖墙）
        }
      }
      check('左镜内缘可见自车车身', n >= 50, 'n=' + n);
    })();

    /* ---- 9. 倒影近地覆盖（车尾后 0.35m 可见；近物在画面更下方） ---- */
    check('倒影：车尾后 0.35m 地面可见（FMVSS 111 近区惯例）', !!rN, rN ? 'fy=' + rN.fy.toFixed(2) : '未见');
    check('倒影：近处地面在画面更下方（俯视近地）', !!rN && !!rM && rN.fy > rM.fy,
      rN && rM ? (rN.fy.toFixed(2) + ' > ' + rM.fy.toFixed(2)) : '未见');

    /* ---- 10. 内镜覆盖正后近区（泊车职责） ---- */
    check('内镜：正后 3.75m 地面与高柱可见', !!iG && !!iH, iG && iH ? 'OK' : '未见');

    /* ---- 11. 挂载与俯角 ---- */
    check('镜/倒影相机随车移动（挂 carGroup）',
      extL.cam.parent === g.rig.car.group && intM.cam.parent === g.rig.car.group && revCam.parent === g.rig.car.group);
    check('倒影相机俯角 ≥10°', revCam.rotation.x <= -10 * Math.PI / 180, (revCam.rotation.x * 180 / Math.PI).toFixed(0) + '°');

    /* ---- 12. 渲染后可见性逐项还原（防"座舱框消失"回归：镜面渲染会临时隐藏
     * 内饰/内镜壳/遮罩/车顶板，渲染完必须还原——可见性保存区配对错位时
     * 这里会率先失败，主视图座舱不再无声消失） ---- */
    (function () {
      var tracked = g.rig.mirrorH.hideInMirror.concat(intM.hideExtra);
      tracked.forEach(function (o) { o.visible = true; });   // 归一化初态（真实游玩中这些对象均可见），
      var before = tracked.map(function (o) { return o.visible; }); // 防止取样前已被污染导致检查假通过
      g.rig.mirrorH.render(g.renderer, g.scene, false);   // 连续两帧镜面渲染
      g.rig.mirrorH.render(g.renderer, g.scene, false);
      var bad = [];
      tracked.forEach(function (o, i) {
        if (o.visible !== before[i]) bad.push((o.name || o.geometry.type) + '@' + i);
      });
      check('镜面渲染后内饰/镜壳/车顶板可见性逐项还原', bad.length === 0,
        bad.length ? ('未还原: ' + bad.join(',')) : tracked.length + ' 项全部还原');
    })();

    /* ---- 清理：移除标记物，恢复关卡初始状态 ---- */
    markers.forEach(function (m) {
      g.scene.remove(m);
      m.geometry.dispose(); m.material.dispose();
    });
    g.carP.gear = 'D';
    g.carP.x = 0; g.carP.z = -13; g.carP.heading = 0;
    g.updateVisuals(1 / 60);

    var allPass = checks.every(function (c) { return c.pass; });
    return { allPass: allPass, report: checks };
  }

  return { run: run };
});
