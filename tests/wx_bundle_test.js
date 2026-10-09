/* 小游戏包冒烟测试：mock wx 环境按 require 依赖加载模块化工程，验证
 *   1) 模块包装生效（GameGlobal.PS/THREE 命名空间就位，未误入 CommonJS 分支）
 *   2) platform 检测为小游戏端
 *   3) canvas UI 全套界面可构建/可绘制（mock 2d 上下文记录绘制调用）
 *   4) 触摸路由：菜单按钮抬起触发、虚拟驾驶键按住直写 keys
 *   5) 选关滚动布局 + 多分辨率（含 852x393）触控按钮两两不重叠
 * 运行：node tools/build_wx.js --smoke && node tests/wx_bundle_test.js（零依赖） */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var MGDIR = path.join(__dirname, '..', 'minigame');
var ENTRY = path.join(MGDIR, 'game.js');
if (!fs.existsSync(ENTRY)) {
  console.error('缺少 minigame/game.js，请先运行: node tools/build_wx.js --smoke');
  process.exit(1);
}
/* 本测试只吃 smoke 入口（不含 Game 构造）：构造要真建 WebGL，mock 环境跑不了。
 * 检测到正式入口就自动重建 smoke 版 */
if (fs.readFileSync(ENTRY, 'utf8').indexOf('new PS.Game') >= 0) {
  require('child_process').execSync('node tools/build_wx.js --smoke', { stdio: 'ignore', cwd: path.join(__dirname, '..') });
  console.log('检测到正式入口，已自动重建 smoke 产物');
}

var passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (extra ? '  [' + extra + ']' : '')); }
}

/* ---------- mock wx ---------- */
function mock2d() {
  var calls = { fillText: 0, fillRect: 0, strokes: 0 };
  var ctx = {};
  ['save', 'restore', 'translate', 'scale', 'rotate', 'setTransform', 'beginPath', 'closePath',
   'moveTo', 'lineTo', 'arc', 'arcTo', 'ellipse', 'rect', 'clip', 'fill', 'stroke',
   'clearRect', 'fillRect', 'strokeRect', 'drawImage', 'fillText', 'strokeText'
  ].forEach(function (m) { ctx[m] = function () { if (calls[m] != null) calls[m]++; }; });
  ctx.measureText = function (t) { return { width: String(t).length * 7 }; };
  ctx.createLinearGradient = function () { return { addColorStop: function () {} }; };
  ctx.createRadialGradient = function () { return { addColorStop: function () {} }; };
  ctx.__calls = calls;
  return ctx;
}
var storageMap = {};
var touchBuses = { start: [], move: [], end: [] };
var resizeCbs = [];
var devSize = { windowWidth: 812, windowHeight: 375, pixelRatio: 2, safeArea: { left: 0, top: 0, width: 812, height: 375 } };
var wx = {
  getSystemInfoSync: function () { return devSize; },
  getWindowInfo: function () { return devSize; },
  createCanvas: function () {
    return { width: 0, height: 0, getContext: function (t) { return t === '2d' ? mock2d() : {}; } };
  },
  onTouchStart: function (cb) { touchBuses.start.push(cb); },
  onTouchMove: function (cb) { touchBuses.move.push(cb); },
  onTouchEnd: function (cb) { touchBuses.end.push(cb); },
  onTouchCancel: function (cb) { touchBuses.end.push(cb); },
  onWindowResize: function (cb) { resizeCbs.push(cb); },
  onShow: function () {}, onHide: function () {},
  getLaunchOptionsSync: function () { return { query: {} }; },
  getStorageSync: function (k) { return storageMap[k] == null ? '' : storageMap[k]; },
  setStorageSync: function (k, v) { storageMap[k] = v; },
  createWebAudioContext: function () { return null; },
  onError: function () {}
};

