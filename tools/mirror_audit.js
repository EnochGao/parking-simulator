/* 后视镜/倒车影像 · 真实世界逻辑几何审计（Node 无头，无需 WebGL）
 * 运行：node tools/mirror_audit.js
 *
 * 对照的真实世界依据：
 *  - GB 15084 / UN R46（间接视野装置）：Ⅰ类车内镜——应看到车辆纵向对称面两侧各 10m
 *    （总宽 20m）的路面，从眼点后方 60m 一直延伸到地平线；Ⅲ类外后视镜（M1）——
 *    每侧应看到从车身最外缘向外 4m 宽、从眼点后方 20m 到地平线的路面，另有自眼点
 *    后方 4m 起、沿车身侧 1m 宽的近侧条带；镜面最小尺寸：Ⅰ类 40×150mm（平面镜）、
 *    Ⅲ类 40×130mm 且 b≥70mm。眼点取 R 点上方 635mm。
 *  - FMVSS 111（倒车影像 rear visibility）惯例：车尾后方 0.3m 起的近地长条应可见，
 *    相机广角、装于车尾中部约车牌高度、画面水平镜像。
 *  - 真实车辆特征：贴近车尾的正后方处于两侧外镜视野之外（盲区），由内镜/倒影补足。
 *
 * 判定方式：把要求区域采样成地面点，逐点做相机视锥包含测试（不考虑遮挡，法规
 * 允许 ≤10% 遮挡；本车模型侧后方无大面积遮挡件）。 */
'use strict';
var path = require('path');
global.self = global;
global.window = global;
global.THREE = require(path.join(__dirname, '..', 'vendor', 'three.min.js'));
/* UMD 模块在 Node 下走 module.exports 分支（浏览器端才挂 PS 全局），此处手动组装 */
var PS = global.PS = {};
var CFG = require(path.join(__dirname, '..', 'js', 'config.js'));
PS.CONFIG = CFG; PS.VIEW = CFG.VIEW; PS.CAR = CFG.CAR;
PS.Cockpit = require(path.join(__dirname, '..', 'js', 'cockpit.js'));
var D2R = Math.PI / 180;

var passed = 0, failed = 0, failures = [];
function check(name, cond, extra) {
  if (cond) passed++; else { failed++; failures.push(name + (extra ? '  [' + extra + ']' : '')); }
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (cond ? '' : '  [' + (extra || '') + ']'));
}

/* ---- 无头构建镜面组（buildMirrors 只创建对象，不触 WebGL） ---- */
var carGroup = new THREE.Group();
var mirrorH = PS.Cockpit.buildMirrors(carGroup, null, [], []);
var mirrors = mirrorH.mirrors;   // [左外, 右外, 车内]
var extL = mirrors[0], extR = mirrors[1], intM = mirrors[2];
var revCam = mirrorH.revCam, revPlane = mirrorH.revPlane;

carGroup.updateMatrixWorld(true);

/** 相机视锥包含测试（忽略遮挡）：点在相机局部系中需位于近远平面之间，
 *  且 x/y 除以深度后落在 ±tan(halfFov) 内。 */
function sees(cam, wx, wy, wz) {
  var p = cam.worldToLocal(new THREE.Vector3(wx, wy, wz));
  if (p.z >= -cam.near || p.z <= -cam.far) return false;
  var vHalfTan = Math.tan(cam.fov / 2 * D2R);
  var hHalfTan = Math.tan(cam.fov / 2 * D2R) * cam.aspect;
  return Math.abs(p.x / -p.z) < hHalfTan && Math.abs(p.y / -p.z) < vHalfTan;
}

console.log('== 1. 镜面尺寸 ≥ GB 15084 最小内接矩形 ==');
var intW = intM.plane.geometry.parameters.width, intH = intM.plane.geometry.parameters.height;
var extW = extL.plane.geometry.parameters.width, extH = extL.plane.geometry.parameters.height;
check('Ⅰ类车内镜 ≥ 40×150mm（平面镜）', intH >= 0.040 && intW >= 0.150, (intW * 1000) + '×' + (intH * 1000) + 'mm');
check('Ⅲ类外后视镜 ≥ 40×130mm 且 b≥70mm', extH >= 0.040 && extW >= 0.130 && extH >= 0.070, (extW * 1000) + '×' + (extH * 1000) + 'mm');

console.log('== 2. 镜像翻转（真实镜面水平翻转；倒影同惯例） ==');
mirrors.forEach(function (m, i) {
  check('镜 ' + i + ' plane.scale.x = -1', m.plane.scale.x === -1);
});
check('倒影屏 plane.scale.x = -1', revPlane.scale.x === -1);

