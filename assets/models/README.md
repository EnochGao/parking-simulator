# 车辆 3D 资产（glTF 2.0）

程序化生成的停放车模型，与游戏内 `js/config.js` 的 `CAR`（飞度 GR9）尺寸同源。
每台车同时提供 **GLB 单文件**与 **glTF + .bin 分体版**（内容等价，按引擎喜好二选一）。

| 文件 | 内容 |
|---|---|
| `car_gr9.glb` / `.gltf` + `.bin` | 玩家车同款两厢（hatch）：4.109 × 1.694 × 1.537 m |
| `car_sedan.glb` / `.gltf` + `.bin` | 紧凑型三厢（sedan）：4.62 × 1.78 × 1.455 m |
| `car_suv.glb` / `.gltf` + `.bin` | 紧凑型 SUV：4.45 × 1.85 × 1.66 m |
| `wheel_185_60_r15.glb` / `.gltf` + `.bin` | 独立轮组（轮胎 + 轮辋 + 刹车盘，轮心为原点） |
| `manifest.json` | 车型清单：尺寸、轴距、轮径、驾驶位眼点、材质/节点名、三角面、包围盒 |
| `viewer.html` | 零依赖预览器（three.js + 内置迷你 glTF 载入器）：车漆/线框/转轮/打方向/车内视角 |

## 坐标与单位约定

- 1 单位 = 1 米；`+Y` 向上；`+Z` 为车头（与游戏内前进方向一致），`+X` 为车左侧（左舵驾驶位在 `+X`）。
- 根节点原点 = 车辆中心的地面投影（`y = 0` 即地面），换车无需再对齐。
- 车轮节点原点在**轮心**，绕局部 `X` 轴滚动；前轮外面再套一层 `WheelSteer_*` 枢轴，绕局部 `Y` 轴转向。
- 后视镜 `Mirror_L / Mirror_R` 为枢轴节点，绕局部 `Y` 轴调角。

节点名（三台车一致）：

```
car_gr9
├─ Body / Glass / Trim / Chrome
│  HeadLamp / TailLamp / PlateF / PlateR / Indicator_L / Indicator_R
├─ Cabin / Seats / Carpet / Screens / SteeringWheel        ← 座舱内饰
├─ Mirror_L (枢轴) ─ Mirror_L_Cap / Mirror_L_Glass
├─ Mirror_R (枢轴) ─ Mirror_R_Cap / Mirror_R_Glass
├─ WheelSteer_FL (枢轴 Y) ─ Wheel_FL (滚动 X)
├─ WheelSteer_FR (枢轴 Y) ─ Wheel_FR (滚动 X)
├─ Wheel_RL (滚动 X)
└─ Wheel_RR (滚动 X)
```

材质名固定，运行时可直接按名取：`Paint`（漆面/镜壳，改色即多色停放车）、`Glass`、
`Trim`、`Chrome`、`HeadLamp`、`TailLamp`、`Indicator`（自发光）、`Tire`、`Rim`、
`BrakeDisc`、`MirrorGlass`、`Plate`，以及内饰的 `Cabin`（软质台面/门板）、`Fabric`（织物）、
`Carpet`、`Screen`（中控/仪表屏）、`Leather`（方向盘/扶手）。

`Fabric / Carpet / Cabin / Leather` 带**内嵌程序化贴图**（64×64 PNG 写在 bufferView 里，
盒式投影 UV，织物有织纹、地毯有颗粒、塑料有细噪点）。读取时按普通 `baseColorTexture` 处理即可。

## 座舱 / 车内视角

车身在腰线处按座舱范围真实开口（A 柱到 C 柱之间），内部是一套曲面放样内饰：

- **仪表台**：沿 X 扫掠的软质台体（上沿圆弧过渡、两端收口），带仪表罩、除霜风口、出风槽、镀铬饰条；
- **中控台**：向驾驶员凸出的竖面 + 悬浮屏 + 按键排 + 扶手箱 + 换挡杆 + 手刹；
- **方向盘**：24 段圆环轮缘 + 镀铬圈 + 三辐 + 气囊盖，后倾 24°，带转向柱；
- **座椅**：坐垫/靠背/头枕三段放样（前两张 + 后排长凳），带座椅导轨；
- **门板**：五段贴合车身内壁的面板 + 扶手 + 内拉手 + 喇叭；
- **结构件**：地毯 + 中央通道鼓包 + 脚踏板区、前围/后隔板、A/B/C 柱内饰板、顶棚、
  风挡上沿 + 遮阳板 + 车内后视镜（带支臂）、油门/刹车/歇脚踏板。

驾驶位眼点写在 `manifest.json` 的 `driverEye`（左舵，`x = W×0.212`、`y = H×0.775`、`z = -0.02`），
相机放在该点朝 `+Z` 即为标准驾驶视角。查看器里点「车内视角」即可切换，拖拽 = 转头、
滚轮 = 改视野（FOV 36°–84°），双击复位。

> 车内视角下查看器会**隐藏 Glass**：透明外壳叠加环境反射会在视野里糊一层灰膜，
> 这是预览器的取舍，模型本身玻璃仍在。

## 规格

| 车型 | 长×宽×高 (m) | 轴距 (m) | 轮胎半径 (m) | 三角面 | 体积 |
|---|---|---|---|---|---|
| car_gr9 | 4.109 × 1.694 × 1.537 | 2.53 | 0.3015 | 7 466 | ~370 KB |
| car_sedan | 4.62 × 1.78 × 1.455 | 2.70 | 0.312 | 7 556 | ~371 KB |
| car_suv | 4.45 × 1.85 × 1.66 | 2.66 | 0.345 | 7 566 | ~374 KB |
| wheel_185_60_r15 | 轮径 0.603 | — | 0.3015 | 582 | ~19 KB |

