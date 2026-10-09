/* UI 调度器：按平台选择 HUD/触屏控件实现
 *   网页端：PS.Hud（DOM，style.css）+ game.js 内建 DOM 触屏控件——现网代码，原样复用
 *   小游戏端：PS.UiWx（离屏 2D canvas + 全屏贴图叠加，无 DOM 环境）
 * game.js 只调 PS.Ui.*，不感知实现。接口面与 hud.js 逐一对齐。 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.PS = root.PS || {}; root.PS.Ui = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  /* 命名空间探测：UMD 工厂内看不到外层 root 参数，按浏览器/bundle 两种环境取 PS */
  function NS() { return (typeof window !== 'undefined' && window.PS) || (typeof self !== 'undefined' && self.PS) || null; }
  function wxApi() { var PS = NS(); return PS && PS.UiWx ? PS.UiWx : null; }

  return {
    /** HUD/全屏界面实例（menu/select/briefing/result/pause/selftest 全套） */
    createHud: function (game, container) {
      var PS = NS(), Wx = wxApi();
      if (Wx && PS.Platform && PS.Platform.isWx) return Wx.createHud(game);
      return PS.Hud.createHud(container);
    },
    /** 虚拟驾驶控件（触屏设备）：实现方负责注册 game._tcSetVisible/_tcFns */
    buildTouchControls: function (game) {
      var PS = NS(), Wx = wxApi();
      if (Wx && PS.Platform && PS.Platform.isWx) { Wx.buildTouchControls(game); return; }
      game.buildTouchControls();
    },
    /** 虚拟控件显隐（仅驾驶态显示，避免浮在菜单/结算上误触） */
    setTouchControlsVisible: function (game, v) {
      if (game._tcSetVisible) game._tcSetVisible(v);
    },
    /** 触屏功能钮高亮同步（assist 开关态；非触屏实现为空操作） */
    syncFnButtons: function (game) {
      var fns = game._tcFns;
      if (!fns || !fns.g || !fns.g.setOn) return;
      fns.g.setOn(game.assist.guide);
      fns.m.setOn(game.assist.top);
      fns.c.setOn(game.assist.revCam);
    }
  };
});