console.log('== 3. 相机挂载（随车移动）与安装位 ==');
mirrors.forEach(function (m, i) {
  check('镜 ' + i + ' 相机挂 carGroup（随车移动）', m.cam.parent === carGroup);
});
check('倒影相机挂 carGroup（随车移动）', revCam.parent === carGroup);
check('外镜高度在腰线附近 0.9~1.3m', extL.cam.position.y > 0.9 && extL.cam.position.y < 1.3, 'y=' + extL.cam.position.y.toFixed(2));
check('内镜高度在风挡顶部 1.2~1.5m', intM.cam.position.y > 1.2 && intM.cam.position.y < 1.5, 'y=' + intM.cam.position.y.toFixed(2));
check('倒影相机装车尾中部、车牌高度 0.6~1.2m', Math.abs(revCam.position.x) < 0.1 && revCam.position.y > 0.6 && revCam.position.y < 1.2 && revCam.position.z < -1.5,
  'y=' + revCam.position.y.toFixed(2) + ' z=' + revCam.position.z.toFixed(2));
check('倒影相机俯视 10~40°', revCam.rotation.x < -10 * D2R && revCam.rotation.x > -40 * D2R, (revCam.rotation.x / D2R).toFixed(0) + '°');

console.log('== 4. 朝向符合真实职责 ==');
// 偏航角约定：dir 为相机世界朝向，atan2(dir.x, -dir.z) 以"正后方"为 0°、车左为正
function yawDeg(cam) { var d = cam.getWorldDirection(new THREE.Vector3()); return Math.atan2(d.x, -d.z) / D2R; }
check('内镜正对车后（|偏航|≤5°）', Math.abs(yawDeg(intM.cam)) <= 5, yawDeg(intM.cam).toFixed(1) + '°');
var yl = yawDeg(extL.cam), yr = yawDeg(extR.cam);
check('左外镜朝后偏外 15~35°（覆盖左侧邻道）', yl > 15 && yl < 35, yl.toFixed(1) + '°');
check('右外镜与左侧对称（-15~-35°）', yr < -15 && yr > -35, yr.toFixed(1) + '°');
check('左右外镜完全对称（真实车辆左右对称）',
  Math.abs(Math.abs(extL.grp.position.x) - Math.abs(extR.grp.position.x)) < 1e-6 &&
  Math.abs(Math.abs(extL.cam.position.x) - Math.abs(extR.cam.position.x)) < 1e-6 &&
  Math.abs(extL.cam.position.y - extR.cam.position.y) < 1e-6 &&
  Math.abs(Math.abs(yl) - Math.abs(yr)) < 1e-6);

console.log('== 5. Ⅲ类外镜视野覆盖（UN R46 / GB 15084，眼点后 20m 至远处 4m 宽区 + 4m 起 1m 近侧条带） ==');
var eyeY = PS.CONFIG.CAR.seatY, halfW = PS.CONFIG.CAR.width / 2;
[[extL, 1], [extR, -1]].forEach(function (pair) {
  var m = pair[0], s = pair[1], side = s > 0 ? '左' : '右';
  var okA = true, firstBadA = null;
  [20, 30, 50, 80].forEach(function (dBehind) {
    [-1.9, 0, 1.9].forEach(function (wOff) {   // 4m 宽区内 3 个采样
      var x = s * (halfW + 0.1 + (wOff + 1.9) / 3.8 * 3.8); // 车最外缘外 0.1~3.9m
      var wz = PS.CONFIG.CAR.seatZ - dBehind;
      if (!sees(m.cam, x, 0, wz)) { okA = false; firstBadA = 'd=' + dBehind + ' x=' + x.toFixed(2); }
    });
  });
  check(side + '外镜：车侧外 4m 宽 × 眼点后 20m+ 区（地面）', okA, firstBadA);
  var okB = true, firstBadB = null;
  [4, 6, 10, 15, 20].forEach(function (dBehind) {
    [0.15, 0.9].forEach(function (wOff) {      // 近侧 1m 条带 2 个采样
      var x = s * (halfW + wOff);
      var wz = PS.CONFIG.CAR.seatZ - dBehind;
      if (!sees(m.cam, x, 0, wz)) { okB = false; firstBadB = 'd=' + dBehind + ' x=' + x.toFixed(2); }
    });
  });
  check(side + '外镜：沿车身侧 1m 宽近侧条带（眼点后 4m 起）', okB, firstBadB);
});

