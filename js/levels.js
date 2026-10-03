/* 关卡数据：12 关（老小区主题）
 * 坐标：米；角度为度。heading=0 朝 +z，90 朝 +x。
 * spot: {x,z,a,w,l} a=泊车朝向(度), w=垂直泊车方向宽, l=泊车方向长
 * 标准答案路径在 js/demo_paths.js（tools/solver.js 产物，getPhases 读取）
 * 障碍物: car/wall/bldg/pillar/tree/bin */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.PS = root.PS || {}; root.PS.Levels = api; }
})(typeof self !== 'undefined' ? self : this, function (root) {
  var D2R = Math.PI / 180;
  /* 规划器烘焙的标准演示路径（tools/solver.js 产物） */
  var DEMO = null;
  if (typeof module === 'object' && module.exports) {
    try { DEMO = require('./demo_paths.js'); } catch (e) { DEMO = null; }
  } else if (root && root.PS) {
    DEMO = root.PS.DEMO_PATHS || null;
  }

  function car(x, z, a) { return { t: 'car', x: x, z: z, a: a || 0 }; }
  function wall(x, z, a, len, wid, h) { return { t: 'wall', x: x, z: z, a: a, len: len, wid: wid || 0.4, h: h || 2.2 }; }
  function bldg(x, z, a, len, wid, h) { return { t: 'bldg', x: x, z: z, a: a, len: len, wid: wid, h: h || 10 }; }
  function pillar(x, z) { return { t: 'pillar', x: x, z: z, a: 0 }; }
  function tree(x, z) { return { t: 'tree', x: x, z: z, a: 0 }; }
  function bin(x, z, a) { return { t: 'bin', x: x, z: z, a: a || 0 }; }

  /* 车位邻居工具：把宽 w 的车位两侧摆上车（随位角度）；0.847 = 飞度车宽 1.694 的一半 */
  function neighbors(spot, gap) {
    var a = spot.a * D2R, off = spot.w / 2 + 0.847 + (gap == null ? 0.05 : gap);
    var px = Math.cos(a), pz = -Math.sin(a);
    return [car(spot.x + px * off, spot.z + pz * off, spot.a),
            car(spot.x - px * off, spot.z - pz * off, spot.a)];
  }

  var LEVELS = [
    /* ---------------- 1 教学关 ---------------- */
    {
      id: 'lv01', name: '教学·空旷车位', diff: 1, par: 60,
      desc: '熟悉驾驶舱视角与操作，把车倒入右侧标准车位。',
      tips: ['W/↑ 前进 · S/↓ 倒车 · 松开即刹车', 'A D 打方向；档位自动切换（前进 D / 倒车 R）', '倒车时看右后视镜，库角出现回方向', 'M 键俯视图帮你理解车位关系'],
      player: { x: 0, z: -13, a: 0 },
      spot: { x: 0, z: 3, a: 90, w: 2.6, l: 5.4 },
      obstacles: [car(0, 5.225, 90), car(0, 0.775, 90),
        tree(-7, -9), tree(8, -9), tree(-7, 7), bin(8, 7, 30),
        // 两楼 z 错开 0.3m：否则前后面完全共面（z=18/28）在重叠区 z-fighting，
        // 行驶中呈"窗户虚影闪烁"；错开后重叠区读作建筑前后错落
        bldg(-6, 23, 90, 30, 10, 11), bldg(12, 23.3, 90, 16, 10, 13),
        car(-8, -1, 90), car(-8, 3.4, 90)],
      bounds: { minX: -18, maxX: 18, minZ: -18, maxZ: 18 },
    },
    /* ---------------- 2 倒车入库·标准 ---------------- */
    {
      id: 'lv02', name: '倒车入库·两侧有车', diff: 2, par: 55,
      desc: '标准垂直车位，两侧都有车，一把倒入不剐蹭。',
      tips: ['借道要充分：车尾过了旁边车再打方向', '看右镜：库角快消失时开始回方向', '车身正了立即停车，别撞到后车'],
      player: { x: 0, z: -12, a: 0 },
      spot: { x: 0, z: 3, a: 90, w: 2.5, l: 5.3 },
      obstacles: neighbors({ x: 0, z: 3, a: 90, w: 2.5 }).concat([
        wall(7.2, 3, 0, 26, 0.4, 2.6), wall(-7.2, 3, 0, 26, 0.4, 2.6),
        tree(-5, -8), tree(-5, 10), bldg(0, 20, 90, 34, 9, 12)]),
      bounds: { minX: -15, maxX: 15, minZ: -16, maxZ: 16 },
    },
    /* ---------------- 3 侧方停车 ---------------- */
    {
      id: 'lv03', name: '侧方停车·路边趴车', diff: 2, par: 70,
      desc: '路边平行车位，前后都有车，右靠路沿。',
      tips: ['与前车平行再倒，间距约 1 米', '倒至后轮与前车尾对齐，向右打满', '左后角接近路沿时快速回正摆正'],
      player: { x: -10, z: -2.3, a: 90 },
      spot: { x: 0, z: 1.05, a: 90, w: 2.4, l: 5.9 },
      obstacles: [car(-5.1, 1.05, 90), car(5.1, 1.05, 90),
        wall(0, 2.6, 90, 30, 0.3, 0.45),
        tree(-12, -6), tree(12, -6), bldg(0, 12, 90, 34, 9, 11), bldg(-13, -12, 90, 12, 8, 10)],
      bounds: { minX: -16, maxX: 16, minZ: -9, maxZ: 9 },
      via: { x: 0.4, z: -1.95, a: 90 },
    },
    /* ---------------- 4 斜列式车位 ---------------- */
    {
      id: 'lv04', name: '斜列式车位·45°', diff: 2, par: 50,
      desc: '斜列车位一排，顺着斜线车头驶入。',
      tips: ['顺着车位斜线走，不要提前回方向', '车头进库后慢行，别蹭到隔离车辆'],
      player: { x: -10, z: -9.2, a: 0 },
      spot: { x: 0, z: 0, a: 45, w: 2.5, l: 5.0 },
      obstacles: [car(1.524, -1.524, 45), car(-1.524, 1.524, 45),
        car(3.048, -3.048, 45), car(-3.048, 3.048, 45), car(4.572, -4.572, 45),
        tree(-9, 6), tree(9, 6), bldg(-8, 13, 90, 20, 8, 10), bldg(9, 13, 90, 14, 8, 12), bin(7, -6, 0)],
      bounds: { minX: -20, maxX: 20, minZ: -16, maxZ: 14 },
    },
    /* ---------------- 5 直角弯后入库 ---------------- */
    {
      id: 'lv05', name: '直角弯后倒库', diff: 3, par: 75,
      desc: '沿窄路直行后，倒入北侧车位——转弯后立即调整车位关系。',
      tips: ['先走直车道，别提前占位', '车尾过了库位中心再停车挂倒挡', '倒车左打方向，看左镜里库角'],
      player: { x: -7, z: 0.4, a: 90 },
      spot: { x: 9.5, z: 5.35, a: 0, w: 2.5, l: 5.3 },
      obstacles: neighbors({ x: 9.5, z: 5.35, a: 0, w: 2.5 }).concat([
        wall(2, -2.3, 90, 25.2, 0.4, 2.2), wall(2, 8.7, 90, 25.2, 0.4, 2.4),
        wall(-10.7, 3.2, 0, 11.6, 0.4, 2.2), wall(14.2, 3.2, 0, 11.6, 0.4, 2.4),
        bldg(2, 14, 90, 40, 9, 12), tree(-4, -1.5), bin(12.8, -1.2, 15)]),
      bounds: { minX: -11, maxX: 14.5, minZ: -2.6, maxZ: 9 },
    },
    /* ---------------- 6 窄巷尽头库 ---------------- */
    {
      id: 'lv06', name: '窄巷尽头·靠墙库位', diff: 3, par: 90,
      desc: '4 米窄巷尽头小广场，倒车入库贴东墙的车位。',
      tips: ['窄巷居中慢行，别蹭墙', '出巷后向前多走一段再倒', '倒车时利用雷达，听声辨距'],
      player: { x: 0, z: -15, a: 0 },
      spot: { x: 3.6, z: 5.5, a: 90, w: 2.4, l: 5.0 },
      obstacles: [car(3.6, 3.345, 90), car(3.6, 7.655, 90),
        wall(-2.2, -8, 0, 18, 0.3, 2.2), wall(2.2, -8, 0, 18, 0.3, 2.2),
        wall(0, 10.6, 90, 13, 0.3, 2.4), wall(-6.3, -3.2, 0, 27.8, 0.3, 2.4), wall(6.3, -3.2, 0, 27.8, 0.3, 2.4),
        tree(-4, 3), tree(-4.5, 8), bin(-3, 9.5, 0), bldg(0, 15, 90, 20, 8, 12)],
      bounds: { minX: -6.5, maxX: 6.5, minZ: -18, maxZ: 10.8 },
    },
    /* ---------------- 7 柱子旁车位 ---------------- */
    {
      id: 'lv07', name: '柱子旁·视线受限位', diff: 3, par: 70,
      desc: '车位一侧是承重柱，入口被柱子遮挡，善用后视镜和雷达。',
      tips: ['柱子会挡住库角，提前用右镜观察', '倒车雷达响得急就停一停', '宁可两把进库，不要一把硬塞'],
      player: { x: 0, z: -13, a: 0 },
      spot: { x: 0, z: 0, a: 0, w: 2.4, l: 5.2 },
      obstacles: [car(-2.105, 0, 0), pillar(2.1, 2.3), pillar(2.1, -2.3),
        tree(-6, -10), tree(-7, 6), bin(5.5, -8, 0), bin(6.3, -8.8, 40),
        bldg(-2, 16, 90, 36, 9, 11), bldg(-9, -14, 90, 14, 8, 10)],
      bounds: { minX: -14, maxX: 14, minZ: -16, maxZ: 12 },
    },
    /* ---------------- 8 歪斜车位 ---------------- */
    {
      id: 'lv08', name: '歪斜车位·非标入库', diff: 4, par: 80,
      desc: '车位本身是歪的（约 12°），两侧车随位停放，按斜线倒车入库。',
      tips: ['跟着车位的歪斜方向倒，别按习惯摆正车身', '两边后视镜轮流看，保持两边间隙一致', '最后小幅度修方向对齐'],
      player: { x: -11, z: -5.5, a: 90 },
      spot: { x: 0, z: 0, a: 12, w: 2.5, l: 5.3 },
      obstacles: neighbors({ x: 0, z: 0, a: 12, w: 2.5 }).concat([
        car(4.216, -0.897, 12), car(-4.216, 0.897, 12),
        tree(-8, -9), tree(8, 4), bin(6, -8, 20),
        bldg(0, 13, 90, 30, 8, 10), bldg(-12, -13, 90, 12, 8, 10)]),
      bounds: { minX: -16, maxX: 16, minZ: -12, maxZ: 10 },
    },
    /* ---------------- 9 极限侧方 ---------------- */
    {
      id: 'lv09', name: '极限侧方·5.7 米窄位', diff: 4, par: 100,
      desc: '前后车间隙仅 5.7 米（车长 4.1 米），考验揉库精细度。',
      tips: ['前后各留半米，倒车幅度要小', '多次前后揉库很正常，稳住心态', '看好右后视镜里前车尾的距离'],
      player: { x: -10, z: -2.3, a: 90 },
      spot: { x: 0, z: 1.05, a: 90, w: 2.4, l: 5.6 },
      obstacles: [car(-4.9045, 1.05, 90), car(4.9045, 1.05, 90),
        wall(0, 2.6, 90, 30, 0.3, 0.45),
        tree(-12, -6), tree(12, -6), bldg(0, 12, 90, 34, 9, 11)],
      bounds: { minX: -16, maxX: 16, minZ: -9, maxZ: 9 },
      via: { x: 0.4, z: -1.95, a: 90 },
    },
    /* ---------------- 10 地库柱网终考 ---------------- */
    {
      id: 'lv10', name: '地库柱网·终极考核', diff: 5, par: 95,
      desc: '地下车库柱网，目标车位两侧紧贴柱子与车辆，综合考验全部技巧。',
      tips: ['地库光线暗，先看清柱子位置', '车尾过了目标柱位再倒', '两边间距对照两侧后视镜微调'],
      player: { x: -9, z: 0, a: 90 },
      spot: { x: 1.45, z: 4.8, a: 0, w: 2.3, l: 5.1 },
      obstacles: [
        pillar(-5.8, 4.8), pillar(-2.9, 4.8), pillar(0, 4.8), pillar(2.9, 4.8), pillar(5.8, 4.8),
        pillar(-5.8, -4.8), pillar(-2.9, -4.8), pillar(0, -4.8), pillar(2.9, -4.8), pillar(5.8, -4.8),
        car(-1.45, 4.8, 0), car(-4.35, 4.8, 0), car(4.35, 4.8, 0),
        car(-4.35, -4.8, 0), car(1.45, -4.8, 0),
        wall(-11.7, 0.5, 0, 18.4, 0.4, 2.4), wall(11.7, 0.5, 0, 18.4, 0.4, 2.4),
        wall(0, 9.0, 90, 24, 0.4, 2.6), wall(0, -8.0, 90, 24, 0.4, 2.6),
        bin(-8, -3.5, 10), bldg(0, 14, 90, 30, 8, 3)
      ],
      bounds: { minX: -12, maxX: 12, minZ: -8.2, maxZ: 9.2 },
      garage: true,
    },
    /* ---------------- 11 贴墙库（短视频教学案例：靠墙停车位终极教学） ---------------- */
    {
      id: 'lv11', name: '贴墙库·一侧高墙', diff: 3, par: 55,
      desc: '垂直车位一侧紧贴院墙，贴墙侧余量小，练贴墙看同侧镜控距。',
      tips: ['贴墙侧看同侧外后视镜：镜里墙沿与车身的间距就是你的余量',
        '先向不贴墙侧充分借道摆斜，车尾绕开墙角再倒', '雷达报墙距时放慢蠕行，宁停早勿蹭墙'],
      player: { x: 0, z: -12, a: 0 },
      spot: { x: 0, z: 3, a: 90, w: 2.5, l: 5.3 },
      obstacles: [
        car(0, 0.853, 90), car(0, -1.441, 90),                 // 南侧一排邻车（借道侧）
        wall(0, 4.55, 90, 5.6, 0.4, 3.0),                       // 北侧贴库高墙（内缘距库线 0.1m）
        wall(7.2, 3, 0, 26, 0.4, 2.6), wall(-7.2, 3, 0, 26, 0.4, 2.6),
        tree(-5, -8), tree(5, -8), bldg(0, 9.3, 90, 10, 7, 12)
      ],
      bounds: { minX: -15, maxX: 15, minZ: -16, maxZ: 16 },
    },
    /* ---------------- 12 反向斜位（短视频教学案例：背向斜列车位必须倒车入） ---------------- */
    {
      id: 'lv12', name: '反向斜位·背向斜列', diff: 4, par: 60,
      desc: '背向 45° 斜列车位：车头先入会横跨库线，必须倒车入位。',
      tips: ['反向斜位不能车头先入：车头会横跨两根库线压角',
        '开过库位约一个车位再倒，向库位侧打满，车尾沿库轴插入',
        '左镜看到库外侧线与车身平行时立即回正'],
      player: { x: 3, z: -7, a: 0 },
      spot: { x: 0, z: 0, a: 315, w: 2.5, l: 5 },
      obstacles: [
        car(-1.524, -1.524, 315), car(1.524, 1.524, 315),
        car(-3.048, -3.048, 315), car(3.048, 3.048, 315),
        wall(-4.2, 4.2, 45, 10, 0.3, 0.45),                    // 排背侧路沿（马路牙子）
        tree(-9, 3), tree(8, 5), bin(6, -5, 0), bldg(-9, 9.3, 90, 14, 8, 11)
      ],
      bounds: { minX: -16, maxX: 16, minZ: -12, maxZ: 14 },
    }
  ];

  /** 障碍物默认尺寸（完整尺寸；car 为飞度：1.694 × 4.109 × 1.52） */
  var DIMS = {
    car:    { w: 1.694, l: 4.109, h: 1.52 },
    pillar: { w: 0.5,  l: 0.5, h: 3.0 },
    tree:   { w: 0.6,  l: 0.6, h: 2.6 },
    bin:    { w: 0.76, l: 0.76, h: 1.05 }
  };

  /** 关卡碰撞体列表（含边界墙），渲染与物理共用 */
  function getObstacleObbs(level) {
    var out = [];
    level.obstacles.forEach(function (o) {
      var d = DIMS[o.t];
      if (o.t === 'wall' || o.t === 'bldg') {
        out.push({ t: o.t, x: o.x, z: o.z, angle: o.a * D2R, hw: (o.wid || 0.4) / 2, hl: o.len / 2, h: o.h || 2.2 });
      } else {
        out.push({ t: o.t, x: o.x, z: o.z, angle: (o.a || 0) * D2R, hw: d.w / 2, hl: d.l / 2, h: d.h });
      }
    });
    var b = level.bounds;
    var push = function (x, z, a, len) {
      out.push({ t: 'wall', bound: true, x: x, z: z, angle: a * D2R, hw: 0.2, hl: len / 2, h: 2.2 });
    };
    var cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    push(cx, b.minZ - 0.2, 90, b.maxX - b.minX + 1.2);
    push(cx, b.maxZ + 0.2, 90, b.maxX - b.minX + 1.2);
    push(b.minX - 0.2, cz, 0, b.maxZ - b.minZ + 1.2);
    push(b.maxX + 0.2, cz, 0, b.maxZ - b.minZ + 1.2);
    return out;
  }

  function byId(id) {
    for (var i = 0; i < LEVELS.length; i++) if (LEVELS[i].id === id) return LEVELS[i];
    return null;
  }

  /** 关卡标准答案控制段（tools/solver.js 产物，存于 demo_paths.js） */
  function getPhases(level) {
    return (DEMO && DEMO[level.id]) || null;
  }

  return { LEVELS: LEVELS, getObstacleObbs: getObstacleObbs, byId: byId, DIMS: DIMS, getPhases: getPhases };
});
