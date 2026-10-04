/* DOM UI：主菜单 / 选关 / 任务简报 / HUD / 暂停 / 结算
 * 纯视图层：只接收算好的数据并渲染，不做任何读写档（持久化在 js/progress.js） */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.PS = root.PS || {}; root.PS.Hud = api; }
})(typeof self !== 'undefined' ? self : this, function () {

  function stars(n) {
    var s = '';
    for (var i = 0; i < 3; i++) s += i < n ? '★' : '☆';
    return s;
  }

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function createHud(root) {
    var api = {};
    var overlay = el('div', 'hud-root');
    root.appendChild(overlay);

    /* ---------- 常驻 HUD（游戏中） ---------- */
    var hud = el('div', 'hud hidden');
    hud.innerHTML =
      '<div class="hud-top">' +
      '  <div class="hud-task"><span id="hud-level-name"></span><span id="hud-task-text"></span></div>' +
      '  <div class="hud-stats">' +
      '    <span class="hud-stat">⏱ <b id="hud-time">0.0</b>s</span>' +
      '    <span class="hud-stat warn">💥 <b id="hud-coll">0</b><span id="hud-collmax">/5</span></span>' +
      '    <span class="hud-stat" id="hud-assist"></span>' +
      '    <span class="hud-stat audio" id="hud-audio" title="音效开关">🔊</span>' +
      '  </div>' +
      '</div>' +
      '<div class="hud-bottom">' +
      '  <div class="cluster">' +
      '    <div class="gear"><span id="hud-gear">D</span></div>' +
      '    <div class="speed"><b id="hud-speed">0</b><i>km/h</i></div>' +
      '    <div class="radar" id="hud-radar"><i></i><i></i><i></i><i></i></div>' +
      '  </div>' +
      '  <div class="hint-line" id="hud-hint"></div>' +
      '</div>' +
      '<div class="flash" id="hud-flash"></div>';
    overlay.appendChild(hud);
    /* 每帧差量更新：缓存节点引用与上次值，值不变不写 DOM（避免 60Hz 布局/绘制抖动） */
    var nodeCache = {}, lastVals = {}, radarBars = null;
    function node(id) {
      if (!nodeCache[id]) nodeCache[id] = hud.querySelector('#' + id);
      return nodeCache[id];
    }
    function setText(id, v) {
      if (lastVals[id] === v) return;
      lastVals[id] = v;
      node(id).textContent = v;
    }

    /* opts.maxColl: 碰撞失败上限（源自 SCORE.maxCollisions，与文案一起单源化） */
    api.showHud = function (level, opts) {
      var maxColl = (opts && opts.maxColl) || 5;
      hud.classList.remove('hidden');
      lastVals = {};                       // 换关重置差量缓存，强制整帧重写
      node('hud-level-name').textContent = level.name;
      node('hud-task-text').textContent = '目标：倒入白色标线车位';
      node('hud-coll').textContent = '0';
      node('hud-collmax').textContent = '/' + maxColl;
      node('hud-hint').textContent = level.tips ? level.tips[0] : '';
      var ab = node('hud-audio');
      ab.onclick = function () { api.onAudioToggle && api.onAudioToggle(); };
    };
    api.setAudioOn = function (on) { node('hud-audio').textContent = on ? '🔊' : '🔇'; };
    api.hideHud = function () { hud.classList.add('hidden'); };
    /* 数值先比后格式化：toFixed/字符串转换只在值变化时发生（每帧 3 个字符串的浪费省掉） */
    function setNum(id, v, fmt) {
      if (lastVals[id] === v) return;
      lastVals[id] = v;
      node(id).textContent = fmt(v);
    }

    api.update = function (state) {
      setNum('hud-time', Math.round(state.time * 10), function (v) { return (v / 10).toFixed(1); });
      setNum('hud-coll', state.collisions, function (v) { return '' + v; });
      setText('hud-gear', state.gear);
      var gcls = state.gear === 'R' ? 'r' : 'd';
      if (lastVals.gcls !== gcls) { lastVals.gcls = gcls; node('hud-gear').className = gcls; }
      setNum('hud-speed', Math.round(Math.abs(state.speed) * 3.6), function (v) { return '' + v; });
      var range = state.radarRange || 2.5;                       // 报警半径与 game.js RADAR.range 同源
      var lv4 = state.radar != null ? Math.ceil(Math.max(0, 1 - state.radar / range) * 4) : 0;
      if (lastVals.radar !== lv4) {
        lastVals.radar = lv4;
        if (!radarBars) radarBars = node('hud-radar').querySelectorAll('i');
        for (var i = 0; i < 4; i++) radarBars[i].className = i < lv4 ? 'on' : '';
      }
      setText('hud-hint', state.hint || '');
      setText('hud-assist', state.assistText || '');
    };
    api.flash = function () {
      var f = node('hud-flash');
      f.classList.remove('go');
      void f.offsetWidth;
      f.classList.add('go');
    };

    /* ---------- 全屏界面（菜单/简报/结算/暂停） ---------- */
    var screen = el('div', 'screen hidden');
    overlay.appendChild(screen);
    api.screenEl = screen; // 手柄菜单导航需要读取当前界面按钮列表

    api.showScreen = function (node) {
      screen.innerHTML = '';
      screen.appendChild(node);
      screen.classList.remove('hidden');
    };
    api.hideScreen = function () { screen.classList.add('hidden'); };

    /* 主菜单。cont: {label, cb} 可选"继续训练"（已有进度时由 game.js 传入） */
    api.showMainMenu = function (onStart, onSelect, cont) {
      var box = el('div', 'menu-box');
      box.appendChild(el('h1', 'game-title', '停车大师 <i>ParkMaster</i>'));
      box.appendChild(el('p', 'subtitle', '新手司机停车训练模拟器 · 老小区特训'));
      if (cont) {
        var bc = el('button', 'btn big', cont.label);
        bc.onclick = cont.cb;
        box.appendChild(bc);
        var b0 = el('button', 'btn', '从头开始');
        b0.onclick = onStart;
        box.appendChild(b0);
      } else {
        var b1 = el('button', 'btn big', '开始训练');
        b1.onclick = onStart;
        box.appendChild(b1);
      }
      var b2 = el('button', 'btn', '选择关卡');
      b2.onclick = onSelect;
      box.appendChild(b2);
      box.appendChild(el('p', 'menu-help',
        'W/↑ 前进 · S/↓ 倒车 · 松开即刹车 · A/D 方向（松开保持角度） · Q/E 转向灯<br>Z/X 按住看左右后视镜 · V 调后视镜角度 · H 引导线 · M 俯视图（,/．旋转 · 拖拽画面 · R 回正）· C 倒车影像 · Esc 暂停<br>🎮 手柄（XInput 模式）：左摇杆方向 · RT/LT 油门/倒车 · B 手刹 · X/Y 转向灯 · LB/RB 看镜（俯视时旋转镜头） · Back 引导线 · Start 暂停<br>🎮 菜单中：摇杆/十字键移动 · A 确认 · B 返回 · 十字键↑↓ 俯视/倒影 · ← 调后视镜'));
      api.showScreen(box);
    };

    /* 选关。items: [{lv, unlocked, stars, best}]（由 progress.unlockMap 预计算） */
    api.showLevelSelect = function (items, onPick, onBack) {
      var box = el('div', 'menu-box wide');
      box.appendChild(el('h2', '', '选择关卡'));
      var grid = el('div', 'level-grid');
      items.forEach(function (it) {
        var lv = it.lv, unlocked = it.unlocked;
        var card = el('div', 'level-card' + (unlocked ? '' : ' locked'));
        card.innerHTML =
          '<div class="lc-head">' + lv.id.replace('lv', '') + '</div>' +
          '<div class="lc-name">' + lv.name + '</div>' +
          '<div class="lc-stars">' + (it.stars ? stars(it.stars) : '☆☆☆') + '</div>' +
          '<div class="lc-diff">' + '▪'.repeat(lv.diff) + '</div>' +
          (unlocked ? '' : '<div class="lc-lock">🔒 通关上一关解锁</div>');
        if (unlocked) card.onclick = function () { onPick(lv); };
        grid.appendChild(card);
      });
      box.appendChild(grid);
      var back = el('button', 'btn', '返回');
      back.setAttribute('data-gp', 'back'); // 手柄 B 键返回
      back.onclick = onBack;
      box.appendChild(back);
      api.showScreen(box);
    };

    /* 任务简报 */
    api.showBriefing = function (level, onStart, onBack) {
      var box = el('div', 'menu-box');
      box.appendChild(el('h2', '', level.name));
      box.appendChild(el('p', 'brief-desc', level.desc));
      var tips = el('ul', 'brief-tips');
      (level.tips || []).forEach(function (t) { tips.appendChild(el('li', '', t)); });
      box.appendChild(tips);
      box.appendChild(el('p', 'brief-meta', '标准用时 ' + level.par + ' 秒 · 碰撞 ≤4 次仍可通过，剐蹭会扣分'));
      var go = el('button', 'btn big', '开始 (回车 / 手柄A)');
      go.onclick = onStart;
      box.appendChild(go);
      var back = el('button', 'btn', '返回选关');
      back.setAttribute('data-gp', 'back');
      back.onclick = onBack;
      box.appendChild(back);
      api.showScreen(box);
    };

    /* 结算。落档由调用方（game.js → progress.record）完成，这里只展示 */
    api.showResult = function (level, result, onRetry, onNext, onMenu, hasNext) {
      var pass = result.stars > 0;
      var box = el('div', 'menu-box result');
      box.appendChild(el('div', 'result-stars ' + (pass ? 'win' : 'lose'), stars(result.stars)));
      box.appendChild(el('h2', '', pass ? '停车成功！' : '未能完成'));
      var table = el('table', 'result-table');
      // <1cm 用毫米显示，精准停车不再是冷冰冰的 "0.0 cm"
      var posTxt = result.posOffset < 0.01
        ? (result.posOffset * 1000).toFixed(0) + ' mm'
        : (result.posOffset * 100).toFixed(1) + ' cm';
      [['得分', result.score], ['位置偏差', posTxt],
       ['角度偏差', result.devDeg.toFixed(1) + '°'], ['碰撞', result.collisions + ' 次'],
       ['用时', result.time.toFixed(1) + ' s（标准 ' + level.par + 's）']
      ].forEach(function (row) {
        var tr = el('tr');
        tr.appendChild(el('td', '', row[0]));
        tr.appendChild(el('td', '', '' + row[1]));
        table.appendChild(tr);
      });
      box.appendChild(table);
      var btns = el('div', 'btn-row');
      var bRetry = el('button', 'btn', '再来一次 (R)');
      bRetry.onclick = onRetry;
      btns.appendChild(bRetry);
      if (pass && hasNext) {
        var bNext = el('button', 'btn big', '下一关 (N)');
        bNext.onclick = onNext;
        btns.appendChild(bNext);
      }
      var bMenu = el('button', 'btn', '返回菜单');
      bMenu.setAttribute('data-gp', 'back');
      bMenu.onclick = onMenu;
      btns.appendChild(bMenu);
      box.appendChild(btns);
      api.showScreen(box);
    };

    /* 暂停 */
    api.showPause = function (onResume, onRetry, onMenu) {
      var box = el('div', 'menu-box');
      box.appendChild(el('h2', '', '暂停'));
      var b1 = el('button', 'btn big', '继续 (Esc)');
      b1.onclick = onResume;
      box.appendChild(b1);
      var b2 = el('button', 'btn', '重新开始');
      b2.onclick = onRetry;
      box.appendChild(b2);
      var b3 = el('button', 'btn', '返回菜单');
      b3.setAttribute('data-gp', 'back');
      b3.onclick = onMenu;
      box.appendChild(b3);
      api.showScreen(box);
    };

    /* selftest 结果表 */
    api.showSelftest = function (lines, allPass) {
      var box = el('div', 'menu-box wide');
      box.appendChild(el('h2', '', '全关卡自动驾驶回归 ' + (allPass ? '— 全部通过 ✓' : '— 存在失败 ✗')));
      var table = el('table', 'result-table mono');
      lines.forEach(function (ln) {
        var tr = el('tr');
        tr.appendChild(el('td', ln[0] ? 'ok' : 'bad', ln[0] ? 'PASS' : 'FAIL'));
        tr.appendChild(el('td', '', ln[1]));
        table.appendChild(tr);
      });
      box.appendChild(table);
      api.showScreen(box);
    };

    return api;
  }

  return { createHud: createHud };
});
