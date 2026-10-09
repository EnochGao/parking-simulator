/* js/ui_wx.js · 微信小游戏模块（tools/build_wx.js 生成，勿手改） */
var window = GameGlobal, self = GameGlobal;   /* UMD 根 → 跨模块共享全局 */
var module, exports, define;                  /* 声明以捕获外层泄露 */
module = exports = define = undefined;        /* 强制浏览器分支（var 对参数式包装无效） */
/* 微信小游戏版 UI：离屏 2D canvas 绘制 HUD 与全部全屏界面（无 DOM 环境）
 * 架构：小游戏只有一块屏幕画布（被 three.js 用作 WebGL 主渲染），UI 画在本离屏
 * canvas 上，经 CanvasTexture 全屏透明贴图叠加进主场景（platform.presentOverlay 合成）。
 * 接口与 hud.js 逐一对齐（showHud/update/showMainMenu/showLevelSelect/showBriefing/
 * showResult/showPause/showSelftest/hideScreen/flash/setAudioOn/onAudioToggle），
 * 由 ui.js 调度；视觉规格移植自 style.css（配色/尺寸/布局同源）。
 * 触摸：统一走 platform.onCanvasTouch 归一化事件——菜单按钮"抬起且仍在按钮内"触发
 * （滑动离钮可取消），虚拟驾驶键"按下=按住物理键"直写 game.keys（与网页版同语义）。
 * 调试：debug_wxui.html 在桌面浏览器加载本文件直接预览/点按（无需微信开发者工具）。 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.PS = root.PS || {}; root.PS.UiWx = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  /* 配色（移植 style.css） */
  var C = {
    bg: '#14161a', panelA: '#1d2129', panelB: '#15171c', border: '#3a3f4a',
    text: '#e8eaee', dim: '#9aa2b1', faint: '#79808e',
    gold: '#ffd76a', green: '#6fd66f', greenA: '#2f9e5a', greenB: '#227a44',
    warn: '#ff7a66', orange: '#ff9d5c', hint: '#ffe9a8', blue: '#9fc6e8',
    chipBg: 'rgba(16,18,24,.72)'
  };
  /* 字体串取最大兼容格式：微信旧版 2D 画布的 font 解析器对"带引号的字体族列表/
   * 数字字重(800)/小数字号/前导空格"都可能解析失败——失败后 fillText 尺寸归零，
   * 表现即"卡片有框无字"（开发者工具是完整 Chromium 复现不了）。中文由系统回退
   * 字体渲染，无需指名 PingFang/雅黑。 */
  var FONT = 'sans-serif';
  var UI_SCALE_MAX = 1.5;    // UI 画布超采样上限（全屏贴图上传带宽与文字锐度的折中）

  function stars(n) { var s = ''; for (var i = 0; i < 3; i++) s += i < n ? '★' : '☆'; return s; }

  function rr(ctx, x, y, w, h, r) {   // 圆角矩形路径
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  /** 统一字体赋值：整数号 + 仅 bold/空两种字重 + 纯 sans-serif（真机兼容归一化） */
  function f(ctx, size, weight) {
    ctx.font = (weight ? 'bold ' : '') + Math.round(size) + 'px ' + FONT;
  }

  /** 按最大宽度断行（canvas 无自动换行），返回行数组 */
  function wrap(ctx, text, maxW) {
    var lines = [];
    String(text).split('\n').forEach(function (para) {
      var line = '';
      for (var i = 0; i < para.length; i++) {
        var t = line + para[i];
        if (line && ctx.measureText(t).width > maxW) { lines.push(line); line = para[i]; }
        else line = t;
      }
      lines.push(line);
    });
    return lines;
  }

  /* ================= 单例（一运行时一个游戏实例） ================= */
  var cur = null;

  function ensure(game) {
    if (cur) return cur;
    var PLAT = window.PS.Platform;
    cur = {
      game: game,
      PLAT: PLAT,
      canvas: PLAT.createCanvas(),     // 离屏 2D（屏幕画布已在 game.js 先建）
      ctx: null,
      W: 0, H: 0, scale: 1, insets: { top: 0, right: 0, bottom: 0, left: 0 },
      dirty: true,
      hud: {
        visible: false, levelName: '', task: '', time: 0, coll: 0, collMax: 5,
        gear: 'D', speed: 0, radarLv: 0, radarRange: 2.5, hint: '', assist: '',
        audioOn: true, flash: 0, audioRect: null
      },
      screen: null,                   // {kind,model,widgets:[{x,y,w,h,cb,locked}],viewY,viewH,contentH}
      tc: { visible: false, buttons: [], holds: {} },   // holds: touchId → button
      pressed: null, drag: null,
      lastT: null
    };
    cur.ctx = cur.canvas.getContext('2d');
    ensureSize();
    window.__PS_UI = cur;   /* 调试句柄：真机调试 Console 可直接查 UI 状态 */
    PLAT.onResize(ensureSize);
    PLAT.onCanvasTouch(cur.canvas, { start: onTouchStart, move: onTouchMove, end: onTouchEnd });
    PLAT.setOverlayRenderer(presentOverlay);
    PLAT.setOverlayNeedsFrame(function () { return true; });   /* 贴图每帧重传（见 presentOverlay 注释），恒需渲染帧 */
    return cur;
  }

  function ensureSize() {
    if (!cur) return;
    var PLAT = cur.PLAT;
    var W = PLAT.width(), H = PLAT.height();
    if (!W || !H) return;
    var scale = Math.min(PLAT.pixelRatio() || 1, UI_SCALE_MAX);
    if (cur.W === W && cur.H === H && cur.scale === scale) return;
    cur.W = W; cur.H = H; cur.scale = scale;
    cur.insets = PLAT.safeInsets();
    cur.canvas.width = Math.round(W * scale);
    cur.canvas.height = Math.round(H * scale);
    cur.ctx.setTransform(scale, 0, 0, scale, 0, 0);
    layoutTouch();
    cur.dirty = true;
  }

  /* ================= 绘制 ================= */

  function drawAll() {
    var ctx = cur.ctx, W = cur.W, H = cur.H;
    ctx.clearRect(0, 0, W, H);
    if (cur.hud.visible) drawHud(ctx);
    if (cur.tc.visible) drawTouch(ctx);
    if (cur.screen) drawScreen(ctx);
  }

  /* ---------- 常驻 HUD（规格同 .hud-* 样式；触屏态底部仪表簇上移避让虚拟键） ---------- */
  function drawHud(ctx) {
    var u = cur, W = u.W, H = u.H, h = u.hud, ins = u.insets;
    var touch = u.tc.visible;
    var pad = touch ? 8 : 14;

    /* 顶栏：左任务 / 右状态 */
    var topY = Math.max(12, ins.top + 6);
    f(ctx, 15, 'bold');
    var nameW = ctx.measureText(h.levelName).width;
    f(ctx, 15);
    var taskW = ctx.measureText(h.task).width;
    var boxW = nameW + (nameW ? 14 : 0) + taskW + 32;
    ctx.fillStyle = C.chipBg; rr(ctx, 20 + ins.left, topY, boxW, 38, 10); ctx.fill();
    var tx = 20 + ins.left + 16;
    if (h.levelName) {
      f(ctx, 15, 'bold'); ctx.fillStyle = C.gold; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      ctx.fillText(h.levelName, tx, topY + 20); tx += nameW + 14;
    }
    f(ctx, 15); ctx.fillStyle = C.text;
    ctx.fillText(h.task, tx, topY + 20);

    /* 右侧状态 chips：⏱用时 | 💥碰撞 | 辅助 | 🔊 */
    f(ctx, 14);
    var tTime = '⏱ ' + h.time.toFixed(1) + 's';
    var tColl = '💥 ' + h.coll + '/' + h.collMax;
    var tAssist = h.assist || '';
    var wTime = ctx.measureText(tTime).width + 28;
    var wColl = ctx.measureText(tColl).width + 28;
    var wAssist = tAssist ? ctx.measureText(tAssist).width + 28 : 0;
    var wAudio = 44;
    var x = W - 20 - ins.right - wAudio - 10;
    var audioX = W - 20 - ins.right - wAudio;
    ctx.fillStyle = C.chipBg;
    if (wAssist) { rr(ctx, x - wAssist, topY, wAssist, 38, 10); ctx.fill(); }
    rr(ctx, x - wAssist - 10 - wColl, topY, wColl, 38, 10); ctx.fill();
    rr(ctx, x - wAssist - 10 - wColl - 10 - wTime, topY, wTime, 38, 10); ctx.fill();
    rr(ctx, audioX, topY, wAudio, 38, 10); ctx.fill();
    var rx = x;
    if (wAssist) { f(ctx, 13); ctx.fillStyle = C.green; ctx.textAlign = 'center'; ctx.fillText(tAssist, rx - wAssist / 2, topY + 20); rx -= wAssist + 10; }
    f(ctx, 14); ctx.fillStyle = h.coll > 0 ? C.warn : C.text;
    ctx.fillText(tColl, rx - wColl / 2, topY + 20); rx -= wColl + 10;
    ctx.fillStyle = C.text; ctx.fillText(tTime, rx - wTime / 2, topY + 20);
    f(ctx, 16); ctx.fillStyle = C.text; ctx.fillText(h.audioOn ? '🔊' : '🔇', audioX + wAudio / 2, topY + 20);
    h.audioRect = { x: audioX, y: topY, w: wAudio, h: 38 };
    ctx.textAlign = 'left';

    /* 底部仪表簇：挡位 / 车速 / 雷达格（触屏态上移 116px，cluster 缩至 .92） */
    var botY = H - (touch ? 116 : 60) - ins.bottom;
    var cx = W / 2;
    f(ctx, 34, 'bold'); var gearW = ctx.measureText(h.gear).width;
    f(ctx, 30, 'bold'); var speedW = ctx.measureText('' + h.speed).width;
    var clusterW = gearW + 18 + speedW + 44 + 18 + (4 * 10 + 3 * 5) + 36;
    var cl = cx - clusterW / 2;
    ctx.fillStyle = 'rgba(16,18,24,.42)'; rr(ctx, cl, botY, clusterW, 54, 16); ctx.fill();
    ctx.strokeStyle = 'rgba(51,56,66,.4)'; ctx.lineWidth = 1; rr(ctx, cl, botY, clusterW, 54, 16); ctx.stroke();
    var kx = cl + 18;
    f(ctx, 34, 'bold'); ctx.fillStyle = h.gear === 'R' ? C.orange : C.green;
    ctx.textBaseline = 'middle'; ctx.fillText(h.gear, kx, botY + 27); kx += gearW + 18;
    f(ctx, 30, 'bold'); ctx.fillStyle = C.text; ctx.fillText('' + h.speed, kx, botY + 26); kx += speedW;
    f(ctx, 11); ctx.fillStyle = 'rgba(232,234,238,.6)'; ctx.fillText('km/h', kx, botY + 32); kx += 44;
    for (var i = 0; i < 4; i++) {   // 雷达距离格：从右往左点亮（近端橙、远端绿）
      var bx = kx + i * 15;
      ctx.fillStyle = i < h.radarLv ? (i >= 2 ? '#e2701d' : '#2fae4a') : '#2c3038';
      rr(ctx, bx, botY + 14, 10, 26, 3); ctx.fill();
    }

    /* 提示行（位于仪表簇上方） */
    if (h.hint) {
      f(ctx, 14); ctx.fillStyle = C.hint; ctx.textAlign = 'center';
      ctx.shadowColor = '#000'; ctx.shadowBlur = 3;
      ctx.fillText(h.hint, cx, botY - 12);
      ctx.shadowBlur = 0; ctx.textAlign = 'left';
    }

    /* 碰撞红闪（径向渐变边缘泛红，0.5s 衰减） */
    if (h.flash > 0) {
      var g = ctx.createRadialGradient(cx, H / 2, Math.min(W, H) * 0.28, cx, H / 2, Math.max(W, H) * 0.55);
      g.addColorStop(0, 'rgba(255,40,20,0)');
      g.addColorStop(1, 'rgba(255,40,20,' + (0.55 * h.flash).toFixed(3) + ')');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
  }

  /* ---------- 全屏界面（menu/select/briefing/result/pause/selftest） ---------- */
  function drawScreen(ctx) {
    var u = cur, s = u.screen;
    ctx.fillStyle = 'rgba(10,12,16,.82)';   // .screen 遮罩
    ctx.fillRect(0, 0, u.W, u.H);
    var m = s.model;   // {x,y,w,h} 面板外框
    var g = ctx.createLinearGradient(m.x, m.y, m.x, m.y + m.h);
    g.addColorStop(0, C.panelA); g.addColorStop(1, C.panelB);
    ctx.fillStyle = g; rr(ctx, m.x, m.y, m.w, m.h, 18); ctx.fill();
    ctx.strokeStyle = C.border; ctx.lineWidth = 1; rr(ctx, m.x, m.y, m.w, m.h, 18); ctx.stroke();

    /* 可滚内容裁剪（选关/selftest 列表可能超面板） */
    ctx.save();
    ctx.beginPath(); ctx.rect(m.x, m.y, m.w, m.h); ctx.clip();
    ctx.translate(0, -s.viewY);
    var fn = DRAWERS[s.kind];
    if (fn) fn(ctx, s, m);
    /* 按钮（统一绘制器：普通/大按钮/按下高亮） */
    for (var i = 0; i < s.widgets.length; i++) {
      var w = s.widgets[i];
      if (w.hidden) continue;
      drawButton(ctx, w, u.pressed && u.pressed.widget === w);
    }
    ctx.restore();

    /* 滚动条 */
    if (s.contentH > s.viewH) {
      var barH = Math.max(30, s.viewH * s.viewH / s.contentH);
      var barY = m.y + (s.viewH - barH) * (s.viewY / (s.contentH - s.viewH));
      ctx.fillStyle = 'rgba(255,255,255,.18)';
      rr(ctx, m.x + m.w - 5, barY, 3, barH, 2); ctx.fill();
    }
  }

  function drawButton(ctx, w, pressed) {
    if (w.big) {
      var g = ctx.createLinearGradient(w.x, w.y, w.x + w.w, w.y + w.h);
      g.addColorStop(0, C.greenA); g.addColorStop(1, C.greenB);
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = pressed ? '#3a4150' : '#2c313c';
    }
    rr(ctx, w.x, w.y, w.w, w.h, 12); ctx.fill();
    ctx.strokeStyle = w.big ? C.greenA : (pressed ? C.green : '#454b58');
    ctx.lineWidth = 1; rr(ctx, w.x, w.y, w.w, w.h, 12); ctx.stroke();
    /* 文字缩到放得下为止（"继续训练 · 第 N 关 …"等长文案防溢出） */
    var size = w.big ? 19 : 17;
    for (; size > 11; size -= 1) {
      f(ctx, size, w.big ? 'bold' : '');
      if (ctx.measureText(w.label).width <= w.w - 14) break;
    }
    ctx.fillStyle = C.text; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(w.label, w.x + w.w / 2, w.y + w.h / 2 + 1);
    ctx.textAlign = 'left';
  }

  /* 各界面的非按钮内容绘制（按钮统一走 widgets） */
  var DRAWERS = {
    menu: function (ctx, s, m) {
      f(ctx, 36, 'bold'); ctx.fillStyle = C.text; ctx.textAlign = 'center';
      ctx.fillText('停车大师', m.x + m.w / 2, m.y + 58);
      var tw = ctx.measureText('停车大师').width;
      f(ctx, 17); ctx.fillStyle = C.gold;
      ctx.fillText('ParkMaster', m.x + m.w / 2 + tw / 2 + 52, m.y + 66);
      f(ctx, 15); ctx.fillStyle = C.dim;
      ctx.fillText('新手司机停车训练模拟器 · 老小区特训', m.x + m.w / 2, m.y + 92);
      f(ctx, 13); ctx.fillStyle = C.faint; ctx.textBaseline = 'middle';
      var help = [
        '左下 ◀▶ 方向（松开保持角度） · 右下 ▲前进 ▼倒车 · 松开即刹车',
        '⏹ 手刹 · 左上功能列：⏸=暂停 线=引导 俯=俯视 影=倒影',
        '俯视画面可双指拧旋转 · 辅助随时开关，逐步"脱辅"'
      ];
      var hy = m.y + (s.model.helpY || (m.h - 74));
      for (var i = 0; i < help.length; i++) ctx.fillText(help[i], m.x + m.w / 2, hy + i * 22);
      ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    },
    select: function (ctx, s, m) {
      f(ctx, 22, 'bold'); ctx.fillStyle = C.text; ctx.textAlign = 'center';
      ctx.fillText('选择关卡', m.x + m.w / 2, m.y + 38);
      ctx.textAlign = 'left';
      var items = s.model.items;
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (it.head) {   // 章节标题
          f(ctx, 13, 'bold'); ctx.fillStyle = C.blue;
          ctx.fillText(it.head, m.x + 24, m.y + it.y + 18);
          continue;
        }
        /* 卡片坐标与命中测试同源：面板绝对坐标（m.x+it.x, m.y+it.y）。
         * 未解锁的压暗不走 globalAlpha——真机部分内核对半透明文字光栅化异常
         * （"有框无字"实测），直接用暗色变体，渲染路径零透明度依赖 */
        var lv = it.lv;
        var x = m.x + it.x, y = m.y + it.y;
        var dark = !it.unlocked;
        ctx.fillStyle = dark ? '#1a1e26' : '#232833';
        rr(ctx, x, y, it.w, it.h, 12); ctx.fill();
        ctx.strokeStyle = dark ? '#2c3644' : '#3a4150';
        rr(ctx, x, y, it.w, it.h, 12); ctx.stroke();
        f(ctx, 12); ctx.fillStyle = dark ? '#565c68' : '#8b93a3'; ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(lv.id.replace('lv', ''), x + it.w / 2, y + 20);
        f(ctx, 14); ctx.fillStyle = dark ? '#767e8c' : C.text;
        var nameLines = wrap(ctx, lv.name, it.w - 16).slice(0, 2);
        ctx.fillText(nameLines.join(' '), x + it.w / 2, y + 44);
        f(ctx, 14); ctx.fillStyle = dark ? '#8a7440' : C.gold;
        ctx.fillText(it.stars ? stars(it.stars) : '☆☆☆', x + it.w / 2, y + 68);
        f(ctx, 11);
        if (dark) {
          ctx.fillStyle = '#5a6270';
          ctx.fillText('未解锁', x + it.w / 2, y + 86);
        } else {
          ctx.fillStyle = '#e2701d';
          ctx.fillText('▪'.repeat(lv.diff), x + it.w / 2, y + 86);
        }
        ctx.textAlign = 'left';
      }
    },
    briefing: function (ctx, s, m) {
      var lv = s.model.lv;
      f(ctx, 22, 'bold'); ctx.fillStyle = C.text; ctx.textAlign = 'center';
      ctx.fillText(lv.name, m.x + m.w / 2, m.y + 40);
      f(ctx, 14); ctx.fillStyle = '#b8bfcc';
      s.model.descLines.forEach(function (ln, i) {
        ctx.fillText(ln, m.x + m.w / 2, m.y + 68 + i * 25);
      });
      ctx.textAlign = 'left';
      s.model.tipBlocks.forEach(function (tb) {
        ctx.fillStyle = C.green; ctx.fillText('◆', m.x + 64, m.y + tb.y + 16);
        ctx.fillStyle = C.hint;
        tb.lines.forEach(function (ln, j) { ctx.fillText(ln, m.x + 84, m.y + tb.y + 16 + j * 24); });
      });
      f(ctx, 13); ctx.fillStyle = C.faint; ctx.textAlign = 'center';
      ctx.fillText('标准用时 ' + lv.par + ' 秒 · 碰撞 ≤4 次仍可通过，剐蹭会扣分',
        m.x + m.w / 2, m.y + s.model.metaY + 14);
      ctx.textAlign = 'left';
    },
    result: function (ctx, s, m) {
      var r = s.model.result;
      f(ctx, 48); ctx.fillStyle = r.stars > 0 ? C.gold : '#6b7280'; ctx.textAlign = 'center';
      ctx.fillText(stars(r.stars), m.x + m.w / 2, m.y + 62);
      f(ctx, 22, 'bold'); ctx.fillStyle = C.text;
      ctx.fillText(r.stars > 0 ? '停车成功！' : '未能完成', m.x + m.w / 2, m.y + 96);
      var rows = s.model.rows;
      f(ctx, 15);
      for (var i = 0; i < rows.length; i++) {
        var ry = s.model.tableY + i * 32;
        ctx.strokeStyle = '#333842';
        ctx.beginPath(); ctx.moveTo(m.x + 40, ry + 22); ctx.lineTo(m.x + m.w - 40, ry + 22); ctx.stroke();
        ctx.fillStyle = C.dim; ctx.textAlign = 'left'; ctx.fillText(rows[i][0], m.x + 42, ry + 15);
        ctx.fillStyle = C.text; ctx.textAlign = 'right'; ctx.fillText(rows[i][1], m.x + m.w - 42, ry + 15);
      }
      ctx.textAlign = 'left';
    },
    pause: function (ctx, s, m) {
      f(ctx, 22, 'bold'); ctx.fillStyle = C.text; ctx.textAlign = 'center';
      ctx.fillText('暂停', m.x + m.w / 2, m.y + 44);
      ctx.textAlign = 'left';
    },
    selftest: function (ctx, s, m) {
      f(ctx, 20, 'bold'); ctx.fillStyle = C.text; ctx.textAlign = 'center';
      ctx.fillText('全关卡自动驾驶回归 ' + (s.model.allPass ? '— 全部通过 ✓' : '— 存在失败 ✗'), m.x + m.w / 2, m.y + 36);
      f(ctx, 13);
      var lines = s.model.lines;
      for (var i = 0; i < lines.length; i++) {
        var ly = m.y + 70 + i * 26;
        ctx.textAlign = 'left'; ctx.fillStyle = lines[i][0] ? C.green : C.warn;
        ctx.font = 'bold 13px ' + FONT;
        ctx.fillText(lines[i][0] ? 'PASS' : 'FAIL', m.x + 30, ly);
        ctx.fillStyle = C.text; ctx.font = '13px ' + FONT;
        ctx.fillText(lines[i][1], m.x + 84, ly);
      }
      ctx.textAlign = 'left';
    }
  };

  /* ---------- 界面构建（生成 model + widgets，供 draw 与命中测试共用） ---------- */

  /** 建面板：居中，宽高由调用方定，随后 widgets 以面板内坐标布局 */
  function beginScreen(kind, w, h) {
    var W = cur.W, H = cur.H;
    w = Math.min(w, W - 24); h = Math.min(h, H - 16);
    var m = { x: (W - w) / 2, y: (H - h) / 2, w: w, h: h };
    var s = { kind: kind, model: { x: m.x, y: m.y, w: w, h: h }, widgets: [], viewY: 0, viewH: h, contentH: h };
    cur.screen = s;
    return s;
  }
  function btn(s, label, x, y, w, h, cb, big) {
    var bw = { x: s.model.x + x, y: s.model.y + y, w: w, h: h, label: label, cb: cb, big: !!big };
    s.widgets.push(bw);
    return bw;
  }
  function syncContentH(s) {   // 内容底边超出面板时扩容 contentH（启用滚动）
    var bottom = 0;
    for (var i = 0; i < s.widgets.length; i++) bottom = Math.max(bottom, s.widgets[i].y + s.widgets[i].h - s.model.y);
    var extra = s.model.extraH || 0;
    s.contentH = Math.max(s.model.h, bottom + extra);
    s.viewH = s.model.h;
    s.viewY = Math.max(0, Math.min(s.viewY, s.contentH - s.viewH));
  }

  function showMenu(onStart, onSelect, cont) {
    var W = cur.W, H = cur.H;
    var pw = Math.min(560, W - 32);
    /* 按钮栈与帮助文案实算排布（横屏矮面板下不再与文案重叠，超出才滚动） */
    var y = 112;
    var stack = [];
    if (cont) {
      stack.push({ label: cont.label, w: 310, h: 46, cb: cont.cb, big: true });
      stack.push({ label: '从头开始', w: 250, h: 42, cb: onStart });
      stack.push({ label: '选择关卡', w: 250, h: 42, cb: onSelect });
    } else {
      stack.push({ label: '开始训练', w: 250, h: 46, cb: onStart, big: true });
      stack.push({ label: '选择关卡', w: 250, h: 42, cb: onSelect });
    }
    stack.forEach(function (b) { b.y = y; y += b.h + 10; });
    var helpY = y + 4;
    var HELP_LINES = 3, HELP_LINE_H = 22;
    var contentH = helpY + HELP_LINES * HELP_LINE_H + 16;
    var s = beginScreen('menu', pw, Math.min(contentH, H - 16));
    var m = s.model;
    s.model.helpY = helpY;
    stack.forEach(function (b) { btn(s, b.label, (m.w - b.w) / 2, b.y, b.w, b.h, b.cb, b.big); });
    s.contentH = contentH; s.viewH = m.h;
    cur.dirty = true;
  }

  function showSelect(items, onPick, onBack) {
    var W = cur.W, H = cur.H;
    var pw = Math.min(720, W - 24);
    var cardW = 150, cardH = 100, gap = 12;
    var inner = pw - 48;
    var cols = Math.max(2, Math.floor((inner + gap) / (cardW + gap)));
    cardW = Math.floor((inner - (cols - 1) * gap) / cols);

    /* 先量内容高：章标题 + 网格行（换章前先收尾当前行，否则标题与上一行卡片重叠） */
    var model = { items: [] };
    var curCh = null, colIdx = 0, y = 64;
    items.forEach(function (it) {
      if (it.lv.chapter !== curCh) {
        if (colIdx > 0) { y += cardH + gap; colIdx = 0; }
        curCh = it.lv.chapter;
        model.items.push({ head: it.lv.chapterTitle || ('第 ' + curCh + ' 章'), y: y });
        y += 34;
      }
      var cx = 24 + colIdx * (cardW + gap);
      model.items.push({ lv: it.lv, unlocked: it.unlocked, stars: it.stars, x: cx, y: y, w: cardW, h: cardH });
      colIdx++;
      if (colIdx >= cols) { colIdx = 0; y += cardH + gap; }
    });
    if (colIdx > 0) y += cardH;
    y += 16;
    var backY = y;
    var contentH = backY + 58;

    var s = beginScreen('select', pw, Math.min(contentH, H - 16));
    /* 布局坐标以面板内相对坐标重算（beginScreen 可能压高了面板 → 缩进滚动区） */
    var m = s.model;
    s.model.items = model.items;
    s.model.contentScaleY = 1;
    /* 卡片即 widgets（locked 不响应） */
    model.items.forEach(function (mi) {
      if (mi.head) return;
      s.widgets.push({
        x: m.x + mi.x, y: m.y + mi.y, w: mi.w, h: mi.h,
        label: '', card: mi, locked: !mi.unlocked,
        cb: mi.unlocked ? (function (lv) { return function () { onPick(lv); }; })(mi.lv) : null,
        big: false, hidden: false
      });
    });
    btn(s, '返回', (m.w - 200) / 2, backY, 200, 44, onBack);
    s.contentH = contentH; s.viewH = m.h;
    cur.dirty = true;
  }

  function showBriefing(lv, onStart, onBack, opts) {
    var W = cur.W, H = cur.H;
    var pw = Math.min(560, W - 32);
    /* 内容实算排布：标题→描述→要点列表→meta→按钮（矮面板下不再重叠，超出滚动） */
    var ctx = cur.ctx;
    f(ctx, 14);
    var descLines = wrap(ctx, lv.desc || '', pw - 88);
    var y = 66 + descLines.length * 25 + 10;
    var tipBlocks = [];
    (lv.tips || []).forEach(function (t) {
      var lines = wrap(ctx, t, pw - 140);
      tipBlocks.push({ lines: lines, y: y });
      y += lines.length * 24 + 8;
    });
    var metaY = y + 8;
    var goY = metaY + 28;
    var backY = goY + 48 + 10;
    var contentH = backY + 44 + 18;
    var s = beginScreen('briefing', pw, Math.min(contentH, H - 16));
    var m = s.model;
    s.model.lv = lv;
    s.model.descLines = descLines;
    s.model.tipBlocks = tipBlocks;
    s.model.metaY = metaY;
    btn(s, '开始', (m.w - 300) / 2, goY, 300, 48, onStart, true);
    btn(s, '返回选关', (m.w - 260) / 2, backY, 260, 44, onBack);
    s.contentH = contentH; s.viewH = m.h;
    cur.dirty = true;
  }

  function showResult(level, result, onRetry, onNext, onMenu, hasNext, onReplay) {
    var W = cur.W, H = cur.H;
    var pass = result.stars > 0;
    var posTxt = result.posOffset < 0.01
      ? (result.posOffset * 1000).toFixed(0) + ' mm'
      : (result.posOffset * 100).toFixed(1) + ' cm';
    var rows = [
      ['得分', '' + result.score], ['位置偏差', posTxt],
      ['角度偏差', result.devDeg.toFixed(1) + '°'], ['碰撞', result.collisions + ' 次'],
      ['用时', result.time.toFixed(1) + ' s（标准 ' + level.par + 's）']
    ];
    var pw = Math.min(520, W - 32);
    /* 内容实算：星标→标题→表格→按钮（按钮跟在表格实际底边之后，矮面板不重叠） */
    var tableY = 112;
    var by = tableY + rows.length * 32 + 16;
    var contentH = by + 46 + 22;
    var s = beginScreen('result', pw, Math.min(contentH, H - 16));
    var m = s.model;
    s.model.result = result;
    s.model.rows = rows;
    s.model.tableY = tableY;
    var names = ['再来一次'];
    var cbs = [onRetry];
    var bigs = [false];
    if (onReplay) { names.push('复盘回放'); cbs.push(onReplay); bigs.push(false); }
    if (pass && hasNext) { names.push('下一关'); cbs.push(onNext); bigs.push(true); }
    names.push('返回菜单'); cbs.push(onMenu); bigs.push(false);
    var bw = Math.min(150, Math.floor((m.w - 40 - (names.length - 1) * 10) / names.length));
    var total = names.length * bw + (names.length - 1) * 10;
    var x0 = (m.w - total) / 2;
    for (var i = 0; i < names.length; i++) {
      btn(s, names[i], x0, by, bw, 46, cbs[i], bigs[i]);
      x0 += bw + 10;
    }
    s.contentH = contentH; s.viewH = m.h;
    cur.dirty = true;
  }

  function showPause(onResume, onRetry, onMenu) {
    var W = cur.W, H = cur.H;
    var s = beginScreen('pause', 360, Math.min(320, H - 20));
    var m = s.model;
    btn(s, '继续', (m.w - 260) / 2, 84, 260, 48, onResume, true);
    btn(s, '重新开始', (m.w - 260) / 2, 146, 260, 44, onRetry);
    btn(s, '返回菜单', (m.w - 260) / 2, 202, 260, 44, onMenu);
    syncContentH(s);
    cur.dirty = true;
  }

  function showSelftest(lines, allPass) {
    var pw = Math.min(720, cur.W - 24);
    var contentH = 70 + lines.length * 26 + 20;
    var s = beginScreen('selftest', pw, Math.min(contentH, cur.H - 16));
    s.model.lines = lines;
    s.model.allPass = allPass;
    s.contentH = contentH; s.viewH = s.model.h;
    cur.dirty = true;
  }

  /* ---------- 虚拟驾驶控件（布局/绘制/命中，规格同 .tc-* 样式） ---------- */

  function layoutTouch() {
    if (!cur || !cur.tc.buttons.length) return;
    var H = cur.H, W = cur.W, ins = cur.insets;
    var L = 16 + ins.left, R = W - 16 - ins.right, B = H - 24 - ins.bottom;
    var doneY = 0;
    cur.tc.buttons.forEach(function (b) {
      switch (b.id) {
        case 'wheel': b.w = b.h = 124; b.x = L; b.y = H - 34 - ins.bottom - 124; break;   // 底部留 34px 给"双击回正"小字
        case 'lml': case 'lmr': {
          /* 自适应：H≥372 叠在方向盘正上方（离中央仪表簇远）；矮横屏（H≈360-366）
           * 上方空间不足，放方向盘右侧（此类小屏无刘海，中央簇不会压过来） */
          b.w = b.h = 46;
          var wheelTop = H - 34 - ins.bottom - 124;
          if (H >= 372) {
            b.x = L + 39;
            b.y = wheelTop - (b.id === 'lml' ? 104 : 52);
          } else {
            b.x = L + 140;
            b.y = wheelTop + (b.id === 'lml' ? 8 : 72);
          }
          break;
        }
        case 'w': b.x = R - 104 - 76; b.y = B - 76; b.w = b.h = 76; break;
        case 's': b.x = R - 76; b.y = B - 76; b.w = b.h = 76; break;
        case 'space': b.x = R - 62; b.y = B - 116 - 62; b.w = b.h = 62; break;
        case 'pause': case 'g': case 'm': case 'c': case 'madj': {
          /* 功能钮横排贴顶（HUD 状态条下方，自左缘向右展开）。原右上横排正压在车内
           * 后视镜的前进视野投影带（画面中上偏右，~0.6W-0.85W）；竖排在矮横屏
           * （H≈375-430）又与右下手刹重叠（真机实测 bug），故取左上。
           * 按住看镜时整排隐藏（tcBtnVisible）——看右镜时车内镜会扫到左上角 */
          var fi = { pause: 0, g: 1, m: 2, c: 3, madj: 4 }[b.id];
          b.w = b.h = 46;
          b.y = 64 + ins.top;
          b.x = 14 + ins.left + fi * 60;   // 间距 14px
          break;
        }
        case 'm1': case 'm2': case 'm3': {
          var ci = { m1: 0, m2: 1, m3: 2 }[b.id];
          b.w = 104; b.h = 42;
          b.x = W / 2 - 168 + ci * 116;
          b.y = 88 + ins.top;
          break;
        }
        case 'mup': case 'mlf': case 'mrg': case 'mdn': {
          b.w = b.h = 54;
          var pi = { mup: 0, mlf: 1, mrg: 2, mdn: 3 }[b.id];
          b.x = W / 2 + [-27, -81, 27, -27][pi];
          b.y = 140 + ins.top + [0, 52, 52, 104][pi];
          break;
        }
        case 'mdone':
          b.w = 150; b.h = 44;
          b.x = W / 2 - 75;
          b.y = Math.max(312 + ins.top, H - 24 - ins.bottom - 44);
          doneY = b.y;
          break;
      }
    });
    cur.tc.mirrorBounds = { x: W / 2 - 182, y: 64 + ins.top, w: 364, h: (doneY || 356) + 56 - (64 + ins.top) };
    cur.dirty = true;
  }

  function drawTouch(ctx) {
    var bs = cur.tc.buttons;
    var mm = cur.game && cur.game.mirrorMode;
    /* 调镜模式：面板底衬 + 标题（镜像组按钮随后统一绘制） */
    if (mm && cur.tc.mirrorBounds) {
      var mb = cur.tc.mirrorBounds;
      ctx.fillStyle = 'rgba(16,18,24,.86)';
      rr(ctx, mb.x, mb.y, mb.w, mb.h, 18); ctx.fill();
      ctx.strokeStyle = C.border; ctx.lineWidth = 1; rr(ctx, mb.x, mb.y, mb.w, mb.h, 18); ctx.stroke();
      f(ctx, 17, 'bold'); ctx.fillStyle = C.text; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('后视镜调节', cur.W / 2, mb.y + 24);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    }
    for (var i = 0; i < bs.length; i++) {
      var b = bs[i];
      if (!tcBtnVisible(b)) continue;
      if (b.id === 'wheel') { drawWheel(ctx, b); continue; }
      if (b.grp === 'mirror' && b.id !== 'mdone') b.on = b.cb ? (cur.game.mirrorSel === ({ m1: 0, m2: 1, m3: 2 })[b.id]) : b.on;
      var rect = b.grp === 'mirror' && b.id !== 'mdone';   // chips 为圆角矩形，其余圆形
      if (rect) {
        ctx.fillStyle = b.on ? 'rgba(111,214,111,.4)' : '#2c313c';
        rr(ctx, b.x, b.y, b.w, b.h, 10); ctx.fill();
        ctx.strokeStyle = b.on ? C.green : '#454b58';
        ctx.lineWidth = 1; rr(ctx, b.x, b.y, b.w, b.h, 10); ctx.stroke();
        ctx.fillStyle = b.on ? '#c9f2cf' : C.text;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        f(ctx, 14, 'bold');
        ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 1);
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        continue;
      }
      ctx.fillStyle = b.held ? 'rgba(111,214,111,.5)'
        : (b.on ? 'rgba(111,214,111,.4)' : 'rgba(20,24,30,.55)');
      ctx.beginPath(); ctx.arc(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = b.on ? C.green : 'rgba(255,255,255,.19)';
      ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = b.on ? '#c9f2cf' : C.text;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      f(ctx, (b.drive || b.pad) ? 30 : 15, 'bold');
      ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 - ((b.drive || b.pad) && b.cap ? 5 : 0));
      if ((b.drive || b.pad) && b.cap) {
        f(ctx, 10, '');
        ctx.fillStyle = 'rgba(232,234,238,.75)';
        ctx.fillText(b.cap, b.x + b.w / 2, b.y + b.h - 14);
      }
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    }
  }

  /** 模拟量方向盘（v2 规划项）：轮缘 + 三辐条随拖动旋转，±135°=满打，双击回正 */
  function drawWheel(ctx, b) {
    var cx = b.x + b.w / 2, cy = b.y + b.h / 2, r = b.w / 2;
    var active = Math.abs(b.angle) > 2;
    ctx.fillStyle = 'rgba(20,24,30,.5)';
    ctx.beginPath(); ctx.arc(cx, cy, r - 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = active ? 'rgba(111,214,111,.85)' : 'rgba(232,234,238,.5)';
    ctx.lineWidth = 10;
    ctx.beginPath(); ctx.arc(cx, cy, r - 6, 0, Math.PI * 2); ctx.stroke();
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(b.angle * Math.PI / 180);
    ctx.fillStyle = 'rgba(232,234,238,.72)';
    ctx.fillRect(-(r - 12), -(r - 12) * 0.09, (r - 12) * 0.95, (r - 12) * 0.18);   // 左辐条
    ctx.fillRect((r - 12) * 0.05, -(r - 12) * 0.09, (r - 12) * 0.95, (r - 12) * 0.18); // 右辐条
    ctx.fillRect(-(r - 12) * 0.09, 0, (r - 12) * 0.18, (r - 12) * 0.62);            // 下辐条
    ctx.fillStyle = 'rgba(111,214,111,.82)';
    ctx.beginPath(); ctx.arc(0, 0, (r - 12) * 0.2, 0, Math.PI * 2); ctx.fill();     // 中央徽标
    ctx.restore();
    f(ctx, 10, '');
    ctx.fillStyle = 'rgba(232,234,238,.65)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('方向盘·双击回正', cx, cy + r + 11);   // 轮外下方：避开轮缘与辐条
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }

  /* ---------- 触摸路由 ---------- */

  function pt(t) { return { x: t.clientX, y: t.clientY }; }
  function hit(w, p, scrollY) {
    return p.x >= w.x && p.x <= w.x + w.w && p.y >= w.y - (scrollY || 0) && p.y <= w.y + w.h - (scrollY || 0);
  }
  function hitCircle(b, p) {
    var dx = p.x - (b.x + b.w / 2), dy = p.y - (b.y + b.h / 2);
    return dx * dx + dy * dy <= (b.w / 2) * (b.w / 2);
  }
  /** 触点相对方向盘中心的角度（度，屏幕坐标系顺时针为正）——抓轮缘旋转用 */
  function wheelPtAngle(p, wheel) {
    return Math.atan2(p.y - (wheel.y + wheel.h / 2), p.x - (wheel.x + wheel.w / 2)) * 180 / Math.PI;
  }

  function onTouchStart(ev) {
    if (!cur) return;
    var ts = ev.changedTouches;
    for (var i = 0; i < ts.length; i++) {
      var p = pt(ts[i]), id = ts[i].identifier;
      if (cur.screen) {   // 全屏界面优先：按钮抬起触发，空白处拖动滚动
        var wgt = null;
        for (var j = 0; j < cur.screen.widgets.length; j++) {
          var w = cur.screen.widgets[j];
          if (!w.hidden && !w.locked && w.cb && hit(w, p, cur.screen.viewY)) { wgt = w; break; }
        }
        if (wgt) cur.pressed = { id: id, widget: wgt, x: p.x, y: p.y, moved: 0 };
        else cur.drag = { id: id, y: p.y, viewY: cur.screen.viewY };
      } else if (cur.tc.visible) {   // 虚拟驾驶键：按下即生效（按住语义）
        var bs = cur.tc.buttons;
        var wheel = null;
        for (var q = 0; q < bs.length; q++) if (bs[q].id === 'wheel') { wheel = bs[q]; break; }
        if (wheel && tcBtnVisible(wheel) && hitCircle(wheel, p)) {
          /* 方向盘：按下抓轮缘（320ms 内二次按下=回正），绕中心旋转（与真车同向，
           * ±270° 满打——与座舱方向盘转动圈数 1:1） */
          var now = performance.now();
          if (now - cur.tc.lastWheelTap < 320) {
            wheel.angle = 0;
            cur.game.touchAnalog.steer = 0;
          }
          cur.tc.lastWheelTap = now;
          cur.tc.wheelGrab = { id: id, a: wheelPtAngle(p, wheel) };
          cur.dirty = true;
        }
        for (var k = 0; k < bs.length; k++) {
          var b = bs[k];
          if (b.id === 'wheel' || !tcBtnVisible(b)) continue;
          if (!hitCircle(b, p)) continue;
          if (b.drive || b.pad) {
            b.held = true;
            cur.tc.holds[id] = b;
            cur.game.keys[b.key] = true;
          } else if (b.look) {
            b.held = true;
            cur.tc.holds[id] = b;
            cur.game.lookHeld = b.look;
          } else if (b.cb && !cur.pressed) {
            cur.pressed = { id: id, widget: b, x: p.x, y: p.y, moved: 0, round: true };
          }
          cur.dirty = true;
          break;
        }
        /* HUD 音效 chip（无全屏界面时） */
        if (!cur.pressed && cur.hud.visible && cur.hud.audioRect) {
          var a = cur.hud.audioRect;
          if (p.x >= a.x && p.x <= a.x + a.w && p.y >= a.y && p.y <= a.y + a.h) {
            if (cur.hudApi && cur.hudApi.onAudioToggle) cur.hudApi.onAudioToggle();
          }
        }
      } else if (cur.hud.visible && cur.hud.audioRect) {   // 键盘设备菜单态等边缘情形
        var a2 = cur.hud.audioRect;
        if (p.x >= a2.x && p.x <= a2.x + a2.w && p.y >= a2.y && p.y <= a2.y + a2.h) {
          if (cur.hudApi && cur.hudApi.onAudioToggle) cur.hudApi.onAudioToggle();
        }
      }
    }
  }

  function onTouchMove(ev) {
    if (!cur) return;
    var ts = ev.changedTouches;
    for (var i = 0; i < ts.length; i++) {
      var p = pt(ts[i]), id = ts[i].identifier;
      if (cur.tc.wheelGrab && cur.tc.wheelGrab.id === id) {
        /* 方向盘：轮角跟随触点极角（1:1，±270°=满打——与座舱方向盘圈数一致），松手保持——
         * 顺时针（轮右转）steer 为负、逆时针（左转）为正，与真车同向 */
        var g = cur.tc.wheelGrab, wheel = null, bs2 = cur.tc.buttons;
        for (var w = 0; w < bs2.length; w++) if (bs2[w].id === 'wheel') { wheel = bs2[w]; break; }
        if (wheel) {
          var a = wheelPtAngle(p, wheel), d = a - g.a;
          if (d > 180) d -= 360;    // 跨 ±π 跳变保护
          if (d < -180) d += 360;
          g.a = a;
          wheel.angle = Math.max(-270, Math.min(270, wheel.angle + d));
          cur.game.touchAnalog.steer = -wheel.angle / 270;
          cur.dirty = true;
        }
      } else if (cur.pressed && cur.pressed.id === id) {
        cur.pressed.moved += Math.abs(p.x - cur.pressed.x) + Math.abs(p.y - cur.pressed.y);
        cur.pressed.x = p.x; cur.pressed.y = p.y;
      } else if (cur.drag && cur.drag.id === id && cur.screen) {
        cur.screen.viewY = Math.max(0, Math.min(cur.screen.contentH - cur.screen.viewH, cur.drag.viewY + (cur.drag.y - p.y)));
        cur.dirty = true;
      } else if (cur.tc.visible && cur.tc.holds[id]) {   // 滑出圆形键即抬起（多点各键独立）
        var b = cur.tc.holds[id];
        if (!hitCircle(b, p)) {
          b.held = false;
          if (b.look) cur.game.lookHeld = 0;
          else cur.game.keys[b.key] = false;
          delete cur.tc.holds[id];
          cur.dirty = true;
        }
      }
    }
  }

  function onTouchEnd(ev) {
    if (!cur) return;
    var ts = ev.changedTouches;
    for (var i = 0; i < ts.length; i++) {
      var p = pt(ts[i]), id = ts[i].identifier;
      if (cur.tc.wheelGrab && cur.tc.wheelGrab.id === id) cur.tc.wheelGrab = null;   // 松轮保持转角
      if (cur.tc.holds[id]) {   // 驾驶键/看镜钮/方向钮抬起
        var b = cur.tc.holds[id];
        b.held = false;
        if (b.look) cur.game.lookHeld = 0;
        else cur.game.keys[b.key] = false;
        delete cur.tc.holds[id];
        cur.dirty = true;
      }
      if (cur.pressed && cur.pressed.id === id) {
        var w = cur.pressed.widget;
        var ok = cur.pressed.moved < 14;   // 滑动超阈值视为取消（滚动误触保护）
        if (ok && cur.pressed.round) ok = hitCircle(w, p);
        else if (ok && cur.screen) ok = hit(w, p, cur.screen.viewY);
        cur.pressed = null;
        cur.dirty = true;
        if (ok && w.cb) {
          try { w.cb(); } catch (e) {}
          cur.dirty = true;
        }
      }
      if (cur.drag && cur.drag.id === id) cur.drag = null;
    }
  }

  /* ---------- 帧驱动：闪烁衰减 + 脏重绘 + 贴图合成 ---------- */

  function decayFlash(nowSec) {
    if (!cur) return;
    if (cur.lastT == null) cur.lastT = nowSec;
    var dt = Math.min(0.1, nowSec - cur.lastT);
    cur.lastT = nowSec;
    if (cur.hud.flash > 0) {
      cur.hud.flash = Math.max(0, cur.hud.flash - dt * 2);
      cur.dirty = true;
    }
  }

  /** 帧驱动（调试页/测试直接调用；小游戏端由 presentOverlay 驱动） */
  function tick(nowSec) {
    if (!cur) return;
    decayFlash(nowSec == null ? performance.now() / 1000 : nowSec);
    ensureSize();
    if (cur.dirty) { cur.dirty = false; drawAll(); }
  }

  /* 小游戏：UI 画布 → CanvasTexture 全屏透明贴图，主场景渲染后叠加（depth 关闭）。
   * 每个渲染帧都要合成（主渲染清屏后叠 UI）。贴图必须每帧重传（needsUpdate）：
   * 微信运行时的 GL 会在两次上传之间丢弃 CanvasTexture 内容（实测 PC/真机：仅按
   * dirty 上传时，静止界面的纹理在数帧后失效，屏幕只剩顶部残条——卡片"有框无字"
   * 的真凶）。drawAll 仍按 dirty 差量，上传带宽 ≈2.9MB/帧为已验证可承受成本 */
  var overlay = null;
  function presentOverlay(renderer) {
    if (!cur) return;
    decayFlash(performance.now() / 1000);
    ensureSize();
    var THREE = window.THREE;
    if (!overlay) {
      var tex = new THREE.CanvasTexture(cur.canvas);
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      var geo = new THREE.PlaneGeometry(1, 1);
      var mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
      var mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(0.5, 0.5, 0);
      var cam = new THREE.OrthographicCamera(0, 1, 1, 0, 0, 1);
      var sc = new THREE.Scene();
      sc.add(mesh);
      overlay = { tex: tex, cam: cam, scene: sc };
    }
    if (overlay.tex.image !== cur.canvas) overlay.tex.image = cur.canvas;
    if (cur.dirty) { cur.dirty = false; drawAll(); }
    overlay.tex.needsUpdate = true;
    var prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(overlay.scene, overlay.cam);
    renderer.autoClear = prevAuto;
  }

  /* ---------- 对外：hud api（与 PS.Hud.createHud 逐项对齐） ---------- */

  function createHud(game) {
    ensure(game);
    var h = cur.hud;
    var api = {
      screenEl: null,               // 手柄菜单导航用（DOM）；小游戏无手柄
      onAudioToggle: null,
      showHud: function (level, opts) {
        h.visible = true;
        h.levelName = level.name;
        h.task = '目标：倒入白色标线车位';
        h.coll = 0;
        h.collMax = (opts && opts.maxColl) || 5;
        h.hint = level.tips ? level.tips[0] : '';
        h.flash = 0;
        cur.dirty = true;
      },
      hideHud: function () { h.visible = false; cur.dirty = true; },
      setAudioOn: function (on) { h.audioOn = on; cur.dirty = true; },
      update: function (state) {
        var t = Math.round(state.time * 10) / 10;
        var sp = Math.round(Math.abs(state.speed) * 3.6);
        var range = state.radarRange || 2.5;
        var lv4 = state.radar != null ? Math.ceil(Math.max(0, 1 - state.radar / range) * 4) : 0;
        if (h.time !== t || h.coll !== state.collisions || h.gear !== state.gear ||
            h.speed !== sp || h.radarLv !== lv4 || h.hint !== (state.hint || '') ||
            h.assist !== (state.assistText || '')) {
          h.time = t; h.coll = state.collisions; h.gear = state.gear; h.speed = sp;
          h.radarLv = lv4; h.hint = state.hint || ''; h.assist = state.assistText || '';
          cur.dirty = true;
        }
      },
      flash: function () { h.flash = 1; cur.dirty = true; },
      showMainMenu: function (onStart, onSelect, cont) { showMenu(onStart, onSelect, cont); },
      showLevelSelect: function (items, onPick, onBack) { showSelect(items, onPick, onBack); },
      showBriefing: function (level, onStart, onBack, opts) { showBriefing(level, onStart, onBack, opts); },
      showResult: function (level, result, onRetry, onNext, onMenu, hasNext, onReplay) {
        showResult(level, result, onRetry, onNext, onMenu, hasNext, onReplay);
      },
      showPause: function (onResume, onRetry, onMenu) { showPause(onResume, onRetry, onMenu); },
      showSelftest: function (lines, allPass) { showSelftest(lines, allPass); },
      showScreen: function () { /* DOM 版内部接口，canvas 版由 show* 直接构建 */ },
      hideScreen: function () { cur.screen = null; cur.dirty = true; }
    };
    cur.hudApi = api;
    return api;
  }

  function buildTouchControls(game) {
    ensure(game);
    var tc = cur.tc;
    if (tc.buttons.length) return;
    function drive(id, label, cap, key) {
      tc.buttons.push({ id: id, label: label, cap: cap, key: key, grp: 'drive', drive: true, held: false, on: false, x: 0, y: 0, w: 0, h: 0 });
    }
    function fn(id, label, cb) {
      tc.buttons.push({ id: id, label: label, cap: '', cb: cb, grp: 'fn', drive: false, on: false, x: 0, y: 0, w: 46, h: 46 });
      return tc.buttons[tc.buttons.length - 1];
    }
    /* 模拟量方向盘（替换 ◀▶ 数字转向键）：抓轮缘旋转 ±270°=满打（与座舱方向盘圈数 1:1） */
    tc.buttons.push({ id: 'wheel', label: '', cap: '', grp: 'drive', drive: false, on: false, angle: 0, x: 0, y: 0, w: 124, h: 124 });
    tc.wheelGrab = null;
    tc.lastWheelTap = 0;
    drive('w', '▲', '前进', 'w');
    drive('s', '▼', '倒车', 's');
    drive('space', '⏹', '手刹', 'space');
    /* 按住看镜（与键盘 Z/X 同语义） */
    tc.buttons.push({ id: 'lml', label: '左镜', cap: '按住看', grp: 'look', look: 1, held: false, on: false, x: 0, y: 0, w: 46, h: 46 });
    tc.buttons.push({ id: 'lmr', label: '右镜', cap: '按住看', grp: 'look', look: 2, held: false, on: false, x: 0, y: 0, w: 46, h: 46 });
    fn('pause', '⏸', function () {
      if (game.state === 'playing') game.pause();
      else if (game.state === 'paused') game.resume();
    });
    var g = fn('g', '线', function () { game.toggleGuide(); });
    var m = fn('m', '俯', function () { game.toggleTop(); });
    var c = fn('c', '影', function () { game.toggleRevCam(); });
    fn('madj', '调镜', function () {
      game.mirrorMode = true;
      releaseAll();
    });
    /* 后视镜调节面板（调节模式下替换驾驶控件）：选镜 chips + 按住方向钮 + 完成。
     * 方向钮直写 keys——调节模式 game.adjustMirrors 消费同一键位 */
    function mirrorChip(id, label, sel) {
      tc.buttons.push({ id: id, label: label, grp: 'mirror', cb: function () { game.mirrorSel = sel; }, x: 0, y: 0, w: 104, h: 42 });
    }
    function padArrow(id, label, key) {
      tc.buttons.push({ id: id, label: label, cap: '', grp: 'mirror', key: key, pad: true, held: false, on: false, x: 0, y: 0, w: 54, h: 54 });
    }
    tc.buttons.push({ id: 'mdone', label: '完成', grp: 'mirror', cb: function () { game.mirrorMode = false; releaseAll(); }, x: 0, y: 0, w: 150, h: 44 });
    mirrorChip('m1', '左外镜', 0);
    mirrorChip('m2', '右外镜', 1);
    mirrorChip('m3', '车内镜', 2);
    padArrow('mup', '▲', 'w');
    padArrow('mlf', '◀', 'a');
    padArrow('mrg', '▶', 'd');
    padArrow('mdn', '▼', 's');
    layoutTouch();
    game._tcSetVisible = function (v) { tc.visible = v; cur.dirty = true; };
    game._tcFns = {
      g: { setOn: function (on) { g.on = on; cur.dirty = true; } },
      m: { setOn: function (on) { m.on = on; cur.dirty = true; } },
      c: { setOn: function (on) { c.on = on; cur.dirty = true; } }
    };
    tc.visible = false;
    cur.dirty = true;
  }

  /** 释放所有按住态（进入/退出调节模式时防键位卡死） */
  function releaseAll() {
    var tc = cur.tc;
    for (var k in tc.holds) {
      var b = tc.holds[k];
      b.held = false;
      if (b.key && cur.game.keys) cur.game.keys[b.key] = false;
      if (b.look) cur.game.lookHeld = 0;
      delete tc.holds[k];
    }
    cur.dirty = true;
  }

  /** 触屏按钮可见性：调镜模式下驾驶/看镜/功能组隐藏，镜像面板组替换显示；
   *  按住看镜（左/右）时功能组隐藏——车内镜画面会扫到画面顶部，避免遮挡与误触 */
  function tcBtnVisible(b) {
    if (!cur.tc.visible) return false;
    var mm = cur.game && cur.game.mirrorMode;
    if (mm) return b.grp === 'mirror';
    if (b.grp === 'fn' && cur.game && cur.game.lookHeld) return false;
    return true;
  }

  return {
    createHud: createHud,
    buildTouchControls: buildTouchControls,
    /** 帧驱动（调试页/测试直接调用；小游戏端由 presentOverlay 驱动） */
    tick: tick,
    /** 单例访问（debug_wxui.html 用：取画布上屏、注入合成触摸事件） */
    __ui: function () { return cur; },
    /** 合成触摸事件入口（调试页把鼠标翻译成 touches 总线事件；正式端走 platform 总线） */
    __dispatch: function (kind, ev) {
      if (kind === 'start') onTouchStart(ev);
      else if (kind === 'move') onTouchMove(ev);
      else onTouchEnd(ev);
    }
  };
});