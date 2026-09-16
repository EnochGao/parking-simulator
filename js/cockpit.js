/* 第一人称驾驶舱：内饰、方向盘、三后视镜（实时渲染到纹理，镜像翻转）、倒车影像 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.PS = root.PS || {}; root.PS.Cockpit = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  var D2R = Math.PI / 180;

  function dark(color) { return new THREE.MeshLambertMaterial({ color: color || 0x24262b }); }

  /** 构建舱内结构（作为玩家车 group 的子对象）。
   *  布局以驾驶员眼位 (seatX,seatY,seatZ)=(0.36,1.16,0.05) 为基准：
   *  方向盘位于驾驶员正前方偏下、完整可见；仪表台整体退到方向盘后方，避免穿模。 */
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
   * 后视镜组：左右外后视镜 + 车内后视镜 + 倒车影像相机
   * hideInMirror: 渲染镜面画面时需要隐藏的对象（内饰组/舱玻璃），保留外观使镜中可见车身
   * 返回 { updateCar(), render(renderer, scene), mirrors:[{mesh,cam}], revCam, revPlane }
   */
  function buildMirrors(carGroup, renderer, hideInMirror) {
    hideInMirror = hideInMirror || [];
    var VIEW = PS.VIEW || { mirrorFov: 58, revFov: 115 };
    var mirrors = [];

    /** pos: 镜面位置；camPos: 镜相机位置；yaw: 镜面朝向；camYaw: 镜相机朝向；size: [宽,高] */
    function makeMirror(pos, camPos, yawDeg, camYawDeg, size, withShell) {
      var rt = new THREE.WebGLRenderTarget(384, 216);
      var cam = new THREE.PerspectiveCamera(VIEW.mirrorFov || 58, 384 / 216, 0.3, 160);
      cam.position.set(camPos.x, camPos.y, camPos.z);
      cam.rotation.y = camYawDeg * D2R;
      cam.rotation.x = -4 * D2R;
      carGroup.add(cam);
      // 镜面：法线朝向驾驶员；用 scale.x = -1 实现真实镜像翻转；DoubleSide 保证可见
      var mat = new THREE.MeshBasicMaterial({ map: rt.texture, side: THREE.DoubleSide });
      var plane = new THREE.Mesh(new THREE.PlaneGeometry(size[0], size[1]), mat);
      plane.position.set(pos.x, pos.y, pos.z);
      plane.rotation.y = yawDeg * D2R;
      plane.scale.x = -1; // 几何级水平翻转 = 真实镜像
      carGroup.add(plane);
      // 外后视镜外壳：沿镜面背面法线方向偏移（不能用世界 z 偏移，
      // 否则镜面大角度旋转后外壳会挡在镜面与驾驶员之间）
      if (withShell) {
        var yawRad = yawDeg * D2R;
        var shell = new THREE.Mesh(new THREE.BoxGeometry(size[0] + 0.07, size[1] + 0.07, 0.05), dark(0x2c2f35));
        shell.position.set(
          pos.x - Math.sin(yawRad) * 0.05,
          pos.y,
          pos.z - Math.cos(yawRad) * 0.05
        );
        shell.rotation.y = yawRad;
        carGroup.add(shell);
      }
      var m = { cam: cam, rt: rt, plane: plane, mat: mat };
      mirrors.push(m);
      return m;
    }

    // 左外后视镜（驾驶员侧 +x）：镜面位于 A 柱前方视野内，相机置于车身外朝后偏外看
    makeMirror({ x: 0.86, y: 1.06, z: 0.82 }, { x: 0.94, y: 1.05, z: 0.80 }, -147, -24, [0.30, 0.16], true);
    // 右外后视镜（副驾侧 -x）：稍向内收以进入固定视野，配合转头键完整可见
    makeMirror({ x: -0.55, y: 1.06, z: 0.85 }, { x: -0.63, y: 1.05, z: 0.83 }, 131, 24, [0.30, 0.16], true);
    // 车内后视镜（正后方）
    makeMirror({ x: 0.32, y: 1.27, z: 0.55 }, { x: 0.32, y: 1.27, z: 0.55 }, 180, 0, [0.30, 0.10], false);

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
    revPlane.position.set(0, 1.008, 0.635);
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
