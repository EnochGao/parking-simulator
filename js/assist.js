/* 辅助系统：引导轨迹线、倒车雷达、音效 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.PS = root.PS || {}; root.PS.Assist = api; }
})(typeof self !== 'undefined' ? self : this, function () {

  /** 引导轨迹线：用执行器无头跑出的轨迹画地面曲线。
   * 揉库/侧方类关卡前后多趟压在同一片区域，单色虚线叠成一团读不出走向——
   * 按"位移 × 车头朝向"点积的符号拆前进/倒车两色分段（运动学位移恒沿
   * ±航向，符号即档位）：前进 = 青蓝长虚线，倒车 = 橙色细虚线，虚实节奏
   * 也不同形成双重编码；再沿每段铺同色贴地三角箭头标行进方向。
   * 换挡刹车过渡的近零位移点沿用上一分类，短碎段并入邻段，避免换挡点
   * 炸出碎片线。旧契约不变：返回 { mesh, setVisible, dispose }。 */
  function createGuideLine(scene, pathPoints) {
    if (!pathPoints || pathPoints.length < 2) return { mesh: null, setVisible: function () {}, dispose: function () {} };
    var COL = { 1: 0x4db8ff, '-1': 0xffa24b };
    var DASH = { 1: { dashSize: 0.55, gapSize: 0.38 }, '-1': { dashSize: 0.28, gapSize: 0.26 } };
    var Y = 0.06, MIN_RUN = 0.3, ARROW_GAP = 1.5, ARROW_FIRST = 0.9, ARROW_TAIL = 0.5;

    var n = pathPoints.length;
    var dirOf = new Array(n - 1);      // dirOf[i]：点 i→i+1 的行进方向（+1 前进 / -1 倒车）
    var last = 1;
    for (var i = 0; i < n - 1; i++) {
      var dx = pathPoints[i + 1].x - pathPoints[i].x, dz = pathPoints[i + 1].z - pathPoints[i].z;
      var m2 = dx * dx + dz * dz;
      if (m2 > 1e-8 && typeof pathPoints[i + 1].h === 'number') {
        var d = dx * Math.sin(pathPoints[i + 1].h) + dz * Math.cos(pathPoints[i + 1].h);
        var eps = 0.02 * Math.sqrt(m2);   // 侧滑死区
        if (d > eps) last = 1; else if (d < -eps) last = -1;
      }
      dirOf[i] = last;
    }

    function runLen(r) {
      var L = 0;
      for (var i = r.a; i < r.b; i++) L += Math.hypot(pathPoints[i + 1].x - pathPoints[i].x, pathPoints[i + 1].z - pathPoints[i].z);
      return L;
    }
    /* 聚同向 run（点闭区间 [a,b]），碎 run 并入前段（首段则并给后段） */
    var runs = [], a = 0;
    for (var i = 1; i < n - 1; i++) {
      if (dirOf[i] !== dirOf[a]) { runs.push({ a: a, b: i, dir: dirOf[a] }); a = i; }
    }
    runs.push({ a: a, b: n - 1, dir: dirOf[a] });
    var merged = [];
    for (var k = 0; k < runs.length; k++) {
      if (merged.length && runLen(runs[k]) < MIN_RUN) merged[merged.length - 1].b = runs[k].b;
      else merged.push(runs[k]);
    }
    if (merged.length > 1 && runLen(merged[0]) < MIN_RUN) { merged[1].a = merged[0].a; merged.shift(); }

    var group = new THREE.Group();
    var geos = [], mats = [];
    merged.forEach(function (r) {
      var pts = [];
      for (var i = r.a; i <= r.b; i++) pts.push(new THREE.Vector3(pathPoints[i].x, Y, pathPoints[i].z));
      var geo = new THREE.BufferGeometry().setFromPoints(pts);
      var mat = new THREE.LineDashedMaterial({ color: COL[r.dir], dashSize: DASH[r.dir].dashSize, gapSize: DASH[r.dir].gapSize });
      var line = new THREE.Line(geo, mat);
      line.computeLineDistances();
      group.add(line);
      geos.push(geo); mats.push(mat);
    });

    /* 方向箭头：同色扁三角贴地指向该段行进向；短段居中一枚，长段等距铺，
     * 段尾留白（车要停进去的位置不压箭头）。同色合并成一张 Mesh 省绘制调用 */
    var arrowVerts = { 1: [], '-1': [] };
    function place(dir, x, z, ux, uz) {
      var lx = -uz, lz = ux, y = Y + 0.01;
      arrowVerts[dir].push(
        x + ux * 0.30, y, z + uz * 0.30,
        x - ux * 0.10 + lx * 0.17, y, z - uz * 0.10 + lz * 0.17,
        x - ux * 0.10 - lx * 0.17, y, z - uz * 0.10 - lz * 0.17
      );
    }
    merged.forEach(function (r) {
      var total = runLen(r), stops = [];
      if (total < ARROW_GAP + 0.4) stops.push(total / 2);
      else for (var p = ARROW_FIRST; p <= total - ARROW_TAIL; p += ARROW_GAP) stops.push(p);
      var si = 0, seg0 = 0;
      for (var i = r.a; i < r.b && si < stops.length; i++) {
        var px = pathPoints[i].x, pz = pathPoints[i].z;
        var dx = pathPoints[i + 1].x - px, dz = pathPoints[i + 1].z - pz;
        var len = Math.hypot(dx, dz);
        if (len < 1e-6) continue;
        while (si < stops.length && stops[si] <= seg0 + len) {
          var t = (stops[si] - seg0) / len;
          place(r.dir, px + dx * t, pz + dz * t, dx / len, dz / len);
          si++;
        }
        seg0 += len;
      }
    });
    [1, -1].forEach(function (dir) {
      if (!arrowVerts[dir].length) return;
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(arrowVerts[dir]), 3));
      var mat = new THREE.MeshBasicMaterial({ color: COL[dir], transparent: true, opacity: 0.95, side: THREE.DoubleSide });
      group.add(new THREE.Mesh(geo, mat));
      geos.push(geo); mats.push(mat);
    });

    scene.add(group);
    return {
      mesh: group,
      setVisible: function (v) { group.visible = v; },
      dispose: function () {
        scene.remove(group);
        geos.forEach(function (g) { g.dispose(); });
        mats.forEach(function (m) { m.dispose(); });
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

  /** 俯视转向辅助。背景：正交俯视下前轮被车身完全遮挡——轮外缘 0.833 < 车身半宽
   * 0.847，打轮 <11° 一个像素都露不出来，满舵也只探出 ~9cm 深色窄边，玩家在
   * 俯视图里无从知道当前往哪转。两件套补足反馈：
   * - 前轮转角标线：两根琥珀色短杆悬浮在前轮正上方（高出车顶 0.11m，俯视不
   *   被车身遮挡），挂在前轮 pivot 下随轮实时偏转，直接回答"轮朝哪"；
   * - 预测轨迹弧：按当前前轮角以自行车模型（与 physics.js 后轴参考同式）从
   *   车头/车尾（随档位）积分 LEN 米的预计轨迹，回答"车往哪走"；取紫色与
   *   引导线两色（青蓝/橙）区分——R 档仍随倒车雷达距离分级（与倒影弧线同
   *   一阈值），近距黄/急停红覆盖紫色。
   * 仅俯视开启时 setVisible(true)；镜面 RT 俯视期间本就不渲染，无穿帮面。
   * update(pose, carCfg, steer, reverse, radar) 每帧调用。 */
  function createTopGuide(scene, car, cfg) {
    var N = 16, LEN = 1.6;   // 弧只作"往哪走"的意图提示，过长会一直戳到目标区里添乱
    var COL = 0xcf9bff;      // 安全态紫色；与静态引导线（青蓝/橙）同屏不混淆
    var RAD = (typeof PS !== 'undefined' && PS.RADAR) || { range: 2.5, urgent: 0.7 };

    /* 预测轨迹弧：layer 0 主场景线条，与静态引导线(0.06)/倒影弧线(0.07)错层 */
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    var mat = new THREE.LineBasicMaterial({ color: COL, transparent: true, opacity: 0.95 });
    var line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    line.visible = false;
    scene.add(line);

    /* 前轮转角标线：杆长≈轮胎直径（读作"这就是前轮"），挂 pivot 随轮偏转零额外
     * 数学；pivot 原点在轮心(y=tireR)，杆位抬高到世界 y=1.62（车顶 1.51 之上） */
    var barGeo = new THREE.BoxGeometry(0.06, 0.02, cfg.tireR * 2 + 0.015);
    var barM = new THREE.MeshBasicMaterial({ color: 0xffc93f, transparent: true, opacity: 0.95 });
    var bars = [];
    if (car && car.frontWheels) {
      car.frontWheels.forEach(function (pivot) {
        var bar = new THREE.Mesh(barGeo, barM);
        bar.position.y = 1.62 - cfg.tireR;
        bar.visible = false;
        pivot.add(bar);
        bars.push(bar);
      });
    }

    function update(pose, carCfg, steer, reverse, radar) {
      /* 弧线画车头/车尾中点的轨迹（随档位定起点与方向）：以后轴为参考积分
       * （与 physics.js/倒影弧线同式，dir=-1 即倒退），每步先把画线点沿当前
       * 航向推到 bumper，再步进后轴——弯曲程度即"这把方向够不够" */
      var rearOH = carCfg.length - carCfg.frontOverhang - carCfg.wheelbase;
      var dRear = carCfg.frontOverhang + carCfg.wheelbase - carCfg.length / 2;
      var dir = reverse ? -1 : 1;
      var off = reverse ? -rearOH : carCfg.frontOverhang + carCfg.wheelbase;
      var h = pose.heading;
      var ax = pose.x - Math.sin(h) * dRear, az = pose.z - Math.cos(h) * dRear;
      var pos = geo.attributes.position.array;
      var ds = LEN / (N - 1);
      for (var i = 0; i < N; i++) {
        pos[i * 3] = ax + Math.sin(h) * off;
        pos[i * 3 + 1] = 0.08;
        pos[i * 3 + 2] = az + Math.cos(h) * off;
        h += dir * Math.tan(steer) / carCfg.wheelbase * ds;
        ax += dir * Math.sin(h) * ds;
        az += dir * Math.cos(h) * ds;
      }
      geo.attributes.position.needsUpdate = true;
      var col = (reverse && radar != null)
        ? (radar < RAD.urgent ? 0xff4a30 : radar < RAD.range ? 0xffc93f : COL)
        : COL;
      if (mat.color.getHex() !== col) mat.color.setHex(col);
    }

    return {
      line: line, bars: bars,
      update: update,
      setVisible: function (v) {
        line.visible = v;
        for (var i = 0; i < bars.length; i++) bars[i].visible = v;
      },
      dispose: function () {
        scene.remove(line);
        geo.dispose(); mat.dispose();
        /* 标线是前轮 pivot 子对象：先摘下再释放，不依赖 rig.dispose 的深释放顺序 */
        bars.forEach(function (b) { if (b.parent) b.parent.remove(b); });
        barGeo.dispose(); barM.dispose();
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

  return { createGuideLine: createGuideLine, createRevGuideLine: createRevGuideLine, createTopGuide: createTopGuide, rearDistance: rearDistance, createAudio: createAudio };
});
