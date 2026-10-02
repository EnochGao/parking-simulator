/* 碰撞检测：2D OBB + SAT 分离轴定理（Node/浏览器双端通用）
 * OBB: {x, z, angle, hw, hl}  hw=半宽(局部x) hl=半长(局部z) angle=朝向 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.PS = root.PS || {}; root.PS.Collision = api; }
})(typeof self !== 'undefined' ? self : this, function () {

  function makeObb(x, z, angle, hw, hl) {
    // br = 包围圆半径：firstHit 用它做距离粗筛，SAT 前跳过远端障碍（每帧 ~60 次 × 全障碍）
    return { x: x, z: z, angle: angle, hw: hw, hl: hl, br: Math.hypot(hw, hl) };
  }

  function carObb(x, z, heading, carCfg) {
    return makeObb(x, z, heading, carCfg.width / 2, carCfg.length / 2);
  }

  /** OBB 四角 [ [x,z] x4 ] */
  function corners(o) {
    var c = Math.cos(o.angle), s = Math.sin(o.angle);
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

  function projectAxis(pts, ax, az) {
    var min = Infinity, max = -Infinity;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i][0] * ax + pts[i][1] * az;
      if (p < min) min = p;
      if (p > max) max = p;
    }
    return [min, max];
  }

  function overlap1D(a, b) { return a[0] <= b[1] && b[0] <= a[1]; }

  /** SAT：两 OBB 是否相交 */
  function obbOverlap(a, b) {
    var ca = corners(a), cb = corners(b);
    var axes = [
      [Math.cos(a.angle), -Math.sin(a.angle)],
      [Math.sin(a.angle), Math.cos(a.angle)],
      [Math.cos(b.angle), -Math.sin(b.angle)],
      [Math.sin(b.angle), Math.cos(b.angle)]
    ];
    for (var i = 0; i < 4; i++) {
      var pa = projectAxis(ca, axes[i][0], axes[i][1]);
      var pb = projectAxis(cb, axes[i][0], axes[i][1]);
      if (!overlap1D(pa, pb)) return false;
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
    var ca = corners(a), cb = corners(b);
    var axes = [
      [Math.cos(a.angle), -Math.sin(a.angle)],
      [Math.sin(a.angle), Math.cos(a.angle)],
      [Math.cos(b.angle), -Math.sin(b.angle)],
      [Math.sin(b.angle), Math.cos(b.angle)]
    ];
    var best = Infinity, bx = 0, bz = 0;
    for (var i = 0; i < 4; i++) {
      var ax = axes[i][0], az = axes[i][1];
      var pa = projectAxis(ca, ax, az), pb = projectAxis(cb, ax, az);
      var ovl = Math.min(pa[1], pb[1]) - Math.max(pa[0], pb[0]);
      if (ovl <= 0) return { dx: 0, dz: 0, depth: 0 };
      // 以投影区间中点决定推出方向（稳定，避免中心重合时抖动）
      var s = (pa[0] + pa[1]) >= (pb[0] + pb[1]) ? 1 : -1;
      if (ovl < best) { best = ovl; bx = ax * s; bz = az * s; }
    }
    return { dx: bx * best, dz: bz * best, depth: best };
  }

  return {
    makeObb: makeObb,
    carObb: carObb,
    corners: corners,
    obbOverlap: obbOverlap,
    pointInConvex: pointInConvex,
    carInsidePoly: carInsidePoly,
    firstHit: firstHit,
    minPushOut: minPushOut
  };
});
