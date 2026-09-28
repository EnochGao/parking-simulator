/* 手柄模块集成验证（Node，零依赖）：模拟标准布局手柄 + 极简 DOM，
 * 覆盖 连接提示 / 菜单 A 确认 / 驾驶派发 / 边缘开关 / 手刹 / 断连。
 * 运行：node tools/gpad_itest.js */
'use strict';
var GP = require('../js/gamepad.js');
var CFG = require('../js/config.js');

var failures = 0;
function check(name, cond, extra) {
  if (!cond) { failures++; console.log('  ✗ ' + name + (extra ? '  [' + extra + ']' : '')); }
  else { console.log('  ✓ ' + name); }
}

/* ---------- 极简 DOM / 手柄 mock ---------- */
function el(cls) {
  var e = {
    className: cls || '', textContent: '', _clicked: 0, offsetParent: {},
    classList: {
      _set: {},
      add: function (c) { this._set[c] = 1; },
      remove: function (c) { delete this._set[c]; },
      toggle: function (c, f) { if (f) this._set[c] = 1; else delete this._set[c]; },
      contains: function (c) { return !!this._set[c]; }
    },
    click: function () { e._clicked++; if (e.onclick) e.onclick(); },
    getBoundingClientRect: function () { return { top: e._top || 0, left: e._left || 0 }; }
  };
  return e;
}
function makePad() {
  return {
    connected: true, id: 'GameSir G4 Pro', index: 0, mapping: 'standard',
    axes: [0, 0, 0, 0],
    buttons: Array.apply(null, Array(17)).map(function () { return { pressed: false, value: 0 }; }),
    vibrationActuator: null
  };
}

/* 构造界面：主按钮 + 返回按钮（简报布局） */
var bigBtn = el('btn big'); bigBtn.textContent = '开始';
var backBtn = el('btn'); backBtn.textContent = '返回选关'; backBtn.setAttribute = function (k, v) { this[k] = v; }; backBtn['data-gp'] = 'back';var screenEl = el('screen');
screenEl.classList._set = {}; // screen 可见（contains('hidden') 为 false）
var menuBox = el('menu-box');
screenEl.firstElementChild = menuBox;
menuBox.querySelectorAll = function () { return [bigBtn, backBtn]; };
menuBox.querySelector = function (sel) { return sel === '[data-gp="back"]' ? backBtn : (sel === '.btn.big' ? bigBtn : null); };
screenEl.querySelectorAll = menuBox.querySelectorAll;
screenEl.querySelector = menuBox.querySelector;
bigBtn._top = 0; backBtn._top = 60;

var pad = makePad();
Object.defineProperty(global, 'navigator', { value: { getGamepads: function () { return [pad, null, null, null]; } }, configurable: true });
global.document = { createElement: function () { return el('gpad-toast'); } };
var toastBox = { children: [], appendChild: function (c) { this.children.push(c); } };

var game = {
  cfg: CFG, state: 'briefing',
  assist: { guide: true, top: false, revCam: true },
  mirrorMode: false, mirrorSel: 0, indicator: { side: 0 }, lookHeld: 0,
  audio: { unlock: function () { game.unlocked = true; } },
  hud: { screenEl: screenEl }, guide: null,
  startPlay: function () { game._started = (game._started || 0) + 1; },
  pause: function () { game._paused = (game._paused || 0) + 1; }
};
/* mock 按钮 click 触发 hud 绑定的 onclick（模拟真实 DOM 行为） */
bigBtn.onclick = function () { game.startPlay(); };
var gp = GP.createGamepad(game, toastBox);
function poll(n) { for (var i = 0; i < (n || 1); i++) gp.poll(1 / 60); }
function rel(i) { pad.buttons[i].pressed = false; pad.buttons[i].value = 0; }

