/* 依据用户截图的镜中布局反推玩家位姿：
 * 内后视镜（正后 ±25°）见白车略偏左 + 高楼正后；
 * 左外镜（正后偏左 24°±33°）中央是深色车、最左缘是白车；
 * 主视野正前方 ±25°、6~14m 有树，前方 ±40°、15m 内无车/楼。 */
'use strict';
var path = require('path');
var JS = path.join(__dirname, '..', 'js');
var CFG = require(path.join(JS, 'config.js'));
var LVL = require(path.join(JS, 'levels.js'));
var COL = require(path.join(JS, 'collision.js'));
var D2R = CFG.D2R;

function rel(px, pz, h, ox, oz) {
  var dx = ox - px, dz = oz - pz;
  // 车体系：前向 f=(sin h, cos h)，左向 l=(cos h, -sin h)
  var fx = Math.sin(h), fz = Math.cos(h);
  var lx = Math.cos(h), lz = -Math.sin(h);
  var f = dx * fx + dz * fz;   // 前向距离（负=在后）
  var l = dx * lx + dz * lz;   // 左向距离
  var back = -f;               // 车尾方向距离
  var az = Math.atan2(l, -f);  // 相对正后方的方位角（正=偏左），atan2(左分量, 后分量)
  var dist = Math.sqrt(dx * dx + dz * dz);
  return { back: back, left: l, az: az, dist: dist };
}

var results = [];
LVL.LEVELS.forEach(function (lv) {
  var obs = LVL.getObstacleObbs(lv);
  var cars = [], bldgs = [], trees = [];
  obs.forEach(function (o, i) {
    if (o.t === 'car') cars.push({ o: o, i: i, white: (i % 8) === 0, dark: (i % 8) === 1 });
    else if (o.t === 'bldg') bldgs.push(o);
    else if (o.t === 'tree') trees.push(o);
  });
  var whites = cars.filter(function (c) { return c.white; });
  var darks = cars.filter(function (c) { return c.dark; });
  var b = lv.bounds;
  for (var px = b.minX; px <= b.maxX; px += 0.5) {
    for (var pz = b.minZ; pz <= b.maxZ; pz += 0.5) {
      for (var hd = 0; hd < 360; hd += 5) {
        var h = hd * D2R;
        // 自车 OBB 不与任何障碍相交
        var obb = COL.carObb(px, pz, h, CFG.CAR);
        if (COL.firstHit(obb, obs) >= 0) continue;
        for (var w = 0; w < whites.length; w++) {
          var rw = rel(px, pz, h, whites[w].o.x, whites[w].o.z);
          // 内镜：白车在正后略偏左 3~12m
          if (rw.back < 3 || rw.back > 12) continue;
          if (rw.az < -14 * D2R || rw.az > 2 * D2R) continue;
          for (var d2 = 0; d2 < darks.length; d2++) {
            if (darks[d2].i === whites[w].i) continue;
            var rd = rel(px, pz, h, darks[d2].o.x, darks[d2].o.z);
            // 左镜中央：深色车偏左 12°~40°，3~10m
            if (rd.back < 3 || rd.back > 10) continue;
            if (rd.az < 12 * D2R || rd.az > 40 * D2R) continue;
            // 高楼在正后 ±20°，5~25m
            var hasBldg = bldgs.some(function (bl) {
              var rb = rel(px, pz, h, bl.x, bl.z);
              return rb.back > 4 && rb.back < 26 && Math.abs(rb.az) < 20 * D2R;
            });
            if (!hasBldg) continue;
            // 正前方有树 5~14m、±25°；前方 ±40° 15m 内无车
            var hasTree = trees.some(function (t) {
              var rt = rel(px, pz, h, t.x, t.z);
              return rt.back < 0 && rt.dist > 5 && rt.dist < 14 && Math.abs(Math.atan2(rt.left, -rt.back)) < 25 * D2R;
            });
            var carAhead = cars.some(function (c) {
              var rc = rel(px, pz, h, c.o.x, c.o.z);
              return rc.dist < 15 && rc.back < 0 && Math.abs(Math.atan2(rc.left, -rc.back)) < 40 * D2R;
            });
            if (!hasTree || carAhead) continue;
            // 直着倒 4m 是否撞白车（OBB 沿车尾方向扫掠）
            var hitDist = null;
            for (var s = 0.5; s <= 4.001; s += 0.25) {
              var bx = px + Math.sin(h) * -s, bz = pz + Math.cos(h) * -s;
              if (COL.firstHit(COL.carObb(bx, bz, h, CFG.CAR), obs) >= 0) { hitDist = s; break; }
            }
            results.push({
              lv: lv.id, px: +px.toFixed(1), pz: +pz.toFixed(1), hd: hd,
              whiteBack: +rw.back.toFixed(1), whiteAzL: +(rw.az / D2R).toFixed(0),
              darkBack: +rd.back.toFixed(1), darkAzL: +(rd.az / D2R).toFixed(0),
              hitAt: hitDist
            });
          }
        }
      }
    }
  }
});
// 每关最多打印 6 条
var byLv = {};
results.forEach(function (r) { (byLv[r.lv] = byLv[r.lv] || []).push(r); });
Object.keys(byLv).forEach(function (k) {
  console.log('== ' + k + ' ==');
  byLv[k].slice(0, 6).forEach(function (r) { console.log(JSON.stringify(r)); });
});
console.log('total', results.length);
