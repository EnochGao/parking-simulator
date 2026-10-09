# 微信小游戏包（生成目录）

- `game.js` 由 `node tools/build_wx.js` 生成，**勿手改**（源码在 `js/`，改动后重新构建）
- 用微信开发者工具「导入项目」选择本目录；appid 先用体验用 touristappid，
  正式提审前在 project.config.json 换成你的小游戏 appid
- 逻辑冒烟（Node，无需开发者工具）：`node tools/build_wx.js --smoke && node tests/wx_bundle_test.js`
- UI 预览（桌面浏览器直接点按）：`debug_wxui.html`
- 待办（提审前）：软著材料、小游戏备案、（可选）激励视频 SDK 接入位在 ui_wx 结算页
