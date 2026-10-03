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
  var DT = 1 / 60;
  var CAM_PITCH = 5 * D2R;   // 主相机俯角：飞度高座椅、低仪表台，视线越过台面看到仪表与引擎盖

  function Game(container) {
    var PS = window.PS;
    this.PS = PS;
    this.cfg = PS.CONFIG;
    this.container = container;

    /* 渲染器（宽高做下限守卫：页面在后台/被遮挡标签页加载时 innerWidth 可能为 0，
     * 否则画布会被初始化成 0×0，玩家只看到黑屏且无法自愈） */
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(Math.max(1, window.innerWidth), Math.max(1, window.innerHeight));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;  // 阴影按需更新（见 updateVisuals）：泊车大部分时间车辆静止，
                                                 // 跳过每帧 2048² 阴影重绘；车辆位移/转向时置 needsUpdate
    container.appendChild(this.renderer.domElement);

    /* 场景 */
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9db8c9);
    this.scene.fog = new THREE.Fog(0x9db8c9, 60, 160);

    /* 相机（作为玩家车子对象，随车移动） */
    this.camera = new THREE.PerspectiveCamera(this.cfg.VIEW.fov, Math.max(1, window.innerWidth) / Math.max(1, window.innerHeight), 0.12, 220);
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
    this.hud = PS.Hud.createHud(container);
    this.revGuide = PS.Assist.createRevGuideLine(this.scene); // 倒车影像动态引导线（layer1，仅倒影相机可见）
    this.guide = null;
    this.acc = 0; // 固定步长累加器
    this.autopilotActive = false;
    this.replay = null;      // 演示驾驶重放器（autopilot.createReplay）
    this._lastEv = null;     // 最近一步评分（HUD 每渲染帧消费，见 updateHud）
    this._assistKey = -1; this._assistText = '';
    this._topOn = false;     // 俯视开关沿：开启瞬间刷新一次俯视投影矩阵
    /* 镜面/倒影 RT 脏检查（见 render）：静止泊车时不重绘 3 面镜 + 倒影共 4 遍场景 */
    this._mirrorsDirty = false;
    this._lastRevOn = null; this._lastRevSteer = 0;
    this._viewAspect = Math.max(1, window.innerWidth) / Math.max(1, window.innerHeight);
    this._guidePaths = null;  // 引导线轨迹缓存（按关卡 id，确定性输出）
    /* 整帧门控（见 render）：菜单/简报/暂停/结算等叠加态场景静止，跳过整帧渲染 */
    this._frameDirty = true;  // 初始至少画一帧，主菜单背后才是天空色而非黑屏

    this.bindInput();
    // 手柄（盖世小鸡等标准布局）：逐帧轮询 Gamepad API，驾驶输入与菜单导航
    this.gpad = PS.Gamepad.createGamepad(this, container);
    this.driver = PS.Input.createDriver(this.keys, this.gpad);
    var self = this;
    this.onResize = function () {
      var w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
      self._viewAspect = w / h;
      self.renderer.setSize(w, h);
      self.camera.aspect = w / h;
      self.camera.updateProjectionMatrix();
      self.syncTopProjection();  // 俯视水平视域随宽高比扩展，resize 时同步
      self._frameDirty = true;   // 画布已换新缓冲，叠加层背后的最后一帧必须补画
    };
    window.addEventListener('resize', this.onResize);
    // 从后台/被遮挡状态回到前台时重设画布（加载时尺寸为 0 的自愈）
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) self.onResize();
    });
    // 鼠标点击也解锁音频（此前只有按键会解锁，点击开始后前几秒无声）
    document.addEventListener('mousedown', function () { self.audio.unlock(); });
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
    var KEYMAP = { KeyW: 'w', ArrowUp: 'w', KeyS: 's', ArrowDown: 's', KeyA: 'a', ArrowLeft: 'a', KeyD: 'd', ArrowRight: 'd' };
    document.addEventListener('keydown', function (e) {
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
        case 'KeyH': self.assist.guide = !self.assist.guide; if (self.guide) self.guide.setVisible(self.assist.guide); break;
        case 'KeyM': self.assist.top = !self.assist.top; break;
        case 'KeyC': self.assist.revCam = !self.assist.revCam; break;
        case 'KeyQ': self.indicator.side = self.indicator.side === 1 ? 0 : 1; break;
        case 'KeyE': self.indicator.side = self.indicator.side === 2 ? 0 : 2; break;
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
    document.addEventListener('keyup', function (e) {
      if (KEYMAP[e.code]) self.keys[KEYMAP[e.code]] = false;
      if (e.code === 'Space') self.keys.space = false;
      if (e.code === 'KeyZ' && self.lookHeld === 1) self.lookHeld = 0;
      if (e.code === 'KeyX' && self.lookHeld === 2) self.lookHeld = 0;
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

    var tex = this.textures || (this.textures = PS.Textures.createTextures());
    this.worldH = PS.World.createWorld(this.scene, lv, tex);
    // 地库关压暗天空/雾色：舱内透过车窗不再看到蓝天砖楼，符合地下环境
    if (lv.garage) {
      this.scene.background = new THREE.Color(0x23262b);
      this.scene.fog = new THREE.Fog(0x23262b, 24, 80);
    } else {
      this.scene.background = new THREE.Color(0x9db8c9);
      this.scene.fog = new THREE.Fog(0x9db8c9, 60, 160);
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
    this._lastShadowPose = null;             // 新关卡车辆瞬移，强制刷新阴影
    this._mirrorsDirty = true;               // 新关卡强制渲染一帧镜面/倒影 RT
    this._frameDirty = true;                 // 新世界至少画一帧，简报叠加层背后才有画面
    this._lastRevOn = null; this._lastRevSteer = 0;
    this.usingTop = false; this.assist.top = false;
    this.hud.showHud(lv);
    this.state = 'briefing';

    this.hud.showBriefing(lv, function () { self.startPlay(); }, function () { self.toSelect(); });
  };

  Game.prototype.startPlay = function () {
    this.hud.hideScreen();
    this.state = 'playing';
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
    this.audio.engineOff(); // 暂停时引擎声不停会一直轰鸣
    this.hud.showPause(function () { self.resume(); }, function () { self.restart(); }, function () { self.toMenu(); });
  };
  Game.prototype.resume = function () { this.hud.hideScreen(); this.state = 'playing'; };
  Game.prototype.toMenu = function () {
    var PS = this.PS, self = this;
    this.state = 'menu';
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
    this.hud.hideHud();
    var items = PS.Progress.unlockMap(PS.Levels.LEVELS, {
      unlockAll: /[?&]unlock=1/.test(location.search)
    });
    this.hud.showLevelSelect(items, function (lv) { self.loadLevel(lv.id, 'play'); }, function () { self.toMenu(); });
  };

  /** 完成一局（ev 为 sim 终局全量评分） */
  Game.prototype.finish = function (ev) {
    var self = this;
    this.PS.Progress.record(this.level.id, ev);
    this.state = 'result';
    this.audio.chime(ev.stars > 0);
    this.audio.engineOff();
    this.hud.showResult(this.level, ev,
      function () { self.restart(); },
      function () { self.nextLevel(); },
      function () { self.toMenu(); },
      this.hasNext());
  };

  /** 碰撞超限失败（ev 为 sim 终局全量评分，stars 已置 0） */
  Game.prototype.fail = function (ev) {
    var self = this;
    this.PS.Progress.record(this.level.id, ev);
    this.state = 'result';
    this.audio.chime(false);
    this.audio.engineOff();
    this.hud.showResult(this.level, ev,
      function () { self.restart(); },
      function () { self.nextLevel(); },
      function () { self.toMenu(); },
      this.hasNext());
  };

  /* ---------- 每帧 ---------- */
  Game.prototype.frame = function () {
    var now = performance.now() / 1000;
    if (!this.lastT) this.lastT = now;
    var elapsed = Math.min(0.1, now - this.lastT);
    this.lastT = now;
    this.gpad.poll(elapsed); // 手柄轮询（连接检测/边缘事件/菜单导航），先于物理步进

    if (this.state === 'playing' || (this.state === 'result' && this.run)) {
      this.acc += elapsed;
      while (this.acc >= DT) {
        if (this.state === 'playing') this.stepPhysics();
        this.acc -= DT;
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
      var s = this.replay(DT), c = this.run.car;
      c.x = s.x; c.z = s.z; c.heading = s.h; c.speed = s.v; c.steer = s.steer; c.gear = s.gear;
      r = this.run.post(DT);
      if (r.hit) { s.x = c.x; s.z = c.z; s.v = c.speed; } // 碰撞推出后回写演示状态
    } else if (this.mirrorMode) {
      // 后视镜调节模式：驾驶输入封锁（松开即刹车停稳），方向键/十字键改为调节选中镜面
      this.input = this.driver.blocked();
      this.adjustMirrors(DT);
      r = this.run.step(DT, this.input);
    } else {
      this.input = this.driver.sample();
      r = this.run.step(DT, this.input);
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
      this.mirrorAdj[this.mirrorSel] = { y: mir.adjYaw, p: mir.adjPitch };
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

    /* 雷达与音效（报警半径对标真车 2.5m 间歇音；距离越近蜂鸣越密） */
    var RR = this.cfg.RADAR ? this.cfg.RADAR.range : 2.5;
    var RU = this.cfg.RADAR ? this.cfg.RADAR.urgent : 0.7;
    this.radar = carP.gear === 'R' ? PS.Assist.rearDistance(carP, this.cfg.CAR, this.run.obstacles) : null;
    if (this.radar != null && this.radar < RR) {
      this.beepTimer -= DT;
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
  Game.prototype.updateHud = function () {
    var carP = this.run.car;
    var ev = this._lastEv || this.run.evaluate();
    var assistKey = (this.assist.guide ? 1 : 0) | (this.assist.top ? 2 : 0) | (this.assist.revCam ? 4 : 0);
    if (assistKey !== this._assistKey) {
      this._assistKey = assistKey;
      this._assistText = (this.assist.guide ? '引导✓' : '') + (this.assist.top ? ' 俯视✓' : '') + (this.assist.revCam ? ' 倒影✓' : '');
    }
    // 无情境提示时轮播本关教学要点（每 6s 一条）
    var tips = (this.level && this.level.tips) || [];
    var tipTxt = tips.length ? tips[Math.floor(this.run.time / 6) % tips.length] : '';
    this.hud.update({
      time: this.run.time, collisions: this.run.collisions, gear: carP.gear, speed: carP.speed,
      radar: this.radar, radarRange: this.cfg.RADAR ? this.cfg.RADAR.range : 2.5,
      hint: this.mirrorMode ?
        '后视镜调节 [' + (this.mirrorSel === 0 ? '左外镜' : this.mirrorSel === 1 ? '右外镜' : '车内镜') + '] · A/D 左右 · W/S 上下 · 1/2/3 切换 · V 完成' :
        (!ev.completed && ev.posOffset < 3 && ev.inside ? '很好！停稳保持…' :
        (this.indicator.side ? '转向灯' + (this.indicator.side === 1 ? '左' : '右') : tipTxt)),
      assistText: this._assistText
    });
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
    /* 太阳灯跟随 */
    this.sun.position.set(carP.x + 18, 30, carP.z + 12);
    this.sun.target.position.set(carP.x, 0, carP.z);
    /* 阴影按需更新：车辆位移/转向超过阈值才重绘阴影贴图（静止泊车时整帧省掉一遍场景渲染） */
    var last = this._lastShadowPose;
    if (!last || Math.abs(carP.x - last.x) > 1e-4 || Math.abs(carP.z - last.z) > 1e-4 ||
        Math.abs(carP.heading - last.h) > 1e-5) {
      this.renderer.shadowMap.needsUpdate = true;
      this._mirrorsDirty = true;   // 镜面/倒影相机全挂车组：车身动 = 镜中画面变
      this._lastShadowPose = { x: carP.x, z: carP.z, h: carP.heading };
    }

    /* 俯视相机：位姿跟随仅在俯视开启时逐帧更新；投影矩阵只随窗口宽高比变化——
     * 开启瞬间与 resize 时由 syncTopProjection 刷新（此前每帧无条件重算，即使从未进俯视） */
    if (this.assist.top !== this._topOn) {
      this._topOn = this.assist.top;
      if (this._topOn) this.syncTopProjection();
    }
    if (this.assist.top) {
      this.topCamera.position.set(carP.x, 42, carP.z);
      this.topCamera.up.set(0, 0, -1);
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
          this.revGuide.update(
            { x: carP.x, z: carP.z, heading: carP.heading },
            this.cfg.CAR, carP.steer, this.radar);
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

  Game.prototype.render = function () {
    /* 整帧门控：仅 playing 态逐帧渲染。菜单/选关/简报/暂停/结算/自测态场景静止
     * （阴影/镜面均已按需），且叠加层 82% 遮挡——跳过整帧渲染，画布保留最后一帧
     * （不 render 时 canvas 内容不会消失），GPU 几乎零负载。
     * resize/回前台/换关由 _frameDirty 强制补帧；playing 中断时遗留的
     * _mirrorsDirty（如暂停中转向灯闪烁沿）会在恢复后的首帧补上 */
    if (this.state === 'playing') this._frameDirty = true;
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
  };

  /* ---------- 后视镜/倒影渲染回读自测（?mirrortest=1） ---------- */
  Game.prototype.selftestMirrors = function () {
    var res = this.PS.MirrorCheck.run(this);
    var lines = res.report.map(function (r) { return [r.pass, r.name + (r.detail ? ' — ' + r.detail : '')]; });
    var passN = lines.filter(function (l) { return l[0]; }).length;
    document.title = (res.allPass ? 'MIRROR CHECK PASS ' : 'MIRROR CHECK FAIL ') + passN + '/' + lines.length;
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
    document.title = (res.allPass ? 'COCKPIT CHECK PASS ' : 'COCKPIT CHECK FAIL ') + passN + '/' + lines.length;
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
    document.title = (allPass ? 'SELFTEST PASS ' : 'SELFTEST FAIL ') + lines.filter(function (l) { return l[0]; }).length + '/' + lines.length;
    window.__SELFTEST_RESULTS = { allPass: allPass, report: report };
    this.hud.showSelftest(lines, allPass);
    this.state = 'selftest';
    this.audio.chime(allPass);
    return window.__SELFTEST_RESULTS;
  };

  return Game;
});
