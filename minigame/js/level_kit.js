/* js/level_kit.js · 微信小游戏模块（tools/build_wx.js 生成，勿手改） */
var window = GameGlobal, self = GameGlobal;   /* UMD 根 → 跨模块共享全局 */
var module, exports, define;                  /* 遮蔽 CommonJS：强制浏览器分支 */
/* 关卡构造工具：障碍物构造器/默认尺寸/邻车摆位——章节数据文件（js/levels/*.js）的公共语言。
 * 从 levels.js 抽出：几十关规模下数据按章拆文件，构造器单源避免每章重复定义。 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.PS = root.PS || {}; root.PS.LevelKit = api; }
})(typeof self !== 'undefined' ? self : this, function (root) {
  /* 车宽半值单源：从 config 取（浏览器加载序 config→level_kit 已保证；旧实现硬编码 0.847
   * 与 CAR.width 隐式耦合，换车宽时这里会悄悄漂移） */
  var CAR_HALF_W = 0.847;
  try {
    var CFGMOD = (typeof module === 'object' && module.exports) ? require('./config.js')
      : (root && root.PS && root.PS.CONFIG);
    if (CFGMOD && CFGMOD.CAR) CAR_HALF_W = CFGMOD.CAR.width / 2;
  } catch (e) { /* 保持兜底值 */ }

  function car(x, z, a) { return { t: 'car', x: x, z: z, a: a || 0 }; }
  function wall(x, z, a, len, wid, h) { return { t: 'wall', x: x, z: z, a: a, len: len, wid: wid || 0.4, h: h || 2.2 }; }
  function bldg(x, z, a, len, wid, h) { return { t: 'bldg', x: x, z: z, a: a, len: len, wid: wid || 0.4, h: h || 10 }; }
  function pillar(x, z) { return { t: 'pillar', x: x, z: z, a: 0 }; }
  function tree(x, z) { return { t: 'tree', x: x, z: z, a: 0 }; }
  function bin(x, z, a) { return { t: 'bin', x: x, z: z, a: a || 0 }; }

  /* 车位邻居工具：把宽 w 的车位两侧摆上车（随位角度）；邻车间距用 CAR_HALF_W（config 单源） */
  var D2R = Math.PI / 180;
  function neighbors(spot, gap) {
    var a = spot.a * D2R, off = spot.w / 2 + CAR_HALF_W + (gap == null ? 0.05 : gap);
    var px = Math.cos(a), pz = -Math.sin(a);
    return [car(spot.x + px * off, spot.z + pz * off, spot.a),
            car(spot.x - px * off, spot.z - pz * off, spot.a)];
  }

  /* 障碍物默认尺寸（完整尺寸；car 为飞度：1.694 × 4.109 × 1.52） */
  var DIMS = {
    car:    { w: 1.694, l: 4.109, h: 1.52 },
    pillar: { w: 0.5,  l: 0.5, h: 3.0 },
    tree:   { w: 0.6,  l: 0.6, h: 2.6 },
    bin:    { w: 0.76, l: 0.76, h: 1.05 }
  };

  return {
    car: car, wall: wall, bldg: bldg, pillar: pillar, tree: tree, bin: bin,
    neighbors: neighbors, DIMS: DIMS, CAR_HALF_W: CAR_HALF_W
  };
});