/* js/gamepad.js · 微信小游戏模块（tools/build_wx.js 生成，勿手改） */
var window = GameGlobal, self = GameGlobal;   /* UMD 根 → 跨模块共享全局 */
var module, exports, define;                  /* 遮蔽 CommonJS：强制浏览器分支 */
/* 手柄支持：盖世小鸡等 XInput/标准布局手柄（浏览器 Gamepad API，逐帧轮询）
 * 键位（W3C 标准布局，盖世小鸡手柄切到 XInput/PC 模式后即为此映射）：
 *   左摇杆 X → 方向（模拟量，死区+渐进曲线）；RT→前进；LT→倒车；B→手刹；
 *   X/Y → 左/右转向灯；LB/RB(按住) → 转头看左/右外后视镜；
 *   Back → 引导线开关；Start → 暂停/继续；十字键 ↑↓ → 俯视/倒影，← → 后视镜调节模式；
 *   后视镜调节模式：十字键调角度，LB/RB 切换镜子，A 完成；
 *   菜单/简报/结算/暂停：左摇杆或十字键移动焦点，A 确认，B 返回。
 * 纯函数部分（曲线/输入合并）Node/浏览器双端通用，供单元测试。 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.PS = root.PS || {}; root.PS.Gamepad = api; }
})(typeof self !== 'undefined' ? self : this, function () {

  /* 标准布局按钮索引 */
  var BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

  /** 摇杆响应曲线：|v|<dz 归零，dz..1 重映射后取 v·|v|（渐进，小偏幅更精细利于泊车微调） */
  function steerCurve(v, dz) {
    var a = Math.abs(v);
    if (a <= dz) return 0;
    var t = (a - dz) / (1 - dz);
    return (v < 0 ? -1 : 1) * t * t;
  }

  /**
   * 键盘/手柄驾驶输入合并：键盘优先（数字量，老玩家习惯不变），手柄模拟量补位。
   * kSteer/kDrive: 键盘 -1..1（0=松开）；gp: {steer:number|null, drive:-1|0|1|null, handbrake:bool}
   * out: 可选复用对象（驾驶热路径 60Hz，input.js 传入预分配对象）；缺省新建（测试/一次性调用）
   * 返回 {steer, drive, holdSteer, handbrake}；holdSteer=键盘与摇杆都松开时保持当前转角
   */
  function mergeDrive(kSteer, kDrive, gp, out) {
    gp = gp || {};
    var m = out || {};
    var gSteer = gp.steer != null && gp.steer !== 0 ? gp.steer : 0;
    m.steer = kSteer !== 0 ? kSteer : gSteer;
    m.drive = kDrive !== 0 ? kDrive : (gp.drive != null ? gp.drive : 0);
    m.holdSteer = kSteer === 0 && gSteer === 0;
    m.handbrake = !!gp.handbrake;
    return m;
  }

  var MENU_STATES = { menu: 1, select: 1, briefing: 1, result: 1, paused: 1, selftest: 1 };

  function createGamepad(game, container) {
    var cfg = (game.cfg && game.cfg.GAMEPAD) || {};
    var DZ = cfg.deadzone != null ? cfg.deadzone : 0.08;
    var THR = cfg.triggerThreshold != null ? cfg.triggerThreshold : 0.12;
    var STICK_PAD = cfg.stickAsPad != null ? cfg.stickAsPad : 0.6;
    var NAV_REPEAT = cfg.navRepeat != null ? cfg.navRepeat : 0.18;

    var curPad = null;      // 当前使用的 gamepad 对象
    var prev = [];          // 上一帧按键快照（边缘检测）
    var gpLook = 0;         // 手柄当前的转头意图（0 无 1 左 2 右）
    var cur = { steer: null, drive: null, handbrake: false };
    var nav = { screen: null, items: [], rows: [], idx: -1, dir: 0, repeat: 0 };
    var toastEl = null, toastTimer = 0;

    function pad() {
      /* navigator 守卫：微信小游戏真机运行时无 navigator（开发者工具/浏览器有）——
       * 每帧轮询在这里抛 ReferenceError 会打断整个帧循环（黑屏），必须就地降级 */
      if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
      var list = navigator.getGamepads() || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].connected) return list[i];
      }
      return null;
    }
    function down(p, i) {
      var b = p.buttons[i];
      return !!(b && (b.pressed || b.value > THR));
    }
    function edge(p, i) { return down(p, i) && !prev[i]; }
    function toast(txt) {
      if (!toastEl) {
        toastEl = document.createElement('div');
        toastEl.className = 'gpad-toast';
        container.appendChild(toastEl);
      }
      toastEl.textContent = txt;
      toastEl.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2800);
    }
    function toggleGuide() {
      game.assist.guide = !game.assist.guide;
      if (game.guide) game.guide.setVisible(game.assist.guide);
    }

    /* ---------- 驾驶中 ---------- */
    function pollPlaying(p, dt) {
      var i, any = false;
      for (i = 0; i < p.buttons.length; i++) { if (down(p, i)) { any = true; break; } }
      if (any) { try { game.audio.unlock(); } catch (e) {} }

      /* 驾驶输入（game.stepPhysics 每步读取 drive() 合并键盘） */
      var s = steerCurve(-(p.axes[0] || 0), DZ); // 摇杆左推为负 → 转向左为正
      cur.steer = s !== 0 ? s : null;
      cur.drive = down(p, BTN.RT) ? 1 : (down(p, BTN.LT) ? -1 : null);
      cur.handbrake = down(p, BTN.B);

      if (game.mirrorMode) {
        /* 后视镜调节：LB/RB 切换镜子，A 完成（十字键调角由 game.js 每步读取） */
        if (edge(p, BTN.LB)) game.mirrorSel = Math.max(0, game.mirrorSel - 1);
        if (edge(p, BTN.RB)) game.mirrorSel = Math.min(2, game.mirrorSel + 1);
        if (edge(p, BTN.A)) game.mirrorMode = false;
        return;
      }

      if (edge(p, BTN.X)) game.indicator.side = game.indicator.side === 1 ? 0 : 1;
      if (edge(p, BTN.Y)) game.indicator.side = game.indicator.side === 2 ? 0 : 2;
      if (edge(p, BTN.BACK)) toggleGuide();
      if (edge(p, BTN.UP)) game.assist.top = !game.assist.top;
      if (edge(p, BTN.DOWN)) game.assist.revCam = !game.assist.revCam;
      if (edge(p, BTN.LEFT)) game.mirrorMode = true;
      if (edge(p, BTN.START)) game.pause();

      /* LB/RB：俯视时按住旋转镜头（左=画面逆时针，手动后暂停自动跟随，R 键回正）；
       * 舱内时按住转头看镜（与键盘 Z/X 同语义；松开仅在未被键盘接管时清零） */
      if (game.assist.top) {
        if (down(p, BTN.LB)) game.rotateTopCamera(-game.cfg.VIEW_TOP.rotateRate * dt);
        else if (down(p, BTN.RB)) game.rotateTopCamera(game.cfg.VIEW_TOP.rotateRate * dt);
      } else {
        var look = down(p, BTN.LB) ? 1 : (down(p, BTN.RB) ? 2 : 0);
        if (look !== gpLook) {
          if (look) game.lookHeld = look;
          else if (game.lookHeld === gpLook) game.lookHeld = 0;
          gpLook = look;
        }
      }
    }

    /* ---------- 菜单/界面焦点导航 ---------- */
    function hudScreen() { return game.hud && game.hud.screenEl; }
    function navClearFocus() {
      for (var i = 0; i < nav.items.length; i++) nav.items[i].classList.remove('gpad-focus');
    }
    function rebuildNav(scr) {
      navClearFocus();
      nav.screen = scr.firstElementChild;
      nav.items = []; nav.rows = []; nav.idx = -1;
      var nodes = scr.querySelectorAll('button, .level-card');
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (n.classList.contains('locked')) continue;
        if (!n.offsetParent) continue; // 隐藏元素
        var top = Math.round(n.getBoundingClientRect().top);
        var r = -1;
        for (var j = 0; j < nav.rows.length; j++) { if (nav.rows[j].top === top) { r = j; break; } }
        if (r < 0) { r = nav.rows.length; nav.rows.push({ top: top, items: [] }); }
        n._row = r;
        nav.rows[r].items.push(nav.items.length);
        nav.items.push(n);
      }
      var primary = scr.querySelector('.btn.big:not(.locked)');
      nav.idx = Math.max(0, nav.items.indexOf(primary));
      paint();
    }
    function paint() {
      for (var i = 0; i < nav.items.length; i++) {
        nav.items[i].classList.toggle('gpad-focus', i === nav.idx);
      }
      var el = nav.items[nav.idx];
      if (el && el.scrollIntoView) { try { el.scrollIntoView({ block: 'nearest' }); } catch (e) {} }
    }
    function navMove(dir) { // ±1 上下换行（行内取最近项），±2 左右逐项
      if (!nav.items.length) return;
      if (dir === 2 || dir === -2) {
        nav.idx = Math.min(nav.items.length - 1, Math.max(0, nav.idx + dir / 2));
      } else {
        var row = nav.rows[(nav.items[nav.idx]._row || 0) + dir];
        if (!row) return;
        var left = nav.items[nav.idx].getBoundingClientRect().left;
        var best = row.items[0], bd = 1e9;
        for (var i = 0; i < row.items.length; i++) {
          var d = Math.abs(nav.items[row.items[i]].getBoundingClientRect().left - left);
          if (d < bd) { bd = d; best = row.items[i]; }
        }
        nav.idx = best;
      }
      paint();
    }
    function pollMenu(p, dt) {
      cur.steer = null; cur.drive = null; cur.handbrake = false;
      var scr = hudScreen();
      if (!scr || scr.classList.contains('hidden')) { nav.screen = null; nav.items = []; return; }
      if (nav.screen !== scr.firstElementChild) rebuildNav(scr);

      /* 焦点移动：十字键或左摇杆，首按即动 + 连发 */
      var ax0 = p.axes[0] || 0, ax1 = p.axes[1] || 0;
      var dir = 0;
      if (down(p, BTN.DOWN) || ax1 > STICK_PAD) dir = 1;
      else if (down(p, BTN.UP) || ax1 < -STICK_PAD) dir = -1;
      else if (down(p, BTN.RIGHT) || ax0 > STICK_PAD) dir = 2;
      else if (down(p, BTN.LEFT) || ax0 < -STICK_PAD) dir = -2;
      if (dir !== 0) {
        if (dir !== nav.dir || nav.repeat <= 0) {
          navMove(dir);
          nav.repeat = NAV_REPEAT;
        }
        nav.repeat -= dt;
      }
      nav.dir = dir;

      if (edge(p, BTN.A)) { var t = nav.items[nav.idx]; if (t) t.click(); }
      if (edge(p, BTN.B)) { var b = scr.querySelector('[data-gp="back"]'); if (b) b.click(); }
      if (edge(p, BTN.START)) { var pr = scr.querySelector('.btn.big'); if (pr) pr.click(); }
    }

    /* ---------- 每帧轮询 ---------- */
    function poll(dt) {
      var p = pad();
      if (p !== curPad) {
        curPad = p;
        prev = [];
        nav.screen = null; nav.items = [];
        if (p) {
          toast('🎮 手柄已连接：' + String(p.id || '手柄').replace(/\(.*\)/, '').trim().slice(0, 30));
          try { game.audio.unlock(); } catch (e) {}
        } else {
          toast('🎮 手柄已断开');
        }
      }
      cur.steer = null; cur.drive = null; cur.handbrake = false;
      if (p) {
        if (game.state === 'playing') pollPlaying(p, dt);
        else if (MENU_STATES[game.state]) pollMenu(p, dt);
        for (var i = 0; i <= 16; i++) prev[i] = down(p, i);
      }
    }

    return {
      poll: poll,
      /** 当前手柄驾驶输入：{steer:-1..1|null, drive:-1|0|1|null, handbrake}（无手柄为 null） */
      drive: function () { return cur; },
      /** 十字键/摇杆按住状态（后视镜调节用；摇杆幅度超过 stickAsPad 视为按下） */
      padUp: function () { var p = curPad; return !!p && (down(p, BTN.UP) || -(p.axes[1] || 0) > STICK_PAD); },
      padDown: function () { var p = curPad; return !!p && (down(p, BTN.DOWN) || (p.axes[1] || 0) > STICK_PAD); },
      padLeft: function () { var p = curPad; return !!p && (down(p, BTN.LEFT) || -(p.axes[0] || 0) > STICK_PAD); },
      padRight: function () { var p = curPad; return !!p && (down(p, BTN.RIGHT) || (p.axes[0] || 0) > STICK_PAD); },
      /** 碰撞震动（Chrome/Edge 支持 vibrationActuator 的手柄有效） */
      rumble: function (strong, weak, ms) {
        try {
          var a = curPad && curPad.vibrationActuator;
          if (a && a.playEffect) {
            a.playEffect('dual-rumble', {
              startDelay: 0, duration: ms || cfg.rumbleMs || 260,
              strongMagnitude: strong == null ? 0.8 : strong,
              weakMagnitude: weak == null ? 0.4 : weak
            });
          }
        } catch (e) {}
      },
      connected: function () { return !!curPad; }
    };
  }

  return { BTN: BTN, steerCurve: steerCurve, mergeDrive: mergeDrive, createGamepad: createGamepad };
});