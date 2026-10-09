/* js/platform.js · 微信小游戏模块（tools/build_wx.js 生成，勿手改） */
var window = GameGlobal, self = GameGlobal;   /* UMD 根 → 跨模块共享全局 */
var module, exports, define;                  /* 遮蔽 CommonJS：强制浏览器分支 */
/* 平台抽象层（浏览器 / 微信小游戏双端）
 * 目标：把所有"浏览器有、小游戏没有"的环境差异收口到一个对象里——
 *   DOM（document/body/classList）、window 尺寸、resize/前后台事件、键盘、
 *   画布创建（小游戏首个 wx.createCanvas 是屏幕画布，之后才是离屏）、
 *   WebAudio（小游戏 wx.createWebAudioContext）、localStorage（同步 KV）、
 *   触屏事件（小游戏无 canvas 事件，只有全局 wx.onTouch*）。
 * 上层（game.js/ui_wx.js）只调 PS.Platform.*，不直接碰 document/wx。
 * Node 端（无头回归）不加载本文件，业务模块各自保留兜底。 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.PS = root.PS || {}; root.PS.Platform = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  var isWx = typeof wx !== 'undefined' && !!wx.getSystemInfoSync;
  var isWeb = !isWx && typeof document !== 'undefined';

  /* ---------- 小游戏端状态 ---------- */
  var wxScreenCanvas = null;      // 屏幕画布（首个 wx.createCanvas），three.js 主渲染目标
  var canvasCreated = false;      // 是否已创建过画布（首块=屏幕，之后=离屏）
  var resizeCbs = [];
  var visibilityCbs = [];
  var globalPointCbs = [];        // 任意触下（解锁音频用）
  var canvasTouchHandlers = [];   // onCanvasTouch 注册的处理器（统一触摸总线分发）
  var overlayRenderFn = null;     // ui_wx 注册的 UI 合成钩子（全屏贴图叠加进主画布）
  var overlayNeedsFrameFn = null; // ui_wx 注册的"UI 是否有新内容"判定（game.js 整帧门控用）
  var launchQuery = null;         // 启动参数缓存（getLaunchOptionsSync 只在启动有意义）
  var winInfo = null;             // 窗口信息缓存（resize 时刷新）

  function refreshWinInfo() {
    if (!isWx) return;
    try { winInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync(); }
    catch (e) { winInfo = winInfo || { windowWidth: 375, windowHeight: 667, pixelRatio: 2 }; }
  }

  /* 触摸总线：wx.onTouch* 一次注册，分发给 canvas 触摸订阅者与全局触下回调。
   * 事件形状与浏览器 TouchEvent 的 touches/changedTouches 对齐（identifier/clientX/clientY），
   * game.js 的双指拧镜头与 ui_wx 的控件命中测试消费同一份数据。 */
  function dispatchTouch(kind, e) {
    if (!e || !e.touches) return;
    var ev = {
      type: kind,
      touches: e.touches,
      changedTouches: e.changedTouches || e.touches,
      preventDefault: function () {}
    };
    for (var i = 0; i < canvasTouchHandlers.length; i++) canvasTouchHandlers[i][kind](ev);
    if (kind === 'start') for (var j = 0; j < globalPointCbs.length; j++) globalPointCbs[j](ev);
  }

  function initWx() {
    refreshWinInfo();
    wx.onTouchStart(function (e) { dispatchTouch('start', e); });
    wx.onTouchMove(function (e) { dispatchTouch('move', e); });
    wx.onTouchEnd(function (e) { dispatchTouch('end', e); });
    wx.onTouchCancel(function (e) { dispatchTouch('end', e); });
    wx.onWindowResize(function () {
      refreshWinInfo();
      for (var i = 0; i < resizeCbs.length; i++) { try { resizeCbs[i](); } catch (err) {} }
    });
    wx.onShow(function () {
      for (var i = 0; i < visibilityCbs.length; i++) { try { visibilityCbs[i](false); } catch (err) {} }
    });
    wx.onHide(function () {
      for (var i = 0; i < visibilityCbs.length; i++) { try { visibilityCbs[i](true); } catch (err) {} }
    });
  }

  /* ---------- 公共接口 ---------- */
  /* wx 画布缺 three.js 需要的事件接口：WebGLRenderer 构造时注册 webglcontextlost。
   * 挂 no-op 垫片（画布是普通 JS 对象，可直接加属性） */
  function patchWxCanvas(c) {
    if (!c.style) c.style = {};                 // three setSize 写 style（有守卫，双保险）
    if (!c.addEventListener) {
      c.addEventListener = function () {};
      c.removeEventListener = function () {};
    }
    return c;
  }

  var api = {
    isWx: isWx,
    isWeb: isWeb,
    /** 小游戏端必须最先调用（注册触摸总线/窗口事件）；网页端空操作 */
    init: function () { if (isWx && !winInfo) initWx(); },

    /** 屏幕画布：three.js 主渲染目标。网页端返回未插入 DOM 的 canvas（由 attach 挂载）；
     * 小游戏端首个 wx.createCanvas 即屏幕画布（只能有一块，之后 createCanvas 全是离屏）。 */
    createScreenCanvas: function () {
      if (isWx) {
        if (!wxScreenCanvas) {
          wxScreenCanvas = patchWxCanvas(wx.createCanvas());
          canvasCreated = true;
        }
        return wxScreenCanvas;
      }
      return document.createElement('canvas');
    },
    /** 屏幕画布上屏：网页端插入容器；小游戏端画布天然在屏，空操作 */
    attachScreenCanvas: function (canvas, container) {
      if (isWeb && container && container.appendChild) container.appendChild(canvas);
    },
    /** 离屏画布（贴图/仪表/镜面渲染目标等）。注意：小游戏端必须先 createScreenCanvas */
    createCanvas: function () {
      if (isWx) {
        if (!canvasCreated) { canvasCreated = true; return api.createScreenCanvas(); }
        return patchWxCanvas(wx.createCanvas());
      }
      return document.createElement('canvas');
    },
    /** WebGL 上下文：小游戏端显式创建 WebGL1（微信运行时仅支持 'webgl'；部分真机内核
     *  对 'webgl2' 返回残缺上下文而非 null，three 若误入 WebGL2 路径即黑屏——真机与
     *  开发者工具的最大行为差异点，此处钉死）。带属性创建失败时降级为无属性再试——
     *  个别内核对 alpha/antialias 属性挑剔；两次都失败返回 undefined（three 自建兜底）。
     *  网页端恒返回 undefined，交由 three 自选（浏览器 WebGL2 完整可用，行为不变）。 */
    createGlContext: function (canvas, opts) {
      if (!isWx) return undefined;
      try {
        var gl = opts ? canvas.getContext('webgl', opts) : null;
        if (!gl) gl = canvas.getContext('webgl');
        return gl || undefined;
      } catch (e) { return undefined; }
    },

    width: function () {
      if (isWx) { if (!winInfo) { initWx(); } return winInfo ? Math.max(1, winInfo.windowWidth) : 0; }
      return Math.max(1, window.innerWidth);
    },
    height: function () {
      if (isWx) { if (!winInfo) { initWx(); } return winInfo ? Math.max(1, winInfo.windowHeight) : 0; }
      return Math.max(1, window.innerHeight);
    },
    pixelRatio: function () {
      if (isWx) { refreshWinInfo(); return winInfo.pixelRatio || 1; }
      return window.devicePixelRatio || 1;
    },
    /** 安全区 insets {top,right,bottom,left}（刘海屏适配）；网页端全 0 */
    safeInsets: function () {
      if (!isWx) return { top: 0, right: 0, bottom: 0, left: 0 };
      refreshWinInfo();
      var sa = winInfo.safeArea;
      if (!sa) return { top: 0, right: 0, bottom: 0, left: 0 };
      return {
        top: sa.top || 0,
        right: Math.max(0, (winInfo.windowWidth || 0) - (sa.width + sa.left)),
        bottom: Math.max(0, (winInfo.windowHeight || 0) - (sa.height + sa.top)),
        left: sa.left || 0
      };
    },
    /** 触屏/粗指针设备判定（决定虚拟驾驶控件与触屏画质档） */
    isCoarsePointer: function () {
      if (isWx) return true;   // 小游戏运行环境皆为触屏
      return (window.matchMedia && matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in window);
    },

    onResize: function (cb) {
      if (isWx) { resizeCbs.push(cb); return; }
      window.addEventListener('resize', cb);
    },
    /** hidden=true 进入后台，hidden=false 回前台（网页 visibilitychange） */
    onVisibilityChange: function (cb) {
      if (isWx) { visibilityCbs.push(cb); return; }
      document.addEventListener('visibilitychange', function () { cb(document.hidden); });
    },
    /** 任意指针/触点按下（音频解锁用：网页 mousedown+touchstart，小游戏触摸总线） */
    onGlobalPointer: function (cb) {
      if (isWx) { globalPointCbs.push(cb); return; }
      document.addEventListener('mousedown', cb);
      document.addEventListener('touchstart', cb, { passive: true });
    },

    hasKeyboard: !isWx,
    /** URL/启动参数：网页解析 location.search，小游戏取 getLaunchOptionsSync().query */
    getParam: function (name) {
      if (isWx) {
        if (!launchQuery) {
          try { launchQuery = (wx.getLaunchOptionsSync() || {}).query || {}; }
          catch (e) { launchQuery = {}; }
        }
        return launchQuery[name] != null ? String(launchQuery[name]) : null;
      }
      var m = new RegExp('[?&]' + name + '=([^&]*)').exec(location.search);
      return m ? decodeURIComponent(m[1]) : null;
    },
    /** 诊断标题（网页 document.title；小游戏无标题，挂在 wx 对象上供调试器查看） */
    setTitle: function (t) {
      if (isWeb) document.title = t;
      else if (typeof wx !== 'undefined') wx.__PS_TITLE = t;
    },
    /** body class（触屏模式/竖屏提示，网页专用；小游戏锁定横屏，空操作） */
    setBodyClass: function (op, name, on) {
      if (isWeb) {
        if (op === 'add') document.body.classList.add(name);
        else if (op === 'remove') document.body.classList.remove(name);
        else if (op === 'toggle') document.body.classList.toggle(name, on);
      }
    },

    /** localStorage 兼容存储（{getItem,setItem}）；小游戏映射同步 KV */
    storage: function () {
      if (isWeb) {
        try { if (typeof localStorage !== 'undefined') return localStorage; } catch (e) {}
        return null;
      }
      return {
        getItem: function (k) {
          try { var v = wx.getStorageSync(k); return (v === '' || v == null) ? null : String(v); }
          catch (e) { return null; }
        },
        setItem: function (k, v) { try { wx.setStorageSync(k, String(v)); } catch (e) {} }
      };
    },

    /** WebAudio 上下文实例（引擎声/雷达蜂鸣均标准节点，两端同构）；不可用时返回 null */
    createAudioContext: function () {
      if (isWx) {
        try { return wx.createWebAudioContext ? wx.createWebAudioContext() : null; }
        catch (e) { return null; }
      }
      var AC = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) || null;
      return AC ? new AC() : null;
    },

    /** 画布触摸事件（归一化为 {type,touches,changedTouches,preventDefault}）。
     * 网页端挂 canvas 事件；小游戏端无 canvas 事件，注册进全局触摸总线。 */
    onCanvasTouch: function (canvas, h) {
      if (isWx) { canvasTouchHandlers.push(h); return; }
      canvas.addEventListener('touchstart', h.start, { passive: false });
      canvas.addEventListener('touchmove', h.move, { passive: false });
      canvas.addEventListener('touchend', h.end, { passive: false });
      canvas.addEventListener('touchcancel', h.end, { passive: false });
    },
    /** 画布鼠标事件（俯视镜头拖拽，网页专用；小游戏返回 false 表示不可用） */
    onCanvasMouse: function (canvas, h) {
      if (!isWeb) return false;
      canvas.addEventListener('mousedown', h.down);
      window.addEventListener('mousemove', h.move);
      window.addEventListener('mouseup', h.up);
      return true;
    },

    /* ---------- UI 合成钩子（小游戏专用） ----------
     * 小游戏只有一块屏幕画布（WebGL），UI 画在离屏 2D 画布上后作为全屏透明贴图
     * 叠加进主场景。ui_wx.js 注册合成函数，game.js 每帧渲染完主场景后调用 presentOverlay。 */
    setOverlayRenderer: function (fn) { if (isWx) overlayRenderFn = fn; },
    presentOverlay: function (renderer) {
      if (!isWx || !overlayRenderFn) return;
      try {
        overlayRenderFn(renderer);
      } catch (e) {
        /* UI 合成错误不再静默：真机缺字/局部不画这类问题会无声流失——存档并一次性弹窗 */
        if (typeof wx !== 'undefined') {
          wx.__PS_OVERLAY_ERR = String((e && e.stack) || e);
          if (!wx.__PS_OVERLAY_SHOWN) {
            wx.__PS_OVERLAY_SHOWN = 1;
            try {
              wx.showModal({ title: 'UI 渲染错误', content: wx.__PS_OVERLAY_ERR.slice(0, 500), showCancel: false });
            } catch (e2) {}
          }
        }
      }
    },
    /** UI 层是否有待绘制内容（闪烁衰减/滚动/按压缩放等）。game.js 的整帧门控据此
     * 放行：静止菜单无交互时不重渲染（GPU 零负载），一有触摸即恢复合成。 */
    setOverlayNeedsFrame: function (fn) { if (isWx) overlayNeedsFrameFn = fn; },
    overlayNeedsFrame: function () { return !!(isWx && overlayNeedsFrameFn && overlayNeedsFrameFn()); }
  };

  return api;
});