console.log('== 6. Ⅰ类内镜视野覆盖（对称面两侧各 10m，眼点后 60m 至地平线） ==');
// 采样点控制在镜相机远平面（160m，与场景雾效截止一致）之内
check('内镜相机远平面 ≥150m（地平线在渲染范围内）', intM.cam.far >= 150, 'far=' + intM.cam.far);
var okI = true, firstBadI = null;
[[0, -60], [-10, -60], [10, -60], [0, -100], [-10, -100], [10, -100], [-10, -150], [10, -150]].forEach(function (pt) {
  if (!sees(intM.cam, pt[0], 0, pt[1])) { okI = false; firstBadI = 'ground ' + pt; }
});
check('内镜：60~150m 外 ±10m 宽地面区（法规近缘 60m 起已全包含）', okI, firstBadI);
check('内镜：地平线可见（150m 远、与眼同高点）', sees(intM.cam, 0, eyeY, -150));
var okNear = true;
[[-3, -8], [3, -8], [0, -7]].forEach(function (pt) {
  if (!sees(intM.cam, pt[0], 0, pt[1])) okNear = false;
});
check('内镜：近处（6~8m）正后方地面可见（泊车实用）', okNear);

console.log('== 7. 真实盲区特征：贴近车尾的正后方不在两侧外镜内（由内镜/倒影补足） ==');
var bzL = sees(extL.cam, 0, 0.5, -4.5), bzR = sees(extR.cam, 0, 0.5, -4.5);
check('车尾后 2.5m 正中（0.5m 高）不在左外镜', !bzL);
check('车尾后 2.5m 正中（0.5m 高）不在右外镜', !bzR);
check('同一点在内镜可见', sees(intM.cam, 0, 0.5, -4.5));

console.log('== 8. 倒车影像（FMVSS 111 惯例：车尾后 0.3m 起近地可见、广角） ==');
// 直线投影相机近似：中心线从 0.3m 起全可见（真实 fisheye 靠畸变覆盖极限角，
// 模拟以 130° 级广角直线投影近似）；±1.5m 全宽从 ~0.7m 起可见；远区 ±3m。
var okR = true, firstBadR = null;
[0.3, 0.6, 1.5, 3, 6.1].forEach(function (dBehind) {
  var wz = -(PS.CONFIG.CAR.length / 2) - dBehind;
  if (!sees(revCam, 0, 0, wz)) { okR = false; firstBadR = 'center d=' + dBehind; }
});
check('倒影：车尾后 0.3~6.1m 中心线近地长条', okR, firstBadR);
var okW = true, firstBadW = null;
[1.0, 1.5, 3, 6.1].forEach(function (dBehind) {
  [-1.5, 1.5].forEach(function (wOff) {
    var wz = -(PS.CONFIG.CAR.length / 2) - dBehind;
    if (!sees(revCam, wOff, 0, wz)) { okW = false; firstBadW = 'd=' + dBehind + ' x=' + wOff; }
  });
});
check('倒影：1.0~6.1m 处 ±1.5m 全宽（FMVSS 111 近区宽度）', okW, firstBadW);
check('倒影：6.1m 处 ±3m 全宽（FMVSS 111 远区宽度）',
  sees(revCam, -3, 0, -(PS.CONFIG.CAR.length / 2) - 6.1) && sees(revCam, 3, 0, -(PS.CONFIG.CAR.length / 2) - 6.1));
var hFov = 2 * Math.atan(Math.tan(revCam.fov / 2 * D2R) * revCam.aspect) / D2R;
check('倒影广角（水平 ≥120°，真实倒车影像 130°+ 量级）', hFov >= 120, hFov.toFixed(0) + '°');

console.log('== 9. 渲染目标与显示面宽高比一致（无拉伸失真） ==');
mirrors.forEach(function (m, i) {
  var pa = m.plane.geometry.parameters.width / m.plane.geometry.parameters.height;
  var ra = m.rt.width / m.rt.height;
  check('镜 ' + i + ' RT 比例=镜面比例', Math.abs(ra - pa) / pa < 0.02, ra.toFixed(3) + ' vs ' + pa.toFixed(3));
});
var revPa = revPlane.geometry.parameters.width / revPlane.geometry.parameters.height;
var revRa = mirrorH.revRt.width / mirrorH.revRt.height;
check('倒影 RT 比例=屏面比例', Math.abs(revRa - revPa) / revPa < 0.02, revRa.toFixed(3) + ' vs ' + revPa.toFixed(3));

console.log('\n========== 后视镜/倒影审计结果 ==========');
console.log('通过: ' + passed + '  失败: ' + failed);
if (failed) { console.log('失败项:\n  ' + failures.join('\n  ')); process.exit(1); }
