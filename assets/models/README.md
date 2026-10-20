# 车辆 3D 资产（glTF 2.0）

程序化生成的停放车模型，与游戏内 `js/config.js` 的 `CAR`（飞度 GR9）尺寸同源。
每台车同时提供 **GLB 单文件**与 **glTF + .bin 分体版**（内容等价，按引擎喜好二选一）。

| 文件 | 内容 |
|---|---|
| `car_gr9.glb` / `.gltf` + `.bin` | 玩家车同款两厢（hatch）：4.109 × 1.694 × 1.537 m |
| `car_sedan.glb` / `.gltf` + `.bin` | 紧凑型三厢（sedan）：4.62 × 1.78 × 1.455 m |
| `car_suv.glb` / `.gltf` + `.bin` | 紧凑型 SUV：4.45 × 1.85 × 1.66 m |
| `wheel_185_60_r15.glb` / `.gltf` + `.bin` | 独立轮组（轮胎 + 轮辋 + 刹车盘，轮心为原点） |
| `car_ferrari.glb` | **导入的外部高模**（458 Spider，358 788 面 / 12.7 MB），敞篷、含完整内饰 |
| `car_bmw1m_rig.glb` | **导入的外部高模**（BMW 1M，104 376 面 / 6.65 MB）：四门、完整内饰、四轮独立；镜壳+镜片拆成 `Mirror_L/R`、方向盘 `SteeringWheel`，都带枢轴 |
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
| car_gr9 | 4.109 × 1.694 × 1.537 | 2.53 | 0.3015 | 9 026 | ~322 KB |
| car_sedan | 4.62 × 1.78 × 1.455 | 2.70 | 0.312 | 9 176 | ~324 KB |
| car_suv | 4.45 × 1.85 × 1.66 | 2.66 | 0.345 | 9 162 | ~327 KB |
| wheel_185_60_r15 | 轮径 0.603 | — | 0.3015 | 680 | ~21 KB |

车漆带 `KHR_materials_clearcoat`（清漆层，three.js/Blender 支持，不支持的引擎忽略）。

其中内饰约 2 400 面、贴图约 +45 KB；车身截面从 6 段加密到 9 段（腰线/轮拱更顺），
轮毂/轮胎 22 段、五辐镂空轮辋，轮拱内侧补了深色内衬，前格栅改为三条镀铬横条；
后视镜是沿车宽扫掠的流线壳体（不再是方盒），镜片内嵌在壳体背面，仍然是可调枢轴节点。

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

### 现在已经导入的示例

`car_ferrari.glb`：取 three.js 官方示例里的 458 Spider（`examples/models/gltf/ferrari.glb`），
处理链路如下，可作为你自己接车模的参照：

```bash
# 1) 源文件是 Draco 压缩，先解压（npx 临时工具，不写进项目依赖）
npx @gltf-transform/cli copy assets/models/incoming/ferrari.glb assets/models/incoming/ferrari_plain.glb
# 2) 归位：车头原本朝 -Z → --yaw 180；缩放到游戏车长 4.109m；材质改名；只出 GLB
npm run import:model -- assets/models/incoming/ferrari_plain.glb --name car_ferrari --glb-only \
  --yaw 180 --length 4.109 --manifest \
  --rename Body_Color=Paint --rename Glass_Gray=Glass --rename Tires=Tire \
  --rename Interior_dark=Cabin --rename metal_chrome=Chrome --rename Leather_red=Seat
```

结果：4.11 × 2.05 × 1.12 m、358 788 面、12.7 MB；4 个车轮节点（`wheel_fl/fr/rl/rr`）可滚动，
`steering_wheel` 节点存在，查看器据此推算坐姿眼点，车内视角可用。

`car_bmw1m_rig.glb`：用户提供的 Sketchfab 模型（FBX 转 GLB）。源模型按 5.10 m 长导出（单位偏大），
按 1M 真实车长归位；镜壳/方向盘由 `rig_model.js` 拆件加枢轴。完整链路：

