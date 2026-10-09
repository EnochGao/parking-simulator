/* js/textures.js · 微信小游戏模块（tools/build_wx.js 生成，勿手改） */
var window = GameGlobal, self = GameGlobal;   /* UMD 根 → 跨模块共享全局 */
var module, exports, define;                  /* 声明以捕获外层泄露 */
module = exports = define = undefined;        /* 强制浏览器分支（var 对参数式包装无效） */
/* 程序化贴图（Canvas 生成，零外部资源，file:// 兼容） */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.PS = root.PS || {}; root.PS.Textures = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  function canvas(size) {
    /* 离屏画布来源 platform（网页 document.createElement / 小游戏 wx.createCanvas；
     * platform 先于本模块加载）。惰性调用：屏幕画布在此之前已由 game.js 创建 */
    var PLAT = (typeof window !== 'undefined' && window.PS && window.PS.Platform) ||
               (typeof self !== 'undefined' && self.PS && self.PS.Platform);
    var c = PLAT ? PLAT.createCanvas() : document.createElement('canvas');
    c.width = c.height = size;
    return c;
  }
  function tex(c, rx, ry) {
    var t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx || 1, ry || 1);
    t.anisotropy = 4;
    return t;
  }
  function noise(ctx, size, alpha, light) {
    for (var i = 0; i < size * size * 0.08; i++) {
      var g = Math.floor(Math.random() * 60);
      ctx.fillStyle = 'rgba(' + (light ? 255 - g : g) + ',' + (light ? 255 - g : g) + ',' + (light ? 255 - g : g) + ',' + alpha + ')';
      ctx.fillRect(Math.random() * size, Math.random() * size, 1.5, 1.5);
    }
  }

  function asphalt() {
    var s = 256, c = canvas(s), x = c.getContext('2d');
    x.fillStyle = '#3a3d42'; x.fillRect(0, 0, s, s);
    noise(x, s, 0.25, false);
    noise(x, s, 0.12, true);
    return c;
  }
  function brick() {
    var s = 256, c = canvas(s), x = c.getContext('2d');
    x.fillStyle = '#8f8577'; x.fillRect(0, 0, s, s); // 灰浆
    var bh = 22, bw = 52;
    for (var r = 0; r * bh < s; r++) {
      for (var col = -1; col * bw < s + bw; col++) {
        var off = (r % 2) * bw / 2;
        var shade = 150 + Math.floor(Math.random() * 40);
        x.fillStyle = 'rgb(' + shade + ',' + (shade - 45) + ',' + (shade - 55) + ')';
        x.fillRect(col * bw + off + 2, r * bh + 2, bw - 4, bh - 4);
      }
    }
    noise(x, s, 0.15, false);
    return c;
  }
  function windows() {
    var s = 256, c = canvas(s), x = c.getContext('2d');
    x.fillStyle = '#b5afa2'; x.fillRect(0, 0, s, s);
    noise(x, s, 0.1, false);
    for (var r = 0; r < 5; r++) {
      for (var col = 0; col < 4; col++) {
        var lit = Math.random() > 0.55;
        x.fillStyle = lit ? 'rgba(255,230,150,0.95)' : 'rgba(60,70,85,0.95)';
        x.fillRect(col * 64 + 14, r * 52 + 12, 36, 30);
        x.strokeStyle = 'rgba(70,70,70,0.9)'; x.lineWidth = 2;
        x.strokeRect(col * 64 + 14, r * 52 + 12, 36, 30);
      }
    }
    return c;
  }
  function concrete() {
    var s = 128, c = canvas(s), x = c.getContext('2d');
    x.fillStyle = '#b9b6ae'; x.fillRect(0, 0, s, s);
    noise(x, s, 0.15, false);
    noise(x, s, 0.1, true);
    return c;
  }
  function grass() {
    var s = 128, c = canvas(s), x = c.getContext('2d');
    x.fillStyle = '#5d7a45'; x.fillRect(0, 0, s, s);
    for (var i = 0; i < 900; i++) {
      var g = 90 + Math.floor(Math.random() * 60);
      x.fillStyle = 'rgba(' + (g - 40) + ',' + g + ',' + (g - 50) + ',0.5)';
      x.fillRect(Math.random() * s, Math.random() * s, 2, 3);
    }
    return c;
  }

  /** 创建共享贴图集合 */
  function createTextures() {
    return {
      asphalt: tex(asphalt(), 30, 30),
      brick: tex(brick(), 1, 1),
      windows: tex(windows(), 1, 1),
      concrete: tex(concrete(), 2, 2),
      grass: tex(grass(), 3, 3)
    };
  }

  return { createTextures: createTextures };
});