/* 兼容入口：微信小游戏目标（构建逻辑在 tools/build_mini.js，与抖音 tt 共用）
 * 运行：node tools/build_wx.js [--smoke]  等价于  node tools/build_mini.js wx */
'use strict';
require('./build_mini.js').build('wx', process.argv.slice(2));
