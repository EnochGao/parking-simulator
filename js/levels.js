/* 关卡聚合器：数据按章拆在 js/levels/*.js（构造器在 js/level_kit.js），此处拼装与查询。
 * 浏览器按 index.html 脚本序把章注册进 PS.CHAPTERS，Node 由本章显式 require——
 * 两侧拼出同一份 LEVELS，解锁链/选关/回归/求解器照常只面向 LEVELS 编程。
 * 新增一章 = js/levels/xx.js + index.html 一行 script + 此处 require 一行（浏览器侧零改动）。
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

  /* 章节来源：Node 显式 require（顺序即全局关卡序）；浏览器读脚本序注册的 PS.CHAPTERS */
  var KIT, CHAPTERS;
  if (typeof module === 'object' && module.exports) {
    KIT = require('./level_kit.js');
    CHAPTERS = [
      require('./levels/basic.js'),
      require('./levels/advanced.js'),
      require('./levels/challenge.js')
    ];
  } else {
    KIT = root.PS.LevelKit;
    CHAPTERS = (root.PS.CHAPTERS || []);
  }
  var DIMS = KIT.DIMS;

  /* 拼装 + 盖章：chapter 序号/章标题供选关分章渲染（hud 按 lv.chapter 分组） */
  var LEVELS = [];
  CHAPTERS.forEach(function (ch, i) {
    ch.levels.forEach(function (lv) {
      lv.chapter = i + 1;
      lv.chapterTitle = ch.title;
      LEVELS.push(lv);
    });
  });

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

  return { LEVELS: LEVELS, CHAPTERS: CHAPTERS, getObstacleObbs: getObstacleObbs, byId: byId, DIMS: DIMS, getPhases: getPhases };
});
