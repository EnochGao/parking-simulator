/* js/platform.js · 抖音小游戏模块（tools/build_mini.js 生成，勿手改） */
var window = GameGlobal, self = GameGlobal;   /* UMD 根 → 跨模块共享全局 */
var module, exports, define;                  /* 声明以捕获外层泄露 */
module = exports = define = undefined;        /* 强制浏览器分支（var 对参数式包装无效） */
/* 平台抽象层（浏览器 / 微信小游戏 / 抖音小游戏 多端）
 * 目标：把所有"浏览器有、小游戏没有"的环境差异收口到一个对象里——
 *   DOM（document/body/classList）、window 尺寸、resize/前后台事件、键盘、
 *   画布创建（小游戏首个 createCanvas 是屏幕画布，之后才是离屏）、
 *   WebAudio（微信 createWebAudioContext / 抖音 getAudioContext）、
 *   localStorage（同步 KV）、触屏事件（小游戏无 canvas 事件，只有全局 onTouch*）。
 * 上层（game.js/ui_wx.js）只调 PS.Platform.*，不直接碰 document/wx/tt。
 * Node 端（无头回归）不加载本文件，业务模块各自保留兜底。
 * 多平台要点：微信 wx.* 与抖音 tt.* 大部分接口同名同义（createCanvas、
 *   onTouch 系列事件、onShow、getSystemInfoSync、同步 KV、showModal…），差异仅三处——
 *   音频工厂（wx.createWebAudioContext 按需新建 ↔ tt.getAudioContext 全局单例）、
 *   窗口尺寸事件（tt 无 onWindowResize，锁横屏下以 onDeviceOrientationChange 兜底）、
 *   窗口信息（tt 无 getWindowInfo，一律走 getSystemInfoSync）。
 * 新宿主（快手/支付宝等）只要满足这组同名接口，探测处加一行即可接入。 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.PS = root.PS || {}; root.PS.Platform = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  /* 宿主探测：优先微信 wx，其次抖音 tt；都没有则是浏览器。
   * getSystemInfoSync 是两家的公共身份 API（早期版本必有），比整对象 typeof 探测更稳 */
  var host = null, hostName = '';
  if (typeof wx !== 'undefined' && !!wx.getSystemInfoSync) { host = wx; hostName = 'wx'; }
  else if (typeof tt !== 'undefined' && !!tt.getSystemInfoSync) { host = tt; hostName = 'tt'; }
  var isWx = hostName === 'wx';
  var isTt = hostName === 'tt';
  var isMiniGame = !!host;                      // 任意小游戏宿主（业务分支用这个，别绑具体平台）
  var isWeb = !isMiniGame && typeof document !== 'undefined';

  /* ---------- 小游戏端状态 ---------- */
  var hostScreenCanvas = null;    // 屏幕画布（首个 createCanvas），three.js 主渲染目标
  var canvasCreated = false;      // 是否已创建过画布（首块=屏幕，之后=离屏）
  var resizeCbs = [];
  var visibilityCbs = [];
  var globalPointCbs = [];        // 任意触下（解锁音频用）
  var canvasTouchHandlers = [];   // onCanvasTouch 注册的处理器（统一触摸总线分发）
  var overlayRenderFn = null;     // ui_wx 注册的 UI 合成钩子（全屏贴图叠加进主画布）
  var launchQuery = null;         // 启动参数缓存（getLaunchOptionsSync 只在启动有意义）
  var winInfo = null;             // 窗口信息缓存（resize 时刷新）

  /* 广告位 ID：源码恒为空（网页/冒烟走模拟模式，不请求真广告）；
   * tools/build_mini.js 构建时用 tools/adunits.json 中对应平台的值整行替换。 */
  var AD_UNITS = {"tt":{"rewarded":"","interstitial":""}};

  function refreshWinInfo() {
    if (!isMiniGame) return;
    /* tt 无 getWindowInfo；wx 有（省字段）。两家 getSystemInfoSync 均返回同形窗口信息 */
    try { winInfo = host.getWindowInfo ? host.getWindowInfo() : host.getSystemInfoSync(); }
    catch (e) { winInfo = winInfo || { windowWidth: 375, windowHeight: 667, pixelRatio: 2 }; }
  }

  /* 触摸总线：onTouch* 一次注册，分发给 canvas 触摸订阅者与全局触下回调。
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

  function onHostResize() {
    refreshWinInfo();
    for (var i = 0; i < resizeCbs.length; i++) { try { resizeCbs[i](); } catch (err) {} }
  }

  function initMiniGame() {
    refreshWinInfo();
    host.onTouchStart(function (e) { dispatchTouch('start', e); });
    host.onTouchMove(function (e) { dispatchTouch('move', e); });
    host.onTouchEnd(function (e) { dispatchTouch('end', e); });
    host.onTouchCancel(function (e) { dispatchTouch('end', e); });
    /* 窗口尺寸事件：wx 有 onWindowResize；tt 没有（锁横屏全屏下尺寸本就恒定），
     * 以 onDeviceOrientationChange 近似兜底——万一系统旋转/分屏，至少刷新窗口信息并重排 */
    if (host.onWindowResize) host.onWindowResize(onHostResize);
    else if (host.onDeviceOrientationChange) host.onDeviceOrientationChange(onHostResize);
    host.onShow(function () {
      for (var i = 0; i < visibilityCbs.length; i++) { try { visibilityCbs[i](false); } catch (err) {} }
    });
    host.onHide(function () {
      for (var i = 0; i < visibilityCbs.length; i++) { try { visibilityCbs[i](true); } catch (err) {} }
    });
  }

  /* ---------- 公共接口 ---------- */
  /* 小游戏画布缺 three.js 需要的事件接口：WebGLRenderer 构造时注册 webglcontextlost。
   * 挂 no-op 垫片（画布是普通 JS 对象，可直接加属性） */
  function patchHostCanvas(c) {
    if (!c.style) c.style = {};                 // three setSize 写 style（有守卫，双保险）
    if (!c.addEventListener) {
      c.addEventListener = function () {};
      c.removeEventListener = function () {};
    }
    return c;
  }

  /* ---------- 广告抽象（微信/抖音流量主；设计见 docs/MONETIZATION.md §4.2） ----------
   * wx.createRewardedVideoAd / tt.createRewardedVideoAd 同名同义：广告对象单例复用、
   * onLoad 后预加载下一支；onClose 按 res.isEnded 判定完整观看才发奖（个别宿主无该
   * 字段时宁可发奖——漏发投诉成本高于误发）；onError 拉新并静默降级，绝不自动重弹。
   * 频控（激励视频每日发奖上限、插屏 ≥5 分钟间隔）持久化在宿主同步 KV，防重启绕过。
   * 模拟模式（网页端 / adUnitId 未配置 / 宿主无广告 API）：异步直接发奖——本地与
   * 冒烟测试可玩；插屏在模拟模式下静默无操作（开发环境不打扰）。 */
  var adsImpl = (function () {
    var RV_DAILY_CAP = 30;               // 单日激励视频发奖上限（防刷；行业 IPU 目标 5-8，30 已宽裕）
    var INTER_GAP_MS = 5 * 60 * 1000;    // 插屏最小间隔（§4.2：插屏 5-10 分钟一次）
    var FREQ_KEY = 'ps_ad_freq_v1';
    var rewardedAd = null;               // 激励视频单例（onClose/onError 只注册一次，防回调堆叠）
    var rvPending = null;                // 展示中的那次回调（onClose 一次性取走）
    var interAd = null;
    var showing = false;                 // 重入保护：展示中再触发直接忽略
    var freq = null;                     // { d:'YYYY-MM-DD', rv, inter, interLast }

    function unitId(kind) {
      var u = AD_UNITS[hostName] || {};
      return u[kind] ? String(u[kind]) : '';
    }
    function loadFreq() {
      if (freq) return freq;
      var raw = null, st = null;
      try { st = api.storage(); if (st) raw = st.getItem(FREQ_KEY); } catch (e) {}
      var today = new Date().toISOString().slice(0, 10);
      try { freq = raw ? JSON.parse(raw) : null; } catch (e) { freq = null; }
      if (!freq || freq.d !== today) freq = { d: today, rv: 0, inter: 0, interLast: 0 };   // 跨日重置
      if (typeof freq.rv !== 'number') freq.rv = 0;
      if (typeof freq.inter !== 'number') freq.inter = 0;
      if (typeof freq.interLast !== 'number') freq.interLast = 0;
      return freq;
    }
    function saveFreq() {
      try { var st = api.storage(); if (st) st.setItem(FREQ_KEY, JSON.stringify(freq)); } catch (e) {}
    }
    function isMock() {
      return !isMiniGame || !host.createRewardedVideoAd || !unitId('rewarded');
    }

    function showRewarded(opts) {
      opts = opts || {};
      if (showing) return;                                          // 展示中重入：忽略
      var fq = loadFreq();
      if (fq.rv >= RV_DAILY_CAP) { if (opts.onFail) opts.onFail('dailyCap'); return; }
      if (isMock()) {
        showing = true;
        var fire = function () {
          showing = false;
          fq.rv++; saveFreq();
          if (opts.onReward) opts.onReward();
          if (opts.onDone) opts.onDone(true);
        };
        if (adsApi.mockDelay <= 0) fire();                          // 测试同步化（冒烟断言用）
        else setTimeout(fire, adsApi.mockDelay);
        return;
      }
      if (!rewardedAd) {
        try {
          rewardedAd = host.createRewardedVideoAd({ adUnitId: unitId('rewarded') });
          rewardedAd.onError(function () { try { rewardedAd.load(); } catch (e) {} });   // 拉新，UI 侧下次再试
          rewardedAd.onClose(function (res) {
            var cb = rvPending; rvPending = null; showing = false;
            try { rewardedAd.load(); } catch (e) {}                 // 预加载下一支
            if (!cb) return;
            var ended = res && typeof res.isEnded === 'boolean' ? res.isEnded : true;
            if (ended) { loadFreq().rv++; saveFreq(); if (cb.onReward) cb.onReward(); if (cb.onDone) cb.onDone(true); }
            else { if (cb.onFail) cb.onFail('skipped'); if (cb.onDone) cb.onDone(false); }
          });
        } catch (e) { if (opts.onFail) opts.onFail('create'); return; }
      }
      rvPending = { onReward: opts.onReward, onFail: opts.onFail, onDone: opts.onDone };
      showing = true;
      var fail = function () {
        rvPending = null; showing = false;
        if (opts.onFail) opts.onFail('show');
        if (opts.onDone) opts.onDone(false);
      };
      try {
        rewardedAd.show().catch(function () {
          /* 未加载成：load 拉满后再试一次，仍失败静默降级（下次再展示） */
          try {
            rewardedAd.load().then(function () { return rewardedAd.show(); }).catch(fail);
          } catch (e2) { fail(); }
        });
      } catch (e) { fail(); }
    }

    function showInterstitial() {
      if (showing) return;
      if (!isMiniGame || !host.createInterstitialAd || !unitId('interstitial')) return;   // 模拟模式静默
      var fq = loadFreq(), now = Date.now();
      if (fq.interLast && now - fq.interLast < INTER_GAP_MS) return;
      if (!interAd) {
        try {
          interAd = host.createInterstitialAd({ adUnitId: unitId('interstitial') });
          interAd.onError(function () {});
        } catch (e) { interAd = null; return; }
      }
      /* 无论 show 成败都记间隔（失败重试交给下一次调用，不连续打扰） */
      fq.interLast = now; fq.inter++; saveFreq();
      try { interAd.show().catch(function () {}); } catch (e) {}
    }

    var adsApi = {
      /** 激励视频：opts {onReward, onFail(reason), onDone(ok)}；必须由用户主动点击触发 */
      showRewarded: showRewarded,
      /** 插屏（仅关卡间隙调用；间隔与计数内置，失败静默） */
      showInterstitial: showInterstitial,
      /** 激励视频是否模拟模式（未配广告位/宿主不支持——UI 可据此标注或本地全功能预览） */
      isMock: isMock,
      /** 频控状态（调试/测试）：{rv, inter, interLast, rvCap} */
      stats: function () {
        var fq = loadFreq();
        return { rv: fq.rv, inter: fq.inter, interLast: fq.interLast, rvCap: RV_DAILY_CAP };
      },
      /** 模拟模式回调时延 ms（真机观感近似；测试置 0 同步化） */
      mockDelay: 400
    };
    return adsApi;
  })();

  var api = {
    isWx: isWx,
    isTt: isTt,
    /** 任意小游戏宿主（wx/tt/未来平台）——业务分支请用本标志而非 isWx */
    isMiniGame: isMiniGame,
    isWeb: isWeb,
    /** 小游戏端必须最先调用（注册触摸总线/窗口事件）；网页端空操作 */
    init: function () { if (isMiniGame && !winInfo) initMiniGame(); },

    /** 屏幕画布：three.js 主渲染目标。网页端返回未插入 DOM 的 canvas（由 attach 挂载）；
     * 小游戏端首个 createCanvas 即屏幕画布（只能有一块，之后 createCanvas 全是离屏）。 */
    createScreenCanvas: function () {
      if (isMiniGame) {
        if (!hostScreenCanvas) {
          hostScreenCanvas = patchHostCanvas(host.createCanvas());
          canvasCreated = true;
        }
        return hostScreenCanvas;
      }
      return document.createElement('canvas');
    },
    /** 屏幕画布上屏：网页端插入容器；小游戏端画布天然在屏，空操作 */
    attachScreenCanvas: function (canvas, container) {
      if (isWeb && container && container.appendChild) container.appendChild(canvas);
    },
    /** 离屏画布（贴图/仪表/镜面渲染目标等）。注意：小游戏端必须先 createScreenCanvas */
    createCanvas: function () {
      if (isMiniGame) {
        if (!canvasCreated) { canvasCreated = true; return api.createScreenCanvas(); }
        return patchHostCanvas(host.createCanvas());
      }
      return document.createElement('canvas');
    },
    /** WebGL 上下文：小游戏端显式创建 WebGL1（微信/抖音运行时均只保证 'webgl'；部分真机内核
     *  对 'webgl2' 返回残缺上下文而非 null，three 若误入 WebGL2 路径即黑屏——真机与
     *  开发者工具的最大行为差异点，此处钉死）。带属性创建失败时降级为无属性再试——
     *  个别内核对 alpha/antialias 属性挑剔；两次都失败返回 undefined（three 自建兜底）。
     *  网页端恒返回 undefined，交由 three 自选（浏览器 WebGL2 完整可用，行为不变）。 */
    createGlContext: function (canvas, opts) {
      if (!isMiniGame) return undefined;
      try {
        var gl = opts ? canvas.getContext('webgl', opts) : null;
        if (!gl) gl = canvas.getContext('webgl');
        return gl || undefined;
      } catch (e) { return undefined; }
    },

    width: function () {
      if (isMiniGame) { if (!winInfo) { initMiniGame(); } return winInfo ? Math.max(1, winInfo.windowWidth) : 0; }
      return Math.max(1, window.innerWidth);
    },
    height: function () {
      if (isMiniGame) { if (!winInfo) { initMiniGame(); } return winInfo ? Math.max(1, winInfo.windowHeight) : 0; }
      return Math.max(1, window.innerHeight);
    },
    pixelRatio: function () {
      if (isMiniGame) { refreshWinInfo(); return winInfo.pixelRatio || 1; }
      return window.devicePixelRatio || 1;
    },
    /** 安全区 insets {top,right,bottom,left}（刘海屏适配）；网页端全 0 */
    safeInsets: function () {
      if (!isMiniGame) return { top: 0, right: 0, bottom: 0, left: 0 };
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
      if (isMiniGame) return true;   // 小游戏运行环境皆为触屏
      return (window.matchMedia && matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in window);
    },

    onResize: function (cb) {
      if (isMiniGame) { resizeCbs.push(cb); return; }
      window.addEventListener('resize', cb);
    },
    /** hidden=true 进入后台，hidden=false 回前台（网页 visibilitychange） */
    onVisibilityChange: function (cb) {
      if (isMiniGame) { visibilityCbs.push(cb); return; }
      document.addEventListener('visibilitychange', function () { cb(document.hidden); });
    },
    /** 任意指针/触点按下（音频解锁用：网页 mousedown+touchstart，小游戏触摸总线） */
    onGlobalPointer: function (cb) {
      if (isMiniGame) { globalPointCbs.push(cb); return; }
      document.addEventListener('mousedown', cb);
      document.addEventListener('touchstart', cb, { passive: true });
    },

    hasKeyboard: !isMiniGame,
    /** URL/启动参数：网页解析 location.search，小游戏取 getLaunchOptionsSync().query */
    getParam: function (name) {
      if (isMiniGame) {
        if (!launchQuery) {
          try { launchQuery = (host.getLaunchOptionsSync() || {}).query || {}; }
          catch (e) { launchQuery = {}; }
        }
        return launchQuery[name] != null ? String(launchQuery[name]) : null;
      }
      var m = new RegExp('[?&]' + name + '=([^&]*)').exec(location.search);
      return m ? decodeURIComponent(m[1]) : null;
    },
    /** 诊断标题（网页 document.title；小游戏无标题，挂在宿主对象上供调试器查看） */
    setTitle: function (t) {
      if (isWeb) document.title = t;
      else if (host) host.__PS_TITLE = t;
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
          try { var v = host.getStorageSync(k); return (v === '' || v == null) ? null : String(v); }
          catch (e) { return null; }
        },
        setItem: function (k, v) { try { host.setStorageSync(k, String(v)); } catch (e) {} }
      };
    },

    /** 广告（流量主激励视频/插屏；模拟模式与接入说明见上方 adsImpl 注释、docs/MONETIZATION.md §4.2） */
    ads: adsImpl,

    /** WebAudio 上下文实例（引擎声/雷达蜂鸣均标准节点，各端同构）；不可用时返回 null。
     * 微信 wx.createWebAudioContext 按需新建；抖音 tt.getAudioContext 返回全局单例
     * （节点 API 同为标准 oscillator/gain/setTargetAtTime，游戏只用到这几类）。 */
    createAudioContext: function () {
      if (isMiniGame) {
        try {
          if (host.createWebAudioContext) return host.createWebAudioContext();
          if (host.getAudioContext) return host.getAudioContext();
          return null;
        } catch (e) { return null; }
      }
      var AC = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) || null;
      return AC ? new AC() : null;
    },

    /** 画布触摸事件（归一化为 {type,touches,changedTouches,preventDefault}）。
     * 网页端挂 canvas 事件；小游戏端无 canvas 事件，注册进全局触摸总线。 */
    onCanvasTouch: function (canvas, h) {
      if (isMiniGame) { canvasTouchHandlers.push(h); return; }
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
    setOverlayRenderer: function (fn) { if (isMiniGame) overlayRenderFn = fn; },
    presentOverlay: function (renderer) {
      if (!isMiniGame || !overlayRenderFn) return;
      try {
        overlayRenderFn(renderer);
      } catch (e) {
        /* UI 合成错误不再静默：真机缺字/局部不画这类问题会无声流失——存档并一次性弹窗 */
        if (host) {
          host.__PS_OVERLAY_ERR = String((e && e.stack) || e);
          if (!host.__PS_OVERLAY_SHOWN) {
            host.__PS_OVERLAY_SHOWN = 1;
            try {
              host.showModal({ title: 'UI 渲染错误', content: host.__PS_OVERLAY_ERR.slice(0, 500), showCancel: false });
            } catch (e2) {}
          }
        }
      }
    }
  };

  return api;
});