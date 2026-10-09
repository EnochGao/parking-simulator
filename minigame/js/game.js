/* js/game.js · 微信小游戏模块（tools/build_wx.js 生成，勿手改） */
var window = GameGlobal, self = GameGlobal;   /* UMD 根 → 跨模块共享全局 */
var module, exports, define;                  /* 声明以捕获外层泄露 */
module = exports = define = undefined;        /* 强制浏览器分支（var 对参数式包装无效） */
/* 游戏主壳：渲染器/场景/主循环、状态机流转、输入接驳、辅助开关、selftest
 * 职责划分（各模块单一职责，壳只做编排）：
 *   js/sim.js      一局规则（步进/碰撞计次/评分/完成/失败）——与无头回归同一实现
 *   js/input.js    驾驶输入源（键盘+手柄合并，可替换为录像/网络输入）
 *   js/carRig.js   整车装配与单车表现（模型/座舱/镜组的建/用/释）
 *   js/progress.js 进度与存档（解锁链/续玩/落档）
 *   js/hud.js      纯视图（菜单/HUD/结算，不做持久化）
 * 本文件只保留"壳"的事：Three.js 引导、相机/灯光、帧循环与门控、界面流转。 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.PS = root.PS || {}; root.PS.Game = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  var D2R = Math.PI / 180;
  var CAM_PITCH = 5 * D2R;   // 主相机俯角：飞度高座椅、低仪表台，视线越过台面看到仪表与引擎盖

  function Game(container) {
    var PS = window.PS;
    this.PS = PS;
    this.cfg = PS.CONFIG;
    this.container = container;
    this.DT = this.cfg.PHYS.fixedDt;   // 固定物理步长唯一来源（与演示重放/录像帧序同源）

    /* 渲染器（宽高做下限守卫：页面在后台/被遮挡标签页加载时 innerWidth 可能为 0，
     * 否则画布会被初始化成 0×0，玩家只看到黑屏且无法自愈）。
     * 画布来源 platform：网页端普通 canvas 插入容器；小游戏端首个 wx.createCanvas 即屏幕画布。
     * GL 上下文：小游戏端由 platform 显式建 WebGL1（真机 webgl2 探测不可靠）；网页端
     * 传 undefined 由 three 自选（注意 three 以 context===undefined 判定自建，null 会崩） */
    var PLAT = PS.Platform;
    var scrCanvas = PLAT.createScreenCanvas();
    var glCtx = PLAT.createGlContext(scrCanvas, { antialias: true, alpha: false });
    this.renderer = new THREE.WebGLRenderer({ canvas: scrCanvas, context: glCtx || undefined, antialias: true });
    this.renderer.setPixelRatio(Math.min(PLAT.pixelRatio(), 1.5));
    this.renderer.setSize(Math.max(1, PLAT.width()), Math.max(1, PLAT.height()));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;  // 阴影按需更新（见 updateVisuals）：泊车大部分时间车辆静止，
                                                 // 跳过每帧 2048² 阴影重绘；车辆位移/转向时置 needsUpdate
    PLAT.attachScreenCanvas(scrCanvas, container);

    /* 场景 */
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9db8c9);
    this.scene.fog = new THREE.Fog(0x9db8c9, 60, 160);

    /* 相机（作为玩家车子对象，随车移动） */
    this.camera = new THREE.PerspectiveCamera(this.cfg.VIEW.fov, Math.max(1, PLAT.width()) / Math.max(1, PLAT.height()), 0.12, 220);
    this.topCamera = new THREE.OrthographicCamera(-14, 14, 9, -9, 0.5, 120);
    this.usingTop = false;
    this.lookYaw = 0; this.lookPitch = 0; this.lookHeld = 0;

    /* 灯光 */
    this.hemi = new THREE.HemisphereLight(0xcfe5ff, 0x8a8f7a, 1.05);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff3e0, 1.0);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    var sc = this.sun.shadow.camera;
    sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.far = 120;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    /* 状态 */
    this.state = 'menu';
    this.level = null;
    this.worldH = null;     // 世界句柄（world.js）
    this.rig = null;        // 整车视觉装配（carRig.js）
    this.carP = null;       // CarPhysics（sim 借用同一实例）
    this.run = null;        // 一局（sim.js）
    this.keys = {};
    this.touchAnalog = { steer: 0 };   // 触屏方向盘模拟量（虚拟方向盘控件维护，0=居中=保持转角）
    this.input = { steer: 0, drive: 0, handbrake: false };
    this.assist = { guide: true, top: false, revCam: true };
    this.mirrorMode = false;  // 后视镜调节模式（V 进入/退出，驾驶输入封锁）
    this.mirrorSel = 0;       // 选中的镜子：0 左外 1 右外 2 车内
    this.mirrorAdj = [{ y: 0, p: 0 }, { y: 0, p: 0 }, { y: 0, p: 0 }]; // 调节量（跨关卡保留）
    this.indicator = { side: 0, timer: 0, peak: null }; // 0 无 1 左 2 右（gamepad 读写 side）
    this.audioOn = true;     // 音效开关状态（HUD 🔊 按钮）
    this.radar = null;
    this.beepTimer = 0;
    this.audio = PS.Assist.createAudio();
    this.hud = PS.Ui.createHud(this, container);
    this.revGuide = PS.Assist.createRevGuideLine(this.scene); // 倒车影像动态引导线（layer1，仅倒影相机可见）
    this.guide = null;
    this.acc = 0; // 固定步长累加器
    this.autopilotActive = false;
    this.replay = null;      // 演示驾驶重放器（autopilot.createReplay）
    this._lastEv = null;     // 最近一步评分（HUD 每渲染帧消费，见 updateHud）
    this._assistKey = -1; this._assistText = '';
    this._hintKey = ''; this._hintText = '';   // 提示串按 key 缓存（同 _assistText 范式）
    this._tips = [];                       // 本关教学要点（loadLevel 填充）
    this._hudState = { time: 0, collisions: 0, gear: 'D', speed: 0, radar: null, radarRange: 2.5, hint: '', assistText: '' };
    this._topOn = false;     // 俯视开关沿：开启瞬间刷新一次俯视投影矩阵
    this._topYaw = 0;        // 俯视镜头当前偏航（死区+阻尼跟随车头，见 updateVisuals）
    this._topChase = false;  // 俯视回正进行中：偏出死区置位，回到对齐角锁正并复位
    this._topManual = false; // 手动旋转过镜头：暂停自动跟随，R 回正恢复
    this._topRot = 0;        // 键盘 ,/. 持续旋转方向（-1/0/1，keyup 清零）
    /* 镜面/倒影 RT 脏检查（见 render）：静止泊车时不重绘 3 面镜 + 倒影共 4 遍场景 */
    this._mirrorsDirty = false;
    this._lastRevOn = null; this._lastRevSteer = 0;
    this._viewAspect = Math.max(1, PLAT.width()) / Math.max(1, PLAT.height());
    this._guidePaths = null;  // 引导线轨迹缓存（按关卡 id，确定性输出）
    /* 整帧门控（见 render）：菜单/简报/暂停/结算等叠加态场景静止，跳过整帧渲染 */
    this._frameDirty = true;  // 初始至少画一帧，主菜单背后才是天空色而非黑屏

    this.bindInput();
    /* 触屏设备（手机/平板）：虚拟驾驶控件 + 画质触屏档（见 buildTouchControls/applyTouchQuality）。
     * 必须在首次 loadLevel（首次建 rig/渲染）之前完成。
     * UI 实现按平台调度：网页 DOM / 小游戏 canvas（ui.js） */
    this.isTouch = PLAT.isCoarsePointer();
    if (this.isTouch) {
      PLAT.setBodyClass('add', 'touch-mode');
      this.applyTouchQuality();
      PS.Ui.buildTouchControls(this);
    }
    // 手柄（盖世小鸡等标准布局）：逐帧轮询 Gamepad API，驾驶输入与菜单导航
    this.gpad = PS.Gamepad.createGamepad(this, container);
    this.driver = PS.Input.createDriver(this.keys, this.gpad, this.touchAnalog);
    /* 复盘录像：driver 外包一层逐帧记录（固定步长，帧序即时间）。结算时冻结录像带，
     * "复盘回放"重进关卡由 tapePlayer 按帧序重演——sim 确定性保证轨迹/碰撞/得分一致 */
    this.recorder = PS.Input.createRecorder(this.driver);
    this.tapePlayer = null;       // 复盘回放态非空（createTapeSource）
    this.replaying = false;       // 回放中：跳过落档、驾驶控件不响应
    this._replayTape = null;      // 最近一局的冻结录像带（结算界面回放按钮的依据）
    var self = this;
    this.onResize = function () {
      var w = Math.max(1, PLAT.width()), h = Math.max(1, PLAT.height());
      self._viewAspect = w / h;
      PLAT.setBodyClass('toggle', 'portrait', h > w);  // 竖屏提示用（仅触屏模式下可见）
      self.renderer.setSize(w, h);
      self.camera.aspect = w / h;
      self.camera.updateProjectionMatrix();
      self.syncTopProjection();  // 俯视水平视域随宽高比扩展，resize 时同步
      self._frameDirty = true;   // 画布已换新缓冲，叠加层背后的最后一帧必须补画
    };
    PLAT.setBodyClass('toggle', 'portrait', PLAT.height() > PLAT.width());
    PLAT.onResize(this.onResize);
    // 从后台/被遮挡状态回到前台时重设画布（加载时尺寸为 0 的自愈）
    PLAT.onVisibilityChange(function (hidden) {
      if (!hidden) self.onResize();
    });
    // 任意触点/点击解锁音频（此前只有按键会解锁，点击开始后前几秒无声）；
    // iOS Safari 的 AudioContext 必须真实手势恢复，且 touch 不总派发 mouse 事件
    PLAT.onGlobalPointer(function () { self.audio.unlock(); });
    // HUD 音效开关
    this.hud.onAudioToggle = function () {
      self.audioOn = !self.audioOn;
      self.audio.setEnabled(self.audioOn);
      if (!self.audioOn) self.audio.engineOff();
      self.hud.setAudioOn(self.audioOn);
    };
    this.renderer.setAnimationLoop(function () { self.frame(); });
  }

  Game.prototype.bindInput = function () {
    var self = this;
    var PLAT = this.PS.Platform;
    var KEYMAP = { KeyW: 'w', ArrowUp: 'w', KeyS: 's', ArrowDown: 's', KeyA: 'a', ArrowLeft: 'a', KeyD: 'd', ArrowRight: 'd' };
    /* 键盘为网页端专属（小游戏无键盘；触摸驾驶输入走虚拟控件直写 keys） */
    if (PLAT.hasKeyboard) document.addEventListener('keydown', function (e) {
      self.audio.unlock();
      if (KEYMAP[e.code]) { self.keys[KEYMAP[e.code]] = true; e.preventDefault(); }
      if (self.state === 'briefing' && (e.code === 'Enter' || e.code === 'Space')) { self.startPlay(); return; }
      if (self.state !== 'playing') {
        if (self.state === 'result') {
          if (e.code === 'KeyR') self.restart();
          if (e.code === 'KeyN' && self.hasNext()) self.nextLevel();
        }
        if (e.code === 'Escape' && self.state === 'paused') self.resume();
        return;
      }
      switch (e.code) {
        case 'KeyH': self.toggleGuide(); break;
        case 'KeyM': self.toggleTop(); break;
        case 'KeyC': self.toggleRevCam(); break;
        case 'KeyQ': self.indicator.side = self.indicator.side === 1 ? 0 : 1; break;
        case 'KeyE': self.indicator.side = self.indicator.side === 2 ? 0 : 2; break;
        case 'Comma': self._topRot = -1; break;   // 俯视镜头左旋=画面逆时针（方向盘隐喻，与拖拽往左拉同向）
        case 'Period': self._topRot = 1; break;   // 俯视镜头右旋=画面顺时针
        case 'KeyR': if (self.assist.top) self.resetTopCamera(); break;
        case 'KeyZ': self.lookHeld = 1; break;  // 按住转头看左后视镜
        case 'KeyX': self.lookHeld = 2; break;  // 按住转头看右后视镜
        case 'Space': self.keys.space = true; e.preventDefault(); break;
        case 'KeyV': self.mirrorMode = !self.mirrorMode; break; // 后视镜调节模式
        case 'Digit1': case 'Numpad1': if (self.mirrorMode) self.mirrorSel = 0; break;
        case 'Digit2': case 'Numpad2': if (self.mirrorMode) self.mirrorSel = 1; break;
        case 'Digit3': case 'Numpad3': if (self.mirrorMode) self.mirrorSel = 2; break;
        case 'Escape':
          if (self.mirrorMode) { self.mirrorMode = false; break; } // 调节模式下先退模式再暂停
          self.pause(); break;
      }
    });
    if (PLAT.hasKeyboard) document.addEventListener('keyup', function (e) {
      if (KEYMAP[e.code]) self.keys[KEYMAP[e.code]] = false;
      if (e.code === 'Space') self.keys.space = false;
      if (e.code === 'KeyZ' && self.lookHeld === 1) self.lookHeld = 0;
      if (e.code === 'KeyX' && self.lookHeld === 2) self.lookHeld = 0;
      if (e.code === 'Comma' && self._topRot === -1) self._topRot = 0;
      if (e.code === 'Period' && self._topRot === 1) self._topRot = 0;
    });

    /* 俯视镜头手势：鼠标拖拽 / 触屏双指拧。抓地图手感——手往哪边拉/拧，画面跟着转
     * （实测标定：yaw 增 = 画面顺时针；拖右/顺拧应让世界顺时针，故取正增量）。
     * 触摸事件走 platform 归一化总线（网页 canvas 事件 / 小游戏全局触摸分发同构） */
    var canvas = this.renderer.domElement;
    var drag = null, twist = null;
    PLAT.onCanvasMouse(canvas, {
      down: function (e) {
        if (e.button !== 0 || !self.assist.top || self.state !== 'playing') return;
        drag = { x: e.clientX };
      },
      move: function (e) {
        if (!drag) return;
        var dx = e.clientX - drag.x;
        drag.x = e.clientX;
        self.rotateTopCamera(dx * self.cfg.VIEW_TOP.dragRate * Math.PI / 180);
      },
      up: function () { drag = null; }
    });
    function twistAngle(t) {
      return Math.atan2(t[1].clientY - t[0].clientY, t[1].clientX - t[0].clientX);
    }
    PLAT.onCanvasTouch(canvas, {
      start: function (e) {
        if (e.touches.length === 2 && self.assist.top && self.state === 'playing') {
          twist = { a: twistAngle(e.touches), ids: [e.touches[0].identifier, e.touches[1].identifier] };
          e.preventDefault();   // 拧动期间屏蔽浏览器双指缩放
        } else twist = null;
      },
      move: function (e) {
        if (!twist || e.touches.length !== 2 ||
            e.touches[0].identifier !== twist.ids[0] || e.touches[1].identifier !== twist.ids[1]) return;
        var a = twistAngle(e.touches), da = a - twist.a;
        if (da > Math.PI) da -= 2 * Math.PI;    // 跨 ±π 跳变保护
        if (da < -Math.PI) da += 2 * Math.PI;
        twist.a = a;
        self.rotateTopCamera(da);
        e.preventDefault();
      },
      end: function () { twist = null; }
    });
  };

  /* ---------- 关卡装载 ---------- */
  Game.prototype.loadLevel = function (id, mode) {
    var PS = this.PS;
    var lv = PS.Levels.byId(id);
    if (!lv) return;
    if (this.worldH) { this.worldH.dispose(); this.worldH = null; }
    if (this.guide) { this.guide.dispose(); this.guide = null; }
    if (this.rig) { this.rig.dispose(); this.rig = null; }
    this.level = lv;
    this.mode = mode || 'play';
    /* 演示态不跨关泄漏：?autotest 播完进结算后点"下一关/再来一次"，残留的
     * 已播完重放器会让车辆永续静止挂死——每次换关/重开一律回到人工驾驶 */
    this.autopilotActive = false;
    this.replay = null;
    this.replaying = false;       // 复盘回放态同样不跨关泄漏
    this.tapePlayer = null;
    this.recorder.reset();        // 新一局从空录像带开始（旧带已由 _finish 冻结到 _replayTape）
    this.setTouchControlsVisible(false);   // 简报态隐藏，开始后显示

    var tex = this.textures || (this.textures = PS.Textures.createTextures());
    this.worldH = PS.World.createWorld(this.scene, lv, tex);
    // 地库关压暗天空/雾色：舱内透过车窗不再看到蓝天砖楼，符合地下环境。
    // 复用既有 Color/Fog 实例原地改值（高频换关路径不再每次新建，语义不变）
    if (lv.garage) {
      this.scene.background.setHex(0x23262b);
      this.scene.fog.color.setHex(0x23262b);
      this.scene.fog.near = 24; this.scene.fog.far = 80;
    } else {
      this.scene.background.setHex(0x9db8c9);
      this.scene.fog.color.setHex(0x9db8c9);
      this.scene.fog.near = 60; this.scene.fog.far = 160;
    }

    /* 整车装配（模型/座舱/三镜/倒影屏/相机眼位/调节量恢复） */
    this.rig = PS.CarRig.build({
      scene: this.scene, renderer: this.renderer, cfg: this.cfg,
      pose: lv.player, camera: this.camera, mirrorAdj: this.mirrorAdj
    });
    var self = this;
    this.rig.onDirty = function () { self._mirrorsDirty = true; };

    /* 物理与一局（规则与无头回归同一实现） */
    this.carP = new PS.Physics.CarPhysics({ car: this.cfg.CAR, phys: this.cfg.PHYS }, {
      x: lv.player.x, z: lv.player.z, heading: lv.player.a * D2R
    });
    this.carP.gear = 'D';
    this.run = PS.Sim.createRun(lv, { car: this.carP });

    /* 引导线：标准答案轨迹。重放是确定性的 → 按关卡缓存，重开/再进不再无头重放整关 */
    this._guidePaths = this._guidePaths || {};
    var path = this._guidePaths[lv.id];
    if (!path) {
      var res = PS.Autopilot.runLevel(lv, { record: true });
      path = this._guidePaths[lv.id] = res.path;
    }
    this.guide = PS.Assist.createGuideLine(this.scene, path);
    this.guide.setVisible(this.assist.guide);

    this.indicator.side = 0; this.indicator.peak = null;
    this._lastShadowPose = null;             // 新关卡车辆瞬移，强制刷新阴影（首帧后原地更新）
    this._mirrorsDirty = true;               // 新关卡强制渲染一帧镜面/倒影 RT
    this._frameDirty = true;                 // 新世界至少画一帧，简报叠加层背后才有画面
    this._lastRevOn = null; this._lastRevSteer = 0;
    this.usingTop = false; this.assist.top = false;
    this._topYaw = 0; this._topChase = false; this._topManual = false; this._topRot = 0;  // 换关重置俯视镜头状态
    this._tips = lv.tips || [];              // 无 tips 关不再每帧兜底新建空数组
    this.hud.showHud(lv, { maxColl: this.cfg.SCORE.maxCollisions });
    this.state = 'briefing';

    this.hud.showBriefing(lv, function () { self.startPlay(); }, function () { self.toSelect(); },
      { maxColl: this.cfg.SCORE.maxCollisions });
  };

  Game.prototype.startPlay = function () {
    this.hud.hideScreen();
    this.state = 'playing';
    this.setTouchControlsVisible(true);
  };

  /* ---------- 辅助开关（键盘 H/M/C 与触屏按钮共用同一代码路径） ---------- */
  Game.prototype.toggleGuide = function () {
    this.assist.guide = !this.assist.guide;
    if (this.guide) this.guide.setVisible(this.assist.guide);
    this.syncTouchFnButtons();
  };
  Game.prototype.toggleTop = function () {
    this.assist.top = !this.assist.top;
    this.syncTouchFnButtons();
  };
  Game.prototype.toggleRevCam = function () {
    this.assist.revCam = !this.assist.revCam;
    this.syncTouchFnButtons();
  };

  /** 触屏功能钮的高亮同步（assist 开关态；无触屏 UI 时是空操作）。跨实现契约：_tcFns.*.setOn */
  Game.prototype.syncTouchFnButtons = function () {
    this.PS.Ui.syncFnButtons(this);
  };

  /* ---------- 触屏支持：画质档与虚拟驾驶控件 ---------- */

  /** 触屏画质档：pixelRatio/阴影贴图直设渲染器，镜面/倒影 RT 尺寸写回 config.QUALITY
   *  （cockpit 建镜组时读取）——手机 GPU 的核心预算点是"车一动 = 主渲染+3镜+倒影 5 遍场景"，
   *  RT 降档 + 像素比钳制 + 阴影贴图减半后按需渲染框架即可稳定帧率 */
  Game.prototype.applyTouchQuality = function () {
    var q = this.cfg.QUALITY && this.cfg.QUALITY.touch;
    if (!q) return;
    if (q.pixelRatioMax) this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatioMax));
    if (q.shadowSize) this.sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
    if (q.mirrorRtW) this.cfg.QUALITY.mirrorRtW = q.mirrorRtW;
    if (q.revRtW) this.cfg.QUALITY.revRtW = q.revRtW;
    if (q.revRtH) this.cfg.QUALITY.revRtH = q.revRtH;
  };

  /**
   * 虚拟驾驶控件（网页 DOM 实现；小游戏 canvas 实现在 ui_wx.js，由 PS.Ui 调度）。
   * 驾驶键"按住=按住物理键"（直写 this.keys）——倒车蠕行计时、松开即刹车、
   * 松方向键保持转角等键盘语义原样保留，物理/规则层零改动。Pointer Events +
   * setPointerCapture：多点触控各键独立跟踪（按住油门同时打方向），滑出按钮也只抬起自己。
   */
  Game.prototype.buildTouchControls = function () {
    if (this._touchUI) return;
    var self = this;
    var root = document.createElement('div');
    root.className = 'touch-controls';

    /** 驾驶键：label 主图标 + cap 小字；key 对应 this.keys 字段 */
    function driveBtn(cls, label, cap, key) {
      var b = document.createElement('div');
      b.className = 'tc-btn drive ' + cls;
      b.innerHTML = label + '<small>' + cap + '</small>';
      var off = function () { self.keys[key] = false; };
      b.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        self.audio.unlock();
        try { b.setPointerCapture(e.pointerId); } catch (err) { /* 老浏览器/合成事件 */ }
        self.keys[key] = true;
      });
      b.addEventListener('pointerup', off);
      b.addEventListener('pointercancel', off);
      b.addEventListener('lostpointercapture', off);
      root.appendChild(b);
      return b;
    }
    /** 功能键：单次触发（暂停/辅助开关），不进 keys */
    function fnBtn(cls, label, fn) {
      var b = document.createElement('div');
      b.className = 'tc-btn fn ' + cls;
      b.textContent = label;
      b.addEventListener('pointerdown', function (e) { e.preventDefault(); self.audio.unlock(); fn(); });
      root.appendChild(b);
      /* setOn 契约：跨 DOM/canvas 两实现统一的高亮开关（syncTouchFnButtons 消费） */
      return { el: b, setOn: function (on) { b.classList.toggle('on', on); } };
    }

    /** 模拟量方向盘（v2 规划项：替换 ◀▶ 数字转向键）。抓轮缘绕中心旋转（与真车
     *  同向：轮顺时针=车右转、逆时针=车左转），松手保持转角（与 A/D 松开一致），
     *  双击回正。转角写入 self.touchAnalog.steer，经 input.js 与键盘/手柄同通道合并 */
    function steerWheel() {
      var w = document.createElement('div');
      w.className = 'tc-wheel';
      var face = document.createElement('div');
      face.className = 'tc-wheel-face';
      face.innerHTML = '<i class="sp sp-l"></i><i class="sp sp-r"></i><i class="sp sp-b"></i><b></b>';
      w.appendChild(face);
      var cap = document.createElement('small');
      cap.textContent = '方向盘 · 双击回正';
      w.appendChild(cap);
      var angle = 0, grab = null, grabA = 0, lastTap = 0;
      function ptAngle(e) {
        var r = w.getBoundingClientRect();
        return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180 / Math.PI;
      }
      function apply() {
        face.style.transform = 'rotate(' + angle.toFixed(1) + 'deg)';
        self.touchAnalog.steer = -angle / 270;   // ±270° 满打——与座舱方向盘转动圈数 1:1
        w.classList.toggle('active', Math.abs(angle) > 2);
      }
      w.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        self.audio.unlock();
        try { w.setPointerCapture(e.pointerId); } catch (err) { /* 老浏览器/合成事件 */ }
        var now = performance.now();
        if (now - lastTap < 320) { angle = 0; apply(); }   // 双击回正
        lastTap = now;
        grab = e.pointerId;
        grabA = ptAngle(e);
      });
      w.addEventListener('pointermove', function (e) {
        if (grab !== e.pointerId) return;
        var a = ptAngle(e), d = a - grabA;
        if (d > 180) d -= 360;    // 跨 ±π 跳变保护
        if (d < -180) d += 360;
        grabA = a;
        angle = Math.max(-270, Math.min(270, angle + d));   // ±270° 满打，与座舱方向盘圈数 1:1
        apply();
      });
      function off(e) { if (grab === e.pointerId) grab = null; }
      w.addEventListener('pointerup', off);
      w.addEventListener('pointercancel', off);
      w.addEventListener('lostpointercapture', off);
      root.appendChild(w);
      apply();
      return w;
    }

    /** 按住看镜钮（左镜/右镜）：按住 = 转头看对应外后视镜（与键盘 Z/X 同语义） */
    function lookBtn(cls, label, side) {
      var b = document.createElement('div');
      b.className = 'tc-btn fn ' + cls;
      b.innerHTML = label + '<small>按住看</small>';
      var on = function (e) {
        e.preventDefault();
        self.audio.unlock();
        self.lookHeld = side;
        b.classList.add('on');
      };
      var offB = function () { self.lookHeld = 0; b.classList.remove('on'); };
      b.addEventListener('pointerdown', on);
      b.addEventListener('pointerup', offB);
      b.addEventListener('pointercancel', offB);
      b.addEventListener('lostpointercapture', offB);
      root.appendChild(b);
      return b;
    }

    /** 后视镜调节面板（触屏版 V 模式）：选镜 + 按住方向钮调角度 + 完成。
     *  方向钮直写 keys.a/d/w/s——调节模式下 game.adjustMirrors 消费同一键位 */
    function buildMirrorPanel() {
      var p = document.createElement('div');
      p.className = 'mirror-panel';
      p.style.display = 'none';
      function chip(label, sel) {
        var c = document.createElement('div');
        c.className = 'mp-chip';
        c.textContent = label;
        c.addEventListener('pointerdown', function (e) {
          e.preventDefault();
          self.audio.unlock();
          self.mirrorSel = sel;
          syncChips();
        });
        p.appendChild(c);
        return c;
      }
      var chips = [chip('左外镜', 0), chip('右外镜', 1), chip('车内镜', 2)];
      function syncChips() {
        chips.forEach(function (c, i) { c.classList.toggle('on', self.mirrorSel === i); });
      }
      function arrow(cls, label, key) {
        var a = document.createElement('div');
        a.className = 'mp-arrow ' + cls;
        a.textContent = label;
        var on = function (e) { e.preventDefault(); self.audio.unlock(); self.keys[key] = true; a.classList.add('on'); };
        var offA = function () { self.keys[key] = false; a.classList.remove('on'); };
        a.addEventListener('pointerdown', on);
        a.addEventListener('pointerup', offA);
        a.addEventListener('pointercancel', offA);
        a.addEventListener('lostpointercapture', offA);
        p.appendChild(a);
        return a;
      }
      arrow('mp-u', '▲', 'w');
      arrow('mp-l', '◀', 'a');
      arrow('mp-r', '▶', 'd');
      arrow('mp-d', '▼', 's');
      var done = document.createElement('div');
      done.className = 'mp-done';
      done.textContent = '完成';
      done.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        self.mirrorMode = false;
        sync();
      });
      p.appendChild(done);
      var title = document.createElement('div');
      title.className = 'mp-title';
      title.textContent = '后视镜调节';
      p.appendChild(title);

      function sync() {
        p.style.display = self.mirrorMode ? '' : 'none';
        root.style.display = self.mirrorMode ? 'none' : '';
        if (self.mirrorMode) syncChips();
      }
      /* V 键退出/进入调节模式也要同步面板（250ms 轮询，开销可忽略） */
      setInterval(sync, 250);
      sync();
      return p;
    }

    // 左下：模拟量方向盘（抓轮缘打轮，圈数与座舱方向盘 1:1，松手保持——与键盘一致）；
    // 轮右侧：按住看镜；右下：油门/倒车（倒车放最外——泊车主操作）+ 手刹
    steerWheel();
    lookBtn('tc-lml', '左镜', 1);
    lookBtn('tc-lmr', '右镜', 2);
    driveBtn('tc-w', '▲', '前进', 'w');
    driveBtn('tc-s', '▼', '倒车', 's');
    driveBtn('tc-space', '⏹', '手刹', 'space');
    // 左上功能列：暂停 + 引导线/俯视/倒影/调镜（与键盘 H/M/C/V 同一代码路径）。
    // 原右上横排压在车内后视镜的前进视野投影带（画面中上偏右），移到左上；
    // 按住看镜时整排隐藏（_tcLookSync，看右镜时车内镜会扫到左上角）
    var fnEls = [];
    fnEls.push(fnBtn('tc-pause', '⏸', function () {
      if (self.state === 'playing') self.pause();
      else if (self.state === 'paused') self.resume();
    }).el);
    this._tcFns = {
      g: fnBtn('tc-h', '线', function () { self.toggleGuide(); }),
      m: fnBtn('tc-m', '俯', function () { self.toggleTop(); }),
      c: fnBtn('tc-c', '影', function () { self.toggleRevCam(); })
    };
    for (var fk in this._tcFns) fnEls.push(this._tcFns[fk].el);
    fnEls.push(fnBtn('tc-madj', '调镜', function () { self.mirrorMode = true; }).el);
    this._tcLookSync = function (on) {
      var hide = !!on;
      if (root.__fnHidden === hide) return;
      root.__fnHidden = hide;
      for (var i = 0; i < fnEls.length; i++) fnEls[i].style.visibility = hide ? 'hidden' : '';
    };
    var mirrorPanel = buildMirrorPanel();
    this.container.appendChild(mirrorPanel);
    // 竖屏提示横幅（CSS 仅在 body.touch-mode.portrait 且驾驶态显示）
    var rot = document.createElement('div');
    rot.className = 'tc-rotate';
    rot.textContent = '↻ 建议横屏驾驶，视野更完整';
    root.appendChild(rot);

    this.container.appendChild(root);
    this._touchUI = root;
    /* 跨实现契约：wx canvas 实现注册同一回调（PS.Ui.setTouchControlsVisible 消费） */
    this._tcSetVisible = function (v) { root.style.display = v ? '' : 'none'; };
    this.PS.Ui.setTouchControlsVisible(this, false);   // 菜单/简报态先隐藏，进入驾驶再显示
    this.syncTouchFnButtons();
  };

  /** 虚拟控件显隐：仅驾驶态显示（避免浮在菜单/简报/结算上误触）；实现细节由 PS.Ui 调度 */
  Game.prototype.setTouchControlsVisible = function (v) {
    this.PS.Ui.setTouchControlsVisible(this, v);
  };

  Game.prototype.hasNext = function () {
    return !!this.PS.Progress.next(this.PS.Levels.LEVELS, this.level);
  };
  Game.prototype.nextLevel = function () {
    var next = this.PS.Progress.next(this.PS.Levels.LEVELS, this.level);
    if (next) this.loadLevel(next.id, 'play');
  };
  Game.prototype.restart = function () { this.loadLevel(this.level.id, this.mode); };
  Game.prototype.pause = function () {
    var self = this;
    this.state = 'paused';
    this.setTouchControlsVisible(false);
    this.audio.engineOff(); // 暂停时引擎声不停会一直轰鸣
    this.hud.showPause(function () { self.resume(); }, function () { self.restart(); }, function () { self.toMenu(); });
  };
  Game.prototype.resume = function () { this.hud.hideScreen(); this.state = 'playing'; this.setTouchControlsVisible(!this.replaying); };
  Game.prototype.toMenu = function () {
    var PS = this.PS, self = this;
    this.state = 'menu';
    this.setTouchControlsVisible(false);
    this.audio.engineOff();
    this.hud.hideHud();
    var cont = null;
    if (PS.Progress.anyStars()) {
      var target = PS.Progress.continueTarget(PS.Levels.LEVELS);
      if (target) {
        cont = {
          label: '继续训练 · 第 ' + target.id.replace('lv', '') + ' 关 ' + target.name,
          cb: function () { self.loadLevel(target.id, 'play'); }
        };
      }
    }
    this.hud.showMainMenu(function () { self.toSelect(); }, function () { self.toSelect(); }, cont);
  };
  Game.prototype.toSelect = function () {
    var PS = this.PS, self = this;
    this.state = 'select';
    this.setTouchControlsVisible(false);
    this.hud.hideHud();
    var items = PS.Progress.unlockMap(PS.Levels.LEVELS, {
      unlockAll: PS.Platform.getParam('unlock') === '1'
    });
    this.hud.showLevelSelect(items, function (lv) { self.loadLevel(lv.id, 'play'); }, function () { self.toMenu(); });
  };

  /** 终局流转共用（完成/碰撞超限仅音效语义不同，此前两份近乎重复的实现收编）。
   *  复盘回放终局：跳过落档（同一局的重复演绎），沿用已冻结的录像带 */
  Game.prototype._finish = function (ev, failed) {
    var self = this;
    if (!this.replaying) {
      this.PS.Progress.record(this.level.id, ev);
      this._replayTape = this.recorder.tape.length ? this.recorder.tape : null;
    }
    this.replaying = false;
    this.tapePlayer = null;
    this.state = 'result';
    this.setTouchControlsVisible(false);
    this.audio.chime(!failed && ev.stars > 0);
    this.audio.engineOff();
    this.hud.showResult(this.level, ev,
      function () { self.restart(); },
      function () { self.nextLevel(); },
      function () { self.toMenu(); },
      this.hasNext(),
      this._replayTape ? function () { self.startReplay(); } : null);
  };

  /** 复盘回放：重进关卡，由录像带逐帧重演（固定步长确定性 → 轨迹/碰撞/得分一致）。
   *  播到终局帧时 afterStep → _finish 自然回结算；Esc/⏸ 暂停可中途退出 */
  Game.prototype.startReplay = function () {
    if (!this._replayTape || !this._replayTape.length || !this.level) return;
    this.loadLevel(this.level.id, 'replay');
    this.hud.hideScreen();
    this.state = 'playing';
    this.replaying = true;
    this.tapePlayer = PS.Input.createTapeSource(this._replayTape);
    this.setTouchControlsVisible(false);   // 回放中驾驶控件不响应（观看而非驾驶）
  };

  /** 完成一局（ev 为 sim 终局全量评分） */
  Game.prototype.finish = function (ev) { this._finish(ev, false); };

  /** 碰撞超限失败（ev 为 sim 终局全量评分，stars 已置 0） */
  Game.prototype.fail = function (ev) { this._finish(ev, true); };

  /* ---------- 每帧 ---------- */
  Game.prototype.frame = function () {
    var now = performance.now() / 1000;
    if (!this.lastT) this.lastT = now;
    var elapsed = Math.min(0.1, now - this.lastT);
    this.lastT = now;
    this.gpad.poll(elapsed); // 手柄轮询（连接检测/边缘事件/菜单导航），先于物理步进

    if (this.state === 'playing' || (this.state === 'result' && this.run)) {
      this.acc += elapsed;
      while (this.acc >= this.DT) {
        if (this.state === 'playing') this.stepPhysics();
        this.acc -= this.DT;
      }
    }
    this.updateVisuals(elapsed);
    this.render();
  };

  Game.prototype.stepPhysics = function () {
    if (!this.run) return;   // 防御：状态被外部注入（自测页手动 loadLevel 等）时 run 可能未建
    var r;
    if (this.autopilotActive && this.replay) {
      // 演示驾驶：与规划器同一脉冲积分，状态镜像进 sim 后走同一套规则步
      var s = this.replay(this.DT), c = this.run.car;
      c.x = s.x; c.z = s.z; c.heading = s.h; c.speed = s.v; c.steer = s.steer; c.gear = s.gear;
      r = this.run.post(this.DT);
      if (r.hit) { s.x = c.x; s.z = c.z; s.v = c.speed; } // 碰撞推出后回写演示状态
    } else if (this.replaying && this.tapePlayer) {
      // 复盘回放：按录像带帧序重演（录到终局判定帧为止，播完由 afterStep 走 _finish 回结算）
      this.input = this.tapePlayer.sample();
      r = this.run.step(this.DT, this.input);
    } else if (this.mirrorMode) {
      // 后视镜调节模式：驾驶输入封锁（松开即刹车停稳），方向键/十字键改为调节选中镜面
      this.input = this.recorder.blocked();
      this.adjustMirrors(this.DT);
      r = this.run.step(this.DT, this.input);
    } else {
      this.input = this.recorder.sample();
      r = this.run.step(this.DT, this.input);
    }
    this.afterStep(r);
  };

  /** 后视镜调节（调节模式下由 stepPhysics 以固定步长驱动） */
  Game.prototype.adjustMirrors = function (dt) {
    var PS = this.PS, k = this.keys;
    var dy = Math.max(-1, Math.min(1, (k.a ? 1 : 0) - (k.d ? 1 : 0) + (this.gpad.padLeft() ? 1 : 0) - (this.gpad.padRight() ? 1 : 0)));
    var dp = Math.max(-1, Math.min(1, (k.w ? 1 : 0) - (k.s ? 1 : 0) + (this.gpad.padUp() ? 1 : 0) - (this.gpad.padDown() ? 1 : 0)));
    var mir = this.rig && this.rig.mirrorH.mirrors[this.mirrorSel];
    if (mir && (dy || dp)) {
      mir.adjYaw = PS.Physics.clamp(mir.adjYaw + dy * 0.7 * dt, -0.35, 0.35);   // ±20°
      mir.adjPitch = PS.Physics.clamp(mir.adjPitch + dp * 0.5 * dt, -0.26, 0.26); // ±15°
      mir.apply();
      this._mirrorsDirty = true;   // 镜面/镜相机一起偏转，镜中画面已变
      var ma = this.mirrorAdj[this.mirrorSel];   // 原地更新（60Hz 调节期不再逐帧新对象）
      ma.y = mir.adjYaw; ma.p = mir.adjPitch;
    }
  };

  /** 规则步产物消费：碰撞反馈、终局流转、雷达/音效/提示/HUD 刷新 */
  Game.prototype.afterStep = function (r) {
    var PS = this.PS, carP = this.run.car;
    if (r.counted) {
      // 碰撞计次（sim 内已带 1s 冷却：顶蹭"反弹→再蹭"只记 1 次）
      this.audio.thud();
      this.hud.flash();
      this.gpad.rumble(0.9, 0.5, this.cfg.GAMEPAD ? this.cfg.GAMEPAD.rumbleMs : 260);
    }
    if (r.completed) return this.finish(r.ev);
    if (r.failed) return this.fail(r.ev);

    /* 雷达与音效（报警半径对标真车 2.5m 间歇音；距离越近蜂鸣越密）。
     * RADAR 参数直读 config（唯一源，此前的 4 处 2.5/0.7 兜底重复已收敛） */
    var RR = this.cfg.RADAR.range;
    var RU = this.cfg.RADAR.urgent;
    this.radar = carP.gear === 'R' ? PS.Assist.rearDistance(carP, this.cfg.CAR, this.run.obstacles) : null;
    if (this.radar != null && this.radar < RR) {
      this.beepTimer -= this.DT;
      if (this.beepTimer <= 0) {
        this.audio.beep(this.radar < RU);
        this.beepTimer = Math.max(0.1, this.radar / RR * 0.6);
      }
    }
    this.audio.engine(carP.speed);
    // HUD 不在此刷新：评分 ev 缓存到 _lastEv，由 updateVisuals → updateHud 每渲染帧消费
    //（此前每物理步 60Hz 拼提示字符串 + 分配 state 对象，低帧率时一帧还白算多次）
    this._lastEv = r.ev;
  };

  /** HUD 刷新（每渲染帧一次）。提示/辅助文案仅在其输入变化时重建，配合 hud.js
   * 的 DOM 差量缓存，静止泊车时本函数近乎零开销 */
  /** HUD 刷新（每渲染帧一次）。提示/辅助文案仅在其输入变化时重建（hint 同 _assistText
   * 一样按 key 缓存——旧实现每帧无条件拼提示串，差量只挡住了 DOM 写没挡住拼串），
   * 配合 hud.js 的 DOM 差量缓存与复用的 state 对象，静止泊车时本函数近乎零开销 */
  Game.prototype.updateHud = function () {
    var carP = this.run.car;
    var ev = this._lastEv || this.run.evaluate();
    var assistKey = (this.assist.guide ? 1 : 0) | (this.assist.top ? 2 : 0) | (this.assist.revCam ? 4 : 0) | (this._topManual ? 8 : 0);
    if (assistKey !== this._assistKey) {
      this._assistKey = assistKey;
      this._assistText = (this.assist.guide ? '引导✓' : '') +
        (this.assist.top ? (this._topManual ? ' 俯视·手动 R回正' : ' 俯视✓') : '') +
        (this.assist.revCam ? ' 倒影✓' : '');
    }
    // 无情境提示时轮播本关教学要点（每 6s 一条）
    var tips = this._tips;
    var tipIdx = tips.length ? Math.floor(this.run.time / 6) % tips.length : -1;
    var nearIn = !ev.completed && ev.inside && ev.posOffset < 3;
    var hintKey = this.replaying ? 'replay'
      : (this.mirrorMode ? 'm' + this.mirrorSel
      : (nearIn ? 'near' : 'i' + this.indicator.side + 't' + tipIdx));
    if (hintKey !== this._hintKey) {
      this._hintKey = hintKey;
      this._hintText = this.replaying ? '复盘回放中 · Esc 暂停 / 退出'
        : (this.mirrorMode
        ? (this.isTouch
          ? '后视镜调节 · 点上方镜子切换 · 按住 ◀▶▲▼ 调角度'
          : '后视镜调节 [' + (this.mirrorSel === 0 ? '左外镜' : this.mirrorSel === 1 ? '右外镜' : '车内镜') + '] · A/D 左右 · W/S 上下 · 1/2/3 切换 · V 完成')
        : (nearIn ? '很好！停稳保持…'
          : (this.indicator.side ? '转向灯' + (this.indicator.side === 1 ? '左' : '右')
            : (tipIdx >= 0 ? tips[tipIdx] : ''))));
    }
    var st = this._hudState;   // 复用 state 对象（旧实现每帧新字面量）
    st.time = this.run.time; st.collisions = this.run.collisions;
    st.gear = carP.gear; st.speed = carP.speed;
    st.radar = this.radar; st.radarRange = this.cfg.RADAR.range;
    st.hint = this._hintText; st.assistText = this._assistText;
    this.hud.update(st);
  };

  Game.prototype.updateVisuals = function (elapsed) {
    if (!this.rig || !this.run) return;
    var carP = this.carP;

    /* 单车表现：姿态/前轮/方向盘/仪表/车灯（含转向灯自动回位） */
    this.rig.sync(carP, this.input, elapsed, this.indicator);

    /* 相机（含按住 Z/X 时向左/右转头的缓动；目标角对准两侧外后视镜） */
    var lookTarget = this.lookHeld === 1 ? 0.76 : (this.lookHeld === 2 ? -1.11 : 0);
    if (this.lookYaw !== lookTarget) {
      this.lookYaw += (lookTarget - this.lookYaw) * Math.min(1, elapsed * 9);
      if (Math.abs(this.lookYaw - lookTarget) < 0.005) this.lookYaw = lookTarget;
    }
    this.camera.rotation.y = Math.PI + this.lookYaw;
    // rotation.x 为正即视线向下俯（rotation.y=π 时欧拉 XYZ 下 x 分量方向相反）
    this.camera.rotation.x = this.lookPitch + CAM_PITCH;
    /* 按住看镜时隐藏触屏功能列（车内镜画面扫过画面顶部，避免遮挡/误触） */
    if (this._tcLookSync) this._tcLookSync(this.lookHeld);
    /* 太阳灯跟随 */
    this.sun.position.set(carP.x + 18, 30, carP.z + 12);
    this.sun.target.position.set(carP.x, 0, carP.z);
    /* 阴影按需更新：车辆位移/转向超过阈值才重绘阴影贴图（静止泊车时整帧省掉一遍场景渲染）。
     * 姿态对象每关分配一次、之后原地更新（旧实现车辆一动每帧新对象） */
    var last = this._lastShadowPose;
    if (!last || Math.abs(carP.x - last.x) > 1e-4 || Math.abs(carP.z - last.z) > 1e-4 ||
        Math.abs(carP.heading - last.h) > 1e-5) {
      this.renderer.shadowMap.needsUpdate = true;
      this._mirrorsDirty = true;   // 镜面/倒影相机全挂车组：车身动 = 镜中画面变
      if (!last) last = this._lastShadowPose = { x: 0, z: 0, h: 0 };
      last.x = carP.x; last.z = carP.z; last.h = carP.heading;
    }

    /* 俯视相机：位姿跟随仅在俯视开启时逐帧更新；投影矩阵只随窗口宽高比变化——
     * 开启瞬间与 resize 时由 syncTopProjection 刷新（此前每帧无条件重算，即使从未进俯视） */
    if (this.assist.top !== this._topOn) {
      this._topOn = this.assist.top;
      if (this._topOn) {
        this.syncTopProjection();
        this._topYaw = carP.heading;  // 开启瞬间直接对齐车头，无开场旋转
        this._topChase = false;
      }
    }
    if (this.assist.top) {
      /* 正向车操作：up 对齐车头，前进永远是"往上"。跟转带死区+阻尼——
       * 小幅方向修正不转镜（世界基本静止，防晕）；偏出死区才平滑回正，
       * 回到对齐角即锁正。手动旋转过（,/./LB/RB/拖拽/双指拧）则跟随挂起 */
      var TC = this.cfg.VIEW_TOP, D2R = Math.PI / 180;
      if (this._topRot) {
        this._topYaw += this._topRot * TC.rotateRate * elapsed;
        this._topManual = true;
      }
      if (!this._topManual) {
        var yawDiff = carP.heading - this._topYaw;
        while (yawDiff > Math.PI) yawDiff -= 2 * Math.PI;
        while (yawDiff < -Math.PI) yawDiff += 2 * Math.PI;
        if (!this._topChase && Math.abs(yawDiff) > TC.deadZoneDeg * D2R) this._topChase = true;
        if (this._topChase) {
          if (Math.abs(yawDiff) < TC.settleDeg * D2R) {
            this._topYaw = carP.heading;  // 对齐即锁正，避免渐进收敛的残余摆动
            this._topChase = false;
          } else {
            this._topYaw += yawDiff * (1 - Math.exp(-TC.followRate * elapsed));
          }
        }
      }
      this.topCamera.position.set(carP.x, 42, carP.z);
      this.topCamera.up.set(Math.sin(this._topYaw), 0, Math.cos(this._topYaw));
      this.topCamera.lookAt(carP.x, 0, carP.z);
    }

    /* 地库天顶组：俯视上帝视角时隐藏，否则天花板挡住整个俯视画面 */
    if (this.worldH && this.worldH.roof) this.worldH.roof.visible = !this.assist.top;

    /* 倒车影像显隐（俯视上帝视角时隐藏，避免屏幕悬在车顶上方）
     * + 动态引导线：按当前前轮角预测车尾轨迹（assist.js），颜色随雷达距离分级 */
    if (this.rig.mirrorH) {
      var revOn = this.assist.revCam && carP.gear === 'R' && !this.assist.top;
      this.rig.mirrorH.revPlane.visible = revOn;
      if (revOn !== this._lastRevOn) {
        this._lastRevOn = revOn;
        this._mirrorsDirty = true;   // 倒影屏点亮/熄灭各重绘一帧 RT（点亮时画面须新鲜）
      }
      if (this.revGuide) {
        this.revGuide.setVisible(revOn);
        if (revOn) {
          /* 引导线随前轮角弯曲：静止打轮时车身没动（姿态脏检查不触发），单独盯转角 */
          if (Math.abs(carP.steer - this._lastRevSteer) > 1e-5) this._mirrorsDirty = true;
          this._lastRevSteer = carP.steer;
          // 直接传 carP（assist 只读 x/z/heading，旧实现每帧新建 pose 字面量）
          this.revGuide.update(carP, this.cfg.CAR, carP.steer, this.radar);
        }
      }
    }

    this.updateHud();
  };

  /** 俯视投影矩阵：垂直视域固定，水平随窗口宽高比扩展（开启俯视/resize 时调用） */
  Game.prototype.syncTopProjection = function () {
    var halfH = 10.5, halfW = Math.min(26, halfH * this._viewAspect);
    this.topCamera.left = -halfW; this.topCamera.right = halfW;
    this.topCamera.top = halfH; this.topCamera.bottom = -halfH;
    this.topCamera.updateProjectionMatrix();
  };

  /** 俯视镜头手动旋转（增量弧度）：键盘 ,/. 持续、手柄 LB/RB 持续、鼠标拖拽/双指拧按增量。
   *  手动过即暂停自动跟随（用户选定的朝向优先），R 回正恢复 */
  Game.prototype.rotateTopCamera = function (deltaRad) {
    this._topYaw += deltaRad;
    this._topManual = true;
  };

  /** 俯视镜头回正：对齐车头并恢复自动跟随 */
  Game.prototype.resetTopCamera = function () {
    if (!this.carP) return;
    this._topYaw = this.carP.heading;
    this._topChase = false;
    this._topManual = false;
  };

  Game.prototype.render = function () {
    /* 整帧门控：仅 playing 态逐帧渲染。菜单/选关/简报/暂停/结算/自测态场景静止
     * （阴影/镜面均已按需），且叠加层 82% 遮挡——跳过整帧渲染，画布保留最后一帧
     * （不 render 时 canvas 内容不会消失），GPU 几乎零负载。
     * resize/回前台/换关由 _frameDirty 强制补帧；playing 中断时遗留的
     * _mirrorsDirty（如暂停中转向灯闪烁沿）会在恢复后的首帧补上。
     * 小游戏端例外：真机 GL 合成器不保证保留未重绘的画布（浏览器才有此语义），
     * 静止态跳帧在真机上会黑屏——wx 每帧重画（重活仍按需：阴影/镜面 RT/UI 贴图上传） */
    if (this.state === 'playing' || this.PS.Platform.isWx) this._frameDirty = true;
    /* 小游戏 canvas UI 有新内容（滚动/按压/闪烁）时也要整帧重画：
     * UI 以全屏贴图叠加在主场景上，主渲染被跳过时叠加会复叠在旧合成之上 */
    if (this.PS.Platform.overlayNeedsFrame()) this._frameDirty = true;
    if (!this._frameDirty) return;
    this._frameDirty = false;
    var cam = this.assist.top ? this.topCamera : this.camera;
    if (this.rig) {
      // 座舱玻璃盒常显：主相机在盒体内部，FrontSide 背面剔除后不影响舱内视线；
      // 车外任意视角（外部机位/俯视）都能看到封闭的玻璃舱体，不再是"敞篷车"。
      // 俯视时仍隐藏内饰（车顶衬板/A 柱穿出车顶，俯视图中显示为悬空碎块）
      this.rig.car.cabin.visible = true;
      this.rig.cockpit.interior.visible = !this.assist.top;
    }
    if (this.assist.top) this._mirrorsDirty = true;   // 俯视期间镜面不渲染，回驾驶座强制刷新
    if (this.rig && this.run && !this.assist.top) {
      // 镜面/倒影 RT 按需渲染：updateVisuals/rig.sync 在车身位移/转向、刹车灯/转向灯
      // 色变、倒影屏点亮、打轮改引导线、V 调镜时置 _mirrorsDirty——静止泊车时场景对
      // 镜面相机逐像素不变，跳过 3 面镜 + 倒影共 4 遍场景渲染（泊车大部分时间静止）；
      // 简报/暂停/结算/菜单态场景静止（遮罩 82% 遮挡），同样只保留最后一帧——
      // 入口/换关时由 loadLevel 置脏强制渲染一帧
      if (this._mirrorsDirty) {
        // 倒影画面重绘与倒影屏显隐（updateVisuals）保持同一条件：R 挡且倒影开关开启
        var revOn = this.assist.revCam && this.carP.gear === 'R';
        this.rig.mirrorH.render(this.renderer, this.scene, revOn);
        this._mirrorsDirty = false;
      }
    }
    this.renderer.render(this.scene, cam);
    /* 小游戏端：canvas UI 合成（全屏透明贴图叠加）；网页端空操作 */
    this.PS.Platform.presentOverlay(this.renderer);
  };

  /* ---------- 后视镜/倒影渲染回读自测（?mirrortest=1） ---------- */
  Game.prototype.selftestMirrors = function () {
    var res = this.PS.MirrorCheck.run(this);
    var lines = res.report.map(function (r) { return [r.pass, r.name + (r.detail ? ' — ' + r.detail : '')]; });
    var passN = lines.filter(function (l) { return l[0]; }).length;
    this.PS.Platform.setTitle((res.allPass ? 'MIRROR CHECK PASS ' : 'MIRROR CHECK FAIL ') + passN + '/' + lines.length);
    window.__MIRROR_RESULTS = { allPass: res.allPass, report: res.report };
    this.hud.showSelftest(lines, res.allPass);
    this.state = 'selftest';
    this.audio.chime(res.allPass);
    return window.__MIRROR_RESULTS;
  };

  /* ---------- 座舱转向联动自测（?cockpittest=1） ---------- */
  Game.prototype.selftestCockpit = function () {
    var res = this.PS.CockpitCheck.run(this);
    var lines = res.report.map(function (r) { return [r.pass, r.name + (r.detail ? ' — ' + r.detail : '')]; });
    var passN = lines.filter(function (l) { return l[0]; }).length;
    this.PS.Platform.setTitle((res.allPass ? 'COCKPIT CHECK PASS ' : 'COCKPIT CHECK FAIL ') + passN + '/' + lines.length);
    window.__COCKPIT_RESULTS = { allPass: res.allPass, report: res.report };
    this.hud.showSelftest(lines, res.allPass);
    this.state = 'selftest';
    this.audio.chime(res.allPass);
    return window.__COCKPIT_RESULTS;
  };

  /* ---------- selftest（浏览器端全关卡回归） ---------- */
  Game.prototype.selftest = function (onlyId) {
    var PS = this.PS;
    var levels = onlyId && onlyId !== 'all' ? [PS.Levels.byId(onlyId)].filter(Boolean) : PS.Levels.LEVELS;
    var lines = [], allPass = true;
    var report = [];
    for (var i = 0; i < levels.length; i++) {
      var lv = levels[i];
      var r = PS.Autopilot.runLevel(lv, { record: false });
      var ok = r.success && r.collisions <= 2 && r.result && r.result.stars >= 1;
      if (!ok) allPass = false;
      var info = lv.id + ' ' + lv.name + ' — ' + (r.success ? ('得分 ' + r.result.score + ' ★' + r.result.stars + ' 碰撞 ' + r.collisions + ' 用时 ' + r.time.toFixed(0) + 's') : ('失败: ' + r.reason));
      lines.push([ok, info]);
      report.push({ id: lv.id, ok: ok, info: info });
    }
    this.PS.Platform.setTitle((allPass ? 'SELFTEST PASS ' : 'SELFTEST FAIL ') + lines.filter(function (l) { return l[0]; }).length + '/' + lines.length);
    window.__SELFTEST_RESULTS = { allPass: allPass, report: report };
    this.hud.showSelftest(lines, allPass);
    this.state = 'selftest';
    this.audio.chime(allPass);
    return window.__SELFTEST_RESULTS;
  };

  return Game;
});