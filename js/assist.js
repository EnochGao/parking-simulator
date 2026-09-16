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

  /** 倒车雷达：车尾横向采样点到障碍物 OBB 的最近距离 */
  function rearDistance(carPose, carCfg, obstacles) {
    var COL = PS.Collision;
    var h = carPose.heading, c = Math.cos(h), s = Math.sin(h);
    // 车尾中心（局部 z = -len/2）
    var rx = carPose.x - s * (carCfg.length / 2);
    var rz = carPose.z - c * (carCfg.length / 2);
    var best = Infinity;
    for (var k = -1; k <= 1; k++) { // 车尾左中右三点
      var px = rx + c * k * 0.6;
      var pz = rz - s * k * 0.6;
      for (var i = 0; i < obstacles.length; i++) {
        var o = obstacles[i];
        var dh = Math.cos(-o.angle), dsh = Math.sin(-o.angle);
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
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        ctx = new AC();
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

  return { createGuideLine: createGuideLine, rearDistance: rearDistance, createAudio: createAudio };
});
