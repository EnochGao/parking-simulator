/* 游戏主控制器：状态机、渲染主循环、输入、辅助开关、selftest */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.PS = root.PS || {}; root.PS.Game = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  var D2R = Math.PI / 180;
  var DT = 1 / 60;

  /* 深度释放一棵对象树的 GPU 资源：three.js 里 scene.remove 只解除场景引用，
   * 几何体/材质不显式 dispose 会一直滞留显存——每次换关/重开都重建整车+座舱，
   * 不释放则反复游玩持续累积。只释放几何体与材质本身；材质引用的贴图
   * （如模块级缓存的仪表 CanvasTexture）生命周期独立，不在此处置。 */
  function disposeDeep(root) {
    root.traverse(function (o) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        var mats = Array.isArray(o.material) ? o.material : [o.material];
        for (var i = 0; i < mats.length; i++) mats[i].dispose();
      }
    });
  }

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
    this.worldH = null;
    this.car = null;         // {group, frontWheels, ...}
    this.carP = null;        // CarPhysics
    this.obstacles = [];
    this.keys = {};
    this.kbHandbrake = false; // 键盘手刹（与手柄 B 合并后写入 input.handbrake）
    this.input = { steer: 0, drive: 0, handbrake: false };
    this.assist = { guide: true, top: false, revCam: true };
    this.mirrorMode = false;  // 后视镜调节模式（V 进入/退出，驾驶输入封锁）
    this.mirrorSel = 0;       // 选中的镜子：0 左外 1 右外 2 车内
    this.mirrorAdj = [{ y: 0, p: 0 }, { y: 0, p: 0 }, { y: 0, p: 0 }]; // 调节量（跨关卡保留）
    this.indicator = { side: 0, timer: 0 }; // 0 无 1 左 2 右
    this.stopTimer = 0;
    this.time = 0;
    this.collisions = 0;
    this.wasColliding = false;
    this.lastColTime = -9;   // 上次碰撞计数时刻（同一次顶蹭 1s 冷却内不重复计数）
    this.audioOn = true;     // 音效开关状态（HUD 🔊 按钮）
    this.radar = null;
    this.beepTimer = 0;
    this.audio = PS.Assist.createAudio();
    this.hud = PS.Hud.createHud(container, PS.Levels);
    this.revGuide = PS.Assist.createRevGuideLine(this.scene); // 倒车影像动态引导线（layer1，仅倒影相机可见）
    this.guide = null;
    this.acc = 0; // 固定步长累加器
    this.autopilotActive = false;
    /* 镜面/倒影 RT 脏检查（见 render）：静止泊车时不重绘 3 面镜 + 倒影共 4 遍场景 */
    this._mirrorsDirty = false;
    this._lastBrakeCol = 0; this._lastIndL = 0; this._lastIndR = 0;
    this._lastRevOn = null; this._lastRevSteer = 0;
    this._viewAspect = Math.max(1, window.innerWidth) / Math.max(1, window.innerHeight);
    this._guidePaths = null;  // 引导线轨迹缓存（按关卡 id，确定性输出）
    /* 整帧门控（见 render）：菜单/简报/暂停/结算等叠加态场景静止，跳过整帧渲染 */
    this._frameDirty = true;  // 初始至少画一帧，主菜单背后才是天空色而非黑屏

    this.bindInput();
    // 手柄（盖世小鸡等标准布局）：逐帧轮询 Gamepad API，驾驶输入与菜单导航
    this.gpad = PS.Gamepad.createGamepad(this, container);
    var self = this;
    this.onResize = function () {
      var w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
      self._viewAspect = w / h;
      self.renderer.setSize(w, h);
      self.camera.aspect = w / h;
      self.camera.updateProjectionMatrix();
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
        case 'Space': self.kbHandbrake = true; e.preventDefault(); break;
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
      if (e.code === 'Space') self.kbHandbrake = false;
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
    if (this.car) {
      disposeDeep(this.car.group);   // 先释放 GPU 资源（scene.remove 不回收显存）
      this.scene.remove(this.car.group);
      this.car = null;
    }
    this.level = lv;
    this.mode = mode || 'play';

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

    this.car = PS.CarModel.buildPlayerCar();
    this.car.group.position.set(lv.player.x, 0, lv.player.z);
    this.car.group.rotation.y = lv.player.a * D2R;
    this.scene.add(this.car.group);

    this.cockpit = PS.Cockpit.buildInterior(this.car.group);
    // 后视镜组随新车重建（旧车组已被释放）
    if (this.mirrorH) this.mirrorH.dispose();
    // 渲染镜面画面时隐藏内饰 → 镜中可见封闭车身侧面/后轮（舱玻璃保留，
    // 左右外镜相机均在车外，镜中呈现带玻璃的完整车身；车内镜相机在盒体
    // 内部，背面剔除后画面不受影响）；
    // 车内后视镜画面额外隐藏车顶板（否则镜中一大片是自家车顶+车尾）
    this.mirrorH = PS.Cockpit.buildMirrors(this.car.group, this.renderer, [this.cockpit.interior], [this.car.roof]);
    // 倒车影像屏挂在中控台（车内居中 x=0），随头转动保持真实车内位置；
    // 作为 interior 子对象，镜面/倒车渲染隐藏内饰时自动一同隐藏
    this.cockpit.interior.add(this.mirrorH.revPlane);
    // 恢复此前保留的后视镜调节量（换关卡不重置）
    for (var mi = 0; mi < this.mirrorH.mirrors.length; mi++) {
      this.mirrorH.mirrors[mi].adjYaw = this.mirrorAdj[mi].y;
      this.mirrorH.mirrors[mi].adjPitch = this.mirrorAdj[mi].p;
      this.mirrorH.mirrors[mi].apply();
    }
    this.car.group.add(this.camera);
    this.camera.position.set(this.cfg.CAR.seatX, this.cfg.CAR.seatY, this.cfg.CAR.seatZ);
    this.camera.rotation.set(0, 0, 0);

    this.carP = new PS.Physics.CarPhysics({ car: this.cfg.CAR, phys: this.cfg.PHYS }, {
      x: lv.player.x, z: lv.player.z, heading: lv.player.a * D2R
    });
    this.carP.gear = 'D';

    var self = this;
    this.obstacles = PS.Levels.getObstacleObbs(lv).map(function (o) {
      return PS.Collision.makeObb(o.x, o.z, o.angle, o.hw, o.hl);
    });
    this.obDefs = PS.Levels.getObstacleObbs(lv);

    /* 引导线：标准答案轨迹。重放是确定性的 → 按关卡缓存，重开/再进不再无头重放整关 */
    this._guidePaths = this._guidePaths || {};
    var path = this._guidePaths[lv.id];
    if (!path) {
      var res = PS.Autopilot.runLevel(lv, { record: true });
      path = this._guidePaths[lv.id] = res.path;
    }
    this.guide = PS.Assist.createGuideLine(this.scene, path);
    this.guide.setVisible(this.assist.guide);

    this.time = 0; this.collisions = 0; this.wasColliding = false;
    this.lastColTime = -9;
    this.stopTimer = 0; this.indicator.side = 0; this.indicator.peak = null;
    this._lastShadowPose = null;             // 新关卡车辆瞬移，强制刷新阴影
    this._mirrorsDirty = true;               // 新关卡强制渲染一帧镜面/倒影 RT
    this._frameDirty = true;                 // 新世界至少画一帧，简报叠加层背后才有画面
    this._lastBrakeCol = 0; this._lastIndL = 0; this._lastIndR = 0;  // 新车灯色从灭态起步，强制首帧刷新
    this._lastRevOn = null; this._lastRevSteer = 0;
    this.usingTop = false; this.assist.top = false;
    this.hud.showHud(lv);
    this.state = 'briefing';

    var brief = { lv: lv };
    this.hud.showBriefing(lv, function () { self.startPlay(); }, function () { self.toSelect(); });
  };

  Game.prototype.startPlay = function () {
    this.hud.hideScreen();
    this.state = 'playing';
  };

  Game.prototype.hasNext = function () {
    var idx = this.PS.Levels.LEVELS.indexOf(this.level);
    return idx >= 0 && idx < this.PS.Levels.LEVELS.length - 1;
  };
  Game.prototype.nextLevel = function () {
    var idx = this.PS.Levels.LEVELS.indexOf(this.level);
    if (this.hasNext()) this.loadLevel(this.PS.Levels.LEVELS[idx + 1].id, 'play');
  };
  Game.prototype.restart = function () { this.loadLevel(this.level.id, this.mode); };
  Game.prototype.pause = function () {
    var self = this;
    this.state = 'paused';
    this.audio.engineOff(); // 暂停时引擎声不停会一直轰鸣
    this.hud.showPause(function () { self.resume(); }, function () { self.restart(); }, function () { self.toMenu(); });
  };
  Game.prototype.resume = function () { this.hud.hideScreen(); this.state = 'playing'; };
  /** 计算续玩目标关：进度链里第一个未拿星的关卡（全通关则为最后一关） */
  Game.prototype.continueTarget = function () {
    var prog = this.PS.Hud.loadProgress();
    var target = null;
    this.PS.Levels.LEVELS.forEach(function (lv) {
      var rec = prog.levels[lv.id];
      if (!target && !(rec && rec.stars > 0)) target = lv;
    });
    return target || this.PS.Levels.LEVELS[this.PS.Levels.LEVELS.length - 1];
  };
  Game.prototype.toMenu = function () {
    this.state = 'menu';
    this.audio.engineOff();
    this.hud.hideHud();
    var self = this;
    var cont = null;
    var target = this.continueTarget();
    var prog = this.PS.Hud.loadProgress();
    var hasProgress = Object.keys(prog.levels || {}).some(function (k) { return prog.levels[k] && prog.levels[k].stars > 0; });
    if (hasProgress && target) {
      cont = {
        label: '继续训练 · 第 ' + target.id.replace('lv', '') + ' 关 ' + target.name,
        cb: function () { self.loadLevel(target.id, 'play'); }
      };
    }
    this.hud.showMainMenu(function () { self.toSelect(); }, function () { self.toSelect(); }, cont);
  };
  Game.prototype.toSelect = function () {
    var self = this;
    this.state = 'select';
    this.hud.hideHud();
    this.hud.showLevelSelect(function (lv) { self.loadLevel(lv.id, 'play'); }, function () { self.toMenu(); });
  };

  Game.prototype.finish = function () {
    var SC = this.cfg.SCORE;
    var ev = this.PS.Scoring.evaluate({
      x: this.carP.x, z: this.carP.z, heading: this.carP.heading,
      spot: { x: this.level.spot.x, z: this.level.spot.z, angle: this.level.spot.a * D2R, w: this.level.spot.w, l: this.level.spot.l },
      collisions: this.collisions, time: this.time, par: this.level.par,
      carCfg: this.cfg.CAR, cfg: SC
    });
    this.state = 'result';
    this.audio.chime(ev.stars > 0);
    this.audio.engineOff();
    var self = this;
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

    if (this.state === 'playing' || (this.state === 'result' && this.carP)) {
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
    if (!this.carP) return;   // 防御：状态被外部注入（自测页手动 loadLevel 等）时 carP 可能未建
    if (this.autopilotActive && this.replay) {
      // 演示驾驶：与规划器同一脉冲积分，状态镜像到 carP 供碰撞/评分/HUD
      var s = this.replay(DT);
      this.carP.x = s.x; this.carP.z = s.z; this.carP.heading = s.h;
      this.carP.speed = s.v; this.carP.steer = s.steer; this.carP.gear = s.gear;
      this.time += DT;
      this.postStep(null);
      return;
    }
    if (!this.autopilotActive) {
      var k = this.keys;
      if (this.mirrorMode) {
        // 后视镜调节模式：驾驶输入封锁（松开即刹车停稳），方向键/十字键改为调节选中镜面
        this.input.steer = 0; this.input.drive = 0; this.input.handbrake = false; this.input.holdSteer = true;
        var dy = Math.max(-1, Math.min(1, (k.a ? 1 : 0) - (k.d ? 1 : 0) + (this.gpad.padLeft() ? 1 : 0) - (this.gpad.padRight() ? 1 : 0)));
        var dp = Math.max(-1, Math.min(1, (k.w ? 1 : 0) - (k.s ? 1 : 0) + (this.gpad.padUp() ? 1 : 0) - (this.gpad.padDown() ? 1 : 0)));
        var mir = this.mirrorH && this.mirrorH.mirrors[this.mirrorSel];
        if (mir && (dy || dp)) {
          mir.adjYaw = PS.Physics.clamp(mir.adjYaw + dy * 0.7 * DT, -0.35, 0.35);   // ±20°
          mir.adjPitch = PS.Physics.clamp(mir.adjPitch + dp * 0.5 * DT, -0.26, 0.26); // ±15°
          mir.apply();
          this._mirrorsDirty = true;   // 镜面/镜相机一起偏转，镜中画面已变
          this.mirrorAdj[this.mirrorSel] = { y: mir.adjYaw, p: mir.adjPitch };
        }
      } else {
        // 键盘优先，手柄（左摇杆/RT/LT/B）补位：模拟量摇杆利于泊车微调
        var gs = this.gpad.drive();
        var m = PS.Gamepad.mergeDrive((k.a ? 1 : 0) - (k.d ? 1 : 0), (k.w ? 1 : 0) - (k.s ? 1 : 0), gs);
        this.input.steer = m.steer;
        this.input.drive = m.drive;                 // W 前进 / S 倒车 / RT·LT / 松开即刹车
        this.input.holdSteer = m.holdSteer;         // 松开方向（摇杆居中）保持转角，不自动回正
        this.input.handbrake = this.kbHandbrake || m.handbrake;
      }
    }
    var r = this.carP.update(DT, this.input);
    this.time += DT;
    this.postStep(r);
  };

  Game.prototype.postStep = function (r) {

    /* 碰撞 */
    var COL = this.PS.Collision;
    var obb = COL.carObb(this.carP.x, this.carP.z, this.carP.heading, this.cfg.CAR);
    var hi = COL.firstHit(obb, this.obstacles);
    if (hi >= 0) {
      // 碰撞计数带 1s 冷却：顶墙时"反弹→再蹭"的连续接触只记 1 次（真实感知为一次剐蹭），
      // 但每次接触仍有反弹与推离反馈
      if (!this.wasColliding && this.time - this.lastColTime >= 1.0) {
        this.collisions++;
        this.lastColTime = this.time;
        this.audio.thud();
        this.hud.flash();
        this.gpad.rumble(0.9, 0.5, this.cfg.GAMEPAD ? this.cfg.GAMEPAD.rumbleMs : 260); // 碰撞手柄震动
      }
      this.carP.bounce();
      /* 位置修正：沿最小穿透方向逐次推出，避免车身嵌入障碍物（穿模）
       * ——与无头回归共用 collision.pushOut，两处行为不会漂移 */
      COL.pushOut(this.carP, this.carP.heading, this.cfg.CAR, this.obstacles);
      if (this.autopilotActive && this.replay) {
        var st = this.replay.getSt();
        st.v = this.carP.speed; st.x = this.carP.x; st.z = this.carP.z;
      }
    }
    this.wasColliding = hi >= 0;

    /* 完成判定：先做距离粗筛，远离车位时跳过全量评分——evaluate 每步分配
     * 多块临时数组（spotPoly/四角/结果对象），赶路阶段纯浪费。车中心要落在
     * 车位多边形内，到车位中心距离必 ≤ max(半长,半宽)，再留 1m 余量 */
    var spot = this.level.spot;
    var dxs = this.carP.x - spot.x, dzs = this.carP.z - spot.z;
    var reach = spot.l / 2 + spot.w / 2 + 1;
    var ev;
    if (dxs * dxs + dzs * dzs > reach * reach) {
      ev = { completed: false, inside: false, posOffset: Math.sqrt(dxs * dxs + dzs * dzs) };
    } else {
      ev = this.PS.Scoring.evaluate({
        x: this.carP.x, z: this.carP.z, heading: this.carP.heading,
        spot: { x: spot.x, z: spot.z, angle: spot.a * D2R, w: spot.w, l: spot.l },
        collisions: this.collisions, time: this.time, par: this.level.par,
        carCfg: this.cfg.CAR, cfg: this.cfg.SCORE
      });
    }
    if (ev.completed && this.carP.isStopped()) {
      this.stopTimer += DT;
      if (this.stopTimer >= this.cfg.SCORE.stopTime) { this.finish(); return; }
    } else this.stopTimer = 0;
    if (this.collisions >= this.cfg.SCORE.maxCollisions) {
      var failEv = this.PS.Scoring.evaluate({
        x: this.carP.x, z: this.carP.z, heading: this.carP.heading,
        spot: { x: this.level.spot.x, z: this.level.spot.z, angle: this.level.spot.a * D2R, w: this.level.spot.w, l: this.level.spot.l },
        collisions: this.collisions, time: this.time, par: this.level.par, carCfg: this.cfg.CAR, cfg: this.cfg.SCORE
      });
      failEv.stars = 0;
      this.state = 'result';
      this.audio.chime(false);
      var self = this;
      this.hud.showResult(this.level, failEv,
        function () { self.restart(); }, function () { self.nextLevel(); },
        function () { self.toMenu(); }, this.hasNext());
      return;
    }

    /* 雷达与音效（报警半径对标真车 2.5m 间歇音；距离越近蜂鸣越密） */
    var RR = this.cfg.RADAR ? this.cfg.RADAR.range : 2.5;
    var RU = this.cfg.RADAR ? this.cfg.RADAR.urgent : 0.7;
    this.radar = this.carP.gear === 'R' ? this.PS.Assist.rearDistance(this.carP, this.cfg.CAR, this.obstacles) : null;
    if (this.radar != null && this.radar < RR) {
      this.beepTimer -= DT;
      if (this.beepTimer <= 0) {
        this.audio.beep(this.radar < RU);
        this.beepTimer = Math.max(0.1, this.radar / RR * 0.6);
      }
    }
    this.audio.engine(this.carP.speed);
    // 无情境提示时轮播本关教学要点（每 6s 一条）
    var tips = (this.level && this.level.tips) || [];
    var tipTxt = tips.length ? tips[Math.floor(this.time / 6) % tips.length] : '';
    this.hud.update({
      time: this.time, collisions: this.collisions, gear: this.carP.gear, speed: this.carP.speed,
      radar: this.radar, radarRange: RR,
      hint: this.mirrorMode ?
        '后视镜调节 [' + (this.mirrorSel === 0 ? '左外镜' : this.mirrorSel === 1 ? '右外镜' : '车内镜') + '] · A/D 左右 · W/S 上下 · 1/2/3 切换 · V 完成' :
        (!ev.completed && ev.posOffset < 3 && ev.inside ? '很好！停稳保持…' :
        (this.indicator.side ? '转向灯' + (this.indicator.side === 1 ? '左' : '右') : tipTxt)),
      assistText: (this.assist.guide ? '引导✓' : '') + (this.assist.top ? ' 俯视✓' : '') + (this.assist.revCam ? ' 倒影✓' : '')
    });
  };

  Game.prototype.updateVisuals = function (elapsed) {
    if (!this.car) return;
    this.car.group.position.set(this.carP.x, 0, this.carP.z);
    this.car.group.rotation.y = this.carP.heading;
    /* 前轮转向可视化：阿克曼几何——内侧轮转角大于外侧（真车转向梯形）。
     * δ 为自行车模型轮角（两轮名义平均），瞬时半径 R=轴距/tan|δ|，
     * 理想内外轮角 = atan(轴距/(R∓轮距/2))；取 60% 阿克曼系数折中观感（无轮 wells 建模） */
    var fw = this.carP.steer;
    var fwAbs = Math.abs(fw);
    if (fwAbs > 1e-4) {
      var RTurn = this.cfg.CAR.wheelbase / Math.tan(fwAbs);
      var tf2 = this.cfg.CAR.trackF / 2;
      var aInner = Math.atan(this.cfg.CAR.wheelbase / Math.max(0.3, RTurn - tf2));
      var aOuter = Math.atan(this.cfg.CAR.wheelbase / (RTurn + tf2));
      var kAck = 0.6;
      var angIn = fw + (Math.sign(fw) * aInner - fw) * kAck;
      var angOut = fw + (Math.sign(fw) * aOuter - fw) * kAck;
      var iIn = fw > 0 ? 1 : 0;                 // 内侧轮：左转=左轮（车左 = +trackF/2 侧）
      this.car.frontWheels[iIn].rotation.y = angIn;
      this.car.frontWheels[1 - iIn].rotation.y = angOut;
    } else {
      this.car.frontWheels[0].rotation.y = 0;
      this.car.frontWheels[1].rotation.y = 0;
    }
    /* 方向盘随转向输入旋转（传动比见 steerVisualRatio）。
     * 视觉层以 steerVisualRate 为转速上限平滑追踪目标角：前轮转向速率 55°/s×传动比 7.5
     * = 412°/s 的打轮速度超出真实手速，观感发飘；限速后方向盘以 ~300°/s 转动，
     * 稳态（保持转向/回正到位）仍与目标角完全一致——车轮与方向盘联动不变 */
    if (this.cockpit) {
      var target = -fw * (this.cfg.CAR.steerVisualRatio || 8);
      var wheel = this.cockpit.wheelGroup;
      var d = target - wheel.rotation.z;
      var maxStep = (this.cfg.CAR.steerVisualRate || 300 * D2R) * elapsed;
      if (Math.abs(d) <= maxStep) wheel.rotation.z = target;
      else wheel.rotation.z += (d > 0 ? 1 : -1) * maxStep;
    }
    /* 刹车灯：手刹 / 松开油门滑行刹车中 / 前进中挂倒车减速（键盘与手柄统一看 input.drive） */
    var spd = this.carP ? this.carP.speed : 0;
    /* 仪表盘实时刷新（转速/时速指针；数值不变不重绘） */
    if (this.cockpit.updateGauges) {
      this.cockpit.updateGauges(Math.abs(spd) * 3.6, this.carP.gear);
    }
    var braking = this.input.handbrake ||
      (this.input.drive === 0 && Math.abs(spd) > 0.05) ||
      (this.input.drive < 0 && spd > 0.05);
    var bl = braking ? this.car.brakeOn : this.car.brakeOff;
    if (bl !== this._lastBrakeCol) {
      this._lastBrakeCol = bl;
      this.car.brakeLights.forEach(function (l) { l.material.color.setHex(bl); });
      this._mirrorsDirty = true;   // 刹车灯入镜，色变才重绘镜面 RT
    }
    /* 转向灯闪烁（色变才写材质；闪烁沿/拨杆开关同时标脏镜面 RT） */
    this.indicator.timer += elapsed;
    var on = this.indicator.side !== 0 && (Math.floor(this.indicator.timer / 0.45) % 2 === 0);
    var lHex = (this.indicator.side === 1 && on) ? this.car.indOn : this.car.indOff;
    var rHex = (this.indicator.side === 2 && on) ? this.car.indOn : this.car.indOff;
    if (lHex !== this._lastIndL || rHex !== this._lastIndR) {
      this._lastIndL = lHex; this._lastIndR = rHex;
      this.car.indicators.l.material.color.setHex(lHex);
      this.car.indicators.r.material.color.setHex(rHex);
      this._mirrorsDirty = true;
    }
    /* 转向灯自动回位熄灭：打过实方向（峰值>12°）后方向盘回到 ±4° 内，
     * 与真实车拨杆回位一致——防止新手打完灯忘关 */
    if (this.indicator.side) {
      var steerAbs = Math.abs(this.carP.steer);
      if (this.indicator.peak == null) this.indicator.peak = 0;
      if (steerAbs > this.indicator.peak) this.indicator.peak = steerAbs;
      if (this.indicator.peak > 12 * D2R && steerAbs < 4 * D2R) {
        this.indicator.side = 0;
        this.indicator.peak = null;
      }
    } else {
      this.indicator.peak = null;
    }

    /* 相机（含按住 Z/X 时向左/右转头的缓动；目标角对准两侧外后视镜） */
    var lookTarget = this.lookHeld === 1 ? 0.76 : (this.lookHeld === 2 ? -1.11 : 0);
    if (this.lookYaw !== lookTarget) {
      this.lookYaw += (lookTarget - this.lookYaw) * Math.min(1, elapsed * 9);
      if (Math.abs(this.lookYaw - lookTarget) < 0.005) this.lookYaw = lookTarget;
    }
    this.camera.rotation.y = Math.PI + this.lookYaw;
    // rotation.y=π 时欧拉 XYZ 下 x 分量方向相反：+5° 即视线向下俯——飞度高座椅、低仪表台，
    // 视线越过台面看到液晶仪表与大片引擎盖，仪表台入画但不喧宾夺主
    this.camera.rotation.x = this.lookPitch + 5 * D2R;
    /* 太阳灯跟随 */
    this.sun.position.set(this.carP.x + 18, 30, this.carP.z + 12);
    this.sun.target.position.set(this.carP.x, 0, this.carP.z);
    /* 阴影按需更新：车辆位移/转向超过阈值才重绘阴影贴图（静止泊车时整帧省掉一遍场景渲染） */
    var sp = this.carP;
    var last = this._lastShadowPose;
    if (!last || Math.abs(sp.x - last.x) > 1e-4 || Math.abs(sp.z - last.z) > 1e-4 ||
        Math.abs(sp.heading - last.h) > 1e-5) {
      this.renderer.shadowMap.needsUpdate = true;
      this._mirrorsDirty = true;   // 镜面/倒影相机全挂车组：车身动 = 镜中画面变
      this._lastShadowPose = { x: sp.x, z: sp.z, h: sp.heading };
    }

    /* 俯视相机跟随（垂直视域固定，水平随窗口宽高比扩展，避免画面拉伸失真）
     * 宽高比用 resize 时缓存的 _viewAspect，不逐帧读 window 布局 */
    var topAspect = this._viewAspect;
    var halfH = 10.5, halfW = Math.min(26, halfH * topAspect);
    this.topCamera.left = -halfW; this.topCamera.right = halfW;
    this.topCamera.top = halfH; this.topCamera.bottom = -halfH;
    this.topCamera.position.set(this.carP.x, 42, this.carP.z);
    this.topCamera.up.set(0, 0, -1);
    this.topCamera.lookAt(this.carP.x, 0, this.carP.z);
    this.topCamera.updateProjectionMatrix();

    /* 地库天顶组：俯视上帝视角时隐藏，否则天花板挡住整个俯视画面 */
    if (this.worldH && this.worldH.roof) this.worldH.roof.visible = !this.assist.top;

    /* 倒车影像显隐（俯视上帝视角时隐藏，避免屏幕悬在车顶上方）
     * + 动态引导线：按当前前轮角预测车尾轨迹（assist.js），颜色随雷达距离分级 */
    if (this.mirrorH) {
      var revOn = this.assist.revCam && this.carP.gear === 'R' && !this.assist.top;
      this.mirrorH.revPlane.visible = revOn;
      if (revOn !== this._lastRevOn) {
        this._lastRevOn = revOn;
        this._mirrorsDirty = true;   // 倒影屏点亮/熄灭各重绘一帧 RT（点亮时画面须新鲜）
      }
      if (this.revGuide) {
        this.revGuide.setVisible(revOn);
        if (revOn) {
          /* 引导线随前轮角弯曲：静止打轮时车身没动（姿态脏检查不触发），单独盯转角 */
          if (Math.abs(this.carP.steer - this._lastRevSteer) > 1e-5) this._mirrorsDirty = true;
          this._lastRevSteer = this.carP.steer;
          this.revGuide.update(
            { x: this.carP.x, z: this.carP.z, heading: this.carP.heading },
            this.cfg.CAR, this.carP.steer, this.radar);
        }
      }
    }
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
    if (this.car) {
      // 座舱玻璃盒常显：主相机在盒体内部，FrontSide 背面剔除后不影响舱内视线；
      // 车外任意视角（外部机位/俯视）都能看到封闭的玻璃舱体，不再是"敞篷车"。
      // 俯视时仍隐藏内饰（车顶衬板/A 柱穿出车顶，俯视图中显示为悬空碎块）
      this.car.cabin.visible = true;
      if (this.cockpit) this.cockpit.interior.visible = !this.assist.top;
    }
    if (this.assist.top) this._mirrorsDirty = true;   // 俯视期间镜面不渲染，回驾驶座强制刷新
    if (this.mirrorH && this.car && !this.assist.top) {
      // 镜面/倒影 RT 按需渲染：updateVisuals 在车身位移/转向、刹车灯/转向灯色变、
      // 倒影屏点亮、打轮改引导线、V 调镜时置 _mirrorsDirty——静止泊车时场景对
      // 镜面相机逐像素不变，跳过 3 面镜 + 倒影共 4 遍场景渲染（泊车大部分时间静止）；
      // 简报/暂停/结算/菜单态场景静止（遮罩 82% 遮挡），同样只保留最后一帧——
      // 入口/换关时由 loadLevel 置脏强制渲染一帧
      if (this._mirrorsDirty) {
        // 倒影画面重绘与倒影屏显隐（updateVisuals）保持同一条件：R 挡且倒影开关开启
        var revOn = this.assist.revCam && this.carP.gear === 'R';
        this.mirrorH.render(this.renderer, this.scene, revOn);
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
