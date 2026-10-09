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

  function createWorld(scene, level, textures) {
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

    /* --- 车位标线（现实风格：白色边线，入口侧开口，无填充） --- */
    (function () {
      var s = level.spot, a = s.a * D2R;
      var fx = Math.sin(a), fz = Math.cos(a), rx = Math.cos(a), rz = -Math.sin(a);
      var hw = s.w / 2, hl = s.l / 2;
      // 白色标线（线宽约 12cm，接近真实车位划线）
      var lineM = new THREE.MeshBasicMaterial({ color: 0xe8eaec });
      function strip(cx, cz, len, wid) { // 沿泊车方向 len × 垂直 wid
        var m = new THREE.Mesh(new THREE.PlaneGeometry(len, wid), lineM);
        m.rotation.x = -Math.PI / 2;
        m.rotation.z = -a; // 平面旋转到车位朝向
        m.position.set(cx, 0.03, cz);
        group.add(m);
        disposables.push(m.geometry);
      }
      strip(s.x + rx * hw, s.z + rz * hw, s.l, 0.12);
      strip(s.x - rx * hw, s.z - rz * hw, s.l, 0.12);
      strip(s.x + fx * hl, s.z + fz * hl, s.w + 0.12, 0.12);
      disposables.push(lineM);
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
      dispose: function () {
        group.parent && group.parent.remove(group);
        disposables.forEach(function (d) { d.dispose && d.dispose(); });
      }
    };
  }

  return { createWorld: createWorld };
});