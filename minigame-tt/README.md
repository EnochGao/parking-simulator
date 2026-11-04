# 抖音小游戏工程（tools/build_tt.js 生成，勿手改）

## 结构（与微信包同源，仅宿主 API 经 platform.js 路由到 tt.*）
- `game.js` 入口 / `libs/three.min.js` / `js/*.js` 与 minigame/ 完全同构，
  差异收口在 `js/platform.js`（音频 tt.getAudioContext、无 onWindowResize 等）
- `game.json` 两端字段同形（deviceOrientation=landscape 锁横屏）

## 使用
- 抖音开发者工具「导入项目」选本目录；导入前在 project.config.json 换成你的
  抖音小游戏 appid（tt 开头），或导入时在 IDE 里选择
- 逻辑冒烟（Node，无需开发者工具）：`npm run test:tt`
- 包体：全包约 1MB，抖音限制主包 4MB / 总包 20MB，余量充足无需分包
- 提审前待办：软著材料（可与微信复用）、小游戏备案、必接能力（客服/敏感词/侧边栏复访）
- 真机验证项：WebGL1 上下文、tt.getAudioContext 振荡器/增益节点、双指拧镜头触摸
