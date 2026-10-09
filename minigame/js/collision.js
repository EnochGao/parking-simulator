/* js/collision.js · 微信小游戏模块（tools/build_wx.js 生成，勿手改） */
var window = GameGlobal, self = GameGlobal;   /* UMD 根 → 跨模块共享全局 */
var module, exports, define;                  /* 声明以捕获外层泄露 */
module = exports = define = undefined;        /* 强制浏览器分支（var 对参数式包装无效） */
/* 碰撞检测：2D OBB + SAT 分离轴定理（Node/浏览器双端通用）
 * OBB: {x, z, angle, hw, hl}  hw=半宽(局部x) hl=半长(局部z) angle=朝向 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.PS = root.PS || {}; root.PS.Collision = api; }
})(typeof self !== 'undefined' ? self : this, function () {

  function makeObb(x, z, angle, hw, hl) {
    // br = 包围圆半径：firstHit 用它做距离粗筛，SAT 前跳过远端障碍（每帧 ~60 次 × 全障碍）
    // ca/sa = 预算的 cos/sin(angle)：障碍静止、车辆 OBB 每步只转一次——
    // SAT 每次重叠测试原本要现算 16 次三角函数（4 轴 × 2 盒 × cos+sin），缓存后归零
    return { x: x, z: z, angle: angle, hw: hw, hl: hl, ca: Math.cos(angle), sa: Math.sin(angle), br: Math.hypot(hw, hl) };
  }

  /** 原地刷新 OBB（热路径零分配）：车辆 OBB 每步挪动时复用同一对象（sim/pushOut） */
  function setObb(o, x, z, angle, hw, hl) {
    o.x = x; o.z = z; o.angle = angle; o.hw = hw; o.hl = hl;
    o.ca = Math.cos(angle); o.sa = Math.sin(angle); o.br = Math.hypot(hw, hl);
    return o;
  }

  /** 读缓存的 cos/sin（兼容手工构造、无 ca/sa 字段的 OBB） */
  function obbCa(o) { return o.ca != null ? o.ca : (o.ca = Math.cos(o.angle)); }
  function obbSa(o) { return o.sa != null ? o.sa : (o.sa = Math.sin(o.angle)); }

  function carObb(x, z, heading, carCfg) {
    return makeObb(x, z, heading, carCfg.width / 2, carCfg.length / 2);
  }

  /** OBB 四角 [ [x,z] x4 ] */
  function corners(o) {
    var c = obbCa(o), s = obbSa(o);
    // 局部 x 轴（右）= (c, -s)?  局部 z 轴（前）= (s, c)
    var fx = s, fz = c, rx = c, rz = -s;
    var hw = o.hw, hl = o.hl;
    return [
      [o.x + rx * hw + fx * hl, o.z + rz * hw + fz * hl],
      [o.x + rx * hw - fx * hl, o.z + rz * hw - fz * hl],
      [o.x - rx * hw - fx * hl, o.z - rz * hw - fz * hl],
      [o.x - rx * hw + fx * hl, o.z - rz * hw + fz * hl]
    ];
  }

  /* SAT 轴缓存（模块级复用；Node/浏览器均单线程）：4 条测试轴 = a 的右/前轴 + b 的右/前轴 */
  var AXES = new Float64Array(8);
  function setAxes(a, b) {
    var ac = obbCa(a), as = obbSa(a);
    var bc = obbCa(b), bs = obbSa(b);
    AXES[0] = ac; AXES[1] = -as;   // a 右
    AXES[2] = as; AXES[3] = ac;    // a 前
    AXES[4] = bc; AXES[5] = -bs;   // b 右
    AXES[6] = bs; AXES[7] = bc;    // b 前
  }

  /** 盒沿单位轴 (ax,az) 的投影半宽 = hw|轴·右| + hl|轴·前|。
   *  中心对称盒的投影区间 = 中心投影 ∓ 半宽，可解析计算——
   *  SAT 热路径因此零数组分配（旧实现每次现算两盒 4 角点再逐点投影） */
  function projHalf(ax, az, o) {
    var c = obbCa(o), s = obbSa(o);
    return o.hw * Math.abs(c * ax - s * az) + o.hl * Math.abs(s * ax + c * az);
  }

  /** 两盒在单位轴 (ax,az) 上的投影重叠量；< 0 = 在该轴分离（SAT 可提前退出）。
   *  == 0 为恰好接触，沿用旧 overlap1D 的 <= 语义：算相交 */
  function axisOverlap(ax, az, a, b) {
    var ea = projHalf(ax, az, a), eb = projHalf(ax, az, b);
    var ca = a.x * ax + a.z * az, cb = b.x * ax + b.z * az;
    return Math.min(ca + ea, cb + eb) - Math.max(ca - ea, cb - eb);
  }

  /** SAT：两 OBB 是否相交 */
  function obbOverlap(a, b) {
    setAxes(a, b);
    for (var i = 0; i < 4; i++) {
      if (axisOverlap(AXES[i * 2], AXES[i * 2 + 1], a, b) < 0) return false;
    }
    return true;
  }

  /** 点是否在凸多边形内（顶点按序） */
  function pointInConvex(px, pz, poly) {
    var n = poly.length;
    for (var i = 0; i < n; i++) {
      var a = poly[i], b = poly[(i + 1) % n];
      var cross = (b[0] - a[0]) * (pz - a[1]) - (b[1] - a[1]) * (px - a[0]);
      if (cross < 0) return false; // 要求多边形为逆时针或统一方向
    }
    return true;
  }

  /** 车辆四角是否全部位于车位多边形内 */
  function carInsidePoly(x, z, heading, carCfg, poly) {
    var cs = corners(carObb(x, z, heading, carCfg));
    for (var i = 0; i < 4; i++) {
      if (!pointInConvex(cs[i][0], cs[i][1], poly)) return false;
    }
    return true;
  }

  /** 车辆是否与任一障碍物相交，返回相交的障碍物索引，无则 -1。
   *  先做包围圆粗筛（缺 br 字段的 OBB 自动回退全量 SAT，NaN 比较为 false 不会误跳过） */
  function firstHit(carO, obstacles) {
    var brA = carO.br != null ? carO.br : Math.hypot(carO.hw, carO.hl);
    for (var i = 0; i < obstacles.length; i++) {
      var o = obstacles[i];
      var brB = o.br != null ? o.br : Math.hypot(o.hw, o.hl);
      var dx = carO.x - o.x, dz = carO.z - o.z, rr = brA + brB;
      if (dx * dx + dz * dz > rr * rr) continue;
      if (obbOverlap(carO, o)) return i;
    }
    return -1;
  }

  /**
   * SAT 最小平移向量（MTV）：把 a 沿重叠最小的轴推出 b 的方向与距离。
   * 返回 {dx, dz, depth}；两 OBB 不相交时 depth=0。
   */
  function minPushOut(a, b) {
    setAxes(a, b);
    var best = Infinity, bx = 0, bz = 0;
    for (var i = 0; i < 4; i++) {
      var ax = AXES[i * 2], az = AXES[i * 2 + 1];
      var ovl = axisOverlap(ax, az, a, b);
      if (ovl <= 0) return { dx: 0, dz: 0, depth: 0 };
      // 以投影区间中点决定推出方向（稳定，避免中心重合时抖动）
      var sgn = (a.x * ax + a.z * az) >= (b.x * ax + b.z * az) ? 1 : -1;
      if (ovl < best) { best = ovl; bx = ax * sgn; bz = az * sgn; }
    }
    return { dx: bx * best, dz: bz * best, depth: best };
  }

  /**
   * 碰撞位置修正：沿最小穿透方向逐次推出，避免车身嵌入障碍物（穿模）。
   * 游戏内 postStep 与无头回归（autopilot）共用同一实现，两处行为不会漂移。
   * pose: {x,z}（就地修改）；heading 弧度；最多尝试 5 次推出。
   * 迭代用模块级暂存 OBB（单线程独占，不与 sim 的车辆 OBB 共用对象）。
   */
  var _pushO = { x: 0, z: 0, angle: 0, hw: 1, hl: 1, ca: 1, sa: 0, br: 0 };
  function pushOut(pose, heading, carCfg, obstacles) {
    for (var it = 0; it < 5; it++) {
      var obb = setObb(_pushO, pose.x, pose.z, heading, carCfg.width / 2, carCfg.length / 2);
      var hi = firstHit(obb, obstacles);
      if (hi < 0) break;
      var push = minPushOut(obb, obstacles[hi]);
      pose.x += push.dx;
      pose.z += push.dz;
    }
    return pose;
  }

  return {
    makeObb: makeObb,
    setObb: setObb,
    carObb: carObb,
    corners: corners,
    obbOverlap: obbOverlap,
    pointInConvex: pointInConvex,
    carInsidePoly: carInsidePoly,
    firstHit: firstHit,
    minPushOut: minPushOut,
    pushOut: pushOut
  };
});