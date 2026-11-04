/* 抖音小游戏包冒烟（共享 runner 在 tests/mini_bundle_test.js，wx/tt 同一套断言；
 * tt mock 按 real API 面塑造：无 getWindowInfo/onWindowResize、音频 getAudioContext）
 * 运行：node tools/build_tt.js --smoke && node tests/tt_bundle_test.js */
'use strict';
var failed = require('./mini_bundle_test.js').run('tt');
process.exit(failed ? 1 : 0);
