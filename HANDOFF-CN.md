# 贝小果 Cloudflare 交接索引

| 文件 | 用途 |
|---|---|
| [README.md](README.md) | 项目目标、功能状态与 Pages 部署 |
| [docs/architecture.md](docs/architecture.md) | Functions、匿名 SDK、API 映射与限制 |
| [DEVELOPMENT-LOG-CN.md](DEVELOPMENT-LOG-CN.md) | 单一累计开发日志 |
| [VERSION](VERSION) | 当前版本 |

## 当前版本

**0.1.1 — 2026-11-27**

- 已迁移原版 UI/PWA 资源。
- 已接入 openhongguo Node.js/WASM SDK；0.1.1 修复动态 `require()` 加载 WASM 的边缘兼容问题，等待新增 runtime smoke test 结果。
- 已建立推荐、搜索、详情、多季、榜单、新剧与播放解析接口适配层，仍需真实上游验收。
- CENC 受保护流、图片预热/持久缓存、电视接力尚未迁移。
- 原版 beixiaoguo-web 不受本仓库修改影响。

## Pages 部署参数

- Build command：npm run build
- Build output directory：public
- GitHub 仓库：xiaobei206/beixiaoguo-CF
- Production branch：main