/* ---------- 模块化加载：GameGlobal + require 加载器（模拟小游戏运行时） ---------- */
var sandbox = {
  wx: wx,
  console: console,
  setTimeout: setTimeout, clearTimeout: clearTimeout,
  setInterval: setInterval, clearInterval: clearInterval,
  performance: { now: function () { return Date.now(); } },
  requestAnimationFrame: function () {}, cancelAnimationFrame: function () {}
};
sandbox.GameGlobal = sandbox;   /* GameGlobal 即共享全局：模块经 window/self 挂 PS/THREE */
var loadedModules = {};
sandbox.require = function (p) {
  var rel = p.replace(/^\.\//, '');
  if (loadedModules[rel]) return loadedModules[rel];
  loadedModules[rel] = { exports: {} };
  var file = path.join(MGDIR, rel);
  if (!fs.existsSync(file)) throw new Error('require 缺文件: ' + p);
  /* 模拟开发者工具 2.x 编译器的模块环境：每个文件包成参数式 CommonJS 包装
   * function(require, module, exports, define){...}。关键语义：模块内
   * var 重声明这些名字不会清空参数值——build_wx.js 的包装头若只靠 var 遮蔽，
   * UMD 会误入 CommonJS 分支、GameGlobal.PS 挂不上（真机/工具黑屏启动失败）。 */
  var fn = vm.runInContext(
    '(function (require, module, exports, define) {\n' +
    fs.readFileSync(file, 'utf8') + '\n})',
    sandbox, { filename: rel });
  fn(sandbox.require, loadedModules[rel], loadedModules[rel].exports, undefined);
  return loadedModules[rel];
};
vm.createContext(sandbox);
try {
  vm.runInContext(fs.readFileSync(ENTRY, 'utf8'), sandbox, { filename: 'game.js' });
  check('入口在 mock wx 下 require 全部模块加载无异常', true);
} catch (e) {
  check('入口在 mock wx 下 require 全部模块加载无异常', false, e && e.stack ? e.stack.split('\n')[0] : String(e));
  console.log('\n' + failed + ' 项失败（加载即崩，后续跳过）');
  process.exit(1);
}
check('入口按序加载了全部 ' + 27 + ' 个模块', Object.keys(loadedModules).length === 27,
  '实际 ' + Object.keys(loadedModules).length);

var PS = sandbox.PS;
/* smoke 入口已含 Platform.init（此处兜底，幂等） */
PS.Platform.init();
console.log('\n== 静态防线：UMD 变体A工厂内误用 root.PS/THREE（bundle 内 ReferenceError 隐患） ==');
(function () {
  var JS_FILES = fs.readdirSync(path.join(__dirname, '..', 'js')).filter(function (f) { return f.endsWith('.js'); });
  JS_FILES.forEach(function (f) {
    var src = fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');
    /* 变体B（factory(root)）里 root 是合法参数；变体A（factory()）里 root.PS/THREE 必崩 */
    var m = src.match(/\}\)\(typeof self !== 'undefined' \? self : this, function \(([^)]*)\)/);
    if (m && /\broot\b/.test(m[1])) return;   // 变体B，跳过
    src.split('\n').forEach(function (ln, i) {
      if (/\broot\.(PS|THREE)\b/.test(ln)) {
        /* 允许：UMD 包装行自身的命名空间注册 */
        var ok = /else \{ root\.PS = root\.PS \|\| \{\}/.test(ln);
        check(f + ':' + (i + 1) + ' 变体A工厂内引用 root.PS/THREE', ok, ln.trim());
      }
    });
  });
})();

console.log('\n== 垫片与平台检测 ==');
check('PS 全局命名空间就位（UMD 走浏览器分支）', !!PS);
check('THREE 全局就位（three.min.js 未误入 CommonJS 分支）', typeof sandbox.THREE === 'object' && !!sandbox.THREE.REVISION);
check('platform 检测为小游戏端', PS.Platform && PS.Platform.isWx === true);
check('canvas UI 实现已加载', !!PS.UiWx);
check('调度器已加载', !!PS.Ui);

