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
npm run scenarios        # 场景回归（存档/离线/多标签/任务门槛/兵器购买/智谋声望/斗地主整局），需先 build + preview
npm run scenarios:live
npm run rules:doudizhu   # 斗地主牌型规则断言
npm run stress:gameplay  # 1000 局自动对局；p95 阈值按 Mac 定，云服务器上超时属正常，只看 failures 是否为空
```

## 发布地址

推送到 `main` 后，GitHub Actions 会自动构建并更新 `gh-pages` 分支。仓库 Pages 发布源选择 `gh-pages / root` 后，访问：

https://cditlimei.github.io/jiaye-tianxia/

## 运行说明

- 原始图片保留在 `assets/`，运行时读取 `public/optimized/` 里的本地压缩图；新增或替换素材后运行 `npm run assets:optimize` 重新生成（依赖 macOS 的 `sips`；Linux 上可用 PIL 按最长边 640/960、JPEG 质量 74 生成同名文件）。同名文件换了内容必须同时升高 `src/lib/assets.ts` 里的 `OPTIMIZED_ASSET_VERSION`，否则浏览器和 Service Worker 会继续用旧缓存。
- 音频和视频从 GitHub raw 地址加载，CDN 缓存 5 分钟；URL 带版本号参数，换文件后同样升版本。
- 弃用的错位素材放在 `assets/unused/`，运行时不引用。
- 音频和视频按触发节点从 GitHub raw 地址加载，失败时不会阻断主流程。
- 完整流程包含标题页、主公选择、主城经营、伴侣招募、兵器库、自动回合战斗和战斗结算。
- 主城包含家业目标、府中纪事、离线收益结算、设置面板与本地存档恢复。
- 设置面板支持复制存档、粘贴 JSON 导入存档，并会校验角色、伴侣、兵器、任务与事件日志字段。
- 已包含 PWA manifest、Service Worker 应用壳缓存和安装入口；缓存名在构建时写入 build id，每次发版自动清理上一版缓存；线上版本可用 `npm run smoke:live` 验证主流程。
- Smoke 默认使用 Playwright Chromium，避免 Codex 沙箱里启动 macOS 系统 Chrome 时弹出崩溃报告；确需系统 Chrome 时用 `npm run smoke:chrome`。
