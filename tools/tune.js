/* 调参诊断：逐关打印自动驾驶详细轨迹与末段姿态 */
'use strict';
var path = require('path');
var JS = path.join(__dirname, '..', 'js');
var LVL = require(path.join(JS, 'levels.js'));
var AUTO = require(path.join(JS, 'autopilot.js'));

var ids = process.argv.slice(2);
var levels = ids.length ? ids.map(function (i) { return LVL.byId(i); }).filter(Boolean) : LVL.LEVELS;

levels.forEach(function (lv) {
  var r = AUTO.runLevel(lv, { record: true });
  console.log('--- ' + lv.id + ' ' + lv.name + ' ---');
  console.log('  成功=' + r.success + ' 碰撞=' + r.collisions + ' 用时=' + r.time.toFixed(1) + 's 原因=' + r.reason);
  console.log('  末点=(' + r.final.x.toFixed(2) + ', ' + r.final.z.toFixed(2) + ') 朝向=' + (r.final.heading * 180 / Math.PI).toFixed(1) + '° 档=' + r.final.gear);
  if (r.result) {
    console.log('  偏差 pos=' + r.result.posOffset.toFixed(3) + 'm ang=' + r.result.devDeg.toFixed(2) + '° 得分=' + r.result.score + ' 星=' + r.result.stars);
  }
  // 输出每 2 秒的轨迹采样（调试用）
  if (r.path && process.env.VERBOSE) {
    var step = Math.max(1, Math.floor(r.path.length / 40));
    var line = [];
    for (var i = 0; i < r.path.length; i += step) {
      var p = r.path[i];
      line.push('(' + p.x.toFixed(1) + ',' + p.z.toFixed(1) + ',' + (p.h * 180 / Math.PI).toFixed(0) + ')');
    }
    console.log('  轨迹: ' + line.join(' '));
  }
});
