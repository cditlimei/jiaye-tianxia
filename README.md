# 家业天下

三国题材竖屏经营策略 Web 游戏原型。项目使用 React + TypeScript + Vite 实现，前端单页运行，无后端依赖，核心进度保存在 `localStorage`。

## 开发命令

```bash
npm install
npm run assets:optimize
npm run dev
npm run build
npx playwright install chromium
npm run smoke
npm run smoke:live
```

## 发布地址

推送到 `main` 后，GitHub Actions 会自动构建并更新 `gh-pages` 分支。仓库 Pages 发布源选择 `gh-pages / root` 后，访问：

https://cditlimei.github.io/jiaye-tianxia/

## 运行说明

- 原始图片保留在 `assets/`，运行时读取 `public/optimized/` 里的本地压缩图；新增或替换素材后运行 `npm run assets:optimize` 重新生成。
- 音频和视频按触发节点从 GitHub raw 地址加载，失败时不会阻断主流程。
- 完整流程包含标题页、主公选择、主城经营、伴侣招募、兵器库、自动回合战斗和战斗结算。
- 主城包含家业目标、府中纪事、离线收益结算、设置面板与本地存档恢复。
- 设置面板支持复制存档、粘贴 JSON 导入存档，并会校验角色、伴侣、兵器、任务与事件日志字段。
- 已包含 PWA manifest、Service Worker 应用壳缓存和安装入口；线上版本可用 `npm run smoke:live` 验证主流程。
- Smoke 默认使用 Playwright Chromium，避免 Codex 沙箱里启动 macOS 系统 Chrome 时弹出崩溃报告；确需系统 Chrome 时用 `npm run smoke:chrome`。
