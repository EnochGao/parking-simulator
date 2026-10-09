/* 微信小游戏构建（tools/build_wx.js 生成工程，勿手改产物）
 * 运行：node tools/build_wx.js [--smoke]
 *   --smoke：入口不含 Game 构造（mock 环境跑不了 WebGL），供 tests/wx_bundle_test.js
 *
 * 结构（高内聚松耦合——小游戏原生支持 CommonJS require，不堆单文件）：
 *   minigame/
 *     game.js               入口：按 index.html 加载序 require 各模块 + 启动引导
 *     libs/three.min.js     three.js（包装为浏览器分支，导出到 GameGlobal.THREE）
 *     js/<源文件相对路径>    业务模块（每个文件独立模块作用域，经 GameGlobal.PS 互通）
 *     game.json / project.config.json / README.md
 *
 * 模块包装原理：微信每个 js 文件是独立 CommonJS 模块（自带 module/exports），
 * 而源码是 UMD 写法（挂 window.PS 命名空间互通）。包装头做两件事：
 *   1) var window/self = GameGlobal —— UMD 根对象指向跨模块共享的全局；
 *   2) var module/exports/define 遮蔽运行时注入 —— 强制走浏览器分支，
 *      杜绝 levels.js 等在模块环境误入 Node 分支 require('./xxx') 报错。 */
'use strict';
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var OUT_DIR = path.join(ROOT, 'minigame');

/* 拼接顺序 = index.html 加载顺序；排除网页端专属（入口/调试页/DOM HUD/自测）。
 * ui_wx.js 在 ui.js 前（调度器运行时检测 PS.UiWx）。 */
var MODULES = [
  'js/platform.js',
  'js/config.js',
  'js/physics.js',
  'js/collision.js',
  'js/scoring.js',
  'js/pulse.js',
  'js/sim.js',
  'js/demo_paths.js',
  'js/level_kit.js',
  'js/levels/basic.js',
  'js/levels/advanced.js',
  'js/levels/challenge.js',
  'js/levels.js',
  'js/autopilot.js',
  'js/progress.js',
  'js/input.js',
  'js/textures.js',
  'js/carModel.js',
  'js/world.js',
  'js/cockpit.js',
  'js/assist.js',
  'js/ui_wx.js',
  'js/ui.js',
  'js/gamepad.js',
  'js/carRig.js',
  'js/game.js'
];

/* 模块包装头：window/self → GameGlobal；遮蔽 CommonJS 强制浏览器分支。
 * 注意必须用赋值而非仅 var 声明：开发者工具 2.x 编译器把每个文件包成
 * function(require, module, exports){...} 参数式模块，var 重声明参数不清空
 * 参数值（JS 语义），UMD 会误入 CommonJS 分支导致 GameGlobal.PS 挂不上。 */
function wrapModule(rel, code) {
  return [
    '/* ' + rel + ' · 微信小游戏模块（tools/build_wx.js 生成，勿手改） */',
    'var window = GameGlobal, self = GameGlobal;   /* UMD 根 → 跨模块共享全局 */',
    'var module, exports, define;                  /* 声明以捕获外层泄露 */',
    'module = exports = define = undefined;        /* 强制浏览器分支（var 对参数式包装无效） */',
    code.trim()
  ].join('\n');
}

/* three.js 专用：导出目标探测链 exports→define→globalThis/self，遮蔽后落 GameGlobal.THREE；
 * 内部遗留 document 引用给兜底垫片（构造渲染器的正式路径全走我们传入的 canvas/context） */
function wrapThree(code) {
  return [
    '/* vendor/three.min.js · 微信小游戏模块（tools/build_wx.js 生成，勿手改） */',
    'var window = GameGlobal, self = GameGlobal;',
    'var module, exports, define;',
    'module = exports = define = undefined;        /* 同 wrapModule：防参数式模块包装泄露 */',
    'if (typeof globalThis === "undefined") GameGlobal.globalThis = GameGlobal;',
    'if (typeof document === "undefined") var document = { createElement: function (t) { return t === "canvas" ? wx.createCanvas() : null; }, addEventListener: function () {} };',
    code.trim()
  ].join('\n');
}