console.log('== 连接与菜单 ==');
poll(2); // 两帧：连接 + 焦点重建
check('连接检测', gp.connected());
check('连接提示 toast', toastBox.children.length > 0 && toastBox.children[0].textContent.indexOf('手柄已连接') >= 0);
check('音频解锁', game.unlocked === true);
check('主按钮获得焦点', bigBtn.classList.contains('gpad-focus'));

pad.buttons[GP.BTN.A].pressed = true; pad.buttons[GP.BTN.A].value = 1;
poll(); rel(GP.BTN.A); poll();
check('A 键点击主按钮（开始）', bigBtn._clicked === 1, 'clicked=' + bigBtn._clicked);
check('startPlay 被调用', game._started === 1);

console.log('== 驾驶派发 ==');
game.state = 'playing';
pad.axes[0] = -0.3;                       // 摇杆左推 30%
pad.buttons[GP.BTN.RT].pressed = true; pad.buttons[GP.BTN.RT].value = 1; // RT 前进
poll(2);
var d = gp.drive();
check('摇杆模拟量转向（左为正）', d.steer > 0.05 && d.steer < 0.06, 'steer=' + d.steer.toFixed(3));
check('RT 前进', d.drive === 1);
check('松杆保持转角', GP.mergeDrive(0, 0, d).holdSteer === false);

pad.axes[0] = 0; rel(GP.BTN.RT);
pad.buttons[GP.BTN.B].pressed = true; pad.buttons[GP.BTN.B].value = 1; // B 手刹
poll(2);
d = gp.drive();
check('手柄手刹', d.handbrake === true && d.drive === null && d.steer === null);
rel(GP.BTN.B);

console.log('== 边缘开关 ==');
pad.buttons[GP.BTN.X].pressed = true; poll(); rel(GP.BTN.X); poll();
check('X 切左转向灯', game.indicator.side === 1);
pad.buttons[GP.BTN.Y].pressed = true; poll(); rel(GP.BTN.Y); poll();
check('Y 切右转向灯', game.indicator.side === 2);
pad.buttons[GP.BTN.BACK].pressed = true; poll(); rel(GP.BTN.BACK); poll();
check('Back 切引导线', game.assist.guide === false);
pad.buttons[GP.BTN.UP].pressed = true; poll(); rel(GP.BTN.UP); poll();
check('十字键↑切俯视', game.assist.top === true);
pad.buttons[GP.BTN.START].pressed = true; poll(); rel(GP.BTN.START); poll();
check('Start 暂停', game._paused === 1);

console.log('== 后视镜调节 ==');
game.state = 'playing'; game.mirrorMode = true;
pad.buttons[GP.BTN.RB].pressed = true; poll(); rel(GP.BTN.RB); poll();
check('RB 切到右外镜(1)', game.mirrorSel === 1, 'sel=' + game.mirrorSel);
pad.buttons[GP.BTN.RB].pressed = true; poll(); rel(GP.BTN.RB); poll();
check('RB 再切到车内镜(2)', game.mirrorSel === 2, 'sel=' + game.mirrorSel);
pad.buttons[GP.BTN.LB].pressed = true; poll(); rel(GP.BTN.LB); poll();
check('LB 切回右外镜(1)', game.mirrorSel === 1, 'sel=' + game.mirrorSel);
pad.buttons[GP.BTN.A].pressed = true; poll(); rel(GP.BTN.A); poll();
check('A 退出调节模式', game.mirrorMode === false);

console.log('== 断连 ==');
Object.defineProperty(global, 'navigator', { value: { getGamepads: function () { return [null, null, null, null]; } }, configurable: true });
poll(2);
check('断连检测', gp.connected() === false);
check('断连提示', toastBox.children.some(function (t) { return t.textContent.indexOf('断开') >= 0; }));
d = gp.drive();
check('断连后驾驶输入清空', d.steer === null && d.drive === null && d.handbrake === false);

if (failures) { console.log('\n失败 ' + failures + ' 项'); process.exit(1); }
console.log('\n手柄集成验证全部通过 ✓');
