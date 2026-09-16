/* 低多边形车辆外观模型（停车用小两厢车，4.2m × 1.75m） */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.PS = root.PS || {}; root.PS.CarModel = api; }
})(typeof self !== 'undefined' ? self : this, function () {

  var COLORS = [0xb8bcc4, 0x8a9099, 0x5b6470, 0xc9c19b, 0x7a8b9e, 0x9c8f7f, 0x6e7d6a, 0xa05a4e];

  function mat(color) { return new THREE.MeshLambertMaterial({ color: color }); }

  /** 构建静止停放车辆（供场景摆放） */
  function buildParkedCar(color, seed) {
    var g = new THREE.Group();
    color = color != null ? color : COLORS[(seed || 0) % COLORS.length];
    var bodyM = mat(color);
    var glassM = new THREE.MeshLambertMaterial({ color: 0x2b3540 });

    var body = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.52, 4.1), bodyM);
    body.position.y = 0.55; body.castShadow = true;
    g.add(body);
    var cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 2.3), glassM);
    cabin.position.set(0, 1.02, -0.15); cabin.castShadow = true;
    g.add(cabin);
    var roof = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 1.9), bodyM);
    roof.position.set(0, 1.3, -0.15);
    g.add(roof);
    // 车轮
    var wheelG = new THREE.CylinderGeometry(0.31, 0.31, 0.22, 12);
    var wheelM = mat(0x22252a);
    [[-0.78, 1.32], [0.78, 1.32], [-0.78, -1.32], [0.78, -1.32]].forEach(function (p) {
      var w = new THREE.Mesh(wheelG, wheelM);
      w.rotation.z = Math.PI / 2;
      w.position.set(p[0], 0.31, p[1]);
      g.add(w);
    });
    // 灯
    var hl = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.14, 0.06), new THREE.MeshLambertMaterial({ color: 0xfff2c8 }));
    hl.position.set(-0.55, 0.62, 2.06); g.add(hl);
    var hr = hl.clone(); hr.position.x = 0.55; g.add(hr);
    var tl = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.14, 0.06), new THREE.MeshLambertMaterial({ color: 0xb33a2f }));
    tl.position.set(-0.55, 0.62, -2.06); g.add(tl);
    var tr = tl.clone(); tr.position.x = 0.55; g.add(tr);
    return g;
  }

  /**
   * 构建玩家车：外观 + 转向提示（前轮随方向转）
   * 返回 {group, frontWheels:[...], brakeLights:[...], indicators:{l:[],r:[]}}
   */
  function buildPlayerCar() {
    var g = new THREE.Group();
    var bodyM = mat(0xd8dde4);
    var glassM = new THREE.MeshLambertMaterial({ color: 0x2b3540 });

    var body = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.52, 4.1), bodyM);
    body.position.y = 0.55; body.castShadow = true;
    g.add(body);
    var cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 2.3), glassM);
    cabin.position.set(0, 1.02, -0.15); cabin.castShadow = true;
    g.add(cabin);
    var roof = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 1.9), bodyM);
    roof.position.set(0, 1.3, -0.15);
    g.add(roof);

    var wheelG = new THREE.CylinderGeometry(0.31, 0.31, 0.22, 14);
    var wheelM = mat(0x22252a);
    var frontWheels = [];
    [[-0.78, 1.32], [0.78, 1.32], [-0.78, -1.32], [0.78, -1.32]].forEach(function (p, i) {
      var pivot = new THREE.Group();
      pivot.position.set(p[0], 0.31, p[1]);
      var w = new THREE.Mesh(wheelG, wheelM);
      w.rotation.z = Math.PI / 2;
      pivot.add(w);
      g.add(pivot);
      if (i < 2) frontWheels.push(pivot);
    });

    var hl = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.14, 0.06), new THREE.MeshLambertMaterial({ color: 0xfff2c8 }));
    hl.position.set(-0.55, 0.62, 2.06); g.add(hl);
    var hr = hl.clone(); hr.position.x = 0.55; g.add(hr);

    var brakeM = new THREE.MeshLambertMaterial({ color: 0x5a1e18 });
    var bl = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.15, 0.06), brakeM);
    bl.position.set(-0.54, 0.62, -2.06); g.add(bl);
    var br = bl.clone(); br.position.x = 0.54; g.add(br);

    // 转向灯
    var indL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.2), new THREE.MeshLambertMaterial({ color: 0x7a5a00 }));
    indL.position.set(-0.86, 0.62, 1.9); g.add(indL);
    var indR = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.2), new THREE.MeshLambertMaterial({ color: 0x7a5a00 }));
    indR.position.set(0.86, 0.62, 1.9); g.add(indR);

    return {
      group: g,
      cabin: cabin,
      frontWheels: frontWheels,
      brakeLights: [bl, br],
      brakeOff: 0x5a1e18, brakeOn: 0xff4a30,
      indicators: { l: indL, r: indR },
      indOff: 0x7a5a00, indOn: 0xffb300
    };
  }

  return { buildParkedCar: buildParkedCar, buildPlayerCar: buildPlayerCar, COLORS: COLORS };
});
