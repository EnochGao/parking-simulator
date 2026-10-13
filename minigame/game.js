/* 停车大师 ParkMaster · 微信小游戏入口（tools/build_wx.js 生成，勿手改）
 * 模块化结构：libs/ + js/ 各文件独立模块，经 GameGlobal.PS 命名空间互通；
 * 本入口只负责按序 require + 启动引导。 */
var __g = GameGlobal;
function __psFmt(e) {
  if (e == null) return 'null';
  if (typeof e === 'string') return e;
  var out = [];
  if (e.message) out.push(String(e.message));
  if (e.stack) out.push(String(e.stack).slice(0, 500));
  if (!out.length) { try { out.push(JSON.stringify(e)); } catch (x) { out.push(String(e)); } }
  return out.join('\n');
}
function __psAlert(title, msg) {
  try { wx.showModal({ title: title, content: __psFmt(msg).slice(0, 600), showCancel: false }); } catch (e) {}
}
/* 旧基础库兜底：无全局 performance/requestAnimationFrame/navigator 时每帧抛错 = 黑屏 */
if (!__g.performance || !__g.performance.now) __g.performance = { now: function () { return Date.now(); } };
if (!__g.requestAnimationFrame) __g.requestAnimationFrame = function (cb) { return setTimeout(function () { cb(Date.now()); }, 16); };
if (!__g.cancelAnimationFrame) __g.cancelAnimationFrame = function (id) { clearTimeout(id); };
if (!__g.navigator) __g.navigator = { getGamepads: null };   /* gamepad.js 每帧轮询的兜底 */

/* ---- 模块加载（顺序 = index.html 加载序） ---- */
require('./libs/three.min.js');
require('./js/platform.js');
require('./js/config.js');
require('./js/physics.js');
require('./js/collision.js');
require('./js/scoring.js');
require('./js/pulse.js');
require('./js/sim.js');
require('./js/demo_paths.js');
require('./js/level_kit.js');
require('./js/levels/basic.js');
require('./js/levels/advanced.js');
require('./js/levels/challenge.js');
require('./js/levels.js');
require('./js/autopilot.js');
require('./js/progress.js');
require('./js/input.js');
require('./js/textures.js');
require('./js/carModel.js');
require('./js/world.js');
require('./js/cockpit.js');
require('./js/assist.js');
require('./js/ui_wx.js');
require('./js/ui.js');
require('./js/gamepad.js');
require('./js/carRig.js');
require('./js/game.js');

/* ---- 启动引导（启动/运行异常屏显上报：真机黑屏直接变成可见的错误弹窗） ---- */
try {
  var PS = __g.PS;
  PS.Platform.init();  /* 正式包：完整启动 */
  wx.onError && wx.onError(function (msg) {
    __g.__PS_ERR = __psFmt(msg);
    if (!__g.__PS_ERR_SHOWN) { __g.__PS_ERR_SHOWN = 1; __psAlert('运行错误', __g.__PS_ERR); }
  });
  var game = new PS.Game(null);
  __g.__game = game;
  game.toMenu();
} catch (e) {
  __g.__PS_BOOT_ERR = String((e && e.stack) || e);
  __psAlert('启动失败', __g.__PS_BOOT_ERR);
}
