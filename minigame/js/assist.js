/* js/assist.js · 微信小游戏模块（tools/build_wx.js 生成，勿手改） */
var window = GameGlobal, self = GameGlobal;   /* UMD 根 → 跨模块共享全局 */
var module, exports, define;                  /* 遮蔽 CommonJS：强制浏览器分支 */
/* 辅助系统：引导轨迹线、倒车雷达、音效 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.PS = root.PS || {}; root.PS.Assist = api; }
})(typeof self !== 'undefined' ? self : this, function () {

  /** 引导轨迹线：用执行器无头跑出的轨迹画地面曲线 */
  function createGuideLine(scene, pathPoints) {
    if (!pathPoints || pathPoints.length < 2) return { mesh: null, setVisible: function () {} };
    var pts = pathPoints.map(function (p) { return new THREE.Vector3(p.x, 0.06, p.z); });
    var geo = new THREE.BufferGeometry().setFromPoints(pts);
    var mat = new THREE.LineDashedMaterial({ color: 0x35d06a, dashSize: 0.5, gapSize: 0.35 });
    var line = new THREE.Line(geo, mat);
    line.computeLineDistances();
    scene.add(line);
    return {
      mesh: line,
      setVisible: function (v) { line.visible = v; },
      dispose: function () {
        scene.remove(line);
        geo.dispose(); mat.dispose();
      }
    };
  }

  /** 倒车影像动态引导线（B1+B2）：
   * - 动态弧线：按当前前轮角用自行车模型（与 physics.js 同式）从车尾中心积分预测 4.5m 轨迹，
   *   打方向时实时弯曲——"方向盘↔车尾走向"的直接参照；
   * - 车宽走廊线：车尾两角向后 2.5m 的白色直线，标示车身将通过的宽度；
   * - 颜色随倒车雷达距离分级（与 HUD 雷达同一阈值）：≥range 绿 / urgent~range 黄 / <urgent 红；
   * - 挂 layer 1：仅倒影相机（已 enable 该层）可见，主视图/后视镜画面不受影响。
   * update(pose, carCfg, steer, radar) 每帧调用；雷达为 null（非 R 档）时弧线取绿色。 */
  function createRevGuideLine(scene) {
    var N = 25, LEN = 4.5, CORRIDOR = 2.5;
    var RAD = (typeof PS !== 'undefined' && PS.RADAR) || { range: 2.5, urgent: 0.7 };

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    var mat = new THREE.LineBasicMaterial({ color: 0x35d06a, transparent: true, opacity: 0.95 });
    var line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    line.layers.set(1);
    line.visible = false;
    scene.add(line);

    var wGeo = new THREE.BufferGeometry();
    wGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(4 * 3), 3));
    var wMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 });
    var corridor = new THREE.Line(wGeo, wMat);
    corridor.frustumCulled = false;
    corridor.layers.set(1);
    corridor.visible = false;
    scene.add(corridor);

    function update(pose, carCfg, steer, radar) {
      /* 动态弧线：以后轴中心为参考点积分（与 physics.js 后轴参考一致，后轮纯滚动），
       * 弧线画的是车尾中心（后轴沿航向后退 rearOH）的真实轨迹 */
      var rearOH = carCfg.length - carCfg.frontOverhang - carCfg.wheelbase;
      var dRear = carCfg.frontOverhang + carCfg.wheelbase - carCfg.length / 2;
      var h = pose.heading;
      var ax = pose.x - Math.sin(h) * dRear, az = pose.z - Math.cos(h) * dRear;
      var pos = geo.attributes.position.array;
      var ds = LEN / (N - 1);
      for (var i = 0; i < N; i++) {
        pos[i * 3] = ax - Math.sin(h) * rearOH;
        pos[i * 3 + 1] = 0.07;
        pos[i * 3 + 2] = az - Math.cos(h) * rearOH;
        h += -Math.tan(steer) / carCfg.wheelbase * ds;
        ax -= Math.sin(h) * ds;   // 倒退（v=-1）
        az -= Math.cos(h) * ds;
      }
      geo.attributes.position.needsUpdate = true;
      var col = radar == null ? 0x35d06a
        : (radar < RAD.urgent ? 0xff4a30 : radar < RAD.range ? 0xffc93f : 0x35d06a);
      if (mat.color.getHex() !== col) mat.color.setHex(col);

      /* 车宽走廊线：车尾两角沿车尾方向向后 CORRIDOR 米 */
      var c = Math.cos(pose.heading), s = Math.sin(pose.heading);
      var bx = pose.x - s * (carCfg.length / 2), bz = pose.z - c * (carCfg.length / 2);
      var rx = c * (carCfg.width / 2), rz = -s * (carCfg.width / 2);
      var wp = wGeo.attributes.position.array;
      wp[0] = bx + rx; wp[1] = 0.07; wp[2] = bz + rz;
      wp[3] = bx + rx - s * CORRIDOR; wp[4] = 0.07; wp[5] = bz - c * CORRIDOR;
      wp[6] = bx - rx; wp[7] = 0.07; wp[8] = bz - rz;
      wp[9] = bx - rx - s * CORRIDOR; wp[10] = 0.07; wp[11] = bz - c * CORRIDOR;
      wGeo.attributes.position.needsUpdate = true;
    }

    return {
      line: line, corridor: corridor,
      update: update,
      setVisible: function (v) { line.visible = v; corridor.visible = v; },
      dispose: function () {
        scene.remove(line); scene.remove(corridor);
        geo.dispose(); mat.dispose(); wGeo.dispose(); wMat.dispose();
      }
    };
  }

  /** 倒车雷达：车尾横向采样点到障碍物 OBB 的最近距离 */
  function rearDistance(carPose, carCfg, obstacles) {
    var h = carPose.heading, c = Math.cos(h), s = Math.sin(h);
    // 车尾中心（局部 z = -len/2）
    var rx = carPose.x - s * (carCfg.length / 2);
    var rz = carPose.z - c * (carCfg.length / 2);
    var best = Infinity;
    for (var i = 0; i < obstacles.length; i++) {
      var o = obstacles[i];
      // 障碍静止：局部坐标变换的 cos/sin 直接读 OBB 预算缓存（makeObb/setObb 已存 ca/sa）
      var dh = o.ca != null ? o.ca : Math.cos(-o.angle);        // cos(-a) = cos(a)
      var dsh = o.sa != null ? -o.sa : Math.sin(-o.angle);      // sin(-a) = -sin(a)
      for (var k = -1; k <= 1; k++) { // 车尾左中右三点
        var px = rx + c * k * 0.6;
        var pz = rz - s * k * 0.6;
        var dx = px - o.x, dz = pz - o.z;
        var lx = dx * dh - dz * dsh, lz = dx * dsh + dz * dh;
        var qx = Math.max(-o.hw, Math.min(o.hw, lx));
        var qz = Math.max(-o.hl, Math.min(o.hl, lz));
        var d = Math.hypot(lx - qx, lz - qz);
        if (d < best) best = d;
      }
    }
    return best;
  }

  /** 简易音效引擎（WebAudio，首次用户手势解锁） */
  function createAudio() {
    var ctx = null, master = null, engine = null, engineGain = null, enabled = true;
    function ensure() {
      if (ctx) return true;
      try {
        /* 上下文来源 platform：网页 new AudioContext / 小游戏 wx.createWebAudioContext
         * （节点 API 同构：oscillator/gain/setTargetAtTime 两端一致） */
        var PLAT = (typeof window !== 'undefined' && window.PS && window.PS.Platform) ||
                   (typeof self !== 'undefined' && self.PS && self.PS.Platform);
        ctx = PLAT && PLAT.createAudioContext ? PLAT.createAudioContext() : null;
        if (!ctx) {
          var AC = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) || null;
          if (!AC) return false;
          ctx = new AC();
        }
        master = ctx.createGain();
        master.gain.value = 0.5;
        master.connect(ctx.destination);
        engine = ctx.createOscillator();
        engine.type = 'sawtooth';
        engine.frequency.value = 55;
        engineGain = ctx.createGain();
        engineGain.gain.value = 0;
        engine.connect(engineGain);
        engineGain.connect(master);
        engine.start();
        return true;
      } catch (e) { return false; }
    }
    function unlock() { if (ensure() && ctx.state === 'suspended') ctx.resume(); }
    return {
      unlock: unlock,
      setEnabled: function (v) { enabled = v; if (master) master.gain.value = v ? 0.5 : 0; },
      engine: function (speed, gearR) {
        if (!ensure() || !enabled) return;
        var f = 52 + Math.abs(speed) * 30;
        engine.frequency.setTargetAtTime(f, ctx.currentTime, 0.05);
        engineGain.gain.setTargetAtTime(0.02 + Math.abs(speed) * 0.012, ctx.currentTime, 0.08);
      },
      /** 引擎静音（暂停/回菜单时调用，否则持续音残留） */
      engineOff: function () {
        if (!ctx || !engineGain) return;
        engineGain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
      },
      thud: function () {
        if (!ensure() || !enabled) return;
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'square'; o.frequency.value = 70;
        g.gain.setValueAtTime(0.4, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
        o.connect(g); g.connect(master);
        o.start(); o.stop(ctx.currentTime + 0.25);
      },
      beep: function (urgent) {
        if (!ensure() || !enabled) return;
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = urgent ? 1400 : 880;
        g.gain.setValueAtTime(0.12, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.09);
        o.connect(g); g.connect(master);
        o.start(); o.stop(ctx.currentTime + 0.1);
      },
      chime: function (win) {
        if (!ensure() || !enabled) return;
        var notes = win ? [523, 659, 784] : [392, 330, 262];
        notes.forEach(function (f, i) {
          var o = ctx.createOscillator(), g = ctx.createGain();
          o.type = 'sine'; o.frequency.value = f;
          var t0 = ctx.currentTime + i * 0.13;
          g.gain.setValueAtTime(0.16, t0);
          g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);
          o.connect(g); g.connect(master);
          o.start(t0); o.stop(t0 + 0.32);
        });
      }
    };
  }

  return { createGuideLine: createGuideLine, createRevGuideLine: createRevGuideLine, rearDistance: rearDistance, createAudio: createAudio };
});