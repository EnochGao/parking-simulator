/* 目标车位标线几何校验（node tests/spot_mark_check.js）
 * world.js 的车位贴片旋转曾把侧边长线画横（部分角度穿库），修复后以本文件为门禁：
 * - 白边线：2 条侧边长线与 1 条底端线，逐条与评分用车位框 spotPoly 的对应边贴合
 *   （中点落在边线上、方向与车位轴平行），任意车位角度（0/12/45/90/270/315°）都成立
 * - 黄角标：8 条 L 臂全部落在车位框内、且贴近四角
 * - P 字贴片：法线朝上（俯视可读不镜像）、贴片 +Y（字头）指向泊车方向 forward
 * - tick：呼吸脉冲材质透明度始终在 [0.55, 1]
 * 发现错位即打印并以非零码退出 */
'use strict';
var path = require('path');
var JS = path.join(__dirname, '..', 'js');
global.THREE = require(path.join(__dirname, '..', 'vendor', 'three.min.js'));

/* world.js 画 P 字走 Platform 画布（Node 无 document）：挂桩画布 + 2d 上下文，
 * CanvasTexture 只存引用不触 GL，桩实现足够 */
global.window = { PS: { Platform: { createCanvas: function () {
  return { width: 0, height: 0, getContext: function () {
    return { fillRect: function () {}, beginPath: function () {}, moveTo: function () {},
      arc: function () {}, lineTo: function () {}, closePath: function () {}, fill: function () {} };
  } };
} } } };
global.PS = {
  CarModel: require(path.join(JS, 'carModel.js')),
  Levels: require(path.join(JS, 'levels.js'))
};
var World = require(path.join(JS, 'world.js'));
var Scoring = require(path.join(JS, 'scoring.js'));
var D2R = Math.PI / 180;

