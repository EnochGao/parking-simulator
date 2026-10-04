/* 评分与完成判定（Node/浏览器双端通用） */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.PS = root.PS || {}; root.PS.Scoring = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  var D2R = Math.PI / 180;

  function wrapDeg(d) {
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    return d;
  }

  /** 车身与车位朝向的偏差（0..90°，泊入方向 180° 对称） */
  function angleDevDeg(heading, spotAngle) {
    var d = wrapDeg((heading - spotAngle) / D2R);
    var dev = Math.abs(d);
    return Math.min(dev, 180 - dev);
  }

  /** 车位四边形写入共享暂存（热路径零分配；单线程同步消费，勿跨调用保留） */
  var POLY = [[0, 0], [0, 0], [0, 0], [0, 0]];
  var CPTS = [[0, 0], [0, 0], [0, 0], [0, 0]];   // evaluate 用：车四角暂存
  function spotPolyInto(spot, poly) {
    var a = spot.angle, c = Math.cos(a), s = Math.sin(a);
    // 前向(泊车方向)=(s,c)，右侧=(c,-s)
    var fx = s, fz = c, rx = c, rz = -s;
    var hw = spot.w / 2, hl = spot.l / 2;
    poly[0][0] = spot.x + rx * hw + fx * hl; poly[0][1] = spot.z + rz * hw + fz * hl;
    poly[1][0] = spot.x - rx * hw + fx * hl; poly[1][1] = spot.z - rz * hw + fz * hl;
    poly[2][0] = spot.x - rx * hw - fx * hl; poly[2][1] = spot.z - rz * hw - fz * hl;
    poly[3][0] = spot.x + rx * hw - fx * hl; poly[3][1] = spot.z + rz * hw - fz * hl;
    return poly;
  }

  /** spot: {x,z,angle,w,l} → 车位四边形（顶点顺序统一，用于内点判定）。
   *  公共 API 新建返回（调用方可任意保留）；evaluate 热路径走 spotPolyInto 共享暂存 */
  function spotPoly(spot) {
    return spotPolyInto(spot, [[0, 0], [0, 0], [0, 0], [0, 0]]);
  }

  /**
   * 评估当前停放状态
   * args: {x,z,heading, spot, collisions, time, par, carCfg, cfg}
   */
  function evaluate(args) {
    var C = args.cfg, car = args.carCfg;
    var poly = spotPolyInto(args.spot, POLY);
    var devDeg = angleDevDeg(args.heading, args.spot.angle);
    var posOff = Math.hypot(args.x - args.spot.x, args.z - args.spot.z);

    // 四角检测（用碰撞模块会引入循环依赖，这里内联凸多边形判断）。
    // pts 用模块级暂存：车位附近每物理步调用一次，旧实现每次 10 个小数组 ≈600 个/秒
    var inside = false;
    if (devDeg <= C.completeAngleDeg) {
      var c = Math.cos(args.heading), s2 = Math.sin(args.heading);
      var fx = s2, fz = c, rx = c, rz = -s2;
      var hw = car.width / 2, hl = car.length / 2;
      var pts = CPTS;
      pts[0][0] = args.x + rx * hw + fx * hl; pts[0][1] = args.z + rz * hw + fz * hl;
      pts[1][0] = args.x + rx * hw - fx * hl; pts[1][1] = args.z + rz * hw - fz * hl;
      pts[2][0] = args.x - rx * hw - fx * hl; pts[2][1] = args.z - rz * hw - fz * hl;
      pts[3][0] = args.x - rx * hw + fx * hl; pts[3][1] = args.z - rz * hw + fz * hl;
      inside = true;
      for (var i = 0; i < 4; i++) {
        if (!inConvex(pts[i][0], pts[i][1], poly)) { inside = false; break; }
      }
    }

    var completed = inside && devDeg <= C.completeAngleDeg;

    // 打分
    var posPts = C.posMaxPts - Math.max(0, (posOff - C.posFullM) * 100) * C.posPerCm;
    posPts = Math.max(0, Math.min(C.posMaxPts, posPts));
    var angPts = C.angMaxPts - Math.max(0, devDeg - C.angFullDeg) * C.angPerDeg;
    angPts = Math.max(0, Math.min(C.angMaxPts, angPts));
    var colPen = 0;
    if (args.collisions > 0) {
      colPen = Math.min(C.colMaxPenalty, C.colFirst + (args.collisions - 1) * C.colEach);
    }
    var timeBonus = 0;
    if (args.par && args.time < args.par) {
      timeBonus = Math.round(C.timeBonusMax * (1 - args.time / args.par));
    }
    var score = Math.round(posPts + angPts + (C.colMaxPenalty - colPen) + timeBonus);
    score = Math.max(0, Math.min(100 + C.timeBonusMax, score));

    return {
      completed: completed,
      inside: inside,
      devDeg: devDeg,
      posOffset: posOff,
      collisions: args.collisions,
      time: args.time,
      posPts: Math.round(posPts), angPts: Math.round(angPts),
      colPenalty: colPen, timeBonus: timeBonus,
      score: score,
      stars: starsFor(score, args.collisions, C)
    };
  }

  function starsFor(score, collisions, C) {
    if (collisions >= C.maxCollisions) return 0;
    if (score >= 90 && collisions === 0) return 3;
    if (score >= 70) return 2;
    if (score >= C.passScore) return 1;
    return 0;
  }

  function inConvex(px, pz, poly) {
    for (var i = 0; i < poly.length; i++) {
      var a = poly[i], b = poly[(i + 1) % poly.length];
      var cr = (b[0] - a[0]) * (pz - a[1]) - (b[1] - a[1]) * (px - a[0]);
      if (cr < 0) return false;
    }
    return true;
  }

  return {
    evaluate: evaluate,
    starsFor: starsFor,
    angleDevDeg: angleDevDeg,
    spotPoly: spotPoly
  };
});
