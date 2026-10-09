/* debug_wxui.html 的 frame 模式入口（仅调试页加载，不进正式构建）
 * 用 ui_wx 的公开 API 驱动全部界面，鼠标翻译成触摸总线事件；
 * 与微信端差异仅"画布直上屏 + rAF 驱动 tick"（微信端是贴图合成 + presentOverlay）。 */
(function () {
  var PS = window.PS;
  var game = {
    keys: {}, state: 'menu', cfg: PS.CONFIG,
    touchAnalog: { steer: 0 },   // 触屏方向盘模拟量（与 game.js Game 实例同形）
    audio: { unlock: function () {} },
    pause: function () { hud.showPause(function () {}, function () {}, function () {}); this.state = 'paused'; },
    resume: function () { hud.hideScreen(); this.state = 'playing'; },
    toggleGuide: function () { this.assist.guide = !this.assist.guide; },
    toggleTop: function () { this.assist.top = !this.assist.top; },
    toggleRevCam: function () { this.assist.revCam = !this.assist.revCam; },
    assist: { guide: true, top: false, revCam: true }
  };
  var hud = PS.UiWx.createHud(game);
  PS.UiWx.buildTouchControls(game);
  game._tcSetVisible(false);
  var ui = PS.UiWx.__ui();

  /* UI 画布直上屏（frame 模式 body 只有这一块画布） */
  var cv = ui.canvas;
  cv.style.position = 'absolute';
  cv.style.inset = '0';
  document.body.appendChild(cv);

  /* 鼠标 → 触摸总线事件（与 wx.onTouch* 同构） */
  var mouseId = 99;
  function pt(e) {
    var r = cv.getBoundingClientRect();
    return { identifier: mouseId, clientX: e.clientX - r.left, clientY: e.clientY - r.top };
  }
  cv.addEventListener('mousedown', function (e) {
    var t = pt(e);
    PS.UiWx.__dispatch('start', { touches: [t], changedTouches: [t] });
    e.preventDefault();
  });
  window.addEventListener('mousemove', function (e) {
    var t = pt(e);
    PS.UiWx.__dispatch('move', { touches: [t], changedTouches: [t] });
  });
  window.addEventListener('mouseup', function (e) {
    var t = pt(e);
    PS.UiWx.__dispatch('end', { touches: [], changedTouches: [t] });
  });

  /* rAF 驱动（微信端由 presentOverlay 每渲染帧驱动） */
  (function loop() { PS.UiWx.tick(performance.now() / 1000); requestAnimationFrame(loop); })();

  /* 驾驶态假数据：让 HUD 数值/雷达动起来 */
  var playT0 = 0;
  setInterval(function () {
    if (!ui.hud.visible) return;
    var t = (performance.now() / 1000 - playT0);
    var radar = 1.9 + Math.sin(t * 0.7) * 1.6;
    hud.update({
      time: t, collisions: Math.floor(t / 7) % 5,
      gear: (Math.floor(t / 4) % 2) ? 'R' : 'D',
      speed: (Math.floor(t / 4) % 2 ? -1 : 1) * (4 + Math.sin(t) * 3),
      radar: radar, radarRange: 2.5,
      hint: ['看右后视镜，库角出现回方向', '很好！停稳保持…', '转向灯右'][Math.floor(t / 3) % 3],
      assistText: (game.assist.guide ? '引导✓' : '') + (game.assist.top ? ' 俯视✓' : '') + (game.assist.revCam ? ' 倒影✓' : '')
    });
    /* 功能钮高亮同步（真实流程由 game.syncTouchFnButtons 驱动） */
    PS.Ui && PS.Ui.syncFnButtons && PS.Ui.syncFnButtons(game);
  }, 120);

  /* 外层壳的界面切换入口 */
  var levels = PS.Levels.LEVELS;
  window.__show = function (which) {
    game.state = which === 'play' ? 'playing' : 'menu';
    if (which === 'play') {
      hud.hideScreen();
      hud.showHud(levels[2], { maxColl: 5 });
      playT0 = performance.now() / 1000;
      game._tcSetVisible(true);
    } else {
      game._tcSetVisible(false);
      hud.hideHud();
      if (which === 'menu') hud.showMainMenu(function () {}, function () {}, {
        label: '继续训练 · 第 3 关 ' + levels[2].name, cb: function () {}
      });
      else if (which === 'select') hud.showLevelSelect(PS.Progress.unlockMap(levels, {}), function () {}, function () {});
      else if (which === 'briefing') hud.showBriefing(levels[5], function () {}, function () {});
      else if (which === 'result') hud.showResult(levels[2],
        { stars: 3, score: 95, posOffset: 0.008, devDeg: 1.2, collisions: 0, time: 33.3 },
        function () {}, function () {}, function () {}, true);
      else if (which === 'pause') hud.showPause(function () {}, function () {}, function () {});
    }
  };
  window.__show('menu');
})();