console.log('\n== canvas UI：界面构建与绘制 ==');
var fakeGame = {
  keys: {}, state: 'menu', cfg: PS.CONFIG,
  touchAnalog: { steer: 0 },   // 触屏方向盘模拟量（ui_wx 方向盘写入）
  lookHeld: 0, mirrorMode: false, mirrorSel: 0,
  audio: { unlock: function () {} },
  pause: function () {}, resume: function () {},
  toggleGuide: function () {}, toggleTop: function () {}, toggleRevCam: function () {}
};
var hud = PS.UiWx.createHud(fakeGame);
check('createHud 返回全量 API（与 hud.js 对齐）',
  ['showHud', 'hideHud', 'update', 'flash', 'setAudioOn', 'showMainMenu', 'showLevelSelect',
   'showBriefing', 'showResult', 'showPause', 'showSelftest', 'hideScreen'].every(function (k) { return typeof hud[k] === 'function'; }));

var picked = null;
hud.showMainMenu(function () {}, function () {}, { label: '继续训练 · 第 3 关', cb: function () {} });
var ui = PS.UiWx.__ui();
check('主菜单：产生可命中按钮', ui.screen && ui.screen.widgets.length >= 2);
PS.UiWx.tick(1);
var menuCtxCalls = ui.ctx.__calls;
check('主菜单：实际发生绘制（fillText>0）', menuCtxCalls && menuCtxCalls.fillText > 0);

var items = PS.Progress.unlockMap(PS.Levels.LEVELS, {});
hud.showLevelSelect(items, function (lv) { picked = lv; }, function () {});
check('选关：15 张关卡卡片 + 返回按钮全部注册命中区', ui.screen.widgets.length === items.length + 1);
check('选关：内容超高启用滚动', ui.screen.contentH > ui.screen.viewH, 'content=' + ui.screen.contentH + ' view=' + ui.screen.viewH);
check('选关：卡片坐标合法（宽度>0，无负尺寸）', ui.screen.widgets.every(function (w) { return w.w > 0 && w.h > 0; }));
PS.UiWx.tick(2);
check('选关：卡片绘制发生（fillText 覆盖标题+卡片文本）', ui.ctx.__calls.fillText >= items.length);

console.log('\n== 触摸路由 ==');
/* 点第一张解锁卡（lv01）：start→end 抬起触发 onPick */
var card = ui.screen.widgets[0];
var cx = card.x + card.w / 2, cy = card.y + card.h / 2;
var touch = { identifier: 7, clientX: cx, clientY: cy };
PS.UiWx.__dispatch('start', { touches: [touch], changedTouches: [touch] });
PS.UiWx.__dispatch('end', { touches: [], changedTouches: [touch] });
check('菜单按钮：抬起触发 onPick（收到关卡对象）', picked && picked.id === 'lv01', 'picked=' + (picked && picked.id));

/* 滑动取消：start 后大幅 move 再 end 不触发 */
var picked2 = null;
hud.showLevelSelect(items, function (lv) { picked2 = lv; }, function () {});
var c2 = ui.screen.widgets[1];
var t2 = { identifier: 8, clientX: c2.x + 5, clientY: c2.y + 5 };
PS.UiWx.__dispatch('start', { touches: [t2], changedTouches: [t2] });
PS.UiWx.__dispatch('move', { touches: [{ identifier: 8, clientX: c2.x + 5, clientY: c2.y + 60 }], changedTouches: [{ identifier: 8, clientX: c2.x + 5, clientY: c2.y + 60 }] });
PS.UiWx.__dispatch('end', { touches: [], changedTouches: [t2] });
check('滑动超阈值取消点击（防滚动误触）', picked2 === null);

