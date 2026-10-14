/* js/world.js · 微信小游戏模块（tools/build_wx.js 生成，勿手改） */
var window = GameGlobal, self = GameGlobal;   /* UMD 根 → 跨模块共享全局 */
var module, exports, define;                  /* 声明以捕获外层泄露 */
module = exports = define = undefined;        /* 强制浏览器分支（var 对参数式包装无效） */
/* 关卡 → 3D 世界搭建（与碰撞体共用 levels.js 数据，单一数据源） */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.PS = root.PS || {}; root.PS.World = api; }
})(typeof self !== 'undefined' ? self : this, function () {

  function createWorld(scene, level, textures, opts) {
    var D2R = Math.PI / 180;
    var group = new THREE.Group();
    scene.add(group);
    var disposables = [];

    /* --- 地面 --- */
    var b = level.bounds;
    var gw = b.maxX - b.minX + 30, gh = b.maxZ - b.minZ + 30;
    var groundMat = new THREE.MeshLambertMaterial({ map: textures.asphalt });
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(gw, gh), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
    ground.receiveShadow = true;
    group.add(ground);
    disposables.push(ground.geometry, groundMat);

    /* --- 目标车位标线（白边框 + 黄色四角 + 地面 P 标 + P 上方车头方向箭头） ---
     * 平面旋转经数值验证（绕 X 轴 −90° 后 rotation.z 的地面朝向是镜像映射）：
     *   长边沿泊车方向 forward=(sinA,cosA) → rotation.z = A−π/2
     *   横边沿车位宽度 right=(cosA,−sinA) → rotation.z = A
     *   贴图字头(+Y)指向 forward → rotation.z = A+π（平面法线朝上，无镜像）
     * 旧实现三条线统一 z=−A（宽度方向），侧边长线被画横、部分角度下穿库 —— 已修 */
    var spotTick = null;
    (function () {
      var s = level.spot, a = s.a * D2R;
      /* 期望车头方向（教学停法）：game.js 传入该关演示路径（标准答案）的终态
       * 车头角——spot.a 只有库轴意义，正负号在部分关卡与教学停法相反（评分
       * 角度对称所致）；未传（静态工具/旧调用方）时回退库轴 a */
      var noseDeg = (opts && opts.noseDeg != null) ? opts.noseDeg : s.a;
      var na = noseDeg * D2R;
      var nfx = Math.sin(na), nfz = Math.cos(na);
      var fx = Math.sin(a), fz = Math.cos(a), rx = Math.cos(a), rz = -Math.sin(a);
      var hw = s.w / 2, hl = s.l / 2;
      var AMBER = 0xffc93f;   // 与 assist.js 雷达预警同色系：绿色=轨迹引导，黄色=目标位
      var lineM = new THREE.MeshBasicMaterial({ color: 0xffffff });
      var markM = new THREE.MeshBasicMaterial({ color: AMBER, transparent: true, opacity: 1 });
      function strip(cx, cz, len, wid, zRot, mat, y) { // len 沿 zRot 指定方向
        var m = new THREE.Mesh(new THREE.PlaneGeometry(len, wid), mat);
        m.rotation.x = -Math.PI / 2;
        m.rotation.z = zRot;
        m.position.set(cx, y, cz);
        group.add(m);
        disposables.push(m.geometry);
      }
      var Y_LINE = 0.03, Y_MARK = 0.032, Y_P = 0.034, Y_ARROW = 0.036;  // 逐层抬高 2mm 防贴片互揍 z-fight
      /* 白色边框（线宽 12cm，现实划线风格；入口侧开口） */
      strip(s.x + rx * hw, s.z + rz * hw, s.l, 0.12, a - Math.PI / 2, lineM, Y_LINE);
      strip(s.x - rx * hw, s.z - rz * hw, s.l, 0.12, a - Math.PI / 2, lineM, Y_LINE);
      strip(s.x + fx * hl, s.z + fz * hl, s.w + 0.12, 0.12, a, lineM, Y_LINE);
      /* 黄色四角括号：从车位四角向内 0.6m 的 L 形标（目标位高亮，区别于普通白线） */
      var INSET = 0.3, ARM = 0.6;
      [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(function (sg) {   // [沿right符号, 沿forward符号]
        var cx = s.x + rx * (hw - INSET) * sg[0] + fx * (hl - INSET) * sg[1];
        var cz = s.z + rz * (hw - INSET) * sg[0] + fz * (hl - INSET) * sg[1];
        strip(cx - fx * ARM / 2 * sg[1], cz - fz * ARM / 2 * sg[1], ARM, 0.1, a - Math.PI / 2, markM, Y_MARK);
        strip(cx - rx * ARM / 2 * sg[0], cz - rz * ARM / 2 * sg[0], ARM, 0.1, a, markM, Y_MARK);
      });
      /* 地面车头方向箭头：画在 P 字上方的车头半区（从 P 往期望车头方向看去即箭头），
       * 箭头指向期望车头方向（倒车入库关卡＝指向库口，前进入位关卡＝指向库里），
       * 与 P 字/角标同套琥珀色并同步呼吸——完成门禁拦错向后，箭头告诉玩家车头
       * 该在哪端。贴片沿库轴向车头退让避让居中 P 字，内缘离 P 字贴片 0.12m */
      var arrowM = null;
      (function () {
        var PLAT = (typeof window !== 'undefined' && window.PS && window.PS.Platform) ||
                   (typeof self !== 'undefined' && self.PS && self.PS.Platform);
        var c = PLAT ? PLAT.createCanvas() : document.createElement('canvas');
        var awid = Math.min(s.w * 0.5, 1.2), alen = Math.min(s.l * 0.26, 1.4);
        /* 画布高随贴片长宽比走（宽固定 256）：贴图像素两轴等比，箭头不拉伸 */
        c.width = 256;
        c.height = Math.round(256 * alen / awid);
        var x = c.getContext('2d');
        x.fillStyle = '#ffffff';
        var hH = c.height;
        x.beginPath();                                   // 箭头头部（腰形三角）
        x.moveTo(128, hH * 0.03); x.lineTo(224, hH * 0.42); x.lineTo(32, hH * 0.42);
        x.closePath(); x.fill();
        x.fillRect(99, hH * 0.415, 58, hH * 0.555);     // 箭杆（直落到贴片尾）
        var at = new THREE.CanvasTexture(c);
        at.anisotropy = 4;
        arrowM = new THREE.MeshBasicMaterial({ map: at, color: AMBER, transparent: true, opacity: 1 });
        var am = new THREE.Mesh(new THREE.PlaneGeometry(awid, alen), arrowM);
        am.rotation.x = -Math.PI / 2;
        am.rotation.z = na + Math.PI;   // 贴图字头(+Y)→nose（与 P 字同一验证映射），箭杆正对车头方向
        var ahead = alen / 2 + Math.min(s.w * 0.7, s.l * 0.42) / 2 + 0.12;   // 中心→P 字贴片缘留 0.12m
        am.position.set(s.x + nfx * ahead, Y_ARROW, s.z + nfz * ahead);
        group.add(am);
        disposables.push(am.geometry, arrowM, at);
      })();
      /* 地面 P 字：路径手绘（不依赖平台字体），白色笔划 + 材质染黄，随角标同步呼吸 */
      (function () {
        var PLAT = (typeof window !== 'undefined' && window.PS && window.PS.Platform) ||
                   (typeof self !== 'undefined' && self.PS && self.PS.Platform);
        var c = PLAT ? PLAT.createCanvas() : document.createElement('canvas');
        c.width = c.height = 256;
        var x = c.getContext('2d');
        x.fillStyle = '#ffffff';
        x.fillRect(70, 40, 48, 182);                       // 竖笔
        x.beginPath();                                     // 碗形（右半圆环）
        x.moveTo(118, 40);
        x.arc(118, 102, 62, -Math.PI / 2, Math.PI / 2);
        x.lineTo(118, 122);
        x.arc(118, 102, 20, Math.PI / 2, -Math.PI / 2, true);
        x.closePath();
        x.fill();
        var pt = new THREE.CanvasTexture(c);
        pt.anisotropy = 4;
        var pM = new THREE.MeshBasicMaterial({ map: pt, color: AMBER, transparent: true, opacity: 1 });
        var sz = Math.min(s.w * 0.7, s.l * 0.42);
        var pm = new THREE.Mesh(new THREE.PlaneGeometry(sz, sz), pM);
        pm.rotation.x = -Math.PI / 2;
        pm.rotation.z = a + Math.PI;   // P 正对入口方向可读
        pm.position.set(s.x, Y_P, s.z);
        group.add(pm);
        disposables.push(pm.geometry, pM, pt);
        /* 呼吸脉冲：黄标 0.55↔1 循环渐变（约 1.75s 周期），静止画面也醒目；
         * game.js updateVisuals 每帧调 tick(elapsed)，未接（如静态工具）时保持全亮 */
        var t = 0;
        spotTick = function (dt) {
          t += dt;
          var o = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * 3.6));
          markM.opacity = o; pM.opacity = o; arrowM.opacity = o;
        };
      })();
      disposables.push(lineM, markM);
    })();

    /* --- 障碍物 --- */
    var concreteM = new THREE.MeshLambertMaterial({ map: textures.concrete });
    var brickM = new THREE.MeshLambertMaterial({ map: textures.brick });
    var winM = new THREE.MeshLambertMaterial({ map: textures.windows });
    var grassM = new THREE.MeshLambertMaterial({ map: textures.grass });
    var poleM = new THREE.MeshLambertMaterial({ color: 0x4a5560 });
    disposables.push(concreteM, brickM, winM, grassM, poleM);

    // 停放车按颜色建一次模板、其余 clone（clone 共享几何体/材质实例，颜色仅 8 种）：
    // 同关多辆同色车不再各自新建并各自上传一份相同的几何体
    var parkedTpls = {};
    level.obstacles.forEach(function (o, idx) {
      var a = (o.a || 0) * D2R;
      if (o.t === 'car') {
        var seed = idx * 7 + 3;
        var ci = seed % PS.CarModel.COLORS.length;   // 与 buildParkedCar 的取色同式
        var tpl = parkedTpls[ci];
        if (!tpl) {
          tpl = parkedTpls[ci] = PS.CarModel.buildParkedCar(null, seed);
          // 模板的几何/材质登记一次（clone 共享同一实例，销毁时随 disposables 释放）
          tpl.traverse(function (n) {
            if (n.geometry) disposables.push(n.geometry);
            if (n.material) disposables.push(n.material);
          });
        }
        var pc = tpl.clone();
        pc.position.set(o.x, 0, o.z);
        pc.rotation.y = a;
        group.add(pc);
      } else if (o.t === 'wall') {
        // 厚度用 o.wid（与碰撞 OBB 的 hw=(wid||0.4)/2 同源）：路沿墙 wid=0.3 时
        // 视觉墙与碰撞盒对齐，贴墙不再出现每侧 5cm 的穿模缝
        var wm = new THREE.Mesh(new THREE.BoxGeometry(o.wid || 0.4, o.h || 2.2, o.len), brickM);
        wm.position.set(o.x, (o.h || 2.2) / 2, o.z);
        wm.rotation.y = a;
        wm.castShadow = true; wm.receiveShadow = true;
        group.add(wm);
        disposables.push(wm.geometry);
      } else if (o.t === 'bldg') {
        var bm = new THREE.Mesh(new THREE.BoxGeometry(o.wid, o.h || 10, o.len), winM);
        bm.position.set(o.x, (o.h || 10) / 2, o.z);
        bm.rotation.y = a;
        group.add(bm);
        disposables.push(bm.geometry);
      } else if (o.t === 'pillar') {
        var d2 = PS.Levels.DIMS.pillar;
        var pm = new THREE.Mesh(new THREE.BoxGeometry(d2.w, 3.2, d2.l), concreteM);
        pm.position.set(o.x, 1.6, o.z);
        pm.castShadow = true;
        group.add(pm);
        disposables.push(pm.geometry);
      } else if (o.t === 'tree') {
        var trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 1.6, 8), poleM);
        trunk.position.set(o.x, 0.8, o.z);
        trunk.castShadow = true;
        group.add(trunk);
        disposables.push(trunk.geometry);
        var f1 = new THREE.Mesh(new THREE.SphereGeometry(1.15, 10, 8), grassM);
        f1.position.set(o.x, 2.2, o.z);
        f1.castShadow = true;
        group.add(f1);
        disposables.push(f1.geometry);
      } else if (o.t === 'bin') {
        var d3 = PS.Levels.DIMS.bin;
        var bm2 = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.32, 1.0, 10), new THREE.MeshLambertMaterial({ color: 0x3f5a3f }));
        bm2.position.set(o.x, 0.5, o.z);
        bm2.castShadow = true;
        group.add(bm2);
        disposables.push(bm2.geometry, bm2.material);
      }
    });

    /* --- 关卡边界墙：bounds 四周的碰撞墙以前只拦不画=空气墙，玩家撞得莫名其妙；
     * 这里按 levels.js getBoundWalls 的同一份规格画出实体砖墙（与碰撞 OBB 对齐） --- */
    if (PS.Levels && PS.Levels.getBoundWalls) {
      PS.Levels.getBoundWalls(level).forEach(function (w) {
        var bwm = new THREE.Mesh(new THREE.BoxGeometry(w.wid, w.h, w.len), brickM);
        bwm.position.set(w.x, w.h / 2, w.z);
        bwm.rotation.y = w.a * D2R;
        bwm.castShadow = true; bwm.receiveShadow = true;
        group.add(bwm);
        disposables.push(bwm.geometry);
      });
    }

    /* --- 地库模式：天花板 + 灯带（roof 组：俯视上帝视角时整体隐藏，避免遮挡俯视相机） --- */
    var roof = null;
    if (level.garage) {
      roof = new THREE.Group();
      var ceil = new THREE.Mesh(new THREE.BoxGeometry(gw, 0.3, gh), new THREE.MeshLambertMaterial({ color: 0x585b60 }));
      ceil.position.set((b.minX + b.maxX) / 2, 3.4, (b.minZ + b.maxZ) / 2);
      roof.add(ceil);
      disposables.push(ceil.geometry, ceil.material);
      for (var i = 0; i < 5; i++) {
        var lamp = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.06, gh * 0.7), new THREE.MeshBasicMaterial({ color: 0xfff6d8 }));
        lamp.position.set(b.minX + 4 + i * (gw - 8) / 4, 3.2, (b.minZ + b.maxZ) / 2);
        roof.add(lamp);
        disposables.push(lamp.geometry, lamp.material);
      }
      group.add(roof);
    }

    return {
      group: group,
      roof: roof,   // 地库天顶组（俯视图时由 game.js 隐藏）；非地库关为 null
      tick: spotTick,   // 目标位黄标呼吸脉冲（game.js updateVisuals 每帧调，秒）
      dispose: function () {
        group.parent && group.parent.remove(group);
        disposables.forEach(function (d) { d.dispose && d.dispose(); });
      }
    };
  }

  return { createWorld: createWorld };
});