/* js/levels/basic.js · 微信小游戏模块（tools/build_wx.js 生成，勿手改） */
var window = GameGlobal, self = GameGlobal;   /* UMD 根 → 跨模块共享全局 */
var module, exports, define;                  /* 遮蔽 CommonJS：强制浏览器分支 */
/* 第一章·基础篇：认识操作与基础入库（lv01-04）。构造器见 js/level_kit.js。
 * 浏览器按 index.html 脚本序注册进 PS.CHAPTERS，Node 由 levels.js 显式 require。 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.PS = root.PS || {}; root.PS.CHAPTERS = root.PS.CHAPTERS || []; root.PS.CHAPTERS.push(api); }
})(typeof self !== 'undefined' ? self : this, function (root) {
  var K = (typeof module === 'object' && module.exports) ? require('../level_kit.js') : root.PS.LevelKit;
  var car = K.car, wall = K.wall, bldg = K.bldg, tree = K.tree, bin = K.bin, neighbors = K.neighbors;

  return {
    title: '第一章·基础篇', levels: [
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
        id: 'lv04', name: '斜列式车位·45°', diff: 1, par: 50,
        desc: '斜列车位一排，顺着斜线车头驶入。',
        tips: ['顺着车位斜线走，不要提前回方向', '车头进库后慢行，别蹭到隔离车辆'],
        player: { x: -10, z: -9.2, a: 0 },
        spot: { x: 0, z: 0, a: 45, w: 2.5, l: 5.0 },
        obstacles: [car(1.524, -1.524, 45), car(-1.524, 1.524, 45),
          car(3.048, -3.048, 45), car(-3.048, 3.048, 45), car(4.572, -4.572, 45),
          tree(-9, 6), tree(9, 6), bldg(-8, 13, 90, 20, 8, 10), bldg(9, 13, 90, 14, 8, 12), bin(7, -6, 0)],
        bounds: { minX: -20, maxX: 20, minZ: -16, maxZ: 14 },
      }
    ]
  };
});