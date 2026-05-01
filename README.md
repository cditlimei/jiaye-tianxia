# 家业天下

三国题材竖屏经营策略 Web 游戏原型。项目使用 React + TypeScript + Vite 实现，前端单页运行，无后端依赖，核心进度保存在 `localStorage`。

## 开发命令

```bash
npm install
npm run dev
npm run build
npm run smoke
```

## 发布地址

推送到 `main` 后，GitHub Actions 会自动构建并更新 `gh-pages` 分支。仓库 Pages 发布源选择 `gh-pages / root` 后，访问：

https://cditlimei.github.io/jiaye-tianxia/

## 运行说明

- 图片通过 `https://raw.githubusercontent.com/cditlimei/jiaye-tianxia/main` 读取，并统一使用 `wsrv.nl` 做移动端压缩。
- 音频和视频按触发节点从 GitHub raw 地址加载，失败时不会阻断主流程。
- 完整流程包含标题页、主公选择、主城经营、伴侣招募、兵器库、自动回合战斗和战斗结算。
- 主城包含家业目标、府中纪事、离线收益结算、设置面板与本地存档恢复。
