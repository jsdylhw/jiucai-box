# 用 GitHub Pages 托管 jiucai-box

这是一份纯静态站点部署方案，不需要后端服务或数据库。

## 发布原理

```text
本地代码 → git push main → Actions 测试 → 上传 dist/ → GitHub Pages → 浏览器
```

浏览器请求 HTML、CSS、JavaScript 与约 1.17 MB 的行情 JSON，之后随机场景、指标、交易及收益计算都在浏览器中执行。刷新页面不保留当前游戏进度。

## 首次设置

1. 创建 `jiucai-box` 仓库并推送本项目。GitHub Free 使用公开仓库可启用 Pages；私有仓库是否支持取决于账户计划。
2. 在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
3. 推送 `main`，或从 **Actions → Deploy GitHub Pages → Run workflow** 手动发布。
4. 等待 `build` 和 `deploy` 成功，打开 **https://jsdylhw.github.io/jiucai-box/**。

工作流只上传 `dist/`。源码、测试和文档不会混入站点发布目录。`dist/data/us-2025.json` 必须存在，并随站点对访问者可见；它已经随仓库保存，无需每次部署临时下载行情。

## 后续更新

```sh
git add <本次修改的文件>
git commit -m "Describe the change"
git push origin main
```

测试成功后自动更新 Pages。Pull request 只运行检查，不发布生产站点。网站没有运行时令牌；工作流使用 GitHub 自动提供的身份，发布作业仅请求 Pages 写入和 OIDC 权限。

## 子路径适配

项目站点部署在 `/jiucai-box/` 子路径。HTML 样式和模块引用、模块内部导入、`fetch('./data/us-2025.json')` 均使用相对路径。没有客户端路由，也不需要 Nginx 重写。

## 常见问题

| 现象 | 检查 |
| --- | --- |
| Pages 返回 404 | 确认 Pages Source 为 GitHub Actions，最新 `deploy` 成功，地址包含 `/jiucai-box/` |
| 页面出现但无法加载行情 | 查看网络请求中的 `data/us-2025.json`，确认它包含在发布产物中 |
| `configure-pages` 失败 | 仓库是否已启用 Pages，Actions 是否可用，账户是否支持当前仓库可见性 |
| 修改后未生效 | 查看最新工作流提交号，等待部署完成，再刷新页面 |
| 本地双击 HTML 无数据 | 使用 `npm run dev`，或运行 `npm run bundle` 打开离线单文件 |

## 官方依据

核对日期：2026-10-13。

- [GitHub Pages 是什么](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)：静态托管、公开/私有仓库计划要求和项目站点地址。
- [使用自定义 Actions 工作流发布 Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)：构建产物、发布权限与 `github-pages` 环境。
- [GitHub Pages REST API](https://docs.github.com/en/rest/pages/pages)：通过 CLI/API 设置 `build_type: workflow` 和查询站点状态。