```bash
# 1) 先拆件加枢轴（源文件坐标，未缩放）
node tools/rig_model.js assets/models/incoming/ac_-_bmw_1m_free.glb \
  --spec rig_bmw.json --out assets/models/incoming/bmw_rigged.glb
# 2) 再归位 + 材质对齐 + 写清单
npm run import:model -- assets/models/incoming/bmw_rigged.glb --name car_bmw1m_rig \
  --glb-only --length 4.36 --manifest \
  --rename LIVREA=Paint --rename VETRI_Nero=Glass --rename VETRI_Fanali=Glass \
  --rename RT_Battistrada=Tire --rename RT_rim=Rim --rename LOGHI_RIM=Rim \
  --rename INT_Skin=Seat --rename INT_Velluto=Seat --rename INT_Plaastica_NERA=Cabin \
  --rename INT_Display=Screen --rename MIRROR=MirrorGlass \
  --rename FANALI_Anteriori=HeadLamp --rename Fanali_POSTERIORI_TS=TailLamp
# 完整命令见 git 历史；材质共 40 个，基本都映射到 Paint/Glass/Cabin/Seat/Rim/Tire/Chrome/Trim
```

接入结果：4.36 × 1.97 × 1.42 m（宽含后视镜）、100 582 面、6.75 MB；四个轮组
`WHEEL_RR / WHEEL_RF / WHEEL_LR / WHEEL_LF` 是独立节点（注意它用 RF/LF 的写法，
查看器两种顺序都认），查看器自动补了前轮转向枢轴；内饰、座椅、iDrive 屏、安全带齐全；
后视镜玻璃是独立网格，但镜壳与车门同属一个网格，**不能单独转动**（游戏用自带镜面相机，不影响）。

> **注意**：这两个都是第三方模型，仅适合本地/学习验收；对外发行请换成有明确授权、
> 且不含车厂商标的模型。另外 10–35 万面对手机与微信小游戏过重——真正进游戏前需要
> 减面（`gltf-transform simplify` 对这种多材质硬表面模型效果有限）或走 Draco + 解码器。

## 拆件 / 加枢轴（`tools/rig_model.js`）

外部模型常见问题：后视镜、门把手和车门在**同一个网格对象**里，但几何上其实是各自独立的壳。
这个工具按**连通分量**把它们拆成独立节点，并把原点放到铰链/轮心，不改拓扑、不重画模型。

```bash
node tools/rig_model.js in.glb --spec rig.json --out out.glb
# rig.json
{
  "extract": [
    { "from": "polymsh_detached29_SUB1_LIVREA_0",     // 从哪个网格里拆
      "name": "Mirror_L",                              // 新节点名
      "center": [1.04, 1.18, 0.48], "radius": 0.18,    // 选中包围盒中心落在球内的连通块
      "pivot": [0.93, 1.18, 0.48],                     // 枢轴（世界坐标，这里是镜脚）
      "attach": ["polymsh_detached29_SUB2_MIRROR_0"] } // 镜片一起挂到新节点下
  ],
  "pivot": [
    { "node": "polymsh258_SUB1_INT_Plaastica_NERA_0",  // 本来就独立的零件
      "name": "SteeringWheel", "pivot": [0.42, 1.02, 0.28] }
  ]
}
```

- **能拆的前提**：这块几何是独立壳（顶点不与别处共享）。工具会打印每个连通块的面数/中心，先跑一次就知道。
- **拆不了的**：真正焊死（共享顶点、连续曲面）的几何——那只能在 Blender 里做拓扑切割；
  只存在于贴图里的细节（比如码表指针）——几何上没有，只能换贴图或游戏叠加 HUD。
- 拆完节点会自动加 `extras: { kind: "pivot", axis }`，并保留原网格的其余部分。

`car_bmw1m_rig.glb` 就是用它做的：从车门网格里拆出 298 面的镜壳，和 32 面的镜片一起挂到
`Mirror_L / Mirror_R`（枢轴在镜脚），方向盘 `SteeringWheel` 补枢轴；查看器里已实测：
掰后视镜、转方向盘都是整体转动。

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