/* 虚拟驾驶键：按住直写 keys，抬起释放（真实流程中驾驶态无全屏界面，先 hideScreen） */
PS.UiWx.buildTouchControls(fakeGame);
hud.hideScreen();
fakeGame.state = 'playing';
ui.tc.visible = true;
function findBtn(id) {
  for (var i = 0; i < ui.tc.buttons.length; i++) if (ui.tc.buttons[i].id === id) return ui.tc.buttons[i];
  return null;
}
var wb = findBtn('w');
var tw = { identifier: 9, clientX: wb.x + wb.w / 2, clientY: wb.y + wb.h / 2 };
PS.UiWx.__dispatch('start', { touches: [tw], changedTouches: [tw] });
check('驾驶键按下=按住物理键（keys.w=true）', fakeGame.keys.w === true);
PS.UiWx.__dispatch('end', { touches: [], changedTouches: [tw] });
check('驾驶键抬起即松开（keys.w=false）', fakeGame.keys.w === false);

/* 功能键高亮契约（syncTouchFnButtons 消费） */
check('功能钮 setOn 契约（g/m/c）', fakeGame._tcFns && [ 'g', 'm', 'c' ].every(function (k) { return typeof fakeGame._tcFns[k].setOn === 'function'; }));

console.log('\n== 触屏方向盘（v2：模拟量，抓轮缘旋转与真车同向，±270° 满打与座舱圈数 1:1） ==');
var wheel = null;
ui.tc.buttons.forEach(function (b) { if (b.id === 'wheel') wheel = b; });
check('方向盘：已注册且替换了 ◀▶ 数字键', !!wheel && !findBtn('a') && !findBtn('d') && !!findBtn('w'));
var wc = { identifier: 11, clientX: wheel.x + wheel.w / 2, clientY: wheel.y + wheel.h / 2 };
var wr = wheel.w / 2;
/* 抓右缘(3点)→下缘(6点)→左缘(9点)→上缘(12点)：顺时针 270° 满打（与座舱 ±270 一致） */
var tA = { identifier: 11, clientX: wc.clientX + wr, clientY: wc.clientY };
PS.UiWx.__dispatch('start', { touches: [tA], changedTouches: [tA] });
var tB = { identifier: 11, clientX: wc.clientX, clientY: wc.clientY + wr };
PS.UiWx.__dispatch('move', { touches: [tB], changedTouches: [tB] });
check('方向盘：顺时针 90° → 右转 steer=-1/3（与真车同向）',
  Math.abs(fakeGame.touchAnalog.steer + 90 / 270) < 1e-9, 'steer=' + fakeGame.touchAnalog.steer);
var tC = { identifier: 11, clientX: wc.clientX - wr, clientY: wc.clientY };
PS.UiWx.__dispatch('move', { touches: [tC], changedTouches: [tC] });
check('方向盘：顺时针 180° → steer=-2/3', Math.abs(fakeGame.touchAnalog.steer + 180 / 270) < 1e-9, 'steer=' + fakeGame.touchAnalog.steer);
var tD = { identifier: 11, clientX: wc.clientX, clientY: wc.clientY - wr };
PS.UiWx.__dispatch('move', { touches: [tD], changedTouches: [tD] });
check('方向盘：顺时针 270° → 满打右转 steer=-1（圈数与车一致）', fakeGame.touchAnalog.steer === -1, 'steer=' + fakeGame.touchAnalog.steer);
PS.UiWx.__dispatch('end', { touches: [], changedTouches: [tD] });
check('方向盘：松手保持转角', fakeGame.touchAnalog.steer === -1);
/* 双击回正（两次快速按下） */
var tNow = 0, perfOrig = performance.now;
performance.now = function () { return tNow; };
PS.UiWx.__dispatch('start', { touches: [wc], changedTouches: [wc] }); tNow = 100;
PS.UiWx.__dispatch('end', { touches: [], changedTouches: [wc] });
PS.UiWx.__dispatch('start', { touches: [wc], changedTouches: [wc] });
performance.now = perfOrig;
check('方向盘：320ms 内二次按下=回正', fakeGame.touchAnalog.steer === 0);
PS.UiWx.__dispatch('end', { touches: [], changedTouches: [wc] });