function pointInPoly(px, pz, poly) {
  var inside = false;
  for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    var xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
    if ((zi > pz) !== (zj > pz) && px < (xj - xi) * (pz - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function check() {
  var out = [];
  global.PS.Levels.LEVELS.forEach(function (lv) {
    var id = lv.id;
    var s = lv.spot, a = s.a * D2R;
    var fwd = [Math.sin(a), Math.cos(a)], rgt = [Math.cos(a), -Math.sin(a)];
    var poly = Scoring.spotPoly({ x: s.x, z: s.z, angle: a, w: s.w, l: s.l });

    var world = World.createWorld({ add: function () {} }, lv,
      { asphalt: {}, concrete: {}, brick: {}, windows: {}, grass: {} });

    /* 收集车位标线贴片：PlaneGeometry + MeshBasicMaterial，且贴地（y < 0.1） */
    var strips = [], pPlanes = [];
    world.group.children.forEach(function (m) {
      if (!m.geometry || m.geometry.type !== 'PlaneGeometry' || !(m.material instanceof THREE.MeshBasicMaterial)) return;
      if (m.position.y > 0.1) return;   // 排除地库灯带等高空 BasicMesh
      var q = m.quaternion;
      var X = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      var info = {
        len: m.geometry.parameters.width, wid: m.geometry.parameters.height,
        cx: m.position.x, cz: m.position.z, y: m.position.y,
        dir: [X.x, X.z]
      };
      if (m.material.map) {
        var Y = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
        var N = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
        pPlanes.push({ sz: info.len, up: [Y.x, Y.z], normalUp: N.y > 0.999, c: [m.position.x, m.position.z] });
      } else strips.push(info);
    });

    var dot = function (u, v) { return u[0] * v[0] + u[1] * v[1]; };
    var alongF = function (v) { return Math.abs(dot(v, fwd) - 1) < 1e-6; };
    var alongR = function (v) { return Math.abs(dot(v, rgt) - 1) < 1e-6; };
    var onSeg = function (px, pz, ax, az, bx, bz) {  // 点到线段端点连线距离
      var abx = bx - ax, abz = bz - az, t = ((px - ax) * abx + (pz - az) * abz) / (abx * abx + abz * abz);
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(px - (ax + abx * t), pz - (az + abz * t));
    };

    /* 1. 侧边长线 ×2：方向=forward，中点各在两条长边上（长边=[0,3]/[1,2]，沿泊车方向） */
    var sides = strips.filter(function (t) { return Math.abs(t.len - s.l) < 0.02 && t.wid < 0.2; });
    if (sides.length !== 2) { out.push(id + ': 侧边长线数=' + sides.length + '（应为 2）'); }
    sides.forEach(function (t) {
      if (!alongF(t.dir)) out.push(id + ': 侧边长线方向偏离 forward');
      var d0 = onSeg(t.cx, t.cz, poly[0][0], poly[0][1], poly[3][0], poly[3][1]);
      var d1 = onSeg(t.cx, t.cz, poly[1][0], poly[1][1], poly[2][0], poly[2][1]);
      if (Math.min(d0, d1) > 0.02) out.push(id + ': 侧边长线中点离两长边 ' + Math.min(d0, d1).toFixed(3) + 'm');
    });

    /* 2. 底端线 ×1：方向=right，中点在封闭端（+forward 侧）短边 [0,1] 上 */
    var ends = strips.filter(function (t) { return Math.abs(t.len - (s.w + 0.12)) < 0.02; });
    if (ends.length !== 1) out.push(id + ': 底端线数=' + ends.length + '（应为 1）');
    ends.forEach(function (t) {
      if (!alongR(t.dir)) out.push(id + ': 底端线方向偏离 right');
      var d = onSeg(t.cx, t.cz, poly[0][0], poly[0][1], poly[1][0], poly[1][1]);
      if (d > 0.02) out.push(id + ': 底端线离封闭端边 ' + d.toFixed(3) + 'm');
    });

    /* 3. 黄角标 8 臂：全部在框内、贴近四角（每角 2 臂） */
    var arms = strips.filter(function (t) { return Math.abs(t.len - 0.6) < 0.02; });
    if (arms.length !== 8) out.push(id + ': 角标臂数=' + arms.length + '（应为 8）');
    var corners = poly.map(function (p) { return [p[0], p[1]]; });
    arms.forEach(function (t) {
      if (!pointInPoly(t.cx, t.cz, poly)) out.push(id + ': 角标臂落在车位框外');
      var dmin = 99;
      corners.forEach(function (c) { dmin = Math.min(dmin, Math.hypot(t.cx - c[0], t.cz - c[1])); });
      if (dmin > 0.9) out.push(id + ': 角标臂离最近角 ' + dmin.toFixed(2) + 'm');
      if (!(alongF(t.dir) || alongR(t.dir))) out.push(id + ': 角标臂方向既非 forward 也非 right');
    });

    /* 4. P 字：1 片、居中、法线朝上、字头(+Y)指向 forward（入口方向正读） */
    if (pPlanes.length !== 1) out.push(id + ': P 贴片数=' + pPlanes.length + '（应为 1）');
    pPlanes.forEach(function (p) {
      if (!p.normalUp) out.push(id + ': P 贴片法线朝下（俯视看到背面会镜像）');
      if (Math.abs(dot(p.up, fwd) - 1) > 1e-6) out.push(id + ': P 字头未指向泊车方向（不正读）');
      if (Math.hypot(p.c[0] - s.x, p.c[1] - s.z) > 0.02) out.push(id + ': P 贴片未居中');
    });

    /* 5. 呼吸脉冲：黄标材质透明度始终在 [0.55, 1] 且确有起伏（跑 3+ 个周期采样） */
    if (typeof world.tick !== 'function') out.push(id + ': 缺 tick 句柄');
    else {
      var markMats = [];   // 角标 8 臂共享同一材质实例（脉冲统一驱动），按身份去重
      world.group.traverse(function (n) {
        if (n.material instanceof THREE.MeshBasicMaterial && n.material.transparent && !n.material.map) {
          if (markMats.indexOf(n.material) < 0) markMats.push(n.material);
        }
      });
      var oMin = 9, oMax = -9;
      for (var k = 0; k < 360; k++) {   // 6s ≈ 3.4 个周期
        world.tick(1 / 60);
        markMats.forEach(function (mm) {
          oMin = Math.min(oMin, mm.opacity); oMax = Math.max(oMax, mm.opacity);
        });
      }
      if (markMats.length !== 1) out.push(id + ': 角标黄标材质数=' + markMats.length + '（应为 1，供脉冲统一驱动）');
      if (oMin < 0.55 - 1e-6 || oMax > 1 + 1e-6) out.push(id + ': 脉冲透明度越界 [' + oMin.toFixed(2) + ',' + oMax.toFixed(2) + ']');
      if (oMax - oMin < 0.3) out.push(id + ': 脉冲无起伏（Δ=' + (oMax - oMin).toFixed(2) + '）');
    }

    world.dispose();
  });
  return out;
}

if (require.main === module) {
  var found = check();
  if (found.length) {
    console.error('车位标线校验未通过：');
    found.forEach(function (f) { console.error('  - ' + f); });
    process.exit(1);
  }
  console.log('车位标线校验通过：' + global.PS.Levels.LEVELS.length + ' 关全部贴合');
}
module.exports = { check: check };
