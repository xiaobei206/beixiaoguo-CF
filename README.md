# 贝小果 Cloudflare

贝小果的 Cloudflare 轻量化版本，目标是将静态网页部署在 Cloudflare Pages，并把可行的匿名片库能力迁到 Pages Functions / Workers，尽量复用原版前端。

当前开发版本：0.1.0

## 开发原则

- 与原版 `beixiaoguo-web` 分开开发，不修改 N1 正式版。
- 保持匿名，不引入账号系统或用户资料收集。
- 优先复用原生 HTML、CSS、JavaScript；不为了部署引入前端框架。
- Pages 静态资源与 Functions 分离；不依赖自管 VPS。
- 不将尚未验证的能力标成已实现；播放、CENC 解密和电视接力按实际兼容性逐步迁移。

## Cloudflare Pages

- Framework preset：None
- Build command：`npm run build`
- Build output directory：`public`
- Root directory：仓库根目录
- Production branch：`main`

连接 GitHub 仓库后，Pages 会自动构建和部署。仓库的 `functions/` 目录会作为 Pages Functions 路由一起部署。

## 功能状态

- [x] 迁移现有贝小果响应式 UI、PWA 清单和应用图标。
- [x] 自动部署前静态资源检查。
- [ ] Cloudflare Functions 匿名 SDK 运行验证。
- [ ] 推荐、搜索、热搜、新剧、榜单、详情与分季 API。
- [ ] 受保护 CENC 视频流的边缘解密与 Range 支持。
- [ ] 电视接力（需要能够访问用户本地网络的配套组件，普通边缘函数无法直接进行局域网 mDNS 搜索）。

## 版本与文档

- [VERSION](VERSION)
- [开发日志](DEVELOPMENT-LOG-CN.md)
- [架构与迁移计划](docs/architecture.md)
- [交接索引](HANDOFF-CN.md)

## 声明

本项目为个人学习与研究项目，与红果短剧及其运营方无关联。请遵守上游平台条款和适用法律。上游 SDK 的使用须遵守其单独的许可证和免责声明。
