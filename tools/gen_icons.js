/* PWA 图标生成（零依赖：zlib 内置模块手写 PNG 编码，方向盘图案算法光栅化）
 * 运行：node tools/gen_icons.js   → icons/icon-192.png + icons/icon-512.png
 * 图案与 UI 同源：深底 + 浅色轮缘/辐条 + 绿色轮毂。2x 超采样抗锯齿。 */
'use strict';
var fs = require('fs');
var path = require('path');
var zlib = require('zlib');

/* ---- PNG 编码（RGBA8，无滤波，deflate 压缩） ---- */
var CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = [];
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      CRC_TABLE[n] = c >>> 0;
    }
  }
  var c = 0xFFFFFFFF;
  for (var i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  var len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  var body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  var crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePNG(size, pixels) {
  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type: RGBA
  var stride = size * 4 + 1;
  var raw = Buffer.alloc(size * stride);
  for (var y = 0; y < size; y++) {
    raw[y * stride] = 0;   // filter: none
    pixels.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---- 方向盘图案光栅化（与 tc-wheel 视觉同源） ---- */
function render(size) {
  var S = 2;   // 超采样倍率
  var n = size * S;
  var px = Buffer.alloc(size * size * 4);
  var BG = [20, 22, 26], RING = [232, 234, 238], HUB = [111, 214, 111];
  var cx = n / 2, cy = n / 2;
  var rOut = n * 0.40, rIn = n * 0.29;
  var total = S * S;
  for (var y = 0; y < size; y++) {
    for (var x = 0; x < size; x++) {
      var hitRing = 0, hitSpoke = 0, hitHub = 0;
      for (var sy = 0; sy < S; sy++) {
        for (var sx = 0; sx < S; sx++) {
          var pxs = x * S + sx + 0.5, pys = y * S + sy + 0.5;
          var dx = pxs - cx, dy = pys - cy;
          var d = Math.sqrt(dx * dx + dy * dy);
          if (d >= rIn && d <= rOut) hitRing++;
          else if (d < rIn) {
            if (d < rIn * 0.24) hitHub++;
            else if (Math.abs(dx) <= rIn * 0.96 && Math.abs(dy) <= rIn * 0.11) hitSpoke++;        // 左右横辐条
            else if (dy >= 0 && dy <= rIn * 0.62 && Math.abs(dx) <= rIn * 0.11) hitSpoke++;       // 下辐条
          }
        }
      }
      var i = (y * size + x) * 4;
      var c = BG;
      if (hitHub / total > 0.5) c = HUB;
      else if (hitRing / total > 0.4 || hitSpoke / total > 0.4) c = RING;
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
    }
  }
  return px;
}

var outDir = path.join(__dirname, '..', 'icons');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
[192, 512].forEach(function (size) {
  var p = path.join(outDir, 'icon-' + size + '.png');
  fs.writeFileSync(p, encodePNG(size, render(size)));
  console.log(p + '  ' + (fs.statSync(p).size / 1024).toFixed(1) + ' KB');
});
