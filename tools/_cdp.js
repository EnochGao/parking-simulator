/* 一次性 CDP 工具（诊断真机用，跑完删）：连接微信开发者工具 9222 调试端口
 * 用法：node tools/_cdp.js <targetTitle关键字> <表达式>            */
'use strict';
var http = require('http');

function getJSON(path) {
  return new Promise(function (res, rej) {
    http.get({ host: '127.0.0.1', port: 9222, path: path }, function (r) {
      var d = ''; r.on('data', function (c) { d += c; });
      r.on('end', function () { try { res(JSON.parse(d)); } catch (e) { rej(new Error('bad json: ' + d.slice(0, 120))); } });
    }).on('error', rej);
  });
}

function cdpEval(wsUrl, expr) {
  return new Promise(function (resolve, reject) {
    var ws = new WebSocket(wsUrl);
    var id = 1;
    var timer = setTimeout(function () { try { ws.close(); } catch (e) {} reject(new Error('CDP timeout')); }, 10000);
    ws.onopen = function () {
      ws.send(JSON.stringify({ id: id, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } }));
    };
    ws.onmessage = function (ev) {
      var m = JSON.parse(ev.data);
      if (m.id === id) {
        clearTimeout(timer);
        try { ws.close(); } catch (e) {}
        resolve(m.result);
      }
    };
    ws.onerror = function () { clearTimeout(timer); reject(new Error('ws error')); };
  });
}

function main() {
  var key = process.argv[2];
  var expr = process.argv[3];
  if (expr && expr.indexOf('@') === 0) expr = require('fs').readFileSync(expr.slice(1), 'utf8');
  getJSON('/json/list').then(function (targets) {
    var t = targets.filter(function (x) { return (x.title || '').indexOf(key) >= 0 || (x.url || '').indexOf(key) >= 0; });
    if (!t.length) {
      console.log('未匹配 target，现有：');
      targets.forEach(function (x, i) { console.log('  ' + i + ' ' + x.type + ' | ' + (x.title || '').slice(0, 40) + ' | ' + (x.url || '').slice(0, 60)); });
      process.exit(2);
    }
    return cdpEval(t[0].webSocketDebuggerUrl, expr).then(function (r) {
      if (r.exceptionDetails) console.log('EXC:', JSON.stringify(r.exceptionDetails).slice(0, 600));
      else console.log(r.result && r.result.value !== undefined ? r.result.value : JSON.stringify(r.result));
    });
  }).catch(function (e) { console.error('ERR:', e.message); process.exit(1); });
}
main();
