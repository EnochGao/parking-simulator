/* 低多边形车辆外观模型（本田飞度 第四代 GR9：4.109m × 1.694m × 1.537m）
 * 尺寸基准取自 js/config.js 的 CAR（浏览器端 PS.CAR），缺省时用同一组飞度数值兜底 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.PS = root.PS || {}; root.PS.CarModel = api; }
})(typeof self !== 'undefined' ? self : this, function () {

  var COLORS = [0xb8bcc4, 0x8a9099, 0x5b6470, 0xc9c19b, 0x7a8b9e, 0x9c8f7f, 0x6e7d6a, 0xa05a4e];

  /* 飞度几何（与 config.js CAR 保持一致；前悬0.84/后悬0.74，轮胎 185/60 R15） */
  var CAR = (typeof self !== 'undefined' && self.PS && self.PS.CAR) ||
    { length: 4.109, width: 1.694, wheelbase: 2.53, trackF: 1.48, trackR: 1.465, tireR: 0.3015, frontOverhang: 0.84 };
  var L = CAR.length, W = CAR.width, WB = CAR.wheelbase;
  var FRONT_OH = CAR.frontOverhang != null ? CAR.frontOverhang : 0.84;
  var AXLE_F = L / 2 - FRONT_OH;    // 前轴 z（前悬 0.84m）
  var AXLE_R = AXLE_F - WB;         // 后轴 z（后悬 ≈0.74m）
  var HALF_F = CAR.trackF / 2, HALF_R = CAR.trackR / 2;
  var TIRE_R = CAR.tireR, TIRE_W = 0.185;

  function mat(color) { return new THREE.MeshLambertMaterial({ color: color }); }

  /* ---- 静态网格合并（mergeStatic）：把一棵对象树里的纯色 Mesh 拼成单 Mesh ----
   * 供两类场景消费：停放车（~19 件 → 1 件，镜面/倒影多遍渲染同步受益）与
   * 座舱静止内饰（~30 件 → 1 件）。材质颜色烘成顶点色，统一走一张
   * vertexColors Lambert 材质——多遍渲染时材质切换也随之归一。
   * 注意：只适合"静止且纯色 Lambert"的部件；贴图件/自发光件/动态件（如方向盘组、
   * 液晶屏）必须留在合并树之外。 */
  function mergeStatic(root) {
    root.updateMatrixWorld(true);
    var pos = [], nor = [], col = [], idx = [], off = 0;
    var c = new THREE.Color();
    root.traverse(function (n) {
      if (!n.isMesh) return;
      var m = Array.isArray(n.material) ? n.material[0] : n.material;
      c.copy(m.color);
      var g = n.geometry.clone().applyMatrix4(n.matrixWorld);
      var p = g.attributes.position, nn = g.attributes.normal;
      for (var i = 0; i < p.count; i++) {
        pos.push(p.getX(i), p.getY(i), p.getZ(i));
        nor.push(nn.getX(i), nn.getY(i), nn.getZ(i));
        col.push(c.r, c.g, c.b);
      }
      var gi = g.index;
      if (gi) { for (var j = 0; j < gi.count; j++) idx.push(gi.getX(j) + off); }
      else { for (var j2 = 0; j2 < p.count; j2++) idx.push(j2 + off); }
      off += p.count;
      g.dispose();   // 克隆体只作变换中转，拷贝完即弃
    });
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  }

  /** 车身主体：三段式车身 + 飞度式大座舱玻璃 + 车顶（两厢，短前悬长座舱）
   *  座舱段（z -0.35~0.70）地板下沉到 0.675 并铺深色内饰——低于方向盘轮缘最低点
   *  0.67，驾驶员俯视看到的是深色舱内地板；旧版座舱段与车头/车尾连成整块箱体，
   *  其浅色顶面（0.89）从方向盘四周一直铺到脚下，形成驾驶舱里的大片白色平面 */
  function buildBody(bodyM, glassM, roofLen, roofZ) {
    var g = new THREE.Group();
    var halfL = L / 2;
    var bodyF = new THREE.Mesh(new THREE.BoxGeometry(W, 0.55, halfL - 0.7), bodyM);
    bodyF.position.set(0, 0.565, (halfL + 0.7) / 2); bodyF.castShadow = true;
    g.add(bodyF);
    // 引擎盖：自 cowl 向车头下倾 3.4°（顶面 0.905→0.85）——飞度短车头，座舱内越过
    // 仪表台可见大片引擎盖；两侧各留 2cm 车身台阶，与真车 hood/fender 分缝一致
    var hood = new THREE.Mesh(new THREE.BoxGeometry(W - 0.04, 0.07, 0.92), bodyM);
    hood.position.set(0, 0.8425, 1.60); hood.rotation.x = 3.4 * Math.PI / 180; hood.castShadow = true;
    g.add(hood);
    var bodyR = new THREE.Mesh(new THREE.BoxGeometry(W, 0.6, halfL - 0.35), bodyM);
    bodyR.position.set(0, 0.59, -(halfL + 0.35) / 2); bodyR.castShadow = true;
    g.add(bodyR);
    var tub = new THREE.Mesh(new THREE.BoxGeometry(W, 0.37, 1.05), bodyM);
    tub.position.set(0, 0.475, 0.175); tub.castShadow = true;
    g.add(tub);
    // 深色舱内件共用一份材质（舱内地板 + 两条窗沿盖板——旧实现 3 处各建一份）。
    // 舱内地板：顶面 0.675，高于舱体顶面 0.66（完全遮盖车漆色台面）、
    // 低于方向盘轮缘最低点 0.682（轮盘完整可见）
    var darkM = mat(0x24262b);
    var tubFloor = new THREE.Mesh(new THREE.BoxGeometry(1.69, 0.02, 1.04), darkM);
    tubFloor.position.set(0, 0.665, 0.175);
    g.add(tubFloor);
    // 门框条：补齐座舱段两侧 0.66~0.89 的外板。内缘 0.647 与内饰门板（0.645~0.845）
    // 对齐埋入其内，避免车漆色立面暴露在驾驶员脚下视野；顶部深色盖板即车窗下沿饰线
    var stripG = new THREE.BoxGeometry(0.2, 0.23, 1.05);
    var capG = new THREE.BoxGeometry(0.2, 0.012, 1.05);
    [0.747, -0.747].forEach(function (sx) {
      var strip = new THREE.Mesh(stripG, bodyM);
      strip.position.set(sx, 0.775, 0.175); strip.castShadow = true;
      g.add(strip);
      var cap = new THREE.Mesh(capG, darkM);
      cap.position.set(sx, 0.896, 0.175);
      g.add(cap);
    });
    // GR9 前脸：大尺寸黑色下格栅
    var grille = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.14, 0.06), mat(0x1a1d21));
    grille.position.set(0, 0.42, L / 2); g.add(grille);
    var cabin = new THREE.Mesh(new THREE.BoxGeometry(W - 0.11, 0.56, 3.05), glassM);
    cabin.position.set(0, 1.17, -0.425); cabin.castShadow = true;
    g.add(cabin);
    var roof = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.06, roofLen), bodyM);
    roof.position.set(0, 1.48, roofZ);
    g.add(roof);
    return { g: g, roof: roof, cabin: cabin };
  }

  function buildWheels(g, seg, frontWheels) {
    var wheelG = new THREE.CylinderGeometry(TIRE_R, TIRE_R, TIRE_W, seg);
    var wheelM = mat(0x22252a);
    // 前后轮距不同（1480/1465mm），轴距按前后悬布置
    [[-HALF_F, AXLE_F], [HALF_F, AXLE_F], [-HALF_R, AXLE_R], [HALF_R, AXLE_R]].forEach(function (p, i) {
      var w = new THREE.Mesh(wheelG, wheelM);
      w.rotation.z = Math.PI / 2;
      if (frontWheels) {
        var pivot = new THREE.Group();
        pivot.position.set(p[0], TIRE_R, p[1]);
        pivot.add(w);
        g.add(pivot);
        if (i < 2) frontWheels.push(pivot);
      } else {
        w.position.set(p[0], TIRE_R, p[1]);
        g.add(w);
      }
    });
  }

  /** 构建静止停放车辆（供场景摆放）。
   *  部件拼装与玩家车同一套函数（几何数值单源），随后整体合并为单 Mesh——
   *  静止刚体无需逐件绘制：一辆车 1 次 draw call（主视图 + 镜面/倒影多遍渲染
   *  同步受益），部件升级只改 buildBody/buildWheels 一处，合并层自动跟随。 */
  function buildParkedCar(color, seed) {
    var g = new THREE.Group();
    color = color != null ? color : COLORS[(seed || 0) % COLORS.length];
    var bodyM = mat(color);
    var glassM = new THREE.MeshLambertMaterial({ color: 0x2b3540 });

    var parts = buildBody(bodyM, glassM, 2.05, -0.575);
    g.add(parts.g);
    buildWheels(g, 12);
    // 灯
    var hl = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.06), new THREE.MeshLambertMaterial({ color: 0xfff2c8 }));
    hl.position.set(-0.55, 0.72, L / 2 + 0.01); g.add(hl);
    var hr = hl.clone(); hr.position.x = 0.55; g.add(hr);
    var tl = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.16, 0.06), new THREE.MeshLambertMaterial({ color: 0xb33a2f }));
    tl.position.set(-0.60, 0.75, -L / 2 - 0.01); g.add(tl);
    var tr = tl.clone(); tr.position.x = 0.60; g.add(tr);

    var merged = mergeStatic(g);
    merged.castShadow = true;   // 车身件原集体投影，合并后整 Mesh 等效（轮/灯投影在车底阴影内不可辨）
    return merged;
  }

  /**
   * 构建玩家车：外观 + 转向提示（前轮随方向转）
   * 返回 {group, frontWheels:[...], brakeLights:[...], indicators:{l:[],r:[]}}
   */
  function buildPlayerCar() {
    var g = new THREE.Group();
    var bodyM = mat(0xd8dde4);
    var glassM = new THREE.MeshLambertMaterial({ color: 0x2b3540 });

    var parts = buildBody(bodyM, glassM, 2.05, -0.575);
    g.add(parts.g);
    // 外顶板：顶面 1.51（≈飞度 1.537m 含天线/饰条），前缘缩到 z=0.45（z>0.45 为风挡区域）——
    // 车内后视镜吊在车顶前缘正下方、贴着屏幕最上方，驾驶员视线从顶板前缘下方穿过不被遮挡
    var roof = parts.roof, cabin = parts.cabin;

    var frontWheels = [];
    buildWheels(g, 14, frontWheels);

    var hl = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.06), new THREE.MeshLambertMaterial({ color: 0xfff2c8 }));
    hl.position.set(-0.55, 0.72, L / 2 + 0.01); g.add(hl);
    var hr = hl.clone(); hr.position.x = 0.55; g.add(hr);

    var brakeM = new THREE.MeshLambertMaterial({ color: 0x5a1e18 });
    var bl = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.06), brakeM);
    bl.position.set(-0.58, 0.75, -L / 2 - 0.01); g.add(bl);
    var br = bl.clone(); br.position.x = 0.58; g.add(br);

    // 转向灯（车身左侧为 +x：与驾驶位 seatX=0.36、左外后视镜 +0.99 同侧）
    var indL = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.10, 0.18), new THREE.MeshLambertMaterial({ color: 0x7a5a00 }));
    indL.position.set(0.84, 0.72, 1.85); g.add(indL);
    var indR = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.10, 0.18), new THREE.MeshLambertMaterial({ color: 0x7a5a00 }));
    indR.position.set(-0.84, 0.72, 1.85); g.add(indR);

    return {
      group: g,
      cabin: cabin,
      roof: roof,  // 车顶板（车内后视镜渲染时隐藏，避免镜中一大片自家车顶）
      frontWheels: frontWheels,
      brakeLights: [bl, br],
      brakeOff: 0x5a1e18, brakeOn: 0xff4a30,
      indicators: { l: indL, r: indR },
      indOff: 0x7a5a00, indOn: 0xffb300
    };
  }

  return { buildParkedCar: buildParkedCar, buildPlayerCar: buildPlayerCar, mergeStatic: mergeStatic, COLORS: COLORS };
});