console.log('\n== 按住看镜 + 调镜模式（触屏版 Z/X/V） ==');
hud.hideScreen();
fakeGame.state = 'playing';
ui.tc.visible = true;
var lml = findBtn('lml'), lmr = findBtn('lmr'), madj = findBtn('madj');
check('看镜钮已注册（左/右）', !!lml && !!lmr);
check('调镜钮已注册（功能行第 5 钮）', !!madj);
var tl = { identifier: 21, clientX: lml.x + 23, clientY: lml.y + 23 };
PS.UiWx.__dispatch('start', { touches: [tl], changedTouches: [tl] });
check('按住左镜 → lookHeld=1（转头看左外镜）', fakeGame.lookHeld === 1);
PS.UiWx.__dispatch('end', { touches: [], changedTouches: [tl] });
check('松开 → lookHeld=0', fakeGame.lookHeld === 0);
/* 看镜时功能列隐藏不可触（车内镜画面扫过画面顶部——遮挡/误触回归）：
 * 按住右镜期间点 影 应无效，松开后恢复可点 */
var revTaps = 0;
fakeGame.toggleRevCam = function () { revTaps++; };
var cBtn = findBtn('c');
function tapC(id) {
  var t = { identifier: id, clientX: cBtn.x + 23, clientY: cBtn.y + 23 };
  PS.UiWx.__dispatch('start', { touches: [t], changedTouches: [t] });
  PS.UiWx.__dispatch('end', { touches: [], changedTouches: [t] });
}
tapC(28);
check('平时点 影 → 倒影开关触发', revTaps === 1);
var thR = { identifier: 29, clientX: lmr.x + 23, clientY: lmr.y + 23 };
PS.UiWx.__dispatch('start', { touches: [thR], changedTouches: [thR] });
check('按住右镜 → lookHeld=2', fakeGame.lookHeld === 2);
tapC(30);
check('看镜期间功能列隐藏不可触（影 无效）', revTaps === 1, 'revTaps=' + revTaps);
PS.UiWx.__dispatch('end', { touches: [], changedTouches: [thR] });
check('松开右镜 → lookHeld=0', fakeGame.lookHeld === 0);
tapC(31);
check('松开后功能列恢复可触（影 生效）', revTaps === 2, 'revTaps=' + revTaps);
/* 进调镜模式：驾驶键隐藏、镜像面板替换 */
PS.UiWx.__dispatch('start', { touches: [{ identifier: 22, clientX: madj.x + 23, clientY: madj.y + 23 }], changedTouches: [{ identifier: 22, clientX: madj.x + 23, clientY: madj.y + 23 }] });
PS.UiWx.__dispatch('end', { touches: [], changedTouches: [{ identifier: 22, clientX: madj.x + 23, clientY: madj.y + 23 }] });
check('调镜钮 → 进入调节模式', fakeGame.mirrorMode === true);
var wb = findBtn('w');
PS.UiWx.__dispatch('start', { touches: [{ identifier: 23, clientX: wb.x + 38, clientY: wb.y + 38 }], changedTouches: [{ identifier: 23, clientX: wb.x + 38, clientY: wb.y + 38 }] });
check('调镜模式下驾驶键隐藏不可触（keys.w 仍 false）', fakeGame.keys.w !== true);
var m2 = findBtn('m2'), mlf = findBtn('mlf');
PS.UiWx.__dispatch('start', { touches: [{ identifier: 24, clientX: m2.x + 52, clientY: m2.y + 21 }], changedTouches: [{ identifier: 24, clientX: m2.x + 52, clientY: m2.y + 21 }] });
PS.UiWx.__dispatch('end', { touches: [], changedTouches: [{ identifier: 24, clientX: m2.x + 52, clientY: m2.y + 21 }] });
check('点右外镜 chip → mirrorSel=1', fakeGame.mirrorSel === 1);
var tp = { identifier: 25, clientX: mlf.x + 27, clientY: mlf.y + 27 };
PS.UiWx.__dispatch('start', { touches: [tp], changedTouches: [tp] });
check('按住 ◀ → keys.a=true（调节偏航）', fakeGame.keys.a === true);
PS.UiWx.__dispatch('end', { touches: [], changedTouches: [tp] });
check('松开 ◀ → keys.a=false', fakeGame.keys.a === false);
var mdn = findBtn('mdone');
PS.UiWx.__dispatch('start', { touches: [{ identifier: 26, clientX: mdn.x + 75, clientY: mdn.y + 22 }], changedTouches: [{ identifier: 26, clientX: mdn.x + 75, clientY: mdn.y + 22 }] });
PS.UiWx.__dispatch('end', { touches: [], changedTouches: [{ identifier: 26, clientX: mdn.x + 75, clientY: mdn.y + 22 }] });
check('完成 → 退出调节模式', fakeGame.mirrorMode === false);
PS.UiWx.__dispatch('start', { touches: [{ identifier: 27, clientX: wb.x + 38, clientY: wb.y + 38 }], changedTouches: [{ identifier: 27, clientX: wb.x + 38, clientY: wb.y + 38 }] });
check('退出后驾驶键恢复可触', fakeGame.keys.w === true);
PS.UiWx.__dispatch('end', { touches: [], changedTouches: [{ identifier: 27, clientX: wb.x + 38, clientY: wb.y + 38 }] });

