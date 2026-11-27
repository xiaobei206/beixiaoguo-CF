# 贝小果 Cloudflare

贝小果的 Cloudflare 轻量化版本。静态网页可部署在 Cloudflare Pages 或 Workers Static Assets，匿名片库请求由边缘函数按需处理，不需要自管 VPS 或数据库。

当前开发版本：0.1.8

## 开发原则

- 与原版 beixiaoguo-web 分开开发，不修改 N1 正式版。
- 保持匿名，不增加账号系统或用户资料收集。
- 复用原生 HTML、CSS、JavaScript，不引入大型前端框架。
- Pages 静态资源与 Functions 分离；不依赖自管 VPS。
- 不把尚未验证的功能标成已实现；CENC 解密和电视接力按实际兼容性迁移。

## 快速部署（推荐 GitHub + Pages）

主页顶部的“部署教程”按钮会直接显示 Pages／Workers 安装步骤；完整的中文安装教程见 [docs/deploy-cloudflare-cn.md](docs/deploy-cloudflare-cn.md)。推荐在 Cloudflare 的 Workers & Pages 中选择 Pages → Connect to Git，授权 GitHub 后导入 `xiaobei206/beixiaoguo-CF`，配置 `main`、`npm run build` 和 `public`，即可自动部署。

**不要直接拖放 ZIP／文件夹作为完整安装**：本项目含 Pages Functions，控制台拖放部署不会编译 `functions/`，可能导致前端能开但 API 不工作。无 Git 自动部署时，请使用教程中的 Wrangler 命令行方案。

## Cloudflare Pages 设置

- Framework preset：None
- Build command：npm run build
- Build output directory：public
- Root directory：仓库根目录
- Production branch：main

连接 GitHub 仓库 xiaobei206/beixiaoguo-CF 后，Pages 会自动构建和部署。根目录 functions/ 会作为 Pages Functions 路由一起部署。

## 功能状态

- [x] 迁移现有响应式 UI、PWA 清单和应用图标。
- [x] 自动部署前静态资源检查；静态请求与 `/api/*` Functions 路由分开。
- [x] Pages Functions 本地运行时烟雾测试验证预编译 WASM SDK 可初始化（不请求上游片库）。
- [x] 增加可选的 Cloudflare Workers 入口与独立 Wrangler 配置，复用 Pages API 处理代码。
- [x] 修复封面 URL 过滤，允许 HTTPS 上游封面地址，并拒绝非 HTTPS／带凭据的外部 URL。
- [x] 主页加入可直接打开的 Pages／Workers 部署教程；页脚信息改为 Cloudflare 公网部署文案。
- [x] 建立推荐、搜索、热搜、新剧、榜单、详情、分集和多季 API 入口，待真实上游验收。
- [ ] 真实上游推荐、搜索、详情和播放逐项验收（本地 CI 只验证构建、媒体令牌／Range 解析及 WASM 初始化，不代表真实上游分集已端到端播放）。
- [x] 渐进式 MP4 CENC AES-CTR 的边缘 Range 解密、加密媒体会话与按需媒体代理（自 0.1.7 起；真实上游分集仍待端到端验收）。
- [ ] 电视接力；公共边缘函数无法直接对家庭局域网做 mDNS 发现。

## 0.1.8 修复

- 移除播放器中残留的“CENC 尚未迁移”硬编码提示，明确区分前后端部署版本不一致和真实媒体播放故障。
- HTML 静态资源缓存版本、API 诊断版本、`VERSION` 与 `package.json` 统一到 0.1.8。
- CI 静态检查阻止旧提示回归。

## 文档

- VERSION：当前版本
- DEVELOPMENT-LOG-CN.md：累计开发日志
- docs/architecture.md：架构与迁移计划
- HANDOFF-CN.md：交接索引

## 声明

本项目为个人学习与研究项目，与红果短剧及其运营方无关联。请遵守上游平台条款和适用法律。上游 SDK 的使用须遵守其单独的许可证和免责声明。
