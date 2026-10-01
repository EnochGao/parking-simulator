/* 第一人称驾驶舱：复刻本田飞度 GR9 座舱布局——三段抬升式低仪表台、双幅方向盘、
 * 7 寸液晶仪表、悬浮中控屏（倒车影像）、贯穿式出风口、三后视镜（实时渲染到纹理，镜像翻转） */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.PS = root.PS || {}; root.PS.Cockpit = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  var D2R = Math.PI / 180;

  function dark(color) { return new THREE.MeshLambertMaterial({ color: color || 0x24262b }); }

  /* ---- 7 寸液晶仪表（GR9 标志配置）：CanvasTexture 绘制齿位/车速，仅数值变化时重绘 ---- */
  var gaugeCanvas = null, gaugeCtx = null, gaugeTex = null, gaugeKmh = -1, gaugeGear = '';

  function ensureGauge() {
    if (gaugeCanvas) return true;
    if (typeof document === 'undefined') return false;
    gaugeCanvas = document.createElement('canvas');
    gaugeCanvas.width = 384; gaugeCanvas.height = 160;
    gaugeCtx = gaugeCanvas.getContext('2d');
    gaugeTex = new THREE.CanvasTexture(gaugeCanvas);
    return true;
  }

  function drawGauge(kmh, gear) {
    var c = gaugeCtx;
    // 内容全部画在画布上部：轮缘会自然遮住仪表屏底部约 1/3（与真车一致），
    // 关键信息（齿位/车速）保持在轮辐上沿以上的可视带内
    c.fillStyle = '#0a0f14'; c.fillRect(0, 0, 384, 160);
    c.fillStyle = 'rgba(110,170,225,0.5)'; c.fillRect(16, 12, 352, 2); // 顶部冷色饰线
    c.textAlign = 'center'; c.textBaseline = 'middle';
    // 左：齿位框
    c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = 3;
    c.strokeRect(20, 24, 58, 70);
    c.fillStyle = '#eef6ff';
    c.font = '700 44px Arial, sans-serif';
    c.fillText(gear, 49, 59);
    // 中：分隔细线
    c.fillStyle = 'rgba(120,150,180,0.35)'; c.fillRect(94, 24, 2, 70);
    // 右：车速数字 + 单位
    c.fillStyle = '#f2f7fc';
    c.font = '700 72px Arial, sans-serif';
    c.fillText(String(kmh), 218, 58);
    c.fillStyle = '#8fa3b8';
    c.font = '400 20px Arial, sans-serif';
    c.fillText('km/h', 330, 58);
    if (gaugeTex) gaugeTex.needsUpdate = true;
  }

  function updateGauges(kmh, gear) {
    if (!ensureGauge()) return;
    var k = Math.max(0, Math.round(kmh || 0));
    var g = gear || 'P';
    if (k === gaugeKmh && g === gaugeGear) return;
    gaugeKmh = k; gaugeGear = g;
    drawGauge(k, g);
  }

  /** 构建舱内结构（作为玩家车 group 的子对象）。
   *  布局以驾驶员眼位 (seatX,seatY,seatZ)=(0.36,1.16,0.05) 为基准，复刻飞度 GR9 座舱：
   *  - 三段抬升式仪表台：近段在膝部（0.80），经中段（0.885）抬升到远段 cowl（0.95）——
   *    高座椅 + 短车头 + 下倾引擎盖，越过台面可见白色引擎盖与雨刮，与真车第一人称视野一致；
   *  - 双幅式方向盘（GR9 标志性设计），上半圈完全开放，液晶仪表从轮辐上方完整露出；
   *  - 7 寸液晶仪表立在中段台面上，8 寸悬浮中控屏居中，上方贯穿式出风口 + 银色饰条横贯；
   *  - A 柱收窄为风挡两角细饰柱（飞度以细 A 柱大视野著称），车顶前缘入画形成风挡上沿。 */
  function buildInterior(carGroup) {
    var interior = new THREE.Group();
    var dm = dark(), dm2 = dark(0x32353c);

    // 三段抬升式仪表台（全部收在舱玻璃盒内 z≤1.10，不外露）：
    // 近段顶 0.80（露出方向盘下半圈与两幅辐条）→ 中段顶 0.885 → 远段 cowl 顶 0.95
    // ——cowl 与眼位（1.16）的高差让视线越过台面落到下倾的引擎盖上（真飞度视野）
    var dashNear = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.16, 0.30), dm);
    dashNear.position.set(0, 0.72, 0.62);
    interior.add(dashNear);
    var dashMid = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.14, 0.30), dm);
    dashMid.position.set(0, 0.815, 0.885);
    interior.add(dashMid);
    var dashFar = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.14, 0.16), dm);
    dashFar.position.set(0, 0.88, 1.02);
    interior.add(dashFar);

    // 贯穿式空调出风口 + 银色翼形饰条（贴远段台面前立面，横贯整个仪表台——飞度家族设计）
    var vent = new THREE.Mesh(new THREE.BoxGeometry(1.30, 0.04, 0.018), dark(0x14161a));
    vent.position.set(0, 0.925, 0.9305);
    interior.add(vent);
    var trim = new THREE.Mesh(new THREE.BoxGeometry(1.30, 0.012, 0.008),
      new THREE.MeshLambertMaterial({ color: 0x9aa0a6 }));
    trim.position.set(0, 0.893, 0.9355);
    interior.add(trim);

    // （舱内地板由外观模型的座舱段提供：地板下沉铺深色，此处不再重复铺设）

    // 左右门板上部 + 扶手（真实车内视野被门板包住，不露车底；外侧面贴齐飞度车宽半 0.847）
    [-0.745, 0.745].forEach(function (dx) {
      var door = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.62, 1.1), dm);
      door.position.set(dx, 0.62, 0.25);
      interior.add(door);
      var arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.045, 0.42), dark(0x3a3f46));
      arm.position.set(dx - (dx > 0 ? 0.085 : -0.085), 0.815, 0.18);
      interior.add(arm);
    });

    // 7 寸液晶仪表：立式中屏嵌在中段台面上，从两幅方向盘开放的上半圈露出
    // （屏底约 1/3 被轮缘上沿自然遮挡，屏面内容已顶部对齐——与真车观感一致）
    updateGauges(0, 'D');
    var clusterHousing = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.11, 0.035), dark(0x101216));
    clusterHousing.position.set(0.36, 0.94, 0.775);
    interior.add(clusterHousing);
    var lcdM = gaugeTex
      ? new THREE.MeshBasicMaterial({ map: gaugeTex })
      : new THREE.MeshBasicMaterial({ color: 0x0d1420 });
    var lcd = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.092), lcdM);
    lcd.position.set(0.36, 0.94, 0.7555);
    lcd.rotation.y = Math.PI;   // 屏面朝向驾驶员
    interior.add(lcd);

    // 中控 8 寸悬浮屏外框：立在中段台面（y 0.885）之上，悬浮平板造型（屏体见 buildMirrors）
    // 注意：外框与屏面不可带倾角 —— 倾斜后框体顶面会翻向驾驶员眼睛，遮住屏面
    var screenBezel = new THREE.Mesh(new THREE.BoxGeometry(0.235, 0.15, 0.025), dark(0x14171c));
    screenBezel.position.set(0, 0.95, 0.79);
    interior.add(screenBezel);
    // 息屏背板：倒车影像关闭时屏幕呈深色玻璃质感，不再是空洞的框
    var screenOff = new THREE.Mesh(new THREE.PlaneGeometry(0.215, 0.14),
      new THREE.MeshBasicMaterial({ color: 0x232e3a }));
    screenOff.position.set(0, 0.95, 0.7762);
    screenOff.rotation.y = Math.PI;
    interior.add(screenOff);

    // 车内后视镜吊装臂：横臂贴着车顶内饰底面（y≈1.453）水平向前，末端吊杆下探接镜壳——
    // 真车后视镜即"横臂+吊杆"悬在风挡顶部正中（x 0.10，驾驶员前方偏右，与真车一致）；
    // 镜面位置（y 1.305）见 buildMirrors。属于内饰组：镜面渲染时随内饰一起隐藏，
    // 不会挡住内镜画面。臂保持固定——真车调节时臂不动，整个镜头（壳+镜片）绕球头一起转
    var stem = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.018, 0.13), dark(0x1a1c20));
    stem.position.set(0.10, 1.444, 0.505);
    interior.add(stem);
    var drop = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.11, 0.018), dark(0x1a1c20));
    drop.position.set(0.10, 1.40, 0.575);
    interior.add(drop);

    // 中央通道（副驾侧矮台）+ 换挡杆（D/R 桩位在通道上，驾驶员右前方）
    var console_ = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.45), dm);
    console_.position.set(-0.05, 0.71, 0.30);
    interior.add(console_);
    var lever = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.09, 8), dark(0x1a1c20));
    lever.position.set(-0.05, 0.855, 0.34);
    lever.rotation.z = 5 * D2R;
    interior.add(lever);
    var knob = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.028, 0.05, 10), dark(0x33363d));
    knob.position.set(-0.046, 0.912, 0.345);
    interior.add(knob);

    // 双幅式方向盘（GR9 标志性设计）：仅左右两根近水平辐条 + 宽幅安全气囊轮毂，
    // 上半圈完全开放；安装倾角约 24°，圆心对准驾驶员（x=seatX）
    var wheelGroup = new THREE.Group();
    wheelGroup.position.set(0.36, 0.85, 0.50);
    wheelGroup.rotation.x = -24 * D2R;
    var rim = new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.022, 10, 28), dark(0x1a1c20));
    wheelGroup.add(rim);
    [-1, 1].forEach(function (s) {
      var spoke = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.055, 0.02), dark(0x33363d));
      spoke.position.set(s * 0.127, 0, 0);
      wheelGroup.add(spoke);
    });
    var hub = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.095, 0.035), dark(0x2a2d33));
    wheelGroup.add(hub);
    var emblem = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.032, 0.006),
      new THREE.MeshLambertMaterial({ color: 0xb8bfc7 }));
    emblem.position.set(0, 0, -0.0205);   // 轮毂驾驶员侧面：H 标点缀
    wheelGroup.add(emblem);
    interior.add(wheelGroup);

    // 转向柱护罩 + 灯光/雨刮拨杆（方向盘与仪表台之间的真实连接件）
    var shroud = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.12, 0.26), dm);
    shroud.position.set(0.36, 0.775, 0.585);
    shroud.rotation.x = -24 * D2R;
    interior.add(shroud);
    [-1, 1].forEach(function (s) {
      var stalk = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.016, 0.13), dark(0x14161a));
      stalk.position.set(0.36 + s * 0.085, 0.84, 0.635);
      stalk.rotation.x = -24 * D2R;
      interior.add(stalk);
    });

    // 座椅
    function seat(x) {
      var s = new THREE.Group();
      var base = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.5), dm2);
      base.position.set(x, 0.62, -0.15);
      s.add(base);
      var back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.62, 0.13), dm2);
      back.position.set(x, 0.95, -0.42);
      back.rotation.x = -8 * D2R;
      s.add(back);
      return s;
    }
    interior.add(seat(0.36));
    interior.add(seat(-0.36));

    // 车顶内饰 + 遮阳板（飞度座舱：顶棚贴在外观车顶板 1.45–1.51 内侧；
    // 前缘伸到 z 0.725 形成风挡上沿，压入画面顶端成为真实上边框）
    var roofIn = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.05, 2.3), dm);
    roofIn.position.set(0, 1.478, -0.425);
    interior.add(roofIn);
    [-0.30, 0.30].forEach(function (vx) {
      var visor = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.06, 0.014), dark(0x1e2024));
      visor.position.set(vx, 1.425, 0.62);
      visor.rotation.x = 10 * D2R;
      interior.add(visor);
    });

    // A 柱：细长斜柱（宽 3cm），下端落在仪表台外角（±0.80, 0.96, 1.08）、上端没入车顶前角
    //（±0.72, 1.46, 0.52）——与真飞度 A 柱走向一致。主相机水平 FOV 104° 很宽，
    // 柱体投影天然偏内，因此用"细"而非"外移"来避免喧宾夺主
    var pilG = new THREE.BoxGeometry(0.03, 0.78, 0.04);
    var pa = new THREE.Mesh(pilG, dm);            // 副驾侧
    pa.position.set(-0.76, 1.21, 0.80);
    pa.rotation.set(-48 * D2R, 0, -6 * D2R);
    interior.add(pa);
    var pb = new THREE.Mesh(pilG, dm);            // 驾驶员侧
    pb.position.set(0.76, 1.21, 0.80);
    pb.rotation.set(-48 * D2R, 0, 6 * D2R);
    interior.add(pb);

    // 风挡下沿通风格栅 + 雨刮（落在下倾的引擎盖上，第一人称视野下缘的真实参照物；
    // 雨刮同时是车外可见件，与真车一致）
    var cowl = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.02, 0.10), dark(0x14161a));
    cowl.position.set(0, 0.908, 1.21);
    interior.add(cowl);
    var wiperL = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.014, 0.022), dark(0x0c0e10));
    wiperL.position.set(0.28, 0.906, 1.32);
    wiperL.rotation.y = 16 * D2R;
    interior.add(wiperL);
    var wiperR = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.014, 0.022), dark(0x0c0e10));
    wiperR.position.set(-0.27, 0.906, 1.32);
    wiperR.rotation.y = -12 * D2R;
    interior.add(wiperR);

    carGroup.add(interior);
    return { wheelGroup: wheelGroup, interior: interior, updateGauges: updateGauges };
  }

  /**
   * 后视镜组：左右外后视镜 + 车内后视镜 + 倒车影像中控屏
   * hideInMirror: 渲染镜面画面时需要隐藏的对象（内饰组），保留外观与舱玻璃使镜中可见封闭车身
   * interiorHideExtra: 仅渲染车内后视镜画面时额外隐藏的对象（如车顶板）
   * 返回 { render(renderer, scene), mirrors:[{grp,plane,cam,adjYaw,adjPitch,apply()}], revCam, revPlane, revRt }
   */
  function buildMirrors(carGroup, renderer, hideInMirror, interiorHideExtra) {
    hideInMirror = hideInMirror || [];
    var VIEW = PS.VIEW || {};
    var EXT_FOV = VIEW.mirrorFov || 58;      // 外后视镜相机视场
    var INT_FOV = VIEW.inMirrorFov || VIEW.mirrorFov || 58; // 车内后视镜相机视场
    var mirrors = [];

    /** pos: 镜面位置；camPos: 镜相机位置；yaw: 镜面朝向；camYaw: 镜相机朝向；size: [宽,高]
     *  camPitchDeg: 镜相机默认俯仰（负=俯视，正=仰视）；hideExtra: 仅渲染该镜画面时额外隐藏的对象
     *  （如车内镜隐藏车顶板，避免自家车顶/车尾占满镜面）
     *  镜面与外壳同组，adjYaw/adjPitch 为驾驶员调节量（V 调节模式）：
     *  玻璃组与镜相机一起偏转 —— 相机偏转即改变镜中所见，与真实调后视镜一致。 */
    function makeMirror(pos, camPos, yawDeg, camYawDeg, size, withShell, fov, camPitchDeg, hideExtra, tint) {
      var rt = new THREE.WebGLRenderTarget(384, 216);
      var cam = new THREE.PerspectiveCamera(fov, 384 / 216, 0.3, 160);
      cam.position.set(camPos.x, camPos.y, camPos.z);
      cam.rotation.set((camPitchDeg || 0) * D2R, camYawDeg * D2R, 0);
      carGroup.add(cam);
      // 镜面：法线朝向驾驶员；用 scale.x = -1 实现真实镜像翻转；DoubleSide 保证可见。
      // tint：镜片色调（内镜加防眩目蓝灰，画面压暗偏冷，与真镜观感一致）
      var grp = new THREE.Group();
      grp.position.set(pos.x, pos.y, pos.z);
      grp.rotation.y = yawDeg * D2R;
      var mat = new THREE.MeshBasicMaterial({ map: rt.texture, side: THREE.DoubleSide, color: tint || 0xffffff });
      var plane = new THREE.Mesh(new THREE.PlaneGeometry(size[0], size[1]), mat);
      plane.scale.x = -1; // 几何级水平翻转 = 真实镜像
      grp.add(plane);
      // 外后视镜外壳：组内沿背面法线（局部 -z）偏移，随组旋转始终贴在玻璃背面（窄边框）
      if (withShell) {
        var shell = new THREE.Mesh(new THREE.BoxGeometry(size[0] + 0.04, size[1] + 0.05, 0.045), dark(0x2c2f35));
        shell.position.set(0, 0, -0.04);
        grp.add(shell);
      }
      carGroup.add(grp);
      var m = {
        cam: cam, rt: rt, plane: plane, mat: mat, grp: grp,
        camYaw0: camYawDeg * D2R, camPitch0: (camPitchDeg || 0) * D2R,
        hideExtra: hideExtra || [],
        adjYaw: 0, adjPitch: 0,
        apply: function () {
          grp.rotation.y = yawDeg * D2R + m.adjYaw;
          grp.rotation.x = m.adjPitch;
          cam.rotation.y = m.camYaw0 + m.adjYaw;
          cam.rotation.x = m.camPitch0 + m.adjPitch;
        }
      };
      mirrors.push(m);
      return m;
    }

    // 左外后视镜（驾驶员侧 +x）：镜面位于 A 柱前方视野内，相机置于车身外朝后偏外看
    makeMirror({ x: 0.86, y: 1.06, z: 0.82 }, { x: 0.94, y: 1.05, z: 0.80 }, -147, -24, [0.30, 0.16], true, EXT_FOV, -4);
    // 右外后视镜（副驾侧 -x）：稍向内收以进入固定视野，配合转头键完整可见
    makeMirror({ x: -0.55, y: 1.06, z: 0.85 }, { x: -0.63, y: 1.05, z: 0.83 }, 131, 24, [0.30, 0.16], true, EXT_FOV, -4);
    // 车内后视镜：玻璃 0.26×0.082（GB 15084 Ⅰ类 ≥120×40mm 之上，真镜观感），
    // 吊在风挡顶部正中（x 0.10，真车安装位，位于驾驶员前方偏右），
    // 玻璃顶边 1.346 与吊杆底端衔接；从眼位仰角约 14.8°——画面最上沿区域；
    // yaw 173°、相机正对车后、仰角 +2°、防眩目 tint、渲染时隐藏车顶板
    var intMirror = makeMirror({ x: 0.10, y: 1.305, z: 0.60 }, { x: 0.10, y: 1.305, z: 0.60 }, 173, 0, [0.26, 0.082], false, INT_FOV, 2, interiorHideExtra, 0xa9bac9);

    // 镜壳 + 后窗轮廓遮罩都挂到转动组（grp）里，与镜片同轴：
    // V 调节时整个镜头（壳+框+镜片）一起绕吊装点转动——真车内后视镜的手感。
    // 二者加入 hideInMirror：所有镜面渲染时隐藏，不会出现在任何镜中画面里。
    // 局部 z 轴朝驾驶员一侧（grp 已 yaw 173°，局部 +z ≈ 世界 -z）
    (function () {
      var housing = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.105, 0.03), dark(0x1a1c20));
      housing.position.set(0, 0, -0.034);   // 玻璃背面（远离驾驶员）
      intMirror.grp.add(housing);
      hideInMirror.push(housing);

      var shape = new THREE.Shape();
      shape.moveTo(-0.138, -0.05); shape.lineTo(0.138, -0.05);
      shape.lineTo(0.138, 0.05); shape.lineTo(-0.138, 0.05); shape.closePath();
      var hole = new THREE.Path();
      hole.moveTo(-0.126, -0.039); hole.lineTo(0.126, -0.039);
      hole.lineTo(0.126, 0.039); hole.lineTo(-0.126, 0.039); hole.closePath();
      shape.holes.push(hole);
      var maskMat = new THREE.MeshBasicMaterial({ color: 0x0a0b0d });
      var mask = new THREE.Mesh(new THREE.ShapeGeometry(shape), maskMat);
      mask.position.set(0, 0, 0.001);       // 贴面 1mm：斜视角视差 ≤0.9mm，薄框不漏缝
      intMirror.grp.add(mask);
      hideInMirror.push(mask);
    })();

    // 倒车影像相机（车尾摄像头）：朝车后方（-z）广角俯视地面
    var revCam = new THREE.PerspectiveCamera(VIEW.revFov, 16 / 9, 0.4, 60);
    revCam.position.set(0, 1.0, -2.0);
    revCam.rotation.y = 0;           // 朝向车后方（-z）
    revCam.rotation.x = -25 * D2R;   // 向下俯视，以车后地面与障碍为主、顶部留少量地平线
    carGroup.add(revCam);
    var revRt = new THREE.WebGLRenderTarget(320, 180);
    var revMat = new THREE.MeshBasicMaterial({ map: revRt.texture, side: THREE.DoubleSide });
    // 屏体 0.205×0.115（8 寸悬浮屏可视区，16:9）：贴在屏框朝向驾驶员的前侧面
    //（z 需小于框体前侧面 0.7775，否则框体从驾驶员浅俯视角整体遮住屏面 —— 车头 +z，眼位 z 0.05）
    var revPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.205, 0.115), revMat);
    revPlane.position.set(0, 0.95, 0.775);   // 屏框前侧面内 2.5mm：斜视角无漏缝
    revPlane.rotation.y = Math.PI;   // 屏面朝向驾驶员
    // 水平镜像：呈现"回头看"的直觉视图（画面右＝车右后方），与真实倒车影像一致
    revPlane.scale.x = -1;

    function render(renderer, scene) {
      // 倒车影像：整车隐藏，画面干净
      carGroup.visible = false;
      renderer.setRenderTarget(revRt);
      renderer.render(scene, revCam);
      // 后视镜：隐藏内饰，保留外观与舱玻璃 → 镜中可见封闭车身侧面与后轮（真实参照）
      var saved = [];
      for (var k = 0; k < hideInMirror.length; k++) {
        saved.push([hideInMirror[k], hideInMirror[k].visible]);
        hideInMirror[k].visible = false;
      }
      // 隐藏镜面本身：渲染镜面画面时镜面在车组内可见会采样自己的渲染目标（feedback loop）
      for (var p = 0; p < mirrors.length; p++) mirrors[p].plane.visible = false;
      // 各镜专属隐藏项（如车内镜隐藏车顶板）：保存 → 隐藏 → 渲染后恢复
      for (var e = 0; e < mirrors.length; e++) {
        var extras = mirrors[e].hideExtra;
        for (var e2 = 0; e2 < extras.length; e2++) {
          saved.push([extras[e2], extras[e2].visible]);
          extras[e2].visible = false;
        }
      }
      carGroup.visible = true;
      for (var i = 0; i < mirrors.length; i++) {
        renderer.setRenderTarget(mirrors[i].rt);
        renderer.render(scene, mirrors[i].cam);
      }
      for (var q = 0; q < mirrors.length; q++) mirrors[q].plane.visible = true;
      // 恢复隐藏对象的可见性：否则内饰只渲染一帧便永久消失（方向盘/仪表台不见了）
      for (var r = 0; r < saved.length; r++) saved[r][0].visible = saved[r][1];
      renderer.setRenderTarget(null);
    }

    return {
      mirrors: mirrors,
      revCam: revCam,
      revPlane: revPlane,
      revRt: revRt,
      render: render,
      dispose: function () {
        mirrors.forEach(function (m) { m.rt.dispose(); });
        revRt.dispose();
      }
    };
  }

  return { buildInterior: buildInterior, buildMirrors: buildMirrors };
});