console.log('\n== HUD 数值面 ==');
hud.showHud({ name: '侧方位停车', tips: ['先对齐'] }, { maxColl: 5 });
hud.update({ time: 12.34, collisions: 2, gear: 'R', speed: -1.9, radar: 1.2, radarRange: 2.5, hint: '倒车入库', assistText: '引导✓' });
PS.UiWx.tick(3);
var u = PS.UiWx.__ui();
check('HUD 状态写入（R 挡/碰撞 2/雷达 3 格，格数公式与 hud.js 同源）',
  u.hud.gear === 'R' && u.hud.coll === 2 && u.hud.radarLv === Math.ceil(Math.max(0, 1 - 1.2 / 2.5) * 4));
hud.flash();
check('碰撞红闪置位（0.5s 衰减由 tick 驱动）', u.hud.flash > 0);

console.log('\n== 结算/简报/暂停/自测界面 ==');
var actions = { retry: 0, next: 0, menu: 0, replay: 0 };
hud.showResult({ par: 40 }, { stars: 3, score: 95, posOffset: 0.008, devDeg: 1.2, collisions: 0, time: 33.3 },
  function () { actions.retry++; }, function () { actions.next++; }, function () { actions.menu++; }, true,
  function () { actions.replay++; });
check('结算：含复盘回放共 4 按钮（再来一次/回放/下一关/返回）', ui.screen.widgets.length === 4);
var replayBtn = null;
ui.screen.widgets.forEach(function (w) { if (w.label === '复盘回放') replayBtn = w; });
if (replayBtn) {
  var rt = { identifier: 12, clientX: replayBtn.x + replayBtn.w / 2, clientY: replayBtn.y + replayBtn.h / 2 };
  PS.UiWx.__dispatch('start', { touches: [rt], changedTouches: [rt] });
  PS.UiWx.__dispatch('end', { touches: [], changedTouches: [rt] });
}
check('结算：回放按钮可命中触发', actions.replay === 1);
PS.UiWx.tick(4);
hud.showBriefing({ name: '贴墙库', desc: '极窄贴墙车位', tips: ['先直行'], par: 40 }, function () {}, function () {});
PS.UiWx.tick(5);
hud.showPause(function () {}, function () {}, function () {});
check('暂停：3 按钮', ui.screen.widgets.length === 3);
hud.showSelftest([[true, 'lv01 ok'], [false, 'lv02 bad']], false);
PS.UiWx.tick(6);
hud.hideScreen();
check('hideScreen 清空界面', ui.screen === null);

console.log('\n== 触摸总线（platform 注册路径） ==');
check('platform 已向 wx 注册触摸监听', touchBuses.start.length >= 1 && touchBuses.end.length >= 1);
check('platform 已注册窗口 resize', resizeCbs.length >= 1);