function entryCode(smoke) {
  var requires = ['libs/three.min.js'].concat(MODULES).map(function (rel) {
    return "require('./" + rel + "');";
  });
  var boot = smoke
    ? [
        '/* --smoke 变体：仅初始化平台层（mock 环境无 WebGL，Game 构造由测试自行处理） */',
        'PS.Platform.init();'
      ]
    : [
        "  wx.onError && wx.onError(function (msg) {",
        "    __g.__PS_ERR = __psFmt(msg);",
        "    if (!__g.__PS_ERR_SHOWN) { __g.__PS_ERR_SHOWN = 1; __psAlert('运行错误', __g.__PS_ERR); }",
        "  });",
        '  var game = new PS.Game(null);',
        '  __g.__game = game;',
        '  game.toMenu();'
      ];
  return [
    '/* 停车大师 ParkMaster · 微信小游戏入口（tools/build_wx.js 生成，勿手改）',
    ' * 模块化结构：libs/ + js/ 各文件独立模块，经 GameGlobal.PS 命名空间互通；',
    ' * 本入口只负责按序 require + 启动引导。 */',
    'var __g = GameGlobal;',
    'function __psFmt(e) {',
    "  if (e == null) return 'null';",
    "  if (typeof e === 'string') return e;",
    '  var out = [];',
    "  if (e.message) out.push(String(e.message));",
    '  if (e.stack) out.push(String(e.stack).slice(0, 500));',
    "  if (!out.length) { try { out.push(JSON.stringify(e)); } catch (x) { out.push(String(e)); } }",
    "  return out.join('\\n');",
    '}',
    'function __psAlert(title, msg) {',
    "  try { wx.showModal({ title: title, content: __psFmt(msg).slice(0, 600), showCancel: false }); } catch (e) {}",
    '}',
    '/* 旧基础库兜底：无全局 performance/requestAnimationFrame/navigator 时每帧抛错 = 黑屏 */',
    "if (!__g.performance || !__g.performance.now) __g.performance = { now: function () { return Date.now(); } };",
    'if (!__g.requestAnimationFrame) __g.requestAnimationFrame = function (cb) { return setTimeout(function () { cb(Date.now()); }, 16); };',
    'if (!__g.cancelAnimationFrame) __g.cancelAnimationFrame = function (id) { clearTimeout(id); };',
    'if (!__g.navigator) __g.navigator = { getGamepads: null };   /* gamepad.js 每帧轮询的兜底 */',
    '',
    '/* ---- 模块加载（顺序 = index.html 加载序） ---- */',
    requires.join('\n'),
    '',
    '/* ---- 启动引导（启动/运行异常屏显上报：真机黑屏直接变成可见的错误弹窗） ---- */',
    'try {',
    '  var PS = __g.PS;',
    '  PS.Platform.init();' + (smoke ? '' : '  /* 正式包：完整启动 */')
  ].concat(boot).concat([
    '} catch (e) {',
    '  __g.__PS_BOOT_ERR = String((e && e.stack) || e);',
    "  __psAlert('启动失败', __g.__PS_BOOT_ERR);",
    '}'
  ]).join('\n') + '\n';
}

function writeIfAbsent(name, content) {
  var p = path.join(OUT_DIR, name);
  if (fs.existsSync(p)) return;
  fs.writeFileSync(p, content);
  console.log('minigame/' + name + ' 生成完毕');
}

function main() {
  var smoke = process.argv.indexOf('--smoke') >= 0;
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR);

  /* three.js → libs/ */
  var threeSrc = path.join(ROOT, 'vendor', 'three.min.js');
  var libDir = path.join(OUT_DIR, 'libs');
  if (!fs.existsSync(libDir)) fs.mkdirSync(libDir);
  fs.writeFileSync(path.join(libDir, 'three.min.js'), wrapThree(fs.readFileSync(threeSrc, 'utf8')));

  /* 业务模块 → js/（保持相对路径，含 levels/ 子目录） */
  var total = 0;
  MODULES.forEach(function (rel) {
    var src = path.join(ROOT, rel);
    if (!fs.existsSync(src)) { console.error('缺少文件: ' + rel); process.exit(1); }
    var dst = path.join(OUT_DIR, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    var out = wrapModule(rel, fs.readFileSync(src, 'utf8'));
    fs.writeFileSync(dst, out);
    total += out.length;
  });

  /* 入口 */
  var entry = entryCode(smoke);
  fs.writeFileSync(path.join(OUT_DIR, 'game.js'), entry);
  var kb = Math.round((total + entry.length + fs.statSync(path.join(libDir, 'three.min.js')).size) / 1024);
  console.log((smoke ? '[smoke] ' : '') + 'minigame/ 模块化工程生成完毕：入口 + ' + MODULES.length + ' 模块 + three.js，共 ' + kb + ' KB（主包上限 4096 KB）');

  /* 工程配置（仅首次生成，避免覆盖开发者已改的 appid） */
  writeIfAbsent('game.json', JSON.stringify({
    deviceOrientation: 'landscape',
    showStatusBar: false,
    networkTimeout: { request: 10000, connectSocket: 10000, uploadFile: 10000, downloadFile: 10000 }
  }, null, 2) + '\n');
  writeIfAbsent('project.config.json', JSON.stringify({
    description: '停车大师 ParkMaster · 微信小游戏',
    compileType: 'game',
    appid: 'touristappid',
    projectname: 'parking-simulator',
    libVersion: 'latest',
    setting: { urlCheck: false, es6: true, enhance: false, postcss: false, minified: false }
  }, null, 2) + '\n');
  writeIfAbsent('README.md', [
    '# 微信小游戏工程（tools/build_wx.js 生成，勿手改）',
    '',
    '## 结构（高内聚松耦合，模块化而非单文件堆砌）',
    '- `game.js` 入口：按网页版加载序 require 各模块 + 启动引导/异常弹窗',
    '- `libs/three.min.js` 渲染库（包装为浏览器分支，挂 GameGlobal.THREE）',
    '- `js/*.js` 业务模块，与网页版 `js/` 一一对应：每个文件独立模块作用域，',
    '  经 `GameGlobal.PS` 命名空间互通（包装头把 window/self 指向 GameGlobal、',
    '  遮蔽 module/exports 强制 UMD 走浏览器分支）',
    '',
    '## 使用',
    '- 微信开发者工具「导入项目」选本目录；正式提审前在 project.config.json 换 appid',
    '- 逻辑冒烟（Node，无需开发者工具）：`npm run test:wx`',
    '- UI 预览（桌面浏览器直接点按）：`debug_wxui.html`',
    '- 提审前待办：软著材料、小游戏备案、（可选）激励视频 SDK 接入位在 ui_wx 结算页',
    ''
  ].join('\n'));
}

main();
