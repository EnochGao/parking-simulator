/* 一局模拟（sim）：物理步进 → 碰撞（计次冷却/反弹/推出）→ 评分 → 完成/失败判定
 * 唯一权威实现：游戏内主循环（game.js）与无头回归/演示执行器（autopilot.js）
 * 共用本模块——此前 game.postStep 与 autopilot.postUpdate 是两份手工同步的拷贝
 * （连碰撞计次语义都不一致），本模块统一之，规则不再漂移。
 * 完成判定含入位方向门禁：关卡标 entry:'rev'（教倒车入库）时车头直插不算停好，
 * entry:'fwd'（教前进入位）反之——在"四角全入库"上升沿按净纵向位移判入位
 * 方向（见 trackEntry），防止绕个大圈插进位也判成功的钻空子玩法。
 * 状态对象 car 只需暴露 {x, z, heading, speed, steer, gear}（CarPhysics 实例或等价视图）；
 * 步进方式由调用方选择：input 驱动（step，要求 car.update(dt, input) 存在），
 * 或外部自推进状态后调 post(dt)（演示重放/联机帧同步走这条）。Node/浏览器双端通用。 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.PS = root.PS || {}; root.PS.Sim = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  var CFG_, COL, SCO, LVL, PHY;
  function deps() {
    if (typeof module === 'object' && module.exports) {
      CFG_ = require('./config.js'); COL = require('./collision.js');
      SCO = require('./scoring.js'); LVL = require('./levels.js');
      PHY = require('./physics.js');
    } else {
      CFG_ = window.PS; COL = window.PS.Collision;
      SCO = window.PS.Scoring; LVL = window.PS.Levels;
      PHY = window.PS.Physics;
    }
  }

  /**
   * 创建一局。
   * opts: {
   *   car:      状态对象（必填）。有 update(dt,input) 则可用 step()；否则只调 post(dt)
   *   cfg:      配置（缺省取 PS.CONFIG）
   *   cooldown: 碰撞计次冷却秒数（默认 1.0；0=仅按接触沿计次）。同一秒内的连续
   *             顶蹭只记 1 次——"反弹→再蹭"在真实感知里是一次剐蹭
   * }
   * 返回 run: {
   *   car, level, time, collisions, obstacles(OBB[]), obDefs(原始障碍定义),
   *   step(dt, input) → res   // 推进 + 规则步
   *   post(dt)        → res   // 仅规则步（状态已被外部推进）
   *   evaluate()      → ev    // 全量评分（终局/结算展示用，不受距离预筛影响）
   * }
   * res: { ev(当步评分或远距占位), hit(本步接触), counted(本步计次),
   *        obDef(命中障碍定义|null), completed(停稳达标), failed(碰撞超限) }
   */
  function createRun(level, opts) {
    deps();
    opts = opts || {};
    var CFG = opts.cfg || CFG_;
    var CAR = CFG.CAR, SC = CFG.SCORE, PHYS = CFG.PHYS;
    var car = opts.car;
    var cooldown = opts.cooldown != null ? opts.cooldown : 1.0;

    var obDefs = LVL.getObstacleObbs(level);
    var obstacles = obDefs.map(function (o) {
      return COL.makeObb(o.x, o.z, o.angle, o.hw, o.hl);
    });
    var spot = {
      x: level.spot.x, z: level.spot.z,
      angle: level.spot.a * Math.PI / 180, w: level.spot.w, l: level.spot.l
    };
    /* 入位方向追踪的常量（与 scoring 同基：前向=(s,c)，右侧=(c,-s)） */
    var sS = Math.sin(spot.angle), sC = Math.cos(spot.angle);
    var shw = spot.w / 2, shl = spot.l / 2;
    var hw = CAR.width / 2, hl = CAR.length / 2;
    /* 完成判定的距离粗筛半径：车中心要落在车位多边形内，到车位中心距离必
     * ≤ max(半长,半宽)……取 l/2+w/2 再留 1m 余量；粗筛命中才做全量评分——
     * evaluate 每步分配多块临时数组，赶路阶段纯浪费 */
    var reach = spot.l / 2 + spot.w / 2 + 1;

    var run = {
      car: car, level: level,
      time: 0, collisions: 0,
      obstacles: obstacles, obDefs: obDefs,
      _wasColliding: false, _lastColTime: -9, _stopTimer: 0,
      /* 入位方向判定（教学门禁，积分制）：entryDir='rev'倒车入位 / 'fwd'前进
       * 入位 / null 未判定——车与库有交集期间按方向累计纵向里程取多数派；
       * 出生即完美入库（账本为空）保留 null，由完成门禁按关卡要求放行 */
      entryDir: null, _fwdIn: 0, _revIn: 0,
      /* 60Hz 热路径复用对象：车辆 OBB（setObb 原地刷新）、远距占位评分、步结果。
       * 调用方（game/autopilot/测试）均同步消费返回值，无人跨步保留——安全 */
      _carO: COL.makeObb(0, 0, 0, CAR.width / 2, CAR.length / 2),
      _farEv: { completed: false, inside: false, posOffset: 0 },
      _res: { ev: null, hit: false, counted: false, obDef: null, completed: false, failed: false }
    };

    function evaluateNow() {
      return SCO.evaluate({
        x: car.x, z: car.z, heading: car.heading,
        spot: spot, collisions: run.collisions, time: run.time,
        par: level.par, carCfg: CAR, cfg: SC
      });
    }
    run.evaluate = evaluateNow;

    /** 点是否在车位矩形内（spot-local 判定，几何与 scoring.inConvex 等价） */
    function pairIn(px, pz) {
      var dx = px - spot.x, dz = pz - spot.z;
      return Math.abs(dx * sS + dz * sC) <= shl && Math.abs(dx * sC - dz * sS) <= shw;
    }

    /** 入位方向判定（积分制）：车与车位矩形有交集期间，按档位方向累计"沿库
     *  轴的里程"（_fwdIn 前进 / _revIn 倒退），多数派即入位方向。里程按
     *  |speed·dt·对齐度| 计——垂直库轴的贴库穿行（引道傍库而过，车角扫过
     *  库矩形）对齐度≈0 不记账；沿库轴的进退全额记账。任何"过冲后回角入纳
     *  ""前进到差几厘米再倒车旋角""换挡蠕动骗时机"都改变不了账本：前进冲
     *  进去再倒出来两边账一起涨，最终完成入位的那次插入方向占多数；双侧车道
     *  连通的库从哪侧入也如实记账。上升沿/锁定/先后顺序类判定均被此类花招
     *  绕过，弃用。出生即完美入库（账本为空）entryDir 为 null，完成门禁按
     *  关卡要求放行。 */
    function trackEntry(dt) {
      var c = Math.cos(car.heading), s = Math.sin(car.heading);
      var fx = s, fz = c, ax = c * hw, az = -s * hw;
      var any = pairIn(car.x + fx * hl + ax, car.z + fz * hl + az) ||
                pairIn(car.x + fx * hl - ax, car.z + fz * hl - az) ||
                pairIn(car.x - fx * hl + ax, car.z - fz * hl + az) ||
                pairIn(car.x - fx * hl - ax, car.z - fz * hl - az);
      if (any) {
        var d = Math.abs(car.speed * dt * (s * sS + c * sC));   // 沿库轴里程（对齐度加权）
        if (car.speed < 0) run._revIn += d; else run._fwdIn += d;
      }
      run.entryDir = run._revIn > run._fwdIn ? 'rev' : (run._fwdIn > run._revIn ? 'fwd' : run.entryDir);
    }

    /** input 驱动推进（要求 car.update 存在，如 CarPhysics） */
    run.step = function (dt, input) {
      car.update(dt, input);
      return run.post(dt);
    };

    /** 规则步：碰撞处理与计次、评分、完成/失败判定。状态须已推进到位 */
    run.post = function (dt) {
      run.time += dt;

      /* --- 碰撞：检测 → 冷却计次 → 反弹 → 推出 --- */
      var obb = COL.setObb(run._carO, car.x, car.z, car.heading, CAR.width / 2, CAR.length / 2);
      var hi = COL.firstHit(obb, obstacles);
      var obDef = null, counted = false;
      if (hi >= 0) {
        obDef = obDefs[hi];
        if (!run._wasColliding && (cooldown <= 0 || run.time - run._lastColTime >= cooldown)) {
          run.collisions++;
          counted = true;
          run._lastColTime = run.time;
        }
        car.speed = PHY.bounceSpeed(car.speed, PHYS);
        /* 位置修正：沿最小穿透方向逐次推出，避免车身嵌入障碍物（穿模） */
        COL.pushOut(car, car.heading, CAR, obstacles);
      }
      run._wasColliding = hi >= 0;

      /* --- 评分（远距粗筛跳过全量计算）--- */
      var dxs = car.x - spot.x, dzs = car.z - spot.z;
      var ev;
      if (dxs * dxs + dzs * dzs > reach * reach) {
        ev = run._farEv;
        ev.posOffset = Math.sqrt(dxs * dxs + dzs * dzs);
      } else {
        ev = evaluateNow();
      }
      /* --- 入位方向记账：只要车角与库有交集就计（与 solver.ledgerStep 同口径；
       *    不能挂在 reach 粗筛内——中心远但角扫过库时同样要记账） --- */
      trackEntry(dt);

      /* --- 完成：入位且停稳，保持 stopTime 秒；教学关按 entry 要求入位方向 ---
       * entryDir 无法归因（出生即全入）时按关卡要求放行——正常驾驶不可能触发 */
      var entryOK = !level.entry || run.entryDir === level.entry || run.entryDir == null;
      var stopped = car.isStopped ? car.isStopped() : Math.abs(car.speed) < PHYS.stoppedEps;
      var completed = false;
      if (ev.completed && stopped && entryOK) {
        run._stopTimer += dt;
        if (run._stopTimer >= SC.stopTime) { completed = true; ev = evaluateNow(); }
      } else run._stopTimer = 0;

      /* --- 失败：碰撞超限（终局评分走全量，供结算展示）--- */
      var failed = false;
      if (run.collisions >= SC.maxCollisions) {
        failed = true;
        ev = evaluateNow();
        ev.stars = 0;
      }

      var res = run._res;
      res.ev = ev; res.hit = hi >= 0; res.counted = counted;
      res.obDef = obDef; res.completed = completed; res.failed = failed;
      return res;
    };

    return run;
  }

  return { createRun: createRun };
});