其中内饰约 2 400 面，贴图约 +45 KB。

## 重新生成

```bash
npm run build:models            # 生成 GLB + glTF/bin + manifest.json
npm run build:models -- --check # 生成并校验（结构、对齐、包围盒 vs 标称尺寸）
npm run build:models -- --only hatch   # 只出飞度（hatch|sedan|suv|wheel）
npm run build:models -- --out dist    # 换输出目录
```

尺寸/造型参数都在 `tools/gen_models.js` 顶部的 `STYLES`（顶部/底部/宽度剖面、
座舱剖面、轮胎与轴距）；内饰在 `buildCar` 的 5.11 段，贴图在文件开头的 `TEXTURES`。
改完重跑即可，校验不通过会以非零码退出。

## 预览

```bash
npm start
# → http://localhost:8137/assets/models/viewer.html
```

查看器是白天外景（渐变天空 + 混凝土场地 + 阴影），支持车型切换、GLB / glTF+bin 切换、
车漆色板、线框、车轮滚动、前轮打方向、自动环绕、车内视角、拖拽旋转 / 滚轮缩放。
`file://` 下无法 `fetch`，必须走本地服务器。

`/assets/models/` 已在 `sw.js` 里排除出缓存（可在编辑器里随时重新生成，不必纠结旧版本）。

## 接入外部车模（美术资产）

程序化模型是兜底。要照片级写实，直接把美术做的 GLB 接进来，工具负责归位：

```bash
# 1) 把车模放到任意位置（例：assets/models/incoming/civic.glb）
# 2) 归位（缩放/旋转/落地/写清单）
npm run import:model -- assets/models/incoming/civic.glb --name car_civic --length 4.109 --manifest
#    车头朝 -Z 或 +X 时加 --yaw 180 / 90 / -90；Z-up 的 CAD 导出加 --up Z
#    材质名不统一时逐个映射：--rename body=Paint --rename windows=Glass
```

- 只体检不改文件：`--inspect`（打印尺寸、包围盒、节点树、材质名）。
- 输出 `car_civic.glb / .gltf / .bin`，并在 `manifest.json` 里加一条 `imported: true`
  （下次 `npm run build:models` 会保留这条，不会覆盖）。
- 预览：`npm start` → 查看器里直接选这个车型；或点面板上的「**打开本地 GLB…**」
  临时拖一个文件进来看看（不入库），车内视角会按尺寸自动估算驾驶位眼点。

**导出前在自己 DCC 里对齐这几条，接入最省事：**

| 项 | 要求 |
|---|---|
| 轴向 | `+Y` 向上、`+Z` 车头（车头方向不一致就用 `--yaw` 转） |
| 单位 | 米；所有变换已应用（Apply All Transforms） |
| 原点 | 车身中心的地面投影（0 = 地面），不是几何中心也可以，工具会平移到地面 |
| 轮组 | 四个轮子各自是独立网格/空物体，命名 `Wheel_FL / FR / RL / RR`；前轮外套 `WheelSteer_FL / FR` |
| 材质名 | `Paint`（车漆）、`Glass`、`Tire`、`Rim`、`Trim`、`Chrome`、`HeadLamp`、`TailLamp`；其余自便 |
| 面数 | 停放车 ≤ 30k、玩家车 ≤ 60k 比较稳；内饰与外观可以做成两个网格 |

轮子如果焊在车身上，`Wheel_*` 节点不存在，游戏里就转不了——这种情况在 Blender 里按轮心
分离成四个对象再导出即可。

## 接入示例（three.js）

```js
const loader = new THREE.GLTFLoader();
loader.load('assets/models/car_gr9.glb', (gltf) => {
  const car = gltf.scene;

  // 车漆改色（注意 clone 材质，否则所有实例一起变色）
  car.traverse((o) => {
    if (o.isMesh && o.material.name === 'Paint') {
      o.material = o.material.clone();
      o.material.color.setHex(0x7a8b9e).convertSRGBToLinear();
    }
  });

  const wheels = [], steers = [];
  car.traverse((o) => {
    if (/^Wheel_(FL|FR|RL|RR)$/.test(o.name)) wheels.push(o);
    if (/^WheelSteer_/.test(o.name)) steers.push(o);
  });

  function update(dt, speed, steerAngle) {
    wheels.forEach((w) => { w.rotation.x += (speed / 0.3015) * dt; });
    steers.forEach((s) => { s.rotation.y = steerAngle; });
  }
});
```

停放车批量摆放：同一模型 `clone()` 后只改各实例的 `Paint` 材质颜色即可；
若要压 draw call，可沿用 `js/carModel.js` 的 `mergeStatic` 思路——把车漆烘进顶点色、
其余部件按材质合并，但轮组/后视镜等动态件要留在合并树之外。

透明件（`Glass`、`MirrorGlass`）建议 `castShadow = false`，否则整块前风挡会在引擎盖和座舱里压出死黑。

## 写实度的边界

这套资产是**程序化低模**（7.5k 面、无扫描材质、无烘焙 AO/法线），观感相当于
2010 年前后的游戏车：造型比例、座舱结构、材质区分到位，但做不到照片级写实。
要再往上走，只有两条路：

1. **换成美术资产**：把专业建模（含内饰、法线/AO 贴图）的 GLB 放进本目录，
   本工具链的节点/材质命名可以直接对齐（`Paint`、`Wheel_*`、`WheelSteer_*`）；
2. **继续加密**：提高放样段数、给车身做法线/曲率贴图、给座舱做 AO 烘焙——面数与工时都会翻数倍。
