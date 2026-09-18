/* 游戏主控制器：状态机、渲染主循环、输入、辅助开关、selftest */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.PS = root.PS || {}; root.PS.Game = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  var D2R = Math.PI / 180;
  var DT = 1 / 60;

  function Game(container) {
    var PS = window.PS;
    this.PS = PS;
    this.cfg = PS.CONFIG;
    this.container = container;

    /* 渲染器 */
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    /* 场景 */
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9db8c9);
    this.scene.fog = new THREE.Fog(0x9db8c9, 60, 160);

    /* 相机（作为玩家车子对象，随车移动） */
    this.camera = new THREE.PerspectiveCamera(this.cfg.VIEW.fov, window.innerWidth / window.innerHeight, 0.12, 220);
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
    this.radar = null;
    this.beepTimer = 0;
    this.audio = PS.Assist.createAudio();
    this.hud = PS.Hud.createHud(container, PS.Levels);
    this.guide = null;
    this.acc = 0; // 固定步长累加器
    this.autopilotActive = false;

    this.bindInput();
    var self = this;
    window.addEventListener('resize', function () {
      self.renderer.setSize(window.innerWidth, window.innerHeight);
      self.camera.aspect = window.innerWidth / window.innerHeight;
      self.camera.updateProjectionMatrix();
    });
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
        case 'Space': self.input.handbrake = true; e.preventDefault(); break;
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
      if (e.code === 'Space') self.input.handbrake = false;
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
    if (this.car) { this.scene.remove(this.car.group); this.car = null; }
    this.level = lv;
    this.mode = mode || 'play';

    var tex = this.textures || (this.textures = PS.Textures.createTextures());
    this.worldH = PS.World.createWorld(this.scene, lv, tex);

    this.car = PS.CarModel.buildPlayerCar();
    this.car.group.position.set(lv.player.x, 0, lv.player.z);
    this.car.group.rotation.y = lv.player.a * D2R;
    this.scene.add(this.car.group);

    this.cockpit = PS.Cockpit.buildInterior(this.car.group);
    // 后视镜组随新车重建（旧车组已被释放）
    if (this.mirrorH) this.mirrorH.dispose();
    // 渲染镜面画面时隐藏内饰与舱玻璃 → 镜中可见车身侧面/后轮
    this.mirrorH = PS.Cockpit.buildMirrors(this.car.group, this.renderer, [this.cockpit.interior, this.car.cabin]);
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

    /* 引导线：标准答案轨迹（重放一次得到） */
    var res = PS.Autopilot.runLevel(lv, { record: true });
    this.guide = PS.Assist.createGuideLine(this.scene, res.path);
    this.guide.setVisible(this.assist.guide);

    this.time = 0; this.collisions = 0; this.wasColliding = false;
    this.stopTimer = 0; this.indicator.side = 0;
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
    this.hud.showPause(function () { self.resume(); }, function () { self.restart(); }, function () { self.toMenu(); });
  };
  Game.prototype.resume = function () { this.hud.hideScreen(); this.state = 'playing'; };
  Game.prototype.toMenu = function () {
    this.state = 'menu';
    this.hud.hideHud();
    var self = this;
    this.hud.showMainMenu(function () { self.toSelect(); }, function () { self.toSelect(); });
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
        // 后视镜调节模式：驾驶输入封锁（松开即刹车停稳），方向键改为调节选中镜面
        this.input.steer = 0; this.input.drive = 0; this.input.handbrake = false; this.input.holdSteer = true;
        var dy = (k.a ? 1 : 0) - (k.d ? 1 : 0);
        var dp = (k.w ? 1 : 0) - (k.s ? 1 : 0);
        var mir = this.mirrorH && this.mirrorH.mirrors[this.mirrorSel];
        if (mir && (dy || dp)) {
          mir.adjYaw = PS.Physics.clamp(mir.adjYaw + dy * 0.7 * DT, -0.35, 0.35);   // ±20°
          mir.adjPitch = PS.Physics.clamp(mir.adjPitch + dp * 0.5 * DT, -0.26, 0.26); // ±15°
          mir.apply();
          this.mirrorAdj[this.mirrorSel] = { y: mir.adjYaw, p: mir.adjPitch };
        }
      } else {
        this.input.steer = (k.a ? 1 : 0) - (k.d ? 1 : 0);
        this.input.drive = (k.w ? 1 : 0) - (k.s ? 1 : 0); // W 前进 / S 倒车 / 松开即刹车
        this.input.holdSteer = !k.a && !k.d;              // 松开方向键保持转角，不自动回正
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
      if (!this.wasColliding) {
        this.collisions++;
        this.audio.thud();
        this.hud.flash();
      }
      this.carP.bounce();
      /* 位置修正：沿最小穿透方向逐次推出，避免车身嵌入障碍物（穿模） */
      for (var it = 0; it < 5; it++) {
        var obb2 = COL.carObb(this.carP.x, this.carP.z, this.carP.heading, this.cfg.CAR);
        var hit2 = COL.firstHit(obb2, this.obstacles);
        if (hit2 < 0) break;
        var push = COL.minPushOut(obb2, this.obstacles[hit2]);
        this.carP.x += push.dx; this.carP.z += push.dz;
      }
      if (this.autopilotActive && this.replay) {
        var st = this.replay.getSt();
        st.v = this.carP.speed; st.x = this.carP.x; st.z = this.carP.z;
      }
    }
    this.wasColliding = hi >= 0;

    /* 完成判定 */
    var ev = this.PS.Scoring.evaluate({
      x: this.carP.x, z: this.carP.z, heading: this.carP.heading,
      spot: { x: this.level.spot.x, z: this.level.spot.z, angle: this.level.spot.a * D2R, w: this.level.spot.w, l: this.level.spot.l },
      collisions: this.collisions, time: this.time, par: this.level.par,
      carCfg: this.cfg.CAR, cfg: this.cfg.SCORE
    });
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

    /* 雷达与音效 */
    this.radar = this.carP.gear === 'R' ? this.PS.Assist.rearDistance(this.carP, this.cfg.CAR, this.obstacles) : null;
    if (this.radar != null && this.radar < 1.5) {
      this.beepTimer -= DT;
      if (this.beepTimer <= 0) {
        this.audio.beep(this.radar < 0.5);
        this.beepTimer = Math.max(0.12, this.radar / 1.5 * 0.8);
      }
    }
    this.audio.engine(this.carP.speed);
    this.hud.update({
      time: this.time, collisions: this.collisions, gear: this.carP.gear, speed: this.carP.speed,
      radar: this.radar,
      hint: this.mirrorMode ?
        '后视镜调节 [' + (this.mirrorSel === 0 ? '左外镜' : this.mirrorSel === 1 ? '右外镜' : '车内镜') + '] · A/D 左右 · W/S 上下 · 1/2/3 切换 · V 完成' :
        (!ev.completed && ev.posOffset < 3 && ev.inside ? '很好！停稳保持…' :
        (this.indicator.side ? '转向灯' + (this.indicator.side === 1 ? '左' : '右') : '')),
      assistText: (this.assist.guide ? '引导✓' : '') + (this.assist.top ? ' 俯视✓' : '') + (this.assist.revCam ? ' 倒影✓' : '')
    });
  };

  Game.prototype.updateVisuals = function (elapsed) {
    if (!this.car) return;
    this.car.group.position.set(this.carP.x, 0, this.carP.z);
    this.car.group.rotation.y = this.carP.heading;
    /* 前轮转向可视化 */
    var fw = this.carP.steer;
    this.car.frontWheels.forEach(function (w) { w.rotation.y = fw; });
    /* 方向盘随转向输入旋转（传动比见 steerVisualRatio） */
    if (this.cockpit) {
      this.cockpit.wheelGroup.rotation.z = -fw * (this.cfg.CAR.steerVisualRatio || 8);
    }
    /* 刹车灯：手刹 / 松开按键滑行刹车中 / 前进中按 S 减速 */
    var spd = this.carP ? this.carP.speed : 0;
    /* 仪表盘实时刷新（转速/时速指针；数值不变不重绘） */
    if (this.cockpit.updateGauges) {
      this.cockpit.updateGauges(Math.abs(spd) * 3.6, this.carP.gear);
    }
    var braking = this.input.handbrake ||
      (!this.keys.w && !this.keys.s && Math.abs(spd) > 0.05) ||
      (this.keys.s && spd > 0.05);
    var bl = braking ? this.car.brakeOn : this.car.brakeOff;
    this.car.brakeLights.forEach(function (l) { l.material.color.setHex(bl); });
    /* 转向灯闪烁 */
    this.indicator.timer += elapsed;
    var on = this.indicator.side !== 0 && (Math.floor(this.indicator.timer / 0.45) % 2 === 0);
    var indColor = on ? this.car.indOn : this.car.indOff;
    this.car.indicators.l.material.color.setHex(this.indicator.side === 1 && on ? indColor : this.car.indOff);
    this.car.indicators.r.material.color.setHex(this.indicator.side === 2 && on ? indColor : this.car.indOff);

    /* 相机（含按住 Z/X 时向左/右转头的缓动；目标角对准两侧外后视镜） */
    var lookTarget = this.lookHeld === 1 ? 0.76 : (this.lookHeld === 2 ? -1.11 : 0);
    if (this.lookYaw !== lookTarget) {
      this.lookYaw += (lookTarget - this.lookYaw) * Math.min(1, elapsed * 9);
      if (Math.abs(this.lookYaw - lookTarget) < 0.005) this.lookYaw = lookTarget;
    }
    this.camera.rotation.y = Math.PI + this.lookYaw;
    // rotation.y=π 时欧拉 XYZ 下 x 分量方向相反：+7° 即视线向下俯（真实驾驶视线，仪表台入画）
    this.camera.rotation.x = this.lookPitch + 7 * D2R;
    /* 太阳灯跟随 */
    this.sun.position.set(this.carP.x + 18, 30, this.carP.z + 12);
    this.sun.target.position.set(this.carP.x, 0, this.carP.z);

    /* 俯视相机跟随 */
    var b = this.level ? this.level.bounds : null;
    this.topCamera.left = -15; this.topCamera.right = 15;
    this.topCamera.top = 10.5; this.topCamera.bottom = -10.5;
    this.topCamera.position.set(this.carP.x, 42, this.carP.z);
    this.topCamera.up.set(0, 0, -1);
    this.topCamera.lookAt(this.carP.x, 0, this.carP.z);
    this.topCamera.updateProjectionMatrix();

    /* 倒车影像显隐（俯视上帝视角时隐藏，避免屏幕悬在车顶上方） */
    if (this.mirrorH) {
      this.mirrorH.revPlane.visible = this.assist.revCam && this.carP.gear === 'R' && !this.assist.top;
    }
  };

  Game.prototype.render = function () {
    var cam = this.assist.top ? this.topCamera : this.camera;
    if (this.car) {
      // 舱内视角隐藏座舱玻璃盒（避免从内侧遮挡视线）；俯视时玻璃盒与内饰都隐藏
      //（内饰件如车顶衬板/A 柱会穿出车顶，俯视图中显示为悬空碎块）
      this.car.cabin.visible = this.assist.top;
      if (this.cockpit) this.cockpit.interior.visible = !this.assist.top;
    }
    if (this.mirrorH && this.car && !this.assist.top) {
      this.mirrorH.render(this.renderer, this.scene);
    }
    this.renderer.render(this.scene, cam);
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
