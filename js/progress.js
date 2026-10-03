/* 进度与存档（唯一持久化入口）：读档/写档/解锁链/续玩目标/下一关
 * 此前存档读写散在 hud.js（视图层里写 localStorage）、解锁链在选关界面、
 * 续玩目标在 game.js——三处各持一份逻辑。收编后 hud 只管画，game 只管流转。
 * storage 可注入（Node 单测传内存实现）；数据形状 { levels: { id: {stars,best} } }，
 * 读档时做形状归一，后续新增玩法进度（剧情章节等）在此扩展字段。 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.PS = root.PS || {}; root.PS.Progress = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  var STORAGE_KEY = 'parkmaster_v1';

  function defaultStorage() {
    try { return typeof localStorage !== 'undefined' ? localStorage : null; }
    catch (e) { return null; }
  }

  /** 读档并归一形状（坏档/无档返回空进度，不抛错） */
  function load(storage) {
    storage = storage || defaultStorage();
    var data = null;
    if (storage) {
      try { data = JSON.parse(storage.getItem(STORAGE_KEY)); } catch (e) { data = null; }
    }
    data = data || {};
    if (!data.levels || typeof data.levels !== 'object') data.levels = {};
    return data;
  }

  function save(data, storage) {
    storage = storage || defaultStorage();
    if (storage) {
      try { storage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) {}
    }
    return data;
  }

  /** 结算落档：保留最高星与最好成绩，返回该关最新记录 */
  function record(levelId, result, storage) {
    var data = load(storage);
    var rec = data.levels[levelId] || { stars: 0, best: 0 };
    if (result.stars > rec.stars) rec.stars = result.stars;
    if (result.score > (rec.best || 0)) rec.best = result.score;
    data.levels[levelId] = rec;
    save(data, storage);
    return rec;
  }

  /** 是否任意关卡拿过星（"继续训练"入口的显示条件） */
  function anyStars(storage) {
    var levels = load(storage).levels;
    for (var k in levels) if (levels[k] && levels[k].stars > 0) return true;
    return false;
  }

  /** 续玩目标：进度链里第一个未拿星的关卡（全通关则为最后一关） */
  function continueTarget(levels, storage) {
    var prog = load(storage).levels;
    var target = null;
    levels.forEach(function (lv) {
      var rec = prog[lv.id];
      if (!target && !(rec && rec.stars > 0)) target = lv;
    });
    return target || levels[levels.length - 1] || null;
  }

  /**
   * 选关数据：给视图画的扁平列表 [{lv, unlocked, stars, best}]。
   * 解锁规则：顺序解锁（前一关拿星解锁下一关）；opts.unlockAll 全开（自由练习）
   */
  function unlockMap(levels, opts) {
    opts = opts || {};
    var prog = load(opts.storage).levels;
    var unlockedAll = !!opts.unlockAll;
    var prevDone = true;
    return levels.map(function (lv) {
      var rec = prog[lv.id];
      var unlocked = unlockedAll || prevDone;
      prevDone = prevDone && !!(rec && rec.stars > 0);
      return { lv: lv, unlocked: unlocked, stars: rec ? rec.stars : 0, best: rec ? (rec.best || 0) : 0 };
    });
  }

  /** 线性下一关（无则 null） */
  function next(levels, lv) {
    var idx = levels.indexOf(lv);
    return idx >= 0 && idx < levels.length - 1 ? levels[idx + 1] : null;
  }

  return {
    load: load, save: save, record: record,
    anyStars: anyStars, continueTarget: continueTarget,
    unlockMap: unlockMap, next: next
  };
});