console.log('\n== 布局：多分辨率触控按钮两两不重叠（真机重叠 bug 回归，含 852x393） ==');
(function () {
  function overlap(a, b) {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  }
  var SIZES = [
    { w: 852, h: 393, ins: { top: 0, right: 59, bottom: 0, left: 59 } },   // iPhone 16 Pro 横屏（用户实测分辨率）
    { w: 812, h: 375, ins: { top: 0, right: 0, bottom: 0, left: 0 } },
    { w: 844, h: 390, ins: { top: 0, right: 50, bottom: 0, left: 50 } },
    { w: 736, h: 360, ins: { top: 0, right: 0, bottom: 0, left: 0 } },
    { w: 667, h: 375, ins: { top: 0, right: 0, bottom: 0, left: 0 } },
    { w: 932, h: 430, ins: { top: 0, right: 50, bottom: 21, left: 50 } }
  ];
  var IDS = ['wheel', 'w', 's', 'space', 'lml', 'lmr', 'pause', 'g', 'm', 'c', 'madj'];
  SIZES.forEach(function (sz) {
    devSize.windowWidth = sz.w; devSize.windowHeight = sz.h;
    devSize.safeArea = { left: sz.ins.left, top: sz.ins.top, width: sz.w - sz.ins.left - sz.ins.right, height: sz.h - sz.ins.top - sz.ins.bottom };
    resizeCbs.forEach(function (cb) { cb(); });
    var btns = IDS.map(findBtn);
    var bad = [];
    for (var i = 0; i < btns.length; i++) {
      var a = btns[i];
      if (a.x < 0 || a.y < 0 || a.x + a.w > sz.w || a.y + a.h > sz.h) bad.push(a.id + '出屏');
      for (var j = i + 1; j < btns.length; j++) {
        if (overlap(a, btns[j])) bad.push(a.id + '×' + btns[j].id);
      }
    }
    check(sz.w + 'x' + sz.h + (sz.ins.left ? '(刘海)' : '') + '：11 枚触控钮两两不重叠且不出屏', bad.length === 0, bad.join(','));
    /* 功能列须在左半屏：车内后视镜的前进视野投影带在画面中上偏右（约 0.6W-0.85W），
     * 原右上横排正压在镜面上（真机实测遮挡 bug） */
    var fnBad = btns.filter(function (b) { return b.grp === 'fn' && b.x + b.w > sz.w * 0.55; });
    check(sz.w + 'x' + sz.h + '：功能列在左半屏（避开车内镜投影带）', fnBad.length === 0,
      fnBad.map(function (b) { return b.id + '@' + b.x; }).join(','));
  });
  /* 恢复标准尺寸并触发 resize，后续测试用标准布局 */
  devSize.windowWidth = 812; devSize.windowHeight = 375;
  devSize.safeArea = { left: 0, top: 0, width: 812, height: 375 };
  resizeCbs.forEach(function (cb) { cb(); });
})();

console.log('\n== 无 Gamepad API 环境（真机无 navigator；Node21+ 沙箱有 navigator 但无 getGamepads） ==');
(function () {
  var noPad = typeof navigator === 'undefined' || !navigator.getGamepads;
  check('环境确无 Gamepad API（复现真机降级路径）', noPad,
    'navigator=' + typeof navigator + ' getGamepads=' + (typeof navigator !== 'undefined' ? typeof navigator.getGamepads : '-'));
  var gp, threw = null;
  try {
    gp = PS.Gamepad.createGamepad({ cfg: {}, state: 'menu', audio: { unlock: function () {} } }, {});
    gp.poll(1 / 60);   // 每帧轮询——真机在无 navigator 时曾抛 ReferenceError 打断帧循环（黑屏根因）
    gp.rumble(0.8, 0.4, 200);
  } catch (e) { threw = String(e); }
  check('手柄轮询在无 Gamepad API 下不抛错', threw === null, threw);
  check('无手柄时输入为空态', gp && gp.drive().steer === null && gp.drive().drive === null);
})();

console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败');
process.exit(failed ? 1 : 0);
