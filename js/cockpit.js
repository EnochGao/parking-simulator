/* 第一人称驾驶舱：内饰、方向盘、三后视镜（实时渲染到纹理，镜像翻转）、倒车影像中控屏 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.PS = root.PS || {}; root.PS.Cockpit = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  var D2R = Math.PI / 180;

  function dark(color) { return new THREE.MeshLambertMaterial({ color: color || 0x24262b }); }

  /** 构建舱内结构（作为玩家车 group 的子对象）。
   *  布局以驾驶员眼位 (seatX,seatY,seatZ)=(0.36,1.16,0.05) 为基准：
   *  方向盘位于驾驶员正前方偏下、完整可见；仪表台延伸至膝部，两侧门板封住车底视野。 */
  function buildInterior(carGroup) {
    var interior = new THREE.Group();
    var dm = dark(), dm2 = dark(0x32353c);

    // 仪表台（延伸至膝部高度，视线从台面上方越过；两侧与门板衔接封住车底视野）
    var dash = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.62, 0.5), dm);
    dash.position.set(0, 0.6075, 0.92);
    interior.add(dash);
    var dashTop = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.05, 0.52), dm2);
    dashTop.position.set(0, 0.89, 0.93);
    interior.add(dashTop);

    // 左右门板上部（真实车内视野被门板包住，不露车底）
    [-0.76, 0.76].forEach(function (dx) {
      var door = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.62, 1.1), dm);
      door.position.set(dx, 0.62, 0.25);
      interior.add(door);
    });

    // 仪表盘：深色表盘底 + 细亮圈 + 指针，位于方向盘上半圈开口处
    var cluster = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.16, 0.04), dark(0x101216));
    cluster.position.set(0.36, 0.97, 0.69);
    interior.add(cluster);
    var gaugeRimM = new THREE.MeshLambertMaterial({ color: 0xb8bfc7 });
    var gaugeFaceM = new THREE.MeshLambertMaterial({ color: 0x0e1013 });
    [-0.075, 0.075].forEach(function (dx) {
      var face = new THREE.Mesh(new THREE.CircleGeometry(0.048, 20), gaugeFaceM);
      face.position.set(0.36 + dx, 0.97, 0.666);
      interior.add(face);
      var rim = new THREE.Mesh(new THREE.TorusGeometry(0.048, 0.006, 8, 20), gaugeRimM);
      rim.position.set(0.36 + dx, 0.97, 0.658);
      interior.add(rim);
      var needle = new THREE.Mesh(new THREE.BoxGeometry(0.007, 0.034, 0.004), gaugeRimM);
      needle.position.set(0.36 + dx - 0.01, 0.988, 0.6545);
      needle.rotation.z = 32 * D2R;
      interior.add(needle);
    });

    // 中控屏外框（车内正中 x=0，竖直立在仪表台上沿；屏体见 buildMirrors）
    // 注意：外框与屏面不可带倾角 —— 倾斜后框体顶面会翻向驾驶员眼睛，遮住屏面
    var screenBezel = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.025), dark(0x101216));
    screenBezel.position.set(0, 1.005, 0.662);
    interior.add(screenBezel);

    // 车内后视镜安装臂：贴着车顶底面（y 1.346）水平向前，接到镜壳背面顶部——真车方式；
    // 臂底面 1.3325 高于镜面顶边 1.3305（2.5mm 间隙），从镜面上方越过不接触。
    // 属于内饰组：镜面渲染时随内饰一起隐藏，不会挡住内镜画面。
    // 臂保持固定——真车调节时臂不动，整个镜头（壳+镜片）绕球头一起转（见 buildMirrors）
    var stem = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.025, 0.25), dark(0x1a1c20));
    stem.position.set(0.22, 1.345, 0.475);
    interior.add(stem);

    // 中央通道（副驾侧矮台，位于屏体后方）
    var console_ = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.45), dm);
    console_.position.set(-0.05, 0.71, 0.30);
    interior.add(console_);

    // 方向盘（三幅），安装倾角约 24°，圆心对准驾驶员（x=seatX），轮盘整体在仪表台前方不穿模
    var wheelGroup = new THREE.Group();
    wheelGroup.position.set(0.36, 0.88, 0.50);
    wheelGroup.rotation.x = -24 * D2R;
    var rim = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.024, 10, 28), dark(0x1a1c20));
    wheelGroup.add(rim);
    var spokeM = dark(0x33363d);
    [0, 120, 240].forEach(function (deg) {
      var spoke = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.18, 0.02), spokeM);
      spoke.position.set(Math.sin(deg * D2R) * 0.095, -Math.cos(deg * D2R) * 0.095, 0);
      spoke.rotation.z = -deg * D2R;
      wheelGroup.add(spoke);
    });
    var hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 12), spokeM);
    hub.rotation.x = Math.PI / 2;
    wheelGroup.add(hub);
    interior.add(wheelGroup);

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

    // 车顶内饰 + A 柱
    var roofIn = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.05, 1.5), dm);
    roofIn.position.set(0, 1.48, -0.75);
    interior.add(roofIn);
    var pilG = new THREE.BoxGeometry(0.07, 0.32, 0.08);
    var pa = new THREE.Mesh(pilG, dm);
    pa.position.set(-0.78, 1.32, 0.62);
    pa.rotation.z = 14 * D2R;
    interior.add(pa);
    var pb = new THREE.Mesh(pilG, dm);
    pb.position.set(0.78, 1.32, 0.62);
    pb.rotation.z = -14 * D2R;
    interior.add(pb);

    carGroup.add(interior);
    return { wheelGroup: wheelGroup, interior: interior };
  }

  /**
   * 后视镜组：左右外后视镜 + 车内后视镜 + 倒车影像中控屏
   * hideInMirror: 渲染镜面画面时需要隐藏的对象（内饰组/舱玻璃），保留外观使镜中可见车身
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
      // 外后视镜外壳：组内沿背面法线（局部 -z）偏移，随组旋转始终贴在玻璃背面
      if (withShell) {
        var shell = new THREE.Mesh(new THREE.BoxGeometry(size[0] + 0.07, size[1] + 0.07, 0.05), dark(0x2c2f35));
        shell.position.set(0, 0, -0.05);
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
    // 镜面 0.34×0.125：比遮罩孔大一圈——遮罩贴面 1mm（视差 ≤0.9mm），
    // 玻璃包住孔、遮罩包住玻璃，边框收窄到 6-10mm（真车薄框）且不漏缝
    // 镜面中心 y=1.20：镜面顶边 1.2625，吊装臂底面 1.27 从上方越过（7.5mm 间隙）互不接触；
    // 其余同轴要素不变（yaw 173°、相机正对车后、仰角 +2°、防眩目 tint、渲染时隐藏车顶板）
    // 镜面中心 y=1.2805：吊在车顶前缘（底面 1.346）正下方，仰角 13.6°——屏幕最上沿区域；
    // 镜面 0.34×0.10，顶边 1.3305 在臂底面（1.3325）下方 2.5mm 互不接触；
    // 其余同轴要素不变（yaw 173°、相机正对车后、仰角 +2°、防眩目 tint、渲染时隐藏车顶板）
    var intMirror = makeMirror({ x: 0.22, y: 1.2805, z: 0.55 }, { x: 0.22, y: 1.2805, z: 0.55 }, 173, 0, [0.34, 0.10], false, INT_FOV, 2, interiorHideExtra, 0xa9bac9);

    // 镜壳 + 后窗轮廓遮罩都挂到转动组（grp）里，与镜片同轴：
    // V 调节时整个镜头（壳+框+镜片）一起绕吊装点转动——真车内后视镜的手感。
    // 二者加入 hideInMirror：所有镜面渲染时隐藏，不会出现在任何镜中画面里。
    // 局部 z 轴朝驾驶员一侧（grp 已 yaw 173°，局部 +z ≈ 世界 -z）
    (function () {
      var housing = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.14, 0.03), dark(0x1a1c20));
      housing.position.set(0, 0, -0.035);   // 玻璃背面（远离驾驶员）
      intMirror.grp.add(housing);
      hideInMirror.push(housing);

      var shape = new THREE.Shape();
      shape.moveTo(-0.172, -0.06); shape.lineTo(0.172, -0.06);
      shape.lineTo(0.172, 0.06); shape.lineTo(-0.172, 0.06); shape.closePath();
      var hole = new THREE.Path();
      hole.moveTo(-0.161, -0.0475); hole.lineTo(0.161, -0.0475);
      hole.lineTo(0.1645, 0.0475); hole.lineTo(-0.1645, 0.0475); hole.closePath();
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
    var revPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.29, 0.163), revMat);
    // 中控屏：车内正中 x=0、贴在屏框朝向驾驶员的前侧面（z 需小于框体前侧面 0.6495，
    // 否则屏体会从驾驶员浅俯视角整体遮住屏面 —— 车头为 +z，眼位 z=0.05）
    revPlane.position.set(0, 1.008, 0.648);  // 贴近屏框前侧面 1.5mm：斜视角无漏缝
    revPlane.rotation.y = Math.PI;   // 屏面朝向驾驶员
    // 水平镜像：呈现"回头看"的直觉视图（画面右＝车右后方），与真实倒车影像一致
    revPlane.scale.x = -1;

    function render(renderer, scene) {
      // 倒车影像：整车隐藏，画面干净
      carGroup.visible = false;
      renderer.setRenderTarget(revRt);
      renderer.render(scene, revCam);
      // 后视镜：隐藏内饰与舱玻璃，保留外观 → 镜中可见车身侧面与后轮（真实参照）
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
