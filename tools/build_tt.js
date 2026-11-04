/* 抖音小游戏目标（构建逻辑在 tools/build_mini.js，与微信 wx 共用）
 * 运行：node tools/build_tt.js [--smoke]  等价于  node tools/build_mini.js tt
 * 产物 minigame-tt/ 用抖音开发者工具「导入项目」；appid 在 project.config.json 换成你的 */
'use strict';
require('./build_mini.js').build('tt', process.argv.slice(2));
