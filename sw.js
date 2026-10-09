/* 停车大师 Service Worker：应用外壳缓存优先，离线可玩（PWA 规划项落地）
 * 策略：install 预缓存全部静态资源；fetch 同源 GET 缓存优先、网络回填；
 * 导航请求离线兜底 index.html。发版改 CACHE 版本号（旧缓存 activate 时清理）。
 * 注意：ASSETS 与 index.html 引用保持一致——tests/run_all.js 有一致性校验。 */
'use strict';
var CACHE = 'parkmaster-v1.5.0';
var ASSETS = [
  './',
  './index.html',
  './style.css',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './vendor/three.min.js',
  './js/platform.js',
  './js/config.js',
  './js/physics.js',
  './js/collision.js',
  './js/scoring.js',
  './js/pulse.js',
  './js/sim.js',
  './js/demo_paths.js',
  './js/level_kit.js',
  './js/levels/basic.js',
  './js/levels/advanced.js',
  './js/levels/challenge.js',
  './js/levels.js',
  './js/autopilot.js',
  './js/progress.js',
  './js/input.js',
  './js/textures.js',
  './js/carModel.js',
  './js/world.js',
  './js/cockpit.js',
  './js/mirror_check.js',
  './js/cockpit_check.js',
  './js/assist.js',
  './js/hud.js',
  './js/gamepad.js',
  './js/ui.js',
  './js/carRig.js',
  './js/game.js',
  './js/main.js'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      return fetch(e.request).then(function (resp) {
        try {
          var url = new URL(e.request.url);
          if (resp.ok && url.origin === self.location.origin) {
            var copy = resp.clone();
            caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
          }
        } catch (err) { /* 非标准 URL 直接透传 */ }
        return resp;
      }).catch(function () {
        return caches.match('./index.html');
      });
    })
  );
});
