/* 入口：初始化游戏，处理 URL 参数
 * ?level=lv03        直接进入关卡
 * ?autotest=lv03     进入关卡并由标准答案演示驾驶
 * ?selftest=all      浏览器端全关卡回归（结果写入 document.title 与 window.__SELFTEST_RESULTS）
 * ?mirrortest=1      后视镜/倒车影像渲染回读自测（结果写入 window.__MIRROR_RESULTS）
 * ?cockpittest=1     座舱转向联动自测：方向盘↔车轮↔车标（window.__COCKPIT_RESULTS）
 * ?unlock=1          解锁全部关卡（自由练习） */
(function () {
  var DT = 1 / 60;
  window.addEventListener('DOMContentLoaded', function () {
    var Game = window.PS.Game;
    var game = new Game(document.getElementById('app'));
    window.__game = game;

    var q = {};
    location.search.substring(1).split('&').forEach(function (kv) {
      var p = kv.split('=');
      if (p[0]) q[p[0]] = decodeURIComponent(p[1] || '');
    });

    if (q.selftest) {
      setTimeout(function () { game.selftest(q.selftest); }, 100);
      return;
    }
    if (q.mirrortest) {
      setTimeout(function () { game.selftestMirrors(); }, 100);
      return;
    }
    if (q.cockpittest) {
      setTimeout(function () { game.selftestCockpit(); }, 100);
      return;
    }
    if (q.autotest) {
      game.loadLevel(q.autotest, 'autotest');
      game.hud.hideScreen();
      game.state = 'playing';
      game.autopilotActive = true;
      var segs = window.PS.Levels.getPhases(game.level);
      game.replay = window.PS.Autopilot.createReplay(segs, DT, {
        x: game.level.player.x, z: game.level.player.z, h: game.level.player.a * Math.PI / 180
      });
      return;
    }
    if (q.level) {
      game.loadLevel(q.level, 'play');
      return;
    }
    game.toMenu();
  });
})();
