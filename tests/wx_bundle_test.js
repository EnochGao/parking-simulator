/* 微信小游戏包冒烟（共享 runner 在 tests/mini_bundle_test.js，wx/tt 同一套断言）
 * 运行：node tools/build_wx.js --smoke && node tests/wx_bundle_test.js */
'use strict';
var failed = require('./mini_bundle_test.js').run('wx');
process.exit(failed ? 1 : 0);
